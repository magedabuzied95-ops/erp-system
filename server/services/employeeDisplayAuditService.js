import db from "../database/db.js";
import { getDisplaySizeRanges, normalizeProductAudiences, numericSize } from "../utils/sizeGroups.js";

const SOURCE_ORDER = ["imported_vietnam", "mirror_original", "egyptian"];
const AUDIENCE_ORDER = ["men", "women", "kids", "special"];
const PRODUCT_GROUP_ORDER = ["sneakers", "crocs", "bags", "winter"];
const SOURCE_LABELS = { imported_vietnam: "مستورد فيتنامي", mirror_original: "ميرور أوريجنال", egyptian: "مصري" };
const AUDIENCE_LABELS = { men: "رجالي", women: "حريمي", kids: "أطفال", special: "خاص" };

const normalizeSource = (value = "") => {
  const text = String(value || "").trim().toLowerCase();
  if (/(mirror|ميرور)/i.test(text)) return "mirror_original";
  if (/(vietnam|فيتنام|مستورد)/i.test(text)) return "imported_vietnam";
  if (/(egypt|egyptian|مصر|مصري|محلي|local)/i.test(text)) return "egyptian";
  return "";
};

export const normalizeDisplayAuditAudiences = (...values) => {
  const matched = normalizeProductAudiences(...values);
  return matched.length ? AUDIENCE_ORDER.filter((key) => matched.includes(key)) : ["men"];
};

