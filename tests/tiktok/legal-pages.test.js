// Legal pages: bilingual content, public routing, and honesty about what the
// TikTok integration actually does.
//
// The content module is imported directly (it is plain data, no JSX), and the
// routing/shell wiring is asserted against source — the same approach the other
// suites in this repo use for frontend behaviour.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  LEGAL_PAGE_KEYS,
  SUPPORT_EMAIL,
  legalMetaFor,
  legalSectionsFor,
} from "../../src/storefront/pages/legalContent.js";

const appSource = readFileSync(new URL("../../src/App.jsx", import.meta.url), "utf8");
const pagesSource = readFileSync(new URL("../../src/storefront/pages/LegalPages.jsx", import.meta.url), "utf8");
const storefrontSource = readFileSync(new URL("../../src/storefront/Storefront.jsx", import.meta.url), "utf8");

const flatten = (pageKey, language) =>
  legalSectionsFor(pageKey, language)
    .flatMap((section) => [section.title, ...section.items])
    .join("\n");

const privacyAr = flatten("privacy", "ar");
const privacyEn = flatten("privacy", "en");
const termsAr = flatten("terms", "ar");
const termsEn = flatten("terms", "en");
const deletionAr = flatten("data-deletion", "ar");
const deletionEn = flatten("data-deletion", "en");

// ---------------------------------------------------------------------------
// Routes exist and are public
// ---------------------------------------------------------------------------

test("privacy, terms and data-deletion routes are registered", () => {
  assert.match(appSource, /path="\/privacy"/);
  assert.match(appSource, /path="\/terms"/);
  assert.match(appSource, /path="\/data-deletion"/);
});

test("legal routes are public and never wrapped in an auth guard", () => {
  for (const route of ["/privacy", "/terms", "/data-deletion"]) {
    const block = appSource.split(`path="${route}"`)[1]?.slice(0, 260) || "";
    assert.ok(block.length > 0, `route ${route} not found`);
    assert.ok(!/ProtectedRoute|adminOnly|requiredPermissions/.test(block),
      `${route} must not be behind authentication — a reviewer has no account`);
  }
});

