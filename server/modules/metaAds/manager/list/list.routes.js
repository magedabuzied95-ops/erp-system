// /api/meta-ads/manager — Ads Manager list screen (the wizard lives in ../wizard).
//   GET  /bootstrap                     accounts (+ audiences, lead forms, saved audiences) + catalog
//   GET  /data                          rows of one level with insight totals + per-level counts
//   POST /status                        pause / activate a live object on Meta
//   POST /duplicate                     deep copy into new drafts → { campaign_id }
//   GET  /insights/series               daily points for the charts drawer
//   GET  /insights/breakdown            age / gender / platform / country totals
//   POST /insights/sync                 pull insights from Meta
//   POST /sync                          structure + insights + audiences + lead forms
//   GET  /rules, POST /rules/{save,delete,toggle,run-now}   automated rules

import express from "express";

import db from "../../../../database/db.js";
import {
  getAccountContext,
  getAccountPublic,
  handle,
  httpError,
  requireToken,
  syncAll,
  syncAudiences,
  syncInsights,
  syncLeadForms,
  syncProductSets,
  tenantOf,
  text,
} from "../../metaAdsCore.js";
import { metaAdsManage, metaAdsView } from "../../metaAdsGuards.js";
import { buildRecommendedAudiences } from "../../metaAdsAudiences.js";
import { setObjectStatus } from "../wizard/metaAdsPublisher.js";
import {
  loadBootstrap,
  loadBreakdown,
  loadManagerData,
  loadObject,
  loadSeries,
  parseDays,
  parseId,
  parseLevel,
} from "./managerData.js";
import { duplicateObject } from "./duplicate.js";
import { normalizeRule, runRule } from "./rulesEngine.js";

const router = express.Router();

const accountIdOf = async (tenantId, value) => {
  const id = parseId(value, "account_id");
  await getAccountPublic(tenantId, id); // 404 when it is not this tenant's account
  return id;
};

router.get("/bootstrap", metaAdsView, handle(async (req) => loadBootstrap(tenantOf(req))));

router.get("/data", metaAdsView, handle(async (req) => {
  const tenantId = tenantOf(req);
  const accountId = await accountIdOf(tenantId, req.query.account_id);
  return loadManagerData(tenantId, {
    accountId,
    level: parseLevel(req.query.level),
    days: parseDays(req.query.days),
    q: text(req.query.q).slice(0, 200),
    campaignId: req.query.campaign_id ? parseId(req.query.campaign_id, "campaign_id") : null,
    adsetId: req.query.adset_id ? parseId(req.query.adset_id, "adset_id") : null,
  });
}));

router.post("/status", metaAdsManage, handle(async (req) => {
  const tenantId = tenantOf(req);
  const level = parseLevel(req.body?.level);
  const id = parseId(req.body?.id);
  const status = text(req.body?.status).toUpperCase();
  if (!["ACTIVE", "PAUSED"].includes(status)) throw httpError(400, "Invalid status");
  const row = await loadObject(tenantId, level, id);
  if (row.is_draft || !row.meta_id) throw httpError(409, "Drafts have no delivery status — publish the draft first", "META_ADS_DRAFT");
  const ctx = await getAccountContext(tenantId, row.account_id);
  requireToken(ctx);
  await setObjectStatus(ctx, level, id, status);
  const fresh = await loadObject(tenantId, level, id);
  return { id, level, status: fresh.status, effective_status: fresh.effective_status };
}));

router.post("/duplicate", metaAdsManage, handle(async (req) => {
  const tenantId = tenantOf(req);
  const level = parseLevel(req.body?.level);
  const id = parseId(req.body?.id);
  return duplicateObject(tenantId, { level, id, lang: req.body?.lang, userId: req.user?.id ?? null });
}));

router.get("/insights/series", metaAdsView, handle(async (req) => {
  const tenantId = tenantOf(req);
  return loadSeries(tenantId, {
    accountId: req.query.account_id ? Number(req.query.account_id) : null,
    level: parseLevel(req.query.level),
    id: parseId(req.query.id),
    days: parseDays(req.query.days),
  });
}));

router.get("/insights/breakdown", metaAdsView, handle(async (req) => {
  const tenantId = tenantOf(req);
  return loadBreakdown(tenantId, {
    level: parseLevel(req.query.level),
    id: parseId(req.query.id),
    breakdown: text(req.query.breakdown) || "age",
    days: parseDays(req.query.days),
  });
}));

