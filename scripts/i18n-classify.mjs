/**
 * Classifies hardcoded-string findings so the headline metric reflects genuine
 * user-visible localization DEFECTS, not raw literals.
 *
 * The hardcoded scanner is deliberately broad. This layer splits its output into
 * buckets, and only `broken` is a bug:
 *
 *   broken      single-language chrome -> the other locale renders the wrong language
 *   bilingual   file already carries parallel ar/en copy -> renders correctly today
 *   data        catalogue/business/technical values -> must never be translated
 *   prototype   preview/prototype screens, not production routes
 *   excluded    explicitly excluded with a documented reason
 *
 * Every file in `bilingual`, `data`, `prototype` and `excluded` is justified
 * here or by a rule below, so there is no unexplained residual.
 */
import fs from "node:fs";
import path from "node:path";

import { scanRepository } from "./i18n-scan.mjs";
import {
  bilingualHalfRanges,
  bilingualTernaryRanges,
  devGatedRanges,
  printDocumentRanges,
  seedDataRanges,
} from "./i18n-english-scan.mjs";

/**
 * A file is "already bilingual" when it carries parallel copy for both locales.
 * Migrating it changes no rendered text, so it is architecture debt, not a bug.
 */
const BILINGUAL_MARKERS =
  /(^\s*en:\s*\{|^\s*ar:\s*\{|labelEn:|labelAr:|isArabic\s*\?|isAr\s*\?|isRtl\s*\?|language\s*===\s*"ar"|lang\s*===\s*"ar"|locale\s*===\s*"ar")/gm;

/** Preview/prototype screens that are not reachable production routes. */
const PROTOTYPE_FILES = [
  ["src/pages/ComponentsPreview.jsx", "Component gallery, not a production route."],
  ["src/pages/ComponentsPreviewPrimitives.jsx", "Component gallery, not a production route."],
  ["src/pages/DashboardPrototype.jsx", "Superseded dashboard prototype."],
  ["src/pages/ThemeFoundation.jsx", "Design-system reference page."],
  ["src/pages/AppShellPreview.jsx", "App-shell reference page."],
];

/**
 * Files whose flagged strings are catalogue/business/technical DATA. Translating
 * them would corrupt matching against user or backend input.
 */
const DATA_FILES = [
  ["src/shared/lib/crocsSizes.js", "Footwear size tables matched against catalogue data."],
  ["src/shared/lib/categorySeo.js", "SEO slugs and category copy stored as catalogue data."],
  ["src/modules/products/lib/productClassifications.js", "Classification values matched against product records."],
];

/** Individually excluded files, each with a reason. */
const EXCLUDED_FILES = [
  ["src/shared/utils/invoicePdf.js", "Printed invoice artwork; owned by the print/thermal track."],
  ["src/modules/products/lib/barcodeLabels.js", "Thermal label artwork; owned by the print track."],
  ["src/modules/products/pages/ProductPrintList.jsx", "Print sheet artwork; owned by the print track."],
  [
    "src/modules/permissions/lib/rbacStore.js",
    "English nav labels are LOOKUP IDENTIFIERS resolved through src/i18n/navigation.js, not rendered text; tests/i18n-navigation-guard.test.js proves every one maps to a key that resolves in both locales.",
  ],
];

const toMap = (rows) => new Map(rows.map(([file, reason]) => [file, reason]));
const PROTOTYPE = toMap(PROTOTYPE_FILES);
const DATA = toMap(DATA_FILES);
const EXCLUDED = toMap(EXCLUDED_FILES);

export function classify() {
  const { results } = scanRepository();
  const buckets = { broken: [], bilingual: [], data: [], prototype: [], excluded: [] };

  for (const entry of results) {
    const reasonFor = (map) => map.get(entry.file);
    if (reasonFor(EXCLUDED)) {
      buckets.excluded.push({ ...entry, reason: EXCLUDED.get(entry.file) });
      continue;
    }
    if (reasonFor(DATA)) {
      buckets.data.push({ ...entry, reason: DATA.get(entry.file) });
      continue;
    }
    if (reasonFor(PROTOTYPE)) {
      buckets.prototype.push({ ...entry, reason: PROTOTYPE.get(entry.file) });
      continue;
    }
    /*
     * Bilingual is decided PER HIT, not per file.
     *
     * The previous rule bucketed a whole file as bilingual if it contained a
     * single bilingual marker anywhere. That hid genuinely single-language
     * chrome sitting next to bilingual code - the Expenses confirm heading was
     * found that way, and a probe showed ~516 such hits across 33 files,
     * including domains previously reported closed.
     *
     * A hit is bilingual only when it is itself part of a parallel structure:
     * inside the `ar` half of a sibling table / Object.assign pair / language
     * ternary, or on a line that carries a bilingual marker of its own.
     */
    const text = fs.readFileSync(path.resolve(entry.file), "utf8");
    const lines = text.split(/\r?\n/);
    const ranges = [
      ...bilingualHalfRanges(text, "ar"),
      ...bilingualTernaryRanges(text, "ar"),
      ...devGatedRanges(text),
      ...printDocumentRanges(text),
      ...seedDataRanges(text),
    ];
    const inRange = (line) => ranges.some(([from, to]) => line >= from && line <= to);
    const isBilingual = (hit) => {
      if (inRange(hit.line)) return true;
      const line = lines[hit.line - 1] || "";
      BILINGUAL_MARKERS.lastIndex = 0;
      return BILINGUAL_MARKERS.test(line);
    };

    const bilingualHits = entry.hits.filter(isBilingual);
    const brokenHits = entry.hits.filter((hit) => !isBilingual(hit));
    const tally = (hits) => ({
      hits,
      total: hits.length,
      arabic: hits.filter((h) => h.script === "ar").length,
      english: hits.filter((h) => h.script === "en").length,
    });

    if (bilingualHits.length) {
      buckets.bilingual.push({
        ...entry,
        ...tally(bilingualHits),
        reason: "Hits that sit inside a parallel ar/en structure.",
      });
    }
    if (brokenHits.length) buckets.broken.push({ ...entry, ...tally(brokenHits) });
  }

  return buckets;
}

const sum = (rows, key) => rows.reduce((total, row) => total + row[key], 0);

if (process.argv[1]?.endsWith("i18n-classify.mjs")) {
  const buckets = classify();
  console.log("bucket      files  total  arabic  english");
  for (const [name, rows] of Object.entries(buckets)) {
    console.log(
      `${name.padEnd(11)} ${String(rows.length).padStart(4)}  ${String(sum(rows, "total")).padStart(5)}  ${String(
        sum(rows, "arabic")
      ).padStart(6)}  ${String(sum(rows, "english")).padStart(7)}`
    );
  }
  console.log(`\nGENUINE DEFECTS: ${sum(buckets.broken, "total")} strings in ${buckets.broken.length} files\n`);
  for (const entry of buckets.broken.sort((a, b) => b.total - a.total)) {
    console.log(`  ${String(entry.total).padStart(4)}  ar${String(entry.arabic).padStart(4)} en${String(entry.english).padStart(4)}  ${entry.file}`);
  }
}
