import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("variant payload preserves multiple manufacturers and the legacy primary manufacturer", () => {
  const productsApi = readFileSync(
    new URL("../src/modules/products/services/productsApi.js", import.meta.url),
    "utf8",
  );

  assert.match(productsApi, /manufacturer_ids:\s*\[\.\.\.new Set\(/);
  assert.match(productsApi, /manufacturer_id:\s*normalizeNullableText\(/);
});

test("product variant persistence stores manufacturer ids while retaining manufacturer_id", () => {
  const controller = readFileSync(new URL("../server/controllers/productsController.js", import.meta.url), "utf8");
  const schema = readFileSync(new URL("../server/database/schema.sql", import.meta.url), "utf8");

  assert.match(schema, /manufacturer_ids BIGINT\[\]/);
  assert.match(controller, /ADD COLUMN IF NOT EXISTS manufacturer_ids BIGINT\[\]/);
  assert.match(controller, /manufacturer_ids = \$2::bigint\[\]/);
  assert.match(controller, /normalizeIncomingManufacturerIds\(variant\.manufacturer_ids, variant\.manufacturer_id\)/);
});
