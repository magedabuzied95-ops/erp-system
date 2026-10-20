// "تكرار" in the Ads Manager: deep-copies a campaign / ad set / ad (with its
// children) into NEW DRAFT rows the wizard can open and publish later.
//
// Copies are generic over the row's columns (SELECT * → INSERT the same keys), so a
// column another area appends to a table is carried along without touching this file.
// The copied object keeps its parent (an ad-set copy stays in the same campaign);
// descendants copied with it are re-parented onto the new draft rows.

import db from "../../../../database/db.js";
import { httpError } from "../../metaAdsCore.js";
import { LEVEL_TABLE } from "./managerData.js";

// Never copied: identity, Meta-side identity/state, audit columns.
const SKIP = new Set([
  "id", "meta_id", "is_draft", "status", "effective_status", "raw", "meta_created_time", "meta_updated_time",
  "last_error", "created_at", "updated_at", "created_by", "spec",
]);

const toParam = (value) => {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  if (typeof value === "object") return JSON.stringify(value); // jsonb (arrays included — pg would send arrays as PG arrays)
  return value;
};

const copySuffix = (lang) => (String(lang || "").toLowerCase().startsWith("en") ? " - Copy" : " - نسخة");

// spec for a live object, so the wizard can open the copy like any other draft.
// Keys mirror the table columns; the wizard reads what it needs.
const specFromRow = (level, row) => {
  const pick = (keys) => Object.fromEntries(keys.filter((key) => row[key] !== undefined).map((key) => [key, row[key]]));
  if (level === "campaign") {
    return {
      source: "copy",
      ...pick(["objective", "buying_type", "daily_budget", "lifetime_budget", "bid_strategy", "special_ad_categories",
        "campaign_budget_optimization", "ab_test", "start_time", "stop_time"]),
    };
  }
  if (level === "adset") {
    return {
      source: "copy",
      ...pick(["optimization_goal", "billing_event", "destination_type", "bid_strategy", "bid_amount", "daily_budget",
        "lifetime_budget", "promoted_object", "targeting", "start_time", "end_time"]),
    };
  }
  if (level === "ad") return { source: "copy", ...pick(["tracking_specs"]) };
  return {
    source: "copy",
    ...pick(["creative_type", "page_id", "instagram_user_id", "primary_text", "primary_text_options", "headline", "description",
      "destination_url", "display_url", "url_tags", "call_to_action", "image_hash", "image_url", "video_id", "video_url",
      "thumbnail_url", "carousel_cards", "advantage_creative"]),
  };
};

const hasSpec = (spec) => spec && typeof spec === "object" && Object.keys(spec).length > 0;

// overrides: { column: value } applied on top of the source row.
const copyRow = async (client, table, level, source, overrides, userId) => {
  const values = {};
  for (const [key, value] of Object.entries(source)) {
    if (SKIP.has(key)) continue;
    values[key] = value;
  }
  Object.assign(values, overrides);
  values.spec = hasSpec(source.spec) ? source.spec : specFromRow(level, source);
  if ("name" in overrides) values.spec = { ...values.spec, name: overrides.name };
  values.meta_id = null;
  values.is_draft = true;
  values.status = "PAUSED";
  values.created_by = userId || null;
  const keys = Object.keys(values);
  const placeholders = keys.map((_, index) => `$${index + 1}`);
  const { rows } = await client.query(
    `INSERT INTO ${table} (${keys.join(", ")}, created_at, updated_at) VALUES (${placeholders.join(", ")}, NOW(), NOW()) RETURNING id`,
    keys.map((key) => toParam(values[key])),
  );
  return rows[0].id;
};

const loadRow = async (client, table, tenantId, id) => {
  const { rows } = await client.query(`SELECT * FROM ${table} WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
  return rows[0] || null;
};

const childRows = async (client, table, column, tenantId, parentId) => {
  const { rows } = await client.query(
    `SELECT * FROM ${table}
      WHERE tenant_id = $1 AND ${column} = $2
        AND (is_draft OR (UPPER(status) <> 'DELETED' AND UPPER(COALESCE(effective_status, '')) <> 'DELETED'))
      ORDER BY id`,
    [tenantId, parentId],
  );
  return rows;
};

// The ad's creative is copied too, so editing the copy never edits the live creative.
const copyAd = async (client, tenantId, ad, overrides, userId) => {
  let creativeId = ad.creative_id;
  if (ad.creative_id) {
    const creative = await loadRow(client, "meta_ads_creatives", tenantId, ad.creative_id);
    if (creative) creativeId = await copyRow(client, "meta_ads_creatives", "creative", creative, { name: creative.name }, userId);
  }
  return copyRow(client, "meta_ads_ads", "ad", ad, { ...overrides, creative_id: creativeId, creative_meta_id: null }, userId);
};

const copyAdset = async (client, tenantId, adset, overrides, userId) => {
  const newAdsetId = await copyRow(client, "meta_ads_adsets", "adset", adset, overrides, userId);
  for (const ad of await childRows(client, "meta_ads_ads", "adset_id", tenantId, adset.id)) {
    await copyAd(client, tenantId, ad, { adset_id: newAdsetId, adset_meta_id: null, campaign_meta_id: null, name: ad.name }, userId);
  }
  return newAdsetId;
};

export const duplicateObject = async (tenantId, { level, id, lang, userId }) => {
  const table = LEVEL_TABLE[level];
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const source = await loadRow(client, table, tenantId, id);
    if (!source) throw httpError(404, "Object not found");
    const name = `${source.name || ""}${copySuffix(lang)}`.trim();
    let campaignId = null;

    if (level === "campaign") {
      campaignId = await copyRow(client, "meta_ads_campaigns", "campaign", source, { name }, userId);
      for (const adset of await childRows(client, "meta_ads_adsets", "campaign_id", tenantId, source.id)) {
        await copyAdset(client, tenantId, adset, { campaign_id: campaignId, campaign_meta_id: null, name: adset.name }, userId);
      }
    } else if (level === "adset") {
      await copyAdset(client, tenantId, source, { name }, userId);
      campaignId = source.campaign_id;
    } else {
      await copyAd(client, tenantId, source, { name }, userId);
      if (source.adset_id) {
        const { rows } = await client.query(`SELECT campaign_id FROM meta_ads_adsets WHERE tenant_id = $1 AND id = $2`, [tenantId, source.adset_id]);
        campaignId = rows[0]?.campaign_id || null;
      }
    }

    await client.query("COMMIT");
    return { campaign_id: campaignId };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
};
