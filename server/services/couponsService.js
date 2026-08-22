import crypto from "node:crypto";
import fs from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import db from "../database/db.js";
import { getSetting } from "./settingsService.js";
import { getSiteSettings } from "./siteSettingsService.js";
import { getPublicAppUrl } from "../utils/publicUrl.js";

const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFilePath);

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const VALID_DISCOUNT_TYPES = new Set(["percentage", "fixed", "free_shipping"]);
const VALID_STACK_POLICIES = new Set(["all", "none", "with_loyalty", "with_invoice_discount"]);
const VALID_CHANNELS = new Set(["offline", "website", "pos", "all"]);
const VALID_SOURCES = new Set(["pos", "website", "manual"]);

let couponsSchemaReady = null;
export const ensureCouponsSchema = async (clientOrPool = db) => {
  // DDL once per process; it used to run on every validate/list call (lock contention on hot paths).
  if (couponsSchemaReady) return couponsSchemaReady;
  couponsSchemaReady = (async () => {
    const sqlPath = path.join(currentDir, "../database/coupons.sql");
    console.log("[migration] loading:", sqlPath);
    if (!fs.existsSync(sqlPath)) {
      console.warn("[migration] missing:", sqlPath);
      return;
    }
    const sql = await readFile(sqlPath, "utf8");
    await clientOrPool.query(sql);
  })().catch((error) => {
    couponsSchemaReady = null;
    throw error;
  });
  return couponsSchemaReady;
};

const tenantFilter = (tenantId, alias = "") => {
  const column = alias ? `${alias}.tenant_id` : "tenant_id";
  return tenantId === null || tenantId === undefined ? "" : ` AND (${column} = $1 OR ${column} IS NULL)`;
};

const normalizeCampaignInput = (body = {}) => {
  const discountType = String(body.discount_type || body.discountType || "percentage").trim().toLowerCase();
  const channel = String(body.channel || "all").trim().toLowerCase();
  if (!VALID_DISCOUNT_TYPES.has(discountType)) {
    const error = new Error("Invalid discount type");
    error.status = 400;
    throw error;
  }
  if (!VALID_CHANNELS.has(channel)) {
    const error = new Error("Invalid campaign channel");
    error.status = 400;
    throw error;
  }
  const name = String(body.name || "").trim();
  const codeMode = String(body.code_mode || body.codeMode || "unique").trim().toLowerCase() === "shared" ? "shared" : "unique";
  const sharedCode = codeMode === "shared" ? normalizeSharedCode(body.shared_code ?? body.sharedCode) : null;
  if (codeMode === "shared" && sharedCode.length < 3) {
    const error = new Error("Shared code must be at least 3 characters (letters, digits, dash)");
    error.status = 400;
    throw error;
  }
  const prefix = String(body.code_prefix || body.codePrefix || name.slice(0, 4) || "CPN")
    .toUpperCase()
    .replace(/[^A-Z2-9]+/g, "")
    .replace(/[OI10]/g, "")
    .slice(0, 12);
  if (!name) {
    const error = new Error("Campaign name is required");
    error.status = 400;
    throw error;
  }
  return {
    name,
    code_prefix: prefix || "CPN",
    discount_type: discountType,
    discount_value: Math.max(0, Number(body.discount_value ?? body.discountValue ?? 0)),
    minimum_order_amount: Math.max(0, Number(body.minimum_order_amount ?? body.minimumOrderAmount ?? 0)),
    max_discount_amount: body.max_discount_amount === "" || body.maxDiscountAmount === "" ? null : body.max_discount_amount ?? body.maxDiscountAmount ?? null,
    usage_limit_per_coupon: normalizeUsageLimit(body.usage_limit_per_coupon ?? body.usageLimitPerCoupon, codeMode),
    total_coupons: Math.max(0, Number.parseInt(body.total_coupons ?? body.totalCoupons ?? 0, 10)),
    starts_at: body.starts_at || body.startsAt || null,
    expires_at: body.expires_at || body.expiresAt || null,
    channel,
    is_active: body.is_active ?? body.isActive ?? true,
    applies_to_shipping: parseBoolean(body.applies_to_shipping ?? body.appliesToShipping, false),
    usage_limit_per_customer: parseNullableInt(body.usage_limit_per_customer ?? body.usageLimitPerCustomer),
    scope: normalizeScope(body.scope),
    stack_policy: VALID_STACK_POLICIES.has(String(body.stack_policy || "").trim().toLowerCase())
      ? String(body.stack_policy).trim().toLowerCase()
      : "all",
    budget_cap: parseNullableMoney(body.budget_cap ?? body.budgetCap),
    first_order_only: parseBoolean(body.first_order_only ?? body.firstOrderOnly, false),
    code_mode: codeMode,
    shared_code: sharedCode,
    auto_issue_on_first_order: parseBoolean(body.auto_issue_on_first_order ?? body.autoIssueOnFirstOrder, false),
  };
};

/** Shared codes can be "unlimited" (0) — stored as a very large limit so the existing >= check keeps working. */
const UNLIMITED_USES = 1_000_000_000;
const normalizeUsageLimit = (value, codeMode) => {
  const n = Number.parseInt(value ?? 1, 10);
  if (codeMode === "shared" && (!Number.isFinite(n) || n <= 0)) return UNLIMITED_USES;
  return Math.max(1, Number.isFinite(n) ? n : 1);
};
export const normalizeSharedCode = (value) =>
  String(value || "").trim().toUpperCase().replace(/\s+/g, "-").replace(/[^A-Z0-9-]+/g, "").slice(0, 40);

const parseNullableInt = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
};
const parseNullableMoney = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Number(n.toFixed(2)) : null;
};
const idList = (value) => {
  const raw = Array.isArray(value) ? value : String(value ?? "").split(/[,\s]+/);
  return [...new Set(raw.map((v) => Number.parseInt(v, 10)).filter((n) => Number.isFinite(n) && n > 0))];
};
/** scope = { product_ids, category_ids, brand_ids, exclude_on_sale }. Empty lists mean "everything". */
export const normalizeScope = (value) => {
  let raw = value;
  if (typeof raw === "string") { try { raw = JSON.parse(raw); } catch { raw = {}; } }
  if (!raw || typeof raw !== "object") raw = {};
  return {
    product_ids: idList(raw.product_ids ?? raw.productIds),
    category_ids: idList(raw.category_ids ?? raw.categoryIds),
    brand_ids: idList(raw.brand_ids ?? raw.brandIds),
    exclude_on_sale: parseBoolean(raw.exclude_on_sale ?? raw.excludeOnSale, false),
  };
};
const scopeIsRestricted = (scope) =>
  Boolean(scope && (scope.product_ids?.length || scope.category_ids?.length || scope.brand_ids?.length || scope.exclude_on_sale));

const parseBoolean = (value, fallback = false) => {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "boolean") return value;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
};

export const listCampaigns = async ({ tenantId = null } = {}) => {
  await ensureCouponsSchema();
  const params = tenantId === null ? [] : [tenantId];
  const result = await db.query(
    `
    SELECT c.*,
      COUNT(cp.id)::int AS generated_count,
      COUNT(cp.id) FILTER (WHERE cp.usage_count > 0)::int AS used_count
    FROM coupon_campaigns c
    LEFT JOIN coupons cp ON cp.campaign_id = c.id
    WHERE 1=1 ${tenantFilter(tenantId, "c")}
    GROUP BY c.id
    ORDER BY c.created_at DESC
    `,
    params
  );
  return result.rows;
};

export const createCampaign = async ({ tenantId = null, userId = null, body = {} }) => {
  await ensureCouponsSchema();
  const campaign = normalizeCampaignInput(body);
  const result = await db.query(
    `
    INSERT INTO coupon_campaigns (
      tenant_id, name, code_prefix, discount_type, discount_value, minimum_order_amount,
      max_discount_amount, usage_limit_per_coupon, total_coupons, starts_at, expires_at,
      channel, is_active, created_by, applies_to_shipping,
      usage_limit_per_customer, scope, stack_policy, budget_cap, first_order_only, code_mode, shared_code,
      auto_issue_on_first_order
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
    RETURNING *
    `,
    [
      tenantId,
      campaign.name,
      campaign.code_prefix,
      campaign.discount_type,
      campaign.discount_value,
      campaign.minimum_order_amount,
      campaign.max_discount_amount,
      campaign.usage_limit_per_coupon,
      campaign.total_coupons,
      campaign.starts_at,
      campaign.expires_at,
      campaign.channel,
      campaign.is_active,
      userId,
      campaign.applies_to_shipping,
      campaign.usage_limit_per_customer,
      JSON.stringify(campaign.scope),
      campaign.stack_policy,
      campaign.budget_cap,
      campaign.first_order_only,
      campaign.code_mode,
      campaign.shared_code,
      campaign.auto_issue_on_first_order,
    ]
  );
  const created = result.rows[0];
  if (created && campaign.code_mode === "shared") {
    await ensureSharedCoupon({ tenantId, campaign: created });
  }
  return created;
};

/** A shared campaign is exactly one coupon row whose code is the campaign's shared_code. */
const ensureSharedCoupon = async ({ tenantId = null, campaign, client = db }) => {
  const code = normalizeSharedCode(campaign.shared_code);
  if (!code) return null;
  const existing = await client.query("SELECT * FROM coupons WHERE campaign_id = $1 ORDER BY id ASC LIMIT 1", [campaign.id]);
  if (existing.rows[0]) {
    const updated = await client.query(
      "UPDATE coupons SET code = $2, qr_value = $3, usage_limit = $4, expires_at = $5, updated_at = NOW() WHERE id = $1 RETURNING *",
      [existing.rows[0].id, code, resolveQrValue(code), campaign.usage_limit_per_coupon, campaign.expires_at]
    );
    return updated.rows[0];
  }
  try {
    const inserted = await client.query(
      "INSERT INTO coupons (tenant_id, campaign_id, code, qr_value, usage_limit, expires_at) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *",
      [tenantId, campaign.id, code, resolveQrValue(code), campaign.usage_limit_per_coupon, campaign.expires_at]
    );
    await client.query("UPDATE coupon_campaigns SET total_coupons = 1 WHERE id = $1", [campaign.id]);
    return inserted.rows[0];
  } catch (error) {
    if (error?.code === "23505") {
      const conflict = new Error("This shared code is already used by another campaign");
      conflict.status = 409;
      throw conflict;
    }
    throw error;
  }
};

