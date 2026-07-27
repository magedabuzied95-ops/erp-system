import db from "../database/db.js";
import { indexProductImagesForProduct } from "./aiVisualProductImageIndexService.js";

const toText = (value = "") => String(value || "").trim();
const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const toNullableForeignKey = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
};

const toBool = (value) => value === true || value === 1 || value === "1" || String(value || "").toLowerCase() === "true";
let productVariantImagesSchemaPromise = null;
let productVariantImagesSchemaEnsured = false;
const tableColumnsCache = new Map();
const MAX_IMAGE_URL_LENGTH = Number(process.env.PRODUCT_VARIANT_IMAGE_URL_MAX_LENGTH || 4096);
const IMAGE_LOG_PREFIX_LENGTH = 96;

const summarizeImageValue = (value) => {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  const normalized = String(text || "");
  return {
    length: normalized.length,
    preview: normalized.slice(0, IMAGE_LOG_PREFIX_LENGTH),
  };
};

const isLikelyUrlString = (value = "") => /^(https?:\/\/|\/\/|\/)/i.test(String(value || "").trim());

const logInvalidImageCandidate = (reason, value, extra = {}) => {
  const summary = summarizeImageValue(value);
  console.warn("PRODUCT_VARIANT_IMAGE_INVALID", {
    reason,
    image_length: summary.length,
    image_start: summary.preview,
    ...extra,
  });
};

const extractNormalizedImageUrl = (image, fallback = {}) => {
  const candidates = [];
  if (typeof image === "string") {
    candidates.push(image);
  } else if (image && typeof image === "object") {
    candidates.push(
      image.secure_url,
      image.url,
      image.image_url,
      image.imageUrl,
      image.preview,
      image.path,
      image.file_path,
      image.image,
      image.photo_url,
      image.thumbnail_url
    );
  }
  candidates.push(
    fallback.secure_url,
    fallback.url,
    fallback.image_url,
    fallback.imageUrl,
    fallback.preview,
    fallback.path,
    fallback.file_path,
    fallback.image,
    fallback.photo_url,
    fallback.thumbnail_url
  );

  for (const candidate of candidates) {
    const imageUrl = toText(candidate);
    if (!imageUrl) continue;
    if (/^data:image\//i.test(imageUrl)) {
      logInvalidImageCandidate("data_image_url", imageUrl, {
        product_id: fallback.product_id ?? image?.product_id ?? null,
        variant_id: fallback.variant_id ?? image?.variant_id ?? null,
        color_name: toText(fallback.color_name || image?.color_name || image?.color || ""),
      });
      return null;
    }
    if (imageUrl.length > MAX_IMAGE_URL_LENGTH) {
      logInvalidImageCandidate("image_url_too_long", imageUrl, {
        product_id: fallback.product_id ?? image?.product_id ?? null,
        variant_id: fallback.variant_id ?? image?.variant_id ?? null,
        color_name: toText(fallback.color_name || image?.color_name || image?.color || ""),
      });
      return null;
    }
    if (!isLikelyUrlString(imageUrl)) {
      logInvalidImageCandidate("non_url_image_value", imageUrl, {
        product_id: fallback.product_id ?? image?.product_id ?? null,
        variant_id: fallback.variant_id ?? image?.variant_id ?? null,
        color_name: toText(fallback.color_name || image?.color_name || image?.color || ""),
      });
      return null;
    }
    return imageUrl;
  }

  return null;
};

const imageRecordKeys = (record = {}) => {
  const keys = [];
  const id = toText(record.id);
  const imageUrl = toText(record.image_url || record.imageUrl || record.url || record.path || record.file_path);
  const groupKey = toText(record.color_group_key || record.colorGroupKey).toLowerCase();
  const color = toText(record.color_name || record.color_value || record.color).toLowerCase();
  const productId = toText(record.product_id);
  const variantId = toText(record.variant_id);
  const name = toText(record.name || record.file_name);
  const size = toText(record.size || record.file_size);
  const generatedByAi = toBool(record.generated_by_ai ?? record.generatedByAi);

  if (id) keys.push(`id:${id}`);
  if (imageUrl) {
    keys.push(`${groupKey ? `group:${groupKey}` : "ungrouped"}:url:${imageUrl.toLowerCase()}`);
    keys.push(`product-group-color-url:${productId}:${groupKey}:${color}:${imageUrl.toLowerCase()}:${generatedByAi ? "ai" : "orig"}`);
    if (variantId) keys.push(`variant-url:${variantId}:${imageUrl.toLowerCase()}:${generatedByAi ? "ai" : "orig"}`);
  }
  if (name && size) keys.push(`file:${name.toLowerCase()}:${size}`);

  return keys;
};

