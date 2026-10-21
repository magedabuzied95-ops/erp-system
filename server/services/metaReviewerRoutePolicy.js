/*
 * The Meta App Review account's API policy for the WhatsApp Business Platform and Meta Ads
 * sections (second App Review submission). metaReviewerBoundary.js consults it for every request
 * that carries a meta_reviewer token; anything not matched here stays 403, as before.
 *
 * An entry is { method, path, grants, guard?, transform?, deny? }:
 *   grants     the module.action pairs permit() may accept for THIS request only (code-level,
 *              route-scoped: the reviewer role holds no settings/meta_ads grants in the database)
 *   guard      async (req, ctx) — throws a status-carrying error to refuse, and may narrow the
 *              request (force the test number into a query/body) before the route sees it
 *   transform  (body, ctx) → body — narrows a JSON response to the test number's data
 *   deny       the message of an explicit refusal (live / money / connect actions)
 *
 * Fail-closed rules: no WhatsApp test number configured → every WhatsApp entry refuses; a guard
 * that cannot prove an object belongs to the test number refuses; a transform that throws turns
 * the response into a 500 instead of passing the unfiltered body through.
 */
import db from "../database/db.js";
import { cloudConfig } from "./whatsappCloudProvider.js";
import {
  getMetaReviewerChannelScope,
  loadMetaReviewerScope,
  metaReviewerWhatsappPhoneAllowed,
} from "./metaReviewerAccessService.js";

const text = (value = "") => String(value ?? "").trim();
const asArray = (value) => (Array.isArray(value) ? value : []);

export const reviewerError = (status, message, code = "META_REVIEWER_FORBIDDEN") => Object.assign(new Error(message), { status, code });

export const META_REVIEWER_LIVE_ACTION_MESSAGE =
  "The review account cannot change live objects on Meta or spend money. Drafts, validation, previews and reach estimates are available; publishing creates new campaigns PAUSED.";
export const META_REVIEWER_CONNECT_MESSAGE =
  "Connecting, registering or disconnecting WhatsApp numbers is disabled for the review account. The test number is already connected.";
export const META_REVIEWER_OUT_OF_SCOPE_MESSAGE = "This item is outside the WhatsApp test number used for the review.";

const VIEW = ["settings.view"];
const EDIT = ["settings.view", "settings.edit"];
const ADS_VIEW = ["meta_ads.view"];
const ADS_MANAGE = ["meta_ads.view", "meta_ads.manage"];
export const META_REVIEWER_INBOX_GRANTS = ["ai_inbox_whatsapp.view", "ai_inbox_whatsapp.reply"];

/* ------------------------------------------------------------------ dependencies (injectable for tests) */

const lazy = (loader, name) => async (...args) => (await loader())[name](...args);

export const defaultMetaReviewerPolicyDeps = {
  query: (sql, params) => db.query(sql, params),
  cloudEnv: () => cloudConfig(),
  templateCredentials: lazy(() => import("./whatsappTemplateStudioService.js"), "resolveTemplateCredentials"),
  sendCredentials: lazy(() => import("./whatsappApiAccessService.js"), "resolveSendCredentials"),
  resolveAudience: lazy(() => import("./marketingBroadcastService.js"), "resolveBroadcastAudienceRows"),
};

/* ------------------------------------------------------------------ request helpers */

export const setRequestQueryParam = (req, key, value) => {
  const current = String(req.url || req.originalUrl || "/");
  const url = new URL(current, "http://reviewer.local");
  url.searchParams.set(key, String(value));
  req.url = `${url.pathname}${url.search}`;
};

const bodyOf = (req) => {
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) req.body = {};
  return req.body;
};

const queryOf = (req) => {
  const url = new URL(String(req.url || req.originalUrl || "/"), "http://reviewer.local");
  return Object.fromEntries(url.searchParams.entries());
};

/* ------------------------------------------------------------------ WhatsApp context */

