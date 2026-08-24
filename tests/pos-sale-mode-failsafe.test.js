import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  parseSaleModeEnabled,
  readUseSalePrices,
  resolvePosSaleModeForLoad,
} from "../src/modules/pos/lib/posSaleModeSettings.js";
import { getPosEffectivePrice } from "../src/modules/pos/lib/posPricing.js";

// 2026-08-24: cashier machines rang every stored sale price as the charged price
// while the super admin saw the global toggle OFF. Root cause: cashier roles hold
// settings.view but not website.settings, so after the permission-alias fix their
// GET /website/settings started to 403 — and the POS fell back to a localStorage
// flag whose unset default was sale-mode ON. Real Samba row: normal 650, stored
// sale 550 — cashiers charged 550, the storefront charged 650.
//
// The contract these tests pin: failing to load settings must NEVER turn the sale
// on (every shared resolver fails safe to Sale OFF), and cashier machines follow
// the real toggle via the permission-free /settings/public fallback.

const SAMBA = {
  product: { id: 24, name: "Adidas Samba Sneakers", purchase_selling_price: 650, sale_price: 550, sale_price_enabled: true },
  variant: { id: 2401, purchase_selling_price: 650, sale_price: 550 },
};

test("no settings reachable => sale mode OFF (never invented from a failed read)", () => {
  const resolved = resolvePosSaleModeForLoad({ websiteSettings: null, publicSettings: null });
  assert.equal(resolved.source, "localStorage_fallback");
  assert.equal(resolved.saleModeSettings.sale_mode_enabled, false);
});

test("unset device default is SALE OFF", () => {
  // node has no window: the localStorage read throws internally and the unset
  // default decides. Flipping the module's terminal `return false` back to
  // `return true` (the pre-fix behavior) fails here.
  assert.equal(readUseSalePrices(), false);
});

test("a persisted admin toggle is still honored by the device fallback", () => {
  const originalWindow = globalThis.window;
  try {
    globalThis.window = { localStorage: { getItem: () => "true" } };
    assert.equal(readUseSalePrices(), true);
    globalThis.window = { localStorage: { getItem: () => "false" } };
    assert.equal(readUseSalePrices(), false);
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test("backend settings are authoritative even when the public copy is stale", () => {
  const resolved = resolvePosSaleModeForLoad({
    websiteSettings: { settings: { sale_mode_enabled: false } },
    publicSettings: { settings: { sale_mode_enabled: true } },
  });
  assert.equal(resolved.source, "backend");
  assert.equal(resolved.saleModeSettings.sale_mode_enabled, false);
});

test("cashier path: permission-denied backend read falls through to /settings/public", () => {
  const resolved = resolvePosSaleModeForLoad({
    websiteSettings: null,
    publicSettings: {
      settings: {
        sale_mode_enabled: true,
        sale_mode_type: "use_existing_sale_prices_only",
        sale_mode_excluded_product_ids: "7,9",
      },
    },
  });
  assert.equal(resolved.source, "public");
  assert.equal(resolved.saleModeSettings.sale_mode_enabled, true);
  assert.deepEqual(resolved.saleModeSettings.sale_mode_excluded_product_ids, ["7", "9"]);
});

test("backend response that omits the key defers to the public copy, not to ON", () => {
  const resolved = resolvePosSaleModeForLoad({
    websiteSettings: { settings: { store_name: "M1" } },
    publicSettings: { settings: { sale_mode_enabled: false } },
  });
  assert.equal(resolved.source, "public");
  assert.equal(resolved.saleModeSettings.sale_mode_enabled, false);
});

test("parseSaleModeEnabled keeps its explicit-value semantics", () => {
  assert.equal(parseSaleModeEnabled(undefined, false), false);
  assert.equal(parseSaleModeEnabled("", false), false);
  assert.equal(parseSaleModeEnabled("on", false), true);
  assert.equal(parseSaleModeEnabled("off", true), false);
});

test("the production bug end-to-end: Samba rings 650 when settings cannot be read, 550 only when the toggle is really ON", () => {
  const failed = resolvePosSaleModeForLoad({ websiteSettings: null, publicSettings: null });
  const offPrice = getPosEffectivePrice({ ...SAMBA, saleModeSettings: failed.saleModeSettings });
  assert.equal(offPrice.final_price, 650);
  assert.equal(Boolean(offPrice.sale_mode_applied), false);

  const on = resolvePosSaleModeForLoad({ publicSettings: { settings: { sale_mode_enabled: true } } });
  const onPrice = getPosEffectivePrice({ ...SAMBA, saleModeSettings: on.saleModeSettings });
  assert.equal(onPrice.final_price, 550);
});

test("POSPro consumes the shared module instead of redefining the fallback", async () => {
  const source = await readFile(new URL("../src/modules/pos/pages/POSPro.jsx", import.meta.url), "utf8");
  assert.ok(source.includes('from "../lib/posSaleModeSettings"'), "POSPro must import the shared sale-mode module");
  assert.ok(!source.includes("const readUseSalePrices"), "POSPro must not redefine readUseSalePrices");
  assert.ok(!source.includes("const parseSaleModeEnabled"), "POSPro must not redefine parseSaleModeEnabled");
  assert.ok(!/parseSaleModeEnabled\([^)]*,\s*true\s*\)/.test(source), "no sale-mode parse may fall back to ON");
  assert.ok(source.includes("publicSettingsResult"), "the catalog load must fetch /settings/public alongside /website/settings");
});

test("poisoned snapshots are flushed: catalog schema version moved past 4", async () => {
  const source = await readFile(new URL("../src/modules/pos/lib/posCatalogCache.js", import.meta.url), "utf8");
  const match = source.match(/POS_CATALOG_SCHEMA_VERSION = (\d+)/);
  assert.ok(match, "schema version constant must exist");
  assert.ok(Number(match[1]) >= 5, "cashier machines cached sale-ON prices under v4; the snapshot must re-normalize");
});

test("/settings/public serves the full sale-mode subset the POS fallback prices with", async () => {
  const source = await readFile(new URL("../server/routes/settings.js", import.meta.url), "utf8");
  for (const key of [
    "sale_mode_type",
    "sale_mode_excluded_product_ids",
    "sale_mode_excluded_category_ids",
    "sale_mode_excluded_brand_ids",
    "sale_mode_min_price_protection_enabled",
    "sale_mode_min_margin_percent",
  ]) {
    assert.ok(source.includes(`${key}: websiteSettings?.${key}`), `public settings must merge ${key}`);
  }
});
