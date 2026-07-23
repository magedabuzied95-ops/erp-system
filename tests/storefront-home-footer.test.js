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
  assert.match(lowerHome, /m-one-logo-dark-fixed\.png/);
  assert.match(lowerHome, /m-one-logo-white-fixed\.png/);
  assert.match(lowerHome, /sf-header-logo-moving-m/);
  assert.match(lowerHome, /FaGooglePlay/);
  assert.match(lowerHome, /FaAppStoreIos/);
  assert.match(lowerHome, /Google Play/);
  assert.match(lowerHome, /App Store/);
  assert.match(lowerHome, /buildWhatsAppHref/);
  assert.match(lowerHome, /support@m1store-egy\.com/);
  assert.match(lowerHome, /جميع الحقوق محفوظة/);
});
