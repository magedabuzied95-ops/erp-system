import test from "node:test";
import assert from "node:assert/strict";
import { buildProductSeo, buildProductSeoTitle, PRODUCT_TITLE_MAX } from "../../src/shared/lib/productSeo.js";
import { injectProductSeoIntoHtml } from "../../server/services/storefrontProductSeoPageService.js";
import {
  auditProductSeo,
  isCleanSlug,
  joinKeywords,
  slugifyProductSlug,
  splitKeywords,
} from "../../src/shared/lib/productSeoAudit.js";
import {
  SEO_DESCRIPTION_MAX,
  SEO_SLUG_MAX,
  SEO_TITLE_MAX,
  buildSeoFallback,
  generateProductSeoMetadata,
  normalizeSeoGenerated,
} from "../../server/services/openaiProductDescriptionService.js";

const baseProduct = {
  id: 25,
  slug: "nike-air-force-1-sneakers",
  name: "Nike Air Force 1 Sneakers",
  brand: "Nike",
  category: "Sneakers",
  image_url: "https://images.example/nike.webp",
  final_price: 650,
  variants: [{ id: 1, color: "White", size: "41", stock: 3, final_price: 650 }],
};

const shell = '<!doctype html><html lang="en-GB"><head><title>M1 Store</title></head><body><div id="root"></div></body></html>';

test("a merchant meta_title becomes the page title with the store name appended once", () => {
  const seo = buildProductSeo({ ...baseProduct, meta_title: "كوتشي Nike Air Force 1 رجالي" });
  assert.equal(seo.title, "كوتشي Nike Air Force 1 رجالي | M1 Store");
  assert.equal(buildProductSeoTitle({ meta_title: "كوتشي Nike رجالي | M1 Store" }), "كوتشي Nike رجالي | M1 Store");
});

test("a long meta_title keeps its search phrase instead of the suffix", () => {
  const long = "كوتشي Nike Air Force 1 Low رجالي أبيض مريح للبس اليومي بخامات ممتازة وشكل عملي";
  assert.ok(long.length + " | M1 Store".length > PRODUCT_TITLE_MAX);
  assert.equal(buildProductSeoTitle({ meta_title: long }), long);
});

test("without meta_title the title still falls back to name | brand | store", () => {
  const seo = buildProductSeo(baseProduct);
  assert.equal(seo.title, "Nike Air Force 1 Sneakers | M1 Store");
});

test("keywords reach the Product JSON-LD and the head, and the page declares Arabic", () => {
  const seo = buildProductSeo({ ...baseProduct, seo_keywords: "كوتشي رجالي, Nike, كوتشي Nike رجالي, Nike" });
  assert.deepEqual(seo.keywords, ["كوتشي رجالي", "Nike", "كوتشي Nike رجالي"]);
  assert.equal(seo.productJsonLd.keywords, "كوتشي رجالي, Nike, كوتشي Nike رجالي");
  assert.equal(seo.locale, "ar_EG");
  const html = injectProductSeoIntoHtml(shell, seo);
  assert.match(html, /<html lang="ar" dir="rtl">/);
  assert.doesNotMatch(html, /lang="en-GB"/);
  assert.match(html, /<meta name="keywords" content="كوتشي رجالي, Nike, كوتشي Nike رجالي" \/>/);
  assert.match(html, /property="og:locale" content="ar_EG"/);
  assert.match(html, /property="og:locale:alternate" content="en_US"/);
  assert.match(html, /property="og:image:alt" content="Nike Air Force 1 Sneakers"/);
});

test("no keywords means no empty keywords tag", () => {
  const html = injectProductSeoIntoHtml(shell, buildProductSeo(baseProduct));
  assert.doesNotMatch(html, /name="keywords"/);
  assert.equal("keywords" in buildProductSeo(baseProduct).productJsonLd, false);
});

test("audit scores a complete product as excellent and an empty one as weak", () => {
  const complete = auditProductSeo({
    name: "Air Force 1",
    brand: "Nike",
    metaTitle: "كوتشي Nike Air Force 1 رجالي أبيض",
    seoDescription: "كوتشي رجالي Nike Air Force 1 بخامات مريحة وشكل عملي يناسب اللبس اليومي. متوفر بألوان أبيض وأسود. اطلبه الآن من M1 Store.",
    seoKeywords: "كوتشي رجالي, Nike, Air Force 1, كوتشي Nike",
    canonicalSlug: "nike-air-force-1-sneakers-men",
    descriptionAr: Array.from({ length: 45 }, () => "كلمة").join(" "),
    descriptionEn: Array.from({ length: 45 }, () => "word").join(" "),
    coverImage: "https://images.example/nike.webp",
  });
  assert.equal(complete.score, 100);
  assert.equal(complete.grade, "excellent");
  assert.ok(complete.checks.every((check) => check.status === "pass"));

  const empty = auditProductSeo({});
  assert.equal(empty.score, 0);
  assert.equal(empty.grade, "weak");
});

test("audit warns on out-of-range lengths instead of failing them", () => {
  const audit = auditProductSeo({
    metaTitle: "Nike",
    seoDescription: "x".repeat(200),
    canonicalSlug: "Nike Air Force",
    seoKeywords: "one",
    descriptionAr: "قليل",
  });
  const byId = Object.fromEntries(audit.checks.map((check) => [check.id, check]));
  assert.equal(byId.metaTitle.status, "warn");
  assert.equal(byId.metaDescription.status, "warn");
  assert.equal(byId.slug.status, "warn");
  assert.equal(byId.keywords.status, "warn");
  assert.equal(byId.descriptionAr.status, "warn");
  assert.equal(byId.descriptionEn.status, "fail");
});

