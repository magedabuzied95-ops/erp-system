/**
 * Move every image still hosted on Cloudinary onto the server's uploads volume.
 *
 * The Cloudinary account is closed, so this script is also the audit that says
 * exactly which rows still depend on it. It discovers candidate columns from
 * information_schema rather than hardcoding a table list, so columns added since
 * the last migration are covered too.
 *
 * The hard rule, learned from the 2026-08-11 migration that rewrote the database
 * even for downloads that failed and stranded 139 product images: a URL is
 * rewritten ONLY after its bytes are safely on disk. Anything that cannot be
 * downloaded is reported and left pointing at Cloudinary, so it stays
 * recoverable if the account is ever reactivated.
 *
 *   node server/scripts/migrateCloudinaryImagesToLocal.js            # report only
 *   APPLY=1 node server/scripts/migrateCloudinaryImagesToLocal.js    # download + rewrite
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { Buffer } from "node:buffer";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
import db from "../database/db.js";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, "..", "..");
dotenv.config({ path: path.join(repoRoot, "server", ".env"), override: false });
dotenv.config({ path: path.join(repoRoot, ".env"), override: false });

const apply = /^(1|true|yes)$/i.test(String(process.env.APPLY || ""));
const CLOUDINARY_HOST = "res.cloudinary.com";
// Mirrors the /uploads static handler in server.js, which serves process.cwd()/uploads.
const LOCAL_SUBDIR = path.join("products", "cloudinary");
const LOCAL_DIR = path.join(process.cwd(), "uploads", LOCAL_SUBDIR);
const PUBLIC_PREFIX = "/uploads/products/cloudinary";

const IMAGE_COLUMN_PATTERN = /(image|images|photo|picture|avatar|logo|media|thumbnail|cover|asset|url|urls)/i;

/**
 * Cloudinary delivery URLs look like
 *   https://res.cloudinary.com/<cloud>/image/upload/<transforms>/<folder>/<public_id>.<ext>
 * The transform segments are optional, so the filename is derived from the tail
 * after `upload/`, with slashes flattened to keep it unique across folders.
 */
const localFilenameFor = (url) => {
  let pathname = "";
  try {
    pathname = new URL(url).pathname;
  } catch {
    return "";
  }
  const marker = "/image/upload/";
  const index = pathname.indexOf(marker);
  const tail = index >= 0 ? pathname.slice(index + marker.length) : pathname.replace(/^\/+/, "");
  const withoutVersion = tail.replace(/^v\d+\//, "");
  const flattened = withoutVersion.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!flattened) return "";
  return /\.[a-z0-9]{2,5}$/i.test(flattened) ? flattened : `${flattened}.jpg`;
};

const findCandidateColumns = async () => {
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
  return rows.filter((row) => IMAGE_COLUMN_PATTERN.test(row.column_name) || row.data_type.startsWith("json"));
};

const quote = (identifier) => `"${String(identifier).replace(/"/g, '""')}"`;

const collectUrls = async (columns) => {
  const urlsByColumn = new Map();
  const allUrls = new Set();

  for (const { table_name: table, column_name: column } of columns) {
    const expression = `${quote(table)}.${quote(column)}::text`;
    let rows = [];
    try {
      ({ rows } = await db.query(
        `SELECT DISTINCT ${expression} AS value FROM ${quote(table)} WHERE ${expression} LIKE $1`,
        [`%${CLOUDINARY_HOST}%`]
      ));
    } catch (error) {
      console.warn(`  ! skipped ${table}.${column}: ${error?.message || error}`);
      continue;
    }
    if (!rows.length) continue;

    const found = new Set();
    for (const row of rows) {
      const matches = String(row.value || "").match(
        new RegExp(`https?://${CLOUDINARY_HOST}/[^"'\\s\\\\)\\]},]+`, "gi")
      );
      for (const match of matches || []) {
        found.add(match);
        allUrls.add(match);
      }
    }
    if (found.size) {
      urlsByColumn.set(`${table}.${column}`, found);
      console.log(`  ${table}.${column}: ${found.size} distinct Cloudinary URL(s)`);
    }
  }

  return { urlsByColumn, allUrls };
};

