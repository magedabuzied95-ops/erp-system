import crypto from "node:crypto";

import db from "../database/db.js";
import logActivity from "../utils/logActivity.js";
import { io } from "../utils/socket.js";
import { getTenantId, isSuperAdminUser } from "../utils/requestScope.js";
import { recordEmployeeAnalytics } from "../utils/employeeAnalytics.js";
import { ensureAttendanceSchema } from "../utils/attendanceSchema.js";
import { adjustVariantStock, recordInventoryMovement } from "../services/inventoryService.js";
import { ensureAccountingSchema, postSaleEntry, postReturnEntry, postWalletLiabilityEntry } from "../services/accountingService.js";
import { ensureLoyaltySchema, processOrderLoyalty, resolveOrCreateCustomerAccount, reverseOrderLoyalty } from "../services/loyaltyService.js";
import { ensureWalletSchema, recordWalletTransaction } from "../services/walletService.js";
import { detectMarketingAttribution, logAttributionEvent } from "../services/marketingAttributionService.js";
import { redeemCoupon, validateCoupon } from "../services/couponsService.js";
import { createSystemNotification } from "../services/notificationsService.js";
import {
  ensureSalesCommissionSchema,
  getSalesSettings,
  getSalespersonSnapshot,
  recordSalesCommissionForOrder,
} from "../services/salesCommissionService.js";

const ensurePosShiftOrderColumns = async (client, tenantId = null) => {
  await client.query(`ALTER TABLE IF EXISTS cashbox ADD COLUMN IF NOT EXISTS tenant_id BIGINT`);
  await client.query(`ALTER TABLE IF EXISTS cashbox ADD COLUMN IF NOT EXISTS status VARCHAR(50) NOT NULL DEFAULT 'open'`);
  await client.query(`ALTER TABLE IF EXISTS cashbox ADD COLUMN IF NOT EXISTS opened_by BIGINT`);
  await client.query(`ALTER TABLE IF EXISTS cashbox ADD COLUMN IF NOT EXISTS opened_at TIMESTAMP NULL`);
  await client.query(`ALTER TABLE IF EXISTS cashbox ADD COLUMN IF NOT EXISTS closed_at TIMESTAMP NULL`);
  await client.query(`ALTER TABLE IF EXISTS cashbox ADD COLUMN IF NOT EXISTS shift_summary TEXT`);
  await client.query(`ALTER TABLE IF EXISTS cashbox ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP`);
  if (tenantId !== null && tenantId !== undefined) {
    await client.query(`UPDATE cashbox SET tenant_id = $1 WHERE tenant_id IS NULL`, [tenantId]);
  }

  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS tenant_id BIGINT`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS invoice_number VARCHAR(100)`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS customer_id BIGINT`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS customer_name VARCHAR(255)`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS customer_phone VARCHAR(80)`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS channel VARCHAR(50) NOT NULL DEFAULT 'pos'`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS branch_id BIGINT`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS cashier_id BIGINT`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS sales_employee_id BIGINT`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS salesperson_id BIGINT`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS salesperson_name VARCHAR(255)`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS salesperson_commission_type VARCHAR(20)`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS salesperson_commission_value NUMERIC(12,2) NOT NULL DEFAULT 0`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS salesperson_fixed_mode VARCHAR(30)`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS salesperson_excluded_product_ids JSONB NOT NULL DEFAULT '[]'::jsonb`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS shift_id BIGINT`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS status VARCHAR(50) NOT NULL DEFAULT 'pending'`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS payment_status VARCHAR(50) NOT NULL DEFAULT 'unpaid'`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS payment_method VARCHAR(50)`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS shipping_fee NUMERIC DEFAULT 0`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS shipping_payment_screenshot TEXT`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS shipping_payment_reference TEXT`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS shipping_payment_verified_at TIMESTAMP NULL`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS shipping_payment_verified_by INTEGER NULL`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS customer_trust_counted_at TIMESTAMP NULL`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS subtotal NUMERIC(12,2) NOT NULL DEFAULT 0`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS tax_amount NUMERIC(12,2) NOT NULL DEFAULT 0`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS service_fee NUMERIC(12,2) NOT NULL DEFAULT 0`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS total_amount NUMERIC(12,2) NOT NULL DEFAULT 0`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS total_price NUMERIC(12,2) NOT NULL DEFAULT 0`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS total NUMERIC(12,2) NOT NULL DEFAULT 0`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS paid_amount NUMERIC(12,2) NOT NULL DEFAULT 0`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS change_amount NUMERIC(12,2) NOT NULL DEFAULT 0`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS notes TEXT`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS public_token TEXT`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS invoice_public_enabled BOOLEAN NOT NULL DEFAULT TRUE`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS created_by BIGINT`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP NULL`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS cancelled_by BIGINT NULL`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS returned_at TIMESTAMP NULL`);
  await client.query(`ALTER TABLE IF EXISTS customers ADD COLUMN IF NOT EXISTS is_trusted BOOLEAN DEFAULT false`);
  await client.query(`ALTER TABLE IF EXISTS customers ADD COLUMN IF NOT EXISTS cod_enabled BOOLEAN DEFAULT false`);
  await client.query(`ALTER TABLE IF EXISTS customers ADD COLUMN IF NOT EXISTS completed_orders INTEGER DEFAULT 0`);
  await client.query(`
    CREATE TABLE IF NOT EXISTS returns (
      id BIGSERIAL PRIMARY KEY,
      tenant_id BIGINT NULL,
      order_id BIGINT NOT NULL,
      return_number VARCHAR(100) NOT NULL,
      status VARCHAR(50) NOT NULL DEFAULT 'pending',
      reason TEXT,
      restock BOOLEAN NOT NULL DEFAULT FALSE,
      refund_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      refund_method VARCHAR(50),
      exchange_difference NUMERIC(12,2) NOT NULL DEFAULT 0,
      created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS return_items (
      id BIGSERIAL PRIMARY KEY,
      tenant_id BIGINT NULL,
      return_id BIGINT NOT NULL REFERENCES returns(id) ON DELETE CASCADE,
      order_item_id BIGINT NOT NULL,
      variant_id BIGINT NULL,
      quantity INTEGER NOT NULL DEFAULT 1,
      refund_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      restock BOOLEAN NOT NULL DEFAULT FALSE
    )
  `);
  await client.query(`ALTER TABLE IF EXISTS returns ADD COLUMN IF NOT EXISTS refund_method VARCHAR(50)`);
  await client.query(`ALTER TABLE IF EXISTS returns ADD COLUMN IF NOT EXISTS exchange_difference NUMERIC(12,2) NOT NULL DEFAULT 0`);
  await client.query(`
    UPDATE orders
    SET invoice_number = 'INV-' || id::text
    WHERE invoice_number IS NULL OR invoice_number = ''
  `);

  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS payment_method VARCHAR(50) DEFAULT 'cash'`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS cash_amount NUMERIC(12,2) NOT NULL DEFAULT 0`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS card_amount NUMERIC(12,2) NOT NULL DEFAULT 0`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS wallet_payment_amount NUMERIC(12,2) NOT NULL DEFAULT 0`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS attendance_log_id BIGINT NULL`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS warehouse_id BIGINT NULL`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS source VARCHAR(50) NOT NULL DEFAULT 'pos'`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS marketing_source TEXT NULL`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS marketing_platform TEXT NULL`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS marketing_post_id TEXT NULL`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS marketing_campaign TEXT NULL`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS attribution_type TEXT NULL`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS marketing_tracking_code TEXT NULL`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS marketing_session_id TEXT NULL`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS coupon_id BIGINT NULL`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS coupon_code VARCHAR(80)`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS coupon_discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0`);

  await client.query(`ALTER TABLE IF EXISTS order_items ADD COLUMN IF NOT EXISTS tenant_id BIGINT`);
  await client.query(`ALTER TABLE IF EXISTS order_items ADD COLUMN IF NOT EXISTS product_id BIGINT`);
  await client.query(`ALTER TABLE IF EXISTS order_items ADD COLUMN IF NOT EXISTS product_name VARCHAR(255) NOT NULL DEFAULT ''`);
  await client.query(`ALTER TABLE IF EXISTS order_items ADD COLUMN IF NOT EXISTS variant_name VARCHAR(255)`);
  await client.query(`ALTER TABLE IF EXISTS order_items ADD COLUMN IF NOT EXISTS sku VARCHAR(120)`);
  await client.query(`ALTER TABLE IF EXISTS order_items ADD COLUMN IF NOT EXISTS barcode VARCHAR(120)`);
  await client.query(`ALTER TABLE IF EXISTS order_items ADD COLUMN IF NOT EXISTS sale_price NUMERIC(12,2) NOT NULL DEFAULT 0`);
  await client.query(`ALTER TABLE IF EXISTS order_items ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0`);
  await client.query(`ALTER TABLE IF EXISTS order_items ADD COLUMN IF NOT EXISTS tax_amount NUMERIC(12,2) NOT NULL DEFAULT 0`);
  await client.query(`ALTER TABLE IF EXISTS order_items ADD COLUMN IF NOT EXISTS total_amount NUMERIC(12,2) NOT NULL DEFAULT 0`);
  await client.query(`ALTER TABLE IF EXISTS order_items ADD COLUMN IF NOT EXISTS returned_quantity INTEGER NOT NULL DEFAULT 0`);
  await client.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'order_items'
          AND column_name = 'price'
      ) THEN
        ALTER TABLE order_items ALTER COLUMN price SET DEFAULT 0;
        ALTER TABLE order_items ALTER COLUMN price DROP NOT NULL;
      END IF;
    END $$;
  `);

  await client.query(`ALTER TABLE IF EXISTS transactions ADD COLUMN IF NOT EXISTS tenant_id BIGINT`);
  await client.query(`ALTER TABLE IF EXISTS transactions ADD COLUMN IF NOT EXISTS cashbox_id BIGINT`);

  await client.query(`
    CREATE TABLE IF NOT EXISTS order_reprint_logs (
      id BIGSERIAL PRIMARY KEY,
      tenant_id BIGINT NULL,
      order_id BIGINT NOT NULL,
      user_id BIGINT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS order_edit_audits (
      id BIGSERIAL PRIMARY KEY,
      tenant_id BIGINT NULL,
      order_id BIGINT NOT NULL,
      old_items JSONB NOT NULL DEFAULT '[]'::jsonb,
      new_items JSONB NOT NULL DEFAULT '[]'::jsonb,
      old_total NUMERIC(12,2) NOT NULL DEFAULT 0,
      new_total NUMERIC(12,2) NOT NULL DEFAULT 0,
      user_id BIGINT NULL,
      reason TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await client.query(`ALTER TABLE IF EXISTS orders ALTER COLUMN public_token SET DEFAULT replace(gen_random_uuid()::text, '-', '')`);
  await client.query(`ALTER TABLE IF EXISTS orders ALTER COLUMN invoice_public_enabled SET DEFAULT TRUE`);
  await client.query(`
    UPDATE orders
    SET public_token = replace(gen_random_uuid()::text, '-', '')
    WHERE public_token IS NULL OR public_token = ''
  `);
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_public_token_unique
    ON orders (public_token)
    WHERE public_token IS NOT NULL
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS commission_rules (
      id BIGSERIAL PRIMARY KEY,
      tenant_id BIGINT,
      name VARCHAR(255) NOT NULL,
      scope_type VARCHAR(50) NOT NULL DEFAULT 'global',
      scope_id BIGINT NULL,
      rule_type VARCHAR(50) NOT NULL DEFAULT 'percentage',
      value NUMERIC(12,2) NOT NULL DEFAULT 0,
      apply_to VARCHAR(50) NOT NULL DEFAULT 'sale',
      priority INTEGER NOT NULL DEFAULT 0,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_by BIGINT,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS employee_sales (
      id BIGSERIAL PRIMARY KEY,
      tenant_id BIGINT,
      order_id BIGINT NOT NULL,
      cashier_id BIGINT,
      sales_employee_id BIGINT,
      shift_id BIGINT,
      branch_id BIGINT,
      total_sales NUMERIC(12,2) NOT NULL DEFAULT 0,
      total_orders INTEGER NOT NULL DEFAULT 1,
      commission_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      refund_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      status VARCHAR(50) NOT NULL DEFAULT 'recorded',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (tenant_id, order_id)
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS employee_commissions (
      id BIGSERIAL PRIMARY KEY,
      tenant_id BIGINT,
      employee_id BIGINT NOT NULL,
      order_id BIGINT NOT NULL,
      order_item_id BIGINT,
      product_id BIGINT,
      category_id BIGINT,
      commission_rule_id BIGINT,
      rule_type VARCHAR(50) NOT NULL DEFAULT 'percentage',
      scope_type VARCHAR(50) NOT NULL DEFAULT 'global',
      sale_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      commission_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      status VARCHAR(50) NOT NULL DEFAULT 'earned',
      branch_id BIGINT,
      shift_id BIGINT,
      created_by BIGINT,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await client.query(`CREATE INDEX IF NOT EXISTS idx_orders_tenant_id ON orders (tenant_id)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_orders_channel_created ON orders (channel, created_at DESC)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_orders_tenant_created_id ON orders (tenant_id, created_at DESC, id DESC)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_orders_tenant_channel_created_id ON orders (tenant_id, channel, created_at DESC, id DESC)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_orders_tenant_source_created_id ON orders (tenant_id, source, created_at DESC, id DESC)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_orders_tenant_customer_created ON orders (tenant_id, customer_id, created_at DESC)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_orders_attendance_tenant ON orders (attendance_log_id, tenant_id)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_orders_shift_tenant_created ON orders (tenant_id, shift_id, created_at DESC)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_order_items_tenant_order ON order_items (tenant_id, order_id)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_order_items_order_id_id ON order_items (order_id, id)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_order_items_product_order ON order_items (product_id, order_id)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_order_items_variant_order ON order_items (variant_id, order_id)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_order_reprint_logs_order ON order_reprint_logs (order_id, created_at DESC)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_order_edit_audits_order ON order_edit_audits (order_id, created_at DESC)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_transactions_tenant_id ON transactions (tenant_id)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_cashbox_tenant_id ON cashbox (tenant_id)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_commission_rules_tenant_id ON commission_rules (tenant_id, is_active, scope_type)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_employee_sales_tenant_id ON employee_sales (tenant_id, sales_employee_id, cashier_id, created_at DESC)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_employee_commissions_tenant_id ON employee_commissions (tenant_id, employee_id, created_at DESC)`);
  await client.query(`ALTER TABLE IF EXISTS products ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP`);
  await client.query(`ALTER TABLE IF EXISTS product_variants ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP`);
  await ensureSalesCommissionSchema(client);
};

const generatePublicToken = () => crypto.randomBytes(24).toString("hex");

const toFiniteNumber = (value, fallback = 0) => {
  const number = Number(value || fallback);
  return Number.isFinite(number) ? number : fallback;
};

const firstValue = (...values) => values.find((value) => value !== undefined && value !== null && value !== "");

const normalizeOrderItemPayload = (item = {}) => {
  const quantity = toFiniteNumber(firstValue(item.quantity, item.qty), 0);
  const price = toFiniteNumber(firstValue(item.price, item.unit_price, item.sale_price), 0);
  const discountAmount = toFiniteNumber(firstValue(item.discount_amount, item.discountAmount), 0);
  return {
    ...item,
    product_id: firstValue(item.product_id, item.productId) || null,
    variant_id: firstValue(item.variant_id, item.variantId, item.product_variant_id, item.productVariantId) || null,
    product_name: firstValue(item.product_name, item.productName, item.name) || "",
    variant_name: firstValue(item.variant_name, item.variantName) || "",
    quantity,
    qty: quantity,
    price,
    unit_price: price,
    sale_price: firstValue(item.sale_price, item.price, item.unit_price, price),
    discount_amount: discountAmount,
    total_amount: Math.max(0, toFiniteNumber(firstValue(item.total_amount, item.totalAmount), price * quantity - discountAmount)),
  };
};

const normalizeCreateOrderPayload = (body = {}) => {
  const rawItems = Array.isArray(body.items) ? body.items : Array.isArray(body.order_items) ? body.order_items : [];
  return {
    ...body,
    customer_id: firstValue(body.customer_id, body.customerId) || null,
    customer_name: firstValue(body.customer_name, body.customerName) || "",
    customer_phone: firstValue(body.customer_phone, body.customerPhone) || "",
    payment_method: firstValue(body.payment_method, body.paymentMethod) || "cash",
    payment_status: firstValue(body.payment_status, body.paymentStatus) || body.status || "paid",
    channel: firstValue(body.channel, body.order_type, body.orderType, body.source) || "pos",
    branch_id: firstValue(body.branch_id, body.branchId) || null,
    warehouse_id: firstValue(body.warehouse_id, body.warehouseId) || null,
    cashier_id: firstValue(body.cashier_id, body.cashierId) || null,
    sales_employee_id: firstValue(body.sales_employee_id, body.salesEmployeeId) || null,
    salesperson_id: firstValue(body.salesperson_id, body.salespersonId, body.sales_employee_id, body.salesEmployeeId) || null,
    shift_id: firstValue(body.shift_id, body.shiftId) || null,
    attendance_log_id: firstValue(body.attendance_log_id, body.attendanceLogId) || null,
    subtotal: firstValue(body.subtotal, body.sub_total),
    discount_amount: firstValue(body.discount_amount, body.discountAmount, body.discount),
    tax_amount: firstValue(body.tax_amount, body.taxAmount, body.tax),
    service_fee: firstValue(body.service_fee, body.serviceFee, body.shipping_fee, body.shippingFee),
    paid_amount: firstValue(body.paid_amount, body.paidAmount),
    change_amount: firstValue(body.change_amount, body.changeAmount),
    items: rawItems.map(normalizeOrderItemPayload),
  };
};

const safeOrderLogPayload = (payload = {}) => ({
  source: payload.channel || payload.source || payload.order_type || null,
  customer_id: payload.customer_id || null,
  items_count: Array.isArray(payload.items) ? payload.items.length : 0,
  payment_method: payload.payment_method || null,
  payment_status: payload.payment_status || null,
  branch_id: payload.branch_id || null,
  warehouse_id: payload.warehouse_id || null,
  totals: {
    subtotal: payload.subtotal ?? null,
    discount_amount: payload.discount_amount ?? null,
    tax_amount: payload.tax_amount ?? null,
    service_fee: payload.service_fee ?? null,
    total: payload.total ?? payload.total_amount ?? null,
    paid_amount: payload.paid_amount ?? null,
  },
});

const resolveRequestOrigin = (req) => {
  const origin = String(req?.get?.("origin") || "").trim().replace(/\/$/, "");
  if (origin) return origin;

  const forwardedProto = String(req?.get?.("x-forwarded-proto") || "").split(",")[0].trim();
  const forwardedHost = String(req?.get?.("x-forwarded-host") || "").split(",")[0].trim();
  const protocol = forwardedProto || req?.protocol || "http";
  const host = forwardedHost || req?.get?.("host") || "";

  if (!host) return "";
  return `${protocol}://${host}`;
};

