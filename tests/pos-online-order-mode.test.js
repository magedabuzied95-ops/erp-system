import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const posRouteSource = read("server/routes/pos.js");
const storefrontControllerSource = read("server/controllers/storefrontController.js");
const whatsappSource = read("server/services/whatsappOrderConfirmationService.js");
const posSource = read("src/modules/pos/pages/POSPro.jsx");
const cartSource = read("src/modules/pos/components/CartSidebar.jsx");
const modalSource = read("src/modules/pos/components/PosOnlineOrderModal.jsx");

const enPos = JSON.parse(read("src/locales/en/pos.json"));
const arPos = JSON.parse(read("src/locales/ar/pos.json"));
const resolvesInBothLocales = (key) => {
  for (const bundle of [enPos, arPos]) {
    const value = key.split(".").reduce((node, part) => (node == null ? node : node[part]), bundle);
    assert.equal(typeof value, "string", `pos.${key} must resolve to a string in both locales`);
    assert.ok(value.trim().length > 0, `pos.${key} must not be empty`);
  }
};

/*
 * POS online-invoice mode raises a WEBSITE order from the till. Everything the customer then
 * experiences — the pending_confirmation status, the WhatsApp confirmation with its buttons, the
 * shipping path — comes from the storefront checkout controller, so the guards below pin the two
 * things that would quietly break it: routing the till somewhere else, and losing one of the four
 * conditions the WhatsApp confirmation gate actually tests.
 */

test("the till posts online orders to the website checkout controller, behind auth", () => {
  assert.match(
    posRouteSource,
    /router\.post\("\/online-order", protect, permit\("orders", "create"\), createPosOnlineOrder\);/,
    "POST /pos/online-order must exist and be both authenticated and permission-gated"
  );
  assert.match(
    posRouteSource,
    /import \{ createPosOnlineOrder \} from "\.\.\/controllers\/storefrontController\.js";/,
    "the route must reuse the storefront controller rather than a second implementation"
  );
  // The wrapper is the only thing that turns staff attribution on, and it is reachable only
  // through the authenticated route above.
  assert.match(
    storefrontControllerSource,
    /export const createPosOnlineOrder = async \(req, res\) => \{\s*req\.posOnlineOrder = true;\s*return createWebsiteOrder\(req, res\);/,
    "createPosOnlineOrder must flag the request and delegate to createWebsiteOrder"
  );
});

test("branch, cashier and seller are read off the session, never off the public body", () => {
  assert.match(
    storefrontControllerSource,
    /const staffAttribution = posOnlineOrder \? buildPosStaffAttribution\(req, checkoutRaw\) : null;/,
    "attribution must be gated on the internal flag, so a public checkout can never set it"
  );
  const helper = storefrontControllerSource.match(/const buildPosStaffAttribution = \(req, body = \{\}\) => \{[\s\S]*?\n\};/);
  assert.ok(helper, "buildPosStaffAttribution must exist");
  const helperBody = helper[0];
  assert.match(helperBody, /const cashierId = positiveId\(user\.id\);/, "the cashier is the authenticated user");
  assert.match(helperBody, /cashier_user_id: cashierId/);
  assert.match(helperBody, /created_by: cashierId/);
  // The seller is a cashier's on-screen choice, so it does come from the body — but only as an id.
  assert.match(helperBody, /const sellerUserId = positiveId\(body\.seller_user_id/);
  assert.match(helperBody, /const salesEmployeeId = positiveId\(body\.sales_employee_id/);
  assert.match(helperBody, /origin_surface: "pos"/, "POS-raised website orders must be markable in reporting");
  assert.match(
    storefrontControllerSource,
    /ADD COLUMN IF NOT EXISTS origin_surface VARCHAR\(30\)/,
    "origin_surface must be ensured before the insert tries to use it"
  );
  assert.match(
    storefrontControllerSource,
    /\.\.\.\(staffAttribution \|\| \{\}\),\s*\n\s*\}, checkoutColumns\.orders, \{ step: "create order" \}\);/,
    "attribution must be spread into the order insert"
  );
  // The tenant comes from the session too — a header must not be able to redirect a till order
  // into another tenant.
  assert.match(
    storefrontControllerSource,
    /const tenantId = posOnlineOrder && Number\.isFinite\(sessionTenantId\) && sessionTenantId > 0\s*\n?\s*\? sessionTenantId/,
    "an authenticated till order must resolve its tenant from the session"
  );
});

test("the four conditions the WhatsApp confirmation gate tests all still hold for a till order", () => {
  // 1+2: the order is written as a website order.
  assert.match(storefrontControllerSource, /channel: "storefront",\s*\n\s*source: "website",/);
  assert.match(whatsappSource, /const STOREFRONT_SOURCES = new Set\(\["storefront", "website", "web"\]\);/);
  // 3: cash on delivery lands it in pending_confirmation.
  assert.match(
    storefrontControllerSource,
    /paymentMethod === "cod"\s*\n\s*\? "pending_confirmation"/,
    "a COD order must be created pending confirmation"
  );
  // 4: the till only ever sends COD, which is what opens the gate.
  assert.match(modalSource, /payment_method: "cod",\s*\n\s*payment_type: "cod",\s*\n\s*paid_amount: 0,/);
  // And the gate itself still tests exactly those things.
  assert.match(whatsappSource, /!STOREFRONT_SOURCES\.has\(sourceOf\(current\)\)/);
  assert.match(whatsappSource, /!isCodPayment\(current\)/);
  assert.match(whatsappSource, /text\(current\.status\)\.toLowerCase\(\) !== "pending_confirmation"/);
  assert.match(storefrontControllerSource, /sendOrderConfirmation\(\{ \.\.\.order, items: normalizedItems \}\)/);
});

test("online mode is locked out wherever it could not settle", () => {
  const guard = posSource.match(/const onlineInvoiceBlockedReason = useMemo\(\(\) => \{[\s\S]*?\}, \[[^\]]*\]\);/);
  assert.ok(guard, "the block-reason guard must exist");
  const guardBody = guard[0];
  // Editing and exchanging both settle through /orders, which this mode never touches.
  assert.match(guardBody, /if \(editingOrder\?\.id\) return "editing";/);
  assert.match(guardBody, /if \(exchangeState\?\.active\) return "exchange";/);
  // An online order needs a live shipping quote and a WhatsApp send, so it cannot be queued.
  assert.match(guardBody, /navigator\.onLine === false\) return "offline";/);
  assert.match(guardBody, /if \(posShiftNetworkUnavailable\) return "offline";/);
  assert.match(
    posSource,
    /const isOnlineInvoiceMode = invoiceMode === "online" && !onlineInvoiceBlockedReason;/,
    "a blocked reason must disable the mode, not merely warn"
  );
  assert.match(
    posSource,
    /if \(invoiceMode === "online" && onlineInvoiceBlockedReason\) setInvoiceMode\("counter"\);/,
    "the mode must fall back to the counter invoice when it becomes impossible"
  );
  for (const key of ["onlineOrder.blocked.editing", "onlineOrder.blocked.exchange", "onlineOrder.blocked.offline"]) {
    resolvesInBothLocales(key);
  }
});

