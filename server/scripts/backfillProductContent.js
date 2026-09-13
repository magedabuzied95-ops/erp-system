/* Regenerates the customer-facing content of every storefront product with the
 * configured text provider: Arabic + English description, search title, search
 * description and keywords. Slugs are never touched (they are indexed URLs).
 *
 * Resumable and honest about rate limits: a product is written only when the
 * model actually answered; a rate-limited or timed-out product is retried,
 * then left pending for the next run. Progress and the previous values of
 * every rewritten product are kept in a JSON file on the uploads volume so the
 * run survives a container restart and can be undone.
 *
 *   node server/scripts/backfillProductContent.js --dry-run --limit 3
 *   node server/scripts/backfillProductContent.js                # everything
 *   node server/scripts/backfillProductContent.js --only-missing # empty fields only
 *   node server/scripts/backfillProductContent.js --ids 774,25
 *   node server/scripts/backfillProductContent.js --restore      # put the old values back
 *
 * Search metadata only (the descriptions stay exactly as the merchant wrote
 * them), for products whose SEO was never generated. Products saved before the
 * SEO workbench are NOT empty: the save path stored the product name as the
 * search title and the description as the search description, so "stale" also
 * means title = name, description = the product copy, or no keywords.
 *   node server/scripts/backfillProductContent.js --seo-only --stale-seo --dry-run --limit 3
 *   node server/scripts/backfillProductContent.js --seo-only --stale-seo
 *   node server/scripts/backfillProductContent.js --seo-only --restore  # undo only the SEO run
 *
 * On the VPS, detached with a log:
 *   docker exec -d erp-backend sh -c "node server/scripts/backfillProductContent.js >> /app/uploads/ai-content-v2-backfill.log 2>&1"
 *   tail -f /opt/erp/uploads/ai-content-v2-backfill.log
 *
 * Descriptions are structured page copy (headline, intro, features, why, ideal
 * for) with no colours or sizes; the v2 state file starts every product over.
 *
 * Whole catalogue in minutes, no model: --template writes the same structure
 * from the brand reference (and template search metadata where the old one is
 * stale) to every product the model run has not finished yet. The model run
 * then upgrades them one by one. To undo everything run --restore, then
 * --template --restore (that one holds the values from before both runs).
 *   node server/scripts/backfillProductContent.js --template --dry-run --limit 3
 *   node server/scripts/backfillProductContent.js --template
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import db from "../database/db.js";
import {
  buildSeoFallback,
  cleanModelName,
  fallbackStructuredSections,
  generateProductDescription,
  generateProductSeoMetadata,
  localizeSeoColor,
  resolveTextProvider,
} from "../services/openaiProductDescriptionService.js";
import { composeProductDescription } from "../../src/shared/lib/productDescriptionFormat.js";

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name, fallback = "") => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] && !args[index + 1].startsWith("--") ? args[index + 1] : fallback;
};

const DRY_RUN = flag("dry-run");
const ONLY_MISSING = flag("only-missing");
const RESTORE = flag("restore");
const SEO_ONLY = flag("seo-only");
const STALE_SEO = flag("stale-seo");
const TEMPLATE = flag("template");
// For a scheduler: exit silently when another run is going or nothing is left.
const IF_UNFINISHED = flag("if-unfinished");
// Rewrite products this state file already finished; the backups stay the
// values from before the first run.
const REDO = flag("redo");
const LIMIT = Number(option("limit", "0")) || 0;
const IDS = option("ids", "").split(",").map((value) => Number(value.trim())).filter((value) => Number.isFinite(value) && value > 0);
const TENANT_ID = Number(option("tenant", process.env.STOREFRONT_TENANT_ID || "1")) || 1;
const PACE_MS = Number(option("pace-ms", TEMPLATE ? "0" : "2000")) || 0;
const MAX_ATTEMPTS = 6;
const TONES = ["premium", "friendly", "sales", "luxury", "sport"];
const RATE_LIMIT_SLEEP_MS = 65_000;
const stateFileFor = (name) => (fs.existsSync("/app/uploads") ? `/app/uploads/ai-${name}-backfill.json` : path.resolve(`.ai-${name}-backfill.json`));
// The template run and the model run keep separate progress: a product the
// template wrote is still to do for the model.
const MODEL_STATE_FILE = stateFileFor("content-v2");
const TEMPLATE_STATE_FILE = stateFileFor("content-template");
const STATE_FILE =
  option("state-file", "") ||
  process.env.BACKFILL_STATE_FILE ||
  // A SEO-only run keeps its own progress: products finished by a full run
  // must not count as done, and its backups must not restore descriptions.
  (SEO_ONLY ? stateFileFor("seo") : TEMPLATE ? TEMPLATE_STATE_FILE : MODEL_STATE_FILE);

const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
};

const PLACEHOLDER_BRAND = /^(unbranded|no[\s-]?brand|generic|none|n\/?a|-+)$/i;
// The old add-product template glued brand + name + grade + type into the
// title ("SKECHERS Skechers Slip ins imported_from_vietnam sneakers").
const JUNK_TITLE = /_|unbranded|\blocal\b/i;
const isStaleSeo = (row) => {
  const title = String(row.meta_title ?? "").trim();
  const meta = String(row.seo_description ?? "").trim();
  return (
    !title ||
    JUNK_TITLE.test(title) ||
    title.toLowerCase() === String(row.name ?? "").trim().toLowerCase() ||
    !String(row.seo_keywords ?? "").trim() ||
    !meta ||
    [row.description, row.description_ar, row.description_en].map((value) => String(value ?? "").trim()).includes(meta)
  );
};

const text = (value = "") => String(value ?? "").trim();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const stamp = () => new Date().toISOString().slice(11, 19);
const log = (...parts) => console.log(`[${stamp()}]`, ...parts);

const loadState = () => {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return { started_at: new Date().toISOString(), done: {}, pending: {}, backups: {} };
  }
};
const saveState = (state) => {
  state.updated_at = new Date().toISOString();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
};

const loadProducts = async () => {
  const where = [
    "p.tenant_id = $1",
    "p.is_active IS DISTINCT FROM FALSE",
    "COALESCE(NULLIF(LOWER(TRIM(p.status)), ''), 'active') NOT IN ('inactive', 'disabled', 'archived', 'deleted', 'draft')",
    "COALESCE(p.is_storefront_visible, TRUE) = TRUE",
  ];
  const params = [TENANT_ID];
  if (IDS.length) {
    params.push(IDS);
    where.push(`p.id = ANY($${params.length}::bigint[])`);
  }
  if (STALE_SEO) {
    where.push(`(
      COALESCE(TRIM(p.meta_title), '') = ''
      OR LOWER(TRIM(p.meta_title)) = LOWER(TRIM(p.name))
      OR p.meta_title ~* '(_|unbranded|\mlocal\M)'
      OR COALESCE(TRIM(p.seo_keywords), '') = ''
      OR COALESCE(TRIM(p.seo_description), '') = ''
      OR TRIM(p.seo_description) IN (TRIM(COALESCE(p.description, '')), TRIM(COALESCE(p.description_ar, '')), TRIM(COALESCE(p.description_en, '')))
    )`);
  }
  if (ONLY_MISSING) {
    where.push("(COALESCE(TRIM(p.description_ar), '') = '' OR COALESCE(TRIM(p.description_en), '') = '' OR COALESCE(TRIM(p.meta_title), '') = '' OR COALESCE(TRIM(p.seo_description), '') = '')");
  }
  const result = await db.query(
    `
      SELECT
        p.id, p.name, p.brand, b.name AS brand_name, p.category, c.name AS category_name,
        p.product_type, p.gender, p.grade,
        p.description, p.description_ar, p.description_en, p.meta_title, p.seo_description, p.seo_keywords,
        COALESCE((
          SELECT array_agg(DISTINCT TRIM(v.color)) FROM product_variants v
          WHERE v.product_id = p.id AND COALESCE(TRIM(v.color), '') <> '' AND v.is_active IS DISTINCT FROM FALSE
        ), '{}') AS colors,
        COALESCE((
          SELECT array_agg(DISTINCT TRIM(v.size)) FROM product_variants v
          WHERE v.product_id = p.id AND COALESCE(TRIM(v.size), '') <> '' AND v.is_active IS DISTINCT FROM FALSE
        ), '{}') AS sizes,
        (SELECT v.audience FROM product_variants v WHERE v.product_id = p.id AND COALESCE(TRIM(v.audience), '') <> '' LIMIT 1) AS variant_audience
      FROM products p
      LEFT JOIN brands b ON b.id = p.brand_id
      LEFT JOIN categories c ON c.id = p.category_id
      WHERE ${where.join(" AND ")}
      ORDER BY p.id ASC
      ${LIMIT ? `LIMIT ${LIMIT}` : ""}
    `,
    params
  );
  return result.rows;
};

const sortSizes = (sizes = []) => {
  const numeric = sizes.every((size) => /^\d+(\.\d+)?$/.test(size));
  return numeric ? [...sizes].sort((a, b) => Number(a) - Number(b)) : sizes;
};

const contextFor = (row) => ({
  product_name: text(row.name),
  brand: PLACEHOLDER_BRAND.test(text(row.brand_name || row.brand)) ? "" : text(row.brand_name || row.brand),
  category: text(row.category_name || row.category),
  product_type: text(row.product_type),
  gender: text(row.gender || row.variant_audience),
  grade: text(row.grade),
  colors: (row.colors || []).map(text).filter(Boolean),
  sizes: sortSizes((row.sizes || []).map(text).filter(Boolean)),
});

const isRateLimit = (result) => Number(result?.error_status) === 429 || /429|rate limit|rate_limit|too many|tokens per/i.test(String(result?.error || ""));

/* Ask until the model answers, waiting out per-minute windows; null when the
 * product should stay pending for a later run. */