const resolveFrontendOrigin = (req) => {
  const envOrigin = String(process.env.FRONTEND_URL || process.env.CLIENT_URL || process.env.APP_URL || "").trim().replace(/\/$/, "");
  if (envOrigin) return envOrigin;
  return resolveRequestOrigin(req);
};

const buildPublicInvoiceUrl = (req, token) => {
  const invoicePath = `/invoice/${encodeURIComponent(String(token || "").trim())}`;
  const origin = resolveFrontendOrigin(req);
  return origin ? `${origin}${invoicePath}` : invoicePath;
};

const buildShortPublicInvoiceUrl = (req, token) => {
  const invoicePath = `/i/${encodeURIComponent(String(token || "").trim())}`;
  const origin = resolveFrontendOrigin(req);
  return origin ? `${origin}${invoicePath}` : invoicePath;
};

const DEFAULT_GOOGLE_REVIEW_URL =
  "https://g.page/r/Ccj4YSNAoHbVEAE/review";

const getGoogleReviewUrl = () =>
  String(process.env.GOOGLE_REVIEW_URL || DEFAULT_GOOGLE_REVIEW_URL).trim() ||
  DEFAULT_GOOGLE_REVIEW_URL;

const normalizeInvoiceMoney = (value) => Number(Number(value || 0).toFixed(2));

const loadPublicInvoiceByToken = async (token) => {
  const safeToken = String(token || "").trim();
  if (!safeToken) return null;

  const orderResult = await db.query(
    `
    SELECT
      o.id,
      o.tenant_id,
      o.invoice_number,
      o.public_token,
      o.invoice_public_enabled,
      o.customer_id,
      o.customer_name AS order_customer_name,
      o.status,
      o.payment_status,
      o.subtotal,
      o.discount_amount,
      o.coupon_code,
      o.coupon_discount_amount,
      o.tax_amount,
      o.service_fee,
      o.total,
      o.paid_amount,
      o.payment_method,
      o.created_at,
      c.name AS customer_record_name,
      c.phone AS customer_record_phone
    FROM orders o
    LEFT JOIN customers c ON c.id = o.customer_id
    WHERE o.public_token = $1
      AND COALESCE(o.invoice_public_enabled, TRUE) = TRUE
    LIMIT 1
    `,
    [safeToken]
  );

  const order = orderResult.rows[0] || null;
  if (!order) return null;

  const itemsResult = await db.query(
    `
    SELECT
      oi.product_name,
      oi.variant_name,
      oi.quantity,
      oi.sale_price,
      oi.discount_amount,
      oi.total_amount
    FROM order_items oi
    WHERE oi.order_id = $1
    ORDER BY oi.id ASC
    `,
    [order.id]
  );

  const customerName = order.order_customer_name || order.customer_record_name || "Walk-in Customer";
  const customerPhone = order.customer_record_phone || "";
  const publicInvoiceUrl = buildPublicInvoiceUrl(null, order.public_token);
  const shortInvoiceUrl = buildShortPublicInvoiceUrl(null, order.public_token);
  const items = itemsResult.rows.map((item) => ({
    name: item.product_name || "Item",
    variant: item.variant_name || "Default",
    quantity: Number(item.quantity || 0),
    price: normalizeInvoiceMoney(item.sale_price),
    discount: normalizeInvoiceMoney(item.discount_amount),
    total: normalizeInvoiceMoney(item.total_amount),
  }));

  return {
    id: order.id,
    order_id: order.id,
    invoice_number: order.invoice_number,
    public_token: order.public_token,
    public_invoice_url: publicInvoiceUrl,
    public_invoice_short_url: shortInvoiceUrl,
    short_invoice_url: shortInvoiceUrl,
    google_review_url: getGoogleReviewUrl(),
    created_at: order.created_at,
    order_date: order.created_at,
    customer_name: customerName,
    customer_phone: customerPhone,
    store: {
      name: process.env.STORE_NAME || process.env.APP_NAME || "ERP Store",
      logo_url: process.env.STORE_LOGO_URL || "",
      address: process.env.STORE_ADDRESS || "",
      phone: process.env.STORE_PHONE || "",
      email: process.env.STORE_EMAIL || "",
      invoice_footer: process.env.INVOICE_FOOTER || "",
      branch_name: "",
      branch_code: "",
      branch_address: "",
      branch_phone: "",
    },
    customer: {
      name: customerName,
      phone: customerPhone,
    },
    items,
    totals: {
      subtotal: normalizeInvoiceMoney(order.subtotal),
      discount: normalizeInvoiceMoney(order.discount_amount),
      coupon_code: order.coupon_code || "",
      coupon_discount: normalizeInvoiceMoney(order.coupon_discount_amount),
      tax: 0,
      service: normalizeInvoiceMoney(order.service_fee),
      total: normalizeInvoiceMoney(order.total),
      paid: normalizeInvoiceMoney(order.paid_amount),
      payment_method: order.payment_method || "n/a",
    },
    status: order.status || "Pending",
    payment_status: order.payment_status || "unpaid",
  };
};

const buildPublicInvoicePdfBuffer = async (invoice) => {
  const [jspdfModule, autoTableModule] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  const JsPDF = jspdfModule.jsPDF || jspdfModule.default || jspdfModule;
  const autoTable = autoTableModule.default || autoTableModule.autoTable || autoTableModule;
  const doc = new JsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true });

  const margin = 12;
  const pageWidth = doc.internal.pageSize.getWidth();

  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text(invoice.store?.name || "ERP Store", margin, 18);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(invoice.store?.branch_name || invoice.store?.branch_code || "", margin, 24);
  doc.text(invoice.store?.address || "", margin, 29, { maxWidth: pageWidth - margin * 2 });

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("INVOICE", pageWidth - margin, 18, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(`No: ${invoice.invoice_number || "n/a"}`, pageWidth - margin, 24, { align: "right" });
  doc.text(`Date: ${invoice.order_date || new Date().toISOString()}`, pageWidth - margin, 29, { align: "right" });

  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(margin, 36, pageWidth - margin * 2, 24, 2, 2, "S");
  doc.setFont("helvetica", "bold");
  doc.text("Customer", margin + 3, 42);
  doc.setFont("helvetica", "normal");
  doc.text(invoice.customer?.name || "Walk-in Customer", margin + 3, 48);
  if (invoice.customer?.phone) {
    doc.text(`Phone: ${invoice.customer.phone}`, margin + 3, 53);
  }
  doc.text(`Status: ${invoice.status || "Pending"}`, pageWidth - margin - 3, 42, { align: "right" });
  doc.text(`Payment: ${invoice.payment_status || "unpaid"}`, pageWidth - margin - 3, 48, { align: "right" });

  const rows = Array.isArray(invoice.items) ? invoice.items : [];
  autoTable(doc, {
    startY: 64,
    head: [["Item", "Variant", "Qty", "Price", "Discount", "Total"]],
    body: rows.map((item) => [
      item.name || "Item",
      item.variant || "Default",
      String(item.quantity || 0),
      normalizeInvoiceMoney(item.price).toFixed(2),
      normalizeInvoiceMoney(item.discount).toFixed(2),
      normalizeInvoiceMoney(item.total).toFixed(2),
    ]),
    theme: "grid",
    margin: { left: margin, right: margin },
    styles: {
      fontSize: 8,
      cellPadding: 1.8,
      lineColor: [226, 232, 240],
    },
    headStyles: {
      fillColor: [15, 23, 42],
      textColor: 255,
    },
    columnStyles: {
      2: { halign: "center", cellWidth: 16 },
      3: { halign: "right" },
      4: { halign: "right" },
      5: { halign: "right" },
    },
  });

  const footerY = (doc.lastAutoTable?.finalY || 96) + 8;
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(margin, footerY, pageWidth - margin * 2, 32, 2, 2, "S");
  doc.setFont("helvetica", "bold");
  doc.text("Totals", margin + 3, footerY + 6);
  doc.setFont("helvetica", "normal");
  doc.text(`Subtotal: ${normalizeInvoiceMoney(invoice.totals?.subtotal).toFixed(2)}`, margin + 3, footerY + 12);
  doc.text(`Discount: ${normalizeInvoiceMoney(invoice.totals?.discount).toFixed(2)}`, margin + 3, footerY + 17);
  doc.text(`Service: ${normalizeInvoiceMoney(invoice.totals?.service).toFixed(2)}`, margin + 70, footerY + 12);
  doc.text(`Paid: ${normalizeInvoiceMoney(invoice.totals?.paid).toFixed(2)}`, margin + 70, footerY + 17);
  doc.setFont("helvetica", "bold");
  doc.text(`Total: ${normalizeInvoiceMoney(invoice.totals?.total).toFixed(2)}`, margin + 70, footerY + 22);
  doc.setFont("helvetica", "normal");
  doc.text(`Public link: ${invoice.public_invoice_url || "n/a"}`, margin, footerY + 40, { maxWidth: pageWidth - margin * 2 });

  return Buffer.from(doc.output("arraybuffer"));
};

