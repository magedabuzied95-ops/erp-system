import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const posSource = read("../src/modules/pos/pages/POSPro.jsx");
const drawerSource = read("../src/modules/pos/components/RecentOperationsDrawer.jsx");
const receiptSource = read("../src/modules/pos/components/CartSidebar.jsx");
const printServiceSource = read("../src/modules/pos/lib/thermalReceiptPrint.jsx");
const settingsSource = read("../shared/settingsRegistry.js");

test("all POS invoice actions use the shared thermal receipt print service", () => {
  assert.match(posSource, /printThermalReceipt\(receiptContext/);
  assert.match(posSource, /onPrintOrder=\{\(order\) => handlePrint\(order\)\}/);
  assert.match(drawerSource, /await onPrintOrder\?\.\(loadedOrder\)/);
  assert.doesNotMatch(drawerSource, /document\.write|window\.print|printWindow/);
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
  for (const label of ["رقم الفاتورة", "الكاشير", "العميل", "الهاتف", "الدفع", "خصم الفاتورة", "خصم الكوبون", "خصم الولاء", "الضريبة", "الإجمالي", "المدفوع", "المتبقي"]) {
    assert.match(receiptSource, new RegExp(label));
  }
  const thermalBlock = receiptSource.slice(receiptSource.indexOf("function ThermalReceiptFinal"), receiptSource.indexOf("function ReceiptSocialLink"));
  assert.match(thermalBlock, /thermal-item-image/);
  assert.match(thermalBlock, /resolveProductImageUrl/);
  assert.doesNotMatch(thermalBlock, /M1-Store|01000659301/);
  assert.match(thermalBlock, /www\.m1store-egy\.com/);
  assert.match(thermalBlock, /store\.logoUrl/);
  assert.match(receiptSource, /@page\{margin:0\}/);
  assert.match(receiptSource, /\.thermal-final\{width:100%/);
  assert.match(receiptSource, /formatCurrency\([^;]+, "ar"\)/);
  assert.match(receiptSource, /الموقع الإلكتروني الرسمي/);
  assert.match(receiptSource, /9919.*padStart\(12/);
  assert.match(receiptSource, /M1_RECEIPT_FALLBACK_LOGO/);
  assert.doesNotMatch(receiptSource, /www\.workspace\.com/);
  assert.doesNotMatch(receiptSource, /امسح لفتح الفاتورة في العمليات الأخيرة/);
  assert.doesNotMatch(thermalBlock, /thermal-barcode-number/);
  assert.doesNotMatch(printServiceSource, /window\.open\(/);
  assert.doesNotMatch(printServiceSource, /width: 80mm|min-width: 80mm/);
  assert.match(printServiceSource, /printInFrame\(html, "browser-preview"\)/);
});

test("invoice barcode opens the matching recent operation instead of product lookup", () => {
  assert.match(posSource, /rawValue\.match\(\/\^9919\(\\d\{12\}\)\$\//);
  assert.match(posSource, /setScannedInvoiceNumber\(scannedInvoice\)/);
  assert.match(posSource, /requestedInvoiceNumber=\{scannedInvoiceNumber\}/);
  assert.match(drawerSource, /requestedDigits/);
  assert.match(drawerSource, /invoiceDigits === requestedDigits/);
  assert.match(drawerSource, /setSelectedOrder\(loadedOrder\)/);
});
