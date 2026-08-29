/**
 * The admin-only hard delete ("مسح من الداتا بيز").
 *
 * `deleteProduct` can never really delete a sold product - it falls back to
 * `archiveProductForDelete` the moment any history row exists - so this path is
 * the only one that drops the row, and it is the only one that can silently
 * rewrite a supplier invoice. Three properties have to hold and each is
 * asserted on its own so a regression names the layer that broke:
 *
 *   1. it is admin-only, on a gate no permission row can open;
 *   2. purchase invoice lines go, sales invoice lines stay - the operator's
 *      explicit choice, and the difference between "the model is gone" and
 *      "last quarter's revenue moved";
 *   3. an unclassified or un-nullable reference aborts the run instead of
 *      leaving orphans behind.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { isAdminAccount } from "../server/middleware/authMiddleware.js";
import {
  DETACH_TABLES,
  PURGE_TABLES,
  buildPurchaseImpact,
  executeProductPurge,
} from "../server/lib/productPurgeEngine.js";

const read = (relative) => readFile(new URL(relative, import.meta.url), "utf8");

/* ── 1. the gate ─────────────────────────────────────────────────────────── */

test("only admin-shaped accounts pass the hard-delete gate", () => {
  for (const user of [
    { role: "admin" },
    { role: "super_admin" },
    { role: "super admin" },
    { role: "superadmin" },
    { role_name: "Admin" },
    { role: "cashier", is_super_admin: true },
  ]) {
    assert.equal(isAdminAccount(user), true, `${JSON.stringify(user)} should pass`);
  }

  for (const user of [
    {},
    { role: "cashier" },
    { role: "sales" },
    { role: "warehouse_manager" },
    // A permission grant must not open this gate - `permit()` resolves a user
    // four ways and only one of them is role_permissions.
    { role: "cashier", permissions: ["products.delete", "*"] },
    { role: "cashier", is_super_admin: "true" },
  ]) {
    assert.equal(isAdminAccount(user), false, `${JSON.stringify(user)} should be refused`);
  }
});

