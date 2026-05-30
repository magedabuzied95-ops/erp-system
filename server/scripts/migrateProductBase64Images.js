import { createHash } from "node:crypto";
import db from "../database/db.js";

const cloudinaryConfig = () => ({
  cloudName: process.env.CLOUDINARY_CLOUD_NAME || process.env.CLOUDINARY_NAME || "",
  apiKey: process.env.CLOUDINARY_API_KEY || "",
  apiSecret: process.env.CLOUDINARY_API_SECRET || "",
  folder: process.env.CLOUDINARY_PRODUCT_FOLDER || "erp/products",
});

const sha1 = (value = "") => createHash("sha1").update(value).digest("hex");

const dataUrlToBlob = (dataUrl = "") => {
  const match = String(dataUrl).match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) return null;
  const [, mimeType, base64] = match;
  return new Blob([Buffer.from(base64, "base64")], { type: mimeType });
};

const uploadToCloudinary = async ({ dataUrl, productId }) => {
  const config = cloudinaryConfig();
  if (!config.cloudName || !config.apiKey || !config.apiSecret) {
    throw new Error("Cloudinary credentials are required");
  }
  const blob = dataUrlToBlob(dataUrl);
  if (!blob) throw new Error(`Product ${productId} has an invalid image data URL`);

  const timestamp = Math.floor(Date.now() / 1000);
  const publicId = `product-${productId}-${timestamp}`;
  const paramsToSign = {
    folder: config.folder,
    public_id: publicId,
    timestamp,
  };
  const signatureBase = Object.keys(paramsToSign)
    .sort()
    .map((key) => `${key}=${paramsToSign[key]}`)
    .join("&");
  const signature = sha1(`${signatureBase}${config.apiSecret}`);
  const formData = new FormData();
  formData.append("file", blob, `${publicId}.png`);
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
    throw new Error(body?.error?.message || body?.message || `Cloudinary upload failed for product ${productId}`);
  }
  return body.secure_url;
};

const main = async () => {
  const result = await db.query(`
    SELECT id, image_url
    FROM products
    WHERE image_url LIKE 'data:image/%'
    ORDER BY id ASC
  `);

  console.log(`[product-image-migration] found ${result.rows.length} base64 product image(s)`);

  for (const row of result.rows) {
    const secureUrl = await uploadToCloudinary({ dataUrl: row.image_url, productId: row.id });
    await db.query("UPDATE products SET image_url = $1, updated_at = NOW() WHERE id = $2", [secureUrl, row.id]);
    console.log("[product-image-migration] updated", { product_id: row.id, image_url: secureUrl });
  }
};

main()
  .catch((error) => {
    console.error("[product-image-migration] failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.end?.();
  });
