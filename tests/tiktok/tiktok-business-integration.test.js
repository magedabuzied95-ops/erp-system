// TikTok API for Business integration tests.
//
// Fully offline and deterministic: no credentials, no network, no database.
// The integration is dormant by design, so most of these tests assert that it
// STAYS dormant and that dormancy is expressed honestly — a typed error rather
// than an empty list, and a declared capability rather than a silent no-op.
//
// The three properties worth protecting here:
//   1. The Business app and the Content Posting app never share a credential,
//      a token, or an encryption namespace.
//   2. No code path can fabricate a conversation or a comment.
//   3. No unverified TikTok endpoint is ever presented as verified.

import assert from "node:assert/strict";
import test from "node:test";

// Deliberately give each app its own distinct credentials. If either layer ever
// reaches for the other's secret, these values make the leak visible instead of
// silently succeeding on shared material.
process.env.SECRET_ENCRYPTION_KEY = process.env.SECRET_ENCRYPTION_KEY || "tiktok-test-encryption-key";
process.env.TIKTOK_CLIENT_KEY = "content-posting-client-key";
process.env.TIKTOK_CLIENT_SECRET = "content-posting-client-secret";

// Both TikTok crypto services now require their OWN dedicated key with no
// fallback — Content Posting reads TIKTOK_ENCRYPTION_KEY, Business reads
// TIKTOK_BUSINESS_ENCRYPTION_KEY. Neither accepts SECRET_ENCRYPTION_KEY or
// JWT_SECRET, so both must be set explicitly for any encryption test. Each is
// long and varied enough to clear its strength gate, and they are different
// from each other so a cross-namespace decrypt cannot accidentally succeed.
const CONTENT_KEY = "c4a81ff2e07b365d9ac1428e6b0d7f3915ca62db8e";
const BUSINESS_KEY = "b7f3c1a9e5d24086bf1c73ae90d5218c4437fe6bqz";
process.env.TIKTOK_ENCRYPTION_KEY = CONTENT_KEY;
process.env.TIKTOK_BUSINESS_ENCRYPTION_KEY = BUSINESS_KEY;