test("the purge routes are gated by requireAdmin, not by a products permission", async () => {
  const routes = await read("../server/routes/products.js");
  const lines = routes.split(/\r?\n/).filter((line) => line.includes("/:id/purge"));

  assert.equal(lines.length, 2, "expected exactly the preview and the delete route");
  for (const line of lines) {
    assert.match(line, /\bprotect\b/, `${line.trim()} must authenticate`);
    assert.match(line, /\brequireAdmin\b/, `${line.trim()} must be admin-only`);
    assert.doesNotMatch(line, /\bpermit\(/, `${line.trim()} must not be reachable through a permission grant`);
  }
  assert.match(lines.join("\n"), /router\.get\("\/:id\/purge-preview"/, "preview endpoint present");
  assert.match(lines.join("\n"), /router\.delete\("\/:id\/purge"/, "purge endpoint present");
});

test("the purge cannot run without the typed confirmation", async () => {
  const controller = await read("../server/controllers/productPurgeController.js");
  assert.match(controller, /PURGE_CONFIRMATION_MISMATCH/, "mismatch is rejected by its own code");
  // The comparison must happen before the plan is executed.
  const mismatchAt = controller.indexOf("PURGE_CONFIRMATION_MISMATCH");
  const executeAt = controller.indexOf("executeProductPurge(");
  assert.ok(mismatchAt > -1 && executeAt > mismatchAt, "confirmation is checked before anything is destroyed");
});

/* ── 2. what survives ────────────────────────────────────────────────────── */

test("purchase invoice lines are deleted and sales invoice lines are preserved", () => {
  assert.equal(PURGE_TABLES.has("purchase_items"), true, "purchase lines are removed");
  assert.equal(DETACH_TABLES.has("order_items"), true, "sales lines are kept");

  // The financial record that hangs off a sale must never be deleted with it.
  for (const table of [
    "order_items",
    "return_items",
    "supplier_return_items",
    "accounting_order_item_cost_overrides",
    "employee_commissions",
    "sales_commission_lines",
  ]) {
    assert.equal(DETACH_TABLES.has(table), true, `${table} must be preserved`);
    assert.equal(PURGE_TABLES.has(table), false, `${table} must never be purged`);
  }
});

test("no table is classified both ways", () => {
  const both = [...DETACH_TABLES].filter((table) => PURGE_TABLES.has(table));
  assert.deepEqual(both, [], "a table cannot be both preserved and purged");
});

/* ── 3. the purchase invoice arithmetic ──────────────────────────────────── */

/**
 * `buildPurchaseImpact` reads the schema before it queries, so the fake client
 * answers those three shapes and then returns one canned invoice row.
 */
const fakeClientFor = (invoiceRow) => ({
  query: async (sql) => {
    if (sql.includes("to_regclass")) return { rows: [{ regclass: "t" }] };
    if (sql.includes("information_schema.columns")) {
      return {
        rows: [
          "purchase_id",
          "product_id",
          "variant_id",
          "quantity",
          "unit_cost",
          "cost_price",
          "purchase_number",
          "subtotal",
          "tax_amount",
          "discount_amount",
          "total",
          "paid_amount",
          "remaining_amount",
          "metadata",
        ].map((column_name) => ({ column_name })),
      };
    }
    return { rows: [invoiceRow] };
  },
});

test("a partly purged invoice keeps its header tax and discount and recomputes the total", async () => {
  const [impact] = await buildPurchaseImpact(
    fakeClientFor({
      id: 61,
      purchase_number: "PO-061",
      subtotal: "1540.00",
      tax_amount: "100.00",
      discount_amount: "40.00",
      total: "1600.00",
      paid_amount: "1400.00",
      remaining_amount: "200.00",
      removed_lines: 1,
      removed_value: "520.00",
      removed_quantity: "5",
      kept_lines: 4,
      kept_subtotal: "1020.00",
    }),
    { productIds: [54], variantIds: [] }
  );

  assert.equal(impact.after.subtotal, 1020, "subtotal is the sum of the surviving lines");
  assert.equal(impact.after.tax_amount, 100, "header tax is untouched");
  assert.equal(impact.after.discount_amount, 40, "header discount is untouched");
  assert.equal(impact.after.total, 1080, "total = subtotal + tax - discount");
  assert.equal(impact.after.paid_amount, 1400, "what was paid to the supplier never moves");
  assert.equal(impact.after.remaining_amount, 0, "an overpaid invoice clamps at zero, it does not go negative");
  assert.equal(impact.becomes_empty, false);
});

test("an invoice whose every line belonged to the product is reported as left empty", async () => {
  const [impact] = await buildPurchaseImpact(
    fakeClientFor({
      id: 65,
      purchase_number: "PO-065",
      subtotal: "37500.00",
      tax_amount: "0",
      discount_amount: "0",
      total: "37500.00",
      paid_amount: "0",
      remaining_amount: "37500.00",
      removed_lines: 25,
      removed_value: "37500.00",
      removed_quantity: "150",
      kept_lines: 0,
      kept_subtotal: "0",
    }),
    { productIds: [60], variantIds: [] }
  );

  assert.equal(impact.becomes_empty, true, "the operator is warned before confirming");
  assert.equal(impact.after.total, 0);
});

/* ── 4. the refusals ─────────────────────────────────────────────────────── */

const planWith = (overrides = {}) => ({
  unknown: [],
  willDetach: [],
  willDelete: [],
  references: [],
  purchaseImpact: [],
  salesLineIds: [],
  ...overrides,
});

const throwingClient = {
  query: async () => {
    assert.fail("nothing may be written once the plan is refused");
  },
};

test("an unclassified reference aborts the purge instead of leaving orphans", async () => {
  await assert.rejects(
    executeProductPurge(
      throwingClient,
      { productIds: [1], variantIds: [], product: { id: 1 }, products: [], variants: [] },
      planWith({ unknown: [{ table: "some_new_table", column: "product_id", count: 3 }] })
    ),
    (error) => {
      assert.equal(error.code, "PRODUCT_PURGE_UNCLASSIFIED");
      assert.deepEqual(error.details, [{ table: "some_new_table", column: "product_id", rows: 3 }]);
      return true;
    }
  );
});

test("a preserved table with a NOT NULL product reference aborts rather than violating the constraint", async () => {
  await assert.rejects(
    executeProductPurge(
      throwingClient,
      { productIds: [1], variantIds: [], product: { id: 1 }, products: [], variants: [] },
      planWith({
        willDetach: [{ table: "order_items", column: "product_id", count: 2, notNull: true, kind: "product" }],
      })
    ),
    (error) => {
      assert.equal(error.code, "PRODUCT_PURGE_NOT_NULL_DETACH");
      return true;
    }
  );
});
