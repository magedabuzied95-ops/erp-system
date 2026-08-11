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
