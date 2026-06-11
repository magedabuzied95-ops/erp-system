import assert from "node:assert/strict";

import db from "../database/db.js";
import { createOrder } from "../controllers/ordersController.js";
import { getCustomerStatement } from "../controllers/customersController.js";
import { buildPosShiftReport } from "../controllers/posController.js";
import { getDashboardOverview, getPaymentAnalytics } from "../services/dashboardAnalyticsService.js";
import { ensureAccountingSchema, getCurrentCashDrawerShift, openCashDrawerShift } from "../services/accountingService.js";
import { ensureInventoryMovementSchema } from "../services/inventoryMovementService.js";

const QA_TAG = "QA_PERSONAL_TRANSACTIONS";
const PERSONAL_PRICE = 1850;
const PERSONAL_COST = 500;
const STOCK_SEED = 10;

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const money = (value) => Math.round((toNumber(value) + Number.EPSILON) * 100) / 100;

const safeId = (prefix) => `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

const getColumns = async (client, tableName) => {
  const result = await client.query(
    `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = $1
    `,
    [tableName]
  );
  return new Set(result.rows.map((row) => row.column_name));
};

const insertFlexible = async (client, tableName, data) => {
  const columns = await getColumns(client, tableName);
  const entries = Object.entries(data).filter(([column, value]) => columns.has(column) && value !== undefined);
  if (!entries.length) throw new Error(`No insertable columns for ${tableName}`);
  const columnSql = entries.map(([column]) => column).join(", ");
  const params = entries.map(([, value]) => value);
  const placeholders = entries.map((_, index) => `$${index + 1}`).join(", ");
  const result = await client.query(
    `INSERT INTO ${tableName} (${columnSql}) VALUES (${placeholders}) RETURNING *`,
    params
  );
  return result.rows[0];
};

const createMockResponse = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });

  const res = {
    statusCode: 200,
    headersSent: false,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.headersSent = true;
      resolve({ statusCode: this.statusCode, payload });
      return payload;
    },
    send(payload) {
      this.headersSent = true;
      resolve({ statusCode: this.statusCode, payload });
      return payload;
    },
  };

  return { res, promise };
};

const invokeController = async (handler, req) => {
  const { res, promise } = createMockResponse();
  const controllerPromise = Promise.resolve(handler(req, res));
  const result = await Promise.race([
    promise,
    controllerPromise.then(() => null),
    new Promise((_, reject) => setTimeout(() => reject(new Error("Controller timeout")), 30000)),
  ]);
  if (!result) {
    throw new Error("Controller returned without sending a response");
  }
  await controllerPromise.catch(() => {});
  return result;
};

const snapshotAccounts = async (client, tenantId) => {
  const codes = ["1100", "1200", "2101", "3300", "4000", "5000", "5200"];
  const result = await client.query(
    `
    SELECT
      a.code,
      a.name,
      COALESCE(SUM(CASE WHEN je.id IS NULL OR je.tenant_id = $1 THEN COALESCE(jel.debit, 0) - COALESCE(jel.credit, 0) ELSE 0 END), 0) AS current_balance
    FROM accounts a
    LEFT JOIN journal_entry_lines jel ON jel.account_id = a.id
    LEFT JOIN journal_entries je ON je.id = jel.journal_entry_id
    WHERE a.tenant_id = $1
      AND a.code = ANY($2::varchar[])
    GROUP BY a.code, a.name
    ORDER BY a.code
    `,
    [tenantId, codes]
  );
  return Object.fromEntries(
    result.rows.map((row) => [
      row.code,
      {
        name: row.name,
        current_balance: money(row.current_balance),
      },
    ])
  );
};

const snapshotInventoryMovements = async (client, orderId) => {
  const result = await client.query(
    `
    SELECT
      id,
      movement_type,
      customer_id,
      reference_type,
      reference_id,
      quantity,
      unit_cost,
      total_cost,
      notes
    FROM inventory_movements
    WHERE reference_type = 'order'
      AND reference_id = $1
    ORDER BY id ASC
    `,
    [orderId]
  );
  return result.rows.map((row) => ({
    ...row,
    quantity: money(row.quantity),
    unit_cost: money(row.unit_cost),
    total_cost: money(row.total_cost),
  }));
};

const snapshotJournalEntries = async (client, orderId) => {
  const result = await client.query(
    `
    SELECT
      je.id AS journal_entry_id,
      je.entry_number,
      je.reference_type,
      je.reference_id,
      je.description,
      a.code AS account_code,
      a.name AS account_name,
      jel.debit,
      jel.credit,
      jel.notes
    FROM journal_entries je
    JOIN journal_entry_lines jel ON jel.journal_entry_id = je.id
    JOIN accounts a ON a.id = jel.account_id
    WHERE je.reference_type = 'order'
      AND je.reference_id = $1
    ORDER BY je.id ASC, jel.id ASC
    `,
    [orderId]
  );
  return result.rows.map((row) => ({
    ...row,
    debit: money(row.debit),
    credit: money(row.credit),
  }));
};

const snapshotPaymentAnalytics = async (tenantId) => {
  const rows = await getPaymentAnalytics({ tenantId });
  return rows.map((row) => ({
    method: row.method,
    orders: Number(row.orders || 0),
    amount: money(row.amount),
  }));
};

const snapshotOverview = async (tenantId) => {
  const overview = await getDashboardOverview({ tenantId, filters: {} });
  return {
    today: {
      sales: money(overview.today?.sales),
      gross: money(overview.today?.gross),
      orders: Number(overview.today?.orders || 0),
      aov: money(overview.today?.aov),
    },
    yesterday: {
      sales: money(overview.yesterday?.sales),
      orders: Number(overview.yesterday?.orders || 0),
      aov: money(overview.yesterday?.aov),
    },
  };
};

const snapshotShift = async (client, tenantId, shiftId) => {
  const report = await buildPosShiftReport(client, { tenantId, shiftId });
  return {
    shift: {
      id: Number(report.shift?.id || shiftId),
      opening_cash: money(report.shift?.opening_cash),
      expected_cash: money(report.shift?.expected_cash),
      closing_cash: report.shift?.closing_cash === null || report.shift?.closing_cash === undefined ? null : money(report.shift?.closing_cash),
      cash_difference: money(report.shift?.cash_difference),
    },
    totals: {
      expected_cash: money(report.totals?.expected_cash),
      cash_in: money(report.totals?.cash_in),
      cash_out: money(report.totals?.cash_out),
      cash_in_events: money(report.totals?.cash_in_events),
      cash_out_events: money(report.totals?.cash_out_events),
      invoice_count: Number(report.totals?.invoice_count || 0),
    },
  };
};

const fetchCustomerStatement = async ({ customerId, tenantId, adminUserId }) => {
  const req = {
    params: { id: String(customerId) },
    query: {},
    user: {
      id: adminUserId,
      role: "admin",
      tenant_id: tenantId,
    },
  };
  const result = await invokeController(getCustomerStatement, req);
  assert.equal(result.statusCode, 200, "Customer statement request should succeed");
  assert.equal(result.payload?.success, true, "Customer statement should be successful");
  return result.payload.data;
};

const createPersonalOrder = async ({
  tenantId,
  branchId,
  userId,
  customer,
  product,
  variant,
  personalSettlementType,
  personalNote,
}) => {
  const req = {
    body: {
      tenant_id: tenantId,
      branch_id: branchId,
      customer_id: customer.id,
      customer_name: customer.name,
      customer_phone: customer.phone || "",
      channel: "pos",
      status: "completed",
      payment_status: "paid",
      payment_method: "PERSONAL",
      personal_settlement_type: personalSettlementType,
      personal_note: personalNote,
      notes: `${QA_TAG}:${personalSettlementType}`,
      subtotal: PERSONAL_PRICE,
      discount_amount: 0,
      tax_amount: 0,
      service_fee: 0,
      paid_amount: PERSONAL_PRICE,
      items: [
        {
          product_id: product.id,
          variant_id: variant.id,
          quantity: 1,
          price: PERSONAL_PRICE,
          unit_price: PERSONAL_PRICE,
          sale_price: PERSONAL_PRICE,
          total_amount: PERSONAL_PRICE,
          line_total: PERSONAL_PRICE,
        },
      ],
    },
    user: {
      id: userId,
      name: "QA Cashier",
      role: "admin",
      tenant_id: tenantId,
    },
    headers: {},
    ip: "127.0.0.1",
    socket: { remoteAddress: "127.0.0.1" },
  };

  const result = await invokeController(createOrder, req);
  assert.equal(result.statusCode, 201, `PERSONAL ${personalSettlementType} should be created`);
  assert.equal(result.payload?.success, true, `PERSONAL ${personalSettlementType} response should succeed`);
  assert.equal(result.payload?.order_id || result.payload?.order?.id, result.payload?.order?.id || result.payload?.order_id, "Order id should be present");
  return result.payload;
};

const createFixture = async (client, tenantId) => {
  const product = await insertFlexible(client, "products", {
    tenant_id: tenantId,
    name: `${QA_TAG} Product`,
    sku: `${QA_TAG}-${Date.now()}`,
    barcode: `${QA_TAG}-${Date.now()}`,
    variation_mode: "full_variations",
    cost_price: PERSONAL_COST,
    regular_price: PERSONAL_PRICE,
    price: PERSONAL_PRICE,
    sale_price: PERSONAL_PRICE,
    stock: 0,
    status: "active",
    metadata: { qa_test: true, source: QA_TAG },
  });

  const variant = await insertFlexible(client, "product_variants", {
    tenant_id: tenantId,
    product_id: product.id,
    color: "Black",
    size: "ONE",
    sku: `${product.sku}-V1`,
    barcode: `${product.sku}-V1`,
    cost_price: PERSONAL_COST,
    price: PERSONAL_PRICE,
    sale_price: PERSONAL_PRICE,
    stock: STOCK_SEED,
    is_active: true,
    metadata: { qa_test: true, source: QA_TAG },
  });

  const allowedCustomer = await insertFlexible(client, "customers", {
    tenant_id: tenantId,
    name: `${QA_TAG} Allowed Customer`,
    phone: "01000000001",
    email: "qa.allowed@example.test",
    status: "active",
    allow_personal_transactions: true,
    notes: QA_TAG,
    metadata: { qa_test: true, source: QA_TAG },
  });

  const blockedCustomer = await insertFlexible(client, "customers", {
    tenant_id: tenantId,
    name: `${QA_TAG} Blocked Customer`,
    phone: "01000000002",
    email: "qa.blocked@example.test",
    status: "active",
    allow_personal_transactions: false,
    notes: QA_TAG,
    metadata: { qa_test: true, source: QA_TAG },
  });

  return { product, variant, allowedCustomer, blockedCustomer };
};

const cleanupFixture = async (client, fixture, orderIds = []) => {
  const safeOrderIds = orderIds.filter((id) => Number.isFinite(Number(id))).map((id) => Number(id));
  if (safeOrderIds.length) {
    await client.query(`DELETE FROM journal_entry_lines WHERE journal_entry_id IN (SELECT id FROM journal_entries WHERE reference_type = 'order' AND reference_id = ANY($1::bigint[]))`, [safeOrderIds]);
    await client.query(`DELETE FROM journal_entries WHERE reference_type = 'order' AND reference_id = ANY($1::bigint[])`, [safeOrderIds]);
    await client.query(`DELETE FROM inventory_movements WHERE reference_type = 'order' AND reference_id = ANY($1::bigint[])`, [safeOrderIds]);
    await client.query(`DELETE FROM order_items WHERE order_id = ANY($1::bigint[])`, [safeOrderIds]);
    await client.query(`DELETE FROM orders WHERE id = ANY($1::bigint[])`, [safeOrderIds]);
  }

  if (fixture?.variant?.id) {
    await client.query("DELETE FROM product_variants WHERE id = $1", [fixture.variant.id]);
  }
  if (fixture?.product?.id) {
    await client.query("DELETE FROM products WHERE id = $1", [fixture.product.id]);
  }
  if (fixture?.allowedCustomer?.id) {
    await client.query("DELETE FROM customers WHERE id = $1", [fixture.allowedCustomer.id]);
  }
  if (fixture?.blockedCustomer?.id) {
    await client.query("DELETE FROM customers WHERE id = $1", [fixture.blockedCustomer.id]);
  }
};

const main = async () => {
  const client = await db.connect();
  const createdOrderIds = [];
  try {
    await ensureAccountingSchema(client);
    await ensureInventoryMovementSchema(client);

    const branchRow = (await client.query(
      `
      SELECT id, tenant_id, name
      FROM branches
      ORDER BY id ASC
      LIMIT 1
      `
    )).rows[0] || null;
    if (!branchRow) {
      throw new Error("No branch found in the local database. Create or seed one before running this QA script.");
    }

    const userRow = (await client.query(
      `
      SELECT id, tenant_id, name, role
      FROM users
      ORDER BY id ASC
      LIMIT 1
      `
    )).rows[0] || null;
    if (!userRow) {
      throw new Error("No user found in the local database. Create or seed one before running this QA script.");
    }

    const tenantId = Number(branchRow.tenant_id || userRow.tenant_id || 0);
    if (!Number.isFinite(tenantId) || tenantId <= 0) {
      throw new Error("Unable to resolve a valid tenant_id for the QA test");
    }

    const branchId = Number(branchRow.id);
    const userId = Number(userRow.id);
    const fixture = await createFixture(client, tenantId);

    await client.query("UPDATE product_variants SET stock = $1, cost_price = $2, price = $3, sale_price = $3, updated_at = NOW() WHERE id = $4", [
      STOCK_SEED,
      PERSONAL_COST,
      PERSONAL_PRICE,
      fixture.variant.id,
    ]);

    let shift = await getCurrentCashDrawerShift(client, { tenantId, userId, branchId }).catch(() => null);
    if (!shift) {
      shift = await openCashDrawerShift(client, {
        tenantId,
        openedBy: userId,
        branchId,
        openingCash: 0,
        notes: QA_TAG,
      });
    }

    const statementBefore = await fetchCustomerStatement({
      customerId: fixture.allowedCustomer.id,
      tenantId,
      adminUserId: userId,
    });
    const shiftBefore = await snapshotShift(client, tenantId, shift.id);
    const paymentAnalyticsBefore = await snapshotPaymentAnalytics(tenantId);
    const overviewBefore = await snapshotOverview(tenantId);
    const accountBalancesBefore = await snapshotAccounts(client, tenantId);

    const negativeAssertions = [];

    const missingCustomerReq = {
      body: {
        tenant_id: tenantId,
        branch_id: branchId,
        channel: "pos",
        status: "completed",
        payment_status: "paid",
        payment_method: "PERSONAL",
        personal_settlement_type: "GIFT",
        personal_note: `${QA_TAG}:missing-customer`,
        items: [{
          product_id: fixture.product.id,
          variant_id: fixture.variant.id,
          quantity: 1,
          price: PERSONAL_PRICE,
          unit_price: PERSONAL_PRICE,
          sale_price: PERSONAL_PRICE,
          total_amount: PERSONAL_PRICE,
          line_total: PERSONAL_PRICE,
        }],
      },
      user: { id: userId, role: "admin", tenant_id: tenantId },
    };
    const missingCustomerRes = await invokeController(createOrder, missingCustomerReq);
    negativeAssertions.push({
      name: "PERSONAL without customer_id",
      pass: missingCustomerRes.statusCode === 400 && /customer_id/i.test(String(missingCustomerRes.payload?.message || "")),
      actual: missingCustomerRes,
    });

    const blockedCustomerReq = {
      body: {
        tenant_id: tenantId,
        branch_id: branchId,
        customer_id: fixture.blockedCustomer.id,
        customer_name: fixture.blockedCustomer.name,
        customer_phone: fixture.blockedCustomer.phone || "",
        channel: "pos",
        status: "completed",
        payment_status: "paid",
        payment_method: "PERSONAL",
        personal_settlement_type: "GIFT",
        personal_note: `${QA_TAG}:blocked-customer`,
        items: [{
          product_id: fixture.product.id,
          variant_id: fixture.variant.id,
          quantity: 1,
          price: PERSONAL_PRICE,
          unit_price: PERSONAL_PRICE,
          sale_price: PERSONAL_PRICE,
          total_amount: PERSONAL_PRICE,
          line_total: PERSONAL_PRICE,
        }],
      },
      user: { id: userId, role: "admin", tenant_id: tenantId },
    };
    const blockedCustomerRes = await invokeController(createOrder, blockedCustomerReq);
    negativeAssertions.push({
      name: "PERSONAL for blocked customer",
      pass: blockedCustomerRes.statusCode === 400 && /not allowed/i.test(String(blockedCustomerRes.payload?.message || "")),
      actual: blockedCustomerRes,
    });

    const missingTypeReq = {
      body: {
        tenant_id: tenantId,
        branch_id: branchId,
        customer_id: fixture.allowedCustomer.id,
        customer_name: fixture.allowedCustomer.name,
        customer_phone: fixture.allowedCustomer.phone || "",
        channel: "pos",
        status: "completed",
        payment_status: "paid",
        payment_method: "PERSONAL",
        personal_note: `${QA_TAG}:missing-type`,
        items: [{
          product_id: fixture.product.id,
          variant_id: fixture.variant.id,
          quantity: 1,
          price: PERSONAL_PRICE,
          unit_price: PERSONAL_PRICE,
          sale_price: PERSONAL_PRICE,
          total_amount: PERSONAL_PRICE,
          line_total: PERSONAL_PRICE,
        }],
      },
      user: { id: userId, role: "admin", tenant_id: tenantId },
    };
    const missingTypeRes = await invokeController(createOrder, missingTypeReq);
    negativeAssertions.push({
      name: "PERSONAL without personal_settlement_type",
      pass: missingTypeRes.statusCode === 400 && /personal_settlement_type/i.test(String(missingTypeRes.payload?.message || "")),
      actual: missingTypeRes,
    });

    const cases = [
      {
        name: "GIFT",
        expectedMovement: "GIFT_OUT",
        expectedJournal: [
          { account: "5200", debit: PERSONAL_COST, credit: 0 },
          { account: "1200", debit: 0, credit: PERSONAL_COST },
        ],
        expectedStatementAmount: 0,
        expectedStatementPersonalValue: PERSONAL_PRICE,
        expectedRevenueDelta: 0,
      },
      {
        name: "EMPLOYEE_ADVANCE",
        expectedMovement: "EMPLOYEE_ADVANCE_OUT",
        expectedJournal: [
          { account: "1100", debit: PERSONAL_PRICE, credit: 0 },
          { account: "2101", debit: 0, credit: PERSONAL_PRICE },
        ],
        expectedStatementAmount: PERSONAL_PRICE,
        expectedStatementPersonalValue: PERSONAL_PRICE,
        expectedRevenueDelta: 0,
      },
      {
        name: "OWNER_USE",
        expectedMovement: "OWNER_USE_OUT",
        expectedJournal: [
          { account: "3300", debit: PERSONAL_COST, credit: 0 },
          { account: "1200", debit: 0, credit: PERSONAL_COST },
        ],
        expectedStatementAmount: 0,
        expectedStatementPersonalValue: PERSONAL_PRICE,
        expectedRevenueDelta: 0,
      },
    ];

    const results = [];
    let statementCursor = statementBefore;
    let shiftCursor = shiftBefore;
    let analyticsCursor = paymentAnalyticsBefore;
    let overviewCursor = overviewBefore;
    let accountCursor = accountBalancesBefore;

    for (const testCase of cases) {
      const stockBefore = (await client.query("SELECT stock FROM product_variants WHERE id = $1", [fixture.variant.id])).rows[0];
      const response = await createPersonalOrder({
        tenantId,
        branchId,
        userId,
        customer: fixture.allowedCustomer,
        product: fixture.product,
        variant: fixture.variant,
        personalSettlementType: testCase.name,
        personalNote: `${QA_TAG}:${testCase.name}`,
      });

      const orderId = Number(response.order_id || response.order?.id);
      createdOrderIds.push(orderId);

      const stockAfter = (await client.query("SELECT stock FROM product_variants WHERE id = $1", [fixture.variant.id])).rows[0];
      const shiftAfter = await snapshotShift(client, tenantId, shift.id);
      const analyticsAfter = await snapshotPaymentAnalytics(tenantId);
      const overviewAfter = await snapshotOverview(tenantId);
      const accountBalancesAfter = await snapshotAccounts(client, tenantId);
      const statementAfter = await fetchCustomerStatement({
        customerId: fixture.allowedCustomer.id,
        tenantId,
        adminUserId: userId,
      });
      const inventoryMovements = await snapshotInventoryMovements(client, orderId);
      const journalEntries = await snapshotJournalEntries(client, orderId);

      const lastStatementRow = statementAfter.rows[statementAfter.rows.length - 1] || null;
      const journalByAccount = Object.fromEntries(journalEntries.map((line) => [line.account_code, line]));

      const checks = [
        { label: "order created", pass: orderId > 0 },
        { label: "stock decremented", pass: Number(stockBefore.stock) - Number(stockAfter.stock) === 1 },
        { label: "movement type", pass: inventoryMovements.some((row) => row.movement_type === testCase.expectedMovement || row.movement_type === "PERSONAL_OUT") },
        { label: "movement customer", pass: inventoryMovements.every((row) => Number(row.customer_id) === Number(fixture.allowedCustomer.id)) },
        { label: "movement reference", pass: inventoryMovements.every((row) => Number(row.reference_id) === orderId && row.reference_type === "order") },
        { label: "cash drawer unchanged", pass: shiftBefore.totals.expected_cash === shiftAfter.totals.expected_cash && shiftBefore.totals.cash_in === shiftAfter.totals.cash_in && shiftBefore.totals.cash_out === shiftAfter.totals.cash_out },
        { label: "payment analytics unchanged", pass: JSON.stringify(analyticsCursor) === JSON.stringify(analyticsAfter) },
        { label: "overview sales unchanged", pass: JSON.stringify(overviewCursor) === JSON.stringify(overviewAfter) },
        { label: "statement row exists", pass: Boolean(lastStatementRow) },
        { label: "statement amount", pass: Number(lastStatementRow?.amount || 0) === testCase.expectedStatementAmount },
        { label: "statement personal value", pass: Number(lastStatementRow?.personal_value || 0) === testCase.expectedStatementPersonalValue },
      ];

      for (const expectedLine of testCase.expectedJournal) {
        const line = journalByAccount[expectedLine.account];
        checks.push({
          label: `journal ${expectedLine.account}`,
          pass: Boolean(line) && Number(line.debit || 0) === expectedLine.debit && Number(line.credit || 0) === expectedLine.credit,
        });
      }
      checks.push(
        { label: "revenue unchanged", pass: Number((accountCursor["4000"]?.current_balance || 0)) === Number((accountBalancesAfter["4000"]?.current_balance || 0)) },
        { label: "cogs unchanged", pass: Number((accountCursor["5000"]?.current_balance || 0)) === Number((accountBalancesAfter["5000"]?.current_balance || 0)) },
      );

      const passed = checks.every((check) => check.pass);
      results.push({
        name: testCase.name,
        pass: passed,
        order_id: orderId,
        stock_before: Number(stockBefore.stock || 0),
        stock_after: Number(stockAfter.stock || 0),
        inventory_movements: inventoryMovements,
        journal_entries: journalEntries,
        statement_row: lastStatementRow,
        shift_before: shiftCursor,
        shift_after: shiftAfter,
        payment_analytics_before: analyticsCursor,
        payment_analytics_after: analyticsAfter,
        overview_before: overviewCursor,
        overview_after: overviewAfter,
        account_balances_before: accountCursor,
        account_balances_after: accountBalancesAfter,
        checks,
      });

      statementCursor = statementAfter;
      shiftCursor = shiftAfter;
      analyticsCursor = analyticsAfter;
      overviewCursor = overviewAfter;
      accountCursor = accountBalancesAfter;
    }

    const finalStatement = await fetchCustomerStatement({
      customerId: fixture.allowedCustomer.id,
      tenantId,
      adminUserId: userId,
    });

    const report = {
      tenantId,
      branchId,
      userId,
      fixture: {
        productId: fixture.product.id,
        variantId: fixture.variant.id,
        allowedCustomerId: fixture.allowedCustomer.id,
        blockedCustomerId: fixture.blockedCustomer.id,
      },
      negativeAssertions,
      statement_before: statementBefore,
      statement_after: finalStatement,
      shift_before: shiftBefore,
      shift_after: shiftCursor,
      payment_analytics_before: paymentAnalyticsBefore,
      payment_analytics_after: analyticsCursor,
      overview_before: overviewBefore,
      overview_after: overviewCursor,
      account_balances_before: accountBalancesBefore,
      account_balances_after: accountCursor,
      cases: results,
    };

    console.log(JSON.stringify(report, null, 2));
    assert.equal(negativeAssertions.every((item) => item.pass), true, "Negative validation checks must pass");
    assert.equal(results.every((item) => item.pass), true, "All PERSONAL accounting cases must pass");

    await cleanupFixture(client, fixture, createdOrderIds);
  } catch (error) {
    if (createdOrderIds.length) {
      await cleanupFixture(client, null, createdOrderIds).catch(() => {});
    }
    throw error;
  } finally {
    client.release();
    await db.end();
  }
};

main().catch((error) => {
  console.error("[qa-personal] failed", {
    message: error.message,
    stack: error.stack,
  });
  process.exitCode = 1;
});
