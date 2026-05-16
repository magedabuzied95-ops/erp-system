import db from "../database/db.js";

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toText = (value = "") => String(value || "").trim();

const buildSuggestionId = (productId, color) => `${productId || "product"}::${toText(color) || "default"}`;

const sqlIdent = (value) => {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value || "")) {
    throw new Error(`Unsafe SQL identifier: ${value}`);
  }
  return `"${value}"`;
};

const tableExists = async (clientOrPool, tableName) => {
  const result = await clientOrPool.query("SELECT to_regclass($1) AS regclass", [`public.${tableName}`]);
  return Boolean(result.rows[0]?.regclass);
};

const getTableColumnSet = async (clientOrPool, tableName) => {
  const result = await clientOrPool.query(
    `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = $1
    `,
    [tableName]
  );
  return new Set(result.rows.map((row) => row.column_name));
};

const pickColumn = (columns, candidates) => candidates.find((column) => columns.has(column)) || null;

const coalesceExpression = (alias, columns, candidates, fallbackSql) => {
  const existing = candidates.filter((column) => columns.has(column)).map((column) => `${alias}.${sqlIdent(column)}`);
  return existing.length ? `COALESCE(${existing.join(", ")}, ${fallbackSql})` : fallbackSql;
};

const recordQueryError = (diagnostics, step, error) => {
  diagnostics.queryErrors.push({
    step,
    error: error?.message || String(error),
  });
};

const safeQuery = async (clientOrPool, sql, params, diagnostics, step, fallbackRows = []) => {
  try {
    return await clientOrPool.query(sql, params);
  } catch (error) {
    recordQueryError(diagnostics, step, error);
    return { rows: fallbackRows, rowCount: 0 };
  }
};

const safeTableExists = async (clientOrPool, tableName, diagnostics, step = `detect_table_${tableName}`) => {
  try {
    const exists = await tableExists(clientOrPool, tableName);
    diagnostics.detectedTables[tableName] = exists;
    return exists;
  } catch (error) {
    diagnostics.detectedTables[tableName] = false;
    recordQueryError(diagnostics, step, error);
    return false;
  }
};

const safeGetTableColumnSet = async (clientOrPool, tableName, diagnostics, step = `detect_columns_${tableName}`) => {
  try {
    const columns = await getTableColumnSet(clientOrPool, tableName);
    diagnostics.detectedColumns[tableName] = Array.from(columns).sort();
    return columns;
  } catch (error) {
    diagnostics.detectedColumns[tableName] = [];
    recordQueryError(diagnostics, step, error);
    return new Set();
  }
};

export const ensureSmartReorderSchema = async (clientOrPool = db, diagnostics = initialDiagnostics()) => {
  if (!(await safeTableExists(clientOrPool, "product_variants", diagnostics, "ensure_product_variants_table"))) return;

  await safeQuery(clientOrPool, `
    ALTER TABLE IF EXISTS product_variants
      ADD COLUMN IF NOT EXISTS purchase_pack_type VARCHAR(20) NOT NULL DEFAULT 'unit',
      ADD COLUMN IF NOT EXISTS purchase_pack_qty INTEGER NOT NULL DEFAULT 1,
      ADD COLUMN IF NOT EXISTS reorder_trigger_percent NUMERIC(6,2) NOT NULL DEFAULT 70,
      ADD COLUMN IF NOT EXISTS size_distribution_json JSONB NULL,
      ADD COLUMN IF NOT EXISTS supplier_id BIGINT NULL,
      ADD COLUMN IF NOT EXISTS last_purchase_cost NUMERIC(12,2) NULL
  `, [], diagnostics, "ensure_variant_columns");
  await safeQuery(clientOrPool, `
    UPDATE product_variants
    SET
      purchase_pack_type = COALESCE(NULLIF(purchase_pack_type, ''), 'unit'),
      purchase_pack_qty = GREATEST(COALESCE(purchase_pack_qty, 1), 1),
      reorder_trigger_percent = COALESCE(reorder_trigger_percent, 70)
    WHERE purchase_pack_type IS NULL
       OR purchase_pack_type = ''
       OR purchase_pack_qty IS NULL
       OR purchase_pack_qty < 1
       OR reorder_trigger_percent IS NULL
  `, [], diagnostics, "normalize_variant_pack_columns");
  await safeQuery(clientOrPool, `CREATE INDEX IF NOT EXISTS idx_product_variants_purchase_pack ON product_variants (purchase_pack_type, purchase_pack_qty)`, [], diagnostics, "ensure_variant_pack_index");
  await safeQuery(clientOrPool, `CREATE INDEX IF NOT EXISTS idx_product_variants_supplier ON product_variants (supplier_id)`, [], diagnostics, "ensure_variant_supplier_index");
  await safeQuery(clientOrPool, `ALTER TABLE IF EXISTS order_items ADD COLUMN IF NOT EXISTS returned_quantity INTEGER NOT NULL DEFAULT 0`, [], diagnostics, "ensure_order_items_returned_quantity");
};

