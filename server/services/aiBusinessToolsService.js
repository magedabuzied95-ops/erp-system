import db from "../database/db.js";
import { getSetting } from "./settingsService.js";
import { getAiAgentSettings } from "./aiSalesAgentService.js";
import { getWebsiteSettings } from "./liveActivityService.js";
import { loadShippingZones, resolveStorefrontShippingQuote } from "./storefrontShippingService.js";

const text = (value = "") => String(value ?? "").trim();
const lower = (value = "") => text(value).toLowerCase();
const number = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const asArray = (value) => (Array.isArray(value) ? value : []);

const tableColumnsCache = new Map();

const getTableColumns = async (tableName) => {
  if (tableColumnsCache.has(tableName)) return tableColumnsCache.get(tableName);
  const result = await db.query(
    `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = $1
    `,
    [tableName]
  );
  const columns = new Set(result.rows.map((row) => row.column_name));
  tableColumnsCache.set(tableName, columns);
  return columns;
};

const pickFirst = (...values) => values.map((value) => text(value)).find(Boolean) || "";

const listUnique = (items = [], limit = 10) => [...new Set(asArray(items).map((item) => text(item)).filter(Boolean))].slice(0, limit);

const variantColor = (variant = {}) => pickFirst(variant.color, variant.color_name, variant.variant_color);
const variantSize = (variant = {}) => pickFirst(variant.size, variant.size_name, variant.variant_size);

const buildProductFactsFromRow = (row = {}, variants = []) => {
  const availableSizes = listUnique(variants.filter((variant) => number(variant.stock ?? variant.quantity ?? 0, 0) > 0).map((variant) => variantSize(variant)));
  const availableColors = listUnique(variants.filter((variant) => number(variant.stock ?? variant.quantity ?? 0, 0) > 0).map((variant) => variantColor(variant)));
  const stockSummary = {
    total_stock: number(row.total_stock ?? row.stock ?? row.stock_quantity ?? variants.reduce((sum, variant) => sum + number(variant.stock ?? variant.quantity ?? 0, 0), 0), 0),
    available_variants: variants.filter((variant) => number(variant.stock ?? variant.quantity ?? 0, 0) > 0).length,
    low_stock_variants: variants.filter((variant) => {
      const stock = number(variant.stock ?? variant.quantity ?? 0, 0);
      return stock > 0 && stock <= 5;
    }).length,
    out_of_stock_variants: variants.filter((variant) => number(variant.stock ?? variant.quantity ?? 0, 0) <= 0).length,
  };

  return {
    product_id: row.id ?? row.product_id ?? null,
    product_name: pickFirst(row.name, row.title, row.product_name),
    brand: pickFirst(row.brand, row.brand_name, row.manufacturer_name),
    category: pickFirst(row.category, row.category_name, row.main_category, row.product_type),
    price: number(row.sale_price ?? row.price ?? row.selling_price ?? row.final_price ?? row.product_price, 0),
    available_sizes: availableSizes,
    available_colors: availableColors,
    stock_summary: stockSummary,
    variant_count: variants.length,
    variants: variants.map((variant) => ({
      variant_id: variant.id ?? variant.variant_id ?? null,
      color: variantColor(variant),
      size: variantSize(variant),
      stock: number(variant.stock ?? variant.quantity ?? 0, 0),
    })),
  };
};

export const getProductFacts = async ({ tenantId, productId = null, query = "", productName = "", sku = "", slug = "" } = {}) => {
  const safeTenantId = Number(tenantId);
  if (!Number.isFinite(safeTenantId) || safeTenantId <= 0) {
    return null;
  }

  const productColumns = await getTableColumns("products");
  const productClauses = ["tenant_id = $1"];
  const params = [safeTenantId];
  const addClause = (column, value) => {
    if (!value || !productColumns.has(column)) return;
    params.push(text(value));
    productClauses.push(`${column}::text = $${params.length}`);
  };

  if (Number.isFinite(Number(productId)) && Number(productId) > 0) {
    params.push(Number(productId));
    productClauses.push(`id = $${params.length}`);
  } else {
    addClause("slug", slug);
    addClause("sku", sku);
  }

  const searchValue = pickFirst(query, productName, sku, slug);
  if (!productClauses.some((clause) => clause.includes("id =") || clause.includes("slug") || clause.includes("sku"))) {
    const searchableColumns = ["name", "title", "product_name", "sku", "slug", "brand", "brand_name", "category", "category_name", "model", "product_model"];
    const likeClauses = searchableColumns.filter((column) => productColumns.has(column)).map((column) => `${column}::text ILIKE $${params.length + 1}`);
    if (searchValue && likeClauses.length) {
      params.push(`%${searchValue}%`);
      productClauses.push(`(${likeClauses.join(" OR ")})`);
    }
  }

  const result = await db.query(
    `
    SELECT *
    FROM products
    WHERE ${productClauses.join(" AND ")}
    ORDER BY id DESC
    LIMIT 1
    `,
    params
  );

  const row = result.rows[0];
  if (!row) return null;

  const variantResult = await db.query(
    `
    SELECT *
    FROM product_variants
    WHERE tenant_id = $1
      AND product_id = $2
    ORDER BY id ASC
    LIMIT 60
    `,
    [safeTenantId, row.id]
  ).catch(() => ({ rows: [] }));

  return buildProductFactsFromRow(row, variantResult.rows || []);
};