const resolveOpenPosShift = async (client, { tenantId, employeeId, attendanceLogId }) => {
  const params = [employeeId || 0, tenantId];
  const attendanceFilter = attendanceLogId ? "AND al.id = $3" : "AND al.attendance_date = CURRENT_DATE";
  if (attendanceLogId) params.push(attendanceLogId);

  const result = await client.query(
    `
    SELECT
      al.id AS attendance_log_id,
      al.employee_id,
      al.check_in,
      al.check_out,
      e.branch_id,
      e.full_name AS employee_name,
      b.name AS branch_name
    FROM attendance_logs al
    JOIN employees e ON e.id = al.employee_id
    LEFT JOIN branches b ON b.id = e.branch_id
    WHERE al.employee_id = $1
      AND ($2::bigint IS NULL OR al.tenant_id = $2::bigint)
      ${attendanceFilter}
    ORDER BY al.created_at DESC
    LIMIT 1
    `,
    params
  );

  const shift = result.rows[0] || null;
  if (!shift || shift.check_out) return null;
  return shift;
};

const normalizeVariationMode = (value) => String(value || "full_variations").trim().toLowerCase();
const isFullVariationMode = (value) => normalizeVariationMode(value) === "full_variations";
const isRealId = (value) => value !== undefined && value !== null && value !== "" && !String(value).startsWith("product:");

const getOrderItemLabel = (item = {}) =>
  item.product_name || item.name || item.variant_name || `product ${item.product_id || "unknown"}`;

const adjustProductStock = async (client, data = {}) => {
  const tenantId = data.tenantId ?? null;
  const productId = data.productId;
  const quantityChange = Number(data.quantityChange || 0);

  const productResult = await client.query(
    `
    SELECT id, stock, cost_price
    FROM products
    WHERE id = $1
      AND ($2::bigint IS NULL OR tenant_id = $2::bigint)
    FOR UPDATE
    `,
    [productId, tenantId]
  );

  const product = productResult.rows[0] || null;
  if (!product) {
    const error = new Error(`Product not found for POS line ${getOrderItemLabel(data.item)}`);
    error.status = 400;
    throw error;
  }

  const quantityBefore = Number(product.stock || 0);
  const quantityAfter = quantityBefore + quantityChange;
  if (quantityAfter < 0) {
    const error = new Error(`Not enough stock for ${getOrderItemLabel(data.item)}`);
    error.status = 400;
    throw error;
  }

  await client.query(
    `
    UPDATE products
    SET stock = $1,
        updated_at = NOW()
    WHERE id = $2
      AND ($3::bigint IS NULL OR tenant_id = $3::bigint)
    `,
    [quantityAfter, productId, tenantId]
  );

  await recordInventoryMovement(client, {
    tenantId,
    productId,
    variantId: null,
    branchId: data.branchId ?? null,
    movementType: data.movementType ?? "sale",
    quantityBefore,
    quantityChange,
    quantityAfter,
    unitCost: product.cost_price || null,
    totalCost: Number(product.cost_price || 0) * Math.abs(quantityChange),
    referenceType: data.referenceType ?? null,
    referenceId: data.referenceId ?? null,
    reason: data.reason ?? "",
    notes: data.notes ?? "",
    createdBy: data.createdBy ?? null,
  });

  return { ...product, stock: quantityAfter };
};

const resolveOrderLineStock = async (client, { tenantId, item }) => {
  const productId = item.product_id || item.productId ? Number(item.product_id || item.productId) : null;
  const variantId = isRealId(item.variant_id ?? item.variantId) ? Number(item.variant_id ?? item.variantId) : null;
  const variationMode = normalizeVariationMode(item.variation_mode || item.variationMode);

  if (variantId) {
    const variantResult = await client.query(
      `
      SELECT
        pv.*,
        p.category_id,
        p.variation_mode,
        p.name AS product_name
      FROM product_variants pv
      JOIN products p ON p.id = pv.product_id
      WHERE pv.id = $1
        AND ($2::bigint IS NULL OR pv.tenant_id = $2::bigint OR pv.tenant_id IS NULL)
      `,
      [variantId, tenantId]
    );

    const variant = variantResult.rows[0] || null;
    if (!variant) {
      const error = new Error("Variant not found");
      error.status = 400;
      throw error;
    }

    if (productId && String(variant.product_id) !== String(productId)) {
      const error = new Error(
        `Variant ${variantId} was not found for product ${productId}. Check product_variants mapping.`
      );
      error.status = 400;
      throw error;
    }

    return {
      type: "variant",
      productId: variant.product_id,
      variantId: variant.id,
      categoryId: variant.category_id || null,
      costPrice: Number(variant.cost_price || 0),
      stock: Number(variant.stock || 0),
      record: variant,
    };
  }

  const productResult = await client.query(
    `
    SELECT id, category_id, variation_mode, stock, cost_price, name
    FROM products
    WHERE id = $1
      AND ($2::bigint IS NULL OR tenant_id = $2::bigint)
    `,
    [productId, tenantId]
  );

  const product = productResult.rows[0] || null;
  if (!product) {
    const error = new Error(`Product not found for ${getOrderItemLabel(item)} (product_id=${productId || "n/a"})`);
    error.status = 400;
    throw error;
  }

  const productMode = normalizeVariationMode(product.variation_mode || variationMode);
  if (isFullVariationMode(productMode)) {
    const error = new Error(
      `Variant is required for full variation product ${getOrderItemLabel(item)} (product_id=${product.id})`
    );
    error.status = 400;
    throw error;
  }

  const defaultVariantResult = await client.query(
    `
    SELECT
      pv.*,
      p.category_id,
      p.variation_mode,
      p.name AS product_name
    FROM product_variants pv
    JOIN products p ON p.id = pv.product_id
    WHERE pv.product_id = $1
      AND ($2::bigint IS NULL OR pv.tenant_id = $2::bigint OR pv.tenant_id IS NULL)
    ORDER BY pv.id ASC
    LIMIT 1
    `,
    [product.id, tenantId]
  );

  const defaultVariant = defaultVariantResult.rows[0] || null;
  if (defaultVariant) {
    return {
      type: "variant",
      productId: defaultVariant.product_id,
      variantId: defaultVariant.id,
      categoryId: defaultVariant.category_id || null,
      costPrice: Number(defaultVariant.cost_price || 0),
      stock: Number(defaultVariant.stock || 0),
      record: defaultVariant,
    };
  }

  return {
    type: "product",
    productId: product.id,
    variantId: null,
    categoryId: product.category_id || null,
    costPrice: Number(product.cost_price || 0),
    stock: Number(product.stock || 0),
    record: product,
  };
};

const runPostOrderSideEffects = async ({
  tenantId,
  orderId,
  resolvedMarketingSessionId,
  resolvedMarketingSource,
  resolvedMarketingPlatform,
  resolvedMarketingPostId,
  resolvedMarketingCampaign,
  resolvedMarketingTrackingCode,
  resolvedAttributionType,
  channel,
  payment_method,
  computedTotal,
  cogsTotal,
  resolvedBranchId,
  notes,
  req,
}) => {
  const sideEffects = [
    async () => {
      const attributionBase = {
        tenantId,
        sessionId: resolvedMarketingSessionId,
        source: resolvedMarketingSource,
        platform: resolvedMarketingPlatform,
        postId: resolvedMarketingPostId,
        campaign: resolvedMarketingCampaign,
        orderId,
        trackingCode: resolvedMarketingTrackingCode,
        attributionType: resolvedAttributionType,
        referrer: req.headers?.referer || req.headers?.referrer || null,
        userAgent: req.headers?.["user-agent"] || null,
        ipAddress: req.ip || req.socket?.remoteAddress || null,
        metadata: {
          channel: channel || "pos",
          payment_method: payment_method || "cash",
        },
      };
      await logAttributionEvent({
        ...attributionBase,
        eventType: "checkout",
      });
      await logAttributionEvent({
        ...attributionBase,
        eventType: "order_created",
      });
    },
    async () => {
      await logActivity(db, req.user?.id || null, "CREATE_ORDER", "ORDER", orderId);
    },
    async () => {
      await postSaleEntry(db, {
        tenantId,
        referenceType: "order",
        referenceId: orderId,
        description: `POS sale #${orderId}`,
        saleAmount: computedTotal,
        cogsAmount: cogsTotal,
        createdBy: req.user?.id || null,
        branchId: resolvedBranchId,
        notes: notes || "",
      });
    },
  ];

  for (const effect of sideEffects) {
    try {
      await effect();
    } catch (error) {
      console.error("[pos] post-order side effect failed", {
        order_id: orderId,
        message: error?.message,
        stack: error?.stack,
      });
    }
  }
};

