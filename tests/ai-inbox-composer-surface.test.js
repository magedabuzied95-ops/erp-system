import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(
  new URL("../src/modules/aiSupport/pages/AiInbox.jsx", import.meta.url),
  "utf8"
);
const composerSource = source.slice(
  source.indexOf("function ManualReplyComposer"),
  source.indexOf("function ReplyCorrectionModal")
);

test("desktop AI Inbox composer renders as one unified surface", () => {
  assert.match(composerSource, /data-ai-inbox-composer-shell="true"/);
  assert.match(composerSource, /data-ai-inbox-composer-shell="true"[\s\S]*?rounded-2xl border border-slate-300 bg-slate-50/);
  assert.match(composerSource, /data-ai-inbox-composer="true"[\s\S]*?border-0 bg-transparent/);
  assert.doesNotMatch(composerSource, /bg-\[#eefaf8\]/);
});

test("desktop AI Inbox send action belongs to the same composer shell", () => {
  const shellStart = source.indexOf('data-ai-inbox-composer-shell="true"');
  const sendButton = source.indexOf("onClick={submit}", shellStart);
  const nextComponent = source.indexOf("function ReplyCorrectionModal", shellStart);

  assert.ok(shellStart >= 0);
  assert.ok(sendButton > shellStart && sendButton < nextComponent);
  assert.match(source.slice(sendButton, nextComponent), /h-10 w-10[\s\S]*?rounded-xl bg-amber-500/);
});
