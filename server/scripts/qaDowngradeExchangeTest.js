import "dotenv/config";

import assert from "node:assert/strict";

import db from "../database/db.js";
import { createOrder, returnOrder, permanentDeleteOrder } from "../controllers/ordersController.js";
import { buildPosShiftReport } from "../controllers/posController.js";
import { ensureAccountingSchema, getCurrentCashDrawerShift } from "../services/accountingService.js";

/*
 * Downgrade exchange, end to end, against the real controllers.
 *
 *   1. sell an item for cash
 *   2. customer returns it and takes a cheaper one -- the shop hands back the
 *      difference in cash
 *   3. delete the whole thing and prove nothing was left behind
 *
 * Everything it creates is tagged QA_DOWNGRADE_EXCHANGE and removed at the end,
 * including on failure. Pass --keep to leave the data in place for inspection.
 */

const QA_TAG = "QA_DOWNGRADE_EXCHANGE";
const KEEP = process.argv.includes("--keep");

const money = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

const createMockResponse = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  const res = {
    statusCode: 200,
    headersSent: false,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.headersSent = true; resolve({ statusCode: this.statusCode, payload }); return payload; },
    send(payload) { this.headersSent = true; resolve({ statusCode: this.statusCode, payload }); return payload; },
  };
  return { res, promise };
};

const invokeController = async (handler, req) => {
  const { res, promise } = createMockResponse();
  const controllerPromise = Promise.resolve(handler(req, res));
  const result = await Promise.race([
    promise,
    controllerPromise.then(() => null),
    new Promise((_, reject) => setTimeout(() => reject(new Error("Controller timeout")), 60000)),
  ]);
  if (!result) throw new Error("Controller returned without sending a response");
  await controllerPromise.catch(() => {});
  return result;
};

const waitFor = async (predicate, label, timeoutMs = 20000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`timed out waiting for ${label}`);
};

const ledgerBalances = async (client, tenantId) => {
  const result = await client.query(
    `
    SELECT a.code, a.name,
           COALESCE(SUM(COALESCE(jel.debit,0) - COALESCE(jel.credit,0)), 0)::numeric AS balance
    FROM accounts a
    LEFT JOIN journal_entry_lines jel ON jel.account_id = a.id
    LEFT JOIN journal_entries je ON je.id = jel.journal_entry_id AND je.tenant_id = $1
    WHERE a.tenant_id = $1
    GROUP BY a.code, a.name
    ORDER BY a.code
    `,
    [tenantId]
  );
  return Object.fromEntries(result.rows.map((r) => [r.code, money(r.balance)]));
};

const variantStock = async (client, variantId) => {
  const r = await client.query(`SELECT stock FROM product_variants WHERE id = $1`, [variantId]);
  return Number(r.rows[0]?.stock ?? 0);
};

const shiftExpected = async (client, tenantId, shiftId) => {
  const report = await buildPosShiftReport(client, { tenantId, shiftId });
  return money(report.shift?.expected_cash);
};

