import { APP_NAME } from "../../../shared/constants/app";
import { resolveProductImageUrl } from "../../../shared/lib/imageUrls";
import { normalizeBarcodePrintSettings, paginateBarcodeLabels, resolveBarcodePrintPaper } from "../../../../shared/barcodePrintSettings.js";

const LABEL_TEMPLATE_STANDARD = "standard";
const LABEL_TEMPLATE_THERMAL_PORTRAIT = "thermal_portrait";
const LABEL_TEMPLATE_THERMAL_LANDSCAPE_50X100 = "thermal_landscape_50x100";
const LABEL_TEMPLATE_PREMIUM_RETAIL_50X100 = "premium_retail_50x100";

const EAN13_L = [
  "0001101",
  "0011001",
  "0010011",
  "0111101",
  "0100011",
  "0110001",
  "0101111",
  "0111011",
  "0110111",
  "0001011",
];

const EAN13_G = [
  "0100111",
  "0110011",
  "0011011",
  "0100001",
  "0011101",
  "0111001",
  "0000101",
  "0010001",
  "0001001",
  "0010111",
];

const EAN13_R = [
  "1110010",
  "1100110",
  "1101100",
  "1000010",
  "1011100",
  "1001110",
  "1010000",
  "1000100",
  "1001000",
  "1110100",
];

const EAN13_PARITY = [
  "LLLLLL",
  "LLGLGG",
  "LLGGLG",
  "LLGGGL",
  "LGLLGG",
  "LGGLLG",
  "LGGGLL",
  "LGLGLG",
  "LGLGGL",
  "LGGLGL",
];

const safeWindow = () => (typeof window !== "undefined" ? window : null);

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

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const stripDigits = (value = "") => String(value).replace(/\D/g, "");

