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
  // conversations is awaited directly (single request), not inside a Promise.all
  assert.match(src, /const inboxPayload = await api\.get\("\/ai-inbox\/conversations"/);
  // it must NOT be the first element of a Promise.all([...conversations, drafts, ...])
  assert.doesNotMatch(src, /await Promise\.all\(\[\s*\n?\s*api\.get\("\/ai-inbox\/conversations"/);
});

test("drafts / analytics / employees are deferred (non-blocking), not on the list critical path", () => {
  // they appear in a fire-and-forget Promise.all(...).then, not awaited before render
  assert.match(region, /\]\)\.then\(\(\[draftsPayload, analyticsPayload, channelPayload, globalAiPayload, employeesPayload\]\) =>/);
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
