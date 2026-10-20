// Meta webhooks for the Ads module.
//
//  - Ad Account object → its own callback /api/meta-ads-public/webhook ("أحداث الإعلانات").
//  - Page `leadgen`    → arrives at the EXISTING page callback /api/meta/webhook (one
//    callback per object type per app). routes/metaIntegration.js hands the request to
//    handlePageWebhookForAds() fire-and-forget; it verifies the signature itself and
//    only looks at `leadgen` changes, so the messaging pipeline is untouched.

import db from "../../../database/db.js";
import { MetaAdsGraphError, decryptSecret, graphGet, graphGetAll, graphPost, metaAppConfig, normalizeAdAccountId } from "../metaAdsGraph.js";
import { getAccountContext, httpError, requireToken } from "../metaAdsCore.js";
import {
  clip,
  findOrCreateCustomer,
  isReady,
  log,
  lower,
  text,
  isKnownVerifyToken,
  verifyHubSignatureAsync,
  warn,
  writeAdEvent,
} from "./integrationsCommon.js";

// ------------------------------------------------------------------ verification

// GET /api/meta-ads-public/webhook
export const handleWebhookVerify = async (req, res) => {
  const mode = text(req.query?.["hub.mode"]);
  const token = text(req.query?.["hub.verify_token"]);
  const challenge = text(req.query?.["hub.challenge"]);
  if (mode === "subscribe" && (await isKnownVerifyToken(token))) return res.status(200).type("text/plain").send(challenge);
  warn("webhook-verify", "verification refused", { mode });
  return res.status(403).send("Invalid verification request");
};

// POST /api/meta-ads-public/webhook — answer at once, work afterwards.
export const handleWebhookPost = async (req, res) => {
  if (!(await verifyHubSignatureAsync(req.rawBody, req.headers?.["x-hub-signature-256"]))) {
    warn("webhook", "bad signature", { object: text(req.body?.object) });
    return res.status(401).json({ success: false, message: "Invalid signature" });
  }
  const body = req.body || {};
  res.status(200).json({ success: true });
  setImmediate(() => {
    void processAdsWebhook(body).catch((error) => warn("webhook-process", error));
  });
  return undefined;
};

// ------------------------------------------------------------------ ad account changes

const ISSUE_FIELDS = new Set(["with_issues_ad_objects", "product_set_issue", "ad_account_update_issue", "ads_disapproval"]);

const FIELD_LABELS = {
  with_issues_ad_objects: "Ad object has issues",
  in_process_ad_objects: "Ad object finished processing",
  ad_recommendations: "New ad recommendation",
  product_set_issue: "Product set issue",
};

const levelOf = (value = {}) => lower(value.level || value.object_type || value.type);

const summarize = (field, value = {}) => {
  const label = FIELD_LABELS[field] || field.replace(/_/g, " ");
  const level = text(value.level || value.object_type);
  const id = text(value.id || value.object_id || value.ad_id);
  const detail = text(value.error_summary || value.error_message || value.status_name || value.recommendation_type || value.message || value.title);
  return clip([label, [level, id].filter(Boolean).join(" "), detail].filter(Boolean).join(" — "), 900);
};

// Local ids for a Meta object id: { objectType, campaignId, adId, table }.
const resolveLocal = async (tenantId, metaId, level) => {
  if (!metaId) return { campaignId: null, adId: null, table: null };
  const tryAd = async () => {
    const { rows } = await db.query(
      `SELECT a.id AS ad_id, s.campaign_id FROM meta_ads_ads a LEFT JOIN meta_ads_adsets s ON s.id = a.adset_id
        WHERE a.tenant_id = $1 AND a.meta_id = $2 LIMIT 1`,
      [tenantId, metaId],
    );
    return rows[0] ? { adId: rows[0].ad_id, campaignId: rows[0].campaign_id, table: "meta_ads_ads", objectType: "ad" } : null;
  };
  const tryAdset = async () => {
    const { rows } = await db.query(`SELECT campaign_id FROM meta_ads_adsets WHERE tenant_id = $1 AND meta_id = $2 LIMIT 1`, [tenantId, metaId]);
    return rows[0] ? { adId: null, campaignId: rows[0].campaign_id, table: "meta_ads_adsets", objectType: "adset" } : null;
  };
  const tryCampaign = async () => {
    const { rows } = await db.query(`SELECT id FROM meta_ads_campaigns WHERE tenant_id = $1 AND meta_id = $2 LIMIT 1`, [tenantId, metaId]);
    return rows[0] ? { adId: null, campaignId: rows[0].id, table: "meta_ads_campaigns", objectType: "campaign" } : null;
  };
  const order = level === "ad" ? [tryAd, tryAdset, tryCampaign]
    : level === "adset" || level === "ad_set" ? [tryAdset, tryAd, tryCampaign]
      : [tryCampaign, tryAdset, tryAd];
  for (const attempt of order) {
    const found = await attempt();
    if (found) return found;
  }
  return { campaignId: null, adId: null, table: null };
};

