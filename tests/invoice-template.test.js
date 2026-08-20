import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  INVOICE_TEMPLATE_DEFAULTS,
  invoiceTemplateForOutput,
  mergeInvoiceTemplateConfig,
  normalizeInvoiceTemplateChannel,
  normalizeInvoiceTemplateConfig,
  resolveInvoiceTemplate,
  resolveInvoiceTemplateConfig,
} from "../shared/invoiceTemplate.js";

// The point of the defaults is that an un-configured tenant keeps the invoice it has
// today. These read the literals straight out of the renderer they were copied from, so
// the day someone edits one side the drift is a failing test rather than a silent
// difference on a customer's invoice.
const publicInvoiceSource = fs.readFileSync(new URL("../src/pages/PublicInvoice.jsx", import.meta.url), "utf8");

test("defaults still match the values hardcoded in PublicInvoice.jsx", () => {
  const defaults = INVOICE_TEMPLATE_DEFAULTS;
  assert.ok(publicInvoiceSource.includes(`M1_STORE_PHONE = "${defaults.identity.phone}"`));
  assert.ok(publicInvoiceSource.includes(`M1_STORE_WEBSITE_TEXT = "${defaults.identity.website_text}"`));
  assert.ok(publicInvoiceSource.includes(`M1_STORE_WEBSITE_HREF = "${defaults.identity.website_url}"`));
  assert.ok(publicInvoiceSource.includes(defaults.social.facebook_review_url));
  assert.ok(publicInvoiceSource.includes(defaults.social.instagram_url));
  for (const line of defaults.footer.return_policy_ar.split("\n")) {
    assert.ok(publicInvoiceSource.includes(line), `return policy line missing from source: ${line}`);
  }
});

test("defaults describe today's invoice, not a redesign of it", () => {
  const config = normalizeInvoiceTemplateConfig({});
  // Printed today by every renderer.
  assert.equal(config.fields.show_product_image, true);
  assert.equal(config.fields.show_product_variant, true);
  assert.equal(config.totals.show_subtotal, true);
  assert.equal(config.totals.show_shipping, true);
  // Not printed by any renderer today — these stay off until someone asks for them.
  assert.equal(config.fields.show_sku, false);
  assert.equal(config.totals.show_tax, false);
  assert.equal(config.footer.show_public_link_qr, false);
  // Empty means "keep the renderer's existing tenant-branding fallback".
  assert.equal(config.identity.store_name, "");
  assert.equal(config.identity.logo_url, "");
});

test("unknown keys are dropped rather than stored", () => {
  const config = normalizeInvoiceTemplateConfig({
    identity: { store_name: "Tiger Store", injected_script: "<script>" },
    fields: { show_sku: true, show_secret_margin: true },
    rogue_group: { anything: 1 },
  });
  assert.equal(config.identity.store_name, "Tiger Store");
  assert.equal(config.fields.show_sku, true);
  assert.equal("injected_script" in config.identity, false);
  assert.equal("show_secret_margin" in config.fields, false);
  assert.equal("rogue_group" in config, false);
});

test("a link the customer would click must be http(s) or it falls back", () => {
  const config = normalizeInvoiceTemplateConfig({
    identity: { website_url: "javascript:alert(1)" },
    social: { google_review_url: "not a url", instagram_url: "https://instagram.com/tiger" },
  });
  assert.equal(config.identity.website_url, INVOICE_TEMPLATE_DEFAULTS.identity.website_url);
  assert.equal(config.social.google_review_url, INVOICE_TEMPLATE_DEFAULTS.social.google_review_url);
  assert.equal(config.social.instagram_url, "https://instagram.com/tiger");
});

test("booleans survive the string and number forms a form control sends", () => {
  const config = normalizeInvoiceTemplateConfig({
    fields: { show_sku: "true", show_product_image: "false", show_unit_price: 0, show_line_total: 1 },
  });
  assert.equal(config.fields.show_sku, true);
  assert.equal(config.fields.show_product_image, false);
  assert.equal(config.fields.show_unit_price, false);
  assert.equal(config.fields.show_line_total, true);
});

