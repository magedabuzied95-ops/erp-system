import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

/**
 * Guards for the POS till audit: scanner, receipts, Paymob terminal, checkout
 * locking, update reloads, printing, exchange credit and shift close. Sources are
 * read with CRLF normalised so the slices below work in any checkout.
 */
const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const pos = read("../src/modules/pos/pages/POSPro.jsx");
const cart = read("../src/modules/pos/components/CartSidebar.jsx");
const printer = read("../src/modules/pos/lib/thermalReceiptPrint.jsx");

const slice = (source, start, end) => {
  const from = source.indexOf(start);
  assert.ok(from >= 0, `missing start marker: ${start}`);
  const to = source.indexOf(end, from + start.length);
  assert.ok(to > from, `missing end marker: ${end}`);
  return source.slice(from, to);
};

test("the global scanner listener mounts once and reaches the latest handler through a ref", () => {
  const effect = slice(pos, "const resetGlobalBarcodeBuffer = () => {", "const addVariantToCart = useCallback(");
  assert.match(effect, /handleBarcodeSubmitRef\.current\?\.\(normalizedValue, \{ source: "scanner" \}\)/);
  assert.match(effect, /window\.removeEventListener\("keydown", onGlobalBarcodeKeyDown\);\n\s+resetGlobalBarcodeBuffer\(\);\n\s+\};\n\s+\}, \[\]\);/);
  assert.doesNotMatch(pos, /\}, \[handleBarcodeSubmit\]\);/);
  assert.match(pos, /handleBarcodeSubmitRef\.current = handleBarcodeSubmit;/);
});

test("a scan that finds nothing clears the search box and its persisted copy", () => {
  const notFound = slice(pos, 'console.error("[pos] product QR lookup failed:", error);', "handleBarcodeSubmitRef.current = handleBarcodeSubmit;");
  assert.match(notFound, /options\?\.source === "scanner" \|\| looksLikeScannedCode\(rawValue\)/);
  assert.match(notFound, /setSearch\(""\);/);
  assert.match(notFound, /writePosPersistedState\(\{ \.\.\.persistedState, search: "" \}\)/);
});

