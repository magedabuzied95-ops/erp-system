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

const publicInvoiceSource = fs.readFileSync(new URL("../src/pages/PublicInvoice.jsx", import.meta.url), "utf8");

// These values used to be constants inside PublicInvoice.jsx. They moved here so the
// store can edit them without a deploy, and the page must not grow a second copy: a
// constant reintroduced there would silently win over whatever the operator typed.
test("the store's own details live in the template, not in the page", () => {
  assert.doesNotMatch(publicInvoiceSource, /const M1_STORE_(PHONE|WEBSITE_TEXT|WEBSITE_HREF)\s*=/);
  assert.doesNotMatch(publicInvoiceSource, /const PUBLIC_RETURN_POLICY_LINES\s*=/);
  assert.doesNotMatch(publicInvoiceSource, /const DEFAULT_SOCIAL_LINKS\s*=/);
  assert.doesNotMatch(publicInvoiceSource, /01000659301/);
  // The page resolves the template and hands it to the card, which now draws the
  // policy, the review buttons and the store footer as blocks.
  assert.match(publicInvoiceSource, /const tpl = useInvoiceTemplate\(\)/);
  assert.match(publicInvoiceSource, /output="public"/);
  const blockView = fs.readFileSync(new URL("../src/shared/components/invoices/InvoiceBlockView.jsx", import.meta.url), "utf8");
  assert.match(blockView, /template\?\.identity\?\.phone/);
  assert.match(blockView, /template\.footer\.return_policy_(ar|en)/);
  assert.match(blockView, /template\.social\.(google|facebook|instagram)/);
});

test("the defaults are the values the page used to hardcode", () => {
  const defaults = INVOICE_TEMPLATE_DEFAULTS;
  assert.equal(defaults.identity.phone, "01000659301");
  assert.equal(defaults.identity.website_text, "Www.m1store-egy.com");
  assert.equal(defaults.identity.website_url, "https://www.m1store-egy.com");
  assert.equal(defaults.social.facebook_review_url, "https://www.facebook.com/share/1DmN6zj29g/?mibextid=wwXIfr");
  assert.match(defaults.social.instagram_url, /^https:\/\/www\.instagram\.com\/m1store_egy/);
  const policy = defaults.footer.return_policy_ar.split("\n");
  assert.equal(policy.length, 6);
  assert.match(policy[0], /14 يومًا/);
});

// An operator link must never be shadowed by one the invoice payload defaulted in.
test("the page no longer defaults the review links onto the invoice payload", () => {
  assert.match(publicInvoiceSource, /google_review_url: normalizePublicUrl\(payload\?\.google_review_url \|\| ""\)/);
  assert.match(publicInvoiceSource, /facebook_review_url: normalizePublicUrl\(payload\?\.facebook_review_url \|\| ""\)/);
  assert.match(publicInvoiceSource, /instagram_url: normalizePublicUrl\(payload\?\.instagram_url \|\| ""\)/);
});

test("defaults describe today's invoice, not a redesign of it", () => {
  const config = normalizeInvoiceTemplateConfig({});
  // Printed today by every renderer.
  assert.equal(config.fields.show_product_image, true);
  assert.equal(config.fields.show_product_variant, true);
  assert.equal(config.totals.show_subtotal, true);
  assert.equal(config.totals.show_shipping, true);
  // The card prints the SKU when the line carries one; the PDF never has.
  assert.equal(config.fields.show_sku, true);
  assert.equal(config.outputs.print.show_sku, false);
  // Not printed by any renderer today — these stay off until someone asks for them.
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

test("each output folds its own overrides over the shared fields", () => {
  const config = normalizeInvoiceTemplateConfig({
    fields: { show_product_image: true, show_unit_price: true, show_sku: true },
  });
  const card = invoiceTemplateForOutput(config, "card");
  const print = invoiceTemplateForOutput(config, "print");
  const thermal = invoiceTemplateForOutput(config, "thermal");

  // The card is the shared config unchanged.
  assert.equal(card.fields.show_product_image, true);
  assert.equal(card.fields.show_unit_price, true);
  assert.equal(card.fields.show_sku, true);
  // The PDF has never printed the SKU, at either size.
  assert.equal(print.fields.show_sku, false);
  assert.equal(thermal.fields.show_sku, false, "thermal inherits print's overrides");
  // Only the 80mm roll drops the image and the unit-price column.
  assert.equal(print.fields.show_product_image, true);
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
