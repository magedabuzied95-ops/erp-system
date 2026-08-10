import db from "../database/db.js";
import { loadProductsWithVariantsPayload } from "../controllers/productsController.js";

const clean = (value = "") => String(value || "").trim();
const lower = (value = "") => clean(value).toLowerCase();
const truthy = (value) => ["1", "true", "yes", "on"].includes(lower(value));
const toPositiveInt = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const firstNonEmpty = (...values) => values.map((value) => clean(value)).find(Boolean) || "";

const addCondition = (conditions, values, sql, value) => {
  values.push(value);
  conditions.push(sql.replaceAll("{value}", `$${values.length}`));
};

const normalizeVariant = (row = {}, product = {}) => {
  const stock = Math.max(0, Number(row.stock ?? row.stock_quantity ?? 0));
  const imageUrl = firstNonEmpty(
    row.variant_image_url,
    row.image_url,
    row.photo_url,
    row.thumbnail_url,
    product.image_url,
    product.photo_url,
    product.thumbnail_url,
    product.image,
    product.product_image_url
  );

  return {
    id: row.variant_id ?? row.id ?? null,
    variant_id: row.variant_id ?? row.id ?? null,
    product_id: row.product_id ?? product.id ?? null,
    color: clean(row.color || ""),
    size: clean(row.size || ""),
    sku: clean(row.sku || ""),
    barcode: clean(row.barcode || ""),
    article_code: clean(row.article_code || row.product_code || product.article_code || product.product_code || ""),
    manufacturer_name: clean(row.manufacturer_name || product.manufacturer_name || ""),
    stock,
    price: Number(row.price ?? row.sale_price ?? row.selling_price ?? product.sale_price ?? product.price ?? 0),
    image_url: imageUrl,
    variant_image_url: imageUrl,
  };
};

const normalizeProduct = (row = {}, variants = []) => {
  const productImage = firstNonEmpty(
    row.product_image_url,
    row.image_url,
    row.photo_url,
    row.thumbnail_url,
    row.image,
    variants.find((variant) => variant.image_url)?.image_url,
    variants[0]?.image_url
  );
  const colors = [];
  const colorSeen = new Set();
  const sizes = [];
  const sizeSeen = new Set();

  for (const variant of variants) {
    const colorKey = lower(variant.color);
    if (variant.color && !colorSeen.has(colorKey)) {
      colorSeen.add(colorKey);
      colors.push(variant.color);
    }
    const sizeKey = lower(variant.size);
    if (variant.size && !sizeSeen.has(sizeKey)) {
      sizeSeen.add(sizeKey);
      sizes.push(variant.size);
    }
  }

  const totalStock = variants.reduce((sum, variant) => sum + Math.max(0, Number(variant.stock || 0)), 0);

  return {
    id: row.id ?? null,
    product_id: row.id ?? null,
    name: clean(row.name || ""),
    product_name: clean(row.name || ""),
    sku: clean(row.sku || ""),
    barcode: clean(row.barcode || ""),
    product_code: clean(row.product_code || ""),
    article_code: clean(row.product_code || row.article_code || ""),
    manufacturer_name: clean(row.manufacturer_name || ""),
    category: clean(row.category || row.category_name || ""),
    brand: clean(row.brand || row.brand_name || ""),
    gender: clean(row.gender || ""),
    style: clean(row.style || row.product_type || ""),
    product_type: clean(row.product_type || row.style || ""),
    price: Number(row.sale_price ?? row.price ?? row.selling_price ?? 0),
    image_url: productImage,
    product_image_url: productImage,
    total_stock: totalStock,
    stock: totalStock,
    colors,
    sizes,
    variants,
  };
};

