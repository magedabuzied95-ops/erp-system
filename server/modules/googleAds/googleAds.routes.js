import express from 'express';
import crypto from 'node:crypto';
import db from '../../database/db.js';
import { protect } from '../../middleware/authMiddleware.js';
import permit from '../../middleware/permissionMiddleware.js';
import { getTenantId } from '../../utils/requestScope.js';
import { fail, setup, encrypt, decrypt, tokenRequest, googleRequest, search, customerId, micros, campaignUpdate } from './googleAdsApi.js';
import { buildCampaign, buildRetailGroup, numericId, keyword, responsiveAd, bidSettings } from './googleAdsCampaigns.js';

let ready = false;
export async function ensureGoogleAdsSchema(database) {
  await database.query(`CREATE TABLE IF NOT EXISTS google_ads_connections (
    tenant_id BIGINT PRIMARY KEY, refresh_token_encrypted TEXT NOT NULL, connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await database.query(`CREATE TABLE IF NOT EXISTS google_ads_oauth_states (
    state TEXT PRIMARY KEY, tenant_id BIGINT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  ready = true;
}
const router = express.Router();
const view = [protect, permit('google_ads', 'view')];
const manage = [protect, permit('google_ads', 'manage')];
const wrap = fn => async (req, res) => {
  try {
    if (!ready) throw fail('Google Ads is not initialized', 503);
    const tenant = getTenantId(req);
    if (!tenant) throw fail('Tenant context missing');
    res.json({ success: true, ...await fn(req, tenant) });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.status ? error.message : 'Google Ads operation failed', requestId: error.requestId });
  }
};
const context = async tenant => {
  const { rows } = await db.query('SELECT refresh_token_encrypted FROM google_ads_connections WHERE tenant_id=$1', [tenant]);
  if (!rows.length) throw fail('Connect Google Ads first', 409);
  return (await tokenRequest({ grant_type: 'refresh_token', refresh_token: decrypt(rows[0].refresh_token_encrypted) })).access_token;
};
const login = () => process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || '';
router.get('/setup', ...view, wrap(async (_, tenant) => {
  const { rows } = await db.query('SELECT connected_at FROM google_ads_connections WHERE tenant_id=$1', [tenant]);
  return { setup: setup(), connected: !!rows.length, connectedAt: rows[0]?.connected_at };
}));
router.post('/oauth/start', ...manage, wrap(async (_, tenant) => {
  if (!setup().ready) throw fail('Complete Google Ads server configuration first', 503);
  const state = crypto.randomBytes(32).toString('hex');
  await db.query("DELETE FROM google_ads_oauth_states WHERE created_at < NOW() - INTERVAL '10 minutes'");
  await db.query('INSERT INTO google_ads_oauth_states (state,tenant_id) VALUES ($1,$2)', [state, tenant]);
  const params = new URLSearchParams({ client_id: process.env.GOOGLE_ADS_CLIENT_ID, redirect_uri: process.env.GOOGLE_ADS_REDIRECT_URI,
    response_type: 'code', access_type: 'offline', prompt: 'consent', scope: 'https://www.googleapis.com/auth/adwords', state });
  return { url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` };
}));
router.get('/oauth/callback', async (req, res) => {
  const target = process.env.GOOGLE_ADS_FRONTEND_URL;
  if (!target || !ready) return res.status(503).send('Google Ads is not configured');
  try {
    const { rows } = await db.query("DELETE FROM google_ads_oauth_states WHERE state=$1 AND created_at > NOW() - INTERVAL '10 minutes' RETURNING tenant_id", [String(req.query.state || '')]);
    if (!rows.length || !req.query.code || req.query.error) throw fail('Authorization expired');
    const token = await tokenRequest({ grant_type: 'authorization_code', code: String(req.query.code), redirect_uri: process.env.GOOGLE_ADS_REDIRECT_URI });
    if (!token.refresh_token) throw fail('Missing offline authorization');
    await db.query(`INSERT INTO google_ads_connections (tenant_id,refresh_token_encrypted) VALUES ($1,$2)
      ON CONFLICT (tenant_id) DO UPDATE SET refresh_token_encrypted=EXCLUDED.refresh_token_encrypted,connected_at=NOW()`, [rows[0].tenant_id, encrypt(token.refresh_token)]);
    res.redirect(`${target}?google_ads=connected`);
  } catch { res.redirect(`${target}?google_ads=error`); }
});
router.post('/disconnect', ...manage, wrap(async (_, tenant) => {
  await db.query('DELETE FROM google_ads_oauth_states WHERE tenant_id=$1', [tenant]);
  await db.query('DELETE FROM google_ads_connections WHERE tenant_id=$1', [tenant]);
  return {};
}));
const discoverAccounts = async token => {
  const accessible = await googleRequest(token, 'customers:listAccessibleCustomers');
  const accounts = new Map();
  for (const resource of accessible.resourceNames || []) {
    const id = resource.split('/')[1];
    const rows = await search(token, id, 'SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone, customer.manager FROM customer LIMIT 1', login());
    const customer = rows[0]?.customer;
    if (!customer) continue;
    accounts.set(String(customer.id), { ...customer, loginCustomerId: login() });
    if (customer.manager) {
      const children = await search(token, id, "SELECT customer_client.id, customer_client.descriptive_name, customer_client.currency_code, customer_client.time_zone, customer_client.manager FROM customer_client WHERE customer_client.status = 'ENABLED'", login() || id);
      for (const row of children) {
        const child = row.customerClient;
        if (child && !child.manager && !accounts.has(String(child.id))) accounts.set(String(child.id), { ...child, loginCustomerId: login() || id });
      }
    }
  }
  return [...accounts.values()];
};
router.get('/accounts', ...view, wrap(async (_, tenant) => {
  return { accounts: await discoverAccounts(await context(tenant)) };
}));
// Every account ID is verified against this tenant's current Google authorization.
const accountContext = async (tenant, value) => {
  const id = customerId(value); const token = await context(tenant);
  const account = (await discoverAccounts(token)).find(a => String(a.id) === id);
  if (!account) throw fail('Account not available to this connection', 403);
  return { id, token, loginId: account.loginCustomerId };
};
router.get('/accounts/:id/data', ...view, wrap(async (req, tenant) => {
  const { id, token, loginId } = await accountContext(tenant, req.params.id);
  const days = Number(req.query.days || 30);
  if (![7, 30].includes(days)) throw fail('Invalid reporting period');
  const levels = {
    campaigns: ['campaign', 'campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, campaign_budget.resource_name, campaign_budget.amount_micros, campaign_budget.explicitly_shared'],
    groups: ['ad_group', 'campaign.id, ad_group.id, ad_group.name, ad_group.status'],
    ads: ['ad_group_ad', 'campaign.id, ad_group.id, ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group_ad.status'],
    keywords: ['keyword_view', 'campaign.id, ad_group.id, ad_group_criterion.criterion_id, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, ad_group_criterion.status'],
    assets: ['asset_group', 'campaign.id, asset_group.id, asset_group.name, asset_group.status'],
    products: ['shopping_performance_view', 'campaign.id, segments.product_item_id, segments.product_title, segments.product_brand'],
    terms: ['search_term_view', 'campaign.id, ad_group.id, search_term_view.search_term, search_term_view.status'],
  };
  const level = levels[req.query.level || 'campaigns'];
  if (!level) throw fail('Invalid report level');
  const statusField = req.query.level === 'keywords' ? 'ad_group_criterion' : ['products', 'terms'].includes(req.query.level) ? null : level[0];
  const campaignFilter = req.query.campaign ? ` AND campaign.id = ${numericId(req.query.campaign)}` : '';
  const rows = await search(token, id, `SELECT ${level[1]}, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value FROM ${level[0]} WHERE segments.date DURING LAST_${days}_DAYS${statusField ? ` AND ${statusField}.status != 'REMOVED'` : ''}${campaignFilter}`, loginId);
  return { rows };
}));
router.post('/accounts/:id/campaigns/:campaign', ...manage, wrap(async (req, tenant) => {
  const { id, token, loginId } = await accountContext(tenant, req.params.id);
  const operation = campaignUpdate(id, req.params.campaign, req.body || {});
  await googleRequest(token, `customers/${id}/campaigns:mutate`, { operations: [operation] }, loginId);
  return {};
}));
router.post('/accounts/:id/campaigns/:campaign/budget', ...manage, wrap(async (req, tenant) => {
  const { id, token, loginId } = await accountContext(tenant, req.params.id);
  const campaign = String(req.params.campaign);
  if (!/^\d+$/.test(campaign)) throw fail('Invalid campaign');
  const rows = await search(token, id, `SELECT campaign_budget.resource_name, campaign_budget.explicitly_shared FROM campaign WHERE campaign.id = ${campaign}`, loginId);
  const budget = rows[0]?.campaignBudget;
  if (!budget) throw fail('Campaign not found', 404);
  if (budget.explicitlyShared) throw fail('Shared budget affects multiple campaigns. Edit it in Google Ads.', 409);
  await googleRequest(token, `customers/${id}/campaignBudgets:mutate`, { operations: [{ update: { resourceName: budget.resourceName, amountMicros: micros(req.body.amount) }, updateMask: 'amount_micros' }] }, loginId);
  return {};
}));
router.post('/accounts/:id/campaigns', ...manage, wrap(async (req, tenant) => {
  const { id, token, loginId } = await accountContext(tenant, req.params.id);
  const operations = buildCampaign(id, req.body || {}, crypto.randomUUID());
  const validateOnly = req.body.validateOnly === true;
  const result = await googleRequest(token, `customers/${id}/googleAds:mutate`, { mutateOperations: operations, validateOnly }, loginId);
  return { validated: validateOnly, results: result.mutateOperationResponses || [] };
}));

router.get('/accounts/:id/structure', ...view, wrap(async (req, tenant) => {
  const { id, token, loginId } = await accountContext(tenant, req.params.id);
  const queries = [
    "SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, campaign.bidding_strategy_type, campaign.shopping_setting.merchant_id, campaign.shopping_setting.feed_label FROM campaign WHERE campaign.status != 'REMOVED'",
    "SELECT campaign.id, ad_group.id, ad_group.name, ad_group.status FROM ad_group WHERE ad_group.status != 'REMOVED'",
    "SELECT campaign.id, ad_group.id, ad_group_criterion.criterion_id, ad_group_criterion.status, ad_group_criterion.negative, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type FROM ad_group_criterion WHERE ad_group_criterion.type = 'KEYWORD' AND ad_group_criterion.status != 'REMOVED'",
    "SELECT campaign.id, ad_group.id, ad_group_ad.ad.id, ad_group_ad.status, ad_group_ad.ad.final_urls, ad_group_ad.ad.responsive_search_ad.headlines, ad_group_ad.ad.responsive_search_ad.descriptions FROM ad_group_ad WHERE ad_group_ad.status != 'REMOVED'",
    "SELECT campaign.id, asset_group.id, asset_group.name, asset_group.status FROM asset_group WHERE asset_group.status != 'REMOVED'",
  ];
  const results = await Promise.allSettled(queries.map(query => search(token, id, query, loginId)));
  for (const result of results) if (result.status === 'rejected') throw result.reason;
  const [campaigns, groups, keywords, ads, assets] = results.map(r => r.value);
  return { campaigns: campaigns.map(r => r.campaign), groups: groups.map(r => ({ ...r.adGroup, campaignId: r.campaign.id })),
    keywords, ads, assets };
}));
router.get('/accounts/:id/conversions', ...view, wrap(async (req, tenant) => {
  const { id, token, loginId } = await accountContext(tenant, req.params.id);
  const rows = await search(token, id, "SELECT conversion_action.id, conversion_action.name, conversion_action.status, conversion_action.type, conversion_action.category, conversion_action.primary_for_goal FROM conversion_action WHERE conversion_action.status != 'REMOVED'", loginId);
  return { rows };
}));
router.get('/accounts/:id/locations', ...view, wrap(async (req, tenant) => {
  const { id, token, loginId } = await accountContext(tenant, req.params.id);
  const query = String(req.query.q || '').trim();
  if (!query || query.length > 80) throw fail('Enter a location name');
  // Use Google suggestion service parameters, not interpolated GAQL strings.
  const result = await googleRequest(token, 'geoTargetConstants:suggest', { locale: 'en', locationNames: { names: [query] } }, loginId);
  return { locations: (result.geoTargetConstantSuggestions || []).map(r => r.geoTargetConstant), customerId: id };
}));
router.get('/accounts/:id/campaigns/:campaign/targeting', ...view, wrap(async (req, tenant) => {
  const { id, token, loginId } = await accountContext(tenant, req.params.id);
  const campaign = numericId(req.params.campaign);
  const rows = await search(token, id, `SELECT campaign_criterion.criterion_id, campaign_criterion.type, campaign_criterion.negative, campaign_criterion.location.geo_target_constant, campaign_criterion.language.language_constant, campaign_criterion.keyword.text, campaign_criterion.keyword.match_type FROM campaign_criterion WHERE campaign.id = ${campaign} AND campaign_criterion.status != 'REMOVED'`, loginId);
  return { rows };
}));
router.post('/accounts/:id/campaigns/:campaign/targeting', ...manage, wrap(async (req, tenant) => {
  const { id, token, loginId } = await accountContext(tenant, req.params.id);
  const campaign = `customers/${id}/campaigns/${numericId(req.params.campaign)}`;
  const body = req.body || {};
  let operation;
  if (body.remove) operation = { remove: `customers/${id}/campaignCriteria/${numericId(req.params.campaign)}~${numericId(body.remove)}` };
  else {
    const create = { campaign, negative: body.negative === true };
    if (body.kind === 'location') create.location = { geoTargetConstant: `geoTargetConstants/${numericId(body.value)}` };
    else if (body.kind === 'language') create.language = { languageConstant: `languageConstants/${numericId(body.value)}` };
    else if (body.kind === 'keyword' && body.negative === true) create.keyword = keyword(body);
    else throw fail('Unsupported targeting type');
    operation = { create };
  }
  await googleRequest(token, `customers/${id}/campaignCriteria:mutate`, { operations: [operation] }, loginId);
  return {};
}));
router.post('/accounts/:id/campaigns/:campaign/bidding', ...manage, wrap(async (req, tenant) => {
  const { id, token, loginId } = await accountContext(tenant, req.params.id);
  const campaignId = numericId(req.params.campaign);
  const rows = await search(token, id, `SELECT campaign.advertising_channel_type FROM campaign WHERE campaign.id = ${campaignId}`, loginId);
  if (!rows[0]) throw fail('Campaign not found', 404);
  const settings = bidSettings(rows[0].campaign.advertisingChannelType, req.body || {});
  const masks = { manualCpc: 'manual_cpc', maximizeConversions: 'maximize_conversions', maximizeConversionValue: 'maximize_conversion_value' };
  await googleRequest(token, `customers/${id}/campaigns:mutate`, { operations: [{ update: { resourceName: `customers/${id}/campaigns/${campaignId}`, ...settings }, updateMask: Object.keys(settings).map(k => masks[k]).join(',') }] }, loginId);
  return {};
}));
router.post('/accounts/:id/groups', ...manage, wrap(async (req, tenant) => {
  const { id, token, loginId } = await accountContext(tenant, req.params.id);
  const name = String(req.body.name || '').trim();
  if (!name || name.length > 128) throw fail('Invalid group name');
  await googleRequest(token, `customers/${id}/adGroups:mutate`, { operations: [{ create: { name, campaign: `customers/${id}/campaigns/${numericId(req.body.campaign)}`, status: 'PAUSED', type: 'SEARCH_STANDARD', cpcBidMicros: micros(req.body.cpc) } }] }, loginId);
  return {};
}));
router.post('/accounts/:id/campaigns/:campaign/asset-groups', ...manage, wrap(async (req, tenant) => {
  const { id, token, loginId } = await accountContext(tenant, req.params.id);
  const campaign = `customers/${id}/campaigns/${numericId(req.params.campaign)}`;
  const mutateOperations = buildRetailGroup(id, campaign, req.body || {});
  await googleRequest(token, `customers/${id}/googleAds:mutate`, { mutateOperations, validateOnly: req.body.validateOnly === true }, loginId);
  return {};
}));
router.post('/accounts/:id/groups/:group/keywords', ...manage, wrap(async (req, tenant) => {
  const { id, token, loginId } = await accountContext(tenant, req.params.id);
  const group = numericId(req.params.group);
  if (!Array.isArray(req.body.keywords) || !req.body.keywords.length || req.body.keywords.length > 100) throw fail('Supply 1–100 keywords');
  await googleRequest(token, `customers/${id}/adGroupCriteria:mutate`, { operations: req.body.keywords.map(item => ({ create: { adGroup: `customers/${id}/adGroups/${group}`, status: 'ENABLED', negative: item.negative === true, keyword: keyword(item) } })) }, loginId);
  return {};
}));
router.post('/accounts/:id/groups/:group/ads', ...manage, wrap(async (req, tenant) => {
  const { id, token, loginId } = await accountContext(tenant, req.params.id);
  await googleRequest(token, `customers/${id}/adGroupAds:mutate`, { operations: [{ create: { adGroup: `customers/${id}/adGroups/${numericId(req.params.group)}`, status: 'PAUSED', ad: responsiveAd(req.body) } }] }, loginId);
  return {};
}));
router.post('/accounts/:id/entities/status', ...manage, wrap(async (req, tenant) => {
  const { id, token, loginId } = await accountContext(tenant, req.params.id);
  const body = req.body || {};
  if (!['ENABLED', 'PAUSED'].includes(body.status)) throw fail('Invalid status');
  const definitions = {
    group: ['adGroups', numericId], asset: ['assetGroups', numericId],
    ad: ['adGroupAds', value => `${numericId(body.group)}~${numericId(value)}`],
    keyword: ['adGroupCriteria', value => `${numericId(body.group)}~${numericId(value)}`],
  };
  const definition = definitions[body.kind];
  if (!definition) throw fail('Invalid entity type');
  await googleRequest(token, `customers/${id}/${definition[0]}:mutate`, { operations: [{ update: { resourceName: `customers/${id}/${definition[0]}/${definition[1](body.id)}`, status: body.status }, updateMask: 'status' }] }, loginId);
  return {};
}));
export default router;
