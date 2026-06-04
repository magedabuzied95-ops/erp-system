import crypto from "node:crypto";

import db from "../database/db.js";
import logActivity from "../utils/logActivity.js";
import { io } from "../utils/socket.js";
import { getTenantId, isSuperAdminUser } from "../utils/requestScope.js";
import { recordEmployeeAnalytics } from "../utils/employeeAnalytics.js";
import { ensureAttendanceSchema } from "../utils/attendanceSchema.js";
import { ensureSingleBranchMode } from "../utils/singleBranchMode.js";
import { adjustVariantStock, recordInventoryMovement } from "../services/inventoryService.js";
import { ensureAccountingSchema, getCurrentCashDrawerShift, logAccountingAudit, postSaleEntry, postReturnEntry, postWalletLiabilityEntry, recordCashDrawerEvent, recordFinancialAccountActivity, reverseMoneyTransactionsForReference } from "../services/accountingService.js";
import { ensureLoyaltySchema, processOrderLoyalty, resolveOrCreateCustomerAccount, reverseOrderLoyalty } from "../services/loyaltyService.js";
import { ensureWalletSchema, recordWalletTransaction } from "../services/walletService.js";
import { detectMarketingAttribution, logAttributionEvent } from "../services/marketingAttributionService.js";
import { redeemCoupon, validateCoupon } from "../services/couponsService.js";
import { createSystemNotification } from "../services/notificationsService.js";
import { getSetting } from "../services/settingsService.js";
import { sendInvoiceWhatsapp } from "../services/whatsappOrderConfirmationService.js";
import { ensureWhatsappShippingSchema, sendShipmentNotificationForStatus } from "../services/whatsappShippingService.js";
import {
  ensureSalesCommissionSchema,
  getSalesSettings,
  getSalespersonSnapshot,
  logOrdersSalesEmployeeFkTarget,
  recordSalesCommissionForOrder,
} from "../services/salesCommissionService.js";
import { createDisplayRefillAlertsForOrder } from "../services/displayRefillAlertService.js";
import {
  assignSequentialInvoiceNumber,
  buildDerivedInvoiceNumber,
  buildTemporaryInvoiceNumber,
} from "../utils/invoiceNumber.js";
import { attachPublicOrderNumber } from "../utils/publicOrderNumber.js";
import { buildBulkOrderItemInsertQuery, buildOrderItemInsertQuery, enrichOrderItemsInsertError } from "../utils/orderItemInsert.js";
import { canOverridePosSeller, ensurePosUserShiftSchema, resolvePosBranch } from "./posController.js";
import { normalizeOrderLifecycleStatus, normalizeShippingLifecycleStatus } from "../../shared/orderStatus.js";
import { getShippingProvider, normalizeShippingProviderKey } from "../services/shippingProviders/index.js";

const POS_CHECKOUT_DEBUG = ["1", "true", "yes", "on"].includes(String(process.env.POS_CHECKOUT_DEBUG || "").trim().toLowerCase());
const POS_DEBUG = POS_CHECKOUT_DEBUG || ["1", "true", "yes", "on"].includes(String(process.env.POS_DEBUG || "").trim().toLowerCase());
const ERP_PERF_DEBUG = ["1", "true", "yes", "on"].includes(String(process.env.ERP_PERF_DEBUG || "").trim().toLowerCase());
let ordersSchemaEnsurePromise = null;
let ordersSchemaEnsured = false;
let ordersRuntimeSchemaWarningLogged = false;
const tableExistsCache = new Map();
const tableColumnSetCache = new Map();

const nowMs = () => Number(process.hrtime.bigint() / 1000000n);

const createCheckoutTimings = () => {
  const startedAt = nowMs();
  const timings = { request_start_ms: 0 };
  let last = startedAt;
  return {
    startedAt,
    mark(label) {
      const current = nowMs();
      timings[label] = (timings[label] || 0) + current - last;
      last = current;
    },
    add(label, duration) {
      timings[label] = (timings[label] || 0) + duration;
    },
    summary(extra = {}) {
      return { ...extra, ...timings, total_ms: nowMs() - startedAt };
    },
  };
};

const timedCheckout = async (timing, label, fn) => {
  const startedAt = nowMs();
  try {
    return await fn();
  } finally {
    timing.add(label, nowMs() - startedAt);
  }
};

const logCheckoutTiming = (summary) => {
  if (!POS_CHECKOUT_DEBUG) return;
  const phaseEntries = Object.entries(summary)
    .filter(([key, value]) => key.endsWith("_ms") && key !== "total_ms" && Number.isFinite(Number(value)))
    .sort((left, right) => Number(right[1]) - Number(left[1]));
  const [slowestPhase = "", slowestMs = 0] = phaseEntries[0] || [];
  const payload = { ...summary, slowest_phase: slowestPhase, slowest_phase_ms: slowestMs };
  const totalMs = Number(summary.total_ms || 0);
  if (totalMs > 1000) console.warn("[pos-checkout-slow]", payload);
  else console.log("[pos-checkout-timing]", payload);
};

const addPosEditTiming = (req, label, duration) => {
  if (!req) return;
  if (!req._posEditTimings) req._posEditTimings = {};
  req._posEditTimings[label] = (req._posEditTimings[label] || 0) + Number(duration || 0);
};

export const markPosEditTiming = (label) => (req, _res, next) => {
  if (req?._posEditLastAt) addPosEditTiming(req, label, nowMs() - req._posEditLastAt);
  req._posEditLastAt = nowMs();
  next();
};

export const startPosEditTiming = (req, _res, next) => {
  req._posEditStartedAt = nowMs();
  req._posEditLastAt = req._posEditStartedAt;
  req._posEditTimings = {};
  next();
};

const timedPosEdit = async (req, label, fn) => {
  const startedAt = nowMs();
  try {
    return await fn();
  } finally {
    addPosEditTiming(req, label, nowMs() - startedAt);
  }
};

const logPosEditTiming = (req, extra = {}) => {
  if (!POS_DEBUG) return;
  const startedAt = req?._posEditStartedAt || nowMs();
  console.log("[pos-edit-timing]", {
    ...extra,
    ...(req?._posEditTimings || {}),
    total_ms: nowMs() - startedAt,
  });
};

const assertInsertShape = ({ table, context, columns = [], placeholders = "", params = [] }) => {
  const columnCount = columns.length;
  const placeholderCount = (String(placeholders).match(/\$\d+/g) || []).length;
  const paramCount = params.length;
  if (!columnCount || columnCount !== placeholderCount || placeholderCount !== paramCount) {
    const error = new Error(
      `[${context || "sql"}] INSERT ${table || "table"} mismatch: columns=${columnCount}, placeholders=${placeholderCount}, params=${paramCount}`
    );
    error.code = "SQL_INSERT_SHAPE_MISMATCH";
    throw error;
  }
};

const normalizeMoneyPaymentMethod = (value) => {
  const key = String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (key === "visa") return "card";
  if (key === "vodafone") return "vodafone_cash";
  if (key === "insta_pay") return "instapay";
  if (["store_credit", "customer_credit", "credit_balance"].includes(key)) return "customer_wallet";
  return key || "cash";
};