const refreshObjectStatus = async (ctx, table, metaId) => {
  if (!table || !metaId || !ctx.token) return;
  const info = await graphGet(`/${metaId}`, ctx.token, { fields: "status,effective_status" });
  await db.query(
    `UPDATE ${table} SET status = COALESCE(NULLIF($3,''), status), effective_status = COALESCE(NULLIF($4,''), effective_status), updated_at = NOW()
      WHERE tenant_id = $1 AND meta_id = $2`,
    [ctx.account.tenant_id, metaId, text(info?.status), text(info?.effective_status)],
  );
};

const handleAdAccountChange = async (account, change, entryTime) => {
  const field = text(change?.field) || "unknown";
  const value = change?.value && typeof change.value === "object" ? change.value : { value: change?.value };
  const tenantId = account.tenant_id;
  const metaId = text(value.id || value.object_id || value.ad_id || value.adgroup_id || value.campaign_id) || null;
  const level = levelOf(value);
  const local = await resolveLocal(tenantId, metaId, level).catch(() => ({ campaignId: null, adId: null, table: null }));
  const eventId = await writeAdEvent({
    tenantId,
    accountId: account.id,
    severity: ISSUE_FIELDS.has(field) ? "warning" : "info",
    webhook: field,
    summary: summarize(field, value),
    objectType: local.objectType || level || null,
    objectMetaId: metaId,
    campaignId: local.campaignId,
    adId: local.adId,
    payload: change,
    eventTime: entryTime ? new Date(Number(entryTime) * 1000) : null,
  });
  try {
    if (local.table) {
      const ctx = await getAccountContext(tenantId, account.id);
      await refreshObjectStatus(ctx, local.table, metaId);
    }
  } catch (error) {
    warn("webhook-refresh", error, { tenant_id: tenantId, object: metaId });
  }
  await db.query(`UPDATE meta_ads_events SET processed = TRUE WHERE id = $1`, [eventId]);
};

export const processAdsWebhook = async (body = {}) => {
  if (!isReady()) return;
  const object = lower(body.object);
  for (const entry of Array.isArray(body.entry) ? body.entry : []) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    if (object === "page") {
      for (const change of changes) {
        if (text(change?.field) === "leadgen") await handleLeadgenChange(null, change.value).catch((error) => warn("leadgen", error));
      }
      continue;
    }
    if (object !== "ad_account") {
      log("webhook-unknown-object", { object, fields: changes.map((change) => change?.field) });
      continue;
    }
    const actId = normalizeAdAccountId(entry?.id);
    const { rows: accounts } = await db.query(`SELECT id, tenant_id FROM meta_ads_accounts WHERE ad_account_id = $1`, [actId]);
    if (!accounts.length) {
      log("webhook-no-account", { account: actId, fields: changes.map((change) => change?.field) });
      continue;
    }
    for (const account of accounts) {
      for (const change of changes) {
        await handleAdAccountChange(account, change, entry?.time).catch((error) => warn("webhook-change", error, { tenant_id: account.tenant_id, field: change?.field }));
      }
    }
  }
};

// ------------------------------------------------------------------ leads

const fieldValue = (fieldData, names) => {
  for (const name of names) {
    const hit = fieldData.find((item) => lower(item?.name) === name);
    const value = text(Array.isArray(hit?.values) ? hit.values[0] : hit?.values);
    if (value) return value;
  }
  return "";
};

