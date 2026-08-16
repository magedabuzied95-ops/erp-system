/**
 * Agreement scoring: did the employee send what the AI wrote?
 *
 * This is the measurement that gates autonomy, and the one the system never had.
 * Shadow mode answers "was this draft ELIGIBLE to auto-send" — a question about
 * blockers and confidence, both of which the system computes about itself. It cannot
 * answer "would the auto-sent reply have been the right one", because nothing ever
 * compared the draft to what the human actually sent.
 *
 * Those two questions can disagree completely. A draft can clear every blocker, score
 * high confidence, and still be rewritten from scratch by every employee who sees it.
 * Turning on autonomy from eligibility alone would ship exactly that draft to
 * customers, and the first evidence would be a complaint.
 *
 * Deterministic on purpose — no model call. Three reasons:
 *   - it must run on every approved reply, and a per-reply API call is a cost and a
 *     latency the send path should not carry;
 *   - a judge model scoring its own family's output is a weak instrument;
 *   - the measurement has to keep working when the API key is missing or rate limited,
 *     which is precisely when you most want to know what is happening.
 *
 * The score is intentionally conservative: it answers "how much did the human have to
 * change this", not "is this good". A rewritten draft is evidence against autonomy
 * even when the rewrite was stylistic.
 *
 * KNOWN LIMITATION, and it matters for how the number is read: a token metric cannot
 * tell a stylistic tweak from a factual correction. An employee changing "950 جنيه" to
 * "1050 جنيه" alters one token and scores as lightly edited, even though sending that
 * draft unattended would have quoted the customer the wrong price. So a high readiness
 * rate is necessary evidence for autonomy and not sufficient evidence: the edited
 * pairs still have to be read. That is why both texts are stored rather than only the
 * score. Detecting factual edits specifically — numbers, sizes, availability words —
 * is the obvious next refinement and is deliberately not guessed at here.
 */
import { normalizeArabicForIntent } from "../utils/arabicTextNormalizer.js";

const text = (value = "") => String(value ?? "").trim();

/** Verdicts, ordered from most to least agreement. */
export const AGREEMENT_VERDICTS = Object.freeze([
  "sent_as_is",
  "lightly_edited",
  "heavily_edited",
  "rewritten",
  "discarded",
]);

/**
 * Thresholds on token similarity. Chosen to be readable rather than tuned: they will
 * move once there is real data, and the point of this file is to produce that data.
 */
const SENT_AS_IS = 0.98;
const LIGHTLY_EDITED = 0.85;
const HEAVILY_EDITED = 0.5;

/**
 * Folds the differences that carry no meaning, so an employee fixing a hamza is not
 * recorded as disagreeing with the draft. Without this, Arabic orthography alone would
 * depress every score and the metric would look far worse than reality.
 */
const foldForComparison = (value = "") => {
  const normalized = text(normalizeArabicForIntent(text(value))) || text(value);
  return normalized
    .toLowerCase()
    // Punctuation and emoji are style, not substance, and employees add both freely.
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
};

const tokenize = (value = "") => foldForComparison(value).split(" ").filter(Boolean);

/**
 * Token-level Jaccard similarity, weighted by how much of the DRAFT survived.
 *
 * Plain Jaccard punishes an employee who kept the draft and added a sentence just as
 * hard as one who deleted half of it, but those mean opposite things for autonomy:
 * additions are the AI being incomplete, deletions are the AI being wrong. Retention
 * is what actually predicts whether auto-sending would have been safe, so the two are
 * blended with retention weighted higher.
 */
export const similarityScore = (draft = "", sent = "") => {
  const draftTokens = tokenize(draft);
  const sentTokens = tokenize(sent);

  if (!draftTokens.length && !sentTokens.length) return 1;
  if (!draftTokens.length || !sentTokens.length) return 0;

  const draftSet = new Set(draftTokens);
  const sentSet = new Set(sentTokens);
  let shared = 0;
  for (const token of draftSet) if (sentSet.has(token)) shared += 1;

  const retention = shared / draftSet.size;
  const union = new Set([...draftSet, ...sentSet]).size;
  const jaccard = shared / union;

  return Number((retention * 0.7 + jaccard * 0.3).toFixed(4));
};

/**
 * Scores one draft against what was actually sent.
 *
 * An empty `sent` means the draft was never used — the strongest possible evidence
 * against autonomy, and deliberately not treated as a missing data point.
 */
export const scoreAgreement = ({ draftText = "", sentText = "" } = {}) => {
  const draft = text(draftText);
  const sent = text(sentText);

  if (!draft) return { scored: false, reason: "no_draft", similarity: null, verdict: null };
  if (!sent) return { scored: true, reason: "", similarity: 0, verdict: "discarded", draft_tokens: tokenize(draft).length, sent_tokens: 0 };

  const similarity = similarityScore(draft, sent);
  const verdict =
    similarity >= SENT_AS_IS ? "sent_as_is"
    : similarity >= LIGHTLY_EDITED ? "lightly_edited"
    : similarity >= HEAVILY_EDITED ? "heavily_edited"
    : "rewritten";

  return {
    scored: true,
    reason: "",
    similarity,
    verdict,
    draft_tokens: tokenize(draft).length,
    sent_tokens: tokenize(sent).length,
  };
};

/**
 * Turns a set of scored replies into the number an autonomy decision needs.
 *
 * `auto_send_ready_rate` counts only drafts a human sent unchanged or nearly so. It
 * deliberately excludes heavily edited drafts: "the employee kept about half of it" is
 * not evidence that sending the whole thing unattended would have been fine.
 */
export const summarizeAgreement = (scores = []) => {
  const scored = (Array.isArray(scores) ? scores : []).filter((entry) => entry?.scored && entry.verdict);
  const total = scored.length;
  if (!total) {
    return { total: 0, auto_send_ready_rate: null, mean_similarity: null, by_verdict: {}, recommendation: "insufficient_data" };
  }

  const byVerdict = {};
  for (const verdict of AGREEMENT_VERDICTS) byVerdict[verdict] = 0;
  let similaritySum = 0;
  for (const entry of scored) {
    byVerdict[entry.verdict] = (byVerdict[entry.verdict] || 0) + 1;
    similaritySum += Number(entry.similarity) || 0;
  }

  const ready = byVerdict.sent_as_is + byVerdict.lightly_edited;
  const rate = Number((ready / total).toFixed(4));

  return {
    total,
    auto_send_ready_rate: rate,
    mean_similarity: Number((similaritySum / total).toFixed(4)),
    by_verdict: byVerdict,
    // A recommendation, never an action. Enabling autonomy stays a human decision;
    // this only says whether the evidence would support one. The sample floor matters
    // as much as the rate: a 100% rate over nine replies is not evidence of anything.
    recommendation:
      total < 100 ? "insufficient_data"
      : rate >= 0.9 ? "autonomy_supported"
      : rate >= 0.75 ? "narrow_autonomy_only"
      : "keep_human_approval",
  };
};

export const __testing = { foldForComparison, tokenize, SENT_AS_IS, LIGHTLY_EDITED, HEAVILY_EDITED };
