import db from "../database/db.js";
import { getConversationMemory, updateConversationMemory } from "./aiConversationMemory.js";
import {
  buildSocialCommentOrderSummaryMessageV2,
  matchSocialCommentColorInput,
  normalizeSocialCommentColorDisplay,
  parseSocialCommentColorQuickReplyPayload,
  sortSocialCommentAvailableSizes,
} from "./socialCommentPrivateReplyService.js";
import { createAddressRequest } from "./conversationAddressRequestService.js";
import { resolveSocialProductDisplayPrice } from "../utils/customerDisplayPrice.js";
import { sendCtaUrlMessage, sendTextMessage } from "./whatsappGatewayService.js";

/* ======================================================
   THE SAME SALE, ON WHATSAPP
   ------------------------------------------------------
   Messenger and Instagram run this flow off Meta quick replies and postbacks. WhatsApp has
   neither, no webhook of Meta's shape, and no comments at all — so the same steps are driven by
   what Evolution actually delivers reliably:

     colour  → the existing colour carousel's per-card button (choose_color:<variant_id>), which
               already ships; only the TAP was going nowhere useful.
     size    → typed. Evolution caps reply buttons at three and a shoe routinely has five to eight
               sizes, so a button row would silently drop the rest. The sizes are listed and the
               reply is matched against the ones that colour actually has.
     confirm → typed "تأكيد", matched the same way the Meta flow matches its confirm button.
     address → sendCtaUrlMessage: one real URL button, the proven interactive control here.

   The STATE is the same `sales_flow` shape the Meta flow writes, so a WhatsApp order shows up in
   the inbox looking like every other one, and the address link closes it through the same
   completeSocialCommentOrderFromAddressRequest.
====================================================== */

const text = (value = "") => String(value ?? "").trim();
const asArray = (value) => (Array.isArray(value) ? value : []);

export const WHATSAPP_SALES_FLOW_SOURCE = "whatsapp_sales_flow";

export const whatsappConversationId = (phone = "") => {
  const digits = text(phone).replace(/\D/g, "");
  return digits ? `whatsapp:${digits}` : "";
};

const salesFlowFromMemory = (conversationId = "") => {
  const memory = getConversationMemory(conversationId) || {};
  const flow = memory.sales_flow && typeof memory.sales_flow === "object" ? memory.sales_flow : {};
  return { memory, flow, step: text(flow.step || "") };
};

const persistFlow = ({ conversationId, productId, selectedSize = "", selectedColor = "", step = "", extra = {} }) => {
  if (!conversationId) return;
  updateConversationMemory(conversationId, {
    selectedSize: text(selectedSize),
    selectedColor: text(selectedColor),
    sales_flow: {
      product_id: Number(productId || 0) || null,
      selected_size: text(selectedSize),
      selected_color: text(selectedColor) || null,
      step: text(step),
      source: WHATSAPP_SALES_FLOW_SOURCE,
      ...(extra && typeof extra === "object" && !Array.isArray(extra) ? extra : {}),
    },
  });
  console.log("WHATSAPP_SALES_FLOW_STATE", {
    conversation_id: conversationId,
    product_id: Number(productId || 0) || null,
    size: text(selectedSize),
    color: text(selectedColor),
    step: text(step),
  });
};

// Same Phase 1 pricing contract as everywhere else: the price for much of this catalogue lives on
// the VARIANT in purchase_selling_price / manual_selling_price, never on the product row.
const PRICE_COLUMNS = `
  selling_price, sale_price, price, regular_price,
  purchase_selling_price, manual_selling_price, manual_price_override_active`;

