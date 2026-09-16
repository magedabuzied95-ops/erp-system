/*
 * An exchange arranged in chat, not at the till.
 *
 * The POS exchange assumes the customer is standing at the counter: the piece is already
 * in the staff member's hand, a drawer is open, and the difference is paid on the spot.
 * None of that is true of an order delivered to a flat in Alexandria. There the courier
 * does both halves in one trip - hands over the replacement, takes the old piece back -
 * so this module records the same two documents the POS writes (a return on the original,
 * a new order for the replacement) and lets the shelf and the money settle at the speed
 * the parcel actually moves:
 *
 *   - the return is written NOW, with the refund parked as store credit, because the
 *     invoice, the loyalty points and the original order's status must not wait;
 *   - the credit is spent immediately by the replacement order, so the customer is never
 *     left holding credit they did not ask for - only a genuine surplus (the replacement
 *     is cheaper) stays in the wallet;
 *   - the piece itself returns to stock only when Bosta says it came back
 *     (receiveExchangeReturn), so a customer who never hands it over cannot invent a
 *     sellable unit on the shelf.
 */
import db from "../../database/db.js";
import { returnOrder } from "../../controllers/ordersController.js";
import { confirmAiOrder, createAiOrderDraftLines } from "../../services/aiAgentOrderService.js";
import { adjustVariantStock } from "../../services/inventoryService.js";
import { recordWalletTransaction } from "../../services/walletService.js";
import { postWalletLiabilityEntry } from "../../services/accountingService.js";
import { getTenantId } from "../../utils/requestScope.js";
import { orderReachedCustomer } from "./inboxConversationOrders.js";
export { describeExchangeReturnParcel, exchangeParcelContextOf } from "./exchangeParcel.js";

const text = (value = "") => String(value ?? "").trim();
const money = (value) => Math.round((Number(value) || 0) * 100) / 100;

const invalid = (message, code = "EXCHANGE_INVALID", status = 400) =>
  Object.assign(new Error(message), { status, code });

/**
 * The lines the courier takes back, checked against what the invoice actually sold.
 * Pure: the same rules the endpoint applies, without a database.
 */
export const planExchangeReturn = ({ items = [], requestedLines = [] } = {}) => {
  const byId = new Map((items || []).map((item) => [String(item.id), item]));
  const lines = [];
  for (const requested of Array.isArray(requestedLines) ? requestedLines : []) {
    const key = String(requested?.order_item_id ?? requested?.id ?? "");
    const item = byId.get(key);
    if (!item) throw invalid("سطر مش موجود في الفاتورة الأصلية", "EXCHANGE_LINE_NOT_ON_ORDER");
    const quantity = Math.floor(Number(requested?.quantity ?? 0) || 0);
    if (quantity <= 0) continue;
    const sold = Number(item.quantity || 0);
    const returned = Number(item.returned_quantity || 0);
    const returnable = sold - returned;
    if (returnable <= 0) throw invalid(`${item.product_name || "المنتج"} مرتجع بالكامل قبل كده`, "EXCHANGE_LINE_ALREADY_RETURNED");
    if (quantity > returnable) throw invalid(`الكمية أكبر من المتاح للاسترجاع في ${item.product_name || "المنتج"}`, "EXCHANGE_LINE_QUANTITY");
    // The gross line price for the units coming back. The server prorates the order-level
    // discount out of it before it becomes credit - see resolveRefundProrationFactor.
    const lineTotal = money(item.total_amount ?? (Number(item.unit_price || 0) * sold));
    const perUnit = sold > 0 ? lineTotal / sold : 0;
    lines.push({
      order_item_id: item.id,
      quantity,
      refund_amount: money(perUnit * quantity),
      product_name: text(item.product_name),
      color: text(item.color || item.variant_color),
      size: text(item.size || item.variant_size),
      variant_id: item.variant_id || null,
    });
  }
  if (!lines.length) throw invalid("اختار القطعة اللي هترجع", "EXCHANGE_NO_RETURN_LINES");
  return {
    lines,
    gross_return_value: money(lines.reduce((sum, line) => sum + line.refund_amount, 0)),
    items_count: lines.reduce((sum, line) => sum + line.quantity, 0),
  };
};

