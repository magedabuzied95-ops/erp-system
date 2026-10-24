import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCampaign, buildRetailGroup, bidSettings, responsiveAd, keyword, targetingOperations } from '../server/modules/googleAds/googleAdsCampaigns.js';

const searchDraft = () => ({ type: 'SEARCH', name: 'Shoes search', amount: '100', cpc: '3', finalUrl: 'https://example.com/shoes',
  locations: ['2818'], languages: ['1019', '1000'], keywords: [{ text: 'running shoes', matchType: 'PHRASE' }],
  headlines: ['Running Shoes', 'Browse Our Collection', 'Order Online'], descriptions: ['Discover our latest shoe collection.', 'Choose your size and order online.'] });
const retailDraft = () => ({ type: 'PERFORMANCE_MAX', name: 'Store products', amount: 100, merchantId: '5829421968', feedLabel: 'EG', finalUrl: 'https://example.com/', locations: ['2818'], languages: ['1019'], targetRoas: '350' });
test('Search creation includes dependent resources atomically and leaves campaign paused', () => {
  const ops = buildCampaign('1234567890', searchDraft(), 'unique');
  const campaign = ops.find(o => o.campaignOperation).campaignOperation.create;
  assert.equal(campaign.status, 'PAUSED');
  assert.equal(campaign.advertisingChannelType, 'SEARCH');
  const group = ops.find(o => o.adGroupOperation).adGroupOperation.create;
  assert.equal(group.campaign, campaign.resourceName);
  assert.equal(ops.find(o => o.adGroupAdOperation).adGroupAdOperation.create.adGroup, group.resourceName);
  assert.equal(ops.find(o => o.adGroupCriterionOperation).adGroupCriterionOperation.create.adGroup, group.resourceName);
  assert.equal(campaign.geoTargetTypeSetting.positiveGeoTargetType, 'PRESENCE');
  assert.equal(ops[0].campaignBudgetOperation.create.amountMicros, '100000000');
});
test('retail creation has merchant settings and valid all-product filter', () => {
  const ops = buildCampaign('1234567890', retailDraft());
  const campaign = ops.find(o => o.campaignOperation).campaignOperation.create;
  assert.equal(campaign.status, 'PAUSED');
  assert.equal(campaign.shoppingSetting.merchantId, '5829421968');
  assert.equal(campaign.shoppingSetting.feedLabel, 'EG');
  assert.equal(campaign.maximizeConversionValue.targetRoas, 3.5);
  assert.equal(campaign.assetAutomationSettings[0].assetAutomationStatus, 'OPTED_OUT');
  assert.ok(!('urlExpansionOptOut' in campaign));
  const group = ops.find(o => o.assetGroupOperation).assetGroupOperation.create;
  const filters = ops.filter(o => o.assetGroupListingGroupFilterOperation).map(o => o.assetGroupListingGroupFilterOperation.create);
  assert.equal(filters.length, 1);
  assert.equal(filters[0].type, 'UNIT_INCLUDED');
  assert.equal(filters[0].assetGroup, group.resourceName);
  assert.match(filters[0].resourceName, /assetGroupListingGroupFilters\/-3~-4$/);
  assert.ok(!ops.some(o => o.assetGroupAssetOperation));
});
test('brand-only retail tree explicitly excludes all remaining brands', () => {
  const ops = buildCampaign('1234567890', { ...retailDraft(), productBrand: 'Asics' });
  const filters = ops.filter(o => o.assetGroupListingGroupFilterOperation).map(o => o.assetGroupListingGroupFilterOperation.create);
  assert.equal(filters[0].type, 'SUBDIVISION');
  assert.equal(filters[1].caseValue.productBrand.value, 'Asics');
  assert.equal(filters[1].parentListingGroupFilter, filters[0].resourceName);
  assert.equal(filters[2].type, 'UNIT_EXCLUDED');
  assert.deepEqual(filters[2].caseValue.productBrand, {});
});
test('invalid creative, missing targets and mismatched bid strategies fail before API call', () => {
  for (const patch of [{ locations: [] }, { languages: [] }, { cpc: -1 }, { keywords: [] }, { headlines: ['Only one'] }, { finalUrl: 'javascript:alert(1)' }, { endDate: '2026-01-01', startDate: '2026-12-01' }]) {
    assert.throws(() => buildCampaign('1234567890', { ...searchDraft(), ...patch }));
  }
  assert.throws(() => buildCampaign('1234567890', { ...retailDraft(), bidding: 'MANUAL_CPC' }));
  assert.throws(() => bidSettings('PERFORMANCE_MAX', { targetRoas: -1 }));
  assert.throws(() => responsiveAd({ ...searchDraft(), headlines: ['Same', 'Same', 'Other'] }));
});
test('targeting IDs and keyword match types cannot inject GAQL or resource paths', () => {
  assert.throws(() => targetingOperations('customers/1234567890/campaigns/42', { locations: ['2818 OR 1=1'], languages: ['1019'] }));
  assert.throws(() => keyword({ text: 'shoes', matchType: 'INVALID' }));
  assert.equal(keyword({ text: "women's shoes", matchType: 'EXACT' }).text, "women's shoes");
});
test('negative campaign keywords are separate criteria from positive group keywords', () => {
  const ops = buildCampaign('1234567890', { ...searchDraft(), negativeKeywords: [{ text: 'free', matchType: 'PHRASE' }] });
  const negatives = ops.filter(o => o.campaignCriterionOperation?.create.negative);
  assert.equal(negatives.length, 1);
  assert.equal(negatives[0].campaignCriterionOperation.create.keyword.text, 'free');
});
test('campaign dates use current API timestamp fields in account timezone', () => {
  const ops = buildCampaign('1234567890', { ...searchDraft(), startDate: '2026-11-01', endDate: '2026-11-30' });
  const campaign = ops.find(o => o.campaignOperation).campaignOperation.create;
  assert.equal(campaign.startDateTime, '2026-11-01 00:00:00');
  assert.equal(campaign.endDateTime, '2026-11-30 23:59:59');
  assert.ok(!('startDate' in campaign));
  assert.throws(() => buildCampaign('1234567890', { ...searchDraft(), startDate: '2026-02-30' }));
  assert.throws(() => buildCampaign('1234567890', { ...searchDraft(), startDate: '2026-99-99' }));
});
test('additional retail groups stay paused even on a live campaign', () => {
  const ops = buildRetailGroup('1234567890', 'customers/1234567890/campaigns/42', { name: 'Asics', finalUrl: 'https://example.com/', productBrand: 'Asics' });
  assert.equal(ops[0].assetGroupOperation.create.status, 'PAUSED');
  assert.equal(ops[0].assetGroupOperation.create.campaign, 'customers/1234567890/campaigns/42');
  assert.equal(ops.filter(o => o.assetGroupListingGroupFilterOperation).length, 3);
});
