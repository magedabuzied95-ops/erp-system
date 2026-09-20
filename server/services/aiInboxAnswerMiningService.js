// Learning from every conversation — safely.
//
// The owner's ask: "the agent should learn from all the conversations we have with customers." The
// dangerous reading of that is to feed staff replies back to the agent as fact. One salesperson quoting
// a price from memory, one "yes we have it" typed before checking stock, and that becomes shop policy —
// which breaks the rule the whole system rests on: product facts come from the ERP, never from text.
//
// So this mines instead of learning. It reads the real conversations, finds the questions customers ask
// repeatedly that a HUMAN had to answer (meaning the agent could not), clusters them, and hands the
// owner a candidate: "asked 14 times, your team answered like this — teach it?" One click turns it into
// a rule in ai_agent_knowledge. The agent ends up taught by the whole inbox; a person approved every
// sentence on the way.
//
// A staff reply is the signal on purpose. Where the agent already answered well, nothing needs teaching;
// where a person stepped in, the agent has a gap, and the person's reply is the shape of the answer.

import db from "../database/db.js";
import { normalizeKnowledgeText } from "./aiAgentKnowledgeService.js";

const text = (value) => String(value ?? "").trim();
const int = (value, fallback = 0) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

// Bounded on purpose: this is an on-demand read for one screen, not a background job. A shop with a
// year of traffic must not be able to turn opening a settings tab into a table scan.
const LOOKBACK_DAYS = 60;
const MAX_PAIRS = 2000;
const MIN_CLUSTER_SIZE = 2;
const MAX_CLUSTERS = 25;
const MIN_QUESTION_CHARS = 8;
const MAX_QUESTION_CHARS = 300;

/*
 * Words that carry no topic. Without stripping these, "هو ده متوفر" and "هو ده الفرع" look similar
 * because they share every word that is not the point.
 */
const STOPWORDS = new Set(
  `ال في من على عن الى إلى مع هو هي ده دي دى ازاي ازى كام بكام ايه إيه هل ممكن لو انا أنا انت إنت احنا يا لو عايز عاوز عايزه محتاج ممكن فيه في هوا هيا يعني بس كده كدا ولا او أو و ان إن اللي الي التي الذي ده دا علشان عشان لان لأن بعد قبل دلوقتي النهارده بكره امبارح
  is are the a an of to for do does can you i we they it this that what how much when where why please need want`
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean)
);

const tokenize = (value = "") =>
  normalizeKnowledgeText(value)
    .split(" ")
    .filter((token) => token.length >= 2 && !STOPWORDS.has(token));

const jaccard = (a, b) => {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  a.forEach((token) => {
    if (b.has(token)) shared += 1;
  });
  return shared / (a.size + b.size - shared);
};

/**
 * Question/answer pairs where a PERSON answered.
 *
 * `staff_user_id IS NOT NULL` is what makes a row a human reply (see aiInboxTeamPerformanceService for
 * why message rows, not session rows, are the durable record of who did what).
 */
const loadAnsweredQuestions = async ({ tenantId, days }) => {
  const result = await db.query(
    `
    WITH staff_replies AS (
      SELECT m.session_id, m.staff_message, m.created_at
      FROM ai_support_messages m
      WHERE m.tenant_id = $1
        AND m.created_at >= NOW() - ($2 || ' days')::interval
        AND m.staff_user_id IS NOT NULL
        AND COALESCE(m.staff_message, '') <> ''
        AND m.deleted_at IS NULL
      ORDER BY m.created_at DESC
      LIMIT $3
    )
    SELECT
      q.customer_message AS question,
      r.staff_message AS answer
    FROM staff_replies r
    JOIN LATERAL (
      SELECT c.customer_message
      FROM ai_support_messages c
      WHERE c.tenant_id = $1
        AND c.session_id = r.session_id
        AND COALESCE(c.customer_message, '') <> ''
        AND c.created_at <= r.created_at
        AND c.deleted_at IS NULL
      ORDER BY c.created_at DESC
      LIMIT 1
    ) q ON TRUE
    `,
    [tenantId, days, MAX_PAIRS]
  );
  return (result.rows || [])
    .map((row) => ({ question: text(row.question), answer: text(row.answer) }))
    .filter(
      (row) =>
        row.question.length >= MIN_QUESTION_CHARS &&
        row.question.length <= MAX_QUESTION_CHARS &&
        row.answer.length >= 2
    );
};

