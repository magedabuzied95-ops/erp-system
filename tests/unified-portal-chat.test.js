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

test("shared chat keeps the WhatsApp-style composer focused on attachments and voice", async () => {
  const [composer, attachment, utils, upload, service] = await Promise.all([
    source("src/shared/chat/PortalChatComposer.jsx"),
    source("src/shared/chat/PortalChatAttachment.jsx"),
    source("src/shared/chat/portalChatUtils.js"),
    source("server/config/employeeChatUpload.js"),
    source("server/services/employeeChatService.js"),
  ]);
  assert.doesNotMatch(composer, /capture="environment"/);
  assert.doesNotMatch(composer, /QUICK_EMOJIS/);
  assert.match(composer, /Paperclip/);
  assert.match(composer, /WhatsAppRecordingBar/);
  assert.match(attachment, /<video/);
  assert.match(utils, /video\/quicktime/);
  assert.match(upload, /video\/mp4/);
  assert.match(service, /attachmentType.*mimetype\.startsWith\("image\/"\)/s);
  assert.match(service, /mimetype\.startsWith\("video\/"\)/);
});

test("employee chat uses the M1 WhatsApp-style header and doodle background", async () => {
  const [portal, styles] = await Promise.all([
    source("src/modules/employees/pages/EmployeePayrollPortal.jsx"),
    source("src/modules/employees/pages/EmployeePayrollPortal.m1.css"),
  ]);
  assert.match(portal, /employee-chat-whatsapp-header/);
  assert.match(portal, /m-one-logo-white-fixed\.png/);
  assert.match(portal, /m-one-logo-white-m\.png/);
  assert.match(portal, /visualViewport/);
  assert.match(portal, /employee-chat-whatsapp-background/);
  assert.match(styles, /--wa-outgoing: #005c4b/);
  assert.match(styles, /background-image: url\("data:image\/svg\+xml/);
  assert.match(styles, /employee-chat-keyboard-open/);
});

test("shared portal chat recognizes secure links and keeps native open-copy behavior", async () => {
  const [messageList, utils] = await Promise.all([
    source("src/shared/chat/PortalChatMessageList.jsx"),
    source("src/shared/chat/portalChatUtils.js"),
  ]);
  assert.match(utils, /export const portalChatTextParts/);
  assert.match(utils, /https\?:\\\/\\\//);
  assert.match(messageList, /portalChatTextParts\(body\)/);
  assert.match(messageList, /target="_blank"/);
  assert.match(messageList, /rel="noopener noreferrer"/);
  assert.match(messageList, /select-text/);
  assert.match(messageList, /onTouchStart=.*stopPropagation/);
});

test("manager employee chat opens as a full-screen mobile conversation", async () => {
  const [sharedChat, managerPortal, composer] = await Promise.all([
    source("src/shared/chat/SharedPortalChat.jsx"),
    source("src/modules/managerPortal/pages/ManagerPortal.jsx"),
    source("src/shared/chat/PortalChatComposer.jsx"),
  ]);
  assert.match(managerPortal, /<SharedPortalChat[\s\S]*?mobileFullScreen/);
  assert.match(sharedChat, /mobileConversationOpen/);
  assert.match(sharedChat, /fixed inset-0 z-\[80\] h-\[100dvh\]/);
  assert.match(sharedChat, /data-mobile-conversation-open/);
  assert.match(sharedChat, /الرجوع إلى محادثات الموظفين/);
  assert.match(sharedChat, /setMobileConversationOpen\(false\)/);
  assert.match(sharedChat, /document\.body\.style\.overflow = "hidden"/);
  assert.match(sharedChat, /safe-area-inset-top/);
  assert.match(composer, /safe-area-inset-bottom/);
});

test("employee chat supports WhatsApp-style search and message management", async () => {
  const [sharedChat, messageList, employeePortal, employeeRoute, service] = await Promise.all([
    source("src/shared/chat/SharedPortalChat.jsx"),
    source("src/shared/chat/PortalChatMessageList.jsx"),
    source("src/modules/employees/pages/EmployeePayrollPortal.jsx"),
    source("server/routes/employeePortal.js"),
    source("server/services/employeeChatService.js"),
  ]);
  assert.match(sharedChat, /threadSearch/);
  assert.match(sharedChat, /messageSearch/);
  assert.match(messageList, /onEdit/);
  assert.match(messageList, /onDelete/);
  assert.match(messageList, /تم حذف هذه الرسالة/);
  assert.match(employeePortal, /editingChatMessage/);
  assert.match(employeeRoute, /chat\/messages\/:messageId/);
  assert.match(service, /employee-chat:message-updated/);
  assert.match(service, /employee-chat:message-deleted/);
});

test("mobile message actions render outside the scroll area in a bottom sheet", async () => {
  const messageList = await source("src/shared/chat/PortalChatMessageList.jsx");
  assert.match(messageList, /createPortal/);
  assert.match(messageList, /fixed inset-0 z-\[140\]/);
  assert.match(messageList, /safe-area-inset-bottom/);
  assert.match(messageList, /dir="ltr" className=\{`flex items-end/);
  assert.match(messageList, /setActiveMessage\(message\)/);
  assert.match(messageList, /closest\("a, button, input, audio, video"\)/);
  assert.doesNotMatch(messageList, /className="mb-1 grid h-8 w-8 shrink-0 place-items-center/);
});
