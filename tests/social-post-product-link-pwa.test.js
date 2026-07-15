import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const pwaSource = readFileSync(new URL("../src/modules/aiSupport/pages/AiInboxPwa.jsx", import.meta.url), "utf8");
const panelSource = readFileSync(new URL("../src/modules/aiSupport/components/SocialCommentsPanel.jsx", import.meta.url), "utf8");
const routesSource = readFileSync(new URL("../server/routes/socialComments.js", import.meta.url), "utf8");
const linksServiceSource = readFileSync(new URL("../server/services/socialPostProductLinksV2Service.js", import.meta.url), "utf8");

test("PWA reloads social posts with their persisted product links", () => {
  assert.match(pwaSource, /include_product_links=1/);
  assert.match(pwaSource, /include_product_links: 1/);
  assert.match(pwaSource, /timeoutMs: 30000/);
});

test("saved mappings update every product-link field used by the post card", () => {
  assert.match(pwaSource, /linked_products_count: Number\(payload\?\.count/);
  assert.match(pwaSource, /has_direct_product_link: linkedProducts\.length > 0/);
  assert.match(pwaSource, /product_link_identity: payload\?\.product_link_identity/);
  assert.match(pwaSource, /mapping_summary: \{/);
  assert.match(panelSource, /const isProductLinked = linkedProductsCount > 0/);
  assert.match(panelSource, /مربوط\$\{linkedProductsCount/);
});

test("product-link API saves and reads back from the same V2 mapping service", () => {
  assert.match(routesSource, /router\.get\("\/posts\/:postId\/product-links"[\s\S]*?getPostProductLinksV2\(/);
  assert.match(routesSource, /router\.put\("\/posts\/:postId\/product-links"[\s\S]*?savePostProductLinksV2\(/);
  assert.match(linksServiceSource, /business_id = \$1::bigint[\s\S]*?platform = \$2::text[\s\S]*?post_link_key/);
  assert.match(linksServiceSource, /return getPostProductLinksV2\(\{ tenantId, platform, post, postId, selectedPostId \}\)/);
});
