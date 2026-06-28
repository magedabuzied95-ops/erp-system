import { jsPDF } from "jspdf";
import Code128Reader from "@zxing/library/esm/core/oned/Code128Reader";

import { APP_NAME } from "../../../shared/constants/app";
import { resolveProductImageUrl } from "../../../shared/lib/imageUrls";

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

const createClockwiseMapper = (physicalPageWidth, physicalPageHeight) => ({
  mapRect: (x, y, w, h) => ({
    x: physicalPageWidth - y - h,
    y: x,
    w: h,
    h: w,
  }),
  mapPoint: (x, y) => ({
    x: physicalPageWidth - y,
    y: x,
  }),
  physicalPageWidth,
  physicalPageHeight,
});

const drawMappedRect = (doc, mapper, x, y, w, h, mode = "S") => {
  const mapped = mapper.mapRect(x, y, w, h);
  doc.rect(mapped.x, mapped.y, mapped.w, mapped.h, mode);
};

const drawMappedRoundedRect = (doc, mapper, x, y, w, h, radius = 1.5, fill = null, stroke = null) => {
  if (fill) {
    const [r, g, b] = fill;
    doc.setFillColor(r, g, b);
  }
  if (stroke) {
    const [r, g, b] = stroke;
    doc.setDrawColor(r, g, b);
  }
  const mapped = mapper.mapRect(x, y, w, h);
  doc.roundedRect(mapped.x, mapped.y, mapped.w, mapped.h, radius, radius, fill && stroke ? "FD" : fill ? "F" : "S");
};

const drawMappedText = (doc, mapper, text, x, y, options = {}) => {
  const mapped = mapper.mapPoint(x, y);
  doc.text(text, mapped.x, mapped.y, { ...options, angle: 90 });
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

const drawBarcode = (doc, mapper, value, x, y, width, height) => {
  const { barcode, rects } = getCode128Bars(value, width, height);
  doc.setFillColor(17, 24, 39);
  rects.forEach((rect) => {
    const mapped = mapper.mapRect(x + rect.x, y + rect.y, rect.w, rect.h);
    doc.rect(mapped.x, mapped.y, mapped.w, mapped.h, "F");
  });
  return barcode;
};

const drawImageOrPlaceholder = async (doc, mapper, item, x, y, w, h) => {
  const url = getLabelImageUrl(item);
  const imageData = await loadImageDataUrl(url);
  if (imageData) {
    try {
      const format = imageData.startsWith("data:image/png") ? "PNG" : "JPEG";
      const mapped = mapper.mapRect(x, y, w, h);
      doc.addImage(imageData, format, mapped.x, mapped.y, mapped.w, mapped.h, undefined, "FAST", 90);
      return true;
    } catch {
      try {
        const mapped = mapper.mapRect(x, y, w, h);
        doc.addImage(imageData, format, mapped.x, mapped.y, mapped.w, mapped.h, undefined, "FAST");
        return true;
      } catch {
        // Fall through to placeholder.
      }
    }
  }

  doc.setDrawColor(226, 232, 240);
  doc.setFillColor(248, 250, 252);
  const mapped = mapper.mapRect(x, y, w, h);
  doc.roundedRect(mapped.x, mapped.y, mapped.w, mapped.h, 2, 2, "FD");
  doc.setTextColor(100, 116, 139);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  const label = "No Image";
  const labelPoint = mapper.mapPoint(x + w / 2, y + h / 2 + 1);
  doc.text(label, labelPoint.x, labelPoint.y, { align: "center", baseline: "middle", angle: 90 });
  return false;
};

const renderLabelPage = async (doc, item = {}, index = 0) => {
  if (index === 0) {
    console.log("[PDF] page size", {
      width: doc.internal.pageSize.getWidth(),
      height: doc.internal.pageSize.getHeight(),
    });
  }
  const mapper = createClockwiseMapper(doc.internal.pageSize.getWidth(), doc.internal.pageSize.getHeight());
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
  drawMappedRect(doc, mapper, 0, 0, logicalPageWidth, logicalPageHeight, "F");
  doc.setDrawColor(226, 232, 240);
  drawMappedRect(doc, mapper, 0.4, 0.4, logicalPageWidth - 0.8, logicalPageHeight - 0.8, "S");

  await drawImageOrPlaceholder(doc, mapper, item, imageX, imageY, imageW, imageH);

  const titleLines = toTextLines(doc, productName, titleW, 2, 10);
  doc.setTextColor(2, 6, 23);
  doc.setFont("helvetica", "bold");
  titleLines.forEach((line, lineIndex) => {
    doc.setFontSize(lineIndex === 0 ? 10 : 9);
    drawMappedText(doc, mapper, line, titleX, titleY + (lineIndex * 5.0), { maxWidth: titleW });
  });

  drawMappedRoundedRect(doc, mapper, sizeBadgeX, sizeBadgeY, sizeBadgeW, sizeBadgeH, 1.8, [2, 6, 23]);
  doc.setTextColor(203, 213, 225);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(6.6);
  drawMappedText(doc, mapper, "SIZE", sizeBadgeX + sizeBadgeW / 2, sizeBadgeY + 3.5, { align: "center" });
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(16);
  drawMappedText(doc, mapper, sizeValue, sizeBadgeX + sizeBadgeW / 2, sizeBadgeY + 8.4, { align: "center" });

  drawMappedRoundedRect(doc, mapper, colorBoxX, colorBoxY, colorBoxW, colorBoxH, 1, [244, 244, 245], [226, 232, 240]);
  drawMappedRoundedRect(doc, mapper, priceBoxX, priceBoxY, priceBoxW, priceBoxH, 1, [244, 244, 245], [226, 232, 240]);
  doc.setTextColor(100, 116, 139);
  doc.setFontSize(5.5);
  drawMappedText(doc, mapper, "COLOR", colorBoxX + colorBoxW / 2, colorBoxY + 2.2, { align: "center" });
  drawMappedText(doc, mapper, "PRICE", priceBoxX + priceBoxW / 2, priceBoxY + 2.2, { align: "center" });
  doc.setTextColor(15, 23, 42);
  doc.setFontSize(8.6);
  drawMappedText(doc, mapper, colorValue || "-", colorBoxX + colorBoxW / 2, colorBoxY + 5.2, { align: "center" });
  doc.setFontSize(9.4);
  drawMappedText(doc, mapper, priceValue, priceBoxX + priceBoxW / 2, priceBoxY + 5.2, { align: "center" });

  doc.setTextColor(100, 116, 139);
  doc.setFontSize(5.4);
  drawMappedText(doc, mapper, skuValue, titleX, skuY, { maxWidth: titleW });

  const barcodeText = drawBarcode(doc, mapper, barcodeValue, barcodeX, barcodeY, barcodeW, barcodeH);
  doc.setTextColor(15, 23, 42);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.2);
  drawMappedText(doc, mapper, barcodeText, logicalPageWidth / 2, barcodeNumberY, { align: "center" });
};

export async function generateBarcodeLabelsPdf(labels = [], options = {}) {
  const title = normalizeLabelText(options.title || options.filename || "Barcode Labels", "Barcode Labels");
  const doc = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: [50, 100],
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
