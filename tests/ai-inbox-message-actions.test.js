import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const messageSource = readFileSync("src/modules/aiSupport/components/TranscriptMessage.jsx", "utf8");
const desktopSource = readFileSync("src/modules/aiSupport/pages/AiInbox.jsx", "utf8");
const pwaSource = readFileSync("src/modules/aiSupport/pages/AiInboxPwa.jsx", "utf8");

test("message action menu is shared by desktop and PWA transcript messages", () => {
  assert.match(messageSource, /function MessageActionShell/);
  assert.match(messageSource, /variant="desktop"/);
  assert.match(messageSource, /variant="pwa"/);
  assert.match(messageSource, /onClick=\{openActionsFromMessage\}/);
  assert.doesNotMatch(messageSource, /MoreVertical/);
  assert.match(messageSource, /aria-label=\{t\("aiSupport\.inbox\.message\.messageActions"\)\}/);
});

test("pinning renders a sticky pinned-message bar in desktop and PWA", () => {
  assert.match(messageSource, /export function PinnedMessagesBar/);
  assert.match(messageSource, /sticky top-0 z-30/);
  assert.match(messageSource, /m1:ai-inbox-message-pin-change/);
  assert.match(messageSource, /m1:ai-inbox-message-focus/);
  assert.match(desktopSource, /<PinnedMessagesBar rows=\{rows\} variant="desktop"/);
  assert.match(pwaSource, /<PinnedMessagesBar rows=\{rows\} variant="pwa"/);
});

test("message menu exposes reply, copy, pin, star, select, and info", () => {
  assert.match(messageSource, /label: t\("aiSupport\.inbox\.message\.reply"\)/);
  assert.match(messageSource, /copied \? "aiSupport\.inbox\.message\.copied" : "aiSupport\.inbox\.message\.copy"/);
  assert.match(messageSource, /pinned \? "aiSupport\.inbox\.message\.unpin" : "aiSupport\.inbox\.message\.pin"/);
  assert.match(messageSource, /starred \? "aiSupport\.inbox\.message\.unstar" : "aiSupport\.inbox\.message\.star"/);
  assert.match(messageSource, /selected \? "aiSupport\.inbox\.message\.deselect" : "aiSupport\.inbox\.message\.select"/);
  assert.match(messageSource, /label: t\("aiSupport\.inbox\.message\.info"\)/);
  assert.match(messageSource, /m1:ai-inbox:pinned-messages:v1/);
  assert.match(messageSource, /m1:ai-inbox:starred-messages:v1/);
  assert.match(messageSource, /aria-label=\{t\("aiSupport\.inbox\.message\.messageInfo"\)\}/);
});

test("reply action focuses and fills both inbox composers", () => {
  assert.match(messageSource, /m1:ai-inbox-message-reply/);
  assert.match(desktopSource, /addEventListener\("m1:ai-inbox-message-reply"/);
  assert.match(desktopSource, /setReplyText\(`↪/);
  assert.match(pwaSource, /addEventListener\("m1:ai-inbox-message-reply"/);
  assert.match(pwaSource, /setComposerText\(`↪/);
});