export const createOrder = async (req, res) => {
  let client = null;
  let transactionStarted = false;
  let orderCreateStep = "start";
  const markOrderStep = (step, details = {}) => {
    orderCreateStep = step;
    console.log("[POS_CREATE_ORDER_STEP]", { step, ...details });
  };

  try {
    client = await db.connect();
    markOrderStep("db connected");
    await ensureAccountingSchema();
    const tenantId = isSuperAdminUser(req.user) ? null : getTenantId(req, req.user?.tenant_id);
    const normalizedPayload = normalizeCreateOrderPayload(req.body || {});
    const {
      customer_name,
      customer_id,
      payment_method,
      invoice_number,
      items,
      status,
      payment_status,
      channel,
      subtotal,
      discount_amount,
      tax_amount = 0,
      tax_rate = 0,
      service_fee,
      paid_amount,
      change_amount,
      notes,
      loyalty_points_redeemed = 0,
      loyalty_discount_amount = 0,
      wallet_amount = 0,
      wallet_payment_amount = null,
      cash_amount = 0,
      card_amount = 0,
      skip_loyalty_earning = false,
      full_wallet_redemption_only = false,
      cashier_id = null,
      sales_employee_id = null,
      salesperson_id = null,
      shift_id = null,
      attendance_log_id = null,
      marketing_source = null,
      marketing_platform = null,
      marketing_post_id = null,
      marketing_campaign = null,
      attribution_type = null,
      marketing_tracking_code = null,
      marketing_session_id = null,
      coupon_code = null,
      coupon_discount_amount = 0,
      customer_phone = "",
      customer_email = "",
      branch_id = null,
    } = normalizedPayload;
    const itemsCount = Array.isArray(items) ? items.length : 0;

    console.log("[POS_CREATE_ORDER_PAYLOAD]", safeOrderLogPayload(normalizedPayload));

    const resolvedCustomerName = String(customer_name || "").trim() || "Walk-in Customer";

    if (!items || itemsCount === 0) {
      return res.status(400).json({ success: false, message: "Order must have at least one item" });
    }

    for (const [index, item] of items.entries()) {
      if (!item.product_id && !item.variant_id) {
        return res.status(400).json({ success: false, message: "Every item must include product_id or variant_id", detail: `Invalid item at index ${index}` });
      }
      if (Number(item.quantity || 0) <= 0) {
        return res.status(400).json({ success: false, message: "Every item quantity must be greater than 0", detail: `Invalid quantity at index ${index}` });
      }
      if (Number(item.price || 0) < 0) {
        return res.status(400).json({ success: false, message: "Every item price must be 0 or greater", detail: `Invalid price at index ${index}` });
      }
    }

    let totalPrice = 0;
    let cogsTotal = 0;
    const normalizedTaxAmount = toFiniteNumber(tax_amount, 0);
    const normalizedTaxRate = toFiniteNumber(tax_rate, 0);
    const orderItemsForCommission = [];
    const stockByLineKey = new Map();
    const resolvedCashierId = cashier_id || req.user?.id || null;
    const requestedSalespersonId = salesperson_id || sales_employee_id || null;
    const resolvedSalesEmployeeId = requestedSalespersonId || null;
    const resolvedShiftId = shift_id || null;

    markOrderStep("ensure schemas", { tenantId });
    await ensureAttendanceSchema();
    await ensurePosShiftOrderColumns(client, tenantId);
    await ensureLoyaltySchema(db);
    await ensureWalletSchema(client);

    await client.query("BEGIN");
    transactionStarted = true;
    markOrderStep("transaction started");
    await client.query("SET LOCAL lock_timeout = '5000ms'");
    await client.query("SET LOCAL statement_timeout = '20000ms'");

    markOrderStep("load sales settings");
    const settings = await getSalesSettings(client, tenantId);
    const salespersonSnapshot = await getSalespersonSnapshot(client, {
      tenantId,
      salespersonId: requestedSalespersonId,
    });

    if (!settings.allow_sale_without_salesperson && !salespersonSnapshot) {
      await client.query("ROLLBACK");
      transactionStarted = false;
      return res.status(400).json({
        success: false,
        message: "Select a salesperson before checkout",
      });
    }

    markOrderStep("resolve POS shift", { cashier_id: resolvedCashierId, attendance_log_id });
    const openShift = await resolveOpenPosShift(client, {
      tenantId,
      employeeId: resolvedCashierId,
      attendanceLogId: attendance_log_id,
    });

    if (!openShift) {
      await client.query("ROLLBACK");
      transactionStarted = false;
      return res.status(400).json({
        success: false,
        message: "Open a POS shift before checkout",
      });
    }

    if (!openShift.branch_id && !branch_id) {
      await client.query("ROLLBACK");
      transactionStarted = false;
      return res.status(400).json({
        success: false,
        message: "Selected employee has no branch assigned",
      });
    }

    const resolvedBranchId = openShift.branch_id || branch_id || null;
    const resolvedAttendanceLogId = openShift.attendance_log_id;
    const linkedCustomer = await resolveOrCreateCustomerAccount(client, {
      tenantId,
      customerId: customer_id || null,
      name: resolvedCustomerName,
      phone: customer_phone || "",
      email: customer_email || "",
    });
    const resolvedCustomerId = linkedCustomer?.id || null;
    const resolvedCustomerPhone = linkedCustomer?.phone || customer_phone || "";

    markOrderStep("validate stock", { itemsCount });
    for (const [index, item] of items.entries()) {
      try {
        const stockLine = await resolveOrderLineStock(client, { tenantId, item });
        stockByLineKey.set(String(index), stockLine);
        if (stockLine.stock < item.quantity) {
          await client.query("ROLLBACK");
          transactionStarted = false;
          return res.status(400).json({ message: `Not enough stock for ${getOrderItemLabel(item)}` });
        }
      } catch (error) {
        await client.query("ROLLBACK");
        transactionStarted = false;
        return res.status(error.status || 400).json({
          success: false,
          message: error.message || "Invalid order item",
          item: {
            name: getOrderItemLabel(item),
            product_id: item.product_id || null,
            variant_id: item.variant_id || null,
            variation_mode: item.variation_mode || null,
          },
        });
      }

      totalPrice += Number(item.price) * Number(item.quantity);
    }

    const computedSubtotal = Number.isFinite(Number(subtotal)) ? Number(subtotal) : totalPrice;
    const nonCouponDiscount = Number(discount_amount || 0) + Number(loyalty_discount_amount || 0);
    const totalTax = normalizedTaxAmount;
    const totalServiceFee = Number(service_fee || 0);
    const couponBaseTotal = Math.max(0, computedSubtotal - nonCouponDiscount + totalServiceFee);
    let couponValidation = null;
    const safeCouponCode = String(coupon_code || "").trim().toUpperCase();
    if (safeCouponCode) {
      couponValidation = await validateCoupon({
        tenantId,
        code: safeCouponCode,
        orderTotal: couponBaseTotal,
        source: channel === "website" ? "website" : "pos",
        customerId: resolvedCustomerId,
        client,
        lock: true,
      });
      if (!couponValidation.valid) {
        await client.query("ROLLBACK");
        transactionStarted = false;
        return res.status(400).json({
          success: false,
          message: couponValidation.reason || "Coupon is invalid",
          coupon: couponValidation,
        });
      }
    }
    const couponDiscountAmount = safeCouponCode
      ? Number(couponValidation?.discount_amount || 0)
      : Math.max(0, Number(coupon_discount_amount || 0));
    const totalDiscount = nonCouponDiscount + couponDiscountAmount;
    const computedTotal = Math.max(0, computedSubtotal - totalDiscount + totalServiceFee);
    const receivedAmount = Number.isFinite(Number(paid_amount)) && Number(paid_amount) > 0 ? Number(paid_amount) : computedTotal;
    const publicToken = generatePublicToken();
    const detectedAttribution = detectMarketingAttribution(req);
    const resolvedMarketingSource = marketing_source || detectedAttribution.marketing_source || null;
    const resolvedMarketingPlatform = marketing_platform || detectedAttribution.marketing_platform || null;
    const resolvedMarketingPostId = marketing_post_id || detectedAttribution.marketing_post_id || null;
    const resolvedMarketingCampaign = marketing_campaign || detectedAttribution.marketing_campaign || null;
    const resolvedAttributionType = attribution_type || detectedAttribution.attribution_type || null;
    const resolvedMarketingTrackingCode = marketing_tracking_code || detectedAttribution.marketing_tracking_code || null;
    const resolvedMarketingSessionId = marketing_session_id || detectedAttribution.session_id || null;

    markOrderStep("insert order", {
      customer_id: customer_id || null,
      itemsCount,
      payment_method: payment_method || "cash",
      payment_status: payment_status || "unpaid",
      totals: { subtotal: computedSubtotal, discount_amount: totalDiscount, tax_amount: totalTax, service_fee: totalServiceFee, total: computedTotal },
    });
    const orderResult = await client.query(
      `
      INSERT INTO orders (
        tenant_id,
        invoice_number,
        public_token,
        invoice_public_enabled,
          customer_id,
          customer_name,
          customer_phone,
          channel,
        branch_id,
        payment_method,
        cash_amount,
        card_amount,
        wallet_payment_amount,
        cashier_id,
        sales_employee_id,
        salesperson_id,
        salesperson_name,
        salesperson_commission_type,
        salesperson_commission_value,
        salesperson_fixed_mode,
        salesperson_excluded_product_ids,
        shift_id,
        attendance_log_id,
        marketing_source,
        marketing_platform,
        marketing_post_id,
        marketing_campaign,
        attribution_type,
        marketing_tracking_code,
        marketing_session_id,
        status,
        payment_status,
        subtotal,
        discount_amount,
        tax_amount,
        service_fee,
        total_amount,
        total_price,
        total,
        coupon_id,
        coupon_code,
        coupon_discount_amount,
        paid_amount,
        change_amount,
        notes
      )
      VALUES (
        $1,
        COALESCE($2, 'INV-' || EXTRACT(EPOCH FROM NOW())::BIGINT || '-' || FLOOR(RANDOM()*1000)::INT),
        $3,
        COALESCE($4, TRUE),
        $5,
        $6,
        $7,
        COALESCE($8, 'pos'),
        $9,
        COALESCE($10, 'cash'),
        COALESCE($11::numeric, 0),
        COALESCE($12::numeric, 0),
        COALESCE($13::numeric, 0),
        $14,
        $15,
        $16,
        $17,
        $18,
        $19,
        COALESCE($20::numeric, 0),
        $21,
        COALESCE($22::jsonb, '[]'::jsonb),
        $23,
        $24,
        $25,
        $26,
        $27,
        $28,
        $29,
        $30,
        COALESCE($31, 'Pending'),
        COALESCE($32, 'unpaid'),
        COALESCE($33::numeric, 0),
        COALESCE($34::numeric, 0),
        COALESCE($35::numeric, 0),
        COALESCE($36::numeric, 0),
        $37,
        $38,
        $39,
        $40,
        $41,
        $42,
        COALESCE($43::numeric, 0),
        $44,
        COALESCE($45::numeric, 0),
        $46
      )
      RETURNING *
      `,
      [
        tenantId,
        invoice_number || null,
        publicToken,
        true,
        resolvedCustomerId,
        resolvedCustomerName,
        resolvedCustomerPhone,
        channel || "pos",
        resolvedBranchId,
        payment_method || "cash",
        cash_amount || (payment_method === "cash" ? receivedAmount : 0),
        card_amount || (payment_method === "card" ? receivedAmount : 0),
        wallet_payment_amount ?? (payment_method === "wallet" ? receivedAmount : 0),
        resolvedCashierId,
        resolvedSalesEmployeeId,
        salespersonSnapshot?.salesperson_id || null,
        salespersonSnapshot?.salesperson_name || null,
        salespersonSnapshot?.commission_type || null,
        salespersonSnapshot?.commission_value || 0,
        salespersonSnapshot?.fixed_mode || settings.fixed_commission_mode,
        JSON.stringify(salespersonSnapshot?.excluded_product_ids || []),
        resolvedShiftId,
        resolvedAttendanceLogId,
        resolvedMarketingSource,
        resolvedMarketingPlatform,
        resolvedMarketingPostId,
        resolvedMarketingCampaign,
        resolvedAttributionType,
        resolvedMarketingTrackingCode,
        resolvedMarketingSessionId,
        status || "Pending",
        payment_status || "unpaid",
        computedSubtotal,
        totalDiscount,
        totalTax,
        totalServiceFee,
        computedTotal,
        computedTotal,
        computedTotal,
        couponValidation?.coupon?.id || null,
        safeCouponCode || null,
        couponDiscountAmount,
        receivedAmount,
        change_amount || Math.max(0, receivedAmount - computedTotal),
        notes || "",
      ]
    );

    const order = orderResult.rows[0];
    order.public_token = order.public_token || publicToken;
    const publicInvoiceUrl = buildPublicInvoiceUrl(req, order.public_token);
    const publicInvoiceShortUrl = publicInvoiceUrl;
    order.public_invoice_url = publicInvoiceUrl;
    order.public_invoice_short_url = publicInvoiceShortUrl;
    order.invoice_public_url = publicInvoiceUrl;
    let employeeTracking = null;
    let loyaltyResult = null;
    console.log("[checkout order]", order.id);
    console.log("[public token]", order.public_token);
    console.log("[public invoice url]", publicInvoiceUrl);

    markOrderStep("insert order items", { order_id: order.id, itemsCount });
    for (const [index, item] of items.entries()) {
      const stockLine = stockByLineKey.get(String(index)) || {};
      const orderItemResult = await client.query(
        `
        INSERT INTO order_items (
          tenant_id,
          order_id,
          variant_id,
          product_id,
          product_name,
          variant_name,
          sku,
          barcode,
          quantity,
          sale_price,
          discount_amount,
          tax_amount,
          total_amount
        )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      RETURNING *
        `,
        [
          tenantId,
          order.id,
          stockLine.variantId || null,
          stockLine.productId || item.product_id || null,
          item.product_name || "",
          item.variant_name || "",
          item.sku || "",
          item.barcode || "",
          item.quantity,
          item.price,
          item.discount_amount || 0,
          0,
          item.total_amount || Number(item.price) * Number(item.quantity),
        ]
      );

      const orderItemRow = orderItemResult.rows[0] || {};
      orderItemsForCommission.push({
        ...item,
        id: orderItemRow.id,
        order_item_id: orderItemRow.id,
        product_id: item.product_id || stockLine.productId || null,
        category_id: item.category_id || stockLine.categoryId || null,
        total_amount: item.total_amount || Number(item.price) * Number(item.quantity),
      });

      cogsTotal += Number(stockLine.costPrice || 0) * Number(item.quantity || 0);

      markOrderStep("reduce stock", { order_id: order.id, line: index, stock_type: stockLine.type, product_id: stockLine.productId || null, variant_id: stockLine.variantId || null });
      if (stockLine.type === "variant") {
        await adjustVariantStock(client, {
          tenantId,
          variantId: stockLine.variantId,
          quantityChange: Number(item.quantity || 0) * -1,
          movementType: "sale",
          referenceType: "order",
          referenceId: order.id,
          unitCost: stockLine.costPrice || null,
          totalCost: Number(stockLine.costPrice || 0) * Number(item.quantity || 0),
          reason: "POS sale",
          notes: `Sale from order ${order.id}`,
          createdBy: req.user?.id || null,
          branchId: resolvedBranchId,
        });
      } else {
        await adjustProductStock(client, {
          tenantId,
          productId: stockLine.productId,
          quantityChange: Number(item.quantity || 0) * -1,
          movementType: "sale",
          referenceType: "order",
          referenceId: order.id,
          reason: "POS sale",
          notes: `Sale from order ${order.id}`,
          createdBy: req.user?.id || null,
          branchId: resolvedBranchId,
          item,
        });
      }
    }

    let couponRedemption = null;
    if (safeCouponCode) {
      try {
        couponRedemption = await redeemCoupon({
          tenantId,
          code: safeCouponCode,
          orderId: order.id,
          customerId: resolvedCustomerId || order.customer_id || null,
          source: channel === "website" ? "website" : "pos",
          orderTotal: couponBaseTotal,
          client,
        });
        order.coupon_id = couponRedemption?.coupon?.id || order.coupon_id;
        order.coupon_code = safeCouponCode;
        order.coupon_discount_amount = Number(couponRedemption?.discount_amount || couponDiscountAmount || 0);
      } catch (couponError) {
        await client.query("ROLLBACK");
        transactionStarted = false;
        return res.status(couponError.status || 400).json({
          success: false,
          message: couponError.validation?.reason || couponError.message || "Unable to redeem coupon",
          coupon: couponError.validation,
        });
      }
    }

    markOrderStep("create payment transaction", { order_id: order.id, payment_method: payment_method || "cash", amount: receivedAmount });
    await client.query(
      `
      INSERT INTO transactions (tenant_id, type, amount, payment_method, note, cashbox_id)
      VALUES ($1,$2,$3,$4,$5,$6)
      `,
      [tenantId, "sale", receivedAmount, payment_method || "cash", `Order #${order.id}`, 1]
    );

    await client.query(
      `
      UPDATE cashbox
      SET balance = balance + $1
      WHERE id = 1
        AND ($2::bigint IS NULL OR tenant_id = $2::bigint)
      `,
      [receivedAmount, tenantId]
    );

    try {
      await recordSalesCommissionForOrder(client, {
        tenantId,
        order,
        items: orderItemsForCommission,
        createdBy: req.user?.id || null,
      });
    } catch (salesCommissionError) {
      console.error("[pos] salesperson commission failed", {
        order_id: order.id,
        message: salesCommissionError?.message,
        stack: salesCommissionError?.stack,
      });
    }

    try {
      employeeTracking = await recordEmployeeAnalytics(client, {
        tenantId,
        orderId: order.id,
        orderItems: orderItemsForCommission,
        cashierId: resolvedCashierId,
        salesEmployeeId: resolvedSalesEmployeeId,
        shiftId: resolvedShiftId,
        branchId: resolvedBranchId,
        paymentStatus: payment_status || "unpaid",
        userId: req.user?.id || null,
      });
    } catch (employeeTrackingError) {
      console.error("[pos] employee tracking failed", {
        order_id: order.id,
        message: employeeTrackingError?.message,
        stack: employeeTrackingError?.stack,
      });
      employeeTracking = { recorded: false, error: employeeTrackingError?.message || "Employee tracking failed" };
    }

    try {
      loyaltyResult = await processOrderLoyalty(client, {
        tenantId,
        orderId: order.id,
        customerId: resolvedCustomerId || order.customer_id,
        orderTotal: computedTotal,
        paidAmount: receivedAmount,
        status: status || "Pending",
        paymentStatus: payment_status || "unpaid",
        redeemPoints: loyalty_points_redeemed || 0,
        walletRedemptionAmount: wallet_amount || 0,
        skipEarning: Boolean(skip_loyalty_earning),
        fullWalletRedemptionOnly: Boolean(full_wallet_redemption_only),
        userId: req.user?.id || null,
      });
    } catch (loyaltyError) {
      console.error("[pos] loyalty processing failed", {
        order_id: order.id,
        message: loyaltyError?.message,
        stack: loyaltyError?.stack,
      });
      loyaltyResult = {
        earned: false,
        redeemed: false,
        pointsEarned: 0,
        pointsRedeemed: 0,
        availablePoints: 0,
        walletBalance: 0,
        cashbackAmount: 0,
        walletRedeemedAmount: 0,
        activities: [],
        error: loyaltyError?.message || "Loyalty processing failed",
      };
    }

    if (Number(wallet_amount || 0) > 0 && loyaltyResult?.error) {
      await client.query("ROLLBACK");
      transactionStarted = false;
      return res.status(400).json({
        success: false,
        message: loyaltyResult.error || "Unable to apply wallet payment",
      });
    }

    if (Number(loyaltyResult?.walletRedeemedAmount || 0) > 0) {
      try {
        await postWalletLiabilityEntry(client, {
          tenantId,
          amount: Number(loyaltyResult.walletRedeemedAmount || 0),
          direction: "debit",
          referenceType: "order",
          referenceId: order.id,
          description: "Wallet balance used on POS order",
          createdBy: req.user?.id || null,
          branchId: resolvedBranchId,
          notes: `Order #${order.invoice_number || order.id}`,
        });
      } catch (walletAccountingError) {
        console.error("[orders] wallet payment accounting fallback", walletAccountingError.message);
      }
    }

    if (Number(loyalty_points_redeemed || 0) > 0 && !loyaltyResult?.redeemed) {
      await client.query("ROLLBACK");
      transactionStarted = false;
      return res.status(400).json({
        success: false,
        message: loyaltyResult?.reason === "over_redemption"
          ? "Requested loyalty points exceed available balance"
          : "Unable to apply loyalty redemption",
      });
    }

    await client.query("COMMIT");
    transactionStarted = false;

    const sideEffectContext = {
      tenantId,
      orderId: order.id,
      resolvedMarketingSessionId,
      resolvedMarketingSource,
      resolvedMarketingPlatform,
      resolvedMarketingPostId,
      resolvedMarketingCampaign,
      resolvedMarketingTrackingCode,
      resolvedAttributionType,
      channel,
      payment_method,
      computedTotal,
      cogsTotal,
      resolvedBranchId,
      notes,
      req,
    };
    void runPostOrderSideEffects(sideEffectContext).catch((sideEffectError) => {
      console.error("[pos] post-order side effects failed", {
        order_id: order.id,
        message: sideEffectError?.message,
        stack: sideEffectError?.stack,
      });
    });

    const discountRatio = computedSubtotal > 0 ? Number(totalDiscount || 0) / computedSubtotal : 0;
    if (discountRatio >= 0.3) {
      createSystemNotification("security_sensitive_action", {
        tenant_id: tenantId,
        branch_id: resolvedBranchId,
        message: `خصم كبير على الطلب ${order.invoice_number || order.id}: ${Math.round(discountRatio * 100)}%`,
        action_url: `/orders/${order.id}`,
        entity_type: "order",
        entity_id: order.id,
        metadata: { order_id: order.id, discount_amount: totalDiscount, subtotal: computedSubtotal },
      }).catch((error) => console.warn("[notifications] security skipped", error?.message || error));
    }

    try {
      io.emit("new_order", order);
      io.emit("dashboard:activity", {
        type: "order",
        title: order.invoice_number || `Order #${order.id}`,
        invoice_number: order.invoice_number,
        amount: Number(order.total_amount || order.total || 0),
        status: order.payment_status || order.status || "created",
        created_at: order.created_at || new Date().toISOString(),
      });
      io.emit("refresh_dashboard");
    } catch (socketError) {
      console.error("[pos] socket emit failed", {
        order_id: order.id,
        message: socketError?.message,
      });
    }

    return res.status(201).json({
      success: true,
      message: "Order created successfully",
      order,
      order_id: order.id,
      invoice_number: order.invoice_number,
      tax_amount: normalizedTaxAmount,
      tax_rate: normalizedTaxRate,
      public_token: order.public_token,
      public_invoice_url: publicInvoiceUrl,
      public_invoice_short_url: publicInvoiceShortUrl,
      invoice_public_url: publicInvoiceUrl,
      short_invoice_url: publicInvoiceShortUrl,
      marketing_source: order.marketing_source || null,
      marketing_platform: order.marketing_platform || null,
      marketing_post_id: order.marketing_post_id || null,
      marketing_campaign: order.marketing_campaign || null,
      attribution_type: order.attribution_type || null,
      loyalty: loyaltyResult,
      coupon: couponRedemption,
      wallet: {
        cashbackAmount: Number(loyaltyResult?.cashbackAmount || 0),
        redeemedAmount: Number(loyaltyResult?.walletRedeemedAmount || 0),
        balance: Number(loyaltyResult?.walletBalance || 0),
      },
      activity: Array.isArray(loyaltyResult?.activities) ? loyaltyResult.activities : [],
      employeeTracking,
    });
  } catch (error) {
    if (transactionStarted) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error("Create Order Rollback Error:", rollbackError);
      }
    }
    console.error("[POS_CREATE_ORDER_CRASH]", {
      step: orderCreateStep,
      code: error?.code,
      message: error?.message,
      detail: error?.detail,
      constraint: error?.constraint,
      table: error?.table,
      column: error?.column,
      stack: error?.stack,
    });
    return res.status(500).json({
      success: false,
      message: "Order creation failed",
      detail: process.env.NODE_ENV !== "production" ? `${orderCreateStep}: ${error.message}` : undefined,
      code: process.env.NODE_ENV !== "production" ? error.code : undefined,
    });
  } finally {
    if (client) {
      client.release();
    }
  }
};

