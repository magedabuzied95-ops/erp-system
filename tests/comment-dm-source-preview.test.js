import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// When a customer comments on a post and receives an automatic private-reply DM, the AI Inbox shows
// an inline preview of the source post (image + caption + link) with the customer's comment quoted
// beneath it. The context is stamped onto the comment_private_reply DM row at send time, survives the
// read whitelist, and renders in the transcript. This guards all four layers of that pipeline.

const automation = fs.readFileSync(new URL("../server/services/socialCommentAutomationService.js", import.meta.url), "utf8");
const logSvc = fs.readFileSync(new URL("../server/services/aiSupportLogService.js", import.meta.url), "utf8");
const salesSvc = fs.readFileSync(new URL("../server/services/aiSalesAgentService.js", import.meta.url), "utf8");
const transcript = fs.readFileSync(new URL("../src/modules/aiSupport/components/TranscriptMessage.jsx", import.meta.url), "utf8");

test("the private-reply DM step carries the source comment's post + comment context", () => {
  // The private_message runStep must hand the post/comment context so the DM row can render the source.
  const step = automation.slice(automation.indexOf('key: "private_message"'), automation.indexOf("buildTranscriptTarget: (response) => {"));
  assert.ok(step.length > 0, "the private_message step exists");
  assert.match(step, /sourceComment:\s*\{/, "the step passes a sourceComment object");
  assert.match(step, /post_full_picture: resolveSocialCommentPostFullPicture\(safeRow\)/, "the post image is resolved from the comment row");
  assert.match(step, /comment_text: text\(safeRow\.original_comment_text/, "the customer's comment text rides along");
  // runStep must forward sourceComment into the transcript append (not drop it)
  const runStep = automation.slice(automation.indexOf("const runStep = async ({"), automation.indexOf("if (likeNeeded) {"));
  assert.match(runStep, /sourceComment = null,/, "runStep accepts sourceComment");
  assert.match(runStep, /sourceComment,\s*\}\);/, "runStep forwards sourceComment on success");
});

test("appendAutomationSupportTranscript stamps the post/comment columns onto the DM row", () => {
  const fn = logSvc.slice(logSvc.indexOf("export const appendAutomationSupportTranscript"), logSvc.indexOf("export const logAiSupportMessage"));
  assert.match(fn, /sourceComment = null,/, "the helper accepts the context");
  assert.match(fn, /const sc = sourceComment && typeof sourceComment === "object"/, "it normalizes the context");
  // the INSERT must list the context columns and bind them
  assert.match(fn, /source_comment_text\s*\)/, "source_comment_text is inserted");
  assert.match(fn, /post_full_picture,/, "post_full_picture is inserted");
  assert.match(fn, /repairText\(sc\.comment_text \|\| ""\)/, "the comment text is bound");
  assert.match(fn, /repairText\(sc\.post_full_picture \|\| ""\)/, "the post image is bound");
  // the column must exist (migration)
  assert.match(logSvc, /ADD COLUMN IF NOT EXISTS source_comment_text TEXT/, "the source_comment_text column is ensured");
});

test("the read path keeps the post/comment context instead of dropping it", () => {
  const fn = salesSvc.slice(salesSvc.indexOf("export const normalizeInboxMessage"), salesSvc.indexOf("const normalizeAiReplyDraft"));
  for (const field of ["post_full_picture", "post_message", "post_permalink_url", "comment_url", "commenter_name", "source_comment_text"]) {
    assert.match(fn, new RegExp(`${field}: row\\.${field}`), `${field} survives normalizeInboxMessage`);
  }
});

test("old DMs are enriched at read time from the comment_id in their body", () => {
  // DMs stored before send-time stamping have empty context columns but carry comment_id in the
  // private-reply link; loadAiInboxMessages borrows the matching comment_inbound row's context so the
  // same preview renders retroactively — read-only, no backfill.
  const fn = salesSvc.slice(salesSvc.indexOf("export const loadAiInboxMessages"), salesSvc.indexOf("const customerPhoneKeys ="));
  assert.match(fn, /extractSourceCommentId/, "it extracts a comment_id from the DM body");
  assert.match(fn, /comment_id\[=\/\]\(\\d\{5,\}\)/, "it parses comment_id= links");
  assert.match(fn, /message_type = 'comment_inbound'/, "it looks the context up from the stored comment");
  assert.match(fn, /split_part\(comment_id, '_', 2\)/, "it matches both bare and <post>_<comment> id formats");
  assert.match(fn, /source_comment_text: text\(row\.source_comment_text\) \|\| text\(enrich\.customer_message\)/, "the borrowed comment text drives the preview gate");
});

test("the transcript renders the inline source-comment preview, gated to private replies", () => {
  assert.match(transcript, /function SourceCommentContext\(/, "the preview component exists");
  const gate = transcript.slice(transcript.indexOf("const sourceCommentContext = (message = {})"), transcript.indexOf("function SourceCommentContext("));
  assert.match(gate, /message\.message_type\).toLowerCase\(\) === "comment_private_reply"/, "the preview is gated to the DM reply");
  assert.match(gate, /if \(!isPrivateReply && !commentText\) return null/, "an ordinary text reply never shows it");
  // it must actually be rendered in the staff bubble (desktop + pwa), and never on a comment bubble
  assert.match(transcript, /const sourceComment = isCommentMessage \? null : sourceCommentContext\(message\)/, "comment bubbles are excluded");
  assert.ok((transcript.match(/<SourceCommentContext context=\{sourceComment\}/g) || []).length >= 2, "rendered in both desktop and pwa staff bubbles");
});