/*
 * Greedy single-pass clustering on token overlap. Not the most accurate method available, but it is
 * deterministic, explainable and runs in milliseconds on a bounded list — and the owner reads every
 * cluster before it becomes a rule, so a stray grouping costs a glance, not a wrong answer.
 */
export const clusterQuestions = (pairs = [], { threshold = 0.5 } = {}) => {
  const clusters = [];
  pairs.forEach((pair) => {
    const tokens = new Set(tokenize(pair.question));
    if (!tokens.size) return;
    const hit = clusters.find((cluster) => jaccard(cluster.tokens, tokens) >= threshold);
    if (hit) {
      hit.count += 1;
      hit.questions.push(pair.question);
      hit.answers.push(pair.answer);
      // Keep the shortest phrasing as the label: it is usually the clearest way the question gets asked.
      if (pair.question.length < hit.question.length) hit.question = pair.question;
      return;
    }
    clusters.push({
      tokens,
      question: pair.question,
      questions: [pair.question],
      answers: [pair.answer],
      count: 1,
    });
  });
  return clusters;
};

// The answer a cluster should suggest: the one the team gave most often, with the longest version
// winning a tie — a fuller reply is the better starting point for the owner to edit.
const dominantAnswer = (answers = []) => {
  const groups = new Map();
  answers.forEach((answer) => {
    const key = normalizeKnowledgeText(answer).slice(0, 160);
    if (!key) return;
    const existing = groups.get(key);
    if (existing) {
      existing.count += 1;
      if (answer.length > existing.answer.length) existing.answer = answer;
    } else {
      groups.set(key, { answer, count: 1 });
    }
  });
  const best = [...groups.values()].sort((a, b) => b.count - a.count || b.answer.length - a.answer.length)[0];
  return best || { answer: answers[0] || "", count: 1 };
};

// Trigger candidates: the content words the whole cluster shares. Those are the words that made these
// questions the same question, which is exactly what a trigger should be.
const suggestTriggers = (cluster) => {
  const counts = new Map();
  cluster.questions.forEach((question) => {
    new Set(tokenize(question)).forEach((token) => counts.set(token, (counts.get(token) || 0) + 1));
  });
  return [...counts.entries()]
    .filter(([token, count]) => count >= Math.max(2, Math.ceil(cluster.count * 0.6)) && token.length >= 3)
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .slice(0, 4)
    .map(([token]) => token);
};

/**
 * What the inbox has to teach, ranked by how often customers asked.
 *
 * Suggestions only: nothing here changes a reply until the owner saves it as a knowledge entry.
 */
export const mineAnswerSuggestions = async ({ tenantId, days = LOOKBACK_DAYS } = {}) => {
  const lookback = Math.max(1, Math.min(365, int(days, LOOKBACK_DAYS)));
  const pairs = await loadAnsweredQuestions({ tenantId, days: lookback }).catch((error) => {
    console.warn("[answer-mining] load failed", { tenant_id: tenantId, message: error?.message });
    return [];
  });

  const clusters = clusterQuestions(pairs)
    .filter((cluster) => cluster.count >= MIN_CLUSTER_SIZE)
    .sort((a, b) => b.count - a.count)
    .slice(0, MAX_CLUSTERS);

  return {
    range_days: lookback,
    pairs_examined: pairs.length,
    // Says plainly when there is simply not enough history yet, instead of showing an empty list that
    // reads like a broken screen.
    enough_history: pairs.length >= 10,
    suggestions: clusters.map((cluster) => {
      const answer = dominantAnswer(cluster.answers);
      return {
        question: cluster.question,
        asked_count: cluster.count,
        suggested_triggers: suggestTriggers(cluster),
        suggested_answer: answer.answer,
        answer_repeated: answer.count,
        sample_questions: [...new Set(cluster.questions)].slice(0, 4),
      };
    }),
  };
};

export const __answerMiningTestHooks = { tokenize, jaccard, dominantAnswer, suggestTriggers };

export default mineAnswerSuggestions;