test("a partial patch touches only the group it names", () => {
  const base = normalizeInvoiceTemplateConfig({
    identity: { store_name: "Tiger Store", address: "Damietta" },
    fields: { show_sku: true },
  });
  const merged = mergeInvoiceTemplateConfig(base, { identity: { address: "New Damietta" } });
  assert.equal(merged.identity.address, "New Damietta");
  assert.equal(merged.identity.store_name, "Tiger Store", "untouched field in the patched group survives");
  assert.equal(merged.fields.show_sku, true, "untouched group survives");
  assert.equal(merged.footer.return_policy_ar, INVOICE_TEMPLATE_DEFAULTS.footer.return_policy_ar);
});

test("thermal folds its own overrides over the shared fields", () => {
  const config = normalizeInvoiceTemplateConfig({
    fields: { show_product_image: true, show_unit_price: true },
  });
  const a4 = invoiceTemplateForOutput(config, "a4");
  const thermal = invoiceTemplateForOutput(config, "thermal");
  assert.equal(a4.fields.show_product_image, true);
  assert.equal(a4.fields.show_unit_price, true);
  // The 80mm roll has no room for either, and that is a property of the paper.
  assert.equal(thermal.fields.show_product_image, false);
  assert.equal(thermal.fields.show_unit_price, false);
});

test("channel names outside the vocabulary collapse to 'all'", () => {
  assert.equal(normalizeInvoiceTemplateChannel("pos"), "pos");
  assert.equal(normalizeInvoiceTemplateChannel("POS"), "pos");
  assert.equal(normalizeInvoiceTemplateChannel("tiktok"), "all");
  assert.equal(normalizeInvoiceTemplateChannel(undefined), "all");
});

const templates = [
  { id: 1, name: "Default", is_default: true, scope_channel: "all", scope_branch_id: null, config: {} },
  { id: 2, name: "POS", is_default: false, scope_channel: "pos", scope_branch_id: null, config: {} },
  { id: 3, name: "Branch 5 POS", is_default: false, scope_channel: "pos", scope_branch_id: 5, config: {} },
  { id: 4, name: "Branch 5", is_default: false, scope_channel: "all", scope_branch_id: 5, config: {} },
];

test("resolution runs most specific first", () => {
  assert.equal(resolveInvoiceTemplate(templates, { channel: "pos", branchId: 5 })?.id, 3);
  assert.equal(resolveInvoiceTemplate(templates, { channel: "website", branchId: 5 })?.id, 4);
  assert.equal(resolveInvoiceTemplate(templates, { channel: "pos", branchId: 9 })?.id, 2);
  assert.equal(resolveInvoiceTemplate(templates, { channel: "website", branchId: 9 })?.id, 1);
  assert.equal(resolveInvoiceTemplate(templates, {})?.id, 1);
});

test("a template pinned on the order outranks every scope rule", () => {
  // An invoice already sent to a customer keeps rendering with the template it was
  // issued under, even when a more specific one is added afterwards.
  assert.equal(resolveInvoiceTemplate(templates, { templateId: 1, channel: "pos", branchId: 5 })?.id, 1);
  // A pin pointing at a deleted template falls back instead of rendering nothing.
  assert.equal(resolveInvoiceTemplate(templates, { templateId: 999, channel: "pos", branchId: 5 })?.id, 3);
});

test("no templates configured still yields a full config", () => {
  assert.equal(resolveInvoiceTemplate([], { channel: "pos" }), null);
  const config = resolveInvoiceTemplateConfig([], { channel: "pos" });
  assert.equal(config.identity.phone, INVOICE_TEMPLATE_DEFAULTS.identity.phone);
  assert.equal(config.footer.return_policy_enabled, true);
});

test("thermal paper width is clamped to what a receipt printer can be", () => {
  assert.equal(normalizeInvoiceTemplateConfig({ outputs: { thermal: { paper_width_mm: 58 } } }).outputs.thermal.paper_width_mm, 58);
  assert.equal(normalizeInvoiceTemplateConfig({ outputs: { thermal: { paper_width_mm: 900 } } }).outputs.thermal.paper_width_mm, 112);
  assert.equal(normalizeInvoiceTemplateConfig({ outputs: { thermal: { paper_width_mm: "wide" } } }).outputs.thermal.paper_width_mm, 80);
});