const resolveThreshold = (packQty, configured) => {
  if (packQty >= 24) return Math.max(toNumber(configured, 70), 80);
  if (packQty >= 15) return Math.max(toNumber(configured, 70), 70);
  return Math.min(toNumber(configured, 70), 40);
};

const buildSizeAnalysis = (variants, soldByVariant) => {
  const bySize = {};
  variants.forEach((variant) => {
    const size = toText(variant.size) || "مقاس واحد";
    const sold = toNumber(soldByVariant.get(String(variant.variant_id)));
    if (!bySize[size]) bySize[size] = { stock: 0, sold: 0 };
    bySize[size].stock += toNumber(variant.stock);
    bySize[size].sold += sold;
  });

  const entries = Object.entries(bySize).map(([size, value]) => ({ size, ...value }));
  const fastSizes = entries
    .filter((item) => item.sold > 0 && (item.stock <= 0 || item.sold >= item.stock))
    .map((item) => item.size);
  const slowSizes = entries
    .filter((item) => item.stock > 0 && item.sold <= Math.max(1, item.stock * 0.2))
    .map((item) => item.size);

  return { bySize, fastSizes, slowSizes };
};

const distributeSuggestedQuantity = ({ variants, bySize, fastSizes, slowSizes, suggestedQty }) => {
  const qty = Math.max(0, Math.round(toNumber(suggestedQty)));
  if (!qty || !variants.length) return [];

  const priority = (variant) => {
    const size = toText(variant.size) || "One size";
    const sizeStock = toNumber(bySize[size]?.stock);
    if (sizeStock <= 0) return 0;
    if (fastSizes.includes(size)) return 1;
    if (slowSizes.includes(size)) return 3;
    return 2;
  };

  const targets = [...variants]
    .sort((a, b) => priority(a) - priority(b) || toText(a.size).localeCompare(toText(b.size)))
    .slice(0, Math.min(qty, variants.length));
  if (!targets.length) return [];

  const base = Math.floor(qty / targets.length);
  let remainder = qty % targets.length;

  return targets
    .map((variant) => {
      const size = toText(variant.size) || "One size";
      const quantity = base + (remainder > 0 ? 1 : 0);
      remainder -= 1;
      return {
        variant_id: variant.variant_id,
        product_id: variant.product_id,
        size,
        stock: toNumber(variant.stock),
        sold: toNumber(bySize[size]?.sold),
        suggested_qty: quantity,
        last_purchase_cost: toNumber(variant.last_purchase_cost),
      };
    })
    .filter((item) => item.suggested_qty > 0);
};

