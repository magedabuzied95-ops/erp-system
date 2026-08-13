import db from "../database/db.js";
import { normalizeProductCards } from "./aiProductCards.js";

const text = (value = "") => String(value ?? "").trim();
const publicStorefrontBaseUrl = () => text(
  process.env.STOREFRONT_URL ||
  process.env.STORE_FRONT_URL ||
  process.env.PUBLIC_STOREFRONT_URL ||
  "https://m1store-egy.com"
).replace(/\/+$/, "");
const normalize = (value = "") => text(value)
  .toLowerCase()
  .replace(/[\u064b-\u065f\u0670\u0640]/g, "")
  .replace(/[\u0623\u0625\u0622]/g, "\u0627")
  .replace(/\u0649/g, "\u064a")
  .replace(/\u0629/g, "\u0647")
  .replace(/[^\p{L}\p{N}\s]/gu, " ")
  .replace(/\s+/g, " ")
  .trim();

const AUDIENCES = [
  { key: "men", label: "رجالي", aliases: ["رجالي", "رجاله", "رجال", "شباب", "men", "man", "male"] },
  { key: "women", label: "حريمي", aliases: ["حريمي", "نسائي", "نساء", "بناتي", "women", "woman", "female"] },
  { key: "kids", label: "أطفال", aliases: ["اطفال", "طفل", "ولادي", "بناتي", "kids", "kid", "children", "child"] },
];

const BROWSE_TERMS = [
  "عايز", "عاوزه", "عايزة", "وريني", "شوفلي", "عندك", "المتاح", "موديلات", "موديل",
  "قسم", "سكشن", "فئه", "فئة", "نوع", "اختيارات", "looking for", "show me", "available",
];

const firstAudience = (message = "") => {
  const value = normalize(message);
  return AUDIENCES.find((item) => item.aliases.some((alias) => value.includes(normalize(alias)))) || null;
};

const requestedSize = (message = "") => {
  const match = text(message).match(/(?:مقاس|size)?\s*([2-5][0-9])\b/i);
  return match?.[1] || "";
};

const requestedPriceRange = (message = "") => {
  const value = normalize(message);
  const numbers = [...text(message).matchAll(/\b(\d{2,5})\b/g)].map((match) => Number(match[1])).filter((number) => number >= 100);
  if (!numbers.length) return { minPrice: null, maxPrice: null };
  if (/(اقل|تحت|حدود|ميزاني|ماكس|max|under|less)/i.test(value)) return { minPrice: null, maxPrice: Math.max(...numbers) };
  if (/(اكتر|فوق|من اول|min|above|more)/i.test(value)) return { minPrice: Math.min(...numbers), maxPrice: null };
  return numbers.length > 1
    ? { minPrice: Math.min(...numbers), maxPrice: Math.max(...numbers) }
    : { minPrice: null, maxPrice: null };
};

const catalogRows = async (tenantId) => {
  const result = await db.query(
    `
    SELECT
      p.id, p.name, p.slug, p.canonical_slug, p.sku, p.image_url, p.gallery_images,
      p.gender, p.product_type, p.style, p.grade, p.selling_price, p.regular_price,
      p.price, p.sale_price, p.sale_price_enabled, p.stock, p.status, p.is_active,
      COALESCE(c.name, '') AS category_name,
      COALESCE(b.name, '') AS brand_name,
      COALESCE(a.audiences, '[]'::jsonb) AS audiences,
      COALESCE(v.variants, '[]'::jsonb) AS variants,
      COALESCE(v.variant_stock, 0) AS variant_stock
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    LEFT JOIN brands b ON b.id = p.brand_id
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(DISTINCT pa.audience) FILTER (WHERE pa.audience IS NOT NULL) AS audiences
      FROM product_audiences pa
      WHERE pa.product_id = p.id
    ) a ON TRUE
    LEFT JOIN LATERAL (
      SELECT
        jsonb_agg(jsonb_build_object('id', pv.id, 'size', pv.size, 'color', pv.color, 'stock', pv.stock, 'image_url', pv.image_url)) AS variants,
        SUM(GREATEST(COALESCE(pv.stock, 0), 0)) AS variant_stock
      FROM product_variants pv
      WHERE pv.product_id = p.id
        AND pv.is_active IS DISTINCT FROM FALSE
        AND pv.deleted_at IS NULL
    ) v ON TRUE
    WHERE p.tenant_id = $1
      AND p.is_active IS DISTINCT FROM FALSE
      AND COALESCE(LOWER(p.status), 'active') NOT IN ('deleted', 'archived', 'draft', 'inactive')
      AND p.is_storefront_visible IS DISTINCT FROM FALSE
    ORDER BY p.id DESC
    LIMIT 500
    `,
    [tenantId]
  );
  return result.rows || [];
};

