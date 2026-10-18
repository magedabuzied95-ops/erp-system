import db from "../../database/db.js";

// "+" on أوردرات الشحن: write a whole online order from the employee / manager portal —
// products and sizes, the customer, the Bosta address, payment and shipping. It goes
// through the SAME two calls the AI Inbox order composer makes (createAiOrderDraftLines
// then confirmAiOrder), so prices come from the canonical customer price, shipping from
// the zone price list, and the stock leaves with a SALE_OUT movement — nothing here
// prices or counts on its own.

const orderService = () => import("../../services/aiAgentOrderService.js");

const text = (value = "") => String(value ?? "").trim();
const CHANNELS = new Set(["whatsapp", "facebook", "instagram", "web_chat"]);
const PAYMENT_METHODS = new Set(["cash_on_delivery", "cash", "visa", "instapay", "vodafone_cash"]);
const CATALOG_LIMIT = 30;

const fail = (res, error, surface, fallback) => {
  if (!error.status || error.status >= 500) console.error(`[${surface}] new online order error`, error);
  return res.status(error.status || 500).json({
    success: false,
    code: error.code,
    message: error.message || fallback,
    out_of_stock: error.out_of_stock || undefined,
  });
};

const cleanLines = (lines) =>
  (Array.isArray(lines) ? lines : [])
    .map((line) => ({ variant_id: Number(line?.variant_id) || null, quantity: Math.max(1, Math.min(99, Number.parseInt(line?.quantity, 10) || 1)) }))
    .filter((line) => line.variant_id)
    .slice(0, 50);

const addressFields = (body = {}) => ({
  governorate: text(body.governorate),
  city_area: text(body.city_area),
  shipping_city_id: text(body.shipping_city_id),
  shipping_zone_id: text(body.shipping_zone_id),
  shipping_district_id: text(body.shipping_district_id),
  street_address: text(body.street_address),
  building_number: text(body.building_number),
  floor_number: text(body.floor_number),
  apartment_number: text(body.apartment_number),
  landmark: text(body.landmark),
});

// Products with at least one sellable size, matched on every word of the search
// (name, product code, or a size row's article code / SKU / barcode). An empty search
// is the newest stock, so the sheet is never blank on open.
export const searchPortalOrderCatalog = async ({ tenantId, query = "", client = db } = {}) => {
  const { loadOrderLineVariants, priceOrderLineVariant } = await orderService();
  const { getWebsiteSettings } = await import("../../services/liveActivityService.js");
  const words = text(query).split(/\s+/).filter(Boolean).slice(0, 5);
  const params = [tenantId];
  const wordClauses = words.map((word) => {
    params.push(`%${word}%`);
    const ref = `$${params.length}`;
    return `(
      p.name ILIKE ${ref} OR COALESCE(p.product_code, '') ILIKE ${ref} OR COALESCE(p.brand, '') ILIKE ${ref}
      OR EXISTS (
        SELECT 1 FROM product_variants sv
        WHERE sv.product_id = p.id AND sv.deleted_at IS NULL AND sv.is_active IS DISTINCT FROM FALSE
          AND (COALESCE(sv.article_code, '') ILIKE ${ref} OR COALESCE(sv.sku, '') ILIKE ${ref} OR COALESCE(sv.barcode, '') ILIKE ${ref}
            OR COALESCE(sv.color, '') ILIKE ${ref}
            OR (COALESCE(sv.stock, 0) > 0 AND TRIM(COALESCE(sv.size, '')) = TRIM(BOTH '%' FROM ${ref})))
      )
    )`;
  });
  const products = await client.query(
    `
    SELECT p.id, p.name, p.product_code,
           COALESCE(NULLIF(p.image_url, ''), NULLIF(p.image, ''), NULLIF(p.photo_url, ''), NULLIF(p.thumbnail_url, ''), '') AS image_url
    FROM products p
    WHERE p.tenant_id = $1::bigint
      AND COALESCE(p.is_active, TRUE) = TRUE
      AND COALESCE(NULLIF(LOWER(TRIM(p.status)), ''), 'active') NOT IN ('inactive', 'disabled', 'archived', 'deleted', 'draft')
      AND EXISTS (
        SELECT 1 FROM product_variants v
        WHERE v.product_id = p.id AND v.deleted_at IS NULL AND v.is_active IS DISTINCT FROM FALSE AND COALESCE(v.stock, 0) > 0
      )
      ${wordClauses.map((clause) => `AND ${clause}`).join("\n      ")}
    ORDER BY p.updated_at DESC NULLS LAST, p.id DESC
    LIMIT ${CATALOG_LIMIT}
    `,
    params
  );
  const productIds = products.rows.map((row) => Number(row.id));
  if (!productIds.length) return [];

  const variants = await client.query(
    `
    SELECT v.id, v.product_id, v.color, v.size, v.article_code, COALESCE(v.stock, 0)::int AS stock,
           COALESCE(NULLIF(v.image_url, ''), NULLIF(v.image, ''), NULLIF(v.photo_url, ''), NULLIF(v.thumbnail_url, ''), '') AS image_url
    FROM product_variants v
    WHERE v.product_id = ANY($1::bigint[]) AND v.deleted_at IS NULL AND v.is_active IS DISTINCT FROM FALSE
      AND COALESCE(v.stock, 0) > 0
    ORDER BY v.color ASC NULLS LAST, v.id ASC
    `,
    [productIds]
  );
  // Priced by the one authority orders are billed with, so the sheet shows the invoice price.
  const priceRows = await loadOrderLineVariants({ tenantId, variantIds: variants.rows.map((row) => Number(row.id)) });
  const settings = await getWebsiteSettings({ tenantId }).catch(() => ({}));
  const saleModeEnabled = Boolean(settings?.sale_mode_enabled);

  const byProduct = new Map(productIds.map((id) => [id, []]));
  for (const row of variants.rows) {
    const priced = priceRows.get(Number(row.id));
    if (!priced) continue;
    byProduct.get(Number(row.product_id))?.push({
      variant_id: Number(row.id),
      color: text(row.color),
      size: text(row.size),
      article_code: text(row.article_code),
      stock: Math.max(0, Number(row.stock) || 0),
      image_url: text(row.image_url),
      price: priceOrderLineVariant(priced, { saleModeEnabled }),
    });
  }
  return products.rows
    .map((row) => ({
      id: Number(row.id),
      name: text(row.name),
      product_code: text(row.product_code),
      image_url: text(row.image_url),
      variants: byProduct.get(Number(row.id)) || [],
    }))
    .filter((product) => product.variants.length);
};

