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

test("the invoice-type dropdown sits in the toolbar beside the shift control", () => {
  // Maged asked for it here, next to Close Shift, twice. It must sit immediately before that
  // button — the shift control is the landmark he navigates by.
  const control = posSource.match(/\{\/\* Invoice type, sitting with the shift control[\s\S]*?\n {10}\/>/);
  assert.ok(control, "the invoice-type control must exist in the toolbar");
  const markup = control[0];
  assert.match(markup, /<ThemedSelect/, "it must use the one shared dropdown, not a private one");
  assert.match(markup, /value=\{invoiceMode\}/);
  assert.match(markup, /onChange=\{setInvoiceMode\}/);
  assert.match(markup, /options=\{invoiceModeOptions\}/);
  // The blocked option keeps its place in the list, carrying the reason.
  assert.match(posSource, /disabled: Boolean\(onlineInvoiceBlockedReason\),\s*\n\s*hint: onlineInvoiceBlockedReason \? t\(`pos\.onlineOrder\.blocked\./);
  // Adjacency, checked by reading what actually follows — a regex like /\/>\s*<button.../
  // passes happily when another element is spliced in, because that element supplies its own
  // "/>" for the pattern to latch onto. So: take the next element and insist it is the button.
  const afterClose = posSource.slice(posSource.indexOf("{/* Invoice type, sitting with the shift control"));
  const afterSelfClose = afterClose.slice(afterClose.indexOf("/>") + 2);
  const nextTagAt = afterSelfClose.indexOf("<");
  assert.match(afterSelfClose.slice(0, nextTagAt), /^\s*$/, "only whitespace may separate them");
  assert.match(
    afterSelfClose.slice(nextTagAt, nextTagAt + 200),
    /^<button\s*\n\s*type="button"\s*\n\s*onClick=\{handleCloseShift\}/,
    "the element right after the invoice-type control must be the shift button"
  );
  // One control for one piece of state: the cart must not grow a second switch beside it.
  assert.doesNotMatch(cartSource, /onInvoiceModeChange/);
});

test("the app draws its own option list instead of delegating to the OS", () => {
  // A native <select> cannot be themed past the closed control: the OS paints the option list,
  // so on this dark ERP it opens as a bare rectangle with no radius, spacing or tokens. One
  // shared component draws it — and it must portal, because callers sit inside overflow-hidden
  // shells (the POS toolbar, drawers, table cells) that would otherwise clip the panel.
  const menuSource = read("src/shared/ui/ThemedSelect.jsx");
  assert.match(menuSource, /createPortal\(/);
  assert.match(menuSource, /document\.fullscreenElement \|\| document\.body/, "the till runs fullscreen; body-mounted panels hide behind it");
  assert.match(menuSource, /position: "fixed"/);
  // Reposition on scroll and resize, or the panel drifts off its trigger.
  assert.match(menuSource, /window\.addEventListener\("resize", onViewportChange\)/);
  assert.match(menuSource, /window\.addEventListener\("scroll", onViewportChange, true\)/);
  // Dismissal and keyboard: without these the drawn list is a downgrade on a native one.
  assert.match(menuSource, /document\.addEventListener\("mousedown", onPointerDown\)/);
  assert.match(menuSource, /event\.key === "Escape"/);
  assert.match(menuSource, /event\.key === "ArrowDown"/);
  assert.match(menuSource, /role="listbox"/);
  assert.match(menuSource, /role="combobox"/);
  assert.match(menuSource, /aria-activedescendant/);
  // Touch keeps the OS wheel picker, which genuinely beats a drawn list on a phone.
  assert.match(menuSource, /\(pointer: coarse\)/);
  assert.match(menuSource, /if \(coarsePointer \|\| forceNative\)/);
  // A disabled option keeps its place and its reason rather than vanishing.
  assert.match(menuSource, /if \(!option \|\| option\.disabled\) return;/);
  assert.match(menuSource, /\{option\.hint \? \(/);
});

test("the copy-pasted local Select wrappers all route through the shared dropdown", () => {
  // Nineteen near-identical Select/SelectField components had grown across the app, each with
  // its own native <select>. They keep their props — no call site changed — but the control
  // underneath is now one component, so the next styling fix lands everywhere at once.
  const migrated = [
    "src/modules/accounting/pages/Expenses.jsx",
    "src/modules/accounting/pages/Revenues.jsx",
    "src/modules/accounting/pages/Treasury.jsx",
    "src/modules/aiSupport/pages/AiAgentSettings.jsx",
    "src/modules/attendance/components/AttendanceWorkspace.jsx",
    "src/modules/coupons/pages/CouponsManager.jsx",
    "src/modules/inventory/pages/InventoryCount.jsx",
    "src/modules/inventory/pages/StockTransfers.jsx",
    "src/modules/notifications/pages/NotificationsCenter.jsx",
    "src/modules/orders/pages/OrdersDashboard.jsx",
    "src/modules/permissions/pages/Users.jsx",
    "src/modules/pos/components/PosOnlineOrderModal.jsx",
    "src/modules/purchases/pages/PurchaseOrder.jsx",
    "src/modules/purchases/pages/PurchasesDashboard.jsx",
    "src/modules/purchases/pages/SuppliersDashboard.jsx",
    "src/modules/reports/pages/Reports.jsx",
    "src/modules/sales/pages/SalesEmployees.jsx",
    "src/modules/shipping/pages/ShippingCenter.jsx",
    "src/modules/smartWarehouse/pages/SmartWarehouse.jsx",
  ];
  for (const file of migrated) {
    const source = read(file);
    assert.match(source, /shared\/ui\/ThemedSelect/, `${file} must import the shared dropdown`);
    assert.match(source, /<ThemedSelect/, `${file} must render it`);
    // The wrapper's own <select> is gone; any left here is a wrapper that slipped back.
    const wrapper = source.match(/function (?:Select|SelectField|SelectFilter|SelectInput|Picker)\([\s\S]*?\n\}/);
    if (wrapper) assert.doesNotMatch(wrapper[0], /<select/, `${file} wrapper still renders a native select`);
  }
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
