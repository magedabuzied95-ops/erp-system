import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  buildPosDiscountLimitMessage,
  describeTerminalTransactionLinkRejection,
  evaluatePosDiscountLimit,
  readPosDiscountLimitSettings,
  resolveEditedOrderStatus,
} from "../server/utils/posCheckoutGuards.js";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const controller = read("../server/controllers/ordersController.js");
const posController = read("../server/controllers/posController.js");
const movementService = read("../server/services/inventoryMovementService.js");
const permissionMiddleware = read("../server/middleware/permissionMiddleware.js");

const slice = (source, startMarker, endMarker) => {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `missing ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `missing ${endMarker}`);
  return source.slice(start, end);
};

const resolverSource = () => slice(controller, "const resolveOrderLineStock = async", "const assertResolvedStockCoversLines");
const batchSource = () => slice(controller, "const resolveOrderLinesStockBatch = async", "const bulkInsertOrderItems");
const bulkApplySource = () => slice(controller, "const bulkApplyInventoryChanges = async", "const runPostOrderSideEffects");
const createOrderSource = () => slice(controller, "export const createOrder = async", "export const getShiftReport");
const editOrderSource = () => slice(controller, "export const editOrder = async", "const shipmentActionStatus");

// ---------------------------------------------------------------- 1. stock race

test("every stock read in resolveOrderLineStock locks the row it returns", () => {
  const source = resolverSource();
  const selects = source.match(/SELECT[\s\S]*?`/g) || [];
  assert.equal(selects.length, 4, "variant-id, lookup, product and default-variant reads");
  for (const select of selects) {
    assert.match(select, /FOR UPDATE/, `unlocked read: ${select.slice(0, 120)}`);
  }
});

test("the fallback resolvers reject insufficient stock with the fast path's text", () => {
  const source = batchSource();
  const legacyFallback = slice(source, "if (lineInputs.some((line) => line.requiresLegacyLookup))", "const variantIds");
  assert.match(legacyFallback, /assertResolvedStockCoversLines\(items, fallback\)/);
  const legacyBatch = slice(source, "const resolveOrderLinesStockBatchLegacy = async", "return stockByLineKey;");
  assert.match(legacyBatch, /assertResolvedStockCoversLines\(items, stockByLineKey\)/);
});

test("assertResolvedStockCoversLines sums lines per stock row and throws 'Not enough stock'", () => {
  const fnSource = slice(controller, "const assertResolvedStockCoversLines = ", "const resolveOrderLinesStockBatch = async");
  // eslint-disable-next-line no-new-func
  const assertCovers = new Function(`${fnSource}; return assertResolvedStockCoversLines;`)();
  const variant = { type: "variant", variantId: 9, productId: 1, stock: 3 };
  const lines = new Map([["0", variant], ["1", variant]]);
  assert.doesNotThrow(() => assertCovers([{ quantity: 2 }, { quantity: 1 }], lines));
  assert.throws(
    () => assertCovers([{ quantity: 2 }, { quantity: 2 }], lines),
    (error) => error.status === 400 && /not enough stock/i.test(error.message) && error.message.includes("variant:9")
  );
  // The offline replay routes on this text.
  assert.match(createOrderSource(), /includes\("not enough stock"\)[\s\S]*OFFLINE_REPLAY_STOCK_CONFLICT/);
});

test("the sale writes stock relative to the row, never an absolute figure", () => {
  const source = bulkApplySource();
  assert.match(source, /SET stock = COALESCE\(pv\.stock, 0\) - data\.quantity/);
  assert.match(source, /SET stock = COALESCE\(p\.stock, 0\) - data\.quantity/);
  assert.doesNotMatch(source, /SET stock = data\.quantity_after/);
});

// ------------------------------------------------------- 2. archived variants

test("new sale lines still require an active variant; restores may resolve archived ones", () => {
  assert.match(resolverSource(), /const activeVariantClause = allowArchived \? "" : "AND pv\.is_active IS DISTINCT FROM FALSE AND pv\.deleted_at IS NULL"/);
  assert.match(resolverSource(), /allowArchived = false/);
  // createOrder's resolvers never pass it.
  assert.doesNotMatch(batchSource(), /allowArchived/);
  const edit = editOrderSource();
  assert.match(edit, /for \(const item of oldItems\) \{[\s\S]*?resolveOrderLineStock\(client, \{ tenantId, item, allowArchived: true \}\)/);
  assert.match(edit, /for \(const item of newItems\) \{[\s\S]*?allowArchived: editLineMayUseArchivedVariant\(item\)/);
  assert.match(edit, /\(newQuantityByVariantId\.get\(variantKey\) \|\| 0\) <= oldQuantityByVariantId\.get\(variantKey\)/);
  assert.match(controller, /resolveOrderLineStock\(client, \{ tenantId, item: original, allowArchived: true \}\)/);
  assert.match(controller, /resolveOrderLineStock\(client, \{ tenantId, item: originalItem, allowArchived: true \}\)/);
});

test("a restock reaches an archived variant row through the inventory ledger", () => {
  const applyStockDelta = slice(controller, "const applyStockDelta = async", "export const getRecentPosOrders");
  assert.match(applyStockDelta, /includeArchived: Number\(delta\) > 0 \|\| stockLine\.allowArchived === true,/);
  // Only the resolver's own permission carries through — the variant returns tag it.
  const variantReturns = resolverSource().match(/type: "variant",[\s\S]*?\};/g) || [];
  assert.equal(variantReturns.length, 3);
  for (const block of variantReturns) assert.match(block, /\ballowArchived,\s*\};/);
  assert.match(movementService, /const activeClause = data\.includeArchived !== true && variantColumns\.has\("is_active"\)/);
});

