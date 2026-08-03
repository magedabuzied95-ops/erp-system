import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const pageSource = await readFile(new URL("../src/modules/marketing/pages/SocialMediaPublisher.jsx", import.meta.url), "utf8");
const routeSource = await readFile(new URL("../server/routes/socialPublisher.js", import.meta.url), "utf8");
const serviceSource = await readFile(new URL("../server/services/socialPublisherPostsService.js", import.meta.url), "utf8");
const schemaSource = await readFile(new URL("../server/utils/marketingSchema.js", import.meta.url), "utf8");
const automationSource = await readFile(new URL("../server/services/marketingCommentAutomationService.js", import.meta.url), "utf8");

test("school bags receive the back-to-school campaign opening", () => {
  assert.match(pageSource, /استعدوا لموسم العودة إلى المدارس/);
  assert.match(pageSource, /isSchoolBag/);
});

test("all selected product color images are persisted and published as a carousel", () => {
  assert.match(pageSource, /selectedCatalogMediaItems\.map\(\(item\) => item\.url\)/);
  assert.match(pageSource, /formData\.append\("media_urls", JSON\.stringify\(carouselUrls\)\)/);
  assert.match(routeSource, /req\.body\?\.media_urls/);
  assert.match(schemaSource, /media_urls JSONB NOT NULL DEFAULT '\[\]'::jsonb/);
  assert.match(serviceSource, /media_urls: uniqueTextList\(\[post\.media_url, \.\.\.\(post\.media_urls \|\| \[\]\)\]\)/);
});

test("posts published from both product entry points are linked to their ERP product automatically", () => {
  assert.match(pageSource, /formData\.append\("product_id", String\(selectedCatalogProduct\.id\)\)/);
  assert.match(routeSource, /req\.body\?\.product_id/);
  assert.match(schemaSource, /product_id BIGINT NULL/);
  assert.match(serviceSource, /saveLinksForPublishedPost/);
  assert.match(serviceSource, /product_id: post\.product_id/);
  assert.match(automationSource, /savePostProductLinksV2/);
  assert.match(automationSource, /productIds: \[post\.product_id\]/);
});