const buildLookupSelection = (products = [], query = {}) => {
  const directProductId = toPositiveInt(query.productId ?? query.product_id);
  const search = clean(query.search ?? query.q ?? "");
  const qrToken = clean(query.qr_token ?? query.qrToken ?? query.qr ?? "");
  const barcode = clean(query.barcode);
  const sku = clean(query.sku);
  const article = clean(query.article ?? query.article_code ?? query.articleCode);
  if (!directProductId && !search && !qrToken && !barcode && !sku && !article) return null;

  const resolveMatchedField = (fields = [], expected = "") => {
    const needle = clean(expected);
    if (!needle) return "";
    for (const [fieldName, value] of fields) {
      if (clean(value) === needle) return fieldName;
    }
    return "";
  };

  for (const product of products) {
    const productQrToken = clean(product.qr_token);
    const productBarcode = clean(product.barcode);
    const productSku = clean(product.sku);
    const productArticle = clean(product.product_code || product.article_code);
    const productCode = clean(product.code || product.product_code || "");

    if (directProductId && Number(product.id) === directProductId) {
      return {
        product_id: product.id,
        variant_id: null,
        color: "",
        size: "",
      };
    }

    const matchedVariant = (Array.isArray(product.variants) ? product.variants : []).find(
      (variant) => {
        const variantQrToken = clean(variant.qr_token);
        const variantBarcode = clean(variant.barcode);
        const variantSku = clean(variant.sku);
        const variantArticle = clean(variant.article_code);
        const variantCode = clean(variant.code || variant.product_code || "");
        return (
          (search && (variantQrToken === search || variantBarcode === search || variantSku === search || variantArticle === search || variantCode === search)) ||
          (qrToken && (variantQrToken === qrToken || variantBarcode === qrToken || variantSku === qrToken || variantArticle === qrToken || variantCode === qrToken)) ||
          (barcode && (variantBarcode === barcode || variantSku === barcode || variantArticle === barcode || variantCode === barcode)) ||
          (sku && (variantSku === sku || variantBarcode === sku || variantArticle === sku || variantCode === sku)) ||
          (article && variantArticle === article)
        );
      }
    );

    if (matchedVariant) {
      const matchedField = resolveMatchedField(
        [
          ["variant.qr_token", matchedVariant.qr_token],
          ["variant.barcode", matchedVariant.barcode],
          ["variant.sku", matchedVariant.sku],
          ["variant.article_code", matchedVariant.article_code],
          ["variant.product_code", matchedVariant.product_code || matchedVariant.code],
        ],
        search || qrToken || barcode || sku || article
      );
      console.info("[employee-portal-products:lookup-match]", {
        productId: product.id,
        variantId: matchedVariant.variant_id ?? matchedVariant.id ?? null,
        matchedBy: matchedField || "variant",
        matchedValue: search || qrToken || barcode || sku || article || "",
      });
      return {
        product_id: product.id,
        variant_id: matchedVariant.variant_id ?? matchedVariant.id ?? null,
        color: clean(matchedVariant.color || ""),
        size: clean(matchedVariant.size || ""),
      };
    }

    if (
      (search && (productQrToken === search || productBarcode === search || productSku === search || productArticle === search || productCode === search)) ||
      (qrToken && (productQrToken === qrToken || productBarcode === qrToken || productSku === qrToken || productArticle === qrToken || productCode === qrToken)) ||
      (barcode && (productBarcode === barcode || productSku === barcode || productArticle === barcode || productCode === barcode)) ||
      (sku && (productSku === sku || productBarcode === sku || productArticle === sku || productCode === sku)) ||
      (article && productArticle === article)
    ) {
      const matchedField = resolveMatchedField(
        [
          ["product.qr_token", product.qr_token],
          ["product.barcode", product.barcode],
          ["product.sku", product.sku],
          ["product.product_code", product.product_code],
          ["product.code", product.code],
        ],
        search || qrToken || barcode || sku || article
      );
      console.info("[employee-portal-products:lookup-match]", {
        productId: product.id,
        variantId: null,
        matchedBy: matchedField || "product",
        matchedValue: search || qrToken || barcode || sku || article || "",
      });
      return {
        product_id: product.id,
        variant_id: null,
        color: "",
        size: "",
      };
    }
  }

  return null;
};