export const getShiftReport = async (req, res) => {
  try {
    const tenantId = isSuperAdminUser(req.user) ? null : getTenantId(req, req.user?.tenant_id);
    const attendanceLogId = Number(req.params.attendanceLogId || req.query.attendanceLogId || 0);

    if (!attendanceLogId) {
      return res.status(400).json({
        success: false,
        message: "Attendance log is required",
      });
    }

    const result = await db.query(
      `
      WITH order_rollup AS (
        SELECT
          COALESCE(SUM(total_amount), 0) AS sales,
          COALESCE(SUM(cash_amount), 0) AS cash,
          COALESCE(SUM(card_amount), 0) AS card,
          COALESCE(SUM(wallet_payment_amount), 0) AS wallet,
          COUNT(*) AS invoices
        FROM orders
        WHERE attendance_log_id = $1
          AND ($2::bigint IS NULL OR tenant_id = $2::bigint)
      ),
      item_rollup AS (
        SELECT COALESCE(SUM(oi.quantity), 0) AS items
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        WHERE o.attendance_log_id = $1
          AND ($2::bigint IS NULL OR o.tenant_id = $2::bigint)
          AND ($2::bigint IS NULL OR oi.tenant_id = $2::bigint)
      )
      SELECT
        order_rollup.sales,
        order_rollup.cash,
        order_rollup.card,
        order_rollup.wallet,
        order_rollup.invoices,
        item_rollup.items
      FROM order_rollup, item_rollup
      `,
      [attendanceLogId, tenantId]
    );

    const row = result.rows[0] || {};
    const cash = Number(row.cash || 0);
    const card = Number(row.card || 0);
    const wallet = Number(row.wallet || 0);

    return res.status(200).json({
      success: true,
      report: {
        sales: Number(row.sales || 0),
        cash,
        card,
        wallet,
        invoices: Number(row.invoices || 0),
        items: Number(row.items || 0),
        expectedDrawer: cash,
        actualDrawer: null,
        difference: null,
      },
    });
  } catch (error) {
    console.log("Shift Report Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to calculate shift report",
      error: error.message,
    });
  }
};

export const getOrders = async (req, res) => {
  try {
    const tenantId = isSuperAdminUser(req.user) ? null : getTenantId(req, req.user?.tenant_id);
    await ensurePosShiftOrderColumns(db, tenantId);
    const result = await db.query(
      `
      SELECT *
      FROM orders
      ${tenantId === null ? "" : "WHERE tenant_id = $1"}
      ORDER BY created_at DESC
      `,
      tenantId === null ? [] : [tenantId]
    );

    res.status(200).json(result.rows);
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Server Error" });
  }
};

const BLOCKED_OPERATION_STATUSES = new Set(["cancelled", "canceled", "refunded"]);

const normalizeOrderStatus = (value = "") => String(value || "").trim().toLowerCase();

const assertOrderEditable = (order) => {
  if (!order || BLOCKED_OPERATION_STATUSES.has(normalizeOrderStatus(order.status))) {
    const error = new Error("لا يمكن تعديل أو تنفيذ عملية على فاتورة ملغاة أو مستردة");
    error.status = 400;
    throw error;
  }
};

const assertOrderReturnable = (order) => {
  const status = normalizeOrderStatus(order?.status || order?.payment_status);
  if (!order || ["cancelled", "canceled", "refunded", "returned"].includes(status)) {
    const error = new Error("لا يمكن إنشاء مرتجع لفاتورة ملغاة أو مرتجعة بالكامل");
    error.status = 400;
    throw error;
  }
};

const markCustomerTrustedForCompletedOrder = async (client, order = {}) => {
  const status = normalizeOrderStatus(order?.status);
  const shippingStatus = normalizeOrderStatus(order?.shipping_status);
  if (!["delivered", "completed"].includes(status) && !["delivered", "completed"].includes(shippingStatus)) return;
  if (order.customer_trust_counted_at) return;
  const customerId = order.customer_id || null;
  const phone = String(order.customer_phone || "").trim();
  if (!customerId && !phone) return;
  const params = [customerId, phone];
  await client.query(
    `
    UPDATE customers
    SET completed_orders = COALESCE(completed_orders, 0) + 1,
        cod_enabled = true,
        is_trusted = true,
        updated_at = NOW()
    WHERE (($1::bigint IS NOT NULL AND id = $1::bigint) OR ($2 <> '' AND phone = $2))
    `,
    params
  );
  if (order.id) {
    await client.query(`UPDATE orders SET customer_trust_counted_at = NOW() WHERE id = $1 AND customer_trust_counted_at IS NULL`, [order.id]);
  }
};