export const loadReviewerWhatsappContext = async (scope = loadMetaReviewerScope(), deps = defaultMetaReviewerPolicyDeps) => {
  const config = getMetaReviewerChannelScope(scope, "whatsapp");
  if (!scope?.enabled || !config?.enabled || !asArray(config.assetIds).length) {
    throw reviewerError(403, "The WhatsApp test number is not configured for this review account.", "META_REVIEWER_WHATSAPP_DISABLED");
  }
  const rows = await deps.query(
    `SELECT id, waba_id, phone_number_id, status FROM whatsapp_cloud_integrations WHERE tenant_id = $1 AND phone_number_id = ANY($2::text[])`,
    [scope.tenantId, config.assetIds]
  ).then((result) => asArray(result?.rows)).catch(() => []);
  const integrationIds = new Set(rows.map((row) => String(row.id)));
  const wabaIds = new Set(rows.map((row) => text(row.waba_id)).filter(Boolean));
  const env = deps.cloudEnv?.() || {};
  if (text(env.phoneNumberId) && config.assetIds.includes(text(env.phoneNumberId))) {
    integrationIds.add("env");
    if (text(env.businessAccountId)) wabaIds.add(text(env.businessAccountId));
  }
  return { scope, config, phoneNumberIds: [...config.assetIds], integrationIds, wabaIds };
};

const requireIntegration = (ctx, id) => {
  if (!ctx.wa.integrationIds.has(text(id))) throw reviewerError(403, META_REVIEWER_OUT_OF_SCOPE_MESSAGE);
};

const requireTestWaba = async (ctx) => {
  const credentials = await ctx.deps.templateCredentials(ctx.scope.tenantId).catch(() => null);
  if (!credentials || !ctx.wa.wabaIds.has(text(credentials.wabaId))) {
    throw reviewerError(403, "Templates can only be sent to Meta for the WhatsApp test number's account.", "META_REVIEWER_WABA_FORBIDDEN");
  }
};

export const reviewerTemplateVisible = (template = {}, wa) => !text(template.waba_id) || wa.wabaIds.has(text(template.waba_id));

const requireTemplateRow = async (ctx, id, { byMetaId = false } = {}) => {
  const wanted = text(id);
  const { rows } = await ctx.deps.query(
    byMetaId
      ? `SELECT id, waba_id, meta_template_id FROM whatsapp_message_templates WHERE tenant_id = $1 AND (id::text = $2 OR meta_template_id = $2) LIMIT 1`
      : `SELECT id, waba_id, meta_template_id FROM whatsapp_message_templates WHERE tenant_id = $1 AND id::text = $2 LIMIT 1`,
    [ctx.scope.tenantId, wanted]
  );
  const row = rows?.[0];
  if (!row || !reviewerTemplateVisible(row, ctx.wa)) throw reviewerError(403, META_REVIEWER_OUT_OF_SCOPE_MESSAGE);
  return row;
};

const onlyTestNumbers = (list, wa) => asArray(list).filter((item) => wa.phoneNumberIds.includes(text(item?.phone_number_id)));

// Generic: every array of number objects in a WhatsApp response keeps the test number only.
export const scopeWhatsappNumbersBody = (body = {}, ctx) => {
  const out = { ...body };
  for (const key of ["accounts", "numbers", "integrations"]) {
    if (Array.isArray(out[key])) out[key] = onlyTestNumbers(out[key], ctx.wa);
  }
  if (out.integration && !ctx.wa.phoneNumberIds.includes(text(out.integration.phone_number_id))) out.integration = null;
  if ("connected" in out && Array.isArray(out.integrations)) out.connected = out.integrations.some((row) => row.status === "connected");
  return out;
};

/* ------------------------------------------------------------------ flows */

const flowNumbers = (flow = {}) => asArray(flow.phone_number_ids).map(text).filter(Boolean);
export const reviewerFlowVisible = (flow = {}, wa) => {
  const numbers = flowNumbers(flow);
  return numbers.length > 0 && numbers.every((id) => wa.phoneNumberIds.includes(id));
};

