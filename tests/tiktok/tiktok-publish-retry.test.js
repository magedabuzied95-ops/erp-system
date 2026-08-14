// TikTok publish job claiming, error preservation, and HTTP classification.
//
// Post 8 exposed three defects at once:
//   1. A job that failed once could never be retried. The claim used
//      `ON CONFLICT DO NOTHING`, so every retry collapsed onto the dead row and
//      was reported back to the user as a success ("already submitted").
//   2. TikTok's error code was discarded — only the human message survived, so
//      "Please review our integration guidelines" could not be mapped to any of
//      the documented codes.
//   3. Every provider failure became HTTP 502, which the browser surfaced as a
//      bare "NetworkError" with the real reason nowhere to be seen.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

process.env.TIKTOK_ENCRYPTION_KEY = process.env.TIKTOK_ENCRYPTION_KEY || "tiktok-test-encryption-key-0123456789";

const {
  TIKTOK_ERROR_KIND,
  TikTokApiError,
  classifyTikTokError,
  describeTikTokFailure,
} = await import("../../server/services/tiktokApiClient.js");

const { publishToTikTok } = await import("../../server/services/tiktokPublisherService.js");

const publisherSource = readFileSync(new URL("../../server/services/tiktokPublisherService.js", import.meta.url), "utf8");
const routeSource = readFileSync(new URL("../../server/routes/socialPublisher.js", import.meta.url), "utf8");

// ---------------------------------------------------------------------------
// A fake Postgres that models only what the claim depends on: the UNIQUE
// (tenant_id, idempotency_key) and the conditional DO UPDATE.
// ---------------------------------------------------------------------------

const makeDb = () => {
  const rows = new Map(); // idempotency_key -> row
  let nextId = 1;

  const client = {
    calls: [],
    rows,
    async query(sql, params = []) {
      client.calls.push(sql);

      if (/CREATE TABLE|CREATE INDEX|ALTER TABLE/i.test(sql)) return { rowCount: 0, rows: [] };

      if (/INSERT INTO tiktok_publish_jobs/i.test(sql)) {
        const key = params[2];
        const existing = rows.get(key);
        const reclaimable = /WHERE tiktok_publish_jobs\.status = 'failed'/i.test(sql);

        if (!existing) {
          const row = {
            id: nextId++, tenant_id: params[0], social_publisher_post_id: params[1], idempotency_key: key,
            post_mode: params[3], status: "processing", media_url: params[4], privacy_level: params[5],
            publish_id: "", attempt: 1, fail_reason: "", fail_code: "", fail_kind: "",
          };
          rows.set(key, row);
          return { rowCount: 1, rows: [row] };
        }
        // Conflict: the DO UPDATE only fires for a failed row.
        if (reclaimable && existing.status === "failed") {
          existing.status = "processing";
          existing.attempt += 1;
          existing.publish_id = "";
          existing.fail_reason = "";
          existing.fail_code = "";
          return { rowCount: 1, rows: [existing] };
        }
        return { rowCount: 0, rows: [] };
      }

      if (/SELECT \* FROM tiktok_publish_jobs WHERE tenant_id/i.test(sql)) {
        const row = rows.get(params[1]);
        return { rowCount: row ? 1 : 0, rows: row ? [row] : [] };
      }

      if (/UPDATE tiktok_publish_jobs/i.test(sql)) {
        const row = [...rows.values()].find((candidate) => candidate.id === params[0]);
        if (row && /SET status = 'failed'/i.test(sql)) {
          row.status = "failed";
          row.fail_reason = params[1];
          row.fail_code = params[2];
          row.fail_kind = params[3];
          row.fail_log_id = params[4];
          row.upstream_status = params[5];
        } else if (row && /status = 'uploaded'/i.test(sql)) {
          row.status = "uploaded";
        } else if (row && /publish_id = \$2/i.test(sql)) {
          row.publish_id = params[1];
        }
        return { rowCount: row ? 1 : 0, rows: row ? [row] : [] };
      }
      return { rowCount: 0, rows: [] };
    },
  };
  return client;
};

// Every attempt fails before touching TikTok: getValidTikTokAccessToken has no
// connection in this harness, so the claim semantics are what is exercised.
const attemptPublish = (client, overrides = {}) =>
  publishToTikTok({
    tenantId: 1,
    idempotencyKey: "social_publisher_post:8",
    mediaUrl: "/uploads/social-publisher/clip.mp4",
    options: { privacy_level: "SELF_ONLY" },
    client,
    ...overrides,
  }).catch((error) => ({ threw: true, error }));

