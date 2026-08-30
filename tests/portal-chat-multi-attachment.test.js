import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { collectPortalChatAttachments, MAX_PORTAL_CHAT_ATTACHMENTS } from "../src/shared/chat/portalChatUtils.js";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const image = (name, { size = 1024, lastModified = 1 } = {}) => ({ name, size, type: "image/jpeg", lastModified });

test("picking a second batch of images appends to the queue instead of replacing it", () => {
  const first = collectPortalChatAttachments([image("a.jpg"), image("b.jpg")]);
  assert.deepEqual(first.attachments.map((file) => file.name), ["a.jpg", "b.jpg"]);

  const second = collectPortalChatAttachments([image("c.jpg")], first.attachments);
  assert.deepEqual(second.attachments.map((file) => file.name), ["a.jpg", "b.jpg", "c.jpg"]);
  assert.equal(second.rejected, 0);
  assert.equal(second.overflow, 0);
});

test("the same file picked twice is not queued twice", () => {
  const { attachments } = collectPortalChatAttachments([image("a.jpg"), image("a.jpg")]);
  assert.deepEqual(attachments.map((file) => file.name), ["a.jpg"]);
});

test("unsupported types and oversized files are dropped, the rest of the batch survives", () => {
  const { attachments, rejected } = collectPortalChatAttachments([
    image("ok.jpg"),
    { name: "clip.avi", size: 1024, type: "video/x-msvideo", lastModified: 1 },
    image("huge.jpg", { size: 11 * 1024 * 1024, lastModified: 2 }),
  ]);
  assert.deepEqual(attachments.map((file) => file.name), ["ok.jpg"]);
  assert.equal(rejected, 2);
});

test("the queue stops at the cap and says how many were left out", () => {
  const picked = Array.from({ length: MAX_PORTAL_CHAT_ATTACHMENTS + 3 }, (_, index) => image(`${index}.jpg`, { lastModified: index }));
  const { attachments, overflow } = collectPortalChatAttachments(picked);
  assert.equal(attachments.length, MAX_PORTAL_CHAT_ATTACHMENTS);
  assert.equal(overflow, 3);
});

test("the chat file picker accepts more than one file", async () => {
  const composer = await source("src/shared/chat/PortalChatComposer.jsx");
  assert.match(composer, /<input[^>]*type="file"[^>]*\bmultiple\b/);
  // Paste and drop hand over the whole list, not just the first file.
  assert.match(composer, /clipboardData\?\.files \|\| \[\]\)\]/);
  assert.doesNotMatch(composer, /dataTransfer\?\.files \|\| \[\]\)\]\[0\]/);
});

test("both chat surfaces send one message per picked file, caption on the first", async () => {
  const [sharedChat, employeePortal] = await Promise.all([
    source("src/shared/chat/SharedPortalChat.jsx"),
    source("src/modules/employees/pages/EmployeePayrollPortal.jsx"),
  ]);
  for (const [name, code] of [["SharedPortalChat", sharedChat], ["EmployeePayrollPortal", employeePortal]]) {
    assert.match(code, /collectPortalChatAttachments/, `${name} must collect the whole picked batch`);
    assert.match(code, /\.map\(\(file, index\) => \(\{/, `${name} must fan the queue out into one draft per file`);
    assert.match(code, /index === 0 \? [a-zA-Z]+ : ""/, `${name} must keep the caption on the first message`);
  }
  // Every bubble is staged before the first upload starts, so a batch shows at
  // once and still reaches the server in the order it was picked.
  assert.match(sharedChat, /const stageSend = \(/);
  assert.match(sharedChat, /for \(const staged of stagedDrafts\) await flushSend\(/);
  assert.match(employeePortal, /const stageChatSend = \(/);
  assert.match(employeePortal, /for \(const item of staged\) await flushChatSend\(/);
});