test("the legal pages import no ERP auth or permission module", () => {
  // Scoped to import statements: prose in a comment may legitimately mention
  // ProtectedRoute while the module itself depends on none of it.
  const imports = (pagesSource.match(/^import[\s\S]*?from\s+"[^"]+";$/gm) || []).join("\n");
  assert.ok(imports.length > 0, "no imports found — the scan would pass vacuously");
  assert.ok(!/authStorage|rbacStore|ProtectedRoute|hasPermission|permissionMiddleware/.test(imports),
    `legal pages must not depend on ERP authentication, found in imports:\n${imports}`);
});

// ---------------------------------------------------------------------------
// Both languages exist for every page
// ---------------------------------------------------------------------------

test("every legal page has Arabic and English metadata", () => {
  for (const pageKey of LEGAL_PAGE_KEYS) {
    for (const language of ["ar", "en"]) {
      const meta = legalMetaFor(pageKey, language);
      assert.ok(meta, `${pageKey}/${language} metadata missing`);
      for (const field of ["title", "label", "description", "lead"]) {
        assert.equal(typeof meta[field], "string", `${pageKey}/${language} missing ${field}`);
        assert.ok(meta[field].length > 10, `${pageKey}/${language} ${field} is too short to be real content`);
      }
    }
  }
});

test("every section has both languages with matching item counts", () => {
  for (const pageKey of LEGAL_PAGE_KEYS) {
    const ar = legalSectionsFor(pageKey, "ar");
    const en = legalSectionsFor(pageKey, "en");
    assert.equal(ar.length, en.length, `${pageKey}: section count differs between languages`);
    ar.forEach((section, index) => {
      assert.ok(section.title && en[index].title, `${pageKey} section ${index}: missing a title`);
      // Substantive equivalence: the same clauses must exist in both languages.
      assert.equal(section.items.length, en[index].items.length,
        `${pageKey} section "${section.title}": clause count differs between AR and EN`);
      en[index].items.forEach((item) => assert.ok(item.trim().length > 10, `${pageKey}: empty EN clause`));
    });
  }
});

test("the English content is genuinely English, not untranslated Arabic", () => {
  const arabic = /[؀-ۿ]/;
  for (const [name, body] of [["privacy", privacyEn], ["terms", termsEn], ["data-deletion", deletionEn]]) {
    assert.ok(!arabic.test(body), `${name} EN still contains Arabic characters`);
  }
  for (const [name, body] of [["privacy", privacyAr], ["terms", termsAr], ["data-deletion", deletionAr]]) {
    assert.ok(arabic.test(body), `${name} AR is missing Arabic content`);
  }
});

// ---------------------------------------------------------------------------
// Pre-existing policies preserved
// ---------------------------------------------------------------------------

test("existing Meta / Facebook / Instagram / WhatsApp clauses are preserved", () => {
  assert.match(privacyAr, /Meta APIs/);
  assert.match(privacyAr, /Messenger/);
  assert.match(privacyAr, /Instagram/);
  assert.match(privacyAr, /WhatsApp/);
  assert.match(privacyEn, /Meta APIs/);
  assert.match(termsAr, /Meta/);
  assert.match(termsEn, /Meta/);
});

test("existing core privacy clauses survive verbatim", () => {
  for (const clause of [
    "لا يتم بيع بيانات العملاء إلى أي طرف ثالث.",
    "نحتفظ بالبيانات للمدة اللازمة للتشغيل، الالتزامات القانونية، ودعم العملاء.",
    "يتم التعامل مع البيانات داخل حدود الوصول المصرح به فقط.",
  ]) {
    assert.ok(privacyAr.includes(clause), `removed or reworded existing clause: ${clause}`);
  }
});

test("existing core terms clauses survive verbatim", () => {
  for (const clause of [
    "استخدام المنصة يعني موافقتك على شروط الخدمة الحالية وأي تحديثات لاحقة.",
    "ممنوع إساءة الاستخدام أو محاولة اختراق النظام أو تجاوز الصلاحيات.",
  ]) {
    assert.ok(termsAr.includes(clause), `removed or reworded existing clause: ${clause}`);
  }
});

// ---------------------------------------------------------------------------
// TikTok coverage — privacy
// ---------------------------------------------------------------------------

test("TikTok is named in the privacy policy in both languages", () => {
  assert.match(privacyAr, /TikTok/);
  assert.match(privacyEn, /TikTok/);
});

test("privacy covers OAuth / explicit authorisation and no password collection", () => {
  assert.match(privacyAr, /OAuth/);
  assert.match(privacyAr, /Connect TikTok/);
  assert.match(privacyAr, /كلمة مرور/);
  assert.match(privacyEn, /OAuth/i);
  assert.match(privacyEn, /password/i);
  assert.match(privacyEn, /authorisation screen/i);
});

test("privacy covers TikTok account information received", () => {
  assert.match(privacyEn, /display name/i);
  assert.match(privacyEn, /profile image/i);
  assert.match(privacyAr, /الاسم المعروض/);
});

test("privacy covers authorisation credentials without leaking security internals", () => {
  assert.match(privacyEn, /authorisation credentials/i);
  assert.match(privacyAr, /بيانات التفويض/);
  // Security specifics must never appear in a public policy.
  for (const body of [privacyAr, privacyEn, termsAr, termsEn]) {
    for (const forbidden of [/client secret/i, /AES/i, /encryption key/i, /HMAC/i, /database schema/i, /SECRET_ENCRYPTION_KEY/]) {
      assert.ok(!forbidden.test(body), `security internal leaked into a public policy: ${forbidden}`);
    }
  }
});

test("privacy covers user-provided media and states selection alone does not publish", () => {
  assert.match(privacyEn, /Selecting media does not publish it/i);
  assert.match(privacyAr, /اختيار الوسائط وحده لا يؤدي إلى نشرها/);
});

test("privacy covers explicit publishing, Direct Post and Draft as distinct", () => {
  assert.match(privacyEn, /explicit action/i);
  assert.match(privacyEn, /no automatic publishing/i);
  assert.match(privacyEn, /Direct Post/);
  assert.match(privacyEn, /Draft/);
  assert.match(privacyAr, /لا يوجد نشر تلقائي/);
  assert.match(privacyAr, /مسودات TikTok/);
});

test("privacy covers dynamic posting settings and commercial content declarations", () => {
  assert.match(privacyEn, /privacy level/i);
  assert.match(privacyEn, /Duet/);
  assert.match(privacyEn, /Stitch/);
  assert.match(privacyEn, /branded content/i);
  assert.match(privacyAr, /Duet/);
  assert.match(privacyAr, /Stitch/);
});

test("privacy limits data use and denies advertising or profiling", () => {
  assert.match(privacyEn, /do not use this data for advertising or to build user profiles/i);
  assert.match(privacyAr, /لا نستخدم هذه البيانات في الإعلانات/);
});

test("privacy covers retention without inventing a fixed period", () => {
  assert.match(privacyEn, /not retained for longer than operational need or legal obligations/i);
  // No concrete retention period is claimed, because none is enforced in code.
  assert.ok(!/\b(30|60|90|180|365)\s*(days|يوم)/i.test(privacyEn + privacyAr),
    "a specific retention period must not be claimed unless the system enforces it");
});

test("privacy covers disconnect and revoke from both sides", () => {
  assert.match(privacyEn, /disconnect a TikTok account at any time/i);
  assert.match(privacyEn, /revoke the application's access from TikTok's own settings/i);
  assert.match(privacyAr, /فصل حساب TikTok/);
  assert.match(privacyAr, /إلغاء وصول التطبيق من إعدادات TikTok/);
});

test("privacy covers data deletion using the project's real support address", () => {
  assert.ok(privacyAr.includes(SUPPORT_EMAIL));
  assert.ok(privacyEn.includes(SUPPORT_EMAIL));
  assert.ok(deletionAr.includes(SUPPORT_EMAIL));
  assert.ok(deletionEn.includes(SUPPORT_EMAIL));
});

// ---------------------------------------------------------------------------
// Support address
// ---------------------------------------------------------------------------

test("the legal pages use the same support address as the rest of the system", () => {
  assert.equal(SUPPORT_EMAIL, "support@m1store-egy.com");
});

test("the retired m1store-eg.com address appears in no rendered legal content", () => {
  // Scoped to what a visitor actually reads. The source comment documenting the
  // old address is history, not content, and must not fail this check.
  const rendered = [privacyAr, privacyEn, termsAr, termsEn, deletionAr, deletionEn].join("\n");
  assert.ok(!/support@m1store-eg\.com/.test(rendered),
    "the retired support address is still rendered on a legal page");
  assert.ok(rendered.includes("support@m1store-egy.com"),
    "the current support address must appear in the legal content");
});

test("every legal page reaches the visitor with the current address", () => {
  for (const body of [privacyAr, privacyEn, termsAr, termsEn, deletionAr, deletionEn]) {
    assert.ok(body.includes("support@m1store-egy.com"));
  }
});

// ---------------------------------------------------------------------------
// Storefront footer
// ---------------------------------------------------------------------------

test("the storefront footer links to both Terms and Privacy", () => {
  assert.match(storefrontSource, /to: "\/terms"/, "the Terms footer link must not disappear");
  assert.match(storefrontSource, /to: "\/privacy"/, "the footer must link to the Privacy Policy");
});

test("both footer legal links are localized in Arabic and English", () => {
  assert.match(storefrontSource, /isRtl \? "الشروط والأحكام" : "Terms & conditions", to: "\/terms"/);
  assert.match(storefrontSource, /isRtl \? "سياسة الخصوصية" : "Privacy policy", to: "\/privacy"/);
});

test("the footer legal links sit in the same list, so the footer layout is unchanged", () => {
  const block = storefrontSource.split("const importantLinks = [")[1]?.split("];")[0] || "";
  assert.ok(block.includes('to: "/terms"'), "Terms must stay in importantLinks");
  assert.ok(block.includes('to: "/privacy"'), "Privacy must be added to the same importantLinks list");
});

test("privacy defers to TikTok's own policies", () => {
  assert.match(privacyEn, /subject to TikTok's own terms and policies/i);
  assert.match(privacyAr, /يخضع أيضًا لشروط وسياسات TikTok/);
});

// ---------------------------------------------------------------------------
// TikTok coverage — terms
// ---------------------------------------------------------------------------

test("TikTok is named in the terms in both languages", () => {
  assert.match(termsAr, /TikTok/);
  assert.match(termsEn, /TikTok/);
});

test("terms cover account connection authority and platform-side authorisation", () => {
  assert.match(termsEn, /legal and administrative authority to connect/i);
  assert.match(termsEn, /never asked to give M1 Store their password/i);
  assert.match(termsAr, /الصلاحية القانونية والإدارية/);
});

test("terms cover publishing responsibility including copyright", () => {
  assert.match(termsEn, /infringes intellectual property rights/i);
  assert.match(termsEn, /unlawful content/i);
  assert.match(termsAr, /الملكية الفكرية/);
  assert.match(termsAr, /محتوى غير قانوني/);
});

test("terms distinguish Direct Post from Draft and disclaim acceptance", () => {
  assert.match(termsEn, /different action from direct publishing/i);
  assert.match(termsEn, /does not guarantee that TikTok will accept any post/i);
  assert.match(termsAr, /لا يضمن M1 Store قبول TikTok/);
});

test("terms cover platform availability, rate limits and TikTok-side changes", () => {
  assert.match(termsEn, /rate limits/i);
  assert.match(termsEn, /outside M1 Store's control/i);
  assert.match(termsAr, /حدود الاستخدام/);
});

test("terms cover disconnecting an integration", () => {
  assert.match(termsEn, /disconnect any third-party integration at any time/i);
  assert.match(termsAr, /فصل أي تكامل خارجي/);
});

// ---------------------------------------------------------------------------
// Honesty: no claim about unimplemented functionality
// ---------------------------------------------------------------------------

test("neither policy claims TikTok comment collection or management", () => {
  for (const [name, body] of [
    ["privacy AR", privacyAr], ["privacy EN", privacyEn],
    ["terms AR", termsAr], ["terms EN", termsEn],
  ]) {
    // "comments" may only appear as a POSTING SETTING (allow/disallow comments),
    // never as something M1 Store reads, stores, replies to, or moderates.
    for (const forbidden of [
      /read .{0,20}comments/i, /collect .{0,20}comments/i, /manage .{0,20}comments/i,
      /reply to .{0,20}comments/i, /moderate/i, /نجمع .{0,20}التعليقات/, /ندير .{0,20}التعليقات/,
      /الرد على التعليقات/,
    ]) {
      assert.ok(!forbidden.test(body), `${name} claims unimplemented comment functionality: ${forbidden}`);
    }
  }
});

test("no policy claims automatic or AI-driven publishing", () => {
  for (const body of [privacyAr, privacyEn, termsAr, termsEn]) {
    assert.ok(!/automatically publish|auto-publish|AI reply|AI replies/i.test(body));
  }
});

test("future functionality is described as conditional, never as existing", () => {
  assert.match(privacyEn, /We may add further functionality .{0,120}only happen after obtaining the necessary permissions/is);
  assert.match(privacyAr, /قد نضيف وظائف جديدة/);
});

// ---------------------------------------------------------------------------
// Localization mechanics and SEO
// ---------------------------------------------------------------------------

test("the shell uses the application's own language helpers rather than a new system", () => {
  assert.match(pagesSource, /from "\.\.\/\.\.\/i18n\/i18n"/);
  assert.match(pagesSource, /normalizeLanguage/);
  assert.match(pagesSource, /getLanguageDirection/);
});

test("direction and lang follow the selected language", () => {
  assert.match(pagesSource, /dir=\{direction\}/);
  assert.match(pagesSource, /lang=\{language\}/);
  assert.ok(!/dir="rtl"/.test(pagesSource), "direction must not be hardcoded to RTL any more");
});

test("language is switchable in place without changing the route", () => {
  assert.match(pagesSource, /params\.set\("lang", next\)/);
  assert.match(pagesSource, /replace: true/);
  // The canonical public paths must stay exactly as registered with third parties.
  assert.match(pagesSource, /privacy: "\/privacy", terms: "\/terms"/);
});

test("SEO metadata is set: description, canonical, robots, and hreflang alternates", () => {
  assert.match(pagesSource, /meta\[name="description"\]/);
  assert.match(pagesSource, /rel="canonical"/);
  assert.match(pagesSource, /content: "index, follow"/);
  assert.match(pagesSource, /hreflang="ar"/);
  assert.match(pagesSource, /hreflang="en"/);
});

test("a missing language falls back to Arabic instead of rendering nothing", () => {
  const fallback = legalMetaFor("privacy", "de");
  assert.ok(fallback.title.length > 0);
  assert.equal(legalSectionsFor("privacy", "de").length, legalSectionsFor("privacy", "ar").length);
});

test("an unknown page key returns null rather than throwing", () => {
  assert.equal(legalMetaFor("nope", "en"), null);
  assert.deepEqual(legalSectionsFor("nope", "en"), []);
});
