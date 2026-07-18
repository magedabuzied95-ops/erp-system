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
const VALID_DISCOUNT_TYPES = new Set(["percentage", "fixed"]);
const VALID_CHANNELS = new Set(["offline", "website", "pos", "all"]);
const VALID_SOURCES = new Set(["pos", "website", "manual"]);

export const ensureCouponsSchema = async (clientOrPool = db) => {
  const sqlPath = path.join(currentDir, "../database/coupons.sql");
  console.log("[migration] loading:", sqlPath);
  if (!fs.existsSync(sqlPath)) {
    console.warn("[migration] missing:", sqlPath);
    return;
  }
  const sql = await readFile(sqlPath, "utf8");
  await clientOrPool.query(sql);
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
    usage_limit_per_coupon: Math.max(1, Number.parseInt(body.usage_limit_per_coupon ?? body.usageLimitPerCoupon ?? 1, 10)),
    total_coupons: Math.max(0, Number.parseInt(body.total_coupons ?? body.totalCoupons ?? 0, 10)),
    starts_at: body.starts_at || body.startsAt || null,
    expires_at: body.expires_at || body.expiresAt || null,
    channel,
    is_active: body.is_active ?? body.isActive ?? true,
  };
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
      channel, is_active, created_by
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
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
    ]
  );
  return result.rows[0];
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
        is_active = $${offset + 11}, updated_at = NOW()
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
    ]
  );
  return result.rows[0] || null;
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
  if (status === "expired") where += " AND cp.expires_at IS NOT NULL AND cp.expires_at < NOW()";
  if (status === "active") where += " AND cp.is_active = TRUE AND (cp.expires_at IS NULL OR cp.expires_at >= NOW())";
  const result = await db.query(
    `
    SELECT cp.*, c.name AS campaign_name, c.discount_type, c.discount_value,
      c.minimum_order_amount, c.max_discount_amount, c.starts_at AS campaign_starts_at,
      c.expires_at AS campaign_expires_at, c.channel, c.usage_limit_per_coupon
    FROM coupons cp
    JOIN coupon_campaigns c ON c.id = cp.campaign_id
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

export const calculateDiscount = ({ campaign, orderTotal }) => {
  const total = Math.max(0, Number(orderTotal || 0));
  let discount;
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

export const validateCoupon = async ({ tenantId = null, code, orderTotal = 0, source = "website", customerId = null, client = db, lock = false } = {}) => {
  await ensureCouponsSchema(client);
  const safeCode = String(code || "").trim().toUpperCase();
  const safeSource = normalizeSource(source);
  const total = Number(orderTotal || 0);
  const invalid = (reason) => ({ valid: false, coupon: null, campaign: null, discount_amount: 0, final_total: Math.max(0, total), reason });
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
      c.code_prefix, c.total_coupons
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
  if (coupon.usage_count >= coupon.usage_limit) return { ...invalid("Coupon usage limit reached"), coupon, campaign };
  if (campaign.minimum_order_amount > total) return { ...invalid("Minimum order amount not reached"), coupon, campaign };
  if (!["all", safeSource].includes(campaign.channel) && !(campaign.channel === "offline" && safeSource === "pos")) {
    return { ...invalid("Coupon is not valid for this channel"), coupon, campaign };
  }
  if (coupon.assigned_customer_id && customerId && String(coupon.assigned_customer_id) !== String(customerId)) {
    return { ...invalid("Coupon is assigned to another customer"), coupon, campaign };
  }
  if (campaign.discount_type === "fixed" && Number(campaign.discount_value || 0) > total) {
    return { ...invalid("Fixed coupon discount exceeds order total"), coupon, campaign };
  }
  const discount = calculateDiscount({ campaign, orderTotal: total });
  return {
    valid: true,
    coupon,
    campaign,
    discount_amount: discount,
    final_total: Number(Math.max(0, total - discount).toFixed(2)),
    reason: "valid",
  };
};

export const redeemCoupon = async ({ tenantId = null, code, orderId = null, customerId = null, source = "pos", orderTotal = 0, client: existingClient = null } = {}) => {
  const ownClient = !existingClient;
  const client = existingClient || await db.connect();
  try {
    if (ownClient) await client.query("BEGIN");
    const validation = await validateCoupon({ tenantId, code, orderTotal, source, customerId, client, lock: true });
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
        Number(orderTotal || 0),
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
      COUNT(r.id)::int AS total_redemptions,
      COALESCE(SUM(r.discount_amount), 0)::numeric AS total_discount_amount,
      COALESCE(SUM(r.order_total), 0)::numeric AS total_sales_amount,
      COALESCE(AVG(r.order_total), 0)::numeric AS average_order_total
    FROM coupons c
    LEFT JOIN coupon_redemptions r ON r.coupon_id = c.id
    WHERE c.campaign_id = $1 ${tenantSql}
    `,
    params
  );
  const stats = result.rows[0] || {};
  const total = Number(stats.total_coupons || 0);
  const used = Number(stats.used_coupons || 0);
  return {
    total_coupons: total,
    used_coupons: used,
    unused_coupons: Number(stats.unused_coupons || 0),
    expired_coupons: Number(stats.expired_coupons || 0),
    total_redemptions: Number(stats.total_redemptions || 0),
    total_discount_amount: Number(stats.total_discount_amount || 0),
    total_sales_amount: Number(stats.total_sales_amount || 0),
    average_order_total: Number(stats.average_order_total || 0),
    conversion_rate: total > 0 ? Number(((used / total) * 100).toFixed(2)) : 0,
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
    const png = await sharp(source).resize(500, 500, { fit: "inside", withoutEnlargement: true }).png().toBuffer();
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
  if (normalized === "a5") return { name: "a5", format: "a5", orientation: "portrait", columns: 1, rows: 2, marginX: 8, marginY: 8, gapX: 0, gapY: 6 };
  if (normalized === "single") return { name: "single", format: "a6", orientation: "landscape", columns: 1, rows: 1, marginX: 6, marginY: 7, gapX: 0, gapY: 0 };
  return { name: "a4", format: "a4", orientation: "portrait", columns: 2, rows: 3, marginX: 7, marginY: 7, gapX: 4, gapY: 4 };
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

const drawCouponTicket = ({ doc, coupon, x, y, width, height, logoData, storeName, qrData }) => {
  const compact = height < 88;
  const padding = compact ? 3.7 : 4.5;
  const headerHeight = compact ? 17 : 19;
  const footerHeight = compact ? 8 : 9;
  const stubWidth = compact ? 27 : 30;
  const qrSize = compact ? 20.5 : 23;
  const arabic = (value) => typeof doc.processArabic === "function" ? doc.processArabic(String(value || "")) : String(value || "");
  const rightText = (value, tx, ty, options = {}) => {
    const raw = String(value || "");
    const isArabic = /[\u0600-\u06ff]/.test(raw);
    doc.text(isArabic ? arabic(raw) : raw, tx, ty, { align: "right", ...options });
  };

  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(...PDF_BLACK);
  doc.setLineWidth(0.55);
  doc.roundedRect(x, y, width, height, 3.8, 3.8, "FD");

  doc.setFillColor(...PDF_BLACK);
  doc.roundedRect(x, y, width, headerHeight + 3, 3.8, 3.8, "F");
  doc.rect(x, y + headerHeight - 2, width, 5, "F");
  doc.setFillColor(...PDF_GOLD);
  doc.rect(x, y + headerHeight, width, 0.85, "F");
  if (logoData) {
    const logoSize = compact ? 13 : 15;
    doc.addImage(logoData, "PNG", x + width - padding - logoSize, y + 1.4, logoSize, logoSize, undefined, "FAST");
  } else {
    doc.setFillColor(...PDF_GOLD);
    doc.circle(x + width - padding - 5, y + 7, 4, "F");
    doc.setTextColor(...PDF_BLACK);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6);
    doc.text(storeName.slice(0, 2).toUpperCase(), x + width - padding - 5, y + 8.6, { align: "center" });
  }
  const brandRight = x + width - padding - (compact ? 15 : 17);
  doc.setTextColor(255, 255, 255);
  doc.setFont("MOneArabic", "bold");
  doc.setFontSize(compact ? 7.6 : 8.8);
  rightText(storeName, brandRight, y + 7.6, { maxWidth: width - 39 });
  doc.setTextColor(...PDF_GOLD);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(compact ? 4.5 : 5.1);
  doc.text("PREMIUM COUPON", brandRight, y + 12.2, { align: "right", charSpace: 0.45 });

  const bodyTop = y + headerHeight + 1;
  const footerTop = y + height - footerHeight;
  const dividerX = x + padding + stubWidth;
  const infoRight = x + width - padding;
  const infoLeft = dividerX + 5;

  doc.setDrawColor(186, 186, 188);
  doc.setLineDashPattern([1.4, 1.2], 0);
  doc.line(dividerX, bodyTop + 3, dividerX, footerTop - 3);
  doc.setLineDashPattern([], 0);
  doc.setFillColor(255, 255, 255);
  doc.circle(dividerX, bodyTop, 2, "F");
  doc.circle(dividerX, footerTop, 2, "F");

  const qrX = x + padding + (stubWidth - qrSize) / 2;
  const qrY = bodyTop + (compact ? 6 : 7);
  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(...PDF_GOLD);
  doc.setLineWidth(0.75);
  doc.roundedRect(qrX - 1.1, qrY - 1.1, qrSize + 2.2, qrSize + 2.2, 2.2, 2.2, "FD");
  doc.addImage(qrData, "PNG", qrX, qrY, qrSize, qrSize, undefined, "FAST");
  doc.setTextColor(...PDF_MUTED);
  doc.setFont("MOneArabic", "normal");
  doc.setFontSize(compact ? 4.8 : 5.3);
  rightText("امسح للاستخدام", x + padding + stubWidth - 1, qrY + qrSize + 5, { maxWidth: stubWidth - 2 });
  doc.setFont("helvetica", "bold");
  doc.setFontSize(4.2);
  doc.setTextColor(...PDF_GOLD);
  doc.text("SCAN • SAVE • ENJOY", x + padding + stubWidth / 2, qrY + qrSize + 9, { align: "center", maxWidth: stubWidth });

  const discount = coupon.discount_type === "percentage"
    ? `${Number(coupon.discount_value || 0).toLocaleString("en-US")}%`
    : `${Number(coupon.discount_value || 0).toLocaleString("en-US")} EGP`;
  doc.setTextColor(...PDF_BLACK);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(compact ? 18 : 22);
  doc.text(discount, infoRight, bodyTop + 13, { align: "right" });
  doc.setFont("MOneArabic", "normal");
  doc.setFontSize(compact ? 5.7 : 6.4);
  doc.setTextColor(...PDF_GOLD);
  rightText(coupon.discount_type === "percentage" ? "خصم على إجمالي الطلب" : "خصم نقدي ثابت", infoRight, bodyTop + 18);

  const codeY = bodyTop + 21;
  doc.setFillColor(248, 244, 234);
  doc.setDrawColor(...PDF_GOLD);
  doc.setLineWidth(0.35);
  doc.roundedRect(infoLeft, codeY, Math.max(25, infoRight - infoLeft), compact ? 8.5 : 9.5, 2.2, 2.2, "FD");
  doc.setTextColor(...PDF_BLACK);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(compact ? 8.2 : 9.5);
  doc.text(String(coupon.code || ""), (infoLeft + infoRight) / 2, codeY + (compact ? 5.7 : 6.5), { align: "center", maxWidth: infoRight - infoLeft - 3 });

  const minOrder = Number(coupon.minimum_order_amount || 0);
  const usage = Number(coupon.usage_limit || coupon.usage_limit_per_coupon || 1);
  const detailsY = codeY + (compact ? 13 : 15);
  const detailGap = 2;
  const detailWidth = (infoRight - infoLeft - detailGap) / 2;
  const detailHeight = compact ? 12 : 14;
  const expiryX = infoRight - detailWidth;
  doc.setFillColor(249, 249, 248);
  doc.setDrawColor(225, 225, 222);
  doc.setLineWidth(0.25);
  doc.roundedRect(infoLeft, detailsY, detailWidth, detailHeight, 1.8, 1.8, "FD");
  doc.roundedRect(expiryX, detailsY, detailWidth, detailHeight, 1.8, 1.8, "FD");
  doc.setFont("MOneArabic", "normal");
  doc.setFontSize(compact ? 4.4 : 4.9);
  doc.setTextColor(...PDF_GOLD);
  rightText("الحد الأدنى", infoLeft + detailWidth - 2, detailsY + 4.2);
  rightText("تاريخ الانتهاء", infoRight - 2, detailsY + 4.2);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(compact ? 6.2 : 7);
  doc.setTextColor(...PDF_BLACK);
  doc.text(minOrder > 0 ? `${minOrder.toLocaleString("en-US")} EGP` : "NO MINIMUM", infoLeft + detailWidth / 2, detailsY + detailHeight - 3, { align: "center", maxWidth: detailWidth - 3 });
  doc.text(formatCouponDate(coupon.expires_at || coupon.campaign_expires_at), expiryX + detailWidth / 2, detailsY + detailHeight - 3, { align: "center", maxWidth: detailWidth - 3 });

  doc.setFillColor(...PDF_BLACK);
  doc.roundedRect(x, footerTop, width, footerHeight, 3.8, 3.8, "F");
  doc.rect(x, footerTop, width, 3, "F");
  doc.setFillColor(...PDF_GOLD);
  doc.rect(x, footerTop, width, 0.7, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("MOneArabic", "normal");
  doc.setFontSize(compact ? 5.1 : 5.7);
  rightText(`صالح للاستخدام ${usage.toLocaleString("en-US")} ${usage === 1 ? "مرة" : "مرات"}`, infoRight, footerTop + footerHeight - 2.5);
  doc.setTextColor(...PDF_GOLD);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(4.6);
  doc.text("AUTHENTIC • SECURE • INSTANT", x + padding, footerTop + footerHeight - 2.6);
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
    drawCouponTicket({ doc, coupon, x, y, width: cardWidth, height: cardHeight, logoData, storeName: branding.storeName || "M1 Store", qrData });
  }
  return Buffer.from(doc.output("arraybuffer"));
};

export const exportCouponsPdfBuffer = async ({ tenantId = null, campaignId, couponId = null, layout = "a4" } = {}) => {
  const allRows = await listCoupons({ tenantId, campaignId });
  const rows = couponId ? allRows.filter((coupon) => String(coupon.id) === String(couponId)) : allRows;
  const branding = await resolveCouponBranding(tenantId);
  return renderCouponsPdfBuffer({ coupons: rows, branding, layout });
};
