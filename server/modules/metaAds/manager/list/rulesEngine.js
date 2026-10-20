// Automated rules ("القواعد التلقائية"). A rule watches one metric of every live
// object at one level over a window of days, and pauses / activates the objects
// that match (or only logs them). Run by the 15-minute job and by "run now".

import db from "../../../../database/db.js";
import { getAccountContext, httpError, num, text } from "../../metaAdsCore.js";
import { setObjectStatus } from "../wizard/metaAdsPublisher.js";
import { LEVEL_TABLE } from "./managerData.js";

export const RULE_LEVELS = ["campaign", "adset", "ad"];
export const RULE_WINDOWS = [1, 7, 30, 0];
export const RULE_METRICS = ["spend", "clicks", "impressions", "reach", "cpc", "ctr"];
export const RULE_OPERATORS = ["gt", "lt"];
export const RULE_ACTIONS = ["pause", "activate", "notify_only"];

const ACTION_STATUS = { pause: "PAUSED", activate: "ACTIVE" };
const LEVEL_WORD = { campaign: "الحملة", adset: "المجموعة الإعلانية", ad: "الإعلان" };
const ACTION_WORD = { pause: "تم الإيقاف المؤقت لـ", activate: "تم تفعيل", notify_only: "تنبيه:" };
const FAILED_WORD = { pause: "تعذّر الإيقاف المؤقت لـ", activate: "تعذّر تفعيل", notify_only: "تنبيه:" };

export const normalizeRule = (body = {}) => {
  const rule = {
    name: text(body.name),
    apply_to: text(body.apply_to) || "campaign",
    window_days: Number(body.window_days ?? 7),
    metric: text(body.metric) || "spend",
    operator: text(body.operator) || "gt",
    value: num(body.value, NaN),
    action: text(body.action) || "pause",
    enabled: body.enabled === undefined ? true : Boolean(body.enabled),
  };
  if (!rule.name) throw httpError(400, "Rule name is required", "META_ADS_RULE_NAME");
  if (!RULE_LEVELS.includes(rule.apply_to)) throw httpError(400, "Invalid apply_to");
  if (!RULE_WINDOWS.includes(rule.window_days)) throw httpError(400, "Invalid window_days");
  if (!RULE_METRICS.includes(rule.metric)) throw httpError(400, "Invalid metric");
  if (!RULE_OPERATORS.includes(rule.operator)) throw httpError(400, "Invalid operator");
  if (!Number.isFinite(rule.value) || rule.value < 0) throw httpError(400, "Invalid value", "META_ADS_RULE_VALUE");
  if (!RULE_ACTIONS.includes(rule.action)) throw httpError(400, "Invalid action");
  return rule;
};

const metricValue = (metric, totals) => {
  const spend = num(totals.spend);
  const clicks = num(totals.clicks);
  const impressions = num(totals.impressions);
  if (metric === "cpc") return clicks > 0 ? spend / clicks : null;
  if (metric === "ctr") return impressions > 0 ? (clicks / impressions) * 100 : null;
  return num(totals[metric]);
};

const matches = (operator, value, threshold) => {
  if (value === null || !Number.isFinite(value)) return false;
  return operator === "gt" ? value > threshold : value < threshold;
};

// Live objects of the rule's level with their totals over the window.
const candidates = async (rule) => {
  const table = LEVEL_TABLE[rule.apply_to];
  const window = Number(rule.window_days) > 0
    ? `AND i.date_start > (NOW() AT TIME ZONE 'Africa/Cairo')::date - $4::int`
    : "AND ($4::int IS NOT NULL)";
  const { rows } = await db.query(
    `WITH ins AS (
       SELECT i.object_meta_id, SUM(i.spend) AS spend, SUM(i.clicks) AS clicks, SUM(i.impressions) AS impressions, SUM(i.reach) AS reach
         FROM meta_ads_insights i
        WHERE i.tenant_id = $1 AND i.account_id = $2 AND i.level = $3 ${window}
        GROUP BY i.object_meta_id
     )
     SELECT x.id, x.meta_id, x.name, x.status, ins.spend, ins.clicks, ins.impressions, ins.reach
       FROM ${table} x
       LEFT JOIN ins ON ins.object_meta_id = x.meta_id
      WHERE x.tenant_id = $1 AND x.account_id = $2 AND x.is_draft = FALSE AND x.meta_id IS NOT NULL
        AND UPPER(x.status) IN ('ACTIVE', 'PAUSED')
      ORDER BY x.id`,
    [rule.tenant_id, rule.account_id, rule.apply_to, Number(rule.window_days) || 0],
  );
  return rows;
};

const fmt = (value) => (Number.isFinite(value) ? Number(value.toFixed(4)).toString() : "—");