export const dedupeImages = (images = []) => {
  const seen = new Set();
  const unique = [];

  for (const image of Array.isArray(images) ? images : []) {
    const keys = imageRecordKeys(image);
    if (keys.length > 0 && keys.some((key) => seen.has(key))) continue;
    keys.forEach((key) => seen.add(key));
    unique.push(image);
  }

  return unique;
};

const getClient = async (clientOrPool = db) => {
  if (clientOrPool && typeof clientOrPool.query === "function" && typeof clientOrPool.release === "function") {
    return { client: clientOrPool, release: false };
  }
  if (clientOrPool && typeof clientOrPool.query === "function") {
    return { client: clientOrPool, release: false };
  }
  const client = await db.connect();
  return { client, release: true };
};

const getTableColumns = async (client, tableName) => {
  if (tableColumnsCache.has(tableName)) return tableColumnsCache.get(tableName);
  const result = await client.query(
    `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = $1
    `,
    [tableName]
  );
  const columns = new Set(result.rows.map((row) => row.column_name));
  tableColumnsCache.set(tableName, columns);
  return columns;
};

const normalizeImageInput = (image = {}, fallback = {}) => {
  if (typeof image === "string") {
    const imageUrl = extractNormalizedImageUrl(image, fallback);
    if (!imageUrl) return null;
    return {
      id: null,
      product_id: toNullableForeignKey(fallback.product_id),
      variant_id: toNullableForeignKey(fallback.variant_id),
      color_group_key: toText(fallback.color_group_key || fallback.colorGroupKey || ""),
      color_name: toText(fallback.color_name || fallback.color || ""),
      color_value: toText(fallback.color_value || fallback.color || ""),
      image_url: imageUrl,
      sort_order: fallback.sort_order ?? 0,
      is_primary: Boolean(fallback.is_primary),
    };
  }

  const imageUrl = extractNormalizedImageUrl(image, fallback);
  if (!imageUrl) return null;

  return {
    id: image.id ?? null,
    product_id: toNullableForeignKey(image.product_id ?? fallback.product_id),
    variant_id: toNullableForeignKey(image.variant_id ?? fallback.variant_id),
    color_group_key: toText(image.color_group_key || image.colorGroupKey || fallback.color_group_key || fallback.colorGroupKey || ""),
    color_name: toText(image.color_name || image.colorName || image.color || fallback.color_name || fallback.color || ""),
    color_value: toText(image.color_value || image.colorValue || image.color || fallback.color_value || fallback.color || ""),
    image_url: imageUrl,
    sort_order: toNumber(image.sort_order ?? image.sortOrder ?? fallback.sort_order ?? 0, 0),
    is_primary: toBool(image.is_primary ?? image.isPrimary ?? fallback.is_primary ?? false),
    generated_by_ai: toBool(image.generated_by_ai ?? image.generatedByAi ?? fallback.generated_by_ai ?? false),
  };
};

