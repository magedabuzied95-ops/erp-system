/**
 * List the products whose images are referenced but absent from the uploads
 * volume, so they can be re-photographed or re-uploaded.
 *
 * The path-level audits say which FILES are gone; this says which PRODUCTS are
 * affected, which is the form the answer is actually needed in. Read-only.
 *
 *   node server/scripts/listProductsWithMissingImages.js
 *   FORMAT=csv node server/scripts/listProductsWithMissingImages.js > missing.csv
 */
import { access } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
import db from "../database/db.js";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, "..", "..");
dotenv.config({ path: path.join(repoRoot, "server", ".env"), override: false });
dotenv.config({ path: path.join(repoRoot, ".env"), override: false });

const asCsv = String(process.env.FORMAT || "").toLowerCase() === "csv";
const uploadsRoots = [
  path.join(process.cwd(), "uploads"),
  path.join(currentDir, "..", "uploads"),
  path.join(currentDir, "..", "..", "uploads"),
];

const onDisk = async (imagePath) => {
  const relative = imagePath.replace(/^\/uploads\//, "").replace(/\//g, path.sep);
  for (const root of uploadsRoots) {
    try {
      await access(path.join(root, relative));
      return true;
    } catch {
      // try the next root
    }
  }
  return false;
};

const main = async () => {
  // Product-level and variant-level image columns, joined back to the product.
  const { rows } = await db.query(
    `
    SELECT p.id, p.name, p.product_type, p.is_active, p.is_storefront_visible, u.image_url
    FROM products p
    JOIN LATERAL (
      SELECT p.image_url AS image_url
      UNION ALL
      SELECT pv.image_url FROM product_variants pv WHERE pv.product_id = p.id AND pv.deleted_at IS NULL
      UNION ALL
      SELECT pvi.image_url FROM product_variant_images pvi
        JOIN product_variants pv2 ON pv2.id = pvi.variant_id
        WHERE pv2.product_id = p.id AND pv2.deleted_at IS NULL
    ) u ON TRUE
    WHERE u.image_url LIKE '/uploads/%'
    `
  );

  const checked = new Map();
  const affected = new Map();
  for (const row of rows) {
    if (!checked.has(row.image_url)) checked.set(row.image_url, await onDisk(row.image_url));
    if (checked.get(row.image_url)) continue;
    if (!affected.has(row.id)) {
      affected.set(row.id, { id: row.id, name: row.name, type: row.product_type || "", active: row.is_active, visible: row.is_storefront_visible, missing: new Set() });
    }
    affected.get(row.id).missing.add(row.image_url);
  }

  const list = [...affected.values()].sort((a, b) => b.missing.size - a.missing.size || Number(a.id) - Number(b.id));
  const liveList = list.filter((entry) => entry.active && entry.visible);

  if (asCsv) {
    console.log("product_id,name,product_type,active,storefront_visible,missing_images");
    for (const e of list) console.log(`${e.id},"${String(e.name).replace(/"/g, '""')}",${e.type},${e.active},${e.visible},${e.missing.size}`);
    return;
  }

  console.log(`Distinct referenced image paths: ${checked.size}`);
  console.log(`Paths with no file on disk     : ${[...checked.values()].filter((v) => !v).length}`);
  console.log(`Products affected              : ${list.length}`);
  console.log(`  of those live on the storefront: ${liveList.length}\n`);
  console.log("Live products missing images (worst first):");
  for (const e of liveList) console.log(`  ${String(e.id).padStart(5)}  ${String(e.missing.size).padStart(3)} img  ${e.name}`);
  const hidden = list.length - liveList.length;
  if (hidden) console.log(`\n(${hidden} more are inactive or hidden from the storefront — not customer-facing.)`);
};

main()
  .catch((error) => {
    console.error("Audit failed:", error?.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.end().catch(() => {});
  });
