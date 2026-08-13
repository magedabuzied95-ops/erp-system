/**
 * Runtime reachability guard.
 *
 * WHY THIS EXISTS — the 2026-08-13 production incident.
 *
 * Seven locale bundles (access, shipping, aiStudio, aiSupport, loyalty, saas,
 * attendance) existed on disk AND were registered in localeManifest.js, but were
 * never added to the module map that src/i18n/i18n.js hands to buildResources().
 * `resolveBranch` returns `{}` for a file it was not given, so those branches
 * resolved EMPTY at runtime and ~1,038 t() call sites fell through
 * `readableMissingKeyFallback` — rendering the last key segment title-cased in
 * English, in BOTH locales, e.g. t("aiStudio.hub.title") -> "Title".
 *
 * Every pre-existing guard passed, because parity, purity, missing-key and the
 * hardcoded-string ratchet all build their view of the dictionaries from the
 * manifest plus the files on DISK — precisely the side that was correct. Nothing
 * asserted that a manifest branch is actually reachable from the runtime.
 *
 * So this guard deliberately does NOT enumerate src/locales/. Doing so would
 * re-derive the dictionaries from the same source that was already right and
 * would be blind to the same bug. Instead it reconstructs the bundle map from
 * the *actual import statements and object literal in i18n.js*, and pushes that
 * through the real buildResources() + the real manifest. If a bundle is missing
 * from i18n.js, or is imported from the wrong locale directory, these tests fail.
 *
 * End-to-end proof that the built frontend can resolve these strings lives in
 * scripts/i18n-bundle-probe.mjs (`npm run i18n:probe-bundle`), which inspects
 * dist/ after a build. Source-level tests alone are what missed the incident.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const repoRoot = process.cwd();
const i18nPath = path.join(repoRoot, "src", "i18n", "i18n.js");
const i18nSource = fs.readFileSync(i18nPath, "utf8");

const manifest = await import(pathToFileURL(path.join(repoRoot, "src", "i18n", "localeManifest.js")).href);
const { SUPPORTED_LOCALES, RESOURCE_BRANCHES, buildResources } = manifest;

/**
 * Bundles that may legitimately appear in the runtime map without a manifest
 * branch of their own. Keep this empty unless a bundle is genuinely
 * infrastructure; every entry is a branch no screen can address via t().
 */
const RUNTIME_ONLY_ALLOWLIST = new Set();

/**
 * Branches that are legitimately empty: a reserved placeholder bundle that is
 * correctly wired but has no keys yet. An entry here is only tolerated while the
 * branch has ZERO t() call sites — the test below enforces that, so the moment a
 * screen starts addressing the branch the allowlist stops covering it.
 *
 * `auth` — src/locales/{ar,en}/auth.json are `{}` placeholders; login copy still
 * lives in the `common` bundle.
 */
const EMPTY_BRANCH_ALLOWLIST = new Set(["auth"]);

/* ------------------------------------------------------------------ *
 * Reconstruct the runtime bundle map from i18n.js itself.
 * ------------------------------------------------------------------ */

/** local identifier -> { locale, file }, taken from the real import statements. */
const importedIdentifiers = new Map();
for (const m of i18nSource.matchAll(
  /import\s+(\w+)\s+from\s+"\.\.\/locales\/(ar|en)\/([A-Za-z0-9_]+)\.json"/g,
)) {
  importedIdentifiers.set(m[1], { locale: m[2], file: m[3] });
}

/** Extract the balanced `{ ... }` that starts at `from`. */
const readBracedBlock = (source, from) => {
  const start = source.indexOf("{", from);
  let depth = 0;
  for (let i = start; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return { start, end: i, text: source.slice(start + 1, i) };
    }
  }
  throw new Error("unbalanced braces while parsing i18n.js");
};

const callIndex = i18nSource.indexOf("buildResources(");
assert.ok(callIndex !== -1, "i18n.js must call buildResources() — the runtime resource path changed shape");
const callArg = readBracedBlock(i18nSource, callIndex);

/**
 * locale -> Map(bundleKey -> { locale, file, identifier })
 * `locale` here is the directory the file was imported FROM, which is what makes
 * an AR bundle wired under `en:` detectable.
 */
const runtimeMap = new Map(SUPPORTED_LOCALES.map((l) => [l, new Map()]));
for (const locale of SUPPORTED_LOCALES) {
  const localeKeyIndex = callArg.text.search(new RegExp(`(^|[\\s,{])${locale}\\s*:\\s*\\{`));
  assert.ok(
    localeKeyIndex !== -1,
    `i18n.js does not pass a "${locale}:" bundle group to buildResources()`,
  );
  const block = readBracedBlock(callArg.text, localeKeyIndex);
  for (const m of block.text.matchAll(/([A-Za-z0-9_]+)\s*:\s*([A-Za-z0-9_]+)\s*,/g)) {
    const info = importedIdentifiers.get(m[2]);
    if (!info) continue; // not a locale-JSON identifier
    runtimeMap.get(locale).set(m[1], { ...info, identifier: m[2] });
  }
}

