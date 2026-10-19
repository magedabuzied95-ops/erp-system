import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// The AI Inbox order composer carries the shipping board's two "+" switches (owner request
// 2026-10-19): "الديبوزت / الشحن مدفوع" and "ابعت رسالة التأكيد على واتساب". They ride only on
// "save invoice", and the route runs them through the board's own runCreateFollowups behind
// the orders page's orders.edit grant.

const composer = fs.readFileSync(new URL("../src/modules/aiSupport/components/InboxOrderComposer.jsx", import.meta.url), "utf8");
const route = fs.readFileSync(new URL("../server/routes/aiAgentOrders.js", import.meta.url), "utf8");

test("the composer sends the switches with save invoice only", () => {
  assert.match(composer, /\.\.\.\(confirm \? \{ send_confirmation: sendConfirmation, payment_received: paymentReceived, payment_received_method: paymentReceivedMethod \} : \{\}\)/);
  assert.match(composer, /orders\.portalBoard\.newOrder\.paidSwitch/);
  assert.match(composer, /orders\.portalBoard\.newOrder\.confirmSwitch/);
});

test("the route runs the board's follow-ups on a saved invoice, gated by orders.edit", () => {
  const start = route.indexOf('router.post("/conversations/:conversationId/create-draft-order"');
  const block = route.slice(start, route.indexOf("const recommendations = await loadAiInboxRecommendations", start));
  assert.match(block, /if \(confirmed && finalOrder\?\.id && \(wantsPayment \|\| wantsConfirmation\)\)/);
  assert.match(block, /if \(await canEditOrders\(req\)\)/);
  assert.match(block, /runCreateFollowups\(\{/);
  assert.match(block, /followups,\r?\n\s*\}\);/);
  assert.match(route, /permit\("orders", "edit"\)\(req, fakeRes/);
});