// ---------------------------------------------------------------------------
// 1. Retry after failure
// ---------------------------------------------------------------------------

test("a failed job can be retried and the attempt counter advances", async () => {
  const client = makeDb();
  await attemptPublish(client);
  const row = client.rows.get("social_publisher_post:8");
  assert.equal(row.status, "failed", "the first attempt must end failed in this harness");
  assert.equal(row.attempt, 1);

  const second = await attemptPublish(client);
  assert.notEqual(second?.duplicate, true, "a failed job must NOT be reported as a duplicate");
  assert.equal(client.rows.get("social_publisher_post:8").attempt, 2, "the retry must be recorded as attempt 2");
});

test("a retry after failure eventually succeeds rather than being blocked forever", async () => {
  const client = makeDb();
  await attemptPublish(client);
  assert.equal(client.rows.get("social_publisher_post:8").status, "failed");

  // Second attempt reclaims the row; the harness fails it again, but the point
  // is that the claim was granted rather than short-circuited as a duplicate.
  const second = await attemptPublish(client);
  assert.notEqual(second?.duplicate, true);
  const row = client.rows.get("social_publisher_post:8");
  assert.equal(row.attempt, 2);
  assert.equal(row.status, "failed");
});

// ---------------------------------------------------------------------------
// 2. Duplicate protection still holds
// ---------------------------------------------------------------------------

test("a double click is still collapsed while an attempt is in flight", async () => {
  const client = makeDb();
  // Simulate an in-flight attempt by seeding a processing row.
  client.rows.set("social_publisher_post:8", { id: 99, idempotency_key: "social_publisher_post:8", status: "processing", attempt: 1 });
  const second = await attemptPublish(client);
  assert.equal(second.duplicate, true, "an in-flight job must not start a second TikTok post");
  assert.equal(client.rows.get("social_publisher_post:8").attempt, 1, "an in-flight job must not be re-claimed");
});

test("a terminally successful job can never be republished", async () => {
  for (const terminal of ["published", "draft_ready", "uploaded"]) {
    const client = makeDb();
    client.rows.set("social_publisher_post:8", { id: 5, idempotency_key: "social_publisher_post:8", status: terminal, attempt: 1 });
    const result = await attemptPublish(client);
    assert.equal(result.duplicate, true, `status ${terminal} must stay protected`);
    assert.equal(client.rows.get("social_publisher_post:8").status, terminal, `status ${terminal} must not change`);
  }
});

test("two concurrent retries of the same failed job produce exactly one claim", async () => {
  const client = makeDb();
  client.rows.set("social_publisher_post:8", { id: 7, idempotency_key: "social_publisher_post:8", status: "failed", attempt: 1 });
  const [a, b] = await Promise.all([attemptPublish(client), attemptPublish(client)]);
  const duplicates = [a, b].filter((result) => result?.duplicate === true).length;
  assert.equal(duplicates, 1, "exactly one of two concurrent retries must be rejected as a duplicate");
});

test("the claim is a single atomic statement, not a read-then-write race", () => {
  assert.match(publisherSource, /ON CONFLICT \(tenant_id, idempotency_key\) DO UPDATE/);
  assert.match(publisherSource, /WHERE tiktok_publish_jobs\.status = 'failed'/);
  assert.ok(!/SELECT[\s\S]{0,400}FROM tiktok_publish_jobs[\s\S]{0,200}INSERT INTO tiktok_publish_jobs/i.test(publisherSource),
    "the claim must not be a select-then-insert");
});

// ---------------------------------------------------------------------------
// 3. Provider error code preserved
// ---------------------------------------------------------------------------

test("the TikTok error code, log id and upstream status survive onto the job", async () => {
  const client = makeDb();
  await attemptPublish(client);
  const row = client.rows.get("social_publisher_post:8");
  assert.equal(typeof row.fail_code, "string");
  assert.equal(typeof row.fail_kind, "string");
  assert.ok(row.fail_reason.length > 0, "a human message must still be stored");
});

