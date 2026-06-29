import { APP_NAME } from "../../../shared/constants/app";
import { resolveProductImageUrl } from "../../../shared/lib/imageUrls";
import { formatCurrency } from "../../../shared/lib/currency";
import { normalizeBarcodePrintSettings, paginateBarcodeLabels, resolveBarcodePrintPaper } from "../../../../shared/barcodePrintSettings.js";
import Code128Reader from "@zxing/library/esm/core/oned/Code128Reader";

const LABEL_TEMPLATE_STANDARD = "standard";
const LABEL_TEMPLATE_THERMAL_PORTRAIT = "thermal_portrait";
const LABEL_TEMPLATE_THERMAL_LANDSCAPE_50X100 = "thermal_landscape_50x100";
const LABEL_TEMPLATE_PREMIUM_RETAIL_50X100 = "premium_retail_50x100";
const ENABLE_THERMAL_ARTWORK = true;
const PREMIUM_RETAIL_LABEL_WIDTH_MM = 50;
const PREMIUM_RETAIL_LABEL_HEIGHT_MM = 100;
const PREMIUM_RETAIL_BARCODE_WIDTH = 680;
const PREMIUM_RETAIL_BARCODE_HEIGHT = 288;
const PREMIUM_RETAIL_GRID_ROWS = "33mm 12mm 11mm 11mm 20.8mm 7mm";

const safeWindow = () => (typeof window !== "undefined" ? window : null);
const escapeHtml = (value = "") =>
  String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

function resolveAssetUrl(url) {
  return resolveProductImageUrl(url);
}

const resolveStorefrontOrigin = () => {
  const configured = String(
    import.meta.env.VITE_PUBLIC_STOREFRONT_URL ||
      import.meta.env.VITE_STORE_FRONT_URL ||
      import.meta.env.VITE_STOREFRONT_URL ||
      import.meta.env.VITE_PUBLIC_FRONTEND_URL ||
      import.meta.env.VITE_PUBLIC_APP_URL ||
      import.meta.env.FRONTEND_URL ||
      ""
  ).trim().replace(/\/$/, "");
  if (configured) return configured.replace(/\/shop$/i, "");
  const win = safeWindow();
  return win?.location?.origin ? win.location.origin.replace(/\/$/, "") : "http://localhost:5174";
};

const buildQueryString = (entries = []) => {
  const params = new URLSearchParams();
  entries.forEach(([key, value]) => {
    if (value === null || value === undefined) return;
    const normalized = String(value).trim();
    if (!normalized) return;
    params.set(key, normalized);
  });
  const query = params.toString();
  return query ? `?${query}` : "";
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const normalizeBarcode = (value, fallbackSeed = "") => {
  const text = String(value ?? "").trim();
  if (text) return text;
  return String(fallbackSeed ?? "").trim();
};

const firstText = (...values) =>
  values.map((value) => String(value || "").trim()).find(Boolean) || "";

const BARCODE_LABEL_IMAGE_CACHE = new Map();
const BARCODE_LABEL_IMAGE_CACHE_LIMIT = 1500;

export const resolveLabelArticleCode = (item = {}) =>
  firstText(
    item?.article_code,
    item?.articleCode,
    item?.color_article_code,
    item?.colorArticleCode
  );

const normalizeThermalImageStatus = (value = "", thermalImageUrl = "") => {
  const status = String(value || "").trim().toLowerCase();
  if (String(thermalImageUrl || "").trim()) return "ready";
  return ["pending", "processing", "ready", "failed"].includes(status) ? status : "";
};

const isThermalImageReady = (status = "", thermalImageUrl = "") => normalizeThermalImageStatus(status, thermalImageUrl) === "ready";

export const getThermalImageStatus = (item = {}) =>
  normalizeThermalImageStatus(
    firstText(
      item?.variant_thermal_image_status,
      item?.thermal_image_status,
      item?.product_thermal_image_status,
      item?.thermalImageStatus
    ),
    firstText(
      item?.variant_color_thermal_image_url,
      item?.color_thermal_image_url,
      item?.thermal_image_url,
      item?.product_thermal_image_url,
      item?.thermalImageUrl,
      item?.productThermalImageUrl
    )
  );

const resolveThermalAwareImage = (item = {}) => {
  const variantThermalUrl = firstText(
    item?.color_thermal_image_url,
    item?.variant_color_thermal_image_url,
    item?.thermal_image_url,
    item?.thermalImageUrl
  );
  const productThermalUrl = firstText(item?.product_thermal_image_url, item?.productThermalImageUrl);
  const variantThermalStatus = normalizeThermalImageStatus(
    firstText(item?.variant_thermal_image_status, item?.thermal_image_status, item?.thermalImageStatus),
    variantThermalUrl
  );
  const productThermalStatus = normalizeThermalImageStatus(
    firstText(item?.product_thermal_image_status, item?.productThermalImageStatus),
    productThermalUrl
  );

  const resolved = variantThermalUrl && isThermalImageReady(variantThermalStatus)
    ? variantThermalUrl
    : productThermalUrl && isThermalImageReady(productThermalStatus)
      ? productThermalUrl
      : "";
  console.log("BARCODE_LABEL_THERMAL_RESOLVED", {
    productId: item?.productId ?? item?.id ?? null,
    variantId: item?.variantId ?? item?.variant_id ?? null,
    thermal_image_url: item?.thermal_image_url || "",
    product_thermal_image_url: productThermalUrl || "",
    color_thermal_image_url: variantThermalUrl || "",
    variant_color_thermal_image_url: firstText(item?.variant_color_thermal_image_url, item?.variantColorThermalImageUrl) || "",
    thermal_image_status: item?.thermal_image_status || "",
    product_thermal_image_status: item?.product_thermal_image_status || "",
    variant_thermal_image_status: item?.variant_thermal_image_status || "",
    resolved,
  });
  return resolved;
};

const buildBarcodeLabelImageCacheKey = (item = {}) => ([
  item?.productId ?? item?.id ?? "",
  item?.variantId ?? item?.variant_id ?? "",
  firstText(item?.color_thermal_image_url, item?.variant_color_thermal_image_url, item?.thermal_image_url, item?.thermalImageUrl),
  firstText(item?.product_thermal_image_url, item?.productThermalImageUrl),
  firstText(item?.variant_thermal_image_status, item?.thermal_image_status, item?.thermalImageStatus),
  firstText(item?.product_thermal_image_status, item?.productThermalImageStatus),
  firstText(item?.colorPrimaryImageUrl, item?.color_image_url, item?.image_url, item?.product_image_url),
].join("|"));

export const resolveBarcodeLabelImage = (item = {}) => {
  const cacheKey = buildBarcodeLabelImageCacheKey(item);
  if (BARCODE_LABEL_IMAGE_CACHE.has(cacheKey)) {
    return BARCODE_LABEL_IMAGE_CACHE.get(cacheKey) || "";
  }
  const resolved = firstText(
    resolveThermalAwareImage(item),
    item?.colorPrimaryImageUrl,
    item?.color_image_url,
    item?.image_url,
    item?.product_image_url
  );
  if (BARCODE_LABEL_IMAGE_CACHE.size >= BARCODE_LABEL_IMAGE_CACHE_LIMIT) {
    BARCODE_LABEL_IMAGE_CACHE.clear();
  }
  BARCODE_LABEL_IMAGE_CACHE.set(cacheKey, resolved);
  return resolved;
};

const formatLabelCurrency = (value) =>
  formatCurrency(Math.round(Number(value || 0))).replace(/([.,٫]\d{2})(?=\s|$)/g, "");

const truthyFlag = (value) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  if (typeof value === "string") return ["1", "true", "yes", "on", "active", "enabled"].includes(value.trim().toLowerCase());
  return false;
};

