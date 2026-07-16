import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("storefront category cards use full-bleed motion media", async () => {
  const source = await readFile(new URL("../src/storefront/Storefront.jsx", import.meta.url), "utf8");

  assert.match(source, /function HomeCategoryMotionMedia/);
  assert.match(source, /new IntersectionObserver/);
  assert.match(source, /muted[\s\S]*?loop[\s\S]*?playsInline/);
  assert.match(source, /min-h-\[390px\][\s\S]*?overflow-hidden/);
  assert.match(source, /HomeCategoryMotionMedia video=\{card\.video\} image=\{card\.image\}/);
  assert.doesNotMatch(source, /isRtl \? "فيديو" : "Video"/);
  assert.match(source, /h-full w-full object-cover transition/);
  assert.match(source, /match\?\.promo_video_url/);
  assert.match(source, /const MEN_CATEGORY_TRIAL_VIDEO_URL = "https:\/\/videos\.pexels\.com\/video-files\/7815147\/7815147-sd_540_960_30fps\.mp4";/);
  assert.match(source, /id: "men"[\s\S]*?video: MEN_CATEGORY_TRIAL_VIDEO_URL/);
  assert.match(source, /match\?\.media\?\.video_url \|\|[\s\S]*?definition\.video/);
  assert.match(source, /matchingProducts\.find\(\(product\) => homeProductWithImage\(product\)\)/);
  assert.match(source, /saleProducts\.find\(\(product\) => isAvailableProduct\(product\) && homeProductWithImage\(product\)\)/);
  assert.match(source, /if \(isOfferStory\(product\)\) return false/);
  assert.match(source, /const isExclusiveCategoryAudience/);
  assert.match(source, /audiences\.includes\("men"\) && audiences\.includes\("women"\)/);
  assert.match(source, /test: \(product\) => isExclusiveCategoryAudience\(product, "men"\)/);
  assert.match(source, /test: \(product\) => isExclusiveCategoryAudience\(product, "women"\)/);
  assert.match(source, /useProducts\(\{ gender: "women", sort: "newest", limit: 24 \}\)/);
  assert.match(source, /uniqueProductsByIdentity\(\[\.\.\.womenCategoryProducts, \.\.\.homepageProductPool\]\)/);
  assert.match(source, /تسوّق الآن/);
});
