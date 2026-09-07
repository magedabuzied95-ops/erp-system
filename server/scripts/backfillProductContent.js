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
 * On the VPS, detached with a log:
 *   docker exec -d erp-backend sh -c "node server/scripts/backfillProductContent.js >> /app/uploads/ai-content-backfill.log 2>&1"
 *   tail -f /opt/erp/uploads/ai-content-backfill.log
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import db from "../database/db.js";
import {
  generateProductDescription,
  generateProductSeoMetadata,
  resolveTextProvider,
} from "../services/openaiProductDescriptionService.js";

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name, fallback = "") => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] && !args[index + 1].startsWith("--") ? args[index + 1] : fallback;
};

const DRY_RUN = flag("dry-run");
const ONLY_MISSING = flag("only-missing");
const RESTORE = flag("restore");
const LIMIT = Number(option("limit", "0")) || 0;
const IDS = option("ids", "").split(",").map((value) => Number(value.trim())).filter((value) => Number.isFinite(value) && value > 0);
const TENANT_ID = Number(option("tenant", process.env.STOREFRONT_TENANT_ID || "1")) || 1;
const PACE_MS = Number(option("pace-ms", "2000")) || 0;
const MAX_ATTEMPTS = 6;
const TONES = ["premium", "friendly", "sales", "luxury", "sport"];
const RATE_LIMIT_SLEEP_MS = 65_000;
const STATE_FILE =
  option("state-file", "") ||
  process.env.BACKFILL_STATE_FILE ||
  (fs.existsSync("/app/uploads") ? "/app/uploads/ai-content-backfill.json" : path.resolve(".ai-content-backfill.json"));

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
  brand: text(row.brand_name || row.brand),
  category: text(row.category_name || row.category),
  product_type: text(row.product_type),
  gender: text(row.gender || row.variant_audience),
  grade: text(row.grade),
  colors: (row.colors || []).map(text).filter(Boolean),
  sizes: sortSizes((row.sizes || []).map(text).filter(Boolean)),
});

const isRateLimit = (result) => /429|rate limit|rate_limit|too many|tokens per/i.test(String(result?.error || ""));

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
    await db.query(
      `UPDATE products SET description = $2, description_ar = $3, description_en = $4, meta_title = $5, seo_description = $6, seo_keywords = $7, updated_at = NOW() WHERE id = $1`,
      [Number(id), old.description, old.description_ar, old.description_en, old.meta_title, old.seo_description, old.seo_keywords]
    );
    log(`  restored #${id}`);
  }
};

const main = async () => {
  const provider = resolveTextProvider();
  const state = loadState();
  if (RESTORE) {
    await restore(state);
    return;
  }
  if (provider.kind === "none") {
    console.error("No text provider configured (AI_TEXT_PROVIDER). Refusing to overwrite products with templates.");
    process.exit(1);
  }
  const products = await loadProducts();
  const todo = products.filter((row) => !state.done[row.id] || IDS.length);
  log(`provider ${provider.label} ${provider.model}; ${products.length} product(s) selected, ${todo.length} to do${DRY_RUN ? " (dry run)" : ""}; state ${STATE_FILE}`);

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
    const description = await askModel("description", () =>
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
    log(`  AR: ${next.description_ar.slice(0, 90)}…`);
    log(`  title: ${next.meta_title} | slug unchanged`);

    if (!DRY_RUN) {
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
      state.done[row.id] = { at: new Date().toISOString(), source: `${description.source}/${seo.source}` };
      delete state.pending[row.id];
      saveState(state);
    }
    written += 1;
    if (PACE_MS && index < todo.length - 1) await sleep(PACE_MS);
  }
  log(`finished: ${written} written, ${pending} pending, ${Object.keys(state.done).length} done in total`);
};

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("[backfill] failed", error);
    process.exit(1);
  });