export const updateCampaign = async ({ tenantId = null, id, body = {} }) => {
  await ensureCouponsSchema();
  const campaign = normalizeCampaignInput(body);
  const params = tenantId === null
    ? [id]
    : [tenantId, id];
  const offset = tenantId === null ? 1 : 2;
  const result = await db.query(
    `
    UPDATE coupon_campaigns
    SET name = $${offset + 1}, code_prefix = $${offset + 2}, discount_type = $${offset + 3},
        discount_value = $${offset + 4}, minimum_order_amount = $${offset + 5},
        max_discount_amount = $${offset + 6}, usage_limit_per_coupon = $${offset + 7},
        starts_at = $${offset + 8}, expires_at = $${offset + 9}, channel = $${offset + 10},
        is_active = $${offset + 11}, applies_to_shipping = $${offset + 12},
        usage_limit_per_customer = $${offset + 13}, scope = $${offset + 14}::jsonb, stack_policy = $${offset + 15},
        budget_cap = $${offset + 16}, first_order_only = $${offset + 17},
        code_mode = $${offset + 18}, shared_code = $${offset + 19},
        auto_issue_on_first_order = $${offset + 20}, updated_at = NOW()
    WHERE id = $${offset} ${tenantId === null ? "" : "AND (tenant_id = $1 OR tenant_id IS NULL)"}
    RETURNING *
    `,
    [
      ...params,
      campaign.name,
      campaign.code_prefix,
      campaign.discount_type,
      campaign.discount_value,
      campaign.minimum_order_amount,
      campaign.max_discount_amount,
      campaign.usage_limit_per_coupon,
      campaign.starts_at,
      campaign.expires_at,
      campaign.channel,
      campaign.is_active,
      campaign.applies_to_shipping,
      campaign.usage_limit_per_customer,
      JSON.stringify(campaign.scope),
      campaign.stack_policy,
      campaign.budget_cap,
      campaign.first_order_only,
      campaign.code_mode,
      campaign.shared_code,
      campaign.auto_issue_on_first_order,
    ]
  );
  const updated = result.rows[0] || null;
  if (updated && campaign.code_mode === "shared") {
    await ensureSharedCoupon({ tenantId, campaign: updated });
  }
  // Keep unused coupons in step with the campaign expiry: extending (or clearing) the campaign
  // date must extend its coupons, otherwise validateCoupon keeps rejecting on the stale row date.
  if (updated) {
    await db.query(
      `UPDATE coupons SET expires_at = $2, updated_at = NOW() WHERE campaign_id = $1 AND usage_count = 0`,
      [updated.id, updated.expires_at]
    );
  }
  return updated;
};

export const deleteCampaign = async ({ tenantId = null, id }) => {
  await ensureCouponsSchema();
  const result = await db.query(
    `DELETE FROM coupon_campaigns WHERE id = $1 ${tenantId === null ? "" : "AND (tenant_id = $2 OR tenant_id IS NULL)"} RETURNING id`,
    tenantId === null ? [id] : [id, tenantId]
  );
  return Boolean(result.rowCount);
};

const randomCodePart = (length = 6) => {
  const bytes = crypto.randomBytes(length);
  let out = "";
  for (const byte of bytes) out += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  return out;
};

export const resolveCouponUrl = (code, publicUrl = "") => {
  const base = String(publicUrl || "").trim().replace(/\/+$/g, "");
  return base ? `${base}/checkout?coupon=${encodeURIComponent(code)}` : String(code || "").trim();
};

const resolveStorefrontUrl = () =>
  String(
    getPublicAppUrl() ||
      process.env.VITE_PUBLIC_STOREFRONT_URL ||
      process.env.PUBLIC_STOREFRONT_URL ||
      "https://m1store-egy.com"
  ).trim();

const resolveQrValue = (code) => resolveCouponUrl(code, resolveStorefrontUrl());