export const leadContact = (fieldData = []) => {
  const list = Array.isArray(fieldData) ? fieldData : [];
  const first = fieldValue(list, ["first_name"]);
  const last = fieldValue(list, ["last_name"]);
  return {
    name: fieldValue(list, ["full_name", "name"]) || [first, last].filter(Boolean).join(" "),
    email: fieldValue(list, ["email", "work_email"]),
    phone: fieldValue(list, ["phone_number", "phone", "mobile_number", "whatsapp_number"]),
  };
};

const LEAD_FIELDS = "id,created_time,field_data,ad_id,adset_id,campaign_id,form_id,platform,is_organic";

const ensureFormRow = async (ctx, formMetaId) => {
  const tenantId = ctx.account.tenant_id;
  const { rows } = await db.query(`SELECT id, name FROM meta_ads_lead_forms WHERE tenant_id = $1 AND meta_id = $2`, [tenantId, formMetaId]);
  if (rows[0]) return rows[0];
  let info = {};
  try {
    info = await graphGet(`/${formMetaId}`, ctx.pageToken, { fields: "id,name,status,locale" });
  } catch (error) {
    warn("lead-form-info", error, { form: formMetaId });
  }
  const inserted = await db.query(
    `INSERT INTO meta_ads_lead_forms (tenant_id, account_id, page_id, meta_id, name, status, locale, webhook_enabled, raw, last_synced_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE,$8::jsonb,NOW())
     ON CONFLICT (tenant_id, meta_id) DO UPDATE SET updated_at = NOW() RETURNING id, name`,
    [tenantId, ctx.account.id, ctx.account.page_id, formMetaId, text(info.name), text(info.status) || "ACTIVE", text(info.locale) || null, JSON.stringify(info)],
  );
  return inserted.rows[0];
};

// Insert-or-update one lead. Returns { id, inserted, customerId, contact }.
export const upsertLead = async (ctx, lead, { formRow = null } = {}) => {
  const tenantId = ctx.account.tenant_id;
  const formMetaId = text(lead.form_id) || null;
  const form = formRow || (formMetaId ? await ensureFormRow(ctx, formMetaId) : null);
  const contact = leadContact(lead.field_data);
  let customerId = null;
  if (contact.phone) {
    customerId = await findOrCreateCustomer(tenantId, { phone: contact.phone, name: contact.name }).catch((error) => {
      warn("lead-customer", error, { tenant_id: tenantId });
      return null;
    });
  }
  const { rows } = await db.query(
    `INSERT INTO meta_ads_leads (tenant_id, form_id, form_meta_id, meta_lead_id, name, email, phone, customer_id, field_data,
       ad_meta_id, adset_meta_id, campaign_meta_id, platform, is_organic, created_time)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14,$15)
     ON CONFLICT (tenant_id, meta_lead_id) DO UPDATE SET
       form_id = COALESCE(EXCLUDED.form_id, meta_ads_leads.form_id), name = COALESCE(EXCLUDED.name, meta_ads_leads.name),
       email = COALESCE(EXCLUDED.email, meta_ads_leads.email), phone = COALESCE(EXCLUDED.phone, meta_ads_leads.phone),
       customer_id = COALESCE(meta_ads_leads.customer_id, EXCLUDED.customer_id), field_data = EXCLUDED.field_data,
       ad_meta_id = EXCLUDED.ad_meta_id, adset_meta_id = EXCLUDED.adset_meta_id, campaign_meta_id = EXCLUDED.campaign_meta_id,
       platform = EXCLUDED.platform, is_organic = EXCLUDED.is_organic, created_time = EXCLUDED.created_time
     RETURNING id, customer_id, (xmax = 0) AS inserted`,
    [
      tenantId, form?.id || null, formMetaId, text(lead.id), contact.name || null, contact.email || null, contact.phone || null, customerId,
      JSON.stringify(lead.field_data || []), text(lead.ad_id) || null, text(lead.adset_id) || null, text(lead.campaign_id) || null,
      text(lead.platform) || null, lead.is_organic === true, lead.created_time ? new Date(lead.created_time) : null,
    ],
  );
  const row = rows[0];
  if (row?.inserted && form?.id) {
    await db.query(`UPDATE meta_ads_lead_forms SET leads_count = leads_count + 1, updated_at = NOW() WHERE tenant_id = $1 AND id = $2`, [tenantId, form.id]);
  }
  return { id: row?.id, inserted: Boolean(row?.inserted), customerId: row?.customer_id || null, contact, form };
};

