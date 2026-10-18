/*
 * TikTok catalogue coverage check — read-only, public endpoints only.
 *
 *   node server/scripts/tiktokCatalogCoverageCheck.js
 *
 * Walks the storefront listing (every colour card, every size), computes the content_id the
 * TikTok pixel sends for each size, and checks it against the live TikTok feed. Prints a JSON
 * summary (counts, reasons, a few example ids — no names, no customer data) and exits 1 when
 * more than MAX_MISSING_RATIO of the shown sizes are missing, so it can run from cron.
 *
 * Env (all optional):
 *   STOREFRONT_API      default https://api.m1store-egy.com/api
 *   TIKTOK_FEED_URL     default https://api.m1store-egy.com/feeds/tiktok.csv (a cache-busting
 *                       query is added: Cloudflare keeps a copy for 4h)
 *   MAX_MISSING_RATIO   default 0.01
 */
import { compareCatalogCoverage, coverageIsHealthy, parseFeedSkuIds } from "../modules/tiktok/tiktokCatalogCoverage.js";

const API = String(process.env.STOREFRONT_API || "https://api.m1store-egy.com/api").replace(/\/+$/, "");
const FEED_URL = process.env.TIKTOK_FEED_URL || "https://api.m1store-egy.com/feeds/tiktok.csv";
const MAX_MISSING_RATIO = Number(process.env.MAX_MISSING_RATIO || 0.01);
const PAGE_SIZE = 80; // the listing's own maximum
const MAX_PAGES = 60;

const fetchText = async (url) => {
  const response = await fetch(url, { headers: { "Cache-Control": "no-cache" } });
  if (!response.ok) throw new Error(`${new URL(url).pathname} answered ${response.status}`);
  return response.text();
};

const main = async () => {
  const separator = FEED_URL.includes("?") ? "&" : "?";
  const feedCsv = await fetchText(`${FEED_URL}${separator}coverage=${Date.now()}`);
  const feedIds = parseFeedSkuIds(feedCsv);
  const noPhoto = (feedCsv.match(/,"no_photo"\n/g) || []).length;

  const products = [];
  let pages = 0;
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const json = JSON.parse(await fetchText(`${API}/storefront/products?limit=${PAGE_SIZE}&page=${page}&offset=${(page - 1) * PAGE_SIZE}`));
    const list = json.products || json.items || json.data || [];
    pages = page;
    products.push(...list);
    if (!list.length || !(json.has_more ?? json.hasMore)) break;
  }

  const report = compareCatalogCoverage({ feedIds, products });
  const healthy = coverageIsHealthy(report, { maxMissingRatio: MAX_MISSING_RATIO });
  console.log(JSON.stringify({
    checked_at: new Date().toISOString(),
    healthy,
    max_missing_ratio: MAX_MISSING_RATIO,
    feed_items: feedIds.size,
    feed_no_photo: noPhoto,
    listing_pages: pages,
    listing_cards: products.length,
    ...report,
  }, null, 1));
  process.exit(healthy ? 0 : 1);
};

main().catch((error) => {
  console.error(JSON.stringify({ healthy: false, error: String(error?.message || error).slice(0, 200) }));
  process.exit(2);
});