export const ensureProductVariantImagesSchema = async (clientOrPool = db) => {
  if (productVariantImagesSchemaEnsured) return;
  if (clientOrPool === db && productVariantImagesSchemaPromise) return productVariantImagesSchemaPromise;
  const runEnsure = async () => {
  const { client, release } = await getClient(clientOrPool);
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS product_variant_images (
        id BIGSERIAL PRIMARY KEY,
        tenant_id BIGINT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        variant_id BIGINT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
        color_group_key VARCHAR(160) NOT NULL DEFAULT '',
        color_name VARCHAR(255) NOT NULL DEFAULT '',
        color_value VARCHAR(255) NOT NULL DEFAULT '',
        image_url TEXT NOT NULL DEFAULT '',
        sort_order INTEGER NOT NULL DEFAULT 0,
        is_primary BOOLEAN NOT NULL DEFAULT FALSE,
        generated_by_ai BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await client.query(`ALTER TABLE product_variant_images ADD COLUMN IF NOT EXISTS tenant_id BIGINT NULL REFERENCES tenants(id) ON DELETE CASCADE`);
    await client.query(`ALTER TABLE product_variant_images ADD COLUMN IF NOT EXISTS generated_by_ai BOOLEAN NOT NULL DEFAULT FALSE`);
    await client.query(`ALTER TABLE product_variant_images ADD COLUMN IF NOT EXISTS color_group_key VARCHAR(160) NOT NULL DEFAULT ''`);
    tableColumnsCache.delete("product_variant_images");
    await client.query(`
      UPDATE product_variant_images pvi
      SET color_group_key = pv.color_group_key
      FROM product_variants pv
      WHERE pvi.variant_id = pv.id
        AND TRIM(COALESCE(pvi.color_group_key, '')) = ''
        AND TRIM(COALESCE(pv.color_group_key, '')) <> ''
    `);
    await client.query(`
      UPDATE product_variant_images pvi
      SET color_group_key = COALESCE((
        SELECT pv.color_group_key
        FROM product_variants pv
        WHERE pv.product_id = pvi.product_id
          AND LOWER(TRIM(COALESCE(pv.color, ''))) = LOWER(TRIM(COALESCE(pvi.color_name, pvi.color_value, '')))
          AND LOWER(TRIM(COALESCE(pv.image_url, ''))) = LOWER(TRIM(COALESCE(pvi.image_url, '')))
          AND TRIM(COALESCE(pv.color_group_key, '')) <> ''
        ORDER BY pv.id ASC
        LIMIT 1
      ), 'legacy-' || SUBSTRING(MD5(pvi.product_id::text || '|' || LOWER(TRIM(COALESCE(pvi.color_name, pvi.color_value, ''))) || '|' || LOWER(TRIM(COALESCE(pvi.image_url, '')))), 1, 32))
      WHERE TRIM(COALESCE(pvi.color_group_key, '')) = ''
    `);
    await client.query(`
      UPDATE product_variant_images pvi
      SET tenant_id = p.tenant_id
      FROM products p
      WHERE pvi.product_id = p.id
        AND pvi.tenant_id IS NULL
        AND p.tenant_id IS NOT NULL
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_product_variant_images_tenant_product_color ON product_variant_images (tenant_id, product_id, color_name, sort_order, id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_product_variant_images_tenant_variant ON product_variant_images (tenant_id, variant_id, sort_order, id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_product_variant_images_tenant_primary ON product_variant_images (tenant_id, product_id, color_name, is_primary)`);
    await client.query(`
      DELETE FROM product_variant_images target
      USING product_variant_images duplicate
      WHERE target.id > duplicate.id
        AND target.product_id = duplicate.product_id
        AND LOWER(TRIM(target.color_group_key)) = LOWER(TRIM(duplicate.color_group_key))
        AND LOWER(TRIM(target.color_name)) = LOWER(TRIM(duplicate.color_name))
        AND LOWER(TRIM(target.image_url)) = LOWER(TRIM(duplicate.image_url))
        AND TRIM(target.image_url) <> ''
    `);
    await client.query(`
      DELETE FROM product_variant_images target
      USING product_variant_images duplicate
      WHERE target.id > duplicate.id
        AND target.product_id = duplicate.product_id
        AND LOWER(TRIM(target.color_group_key)) = LOWER(TRIM(duplicate.color_group_key))
        AND COALESCE(target.variant_id, 0) = COALESCE(duplicate.variant_id, 0)
        AND LOWER(TRIM(target.color_name)) = LOWER(TRIM(duplicate.color_name))
        AND LOWER(TRIM(target.image_url)) = LOWER(TRIM(duplicate.image_url))
        AND TRIM(target.image_url) <> ''
    `);
    await client.query(`DROP INDEX IF EXISTS product_variant_images_unique_variant_url`);
    await client.query(`DROP INDEX IF EXISTS product_variant_images_unique_tenant_variant_url`);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS product_variant_images_unique_tenant_variant_url
      ON product_variant_images (tenant_id, product_id, COALESCE(variant_id, 0), LOWER(TRIM(color_group_key)), LOWER(TRIM(color_name)), LOWER(TRIM(image_url)))
      WHERE TRIM(image_url) <> ''
    `);
  } finally {
    if (release) client.release();
  }
  };
  if (clientOrPool !== db) return runEnsure();
  productVariantImagesSchemaPromise = runEnsure()
    .then(() => {
      productVariantImagesSchemaEnsured = true;
    })
    .catch((error) => {
      productVariantImagesSchemaPromise = null;
      throw error;
    });
  return productVariantImagesSchemaPromise;
};

const collectColorImageRecords = (entry = {}, fallback = {}) => {
  const images = Array.isArray(entry.images) ? entry.images : Array.isArray(entry.color_images) ? entry.color_images : [];
  const base = {
    product_id: entry.product_id ?? fallback.product_id ?? null,
    variant_id: entry.variant_id ?? fallback.variant_id ?? null,
    color_group_key: toText(entry.color_group_key || entry.colorGroupKey || fallback.color_group_key || fallback.colorGroupKey || ""),
    color_name: toText(entry.color_name || entry.colorName || entry.color || fallback.color_name || fallback.color || ""),
    color_value: toText(entry.color_value || entry.colorValue || entry.color || fallback.color_value || fallback.color || ""),
  };

  const normalized = images
    .map((image, index) =>
      normalizeImageInput(image, {
        ...base,
        sort_order: image?.sort_order ?? image?.sortOrder ?? index,
        is_primary: image?.is_primary ?? image?.isPrimary ?? index === 0,
      })
    )
    .filter(Boolean);

  if (!normalized.length) {
    const fallbackImage = normalizeImageInput(entry.image_url || entry.variant_image_url || entry.color_image_url, {
      ...base,
      sort_order: 0,
      is_primary: true,
    });
    if (fallbackImage) normalized.push(fallbackImage);
  }

  return normalized;
};

export const collectProductVariantImagesFromPayload = ({ productId = null, variants = [], colorImages = [] } = {}) => {
  const records = [];

  for (const group of Array.isArray(colorImages) ? colorImages : []) {
    records.push(
      ...collectColorImageRecords(group, {
        product_id: productId,
        color_group_key: group.color_group_key || group.colorGroupKey || group.id || "",
        color_name: group.color_name || group.colorName || group.color || "",
        color_value: group.color_value || group.colorValue || group.color || "",
      })
    );
  }

  for (const variant of Array.isArray(variants) ? variants : []) {
    const variantImages = Array.isArray(variant.images) ? variant.images : Array.isArray(variant.color_images) ? variant.color_images : [];
    if (variantImages.length > 0) {
      records.push(
        ...variantImages
          .map((image, index) =>
            normalizeImageInput(image, {
              product_id: productId,
              variant_id: variant.variant_id ?? variant.id ?? null,
              color_group_key: variant.color_group_key || variant.colorGroupKey || "",
              color_name: variant.color || "",
              color_value: variant.color || "",
              sort_order: image?.sort_order ?? image?.sortOrder ?? index,
              is_primary: image?.is_primary ?? image?.isPrimary ?? index === 0,
            })
          )
          .filter(Boolean)
      );
      continue;
    }

    const imageUrl = extractNormalizedImageUrl(variant, {
      product_id: productId,
      variant_id: variant.variant_id ?? variant.id ?? null,
      color_group_key: variant.color_group_key || variant.colorGroupKey || "",
      color_name: variant.color || "",
      color_value: variant.color || "",
    });
    if (!imageUrl) continue;

    records.push(
      normalizeImageInput(imageUrl, {
        product_id: productId,
        variant_id: variant.variant_id ?? variant.id ?? null,
        color_group_key: variant.color_group_key || variant.colorGroupKey || "",
        color_name: variant.color || "",
        color_value: variant.color || "",
        sort_order: 0,
        is_primary: true,
      })
    );
  }

  const dedupedRecords = dedupeImages(records.filter(Boolean));
  const collapsedByColorUrl = new Map();

  for (const record of dedupedRecords) {
    const groupKey = toText(record.color_group_key).toLowerCase();
    const colorKey = toText(record.color_name || record.color_value).toLowerCase();
    const imageKey = toText(record.image_url).toLowerCase();
    const groupingKey = groupKey || colorKey
      ? `${toText(record.product_id)}:${groupKey || `color:${colorKey}`}:${imageKey}`
      : `${toText(record.product_id)}:variant:${toText(record.variant_id)}:${imageKey}`;
    const existing = collapsedByColorUrl.get(groupingKey);
    if (!existing) {
      collapsedByColorUrl.set(groupingKey, {
        ...record,
        variantIds: record.variant_id ? new Set([String(record.variant_id)]) : new Set(),
        hasColorLevelRecord: record.variant_id === null || record.variant_id === undefined || record.variant_id === "",
      });
      continue;
    }

    if (record.variant_id) existing.variantIds.add(String(record.variant_id));
    existing.hasColorLevelRecord =
      existing.hasColorLevelRecord ||
      record.variant_id === null ||
      record.variant_id === undefined ||
      record.variant_id === "";
    existing.sort_order = Math.min(
      Number(existing.sort_order ?? Number.MAX_SAFE_INTEGER),
      Number(record.sort_order ?? Number.MAX_SAFE_INTEGER)
    );
    existing.is_primary = Boolean(existing.is_primary || record.is_primary);
    existing.generated_by_ai = Boolean(existing.generated_by_ai || record.generated_by_ai);
  }

  return Array.from(collapsedByColorUrl.values()).map((record, index) => {
    const { variantIds, hasColorLevelRecord, ...persistedRecord } = record;
    return {
      ...persistedRecord,
      variant_id:
        hasColorLevelRecord || variantIds.size !== 1
          ? null
          : Number(Array.from(variantIds)[0]) || null,
      sort_order: Number.isFinite(Number(persistedRecord.sort_order)) ? Number(persistedRecord.sort_order) : index,
      is_primary: Boolean(persistedRecord.is_primary),
    };
  });
};

export const replaceProductVariantImages = async (clientOrPool, { tenantId = null, productId, variants = [], colorImages = [] } = {}) => {
  const records = collectProductVariantImagesFromPayload({ productId, variants, colorImages });
  const { client, release } = await getClient(clientOrPool);
  try {
    const columns = await getTableColumns(client, "product_variant_images");
    let effectiveTenantId = tenantId;
    if (!effectiveTenantId && columns.has("tenant_id")) {
      const tenantResult = await client.query("SELECT tenant_id FROM products WHERE id = $1 LIMIT 1", [productId]);
      effectiveTenantId = tenantResult.rows[0]?.tenant_id || null;
    }
    if (columns.has("tenant_id") && !effectiveTenantId) {
      throw Object.assign(new Error("Tenant context missing"), { status: 400, code: "TENANT_CONTEXT_MISSING" });
    }

    if (columns.has("tenant_id")) {
      await client.query("DELETE FROM product_variant_images WHERE product_id = $1 AND tenant_id = $2", [productId, effectiveTenantId]);
    } else {
      await client.query("DELETE FROM product_variant_images WHERE product_id = $1", [productId]);
    }
    if (!records.length) {
      await indexProductImagesForProduct(client, { productId }).catch((error) => {
        console.warn("[ai-visual-index] product image indexing skipped", {
          product_id: productId,
          message: error?.message || "indexing failed",
        });
      });
      return [];
    }
    const insertableRecords = records
      .map((record, index) => {
        const normalizedImageUrl = extractNormalizedImageUrl(record.image_url, record);
        if (!normalizedImageUrl) return null;
        return {
          tenant_id: effectiveTenantId,
          product_id: productId,
          variant_id: toNullableForeignKey(record.variant_id),
          color_group_key: record.color_group_key || "",
          color_name: record.color_name || "",
          color_value: record.color_value || "",
          image_url: normalizedImageUrl,
          sort_order: Number(record.sort_order ?? index ?? 0),
          is_primary: Boolean(record.is_primary),
          generated_by_ai: Boolean(record.generated_by_ai),
        };
      })
      .filter(Boolean);

    const rows = [];
    if (insertableRecords.length > 0) {
      const values = [];
      const placeholders = insertableRecords.map((record, recordIndex) => {
        const offset = recordIndex * 10;
        values.push(
          record.tenant_id,
          record.product_id,
          record.variant_id,
          record.color_group_key,
          record.color_name,
          record.color_value,
          record.image_url,
          record.sort_order,
          record.is_primary,
          record.generated_by_ai
        );
        return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10})`;
      });
      const result = await client.query(
        `
        INSERT INTO product_variant_images (
          tenant_id,
          product_id,
          variant_id,
          color_group_key,
          color_name,
          color_value,
          image_url,
          sort_order,
          is_primary,
          generated_by_ai
        )
        VALUES ${placeholders.join(", ")}
        RETURNING *
        `,
        values
      );
      rows.push(...(result.rows || []));
    }
    await indexProductImagesForProduct(client, { productId }).catch((error) => {
      console.warn("[ai-visual-index] product image indexing skipped", {
        product_id: productId,
        message: error?.message || "indexing failed",
      });
    });
    return rows;
  } finally {
    if (release) client.release();
  }
};

