import { jsPDF } from "jspdf";
import Code128Reader from "@zxing/library/esm/core/oned/Code128Reader";

import { APP_NAME } from "../../../shared/constants/app";
import { resolveProductImageUrl } from "../../../shared/lib/imageUrls";
import { loadImageDataUrl } from "./thermalImageOptimizer";
import { BARCODE_LABEL_LAYOUT, fitThermalColorValueFontSize, getBoxFrameLayout, getBoxTextLayout, getThermalLandscapeLabelLayout, resolveBarcodeLabelImage, resolveLabelArticleCode } from "./barcodeLabels";

const thermalImageCache = new Map();

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

const ellipsizeLine = (doc, value, maxWidthMm) => {
  const text = escapeString(value);
  if (!text) return "";
  if (doc.getTextWidth(text) <= maxWidthMm) return text;
  let output = text;
  while (output.length > 1 && doc.getTextWidth(`${output}...`) > maxWidthMm) {
    output = output.slice(0, -1);
  }
  return `${output}...`;
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

const getLabelImageUrl = (item = {}) => resolveProductImageUrl(normalizeLabelText(resolveBarcodeLabelImage(item)));

const loadCachedImageDataUrl = async (imageUrl = "") => {
  const resolvedUrl = resolveProductImageUrl(normalizeLabelText(imageUrl));
  if (!resolvedUrl) return "";
  if (thermalImageCache.has(resolvedUrl)) {
    return thermalImageCache.get(resolvedUrl);
  }
  const promise = loadImageDataUrl(resolvedUrl)
    .then((value) => value || "")
    .catch(() => "");
  thermalImageCache.set(resolvedUrl, promise);
  const result = await promise;
  thermalImageCache.set(resolvedUrl, result);
  return result;
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
  const sourceUrl = getLabelImageUrl(item);
  doc.setFillColor(245, 245, 245);
  doc.setDrawColor(160, 160, 160);
  doc.roundedRect(x, y, w, h, 2, 2, "FD");
  if (sourceUrl) {
    try {
      const imageData = await loadCachedImageDataUrl(sourceUrl);
      if (!imageData) throw new Error("Failed to load image");
      const format = imageData.startsWith("data:image/png") ? "PNG" : "JPEG";
      doc.addImage(imageData, format, x, y, w, h, undefined, "FAST");
      return true;
    } catch {
      console.warn("[barcode-pdf] failed to add image", { url: sourceUrl });
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

const fitTextSize = (doc, text, maxWidth, fontSize, minFontSize = 3.8) => {
  const value = String(text || "").trim();
  if (!value) return minFontSize;
  let currentSize = fontSize;
  doc.setFont("helvetica", "bold");
  while (currentSize > minFontSize) {
    doc.setFontSize(currentSize);
    if (doc.getTextWidth(value) <= maxWidth) return currentSize;
    currentSize -= 0.2;
  }
  return minFontSize;
};

const renderLabelPage = async (doc, item = {}, index = 0) => {
  const productName = normalizeLabelText(item.productName || item.name || item.title || `Label ${index + 1}`);
  const sizeValue = normalizeLabelText(item.size || item.variantSize || item.labelSize || "ONE SIZE");
  const rawColorValue = normalizeLabelText(item.color || item.variantColor || item.labelColor || "");
  const colorValue = /[\u0600-\u06FF]/.test(rawColorValue) ? rawColorValue : rawColorValue.toUpperCase();
  const skuValue = normalizeLabelText(resolveLabelArticleCode(item));
  const showArticleBox = Boolean(skuValue);
  const thermalLayout = getThermalLandscapeLabelLayout(showArticleBox);
  const { page, imageCell, titleCell, sizeCell, articleCell, colorCell, barcodeCell } = thermalLayout;
  const barcodeValue = getLabelBarcodeValue(item);
  if (typeof doc.setR2L === "function") {
    doc.setR2L(isArabicText(productName));
  }

  doc.setFillColor(255, 255, 255);
  doc.rect(0, 0, page.width, page.height, "F");
  doc.setDrawColor(226, 232, 240);
  doc.rect(0.4, 0.4, page.width - 0.8, page.height - 0.8, "S");

  await drawImageOrPlaceholder(doc, item, imageCell.x, imageCell.y + 1, imageCell.w, imageCell.h - 1);

  const titleLines = toTextLines(doc, productName, titleCell.w, thermalLayout.titleMaxLines, thermalLayout.titleFontSize);
  const titleLinesToRender = titleLines.slice(0, thermalLayout.titleMaxLines);
  if (titleLinesToRender.length === thermalLayout.titleMaxLines) {
    titleLinesToRender[titleLinesToRender.length - 1] = ellipsizeLine(doc, titleLinesToRender[titleLinesToRender.length - 1], titleCell.w);
  }
  drawRoundedRect(doc, titleCell.x, titleCell.y, titleCell.w, titleCell.h, 1.8, [2, 6, 23], [2, 6, 23]);
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  const titleMaxWidth = Math.max(1, titleCell.w - 2.4);
  const titleBaseFontSize = fitTextSize(doc, titleLinesToRender[0] || productName, titleMaxWidth, thermalLayout.titleFontSize, 6);
  const titleLineStep = Math.max(3.8, thermalLayout.titleLineStepMm * 0.78);
  const titleStartY = titleCell.y + 3.0;
  titleLinesToRender.forEach((line, lineIndex) => {
    const nextSize = lineIndex === 0 ? titleBaseFontSize : Math.max(6, titleBaseFontSize * 0.88);
    doc.setFontSize(nextSize);
    doc.text(line, titleCell.x + (titleCell.w / 2), titleStartY + (lineIndex * titleLineStep), { align: "center", maxWidth: titleMaxWidth });
  });

  const sizeFrame = getBoxFrameLayout(sizeCell, { boxWidthFactor: thermalLayout.sizeBoxWidthFactor || 1 });
  drawRoundedRect(doc, sizeFrame.x, sizeFrame.y, sizeFrame.w, sizeFrame.h, 1.8, [2, 6, 23]);
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(thermalLayout.sizeLabelFontSize);
  const sizeTextLayout = getBoxTextLayout(sizeCell, {
    topPaddingMm: 1.5,
    labelGapMm: 1.0,
    labelFontSize: thermalLayout.sizeLabelFontSize,
    valueFontSize: thermalLayout.sizeValueFontSize,
  });
  doc.text("SIZE", sizeFrame.x + sizeFrame.w / 2, sizeTextLayout.labelTextY, { align: "center" });
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(thermalLayout.sizeValueFontSize);
  doc.text(sizeValue, sizeFrame.x + sizeFrame.w / 2, sizeTextLayout.valueTextY, { align: "center" });

  if (showArticleBox) {
    drawRoundedRect(doc, articleCell.x, articleCell.y, thermalLayout.articleBoxWidth, thermalLayout.articleBoxHeight, 1, [2, 6, 23], [2, 6, 23]);
    doc.setTextColor(255, 255, 255);
    const articleTextLayout = getBoxTextLayout(articleCell, {
      topPaddingMm: 1.5,
      labelGapMm: 1.0,
      labelFontSize: thermalLayout.articleLabelFontSize,
      valueFontSize: thermalLayout.articleFontSize,
      valueFontSizeCompact: thermalLayout.articleFontSizeCompact,
    });
    doc.setFontSize(thermalLayout.articleLabelFontSize);
    doc.text("ARTICLE CODE", articleCell.x + thermalLayout.articleBoxWidth / 2, articleTextLayout.labelTextY - 0.4, { align: "center" });
    doc.setTextColor(255, 255, 255);
    const skuFontSize = fitTextSize(doc, skuValue, thermalLayout.articleBoxWidth - 2, Math.max(thermalLayout.sizeValueFontSize * 0.92, thermalLayout.articleFontSize), thermalLayout.articleFontSizeCompact);
    doc.setFontSize(skuFontSize);
    doc.text(skuValue, articleCell.x + thermalLayout.articleBoxWidth / 2, articleTextLayout.valueTextY, { align: "center" });
  }

  const colorFrame = getBoxFrameLayout(colorCell, { boxHeightFactor: 1.0 });
  drawRoundedRect(doc, colorFrame.x, colorFrame.y, colorFrame.w, colorFrame.h, 1, [2, 6, 23], [2, 6, 23]);
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(thermalLayout.colorLabelFontSize);
  const colorMidY = colorFrame.y + colorFrame.h / 2;
  doc.text("COLOR", colorFrame.x + 1.1, colorMidY, { align: "left", baseline: "middle" });
  doc.setDrawColor(255, 255, 255);
  doc.setLineWidth(0.12);
  doc.line(colorFrame.x + 12.8, colorFrame.y + 1, colorFrame.x + 12.8, colorFrame.y + colorFrame.h - 1);
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(fitThermalColorValueFontSize(colorValue, colorFrame.w - 13.9, thermalLayout.colorValueFontSize));
  doc.setFont("helvetica", "bold");
  doc.text(colorValue || "-", colorFrame.x + 13.9, colorMidY, { align: "left", baseline: "middle", maxWidth: colorFrame.w - 15.0 });

  if (!showArticleBox) {
    doc.setTextColor(15, 23, 42);
    doc.setFontSize(10.4);
    if (skuValue) {
      doc.setFont("helvetica", "bold");
      doc.text(skuValue, page.width / 2, barcodeCell.y - 0.9, { align: "center", maxWidth: titleCell.w });
    }
  }

  const barcodeText = drawBarcode(doc, barcodeValue, barcodeCell.x, barcodeCell.y, barcodeCell.w, barcodeCell.h);
  doc.setTextColor(15, 23, 42);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(barcodeCell.fontSize);
  doc.text(barcodeText, page.width / 2, barcodeCell.textY, { align: "center" });
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

  const pageCount = Array.isArray(labels) ? labels.length : 0;
  for (let index = 0; index < pageCount; index += 1) {
    if (index > 0) doc.addPage();
    // eslint-disable-next-line no-await-in-loop
    await renderLabelPage(doc, labels[index] || {}, index);
  }

  const blob = doc.output("blob");
  const debug = {
    labelsCount: Array.isArray(labels) ? labels.length : 0,
    pageWidth: doc.internal.pageSize.getWidth(),
    pageHeight: doc.internal.pageSize.getHeight(),
    totalPages: doc.getNumberOfPages(),
  };

  return { blob, debug };
}