const decideSuggestion = ({ packQty, currentStock, sellThrough, threshold, variants, slowSizes, fastSizes }) => {
  const soldOutSizes = variants.filter((variant) => toNumber(variant.stock) <= 0).length;
  const hasSingleSizeGap = soldOutSizes > 0 && currentStock >= Math.ceil(packQty * 0.5) && sellThrough < threshold;
  const overstock = slowSizes.length >= Math.max(2, Math.ceil(variants.length * 0.45)) && currentStock >= Math.ceil(packQty * 0.5);

  if (overstock) {
    return {
      status: "DO_NOT_BUY",
      risk_level: "HIGH",
      reason: "لا تشتري الآن: توجد مقاسات بطيئة كثيرة ولديها مخزون، راقب التصريف أولا.",
    };
  }

  if (packQty <= 5) {
    if (currentStock <= Math.max(1, packQty) || sellThrough >= 40) {
      return {
        status: "BUY_NOW",
        risk_level: "LOW",
        reason: "كرتونة صغيرة وسريعة الدوران، يمكن تعويض المخزون مبكرا.",
      };
    }
    return {
      status: "WATCH",
      risk_level: "LOW",
      reason: "الكرتونة صغيرة لكن المخزون الحالي ما زال كافيا، راقب البيع خلال الفترة القادمة.",
    };
  }

  if (hasSingleSizeGap) {
    return {
      status: "WATCH",
      risk_level: "MEDIUM",
      reason: "يوجد مقاس نفد، لكن أغلب الكرتونة ما زالت متاحة. راقب قبل شراء كرتونة كاملة.",
    };
  }

  if (sellThrough >= threshold && fastSizes.length) {
    return {
      status: "BUY_NOW",
      risk_level: packQty >= 24 ? "MEDIUM" : "LOW",
      reason: `نسبة البيع وصلت ${Math.round(sellThrough)}% وتخطت حد إعادة الشراء للكرتونة.`,
    };
  }

  if (sellThrough >= threshold * 0.75 || currentStock <= Math.max(2, Math.ceil(packQty * 0.25))) {
    return {
      status: "WATCH",
      risk_level: "MEDIUM",
      reason: "قريب من حد إعادة الشراء، راقب المقاسات السريعة قبل تأكيد كرتونة جديدة.",
    };
  }

  return {
    status: "DO_NOT_BUY",
    risk_level: "LOW",
    reason: "لا تشتري الآن: نسبة البيع لا تبرر شراء كرتونة جديدة.",
  };
};

const initialDiagnostics = () => ({
  queryErrors: [],
  detectedTables: {},
  detectedColumns: {},
  variantsProcessed: 0,
  suggestionsGenerated: 0,
  variantsCount: 0,
  salesRowsCount: 0,
  suggestionsCount: 0,
  fallbackUsed: {
    variantStockColumn: null,
    variantSizeColumn: null,
    variantColorColumn: null,
    productImageColumn: null,
    salesTables: [],
    skippedSalesTables: [],
    variantLinkColumns: [],
    salesFallback: false,
  },
});