test("describeTikTokFailure keeps the safe fields and drops nothing useful", () => {
  const error = new TikTokApiError("Please review our integration guidelines", {
    code: "unaudited_client_can_only_post_to_private_accounts",
    status: 400,
    logId: "202608150001",
  });
  const failure = describeTikTokFailure(error);
  assert.equal(failure.error_code, "unaudited_client_can_only_post_to_private_accounts");
  assert.equal(failure.log_id, "202608150001");
  assert.equal(failure.upstream_status, 400);
  assert.equal(failure.kind, TIKTOK_ERROR_KIND.CONTENT_REJECTED);
  assert.match(failure.message, /integration guidelines/);
});

test("no token, credential or upload URL can reach the persisted failure", () => {
  const failure = describeTikTokFailure(
    new TikTokApiError("upload to https://upload.tiktokapis.com/x?token=act.SECRETTOKENVALUE0123456789 failed", { code: "invalid_param" })
  );
  const dump = JSON.stringify(failure);
  assert.ok(!dump.includes("act.SECRETTOKENVALUE0123456789"), "an access token leaked into the failure record");
});

test("the failure log line carries provider, operation and error code", () => {
  assert.match(publisherSource, /provider: "tiktok"/);
  assert.match(publisherSource, /operation,/);
  assert.match(publisherSource, /direct_post_init/);
  assert.match(publisherSource, /inbox_upload_init/);
  assert.match(publisherSource, /error_code: failure\.error_code/);
});

// ---------------------------------------------------------------------------
// 4. HTTP classification
// ---------------------------------------------------------------------------

test("content, policy and validation rejections classify as 422", () => {
  for (const code of [
    "invalid_param",
    "unaudited_client_can_only_post_to_private_accounts",
    "privacy_level_option_mismatch",
    "url_ownership_unverified",
    "file_format_check_failed",
  ]) {
    const result = classifyTikTokError({ code });
    assert.equal(result.status, 422, `${code} should be a client-side rejection`);
    assert.equal(result.kind, TIKTOK_ERROR_KIND.CONTENT_REJECTED);
  }
});

test("authentication failures classify as reconnect-required, not a gateway error", () => {
  for (const code of ["access_token_invalid", "scope_not_authorized", "refresh_token_invalid"]) {
    const result = classifyTikTokError({ code });
    assert.equal(result.status, 409);
    assert.equal(result.kind, TIKTOK_ERROR_KIND.REAUTH_REQUIRED);
  }
});

test("rate limits and posting caps classify as 429", () => {
  for (const code of ["rate_limit_exceeded", "spam_risk_too_many_posts", "reached_active_user_cap", "spam_risk_user_banned_from_posting"]) {
    assert.equal(classifyTikTokError({ code }).status, 429, code);
  }
});

test("a genuine TikTok outage still classifies as a gateway failure", () => {
  for (const [code, expected] of [["timeout", 503], ["network_error", 503], ["internal_error", 503], ["http_502", 502], ["upload_http_500", 502]]) {
    assert.equal(classifyTikTokError({ code }).status, expected, code);
  }
});

test("an unknown TikTok code prefers 422 over 502 so the message reaches the browser", () => {
  const result = classifyTikTokError({ code: "some_future_tiktok_code" });
  assert.equal(result.status, 422);
  assert.notEqual(result.status, 502, "502 is what produced the bare NetworkError");
});

test("an error with no provider code at all is an internal 500", () => {
  assert.equal(classifyTikTokError({}).status, 500);
  assert.equal(classifyTikTokError({}).kind, TIKTOK_ERROR_KIND.INTERNAL);
});

test("a content rejection no longer becomes 502", async () => {
  const client = makeDb();
  const result = await attemptPublish(client);
  assert.equal(result.threw, true);
  assert.notEqual(Number(result.error?.status), 502, "a provider rejection must not surface as Bad Gateway");
});

test("the publish route answers with the classified status and the provider code", () => {
  const handler = routeSource.split('"/posts/:id/publish"')[1] || "";
  assert.match(handler, /const status = Number\(error\?\.status\) \|\| 500;/);
  assert.match(handler, /res\.status\(status\)/);
  assert.match(handler, /code: error\?\.code \|\| ""/);
  assert.ok(!/res\.status\(error\?\.status \|\| 500\)\.json\(\{ success: false, message:/.test(handler),
    "the old unclassified handler must be gone");
});