/**
 * What the customer pays, what the wallet keeps, what the courier collects.
 * `credit` is the server's prorated refund, never the client's figure.
 */
export const settleExchangeMoney = ({ credit = 0, newOrderTotal = 0 } = {}) => {
  const creditAmount = Math.max(0, money(credit));
  const total = Math.max(0, money(newOrderTotal));
  const applied = money(Math.min(creditAmount, total));
  return {
    exchange_credit: creditAmount,
    new_order_total: total,
    applied_credit: applied,
    // Positive: the replacement costs more and the courier collects the difference.
    collect_on_delivery: money(Math.max(0, total - applied)),
    // Positive: the replacement is cheaper and the rest stays as store credit.
    remaining_credit: money(Math.max(0, creditAmount - applied)),
    difference: money(total - creditAmount),
  };
};

const loadExchangeOriginal = async (client, { tenantId, orderId }) => {
  const orderResult = await client.query(
    `
    SELECT *
    FROM orders
    WHERE id = $1
      AND ($2::bigint IS NULL OR tenant_id = $2::bigint OR tenant_id IS NULL)
    LIMIT 1
    `,
    [orderId, tenantId]
  );
  const order = orderResult.rows[0];
  if (!order) throw invalid("الأوردر مش موجود", "EXCHANGE_ORDER_NOT_FOUND", 404);
  // An order whose goods never left the shop has nothing for the courier to collect.
  // The same rule the panel uses to show the button, so the two can never disagree.
  if (!orderReachedCustomer(order)) {
    throw invalid("الأوردر ده لسه ما وصلش العميل، مش هينفع استبدال", "EXCHANGE_ORDER_NOT_DELIVERED");
  }
  const items = (await client.query(`SELECT * FROM order_items WHERE order_id = $1 ORDER BY id ASC`, [order.id])).rows;
  return { order, items };
};

// returnOrder is an Express controller and stays one: the proration, the loyalty
// reversal, the coupon release and the manager push all live inside it, and an exchange
// must not grow a second copy of any of them that can drift.
const callReturnOrder = async (req, { orderId, body }) => {
  const returnReq = Object.create(req);
  returnReq.params = { ...(req?.params || {}), id: String(orderId) };
  returnReq.body = body;
  let payload = null;
  let statusCode = 200;
  const res = {
    status(code) { statusCode = code; return this; },
    json(value) { payload = value; return this; },
  };
  await returnOrder(returnReq, res);
  if (statusCode >= 400 || payload?.success === false) {
    throw invalid(
      payload?.message || "تعذر تسجيل المرتجع",
      payload?.code || "EXCHANGE_RETURN_FAILED",
      statusCode >= 400 ? statusCode : 400
    );
  }
  return payload;
};

/**
 * Create the exchange: a return on the original, a replacement order, one credit moving
 * between them. The replacement is created through the same path an inbox order takes,
 * so it is priced, stocked and shipped exactly like any other online order.
 */