const getTableColumnSet = async (clientOrPool, tableName) => {
  const result = await clientOrPool.query(
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

const tableExists = async (clientOrPool, tableName) => {
  const result = await clientOrPool.query(
    `
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = current_schema()
      AND table_name = $1
    LIMIT 1
    `,
    [tableName]
  );
  return Boolean(result.rows[0]);
};

const firstExistingColumn = (columns, candidates = []) => candidates.find((column) => columns.has(column)) || null;

const normalizeOperationItem = (item = {}) => {
  const quantity = Math.max(0, Number(item.quantity || 0));
  const price = Number(item.price ?? item.sale_price ?? item.unit_price ?? 0);
  const discount = Number(item.discount_amount ?? item.discount ?? 0);
  return {
    product_id: item.product_id || item.productId || null,
    product_name: item.product_name || item.name || "",
    variant_id: isRealId(item.variant_id ?? item.variantId) ? item.variant_id ?? item.variantId : null,
    variant_name: item.variant_name || [item.color, item.size].filter(Boolean).join(" / "),
    variation_mode: item.variation_mode || item.variationMode || "full_variations",
    sku: item.sku || "",
    barcode: item.barcode || "",
    quantity,
    price,
    discount_amount: discount,
    tax_amount: Number(item.tax_amount || 0),
    total_amount: Math.max(0, Number(item.total_amount ?? price * quantity - discount)),
  };
};

const stockKeyForItem = (item = {}) =>
  item.variant_id ? `variant:${item.variant_id}` : `product:${item.product_id || ""}`;

const loadOrderWithItems = async (clientOrPool, { tenantId, orderId }) => {
  const orderResult = await clientOrPool.query(
    `
    SELECT o.*, u.name AS cashier_name, c.name AS customer_record_name, c.phone AS customer_record_phone
    FROM orders o
    LEFT JOIN users u ON u.id = COALESCE(o.cashier_id, o.created_by)
    LEFT JOIN customers c ON c.id = o.customer_id
    WHERE o.id = $1
      AND ($2::bigint IS NULL OR o.tenant_id = $2::bigint)
    LIMIT 1
    `,
    [orderId, tenantId]
  );
  const order = orderResult.rows[0] || null;
  if (!order) return null;

  const itemsResult = await clientOrPool.query(
    `
    SELECT
      oi.*,
      oi.sale_price AS price,
      pv.size,
      pv.color,
      pv.image_url,
      COALESCE(p.name, oi.product_name) AS product_name
    FROM order_items oi
    LEFT JOIN product_variants pv ON oi.variant_id = pv.id
    LEFT JOIN products p ON COALESCE(oi.product_id, pv.product_id) = p.id
    WHERE oi.order_id = $1
      AND ($2::bigint IS NULL OR oi.tenant_id = $2::bigint OR oi.tenant_id IS NULL)
    ORDER BY oi.id ASC
    `,
    [orderId, tenantId]
  );

  return {
    order: {
      ...order,
      customer_name: order.customer_name || order.customer_record_name || "",
      customer_phone: order.customer_phone || order.customer_record_phone || "",
    },
    items: itemsResult.rows,
  };
};

const applyStockDelta = async (client, { tenantId, order, stockLine, delta, movementType, reason, userId }) => {
  if (!stockLine || Number(delta || 0) === 0) return;
  if (stockLine.type === "variant") {
    await adjustVariantStock(client, {
      tenantId,
      variantId: stockLine.variantId,
      quantityChange: Number(delta),
      movementType,
      referenceType: "order",
      referenceId: order.id,
      unitCost: stockLine.costPrice || null,
      totalCost: Number(stockLine.costPrice || 0) * Math.abs(Number(delta)),
      reason,
      notes: `${reason} #${order.invoice_number || order.id}`,
      createdBy: userId || null,
      branchId: order.branch_id || null,
    });
    return;
  }

  await adjustProductStock(client, {
    tenantId,
    productId: stockLine.productId,
    quantityChange: Number(delta),
    movementType,
    referenceType: "order",
    referenceId: order.id,
    reason,
    notes: `${reason} #${order.invoice_number || order.id}`,
    createdBy: userId || null,
    branchId: order.branch_id || null,
    item: stockLine.record || {},
  });
};

export const getRecentPosOrders = async (req, res) => {
  try {
    const tenantId = isSuperAdminUser(req.user) ? null : getTenantId(req, req.user?.tenant_id);
    await ensurePosShiftOrderColumns(db, tenantId);
    const limit = Math.min(Math.max(Number(req.query.limit || 20), 1), 100);

    const [
      orderColumns,
      itemColumns,
      hasUsersTable,
      hasCustomersTable,
      hasProductVariantsTable,
    ] = await Promise.all([
      getTableColumnSet(db, "orders"),
      getTableColumnSet(db, "order_items"),
      tableExists(db, "users"),
      tableExists(db, "customers"),
      tableExists(db, "product_variants"),
    ]);
    const userColumns = hasUsersTable ? await getTableColumnSet(db, "users") : new Set();
    const customerColumns = hasCustomersTable ? await getTableColumnSet(db, "customers") : new Set();

    const invoiceExpr = orderColumns.has("invoice_number") ? "o.invoice_number" : "'INV-' || o.id::text";
    const customerNameExpr = orderColumns.has("customer_name") ? "o.customer_name" : "''";
    const customerPhoneExpr = orderColumns.has("customer_phone") ? "o.customer_phone" : "''";
    const totalExpr = orderColumns.has("total_amount")
      ? "o.total_amount"
      : orderColumns.has("total")
        ? "o.total"
        : orderColumns.has("total_price")
          ? "o.total_price"
          : "0";
    const paymentExpr = orderColumns.has("payment_method") ? "o.payment_method" : "''";
    const paymentStatusExpr = orderColumns.has("payment_status") ? "o.payment_status" : "''";
    const statusExpr = orderColumns.has("status") ? "o.status" : orderColumns.has("payment_status") ? "o.payment_status" : "''";
    const createdExpr = orderColumns.has("created_at") ? "o.created_at" : "NOW()";
    const updatedExpr = orderColumns.has("updated_at") ? "o.updated_at" : createdExpr;
    const cancelledExpr = orderColumns.has("cancelled_at") ? "o.cancelled_at" : "NULL";
    const returnedExpr = orderColumns.has("returned_at") ? "o.returned_at" : "NULL";
    const tenantClause = orderColumns.has("tenant_id") ? "AND ($1::bigint IS NULL OR o.tenant_id = $1::bigint)" : "";
    const posColumn = firstExistingColumn(orderColumns, ["channel", "source", "order_source", "type"]);
    const posClause = posColumn ? `AND COALESCE(o.${posColumn}, 'pos') = 'pos'` : "";

    const cashierNameColumn = firstExistingColumn(userColumns, ["name", "full_name", "username", "email"]);
    const cashierJoinColumn = firstExistingColumn(orderColumns, ["cashier_id", "created_by", "user_id", "seller_id"]);
    const cashierJoin = hasUsersTable && cashierNameColumn && cashierJoinColumn ? `LEFT JOIN users u ON u.id = o.${cashierJoinColumn}` : "";
    const cashierExpr = cashierJoin ? `COALESCE(u.${cashierNameColumn}, '')` : "''";

    const customerNameColumn = firstExistingColumn(customerColumns, ["name", "full_name", "customer_name"]);
    const customerPhoneColumn = firstExistingColumn(customerColumns, ["phone", "mobile", "customer_phone"]);
    const customerJoin = hasCustomersTable && orderColumns.has("customer_id") && (customerNameColumn || customerPhoneColumn)
      ? "LEFT JOIN customers c ON c.id = o.customer_id"
      : "";
    const customerRecordNameExpr = customerJoin && customerNameColumn ? `COALESCE(c.${customerNameColumn}, '')` : "''";
    const customerRecordPhoneExpr = customerJoin && customerPhoneColumn ? `COALESCE(c.${customerPhoneColumn}, '')` : "''";

    const result = await db.query(
      `
      SELECT
        o.id,
        ${invoiceExpr} AS invoice_number,
        COALESCE(${customerNameExpr}, ${customerRecordNameExpr}, '') AS customer_name,
        COALESCE(${customerPhoneExpr}, ${customerRecordPhoneExpr}, '') AS customer_phone,
        COALESCE(${totalExpr}, 0) AS total_amount,
        COALESCE(${paymentExpr}, '') AS payment_method,
        COALESCE(${paymentStatusExpr}, '') AS payment_status,
        COALESCE(${statusExpr}, '') AS status,
        ${createdExpr} AS created_at,
        ${updatedExpr} AS updated_at,
        ${cancelledExpr} AS cancelled_at,
        ${returnedExpr} AS returned_at,
        ${cashierExpr} AS cashier_name
      FROM orders o
      ${cashierJoin}
      ${customerJoin}
      WHERE 1 = 1
        ${posClause}
        ${tenantClause}
      ORDER BY ${createdExpr} DESC, o.id DESC
      LIMIT $2
      `,
      [tenantId, limit]
    );

    const orderIds = result.rows.map((row) => row.id);
    const canLoadItems = orderIds.length && itemColumns.has("order_id");
    const itemTenantClause = itemColumns.has("tenant_id") ? "AND ($2::bigint IS NULL OR oi.tenant_id = $2::bigint OR oi.tenant_id IS NULL)" : "";
    const itemProductExpr = itemColumns.has("product_name") ? "oi.product_name" : "''";
    const itemVariantExpr = itemColumns.has("variant_name") ? "oi.variant_name" : "''";
    const itemSkuExpr = itemColumns.has("sku") ? "oi.sku" : "''";
    const itemBarcodeExpr = itemColumns.has("barcode") ? "oi.barcode" : "''";
    const itemQtyExpr = itemColumns.has("quantity") ? "oi.quantity" : "0";
    const itemPriceExpr = itemColumns.has("sale_price") ? "oi.sale_price" : itemColumns.has("price") ? "oi.price" : "0";
    const itemDiscountExpr = itemColumns.has("discount_amount") ? "oi.discount_amount" : "0";
    const itemTotalExpr = itemColumns.has("total_amount") ? "oi.total_amount" : `(${itemPriceExpr} * ${itemQtyExpr})`;
    const variantJoin = hasProductVariantsTable && itemColumns.has("variant_id")
      ? "LEFT JOIN product_variants pv ON pv.id = oi.variant_id"
      : "";
    const itemColorExpr = variantJoin ? "COALESCE(pv.color, '')" : "''";
    const itemSizeExpr = variantJoin ? "COALESCE(pv.size, '')" : "''";
    const itemImageExpr = variantJoin ? "COALESCE(pv.image_url, '')" : "''";

    const itemsResult = canLoadItems
      ? await db.query(
        `
        SELECT
          oi.id,
          oi.order_id,
          ${itemColumns.has("product_id") ? "oi.product_id" : "NULL"} AS product_id,
          ${itemColumns.has("variant_id") ? "oi.variant_id" : "NULL"} AS variant_id,
          ${itemProductExpr} AS product_name,
          ${itemVariantExpr} AS variant_name,
          ${itemSkuExpr} AS sku,
          ${itemBarcodeExpr} AS barcode,
          ${itemQtyExpr} AS quantity,
          ${itemPriceExpr} AS price,
          ${itemPriceExpr} AS sale_price,
          ${itemDiscountExpr} AS discount_amount,
          ${itemTotalExpr} AS total_amount,
          ${itemColorExpr} AS color,
          ${itemSizeExpr} AS size,
          ${itemImageExpr} AS image_url
        FROM order_items oi
        ${variantJoin}
        WHERE oi.order_id = ANY($1::bigint[])
          ${itemTenantClause}
        ORDER BY oi.id ASC
        `,
        [orderIds, tenantId]
      )
      : { rows: [] };

    const itemsByOrder = new Map();
    itemsResult.rows.forEach((item) => {
      const key = String(item.order_id);
      itemsByOrder.set(key, [...(itemsByOrder.get(key) || []), item]);
    });

    const orders = result.rows.map((order) => ({
      id: order.id,
      invoice_number: order.invoice_number || `INV-${String(order.id).padStart(6, "0")}`,
      customer_name: order.customer_name || "",
      customer_phone: order.customer_phone || "",
      total_amount: Number(order.total_amount || 0),
      payment_method: order.payment_method || "",
      payment_status: order.payment_status || "",
      status: order.status || "",
      created_at: order.created_at,
      updated_at: order.updated_at,
      cancelled_at: order.cancelled_at,
      returned_at: order.returned_at,
      cashier_name: order.cashier_name || "",
      items: itemsByOrder.get(String(order.id)) || [],
    }));

    return res.status(200).json({ success: true, data: orders, orders });
  } catch (error) {
    console.error("[orders] recent POS orders error", error);
    return res.status(500).json({ success: false, message: "Failed to load recent POS orders", error: error.message });
  }
};

export const logOrderReprint = async (req, res) => {
  try {
    const tenantId = isSuperAdminUser(req.user) ? null : getTenantId(req, req.user?.tenant_id);
    await ensurePosShiftOrderColumns(db, tenantId);
    const loaded = await loadOrderWithItems(db, { tenantId, orderId: req.params.id });
    if (!loaded) return res.status(404).json({ success: false, message: "Order not found" });
    await db.query(
      `
      INSERT INTO order_reprint_logs (tenant_id, order_id, user_id)
      VALUES ($1,$2,$3)
      `,
      [tenantId, req.params.id, req.user?.id || null]
    );
    return res.status(201).json({ success: true, message: "Reprint logged" });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to log reprint", error: error.message });
  }
};

export const confirmShippingPayment = async (req, res) => {
  const client = await db.connect();
  try {
    const tenantId = isSuperAdminUser(req.user) ? null : getTenantId(req, req.user?.tenant_id);
    await ensurePosShiftOrderColumns(client, tenantId);
    await client.query("BEGIN");
    const existing = await client.query(
      `
      SELECT *
      FROM orders
      WHERE id = $1
        AND ($2::bigint IS NULL OR tenant_id = $2::bigint OR tenant_id IS NULL)
      LIMIT 1
      `,
      [req.params.id, tenantId]
    );
    const currentOrder = existing.rows[0];
    if (!currentOrder) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, message: "Order not found" });
    }
    if (!currentOrder.shipping_payment_screenshot || String(currentOrder.shipping_payment_screenshot || "").startsWith("data:image") || String(currentOrder.shipping_payment_screenshot || "").startsWith("blob:")) {
      await client.query("ROLLBACK");
      return res.status(400).json({ success: false, message: "صورة إثبات التحويل غير صالحة" });
    }
    const result = await client.query(
      `
      UPDATE orders
      SET payment_status = 'paid',
          status = 'confirmed',
          paid_amount = GREATEST(COALESCE(total_amount, total, total_price, 0), COALESCE(paid_amount, 0)),
          shipping_payment_verified_at = NOW(),
          shipping_payment_verified_by = $2,
          updated_at = NOW()
      WHERE id = $1
        AND ($3::bigint IS NULL OR tenant_id = $3::bigint OR tenant_id IS NULL)
      RETURNING *
      `,
      [req.params.id, req.user?.id || null, tenantId]
    );
    await processOrderLoyalty(client, {
      tenantId,
      orderId: result.rows[0].id,
      customerId: result.rows[0].customer_id,
      orderTotal: result.rows[0].total_amount || result.rows[0].total || result.rows[0].total_price || 0,
      paidAmount: result.rows[0].paid_amount || result.rows[0].total_amount || result.rows[0].total || 0,
      status: result.rows[0].status,
      paymentStatus: result.rows[0].payment_status,
      userId: req.user?.id || null,
    });
    await client.query("COMMIT");
    return res.json({ success: true, order: result.rows[0] });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    return res.status(500).json({ success: false, message: "Failed to confirm payment", error: error.message });
  } finally {
    client.release();
  }
};

export const rejectShippingPayment = async (req, res) => {
  const client = await db.connect();
  try {
    const tenantId = isSuperAdminUser(req.user) ? null : getTenantId(req, req.user?.tenant_id);
    await ensurePosShiftOrderColumns(client, tenantId);
    await client.query("BEGIN");
    const existing = await client.query(
      `
      SELECT *
      FROM orders
      WHERE id = $1
        AND ($2::bigint IS NULL OR tenant_id = $2::bigint OR tenant_id IS NULL)
      LIMIT 1
      `,
      [req.params.id, tenantId]
    );
    const currentOrder = existing.rows[0];
    if (!currentOrder) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, message: "Order not found" });
    }
    if (!currentOrder.shipping_payment_screenshot || String(currentOrder.shipping_payment_screenshot || "").startsWith("data:image") || String(currentOrder.shipping_payment_screenshot || "").startsWith("blob:")) {
      await client.query("ROLLBACK");
      return res.status(400).json({ success: false, message: "صورة إثبات التحويل غير صالحة" });
    }
    const result = await client.query(
      `
      UPDATE orders
      SET payment_status = 'rejected',
          status = 'payment_rejected',
          shipping_payment_verified_at = NOW(),
          shipping_payment_verified_by = $2,
          updated_at = NOW()
      WHERE id = $1
        AND ($3::bigint IS NULL OR tenant_id = $3::bigint OR tenant_id IS NULL)
      RETURNING *
      `,
      [req.params.id, req.user?.id || null, tenantId]
    );
    await reverseOrderLoyalty(client, {
      ...currentOrder,
      ...result.rows[0],
      userId: req.user?.id || null,
    });
    await client.query("COMMIT");
    return res.json({ success: true, order: result.rows[0] });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    return res.status(500).json({ success: false, message: "Failed to reject payment", error: error.message });
  } finally {
    client.release();
  }
};

