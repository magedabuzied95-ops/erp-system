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
  const barcode = clean(query.barcode);
  const article = clean(query.article ?? query.article_code ?? query.articleCode);
  if (!directProductId && !barcode && !article) return null;

  for (const product of products) {
    if (directProductId && Number(product.id) === directProductId) {
      return {
        product_id: product.id,
        variant_id: null,
        color: "",
        size: "",
      };
    }

    if (barcode && (clean(product.barcode) === barcode || clean(product.product_code || product.article_code) === barcode)) {
      return {
        product_id: product.id,
        variant_id: null,
        color: "",
        size: "",
      };
    }

    if (article && (clean(product.product_code || product.article_code) === article || clean(product.article_code) === article)) {
      return {
        product_id: product.id,
        variant_id: null,
        color: "",
        size: "",
      };
    }

    const matchedVariant = (Array.isArray(product.variants) ? product.variants : []).find(
      (variant) =>
        (barcode && (clean(variant.barcode) === barcode || clean(variant.article_code) === barcode)) ||
        (article && clean(variant.article_code) === article)
    );

    if (matchedVariant) {
      return {
        product_id: product.id,
        variant_id: matchedVariant.variant_id ?? matchedVariant.id ?? null,
        color: clean(matchedVariant.color || ""),
        size: clean(matchedVariant.size || ""),
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

const buildPosCatalogQuery = (query = {}) => {
  const directSearch = firstNonEmpty(
    query.search,
    query.q,
    query.barcode,
    query.article,
    query.article_code,
    query.articleCode
  );
  const productId = toPositiveInt(query.productId ?? query.product_id);
  return {
    ...(directSearch ? { search: directSearch } : {}),
    ...(productId ? { productId } : {}),
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