const buildSearchClause = (values, search) => {
  const rawSearch = clean(search);
  if (!rawSearch) return "";

  values.push(rawSearch);
  const exactParam = `$${values.length}`;
  values.push(`%${rawSearch}%`);
  const partialParam = `$${values.length}`;

  return `(
    LOWER(TRIM(COALESCE(p.name, ''))) = LOWER(TRIM(${exactParam}))
    OR COALESCE(p.name, '') ILIKE ${partialParam}
    OR LOWER(TRIM(COALESCE(p.sku, ''))) = LOWER(TRIM(${exactParam}))
    OR COALESCE(p.sku, '') ILIKE ${partialParam}
    OR LOWER(TRIM(COALESCE(p.barcode, ''))) = LOWER(TRIM(${exactParam}))
    OR COALESCE(p.barcode, '') ILIKE ${partialParam}
    OR LOWER(TRIM(COALESCE(p.qr_token, ''))) = LOWER(TRIM(${exactParam}))
    OR COALESCE(p.qr_token, '') ILIKE ${partialParam}
    OR LOWER(TRIM(COALESCE(p.product_code, ''))) = LOWER(TRIM(${exactParam}))
    OR COALESCE(p.product_code, '') ILIKE ${partialParam}
    OR LOWER(TRIM(COALESCE(p.category, ''))) = LOWER(TRIM(${exactParam}))
    OR COALESCE(p.category, '') ILIKE ${partialParam}
    OR LOWER(TRIM(COALESCE(p.brand, ''))) = LOWER(TRIM(${exactParam}))
    OR COALESCE(p.brand, '') ILIKE ${partialParam}
    OR LOWER(TRIM(COALESCE(p.gender, ''))) = LOWER(TRIM(${exactParam}))
    OR COALESCE(p.gender, '') ILIKE ${partialParam}
    OR LOWER(TRIM(COALESCE(p.product_type, ''))) = LOWER(TRIM(${exactParam}))
    OR COALESCE(p.product_type, '') ILIKE ${partialParam}
    OR LOWER(TRIM(COALESCE(p.style, ''))) = LOWER(TRIM(${exactParam}))
    OR COALESCE(p.style, '') ILIKE ${partialParam}
    OR EXISTS (
      SELECT 1
      FROM product_variants pv
      WHERE pv.product_id = p.id
        AND pv.is_active IS DISTINCT FROM FALSE
        AND pv.deleted_at IS NULL
        AND (
          LOWER(TRIM(COALESCE(pv.color, ''))) = LOWER(TRIM(${exactParam}))
          OR COALESCE(pv.color, '') ILIKE ${partialParam}
          OR LOWER(TRIM(COALESCE(pv.size, ''))) = LOWER(TRIM(${exactParam}))
          OR COALESCE(pv.size, '') ILIKE ${partialParam}
          OR LOWER(TRIM(COALESCE(pv.sku, ''))) = LOWER(TRIM(${exactParam}))
          OR COALESCE(pv.sku, '') ILIKE ${partialParam}
          OR LOWER(TRIM(COALESCE(pv.barcode, ''))) = LOWER(TRIM(${exactParam}))
          OR COALESCE(pv.barcode, '') ILIKE ${partialParam}
          OR LOWER(TRIM(COALESCE(pv.article_code, ''))) = LOWER(TRIM(${exactParam}))
          OR COALESCE(pv.article_code, '') ILIKE ${partialParam}
        )
    )
  )`;
};