const requireFlow = async (ctx, id) => {
  const { rows } = await ctx.deps.query(`SELECT id, phone_number_ids FROM wa_chatbot_flows WHERE tenant_id = $1 AND id = $2`, [ctx.scope.tenantId, Number(id) || 0]);
  if (!rows?.[0] || !reviewerFlowVisible(rows[0], ctx.wa)) throw reviewerError(403, META_REVIEWER_OUT_OF_SCOPE_MESSAGE);
  return rows[0];
};

const forceFlowNumbers = (req, ctx, { required = false } = {}) => {
  const body = bodyOf(req);
  if (body.phone_number_ids === undefined) {
    if (required) body.phone_number_ids = [...ctx.wa.phoneNumberIds];
    return;
  }
  const numbers = asArray(body.phone_number_ids).map(text).filter(Boolean);
  if (!numbers.length || !numbers.every((id) => ctx.wa.phoneNumberIds.includes(id))) {
    throw reviewerError(403, "A review flow can only run on the WhatsApp test number.", "META_REVIEWER_FLOW_NUMBERS");
  }
};

/* ------------------------------------------------------------------ campaigns */

const phoneAllowedForSending = (phone, ctx) => metaReviewerWhatsappPhoneAllowed(phone, ctx.scope, { requireList: true });

export const reviewerBroadcastVisible = (broadcast = {}) => {
  const ids = asArray(broadcast?.audience?.restrict_customer_ids);
  return ids.length > 0;
};

const requireBroadcast = async (ctx, id) => {
  const { rows } = await ctx.deps.query(`SELECT * FROM marketing_broadcasts WHERE tenant_id = $1 AND id = $2 LIMIT 1`, [ctx.scope.tenantId, Number(id) || 0]);
  const row = rows?.[0];
  if (!row || !reviewerBroadcastVisible(row)) throw reviewerError(403, META_REVIEWER_OUT_OF_SCOPE_MESSAGE);
  return row;
};

/*
 * The audience the campaign would reach, resolved exactly as the sender resolves it, NARROWED to
 * the allow-listed test phones (a phone allowlist is REQUIRED here). Only those customers' ids are
 * returned; the caller writes them back as audience.restrict_customer_ids, which the audience
 * query honours at every later run (scheduled, deferred to the morning, resumed), so the audience
 * can never widen to a real customer. Narrowing rather than refusing: the review UI only offers
 * "All customers", which for the reviewer means "the test phones" (its preview already says so).
 */
// narrow: true when writing a campaign (create/update) — the audience is cut down to the test
// phones. A SEND of a stored campaign stays strict: if its saved audience reaches anyone else
// (tampered or widened), it is refused, never silently narrowed at the last moment.
export const assertReviewerAudience = async (ctx, { audience = {}, frequencyCapDays, requireRecipients = false, narrow = false } = {}) => {
  // The frequency cap is left out on purpose: the check runs on the superset a later run could
  // reach once the cap expires, not just on who happens to be eligible this minute.
  const rows = asArray(await ctx.deps.resolveAudience({ tenantId: ctx.scope.tenantId, audience, frequencyCapDays, applyFrequencyCap: false }));
  const allowed = rows.filter((row) => phoneAllowedForSending(row.phone, ctx));
  if (!narrow && allowed.length !== rows.length) {
    throw reviewerError(403, "The review account can only send campaigns to the allow-listed WhatsApp test phones. This audience includes other customers.", "META_REVIEWER_AUDIENCE_FORBIDDEN");
  }
  // No allow-listed test phone in reach (or no phone allowlist configured at all): fail closed.
  if ((narrow || requireRecipients) && !allowed.length) {
    throw reviewerError(403, "This audience has no allow-listed WhatsApp test phone.", "META_REVIEWER_AUDIENCE_EMPTY");
  }
  return allowed.map((row) => Number(row.id)).filter((id) => Number.isFinite(id) && id > 0);
};

