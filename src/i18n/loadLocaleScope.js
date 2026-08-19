/**
 * Locale loading strategy.
 *
 * The dictionaries used to be static imports in i18n.js: all 34 bundles, in both
 * languages, welded onto the entry chunk. That was ~1 MB decoded (larger than
 * react-dom and the entire Storefront bundle combined) and it sat on the
 * critical path, so a shopper opening a product page downloaded the ERP's
 * accounting, payroll and AI-support dictionaries before the product request
 * could even be issued.
 *
 * Now:
 *   - boot loads ONE language, and on a public storefront route only the CORE
 *     bundles (see CORE_LOCALE_FILES);
 *   - everything else is merged in after first paint, off the critical path.
 *
 * Merging later is safe because i18next resources are additive: addResourceBundle
 * with deep+overwrite grafts the missing branches onto the same `translation`
 * namespace the manifest already describes.
 */
import { buildResources, RESOURCE_BRANCHES, SUPPORTED_LOCALES } from "./localeManifest";

const coreLoaders = {
  ar: () => import("./bundles/core.ar.js"),
  en: () => import("./bundles/core.en.js"),
};

const restLoaders = {
  ar: () => import("./bundles/rest.ar.js"),
  en: () => import("./bundles/rest.en.js"),
};

/**
 * Paths that render the public storefront, which addresses only `storefront.*`
 * and `common.*`. Anything else — the ERP shell, POS, the portals, the inbox —
 * boots with the full dictionary so no screen can render against missing keys.
 *
 * This is deliberately a PATH test rather than a host test: the portals and the
 * inbox are reachable on the storefront host too.
 */
const STOREFRONT_PATH = new RegExp(
  [
    "^/$",
    "^/(products|product|cart|checkout|account|track|wishlist|recently-viewed)(/|$)",
    "^/(sale|offers|contact|size-guide|returns|faq|brands|search)(/|$)",
    "^/(men|women|kids|bags|crocs|slippers)(/|$)",
    "^/(shop|c)(/|$)",
    "^/(success|confirm)/",
  ].join("|")
);

export const isStorefrontBootPath = (pathname) => STOREFRONT_PATH.test(String(pathname || "/").toLowerCase());

/**
 * Hosts that serve the public storefront at the root. Mirrors
 * `isStorefrontRootHost` in App.jsx — the two must agree, because App uses it to
 * decide whether the ERP routes exist at all.
 */
const STOREFRONT_ROOT_HOSTS = new Set(["m1store-egy.com", "www.m1store-egy.com", "localhost", "127.0.0.1"]);

export const isStorefrontRootHost = (hostname) => {
  const host = String(hostname || "").trim().toLowerCase();
  if (!host) return false;
  return STOREFRONT_ROOT_HOSTS.has(host) || host.endsWith(".vercel.app");
};

/**
 * True when only the core bundles are needed to paint the first screen.
 *
 * The host test is not redundant with the path test: `/products` and `/account`
 * are storefront routes on the storefront host and ERP routes on the ERP host,
 * and the ERP product screen leans on the `products.*` branch that the core set
 * deliberately omits. Getting this wrong is only ever a brief fallback-label
 * flash, never a broken page — but the ERP has no reason to pay for it.
 */
export const shouldDeferErpLocales = () => {
  if (typeof window === "undefined") return false;
  if (!isStorefrontRootHost(window.location.hostname)) return false;
  return isStorefrontBootPath(window.location.pathname);
};

const emptyBranches = () => Object.fromEntries(RESOURCE_BRANCHES.map((entry) => [entry.branch, {}]));

/** Builds the single-locale `resources` tree i18next is initialised with. */
export const buildLocaleResources = (locale, files) => {
  const built = buildResources({ [locale]: files });
  // buildResources always emits every supported locale; keep only the one we
  // actually have files for so i18next does not register empty sibling trees.
  return { [locale]: built[locale] || { translation: emptyBranches() } };
};

export const loadCoreBundles = async (locale) => {
  const loader = coreLoaders[locale] || coreLoaders.en;
  return (await loader()).default;
};

export const loadRestBundles = async (locale) => {
  const loader = restLoaders[locale] || restLoaders.en;
  return (await loader()).default;
};

/**
 * Merges the remaining bundles for `locale` into a live i18next instance.
 * Resolves to false when there was nothing left to add.
 */
export const mergeRemainingBundles = async (i18nInstance, locale, { includeCore = false } = {}) => {
  if (!SUPPORTED_LOCALES.includes(locale)) return false;
  const [rest, core] = await Promise.all([
    loadRestBundles(locale),
    includeCore ? loadCoreBundles(locale) : Promise.resolve({}),
  ]);
  const { translation } = buildLocaleResources(locale, { ...core, ...rest })[locale];
  // deep + overwrite: branches already present keep their loaded content and the
  // empty placeholders from boot get filled in.
  i18nInstance.addResourceBundle(locale, "translation", translation, true, true);
  return true;
};