export const loadProductVariantImages = async (clientOrPool, productIds = []) => {
  const ids = [...new Set((Array.isArray(productIds) ? productIds : [productIds]).map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0))];
  if (!ids.length) return new Map();
  const { client, release } = await getClient(clientOrPool);
  try {
    const result = await client.query(
      `
      SELECT *
      FROM product_variant_images
      WHERE product_id = ANY($1::bigint[])
      ORDER BY product_id ASC, color_name ASC, is_primary DESC, sort_order ASC, id ASC
      `,
      [ids]
    );
    const grouped = new Map();
    for (const row of result.rows || []) {
      const productId = String(row.product_id);
      if (!grouped.has(productId)) {
        grouped.set(productId, { byGroup: new Map(), byColor: new Map(), byVariant: new Map(), rows: [] });
      }
      const bundle = grouped.get(productId);
      const normalized = {
        id: row.id,
        product_id: row.product_id,
        variant_id: row.variant_id ?? null,
        color_group_key: row.color_group_key || "",
        color_name: row.color_name || "",
        color_value: row.color_value || "",
        image_url: row.image_url || "",
        sort_order: Number(row.sort_order || 0),
        is_primary: Boolean(row.is_primary),
        generated_by_ai: Boolean(row.generated_by_ai),
        created_at: row.created_at || null,
      };
      bundle.rows.push(normalized);
      const groupKey = toText(normalized.color_group_key).toLowerCase();
      if (groupKey) {
        if (!bundle.byGroup.has(groupKey)) bundle.byGroup.set(groupKey, []);
        bundle.byGroup.get(groupKey).push(normalized);
      }
      const colorKey = toText(normalized.color_name || normalized.color_value).toLowerCase();
      if (colorKey) {
        if (!bundle.byColor.has(colorKey)) bundle.byColor.set(colorKey, []);
        bundle.byColor.get(colorKey).push(normalized);
      }
      if (normalized.variant_id !== null && normalized.variant_id !== undefined && normalized.variant_id !== "") {
        const variantKey = String(normalized.variant_id);
        if (!bundle.byVariant.has(variantKey)) bundle.byVariant.set(variantKey, []);
        bundle.byVariant.get(variantKey).push(normalized);
      }
    }
    return grouped;
  } finally {
    if (release) client.release();
  }
};

