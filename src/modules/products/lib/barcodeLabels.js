import { APP_NAME } from "../../../shared/constants/app";
import { resolveProductImageUrl } from "../../../shared/lib/imageUrls";
import { normalizeBarcodePrintSettings, paginateBarcodeLabels, resolveBarcodePrintPaper } from "../../../../shared/barcodePrintSettings.js";
import Code128Reader from "@zxing/library/esm/core/oned/Code128Reader";

const LABEL_TEMPLATE_STANDARD = "standard";
const LABEL_TEMPLATE_THERMAL_PORTRAIT = "thermal_portrait";
const LABEL_TEMPLATE_THERMAL_LANDSCAPE_50X100 = "thermal_landscape_50x100";
const LABEL_TEMPLATE_PREMIUM_RETAIL_50X100 = "premium_retail_50x100";
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
  const variantImage =
    firstText(
      variant?.variant_image_url,
      variant?.color_image_url,
      variant?.image_url,
      variant?.image,
      variant?.colorGroup?.image_url,
      colorGroup?.image_url
    );
  const productImage = firstText(
    product?.product_image_url,
    product?.image_url,
    product?.image,
    product?.photo_url,
    product?.thumbnail_url
  );
  const resolvedImage = variantImage || productImage;

  console.log("[barcode-labels] variant image fields", {
    productId: product?.id ?? product?.product_id,
    variantId: variant?.variant_id ?? variant?.id,
    color: variant?.color,
    size: variant?.size,
    image_url: variant?.image_url,
    variant_image_url: variant?.variant_image_url,
    color_image_url: variant?.color_image_url,
    colorGroupImage: colorGroup?.image_url || variant?.colorGroup?.image_url,
    product_image_url: product?.product_image_url,
    product_image: product?.image_url,
  });
  console.log("[barcode-labels] resolved image url", {
    productId: product?.id ?? product?.product_id,
    variantId: variant?.variant_id ?? variant?.id,
    color: variant?.color,
    resolvedImage,
  });
  console.log("[barcode-labels] product id / variant id / color / resolved image", {
    productId: product?.id ?? product?.product_id,
    variantId: variant?.variant_id ?? variant?.id,
    color: variant?.color,
    resolvedImage,
  });

  return resolvedImage;
};

const getSafeLabelImageUrl = (item) => {
  const imageUrl = resolveAssetUrl(item.imageUrl || item.resolvedImage);
  if (!imageUrl) return "";
  if (imageUrl.startsWith("data:")) return imageUrl;

  const separator = imageUrl.includes("?") ? "&" : "?";
  return `${imageUrl}${separator}v=${encodeURIComponent(item.variantId || item.key || item.copyIndex || Date.now())}`;
};

export const getLabelIdentity = (product, variant = null) => {
  const variantId =
    variant?.variant_id ??
    (variant?.color || variant?.size || variant?.sku
      ? `${variant?.color || "default"}:${variant?.size || "size"}:${variant?.sku || "sku"}`
      : variant?.id ?? "base");
  return `${product?.id ?? "product"}:${variantId}`;
};

