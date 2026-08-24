import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// INV-658 confirmed itself 0.8s after we asked the customer to confirm it. Evolution echoes our
// own outgoing message back as a `send.message` webhook with fromMe:true, and that prompt lists
// EVERY action ("✅ تأكيد الطلب / ✏️ تعديل الطلب / ❌ إلغاء الطلب"), so the confirm keywords
// matched our own words. An order may only ever be decided by a real inbound customer message.

const gatewaySource = fs.readFileSync(
  new URL("../server/services/whatsappGatewayService.js", import.meta.url),
  "utf8"
);
const routeSource = fs.readFileSync(
  new URL("../server/routes/whatsappGateway.js", import.meta.url),
  "utf8"
);
const serviceSource = fs.readFileSync(
  new URL("../server/services/whatsappOrderConfirmationService.js", import.meta.url),
  "utf8"
);

// Execute the REAL gate rather than describing it, so neutering the gate fails these tests.
const fnStart = gatewaySource.indexOf("export const mayDecideOrderConfirmation = (message = {}) => {");
assert.ok(fnStart > -1, "mayDecideOrderConfirmation exists");
const fnEnd = gatewaySource.indexOf("\n};", fnStart);
const fnSource = gatewaySource.slice(fnStart, fnEnd + 3).replace("export const", "const");
// eslint-disable-next-line no-new-func
const mayDecideOrderConfirmation = new Function(`${fnSource}\nreturn mayDecideOrderConfirmation;`)();

// The exact echo that confirmed INV-658: our own prompt, returned by Evolution as send.message.
const ownEcho = {
  fromMe: true,
  rawEvent: "send.message",
  remoteJid: "201024960585@s.whatsapp.net",
  messageId: "3EB0ECHO",
  text: "أهلاً ماجد\n\nطلبك جاهز للتأكيد\n\n✅ تأكيد الطلب\n✏️ تعديل الطلب\n❌ إلغاء الطلب",
};

test("our own outgoing confirmation prompt may never decide an order", () => {
  assert.equal(mayDecideOrderConfirmation(ownEcho), false);
});

test("a real customer tap may decide an order", () => {
  assert.equal(
    mayDecideOrderConfirmation({ fromMe: false, text: "✅ تأكيد الطلب", messageId: "3EB0TAP" }),
    true
  );
});

test("a message with no text decides nothing", () => {
  assert.equal(mayDecideOrderConfirmation({ fromMe: false, text: "   " }), false);
  assert.equal(mayDecideOrderConfirmation({ fromMe: false }), false);
});

test("a malformed payload decides nothing", () => {
  assert.equal(mayDecideOrderConfirmation(null), false);
  assert.equal(mayDecideOrderConfirmation(undefined), false);
  assert.equal(mayDecideOrderConfirmation("confirm"), false);
});

test("the webhook route gates the confirmation parser on that helper", () => {
  const handler = routeSource.slice(
    routeSource.indexOf('router.post("/webhook"'),
    routeSource.indexOf("export default router")
  );
  assert.match(handler, /const mayDecide = mayDecideOrderConfirmation\(normalized\)/);
  assert.match(handler, /mayDecide\s*\n?\s*\?\s*await processConfirmationReply/);
  assert.match(routeSource, /mayDecideOrderConfirmation,/);
});

test("processConfirmationReply refuses a fromMe message before reading any order", () => {
  const start = serviceSource.indexOf("export const processConfirmationReply = async (message = {}) => {");
  assert.ok(start > -1);
  const head = serviceSource.slice(start, start + 900);
  const guardIndex = head.indexOf("message.fromMe === true");
  const orderLoadIndex = head.indexOf("loadConfirmationOrder");
  assert.ok(guardIndex > -1, "fromMe guard exists");
  assert.ok(orderLoadIndex === -1 || guardIndex < orderLoadIndex, "guard runs before the order lookup");
  assert.match(head, /return \{ action: "ignored", reason: "own_outgoing_message" \}/);
});

// Documents WHY the echo was dangerous: the prompt really does carry the confirm keyword.
test("the outgoing confirmation prompt contains the keyword it must not match", () => {
  const messageBuilder = fs.readFileSync(
    new URL("../server/utils/orderConfirmationMessage.js", import.meta.url),
    "utf8"
  );
  assert.match(messageBuilder, /تأكيد الطلب/);
});

test("the AI auto-reply keeps its own fromMe guard", () => {
  const start = gatewaySource.indexOf("export const triggerWhatsappAiAutoReply");
  const body = gatewaySource.slice(start, start + 3000);
  assert.match(body, /if \(message\?\.fromMe === true\)/);
  assert.match(body, /reason: "from_me"/);
});