export const attachVariantImages = (variants = [], imageBundle = null) => {
  const rows = Array.isArray(variants) ? variants : [];
  if (!imageBundle) {
    return rows.map((variant) => ({
      ...variant,
      images: Array.isArray(variant.images) ? variant.images : [],
    }));
  }

  return rows.map((variant) => {
    const variantKey = String(variant.id ?? variant.variant_id ?? "");
    const groupKey = toText(variant.color_group_key || variant.colorGroupKey).toLowerCase();
    const colorKey = toText(variant.color || variant.color_name).toLowerCase();
    const colorImages = groupKey
      ? imageBundle.byGroup?.get(groupKey) || []
      : colorKey ? imageBundle.byColor.get(colorKey) || [] : [];
    const variantImages = variantKey ? imageBundle.byVariant.get(variantKey) || [] : [];
    const allImages = dedupeImages([...variantImages, ...colorImages])
      .reduce((acc, item) => {
        const key = `${item.product_id}:${toText(item.color_group_key).toLowerCase()}:${toText(item.color_name).toLowerCase()}:${toText(item.image_url).toLowerCase()}`;
        if (!acc.some((existing) => `${existing.product_id}:${toText(existing.color_group_key).toLowerCase()}:${toText(existing.color_name).toLowerCase()}:${toText(existing.image_url).toLowerCase()}` === key)) {
          acc.push(item);
        }
        return acc;
      }, [])
      .sort((a, b) => (b.is_primary === true) - (a.is_primary === true) || Number(a.sort_order || 0) - Number(b.sort_order || 0) || Number(a.id || 0) - Number(b.id || 0));
    const primary = allImages.find((item) => item.is_primary) || allImages[0] || null;
    const stableColorGroupKey = groupKey || toText(primary?.color_group_key || primary?.colorGroupKey || "");
    return {
      ...variant,
      color_group_key: stableColorGroupKey,
      colorGroupKey: stableColorGroupKey,
      images: allImages,
      image_url: variant.image_url || primary?.image_url || "",
      variant_image_url: variant.variant_image_url || primary?.image_url || variant.image_url || "",
      color_image_url: variant.color_image_url || primary?.image_url || variant.image_url || "",
      colorPrimaryImageUrl: variant.colorPrimaryImageUrl || primary?.image_url || variant.image_url || "",
      thermal_image_url: variant.thermal_image_url || variant.variant_color_thermal_image_url || variant.color_thermal_image_url || "",
      color_thermal_image_url: variant.color_thermal_image_url || variant.variant_color_thermal_image_url || variant.thermal_image_url || "",
      variant_color_thermal_image_url: variant.variant_color_thermal_image_url || variant.color_thermal_image_url || variant.thermal_image_url || "",
      product_thermal_image_url: variant.product_thermal_image_url || "",
      primary_image_url: primary?.image_url || variant.image_url || "",
    };
  });
};

