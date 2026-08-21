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
  // The shell now switches chrome between reply and internal-note mode, so the
  // classes live in a template. What this guards is unchanged: one rounded
  // surface, and the reply branch keeps the omnichannel footer's own tokens.
  assert.match(composerSource, /data-ai-inbox-composer-shell="true"[\s\S]*?flex min-w-0 items-end rounded-2xl border p-1\.5/);
  assert.match(composerSource, /data-ai-inbox-composer-shell="true"[\s\S]*?border-slate-300 bg-slate-50/);
  assert.match(composerSource, /data-ai-inbox-composer="true"[\s\S]*?border-0 bg-transparent/);
  assert.doesNotMatch(composerSource, /bg-\[#eefaf8\]/);
});

test("desktop AI Inbox send action belongs to the same composer shell", () => {
  const shellStart = source.indexOf('data-ai-inbox-composer-shell="true"');
  const sendButton = source.indexOf("onClick={submit}", shellStart);
  const nextComponent = source.indexOf("function ReplyCorrectionModal", shellStart);

  assert.ok(shellStart >= 0);
  assert.ok(sendButton > shellStart && sendButton < nextComponent);
  // Note mode paints the button amber-600; reply mode keeps amber-500.
  assert.match(source.slice(sendButton, nextComponent), /h-10 w-10[\s\S]*?rounded-xl text-white/);
  assert.match(source.slice(sendButton, nextComponent), /"bg-amber-500 hover:bg-amber-600"/);
});