const loadVariants = async ({ tenantId, diagnostics }) => {
  const [hasProducts, hasVariants] = await Promise.all([
    safeTableExists(db, "products", diagnostics),
    safeTableExists(db, "product_variants", diagnostics),
  ]);

  if (!hasProducts || !hasVariants) {
    diagnostics.fallbackUsed.missingCoreTables = { products: !hasProducts, product_variants: !hasVariants };
    return [];
  }

  const [productColumns, variantColumns, hasSuppliers] = await Promise.all([
    safeGetTableColumnSet(db, "products", diagnostics),
    safeGetTableColumnSet(db, "product_variants", diagnostics),
    safeTableExists(db, "suppliers", diagnostics),
  ]);
  const supplierColumns = hasSuppliers ? await safeGetTableColumnSet(db, "suppliers", diagnostics) : new Set();

  const stockColumn = pickColumn(variantColumns, ["stock", "quantity", "qty", "available_qty"]);
  const sizeColumn = pickColumn(variantColumns, ["size", "size_name"]);
  const colorColumn = pickColumn(variantColumns, ["color", "color_name"]);
  const imageColumn = pickColumn(productColumns, ["image_url", "image", "cover_image"]);

  diagnostics.fallbackUsed.variantStockColumn = stockColumn || "0";
  diagnostics.fallbackUsed.variantSizeColumn = sizeColumn || "''";
  diagnostics.fallbackUsed.variantColorColumn = colorColumn || "''";
  diagnostics.fallbackUsed.productImageColumn = imageColumn || "''";

  const stockExpr = coalesceExpression("pv", variantColumns, ["stock", "quantity", "qty", "available_qty"], "0");
  const sizeExpr = coalesceExpression("pv", variantColumns, ["size", "size_name"], "''");
  const colorExpr = coalesceExpression("pv", variantColumns, ["color", "color_name"], "''");
  const imageExpr = coalesceExpression("p", productColumns, ["image_url", "image", "cover_image"], "''");
  const productNameExpr = productColumns.has("name") ? "p.name" : "'منتج بدون اسم'";
  const productStatusExpr = productColumns.has("status") ? "AND COALESCE(NULLIF(LOWER(TRIM(p.status)), ''), 'active') NOT IN ('inactive', 'disabled', 'archived', 'deleted', 'draft')" : "";
  const tenantExpr = variantColumns.has("tenant_id") ? "AND ($1::bigint IS NULL OR pv.tenant_id = $1::bigint)" : "";
  const supplierJoin = hasSuppliers && variantColumns.has("supplier_id") ? "LEFT JOIN suppliers s ON s.id = pv.supplier_id" : "";
  const supplierIdExpr = variantColumns.has("supplier_id") ? "pv.supplier_id" : "NULL";
  const supplierNameExpr = hasSuppliers && supplierColumns.has("name") ? "s.name" : "NULL";
  const costExpr = coalesceExpression("pv", variantColumns, ["last_purchase_cost", "cost_price"], productColumns.has("cost_price") ? "p.cost_price" : "0");
  const packTypeExpr = variantColumns.has("purchase_pack_type") ? "pv.purchase_pack_type" : "'unit'";
  const packQtyExpr = variantColumns.has("purchase_pack_qty") ? "pv.purchase_pack_qty" : "1";
  const thresholdExpr = variantColumns.has("reorder_trigger_percent") ? "pv.reorder_trigger_percent" : "70";
  const sizeDistributionExpr = variantColumns.has("size_distribution_json") ? "pv.size_distribution_json" : "NULL";

  const result = await safeQuery(
    db,
    `
    SELECT
      pv.id AS variant_id,
      pv.product_id,
      ${productNameExpr} AS product_name,
      COALESCE(NULLIF(${imageExpr}::text, ''), '') AS product_image,
      ${colorExpr} AS color,
      ${sizeExpr} AS size,
      ${stockExpr} AS stock,
      ${packTypeExpr} AS purchase_pack_type,
      ${packQtyExpr} AS purchase_pack_qty,
      ${thresholdExpr} AS reorder_trigger_percent,
      ${sizeDistributionExpr} AS size_distribution_json,
      ${supplierIdExpr} AS supplier_id,
      ${supplierNameExpr} AS supplier_name,
      ${costExpr} AS last_purchase_cost
    FROM product_variants pv
    JOIN products p ON p.id = pv.product_id
    ${supplierJoin}
    WHERE 1 = 1
      ${tenantExpr}
      ${productStatusExpr}
    ORDER BY ${productNameExpr} ASC, ${colorExpr} ASC, ${sizeExpr} ASC
    `,
    [tenantId],
    diagnostics,
    "load_variants"
  );

  return result.rows;
};

