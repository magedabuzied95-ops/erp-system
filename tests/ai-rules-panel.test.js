import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

/** Owner, 2026-10-23: the «قواعد الـ AI» panel and every inbox page header, in the language's direction. */
const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("inbox pages take the language's direction back from the LTR inbox shell", () => {
  const center = read("src/modules/aiSupport/components/controlCenter/InboxControlCenter.jsx");
  assert.match(center, /const pageDir = i18n\.dir\(i18n\.resolvedLanguage \|\| i18n\.language\);/);
  assert.match(center, /<section dir=\{pageDir\} className="ai-inbox-section-page /, "the page variant (title + close)");
  assert.match(center, /<section dir=\{pageDir\} className="flex h-\[94dvh\]/, "the modal variant");
});

test("the rules have no save button of their own; each page's one «حفظ» saves them", () => {
  const rules = read("src/modules/aiSupport/components/AiReplyRules.jsx");
  assert.doesNotMatch(rules, /<button/, "no second save button");
  assert.doesNotMatch(rules, /type="checkbox"/, "the inbox's own Toggle, not a bare checkbox");
  for (const page of ["src/modules/aiSupport/components/controlCenter/AgentBehaviourPanel.jsx", "src/modules/aiSupport/pages/AiSettings.jsx"]) {
    const source = read(page);
    assert.match(source, /const replyRules = useAiReplyRules\(\{ headers, tenantId \}\);/, page);
    assert.match(source, /await replyRules\.save\(\);/, page);
    assert.match(source, /<AiReplyRules state=\{replyRules\} \/>/, page);
  }
  assert.match(read("src/modules/aiSupport/components/controlCenter/AgentBehaviourPanel.jsx"), /dirty=\{dirty \|\| replyRules\.dirty\}/);
});

test("both languages have the rules' words", () => {
  const ar = JSON.parse(read("src/locales/ar/aiRules.json"));
  const en = JSON.parse(read("src/locales/en/aiRules.json"));
  assert.deepEqual(Object.keys(ar).sort(), Object.keys(en).sort());
  assert.equal(ar.title, "قواعد الـ AI");
  assert.equal(en.title, "AI rules");
});

test("only the owner's instruction can become a rule switch, never the corrected reply", () => {
  const route = read("server/routes/aiAgentOrders.js");
  assert.match(route, /const lesson = classifyAiRuleLesson\(req\.body\?\.feedback\) \|\| await proposeAgentLesson\(/);
});