export const getLabelDisplayBarcode = (product, variant = null) =>
  variant?.barcode || variant?.variant_barcode || product?.barcode || product?.sku || `SKU-${product?.id ?? "0000"}`;

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
  const displayBarcode = getLabelDisplayBarcode(product, variant);
  const sourceVariantImage = firstText(variant?.variant_image_url, variant?.color_image_url, variant?.image_url, variant?.image);
  const sourceProductImage = firstText(product?.product_image_url, product?.image_url, product?.image, product?.photo_url, product?.thumbnail_url);
  const resolvedImage = getLabelImageUrl(product, variant);
  console.log("[barcode-labels] label item image", {
    productId: product?.id ?? product?.product_id,
    variantId: variant?.variant_id ?? variant?.id,
    key: getLabelIdentity(product, variant),
    productName: product?.name,
    color: variant?.color || product?.color,
    size: variant?.size || product?.size,
    sourceVariantImage,
    sourceProductImage,
    resolvedImage,
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
    sku: getLabelSku(product, variant),
    barcode: displayBarcode,
    barcodeValue: normalizeBarcode(displayBarcode, `${product?.id ?? ""}${variant?.variant_id ?? variant?.id ?? ""}`),
    salePrice: priceInfo.price,
    effectivePrice: priceInfo.price,
    displayPrice: priceInfo.price,
    comparePrice: priceInfo.comparePrice,
    saleActive: priceInfo.saleActive,
    stock: Number(variant?.stock ?? product?.stock ?? 0),
    sourceVariantImage,
    sourceProductImage,
    resolvedImage,
    imageUrl: resolvedImage,
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
  return {
    key: `barcode-shop:${product.id}`,
    productId: product.id,
    variantId,
    colorId,
    slug: product?.slug || product?.canonical_slug || "",
    productName: product.name || "Unnamed product",
    brand: product.brand || "Brand",
    category: product.category || "Category",
    qrToken,
    qrValue: getBarcodeShopQrUrl(product, { variantId, colorId }),
    salePrice: priceInfo.price,
    effectivePrice: priceInfo.price,
    displayPrice: priceInfo.price,
    comparePrice: priceInfo.comparePrice,
    saleActive: priceInfo.saleActive,
    priceSource: priceInfo.saleActive || priceInfo.price > 0 ? "product-first" : "none",
    imageUrl: product.product_image_url || product.image_url || "",
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
  const barTop = 14;
  const barHeight = Math.max(0, safeHeight - 30);

  let cursorX = quietZone;
  let bars = "";
  codes.forEach((code, codeIndex) => {
    const pattern = Code128Reader.CODE_PATTERNS[code] || [];
    pattern.forEach((segmentWidth, segmentIndex) => {
      const widthPx = segmentWidth * moduleWidth;
      if (segmentIndex % 2 === 0) {
        bars += `<rect x="${cursorX.toFixed(3)}" y="${barTop}" width="${widthPx.toFixed(3)}" height="${barHeight}" fill="#111827" />`;
      }
      cursorX += widthPx;
    });
    if (codeIndex < codes.length - 1) {
      cursorX += 0;
    }
  });

  return `
    <svg viewBox="0 0 ${safeWidth} ${safeHeight}" width="${safeWidth}" height="${safeHeight}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${text}">
      <rect width="${safeWidth}" height="${safeHeight}" fill="#ffffff" />
      ${bars}
      <text x="${safeWidth / 2}" y="${Math.max(0, safeHeight - 6)}" text-anchor="middle" fill="#111827" font-family="Arial, sans-serif" font-size="12" font-weight="700">${text}</text>
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
  const normalizedSettings = resolvedTemplate === LABEL_TEMPLATE_THERMAL_LANDSCAPE_50X100
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
        marginTopMm: 1.5,
        marginRightMm: 1.5,
        marginBottomMm: 1.5,
        marginLeftMm: 1.5,
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
  const paper = resolvedTemplate === LABEL_TEMPLATE_THERMAL_LANDSCAPE_50X100
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
    ? Math.round(640 * (Number(normalizedSettings.barcodeWidthScale || 100) / 100))
    : resolvedTemplate === LABEL_TEMPLATE_PREMIUM_RETAIL_50X100
      ? Math.round(PREMIUM_RETAIL_BARCODE_WIDTH * (Number(normalizedSettings.barcodeWidthScale || 100) / 100))
    : Math.round(420 * (Number(normalizedSettings.barcodeWidthScale || 100) / 100));
  const barcodeHeight = resolvedTemplate === LABEL_TEMPLATE_THERMAL_LANDSCAPE_50X100
    ? Math.max(134, Number(normalizedSettings.barcodeHeight || 88))
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
      const barcodeSvg = getBarcodeSvg(item.barcodeValue, {
        width: barcodeWidth,
        height: barcodeHeight,
        displayText: item.barcode,
      });
      if (resolvedTemplate === LABEL_TEMPLATE_THERMAL_LANDSCAPE_50X100) {
        return `
          <article class="label thermal-landscape">
            <div class="thermal-top ${normalizedSettings.showProductImage ? "" : "no-image"}">
              ${normalizedSettings.showProductImage ? `
                <div class="thermal-image">
                  <div class="image-fallback" aria-hidden="true">
                    <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="#94a3b8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
                      <path d="M3.27 6.96 12 12.01l8.73-5.05"/>
                      <path d="M12 22.08V12"/>
                    </svg>
                  </div>
                  ${safeImage ? `<img src="${safeImage}" alt="${item.productName}" onerror="this.style.display='none'" />` : ""}
                </div>
              ` : ""}
              <div class="thermal-details">
                ${normalizedSettings.showProductName ? `<h2>${item.productName}</h2>` : ""}
                ${normalizedSettings.showPrice ? `<div class="thermal-price">$${Number(item.salePrice || 0).toFixed(2)}</div>` : ""}
                ${normalizedSettings.showSizeColor ? `<div class="thermal-size-color">${item.size} / ${item.color}</div>` : ""}
                ${normalizedSettings.showSkuArticle ? `<div class="thermal-sku-top">${item.sku}</div>` : ""}
              </div>
            </div>
            <div class="thermal-barcode">
              <div class="thermal-barcode-svg">${barcodeSvg}</div>
              <div class="thermal-sku-bottom">${item.sku}</div>
              ${buildSmartQrMarkup(item, { compact: true })}
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
              ${safeImage ? `<img src="${safeImage}" alt="${item.productName}" onerror="this.style.display='none'" />` : ""}
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
            <div class="premium-sku" data-premium-label-part="sku">${item.sku}</div>
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
            ${normalizedSettings.showSkuArticle ? `<span><strong>${printCopy.sku}</strong> ${item.sku}</span>` : ""}
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
                ${safeImage ? `<img src="${safeImage}" alt="${item.productName}" onerror="this.style.display='none'" />` : ""}
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
    .map((pageLabels) => `
      <section class="sheet ${resolvedTemplate === LABEL_TEMPLATE_PREMIUM_RETAIL_50X100 ? "premium-sheet premium-page" : ""}">
        ${pageLabels.map((item) => buildLabelMarkup(item)).join("")}
      </section>
    `)
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
            body { background: #ffffff; }
            .preview-toolbar {
              display: none !important;
            }
            .preview-shell {
              min-height: 0;
              display: block;
              background: #ffffff;
            }
            .page {
              padding: 0;
              margin: 0;
              background: #ffffff;
              display: block;
              gap: 0;
              min-height: 0;
            }
            .sheet {
              gap: ${normalizedSettings.gapMm}mm;
              width: ${contentWidthMm}mm;
              margin: 0;
              box-shadow: none;
            }
            .sheet:last-child {
              page-break-after: auto;
              break-after: auto;
            }
            .label {
              box-shadow: none;
            }
            .image {
              box-shadow: none;
            }
            .premium-sheet {
              width: 50mm;
              height: 100mm;
              padding: 0;
              gap: 0;
              overflow: hidden;
              box-shadow: none;
              background: #ffffff;
              margin: 0;
            }
            .premium-page {
              width: 50mm;
              height: 100mm;
              overflow: hidden;
              margin: 0;
              box-sizing: border-box;
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
            @page {
              size: ${paper.pageCss};
              margin: 0;
            }
          }
        </style>
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
                console.log("[premium-layout-heights]", {
                  imageSectionHeight: getHeight('[data-premium-label-part="image"]'),
                  titleHeight: getHeight('[data-premium-label-part="title"]'),
                  priceHeight: getHeight('[data-premium-label-part="price"]'),
                  sizeColorHeight: getHeight('[data-premium-label-part="size-color"]'),
                  barcodeHeight: getHeight('[data-premium-label-part="barcode"]'),
                  skuHeight: getHeight('[data-premium-label-part="sku"]'),
                  totalLabelHeight: pxToMm(rootRect.height),
                });
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
          <div class="page">
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