export const getInventoryFacts = async ({ tenantId, productId = null, variantId = null, query = "" } = {}) => {
  const safeTenantId = Number(tenantId);
  if (!Number.isFinite(safeTenantId) || safeTenantId <= 0) return null;

  const clauses = ["tenant_id = $1"];
  const params = [safeTenantId];
  if (Number.isFinite(Number(variantId)) && Number(variantId) > 0) {
    params.push(Number(variantId));
    clauses.push(`id = $${params.length}`);
  } else if (Number.isFinite(Number(productId)) && Number(productId) > 0) {
    params.push(Number(productId));
    clauses.push(`product_id = $${params.length}`);
  } else if (query) {
    params.push(`%${text(query)}%`);
    clauses.push(`(
      COALESCE(color::text, '') ILIKE $${params.length}
      OR COALESCE(size::text, '') ILIKE $${params.length}
      OR COALESCE(sku::text, '') ILIKE $${params.length}
    )`);
  }

  const result = await db.query(
    `
    SELECT *
    FROM product_variants
    WHERE ${clauses.join(" AND ")}
    ORDER BY id ASC
    LIMIT 60
    `,
    params
  ).catch(() => ({ rows: [] }));

  const variants = result.rows || [];
  const availableSizes = listUnique(variants.filter((variant) => number(variant.stock ?? 0, 0) > 0).map(variantSize));
  const availableColors = listUnique(variants.filter((variant) => number(variant.stock ?? 0, 0) > 0).map(variantColor));
  const lowStock = variants.filter((variant) => {
    const stock = number(variant.stock ?? 0, 0);
    return stock > 0 && stock <= 5;
  });

  return {
    variant_stock: variants.map((variant) => ({
      variant_id: variant.id ?? variant.variant_id ?? null,
      product_id: variant.product_id ?? null,
      color: variantColor(variant),
      size: variantSize(variant),
      stock: number(variant.stock ?? 0, 0),
      in_stock: number(variant.stock ?? 0, 0) > 0,
      low_stock: number(variant.stock ?? 0, 0) > 0 && number(variant.stock ?? 0, 0) <= 5,
    })),
    available_sizes: availableSizes,
    available_colors: availableColors,
    in_stock: variants.some((variant) => number(variant.stock ?? 0, 0) > 0),
    low_stock: lowStock.length > 0,
    stock_summary: {
      total_variants: variants.length,
      in_stock_variants: variants.filter((variant) => number(variant.stock ?? 0, 0) > 0).length,
      low_stock_variants: lowStock.length,
      out_of_stock_variants: variants.filter((variant) => number(variant.stock ?? 0, 0) <= 0).length,
    },
  };
};

export const getShippingFacts = async ({ tenantId, governorate = "", city = "", area = "", subtotal = 0 } = {}) => {
  const safeTenantId = Number(tenantId);
  if (!Number.isFinite(safeTenantId) || safeTenantId <= 0) return null;
  const [websiteSettings, shippingZones, quote] = await Promise.all([
    getWebsiteSettings({ tenantId: safeTenantId }).catch(() => ({})),
    loadShippingZones().catch(() => ({ defaultPrice: 0, defaultProvider: "", zones: [] })),
    resolveStorefrontShippingQuote({ governorate, city, area, subtotal }).catch(() => null),
  ]);

  return {
    shipping_rules: {
      default_shipping_price: number(websiteSettings?.default_shipping_price ?? shippingZones?.defaultPrice ?? 0, 0),
      default_provider: text(shippingZones?.defaultProvider || ""),
      cod_allowed: Boolean(websiteSettings?.allow_cod ?? true),
      zones_count: asArray(shippingZones?.zones).length,
    },
    supported_areas: asArray(shippingZones?.zones).slice(0, 50).map((zone) => ({
      id: zone.id || "",
      governorate: zone.governorate || "",
      city: zone.city || "",
      area: zone.area || "",
      price: number(zone.price, 0),
      estimated_delivery: text(zone.estimated_delivery_text || ""),
      provider: text(zone.provider || zone.provider_id || ""),
    })),
    estimated_delivery: quote ? {
      price: number(quote.price, 0),
      estimated_delivery_text: text(quote.estimated_delivery_text || ""),
      provider: text(quote.provider || quote.provider_id || ""),
      match_level: text(quote.match_level || ""),
      free_shipping_applied: Boolean(quote.free_shipping_applied),
    } : null,
  };
};

