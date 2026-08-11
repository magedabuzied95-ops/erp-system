import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

// The expand (⤢) button in the conversation header only stretched the chat inside
// the ERP shell — `fixed inset-0` covers the page but still sits under the
// browser's own chrome. It now also requests real fullscreen so the conversation
// takes over the whole screen.
const src = fs.readFileSync(new URL("../src/modules/aiSupport/pages/AiInbox.jsx", import.meta.url), "utf8");

test("expanding requests real browser fullscreen", () => {
  assert.match(src, /const requestConversationFullscreen = useCallback\(/);
  assert.match(src, /host\.requestFullscreen \|\| host\.webkitRequestFullscreen \|\| host\.msRequestFullscreen/);
  assert.match(src, /if \(next\) requestConversationFullscreen\(\);/);
});

test("collapsing exits fullscreen", () => {
  assert.match(src, /const exitConversationFullscreen = useCallback\(/);
  assert.match(src, /document\.exitFullscreen \|\| document\.webkitExitFullscreen \|\| document\.msExitFullscreen/);
  assert.match(src, /else exitConversationFullscreen\(\);/);
});

test("the fullscreen target is the same element that becomes the overlay", () => {
  assert.match(src, /const fullscreenHostRef = useRef\(null\);/);
  assert.match(src, /<div ref=\{fullscreenHostRef\} className=\{`\$\{conversationExpanded \? "conversation-expanded fixed inset-0/);
});

test("leaving fullscreen by Esc/F11 collapses the layout instead of stranding it", () => {
  assert.match(src, /document\.addEventListener\("fullscreenchange", onFullscreenChange\);/);
  assert.match(src, /document\.addEventListener\("webkitfullscreenchange", onFullscreenChange\);/);
  assert.match(src, /if \(!document\.fullscreenElement\) setIsConversationExpanded\(false\);/);
  assert.match(src, /document\.removeEventListener\("fullscreenchange", onFullscreenChange\);/);
});

test("a browser that refuses fullscreen still gets the in-page overlay", () => {
  // Rejections must be swallowed; an unhandled reject would surface as an error
  // and the expanded overlay is a fine fallback on its own.
  const block = src.slice(src.indexOf("const requestConversationFullscreen"), src.indexOf("const handleToggleConversationExpansion"));
  assert.match(block, /result\.catch\(\(\) => \{\}\)/);
  assert.match(block, /catch \{/);
});

test("re-entering fullscreen is a no-op while already fullscreen", () => {
  assert.match(src, /if \(!host \|\| document\.fullscreenElement\) return;/);
  assert.match(src, /if \(!document\.fullscreenElement\) return;/);
});

test("the in-page expanded overlay is unchanged (still full-viewport, top layer)", () => {
  assert.match(src, /fixed inset-0 z-\[9999\] flex h-\[100vh\] w-\[100vw\]/);
});

test("expanding scales up the WHOLE workspace, not just the chat", () => {
  // The channel rail used to be hidden while expanded, which turned "expand"
  // into "chat only" and removed channel switching exactly when there is the
  // most room for it.
  assert.match(src, /<div className="ai-omni-channel-rail ai-omni-panel">/);
  assert.doesNotMatch(src, /fullscreenConversation \? "hidden" : "ai-omni-channel-rail"/);
});

test("the conversation list stays visible while expanded", () => {
  const listAside = src.slice(src.indexOf("ai-omni-list-panel") - 140, src.indexOf("ai-omni-list-panel") + 300);
  assert.doesNotMatch(listAside, /fullscreenConversation \? "hidden"/);
});

test("expanding never restyles the workspace grid", () => {
  // `.ai-omni-workspace` is a CSS grid: 58px rail | list | chat. Forcing `!flex`
  // while expanded collapsed those columns the moment the rail became visible —
  // the list stretched edge to edge and the chat vanished. Fullscreen is the
  // outer wrapper's job; the inner layout must stay untouched.
  assert.match(src, /<section className="ai-omni-workspace relative">/);
  assert.doesNotMatch(src, /!flex min-h-0 flex-1 gap-0 overflow-hidden/);
});

test("the chat panel keeps its card styling while expanded", () => {
  // Expanded should look like the normal inbox, only bigger.
  assert.doesNotMatch(src, /rounded-none border-0 bg-transparent p-0 shadow-none/);
  assert.match(src, /ai-omni-chat-panel min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden rounded-3xl border/);
});
