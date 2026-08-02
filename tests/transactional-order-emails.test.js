import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { escapeHtml, formatCurrency } from "../server/services/transactionalEmail/helpers.js";
import { renderAdminOrderNotification, renderCustomerOrderConfirmation } from "../server/services/transactionalEmail/templates.js";

const fixture = {
  order: {
    id: 701,
    public_order_number: "WEB-701",
    public_token: "safe-token",
    customer_name: "Maged <script>alert(1)</script>",
    customer_phone: "201000000000",
    customer_email: "customer@example.com",
    customer_address: "Street & building",
    governorate: "Cairo",
    city_area: "Nasr City",
    status: "pending_confirmation",
    payment_method: "cod",
    shipping_method: "in_store_delivery",
    subtotal: 1350,
    delivery_fee: 50,
    discount_amount: 100,
    total_amount: 1300,
    created_at: "2026-08-02T12:00:00.000Z",
  },
  items: [{
    product_name: "Bag <b>unsafe</b>",
    color: "Mint",
    size: "16 inch",
    quantity: 2,
    sale_price: 625,
    image_url: "https://api.m1store-egy.com/uploads/products/bag.jpg",
  }],
  previousOrdersCount: 3,
  links: {
    invoice: "https://m1store-egy.com/invoice/safe-token",
    track: "https://m1store-egy.com/track?order_number=WEB-701",
    erpOrder: "https://erp.m1store-egy.com/orders/701",
  },
  brand: {
    logoUrl: "https://m1store-egy.com/branding/m-one-logo-white-fixed.png",
    supportEmail: "support@m1store-egy.com",
  },
};

test("transactional email helpers escape untrusted values and format EGP", () => {
  assert.equal(escapeHtml(`<script a="1">'&`), "&lt;script a=&quot;1&quot;&gt;&#39;&amp;");
  assert.equal(formatCurrency(1300), "1,300.00 EGP");
});

test("customer confirmation is responsive, branded and contains no raw unsafe HTML", () => {
  const rendered = renderCustomerOrderConfirmation(fixture);
  assert.match(rendered.subject, /WEB-701/);
  assert.match(rendered.html, /viewport/);
  assert.match(rendered.html, /M1 Store/);
  assert.match(rendered.html, /CHANGE YOUR LIFE/);
  assert.match(rendered.html, /linear-gradient\(#101010,#101010\)/);
  assert.match(rendered.html, /-webkit-text-fill-color:#f0c94f/);
  assert.match(rendered.html, /عرض الفاتورة/);
  assert.match(rendered.html, /تتبع الطلب/);
  assert.match(rendered.html, /1,300\.00 EGP/);
  assert.doesNotMatch(rendered.html, /<script>alert/);
  assert.doesNotMatch(rendered.html, /Bag <b>unsafe/);
});

test("admin notification contains operational order data and previous-order count", () => {
  const rendered = renderAdminOrderNotification(fixture);
  assert.match(rendered.subject, /WEB-701/);
  assert.match(rendered.html, /فتح الطلب في ERP/);
  assert.match(rendered.html, /فتح الفاتورة/);
  assert.match(rendered.html, />3</);
  assert.match(rendered.html, /201000000000/);
});

test("storefront checkout queues email through a savepoint before commit", async () => {
  const source = await readFile(new URL("../server/controllers/storefrontController.js", import.meta.url), "utf8");
  const savepoint = source.indexOf("SAVEPOINT storefront_order_email_outbox");
  const enqueue = source.indexOf("enqueueOrderCreatedEmails", savepoint);
  const commit = source.indexOf('client.query("COMMIT")', enqueue);
  assert.ok(savepoint > 0);
  assert.ok(enqueue > savepoint);
  assert.ok(commit > enqueue);
  assert.match(source.slice(savepoint, commit), /ROLLBACK TO SAVEPOINT storefront_order_email_outbox/);
});

test("outbox schema enforces idempotency and persistent retry state", async () => {
  const migration = await readFile(new URL("../server/database/migrations/2026-08-02-add-transactional-email-outbox.sql", import.meta.url), "utf8");
  assert.match(migration, /UNIQUE \(dedupe_key\)/i);
  assert.match(migration, /next_attempt_at/i);
  assert.match(migration, /attempts INTEGER/i);
  assert.match(migration, /status IN \('pending','processing','retry','sent','failed'\)/i);
});

test("customer delivery resolves email from the linked customer and retry SQL casts attempts", async () => {
  const source = await readFile(new URL("../server/services/transactionalEmail/orderEmailService.js", import.meta.url), "utf8");
  assert.match(source, /LEFT JOIN customers c ON c\.id = o\.customer_id AND c\.tenant_id = o\.tenant_id/);
  assert.match(source, /c\.email AS customer_email/);
  assert.match(source, /attempts=\$3::integer/);
  assert.match(source, /POWER\(2, \$3::integer\)/);
});