/** Guard the guard: a parser regression must fail loudly, never pass vacuously. */
test("the reachability guard can actually read the runtime map", () => {
  for (const locale of SUPPORTED_LOCALES) {
    assert.ok(
      runtimeMap.get(locale).size >= 25,
      `parsed only ${runtimeMap.get(locale).size} ${locale} bundles out of i18n.js — the parser is broken, not the wiring`,
    );
  }
});

/** Load the JSON from the path the import statement actually names. */
const readBundle = (locale, file) =>
  JSON.parse(fs.readFileSync(path.join(repoRoot, "src", "locales", locale, `${file}.json`), "utf8"));

const runtimeBundles = {};
for (const locale of SUPPORTED_LOCALES) {
  runtimeBundles[locale] = {};
  for (const [key, info] of runtimeMap.get(locale)) {
    runtimeBundles[locale][key] = readBundle(info.locale, info.file);
  }
}

/** The real resource tree, built the way the app builds it. */
const resources = buildResources(runtimeBundles);

const manifestFiles = new Set();
for (const entry of RESOURCE_BRANCHES) {
  for (const f of Array.isArray(entry.file) ? entry.file : [entry.file]) manifestFiles.add(f);
}

const lookup = (tree, keyPath) =>
  keyPath.split(".").reduce((node, seg) => (node == null ? undefined : node[seg]), tree);

/* ------------------------------------------------------------------ *
 * 1. Manifest <-> runtime parity
 * ------------------------------------------------------------------ */

test("every manifest bundle is wired into the i18n.js runtime map, in both locales", () => {
  const missing = [];
  for (const locale of SUPPORTED_LOCALES) {
    const wired = runtimeMap.get(locale);
    for (const file of manifestFiles) {
      if (!wired.has(file)) missing.push(`${locale}.${file}`);
    }
  }
  assert.deepEqual(
    missing,
    [],
    "these bundles are registered in localeManifest.js but never imported into the map i18n.js " +
      "passes to buildResources(), so their branches resolve EMPTY at runtime",
  );
});

test("no runtime bundle is wired that the manifest does not declare", () => {
  const unexpected = [];
  for (const locale of SUPPORTED_LOCALES) {
    for (const key of runtimeMap.get(locale).keys()) {
      if (!manifestFiles.has(key) && !RUNTIME_ONLY_ALLOWLIST.has(key)) unexpected.push(`${locale}.${key}`);
    }
  }
  assert.deepEqual(unexpected, [], "wired at runtime but absent from RESOURCE_BRANCHES (stale or duplicate bundle)");
});

test("each bundle is imported from the locale directory it is wired under", () => {
  const crossed = [];
  for (const locale of SUPPORTED_LOCALES) {
    for (const [key, info] of runtimeMap.get(locale)) {
      if (info.locale !== locale) crossed.push(`${locale}.${key} <- ${info.locale}/${info.file}.json (${info.identifier})`);
    }
  }
  assert.deepEqual(crossed, [], "a bundle is wired under the wrong locale — one language would serve the other's copy");
});

/* ------------------------------------------------------------------ *
 * 2. Every branch resolves non-empty through the real buildResources
 * ------------------------------------------------------------------ */

test("no manifest branch resolves to an empty object at runtime", () => {
  const empty = [];
  for (const locale of SUPPORTED_LOCALES) {
    for (const entry of RESOURCE_BRANCHES) {
      if (EMPTY_BRANCH_ALLOWLIST.has(entry.branch)) continue;
      const branch = resources[locale]?.translation?.[entry.branch];
      const size = branch && typeof branch === "object" ? Object.keys(branch).length : 0;
      if (size === 0) empty.push(`${locale}.${entry.branch}`);
    }
  }
  assert.deepEqual(
    empty,
    [],
    "an empty branch means every t() call against it renders readableMissingKeyFallback " +
      '(the last key segment, title-cased in English) — this is the exact 2026-08-13 production failure',
  );
});

test("an allowlisted empty branch has no t() call sites addressing it", () => {
  const srcDir = path.join(repoRoot, "src");
  const sources = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (/\.(jsx?|tsx?)$/.test(entry.name)) sources.push(fs.readFileSync(p, "utf8"));
    }
  };
  walk(srcDir);
  const haystack = sources.join("\n");

  const used = [];
  for (const branch of EMPTY_BRANCH_ALLOWLIST) {
    // t("branch.…"), t('branch.…'), t(`branch.…`)
    if (new RegExp(String.raw`\bt\(\s*["'\`]${branch}\.`).test(haystack)) used.push(branch);
  }
  assert.deepEqual(
    used,
    [],
    "an allowlisted-empty branch is now addressed by t() — fill its dictionary or remove it from EMPTY_BRANCH_ALLOWLIST",
  );
});

/* ------------------------------------------------------------------ *
 * 3. Dictionary-only sentinels resolve to their real values
 * ------------------------------------------------------------------ */

/**
 * Each sentinel is a real, nested, dictionary-only value: unique inside its own
 * dictionary, Arabic in ar/, Latin in en/, and different between the two. Object
 * keys existing is not enough — an empty branch, a wrong import, or a
 * cross-locale swap all have to fail here.
 *
 * `orders` is the POSITIVE CONTROL: it was correctly wired throughout the
 * incident, so if it ever fails the guard itself is wrong, not the wiring.
 */