// What the order will be billed, before it is written: the lines at the invoice price,
// the discount, and the shipping fee from the zone price list (or the typed override).
export const previewPortalOrder = async ({ tenantId, body = {} } = {}) => {
  const { loadOrderLineVariants, priceOrderLineVariant, resolveAiOrderShipping } = await orderService();
  const { getWebsiteSettings } = await import("../../services/liveActivityService.js");
  const lines = cleanLines(body.lines);
  const rows = await loadOrderLineVariants({ tenantId, variantIds: lines.map((line) => line.variant_id) });
  const settings = await getWebsiteSettings({ tenantId }).catch(() => ({}));
  const saleModeEnabled = Boolean(settings?.sale_mode_enabled);
  let subtotal = 0;
  const priced = lines.map((line) => {
    const row = rows.get(line.variant_id);
    if (!row) return { variant_id: line.variant_id, quantity: line.quantity, missing: true };
    const price = priceOrderLineVariant(row, { saleModeEnabled });
    subtotal += price * line.quantity;
    return { variant_id: line.variant_id, quantity: line.quantity, price, stock: Number(row.stock) || 0, short: (Number(row.stock) || 0) < line.quantity };
  });
  const discountType = text(body.discount_type).toLowerCase() === "percent" ? "percent" : "amount";
  const discountValue = Math.max(0, Number(body.discount_value) || 0);
  const rawDiscount = discountType === "percent" ? (subtotal * discountValue) / 100 : discountValue;
  const discount = Math.min(subtotal, Math.max(0, Math.round(rawDiscount * 100) / 100));
  const shipping = await resolveAiOrderShipping({ ...addressFields(body), shipping_cost: body.shipping_cost, net_subtotal: subtotal - discount });

  let advance = { required: false, amount: 0 };
  try {
    const { loadCodPolicySettings } = await import("../../services/storefrontShippingService.js");
    const { resolveCodPolicy } = await import("../../../shared/codPolicy.js");
    const policy = await loadCodPolicySettings().catch(() => undefined);
    const cod = resolveCodPolicy({ policy, governorate: text(body.governorate), shippingFee: shipping.cost, orderTotal: subtotal - discount + shipping.cost });
    advance = { required: !cod.cod_allowed, kind: cod.advance_kind || "shipping_fee", amount: cod.cod_allowed ? 0 : cod.advance_amount };
  } catch {
    // The closing-system hint is advice only; the price stands without it.
  }

  return {
    lines: priced,
    subtotal,
    discount,
    shipping_cost: shipping.cost,
    shipping_source: shipping.source,
    free_shipping_applied: shipping.free_shipping_applied,
    total: Math.max(0, subtotal - discount + shipping.cost),
    shipping_fee_advance: advance,
  };
};