const hashString = (value = "") => {
  let hash = 0;
  for (let index = 0; index < String(value).length; index += 1) {
    hash = (hash << 5) - hash + String(value).charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
};

const checksumEan13 = (digits12) => {
  const sum = String(digits12)
    .split("")
    .reduce((acc, digit, index) => {
      const numeric = Number(digit || 0);
      const multiplier = index % 2 === 0 ? 1 : 3;
      return acc + numeric * multiplier;
    }, 0);
  return (10 - (sum % 10)) % 10;
};

const normalizeBarcode = (value, fallbackSeed = "") => {
  const digits = stripDigits(value);

  if (digits.length === 13) {
    return digits;
  }

  if (digits.length === 12) {
    return `${digits}${checksumEan13(digits)}`;
  }

  const seed = stripDigits(fallbackSeed) || String(hashString(value || fallbackSeed || "000000000000"));
  const padded = `${seed}${String(hashString(`${value}-${fallbackSeed}`)).padStart(12, "0")}`;
  const numeric = stripDigits(padded).padStart(12, "0").slice(0, 12);
  return `${numeric}${checksumEan13(numeric)}`;
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

export const getBarcodeShopQrUrl = (product = {}) => {
  const identifier = getBarcodeShopQrValue(product);
  if (!identifier) return "";
  return `${resolveStorefrontOrigin()}/shop/product/${String(identifier).replace(/^\/+/, "")}`;
};

export const buildBarcodeShopLabelItem = (product = null, quantity = 1, variantFallback = null) => {
  if (!product) return null;
  const qrToken = getBarcodeShopQrValue(product);
  const priceInfo = getProductFirstLabelPriceInfo(product, variantFallback);
  return {
    key: `barcode-shop:${product.id}`,
    productId: product.id,
    productName: product.name || "Unnamed product",
    brand: product.brand || "Brand",
    category: product.category || "Category",
    qrToken,
    qrValue: getBarcodeShopQrUrl(product),
    salePrice: priceInfo.price,
    effectivePrice: priceInfo.price,
    displayPrice: priceInfo.price,
    comparePrice: priceInfo.comparePrice,
    saleActive: priceInfo.saleActive,
    priceSource: priceInfo.saleActive || priceInfo.price > 0 ? "product-first" : "none",
    imageUrl: product.product_image_url || product.image_url || "",
    companyName: product.companyName || APP_NAME,
    quantity: getLabelQuantity(quantity) || 1,
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
  const digitString = barcode.padEnd(13, "0").slice(0, 13);
  const first = Number(digitString[0]);
  const parity = EAN13_PARITY[first];
  const pattern = ["101"];

  for (let index = 1; index <= 6; index += 1) {
    const digit = Number(digitString[index]);
    pattern.push(parity[index - 1] === "L" ? EAN13_L[digit] : EAN13_G[digit]);
  }

  pattern.push("01010");

  for (let index = 7; index <= 12; index += 1) {
    const digit = Number(digitString[index]);
    pattern.push(EAN13_R[digit]);
  }

  pattern.push("101");
  const bits = pattern.join("");
  const quietZone = 10;
  const moduleWidth = Math.max(0.1, (safeWidth - quietZone * 2) / bits.length);
  const barTop = 14;
  const barHeight = Math.max(0, safeHeight - 30);

  let bars = "";
  for (let index = 0; index < bits.length; index += 1) {
    if (bits[index] !== "1") continue;
    bars += `<rect x="${(quietZone + index * moduleWidth).toFixed(3)}" y="${barTop}" width="${moduleWidth.toFixed(3)}" height="${barHeight}" fill="#111827" />`;
  }

  const text = displayText || barcode;

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
          customPaperWidthMm: 100,
          customPaperHeightMm: 50,
          labelWidthMm: 100,
          labelHeightMm: 50,
          labelsPerRow: 1,
          labelsPerPage: 1,
          gapMm: 0,
          marginTopMm: 1.2,
          marginRightMm: 1.2,
          marginBottomMm: 1.2,
          marginLeftMm: 1.2,
          barcodeWidthScale: 100,
          barcodeHeight: Math.max(128, Number(baseSettings.barcodeHeight || 88)),
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
      ? { paperWidthMm: 100, paperHeightMm: 50, pageCss: "100mm 50mm" }
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
      ? Math.round(650 * (Number(normalizedSettings.barcodeWidthScale || 100) / 100))
    : Math.round(420 * (Number(normalizedSettings.barcodeWidthScale || 100) / 100));
  const barcodeHeight = resolvedTemplate === LABEL_TEMPLATE_THERMAL_LANDSCAPE_50X100
    ? Math.max(134, Number(normalizedSettings.barcodeHeight || 88))
    : resolvedTemplate === LABEL_TEMPLATE_PREMIUM_RETAIL_50X100
      ? Math.max(146, Number(normalizedSettings.barcodeHeight || 88))
    : Number(normalizedSettings.barcodeHeight || 88);

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
            </div>
          </article>
        `;
      }
      if (resolvedTemplate === LABEL_TEMPLATE_PREMIUM_RETAIL_50X100) {
        return `
          <article class="label premium-retail">
            <div class="premium-top">
              <div class="premium-image">
                <div class="image-fallback" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="#94a3b8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
                    <path d="M3.27 6.96 12 12.01l8.73-5.05"/>
                    <path d="M12 22.08V12"/>
                  </svg>
                </div>
                ${safeImage ? `<img src="${safeImage}" alt="${item.productName}" onerror="this.style.display='none'" />` : ""}
              </div>
              <div class="premium-details">
                <div class="premium-header">${item.productName}</div>
                <div class="premium-pill premium-price">
                  <span>${printCopy.price}</span>
                  <strong>$${Number(item.salePrice || 0).toFixed(2)}</strong>
                </div>
                <div class="premium-pill">
                  <span>${printCopy.size}</span>
                  <strong>${item.size}</strong>
                </div>
                <div class="premium-pill">
                  <span>${printCopy.color}</span>
                  <strong>${item.color}</strong>
                </div>
              </div>
            </div>
            <div class="premium-barcode">
              <div class="premium-barcode-svg">${barcodeSvg}</div>
              <div class="premium-sku">${item.sku}</div>
            </div>
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
            </div>
          </div>
        </article>
      `;
    };

  const pageMarkup = pages
    .map((pageLabels) => `
      <section class="sheet">
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
            grid-template-rows: 1fr 0.72fr;
            gap: 1.2mm;
            padding: 1.2mm;
            border-radius: 6px;
          }
          .premium-top {
            display: grid;
            grid-template-columns: 44% 56%;
            gap: 1.2mm;
            min-height: 0;
          }
          .premium-header {
            border: 1px solid #e2e8f0;
            border-radius: 4px;
            background: #f8fafc;
            padding: 1.2mm 1.6mm;
            font-size: clamp(10px, 2.4vw, 12px);
            line-height: 1.05;
            font-weight: 900;
            color: #111827;
            display: -webkit-box;
            -webkit-line-clamp: 2;
            -webkit-box-orient: vertical;
            overflow: hidden;
          }
          .premium-details {
            display: grid;
            grid-template-rows: auto auto 1fr 1fr;
            gap: 1mm;
            min-height: 0;
          }
          .premium-image {
            position: relative;
            overflow: hidden;
            border: 1px solid #e2e8f0;
            border-radius: 5px;
            background: #f8fafc;
          }
          .premium-image img {
            width: 100%;
            height: 100%;
            object-fit: contain;
            object-position: center;
            display: block;
            padding: 1.8mm;
            position: relative;
            z-index: 1;
            background: #ffffff;
          }
          .premium-pill {
            border: 1px solid #e2e8f0;
            border-radius: 4px;
            background: #f4f4f5;
            padding: 1.3mm 1.4mm;
            text-align: left;
            color: #111827;
          }
          .premium-pill span {
            display: block;
            font-size: 6px;
            line-height: 1;
            font-weight: 900;
            letter-spacing: 0.18em;
            text-transform: uppercase;
            color: #64748b;
          }
          .premium-pill strong {
            display: block;
            margin-top: 0.7mm;
            overflow: hidden;
            white-space: nowrap;
            text-overflow: ellipsis;
            font-size: 12px;
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
            font-size: 18px;
            color: #ffffff;
          }
          .premium-pill:nth-child(3) strong {
            font-size: 25px;
          }
          .premium-pill:nth-child(4) strong {
            font-size: 12px;
            text-transform: uppercase;
            font-weight: 900;
          }
          .premium-barcode {
            display: flex;
            min-height: 0;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 0.8mm;
            border: 1px solid #e2e8f0;
            border-radius: 5px;
            background: #ffffff;
            padding: 1.4mm 1mm 1.2mm;
          }
          .premium-barcode-svg {
            width: 95%;
            max-width: 95%;
            min-height: 22.5mm;
          }
          .premium-barcode-svg svg {
            width: 100%;
            height: auto;
            display: block;
          }
          .premium-sku {
            text-align: center;
            margin-top: 1.2mm;
            font-size: 10.5px;
            line-height: 1;
            font-weight: 900;
            color: #111827;
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
          @media print {
            body { background: #ffffff; }
            .page { padding: 0; background: #ffffff; }
            .sheet {
              gap: ${normalizedSettings.gapMm}mm;
              width: ${contentWidthMm}mm;
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
            @page {
              size: ${paper.pageCss};
              margin: 0;
            }
          }
        </style>
      </head>
      <body>
        <div class="page">
          ${pageMarkup}
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
} = {}) => {
  const win = safeWindow();
  if (!win) return false;

  const popup = win.open("", "_blank", "width=1280,height=980");
  if (!popup) return false;

  popup.document.write(
    buildBarcodePrintHtml({
      labels,
      sheetMode,
      template,
      printSettings,
      companyName,
      companyLogo,
      copy,
    })
  );
  popup.document.close();
  popup.focus();
  return popup;
};