const positiveNumber = (...values) => {
  for (const value of values) {
    const parsed = Number(value ?? 0);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return 0;
};

const resolveLabelPrice = (source = {}, fallbackSource = {}) => {
  const salePrice = positiveNumber(source.sale_price, source.salePrice);
  const saleEnabled = truthyFlag(source.sale_price_enabled ?? source.salePriceEnabled ?? fallbackSource.sale_price_enabled ?? fallbackSource.salePriceEnabled);
  const sellingPrice = positiveNumber(source.selling_price, source.sellingPrice, fallbackSource.selling_price, fallbackSource.sellingPrice);
  const regularPrice = positiveNumber(source.regular_price, source.regularPrice, fallbackSource.regular_price, fallbackSource.regularPrice);
  const basePrice = positiveNumber(source.price, source.variant_price, fallbackSource.price, fallbackSource.variant_price);
  const effectivePrice = saleEnabled && salePrice > 0 ? salePrice : positiveNumber(sellingPrice, regularPrice, basePrice);
  const comparePrice = saleEnabled && salePrice > 0 ? positiveNumber(sellingPrice, regularPrice, basePrice) : 0;

  return {
    price: effectivePrice,
    comparePrice: comparePrice > effectivePrice ? comparePrice : 0,
    saleActive: Boolean(saleEnabled && salePrice > 0),
  };
};

const resolveProductFirstLabelPrice = (product = {}, variant = {}) => {
  const productSalePrice = positiveNumber(product.sale_price, product.salePrice);
  const productSellingPrice = positiveNumber(product.selling_price, product.sellingPrice);
  const productRegularPrice = positiveNumber(product.regular_price, product.regularPrice);
  const productBasePrice = positiveNumber(product.price);

  const variantSellingPrice = positiveNumber(variant.selling_price, variant.sellingPrice);
  const variantRegularPrice = positiveNumber(variant.regular_price, variant.regularPrice);
  const variantBasePrice = positiveNumber(variant.price, variant.variant_price);
  const effectivePrice = positiveNumber(
    productSellingPrice,
    productRegularPrice,
    productBasePrice,
    variantSellingPrice,
    variantRegularPrice,
    variantBasePrice,
    productSalePrice
  );

  return {
    price: effectivePrice,
    comparePrice: 0,
    saleActive: false,
  };
};

export const getLabelImageUrl = (product, variant = null, colorGroup = null) => {
  return resolveBarcodeLabelImage({
    ...product,
    ...variant,
    colorPrimaryImageUrl: firstText(
      variant?.variant_image_url,
      variant?.color_image_url,
      variant?.image_url,
      variant?.image,
      variant?.colorGroup?.image_url,
      colorGroup?.image_url
    ),
    color_image_url: firstText(
      variant?.color_image_url,
      variant?.variant_image_url,
      variant?.image_url,
      variant?.image,
      variant?.colorGroup?.image_url,
      colorGroup?.image_url
    ),
    product_image_url: firstText(
      product?.product_image_url,
      product?.image_url,
      product?.image,
      product?.photo_url,
      product?.thumbnail_url
    ),
    product_thermal_image_status: firstText(product?.thermal_image_status, product?.thermalImageStatus),
    thermal_image_url: firstText(
      variant?.thermal_image_url,
      variant?.thermalImageUrl,
      variant?.colorGroup?.thermal_image_url,
      variant?.colorGroup?.thermalImageUrl,
      colorGroup?.thermal_image_url,
      colorGroup?.thermalImageUrl,
      product?.thermal_image_url,
      product?.thermalImageUrl
    ),
    product_thermal_image_url: firstText(product?.thermal_image_url, product?.thermalImageUrl),
    thermal_image_status: firstText(variant?.thermal_image_status, variant?.thermalImageStatus),
    variant_thermal_image_status: firstText(variant?.thermal_image_status, variant?.thermalImageStatus),
    product_thermal_image_status: firstText(product?.thermal_image_status, product?.thermalImageStatus),
    variant_color_thermal_image_url: firstText(
      variant?.thermal_image_url,
      variant?.thermalImageUrl,
      variant?.colorGroup?.thermal_image_url,
      variant?.colorGroup?.thermalImageUrl,
      colorGroup?.thermal_image_url,
      colorGroup?.thermalImageUrl
    ),
    color_thermal_image_url: firstText(
      variant?.color_thermal_image_url,
      variant?.variant_color_thermal_image_url,
      variant?.thermal_image_url,
      variant?.thermalImageUrl,
      variant?.colorGroup?.thermal_image_url,
      variant?.colorGroup?.thermalImageUrl,
      colorGroup?.thermal_image_url,
      colorGroup?.thermalImageUrl
    ),
  });
};

const getSafeLabelImageUrl = (item) => {
  const imageUrl = resolveAssetUrl(item.imageUrl || item.resolvedImage);
  if (!imageUrl) return "";
  if (imageUrl.startsWith("data:")) return imageUrl;

  const separator = imageUrl.includes("?") ? "&" : "?";
  return `${imageUrl}${separator}v=${encodeURIComponent(item.variantId || item.key || item.copyIndex || Date.now())}`;
};

const isThermalArtworkTemplate = (template) => {
  const normalized = String(template || "").trim().toLowerCase();
  return [
    LABEL_TEMPLATE_THERMAL_PORTRAIT,
    LABEL_TEMPLATE_THERMAL_LANDSCAPE_50X100,
    LABEL_TEMPLATE_PREMIUM_RETAIL_50X100,
  ].includes(normalized);
};

const buildThermalArtworkScript = () => `
  <script>
    (function () {
      const SOURCE_SELECTOR = '[data-thermal-artwork-source="true"]';
      const MAX_SIDE = 1400;

      const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

      const generateThermalArtwork = (image) => {
        try {
          const sourceWidth = Number(image?.naturalWidth || image?.width || 0);
          const sourceHeight = Number(image?.naturalHeight || image?.height || 0);
          if (!sourceWidth || !sourceHeight) return "";

          const scale = Math.min(1, MAX_SIDE / Math.max(sourceWidth, sourceHeight));
          const width = Math.max(1, Math.round(sourceWidth * scale));
          const height = Math.max(1, Math.round(sourceHeight * scale));

          const sourceCanvas = document.createElement("canvas");
          sourceCanvas.width = width;
          sourceCanvas.height = height;
          const sourceContext = sourceCanvas.getContext("2d", { willReadFrequently: true });
          if (!sourceContext) return "";

          sourceContext.fillStyle = "#ffffff";
          sourceContext.fillRect(0, 0, width, height);
          sourceContext.imageSmoothingEnabled = true;
          sourceContext.imageSmoothingQuality = "high";
          sourceContext.drawImage(image, 0, 0, width, height);

          const sourceData = sourceContext.getImageData(0, 0, width, height);
          const { data } = sourceData;
          const gray = new Uint8ClampedArray(width * height);

          for (let index = 0, pixel = 0; index < data.length; index += 4, pixel += 1) {
            const red = data[index];
            const green = data[index + 1];
            const blue = data[index + 2];
            const alpha = data[index + 3];
            if (alpha < 14 || (red > 245 && green > 245 && blue > 245)) {
              gray[pixel] = 255;
              continue;
            }
            gray[pixel] = Math.round(red * 0.299 + green * 0.587 + blue * 0.114);
          }

          const getGray = (x, y) => {
            if (x < 0 || y < 0 || x >= width || y >= height) return 255;
            return gray[(y * width) + x] ?? 255;
          };

          const edges = new Uint8ClampedArray(width * height);

          for (let y = 1; y < height - 1; y += 1) {
            for (let x = 1; x < width - 1; x += 1) {
              const topLeft = getGray(x - 1, y - 1);
              const top = getGray(x, y - 1);
              const topRight = getGray(x + 1, y - 1);
              const left = getGray(x - 1, y);
              const right = getGray(x + 1, y);
              const bottomLeft = getGray(x - 1, y + 1);
              const bottom = getGray(x, y + 1);
              const bottomRight = getGray(x + 1, y + 1);
              const gx = (-1 * topLeft) + topRight + (-2 * left) + (2 * right) + (-1 * bottomLeft) + bottomRight;
              const gy = (-1 * topLeft) + (-2 * top) + (-1 * topRight) + bottomLeft + (2 * bottom) + bottomRight;
              edges[(y * width) + x] = clamp(Math.round(Math.hypot(gx, gy)), 0, 255);
            }
          }

          const edgeAt = (x, y) => {
            let strongest = 0;
            for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
              for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
                const nx = x + offsetX;
                const ny = y + offsetY;
                if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
                strongest = Math.max(strongest, edges[(ny * width) + nx] || 0);
              }
            }
            return strongest;
          };

          const outputCanvas = document.createElement("canvas");
          outputCanvas.width = width;
          outputCanvas.height = height;
          const outputContext = outputCanvas.getContext("2d", { willReadFrequently: true });
          if (!outputContext) return "";

          const output = outputContext.createImageData(width, height);
          for (let y = 0; y < height; y += 1) {
            for (let x = 0; x < width; x += 1) {
              const pixelIndex = (y * width) + x;
              const luminance = gray[pixelIndex] ?? 255;
              const edgeStrength = edgeAt(x, y);
              const darkRegion = luminance < 170;
              const midToneContour = luminance < 228 && edgeStrength > 22;
              const contourLine = edgeStrength > 52;
              const ink = darkRegion || midToneContour || contourLine;
              const value = ink ? 0 : 255;
              const outputIndex = pixelIndex * 4;
              output.data[outputIndex] = value;
              output.data[outputIndex + 1] = value;
              output.data[outputIndex + 2] = value;
              output.data[outputIndex + 3] = 255;
            }
          }

          outputContext.putImageData(output, 0, 0);
          return outputCanvas.toDataURL("image/png");
        } catch (error) {
          console.warn("[thermal-artwork] generation failed", error);
          return "";
        }
      };

      const applyThermalArtwork = (image) => {
        try {
          if (!image || image.dataset.thermalArtworkApplied === "true") return;
          const artworkUrl = generateThermalArtwork(image);
          if (!artworkUrl) return;
          image.dataset.thermalArtworkApplied = "true";
          image.src = artworkUrl;
        } catch (error) {
          console.warn("[thermal-artwork] apply failed", error);
        }
      };

      const bootstrap = () => {
        document.querySelectorAll(SOURCE_SELECTOR).forEach((image) => {
          if (!image) return;
          const run = () => applyThermalArtwork(image);
          if (image.complete && Number(image.naturalWidth || 0) > 0) {
            run();
            return;
          }
          image.addEventListener("load", run, { once: true });
        });
      };

      if (document.readyState === "complete") {
        bootstrap();
      } else {
        window.addEventListener("load", bootstrap, { once: true });
      }
    }());
  </script>
`;

export const getLabelIdentity = (product, variant = null) => {
  const variantId =
    variant?.variant_id ??
    (variant?.color || variant?.size || variant?.sku
      ? `${variant?.color || "default"}:${variant?.size || "size"}:${variant?.sku || "sku"}`
      : variant?.id ?? "base");
  return `${product?.id ?? "product"}:${variantId}`;
};

export const resolveLabelDisplayBarcode = (product, variant = null) => {
  const candidates = [
    ["variant.barcode_label", variant?.barcode_label],
    ["variant.product_code", variant?.product_code],
    ["variant.code", variant?.code],
    ["variant.barcode", variant?.barcode],
    ["variant.variant_barcode", variant?.variant_barcode],
    ["product.barcode_label", product?.barcode_label],
    ["product.product_code", product?.product_code],
    ["product.code", product?.code],
    ["product.barcode", product?.barcode],
    ["product.sku", product?.sku],
  ];

  for (const [source, value] of candidates) {
    const text = String(value || "").trim();
    if (text) return { value: text, source };
  }

  return {
    value: `SKU-${product?.id ?? "0000"}`,
    source: "fallback",
  };
};

export const getLabelDisplayBarcode = (product, variant = null) => resolveLabelDisplayBarcode(product, variant).value;

export const getLabelPriceInfo = (product, variant = null) =>
  variant ? resolveLabelPrice(variant, product) : resolveLabelPrice(product);

export const getProductFirstLabelPriceInfo = (product, variant = null) =>
  resolveProductFirstLabelPrice(product, variant || {});

export const getLabelSalePrice = (product, variant = null) =>
  getLabelPriceInfo(product, variant).price;

export const getLabelSku = (product, variant = null) =>
  variant?.sku || variant?.variant_sku || product?.sku || `SKU-${product?.id ?? "0000"}`;

export const getLabelQuantity = (selectedQuantity) => {
  const value = Number(selectedQuantity || 0);
  return Number.isFinite(value) ? clamp(Math.floor(value), 0, 999) : 0;
};

export const buildSmartProductQrPath = ({ productId, variantId = null, colorId = null } = {}) => {
  const normalizedProductId = String(productId || "").trim();
  if (!normalizedProductId) return "";
  return `/qr/product/${encodeURIComponent(normalizedProductId)}${buildQueryString([
    ["variantId", variantId],
    ["colorId", colorId],
  ])}`;
};

export const buildSmartProductQrUrl = ({ productId, variantId = null, colorId = null } = {}) => {
  const path = buildSmartProductQrPath({ productId, variantId, colorId });
  if (!path) return "";
  return `${resolveStorefrontOrigin()}${path}`;
};

export const buildLabelItem = (product, variant = null, quantity = 1) => {
  const displayBarcodeInfo = resolveLabelDisplayBarcode(product, variant);
  const displayBarcode = displayBarcodeInfo.value;
  const articleCode = resolveLabelArticleCode({
    article_code: variant?.article_code ?? product?.article_code ?? "",
    articleCode: variant?.articleCode ?? product?.articleCode ?? "",
    color_article_code:
      variant?.color_article_code ??
      variant?.colorGroup?.article_code ??
      product?.color_article_code ??
      product?.colorGroup?.article_code ??
      "",
    colorArticleCode:
      variant?.colorArticleCode ??
      variant?.colorGroup?.articleCode ??
      product?.colorArticleCode ??
      product?.colorGroup?.articleCode ??
      "",
  });
  const sourceVariantImage = firstText(variant?.variant_image_url, variant?.color_image_url, variant?.image_url, variant?.image, variant?.colorGroup?.image_url);
  const sourceProductImage = firstText(product?.product_image_url, product?.image_url, product?.image, product?.photo_url, product?.thumbnail_url);
  const sourceVariantThermalImage = firstText(
    variant?.color_thermal_image_url,
    variant?.variant_color_thermal_image_url,
    variant?.thermal_image_url,
    variant?.thermalImageUrl,
    variant?.colorGroup?.thermal_image_url,
    variant?.colorGroup?.thermalImageUrl
  );
  const sourceProductThermalImage = firstText(product?.thermal_image_url, product?.thermalImageUrl);
  const sourceVariantThermalStatus = firstText(variant?.thermal_image_status, variant?.thermalImageStatus);
  const sourceProductThermalStatus = firstText(product?.thermal_image_status, product?.thermalImageStatus);
  const resolvedImage = resolveBarcodeLabelImage({
    ...product,
    ...variant,
    colorPrimaryImageUrl: sourceVariantImage,
    color_image_url: sourceVariantImage,
    image_url: sourceVariantImage,
    product_image_url: sourceProductImage,
    thermal_image_url: sourceVariantThermalImage || sourceProductThermalImage,
    product_thermal_image_url: sourceProductThermalImage,
    variant_color_thermal_image_url: sourceVariantThermalImage,
    color_thermal_image_url: sourceVariantThermalImage,
    thermal_image_status: sourceVariantThermalStatus || sourceProductThermalStatus,
    variant_thermal_image_status: sourceVariantThermalStatus,
    product_thermal_image_status: sourceProductThermalStatus,
  });
  console.info("[barcode-labels] label barcode source", {
    productId: product?.id ?? product?.product_id,
    variantId: variant?.variant_id ?? variant?.id,
    displayBarcode,
    source: displayBarcodeInfo.source,
  });
  const priceInfo = getLabelPriceInfo(product, variant);
  return {
    key: getLabelIdentity(product, variant),
    productId: product?.id,
    variantId: variant?.variant_id ?? variant?.id ?? null,
    colorId: variant?.color_id ?? variant?.colorId ?? null,
    slug: product?.slug || product?.canonical_slug || "",
    productName: product?.name || "Unnamed product",
    brand: product?.brand || "Brand",
    category: product?.category || "Category",
    color: variant?.color || product?.color || "Default",
    size: variant?.size || product?.size || "One size",
    article_code: articleCode,
    articleCode,
    color_article_code:
      firstText(
        variant?.color_article_code,
        variant?.colorGroup?.article_code,
        product?.color_article_code,
        product?.colorGroup?.article_code
      ),
    colorArticleCode:
      firstText(
        variant?.colorArticleCode,
        variant?.colorGroup?.articleCode,
        product?.colorArticleCode,
        product?.colorGroup?.articleCode
      ),
    sku: getLabelSku(product, variant),
    barcode: displayBarcode,
    barcodeValue: normalizeBarcode(displayBarcode, `${product?.id ?? ""}${variant?.variant_id ?? variant?.id ?? ""}`),
    barcodeSource: displayBarcodeInfo.source,
    salePrice: priceInfo.price,
    effectivePrice: priceInfo.price,
    displayPrice: priceInfo.price,
    comparePrice: priceInfo.comparePrice,
    saleActive: priceInfo.saleActive,
    stock: Number(variant?.stock ?? product?.stock ?? 0),
    sourceVariantImage,
    sourceProductImage,
    sourceVariantThermalImage,
    sourceProductThermalImage,
    sourceVariantThermalStatus,
    sourceProductThermalStatus,
    thermal_image_status: sourceVariantThermalStatus || sourceProductThermalStatus || "",
    variant_thermal_image_status: sourceVariantThermalStatus || "",
    product_thermal_image_status: sourceProductThermalStatus || "",
    color_thermal_image_url: sourceVariantThermalImage || "",
    variant_color_thermal_image_url: sourceVariantThermalImage || "",
    thermal_image_url: sourceVariantThermalImage || sourceProductThermalImage || "",
    product_thermal_image_url: sourceProductThermalImage || "",
    colorPrimaryImageUrl: sourceVariantImage || "",
    color_image_url: sourceVariantImage || "",
    resolvedImage,
    imageUrl: resolvedImage,
    thermalImageUrl: sourceVariantThermalImage || sourceProductThermalImage || "",
    productThermalImageUrl: sourceProductThermalImage || "",
    colorThermalImageUrl: sourceVariantThermalImage || "",
    variantThermalImageUrl: sourceVariantThermalImage || "",
    colorPrimaryImageUrl: sourceVariantImage || "",
    variantColorImageUrl: sourceVariantImage || "",
    productImageUrl: sourceProductImage || "",
    companyName: product?.companyName || APP_NAME,
    companyTagline: product?.companyTagline || "Retail barcode label system",
    quantity: getLabelQuantity(quantity),
    smartQrUrl: buildSmartProductQrUrl({
      productId: product?.id,
      variantId: variant?.variant_id ?? variant?.id ?? null,
      colorId: variant?.color_id ?? variant?.colorId ?? null,
    }),
  };
};

export const buildSelectedLabelItems = (catalog = [], selections = {}) => {
  const items = [];

  catalog.forEach((product) => {
    const variants = Array.isArray(product?.variants) && product.variants.length > 0
      ? product.variants
      : [null];

    variants.forEach((variant) => {
      const key = getLabelIdentity(product, variant);
      const quantity = getLabelQuantity(selections[key]);
      if (quantity <= 0) return;

      items.push(buildLabelItem(product, variant, quantity));
    });
  });

  return items;
};

export const buildProductLabelItems = ({
  product = null,
  availableOnly = false,
} = {}) => {
  if (!product) return [];

  const variants = Array.isArray(product?.variants) && product.variants.length > 0
    ? product.variants
    : [null];

  const filteredVariants = variants.filter((variant) => {
    if (!availableOnly) return true;
    if (!variant) return Number(product?.stock || 0) > 0;
    return Number(variant.stock || 0) > 0;
  });

  const labelItems = filteredVariants.flatMap((variant) => {
    const availableQty = variant ? Number(variant.stock || 0) : Number(product?.stock || 0);
    const quantity = availableOnly ? availableQty : 1;

    if (quantity <= 0) return [];

    return [buildLabelItem(product, variant, quantity)];
  });

  return labelItems;
};

export const getBarcodeShopQrValue = (product = {}) =>
  product?.slug || product?.canonical_slug || (product?.id ? String(product.id) : "");

export const getBarcodeShopQrUrl = (product = {}, options = {}) => {
  const productId = product?.id ?? product?.product_id ?? "";
  if (!productId) return "";
  return buildSmartProductQrUrl({
    productId,
    variantId: options?.variantId ?? null,
    colorId: options?.colorId ?? null,
  });
};

export const buildBarcodeShopLabelItem = (product = null, quantity = 1, variantFallback = null) => {
  if (!product) return null;
  const qrToken = getBarcodeShopQrValue(product);
  const variantId = variantFallback?.variant_id ?? variantFallback?.id ?? null;
  const colorId = variantFallback?.color_id ?? variantFallback?.colorId ?? null;
  const priceInfo = getProductFirstLabelPriceInfo(product, variantFallback);
  const productImage = firstText(product?.product_image_url, product?.image_url, product?.image, product?.photo_url, product?.thumbnail_url);
  const thermalImage = firstText(
    variantFallback?.color_thermal_image_url,
    variantFallback?.variant_color_thermal_image_url,
    variantFallback?.thermal_image_url,
    product?.thermal_image_url,
    product?.thermalImageUrl
  );
  const thermalImageStatus = firstText(
    variantFallback?.thermal_image_status,
    variantFallback?.variant_thermal_image_status,
    product?.thermal_image_status,
    product?.thermalImageStatus
  );
  const resolvedImage = resolveBarcodeLabelImage({
    ...product,
    ...variantFallback,
    colorPrimaryImageUrl: firstText(variantFallback?.variant_image_url, variantFallback?.color_image_url, variantFallback?.image_url, variantFallback?.image),
    color_image_url: firstText(variantFallback?.color_image_url, variantFallback?.variant_image_url, variantFallback?.image_url, variantFallback?.image),
    image_url: firstText(variantFallback?.variant_image_url, variantFallback?.color_image_url, variantFallback?.image_url, variantFallback?.image),
    product_image_url: productImage,
    thermal_image_url: thermalImage,
    product_thermal_image_url: firstText(product?.thermal_image_url, product?.thermalImageUrl),
    thermal_image_status: thermalImageStatus,
    variant_thermal_image_status: firstText(variantFallback?.thermal_image_status, variantFallback?.variant_thermal_image_status),
    product_thermal_image_status: firstText(product?.thermal_image_status, product?.thermalImageStatus),
    color_thermal_image_url: thermalImage,
    variant_color_thermal_image_url: thermalImage,
  });
  return {
    key: `barcode-shop:${product.id}`,
    productId: product.id,
    variantId,
    colorId,
    slug: product?.slug || product?.canonical_slug || "",
    productName: product.name || "Unnamed product",
    brand: product.brand || "Brand",
    category: product.category || "Category",
    article_code: resolveLabelArticleCode({
      article_code: variantFallback?.article_code ?? product?.article_code ?? "",
      articleCode: variantFallback?.articleCode ?? product?.articleCode ?? "",
      color_article_code:
        variantFallback?.color_article_code ??
        variantFallback?.colorGroup?.article_code ??
        product?.color_article_code ??
        product?.colorGroup?.article_code ??
        "",
      colorArticleCode:
        variantFallback?.colorArticleCode ??
        variantFallback?.colorGroup?.articleCode ??
        product?.colorArticleCode ??
        product?.colorGroup?.articleCode ??
        "",
    }),
    articleCode: resolveLabelArticleCode({
      article_code: variantFallback?.article_code ?? product?.article_code ?? "",
      articleCode: variantFallback?.articleCode ?? product?.articleCode ?? "",
      color_article_code:
        variantFallback?.color_article_code ??
        variantFallback?.colorGroup?.article_code ??
        product?.color_article_code ??
        product?.colorGroup?.article_code ??
        "",
      colorArticleCode:
        variantFallback?.colorArticleCode ??
        variantFallback?.colorGroup?.articleCode ??
        product?.colorArticleCode ??
        product?.colorGroup?.articleCode ??
        "",
    }),
    qrToken,
    qrValue: getBarcodeShopQrUrl(product, { variantId, colorId }),
    salePrice: priceInfo.price,
    effectivePrice: priceInfo.price,
    displayPrice: priceInfo.price,
    comparePrice: priceInfo.comparePrice,
    saleActive: priceInfo.saleActive,
    priceSource: priceInfo.saleActive || priceInfo.price > 0 ? "product-first" : "none",
    thermalImageUrl: thermalImage || "",
    thermal_image_url: thermalImage || "",
    thermal_image_status: thermalImageStatus || "",
    product_thermal_image_url: firstText(product?.thermal_image_url, product?.thermalImageUrl) || "",
    product_thermal_image_status: firstText(product?.thermal_image_status, product?.thermalImageStatus) || "",
    color_thermal_image_url: thermalImage || "",
    variant_color_thermal_image_url: thermalImage || "",
    colorPrimaryImageUrl: firstText(variantFallback?.variant_image_url, variantFallback?.color_image_url, variantFallback?.image_url, variantFallback?.image) || "",
    color_image_url: firstText(variantFallback?.color_image_url, variantFallback?.variant_image_url, variantFallback?.image_url, variantFallback?.image) || "",
    imageUrl: resolvedImage,
    resolvedImage,
    product_image_url: productImage,
    productImageUrl: productImage,
    companyName: product.companyName || APP_NAME,
    quantity: getLabelQuantity(quantity) || 1,
    smartQrUrl: buildSmartProductQrUrl({ productId: product.id, variantId, colorId }),
  };
};

export const expandLabelCopies = (items = []) =>
  items.flatMap((item) =>
    Array.from({ length: getLabelQuantity(item.quantity) }, (_, copyIndex) => ({
      ...item,
      copyIndex: copyIndex + 1,
    }))
  );

export const getBarcodeSvg = (value, { width = 360, height = 92, displayText = "" } = {}) => {
  const parts = buildBarcodeSvgParts(value, { width, height, displayText });
  return `
    <svg viewBox="0 0 ${parts.safeWidth} ${parts.safeHeight}" width="${parts.safeWidth}" height="${parts.safeHeight}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${parts.text}">
      <rect width="${parts.safeWidth}" height="${parts.safeHeight}" fill="#ffffff" />
      ${parts.bars}
      <text x="${parts.safeWidth / 2}" y="${Math.max(0, parts.safeHeight - 6)}" text-anchor="middle" fill="#111827" font-family="Arial, sans-serif" font-size="12" font-weight="700">${escapeHtml(parts.text)}</text>
    </svg>
  `;
};

const buildBarcodeSvgParts = (value, { width = 360, height = 92, displayText = "", barTop = 14, barHeight } = {}) => {
  const safeWidth = Math.max(1, Number(width || 360));
  const safeHeight = Math.max(34, Number(height || 92));
  const barcode = normalizeBarcode(value, displayText);
  const text = displayText || barcode;
  const quietZone = 10;
  const codes = [Code128Reader.CODE_START_B];

  for (const char of barcode) {
    const charCode = char.charCodeAt(0);
    const codeValue = charCode >= 32 && charCode <= 126 ? charCode - 32 : 0;
    codes.push(codeValue);
  }

  const checksum = codes.reduce((sum, code, index) => {
    if (index === 0) return code;
    return sum + (code * index);
  }, 0) % 103;
  codes.push(checksum, Code128Reader.CODE_STOP);

  const moduleCount = codes.reduce((sum, code) => {
    const pattern = Code128Reader.CODE_PATTERNS[code] || [];
    return sum + pattern.reduce((widthSum, moduleWidth) => widthSum + moduleWidth, 0);
  }, 0);
  const moduleWidth = Math.max(0.8, (safeWidth - quietZone * 2) / Math.max(1, moduleCount));
  const barY = Number.isFinite(Number(barTop)) ? Number(barTop) : 14;
  const barRectHeight = Number.isFinite(Number(barHeight)) ? Math.max(0, Number(barHeight)) : Math.max(0, safeHeight - 30);

  let cursorX = quietZone;
  let bars = "";
  codes.forEach((code, codeIndex) => {
    const pattern = Code128Reader.CODE_PATTERNS[code] || [];
    pattern.forEach((segmentWidth, segmentIndex) => {
      const widthPx = segmentWidth * moduleWidth;
      if (segmentIndex % 2 === 0) {
        bars += `<rect x="${cursorX.toFixed(3)}" y="${barY.toFixed(3)}" width="${widthPx.toFixed(3)}" height="${barRectHeight.toFixed(3)}" fill="#111827" />`;
      }
      cursorX += widthPx;
    });
    if (codeIndex < codes.length - 1) {
      cursorX += 0;
    }
  });
  return {
    safeWidth,
    safeHeight,
    barcode,
    text,
    bars,
  };
};

const splitSvgText = (value = "", maxLineLength = 24, maxLines = 2) => {
  const normalized = String(value || "").trim();
  if (!normalized) return [];

  const words = normalized.split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";

  words.forEach((word) => {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxLineLength || !current) {
      current = candidate;
      return;
    }

    lines.push(current);
    current = word;
  });

  if (current) lines.push(current);

  if (lines.length <= maxLines) return lines;
  const clipped = lines.slice(0, maxLines);
  clipped[maxLines - 1] = `${clipped[maxLines - 1].slice(0, Math.max(0, maxLineLength - 1)).trimEnd()}…`;
  return clipped;
};