const loadPortalCatalog = async ({ employee = null, query = {} } = {}) => {
  const tenantId = employee?.tenant_id ?? null;
  const values = [tenantId];
  const conditions = ["(p.tenant_id IS NULL OR p.tenant_id = $1::bigint)"];

  const activeProductsOnly = `COALESCE(p.is_active, TRUE) = TRUE AND COALESCE(NULLIF(LOWER(TRIM(p.status)), ''), 'active') NOT IN ('inactive', 'disabled', 'archived', 'deleted', 'draft')`;
  conditions.push(activeProductsOnly);

  const search = clean(query.q ?? query.search ?? "");
  if (search) {
    conditions.push(buildSearchClause(values, search));
  }

  const category = clean(query.category);
  if (category && lower(category) !== "all") {
    addCondition(conditions, values, "LOWER(COALESCE(p.category, '')) = LOWER({value})", category);
  }

  const brand = clean(query.brand);
  if (brand && lower(brand) !== "all") {
    addCondition(conditions, values, "LOWER(COALESCE(p.brand, '')) = LOWER({value})", brand);
  }

  const gender = clean(query.gender);
  if (gender && lower(gender) !== "all") {
    addCondition(conditions, values, "LOWER(COALESCE(p.gender, '')) = LOWER({value})", gender);
  }

  const style = clean(query.style ?? query.type ?? "");
  if (style && lower(style) !== "all") {
    values.push(style);
    const token = `$${values.length}`;
    conditions.push(`(
      LOWER(COALESCE(p.style, '')) = LOWER(${token})
      OR LOWER(COALESCE(p.product_type, '')) = LOWER(${token})
    )`);
  }

  const color = clean(query.color);
  if (color && lower(color) !== "all") {
    values.push(color);
    const token = `$${values.length}`;
    conditions.push(`EXISTS (
      SELECT 1
      FROM product_variants pv
      WHERE pv.product_id = p.id
        AND pv.is_active IS DISTINCT FROM FALSE
        AND pv.deleted_at IS NULL
        AND LOWER(COALESCE(pv.color, '')) = LOWER(${token})
    )`);
  }

  const size = clean(query.size);
  if (size && lower(size) !== "all") {
    values.push(size);
    const token = `$${values.length}`;
    conditions.push(`EXISTS (
      SELECT 1
      FROM product_variants pv
      WHERE pv.product_id = p.id
        AND pv.is_active IS DISTINCT FROM FALSE
        AND pv.deleted_at IS NULL
        AND LOWER(COALESCE(pv.size, '')) = LOWER(${token})
    )`);
  }

  const requestedProductId = toPositiveInt(query.productId ?? query.product_id);
  if (requestedProductId) {
    addCondition(conditions, values, "p.id = {value}", requestedProductId);
  }

  const barcode = clean(query.barcode);
  if (barcode) {
    values.push(barcode);
    const token = `$${values.length}`;
    conditions.push(`(
      LOWER(TRIM(COALESCE(p.barcode, ''))) = LOWER(TRIM(${token}))
      OR LOWER(TRIM(COALESCE(p.product_code, ''))) = LOWER(TRIM(${token}))
      OR EXISTS (
        SELECT 1
        FROM product_variants pv
        WHERE pv.product_id = p.id
          AND pv.is_active IS DISTINCT FROM FALSE
          AND pv.deleted_at IS NULL
          AND (
            LOWER(TRIM(COALESCE(pv.barcode, ''))) = LOWER(TRIM(${token}))
            OR LOWER(TRIM(COALESCE(pv.article_code, ''))) = LOWER(TRIM(${token}))
          )
      )
    )`);
  }

  const qrToken = clean(query.qr_token ?? query.qrToken ?? query.qr ?? "");
  if (qrToken) {
    values.push(qrToken);
    const token = `$${values.length}`;
    conditions.push(`(
      LOWER(TRIM(COALESCE(p.qr_token, ''))) = LOWER(TRIM(${token}))
      OR COALESCE(p.qr_token, '') ILIKE ${token}
      OR LOWER(TRIM(COALESCE(p.barcode, ''))) = LOWER(TRIM(${token}))
      OR LOWER(TRIM(COALESCE(p.product_code, ''))) = LOWER(TRIM(${token}))
      OR EXISTS (
        SELECT 1
        FROM product_variants pv
        WHERE pv.product_id = p.id
          AND pv.is_active IS DISTINCT FROM FALSE
          AND pv.deleted_at IS NULL
          AND (
            LOWER(TRIM(COALESCE(pv.barcode, ''))) = LOWER(TRIM(${token}))
            OR LOWER(TRIM(COALESCE(pv.sku, ''))) = LOWER(TRIM(${token}))
            OR LOWER(TRIM(COALESCE(pv.article_code, ''))) = LOWER(TRIM(${token}))
          )
      )
    )`);
  }

  const article = clean(query.article ?? query.article_code ?? query.articleCode);
  if (article) {
    values.push(article);
    const token = `$${values.length}`;
    conditions.push(`(
      LOWER(TRIM(COALESCE(p.product_code, ''))) = LOWER(TRIM(${token}))
      OR EXISTS (
        SELECT 1
        FROM product_variants pv
        WHERE pv.product_id = p.id
          AND pv.is_active IS DISTINCT FROM FALSE
          AND pv.deleted_at IS NULL
          AND LOWER(TRIM(COALESCE(pv.article_code, ''))) = LOWER(TRIM(${token}))
      )
    )`);
  }

  const inStockOnly = query.inStockOnly === undefined && query.in_stock_only === undefined
    ? true
    : truthy(query.inStockOnly ?? query.in_stock_only);
  if (inStockOnly) {
    conditions.push(`EXISTS (
      SELECT 1
      FROM product_variants pv
      WHERE pv.product_id = p.id
        AND pv.is_active IS DISTINCT FROM FALSE
        AND pv.deleted_at IS NULL
        AND COALESCE(pv.stock, 0) > 0
    )`);
  }

  const limit = Math.min(Math.max(toPositiveInt(query.limit ?? query.per_page ?? query.perPage, 500), 1), 1000);
  values.push(limit);

  const productSql = `
    SELECT
      p.*,
      p.name AS product_name,
      p.product_code AS article_code,
      c.name AS category_name,
      b.name AS brand_name,
      m.name AS manufacturer_name,
      COALESCE(NULLIF(p.image_url, ''), NULLIF(p.image, ''), NULLIF(p.photo_url, ''), NULLIF(p.thumbnail_url, ''), '') AS product_image_url
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    LEFT JOIN brands b ON b.id = p.brand_id
    LEFT JOIN manufacturers m ON m.id = p.manufacturer_id
    WHERE ${conditions.join(" AND ")}
    ORDER BY p.updated_at DESC NULLS LAST, p.id DESC
    LIMIT $${values.length}
  `;

  const productsResult = await db.query(productSql, values);
  const baseProducts = Array.isArray(productsResult.rows) ? productsResult.rows : [];
  const productIds = baseProducts.map((row) => Number(row.id)).filter((id) => Number.isFinite(id) && id > 0);

  let variantRows = [];
  if (productIds.length) {
    const variantValues = [productIds];
    const variantConditions = [
      "v.product_id = ANY($1::bigint[])",
      "v.is_active IS DISTINCT FROM FALSE",
      "v.deleted_at IS NULL",
    ];
    if (inStockOnly) {
      variantConditions.push("COALESCE(v.stock, 0) > 0");
    }

    const variantsResult = await db.query(
      `
      SELECT
        v.*,
        v.id AS variant_id,
        v.product_id,
        m.name AS manufacturer_name,
        COALESCE(NULLIF(v.image_url, ''), NULLIF(v.image, ''), NULLIF(v.photo_url, ''), NULLIF(v.thumbnail_url, ''), NULLIF(p.image_url, ''), NULLIF(p.image, ''), NULLIF(p.photo_url, ''), NULLIF(p.thumbnail_url, ''), '') AS variant_image_url
      FROM product_variants v
      LEFT JOIN products p ON p.id = v.product_id
      LEFT JOIN manufacturers m ON m.id = v.manufacturer_id
      WHERE ${variantConditions.join(" AND ")}
      ORDER BY v.product_id DESC, v.id ASC
      `,
      variantValues
    );
    variantRows = Array.isArray(variantsResult.rows) ? variantsResult.rows : [];
  }

  const variantMap = new Map();
  for (const row of variantRows) {
    const key = String(row.product_id || "");
    if (!key) continue;
    if (!variantMap.has(key)) variantMap.set(key, []);
    variantMap.get(key).push(row);
  }

  const products = baseProducts.map((row) => {
    const rawVariants = variantMap.get(String(row.id)) || [];
    const variants = rawVariants.map((variantRow) => normalizeVariant(variantRow, row));
    return normalizeProduct(row, variants);
  });

  return {
    employee: employee
      ? {
          id: employee.id ?? null,
          full_name: employee.full_name || employee.name || "",
          employee_code: employee.employee_code || "",
          branch_id: employee.branch_id ?? null,
          branch_name: employee.branch_name || "",
        }
      : null,
    products,
    selection: buildLookupSelection(products, query),
  };
};