const DISPLAY_SIZE_RANGES = {
  kids: getDisplaySizeRanges("kids"),
  women: getDisplaySizeRanges("women"),
  men: getDisplaySizeRanges("men"),
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
    if (audience === "special") {
      if (productGroup !== "sneakers") continue;
      const sortedSpecial = [...colorVariants]
        .filter((variant) => numericSize(variant.size) !== null)
        .sort((left, right) => numericSize(left.size) - numericSize(right.size) || Number(left.variant_id || 0) - Number(right.variant_id || 0));
      const hasAbove46 = sortedSpecial.some((variant) => numericSize(variant.size) > 46);
      if (!hasAbove46) continue;
      const selected = sortedSpecial.find((variant) => numericSize(variant.size) === 46)
        || sortedSpecial.find((variant) => numericSize(variant.size) >= 47);
      if (!selected) continue;
      colors.push({
        variant_id: selected.variant_id,
        color_group_key: variantColorKey(selected),
        color_sort_order: Number(selected.color_sort_order || 0),
        color: selected.color || "-",
        size: selected.size || "-",
        stock: Number(selected.stock || 0),
        sku: selected.sku || productSku || "",
        barcode: selected.barcode || "",
        image_url: selected.image_url || productImageUrl || "",
        display_stage_key: "special-46-plus",
        display_stage_label: "مقاسات خاصة 46+",
      });
      continue;
    }
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
        color_group_key: variantColorKey(selected),
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
  await clientOrPool.query(`
    CREATE TABLE IF NOT EXISTS employee_product_display_states (
      id BIGSERIAL PRIMARY KEY,
      tenant_id BIGINT,
      product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      audience_key TEXT NOT NULL,
      display_stage_key TEXT NOT NULL DEFAULT '',
      color_group_key TEXT NOT NULL DEFAULT '',
      is_displayed BOOLEAN NOT NULL DEFAULT TRUE,
      displayed_by_employee_id BIGINT,
      displayed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (product_id, audience_key, display_stage_key, color_group_key)
    )
  `);
  await clientOrPool.query(`ALTER TABLE IF EXISTS employee_product_display_states ADD COLUMN IF NOT EXISTS color_group_key TEXT NOT NULL DEFAULT ''`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS employee_product_display_states DROP CONSTRAINT IF EXISTS employee_product_display_stat_product_id_audience_key_displ_key`);
  await clientOrPool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_employee_product_display_states_color_unique ON employee_product_display_states (product_id, audience_key, display_stage_key, color_group_key)`);
  await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_employee_product_display_states_lookup ON employee_product_display_states (tenant_id, product_id, audience_key, display_stage_key, color_group_key, is_displayed)`);
};

export const loadEmployeeDisplayAudit = async ({ employee } = {}) => {
  await ensureEmployeeDisplayAuditSchema(db);
  const result = await db.query(
    `SELECT
       p.id AS product_id, p.name, p.sku AS product_sku, p.image_url AS product_image_url,
       p.grade, p.gender, p.product_type, p.is_displayed,
       COALESCE((SELECT jsonb_agg(pa.audience ORDER BY pa.audience) FROM product_audiences pa WHERE pa.product_id = p.id), '[]'::jsonb) AS audiences,
       selected.variants,
       COALESCE((
         SELECT jsonb_agg(jsonb_build_object(
           'audience_key', state.audience_key,
           'display_stage_key', state.display_stage_key,
           'color_group_key', state.color_group_key,
           'is_displayed', state.is_displayed
         ))
         FROM employee_product_display_states state
         WHERE state.product_id = p.id
           AND ($1::bigint IS NULL OR state.tenant_id = $1::bigint)
       ), '[]'::jsonb) AS display_states
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
    if (row.is_displayed === true) continue;
    const source = normalizeSource(row.grade);
    if (!source) continue;
    const audiences = normalizeDisplayAuditAudiences(row.audiences, row.gender);
    const productGroup = normalizeProductGroup(row.product_type);
    const candidateAudiences = productGroup === "sneakers" ? [...audiences, "special"] : audiences;
    const displayStates = Array.isArray(row.display_states) ? row.display_states : [];
    let rowAdded = false;
    for (const audience of candidateAudiences) {
      const colors = resolveDisplayAuditColorsForAudience({
        variants: Array.isArray(row.variants) ? row.variants : [],
        audience,
        productGroup,
        productAudiences: audiences,
        productImageUrl: row.product_image_url,
        productSku: row.product_sku,
      });
      if (!colors.length) continue;
      const pendingColors = colors.filter((color) => !displayStates.some((state) =>
        state?.is_displayed !== false
        && state?.audience_key === audience
        && String(state?.display_stage_key || "") === String(color.display_stage_key || "")
        && String(state?.color_group_key || "") === String(color.color_group_key || "")
      ));
      if (!pendingColors.length) continue;
      const firstColor = pendingColors[0];
      const item = {
        product_id: row.product_id,
        name: row.name || "منتج",
        image_url: firstColor.image_url || row.product_image_url || "",
        color: firstColor.color || "-",
        size: firstColor.size || "-",
        stock: Number(firstColor.stock || 0),
        sku: firstColor.sku || row.product_sku || "",
        barcode: firstColor.barcode || "",
        colors: pendingColors,
        source,
        audience,
        product_group: productGroup,
        is_displayed: false,
      };
      groups[source].audiences[audience].products.push(item);
      groups[source].audiences[audience].count += 1;
      rowAdded = true;
    }
    if (rowAdded) groups[source].count += 1;
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

export const markEmployeeProductDisplayed = async ({ employee, productId, audience, displayStageKey = "", colorGroupKey = "" } = {}) => {
  await ensureEmployeeDisplayAuditSchema(db);
  const audienceKey = AUDIENCE_ORDER.includes(String(audience || "")) ? String(audience) : "";
  if (!audienceKey) {
    const error = new Error("Display audience is required");
    error.status = 400;
    error.code = "display_audience_required";
    throw error;
  }
  const normalizedColorGroupKey = String(colorGroupKey || "").trim().toLowerCase();
  if (!normalizedColorGroupKey) {
    const error = new Error("Display color is required");
    error.status = 400;
    error.code = "display_color_required";
    throw error;
  }
  const product = await db.query(
    `SELECT id FROM products WHERE id = $1 AND ($2::bigint IS NULL OR tenant_id = $2::bigint) LIMIT 1`,
    [productId, employee?.tenant_id || null]
  );
  if (!product.rows[0]) {
    const error = new Error("Product not found");
    error.status = 404;
    error.code = "product_not_found";
    throw error;
  }
  await db.query(
    `INSERT INTO employee_product_display_states (
       tenant_id, product_id, audience_key, display_stage_key, color_group_key, is_displayed, displayed_by_employee_id, displayed_at, updated_at
     ) VALUES ($1,$2,$3,$4,$5,TRUE,$6,NOW(),NOW())
     ON CONFLICT (product_id, audience_key, display_stage_key, color_group_key) DO UPDATE SET
       is_displayed = TRUE,
       displayed_by_employee_id = EXCLUDED.displayed_by_employee_id,
       displayed_at = NOW(),
       updated_at = NOW()`,
    [employee?.tenant_id || null, productId, audienceKey, String(displayStageKey || ""), normalizedColorGroupKey, employee?.id || null]
  );
  return { product_id: Number(productId), audience: audienceKey, display_stage_key: String(displayStageKey || ""), color_group_key: normalizedColorGroupKey, is_displayed: true };
};
