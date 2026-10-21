// The Meta App Review account inside Meta Ads. server/services/metaReviewerRoutePolicy.js decides
// WHICH routes the reviewer may call; this file holds the checks that need the Meta Ads tables:
//
//   - edits and deletes touch DRAFTS only (never a row that already exists on Meta)
//   - publish: only a brand-new tree (nothing of it on Meta yet), only into an ad account listed in
//     META_REVIEWER_ADS_PUBLISH_AD_ACCOUNT_IDS (default none = publish refused), and the campaign
//     is forced to publish_status PAUSED, so the publisher never switches it on: the reviewer sees
//     the real publish flow, Meta gets the objects, nothing delivers and nothing is spent.
//     Activating, pausing, pushing/updating/deleting live objects and rules stay refused by the policy.
//   - leads (personal data): only leads of lead forms listed in META_REVIEWER_ADS_LEAD_FORM_IDS
//     (Meta form ids); default none = an empty list. Ad clicks and conversion events name real
//     customers and are always empty; ad events drop lead notifications ("Lead received: <name>").
import db from "../../database/db.js";
import { isMetaReviewerRole } from "../../services/metaReviewerAccessService.js";

const text = (value) => String(value ?? "").trim();
const csv = (value) => [...new Set(text(value).split(",").map(text).filter(Boolean))];
const actId = (value) => text(value).replace(/^act_/i, "");

export const META_ADS_REVIEWER_LIVE_MESSAGE =
  "The review account works on drafts only: this object is already live on Meta and cannot be changed or deleted from the review account.";

const refuse = (status, message, code) => Object.assign(new Error(message), { status, code });

export const isMetaAdsReviewer = (req) => Boolean(req?.metaReviewer) || isMetaReviewerRole(req?.user?.role || req?.user?.role_name);

const TABLES = { campaigns: "meta_ads_campaigns", adsets: "meta_ads_adsets", ads: "meta_ads_ads", creatives: "meta_ads_creatives" };
const DRAFT_TABLES = { campaign: "meta_ads_campaigns", adset: "meta_ads_adsets", ad: "meta_ads_ads" };

const tenantFromReq = (req) => Number(req.metaReviewer?.tenantId || req.user?.tenant_id || 0) || 0;

const requireDraftRow = async (query, table, tenantId, id) => {
  const { rows } = await query(`SELECT id, meta_id FROM ${table} WHERE tenant_id = $1 AND id = $2`, [tenantId, Number(id) || 0]);
  if (!rows?.[0]) throw refuse(404, "Record not found", "META_ADS_RECORD_NOT_FOUND");
  if (text(rows[0].meta_id)) throw refuse(403, META_ADS_REVIEWER_LIVE_MESSAGE, "META_REVIEWER_LIVE_ACTION_BLOCKED");
};

/*
 * Publish preparation for the reviewer. Throws to refuse; on success the campaign is stored with
 * publish_status PAUSED (and status PAUSED) before the publisher runs.
 */
export const prepareReviewerPublish = async ({ tenantId, campaignId, env = process.env, query = (sql, params) => db.query(sql, params) }) => {
  const allowedAccounts = csv(env.META_REVIEWER_ADS_PUBLISH_AD_ACCOUNT_IDS).map(actId);
  if (!allowedAccounts.length) {
    throw refuse(403, "Publishing is disabled for the review account. Drafts, validation, previews and reach estimates are available.", "META_REVIEWER_PUBLISH_DISABLED");
  }
  const { rows } = await query(
    `SELECT c.id, c.meta_id, a.ad_account_id,
            (SELECT COUNT(*) FROM meta_ads_adsets s WHERE s.tenant_id = c.tenant_id AND s.campaign_id = c.id AND s.meta_id IS NOT NULL)::int AS live_adsets,
            (SELECT COUNT(*) FROM meta_ads_ads ad JOIN meta_ads_adsets s ON s.id = ad.adset_id AND s.tenant_id = ad.tenant_id
              WHERE s.tenant_id = c.tenant_id AND s.campaign_id = c.id AND ad.meta_id IS NOT NULL)::int AS live_ads
       FROM meta_ads_campaigns c LEFT JOIN meta_ads_accounts a ON a.id = c.account_id AND a.tenant_id = c.tenant_id
      WHERE c.tenant_id = $1 AND c.id = $2`,
    [tenantId, Number(campaignId) || 0]
  );
  const row = rows?.[0];
  if (!row) throw refuse(404, "Campaign not found", "META_ADS_RECORD_NOT_FOUND");
  if (text(row.meta_id) || Number(row.live_adsets) > 0 || Number(row.live_ads) > 0) {
    throw refuse(403, META_ADS_REVIEWER_LIVE_MESSAGE, "META_REVIEWER_LIVE_ACTION_BLOCKED");
  }
  if (!allowedAccounts.includes(actId(row.ad_account_id))) {
    throw refuse(403, "The review account can only publish into the ad account set aside for the review.", "META_REVIEWER_AD_ACCOUNT_FORBIDDEN");
  }
  await query(
    `UPDATE meta_ads_campaigns SET spec = COALESCE(spec, '{}'::jsonb) || '{"publish_status":"PAUSED"}'::jsonb, status = 'PAUSED', updated_at = NOW()
      WHERE tenant_id = $1 AND id = $2 AND meta_id IS NULL`,
    [tenantId, row.id]
  );
  return { paused: true };
};

/* Express middleware, mounted before every Meta Ads sub-router. A no-op for everyone else. */
export const metaAdsReviewerGuard = async (req, res, next) => {
  if (!isMetaAdsReviewer(req)) return next();
  try {
    const query = (sql, params) => db.query(sql, params);
    const tenantId = tenantFromReq(req);
    const path = String(req.path || "");
    const method = String(req.method || "GET").toUpperCase();
    const body = req.body && typeof req.body === "object" ? req.body : {};

    const record = /^\/records\/(campaigns|adsets|ads|creatives)\/(\d+)$/.exec(path);
    if (record && (method === "PUT" || method === "DELETE")) await requireDraftRow(query, TABLES[record[1]], tenantId, record[2]);

    const draft = /^\/manager\/wizard\/drafts\/(campaign|adset|ad)$/.exec(path);
    if (draft && method === "POST" && body.id) await requireDraftRow(query, DRAFT_TABLES[draft[1]], tenantId, body.id);

    if (method === "POST" && path === "/manager/wizard/publish") {
      await prepareReviewerPublish({ tenantId, campaignId: body.campaign_id, query });
    }
    return next();
  } catch (error) {
    return res.status(Number(error?.status) || 500).json({ success: false, code: error?.code || "META_REVIEWER_FORBIDDEN", message: error?.message || "Refused" });
  }
};

/*
 * Extra WHERE for record reads by the reviewer: null = no restriction. The returned function gets
 * the next free $n and returns { sql, params }.
 */
export const reviewerRecordScope = (key, env = process.env) => {
  if (key === "leads") {
    const forms = csv(env.META_REVIEWER_ADS_LEAD_FORM_IDS);
    if (!forms.length) return () => ({ sql: "FALSE", params: [] });
    return (n) => ({
      sql: `t.form_id IN (SELECT lf.id FROM meta_ads_lead_forms lf WHERE lf.tenant_id = t.tenant_id AND lf.meta_id = ANY($${n}::text[]))`,
      params: [forms],
    });
  }
  if (key === "ad-clicks" || key === "conversion-events") return () => ({ sql: "FALSE", params: [] });
  if (key === "ad-events") return () => ({ sql: "COALESCE(t.webhook, '') NOT ILIKE '%lead%'", params: [] });
  return null;
};