const SENTINELS = [
  {
    branch: "access",
    key: "permissions.subtitle",
    ar: "يظل وصول المدير كاملًا افتراضيًا. اختر أي دور، وراجع مصفوفة الوحدات والإجراءات بالكامل، ثم احفظ على الخادم أو في كتالوج الاحتياط المحلي.",
    en: "Admin access stays full by default. Select any role, review the entire module/action matrix, and save back to the backend or local fallback catalog.",
  },
  {
    branch: "shipping",
    key: "center.filters.search",
    ar: "ابحث بالطلب أو العميل أو الهاتف أو التتبع...",
    en: "Search order, customer, phone, tracking...",
  },
  {
    branch: "aiStudio",
    key: "assisted.enabledNote",
    ar: "يتم توليد الاقتراحات على القنوات المفعّلة. راجعها وأرسلها من صندوق الذكاء الاصطناعي — لا شيء يُرسل بدون موظف. وصول رسالة أحدث من العميل يمنع اعتماد اقتراح منتهي الصلاحية (مفروض من الخادم).",
    en: "Suggestions are generated on enabled channels. Review and send from the AI Inbox — nothing is sent without a human. A newer customer message blocks approving a stale suggestion (server-enforced).",
  },
  {
    branch: "aiSupport",
    key: "aiSettings.masterNote",
    ar: "الإعدادات العامة هي التحكم الرئيسي. لا ترد القناة تلقائيًا إلا إذا سمح الوضع العام ووضع القناة معًا بالرد التلقائي الكامل.",
    en: "Global settings are the master control. A channel can only auto-reply when global mode and channel mode both allow fully automatic replies.",
  },
  {
    branch: "loyalty",
    key: "rules.subtitle",
    ar: "تحكّم في كسب النقاط وقيمة الاستبدال وحدود الفئات من شاشة واحدة.",
    en: "Control points earning, redemption value, and tier thresholds from a single rules screen.",
  },
  {
    branch: "saas",
    key: "register.subtitle",
    ar: "أنشئ مساحة عمل للشركة وحساب المالك وبداية الاشتراك. إذا تعذر الاتصال بالخادم، سيتم حفظ المساحة محليًا وتسجيل الدخول عليها.",
    en: "Create a company workspace, an owner account, and the start of a subscription. If the server cannot be reached, the workspace is saved locally and signed into.",
  },
  {
    branch: "attendance",
    key: "reports.tableSubtitle",
    ar: "الموظف والفرع وساعات العمل وحالة الانصراف.",
    en: "Employee, branch, worked hours, and checkout status.",
  },
  {
    branch: "orders",
    key: "returns.page.pageSubtitle",
    ar: "إدارة المرتجعات والاسترداد وإعادة المخزون من نفس تجربة تشغيل الطلبات بشكل أسرع وأكثر وضوحاً.",
    en: "Manage returns, refunds and restocking from the same order operations experience — faster and clearer.",
    control: true,
  },
];

for (const sentinel of SENTINELS) {
  const label = sentinel.control ? `${sentinel.branch} (positive control)` : sentinel.branch;

  test(`${label}: t("${sentinel.branch}.${sentinel.key}") resolves in both locales`, () => {
    for (const locale of SUPPORTED_LOCALES) {
      const branch = resources[locale]?.translation?.[sentinel.branch];
      assert.ok(branch && Object.keys(branch).length > 0, `${locale}.${sentinel.branch} branch is empty at runtime`);
      const actual = lookup(branch, sentinel.key);
      assert.equal(
        actual,
        sentinel[locale],
        `${locale}: ${sentinel.branch}.${sentinel.key} did not resolve to its dictionary value`,
      );
    }
  });

  test(`${label}: locales are not crossed at ${sentinel.key}`, () => {
    const arValue = lookup(resources.ar?.translation?.[sentinel.branch] ?? {}, sentinel.key);
    const enValue = lookup(resources.en?.translation?.[sentinel.branch] ?? {}, sentinel.key);
    assert.notEqual(arValue, enValue, "AR and EN resolved to the SAME string — one locale is serving the other's bundle");
    assert.equal(arValue, sentinel.ar);
    assert.equal(enValue, sentinel.en);
  });
}

/* ------------------------------------------------------------------ *
 * 4. The fallback that made the incident invisible
 * ------------------------------------------------------------------ */

test("an unwired bundle would render the humanised key, which is why this must be guarded", () => {
  // Reproduces resolveBranch's behaviour for a file that was never handed over,
  // and readableMissingKeyFallback's output for the resulting missing key.
  const orphan = manifest.resolveBranch({ file: "not-wired-anywhere" }, {});
  assert.deepEqual(orphan, {}, "resolveBranch silently yields {} for an unknown file — the root cause");

  const humanise = (key) =>
    String(key).split(".").pop().replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  assert.equal(humanise("aiStudio.hub.title"), "Title");
});