// A notice / failure for the same rule + object is logged once a day, not every 15 minutes.
const loggedRecently = async (rule, object) => {
  const { rows } = await db.query(
    `SELECT 1 FROM meta_ads_events
      WHERE tenant_id = $1 AND webhook = 'automated_rule' AND object_meta_id = $2
        AND payload->>'rule_id' = $3::text AND event_time > NOW() - INTERVAL '24 hours'
        AND (payload->>'acted') = 'false'
      LIMIT 1`,
    [rule.tenant_id, object.meta_id, String(rule.id)],
  );
  return rows.length > 0;
};

const logEvent = async (rule, object, value, outcome) => {
  if (!outcome.acted && (await loggedRecently(rule, object))) return;
  const op = rule.operator === "gt" ? ">" : "<";
  const verb = outcome.error ? FAILED_WORD[rule.action] : ACTION_WORD[rule.action];
  const summary = `${verb} ${LEVEL_WORD[rule.apply_to]} "${object.name}" — القاعدة "${rule.name}" (${rule.metric} = ${fmt(value)} ${op} ${fmt(num(rule.value))})${outcome.error ? ` — ${outcome.error}` : ""}`;
  await db.query(
    `INSERT INTO meta_ads_events (tenant_id, account_id, event_time, severity, webhook, summary, object_type, object_meta_id, campaign_id, ad_id, processed, payload)
     VALUES ($1,$2,NOW(),$3,'automated_rule',$4,$5,$6,$7,$8,TRUE,$9::jsonb)`,
    [
      rule.tenant_id, rule.account_id, outcome.error ? "warning" : "info", summary.slice(0, 1000), rule.apply_to, object.meta_id,
      rule.apply_to === "campaign" ? object.id : null, rule.apply_to === "ad" ? object.id : null,
      JSON.stringify({ rule_id: rule.id, metric: rule.metric, operator: rule.operator, threshold: num(rule.value), value, action: rule.action, acted: outcome.acted, error: outcome.error || null }),
    ],
  );
};

// Runs one rule row (meta_ads_rules) now. ctxCache lets the job share one account context per account.
export const runRule = async (rule, { ctxCache = new Map() } = {}) => {
  const matched = [];
  const errors = [];
  let acted = 0;
  const target = ACTION_STATUS[rule.action];
  const objects = await candidates(rule);
  for (const object of objects) {
    const value = metricValue(rule.metric, object);
    if (!matches(rule.operator, value, num(rule.value))) continue;
    matched.push({ level: rule.apply_to, id: object.id, name: object.name, value });
    if (!target) {
      await logEvent(rule, object, value, { acted: false });
      continue;
    }
    if (String(object.status).toUpperCase() === target) continue;
    const outcome = { acted: false, error: null };
    try {
      const key = String(rule.account_id);
      if (!ctxCache.has(key)) ctxCache.set(key, await getAccountContext(rule.tenant_id, rule.account_id));
      await setObjectStatus(ctxCache.get(key), rule.apply_to, object.id, target);
      outcome.acted = true;
      acted += 1;
    } catch (error) {
      outcome.error = text(error?.userMessage || error?.message).slice(0, 300) || "failed";
      errors.push({ id: object.id, error: outcome.error });
    }
    await logEvent(rule, object, value, outcome);
  }
  const result = { matched: matched.length, acted, errors, ran_at: new Date().toISOString() };
  await db.query(
    `UPDATE meta_ads_rules SET last_run_at = NOW(), last_result = $3::jsonb WHERE tenant_id = $1 AND id = $2`,
    [rule.tenant_id, rule.id, JSON.stringify(result)],
  );
  return { matched, acted, errors };
};

// The 15-minute job: every tenant's enabled rules. One failing rule never stops the rest.
export const runAllRules = async () => {
  const { rows } = await db.query(`SELECT * FROM meta_ads_rules WHERE enabled = TRUE ORDER BY tenant_id, account_id, id`);
  const ctxCache = new Map();
  let ran = 0;
  let failed = 0;
  for (const rule of rows) {
    try {
      await runRule(rule, { ctxCache });
      ran += 1;
    } catch (error) {
      failed += 1;
      console.warn("[meta-ads] automated rule failed", { rule: rule.id, tenant: rule.tenant_id, message: text(error?.message).slice(0, 300) });
      await db.query(
        `UPDATE meta_ads_rules SET last_run_at = NOW(), last_result = $3::jsonb WHERE tenant_id = $1 AND id = $2`,
        [rule.tenant_id, rule.id, JSON.stringify({ error: text(error?.message).slice(0, 300), ran_at: new Date().toISOString() })],
      ).catch(() => {});
    }
  }
  return { ran, failed };
};
