import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Pinned, not defaulted: run inside a deployed container these would otherwise inherit the real
// origins and the assertions would compare production config against itself.
process.env.PUBLIC_APP_URL = "https://shop.example.com";
process.env.PUBLIC_BACKEND_URL = "https://api.example.com";
for (const key of [
  // getPublicAppUrl reads these BEFORE PUBLIC_APP_URL
  "STOREFRONT_URL", "PUBLIC_STOREFRONT_URL", "VITE_STOREFRONT_URL", "FRONTEND_URL", "VITE_PUBLIC_APP_URL",
  // getPublicBackendUrl reads these AFTER PUBLIC_BACKEND_URL, but clear them anyway
  "BACKEND_PUBLIC_URL", "API_PUBLIC_URL", "PUBLIC_API_URL", "VITE_API_URL",
]) {
  delete process.env[key];
}

const { ensureAbsoluteSocialAssetUrl, ensureAbsoluteSocialProductLink } = await import(
  "../services/socialCommentPrivateReplyService.js"
);

/* ======================================================
   WHAT AN ORDER FROM A COMMENT IS ACTUALLY WORTH
   ------------------------------------------------------
   INV-1215 invoiced 0.00 for the shoes AND 0.00 for delivery, and the carousel that sold it
   arrived with no pictures. Three separate holes, all silent:

     1. Uploaded images were absolutised against the STOREFRONT origin. The SPA answers any
        unknown path with index.html and HTTP 200, so Meta fetched HTML where it expected a
        JPEG — a card with no image and not one error line anywhere.
     2. createAiOrderDraft never quoted shipping, so total_amount was the goods alone. The
        multi-line composer had always used resolveAiOrderShipping; this path did not.
     3. A product with no price in the catalog produced a 0.00 order instead of stopping.
====================================================== */

// ── 1. Uploads resolve to the backend, pages to the storefront ────────────────────────────────
assert.equal(
  ensureAbsoluteSocialAssetUrl("/uploads/products/a.jpg"),
  "https://api.example.com/uploads/products/a.jpg",
  "an uploaded image must be fetched from the backend, not from the SPA"
);
assert.equal(
  ensureAbsoluteSocialAssetUrl("uploads/products/a.jpg"),
  "https://api.example.com/uploads/products/a.jpg",
  "a leading slash is not what decides where an upload lives"
);
assert.equal(
  ensureAbsoluteSocialAssetUrl("https://cdn.example.com/x.jpg"),
  "https://cdn.example.com/x.jpg",
  "an already absolute URL is left alone"
);
assert.equal(
  ensureAbsoluteSocialProductLink("/shop/products/slug"),
  "https://shop.example.com/shop/products/slug",
  "a product PAGE still belongs to the storefront"
);
assert.equal(ensureAbsoluteSocialAssetUrl(""), "");

const orderService = readFileSync(
  fileURLToPath(new URL("../services/aiAgentOrderService.js", import.meta.url)),
  "utf8"
);
const metaService = readFileSync(
  fileURLToPath(new URL("../services/metaIntegrationService.js", import.meta.url)),
  "utf8"
);

// ── 2. The single-product draft charges for delivery ──────────────────────────────────────────
const draftStart = orderService.indexOf("export const createAiOrderDraft = async");
assert.ok(draftStart > 0, "createAiOrderDraft is gone");
const draftEnd = orderService.indexOf("MULTI-LINE DRAFT", draftStart);
assert.ok(draftEnd > draftStart, "could not bound createAiOrderDraft");
const draftBody = orderService.slice(draftStart, draftEnd);

assert.match(
  draftBody,
  /await resolveAiOrderShipping\(/,
  "the single-product draft must quote shipping through the one shipping authority"
);
assert.match(
  draftBody,
  /shipping_cost: safeShippingCost/,
  "the quoted shipping must be stored on the order"
);
// Scoped to the ORDER object: the line item's own total_amount is the goods, and rightly so.
const orderBlockStart = draftBody.indexOf("insertOrderWithItems(client, {");
assert.ok(orderBlockStart > 0, "could not find the order insert");
const orderBlock = draftBody.slice(orderBlockStart, draftBody.indexOf("items: [{", orderBlockStart));
assert.match(
  orderBlock,
  /total_amount: safeOrderTotal/,
  "the order total must include shipping, not just the goods"
);
assert.doesNotMatch(
  orderBlock,
  /total_amount: safeSubtotal/,
  "the order total must never fall back to the bare subtotal again"
);

// The line has to carry its own size and colour; a joined variant_name left the columns empty.
assert.match(
  draftBody,
  /size: text\(selectedVariant\.size \|\| payload\.size \|\| ""\)/,
  "the order line must record its size"
);
assert.match(
  draftBody,
  /color: text\(selectedVariant\.color \|\| payload\.color \|\| ""\)/,
  "the order line must record its colour"
);

// ── 3. An unpriced product stops the order ────────────────────────────────────────────────────
assert.match(
  metaService,
  /code: "MISSING_PRODUCT_PRICE"/,
  "a product with no catalog price must not become a 0.00 order"
);
assert.match(
  metaService,
  /if \(!\(draftData\.unitPrice > 0\)\)/,
  "the price gate must reject zero, not merely a missing field"
);
assert.match(
  metaService,
  /draftOrderFailureCode === "MISSING_PRODUCT_PRICE"/,
  "an unpriced product must be handed to a human, not read as a failed order"
);

console.log("social comment order totals OK");
