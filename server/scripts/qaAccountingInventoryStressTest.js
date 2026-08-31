import "dotenv/config";

import db from "../database/db.js";
import {
  createJournalEntry,
  ensureAccountingSchema,
  recordFinancialAccountActivity,
  seedDefaultAccounts,
} from "../services/accountingService.js";
import { ensureInventoryMovementSchema, recordInventoryMovement } from "../services/inventoryMovementService.js";

const QA_SOURCE = "QA_STRESS_TEST";
const PRODUCT_NAME = "QA Test Product";
const SKU = "QA-TEST-001";
const SUPPLIER_NAME = "QA Supplier";
const UNIT_COST = 500;
const SELLING_PRICE = 1000;
const COMPARE_PRICE = 1200;

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

const hasTable = async (client, tableName) => {
  const result = await client.query("SELECT to_regclass($1) AS regclass", [tableName]);
  return Boolean(result.rows[0]?.regclass);
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

const updateFlexible = async (client, tableName, id, data) => {
  const columns = await getColumns(client, tableName);
  const entries = Object.entries(data).filter(([column, value]) => columns.has(column) && value !== undefined);
  if (!entries.length) return null;
  const setSql = entries.map(([column], index) => `${column} = $${index + 1}`).join(", ");
  const params = entries.map(([, value]) => value);
  params.push(id);
  const result = await client.query(`UPDATE ${tableName} SET ${setSql} WHERE id = $${params.length} RETURNING *`, params);
  return result.rows[0] || null;
};

const qaMetadata = (extra = {}) => ({ qa_test: true, source: QA_SOURCE, ...extra });

const ensureQaSchema = async (client) => {
  await ensureAccountingSchema();
  await ensureInventoryMovementSchema();

  await client.query("ALTER TABLE IF EXISTS products ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb");
  await client.query("ALTER TABLE IF EXISTS product_variants ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb");
  await client.query("ALTER TABLE IF EXISTS suppliers ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb");
  await client.query("ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb");
  await client.query("ALTER TABLE IF EXISTS purchases ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb");
  await client.query("ALTER TABLE IF EXISTS purchase_items ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb");
  await client.query("ALTER TABLE IF EXISTS returns ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb");
  await client.query("ALTER TABLE IF EXISTS order_items ADD COLUMN IF NOT EXISTS returned_quantity INTEGER NOT NULL DEFAULT 0");
  await client.query("ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS payment_method VARCHAR(50)");
  await client.query("ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS shipping_fee NUMERIC(12,2) NOT NULL DEFAULT 0");
  await client.query("ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS stock_restored_at TIMESTAMPTZ NULL");

  await client.query(`
    CREATE TABLE IF NOT EXISTS qa_accounting_inventory_reports (
      id BIGSERIAL PRIMARY KEY,
      tenant_id BIGINT NOT NULL,
      source VARCHAR(80) NOT NULL DEFAULT '${QA_SOURCE}',
      status VARCHAR(20) NOT NULL,
      report JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
};

const getTenantId = async (client) => {
  const existing = await client.query("SELECT id FROM tenants ORDER BY id ASC LIMIT 1");
  if (existing.rows[0]?.id) return Number(existing.rows[0].id);
  const created = await insertFlexible(client, "tenants", {
    name: "QA Tenant",
    slug: `qa-tenant-${Date.now()}`,
    status: "active",
  });
  return Number(created.id);
};

const ensureQaFinancialAccount = async (client, tenantId) => {
  await seedDefaultAccounts(client, tenantId);
  const existing = await client.query(
    `
    SELECT id, current_balance
    FROM financial_accounts
    WHERE tenant_id = $1
      AND name = 'QA Cash Account'
      AND notes ILIKE $2
    ORDER BY id ASC
    LIMIT 1
    `,
    [tenantId, `%${QA_SOURCE}%`]
  );
  if (existing.rows[0]) return existing.rows[0];
  return insertFlexible(client, "financial_accounts", {
    tenant_id: tenantId,
    name: "QA Cash Account",
    account_type: "cash_drawer",
    currency: "EGP",
    opening_balance: 0,
    current_balance: 0,
    is_active: true,
    notes: QA_SOURCE,
  });
};

const createProduct = async (client, tenantId) => {
  const product = await insertFlexible(client, "products", {
    tenant_id: tenantId,
    name: PRODUCT_NAME,
    sku: SKU,
    barcode: SKU,
    variation_mode: "full_variations",
    cost_price: UNIT_COST,
    regular_price: COMPARE_PRICE,
    price: SELLING_PRICE,
    sale_price: SELLING_PRICE,
    use_custom_compare_price: true,
    custom_compare_price: COMPARE_PRICE,
    stock: 0,
    status: "active",
    metadata: qaMetadata(),
  });

  const variant40 = await insertFlexible(client, "product_variants", {
    tenant_id: tenantId,
    product_id: product.id,
    color: "Black",
    size: "40",
    sku: `${SKU}-BLACK-40`,
    barcode: `${SKU}-BLACK-40`,
    cost_price: UNIT_COST,
    price: SELLING_PRICE,
    sale_price: SELLING_PRICE,
    stock: 0,
    is_active: true,
    metadata: qaMetadata({ color: "Black", size: "40" }),
  });
  const variant41 = await insertFlexible(client, "product_variants", {
    tenant_id: tenantId,
    product_id: product.id,
    color: "Black",
    size: "41",
    sku: `${SKU}-BLACK-41`,
    barcode: `${SKU}-BLACK-41`,
    cost_price: UNIT_COST,
    price: SELLING_PRICE,
    sale_price: SELLING_PRICE,
    stock: 0,
    is_active: true,
    metadata: qaMetadata({ color: "Black", size: "41" }),
  });

  return { product, variants: { "40": variant40, "41": variant41 } };
};

const ensureSupplier = async (client, tenantId) => {
  return insertFlexible(client, "suppliers", {
    tenant_id: tenantId,
    name: SUPPLIER_NAME,
    phone: "01000000000",
    email: "qa-supplier@example.test",
    address: QA_SOURCE,
    debt_balance: 0,
    status: "active",
    metadata: qaMetadata(),
  });
};

const getStock = async (client, variantId) => {
  const result = await client.query("SELECT stock, cost_price FROM product_variants WHERE id = $1", [variantId]);
  return {
    stock: toNumber(result.rows[0]?.stock),
    cost: toNumber(result.rows[0]?.cost_price),
  };
};

const adjustVariantStock = async (client, { tenantId, productId, variantId, quantityChange, movementType, referenceType, referenceId, reason }) => {
  const before = await getStock(client, variantId);
  const afterQty = before.stock + quantityChange;
  if (afterQty < 0) throw new Error(`Stock would become negative for variant ${variantId}`);
  await client.query("UPDATE product_variants SET stock = $1, cost_price = $2, updated_at = NOW() WHERE id = $3", [
    afterQty,
    UNIT_COST,
    variantId,
  ]);
  await recordInventoryMovement(client, {
    tenantId,
    productId,
    variantId,
    quantityBefore: before.stock,
    quantityChange,
    quantityAfter: afterQty,
    unitCost: UNIT_COST,
    totalCost: Math.abs(quantityChange) * UNIT_COST,
    movementType,
    referenceType,
    referenceId,
    reason,
    notes: QA_SOURCE,
  });
  return afterQty;
};

const createPurchase = async (client, { tenantId, supplierId, productId, variants }) => {
  const items = [
    { variant: variants["40"], quantity: 10 },
    { variant: variants["41"], quantity: 5 },
  ];
  const total = items.reduce((sum, item) => sum + item.quantity * UNIT_COST, 0);
  const purchase = await insertFlexible(client, "purchases", {
    tenant_id: tenantId,
    supplier_id: supplierId,
    purchase_number: safeId("QA-PUR"),
    status: "received",
    payment_status: "unpaid",
    supplier_payment_status: "unpaid",
    subtotal: total,
    tax_amount: 0,
    discount_amount: 0,
    total,
    paid_amount: 0,
    supplier_paid_amount: 0,
    notes: QA_SOURCE,
    stock_applied: true,
    stock_applied_at: new Date(),
    metadata: qaMetadata(),
  });

  for (const item of items) {
    await insertFlexible(client, "purchase_items", {
      tenant_id: tenantId,
      purchase_id: purchase.id,
      product_id: productId,
      variant_id: item.variant.id,
      quantity: item.quantity,
      cost_price: UNIT_COST,
      unit_cost: UNIT_COST,
      tax_amount: 0,
      discount_amount: 0,
      total: item.quantity * UNIT_COST,
      metadata: qaMetadata({ size: item.variant.size }),
    });
    await adjustVariantStock(client, {
      tenantId,
      productId,
      variantId: item.variant.id,
      quantityChange: item.quantity,
      movementType: "purchase",
      referenceType: "purchase",
      referenceId: purchase.id,
      reason: "QA purchase receiving",
    });
  }

  await createJournalEntry(client, {
    tenantId,
    entryNumber: safeId("QA-JE-PUR"),
    referenceType: "purchase",
    referenceId: purchase.id,
    description: "QA purchase receipt",
    notes: QA_SOURCE,
    lines: [
      { account_code: "1200", debit: total, credit: 0, notes: QA_SOURCE },
      { account_code: "2000", debit: 0, credit: total, notes: QA_SOURCE },
    ],
  });

  return { purchase, total };
};

const createOrder = async (client, {
  tenantId,
  product,
  lines,
  channel = "pos",
  status = "completed",
  paymentStatus = "paid",
  paymentMethod = "cash",
  shippingFee = 0,
  paidAmount = null,
  financialAccountId = null,
  sourceLabel,
}) => {
  const subtotal = money(lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0));
  const discount = money(lines.reduce((sum, line) => sum + toNumber(line.discountAmount), 0));
  const total = money(subtotal - discount + shippingFee);
  const paid = paidAmount === null ? total : money(paidAmount);
  const order = await insertFlexible(client, "orders", {
    tenant_id: tenantId,
    invoice_number: safeId("QA-INV"),
    customer_name: `QA Customer ${sourceLabel || channel}`,
    channel,
    status,
    payment_status: paymentStatus,
    payment_method: paymentMethod,
    subtotal,
    discount_amount: discount,
    tax_amount: 0,
    service_fee: shippingFee,
    shipping_fee: shippingFee,
    total_amount: total,
    total_price: total,
    total,
    paid_amount: paid,
    change_amount: 0,
    notes: `${QA_SOURCE}:${sourceLabel || channel}`,
    metadata: qaMetadata({ source_label: sourceLabel || channel }),
  });

  let cogs = 0;
  for (const line of lines) {
    const lineTotal = money(line.quantity * line.unitPrice - toNumber(line.discountAmount));
    const item = await insertFlexible(client, "order_items", {
      tenant_id: tenantId,
      order_id: order.id,
      product_id: product.id,
      variant_id: line.variant.id,
      product_name: product.name,
      variant_name: `Black / ${line.variant.size}`,
      sku: line.variant.sku,
      barcode: line.variant.barcode,
      quantity: line.quantity,
      sale_price: line.unitPrice,
      discount_amount: toNumber(line.discountAmount),
      tax_amount: 0,
      total_amount: lineTotal,
      returned_quantity: 0,
    });
    line.orderItemId = item.id;
    cogs += line.quantity * UNIT_COST;
    await adjustVariantStock(client, {
      tenantId,
      productId: product.id,
      variantId: line.variant.id,
      quantityChange: -line.quantity,
      movementType: "sale",
      referenceType: "order",
      referenceId: order.id,
      reason: `QA ${channel} order stock deduction`,
    });
  }

  if (paid > 0 && financialAccountId) {
    await recordFinancialAccountActivity(client, {
      tenantId,
      financialAccountId,
      paymentMethod,
      entryType: "sale",
      direction: 1,
      sourceType: "order",
      sourceId: order.id,
      amount: paid,
      notes: `${QA_SOURCE}:${sourceLabel || channel}`,
      idempotent: false,
    });
  }

  if (paymentStatus === "paid" || paymentStatus === "partially_paid") {
    const receivableOrCash = paid > 0 ? "1000" : "1100";
    await createJournalEntry(client, {
      tenantId,
      entryNumber: safeId("QA-JE-SALE"),
      referenceType: "order",
      referenceId: order.id,
      description: `QA sale ${sourceLabel || channel}`,
      notes: QA_SOURCE,
      lines: [
        { account_code: receivableOrCash, debit: paid || total, credit: 0, notes: QA_SOURCE },
        { account_code: "4000", debit: 0, credit: money(total), notes: QA_SOURCE },
        { account_code: "5000", debit: money(cogs), credit: 0, notes: QA_SOURCE },
        { account_code: "1200", debit: 0, credit: money(cogs), notes: QA_SOURCE },
      ],
    });
  }

  return { order, lines, subtotal, discount, total, paid, cogs, profit: money(total - cogs) };
};

const addShippingOnlyProof = async (client, { tenantId, order, financialAccountId }) => {
  const shipping = money(order.shipping_fee ?? order.service_fee ?? 0);
  await updateFlexible(client, "orders", order.id, {
    paid_amount: shipping,
    payment_status: "partially_paid",
    transfer_proof_status: "approved",
    metadata: qaMetadata({ shipping_only_prepaid: true }),
  });
  await recordFinancialAccountActivity(client, {
    tenantId,
    financialAccountId,
    paymentMethod: "cash",
    entryType: "sale",
    direction: 1,
    sourceType: "order_shipping_proof",
    sourceId: order.id,
    amount: shipping,
    notes: `${QA_SOURCE}:shipping-only proof`,
    idempotent: false,
  });
  return { paid: shipping, remaining: money(order.total_amount - shipping) };
};

const createReturn = async (client, {
  tenantId,
  order,
  line,
  quantity,
  refundAmount,
  financialAccountId,
  sourceLabel,
}) => {
  const returnRow = await insertFlexible(client, "returns", {
    tenant_id: tenantId,
    order_id: order.id,
    return_number: safeId("QA-RET"),
    status: "completed",
    reason: `${QA_SOURCE}:${sourceLabel}`,
    restock: true,
    refund_amount: refundAmount,
    refund_method: "cash",
    metadata: qaMetadata({ source_label: sourceLabel }),
  });
  await insertFlexible(client, "return_items", {
    tenant_id: tenantId,
    return_id: returnRow.id,
    order_item_id: line.orderItemId,
    variant_id: line.variant.id,
    quantity,
    refund_amount: refundAmount,
    restock: true,
  });
  await client.query("UPDATE order_items SET returned_quantity = COALESCE(returned_quantity, 0) + $1 WHERE id = $2", [
    quantity,
    line.orderItemId,
  ]);
  await adjustVariantStock(client, {
    tenantId,
    productId: line.variant.product_id,
    variantId: line.variant.id,
    quantityChange: quantity,
    movementType: "return",
    referenceType: "return",
    referenceId: returnRow.id,
    reason: `QA return restock ${sourceLabel}`,
  });
  await recordFinancialAccountActivity(client, {
    tenantId,
    financialAccountId,
    paymentMethod: "cash",
    entryType: "refund",
    direction: -1,
    sourceType: "return",
    sourceId: returnRow.id,
    amount: refundAmount,
    notes: `${QA_SOURCE}:${sourceLabel}`,
    idempotent: false,
  });
  const cogsReversal = money(quantity * UNIT_COST);
  await createJournalEntry(client, {
    tenantId,
    entryNumber: safeId("QA-JE-RET"),
    referenceType: "return",
    referenceId: returnRow.id,
    description: `QA return ${sourceLabel}`,
    notes: QA_SOURCE,
    lines: [
      { account_code: "4020", debit: refundAmount, credit: 0, notes: QA_SOURCE },
      { account_code: "1000", debit: 0, credit: refundAmount, notes: QA_SOURCE },
      { account_code: "1200", debit: cogsReversal, credit: 0, notes: QA_SOURCE },
      { account_code: "5000", debit: 0, credit: cogsReversal, notes: QA_SOURCE },
    ],
  });
  return { returnRow, refundAmount, cogsReversal, profitReversal: money(refundAmount - cogsReversal) };
};

const cancelOrderAndRestoreStock = async (client, { tenantId, order, lines }) => {
  const already = order.inventory_rollback_done || order.stock_reverted_at || order.stock_restored_at;
  if (already) return { restored: false, alreadyRestored: true };
  for (const line of lines) {
    await adjustVariantStock(client, {
      tenantId,
      productId: line.variant.product_id,
      variantId: line.variant.id,
      quantityChange: line.quantity,
      movementType: "order_cancel",
      referenceType: "order",
      referenceId: order.id,
      reason: "QA cancel restore",
    });
  }
  const updated = await updateFlexible(client, "orders", order.id, {
    status: "cancelled",
    payment_status: order.paid_amount > 0 ? "refund_due" : "cancelled",
    cancelled_at: new Date(),
    stock_reverted_at: new Date(),
    stock_restored_at: new Date(),
    inventory_rollback_done: true,
  });
  return { restored: true, alreadyRestored: false, order: updated };
};

const snapshotStocks = async (client, variants) => ({
  size40: (await getStock(client, variants["40"].id)).stock,
  size41: (await getStock(client, variants["41"].id)).stock,
});

const sumJournal = async (client, tenantId) => {
  const result = await client.query(
    `
    SELECT a.code, a.name, COALESCE(SUM(jel.debit), 0)::numeric AS debit, COALESCE(SUM(jel.credit), 0)::numeric AS credit
    FROM journal_entry_lines jel
    JOIN journal_entries je ON je.id = jel.journal_entry_id
    JOIN accounts a ON a.id = jel.account_id
    WHERE je.tenant_id = $1
      AND COALESCE(je.notes, '') ILIKE $2
    GROUP BY a.code, a.name
    ORDER BY a.code
    `,
    [tenantId, `%${QA_SOURCE}%`]
  );
  return Object.fromEntries(result.rows.map((row) => [row.code, { debit: money(row.debit), credit: money(row.credit), name: row.name }]));
};

const getFinancialAccountBalance = async (client, accountId) => {
  const result = await client.query("SELECT current_balance FROM financial_accounts WHERE id = $1", [accountId]);
  return money(result.rows[0]?.current_balance || 0);
};

const addCheck = (checks, name, expected, actual, tolerance = 0) => {
  const pass = Math.abs(money(actual) - money(expected)) <= tolerance;
  checks.push({ name, expected: money(expected), actual: money(actual), status: pass ? "pass" : "fail" });
  return pass;
};

const cleanupQaData = async (client, tenantId = null) => {
  const tenantClause = tenantId ? "AND tenant_id = $1" : "";
  const params = tenantId ? [tenantId] : [];

  await client.query(
    `DELETE FROM journal_entries WHERE COALESCE(notes, '') ILIKE '%${QA_SOURCE}%' ${tenantClause}`,
    params
  );
  await client.query(
    `DELETE FROM financial_account_entries WHERE COALESCE(notes, '') ILIKE '%${QA_SOURCE}%' ${tenantClause}`,
    params
  );
  await client.query(
    `DELETE FROM returns WHERE (COALESCE(reason, '') ILIKE '%${QA_SOURCE}%' OR COALESCE(metadata->>'source', '') = '${QA_SOURCE}') ${tenantClause}`,
    params
  );
  await client.query(
    `DELETE FROM orders WHERE (COALESCE(notes, '') ILIKE '%${QA_SOURCE}%' OR COALESCE(metadata->>'source', '') = '${QA_SOURCE}') ${tenantClause}`,
    params
  );
  await client.query(
    `DELETE FROM purchases WHERE (COALESCE(notes, '') ILIKE '%${QA_SOURCE}%' OR COALESCE(metadata->>'source', '') = '${QA_SOURCE}') ${tenantClause}`,
    params
  );
  await client.query(
    `DELETE FROM inventory_movements WHERE COALESCE(notes, '') ILIKE '%${QA_SOURCE}%' ${tenantClause}`,
    params
  );
  await client.query(
    `DELETE FROM financial_accounts WHERE COALESCE(notes, '') ILIKE '%${QA_SOURCE}%' ${tenantClause}`,
    params
  );
  if (await hasTable(client, "qa_accounting_inventory_reports")) {
    await client.query(`DELETE FROM qa_accounting_inventory_reports WHERE source = '${QA_SOURCE}' ${tenantClause}`, params);
  }
  await client.query(`DELETE FROM suppliers WHERE name = $${params.length + 1} ${tenantId ? "AND tenant_id = $1" : ""}`, [
    ...params,
    SUPPLIER_NAME,
  ]);
  await client.query(`DELETE FROM products WHERE sku = $${params.length + 1} ${tenantId ? "AND tenant_id = $1" : ""}`, [
    ...params,
    SKU,
  ]);
};

const runStressTest = async () => {
  const client = await db.connect();
  const checks = [];
  try {
    await client.query("BEGIN");
    await ensureQaSchema(client);
    const tenantId = await getTenantId(client);
    await cleanupQaData(client, tenantId);

    const financialAccount = await ensureQaFinancialAccount(client, tenantId);
    const supplier = await ensureSupplier(client, tenantId);
    const { product, variants } = await createProduct(client, tenantId);

    const startingStock = await snapshotStocks(client, variants);
    const purchase = await createPurchase(client, { tenantId, supplierId: supplier.id, productId: product.id, variants });
    const afterPurchase = await snapshotStocks(client, variants);

    const posSale = await createOrder(client, {
      tenantId,
      product,
      lines: [{ variant: variants["40"], quantity: 2, unitPrice: SELLING_PRICE, discountAmount: 100 }],
      channel: "pos",
      status: "completed",
      paymentStatus: "paid",
      paymentMethod: "cash",
      financialAccountId: financialAccount.id,
      sourceLabel: "pos-sale",
    });
    const afterSale = await snapshotStocks(client, variants);

    const codOrder = await createOrder(client, {
      tenantId,
      product,
      lines: [{ variant: variants["41"], quantity: 1, unitPrice: SELLING_PRICE, discountAmount: 0 }],
      channel: "website",
      status: "pending",
      paymentStatus: "unpaid",
      paymentMethod: "cod",
      shippingFee: 80,
      paidAmount: 0,
      financialAccountId: financialAccount.id,
      sourceLabel: "online-cod",
    });
    const afterOrder = await snapshotStocks(client, variants);
    const shippingProof = await addShippingOnlyProof(client, { tenantId, order: codOrder.order, financialAccountId: financialAccount.id });

    const posReturn = await createReturn(client, {
      tenantId,
      order: posSale.order,
      line: posSale.lines[0],
      quantity: 1,
      refundAmount: 950,
      financialAccountId: financialAccount.id,
      sourceLabel: "pos-return",
    });
    const afterReturn = await snapshotStocks(client, variants);

    const multiOrder = await createOrder(client, {
      tenantId,
      product,
      lines: [
        { variant: variants["40"], quantity: 1, unitPrice: SELLING_PRICE, discountAmount: 0 },
        { variant: variants["41"], quantity: 1, unitPrice: SELLING_PRICE, discountAmount: 0 },
      ],
      channel: "pos",
      status: "completed",
      paymentStatus: "paid",
      paymentMethod: "cash",
      financialAccountId: financialAccount.id,
      sourceLabel: "partial-return-base",
    });
    const partialReturn = await createReturn(client, {
      tenantId,
      order: multiOrder.order,
      line: multiOrder.lines[1],
      quantity: 1,
      refundAmount: 1000,
      financialAccountId: financialAccount.id,
      sourceLabel: "partial-return",
    });
    const afterPartialReturn = await snapshotStocks(client, variants);

    const cancelBase = await createOrder(client, {
      tenantId,
      product,
      lines: [{ variant: variants["40"], quantity: 1, unitPrice: SELLING_PRICE, discountAmount: 0 }],
      channel: "website",
      status: "pending",
      paymentStatus: "unpaid",
      paymentMethod: "cod",
      paidAmount: 0,
      sourceLabel: "cancel-restore",
    });
    const beforeCancelRestore = await snapshotStocks(client, variants);
    const cancelRestore = await cancelOrderAndRestoreStock(client, { tenantId, order: cancelBase.order, lines: cancelBase.lines });
    const doubleRestore = await cancelOrderAndRestoreStock(client, { tenantId, order: cancelRestore.order, lines: cancelBase.lines });
    const afterCancel = await snapshotStocks(client, variants);

    const journal = await sumJournal(client, tenantId);
    const actualCash = await getFinancialAccountBalance(client, financialAccount.id);
    const finalStock = await snapshotStocks(client, variants);
    const expected = {
      purchaseTotal: 7500,
      stockAfterPurchase: { size40: 10, size41: 5 },
      stockAfterSale: { size40: 8, size41: 5 },
      stockAfterOrder: { size40: 8, size41: 4 },
      stockAfterReturn: { size40: 9, size41: 4 },
      stockAfterPartialReturn: { size40: 8, size41: 4 },
      stockBeforeCancelRestore: { size40: 7, size41: 4 },
      finalStock: { size40: 8, size41: 4 },
      revenue: 1950,
      paidAmount: 2030,
      shipping: 80,
      discount: 100,
      cogs: 1000,
      profit: 950,
      cashBalance: 2030,
      codGrandTotal: 1080,
      codPaidAfterProof: 80,
      codRemainingAfterProof: 1000,
      purchasePayable: 7500,
    };
    const actual = {
      purchaseTotal: purchase.total,
      stockAfterPurchase: afterPurchase,
      stockAfterSale: afterSale,
      stockAfterOrder: afterOrder,
      stockAfterReturn: afterReturn,
      stockAfterPartialReturn: afterPartialReturn,
      stockBeforeCancelRestore: beforeCancelRestore,
      finalStock,
      revenue: money(posSale.total + multiOrder.total - posReturn.refundAmount - partialReturn.refundAmount),
      paidAmount: actualCash,
      shipping: money(codOrder.order.shipping_fee ?? codOrder.order.service_fee),
      discount: money(posSale.discount + multiOrder.discount),
      cogs: money(posSale.cogs + multiOrder.cogs - posReturn.cogsReversal - partialReturn.cogsReversal),
      profit: money((posSale.total + multiOrder.total - posReturn.refundAmount - partialReturn.refundAmount) - (posSale.cogs + multiOrder.cogs - posReturn.cogsReversal - partialReturn.cogsReversal)),
      cashBalance: actualCash,
      codGrandTotal: money(codOrder.total),
      codPaidAfterProof: shippingProof.paid,
      codRemainingAfterProof: shippingProof.remaining,
      purchasePayable: money(journal["2000"]?.credit || 0),
      inventoryAssetDebit: money(journal["1200"]?.debit || 0),
      salesRevenueCredit: money(journal["4000"]?.credit || 0),
      cogsDebit: money(journal["5000"]?.debit || 0),
    };

    addCheck(checks, "starting stock size 40", 0, startingStock.size40);
    addCheck(checks, "starting stock size 41", 0, startingStock.size41);
    addCheck(checks, "purchase total", expected.purchaseTotal, actual.purchaseTotal);
    addCheck(checks, "stock after purchase size 40", expected.stockAfterPurchase.size40, actual.stockAfterPurchase.size40);
    addCheck(checks, "stock after purchase size 41", expected.stockAfterPurchase.size41, actual.stockAfterPurchase.size41);
    addCheck(checks, "stock after POS sale size 40", expected.stockAfterSale.size40, actual.stockAfterSale.size40);
    addCheck(checks, "stock after online order size 41", expected.stockAfterOrder.size41, actual.stockAfterOrder.size41);
    addCheck(checks, "COD grand total", expected.codGrandTotal, actual.codGrandTotal);
    addCheck(checks, "COD paid after shipping proof", expected.codPaidAfterProof, actual.codPaidAfterProof);
    addCheck(checks, "COD remaining after shipping proof", expected.codRemainingAfterProof, actual.codRemainingAfterProof);
    checks.push({
      name: "COD order remains partially paid, not paid",
      expected: "partially_paid",
      actual: (await client.query("SELECT payment_status FROM orders WHERE id = $1", [codOrder.order.id])).rows[0]?.payment_status,
      status: (await client.query("SELECT payment_status FROM orders WHERE id = $1", [codOrder.order.id])).rows[0]?.payment_status === "partially_paid" ? "pass" : "fail",
    });
    addCheck(checks, "stock after POS return size 40", expected.stockAfterReturn.size40, actual.stockAfterReturn.size40);
    addCheck(checks, "stock after partial return size 41", expected.stockAfterPartialReturn.size41, actual.stockAfterPartialReturn.size41);
    addCheck(checks, "stock before cancel restore size 40", expected.stockBeforeCancelRestore.size40, actual.stockBeforeCancelRestore.size40);
    addCheck(checks, "stock after cancel restore size 40", expected.finalStock.size40, actual.finalStock.size40);
    checks.push({
      name: "cancel restore is not applied twice",
      expected: true,
      actual: doubleRestore.alreadyRestored === true && afterCancel.size40 === finalStock.size40,
      status: doubleRestore.alreadyRestored === true && afterCancel.size40 === finalStock.size40 ? "pass" : "fail",
    });
    addCheck(checks, "expected vs actual revenue", expected.revenue, actual.revenue);
    addCheck(checks, "expected vs actual paid amount", expected.paidAmount, actual.paidAmount);
    addCheck(checks, "expected vs actual shipping", expected.shipping, actual.shipping);
    addCheck(checks, "expected vs actual discount", expected.discount, actual.discount);
    addCheck(checks, "expected vs actual COGS", expected.cogs, actual.cogs);
    addCheck(checks, "expected vs actual profit", expected.profit, actual.profit);
    addCheck(checks, "expected vs actual cash account balance", expected.cashBalance, actual.cashBalance);
    addCheck(checks, "supplier/AP accounting entry", expected.purchasePayable, actual.purchasePayable);

    const report = {
      source: QA_SOURCE,
      tenant_id: tenantId,
      product: { id: product.id, name: PRODUCT_NAME, sku: SKU, barcode: SKU },
      supplier: { id: supplier.id, name: SUPPLIER_NAME },
      records: {
        purchase_id: purchase.purchase.id,
        pos_order_id: posSale.order.id,
        cod_order_id: codOrder.order.id,
        pos_return_id: posReturn.returnRow.id,
        partial_return_order_id: multiOrder.order.id,
        partial_return_id: partialReturn.returnRow.id,
        cancelled_order_id: cancelBase.order.id,
      },
      stock: {
        starting: startingStock,
        after_purchase: afterPurchase,
        after_sale: afterSale,
        after_order: afterOrder,
        after_return: afterReturn,
        after_partial_return: afterPartialReturn,
        before_cancel_restore: beforeCancelRestore,
        final: finalStock,
      },
      expected,
      actual,
      checks,
    };

    const status = checks.every((check) => check.status === "pass") ? "pass" : "fail";
    await insertFlexible(client, "qa_accounting_inventory_reports", {
      tenant_id: tenantId,
      source: QA_SOURCE,
      status,
      report,
    });
    await client.query("COMMIT");
    return { status, report };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
};

const printReport = ({ status, report }) => {
  console.log("\nQA Accounting / Inventory Stress Test");
  console.log(`Status: ${status.toUpperCase()}`);
  console.table(report.checks.map((check) => ({
    check: check.name,
    expected: check.expected,
    actual: check.actual,
    status: check.status,
  })));
  console.log("Summary:", JSON.stringify({
    stock: report.stock,
    expected: report.expected,
    actual: report.actual,
    records: report.records,
  }, null, 2));
};

const main = async () => {
  const cleanupOnly = process.argv.includes("--cleanup");
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await ensureQaSchema(client);
    const tenantId = await getTenantId(client);
    if (cleanupOnly) {
      await cleanupQaData(client, tenantId);
      await client.query("COMMIT");
      console.log(`[qa] cleaned ${QA_SOURCE} records for tenant ${tenantId}`);
      return;
    }
    await client.query("ROLLBACK");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  const result = await runStressTest();
  printReport(result);
  if (result.status !== "pass") process.exitCode = 1;
};

main()
  .catch((error) => {
    console.error("[qa] stress test failed", {
      message: error.message,
      stack: error.stack,
    });
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.end();
  });