// returnIds must be captured BEFORE the delete: `returns` cascades away with the
// order, so afterwards a subquery would find nothing and hide any orphans.
const rowCounts = async (client, orderId, returnIds = []) => {
  const counts = {};
  const ids = returnIds.length ? returnIds : [-1];
  // Each query carries its own params -- postgres rejects a bind that supplies
  // more parameters than the statement actually references.
  for (const [label, sql, params] of [
    ["orders", `SELECT count(*) FROM orders WHERE id = $1`, [orderId]],
    ["order_items", `SELECT count(*) FROM order_items WHERE order_id = $1`, [orderId]],
    ["returns", `SELECT count(*) FROM returns WHERE order_id = $1`, [orderId]],
    ["journal_entries", `SELECT count(*) FROM journal_entries WHERE reference_type IN ('order','sale') AND reference_id = $1`, [orderId]],
    ["money_transactions", `SELECT count(*) FROM money_transactions WHERE reference_type IN ('order','sale') AND reference_id = $1`, [orderId]],
    ["shift_events", `SELECT count(*) FROM cash_drawer_shift_events WHERE source_id = $1 AND LOWER(source_type) IN ('order','invoice','pos_order','sale')`, [orderId]],
    ["inventory_movements", `SELECT count(*) FROM inventory_movements WHERE reference_type IN ('order','sale') AND reference_id = $1`, [orderId]],
    // The return's own accounting is keyed by the RETURN id, not the order id --
    // if the delete misses these, an order's refund outlives the order.
    ["return_journal_entries", `SELECT count(*) FROM journal_entries WHERE reference_type LIKE '%return%' AND reference_id = ANY($1::bigint[])`, [ids]],
    ["return_money_transactions", `SELECT count(*) FROM money_transactions WHERE reference_type LIKE '%return%' AND reference_id = ANY($1::bigint[])`, [ids]],
    ["return_shift_events", `SELECT count(*) FROM cash_drawer_shift_events WHERE LOWER(source_type) = 'return' AND source_id = ANY($1::bigint[])`, [ids]],
  ]) {
    const r = await client.query(sql, params);
    counts[label] = Number(r.rows[0].count);
  }
  return counts;
};

const report = [];
const check = (label, actual, expected) => {
  const pass = Math.abs(Number(actual) - Number(expected)) < 0.009;
  report.push({ label, expected, actual, pass });
  return pass;
};

