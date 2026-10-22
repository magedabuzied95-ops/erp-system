// The owner's rewrites of the automation templates: only the wording moves. The variables the
// send fills by position, the button types and the name Meta knows the template by stay the code's.
import test from "node:test";
import assert from "node:assert/strict";

import {
  baseTemplateDefinition,
  buildTemplateMessage,
  setTemplateOverrides,
  templateDefinition,
  templateSubmissionPayload,
  validateTemplateEdit,
} from "../server/services/whatsappTemplates.js";

const DELIVERED_EDIT = { body: "تم توصيل الأوردر {{1}} يا {{2}} شكراً ليك", footer: "", button_texts: ["قيّمنا ⭐"] };

test.afterEach(() => setTemplateOverrides([]));

test("a rewrite that keeps every variable is accepted", () => {
  const { problems, edit } = validateTemplateEdit("delivered", DELIVERED_EDIT);
  assert.deepEqual(problems, []);
  assert.equal(edit.body, DELIVERED_EDIT.body);
});

test("a rewrite that drops or adds a variable is refused", () => {
  assert.ok(validateTemplateEdit("delivered", { body: "تم توصيل الأوردر {{1}} شكراً" }).problems.some((p) => p.code === "variables"));
  assert.ok(validateTemplateEdit("delivered", { body: "أهلا {{1}} و {{2}} و {{3}} تمام" }).problems.some((p) => p.code === "variables"));
});

test("Meta's placement rules are checked before submission", () => {
  assert.ok(validateTemplateEdit("delivered", { body: "يا {{2}} طلبك {{1}}" }).problems.some((p) => p.code === "variable_position"));
  assert.ok(validateTemplateEdit("delivered", { button_texts: ["x".repeat(26)] }).problems.some((p) => p.code === "too_long"));
  assert.ok(validateTemplateEdit("product_review_request", { header_text: "رأيك {{1}}" }).problems.some((p) => p.field === "header_text"));
  assert.ok(validateTemplateEdit("product_carousel_3", { card_body: "{{1}} بسعر {{2}} جنيه" }).problems.some((p) => p.field === "card_body"));
});

test("the copy-code label is Meta's and cannot be rewritten", () => {
  const { problems, edit } = validateTemplateEdit("shipping_fee_payment_card", { button_texts: ["غيرته", "ارفع الصورة"] });
  assert.deepEqual(problems, []);
  assert.equal(edit.button_texts[0], baseTemplateDefinition("shipping_fee_payment_card").buttons[0].text);
  assert.equal(edit.button_texts[1], "ارفع الصورة");
});

test("a saved rewrite is what the submission carries and the send still fills the same variables", () => {
  setTemplateOverrides([{ automation_type: "delivered", edit: validateTemplateEdit("delivered", DELIVERED_EDIT).edit }]);
  const definition = templateDefinition("delivered");
  assert.equal(definition.name, "order_delivered");
  assert.equal(definition.footer, undefined);
  assert.equal(definition.buttons[0].text, "قيّمنا ⭐");
  assert.equal(definition.buttons[0].type, "URL");

  const payload = templateSubmissionPayload("delivered");
  assert.equal(payload.components.find((component) => component.type === "BODY").text, DELIVERED_EDIT.body);
  assert.ok(!payload.components.some((component) => component.type === "FOOTER"));

  const message = buildTemplateMessage({ automationType: "delivered", phone: "201000000000", values: { order_number: "INV-1", customer_name: "مي" } });
  assert.deepEqual(message.template.components[0].parameters.map((parameter) => parameter.text), ["INV-1", "مي"]);
  assert.ok(baseTemplateDefinition("delivered").body.startsWith("✅"));
});

test("restoring the original drops the rewrite everywhere", () => {
  setTemplateOverrides([{ automation_type: "delivered", edit: validateTemplateEdit("delivered", DELIVERED_EDIT).edit }]);
  setTemplateOverrides([{ automation_type: "delivered", edit: null }]);
  assert.equal(templateDefinition("delivered"), baseTemplateDefinition("delivered"));
});