const askModel = async (label, run) => {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const result = await run();
    if (result?.source && result.source !== "LOCAL_FALLBACK") return result;
    const reason = result?.error || "no answer";
    if (isRateLimit(result)) {
      log(`  ${label}: rate limited (${attempt}/${MAX_ATTEMPTS}), sleeping ${RATE_LIMIT_SLEEP_MS / 1000}s`);
      await sleep(RATE_LIMIT_SLEEP_MS);
      continue;
    }
    if (attempt < 3) {
      log(`  ${label}: ${reason} (${attempt}/${MAX_ATTEMPTS}), retrying`);
      await sleep(5_000);
      continue;
    }
    log(`  ${label}: giving up for now (${reason})`);
    return null;
  }
  return null;
};

const restore = async (state) => {
  const entries = Object.entries(state.backups || {});
  log(`restoring ${entries.length} product(s) from ${STATE_FILE}`);
  for (const [id, old] of entries) {
    if (DRY_RUN) {
      log(`  would restore #${id}`);
      continue;
    }
    if (state.mode === "seo") {
      await db.query(
        `UPDATE products SET meta_title = $2, seo_description = $3, seo_keywords = $4, updated_at = NOW() WHERE id = $1`,
        [Number(id), old.meta_title, old.seo_description, old.seo_keywords]
      );
      log(`  restored #${id} (search metadata)`);
      continue;
    }
    await db.query(
      `UPDATE products SET description = $2, description_ar = $3, description_en = $4, meta_title = $5, seo_description = $6, seo_keywords = $7, updated_at = NOW() WHERE id = $1`,
      [Number(id), old.description, old.description_ar, old.description_en, old.meta_title, old.seo_description, old.seo_keywords]
    );
    log(`  restored #${id}`);
  }
};