test("the invoice-type switch sits in the cart, where the cashier decides it", () => {
  // It started life as a <select> in the top toolbar and read as a label — the shop owner
  // could not find it. It belongs above the cart, as two buttons that show which is active.
  assert.match(cartSource, /role="group" aria-label=\{posLabel\("onlineOrder\.modeLabel"/);
  assert.match(cartSource, /\{ key: "counter", label: posLabel\("onlineOrder\.modeCounter"/);
  assert.match(cartSource, /\{ key: "online", label: posLabel\("onlineOrder\.modeOnline"/);
  assert.match(cartSource, /onClick=\{\(\) => onInvoiceModeChange\(option\.key\)\}/);
  assert.match(cartSource, /const active = option\.key === \(onlineMode \? "online" : "counter"\);/);
  // Both cart instances — desktop column and mobile drawer — must be able to switch it.
  assert.equal((posSource.match(/onInvoiceModeChange=\{setInvoiceMode\}/g) || []).length, 2);
  // And the old toolbar control must not come back alongside it: two controls for one
  // state is what made it ambiguous in the first place.
  assert.doesNotMatch(posSource, /onChange=\{\(event\) => setInvoiceMode\(event\.target\.value\)\}/);
});

test("the till collects nothing on an online order", () => {
  assert.match(
    posSource,
    /if \(isOnlineInvoiceMode\) \{\s*\n\s*setOnlineOrderOpen\(true\);\s*\n\s*return null;\s*\n\s*\}/,
    "the checkout button must open the address sheet instead of running the counter checkout"
  );
  assert.match(
    cartSource,
    /const paymentMismatch = onlineMode \|\| personalPaymentActive/,
    "the collection check must not block an order that collects nothing"
  );
  assert.match(cartSource, /const shouldShowPaymentDetails = onlineMode\s*\n\s*\? false/);
  // Credit and the Paymob terminal are both ways of taking money now, so neither is rendered.
  assert.match(cartSource, /\{onlineMode \? null : \(\s*\n\s*<>\s*\n\s*<button/);
  assert.match(cartSource, /onCreditSale\?\.\(\);/);
  assert.match(cartSource, /onClick=\{onPaymobTerminal\}/);
  // No shift id is attached, so the order stays out of the drawer reconciliation.
  assert.doesNotMatch(modalSource, /shift_id/);
});

test("online-order strings resolve in both dictionaries", () => {
  for (const key of [
    "onlineOrder.modeLabel",
    "onlineOrder.modeCounter",
    "onlineOrder.modeOnline",
    "onlineOrder.checkoutLabel",
    "onlineOrder.cartNotice",
    "onlineOrder.title",
    "onlineOrder.submit",
    "onlineOrder.codNotice",
    "onlineOrder.fields.phone",
    "onlineOrder.fields.detailedAddress",
    "onlineOrder.summary.repriceNotice",
    "onlineOrder.errors.phoneInvalid",
    "onlineOrder.success.title",
    "onlineOrder.success.whatsapp",
  ]) {
    resolvesInBothLocales(key);
  }
});

test("the shipping-address helpers have exactly one implementation", () => {
  const shared = read("src/shared/lib/shippingCheckout.js");
  for (const name of [
    "normalizeCheckoutPickerText",
    "buildBostaPickerOption",
    "buildBostaPickerOptions",
    "normalizeShippingQuote",
    "matchBostaPickerOption",
    "bostaCityPatch",
    "bostaZonePatch",
    "bostaDistrictPatch",
  ]) {
    assert.match(shared, new RegExp(`export const ${name} =`), `${name} must live in the shared module`);
  }
  // Both checkouts must consume the shared module rather than growing private copies that drift.
  const storefrontSource = read("src/storefront/Storefront.jsx");
  for (const source of [storefrontSource, modalSource]) {
    assert.match(source, /from "\.\.?\/(?:\.\.\/)*shared\/lib\/shippingCheckout"/);
    assert.doesNotMatch(source, /^const (?:buildBostaPickerOption|normalizeShippingQuote|bostaCityPatch) =/m);
  }
});
