import { jsPDF } from "jspdf";
import Code128Reader from "@zxing/library/esm/core/oned/Code128Reader";

import { APP_NAME } from "../../../shared/constants/app";
import { resolveProductImageUrl } from "../../../shared/lib/imageUrls";

const ENABLE_THERMAL_IMAGE_OPTIMIZER = true;
const THERMAL_WHITE_PROFILE = true;

const escapeString = (value = "") =>
  String(value ?? "")
    .replace(/\u0000/g, "")
    .trim();

const isArabicText = (value = "") => /[\u0600-\u06FF]/.test(String(value || ""));

const maybeProcessArabic = (doc, text) => {
  const raw = escapeString(text);
  if (!raw) return "";
  if (typeof doc.processArabic === "function" && isArabicText(raw)) {
    try {
      return doc.processArabic(raw);
    } catch {
      return raw;
    }
  }
  return raw;
};

const toTextLines = (doc, value, maxWidthMm, maxLines = 2, fontSize = 9) => {
  const text = escapeString(value);
  if (!text) return [];
  const previousSize = doc.getFontSize?.() || fontSize;
  doc.setFontSize(fontSize);
  const processed = maybeProcessArabic(doc, text);
  const lines = doc.splitTextToSize(processed, maxWidthMm) || [];
  doc.setFontSize(previousSize);
  if (!Array.isArray(lines) || !lines.length) return [processed];
  return lines.slice(0, maxLines);
};

const normalizeLabelText = (value, fallback = "") => {
  const text = escapeString(value);
  return text || escapeString(fallback);
};

const getLabelBarcodeValue = (item = {}) =>
  normalizeLabelText(
    item.barcodeValue ||
      item.barcode ||
      item.displayBarcode ||
      item.sku ||
      item.code ||
      item.qrToken ||
      "",
    `SKU-${item.id ?? item.productId ?? "0000"}`
  );

const getLabelImageUrl = (item = {}) =>
  resolveProductImageUrl(
    normalizeLabelText(item.imageUrl || item.resolvedImage || item.product_image_url || item.thumbnail_url || item.image || "")
  );

const blobToDataUrl = (blob) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Failed to read image blob"));
    reader.readAsDataURL(blob);
  });

const loadImageDataUrl = async (url) => {
  const safeUrl = normalizeLabelText(url);
  if (!safeUrl) return "";
  if (safeUrl.startsWith("data:")) return safeUrl;
  try {
    const response = await fetch(safeUrl, { credentials: "omit" });
    if (!response.ok) return "";
    const blob = await response.blob();
    return await blobToDataUrl(blob);
  } catch {
    return "";
  }
};

const loadCanvasImage = async (src) =>
  new Promise((resolve, reject) => {
    if (typeof Image === "undefined") {
      reject(new Error("Image is not available"));
      return;
    }

    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Failed to load image"));
    image.src = src;
  });

const clampByte = (value) => Math.max(0, Math.min(255, Math.round(value)));