export const editOrder = async (req, res) => {
  const client = await db.connect();
  try {
    const tenantId = isSuperAdminUser(req.user) ? null : getTenantId(req, req.user?.tenant_id);
    await ensurePosShiftOrderColumns(client, tenantId);
    await client.query("BEGIN");

    const loaded = await loadOrderWithItems(client, { tenantId, orderId: req.params.id });
    if (!loaded) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, message: "Order not found" });
    }
    assertOrderEditable(loaded.order);

    const oldItems = loaded.items.map(normalizeOperationItem);
    const newItems = (Array.isArray(req.body.items) ? req.body.items : []).map(normalizeOperationItem).filter((item) => item.quantity > 0);
    if (!newItems.length) {
      await client.query("ROLLBACK");
      return res.status(400).json({ success: false, message: "لا يمكن حفظ فاتورة بدون منتجات" });
    }

    const oldQty = new Map();
    oldItems.forEach((item) => oldQty.set(stockKeyForItem(item), Number(oldQty.get(stockKeyForItem(item)) || 0) + Number(item.quantity || 0)));
    const newQty = new Map();
    newItems.forEach((item) => newQty.set(stockKeyForItem(item), Number(newQty.get(stockKeyForItem(item)) || 0) + Number(item.quantity || 0)));

    const touchedKeys = new Set([...oldQty.keys(), ...newQty.keys()]);
    for (const key of touchedKeys) {
      const sample = newItems.find((item) => stockKeyForItem(item) === key) || oldItems.find((item) => stockKeyForItem(item) === key);
      const deltaSold = Number(newQty.get(key) || 0) - Number(oldQty.get(key) || 0);
      if (deltaSold === 0 || !sample) continue;
      const stockLine = await resolveOrderLineStock(client, { tenantId, item: sample });
      await applyStockDelta(client, {
        tenantId,
        order: loaded.order,
        stockLine,
        delta: deltaSold * -1,
        movementType: "order_edit",
        reason: "POS invoice edit",
        userId: req.user?.id || null,
      });
    }

    const subtotalValue = newItems.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0), 0);
    const discountValue = Number(req.body.discount_amount ?? newItems.reduce((sum, item) => sum + Number(item.discount_amount || 0), 0));
    const serviceValue = Number(req.body.service_fee ?? loaded.order.service_fee ?? 0);
    const taxValue = Number(req.body.tax_amount ?? 0);
    const totalValue = Math.max(0, subtotalValue - discountValue + serviceValue + taxValue);
    const paidValue = Number(req.body.paid_amount ?? totalValue);
    const resolvedCustomerId = Object.prototype.hasOwnProperty.call(req.body, "customer_id")
      ? req.body.customer_id || null
      : loaded.order.customer_id || null;
    const resolvedCustomerName = String(req.body.customer_name || loaded.order.customer_name || "").trim() || "Walk-in Customer";
    const resolvedCustomerPhone = Object.prototype.hasOwnProperty.call(req.body, "customer_phone")
      ? req.body.customer_phone || ""
      : loaded.order.customer_phone || "";

    await client.query(`DELETE FROM order_items WHERE order_id = $1 AND ($2::bigint IS NULL OR tenant_id = $2::bigint OR tenant_id IS NULL)`, [loaded.order.id, tenantId]);
    for (const item of newItems) {
      const stockLine = await resolveOrderLineStock(client, { tenantId, item });
      await client.query(
        `
        INSERT INTO order_items (
          tenant_id, order_id, variant_id, product_id, product_name, variant_name, sku, barcode,
          quantity, sale_price, discount_amount, tax_amount, total_amount
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
        `,
        [
          tenantId,
          loaded.order.id,
          stockLine.variantId || null,
          stockLine.productId || item.product_id || null,
          item.product_name || "",
          item.variant_name || "",
          item.sku || "",
          item.barcode || "",
          item.quantity,
          item.price,
          item.discount_amount || 0,
          item.tax_amount || 0,
          item.total_amount,
        ]
      );
    }

    const orderResult = await client.query(
      `
      UPDATE orders
      SET subtotal = $1,
          discount_amount = $2,
          tax_amount = $3,
          service_fee = $4,
          total_amount = $5,
          total = $5,
          total_price = $5,
          paid_amount = $6,
          change_amount = GREATEST($6 - $5, 0),
          payment_method = COALESCE($7, payment_method),
          payment_status = COALESCE($8, payment_status),
          status = COALESCE($9, status),
          customer_id = $10,
          customer_name = $11,
          customer_phone = $12,
          notes = COALESCE($13, notes),
          updated_at = NOW()
      WHERE id = $14
      RETURNING *
      `,
      [
        subtotalValue,
        discountValue,
        taxValue,
        serviceValue,
        totalValue,
        paidValue,
        req.body.payment_method || null,
        req.body.payment_status || null,
        req.body.status || null,
        resolvedCustomerId,
        resolvedCustomerName,
        resolvedCustomerPhone,
        req.body.reason || req.body.notes || null,
        loaded.order.id,
      ]
    );
    await markCustomerTrustedForCompletedOrder(client, orderResult.rows[0]);
    await processOrderLoyalty(client, {
      tenantId,
      orderId: orderResult.rows[0].id,
      customerId: orderResult.rows[0].customer_id,
      orderTotal: totalValue,
      paidAmount: paidValue,
      status: orderResult.rows[0].status,
      paymentStatus: orderResult.rows[0].payment_status,
      userId: req.user?.id || null,
    });

    await client.query(
      `
      INSERT INTO order_edit_audits (tenant_id, order_id, old_items, new_items, old_total, new_total, user_id, reason)
      VALUES ($1,$2,$3::jsonb,$4::jsonb,$5,$6,$7,$8)
      `,
      [
        tenantId,
        loaded.order.id,
        JSON.stringify(oldItems),
        JSON.stringify(newItems),
        Number(loaded.order.total_amount || loaded.order.total || 0),
        totalValue,
        req.user?.id || null,
        req.body.reason || "POS invoice edit",
      ]
    );

    if (tenantId !== null) {
      try {
        const difference = totalValue - Number(loaded.order.total_amount || loaded.order.total || 0);
        if (difference > 0) {
          await postSaleEntry(client, {
            tenantId,
            saleAmount: difference,
            cogsAmount: 0,
            referenceType: "order_edit",
            referenceId: loaded.order.id,
            description: "POS invoice edit increase",
            createdBy: req.user?.id || null,
            branchId: loaded.order.branch_id || null,
            notes: req.body.reason || "",
          });
        } else if (difference < 0) {
          await postReturnEntry(client, {
            tenantId,
            amount: Math.abs(difference),
            direction: "out",
            referenceType: "order_edit",
            referenceId: loaded.order.id,
            description: "POS invoice edit decrease",
            createdBy: req.user?.id || null,
            branchId: loaded.order.branch_id || null,
            notes: req.body.reason || "",
          });
        }
      } catch (accountingError) {
        console.error("[orders] edit accounting fallback", accountingError.message);
      }
    }

    await client.query("COMMIT");
    const updated = await loadOrderWithItems(db, { tenantId, orderId: loaded.order.id });
    return res.status(200).json({ success: true, message: "تم حفظ تعديل الفاتورة", order: orderResult.rows[0], items: updated?.items || [] });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("[orders] edit error", error);
    return res.status(error.status || 500).json({ success: false, message: error.message || "Failed to edit order" });
  } finally {
    client.release();
  }
};

export const cancelOrder = async (req, res) => {
  const client = await db.connect();
  try {
    const tenantId = isSuperAdminUser(req.user) ? null : getTenantId(req, req.user?.tenant_id);
    await ensurePosShiftOrderColumns(client, tenantId);
    await client.query("BEGIN");
    const loaded = await loadOrderWithItems(client, { tenantId, orderId: req.params.id });
    if (!loaded) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, message: "Order not found" });
    }
    assertOrderEditable(loaded.order);

    for (const item of loaded.items.map(normalizeOperationItem)) {
      const stockLine = await resolveOrderLineStock(client, { tenantId, item });
      await applyStockDelta(client, {
        tenantId,
        order: loaded.order,
        stockLine,
        delta: Number(item.quantity || 0),
        movementType: "order_cancel",
        reason: "POS invoice cancel",
        userId: req.user?.id || null,
      });
    }

    const updateResult = await client.query(
      `
      UPDATE orders
      SET status = 'cancelled',
          payment_status = 'cancelled',
          cancelled_at = NOW(),
          cancelled_by = $2,
          notes = CONCAT(COALESCE(notes, ''), CASE WHEN COALESCE(notes, '') = '' THEN '' ELSE E'\n' END, $3::text),
          updated_at = NOW()
      WHERE id = $1
      RETURNING *
      `,
      [loaded.order.id, req.user?.id || null, req.body?.reason || "Cancelled from POS"]
    );

    await reverseOrderLoyalty(client, {
      ...loaded.order,
      ...updateResult.rows[0],
      userId: req.user?.id || null,
    });

    try {
      await postReturnEntry(client, {
        tenantId,
        amount: Number(loaded.order.total_amount || loaded.order.total || 0),
        direction: "out",
        referenceType: "order_cancel",
        referenceId: loaded.order.id,
        description: "POS invoice cancellation reversal",
        createdBy: req.user?.id || null,
        branchId: loaded.order.branch_id || null,
        notes: req.body?.reason || "",
      });
    } catch (accountingError) {
      console.error("[orders] cancel accounting fallback", accountingError.message);
    }

    await client.query("COMMIT");
    return res.status(200).json({ success: true, message: "تم إلغاء الفاتورة وإرجاع المخزون", order: updateResult.rows[0] });
  } catch (error) {
    await client.query("ROLLBACK");
    return res.status(error.status || 500).json({ success: false, message: error.message || "Failed to cancel order" });
  } finally {
    client.release();
  }
};

export const returnOrder = async (req, res) => {
  const client = await db.connect();
  try {
    const tenantId = isSuperAdminUser(req.user) ? null : getTenantId(req, req.user?.tenant_id);
    await ensurePosShiftOrderColumns(client, tenantId);
    await ensureWalletSchema(client);
    await client.query("BEGIN");
    const loaded = await loadOrderWithItems(client, { tenantId, orderId: req.params.id });
    if (!loaded) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, message: "Order not found" });
    }
    assertOrderReturnable(loaded.order);

    const requestedItems = Array.isArray(req.body.items) && req.body.items.length
      ? req.body.items
      : loaded.items.map((item) => ({ order_item_id: item.id, quantity: item.quantity }));
    const itemsById = new Map(loaded.items.map((item) => [String(item.id), item]));
    const validatedItems = [];
    let projectedReturnedAll = true;

    for (const requested of requestedItems) {
      const original = itemsById.get(String(requested.order_item_id || requested.id));
      if (!original) {
        const error = new Error("تم إرسال منتج غير موجود في الفاتورة");
        error.status = 400;
        throw error;
      }
      const soldQuantity = Number(original.quantity || 0);
      const alreadyReturned = Number(original.returned_quantity || 0);
      const maxReturnable = soldQuantity - alreadyReturned;
      const quantity = Number(requested.quantity || 0);

      if (quantity <= 0) continue;
      if (maxReturnable <= 0) {
        const error = new Error(`تم إرجاع ${original.product_name || "هذا المنتج"} بالكامل من قبل`);
        error.status = 400;
        throw error;
      }
      if (quantity > maxReturnable) {
        const error = new Error(`لا يمكن إرجاع كمية أكبر من المتاح للمنتج ${original.product_name || original.id}`);
        error.status = 400;
        throw error;
      }

      const unitRefund = Number(original.total_amount || 0) / Math.max(1, soldQuantity || 1);
      const refund = Number(requested.refund_amount ?? unitRefund * quantity);
      validatedItems.push({ original, quantity, refund });
    }

    if (validatedItems.length === 0) {
      const error = new Error("اختر كمية مرتجعة صالحة");
      error.status = 400;
      throw error;
    }

    for (const item of loaded.items) {
      const selected = validatedItems.find((entry) => String(entry.original.id) === String(item.id));
      const nextReturned = Number(item.returned_quantity || 0) + Number(selected?.quantity || 0);
      if (nextReturned < Number(item.quantity || 0)) projectedReturnedAll = false;
    }

    const returnNumber = `RET-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const mode = String(req.body.mode || "partial").trim().toLowerCase();
    const refundMethod = String(req.body.refund_method || req.body.refundMethod || "cash").trim().toLowerCase();
    const reason = req.body.reason || (mode === "exchange" ? "استبدال" : "POS return");
    const returnResult = await client.query(
      `
      INSERT INTO returns (tenant_id, order_id, return_number, status, reason, restock, refund_amount, created_by)
      VALUES ($1,$2,$3,'completed',$4,true,$5,$6)
      RETURNING *
      `,
      [tenantId, loaded.order.id, returnNumber, reason, Number(req.body.refund_amount || 0), req.user?.id || null]
    );
    const returnRow = returnResult.rows[0];
    let refundTotal = 0;

    for (const { original, quantity, refund } of validatedItems) {
      refundTotal += refund;

      await client.query(
        `
        INSERT INTO return_items (tenant_id, return_id, order_item_id, variant_id, quantity, refund_amount, restock)
        VALUES ($1,$2,$3,$4,$5,$6,true)
        `,
        [tenantId, returnRow.id, original.id, original.variant_id || null, quantity, refund]
      );
      await client.query(`UPDATE order_items SET returned_quantity = COALESCE(returned_quantity, 0) + $1 WHERE id = $2`, [quantity, original.id]);

      const stockLine = await resolveOrderLineStock(client, { tenantId, item: original });
      await applyStockDelta(client, {
        tenantId,
        order: loaded.order,
        stockLine,
        delta: quantity,
        movementType: "return",
        reason: "POS invoice return",
        userId: req.user?.id || null,
      });
    }

    await client.query(`UPDATE returns SET refund_amount = $1 WHERE id = $2`, [refundTotal, returnRow.id]);
    await client.query(`UPDATE returns SET refund_method = $1, exchange_difference = $2 WHERE id = $3`, [
      refundMethod,
      Number(req.body.exchange_difference || 0),
      returnRow.id,
    ]);

    const status = projectedReturnedAll ? "refunded" : "partially_refunded";
    const updatedOrder = await client.query(
      `
      UPDATE orders
      SET status = $2,
          payment_status = $2,
          returned_at = NOW(),
          updated_at = NOW()
      WHERE id = $1
      RETURNING *
      `,
      [loaded.order.id, status]
    );

    if (status === "refunded") {
      await reverseOrderLoyalty(client, {
        ...loaded.order,
        ...updatedOrder.rows[0],
        userId: req.user?.id || null,
      });
    }

    let walletResult = null;
    if (refundMethod === "wallet") {
      if (!loaded.order.customer_id) {
        const error = new Error("يجب ربط الفاتورة بعميل لإضافة الرصيد إلى المحفظة");
        error.status = 400;
        throw error;
      }
      walletResult = await recordWalletTransaction(client, {
        tenantId,
        customerId: loaded.order.customer_id,
        type: mode === "exchange" ? "exchange_credit" : "refund",
        amount: refundTotal,
        orderId: loaded.order.id,
        referenceType: mode === "exchange" ? "exchange" : "return",
        referenceId: returnRow.id,
        notes: `${reason} / ${loaded.order.invoice_number || loaded.order.id}`,
        userId: req.user?.id || null,
      });
      try {
        await postWalletLiabilityEntry(client, {
          tenantId,
          amount: refundTotal,
          direction: "credit",
          referenceType: mode === "exchange" ? "exchange" : "return",
          referenceId: returnRow.id,
          description: mode === "exchange" ? "Exchange credit added to customer wallet" : "Return refund added to customer wallet",
          createdBy: req.user?.id || null,
          branchId: loaded.order.branch_id || null,
          notes: `${reason} / ${loaded.order.invoice_number || loaded.order.id}`,
        });
      } catch (walletAccountingError) {
        console.error("[orders] wallet refund accounting fallback", walletAccountingError.message);
      }
    }

    if (refundMethod !== "wallet") {
      try {
        await postReturnEntry(client, {
          tenantId,
          amount: refundTotal || Number(req.body.refund_amount || 0),
          direction: "out",
          referenceType: mode === "exchange" ? "exchange_return" : "return",
          referenceId: returnRow.id,
          description: mode === "exchange" ? "POS exchange return" : "POS sales return",
          createdBy: req.user?.id || null,
          branchId: loaded.order.branch_id || null,
          notes: `${reason}${mode === "exchange" ? ` / original invoice ${loaded.order.invoice_number || loaded.order.id}` : ""}`,
        });
      } catch (accountingError) {
        console.error("[orders] return accounting fallback", accountingError.message);
      }
    }

    await client.query("COMMIT");
    try {
      io.emit("dashboard:activity", {
        type: refundMethod === "wallet" ? "wallet_refund" : "refund",
        title: returnRow.return_number || `Return #${returnRow.id}`,
        amount: refundTotal,
        status: refundMethod,
        created_at: new Date().toISOString(),
      });
      io.emit("refresh_dashboard");
    } catch (socketError) {
      console.error("[orders] return socket emit failed", socketError.message);
    }
    return res.status(201).json({
      success: true,
      message: mode === "exchange" ? "تم إنشاء استبدال وإرجاع المنتج للمخزون" : "تم إنشاء مرتجع وإرجاع المنتج للمخزون",
      return: { ...returnRow, mode, refund_method: refundMethod, original_order_id: loaded.order.id },
      order: updatedOrder.rows[0],
      refund_amount: refundTotal,
      wallet: walletResult,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("[orders] return error", error);
    return res.status(error.status || 500).json({ success: false, message: error.message || "Failed to return order" });
  } finally {
    client.release();
  }
};