test("keyword and slug helpers normalise merchant input", () => {
  assert.deepEqual(splitKeywords("كوتشي رجالي، Nike , nike,, Air Force 1\n"), ["كوتشي رجالي", "Nike", "Air Force 1"]);
  assert.equal(joinKeywords(["A", "a", "B"]), "A, B");
  assert.equal(slugifyProductSlug("Nike  Air Force 1 / Men's"), "nike-air-force-1-men-s");
  assert.equal(isCleanSlug("nike-air-force-1"), true);
  assert.equal(isCleanSlug("Nike Air"), false);
});

test("server fallback writes Arabic-first metadata within the SERP limits", () => {
  const seo = buildSeoFallback({
    product_name: "Air Force 1",
    brand: "Nike",
    product_type: "sneakers",
    gender: "men",
    colors: ["White", "Black"],
    sizes: ["41", "42", "43"],
  });
  assert.equal(seo.meta_title, "كوتشي Nike Air Force 1 رجالي");
  assert.ok(seo.meta_title.length <= SEO_TITLE_MAX);
  assert.ok(seo.meta_description.length <= SEO_DESCRIPTION_MAX);
  assert.match(seo.meta_description, /اطلبه الآن من M1 Store\.$/);
  assert.match(seo.meta_description, /أبيض/);
  assert.equal(seo.slug, "nike-air-force-1-sneakers-men");
  assert.ok(seo.keywords.length >= 6 && seo.keywords.length <= 10);
  assert.ok(seo.keywords.includes("كوتشي رجالي"));
});

test("server fallback drops whole sentences, never clips mid-sentence, and cuts slugs on a hyphen", () => {
  const seo = buildSeoFallback({
    product_name: "Very Long Product Name With Many Words Inside It For Testing Purposes",
    brand: "Skechers",
    product_type: "shoes",
    gender: "women",
    colors: ["Red", "Blue", "Green", "Black", "White"],
    sizes: ["36", "37", "38", "39", "40", "41"],
  });
  assert.ok(seo.meta_description.length <= SEO_DESCRIPTION_MAX);
  assert.match(seo.meta_description, /\.$/);
  assert.doesNotMatch(seo.meta_description, /بألوان\./);
  assert.ok(seo.slug.length <= SEO_SLUG_MAX);
  assert.doesNotMatch(seo.slug, /-$/);
  assert.doesNotMatch(seo.slug, /-[a-z]$/);
});

test("OpenAI output is normalised: store suffix stripped, lengths capped, slug latinised", () => {
  const fallback = buildSeoFallback({ product_name: "Air Force 1", brand: "Nike", product_type: "sneakers", gender: "men" });
  const normalized = normalizeSeoGenerated(
    {
      meta_title: "كوتشي Nike Air Force 1 رجالي | M1 Store",
      meta_description: "وصف ".repeat(80),
      keywords: ["Nike", "#كوتشي", "nike"],
      slug: "Nike Air Force--1 كوتشي",
    },
    fallback
  );
  assert.equal(normalized.meta_title, "كوتشي Nike Air Force 1 رجالي");
  assert.ok(normalized.meta_description.length <= SEO_DESCRIPTION_MAX);
  assert.equal(normalized.slug, "nike-air-force-1");
  assert.ok(normalized.keywords.length >= 3);
  assert.equal(normalized.keywords[1], "كوتشي");
});

test("without an OpenAI key the endpoint answers from the local fallback", async () => {
  const previous = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    const result = await generateProductSeoMetadata({ current: { product_name: "Air Force 1", brand: "Nike", product_type: "sneakers", gender: "men" } });
    assert.equal(result.source, "LOCAL_FALLBACK");
    assert.equal(result.meta_title, "كوتشي Nike Air Force 1 رجالي");
    const missing = await generateProductSeoMetadata({ current: {} });
    assert.equal(missing.error, "PRODUCT_NAME_REQUIRED");
  } finally {
    if (previous !== undefined) process.env.OPENAI_API_KEY = previous;
  }
});

test("description fallback reads as a real listing and gets the audience right", async () => {
  const previous = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    const { generateProductDescription } = await import("../../server/services/openaiProductDescriptionService.js");
    const result = await generateProductDescription({
      target: "all",
      current: {
        product_name: "Puma Sneakers",
        brand: "Puma",
        category: "Uncategorized",
        productType: "sneakers",
        gender: "women",
        colors: ["Black & Grey", "Brown", "Grey & White"],
        sizes: ["40", "37", "38", "39", "41"],
      },
    });
    assert.equal(result.source, "LOCAL_FALLBACK");
    assert.match(result.arabic_description, /^كوتشي حريمي Puma Sneakers/);
    assert.doesNotMatch(result.arabic_description, /رجالي|Uncategorized|بجودة عرض/);
    assert.match(result.arabic_description, /أسود ورمادي، بني، رمادي وأبيض/);
    assert.match(result.arabic_description, /من 37 إلى 41/);
    assert.match(result.arabic_description, /اطلبيه الآن/);
    assert.match(result.english_description, /women's sneakers/);
    assert.doesNotMatch(result.english_description, /Uncategorized|storefront-ready/);

    const men = await generateProductDescription({ target: "ar", current: { product_name: "Air Force 1", brand: "Nike", product_type: "shoes", gender: "men" } });
    assert.match(men.arabic_description, /^كوتشي رجالي Nike Air Force 1/);
    assert.match(men.arabic_description, /اطلبه الآن/);
  } finally {
    if (previous !== undefined) process.env.OPENAI_API_KEY = previous;
  }
});
