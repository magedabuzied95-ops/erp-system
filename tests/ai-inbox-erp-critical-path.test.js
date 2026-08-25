import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

// ERP-integrated AI Inbox (route /admin/ai-inbox). The conversation list must
// not wait for data that isn't required to show conversations.
const src = fs.readFileSync(new URL("../src/modules/aiSupport/pages/AiInbox.jsx", import.meta.url), "utf8");
// The refresh/bootstrap function's body (from the conversations fetch to its finally).
const region = src.slice(
  src.indexOf('api.get("/ai-inbox/conversations"'),
  src.indexOf('if (seq === requestSeqRef.current && !silent) setLoading(false);')
);

test("conversation list is fetched on its own, not bundled in a blocking wave with non-essential data", () => {
  // The list is now a fair per-channel fan-out, but it is still its own round:
  // only conversation pages are awaited before render.
  assert.match(src, /const settled = await Promise\.allSettled\(requestedChannels\.map\(fetchChannelPage\)\)/);
  // it must NOT be bundled with drafts/analytics/employees in one blocking wave
  assert.doesNotMatch(src, /await Promise\.all\(\[\s*\n?\s*api\.get\("\/ai-inbox\/conversations"/);
  const listRound = src.slice(src.indexOf("const fetchChannelPage"), src.indexOf("const settled = await Promise.allSettled"));
  for (const endpoint of ["/ai-agent/analytics", "/ai-agent/orders/drafts", "/employees", "/social-comments"]) {
    assert.ok(!listRound.includes(endpoint), `${endpoint} must not sit on the list critical path`);
  }
});

test("drafts / analytics / employees are deferred (non-blocking), not on the list critical path", () => {
  // they appear in a fire-and-forget Promise.all(...).then, not awaited before render
  // channel accounts (multi-number registry) ride the same deferred wave.
  assert.match(region, /\]\)\.then\(\(\[draftsPayload, analyticsPayload, channelPayload, globalAiPayload, employeesPayload, accountsPayload\]\) =>/);
  // none of the deferred endpoints is awaited in the critical path
  assert.doesNotMatch(region, /await api\.get\("\/ai-agent\/analytics"/);
  assert.doesNotMatch(region, /await api\.get\("\/ai-agent\/orders\/drafts"/);
  assert.doesNotMatch(region, /await api\.get\("\/employees"/);
});

test("the list is unblocked (setLoading(false)) before the secondary wave is fetched", () => {
  const unblock = region.indexOf("if (!silent) setLoading(false);");
  const secondary = region.indexOf('api.get("/ai-agent/orders/drafts"');
  assert.ok(unblock >= 0, "list must be unblocked inside the bootstrap");
  assert.ok(unblock < secondary, "setLoading(false) must come before the deferred secondary fetch");
});