const buildSalesQueryForTable = ({ tableName, columns, hasOrdersTable, orderColumns }) => {
  const linkColumn = pickColumn(columns, ["variant_id", "product_variant_id"]);
  if (!linkColumn) return null;

  const qtyColumn = pickColumn(columns, ["quantity", "qty", "sold_qty"]);
  const quantityExpr = qtyColumn ? `COALESCE(si.${sqlIdent(qtyColumn)}, 0)` : "0";
  const returnedExpr = columns.has("returned_quantity") ? `COALESCE(si.${sqlIdent("returned_quantity")}, 0)` : "0";
  const tenantWhere = columns.has("tenant_id") ? "AND ($1::bigint IS NULL OR si.tenant_id = $1::bigint OR si.tenant_id IS NULL)" : "";
  const canJoinOrders = hasOrdersTable && columns.has("order_id") && orderColumns.has("id");
  const orderJoin = canJoinOrders ? "LEFT JOIN orders o ON o.id = si.order_id" : "";
  const orderStatusWhere = canJoinOrders && orderColumns.has("status")
    ? "AND COALESCE(NULLIF(LOWER(TRIM(o.status)), ''), 'completed') NOT IN ('cancelled', 'canceled', 'void', 'returned')"
    : "";

  return {
    tableName,
    linkColumn,
    sql: `
      SELECT
        si.${sqlIdent(linkColumn)} AS variant_id,
        SUM(GREATEST(${quantityExpr} - ${returnedExpr}, 0))::numeric AS sold_qty
      FROM ${sqlIdent(tableName)} si
      ${orderJoin}
      WHERE si.${sqlIdent(linkColumn)} IS NOT NULL
        ${tenantWhere}
        ${orderStatusWhere}
      GROUP BY si.${sqlIdent(linkColumn)}
    `,
  };
};

const loadSalesRows = async ({ tenantId, diagnostics }) => {
  const salesTables = ["order_items", "sale_items", "pos_order_items"];

  const hasOrdersTable = await safeTableExists(db, "orders", diagnostics);
  const orderColumns = hasOrdersTable ? await safeGetTableColumnSet(db, "orders", diagnostics) : new Set();

  const queryParts = [];
  for (const tableName of salesTables) {
    if (!(await safeTableExists(db, tableName, diagnostics))) {
      diagnostics.fallbackUsed.skippedSalesTables.push({ table: tableName, reason: "missing_table" });
      continue;
    }

    const columns = await safeGetTableColumnSet(db, tableName, diagnostics);
    const queryPart = buildSalesQueryForTable({ tableName, columns, hasOrdersTable, orderColumns });
    if (!queryPart) {
      diagnostics.fallbackUsed.skippedSalesTables.push({ table: tableName, reason: "missing_variant_link" });
      continue;
    }
    diagnostics.fallbackUsed.salesTables.push(tableName);
    diagnostics.fallbackUsed.variantLinkColumns.push({ table: tableName, column: queryPart.linkColumn });
    queryParts.push(queryPart.sql);
  }

  if (!queryParts.length) {
    diagnostics.fallbackUsed.salesFallback = true;
    return [];
  }

  const result = await safeQuery(
    db,
    `
    SELECT variant_id, SUM(sold_qty)::numeric AS sold_qty
    FROM (
      ${queryParts.join("\nUNION ALL\n")}
    ) sales
    GROUP BY variant_id
    `,
    [tenantId],
    diagnostics,
    "load_sales"
  );
  if (diagnostics.queryErrors.some((item) => item.step === "load_sales")) {
    diagnostics.fallbackUsed.salesFallback = true;
  }
  return result.rows;
};