const formatDisplayColor = (value = "") => {
  const text = String(value || "").trim();
  if (!text) return "";
  if (/[\u0600-\u06FF]/.test(text)) return text;
  return text.toUpperCase();
};

const THERMAL_LANDSCAPE_PAGE = Object.freeze({ width: 100, height: 50 });
const THERMAL_LANDSCAPE_MARGIN_MM = 2;
const THERMAL_LANDSCAPE_GAP_MM = 1;
const THERMAL_LANDSCAPE_ROW_GAP_MM = 1.2;
const THERMAL_LANDSCAPE_IMAGE_WIDTH_MM = 34.6;
const THERMAL_LANDSCAPE_TITLE_HEIGHT_MM = 8.4;
const THERMAL_LANDSCAPE_SIZE_HEIGHT_MM = 13;
const THERMAL_LANDSCAPE_COLOR_HEIGHT_MM = 8.8;
const THERMAL_LANDSCAPE_SIZE_BOX_WIDTH_FACTOR = 1;
const THERMAL_LANDSCAPE_BARCODE_X_MM = 5;
const THERMAL_LANDSCAPE_BARCODE_W_MM = 90;
const THERMAL_LANDSCAPE_BARCODE_H_MM = 7;
const THERMAL_LANDSCAPE_BARCODE_TEXT_Y_MM = 48.8;
const THERMAL_LANDSCAPE_TITLE_FONT_SIZE = 11.4;
const THERMAL_LANDSCAPE_TITLE_LINE_HEIGHT = 1.08;
const THERMAL_LANDSCAPE_TITLE_LINE_STEP_MM = 4.15;
const THERMAL_LANDSCAPE_TITLE_MAX_LINES = 2;
const THERMAL_LANDSCAPE_SIZE_LABEL_FONT_SIZE = 4.8;
const THERMAL_LANDSCAPE_SIZE_VALUE_FONT_SIZE = 25;
const THERMAL_LANDSCAPE_ARTICLE_LABEL_FONT_SIZE = 4.7;
const THERMAL_LANDSCAPE_ARTICLE_VALUE_FONT_SIZE = 11.2;
const THERMAL_LANDSCAPE_ARTICLE_VALUE_FONT_SIZE_COMPACT = 10;
const THERMAL_LANDSCAPE_COLOR_LABEL_FONT_SIZE = 4.4;
const THERMAL_LANDSCAPE_COLOR_VALUE_FONT_SIZE = 13;

