import crypto from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { access, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFilePath);

export const OG_IMAGE_WIDTH = 1200;
export const OG_IMAGE_HEIGHT = 630;

const trimSlashes = (value = "") => String(value || "").replace(/^\/+|\/+$/g, "");
const isLocalhost = (value = "") => /(^|\b)(localhost|127\.0\.0\.1|0\.0\.0\.0|\[?::1\]?)(\b|:)/i.test(String(value || ""));
const isHttpUrl = (value = "") => /^https?:\/\//i.test(String(value || ""));

export const sanitizePublicOrigin = (value = "") => {
  const raw = String(value || "").trim().replace(/\/+$/g, "");
  if (!isHttpUrl(raw) || isLocalhost(raw)) return "";
  return raw;
};

export const resolvePublicOrigin = (req = null) => {
  const envOrigin = [
    process.env.PUBLIC_BACKEND_URL,
    process.env.WEBSITE_BASE_URL,
    process.env.PUBLIC_APP_URL,
    process.env.FRONTEND_URL,
    process.env.CLIENT_URL,
    process.env.APP_URL,
  ].map(sanitizePublicOrigin).find(Boolean);
  if (envOrigin) return envOrigin;

  const forwardedProto = String(req?.get?.("x-forwarded-proto") || "").split(",")[0].trim();
  const forwardedHost = String(req?.get?.("x-forwarded-host") || "").split(",")[0].trim();
  const host = forwardedHost || req?.get?.("host") || "";
  const protocol = forwardedProto || req?.protocol || "https";
  return sanitizePublicOrigin(host ? `${protocol}://${host}` : "");
};

export const buildAbsolutePublicUrl = (req, pathname = "") => {
  const origin = resolvePublicOrigin(req);
  if (!origin) return "";
  return `${origin}/${trimSlashes(pathname)}`;
};

const hashProductOgState = (product = {}) =>
  crypto
    .createHash("sha1")
    .update(JSON.stringify({
      id: product.id,
      name: product.name,
      meta_title: product.meta_title,
      seo_title: product.seo_title,
      seo_description: product.seo_description,
      image_url: product.image_url || product.public_image_url || product.product_image_url,
      updated_at: product.updated_at || product.created_at || "",
    }))
    .digest("hex")
    .slice(0, 16);

const uploadRoots = () => [
  process.env.UPLOAD_DIR,
  path.join(currentDir, "..", "uploads"),
  path.join(process.cwd(), "uploads"),
  path.join(currentDir, "..", "..", "uploads"),
].filter(Boolean);

const findExistingFile = async (candidates = []) => {
  for (const candidate of candidates) {
    try {
      await access(candidate, fsConstants.R_OK);
      const info = await stat(candidate);
      if (info.isFile()) return candidate;
    } catch {
      // Try the next upload root.
    }
  }
  return "";
};

const resolveLocalImagePath = async (imageUrl = "") => {
  const raw = String(imageUrl || "").trim();
  if (!raw || isHttpUrl(raw) || raw.startsWith("data:") || raw.startsWith("blob:")) return "";
  const pathname = raw.split("?")[0].replace(/\\/g, "/");
  const relative = pathname.startsWith("/uploads/")
    ? pathname.slice("/uploads/".length)
    : pathname.startsWith("uploads/")
      ? pathname.slice("uploads/".length)
      : pathname.startsWith("/products/")
        ? pathname.slice(1)
        : pathname.startsWith("products/")
          ? pathname
          : `products/${pathname.replace(/^\/+/, "")}`;

  return findExistingFile(uploadRoots().map((root) => path.join(root, relative)));
};

const readImageInput = async (imageUrl = "") => {
  const raw = String(imageUrl || "").trim();
  if (!raw) return null;
  const localPath = await resolveLocalImagePath(raw);
  if (localPath) return localPath;
  if (!isHttpUrl(raw)) return null;

  const response = await fetch(raw);
  if (!response.ok) return null;
  return Buffer.from(await response.arrayBuffer());
};

const placeholderSvg = (title = "Product") => Buffer.from(`
<svg width="${OG_IMAGE_WIDTH}" height="${OG_IMAGE_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <rect width="1200" height="630" fill="#f8fafc"/>
  <rect x="140" y="86" width="920" height="458" rx="40" fill="#ffffff" stroke="#e5e7eb"/>
  <text x="600" y="320" text-anchor="middle" font-family="Arial, sans-serif" font-size="54" font-weight="700" fill="#111827">${String(title || "Product").replace(/[<>&"]/g, "")}</text>
</svg>`);

export const generateProductOgImage = async ({ product = {}, req = null } = {}) => {
  const cacheKey = hashProductOgState(product);
  const safeId = String(product.id || product.slug || "product").replace(/[^a-z0-9_-]+/gi, "-").slice(0, 80);
  const relativePath = `uploads/og/products/${safeId}-${cacheKey}.jpg`;
  const outputPath = path.join(uploadRoots()[0], "og", "products", `${safeId}-${cacheKey}.jpg`);
  const publicUrl = buildAbsolutePublicUrl(req, relativePath);

  try {
    await access(outputPath, fsConstants.R_OK);
    return { path: outputPath, url: publicUrl, cacheKey, width: OG_IMAGE_WIDTH, height: OG_IMAGE_HEIGHT };
  } catch {
    // Generate the missing cache variant.
  }

  await mkdir(path.dirname(outputPath), { recursive: true });

  const input = await readImageInput(product.image_url || product.public_image_url || product.product_image_url || product.gallery_images?.[0]);
  const productBuffer = await sharp(input || placeholderSvg(product.name), { animated: false })
    .rotate()
    .resize({
      width: 900,
      height: 470,
      fit: "inside",
      withoutEnlargement: true,
      background: { r: 255, g: 255, b: 255, alpha: 0 },
    })
    .png()
    .toBuffer();
  const metadata = await sharp(productBuffer).metadata();
  const imageWidth = Number(metadata.width || 0);
  const imageHeight = Number(metadata.height || 0);
  const left = Math.round((OG_IMAGE_WIDTH - imageWidth) / 2);
  const top = Math.round((OG_IMAGE_HEIGHT - imageHeight) / 2);
  const shadowSvg = Buffer.from(`
<svg width="${OG_IMAGE_WIDTH}" height="${OG_IMAGE_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <rect width="1200" height="630" fill="#f8fafc"/>
  <ellipse cx="600" cy="${Math.min(560, top + imageHeight - 18)}" rx="${Math.max(190, Math.round(imageWidth * 0.38))}" ry="34" fill="rgba(15,23,42,0.13)"/>
</svg>`);

  await sharp(shadowSvg)
    .composite([{ input: productBuffer, left, top }])
    .jpeg({ quality: 90, mozjpeg: true })
    .toFile(outputPath);

  return { path: outputPath, url: publicUrl, cacheKey, width: OG_IMAGE_WIDTH, height: OG_IMAGE_HEIGHT };
};