const PAYMENT_SCOPES = new Set(["shipping_fee", "order_total"]);
const FEE_METHODS = new Set(["vodafone_cash", "instapay", "cash"]);

// 1) "الديبوزت مدفوع": the same step as the card's "تم دفع الشحن" (runPortalOrderAction, so the
//    timeline, the audit and the delayed WhatsApp receipt all match). 2) "ابعت رسالة التأكيد":
//    the order page's manual send, which carries the shipping-fee card when the governorate
//    pays in advance. Payment goes first, so the message never asks for money already in.
export const runCreateFollowups = async ({ actor, surface, orderId, body = {}, deps = {} } = {}) => {
  const runAction = deps.runAction || (async (args) => (await import("./shipping.portal.actions.js")).runPortalOrderAction(args));
  const sendConfirmation = deps.sendConfirmation
    || (async (id) => (await import("../../services/whatsappOrderConfirmationService.js")).sendOrderConfirmation({ id }, { force: true }));
  const actionSurface = surface.replace(/-/g, "_");
  const failure = (error) => ({ ok: false, code: text(error?.code) || "FAILED", message: text(error?.message) });
  const result = {};

  const scope = text(body.payment_received);
  if (PAYMENT_SCOPES.has(scope)) {
    const method = FEE_METHODS.has(text(body.payment_received_method)) ? text(body.payment_received_method) : "instapay";
    try {
      await runAction({
        actor,
        surface: actionSurface,
        orderId,
        action: "shipping_fee_paid",
        input: scope === "order_total" ? { method, scope } : { method },
      });
      result.payment = { ok: true, scope };
    } catch (error) {
      result.payment = failure(error);
    }
  }

  if (body.send_confirmation === true) {
    try {
      const sent = await sendConfirmation(orderId);
      result.confirmation = sent?.sent || sent?.queued
        ? { ok: true, queued: Boolean(sent.queued) }
        : { ok: false, code: text(sent?.reason) || "CONFIRMATION_NOT_SENT" };
    } catch (error) {
      const { isWhatsappNumberMissingError } = await import("../../utils/whatsappNotOnNumber.js");
      result.confirmation = isWhatsappNumberMissingError(error) ? { ok: false, code: "CUSTOMER_NOT_ON_WHATSAPP" } : failure(error);
    }
  }
  return result;
};

