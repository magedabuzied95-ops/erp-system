import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  WHATSAPP_TEMPLATE_DEFINITIONS,
  buildTemplateComponents,
  buildTemplateMessage,
  summariseItems,
  templateSubmissionPayload,
  templateButtonAction,
  validateTemplateBody,
  validateTemplateValue,
} from "../server/services/whatsappTemplates.js";
import { isWithinServiceWindow, toGraphRecipient, cloudErrorMeaning } from "../server/services/whatsappCloudProvider.js";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const gatewaySource = read("../server/services/whatsappGatewayService.js");
const confirmationSource = read("../server/services/whatsappOrderConfirmationService.js");
const workerSource = read("../server/services/whatsappQueue/worker.js");
const gitignore = read("../.gitignore");

test("every template body obeys the rules Meta enforces at submission", () => {
  for (const [automationType, definition] of Object.entries(WHATSAPP_TEMPLATE_DEFINITIONS)) {
    const problems = validateTemplateBody(definition.body);
    assert.deepEqual(problems, [], `${automationType}: ${problems.join(", ")}`);
    const used = new Set([...definition.body.matchAll(/\{\{(\d+)\}\}/g)].map((match) => match[1]));
    assert.equal(
      used.size,
      definition.variables.length,
      `${automationType} declares ${definition.variables.length} variables but its body uses ${used.size}`
    );
    // Meta will not review a template whose example does not fill every variable.
    assert.equal(
      definition.samples.length,
      definition.variables.length,
      `${automationType} must ship one sample per variable`
    );
  }
});

test("a variable can never carry a line break, however the value was built", () => {
  // This is the rule that would break a real send rather than a submission: the address is
  // assembled from free-text fields, and one of them holding a newline used to be harmless.
  const components = buildTemplateComponents("order_confirmation", {
    customer_name: "مي",
    order_number: "INV-1084",
    cod_amount: "990",
    items_summary: "حذاء",
    address: "قنا\nفرشوط\nبجوار المعهد",
    invoice_url: "https://m1store-egy.com/i/INV-1084",
  });
  const address = components[0].parameters[4].text;
  assert.ok(!/[\r\n]/.test(address), "the newlines must be collapsed, not passed to Graph");
  assert.match(address, /قنا/);
  assert.match(address, /فرشوط/);
});

test("an empty value becomes a dash instead of being rejected on every send", () => {
  const components = buildTemplateComponents("shipment_created", {
    order_number: "INV-1084",
    provider: "بوسطة",
    tracking_number: "",
  });
  assert.equal(components[0].parameters[2].text, "—");
  assert.deepEqual(validateTemplateValue("—"), []);
  assert.deepEqual(validateTemplateValue(""), ["a template variable may not be empty"]);
  assert.deepEqual(validateTemplateValue("a\nb"), ["a template variable may not contain a line break or tab"]);
});

test("a multi-product order is summarised onto one line", () => {
  const many = summariseItems([
    { product_name: "حذاء", quantity: 2 },
    { product_name: "شنطة", quantity: 1 },
  ]);
  assert.ok(!/[\r\n]/.test(many));
  assert.match(many, /2 منتجات/);
  assert.match(many, /3 قطعة/);
  // A single item keeps its detail, since it still fits on one line.
  assert.equal(summariseItems([{ product_name: "حذاء", color: "أسود", size: "42", quantity: 1 }]), "حذاء — أسود · 42");
  assert.equal(summariseItems([]), "—");
});

test("the order confirmation keeps its three actions as real quick replies", () => {
  const definition = WHATSAPP_TEMPLATE_DEFINITIONS.order_confirmation;
  assert.equal(definition.buttons.length, 3);
  assert.deepEqual(definition.buttons.map((button) => button.payload), ["order_confirm", "order_edit", "order_cancel"]);
  // The payloads must land on the actions applyConfirmationAction already understands, or a tap
  // does nothing at all.
  assert.equal(templateButtonAction("order_confirm"), "confirm");
  assert.equal(templateButtonAction("order_edit"), "edit");
  assert.equal(templateButtonAction("order_cancel"), "cancel");
  assert.equal(templateButtonAction("anything_else"), "");
});

test("the submission payload carries the body, the samples and the buttons", () => {
  const payload = templateSubmissionPayload("order_confirmation");
  assert.equal(payload.name, "order_confirmation_cod");
  assert.equal(payload.category, "UTILITY");
  assert.equal(payload.language, "ar");
  const body = payload.components.find((component) => component.type === "BODY");
  assert.ok(body.example.body_text[0].length === 6, "Meta needs one example per variable");
  const buttons = payload.components.find((component) => component.type === "BUTTONS");
  assert.equal(buttons.buttons.length, 3);
  // Anything promotional must not be filed as UTILITY: Meta re-categorises it and the price and
  // opt-out rules change underneath us.
  assert.equal(templateSubmissionPayload("abandoned_cart").category, "MARKETING");
  assert.equal(templateSubmissionPayload("google_review_request").category, "MARKETING");
  assert.equal(templateSubmissionPayload("invoice_receipt").category, "UTILITY");
});

