/**
 * Re-download product images whose DB path points at a file that is not on disk.
 *
 * Background: the 2026-08-11 Cloudinary -> local migration rewrote every product
 * image URL to /uploads/products/cloudinary/<public_id>.<ext>, but 139 downloads
 * failed and the DB was rewritten anyway. Those rows now 404. The originals are
 * still Cloudinary assets under `erp/products/`, so once the Cloudinary account
 * is active again this script pulls them back down into the uploads volume.
 *
 * The DB is never touched — the stored paths are already correct, the files are
 * simply absent.
 *
 *   node server/scripts/recoverMissingProductImages.js            # download
 *   DRY_RUN=1 node server/scripts/recoverMissingProductImages.js  # report only
 */
import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
import db from "../database/db.js";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, "..", "..");
dotenv.config({ path: path.join(repoRoot, "server", ".env"), override: false });
dotenv.config({ path: path.join(repoRoot, ".env"), override: false });

const dryRun = /^(1|true|yes)$/i.test(String(process.env.DRY_RUN || ""));
const cloudName = process.env.CLOUDINARY_CLOUD_NAME || process.env.CLOUDINARY_NAME || "";
const apiKey = process.env.CLOUDINARY_API_KEY || "";
const apiSecret = process.env.CLOUDINARY_API_SECRET || "";
const folder = process.env.CLOUDINARY_PRODUCT_FOLDER || "erp/products";

// Same lookup order as the static handlers in server.js.
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

const collectImagePaths = async () => {
  const sources = [
    ["products.image_url", "SELECT image_url AS url FROM products"],
    ["products.thermal_image_url", "SELECT thermal_image_url AS url FROM products"],
    ["product_variants.image_url", "SELECT image_url AS url FROM product_variants WHERE deleted_at IS NULL"],
    ["product_variants.image", "SELECT image AS url FROM product_variants WHERE deleted_at IS NULL"],
    ["product_variants.photo_url", "SELECT photo_url AS url FROM product_variants WHERE deleted_at IS NULL"],
    ["product_variants.thumbnail_url", "SELECT thumbnail_url AS url FROM product_variants WHERE deleted_at IS NULL"],
    ["product_variants.thermal_image_url", "SELECT thermal_image_url AS url FROM product_variants WHERE deleted_at IS NULL"],
    ["product_variant_images.image_url", "SELECT image_url AS url FROM product_variant_images"],
  ];

  const paths = new Set();
  for (const [label, sql] of sources) {
    let rows = [];
    try {
      ({ rows } = await db.query(sql));
    } catch (error) {
      console.warn(`[skip] ${label}: ${error.message}`);
      continue;
    }
    for (const row of rows) {
      const url = text(row.url);
      if (url.startsWith("/uploads/")) paths.add(url);
    }
  }
  return [...paths].sort();
};

const findMissing = async (imagePaths) => {
  const missing = [];
  for (const imagePath of imagePaths) {
    const relative = imagePath.replace(/^\/uploads\//, "").replace(/\//g, path.sep);
    const found = await Promise.all(uploadsRoots.map((root) => exists(path.join(root, relative))));
    if (!found.some(Boolean)) missing.push(imagePath);
  }
  return missing;
};

const publicIdFor = (imagePath) => {
  const base = imagePath.split("/").pop() || "";
  return `${folder}/${base.replace(/\.[a-z0-9]+$/i, "")}`;
};

const authHeader = () => `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString("base64")}`;

const resolveDeliveryUrl = async (imagePath) => {
  const publicId = publicIdFor(imagePath);
  const fallback = `https://res.cloudinary.com/${cloudName}/image/upload/${publicId}.${imagePath.split(".").pop()}`;
  if (!apiKey || !apiSecret) return fallback;

  const adminUrl = `https://api.cloudinary.com/v1_1/${cloudName}/resources/image/upload/${encodeURIComponent(publicId)}`;
  const response = await fetch(adminUrl, { headers: { Authorization: authHeader() } });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`admin API ${response.status}: ${body.slice(0, 120)}`);
  }
  const asset = await response.json();
  return asset.secure_url || fallback;
};

const download = async (url) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`download ${response.status}`);
  const contentType = response.headers.get("content-type") || "";
  if (!/^image\//i.test(contentType)) throw new Error(`not an image (${contentType || "no content-type"})`);
  return Buffer.from(await response.arrayBuffer());
};

const run = async () => {
  // Counting is a local question — which referenced files are absent from the
  // uploads volume — so it must not require Cloudinary credentials. Only the
  // download pass does. Demanding the cloud name up front made the audit
  // impossible to run on a box where the account has been removed from .env,
  // which is exactly the box that needs auditing.
  if (!dryRun && !cloudName) throw new Error("CLOUDINARY_CLOUD_NAME is not set (recovery needs it; DRY_RUN=1 does not)");
  console.log(`[config] cloud=${cloudName || "(none)"} folder=${folder} admin_api=${apiKey && apiSecret ? "yes" : "no"} dry_run=${dryRun}`);

  const imagePaths = await collectImagePaths();
  console.log(`[scan] ${imagePaths.length} distinct /uploads/ image paths referenced by the catalog`);

  const missing = await findMissing(imagePaths);
  console.log(`[scan] ${missing.length} of them have no file on disk`);
  if (!missing.length) return;

  if (dryRun) {
    for (const imagePath of missing) console.log(`  MISSING ${imagePath}  ->  ${publicIdFor(imagePath)}`);
    return;
  }

  const targetRoot = uploadsRoots.find((root) => root) || uploadsRoots[0];
  let recovered = 0;
  const failures = [];

  for (const imagePath of missing) {
    try {
      const url = await resolveDeliveryUrl(imagePath);
      const buffer = await download(url);
      const destination = path.join(targetRoot, imagePath.replace(/^\/uploads\//, "").replace(/\//g, path.sep));
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, buffer);
      recovered += 1;
      console.log(`  OK      ${imagePath} (${buffer.length} bytes)`);
    } catch (error) {
      failures.push({ imagePath, reason: error.message });
      console.log(`  FAILED  ${imagePath} — ${error.message}`);
    }
  }

  console.log(`\n[done] recovered=${recovered} failed=${failures.length}`);
  if (failures.length) {
    console.log("Still missing (these need a manual re-upload):");
    for (const failure of failures) console.log(`  ${failure.imagePath} — ${failure.reason}`);
  }
};

run()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("[fatal]", error.message);
    process.exit(1);
  });