const buildThermalLandscapeCellLayout = (hasArticleBox = false) => {
  const imageCell = Object.freeze({
    x: THERMAL_LANDSCAPE_MARGIN_MM,
    y: 3,
    w: THERMAL_LANDSCAPE_IMAGE_WIDTH_MM,
    h: THERMAL_LANDSCAPE_TITLE_HEIGHT_MM + THERMAL_LANDSCAPE_SIZE_HEIGHT_MM + THERMAL_LANDSCAPE_COLOR_HEIGHT_MM + (THERMAL_LANDSCAPE_ROW_GAP_MM * 2),
  });
  const dataCellX = imageCell.x + imageCell.w + THERMAL_LANDSCAPE_GAP_MM;
  const dataCellW = THERMAL_LANDSCAPE_PAGE.width - THERMAL_LANDSCAPE_MARGIN_MM - dataCellX;
  const titleCell = Object.freeze({
    x: dataCellX,
    y: imageCell.y,
    w: dataCellW,
    h: THERMAL_LANDSCAPE_TITLE_HEIGHT_MM,
  });
  const sizeCellWidth = hasArticleBox ? 30 : dataCellW;
  const articleCellWidth = hasArticleBox ? Math.max(0, dataCellW - sizeCellWidth - THERMAL_LANDSCAPE_GAP_MM) : 0;
  const sizeCell = Object.freeze({
    x: dataCellX,
    y: titleCell.y + titleCell.h + THERMAL_LANDSCAPE_ROW_GAP_MM,
    w: sizeCellWidth,
    h: THERMAL_LANDSCAPE_SIZE_HEIGHT_MM,
  });
  const articleCell = Object.freeze({
    x: dataCellX + sizeCellWidth + THERMAL_LANDSCAPE_GAP_MM,
    y: sizeCell.y,
    w: articleCellWidth,
    h: THERMAL_LANDSCAPE_SIZE_HEIGHT_MM,
  });
  const colorCell = Object.freeze({
    x: dataCellX,
    y: sizeCell.y + sizeCell.h + THERMAL_LANDSCAPE_ROW_GAP_MM,
    w: dataCellW,
    h: THERMAL_LANDSCAPE_COLOR_HEIGHT_MM,
  });
  const barcodeCell = Object.freeze({
    x: THERMAL_LANDSCAPE_BARCODE_X_MM,
    y: 39.8,
    w: THERMAL_LANDSCAPE_BARCODE_W_MM,
    h: THERMAL_LANDSCAPE_BARCODE_H_MM,
    textY: THERMAL_LANDSCAPE_BARCODE_TEXT_Y_MM,
    fontSize: 7.2,
  });

  return Object.freeze({
    page: THERMAL_LANDSCAPE_PAGE,
    margin: THERMAL_LANDSCAPE_MARGIN_MM,
    gap: THERMAL_LANDSCAPE_GAP_MM,
    rowGap: THERMAL_LANDSCAPE_ROW_GAP_MM,
    imageCell,
    titleCell,
    sizeCell,
    articleCell,
    colorCell,
    barcodeCell,
    titleFontSize: THERMAL_LANDSCAPE_TITLE_FONT_SIZE,
    titleLineHeight: THERMAL_LANDSCAPE_TITLE_LINE_HEIGHT,
    titleLineStepMm: THERMAL_LANDSCAPE_TITLE_LINE_STEP_MM,
    titleMaxLines: THERMAL_LANDSCAPE_TITLE_MAX_LINES,
    sizeLabelFontSize: THERMAL_LANDSCAPE_SIZE_LABEL_FONT_SIZE,
    sizeValueFontSize: THERMAL_LANDSCAPE_SIZE_VALUE_FONT_SIZE,
    articleLabelFontSize: THERMAL_LANDSCAPE_ARTICLE_LABEL_FONT_SIZE,
    articleFontSize: THERMAL_LANDSCAPE_ARTICLE_VALUE_FONT_SIZE,
    articleFontSizeCompact: THERMAL_LANDSCAPE_ARTICLE_VALUE_FONT_SIZE_COMPACT,
    colorLabelFontSize: THERMAL_LANDSCAPE_COLOR_LABEL_FONT_SIZE,
    colorValueFontSize: THERMAL_LANDSCAPE_COLOR_VALUE_FONT_SIZE,
    sizeBoxWidthFactor: THERMAL_LANDSCAPE_SIZE_BOX_WIDTH_FACTOR,
    sizeBadgeWidth: sizeCell.w,
    sizeBadgeHeight: sizeCell.h,
    articleBoxWidth: articleCell.w,
    articleBoxHeight: articleCell.h,
    colorBoxHeight: colorCell.h,
    titleWidth: titleCell.w,
    imageWidth: imageCell.w,
    imageHeight: imageCell.h,
  });
};

export const getBoxTextLayout = (cell = {}, options = {}) => {
  const cellY = Number(cell?.y || 0);
  const topPaddingMm = Number(options.topPaddingMm ?? 1.5);
  const labelGapMm = Number(options.labelGapMm ?? 1.0);
  const labelFontSize = Number(options.labelFontSize ?? 4);
  const valueFontSize = Number(options.valueFontSize ?? 10);
  const valueFontSizeCompact = Number(options.valueFontSizeCompact ?? valueFontSize);
  const labelTextY = cellY + topPaddingMm + Math.max(1.5, labelFontSize * 0.55);
  const valueTopMm = cellY + topPaddingMm + Math.max(3.0, labelFontSize * 0.95) + labelGapMm;
  const valueTextY = valueTopMm + Math.min(4.5, Math.max(2.6, valueFontSize * 0.28));
  return Object.freeze({
    topPaddingMm,
    labelGapMm,
    labelFontSize,
    valueFontSize,
    valueFontSizeCompact,
    labelTopMm: cellY + topPaddingMm,
    valueTopMm,
    labelTextY,
    valueTextY,
  });
};

export const getBoxFrameLayout = (cell = {}, options = {}) => {
  const boxWidthFactor = Number(options.boxWidthFactor ?? 1);
  const boxHeightFactor = Number(options.boxHeightFactor ?? 1);
  const boxOffsetX = Number(options.boxOffsetX ?? 0);
  const boxOffsetY = Number(options.boxOffsetY ?? 0);
  const width = Number(cell?.w || 0) * boxWidthFactor;
  const height = Number(cell?.h || 0) * boxHeightFactor;
  return Object.freeze({
    x: Number(cell?.x || 0) + ((Number(cell?.w || 0) - width) / 2) + boxOffsetX,
    y: Number(cell?.y || 0) + ((Number(cell?.h || 0) - height) / 2) + boxOffsetY,
    w: width,
    h: height,
  });
};