test("the service window is measured, not assumed", () => {
  assert.equal(isWithinServiceWindow(new Date()), true);
  assert.equal(isWithinServiceWindow(new Date(Date.now() - 25 * 60 * 60 * 1000)), false);
  // No inbound at all is the common case for a proactive automation, and it is NOT in the window.
  assert.equal(isWithinServiceWindow(null), false);
  assert.equal(isWithinServiceWindow("not a date"), false);
});

test("Graph gets a bare E.164 recipient", () => {
  assert.equal(toGraphRecipient("+20 109 533 9666"), "201095339666");
  assert.equal(toGraphRecipient("201095339666"), "201095339666");
});

test("the errors an operator must act on are named, not left as HTTP 400", () => {
  assert.equal(cloudErrorMeaning(131047), "outside_service_window_use_template");
  assert.equal(cloudErrorMeaning(132001), "template_not_found_or_not_approved");
  assert.equal(cloudErrorMeaning(190), "access_token_expired_or_invalid");
});

test("Evolution stays the default and a named instance still routes to it", async () => {
  // The whole point of the transport resolver is that nothing moves until an env var says so.
  const previous = process.env.WHATSAPP_GATEWAY_PROVIDER;
  delete process.env.WHATSAPP_GATEWAY_PROVIDER;
  const { resolveWhatsappTransport } = await import("../server/services/whatsappGatewayService.js");
  assert.equal(resolveWhatsappTransport("").provider, "evolution");
  assert.equal(resolveWhatsappTransport("m1_business_v237").provider, "evolution");
  // One number on each transport is the plan, so the cloud one is addressed by prefix.
  assert.equal(resolveWhatsappTransport("cloud:123456789").provider, "cloud");
  assert.equal(resolveWhatsappTransport("cloud:123456789").phoneNumberId, "123456789");
  if (previous === undefined) delete process.env.WHATSAPP_GATEWAY_PROVIDER;
  else process.env.WHATSAPP_GATEWAY_PROVIDER = previous;
});

test("the send paths delegate instead of refusing the cloud transport", () => {
  for (const marker of [
    "whatsappCloud.sendText(",
    "whatsappCloud.sendImage(",
    "whatsappCloud.sendReaction(",
    "whatsappCloud.sendCtaUrl(",
    "whatsappCloud.sendTemplate(",
    "whatsappCloud.getStatus(",
  ]) {
    assert.ok(gatewaySource.includes(marker), `the gateway never calls ${marker}`);
  }
  // A LID exists only inside a Baileys session, so it must be refused rather than turned into
  // digits and posted to Graph as if it were a phone number.
  assert.match(gatewaySource, /refuseCloudLid/);
  assert.match(gatewaySource, /WHATSAPP_CLOUD_LID_UNSUPPORTED/);
});

test("a cloud order confirmation cannot go out with empty variables", () => {
  // The template needs the order's fields, not the rendered Evolution body. Refusing loudly beats
  // sending a customer a template with a dash in every slot.
  assert.match(gatewaySource, /WHATSAPP_TEMPLATE_VALUES_REQUIRED/);
  assert.match(confirmationSource, /export const orderConfirmationTemplateValues/);
  // Both the direct send and the queued one must carry them, or the template a customer gets
  // depends on which path happened to run.
  assert.match(confirmationSource, /templateValues: orderConfirmationTemplateValues\(current\)/g);
  assert.equal(
    confirmationSource.split("orderConfirmationTemplateValues(current)").length - 1,
    2,
    "both the queued payload and the direct send must pass the template values"
  );
  assert.match(workerSource, /templateValues: send\.templateValues \|\| null/);
});

test("the new services are allowlisted past the gitignore rule that hides them", () => {
  // server/services/* is ignored twice; an entry in the FIRST block is re-ignored by the second,
  // and the deploy then ships a gateway importing a file that does not exist.
  for (const file of ["whatsappTemplates.js", "whatsappCloudProvider.js"]) {
    const allow = gitignore.lastIndexOf(`!server/services/${file}`);
    const lastCatchAll = gitignore.lastIndexOf("server/services/*\n") >= 0
      ? gitignore.lastIndexOf("server/services/*\n")
      : gitignore.lastIndexOf("server/services/*\r\n");
    assert.ok(allow > -1, `${file} is not allowlisted at all`);
    assert.ok(allow > lastCatchAll, `${file} is allowlisted before the last server/services/* rule, so git still ignores it`);
  }
});

test("what the platform cannot do is refused with the reason", () => {
  // A carousel is not a session message on Cloud API. Saying so beats letting the next reader
  // hunt for a Graph endpoint that does not exist.
  assert.match(gatewaySource, /A carousel can only be sent from the Evolution number/);
  const templateMessage = buildTemplateMessage({
    automationType: "invoice_receipt",
    phone: "201095339666",
    values: { customer_name: "مي", order_number: "INV-1090", invoice_url: "https://m1store-egy.com/i/INV-1090" },
  });
  assert.equal(templateMessage.type, "template");
  assert.equal(templateMessage.template.name, "invoice_receipt");
  assert.equal(templateMessage.template.components[0].parameters.length, 3);
});
