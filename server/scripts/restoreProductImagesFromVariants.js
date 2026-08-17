/**
 * Rebuild missing product image originals from the resized variants beside them.
 *
 * Some originals under /uploads/products are gone while their generated variants
 * (`variants/<stem>-w96|240|480|960.webp`) survived — the variants live in a
 * separate directory, so whatever removed the originals passed them over. The
 * largest surviving variant is a usable image, so the product stops showing a
 * broken frame even though the full-resolution file is unrecoverable.
 *
 * A restored file is always written as .webp because that is what the variants
 * are, so the stored URL usually changes extension (…/x.jpg -> …/x.webp). The
 * database is rewritten only after the bytes are safely on disk, and only for
 * URLs that actually changed.
 *
 * This does NOT recover an image that has no variant — nothing local remains of
 * those.
 *
 *   node server/scripts/restoreProductImagesFromVariants.js           # report
 *   APPLY=1 node server/scripts/restoreProductImagesFromVariants.js   # restore
 */
import { access, copyFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
import db from "../database/db.js";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, "..", "..");
dotenv.config({ path: path.join(repoRoot, "server", ".env"), override: false });
dotenv.config({ path: path.join(repoRoot, ".env"), override: false });

const apply = /^(1|true|yes)$/i.test(String(process.env.APPLY || ""));
// Widest first: the biggest surviving variant is the best available original.
const VARIANT_WIDTHS = [960, 480, 240, 96];
const VARIANT_DIR = "variants";

const uploadsRoots = [
  path.join(process.cwd(), "uploads"),
  path.join(currentDir, "..", "uploads"),
  path.join(currentDir, "..", "..", "uploads"),
];

const text = (value) => String(value ?? "").trim();

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
  const found = new Map(); // path -> [{table, column, dataType}]
  for (const { table_name: table, column_name: column, data_type: dataType } of columns) {
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
        // A variant reference is already a working file; only originals matter here.
        if (match.includes(`/${VARIANT_DIR}/`)) continue;
        if (!found.has(match)) found.set(match, []);
        found.get(match).push({ table, column, dataType });
      }
    }
  }
  return found;
};

const resolveOnDisk = async (relativeFromUploads) => {
  for (const root of uploadsRoots) {
    const candidate = path.join(root, relativeFromUploads.replace(/\//g, path.sep));
    if (await exists(candidate)) return candidate;
  }
  return "";
};

/** The widest surviving variant for an original, or "" when none was generated. */
const bestVariantFor = async (imagePath) => {
  const relative = imagePath.replace(/^\/uploads\//, "");
  const dir = path.posix.dirname(relative);
  const stem = path.posix.basename(relative).replace(/\.[a-z0-9]+$/i, "");
  for (const width of VARIANT_WIDTHS) {
    const variantRelative = `${dir}/${VARIANT_DIR}/${stem}-w${width}.webp`;
    const onDisk = await resolveOnDisk(variantRelative);
    if (onDisk) return { path: onDisk, width, relative: variantRelative };
  }
  return null;
};

const rewriteReferences = async (sites, fromUrl, toUrl) => {
  let rows = 0;
  const seen = new Set();
  for (const { table, column, dataType } of sites) {
    const key = `${table}.${column}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const target = quote(column);
    const isJson = dataType.startsWith("json");
    const sql = isJson
      ? `UPDATE ${quote(table)} SET ${target} = REPLACE(${target}::text, $1, $2)::${dataType} WHERE ${target}::text LIKE $3`
      : `UPDATE ${quote(table)} SET ${target} = REPLACE(${target}, $1, $2) WHERE ${target} LIKE $3`;
    const { rowCount } = await db.query(sql, [fromUrl, toUrl, `%${fromUrl}%`]);
    rows += rowCount;
  }
  return rows;
};

const main = async () => {
  console.log(apply ? "Mode: APPLY (restores files and rewrites URLs)" : "Mode: REPORT ONLY (pass APPLY=1 to write)");

  const columns = await imageColumns();
  const referenced = await collectReferencedPaths(columns);
  console.log(`Scanned ${columns.length} column(s); ${referenced.size} distinct /uploads/products path(s) referenced.\n`);

  const restorable = [];
  const unrecoverable = [];
  for (const [imagePath, sites] of referenced) {
    if (await resolveOnDisk(imagePath.replace(/^\/uploads\//, ""))) continue;
    const variant = await bestVariantFor(imagePath);
    if (variant) restorable.push({ imagePath, sites, variant });
    else unrecoverable.push(imagePath);
  }

  console.log(`Missing originals: ${restorable.length + unrecoverable.length}`);
  console.log(`  restorable from a variant : ${restorable.length}`);
  console.log(`  nothing local survives    : ${unrecoverable.length}\n`);

  if (!apply) {
    for (const entry of restorable) console.log(`  CAN RESTORE  ${entry.imagePath}  <- w${entry.variant.width}`);
    for (const imagePath of unrecoverable) console.log(`  NO SOURCE    ${imagePath}`);
    console.log("\nReport only — nothing written. Re-run with APPLY=1 to restore.");
    return;
  }

  let restored = 0;
  let rewritten = 0;
  for (const { imagePath, sites, variant } of restorable) {
    const relative = imagePath.replace(/^\/uploads\//, "");
    const dir = path.posix.dirname(relative);
    const stem = path.posix.basename(relative).replace(/\.[a-z0-9]+$/i, "");
    const restoredRelative = `${dir}/${stem}.webp`;
    const restoredUrl = `/uploads/${restoredRelative}`;
    const destination = path.join(uploadsRoots[0], restoredRelative.replace(/\//g, path.sep));

    try {
      await copyFile(variant.path, destination);
      const written = await stat(destination);
      restored += 1;
      // Only touch the database once the bytes are on disk.
      if (restoredUrl !== imagePath) rewritten += await rewriteReferences(sites, imagePath, restoredUrl);
      console.log(`  OK  ${imagePath} -> ${restoredUrl} (w${variant.width}, ${written.size} bytes)`);
    } catch (error) {
      console.log(`  FAILED ${imagePath} — ${error?.message || error}`);
    }
  }

  console.log(`\n[done] restored=${restored} db_rows_rewritten=${rewritten} still_missing=${unrecoverable.length}`);
  if (unrecoverable.length) {
    console.log("\nThese have no variant and no original left locally:");
    for (const imagePath of unrecoverable) console.log(`  ${imagePath}`);
  }
};

main()
  .catch((error) => {
    console.error("Restore failed:", error?.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.end().catch(() => {});
  });