export const getPolicyFacts = async ({ tenantId } = {}) => {
  const safeTenantId = Number(tenantId);
  if (!Number.isFinite(safeTenantId) || safeTenantId <= 0) return null;
  const [agentSettings, websiteSettings, codEnabled, paymentMethods] = await Promise.all([
    getAiAgentSettings({ tenantId: safeTenantId }).catch(() => ({})),
    getWebsiteSettings({ tenantId: safeTenantId }).catch(() => ({})),
    getSetting("orders.allow_cod", true).catch(() => true),
    Promise.all([
      getSetting("storefront.payment_methods.vodafone_cash_enabled", true).catch(() => true),
      getSetting("storefront.payment_methods.vodafone_cash_display_name", "Vodafone Cash").catch(() => "Vodafone Cash"),
      getSetting("storefront.payment_methods.instapay_enabled", true).catch(() => true),
      getSetting("storefront.payment_methods.instapay_display_name", "InstaPay").catch(() => "InstaPay"),
      getSetting("storefront.payment_methods.shipping_confirmation_enabled", true).catch(() => true),
      getSetting("storefront.payment_methods.shipping_confirmation_amount", 75).catch(() => 75),
    ]),
  ]);
  const paymentRules = {
    cash_on_delivery_enabled: Boolean(codEnabled),
    payment_options: {
      vodafone_cash: {
        enabled: Boolean(paymentMethods[0]),
        display_name: text(paymentMethods[1] || "Vodafone Cash"),
      },
      instapay: {
        enabled: Boolean(paymentMethods[2]),
        display_name: text(paymentMethods[3] || "InstaPay"),
      },
      shipping_confirmation: {
        enabled: Boolean(paymentMethods[4]),
        amount: number(paymentMethods[5], 75),
      },
    },
  };

  return {
    return_policy: text(agentSettings.exchange_return_policy_text || websiteSettings.return_exchange_policy || websiteSettings.return_policy || "سياسة الاستبدال والاسترجاع مش مضافة لسه."),
    exchange_policy: text(agentSettings.exchange_return_policy_text || websiteSettings.exchange_policy || websiteSettings.return_exchange_policy || "سياسة الاستبدال والاسترجاع مش مضافة لسه."),
    payment_rules: {
      ...paymentRules,
      payment_policy_text: text(websiteSettings.paymentPolicy || websiteSettings.payment_policy || ""),
      payment_methods_text: text(websiteSettings.paymentMethods || websiteSettings.payment_methods || ""),
      cod_availability_text: text(agentSettings.cod_availability_text || ""),
      delivery_policy_text: text(agentSettings.delivery_policy_text || ""),
    },
    shipping_policy_text: text(agentSettings.delivery_policy_text || websiteSettings.deliveryPolicy || websiteSettings.shipping_policy || ""),
    website_settings: {
      store_name: text(websiteSettings.storeName || websiteSettings.store_name || ""),
      payment_methods: paymentMethods,
    },
  };
};