const loadVariants = async ({ tenantId, productId, color = "", size = "" }) => {
  const safeProductId = Number(productId || 0);
  if (!Number.isFinite(safeProductId) || safeProductId <= 0) return [];
  const result = await db.query(
    `
    SELECT id, product_id, size, color, image_url, COALESCE(stock, 0) AS stock, ${PRICE_COLUMNS}
    FROM product_variants
    WHERE product_id = $1
      AND ($2::bigint <= 0 OR tenant_id = $2::bigint OR tenant_id IS NULL)
      AND COALESCE(stock, 0) > 0
      AND ($3::text = '' OR LOWER(TRIM(COALESCE(color, ''))) = LOWER(TRIM($3::text)))
      AND ($4::text = '' OR LOWER(TRIM(COALESCE(size, ''))) = LOWER(TRIM($4::text)))
    ORDER BY id ASC
    `,
    [safeProductId, Number(tenantId || 0), text(color), text(size)]
  ).catch(() => ({ rows: [] }));
  return asArray(result.rows);
};

const loadProduct = async ({ tenantId, productId }) => {
  const result = await db.query(
    `SELECT id, name, ${PRICE_COLUMNS} FROM products WHERE id = $1 AND ($2::bigint <= 0 OR tenant_id = $2::bigint OR tenant_id IS NULL) LIMIT 1`,
    [Number(productId || 0), Number(tenantId || 0)]
  ).catch(() => ({ rows: [] }));
  return result.rows?.[0] || null;
};

const resolvePrice = async ({ tenantId, product, variants }) => {
  const resolved = await resolveSocialProductDisplayPrice({
    tenantId,
    product: product || {},
    variants: asArray(variants),
    availableVariants: asArray(variants),
    context: { product_id: product?.id || null, product_name: product?.name || "" },
    callsite: "whatsappSalesFlowService.resolvePrice",
  }).catch(() => null);
  return text(resolved?.selected_display_price || "");
};

const uniqueColors = (rows = []) =>
  asArray(rows).map((row) => text(row?.color || "")).filter(Boolean)
    .filter((value, index, array) => array.indexOf(value) === index);

const send = async ({ phone, message }) =>
  sendTextMessage({ phone, message: text(message) }).catch((error) => {
    console.warn("WHATSAPP_SALES_FLOW_SEND_FAILED", { phone_suffix: text(phone).slice(-4), message: error?.message || String(error) });
    return null;
  });

/* ── the steps ─────────────────────────────────────────────────────────────────────────────── */

const presentSizes = async ({ tenantId, phone, conversationId, productId, color, product, leadText = "" }) => {
  const variants = await loadVariants({ tenantId, productId, color });
  const sizes = sortSocialCommentAvailableSizes(variants.map((row) => text(row.size)).filter(Boolean));
  const colorLabel = normalizeSocialCommentColorDisplay(color) || color;
  if (!sizes.length) {
    const allColors = uniqueColors(await loadVariants({ tenantId, productId }));
    await send({
      phone,
      message: `اللون ${colorLabel} خلص من كل المقاسات حالياً.${allColors.length ? `\n\nالمتاح دلوقتي: ${allColors.map((one) => normalizeSocialCommentColorDisplay(one) || one).join(" · ")}` : ""}`,
    });
    return { handled: true, reason: "whatsapp_color_sold_out" };
  }
  persistFlow({
    conversationId,
    productId,
    selectedColor: color,
    selectedSize: "",
    step: "awaiting_size",
    extra: { product_name: text(product?.name || ""), available_sizes: sizes },
  });
  await send({
    phone,
    message: `${text(leadText) || `✅ تمام، اللون ${colorLabel}.`}\n\nالمقاسات المتاحة في اللون ده:\n${sizes.join(" · ")}\n\nاكتبلي المقاس اللي محتاجه 👟`,
  });
  return { handled: true, reason: "whatsapp_size_options_sent" };
};

const sendSummary = async ({ tenantId, phone, conversationId, productId, color, size, product }) => {
  const variants = await loadVariants({ tenantId, productId, color, size });
  const priceUsed = await resolvePrice({ tenantId, product, variants });
  persistFlow({
    conversationId,
    productId,
    selectedColor: color,
    selectedSize: size,
    step: "awaiting_order_confirmation",
    extra: { product_name: text(product?.name || ""), price_used: priceUsed },
  });
  const summary = buildSocialCommentOrderSummaryMessageV2({
    productName: text(product?.name || ""),
    selectedSize: size,
    selectedColor: color,
    priceUsed,
  });
  await send({ phone, message: `${summary}\n\nاكتب «تأكيد» عشان نكمل ✅` });
  return { handled: true, reason: "whatsapp_order_summary_sent" };
};

