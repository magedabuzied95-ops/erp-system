import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const pageSource = await readFile(new URL("../src/modules/marketing/pages/SocialMediaPublisher.jsx", import.meta.url), "utf8");
const routeSource = await readFile(new URL("../server/routes/socialPublisher.js", import.meta.url), "utf8");
const serviceSource = await readFile(new URL("../server/services/socialPublisherPostsService.js", import.meta.url), "utf8");
const schemaSource = await readFile(new URL("../server/utils/marketingSchema.js", import.meta.url), "utf8");

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
