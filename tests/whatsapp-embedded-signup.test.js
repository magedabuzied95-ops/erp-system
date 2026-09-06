import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  classifyCoexistence,
  publicEmbeddedSignupConfig,
  publicIntegrationShape,
} from "../server/services/whatsappEmbeddedSignupService.js";
import {
  encryptWhatsappCloudSecret,
  decryptWhatsappCloudSecret,
  maskAccessToken,
  describeWhatsappCloudEncryptionKey,
} from "../server/services/whatsappCloudCryptoService.js";
import { isCloudOwnEcho } from "../server/routes/whatsappGateway.js";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const serviceSource = read("../server/services/whatsappEmbeddedSignupService.js");
const cryptoSource = read("../server/services/whatsappCloudCryptoService.js");
const routesSource = read("../server/routes/whatsappGateway.js");
const cardSource = read("../src/modules/aiSupport/components/integrations/WhatsAppEmbeddedSignupCard.jsx");
const gitignore = read("../.gitignore");

// Comments describe what the code must NOT do; a guard about calls has to read only the calls.
const stripComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
const serviceCode = stripComments(serviceSource);

const withKey = (run) => {
  const previous = process.env.WHATSAPP_CLOUD_ENCRYPTION_KEY;
  process.env.WHATSAPP_CLOUD_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  try {
    return run();
  } finally {
    if (previous === undefined) delete process.env.WHATSAPP_CLOUD_ENCRYPTION_KEY;
    else process.env.WHATSAPP_CLOUD_ENCRYPTION_KEY = previous;
  }
};

test("the app secret never reaches the shape the browser is given", () => {
  const previous = process.env.META_APP_SECRET;
  process.env.META_APP_SECRET = "SUPER_SECRET_APP_SECRET_VALUE";
  try {
    const config = publicEmbeddedSignupConfig();
    const serialised = JSON.stringify(config);
    assert.ok(!serialised.includes("SUPER_SECRET_APP_SECRET_VALUE"), "the app secret leaked into the public config");
    // Only the fact that it is configured may travel.
    assert.equal(config.app_secret_configured, true);
    assert.ok(!("app_secret" in config));
    assert.ok(!("appSecret" in config));
  } finally {
    if (previous === undefined) delete process.env.META_APP_SECRET;
    else process.env.META_APP_SECRET = previous;
  }
});

test("the stored token never reaches the shape the browser is given", () => {
  const shape = publicIntegrationShape({
    id: 1,
    provider: "whatsapp_cloud",
    waba_id: "W1",
    phone_number_id: "P1",
    access_token_encrypted: "wac:v1:aaa:bbb:ccc",
    status: "connected",
  });
  const serialised = JSON.stringify(shape);
  assert.ok(!serialised.includes("wac:v1"), "the encrypted envelope leaked to the client");
  assert.ok(!("access_token_encrypted" in shape));
  assert.ok(!("access_token" in shape));
  // Whether a token exists is safe and useful; the token, in any form, is not.
  assert.equal(shape.token_present, true);
});

test("a token is encrypted at rest under its own dedicated key", () => {
  withKey(() => {
    const token = "EAAG_permanent_business_token_value";
    const sealed = encryptWhatsappCloudSecret(token);
    assert.ok(sealed.startsWith("wac:v1:"), "the envelope must be domain-separated");
    assert.ok(!sealed.includes(token), "the plaintext survived into the envelope");
    assert.equal(decryptWhatsappCloudSecret(sealed), token);
  });
  // The key is exclusive: no fallback to another platform secret, so one leak cannot cascade.
  const envReads = [...cryptoSource.matchAll(/process\.env\.([A-Z0-9_]+)/g)].map((match) => match[1]);
  assert.deepEqual([...new Set(envReads)], ["WHATSAPP_CLOUD_ENCRYPTION_KEY"]);
});

test("a foreign envelope fails closed instead of being used against the wrong API", () => {
  withKey(() => {
    assert.throws(() => decryptWhatsappCloudSecret("tkb:v1:a:b:c"), (error) => error.code === "WHATSAPP_CLOUD_ENVELOPE_INVALID");
  });
});