// All connected accounts (tenant-scoped when known) that own a page.
const accountsForPage = async (tenantId, pageId) => {
  const { rows } = await db.query(
    `SELECT id, tenant_id FROM meta_ads_accounts
      WHERE page_id = $1 AND ($2::bigint IS NULL OR tenant_id = $2::bigint)
      ORDER BY (COALESCE(page_access_token_encrypted,'') <> '') DESC, id`,
    [pageId, tenantId],
  );
  return rows;
};

// One `leadgen` change: { leadgen_id, page_id, form_id, ad_id, adgroup_id, created_time }.
export const handleLeadgenChange = async (tenantId, value = {}) => {
  if (!isReady()) return null;
  const leadgenId = text(value?.leadgen_id);
  const pageId = text(value?.page_id);
  if (!leadgenId || !pageId) return null;
  let accounts = await accountsForPage(tenantId || null, pageId);
  if (!accounts.length && tenantId) accounts = await accountsForPage(null, pageId);
  if (!accounts.length) {
    log("leadgen-no-account", { page_id: pageId });
    return null;
  }
  // Same page connected by more than one tenant: each gets its copy.
  const seenTenants = new Set();
  let last = null;
  for (const account of accounts) {
    if (seenTenants.has(String(account.tenant_id))) continue;
    seenTenants.add(String(account.tenant_id));
    try {
      const ctx = await getAccountContext(account.tenant_id, account.id);
      const lead = await graphGet(`/${leadgenId}`, ctx.pageToken, { fields: LEAD_FIELDS });
      const saved = await upsertLead(ctx, { ...lead, form_id: lead.form_id || value.form_id, ad_id: lead.ad_id || value.ad_id });
      if (saved.inserted) {
        const local = await resolveLocal(account.tenant_id, text(lead.ad_id || value.ad_id), "ad").catch(() => ({}));
        await writeAdEvent({
          tenantId: account.tenant_id,
          accountId: account.id,
          severity: "info",
          webhook: "leadgen",
          summary: clip(`Lead received${saved.contact.name ? `: ${saved.contact.name}` : ""}${saved.form?.name ? ` — ${saved.form.name}` : ""}`, 500),
          objectType: "lead",
          objectMetaId: leadgenId,
          campaignId: local.campaignId || null,
          adId: local.adId || null,
          processed: true,
          payload: value,
        });
        const { sendLeadConversion } = await import("./conversions.js");
        void sendLeadConversion(account.tenant_id, { leadId: saved.id, lead, contact: saved.contact, customerId: saved.customerId })
          .catch((error) => warn("lead-capi", error, { tenant_id: account.tenant_id }));
      }
      log("leadgen", { tenant_id: account.tenant_id, lead: leadgenId, inserted: saved.inserted });
      last = saved;
    } catch (error) {
      warn("leadgen", error, { tenant_id: account.tenant_id, lead: leadgenId });
    }
  }
  return last;
};

// Hook target for routes/metaIntegration.js (POST /api/meta/webhook). Must never
// throw into the caller; the body is captured before the caller can reassign it.
export const handlePageWebhookForAds = async ({ body, rawBody, signature }) => {
  if (!isReady() || lower(body?.object) !== "page") return;
  const leadChanges = [];
  for (const entry of Array.isArray(body?.entry) ? body.entry : []) {
    for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
      if (text(change?.field) === "leadgen" && change?.value) leadChanges.push(change.value);
    }
  }
  if (!leadChanges.length) return;
  if (!(await verifyHubSignatureAsync(rawBody, signature))) {
    warn("leadgen", "bad signature on page webhook; leadgen ignored");
    return;
  }
  for (const value of leadChanges) await handleLeadgenChange(null, value).catch((error) => warn("leadgen", error));
};