const requireTemplateMode = (mode) => {
  if (text(mode) !== "template") {
    throw reviewerError(403, "Review campaigns must use an approved template on the WhatsApp test number.", "META_REVIEWER_TEMPLATE_ONLY");
  }
};

const requireTestSender = async (ctx) => {
  const credentials = await ctx.deps.sendCredentials({ tenantId: ctx.scope.tenantId }).catch(() => null);
  if (!credentials || !ctx.wa.phoneNumberIds.includes(text(credentials.phoneNumberId))) {
    throw reviewerError(403, "Campaigns can only leave from the WhatsApp test number.", "META_REVIEWER_SENDER_FORBIDDEN");
  }
};

const guardCampaignWrite = async (req, ctx, current = null) => {
  const body = bodyOf(req);
  requireTemplateMode(body.channel_mode ?? current?.channel_mode);
  const audience = { ...(body.audience ?? current?.audience ?? {}) };
  delete audience.restrict_customer_ids;
  const groupName = text(body.group_name ?? current?.group_name);
  if (groupName) audience.tags = [...new Set([...asArray(audience.tags), groupName])];
  const ids = await assertReviewerAudience(ctx, { audience, frequencyCapDays: body.frequency_cap_days ?? current?.frequency_cap_days, narrow: true });
  body.audience = { ...audience, restrict_customer_ids: ids.length ? ids : [0] };
};

/* ------------------------------------------------------------------ usage */

export const scopeUsageBody = (body = {}, ctx) => {
  const months = asArray(body.months).filter((row) => ctx.wa.wabaIds.has(text(row.waba_id)));
  const current = months.filter((row) => row.month === body.current_month);
  const spend = current.reduce((sum, row) => sum + (Number(row.cost_usd) || 0), 0);
  return {
    ...body,
    months,
    // Store-wide outbound counts include the Evolution line: not part of the review.
    local_months: [],
    current: {
      ...(body.current || {}),
      messages: current.reduce((sum, row) => sum + (Number(row.total_messages) || 0), 0),
      cost_usd: Math.round(spend * 100) / 100,
      local_outbound: 0,
      has_meta_data: current.length > 0,
    },
    connection: body.connection && ctx.wa.wabaIds.has(text(body.connection.waba_id)) ? body.connection : { connected: false, waba_id: "", source: "", error: "", code: "" },
  };
};

/* ------------------------------------------------------------------ the table */

const wa = (entry) => ({ ...entry, whatsapp: true });
const deny = (method, path, message, code = "META_REVIEWER_ACTION_BLOCKED") => ({ method, path, deny: message, code });

const ADS_RECORD = "(campaigns|adsets|ads|creatives)";
const ADS_SAFE_ACTIONS = "(create_adset|create_ad|create_creative|sync_campaigns|sync_insights|sync_page_insights|sync_info|sync_adsets|sync_ads|sync_leads)";

