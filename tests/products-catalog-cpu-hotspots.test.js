import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

// GET /products/with-variants?pos=1 (the whole catalog: ~700 products, ~9k variants)
// spent ~3s of synchronous CPU in production, freezing every other request on the
// process. Measured with server/scripts/profileProductsWithVariants.local.mjs; the
// payload fingerprint was identical before and after these fixes.

const controller = fs.readFileSync(new URL("../server/controllers/productsController.js", import.meta.url), "utf8");

test("audience parsing only tries JSON for an array literal", () => {
  // JSON.parse("men") throws; one exception per variant was a third of the CPU time.
  const fn = controller.slice(controller.indexOf("const flattenAudienceInput"), controller.indexOf("const normalizeProductAudiences"));
  assert.match(fn, /if \(text\.startsWith\("\["\)\) \{\s*\n\s*try \{\s*\n\s*const parsed = JSON\.parse\(text\);/);
});

test("the POS projection walks the allowlist, not every row key", () => {
  assert.match(controller, /for \(const key of keepList\) \{\s*\n\s*if \(hasOwn\.call\(obj, key\)\) out\[key\] = obj\[key\];/);
  assert.match(controller, /pickKeptFields\(variant, POS_VARIANT_KEEP_LIST\)/);
});

test("sizes of one colour share the resolved images but never the same array", async () => {
  const { attachVariantImages } = await import("../server/services/productVariantImagesService.js");
  const image = (id, primary) => ({ id, product_id: 1, color_group_key: "g1", color_name: "Black", image_url: `/u/${id}.webp`, sort_order: id, is_primary: primary });
  const bundle = {
    byGroup: new Map([["g1", [image(2, false), image(1, true), image(2, false)]]]),
    byColor: new Map(),
    byVariant: new Map([["12", [{ ...image(9, false), variant_id: 12 }]]]),
  };
  const variants = [
    { id: 10, color: "Black", size: "40", color_group_key: "g1" },
    { id: 11, color: "Black", size: "41", color_group_key: "g1" },
    { id: 12, color: "Black", size: "42", color_group_key: "g1" },
  ];
  const [a, b, c] = attachVariantImages(variants, bundle);
  assert.deepEqual(a.images.map((item) => item.id), [1, 2]);
  assert.deepEqual(b.images, a.images);
  assert.notEqual(a.images, b.images, "a caller mutating one size's images must not touch another's");
  assert.equal(a.primary_image_url, "/u/1.webp");
  // A variant with its own image still resolves separately.
  assert.deepEqual(c.images.map((item) => item.id).sort(), [1, 2, 9]);
});
