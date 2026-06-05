import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { AI_AGENT_CHANNELS } from "../services/aiChannelAdapterService.js";
import { generateUnifiedAiReply } from "../services/aiConversationOrchestrator.js";

dotenv.config({ path: fileURLToPath(new URL("../.env", import.meta.url)) });

process.env.AI_SUPPORT_DEBUG = process.env.AI_SUPPORT_DEBUG || "1";

const text = (value = "") => String(value ?? "").trim();
const stableStringify = (value) => {
  const seen = new WeakSet();
  const sortValue = (input) => {
    if (Array.isArray(input)) return input.map(sortValue);
    if (!input || typeof input !== "object") return input;
    if (seen.has(input)) return null;
    seen.add(input);
    return Object.keys(input).sort().reduce((acc, key) => {
      acc[key] = sortValue(input[key]);
      return acc;
    }, {});
  };
  return JSON.stringify(sortValue(value));
};
const normalizeId = (value = "") => text(value).toLowerCase();
const normalizeProductEntry = (product = {}) => ({
  id: text(product.id || product.product_id || product.variant_id || product.sku || ""),
  name: text(product.name || product.title || product.product_name || ""),
});
const normalizeCardEntry = (card = {}) => ({
  id: text(card.id || card.product_id || card.variant_id || card.sku || ""),
  name: text(card.name || card.title || card.product_name || ""),
});
const normalizeImageCardEntry = (card = {}) => ({
  product_id: text(card.product_id || card.id || card.product?.id || ""),
  color: text(card.color || card.color_name || card.matched_variant_color || card.subtitle || ""),
  url: text(card.url || card.image_url || card.image || card.main_image || ""),
});
const normalizeQuickActionEntry = (item = {}) => ({
  label: text(item?.label || item?.text || item?.title || item?.value || item),
  value: text(item?.value || item?.label || item?.text || item?.title || item),
  action: text(item?.action || item?.type || item?.id || ""),
});
const normalizeDraftOrder = (draft = null) => {
  if (!draft) return null;
  return {
    product_id: text(draft.product_id || draft.productId || ""),
    variant_id: text(draft.variant_id || draft.variantId || ""),
    quantity: Number(draft.quantity || 0),
    customer_name: text(draft.customer_name || draft.customerName || ""),
    customer_phone: text(draft.customer_phone || draft.customerPhone || ""),
    customer_address: text(draft.customer_address || draft.customerAddress || ""),
    unit_price: Number(draft.unit_price || 0),
    total_amount: Number(draft.total_amount || 0),
  };
};
const normalizeHandoff = (handoff = null) => ({
  needs_human_support: Boolean(handoff?.needs_human_support),
  conversation_status: text(handoff?.conversation_status || ""),
  reason: text(handoff?.reason || ""),
});
const summarizeUnifiedReply = (reply = {}) => ({
  text: text(reply.text || ""),
  intent: text(reply.intent || ""),
  products: Array.isArray(reply.products) ? reply.products.map(normalizeProductEntry) : [],
  product_cards: Array.isArray(reply.product_cards) ? reply.product_cards.map(normalizeCardEntry) : [],
  image_cards: Array.isArray(reply.image_cards) ? reply.image_cards.map(normalizeImageCardEntry) : [],
  quick_replies: Array.isArray(reply.quick_replies) ? reply.quick_replies.map(normalizeQuickActionEntry) : [],
  actions: Array.isArray(reply.actions) ? reply.actions.map(normalizeQuickActionEntry) : [],
  handoff: normalizeHandoff(reply.handoff),
  draft_order: normalizeDraftOrder(reply.draft_order),
  memory_updates: stableStringify(reply.memory_updates || {}),
});
const eq = (left, right) => stableStringify(left) === stableStringify(right);
const mergeMemory = (memory = {}, updates = {}) => {
  const next = { ...memory };
  Object.entries(updates || {}).forEach(([key, value]) => {
    next[key] = value;
  });
  return next;
};
const compareScenario = ({ inboundText, captures }) => {
  const entries = Object.entries(captures);
  const baseline = entries[0]?.[1];
  const diffs = [];
  let textMatch = true;
  let intentMatch = true;
  let productMatch = true;
  let cardsMatch = true;
  let decisionMatch = true;

  for (const [channel, capture] of entries.slice(1)) {
    const channelDiffs = [];
    if (!eq(capture.text, baseline.text)) {
      textMatch = false;
      decisionMatch = false;
      channelDiffs.push("text");
    }
    if (!eq(capture.intent, baseline.intent)) {
      intentMatch = false;
      decisionMatch = false;
      channelDiffs.push("intent");
    }
    if (!eq(capture.products, baseline.products) || !eq(capture.product_cards, baseline.product_cards)) {
      productMatch = false;
      decisionMatch = false;
      channelDiffs.push("products");
    }
    if (
      !eq(capture.image_cards, baseline.image_cards) ||
      !eq(capture.quick_replies, baseline.quick_replies) ||
      !eq(capture.actions, baseline.actions)
    ) {
      cardsMatch = false;
      decisionMatch = false;
      channelDiffs.push("cards");
    }
    if (!eq(capture.handoff, baseline.handoff)) {
      decisionMatch = false;
      channelDiffs.push("handoff");
    }
    if (!eq(capture.draft_order, baseline.draft_order)) {
      decisionMatch = false;
      channelDiffs.push("draft_order");
    }
    if (!eq(capture.memory_updates, baseline.memory_updates)) {
      decisionMatch = false;
      channelDiffs.push("memory_updates");
    }
    if (channelDiffs.length) {
      diffs.push({ channel, differences: channelDiffs });
    }
  }

  const status = decisionMatch ? "PASS" : "FAIL";
  const result = {
    inbound_text: inboundText,
    compared_channels: entries.map(([channel]) => channel),
    decision_match: decisionMatch,
    text_match: textMatch,
    intent_match: intentMatch,
    product_match: productMatch,
    cards_match: cardsMatch,
    differences: diffs,
    status,
  };
  console.log("[AI_CHANNEL_PARITY_RESULT]", result);
  return result;
};
const channelConfigs = [
  { key: "whatsapp", channel: AI_AGENT_CHANNELS.WHATSAPP, to: "201000000000" },
  { key: "messenger", channel: AI_AGENT_CHANNELS.FACEBOOK_MESSENGER, to: "100000000000000" },
  { key: "instagram", channel: AI_AGENT_CHANNELS.INSTAGRAM, to: "100000000000000" },
  { key: "website_chat", channel: AI_AGENT_CHANNELS.WEB_CHAT, to: "web-chat-runtime" },
];
const scenarios = [
  "عندك جوردن 4؟",
  "صور أكتر",
  "عايز مقاس 42",
  "مش عاجبني وريني بدائل",
  "عايز أشتري",
  "كلم بني آدم",
];
const catalog = {
  jordan4: {
    id: "jordan-4-black",
    name: "Jordan 4 Retro Black",
    color: "Black",
    image: "https://example.com/jordan-4-black.jpg",
    price: 4200,
  },
  jordan4Grey: {
    id: "jordan-4-grey",
    name: "Jordan 4 Retro Grey",
    color: "Grey",
    image: "https://example.com/jordan-4-grey.jpg",
    price: 4200,
  },
  jordan1Low: {
    id: "jordan-1-low",
    name: "Jordan 1 Low",
    color: "White",
    image: "https://example.com/jordan-1-low.jpg",
    price: 3800,
  },
};

