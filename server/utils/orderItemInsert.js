const ERP_DEBUG_SQL = ["1", "true", "yes", "on"].includes(String(process.env.ERP_DEBUG_SQL || "").trim().toLowerCase());

export const ORDER_ITEM_INSERT_COLUMNS = [
  "tenant_id",
  "order_id",
  "variant_id",
  "product_id",
  "product_name",
  "variant_name",
  "sku",
  "barcode",
  "quantity",
  "sale_price",
  "unit_price",
  "price",
  "discount_amount",
  "tax_amount",
  "total_amount",
  "line_total",
  "subtotal",
  "price_source",
  "image_url",
  "product_image",
  "variant_image",
  "size",
  "color",
  "sales_employee_id",
];

const numberValue = (...values) => {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
};

const textValue = (...values) => {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
};

const nullableNumber = (...values) => {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed !== 0) return parsed;
  }
  return null;
};

const getAvailableColumns = (availableColumns) => {
  if (!availableColumns) return null;
  if (availableColumns instanceof Set) return availableColumns;
  if (Array.isArray(availableColumns)) return new Set(availableColumns);
  return null;
};

const orderItemValue = (item = {}, column) => {
  const quantity = numberValue(item.quantity, 1) || 1;
  const unitPrice = numberValue(item.unit_price, item.unitPrice, item.sale_price, item.salePrice, item.price, item.selling_price);
  const lineTotal = numberValue(item.total_amount, item.totalAmount, item.line_total, item.lineTotal, item.subtotal, item.item_total, unitPrice * quantity);
  switch (column) {
    case "tenant_id":
      return nullableNumber(item.tenant_id, item.tenantId);
    case "order_id":
      return nullableNumber(item.order_id, item.orderId);
    case "variant_id":
      return nullableNumber(item.variant_id, item.variantId);
    case "product_id":
      return nullableNumber(item.product_id, item.productId);
    case "product_name":
      return textValue(item.product_name, item.productName, item.name);
    case "variant_name":
      return textValue(item.variant_name, item.variantName);
    case "sku":
      return textValue(item.sku);
    case "barcode":
      return textValue(item.barcode);
    case "quantity":
      return quantity;
    case "sale_price":
    case "unit_price":
    case "price":
      return unitPrice;
    case "discount_amount":
      return numberValue(item.discount_amount, item.discountAmount);
    case "tax_amount":
      return numberValue(item.tax_amount, item.taxAmount);
    case "total_amount":
    case "line_total":
    case "subtotal":
      return lineTotal;
    case "price_source":
      return textValue(item.price_source, item.priceSource) || (unitPrice > 0 ? "payload" : "missing");
    case "image_url":
      return textValue(item.image_url, item.imageUrl);
    case "product_image":
      return textValue(item.product_image, item.productImage, item.image_url, item.imageUrl);
    case "variant_image":
      return textValue(item.variant_image, item.variantImage);
    case "size":
      return textValue(item.size);
    case "color":
      return textValue(item.color);
    case "sales_employee_id":
      return nullableNumber(item.sales_employee_id, item.salesEmployeeId);
    default:
      return item[column] ?? null;
  }
};

const annotateInsertError = (error, details = {}) => {
  error.routeName = details.routeName || error.routeName || "";
  error.insertLabel = details.insertLabel || error.insertLabel || "";
  error.columnsCount = details.columnsCount ?? details.columns?.length ?? error.columnsCount;
  error.paramsCount = details.paramsCount ?? details.params?.length ?? error.paramsCount;
  error.sqlSnippetLabel = details.sqlSnippetLabel || error.sqlSnippetLabel || "";
  return error;
};

export const logOrderItemsInsertDebug = ({ filePath = "", insertLabel = "order_items", columns = [], params = [] } = {}) => {
  if (!ERP_DEBUG_SQL) return;
  console.error("[order_items insert]", {
    filePath,
    insertLabel,
    columnsCount: columns.length,
    paramsCount: params.length,
    columns,
  });
};

export const buildOrderItemInsertQuery = (item = {}, options = {}) => {
  const available = getAvailableColumns(options.availableColumns);
  const columns = ORDER_ITEM_INSERT_COLUMNS.filter((column) => !available || available.has(column));
  const params = columns.map((column) => orderItemValue(item, column));
  const startIndex = Number(options.startIndex || 1);
  const placeholders = columns.map((_, index) => `$${startIndex + index}`);
  if (columns.length !== params.length) {
    throw annotateInsertError(new Error("order_items INSERT shape mismatch"), {
      routeName: options.routeName,
      insertLabel: options.insertLabel,
      columnsCount: columns.length,
      paramsCount: params.length,
      sqlSnippetLabel: options.sqlSnippetLabel || "order_items_insert",
    });
  }
  const returning = options.returning ? " RETURNING *" : "";
  const sql = `INSERT INTO order_items (${columns.join(", ")}) VALUES (${placeholders.join(", ")})${returning}`;
  logOrderItemsInsertDebug({ filePath: options.filePath, insertLabel: options.insertLabel, columns, params });
  return { sql, params, columns, placeholders, valuesSql: `(${placeholders.join(", ")})` };
};

export const buildBulkOrderItemInsertQuery = (items = [], options = {}) => {
  const available = getAvailableColumns(options.availableColumns);
  const columns = ORDER_ITEM_INSERT_COLUMNS.filter((column) => !available || available.has(column));
  const params = [];
  const rows = items.map((item) => {
    const rowParams = columns.map((column) => orderItemValue(item, column));
    if (rowParams.length !== columns.length) {
      throw annotateInsertError(new Error("order_items bulk INSERT row shape mismatch"), {
        routeName: options.routeName,
        insertLabel: options.insertLabel,
        columnsCount: columns.length,
        paramsCount: rowParams.length,
        sqlSnippetLabel: options.sqlSnippetLabel || "order_items_bulk_insert",
      });
    }
    const base = params.length;
    params.push(...rowParams);
    return `(${columns.map((_, offset) => `$${base + offset + 1}`).join(", ")})`;
  });
  const expectedParams = rows.length * columns.length;
  if (params.length !== expectedParams) {
    throw annotateInsertError(new Error("order_items bulk INSERT params mismatch"), {
      routeName: options.routeName,
      insertLabel: options.insertLabel,
      columnsCount: columns.length,
      paramsCount: params.length,
      sqlSnippetLabel: options.sqlSnippetLabel || "order_items_bulk_insert",
    });
  }
  const returning = options.returning ? " RETURNING *" : "";
  const sql = `INSERT INTO order_items (${columns.join(", ")}) VALUES ${rows.join(", ")}${returning}`;
  logOrderItemsInsertDebug({ filePath: options.filePath, insertLabel: options.insertLabel, columns, params });
  return { sql, params, columns, rows };
};

export const enrichOrderItemsInsertError = (error, details = {}) => annotateInsertError(error, details);
