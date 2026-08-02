import db from "../database/db.js";

const SOURCE_ORDER = ["imported_vietnam", "mirror_original", "egyptian"];
const AUDIENCE_ORDER = ["men", "women", "kids"];
const PRODUCT_GROUP_ORDER = ["sneakers", "crocs", "bags", "winter"];
const SOURCE_LABELS = { imported_vietnam: "مستورد فيتنامي", mirror_original: "ميرور أوريجنال", egyptian: "مصري" };
const AUDIENCE_LABELS = { men: "رجالي", women: "حريمي", kids: "أطفال" };

const normalizeSource = (value = "") => {
  const text = String(value || "").trim().toLowerCase();
  if (/(mirror|ميرور)/i.test(text)) return "mirror_original";
  if (/(vietnam|فيتنام|مستورد)/i.test(text)) return "imported_vietnam";
  if (/(egypt|egyptian|مصر|مصري|محلي|local)/i.test(text)) return "egyptian";
  return "";
};

const normalizeAudience = (...values) => {
  const text = values.flat().filter(Boolean).join(" ").toLowerCase();
  if (/(women|woman|female|ladies|حريمي|نسائي|نساء)/i.test(text)) return "women";
  if (/(kids|kid|child|children|boy|girl|أطفال|اطفال|طفل)/i.test(text)) return "kids";
  if (/(men|man|male|رجالي|رجال)/i.test(text)) return "men";
  return "men";
};

const normalizeProductGroup = (value = "") => {
  const text = String(value || "").trim().toLowerCase();
  if (/(winter|collection|شتو)/i.test(text)) return "winter";
  if (/(crocs|croc|كروكس)/i.test(text)) return "crocs";
  if (/(bag|bags|شنط|شنطة|شنطه)/i.test(text)) return "bags";
  if (/(sneaker|sneakers|shoe|shoes|slipper|سنيكر|حذاء)/i.test(text)) return "sneakers";
  return "sneakers";
};

export const ensureEmployeeDisplayAuditSchema = async (clientOrPool = db) => {
  await clientOrPool.query(`ALTER TABLE IF EXISTS products ADD COLUMN IF NOT EXISTS is_displayed BOOLEAN NOT NULL DEFAULT FALSE`);
  await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_products_display_audit ON products (tenant_id, is_displayed, is_active) WHERE status = 'active'`);
};

export const loadEmployeeDisplayAudit = async ({ employee } = {}) => {
  await ensureEmployeeDisplayAuditSchema(db);
  const result = await db.query(
    `SELECT
       p.id AS product_id, p.name, p.sku AS product_sku, p.image_url AS product_image_url,
       p.grade, p.gender, p.product_type, p.is_displayed,
       COALESCE((SELECT jsonb_agg(pa.audience ORDER BY pa.audience) FROM product_audiences pa WHERE pa.product_id = p.id), '[]'::jsonb) AS audiences,
       selected.variant_id, selected.color, selected.size, selected.stock, selected.sku, selected.barcode,
       COALESCE(NULLIF(selected.image_url, ''), NULLIF(p.image_url, ''), '') AS image_url
     FROM products p
     JOIN LATERAL (
       SELECT pv.id AS variant_id, pv.color, pv.size, pv.stock, pv.sku, pv.barcode, pv.image_url
       FROM product_variants pv
       WHERE pv.product_id = p.id
         AND pv.deleted_at IS NULL
         AND pv.is_active IS DISTINCT FROM FALSE
         AND COALESCE(pv.stock, 0) > 0
       ORDER BY
         COALESCE(NULLIF(regexp_replace(COALESCE(pv.size, ''), '[^0-9.]', '', 'g'), '')::numeric, 999999),
         LOWER(COALESCE(pv.size, '')), pv.id
       LIMIT 1
     ) selected ON TRUE
     WHERE ($1::bigint IS NULL OR p.tenant_id = $1::bigint)
       AND p.is_active IS DISTINCT FROM FALSE
       AND LOWER(COALESCE(p.status, 'active')) = 'active'
       AND COALESCE(p.is_displayed, FALSE) = FALSE
     ORDER BY LOWER(COALESCE(p.grade, '')), LOWER(COALESCE(p.name, '')), p.id`,
    [employee?.tenant_id || null]
  );

  const groups = Object.fromEntries(SOURCE_ORDER.map((source) => [source, {
    key: source,
    label: SOURCE_LABELS[source],
    count: 0,
    audiences: Object.fromEntries(AUDIENCE_ORDER.map((audience) => [audience, { key: audience, label: AUDIENCE_LABELS[audience], count: 0, products: [] }])),
  }]));

  for (const row of result.rows) {
    const source = normalizeSource(row.grade);
    if (!source) continue;
    const audience = normalizeAudience(row.audiences, row.gender);
    const productGroup = normalizeProductGroup(row.product_type);
    const item = {
      product_id: row.product_id,
      name: row.name || "منتج",
      image_url: row.image_url || "",
      color: row.color || "-",
      size: row.size || "-",
      stock: Number(row.stock || 0),
      sku: row.sku || row.product_sku || "",
      barcode: row.barcode || "",
      source,
      audience,
      product_group: productGroup,
      is_displayed: false,
    };
    groups[source].audiences[audience].products.push(item);
    groups[source].audiences[audience].count += 1;
    groups[source].count += 1;
  }

  const sections = SOURCE_ORDER.map((source) => ({
    ...groups[source],
    audiences: AUDIENCE_ORDER.map((audience) => groups[source].audiences[audience]).filter((group) => group.count > 0),
  })).filter((section) => section.count > 0);
  const product_group_counts = Object.fromEntries(PRODUCT_GROUP_ORDER.map((key) => [key, 0]));
  sections.forEach((section) => section.audiences.forEach((audience) => audience.products.forEach((product) => {
    product_group_counts[product.product_group] = Number(product_group_counts[product.product_group] || 0) + 1;
  })));
  return { total: sections.reduce((sum, section) => sum + section.count, 0), product_group_counts, sections };
};

export const markEmployeeProductDisplayed = async ({ employee, productId } = {}) => {
  await ensureEmployeeDisplayAuditSchema(db);
  const result = await db.query(
    `UPDATE products SET is_displayed = TRUE, updated_at = NOW()
     WHERE id = $1 AND ($2::bigint IS NULL OR tenant_id = $2::bigint)
     RETURNING id, is_displayed`,
    [productId, employee?.tenant_id || null]
  );
  if (!result.rows[0]) {
    const error = new Error("Product not found");
    error.status = 404;
    error.code = "product_not_found";
    throw error;
  }
  return { product_id: result.rows[0].id, is_displayed: true };
};