const matchFacet = (message = "", rows = [], fields = []) => {
  const haystack = normalize(message);
  const values = [...new Set(rows.flatMap((row) => fields.map((field) => text(row[field]))).filter(Boolean))]
    .sort((left, right) => right.length - left.length);
  return values.find((value) => haystack.includes(normalize(value))) || "";
};

const rowAudiences = (row = {}) => [
  ...(Array.isArray(row.audiences) ? row.audiences : []),
  row.gender,
].map(normalize).filter(Boolean);

const buildUrl = ({ audience = null, productType = "", category = "", brand = "", size = "", minPrice = null, maxPrice = null } = {}) => {
  const params = new URLSearchParams();
  if (audience?.key) params.set("gender", audience.key);
  if (productType) params.set("type", productType);
  if (brand) params.set("brand", brand);
  if (size) params.set("size", size);
  if (minPrice !== null) params.set("minPrice", String(minPrice));
  if (maxPrice !== null) params.set("maxPrice", String(maxPrice));
  if (category && !productType) params.set("q", category);
  params.set("inStock", "1");
  params.set("v", "4");
  const base = publicStorefrontBaseUrl();
  return `${base}/share/available?${params.toString().replace(/\+/g, "%20")}`;
};

const hasBrowseIntent = (message = "", facets = {}) => {
  const value = normalize(message);
  return BROWSE_TERMS.some((term) => value.includes(normalize(term))) ||
    Boolean(facets.audience || facets.productType || facets.category || facets.brand || facets.size);
};

export const resolveCatalogNavigation = async ({ tenantId = 1, message = "" } = {}) => {
  const rows = await catalogRows(tenantId);
  const audience = firstAudience(message);
  const productType = matchFacet(message, rows, ["product_type"]);
  const category = matchFacet(message, rows, ["category_name"]);
  const brand = matchFacet(message, rows, ["brand_name"]);
  const size = requestedSize(message);
  const { minPrice, maxPrice } = requestedPriceRange(message);
  const facets = { audience, productType, category, brand, size, minPrice, maxPrice };
  if (!hasBrowseIntent(message, facets)) return null;

  const filtered = rows.filter((row) => {
    const stock = Number(row.variant_stock || row.stock || 0);
    if (stock <= 0) return false;
    if (audience && !rowAudiences(row).some((value) => value === audience.key || audience.aliases.some((alias) => value === normalize(alias)))) return false;
    if (productType && normalize(row.product_type) !== normalize(productType)) return false;
    if (category && normalize(row.category_name) !== normalize(category)) return false;
    if (brand && normalize(row.brand_name) !== normalize(brand)) return false;
    if (size && !(Array.isArray(row.variants) ? row.variants : []).some((variant) => text(variant?.size) === size && Number(variant?.stock || 0) > 0)) return false;
    const price = Number(row.selling_price || row.regular_price || row.price || 0);
    if (minPrice !== null && price < minPrice) return false;
    if (maxPrice !== null && price > maxPrice) return false;
    return true;
  });

  const url = buildUrl(facets);
  const cards = normalizeProductCards(filtered.slice(0, 6), { limit: 6 });
  const label = [audience?.label, category || productType, brand, size ? `مقاس ${size}` : ""].filter(Boolean).join(" - ");
  const answer = filtered.length
    ? [`لقيتلك ${filtered.length} اختيار متاح${label ? ` في ${label}` : ""}.`, "تقدر تشوف كل المتاح والأسعار والمقاسات من هنا:", url].join("\n")
    : [`مش لاقي اختيار متاح مطابق${label ? ` لـ ${label}` : " للمواصفات دي"} دلوقتي.`, "ده رابط البحث وتقدر تغيّر الفلاتر بسهولة:", url].join("\n");

  return {
    answer,
    text: answer,
    url,
    cards,
    facets: {
      audience: audience?.key || "",
      audience_label: audience?.label || "",
      product_type: productType,
      category,
      brand,
      size,
      min_price: minPrice,
      max_price: maxPrice,
    },
    catalog: {
      audiences: AUDIENCES.map(({ key, label }) => ({ key, label })),
      product_types: [...new Set(rows.map((row) => text(row.product_type)).filter(Boolean))],
      categories: [...new Set(rows.map((row) => text(row.category_name)).filter(Boolean))],
      brands: [...new Set(rows.map((row) => text(row.brand_name)).filter(Boolean))],
      styles: [...new Set(rows.map((row) => text(row.style)).filter(Boolean))],
      grades: [...new Set(rows.map((row) => text(row.grade)).filter(Boolean))],
    },
  };
};

export default { resolveCatalogNavigation };