/* Two writing runs on one state file double the token spend, fight over the
 * per-minute window and overwrite each other's progress. The second one exits. */
const LOCK_FILE = `${STATE_FILE}.lock`;
const acquireLock = () => {
  try {
    const pid = Number(fs.readFileSync(LOCK_FILE, "utf8"));
    // The lock sits on the uploads volume and outlives a container restart,
    // where pids start over: only a live process that IS a backfill counts.
    const isBackfill = (() => {
      try {
        return fs.readFileSync(`/proc/${pid}/cmdline`, "utf8").includes("backfillProductContent");
      } catch {
        return !fs.existsSync("/proc");
      }
    })();
    if (pid && pid !== process.pid && isBackfill) {
      process.kill(pid, 0);
      if (IF_UNFINISHED) process.exit(0);
      console.error(`Another backfill (pid ${pid}) is already using ${STATE_FILE}. Stop it first or wait for it to finish.`);
      process.exit(1);
    }
  } catch (error) {
    if (error?.code === "EPERM") process.exit(1);
    // no lock file, or its process is gone
  }
  fs.writeFileSync(LOCK_FILE, String(process.pid));
  const release = () => {
    try {
      if (Number(fs.readFileSync(LOCK_FILE, "utf8")) === process.pid) fs.unlinkSync(LOCK_FILE);
    } catch {
      // already gone
    }
  };
  process.on("exit", release);
  ["SIGINT", "SIGTERM"].forEach((signal) => process.on(signal, () => process.exit(130)));
};

