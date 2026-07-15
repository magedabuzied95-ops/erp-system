import assert from "node:assert/strict";
import { resolveCatalogNavigation } from "../services/aiCatalogNavigationService.js";
import { hasBrokenReplyEncoding } from "../services/aiReplyQualityService.js";

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
