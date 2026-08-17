import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("storefront home ends with the full legacy-inspired responsive footer", async () => {
  const source = await readFile(new URL("../src/storefront/Storefront.jsx", import.meta.url), "utf8");
  const lowerHome = source.slice(source.indexOf("function HomeWhySection"), source.indexOf("function SimpleHomeProductGrid"));

  assert.match(lowerHome, /data-testid="storefront-service-strip"/);
  assert.match(lowerHome, /md:grid-cols-4/);
  assert.match(lowerHome, /شحن سريع/);
  assert.match(lowerHome, /إرجاع سهل خلال 14 يوم/);
  assert.match(lowerHome, /دفع آمن/);
  assert.match(lowerHome, /دعم فني 24\/7/);
  assert.match(lowerHome, /data-testid="storefront-modern-footer"/);
  assert.match(lowerHome, /bg-\[#f5f3ef\]/);
  assert.match(lowerHome, /dark:bg-\[#080808\]/);
  assert.match(lowerHome, /معلومات عنا/);
  assert.match(lowerHome, /أقسام مميزة/);
  assert.match(lowerHome, /روابط مهمة/);
  assert.match(lowerHome, /آخر العروض/);
  assert.match(lowerHome, /Mastercard/);
  assert.match(lowerHome, /FaCcMastercard/);
  assert.match(lowerHome, /FaCcVisa/);
  assert.match(lowerHome, /FaCcPaypal/);
  assert.match(lowerHome, /meeza-logo\.svg/);
  // The app-launch block (store badges + "coming soon" card) was removed on request.
  // The app is not published, so the footer must not advertise it again.
  assert.doesNotMatch(lowerHome, /storefront-footer-app-launch/);
  assert.doesNotMatch(lowerHome, /FaGooglePlay|FaAppStoreIos/);
  assert.doesNotMatch(lowerHome, /Google Play|App Store|انتظروا إطلاق التطبيق/);
  assert.match(lowerHome, /m-one-logo-dark-fixed\.png/);
  assert.match(lowerHome, /m-one-logo-white-fixed\.png/);
  assert.match(lowerHome, /sf-header-logo-moving-m/);
  assert.match(lowerHome, /buildWhatsAppHref/);
  assert.match(lowerHome, /support@m1store-egy\.com/);
  assert.match(lowerHome, /جميع الحقوق محفوظة/);
});

// The owner removed the teal/blue service-strip + footer chrome once already and a
// later change brought it back. Keep this guard so the blue can never return silently:
// the strip, the copyright bar and the subscribe button must stay on the site's black.
test("storefront service strip and footer never reintroduce the teal blue", async () => {
  const source = await readFile(new URL("../src/storefront/Storefront.jsx", import.meta.url), "utf8");
  const forbiddenTeals = ["2f687f", "25566a", "1f4d5f", "3b7a94"];

  for (const teal of forbiddenTeals) {
    assert.equal(
      source.toLowerCase().includes(teal),
      false,
      `storefront must not use the retired teal #${teal} — use the site black (#121212 / #080808 / #050505) instead`,
    );
  }

  const lowerHome = source.slice(source.indexOf("function HomeWhySection"), source.indexOf("function SimpleHomeProductGrid"));
  assert.match(lowerHome, /data-testid="storefront-service-strip"[^>]*bg-\[linear-gradient\(180deg,#121212_0%,#080808_100%\)\]/);
  assert.match(lowerHome, /bg-\[#050505\] px-5 py-5 text-center/);
});
