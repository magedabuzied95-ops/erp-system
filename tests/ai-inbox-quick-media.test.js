import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const desktop = readFileSync("src/modules/aiSupport/pages/AiInbox.jsx", "utf8");
const pwa = readFileSync("src/modules/aiSupport/pages/AiInboxPwa.jsx", "utf8");
const card = readFileSync("src/modules/aiSupport/components/QuickMediaCard.jsx", "utf8");
const en = JSON.parse(readFileSync("src/locales/en/aiSupport.json", "utf8"));
const ar = JSON.parse(readFileSync("src/locales/ar/aiSupport.json", "utf8"));

const memoryStore = new Map();
globalThis.window = {
  localStorage: {
    getItem: (key) => (memoryStore.has(key) ? memoryStore.get(key) : null),
    setItem: (key, value) => memoryStore.set(key, String(value)),
  },
};
const { imageFingerprint, rememberImageSeen, wasImageSeen } = await import("../src/modules/aiSupport/utils/clipboardImage.js");

test("a paste waits on the card instead of sending straight away", () => {
  const desktopAccept = desktop.slice(desktop.indexOf("const acceptTransferFiles"), desktop.indexOf("const submitLabel"));
  assert.match(desktopAccept, /quickMedia\.offer\(file, "paste"\)/);
  assert.doesNotMatch(desktopAccept, /onAttachImage\(file\)/);
  const pwaPaste = pwa.slice(pwa.indexOf("const handleComposerPasteFiles"), pwa.indexOf("const pasteImageFromClipboard"));
  assert.match(pwaPaste, /offerQuickMedia\(file, "paste"\)/);
  assert.doesNotMatch(pwaPaste, /sendAttachmentFile\(/);
});

test("both surfaces render the card, the forward sheet and a clipboard control", () => {
  for (const source of [desktop, pwa]) {
    assert.match(source, /<QuickMediaCard/);
    assert.match(source, /<ForwardConversationSheet/);
    assert.match(source, /ClipboardPaste/);
  }
});

test("a forward sends to the picked conversation without touching the open draft", () => {
  assert.match(desktop, /sendAttachment = useCallback\(async \(rawFile, \{ target = null \} = \{\}\)/);
  assert.match(desktop, /const caption = target \? "" : clean\(replyText\);/);
  assert.match(desktop, /if \(!target\) setReplyText\(""\);/);
  assert.match(pwa, /sendAttachmentFile = useCallback\(async \(rawFile, \{ target = null \} = \{\}\)/);
  assert.match(pwa, /const caption = target \? "" : cleanMessageText\(readComposerText\(\)\);/);
  assert.match(pwa, /if \(!target\) setComposerText\(""\);/);
});

test("the clipboard is only read silently when the permission is already granted", () => {
  assert.match(card, /clipboardReadPermission\(\)\) !== "granted"\) return;/);
});

test("the same picture is recognised across reads and offered once", async () => {
  const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
  const first = new File([bytes], "clipboard-1.png", { type: "image/png" });
  const second = new File([bytes], "clipboard-2.png", { type: "image/png", lastModified: Date.now() + 5000 });
  const other = new File([new Uint8Array([9, 9, 9, 9, 9, 9, 9, 9])], "clipboard-3.png", { type: "image/png" });
  const a = await imageFingerprint(first);
  assert.equal(a, await imageFingerprint(second));
  assert.notEqual(a, await imageFingerprint(other));
  assert.equal(wasImageSeen(a), false);
  rememberImageSeen(a);
  assert.equal(wasImageSeen(a), true);
  assert.equal(wasImageSeen(await imageFingerprint(other)), false);
});

test("every quick-media string exists in both locales", () => {
  const keys = ["fromClipboard", "ready", "send", "dismiss", "forward", "forwardTitle", "forwardSearch", "forwardEmpty", "forwarded"];
  for (const dictionary of [en, ar]) {
    const composer = dictionary.inbox.composer;
    assert.ok(composer.pasteFromClipboard);
    assert.ok(composer.clipboardEmpty);
    for (const key of keys) assert.ok(composer.quickMedia?.[key], `missing quickMedia.${key}`);
  }
});