const prepareThermalImage = async (imageData) => {
  if (!ENABLE_THERMAL_IMAGE_OPTIMIZER || !imageData || typeof document === "undefined") {
    return "";
  }

  try {
    const image = await loadCanvasImage(imageData);
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth || image.width || 0;
    canvas.height = image.naturalHeight || image.height || 0;
    if (!canvas.width || !canvas.height) return "";

    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return "";

    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const sourceBuffer = context.getImageData(0, 0, canvas.width, canvas.height);
    const sourceData = sourceBuffer.data;
    const pixelCount = sourceData.length / 4;
    const luminances = new Float32Array(pixelCount);
    const histogram = new Uint32Array(256);

    let minLuminance = 255;
    let maxLuminance = 0;
    let luminanceSum = 0;

    for (let offset = 0, pixelIndex = 0; offset < sourceData.length; offset += 4, pixelIndex += 1) {
      const luminance = (sourceData[offset] * 0.299) + (sourceData[offset + 1] * 0.587) + (sourceData[offset + 2] * 0.114);
      luminances[pixelIndex] = luminance;
      histogram[clampByte(luminance)] += 1;
      luminanceSum += luminance;
      if (luminance < minLuminance) minLuminance = luminance;
      if (luminance > maxLuminance) maxLuminance = luminance;
    }

    const averageLuminance = luminanceSum / Math.max(1, pixelCount);
    const whiteProduct = THERMAL_WHITE_PROFILE && averageLuminance > 220;
    const getLuminanceAt = (x, y) => {
      const clampedX = Math.max(0, Math.min(canvas.width - 1, x));
      const clampedY = Math.max(0, Math.min(canvas.height - 1, y));
      return luminances[(clampedY * canvas.width) + clampedX] || 0;
    };

    const safePercentile = (percent) => {
      const target = pixelCount * percent;
      let running = 0;
      for (let index = 0; index < histogram.length; index += 1) {
        running += histogram[index];
        if (running >= target) return index;
      }
      return 255;
    };

    const lowCut = safePercentile(0.02);
    const highCut = Math.max(lowCut + 1, safePercentile(0.98));
    const range = Math.max(1, highCut - lowCut);
    const autoLevels = (value) => clampByte(((value - lowCut) / range) * 255);

    const applyDarkProfile = () => {
      const output = new Uint8ClampedArray(sourceData);
      for (let offset = 0, pixelIndex = 0; offset < output.length; offset += 4, pixelIndex += 1) {
        const luminance = luminances[pixelIndex];
        const normalized = autoLevels(luminance);
        const contrasted = clampByte((((normalized - 128) * 1.2) + 128) * 0.95);
        const gammaAdjusted = clampByte(Math.pow(Math.max(0, Math.min(1, contrasted / 255)), 0.9) * 255);
        const sourceR = sourceData[offset];
        const sourceG = sourceData[offset + 1];
        const sourceB = sourceData[offset + 2];
        const sourceLum = Math.max(1, luminance);
        const chromaScale = gammaAdjusted / sourceLum;
        output[offset] = clampByte(sourceR * chromaScale);
        output[offset + 1] = clampByte(sourceG * chromaScale);
        output[offset + 2] = clampByte(sourceB * chromaScale);
      }
      return output;
    };

    const applyWhiteProfile = () => {
      const base = new Uint8ClampedArray(sourceData);
      const working = new Uint8ClampedArray(sourceData);
      const width = canvas.width;
      const height = canvas.height;

      const writePixel = (buffer, index, r, g, b) => {
        buffer[index] = r;
        buffer[index + 1] = g;
        buffer[index + 2] = b;
      };

      for (let offset = 0; offset < working.length; offset += 4) {
        const r = base[offset];
        const g = base[offset + 1];
        const b = base[offset + 2];
        const luminance = (r * 0.299) + (g * 0.587) + (b * 0.114);
        const normalized = autoLevels(luminance);
        const darkened = clampByte(normalized * 0.9);
        const contrasted = clampByte((((darkened - 128) * 1.35) + 128));
        const gammaAdjusted = clampByte(Math.pow(Math.max(0, Math.min(1, contrasted / 255)), 0.88) * 255);
        const sourceLum = Math.max(1, luminance);
        const chromaScale = gammaAdjusted / sourceLum;
        writePixel(working, offset, clampByte(r * chromaScale), clampByte(g * chromaScale), clampByte(b * chromaScale));
        working[offset + 3] = base[offset + 3];
      }

      const blurred = new Uint8ClampedArray(working);
      const kernel = [
        1, 2, 1,
        2, 4, 2,
        1, 2, 1,
      ];
      let maxBlackDensity = 0;
      const darkMask = new Float32Array(pixelCount);

      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          let sumR = 0;
          let sumG = 0;
          let sumB = 0;
          let weightSum = 0;
          let kernelIndex = 0;
          for (let ky = -1; ky <= 1; ky += 1) {
            for (let kx = -1; kx <= 1; kx += 1) {
              const px = Math.max(0, Math.min(width - 1, x + kx));
              const py = Math.max(0, Math.min(height - 1, y + ky));
              const sourceIndex = ((py * width) + px) * 4;
              const weight = kernel[kernelIndex];
              sumR += working[sourceIndex] * weight;
              sumG += working[sourceIndex + 1] * weight;
              sumB += working[sourceIndex + 2] * weight;
              weightSum += weight;
              kernelIndex += 1;
            }
          }
          const index = ((y * width) + x) * 4;
          const blurR = sumR / weightSum;
          const blurG = sumG / weightSum;
          const blurB = sumB / weightSum;
          const localAverage = (
            getLuminanceAt(x - 1, y) +
            getLuminanceAt(x + 1, y) +
            getLuminanceAt(x, y - 1) +
            getLuminanceAt(x, y + 1) +
            getLuminanceAt(x, y)
          ) / 5;
          const currentLum = getLuminanceAt(x, y);
          const adaptiveThreshold = localAverage - 10;
          const thresholdDelta = adaptiveThreshold - currentLum;
          const thresholdBoost = thresholdDelta > 0 ? Math.min(0.22, thresholdDelta / 255) : 0;
          const sharpenedR = clampByte((working[index] * 1.08) - (blurR * 0.08));
          const sharpenedG = clampByte((working[index + 1] * 1.08) - (blurG * 0.08));
          const sharpenedB = clampByte((working[index + 2] * 1.08) - (blurB * 0.08));
          const localContrastBoost = clampByte((currentLum * 1.03) + ((currentLum - localAverage) * 0.18));
          const boostedR = clampByte((sharpenedR * 0.82) + (localContrastBoost * 0.18));
          const boostedG = clampByte((sharpenedG * 0.82) + (localContrastBoost * 0.18));
          const boostedB = clampByte((sharpenedB * 0.82) + (localContrastBoost * 0.18));
          const mix = thresholdBoost;
          const finalR = clampByte((boostedR * (1 - mix)) + (40 * mix));
          const finalG = clampByte((boostedG * (1 - mix)) + (40 * mix));
          const finalB = clampByte((boostedB * (1 - mix)) + (40 * mix));

          blurred[index] = finalR;
          blurred[index + 1] = finalG;
          blurred[index + 2] = finalB;
          blurred[index + 3] = working[index + 3];
        }
      }

      for (let offset = 0; offset < blurred.length; offset += 4) {
        const currentLum = (blurred[offset] * 0.299) + (blurred[offset + 1] * 0.587) + (blurred[offset + 2] * 0.114);
        const x = (offset / 4) % width;
        const y = Math.floor((offset / 4) / width);
        const gradient =
          Math.abs(currentLum - getLuminanceAt(x - 1, y)) +
          Math.abs(currentLum - getLuminanceAt(x + 1, y)) +
          Math.abs(currentLum - getLuminanceAt(x, y - 1)) +
          Math.abs(currentLum - getLuminanceAt(x, y + 1));
        const edgeBoost = gradient > 18 ? Math.min(0.12, gradient / 400) : 0;
        if (edgeBoost > 0) {
          blurred[offset] = clampByte(blurred[offset] * (1 - edgeBoost));
          blurred[offset + 1] = clampByte(blurred[offset + 1] * (1 - edgeBoost));
          blurred[offset + 2] = clampByte(blurred[offset + 2] * (1 - edgeBoost));
        }
        const darkPixel = ((blurred[offset] + blurred[offset + 1] + blurred[offset + 2]) / 3) < 48 ? 1 : 0;
        darkMask[offset / 4] = darkPixel;
      }

      const darkDensity = darkMask.reduce((sum, value) => sum + value, 0) / Math.max(1, darkMask.length);
      if (darkDensity > 0.24) {
        const soften = Math.max(0.72, 1 - ((darkDensity - 0.24) * 0.9));
        for (let offset = 0; offset < blurred.length; offset += 4) {
          blurred[offset] = clampByte((blurred[offset] * soften) + (sourceData[offset] * (1 - soften)));
          blurred[offset + 1] = clampByte((blurred[offset + 1] * soften) + (sourceData[offset + 1] * (1 - soften)));
          blurred[offset + 2] = clampByte((blurred[offset + 2] * soften) + (sourceData[offset + 2] * (1 - soften)));
        }
      }

      return blurred;
    };

    let outputData = sourceData;
    if (whiteProduct) {
      outputData = applyWhiteProfile();
    } else {
      outputData = applyDarkProfile();
    }

    const outputBuffer = new ImageData(outputData, canvas.width, canvas.height);
    context.putImageData(outputBuffer, 0, 0);
    return canvas.toDataURL("image/png");
  } catch {
    return "";
  }
};

