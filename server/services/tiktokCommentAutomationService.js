// TikTok comments — the automatic public reply.
//
// WHY THIS IS NOT A BRANCH INSIDE THE META ENGINE
// -----------------------------------------------
// Facebook/Instagram comments reach the automatic reply through
// socialCommentAutomationService.storeSocialCommentAutomationRuns, which on its
// way fetches post media from the Graph API, hides banned-word comments through
// the Graph API, collapses every non-Instagram platform to "facebook" in its run
// keys and caches, and only then picks one of two runtimes. A tiktok row in there
// would be silently treated as a Facebook comment. So TikTok rows keep entering
// with skipAutomation: true, and tiktokBusinessCommentsSyncService hands each
// newly ingested customer comment to runTikTokCommentAutoReply below instead.
//
// WHAT IS SHARED WITH META (the same rules, not copies of them)
// --------------------------------------------------------------
//   * classifySocialCommentIntent        — the comment's lead label and score
//   * buildSocialCommentAutomationDecision — eligible labels, min_confidence,
//     the tenant's auto_public_reply_enabled switch and the
//     SOCIAL_COMMENTS_AUTO_PUBLIC_REPLY env kill switch
//   * findBannedWord + the tenant's banned-word list
//   * selectSocialPublicReplyTemplate + renderSocialTemplateText — openers,
//     rotation, {{customer_name}}
//   * the recency guard idea: a first sync of a video reads its whole history,
//     and none of that history may be answered
//   * social_comment_automation_runs — action_taken / public_reply_status /
//     like_status / dm_status / error_code / automation_state, the same columns
//     the Center already reads for Meta rows
//
// WHAT IS TIKTOK-ONLY
// -------------------
//   * tiktok_auto_reply_enabled — its own switch, default OFF, on top of the
//     shared public-reply switch. While it is off this module writes nothing.
//   * Only the public reply runs. Like, comment-to-DM and hide have no TikTok
//     comments API behind them here; they are recorded as skipped with reason
//     "unsupported_platform", never attempted and never thrown.
//   * Replies inside a thread are not answered — only top-level comments. A
//     thread is usually a conversation already in progress (often with us).
//   * The reply text: tiktok_public_reply_template when set, otherwise the
//     shared public reply WITHOUT its "replied in private" line — no DM is sent
//     on TikTok, so that line would be a false promise.
//   * Sending goes through replyToTikTokComment (ownership check, duplicate
//     protection, reply log, our reply marked as own in the comment map).

import db from "../database/db.js";
import { findBannedWord } from "./socialCommentModerationService.js";
import {
  getSocialAutomationSettings,
  renderSocialTemplateText,
  selectSocialPublicReplyTemplate,
} from "./socialAutomationSettingsService.js";
import { TIKTOK_BUSINESS_REPLY_MAX_CHARS } from "./tiktokBusinessApiClient.js";

const text = (value = "") => String(value ?? "").trim();

export const TIKTOK_COMMENT_UNSUPPORTED_STEPS = Object.freeze(["likeComment", "privateReply", "hideComment"]);

// TikTok's own docs put comment.update webhooks up to ~5 minutes behind, and
// the poll runs every TIKTOK_BUSINESS_COMMENTS_POLL_INTERVAL_MS (5 min). Meta's
// polling window is one hour; TikTok uses the same hour, widened when the poll
// interval is configured long enough that an hour could miss a whole cycle.
export const tiktokCommentRecencyWindowMs = () => {
  const minutes = Number.parseInt(process.env.TIKTOK_COMMENT_AUTOMATION_RECENCY_MINUTES || "", 10);
  if (Number.isFinite(minutes) && minutes > 0) return minutes * 60 * 1000;
  const pollMs = Math.max(60_000, Number(process.env.TIKTOK_BUSINESS_COMMENTS_POLL_INTERVAL_MS || 5 * 60 * 1000));
  return Math.max(60 * 60 * 1000, pollMs * 4);
};