const sendAddressLink = async ({ tenantId, phone, conversationId, flow, productId }) => {
  const request = await createAddressRequest({
    tenantId,
    sessionId: conversationId,
    channel: "whatsapp",
    customerName: text(flow?.customer_name || ""),
    customerPhone: text(phone),
  }).catch((error) => {
    console.warn("WHATSAPP_ADDRESS_LINK_FAILED", { conversation_id: conversationId, message: error?.message || String(error) });
    return null;
  });
  const url = text(request?.url || "");
  if (!/^https?:\/\//i.test(url)) {
    await send({ phone, message: "تمام ✅ فريق خدمة العملاء هيتواصل معاك حالاً ياخد بيانات الشحن ❤️" });
    return { handled: true, reason: "whatsapp_address_link_unavailable" };
  }
  persistFlow({
    conversationId,
    productId,
    selectedColor: text(flow?.selected_color || ""),
    selectedSize: text(flow?.selected_size || ""),
    step: "awaiting_address_link",
    extra: { ...flow, address_link: url },
  });
  const body = "☑ ممتاز\nفاضل بس بيانات الشحن 📦\nاضغط الزرار تحت وكمل بياناتك، وبعدها أكد الطلب ❤️";
  await sendCtaUrlMessage({
    phone,
    title: "بيانات الشحن",
    text: body,
    displayText: "إملا بيانات الشحن 📦",
    url,
    // Evolution does not always deliver a button; the link in the text is what keeps the sale.
    fallbackText: `${body}\n\n${url}`,
  }).catch(async (error) => {
    console.warn("WHATSAPP_ADDRESS_CTA_FAILED", { conversation_id: conversationId, message: error?.message || String(error) });
    await send({ phone, message: `${body}\n\n${url}` });
  });
  console.log("WHATSAPP_ADDRESS_LINK_SENT", { conversation_id: conversationId, url });
  return { handled: true, reason: "whatsapp_address_link_sent" };
};

/* ── the entry point ───────────────────────────────────────────────────────────────────────── */

const CONFIRM_WORDS = ["تأكيد", "تاكيد", "أكد", "اكد", "confirm", "ok", "تمام"];

