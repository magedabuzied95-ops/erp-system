import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const picker = read("src/modules/aiSupport/components/AppleEmojiPicker.jsx");
const transcript = read("src/modules/aiSupport/components/TranscriptMessage.jsx");
const desktop = read("src/modules/aiSupport/pages/AiInbox.jsx");
const pwa = read("src/modules/aiSupport/pages/AiInboxPwa.jsx");

test("shared emoji picker renders Apple artwork and follows the active theme", () => {
  assert.match(picker, /emojiStyle=\{EmojiStyle\.APPLE\}/);
  assert.match(picker, /theme\?\.mode === "dark" \? Theme\.DARK : Theme\.LIGHT/);
  assert.match(picker, /createPortal/);
  assert.match(picker, /searchPlaceHolder="Search emoji"/);
});

test("desktop composer opens the picker and inserts at the textarea caret", () => {
  assert.match(desktop, /ref=\{emojiButtonRef\}/);
  assert.match(desktop, /<AppleEmojiPicker/);
  assert.match(desktop, /selectionStart/);
  assert.match(desktop, /setSelectionRange/);
});

test("PWA composer opens the same picker and preserves contenteditable selection", () => {
  assert.match(pwa, /editorRef=\{composerEditorRef\}/);
  assert.match(pwa, /<AppleEmojiPicker/);
  assert.match(pwa, /window\.getSelection/);
  assert.match(pwa, /range\.insertNode/);
});

test("message reactions use Apple artwork for picking and display", () => {
  assert.match(transcript, /<AppleEmoji emoji=\{emoji\} size=\{25\}/);
  assert.match(transcript, /<AppleEmojiPicker/);
  assert.match(transcript, /onSelect=\{\(emoji\) => void submitReaction\(emoji\)\}/);
  assert.match(transcript, /size=\{20\}/);
});