test("a missing key blocks the connect flow before any token is fetched", () => {
  const previous = process.env.WHATSAPP_CLOUD_ENCRYPTION_KEY;
  delete process.env.WHATSAPP_CLOUD_ENCRYPTION_KEY;
  try {
    assert.equal(describeWhatsappCloudEncryptionKey().ok, false);
  } finally {
    if (previous !== undefined) process.env.WHATSAPP_CLOUD_ENCRYPTION_KEY = previous;
  }
  // The refusal has to come BEFORE the exchange: a token we cannot store safely must never be
  // fetched at all.
  const complete = serviceSource.slice(serviceSource.indexOf("export const completeEmbeddedSignup"));
  const guardIndex = complete.indexOf("describeWhatsappCloudEncryptionKey()");
  const exchangeIndex = complete.indexOf("exchangeAuthorizationCode(");
  assert.ok(guardIndex > -1 && exchangeIndex > guardIndex, "the encryption check must run before the code exchange");
});

test("only a masked tail of a token can ever be logged", () => {
  assert.equal(maskAccessToken("EAAG_abcdefghijklmnop1234"), "••••1234");
  // No log line may interpolate the token itself.
  assert.ok(!/console\.\w+\([^)]*accessToken[^)]*\)/.test(serviceSource.replace(/maskAccessToken\(accessToken\)/g, "")), "a raw token reached a log call");
});

test("nothing in the flow can deregister the number from the WhatsApp Business app", () => {
  /*
   * The whole point of coexistence: the number stays live on the operator's phone. Registering it
   * on Cloud API is what takes it off, and it is a one-way door — so these calls must not exist
   * anywhere in the connect or disconnect paths.
   */
  // Stripped of comments first: this file EXPLAINS what it refuses to call, so prose mentioning
  // deregister would otherwise fail a guard that is meant to be about code.
  for (const forbidden of ["/register", "deregister", "/migrate", "request_code", "verify_code"]) {
    assert.ok(!serviceCode.includes(forbidden), `the service must never call ${forbidden}`);
  }
  // Disconnect is local only.
  const disconnect = serviceSource.slice(
    serviceSource.indexOf("export const disconnectIntegration"),
    serviceSource.indexOf("export const completeEmbeddedSignup")
  );
  assert.ok(!disconnect.includes("graph("), "disconnect must not call Meta at all");
  assert.match(disconnect, /status = 'disconnected'/);
  assert.match(disconnect, /access_token_encrypted = ''/);
});

test("the only non-GET Graph call is the webhook subscription", () => {
  const postCalls = [...serviceSource.matchAll(/method:\s*"POST"/g)];
  assert.equal(postCalls.length, 1, "a second write call to Meta appeared in the connect flow");
  const subscribe = serviceSource.slice(serviceSource.indexOf("export const subscribeWabaWebhooks"));
  assert.match(subscribe.slice(0, 900), /subscribed_apps/);
});

test("Meta's own answer decides what kind of onboarding happened", () => {
  assert.equal(classifyCoexistence({ platform_type: "CLOUD_API" }), "cloud_api_only");
  assert.equal(classifyCoexistence({ platform_type: "SMB_APP" }), "business_app_coexistence");
  assert.equal(classifyCoexistence({ is_on_biz_app: true, platform_type: "CLOUD_API" }), "business_app_coexistence");
  assert.equal(classifyCoexistence({ platform_type: "ON_PREMISE" }), "on_premise");
  assert.equal(classifyCoexistence({}), "unknown");
  // A value Meta adds later must be reported, not silently collapsed into a guess.
  assert.equal(classifyCoexistence({ platform_type: "SOMETHING_NEW" }), "unrecognised:something_new");
});

test("reconnecting the same number updates its row instead of adding another", () => {
  const upsert = serviceSource.slice(serviceSource.indexOf("export const upsertIntegration"));
  assert.match(upsert, /ON CONFLICT ON CONSTRAINT uq_whatsapp_cloud_integration DO UPDATE/);
  assert.match(serviceSource, /UNIQUE \(tenant_id, waba_id, phone_number_id\)/);
  // A reconnect that produced no token must not wipe the working one.
  assert.match(upsert, /COALESCE\(NULLIF\(EXCLUDED\.access_token_encrypted, ''\), whatsapp_cloud_integrations\.access_token_encrypted\)/);
});

test("the signup state is single use and checked in the same statement that spends it", () => {
  const consume = serviceSource.slice(
    serviceSource.indexOf("export const consumeSignupState"),
    serviceSource.indexOf("/* ── Graph")
  );
  assert.match(consume, /UPDATE whatsapp_cloud_signup_states/);
  assert.match(consume, /used_at IS NULL/);
  assert.match(consume, /expires_at > NOW\(\)/);
  // Two callbacks racing the same state must not both win, so the check cannot be a SELECT.
  assert.ok(!consume.includes("SELECT"), "a read-then-write check would let a replay through");
});