const isTikTokRow = (row = {}) =>
  text(row.platform).toLowerCase() === "tiktok" || text(row.channel).toLowerCase() === "tiktok_comment";

const isThreadReply = (row = {}) =>
  Boolean(text(row.parent_comment_id)) || row.raw_payload?.is_reply === true;

const commentCreatedAt = (row = {}) => {
  const raw = row.comment_created_time || row.raw_payload?.comment_created_time || "";
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const commenterName = (row = {}) =>
  text(row.commenter_name) || text(row.raw_payload?.username) || "";

// The shared default and most owner-edited bodies open with "تم الرد عليك في
// الخاص". Nothing goes to the TikTok inbox, so that line is dropped; every
// other line (shipping, address, location) is kept exactly as the owner wrote it.
const PRIVATE_REPLY_PROMISE_PATTERN = /في\s*الخاص|ع\s*الخاص|على\s*الخاص|inbox|\bdm\b/i;

export const resolveTikTokPublicReplyBaseTemplate = (settings = {}) => {
  const own = text(settings.tiktok_public_reply_template);
  if (own) return own;
  const shared = String(settings.public_reply_template ?? "");
  return shared
    .split(/\r?\n/)
    .filter((line) => !PRIVATE_REPLY_PROMISE_PATTERN.test(line))
    .join("\n")
    .trim();
};

export const renderTikTokCommentPublicReply = ({ row = {}, settings = {} } = {}) => {
  const baseTemplate = resolveTikTokPublicReplyBaseTemplate(settings);
  const selected = selectSocialPublicReplyTemplate({
    baseTemplate,
    openers: settings.public_reply_openers,
    rotationEnabled: settings.public_reply_rotation_enabled,
    commentId: text(row.comment_id),
    postId: text(row.post_id),
  });
  const name = commenterName(row);
  const rendered = renderSocialTemplateText(
    selected,
    (key) => (key.toLowerCase() === "customer_name" ? name : undefined)
  ).trim();
  return Array.from(rendered).slice(0, TIKTOK_BUSINESS_REPLY_MAX_CHARS).join("").trim();
};

let metaRulesPromise = null;
const loadSharedCommentRules = () => {
  if (!metaRulesPromise) {
    metaRulesPromise = import("./socialCommentAutomationService.js")
      .then((module) => ({
        classify: module.classifySocialCommentIntent,
        buildDecision: module.buildSocialCommentAutomationDecision,
      }))
      .catch((error) => {
        metaRulesPromise = null;
        throw error;
      });
  }
  return metaRulesPromise;
};

const persistTikTokAutomationOutcome = async ({ tenantId, commentId, outcome, client = db }) => {
  await client.query(
    `UPDATE social_comment_automation_runs
     SET action_taken = $3::text,
         public_reply_status = COALESCE(NULLIF($4::text, ''), public_reply_status),
         like_status = COALESCE(NULLIF($5::text, ''), like_status),
         dm_status = COALESCE(NULLIF($6::text, ''), dm_status),
         error_code = NULLIF($7::text, ''),
         classification_label = COALESCE(classification_label, NULLIF($8::text, '')),
         classification_score = COALESCE(classification_score, $9::numeric),
         automation_state = COALESCE(automation_state, '{}'::jsonb) || $10::jsonb,
         updated_at = NOW()
     WHERE tenant_id = $1::bigint AND platform = 'tiktok' AND comment_id = $2::text`,
    [
      tenantId,
      commentId,
      text(outcome.action_taken),
      text(outcome.public_reply_status),
      text(outcome.like_status),
      text(outcome.dm_status),
      text(outcome.error_code),
      text(outcome.classification_label),
      Number.isFinite(Number(outcome.classification_score)) && outcome.classification_label
        ? Number(outcome.classification_score)
        : null,
      JSON.stringify(outcome.automation_state || {}),
    ]
  );
};

const unsupportedStepResults = () => [
  { step: "likeComment", status: "skipped", reason: "unsupported_platform" },
  { step: "privateReply", status: "skipped", reason: "unsupported_platform" },
  { step: "hideComment", status: "skipped", reason: "unsupported_platform" },
];

// Runs the gates and, when they all pass, sends one public reply. Never throws:
// it is called from inside the comment sync, and a failed reply must never
// fail the sync that stored the comment.
//
// deps (all optional; tests inject every one):
//   getSettings(tenantId)  sendReply({ tenantId, commentId, text })
//   persist({ tenantId, commentId, outcome })  classify(text)
//   buildDecision({ row, featureFlags, automationSettings })
//   featureFlags  now()  log(event, payload)
export const runTikTokCommentAutoReply = async ({ tenantId = null, row = {}, isOwn = false, deps = {} } = {}) => {
  const log = deps.log || ((event, payload) => console.log(event, payload));
  const safeTenantId = Number(tenantId || row?.tenant_id || 0) || null;
  const commentId = text(row?.comment_id);
  const base = { tenant_id: safeTenantId, platform: "tiktok", post_id: text(row?.post_id), comment_id: commentId };
  const finish = (result) => {
    log("SOCIAL_COMMENT_AUTOMATION_FINAL_DECISION", {
      ...base,
      source: text(row?.raw_payload?.source || "tiktok_business_comment_sync"),
      like: { status: "skipped", reason: "unsupported_platform" },
      public_reply: { status: result.public_reply_status || "skipped", reason: result.reason || "" },
      private_reply: { status: "skipped", reason: "unsupported_platform" },
    });
    return result;
  };

  try {
    // Gates that write nothing: not ours to touch, or switched off.
    if (!safeTenantId || !commentId) return finish({ skipped: true, reason: "invalid_input" });
    if (!isTikTokRow(row)) return finish({ skipped: true, reason: "not_tiktok" });
    if (isOwn || row.is_page_authored === true || row.raw_payload?.is_page_authored === true) {
      return finish({ skipped: true, reason: "own_comment" });
    }

    const getSettings = deps.getSettings || getSocialAutomationSettings;
    const settings = await getSettings(safeTenantId);
    if (!settings?.tiktok_auto_reply_enabled) {
      return finish({ skipped: true, reason: "tiktok_auto_reply_disabled" });
    }
    if (["sent", "failed", "skipped"].includes(text(row.public_reply_status).toLowerCase())) {
      return finish({ skipped: true, reason: "already_processed", public_reply_status: text(row.public_reply_status) });
    }

    const persist = deps.persist || persistTikTokAutomationOutcome;
    const rules = deps.classify && deps.buildDecision
      ? { classify: deps.classify, buildDecision: deps.buildDecision }
      : await loadSharedCommentRules();
    const commentText = text(row.original_comment_text || row.comment_text);
    const classification = row.classification_label
      ? { label: text(row.classification_label), score: Number(row.classification_score || 0) }
      : rules.classify(commentText);
    const classifiedRow = {
      ...row,
      classification_label: classification.label,
      classification_score: classification.score,
    };

    const skipWith = async (reason, extra = {}) => {
      const outcome = {
        action_taken: `automation_skipped_${reason}`,
        public_reply_status: "skipped",
        like_status: "skipped",
        dm_status: "skipped",
        error_code: reason,
        classification_label: classification.label,
        classification_score: classification.score,
        automation_state: {
          overall_status: "skipped",
          reason,
          tiktok: {
            step_results: [{ step: "publicReply", status: "skipped", reason }, ...unsupportedStepResults()],
            ...extra,
          },
          updated_at: new Date().toISOString(),
        },
      };
      await persist({ tenantId: safeTenantId, commentId, outcome });
      return finish({ skipped: true, reason, public_reply_status: "skipped", outcome });
    };

    if (isThreadReply(row)) return skipWith("reply_comment");

    const now = deps.now ? deps.now() : new Date();
    const createdAt = commentCreatedAt(row);
    if (createdAt && now.getTime() - createdAt.getTime() > tiktokCommentRecencyWindowMs()) {
      return skipWith("old_comment_recency_guard", { comment_created_time: createdAt.toISOString() });
    }

    const decision = rules.buildDecision({
      row: classifiedRow,
      ...(deps.featureFlags ? { featureFlags: deps.featureFlags } : {}),
      automationSettings: settings,
    });
    if (!decision.eligible) return skipWith(decision.reason || "ineligible_comment");
    if (!decision.requested?.publicReply) {
      return skipWith(settings.auto_public_reply_enabled ? "feature_flags_disabled" : "tenant_automation_disabled");
    }

    if (settings.banned_words_enabled) {
      const hit = findBannedWord({
        commentText,
        bannedWords: settings.banned_words || [],
        exceptions: settings.banned_word_exceptions || [],
      });
      // Meta hides these; TikTok has no hide path here, so the comment is left for a
      // person to deal with — and certainly not thanked in public.
      if (hit.matched) return skipWith("banned_word", { word: hit.word });
    }

    const replyText = renderTikTokCommentPublicReply({ row: classifiedRow, settings });
    if (!replyText) return skipWith("empty_reply");

    const sendReply = deps.sendReply;
    if (typeof sendReply !== "function") return skipWith("reply_sender_unavailable");

    let sendResult = null;
    let sendError = null;
    try {
      sendResult = await sendReply({ tenantId: safeTenantId, commentId, text: replyText });
    } catch (error) {
      sendError = error;
    }

    // The poll and the webhook can ingest the same comment at once; the reply log
    // lets exactly one of them send. The loser writes nothing — the winner's
    // outcome is the truth for this row.
    if (sendError?.code === "TIKTOK_BUSINESS_REPLY_DUPLICATE") {
      return finish({ skipped: true, reason: "duplicate_in_flight" });
    }

    const sent = !sendError && sendResult?.sent !== false;
    const failureMessage = sendError ? text(sendError.message || "reply failed") : "";
    const errorCode = sent
      ? ""
      : (!sendError?.status || /fetch failed|network|timeout|ENOTFOUND|ECONNREFUSED/i.test(failureMessage)
        ? "transport_failed"
        : "tiktok_reply_failed");
    const publicReplyStep = sent
      ? { step: "publicReply", status: "sent", provider_reply_id: text(sendResult?.provider_reply_id), duplicate: Boolean(sendResult?.duplicate) }
      : { step: "publicReply", status: "failed", reason: errorCode, message: failureMessage };
    const outcome = {
      action_taken: sent ? "automation_completed" : "automation_failed",
      public_reply_status: sent ? "sent" : "failed",
      like_status: "skipped",
      dm_status: "skipped",
      error_code: errorCode,
      classification_label: classification.label,
      classification_score: classification.score,
      automation_state: {
        overall_status: sent ? "completed" : "failed",
        reason: sent ? "" : "automation_step_failed",
        public_reply: {
          status: sent ? "sent" : "failed",
          rendered_reply: replyText,
          ...(sent ? { sent_at: new Date().toISOString() } : { error: failureMessage }),
        },
        tiktok: { step_results: [publicReplyStep, ...unsupportedStepResults()] },
        updated_at: new Date().toISOString(),
      },
    };
    await persist({ tenantId: safeTenantId, commentId, outcome });
    return finish({
      skipped: false,
      reason: sent ? "" : errorCode,
      public_reply_status: outcome.public_reply_status,
      reply_text: replyText,
      provider_reply_id: text(sendResult?.provider_reply_id),
      outcome,
    });
  } catch (error) {
    console.warn("[tiktok-business] comment auto-reply failed", {
      ...base,
      message: text(error?.message),
      code: text(error?.code),
    });
    return { skipped: true, reason: "automation_error", error: text(error?.message) };
  }
};