export const createPortalOnlineOrder = async ({ actor, surface, body = {} } = {}) => {
  const { createAiOrderDraftLines, confirmAiOrder, saveCustomerAddress } = await orderService();
  const tenantId = Number(actor?.tenant_id) || 0;
  if (!tenantId) throw Object.assign(new Error("Tenant is required"), { status: 400 });
  const lines = cleanLines(body.lines);
  if (!lines.length) throw Object.assign(new Error("Pick at least one product"), { status: 400, code: "NO_ORDER_LINES" });
  const customerName = text(body.customer_name);
  if (!customerName) throw Object.assign(new Error("Customer name is required"), { status: 400, code: "NAME_REQUIRED" });
  const address = addressFields(body);
  if (!address.governorate && !address.shipping_city_id) {
    throw Object.assign(new Error("Governorate is required"), { status: 400, code: "GOVERNORATE_REQUIRED" });
  }
  const channel = CHANNELS.has(text(body.channel)) ? text(body.channel) : "whatsapp";
  const paymentMethod = PAYMENT_METHODS.has(text(body.payment_method)) ? text(body.payment_method) : "cash_on_delivery";
  const actorName = text(actor?.name || actor?.full_name || actor?.employee_name || actor?.id);
  // One thread id per person, so the duplicate check (keyed on it + the sheet's
  // idempotency key) can catch a double tap without ever matching someone else's order.
  const conversationId = `portal:${surface}:${text(actor?.id) || "0"}`;
  const fullAddress = text(body.customer_address) || [
    address.street_address,
    address.building_number,
    address.floor_number,
    address.apartment_number,
    address.landmark,
    address.city_area,
    address.governorate,
  ].filter(Boolean).join(", ");

  const draft = await createAiOrderDraftLines({
    tenant_id: tenantId,
    conversation_id: conversationId,
    session_id: conversationId,
    channel,
    source: channel,
    lines,
    payment_method: paymentMethod,
    discount_type: body.discount_type || "amount",
    discount_value: body.discount_value || 0,
    discount_reason: text(body.discount_reason),
    shipping_cost: body.shipping_cost,
    customer_name: customerName,
    customer_phone: text(body.customer_phone),
    customer_secondary_phone: text(body.customer_secondary_phone),
    customer_address: fullAddress,
    ...address,
    shipping_provider: "bosta",
    shipping_provider_id: "bosta",
    district_id: address.shipping_district_id,
    notes: text(body.notes) || `Portal order (${surface}) · ${actorName}`,
    idempotency_key: text(body.idempotency_key),
  });

  // A repeat submit lands on the same draft; one already confirmed took its stock the first time.
  const confirmed = draft.duplicate && text(draft.order?.ai_agent_status) !== "ai_draft"
    ? null
    : await confirmAiOrder({ tenant_id: tenantId, order_id: draft.order?.id, user_id: null });
  const order = confirmed?.order || draft.order;

  saveCustomerAddress({
    tenantId,
    phone: text(body.customer_phone),
    customerName,
    address: { shipping_provider: "bosta", ...address },
  }).catch((error) => console.warn(`[${surface}] saving the address failed`, { message: error?.message }));

  // The two switches at the bottom of the sheet. The order already exists, so a refusal here is
  // reported back next to it, never thrown — the seller then finishes it from the card.
  const followups = draft.duplicate || !order?.id
    ? {}
    : await runCreateFollowups({ actor, surface, orderId: order.id, body });

  console.log(`[${surface}] portal online order created`, {
    tenant_id: tenantId,
    actor_id: actor?.id || null,
    order_id: order?.id || null,
    line_count: lines.length,
    duplicate: Boolean(draft.duplicate),
    followups,
  });
  return {
    followups,
    order: {
      id: order?.id || null,
      invoice_number: text(order?.invoice_number),
      public_order_number: text(order?.public_order_number),
      total: Number(order?.total_amount ?? order?.total ?? 0) || 0,
    },
    duplicate: Boolean(draft.duplicate),
  };
};

// loadActor(req, res) resolves the portal token (or answers the request itself and
// returns null). canCreate(actor) says whether this holder may write orders.
export const mountPortalCreateOrderRoutes = (router, { loadActor, surface, canCreate = async () => true }) => {
  const guard = async (req, res) => {
    res.set("Cache-Control", "no-store, private");
    const actor = await loadActor(req, res);
    if (!actor) return null;
    if (!(await canCreate(actor))) {
      res.status(403).json({ success: false, code: "ONLINE_ORDERS_ACTIONS_DISABLED", message: "Not allowed to create online orders" });
      return null;
    }
    return actor;
  };

  router.get("/:token/new-online-order/catalog", async (req, res) => {
    try {
      const actor = await guard(req, res);
      if (!actor) return;
      const products = await searchPortalOrderCatalog({ tenantId: actor.tenant_id, query: req.query?.q || "" });
      return res.json({ success: true, products });
    } catch (error) {
      return fail(res, error, surface, "Failed to load products");
    }
  });

  router.post("/:token/new-online-order/preview", async (req, res) => {
    try {
      const actor = await guard(req, res);
      if (!actor) return;
      return res.json({ success: true, ...(await previewPortalOrder({ tenantId: actor.tenant_id, body: req.body || {} })) });
    } catch (error) {
      return fail(res, error, surface, "Failed to price the order");
    }
  });

  router.post("/:token/new-online-order", async (req, res) => {
    try {
      const actor = await guard(req, res);
      if (!actor) return;
      return res.json({ success: true, ...(await createPortalOnlineOrder({ actor, surface, body: req.body || {} })) });
    } catch (error) {
      return fail(res, error, surface, "Failed to create the order");
    }
  });
};