export const generateCoupons = async ({ tenantId = null, campaignId, quantity = null } = {}) => {
  await ensureCouponsSchema();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const campaignResult = await client.query(
      `SELECT * FROM coupon_campaigns WHERE id = $1 ${tenantId === null ? "" : "AND (tenant_id = $2 OR tenant_id IS NULL)"} FOR UPDATE`,
      tenantId === null ? [campaignId] : [campaignId, tenantId]
    );
    const campaign = campaignResult.rows[0];
    if (!campaign) {
      const error = new Error("Campaign not found");
      error.status = 404;
      throw error;
    }
    if (campaign.code_mode === "shared") {
      const shared = await ensureSharedCoupon({ tenantId, campaign, client });
      await client.query("COMMIT");
      return { campaign_id: campaign.id, generated: 0, coupons: shared ? [shared] : [], shared: true };
    }
    const currentCount = Number((await client.query("SELECT COUNT(*)::int AS count FROM coupons WHERE campaign_id = $1", [campaign.id])).rows[0]?.count || 0);
    const target = quantity === null || quantity === undefined || Number(quantity) <= 0
      ? Math.max(0, Number(campaign.total_coupons || 0) - currentCount)
      : Number.parseInt(quantity, 10);
    const created = [];
    let attempts = 0;
    while (created.length < target) {
      attempts += 1;
      if (attempts > target * 20 + 100) {
        const error = new Error("Unable to generate unique coupon codes");
        error.status = 409;
        throw error;
      }
      const code = `${campaign.code_prefix}-${randomCodePart(6)}`;
      try {
        const result = await client.query(
          `
          INSERT INTO coupons (tenant_id, campaign_id, code, qr_value, usage_limit, expires_at)
          VALUES ($1,$2,$3,$4,$5,$6)
          RETURNING *
          `,
          [tenantId, campaign.id, code, resolveQrValue(code), campaign.usage_limit_per_coupon, campaign.expires_at]
        );
        created.push(result.rows[0]);
      } catch (error) {
        if (error?.code !== "23505") throw error;
      }
    }
    const totalResult = await client.query("SELECT COUNT(*)::int AS count FROM coupons WHERE campaign_id = $1", [campaign.id]);
    await client.query("UPDATE coupon_campaigns SET total_coupons = $1, updated_at = NOW() WHERE id = $2", [totalResult.rows[0].count, campaign.id]);
    await client.query("COMMIT");
    return { campaign_id: campaign.id, generated: created.length, coupons: created };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

export const listCoupons = async ({ tenantId = null, campaignId, search = "", status = "all" } = {}) => {
  await ensureCouponsSchema();
  const params = [campaignId];
  let where = "WHERE cp.campaign_id = $1";
  if (tenantId !== null && tenantId !== undefined) {
    params.push(tenantId);
    where += ` AND (cp.tenant_id = $${params.length} OR cp.tenant_id IS NULL)`;
  }
  if (search) {
    params.push(`%${String(search).trim().toUpperCase()}%`);
    where += ` AND cp.code ILIKE $${params.length}`;
  }
  if (status === "used") where += " AND cp.usage_count > 0";
  if (status === "unused") where += " AND cp.usage_count = 0";
  // Assigned to a customer, never sent, never used — the queue that would otherwise sit invisible.
  if (status === "pending_send") where += " AND cp.assigned_customer_id IS NOT NULL AND cp.sent_at IS NULL AND cp.usage_count = 0";
  if (status === "expired") where += " AND cp.expires_at IS NOT NULL AND cp.expires_at < NOW()";
  if (status === "active") where += " AND cp.is_active = TRUE AND (cp.expires_at IS NULL OR cp.expires_at >= NOW())";
  const result = await db.query(
    `
    SELECT cp.*, c.name AS campaign_name, c.discount_type, c.discount_value,
      c.minimum_order_amount, c.max_discount_amount, c.starts_at AS campaign_starts_at,
      c.expires_at AS campaign_expires_at, c.channel, c.usage_limit_per_coupon,
      COALESCE(NULLIF(cu.name, ''), '') AS assigned_customer_name,
      COALESCE(NULLIF(cu.phone, ''), '') AS assigned_customer_phone
    FROM coupons cp
    JOIN coupon_campaigns c ON c.id = cp.campaign_id
    LEFT JOIN customers cu ON cu.id = cp.assigned_customer_id
    ${where}
    ORDER BY cp.created_at DESC
    LIMIT 1000
    `,
    params
  );
  return result.rows;
};

const normalizeSource = (source) => {
  const value = String(source || "website").trim().toLowerCase();
  return VALID_SOURCES.has(value) ? value : "website";
};

export const calculateDiscount = ({ campaign, orderTotal, shippingAmount = 0 }) => {
  const total = Math.max(0, Number(orderTotal || 0));
  let discount;
  if (campaign.discount_type === "free_shipping") {
    discount = Math.max(0, Number(shippingAmount || 0));
    if (campaign.max_discount_amount !== null && campaign.max_discount_amount !== undefined) {
      discount = Math.min(discount, Number(campaign.max_discount_amount || 0));
    }
    return Number(discount.toFixed(2));
  }
  if (campaign.discount_type === "percentage") {
    discount = total * (Number(campaign.discount_value || 0) / 100);
    if (campaign.max_discount_amount !== null && campaign.max_discount_amount !== undefined) {
      discount = Math.min(discount, Number(campaign.max_discount_amount || 0));
    }
  } else {
    discount = Math.min(Number(campaign.discount_value || 0), total);
  }
  return Number(Math.max(0, Math.min(discount, total)).toFixed(2));
};

const normalizeItems = (items) =>
  (Array.isArray(items) ? items : [])
    .map((item) => ({
      product_id: Number.parseInt(item?.product_id ?? item?.productId ?? item?.id, 10) || null,
      variant_id: Number.parseInt(item?.variant_id ?? item?.variantId ?? item?.matched_variant_id, 10) || null,
      price: Math.max(0, Number(item?.price ?? item?.unit_price ?? 0) || 0),
      quantity: Math.max(0, Number(item?.quantity ?? item?.qty ?? 1) || 0),
    }))
    .filter((item) => item.quantity > 0);

/**
 * Which lines does this campaign's scope cover? Returns { eligible, ineligible, eligibleSum, rawSum }.
 * "On sale" = the paid line price is below the product's list selling price (channel independent).
 */
const resolveScopedItems = async ({ client, scope, items }) => {
  const rawSum = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  if (!scopeIsRestricted(scope) || !items.length) {
    return { eligible: items, ineligible: [], eligibleSum: rawSum, rawSum };
  }
  const productIds = [...new Set(items.map((item) => item.product_id).filter(Boolean))];
  const lookup = new Map();
  if (productIds.length) {
    const result = await client.query(
      `SELECT id, category_id, brand_id,
              COALESCE(NULLIF(selling_price, 0), NULLIF(price, 0), NULLIF(regular_price, 0), 0)::numeric AS list_price
       FROM products WHERE id = ANY($1::bigint[])`,
      [productIds]
    );
    for (const row of result.rows) lookup.set(Number(row.id), row);
  }
  const productSet = new Set(scope.product_ids);
  const categorySet = new Set(scope.category_ids);
  const brandSet = new Set(scope.brand_ids);
  const hasInclusion = productSet.size || categorySet.size || brandSet.size;
  const eligible = [];
  const ineligible = [];
  for (const item of items) {
    const product = lookup.get(Number(item.product_id));
    let ok = true;
    if (hasInclusion) {
      ok = productSet.has(Number(item.product_id))
        || (product && categorySet.has(Number(product.category_id)))
        || (product && brandSet.has(Number(product.brand_id)));
    }
    if (ok && scope.exclude_on_sale && product) {
      const listPrice = Number(product.list_price || 0);
      if (listPrice > 0 && item.price < listPrice - 0.009) ok = false;
    }
    (ok ? eligible : ineligible).push(item);
  }
  const eligibleSum = eligible.reduce((sum, item) => sum + item.price * item.quantity, 0);
  return { eligible, ineligible, eligibleSum, rawSum };
};

/**
 * orderTotal    = goods base (subtotal minus non-coupon discounts), WITHOUT shipping / service fees.
 * shippingAmount= delivery / service fee; folded into the base only when applies_to_shipping, and the
 *                 whole of it is the discount for free_shipping campaigns.
 * items         = [{ product_id, variant_id, price, quantity }] — needed for scoped campaigns.
 * appliedDiscounts = { loyalty, invoice } already on the order, for the stack policy.
 * excludeOrderId  = re-validating a coupon ALREADY redeemed on that order (an edit). Its own
 *                   redemption is discounted from the usage count, the per-customer limit and the
 *                   budget, so re-checking an edited order does not reject the coupon it already has.
 */
export const validateCoupon = async ({
  tenantId = null,
  code,
  orderTotal = 0,
  shippingAmount = 0,
  items = [],
  appliedDiscounts = {},
  source = "website",
  customerId = null,
  excludeOrderId = null,
  client = db,
  lock = false,
} = {}) => {
  const safeExcludeOrderId = Number.parseInt(excludeOrderId, 10) || null;
  await ensureCouponsSchema(client);
  const safeCode = String(code || "").trim().toUpperCase();
  const safeSource = normalizeSource(source);
  const goodsTotal = Math.max(0, Number(orderTotal || 0));
  const shipping = Math.max(0, Number(shippingAmount || 0));
  const lines = normalizeItems(items);
  let total = goodsTotal;
  const invalid = (reason, extra = {}) => ({ valid: false, coupon: null, campaign: null, discount_amount: 0, free_shipping: false, final_total: Math.max(0, total), reason, ...extra });
  if (!safeCode) return invalid("Coupon code is required");

  const params = [safeCode];
  let tenantSql = "";
  if (tenantId !== null && tenantId !== undefined) {
    params.push(tenantId);
    tenantSql = ` AND (cp.tenant_id = $${params.length} OR cp.tenant_id IS NULL)`;
  }
  const result = await client.query(
    `
    SELECT cp.*, c.name AS campaign_name, c.discount_type, c.discount_value,
      c.minimum_order_amount, c.max_discount_amount, c.starts_at AS campaign_starts_at,
      c.expires_at AS campaign_expires_at, c.channel, c.is_active AS campaign_is_active,
      c.code_prefix, c.total_coupons, c.applies_to_shipping,
      c.usage_limit_per_customer, c.scope, c.stack_policy, c.budget_cap, c.first_order_only
    FROM coupons cp
    JOIN coupon_campaigns c ON c.id = cp.campaign_id
    WHERE cp.code = $1 ${tenantSql}
    ${lock ? "FOR UPDATE OF cp" : ""}
    LIMIT 1
    `,
    params
  );
  const row = result.rows[0];
  if (!row) return invalid("Coupon not found");
  const campaign = {
    id: row.campaign_id,
    name: row.campaign_name,
    discount_type: row.discount_type,
    discount_value: Number(row.discount_value || 0),
    minimum_order_amount: Number(row.minimum_order_amount || 0),
    max_discount_amount: row.max_discount_amount,
    starts_at: row.campaign_starts_at,
    expires_at: row.campaign_expires_at,
    channel: row.channel,
    is_active: row.campaign_is_active,
    applies_to_shipping: Boolean(row.applies_to_shipping),
    usage_limit_per_customer: row.usage_limit_per_customer === null ? null : Number(row.usage_limit_per_customer),
    scope: normalizeScope(row.scope),
    stack_policy: VALID_STACK_POLICIES.has(row.stack_policy) ? row.stack_policy : "all",
    budget_cap: row.budget_cap === null || row.budget_cap === undefined ? null : Number(row.budget_cap),
    first_order_only: Boolean(row.first_order_only),
  };
  const coupon = {
    id: row.id,
    campaign_id: row.campaign_id,
    code: row.code,
    qr_value: row.qr_value,
    usage_count: Number(row.usage_count || 0),
    usage_limit: Number(row.usage_limit || 1),
    assigned_customer_id: row.assigned_customer_id,
    is_active: row.is_active,
    expires_at: row.expires_at,
  };
  const now = Date.now();
  if (!coupon.is_active) return { ...invalid("Coupon is inactive"), coupon, campaign };
  if (!campaign.is_active) return { ...invalid("Campaign is inactive"), coupon, campaign };
  if (campaign.starts_at && new Date(campaign.starts_at).getTime() > now) return { ...invalid("Campaign has not started"), coupon, campaign };
  if (campaign.expires_at && new Date(campaign.expires_at).getTime() < now) return { ...invalid("Campaign has expired"), coupon, campaign };
  if (coupon.expires_at && new Date(coupon.expires_at).getTime() < now) return { ...invalid("Coupon has expired"), coupon, campaign };
  let ownUses = 0;
  if (safeExcludeOrderId) {
    const own = await client.query(
      "SELECT COUNT(*)::int AS n FROM coupon_redemptions WHERE coupon_id = $1 AND order_id = $2 AND reversed_at IS NULL",
      [coupon.id, safeExcludeOrderId]
    );
    ownUses = Number(own.rows[0]?.n || 0);
  }
  if (coupon.usage_count - ownUses >= coupon.usage_limit) return { ...invalid("Coupon usage limit reached"), coupon, campaign };
  if (!["all", safeSource].includes(campaign.channel) && !(campaign.channel === "offline" && safeSource === "pos")) {
    return { ...invalid("Coupon is not valid for this channel"), coupon, campaign };
  }
  if (coupon.assigned_customer_id && customerId && String(coupon.assigned_customer_id) !== String(customerId)) {
    return { ...invalid("Coupon is assigned to another customer"), coupon, campaign };
  }

  // --- stack policy
  const loyaltyApplied = Math.max(0, Number(appliedDiscounts?.loyalty || 0));
  const invoiceApplied = Math.max(0, Number(appliedDiscounts?.invoice || 0));
  if (campaign.stack_policy === "none" && (loyaltyApplied > 0 || invoiceApplied > 0)) {
    return { ...invalid("Coupon cannot be combined with other discounts"), coupon, campaign };
  }
  if (campaign.stack_policy === "with_loyalty" && invoiceApplied > 0) {
    return { ...invalid("Coupon cannot be combined with an invoice discount"), coupon, campaign };
  }
  if (campaign.stack_policy === "with_invoice_discount" && loyaltyApplied > 0) {
    return { ...invalid("Coupon cannot be combined with loyalty points"), coupon, campaign };
  }

  // --- per-customer limit, first order only, budget cap (all need the DB)
  if (campaign.usage_limit_per_customer && customerId) {
    const used = await client.query(
      `SELECT COUNT(*)::int AS n FROM coupon_redemptions
       WHERE campaign_id = $1 AND customer_id = $2 AND reversed_at IS NULL
         AND ($3::bigint IS NULL OR order_id IS DISTINCT FROM $3::bigint)`,
      [campaign.id, customerId, safeExcludeOrderId]
    );
    if (Number(used.rows[0]?.n || 0) >= campaign.usage_limit_per_customer) {
      return { ...invalid("Coupon usage limit for this customer reached"), coupon, campaign };
    }
  }
  if (campaign.first_order_only && customerId) {
    const prior = await client.query(
      `SELECT 1 FROM orders
       WHERE customer_id = $1 AND LOWER(COALESCE(status, '')) NOT IN ('cancelled', 'canceled', 'void')
         AND ($2::bigint IS NULL OR id IS DISTINCT FROM $2::bigint)
       LIMIT 1`,
      [customerId, safeExcludeOrderId]
    );
    if (prior.rowCount) return { ...invalid("Coupon is for first orders only"), coupon, campaign };
  }

  // --- scope → eligible base
  const scoped = await resolveScopedItems({ client, scope: campaign.scope, items: lines });
  let eligibleBase = goodsTotal;
  if (scopeIsRestricted(campaign.scope) && lines.length) {
    if (!scoped.eligible.length) return { ...invalid("Coupon does not apply to the items in this order"), coupon, campaign };
    // Scale the eligible line sum by the ratio goodsTotal/rawSum so invoice-level discounts are shared pro rata.
    const ratio = scoped.rawSum > 0 ? Math.min(1, goodsTotal / scoped.rawSum) : 1;
    eligibleBase = Number((scoped.eligibleSum * ratio).toFixed(2));
  }
  if (campaign.applies_to_shipping && campaign.discount_type !== "free_shipping") total = eligibleBase + shipping;
  else total = eligibleBase;

  if (campaign.minimum_order_amount > goodsTotal) return { ...invalid("Minimum order amount not reached"), coupon, campaign };
  if (campaign.discount_type === "fixed" && Number(campaign.discount_value || 0) > total) {
    return { ...invalid("Fixed coupon discount exceeds order total"), coupon, campaign };
  }
  if (campaign.discount_type === "free_shipping" && shipping <= 0) {
    return { ...invalid("Free shipping coupon needs a shipping fee to waive"), coupon, campaign };
  }
  const discount = calculateDiscount({ campaign, orderTotal: total, shippingAmount: shipping });

  if (campaign.budget_cap !== null) {
    const spent = await client.query(
      `SELECT COALESCE(SUM(discount_amount), 0)::numeric AS n FROM coupon_redemptions
       WHERE campaign_id = $1 AND reversed_at IS NULL
         AND ($2::bigint IS NULL OR order_id IS DISTINCT FROM $2::bigint)`,
      [campaign.id, safeExcludeOrderId]
    );
    if (Number(spent.rows[0]?.n || 0) + discount > campaign.budget_cap + 0.009) {
      return { ...invalid("Campaign budget exhausted"), coupon, campaign };
    }
  }

  return {
    valid: true,
    coupon,
    campaign,
    discount_amount: discount,
    free_shipping: campaign.discount_type === "free_shipping",
    base_total: Number(total.toFixed(2)),
    eligible_item_count: scoped.eligible.length,
    ineligible_item_count: scoped.ineligible.length,
    final_total: Number(Math.max(0, total - discount).toFixed(2)),
    reason: "valid",
  };
};

export const redeemCoupon = async ({ tenantId = null, code, orderId = null, customerId = null, source = "pos", orderTotal = 0, shippingAmount = 0, items = [], appliedDiscounts = {}, client: existingClient = null } = {}) => {
  const ownClient = !existingClient;
  const client = existingClient || await db.connect();
  try {
    if (ownClient) await client.query("BEGIN");
    const validation = await validateCoupon({ tenantId, code, orderTotal, shippingAmount, items, appliedDiscounts, source, customerId, client, lock: true });
    if (!validation.valid) {
      const error = new Error(validation.reason || "Coupon is invalid");
      error.status = 400;
      error.validation = validation;
      throw error;
    }
    const nextUsage = Number(validation.coupon.usage_count || 0) + 1;
    const reachedLimit = nextUsage >= Number(validation.coupon.usage_limit || 1);
    const couponResult = await client.query(
      `
      UPDATE coupons
      SET usage_count = usage_count + 1,
          used_by_customer_id = COALESCE(used_by_customer_id, $2),
          used_order_id = COALESCE(used_order_id, $3),
          used_at = CASE WHEN used_at IS NULL OR $4::boolean THEN NOW() ELSE used_at END,
          updated_at = NOW()
      WHERE id = $1
      RETURNING *
      `,
      [validation.coupon.id, customerId || null, orderId || null, reachedLimit]
    );
    const redemptionResult = await client.query(
      `
      INSERT INTO coupon_redemptions (
        tenant_id, coupon_id, campaign_id, order_id, customer_id, source,
        order_total, discount_amount, final_total
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING *
      `,
      [
        tenantId,
        validation.coupon.id,
        validation.campaign.id,
        orderId,
        customerId,
        normalizeSource(source),
        validation.base_total,
        validation.discount_amount,
        validation.final_total,
      ]
    );
    if (orderId) {
      await client.query(
        `
        UPDATE orders
        SET coupon_id = $1, coupon_code = $2, coupon_discount_amount = $3, updated_at = NOW()
        WHERE id = $4
        `,
        [validation.coupon.id, validation.coupon.code, validation.discount_amount, orderId]
      );
    }
    if (ownClient) await client.query("COMMIT");
    return { ...validation, coupon: couponResult.rows[0], redemption: redemptionResult.rows[0] };
  } catch (error) {
    if (ownClient) await client.query("ROLLBACK");
    throw error;
  } finally {
    if (ownClient) client.release();
  }
};

/**
 * Phase 2 — lifecycle. A cancelled / deleted / fully returned order gives its coupon back:
 * the redemption row is kept (audit) but marked reversed, the coupon's usage_count drops, and
 * the order's coupon columns are cleared so reports stop counting the discount.
 */
export const releaseCouponForOrder = async ({ client = db, orderId, reason = "order_cancelled" } = {}) => {
  const safeOrderId = Number.parseInt(orderId, 10);
  if (!safeOrderId) return { released: 0 };
  const redemptions = await client.query(
    `UPDATE coupon_redemptions
     SET reversed_at = NOW(), reversal_reason = $2
     WHERE order_id = $1 AND reversed_at IS NULL
     RETURNING id, coupon_id, campaign_id, discount_amount`,
    [safeOrderId, String(reason || "order_cancelled").slice(0, 80)]
  );
  for (const row of redemptions.rows) {
    await client.query(
      `UPDATE coupons
       SET usage_count = GREATEST(0, usage_count - 1),
           used_order_id = CASE WHEN used_order_id = $2 THEN NULL ELSE used_order_id END,
           used_at = CASE WHEN GREATEST(0, usage_count - 1) = 0 THEN NULL ELSE used_at END,
           updated_at = NOW()
       WHERE id = $1`,
      [row.coupon_id, safeOrderId]
    );
  }
  if (redemptions.rowCount) {
    console.log("[coupons] released", { orderId: safeOrderId, reason, redemptions: redemptions.rowCount });
  }
  return { released: redemptions.rowCount, redemptions: redemptions.rows };
};

/**
 * An edited order changed value: move its existing redemption row to the new figures rather than
 * writing a second one, so campaign stats, the budget cap and the per-customer limit stay honest.
 */
export const syncRedemptionForOrder = async ({ client = db, orderId, orderTotal = 0, discountAmount = 0, finalTotal = 0 } = {}) => {
  const safeOrderId = Number.parseInt(orderId, 10);
  if (!safeOrderId) return { updated: 0 };
  const result = await client.query(
    `UPDATE coupon_redemptions
     SET order_total = $2, discount_amount = $3, final_total = $4
     WHERE order_id = $1 AND reversed_at IS NULL
     RETURNING id`,
    [safeOrderId, Number(orderTotal || 0), Number(discountAmount || 0), Number(finalTotal || 0)]
  );
  return { updated: result.rowCount };
};

/** After a return is recorded: if every line of the order is now returned, give the coupon back. */
export const releaseCouponIfFullyReturned = async ({ client = db, orderId } = {}) => {
  const safeOrderId = Number.parseInt(orderId, 10);
  if (!safeOrderId) return { released: 0 };
  const remaining = await client.query(
    `SELECT COALESCE(SUM(GREATEST(0, COALESCE(quantity, 0) - COALESCE(returned_quantity, 0))), 0)::int AS remaining
     FROM order_items WHERE order_id = $1`,
    [safeOrderId]
  );
  if (Number(remaining.rows[0]?.remaining || 0) > 0) return { released: 0 };
  return releaseCouponForOrder({ client, orderId: safeOrderId, reason: "order_fully_returned" });
};

/**
 * Phase 3 — hand a coupon to a specific customer. Reuses an unused, unassigned coupon of the
 * campaign (or mints one for unique campaigns); shared campaigns just return the shared code.
 * Returns the coupon plus a ready-to-send WhatsApp message / link — nothing is sent here.
 */
export const assignCouponToCustomer = async ({ tenantId = null, campaignId, customerId, userId = null } = {}) => {
  await ensureCouponsSchema();
  const safeCustomerId = Number.parseInt(customerId, 10);
  if (!safeCustomerId) {
    const error = new Error("customer_id is required");
    error.status = 400;
    throw error;
  }
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const campaignResult = await client.query(
      `SELECT * FROM coupon_campaigns WHERE id = $1 ${tenantId === null ? "" : "AND (tenant_id = $2 OR tenant_id IS NULL)"} FOR UPDATE`,
      tenantId === null ? [campaignId] : [campaignId, tenantId]
    );
    const campaign = campaignResult.rows[0];
    if (!campaign) {
      const error = new Error("Campaign not found");
      error.status = 404;
      throw error;
    }
    const customerResult = await client.query("SELECT id, name, phone FROM customers WHERE id = $1", [safeCustomerId]);
    const customer = customerResult.rows[0];
    if (!customer) {
      const error = new Error("Customer not found");
      error.status = 404;
      throw error;
    }
    let coupon = null;
    if (campaign.code_mode === "shared") {
      coupon = await ensureSharedCoupon({ tenantId, campaign, client });
    } else {
      const already = await client.query(
        "SELECT * FROM coupons WHERE campaign_id = $1 AND assigned_customer_id = $2 AND usage_count < usage_limit AND is_active = TRUE ORDER BY id ASC LIMIT 1",
        [campaign.id, safeCustomerId]
      );
      coupon = already.rows[0] || null;
      if (!coupon) {
        const free = await client.query(
          "SELECT * FROM coupons WHERE campaign_id = $1 AND assigned_customer_id IS NULL AND usage_count = 0 AND is_active = TRUE ORDER BY id ASC LIMIT 1 FOR UPDATE SKIP LOCKED",
          [campaign.id]
        );
        coupon = free.rows[0] || null;
      }
      if (!coupon) {
        let attempts = 0;
        while (!coupon && attempts < 50) {
          attempts += 1;
          const code = `${campaign.code_prefix}-${randomCodePart(6)}`;
          try {
            const inserted = await client.query(
              "INSERT INTO coupons (tenant_id, campaign_id, code, qr_value, usage_limit, expires_at) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *",
              [tenantId, campaign.id, code, resolveQrValue(code), campaign.usage_limit_per_coupon, campaign.expires_at]
            );
            coupon = inserted.rows[0];
            await client.query("UPDATE coupon_campaigns SET total_coupons = (SELECT COUNT(*) FROM coupons WHERE campaign_id = $1) WHERE id = $1", [campaign.id]);
          } catch (error) {
            if (error?.code !== "23505") throw error;
          }
        }
      }
      if (!coupon) {
        const error = new Error("Unable to allocate a coupon");
        error.status = 409;
        throw error;
      }
      if (String(coupon.assigned_customer_id || "") !== String(safeCustomerId)) {
        const assigned = await client.query(
          "UPDATE coupons SET assigned_customer_id = $2, assigned_at = NOW(), updated_at = NOW() WHERE id = $1 RETURNING *",
          [coupon.id, safeCustomerId]
        );
        coupon = assigned.rows[0];
      }
    }
    await client.query("COMMIT");
    const link = coupon.qr_value || resolveQrValue(coupon.code);
    const discountLabel = campaign.discount_type === "percentage"
      ? `${Number(campaign.discount_value)}%`
      : campaign.discount_type === "free_shipping" ? "شحن مجاني" : `${Number(campaign.discount_value)} ج.م`;
    const message = `أهلاً ${customer.name || ""}\nكود خصم ${discountLabel} خاص بيك: ${coupon.code}\n${link}${campaign.expires_at ? `\nصالح حتى ${formatCouponDate(campaign.expires_at)}` : ""}`.trim();
    const phoneDigits = String(customer.phone || "").replace(/\D+/g, "");
    return {
      coupon,
      customer,
      message,
      whatsapp_url: phoneDigits ? `https://wa.me/${phoneDigits.startsWith("20") ? phoneDigits : phoneDigits.replace(/^0/, "20")}?text=${encodeURIComponent(message)}` : "",
      assigned_by: userId,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Send an assigned coupon to the customer over WhatsApp and drop the message into the AI Inbox
 * thread, so the coupon hand-off lives in the same conversation history as everything else.
 *
 * Human-initiated only (a manager clicks Send). It deliberately does NOT consult the restock
 * messaging mode: that gate governs unattended/AI messaging, and this is the manual path —
 * the same policy as a manual reply typed in the Inbox.
 *
 * Assignment is idempotent, so pressing Send twice re-sends the SAME code rather than minting
 * a second one. Persistence follows the canonical outbound-by-phone path used by restock
 * notifications, and runs only after the provider confirms the send — no ghost messages.
 */
export const sendAssignedCouponToCustomer = async ({ tenantId = null, campaignId, customerId, userId = null, message: overrideMessage = "" } = {}) => {
  const assignment = await assignCouponToCustomer({ tenantId, campaignId, customerId, userId });
  const phone = String(assignment.customer?.phone || "").trim();
  if (!phone) {
    const error = new Error("This customer has no phone number on file");
    error.status = 400;
    error.code = "CUSTOMER_PHONE_MISSING";
    throw error;
  }
  const text = String(overrideMessage || assignment.message || "").trim();
  if (!text) {
    const error = new Error("Message body is required");
    error.status = 400;
    throw error;
  }

  const { sendTextMessage } = await import("./whatsappGatewayService.js");
  const result = await sendTextMessage({ phone, message: text });
  const providerMessageId = result?.result?.key?.id || result?.message_id || result?.key?.id || null;
  const sent = Boolean(result?.success ?? result?.sent ?? providerMessageId);
  if (!sent) {
    const error = new Error("WhatsApp did not accept the message");
    error.status = 502;
    error.code = "WHATSAPP_SEND_FAILED";
    throw error;
  }

  // Best-effort: a delivered coupon must never be reported as failed because the Inbox row did not write.
  try {
    const { normalizeWhatsappSessionId, normalizeWhatsappPhone } = await import("../utils/whatsappIdentity.js");
    const { appendChannelOutboundSupportReply } = await import("./aiSupportLogService.js");
    const canonicalPhone = normalizeWhatsappPhone(phone) || phone;
    const sessionId = normalizeWhatsappSessionId(phone, canonicalPhone) || `whatsapp:${canonicalPhone}`;
    await appendChannelOutboundSupportReply({
      tenantId,
      channel: "whatsapp",
      sessionId,
      resolvedPhone: canonicalPhone,
      message: text,
      providerMessageId,
      externalMessageId: providerMessageId,
      deliveryStatus: "sent",
      senderType: "system",
      source: "coupon_assignment",
      sessionSource: "coupon_assignment",
      sourcePath: "coupon_assignment",
      insertSource: "coupon_assignment",
    });
    const { upsertChannelConversationMapping } = await import("./aiChannelAdapterService.js");
    await upsertChannelConversationMapping({
      tenantId,
      channel: "whatsapp",
      externalConversationId: sessionId,
      externalCustomerId: canonicalPhone,
      lastMessageAt: new Date(),
    });
  } catch (error) {
    console.error("[coupons] inbox persist failed after a confirmed send", String(error?.message || error).slice(0, 160));
  }

  try {
    await db.query("UPDATE coupons SET sent_at = NOW(), sent_by = $2, updated_at = NOW() WHERE id = $1", [assignment.coupon?.id, userId || null]);
  } catch (error) {
    console.error("[coupons] could not stamp sent_at", String(error?.message || error).slice(0, 140));
  }

  console.log("[coupons] sent to customer", {
    campaign_id: campaignId,
    customer_id: assignment.customer?.id,
    code: assignment.coupon?.code,
    provider_message_id: providerMessageId,
    by_user: userId,
  });
  return { ...assignment, sent: true, provider_message_id: providerMessageId, message: text };
};

/** Hard ceiling on one bulk run: WhatsApp throttles a number that fires a long burst. */
export const BULK_SEND_MAX = 50;
const BULK_SEND_DELAY_MS = 1200;
const pause = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/**
 * Send every coupon of a campaign that a manager already assigned to a customer but never sent.
 *
 * Only the pending queue — never "all customers" — so a bulk run can only ever reach people the
 * manager deliberately picked. Sends are sequential with a pause between them rather than
 * concurrent: a burst is what gets a WhatsApp number throttled or banned.
 *
 * One failure never stops the run; each coupon's outcome is reported back. Because
 * sendAssignedCouponToCustomer stamps sent_at only after the provider confirms, re-running this
 * retries exactly the ones that did not go out and re-sends nothing that did.
 */
export const sendPendingCouponsForCampaign = async ({ tenantId = null, campaignId, userId = null, limit = BULK_SEND_MAX } = {}) => {
  await ensureCouponsSchema();
  const cap = Math.min(BULK_SEND_MAX, Math.max(1, Number.parseInt(limit, 10) || BULK_SEND_MAX));
  const params = [campaignId];
  let tenantSql = "";
  if (tenantId !== null && tenantId !== undefined) {
    params.push(tenantId);
    tenantSql = ` AND (cp.tenant_id = $${params.length} OR cp.tenant_id IS NULL)`;
  }
  params.push(cap);
  const pending = await db.query(
    `SELECT cp.id, cp.code, cp.assigned_customer_id,
            COALESCE(NULLIF(cu.name, ''), '') AS customer_name,
            COALESCE(NULLIF(cu.phone, ''), '') AS customer_phone
     FROM coupons cp
     LEFT JOIN customers cu ON cu.id = cp.assigned_customer_id
     WHERE cp.campaign_id = $1
       AND cp.assigned_customer_id IS NOT NULL
       AND cp.sent_at IS NULL
       AND cp.usage_count = 0
       AND cp.is_active = TRUE
       AND (cp.expires_at IS NULL OR cp.expires_at >= NOW())
       ${tenantSql}
     ORDER BY cp.assigned_at ASC NULLS LAST, cp.id ASC
     LIMIT $${params.length}`,
    params
  );

  const results = [];
  let sent = 0;
  let failed = 0;
  for (const [index, row] of pending.rows.entries()) {
    if (index > 0) await pause(BULK_SEND_DELAY_MS);
    try {
      const result = await sendAssignedCouponToCustomer({
        tenantId,
        campaignId,
        customerId: row.assigned_customer_id,
        userId,
      });
      sent += 1;
      results.push({
        coupon_id: row.id,
        code: result?.coupon?.code || row.code,
        customer_id: row.assigned_customer_id,
        customer_name: row.customer_name,
        sent: true,
      });
    } catch (error) {
      failed += 1;
      results.push({
        coupon_id: row.id,
        code: row.code,
        customer_id: row.assigned_customer_id,
        customer_name: row.customer_name,
        sent: false,
        reason: error?.code || error?.message || "send_failed",
      });
      console.error("[coupons] bulk send item failed", {
        campaign_id: campaignId,
        coupon_id: row.id,
        reason: error?.code || error?.message,
      });
    }
  }
  console.log("[coupons] bulk send finished", { campaign_id: campaignId, queued: pending.rowCount, sent, failed, by_user: userId });
  return { queued: pending.rowCount, sent, failed, capped: pending.rowCount >= cap, results };
};

/**
 * Phase 3.1 — after a customer's FIRST order, hand them a coupon from every campaign flagged
 * auto_issue_on_first_order. Called post-commit, fire-and-forget: it never throws into checkout.
 * Idempotent — assignCouponToCustomer reuses an unused coupon already assigned to that customer.
 */
export const issueFirstOrderCoupons = async ({ tenantId = null, customerId, orderId = null } = {}) => {
  const safeCustomerId = Number.parseInt(customerId, 10);
  if (!safeCustomerId) return { issued: [] };
  await ensureCouponsSchema();

  // "First order" = this one is the only non-cancelled order the customer has.
  const orderCount = await db.query(
    `SELECT COUNT(*)::int AS n FROM orders
     WHERE customer_id = $1 AND LOWER(COALESCE(status, '')) NOT IN ('cancelled', 'canceled', 'void')`,
    [safeCustomerId]
  );
  if (Number(orderCount.rows[0]?.n || 0) > 1) return { issued: [], reason: "not_first_order" };

  const params = [];
  let tenantSql = "";
  if (tenantId !== null && tenantId !== undefined) {
    params.push(tenantId);
    tenantSql = ` AND (tenant_id = $${params.length} OR tenant_id IS NULL)`;
  }
  const campaigns = await db.query(
    `SELECT id, name FROM coupon_campaigns
     WHERE auto_issue_on_first_order = TRUE
       AND is_active = TRUE
       AND (starts_at IS NULL OR starts_at <= NOW())
       AND (expires_at IS NULL OR expires_at >= NOW())
       ${tenantSql}
     ORDER BY id ASC`,
    params
  );
  const issued = [];
  for (const campaign of campaigns.rows) {
    try {
      const assignment = await assignCouponToCustomer({ tenantId, campaignId: campaign.id, customerId: safeCustomerId });
      issued.push({ campaign_id: campaign.id, campaign_name: campaign.name, ...assignment });
      console.log("[coupons] auto-issued after first order", {
        campaign_id: campaign.id,
        customer_id: safeCustomerId,
        order_id: orderId,
        code: assignment?.coupon?.code,
      });
    } catch (error) {
      console.error("[coupons] auto-issue failed", { campaign_id: campaign.id, customer_id: safeCustomerId, message: error?.message });
    }
  }
  return { issued };
};

/** Redemption log for one coupon or a whole campaign (manager UI). */
export const listRedemptions = async ({ tenantId = null, campaignId = null, couponId = null, limit = 200 } = {}) => {
  await ensureCouponsSchema();
  const params = [];
  const where = [];
  if (campaignId) { params.push(campaignId); where.push(`r.campaign_id = $${params.length}`); }
  if (couponId) { params.push(couponId); where.push(`r.coupon_id = $${params.length}`); }
  if (tenantId !== null && tenantId !== undefined) { params.push(tenantId); where.push(`(r.tenant_id = $${params.length} OR r.tenant_id IS NULL)`); }
  params.push(Math.min(1000, Math.max(1, Number(limit) || 200)));
  const result = await db.query(
    `
    SELECT r.id, r.coupon_id, r.campaign_id, r.order_id, r.customer_id, r.source, r.order_total, r.discount_amount,
           r.final_total, r.used_at, r.reversed_at, r.reversal_reason,
           cp.code AS coupon_code,
           o.invoice_number, o.public_order_number, o.status AS order_status,
           COALESCE(NULLIF(cu.name, ''), NULLIF(o.customer_name, ''), '') AS customer_name,
           COALESCE(NULLIF(cu.phone, ''), NULLIF(o.customer_phone, ''), '') AS customer_phone
    FROM coupon_redemptions r
    JOIN coupons cp ON cp.id = r.coupon_id
    LEFT JOIN orders o ON o.id = r.order_id
    LEFT JOIN customers cu ON cu.id = r.customer_id
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY r.used_at DESC
    LIMIT $${params.length}
    `,
    params
  );
  return result.rows;
};

export const getCampaignStats = async ({ tenantId = null, campaignId }) => {
  await ensureCouponsSchema();
  const params = [campaignId];
  let tenantSql = "";
  if (tenantId !== null && tenantId !== undefined) {
    params.push(tenantId);
    tenantSql = ` AND (c.tenant_id = $${params.length} OR c.tenant_id IS NULL)`;
  }
  const result = await db.query(
    `
    SELECT
      COUNT(c.id)::int AS total_coupons,
      COUNT(c.id) FILTER (WHERE c.usage_count > 0)::int AS used_coupons,
      COUNT(c.id) FILTER (WHERE c.usage_count = 0)::int AS unused_coupons,
      COUNT(c.id) FILTER (WHERE c.expires_at IS NOT NULL AND c.expires_at < NOW())::int AS expired_coupons,
      COUNT(c.id) FILTER (WHERE c.assigned_customer_id IS NOT NULL)::int AS assigned_coupons,
      COUNT(c.id) FILTER (WHERE c.assigned_customer_id IS NOT NULL AND c.sent_at IS NULL AND c.usage_count = 0)::int AS pending_send_coupons,
      COUNT(r.id)::int AS total_redemptions,
      COALESCE(SUM(r.discount_amount), 0)::numeric AS total_discount_amount,
      COALESCE(SUM(r.order_total), 0)::numeric AS total_sales_amount,
      COALESCE(SUM(r.final_total), 0)::numeric AS net_sales_amount,
      COALESCE(AVG(r.order_total), 0)::numeric AS average_order_total
    FROM coupons c
    LEFT JOIN coupon_redemptions r ON r.coupon_id = c.id AND r.reversed_at IS NULL
    WHERE c.campaign_id = $1 ${tenantSql}
    `,
    params
  );
  const stats = result.rows[0] || {};
  const total = Number(stats.total_coupons || 0);
  const used = Number(stats.used_coupons || 0);
  const assigned = Number(stats.assigned_coupons || 0);
  const redemptions = Number(stats.total_redemptions || 0);
  // Baseline: orders in the campaign window WITHOUT any coupon (same tenant scope), for an uplift read.
  const baselineParams = [campaignId];
  let baselineTenantSql = "";
  if (tenantId !== null && tenantId !== undefined) {
    baselineParams.push(tenantId);
    baselineTenantSql = ` AND (o.tenant_id = $${baselineParams.length} OR o.tenant_id IS NULL)`;
  }
  let baseline = { n: 0, avg: 0 };
  try {
    const baselineResult = await db.query(
      `
      SELECT COUNT(o.id)::int AS n, COALESCE(AVG(COALESCE(o.total_amount, o.total, 0)), 0)::numeric AS avg
      FROM orders o, coupon_campaigns c
      WHERE c.id = $1
        AND COALESCE(o.coupon_id, 0) = 0
        AND o.created_at >= COALESCE(c.starts_at, c.created_at)
        AND o.created_at <= COALESCE(c.expires_at, NOW())
        AND LOWER(COALESCE(o.status, '')) NOT IN ('cancelled', 'canceled', 'void')
        ${baselineTenantSql}
      `,
      baselineParams
    );
    baseline = baselineResult.rows[0] || baseline;
  } catch (error) {
    console.warn("[coupons] baseline stats skipped:", error.message);
  }
  const isShared = total === 1 && Number(stats.total_redemptions || 0) > used;
  return {
    total_coupons: total,
    used_coupons: used,
    assigned_coupons: assigned,
    pending_send_coupons: Number(stats.pending_send_coupons || 0),
    net_sales_amount: Number(stats.net_sales_amount || 0),
    // Conversion = redemptions over what was actually handed out (assigned), falling back to generated.
    conversion_rate: assigned > 0 ? Number(((redemptions / assigned) * 100).toFixed(2)) : total > 0 ? Number(((used / total) * 100).toFixed(2)) : 0,
    conversion_basis: assigned > 0 ? "assigned" : "generated",
    baseline_orders_without_coupon: Number(baseline.n || 0),
    average_order_without_coupon: Number(baseline.avg || 0),
    is_shared_code: isShared,
    unused_coupons: Number(stats.unused_coupons || 0),
    expired_coupons: Number(stats.expired_coupons || 0),
    total_redemptions: Number(stats.total_redemptions || 0),
    total_discount_amount: Number(stats.total_discount_amount || 0),
    total_sales_amount: Number(stats.total_sales_amount || 0),
    average_order_total: Number(stats.average_order_total || 0),
  };
};

export const exportCouponsCsv = async ({ tenantId = null, campaignId }) => {
  const rows = await listCoupons({ tenantId, campaignId });
  const escape = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const header = ["code", "campaign", "discount_type", "discount_value", "usage_count", "usage_limit", "expires_at", "is_active", "used_at"];
  return [
    header.join(","),
    ...rows.map((row) => [
      row.code,
      row.campaign_name,
      row.discount_type,
      row.discount_value,
      row.usage_count,
      row.usage_limit,
      row.expires_at,
      row.is_active,
      row.used_at,
    ].map(escape).join(",")),
  ].join("\n");
};

const PDF_GOLD = [199, 153, 45];
const PDF_BLACK = [15, 15, 16];
const PDF_MUTED = [92, 92, 96];
const imageDataCache = new Map();

const formatCouponDate = (value) => {
  if (!value) return "NO EXPIRY";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "NO EXPIRY";
  return new Intl.DateTimeFormat("en-GB", { year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
};

const loadPdfLogo = async (url) => {
  const safeUrl = String(url || "").trim();
  if (!safeUrl) return "";
  if (imageDataCache.has(safeUrl)) return imageDataCache.get(safeUrl);
  try {
    let source;
    if (/^https?:\/\//i.test(safeUrl)) {
      const response = await fetch(safeUrl, { signal: AbortSignal.timeout(8_000) });
      if (!response.ok) return "";
      source = Buffer.from(await response.arrayBuffer());
    } else if (fs.existsSync(safeUrl)) {
      source = fs.readFileSync(safeUrl);
    } else {
      return "";
    }
    const { default: sharp } = await import("sharp");
    const prepared = await sharp(source)
      .resize(700, 700, { fit: "inside", withoutEnlargement: true })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const { data, info } = prepared;
    const pixelOffset = (x, y) => (y * info.width + x) * info.channels;
    const cornerPoints = [
      [0, 0],
      [Math.max(0, info.width - 1), 0],
      [0, Math.max(0, info.height - 1)],
      [Math.max(0, info.width - 1), Math.max(0, info.height - 1)],
    ];
    const darkCorners = cornerPoints.filter(([x, y]) => {
      const offset = pixelOffset(x, y);
      return Math.max(data[offset], data[offset + 1], data[offset + 2]) <= 48;
    }).length;

    // The official logo is supplied as a black square. Convert that black
    // canvas into transparency so the mark becomes part of the ticket panel
    // instead of looking like a separate pasted image.
    if (darkCorners >= 3) {
      let chromaTotal = 0;
      let visibleSamples = 0;
      for (let i = 0; i < data.length; i += info.channels * 8) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        if (Math.max(r, g, b) > 24) {
          chromaTotal += Math.max(r, g, b) - Math.min(r, g, b);
          visibleSamples += 1;
        }
      }
      const isMonochrome = visibleSamples === 0 || chromaTotal / visibleSamples < 18;

      for (let i = 0; i < data.length; i += info.channels) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const intensity = Math.max(r, g, b);
        const originalAlpha = data[i + 3];

        if (isMonochrome) {
          // Ignore the subtle near-black radial gradient in the source tile,
          // then preserve the antialiased white mark as real transparency.
          const coverage = Math.max(0, Math.min(1, (intensity - 45) / 210));
          data[i] = 255;
          data[i + 1] = 255;
          data[i + 2] = 255;
          data[i + 3] = Math.round(originalAlpha * coverage);
        } else {
          const coverage = Math.max(0, Math.min(1, (intensity - 12) / 58));
          data[i + 3] = Math.round(originalAlpha * coverage);
        }
      }
    }

    const png = await sharp(data, { raw: info })
      .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 2 })
      .resize(500, 500, {
        fit: "contain",
        withoutEnlargement: true,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toBuffer();
    const dataUrl = `data:image/png;base64,${png.toString("base64")}`;
    imageDataCache.set(safeUrl, dataUrl);
    return dataUrl;
  } catch {
    return "";
  }
};

const resolveCouponBranding = async (tenantId) => {
  const site = await getSiteSettings({ tenantId }).catch(() => ({}));
  const [settingName, companyName, storefrontLogo, companyLogo, settingUrl] = await Promise.all([
    getSetting("storefront.store_name", "").catch(() => ""),
    getSetting("general.company_name", "").catch(() => ""),
    getSetting("storefront.store_logo_url", "").catch(() => ""),
    getSetting("general.company_logo_url", "").catch(() => ""),
    getSetting("storefront.public_url", "").catch(() => ""),
  ]);
  const publicUrl = String(settingUrl || resolveStorefrontUrl()).trim().replace(/\/+$/g, "");
  return {
    storeName: String(settingName || companyName || site.company_name || "M1 Store").trim(),
    logoUrl: String(storefrontLogo || companyLogo || site.company_logo_url || path.resolve(currentDir, "../../public/icons/m1-512.png")).trim(),
    publicUrl,
  };
};

const pdfLayout = (layout = "a4") => {
  const normalized = ["a4", "a5", "single"].includes(String(layout).toLowerCase()) ? String(layout).toLowerCase() : "a4";
  if (normalized === "a5") return { name: "a5", format: "a5", orientation: "landscape", columns: 1, rows: 2, marginX: 7, marginY: 7, gapX: 0, gapY: 5 };
  if (normalized === "single") return { name: "single", format: [90, 190], orientation: "landscape", columns: 1, rows: 1, marginX: 6, marginY: 6, gapX: 0, gapY: 0 };
  return { name: "a4", format: "a4", orientation: "landscape", columns: 2, rows: 3, marginX: 7, marginY: 7, gapX: 4, gapY: 4 };
};

const addArabicFont = (doc) => {
  const fontPath = path.resolve(currentDir, "../assets/fonts/NotoSansArabic.ttf");
  if (!fs.existsSync(fontPath)) return false;
  const fontData = fs.readFileSync(fontPath).toString("base64");
  doc.addFileToVFS("MOneArabic.ttf", fontData);
  doc.addFont("MOneArabic.ttf", "MOneArabic", "normal");
  doc.addFont("MOneArabic.ttf", "MOneArabic", "bold");
  if (typeof doc.setLanguage === "function") doc.setLanguage("ar");
  return true;
};

const storeHostLabel = (value) => {
  try {
    return new URL(String(value || "https://m1store-egy.com")).hostname.replace(/^www\./i, "");
  } catch {
    return "m1store-egy.com";
  }
};

const fillPath = (doc, commands, color) => {
  doc.setFillColor(...color);
  doc.path(commands);
  doc.fill();
};

const drawCouponTicket = ({ doc, coupon, x, y, width, height, logoData, storeName, storeUrl, qrData }) => {
  const radius = 4;
  const brandWidth = Math.max(34, width * 0.275);
  const stubWidth = Math.max(29, width * 0.225);
  const dividerX = x + width - stubWidth;
  const mainLeft = x + brandWidth + 8;
  const mainRight = dividerX - 4;
  const mainCenter = (mainLeft + mainRight) / 2;
  const qrSize = Math.min(22.5, height * 0.37, stubWidth - 9);
  const minOrder = Number(coupon.minimum_order_amount || 0);
  const usage = Number(coupon.usage_limit || coupon.usage_limit_per_coupon || 1);
  const fixedDiscount = coupon.discount_type !== "percentage";
  const discountValue = Number(coupon.discount_value || 0).toLocaleString("en-US");
  const hostLabel = storeHostLabel(storeUrl);

  // Soft print-safe shadow and the white ticket base.
  doc.setFillColor(230, 228, 224);
  doc.roundedRect(x + 0.8, y + 1.1, width, height, radius, radius, "F");
  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(207, 161, 55);
  doc.setLineWidth(0.35);
  doc.roundedRect(x, y, width, height, radius, radius, "FD");

  // Black identity panel, then the white and gold sweeping curves from the reference.
  doc.setFillColor(...PDF_BLACK);
  doc.roundedRect(x, y, brandWidth + 16, height, radius, radius, "F");
  fillPath(doc, [
    { op: "m", c: [x + brandWidth + 17, y] },
    { op: "c", c: [x + brandWidth + 10, y + 9, x + brandWidth + 7, y + 17, x + brandWidth - 2, y + height * 0.57] },
    { op: "c", c: [x + brandWidth - 8, y + height * 0.78, x + brandWidth - 4, y + height - 8, x + brandWidth + 6, y + height] },
    { op: "l", c: [x + width, y + height] },
    { op: "l", c: [x + width, y] },
    { op: "h", c: [] },
  ], [255, 255, 255]);
  fillPath(doc, [
    { op: "m", c: [x + brandWidth + 9, y] },
    { op: "c", c: [x + brandWidth + 4, y + 10, x + brandWidth - 1, y + 20, x + brandWidth - 8, y + height * 0.58] },
    { op: "c", c: [x + brandWidth - 13, y + height * 0.78, x + brandWidth - 8, y + height - 7, x + brandWidth + 2, y + height] },
    { op: "l", c: [x + brandWidth + 6.5, y + height] },
    { op: "c", c: [x + brandWidth - 4, y + height - 8, x + brandWidth - 8, y + height * 0.79, x + brandWidth - 2, y + height * 0.57] },
    { op: "c", c: [x + brandWidth + 5, y + 20, x + brandWidth + 10, y + 10, x + brandWidth + 15, y] },
    { op: "h", c: [] },
  ], PDF_GOLD);

  // Very subtle paper waves in the offer area.
  doc.setDrawColor(245, 242, 235);
  doc.setLineWidth(0.18);
  for (let line = 0; line < 4; line += 1) {
    const waveY = y + 13 + line * 6;
    doc.path([
      { op: "m", c: [mainLeft - 2, waveY] },
      { op: "c", c: [mainCenter - 8, waveY - 3, mainCenter + 4, waveY + 3, mainRight + 1, waveY] },
    ]);
    doc.stroke();
  }

  // Official logo with its dark canvas removed so it merges into the panel.
  if (logoData) {
    const logoSize = Math.min(22, height * 0.36);
    doc.addImage(logoData, "PNG", x + 6, y + 5, logoSize, logoSize, undefined, "FAST");
  } else {
    doc.setTextColor(...PDF_GOLD);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text("M1", x + 8, y + 18);
  }
  doc.setTextColor(...PDF_GOLD);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(5.6);
  doc.text(String(storeName || "M1 Store").toUpperCase(), x + 6, y + height - 10, { maxWidth: brandWidth - 5 });
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(3.5);
  doc.text("CHANGE YOUR LIFE", x + 6, y + height - 6.2, { maxWidth: brandWidth - 6, charSpace: 0.25 });

  // Offer headline and value.
  doc.setDrawColor(...PDF_GOLD);
  doc.setLineWidth(0.3);
  doc.line(mainCenter - 24, y + 11, mainCenter - 12, y + 11);
  doc.line(mainCenter + 12, y + 11, mainCenter + 24, y + 11);
  doc.setTextColor(...PDF_BLACK);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(6.5);
  doc.text("SPECIAL OFFER", mainCenter, y + 12.7, { align: "center" });

  doc.setFontSize(29);
  const valueText = fixedDiscount ? discountValue : `${discountValue}%`;
  const valueWidth = doc.getTextWidth(valueText);
  const groupWidth = valueWidth + 16;
  const valueX = mainCenter - groupWidth / 2;
  doc.setTextColor(...PDF_BLACK);
  doc.text(valueText, valueX, y + 33);
  const sideX = valueX + valueWidth + 2.3;
  if (fixedDiscount) {
    doc.setFontSize(6.2);
    doc.text("EGP", sideX, y + 25.8);
  }
  doc.setTextColor(...PDF_GOLD);
  doc.setFontSize(14);
  doc.text("OFF", sideX, y + 33.2);

  // Compact benefit row, using the live coupon rules.
  const detailY = y + height - 10.5;
  const detailWidth = (mainRight - mainLeft) / 3;
  const expiry = formatCouponDate(coupon.expires_at || coupon.campaign_expires_at);
  const details = [
    ["USE ONLINE", "OR IN STORE"],
    ["MIN ORDER", minOrder > 0 ? `${minOrder.toLocaleString("en-US")} EGP` : "NO MINIMUM"],
    ["EXPIRES", expiry],
  ];
  details.forEach(([top, bottom], index) => {
    const cx = mainLeft + detailWidth * index + detailWidth / 2;
    const iconX = cx - detailWidth / 2 + 3.3;
    const iconY = detailY - 1.6;
    doc.setDrawColor(...PDF_GOLD);
    doc.setLineWidth(0.42);
    if (index === 0) {
      doc.roundedRect(iconX - 1.6, iconY - 1.2, 3.2, 3.2, 0.45, 0.45, "S");
      doc.path([
        { op: "m", c: [iconX - 0.9, iconY - 1.2] },
        { op: "c", c: [iconX - 0.8, iconY - 2.7, iconX + 0.8, iconY - 2.7, iconX + 0.9, iconY - 1.2] },
      ]);
      doc.stroke();
    } else if (index === 1) {
      doc.line(iconX - 1.8, iconY - 1.4, iconX - 1.1, iconY - 1.4);
      doc.line(iconX - 1.1, iconY - 1.4, iconX - 0.5, iconY + 1);
      doc.line(iconX - 0.5, iconY + 1, iconX + 1.5, iconY + 1);
      doc.line(iconX - 0.7, iconY - 0.8, iconX + 1.8, iconY - 0.8);
      doc.line(iconX + 1.8, iconY - 0.8, iconX + 1.3, iconY + 0.5);
      doc.circle(iconX - 0.2, iconY + 1.8, 0.35, "S");
      doc.circle(iconX + 1.25, iconY + 1.8, 0.35, "S");
    } else {
      doc.roundedRect(iconX - 1.8, iconY - 1.6, 3.6, 3.6, 0.4, 0.4, "S");
      doc.line(iconX - 1.8, iconY - 0.4, iconX + 1.8, iconY - 0.4);
      doc.line(iconX - 0.9, iconY - 2.1, iconX - 0.9, iconY - 1.1);
      doc.line(iconX + 0.9, iconY - 2.1, iconX + 0.9, iconY - 1.1);
      doc.circle(iconX, iconY + 1, 0.35, "S");
    }
    doc.setTextColor(...PDF_BLACK);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(3.8);
    doc.text(top, cx + 1.3, detailY - 1.3, { align: "center", maxWidth: detailWidth - 4 });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(3.3);
    doc.text(bottom, cx + 1.3, detailY + 2.4, { align: "center", maxWidth: detailWidth - 4 });
  });

  // Perforated QR stub with the same ticket notches as the supplied reference.
  doc.setDrawColor(...PDF_GOLD);
  doc.setLineWidth(0.3);
  doc.setLineDashPattern([1.4, 1.15], 0);
  doc.line(dividerX, y + 1.5, dividerX, y + height - 1.5);
  doc.setLineDashPattern([], 0);
  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(...PDF_GOLD);
  doc.circle(dividerX, y + height / 2, 2.1, "FD");

  const stubCenter = dividerX + stubWidth / 2;
  doc.setTextColor(...PDF_MUTED);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(4.2);
  doc.text("YOUR CODE", stubCenter, y + 7.2, { align: "center" });
  doc.setTextColor(...PDF_BLACK);
  doc.setFontSize(7.8);
  doc.text(String(coupon.code || ""), stubCenter, y + 13.2, { align: "center", maxWidth: stubWidth - 5 });

  const qrX = stubCenter - qrSize / 2;
  const qrY = y + 16.5;
  doc.setDrawColor(...PDF_GOLD);
  doc.setLineWidth(0.45);
  doc.roundedRect(qrX - 1.2, qrY - 1.2, qrSize + 2.4, qrSize + 2.4, 1.8, 1.8, "S");
  doc.addImage(qrData, "PNG", qrX, qrY, qrSize, qrSize, undefined, "FAST");
  doc.setTextColor(...PDF_BLACK);
  doc.setFontSize(4.1);
  doc.text("SCAN TO APPLY", stubCenter, qrY + qrSize + 5, { align: "center" });
  doc.text("ONLINE", stubCenter, qrY + qrSize + 9, { align: "center" });

  const footerHeight = 7.5;
  doc.setFillColor(...PDF_BLACK);
  doc.roundedRect(dividerX, y + height - footerHeight, stubWidth, footerHeight, 3.2, 3.2, "F");
  doc.rect(dividerX, y + height - footerHeight, stubWidth, 4.5, "F");
  doc.rect(dividerX, y + height - footerHeight, 3.5, footerHeight, "F");
  doc.setTextColor(...PDF_GOLD);
  doc.setFontSize(4.5);
  doc.text(`@ ${hostLabel}`, stubCenter, y + height - 2.6, { align: "center", maxWidth: stubWidth - 4 });

  // A tiny usage marker keeps the operational rule without changing the reference layout.
  doc.setTextColor(155, 155, 155);
  doc.setFontSize(2.8);
  doc.text(`USE ${usage.toLocaleString("en-US")}X`, dividerX - 2, y + height - 2.5, { align: "right" });
};

export const renderCouponsPdfBuffer = async ({ coupons = [], branding = {}, layout = "a4" } = {}) => {
  const rows = Array.isArray(coupons) ? coupons : [];
  if (!rows.length) {
    const error = new Error("No coupons available for export");
    error.status = 404;
    throw error;
  }
  const config = pdfLayout(layout);
  const [{ jsPDF }, qrcodeModule] = await Promise.all([import("jspdf"), import("qrcode")]);
  const QRCode = qrcodeModule.default || qrcodeModule;
  const doc = new jsPDF({ orientation: config.orientation, unit: "mm", format: config.format, compress: true, putOnlyUsedFonts: true });
  const hasArabicFont = addArabicFont(doc);
  if (!hasArabicFont) {
    const error = new Error("Arabic PDF font is unavailable");
    error.status = 500;
    throw error;
  }
  doc.setProperties({ title: `${branding.storeName || "Store"} Coupons`, subject: "Premium printable coupons", creator: branding.storeName || "Store" });
  const logoData = await loadPdfLogo(branding.logoUrl);
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const cardWidth = (pageWidth - config.marginX * 2 - config.gapX * (config.columns - 1)) / config.columns;
  const cardHeight = (pageHeight - config.marginY * 2 - config.gapY * (config.rows - 1)) / config.rows;
  const pageCapacity = config.columns * config.rows;

  for (let index = 0; index < rows.length; index += 1) {
    if (index > 0 && index % pageCapacity === 0) doc.addPage(config.format, config.orientation);
    const pageIndex = index % pageCapacity;
    const column = pageIndex % config.columns;
    const row = Math.floor(pageIndex / config.columns);
    const x = config.marginX + column * (cardWidth + config.gapX);
    const y = config.marginY + row * (cardHeight + config.gapY);
    const coupon = rows[index];
    const currentUrl = resolveCouponUrl(coupon.code, branding.publicUrl);
    const qrData = await QRCode.toDataURL(currentUrl, {
      width: 1024,
      margin: 1,
      errorCorrectionLevel: "H",
      color: { dark: "#0F0F10", light: "#FFFFFF" },
    });
    drawCouponTicket({
      doc,
      coupon,
      x,
      y,
      width: cardWidth,
      height: cardHeight,
      logoData,
      storeName: branding.storeName || "M1 Store",
      storeUrl: branding.publicUrl,
      qrData,
    });
  }
  return Buffer.from(doc.output("arraybuffer"));
};

export const exportCouponsPdfBuffer = async ({ tenantId = null, campaignId, couponId = null, layout = "a4" } = {}) => {
  const allRows = await listCoupons({ tenantId, campaignId });
  const rows = couponId ? allRows.filter((coupon) => String(coupon.id) === String(couponId)) : allRows;
  const branding = await resolveCouponBranding(tenantId);
  return renderCouponsPdfBuffer({ coupons: rows, branding, layout });
};
