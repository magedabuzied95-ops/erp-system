import { customerId, fail, micros } from './googleAdsApi.js';

export const numericId = value => {
  const id = String(value || '');
  if (!/^\d+$/.test(id) || id.length > 20) throw fail('Invalid resource ID');
  return id;
};
const text = (value, max, field) => {
  const result = String(value || '').trim();
  if (!result || [...result].length > max) throw fail(`Invalid ${field}`);
  return result;
};
const list = (value, min, max, length, field) => {
  if (!Array.isArray(value) || value.length < min || value.length > max) throw fail(`Invalid ${field} count`);
  const result = value.map(v => text(v, length, field));
  if (new Set(result).size !== result.length) throw fail(`Duplicate ${field}`);
  return result;
};
const validDate = value => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};
export const finalUrl = value => {
  let url;
  try { url = new URL(value); } catch { throw fail('Invalid destination URL'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw fail('Invalid destination URL');
  return url.toString();
};
export const keyword = value => {
  if (!['EXACT', 'PHRASE', 'BROAD'].includes(value?.matchType)) throw fail('Invalid keyword match type');
  return { text: text(value.text, 80, 'keyword'), matchType: value.matchType };
};
export const responsiveAd = body => ({
  finalUrls: [finalUrl(body.finalUrl)],
  responsiveSearchAd: {
    headlines: list(body.headlines, 3, 15, 30, 'headlines').map(text => ({ text })),
    descriptions: list(body.descriptions, 2, 4, 90, 'descriptions').map(text => ({ text })),
  },
});
export const bidSettings = (type, body) => {
  const strategy = body.bidding || (type === 'PERFORMANCE_MAX' ? 'MAXIMIZE_CONVERSION_VALUE' : 'MANUAL_CPC');
  if (strategy === 'MANUAL_CPC' && type !== 'PERFORMANCE_MAX') return { manualCpc: {} };
  if (strategy === 'MAXIMIZE_CONVERSIONS') return { maximizeConversions: body.targetCpa ? { targetCpaMicros: micros(body.targetCpa) } : {} };
  if (strategy === 'MAXIMIZE_CONVERSION_VALUE') {
    const value = Number(body.targetRoas);
    if (body.targetRoas && (!Number.isFinite(value) || value <= 0 || value > 10000)) throw fail('Invalid target ROAS');
    return { maximizeConversionValue: value ? { targetRoas: value / 100 } : {} };
  }
  throw fail('Unsupported bidding strategy');
};
export const targetingOperations = (campaign, body) => {
  const operations = [];
  for (const [field, collection, values] of [
    ['location', 'geoTargetConstants', body.locations], ['language', 'languageConstants', body.languages],
  ]) {
    if (!Array.isArray(values) || !values.length || values.length > 50) throw fail(`Select ${field} targets`);
    for (const value of new Set(values)) operations.push({ campaignCriterionOperation: { create: {
      campaign, [field]: { [field === 'location' ? 'geoTargetConstant' : 'languageConstant']: `${collection}/${numericId(value)}` },
    } } });
  }
  return operations;
};

// One request creates a complete paused campaign. Temporary IDs are unique within it.
export const buildCampaign = (customer, body, suffix = Date.now()) => {
  const id = customerId(customer);
  const base = `customers/${id}`;
  const type = body.type || 'SEARCH';
  if (!['SEARCH', 'PERFORMANCE_MAX'].includes(type)) throw fail('Unsupported campaign type');
  const name = text(body.name, 128, 'campaign name');
  const campaignName = `${base}/campaigns/-2`;
  const campaign = {
    resourceName: campaignName, name, status: 'PAUSED', advertisingChannelType: type,
    campaignBudget: `${base}/campaignBudgets/-1`, ...bidSettings(type, body),
    containsEuPoliticalAdvertising: 'DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING',
    geoTargetTypeSetting: { positiveGeoTargetType: 'PRESENCE' },
  };
  if (body.startDate) {
    if (!validDate(body.startDate)) throw fail('Invalid start date');
    campaign.startDateTime = `${body.startDate} 00:00:00`;
  }
  if (body.endDate) {
    if (!validDate(body.endDate) || (body.startDate && body.endDate < body.startDate)) throw fail('Invalid end date');
    campaign.endDateTime = `${body.endDate} 23:59:59`;
  }
  if (type === 'SEARCH') campaign.networkSettings = { targetGoogleSearch: true, targetSearchNetwork: false, targetContentNetwork: false, targetPartnerSearchNetwork: false };
  else {
    campaign.shoppingSetting = { merchantId: numericId(body.merchantId) };
    if (body.feedLabel) campaign.shoppingSetting.feedLabel = text(body.feedLabel, 20, 'feed label');
    campaign.assetAutomationSettings = [{ assetAutomationType: 'FINAL_URL_EXPANSION_TEXT_ASSET_AUTOMATION', assetAutomationStatus: body.expandUrls ? 'OPTED_IN' : 'OPTED_OUT' }];
  }
  const operations = [
    { campaignBudgetOperation: { create: { resourceName: campaign.campaignBudget, name: `${name} ${suffix}`, amountMicros: micros(body.amount), deliveryMethod: 'STANDARD', explicitlyShared: false } } },
    { campaignOperation: { create: campaign } },
    ...targetingOperations(campaignName, body),
  ];
  if (type === 'SEARCH') {
    const group = `${base}/adGroups/-3`;
    operations.push({ adGroupOperation: { create: { resourceName: group, campaign: campaignName, name: text(body.groupName || name, 128, 'group name'), status: 'ENABLED', type: 'SEARCH_STANDARD', cpcBidMicros: micros(body.cpc) } } });
    if (!Array.isArray(body.keywords) || !body.keywords.length || body.keywords.length > 100) throw fail('Supply 1–100 keywords');
    for (const item of body.keywords) operations.push({ adGroupCriterionOperation: { create: { adGroup: group, status: 'ENABLED', keyword: keyword(item) } } });
    operations.push({ adGroupAdOperation: { create: { adGroup: group, status: 'ENABLED', ad: responsiveAd(body) } } });
  } else {
    operations.push(...buildRetailGroup(id, campaignName, body, 'ENABLED'));
  }
  if (body.negativeKeywords) {
    if (!Array.isArray(body.negativeKeywords) || body.negativeKeywords.length > 100) throw fail('Too many negative keywords');
    for (const item of body.negativeKeywords) operations.push({ campaignCriterionOperation: { create: { campaign: campaignName, negative: true, keyword: keyword(item) } } });
  }
  return operations;
};

export const buildRetailGroup = (id, campaignName, body, groupStatus = 'PAUSED') => {
  const base = `customers/${customerId(id)}`;
  const operations = [];
    const group = `${base}/assetGroups/-3`;
    operations.push({ assetGroupOperation: { create: { resourceName: group, campaign: campaignName, name: text(body.groupName || body.name, 128, 'asset group name'), status: groupStatus, finalUrls: [finalUrl(body.finalUrl)] } } });
    // Retail campaigns can generate their assets directly from Merchant Center.
    // A root leaf is required even when all feed products are targeted.
    const root = `${base}/assetGroupListingGroupFilters/-3~-4`;
    const brand = String(body.productBrand || '').trim();
    operations.push({ assetGroupListingGroupFilterOperation: { create: {
      resourceName: root, assetGroup: group, listingSource: 'SHOPPING', type: brand ? 'SUBDIVISION' : 'UNIT_INCLUDED',
    } } });
    if (brand) {
      operations.push({ assetGroupListingGroupFilterOperation: { create: { resourceName: `${base}/assetGroupListingGroupFilters/-3~-5`, assetGroup: group, listingSource: 'SHOPPING', type: 'UNIT_INCLUDED', parentListingGroupFilter: root, caseValue: { productBrand: { value: text(brand, 70, 'product brand') } } } } });
      operations.push({ assetGroupListingGroupFilterOperation: { create: { resourceName: `${base}/assetGroupListingGroupFilters/-3~-6`, assetGroup: group, listingSource: 'SHOPPING', type: 'UNIT_EXCLUDED', parentListingGroupFilter: root, caseValue: { productBrand: {} } } } });
    }
  return operations;
};