const getCode128Bars = (value, widthMm, heightMm) => {
  const barcode = normalizeLabelText(value);
  const quietZone = 2.8;
  const codes = [Code128Reader.CODE_START_B];

  for (const char of barcode) {
    const charCode = char.charCodeAt(0);
    const codeValue = charCode >= 32 && charCode <= 126 ? charCode - 32 : 0;
    codes.push(codeValue);
  }

  const checksum = codes.reduce((sum, code, index) => {
    if (index === 0) return code;
    return sum + code * index;
  }, 0) % 103;

  codes.push(checksum, Code128Reader.CODE_STOP);

  const moduleCount = codes.reduce((sum, code) => {
    const pattern = Code128Reader.CODE_PATTERNS[code] || [];
    return sum + pattern.reduce((widthSum, moduleWidth) => widthSum + moduleWidth, 0);
  }, 0);

  const moduleWidth = Math.max(0.12, (widthMm - quietZone * 2) / Math.max(1, moduleCount));
  const barHeight = Math.max(0.1, heightMm);
  const rects = [];
  let cursorX = quietZone;

  codes.forEach((code) => {
    const pattern = Code128Reader.CODE_PATTERNS[code] || [];
    pattern.forEach((segmentWidth, segmentIndex) => {
      const width = segmentWidth * moduleWidth;
      if (segmentIndex % 2 === 0) {
        rects.push({ x: cursorX, y: 0, w: width, h: barHeight });
      }
      cursorX += width;
    });
  });

  return {
    barcode,
    rects,
  };
};

