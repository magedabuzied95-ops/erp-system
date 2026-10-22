// Audiences built from the shop's own data instead of Meta's guesses: the ERP's online buyers
// as a customer list (phones hashed before they leave the server), website visitors and
// cart-abandoners from the pixel, Instagram / Facebook engagers, and lookalikes of the buyers.
//
// The pure parts (phone hashing, the rules, the plan) are unit-tested; `buildRecommendedAudiences`
// talks to Postgres and Graph and is idempotent by audience name, so pressing the button twice
// creates nothing twice.

import crypto from "node:crypto";

import db from "../../database/db.js";
import { canonicalPhoneSql } from "../../utils/phoneSearch.js";
import { graphPost } from "./metaAdsGraph.js";
import { requireToken, syncAudiences, text } from "./metaAdsCore.js";

const DAY = 86400;
const PHONE_BATCH = 5000;

// ------------------------------------------------------------------ pure

// Meta wants E.164 digits without "+", SHA-256 hex. An Egyptian mobile stored as 01xxxxxxxxx,
// 1xxxxxxxxx or 201xxxxxxxxx becomes 201xxxxxxxxx; anything else keeps its digits.
export const e164Digits = (value = "") => {
  let digits = String(value || "").replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (/^01\d{9}$/.test(digits)) digits = `2${digits}`;
  else if (/^1\d{9}$/.test(digits)) digits = `20${digits}`;
  return digits.length >= 8 ? digits : "";
};

export const hashedPhoneRows = (phones = []) => {
  const seen = new Set();
  const rows = [];
  for (const phone of phones) {
    const digits = e164Digits(phone);
    if (!digits || seen.has(digits)) continue;
    seen.add(digits);
    rows.push([crypto.createHash("sha256").update(digits).digest("hex")]);
  }
  return rows;
};

const pixelRule = (pixelId, event, days) => ({
  event_sources: [{ id: text(pixelId), type: "pixel" }],
  retention_seconds: days * DAY,
  filter: { operator: "and", filters: [{ field: "event", operator: "eq", value: event }] },
});

export const websiteRule = ({ pixelId, event = "PageView", days = 30, excludeEvent = null, excludeDays = days }) => {
  const rule = { inclusions: { operator: "or", rules: [pixelRule(pixelId, event, days)] } };
  if (excludeEvent) rule.exclusions = { operator: "or", rules: [pixelRule(pixelId, excludeEvent, excludeDays)] };
  return rule;
};

export const engagementRule = ({ sourceId, sourceType, event, days = 90 }) => ({
  inclusions: {
    operator: "or",
    rules: [{
      event_sources: [{ id: text(sourceId), type: sourceType }],
      retention_seconds: days * DAY,
      filter: { operator: "and", filters: [{ field: "event", operator: "eq", value: event }] },
    }],
  },
});

// The set the button creates, in creation order (lookalikes last: they need the buyers list).
export const recommendedAudiencePlan = (account = {}) => {
  const plan = [
    { key: "buyers", name: "M1 — مشترو الموقع (ERP)", kind: "customer_list", description: "Online buyers from the ERP, phones hashed" },
  ];
  if (account.pixel_id) {
    plan.push(
      { key: "visitors_30", name: "M1 — زوار الموقع 30 يوم", kind: "website", rule: websiteRule({ pixelId: account.pixel_id, days: 30 }) },
      { key: "visitors_90", name: "M1 — زوار الموقع 90 يوم", kind: "website", rule: websiteRule({ pixelId: account.pixel_id, days: 90 }) },
      { key: "cart_abandoners", name: "M1 — أضافوا للسلة ولم يشتروا 30 يوم", kind: "website", rule: websiteRule({ pixelId: account.pixel_id, event: "AddToCart", days: 30, excludeEvent: "Purchase" }) },
      { key: "site_buyers_180", name: "M1 — اشتروا من الموقع 180 يوم", kind: "website", rule: websiteRule({ pixelId: account.pixel_id, event: "Purchase", days: 180 }) },
    );
  }
  if (account.instagram_user_id) {
    plan.push({ key: "ig_engagers", name: "M1 — تفاعلوا مع إنستجرام 90 يوم", kind: "engagement", rule: engagementRule({ sourceId: account.instagram_user_id, sourceType: "ig_business", event: "ig_business_profile_all", days: 90 }) });
  }
  if (account.page_id) {
    plan.push({ key: "fb_engagers", name: "M1 — تفاعلوا مع الصفحة 90 يوم", kind: "engagement", rule: engagementRule({ sourceId: account.page_id, sourceType: "page", event: "page_engaged", days: 90 }) });
  }
  plan.push(
    { key: "lookalike_1", name: "M1 — شبيه المشترين 1% مصر", kind: "lookalike", origin: "buyers", ratio: 0.01, country: "EG" },
    { key: "lookalike_3", name: "M1 — شبيه المشترين 3% مصر", kind: "lookalike", origin: "buyers", ratio: 0.03, country: "EG" },
  );
  return plan;
};

