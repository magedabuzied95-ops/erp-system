import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

// Phase 2B-2a — CreateProduct SUBMIT SAFETY BASELINE.
//
// These tests exist to be landed BEFORE any UI migration of this file. The
// canonical M1UI Button defaults to type="button"; product creation submits
// through native form submission. So a careless migration would not produce a
// visible bug — it would silently stop the product from saving, and build, lint
// and the entire rest of the suite would still pass.
//
// Everything here pins CURRENT behaviour. Nothing here endorses a change.

const src = fs.readFileSync(new URL("../src/modules/products/pages/CreateProduct.jsx", import.meta.url), "utf8");

// ---- the form -------------------------------------------------------------

test("there is exactly ONE form and it owns the submit handler", () => {
  assert.equal((src.match(/<form/g) || []).length, 1);
  assert.match(src, /<form id="create-product-form" onSubmit=\{handleSubmit\}/);
});

test("handleSubmit still prevents the default navigation and guards re-entry", () => {
  const fn = src.slice(src.indexOf("const handleSubmit = async (event) =>"), src.indexOf("const handleSubmit = async (event) =>") + 300);
  assert.match(fn, /event\.preventDefault\(\);/, "losing this would reload the page instead of saving");
  assert.match(fn, /if \(saving\) return;/, "double-submit guard");
});

// ---- the three submit controls -------------------------------------------

test("exactly THREE submit controls exist — no more, no fewer", () => {
  // If this number changes, a submit path was added or (worse) silently lost.
  assert.equal((src.match(/type="submit"/g) || []).length, 3);
});

test("every submit control is disabled while saving", () => {
  // Each type="submit" must be followed closely by disabled={saving}.
  let index = -1;
  let checked = 0;
  while ((index = src.indexOf('type="submit"', index + 1)) !== -1) {
    const window = src.slice(index, index + 220);
    assert.match(window, /disabled=\{saving\}/, `submit control at offset ${index} lost its saving guard`);
    checked += 1;
  }
  assert.equal(checked, 3);
});

// ---- the detached submit button — the highest-risk one --------------------

test("ProductActionBar's submit stays associated with the form via `form=`", () => {
  // This button renders OUTSIDE <form>. Its only link to the form is the `form`
  // attribute. Drop it during a Button migration and saving dies silently.
  const bar = src.slice(src.indexOf("function ProductActionBar("), src.indexOf("function ProductActionBar(") + 1600);
  assert.match(bar, /type="submit"/);
  assert.match(bar, /form=\{formId\}/, "the detached submit MUST keep its form association");
  assert.match(bar, /disabled=\{saving\}/);
});

test("ProductActionBar receives the real form id from the page", () => {
  assert.match(src, /formId="create-product-form"/);
  assert.match(src, /function ProductActionBar\(\{[^}]*formId[^}]*\}\)/);
  // the id passed in must be the id the form actually declares
  const formId = (src.match(/<form id="([^"]+)"/) || [])[1];
  assert.equal(formId, "create-product-form");
  assert.ok(src.includes(`formId="${formId}"`), "the action bar is wired to a different form id");
});

// ---- migration tripwires --------------------------------------------------

test("no submit control has been converted to a canonical Button yet", () => {
  // When a future phase migrates these, it must pass type="submit" explicitly
  // AND keep form={formId} on the detached one. This test documents that the
  // conversion has not happened, so the guard above is still meaningful.
  const submitRegions = [...src.matchAll(/type="submit"/g)].map((m) => src.slice(Math.max(0, m.index - 120), m.index));
  for (const region of submitRegions) {
    assert.match(region, /<button/, "a submit control is no longer a native <button>; verify type + form are still passed");
  }
});

test("file inputs are still native — image upload is behaviour-coupled", () => {
  // Marked no-go for Phase 2B: refs, accept, multiple and upload handlers hang
  // off these. They must not become a generic M1UI Input.
  assert.equal((src.match(/type="file"/g) || []).length, 4);
});