const drawBarcode = (doc, value, x, y, width, height) => {
  const { barcode, rects } = getCode128Bars(value, width, height);
  doc.setFillColor(17, 24, 39);
  rects.forEach((rect) => {
    doc.rect(x + rect.x, y + rect.y, rect.w, rect.h, "F");
  });
  return barcode;
};

const drawImageOrPlaceholder = async (doc, item, x, y, w, h) => {
  const url = getLabelImageUrl(item);
  const imageData = await loadImageDataUrl(url);
  doc.setFillColor(245, 245, 245);
  doc.setDrawColor(160, 160, 160);
  doc.roundedRect(x, y, w, h, 2, 2, "FD");
  if (imageData) {
    try {
      const optimizedImageData = await prepareThermalImage(imageData);
      const finalImageData = optimizedImageData || imageData;
      const format = finalImageData.startsWith("data:image/png") ? "PNG" : "JPEG";
      doc.addImage(finalImageData, format, x, y, w, h, undefined, "FAST");
      return true;
    } catch {
      try {
        const format = imageData.startsWith("data:image/png") ? "PNG" : "JPEG";
        doc.addImage(imageData, format, x, y, w, h, undefined, "FAST");
        return true;
      } catch {
        // Fall through to placeholder.
      }
    }
  }

  doc.setTextColor(100, 116, 139);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  const label = "No Image";
  doc.text(label, x + w / 2, y + h / 2 + 1, { align: "center", baseline: "middle" });
  return false;
};

const drawRoundedRect = (doc, x, y, w, h, radius = 1.5, fill = null, stroke = null) => {
  if (fill) {
    const [r, g, b] = fill;
    doc.setFillColor(r, g, b);
  }
  if (stroke) {
    const [r, g, b] = stroke;
    doc.setDrawColor(r, g, b);
  }
  doc.roundedRect(x, y, w, h, radius, radius, fill && stroke ? "FD" : fill ? "F" : "S");
};