const run = async () => {
  await ensureAccountingSchema();
  const client = await db.connect();
  let orderId = null;

  try {
    const tenantId = 1;
    const admin = (await client.query(`SELECT id, name FROM users WHERE tenant_id=$1 ORDER BY id LIMIT 1`, [tenantId])).rows[0];
    assert.ok(admin, "need a user to act as the cashier");

    const branchId = (await client.query(`SELECT id FROM branches WHERE tenant_id=$1 ORDER BY id LIMIT 1`, [tenantId])).rows[0]?.id;
    const shift = await getCurrentCashDrawerShift(client, { tenantId, userId: admin.id, branchId });

    // Checkout refuses without an active salesperson for the branch.
    const seller = (await client.query(
      `
      SELECT e.id, e.full_name
      FROM employees e
      LEFT JOIN employee_sales_profiles esp ON esp.employee_id = e.id
      WHERE e.tenant_id = $1 AND e.status = 'active'
        AND e.is_deleted IS DISTINCT FROM TRUE
        AND COALESCE(esp.is_sales_active, TRUE) = TRUE
        AND e.branch_id = $2
      ORDER BY e.id LIMIT 1
      `,
      [tenantId, branchId]
    )).rows[0];
    assert.ok(seller, "need an active salesperson for this branch");

    // Two variants of different value, both with stock and a known cost.
    const eligible = `
      SELECT v.id, v.product_id, v.stock, v.cost_price, COALESCE(NULLIF(v.price,0), p.price) AS price, p.name
      FROM product_variants v
      JOIN products p ON p.id = v.product_id
      WHERE v.stock >= 2 AND COALESCE(v.cost_price,0) > 0 AND COALESCE(NULLIF(v.price,0), p.price) > 0
    `;
    const expensive = (await client.query(`${eligible} ORDER BY price DESC, v.id LIMIT 1`)).rows[0];
    const cheap = (await client.query(`${eligible} ORDER BY price ASC, v.id LIMIT 1`)).rows[0];
    assert.ok(expensive && cheap, "need one expensive and one cheaper variant");
    assert.ok(Number(cheap.price) < Number(expensive.price), "the exchange target must be cheaper");

    const sellPrice = money(expensive.price);
    const cheapPrice = money(cheap.price);
    const difference = money(sellPrice - cheapPrice);

    console.log(`\n[setup] sell "${expensive.name}" @ ${sellPrice}, exchange for "${cheap.name}" @ ${cheapPrice}, cash back ${difference}`);
    console.log(`[setup] cashier=${admin.name} branch=${branchId} shift=${shift?.id ?? "none"}\n`);

    const before = {
      ledger: await ledgerBalances(client, tenantId),
      stockExpensive: await variantStock(client, expensive.id),
      stockCheap: await variantStock(client, cheap.id),
      shift: shift ? await shiftExpected(client, tenantId, shift.id) : null,
    };

    // ---- 1. the sale --------------------------------------------------------
    const saleReq = {
      body: {
        tenant_id: tenantId,
        branch_id: branchId,
        customer_name: "QA Downgrade Exchange",
        channel: "pos",
        status: "completed",
        payment_status: "paid",
        payment_method: "cash",
        notes: QA_TAG,
        sales_employee_id: seller.id,
        salesperson_id: seller.id,
        salesperson_name: seller.full_name,
        subtotal: sellPrice,
        discount_amount: 0,
        tax_amount: 0,
        service_fee: 0,
        paid_amount: sellPrice,
        payment_breakdown: [{ method: "cash", amount: sellPrice }],
        items: [{
          product_id: expensive.product_id,
          variant_id: expensive.id,
          quantity: 1,
          price: sellPrice,
          unit_price: sellPrice,
          sale_price: sellPrice,
          total_amount: sellPrice,
          line_total: sellPrice,
        }],
      },
      user: { id: admin.id, name: admin.name, role: "admin", tenant_id: tenantId },
      headers: {}, ip: "127.0.0.1", socket: { remoteAddress: "127.0.0.1" },
    };
    const saleRes = await invokeController(createOrder, saleReq);
    assert.equal(saleRes.statusCode, 201, `sale failed: ${JSON.stringify(saleRes.payload)?.slice(0, 300)}`);
    const order = saleRes.payload?.data || saleRes.payload?.order;
    orderId = order.id;
    console.log(`[1/3] sold  → order #${orderId} (${order.invoice_number}) for ${sellPrice} cash`);

    // createOrder fires its side effects with `void ...` and answers before they
    // finish, so the sale journal entry lands after the response. Wait for it
    // rather than racing it -- a real server stays up, this script does not.
    await waitFor(
      async () => (await client.query(
        `SELECT 1 FROM journal_entries WHERE reference_type='order' AND reference_id=$1`,
        [orderId]
      )).rowCount > 0,
      "sale journal entry"
    );

    const afterSale = {
      ledger: await ledgerBalances(client, tenantId),
      stockExpensive: await variantStock(client, expensive.id),
      shift: shift ? await shiftExpected(client, tenantId, shift.id) : null,
    };
    const soldCogs = money(expensive.cost_price);

    check("sale: Cash debited", afterSale.ledger["1000"] - before.ledger["1000"], sellPrice);
    check("sale: Revenue credited", -(afterSale.ledger["4000"] - before.ledger["4000"]), sellPrice);
    check("sale: COGS debited", afterSale.ledger["5000"] - before.ledger["5000"], soldCogs);
    check("sale: Inventory credited", -(afterSale.ledger["1200"] - before.ledger["1200"]), soldCogs);
    check("sale: stock down 1", before.stockExpensive - afterSale.stockExpensive, 1);
    if (shift) check("sale: drawer up by the sale", afterSale.shift - before.shift, sellPrice);

    // ---- 2. the exchange: return the item, refund the difference in cash ----
    const orderItemId = (await client.query(`SELECT id FROM order_items WHERE order_id=$1 LIMIT 1`, [orderId])).rows[0].id;
    const exchangeReq = {
      params: { id: String(orderId) },
      body: {
        mode: "exchange",
        reason: `${QA_TAG} / استبدال بمنتج أقل`,
        refund_method: "cash",
        restock: true,
        refund_amount: difference,
        items: [{ order_item_id: orderItemId, quantity: 1, refund_amount: difference }],
      },
      user: { id: admin.id, name: admin.name, role: "admin", tenant_id: tenantId },
      headers: {}, ip: "127.0.0.1", socket: { remoteAddress: "127.0.0.1" },
    };
    const exchangeRes = await invokeController(returnOrder, exchangeReq);
    assert.ok([200, 201].includes(exchangeRes.statusCode), `exchange failed: ${JSON.stringify(exchangeRes.payload)?.slice(0, 400)}`);
    console.log(`[2/3] exchanged → refunded ${difference} cash as the price difference`);

    const afterExchange = {
      ledger: await ledgerBalances(client, tenantId),
      stockExpensive: await variantStock(client, expensive.id),
      shift: shift ? await shiftExpected(client, tenantId, shift.id) : null,
    };

    check("exchange: Cash credited by the difference", -(afterExchange.ledger["1000"] - afterSale.ledger["1000"]), difference);
    check("exchange: Returns Outward debited", afterExchange.ledger["4020"] - afterSale.ledger["4020"], difference);
    check("exchange: COGS reversed", -(afterExchange.ledger["5000"] - afterSale.ledger["5000"]), soldCogs);
    check("exchange: Inventory restored", afterExchange.ledger["1200"] - afterSale.ledger["1200"], soldCogs);
    check("exchange: stock back up 1", afterExchange.stockExpensive - afterSale.stockExpensive, 1);
    if (shift) check("exchange: drawer down by the difference", afterSale.shift - afterExchange.shift, difference);

    // ---- 3. delete it and prove nothing is left -----------------------------
    if (!KEEP) {
      const returnIds = (await client.query(`SELECT id FROM returns WHERE order_id = $1`, [orderId])).rows.map((r) => Number(r.id));
      const countsBefore = await rowCounts(client, orderId, returnIds);
      console.log(`[3/3] deleting → rows before:`, countsBefore);
      const delRes = await invokeController(permanentDeleteOrder, {
        params: { id: String(orderId) },
        body: { reason: QA_TAG, confirmation: "DELETE" },
        query: {},
        user: { id: admin.id, name: admin.name, role: "admin", tenant_id: tenantId },
        headers: {}, ip: "127.0.0.1", socket: { remoteAddress: "127.0.0.1" },
      });
      assert.ok([200, 204].includes(delRes.statusCode), `delete failed: ${JSON.stringify(delRes.payload)?.slice(0, 300)}`);

      const countsAfter = await rowCounts(client, orderId, returnIds);
      console.log(`      rows after :`, countsAfter);
      for (const [table, count] of Object.entries(countsAfter)) {
        check(`delete: ${table} cleared`, count, 0);
      }

      const afterDelete = {
        ledger: await ledgerBalances(client, tenantId),
        stockExpensive: await variantStock(client, expensive.id),
        shift: shift ? await shiftExpected(client, tenantId, shift.id) : null,
      };
      if (shift) {
        check("delete: drawer back to where it started", afterDelete.shift, before.shift);
      }
      check("delete: stock back to where it started", afterDelete.stockExpensive, before.stockExpensive);
      orderId = null;
    }
  } finally {
    if (orderId && !KEEP) {
      // Deleting the orders row alone is NOT enough: journal entries, money
      // transactions, drawer events and the cached account balances are not
      // FK-bound to it and would survive. Unwind them explicitly.
      console.log(`\n[cleanup] removing leftover order #${orderId} and everything it touched`);
      const returnIds = (await client.query(`SELECT id FROM returns WHERE order_id=$1`, [orderId])).rows.map((r) => Number(r.id));
      const ids = returnIds.length ? returnIds : [-1];
      const drawer = (await client.query(
        `
        SELECT shift_id, SUM(CASE
            WHEN event_type IN ('sale_cash','cash_in','opening') THEN amount
            WHEN event_type IN ('refund_cash','expense_cash','cash_out') THEN -amount
            ELSE 0 END) AS delta
        FROM cash_drawer_shift_events
        WHERE (source_id = $1 AND LOWER(source_type) IN ('order','invoice','pos_order','sale'))
           OR (LOWER(source_type) = 'return' AND source_id = ANY($2::bigint[]))
        GROUP BY shift_id
        `,
        [orderId, ids]
      )).rows;
      const cashDelta = (await client.query(
        `
        SELECT account_id, SUM(CASE WHEN direction='in' THEN amount ELSE -amount END) AS delta
        FROM money_transactions
        WHERE (reference_id = $1 AND reference_type IN ('order','sale','invoice','pos_order','order_payment'))
           OR (reference_type LIKE '%return%' AND reference_id = ANY($2::bigint[]))
        GROUP BY account_id
        `,
        [orderId, ids]
      )).rows;

      for (const [sql, params] of [
        [`DELETE FROM journal_entry_lines WHERE journal_entry_id IN (SELECT id FROM journal_entries WHERE (reference_type IN ('order','sale') AND reference_id=$1) OR (reference_type LIKE '%return%' AND reference_id = ANY($2::bigint[])))`, [orderId, ids]],
        [`DELETE FROM journal_entries WHERE (reference_type IN ('order','sale') AND reference_id=$1) OR (reference_type LIKE '%return%' AND reference_id = ANY($2::bigint[]))`, [orderId, ids]],
        [`DELETE FROM money_transactions WHERE (reference_id=$1 AND reference_type IN ('order','sale','invoice','pos_order','order_payment')) OR (reference_type LIKE '%return%' AND reference_id = ANY($2::bigint[]))`, [orderId, ids]],
        [`DELETE FROM financial_account_entries WHERE (source_id=$1 AND LOWER(source_type) IN ('order','sale','invoice','pos_order')) OR (LOWER(source_type)='return' AND source_id = ANY($2::bigint[]))`, [orderId, ids]],
        [`DELETE FROM cash_drawer_shift_events WHERE (source_id=$1 AND LOWER(source_type) IN ('order','invoice','pos_order','sale')) OR (LOWER(source_type)='return' AND source_id = ANY($2::bigint[]))`, [orderId, ids]],
        [`DELETE FROM inventory_movements WHERE reference_type IN ('order','sale') AND reference_id=$1`, [orderId]],
        [`DELETE FROM returns WHERE order_id=$1`, [orderId]],
        [`DELETE FROM order_items WHERE order_id=$1`, [orderId]],
        [`DELETE FROM orders WHERE id=$1`, [orderId]],
      ]) {
        await client.query(sql, params).catch((e) => console.error("  cleanup:", e.message));
      }
      for (const { shift_id, delta } of drawer) {
        await client.query(`UPDATE cash_drawer_shifts SET expected_cash = expected_cash - $1, difference = 0, cash_difference = 0 WHERE id = $2`, [delta, shift_id]).catch(() => {});
      }
      for (const { account_id, delta } of cashDelta) {
        await client.query(`UPDATE money_accounts SET current_balance = current_balance - $1 WHERE id = $2`, [delta, account_id]).catch(() => {});
        await client.query(`UPDATE financial_accounts fa SET current_balance = fa.current_balance - $1 FROM money_accounts ma WHERE ma.id = $2 AND fa.id = ma.financial_account_id`, [delta, account_id]).catch(() => {});
      }
      console.log(`[cleanup] done`);
    }
    client.release();
  }

  console.log("\n──────────────────────────────────────────────────────────────");
  for (const r of report) {
    console.log(`${r.pass ? "  PASS" : "  FAIL"}  ${r.label.padEnd(46)} expected ${String(r.expected).padStart(10)}  got ${String(r.actual).padStart(10)}`);
  }
  const failed = report.filter((r) => !r.pass);
  console.log("──────────────────────────────────────────────────────────────");
  console.log(`${report.length - failed.length}/${report.length} checks passed\n`);
  process.exit(failed.length ? 1 : 0);
};

run().catch((error) => {
  console.error("\n[FATAL]", error.message);
  console.error(error.stack);
  process.exit(1);
});
