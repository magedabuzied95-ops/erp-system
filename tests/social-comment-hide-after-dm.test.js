import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/* The first live run of "hide customer comments" (2026-09-10) hid the comment 150ms after the
   private reply landed. The DM is sent by a separate worker and the hide step did not wait for it,
   so the order was luck — the first backed-up queue would have hidden the comment before its DM
   went out, on exactly the posts where the owner asked for hiding. Whether Meta accepts a private
   reply to a hidden comment is not something to find out from a lost sale. */

const read = (relativePath) => readFileSync(new URL(relativePath, import.meta.url), "utf8");
const runtime = read("../server/services/socialCommentAutomationService.js");
const worker = read("../server/services/backgroundJobs.js");

test("when a DM was queued this run, the runtime defers the hide instead of racing it", () => {
  const deferred = runtime.indexOf('status: "deferred", reason: "after_private_reply"');
  assert.ok(deferred > 0, "the runtime no longer defers the hide to the DM");
  const guard = runtime.lastIndexOf("if (hideCustomerCommentEnabled && privateReplyQueuedThisRun)", deferred);
  assert.ok(guard > 0 && deferred - guard < 400, "the deferral must be decided by a queued DM in THIS run");
  // The runtime's own hide call only exists in the branch where no DM is on its way.
  const directHide = runtime.indexOf("} else if (hideCustomerCommentEnabled) {", deferred);
  assert.ok(directHide > deferred, "the direct hide must be the fallback, not the first choice");
});

test("the DM job carries the hide as a top-level payload field", () => {
  assert.match(
    runtime,
    /enqueueSocialCommentPrivateReplyJob\(\{[\s\S]{0,300}hideAfterPrivateReply: hideCustomerCommentEnabled/,
    "the runtime has to tell the DM job to hide"
  );
  // Not inside row.automation_state: the worker re-reads the row, and the runtime keeps rewriting
  // automation_state after queueing, so a flag stored there can be gone by send time.
  assert.match(runtime, /hideAfterPrivateReply: hideAfterPrivateReply === true,/);
});

test("the worker hides only once the DM is settled, never while a retry is pending", () => {
  const calls = worker.match(/await hideCommentAfterPrivateReply\(/g) || [];
  assert.equal(calls.length, 3, `expected hides after sent, already_replied and final failure — found ${calls.length}`);
  assert.match(worker, /outcome: "sent"/);
  assert.match(worker, /outcome: "already_replied"/);

  // The failure-path hide must sit INSIDE the out-of-retries block, before anything can throw.
  const finalBlock = worker.indexOf("if (job?.attemptsMade >= (job?.maxAttempts || 1)) {");
  const finalHide = worker.indexOf('outcome: "failed_final"');
  assert.ok(finalBlock > 0 && finalHide > finalBlock, "the failure hide is outside the final-attempt block");
  assert.ok(finalHide - finalBlock < 400, "the failure hide must be the first thing the final-attempt block does");
});

test("the sent-path hide runs after the DM is recorded as sent", () => {
  const sentPersist = worker.indexOf('dmStatus: "sent",');
  const sentHide = worker.indexOf('outcome: "sent"');
  assert.ok(sentPersist > 0 && sentHide > sentPersist, "the comment must not be hidden before its DM is on record");
});

test("a failed hide can never fail or retry the DM job", () => {
  const start = worker.indexOf("const hideCommentAfterPrivateReply = async");
  assert.ok(start > 0, "the worker's hide helper is gone");
  const body = worker.slice(start, worker.indexOf("\n};", start));
  assert.match(body, /payload\?\.hideAfterPrivateReply !== true\) return;/, "it must do nothing unless asked");
  assert.match(body, /try \{[\s\S]*hideComment\([\s\S]*\} catch/, "the hide has to be caught, not thrown");
  assert.doesNotMatch(body, /throw /, "a moderation call after the DM must never throw out of the job");
});