const buildDemoSuggestions = () => ([
  {
    product_id: "demo-1",
    product_name: "Demo Smart Reorder - Small Pack",
    image_url: "",
    variant: "Blue",
    color: "Blue",
    supplier_id: null,
    supplier_name: "Demo Supplier",
    purchase_pack_type: "carton",
    purchase_pack_qty: 5,
    reorder_trigger_percent: 40,
    sell_through_percent: 0,
    current_stock: 2,
    sold_qty: 0,
    stock_by_size: { "43": { stock: 2, sold: 0 } },
    slow_sizes: [],
    fast_sizes: [],
    suggested_qty: 0,
    status: "WATCH",
    reason: "Development fallback: sales analysis is unavailable, so this demo suggestion validates the UI flow.",
    risk_level: "MEDIUM",
    overstock_warning: false,
    last_purchase_cost: 120,
  },
  {
    product_id: "demo-2",
    product_name: "Demo Smart Reorder - Medium Pack",
    image_url: "",
    variant: "Black",
    color: "Black",
    supplier_id: null,
    supplier_name: "Demo Supplier",
    purchase_pack_type: "carton",
    purchase_pack_qty: 12,
    reorder_trigger_percent: 70,
    sell_through_percent: 0,
    current_stock: 4,
    sold_qty: 0,
    stock_by_size: { "42": { stock: 1, sold: 0 }, "44": { stock: 3, sold: 0 } },
    slow_sizes: [],
    fast_sizes: [],
    suggested_qty: 0,
    status: "WATCH",
    reason: "Development fallback: stock is below the carton quantity while sales analysis is unavailable.",
    risk_level: "MEDIUM",
    overstock_warning: false,
    last_purchase_cost: 90,
  },
  {
    product_id: "demo-3",
    product_name: "Demo Smart Reorder - Large Pack",
    image_url: "",
    variant: "Green",
    color: "Green",
    supplier_id: null,
    supplier_name: "Demo Supplier",
    purchase_pack_type: "carton",
    purchase_pack_qty: 24,
    reorder_trigger_percent: 80,
    sell_through_percent: 0,
    current_stock: 10,
    sold_qty: 0,
    stock_by_size: { "41": { stock: 0, sold: 0 }, "42": { stock: 10, sold: 0 } },
    slow_sizes: [],
    fast_sizes: [],
    suggested_qty: 0,
    status: "WATCH",
    reason: "Development fallback: large carton rules need review before buying while sales analysis is unavailable.",
    risk_level: "MEDIUM",
    overstock_warning: false,
    last_purchase_cost: 150,
  },
]);

