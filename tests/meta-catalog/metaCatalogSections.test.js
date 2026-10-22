import test from "node:test";
import assert from "node:assert/strict";

import {
  META_CATALOG_SECTIONS,
  buildMetaCatalogItem,
  dedupeMetaSizes,
  metaCatalogItemXml,
  metaItemInSection,
  metaWhatsappItems,
} from "../../server/services/metaCatalogFeedService.js";

const baseRow = (overrides = {}) => ({
  product_id: 10,
  variant_id: 20,
  variant_sku: "SKU-20",
  sku_count: 1,
  product_name: "Nike V2K",
  product_type: "sneakers",
  variant_stock: 3,
  product_selling_price: 500,
  color: "White & Pink",
  size: "39",
  ...overrides,
});

const sectionsOf = (item) => META_CATALOG_SECTIONS.filter((section) => metaItemInSection(item, section)).map((s) => s.name);

test("a size row sold to several audiences sits in each of their sections", () => {
  // The storefront splits "men,women,kids" on commas; read whole, it matched nothing and the
  // item shipped with no gender and no section.
  const item = buildMetaCatalogItem(baseRow({ variant_audience: "men,women,kids" }));
  assert.equal(item.gender, "unisex");
  assert.equal(item.age_group, "adult");
  assert.equal(item.custom_label_0, "|men|women|kids|");
  assert.deepEqual(sectionsOf(item), ["كوتشيات رجالي", "كوتشيات حريمي", "كوتشيات أطفال"]);
});

test("the size row's audience outranks the product's, which outranks its gender column", () => {
  assert.equal(buildMetaCatalogItem(baseRow({ variant_audience: "women", product_audiences: "men", product_gender: "men" })).custom_label_0, "|women|");
  assert.equal(buildMetaCatalogItem(baseRow({ product_audiences: "kids,women", product_gender: "men" })).custom_label_0, "|women|kids|");
  assert.equal(buildMetaCatalogItem(baseRow({ product_gender: "men" })).custom_label_0, "|men|");
});

test("men's section never catches women's products", () => {
  const women = buildMetaCatalogItem(baseRow({ variant_audience: "women" }));
  assert.deepEqual(sectionsOf(women), ["كوتشيات حريمي"]);
});

test("product type and section label reach Meta's XML", () => {
  const xml = metaCatalogItemXml(buildMetaCatalogItem(baseRow({ product_type: "bags", variant_audience: "men" })));
  assert.match(xml, /<g:product_type>Bags<\/g:product_type>/);
  assert.match(xml, /<g:custom_label_0>\|men\|<\/g:custom_label_0>/);
});

test("every section filters on fields the feed emits", () => {
  for (const section of META_CATALOG_SECTIONS) {
    assert.deepEqual(section.filter.and.map((clause) => Object.keys(clause)[0]), ["product_type", "custom_label_0"]);
    assert.match(section.filter.and[1].custom_label_0.i_contains, /^\|(men|women|kids)\|$/);
  }
});

test("a colour carrying one size twice keeps the size a customer can buy", () => {
  const out = buildMetaCatalogItem(baseRow({ variant_id: 1, variant_sku: "A-41", size: "41", variant_stock: 0 }));
  const inStock = buildMetaCatalogItem(baseRow({ variant_id: 2, variant_sku: "A-41-2", size: "41", variant_stock: 2 }));
  const other = buildMetaCatalogItem(baseRow({ variant_id: 3, variant_sku: "A-42", size: "42", variant_stock: 0 }));
  const kept = dedupeMetaSizes([out, inStock, other]);
  assert.deepEqual(kept.map((item) => item.id), ["A-41-2", "A-42"]);
});

test("the WhatsApp feed puts every colour of a model in one product", () => {
  const items = [
    buildMetaCatalogItem(baseRow({ variant_id: 1, variant_sku: "W-39", color: "White", size: "39" })),
    buildMetaCatalogItem(baseRow({ variant_id: 2, variant_sku: "B-39", color: "Black", size: "39", variant_stock: 0 })),
  ];
  assert.notEqual(items[0].item_group_id, items[1].item_group_id);
  const whatsapp = metaWhatsappItems(items);
  assert.deepEqual(whatsapp.map((item) => item.item_group_id), ["10", "10"]);
  assert.deepEqual(whatsapp.map((item) => item.title), ["Nike V2K", "Nike V2K"]);
  // Same ids as the ad feed, and an unavailable colour stays listed as out of stock.
  assert.deepEqual(whatsapp.map((item) => item.id), ["W-39", "B-39"]);
  assert.equal(whatsapp[1].availability, "out of stock");
  // The ad feed's items are not rewritten.
  assert.equal(items[0].title, "Nike V2K - White");
});

test("colour names read cleanly on the WhatsApp chip and the ad title", async () => {
  const { metaDisplayColor } = await import("../../server/services/metaCatalogFeedService.js");
  assert.equal(metaDisplayColor("White * Black & Navy"), "White & Black & Navy");
  assert.equal(metaDisplayColor("navy blue/red"), "Navy Blue & Red");
  assert.equal(metaDisplayColor("Navy & WHite Mark"), "Navy & White Mark");
  assert.equal(metaDisplayColor("White &navy"), "White & Navy");
  assert.equal(metaDisplayColor("أسود"), "أسود");
  // The link and the ad group keep the stored colour the storefront matches on.
  const item = buildMetaCatalogItem(baseRow({ color: "White * Black & Navy" }));
  assert.equal(item.color, "White & Black & Navy");
  assert.match(item.link, /color=White%20\*%20Black%20%26%20Navy/);
});

test("the WhatsApp feed sends colour and size as the only variant attributes", () => {
  // Meta counts gender and age group as variant attributes; one model listed for several
  // audiences made a third, half-empty dimension and WhatsApp showed no picker at all.
  const items = metaWhatsappItems([
    buildMetaCatalogItem(baseRow({ variant_id: 1, variant_sku: "M-39", color: "White", variant_audience: "men" })),
    buildMetaCatalogItem(baseRow({ variant_id: 2, variant_sku: "K-39", color: "Black", variant_audience: "kids" })),
  ]);
  for (const item of items) {
    const xml = metaCatalogItemXml(item);
    assert.equal(xml.includes("<g:gender>"), false);
    assert.equal(xml.includes("<g:age_group>"), false);
    assert.match(xml, /<g:custom_label_0>/);
  }
});

test("two stored colours that read the same keep the size in stock", () => {
  const items = metaWhatsappItems([
    buildMetaCatalogItem(baseRow({ variant_id: 1, variant_sku: "A", color: "White/Black", variant_stock: 0 })),
    buildMetaCatalogItem(baseRow({ variant_id: 2, variant_sku: "B", color: "White & Black", variant_stock: 4 })),
  ]);
  assert.deepEqual(items.map((item) => item.id), ["B"]);
});

test("WhatsApp sizes carry no slash; the ad feed keeps the stored size", () => {
  const ad = buildMetaCatalogItem(baseRow({ size: "M4/W6" }));
  const [whatsapp] = metaWhatsappItems([ad]);
  assert.equal(whatsapp.size, "M4 - W6");
  assert.match(metaCatalogItemXml(whatsapp), /<g:size>M4 - W6<\/g:size>/);
  assert.equal(ad.size, "M4/W6");
});
