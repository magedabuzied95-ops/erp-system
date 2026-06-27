import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
import db from "../database/db.js";

const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFilePath);
const repoRoot = path.resolve(currentDir, "..", "..");
const serverEnvPath = path.join(repoRoot, "server", ".env");
const rootEnvPath = path.join(repoRoot, ".env");

dotenv.config({ path: serverEnvPath, override: false });
dotenv.config({ path: rootEnvPath, override: false });

const batchSize = Number(process.env.BACKFILL_IMAGE_BATCH_SIZE || 25);
console.log("[cloudinary-env-check]", {
  has_cloud_name: Boolean(process.env.CLOUDINARY_CLOUD_NAME || process.env.CLOUDINARY_NAME),
  has_api_key: Boolean(process.env.CLOUDINARY_API_KEY),
  has_api_secret: Boolean(process.env.CLOUDINARY_API_SECRET),
});

const cloudinaryConfig = () => ({
  cloudName: process.env.CLOUDINARY_CLOUD_NAME || process.env.CLOUDINARY_NAME || "",
  apiKey: process.env.CLOUDINARY_API_KEY || "",
  apiSecret: process.env.CLOUDINARY_API_SECRET || "",
  folder: process.env.CLOUDINARY_PRODUCT_FOLDER || "erp/products",
});

const sha1 = (value = "") => createHash("sha1").update(value).digest("hex");
const text = (value = "") => String(value ?? "").trim();
const isCloudinaryUrl = (value = "") => /res\.cloudinary\.com/i.test(text(value));
const isBase64Image = (value = "") => /^data:image\/[a-zA-Z0-9.+-]+;base64,/i.test(text(value));
const isUploadsProductPath = (value = "") => /(^|\/)uploads\/products\//i.test(text(value)) || /trycloudflare\.com.*\/uploads\/products\//i.test(text(value));

const extractUploadsProductRelativePath = (value = "") => {
  const raw = text(value);
  if (!raw) return "";
  if (/trycloudflare\.com/i.test(raw) || /^https?:\/\//i.test(raw)) {
    try {
      const parsed = new URL(raw);
      const match = parsed.pathname.match(/\/uploads\/products\/(.+)$/i);
      if (match) return `uploads/products/${match[1]}`;
    } catch {
      const match = raw.match(/\/uploads\/products\/(.+)$/i);
      if (match) return `uploads/products/${match[1]}`;
    }
  }
  const directMatch = raw.match(/(^|\/)uploads\/products\/(.+)$/i);
  if (directMatch) return `uploads/products/${directMatch[2]}`;
  return "";
};

