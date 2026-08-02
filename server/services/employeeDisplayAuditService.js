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

export const normalizeDisplayAuditAudiences = (...values) => {
  const text = values.flat().filter(Boolean).join(" ").toLowerCase();
  const matched = [];
  if (/(women|woman|female|ladies|حريمي|نسائي|نساء)/i.test(text)) matched.push("women");
  if (/(kids|kid|child|children|boy|girl|أطفال|اطفال|طفل)/i.test(text)) matched.push("kids");
  if (/(^|[^a-z])(men|man|male)([^a-z]|$)|رجالي|رجال/i.test(text)) matched.push("men");
  return matched.length ? AUDIENCE_ORDER.filter((key) => matched.includes(key)) : ["men"];
};

const DISPLAY_SIZE_RANGES = {
  kids: [
    { key: "kids-22-26", label: "أطفال 22–26", min: 22, max: 26 },
    { key: "kids-27-31", label: "أطفال 27–31", min: 27, max: 31 },
    { key: "kids-32-36", label: "أطفال 32–36", min: 32, max: 36 },
  ],
  women: [{ key: "women-37-41", label: "حريمي 37–41", min: 37, max: 41 }],
  men: [{ key: "men-41-plus", label: "رجالي 41+", min: 41, max: Number.POSITIVE_INFINITY }],
};
const numericSize = (value) => {
  const match = String(value ?? "").replace(",", ".").match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
};
const variantColorKey = (variant = {}) => String(variant.color_group_key || variant.color || `variant:${variant.variant_id || ""}`).trim().toLowerCase();
export const resolveDisplayAuditColorsForAudience = ({ variants = [], audience, productGroup, productAudiences = [], productImageUrl = "", productSku = "" }) => {
  const byColor = new Map();
  for (const variant of variants) {
    const key = variantColorKey(variant);
    if (!byColor.has(key)) byColor.set(key, []);
    byColor.get(key).push(variant);
  }
  const shouldSplitBySize = productGroup === "sneakers" && (audience === "kids" || productAudiences.length > 1);
  const ranges = DISPLAY_SIZE_RANGES[audience] || [];
  const colors = [];
  for (const colorVariants of byColor.values()) {
    const explicitAudienceText = colorVariants.map((variant) => variant.audience).filter(Boolean);
    const colorAudiences = explicitAudienceText.length ? normalizeDisplayAuditAudiences(explicitAudienceText) : productAudiences;
    if (!colorAudiences.includes(audience)) continue;
    const sorted = [...colorVariants].sort((left, right) =>
      (numericSize(left.size) ?? Number.POSITIVE_INFINITY) - (numericSize(right.size) ?? Number.POSITIVE_INFINITY) ||
      Number(left.variant_id || 0) - Number(right.variant_id || 0)
    );
    const numericVariants = sorted.filter((variant) => numericSize(variant.size) !== null);
    const selections = shouldSplitBySize && numericVariants.length
      ? ranges.map((range) => ({
          range,
          variant: numericVariants.find((variant) => numericSize(variant.size) >= range.min && numericSize(variant.size) <= range.max),
        })).filter((selection) => selection.variant)
      : [{ range: null, variant: sorted[0] }];
    // Preserve unusual legacy sizes instead of hiding the model entirely.
    if (!selections.length && productAudiences.length === 1 && sorted[0]) selections.push({ range: null, variant: sorted[0] });
    for (const { range, variant: selected } of selections) {
      colors.push({
        variant_id: selected.variant_id,
        color_group_key: selected.color_group_key || "",
        color_sort_order: Number(selected.color_sort_order || 0),
        color: selected.color || "-",
        size: selected.size || "-",
        stock: Number(selected.stock || 0),
        sku: selected.sku || productSku || "",
        barcode: selected.barcode || "",
        image_url: selected.image_url || productImageUrl || "",
        display_stage_key: range?.key || "",
        display_stage_label: range?.label || "",
      });
    }
  }
  return colors.sort((left, right) =>
    left.color_sort_order - right.color_sort_order ||
    String(left.color).localeCompare(String(right.color), "en") ||
    (numericSize(left.size) ?? Number.POSITIVE_INFINITY) - (numericSize(right.size) ?? Number.POSITIVE_INFINITY)
  );
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
       selected.variants
     FROM products p
     JOIN LATERAL (
       SELECT jsonb_agg(
         jsonb_build_object(
           'variant_id', pv.id,
           'color_group_key', pv.color_group_key,
           'color_sort_order', pv.color_sort_order,
           'color', pv.color,
           'size', pv.size,
           'stock', pv.stock,
           'sku', pv.sku,
           'barcode', pv.barcode,
           'audience', pv.audience,
           'image_url', COALESCE(NULLIF(pv.image_url, ''), NULLIF(p.image_url, ''), '')
         ) ORDER BY pv.color_sort_order, LOWER(COALESCE(pv.color, '')), pv.id
       ) AS variants
       FROM product_variants pv
       WHERE pv.product_id = p.id
         AND pv.deleted_at IS NULL
         AND pv.is_active IS DISTINCT FROM FALSE
         AND COALESCE(pv.stock, 0) > 0
     ) selected ON jsonb_array_length(COALESCE(selected.variants, '[]'::jsonb)) > 0
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
    const audiences = normalizeDisplayAuditAudiences(row.audiences, row.gender);
    const productGroup = normalizeProductGroup(row.product_type);
    for (const audience of audiences) {
      const colors = resolveDisplayAuditColorsForAudience({
        variants: Array.isArray(row.variants) ? row.variants : [],
        audience,
        productGroup,
        productAudiences: audiences,
        productImageUrl: row.product_image_url,
        productSku: row.product_sku,
      });
      if (!colors.length) continue;
      const firstColor = colors[0];
      const item = {
        product_id: row.product_id,
        name: row.name || "منتج",
        image_url: firstColor.image_url || row.product_image_url || "",
        color: firstColor.color || "-",
        size: firstColor.size || "-",
        stock: Number(firstColor.stock || 0),
        sku: firstColor.sku || row.product_sku || "",
        barcode: firstColor.barcode || "",
        colors,
        source,
        audience,
        product_group: productGroup,
        is_displayed: false,
      };
      groups[source].audiences[audience].products.push(item);
      groups[source].audiences[audience].count += 1;
    }
    groups[source].count += 1;
  }

  const sections = SOURCE_ORDER.map((source) => ({
    ...groups[source],
    audiences: AUDIENCE_ORDER.map((audience) => groups[source].audiences[audience]).filter((group) => group.count > 0),
  })).filter((section) => section.count > 0);
  const productGroupIds = Object.fromEntries(PRODUCT_GROUP_ORDER.map((key) => [key, new Set()]));
  sections.forEach((section) => section.audiences.forEach((audience) => audience.products.forEach((product) => {
    productGroupIds[product.product_group]?.add(String(product.product_id));
  })));
  const product_group_counts = Object.fromEntries(PRODUCT_GROUP_ORDER.map((key) => [key, productGroupIds[key].size]));
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