export const handleWhatsappSalesFlow = async ({
  tenantId = 1,
  phone = "",
  buttonId = "",
  messageText = "",
} = {}) => {
  const conversationId = whatsappConversationId(phone);
  if (!conversationId) return { handled: false, reason: "missing_conversation_id" };
  const body = text(messageText);
  const tap = text(buttonId);
  const { flow, step } = salesFlowFromMemory(conversationId);
  // A handled:false used to be silent, which made a flow that simply did not match look identical
  // to a flow that never ran at all.
  console.log("WHATSAPP_SALES_FLOW_ENTER", { conversation_id: conversationId, button_id: tap, step, product_id: Number(flow?.product_id || 0) || null, text_preview: body.slice(0, 40) });

  // ── colour ──────────────────────────────────────────────────────────────────────────────────
  // A tap on a carousel card. The existing card button names the exact variant; the flow's own
  // colour payload is accepted too so the same handler serves both shapes.
  const variantTap = tap.match(/^choose_color:(\d+)$/);
  const colorPayload = parseSocialCommentColorQuickReplyPayload(tap);
  if (variantTap || colorPayload) {
    let productId = colorPayload?.product_id || null;
    let color = text(colorPayload?.color || "");
    if (variantTap) {
      const row = await db.query(
        `SELECT product_id, color FROM product_variants WHERE id = $1 LIMIT 1`,
        [Number(variantTap[1])]
      ).catch(() => ({ rows: [] }));
      const picked = row.rows?.[0];
      if (!picked?.product_id || !text(picked.color)) return { handled: false, reason: "variant_not_found" };
      productId = Number(picked.product_id);
      color = text(picked.color);
    }
    const product = await loadProduct({ tenantId, productId });
    if (!product) return { handled: false, reason: "product_not_found" };
    console.log("WHATSAPP_SALES_FLOW_COLOR_SELECTED", { conversation_id: conversationId, product_id: productId, color });
    // A tapped colour carries its own size and an empty one means "not chosen yet" — never fall
    // back to a size left on the conversation. Same rule as the Meta flow.
    const tappedSize = text(colorPayload?.size || "");
    if (tappedSize) {
      return sendSummary({ tenantId, phone, conversationId, productId, color, size: tappedSize, product });
    }
    return presentSizes({ tenantId, phone, conversationId, productId, color, product });
  }

  if (!body) return { handled: false, reason: "no_text" };

  // ── size ────────────────────────────────────────────────────────────────────────────────────
  if (step === "awaiting_size" && Number(flow?.product_id || 0) > 0) {
    const productId = Number(flow.product_id);
    const color = text(flow.selected_color || "");
    const requested = body.replace(/[^\p{L}\p{N}.\s]/gu, " ").trim();
    const available = await loadVariants({ tenantId, productId, color });
    const sizes = sortSocialCommentAvailableSizes(available.map((row) => text(row.size)).filter(Boolean));
    const matched = sizes.find((size) => requested === size)
      || sizes.find((size) => new RegExp(`(^|\\s)${size.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`).test(requested));
    if (!matched) {
      // Not a size — could be a question. Only answer when the message looks like a size attempt,
      // otherwise leave it to the AI rather than nagging a customer who asked something else.
      if (!/\d/.test(requested)) return { handled: false, reason: "not_a_size" };
      await send({
        phone,
        message: `المقاس ده مش متاح في اللون ${normalizeSocialCommentColorDisplay(color) || color}.\n\nالمتاح: ${sizes.join(" · ")}`,
      });
      return { handled: true, reason: "whatsapp_size_unavailable" };
    }
    const product = await loadProduct({ tenantId, productId });
    return sendSummary({ tenantId, phone, conversationId, productId, color, size: matched, product });
  }

  // ── confirm ─────────────────────────────────────────────────────────────────────────────────
  if (step === "awaiting_order_confirmation" && Number(flow?.product_id || 0) > 0) {
    const normalized = body.toLowerCase();
    if (!CONFIRM_WORDS.some((word) => normalized.includes(word.toLowerCase()))) {
      return { handled: false, reason: "not_a_confirmation" };
    }
    return sendAddressLink({ tenantId, phone, conversationId, flow, productId: Number(flow.product_id) });
  }

  // ── typed colour, no flow running ───────────────────────────────────────────────────────────
  if (step === "awaiting_color" && Number(flow?.product_id || 0) > 0) {
    const productId = Number(flow.product_id);
    const colors = uniqueColors(await loadVariants({ tenantId, productId }));
    const matchedColor = matchSocialCommentColorInput(body, colors);
    if (!matchedColor) return { handled: false, reason: "color_not_matched" };
    const product = await loadProduct({ tenantId, productId });
    return presentSizes({ tenantId, phone, conversationId, productId, color: matchedColor, product });
  }

  // Waiting on the address link and the customer typed instead: the chat cannot produce a Bosta
  // city, zone and district, so the link goes back rather than the text being parsed.
  if (step === "awaiting_address_link" && text(flow?.address_link || "")) {
    if (!/\d{5,}/.test(body) && body.split("\n").filter(Boolean).length < 2) {
      return { handled: false, reason: "not_address_shaped" };
    }
    await send({ phone, message: `عشان الشحن يوصلك صح، إملا العنوان من اللينك ده ودوس تأكيد 👇\n\n${text(flow.address_link)}` });
    return { handled: true, reason: "whatsapp_address_link_resent" };
  }

  return { handled: false, reason: "no_matching_step" };
};

export default { handleWhatsappSalesFlow, whatsappConversationId };
