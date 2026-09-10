/*
  Google disapproves items mostly for ONE reason: what the feed says and what the
  landing page says do not match — price, availability, or an image it cannot
  fetch. Merchant Center only tells you after it crawls, so this checks the same
  things ourselves against production, on a random sample.

    node server/scripts/verifyGoogleFeedAgainstStorefront.js --sample=40

  Exit code 1 when any sampled item disagrees with its own landing page.
*/
const arg = (name, fallback) => {
  const hit = process.argv.find((value) => value.startsWith(`--${name}=`));
  return hit ? hit.split("=").slice(1).join("=") : fallback;
};

const FEED_URL = arg("feed", "https://api.m1store-egy.com/feeds/google.xml");
const SAMPLE = Number(arg("sample", 40));
const CONCURRENCY = 4;

const tagValue = (block, tag) => {
  const match = block.match(new RegExp(`<g:${tag}>([\\s\\S]*?)</g:${tag}>`));
  return match ? match[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").trim() : "";
};

const priceNumber = (value = "") => {
  const parsed = Number(String(value).replace(/[^0-9.]/g, ""));
  return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : 0;
};

const productJsonLd = (html = "") => {
  for (const match of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g)) {
    try {
      const parsed = JSON.parse(match[1]);
      if (parsed?.["@type"] === "Product") return parsed;
    } catch {
      // A block we cannot parse is reported by the schema check below, not here.
    }
  }
  return null;
};

const feedResponse = await fetch(FEED_URL);
const xml = await feedResponse.text();
const items = xml.split("<item>").slice(1).map((block) => ({
  id: tagValue(block, "id"),
  link: tagValue(block, "link"),
  image: tagValue(block, "image_link"),
  price: priceNumber(tagValue(block, "sale_price") || tagValue(block, "price")),
  availability: tagValue(block, "availability").replace(/[_\s]/g, ""),
}));

// One item per landing page: the sizes of one product all point at the same url,
// so sampling items would test the same page forty times.
const byLink = new Map();
for (const item of items) if (item.link && !byLink.has(item.link)) byLink.set(item.link, item);
const pool = [...byLink.values()].sort(() => Math.random() - 0.5).slice(0, SAMPLE);

const failures = [];
const checked = [];
let cursor = 0;
await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pool.length) }, async () => {
  while (cursor < pool.length) {
    const item = pool[cursor];
    cursor += 1;
    const problems = [];
    try {
      const page = await fetch(item.link, { headers: { "User-Agent": "Googlebot/2.1 (+http://www.google.com/bot.html)" } });
      if (!page.ok) problems.push(`landing page HTTP ${page.status}`);
      const html = await page.text();
      const schema = productJsonLd(html);
      if (!schema) problems.push("no Product schema on the page");
      else {
        const pagePrice = priceNumber(schema.offers?.price);
        if (pagePrice !== item.price) problems.push(`price feed ${item.price} vs page ${pagePrice}`);
        const pageInStock = String(schema.offers?.availability || "").toLowerCase().includes("instock");
        const feedInStock = item.availability === "instock";
        // Only one direction is a defect. The feed item is ONE size and the page speaks for the
        // whole product, so "feed out of stock, page in stock" is just the product's other sizes.
        // The reverse — advertising something the page itself calls unavailable — is real.
        if (feedInStock && !pageInStock) problems.push("feed says in stock, the page says out of stock");
        if (JSON.stringify(schema).includes("[object Object]")) problems.push("schema carries an [object Object] url");
      }
      const image = await fetch(item.image, { method: "HEAD" });
      const type = image.headers.get("content-type") || "";
      if (!image.ok) problems.push(`image HTTP ${image.status}`);
      else if (!type.startsWith("image/")) problems.push(`image content-type ${type}`);
    } catch (error) {
      problems.push(`fetch failed: ${error?.message || error}`);
    }
    checked.push(item.id);
    if (problems.length) failures.push({ id: item.id, link: item.link, problems });
  }
}));

console.log(JSON.stringify({
  feed: FEED_URL,
  feed_items: items.length,
  distinct_landing_pages: byLink.size,
  sampled: pool.length,
  clean: pool.length - failures.length,
  failures,
}, null, 2));

if (failures.length) process.exitCode = 1;