router.post("/insights/sync", metaAdsManage, handle(async (req) => {
  const tenantId = tenantOf(req);
  const accountId = await accountIdOf(tenantId, req.body?.account_id);
  const ctx = await getAccountContext(tenantId, accountId);
  const days = parseDays(req.body?.days) || 365;
  return syncInsights(ctx, { days });
}));

router.post("/sync", metaAdsManage, handle(async (req) => {
  const tenantId = tenantOf(req);
  const accountId = await accountIdOf(tenantId, req.body?.account_id);
  const ctx = await getAccountContext(tenantId, accountId);
  requireToken(ctx);
  const result = await syncAll(ctx);
  const warnings = [];
  for (const [label, fn] of [["audiences", syncAudiences], ["lead_forms", syncLeadForms], ["product_sets", syncProductSets]]) {
    try {
      Object.assign(result, await fn(ctx));
    } catch (error) {
      warnings.push({ part: label, message: text(error?.userMessage || error?.message) });
    }
  }
  return { result, warnings };
}));

// "بناء الجمهور": the recommended audience set from the shop's own data (metaAdsAudiences.js).
router.post("/audiences/build", metaAdsManage, handle(async (req) => {
  const tenantId = tenantOf(req);
  const accountId = await accountIdOf(tenantId, req.body?.account_id);
  const ctx = await getAccountContext(tenantId, accountId);
  requireToken(ctx);
  return buildRecommendedAudiences(ctx);
}));

// ------------------------------------------------------------------ automated rules

const RULE_COLUMNS = `id, account_id, name, apply_to, window_days, metric, operator, value::float AS value, action, enabled,
  last_run_at, last_result, created_at, updated_at`;

const loadRule = async (tenantId, id) => {
  const { rows } = await db.query(`SELECT * FROM meta_ads_rules WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
  if (!rows[0]) throw httpError(404, "Rule not found");
  return rows[0];
};

router.get("/rules", metaAdsView, handle(async (req) => {
  const tenantId = tenantOf(req);
  const accountId = await accountIdOf(tenantId, req.query.account_id);
  const { rows } = await db.query(
    `SELECT ${RULE_COLUMNS} FROM meta_ads_rules WHERE tenant_id = $1 AND account_id = $2 ORDER BY created_at DESC, id DESC`,
    [tenantId, accountId],
  );
  return { rules: rows };
}));

router.post("/rules/save", metaAdsManage, handle(async (req) => {
  const tenantId = tenantOf(req);
  const rule = normalizeRule(req.body || {});
  const params = [rule.name, rule.apply_to, rule.window_days, rule.metric, rule.operator, rule.value, rule.action, rule.enabled];
  if (req.body?.id) {
    const id = parseId(req.body.id);
    await loadRule(tenantId, id);
    const { rows } = await db.query(
      `UPDATE meta_ads_rules SET name = $3, apply_to = $4, window_days = $5, metric = $6, operator = $7, value = $8, action = $9,
         enabled = $10, updated_at = NOW()
       WHERE tenant_id = $1 AND id = $2 RETURNING ${RULE_COLUMNS}`,
      [tenantId, id, ...params],
    );
    return { rule: rows[0] };
  }
  const accountId = await accountIdOf(tenantId, req.body?.account_id);
  const { rows } = await db.query(
    `INSERT INTO meta_ads_rules (tenant_id, account_id, name, apply_to, window_days, metric, operator, value, action, enabled, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING ${RULE_COLUMNS}`,
    [tenantId, accountId, ...params, req.user?.id ?? null],
  );
  return { rule: rows[0] };
}));

router.post("/rules/delete", metaAdsManage, handle(async (req) => {
  const tenantId = tenantOf(req);
  const id = parseId(req.body?.id);
  await loadRule(tenantId, id);
  await db.query(`DELETE FROM meta_ads_rules WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
  return { id };
}));

router.post("/rules/toggle", metaAdsManage, handle(async (req) => {
  const tenantId = tenantOf(req);
  const id = parseId(req.body?.id);
  await loadRule(tenantId, id);
  const { rows } = await db.query(
    `UPDATE meta_ads_rules SET enabled = $3, updated_at = NOW() WHERE tenant_id = $1 AND id = $2 RETURNING ${RULE_COLUMNS}`,
    [tenantId, id, Boolean(req.body?.enabled)],
  );
  return { rule: rows[0] };
}));

router.post("/rules/run-now", metaAdsManage, handle(async (req) => {
  const tenantId = tenantOf(req);
  const rule = await loadRule(tenantId, parseId(req.body?.id));
  const { matched, acted, errors } = await runRule(rule);
  return { matched, acted, errors };
}));

export default router;
