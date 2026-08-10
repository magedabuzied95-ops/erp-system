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
