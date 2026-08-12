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
  assert.match(controller, /initial_paid_amount/);
  assert.match(controller, /jsonb_array_elements\(COALESCE\(payment_breakdown/);
  assert.match(controller, /allocation\.initial_paid_amount \+ allocation\.paid_amount/);
});

test("customer statement has a professional payment workflow", () => {
  const customers = source("src/modules/sales/pages/Customers.jsx");
  assert.match(customers, /payment_method/);
  assert.match(customers, /payment_date/);
  assert.match(customers, /onViewOrder/);
  assert.match(customers, /onEditOrder/);
  assert.match(customers, /\/pos\?editOrderId=/);
  assert.match(customers, /\/customers\/\$\{encodeURIComponent\(customer\.id\)\}\/statement/);
  assert.match(customers, /useParams/);

  // The copy is localized now: the page references keys and the Arabic wording
  // lives in the dictionary. Both halves are asserted so neither can drift.
  const ar = JSON.parse(source("src/locales/ar/customers.json"));
  for (const [key, arabic] of [
    ["customers.payment.title", "تسجيل دفعة من العميل"],
    ["customers.statement.outstanding", "المتبقي على العميل"],
    ["customers.filters.customerPayments", "دفعات العملاء"],
    ["customers.statement.backToCustomers", "العودة للعملاء"],
    ["customers.paymentState.fullyPaid", "مسدد بالكامل"],
    ["customers.paymentState.partiallyPaid", "مسدد جزئيًا"],
    ["customers.paymentState.unpaidCredit", "آجل غير مسدد"],
    ["customers.statement.viewInvoice", "عرض الفاتورة"],
    ["customers.statement.editInvoice", "تعديل الفاتورة"],
  ]) {
    // Referenced either directly as tt("key") or as a labelKey in an options array.
    assert.match(customers, new RegExp(`"${key.replace(/\./g, "\\.")}"`), `${key} is not used by the page`);
    const value = key.split(".").slice(1).reduce((node, part) => node?.[part], ar);
    assert.equal(value, arabic, `${key} lost its Arabic wording`);
  }
  assert.match(
    customers.match(/function CustomerStatementDrawer[\s\S]*?export default Customers;/)?.[0] || "",
    /m1-customers-page min-h-screen/
  );
});