test("the callback refuses a code that arrives without a live state", () => {
  const callback = routesSource.slice(
    routesSource.indexOf(`router.post("/embedded-signup/callback"`),
    routesSource.indexOf(`router.post("/embedded-signup/disconnect"`)
  );
  assert.match(callback, /consumeSignupState/);
  const stateIndex = callback.indexOf("consumeSignupState");
  const completeIndex = callback.indexOf("completeEmbeddedSignup");
  assert.ok(stateIndex < completeIndex, "the state must be spent before the code is exchanged");
  assert.match(callback, /permit\("settings", "edit"\)/);
});

test("an outbound echo from the Business app is not read as a customer writing in", () => {
  // Coexistence sends our own messages back. Treating one as inbound is how an order once
  // confirmed itself; the check is structural, on the sender.
  assert.equal(isCloudOwnEcho({ from: "201095339666" }, { display_phone_number: "+20 109 533 9666" }), true);
  assert.equal(isCloudOwnEcho({ from: "201000000000" }, { display_phone_number: "+20 109 533 9666" }), false);
  assert.equal(isCloudOwnEcho({ from: "" }, { display_phone_number: "" }), false);
});

test("the webhook acknowledges before it processes", () => {
  const handler = routesSource.slice(
    routesSource.indexOf("export const handleWhatsappCloudWebhookEvent"),
    routesSource.indexOf(`router.get("/webhook"`)
  );
  const ackIndex = handler.indexOf("res.status(200)");
  const processIndex = handler.indexOf("processWhatsappCloudWebhook(body)");
  assert.ok(ackIndex > -1 && processIndex > ackIndex, "Meta must be acknowledged before any work starts");
  assert.match(handler, /setImmediate/);
});

test("the browser never exchanges the code and never sees a token", () => {
  // The code goes straight to our backend; the app secret lives only there.
  assert.match(cardSource, /api\.post\("\/whatsapp\/embedded-signup\/callback"/);
  for (const name of ["oauth/access_token", "client_secret", "app_secret", "META_APP_SECRET"]) {
    assert.ok(!cardSource.includes(name), `the browser must never handle ${name}`);
  }
});

test("the dialog is the Embedded Signup flow, not a plain Facebook login", () => {
  assert.match(cardSource, /config_id: config\.config_id/);
  // Without both of these the SDK returns a browser access token instead of a code.
  assert.match(cardSource, /response_type: "code"/);
  assert.match(cardSource, /override_default_response_type: true/);
  assert.match(cardSource, /sessionInfoVersion: "3"/);
});

test("a postMessage is only trusted when it came from Meta", () => {
  assert.match(cardSource, /TRUSTED_SIGNUP_ORIGINS\.has\(event\.origin\)/);
  assert.match(cardSource, /https:\/\/www\.facebook\.com/);
  const guardIndex = cardSource.indexOf("TRUSTED_SIGNUP_ORIGINS.has(event.origin)");
  const parseIndex = cardSource.indexOf("payload.type !== \"WA_EMBEDDED_SIGNUP\"");
  assert.ok(guardIndex > -1 && parseIndex > guardIndex, "the origin must be checked before the payload is read");
  // All three outcomes have to be visible, or a cancelled dialog looks like a failed one.
  for (const event of ["FINISH", "CANCEL", "ERROR"]) assert.ok(cardSource.includes(`"${event}"`), `${event} is not handled`);
});

test("the existing Messenger and Instagram integrations are not touched", () => {
  // Their routes live on a different mount entirely; nothing here may write to their tables.
  for (const foreign of ["meta_integration_configs", "instagram_business", "/api/meta/webhook"]) {
    assert.ok(!serviceSource.includes(foreign), `the WhatsApp service must not touch ${foreign}`);
  }
  // And the WhatsApp webhook verification the operator already registered stays where it was.
  assert.match(routesSource, /router\.get\("\/webhook", handleWhatsappCloudWebhookVerification\)/);
  assert.match(routesSource, /M1_WHATSAPP_VERIFY_2026/);
});

test("the new services are allowlisted past the gitignore rule that hides them", () => {
  const lastCatchAll = Math.max(gitignore.lastIndexOf("server/services/*\n"), gitignore.lastIndexOf("server/services/*\r\n"));
  for (const file of ["whatsappCloudCryptoService.js", "whatsappEmbeddedSignupService.js"]) {
    const allow = gitignore.lastIndexOf(`!server/services/${file}`);
    assert.ok(allow > -1, `${file} is not allowlisted`);
    assert.ok(allow > lastCatchAll, `${file} would still be ignored, and the deploy would ship routes importing a missing file`);
  }
});
