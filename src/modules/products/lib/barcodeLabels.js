import { APP_NAME } from "../../../shared/constants/app";
import { resolveProductImageUrl } from "../../../shared/lib/imageUrls";

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
  const env = typeof import.meta !== "undefined" ? import.meta.env || {} : {};
  const configured = String(
    env.VITE_PUBLIC_STOREFRONT_URL ||
      env.VITE_STORE_FRONT_URL ||
      env.VITE_STOREFRONT_URL ||
      env.VITE_PUBLIC_FRONTEND_URL ||
      env.VITE_PUBLIC_APP_URL ||
      env.FRONTEND_URL ||
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

export const buildBarcodeShopLabelItem = (product = null, quantity = 1) => {
  if (!product) return null;
  const qrToken = getBarcodeShopQrValue(product);
  const priceInfo = getLabelPriceInfo(product);
  return {
    key: `barcode-shop:${product.id}`,
    productId: product.id,
    productName: product.name || "Unnamed product",
    brand: product.brand || "Brand",
    category: product.category || "Category",
    qrToken,
    qrValue: getBarcodeShopQrUrl(product),
    salePrice: priceInfo.price,
    comparePrice: priceInfo.comparePrice,
    saleActive: priceInfo.saleActive,
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
  const isThermal = sheetMode === "thermal";
  const sheetClass = isThermal ? "sheet thermal" : "sheet a4";
  const labelClass = isThermal ? "label thermal" : "label a4";
  const imageClass = isThermal ? "image image-thermal" : "image image-a4";
  const barcodeWidth = isThermal ? 310 : 420;
  const barcodeHeight = isThermal ? 76 : 88;

  const labelMarkup = labels
    .map((item) => {
      const safeImage = getSafeLabelImageUrl(item);
      const barcodeSvg = getBarcodeSvg(item.barcodeValue, {
        width: barcodeWidth,
        height: barcodeHeight,
        displayText: item.barcode,
      });

      return `
        <article class="${labelClass}">
          <div class="body">
            <div class="${imageClass}">
              <div class="image-fallback" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="#94a3b8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
                  <path d="M3.27 6.96 12 12.01l8.73-5.05"/>
                  <path d="M12 22.08V12"/>
                </svg>
              </div>
              ${safeImage ? `<img src="${safeImage}" alt="${item.productName}" onerror="this.style.display='none'" />` : ""}
            </div>

            <div class="content">
              <h2>${item.productName}</h2>
              <div class="meta">
                <span><strong>${printCopy.color}</strong> ${item.color}</span>
                <span><strong>${printCopy.size}</strong> ${item.size}</span>
              </div>
              <div class="meta">
                <span><strong>${printCopy.sku}</strong> ${item.sku}</span>
                <span><strong>${printCopy.price}</strong> $${Number(item.salePrice || 0).toFixed(2)}</span>
              </div>
              <div class="barcode">${barcodeSvg}</div>
            </div>
          </div>
        </article>
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
          .page {
            padding: 16px;
            background: #0f172a;
            min-height: 100vh;
          }
          .sheet {
            background: #ffffff;
            margin: 0 auto;
            display: grid;
            gap: 10px;
          }
          .sheet.a4 {
            width: 190mm;
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
          .sheet.thermal {
            width: 80mm;
            grid-template-columns: 1fr;
          }
          .label {
            background: #ffffff;
            border: 1px solid #e2e8f0;
          border-radius: 18px;
          padding: 12px;
          overflow: hidden;
          break-inside: avoid;
          page-break-inside: avoid;
          }
          .label.a4 {
            min-height: 92mm;
          }
          .label.thermal {
            min-height: 62mm;
          }
          .body {
            display: grid;
            gap: 12px;
            align-items: stretch;
            grid-template-columns: ${isThermal ? "28mm minmax(0,1fr)" : "42mm minmax(0,1fr)"};
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
            min-height: ${isThermal ? "44mm" : "54mm"};
          }
          .image-fallback {
            position: absolute;
            inset: 0;
            display: flex;
            align-items: center;
            justify-content: center;
          }
          .image-a4 {
            height: 54mm;
          }
          .image-thermal {
            height: 44mm;
          }
          .image img {
            width: 100%;
            height: 100%;
            object-fit: contain;
            object-position: center;
            display: block;
            padding: ${isThermal ? "6px" : "8px"};
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
            font-size: ${isThermal ? "14px" : "20px"};
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
            font-size: ${isThermal ? "9px" : "12px"};
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
            gap: 6mm;
            box-shadow: none;
          }
            .sheet.a4 {
              width: 100%;
              grid-template-columns: repeat(2, minmax(0, 1fr));
            }
            .sheet.thermal {
              width: 100%;
            }
            .label {
              box-shadow: none;
            }
            .image {
              box-shadow: none;
            }
            @page {
              size: ${isThermal ? "80mm auto" : "A4 portrait"};
              margin: ${isThermal ? "4mm" : "10mm"};
            }
          }
        </style>
      </head>
      <body>
        <div class="page">
          <section class="${sheetClass}">
            ${labelMarkup}
          </section>
        </div>
      </body>
    </html>
  `;
};

export const openBarcodePrintWindow = ({
  labels = [],
  sheetMode = "a4",
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
      companyName,
      companyLogo,
      copy,
    })
  );
  popup.document.close();
  popup.focus();
  return popup;
};
