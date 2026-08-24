/**
 * Single source of truth for how locale bundles compose into the i18next
 * resource tree.
 *
 * i18next is initialised with ONE namespace (`translation`); every entry below
 * becomes a top-level branch inside it, so translation keys are always addressed
 * as `t("<branch>.<path>")` with a dot — never with a namespace colon.
 *
 * Both the runtime (src/i18n/i18n.js) and the localization guards
 * (tests/i18n-dictionary-parity.test.js) build their view of the dictionaries
 * from this manifest, so a new bundle can never be wired into one and not the
 * other.
 */

/** Locales the application ships. Order is meaningful for guard reporting. */
export const SUPPORTED_LOCALES = ["en", "ar"];

/**
 * Each entry maps a resource branch to the locale file(s) that provide it.
 *
 * - `branch`  top-level key inside the `translation` namespace
 * - `file`    locale file base name under src/locales/<locale>/, or an array of
 *             base names merged left-to-right (later files win on collision)
 * - `pick`    optional sub-object of that file to lift into the branch
 *
 * NOTE on `inventory`: the Reporting Center's inventory analytics bundle and the
 * operational inventory bundle both address `t("inventory.*")`. They used to be
 * assigned to the same object key, so the second assignment silently replaced
 * the first and every operational `inventory.*` key resolved to nothing. They
 * are merged here instead; the operational bundle wins the two shared keys
 * (`title`, `subtitle`) and the analytics page reads those from
 * `inventoryAnalytics.*`.
 */
export const RESOURCE_BRANCHES = [
  { branch: "common", file: "common", pick: "common" },
  { branch: "sidebar", file: "common", pick: "sidebar" },
  { branch: "language", file: "common", pick: "language" },
  // Reads the ALREADY-WIRED common bundle, so no new i18n.js import is involved.
  { branch: "notifications", file: "common", pick: "notifications" },
  { branch: "appearance", file: "settings", pick: "appearance" },
  { branch: "settings", file: "settings", pick: "settings" },
  { branch: "dashboard", file: "dashboard" },
  { branch: "products", file: "products" },
  { branch: "pos", file: "pos" },
  { branch: "customers", file: "customers" },
  { branch: "orders", file: "orders" },
  { branch: "inventory", file: ["inventoryAnalytics", "inventory"] },
  { branch: "inventoryAnalytics", file: "inventoryAnalytics" },
  { branch: "analytics", file: "analytics" },
  { branch: "overview", file: "overview" },
  { branch: "salesAnalytics", file: "salesAnalytics" },
  { branch: "purchasingAnalytics", file: "purchasingAnalytics" },
  { branch: "customerAnalytics", file: "customerAnalytics" },
  { branch: "employeeAnalytics", file: "employeeAnalytics" },
  { branch: "reports", file: "reports" },
  { branch: "suppliers", file: "suppliers" },
  { branch: "purchases", file: "purchases" },
  { branch: "accounting", file: "accounting" },
  { branch: "expenses", file: "expenses" },
  { branch: "branches", file: "branches" },
  { branch: "warehouses", file: "warehouses" },
  { branch: "transfers", file: "transfers" },
  { branch: "managerPortal", file: "managerPortal" },
  { branch: "employeePortal", file: "employeePortal" },
  { branch: "attendance", file: "attendance" },
  { branch: "access", file: "access" },
  { branch: "auth", file: "auth" },
  { branch: "marketing", file: "marketing" },
  { branch: "aiStudio", file: "aiStudio" },
  { branch: "aiSupport", file: "aiSupport" },
  { branch: "shipping", file: "shipping" },
  { branch: "loyalty", file: "loyalty" },
  { branch: "saas", file: "saas" },
  { branch: "storefront", file: "storefront" },
  { branch: "print", file: "print" },
  { branch: "sales", file: "sales" },
  { branch: "surveillance", file: "surveillance" },
];

/**
 * Locale files that must be present before the FIRST paint.
 *
 * Shipping every bundle for every locale put ~1 MB of JSON on the entry chunk's
 * critical path, which a storefront shopper paid for in full before the product
 * request could even be issued. The public storefront only ever addresses
 * `storefront.*` and `common.*`; the rest of this list is a small safety margin
 * for chrome that can mount on a public route. Everything not listed here is
 * fetched in the background right after boot (see loadLocaleScope), so ERP
 * screens reached by in-app navigation still find their keys.
 *
 * Keep this list SMALL. Adding a heavy bundle here re-taxes every shopper.
 */
export const CORE_LOCALE_FILES = ["common", "storefront", "settings", "auth", "shipping", "print"];

/** Every locale file the manifest can read, derived so the two cannot drift. */
export const ALL_LOCALE_FILES = Array.from(
  new Set(RESOURCE_BRANCHES.flatMap((entry) => (Array.isArray(entry.file) ? entry.file : [entry.file])))
);

