import test from "node:test";
import assert from "node:assert/strict";

import { performSend } from "../server/services/whatsappQueue/worker.js";
import { resolveTemplateValues, WHATSAPP_TEMPLATE_DEFINITIONS } from "../server/services/whatsappTemplates.js";

/*
 * A stand-in for whatsappGatewayService. performSend already takes the gateway as an argument so
 * the queue can be exercised without a socket, and resolveWhatsappTransport is the one function
 * the Cloud fork consults — so the transport is chosen here rather than through an env var, and
 * these tests never touch process.env.
 */
const fakeGateway = (provider) => {
  const calls = [];
  const record = (name) => async (input) => {
    calls.push({ name, input });
    return { ok: true, name };
  };
  return {
    calls,
    resolveWhatsappTransport: () => ({ provider, phoneNumberId: provider === "cloud" ? "999" : "", instanceName: "" }),
    sendWhatsappTemplate: record("template"),
    sendTextMessage: record("text"),
    sendCtaUrlMessage: record("cta_url"),
    sendOrderConfirmationInteractiveMessage: record("buttons"),
    sendCartCarouselMessage: record("carousel"),
    sendImageMessage: record("image"),
  };
};

const receiptRow = (overrides = {}) => ({
  id: "1",
  automation_type: "invoice_receipt",
  recipient_phone: "201095339666",
  rendered_body: "شكراً لثقتك بينا",
  instance: "",
  order_id: 1090,
  payload: {
    send: { kind: "cta_url", title: "فاتورتك", url: "https://g.page/x", displayText: "قيّمنا" },
    values: { customer_name: "مي", order_number: "INV-1090", invoice_url: "https://m1store-egy.com/i/INV-1090" },
  },
  ...overrides,
});

const HOURS = 60 * 60 * 1000;

test("outside the window a Cloud send becomes the approved template", async () => {
  const gateway = fakeGateway("cloud");
  await performSend(receiptRow(), gateway, { lastInboundAt: new Date(Date.now() - 30 * HOURS) });
  assert.equal(gateway.calls.length, 1);
  assert.equal(gateway.calls[0].name, "template", "a message outside the window may only be a template");
  assert.equal(gateway.calls[0].input.automationType, "invoice_receipt");
  assert.equal(gateway.calls[0].input.values.order_number, "INV-1090");
});

test("a customer who never wrote to us is outside the window, not inside it", async () => {
  // The common case for every proactive automation, and the one a wrong default would break.
  const gateway = fakeGateway("cloud");
  await performSend(receiptRow(), gateway, { lastInboundAt: null });
  assert.equal(gateway.calls[0].name, "template");
});

test("inside the window the richer free-form message is still used", async () => {
  const gateway = fakeGateway("cloud");
  await performSend(receiptRow(), gateway, { lastInboundAt: new Date(Date.now() - 1 * HOURS) });
  assert.equal(gateway.calls[0].name, "cta_url", "inside the window a CTA beats a flat template");
});

test("Evolution never takes the template path, whatever the window says", async () => {
  const gateway = fakeGateway("evolution");
  await performSend(receiptRow(), gateway, { lastInboundAt: new Date(Date.now() - 30 * HOURS) });
  assert.equal(gateway.calls[0].name, "cta_url");
  assert.ok(!gateway.calls.some((call) => call.name === "template"), "templates do not exist on Evolution");
});

test("an automation with no approved template fails loudly instead of being rejected per customer", async () => {
  const gateway = fakeGateway("cloud");
  const row = receiptRow({ automation_type: "something_new", payload: { send: { kind: "text" }, values: {} } });
  await assert.rejects(
    () => performSend(row, gateway, { lastInboundAt: null }),
    (error) => error.code === "WHATSAPP_TEMPLATE_MISSING"
  );
  assert.equal(gateway.calls.length, 0, "nothing may be sent when there is no template to send");
});

test("the order confirmation's own values beat the queue's generic bag", async () => {
  const gateway = fakeGateway("cloud");
  const row = receiptRow({
    automation_type: "order_confirmation",
    payload: {
      send: {
        kind: "order_confirmation_buttons",
        templateValues: {
          customer_name: "مي",
          order_number: "INV-1084",
          cod_amount: "990",
          items_summary: "حذاء رياضي — أسود · 42",
          address: "قنا - فرشوط",
          invoice_url: "https://m1store-egy.com/i/INV-1084",
        },
      },
      values: { customer_name: "شخص تاني", order_number: "INV-0000" },
    },
  });
  await performSend(row, gateway, { lastInboundAt: null });
  assert.equal(gateway.calls[0].name, "template");
  // Only the order knows how to summarise its products and assemble its address, so its explicit
  // values must win over the placeholder bag the queue happens to carry.
  assert.equal(gateway.calls[0].input.values.order_number, "INV-1084");
  assert.equal(gateway.calls[0].input.values.items_summary, "حذاء رياضي — أسود · 42");
});

test("the shipment vocabulary already matches, so nothing is left as a dash", () => {
  // shipmentTemplateValues emits exactly these names; if the registry drifted from them every
  // shipping notification would go out with dashes where the courier and tracking belong.
  const values = {
    order_number: "INV-1084",
    customer_name: "مي",
    provider: "بوسطة",
    tracking_number: "3216549870",
    tracking_url: "https://bosta.co/t/3216549870",
    cod_amount: "990 ج.م",
  };
  for (const type of ["shipment_created", "shipped", "out_for_delivery", "delivered"]) {
    const resolved = resolveTemplateValues(type, { values });
    for (const [name, value] of Object.entries(resolved)) {
      assert.notEqual(value, "—", `${type}.${name} fell back to a dash though the value exists`);
    }
  }
});

test("a prepaid parcel reads correctly instead of showing a dash where a sum belongs", () => {
  // cod_amount is empty on purpose for a prepaid order; our own renderer drops the line and a
  // template cannot, so the fallback has to be a sentence rather than a placeholder.
  const resolved = resolveTemplateValues("out_for_delivery", { values: { order_number: "INV-1", cod_amount: "" } });
  assert.equal(resolved.cod_amount, "لا يوجد مبلغ للتحصيل");
  // And the body must not append its own currency word, since the value carries the shop's symbol.
  assert.ok(
    !/\{\{2\}\}\s*جنيه/.test(WHATSAPP_TEMPLATE_DEFINITIONS.out_for_delivery.body),
    "the template would print the currency twice"
  );
});

test("the review ask finds its link under the name the receipt already uses", () => {
  const resolved = resolveTemplateValues("google_review_request", {
    values: { customer_name: "مي", google_review_url: "https://g.page/r/x" },
  });
  assert.equal(resolved.review_url, "https://g.page/r/x");
});
