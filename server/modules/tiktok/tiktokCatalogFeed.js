import express from "express";
import { buildMetaCatalogFeed } from "../../services/metaCatalogFeedService.js";

/*
 * The TikTok catalogue feed: GET /feeds/tiktok.csv, pulled by TikTok's "Data Feed Schedule".
 *
 * It is the Meta catalogue, re-shaped — never a second query. The Meta feed already decides
 * everything a catalogue row must agree on with the shop and the pixel:
 *   - id: the size's SKU (product-variant only when two live sizes share a SKU), the same
 *     content_id the TikTok Pixel and Events API send (shared/metaPurchaseEvent.js);
 *   - item_group_id: product + colour, so an ad shows a colourway and its sizes stay inside it;
 *   - price / sale_price: what the shop charges, through the canonical customer-price resolver;
 *   - only published products, published colours and live sizes; a size with no price dropped;
 *   - images TikTok can read (WebP masters swapped for their JPEG renditions).
 * Reusing its 15-minute cache means TikTok's crawl adds no database load at all.
 *
 * CSV, not RSS: TikTok's own catalogue template is a CSV with these exact column names
 * (sku_id, not g:id), so nothing depends on how TikTok maps a Google-style feed.
 * Field rules: TikTok Ads Manager -> "Catalog Product Parameters" (9 required, 27 optional).
 */

export const TIKTOK_CATALOG_COLUMNS = Object.freeze([
  // required
  "sku_id",
  "title",
  "description",
  "availability",
  "condition",
  "price",
  "link",
  "image_link",
  "brand",
  // optional
  "item_group_id",
  "additional_image_link",
  "sale_price",
  "color",
  "size",
  "gender",
  "age_group",
  "google_product_category",
]);

const REQUIRED = TIKTOK_CATALOG_COLUMNS.slice(0, 9);
const MAX_ADDITIONAL_IMAGES = 10;
const MAX_DESCRIPTION_LENGTH = 5000;
const MAX_TITLE_LENGTH = 150;

const text = (value = "") => String(value ?? "").trim();

// TikTok: "valid unicode only, no control or function characters, no emoji".
const cleanText = (value = "", maxLength = Infinity) => {
  const cleaned = text(value)
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\p{Extended_Pictographic}|[\u{FE0F}\u{200D}]/gu, "")
    .replace(/[\u0000-\u001F\u007F-\u009F]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length > maxLength ? cleaned.slice(0, maxLength).trim() : cleaned;
};

// TikTok reads JPG and PNG only, and checks the link's extension.
export const isTikTokImageUrl = (url = "") => /^https:\/\/\S+\.(jpe?g|png)(\?\S*)?$/i.test(text(url));

// "Only supports three levels" of Google's taxonomy.
const threeLevels = (category = "") => text(category).split(">").map((part) => part.trim()).filter(Boolean).slice(0, 3).join(" > ");

/*
 * One Meta catalogue item -> one TikTok row, or a reason it cannot be one. The reason is a
 * fixed word, never product data, so it can be logged and counted.
 */
