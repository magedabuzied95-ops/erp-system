import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const posSource = read("../src/modules/pos/pages/POSPro.jsx");
const drawerSource = read("../src/modules/pos/components/RecentOperationsDrawer.jsx");
const receiptSource = read("../src/modules/pos/components/CartSidebar.jsx");
const printServiceSource = read("../src/modules/pos/lib/thermalReceiptPrint.jsx");
const ordersControllerSource = read("../server/controllers/ordersController.js");
const settingsSource = read("../shared/settingsRegistry.js");

test("all POS invoice actions use the shared thermal receipt print service", () => {
  assert.match(posSource, /printThermalReceipt\(receiptContext/);
  assert.match(posSource, /onPrintOrder=\{\(order\) => handlePrint\(order\)\}/);
  assert.match(drawerSource, /await onPrintOrder\?\.\(loadedOrder\)/);
  assert.doesNotMatch(drawerSource, /document\.write|window\.print|printWindow/);
});

test("recent POS actions warm and reuse invoice details without delaying successful printing", () => {
  assert.match(drawerSource, /ORDER_SUMMARY_CACHE_TTL_MS/);
  assert.match(drawerSource, /orderSummaryRequests/);
  assert.match(drawerSource, /requestIdleCallback/);
  assert.match(drawerSource, /onPointerEnter=\{\(\) => onPrefetch\?\.\(order\)\}/);
  assert.match(drawerSource, /void api\.post\(`\/orders\/\$\{order\.id\}\/reprint-log`/);
  assert.match(posSource, /warmThermalReceiptPrinter\(\)/);
  assert.match(printServiceSource, /receiptRendererPromise/);
  assert.match(printServiceSource, /getReceiptRenderer\(\)/);
  assert.match(ordersControllerSource, /Promise\.all\(\[\s*editAuditsPromise,\s*reprintLogsPromise,\s*returnLogsPromise/);
});

test("automatic printing is driven by the persisted POS setting and the completed order snapshot", () => {
  assert.match(posSource, /receiptRuntimeSettings\.printReceiptAutomatically/);
  assert.match(posSource, /handlePrint\(normalizedOrder, \{ silent: true \}\)/);
  assert.match(printServiceSource, /activePrintJobs/);
  assert.match(printServiceSource, /native-silent/);
  assert.match(printServiceSource, /browser-kiosk/);
  assert.match(settingsSource, /الطباعة التلقائية للفاتورة بعد إتمام البيع/);
});

test("thermal receipt preserves business data with a clear compact product image", () => {
  for (const label of ["رقم الفاتورة", "البائع", "العميل", "الهاتف", "الدفع", "خصم الفاتورة", "خصم الكوبون", "خصم الولاء", "الضريبة", "الإجمالي", "المدفوع", "المتبقي"]) {
    assert.match(receiptSource, new RegExp(label));
  }
  const thermalBlock = receiptSource.slice(receiptSource.indexOf("function ThermalReceiptFinal"), receiptSource.indexOf("function ReceiptSocialLink"));
  assert.match(thermalBlock, /thermal-item-image/);
  assert.match(thermalBlock, /resolveProductImageUrl/);
  assert.doesNotMatch(thermalBlock, /M1-Store|01000659301/);
  assert.match(receiptSource, /M1_CUSTOMER_SERVICE_PHONE = "01000659301"/);
  assert.match(thermalBlock, /www\.m1store-egy\.com/);
  assert.doesNotMatch(thermalBlock, /customerPhone|customer\.phone|customer\.mobile/);
  assert.match(receiptSource, /thermal-website/);
  assert.match(thermalBlock, /store\.logoUrl/);
  assert.match(receiptSource, /@page\{margin:0\}/);
  assert.match(receiptSource, /\.thermal-final\{width:100%/);
  assert.match(receiptSource, /formatCurrency\([^;]+, "ar"\)/);
  assert.match(receiptSource, /الموقع الإلكتروني الرسمي/);
  assert.match(receiptSource, /9919.*padStart\(12/);
  assert.match(receiptSource, /M1_RECEIPT_FALLBACK_LOGO/);
  assert.match(receiptSource, /M1_RECEIPT_THERMAL_LOGO/);
  assert.match(receiptSource, /e_grayscale,e_contrast:80,e_blackwhite:50/);
  assert.match(receiptSource, /resolveThermalStoreLogo\(store\.logoUrl\)/);
  assert.match(receiptSource, /border-radius:50%/);
  assert.match(printServiceSource, /image\.decode\(\)/);
  assert.match(printServiceSource, /image\.naturalWidth > 0/);
  assert.doesNotMatch(receiptSource, /www\.workspace\.com/);
  assert.doesNotMatch(receiptSource, /امسح لفتح الفاتورة في العمليات الأخيرة/);
  assert.doesNotMatch(thermalBlock, /thermal-barcode-number/);
  assert.doesNotMatch(printServiceSource, /window\.open\(/);
  assert.doesNotMatch(printServiceSource, /width: 80mm|min-width: 80mm/);
  assert.match(printServiceSource, /printInFrame\(html, "browser-preview"\)/);
});

test("thermal receipt shows only the POS seller and standardizes typography", () => {
  const thermalStart = receiptSource.indexOf("const THERMAL_RECEIPT_FINAL_CSS");
  const thermalEnd = receiptSource.indexOf("function ReceiptSocialLink", thermalStart);
  const thermalSource = receiptSource.slice(thermalStart, thermalEnd);

  assert.match(thermalSource, /const salesperson = sellerName \|\| ""/);
  assert.match(thermalSource, /<dt>البائع<\/dt>/);
  assert.doesNotMatch(thermalSource, /<dt>الكاشير<\/dt>/);
  assert.doesNotMatch(thermalSource, /thermal-tagline/);
  assert.match(thermalSource, /font-family:Arial,sans-serif!important/);
});

test("invoice barcode opens the matching recent operation instead of product lookup", () => {
  assert.match(posSource, /rawValue\.match\(\/\^9919\(\\d\{12\}\)\$\//);
  assert.match(posSource, /setScannedInvoiceNumber\(scannedInvoice\)/);
  assert.match(posSource, /requestedInvoiceNumber=\{scannedInvoiceNumber\}/);
  assert.match(drawerSource, /requestedDigits/);
  assert.match(drawerSource, /invoiceDigits === requestedDigits/);
  assert.match(drawerSource, /handleSearchChange/);
  assert.match(drawerSource, /value\.trim\(\)\.match\(\/\^9919/);
  assert.match(drawerSource, /setScannedInvoiceLookup\(invoiceLookup\)/);
  assert.match(drawerSource, /setSelectedOrder\(loadedOrder\)/);
});
