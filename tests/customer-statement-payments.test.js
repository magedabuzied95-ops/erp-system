import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("customer payments are stored separately from loyalty wallet adjustments", () => {
  const controller = source("server/controllers/customersController.js");
  assert.match(controller, /CREATE TABLE IF NOT EXISTS customer_payments/);
  assert.match(controller, /transaction_type:\s*"customer_payment"/);
  assert.match(controller, /recordFinancialAccountActivity/);
  assert.match(controller, /account_code:\s*"1100"/);
  assert.match(controller, /tenant_id:\s*row\.tenant_id/);
  assert.match(controller, /Number\(customer\.tenant_id \|\| requestedTenantId \|\| 0\)/);
  assert.match(controller, /CREATE TABLE IF NOT EXISTS customer_payment_allocations/);
  assert.match(controller, /reconcileCustomerInvoicePayments/);
  assert.match(controller, /payment_status = CASE/);
  assert.match(controller, /'partially_paid'/);
  assert.match(controller, /'paid'/);
});

test("customer statement has a professional payment workflow", () => {
  const customers = source("src/modules/sales/pages/Customers.jsx");
  assert.match(customers, /تسجيل دفعة من العميل/);
  assert.match(customers, /payment_method/);
  assert.match(customers, /payment_date/);
  assert.match(customers, /المتبقي على العميل/);
  assert.match(customers, /دفعات العملاء/);
  assert.match(customers, /العودة للعملاء/);
  assert.match(customers, /onViewOrder/);
  assert.match(customers, /onEditOrder/);
  assert.match(customers, /مسدد بالكامل/);
  assert.match(customers, /مسدد جزئيًا/);
  assert.match(customers, /آجل غير مسدد/);
  assert.match(customers, /\/pos\?editOrderId=/);
  assert.match(customers, /\/customers\/\$\{encodeURIComponent\(customer\.id\)\}\/statement/);
  assert.match(customers, /useParams/);
  assert.match(customers, /عرض الفاتورة/);
  assert.match(customers, /تعديل الفاتورة/);
  assert.match(
    customers.match(/function CustomerStatementDrawer[\s\S]*?export default Customers;/)?.[0] || "",
    /m1-customers-page min-h-screen/
  );
});