// ---------------------------------------------------------------------------
// Isolated COMPACT Employee Portal data path (Warehouse Request + Inventory
// facets). POS remains untouched. The Warehouse Request UI shows NO prices — it
// is product -> color -> size -> quantity — so these endpoints deliberately omit
// pricing and never fetch full variant arrays for the list.
// ---------------------------------------------------------------------------

const IN_STOCK_VARIANT = `pv.is_active IS DISTINCT FROM FALSE AND pv.deleted_at IS NULL`;

const buildCompactConditions = (query, values) => {
  const conditions = ["(p.tenant_id IS NULL OR p.tenant_id = $1::bigint)"];
  conditions.push(`COALESCE(p.is_active, TRUE) = TRUE AND COALESCE(NULLIF(LOWER(TRIM(p.status)), ''), 'active') NOT IN ('inactive', 'disabled', 'archived', 'deleted', 'draft')`);
  const search = clean(query.q ?? query.search ?? "");
  if (search) conditions.push(buildSearchClause(values, search));
  const category = clean(query.category);
  if (category && lower(category) !== "all") addCondition(conditions, values, "LOWER(COALESCE(p.category, '')) = LOWER({value})", category);
  const grade = clean(query.grade);
  if (grade && lower(grade) !== "all") addCondition(conditions, values, "LOWER(COALESCE(p.grade, '')) = LOWER({value})", grade);
  const brand = clean(query.brand);
  if (brand && lower(brand) !== "all") addCondition(conditions, values, "LOWER(COALESCE(p.brand, '')) = LOWER({value})", brand);
  const manufacturer = clean(query.manufacturer);
  if (manufacturer && lower(manufacturer) !== "all") addCondition(conditions, values, "LOWER(COALESCE(m.name, '')) = LOWER({value})", manufacturer);
  const gender = clean(query.gender);
  if (gender && lower(gender) !== "all") addCondition(conditions, values, "LOWER(COALESCE(p.gender, '')) = LOWER({value})", gender);
  const type = clean(query.product_type ?? query.type ?? query.style);
  if (type && lower(type) !== "all") {
    values.push(type);
    const token = `$${values.length}`;
    conditions.push(`(LOWER(COALESCE(p.product_type, '')) = LOWER(${token}) OR LOWER(COALESCE(p.style, '')) = LOWER(${token}))`);
  }
  const color = clean(query.color);
  if (color && lower(color) !== "all") {
    values.push(color);
    const token = `$${values.length}`;
    conditions.push(`EXISTS (SELECT 1 FROM product_variants pv WHERE pv.product_id = p.id AND ${IN_STOCK_VARIANT} AND LOWER(COALESCE(pv.color, '')) = LOWER(${token}))`);
  }
  const size = clean(query.size ?? query.selectedSize ?? query.selected_size);
  if (size && lower(size) !== "all") {
    values.push(size);
    const token = `$${values.length}`;
    conditions.push(`EXISTS (SELECT 1 FROM product_variants pv WHERE pv.product_id = p.id AND ${IN_STOCK_VARIANT} AND COALESCE(pv.stock, 0) > 0 AND LOWER(TRIM(COALESCE(pv.size, ''))) = LOWER(TRIM(${token})))`);
  }
  const inStockOnly = query.inStockOnly === undefined && query.in_stock_only === undefined ? true : truthy(query.inStockOnly ?? query.in_stock_only);
  if (inStockOnly) conditions.push(`EXISTS (SELECT 1 FROM product_variants pv WHERE pv.product_id = p.id AND ${IN_STOCK_VARIANT} AND COALESCE(pv.stock, 0) > 0)`);
  return conditions;
};