// ------------------------------------------------------------- 3. edit status

test("payment words never land in orders.status on an edit", () => {
  assert.equal(resolveEditedOrderStatus("Paid", { treatPendingAsPayment: true }), null);
  assert.equal(resolveEditedOrderStatus("Partial", { treatPendingAsPayment: true }), null);
  assert.equal(resolveEditedOrderStatus("Pending", { treatPendingAsPayment: true }), null);
  assert.equal(resolveEditedOrderStatus("Paid"), null);
  assert.equal(resolveEditedOrderStatus("pending"), "pending");
  assert.equal(resolveEditedOrderStatus("Delivered"), "delivered");
  assert.equal(resolveEditedOrderStatus("completed"), "delivered");
  assert.equal(resolveEditedOrderStatus("banana"), null);
  assert.equal(resolveEditedOrderStatus(""), null);
  const edit = editOrderSource();
  assert.match(edit, /status = COALESCE\(\$9::text, status\)/);
  assert.match(edit, /resolveEditedOrderStatus\(req\.body\.status, \{ treatPendingAsPayment: true \}\)/);
  assert.doesNotMatch(edit, /\n\s*req\.body\.status \|\| null,/);
  assert.match(edit, /status: Object\.prototype\.hasOwnProperty\.call\(req\.body, "status"\) \? resolveEditedOrderStatus\(req\.body\.status\) \|\| loaded\.order\.status/);
});

// ------------------------------------------------------------ 4. paymob link

test("a Paymob transaction links only to a same-tenant, successful, unused, same-amount sale", () => {
  const ok = { tenant_id: 7, status: "success", order_id: null, amount_cents: 150000, confirmed_amount_cents: null };
  assert.equal(describeTerminalTransactionLinkRejection(ok, { tenantId: 7, saleCardAmount: 1500 }), null);
  assert.equal(describeTerminalTransactionLinkRejection({ ...ok, status: "success_manual_confirmed" }, { tenantId: "7", saleCardAmount: "1500.00" }), null);
  assert.equal(describeTerminalTransactionLinkRejection(null, { tenantId: 7, saleCardAmount: 1500 }), "not_found");
  assert.equal(describeTerminalTransactionLinkRejection({ ...ok, tenant_id: 8 }, { tenantId: 7, saleCardAmount: 1500 }), "tenant_mismatch");
  assert.equal(describeTerminalTransactionLinkRejection({ ...ok, status: "failed" }, { tenantId: 7, saleCardAmount: 1500 }), "not_successful");
  assert.equal(describeTerminalTransactionLinkRejection({ ...ok, status: "sent" }, { tenantId: 7, saleCardAmount: 1500 }), "not_successful");
  assert.equal(describeTerminalTransactionLinkRejection({ ...ok, order_id: 55 }, { tenantId: 7, saleCardAmount: 1500 }), "already_linked");
  assert.equal(describeTerminalTransactionLinkRejection({ ...ok, order_id: 55 }, { tenantId: 7, saleCardAmount: 1500, orderId: 55 }), null);
  assert.equal(describeTerminalTransactionLinkRejection(ok, { tenantId: 7, saleCardAmount: 15 }), "amount_mismatch");
  assert.equal(describeTerminalTransactionLinkRejection(ok, { tenantId: 7, saleCardAmount: 0 }), "amount_mismatch");
  assert.equal(describeTerminalTransactionLinkRejection({ ...ok, confirmed_amount_cents: 90000 }, { tenantId: 7, saleCardAmount: 1500 }), "amount_mismatch");
});

test("createOrder checks the Paymob transaction before inserting the order and guards the link UPDATE", () => {
  const source = createOrderSource();
  const check = source.indexOf("describeTerminalTransactionLinkRejection(terminalTransaction");
  const insert = source.indexOf("INSERT INTO orders (");
  assert.ok(check > 0 && insert > check, "the check runs before the order insert");
  assert.match(source, /FROM payment_transactions\s+WHERE id = \$1\s+AND provider = 'paymob'\s+FOR UPDATE/);
  assert.match(source, /code: "PAYMOB_TRANSACTION_NOT_LINKABLE"/);
  assert.match(source, /AND tenant_id = \$3::bigint\s+AND \(order_id IS NULL OR order_id = \$2\)\s+AND LOWER\(COALESCE\(status, ''\)\) = ANY\(\$4::text\[\]\)/);
  assert.match(posController, /const terminalFinalStatuses = new Set\(\["success", "success_manual_confirmed"\]\)/);
});

