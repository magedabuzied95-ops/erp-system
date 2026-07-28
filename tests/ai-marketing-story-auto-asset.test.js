import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(
  new URL("../src/modules/marketing/pages/AiMarketingCenter.jsx", import.meta.url),
  "utf8"
);

test("publishing a story automatically creates its missing final asset", () => {
  assert.match(source, /const preparedItem = await generateStoryAsset\(targetItem \|\| \{ id \}\)/);
  assert.match(source, /targetItem = preparedItem/);
  assert.doesNotMatch(source, /أنشئ أصل القصة أولًا من زر المعاينة/);
});

test("bulk story publishing automatically prepares all missing assets", () => {
  assert.match(source, /Promise\.all\(missingStoryAssets\.map\(\(item\) => generateStoryAsset\(item\)\)\)/);
  assert.match(source, /preparedAssets\.some\(\(item\) => !item \|\| !hasValidStoryAssetSnapshot\(item\)\)/);
});