export const tiktokCatalogRow = (item = {}) => {
  const row = {
    sku_id: cleanText(item.id),
    title: cleanText(item.title, MAX_TITLE_LENGTH),
    description: cleanText(item.description || item.title, MAX_DESCRIPTION_LENGTH),
    availability: text(item.availability) === "in stock" ? "in stock" : "out of stock",
    condition: "new",
    price: text(item.price),
    link: text(item.link),
    image_link: text(item.image_link),
    brand: cleanText(item.brand),
    item_group_id: cleanText(item.item_group_id),
    additional_image_link: [...new Set((item.additional_image_link || []).map(text))]
      .filter((url) => isTikTokImageUrl(url) && url !== text(item.image_link))
      .slice(0, MAX_ADDITIONAL_IMAGES)
      .join(","),
    sale_price: text(item.sale_price),
    color: cleanText(item.color),
    size: cleanText(item.size),
    gender: ["male", "female", "unisex"].includes(text(item.gender)) ? text(item.gender) : "",
    age_group: ["newborn", "infant", "toddler", "kids", "adult"].includes(text(item.age_group)) ? text(item.age_group) : "",
    google_product_category: threeLevels(item.google_product_category),
  };
  const missing = REQUIRED.find((column) => !row[column]);
  if (missing) return { row: null, reason: `missing_${missing}` };
  if (!isTikTokImageUrl(row.image_link)) return { row: null, reason: "image_not_jpg_png" };
  if (!/^https:\/\//i.test(row.link)) return { row: null, reason: "link_not_https" };
  return { row, reason: "" };
};

const csvCell = (value = "") => `"${String(value ?? "").replace(/"/g, '""')}"`;

export const tiktokCatalogCsv = (rows = []) =>
  [TIKTOK_CATALOG_COLUMNS.map(csvCell).join(","), ...rows.map((row) => TIKTOK_CATALOG_COLUMNS.map((column) => csvCell(row[column])).join(","))].join("\n") + "\n";

/*
 * Built once per Meta build (the Meta cache decides freshness). One sku_id appears once:
 * TikTok ignores repeats, and a repeat would mean two rows disagreeing about one size.
 */
export const buildTikTokCatalogFromItems = (items = []) => {
  const rows = [];
  const seen = new Set();
  const skipped = {};
  for (const item of items) {
    const { row, reason } = tiktokCatalogRow(item);
    const key = row?.sku_id.toLowerCase();
    const why = reason || (seen.has(key) ? "duplicate_sku_id" : "");
    if (why) {
      skipped[why] = (skipped[why] || 0) + 1;
      continue;
    }
    seen.add(key);
    rows.push(row);
  }
  const inStock = rows.filter((row) => row.availability === "in stock").length;
  return {
    csv: tiktokCatalogCsv(rows),
    stats: {
      items: rows.length,
      in_stock: inStock,
      out_of_stock: rows.length - inStock,
      groups: new Set(rows.map((row) => row.item_group_id)).size,
      skipped,
    },
  };
};

let cache = null;

export const clearTikTokCatalogFeedCache = () => {
  cache = null;
};

export const buildTikTokCatalogFeed = async ({ loadMetaFeed = buildMetaCatalogFeed } = {}) => {
  const meta = await loadMetaFeed();
  if (cache && cache.sourceGeneratedAt === meta.generatedAt) return cache;
  const startedAt = Date.now();
  try {
    const built = buildTikTokCatalogFromItems(meta.items || []);
    cache = { ...built, sourceGeneratedAt: meta.generatedAt, generatedAt: Date.now() };
    // Counts only: a feed log must never carry product or customer data.
    console.log("[tiktok-catalog-feed] built", { ...built.stats, ms: Date.now() - startedAt });
    return cache;
  } catch (error) {
    // TikTok counts a failed fetch against the catalogue; yesterday's rows are still mostly true.
    if (cache) {
      console.error("[tiktok-catalog-feed] rebuild failed; serving the last good copy", { message: text(error?.message).slice(0, 200) });
      return cache;
    }
    throw error;
  }
};

const router = express.Router();

router.get("/tiktok.csv", async (_req, res) => {
  try {
    const feed = await buildTikTokCatalogFeed();
    res.set("Content-Type", "text/csv; charset=utf-8");
    res.set("Cache-Control", "public, max-age=900");
    res.set("X-Feed-Items", String(feed.stats.items));
    res.set("X-Feed-Generated-At", new Date(feed.generatedAt).toISOString());
    return res.status(200).send(feed.csv);
  } catch (error) {
    console.error("[tiktok-catalog-feed] failed", { message: text(error?.message).slice(0, 200) });
    return res.status(500).type("text/plain").send("TikTok catalog feed generation failed");
  }
});

export default router;