export const BARCODE_LABEL_LAYOUT = Object.freeze({
  page: THERMAL_LANDSCAPE_PAGE,
  image: { x: THERMAL_LANDSCAPE_MARGIN_MM, y: 3, w: THERMAL_LANDSCAPE_IMAGE_WIDTH_MM, h: THERMAL_LANDSCAPE_TITLE_HEIGHT_MM + THERMAL_LANDSCAPE_SIZE_HEIGHT_MM + THERMAL_LANDSCAPE_COLOR_HEIGHT_MM + (THERMAL_LANDSCAPE_ROW_GAP_MM * 2) },
  title: { x: THERMAL_LANDSCAPE_MARGIN_MM + THERMAL_LANDSCAPE_IMAGE_WIDTH_MM + THERMAL_LANDSCAPE_GAP_MM, y: 3, w: THERMAL_LANDSCAPE_PAGE.width - THERMAL_LANDSCAPE_MARGIN_MM - (THERMAL_LANDSCAPE_MARGIN_MM + THERMAL_LANDSCAPE_IMAGE_WIDTH_MM + THERMAL_LANDSCAPE_GAP_MM), fontSize: THERMAL_LANDSCAPE_TITLE_FONT_SIZE, lineHeight: THERMAL_LANDSCAPE_TITLE_LINE_HEIGHT, lineStepMm: THERMAL_LANDSCAPE_TITLE_LINE_STEP_MM, maxLines: THERMAL_LANDSCAPE_TITLE_MAX_LINES },
  sizeBadge: {
    x: THERMAL_LANDSCAPE_MARGIN_MM + THERMAL_LANDSCAPE_IMAGE_WIDTH_MM + THERMAL_LANDSCAPE_GAP_MM,
    y: 12.6,
    w: 60.4,
    wWithArticle: 30,
    h: THERMAL_LANDSCAPE_SIZE_HEIGHT_MM,
    widthFactor: THERMAL_LANDSCAPE_SIZE_BOX_WIDTH_FACTOR,
    labelFontSize: THERMAL_LANDSCAPE_SIZE_LABEL_FONT_SIZE,
    valueFontSize: THERMAL_LANDSCAPE_SIZE_VALUE_FONT_SIZE,
  },
  articleBox: {
    x: THERMAL_LANDSCAPE_MARGIN_MM + THERMAL_LANDSCAPE_IMAGE_WIDTH_MM + THERMAL_LANDSCAPE_GAP_MM + 30 + THERMAL_LANDSCAPE_GAP_MM,
    y: 12.6,
    w: 29.4,
    h: THERMAL_LANDSCAPE_SIZE_HEIGHT_MM,
    labelFontSize: THERMAL_LANDSCAPE_ARTICLE_LABEL_FONT_SIZE,
    valueFontSize: THERMAL_LANDSCAPE_ARTICLE_VALUE_FONT_SIZE,
    valueFontSizeCompact: THERMAL_LANDSCAPE_ARTICLE_VALUE_FONT_SIZE_COMPACT,
  },
  colorBox: { x: THERMAL_LANDSCAPE_MARGIN_MM + THERMAL_LANDSCAPE_IMAGE_WIDTH_MM + THERMAL_LANDSCAPE_GAP_MM, y: 26.8, w: THERMAL_LANDSCAPE_PAGE.width - THERMAL_LANDSCAPE_MARGIN_MM - (THERMAL_LANDSCAPE_MARGIN_MM + THERMAL_LANDSCAPE_IMAGE_WIDTH_MM + THERMAL_LANDSCAPE_GAP_MM), h: THERMAL_LANDSCAPE_COLOR_HEIGHT_MM, labelFontSize: THERMAL_LANDSCAPE_COLOR_LABEL_FONT_SIZE, valueFontSize: THERMAL_LANDSCAPE_COLOR_VALUE_FONT_SIZE },
  barcode: { x: THERMAL_LANDSCAPE_BARCODE_X_MM, y: 39.8, w: THERMAL_LANDSCAPE_BARCODE_W_MM, h: THERMAL_LANDSCAPE_BARCODE_H_MM, textY: THERMAL_LANDSCAPE_BARCODE_TEXT_Y_MM, fontSize: 7.2 },
  articleLabelFontSize: THERMAL_LANDSCAPE_ARTICLE_LABEL_FONT_SIZE,
});

export const THERMAL_LANDSCAPE_LABEL_LAYOUT = Object.freeze({
  titleFontSize: BARCODE_LABEL_LAYOUT.title.fontSize,
  titleLineHeight: BARCODE_LABEL_LAYOUT.title.lineHeight,
  titleLineStepMm: BARCODE_LABEL_LAYOUT.title.lineStepMm,
  titleMaxLines: BARCODE_LABEL_LAYOUT.title.maxLines,
  titleWidth: BARCODE_LABEL_LAYOUT.title.w,
  imageWidth: BARCODE_LABEL_LAYOUT.image.w,
  imageHeight: BARCODE_LABEL_LAYOUT.image.h,
  sizeBadgeWidthWithArticle: BARCODE_LABEL_LAYOUT.sizeBadge.wWithArticle,
  sizeBadgeWidthWithoutArticle: BARCODE_LABEL_LAYOUT.sizeBadge.w,
  sizeBadgeHeight: BARCODE_LABEL_LAYOUT.sizeBadge.h,
  articleBoxWidth: BARCODE_LABEL_LAYOUT.articleBox.w,
  articleBoxHeight: BARCODE_LABEL_LAYOUT.articleBox.h,
  colorBoxHeight: BARCODE_LABEL_LAYOUT.colorBox.h,
  articleFontSize: BARCODE_LABEL_LAYOUT.articleBox.valueFontSize,
  articleFontSizeCompact: BARCODE_LABEL_LAYOUT.articleBox.valueFontSizeCompact,
  sizeLabelFontSize: BARCODE_LABEL_LAYOUT.sizeBadge.labelFontSize,
  sizeValueFontSize: BARCODE_LABEL_LAYOUT.sizeBadge.valueFontSize,
  colorLabelFontSize: BARCODE_LABEL_LAYOUT.colorBox.labelFontSize,
  colorValueFontSize: BARCODE_LABEL_LAYOUT.colorBox.valueFontSize,
  articleLabelFontSize: BARCODE_LABEL_LAYOUT.articleLabelFontSize,
});

export const getThermalLandscapeLabelLayout = (hasArticleBox = false) => ({
  ...THERMAL_LANDSCAPE_LABEL_LAYOUT,
  ...buildThermalLandscapeCellLayout(hasArticleBox),
});

export const buildLandscapePrintSvg = (item, printCopy = {}) => {
  const productName = String(item?.productName || "").trim();
  const sizeValue = String(item?.size || "ONE SIZE").trim() || "ONE SIZE";
  const colorValue = formatDisplayColor(item?.color || "");
  const skuValue = resolveLabelArticleCode(item);
  const barcodeValue = String(item?.barcode || "").trim();
  const imageUrl = String(item?.imageUrl || item?.resolvedImage || "").trim();
  const hasArticleBox = Boolean(skuValue);
  const layout = getThermalLandscapeLabelLayout(hasArticleBox);
  const { imageCell, titleCell, sizeCell, articleCell, colorCell, barcodeCell } = layout;
  const productLines = splitSvgText(productName, titleCell.w / 2.55, layout.titleMaxLines);
  const articleBaseFontSize = Math.max(layout.sizeValueFontSize * 0.92, layout.articleFontSize);
  const articleFontSize = Math.max(layout.articleFontSizeCompact, articleBaseFontSize - Math.max(0, skuValue.length - 10) * 0.08);
  const barcodeParts = buildBarcodeSvgParts(item?.barcodeValue, {
    width: barcodeCell.w + 2,
    height: 8,
    displayText: barcodeValue,
    barTop: barcodeCell.y,
    barHeight: barcodeCell.h,
  });

  const productText = productLines.length
    ? productLines.map((line, index) => `<text x="${titleCell.x}" y="${titleCell.y + (index * layout.titleLineStepMm)}" fill="#020617" font-family="Arial, Helvetica, sans-serif" font-size="${index === 0 ? layout.titleFontSize * 0.46 : layout.titleFontSize * 0.4}" font-weight="900">${escapeHtml(line)}</text>`).join("")
    : `<text x="${titleCell.x}" y="${titleCell.y}" fill="#020617" font-family="Arial, Helvetica, sans-serif" font-size="${layout.titleFontSize * 0.46}" font-weight="900">${escapeHtml("Unnamed product")}</text>`;

  return `
    <svg class="barcode-print-svg" xmlns="http://www.w3.org/2000/svg" width="100mm" height="50mm" viewBox="0 0 100 50" preserveAspectRatio="none" role="img" aria-label="${escapeHtml(productName || barcodeValue || "Barcode label")}">
      <rect x="0" y="0" width="100" height="50" fill="#ffffff" />
      <rect x="0.4" y="0.4" width="99.2" height="49.2" fill="none" stroke="#e2e8f0" stroke-width="0.25" />

      ${imageUrl ? `<image href="${escapeHtml(imageUrl)}" x="${imageCell.x}" y="${imageCell.y}" width="${imageCell.w}" height="${imageCell.h}" preserveAspectRatio="xMidYMid meet" />` : `<rect x="${imageCell.x}" y="${imageCell.y}" width="${imageCell.w}" height="${imageCell.h}" fill="#f8fafc" stroke="#e2e8f0" stroke-width="0.25" />`}

      ${productText}

      <rect x="${sizeCell.x}" y="${sizeCell.y}" width="${layout.sizeBadgeWidth}" height="${layout.sizeBadgeHeight}" rx="1.8" fill="#020617" />
      <text x="${sizeCell.x + (layout.sizeBadgeWidth / 2)}" y="${sizeCell.y + 3.2}" text-anchor="middle" fill="#cbd5e1" font-family="Arial, Helvetica, sans-serif" font-size="${layout.sizeLabelFontSize * 0.52}" font-weight="900" letter-spacing="0.28">${escapeHtml(printCopy.size || "SIZE")}</text>
      <text x="${sizeCell.x + (layout.sizeBadgeWidth / 2)}" y="${sizeCell.y + 9.3}" text-anchor="middle" fill="#ffffff" font-family="Arial, Helvetica, sans-serif" font-size="${layout.sizeValueFontSize * 0.432}" font-weight="900">${escapeHtml(sizeValue)}</text>
      ${hasArticleBox ? `
      <rect x="${articleCell.x}" y="${articleCell.y}" width="${layout.articleBoxWidth}" height="${layout.articleBoxHeight}" rx="1.8" fill="#020617" stroke="#020617" stroke-width="0.18" />
      <text x="${articleCell.x + (layout.articleBoxWidth / 2)}" y="${articleCell.y + 3.2}" text-anchor="middle" fill="#cbd5e1" font-family="Arial, Helvetica, sans-serif" font-size="${layout.articleLabelFontSize * 0.52}" font-weight="900" letter-spacing="0.2">ARTICLE CODE</text>
      <text x="${articleCell.x + (layout.articleBoxWidth / 2)}" y="${articleCell.y + 9.3}" text-anchor="middle" fill="#ffffff" font-family="Arial, Helvetica, sans-serif" font-size="${articleFontSize}" font-weight="900">${escapeHtml(skuValue)}</text>
      ` : ""}

      <rect x="${colorCell.x}" y="${colorCell.y}" width="${colorCell.w}" height="${layout.colorBoxHeight}" rx="1" fill="#020617" stroke="#020617" stroke-width="0.18" />
      <text x="${colorCell.x + 1.2}" y="${colorCell.y + (layout.colorBoxHeight / 2) + 0.15}" text-anchor="start" dominant-baseline="middle" fill="#cbd5e1" font-family="Arial, Helvetica, sans-serif" font-size="${layout.colorLabelFontSize * 0.68}" font-weight="900" letter-spacing="0.2">${escapeHtml(printCopy.color || "COLOR")}</text>
      <text x="${colorCell.x + 18.2}" y="${colorCell.y + (layout.colorBoxHeight / 2) + 0.15}" text-anchor="start" dominant-baseline="middle" fill="#ffffff" font-family="Arial, Helvetica, sans-serif" font-size="${Math.max(layout.sizeValueFontSize * 0.9, layout.colorValueFontSize * 1.45)}" font-weight="900">${escapeHtml(colorValue)}</text>

      ${hasArticleBox ? "" : `<text x="${layout.page.width / 2}" y="${barcodeCell.y - 0.1}" text-anchor="middle" fill="#111827" font-family="Arial, Helvetica, sans-serif" font-size="4.6" font-weight="900">${escapeHtml(skuValue)}</text>`}
      ${barcodeParts.bars}
      <text x="${layout.page.width / 2}" y="${barcodeCell.textY}" text-anchor="middle" fill="#111827" font-family="Arial, Helvetica, sans-serif" font-size="${barcodeCell.fontSize * 0.42}" font-weight="900">${escapeHtml(barcodeValue)}</text>
    </svg>
  `;
};

