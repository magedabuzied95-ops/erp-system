import db from "../database/db.js";

const text = (value) => String(value ?? "").trim();

export const ensureProductColorArticleCodeSchema = async (client = db) => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS product_color_groups (
      id BIGSERIAL PRIMARY KEY,
      tenant_id BIGINT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      color_group_key VARCHAR(160) NOT NULL DEFAULT '',
      color_name VARCHAR(255) NOT NULL DEFAULT '',
      color_article_code TEXT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.query(`ALTER TABLE product_color_groups ADD COLUMN IF NOT EXISTS color_group_key VARCHAR(160) NOT NULL DEFAULT ''`);
  await client.query(`DROP INDEX IF EXISTS product_color_groups_product_color_unique`);
  await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS product_color_groups_product_group_unique ON product_color_groups (product_id, LOWER(TRIM(color_group_key))) WHERE TRIM(color_group_key) <> ''`);
  await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS product_color_groups_product_legacy_color_unique ON product_color_groups (product_id, LOWER(TRIM(color_name))) WHERE TRIM(color_group_key) = ''`);
  await client.query(`CREATE INDEX IF NOT EXISTS product_color_groups_article_code_lower ON product_color_groups (LOWER(TRIM(color_article_code))) WHERE color_article_code IS NOT NULL AND TRIM(color_article_code) <> ''`);
};

export const loadProductColorArticleCodes = async (client = db, productIds = []) => {
  const ids = [...new Set(productIds.map(Number).filter((id) => Number.isFinite(id) && id > 0))];
  if (!ids.length) return new Map();
  const result = await client.query(`SELECT product_id, color_group_key, color_name, color_article_code FROM product_color_groups WHERE product_id = ANY($1::bigint[])`, [ids]);
  const map = new Map();
  for (const row of result.rows) {
    const groupKey = text(row.color_group_key).toLowerCase();
    if (groupKey) map.set(`${row.product_id}:group:${groupKey}`, text(row.color_article_code));
    const colorKey = `${row.product_id}:${text(row.color_name).toLowerCase()}`;
    if (!map.has(colorKey)) map.set(colorKey, text(row.color_article_code));
  }
  return map;
};

export const replaceProductColorArticleCodes = async (client, { tenantId, productId, colorGroups = [] }) => {
  const normalized = new Map();
  for (const group of colorGroups) {
    const color = text(group.color_name ?? group.colorName ?? group.color_value ?? group.colorValue ?? group.color);
    if (!color) continue;
    const groupKey = text(group.color_group_key ?? group.colorGroupKey ?? group.id);
    normalized.set(groupKey ? `group:${groupKey.toLowerCase()}` : `color:${color.toLowerCase()}`, {
      groupKey,
      color,
      code: text(group.color_article_code ?? group.colorArticleCode ?? group.article_code ?? group.articleCode),
    });
  }
  await client.query(`DELETE FROM product_color_groups WHERE product_id = $1`, [productId]);
  for (const { groupKey, color, code } of normalized.values()) {
    await client.query(
      `INSERT INTO product_color_groups (tenant_id, product_id, color_group_key, color_name, color_article_code) VALUES ($1, $2, $3, $4, NULLIF($5, ''))`,
      [tenantId ?? null, productId, groupKey, color, code]
    );
  }
};

export const attachColorArticleCodes = (product, codeMap) => {
  const productId = product?.id ?? product?.product_id;
  const codeFor = (color, groupKey = "") => codeMap.get(`${productId}:group:${text(groupKey).toLowerCase()}`) || codeMap.get(`${productId}:${text(color).toLowerCase()}`) || "";
  const variants = (product?.variants || []).map((variant) => {
    const colorArticleCode = codeFor(variant.color ?? variant.color_name, variant.color_group_key ?? variant.colorGroupKey);
    return { ...variant, color_article_code: colorArticleCode, colorArticleCode };
  });
  const colorImages = (product?.color_images || []).map((group) => {
    const colorArticleCode = codeFor(group.color ?? group.color_name ?? group.color_value, group.color_group_key ?? group.colorGroupKey);
    return { ...group, color_article_code: colorArticleCode, colorArticleCode, article_code: colorArticleCode, articleCode: colorArticleCode };
  });
  return { ...product, variants, color_images: colorImages };
};