// ------------------------------------------------------------------ data + Graph

// Phones of everyone who bought online (any channel the shop canonicalises as storefront; the IN
// list guards rows written before the fold), cancelled orders excluded.
const onlineBuyerPhones = async (tenantId) => {
  const key = canonicalPhoneSql("o.customer_phone");
  const { rows } = await db.query(
    `SELECT DISTINCT ${key} AS phone
       FROM orders o
      WHERE o.tenant_id = $1
        AND LOWER(COALESCE(o.channel, '')) IN ('storefront', 'website', 'web', 'online')
        AND LOWER(COALESCE(o.status, '')) NOT IN ('cancelled', 'canceled', 'rejected', 'void', 'deleted')
        AND COALESCE(o.customer_phone, '') <> ''`,
    [tenantId],
  );
  return rows.map((row) => row.phone).filter(Boolean);
};

const existingByName = async (tenantId, accountId) => {
  const { rows } = await db.query(`SELECT meta_id, name FROM meta_ads_audiences WHERE tenant_id = $1 AND account_id = $2`, [tenantId, accountId]);
  return new Map(rows.map((row) => [row.name, row.meta_id]));
};

const uploadPhones = async (audienceId, token, rows) => {
  let uploaded = 0;
  for (let index = 0; index < rows.length; index += PHONE_BATCH) {
    const chunk = rows.slice(index, index + PHONE_BATCH);
    await graphPost(`/${audienceId}/users`, token, { payload: { schema: ["PHONE"], data: chunk } });
    uploaded += chunk.length;
  }
  return uploaded;
};

export const buildRecommendedAudiences = async (ctx) => {
  const token = requireToken(ctx);
  const { account } = ctx;
  const tenantId = account.tenant_id;
  const plan = recommendedAudiencePlan(account);
  const existing = await existingByName(tenantId, account.id);
  const made = new Map(); // key → meta_id, for lookalike origins
  const results = [];

  for (const item of plan) {
    const known = existing.get(item.name);
    if (known) {
      made.set(item.key, known);
      results.push({ key: item.key, name: item.name, meta_id: known, status: "exists" });
      continue;
    }
    try {
      let metaId = "";
      let count = null;
      if (item.kind === "customer_list") {
        const rows = hashedPhoneRows(await onlineBuyerPhones(tenantId));
        if (!rows.length) throw new Error("No online buyers with a phone number in the ERP yet.");
        const res = await graphPost(`/${ctx.actId}/customaudiences`, token, {
          name: item.name, subtype: "CUSTOM", description: item.description, customer_file_source: "USER_PROVIDED_ONLY",
        });
        metaId = text(res.id);
        count = await uploadPhones(metaId, token, rows);
      } else if (item.kind === "website" || item.kind === "engagement") {
        const res = await graphPost(`/${ctx.actId}/customaudiences`, token, {
          name: item.name, subtype: item.kind === "website" ? "WEBSITE" : "ENGAGEMENT", rule: item.rule, prefill: true,
        });
        metaId = text(res.id);
      } else if (item.kind === "lookalike") {
        const origin = made.get(item.origin);
        if (!origin) throw new Error("The buyers list was not created, so there is nothing to look alike.");
        const res = await graphPost(`/${ctx.actId}/customaudiences`, token, {
          name: item.name, subtype: "LOOKALIKE", origin_audience_id: origin,
          lookalike_spec: { type: "custom_ratio", ratio: item.ratio, country: item.country },
        });
        metaId = text(res.id);
      }
      made.set(item.key, metaId);
      results.push({ key: item.key, name: item.name, meta_id: metaId, status: "created", count });
    } catch (error) {
      results.push({ key: item.key, name: item.name, meta_id: null, status: "failed", error: text(error?.userMessage || error?.message).slice(0, 300) });
    }
  }

  try {
    await syncAudiences(ctx);
  } catch {
    // The list refreshes on the next sync; the results above already say what was made.
  }
  return { results };
};
