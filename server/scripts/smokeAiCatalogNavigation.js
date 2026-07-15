import assert from "node:assert/strict";
import { resolveCatalogNavigation } from "../services/aiCatalogNavigationService.js";
import { hasBrokenReplyEncoding } from "../services/aiReplyQualityService.js";
import { generateUnifiedConversationDecision } from "../services/aiUnifiedDecisionService.js";

const tenantId = Number(process.env.AI_SMOKE_TENANT_ID || 1);
const cases = [
  { message: "عايز أشوف موديلات رجالي", audience: "men" },
  { message: "وريني حريمي مقاس 39", audience: "women" },
  { message: "عندكم أطفال؟", audience: "kids" },
];

const results = [];
for (const testCase of cases) {
  const result = await resolveCatalogNavigation({ tenantId, message: testCase.message });
  assert.ok(result, `No catalog navigation result for ${testCase.audience}`);
  assert.equal(result.facets.audience, testCase.audience);
  assert.ok(result.url.startsWith("https://m1store-egy.com/share/available?"));
  assert.equal(hasBrokenReplyEncoding(result.answer), false);
  results.push({
    audience: testCase.audience,
    choices: result.cards.length,
    url: result.url,
    reply: result.answer,
  });
}

console.log(JSON.stringify({ success: true, tenantId, results }, null, 2));

if (["1", "true", "yes", "on"].includes(String(process.env.AI_SMOKE_FULL_DECISION || "").toLowerCase())) {
  const message = "عايز موديلات حريمي مقاس 39";
  const decision = await generateUnifiedConversationDecision({
    channel: "whatsapp",
    externalConversationId: `catalog-smoke-${Date.now()}`,
    externalCustomerId: "catalog-smoke-customer",
    customerName: "Catalog Smoke",
    text: message,
    originalText: message,
    attachments: [],
    metadata: { tenant_id: tenantId, source: "catalog_smoke" },
  }, { tenantId, memory: {} });
  assert.equal(decision.intent, "catalog_navigation");
  assert.equal(decision.catalog_filters?.audience, "women");
  assert.ok(decision.text.includes("https://m1store-egy.com/share/available?"));
  assert.equal(hasBrokenReplyEncoding(decision.text), false);
  console.log(JSON.stringify({
    success: true,
    fullDecision: {
      intent: decision.intent,
      reply: decision.text,
      products: decision.product_cards?.length || 0,
      replyQuality: decision.debug?.reply_quality || null,
      groundedRewriteApplied: Boolean(decision.debug?.rawDecision?.debug?.grounded_rewrite_applied),
    },
  }, null, 2));
}
