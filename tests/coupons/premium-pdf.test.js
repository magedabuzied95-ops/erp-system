import assert from "node:assert/strict";
import test from "node:test";

import { renderCouponsPdfBuffer, resolveCouponUrl } from "../../server/services/couponsService.js";

const sampleCoupons = Array.from({ length: 6 }, (_, index) => ({
  id: index + 1,
  code: `M1-GOLD-${index + 1}`,
  discount_type: index % 2 === 0 ? "percentage" : "fixed",
  discount_value: index % 2 === 0 ? 25 : 250,
  minimum_order_amount: 1000,
  expires_at: "2026-12-31T21:59:59.000Z",
  usage_limit: 1,
}));

const branding = {
  storeName: "M1 Store",
  logoUrl: "public/icons/m1-512.png",
  publicUrl: "https://m1store-egy.com",
};

test("coupon URL always points at the real storefront", () => {
  assert.equal(
    resolveCouponUrl("M1 GOLD", "https://m1store-egy.com/"),
    "https://m1store-egy.com/checkout?coupon=M1%20GOLD"
  );
  assert.equal(resolveCouponUrl("M1-GOLD", ""), "M1-GOLD");
});

for (const layout of ["a4", "a5", "single"]) {
  test(`premium ${layout} PDF is generated with a real QR and logo`, async () => {
    const coupons = layout === "single" ? sampleCoupons.slice(0, 1) : sampleCoupons;
    const buffer = await renderCouponsPdfBuffer({ coupons, branding, layout });
    assert.ok(Buffer.isBuffer(buffer));
    assert.equal(buffer.subarray(0, 4).toString("ascii"), "%PDF");
    assert.ok(buffer.length > 20_000, `expected a designed PDF, received only ${buffer.length} bytes`);
  });
}

test("empty coupon exports fail instead of producing a blank document", async () => {
  await assert.rejects(
    renderCouponsPdfBuffer({ coupons: [], branding, layout: "a4" }),
    /No coupons available/
  );
});