export const attachGroupedColorImages = (colors = [], imageBundle = null) => {
  const rows = Array.isArray(colors) ? colors : [];
  return rows.map((color) => {
    const groupKey = toText(color.color_group_key || color.colorGroupKey).toLowerCase();
    const colorKey = toText(color.color || color.color_name).toLowerCase();
    const images = imageBundle
      ? groupKey ? imageBundle.byGroup?.get(groupKey) || [] : colorKey ? imageBundle.byColor.get(colorKey) || [] : []
      : [];
    const uniqueImages = dedupeImages(images);
    const primary = uniqueImages.find((item) => item.is_primary) || uniqueImages[0] || null;
    const stableColorGroupKey = groupKey || toText(primary?.color_group_key || primary?.colorGroupKey || "").toLowerCase();
    return {
      ...color,
      color_group_key: stableColorGroupKey,
      colorGroupKey: stableColorGroupKey,
      images: uniqueImages,
      image_url: color.image_url || primary?.image_url || "",
      colorPrimaryImageUrl: color.colorPrimaryImageUrl || primary?.image_url || color.image_url || "",
      color_image_url: color.color_image_url || primary?.image_url || color.image_url || "",
      thermal_image_url: color.thermal_image_url || color.variant_color_thermal_image_url || color.color_thermal_image_url || "",
      color_thermal_image_url: color.color_thermal_image_url || color.variant_color_thermal_image_url || color.thermal_image_url || "",
      variant_color_thermal_image_url: color.variant_color_thermal_image_url || color.color_thermal_image_url || color.thermal_image_url || "",
      product_thermal_image_url: color.product_thermal_image_url || "",
      primary_image_url: primary?.image_url || color.image_url || "",
    };
  });
};
