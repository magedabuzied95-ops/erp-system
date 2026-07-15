import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("admin and manager chat use the shared portal chat engine", async () => {
  const [adminEntry, adminChat, managerPortal] = await Promise.all([
    source("src/modules/employees/pages/EmployeeChatInbox.jsx"),
    source("src/modules/employees/pages/UnifiedEmployeeChatInbox.jsx"),
    source("src/modules/managerPortal/pages/ManagerPortal.jsx"),
  ]);
  assert.match(adminEntry, /UnifiedEmployeeChatInbox/);
  assert.match(adminChat, /SharedPortalChat/);
  assert.match(adminChat, /employee-chat:new-message/);
  assert.match(managerPortal, /<SharedPortalChat/);
  assert.match(managerPortal, /employee-chat:new-message/);
});

test("shared chat supports camera, emoji, audio, images and video", async () => {
  const [composer, attachment, utils, upload, service] = await Promise.all([
    source("src/shared/chat/PortalChatComposer.jsx"),
    source("src/shared/chat/PortalChatAttachment.jsx"),
    source("src/shared/chat/portalChatUtils.js"),
    source("server/config/employeeChatUpload.js"),
    source("server/services/employeeChatService.js"),
  ]);
  assert.match(composer, /capture="environment"/);
  assert.match(composer, /QUICK_EMOJIS/);
  assert.match(composer, /WhatsAppRecordingBar/);
  assert.match(attachment, /<video/);
  assert.match(utils, /video\/quicktime/);
  assert.match(upload, /video\/mp4/);
  assert.match(service, /attachmentType.*mimetype\.startsWith\("image\/"\)/s);
  assert.match(service, /mimetype\.startsWith\("video\/"\)/);
});
