import db from "../database/db.js";

const clean = (value = "") => String(value ?? "").trim();
const numberOrNull = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

// An exchange of "1 × Adidas Samba" for "1 × Adidas Samba" tells a manager nothing:
// the whole point of the swap was the size. The POS snapshot and order_items carry
// the variant id, so one lookup puts the colour/size back on every line that has one.
// Items are mutated in place; a missing name is filled from the variant too.
export const attachOperationVariantLabels = async (items = []) => {
  const list = (Array.isArray(items) ? items : []).filter((item) => item && typeof item === "object" && numberOrNull(item.variant_id));
  if (!list.length) return;
  const variantIds = [...new Set(list.map((item) => numberOrNull(item.variant_id)))];
  let rows = [];
  try {
    const result = await db.query(
      `
      SELECT pv.id,
             COALESCE(NULLIF(p.name, ''), '') AS product_name,
             COALESCE(NULLIF(pv.color, ''), '') AS color,
             COALESCE(NULLIF(pv.size, ''), '') AS size,
             to_jsonb(pv) AS variant_row,
             to_jsonb(p) AS product_row
      FROM product_variants pv
      LEFT JOIN products p ON p.id = pv.product_id
      WHERE pv.id = ANY($1::bigint[])
      `,
      [variantIds]
    );
    rows = result.rows || [];
  } catch (error) {
    console.warn("[operation-variant-labels] lookup failed", { message: error?.message || String(error) });
    return;
  }
  const byVariant = new Map(rows.map((row) => [String(row.id), row]));
  for (const item of list) {
    const row = byVariant.get(String(numberOrNull(item.variant_id)));
    if (!row) continue;
    const color = clean(row.color);
    const size = clean(row.size);
    if (color) item.color = color;
    if (size) item.size = size;
    const label = [color, size].filter(Boolean).join(" / ");
    if (label) item.variant_label = label;
    // Whole rows as JSON so a schema without pv.image_url still answers the query.
    const variantRow = row.variant_row && typeof row.variant_row === "object" ? row.variant_row : {};
    const productRow = row.product_row && typeof row.product_row === "object" ? row.product_row : {};
    const image = clean(variantRow.image_url) || clean(variantRow.image) || clean(productRow.image_url) || clean(productRow.image) || clean(productRow.thumbnail_url);
    if (image && !clean(item.image_url)) item.image_url = image;
    if ((!clean(item.name) || clean(item.name) === "منتج") && clean(row.product_name)) item.name = clean(row.product_name);
  }
};

export default attachOperationVariantLabels;
