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
  // The header is the logo alone on the brand black (the logo carries the name and tagline).
  assert.match(rendered.html, /border-radius:42px/);
  assert.doesNotMatch(rendered.html, /EST\. 2021/);
  assert.doesNotMatch(rendered.html, /DAMIETTA/);
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

// ---- 2026-09-15: the order emails read the closing system, the transfer review and total - paid
import { buildOrderEmailPayment } from "../server/services/transactionalEmail/payment.js";

const restrictedPolicy = { mode: "restricted", governorates: ["damietta"] };
const cairoCod = { governorate: "القاهره", payment_method: "cod", status: "pending_confirmation", shipping_fee: 90, total_amount: 1840, paid_amount: 0, cod_amount: 1840, customer_phone: "01140950941" };

test("a cash-on-delivery order outside the COD list is asked for the shipping fee in the email", () => {
  const payment = buildOrderEmailPayment({ order: cairoCod, policy: restrictedPolicy, transfer: { vodafone: "01024960585" } });
  assert.equal(payment.kind, "advance_required");
  assert.equal(payment.advance, 90);
  assert.equal(payment.collect, 1750);
  const rendered = renderCustomerOrderConfirmation({ ...fixture, order: { ...fixture.order, ...cairoCod }, payment });
  assert.match(rendered.html, /مطلوب تحويل رسوم الشحن قبل الشحن/);
  assert.match(rendered.html, /90\.00 EGP/);
  assert.match(rendered.html, /1,750\.00 EGP/);
  assert.match(rendered.html, /01024960585/);
  assert.match(rendered.html, /على واتساب M1 Store/);
  assert.doesNotMatch(rendered.html, /ابعت صورة التحويل هنا/);
  assert.match(rendered.html, /رسالة على واتساب على رقم/);
  const admin = renderAdminOrderNotification({ ...fixture, order: { ...fixture.order, ...cairoCod }, payment });
  assert.match(admin.subject, /مستني دفع الشحن/);
});

test("the open system keeps plain cash on delivery with the amount owed", () => {
  const payment = buildOrderEmailPayment({ order: cairoCod, policy: { mode: "open" } });
  assert.deepEqual([payment.kind, payment.collect], ["cod", 1840]);
});

test("a shipping-fee transfer under review shows what was sent and what is left", () => {
  const order = { governorate: "Cairo", payment_method: "instapay", transfer_proof_status: "pending", shipping_fee: 90, total_amount: 1940, paid_amount: 0, cod_amount: 1850 };
  const payment = buildOrderEmailPayment({ order, policy: restrictedPolicy });
  assert.deepEqual([payment.kind, payment.transferred, payment.collect], ["transfer_review", 90, 1850]);
  const full = buildOrderEmailPayment({ order: { ...order, cod_amount: 0 }, policy: { mode: "open" } });
  assert.deepEqual([full.kind, full.transferred, full.collect], ["transfer_review", 1940, 0]);
});

test("a stale cod_amount never reaches the email (INV-1616)", () => {
  const payment = buildOrderEmailPayment({ order: { governorate: "دمياط", payment_method: "instapay", transfer_proof_status: "approved", total_amount: 1290, paid_amount: 90, cod_amount: 2400 }, policy: restrictedPolicy });
  assert.deepEqual([payment.kind, payment.collect], ["cod", 1200]);
});

test("a till-raised online order is labelled as one and the track link carries the phone", async () => {
  const admin = renderAdminOrderNotification({ ...fixture, order: { ...fixture.order, origin_surface: "pos" } });
  assert.match(admin.html, /أوردر أونلاين جديد من الكاشير/);
  const source = await readFile(new URL("../server/services/transactionalEmail/orderEmailService.js", import.meta.url), "utf8");
  assert.match(source, /buildOrderTrackingUrl\(number, order\.customer_phone, appUrl\)/);
});

test('the redesigned customer email carries the order tracker, product details and a WhatsApp help button', async () => {
  const { renderCustomerOrderEmailBody, stepIndexFor } = await import('../server/services/transactionalEmail/customerEmailDesign.js');
  assert.equal(stepIndexFor({ status: 'pending_confirmation' }), 0);
  assert.equal(stepIndexFor({ status: 'confirmed' }), 1);
  assert.equal(stepIndexFor({ status: 'confirmed', shipping_tracking_number: '1399658887' }), 2);
  assert.equal(stepIndexFor({ status: 'delivered' }), 3);
  const html = renderCustomerOrderEmailBody({
    order: { ...fixture.order, coupon_code: 'SAVE10' },
    items: [{ ...fixture.items[0], article_code: 'ART-9' }],
    links: fixture.links,
    brand: { whatsappUrl: 'https://wa.me/201024960585', phone: '01024960585' },
    nextStep: 'x',
  });
  for (const label of ['تم استلام الطلب', 'تأكيد الطلب', 'الشحن', 'التسليم']) assert.match(html, new RegExp(label));
  assert.ok(html.includes('أرتكل: <span dir="ltr">ART-9</span>'));
  assert.match(html, /SAVE10/);
  assert.match(html, /كلّمنا على واتساب/);
  assert.ok(html.includes("https://wa.me/201024960585"));
  assert.doesNotMatch(html, /Bag <b>unsafe/);
});
