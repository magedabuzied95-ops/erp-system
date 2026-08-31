/**
 * Backfill the storefront's card-fit product images.
 *
 * The grid centres the *file's* rectangle, not the product inside it, so a catalogue of studio
 * shots reads ragged: measured across a live sample the product sits up to 14% off the vertical
 * centre and fills anywhere from 43% to 75% of its own frame. `ensureCardFitImages` writes a
 * `variants/<stem>-fit{480,960}.webp` pair holding that product trimmed to its bounding box and
 * centred on a 0.92:1 canvas — the shape of the card's image plate.
 *
 * This walks every `/uploads/products/...` reference in the database (discovered from
 * information_schema, not hardcoded) and generates the pair for each. It never writes to the
 * database and never touches an original or a `-wN.webp`: those derivatives are the only
 * surviving backup of the originals, and a trimmed backup is a corrupted one.
 *
 * A photo whose backdrop is not uniform — a gradient, a lifestyle shot, a product running off
 * the edge — still gets its files, just resized rather than re-framed, so the storefront's
 * derived URL can never 404.
 *
 *   node server/scripts/generateCardFitImages.js            # report only
 *   APPLY=1 node server/scripts/generateCardFitImages.js    # write the files
 *   APPLY=1 FORCE=1 node server/scripts/generateCardFitImages.js   # rebuild existing ones
 *   LIMIT=50 node server/scripts/generateCardFitImages.js   # first 50 references only
 */
import { access, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
import db from "../database/db.js";
import { ensureCardFitImages } from "../services/productImageVariantService.js";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, "..", "..");
dotenv.config({ path: path.join(repoRoot, "server", ".env"), override: false });
dotenv.config({ path: path.join(repoRoot, ".env"), override: false });

const apply = /^(1|true|yes)$/i.test(String(process.env.APPLY || ""));
const force = /^(1|true|yes)$/i.test(String(process.env.FORCE || ""));
const limit = Math.max(0, Number(process.env.LIMIT || 0));
const VARIANT_DIR = "variants";

const uploadsRoots = [
  path.join(process.cwd(), "uploads"),
  path.join(currentDir, "..", "uploads"),
  path.join(currentDir, "..", "..", "uploads"),
];

const exists = async (filePath) => {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
};

const quote = (identifier) => `"${String(identifier).replace(/"/g, '""')}"`;

/** Every text/json column that could hold an image URL, discovered not hardcoded. */
const imageColumns = async () => {
  const { rows } = await db.query(
    `
    SELECT c.table_name, c.column_name, c.data_type
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public'
      AND t.table_type = 'BASE TABLE'
      AND c.data_type IN ('text', 'character varying', 'json', 'jsonb')
    ORDER BY c.table_name, c.column_name
    `
  );
  return rows.filter((row) => /(image|images|photo|picture|thumbnail|cover|media|url|urls)/i.test(row.column_name) || row.data_type.startsWith("json"));
};

const collectReferencedPaths = async (columns) => {
  const found = new Set();
  for (const { table_name: table, column_name: column } of columns) {
    const expression = `${quote(table)}.${quote(column)}::text`;
    let rows = [];
    try {
      ({ rows } = await db.query(
        `SELECT DISTINCT ${expression} AS value FROM ${quote(table)} WHERE ${expression} LIKE '%/uploads/products/%'`
      ));
    } catch {
      continue;
    }
    for (const row of rows) {
      const matches = String(row.value || "").match(/\/uploads\/products\/[^"'\s\\)\]},]+/g) || [];
      for (const match of matches) {
        // A variant is a generated file, never a source for another generation.
        if (match.includes(`/${VARIANT_DIR}/`)) continue;
        found.add(match);
      }
    }
  }
  return [...found].sort();
};

const resolveOnDisk = async (imagePath) => {
  const relative = imagePath.replace(/^\/uploads\//, "").replace(/\//g, path.sep);
  for (const root of uploadsRoots) {
    const candidate = path.join(root, relative);
    if (await exists(candidate)) return candidate;
  }
  return "";
};

const main = async () => {
  const columns = await imageColumns();
  const references = await collectReferencedPaths(columns);
  const targets = limit ? references.slice(0, limit) : references;

  console.log(`[card-fit] ${columns.length} candidate columns -> ${references.length} referenced product images${limit ? ` (limited to ${targets.length})` : ""}`);
  console.log(`[card-fit] mode: ${apply ? (force ? "APPLY + FORCE (rebuild)" : "APPLY") : "report only"}\n`);

  const stats = { reframed: 0, passthrough: 0, alreadyDone: 0, missing: 0, unsupported: 0, failed: 0, bytes: 0 };
  const failures = [];
  let index = 0;

  for (const reference of targets) {
    index += 1;
    const sourcePath = await resolveOnDisk(reference);
    if (!sourcePath) {
      stats.missing += 1;
      continue;
    }
    if (!apply) {
      // Report mode still classifies the work, it just does not write anything.
      stats.passthrough += 1;
      continue;
    }

    try {
      const result = await ensureCardFitImages(sourcePath, { force });
      if (result.reason === "unsupported_extension") {
        stats.unsupported += 1;
      } else if (!result.written.length) {
        stats.alreadyDone += 1;
      } else if (result.reframed) {
        stats.reframed += 1;
      } else {
        stats.passthrough += 1;
      }
      for (const written of result.written) {
        const info = await stat(written.outputPath).catch(() => null);
        if (info) stats.bytes += info.size;
      }
    } catch (error) {
      stats.failed += 1;
      failures.push({ reference, message: error?.message || String(error) });
    }

    if (index % 200 === 0) {
      console.log(`[card-fit] ${index}/${targets.length} — re-framed ${stats.reframed}, passed through ${stats.passthrough}, already had files ${stats.alreadyDone}, failed ${stats.failed}`);
    }
  }

  console.log(`\n[card-fit] done: ${targets.length} references`);
  if (apply) {
    console.log(`  re-framed (trimmed + centred): ${stats.reframed}`);
    console.log(`  passed through (backdrop not uniform): ${stats.passthrough}`);
    console.log(`  already had files: ${stats.alreadyDone}`);
    console.log(`  unsupported format: ${stats.unsupported}`);
    console.log(`  failed: ${stats.failed}`);
    console.log(`  written: ${(stats.bytes / 1024 / 1024).toFixed(1)} MB`);
  } else {
    console.log(`  would process: ${stats.passthrough}`);
    console.log(`  re-run with APPLY=1 to write the files`);
  }
  console.log(`  missing on disk (nothing to generate from): ${stats.missing}`);

  for (const failure of failures.slice(0, 20)) {
    console.log(`  FAILED ${failure.reference}: ${failure.message}`);
  }
  if (failures.length > 20) console.log(`  ...and ${failures.length - 20} more failures`);
};

main()
  .catch((error) => {
    console.error("[card-fit] fatal:", error?.message || error);
    process.exitCode = 1;
  })
  .finally(() => db.pool?.end?.().catch(() => {}));