export const getOrdersCount = async (req, res) => {
  try {
    const tenantId = isSuperAdminUser(req.user) ? null : getTenantId(req, req.user?.tenant_id);
    const result = await db.query(
      `
      SELECT COUNT(*) FROM orders
      ${tenantId === null ? "" : "WHERE tenant_id = $1"}
      `,
      tenantId === null ? [] : [tenantId]
    );

    res.status(200).json({ count: result.rows[0].count });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Server Error" });
  }
};

export const createReturn = async (req, res) => {
  const client = await db.connect();

  try {
    await client.query("BEGIN");
    const tenantId = isSuperAdminUser(req.user) ? null : getTenantId(req, req.user?.tenant_id);
    const {
      orderId,
      reason = "",
      restock = false,
      refundAmount = 0,
      status = "Draft",
      shippingProvider = "",
      trackingNumber = "",
      items = [],
    } = req.body || {};

    if (!orderId || !Array.isArray(items) || items.length === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        success: false,
        message: "Order and return items are required",
      });
    }

    const orderResult = await client.query(
      `
      SELECT *
      FROM orders
      WHERE id = $1
        AND ($2::bigint IS NULL OR tenant_id = $2::bigint)
      `,
      [orderId, tenantId]
    );

    if (orderResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    const returnNumber = `RET-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const returnResult = await client.query(
      `
      INSERT INTO returns (
        tenant_id,
        order_id,
        return_number,
        status,
        reason,
        restock,
        refund_amount,
        created_by
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      RETURNING *
      `,
      [
        tenantId,
        orderId,
        returnNumber,
        status,
        reason,
        Boolean(restock),
        Number(refundAmount || 0),
        req.user?.id || null,
      ]
    );

    const returnRow = returnResult.rows[0];

    for (const item of items) {
      const orderItemId = item.order_item_id || item.orderItemId || item.id;
      const quantity = Number(item.quantity || 0);
      const refund = Number(item.refund_amount || item.refundAmount || 0);
      const variantId = item.variant_id || item.variantId || null;

      if (!orderItemId || quantity <= 0) {
        continue;
      }

      await client.query(
        `
        INSERT INTO return_items (
          tenant_id,
          return_id,
          order_item_id,
          variant_id,
          quantity,
          refund_amount,
          restock
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7)
        `,
        [
          tenantId,
          returnRow.id,
          orderItemId,
          variantId,
          quantity,
          refund,
          Boolean(restock),
        ]
      );

      if (Boolean(restock) && variantId) {
        const variantResult = await client.query(
          `
          SELECT id, product_id, stock, cost_price
          FROM product_variants
          WHERE id = $1
            AND ($2::bigint IS NULL OR tenant_id = $2::bigint)
          FOR UPDATE
          `,
          [variantId, tenantId]
        );

        const variant = variantResult.rows[0];
        if (variant) {
          await adjustVariantStock(client, {
            tenantId,
            variantId,
            quantityChange: quantity,
            movementType: "return_in",
            referenceType: "return",
            referenceId: returnRow.id,
            unitCost: variant.cost_price || null,
            totalCost: Number(variant.cost_price || 0) * quantity,
            reason: "Sales return restock",
            notes: reason || `Return restocked from order ${orderId}`,
            createdBy: req.user?.id || null,
            branchId: orderResult.rows[0]?.branch_id || null,
          });
        }
      }
    }

    await postReturnEntry(client, {
      tenantId,
      referenceType: "return",
      referenceId: returnRow.id,
      description: `Return #${returnNumber}`,
      amount: Number(refundAmount || 0),
      direction: restock ? "in" : "out",
      createdBy: req.user?.id || null,
      branchId: orderResult.rows[0]?.branch_id || null,
      notes: reason || "",
    });

    await client.query("COMMIT");

    return res.status(201).json({
      success: true,
      message: "Return saved successfully",
      return: returnRow,
      shippingProvider,
      trackingNumber,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.log("Create Return Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to save return",
    });
  } finally {
    client.release();
  }
};

export const getSingleOrder = async (req, res) => {
  try {
    const tenantId = isSuperAdminUser(req.user) ? null : getTenantId(req, req.user?.tenant_id);
    const { id } = req.params;
    await ensurePosShiftOrderColumns(db, tenantId);

    const orderResult = await db.query(
      `
      SELECT o.*, creator.name AS created_by_name, canceller.name AS cancelled_by_name
      FROM orders o
      LEFT JOIN users creator ON creator.id = COALESCE(o.cashier_id, o.created_by)
      LEFT JOIN users canceller ON canceller.id = o.cancelled_by
      WHERE o.id = $1
        AND ($2::bigint IS NULL OR o.tenant_id = $2::bigint)
      `,
      [id, tenantId]
    );

    if (orderResult.rows.length === 0) {
      return res.status(404).json({ message: "Order not found" });
    }

    const itemsResult = await db.query(
      `
      SELECT
        order_items.*,
        product_variants.size,
        product_variants.color,
        product_variants.image_url,
        COALESCE(products.name, order_items.product_name) AS product_name
      FROM order_items
      LEFT JOIN product_variants ON order_items.variant_id = product_variants.id
      LEFT JOIN products ON COALESCE(order_items.product_id, product_variants.product_id) = products.id
      WHERE order_items.order_id = $1
        AND ($2::bigint IS NULL OR order_items.tenant_id = $2::bigint)
      `,
      [id, tenantId]
    );

    const order = orderResult.rows[0];
    const timeline = [
      {
        action: "created",
        user: order.created_by_name || order.cashier_name || "أدمن",
        at: order.created_at,
      },
    ];

    const editAudits = await db.query(
      `
      SELECT a.created_at, COALESCE(u.name, u.email, 'أدمن') AS user_name
      FROM order_edit_audits a
      LEFT JOIN users u ON u.id = a.user_id
      WHERE a.order_id = $1
        AND ($2::bigint IS NULL OR a.tenant_id = $2::bigint OR a.tenant_id IS NULL)
      ORDER BY a.created_at ASC
      `,
      [id, tenantId]
    );
    editAudits.rows.forEach((row) => {
      timeline.push({ action: "edited", user: row.user_name || "أدمن", at: row.created_at });
    });

    const reprintLogs = await db.query(
      `
      SELECT r.created_at, COALESCE(u.name, u.email, 'أدمن') AS user_name
      FROM order_reprint_logs r
      LEFT JOIN users u ON u.id = r.user_id
      WHERE r.order_id = $1
        AND ($2::bigint IS NULL OR r.tenant_id = $2::bigint OR r.tenant_id IS NULL)
      ORDER BY r.created_at ASC
      `,
      [id, tenantId]
    );
    reprintLogs.rows.forEach((row) => {
      timeline.push({ action: "reprinted", user: row.user_name || "أدمن", at: row.created_at });
    });

    const returnLogs = await db.query(
      `
      SELECT r.created_at, r.reason, COALESCE(u.name, u.email, 'أدمن') AS user_name
      FROM returns r
      LEFT JOIN users u ON u.id = r.created_by
      WHERE r.order_id = $1
        AND ($2::bigint IS NULL OR r.tenant_id = $2::bigint OR r.tenant_id IS NULL)
      ORDER BY r.created_at ASC
      `,
      [id, tenantId]
    );
    returnLogs.rows.forEach((row) => {
      const isExchange = String(row.reason || "").includes("استبدال") || String(row.reason || "").toLowerCase().includes("exchange");
      timeline.push({ action: isExchange ? "exchange_created" : "return_created", user: row.user_name || "أدمن", at: row.created_at });
    });

    if (order.cancelled_at) {
      timeline.push({
        action: "cancelled",
        user: order.cancelled_by_name || "أدمن",
        at: order.cancelled_at,
      });
    }

    timeline.sort((a, b) => new Date(a.at || 0).getTime() - new Date(b.at || 0).getTime());

    return res.status(200).json({ order: { ...order, audit_timeline: timeline }, items: itemsResult.rows, audit_timeline: timeline });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ message: "Server Error" });
  }
};

export const getPublicInvoiceByToken = async (req, res) => {
  try {
    console.log("[public invoice token]", req.params.token);
    const invoice = await loadPublicInvoiceByToken(req.params.token);
    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: "Invoice not found",
      });
    }

    console.log("[public invoice order]", invoice?.order_id || invoice?.id);
    invoice.public_invoice_url = buildPublicInvoiceUrl(req, invoice.public_token);
    invoice.public_invoice_short_url = buildShortPublicInvoiceUrl(req, invoice.public_token);
    invoice.short_invoice_url = buildShortPublicInvoiceUrl(req, invoice.public_token);
    invoice.google_review_url = getGoogleReviewUrl();
    invoice.id = invoice.id || invoice.order_id;
    invoice.order_id = invoice.order_id || invoice.id;

    return res.status(200).json({
      success: true,
      invoice,
    });
  } catch (error) {
    console.error("Public Invoice Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to load invoice",
    });
  }
};

export const getPublicInvoicePdfByToken = async (req, res) => {
  try {
    console.log("[public invoice token]", req.params.token);
    const invoice = await loadPublicInvoiceByToken(req.params.token);
    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: "Invoice not found",
      });
    }

    console.log("[public invoice order]", invoice?.order_id || invoice?.id);
    invoice.public_invoice_url = buildPublicInvoiceUrl(req, invoice.public_token);
    invoice.public_invoice_short_url = buildShortPublicInvoiceUrl(req, invoice.public_token);
    invoice.short_invoice_url = buildShortPublicInvoiceUrl(req, invoice.public_token);
    invoice.google_review_url = getGoogleReviewUrl();
    const pdfBuffer = await buildPublicInvoicePdfBuffer(invoice);
    const safeInvoiceNumber = String(invoice.invoice_number || "invoice").replace(/[^\w.-]+/g, "_");

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${safeInvoiceNumber}.pdf"`);
    return res.status(200).send(pdfBuffer);
  } catch (error) {
    console.error("Public Invoice PDF Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to generate invoice PDF",
    });
  }
};