// Runs fn with the given env vars applied, then restores exactly what was there
// (including "was not set at all", which is the case these tests care about).
//
// Promise-aware on purpose: a plain try/finally restores the environment as soon
// as an async fn returns its promise, i.e. BEFORE the awaited body runs, so the
// override silently does nothing. Chaining off the thenable is what makes the
// async dormancy test meaningful.
const withEnv = (overrides, fn) => {
  const previous = new Map();
  for (const [name, value] of Object.entries(overrides)) {
    previous.set(name, process.env[name]);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  const restore = () => {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  };
  let result;
  try {
    result = fn();
  } catch (error) {
    restore();
    throw error;
  }
  if (result && typeof result.then === "function") return result.finally(restore);
  restore();
  return result;
};

const businessCrypto = await import("../../server/services/tiktokBusinessCryptoService.js");
const contentCrypto = await import("../../server/services/tiktokCryptoService.js");
const businessConfig = await import("../../server/services/tiktokBusinessConfigService.js");
const messaging = await import("../../server/services/tiktokBusinessMessagingProvider.js");
const comments = await import("../../server/services/tiktokBusinessCommentsProvider.js");
const webhook = await import("../../server/routes/tiktokBusinessWebhook.js");

// ---------------------------------------------------------------------------
// Architecture: the two TikTok integrations are separate
// ---------------------------------------------------------------------------

test("Business config never reads TikTok Content Posting credentials", () => {
  const described = businessConfig.describeTikTokBusinessConfig();
  const serialized = JSON.stringify(described);

  assert.ok(
    !serialized.includes("content-posting-client-key"),
    "the Content Posting client key must never appear in Business config"
  );
  assert.ok(
    !serialized.includes("content-posting-client-secret"),
    "the Content Posting client secret must never appear in Business config"
  );
  // The Business app id is genuinely absent (app is PENDING), and the config
  // must report that rather than borrowing the other app's key.
  assert.equal(described.app_id_present, false);
  assert.equal(described.app_secret_present, false);
  assert.equal(described.configured, false);
});

test("Business config points at business-api.tiktok.com, not the Content Posting host", () => {
  const described = businessConfig.describeTikTokBusinessConfig();
  assert.match(described.api_base, /business-api\.tiktok\.com/);
  assert.ok(
    !described.api_base.includes("open.tiktokapis.com"),
    "open.tiktokapis.com is the TikTok for Developers host and is a different API"
  );
});

test("a Content Posting token cannot be decrypted by the Business namespace", () => {
  const token = "act.example-access-token";
  const contentEnvelope = contentCrypto.encryptTikTokSecret(token);

  assert.ok(contentEnvelope.startsWith("tk:v1:"));
  assert.throws(
    () => businessCrypto.decryptTikTokBusinessSecret(contentEnvelope),
    (error) => error?.code === "TIKTOK_BUSINESS_ENVELOPE_INVALID",
    "a tk:v1 envelope must be rejected by the Business decryptor"
  );
});

test("a Business token cannot be decrypted by the Content Posting namespace", () => {
  const token = "business-access-token";
  const businessEnvelope = businessCrypto.encryptTikTokBusinessSecret(token);

  assert.ok(businessEnvelope.startsWith("tkb:v1:"));
  assert.throws(
    () => contentCrypto.decryptTikTokSecret(businessEnvelope),
    (error) => error?.code === "TIKTOK_ENVELOPE_INVALID",
    "a tkb:v1 envelope must be rejected by the Content Posting decryptor"
  );
});

test("Business encryption round-trips within its own namespace", () => {
  const token = "business-access-token";
  const envelope = businessCrypto.encryptTikTokBusinessSecret(token);
  assert.notEqual(envelope, token, "the token must not be stored in plaintext");
  assert.ok(!envelope.includes(token), "ciphertext must not contain the plaintext");
  assert.equal(businessCrypto.decryptTikTokBusinessSecret(envelope), token);
});

test("even on identical key material the two namespaces derive different keys", () => {
  // An operator could set both TikTok key variables to the same string. Domain
  // separation (each envelope prefix is mixed into its own digest) must still
  // hold, so neither side can read the other's ciphertext.
  withEnv({ TIKTOK_BUSINESS_ENCRYPTION_KEY: BUSINESS_KEY, TIKTOK_ENCRYPTION_KEY: BUSINESS_KEY }, () => {
    const plain = "same-token-both-sides";
    const a = businessCrypto.encryptTikTokBusinessSecret(plain);
    const b = contentCrypto.encryptTikTokSecret(plain);
    assert.ok(a.startsWith("tkb:v1:"));
    assert.ok(b.startsWith("tk:v1:"));
    assert.throws(() => contentCrypto.decryptTikTokSecret(a));
    assert.throws(() => businessCrypto.decryptTikTokBusinessSecret(b));
  });
});

// ---------------------------------------------------------------------------
// Encryption key isolation: dedicated key, no fallback of any kind
// ---------------------------------------------------------------------------

test("no fallback to JWT_SECRET", () => {
  withEnv(
    {
      TIKTOK_BUSINESS_ENCRYPTION_KEY: undefined,
      SECRET_ENCRYPTION_KEY: undefined,
      JWT_SECRET: "a-perfectly-long-jwt-secret-value-9f3c2a71",
    },
    () => {
      assert.equal(
        businessCrypto.tiktokBusinessEncryptionKeyConfigured(),
        false,
        "JWT_SECRET must not satisfy the Business key requirement"
      );
      assert.throws(
        () => businessCrypto.encryptTikTokBusinessSecret("token"),
        (error) => error.code === "TIKTOK_BUSINESS_ENCRYPTION_KEY_MISSING"
      );
    }
  );
});

test("no fallback to SECRET_ENCRYPTION_KEY", () => {
  withEnv(
    {
      TIKTOK_BUSINESS_ENCRYPTION_KEY: undefined,
      SECRET_ENCRYPTION_KEY: "a-perfectly-long-platform-secret-4b81de07",
    },
    () => {
      assert.equal(businessCrypto.tiktokBusinessEncryptionKeyConfigured(), false);
      assert.throws(
        () => businessCrypto.encryptTikTokBusinessSecret("token"),
        (error) => error.code === "TIKTOK_BUSINESS_ENCRYPTION_KEY_MISSING"
      );
    }
  );
});

test("no fallback to TIKTOK_ENCRYPTION_KEY", () => {
  withEnv(
    {
      TIKTOK_BUSINESS_ENCRYPTION_KEY: undefined,
      SECRET_ENCRYPTION_KEY: undefined,
      TIKTOK_ENCRYPTION_KEY: "a-perfectly-long-content-posting-key-1c9a",
    },
    () => {
      assert.equal(businessCrypto.tiktokBusinessEncryptionKeyConfigured(), false);
      assert.throws(
        () => businessCrypto.encryptTikTokBusinessSecret("token"),
        (error) => error.code === "TIKTOK_BUSINESS_ENCRYPTION_KEY_MISSING"
      );
    }
  );
});

test("the crypto module reads exactly one environment variable", async () => {
  const source = await import("node:fs/promises").then((fs) =>
    fs.readFile(
      new URL("../../server/services/tiktokBusinessCryptoService.js", import.meta.url),
      "utf8"
    )
  );
  const reads = [...source.matchAll(/process\.env\.([A-Z0-9_]+)/g)].map((match) => match[1]);
  assert.deepEqual(
    [...new Set(reads)],
    ["TIKTOK_BUSINESS_ENCRYPTION_KEY"],
    "the Business crypto service must read no other secret"
  );
});

test("a weak key fails closed with its own code, distinct from missing", () => {
  const weakKeys = [
    "short",                                  // under the length floor
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", // long but almost no entropy
    "TIKTOK_BUSINESS_ENCRYPTION_KEY",         // the variable name as its value
    "change-me-change-me-change-me-change-me",// obvious placeholder
  ];
  for (const key of weakKeys) {
    withEnv({ TIKTOK_BUSINESS_ENCRYPTION_KEY: key }, () => {
      assert.equal(businessCrypto.tiktokBusinessEncryptionKeyConfigured(), false, `"${key}" must be rejected`);
      assert.throws(
        () => businessCrypto.encryptTikTokBusinessSecret("token"),
        (error) => {
          assert.equal(error.code, "TIKTOK_BUSINESS_ENCRYPTION_KEY_WEAK", `"${key}" must be WEAK, not MISSING`);
          return true;
        }
      );
    });
  }
});

test("key diagnostics never echo the key", () => {
  withEnv({ TIKTOK_BUSINESS_ENCRYPTION_KEY: BUSINESS_KEY }, () => {
    const described = businessCrypto.describeTikTokBusinessEncryptionKey();
    assert.deepEqual(described, { ok: true, code: "" });
    const serialized = JSON.stringify(businessConfig.describeTikTokBusinessConfig());
    assert.ok(!serialized.includes(BUSINESS_KEY), "status must not echo the encryption key");
    // Presence and a code, never the value.
    assert.match(serialized, /"encryption_key_configured":true/);
    assert.match(serialized, /"encryption_key_code":""/);
  });
});

// ---------------------------------------------------------------------------
// Dormancy: a missing key must not affect a disabled deployment
// ---------------------------------------------------------------------------

test("a disabled integration with no key at all does not throw at startup", async () => {
  await withEnv(
    {
      TIKTOK_BUSINESS_ENABLED: undefined,
      TIKTOK_BUSINESS_ENCRYPTION_KEY: undefined,
      SECRET_ENCRYPTION_KEY: undefined,
      JWT_SECRET: undefined,
    },
    async () => {
      // Everything the boot path and the status route actually call must be safe.
      assert.doesNotThrow(() => businessConfig.describeTikTokBusinessConfig());
      assert.doesNotThrow(() => businessConfig.validateTikTokBusinessConfig());
      assert.doesNotThrow(() => businessCrypto.describeTikTokBusinessEncryptionKey());
      assert.doesNotThrow(() => businessCrypto.tiktokBusinessEncryptionKeyConfigured());
      assert.doesNotThrow(() => businessConfig.tiktokBusinessEnabled());

      // Re-importing the module (a cold boot) must not throw either: nothing
      // reads key material at import time.
      const reimported = await import(
        `../../server/services/tiktokBusinessCryptoService.js?dormant=${Date.now()}`
      );
      assert.equal(reimported.tiktokBusinessEncryptionKeyConfigured(), false);

      // And the integration reports itself unavailable rather than broken.
      assert.equal(businessConfig.tiktokBusinessEnabled(), false);
      assert.throws(
        () => businessConfig.assertTikTokBusinessReady("messaging"),
        (error) => error.code === "TIKTOK_BUSINESS_DISABLED",
        "a disabled integration reports DISABLED, not a key error"
      );
    }
  );
});

test("enabled without a key fails closed with TIKTOK_BUSINESS_ENCRYPTION_KEY_MISSING", () => {
  withEnv(
    {
      TIKTOK_BUSINESS_ENABLED: "true",
      TIKTOK_BUSINESS_ENCRYPTION_KEY: undefined,
      SECRET_ENCRYPTION_KEY: "a-perfectly-long-platform-secret-4b81de07",
      JWT_SECRET: "a-perfectly-long-jwt-secret-value-9f3c2a71",
    },
    () => {
      // The other secrets are present and long. They must not rescue it.
      assert.throws(
        () => businessConfig.assertTikTokBusinessReady("comments"),
        (error) => {
          assert.equal(error.code, "TIKTOK_BUSINESS_ENCRYPTION_KEY_MISSING");
          assert.equal(error.status, 503);
          return true;
        }
      );
      const { valid, problems } = businessConfig.validateTikTokBusinessConfig();
      assert.equal(valid, false);
      assert.ok(problems.some((problem) => problem.includes("TIKTOK_BUSINESS_ENCRYPTION_KEY_MISSING")));
    }
  );
});

test("enabled with a weak key fails closed with TIKTOK_BUSINESS_ENCRYPTION_KEY_WEAK", () => {
  withEnv({ TIKTOK_BUSINESS_ENABLED: "true", TIKTOK_BUSINESS_ENCRYPTION_KEY: "short" }, () => {
    assert.throws(
      () => businessConfig.assertTikTokBusinessReady("comments"),
      (error) => error.code === "TIKTOK_BUSINESS_ENCRYPTION_KEY_WEAK"
    );
    const { problems } = businessConfig.validateTikTokBusinessConfig();
    assert.ok(problems.some((problem) => problem.includes("TIKTOK_BUSINESS_ENCRYPTION_KEY_WEAK")));
  });
});

// ---------------------------------------------------------------------------
// Messaging: unavailable, and honest about it
// ---------------------------------------------------------------------------

test("messaging declares the waiting state, not a connected or empty one", () => {
  const state = messaging.TIKTOK_BUSINESS_MESSAGING_STATE;
  assert.equal(state.status, "WAITING_FOR_TIKTOK_BUSINESS_MESSAGING_PERMISSION");
  assert.equal(state.available, false);
  assert.equal(state.polling_enabled, false);
  assert.equal(state.webhook_registered, false);
  assert.ok(state.prerequisites.length >= 4);
  // 2026-08-28: the developer app IS approved (Account Comment), so the first
  // two prerequisites flipped to satisfied — but the two that actually gate
  // messaging (the privacy review and the messaging permission itself) must
  // remain unsatisfied, and the overall state must remain waiting.
  const bySatisfaction = Object.fromEntries(state.prerequisites.map((item) => [item.key, item.satisfied]));
  assert.equal(bySatisfaction.data_security_privacy_review, false);
  assert.equal(bySatisfaction.business_messaging_permission, false);
});

test("every network-facing messaging method throws instead of returning []", async () => {
  const operations = [
    "listConversations",
    "listMessages",
    "sendMessage",
    "uploadMedia",
    "downloadMedia",
  ];
  for (const operation of operations) {
    await assert.rejects(
      () => messaging.tiktokBusinessMessagingProvider[operation](),
      (error) => {
        assert.equal(
          error.code,
          "WAITING_FOR_TIKTOK_BUSINESS_MESSAGING_PERMISSION",
          `${operation} must fail with the typed permission code`
        );
        assert.equal(error.status, 501);
        assert.equal(error.retryable, false);
        return true;
      },
      `${operation} must not resolve — an empty result would read as "no messages"`
    );
  }
});

test("enabling the flag alone cannot open a live messaging path", async () => {
  const previous = process.env.TIKTOK_BUSINESS_MESSAGING_ENABLED;
  process.env.TIKTOK_BUSINESS_MESSAGING_ENABLED = "true";
  try {
    // The wire contract is still unverified, so the second gate must hold even
    // though an operator turned the feature on.
    assert.equal(messaging.TIKTOK_BUSINESS_MESSAGING_WIRE.verified, false);
    await assert.rejects(
      () => messaging.tiktokBusinessMessagingProvider.sendMessage({ body: "hello" }),
      (error) => error.code === "WAITING_FOR_TIKTOK_BUSINESS_MESSAGING_PERMISSION"
    );
  } finally {
    if (previous === undefined) delete process.env.TIKTOK_BUSINESS_MESSAGING_ENABLED;
    else process.env.TIKTOK_BUSINESS_MESSAGING_ENABLED = previous;
  }
});

test("no messaging capability is advertised as available", () => {
  const capabilities = messaging.tiktokBusinessMessagingProvider.capabilities;
  for (const [name, value] of Object.entries(capabilities)) {
    assert.notEqual(value, true, `capability "${name}" must not be advertised as available`);
  }
  // Reply window is unknown, not "unlimited" — TikTok is expected to impose one.
  assert.equal(capabilities.reply_window, null);
});

test("messaging normalizers map onto canonical AI Inbox rows", () => {
  const normalized = messaging.normalizeInboundMessage({
    conversation_id: "conv-1",
    message_id: "msg-1",
    sender_id: "user-9",
    content: "  hello  ",
    create_time: 1_755_000_000,
    attachments: [
      { type: "image", url: "https://example.test/a.jpg" },
      { type: "image" }, // unfetchable: no url and no media_id
    ],
  });

  assert.equal(normalized.channel, "tiktok_business_message");
  assert.equal(normalized.external_conversation_id, "conv-1");
  assert.equal(normalized.external_message_id, "msg-1");
  assert.equal(normalized.body, "hello");
  assert.equal(normalized.direction, "inbound");
  assert.equal(normalized.created_at, new Date(1_755_000_000_000).toISOString());
  assert.equal(normalized.attachments.length, 1, "an unfetchable attachment must be dropped");
});

test("messaging normalizers refuse to invent identity", () => {
  assert.equal(messaging.normalizeInboundMessage({ content: "orphan" }), null);
  assert.equal(messaging.normalizeConversation({ nickname: "nobody" }), null);
  assert.equal(messaging.inboundIdempotencyKey({ conversation_id: "c" }), "");
});

test("messaging idempotency keys are stable and channel-scoped", () => {
  const raw = { conversation_id: "conv-1", message_id: "msg-1" };
  assert.equal(messaging.inboundIdempotencyKey(raw), "tiktok_business:conv-1:msg-1");
  assert.equal(messaging.inboundIdempotencyKey(raw), messaging.inboundIdempotencyKey({ ...raw }));
});

// ---------------------------------------------------------------------------
// Comments: implemented (2026-08-28), gated by runtime capability
// ---------------------------------------------------------------------------

test("comments are gated by runtime capability, and DISABLED while flags are off", async () => {
  // TIKTOK_BUSINESS_ENABLED / TIKTOK_BUSINESS_COMMENTS_ENABLED are unset in
  // this suite, so the capability ladder must stop at DISABLED without touching
  // the database or the network.
  const capability = await comments.describeTikTokBusinessCommentsCapability({ tenantId: 1 });
  assert.equal(capability.status, "DISABLED");
  assert.equal(capability.available, false);
});

test("every network-facing comment method throws instead of returning []", async () => {
  // Returning [] would render as "this video has no comments" — a false claim.
  for (const operation of ["listVideos", "listComments", "listReplies", "createReply"]) {
    await assert.rejects(
      () => comments.tiktokBusinessCommentsProvider[operation]({ tenantId: 1, videoId: "v", commentId: "c", text: "x" }),
      (error) => error.name === "TikTokBusinessCommentsUnavailableError" && error.status === 501,
      `${operation} must fail typed while the feature is disabled`
    );
  }
});

test("comment normalizer maps the documented v1.3 fields onto the canonical row", () => {
  const row = comments.normalizeComment({
    comment_id: "c-1",
    video_id: "v-1",
    unique_identifier: "+ABc1D2/stable",
    user_id: "deprecated-user-id",
    username: "feather_in_the_w1nd",
    display_name: "Feather in the wind",
    profile_image: "https://p16-sign-va.tiktokcdn.com/avatar.jpeg?x-expires=1",
    text: " nice shoes ",
    create_time: 1_755_000_000,
    likes: 4,
    replies: 2,
    status: "PUBLIC",
    owner: false,
    liked: true,
    pinned: false,
  });

  assert.equal(row.platform, "tiktok");
  assert.equal(row.channel, "tiktok_comment");
  assert.equal(row.external_message_id, "c-1");
  assert.equal(row.external_conversation_id, "v-1");
  // unique_identifier is the stable cross-API id and must win over the
  // deprecated user_id.
  assert.equal(row.external_customer_id, "+ABc1D2/stable");
  assert.equal(row.customer_name, "Feather in the wind");
  assert.equal(row.customer_username, "feather_in_the_w1nd");
  assert.equal(row.parent_external_message_id, null);
  assert.equal(row.is_reply, false);
  assert.equal(row.body, "nice shoes");
  assert.equal(row.like_count, 4);
  assert.equal(row.reply_count, 2);
  // PUBLIC/HIDDEN are documented and definitive.
  assert.equal(row.is_hidden, false);
  assert.equal(row.is_pinned, false);
  assert.equal(row.is_liked_by_owner, true);
});

test("moderation state stays unknown when TikTok does not send it", () => {
  const row = comments.normalizeComment({ comment_id: "c-9", video_id: "v-1", text: "hi" });
  assert.equal(row.is_hidden, null, "no status field means unknown, never 'not hidden'");
  assert.equal(row.is_pinned, null);
  assert.equal(row.is_liked_by_owner, null);
  const hidden = comments.normalizeComment({ comment_id: "c-10", video_id: "v-1", status: "HIDDEN" });
  assert.equal(hidden.is_hidden, true);
});

test("comment normalizer derives reply mapping from the parent id", () => {
  const reply = comments.normalizeComment({
    comment_id: "c-2",
    parent_comment_id: "c-1",
    video_id: "v-1",
    text: "thanks!",
  });
  assert.equal(reply.parent_external_message_id, "c-1");
  assert.equal(reply.is_reply, true);
});

test("comment normalizer refuses an id-less payload", () => {
  assert.equal(comments.normalizeComment({ text: "orphan" }), null);
  assert.equal(comments.commentIdempotencyKey({ video_id: "v-1" }), "");
});

test("pagination never advances a cursor without has_more", () => {
  // The documented envelope is { comments, cursor, has_more } — flat, not a
  // page_info object (that was the pre-approval guess).
  assert.deepEqual(
    comments.parseCommentPage({ cursor: 30, has_more: true }),
    { cursor: "30", has_more: true }
  );
  // A cursor present but has_more false must not be followed: that is how a
  // poll loop becomes infinite.
  assert.deepEqual(
    comments.parseCommentPage({ cursor: 30, has_more: false }),
    { cursor: "", has_more: false }
  );
  assert.deepEqual(comments.parseCommentPage({}), { cursor: "", has_more: false });
});

test("the ads comment API is not mistaken for the organic one", async () => {
  const { TIKTOK_BUSINESS_PATHS } = await import("../../server/services/tiktokBusinessApiClient.js");
  for (const [name, path] of Object.entries(TIKTOK_BUSINESS_PATHS)) {
    if (!/COMMENT|VIDEO|ACCOUNT/.test(name)) continue;
    assert.ok(
      path.startsWith("/business/"),
      `${name} (${path}) must be a business/* organic path, not an advertiser_id ads path`
    );
  }
});


// ---------------------------------------------------------------------------
// No unverified contract is presented as verified
// ---------------------------------------------------------------------------

test("messaging wire stays unverified; the webhook contract is now documented", () => {
  // Messaging is still a guess — its docs live behind a grant we do not hold.
  assert.equal(messaging.TIKTOK_BUSINESS_MESSAGING_WIRE.verified, false);
  // The webhook contract was read from TikTok's Webhook-verification doc on
  // 2026-08-28 and implemented for real.
  assert.equal(webhook.TIKTOK_BUSINESS_WEBHOOK_CONTRACT.verified, true);
});

test("the Business webhook signs with the Business app secret, never the Content Posting client secret", () => {
  const contract = webhook.TIKTOK_BUSINESS_WEBHOOK_CONTRACT;
  assert.equal(contract.signing_secret_source, "TIKTOK_BUSINESS_APP_SECRET");
  assert.equal(contract.signature_header, "tiktok-signature");
  assert.equal(contract.requires_raw_body, true);
});

test("business webhook signature verification accepts a genuine payload and rejects forgeries", async () => {
  const { createHmac } = await import("node:crypto");
  const secret = "business-webhook-secret";
  const body = JSON.stringify({ event: "comment.update", create_time: 1_755_000_000 });
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac("sha256", secret).update(`${timestamp}.${body}`, "utf8").digest("hex");
  const header = `t=${timestamp},s=${signature}`;

  // Genuine: passes and returns the timestamp.
  assert.deepEqual(
    webhook.verifyBusinessWebhookSignature({ header, rawBody: body, secret }),
    { timestamp }
  );
  // Wrong key: rejected.
  assert.throws(
    () => webhook.verifyBusinessWebhookSignature({ header, rawBody: body, secret: "another-secret" }),
    (error) => error.code === "TIKTOK_BUSINESS_WEBHOOK_SIGNATURE_INVALID"
  );
  // Tampered body: rejected.
  assert.throws(
    () => webhook.verifyBusinessWebhookSignature({ header, rawBody: `${body} `, secret }),
    (error) => error.code === "TIKTOK_BUSINESS_WEBHOOK_SIGNATURE_INVALID"
  );
  // Replay outside the window: the timestamp is inside the signed payload, so
  // an attacker cannot refresh it without invalidating the signature.
  const oldTimestamp = timestamp - 3_600;
  const oldSignature = createHmac("sha256", secret).update(`${oldTimestamp}.${body}`, "utf8").digest("hex");
  assert.throws(
    () => webhook.verifyBusinessWebhookSignature({ header: `t=${oldTimestamp},s=${oldSignature}`, rawBody: body, secret }),
    (error) => error.code === "TIKTOK_BUSINESS_WEBHOOK_REPLAY"
  );
  // Malformed header / missing secret: typed refusals, never a boolean.
  assert.throws(
    () => webhook.verifyBusinessWebhookSignature({ header: "garbage", rawBody: body, secret }),
    (error) => error.code === "TIKTOK_BUSINESS_WEBHOOK_SIGNATURE_MALFORMED"
  );
  assert.throws(
    () => webhook.verifyBusinessWebhookSignature({ header, rawBody: body, secret: "" }),
    (error) => error.code === "TIKTOK_BUSINESS_WEBHOOK_SECRET_MISSING"
  );
});

test("webhook event key survives ids past 2^53 without corruption", () => {
  // The documented envelope wraps the comment identity as a JSON string in
  // `content`, and the ids inside it are UNQUOTED JSON numbers larger than
  // Number.MAX_SAFE_INTEGER. The content string is authored raw here exactly as
  // it travels on the wire — running it through JSON.stringify of a Number
  // literal would corrupt it before the code under test ever saw it (that
  // corruption is precisely the bug the digit-safe parser exists to prevent:
  // …6913 silently becomes …7000).
  const payload = {
    event: "comment.update",
    user_openid: "open-id-1",
    create_time: 1_755_000_000,
    content: '{"comment_id":7247303576418566913,"video_id":7203946942097902849,"comment_action":"insert"}',
  };
  assert.equal(webhook.webhookEventKey(payload), webhook.webhookEventKey({ ...payload }));
  assert.match(webhook.webhookEventKey(payload), /^tiktok_business:/);
  assert.match(webhook.webhookEventKey(payload), /7247303576418566913/, "the comment id must survive digit-for-digit");
  // A random fallback key would defeat the unique constraint it feeds.
  assert.equal(webhook.webhookEventKey({}), "");
});

// ---------------------------------------------------------------------------
// Fail-closed configuration
// ---------------------------------------------------------------------------

test("enabling the integration without credentials fails closed", () => {
  const previous = process.env.TIKTOK_BUSINESS_ENABLED;
  process.env.TIKTOK_BUSINESS_ENABLED = "true";
  try {
    assert.throws(
      () => businessConfig.assertTikTokBusinessReady("comments"),
      (error) => error.code === "TIKTOK_BUSINESS_CONFIG_INVALID",
      "a half-configured integration must throw, not degrade silently"
    );
  } finally {
    if (previous === undefined) delete process.env.TIKTOK_BUSINESS_ENABLED;
    else process.env.TIKTOK_BUSINESS_ENABLED = previous;
  }
});

test("a disabled integration reports disabled rather than misconfigured", () => {
  assert.equal(businessConfig.tiktokBusinessEnabled(), false);
  assert.throws(
    () => businessConfig.assertTikTokBusinessReady("messaging"),
    (error) => error.code === "TIKTOK_BUSINESS_DISABLED"
  );
});

test("validation reports every problem at once", () => {
  const { valid, problems } = businessConfig.validateTikTokBusinessConfig();
  assert.equal(valid, false);
  assert.ok(problems.length >= 3, "app id, app secret, and redirect uri are all missing");
  assert.ok(problems.some((problem) => problem.includes("TIKTOK_BUSINESS_APP_ID")));
  assert.ok(problems.some((problem) => problem.includes("TIKTOK_BUSINESS_APP_SECRET")));
});

test("the status shape carries no secret material", () => {
  const described = businessConfig.describeTikTokBusinessConfig();

  // Presence booleans are fine and intended; raw-value keys are not. Check the
  // exact key names rather than substrings, so "app_secret_present" passes and
  // "app_secret" would not.
  const forbiddenKeys = new Set([
    "app_secret",
    "app_id",
    "access_token",
    "refresh_token",
    "encryption_key",
    "client_key",
    "client_secret",
  ]);
  for (const key of Object.keys(described)) {
    assert.ok(!forbiddenKeys.has(key), `status must not expose a raw "${key}"`);
  }
  assert.equal(described.app_secret_present, false);

  // And no value anywhere may be a real credential, whichever app it belongs to.
  const serialized = JSON.stringify(described);
  for (const secret of ["content-posting-client-key", "content-posting-client-secret", process.env.SECRET_ENCRYPTION_KEY]) {
    assert.ok(!serialized.includes(secret), "status must not echo credential material");
  }
});

test("the permission gap between what was requested and what is needed is recorded", () => {
  const gaps = businessConfig.TIKTOK_BUSINESS_PERMISSION_GAPS;
  // Business Messaging is not among the four permissions on the pending app.
  assert.match(gaps.business_messaging, /not_requested/);
  assert.ok(
    !businessConfig.TIKTOK_BUSINESS_REQUESTED_PERMISSIONS.some((permission) =>
      /messaging/i.test(permission)
    ),
    "no requested permission covers Business Messaging"
  );
});
