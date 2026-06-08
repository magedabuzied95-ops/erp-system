import { AI_AGENT_CHANNELS } from "../services/aiChannelAdapterService.js";
import { generateAiBrainV2Decision } from "../services/aiBrainV2Service.js";
import db from "../database/db.js";

const phrase = process.argv.slice(2).join(" ").trim() || "\u0645\u0645\u0643\u0646 \u0635\u0648\u0631 \u062c\u0648\u0631\u062f\u0646 \u0641\u0648\u0631";
const channels = [
  AI_AGENT_CHANNELS.WHATSAPP,
  AI_AGENT_CHANNELS.FACEBOOK_MESSENGER,
  AI_AGENT_CHANNELS.INSTAGRAM,
  AI_AGENT_CHANNELS.WEB_CHAT,
];

const run = async () => {
  const results = [];
  for (const channel of channels) {
    const decision = await generateAiBrainV2Decision({
      channel,
      externalConversationId: `ai-brain-v2-smoke:${channel}`,
      externalCustomerId: "201000000000",
      customerName: "Smoke Test",
      text: phrase,
      attachments: [],
      metadata: {
        tenant_id: Number(process.env.AI_BRAIN_V2_TEST_TENANT_ID || process.env.WHATSAPP_TENANT_ID || 1),
        channel,
        source: "ai_brain_v2_smoke",
      },
    }, {
      tenantId: Number(process.env.AI_BRAIN_V2_TEST_TENANT_ID || process.env.WHATSAPP_TENANT_ID || 1),
    });
    const cards = (decision.product_cards || []).map((card) => ({
      product_id: String(card.product_id || card.id || ""),
      variant_id: String(card.variant_id || card.selected_variant_id || ""),
      color: String(card.color || ""),
      price: Number(card.final_price || card.display_price || card.price || 0) || 0,
      price_source: String(card.price_source || ""),
      sizes: (card.available_sizes || card.sizes || []).map((size) => String(size)).filter(Boolean),
      image_url: String(card.image_url || card.image || ""),
      product_url: String(card.product_url || card.url || ""),
    }));
    results.push({
      channel,
      intent: decision.intent,
      text: decision.text,
      top_product_id: decision.product_cards?.[0]?.product_id || decision.product_cards?.[0]?.id || "",
      product_ids: (decision.product_cards || []).map((card) => String(card.product_id || card.id || "")).filter(Boolean),
      colors: cards.map((card) => card.color).filter(Boolean),
      cards,
      color_card_count: cards.length,
      missing_card_fields: cards.filter((card) => !card.image_url || !card.product_url || !card.price_source).map((card) => ({
        product_id: card.product_id,
        variant_id: card.variant_id,
        color: card.color,
        has_image: Boolean(card.image_url),
        has_product_url: Boolean(card.product_url),
        has_price_source: Boolean(card.price_source),
      })),
      image_count: decision.image_cards?.length || 0,
      engine: decision.debug?.engine || "",
      legacy_called: decision.debug?.legacy_called === true,
    });
  }

  const baseline = JSON.stringify({
    intent: results[0]?.intent,
    top_product_id: results[0]?.top_product_id,
    product_ids: results[0]?.product_ids,
    cards: results[0]?.cards,
    text: results[0]?.text,
  });
  const mismatches = results.filter((result) => JSON.stringify({
    intent: result.intent,
    top_product_id: result.top_product_id,
    product_ids: result.product_ids,
    cards: result.cards,
    text: result.text,
  }) !== baseline);

  const requiredPhrase = "\u0645\u0645\u0643\u0646 \u0635\u0648\u0631 \u062c\u0648\u0631\u062f\u0646 \u0641\u0648\u0631";
  const missingPresentation = phrase === requiredPhrase
    ? results.filter((result) => !result.color_card_count || result.missing_card_fields.length)
    : [];

  console.log(JSON.stringify({
    phrase,
    expected_presentation: phrase === requiredPhrase ? "all Jordan 4 color cards with active price, color sizes, image, and product link" : "",
    results,
    parity_passed: mismatches.length === 0 && missingPresentation.length === 0,
    mismatches,
    missingPresentation,
  }, null, 2));
  if (mismatches.length || missingPresentation.length) process.exitCode = 1;
};

run().catch((error) => {
  console.error("[ai-brain-v2-smoke:error]", error);
  process.exitCode = 1;
}).finally(async () => {
  await db.end().catch(() => {});
});
