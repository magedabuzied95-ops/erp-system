import { generateAiProductData } from "../services/aiProductDataService.js";
import { getPublicBackendUrl } from "../utils/publicUrl.js";

const cleanText = (value = "") => String(value || "").trim();
const isSafePublicOrigin = (value = "") => {
  const origin = cleanText(value);
  if (!origin) return false;
  return !/(^|\/\/)(localhost|127\.0\.0\.1|0\.0\.0\.0|\[?::1\]?)(:|\/|$)/i.test(origin);
};

const resolveBackendBaseUrl = (req) => {
  const envBaseUrl = cleanText(
    process.env.PUBLIC_BACKEND_URL ||
      process.env.BACKEND_PUBLIC_URL ||
      process.env.API_PUBLIC_URL ||
      getPublicBackendUrl() ||
      process.env.APP_URL
  );
  if (envBaseUrl) return envBaseUrl.replace(/\/+$/g, "");

  const requestOrigin = cleanText(`${req.protocol}://${req.get("host")}`);
  return isSafePublicOrigin(requestOrigin) ? requestOrigin.replace(/\/+$/g, "") : "";
};

const toAbsoluteImageUrl = (value = "", req) => {
  const imageUrl = cleanText(value);
  if (!imageUrl || imageUrl.startsWith("data:") || /^https?:\/\//i.test(imageUrl)) return imageUrl;
  const baseUrl = resolveBackendBaseUrl(req);
  if (!baseUrl) return imageUrl;
  const path = imageUrl.startsWith("/") ? imageUrl : `/${imageUrl}`;
  return `${baseUrl}${path}`;
};

export const generateAiProductDataController = async (req, res) => {
  try {
    const payload = req.body || {};
    const brandName = cleanText(payload.brand_name || payload.brandName || payload.brand);
    const sourceImageUrl = cleanText(
      payload.image_url ||
      payload.source_image_url ||
      payload.cover_image_url ||
      payload.current?.image_url ||
      payload.current?.source_image_url ||
      payload.current?.cover_image_url
    );
    const result = await generateAiProductData({
      ...payload,
      brand_id: payload.brand_id || payload.brandId || null,
      brand_name: brandName,
      image_url: toAbsoluteImageUrl(sourceImageUrl, req),
      image_base64_optional: payload.image_base64_optional || payload.image_base64,
      current: {
        ...(payload.current || {}),
        brand_id: payload.brand_id || payload.brandId || payload.current?.brand_id || payload.current?.brandId || "",
        brand_name: brandName || cleanText(payload.current?.brand_name || payload.current?.brandName),
        brand: brandName || cleanText(payload.current?.brand || payload.brand),
      },
    });

    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error("[products] AI product data failed", error);
    const statusCode = error?.code === "AI_VISION_IMAGE_UNREACHABLE" ? 422 : 500;
    res.status(statusCode).json({
      success: false,
      message: error?.userMessage || "AI product data generation failed",
      source: "ERROR",
      confidence: 0,
      suggestions: {},
    });
  }
};