test("checkout takes a synchronous lock before anything awaits", () => {
  const wrapper = slice(pos, "const handleCheckout = async (options = {}) => {", "const getReceiptRenderContext");
  assert.match(wrapper, /if \(checkoutLockRef\.current\) return null;\n\s+checkoutLockRef\.current = true;\n\s+try \{\n\s+return await runCheckout\(options\);\n\s+\} finally \{\n\s+checkoutLockRef\.current = false;/);
});

test("a Paymob terminal transaction becomes exactly one order with one idempotency key", () => {
  const finalize = slice(pos, "const finalizePaymobTerminalOrder = ", "const stopPaymobPolling = () => {");
  assert.match(finalize, /if \(entry\.promise\) return entry\.promise\.then\(\(order\) => \(\{ order, joined: true \}\)\);/);
  assert.match(finalize, /checkoutActionRef\.current\?\.\(\{/);
  assert.match(finalize, /idempotencyKey: entry\.idempotencyKey/);
  const polling = slice(pos, "const startPaymobTerminalPolling = ", "const handlePaymobTerminalPayment = async () => {");
  assert.doesNotMatch(polling, /handleCheckout\(/);
  assert.match(polling, /suppressErrorStatuses: \[501, 502, 503\],\n\s+\}\);\n\s+if \(pollAbandoned\(\)\) return;/);
  assert.match(polling, /paymobPollingRef\.current\.session !== pollSession/);
  assert.equal((polling.match(/await finalizePaymobTerminalOrder\(/g) || []).length, 2);
  assert.match(pos, /typeof options\?\.idempotencyKey === "string" && options\.idempotencyKey\n\s+\? options\.idempotencyKey/);
});

test("a saved invoice edit never reports failure because a refresh failed, and it auto-prints", () => {
  const editPath = slice(pos, "invalidatePosEditOrder(editingOrder.id);", "apiStartedAt = performance.now();");
  assert.doesNotMatch(editPath, /await refreshCatalogProducts/);
  assert.match(editPath, /scheduleCatalogRefreshAfterPrint\(editPrintPromise\)/);
  assert.match(editPath, /receiptRuntimeSettings\.printReceiptAutomatically\n\s+\? handlePrint\(editedReceiptOrder, \{ silent: true \}\)/);
  const scheduler = slice(pos, "const scheduleCatalogRefreshAfterPrint = ", "const runCheckout = async");
  assert.match(scheduler, /window\.setTimeout\(startOnce, 1500\)/);
  assert.match(scheduler, /\.catch\(\(refreshError\) =>/);
  assert.match(pos, /handleCloseInvoiceTab\(activeInvoiceTabId, \{ completed: true \}\);\n\s+scheduleCatalogRefreshAfterPrint\(autoPrintPromise\);/);
});

test("the service-worker update waits for the success screen and the printer", () => {
  assert.match(pos, /saleInProgressRef\.current = Boolean\(cart\?\.length\) \|\| Boolean\(selectedCustomerId\) \|\| Boolean\(checkoutSuccessOpen\);/);
  const apply = slice(pos, "const applyPendingUpdate = () => {", "window.location.reload();");
  assert.match(apply, /if \(printInFlightRef\.current > 0\) return;/);
  const print = slice(pos, "const handlePrint = async (source = null, options = {}) => {", "useEffect(() => {");
  assert.match(print, /printInFlightRef\.current \+= 1;/);
  assert.match(print, /printInFlightRef\.current = Math\.max\(0, printInFlightRef\.current - 1\);\n\s+\}, 3000\);/);
  assert.match(print, /t\("pos\.toasts\.printSent"\)/);
  assert.match(print, /PRINT_RENDERER_UNAVAILABLE/);
});

test("receipt settings survive a failed load and keep retrying", () => {
  assert.match(pos, /readCachedReceiptRuntimeSettings\(receiptSettingsTenantKey\) \|\|/);
  const loader = slice(pos, 'api.get("/pos/receipt-settings"', "}, [receiptSettingsTenantKey]);");
  assert.match(loader, /writeCachedReceiptRuntimeSettings\(nextSettings, receiptSettingsTenantKey\)/);
  assert.match(pos, /const retryDelaysMs = \[2000, 5000, 15000\];/);
  assert.match(loader, /retryDelaysMs\[attempt\] \?\? 60000/);
  assert.match(loader, /window\.addEventListener\("online", load\)/);
  assert.match(pos, /window\.requestIdleCallback\(\(\) => warmThermalReceiptPrinter\(\), \{ timeout: 3000 \}\)/);
});

test("the receipt renderer retries its chunk and every print phase is logged in memory", () => {
  assert.match(printer, /importWithChunkRetry\(\(\) => import\("react-dom\/server"\), \{ recover: false \}\)/);
  assert.match(printer, /setTimeout\(resolve, RENDERER_RETRY_DELAY_MS\)\)\.then\(loadReceiptRenderer\)/);
  assert.match(printer, /const RENDERER_RETRY_DELAY_MS = 1500;/);
  assert.match(printer, /const IMAGE_LOAD_WAIT_MS = 1200;/);
  assert.match(printer, /window\.__posPrintLog = printLog/);
  for (const phase of ["import_ms", "render_ms", "images_ms", "error"]) {
    assert.match(printer, new RegExp(`recordPrintPhase\\("${phase}"`));
  }
  assert.doesNotMatch(printer, /console\./);
});

test("the cart can no longer apply an invoice total as exchange credit", () => {
  const modal = slice(cart, "function ExchangeCreditModal(", "function SplitPaymentSheet(");
  assert.doesNotMatch(modal, /creditAmount/);
  assert.doesNotMatch(modal, /onApply/);
  assert.match(modal, /onOpenInvoiceReturn\?\.\(text\)/);
  assert.doesNotMatch(pos, /onApplyExchangeCredit=/);
  assert.match(pos, /onOpenExchangeReturn=\{handleOpenExchangeReturn\}/);
  assert.match(pos, /code === "EXCHANGE_CREDIT_NOT_AVAILABLE"/);
});

test("closing a shift requires the counted cash, and a late close keeps the same opening day", () => {
  const close = slice(pos, "const handleConfirmCloseShift = async () => {", "const handleSaveQuickExpense");
  assert.doesNotMatch(close, /closingCash === "" \? 0/);
  assert.match(close, /String\(closingCash \?\? ""\)\.trim\(\) === ""/);
  assert.match(close, /toast\.error\(t\("pos\.toasts\.closingCashRequired"\)\);\n\s+return;/);
  assert.match(pos, /shiftDateKey\(todayInAppTimezone\(\), cairoHourNow\(\) < 5 \? 0 : 1\)/);
  assert.match(pos, /timeZone: "Africa\/Cairo", hour: "2-digit", hourCycle: "h23"/);
});

test("the till prints no trace logs in production and the dead POS re-exports are gone", () => {
  const stray = pos
    .split("\n")
    .filter((line) => /console\.(log|info)\(/.test(line))
    .filter((line) => !/\(\.\.\.args\) => console\./.test(line) && !/POS_SW_REGISTER/.test(line));
  assert.deepEqual(stray, []);
  assert.doesNotMatch(pos, /seller-debug[^\n]*\n\s+selectedSalespersonId,\n\s+selectedSeller,/);
  assert.equal(existsSync(new URL("../src/pages/POS.jsx", import.meta.url)), false);
  assert.equal(existsSync(new URL("../src/modules/sales/pages/POS.jsx", import.meta.url)), false);
});