// ------------------------------------------------------------- 5. savepoints

test("best-effort accounting inside the sale transaction runs under a savepoint", () => {
  const source = createOrderSource();
  const wallet = slice(source, 'SAVEPOINT pos_wallet_liability_entry");', "if (Number(loyalty_points_redeemed");
  assert.match(wallet, /await postWalletLiabilityEntry\(client/);
  assert.match(wallet, /RELEASE SAVEPOINT pos_wallet_liability_entry/);
  assert.match(wallet, /catch \(walletAccountingError\) \{\s*await client\.query\("ROLLBACK TO SAVEPOINT pos_wallet_liability_entry"\)/);
  const loyalty = slice(source, 'SAVEPOINT pos_checkout_loyalty");', "} else {");
  assert.match(loyalty, /catch \(loyaltyError\) \{\s*await client\.query\("ROLLBACK TO SAVEPOINT pos_checkout_loyalty"\)/);
});

// -------------------------------------------------------- 7. discount limits

test("discount limit: percent of the gross subtotal against the store settings", () => {
  assert.equal(evaluatePosDiscountLimit({ grossSubtotal: 1000, manualDiscount: 200, maxDiscountPercent: 20 }).exceeded, false);
  const over = evaluatePosDiscountLimit({ grossSubtotal: 1000, manualDiscount: 250, maxDiscountPercent: 20 });
  assert.deepEqual([over.exceeded, over.reason, over.percent], [true, "max_percent", 25]);
  const disabled = evaluatePosDiscountLimit({ grossSubtotal: 1000, manualDiscount: 10, allowDiscount: false });
  assert.deepEqual([disabled.exceeded, disabled.reason], [true, "discount_disabled"]);
  assert.equal(evaluatePosDiscountLimit({ grossSubtotal: 1000, manualDiscount: 0, allowDiscount: false }).exceeded, false);
  // An edit keeps the share the invoice already carried, but cannot raise it.
  assert.equal(evaluatePosDiscountLimit({ grossSubtotal: 1000, manualDiscount: 300, maxDiscountPercent: 20, previousPercent: 30 }).exceeded, false);
  assert.equal(evaluatePosDiscountLimit({ grossSubtotal: 1000, manualDiscount: 350, maxDiscountPercent: 20, previousPercent: 30 }).exceeded, true);
  assert.match(buildPosDiscountLimitMessage(over), /25%.*20%/);
});

test("discount settings are coerced from however they were stored", async () => {
  const store = { "pos.allow_discount": "false", "pos.max_discount_percent": "15" };
  const settings = await readPosDiscountLimitSettings(async (key, fallback) => (key in store ? store[key] : fallback));
  assert.deepEqual(settings, { allowDiscount: false, maxDiscountPercent: 15 });
  const defaults = await readPosDiscountLimitSettings(async (_key, fallback) => fallback);
  assert.deepEqual(defaults, { allowDiscount: true, maxDiscountPercent: 20 });
});

test("createOrder enforces the limit on item + invoice discount, managers bypass, offline replays pass", () => {
  const source = createOrderSource();
  const block = slice(source, "const discountLimitCheck = evaluatePosDiscountLimit({", "// Loyalty money is points");
  assert.match(block, /manualDiscount: itemDiscountAmount \+ normalizedInvoiceDiscountAmount,/);
  assert.doesNotMatch(block, /coupon|verifiedLoyaltyDiscount/i);
  assert.match(block, /canOverridePosDiscount\(client, req\.user\?\.id \|\| null\)/);
  assert.match(block, /if \(offline_origin\) \{\s*console\.warn\("\[orders:discount-limit-offline-accepted\]"/);
  assert.match(block, /res\.status\(403\)\.json\(\{[\s\S]*code: "POS_DISCOUNT_LIMIT"/);
  assert.ok(source.indexOf("const discountLimitCheck") < source.indexOf("INSERT INTO orders ("));
});

test("editOrder enforces the same limit before rewriting the invoice", () => {
  const source = editOrderSource();
  const block = slice(source, "const editDiscountLimitCheck = evaluatePosDiscountLimit({", "const serviceValue");
  assert.match(block, /manualDiscount: discountValue,/);
  assert.match(block, /code: "POS_DISCOUNT_LIMIT"/);
  assert.match(block, /canOverridePosDiscount\(client, req\.user\?\.id \|\| null\)/);
  assert.ok(source.indexOf("const editDiscountLimitCheck") < source.indexOf("DELETE FROM order_items"));
});

test("the discount override is its own permission, never orders:edit", () => {
  const fn = slice(posController, "export const canOverridePosDiscount", "const listPosSellerCandidates");
  assert.match(fn, /"pos:discount_override", "pos\.discount_override"/);
  assert.doesNotMatch(fn, /orders[:.]edit/);
  assert.match(permissionMiddleware, /\["pos", "discount_override"\]/);
});