// Compact paginated product cards — NO variant arrays, NO images blobs, NO price.
export const loadEmployeePortalCompactProducts = async ({ employee = null, query = {} } = {}) => {
  const tenantId = employee?.tenant_id ?? null;
  const values = [tenantId];
  const conditions = buildCompactConditions(query, values);
  const page = toPositiveInt(query.page, 1);
  const limit = Math.min(Math.max(toPositiveInt(query.limit ?? query.per_page ?? query.perPage, 48), 1), 100);
  const offset = (page - 1) * limit;
  values.push(limit, offset);
  const limitToken = `$${values.length - 1}`;
  const offsetToken = `$${values.length}`;
  const sql = `
    SELECT
      p.id,
      p.name,
      COALESCE(NULLIF(b.name, ''), NULLIF(p.brand, '')) AS brand,
      COALESCE(NULLIF(p.product_type, ''), NULLIF(p.style, ''), NULLIF(p.category, '')) AS product_type,
      COALESCE(NULLIF(p.gender, ''), '') AS gender,
      COALESCE(NULLIF(p.grade, ''), '') AS grade,
      p.qr_token,
      COALESCE(NULLIF(p.image_url, ''), NULLIF(p.image, ''), NULLIF(p.photo_url, ''), NULLIF(p.thumbnail_url, ''), '') AS product_image_url
    FROM products p
    LEFT JOIN brands b ON b.id = p.brand_id
    LEFT JOIN manufacturers m ON m.id = p.manufacturer_id
    WHERE ${conditions.join(" AND ")}
    ORDER BY p.updated_at DESC NULLS LAST, p.id DESC
    LIMIT ${limitToken} OFFSET ${offsetToken}
  `;
  const result = await db.query(sql, values);
  const baseRows = result.rows || [];
  const productIds = baseRows.map((row) => Number(row.id)).filter((id) => Number.isFinite(id) && id > 0);

  // LEAN variants only (color/size/stock/image/ids/barcode) — preserves the
  // card-by-color/size expansion + selection + barcode match at a fraction of
  // the POS payload (no prices/blobs/duplicate images/timestamps).
  const variantsByProduct = new Map();
  if (productIds.length) {
    const vres = await db.query(
      `SELECT v.product_id, v.id AS variant_id, v.color, v.size, v.sku, v.barcode, v.article_code,
              COALESCE(v.stock, 0)::int AS stock,
              COALESCE(NULLIF(v.image_url, ''), NULLIF(v.image, ''), NULLIF(v.photo_url, ''), NULLIF(v.thumbnail_url, ''), '') AS image_url
       FROM product_variants v
       WHERE v.product_id = ANY($1::bigint[]) AND v.is_active IS DISTINCT FROM FALSE AND v.deleted_at IS NULL AND COALESCE(v.stock, 0) > 0
       ORDER BY v.product_id DESC, v.color ASC NULLS LAST, v.size ASC NULLS LAST, v.id ASC`,
      [productIds]
    );
    for (const r of vres.rows || []) {
      const key = String(r.product_id);
      if (!variantsByProduct.has(key)) variantsByProduct.set(key, []);
      variantsByProduct.get(key).push({
        id: Number(r.variant_id),
        variant_id: Number(r.variant_id),
        product_id: Number(r.product_id),
        color: clean(r.color),
        size: clean(r.size),
        sku: clean(r.sku),
        barcode: clean(r.barcode),
        article_code: clean(r.article_code),
        stock: Math.max(0, Number(r.stock) || 0),
        image_url: clean(r.image_url),
        variant_image_url: clean(r.image_url),
      });
    }
  }

  const products = baseRows.map((row) => {
    const variants = variantsByProduct.get(String(row.id)) || [];
    const productImage = clean(row.product_image_url) || (variants.find((v) => v.image_url)?.image_url || "");
    return {
      id: Number(row.id),
      product_id: Number(row.id),
      name: clean(row.name),
      brand: clean(row.brand),
      product_type: clean(row.product_type),
      type: clean(row.product_type),
      gender: clean(row.gender),
      grade: clean(row.grade),
      qr_token: clean(row.qr_token),
      image_url: productImage,
      product_image_url: productImage,
      total_stock: variants.reduce((s, v) => s + v.stock, 0),
      stock: variants.reduce((s, v) => s + v.stock, 0),
      colors: [...new Set(variants.map((v) => v.color).filter(Boolean))],
      sizes: [...new Set(variants.map((v) => v.size).filter(Boolean))],
      variants,
    };
  });
  return {
    employee: employee ? { id: employee.id ?? null, full_name: employee.full_name || employee.name || "", branch_id: employee.branch_id ?? null, branch_name: employee.branch_name || "" } : null,
    products,
    page,
    limit,
    has_more: products.length === limit,
  };
};

