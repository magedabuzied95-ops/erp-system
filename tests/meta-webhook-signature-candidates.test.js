import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import { verifyMetaWebhookSignatureWithSecrets } from "../server/services/aiChannelAdapterService.js";

const sign = (body, secret) =>
  `sha256=${crypto.createHmac("sha256", secret).update(body).digest("hex")}`;

test("Meta webhook accepts any configured trusted secret without exposing it", () => {
  const body = Buffer.from(JSON.stringify({ object: "instagram", entry: [] }));
  const result = verifyMetaWebhookSignatureWithSecrets({
    rawBody: body,
    signature: sign(body, "current-instagram-app-secret"),
    appSecrets: ["stale-instagram-app-secret", "current-instagram-app-secret", "current-instagram-app-secret"],
  });

  assert.equal(result.valid, true);
  assert.equal(result.matchedIndex, 1);
});

test("Meta webhook rejects a signature that matches none of the configured secrets", () => {
  const body = Buffer.from(JSON.stringify({ object: "instagram", entry: [] }));
  const result = verifyMetaWebhookSignatureWithSecrets({
    rawBody: body,
    signature: sign(body, "unknown-secret"),
    appSecrets: ["instagram-secret", "meta-secret"],
  });

  assert.equal(result.valid, false);
  assert.equal(result.matchedIndex, -1);
});
