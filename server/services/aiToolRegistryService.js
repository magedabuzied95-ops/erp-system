/**
 * Tool registry — the ERP facts the model is allowed to ask for, as callable tools.
 *
 * Until now every fact was pre-fetched by JS before a single model call. Whatever the
 * pipeline author thought to load was all the model could ever know, so it could never
 * decide "I need to check size 44 in black specifically" — it could only work with
 * whatever generic bundle arrived. That ceiling is why the assistant answers a narrow
 * question with a broad answer.
 *
 * Every tool here wraps a service that already exists and is already used by the
 * grounded paths (aiBusinessToolsService, aiCustomer360Service, the product scorer).
 * Nothing new touches the database.
 *
 * Invariants:
 *   - Read-only. Nothing in this registry writes, sends, reserves or charges. Order
 *     creation stays behind human approval where it has always been.
 *   - Customer-safe output only. Cost, margin, supplier and wholesale never appear in
 *     a tool result, because tool results go into a prompt.
 *   - Every result carries a `source` so a claim in the final reply can be traced back
 *     to the tool that produced it. A number with no tool behind it is a hallucination
 *     and the caller can prove it.
 */
import { getInventoryFacts, getOrderFacts, getPolicyFacts, getProductFacts, getShippingFacts } from "./aiBusinessToolsService.js";
import { loadCustomer360 } from "./aiCustomer360Service.js";

const text = (value = "") => String(value ?? "").trim();
const asArray = (value) => (Array.isArray(value) ? value : []);

/** Fields that must never reach a prompt, whatever a wrapped service returns. */
const BLOCKED_FIELD_PATTERN = /(cost|margin|profit|supplier|wholesale|purchase_price|buy_price|internal|secret|token|api[_-]?key)/i;

const stripUnsafe = (value, depth = 0) => {
  if (depth > 6) return undefined;
  if (Array.isArray(value)) return value.map((item) => stripUnsafe(item, depth + 1)).filter((item) => item !== undefined);
  if (!value || typeof value !== "object") return value;
  return Object.entries(value).reduce((acc, [key, item]) => {
    if (BLOCKED_FIELD_PATTERN.test(key)) return acc;
    const safe = stripUnsafe(item, depth + 1);
    if (safe !== undefined) acc[key] = safe;
    return acc;
  }, {});
};

/**
 * Tool definitions in the shape the Responses API expects. Descriptions are written
 * for the model, so they say when NOT to call a tool as much as when to — an agent
 * that calls everything on every turn is slow and no more accurate.
 */
export const TOOL_DEFINITIONS = Object.freeze([
  {
    type: "function",
    name: "search_products",
    description:
      "Find products in the store catalog by name, model, category, brand or colour. Call this when the customer asks about a product you have not already looked up in this conversation. Do not call it twice with the same query.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["query"],
      properties: {
        query: { type: "string", description: "Product name, model, brand or category — not the whole customer sentence." },
      },
    },
  },
  {
    type: "function",
    name: "get_inventory",
    description:
      "Check real stock for a specific product, optionally narrowed to a size and colour. This is the ONLY way to know whether something is available — never state availability without calling it.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["product_id"],
      properties: {
        product_id: { type: ["integer", "string"], description: "Product id from search_products." },
        size: { type: ["string", "null"], description: "Size the customer asked for, if any." },
        color: { type: ["string", "null"], description: "Colour the customer asked for, if any." },
      },
    },
  },
  {
    type: "function",
    name: "get_shipping_quote",
    description:
      "Shipping cost and expected delivery for a governorate/city. Call only when the customer asks about shipping cost or timing, or names their area.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["governorate"],
      properties: {
        governorate: { type: "string" },
        city: { type: ["string", "null"] },
        area: { type: ["string", "null"] },
      },
    },
  },
  {
    type: "function",
    name: "get_policy",
    description:
      "Store policy: returns, exchanges, payment methods, cash on delivery. Call when the customer asks about a policy rather than guessing one.",
    parameters: { type: "object", additionalProperties: false, required: [], properties: {} },
  },
  {
    type: "function",
    name: "get_order_status",
    description:
      "Look up one order by its number. Call only when the customer is asking about an order they already placed.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["order_number"],
      properties: { order_number: { type: "string" } },
    },
  },
  {
    type: "function",
    name: "get_customer_history",
    description:
      "This customer's own past orders, the sizes they kept, and any shipment in progress. Call once at most, and only when their history would change the answer — for example before asking them for a size.",
    parameters: { type: "object", additionalProperties: false, required: [], properties: {} },
  },
]);