// Authoritative variants for ONE product (fetched only when a product is opened).
export const loadEmployeePortalProductVariants = async ({ employee = null, productId = null, inStockOnly = true } = {}) => {
  const tenantId = employee?.tenant_id ?? null;
  const pid = toPositiveInt(productId);
  if (!pid) return { product: null, variants: [] };
  const headerResult = await db.query(
    `SELECT p.id, p.name, COALESCE(NULLIF(b.name, ''), NULLIF(p.brand, '')) AS brand,
            COALESCE(NULLIF(p.image_url, ''), NULLIF(p.image, ''), NULLIF(p.photo_url, ''), NULLIF(p.thumbnail_url, ''), '') AS product_image_url
     FROM products p LEFT JOIN brands b ON b.id = p.brand_id
     WHERE p.id = $2::bigint AND (p.tenant_id IS NULL OR p.tenant_id = $1::bigint)
       AND COALESCE(p.is_active, TRUE) = TRUE AND COALESCE(NULLIF(LOWER(TRIM(p.status)), ''), 'active') NOT IN ('inactive', 'disabled', 'archived', 'deleted', 'draft')`,
    [tenantId, pid]
  );
  const header = headerResult.rows?.[0] || null;
  if (!header) return { product: null, variants: [] };
  const stockClause = inStockOnly ? "AND COALESCE(v.stock, 0) > 0" : "";
  const variantsResult = await db.query(
    `SELECT v.id AS variant_id, v.id, v.product_id, v.color, v.size, v.sku, v.barcode,
            v.article_code, COALESCE(v.stock, 0)::int AS stock,
            COALESCE(NULLIF(v.image_url, ''), NULLIF(v.image, ''), NULLIF(v.photo_url, ''), NULLIF(v.thumbnail_url, ''), $3::text) AS image_url
     FROM product_variants v
     WHERE v.product_id = $2::bigint AND v.is_active IS DISTINCT FROM FALSE AND v.deleted_at IS NULL ${stockClause}
     ORDER BY v.color ASC NULLS LAST, v.size ASC NULLS LAST, v.id ASC`,
    [tenantId, pid, clean(header.product_image_url)]
  );
  const variants = (variantsResult.rows || []).map((row) => ({
    id: Number(row.variant_id),
    variant_id: Number(row.variant_id),
    product_id: Number(row.product_id),
    color: clean(row.color),
    color_id: null,
    size: clean(row.size),
    sku: clean(row.sku),
    barcode: clean(row.barcode),
    article_code: clean(row.article_code),
    color_article_code: "",
    stock: Math.max(0, Number(row.stock) || 0),
    image_url: clean(row.image_url),
    variant_image_url: clean(row.image_url),
  }));
  return {
    product: { id: Number(header.id), product_id: Number(header.id), name: clean(header.name), brand: clean(header.brand), image_url: clean(header.product_image_url), product_image_url: clean(header.product_image_url) },
    variants,
  };
};

// Tiny filter facets for Inventory Count (replaces the heavy limit=120 catalog).
export const loadEmployeePortalFacets = async ({ employee = null } = {}) => {
  const tenantId = employee?.tenant_id ?? null;
  const scope = `(p.tenant_id IS NULL OR p.tenant_id = $1::bigint) AND COALESCE(p.is_active, TRUE) = TRUE AND COALESCE(NULLIF(LOWER(TRIM(p.status)), ''), 'active') NOT IN ('inactive', 'disabled', 'archived', 'deleted', 'draft') AND EXISTS (SELECT 1 FROM product_variants pv WHERE pv.product_id = p.id AND ${IN_STOCK_VARIANT} AND COALESCE(pv.stock, 0) > 0)`;
  const result = await db.query(
    `SELECT
       (SELECT COALESCE(array_agg(DISTINCT val), '{}') FROM (SELECT NULLIF(TRIM(COALESCE(b.name, p.brand)), '') AS val FROM products p LEFT JOIN brands b ON b.id = p.brand_id WHERE ${scope}) s WHERE val IS NOT NULL) AS brands,
       (SELECT COALESCE(array_agg(DISTINCT val), '{}') FROM (SELECT NULLIF(TRIM(COALESCE(NULLIF(p.product_type, ''), p.style)), '') AS val FROM products p WHERE ${scope}) s WHERE val IS NOT NULL) AS types,
       (SELECT COALESCE(array_agg(DISTINCT val), '{}') FROM (SELECT NULLIF(TRIM(p.gender), '') AS val FROM products p WHERE ${scope}) s WHERE val IS NOT NULL) AS genders,
       (SELECT COALESCE(array_agg(DISTINCT val), '{}') FROM (SELECT NULLIF(TRIM(p.grade), '') AS val FROM products p WHERE ${scope}) s WHERE val IS NOT NULL) AS grades,
       (SELECT COALESCE(array_agg(DISTINCT val), '{}') FROM (SELECT NULLIF(TRIM(v.size), '') AS val FROM product_variants v JOIN products p ON p.id = v.product_id WHERE v.is_active IS DISTINCT FROM FALSE AND v.deleted_at IS NULL AND COALESCE(v.stock, 0) > 0 AND ${scope}) s WHERE val IS NOT NULL) AS sizes`,
    [tenantId]
  );
  const row = result.rows?.[0] || {};
  const arr = (v) => (Array.isArray(v) ? v.filter(Boolean) : []);
  return {
    brands: arr(row.brands).sort((a, b) => String(a).localeCompare(String(b), "ar")),
    types: arr(row.types).sort((a, b) => String(a).localeCompare(String(b), "ar")),
    genders: arr(row.genders),
    grades: arr(row.grades).sort((a, b) => String(a).localeCompare(String(b), "ar")),
    sizes: arr(row.sizes).sort((a, b) => (Number.isFinite(Number(a)) && Number.isFinite(Number(b)) ? Number(a) - Number(b) : String(a).localeCompare(String(b), "ar"))),
  };
};

