// Draft (inbox) upload terminal status.
//
// A real draft upload succeeded — TikTok issued a publish_id, took all 1.43MB,
// and reported SEND_TO_USER_INBOX — but the job stayed on "processing" forever
// and the composer polled without end. Cause: only PUBLISH_COMPLETE was treated
// as terminal, and that status requires the CREATOR to open TikTok and finish
// the post themselves. For an inbox upload our work ends at SEND_TO_USER_INBOX.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

process.env.TIKTOK_ENCRYPTION_KEY = process.env.TIKTOK_ENCRYPTION_KEY || "tiktok-test-encryption-key-0123456789";

const {
  TIKTOK_POST_MODES,
  TIKTOK_TERMINAL_JOB_STATUSES,
  resolveTikTokJobStatus,
} = await import("../../server/services/tiktokPublisherService.js");

const { tiktokStatusPresentation } = await import("../../src/modules/marketing/lib/tiktokPublishOptions.js");

const publisherSource = readFileSync(new URL("../../server/services/tiktokPublisherService.js", import.meta.url), "utf8");

const INBOX = TIKTOK_POST_MODES.INBOX_UPLOAD;
const DIRECT = TIKTOK_POST_MODES.DIRECT_POST;

// ---------------------------------------------------------------------------
// Inbox upload
// ---------------------------------------------------------------------------

test("INBOX_UPLOAD + SEND_TO_USER_INBOX becomes draft_ready", () => {
  assert.equal(
    resolveTikTokJobStatus({ postMode: INBOX, remoteStatus: "SEND_TO_USER_INBOX", currentStatus: "processing" }),
    "draft_ready"
  );
});

test("draft_ready is terminal on both sides, so polling stops", () => {
  assert.ok(TIKTOK_TERMINAL_JOB_STATUSES.includes("draft_ready"), "backend must treat draft_ready as terminal");
  const presentation = tiktokStatusPresentation("draft_ready");
  assert.equal(presentation.terminal, true, "the composer must stop polling once the draft is ready");
  assert.equal(presentation.tone, "success");
});

test("a draft that reached draft_ready is never walked back to processing", () => {
  // TikTok keeps reporting SEND_TO_USER_INBOX after delivery; re-resolving must
  // stay on draft_ready rather than oscillating and restarting the poll loop.
  assert.equal(
    resolveTikTokJobStatus({ postMode: INBOX, remoteStatus: "SEND_TO_USER_INBOX", currentStatus: "draft_ready" }),
    "draft_ready"
  );
});

test("an inbox upload still in transfer stays processing", () => {
  for (const remote of ["PROCESSING_UPLOAD", "PROCESSING_DOWNLOAD"]) {
    assert.equal(resolveTikTokJobStatus({ postMode: INBOX, remoteStatus: remote }), "processing", remote);
  }
});

test("a draft is never reported as published", () => {
  for (const remote of ["SEND_TO_USER_INBOX", "PUBLISH_COMPLETE"]) {
    assert.notEqual(
      resolveTikTokJobStatus({ postMode: INBOX, remoteStatus: remote }),
      "published",
      `${remote} on an inbox upload must not claim a live post`
    );
  }
});

// ---------------------------------------------------------------------------
// Direct Post is unchanged
// ---------------------------------------------------------------------------

test("DIRECT_POST + PUBLISH_COMPLETE still becomes published", () => {
  assert.equal(resolveTikTokJobStatus({ postMode: DIRECT, remoteStatus: "PUBLISH_COMPLETE" }), "published");
});

test("DIRECT_POST + SEND_TO_USER_INBOX must NOT become published", () => {
  const resolved = resolveTikTokJobStatus({ postMode: DIRECT, remoteStatus: "SEND_TO_USER_INBOX" });
  assert.notEqual(resolved, "published", "an inbox delivery is not a Direct Post outcome");
  assert.notEqual(resolved, "draft_ready", "a Direct Post job must not turn into a draft");
  assert.equal(resolved, "processing");
});

test("DIRECT_POST transfer and failure mapping is unchanged", () => {
  assert.equal(resolveTikTokJobStatus({ postMode: DIRECT, remoteStatus: "PROCESSING_UPLOAD" }), "processing");
  assert.equal(resolveTikTokJobStatus({ postMode: DIRECT, remoteStatus: "FAILED" }), "failed");
});

test("FAILED is terminal for both modes", () => {
  assert.equal(resolveTikTokJobStatus({ postMode: INBOX, remoteStatus: "FAILED" }), "failed");
  assert.equal(resolveTikTokJobStatus({ postMode: DIRECT, remoteStatus: "FAILED" }), "failed");
  assert.ok(TIKTOK_TERMINAL_JOB_STATUSES.includes("failed"));
});

test("an empty or unknown remote status leaves the job where it was", () => {
  assert.equal(resolveTikTokJobStatus({ postMode: INBOX, remoteStatus: "", currentStatus: "uploaded" }), "uploaded");
  assert.equal(resolveTikTokJobStatus({ postMode: DIRECT, remoteStatus: "SOMETHING_NEW" }), "processing");
});

// ---------------------------------------------------------------------------
// The status path must never re-upload
// ---------------------------------------------------------------------------

test("syncTikTokPublishStatus only reads status — it never uploads or re-inits", () => {
  const sync = publisherSource.split("export const syncTikTokPublishStatus")[1]?.split("export const listTikTokPublishJobs")[0] || "";
  assert.ok(sync.length > 0, "syncTikTokPublishStatus not found");
  assert.match(sync, /fetchTikTokPublishStatus/);
  for (const forbidden of ["uploadMediaFile", "uploadTikTokVideoChunk", "initTikTokDirectPost", "initTikTokDraftUpload", "resolveMediaFile"]) {
    assert.ok(!sync.includes(forbidden), `status sync must not call ${forbidden} — that would re-send the video`);
  }
});

test("the status query reuses the stored publish_id rather than creating a new one", () => {
  const sync = publisherSource.split("export const syncTikTokPublishStatus")[1]?.split("export const listTikTokPublishJobs")[0] || "";
  assert.match(sync, /publishId: job\.publish_id/);
  assert.match(sync, /if \(!text\(job\.publish_id\)\) return/, "a job with no publish_id must not be queried at all");
  assert.ok(!/INSERT INTO tiktok_publish_jobs/.test(sync), "status sync must not create a job");
});

test("resolveTikTokJobStatus is pure — it performs no IO", () => {
  const fn = publisherSource.split("export const resolveTikTokJobStatus")[1]?.split("export const syncTikTokPublishStatus")[0] || "";
  assert.ok(fn.length > 0);
  for (const forbidden of ["await", "client.query", "fetch"]) {
    assert.ok(!fn.includes(forbidden), `the resolver must stay pure (found ${forbidden})`);
  }
});
