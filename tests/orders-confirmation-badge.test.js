import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// "Did the customer confirm?" cannot be read from `status`: ORDER_STATUS_ALIASES maps
// paid -> confirmed, so every paid POS invoice would falsely read as customer-confirmed.
// These guards pin the timestamp-driven rule and its wiring into the orders list.

const badgeSource = fs.readFileSync(
  new URL("../src/modules/orders/components/ConfirmationBadge.jsx", import.meta.url),
  "utf8"
);
const dashboardSource = fs.readFileSync(
  new URL("../src/modules/orders/pages/OrdersDashboard.jsx", import.meta.url),
  "utf8"
);
const arLocale = JSON.parse(
  fs.readFileSync(new URL("../src/locales/ar/orders.json", import.meta.url), "utf8")
);
const enLocale = JSON.parse(
  fs.readFileSync(new URL("../src/locales/en/orders.json", import.meta.url), "utf8")
);

// Run the REAL getConfirmationState body rather than a re-implementation.
const fnStart = badgeSource.indexOf("export const getConfirmationState = (order = {}) => {");
assert.ok(fnStart > -1, "getConfirmationState exists");
const fnEnd = badgeSource.indexOf("\n};", fnStart);
const fnSource = badgeSource.slice(fnStart, fnEnd + 3).replace("export const", "const");
// eslint-disable-next-line no-new-func
const getConfirmationState = new Function(`${fnSource}\nreturn getConfirmationState;`)();

test("a paid POS invoice never claims the customer confirmed", () => {
  // status "confirmed" here comes from the paid -> confirmed alias, not from any customer
  assert.equal(getConfirmationState({ status: "confirmed", payment_status: "paid" }), null);
  assert.equal(getConfirmationState({ status: "Paid" }), null);
});

test("a real customer confirmation is driven by whatsapp_confirmed_at", () => {
  const state = getConfirmationState({ status: "confirmed", whatsapp_confirmed_at: "2026-08-24T21:35:29Z" });
  assert.equal(state.key, "confirmed");
  assert.equal(state.labelKey, "orders.confirmation.confirmed");
});

test("a cancellation wins over a stale confirmed timestamp", () => {
  const state = getConfirmationState({
    status: "cancelled_by_customer",
    whatsapp_confirmed_at: "2026-08-24T21:00:00Z",
    whatsapp_cancelled_at: "2026-08-24T21:40:00Z",
  });
  assert.equal(state.key, "cancelled");
});

test("an edit request is its own state, not silence", () => {
  const state = getConfirmationState({ status: "edit_requested", whatsapp_confirmation_sent_at: "2026-08-24T21:00:00Z" });
  assert.equal(state.key, "edit_requested");
});

test("a sent-but-unanswered request reads as awaiting", () => {
  const state = getConfirmationState({ status: "pending_confirmation", whatsapp_confirmation_sent_at: "2026-08-24T21:00:00Z" });
  assert.equal(state.key, "awaiting");
});

test("a COD order whose confirmation request never left is visible, not hidden", () => {
  const state = getConfirmationState({ status: "pending_confirmation" });
  assert.equal(state.key, "not_sent");
});

test("orders outside the confirmation flow render nothing", () => {
  for (const status of ["pending", "shipped", "delivered", "returned", ""]) {
    assert.equal(getConfirmationState({ status }), null, `status ${status} should be silent`);
  }
});

test("every state has an Arabic and English label", () => {
  const states = [
    { status: "cancelled_by_customer" },
    { whatsapp_confirmed_at: "x" },
    { status: "edit_requested" },
    { status: "pending_confirmation", whatsapp_confirmation_sent_at: "x" },
    { status: "pending_confirmation" },
  ].map((order) => getConfirmationState(order));
  for (const state of states) {
    const key = state.labelKey.replace("orders.", "").split(".");
    assert.ok(key.reduce((node, part) => node?.[part], arLocale), `missing ar label for ${state.key}`);
    assert.ok(key.reduce((node, part) => node?.[part], enLocale), `missing en label for ${state.key}`);
  }
});

test("the orders list renders the badge in both the table and the kanban card", () => {
  assert.match(dashboardSource, /import ConfirmationBadge from "\.\.\/components\/ConfirmationBadge"/);
  const customerCell = dashboardSource.slice(
    dashboardSource.indexOf("function CustomerCell"),
    dashboardSource.indexOf("function PhoneCell")
  );
  assert.match(customerCell, /<ConfirmationBadge order=\{order\} \/>/);
  const kanbanCard = dashboardSource.slice(
    dashboardSource.indexOf("function CompactOrderCard"),
    dashboardSource.indexOf("function Timeline")
  );
  assert.match(kanbanCard, /<ConfirmationBadge order=\{order\} compact \/>/);
});
