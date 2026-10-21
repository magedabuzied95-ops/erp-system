// Genie's Participants block (owner + added members, transfer / add / remove)
// and a thread header that stays on one line when the side panel narrows it.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const page = read("src/modules/aiSupport/pages/AiInbox.jsx");
const route = read("server/routes/aiAgentOrders.js");
const block = read("src/modules/aiSupport/components/ConversationParticipants.jsx");

test("participants: an add/remove route under reply rights, kept in metadata", () => {
  assert.match(route, /router\.patch\("\/conversations\/:conversationId\/participants", protect, inboxReply\(\)/);
  assert.match(route, /jsonb_build_object\('participants', \$3::jsonb\)/);
  assert.match(route, /\["add", "remove"\]\.includes\(action\)/);
});

test("the Members filter matches an added participant as well as the owner", () => {
  const service = read("server/services/aiSalesAgentService.js");
  assert.ok(service.includes("FROM jsonb_array_elements(CASE WHEN jsonb_typeof(c.metadata->'participants') = 'array'"));
});

test("the block: transfer through the assign route, add/remove, online dot, you, roles", () => {
  assert.match(block, /api\.patch\(`\/ai-agent\/inbox\/\$\{encodeURIComponent\(sessionId\)\}\/assign`/);
  assert.match(block, /aiInboxConversationEndpoint\(sessionId, "\/participants"\)/);
  assert.match(block, /online \? "bg-emerald-500" : "bg-slate-400"/);
  assert.match(block, /aiSupport\.inbox\.participants\.you/);
  assert.match(block, /aiSupport\.inbox\.participants\.makeOwner/);
  assert.match(page, /onAssigned=\{handleTeamAssigned\}/);
  assert.match(page, /channel_metadata: \{ \.\.\.\(conversation\.channel_metadata \|\| \{\}\), participants \}/);
});

test("the header drops its button labels instead of wrapping when narrow", () => {
  assert.match(page, /data-ai-inbox-compact-contact-header="true" className="@container /);
  assert.match(page, /data-ai-inbox-header-actions="right" className="flex shrink-0 flex-nowrap/);
  assert.match(page, /<span className="hidden @\[820px\]:inline">\{t\("aiSupport\.inbox\.header\.addLabel"\)\}<\/span>/);
});

test("participant strings exist in both locales", () => {
  for (const locale of ["ar", "en"]) {
    const p = JSON.parse(read(`src/locales/${locale}/aiSupport.json`)).inbox.participants;
    for (const key of ["search", "added", "removed", "you", "makeOwner", "unassign", "remove", "empty"]) assert.ok(p?.[key], `${locale} participants.${key}`);
  }
});