const main = async () => {
  // Wait out per-minute windows inside each request instead of failing the product.
  process.env.AI_TEXT_RATE_LIMIT_WAITS = process.env.AI_TEXT_RATE_LIMIT_WAITS || "6";
  const provider = resolveTextProvider();
  if (!DRY_RUN) acquireLock();
  const state = loadState();
  if (RESTORE) {
    await restore(state);
    return;
  }
  if (provider.kind === "none" && !TEMPLATE) {
    console.error("No text provider configured (AI_TEXT_PROVIDER). Refusing to overwrite products with templates.");
    process.exit(1);
  }
  const products = await loadProducts();
  const modelDone = () => (TEMPLATE ? readJson(MODEL_STATE_FILE).done || {} : {});
  const alreadyModelWritten = modelDone();
  const todo = products.filter((row) => (!state.done[row.id] || IDS.length || REDO) && !alreadyModelWritten[row.id]);
  // The model run's backup of a product the template already rewrote must be
  // the value from before the template, or --restore would bring back the template.
  const templateBackups = TEMPLATE ? {} : readJson(TEMPLATE_STATE_FILE).backups || {};
  if (IF_UNFINISHED && !todo.length) return;
  log(`${TEMPLATE ? "template (no model)" : `provider ${provider.label} ${provider.model}`}; ${products.length} product(s) selected, ${todo.length} to do${DRY_RUN ? " (dry run)" : ""}; state ${STATE_FILE}`);

  // Two listings called just "Adidas" must not share one search title: Google
  // folds duplicate titles together. Titles already live on products outside
  // this run count as taken.
  const titleKey = (value = "") => text(value).toLowerCase().replace(/\s+/g, " ");
  const selectedIds = products.map((row) => row.id);
  const takenTitles = new Set(
    (
      await db.query(
        `SELECT meta_title FROM products WHERE tenant_id = $1 AND COALESCE(TRIM(meta_title), '') <> '' AND NOT (id = ANY($2::bigint[]))`,
        [TENANT_ID, selectedIds]
      )
    ).rows.map((row) => titleKey(row.meta_title))
  );
  const distinctTitle = (title, context) => {
    if (!takenTitles.has(titleKey(title))) return title;
    const colours = [...new Set(context.colors.map(localizeSeoColor).filter(Boolean))];
    for (let count = 1; count <= Math.min(3, colours.length); count += 1) {
      const candidate = `${title} ${colours.slice(0, count).join(" ")}`;
      if (candidate.length <= 70 && !takenTitles.has(titleKey(candidate))) return candidate;
    }
    return title;
  };

  let written = 0;
  let pending = 0;
  for (const [index, row] of todo.entries()) {
    const context = contextFor(row);
    log(`#${row.id} (${index + 1}/${todo.length}) ${context.product_name} — ${[context.product_type, context.gender, context.brand].filter(Boolean).join(" / ")}`);
    if (!context.product_name) {
      log("  skipped: no name");
      continue;
    }

    // Rotate the house tone per product so six hundred listings do not open
    // with the same sentence.
    const tone = TONES[row.id % TONES.length];
    if (TEMPLATE) {
      // The model run may have finished this product since the list was read.
      if (modelDone()[row.id]) {
        log("  skipped: already written by the model run");
        continue;
      }
      const audience = /women|female|woman|حريم|نسائ|ستات/i.test(context.gender) ? "women" : "";
      const next = {
        description_ar: composeProductDescription(fallbackStructuredSections(context, "ar"), "ar", { audience }),
        description_en: composeProductDescription(fallbackStructuredSections(context, "en"), "en", { audience }),
      };
      next.description = next.description_en || next.description_ar;
      if (isStaleSeo(row)) {
        const seo = buildSeoFallback({ ...context, product_name: cleanModelName(context.product_name) });
        next.meta_title = distinctTitle(text(seo.meta_title), context);
        next.seo_description = text(seo.meta_description);
        next.seo_keywords = (seo.keywords || []).map(text).filter(Boolean).join(", ");
      } else {
        next.meta_title = text(row.meta_title);
        next.seo_description = text(row.seo_description);
        next.seo_keywords = text(row.seo_keywords);
      }
      takenTitles.add(titleKey(next.meta_title));
      if (DRY_RUN) log(`  AR:\n${next.description_ar}\n  title: ${next.meta_title}`);
      else {
        state.backups[row.id] = state.backups[row.id] || {
          description: row.description,
          description_ar: row.description_ar,
          description_en: row.description_en,
          meta_title: row.meta_title,
          seo_description: row.seo_description,
          seo_keywords: row.seo_keywords,
        };
        await db.query(
          `UPDATE products SET description = $2, description_ar = $3, description_en = $4, meta_title = $5, seo_description = $6, seo_keywords = $7, updated_at = NOW() WHERE id = $1`,
          [row.id, next.description, next.description_ar, next.description_en, next.meta_title, next.seo_description, next.seo_keywords]
        );
        state.done[row.id] = { at: new Date().toISOString(), source: "TEMPLATE" };
        if (index % 25 === 0 || index === todo.length - 1) saveState(state);
      }
      written += 1;
      continue;
    }
    const description = SEO_ONLY
      ? { arabic_description: text(row.description_ar), english_description: text(row.description_en || row.description), source: "KEPT" }
      : await askModel("description", () =>
          generateProductDescription({ target: "all", prompt_customization: tone, current: { ...context, name: context.product_name, selling_vibe: tone } })
        );
    const seo = description
      ? await askModel("seo", () => generateProductSeoMetadata({ current: { ...context, name: context.product_name, description_ar: description.arabic_description, description_en: description.english_description } }))
      : null;

    if (!description || !seo) {
      state.pending[row.id] = { name: context.product_name, at: new Date().toISOString() };
      saveState(state);
      pending += 1;
      continue;
    }

    const next = {
      description_ar: text(description.arabic_description),
      description_en: text(description.english_description),
      meta_title: text(seo.meta_title),
      seo_description: text(seo.meta_description),
      seo_keywords: (seo.keywords || []).map(text).filter(Boolean).join(", "),
    };
    next.description = next.description_en || next.description_ar;
    if (!next.meta_title) {
      log("  seo: model returned no title, left pending");
      state.pending[row.id] = { name: context.product_name, at: new Date().toISOString() };
      if (!DRY_RUN) saveState(state);
      pending += 1;
      continue;
    }
    const uniqueTitle = distinctTitle(next.meta_title, context);
    if (takenTitles.has(titleKey(uniqueTitle))) log(`  warning: title still shared with another product`);
    next.meta_title = uniqueTitle;
    takenTitles.add(titleKey(uniqueTitle));
    if (!SEO_ONLY) log(DRY_RUN ? `  AR:
${next.description_ar}
  EN:
${next.description_en}` : `  AR: ${next.description_ar.slice(0, 90)}…`);
    log(`  title: ${next.meta_title} | slug unchanged`);
    if (SEO_ONLY) log(`  meta: ${next.seo_description}\n    keywords: ${next.seo_keywords}`);

    if (!DRY_RUN && SEO_ONLY) {
      state.mode = "seo";
      state.backups[row.id] = state.backups[row.id] || {
        meta_title: row.meta_title,
        seo_description: row.seo_description,
        seo_keywords: row.seo_keywords,
      };
      await db.query(
        `UPDATE products SET meta_title = $2, seo_description = $3, seo_keywords = $4, updated_at = NOW() WHERE id = $1`,
        [row.id, next.meta_title, next.seo_description, next.seo_keywords]
      );
      state.done[row.id] = { at: new Date().toISOString(), source: seo.source };
      delete state.pending[row.id];
      saveState(state);
    } else if (!DRY_RUN) {
      state.backups[row.id] = state.backups[row.id] || templateBackups[row.id] || {
        description: row.description,
        description_ar: row.description_ar,
        description_en: row.description_en,
        meta_title: row.meta_title,
        seo_description: row.seo_description,
        seo_keywords: row.seo_keywords,
      };
      await db.query(
        `UPDATE products SET description = $2, description_ar = $3, description_en = $4, meta_title = $5, seo_description = $6, seo_keywords = $7, updated_at = NOW() WHERE id = $1`,
        [row.id, next.description, next.description_ar, next.description_en, next.meta_title, next.seo_description, next.seo_keywords]
      );
      state.done[row.id] = { at: new Date().toISOString(), source: `${description.source}/${seo.source}` };
      delete state.pending[row.id];
      saveState(state);
    }
    written += 1;
    if (PACE_MS && index < todo.length - 1) await sleep(PACE_MS);
  }
  log(`finished: ${written} ${DRY_RUN ? "would be written (dry run, nothing saved)" : "written"}, ${pending} pending, ${Object.keys(state.done).length} done in total`);
};

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("[backfill] failed", error);
    process.exit(1);
  });
