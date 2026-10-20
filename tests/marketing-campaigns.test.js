import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  buildCampaignTemplatePayload,
  fillTemplateBody,
  isCampaignDue,
  normalizeTemplateVariables,
  phoneDedupeKey,
  resolveTemplateVariableValues,
  templateBlockReason,
  templateVariableCount,
} from "../server/services/marketingCampaignTemplateService.js";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const template = {
  name: "spring_offer",
  language: "ar",
  status: "APPROVED",
  header_format: "NONE",
  body_text: "Hi {{1}}, your code is {{2}}. Call {{3}}",
  body_examples: ["Sara", "SPRING10", "0100"],
  buttons: [],
};

test("variable count is the highest {{n}}", () => {
  assert.equal(templateVariableCount(template.body_text), 3);
  assert.equal(templateVariableCount("no variables"), 0);
  assert.equal(templateVariableCount("{{ 2 }} and {{1}} and {{2}}"), 2);
});

test("variable mapping: name, phone, static, with fallbacks — never blank", () => {
  const mapping = normalizeTemplateVariables([
    { source: "customer_name", value: "Friend" },
    { source: "static", value: "SPRING10" },
    { source: "customer_phone" },
    { source: "bogus", value: "x" },
  ]);
  assert.equal(mapping[3].source, "static");
  const values = resolveTemplateVariableValues({ count: 3, mapping, customer: { name: "Mona", phone: "+201001234567" }, examples: template.body_examples });
  assert.deepEqual(values, ["Mona", "SPRING10", "+201001234567"]);
  // A customer with no name gets the mapping's fallback, then the approved example.
  const noName = resolveTemplateVariableValues({ count: 3, mapping, customer: { name: "", phone: "" }, examples: template.body_examples });
  assert.deepEqual(noName, ["Friend", "SPRING10", "0100"]);
  const nothing = resolveTemplateVariableValues({ count: 2, mapping: [], customer: {}, examples: [] });
  assert.deepEqual(nothing, ["-", "-"]);
  assert.equal(fillTemplateBody(template.body_text, values), "Hi Mona, your code is SPRING10. Call +201001234567");
});

test("payload: body parameters in order, recipient normalised", () => {
  const payload = buildCampaignTemplatePayload({ template, to: "+20 100 123 4567", bodyValues: ["Mona", "SPRING10", "0100"] });
  assert.equal(payload.messaging_product, "whatsapp");
  assert.equal(payload.type, "template");
  assert.equal(payload.to, "201001234567");
  // Customers are stored as local numbers; the Cloud API needs the country code.
  assert.equal(buildCampaignTemplatePayload({ template, to: "01001234567", bodyValues: ["a", "b", "c"] }).to, "201001234567");
  assert.equal(payload.template.name, "spring_offer");
  assert.deepEqual(payload.template.language, { code: "ar" });
  assert.deepEqual(payload.template.components, [
    { type: "body", parameters: [{ type: "text", text: "Mona" }, { type: "text", text: "SPRING10" }, { type: "text", text: "0100" }] },
  ]);
});

test("payload: media header, text-header variable and dynamic buttons", () => {
  const image = buildCampaignTemplatePayload({
    template: {
      ...template,
      body_text: "Hello",
      header_format: "IMAGE",
      header_media_url: "https://cdn.example.com/a.jpg",
      buttons: [
        { type: "QUICK_REPLY", text: "Stop" },
        { type: "URL", text: "Shop", url: "https://shop.example.com/{{1}}", example: "spring" },
        { type: "COPY_CODE", example: "SPRING10" },
      ],
    },
    to: "201001234567",
    bodyValues: [],
  });
  assert.deepEqual(image.template.components, [
    { type: "header", parameters: [{ type: "image", image: { link: "https://cdn.example.com/a.jpg" } }] },
    { type: "button", sub_type: "url", index: "1", parameters: [{ type: "text", text: "spring" }] },
    { type: "button", sub_type: "copy_code", index: "2", parameters: [{ type: "coupon_code", coupon_code: "SPRING10" }] },
  ]);
  const textHeader = buildCampaignTemplatePayload({
    template: { ...template, body_text: "Hello", header_format: "TEXT", header_text: "Hi {{1}}", header_example: "there" },
    to: "201001234567",
    bodyValues: [],
  });
  assert.deepEqual(textHeader.template.components, [{ type: "header", parameters: [{ type: "text", text: "there" }] }]);
  const plain = buildCampaignTemplatePayload({ template: { ...template, body_text: "Hello" }, to: "201001234567", bodyValues: [] });
  assert.equal(plain.template.components, undefined);
});

test("only an APPROVED template may be used", () => {
  assert.equal(templateBlockReason(template), "");
  assert.equal(templateBlockReason({ ...template, status: "PENDING" }), "template_not_approved");
  assert.equal(templateBlockReason({ ...template, status: "PAUSED" }), "template_not_approved");
  assert.equal(templateBlockReason(null), "template_not_found");
  assert.equal(templateBlockReason({ ...template, header_format: "VIDEO", header_media_url: "" }), "template_header_media_missing");
});

test("a scheduled campaign is due once its time has come, and only when scheduled", () => {
  const now = new Date("2026-10-20T10:00:00Z");
  assert.equal(isCampaignDue({ status: "scheduled", scheduled_at: "2026-10-20T09:59:00Z" }, now), true);
  assert.equal(isCampaignDue({ status: "scheduled", scheduled_at: "2026-10-20T10:00:00Z" }, now), true);
  assert.equal(isCampaignDue({ status: "scheduled", scheduled_at: "2026-10-20T10:01:00Z" }, now), false);
  assert.equal(isCampaignDue({ status: "draft", scheduled_at: "2026-10-20T09:00:00Z" }, now), false);
  assert.equal(isCampaignDue({ status: "sending", scheduled_at: "2026-10-20T09:00:00Z" }, now), false);
  assert.equal(isCampaignDue({ status: "scheduled", scheduled_at: null }, now), false);
});

test("phones dedupe on their last ten digits", () => {
  assert.equal(phoneDedupeKey("+20 100 123 4567"), phoneDedupeKey("01001234567"));
  assert.equal(phoneDedupeKey(""), "");
});

test("the scheduler claims atomically and the start refuses unapproved templates", () => {
  const service = read("server/services/marketingBroadcastService.js");
  const scheduler = service.slice(service.indexOf("export const runDueCampaigns"));
  assert.match(scheduler, /UPDATE marketing_broadcasts\s+SET status = 'sending'[\s\S]*WHERE status = 'scheduled' AND scheduled_at <= NOW\(\)[\s\S]*RETURNING \*/);
  assert.match(scheduler, /if \(!broadcastsEnabled\(\)\) return/);
  const send = service.slice(service.indexOf("export const sendBroadcast"), service.indexOf("const runClaimedBroadcast"));
  assert.ok(send.indexOf("assertCampaignTemplateUsable") < send.indexOf("SET status = 'sending'"), "template approval is checked before the claim");
  const delivery = read("server/services/marketingCampaignTemplateService.js");
  // Per-recipient claim re-checks the opt-out at send time.
  assert.match(delivery, /WHERE r\.id = \$1 AND r\.status = 'pending'[\s\S]*c\.marketing_opt_out_at IS NULL/);
});
