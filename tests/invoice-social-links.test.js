import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// The review ask lives in the WhatsApp message that carries the invoice link, not on the invoice
// page itself — a customer opening their receipt is being asked to rate a purchase they have not
// received yet. Facebook stays as a follow link, which is contact rather than solicitation.

const pages = {
  "public invoice page": fs.readFileSync(new URL("../src/pages/PublicInvoice.jsx", import.meta.url), "utf8"),
  "invoice block view": fs.readFileSync(new URL("../src/shared/components/invoices/InvoiceBlockView.jsx", import.meta.url), "utf8"),
};
const ar = JSON.parse(fs.readFileSync(new URL("../src/locales/ar/print.json", import.meta.url), "utf8"));
const en = JSON.parse(fs.readFileSync(new URL("../src/locales/en/print.json", import.meta.url), "utf8"));

test("neither invoice renderer asks for a review", () => {
  for (const [name, src] of Object.entries(pages)) {
    const links = src.slice(src.indexOf("social"), src.indexOf("export default"));
    assert.ok(!links.includes('key: "google"'), `${name} has no Google review link`);
    assert.ok(!links.includes('key: "facebook"'), `${name} has no Facebook review link`);
    assert.ok(!links.includes("rateGoogle"), `${name} has no rate-us-on-Google label`);
    assert.ok(!links.includes("rateFacebook"), `${name} has no rate-us-on-Facebook label`);
  }
});

test("Facebook is a follow link, not a review link", () => {
  for (const [name, src] of Object.entries(pages)) {
    assert.ok(src.includes('key: "facebookPage"'), `${name} links the Facebook page`);
  }
  // facebookPage is a key SocialBrandButton already knows how to draw
  const button = fs.readFileSync(
    new URL("../src/shared/components/invoices/SocialBrandButton.jsx", import.meta.url), "utf8"
  );
  assert.ok(button.includes("facebookPage"), "the brand button renders facebookPage");
});

test("the follow-Facebook label exists in both languages", () => {
  assert.ok(ar.invoice?.followFacebook || ar.print?.followFacebook || JSON.stringify(ar).includes("followFacebook"),
    "Arabic has a followFacebook label");
  assert.ok(JSON.stringify(en).includes("followFacebook"), "English has a followFacebook label");
});

test("the mobile row shows follow links, not a filter that can never match", () => {
  const src = pages["public invoice page"];
  assert.ok(!src.includes("reviewLinks"), "the review-only list is gone");
  assert.ok(src.includes("const followLinks = useMemo("), "it lists follow links instead");
  const memo = src.slice(src.indexOf("const followLinks = useMemo("), src.indexOf("if (loading)"));
  assert.ok(memo.includes('"instagram"') && memo.includes('"facebookPage"'),
    "and filters on keys the list actually contains");
});

test("contact links survive — only the solicitation went", () => {
  for (const [name, src] of Object.entries(pages)) {
    assert.ok(src.includes('key: "instagram"'), `${name} still links Instagram`);
  }
  assert.ok(pages["invoice block view"].includes('key: "whatsapp"'), "the block view still links WhatsApp");
});