export const syncLeadsForForm = async (ctx, formId) => {
  const tenantId = ctx.account.tenant_id;
  const { rows } = await db.query(
    `SELECT * FROM meta_ads_lead_forms WHERE tenant_id = $1 AND (id::text = $2 OR meta_id = $2) LIMIT 1`,
    [tenantId, text(formId)],
  );
  const form = rows[0];
  if (!form) throw httpError(404, "Lead form not found");
  const formCtx = form.account_id && String(form.account_id) !== String(ctx.account.id) ? await getAccountContext(tenantId, form.account_id) : ctx;
  const leads = await graphGetAll(`/${form.meta_id}/leads`, formCtx.pageToken, { fields: LEAD_FIELDS }, { limit: 5000 });
  let inserted = 0;
  for (const lead of leads) {
    const saved = await upsertLead(formCtx, { ...lead, form_id: lead.form_id || form.meta_id }, { formRow: form });
    if (saved.inserted) inserted += 1;
  }
  await db.query(
    `UPDATE meta_ads_lead_forms SET leads_count = GREATEST(leads_count, $3), last_synced_at = NOW(), updated_at = NOW() WHERE tenant_id = $1 AND id = $2`,
    [tenantId, form.id, leads.length],
  );
  return { leads: leads.length, new_leads: inserted };
};

// ------------------------------------------------------------------ subscriptions

export const subscribePageLeadgen = async (ctx) => {
  const pageId = text(ctx.account.page_id);
  if (!pageId) throw httpError(409, "Link a Facebook Page to this ad account first (reconnect and pick a page).");
  const pageToken = decryptSecret(ctx.account.page_access_token_encrypted);
  if (!pageToken) throw httpError(409, "The linked Page has no access token. Reconnect the account.", "META_ADS_NOT_CONNECTED");
  const { appId } = metaAppConfig();
  // The messaging integration subscribed this same app on this same page to its own
  // fields; a POST replaces the list, so read it first and add leadgen to it.
  let current = [];
  try {
    const existing = await graphGet(`/${pageId}/subscribed_apps`, pageToken, {});
    const mine = (existing?.data || []).find((app) => !appId || text(app.id) === appId) || null;
    current = Array.isArray(mine?.subscribed_fields) ? mine.subscribed_fields.map(text).filter(Boolean) : [];
  } catch (error) {
    warn("page-subscribed-apps-read", error, { page: pageId });
  }
  const fields = [...new Set([...current, "leadgen"])];
  await graphPost(`/${pageId}/subscribed_apps`, pageToken, { subscribed_fields: fields.join(",") });
  await db.query(`UPDATE meta_ads_lead_forms SET webhook_enabled = TRUE, updated_at = NOW() WHERE tenant_id = $1 AND page_id = $2`, [ctx.account.tenant_id, pageId]);
  log("page-leadgen-subscribed", { tenant_id: ctx.account.tenant_id, page: pageId, fields });
  return { subscribed: true, fields };
};

const DEFAULT_ACCOUNT_FIELDS = ["with_issues_ad_objects", "in_process_ad_objects", "ad_recommendations", "product_set_issue"];

export const subscribeAccountWebhooks = async (ctx) => {
  const token = requireToken(ctx);
  await graphPost(`/${ctx.actId}/subscribed_apps`, token, {});
  const configured = text(process.env.META_ADS_WEBHOOK_FIELDS).split(",").map(text).filter(Boolean);
  const fields = configured.length ? configured : DEFAULT_ACCOUNT_FIELDS;
  try {
    // Confirms the subscription exists (the fields themselves are chosen in the App Dashboard).
    await graphGet(`/${ctx.actId}/subscribed_apps`, token, {});
  } catch (error) {
    if (!(error instanceof MetaAdsGraphError)) throw error;
  }
  const { rows } = await db.query(
    `UPDATE meta_ads_accounts SET webhook_fields = $3::jsonb, webhook_subscribed_at = NOW(), updated_at = NOW()
      WHERE tenant_id = $1 AND id = $2 RETURNING webhook_subscribed_at`,
    [ctx.account.tenant_id, ctx.account.id, JSON.stringify(fields)],
  );
  log("account-webhooks-subscribed", { tenant_id: ctx.account.tenant_id, account: ctx.actId });
  return { fields, subscribed_at: rows[0]?.webhook_subscribed_at || new Date() };
};
