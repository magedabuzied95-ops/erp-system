import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import sharp from "sharp";

import { __storefrontVisualTesting } from "../server/controllers/storefrontController.js";

const { fingerprintImageBuffer, scoreVisualLibrary } = __storefrontVisualTesting;
const controllerSource = fs.readFileSync(new URL("../server/controllers/storefrontController.js", import.meta.url), "utf8");

const shoe = (body, sole) => sharp(Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="1254" height="1254">
     <rect width="1254" height="1254" fill="#ffffff"/>
     <path d="M180 760 Q260 420 620 470 Q860 500 1080 700 L1090 800 L170 820 Z" fill="${body}"/>
     <rect x="160" y="800" width="950" height="90" rx="40" fill="${sole}"/>
   </svg>`
)).jpeg({ quality: 92 }).toBuffer();

test("a phone-downscaled copy of a catalogue photo finds that product first", async () => {
  const grey = await shoe("#7a7a7a", "#f2f2f2");
  const red = await shoe("#c0392b", "#222222");
  const library = [
    { productId: 11, familyKey: "", imageUrl: "/uploads/products/grey.jpg", ...(await fingerprintImageBuffer(grey)) },
    { productId: 22, familyKey: "", imageUrl: "/uploads/products/red.jpg", ...(await fingerprintImageBuffer(red)) },
  ];
  // What the storefront uploads now: redrawn smaller, recompressed — never the same bytes.
  const upload = await sharp(grey).resize(640).jpeg({ quality: 70 }).toBuffer();
  const matches = scoreVisualLibrary(library, await fingerprintImageBuffer(upload), 8);
  assert.equal(matches[0]?.productId, 11);
  assert.ok(matches[0].score >= 60, `score ${matches[0]?.score}`);
});

test("a search never fingerprints the catalogue itself; the library is built in the background and saved", () => {
  const search = controllerSource.slice(
    controllerSource.indexOf("const findProductsByImageSimilarity = async"),
    controllerSource.indexOf("const scoreVisualLibrary = ")
  );
  assert.doesNotMatch(search, /loadCandidateImageBuffer|queryVisualImageCandidates/);
  assert.match(search, /ensureVisualLibrary\(tenantId\)/);
  assert.match(controllerSource, /uploads", "\.cache", `storefront-visual-signatures-/);
  // Vision gets a small image and does not sit out a long rate-limit wait.
  assert.match(controllerSource, /resize\(768, 768, \{ fit: "inside", withoutEnlargement: true \}\)/);
  assert.match(controllerSource, /maxRateLimitWaitMs: 3000/);
});