export const createOnlineExchange = async ({
  req,
  tenantId = null,
  orderId,
  returnLines = [],
  replacement = {},
  reason = "استبدال",
  conversationId = "",
} = {}) => {
  if (!orderId) throw invalid("رقم الأوردر مطلوب", "EXCHANGE_ORDER_REQUIRED");
  const client = await db.connect();
  let original;
  let originalItems;
  try {
    ({ order: original, items: originalItems } = await loadExchangeOriginal(client, { tenantId, orderId }));
  } finally {
    client.release();
  }
  if (!original.customer_id) {
    throw invalid("الأوردر مش مربوط بعميل، اربطه بعميل الأول عشان الرصيد يتسجل", "EXCHANGE_CUSTOMER_REQUIRED");
  }
  // The replacement belongs to the shop that sold the original, not to whoever is looking
  // at it: a super admin's request carries no tenant of its own.
  const shopTenantId = tenantId ?? original.tenant_id ?? null;

  const plan = planExchangeReturn({ items: originalItems, requestedLines: returnLines });
  const replacementLines = (Array.isArray(replacement.lines) ? replacement.lines : []).filter(
    (line) => line && (line.variant_id || line.product_id)
  );
  if (!replacementLines.length) throw invalid("اختار المنتج البديل", "EXCHANGE_NO_REPLACEMENT_LINES");

  // 1) The return. Store credit, and a shelf that waits for the courier.
  const returnResponse = await callReturnOrder(req, {
    orderId: original.id,
    body: {
      mode: "exchange",
      refund_method: "wallet",
      reason: text(reason) || "استبدال",
      defer_restock: true,
      items: plan.lines.map((line) => ({
        order_item_id: line.order_item_id,
        quantity: line.quantity,
        refund_amount: line.refund_amount,
      })),
      refund_amount: plan.gross_return_value,
    },
  });
  const credit = money(returnResponse?.refund_amount ?? returnResponse?.return?.refund_amount ?? 0);
  const returnId = returnResponse?.return?.id || null;

  // 2) The replacement order, through the ordinary inbox path: catalogue prices, a
  // shipping quote, a stock lock and a SALE_OUT movement on confirm.
  const conversation = text(conversationId || original.ai_agent_conversation_id) || `exchange:${original.id}`;
  const draft = await createAiOrderDraftLines({
    tenant_id: shopTenantId,
    conversation_id: conversation,
    session_id: conversation,
    channel: text(replacement.channel || original.channel || "whatsapp"),
    lines: replacementLines,
    payment_method: text(replacement.payment_method) || "cash_on_delivery",
    discount_type: replacement.discount_type || "amount",
    discount_value: replacement.discount_value || 0,
    discount_reason: replacement.discount_reason || "",
    shipping_cost: replacement.shipping_cost,
    customer_id: original.customer_id,
    customer_name: text(replacement.customer_name || original.customer_name),
    customer_phone: text(replacement.customer_phone || original.customer_phone),
    customer_secondary_phone: text(replacement.customer_secondary_phone || original.customer_secondary_phone),
    customer_address: text(replacement.customer_address || original.customer_address),
    governorate: text(replacement.governorate || original.governorate),
    city_area: text(replacement.city_area || original.city_area),
    shipping_provider: text(replacement.shipping_provider || original.shipping_provider || "bosta"),
    shipping_provider_id: text(replacement.shipping_provider_id || replacement.shipping_provider || original.shipping_provider_id || "bosta"),
    shipping_city_id: text(replacement.shipping_city_id || original.shipping_city_id),
    shipping_zone_id: text(replacement.shipping_zone_id || original.shipping_zone_id),
    shipping_district_id: text(replacement.shipping_district_id || original.shipping_district_id),
    district_id: text(replacement.district_id || replacement.shipping_district_id || original.district_id),
    street_address: text(replacement.street_address || replacement.customer_address || original.street_address || original.customer_address),
    building_number: text(replacement.building_number || original.building_number),
    floor_number: text(replacement.floor_number || original.floor_number),
    apartment_number: text(replacement.apartment_number || original.apartment_number),
    landmark: text(replacement.landmark || original.landmark),
    allow_missing_phone: true,
    notes: text(replacement.notes) || `استبدال فاتورة ${original.invoice_number || original.id}`,
    // Two taps on the button must not book two parcels for one exchange.
    idempotency_key: text(replacement.idempotency_key) || `exchange:${original.id}:${returnId || ""}`,
  });
  // A repeat submit lands on the same draft; confirming an order that is already
  // confirmed would fail, and the stock was taken the first time.
  const confirmed = draft.duplicate && String(draft.order?.ai_agent_status || "") !== "ai_draft"
    ? null
    : await confirmAiOrder({
        tenant_id: shopTenantId,
        order_id: draft.order?.id,
        user_id: req?.user?.id || null,
      });
  const newOrder = confirmed?.order || draft.order;

  // 3) The credit is spent on the replacement, and only the difference is collected.
  const settlement = settleExchangeMoney({ credit, newOrderTotal: newOrder?.total_amount ?? newOrder?.total ?? 0 });
  const applied = await applyExchangeCredit({
    tenantId: shopTenantId,
    original,
    newOrderId: newOrder?.id,
    returnId,
    settlement,
    plan,
    userId: req?.user?.id || null,
  });

  return {
    original_order: { id: original.id, invoice_number: original.invoice_number || "" },
    return: returnResponse?.return || null,
    return_lines: plan.lines,
    order: applied.order || newOrder,
    settlement,
    duplicate: Boolean(draft.duplicate),
  };
};