/**
 * Builds the executable side of the registry, bound to one tenant and conversation.
 *
 * @param {Function} searchProducts async ({ tenantId, query, limit }) => product[] —
 *        injected so the loop uses whatever retrieval the caller already configured
 *        (hybrid or phrase) instead of pinning its own.
 */
export const buildToolRegistry = ({ tenantId, customerPhone = "", searchProducts } = {}) => {
  const handlers = {
    search_products: async ({ query }) => {
      if (typeof searchProducts !== "function") return { error: "search_unavailable" };
      const products = asArray(await searchProducts({ tenantId, query: text(query), limit: 6 }));
      return {
        source: "catalog",
        query: text(query),
        count: products.length,
        products: products.slice(0, 6).map((product) => ({
          product_id: product.id ?? product.product_id ?? null,
          name: text(product.name || product.product_name || product.title),
          brand: text(product.brand || product.brand_name),
          category: text(product.category || product.category_name || product.product_type),
          price: Number(product.display_price ?? product.final_price ?? product.price ?? 0) || null,
          total_stock: Number(product.total_stock ?? product.stock ?? 0) || 0,
          product_url: text(product.product_url || product.url),
        })),
      };
    },

    get_inventory: async ({ product_id: productId, size, color }) => {
      const facts = await getInventoryFacts({ tenantId, productId });
      if (!facts) return { source: "inventory", found: false };

      const wantedSize = text(size);
      const wantedColor = text(color);
      const variants = asArray(facts.variant_stock);
      // Narrowing happens here rather than in SQL so the unfiltered picture is still
      // available to explain WHY the exact request is unavailable.
      const matching = variants.filter(
        (variant) =>
          (!wantedSize || text(variant.size).toLowerCase() === wantedSize.toLowerCase()) &&
          (!wantedColor || text(variant.color).toLowerCase() === wantedColor.toLowerCase())
      );

      return {
        source: "inventory",
        found: true,
        product_id: productId,
        requested: { size: wantedSize || null, color: wantedColor || null },
        // The answer to "is it available" — explicitly null when nothing was requested
        // to narrow on, so the model cannot read a general yes as a specific yes.
        exact_match_in_stock: wantedSize || wantedColor ? matching.some((variant) => variant.in_stock) : null,
        matching_variants: matching.slice(0, 12),
        available_sizes: facts.available_sizes,
        available_colors: facts.available_colors,
        any_in_stock: facts.in_stock === true,
      };
    },

    get_shipping_quote: async ({ governorate, city, area }) => {
      const facts = await getShippingFacts({
        tenantId,
        governorate: text(governorate),
        city: text(city),
        area: text(area),
      });
      if (!facts) return { source: "shipping", found: false };
      return {
        source: "shipping",
        found: true,
        requested: { governorate: text(governorate), city: text(city) || null, area: text(area) || null },
        estimated: facts.estimated_delivery,
        default_price: facts.shipping_rules?.default_shipping_price ?? null,
        cod_allowed: facts.shipping_rules?.cod_allowed ?? null,
      };
    },

    get_policy: async () => {
      const facts = await getPolicyFacts({ tenantId });
      return facts ? { source: "policy", found: true, ...facts } : { source: "policy", found: false };
    },

    get_order_status: async ({ order_number: orderNumber }) => {
      const facts = await getOrderFacts({ tenantId, orderNumber: text(orderNumber) });
      return facts ? { source: "orders", found: true, ...facts } : { source: "orders", found: false };
    },

    get_customer_history: async () => {
      const profile = await loadCustomer360({ tenantId, phone: customerPhone });
      if (!profile.found) return { source: "customer", found: false };
      return {
        source: "customer",
        found: true,
        total_orders: profile.total_orders,
        purchased_sizes: profile.purchased_sizes,
        purchased_colors: profile.purchased_colors,
        returns_count: profile.returns_count,
        open_shipments: profile.open_shipments,
        cod_enabled: profile.cod_enabled,
      };
    },
  };

  /**
   * Runs one tool call. Never throws: a tool failure is a fact the model should see
   * and route around, not an exception that kills the reply.
   */
  const execute = async (name, args = {}) => {
    const handler = handlers[name];
    if (!handler) return { error: "unknown_tool", tool: name };
    try {
      const result = await handler(args || {});
      return stripUnsafe(result) ?? { error: "empty_result", tool: name };
    } catch (error) {
      console.warn("[ai-tools] call failed", { tool: name, tenant_id: tenantId, message: error?.message });
      return { error: "tool_failed", tool: name };
    }
  };

  return { definitions: TOOL_DEFINITIONS, execute, toolNames: Object.keys(handlers) };
};

export const __testing = { stripUnsafe, BLOCKED_FIELD_PATTERN };
