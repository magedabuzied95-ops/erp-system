// AI Workflow Tool Registry
// ---------------------------------------------------------------------------
// A centralized, EXPLICIT allowlist of ERP capabilities the workflow executor may
// invoke. Nothing is auto-exposed: every tool is registered here with metadata and a
// handler that calls an EXISTING service (no business logic is duplicated in handlers).
//
// Risk model (see docs/ai-studio-audit.md §10):
//   READ      – safe reads; may auto-execute.
//   WRITE     – non-destructive writes; require approval by default (configurable later).
//   SENSITIVE – destructive / customer-facing / financial; NEVER auto-execute. The
//               executor refuses to run these without an approved approval record.
//
// Handlers must be pure orchestration over existing services and must respect tenantId.

import * as businessTools from "./aiBusinessToolsService.js";
import { searchAiOrderProducts, confirmAiOrder, updateAiOrderStatus } from "./aiAgentOrderService.js";

export const RISK = Object.freeze({ READ: "READ", WRITE: "WRITE", SENSITIVE: "SENSITIVE" });

// requiresApproval defaults: READ=false, WRITE=true (conservative for Phase 2),
// SENSITIVE=true (and additionally can never be auto-run — enforced in the executor).
const TOOLS = [
  {
    id: "products.search",
    name: "Search products",
    description: "Search the product catalog for items matching a free-text query.",
    category: "products",
    riskLevel: RISK.READ,
    requiredPermission: "products.view",
    inputSchema: { query: { type: "string", required: true, description: "Search text" } },
    outputDescription: "A list of matching products (id, name, price, stock summary).",
    requiresApproval: false,
    executable: true,
    handler: async ({ tenantId, input }) => {
      const result = await searchAiOrderProducts({ tenantId, message: String(input?.query || "") });
      return { products: Array.isArray(result?.products) ? result.products : result?.matches || result || [] };
    },
  },
  {
    id: "products.facts",
    name: "Get product facts",
    description: "Fetch grounded facts about a product by id, name, sku or query.",
    category: "products",
    riskLevel: RISK.READ,
    requiredPermission: "products.view",
    inputSchema: {
      productId: { type: "number", required: false },
      query: { type: "string", required: false },
      sku: { type: "string", required: false },
    },
    outputDescription: "Structured product facts (attributes, pricing, availability).",
    requiresApproval: false,
    executable: true,
    handler: async ({ tenantId, input }) =>
      businessTools.getProductFacts({ tenantId, productId: input?.productId || null, query: String(input?.query || ""), sku: String(input?.sku || "") }),
  },
  {
    id: "inventory.check_stock",
    name: "Check stock",
    description: "Check inventory / stock availability for a product or variant.",
    category: "inventory",
    riskLevel: RISK.READ,
    requiredPermission: "products.view",
    inputSchema: {
      productId: { type: "number", required: false },
      variantId: { type: "number", required: false },
      query: { type: "string", required: false },
    },
    outputDescription: "Stock levels and availability facts.",
    requiresApproval: false,
    executable: true,
    handler: async ({ tenantId, input }) =>
      businessTools.getInventoryFacts({ tenantId, productId: input?.productId || null, variantId: input?.variantId || null, query: String(input?.query || "") }),
  },
  {
    id: "orders.status",
    name: "Get order status",
    description: "Look up an order and its current status by order id / number.",
    category: "orders",
    riskLevel: RISK.READ,
    requiredPermission: "orders.view",
    inputSchema: {
      orderId: { type: "number", required: false },
      orderNumber: { type: "string", required: false },
      conversationId: { type: "string", required: false },
    },
    outputDescription: "Order facts including status and line items.",
    requiresApproval: false,
    executable: true,
    handler: async ({ tenantId, input }) =>
      businessTools.getOrderFacts({ tenantId, orderId: input?.orderId || null, orderNumber: String(input?.orderNumber || ""), conversationId: String(input?.conversationId || "") }),
  },
  {
    id: "shipping.facts",
    name: "Get shipping facts",
    description: "Fetch shipping options/cost facts for a destination and subtotal.",
    category: "shipping",
    riskLevel: RISK.READ,
    requiredPermission: "orders.view",
    inputSchema: {
      governorate: { type: "string", required: false },
      city: { type: "string", required: false },
      subtotal: { type: "number", required: false },
    },
    outputDescription: "Shipping zones / cost facts.",
    requiresApproval: false,
    executable: true,
    handler: async ({ tenantId, input }) =>
      businessTools.getShippingFacts({ tenantId, governorate: String(input?.governorate || ""), city: String(input?.city || ""), subtotal: Number(input?.subtotal || 0) }),
  },
  {
    id: "policy.facts",
    name: "Get store policies",
    description: "Fetch store policy facts (returns, warranty, etc.).",
    category: "policy",
    riskLevel: RISK.READ,
    requiredPermission: "settings.view",
    inputSchema: {},
    outputDescription: "Policy facts text.",
    requiresApproval: false,
    executable: true,
    handler: async ({ tenantId }) => businessTools.getPolicyFacts({ tenantId }),
  },
  // ---- WRITE (non-destructive) — described only in Phase 2 (not wired to avoid shape drift) ----
  {
    id: "leads.create_opportunity",
    name: "Create lead opportunity",
    description: "Create/update a non-destructive lead opportunity from a conversation. Registered and approval-gated; not wired to an executor handler in Phase 2.",
    category: "crm",
    riskLevel: RISK.WRITE,
    requiredPermission: "settings.edit",
    inputSchema: {
      conversation: { type: "object", required: true, description: "Conversation object" },
      profile: { type: "object", required: false, description: "Customer profile object" },
    },
    outputDescription: "The created/updated lead opportunity.",
    requiresApproval: true,
    executable: false,
    handler: null,
  },
  // ---- SENSITIVE — registered/described, NEVER auto-executed (approval enforced) ----
  {
    id: "orders.confirm",
    name: "Confirm order",
    description: "Commit an AI draft order into a real order. Financial side effect.",
    category: "orders",
    riskLevel: RISK.SENSITIVE,
    requiredPermission: "orders.edit",
    inputSchema: { draftId: { type: "string", required: true } },
    outputDescription: "The confirmed order.",
    requiresApproval: true,
    executable: true,
    handler: async ({ tenantId, input, actorUserId }) => confirmAiOrder({ tenantId, tenant_id: tenantId, created_by: actorUserId, ...(input || {}) }),
  },
  {
    id: "orders.update_status",
    name: "Update order status",
    description: "Change the status of an existing order. Operational side effect.",
    category: "orders",
    riskLevel: RISK.SENSITIVE,
    requiredPermission: "orders.edit",
    inputSchema: { orderId: { type: "number", required: true }, status: { type: "string", required: true } },
    outputDescription: "The updated order.",
    requiresApproval: true,
    executable: true,
    handler: async ({ tenantId, input, actorUserId }) =>
      updateAiOrderStatus({ tenantId, orderId: input?.orderId, status: String(input?.status || ""), updatedBy: actorUserId }),
  },
  {
    id: "messaging.send_customer",
    name: "Send customer message",
    description: "Send a message to a customer on a connected channel. Customer-facing side effect.",
    category: "messaging",
    riskLevel: RISK.SENSITIVE,
    requiredPermission: "settings.edit",
    inputSchema: { conversationId: { type: "string", required: true }, text: { type: "string", required: true } },
    outputDescription: "Send result.",
    requiresApproval: true,
    // Not wired to an executor handler in Phase 2 — described only, to avoid any accidental
    // outbound send. Registering it documents the capability + approval requirement.
    executable: false,
    handler: null,
  },
];

const TOOLS_BY_ID = new Map(TOOLS.map((tool) => [tool.id, tool]));

export const listTools = () =>
  TOOLS.map(({ handler, ...meta }) => ({ ...meta, hasHandler: typeof handler === "function" }));

export const getTool = (id) => TOOLS_BY_ID.get(String(id || "")) || null;

export const isKnownTool = (id) => TOOLS_BY_ID.has(String(id || ""));

// A SENSITIVE tool can never run without an approved approval, regardless of policy.
export const toolRequiresApproval = (id) => {
  const tool = getTool(id);
  if (!tool) return true;
  if (tool.riskLevel === RISK.SENSITIVE) return true;
  return Boolean(tool.requiresApproval);
};