const parsePaymentBreakdownRows = (value) => {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const normalizeSubmittedPaymentBreakdown = (value) =>
  parsePaymentBreakdownRows(value)
    .map((payment) => {
      if (!payment || typeof payment !== "object") return null;
      const method = normalizeMoneyPaymentMethod(payment.method || payment.payment_method);
      const amount = Number(payment.amount ?? payment.paid_amount ?? payment.value ?? 0);
      if (!method || !Number.isFinite(amount) || amount <= 0) return null;
      return {
        method,
        account_id: payment.account_id || payment.financial_account_id || null,
        amount,
        ...(payment.original_order_id ? { original_order_id: payment.original_order_id } : {}),
        ...(payment.invoice_number ? { invoice_number: payment.invoice_number } : {}),
      };
    })
    .filter(Boolean);

const resolveOrderTotalAmount = (order = {}) => {
  const candidates = [
    order.original_total,
    order.total_amount,
    order.total,
    order.total_price,
    order.grand_total,
  ];
  const resolved = candidates
    .map((value) => Number(value))
    .find((value) => Number.isFinite(value) && value > 0);
  return Math.max(0, resolved || 0);
};

const sumCollectedPaymentBreakdown = (order = {}) => {
  return parsePaymentBreakdownRows(order.payment_breakdown || order.payments).reduce((sum, payment) => {
    if (!payment || typeof payment !== "object" || payment.edit_additional_payment) return sum;
    const method = normalizeMoneyPaymentMethod(payment.method || payment.payment_method);
    if (method === "exchange_credit" || method === "return_credit") return sum;
    const amount = Number(payment.amount ?? payment.paid_amount ?? payment.value ?? 0);
    return Number.isFinite(amount) && amount > 0 ? sum + amount : sum;
  }, 0);
};

const resolveCollectedOrderAmount = (order = {}) => {
  const candidates = [
    order.original_paid_amount,
    order.total_paid,
    order.amount_paid,
    order.payment_paid_amount,
    order.paid_amount,
  ];
  const explicitAmount = candidates
    .map((value) => Number(value))
    .find((value) => Number.isFinite(value) && value > 0);
  if (explicitAmount > 0) return Math.max(0, explicitAmount);

  const breakdownAmount = sumCollectedPaymentBreakdown(order);
  if (breakdownAmount > 0) return Math.max(0, breakdownAmount);

  const status = String(order.payment_status || "").trim().toLowerCase();
  const total = resolveOrderTotalAmount(order);
  if (total > 0 && ["paid", "completed", "complete", "settled"].includes(status)) return total;
  return 0;
};

const refundFinancialAccountFromOrder = (order = {}, refundMethod = "") => {
  const method = normalizeMoneyPaymentMethod(refundMethod);
  const breakdown = Array.isArray(order.payment_breakdown) ? order.payment_breakdown : [];
  const aliases = method === "vodafone_cash" || method === "instapay" ? ["wallet", method] : [method];
  const match = breakdown.find((item) => aliases.includes(normalizeMoneyPaymentMethod(item.method || item.payment_method)));
  return match?.financial_account_id || match?.account_id || null;
};

const warnRuntimeSchemaExecution = (name) => {
  if (globalThis.__SCHEMA_STARTUP_RUNNING || ordersRuntimeSchemaWarningLogged) return;
  ordersRuntimeSchemaWarningLogged = true;
  console.warn("[schema-warning] runtime schema execution detected", { name });
};

const ensurePosShiftOrderColumnsNow = async (client, tenantId = null) => {
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
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS public_order_number VARCHAR(40)`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS display_order_number VARCHAR(40)`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS customer_id BIGINT`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS customer_name VARCHAR(255)`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS customer_phone VARCHAR(80)`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS channel VARCHAR(50) NOT NULL DEFAULT 'pos'`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS branch_id BIGINT`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS cashier_id BIGINT`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS sales_employee_id BIGINT`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS seller_user_id BIGINT NULL REFERENCES users(id) ON DELETE SET NULL`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS cashier_user_id BIGINT NULL REFERENCES users(id) ON DELETE SET NULL`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS seller_name VARCHAR(255)`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS cashier_name VARCHAR(255)`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS salesperson_id BIGINT`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS salesperson_name VARCHAR(255)`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS salesperson_commission_type VARCHAR(20)`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS salesperson_commission_value NUMERIC(12,2) NOT NULL DEFAULT 0`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS salesperson_fixed_mode VARCHAR(30)`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS salesperson_excluded_product_ids JSONB NOT NULL DEFAULT '[]'::jsonb`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS salesperson_excluded_category_ids JSONB NOT NULL DEFAULT '[]'::jsonb`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS shift_id BIGINT`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS status VARCHAR(50) NOT NULL DEFAULT 'pending'`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS payment_status VARCHAR(50) NOT NULL DEFAULT 'unpaid'`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS payment_method VARCHAR(50)`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS shipping_fee NUMERIC DEFAULT 0`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS shipping_payment_screenshot TEXT`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS shipping_payment_reference TEXT`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS transfer_proof_status VARCHAR(50)`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS shipping_payment_verified_at TIMESTAMP NULL`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS shipping_payment_verified_by INTEGER NULL`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS customer_trust_counted_at TIMESTAMP NULL`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS subtotal NUMERIC(12,2) NOT NULL DEFAULT 0`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS invoice_discount_type VARCHAR(20)`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS invoice_discount_value NUMERIC(12,2) NOT NULL DEFAULT 0`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS invoice_discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS invoice_discount_reason TEXT`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS tax_amount NUMERIC(12,2) NOT NULL DEFAULT 0`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS service_fee NUMERIC(12,2) NOT NULL DEFAULT 0`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS total_amount NUMERIC(12,2) NOT NULL DEFAULT 0`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS total_price NUMERIC(12,2) NOT NULL DEFAULT 0`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS total NUMERIC(12,2) NOT NULL DEFAULT 0`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS paid_amount NUMERIC(12,2) NOT NULL DEFAULT 0`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS change_amount NUMERIC(12,2) NOT NULL DEFAULT 0`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS exchange_mode BOOLEAN NOT NULL DEFAULT FALSE`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS original_order_id BIGINT NULL`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS exchange_credit_amount NUMERIC(12,2) NOT NULL DEFAULT 0`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS new_order_total NUMERIC(12,2) NOT NULL DEFAULT 0`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS amount_due_now NUMERIC(12,2) NOT NULL DEFAULT 0`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS exchange_difference NUMERIC(12,2) NOT NULL DEFAULT 0`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS exchange_invoice_number VARCHAR(100)`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS edit_original_paid_amount NUMERIC(12,2) NOT NULL DEFAULT 0`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS edit_additional_paid_amount NUMERIC(12,2) NOT NULL DEFAULT 0`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS edit_refund_or_credit_due NUMERIC(12,2) NOT NULL DEFAULT 0`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS edit_payment_difference JSONB NOT NULL DEFAULT '{}'::jsonb`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS notes TEXT`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS public_token TEXT`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS invoice_public_enabled BOOLEAN NOT NULL DEFAULT TRUE`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS created_by BIGINT`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP NULL`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS cancelled_by BIGINT NULL`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP NULL`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS deleted_by BIGINT NULL`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS delete_reason TEXT`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS cancel_reason TEXT`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS stock_restored_at TIMESTAMP NULL`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS stock_reverted_at TIMESTAMP NULL`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS inventory_rollback_done BOOLEAN NOT NULL DEFAULT FALSE`);
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
  await client.query(`ALTER TABLE IF EXISTS returns ADD COLUMN IF NOT EXISTS shift_id BIGINT NULL`);
  await client.query(`ALTER TABLE IF EXISTS returns ADD COLUMN IF NOT EXISTS cashier_user_id BIGINT NULL REFERENCES users(id) ON DELETE SET NULL`);
  await client.query(`
    UPDATE orders
    SET invoice_number = 'INV-' || id::text
    WHERE invoice_number IS NULL OR invoice_number = ''
  `);
  await client.query(`
    WITH duplicates AS (
      SELECT
        id,
        ROW_NUMBER() OVER (
          PARTITION BY COALESCE(tenant_id, 0), invoice_number
          ORDER BY id
        ) AS duplicate_rank
      FROM orders
      WHERE invoice_number IS NOT NULL
        AND invoice_number <> ''
    )
    UPDATE orders o
    SET invoice_number = 'INV-' || o.id::text || '-DUP'
    FROM duplicates d
    WHERE o.id = d.id
      AND d.duplicate_rank > 1
  `);
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_unique_tenant_invoice_number
    ON orders (COALESCE(tenant_id, 0), invoice_number)
    WHERE invoice_number IS NOT NULL AND invoice_number <> ''
  `);

  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS payment_method VARCHAR(50) DEFAULT 'cash'`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS cash_amount NUMERIC(12,2) NOT NULL DEFAULT 0`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS card_amount NUMERIC(12,2) NOT NULL DEFAULT 0`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS wallet_payment_amount NUMERIC(12,2) NOT NULL DEFAULT 0`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS attendance_log_id BIGINT NULL`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS warehouse_id BIGINT NULL`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS source VARCHAR(50) NOT NULL DEFAULT 'pos'`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS customer_address TEXT`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS governorate VARCHAR(120)`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS city_area VARCHAR(160)`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS landmark TEXT`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS delivery_notes TEXT`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS order_notes TEXT`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS shipping_provider VARCHAR(80) NOT NULL DEFAULT 'manual'`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS shipping_provider_id VARCHAR(80) NOT NULL DEFAULT 'in_store_delivery'`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS shipping_zone_id VARCHAR(160)`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS governorate_id VARCHAR(160)`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS city_id VARCHAR(160)`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS area_id VARCHAR(160)`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS district_id VARCHAR(160)`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS zone_id VARCHAR(160)`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS shipping_city_id VARCHAR(160)`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS shipping_district_id VARCHAR(160)`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS shipping_address_line TEXT`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS street_address TEXT`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS building_number VARCHAR(80)`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS floor_number VARCHAR(80)`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS apartment_number VARCHAR(80)`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS shipping_tracking_number VARCHAR(160)`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS shipping_provider_delivery_id VARCHAR(160)`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS shipping_label_url TEXT`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS shipping_last_synced_at TIMESTAMP NULL`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS shipping_raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS shipping_cost NUMERIC(12,2) NOT NULL DEFAULT 0`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS shipping_status VARCHAR(80) NOT NULL DEFAULT 'pending'`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS shipment_status VARCHAR(80)`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS shipment_id VARCHAR(160)`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS tracking_number VARCHAR(160)`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS tracking_url TEXT`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS courier_notes TEXT`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS shipment_timeline JSONB NOT NULL DEFAULT '[]'::jsonb`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS last_shipping_sync_at TIMESTAMP NULL`);
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
  await client.query(`CREATE INDEX IF NOT EXISTS idx_orders_public_order_number ON orders (public_order_number)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_orders_display_order_number ON orders (display_order_number)`);

  await client.query(`ALTER TABLE IF EXISTS order_items ADD COLUMN IF NOT EXISTS tenant_id BIGINT`);
  await client.query(`ALTER TABLE IF EXISTS order_items ADD COLUMN IF NOT EXISTS product_id BIGINT`);
  await client.query(`ALTER TABLE IF EXISTS order_items ADD COLUMN IF NOT EXISTS product_name VARCHAR(255) NOT NULL DEFAULT ''`);
  await client.query(`ALTER TABLE IF EXISTS order_items ADD COLUMN IF NOT EXISTS variant_name VARCHAR(255)`);
  await client.query(`ALTER TABLE IF EXISTS order_items ADD COLUMN IF NOT EXISTS sku VARCHAR(120)`);
  await client.query(`ALTER TABLE IF EXISTS order_items ADD COLUMN IF NOT EXISTS barcode VARCHAR(120)`);
  await client.query(`ALTER TABLE IF EXISTS order_items ADD COLUMN IF NOT EXISTS sale_price NUMERIC(12,2) NOT NULL DEFAULT 0`);
  await client.query(`ALTER TABLE IF EXISTS order_items ADD COLUMN IF NOT EXISTS unit_price NUMERIC(12,2) NOT NULL DEFAULT 0`);
  await client.query(`ALTER TABLE IF EXISTS order_items ADD COLUMN IF NOT EXISTS line_total NUMERIC(12,2) NOT NULL DEFAULT 0`);
  await client.query(`ALTER TABLE IF EXISTS order_items ADD COLUMN IF NOT EXISTS subtotal NUMERIC(12,2) NOT NULL DEFAULT 0`);
  await client.query(`ALTER TABLE IF EXISTS order_items ADD COLUMN IF NOT EXISTS price_source VARCHAR(50) NOT NULL DEFAULT 'stored'`);
  await client.query(`ALTER TABLE IF EXISTS order_items ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0`);
  await client.query(`ALTER TABLE IF EXISTS order_items ADD COLUMN IF NOT EXISTS tax_amount NUMERIC(12,2) NOT NULL DEFAULT 0`);
  await client.query(`ALTER TABLE IF EXISTS order_items ADD COLUMN IF NOT EXISTS total_amount NUMERIC(12,2) NOT NULL DEFAULT 0`);
  await client.query(`ALTER TABLE IF EXISTS order_items ADD COLUMN IF NOT EXISTS returned_quantity INTEGER NOT NULL DEFAULT 0`);
  await client.query(`ALTER TABLE IF EXISTS order_items ADD COLUMN IF NOT EXISTS image_url TEXT`);
  await client.query(`ALTER TABLE IF EXISTS order_items ADD COLUMN IF NOT EXISTS product_image TEXT`);
  await client.query(`ALTER TABLE IF EXISTS order_items ADD COLUMN IF NOT EXISTS variant_image TEXT`);
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

  await client.query(`
    CREATE TABLE IF NOT EXISTS activity_logs (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NULL,
      action VARCHAR(120) NOT NULL,
      entity VARCHAR(120) NOT NULL,
      entity_id BIGINT NULL,
      details JSONB NULL,
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
  await client.query(`CREATE INDEX IF NOT EXISTS idx_orders_id_tenant ON orders (id, tenant_id)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_pos_orders_shift_id ON orders (shift_id)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_pos_orders_seller_user_id ON orders (seller_user_id)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_pos_orders_cashier_user_id ON orders (cashier_user_id)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_orders_channel_created ON orders (channel, created_at DESC)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_orders_tenant_created_id ON orders (tenant_id, created_at DESC, id DESC)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_orders_tenant_channel_created_id ON orders (tenant_id, channel, created_at DESC, id DESC)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_orders_tenant_source_created_id ON orders (tenant_id, source, created_at DESC, id DESC)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_orders_tenant_customer_created ON orders (tenant_id, customer_id, created_at DESC)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders (created_at DESC)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_orders_tenant_created ON orders (tenant_id, created_at DESC)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_orders_branch_created ON orders (branch_id, created_at DESC)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_orders_invoice_number ON orders (invoice_number)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers (phone)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_orders_attendance_tenant ON orders (attendance_log_id, tenant_id)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_orders_shift_tenant_created ON orders (tenant_id, shift_id, created_at DESC)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items (order_id)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_order_items_tenant_order ON order_items (tenant_id, order_id)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_order_items_order_id_id ON order_items (order_id, id)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_order_items_product_order ON order_items (product_id, order_id)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_order_items_variant_order ON order_items (variant_id, order_id)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_order_reprint_logs_order ON order_reprint_logs (order_id, created_at DESC)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_order_edit_audits_order ON order_edit_audits (order_id, created_at DESC)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_transactions_tenant_id ON transactions (tenant_id)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_cashbox_tenant_id ON cashbox (tenant_id)`);
  await client.query(`
    DO $$
    BEGIN
      IF to_regclass('inventory') IS NOT NULL
        AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'inventory' AND column_name = 'product_id')
        AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'inventory' AND column_name = 'variant_id')
        AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'inventory' AND column_name = 'branch_id')
      THEN
        CREATE INDEX IF NOT EXISTS idx_inventory_product_variant_branch ON inventory (product_id, variant_id, branch_id);
      END IF;
      IF to_regclass('treasury_transactions') IS NOT NULL
        AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'treasury_transactions' AND column_name = 'order_id')
      THEN
        CREATE INDEX IF NOT EXISTS idx_treasury_transactions_order_id ON treasury_transactions (order_id);
      END IF;
      IF to_regclass('payments') IS NOT NULL
        AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'payments' AND column_name = 'order_id')
      THEN
        CREATE INDEX IF NOT EXISTS idx_payments_order_id ON payments (order_id);
      END IF;
    END $$;
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_commission_rules_tenant_id ON commission_rules (tenant_id, is_active, scope_type)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_employee_sales_tenant_id ON employee_sales (tenant_id, sales_employee_id, cashier_id, created_at DESC)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_employee_commissions_tenant_id ON employee_commissions (tenant_id, employee_id, created_at DESC)`);
  await client.query(`ALTER TABLE IF EXISTS products ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP`);
  await client.query(`ALTER TABLE IF EXISTS products ADD COLUMN IF NOT EXISTS image_url TEXT DEFAULT ''`);
  await client.query(`ALTER TABLE IF EXISTS products ADD COLUMN IF NOT EXISTS image TEXT DEFAULT ''`);
  await client.query(`ALTER TABLE IF EXISTS products ADD COLUMN IF NOT EXISTS gallery_images JSONB NOT NULL DEFAULT '[]'::jsonb`);
  await client.query(`ALTER TABLE IF EXISTS product_variants ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP`);
  await client.query(`ALTER TABLE IF EXISTS product_variants ADD COLUMN IF NOT EXISTS image_url TEXT DEFAULT ''`);
  await client.query(`ALTER TABLE IF EXISTS product_variants ADD COLUMN IF NOT EXISTS image TEXT DEFAULT ''`);
  await client.query(`ALTER TABLE IF EXISTS product_variants ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE`);
  await client.query(`ALTER TABLE IF EXISTS product_variants ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP NULL`);
  await client.query(`ALTER TABLE IF EXISTS product_variants ADD COLUMN IF NOT EXISTS sku VARCHAR(120)`);
  await client.query(`ALTER TABLE IF EXISTS product_variants ADD COLUMN IF NOT EXISTS barcode VARCHAR(120)`);
  await client.query(`ALTER TABLE IF EXISTS product_variants ADD COLUMN IF NOT EXISTS color VARCHAR(100)`);
  await client.query(`ALTER TABLE IF EXISTS product_variants ADD COLUMN IF NOT EXISTS size VARCHAR(100)`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS whatsapp_confirmation_sent_at TIMESTAMP NULL`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS whatsapp_confirmed_at TIMESTAMP NULL`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS whatsapp_cancelled_at TIMESTAMP NULL`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS whatsapp_payment_review_sent_at TIMESTAMP NULL`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS whatsapp_invoice_sent_at TIMESTAMP NULL`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS whatsapp_shipment_created_sent_at TIMESTAMP NULL`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS whatsapp_shipped_sent_at TIMESTAMP NULL`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS whatsapp_out_for_delivery_sent_at TIMESTAMP NULL`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS whatsapp_delivered_sent_at TIMESTAMP NULL`);
  await client.query(`
    CREATE TABLE IF NOT EXISTS product_variant_images (
      id BIGSERIAL PRIMARY KEY,
      tenant_id BIGINT,
      product_id BIGINT,
      variant_id BIGINT,
      color_name VARCHAR(100),
      image_url TEXT NOT NULL DEFAULT '',
      is_primary BOOLEAN NOT NULL DEFAULT FALSE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.query(`ALTER TABLE IF EXISTS product_variant_images ADD COLUMN IF NOT EXISTS tenant_id BIGINT`);
  await client.query(`ALTER TABLE IF EXISTS product_variant_images ADD COLUMN IF NOT EXISTS product_id BIGINT`);
  await client.query(`ALTER TABLE IF EXISTS product_variant_images ADD COLUMN IF NOT EXISTS variant_id BIGINT`);
  await client.query(`ALTER TABLE IF EXISTS product_variant_images ADD COLUMN IF NOT EXISTS color_name VARCHAR(100)`);
  await client.query(`ALTER TABLE IF EXISTS product_variant_images ADD COLUMN IF NOT EXISTS image_url TEXT NOT NULL DEFAULT ''`);
  await client.query(`ALTER TABLE IF EXISTS product_variant_images ADD COLUMN IF NOT EXISTS is_primary BOOLEAN NOT NULL DEFAULT FALSE`);
  await client.query(`ALTER TABLE IF EXISTS product_variant_images ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0`);
  await ensureSingleBranchMode(client);
};

export const ensureOrdersSchema = async (clientOrPool = db, tenantId = null) => {
  if (ordersSchemaEnsured) return;
  warnRuntimeSchemaExecution("orders");
  if (!ordersSchemaEnsurePromise) {
    ordersSchemaEnsurePromise = (async () => {
      await ensurePosShiftOrderColumnsNow(clientOrPool, tenantId);
      await warmOrdersSchemaCache(clientOrPool);
    })()
      .then(() => {
        ordersSchemaEnsured = true;
      })
      .catch((error) => {
        ordersSchemaEnsurePromise = null;
        throw error;
      });
  }
  await ordersSchemaEnsurePromise;
};

const ensurePosShiftOrderColumns = ensureOrdersSchema;
const generatePublicToken = () => crypto.randomBytes(24).toString("hex");

const toFiniteNumber = (value, fallback = 0) => {
  const number = Number(value || fallback);
  return Number.isFinite(number) ? number : fallback;
};

const firstValue = (...values) => values.find((value) => value !== undefined && value !== null && value !== "");

const firstFiniteMoney = (...values) => {
  for (const value of values) {
    if (value === undefined || value === null || value === "") continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return 0;
};

const firstPositiveMoney = (...values) => {
  for (const value of values) {
    if (value === undefined || value === null || value === "") continue;
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return 0;
};

const resolveInputUnitPrice = (item = {}, fallback = {}) => {
  const itemPrice = firstPositiveMoney(
    item.unit_price,
    item.unitPrice,
    item.price,
    item.sale_price,
    item.salePrice,
    item.final_price,
    item.finalPrice,
    item.variant_price,
    item.variantPrice,
    item.selling_price,
    item.sellingPrice,
    item.product_price,
    item.productPrice,
    item.line_unit_price,
    item.lineUnitPrice
  );
  if (itemPrice > 0) return itemPrice;
  const fallbackPrice = firstPositiveMoney(
    fallback.unit_price,
    fallback.price,
    fallback.sale_price,
    fallback.selling_price,
    fallback.regular_price,
    fallback.product_price,
    fallback.product_sale_price
  );
  if (fallbackPrice > 0) return fallbackPrice;
  return firstFiniteMoney(item.unit_price, item.unitPrice, item.price, item.sale_price, item.salePrice, fallback.price, fallback.sale_price);
};

const resolveInputLineTotal = (item = {}, unitPrice = 0) => {
  const explicit = firstPositiveMoney(item.line_total, item.lineTotal, item.total, item.subtotal, item.item_total, item.itemTotal, item.total_amount, item.totalAmount);
  if (explicit > 0) return explicit;
  const quantity = Math.max(1, Number(item.quantity || item.qty || 1) || 1);
  const discount = Math.max(0, Number(item.discount_amount ?? item.discount ?? 0) || 0);
  return Math.max(0, Number(unitPrice || 0) * quantity - discount);
};

const normalizeOrderItemPayload = (item = {}) => {
  const quantity = toFiniteNumber(firstValue(item.quantity, item.qty), 0);
  const price = resolveInputUnitPrice(item);
  const discountAmount = toFiniteNumber(firstValue(item.discount_amount, item.discountAmount), 0);
  const lineTotal = resolveInputLineTotal(item, price);
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
    sale_price: price,
    discount_amount: discountAmount,
    line_total: lineTotal,
    subtotal: lineTotal,
    total_amount: lineTotal,
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
    seller_user_id: firstValue(body.seller_user_id, body.sellerUserId) || null,
    cashier_user_id: firstValue(body.cashier_user_id, body.cashierUserId, body.cashier_id, body.cashierId) || null,
    cashier_id: firstValue(body.cashier_id, body.cashierId) || null,
    sales_employee_id: firstValue(body.sales_employee_id, body.salesEmployeeId, body.assigned_seller_id, body.assignedSellerId, body.seller_employee_id, body.sellerEmployeeId, body.seller_id, body.sellerId) || null,
    salesperson_id: firstValue(body.salesperson_id, body.salespersonId, body.sales_employee_id, body.salesEmployeeId, body.assigned_seller_id, body.assignedSellerId, body.seller_employee_id, body.sellerEmployeeId, body.seller_id, body.sellerId) || null,
    assigned_seller_id: firstValue(body.assigned_seller_id, body.assignedSellerId, body.sales_employee_id, body.salesEmployeeId, body.salesperson_id, body.salespersonId, body.seller_employee_id, body.sellerEmployeeId, body.seller_id, body.sellerId) || null,
    seller_employee_id: firstValue(body.seller_employee_id, body.sellerEmployeeId, body.sales_employee_id, body.salesEmployeeId, body.salesperson_id, body.salespersonId, body.assigned_seller_id, body.assignedSellerId, body.seller_id, body.sellerId) || null,
    shift_id: firstValue(body.shift_id, body.shiftId) || null,
    attendance_log_id: firstValue(body.attendance_log_id, body.attendanceLogId) || null,
    subtotal: firstValue(body.subtotal, body.sub_total),
    discount_amount: firstValue(body.discount_amount, body.discountAmount, body.discount),
    invoice_discount_type: firstValue(body.invoice_discount_type, body.invoiceDiscountType),
    invoice_discount_value: firstValue(body.invoice_discount_value, body.invoiceDiscountValue),
    invoice_discount_amount: firstValue(body.invoice_discount_amount, body.invoiceDiscountAmount),
    invoice_discount_reason: firstValue(body.invoice_discount_reason, body.invoiceDiscountReason),
    tax_amount: firstValue(body.tax_amount, body.taxAmount, body.tax),
    service_fee: firstValue(body.service_fee, body.serviceFee, body.shipping_fee, body.shippingFee),
    paid_amount: firstValue(body.paid_amount, body.paidAmount),
    change_amount: firstValue(body.change_amount, body.changeAmount),
    exchange_mode: body.exchange_mode ?? body.exchangeMode ?? false,
    original_order_id: firstValue(body.original_order_id, body.originalOrderId) || null,
    exchange_credit_amount: firstValue(body.exchange_credit_amount, body.exchangeCreditAmount),
    new_order_total: firstValue(body.new_order_total, body.newOrderTotal),
    amount_due_now: firstValue(body.amount_due_now, body.amountDueNow),
    exchange_difference: firstValue(body.exchange_difference, body.exchangeDifference),
    exchange_invoice_number: firstValue(body.exchange_invoice_number, body.exchangeInvoiceNumber),
    items: rawItems.map(normalizeOrderItemPayload),
  };
};

const normalizeReturnedOrderItems = (order = {}, rawItems = []) => {
  const items = Array.isArray(rawItems) ? rawItems : [];
  const orderTotal = firstPositiveMoney(order.total_amount, order.total, order.total_price, order.subtotal);
  return items.map((item) => {
    const quantity = Math.max(1, Number(item.quantity || item.qty || 1) || 1);
    const storedUnitPrice = firstPositiveMoney(
      item.unit_price,
      item.unitPrice,
      item.sale_price,
      item.price,
      item.stored_price,
      item.selling_price,
      item.line_unit_price
    );
    const storedLineTotal = firstPositiveMoney(item.line_total, item.lineTotal, item.total, item.subtotal, item.item_total, item.total_amount);
    const catalogUnitPrice = firstPositiveMoney(
      item.variant_price,
      item.variant_sale_price,
      item.product_price,
      item.product_sale_price
    );
    let unitPrice = storedUnitPrice;
    let lineTotal = storedLineTotal;
    let priceSource = storedUnitPrice > 0 || storedLineTotal > 0 ? "stored" : "missing";

    if (!(unitPrice > 0) && items.length === 1 && orderTotal > 0) {
      unitPrice = orderTotal / quantity;
      lineTotal = orderTotal;
      priceSource = "order_total_fallback";
    } else if (!(unitPrice > 0) && catalogUnitPrice > 0) {
      unitPrice = catalogUnitPrice;
      lineTotal = catalogUnitPrice * quantity;
      priceSource = "variant_fallback";
    }

    if (!(lineTotal > 0) && unitPrice > 0) {
      lineTotal = unitPrice * quantity;
    }

    return {
      ...item,
      quantity,
      unit_price: unitPrice || 0,
      unitPrice: unitPrice || 0,
      price: unitPrice || 0,
      sale_price: unitPrice || 0,
      line_total: lineTotal || 0,
      lineTotal: lineTotal || 0,
      subtotal: lineTotal || 0,
      item_total: lineTotal || 0,
      price_source: priceSource,
    };
  });
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

  return resolveBackendRequestOrigin(req);
};

const resolveBackendRequestOrigin = (req) => {
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

const resolvePublicAssetOrigin = (req) => {
  const envOrigin = String(
    process.env.PUBLIC_BACKEND_URL ||
      process.env.PUBLIC_API_URL ||
      process.env.BACKEND_URL ||
      ""
  ).trim().replace(/\/$/, "");
  if (envOrigin) return envOrigin;
  return resolveBackendRequestOrigin(req).replace(/\/$/, "");
};

const toPublicUploadUrl = (req, value) => {
  const imageUrl = String(value || "").trim();
  if (!imageUrl) return "";
  if (/^(https?:|data:|blob:)/i.test(imageUrl)) return imageUrl;

  const origin = resolvePublicAssetOrigin(req);
  const cleanPath = imageUrl.replace(/^\/+/, "");
  const uploadPath = cleanPath.startsWith("uploads/")
    ? cleanPath
    : cleanPath.startsWith("products/")
      ? `uploads/${cleanPath}`
      : cleanPath.startsWith("public/")
        ? cleanPath
        : `uploads/products/${cleanPath}`;

  return origin ? `${origin}/${uploadPath}` : `/${uploadPath}`;
};

const decodePublicInvoiceIdentifier = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    return decodeURIComponent(raw).trim();
  } catch {
    return raw;
  }
};

const publicInvoiceIdentifier = (invoice = {}) =>
  String(
    invoice.invoice_number ||
      invoice.order_number ||
      invoice.invoice_code ||
      invoice.public_code ||
      invoice.code ||
      invoice.public_order_number ||
      invoice.display_order_number ||
      invoice.public_token ||
      ""
  ).trim();

const logPublicInvoiceLookup = ({ requestedInvoice, matchedBy = null, invoiceId = null, found = false }) => {
  console.log("[public-invoice-lookup]", {
    requested_invoice: requestedInvoice || "",
    matched_by: matchedBy || null,
    invoice_id: invoiceId || null,
    found: Boolean(found),
  });
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

const loadPublicInvoiceByToken = async (token, req = null) => {
  const requestedInvoice = decodePublicInvoiceIdentifier(token);
  if (!requestedInvoice) {
    logPublicInvoiceLookup({ requestedInvoice, found: false });
    return null;
  }

  const orderColumns = await getTableColumnSet(db, "orders").catch((error) => {
    console.error("[public-invoice-lookup] failed to inspect order columns", error?.message || error);
    return new Set();
  });

  const lookupFields = [
    "invoice_number",
    "order_number",
    "invoice_code",
    "public_code",
    "code",
    "public_order_number",
    "display_order_number",
    "public_token",
  ].filter((field) => orderColumns.has(field));

  if (!lookupFields.length) {
    logPublicInvoiceLookup({ requestedInvoice, found: false });
    return null;
  }

  const optionalTextColumn = (field) =>
    orderColumns.has(field) ? `o.${field}` : `NULL::text`;
  const lookupConditions = lookupFields
    .map((field) => `LOWER(TRIM(o.${field}::text)) = LOWER(TRIM($1::text))`)
    .join(" OR\n        ");
  const matchedByCase = lookupFields
    .map((field) => `WHEN LOWER(TRIM(o.${field}::text)) = LOWER(TRIM($1::text)) THEN '${field}'`)
    .join("\n        ");
  const publicEnabledCondition = orderColumns.has("invoice_public_enabled")
    ? "AND COALESCE(o.invoice_public_enabled, TRUE) = TRUE"
    : "";
  const invoicePriorityOrder = orderColumns.has("invoice_number")
    ? "WHEN o.invoice_number IS NOT NULL AND LOWER(TRIM(o.invoice_number::text)) = LOWER(TRIM($1::text)) THEN 0"
    : "WHEN FALSE THEN 0";

  const orderResult = await db.query(
    `
    SELECT
      o.id,
      o.tenant_id,
      ${optionalTextColumn("invoice_number")} AS invoice_number,
      ${optionalTextColumn("order_number")} AS order_number,
      ${optionalTextColumn("invoice_code")} AS invoice_code,
      ${optionalTextColumn("public_code")} AS public_code,
      ${optionalTextColumn("code")} AS code,
      ${optionalTextColumn("public_order_number")} AS public_order_number,
      ${optionalTextColumn("display_order_number")} AS display_order_number,
      ${optionalTextColumn("public_token")} AS public_token,
      ${orderColumns.has("invoice_public_enabled") ? "o.invoice_public_enabled" : "TRUE"} AS invoice_public_enabled,
      o.customer_id,
      o.customer_name AS order_customer_name,
      o.status,
      o.payment_status,
      o.subtotal,
      o.discount_amount,
      o.invoice_discount_type,
      o.invoice_discount_value,
      o.invoice_discount_amount,
      o.invoice_discount_reason,
      o.coupon_code,
      o.coupon_discount_amount,
      o.tax_amount,
      o.service_fee,
      o.total,
      o.paid_amount,
      o.payment_method,
      ${orderColumns.has("exchange_mode") ? "COALESCE(o.exchange_mode, FALSE)" : "FALSE"} AS exchange_mode,
      ${orderColumns.has("original_order_id") ? "o.original_order_id" : "NULL"} AS original_order_id,
      ${orderColumns.has("exchange_credit_amount") ? "COALESCE(o.exchange_credit_amount, 0)" : "0"} AS exchange_credit_amount,
      ${orderColumns.has("new_order_total") ? "COALESCE(o.new_order_total, o.total, 0)" : "COALESCE(o.total, 0)"} AS new_order_total,
      ${orderColumns.has("amount_due_now") ? "COALESCE(o.amount_due_now, o.paid_amount, 0)" : "COALESCE(o.paid_amount, 0)"} AS amount_due_now,
      ${orderColumns.has("exchange_difference") ? "COALESCE(o.exchange_difference, 0)" : "0"} AS exchange_difference,
      ${orderColumns.has("exchange_invoice_number") ? "COALESCE(o.exchange_invoice_number, '')" : "''"} AS exchange_invoice_number,
      o.created_at,
      b.name AS branch_name,
      b.code AS branch_code,
      b.address AS branch_address,
      b.phone AS branch_phone,
      c.name AS customer_record_name,
      c.phone AS customer_record_phone,
      CASE
        ${matchedByCase}
        ELSE NULL
      END AS public_lookup_matched_by
    FROM orders o
    LEFT JOIN branches b ON b.id = o.branch_id
    LEFT JOIN customers c ON c.id = o.customer_id
    WHERE (
        ${lookupConditions}
      )
      ${publicEnabledCondition}
    ORDER BY CASE
      ${invoicePriorityOrder}
      ELSE 1
    END,
    o.id DESC
    LIMIT 1
    `,
    [requestedInvoice]
  );

  const order = orderResult.rows[0] || null;
  logPublicInvoiceLookup({
    requestedInvoice,
    matchedBy: order?.public_lookup_matched_by || null,
    invoiceId: order?.id || null,
    found: Boolean(order),
  });
  if (!order) return null;

  const itemsResult = await db.query(
    `
    SELECT
      oi.product_id,
      oi.variant_id,
      oi.product_name,
      oi.variant_name,
      oi.quantity,
      oi.sale_price,
      oi.discount_amount,
      oi.total_amount,
      COALESCE(
        NULLIF(oi.variant_image, ''),
        NULLIF(pv.image_url, ''),
        NULLIF(pvi.image_url, ''),
        NULLIF(oi.product_image, ''),
        NULLIF(oi.image_url, ''),
        NULLIF(p.image_url, ''),
        ''
      ) AS image_url,
      COALESCE(NULLIF(oi.product_image, ''), NULLIF(p.image_url, ''), '') AS product_image,
      COALESCE(NULLIF(oi.variant_image, ''), NULLIF(pv.image_url, ''), NULLIF(pvi.image_url, ''), '') AS variant_image,
      COALESCE(p.gallery_images, '[]'::jsonb) AS product_images,
      COALESCE(pvi.images, '[]'::jsonb) AS variant_images,
      jsonb_build_object(
        'id', p.id,
        'image', COALESCE(NULLIF(p.image_url, ''), ''),
        'image_url', COALESCE(NULLIF(p.image_url, ''), ''),
        'images', COALESCE(p.gallery_images, '[]'::jsonb)
      ) AS product,
      jsonb_build_object(
        'id', pv.id,
        'image', COALESCE(NULLIF(pv.image_url, ''), NULLIF(pvi.image_url, ''), ''),
        'image_url', COALESCE(NULLIF(pv.image_url, ''), NULLIF(pvi.image_url, ''), ''),
        'images', COALESCE(pvi.images, '[]'::jsonb),
        'color', pv.color,
        'size', pv.size
      ) AS variant
    FROM order_items oi
    LEFT JOIN product_variants pv ON oi.variant_id = pv.id
    LEFT JOIN products p ON COALESCE(oi.product_id, pv.product_id) = p.id
    LEFT JOIN LATERAL (
      SELECT
        (array_agg(image_url ORDER BY is_primary DESC, sort_order ASC, id ASC))[1] AS image_url,
        COALESCE(jsonb_agg(image_url ORDER BY is_primary DESC, sort_order ASC, id ASC) FILTER (WHERE NULLIF(image_url, '') IS NOT NULL), '[]'::jsonb) AS images
      FROM product_variant_images pvi
      WHERE NULLIF(pvi.image_url, '') IS NOT NULL
        AND (
          pvi.variant_id = pv.id
          OR (
            pvi.product_id = p.id
            AND (
              NULLIF(pvi.color_name, '') IS NULL
              OR LOWER(pvi.color_name) = LOWER(COALESCE(pv.color, ''))
            )
          )
        )
    ) pvi ON TRUE
    WHERE oi.order_id = $1
    ORDER BY oi.id ASC
    `,
    [order.id]
  );

  const customerName = order.order_customer_name || order.customer_record_name || "Walk-in Customer";
  const customerPhone = order.customer_record_phone || "";
  const identifier = publicInvoiceIdentifier(order);
  const publicInvoiceUrl = buildPublicInvoiceUrl(req, identifier);
  const shortInvoiceUrl = buildShortPublicInvoiceUrl(req, identifier);
  const publicImageValue = (value) => {
    if (!value) return "";
    if (typeof value === "object") return toPublicUploadUrl(req, value.image || value.image_url || value.url || value.path || value.secure_url || "");
    return toPublicUploadUrl(req, value);
  };
  const publicImageArray = (value) => (Array.isArray(value) ? value.map(publicImageValue).filter(Boolean) : []);
  const items = itemsResult.rows.map((item) => ({
    product_id: item.product_id || item.product?.id || null,
    variant_id: item.variant_id || item.variant?.id || null,
    name: item.product_name || "Item",
    variant: item.variant_name || "Default",
    quantity: Number(item.quantity || 0),
    price: normalizeInvoiceMoney(item.sale_price),
    discount: normalizeInvoiceMoney(item.discount_amount),
    total: normalizeInvoiceMoney(item.total_amount),
    image_url: toPublicUploadUrl(req, item.image_url || ""),
    product_image: toPublicUploadUrl(req, item.product_image || ""),
    variant_image: toPublicUploadUrl(req, item.variant_image || ""),
    product_images: publicImageArray(item.product_images),
    variant_images: publicImageArray(item.variant_images),
    product: {
      ...(item.product || {}),
      image: toPublicUploadUrl(req, item.product?.image || ""),
      image_url: toPublicUploadUrl(req, item.product?.image_url || ""),
      images: publicImageArray(item.product?.images),
    },
    variant: {
      ...(item.variant || {}),
      image: toPublicUploadUrl(req, item.variant?.image || ""),
      image_url: toPublicUploadUrl(req, item.variant?.image_url || ""),
      images: publicImageArray(item.variant?.images),
    },
  }));

  return {
    invoice_number: order.invoice_number,
    order_number: order.order_number || "",
    invoice_code: order.invoice_code || "",
    public_code: order.public_code || "",
    code: order.code || "",
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
      branch_name: order.branch_name || "",
      branch_code: order.branch_code || "",
      branch_address: order.branch_address || "",
      branch_phone: order.branch_phone || "",
    },
    customer: {
      name: customerName,
      phone: customerPhone,
    },
    items,
    totals: {
      subtotal: normalizeInvoiceMoney(order.subtotal),
      discount: normalizeInvoiceMoney(order.discount_amount),
      invoice_discount_type: order.invoice_discount_type || "",
      invoice_discount_value: normalizeInvoiceMoney(order.invoice_discount_value),
      invoice_discount_amount: normalizeInvoiceMoney(order.invoice_discount_amount),
      invoice_discount_reason: order.invoice_discount_reason || "",
      coupon_code: order.coupon_code || "",
      coupon_discount: normalizeInvoiceMoney(order.coupon_discount_amount),
      tax: 0,
      service: normalizeInvoiceMoney(order.service_fee),
      total: normalizeInvoiceMoney(order.total),
      paid: normalizeInvoiceMoney(order.paid_amount),
      payment_method: order.payment_method || "n/a",
      exchange_mode: Boolean(order.exchange_mode),
      original_order_id: order.original_order_id || null,
      exchange_invoice_number: order.exchange_invoice_number || "",
      new_items_total: normalizeInvoiceMoney(order.new_order_total || order.total),
      exchange_credit: normalizeInvoiceMoney(order.exchange_credit_amount),
      amount_paid_now: normalizeInvoiceMoney(order.amount_due_now || order.paid_amount),
      exchange_difference: normalizeInvoiceMoney(order.exchange_difference),
    },
    exchange: Boolean(order.exchange_mode) ? {
      original_order_id: order.original_order_id || null,
      invoice_number: order.exchange_invoice_number || "",
      new_items_total: normalizeInvoiceMoney(order.new_order_total || order.total),
      credit: normalizeInvoiceMoney(order.exchange_credit_amount),
      paid_now: normalizeInvoiceMoney(order.amount_due_now || order.paid_amount),
      remaining_customer_credit: Math.max(0, normalizeInvoiceMoney(order.exchange_credit_amount) - normalizeInvoiceMoney(order.new_order_total || order.total)),
    } : null,
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

const resolveActiveUserPosShift = async (client, { tenantId, userId, branchId, shiftId }) => {
  const shift = await getCurrentCashDrawerShift(client, { tenantId, userId, branchId });
  if (shiftId && shift && String(shift.id) !== String(shiftId)) return null;
  return shift;
};

const validateSellerUser = async (client, { tenantId, sellerUserId, branchId }) => {
  const userResult = await client.query(
    `
    SELECT id, name, email
    FROM users
    WHERE id = $1
      AND ($2::bigint IS NULL OR tenant_id = $2::bigint)
    LIMIT 1
    `,
    [sellerUserId, tenantId]
  );
  const user = userResult.rows[0] || null;
  if (!user) return null;

  const mappedCount = await client.query(
    `
    SELECT COUNT(*)::int AS count
    FROM employees
    WHERE ($1::bigint IS NULL OR tenant_id = $1::bigint)
      AND status = 'active'
      AND branch_id IS NOT NULL
      AND user_id IS NOT NULL
    `,
    [tenantId]
  ).catch(() => ({ rows: [{ count: 0 }] }));

  let employee = null;
  if (branchId) {
    const branchMatch = await client.query(
      `
      SELECT e.id AS employee_id, e.full_name AS employee_name, e.branch_id, e.user_id
      FROM employees e
      WHERE ($1::bigint IS NULL OR tenant_id = $1::bigint)
        AND status = 'active'
        AND is_deleted IS DISTINCT FROM TRUE
        AND branch_id = $2
        AND (
          user_id = $3::bigint
          OR LOWER(COALESCE(email, '')) = LOWER($4)
        )
      LIMIT 1
      `,
      [tenantId, branchId, sellerUserId, user.email || ""]
    ).catch(() =>
      client.query(
        `
        SELECT e.id AS employee_id, e.full_name AS employee_name, e.branch_id, e.user_id
        FROM employees e
        WHERE ($1::bigint IS NULL OR tenant_id = $1::bigint)
          AND status = 'active'
          AND is_deleted IS DISTINCT FROM TRUE
          AND branch_id = $2
          AND LOWER(COALESCE(email, '')) = LOWER($3)
        LIMIT 1
        `,
        [tenantId, branchId, user.email || ""]
      )
    );
    employee = branchMatch.rows[0] || null;
    if (Number(mappedCount.rows[0]?.count || 0) > 0 && !employee) return null;
  }

  return { ...user, employee_id: employee?.employee_id || null, employee_name: employee?.employee_name || null, branch_id: employee?.branch_id || branchId || null };
};

const normalizeVariationMode = (value) => String(value || "full_variations").trim().toLowerCase();
const isFullVariationMode = (value) => normalizeVariationMode(value) === "full_variations";
const isRealId = (value) => value !== undefined && value !== null && value !== "" && !String(value).startsWith("product:");

const getOrderItemLabel = (item = {}) =>
  item.product_name || item.name || item.variant_name || `product ${item.product_id || "unknown"}`;

const withPaymentProofAliases = (order = {}) => {
  const proofUrl = String(
    order.shipping_payment_screenshot ||
    order.payment_proof_url ||
    order.shipping_proof_url ||
    order.proof_image_url ||
    order.payment_screenshot_url ||
    ""
  ).trim();
  return {
    ...order,
    shipping_payment_screenshot: proofUrl,
    payment_proof_url: proofUrl,
    shipping_proof_url: proofUrl,
    proof_image_url: proofUrl,
    payment_screenshot_url: proofUrl,
  };
};

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
    warehouseId: data.warehouseId ?? null,
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
        AND pv.is_active IS DISTINCT FROM FALSE
        AND pv.deleted_at IS NULL
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

  const sku = String(item.sku || "").trim();
  const barcode = String(item.barcode || "").trim();
  const color = String(item.color || "").trim();
  const size = String(item.size || "").trim();

  if (productId && (sku || barcode || color || size)) {
    const lookupResult = await client.query(
      `
      SELECT
        pv.*,
        p.category_id,
        p.variation_mode,
        p.name AS product_name
      FROM product_variants pv
      JOIN products p ON p.id = pv.product_id
      WHERE pv.product_id = $1
        AND pv.is_active IS DISTINCT FROM FALSE
        AND pv.deleted_at IS NULL
        AND ($2::bigint IS NULL OR pv.tenant_id = $2::bigint OR pv.tenant_id IS NULL)
        AND ($3::text = '' OR pv.sku = $3::text)
        AND ($4::text = '' OR pv.barcode = $4::text)
        AND ($5::text = '' OR LOWER(COALESCE(pv.color, '')) = LOWER($5::text))
        AND ($6::text = '' OR LOWER(COALESCE(pv.size, '')) = LOWER($6::text))
      ORDER BY
        CASE WHEN $3::text <> '' AND pv.sku = $3::text THEN 0 ELSE 1 END,
        CASE WHEN $4::text <> '' AND pv.barcode = $4::text THEN 0 ELSE 1 END,
        pv.id ASC
      LIMIT 1
      `,
      [productId, tenantId, sku, barcode, color, size]
    );

    const matchedVariant = lookupResult.rows[0] || null;
    if (matchedVariant) {
      return {
        type: "variant",
        productId: matchedVariant.product_id,
        variantId: matchedVariant.id,
        categoryId: matchedVariant.category_id || null,
        costPrice: Number(matchedVariant.cost_price || 0),
        stock: Number(matchedVariant.stock || 0),
        record: matchedVariant,
      };
    }
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
      AND pv.is_active IS DISTINCT FROM FALSE
      AND pv.deleted_at IS NULL
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

const resolveOrderLinesStockBatch = async (client, { tenantId, items = [] } = {}) => {
  const lineInputs = items.map((item, index) => {
    const productId = item.product_id || item.productId ? Number(item.product_id || item.productId) : null;
    const variantId = isRealId(item.variant_id ?? item.variantId) ? Number(item.variant_id ?? item.variantId) : null;
    const requiresLegacyLookup = !variantId && (
      String(item.sku || "").trim() ||
      String(item.barcode || "").trim() ||
      String(item.color || "").trim() ||
      String(item.size || "").trim()
    );
    return { index, item, productId, variantId, quantity: Number(item.quantity || 0), requiresLegacyLookup };
  });

  if (lineInputs.some((line) => line.requiresLegacyLookup)) {
    const fallback = new Map();
    for (const line of lineInputs) {
      fallback.set(String(line.index), await resolveOrderLineStock(client, { tenantId, item: line.item }));
    }
    return fallback;
  }

  const variantIds = [...new Set(lineInputs.map((line) => line.variantId).filter(Boolean))];
  const productIds = [...new Set(lineInputs.filter((line) => !line.variantId).map((line) => line.productId).filter(Boolean))];
  const variantById = new Map();
  const productById = new Map();

  if (variantIds.length) {
    const variantResult = await client.query(
      `
      SELECT
        pv.*,
        p.category_id,
        p.variation_mode,
        p.name AS product_name
      FROM product_variants pv
      JOIN products p ON p.id = pv.product_id
      WHERE pv.id = ANY($1::bigint[])
        AND pv.is_active IS DISTINCT FROM FALSE
        AND pv.deleted_at IS NULL
        AND ($2::bigint IS NULL OR pv.tenant_id = $2::bigint OR pv.tenant_id IS NULL)
      FOR UPDATE OF pv
      `,
      [variantIds, tenantId]
    );
    variantResult.rows.forEach((row) => variantById.set(Number(row.id), row));
  }

  if (productIds.length) {
    const productResult = await client.query(
      `
      SELECT id, category_id, variation_mode, stock, cost_price, price, sale_price, name
      FROM products
      WHERE id = ANY($1::bigint[])
        AND ($2::bigint IS NULL OR tenant_id = $2::bigint)
      FOR UPDATE
      `,
      [productIds, tenantId]
    );
    productResult.rows.forEach((row) => productById.set(Number(row.id), row));
  }

  const stockByLineKey = new Map();
  const requiredByStockKey = new Map();

  for (const line of lineInputs) {
    let stockLine = null;
    if (line.variantId) {
      const variant = variantById.get(line.variantId);
      if (!variant) {
        const error = new Error("Variant not found");
        error.status = 400;
        throw error;
      }
      if (line.productId && String(variant.product_id) !== String(line.productId)) {
        const error = new Error(`Variant ${line.variantId} was not found for product ${line.productId}. Check product_variants mapping.`);
        error.status = 400;
        throw error;
      }
      stockLine = {
        type: "variant",
        productId: variant.product_id,
        variantId: variant.id,
        categoryId: variant.category_id || null,
        costPrice: Number(variant.cost_price || 0),
        stock: Number(variant.stock || 0),
        record: variant,
      };
    } else {
      const product = productById.get(line.productId);
      if (!product) {
        const error = new Error(`Product not found for ${getOrderItemLabel(line.item)} (product_id=${line.productId || "n/a"})`);
        error.status = 400;
        throw error;
      }
      const productMode = normalizeVariationMode(product.variation_mode || line.item.variation_mode || line.item.variationMode);
      if (isFullVariationMode(productMode)) {
        return resolveOrderLinesStockBatchLegacy(client, { tenantId, items });
      }
      stockLine = {
        type: "product",
        productId: product.id,
        variantId: null,
        categoryId: product.category_id || null,
        costPrice: Number(product.cost_price || 0),
        stock: Number(product.stock || 0),
        record: product,
      };
    }

    const stockKey = `${stockLine.type}:${stockLine.variantId || stockLine.productId}`;
    requiredByStockKey.set(stockKey, (requiredByStockKey.get(stockKey) || 0) + line.quantity);
    stockByLineKey.set(String(line.index), stockLine);
  }

  for (const [stockKey, requiredQuantity] of requiredByStockKey.entries()) {
    const line = [...stockByLineKey.values()].find((value) => `${value.type}:${value.variantId || value.productId}` === stockKey);
    if (line && Number(line.stock || 0) < requiredQuantity) {
      const error = new Error(`Not enough stock for ${stockKey}`);
      error.status = 400;
      throw error;
    }
  }

  return stockByLineKey;
};

const resolveOrderLinesStockBatchLegacy = async (client, { tenantId, items = [] } = {}) => {
  const stockByLineKey = new Map();
  for (const [index, item] of items.entries()) {
    stockByLineKey.set(String(index), await resolveOrderLineStock(client, { tenantId, item }));
  }
  return stockByLineKey;
};

const bulkInsertOrderItems = async (client, { tenantId, orderId, items = [], stockByLineKey, orderTotal = 0 }) => {
  if (!items.length) return [];
  const availableColumns = await getTableColumnSet(client, "order_items");
  const insertItems = items.map((item, index) => {
    const stockLine = stockByLineKey.get(String(index)) || {};
    const quantity = Number(item.quantity || 0);
    let unitPrice = resolveInputUnitPrice(item, stockLine.record || {});
    let lineTotal = resolveInputLineTotal(item, unitPrice);
    let priceSource = unitPrice > 0 ? "payload" : "missing";
    if (!(unitPrice > 0) && items.length === 1 && Number(orderTotal || 0) > 0) {
      unitPrice = Number(orderTotal) / Math.max(1, quantity || 1);
      lineTotal = Number(orderTotal);
      priceSource = "order_total_fallback";
    } else if (unitPrice > 0 && !(Number(item.price || item.unit_price || item.sale_price || 0) > 0)) {
      priceSource = "variant_fallback";
    }
    if (POS_DEBUG && !(unitPrice > 0) && Number(orderTotal || 0) > 0) {
      console.warn("[pos-order-item-price-warning]", {
        orderId,
        product_id: item.product_id || stockLine.productId || null,
        variant_id: item.variant_id || stockLine.variantId || null,
        quantity,
        orderTotal,
      });
    }
    return {
      ...item,
      tenant_id: tenantId == null ? null : Number(tenantId),
      order_id: Number(orderId),
      variant_id: stockLine.variantId == null ? null : Number(stockLine.variantId),
      product_id: Number(stockLine.productId || item.product_id || 0) || null,
      quantity,
      sale_price: unitPrice,
      unit_price: unitPrice,
      price: unitPrice,
      tax_amount: 0,
      total_amount: lineTotal,
      line_total: lineTotal,
      subtotal: lineTotal,
      price_source: priceSource,
    };
  });
  const query = buildBulkOrderItemInsertQuery(insertItems, {
    availableColumns,
    returning: true,
    filePath: "server/controllers/ordersController.js",
    routeName: "createOrder",
    insertLabel: "bulkInsertOrderItems",
    sqlSnippetLabel: "pos_order_items_bulk_insert",
  });
  let result;
  try {
    result = await client.query(query.sql, query.params);
  } catch (error) {
    throw enrichOrderItemsInsertError(error, {
      routeName: "createOrder",
      insertLabel: "bulkInsertOrderItems",
      columnsCount: query.columns.length,
      paramsCount: query.params.length,
      sqlSnippetLabel: "pos_order_items_bulk_insert",
    });
  }
  return result.rows;
};

const bulkApplyInventoryChanges = async (client, { tenantId, orderId, items = [], stockByLineKey, branchId, createdBy }) => {
  const numericTenantId = tenantId == null ? null : Number(tenantId);
  if (!Number.isFinite(numericTenantId) || numericTenantId <= 0) {
    throw Object.assign(new Error("Tenant context missing"), { status: 400, code: "TENANT_CONTEXT_MISSING" });
  }
  const numericOrderId = Number(orderId);
  const numericBranchId = branchId == null || branchId === "" ? null : Number(branchId);
  const numericCreatedBy = createdBy == null || createdBy === "" ? null : Number(createdBy);
  const movementsByKey = new Map();
  for (const [index, item] of items.entries()) {
    const stockLine = stockByLineKey.get(String(index));
    if (!stockLine) continue;
    const key = `${stockLine.type}:${stockLine.variantId || stockLine.productId}`;
    const current = movementsByKey.get(key) || {
      ...stockLine,
      quantity: 0,
      quantityBefore: Number(stockLine.stock || 0),
    };
    current.quantity += Number(item.quantity || 0);
    movementsByKey.set(key, current);
  }

  const movements = [...movementsByKey.values()].map((line) => ({
    ...line,
    quantityChange: -Math.abs(Number(line.quantity || 0)),
    quantityAfter: Number(line.quantityBefore || 0) - Math.abs(Number(line.quantity || 0)),
  }));
  if (!movements.length) return;

  const variantMovements = movements.filter((line) => line.type === "variant");
  const productMovements = movements.filter((line) => line.type === "product");

  if (variantMovements.length) {
    await client.query(
      `
      UPDATE product_variants AS pv
      SET stock = data.quantity_after,
          updated_at = NOW()
      FROM (
        SELECT * FROM UNNEST($1::bigint[], $2::numeric[])
          AS t(id, quantity_after)
      ) AS data
      WHERE pv.id = data.id
        AND ($3::bigint IS NULL OR pv.tenant_id = $3::bigint OR pv.tenant_id IS NULL)
      `,
      [variantMovements.map((line) => Number(line.variantId)), variantMovements.map((line) => Number(line.quantityAfter)), numericTenantId]
    );
  }

  if (productMovements.length) {
    await client.query(
      `
      UPDATE products AS p
      SET stock = data.quantity_after,
          updated_at = NOW()
      FROM (
        SELECT * FROM UNNEST($1::bigint[], $2::numeric[])
          AS t(id, quantity_after)
      ) AS data
      WHERE p.id = data.id
        AND ($3::bigint IS NULL OR p.tenant_id = $3::bigint)
      `,
      [productMovements.map((line) => Number(line.productId)), productMovements.map((line) => Number(line.quantityAfter)), numericTenantId]
    );
  }

  const movementValues = [];
  const movementPlaceholders = movements.map((line) => {
    const base = movementValues.length;
    const quantityChange = Number(line.quantityChange || 0);
    movementValues.push(
      numericTenantId,
      line.productId == null ? null : Number(line.productId),
      line.variantId == null ? null : Number(line.variantId),
      numericBranchId,
      "sale",
      quantityChange,
      Number(line.quantityBefore || 0),
      Number(line.quantityAfter || 0),
      line.costPrice == null ? null : Number(line.costPrice),
      Number(line.costPrice || 0) * Math.abs(quantityChange),
      "order",
      numericOrderId,
      "POS sale",
      `Sale from order ${numericOrderId}`,
      numericCreatedBy
    );
    return `($${base + 1}::bigint,$${base + 2}::bigint,$${base + 3}::bigint,$${base + 4}::bigint,$${base + 5}::text,$${base + 6}::numeric,$${base + 7}::numeric,$${base + 8}::numeric,$${base + 9}::numeric,$${base + 10}::numeric,$${base + 11}::text,$${base + 12}::bigint,$${base + 13}::text,$${base + 14}::text,$${base + 14}::text,$${base + 15}::bigint)`;
  });

  await client.query(
    `
    INSERT INTO inventory_movements (
      tenant_id, product_id, variant_id, branch_id, movement_type, quantity,
      before_qty, after_qty, quantity_before, quantity_change, quantity_after,
      unit_cost, total_cost, reference_type, reference_id, reason, notes, note, created_by
    )
    SELECT tenant_id::bigint, product_id::bigint, variant_id::bigint, branch_id::bigint, movement_type, quantity,
      before_qty, after_qty, before_qty, quantity, after_qty,
      unit_cost, total_cost, reference_type, reference_id::bigint, reason, notes, note, created_by::bigint
    FROM (VALUES ${movementPlaceholders.join(",")})
      AS t(tenant_id, product_id, variant_id, branch_id, movement_type, quantity,
        before_qty, after_qty, unit_cost, total_cost, reference_type, reference_id, reason, notes, note, created_by)
    `,
    movementValues
  );
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
  order,
  orderItemsForCommission = [],
  resolvedCashierId = null,
  resolvedSalesEmployeeId = null,
  resolvedShiftId = null,
  resolvedCustomerId = null,
  receivedAmount = 0,
  status = "pending",
  paymentStatus = "unpaid",
  skipLoyaltyEarning = false,
  totalDiscount = 0,
  computedSubtotal = 0,
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
    async () => {
      await recordSalesCommissionForOrder(db, {
        tenantId,
        order,
        items: orderItemsForCommission,
        createdBy: req.user?.id || null,
      });
    },
    async () => {
      await recordEmployeeAnalytics(db, {
        tenantId,
        orderId,
        orderItems: orderItemsForCommission,
        cashierId: resolvedCashierId,
        salesEmployeeId: resolvedSalesEmployeeId,
        shiftId: resolvedShiftId,
        branchId: resolvedBranchId,
        paymentStatus,
        userId: req.user?.id || null,
      });
    },
    async () => {
      console.info("[pos-checkout:stock-decremented]", {
        order_id: orderId,
        tenant_id: tenantId,
        branch_id: resolvedBranchId || null,
        items_count: Array.isArray(orderItemsForCommission) ? orderItemsForCommission.length : 0,
      });
      const itemsCount = Array.isArray(orderItemsForCommission) ? orderItemsForCommission.length : 0;
      console.info("[display-refill-alert:invoke]", {
        order_id: orderId,
        tenant_id: tenantId,
        branch_id: resolvedBranchId || null,
        invoice_number: order?.invoice_number || null,
        seller_employee_id: resolvedSalesEmployeeId || null,
        seller_id: resolvedCashierId || null,
        items_count: itemsCount,
        order_items: orderItemsForCommission.slice(0, 5).map((item) => ({
          product_id: item.product_id || item.id || null,
          variant_id: item.variant_id || null,
          size: item.size || item.variant_size || null,
          color: item.color || item.variant_color || null,
          branch_id: resolvedBranchId || null,
          quantity: item.quantity || item.qty || item.sold_quantity || 1,
          stock_before: item.stock_before ?? item.stockBefore ?? null,
          stock_after: item.stock_after ?? item.stockAfter ?? null,
        })),
      });
      await createDisplayRefillAlertsForOrder({
        orderId,
        sellerEmployeeId: resolvedSalesEmployeeId,
        tenantId,
        order,
        items: orderItemsForCommission,
        req,
      })
        .then((createdAlerts = []) => {
          console.info("[display-refill-alert:invoke:done]", {
            order_id: orderId,
            tenant_id: tenantId,
            branch_id: resolvedBranchId || null,
            created_count: Array.isArray(createdAlerts) ? createdAlerts.length : null,
          });
        })
        .catch((error) => {
          console.error("[display-refill-alert:invoke:error]", {
            order_id: orderId,
            tenant_id: tenantId,
            branch_id: resolvedBranchId || null,
            error: error?.message || String(error),
          });
        });
    },
    async () => {
      if (skipLoyaltyEarning) return;
      await processOrderLoyalty(db, {
        tenantId,
        orderId,
        customerId: resolvedCustomerId || order?.customer_id,
        orderTotal: computedTotal,
        paidAmount: receivedAmount,
        status,
        paymentStatus,
        redeemPoints: 0,
        walletRedemptionAmount: 0,
        skipEarning: false,
        fullWalletRedemptionOnly: false,
        userId: req.user?.id || null,
      });
    },
    async () => {
      const discountRatio = Number(computedSubtotal || 0) > 0 ? Number(totalDiscount || 0) / Number(computedSubtotal || 0) : 0;
      if (discountRatio < 0.3) return;
      await createSystemNotification("security_sensitive_action", {
        tenant_id: tenantId,
        branch_id: resolvedBranchId,
        message: `خصم كبير على الطلب ${order.invoice_number || order.id}: ${Math.round(discountRatio * 100)}%`,
        action_url: `/orders/${order.id}`,
        entity_type: "order",
        entity_id: order.id,
        metadata: { order_id: order.id, discount_amount: totalDiscount, subtotal: computedSubtotal },
      });
    },
    async () => {
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
  let tenantId = null;
  let branchIdForLog = req.body?.branch_id || req.body?.branchId || null;
  const checkoutTiming = createCheckoutTimings();
  const markOrderStep = (step, details = {}) => {
    orderCreateStep = step;
    if (POS_CHECKOUT_DEBUG) console.log("[POS_CREATE_ORDER_STEP]", { step, ...details });
  };

  try {
    client = await db.connect();
    markOrderStep("db connected");
    await ensureAccountingSchema();
    tenantId = getTenantId(req, req.body?.tenant_id || req.body?.tenantId || req.query?.tenant_id || req.query?.tenantId || req.user?.tenant_id || req.user?.tenantId);
    const normalizedPayload = normalizeCreateOrderPayload(req.body || {});
    const {
      customer_name,
      customer_id,
      payment_method,
      items,
      status,
      payment_status,
      channel,
      subtotal,
      discount_amount,
      invoice_discount_type = null,
      invoice_discount_value = 0,
      invoice_discount_amount = 0,
      invoice_discount_reason = "",
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
      payment_breakdown = null,
      payments = null,
      skip_loyalty_earning = false,
      full_wallet_redemption_only = false,
      seller_user_id = null,
      seller_name = "",
      salesperson_name = "",
      cashier_user_id = null,
      cashier_id = null,
      sales_employee_id = null,
      salesperson_id = null,
      assigned_seller_id = null,
      seller_employee_id = null,
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
      financial_account_id = null,
      cash_financial_account_id = null,
      card_financial_account_id = null,
      wallet_financial_account_id = null,
      exchange_mode = false,
      original_order_id = null,
      exchange_credit_amount = 0,
      new_order_total = 0,
      amount_due_now = null,
      exchange_difference = 0,
      exchange_invoice_number = "",
    } = normalizedPayload;
    branchIdForLog = branch_id || branchIdForLog;
    const itemsCount = Array.isArray(items) ? items.length : 0;
    console.info("[pos-checkout:entered]", {
      tenant_id: tenantId || null,
      branch_id: branchIdForLog || null,
      user_id: req.user?.id || null,
      items_count: itemsCount,
      payment_method: payment_method || null,
      payment_status: payment_status || null,
    });
    console.info("[pos-checkout:items]", {
      order_items: (items || []).slice(0, 10).map((item) => ({
        product_id: item.product_id || null,
        variant_id: item.variant_id || null,
        color: item.color || item.variant_color || null,
        size: item.size || item.variant_size || null,
        quantity: item.quantity || item.qty || item.sold_quantity || 1,
        branch_id: item.branch_id || branchIdForLog || null,
      })),
    });

    if (POS_CHECKOUT_DEBUG) console.log("[POS_CREATE_ORDER_PAYLOAD]", safeOrderLogPayload(normalizedPayload));

    if (!tenantId) {
      console.error("[orders:create] failed", {
        tenantId,
        branchId: branchIdForLog,
        userId: req.user?.id || null,
        error: "tenant context missing",
      });
      return res.status(400).json({ success: false, message: "Tenant context is required" });
    }

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
    const resolvedCashierUserId = req.user?.id || null;
    const requestedSellerUserId = seller_user_id || null;
    const requestedSalesEmployeeId = sales_employee_id || salesperson_id || assigned_seller_id || seller_employee_id || null;
    let resolvedSellerUserId = requestedSellerUserId || null;
    const resolvedCashierId = resolvedCashierUserId;
    let resolvedSalesEmployeeId = requestedSalesEmployeeId || null;
    let resolvedShiftId = shift_id || null;

    markOrderStep("ensure schemas", { tenantId });
    await timedCheckout(checkoutTiming, "schema_ms", async () => {
      await ensureAttendanceSchema();
      await ensurePosShiftOrderColumns(client, tenantId);
      await ensurePosUserShiftSchema(client);
      await ensureSalesCommissionSchema(client);
      await ensureLoyaltySchema(db);
      await ensureWalletSchema(client);
      await ensureWhatsappShippingSchema(client);
    });

    await client.query("BEGIN");
    transactionStarted = true;
    markOrderStep("transaction started");
    await client.query("SET LOCAL lock_timeout = '5000ms'");
    await client.query("SET LOCAL statement_timeout = '20000ms'");

    markOrderStep("load sales settings");
    const settings = await getSalesSettings(client, tenantId);
    const defaultPosOrderStatus = normalizeOrderLifecycleStatus(
      await getSetting("orders.default_pos_order_status", "delivered"),
      "delivered"
    );
    const resolvedOrderStatus = normalizeOrderLifecycleStatus(status, defaultPosOrderStatus);

    const posBranch = await resolvePosBranch(client, { ...req, body: { ...req.body, branch_id } });
    const requestedBranchId = branch_id || posBranch?.id || null;

    markOrderStep("resolve POS shift", { cashier_user_id: resolvedCashierUserId, shift_id, branch_id: requestedBranchId });
    if (POS_CHECKOUT_DEBUG) console.log("[orders-pos-shift-resolve]", {
      tenant_id: tenantId,
      user_id: resolvedCashierUserId,
      requested_branch_id: requestedBranchId,
      requested_shift_id: resolvedShiftId,
      source: "checkout",
    });
    let openShift = await resolveActiveUserPosShift(client, {
      tenantId,
      userId: resolvedCashierUserId,
      branchId: requestedBranchId,
      shiftId: resolvedShiftId,
    });
    if (POS_CHECKOUT_DEBUG) console.log("[orders-pos-shift-resolve]", {
      tenant_id: tenantId,
      user_id: resolvedCashierUserId,
      requested_branch_id: requestedBranchId,
      requested_shift_id: resolvedShiftId,
      found_shift_id: openShift?.id || null,
      found_branch_id: openShift?.branch_id || null,
      status: openShift?.status || null,
      matched: Boolean(openShift),
    });

    if (!openShift) {
      await client.query("ROLLBACK");
      transactionStarted = false;
      return res.status(400).json({
        success: false,
        message: "يجب فتح وردية قبل البيع",
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

    const resolvedBranchId = openShift.branch_id || requestedBranchId || null;
    const resolvedAttendanceLogId = null;
    resolvedShiftId = openShift.id || resolvedShiftId;

    if (requestedSellerUserId && String(requestedSellerUserId) !== String(resolvedCashierUserId)) {
      const canOverride = await canOverridePosSeller(client, resolvedCashierUserId);
      if (!canOverride) {
        await client.query("ROLLBACK");
        transactionStarted = false;
        return res.status(403).json({
          success: false,
          message: "You cannot sell under another user",
        });
      }
      resolvedSellerUserId = requestedSellerUserId;
    }

    let sellerUser = null;
    if (requestedSellerUserId && String(requestedSellerUserId) !== String(resolvedCashierUserId)) {
      sellerUser = await validateSellerUser(client, { tenantId, sellerUserId: resolvedSellerUserId, branchId: resolvedBranchId });
    }
    if (requestedSellerUserId && String(requestedSellerUserId) !== String(resolvedCashierUserId) && !sellerUser) {
      await client.query("ROLLBACK");
      transactionStarted = false;
      return res.status(400).json({
        success: false,
        message: "Selected seller user is not active in this branch",
      });
    }
    resolvedSellerUserId = sellerUser?.id || requestedSellerUserId || null;
    resolvedSalesEmployeeId = resolvedSalesEmployeeId || sellerUser?.employee_id || null;
    const cashierName = req.user?.name || req.user?.email || "";
    let sellerName = seller_name || salesperson_name || sellerUser?.employee_name || sellerUser?.name || sellerUser?.email || "";
    const salespersonSnapshot = await getSalespersonSnapshot(client, {
      tenantId,
      salespersonId: resolvedSalesEmployeeId,
      branchId: resolvedBranchId,
    });
    if (salespersonSnapshot?.salesperson_id) {
      resolvedSalesEmployeeId = salespersonSnapshot.salesperson_id;
      sellerName = sellerName || salespersonSnapshot.salesperson_name || "";
    }
    const persistedSellerName = sellerName || "";
    const persistedSalespersonName = salespersonSnapshot?.salesperson_name || sellerName || null;
    console.log("[orders:seller-debug]", {
      selectedSellerId: requestedSalesEmployeeId || requestedSellerUserId || null,
      selectedSellerType: requestedSalesEmployeeId ? "employee" : requestedSellerUserId ? "user" : "none",
      resolvedEmployeeId: resolvedSalesEmployeeId || null,
      resolvedUserId: resolvedSellerUserId || null,
    });
    if (POS_CHECKOUT_DEBUG) console.log("[orders][seller-debug] persisted seller in order save", {
      requestedSellerUserId,
      requestedSalesEmployeeId,
      resolvedSellerUserId,
      resolvedSalesEmployeeId,
      sellerName,
      persistedSellerName,
      persistedSalespersonName,
      cashierName,
      salespersonSnapshot,
    });

    if (!settings.allow_sale_without_salesperson && !resolvedSalesEmployeeId) {
      await client.query("ROLLBACK");
      transactionStarted = false;
      return res.status(400).json({
        success: false,
        message: "Select a salesperson for this branch before checkout",
      });
    }

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
    const stockValidationError = await timedCheckout(checkoutTiming, "stock_validation_ms", async () => {
      try {
        const resolvedStock = await resolveOrderLinesStockBatch(client, { tenantId, items });
        resolvedStock.forEach((stockLine, key) => stockByLineKey.set(key, stockLine));
      } catch (error) {
        return {
          status: error.status || 400,
          body: {
            success: false,
            message: error.message || "Invalid order item",
          },
        };
      }
      for (const item of items) totalPrice += Number(item.price) * Number(item.quantity);
      return null;
    });
    if (stockValidationError) {
      await client.query("ROLLBACK");
      transactionStarted = false;
      return res.status(stockValidationError.status).json(stockValidationError.body);
    }

    const computedSubtotal = Number.isFinite(Number(subtotal)) ? Number(subtotal) : totalPrice;
    const normalizedInvoiceDiscountType = String(invoice_discount_type || "").trim().toLowerCase() === "percentage" ? "percentage" : "fixed";
    const invoiceDiscountValue = Math.max(0, Number(invoice_discount_value || 0) || 0);
    const requestedInvoiceDiscountAmount = Math.max(0, Number(invoice_discount_amount || 0) || 0);
    const maxInvoiceDiscountAmount = computedSubtotal;
    const computedInvoiceDiscountAmount = normalizedInvoiceDiscountType === "percentage"
      ? normalizeInvoiceMoney(computedSubtotal * (Math.min(100, invoiceDiscountValue) / 100))
      : normalizeInvoiceMoney(invoiceDiscountValue);
    const normalizedInvoiceDiscountAmount = Math.min(
      maxInvoiceDiscountAmount,
      requestedInvoiceDiscountAmount > 0 ? requestedInvoiceDiscountAmount : computedInvoiceDiscountAmount
    );
    if (invoiceDiscountValue > 0 && normalizedInvoiceDiscountType === "percentage" && invoiceDiscountValue > 100) {
      await client.query("ROLLBACK");
      transactionStarted = false;
      return res.status(400).json({ success: false, message: "Invoice discount percentage cannot exceed 100%" });
    }
    if (requestedInvoiceDiscountAmount - computedSubtotal > 0.009 || (normalizedInvoiceDiscountType === "fixed" && invoiceDiscountValue - computedSubtotal > 0.009)) {
      await client.query("ROLLBACK");
      transactionStarted = false;
      return res.status(400).json({ success: false, message: "Invoice discount cannot exceed subtotal" });
    }
    const requestedDiscountAmount = Math.max(0, Number(discount_amount || 0) || 0);
    const itemDiscountAmount = requestedDiscountAmount >= normalizedInvoiceDiscountAmount
      ? Math.max(0, requestedDiscountAmount - normalizedInvoiceDiscountAmount)
      : requestedDiscountAmount;
    const nonCouponDiscount = itemDiscountAmount + normalizedInvoiceDiscountAmount + Number(loyalty_discount_amount || 0);
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
    console.log("[orders:discount-received]", {
      order_payload_invoice_discount_type: invoice_discount_type || null,
      order_payload_invoice_discount_value: invoice_discount_value,
      order_payload_invoice_discount_amount: invoice_discount_amount,
      order_payload_aggregate_discount_amount: discount_amount,
      computed_subtotal: computedSubtotal,
      computed_item_discount_amount: itemDiscountAmount,
      computed_invoice_discount_type: normalizedInvoiceDiscountType,
      computed_invoice_discount_value: invoiceDiscountValue,
      computed_invoice_discount_amount: normalizedInvoiceDiscountAmount,
      computed_coupon_discount_amount: couponDiscountAmount,
      computed_loyalty_discount_amount: Number(loyalty_discount_amount || 0),
      computed_service_fee: totalServiceFee,
      computed_final_total: computedTotal,
      expected_invoice_only_total: Math.max(0, computedSubtotal - normalizedInvoiceDiscountAmount + totalServiceFee),
      payment_method,
      received_paid_amount: paid_amount,
    });
    const exchangeMode = exchange_mode === true || String(exchange_mode || "").toLowerCase() === "true";
    const exchangeCreditAmount = Math.max(0, Number(exchange_credit_amount || 0) || 0);
    const exchangeAppliedCredit = Math.min(exchangeCreditAmount, computedTotal);
    const amountDueNow = exchangeMode
      ? Math.max(0, Number.isFinite(Number(amount_due_now)) ? Number(amount_due_now) : computedTotal - exchangeAppliedCredit)
      : computedTotal;
    const exchangeDifferenceAmount = exchangeMode
      ? Number(Number(exchange_difference || computedTotal - exchangeCreditAmount).toFixed(2))
      : 0;
    const receivedAmount = exchangeMode
      ? Math.max(0, Number.isFinite(Number(paid_amount)) ? Number(paid_amount) : amountDueNow)
      : Number.isFinite(Number(paid_amount)) && Number(paid_amount) > 0 ? Number(paid_amount) : computedTotal;
    if (exchangeMode && Math.abs(receivedAmount - amountDueNow) > 0.009) {
      await client.query("ROLLBACK");
      transactionStarted = false;
      return res.status(400).json({
        success: false,
        message: "Exchange payment must equal amount due now",
        exchange: {
          new_order_total: computedTotal,
          exchange_credit_amount: exchangeCreditAmount,
          amount_due_now: amountDueNow,
          paid_amount: receivedAmount,
        },
      });
    }
    if (exchangeMode && exchangeCreditAmount > computedTotal && !resolvedCustomerId) {
      await client.query("ROLLBACK");
      transactionStarted = false;
      return res.status(400).json({
        success: false,
        message: "Select a customer to keep remaining exchange credit",
        exchange: {
          remaining_customer_credit: Number((exchangeCreditAmount - computedTotal).toFixed(2)),
        },
      });
    }
    const normalizedSalePaymentMethod = normalizeMoneyPaymentMethod(payment_method || "cash");
    const companyWalletPaymentMethods = ["wallet", "vodafone_cash", "vodafone", "instapay", "insta_pay"];
    const customerWalletPaymentMethods = ["customer_wallet", "store_credit", "customer_credit", "credit_balance"];
    const requestedWalletPaymentAmount = Math.max(0, Number(wallet_payment_amount ?? 0) || 0);
    const requestedCustomerWalletAmount = Math.max(0, Number(wallet_amount ?? 0) || 0);
    const companyWalletPaymentAmount = requestedWalletPaymentAmount > 0
      ? requestedWalletPaymentAmount
      : companyWalletPaymentMethods.includes(normalizedSalePaymentMethod)
        ? (requestedCustomerWalletAmount > 0 ? requestedCustomerWalletAmount : receivedAmount)
        : 0;
    const customerWalletRedemptionAmount = customerWalletPaymentMethods.includes(normalizedSalePaymentMethod)
      ? (requestedCustomerWalletAmount > 0 ? requestedCustomerWalletAmount : receivedAmount)
      : normalizedSalePaymentMethod === "mixed" || normalizedSalePaymentMethod === "split"
        ? requestedCustomerWalletAmount
        : 0;
    const publicToken = generatePublicToken();
    const detectedAttribution = detectMarketingAttribution(req);
    const resolvedMarketingSource = marketing_source || detectedAttribution.marketing_source || null;
    const resolvedMarketingPlatform = marketing_platform || detectedAttribution.marketing_platform || null;
    const resolvedMarketingPostId = marketing_post_id || detectedAttribution.marketing_post_id || null;
    const resolvedMarketingCampaign = marketing_campaign || detectedAttribution.marketing_campaign || null;
    const resolvedAttributionType = attribution_type || detectedAttribution.attribution_type || null;
    const resolvedMarketingTrackingCode = marketing_tracking_code || detectedAttribution.marketing_tracking_code || null;
    const resolvedMarketingSessionId = marketing_session_id || detectedAttribution.session_id || null;
    const serverInvoiceNumber = buildTemporaryInvoiceNumber();

    markOrderStep("insert order", {
      customer_id: customer_id || null,
      itemsCount,
      invoice_number: serverInvoiceNumber,
      payment_method: payment_method || "cash",
      payment_status: payment_status || "unpaid",
      totals: { subtotal: computedSubtotal, discount_amount: totalDiscount, tax_amount: totalTax, service_fee: totalServiceFee, total: computedTotal },
    });
    await logOrdersSalesEmployeeFkTarget(client, {
      source: "createOrder:before_insert",
      tenantId,
      requestedSalesEmployeeId: requestedSalesEmployeeId || null,
      resolvedSalesEmployeeId: resolvedSalesEmployeeId || null,
    });
    const orderResult = await timedCheckout(checkoutTiming, "order_insert_ms", () => client.query(
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
        seller_user_id,
        cashier_user_id,
        seller_name,
        cashier_name,
        cashier_id,
        sales_employee_id,
        salesperson_id,
        salesperson_name,
        salesperson_commission_type,
        salesperson_commission_value,
        salesperson_fixed_mode,
        salesperson_excluded_product_ids,
        salesperson_excluded_category_ids,
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
        notes,
        invoice_discount_type,
        invoice_discount_value,
        invoice_discount_amount,
        invoice_discount_reason
      )
      VALUES (
        $1,
        $2,
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
        $20,
        $21,
        $22,
        COALESCE($23::numeric, 0),
        $24,
        COALESCE($25::jsonb, '[]'::jsonb),
        COALESCE($26::jsonb, '[]'::jsonb),
        $27,
        $28,
        $29,
        $30,
        $31,
        $32,
        $33,
        $34,
        $35,
        COALESCE($36, 'pending'),
        COALESCE($37, 'unpaid'),
        COALESCE($38::numeric, 0),
        COALESCE($39::numeric, 0),
        COALESCE($40::numeric, 0),
        COALESCE($41::numeric, 0),
        $42,
        $43,
        $44,
        $45,
        $46,
        $47,
        COALESCE($48::numeric, 0),
        COALESCE($49::numeric, 0),
        $50,
        $51,
        COALESCE($52::numeric, 0),
        COALESCE($53::numeric, 0),
        $54
      )
      RETURNING *
      `,
      [
        tenantId,
        serverInvoiceNumber,
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
        companyWalletPaymentAmount,
        resolvedSellerUserId,
        resolvedCashierUserId,
        persistedSellerName,
        cashierName,
        resolvedCashierId,
        resolvedSalesEmployeeId,
        salespersonSnapshot?.salesperson_id || null,
        persistedSalespersonName,
        salespersonSnapshot?.commission_type || null,
        salespersonSnapshot?.commission_value || 0,
        salespersonSnapshot?.fixed_mode || settings.fixed_commission_mode,
        JSON.stringify(salespersonSnapshot?.excluded_product_ids || []),
        JSON.stringify(salespersonSnapshot?.excluded_category_ids || []),
        resolvedShiftId,
        resolvedAttendanceLogId,
        resolvedMarketingSource,
        resolvedMarketingPlatform,
        resolvedMarketingPostId,
        resolvedMarketingCampaign,
        resolvedAttributionType,
        resolvedMarketingTrackingCode,
        resolvedMarketingSessionId,
        resolvedOrderStatus,
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
        change_amount || Math.max(0, receivedAmount - (exchangeMode ? amountDueNow : computedTotal)),
        notes || "",
        normalizedInvoiceDiscountAmount > 0 ? normalizedInvoiceDiscountType : null,
        normalizedInvoiceDiscountAmount > 0 ? invoiceDiscountValue : 0,
        normalizedInvoiceDiscountAmount,
        normalizedInvoiceDiscountAmount > 0 ? String(invoice_discount_reason || "").trim() : "",
      ]
    ));
    if (POS_CHECKOUT_DEBUG) console.log("[orders][seller-debug] order save row seller fields", {
      order_id: orderResult.rows[0]?.id,
      seller_id: orderResult.rows[0]?.sales_employee_id || orderResult.rows[0]?.salesperson_id || orderResult.rows[0]?.seller_user_id || null,
      seller_user_id: orderResult.rows[0]?.seller_user_id || null,
      sales_employee_id: orderResult.rows[0]?.sales_employee_id || null,
      salesperson_id: orderResult.rows[0]?.salesperson_id || null,
      seller_name: orderResult.rows[0]?.seller_name || "",
      salesperson_name: orderResult.rows[0]?.salesperson_name || "",
      cashier_name: orderResult.rows[0]?.cashier_name || "",
    });

    let order = orderResult.rows[0];
    console.log("[orders:discount-saved]", {
      order_id: order?.id || null,
      invoice_number: order?.invoice_number || "",
      subtotal: Number(order?.subtotal || 0),
      discount_amount: Number(order?.discount_amount || 0),
      invoice_discount_type: order?.invoice_discount_type || null,
      invoice_discount_value: Number(order?.invoice_discount_value || 0),
      invoice_discount_amount: Number(order?.invoice_discount_amount || 0),
      service_fee: Number(order?.service_fee || 0),
      total_amount: Number(order?.total_amount || order?.total || 0),
      paid_amount: Number(order?.paid_amount || 0),
      payment_method: order?.payment_method || "",
    });
    if (exchangeMode) {
      const exchangeOrderResult = await client.query(
        `
        UPDATE orders
        SET exchange_mode = TRUE,
            original_order_id = $2,
            exchange_credit_amount = $3,
            new_order_total = $4,
            amount_due_now = $5,
            exchange_difference = $6,
            exchange_invoice_number = $7
        WHERE id = $1
        RETURNING *
        `,
        [
          order.id,
          original_order_id || null,
          exchangeCreditAmount,
          Number(new_order_total || computedTotal || 0) || computedTotal,
          amountDueNow,
          exchangeDifferenceAmount,
          exchange_invoice_number || "",
        ]
      );
      order = exchangeOrderResult.rows[0] || order;
    }
    const submittedPaymentBreakdown = normalizeSubmittedPaymentBreakdown(payment_breakdown || payments);
    const paymentBreakdown = submittedPaymentBreakdown.length ? submittedPaymentBreakdown : [
      exchangeMode
        ? {
            method: "exchange_credit",
            account_id: null,
            amount: exchangeAppliedCredit,
            original_order_id: original_order_id || null,
            invoice_number: exchange_invoice_number || "",
          }
        : null,
      {
        method: "cash",
        account_id: cash_financial_account_id || financial_account_id || null,
        amount: Number(cash_amount || 0) > 0 ? Number(cash_amount || 0) : normalizedSalePaymentMethod === "cash" ? Number(receivedAmount || 0) : 0,
      },
      {
        method: "card",
        account_id: card_financial_account_id || financial_account_id || null,
        amount: Number(card_amount || 0) > 0 ? Number(card_amount || 0) : normalizedSalePaymentMethod === "card" ? Number(receivedAmount || 0) : 0,
      },
      {
        method: "wallet",
        account_id: wallet_financial_account_id || financial_account_id || null,
        amount: companyWalletPaymentAmount,
      },
      {
        method: "customer_wallet",
        account_id: null,
        amount: customerWalletRedemptionAmount,
      },
    ].filter((payment) => payment && Number(payment.amount || 0) > 0);
    if (!paymentBreakdown.length && Number(receivedAmount || 0) > 0 && !customerWalletPaymentMethods.includes(normalizedSalePaymentMethod)) {
      paymentBreakdown.push({
        method: normalizedSalePaymentMethod,
        account_id: financial_account_id || null,
        amount: Number(receivedAmount || 0),
      });
    }
    console.info("[orders:payment-normalized]", {
      payment_method: normalizedSalePaymentMethod || payment_method || "cash",
      payment_status: payment_status || "unpaid",
      paid_amount: normalizeInvoiceMoney(receivedAmount),
      remaining_amount: normalizeInvoiceMoney(Math.max(0, computedTotal - receivedAmount)),
      split_payments: Array.isArray(paymentBreakdown) ? paymentBreakdown.length : 0,
      money_account_id: financial_account_id || cash_financial_account_id || card_financial_account_id || wallet_financial_account_id || null,
    });
    const paymentBreakdownResult = await timedCheckout(checkoutTiming, "payment_breakdown_ms", () => client.query(
      `
      UPDATE orders
      SET payment_breakdown = $2::jsonb
      WHERE id = $1
      RETURNING payment_breakdown
      `,
      [order.id, JSON.stringify(paymentBreakdown)]
    ));
    order.payment_breakdown = paymentBreakdownResult.rows[0]?.payment_breakdown || paymentBreakdown;
    order.public_token = order.public_token || publicToken;
    order = await timedCheckout(checkoutTiming, "invoice_generation_ms", () => assignSequentialInvoiceNumber(client, order));
    order = attachPublicOrderNumber(order, order.channel || order.source || channel || "pos");
    const { publicInvoiceUrl, publicInvoiceShortUrl } = await timedCheckout(checkoutTiming, "whatsapp_share_link_ms", async () => {
      const invoiceShareIdentifier = publicInvoiceIdentifier(order);
      const url = buildPublicInvoiceUrl(req, invoiceShareIdentifier);
      return { publicInvoiceUrl: url, publicInvoiceShortUrl: url };
    });
    order.public_invoice_url = publicInvoiceUrl;
    order.public_invoice_short_url = publicInvoiceShortUrl;
    order.invoice_public_url = publicInvoiceUrl;
    let employeeTracking = null;
    let loyaltyResult = null;
    let exchangeWalletResult = null;
    if (POS_CHECKOUT_DEBUG) {
      console.log("[checkout order]", order.id);
      console.log("[public token]", order.public_token);
      console.log("[public invoice url]", publicInvoiceUrl);
    }

    markOrderStep("insert order items", { order_id: order.id, itemsCount });
    const orderItemRows = await timedCheckout(checkoutTiming, "order_items_insert_ms", () => bulkInsertOrderItems(client, {
      tenantId,
      orderId: order.id,
      items,
      stockByLineKey,
      orderTotal: computedTotal,
    }));
    for (const [index, item] of items.entries()) {
      const stockLine = stockByLineKey.get(String(index)) || {};
      const orderItemRow = orderItemRows[index] || {};
      orderItemsForCommission.push({
        ...item,
        id: orderItemRow.id,
        order_item_id: orderItemRow.id,
        product_id: item.product_id || stockLine.productId || null,
        category_id: item.category_id || stockLine.categoryId || null,
        total_amount: item.total_amount || Number(item.price) * Number(item.quantity),
      });

      cogsTotal += Number(stockLine.costPrice || 0) * Number(item.quantity || 0);
    }
    markOrderStep("reduce stock", { order_id: order.id, itemsCount });
    await timedCheckout(checkoutTiming, "inventory_movement_ms", () => bulkApplyInventoryChanges(client, {
      tenantId,
      orderId: order.id,
      items,
      stockByLineKey,
      branchId: resolvedBranchId,
      createdBy: req.user?.id || null,
    }));

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

    const cashDrawerSaleAmount = paymentBreakdown
      .filter((payment) => normalizeMoneyPaymentMethod(payment.method || payment.payment_method) === "cash")
      .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);

    markOrderStep("create payment transaction", { order_id: order.id, payment_method: payment_method || "cash", amount: receivedAmount });
    await timedCheckout(checkoutTiming, "payment_treasury_update_ms", async () => {
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
        [cashDrawerSaleAmount, tenantId]
      );
    });

    if (cashDrawerSaleAmount > 0) {
      await timedCheckout(checkoutTiming, "payment_treasury_update_ms", () => recordCashDrawerEvent(client, {
        tenantId,
        branchId: resolvedBranchId,
        createdBy: req.user?.id || null,
        shiftId: resolvedShiftId,
        eventType: "sale_cash",
        sourceType: "order",
        sourceId: order.id,
        amount: cashDrawerSaleAmount,
      }));
    }

    const saleAccountEvents = paymentBreakdown
      .map((payment) => {
        const method = normalizeMoneyPaymentMethod(payment.method || payment.payment_method);
        if (["customer_wallet", "exchange_credit", "return_credit"].includes(method)) return null;
        const amount = Number(payment.amount || 0);
        if (!Number.isFinite(amount) || amount <= 0) return null;
        const explicitAccountId = payment.account_id || payment.financial_account_id || null;
        const methodAccountId =
          method === "cash" ? cash_financial_account_id :
          method === "card" ? card_financial_account_id :
          method === "wallet" ? wallet_financial_account_id :
          null;
        return {
          amount,
          paymentMethod: method,
          financialAccountId: explicitAccountId || methodAccountId || financial_account_id,
        };
      })
      .filter(Boolean);
    for (const accountEvent of saleAccountEvents) {
      if (accountEvent.amount <= 0) continue;
      await timedCheckout(checkoutTiming, "payment_treasury_update_ms", () => recordFinancialAccountActivity(client, {
        tenantId,
        branchId: resolvedBranchId,
        financialAccountId: accountEvent.financialAccountId,
        paymentMethod: accountEvent.paymentMethod,
        entryType: "sale",
        direction: 1,
        sourceType: "order",
        sourceId: order.id,
        amount: accountEvent.amount,
        notes: `Order #${order.invoice_number || order.id}`,
        invoiceNumber: order.invoice_number || "",
        createdBy: req.user?.id || null,
      }));
    }

    const loyaltyMustBlockCheckout = customerWalletRedemptionAmount > 0 || Number(loyalty_points_redeemed || 0) > 0;
    if (loyaltyMustBlockCheckout) {
      try {
        loyaltyResult = await timedCheckout(checkoutTiming, "loyalty_ms", () => processOrderLoyalty(client, {
          tenantId,
          orderId: order.id,
          customerId: resolvedCustomerId || order.customer_id,
          orderTotal: computedTotal,
          paidAmount: receivedAmount,
          status: resolvedOrderStatus,
          paymentStatus: payment_status || "unpaid",
          redeemPoints: loyalty_points_redeemed || 0,
          walletRedemptionAmount: customerWalletRedemptionAmount,
          skipEarning: Boolean(skip_loyalty_earning),
          fullWalletRedemptionOnly: Boolean(full_wallet_redemption_only),
          userId: req.user?.id || null,
        }));
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
          code: loyaltyError?.code || "",
          attemptedAmount: loyaltyError?.attemptedAmount ?? customerWalletRedemptionAmount ?? 0,
          availableBalance: loyaltyError?.availableBalance ?? 0,
          shortageAmount: loyaltyError?.shortageAmount ?? Math.max(0, Number(customerWalletRedemptionAmount || 0)),
          error: loyaltyError?.message || "Loyalty processing failed",
        };
      }
    } else {
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
        deferred: true,
      };
    }

    if (customerWalletRedemptionAmount > 0 && loyaltyResult?.error) {
      await client.query("ROLLBACK");
      transactionStarted = false;
      await logAccountingAudit(db, {
        tenantId,
        userId: req.user?.id || null,
        action: "pos_checkout_blocked_insufficient_balance",
        entityType: "pos_checkout",
        metadata: {
          attempted_amount: Number(loyaltyResult.attemptedAmount || customerWalletRedemptionAmount || 0),
          available_balance: Number(loyaltyResult.availableBalance || 0),
          shortage_amount: Number(loyaltyResult.shortageAmount || 0),
          account: "customer_wallet",
          customer_id: resolvedCustomerId || order.customer_id || null,
          cashier: cashierName || req.user?.email || req.user?.id || null,
          cashier_id: req.user?.id || null,
          branch_id: resolvedBranchId || null,
          timestamp: new Date().toISOString(),
          reason: loyaltyResult.code || "wallet_payment_failed",
        },
      }).catch((auditError) => console.error("[pos] failed to audit blocked checkout", auditError?.message || auditError));
      return res.status(400).json({
        success: false,
        message: loyaltyResult.error || "Unable to apply wallet payment",
        code: loyaltyResult.code || "WALLET_PAYMENT_FAILED",
        attempted_amount: Number(loyaltyResult.attemptedAmount || customerWalletRedemptionAmount || 0),
        available_balance: Number(loyaltyResult.availableBalance || 0),
        shortage_amount: Number(loyaltyResult.shortageAmount || 0),
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

    const remainingExchangeCredit = exchangeMode ? Math.max(0, Number((exchangeCreditAmount - computedTotal).toFixed(2))) : 0;
    if (remainingExchangeCredit > 0) {
      exchangeWalletResult = await recordWalletTransaction(client, {
        tenantId,
        customerId: resolvedCustomerId || order.customer_id,
        type: "exchange_credit",
        amount: remainingExchangeCredit,
        orderId: order.id,
        referenceType: "exchange",
        referenceId: order.id,
        notes: `Remaining exchange credit from ${exchange_invoice_number || original_order_id || "original invoice"}`,
        userId: req.user?.id || null,
      });
    }

    await timedCheckout(checkoutTiming, "commit_ms", () => client.query("COMMIT"));
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
      order,
      orderItemsForCommission,
      resolvedCashierId,
      resolvedSalesEmployeeId,
      resolvedShiftId,
      resolvedCustomerId,
      receivedAmount,
      status: resolvedOrderStatus,
      paymentStatus: payment_status || "unpaid",
      skipLoyaltyEarning: loyaltyMustBlockCheckout || Boolean(skip_loyalty_earning),
      totalDiscount,
      computedSubtotal,
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
    sendInvoiceWhatsapp({ ...order, items: orderItemsForCommission }, { mode: "pos" }).catch((error) => {
      console.warn("[whatsapp:pos-invoice-send-skipped]", {
        orderId: order?.id,
        status: order?.status,
        source: order?.source || order?.channel,
        message: error?.message || String(error),
      });
    });

    checkoutTiming.add("notifications_ms", 0);
    checkoutTiming.add("pdf_generation_ms", 0);
    const responsePayload = {
      success: true,
      message: "Order created successfully",
      order,
      order_id: order.id,
      invoice_number: order.invoice_number,
      total: Number(order.total_amount || order.total || computedTotal || 0),
      customer: {
        id: resolvedCustomerId || order.customer_id || null,
        name: resolvedCustomerName,
        phone: resolvedCustomerPhone || "",
      },
      payment_status: order.payment_status || payment_status || "unpaid",
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
        balance: Number(exchangeWalletResult?.afterBalance ?? loyaltyResult?.walletBalance ?? 0),
        exchangeCreditAmount: Number(exchangeWalletResult?.amount || 0),
      },
      activity: Array.isArray(loyaltyResult?.activities) ? loyaltyResult.activities : [],
      employeeTracking,
      timings: POS_CHECKOUT_DEBUG ? checkoutTiming.summary({ order_id: order.id, items_count: itemsCount }) : undefined,
    };
    const responseStartedAt = nowMs();
    const response = res.status(201).json(responsePayload);
    checkoutTiming.add("response_send_ms", nowMs() - responseStartedAt);
    logCheckoutTiming(checkoutTiming.summary({ order_id: order.id, items_count: itemsCount }));
    return response;
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
    console.error("[orders:create] failed", {
      tenantId,
      branchId: branchIdForLog,
      userId: req.user?.id || null,
      error: error?.message || error,
    });
    if (POS_CHECKOUT_DEBUG) {
      console.warn("[pos-checkout-error]", {
        phase: orderCreateStep,
        code: error?.code,
        message: error?.message,
        detail: error?.detail,
        timings: checkoutTiming.summary({ failed: true, step: orderCreateStep }),
      });
    }
    logCheckoutTiming(checkoutTiming.summary({ failed: true, step: orderCreateStep }));
    return res.status(500).json({
      success: false,
      message: "Order creation failed",
      detail: process.env.NODE_ENV !== "production" ? `${orderCreateStep}: ${error.message}` : undefined,
      code: process.env.NODE_ENV !== "production" ? error.code : undefined,
      routeName: error.routeName,
      insertLabel: error.insertLabel,
      columnsCount: error.columnsCount,
      paramsCount: error.paramsCount,
      sqlSnippetLabel: error.sqlSnippetLabel,
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

const getPosRecentOrders = async (req, res) => {
  const startedAt = nowMs();
  const timings = {
    orders_query_ms: 0,
    items_query_ms: 0,
    count_query_ms: 0,
  };

  try {
    const tenantId = isSuperAdminUser(req.user) ? null : getTenantId(req, req.user?.tenant_id);
    const requestedLimit = Number(req.query.limit);
    const requestedOffset = Number(req.query.offset);
    const limit = Math.min(Math.max(1, Number.isFinite(requestedLimit) ? requestedLimit : 10), 100);
    const offset = Math.max(0, Number.isFinite(requestedOffset) ? requestedOffset : 0);
    const search = String(req.query.search || req.query.q || "").trim();

    const [orderColumns, hasCustomersTable] = await Promise.all([
      getTableColumnSet(db, "orders"),
      tableExists(db, "customers"),
    ]);
    const customerColumns = hasCustomersTable ? await getTableColumnSet(db, "customers") : new Set();

    const invoiceExpr = orderColumns.has("invoice_number") ? "o.invoice_number" : "'INV-' || o.id::text";
    const totalExpr = orderColumns.has("total_amount")
      ? "o.total_amount"
      : orderColumns.has("total")
        ? "o.total"
        : orderColumns.has("total_price")
          ? "o.total_price"
          : "0";
    const statusExpr = orderColumns.has("status") ? "o.status" : "''";
    const paymentStatusExpr = orderColumns.has("payment_status") ? "o.payment_status" : "''";
    const paymentMethodExpr = orderColumns.has("payment_method") ? "o.payment_method" : "''";
    const createdExpr = orderColumns.has("created_at") ? "o.created_at" : "NOW()";
    const returnedExpr = orderColumns.has("returned_at") ? "o.returned_at" : "NULL";
    const deletedExpr = orderColumns.has("deleted_at") ? "o.deleted_at" : "NULL";
    const orderCustomerNameExpr = orderColumns.has("customer_name") ? "o.customer_name" : "''";
    const orderCustomerPhoneExpr = orderColumns.has("customer_phone") ? "o.customer_phone" : "''";
    const posColumn = firstExistingColumn(orderColumns, ["channel", "source", "order_source", "type"]);
    const customerNameColumn = firstExistingColumn(customerColumns, ["name", "full_name", "customer_name"]);
    const customerPhoneColumn = firstExistingColumn(customerColumns, ["phone", "mobile", "customer_phone"]);
    const customerJoin = hasCustomersTable && orderColumns.has("customer_id") && (customerNameColumn || customerPhoneColumn)
      ? "LEFT JOIN customers c ON c.id = o.customer_id"
      : "";
    const customerRecordNameExpr = customerJoin && customerNameColumn ? `COALESCE(c.${customerNameColumn}, '')` : "''";
    const customerRecordPhoneExpr = customerJoin && customerPhoneColumn ? `COALESCE(c.${customerPhoneColumn}, '')` : "''";

    const params = [];
    const addParam = (value) => {
      params.push(value);
      return `$${params.length}`;
    };
    const where = [`${deletedExpr} IS NULL`];
    if (tenantId !== null && orderColumns.has("tenant_id")) {
      where.push(`o.tenant_id = ${addParam(tenantId)}::bigint`);
    }
    if (posColumn) {
      where.push(`COALESCE(o.${posColumn}, 'pos') = 'pos'`);
    }
    if (search) {
      const searchParam = addParam(`%${search.toLowerCase()}%`);
      where.push(`(
        LOWER(COALESCE(${invoiceExpr}, '')) LIKE ${searchParam}
        OR LOWER(COALESCE(${orderCustomerNameExpr}, '')) LIKE ${searchParam}
        OR LOWER(COALESCE(${orderCustomerPhoneExpr}, '')) LIKE ${searchParam}
        OR LOWER(COALESCE(${customerRecordNameExpr}, '')) LIKE ${searchParam}
        OR LOWER(COALESCE(${customerRecordPhoneExpr}, '')) LIKE ${searchParam}
      )`);
    }
    const whereSql = `WHERE ${where.join(" AND ")}`;

    const ordersStartedAt = nowMs();
    const rowsResult = await db.query(
      `
      SELECT
        o.id,
        ${invoiceExpr} AS invoice_number,
        COALESCE(${totalExpr}, 0) AS total,
        COALESCE(${statusExpr}, '') AS status,
        COALESCE(${paymentStatusExpr}, '') AS payment_status,
        COALESCE(${paymentMethodExpr}, '') AS payment_method,
        COALESCE(NULLIF(${orderCustomerNameExpr}, ''), NULLIF(${customerRecordNameExpr}, ''), NULLIF(${orderCustomerPhoneExpr}, ''), NULLIF(${customerRecordPhoneExpr}, ''), '') AS customer_name,
        COALESCE(NULLIF(${orderCustomerPhoneExpr}, ''), NULLIF(${customerRecordPhoneExpr}, ''), '') AS customer_phone,
        ${createdExpr} AS created_at,
        ${returnedExpr} AS returned_at,
        (
          ${returnedExpr} IS NOT NULL
          OR LOWER(COALESCE(${statusExpr}, '')) IN ('returned', 'refunded', 'partially_refunded')
          OR LOWER(COALESCE(${paymentStatusExpr}, '')) IN ('refunded', 'partially_refunded')
        ) AS is_returned,
        (
          LOWER(COALESCE(${statusExpr}, '')) IN ('refunded', 'partially_refunded')
          OR LOWER(COALESCE(${paymentStatusExpr}, '')) IN ('refunded', 'partially_refunded')
        ) AS is_refunded
      FROM orders o
      ${customerJoin}
      ${whereSql}
      ORDER BY ${createdExpr} DESC, o.id DESC
      LIMIT ${addParam(limit)}
      OFFSET ${addParam(offset)}
      `,
      params
    );
    timings.orders_query_ms = nowMs() - ordersStartedAt;

    const countStartedAt = nowMs();
    const countParams = params.slice(0, params.length - 2);
    const countResult = await db.query(
      `
      SELECT COUNT(*)::int AS total
      FROM orders o
      ${customerJoin}
      ${whereSql}
      `,
      countParams
    );
    timings.count_query_ms = nowMs() - countStartedAt;

    const total = Number(countResult.rows[0]?.total || 0);
    const orders = rowsResult.rows.map((order) => ({
      id: order.id,
      invoice_number: order.invoice_number || `INV-${order.id}`,
      total: Number(order.total || 0),
      total_amount: Number(order.total || 0),
      status: order.status || "",
      payment_status: order.payment_status || "",
      payment_method: order.payment_method || "",
      customer_name: order.customer_name || "",
      customer_phone: order.customer_phone || "",
      created_at: order.created_at,
      returned_at: order.returned_at || null,
      is_returned: Boolean(order.is_returned),
      is_refunded: Boolean(order.is_refunded),
      refund_summary: Boolean(order.is_refunded) ? "refunded" : Boolean(order.is_returned) ? "returned" : "active",
    }));

    return res.status(200).json({
      success: true,
      data: orders,
      orders,
      pagination: {
        limit,
        offset,
        total,
        has_more: offset + orders.length < total,
      },
    });
  } catch (error) {
    console.error("[orders] POS recent mode error", error);
    return res.status(500).json({ success: false, message: "Failed to load recent POS orders", error: error.message });
  } finally {
    if (ERP_PERF_DEBUG) {
      console.log("[pos-recent-orders-timing]", {
        ...timings,
        total_ms: nowMs() - startedAt,
      });
    }
  }
};

export const getOrders = async (req, res) => {
  if (String(req.query.mode || "").trim().toLowerCase() === "pos_recent") {
    return getPosRecentOrders(req, res);
  }

  try {
    const startedAt = nowMs();
    const tenantId = isSuperAdminUser(req.user) ? null : getTenantId(req, req.user?.tenant_id);

    const page = Math.max(1, Number(req.query.page) || 1);
    const requestedLimit = Number(req.query.limit);
    const limit = Math.min(Math.max(1, Number.isFinite(requestedLimit) ? requestedLimit : 250), 500);
    const offset = (page - 1) * limit;
    const params = tenantId === null ? [limit, offset] : [tenantId, limit, offset];
    const tenantWhere = tenantId === null
      ? "WHERE o.deleted_at IS NULL"
      : "WHERE o.tenant_id = $1 AND o.deleted_at IS NULL";
    const limitParam = tenantId === null ? "$1" : "$2";
    const offsetParam = tenantId === null ? "$2" : "$3";
    const [hasCustomersTable, hasSalesEmployeesTable, hasEmployeesTable] = await Promise.all([
      tableExists(db, "customers"),
      tableExists(db, "sales_employees"),
      tableExists(db, "employees"),
    ]);
    const [customerColumns, salesEmployeeColumns, employeeColumns] = await Promise.all([
      hasCustomersTable ? getTableColumnSet(db, "customers") : Promise.resolve(new Set()),
      hasSalesEmployeesTable ? getTableColumnSet(db, "sales_employees") : Promise.resolve(new Set()),
      hasEmployeesTable ? getTableColumnSet(db, "employees") : Promise.resolve(new Set()),
    ]);
    const customerPhoneColumn = firstExistingColumn(customerColumns, ["phone", "mobile", "customer_phone"]);
    const customerJoin = hasCustomersTable && customerPhoneColumn
      ? "LEFT JOIN customers c ON c.id = o.customer_id"
      : "";
    const customerRecordPhoneExpr = customerJoin ? `COALESCE(c.${customerPhoneColumn}, '')` : "''";
    const assignedSellerIdExpr = "COALESCE(o.sales_employee_id, o.salesperson_id)";
    const salesEmployeeNameColumn = firstExistingColumn(salesEmployeeColumns, ["name", "full_name", "employee_name"]);
    const employeeNameColumn = firstExistingColumn(employeeColumns, ["full_name", "name", "employee_name"]);
    const employeeDeletedFilter = employeeColumns.has("is_deleted") ? "AND seller_employee.is_deleted IS DISTINCT FROM TRUE" : "";
    const employeeSellerJoin = hasEmployeesTable && employeeNameColumn
      ? `
        LEFT JOIN employees seller_employee ON seller_employee.id = ${assignedSellerIdExpr}
          ${employeeDeletedFilter}
      `
      : "";
    const salesEmployeeJoin = hasSalesEmployeesTable && salesEmployeeNameColumn
      ? `
        LEFT JOIN LATERAL (
          SELECT se.${salesEmployeeNameColumn} AS name
          FROM sales_employees se
          WHERE se.id = ${assignedSellerIdExpr}
             OR ${salesEmployeeColumns.has("employee_id") ? `se.employee_id = ${assignedSellerIdExpr}` : "FALSE"}
          ORDER BY se.id ASC
          LIMIT 1
        ) se ON TRUE
      `
      : "";
    const salesEmployeeExpr = salesEmployeeJoin ? "COALESCE(se.name, '')" : "''";
    const employeeSellerExpr = employeeSellerJoin ? `COALESCE(seller_employee.${employeeNameColumn}, '')` : "''";

    const result = await db.query(
      `
      SELECT
        o.*,
        COALESCE(NULLIF(o.customer_phone, ''), NULLIF(${customerRecordPhoneExpr}, ''), '') AS customer_phone,
        COALESCE(NULLIF(o.customer_phone, ''), NULLIF(${customerRecordPhoneExpr}, ''), '') AS phone,
        COALESCE(o.paid_amount, 0) AS paid_amount,
        COALESCE(o.paid_amount, 0) AS amount_paid,
        COALESCE(o.paid_amount, 0) AS payment_paid_amount,
        COALESCE(o.paid_amount, 0) AS total_paid,
        COALESCE(NULLIF(${employeeSellerExpr}, ''), NULLIF(${salesEmployeeExpr}, ''), NULLIF(o.seller_name, ''), NULLIF(o.salesperson_name, ''), '') AS sales_employee_name,
        COALESCE(NULLIF(o.seller_name, ''), NULLIF(${employeeSellerExpr}, ''), NULLIF(${salesEmployeeExpr}, ''), NULLIF(o.salesperson_name, ''), '') AS seller_name,
        COALESCE(NULLIF(o.salesperson_name, ''), NULLIF(${employeeSellerExpr}, ''), NULLIF(${salesEmployeeExpr}, ''), NULLIF(o.seller_name, ''), '') AS salesperson_name,
        COALESCE(NULLIF(${employeeSellerExpr}, ''), NULLIF(${salesEmployeeExpr}, ''), NULLIF(o.seller_name, ''), NULLIF(o.salesperson_name, ''), '') AS assigned_seller_name
      FROM orders o
      ${customerJoin}
      ${employeeSellerJoin}
      ${salesEmployeeJoin}
      ${tenantWhere}
      ORDER BY o.created_at DESC
      LIMIT ${limitParam}
      OFFSET ${offsetParam}
      `,
      params
    );

    const orderIds = result.rows.map((order) => Number(order.id)).filter((id) => Number.isFinite(id) && id > 0);
    const itemsByOrder = new Map();

    if (orderIds.length) {
      const itemsResult = await db.query(
        `
        SELECT
          oi.id,
          oi.order_id,
          oi.product_id,
          oi.variant_id,
          oi.product_name,
          oi.sku,
          oi.barcode,
          COALESCE(pv.color, '') AS color,
          COALESCE(pv.size, '') AS size,
          CONCAT_WS(' / ', NULLIF(pv.color, ''), NULLIF(pv.size, '')) AS variant_label,
          oi.quantity,
          oi.sale_price AS unit_price,
          oi.price AS stored_price,
          oi.sale_price AS price,
          oi.sale_price AS sale_price,
          oi.total_amount AS line_total,
          oi.total_amount AS subtotal,
          oi.total_amount AS item_total,
          pv.price AS variant_price,
          pv.sale_price AS variant_sale_price,
          p.price AS product_price,
          p.sale_price AS product_sale_price
        FROM order_items oi
        LEFT JOIN product_variants pv ON pv.id = oi.variant_id
        LEFT JOIN products p ON p.id = COALESCE(oi.product_id, pv.product_id)
        WHERE oi.order_id = ANY($1::bigint[])
          AND ($2::bigint IS NULL OR oi.tenant_id = $2::bigint OR oi.tenant_id IS NULL)
        ORDER BY oi.order_id DESC, oi.id ASC
        `,
        [orderIds, tenantId]
      );

      for (const item of itemsResult.rows) {
        const key = String(item.order_id);
        const current = itemsByOrder.get(key) || [];
        current.push(item);
        itemsByOrder.set(key, current);
      }
    }

    const payload = result.rows.map((order) => {
        const items = normalizeReturnedOrderItems(order, itemsByOrder.get(String(order.id)) || []);
        const totalQuantity = items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
        return withPaymentProofAliases({
          ...order,
          total_quantity: totalQuantity,
          total_items: totalQuantity,
          item_count: totalQuantity,
          items,
        });
      });
    if (POS_DEBUG) console.log("[orders-list-timing]", { count: payload.length, total_ms: nowMs() - startedAt });
    res.status(200).json(payload);
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Server Error" });
  }
};

const BLOCKED_OPERATION_STATUSES = new Set(["cancelled", "returned"]);

const normalizeOrderStatus = (value = "") => normalizeOrderLifecycleStatus(value, "pending");
const normalizeShipmentStatus = (value = "") => normalizeShippingLifecycleStatus(value, "pending");
const isDeliveredOrder = (order = {}) => {
  const status = normalizeOrderStatus(order.status || order.payment_status);
  const shippingStatus = normalizeShipmentStatus(order.shipment_status || order.shipping_status);
  return status === "delivered" || shippingStatus === "delivered";
};

const getUserBranchId = (user = {}) => {
  const value = user.branch_id ?? user.branchId ?? user.default_branch_id ?? null;
  const branchId = Number(value);
  return Number.isFinite(branchId) && branchId > 0 ? branchId : null;
};

const assertOrderBranchScope = (req, order = {}) => {
  if (isSuperAdminUser(req.user)) return;
  const userBranchId = getUserBranchId(req.user);
  if (!userBranchId || !order.branch_id) return;
  if (String(userBranchId) !== String(order.branch_id)) {
    const error = new Error("Order is outside your branch scope");
    error.status = 403;
    throw error;
  }
};

const assertOrderEditable = (order) => {
  if (!order || BLOCKED_OPERATION_STATUSES.has(normalizeOrderStatus(order.status))) {
    const error = new Error("لا يمكن تعديل أو تنفيذ عملية على فاتورة ملغاة أو مستردة");
    error.status = 400;
    throw error;
  }
};

const assertOrderReturnable = (order) => {
  const status = normalizeOrderStatus(order?.status || order?.payment_status);
  if (!order || ["cancelled", "returned"].includes(status)) {
    const error = new Error("لا يمكن إنشاء مرتجع لفاتورة ملغاة أو مرتجعة بالكامل");
    error.status = 400;
    throw error;
  }
};

const markCustomerTrustedForCompletedOrder = async (client, order = {}) => {
  const status = normalizeOrderStatus(order?.status);
  const shippingStatus = normalizeOrderStatus(order?.shipping_status);
  if (status !== "delivered" && shippingStatus !== "delivered") return;
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
  if (tableColumnSetCache.has(tableName)) return tableColumnSetCache.get(tableName);
  warnRuntimeSchemaExecution(`information_schema.columns:${tableName}`);
  const result = await clientOrPool.query(
    `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = $1
    `,
    [tableName]
  );
  const columns = new Set(result.rows.map((row) => row.column_name));
  tableColumnSetCache.set(tableName, columns);
  return columns;
};

const tableExists = async (clientOrPool, tableName) => {
  if (tableExistsCache.has(tableName)) return tableExistsCache.get(tableName);
  warnRuntimeSchemaExecution(`information_schema.tables:${tableName}`);
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
  const exists = Boolean(result.rows[0]);
  tableExistsCache.set(tableName, exists);
  return exists;
};

export const warmOrdersSchemaCache = async (clientOrPool = db) => {
  const tableNames = [
    "orders",
    "order_items",
    "users",
    "customers",
    "product_variants",
    "products",
    "product_variant_images",
    "sales_employees",
    "employees",
    "returns",
    "return_items",
    "payment_transactions",
    "payment_transaction_events",
    "wallet_transactions",
    "loyalty_transactions",
    "activity_logs",
  ];
  await Promise.all(tableNames.map((tableName) => tableExists(clientOrPool, tableName)));
  await Promise.all(tableNames.map((tableName) => getTableColumnSet(clientOrPool, tableName)));
};

const firstExistingColumn = (columns, candidates = []) => candidates.find((column) => columns.has(column)) || null;

const isHardDeleteAdmin = (user = {}) => {
  if (isSuperAdminUser(user)) return true;
  const role = String(user.role || user.role_name || user.type || "").trim().toLowerCase();
  return ["admin", "super admin", "super_admin", "superadmin", "owner"].includes(role);
};

const hardDeleteConfirmed = (value = "") => {
  const text = String(value || "").trim();
  return text === "DELETE" || text === "حذف";
};

const deleteFromTableByPredicates = async (client, tableName, predicates = [], params = []) => {
  if (!(await tableExists(client, tableName))) return 0;
  const columns = await getTableColumnSet(client, tableName);
  const clauses = predicates
    .filter((predicate) => (predicate.columns || []).every((column) => columns.has(column)))
    .map((predicate) => predicate.sql);
  if (!clauses.length) return 0;
  const result = await client.query(`DELETE FROM ${tableName} WHERE ${clauses.join(" OR ")}`, params);
  return result.rowCount || 0;
};

const deleteReturnRowsForOrder = async (client, orderId) => {
  if (!(await tableExists(client, "returns"))) return { return_items: 0, returns: 0 };
  const returnColumns = await getTableColumnSet(client, "returns");
  if (!returnColumns.has("order_id")) return { return_items: 0, returns: 0 };
  const deleted = { return_items: 0, returns: 0 };

  if (await tableExists(client, "return_items")) {
    const itemColumns = await getTableColumnSet(client, "return_items");
    if (itemColumns.has("return_id") && returnColumns.has("id")) {
      const result = await client.query(
        `DELETE FROM return_items WHERE return_id IN (SELECT id FROM returns WHERE order_id = $1)`,
        [orderId]
      );
      deleted.return_items = result.rowCount || 0;
    }
  }

  const result = await client.query(`DELETE FROM returns WHERE order_id = $1`, [orderId]);
  deleted.returns = result.rowCount || 0;
  return deleted;
};

const deleteOrderRelatedRows = async (client, orderId) => {
  const deleted = {};
  const addCount = (key, count) => {
    deleted[key] = (deleted[key] || 0) + Number(count || 0);
  };

  const returnCounts = await deleteReturnRowsForOrder(client, orderId);
  Object.entries(returnCounts).forEach(([key, count]) => addCount(key, count));

  if (await tableExists(client, "payment_transactions")) {
    const txColumns = await getTableColumnSet(client, "payment_transactions");
    if (txColumns.has("order_id") && txColumns.has("id") && await tableExists(client, "payment_transaction_events")) {
      const eventColumns = await getTableColumnSet(client, "payment_transaction_events");
      if (eventColumns.has("transaction_id")) {
        const result = await client.query(
          `DELETE FROM payment_transaction_events WHERE transaction_id IN (SELECT id FROM payment_transactions WHERE order_id = $1)`,
          [orderId]
        );
        addCount("payment_transaction_events", result.rowCount);
      }
    }
  }

  addCount("payment_transactions", await deleteFromTableByPredicates(client, "payment_transactions", [
    { columns: ["order_id"], sql: "order_id = $1" },
    { columns: ["reference_id", "reference_type"], sql: "reference_id = $1 AND LOWER(reference_type) IN ('order', 'invoice', 'pos_order')" },
  ], [orderId]));
  addCount("wallet_transactions", await deleteFromTableByPredicates(client, "wallet_transactions", [
    { columns: ["order_id"], sql: "order_id = $1" },
    { columns: ["reference_id", "reference_type"], sql: "reference_id = $1 AND LOWER(reference_type) IN ('order', 'invoice', 'pos_order', 'order_payment')" },
  ], [orderId]));
  addCount("loyalty_transactions", await deleteFromTableByPredicates(client, "loyalty_transactions", [
    { columns: ["order_id"], sql: "order_id = $1" },
    { columns: ["reference_id", "reference_type"], sql: "reference_id = $1 AND LOWER(reference_type) IN ('order', 'invoice', 'pos_order')" },
  ], [orderId]));
  addCount("employee_commissions", await deleteFromTableByPredicates(client, "employee_commissions", [
    { columns: ["order_id"], sql: "order_id = $1" },
    { columns: ["reference_id", "reference_type"], sql: "reference_id = $1 AND LOWER(reference_type) IN ('order', 'invoice', 'pos_order')" },
  ], [orderId]));
  addCount("employee_sales", await deleteFromTableByPredicates(client, "employee_sales", [
    { columns: ["order_id"], sql: "order_id = $1" },
    { columns: ["reference_id", "reference_type"], sql: "reference_id = $1 AND LOWER(reference_type) IN ('order', 'invoice', 'pos_order')" },
  ], [orderId]));
  addCount("cash_drawer_shift_events", await deleteFromTableByPredicates(client, "cash_drawer_shift_events", [
    { columns: ["order_id"], sql: "order_id = $1" },
    { columns: ["reference_id", "reference_type"], sql: "reference_id = $1 AND LOWER(reference_type) IN ('order', 'invoice', 'pos_order', 'sale')" },
    { columns: ["source_id", "source_type"], sql: "source_id = $1 AND LOWER(source_type) IN ('order', 'invoice', 'pos_order', 'sale')" },
  ], [orderId]));
  addCount("financial_account_entries", await deleteFromTableByPredicates(client, "financial_account_entries", [
    { columns: ["source_id", "source_type"], sql: "source_id = $1 AND LOWER(source_type) IN ('order', 'invoice', 'pos_order', 'sale')" },
  ], [orderId]));
  addCount("journal_entries", await deleteFromTableByPredicates(client, "journal_entries", [
    { columns: ["reference_id", "reference_type"], sql: "reference_id = $1 AND LOWER(reference_type) IN ('order', 'invoice', 'pos_order', 'sale')" },
  ], [orderId]));
  addCount("marketing_attribution_events", await deleteFromTableByPredicates(client, "marketing_attribution_events", [
    { columns: ["order_id"], sql: "order_id = $1" },
  ], [orderId]));
  addCount("notifications", await deleteFromTableByPredicates(client, "notifications", [
    { columns: ["entity_id", "entity_type"], sql: "entity_id = $1::text AND UPPER(entity_type) IN ('ORDER', 'INVOICE')" },
    { columns: ["action_url"], sql: "action_url IN ('/orders/' || $1::text, '/invoices/' || $1::text)" },
    { columns: ["metadata"], sql: "metadata->>'order_id' = $1::text" },
  ], [orderId]));
  addCount("website_notifications", await deleteFromTableByPredicates(client, "website_notifications", [
    { columns: ["metadata"], sql: "metadata->>'order_id' = $1::text" },
  ], [orderId]));
  addCount("order_reprint_logs", await deleteFromTableByPredicates(client, "order_reprint_logs", [
    { columns: ["order_id"], sql: "order_id = $1" },
  ], [orderId]));
  addCount("order_edit_audits", await deleteFromTableByPredicates(client, "order_edit_audits", [
    { columns: ["order_id"], sql: "order_id = $1" },
  ], [orderId]));
  addCount("activity_logs", await deleteFromTableByPredicates(client, "activity_logs", [
    { columns: ["entity", "entity_id"], sql: "entity_id = $1 AND UPPER(entity) IN ('ORDER', 'INVOICE')" },
  ], [orderId]));
  addCount("order_items", await deleteFromTableByPredicates(client, "order_items", [
    { columns: ["order_id"], sql: "order_id = $1" },
  ], [orderId]));

  return deleted;
};

const normalizeOperationItem = (item = {}) => {
  const quantity = Math.max(0, Number(item.quantity || 0));
  const price = resolveInputUnitPrice(item);
  const discount = Number(item.discount_amount ?? item.discount ?? 0);
  const lineTotal = resolveInputLineTotal(item, price);
  return {
    id: item.id || item.order_item_id || null,
    product_id: item.product_id || item.productId || null,
    product_name: item.product_name || item.name || "",
    variant_id: isRealId(item.variant_id ?? item.variantId) ? item.variant_id ?? item.variantId : null,
    variant_name: item.variant_name || [item.color, item.size].filter(Boolean).join(" / "),
    variation_mode: item.variation_mode || item.variationMode || "full_variations",
    sku: item.sku || "",
    barcode: item.barcode || "",
    color: item.color || "",
    size: item.size || "",
    quantity,
    price,
    discount_amount: discount,
    tax_amount: Number(item.tax_amount || 0),
    line_total: lineTotal,
    subtotal: lineTotal,
    total_amount: lineTotal,
  };
};

const loadOrderWithItems = async (clientOrPool, { tenantId, orderId }) => {
  const [hasSalesEmployeesTable, hasUsersTable, hasEmployeesTable] = await Promise.all([
    tableExists(clientOrPool, "sales_employees"),
    tableExists(clientOrPool, "users"),
    tableExists(clientOrPool, "employees"),
  ]);
  const salesEmployeeColumns = hasSalesEmployeesTable ? await getTableColumnSet(clientOrPool, "sales_employees") : new Set();
  const userColumns = hasUsersTable ? await getTableColumnSet(clientOrPool, "users") : new Set();
  const employeeColumns = hasEmployeesTable ? await getTableColumnSet(clientOrPool, "employees") : new Set();
  const salesEmployeeNameColumn = firstExistingColumn(salesEmployeeColumns, ["name", "full_name", "employee_name"]);
  const employeeNameColumn = firstExistingColumn(employeeColumns, ["full_name", "name", "employee_name"]);
  const userNameColumn = firstExistingColumn(userColumns, ["name", "full_name", "username", "email"]);
  const assignedSellerIdExpr = "COALESCE(o.sales_employee_id, o.salesperson_id)";
  const employeeDeletedFilter = employeeColumns.has("is_deleted") ? "AND seller_employee.is_deleted IS DISTINCT FROM TRUE" : "";
  const employeeSellerJoin = hasEmployeesTable && employeeNameColumn
    ? `
      LEFT JOIN employees seller_employee ON seller_employee.id = ${assignedSellerIdExpr}
        ${employeeDeletedFilter}
    `
    : "";
  const salesEmployeeJoin = hasSalesEmployeesTable && salesEmployeeNameColumn
    ? `
      LEFT JOIN LATERAL (
        SELECT se.${salesEmployeeNameColumn} AS name
        FROM sales_employees se
        WHERE se.id = ${assignedSellerIdExpr}
           OR ${salesEmployeeColumns.has("employee_id") ? `se.employee_id = ${assignedSellerIdExpr}` : "FALSE"}
        ORDER BY se.id ASC
        LIMIT 1
      ) se ON TRUE
    `
    : "";
  const sellerUserJoin = hasUsersTable && userNameColumn
    ? "LEFT JOIN users seller_user ON seller_user.id = o.seller_user_id"
    : "";
  const salesEmployeeExpr = salesEmployeeJoin ? "COALESCE(se.name, '')" : "''";
  const employeeSellerExpr = employeeSellerJoin ? `COALESCE(seller_employee.${employeeNameColumn}, '')` : "''";
  const sellerUserExpr = sellerUserJoin ? `COALESCE(seller_user.${userNameColumn}, '')` : "''";
  const orderResult = await clientOrPool.query(
    `
    SELECT
      o.*,
      u.name AS cashier_name,
      c.name AS customer_record_name,
      c.phone AS customer_record_phone,
      COALESCE(o.sales_employee_id, o.salesperson_id, o.seller_user_id) AS seller_id,
      ${assignedSellerIdExpr} AS assigned_seller_id,
      COALESCE(NULLIF(o.seller_name, ''), NULLIF(${employeeSellerExpr}, ''), NULLIF(${salesEmployeeExpr}, ''), NULLIF(o.salesperson_name, ''), NULLIF(${sellerUserExpr}, ''), '') AS seller_name,
      COALESCE(NULLIF(${employeeSellerExpr}, ''), NULLIF(${salesEmployeeExpr}, ''), NULLIF(o.seller_name, ''), NULLIF(o.salesperson_name, ''), '') AS sales_employee_name,
      COALESCE(NULLIF(o.salesperson_name, ''), NULLIF(${employeeSellerExpr}, ''), NULLIF(${salesEmployeeExpr}, ''), NULLIF(o.seller_name, ''), '') AS salesperson_name,
      COALESCE(NULLIF(${employeeSellerExpr}, ''), NULLIF(${salesEmployeeExpr}, ''), NULLIF(o.seller_name, ''), NULLIF(o.salesperson_name, ''), '') AS assigned_seller_name
    FROM orders o
    LEFT JOIN users u ON u.id = COALESCE(o.cashier_id, o.created_by)
    LEFT JOIN customers c ON c.id = o.customer_id
    ${employeeSellerJoin}
    ${salesEmployeeJoin}
    ${sellerUserJoin}
    WHERE o.id = $1
      AND ($2::bigint IS NULL OR o.tenant_id = $2::bigint)
    LIMIT 1
    ${typeof clientOrPool?.release === "function" ? "FOR UPDATE OF o" : ""}
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
      oi.sale_price AS unit_price,
      oi.total_amount AS line_total,
      pv.size,
      pv.color,
      COALESCE(
        NULLIF(oi.image_url, ''),
        NULLIF(oi.product_image, ''),
        NULLIF(oi.variant_image, ''),
        NULLIF(pv.image_url, ''),
        NULLIF(pvi.image_url, ''),
        NULLIF(p.image_url, ''),
        ''
      ) AS image_url,
      COALESCE(NULLIF(oi.product_image, ''), NULLIF(p.image_url, ''), '') AS product_image,
      COALESCE(NULLIF(oi.variant_image, ''), NULLIF(pv.image_url, ''), NULLIF(pvi.image_url, ''), '') AS variant_image,
      COALESCE(p.gallery_images, '[]'::jsonb) AS product_images,
      COALESCE(pvi.images, '[]'::jsonb) AS variant_images,
      jsonb_build_object(
        'id', p.id,
        'image', COALESCE(NULLIF(p.image, ''), NULLIF(p.image_url, ''), ''),
        'image_url', COALESCE(NULLIF(p.image_url, ''), NULLIF(p.image, ''), ''),
        'images', COALESCE(p.gallery_images, '[]'::jsonb)
      ) AS product,
      jsonb_build_object(
        'id', pv.id,
        'image', COALESCE(NULLIF(pv.image, ''), NULLIF(pv.image_url, ''), NULLIF(pvi.image_url, ''), ''),
        'image_url', COALESCE(NULLIF(pv.image_url, ''), NULLIF(pv.image, ''), NULLIF(pvi.image_url, ''), ''),
        'images', COALESCE(pvi.images, '[]'::jsonb),
        'color', pv.color,
        'size', pv.size
      ) AS variant,
      COALESCE(p.name, oi.product_name) AS product_name
    FROM order_items oi
    LEFT JOIN product_variants pv ON oi.variant_id = pv.id
    LEFT JOIN products p ON COALESCE(oi.product_id, pv.product_id) = p.id
    LEFT JOIN LATERAL (
      SELECT
        (array_agg(image_url ORDER BY is_primary DESC, sort_order ASC, id ASC))[1] AS image_url,
        COALESCE(jsonb_agg(image_url ORDER BY is_primary DESC, sort_order ASC, id ASC) FILTER (WHERE NULLIF(image_url, '') IS NOT NULL), '[]'::jsonb) AS images
      FROM product_variant_images pvi
      WHERE NULLIF(pvi.image_url, '') IS NOT NULL
        AND (
          pvi.variant_id = pv.id
          OR (
            pvi.product_id = p.id
            AND (
              NULLIF(pvi.color_name, '') IS NULL
              OR LOWER(pvi.color_name) = LOWER(COALESCE(pv.color, ''))
            )
          )
        )
    ) pvi ON TRUE
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
  if (Number(stockLine.stock || 0) + Number(delta || 0) < 0) {
    const error = new Error(`Not enough stock for ${getOrderItemLabel(stockLine.record || {})}`);
    error.status = 400;
    throw error;
  }
  if (stockLine.type === "variant") {
    return adjustVariantStock(client, {
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
      warehouseId: order.warehouse_id || null,
    });
    return;
  }

  return adjustProductStock(client, {
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
    warehouseId: order.warehouse_id || null,
    item: stockLine.record || {},
  });
};

export const getRecentPosOrders = async (req, res) => {
  return getPosRecentOrders(req, res);
  try {
    const tenantId = isSuperAdminUser(req.user) ? null : getTenantId(req, req.user?.tenant_id);
    const limit = Math.min(Math.max(Number(req.query.limit || 20), 1), 100);

    const [
      orderColumns,
      itemColumns,
      hasUsersTable,
      hasCustomersTable,
      hasProductVariantsTable,
      hasProductsTable,
      hasProductVariantImagesTable,
      hasSalesEmployeesTable,
      hasEmployeesTable,
    ] = await Promise.all([
      getTableColumnSet(db, "orders"),
      getTableColumnSet(db, "order_items"),
      tableExists(db, "users"),
      tableExists(db, "customers"),
      tableExists(db, "product_variants"),
      tableExists(db, "products"),
      tableExists(db, "product_variant_images"),
      tableExists(db, "sales_employees"),
      tableExists(db, "employees"),
    ]);
    const userColumns = hasUsersTable ? await getTableColumnSet(db, "users") : new Set();
    const customerColumns = hasCustomersTable ? await getTableColumnSet(db, "customers") : new Set();
    const salesEmployeeColumns = hasSalesEmployeesTable ? await getTableColumnSet(db, "sales_employees") : new Set();
    const employeeColumns = hasEmployeesTable ? await getTableColumnSet(db, "employees") : new Set();

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
    const sellerNameExpr = orderColumns.has("seller_name") ? "o.seller_name" : "''";
    const salespersonNameExpr = orderColumns.has("salesperson_name") ? "o.salesperson_name" : "''";
    const salesEmployeeIdColumns = ["sales_employee_id", "salesperson_id", "assigned_seller_id", "seller_employee_id"]
      .filter((column) => orderColumns.has(column))
      .map((column) => `o.${column}`);
    const salesEmployeeIdExpr =
      salesEmployeeIdColumns.length > 1
        ? `COALESCE(${salesEmployeeIdColumns.join(", ")})`
        : salesEmployeeIdColumns[0] || "NULL";
    const sellerUserIdExpr = orderColumns.has("seller_user_id") ? "o.seller_user_id" : "NULL";
    const salesEmployeeNameColumn = firstExistingColumn(salesEmployeeColumns, ["name", "full_name", "employee_name"]);
    const employeeNameColumn = firstExistingColumn(employeeColumns, ["full_name", "name", "employee_name"]);
    const employeeDeletedFilter = employeeColumns.has("is_deleted") ? "AND seller_employee.is_deleted IS DISTINCT FROM TRUE" : "";
    const employeeSellerJoin = hasEmployeesTable && employeeNameColumn && salesEmployeeIdColumns.length > 0
      ? `
        LEFT JOIN employees seller_employee ON seller_employee.id = ${salesEmployeeIdExpr}
          ${employeeDeletedFilter}
      `
      : "";
    const salesEmployeeJoin = hasSalesEmployeesTable && salesEmployeeNameColumn && salesEmployeeIdColumns.length > 0
      ? `
        LEFT JOIN LATERAL (
          SELECT se.${salesEmployeeNameColumn} AS name
          FROM sales_employees se
          WHERE se.id = ${salesEmployeeIdExpr}
             OR ${salesEmployeeColumns.has("employee_id") ? `se.employee_id = ${salesEmployeeIdExpr}` : "FALSE"}
          ORDER BY se.id ASC
          LIMIT 1
        ) se ON TRUE
      `
      : "";
    const salesEmployeeExpr = salesEmployeeJoin ? "COALESCE(se.name, '')" : "''";
    const employeeSellerExpr = employeeSellerJoin ? `COALESCE(seller_employee.${employeeNameColumn}, '')` : "''";
    const salespersonUserJoin = hasUsersTable && cashierNameColumn && orderColumns.has("seller_user_id")
      ? `LEFT JOIN users su ON su.id = ${sellerUserIdExpr}`
      : "";
    const salespersonUserExpr = salespersonUserJoin ? `COALESCE(su.${cashierNameColumn}, '')` : "''";
    const sellerIdSources = [salesEmployeeIdExpr, sellerUserIdExpr].filter((expr) => expr !== "NULL");
    const sellerIdExpr =
      sellerIdSources.length > 1
        ? `COALESCE(${sellerIdSources.join(", ")})`
        : sellerIdSources[0] || "NULL";

    const customerNameColumn = firstExistingColumn(customerColumns, ["name", "full_name", "customer_name"]);
    const customerPhoneColumn = firstExistingColumn(customerColumns, ["phone", "mobile", "customer_phone"]);
    const customerJoin = hasCustomersTable && orderColumns.has("customer_id") && (customerNameColumn || customerPhoneColumn)
      ? "LEFT JOIN customers c ON c.id = o.customer_id"
      : "";
    const customerRecordNameExpr = customerJoin && customerNameColumn ? `COALESCE(c.${customerNameColumn}, '')` : "''";
    const customerRecordPhoneExpr = customerJoin && customerPhoneColumn ? `COALESCE(c.${customerPhoneColumn}, '')` : "''";
    const cleanedOrderCustomerNameExpr = `CASE WHEN LOWER(COALESCE(${customerNameExpr}, '')) ~ '^guest[:#-]?[0-9]*$' THEN '' ELSE COALESCE(${customerNameExpr}, '') END`;

    const result = await db.query(
      `
      SELECT
        o.id,
        ${invoiceExpr} AS invoice_number,
        COALESCE(NULLIF(${cleanedOrderCustomerNameExpr}, ''), NULLIF(${customerRecordNameExpr}, ''), NULLIF(${customerPhoneExpr}, ''), NULLIF(${customerRecordPhoneExpr}, ''), '') AS customer_name,
        COALESCE(NULLIF(${customerPhoneExpr}, ''), NULLIF(${customerRecordPhoneExpr}, ''), '') AS customer_phone,
        COALESCE(NULLIF(${customerRecordNameExpr}, ''), '') AS customer_full_name,
        COALESCE(${totalExpr}, 0) AS total_amount,
        COALESCE(${paymentExpr}, '') AS payment_method,
        COALESCE(${paymentStatusExpr}, '') AS payment_status,
        COALESCE(${statusExpr}, '') AS status,
        ${createdExpr} AS created_at,
        ${updatedExpr} AS updated_at,
        ${cancelledExpr} AS cancelled_at,
        ${returnedExpr} AS returned_at,
        ${cashierExpr} AS cashier_name,
        ${sellerIdExpr} AS seller_id,
        ${salesEmployeeIdExpr} AS assigned_seller_id,
        COALESCE(NULLIF(${employeeSellerExpr}, ''), NULLIF(${salesEmployeeExpr}, ''), '') AS sales_employee_name,
        COALESCE(NULLIF(${sellerNameExpr}, ''), '') AS seller_name,
        COALESCE(NULLIF(${salespersonNameExpr}, ''), '') AS salesperson_name,
        COALESCE(NULLIF(${employeeSellerExpr}, ''), NULLIF(${salesEmployeeExpr}, ''), NULLIF(${sellerNameExpr}, ''), NULLIF(${salespersonNameExpr}, ''), NULLIF(${salespersonUserExpr}, ''), '') AS assigned_seller_name
      FROM orders o
      ${cashierJoin}
      ${employeeSellerJoin}
      ${salesEmployeeJoin}
      ${salespersonUserJoin}
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
    const productJoinKey = itemColumns.has("product_id")
      ? (variantJoin ? "COALESCE(oi.product_id, pv.product_id)" : "oi.product_id")
      : "pv.product_id";
    const productJoin = hasProductsTable && (itemColumns.has("product_id") || variantJoin)
      ? `LEFT JOIN products p ON ${productJoinKey} = p.id`
      : "";
    const productVariantImageJoin = hasProductVariantImagesTable && productJoin
      ? `
        LEFT JOIN LATERAL (
          SELECT
            (array_agg(image_url ORDER BY is_primary DESC, sort_order ASC, id ASC))[1] AS image_url,
            COALESCE(jsonb_agg(image_url ORDER BY is_primary DESC, sort_order ASC, id ASC) FILTER (WHERE NULLIF(image_url, '') IS NOT NULL), '[]'::jsonb) AS images
          FROM product_variant_images pvi
          WHERE NULLIF(pvi.image_url, '') IS NOT NULL
            AND (
              ${variantJoin ? "pvi.variant_id = pv.id OR" : ""}
              (
                pvi.product_id = p.id
                AND (
                  NULLIF(pvi.color_name, '') IS NULL
                  ${variantJoin ? "OR LOWER(pvi.color_name) = LOWER(COALESCE(pv.color, ''))" : ""}
                )
              )
            )
        ) pvi ON TRUE
      `
      : "";
    const itemColorExpr = variantJoin ? "COALESCE(pv.color, '')" : "''";
    const itemSizeExpr = variantJoin ? "COALESCE(pv.size, '')" : "''";
    const itemImageExpr = `COALESCE(${[
      itemColumns.has("variant_image") ? "NULLIF(oi.variant_image, '')" : null,
      variantJoin ? "NULLIF(pv.image_url, '')" : null,
      productVariantImageJoin ? "NULLIF(pvi.image_url, '')" : null,
      itemColumns.has("product_image") ? "NULLIF(oi.product_image, '')" : null,
      itemColumns.has("image_url") ? "NULLIF(oi.image_url, '')" : null,
      productJoin ? "NULLIF(p.image_url, '')" : null,
      "''",
    ].filter(Boolean).join(", ")})`;
    const productImageExpr = `COALESCE(${[
      itemColumns.has("product_image") ? "NULLIF(oi.product_image, '')" : null,
      productJoin ? "NULLIF(p.image_url, '')" : null,
      "''",
    ].filter(Boolean).join(", ")})`;
    const variantImageExpr = `COALESCE(${[
      itemColumns.has("variant_image") ? "NULLIF(oi.variant_image, '')" : null,
      variantJoin ? "NULLIF(pv.image_url, '')" : null,
      productVariantImageJoin ? "NULLIF(pvi.image_url, '')" : null,
      "''",
    ].filter(Boolean).join(", ")})`;

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
          ${itemImageExpr} AS image_url,
          ${productImageExpr} AS product_image,
          ${variantImageExpr} AS variant_image,
          ${productJoin ? "COALESCE(p.gallery_images, '[]'::jsonb)" : "'[]'::jsonb"} AS product_images,
          ${productVariantImageJoin ? "COALESCE(pvi.images, '[]'::jsonb)" : "'[]'::jsonb"} AS variant_images,
          ${productJoin ? "jsonb_build_object('id', p.id, 'image', COALESCE(NULLIF(p.image, ''), NULLIF(p.image_url, ''), ''), 'image_url', COALESCE(NULLIF(p.image_url, ''), NULLIF(p.image, ''), ''), 'images', COALESCE(p.gallery_images, '[]'::jsonb))" : "'{}'::jsonb"} AS product,
          ${variantJoin ? `jsonb_build_object('id', pv.id, 'image', COALESCE(NULLIF(pv.image, ''), NULLIF(pv.image_url, ''), ${productVariantImageJoin ? "NULLIF(pvi.image_url, '')" : "NULL"}, ''), 'image_url', COALESCE(NULLIF(pv.image_url, ''), NULLIF(pv.image, ''), ${productVariantImageJoin ? "NULLIF(pvi.image_url, '')" : "NULL"}, ''), 'images', ${productVariantImageJoin ? "COALESCE(pvi.images, '[]'::jsonb)" : "'[]'::jsonb"}, 'color', pv.color, 'size', pv.size)` : "'{}'::jsonb"} AS variant
        FROM order_items oi
        ${variantJoin}
        ${productJoin}
        ${productVariantImageJoin}
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
      invoice_number: order.invoice_number || `INV-${order.id}`,
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
      seller_id: order.seller_id || null,
      assigned_seller_id: order.assigned_seller_id || null,
      seller_name: order.seller_name || "",
      sales_employee_name: order.sales_employee_name || "",
      salesperson_name: order.salesperson_name || "",
      assigned_seller_name: order.assigned_seller_name || "",
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
    const paymentMethod = String(currentOrder.payment_method || "").trim().toLowerCase();
    let effectiveTenantId = currentOrder.tenant_id ?? tenantId ?? req.tenantId ?? req.tenant_id ?? req.user?.tenant_id ?? null;
    if (effectiveTenantId === undefined || effectiveTenantId === null || String(effectiveTenantId).trim() === "") {
      const tenantFallback = await client.query(`SELECT tenant_id FROM orders WHERE id = $1 LIMIT 1`, [req.params.id]);
      effectiveTenantId = tenantFallback.rows[0]?.tenant_id ?? null;
    }
    const totalAmount = Number(currentOrder.total_amount ?? currentOrder.total ?? currentOrder.total_price ?? 0);
    const shippingAmount = Number(currentOrder.shipping_fee ?? currentOrder.delivery_fee ?? currentOrder.service_fee ?? 0);
    const existingPaidAmount = Number(currentOrder.paid_amount || 0);
    const isCodShippingOnlyTransfer = ["cod", "cash_on_delivery", "cash on delivery"].includes(paymentMethod) && shippingAmount > 0 && totalAmount > shippingAmount;
    const nextPaidAmount = isCodShippingOnlyTransfer
      ? Math.min(totalAmount, Math.max(existingPaidAmount, shippingAmount))
      : Math.max(totalAmount, existingPaidAmount);
    const nextPaymentStatus = isCodShippingOnlyTransfer && nextPaidAmount < totalAmount ? "partially_paid" : "paid";

    const result = await client.query(
      `
      UPDATE orders
      SET payment_status = $4,
          transfer_proof_status = 'approved',
          status = 'confirmed',
          paid_amount = $5,
          shipping_payment_verified_at = NOW(),
          shipping_payment_verified_by = $2,
          updated_at = NOW()
      WHERE id = $1
        AND ($3::bigint IS NULL OR tenant_id = $3::bigint OR tenant_id IS NULL)
      RETURNING *
      `,
      [req.params.id, req.user?.id || null, tenantId, nextPaymentStatus, nextPaidAmount]
    );
    console.log("[orders.confirm-payment] loyalty tenant context", {
      order_id: result.rows[0].id,
      order_tenant_id: result.rows[0].tenant_id ?? currentOrder.tenant_id ?? null,
      req_tenantId: req.tenantId ?? req.tenant_id ?? null,
      user_tenant_id: req.user?.tenant_id ?? null,
      final_tenant_id: effectiveTenantId ?? null,
    });
    let loyaltyResult = { earned: false, reason: "skipped" };
    let loyaltyWarning = null;
    if (effectiveTenantId === undefined || effectiveTenantId === null || String(effectiveTenantId).trim() === "") {
      loyaltyWarning = "Loyalty skipped: missing tenant_id";
      console.warn("[orders.confirm-payment] loyalty skipped missing tenant", { order_id: result.rows[0].id });
    } else {
      await client.query("SAVEPOINT confirm_payment_loyalty");
      try {
        loyaltyResult = await processOrderLoyalty(client, {
          tenantId: effectiveTenantId,
          orderId: result.rows[0].id,
          customerId: result.rows[0].customer_id,
          orderTotal: result.rows[0].total_amount || result.rows[0].total || result.rows[0].total_price || 0,
          paidAmount: result.rows[0].paid_amount || result.rows[0].total_amount || result.rows[0].total || 0,
          status: result.rows[0].status,
          paymentStatus: result.rows[0].payment_status,
          userId: req.user?.id || null,
        });
        if (loyaltyResult?.reason === "missing_tenant") {
          loyaltyWarning = "Loyalty skipped: missing tenant_id";
        }
        await client.query("RELEASE SAVEPOINT confirm_payment_loyalty");
      } catch (loyaltyError) {
        await client.query("ROLLBACK TO SAVEPOINT confirm_payment_loyalty");
        await client.query("RELEASE SAVEPOINT confirm_payment_loyalty");
        loyaltyWarning = loyaltyError?.message || "Loyalty failed";
        loyaltyResult = { earned: false, reason: "loyalty_failed", error: loyaltyWarning };
        console.error("[orders.confirm-payment] loyalty failed; payment confirmation will still commit", {
          order_id: result.rows[0].id,
          final_tenant_id: effectiveTenantId,
          message: loyaltyWarning,
        });
      }
    }
    await client.query("COMMIT");
    return res.json({ success: true, order: result.rows[0], loyalty: loyaltyResult, warning: loyaltyWarning });
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
          transfer_proof_status = 'rejected',
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

const restoreOrderInventory = async (client, { tenantId, order, items, movementType, reason, userId }) => {
  if (order.inventory_rollback_done || order.stock_reverted_at || order.stock_restored_at) {
    const error = new Error("Order stock has already been restored");
    error.status = 409;
    throw error;
  }

  const restoredItems = [];
  for (const item of items.map(normalizeOperationItem)) {
    const quantity = Number(item.quantity || 0);
    if (quantity <= 0) continue;
    const stockLine = await resolveOrderLineStock(client, { tenantId, item });
    const adjustment = await applyStockDelta(client, {
      tenantId,
      order,
      stockLine,
      delta: quantity,
      movementType,
      reason,
      userId,
    });
    restoredItems.push({
      order_item_id: item.id || null,
      product_id: stockLine.productId || item.product_id || null,
      variant_id: stockLine.variantId || item.variant_id || null,
      sku: item.sku || stockLine.record?.sku || "",
      color: item.color || stockLine.record?.color || "",
      size: item.size || stockLine.record?.size || "",
      quantity,
      stock_before: adjustment?.quantityBefore ?? stockLine.stock ?? null,
      stock_after: adjustment?.quantityAfter ?? null,
    });
  }

  return restoredItems;
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
    assertOrderBranchScope(req, loaded.order);
    assertOrderEditable(loaded.order);

    if (!Object.prototype.hasOwnProperty.call(req.body || {}, "items")) {
      const safePatch = {
        customer_name: Object.prototype.hasOwnProperty.call(req.body, "customer_name") ? String(req.body.customer_name || "").trim() || "Walk-in Customer" : loaded.order.customer_name,
        customer_phone: Object.prototype.hasOwnProperty.call(req.body, "customer_phone") ? String(req.body.customer_phone || "").trim() : loaded.order.customer_phone,
        status: Object.prototype.hasOwnProperty.call(req.body, "status") ? String(req.body.status || "").trim() || loaded.order.status : loaded.order.status,
        payment_status: Object.prototype.hasOwnProperty.call(req.body, "payment_status") ? String(req.body.payment_status || "").trim() || loaded.order.payment_status : loaded.order.payment_status,
        source: Object.prototype.hasOwnProperty.call(req.body, "source") ? String(req.body.source || "").trim() || loaded.order.source || loaded.order.channel : loaded.order.source,
        channel: Object.prototype.hasOwnProperty.call(req.body, "channel") ? String(req.body.channel || "").trim() || loaded.order.channel || loaded.order.source : loaded.order.channel,
        branch_id: Object.prototype.hasOwnProperty.call(req.body, "branch_id") && req.body.branch_id !== "" ? req.body.branch_id : loaded.order.branch_id,
        shipping_status: Object.prototype.hasOwnProperty.call(req.body, "shipping_status") ? normalizeShipmentStatus(req.body.shipping_status || loaded.order.shipment_status || loaded.order.shipping_status) : normalizeShipmentStatus(loaded.order.shipment_status || loaded.order.shipping_status),
        notes: Object.prototype.hasOwnProperty.call(req.body, "notes") ? String(req.body.notes || "").trim() : loaded.order.notes,
        customer_address: Object.prototype.hasOwnProperty.call(req.body, "customer_address") ? String(req.body.customer_address || "").trim() : loaded.order.customer_address,
        governorate: Object.prototype.hasOwnProperty.call(req.body, "governorate") ? String(req.body.governorate || "").trim() : loaded.order.governorate,
        city_area: Object.prototype.hasOwnProperty.call(req.body, "city_area") ? String(req.body.city_area || "").trim() : loaded.order.city_area,
        landmark: Object.prototype.hasOwnProperty.call(req.body, "landmark") ? String(req.body.landmark || "").trim() : loaded.order.landmark,
        delivery_notes: Object.prototype.hasOwnProperty.call(req.body, "delivery_notes") ? String(req.body.delivery_notes || "").trim() : loaded.order.delivery_notes,
        order_notes: Object.prototype.hasOwnProperty.call(req.body, "order_notes") ? String(req.body.order_notes || "").trim() : loaded.order.order_notes,
        shipping_provider: Object.prototype.hasOwnProperty.call(req.body, "shipping_provider") ? String(req.body.shipping_provider || "").trim() || loaded.order.shipping_provider || "in_store_delivery" : loaded.order.shipping_provider,
        shipping_provider_id: Object.prototype.hasOwnProperty.call(req.body, "shipping_provider_id") ? String(req.body.shipping_provider_id || req.body.shipping_provider || "").trim() || loaded.order.shipping_provider_id || loaded.order.shipping_provider || "in_store_delivery" : loaded.order.shipping_provider_id,
        shipping_cost: Object.prototype.hasOwnProperty.call(req.body, "shipping_cost") ? Number(req.body.shipping_cost || 0) : Number(loaded.order.shipping_cost ?? loaded.order.shipping_fee ?? loaded.order.delivery_fee ?? 0),
        shipment_status: Object.prototype.hasOwnProperty.call(req.body, "shipment_status") ? normalizeShipmentStatus(req.body.shipment_status || req.body.shipping_status || loaded.order.shipment_status || loaded.order.shipping_status) : normalizeShipmentStatus(loaded.order.shipment_status || loaded.order.shipping_status),
        shipment_id: Object.prototype.hasOwnProperty.call(req.body, "shipment_id") ? String(req.body.shipment_id || "").trim() : loaded.order.shipment_id,
        tracking_number: Object.prototype.hasOwnProperty.call(req.body, "tracking_number") ? String(req.body.tracking_number || "").trim() : loaded.order.tracking_number,
        tracking_url: Object.prototype.hasOwnProperty.call(req.body, "tracking_url") ? String(req.body.tracking_url || "").trim() : loaded.order.tracking_url,
        courier_notes: Object.prototype.hasOwnProperty.call(req.body, "courier_notes") ? String(req.body.courier_notes || "").trim() : loaded.order.courier_notes,
      };
      const orderResult = await client.query(
        `
        UPDATE orders
        SET customer_name = $1,
            customer_phone = $2,
            status = $3,
            payment_status = $4,
            source = $5,
            channel = $6,
            branch_id = $7,
            shipping_status = $8,
            notes = $9,
            customer_address = $10,
            governorate = $11,
            city_area = $12,
            landmark = $13,
            delivery_notes = $14,
            order_notes = $15,
            shipping_provider = $16,
            shipping_provider_id = $17,
            shipping_cost = $18,
            delivery_fee = $18,
            shipping_fee = $18,
            shipment_status = $19,
            shipment_id = $20,
            tracking_number = $21,
            tracking_url = $22,
            courier_notes = $23,
            updated_at = NOW()
        WHERE id = $24
          AND ($25::bigint IS NULL OR tenant_id = $25::bigint OR tenant_id IS NULL)
        RETURNING *
        `,
        [
          safePatch.customer_name,
          safePatch.customer_phone,
          safePatch.status,
          safePatch.payment_status,
          safePatch.source,
          safePatch.channel,
          safePatch.branch_id,
          safePatch.shipping_status,
          safePatch.notes,
          safePatch.customer_address,
          safePatch.governorate,
          safePatch.city_area,
          safePatch.landmark,
          safePatch.delivery_notes,
          safePatch.order_notes,
          safePatch.shipping_provider,
          safePatch.shipping_provider_id,
          safePatch.shipping_cost,
          safePatch.shipment_status,
          safePatch.shipment_id,
          safePatch.tracking_number,
          safePatch.tracking_url,
          safePatch.courier_notes,
          loaded.order.id,
          tenantId,
        ]
      );
      await client.query(
        `
        INSERT INTO order_edit_audits (tenant_id, order_id, old_items, new_items, old_total, new_total, user_id, reason)
        VALUES ($1,$2,$3::jsonb,$4::jsonb,$5,$6,$7,$8)
        `,
        [
          tenantId,
          loaded.order.id,
          JSON.stringify({ order: loaded.order }),
          JSON.stringify({ order: orderResult.rows[0] }),
          Number(loaded.order.total_amount || loaded.order.total || 0),
          Number(orderResult.rows[0].total_amount || orderResult.rows[0].total || 0),
          req.user?.id || null,
          req.body.reason || "Safe order field edit",
        ]
      );
      await client.query("COMMIT");
      const updated = await loadOrderWithItems(db, { tenantId, orderId: loaded.order.id });
      const updatedOrder = orderResult.rows[0];
      if (normalizeShipmentStatus(updatedOrder.shipment_status || updatedOrder.shipping_status) !== normalizeShipmentStatus(loaded.order.shipment_status || loaded.order.shipping_status)) {
        sendShipmentNotificationForStatus(updatedOrder, updatedOrder.shipment_status || updatedOrder.shipping_status).catch((error) => {
          console.warn("[whatsapp:shipment-notification-skipped]", { orderId: updatedOrder.id, message: error?.message || String(error) });
        });
      }
      return res.status(200).json({ success: true, message: "Order updated", order: orderResult.rows[0], items: updated?.items || [] });
    }

    const oldItems = loaded.items.map(normalizeOperationItem);
    const newItems = (Array.isArray(req.body.items) ? req.body.items : []).map(normalizeOperationItem).filter((item) => item.quantity > 0);
    if (!newItems.length) {
      await client.query("ROLLBACK");
      return res.status(400).json({ success: false, message: "لا يمكن حفظ فاتورة بدون منتجات" });
    }

    for (const item of oldItems) {
      const quantity = Number(item.quantity || 0);
      if (quantity <= 0) continue;
      const stockLine = await resolveOrderLineStock(client, { tenantId, item });
      await applyStockDelta(client, {
        tenantId,
        order: loaded.order,
        stockLine,
        delta: quantity,
        movementType: "order_edit_restore",
        reason: "POS invoice edit restore old quantity",
        userId: req.user?.id || null,
      });
    }

    for (const item of newItems) {
      const quantity = Number(item.quantity || 0);
      if (quantity <= 0) continue;
      const stockLine = await resolveOrderLineStock(client, { tenantId, item });
      await applyStockDelta(client, {
        tenantId,
        order: loaded.order,
        stockLine,
        delta: quantity * -1,
        movementType: "order_edit_deduct",
        reason: "POS invoice edit deduct new quantity",
        userId: req.user?.id || null,
      });
    }

    const subtotalValue = newItems.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0), 0);
    const invoiceDiscountType = String(req.body.invoice_discount_type || "").trim().toLowerCase() === "percentage" ? "percentage" : "fixed";
    const invoiceDiscountValue = Math.max(0, Number(req.body.invoice_discount_value || 0) || 0);
    const requestedInvoiceDiscountAmount = Math.max(0, Number(req.body.invoice_discount_amount || 0) || 0);
    const computedInvoiceDiscountAmount = invoiceDiscountType === "percentage"
      ? normalizeInvoiceMoney(subtotalValue * (Math.min(100, invoiceDiscountValue) / 100))
      : normalizeInvoiceMoney(invoiceDiscountValue);
    if (invoiceDiscountValue > 0 && invoiceDiscountType === "percentage" && invoiceDiscountValue > 100) {
      await client.query("ROLLBACK");
      return res.status(400).json({ success: false, message: "Invoice discount percentage cannot exceed 100%" });
    }
    if (requestedInvoiceDiscountAmount - subtotalValue > 0.009 || (invoiceDiscountType === "fixed" && invoiceDiscountValue - subtotalValue > 0.009)) {
      await client.query("ROLLBACK");
      return res.status(400).json({ success: false, message: "Invoice discount cannot exceed subtotal" });
    }
    const invoiceDiscountAmount = Math.min(subtotalValue, requestedInvoiceDiscountAmount > 0 ? requestedInvoiceDiscountAmount : computedInvoiceDiscountAmount);
    const discountValue = Number(req.body.discount_amount ?? newItems.reduce((sum, item) => sum + Number(item.discount_amount || 0), 0));
    const serviceValue = Number(req.body.service_fee ?? loaded.order.service_fee ?? 0);
    const taxValue = Number(req.body.tax_amount ?? 0);
    const totalValue = Math.max(0, subtotalValue - discountValue + serviceValue + taxValue);
    const loadedOriginalPaidAmount = resolveCollectedOrderAmount(loaded.order);
    const requestedOriginalPaidAmount = Number(req.body.original_paid_amount);
    const originalPaidAmount = Math.max(
      0,
      Number.isFinite(requestedOriginalPaidAmount) && requestedOriginalPaidAmount > 0
        ? requestedOriginalPaidAmount
        : loadedOriginalPaidAmount
    );
    const expectedAmountDueNow = Math.max(0, totalValue - originalPaidAmount);
    const expectedRefundOrCreditDue = Math.max(0, originalPaidAmount - totalValue);
    const requestedAmountDueNow = Number(req.body.amount_due_now);
    const requestedRefundOrCreditDue = Number(req.body.refund_or_credit_due);
    const amountDueNow = Math.max(
      0,
      Number.isFinite(requestedAmountDueNow) && Math.abs(requestedAmountDueNow - expectedAmountDueNow) <= 0.009
        ? requestedAmountDueNow
        : expectedAmountDueNow
    );
    const refundOrCreditDue = Math.max(
      0,
      Number.isFinite(requestedRefundOrCreditDue) && Math.abs(requestedRefundOrCreditDue - expectedRefundOrCreditDue) <= 0.009
        ? requestedRefundOrCreditDue
        : expectedRefundOrCreditDue
    );
    const additionalPaidAmount = Math.max(0, Number(req.body.paid_amount ?? amountDueNow) || 0);
    if (additionalPaidAmount - amountDueNow > 0.009) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        success: false,
        message: "Additional payment cannot exceed edit amount due now",
        edit_payment_difference: {
          original_paid_amount: originalPaidAmount,
          new_total: totalValue,
          amount_due_now: amountDueNow,
          additional_paid_amount: additionalPaidAmount,
          refund_or_credit_due: refundOrCreditDue,
        },
      });
    }
    const paidValue = Math.min(totalValue, originalPaidAmount + additionalPaidAmount);
    const additionalPaymentBreakdown = Array.isArray(req.body.additional_payment_breakdown)
      ? req.body.additional_payment_breakdown
          .map((payment) => ({
            ...payment,
            method: normalizeMoneyPaymentMethod(payment.method || payment.payment_method || "cash"),
            amount: Math.max(0, Number(payment.amount || 0) || 0),
          }))
          .filter((payment) => payment.amount > 0)
      : [];
    const existingPaymentBreakdown = Array.isArray(loaded.order.payment_breakdown) ? loaded.order.payment_breakdown : [];
    const editPaymentBreakdown = [
      ...existingPaymentBreakdown,
      ...additionalPaymentBreakdown.map((payment) => ({
        ...payment,
        edit_additional_payment: true,
      })),
    ];
    const resolvedCustomerId = Object.prototype.hasOwnProperty.call(req.body, "customer_id")
      ? req.body.customer_id || null
      : loaded.order.customer_id || null;
    const resolvedCustomerName = String(req.body.customer_name || loaded.order.customer_name || "").trim() || "Walk-in Customer";
    const resolvedCustomerPhone = Object.prototype.hasOwnProperty.call(req.body, "customer_phone")
      ? req.body.customer_phone || ""
      : loaded.order.customer_phone || "";

    await client.query(`DELETE FROM order_items WHERE order_id = $1 AND ($2::bigint IS NULL OR tenant_id = $2::bigint OR tenant_id IS NULL)`, [loaded.order.id, tenantId]);
    const orderItemAvailableColumns = await getTableColumnSet(client, "order_items");
    for (const item of newItems) {
      const stockLine = await resolveOrderLineStock(client, { tenantId, item });
      const query = buildOrderItemInsertQuery({
        ...item,
        tenant_id: tenantId,
        order_id: loaded.order.id,
        variant_id: stockLine.variantId || null,
        product_id: stockLine.productId || item.product_id || null,
        sale_price: item.price,
        unit_price: item.price,
        price: item.price,
        line_total: item.line_total || item.total_amount,
        subtotal: item.subtotal || item.total_amount,
        price_source: item.price > 0 ? "payload" : "missing",
      }, {
        availableColumns: orderItemAvailableColumns,
        filePath: "server/controllers/ordersController.js",
        routeName: "updatePosOrder",
        insertLabel: "updatePosOrderItems",
        sqlSnippetLabel: "pos_edit_order_items_insert",
      });
      try {
        await client.query(query.sql, query.params);
      } catch (error) {
        throw enrichOrderItemsInsertError(error, {
          routeName: "updatePosOrder",
          insertLabel: "updatePosOrderItems",
          columnsCount: query.columns.length,
          paramsCount: query.params.length,
          sqlSnippetLabel: "pos_edit_order_items_insert",
        });
      }
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
          change_amount = GREATEST($6::numeric - $5::numeric, 0),
          payment_method = COALESCE($7::text, payment_method),
          payment_status = COALESCE($8::text, payment_status),
          status = COALESCE($9::text, status),
          customer_id = $10,
          customer_name = $11,
          customer_phone = $12,
          notes = COALESCE($13::text, notes),
          source = COALESCE($15::text, source),
          channel = COALESCE($16::text, channel),
          branch_id = COALESCE($17::bigint, branch_id),
          payment_breakdown = $18::jsonb,
          edit_original_paid_amount = $19,
          edit_additional_paid_amount = $20,
          edit_refund_or_credit_due = $21,
          edit_payment_difference = $22::jsonb,
          invoice_discount_type = $23,
          invoice_discount_value = $24,
          invoice_discount_amount = $25,
          invoice_discount_reason = $26,
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
        req.body.source || null,
        req.body.channel || req.body.source || null,
        req.body.branch_id || null,
        JSON.stringify(editPaymentBreakdown),
        originalPaidAmount,
        additionalPaidAmount,
        refundOrCreditDue,
        JSON.stringify({
          edit_order_id: loaded.order.id,
          original_invoice_number: req.body.original_invoice_number || loaded.order.invoice_number || "",
          original_paid_amount: originalPaidAmount,
          new_total: totalValue,
          amount_due_now: amountDueNow,
          refund_or_credit_due: refundOrCreditDue,
          additional_payment_breakdown: additionalPaymentBreakdown,
        }),
        invoiceDiscountAmount > 0 ? invoiceDiscountType : null,
        invoiceDiscountAmount > 0 ? invoiceDiscountValue : 0,
        invoiceDiscountAmount,
        invoiceDiscountAmount > 0 ? String(req.body.invoice_discount_reason || "").trim() : "",
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
    return res.status(error.status || 500).json({
      success: false,
      message: error.message || "Failed to edit order",
      routeName: error.routeName,
      insertLabel: error.insertLabel,
      columnsCount: error.columnsCount,
      paramsCount: error.paramsCount,
      sqlSnippetLabel: error.sqlSnippetLabel,
    });
  } finally {
    client.release();
  }
};

const shipmentActionStatus = (action = "") => {
  const normalized = String(action || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (["create", "create_shipment", "manual_create", "shipment_created", "mark_shipment_created"].includes(normalized)) return "shipment_created";
  if (["retry", "retry_shipment"].includes(normalized)) return "created";
  if (["mark_shipped", "shipped", "ship"].includes(normalized)) return "in_transit";
  if (["out_for_delivery", "mark_out_for_delivery"].includes(normalized)) return "out_for_delivery";
  if (["mark_delivered", "delivered", "deliver"].includes(normalized)) return "delivered";
  if (["cancel", "cancel_shipment", "cancelled", "canceled"].includes(normalized)) return "cancelled";
  if (["ready", "ready_to_ship"].includes(normalized)) return "ready_to_ship";
  if (["picked_up", "pickup"].includes(normalized)) return "picked_up";
  if (["failed", "mark_failed"].includes(normalized)) return "failed";
  return "";
};

export const updateOrderShipment = async (req, res) => {
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
    assertOrderBranchScope(req, loaded.order);
    assertOrderEditable(loaded.order);

    const action = String(req.params.action || req.body?.action || "").trim();
    let nextStatus = shipmentActionStatus(action);
    let providerResult = null;
    const providerKey = normalizeShippingProviderKey(req.body?.provider || req.body?.provider_id || loaded.order.shipping_provider_id || loaded.order.shipping_provider || "in_store_delivery");

    if (["create", "create_shipment", "manual_create", "retry", "retry_shipment"].includes(action.toLowerCase().replace(/[\s-]+/g, "_"))) {
      const provider = getShippingProvider(providerKey);
      providerResult = await provider.createShipment(loaded.order);
      if (!providerResult.success && providerKey !== "in_store_delivery") {
        await client.query("ROLLBACK");
        return res.status(409).json(providerResult);
      }
      nextStatus = normalizeShipmentStatus(providerResult.status || providerResult.shipping_status || "created");
    }

    if (!nextStatus) {
      await client.query("ROLLBACK");
      return res.status(400).json({ success: false, message: "Unsupported shipment action" });
    }

    const nullableText = (value) => {
      const next = String(value ?? "").trim();
      return next || null;
    };
    const shipmentId = nullableText(req.body?.shipment_id || providerResult?.shipment_id || loaded.order.shipment_id || (providerKey === "in_store_delivery" ? `in-store-${loaded.order.id}` : ""));
    const trackingNumber = nullableText(req.body?.tracking_number || providerResult?.tracking_number || loaded.order.tracking_number);
    const trackingUrl = nullableText(req.body?.tracking_url || providerResult?.tracking_url || loaded.order.tracking_url);
    const providerId = nullableText(providerResult?.provider_id || req.body?.provider_id || providerKey) || providerKey;
    const providerName = nullableText(providerResult?.provider || providerKey) || providerKey;
    const rawResponse = providerResult?.raw_response ? JSON.stringify(providerResult.raw_response) : null;
    const updateParams = [
      providerName,
      providerId,
      nextStatus,
      shipmentId,
      trackingNumber,
      trackingUrl,
      action,
      rawResponse,
      req.user?.id || null,
      loaded.order.id,
      tenantId,
    ];
    console.info("[shipment-status-update]", {
      order_id: loaded.order.id,
      old_status: normalizeShipmentStatus(loaded.order.shipment_status || loaded.order.shipping_status),
      new_status: nextStatus,
      params: updateParams,
    });

    const updateResult = await client.query(
      `
      UPDATE orders
      SET shipping_provider = $1,
          shipping_provider_id = $2,
          shipping_status = $3::varchar,
          shipment_status = $3::varchar,
          shipment_id = $4::varchar,
          tracking_number = $5::varchar,
          tracking_url = $6::text,
          last_shipping_sync_at = NOW(),
          shipment_timeline = COALESCE(shipment_timeline, '[]'::jsonb) || jsonb_build_array(
            jsonb_build_object(
              'status', $3::varchar,
              'action', $7::varchar,
              'provider', $1::varchar,
              'shipment_id', $4::varchar,
              'tracking_number', $5::varchar,
              'raw_response', $8::jsonb,
              'at', NOW(),
              'user_id', $9::bigint
            )
          ),
          updated_at = NOW()
      WHERE id = $10
        AND ($11::bigint IS NULL OR tenant_id = $11::bigint OR tenant_id IS NULL)
      RETURNING *
      `,
      updateParams
    );

    await client.query("COMMIT");
    const updatedOrder = updateResult.rows[0];
    sendShipmentNotificationForStatus(updatedOrder, nextStatus).catch((error) => {
      console.warn("[whatsapp:shipment-notification-skipped]", { orderId: updatedOrder?.id, status: nextStatus, message: error?.message || String(error) });
    });
    return res.json({
      success: true,
      order: updatedOrder,
      provider: providerName,
      provider_id: providerId,
      shipment_id: shipmentId,
      tracking_number: trackingNumber,
      tracking_url: trackingUrl,
      status: nextStatus,
      shipping_status: nextStatus,
      raw_response: providerResult?.raw_response || null,
      error: providerResult?.error || null,
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[orders.shipment] action failed", { order_id: req.params.id, action: req.params.action, message: error?.message || String(error) });
    return res.status(error.status || 500).json({ success: false, message: error.message || "Failed to update shipment" });
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
    assertOrderBranchScope(req, loaded.order);
    assertOrderEditable(loaded.order);
    if (isDeliveredOrder(loaded.order)) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        success: false,
        message: "This order is already delivered. Use the return/refund flow instead of cancel-and-restore.",
        reason: "ORDER_ALREADY_DELIVERED",
      });
    }

    await restoreOrderInventory(client, {
      tenantId,
      order: loaded.order,
      items: loaded.items,
      movementType: "order_cancel",
      reason: "POS invoice cancel",
      userId: req.user?.id || null,
    });

    const updateResult = await client.query(
      `
      UPDATE orders
      SET status = 'cancelled',
          payment_status = 'cancelled',
          cancelled_at = NOW(),
          cancelled_by = $2,
          stock_restored_at = COALESCE(stock_restored_at, NOW()),
          stock_reverted_at = COALESCE(stock_reverted_at, NOW()),
          inventory_rollback_done = TRUE,
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

    await reverseMoneyTransactionsForReference(client, {
      tenantId,
      referenceType: "order",
      referenceId: loaded.order.id,
      transactionType: "pos_sale_payment",
      reversalReferenceType: "order_cancel",
      reversalReferenceId: loaded.order.id,
      notes: req.body?.reason || "Order cancelled",
      createdBy: req.user?.id || null,
    });

    await client.query("COMMIT");
    return res.status(200).json({ success: true, message: "تم إلغاء الفاتورة وإرجاع المخزون", order: updateResult.rows[0] });
  } catch (error) {
    await client.query("ROLLBACK");
    return res.status(error.status || 500).json({ success: false, message: error.message || "Failed to cancel order" });
  } finally {
    client.release();
  }
};

export const deleteOrder = async (req, res) => {
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
    if (loaded.order.deleted_at) {
      await client.query("ROLLBACK");
      const alreadyRestored = loaded.order.inventory_rollback_done || loaded.order.stock_reverted_at || loaded.order.stock_restored_at;
      return res.status(409).json({
        success: false,
        message: alreadyRestored ? "Stock was already restored for this order." : "Order is already archived",
      });
    }
    assertOrderBranchScope(req, loaded.order);

    const status = normalizeOrderStatus(loaded.order.status || loaded.order.payment_status);
    if (isDeliveredOrder(loaded.order)) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        success: false,
        message: "This order is already delivered. Use the return/refund flow instead of cancel-and-restore.",
        reason: "ORDER_ALREADY_DELIVERED",
      });
    }

    const stockAlreadyRestored = Boolean(
      loaded.order.inventory_rollback_done ||
      loaded.order.stock_reverted_at ||
      loaded.order.stock_restored_at ||
      loaded.order.cancelled_at ||
      ["cancelled", "returned"].includes(status)
    );
    const restoredItems = stockAlreadyRestored
      ? []
      : await restoreOrderInventory(client, {
          tenantId,
          order: loaded.order,
          items: loaded.items,
          movementType: "order_cancel",
          reason: "Order cancelled from dashboard",
          userId: req.user?.id || null,
        });

    const updateResult = await client.query(
      `
      UPDATE orders
      SET status = 'cancelled',
          payment_status = CASE WHEN COALESCE(payment_status, '') = '' THEN 'cancelled' ELSE payment_status END,
          cancelled_at = COALESCE(cancelled_at, NOW()),
          cancelled_by = COALESCE(cancelled_by, $2),
          deleted_at = NOW(),
          deleted_by = $2,
          delete_reason = $3,
          stock_restored_at = COALESCE(stock_restored_at, NOW()),
          stock_reverted_at = COALESCE(stock_reverted_at, NOW()),
          inventory_rollback_done = TRUE,
          updated_at = NOW()
      WHERE id = $1
        AND ($4::bigint IS NULL OR tenant_id = $4::bigint OR tenant_id IS NULL)
        AND deleted_at IS NULL
      RETURNING *
      `,
      [loaded.order.id, req.user?.id || null, req.body?.reason || "Cancelled from orders dashboard", tenantId]
    );

    if (!updateResult.rows[0]) {
      await client.query("ROLLBACK");
      return res.status(409).json({ success: false, message: "Order was already deleted" });
    }

    await reverseOrderLoyalty(client, {
      ...loaded.order,
      ...updateResult.rows[0],
      userId: req.user?.id || null,
    });

    await logActivity(
      client,
      req.user?.id || null,
      "CANCEL_ORDER_RESTORE_STOCK",
      "ORDER",
      loaded.order.id,
      {
        order_code: loaded.order.public_order_number || loaded.order.display_order_number || loaded.order.invoice_number || String(loaded.order.id),
        deleted_at: updateResult.rows[0].deleted_at,
        restored_items: restoredItems,
        stock_already_restored: stockAlreadyRestored,
      }
    );

    await reverseMoneyTransactionsForReference(client, {
      tenantId,
      referenceType: "order",
      referenceId: loaded.order.id,
      transactionType: "pos_sale_payment",
      reversalReferenceType: "order_delete",
      reversalReferenceId: loaded.order.id,
      notes: req.body?.reason || "Order deleted",
      createdBy: req.user?.id || null,
    });

    await client.query("COMMIT");
    return res.status(200).json({
      success: true,
      message: stockAlreadyRestored
        ? "Order archived. Stock had already been restored."
        : "Order cancelled and stock restored successfully.",
      order: updateResult.rows[0],
      restored_items: restoredItems,
      stock_already_restored: stockAlreadyRestored,
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[orders] delete error", error);
    return res.status(error.status || 500).json({ success: false, message: error.message || "Failed to delete order" });
  } finally {
    client.release();
  }
};

export const archiveOrder = async (req, res) => {
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
    if (loaded.order.deleted_at) {
      await client.query("ROLLBACK");
      return res.status(409).json({ success: false, message: "Order is already archived" });
    }
    assertOrderBranchScope(req, loaded.order);

    const updateResult = await client.query(
      `
      UPDATE orders
      SET deleted_at = NOW(),
          deleted_by = $2,
          delete_reason = $3,
          updated_at = NOW()
      WHERE id = $1
        AND ($4::bigint IS NULL OR tenant_id = $4::bigint OR tenant_id IS NULL)
        AND deleted_at IS NULL
      RETURNING *
      `,
      [loaded.order.id, req.user?.id || null, req.body?.reason || "Archived from orders dashboard", tenantId]
    );

    await logActivity(
      client,
      req.user?.id || null,
      "ARCHIVE_ORDER",
      "ORDER",
      loaded.order.id,
      {
        order_code: loaded.order.public_order_number || loaded.order.display_order_number || loaded.order.invoice_number || String(loaded.order.id),
        archived_at: updateResult.rows[0]?.deleted_at || null,
        stock_restored: false,
      }
    );

    await client.query("COMMIT");
    return res.status(200).json({ success: true, message: "Order archived successfully.", order: updateResult.rows[0] });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[orders] archive error", error);
    return res.status(error.status || 500).json({ success: false, message: error.message || "Failed to archive order" });
  } finally {
    client.release();
  }
};

export const permanentDeleteOrder = async (req, res) => {
  const client = await db.connect();
  try {
    if (!isHardDeleteAdmin(req.user)) {
      return res.status(403).json({ success: false, message: "Permanent delete is restricted to administrators." });
    }
    if (!hardDeleteConfirmed(req.body?.confirmation || req.body?.confirm)) {
      return res.status(400).json({ success: false, message: "Type DELETE or حذف to confirm permanent deletion." });
    }

    const tenantId = isSuperAdminUser(req.user) ? null : getTenantId(req, req.user?.tenant_id);
    await ensurePosShiftOrderColumns(client, tenantId);
    await client.query("BEGIN");

    const loaded = await loadOrderWithItems(client, { tenantId, orderId: req.params.id });
    if (!loaded) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, message: "Order not found or already permanently deleted." });
    }
    assertOrderBranchScope(req, loaded.order);

    const status = normalizeOrderStatus(loaded.order.status || loaded.order.payment_status);
    const stockAlreadyRestored = Boolean(
      loaded.order.inventory_rollback_done ||
      loaded.order.stock_reverted_at ||
      loaded.order.stock_restored_at ||
      loaded.order.cancelled_at ||
      loaded.order.returned_at ||
      ["cancelled", "returned"].includes(status)
    );
    const netItems = loaded.items.map((item) => ({
      ...item,
      quantity: Math.max(0, Number(item.quantity || 0) - Number(item.returned_quantity || 0)),
    }));
    const restoredItems = stockAlreadyRestored
      ? []
      : await restoreOrderInventory(client, {
          tenantId,
          order: loaded.order,
          items: netItems,
          movementType: "order_hard_delete_restore",
          reason: "Permanent invoice delete stock restore",
          userId: req.user?.id || null,
        });

    const relatedDeleted = await deleteOrderRelatedRows(client, loaded.order.id);
    const deleteResult = await client.query(
      `
      DELETE FROM orders
      WHERE id = $1
        AND ($2::bigint IS NULL OR tenant_id = $2::bigint OR tenant_id IS NULL)
      RETURNING id, invoice_number, public_order_number, display_order_number, total_amount, total, deleted_at
      `,
      [loaded.order.id, tenantId]
    );

    if (!deleteResult.rows[0]) {
      await client.query("ROLLBACK");
      return res.status(409).json({ success: false, message: "Order was already permanently deleted." });
    }

    await logActivity(
      client,
      req.user?.id || null,
      "PERMANENT_DELETE_ORDER",
      "ORDER_HARD_DELETE",
      loaded.order.id,
      {
        order_code: loaded.order.public_order_number || loaded.order.display_order_number || loaded.order.invoice_number || String(loaded.order.id),
        invoice_number: loaded.order.invoice_number || null,
        total_amount: Number(loaded.order.total_amount || loaded.order.total || 0),
        deleted_by: req.user?.id || null,
        deleted_at: new Date().toISOString(),
        restored_items: restoredItems,
        stock_already_restored: stockAlreadyRestored,
        related_deleted: relatedDeleted,
      }
    );

    await client.query("COMMIT");
    return res.status(200).json({
      success: true,
      message: "Order permanently deleted.",
      order_id: loaded.order.id,
      restored_items: restoredItems,
      stock_already_restored: stockAlreadyRestored,
      related_deleted: relatedDeleted,
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[orders] permanent delete error", error);
    return res.status(error.status || 500).json({ success: false, message: error.message || "Failed to permanently delete order" });
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

    const returnNumberBase = buildDerivedInvoiceNumber(loaded.order.invoice_number, "RET") || `RET-${loaded.order.id}`;
    const temporaryReturnNumber = `${returnNumberBase}-${buildTemporaryInvoiceNumber()}`;
    const mode = String(req.body.mode || "partial").trim().toLowerCase();
    const refundMethod = String(req.body.refund_method || req.body.refundMethod || "cash").trim().toLowerCase();
    const reason = req.body.reason || (mode === "exchange" ? "استبدال" : "POS return");
    const returnResult = await client.query(
      `
      INSERT INTO returns (tenant_id, order_id, return_number, status, reason, restock, refund_amount, created_by, shift_id, cashier_user_id)
      VALUES ($1,$2,$3,'completed',$4,true,$5,$6,$7,$8)
      RETURNING *
      `,
      [tenantId, loaded.order.id, temporaryReturnNumber, reason, Number(req.body.refund_amount || 0), req.user?.id || null, loaded.order.shift_id || null, req.user?.id || null]
    );
    let returnRow = returnResult.rows[0];
    const finalReturnNumberResult = await client.query(
      `
      UPDATE returns
      SET return_number = CASE
        WHEN EXISTS (
          SELECT 1 FROM returns existing
          WHERE existing.id <> $1
            AND COALESCE(existing.tenant_id, 0) = COALESCE($2::bigint, 0)
            AND existing.return_number = $3
        )
        THEN $3 || '-' || $1::text
        ELSE $3
      END
      WHERE id = $1
      RETURNING *
      `,
      [returnRow.id, tenantId, returnNumberBase]
    );
    returnRow = finalReturnNumberResult.rows[0] || returnRow;
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

    const status = "returned";
    const paymentStatus = projectedReturnedAll ? "refunded" : "partially_refunded";
    const updatedOrder = await client.query(
      `
      UPDATE orders
      SET status = $2,
          payment_status = $3,
          returned_at = NOW(),
          updated_at = NOW()
      WHERE id = $1
      RETURNING *
      `,
      [loaded.order.id, status, paymentStatus]
    );

    if (paymentStatus === "refunded") {
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

      await recordCashDrawerEvent(client, {
        tenantId,
        branchId: loaded.order.branch_id || null,
        createdBy: req.user?.id || null,
        shiftId: loaded.order.shift_id || null,
        eventType: "refund_cash",
        sourceType: "return",
        sourceId: returnRow.id,
        amount: refundTotal || Number(req.body.refund_amount || 0),
      });
      await recordFinancialAccountActivity(client, {
        tenantId,
        branchId: loaded.order.branch_id || null,
        financialAccountId: req.body.refund_financial_account_id || req.body.financial_account_id || req.body.refundFinancialAccountId || req.body.financialAccountId || refundFinancialAccountFromOrder(loaded.order, refundMethod) || null,
        paymentMethod: refundMethod,
        entryType: "refund",
        direction: -1,
        sourceType: "return",
        sourceId: returnRow.id,
        amount: refundTotal || Number(req.body.refund_amount || 0),
        notes: `${reason}${mode === "exchange" ? ` / original invoice ${loaded.order.invoice_number || loaded.order.id}` : ""}`,
        createdBy: req.user?.id || null,
      });
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

    const returnNumberBase = buildDerivedInvoiceNumber(orderResult.rows[0]?.invoice_number, "RET") || `RET-${orderId}`;
    const temporaryReturnNumber = `${returnNumberBase}-${buildTemporaryInvoiceNumber()}`;
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
        created_by,
        shift_id,
        cashier_user_id
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      RETURNING *
      `,
      [
        tenantId,
        orderId,
        temporaryReturnNumber,
        status,
        reason,
        Boolean(restock),
        Number(refundAmount || 0),
        req.user?.id || null,
        orderResult.rows[0]?.shift_id || null,
        req.user?.id || null,
      ]
    );

    let returnRow = returnResult.rows[0];
    const finalReturnNumberResult = await client.query(
      `
      UPDATE returns
      SET return_number = CASE
        WHEN EXISTS (
          SELECT 1 FROM returns existing
          WHERE existing.id <> $1
            AND COALESCE(existing.tenant_id, 0) = COALESCE($2::bigint, 0)
            AND existing.return_number = $3
        )
        THEN $3 || '-' || $1::text
        ELSE $3
      END
      WHERE id = $1
      RETURNING *
      `,
      [returnRow.id, tenantId, returnNumberBase]
    );
    returnRow = finalReturnNumberResult.rows[0] || returnRow;

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
      description: `Return #${returnRow.return_number || returnNumberBase}`,
      amount: Number(refundAmount || 0),
      direction: restock ? "in" : "out",
      createdBy: req.user?.id || null,
      branchId: orderResult.rows[0]?.branch_id || null,
      notes: reason || "",
    });

    await recordCashDrawerEvent(client, {
      tenantId,
      branchId: orderResult.rows[0]?.branch_id || null,
      createdBy: req.user?.id || null,
      shiftId: orderResult.rows[0]?.shift_id || null,
      eventType: "refund_cash",
      sourceType: "return",
      sourceId: returnRow.id,
      amount: Number(refundAmount || 0),
    });
    await recordFinancialAccountActivity(client, {
      tenantId,
      branchId: orderResult.rows[0]?.branch_id || null,
      financialAccountId: req.body.refund_financial_account_id || req.body.financial_account_id || req.body.refundFinancialAccountId || req.body.financialAccountId || refundFinancialAccountFromOrder(orderResult.rows[0], req.body.refund_method || req.body.refundMethod || "cash") || null,
      paymentMethod: req.body.refund_method || req.body.refundMethod || "cash",
      entryType: "refund",
      direction: -1,
      sourceType: "return",
      sourceId: returnRow.id,
      amount: Number(refundAmount || 0),
      notes: reason || "",
      createdBy: req.user?.id || null,
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
    await ensurePosShiftOrderColumns(db, tenantId);
    const { id } = req.params;
    const [hasSalesEmployeesTable, hasEmployeesTable] = await Promise.all([
      tableExists(db, "sales_employees"),
      tableExists(db, "employees"),
    ]);
    const salesEmployeeColumns = hasSalesEmployeesTable ? await getTableColumnSet(db, "sales_employees") : new Set();
    const employeeColumns = hasEmployeesTable ? await getTableColumnSet(db, "employees") : new Set();
    const salesEmployeeNameColumn = firstExistingColumn(salesEmployeeColumns, ["name", "full_name", "employee_name"]);
    const employeeNameColumn = firstExistingColumn(employeeColumns, ["full_name", "name", "employee_name"]);
    const assignedSellerIdExpr = "COALESCE(o.sales_employee_id, o.salesperson_id)";
    const employeeDeletedFilter = employeeColumns.has("is_deleted") ? "AND seller_employee.is_deleted IS DISTINCT FROM TRUE" : "";
    const employeeSellerJoin = hasEmployeesTable && employeeNameColumn
      ? `
        LEFT JOIN employees seller_employee ON seller_employee.id = ${assignedSellerIdExpr}
          ${employeeDeletedFilter}
      `
      : "";
    const salesEmployeeJoin = hasSalesEmployeesTable && salesEmployeeNameColumn
      ? `
        LEFT JOIN LATERAL (
          SELECT se.${salesEmployeeNameColumn} AS name
          FROM sales_employees se
          WHERE se.id = ${assignedSellerIdExpr}
             OR ${salesEmployeeColumns.has("employee_id") ? `se.employee_id = ${assignedSellerIdExpr}` : "FALSE"}
          ORDER BY se.id ASC
          LIMIT 1
        ) se ON TRUE
      `
      : "";
    const salesEmployeeExpr = salesEmployeeJoin ? "COALESCE(se.name, '')" : "''";
    const employeeSellerExpr = employeeSellerJoin ? `COALESCE(seller_employee.${employeeNameColumn}, '')` : "''";

    const orderResult = await db.query(
      `
      SELECT
        o.*,
        creator.name AS created_by_name,
        canceller.name AS cancelled_by_name,
        COALESCE(o.sales_employee_id, o.salesperson_id, o.seller_user_id) AS seller_id,
        ${assignedSellerIdExpr} AS assigned_seller_id,
        COALESCE(NULLIF(o.seller_name, ''), NULLIF(${employeeSellerExpr}, ''), NULLIF(${salesEmployeeExpr}, ''), NULLIF(o.salesperson_name, ''), '') AS seller_name,
        COALESCE(NULLIF(${employeeSellerExpr}, ''), NULLIF(${salesEmployeeExpr}, ''), NULLIF(o.seller_name, ''), NULLIF(o.salesperson_name, ''), '') AS sales_employee_name,
        COALESCE(NULLIF(o.salesperson_name, ''), NULLIF(${employeeSellerExpr}, ''), NULLIF(${salesEmployeeExpr}, ''), NULLIF(o.seller_name, ''), '') AS salesperson_name,
        COALESCE(NULLIF(${employeeSellerExpr}, ''), NULLIF(${salesEmployeeExpr}, ''), NULLIF(o.seller_name, ''), NULLIF(o.salesperson_name, ''), '') AS assigned_seller_name,
        sc.name_en AS shipping_city_name_en,
        sc.name_ar AS shipping_city_name_ar,
        sz.name_en AS shipping_zone_name_en,
        sz.name_ar AS shipping_zone_name_ar,
        sd.name_en AS shipping_district_name_en,
        sd.name_ar AS shipping_district_name_ar
      FROM orders o
      LEFT JOIN users creator ON creator.id = COALESCE(o.cashier_id, o.created_by)
      LEFT JOIN users canceller ON canceller.id = o.cancelled_by
      LEFT JOIN shipping_cities sc ON sc.id::text = o.shipping_city_id OR sc.provider_city_id = o.shipping_city_id
      LEFT JOIN shipping_zones sz ON sz.id::text = o.shipping_zone_id OR sz.provider_zone_id = o.shipping_zone_id
      LEFT JOIN shipping_districts sd ON sd.id::text = o.shipping_district_id OR sd.provider_district_id = o.shipping_district_id OR sd.id::text = o.area_id
      ${employeeSellerJoin}
      ${salesEmployeeJoin}
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
        order_items.sale_price AS unit_price,
        order_items.price AS stored_price,
        order_items.sale_price AS price,
        order_items.sale_price AS selling_price,
        order_items.sale_price AS line_unit_price,
        order_items.total_amount AS line_total,
        order_items.total_amount AS subtotal,
        order_items.total_amount AS item_total,
        product_variants.price AS variant_price,
        product_variants.sale_price AS variant_sale_price,
        products.price AS product_price,
        products.sale_price AS product_sale_price,
        product_variants.size,
        product_variants.color,
        CONCAT_WS(' / ', NULLIF(product_variants.color, ''), NULLIF(product_variants.size, '')) AS variant_label,
        COALESCE(
          NULLIF(order_items.image_url, ''),
          NULLIF(order_items.product_image, ''),
          NULLIF(order_items.variant_image, ''),
          NULLIF(product_variants.image_url, ''),
          NULLIF(product_variant_image.image_url, ''),
          NULLIF(products.image_url, ''),
          ''
        ) AS image_url,
        COALESCE(NULLIF(order_items.product_image, ''), NULLIF(products.image_url, ''), '') AS product_image,
        COALESCE(NULLIF(order_items.variant_image, ''), NULLIF(product_variants.image_url, ''), NULLIF(product_variant_image.image_url, ''), '') AS variant_image,
        COALESCE(products.gallery_images, '[]'::jsonb) AS product_images,
        COALESCE(product_variant_image.images, '[]'::jsonb) AS variant_images,
        jsonb_build_object(
          'id', products.id,
          'image', COALESCE(NULLIF(products.image, ''), NULLIF(products.image_url, ''), ''),
          'image_url', COALESCE(NULLIF(products.image_url, ''), NULLIF(products.image, ''), ''),
          'images', COALESCE(products.gallery_images, '[]'::jsonb)
        ) AS product,
        jsonb_build_object(
          'id', product_variants.id,
          'image', COALESCE(NULLIF(product_variants.image, ''), NULLIF(product_variants.image_url, ''), NULLIF(product_variant_image.image_url, ''), ''),
          'image_url', COALESCE(NULLIF(product_variants.image_url, ''), NULLIF(product_variants.image, ''), NULLIF(product_variant_image.image_url, ''), ''),
          'images', COALESCE(product_variant_image.images, '[]'::jsonb),
          'color', product_variants.color,
          'size', product_variants.size
        ) AS variant,
        COALESCE(products.name, order_items.product_name) AS product_name
      FROM order_items
      LEFT JOIN product_variants ON order_items.variant_id = product_variants.id
      LEFT JOIN products ON COALESCE(order_items.product_id, product_variants.product_id) = products.id
      LEFT JOIN LATERAL (
        SELECT
          (array_agg(image_url ORDER BY is_primary DESC, sort_order ASC, id ASC))[1] AS image_url,
          COALESCE(jsonb_agg(image_url ORDER BY is_primary DESC, sort_order ASC, id ASC) FILTER (WHERE NULLIF(image_url, '') IS NOT NULL), '[]'::jsonb) AS images
        FROM product_variant_images pvi
        WHERE NULLIF(pvi.image_url, '') IS NOT NULL
          AND (
            pvi.variant_id = product_variants.id
            OR (
              pvi.product_id = products.id
              AND (
                NULLIF(pvi.color_name, '') IS NULL
                OR LOWER(pvi.color_name) = LOWER(COALESCE(product_variants.color, ''))
              )
            )
          )
      ) product_variant_image ON TRUE
      WHERE order_items.order_id = $1
        AND ($2::bigint IS NULL OR order_items.tenant_id = $2::bigint)
      `,
      [id, tenantId]
    );

    const order = orderResult.rows[0];
    if (POS_DEBUG) {
      console.log("[orders][seller-debug] seller returned from invoice details API", {
        order_id: order.id,
        seller_id: order.seller_id || null,
        sales_employee_id: order.sales_employee_id || null,
        salesperson_id: order.salesperson_id || null,
        assigned_seller_id: order.assigned_seller_id || null,
        seller_name: order.seller_name || "",
        sales_employee_name: order.sales_employee_name || "",
        salesperson_name: order.salesperson_name || "",
        assigned_seller_name: order.assigned_seller_name || "",
        cashier_name: order.cashier_name || "",
        created_by_name: order.created_by_name || "",
      });
    }
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

    const normalizedItems = normalizeReturnedOrderItems(order, itemsResult.rows);
    return res.status(200).json({ order: withPaymentProofAliases({ ...order, items: normalizedItems, audit_timeline: timeline }), items: normalizedItems, audit_timeline: timeline });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ message: "Server Error" });
  }
};

