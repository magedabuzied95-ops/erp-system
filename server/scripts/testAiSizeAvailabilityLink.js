import assert from "node:assert/strict";

import {
  buildSizeAvailabilityStorefrontUrl,
  detectSizeBrowseQuality,
  detectSizeAvailabilityIntent,
  resolvePendingSizeBrowseQuality,
  sizeAvailabilityClarificationText,
} from "../services/aiSizeAvailabilityLinkService.js";

process.env.STORE_FRONT_URL = "https://store.example.com";

const cases = [
  ["المتاح 43 مستورد فيتنامي", { size: "43", gender: "", query: "", quality: "vietnamese_import", path: "/share/available?size=43&quality=vietnamese_import&inStock=1&v=4" }],
  ["مقاس 42 رجالي مصري", { size: "42", gender: "men", query: "", quality: "egyptian", path: "/share/available?gender=men&size=42&quality=egyptian&inStock=1&v=4" }],
  ["وريني جوردن فور مقاس 42 ميرور", { size: "42", gender: "", query: "Jordan 4", quality: "mirror", path: "/share/available?q=Jordan%204&size=42&quality=mirror&inStock=1&v=4" }],
];

for (const [message, expected] of cases) {
  const detected = detectSizeAvailabilityIntent(message);
  assert.equal(detected.detected, true, message);
  assert.equal(detected.size, expected.size);
  assert.equal(detected.gender, expected.gender);
  assert.equal(detected.query, expected.query);
  assert.equal(detected.quality, expected.quality);
  const url = buildSizeAvailabilityStorefrontUrl(detected);
  assert.equal(url, `https://store.example.com${expected.path}`);
}

const sizeOnly = detectSizeAvailabilityIntent("عايز أشوف المتاح 43");
assert.equal(sizeOnly.detected, true);
assert.equal(sizeOnly.qualityDetected, false);
assert.match(sizeAvailabilityClarificationText(sizeOnly), /مقاس 43/);

const pendingMirror = detectSizeBrowseQuality("ميرور");
assert.equal(pendingMirror.detected, true);
assert.equal(pendingMirror.quality, "mirror");
assert.equal(
  buildSizeAvailabilityStorefrontUrl({ size: "43", quality: pendingMirror.quality }),
  "https://store.example.com/share/available?size=43&quality=mirror&inStock=1&v=4"
);

const pendingAll = detectSizeBrowseQuality("الكل");
assert.equal(pendingAll.detected, true);
assert.equal(pendingAll.quality, "");
assert.equal(
  buildSizeAvailabilityStorefrontUrl({ size: "43", quality: pendingAll.quality }),
  "https://store.example.com/share/available?size=43&inStock=1&v=4"
);

const pendingMirrorFlow = resolvePendingSizeBrowseQuality({
  memory: {
    pendingSizeBrowseAwaitingQuality: true,
    pendingSizeBrowseSize: "43",
    pendingSizeBrowseGender: "",
    pendingSizeBrowseQuery: "",
    pendingSizeBrowseStartedAt: new Date().toISOString(),
  },
  message: "ميرور",
});
assert.equal(pendingMirrorFlow.locked, true);
assert.equal(pendingMirrorFlow.handled, true);
assert.equal(pendingMirrorFlow.otherIntentsSkipped, true);
assert.equal(pendingMirrorFlow.url, "https://store.example.com/share/available?size=43&quality=mirror&inStock=1&v=4");

const pendingEgyptianMenFlow = resolvePendingSizeBrowseQuality({
  memory: {
    pendingSizeBrowseAwaitingQuality: true,
    pendingSizeBrowseSize: "42",
    pendingSizeBrowseGender: "men",
    pendingSizeBrowseQuery: "",
    pendingSizeBrowseStartedAt: new Date().toISOString(),
  },
  message: "مصري",
});
assert.equal(pendingEgyptianMenFlow.locked, true);
assert.equal(pendingEgyptianMenFlow.url, "https://store.example.com/share/available?gender=men&size=42&quality=egyptian&inStock=1&v=4");

const noPendingMirrorFlow = resolvePendingSizeBrowseQuality({
  memory: {},
  message: "ميرور",
});
assert.equal(noPendingMirrorFlow.locked, false);
assert.equal(noPendingMirrorFlow.handled, false);

const expiredPendingFlow = resolvePendingSizeBrowseQuality({
  memory: {
    pendingSizeBrowseAwaitingQuality: true,
    pendingSizeBrowseSize: "43",
    pendingSizeBrowseStartedAt: new Date(Date.now() - 16 * 60 * 1000).toISOString(),
  },
  message: "ميرور",
});
assert.equal(expiredPendingFlow.expired, true);
assert.equal(expiredPendingFlow.clearPending, true);
assert.equal(expiredPendingFlow.locked, false);

console.log("AI size availability link tests passed");