const buildPosCatalogQuery = (query = {}) => {
  const directSearch = firstNonEmpty(
    query.search,
    query.q,
    query.qr_token,
    query.qrToken,
    query.barcode,
    query.sku,
    query.article,
    query.article_code,
    query.articleCode
  );
  const productId = toPositiveInt(query.productId ?? query.product_id);
  const qrToken = clean(query.qr_token ?? query.qrToken ?? query.qr ?? "");
  const sku = clean(query.sku);
  const limit = Math.min(Math.max(toPositiveInt(query.limit ?? query.per_page ?? query.perPage, 48), 1), 48);
  const page = Math.max(1, toPositiveInt(query.page, 1));
  const brand = clean(query.brand);
  const manufacturer = clean(query.manufacturer ?? query.manufacturer_name ?? query.manufacturerName);
  const gender = clean(query.gender);
  const productType = clean(query.product_type ?? query.productType ?? query.type);
  const grade = clean(query.grade ?? query.category);
  const size = clean(query.size ?? query.selectedSize ?? query.selected_size);
  const hasSizeFilter = size && lower(size) !== "all";
  return {
    ...(directSearch ? { search: directSearch } : {}),
    ...(productId ? { productId } : {}),
    ...(qrToken ? { qr_token: qrToken } : {}),
    ...(sku ? { sku } : {}),
    limit: hasSizeFilter ? Math.min(Math.max(toPositiveInt(query.limit, 500), 1), 500) : limit,
    page,
    ...(brand && brand.toLowerCase() !== "all" ? { brand } : {}),
    ...(manufacturer && manufacturer.toLowerCase() !== "all" ? { manufacturer } : {}),
    ...(gender && gender.toLowerCase() !== "all" ? { gender } : {}),
    ...(productType && productType.toLowerCase() !== "all" ? { product_type: productType } : {}),
    ...(grade && grade.toLowerCase() !== "all" ? { grade } : {}),
    ...(hasSizeFilter ? { size } : {}),
    inStockOnly: query.inStockOnly ?? query.in_stock_only ?? 1,
  };
};

const buildEmployeeProductUser = (employee = {}) => ({
  id: employee?.user_id ?? employee?.id ?? null,
  tenant_id: employee?.tenant_id ?? null,
  company_id: employee?.company_id ?? employee?.companyId ?? null,
  workspace_id: employee?.workspace_id ?? employee?.workspaceId ?? null,
  role: "employee_portal",
});

export const loadEmployeePortalProducts = async ({ employee = null, query = {} } = {}) => {
  const payload = await loadProductsWithVariantsPayload({
    query: buildPosCatalogQuery(query),
    user: buildEmployeeProductUser(employee),
    requestId: "employee-portal-products",
  });
  const products = Array.isArray(payload?.products) ? payload.products : [];

  return {
    employee: employee
      ? {
          id: employee.id ?? null,
          full_name: employee.full_name || employee.name || "",
          employee_code: employee.employee_code || "",
          branch_id: employee.branch_id ?? null,
          branch_name: employee.branch_name || "",
        }
      : null,
    products,
    selection: buildLookupSelection(products, query),
    source: {
      employee_endpoint: "GET /api/employee-portal/:token/products",
      pos_endpoint: "GET /api/products/with-variants",
      mapping: "productsController.loadProductsWithVariantsPayload",
    },
  };
};