/**
 * Spend the credit on the replacement order and write the exchange onto it: the columns
 * the POS exchange uses wherever they exist, and the metadata every screen can read.
 */
export const applyExchangeCredit = async ({
  tenantId = null,
  original = {},
  newOrderId,
  returnId = null,
  settlement,
  plan = null,
  userId = null,
} = {}) => {
  if (!newOrderId) return { order: null };
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const columns = new Set(
      (await client.query(
        `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'orders'`
      )).rows.map((row) => row.column_name)
    );
    const sets = [];
    const values = [newOrderId];
    const push = (column, value) => {
      if (!columns.has(column)) return;
      values.push(value);
      sets.push(`${column} = $${values.length}`);
    };
    push("exchange_mode", true);
    push("original_order_id", original.id);
    push("exchange_credit_amount", settlement.exchange_credit);
    push("new_order_total", settlement.new_order_total);
    push("amount_due_now", settlement.collect_on_delivery);
    push("exchange_difference", settlement.difference);
    push("exchange_invoice_number", text(original.invoice_number));
    // The courier collects the difference, never the whole replacement: the rest was
    // already paid for by the piece he is carrying back.
    push("cod_amount", settlement.collect_on_delivery);
    push("paid_amount", settlement.applied_credit);
    push("remaining_amount", settlement.collect_on_delivery);
    push("payment_status", settlement.collect_on_delivery > 0 ? "partially_paid" : "paid");
    if (columns.has("payment_breakdown")) {
      values.push(JSON.stringify([
        {
          method: "exchange_credit",
          amount: settlement.applied_credit,
          original_order_id: original.id,
          invoice_number: text(original.invoice_number),
        },
      ]));
      sets.push(`payment_breakdown = $${values.length}::jsonb`);
    }
    if (columns.has("ai_agent_metadata")) {
      values.push(JSON.stringify({
        exchange: {
          original_order_id: original.id,
          original_invoice_number: text(original.invoice_number),
          return_id: returnId,
          credit: settlement.exchange_credit,
          applied_credit: settlement.applied_credit,
          collect_on_delivery: settlement.collect_on_delivery,
          remaining_credit: settlement.remaining_credit,
          pending_restock: true,
          return_lines: plan?.lines || [],
        },
      }));
      sets.push(`ai_agent_metadata = COALESCE(ai_agent_metadata, '{}'::jsonb) || $${values.length}::jsonb`);
    }
    const updated = sets.length
      ? (await client.query(`UPDATE orders SET ${sets.join(", ")}, updated_at = NOW() WHERE id = $1 RETURNING *`, values)).rows[0]
      : null;

    // The credit came back to the shop the moment it was spent. Without this debit the
    // customer would keep store credit worth the piece they just handed over.
    if (settlement.applied_credit > 0 && original.customer_id) {
      await recordWalletTransaction(client, {
        tenantId,
        customerId: original.customer_id,
        type: "order_payment",
        amount: -settlement.applied_credit,
        orderId: newOrderId,
        referenceType: "exchange",
        referenceId: newOrderId,
        notes: `رصيد استبدال فاتورة ${original.invoice_number || original.id}`,
        userId,
      });
      try {
        await postWalletLiabilityEntry(client, {
          tenantId,
          amount: settlement.applied_credit,
          direction: "debit",
          referenceType: "exchange",
          referenceId: newOrderId,
          description: "Exchange credit used on the replacement order",
          createdBy: userId,
          branchId: original.branch_id || null,
          notes: `Exchange of invoice ${original.invoice_number || original.id}`,
        });
      } catch (accountingError) {
        console.error("[exchange] wallet usage accounting fallback", accountingError.message);
      }
    }
    await client.query("COMMIT");
    return { order: updated };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
};

