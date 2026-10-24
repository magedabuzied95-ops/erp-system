// Messenger HUMAN_AGENT tag — a staff reply refused for the 24-hour window is resent tagged.
//
// Meta stops RESPONSE sends 24 hours after the customer's last message, but a reply a person typed
// may go out for 7 days under the HUMAN_AGENT tag. The tag is for human replies only, so it is an
// opt-in flag the staff routes set and the AI / automations never do. These guards pin both halves.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const metaService = read("server/services/metaIntegrationService.js");
const routes = read("server/routes/aiAgentOrders.js");
const outbound = read("server/services/inboxOutboundService.js");
const sequences = read("server/services/messageSequencesService.js");

const between = (source, start, end) => {
  const from = source.indexOf(start);
  assert.ok(from >= 0, `missing ${start}`);
  const to = source.indexOf(end, from + start.length);
  return source.slice(from, to < 0 ? undefined : to);
};

test("the window refusal is recognised by Meta's subcode, not by the bare (#10)", () => {
  const detector = between(metaService, "export const isMessengerOutsideWindowError", "\n};");
  assert.match(detector, /2018278/);
});

test("the resend carries MESSAGE_TAG + HUMAN_AGENT and only runs when the caller opted in", () => {
  const resend = between(metaService, "const resendAsHumanAgent", "\nconst postMetaMessageWithThreadControl");
  assert.match(resend, /messaging_type: "MESSAGE_TAG"/);
  assert.match(resend, /tag: "HUMAN_AGENT"/);
  assert.match(resend, /sendContext\.human_agent_fallback !== true/);
  assert.match(resend, /isMessengerOutsideWindowError\(error\)/);
  // A refused tagged resend must surface the ORIGINAL window error, not the tag error.
  assert.match(resend, /throw error;\s*\}\s*\};?\s*$/);
});

test("every Messenger post goes through the fallback wrapper", () => {
  const wrapper = between(metaService, "const postMetaMessageWithThreadControl", "\nconst postMetaMessageOnce");
  assert.match(wrapper, /postMetaMessageOnce\(/);
  assert.match(wrapper, /resendAsHumanAgent\(/);
});

test("the flag defaults off and reaches the send context", () => {
  const signature = between(metaService, "export const sendMetaInboxOutboundMessage = async", "} = {}) => {");
  assert.match(signature, /humanAgentFallback = false/);
  assert.match(metaService, /human_agent_fallback: humanAgentFallback === true/);
});

test("staff routes opt in", () => {
  for (const route of [
    'router.post("/conversations/:conversationId/send"',
    'router.post("/conversations/:conversationId/product-card/send"',
    '"/conversations/:conversationId/attachment"',
  ]) {
    const body = between(routes, route, "\nrouter.");
    assert.match(body, /humanAgentFallback: true/, route);
  }
  assert.match(routes, /source: "quick_reply", humanAgentFallback: true/);
  const share = between(routes, "sendInboxSharedPost({", "});");
  assert.match(share, /humanAgentFallback: true/);
});

test("the shared outbound service forwards the flag but never turns it on itself", () => {
  assert.equal((outbound.match(/humanAgentFallback = false/g) || []).length, 3);
  assert.equal((outbound.match(/^\s+humanAgentFallback,$/gm) || []).length, 3);
  assert.doesNotMatch(outbound, /humanAgentFallback: true/);
});

test("automated sequences never send under the human tag", () => {
  assert.doesNotMatch(sequences, /humanAgentFallback/);
});