/** The bundles loaded after first paint: everything the core set does not cover. */
export const DEFERRED_LOCALE_FILES = ALL_LOCALE_FILES.filter((file) => !CORE_LOCALE_FILES.includes(file));

/**
 * Branches whose content is intentionally locale-specific and therefore exempt
 * from the ar/en parity guard. Every entry needs a documented reason.
 *
 * Keep this list empty unless a locale genuinely cannot carry the key.
 */
export const PARITY_EXCEPTIONS = [
  // { key: "print.someArabicOnlyLegalLine", reason: "..." },
];

/**
 * Keys whose value is intentionally in the *other* language because the value is
 * sample content for a field that stores that language, not application chrome.
 *
 * Example: the "Arabic name" input on the product classifications screen shows an
 * Arabic example placeholder even while the app runs in English.
 *
 * An entry matches either an exact `key` or, with `prefix: true`, any key that
 * starts with it (used for arrays of sample data).
 */
export const LOCALE_PURITY_EXCEPTIONS = [
  { key: "products.classifications.arabicNamePlaceholder", reason: "Sample value for the Arabic-name input." },
  { key: "products.classifications.optionArabicPlaceholder", reason: "Sample value for the Arabic option-name input." },
  { key: "products.classifications.customArabicPlaceholder", reason: "Sample value for the Arabic custom-group input." },
  { key: "products.classifications.englishNamePlaceholder", reason: "Sample value for the English-name input." },
  { key: "products.classifications.optionEnglishPlaceholder", reason: "Sample value for the English option-name input." },
  { key: "products.classifications.customEnglishPlaceholder", reason: "Sample value for the English custom-group input." },
  { key: "products.classifications.englishLabel", reason: "Names the English field itself." },
  { key: "language.english", reason: "Language names are shown in their own language." },
  { key: "storefront.header.languageEnglish", reason: "Language names are shown in their own language." },
  { key: "products.classifications.keyPlaceholder", reason: "Sample machine key, always Latin." },
  { key: "products.classifications.valuePlaceholder", reason: "Sample machine value, always Latin." },
  { key: "products.classifications.customKeyPlaceholder", reason: "Sample machine key, always Latin." },
  { key: "products.editor.slug", reason: "URL slug is a technical field name kept in Latin." },
  { key: "products.editor.canonicalSlug", reason: "URL slug is a technical field name kept in Latin." },
  { key: "products.editor.slugPlaceholder", reason: "Sample URL slug." },
  { key: "products.editor.previewDomain", reason: "Sample storefront domain." },
  { key: "products.editor.seoNav", reason: "SEO is used untranslated in the product's Arabic UI." },
  { key: "products.manufacturers.emailPlaceholder", reason: "Sample email address." },
  { key: "storefront.search.trending", prefix: true, reason: "Trending search terms are catalogue data." },
  { key: "storefront.search.fallbackSections.brands", prefix: true, reason: "Brand names are never translated." },
  { key: "storefront.invoice.paymentMethods.instapay", reason: "Payment provider brand name." },
  { key: "storefront.invoice.paymentMethods.vodafone_cash", reason: "Payment provider brand name." },
  { key: "marketing.socialCalendar.draft.canvas.rightValue", reason: "Channel brand names." },
  { key: "marketing.social.platforms", prefix: true, reason: "Social platform brand names." },
];

const isPlainObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** Deep merge where `overlay` wins scalar collisions. */
const deepMerge = (base, overlay) => {
  if (!isPlainObject(base)) return overlay;
  if (!isPlainObject(overlay)) return base;
  const merged = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    merged[key] = isPlainObject(value) && isPlainObject(merged[key]) ? deepMerge(merged[key], value) : value;
  }
  return merged;
};

/** Resolves one manifest entry against a locale's parsed bundles. */
export const resolveBranch = ({ file, pick }, files) => {
  const names = Array.isArray(file) ? file : [file];
  let branchValue = {};
  for (const name of names) {
    const source = files[name] || {};
    branchValue = deepMerge(branchValue, pick ? source[pick] || {} : source);
  }
  return branchValue;
};

/**
 * Builds the i18next `resources` object from the manifest.
 *
 * @param {Record<string, Record<string, unknown>>} bundles
 *   `{ [locale]: { [fileBaseName]: parsedJson } }`
 */
export const buildResources = (bundles) => {
  const resources = {};
  for (const locale of SUPPORTED_LOCALES) {
    const files = bundles[locale] || {};
    const translation = {};
    for (const entry of RESOURCE_BRANCHES) {
      translation[entry.branch] = resolveBranch(entry, files);
    }
    resources[locale] = { translation };
  }
  return resources;
};