/**
 * The piece is back with us: put it on the shelf. Called when Bosta reports the exchange
 * parcel delivered (the swap happened at the door), and safe to call twice - the return
 * row records that it has already been received.
 */
export const receiveExchangeReturn = async ({ tenantId = null, returnId, userId = null, source = "bosta" } = {}) => {
  if (!returnId) return { restocked: false, reason: "no_return" };
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const returnRow = (await client.query(
      `
      SELECT *
      FROM returns
      WHERE id = $1
        AND ($2::bigint IS NULL OR tenant_id = $2::bigint OR tenant_id IS NULL)
      FOR UPDATE
      `,
      [returnId, tenantId]
    )).rows[0];
    if (!returnRow) {
      await client.query("ROLLBACK");
      return { restocked: false, reason: "not_found" };
    }
    const metadata = returnRow.metadata && typeof returnRow.metadata === "object" ? returnRow.metadata : {};
    if (!metadata.pending_restock) {
      await client.query("ROLLBACK");
      return { restocked: false, reason: metadata.restock_received_at ? "already_received" : "not_deferred" };
    }
    const lines = (await client.query(
      `
      SELECT ri.*, oi.product_id, oi.product_name
      FROM return_items ri
      LEFT JOIN order_items oi ON oi.id = ri.order_item_id
      WHERE ri.return_id = $1
      `,
      [returnRow.id]
    )).rows;
    let restocked = 0;
    for (const line of lines) {
      const quantity = Number(line.quantity || 0);
      if (!line.variant_id || quantity <= 0) continue;
      await adjustVariantStock(client, {
        tenantId,
        variantId: line.variant_id,
        productId: line.product_id,
        quantityChange: quantity,
        movementType: "RETURN_IN",
        referenceType: "return",
        referenceId: returnRow.id,
        reason: "Exchange piece collected by the courier",
        notes: `Exchange return ${returnRow.return_number || returnRow.id} (${source})`,
        createdBy: userId,
      });
      restocked += quantity;
    }
    await client.query(
      `
      UPDATE returns
      SET metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb
      WHERE id = $1
      `,
      [returnRow.id, JSON.stringify({ pending_restock: false, restock_received_at: new Date().toISOString(), restock_source: source })]
    );
    await client.query("COMMIT");
    console.log("[exchange] returned pieces are back on the shelf", { return_id: returnRow.id, quantity: restocked, source });
    return { restocked: restocked > 0, quantity: restocked, return_id: returnRow.id };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[exchange] receiving the returned pieces failed", { return_id: returnId, message: error?.message });
    throw error;
  } finally {
    client.release();
  }
};

/**
 * POST /orders/:id/exchange - the staff member arranging the swap in the conversation.
 * Nothing here decides money: the credit is the server's prorated refund and the amount
 * the courier collects is computed from it, whatever the browser sent.
 */
export const createOnlineExchangeController = async (req, res) => {
  const tenantId = getTenantId(req, req.user?.tenant_id ?? req.user?.tenantId ?? null);
  try {
    const result = await createOnlineExchange({
      req,
      tenantId,
      orderId: req.params.id,
      returnLines: Array.isArray(req.body?.return_lines) ? req.body.return_lines : req.body?.returned_items,
      replacement: req.body?.replacement || req.body?.new_order || {},
      reason: req.body?.reason || "استبدال",
      conversationId: req.body?.conversation_id || req.body?.session_id || "",
    });
    console.log("[exchange] created", {
      tenant_id: tenantId,
      original_order_id: result.original_order?.id || null,
      new_order_id: result.order?.id || null,
      credit: result.settlement?.exchange_credit,
      collect_on_delivery: result.settlement?.collect_on_delivery,
      user_id: req.user?.id || null,
    });
    return res.json({ success: true, ...result });
  } catch (error) {
    console.error("[exchange] failed", { tenant_id: tenantId, order_id: req.params?.id, message: error?.message, code: error?.code });
    return res.status(error?.status || 500).json({
      success: false,
      code: error?.code || "EXCHANGE_FAILED",
      message: error?.message || "تعذر إنشاء الاستبدال",
    });
  }
};