export const getPosOrderSummary = getSingleOrder;

export const getPosEditOrder = async (req, res) => {
  try {
    const tenantId = isSuperAdminUser(req.user) ? null : getTenantId(req, req.user?.tenant_id);
    const orderId = Number(req.params.id || 0);
    if (!Number.isFinite(orderId) || orderId <= 0) {
      return res.status(400).json({ success: false, message: "Invalid order id" });
    }

    const orderResult = await timedPosEdit(req, "order_query_ms", () => db.query(
      `
      SELECT
        o.id,
        o.tenant_id,
        o.invoice_number,
        o.public_order_number,
        o.display_order_number,
        o.customer_id,
        COALESCE(o.customer_name, c.name, '') AS customer_name,
        COALESCE(o.customer_phone, c.phone, '') AS customer_phone,
        o.branch_id,
        o.payment_method,
        o.payment_status,
        o.status,
        o.paid_amount,
        o.paid_amount AS total_paid,
        o.paid_amount AS amount_paid,
        o.amount_due_now,
        o.payment_breakdown,
        o.edit_original_paid_amount,
        o.edit_additional_paid_amount,
        o.edit_refund_or_credit_due,
        o.edit_payment_difference,
        o.cash_amount,
        o.card_amount,
        o.wallet_payment_amount,
        o.discount_amount,
        o.invoice_discount_type,
        o.invoice_discount_value,
        o.invoice_discount_amount,
        o.invoice_discount_reason,
        o.service_fee,
        o.subtotal,
        o.total_amount,
        o.total,
        o.sales_employee_id,
        o.salesperson_id,
        o.seller_user_id,
        o.seller_name,
        o.salesperson_name,
        o.marketing_source,
        o.marketing_platform,
        o.marketing_post_id,
        o.marketing_campaign,
        o.attribution_type,
        o.marketing_tracking_code,
        o.marketing_session_id,
        o.created_at,
        o.updated_at
      FROM orders o
      LEFT JOIN customers c ON c.id = o.customer_id
      WHERE o.id = $1
        AND ($2::bigint IS NULL OR o.tenant_id = $2::bigint)
      LIMIT 1
      `,
      [orderId, tenantId]
    ));

    const order = orderResult.rows[0] || null;
    if (!order) {
      logPosEditTiming(req, { order_id: orderId, found: false });
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    addPosEditTiming(req, "customer_query_ms", 0);
    addPosEditTiming(req, "payment_query_ms", 0);

    const itemsResult = await timedPosEdit(req, "order_items_query_ms", () => db.query(
      `
      SELECT
        oi.id,
        oi.order_id,
        oi.product_id,
        oi.variant_id,
        COALESCE(p.name, oi.product_name, '') AS product_name,
        oi.variant_name,
        COALESCE(NULLIF(oi.sku, ''), NULLIF(pv.sku, ''), NULLIF(p.sku, ''), '') AS sku,
        COALESCE(NULLIF(oi.barcode, ''), NULLIF(pv.barcode, ''), NULLIF(p.barcode, ''), '') AS barcode,
        COALESCE(NULLIF(pv.color, ''), '') AS color,
        COALESCE(NULLIF(pv.size, ''), '') AS size,
        oi.quantity,
        oi.sale_price AS price,
        oi.sale_price AS unit_price,
        oi.discount_amount,
        oi.tax_amount,
        oi.total_amount,
        COALESCE(pv.stock, p.stock, 0) AS stock,
        COALESCE(p.variation_mode, 'full_variations') AS variation_mode,
        COALESCE(NULLIF(oi.image_url, ''), NULLIF(oi.product_image, ''), NULLIF(oi.variant_image, ''), NULLIF(pv.image_url, ''), NULLIF(p.image_url, ''), '') AS image_url
      FROM order_items oi
      LEFT JOIN product_variants pv ON pv.id = oi.variant_id
      LEFT JOIN products p ON p.id = COALESCE(oi.product_id, pv.product_id)
      WHERE oi.order_id = $1
        AND ($2::bigint IS NULL OR oi.tenant_id = $2::bigint OR oi.tenant_id IS NULL)
      ORDER BY oi.id ASC
      `,
      [orderId, tenantId]
    ));
    addPosEditTiming(req, "inventory_variant_query_ms", req._posEditTimings?.order_items_query_ms || 0);

    const items = itemsResult.rows.map((item) => ({
      id: item.id,
      order_item_id: item.id,
      product_id: item.product_id,
      variant_id: item.variant_id,
      product_name: item.product_name,
      name: item.product_name,
      variant_name: item.variant_name,
      sku: item.sku || "",
      barcode: item.barcode || "",
      color: item.color || "",
      size: item.size || "",
      quantity: Number(item.quantity || 0),
      price: Number(item.price || 0),
      unit_price: Number(item.unit_price || item.price || 0),
      sale_price: Number(item.price || 0),
      discount_amount: Number(item.discount_amount || 0),
      tax_amount: Number(item.tax_amount || 0),
      total_amount: Number(item.total_amount || 0),
      stock: Number(item.stock || 0),
      stock_quantity: Number(item.stock || 0),
      variation_mode: item.variation_mode || "full_variations",
      image_url: item.image_url || "",
    }));

    logPosEditTiming(req, { order_id: orderId, items_count: items.length, found: true });
    return res.json({ success: true, order: { ...order, items }, items });
  } catch (error) {
    logPosEditTiming(req, {
      order_id: req.params.id,
      failed: true,
      code: error?.code,
      message: error?.message,
    });
    console.error("[pos-edit] failed", {
      order_id: req.params.id,
      code: error?.code,
      message: error?.message,
      stack: error?.stack,
    });
    return res.status(500).json({ success: false, message: "Failed to load order for POS edit" });
  }
};

export const getPublicInvoiceByToken = async (req, res) => {
  try {
    await ensurePosShiftOrderColumnsNow(db, getTenantId(req, req.query?.tenant_id || req.query?.tenantId || req.user?.tenant_id || req.user?.tenantId));
    console.log("[public invoice token]", req.params.token);
    const invoice = await loadPublicInvoiceByToken(req.params.token, req);
    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: "Invoice not found",
      });
    }

    console.log("[public invoice order]", invoice?.invoice_number || req.params.token);
    const identifier = publicInvoiceIdentifier(invoice);
    invoice.public_invoice_url = buildPublicInvoiceUrl(req, identifier);
    invoice.public_invoice_short_url = buildShortPublicInvoiceUrl(req, identifier);
    invoice.short_invoice_url = buildShortPublicInvoiceUrl(req, identifier);
    invoice.google_review_url = getGoogleReviewUrl();

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
    await ensurePosShiftOrderColumnsNow(db, getTenantId(req, req.query?.tenant_id || req.query?.tenantId || req.user?.tenant_id || req.user?.tenantId));
    console.log("[public invoice token]", req.params.token);
    const invoice = await loadPublicInvoiceByToken(req.params.token, req);
    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: "Invoice not found",
      });
    }

    console.log("[public invoice order]", invoice?.invoice_number || req.params.token);
    const identifier = publicInvoiceIdentifier(invoice);
    invoice.public_invoice_url = buildPublicInvoiceUrl(req, identifier);
    invoice.public_invoice_short_url = buildShortPublicInvoiceUrl(req, identifier);
    invoice.short_invoice_url = buildShortPublicInvoiceUrl(req, identifier);
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