export const getOrderFacts = async ({ tenantId, orderId = null, conversationId = "", orderNumber = "" } = {}) => {
  const safeTenantId = Number(tenantId);
  if (!Number.isFinite(safeTenantId) || safeTenantId <= 0) return null;
  const clauses = ["tenant_id = $1"];
  const params = [safeTenantId];
  if (Number.isFinite(Number(orderId)) && Number(orderId) > 0) {
    params.push(Number(orderId));
    clauses.push(`id = $${params.length}`);
  } else {
    if (text(conversationId)) {
      params.push(text(conversationId));
      clauses.push(`ai_agent_conversation_id = $${params.length}`);
    }
    if (text(orderNumber)) {
      params.push(text(orderNumber));
      clauses.push(`public_order_number = $${params.length} OR display_order_number = $${params.length}`);
    }
  }

  const result = await db.query(
    `
    SELECT *
    FROM orders
    WHERE ${clauses.join(" AND ")}
    ORDER BY id DESC
    LIMIT 1
    `,
    params
  ).catch(() => ({ rows: [] }));

  const row = result.rows[0];
  if (!row) return null;
  return {
    order_id: row.id ?? null,
    order_number: pickFirst(row.public_order_number, row.display_order_number, row.order_number),
    order_status: pickFirst(row.status, row.order_status),
    payment_status: pickFirst(row.payment_status, row.paymentState),
    tracking_data: {
      shipment_id: pickFirst(row.shipment_id, row.shipping_provider_delivery_id, row.tracking_number),
      shipping_provider: pickFirst(row.shipping_provider, row.shipping_provider_id),
      shipping_status: pickFirst(row.shipping_status, row.delivery_status),
      tracking_number: pickFirst(row.tracking_number, row.shipment_tracking_number),
      delivery_status: pickFirst(row.delivery_status, row.shipping_status),
      eta: pickFirst(row.estimated_delivery_text, row.delivery_eta, row.estimated_delivery),
    },
  };
};

export const loadBusinessToolContext = async ({
  tenantId,
  conversation = null,
  conversationId = "",
  latestMessage = "",
  productContext = null,
  orderId = null,
} = {}) => {
  const warnings = [];
  const queryCounts = {
    db_reads_count: 0,
    product_fact_queries_count: 0,
    inventory_queries_count: 0,
    shipping_queries_count: 0,
    policy_queries_count: 0,
    order_queries_count: 0,
  };
  const safeTenantId = Number(tenantId);
  const currentProduct = productContext?.id || productContext?.product_id || null;
  const maybeOrderId = orderId || conversation?.order_id || conversation?.draft_order?.order_id || conversation?.draft_order?.id || null;
  queryCounts.product_fact_queries_count += 1;
  queryCounts.inventory_queries_count += 1;
  queryCounts.shipping_queries_count += 1;
  queryCounts.policy_queries_count += 1;
  queryCounts.order_queries_count += 1;
  queryCounts.db_reads_count = queryCounts.product_fact_queries_count + queryCounts.inventory_queries_count + queryCounts.shipping_queries_count + queryCounts.policy_queries_count + queryCounts.order_queries_count;
  const tasks = {
    product_facts: getProductFacts({
      tenantId: safeTenantId,
      productId: currentProduct,
      query: latestMessage,
      productName: productContext?.name || "",
      sku: productContext?.sku || "",
      slug: productContext?.slug || "",
    }).catch((error) => {
      warnings.push(`product_facts failed: ${error?.message || String(error)}`);
      return null;
    }),
    inventory_facts: getInventoryFacts({
      tenantId: safeTenantId,
      productId: currentProduct,
      query: latestMessage,
    }).catch((error) => {
      warnings.push(`inventory_facts failed: ${error?.message || String(error)}`);
      return null;
    }),
    shipping_facts: getShippingFacts({
      tenantId: safeTenantId,
      governorate: conversation?.governorate || conversation?.customer_profile?.governorate || "",
      city: conversation?.city_area || conversation?.customer_profile?.city_area || "",
      area: conversation?.customer_address || conversation?.customer_profile?.address || "",
      subtotal: conversation?.subtotal || conversation?.total_amount || 0,
    }).catch((error) => {
      warnings.push(`shipping_facts failed: ${error?.message || String(error)}`);
      return null;
    }),
    policy_facts: getPolicyFacts({ tenantId: safeTenantId }).catch((error) => {
      warnings.push(`policy_facts failed: ${error?.message || String(error)}`);
      return null;
    }),
    order_facts: getOrderFacts({
      tenantId: safeTenantId,
      orderId: maybeOrderId,
      conversationId,
      orderNumber: conversation?.public_order_number || conversation?.display_order_number || "",
    }).catch((error) => {
      warnings.push(`order_facts failed: ${error?.message || String(error)}`);
      return null;
    }),
  };

  const [product_facts, inventory_facts, shipping_facts, policy_facts, order_facts] = await Promise.all([
    tasks.product_facts,
    tasks.inventory_facts,
    tasks.shipping_facts,
    tasks.policy_facts,
    tasks.order_facts,
  ]);

  return {
    product_facts,
    inventory_facts,
    shipping_facts,
    policy_facts,
    order_facts,
    warnings,
    query_counts: queryCounts,
  };
};

export default {
  getProductFacts,
  getInventoryFacts,
  getShippingFacts,
  getPolicyFacts,
  getOrderFacts,
  loadBusinessToolContext,
};
