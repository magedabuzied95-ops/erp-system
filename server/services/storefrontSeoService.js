import db from "../database/db.js";

export const STOREFRONT_ORIGIN = "https://m1store-egy.com";

const INDEXABLE_PUBLIC_PATHS = [
  "/",
  "/products",
  "/sale",
  "/offers",
];

const PRIVATE_ROBOTS_PATHS = [
  "/account",
  "/cart",
  "/checkout",
  "/track",
  "/wishlist",
  "/recently-viewed",
  "/success",
  "/confirm",
  "/dashboard",
  "/orders",
  "/settings",
  "/employee",
  "/employee-app",
  "/employee-portal",
  "/manager",
  "/manager-portal",
  "/warehouse",
  "/inbox",
  "/api",
];

const text = (value = "") => String(value ?? "").trim();

export const escapeXml = (value = "") =>
  text(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

const slugify = (value = "") =>
  text(value)
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06FF]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 160);

const productIdentifier = (product = {}) =>
  text(product.slug || product.canonical_slug || product.id) ||
  slugify(product.name);

const productUrl = (product = {}) => {
  const identifier = productIdentifier(product);
  if (!identifier) return "";
  return `${STOREFRONT_ORIGIN}/product/${encodeURIComponent(identifier)}`;
};

const validLastmod = (value) => {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
};

export const buildSitemapEntries = (products = []) => {
  const entries = INDEXABLE_PUBLIC_PATHS.map((pathname) => ({
    loc: `${STOREFRONT_ORIGIN}${pathname}`,
    lastmod: "",
  }));
  const seen = new Set(entries.map((entry) => entry.loc));

  for (const product of Array.isArray(products) ? products : []) {
    const loc = productUrl(product);
    if (!loc || seen.has(loc) || loc.includes("?")) continue;
    seen.add(loc);
    entries.push({
      loc,
      lastmod: validLastmod(product.updated_at),
    });
  }
  return entries;
};

export const buildSitemapXml = (products = []) => {
  const urls = buildSitemapEntries(products)
    .map(({ loc, lastmod }) => [
      "  <url>",
      `    <loc>${escapeXml(loc)}</loc>`,
      ...(lastmod ? [`    <lastmod>${escapeXml(lastmod)}</lastmod>`] : []),
      "  </url>",
    ].join("\n"))
    .join("\n");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    urls,
    "</urlset>",
    "",
  ].join("\n");
};

export const buildRobotsTxt = () => [
  "User-agent: *",
  "Allow: /",
  ...PRIVATE_ROBOTS_PATHS.map((pathname) => `Disallow: ${pathname}`),
  "",
  `Sitemap: ${STOREFRONT_ORIGIN}/sitemap.xml`,
  "",
].join("\n");

export const loadIndexableStorefrontProducts = async ({
  tenantId = Number(process.env.STOREFRONT_TENANT_ID || 1),
} = {}) => {
  const result = await db.query(
    `
      SELECT p.id, p.name, p.slug, p.canonical_slug, p.updated_at
      FROM products p
      WHERE p.tenant_id = $1
        AND p.is_active IS DISTINCT FROM FALSE
        AND COALESCE(NULLIF(LOWER(TRIM(p.status)), ''), 'active')
          NOT IN ('inactive', 'disabled', 'archived', 'deleted', 'draft')
        AND COALESCE(p.is_storefront_visible, TRUE) = TRUE
      ORDER BY p.id ASC
    `,
    [tenantId]
  );
  return result.rows;
};

export const sitemapResponse = async () =>
  buildSitemapXml(await loadIndexableStorefrontProducts());

export const createStorefrontSitemapHandler = ({
  loadProducts = loadIndexableStorefrontProducts,
} = {}) => async (_req, res, next) => {
  try {
    const xml = buildSitemapXml(await loadProducts());
    res.set("Content-Type", "application/xml; charset=utf-8");
    res.set("Cache-Control", "public, max-age=300, stale-while-revalidate=3600");
    return res.status(200).send(xml);
  } catch (error) {
    return next(error);
  }
};

export const storefrontSitemapHandler = createStorefrontSitemapHandler();

export const storefrontRobotsHandler = (_req, res) => {
  res.set("Content-Type", "text/plain; charset=utf-8");
  res.set("Cache-Control", "public, max-age=300, stale-while-revalidate=3600");
  return res.status(200).send(buildRobotsTxt());
};