export const buildBarcodePrintHtml = ({
  labels = [],
  sheetMode = "a4",
  template = LABEL_TEMPLATE_STANDARD,
  printSettings = {},
  copy = {},
  previewTitle = "طباعة الباركود",
  previewBackUrl = "",
  showPreviewChrome = false,
} = {}) => {
  const printCopy = {
    title: "",
    color: "",
    size: "",
    sku: "",
    price: "",
    ...copy,
  };
  const resolvedTemplate = String(template || LABEL_TEMPLATE_STANDARD).trim().toLowerCase();
  const baseSettings = normalizeBarcodePrintSettings({ ...printSettings, paperSize: sheetMode });
  const isLandscapeTemplate = resolvedTemplate === LABEL_TEMPLATE_THERMAL_LANDSCAPE_50X100;
  const useThermalArtwork = ENABLE_THERMAL_ARTWORK && isThermalArtworkTemplate(resolvedTemplate);
  const normalizedSettings = isLandscapeTemplate
    ? normalizeBarcodePrintSettings({
        ...baseSettings,
        paperSize: "custom",
        customPaperWidthMm: 100,
        customPaperHeightMm: 50,
        labelWidthMm: 100,
        labelHeightMm: 50,
        labelsPerRow: 1,
        labelsPerPage: 1,
        gapMm: 0,
        marginTopMm: 0,
        marginRightMm: 0,
        marginBottomMm: 0,
        marginLeftMm: 0,
        barcodeWidthScale: 100,
        barcodeHeight: Math.max(100, Number(baseSettings.barcodeHeight || 88)),
      })
    : resolvedTemplate === LABEL_TEMPLATE_PREMIUM_RETAIL_50X100
      ? normalizeBarcodePrintSettings({
          ...baseSettings,
          paperSize: "custom",
          customPaperWidthMm: PREMIUM_RETAIL_LABEL_WIDTH_MM,
          customPaperHeightMm: PREMIUM_RETAIL_LABEL_HEIGHT_MM,
          labelWidthMm: PREMIUM_RETAIL_LABEL_WIDTH_MM,
          labelHeightMm: PREMIUM_RETAIL_LABEL_HEIGHT_MM,
          labelsPerRow: 1,
          labelsPerPage: 1,
          gapMm: 0,
          marginTopMm: 0,
          marginRightMm: 0,
          marginBottomMm: 0,
          marginLeftMm: 0,
          barcodeWidthScale: 100,
          barcodeHeight: PREMIUM_RETAIL_BARCODE_HEIGHT,
        })
    : resolvedTemplate === LABEL_TEMPLATE_THERMAL_PORTRAIT
      ? normalizeBarcodePrintSettings({
          ...baseSettings,
          paperSize: "custom",
          customPaperWidthMm: 50,
          customPaperHeightMm: 100,
          labelWidthMm: 50,
          labelHeightMm: 100,
          labelsPerRow: 1,
          labelsPerPage: 1,
          gapMm: 0,
          marginTopMm: 1.5,
          marginRightMm: 1.5,
          marginBottomMm: 1.5,
          marginLeftMm: 1.5,
        })
      : baseSettings;
  const paper = isLandscapeTemplate
    ? { paperWidthMm: 100, paperHeightMm: 50, pageCss: "100mm 50mm" }
    : resolvedTemplate === LABEL_TEMPLATE_PREMIUM_RETAIL_50X100
      ? { paperWidthMm: PREMIUM_RETAIL_LABEL_WIDTH_MM, paperHeightMm: PREMIUM_RETAIL_LABEL_HEIGHT_MM, pageCss: "50mm 100mm" }
    : resolvedTemplate === LABEL_TEMPLATE_THERMAL_PORTRAIT
      ? { paperWidthMm: 50, paperHeightMm: 100, pageCss: "50mm 100mm" }
      : resolveBarcodePrintPaper(normalizedSettings);
  const labelsPerRow = Math.max(1, Number(normalizedSettings.labelsPerRow || 1));
  const pages = paginateBarcodeLabels(labels, normalizedSettings.labelsPerPage);
  const contentWidthMm = Math.max(20, paper.paperWidthMm - normalizedSettings.marginLeftMm - normalizedSettings.marginRightMm);
  const imageWidthMm = normalizedSettings.showProductImage ? Math.max(18, Math.min(normalizedSettings.labelWidthMm * 0.36, 42)) : 0;
  const imageHeightMm = normalizedSettings.showProductImage ? Math.max(24, Math.min(normalizedSettings.labelHeightMm - 10, 54)) : 0;
  const barcodeWidth = resolvedTemplate === LABEL_TEMPLATE_THERMAL_LANDSCAPE_50X100
    ? Math.round(720 * (Number(normalizedSettings.barcodeWidthScale || 100) / 100))
    : resolvedTemplate === LABEL_TEMPLATE_PREMIUM_RETAIL_50X100
      ? Math.round(PREMIUM_RETAIL_BARCODE_WIDTH * (Number(normalizedSettings.barcodeWidthScale || 100) / 100))
    : Math.round(420 * (Number(normalizedSettings.barcodeWidthScale || 100) / 100));
  const barcodeHeight = resolvedTemplate === LABEL_TEMPLATE_THERMAL_LANDSCAPE_50X100
    ? Math.max(112, Number(normalizedSettings.barcodeHeight || 88))
    : resolvedTemplate === LABEL_TEMPLATE_PREMIUM_RETAIL_50X100
      ? PREMIUM_RETAIL_BARCODE_HEIGHT
      : Number(normalizedSettings.barcodeHeight || 88);
  const buildSmartQrMarkup = (item, { compact = false } = {}) => {
    if (!item?.showSmartProductQr || !item?.smartQrSvgMarkup) return "";
    return `
      <div class="smart-qr ${compact ? "smart-qr-compact" : ""}">
        <div class="smart-qr-svg">${item.smartQrSvgMarkup}</div>
      </div>
    `;
  };

  const buildLabelMarkup = (item) => {
      const safeImage = getSafeLabelImageUrl(item);
      const thermalArtworkAttr = useThermalArtwork && safeImage ? ' data-thermal-artwork-source="true"' : "";
      const barcodeSvg = getBarcodeSvg(item.barcodeValue, {
        width: barcodeWidth,
        height: barcodeHeight,
        displayText: item.barcode,
      });
      const resolvedArticleCode = resolveLabelArticleCode(item);
      if (resolvedTemplate === LABEL_TEMPLATE_THERMAL_LANDSCAPE_50X100) {
        return `
          <article class="landscape-label">
            <div class="landscape-title-box">
              <div class="landscape-title">${escapeHtml(item.productName || "")}</div>
            </div>
            <div class="landscape-body">
              <div class="landscape-image">
                <div class="image-fallback" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="#94a3b8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
                    <path d="M3.27 6.96 12 12.01l8.73-5.05"/>
                    <path d="M12 22.08V12"/>
                  </svg>
                </div>
                ${safeImage ? `<img src="${safeImage}" alt="${escapeHtml(item.productName || "")}"${thermalArtworkAttr} onerror="this.style.display='none'" />` : ""}
              </div>
              <div class="landscape-details">
                <div class="landscape-top-row">
                  <div class="landscape-size-badge">
                    <span>${escapeHtml(printCopy.size || "Size")}</span>
                    <strong>${escapeHtml(item.size || "ONE SIZE")}</strong>
                  </div>
                  ${resolvedArticleCode ? `
                    <div class="landscape-article-box">
                      <span>ARTICLE CODE</span>
                      <strong>${escapeHtml(resolvedArticleCode)}</strong>
                    </div>
                  ` : ""}
                </div>
                <div class="landscape-color-box">
                  <span>${escapeHtml(printCopy.color || "Color")}</span>
                  <span class="landscape-pill-divider" aria-hidden="true"></span>
                  <strong>${escapeHtml(item.color || "")}</strong>
                </div>
                ${resolvedArticleCode ? `
                  <div class="landscape-article-spacer"></div>
                ` : ""}
              </div>
            </div>
            <div class="landscape-barcode">
              <div class="landscape-barcode-svg">${barcodeSvg}</div>
              <div class="landscape-barcode-number">${escapeHtml(item.barcode || "")}</div>
            </div>
          </article>
        `;
      }
      if (resolvedTemplate === LABEL_TEMPLATE_PREMIUM_RETAIL_50X100) {
        return `
          <article class="premium-retail" data-premium-label-root="true">
              <div class="premium-image" data-premium-label-part="image">
                <div class="image-fallback" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="#94a3b8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
                  <path d="M3.27 6.96 12 12.01l8.73-5.05"/>
                  <path d="M12 22.08V12"/>
                </svg>
                </div>
              ${safeImage ? `<img src="${safeImage}" alt="${item.productName}"${thermalArtworkAttr} onerror="this.style.display='none'" />` : ""}
            </div>
            <div class="premium-header" data-premium-label-part="title">${item.productName}</div>
            <div class="premium-pill premium-price" data-premium-label-part="price">
              <span>${printCopy.price}</span>
              <strong>$${Number(item.salePrice || 0).toFixed(2)}</strong>
            </div>
            <div class="premium-meta-row" data-premium-label-part="size-color">
              <div class="premium-pill">
                <span>${printCopy.size}</span>
                <strong>${item.size}</strong>
              </div>
              <div class="premium-pill">
                <span>${printCopy.color}</span>
                <strong>${String(item.color || "").toUpperCase()}</strong>
              </div>
            </div>
            <div class="premium-barcode" data-premium-label-part="barcode">
              <div class="premium-barcode-svg">${barcodeSvg}</div>
            </div>
            ${resolvedArticleCode ? `<div class="premium-sku" data-premium-label-part="sku">${escapeHtml(resolvedArticleCode)}</div>` : ""}
            ${item?.showSmartProductQr && item?.smartQrSvgMarkup ? `<div class="premium-smart-qr">${item.smartQrSvgMarkup}</div>` : ""}
          </article>
        `;
      }
      const metaRows = [];
      if (normalizedSettings.showSizeColor) {
        metaRows.push(`
          <div class="meta">
            <span><strong>${printCopy.color}</strong> ${item.color}</span>
            <span><strong>${printCopy.size}</strong> ${item.size}</span>
          </div>
        `);
      }
      if (normalizedSettings.showSkuArticle || normalizedSettings.showPrice) {
        metaRows.push(`
          <div class="meta">
            ${normalizedSettings.showSkuArticle && resolvedArticleCode ? `<span><strong>ARTICLE CODE</strong> ${escapeHtml(resolvedArticleCode)}</span>` : ""}
            ${normalizedSettings.showPrice ? `<span><strong>${printCopy.price}</strong> $${Number(item.salePrice || 0).toFixed(2)}</span>` : ""}
          </div>
        `);
      }

      return `
        <article class="label">
          <div class="body">
            ${normalizedSettings.showProductImage ? `
              <div class="image">
                <div class="image-fallback" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="#94a3b8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
                    <path d="M3.27 6.96 12 12.01l8.73-5.05"/>
                    <path d="M12 22.08V12"/>
                  </svg>
                </div>
                ${safeImage ? `<img src="${safeImage}" alt="${item.productName}"${thermalArtworkAttr} onerror="this.style.display='none'" />` : ""}
              </div>
            ` : ""}

            <div class="content">
              ${normalizedSettings.showProductName ? `<h2>${item.productName}</h2>` : ""}
              ${metaRows.join("")}
              <div class="barcode">${barcodeSvg}</div>
              ${buildSmartQrMarkup(item)}
            </div>
          </div>
        </article>
      `;
    };

  const pageMarkup = pages
    .map((pageLabels) => {
      if (isLandscapeTemplate) {
        const item = pageLabels[0];
        return `
          <section class="barcode-print-page">
            ${item ? buildLandscapePrintSvg(item, printCopy) : ""}
          </section>
        `;
      }
      return `
        <section class="sheet ${resolvedTemplate === LABEL_TEMPLATE_PREMIUM_RETAIL_50X100 ? "premium-sheet premium-page" : ""}">
          ${pageLabels.map((item) => buildLabelMarkup(item)).join("")}
        </section>
      `;
    })
    .join("");

  return `
    <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${printCopy.title}</title>
        <style>
          :root {
            color-scheme: light;
          }
          * { box-sizing: border-box; }
          body {
            margin: 0;
            background: #0f172a;
            color: #0f172a;
            font-family: Arial, Helvetica, sans-serif;
          }
          .preview-shell {
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            background: #0f172a;
          }
          .preview-toolbar {
            position: sticky;
            top: 0;
            z-index: 20;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            padding: calc(env(safe-area-inset-top) + 12px) 12px 12px;
            border-bottom: 1px solid rgba(148, 163, 184, 0.28);
            background: rgba(15, 23, 42, 0.96);
            color: #f8fafc;
            backdrop-filter: blur(18px);
          }
          .preview-toolbar-title {
            min-width: 0;
            flex: 1;
            text-align: center;
            font-size: 15px;
            font-weight: 900;
            letter-spacing: 0.02em;
          }
          .preview-toolbar-button {
            display: inline-flex;
            min-height: 42px;
            align-items: center;
            justify-content: center;
            gap: 8px;
            border: 1px solid rgba(148, 163, 184, 0.24);
            border-radius: 999px;
            background: rgba(255, 255, 255, 0.08);
            color: #f8fafc;
            padding: 0 14px;
            font-size: 13px;
            font-weight: 900;
            white-space: nowrap;
          }
          .preview-toolbar-button.primary {
            background: linear-gradient(180deg, #16a34a, #15803d);
            border-color: rgba(22, 163, 74, 0.35);
          }
          .page {
            padding: 16px;
            background: #0f172a;
            min-height: 100vh;
            display: grid;
            gap: 16px;
          }
          .barcode-preview-only {
            display: block;
          }
          .barcode-print-only {
            display: none;
          }
          @media screen {
            .barcode-print-only {
              display: none !important;
            }
          }
          .sheet {
            background: #ffffff;
            margin: 0 auto;
            display: grid;
            gap: ${normalizedSettings.gapMm}mm;
            width: ${contentWidthMm}mm;
            grid-template-columns: repeat(${labelsPerRow}, minmax(0, ${normalizedSettings.labelWidthMm}mm));
            justify-content: start;
            padding: ${normalizedSettings.marginTopMm}mm ${normalizedSettings.marginRightMm}mm ${normalizedSettings.marginBottomMm}mm ${normalizedSettings.marginLeftMm}mm;
            min-height: ${paper.paperHeightMm}mm;
            page-break-after: always;
            break-after: page;
          }
          .landscape-label {
            width: 100%;
            height: 100%;
            display: flex;
            flex-direction: column;
            gap: 1mm;
            padding: 1.5mm;
            overflow: hidden;
            box-sizing: border-box;
            border: 1px solid #e2e8f0;
            border-radius: 8px;
            background: #ffffff;
            color: #111827;
          }
          .landscape-title {
            margin: 0;
            display: -webkit-box;
            overflow: hidden;
            -webkit-box-orient: vertical;
            -webkit-line-clamp: 2;
            font-size: 13px;
            line-height: 1.04;
            font-weight: 900;
            color: #ffffff;
          }
          .landscape-title-box {
            border: 1px solid #020617;
            border-radius: 8px;
            background: #020617;
            color: #ffffff;
            padding: 1.05mm 1.25mm;
          }
          .landscape-title-box .landscape-title {
            min-height: 0;
          }
          .landscape-body {
            display: grid;
            min-height: 0;
            flex: 1;
            gap: 1.5mm;
            grid-template-columns: 40% 60%;
          }
          .landscape-image {
            position: relative;
            overflow: hidden;
            border: 1px solid #e2e8f0;
            border-radius: 8px;
            background: #f8fafc;
            min-height: 0;
          }
          .landscape-image img {
            width: 100%;
            height: 100%;
            display: block;
            object-fit: contain;
            object-position: center;
            padding: 0.75mm;
            background: #ffffff;
          }
          .landscape-details {
            display: flex;
            min-width: 0;
            flex-direction: column;
            gap: 1mm;
            overflow: hidden;
          }
          .landscape-top-row {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 1mm;
            min-width: 0;
          }
          .landscape-size-badge {
            border: 1px solid #020617;
            border-radius: 8px;
            background: #020617;
            color: #ffffff;
            padding: 1.05mm 1.2mm;
            text-align: center;
            display: flex;
            flex-direction: column;
            justify-content: center;
            min-height: 14.1mm;
          }
          .landscape-size-badge span {
            display: block;
            font-size: 6.8px;
            line-height: 1;
            font-weight: 900;
            letter-spacing: 0.2em;
            text-transform: uppercase;
            color: #cbd5e1;
          }
          .landscape-size-badge strong {
            display: block;
            margin-top: 0.4mm;
            overflow: hidden;
            white-space: nowrap;
            text-overflow: ellipsis;
            font-size: 18px;
            line-height: 1;
            font-weight: 900;
            color: #ffffff;
          }
          .landscape-article-box {
            border: 1px solid #020617;
            border-radius: 8px;
            background: #020617;
            color: #ffffff;
            padding: 1.05mm 1.2mm;
            text-align: center;
            display: flex;
            flex-direction: column;
            justify-content: center;
            min-height: 14.1mm;
          }
          .landscape-article-box span {
            display: block;
            font-size: 6.5px;
            line-height: 1;
            font-weight: 900;
            letter-spacing: 0.2em;
            text-transform: uppercase;
            color: #cbd5e1;
          }
          .landscape-article-box strong {
            display: block;
            margin-top: 0.3mm;
            overflow: hidden;
            white-space: nowrap;
            text-overflow: ellipsis;
            font-size: 18px;
            line-height: 1;
            font-weight: 900;
            color: #ffffff;
          }
          .landscape-color-box {
            border: 1px solid #020617;
            border-radius: 8px;
            background: #020617;
            padding: 1.15mm 1.2mm;
            color: #ffffff;
            display: grid;
            grid-template-columns: 18.2mm 1px minmax(0, 1fr);
            align-items: center;
            column-gap: 1.1mm;
            min-height: 14.1mm;
          }
          .landscape-color-box span {
            display: block;
            font-size: 6.4px;
            line-height: 1;
            font-weight: 900;
            letter-spacing: 0.18em;
            text-transform: uppercase;
            color: #cbd5e1;
          }
          .landscape-pill-divider {
            display: block;
            align-self: stretch;
            width: 1px;
            background: rgba(255, 255, 255, 0.45);
          }
          .landscape-color-box span:first-child {
            text-align: left;
          }
          .landscape-color-box strong {
            display: block;
            margin-top: 0;
            overflow: hidden;
            white-space: nowrap;
            text-overflow: ellipsis;
            font-size: 18px;
            line-height: 1;
            font-weight: 900;
            color: #ffffff;
            text-align: left;
          }
          .landscape-article-spacer {
            height: 0;
          }
          .landscape-barcode {
            display: flex;
            flex-direction: column;
            justify-content: center;
            gap: 0.4mm;
            border: 1px solid #e2e8f0;
            border-radius: 8px;
            background: #ffffff;
            padding: 0.8mm 1mm 0.4mm;
            overflow: hidden;
          }
          .landscape-barcode-svg {
            width: 100%;
            min-height: 14mm;
          }
          .landscape-barcode-svg svg {
            width: 100%;
            height: auto;
            display: block;
          }
          .landscape-barcode-number {
            text-align: center;
            font-size: 8px;
            line-height: 1;
            font-weight: 900;
            color: #111827;
          }
          .barcode-print-sheet {
            position: relative;
            width: 50mm;
            margin: 0;
            padding: 0;
            overflow: hidden;
            box-sizing: border-box;
          }
          .barcode-print-sheet {
            display: block;
            width: 50mm;
            min-width: 50mm;
            max-width: 50mm;
            height: auto;
          }
          .barcode-print-page {
            position: relative;
            display: block;
            width: 50mm;
            height: 100mm;
            min-width: 50mm;
            max-width: 50mm;
            min-height: 100mm;
            max-height: 100mm;
            margin: 0;
            padding: 0;
            overflow: hidden;
            box-sizing: border-box;
            page-break-after: always;
            break-after: page;
            page-break-inside: avoid;
            break-inside: avoid;
          }
          .barcode-print-page:last-child {
            page-break-after: auto;
            break-after: auto;
          }
          .barcode-print-svg {
            display: block;
            width: 50mm;
            height: 100mm;
          }
          .premium-sheet {
            width: 50mm;
            height: 100mm;
            padding: 0;
            gap: 0;
            overflow: hidden;
            box-sizing: border-box;
            grid-template-columns: minmax(0, 1fr);
            grid-auto-rows: 1fr;
          }
          .label {
            background: #ffffff;
            border: 1px solid #e2e8f0;
            border-radius: 18px;
            padding: 12px;
            overflow: hidden;
            break-inside: avoid;
            page-break-inside: avoid;
            width: ${normalizedSettings.labelWidthMm}mm;
            min-height: ${normalizedSettings.labelHeightMm}mm;
          }
          .thermal-landscape {
            display: grid;
            grid-template-rows: 1.1fr 0.9fr;
            gap: 1.5mm;
            padding: 1.5mm;
            border-radius: 6px;
          }
          .thermal-top {
            display: grid;
            grid-template-columns: 32% 68%;
            gap: 1.5mm;
            min-height: 0;
          }
          .thermal-top.no-image {
            grid-template-columns: minmax(0, 1fr);
          }
          .thermal-image {
            position: relative;
            overflow: hidden;
            border: 1px solid #e2e8f0;
            border-radius: 4px;
            background: #f8fafc;
          }
          .thermal-image img {
            width: 100%;
            height: 100%;
            object-fit: contain;
            object-position: center;
            display: block;
            padding: 1.5mm;
            position: relative;
            z-index: 1;
            background: #ffffff;
          }
          .thermal-details {
            display: flex;
            min-width: 0;
            flex-direction: column;
            justify-content: space-between;
            gap: 1mm;
          }
          .thermal-details h2 {
            margin: 0;
            font-size: 15px;
            line-height: 1.08;
            font-weight: 900;
            color: #111827;
            letter-spacing: 0;
          }
          .thermal-price {
            font-size: 18px;
            line-height: 1;
            font-weight: 900;
            color: #111827;
          }
          .thermal-size-color {
            font-size: 12px;
            line-height: 1.2;
            font-weight: 900;
            color: #111827;
          }
          .thermal-sku-top,
          .thermal-sku-bottom {
            font-size: 10px;
            line-height: 1;
            font-weight: 800;
            color: #475569;
          }
          .thermal-barcode {
            display: flex;
            min-height: 0;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 0.8mm;
            border: 1px solid #e2e8f0;
            border-radius: 4px;
            padding: 1.2mm 2.5mm;
            background: #ffffff;
          }
          .thermal-barcode-svg {
            width: 94%;
            max-width: 94%;
            min-height: 22.5mm;
          }
          .thermal-barcode-svg svg {
            width: 100%;
            height: auto;
            display: block;
          }
          .premium-retail {
            display: grid;
            position: relative;
            grid-template-rows: ${PREMIUM_RETAIL_GRID_ROWS};
            gap: 0;
            padding: 0;
            border-radius: 0;
            width: 100%;
            height: 100%;
            border: 1px solid #e2e8f0;
            background: #ffffff;
            overflow: hidden;
            box-sizing: border-box;
            page-break-inside: avoid;
            break-inside: avoid;
          }
          .premium-image {
            position: relative;
            overflow: hidden;
            border: 1px solid #e2e8f0;
            border-radius: 0;
            background: #f8fafc;
            min-height: 0;
            display: flex;
            align-items: flex-start;
            justify-content: center;
          }
          .premium-image,
          .premium-header,
          .premium-pill,
          .premium-barcode,
          .premium-sku {
            box-sizing: border-box;
          }
          .premium-image img,
          .premium-header,
          .premium-price,
          .premium-meta-row,
          .premium-barcode,
          .premium-sku {
            min-height: 0;
          }
          .premium-image img {
            width: 100%;
            height: 100%;
            object-fit: contain;
            object-position: center top;
            display: block;
            padding: 0.25mm 0.8mm 0.1mm;
            position: relative;
            z-index: 1;
            background: #ffffff;
          }
          .premium-header {
            border: 1px solid #e2e8f0;
            border-radius: 0;
            background: #f8fafc;
            padding: 0.55mm 0.8mm;
            font-size: 11px;
            line-height: 1.04;
            font-weight: 900;
            color: #111827;
            display: -webkit-box;
            -webkit-line-clamp: 2;
            -webkit-box-orient: vertical;
            overflow: hidden;
          }
          .premium-pill {
            border: 1px solid #e2e8f0;
            border-radius: 0;
            background: #f4f4f5;
            padding: 0.5mm 0.75mm;
            text-align: left;
            color: #111827;
          }
          .premium-pill span {
            display: block;
            font-size: 5px;
            line-height: 1;
            font-weight: 900;
            letter-spacing: 0.18em;
            text-transform: uppercase;
            color: #64748b;
          }
          .premium-pill strong {
            display: block;
            margin-top: 0.25mm;
            overflow: hidden;
            white-space: nowrap;
            text-overflow: ellipsis;
            font-size: 10px;
            line-height: 1;
            font-weight: 900;
            color: #111827;
          }
          .premium-price {
            background: #111827;
            color: #ffffff;
          }
          .premium-price span {
            color: #cbd5e1;
          }
          .premium-price strong {
            font-size: 15px;
            color: #ffffff;
          }
          .premium-meta-row {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 0;
            min-width: 0;
          }
          .premium-meta-row .premium-pill:first-child strong {
            font-size: 16px;
          }
          .premium-meta-row .premium-pill:last-child strong {
            font-size: 10px;
            text-transform: uppercase;
            font-weight: 900;
          }
          .premium-barcode {
            display: flex;
            min-height: 0;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 0;
            border: 1px solid #e2e8f0;
            border-radius: 0;
            background: #ffffff;
            padding: 0 0.45mm;
          }
          .premium-barcode-svg {
            width: 95%;
            max-width: 95%;
            min-height: 0;
          }
          .premium-barcode-svg svg {
            width: 100%;
            height: auto;
            display: block;
          }
          .premium-sku {
            text-align: center;
            padding: 0 0.5mm 0;
            font-size: 8px;
            line-height: 1;
            font-weight: 900;
            color: #111827;
            overflow: hidden;
            white-space: nowrap;
            text-overflow: ellipsis;
          }
          .premium-page {
            position: relative;
            width: 50mm;
            height: 100mm;
            overflow: hidden;
            contain: layout paint;
            page-break-inside: avoid;
            break-inside: avoid;
            page-break-after: always;
            break-after: page;
          }
          .premium-page .premium-retail {
            width: 100%;
            height: 100%;
          }
          .body {
            display: grid;
            gap: 12px;
            align-items: stretch;
            grid-template-columns: ${normalizedSettings.showProductImage ? `${imageWidthMm}mm minmax(0,1fr)` : "minmax(0,1fr)"};
          }
          .image {
            width: 100%;
            border: 1px solid #e2e8f0;
            border-radius: 18px;
            background: linear-gradient(180deg, #f8fafc 0%, #ffffff 100%);
            overflow: hidden;
            display: flex;
            align-items: center;
            justify-content: center;
            position: relative;
            min-height: ${imageHeightMm}mm;
            height: ${imageHeightMm}mm;
          }
          .image-fallback {
            position: absolute;
            inset: 0;
            display: flex;
            align-items: center;
            justify-content: center;
          }
          .image img {
            width: 100%;
            height: 100%;
            object-fit: contain;
            object-position: center;
            display: block;
            padding: 6px;
            position: relative;
            z-index: 1;
            background: #ffffff;
          }
          .content {
            display: flex;
            flex-direction: column;
            min-width: 0;
          }
          .content h2 {
            margin: 0;
            font-size: ${normalizedSettings.showProductImage ? "18px" : "20px"};
            line-height: 1.15;
            font-weight: 900;
            color: #111827;
            letter-spacing: -0.02em;
          }
          .meta {
            display: grid;
            gap: 8px 10px;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            margin-top: 10px;
            font-size: 11px;
            color: #334155;
          }
          .meta span {
            display: block;
            line-height: 1.35;
          }
          .meta strong {
            display: block;
            font-size: 8px;
            text-transform: uppercase;
            letter-spacing: 0.18em;
            color: #64748b;
            margin-bottom: 1px;
          }
          .barcode {
            margin-top: auto;
            padding-top: 12px;
            border: 1px solid #e2e8f0;
            border-radius: 16px;
            padding: 8px 10px 4px;
            background: #ffffff;
            overflow: hidden;
          }
          .barcode svg {
            width: 100%;
            height: auto;
            display: block;
          }
          .smart-qr {
            margin-top: 10px;
            display: flex;
            justify-content: center;
          }
          .smart-qr-compact {
            margin-top: 4px;
          }
          .smart-qr-svg {
            width: 128px;
            max-width: 100%;
            border: 1px solid #e2e8f0;
            border-radius: 14px;
            background: #ffffff;
            padding: 10px;
          }
          .smart-qr-compact .smart-qr-svg {
            width: 92px;
            padding: 8px;
            border-radius: 12px;
          }
          .smart-qr-svg svg,
          .premium-smart-qr svg {
            width: 100%;
            height: auto;
            display: block;
          }
          .premium-smart-qr {
            position: absolute;
            right: 1mm;
            bottom: 8mm;
            z-index: 2;
            width: 16mm;
            overflow: hidden;
            border: 1px solid #e2e8f0;
            border-radius: 2.2mm;
            background: #ffffff;
            padding: 1mm;
            box-sizing: border-box;
          }
          @media print {
            .barcode-preview-only,
            .barcode-page-header,
            .barcode-controls,
            aside,
            nav,
            header,
            button {
              display: none !important;
            }
            .barcode-print-only {
              display: block !important;
              width: 100mm !important;
              margin: 0 !important;
              padding: 0 !important;
              background: #ffffff !important;
            }
            html,
            body {
              width: 100mm !important;
              margin: 0 !important;
              padding: 0 !important;
              background: #ffffff !important;
              overflow: visible !important;
            }
            .barcode-print-sheet {
              display: block !important;
              width: 100mm !important;
              margin: 0 !important;
              padding: 0 !important;
              background: #ffffff !important;
            }
            .barcode-print-page {
              display: block !important;
              width: 100mm !important;
              height: 50mm !important;
              min-width: 100mm !important;
              max-width: 100mm !important;
              min-height: 50mm !important;
              max-height: 50mm !important;
              margin: 0 !important;
              padding: 0 !important;
              overflow: hidden !important;
              page-break-after: always !important;
              break-after: page !important;
              break-inside: avoid !important;
              page-break-inside: avoid !important;
              background: #ffffff !important;
            }
            .barcode-print-page:last-child {
              page-break-after: auto !important;
              break-after: auto !important;
            }
            .barcode-print-svg {
              display: block !important;
              width: 100mm !important;
              height: 50mm !important;
            }
            @page {
              size: 100mm 50mm;
              margin: 0;
            }
          }
        </style>
        ${useThermalArtwork ? buildThermalArtworkScript() : ""}
        ${resolvedTemplate === LABEL_TEMPLATE_PREMIUM_RETAIL_50X100 ? `
          <script>
            (function () {
              const pxToMm = (px) => Number(((Number(px) || 0) * 25.4 / 96).toFixed(2));
              const logPremiumLabelHeight = () => {
                const wrapper = document.querySelector('[data-premium-label-root="true"]');
                if (!wrapper) return;
                const rootRect = wrapper.getBoundingClientRect();
                const getHeight = (selector) => {
                  const node = wrapper.querySelector(selector);
                  return node ? pxToMm(node.getBoundingClientRect().height) : 0;
                };
              };
              const run = () => requestAnimationFrame(() => requestAnimationFrame(logPremiumLabelHeight));
              if (document.readyState === 'complete') {
                run();
              } else {
              window.addEventListener('load', run, { once: true });
              }
            }());
          </script>
        ` : ""}
        ${showPreviewChrome ? `
          <script>
            (function () {
              const previewBackUrl = ${JSON.stringify(String(previewBackUrl || "").trim())};
              const closePreview = () => {
                try {
                  if (window.opener && !window.opener.closed) {
                    window.close();
                    return;
                  }
                } catch (error) {
                  // Ignore cross-window access issues.
                }
                try {
                  if (window.history.length > 1) {
                    window.history.back();
                    return;
                  }
                } catch (error) {
                  // Ignore history access issues.
                }
                if (previewBackUrl) {
                  window.location.href = previewBackUrl;
                } else {
                  window.close();
                }
              };

              const triggerPrint = () => {
                window.focus();
                window.print();
              };

              document.addEventListener("click", (event) => {
                const button = event.target && typeof event.target.closest === "function"
                  ? event.target.closest("[data-preview-action]")
                  : null;
                if (!button) return;
                const action = button.getAttribute("data-preview-action");
                if (action === "close") {
                  event.preventDefault();
                  closePreview();
                }
                if (action === "print") {
                  event.preventDefault();
                  triggerPrint();
                }
              });

              window.addEventListener("keydown", (event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  closePreview();
                }
                if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                  event.preventDefault();
                  triggerPrint();
                }
              });
            }());
          </script>
        ` : ""}
      </head>
      <body>
        <div class="preview-shell">
          ${showPreviewChrome ? `
            <div class="preview-toolbar" role="banner" aria-label="${escapeHtml(previewTitle)}">
              <button type="button" class="preview-toolbar-button" data-preview-action="close">رجوع / إغلاق</button>
              <div class="preview-toolbar-title">${escapeHtml(previewTitle)}</div>
              <button type="button" class="preview-toolbar-button primary" data-preview-action="print">طباعة</button>
            </div>
          ` : ""}
          <div class="barcode-print-sheet barcode-print-only">
            ${pageMarkup}
          </div>
        </div>
      </body>
    </html>
  `;
};

export const openBarcodePrintWindow = ({
  labels = [],
  sheetMode = "a4",
  template = LABEL_TEMPLATE_STANDARD,
  printSettings = {},
  companyName = APP_NAME,
  companyLogo = "LOGO",
  copy = {},
  previewTitle = "طباعة الباركود",
  previewBackUrl = "",
  showPreviewChrome = false,
} = {}) => {
  const win = safeWindow();
  if (!win) return false;

  const popup = win.open("", "_blank", "width=1280,height=980");
  if (!popup) return false;

  const html = buildBarcodePrintHtml({
    labels,
    sheetMode,
    template,
    printSettings,
    companyName,
    companyLogo,
    copy,
    previewTitle,
    previewBackUrl,
    showPreviewChrome,
  });
  console.info("[barcode-print:selected-template]", template);
  console.info("[barcode-print:labels-count]", Array.isArray(labels) ? labels.length : 0);
  console.info("[barcode-print:html-length]", html.length);

  popup.document.write(
    html
  );
  popup.document.close();
  popup.focus();
  return popup;
};