const renderLabelPage = async (doc, item = {}, index = 0) => {
  if (index === 0) {
    console.log("[PDF] page size", {
      width: doc.internal.pageSize.getWidth(),
      height: doc.internal.pageSize.getHeight(),
    });
  }
  const logicalPageWidth = 100;
  const logicalPageHeight = 50;
  const imageX = 2;
  const imageY = 3.2;
  const imageW = 35.5;
  const imageH = 30.0;
  const titleX = 40.5;
  const titleY = 6;
  const titleW = 57.5;
  const sizeBadgeX = 40.5;
  const sizeBadgeY = 14.0;
  const sizeBadgeW = 20.5;
  const sizeBadgeH = 11.5;
  const colorBoxX = 40.5;
  const colorBoxY = 27.8;
  const colorBoxW = 15.2;
  const colorBoxH = 6.8;
  const priceBoxX = 55.9;
  const priceBoxY = 27.8;
  const priceBoxW = 15.2;
  const priceBoxH = 6.8;
  const skuY = 39.2;
  const barcodeX = 5;
  const barcodeY = 39.1;
  const barcodeW = 90;
  const barcodeH = 7.0;
  const barcodeNumberY = 48.8;

  const productName = normalizeLabelText(item.productName || item.name || item.title || `Label ${index + 1}`);
  const sizeValue = normalizeLabelText(item.size || item.variantSize || item.labelSize || "ONE SIZE");
  const colorValue = normalizeLabelText(item.color || item.variantColor || item.labelColor || "");
  const numericPrice = Number(item.salePrice ?? item.price ?? item.displayPrice ?? 0);
  const priceValue = `EGP ${Math.round(Number.isFinite(numericPrice) ? numericPrice : 0)}`;
  const skuValue = normalizeLabelText(item.sku || item.article || item.variantSku || "");
  const barcodeValue = getLabelBarcodeValue(item);
  if (typeof doc.setR2L === "function") {
    doc.setR2L(isArabicText(productName));
  }

  doc.setFillColor(255, 255, 255);
  doc.rect(0, 0, logicalPageWidth, logicalPageHeight, "F");
  doc.setDrawColor(226, 232, 240);
  doc.rect(0.4, 0.4, logicalPageWidth - 0.8, logicalPageHeight - 0.8, "S");

  await drawImageOrPlaceholder(doc, item, imageX, imageY, imageW, imageH);

  const titleLines = toTextLines(doc, productName, titleW, 2, 10);
  doc.setTextColor(2, 6, 23);
  doc.setFont("helvetica", "bold");
  titleLines.forEach((line, lineIndex) => {
    doc.setFontSize(lineIndex === 0 ? 10 : 9);
    doc.text(line, titleX, titleY + (lineIndex * 5.0), { maxWidth: titleW });
  });

  drawRoundedRect(doc, sizeBadgeX, sizeBadgeY, sizeBadgeW, sizeBadgeH, 1.8, [2, 6, 23]);
  doc.setTextColor(203, 213, 225);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(6.6);
  doc.text("SIZE", sizeBadgeX + sizeBadgeW / 2, sizeBadgeY + 3.5, { align: "center" });
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(16);
  doc.text(sizeValue, sizeBadgeX + sizeBadgeW / 2, sizeBadgeY + 8.4, { align: "center" });

  drawRoundedRect(doc, colorBoxX, colorBoxY, colorBoxW, colorBoxH, 1, [244, 244, 245], [226, 232, 240]);
  drawRoundedRect(doc, priceBoxX, priceBoxY, priceBoxW, priceBoxH, 1, [244, 244, 245], [226, 232, 240]);
  doc.setTextColor(100, 116, 139);
  doc.setFontSize(5.5);
  doc.text("COLOR", colorBoxX + colorBoxW / 2, colorBoxY + 2.2, { align: "center" });
  doc.text("PRICE", priceBoxX + priceBoxW / 2, priceBoxY + 2.2, { align: "center" });
  doc.setTextColor(15, 23, 42);
  doc.setFontSize(8.6);
  doc.text(colorValue || "-", colorBoxX + colorBoxW / 2, colorBoxY + 5.2, { align: "center" });
  doc.setFontSize(9.4);
  doc.text(priceValue, priceBoxX + priceBoxW / 2, priceBoxY + 5.2, { align: "center" });

  doc.setTextColor(100, 116, 139);
  doc.setFontSize(5.4);
  doc.text(skuValue, titleX, skuY, { maxWidth: titleW });

  const barcodeText = drawBarcode(doc, barcodeValue, barcodeX, barcodeY, barcodeW, barcodeH);
  doc.setTextColor(15, 23, 42);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.2);
  doc.text(barcodeText, logicalPageWidth / 2, barcodeNumberY, { align: "center" });
};

export async function generateBarcodeLabelsPdf(labels = [], options = {}) {
  const title = normalizeLabelText(options.title || options.filename || "Barcode Labels", "Barcode Labels");
  const doc = new jsPDF({
    orientation: "landscape",
    unit: "mm",
    format: [100, 50],
    compress: true,
  });

  doc.setProperties({
    title,
    subject: title,
    author: APP_NAME,
  });

  console.log("[PDF] labels.length =", labels.length);

  const pageCount = Array.isArray(labels) ? labels.length : 0;
  for (let index = 0; index < pageCount; index += 1) {
    if (index > 0) doc.addPage();
    // eslint-disable-next-line no-await-in-loop
    console.log("[PDF] rendering page", index, labels[index]);
    await renderLabelPage(doc, labels[index] || {}, index);
    console.log("[PDF] page rendered", index);
  }

  console.log("[PDF] total pages =", doc.getNumberOfPages());

  const blob = doc.output("blob");
  const debug = {
    labelsCount: Array.isArray(labels) ? labels.length : 0,
    pageWidth: doc.internal.pageSize.getWidth(),
    pageHeight: doc.internal.pageSize.getHeight(),
    totalPages: doc.getNumberOfPages(),
  };

  return { blob, debug };
}
