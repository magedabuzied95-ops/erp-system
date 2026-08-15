import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const createSource = fs.readFileSync("src/modules/products/pages/CreateProduct.jsx", "utf8");
const editSource = fs.readFileSync("src/modules/products/pages/ProductEdit.jsx", "utf8");

const colorUploadHandler = (source) => {
  const start = source.indexOf("const handleColorImages = async");
  const end = source.indexOf("\n  const add", start);
  return source.slice(start, end);
};

test("new product color images render an optimistic preview before their upload finishes", () => {
  const handler = colorUploadHandler(createSource);
  const optimisticUpdate = handler.indexOf("updateColorGroupImages(colorGroupId, (images) => [...images, ...optimisticItems])");
  const uploadWait = handler.indexOf("await mapWithConcurrency");

  assert.ok(optimisticUpdate >= 0);
  assert.ok(uploadWait > optimisticUpdate);
  assert.match(handler, /preview: createObjectPreviewUrl\(file\)/);
  assert.match(handler, /uploading: true/);
  assert.match(handler, /image_url: uploadedUrl \|\| "", uploading: false/);
});

test("edited product color images render locally before their upload finishes", () => {
  const handler = colorUploadHandler(editSource);
  const optimisticUpdate = handler.indexOf("updateColorGroupImages(groupId, (images) => [...images, ...optimisticItems])");
  const uploadWait = handler.indexOf("await Promise.all(uploads)");

  assert.ok(optimisticUpdate >= 0);
  assert.ok(uploadWait > optimisticUpdate);
  assert.match(handler, /preview: previews\[index\]/);
  assert.match(handler, /uploading: true/);
  assert.match(handler, /image_url: uploadedUrl \|\| "", uploading: false/);
});

test("temporary color previews keep an empty persisted URL until upload succeeds", () => {
  for (const source of [createSource, editSource]) {
    assert.match(source, /hasExplicitImageUrl/);
    assert.match(source, /uploading: Boolean\(value\?\.uploading\)/);
    assert.match(source, /!hasExplicitImageUrl \? finalPreview : ""/);
  }
});

// Uploads live on the API origin. A bare "/uploads/..." path resolves against
// the origin the SPA is served from, where the catch-all rewrite answers with
// index.html, so the preview renders nothing while the saved product is fine.
test("both product editors resolve asset URLs through the shared API-origin helper", () => {
  for (const source of [createSource, editSource]) {
    assert.match(source, /import \{ resolveProductImageUrl \} from "\.\.\/\.\.\/\.\.\/shared\/lib\/imageUrls"/);
    assert.match(source, /const resolveAssetUrl = \(url\) => resolveProductImageUrl\(url\)/);
  }
});

test("every image rendered by the product editors is resolved, never a raw stored path", () => {
  // The color-picker modal renders the source its caller already resolved.
  const resolvedByCaller = new Set(["target.source"]);

  for (const [name, source] of [["CreateProduct", createSource], ["ProductEdit", editSource]]) {
    const rendered = [...source.matchAll(/src=\{([^}]*(?:\}[^}]*)*?)\}\s/g)].map((match) => match[1].trim());
    assert.ok(rendered.length > 0, `${name}: found no rendered images to check`);

    for (const expression of rendered) {
      if (resolvedByCaller.has(expression)) continue;
      assert.ok(
        expression.includes("resolveAssetUrl("),
        `${name}: rendered image "${expression}" bypasses resolveAssetUrl`
      );
    }
  }

  // ...and the one caller-resolved case really is resolved at its call site.
  for (const source of [createSource, editSource]) {
    assert.match(source, /source: resolveAssetUrl\(getPrimaryColorImage\(group\)/);
  }
});

test("color image thumbnails resolve their preview before handing it to the thumbnail", () => {
  for (const source of [createSource, editSource]) {
    assert.match(source, /image=\{\{ \.\.\.image, preview: resolveAssetUrl\(image\.(?:image_url \|\| image\.preview|preview \|\| image\.image_url)\) \}\}/);
  }
});