globalThis.fetch = async (_input, init = {}) => {
  const body = JSON.parse(init.body || "{}");
  const messageText = text(body.message || "");
  const memory = body?.metadata?.ai_memory || {};
  const activeProduct = memory.selected_product_id === catalog.jordan4Grey.id ? catalog.jordan4Grey : catalog.jordan4;
  const channel = text(body.channel || "");
  const takeover = /بني\s*آدم|human_takeover|كلم\s*بني\s*آدم/i.test(messageText) || memory.status === "human_takeover";
  const hasJordan = /جوردن|jordan|aj4|j4/i.test(messageText);
  const wantsImages = /صور|image|photo/i.test(messageText);
  const wantsSize = /مقاس|size/i.test(messageText);
  const wantsAlternatives = /بدائل|alternatives|مش عاجبني/i.test(messageText);
  const wantsBuy = /عايز أشتري|أشتري|buy|order/i.test(messageText);
  const reply = {
    answer: takeover
      ? "تمام، هحوّلك لبني آدم من الفريق."
      : hasJordan
        ? "أيوه، Jordan 4 متاح. أوريك الصور والمقاسات؟"
        : wantsImages
          ? "أكيد، دي صور أكتر لنفس الموديل."
          : wantsSize
            ? "مقاس 42 متاح على نفس الموديل."
            : wantsAlternatives
              ? "دي بدائل قريبة من نفس الشكل."
              : wantsBuy
                ? "تمام، نبدأ تجهيز الطلب."
                : "أقدر أساعدك في الموديلات والمقاسات.",
    detected_intent: takeover
      ? "human_takeover"
      : hasJordan
        ? "product_search"
        : wantsImages
          ? "more_images"
          : wantsSize
            ? "size_check"
            : wantsAlternatives
              ? "alternatives"
              : wantsBuy
                ? "buying_intent"
                : "faq",
    confidence: takeover ? 0.99 : 0.94,
    detected_language: "ar",
    tone: "sales",
    suggested_products: takeover ? [] : hasJordan
      ? [activeProduct]
      : wantsAlternatives
        ? [catalog.jordan4Grey, catalog.jordan1Low]
        : wantsBuy
          ? [activeProduct]
          : [],
    product_cards: takeover ? [] : hasJordan
      ? [activeProduct]
      : wantsAlternatives
        ? [catalog.jordan4Grey, catalog.jordan1Low]
        : wantsBuy
          ? [activeProduct]
          : [],
    visual_attachments: takeover ? [] : wantsImages
      ? [{
          type: "image_card",
          product_id: activeProduct.id,
          title: activeProduct.name,
          subtitle: activeProduct.color,
          url: activeProduct.image,
          color: activeProduct.color,
        }]
      : [],
    quick_replies: takeover ? [] : [
      { label: "المقاسات", value: "المقاسات" },
      { label: "صور أكتر", value: "صور أكتر" },
    ],
    actions: takeover ? [] : [
      { label: "Ask for size", action: "choose_size" },
      { label: "Show alternatives", action: "show_alternatives" },
      { label: "Escalate", action: "escalate_to_human" },
    ],
    memory_updates: takeover
      ? { status: "human_takeover" }
      : hasJordan
        ? {
            selected_product_id: activeProduct.id,
            selected_color: activeProduct.color,
            selected_size: memory.selected_size || "",
            last_intent: "product_search",
          }
        : wantsImages
          ? {
              selected_product_id: activeProduct.id,
              last_intent: "more_images",
              last_shown_image_cards: [activeProduct.id],
            }
          : wantsSize
            ? {
                selected_product_id: activeProduct.id,
                selected_size: "42",
                last_intent: "size_check",
              }
            : wantsAlternatives
              ? {
                  last_intent: "alternatives",
                  alternative_flow: true,
                }
              : wantsBuy
                ? {
                    buying_stage: "draft_created",
                    draft_order_id: `draft-${activeProduct.id}`,
                  }
                : {},
    draft_order: wantsBuy && !takeover
      ? {
          draft_order_id: `draft-${activeProduct.id}`,
          product_id: activeProduct.id,
          variant_id: `${activeProduct.id}-${memory.selected_size || "42"}`,
          quantity: 1,
          unit_price: activeProduct.price,
          total_amount: activeProduct.price,
        }
      : null,
    handoff: takeover
      ? { needs_human_support: true, conversation_status: "human_takeover", reason: "customer requested a human" }
      : { needs_human_support: false, conversation_status: "ai_active", reason: "" },
  };
  return {
    ok: true,
    status: 200,
    json: async () => reply,
  };
};