export const META_REVIEWER_ROUTE_POLICY = [
  /* ---- WhatsApp: accounts / connect (read + the test number's own settings) ---- */
  wa({ method: "GET", path: /^\/api\/whatsapp\/embedded-signup\/accounts$/, grants: VIEW, transform: scopeWhatsappNumbersBody }),
  wa({ method: "GET", path: /^\/api\/whatsapp\/embedded-signup\/(status|config)$/, grants: VIEW, transform: scopeWhatsappNumbersBody }),
  wa({ method: "GET", path: /^\/api\/whatsapp\/embedded-signup\/live-status$/, grants: VIEW, guard: async (req, ctx) => requireIntegration(ctx, queryOf(req).id) }),
  deny("ANY", /^\/api\/whatsapp\/embedded-signup\/(state|callback|subscribe|disconnect)$/, META_REVIEWER_CONNECT_MESSAGE),
  wa({ method: "GET", path: /^\/api\/whatsapp-official\/accounts\/([^/]+)\/settings$/, grants: VIEW, guard: async (req, ctx, match) => requireIntegration(ctx, decodeURIComponent(match[1])) }),
  wa({ method: "PUT", path: /^\/api\/whatsapp-official\/accounts\/([^/]+)\/settings$/, grants: EDIT, guard: async (req, ctx, match) => requireIntegration(ctx, decodeURIComponent(match[1])) }),
  wa({ method: "POST", path: /^\/api\/whatsapp-official\/accounts\/([^/]+)\/(sync-status|sync-participants)$/, grants: EDIT, guard: async (req, ctx, match) => requireIntegration(ctx, decodeURIComponent(match[1])) }),
  deny("ANY", /^\/api\/whatsapp-official\/accounts\/[^/]+\/(display-name|register|stickers)(\/.*)?$/, META_REVIEWER_CONNECT_MESSAGE),
  wa({ method: "GET", path: /^\/api\/whatsapp-official\/connect\/overview$/, grants: VIEW, transform: scopeWhatsappNumbersBody }),
  wa({ method: "POST", path: /^\/api\/whatsapp-official\/connect\/refresh$/, grants: VIEW, guard: async (req, ctx) => requireIntegration(ctx, bodyOf(req).id ?? queryOf(req).id), transform: scopeWhatsappNumbersBody }),
  deny("ANY", /^\/api\/whatsapp-official\/connect\/(complete|register)$/, META_REVIEWER_CONNECT_MESSAGE),

  /* ---- WhatsApp: templates (create, edit, submit for the test number's WABA) ---- */
  wa({ method: "GET", path: /^\/api\/whatsapp\/templates$/, grants: VIEW, transform: (body, ctx) => ({ ...body, templates: asArray(body.templates).filter((row) => reviewerTemplateVisible(row, ctx.wa)) }) }),
  wa({ method: "POST", path: /^\/api\/whatsapp\/templates$/, grants: EDIT }),
  wa({ method: "POST", path: /^\/api\/whatsapp\/templates\/sync$/, grants: EDIT, guard: async (req, ctx) => requireTestWaba(ctx), transform: (body, ctx) => ({ ...body, templates: asArray(body.templates).filter((row) => reviewerTemplateVisible(row, ctx.wa)) }) }),
  wa({ method: "POST", path: /^\/api\/whatsapp\/templates\/header-sample$/, grants: EDIT, guard: async (req, ctx) => requireTestWaba(ctx) }),
  wa({ method: "GET", path: /^\/api\/whatsapp\/templates\/(\d+)$/, grants: VIEW, guard: async (req, ctx, match) => requireTemplateRow(ctx, match[1]) }),
  wa({ method: "PATCH", path: /^\/api\/whatsapp\/templates\/(\d+)$/, grants: EDIT, guard: async (req, ctx, match) => requireTemplateRow(ctx, match[1]) }),
  wa({ method: "POST", path: /^\/api\/whatsapp\/templates\/(\d+)\/submit$/, grants: EDIT, guard: async (req, ctx, match) => { await requireTemplateRow(ctx, match[1]); await requireTestWaba(ctx); } }),
  wa({ method: "DELETE", path: /^\/api\/whatsapp\/templates\/(\d+)$/, grants: EDIT, guard: async (req, ctx, match) => { const row = await requireTemplateRow(ctx, match[1]); if (text(row.meta_template_id)) await requireTestWaba(ctx); } }),

  /* ---- WhatsApp: template analytics (always narrowed to the test number) ---- */
  wa({ method: "GET", path: /^\/api\/whatsapp-official\/analytics\/(templates|export)$/, grants: VIEW, guard: async (req, ctx) => setRequestQueryParam(req, "account", ctx.wa.phoneNumberIds[0]), transform: scopeWhatsappNumbersBody }),
  wa({ method: "GET", path: /^\/api\/whatsapp-official\/analytics\/templates\/([^/]+)$/, grants: VIEW, guard: async (req, ctx, match) => requireTemplateRow(ctx, decodeURIComponent(match[1]), { byMetaId: true }) }),
  wa({ method: "POST", path: /^\/api\/whatsapp-official\/analytics\/(sync|enable)$/, grants: EDIT, guard: async (req, ctx) => {
    const body = bodyOf(req);
    if (text(body.template_id)) await requireTemplateRow(ctx, body.template_id, { byMetaId: true });
    body.account = ctx.wa.phoneNumberIds[0];
  }, transform: scopeWhatsappNumbersBody }),

  /* ---- WhatsApp: usage & cost ---- */
  wa({ method: "GET", path: /^\/api\/whatsapp\/usage$/, grants: VIEW, transform: scopeUsageBody }),
  wa({ method: "POST", path: /^\/api\/whatsapp\/usage\/sync$/, grants: EDIT, guard: async (req, ctx) => requireTestWaba(ctx), transform: scopeUsageBody }),
  deny("ANY", /^\/api\/whatsapp\/usage\/alerts$/, "The store's WhatsApp budget alert cannot be changed by the review account."),

  /* ---- WhatsApp: chatbot flows (only flows bound to the test number) ---- */
  wa({ method: "GET", path: /^\/api\/whatsapp-official\/flows$/, grants: VIEW, transform: (body, ctx) => ({ ...body, flows: asArray(body.flows).filter((flow) => reviewerFlowVisible(flow, ctx.wa)) }) }),
  wa({ method: "POST", path: /^\/api\/whatsapp-official\/flows$/, grants: EDIT, guard: async (req, ctx) => forceFlowNumbers(req, ctx, { required: true }) }),
  wa({ method: "GET", path: /^\/api\/whatsapp-official\/flows\/meta$/, grants: VIEW, transform: scopeWhatsappNumbersBody }),
  wa({ method: "POST", path: /^\/api\/whatsapp-official\/flows\/upload$/, grants: EDIT }),
  wa({ method: "GET", path: /^\/api\/whatsapp-official\/flows\/(\d+)$/, grants: VIEW, guard: async (req, ctx, match) => requireFlow(ctx, match[1]) }),
  wa({ method: "PUT", path: /^\/api\/whatsapp-official\/flows\/(\d+)$/, grants: EDIT, guard: async (req, ctx, match) => { await requireFlow(ctx, match[1]); forceFlowNumbers(req, ctx); } }),
  wa({ method: "DELETE", path: /^\/api\/whatsapp-official\/flows\/(\d+)$/, grants: EDIT, guard: async (req, ctx, match) => requireFlow(ctx, match[1]) }),
  wa({ method: "POST", path: /^\/api\/whatsapp-official\/flows\/(\d+)\/(publish|activate|deactivate)$/, grants: EDIT, guard: async (req, ctx, match) => requireFlow(ctx, match[1]) }),
  wa({ method: "POST", path: /^\/api\/whatsapp-official\/flows\/(\d+)\/test$/, grants: EDIT, guard: async (req, ctx, match) => {
    await requireFlow(ctx, match[1]);
    const body = bodyOf(req);
    if (!phoneAllowedForSending(body.to, ctx)) throw reviewerError(403, "A review flow test can only be sent to an allow-listed WhatsApp test phone.", "META_REVIEWER_PHONE_FORBIDDEN");
    if (text(body.phone_number_id) && !ctx.wa.phoneNumberIds.includes(text(body.phone_number_id))) throw reviewerError(403, META_REVIEWER_OUT_OF_SCOPE_MESSAGE);
    body.phone_number_id = text(body.phone_number_id) || ctx.wa.phoneNumberIds[0];
  } }),
  wa({ method: "GET", path: /^\/api\/whatsapp-official\/flows\/(\d+)\/sessions$/, grants: VIEW, guard: async (req, ctx, match) => requireFlow(ctx, match[1]), transform: (body, ctx) => ({
    ...body,
    sessions: asArray(body.sessions).filter((row) => ctx.wa.phoneNumberIds.includes(text(row.phone_number_id)) && metaReviewerWhatsappPhoneAllowed(row.customer_phone, ctx.scope)),
  }) }),

  /* ---- WhatsApp: campaigns (template only, test phones only, test number only) ---- */
  wa({ method: "GET", path: /^\/api\/marketing\/broadcasts\/status$/, grants: VIEW }),
  wa({ method: "GET", path: /^\/api\/marketing\/broadcasts\/templates\/approved$/, grants: VIEW }),
  wa({ method: "GET", path: /^\/api\/marketing\/broadcasts$/, grants: VIEW, transform: (body) => ({ ...body, broadcasts: asArray(body.broadcasts).filter(reviewerBroadcastVisible) }) }),
  wa({ method: "POST", path: /^\/api\/marketing\/broadcasts\/audience\/preview$/, grants: VIEW, guard: async (req, ctx) => {
    // The preview names customers: narrow it to the test phones instead of refusing, so the
    // reviewer still sees the audience step working.
    const body = bodyOf(req);
    const audience = { ...(body.audience || {}) };
    delete audience.restrict_customer_ids;
    const rows = asArray(await ctx.deps.resolveAudience({ tenantId: ctx.scope.tenantId, audience, frequencyCapDays: body.frequency_cap_days, applyFrequencyCap: false }));
    const ids = rows.filter((row) => phoneAllowedForSending(row.phone, ctx)).map((row) => Number(row.id)).filter((id) => id > 0);
    body.audience = { ...audience, restrict_customer_ids: ids.length ? ids : [0] };
  } }),
  wa({ method: "POST", path: /^\/api\/marketing\/broadcasts$/, grants: EDIT, guard: async (req, ctx) => guardCampaignWrite(req, ctx) }),
  wa({ method: "PUT", path: /^\/api\/marketing\/broadcasts\/(\d+)$/, grants: EDIT, guard: async (req, ctx, match) => guardCampaignWrite(req, ctx, await requireBroadcast(ctx, match[1])) }),
  wa({ method: "GET", path: /^\/api\/marketing\/broadcasts\/(\d+)\/recipients$/, grants: VIEW, guard: async (req, ctx, match) => requireBroadcast(ctx, match[1]), transform: (body, ctx) => ({
    ...body,
    recipients: asArray(body.recipients).filter((row) => phoneAllowedForSending(row.phone, ctx)),
  }) }),
  wa({ method: "POST", path: /^\/api\/marketing\/broadcasts\/(\d+)\/send$/, grants: EDIT, guard: async (req, ctx, match) => {
    const row = await requireBroadcast(ctx, match[1]);
    requireTemplateMode(row.channel_mode);
    await assertReviewerAudience(ctx, { audience: row.audience || {}, frequencyCapDays: row.frequency_cap_days, requireRecipients: true });
    await requireTestSender(ctx);
  } }),
  wa({ method: "POST", path: /^\/api\/marketing\/broadcasts\/(\d+)\/(stop|cancel-schedule)$/, grants: EDIT, guard: async (req, ctx, match) => requireBroadcast(ctx, match[1]) }),
  deny("ANY", /^\/api\/marketing\/broadcasts\/(\d+)\/schedule$/, "Scheduling is disabled for the review account: the audience and the sending number are checked when the campaign is sent, so use Send now."),
  deny("ANY", /^\/api\/marketing\/broadcasts\/consent\/.*$/, "Customer marketing consent cannot be changed by the review account."),

  /* ---- Meta Ads ---- */
  deny("ANY", /^\/api\/meta-ads\/integrations\/(oauth\/.*|accounts\/[^/]+\/disconnect)$/, "Connecting or disconnecting ad accounts is disabled for the review account."),
  deny("ANY", /^\/api\/meta-ads\/manager\/(status|rules\/(save|delete|toggle|run-now))$/, META_REVIEWER_LIVE_ACTION_MESSAGE, "META_REVIEWER_LIVE_ACTION_BLOCKED"),
  deny("PUT", /^\/api\/meta-ads\/records\/[^/]+\/[^/]+\/ai-instructions$/, "The ads AI instructions cannot be changed by the review account."),
  { method: "GET", path: /^\/api\/meta-ads\/.+$/, grants: ADS_VIEW },
  { method: "POST", path: /^\/api\/meta-ads\/manager\/(duplicate|insights\/sync|sync)$/, grants: ADS_MANAGE },
  { method: "POST", path: /^\/api\/meta-ads\/manager\/wizard\/(drafts\/(campaign|adset|ad|delete)|validate|preview|estimate\/reach|media\/upload|saved-audiences\/(save|delete)|publish)$/, grants: ADS_MANAGE },
  { method: "POST", path: new RegExp(`^/api/meta-ads/records/${ADS_RECORD}$`), grants: ADS_MANAGE },
  { method: "PUT", path: new RegExp(`^/api/meta-ads/records/${ADS_RECORD}/(\\d+)$`), grants: ADS_MANAGE },
  { method: "DELETE", path: new RegExp(`^/api/meta-ads/records/${ADS_RECORD}/(\\d+)$`), grants: ADS_MANAGE },
  { method: "POST", path: new RegExp(`^/api/meta-ads/records/${ADS_RECORD}/(\\d+)/duplicate$`), grants: ADS_MANAGE },
  { method: "POST", path: new RegExp(`^/api/meta-ads/records/[a-z-]+/(\\d+)/actions/${ADS_SAFE_ACTIONS}$`), grants: ADS_MANAGE },
  deny("POST", /^\/api\/meta-ads\/records\/[a-z-]+\/\d+\/actions\/[a-z_]+$/, META_REVIEWER_LIVE_ACTION_MESSAGE, "META_REVIEWER_LIVE_ACTION_BLOCKED"),
];