const resolveLocalFilePath = (value = "") => {
  if (isBase64Image(value)) return "";
  const rel = extractUploadsProductRelativePath(value);
  if (!rel) return "";
  return path.join(repoRoot, rel.replace(/\//g, path.sep));
};

const dataUrlToBlob = (dataUrl = "") => {
  const match = text(dataUrl).match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) return null;
  const [, mimeType, base64] = match;
  return new Blob([Buffer.from(base64, "base64")], { type: mimeType });
};

const uploadToCloudinary = async ({ source, productId, variantId = null, table }) => {
  const config = cloudinaryConfig();
  if (!config.cloudName || !config.apiKey || !config.apiSecret || typeof fetch !== "function" || typeof FormData === "undefined") {
    throw new Error("Cloudinary credentials/runtime are required");
  }

  let blob = null;
  let filename = "";
  if (isBase64Image(source)) {
    blob = dataUrlToBlob(source);
    filename = `product-${productId}${variantId ? `-variant-${variantId}` : ""}.png`;
  } else {
    const filePath = resolveLocalFilePath(source);
    if (!filePath) throw new Error(`Unsupported source for upload: ${source}`);
    const buffer = await readFile(filePath);
    blob = new Blob([buffer]);
    filename = path.basename(filePath);
  }
  if (!blob) throw new Error("Unable to build upload blob");

  const timestamp = Math.floor(Date.now() / 1000);
  const publicIdParts = [table, `product-${productId}`, variantId ? `variant-${variantId}` : null, timestamp].filter(Boolean);
  const publicId = publicIdParts.join("-");
  const paramsToSign = { folder: config.folder, public_id: publicId, timestamp };
  const signatureBase = Object.keys(paramsToSign).sort().map((key) => `${key}=${paramsToSign[key]}`).join("&");
  const signature = sha1(`${signatureBase}${config.apiSecret}`);
  const formData = new FormData();
  formData.append("file", blob, filename);
  formData.append("api_key", config.apiKey);
  formData.append("timestamp", String(timestamp));
  formData.append("folder", config.folder);
  formData.append("public_id", publicId);
  formData.append("signature", signature);

  const response = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(config.cloudName)}/image/upload`, {
    method: "POST",
    body: formData,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body?.error?.message || body?.message || `Cloudinary upload failed for ${table}:${productId}`);
  }
  return body;
};

const parseArgs = () => {
  const args = new Set(process.argv.slice(2));
  const dryRun = args.has("--dry-run") || !args.has("--execute");
  const productIdIndex = process.argv.findIndex((arg) => arg === "--product-id");
  const productId = productIdIndex >= 0 ? Number(process.argv[productIdIndex + 1]) : 1;
  return { dryRun, execute: !dryRun, productId: Number.isFinite(productId) && productId > 0 ? productId : 1 };
};

const candidateTables = [
  { table: "products", idColumn: "id", productIdColumn: null, variantIdColumn: null, columns: ["image_url"] },
  { table: "product_variants", idColumn: "id", productIdColumn: "product_id", variantIdColumn: "id", columns: ["image_url", "image"] },
  { table: "product_variant_images", idColumn: "id", productIdColumn: "product_id", variantIdColumn: "variant_id", columns: ["image_url"] },
];

const fetchRows = async (table, productId) => {
  if (table === "products") {
    return (await db.query("SELECT * FROM products WHERE id = $1", [productId])).rows;
  }
  if (table === "product_variants") {
    return (await db.query("SELECT * FROM product_variants WHERE product_id = $1 ORDER BY id ASC", [productId])).rows;
  }
  if (table === "product_variant_images") {
    return (await db.query("SELECT * FROM product_variant_images WHERE product_id = $1 ORDER BY id ASC", [productId])).rows;
  }
  return [];
};

const updateRow = async ({ table, id, column = "image_url", secureUrl }) => {
  const sql = `UPDATE ${table} SET ${column} = $1${table === "products" || table === "product_variants" ? ", updated_at = NOW()" : ""} WHERE id = $2`;
  await db.query(sql, [secureUrl, id]);
};

const main = async () => {
  const { dryRun, productId } = parseArgs();
  console.log("[backfill-product-images]", { mode: dryRun ? "dry-run" : "execute", product_id: productId, batch_size: batchSize });

  const impacted = [];
  for (const spec of candidateTables) {
    const rows = await fetchRows(spec.table, productId);
    console.log("[backfill-product-images-table]", { table: spec.table, rows: rows.length });
    for (const row of rows) {
      const imageFields = spec.columns.map((column) => ({ column, value: row[column] || "" })).filter((entry) => text(entry.value));
      for (const field of imageFields) {
        const oldUrl = text(field.value);
        if (isCloudinaryUrl(oldUrl)) continue;
        if (!isBase64Image(oldUrl) && !isUploadsProductPath(oldUrl)) continue;
        impacted.push({
          table: spec.table,
          id: row.id,
          product_id: row.product_id || row.id,
          variant_id: row.variant_id ?? null,
          column: field.column,
          old_url: oldUrl,
        });
      }
    }
  }

  console.log("[backfill-product-images]", { candidates: impacted.length });
  for (let i = 0; i < impacted.length; i += batchSize) {
    const batch = impacted.slice(i, i + batchSize);
    console.log("[backfill-product-images-batch]", { batch_start: i, batch_size: batch.length });
    for (const item of batch) {
      try {
        const uploadResult = await uploadToCloudinary({
          source: item.old_url,
          productId: item.product_id,
          variantId: item.variant_id,
          table: item.table,
        });
        const secureUrl = text(uploadResult?.secure_url || "");
        if (!secureUrl) throw new Error("Cloudinary returned no secure_url");
        console.log("[backfill-product-images-item]", {
          table: item.table,
          product_id: item.product_id,
          variant_id: item.variant_id,
          old_url: item.old_url,
          new_secure_url: secureUrl,
        });
        if (!dryRun) {
          await updateRow({ table: item.table, id: item.id, column: item.column, secureUrl });
        }
      } catch (error) {
        console.warn("[backfill-product-images-skip]", {
          table: item.table,
          product_id: item.product_id,
          variant_id: item.variant_id,
          old_url: item.old_url,
          message: error?.message || String(error),
        });
      }
    }
  }
};

main()
  .catch((error) => {
    console.error("[backfill-product-images-failed]", { message: error?.message || String(error) });
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.end?.();
  });