const buildSuggestions = ({ variantsRows, salesRows, salesFallback = false }) => {
  const soldByVariant = new Map(salesRows.map((row) => [String(row.variant_id), toNumber(row.sold_qty)]));
  const groups = new Map();

  variantsRows.forEach((variant) => {
    const color = toText(variant.color) || "بدون لون";
    const key = `${variant.product_id}::${color}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(variant);
  });

  return Array.from(groups.values()).map((variants) => {
    const first = variants[0] || {};
    const currentStock = variants.reduce((sum, variant) => sum + Math.max(0, toNumber(variant.stock)), 0);
    const soldQty = variants.reduce((sum, variant) => sum + toNumber(soldByVariant.get(String(variant.variant_id))), 0);
    const packQty = Math.max(1, ...variants.map((variant) => toNumber(variant.purchase_pack_qty, 1)));
    const threshold = resolveThreshold(packQty, first.reorder_trigger_percent);
    const sellThrough = soldQty + currentStock > 0 ? (soldQty / (soldQty + currentStock)) * 100 : 0;
    const { bySize, fastSizes, slowSizes } = buildSizeAnalysis(variants, soldByVariant);
    const decision = salesFallback
      ? {
          status: "WATCH",
          risk_level: currentStock <= Math.max(packQty, 2) ? "MEDIUM" : "LOW",
          reason: currentStock <= Math.max(packQty, 2)
            ? "Sales/order data is unavailable, so sold quantity is treated as 0. Current stock is low against the carton quantity; watch before purchasing."
            : "Sales/order data is unavailable, so sold quantity is treated as 0. Watch this carton rule until sales data is available.",
        }
      : decideSuggestion({ packQty, currentStock, soldQty, sellThrough, threshold, variants, slowSizes, fastSizes });
    const suggestedQty = decision.status === "BUY_NOW"
      ? Math.max(packQty, Math.ceil(Math.max(packQty - currentStock, 1) / packQty) * packQty)
      : 0;
    const suggestionId = buildSuggestionId(first.product_id, first.color);
    const velocityWindowDays = 30;
    const averageDailySales = soldQty > 0 ? Math.round((soldQty / velocityWindowDays) * 100) / 100 : 0;
    const estimatedDaysUntilStockout = averageDailySales > 0 ? Math.ceil(currentStock / averageDailySales) : null;
    const suggestedLines = distributeSuggestedQuantity({ variants, bySize, fastSizes, slowSizes, suggestedQty });

    return {
      suggestion_id: suggestionId,
      product_id: first.product_id,
      variant_ids: variants.map((variant) => variant.variant_id).filter(Boolean),
      product_name: first.product_name || "منتج بدون اسم",
      image_url: first.product_image || "",
      variant: toText(first.color) || "بدون لون",
      color: toText(first.color) || "بدون لون",
      supplier_id: first.supplier_id || null,
      supplier_name: first.supplier_name || "غير محدد",
      purchase_pack_type: first.purchase_pack_type || "unit",
      purchase_pack_qty: packQty,
      reorder_trigger_percent: threshold,
      sell_through_percent: Math.round(sellThrough * 10) / 10,
      current_stock: currentStock,
      sold_qty: soldQty,
      stock_by_size: bySize,
      slow_sizes: slowSizes,
      fast_sizes: fastSizes,
      suggested_qty: suggestedQty,
      suggested_lines: suggestedLines,
      average_daily_sales: averageDailySales,
      estimated_days_until_stockout: estimatedDaysUntilStockout,
      status: decision.status,
      reason: decision.reason,
      risk_level: decision.risk_level,
      overstock_warning: slowSizes.length > 0 && currentStock >= Math.ceil(packQty * 0.5),
      last_purchase_cost: toNumber(first.last_purchase_cost),
    };
  }).sort((a, b) => {
    const order = { BUY_NOW: 0, WATCH: 1, DO_NOT_BUY: 2 };
    return (order[a.status] ?? 9) - (order[b.status] ?? 9) || b.sell_through_percent - a.sell_through_percent;
  });
};

export const getSmartReorderSuggestions = async ({ tenantId = null } = {}) => {
  const diagnostics = initialDiagnostics();

  try {
    await ensureSmartReorderSchema(db, diagnostics);

    const variantsRows = await loadVariants({ tenantId, diagnostics });
    diagnostics.variantsCount = variantsRows.length;
    diagnostics.variantsProcessed = variantsRows.length;

    const salesRows = await loadSalesRows({ tenantId, diagnostics });
    diagnostics.salesRowsCount = salesRows.length;

    let data = buildSuggestions({ variantsRows, salesRows, salesFallback: diagnostics.fallbackUsed.salesFallback });
    if (!data.length && diagnostics.queryErrors.length && process.env.NODE_ENV !== "production") {
      diagnostics.emergencyMockFallback = true;
      data = buildDemoSuggestions();
    }
    diagnostics.suggestionsCount = data.length;
    diagnostics.suggestionsGenerated = data.length;

    console.log("[smart-reorder] diagnostics:", diagnostics);
    return { success: true, data, suggestions: data, diagnostics };
  } catch (error) {
    console.error("[smart-reorder] error:", error, error?.stack);
    diagnostics.fatalError = error?.message || String(error);
    recordQueryError(diagnostics, "unexpected", error);
    const data = process.env.NODE_ENV !== "production" ? buildDemoSuggestions() : [];
    diagnostics.emergencyMockFallback = process.env.NODE_ENV !== "production";
    diagnostics.variantsProcessed = 0;
    diagnostics.suggestionsGenerated = data.length;
    diagnostics.suggestionsCount = data.length;
    console.log("[smart-reorder] diagnostics:", diagnostics);
    return { success: true, data, suggestions: data, diagnostics };
  }
};
