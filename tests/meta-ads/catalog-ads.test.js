import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { catalogCreativeParams, catalogsFromProductSets, templateCreative } from "../../server/modules/metaAds/metaAdsCatalogAds.js";
import { isCatalogAd, promotedObjectFor, withDefaults } from "../../src/modules/metaAds/manager/wizard/wizardModel.js";
import { validateAd } from "../../src/modules/metaAds/manager/wizard/wizardValidation.js";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

// The shop's own catalog ad as Graph returned its creative (2026-10-22).
const synced = {
  id: "1355982296408387",
  name: "{{product.name}} 2026-10-18-5a293e7a5bd1b6d88969d1cb2b705eb7",
  object_type: "POST_DELETED",
  product_set_id: "7788",
  object_story_spec: {
    page_id: "100",
    instagram_user_id: "200",
    template_data: { link: "https://m1store-egy.com/", name: "{{product.name}}", format_option: "carousel_images_multi_items", call_to_action: { type: "SHOP_NOW" }, multi_share_end_card: false },
  },
};

test("a synced catalog creative is read as one, with its link and templates", () => {
  assert.deepEqual(templateCreative(synced), {
    creative_type: "catalog",
    product_set_id: "7788",
    destination_url: "https://m1store-egy.com/",
    headline: "{{product.name}}",
    description: null,
    primary_text: null,
    call_to_action: "SHOP_NOW",
    format_option: "carousel_images_multi_items",
  });
  assert.equal(templateCreative({ object_story_spec: { link_data: { link: "https://x" } } }), null);
  assert.equal(templateCreative(undefined), null);
});

test("a catalog creative row becomes template_data plus product_set_id, never link_data", () => {
  const params = catalogCreativeParams(
    { destination_url: "https://m1store-egy.com/", headline: "", description: "{{product.current_price}}", primary_text: "كوتشيات أصلية", product_set_id: "7788" },
    { pageId: "100", instagramUserId: "200", callToAction: { type: "SHOP_NOW", value: { link: "https://m1store-egy.com/" } } },
  );
  assert.deepEqual(params, {
    object_story_spec: {
      page_id: "100",
      instagram_user_id: "200",
      template_data: {
        link: "https://m1store-egy.com/",
        name: "{{product.name}}",
        format_option: "carousel_images_multi_items",
        multi_share_end_card: false,
        description: "{{product.current_price}}",
        message: "كوتشيات أصلية",
        call_to_action: { type: "SHOP_NOW" },
      },
    },
    product_set_id: "7788",
  });
  assert.throws(() => catalogCreativeParams({ destination_url: "" }, { pageId: "100" }), /website link/);
});

test("the wizard knows a catalog ad from its ad set and promotes the product set", () => {
  const adset = withDefaults("adset", { product_set_id: "7788", conversion_event: "PURCHASE" });
  assert.equal(isCatalogAd(withDefaults("ad", {}), adset), true);
  assert.equal(isCatalogAd(withDefaults("ad", { format: "catalog" }), withDefaults("adset", {})), true);
  assert.equal(isCatalogAd(withDefaults("ad", {}), withDefaults("adset", {})), false);
  assert.deepEqual(
    promotedObjectFor({ objective: "OUTCOME_SALES", adsetSpec: adset, account: { pixel_id: "99" }, catalog: {} }),
    { product_set_id: "7788", pixel_id: "99", custom_event_type: "PURCHASE" },
  );
  assert.deepEqual(promotedObjectFor({ objective: "OUTCOME_SALES", adsetSpec: adset, account: {}, catalog: {} }), { product_set_id: "7788" });
});

test("validation asks for the set and the catalogue instead of media", () => {
  const catalog = { conversion_locations: {}, optimization_goals: [] };
  const account = { page_id: "100" };
  const node = { key: "ad-1", spec: { name: "A", primary_text: "hi", link: "https://m1store-egy.com/" } };
  const keys = (issues) => issues.map((issue) => issue.key).sort();
  assert.deepEqual(
    keys(validateAd(node, { campaignSpec: { objective: "OUTCOME_SALES" }, adsetSpec: { product_set_id: "7788" }, account, catalog })),
    ["catalogRequired"],
  );
  assert.deepEqual(
    keys(validateAd(node, { campaignSpec: { objective: "OUTCOME_SALES", product_catalog_id: "55" }, adsetSpec: { product_set_id: "7788" }, account, catalog })),
    [],
  );
  assert.ok(keys(validateAd(node, { campaignSpec: { objective: "OUTCOME_SALES" }, adsetSpec: {}, account, catalog })).includes("mediaRequired"));
});

test("one catalogue per product-set group", () => {
  assert.deepEqual(
    catalogsFromProductSets([{ catalog_id: "1", catalog_name: "Shop" }, { catalog_id: "1", catalog_name: "Shop" }, { catalog_id: "2", catalog_name: "" }]),
    [{ id: "1", name: "Shop" }, { id: "2", name: "2" }],
  );
});

// Mutation guards on the plumbing: the sync asks for product_set_id, stores it, the publisher
// routes catalog creatives through the template builder, and the campaign promotes the catalogue.
test("sync, drafts and publisher carry the catalog fields", () => {
  const core = read("../../server/modules/metaAds/metaAdsCore.js");
  assert.match(core, /effective_instagram_media_id,product_set_id\}/);
  assert.match(core, /product_set_id = EXCLUDED\.product_set_id/);
  assert.match(core, /export const syncProductSets/);
  const drafts = read("../../server/modules/metaAds/manager/wizard/wizardDrafts.js");
  assert.match(drafts, /creative_type: catalogAd \? CATALOG_CREATIVE_TYPE/);
  assert.match(drafts, /product_set_id = \$22/);
  const publisher = read("../../server/modules/metaAds/manager/wizard/metaAdsPublisher.js");
  assert.match(publisher, /if \(row\.creative_type === CATALOG_CREATIVE_TYPE\)/);
  assert.match(publisher, /params\.promoted_object = \{ product_catalog_id: catalogId \}/);
  const routes = read("../../server/modules/metaAds/manager/list/list.routes.js");
  assert.match(routes, /\["product_sets", syncProductSets\]/);
  const bootstrap = read("../../server/modules/metaAds/manager/list/managerData.js");
  assert.match(bootstrap, /product_sets: group\(productSets\.rows/);
});

// Opening the shop's own synced catalog ad raised two false issues: "enter the primary text"
// (Meta's cards carry the product's text) and "choose a conversion location" (Meta sends no
// destination_type on a catalog ad set).
test("a synced catalog ad set and its ad open without false issues", () => {
  const catalog = { conversion_locations: {}, optimization_goals: [] };
  const node = { key: "ad-1", spec: { name: "A", primary_text: "", link: "https://m1store-egy.com/" } };
  const issues = validateAd(node, { campaignSpec: { objective: "OUTCOME_SALES", product_catalog_id: "55" }, adsetSpec: { product_set_id: "7788" }, account: { page_id: "100" }, catalog });
  assert.deepEqual(issues.map((issue) => issue.key), []);
  const drafts = read("../../server/modules/metaAds/manager/wizard/wizardDrafts.js");
  assert.match(drafts, /text\(row\.promoted_object\?\.product_set_id\) \? \{ code: "WEBSITE" \}/);
});
