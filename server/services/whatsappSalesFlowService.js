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
import { absolutePublicUploadUrl } from "../utils/publicUrl.js";
import { sendChoiceListMessage, sendCtaUrlMessage, sendImageMessage, sendReplyButtonsMessage, sendTextMessage } from "./whatsappGatewayService.js";

/* ======================================================
   THE SAME SALE, ON WHATSAPP
   ------------------------------------------------------
   Messenger and Instagram run this flow off Meta quick replies and postbacks. WhatsApp has
   neither, no webhook of Meta's shape, and no comments at all — so the same steps are driven by
   what Evolution actually delivers reliably:

     colour  → the existing colour carousel's per-card button (choose_color:<variant_id>), which
               already ships; only the TAP was going nowhere useful.
     size    → an interactive LIST. Reply buttons cap at three and a shoe routinely has five to
               eight sizes, so a button row would silently drop the rest; a list holds ten, and the
               sizes are already narrowed to the chosen colour. Each row id names the product, the
               colour and the size, so a tap is unambiguous on its own. A typed size still works,
               and the sizes are named in the text too, so nothing is lost if the list fails.
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

// The fields named as ARGUMENTS always win over `extra`. Callers pass `extra: { ...flow }` to
// carry the rest of the state forward, and `flow` still holds the PREVIOUS step — spreading it
// last silently overwrote the step being set. That is what left the address step recorded as
// `awaiting_order_confirmation`, so the submitted address found no flow waiting for it and the
// order was never created.
const EXPLICIT_FLOW_FIELDS = ["product_id", "selected_size", "selected_color", "step", "source"];

const persistFlow = ({ conversationId, productId, selectedSize = "", selectedColor = "", step = "", extra = {} }) => {
  if (!conversationId) return;
  const carried = extra && typeof extra === "object" && !Array.isArray(extra) ? { ...extra } : {};
  for (const field of EXPLICIT_FLOW_FIELDS) delete carried[field];
  updateConversationMemory(conversationId, {
    selectedSize: text(selectedSize),
    selectedColor: text(selectedColor),
    sales_flow: {
      ...carried,
      product_id: Number(productId || 0) || null,
      selected_size: text(selectedSize),
      selected_color: text(selectedColor) || null,
      step: text(step),
      source: WHATSAPP_SALES_FLOW_SOURCE,
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

// A list row id has to survive a round trip through WhatsApp and come back naming exactly one
// variant, so it carries the product and the colour with the size — a bare "42" would be as
// ambiguous as the typed reply it replaces. Kept well under WhatsApp's 200-character row id cap.
export const SIZE_ROW_PREFIX = "size:";
export const buildSizeRowId = ({ productId, color = "", size = "" }) =>
  `${SIZE_ROW_PREFIX}${Number(productId || 0)}:${encodeURIComponent(text(color))}:${encodeURIComponent(text(size))}`;

export const parseSizeRowId = (value = "") => {
  const raw = text(value);
  if (!raw.startsWith(SIZE_ROW_PREFIX)) return null;
  const parts = raw.slice(SIZE_ROW_PREFIX.length).split(":");
  if (parts.length < 3) return null;
  const productId = Number(parts[0] || 0) || null;
  if (!productId) return null;
  try {
    return { product_id: productId, color: decodeURIComponent(parts[1] || ""), size: decodeURIComponent(parts.slice(2).join(":")) };
  } catch {
    return null;
  }
};

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
  const lead = text(leadText) || `✅ تمام، اللون ${colorLabel}.`;
  // A list, not buttons: WhatsApp reply buttons cap at three and a shoe has five to eight sizes.
  // The sizes are already narrowed to this colour, so ten rows covers essentially everything; the
  // text still names every size, so nothing is hidden even when the list is truncated or fails.
  const listed = sizes.slice(0, 10);
  const overflow = sizes.length > listed.length ? sizes.slice(listed.length) : [];
  const bodyText = `${lead}\n\nالمقاسات المتاحة في اللون ده:\n${sizes.join(" · ")}`;
  await sendChoiceListMessage({
    phone,
    title: text(product?.name || "اختار المقاس"),
    description: `${bodyText}\n\nاضغط «اختار المقاس» وحدد مقاسك 👟`,
    buttonText: "اختار المقاس",
    sectionTitle: `مقاسات ${colorLabel}`.slice(0, 24),
    footer: overflow.length ? `ومقاسات كمان: ${overflow.join(" · ")}` : "M1 Store",
    rows: listed.map((size) => ({
      title: size,
      description: `${colorLabel} — مقاس ${size}`,
      rowId: buildSizeRowId({ productId, color, size }),
    })),
    // Whatever happens to the list, the sizes still arrive and a typed reply still works.
    fallbackText: `${bodyText}\n\nاكتبلي المقاس اللي محتاجه 👟`,
  }).catch(async (error) => {
    console.warn("WHATSAPP_SIZE_LIST_FAILED", { conversation_id: conversationId, message: error?.message || String(error) });
    await send({ phone, message: `${bodyText}\n\nاكتبلي المقاس اللي محتاجه 👟` });
  });
  return { handled: true, reason: "whatsapp_size_options_sent" };
};

// The order summary the owner asked for: the CHOSEN COLOUR's photo, the size and the price under
// it, and confirm / cancel underneath. Evolution's buttons payload carries no image, so the photo
// goes first with its own caption and the buttons follow — two bubbles, one summary.
//
// The button ids name the whole variant rather than a bare "confirm", so a tap is unambiguous on
// its own and cannot be confused with the separate order-confirmation flow's confirm_order ids.
export const SALE_CONFIRM_PREFIX = "sale_confirm:";
export const SALE_CANCEL_PREFIX = "sale_cancel:";

const buildSaleActionId = (prefix, { productId, color = "", size = "" }) =>
  `${prefix}${Number(productId || 0)}:${encodeURIComponent(text(color))}:${encodeURIComponent(text(size))}`;

export const parseSaleActionId = (value = "") => {
  const raw = text(value);
  const prefix = raw.startsWith(SALE_CONFIRM_PREFIX)
    ? SALE_CONFIRM_PREFIX
    : (raw.startsWith(SALE_CANCEL_PREFIX) ? SALE_CANCEL_PREFIX : "");
  if (!prefix) return null;
  const parts = raw.slice(prefix.length).split(":");
  if (parts.length < 3) return null;
  const productId = Number(parts[0] || 0) || null;
  if (!productId) return null;
  try {
    return {
      action: prefix === SALE_CONFIRM_PREFIX ? "confirm" : "cancel",
      product_id: productId,
      color: decodeURIComponent(parts[1] || ""),
      size: decodeURIComponent(parts.slice(2).join(":")),
    };
  } catch {
    return null;
  }
};

const sendSummary = async ({ tenantId, phone, conversationId, productId, color, size, product }) => {
  const variants = await loadVariants({ tenantId, productId, color, size });
  const priceUsed = await resolvePrice({ tenantId, product, variants });
  const colorLabel = normalizeSocialCommentColorDisplay(color) || color;
  persistFlow({
    conversationId,
    productId,
    selectedColor: color,
    selectedSize: size,
    step: "awaiting_order_confirmation",
    extra: { product_name: text(product?.name || ""), price_used: priceUsed },
  });

  const caption = [
    `👟 ${text(product?.name || "المنتج")}`,
    `🎨 اللون: ${colorLabel}`,
    `📏 المقاس: ${size}`,
    priceUsed ? `💵 السعر: ${priceUsed} جنيه` : "",
  ].filter(Boolean).join("\n");

  // The photo of the colour actually chosen, not the product's cover — a relative /uploads path
  // renders nothing, so it goes through the resolver first.
  const rawImage = text(variants[0]?.image_url || "");
  const imageUrl = rawImage ? absolutePublicUploadUrl(rawImage) : "";
  let photoSent = false;
  if (imageUrl) {
    photoSent = await sendImageMessage({ phone, imageUrl, caption })
      .then(() => true)
      .catch((error) => {
        console.warn("WHATSAPP_SUMMARY_IMAGE_FAILED", { conversation_id: conversationId, message: error?.message || String(error) });
        return false;
      });
  }
  // No photo, or the photo failed: the caption still has to reach the customer, so it rides the
  // buttons message instead of vanishing with the image.
  const buttonsBody = photoSent ? "هل ترغب في إتمام الطلب؟" : `${caption}\n\nهل ترغب في إتمام الطلب؟`;

  await sendReplyButtonsMessage({
    phone,
    title: "تفاصيل طلبك",
    description: buttonsBody,
    footer: "M1 Store",
    buttons: [
      { displayText: "✅ تأكيد الطلب", id: buildSaleActionId(SALE_CONFIRM_PREFIX, { productId, color, size }) },
      { displayText: "❌ إلغاء الطلب", id: buildSaleActionId(SALE_CANCEL_PREFIX, { productId, color, size }) },
    ],
    // Buttons are never guaranteed on WhatsApp; a typed "تأكيد" still works either way.
    fallbackText: `${caption}\n\nاكتب «تأكيد» عشان نكمل ✅`,
  }).catch(async (error) => {
    console.warn("WHATSAPP_SUMMARY_BUTTONS_FAILED", { conversation_id: conversationId, message: error?.message || String(error) });
    await send({ phone, message: `${caption}\n\nاكتب «تأكيد» عشان نكمل ✅` });
  });
  return { handled: true, reason: "whatsapp_order_summary_sent" };
};

const sendAddressLink = async ({ tenantId, phone, conversationId, flow, productId }) => {
  const request = await createAddressRequest({
    tenantId,
    sessionId: conversationId,
    channel: "whatsapp",
    customerName: text(flow?.customer_name || ""),
    customerPhone: text(phone),
    // The variant travels with the link. Conversation state lives in an in-process Map, so a
    // deploy between sending this and the customer filling it in would otherwise lose the order.
    salesFlow: {
      ...flow,
      product_id: Number(productId || 0) || null,
      selected_color: text(flow?.selected_color || ""),
      selected_size: text(flow?.selected_size || ""),
    },
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

  // ── confirm / cancel, tapped ────────────────────────────────────────────────────────────────
  // The id names the whole variant, so the tap stands on its own even if the conversation state
  // was lost — and it cannot be confused with the separate order-confirmation flow's ids.
  const saleAction = parseSaleActionId(tap);
  if (saleAction) {
    console.log("WHATSAPP_SALES_FLOW_ACTION", { conversation_id: conversationId, ...saleAction });
    if (saleAction.action === "cancel") {
      persistFlow({ conversationId, productId: saleAction.product_id, step: "" });
      await send({ phone, message: "تم إلغاء الطلب.\nيسعدنا خدمتك في أي وقت ❤️" });
      return { handled: true, reason: "whatsapp_order_cancelled" };
    }
    return sendAddressLink({
      tenantId,
      phone,
      conversationId,
      // The tap is the authority on the variant; the conversation only supplies the customer name.
      flow: { ...flow, product_id: saleAction.product_id, selected_color: saleAction.color, selected_size: saleAction.size },
      productId: saleAction.product_id,
    });
  }

  // ── size, chosen from the list ──────────────────────────────────────────────────────────────
  // The row id names the product, the colour and the size, so it is unambiguous on its own and
  // does not depend on the conversation still holding the right state.
  const sizeRow = parseSizeRowId(tap);
  if (sizeRow) {
    const product = await loadProduct({ tenantId, productId: sizeRow.product_id });
    if (!product) return { handled: false, reason: "product_not_found" };
    const available = await loadVariants({ tenantId, productId: sizeRow.product_id, color: sizeRow.color, size: sizeRow.size });
    if (!available.length) {
      await send({ phone, message: `المقاس ${sizeRow.size} خلص من اللون ${normalizeSocialCommentColorDisplay(sizeRow.color) || sizeRow.color}. اختار مقاس تاني 👟` });
      return presentSizes({ tenantId, phone, conversationId, productId: sizeRow.product_id, color: sizeRow.color, product });
    }
    console.log("WHATSAPP_SALES_FLOW_SIZE_SELECTED", { conversation_id: conversationId, ...sizeRow, source: "list_row" });
    return sendSummary({ tenantId, phone, conversationId, productId: sizeRow.product_id, color: sizeRow.color, size: sizeRow.size, product });
  }

  if (!body) return { handled: false, reason: "no_text" };

  // ── size, typed ─────────────────────────────────────────────────────────────────────────────
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
