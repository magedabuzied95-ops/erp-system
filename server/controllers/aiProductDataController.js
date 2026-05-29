import { generateAiProductData } from "../services/aiProductDataService.js";

const cleanText = (value = "") => String(value || "").trim();

const toAbsoluteImageUrl = (value = "", req) => {
  const imageUrl = cleanText(value);
  if (!imageUrl || imageUrl.startsWith("data:") || /^https?:\/\//i.test(imageUrl)) return imageUrl;
  const baseUrl = cleanText(process.env.PUBLIC_BACKEND_URL || process.env.APP_URL) || `${req.protocol}://${req.get("host")}`;
  const path = imageUrl.startsWith("/") ? imageUrl : `/${imageUrl}`;
  return `${baseUrl.replace(/\/+$/, "")}${path}`;
};

export const generateAiProductDataController = async (req, res) => {
  try {
    const payload = req.body || {};
    const brandName = cleanText(payload.brand_name || payload.brandName || payload.brand);
    const result = await generateAiProductData({
      ...payload,
      brand_id: payload.brand_id || payload.brandId || null,
      brand_name: brandName,
      image_url: toAbsoluteImageUrl(payload.image_url, req),
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
    res.status(500).json({
      success: false,
      message: "AI product data generation failed",
      source: "ERROR",
      confidence: 0,
      suggestions: {},
    });
  }
};