const run = async () => {
  const summaryRows = [];

  for (const inboundText of scenarios) {
    const perChannelCapture = {};
    const memoryByChannel = Object.fromEntries(channelConfigs.map((item) => [item.key, {}]));

    for (const config of channelConfigs) {
      const reply = await generateUnifiedAiReply({
        tenantId: 1,
        channel: config.channel,
        conversation: {
          id: `parity-${config.key}-${normalizeId(inboundText)}`,
          session_id: `parity-${config.key}-${normalizeId(inboundText)}`,
          customer_name: "Parity Tester",
          customer_phone: config.to,
        },
        customer: {
          id: `customer-${config.key}`,
          name: "Parity Tester",
          phone: config.to,
        },
        message: {
          text: inboundText,
          provider_message_id: `mid-${config.key}-${normalizeId(inboundText)}`,
          metadata: {
            channel: config.channel,
            session_id: `parity-${config.key}-${normalizeId(inboundText)}`,
            customer_name: "Parity Tester",
            customer_phone: config.to,
            provider_message_id: `mid-${config.key}-${normalizeId(inboundText)}`,
            ai_memory: memoryByChannel[config.key],
          },
        },
        attachments: [],
        memory: memoryByChannel[config.key],
        providerMessageId: `mid-${config.key}-${normalizeId(inboundText)}`,
      });

      const capture = summarizeUnifiedReply(reply);
      perChannelCapture[config.key] = capture;
      memoryByChannel[config.key] = mergeMemory(memoryByChannel[config.key], reply.memory_updates || {});
      console.log("[AI_CHANNEL_CAPTURE]", {
        inbound_text: inboundText,
        channel: config.key,
        text: capture.text,
        intent: capture.intent,
        products: capture.products,
        product_cards: capture.product_cards,
        image_cards: capture.image_cards,
        quick_replies: capture.quick_replies,
        actions: capture.actions,
        handoff: capture.handoff,
        draft_order: capture.draft_order,
        memory_updates: capture.memory_updates,
      });
    }

    const comparison = compareScenario({
      inboundText,
      captures: perChannelCapture,
    });
    summaryRows.push({
      inbound_text: inboundText,
      status: comparison.status,
      decision_match: comparison.decision_match,
      text_match: comparison.text_match,
      intent_match: comparison.intent_match,
      product_match: comparison.product_match,
      cards_match: comparison.cards_match,
      differences: comparison.differences.map((item) => `${item.channel}:${item.differences.join(",")}`).join(" | "),
    });
  }

  console.log("\nParity Report");
  console.table(summaryRows);
};

run().catch((error) => {
  console.error("[AI_CHANNEL_PARITY_ERROR]", {
    message: error?.message || String(error),
    stack: error?.stack || "",
  });
  process.exitCode = 1;
});
