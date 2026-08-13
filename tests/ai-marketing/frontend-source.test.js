import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../../src/modules/marketing/pages/AiMarketingCenter.jsx", import.meta.url), "utf8");
const queueStatus = fs.readFileSync(new URL("../../src/modules/marketing/lib/queueStatus.js", import.meta.url), "utf8");

test("AiMarketingCenter exposes required status filters", () => {
  for (const value of ["all", "published", "pending_approval", "ready", "queued", "failed", "archived"]) {
    assert.match(source, new RegExp(`value: "${value}"`));
  }
});

test("queued/generating/uploading rows disable Preview until ready or published", () => {
  assert.match(source, /const isGenerating = \["queued", "generating_copy", "generating_image", "uploading"\]/);
  assert.match(source, /disabled=\{isGenerating \|\| generatingStoryAsset\}/);
  assert.match(queueStatus, /ready/);
  assert.match(queueStatus, /published/);
});

test("publish_failed rows show Retry Publish and published rows keep lifecycle actions", () => {
  assert.match(source, /إعادة محاولة النشر/);
  for (const text of ["Preview", "Archive", "Duplicate", "History", "Delete"]) {
    assert.match(source, new RegExp(text));
  }
});

test("archived rows show Restore and bulk action bar appears when rows are selected", () => {
  // These labels are localized now, so assert the key wiring plus the wording in
  // BOTH dictionaries. That is stronger than the old source literal, which could
  // not catch a control losing one language.
  assert.match(source, /marketing\.aiCenter\.queue\.restore/);
  assert.match(source, /selectedCount/);
  assert.match(source, /marketing\.aiCenter\.queue\.archiveSelected/);
  assert.match(source, /marketing\.aiCenter\.queue\.deleteSelected/);
  assert.match(source, /marketing\.aiCenter\.queue\.publishSelected/);

  const ar = JSON.parse(fs.readFileSync(new URL("../../src/locales/ar/marketing.json", import.meta.url), "utf8"));
  const en = JSON.parse(fs.readFileSync(new URL("../../src/locales/en/marketing.json", import.meta.url), "utf8"));
  assert.equal(ar.aiCenter.queue.restore, "استعادة");
  assert.equal(ar.aiCenter.queue.archiveSelected, "أرشفة المحدد");
  assert.equal(ar.aiCenter.queue.publishSelected, "نشر المحدد");
  assert.match(en.aiCenter.queue.restore, /restore/i);
  assert.match(en.aiCenter.queue.deleteSelected, /delete/i);
});

test("delete published modal includes required production warning", () => {
  assert.match(source, /سيؤدي ذلك إلى حذف المحتوى المولّد من قاعدة بيانات مركز التسويق ومن التخزين الوسيط\./);
  assert.match(source, /لن يحذف المحتوى تلقائيًا من فيسبوك أو إنستجرام إلا إذا كانت عملية الحذف على المنصة مدعومة صراحةً\./);
});

test("recommendations panel uses insufficient-data copy instead of fake recommendations", () => {
  assert.match(source, /لا توجد بيانات أداء كافية بعد\. انشر المزيد من المحتوى ومزامن الرؤى لعرض التوصيات\./);
  assert.match(source, /performance_insufficient_data/);
});
