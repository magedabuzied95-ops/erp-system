import db from "../database/db.js";
import { buildPurchaseComposition, PURCHASE_MODES, resolveProductPurchasePattern } from "./purchasePatternService.js";

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
  await safeGetTableColumnSet(clientOrPool, "product_variants", diagnostics, "inspect_variant_columns");
  if (await safeTableExists(clientOrPool, "order_items", diagnostics, "inspect_order_items_table")) {
    await safeGetTableColumnSet(clientOrPool, "order_items", diagnostics, "inspect_order_item_columns");
  }
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
  const productField = (column, fallback = "NULL") => productColumns.has(column) ? `p.${sqlIdent(column)}` : fallback;

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
      ${costExpr} AS last_purchase_cost,
      ${productField("purchase_mode")} AS purchase_mode,
      ${productField("purchase_size_group")} AS purchase_size_group,
      ${productField("purchase_pieces_per_size")} AS purchase_pieces_per_size,
      ${productField("purchase_colors_per_carton")} AS purchase_colors_per_carton,
      ${productField("purchase_carton_colors", "'[]'::jsonb")} AS purchase_carton_colors,
      ${productField("gender")} AS gender,
      ${productField("product_type")} AS product_type,
      ${productField("category")} AS category
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

export const buildSuggestions = ({ variantsRows, salesRows, salesFallback = false }) => {
  const soldByVariant = new Map(salesRows.map((row) => [String(row.variant_id), toNumber(row.sold_qty)]));
  const productVariants = new Map();
  for (const variant of variantsRows) {
    const key = String(variant.product_id);
    if (!productVariants.has(key)) productVariants.set(key, []);
    productVariants.get(key).push(variant);
  }
  const patterns = new Map();
  for (const [productId, variants] of productVariants) {
    patterns.set(productId, resolveProductPurchasePattern(variants[0] || {}, variants));
  }
  const groups = new Map();

  variantsRows.forEach((variant) => {
    const color = toText(variant.color) || "بدون لون";
    const pattern = patterns.get(String(variant.product_id));
    const key = pattern?.mode === PURCHASE_MODES.FULL_CARTON
      ? `${variant.product_id}::FULL_CARTON`
      : `${variant.product_id}::${color}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(variant);
  });

  return Array.from(groups.values()).map((variants) => {
    const first = variants[0] || {};
    const allProductVariants = productVariants.get(String(first.product_id)) || variants;
    const pattern = patterns.get(String(first.product_id)) || resolveProductPurchasePattern(first, allProductVariants);
    const currentStock = variants.reduce((sum, variant) => sum + Math.max(0, toNumber(variant.stock)), 0);
    const soldQty = variants.reduce((sum, variant) => sum + toNumber(soldByVariant.get(String(variant.variant_id))), 0);
    const legacyPackQty = Math.max(1, ...variants.map((variant) => toNumber(variant.purchase_pack_qty, 1)));
    const patternPackQty = pattern.mode === PURCHASE_MODES.FULL_CARTON
      ? pattern.pieces_per_carton
      : pattern.mode === PURCHASE_MODES.FULL_COLOR_RUN ? pattern.pieces_per_color_run : 0;
    const packQty = pattern.configured && patternPackQty > 0 ? patternPackQty : legacyPackQty;
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
    const legacySuggestedQty = decision.status === "BUY_NOW"
      ? Math.max(packQty, Math.ceil(Math.max(packQty - currentStock, 1) / packQty) * packQty)
      : 0;
    const composition = pattern.configured && pattern.mode !== PURCHASE_MODES.INDIVIDUAL
      ? buildPurchaseComposition({ product: first, variants: allProductVariants, triggerColor: first.color, packs: 1 })
      : null;
    const suggestedQty = composition
      ? (decision.status === "BUY_NOW" && composition.valid ? composition.total_pieces : 0)
      : legacySuggestedQty;
    const suggestionId = buildSuggestionId(first.product_id, pattern.mode === PURCHASE_MODES.FULL_CARTON ? "FULL_CARTON" : first.color);
    const velocityWindowDays = 30;
    const averageDailySales = soldQty > 0 ? Math.round((soldQty / velocityWindowDays) * 100) / 100 : 0;
    const estimatedDaysUntilStockout = averageDailySales > 0 ? Math.ceil(currentStock / averageDailySales) : null;
    const suggestedLines = composition
      ? (decision.status === "BUY_NOW" && composition.valid
          ? composition.lines.map((line) => ({ ...line, suggested_qty: line.quantity }))
          : [])
      : distributeSuggestedQuantity({ variants, bySize, fastSizes, slowSizes, suggestedQty });

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
      purchase_pattern_configured: pattern.configured,
      purchase_pattern_mode: pattern.mode,
      purchase_pattern_size_group: pattern.size_group,
      purchase_pattern_valid: composition ? composition.valid : pattern.valid,
      purchase_pattern_errors: composition?.errors || pattern.errors || [],
      missing_variants: composition?.missing_variants || [],
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

export const buildReorderDraftLines = (suggestions = []) => {
  const lines = [];
  for (const suggestion of suggestions) {
    if (suggestion.purchase_pattern_configured && suggestion.purchase_pattern_valid === false) {
      const details = (suggestion.purchase_pattern_errors || []).map((item) => item.message).filter(Boolean);
      const error = new Error(details.join("; ") || `Invalid purchase pattern for product ${suggestion.product_name || suggestion.product_id}`);
      error.status = 409;
      error.code = "PURCHASE_PATTERN_INVALID";
      error.details = suggestion.purchase_pattern_errors || [];
      error.missing_variants = suggestion.missing_variants || [];
      throw error;
    }

    const configuredLines = Array.isArray(suggestion.suggested_lines) ? suggestion.suggested_lines : [];
    const sourceLines = suggestion.purchase_pattern_configured
      ? configuredLines
      : (configuredLines.length
          ? configuredLines
          : (Array.isArray(suggestion.variant_ids) ? suggestion.variant_ids : []).slice(0, 1).map((variantId) => ({
              product_id: suggestion.product_id,
              variant_id: variantId,
              suggested_qty: Math.max(1, Number(suggestion.suggested_qty || suggestion.purchase_pack_qty || 1)),
              last_purchase_cost: suggestion.last_purchase_cost,
            })));

    for (const line of sourceLines) {
      const quantity = Number(line.suggested_qty ?? line.quantity);
      if (!line.variant_id || !Number.isInteger(quantity) || quantity <= 0) continue;
      lines.push({
        product_id: line.product_id || suggestion.product_id,
        variant_id: line.variant_id,
        supplier_id: suggestion.supplier_id,
        quantity,
        cost_price: Number(line.last_purchase_cost ?? suggestion.last_purchase_cost ?? 0),
        metadata: {
          source: "smart_reorder",
          suggestion_id: suggestion.suggestion_id,
          status: suggestion.status,
          risk_level: suggestion.risk_level,
          sell_through_percent: suggestion.sell_through_percent,
          current_stock: suggestion.current_stock,
          reorder_trigger_percent: suggestion.reorder_trigger_percent,
          product_name: suggestion.product_name,
          color: line.color || suggestion.color,
          size: line.size || null,
          reason: suggestion.reason,
          purchase_pattern_mode: suggestion.purchase_pattern_mode || null,
        },
      });
    }
  }
  return lines;
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