const downloadToLocal = async (url) => {
  const filename = localFilenameFor(url);
  if (!filename) return { ok: false, reason: "unparseable_url" };

  let response = null;
  try {
    response = await fetch(url);
  } catch (error) {
    return { ok: false, reason: `fetch_failed: ${error?.message || error}` };
  }
  if (!response.ok) {
    return { ok: false, reason: `http_${response.status}` };
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length) {
    return { ok: false, reason: "empty_body" };
  }

  await mkdir(LOCAL_DIR, { recursive: true });
  await writeFile(path.join(LOCAL_DIR, filename), buffer);
  return { ok: true, localUrl: `${PUBLIC_PREFIX}/${filename}`, bytes: buffer.length };
};

const rewriteColumn = async ({ table, column, dataType, url, localUrl }) => {
  const isJson = dataType.startsWith("json");
  const target = quote(column);
  const sql = isJson
    ? `UPDATE ${quote(table)} SET ${target} = REPLACE(${target}::text, $1, $2)::${dataType} WHERE ${target}::text LIKE $3`
    : `UPDATE ${quote(table)} SET ${target} = REPLACE(${target}, $1, $2) WHERE ${target} LIKE $3`;
  const { rowCount } = await db.query(sql, [url, localUrl, `%${url}%`]);
  return rowCount;
};

const main = async () => {
  console.log(apply ? "Mode: APPLY (downloads and rewrites)" : "Mode: REPORT ONLY (pass APPLY=1 to write)");
  console.log(`Local target: ${LOCAL_DIR}\n`);

  const columns = await findCandidateColumns();
  console.log(`Scanning ${columns.length} candidate column(s) for ${CLOUDINARY_HOST} references...`);
  const { urlsByColumn, allUrls } = await collectUrls(columns);

  if (!allUrls.size) {
    console.log("\nNothing left on Cloudinary. Every image URL already points at the server.");
    return;
  }

  console.log(`\n${allUrls.size} distinct Cloudinary URL(s) across ${urlsByColumn.size} column(s).`);
  if (!apply) {
    for (const url of allUrls) console.log(`  ${url}`);
    console.log("\nReport only — nothing downloaded, nothing changed. Re-run with APPLY=1 to migrate.");
    return;
  }

  const downloaded = new Map();
  const failed = new Map();
  for (const url of allUrls) {
    const result = await downloadToLocal(url);
    if (result.ok) {
      downloaded.set(url, result.localUrl);
      console.log(`  ok   ${url} -> ${result.localUrl} (${result.bytes} bytes)`);
    } else {
      failed.set(url, result.reason);
      console.log(`  FAIL ${url} (${result.reason})`);
    }
  }

  // Only URLs whose bytes are on disk get rewritten; failures stay on Cloudinary.
  let rewritten = 0;
  const columnTypes = new Map(columns.map((row) => [`${row.table_name}.${row.column_name}`, row.data_type]));
  for (const [key, urls] of urlsByColumn) {
    const [table, column] = key.split(".");
    const dataType = columnTypes.get(key) || "text";
    for (const url of urls) {
      const localUrl = downloaded.get(url);
      if (!localUrl) continue;
      rewritten += await rewriteColumn({ table, column, dataType, url, localUrl });
    }
  }

  console.log(`\nDownloaded ${downloaded.size}/${allUrls.size}. Rows rewritten: ${rewritten}.`);
  if (failed.size) {
    console.log(`\n${failed.size} URL(s) could NOT be downloaded and were left untouched:`);
    for (const [url, reason] of failed) console.log(`  ${reason.padEnd(28)} ${url}`);
    console.log("\nThese rows still point at Cloudinary. Re-run this script if the account is reactivated.");
  }
};

main()
  .catch((error) => {
    console.error("Migration failed:", error?.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.end().catch(() => {});
  });