export const matchMetaReviewerRoute = (method = "GET", path = "") => {
  const verb = text(method).toUpperCase() || "GET";
  for (const entry of META_REVIEWER_ROUTE_POLICY) {
    if (entry.method !== "ANY" && entry.method !== verb) continue;
    const match = entry.path.exec(path);
    if (match) return { entry, match };
  }
  return null;
};

/*
 * Runs the policy for one reviewer request. Resolves to { grants } when the request may continue;
 * throws a status-carrying error when it must not. Wraps res.json when the entry narrows the
 * response.
 */
export const applyMetaReviewerRoutePolicy = async (req, res, { scope = loadMetaReviewerScope(), deps = defaultMetaReviewerPolicyDeps, tenantId = null } = {}) => {
  const path = String(req.originalUrl || req.url || "").split("?")[0];
  const found = matchMetaReviewerRoute(req.method, path);
  if (!found) return null;
  const { entry, match } = found;
  if (entry.deny) throw reviewerError(403, entry.deny, entry.code);
  if (!scope?.enabled || !scope.tenantId || Number(tenantId) !== Number(scope.tenantId)) {
    throw reviewerError(403, "This account is limited to the Meta review scope.");
  }
  const ctx = { scope, deps };
  if (entry.whatsapp) ctx.wa = await loadReviewerWhatsappContext(scope, deps);
  if (entry.guard) await entry.guard(req, ctx, match);
  if (entry.transform) {
    const original = res.json.bind(res);
    res.json = (body) => {
      if (res.statusCode >= 400 || !body || typeof body !== "object") return original(body);
      let narrowed;
      try {
        narrowed = entry.transform(body, ctx);
      } catch {
        res.status(500);
        return original({ success: false, message: "The response could not be narrowed to the review scope." });
      }
      return original(narrowed);
    };
  }
  return { grants: new Set(entry.grants || []) };
};
