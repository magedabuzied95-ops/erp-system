/* ======================================================
   A product card photo must be fetched from the BACKEND.

   The Instagram colour carousel for "Air Jordan 4 Sneakers for Men" arrived at the customer as
   one text line per colour — name, colour, price, link — instead of a swipeable strip of cards.
   The template was refused, and the reason was the picture: every card carried
   `https://<storefront>/uploads/products/variants/<file>-sq800.jpg`, which returns 34 KB of
   index.html with HTTP 200 because the SPA answers every unknown path that way. The file itself
   sits on the backend origin, where nothing was pointing.

   PUBLIC_BACKEND_URL was unset in production, and both resolvers fell back to the app origin for
   an upload. That fallback is the bug: it turns a missing env var into a URL that looks valid,
   answers 200, and silently costs the whole carousel.
====================================================== */

import assert from "node:assert/strict";

const ORIGINAL_ENV = { ...process.env };
const resetEnv = () => {
  for (const key of Object.keys(process.env)) if (!(key in ORIGINAL_ENV)) delete process.env[key];
  Object.assign(process.env, ORIGINAL_ENV);
};

for (const key of [
  "PUBLIC_BACKEND_URL", "BACKEND_PUBLIC_URL", "API_PUBLIC_URL", "PUBLIC_API_URL", "VITE_API_URL",
  "STORE_FRONT_URL", "PUBLIC_APP_URL", "APP_PUBLIC_URL", "FRONTEND_URL", "VITE_PUBLIC_APP_URL",
  "STOREFRONT_URL", "PUBLIC_STOREFRONT_URL", "VITE_STOREFRONT_URL",
]) delete process.env[key];

process.env.PUBLIC_BACKEND_URL = "https://api.example.com";
process.env.STORE_FRONT_URL = "https://shop.example.com";

const { absolutePublicUploadUrl, rememberPublicBackendOrigin, getPublicBackendUrl } = await import(
  "../server/utils/publicUrl.js"
);
const { resolvePublicProductImageUrl } = await import("../server/services/aiProductCards.js");

// ── 1. An upload is addressed to the backend, never to the shop ───────────────────────────────
assert.equal(
  absolutePublicUploadUrl("/uploads/products/variants/a-sq800.jpg"),
  "https://api.example.com/uploads/products/variants/a-sq800.jpg",
  "an upload must carry the origin that actually serves the file"
);
assert.equal(
  absolutePublicUploadUrl("https://res.cloudinary.com/x.jpg"),
  "https://res.cloudinary.com/x.jpg",
  "an already absolute URL is left alone"
);
assert.equal(absolutePublicUploadUrl(""), "", "nothing in, nothing out");

// ── 2. The card resolver does NOT fall back to the storefront for an upload ───────────────────
// This is the exact call the colour cards make. Before the fix it answered
// "https://shop.example.com/uploads/..." whenever the backend origin was unknown.
assert.equal(
  resolvePublicProductImageUrl("/uploads/products/cloudinary/x.webp", { assetBaseUrl: "", baseUrl: "https://shop.example.com" }),
  "/uploads/products/cloudinary/x.webp",
  "with no backend origin an upload stays relative — it must never be handed to the SPA origin"
);
assert.equal(
  resolvePublicProductImageUrl("/uploads/products/cloudinary/x.webp", { assetBaseUrl: "https://api.example.com", baseUrl: "https://shop.example.com" }),
  "https://api.example.com/uploads/products/cloudinary/x.webp",
  "with a backend origin the upload is absolute against it"
);

// ── 3. A missing env var is no longer the end of the carousel ─────────────────────────────────
// The origin the backend is reached on is remembered from inbound traffic; Meta's own webhook
// calls that host on every message. Env still wins.
delete process.env.PUBLIC_BACKEND_URL;
assert.equal(getPublicBackendUrl(), "", "nothing is known before any request arrives");
rememberPublicBackendOrigin("https://api.example.com");
assert.equal(getPublicBackendUrl(), "https://api.example.com", "the observed origin fills the gap");
rememberPublicBackendOrigin("http://api.example.com");
assert.equal(getPublicBackendUrl(), "https://api.example.com", "a plain-http origin is not remembered");
rememberPublicBackendOrigin("https://localhost:8000");
assert.equal(getPublicBackendUrl(), "https://api.example.com", "a local origin is not remembered");
process.env.PUBLIC_BACKEND_URL = "https://api.env-wins.com";
assert.equal(getPublicBackendUrl(), "https://api.env-wins.com", "env always outranks what was observed");

// ── 4. The carousel element refuses a picture Meta cannot fetch ───────────────────────────────
const metaSource = await import("node:fs").then(({ readFileSync }) =>
  readFileSync(new URL("../server/services/metaIntegrationService.js", import.meta.url), "utf8")
);
assert.match(
  metaSource,
  /const buildMetaCarouselElement[\s\S]{0,800}?const imageUrl = absolutePublicUploadUrl\(/,
  "the carousel element must absolutise its image, or Meta refuses the template"
);
assert.match(
  metaSource,
  /carousel elements dropped/,
  "falling back to one text link per colour must say so in the log"
);

resetEnv();
console.log("card-image-origin: all assertions passed");
