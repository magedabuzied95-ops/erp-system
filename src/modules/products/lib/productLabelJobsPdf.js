import { jsPDF } from "jspdf";
import Code128Reader from "@zxing/library/esm/core/oned/Code128Reader";

const ARABIC_FONT = {
  fileName: "product-label-arabic.ttf",
  family: "ProductLabelArabic",
  url: new URL("../../../../server/assets/fonts/NotoSansArabic.ttf", import.meta.url).href,
};
let arabicFontPromise = null;

const hasArabic = (value = "") => /[\u0600-\u06ff]/.test(String(value || ""));
const arrayBufferToBinaryString = (buffer) => {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return binary;
};
const registerArabicFont = async (doc) => {
  if (!arabicFontPromise) {
    arabicFontPromise = fetch(ARABIC_FONT.url).then((response) => {
      if (!response.ok) throw new Error(`Failed to load Arabic product-label font: ${response.status}`);
      return response.arrayBuffer();
    }).then(arrayBufferToBinaryString);
  }
  const fontData = await arabicFontPromise;
  doc.addFileToVFS(ARABIC_FONT.fileName, fontData);
  doc.addFont(ARABIC_FONT.fileName, ARABIC_FONT.family, "normal");
  doc.addFont(ARABIC_FONT.fileName, ARABIC_FONT.family, "bold");
  if (typeof doc.setLanguage === "function") doc.setLanguage("ar");
};
const setLabelFont = (doc, value = "") => {
  doc.setFont(hasArabic(value) ? ARABIC_FONT.family : "helvetica", "bold");
};
const drawLabelText = (doc, value, x, y, options = {}) => {
  const raw = String(value || "");
  const isArabic = hasArabic(raw);
  setLabelFont(doc, raw);
  // jsPDF shapes Arabic correctly with the embedded Noto font. Enabling R2L here
  // reverses the already-shaped glyph sequence in the generated/printed PDF.
  const printable = isArabic && typeof doc.processArabic === "function" ? doc.processArabic(raw) : raw;
  if (typeof doc.setR2L === "function") doc.setR2L(false);
  doc.text(printable, x, y, options);
};

export const buildProductLabelTemplateContent = (label = {}) => {
  const isBag = label.type === "bag";
  const size = String(label.size || "").trim();
  const color = String(label.color || "").trim();
  return {
    barcode: String(label.barcodeValue || ""),
    name: String(label.productName || ""),
    price: Number(label.price || 0),
    fieldLabel: isBag ? "COLOR" : "SIZE",
    fieldValue: isBag
      ? color
      : [size, color ? `COLOR: ${color}` : ""].filter(Boolean).join(" / "),
    article: String(label.articleCode || label.article_code || ""),
    imageUrl: String(label.imageUrl || label.image_url || ""),
    qr: false,
  };
};

const PT_TO_MM = 0.352778;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const formatPrice = (value) => {
  const price = Number(value || 0);
  return Number.isInteger(price) ? String(price) : price.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
};

const fitLines = (doc, text, maxWidth, maxLines) => {
  const lines = doc.splitTextToSize(String(text || "Product").trim() || "Product", maxWidth);
  if (lines.length <= maxLines) return lines;
  const visible = lines.slice(0, maxLines);
  let lastLine = String(visible[maxLines - 1] || "").trimEnd();
  while (lastLine && doc.getTextWidth(`${lastLine}...`) > maxWidth) lastLine = lastLine.slice(0, -1).trimEnd();
  visible[maxLines - 1] = `${lastLine || String(lines[maxLines - 1] || "").slice(0, 1)}...`;
  return visible;
};

export const buildProductLabelPdfLayout = (doc, content, widthMm, heightMm) => {
  const isBagLabel = content.fieldLabel === "COLOR";
  const bagScale = isBagLabel ? clamp(heightMm / 25, 1, 1.6) : 1;
  const marginX = isBagLabel ? 0.8 * bagScale : clamp(widthMm * 0.02, 1.25, 2.25);
  const contentWidth = widthMm - marginX * 2;
  const compact = heightMm <= 36 || widthMm <= 28;
  let nameFontSize = isBagLabel ? 9 * bagScale : compact ? 7 : clamp(widthMm * 0.19, 9, 10.4);
  const detailFontSize = isBagLabel ? 7.5 * bagScale : compact ? 5.7 : clamp(widthMm * 0.17, 7.5, 9);
  const priceFontSize = isBagLabel ? 9.5 * bagScale : compact ? 6.5 : clamp(widthMm * 0.245, 11, 13);
  const barcodeTextFontSize = isBagLabel ? 5.5 * bagScale : compact ? 5 : clamp(widthMm * 0.14, 5.5, 7);
  const articleFontSize = isBagLabel ? 5 * bagScale : compact ? 4.5 : 5.5;
  const detailLineHeight = detailFontSize * PT_TO_MM * 1.15;
  const priceLineHeight = priceFontSize * PT_TO_MM;
  const topY = isBagLabel ? 0.7 * bagScale : compact ? 3.1 : 3.8;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(nameFontSize);
  if (isBagLabel) {
    const minimumBagNameFontSize = 10;
    while (nameFontSize > minimumBagNameFontSize && doc.splitTextToSize(String(content.name || "Product"), contentWidth).length > 2) {
      nameFontSize -= 0.25;
      doc.setFontSize(nameFontSize);
    }
  }
  const nameLineHeight = nameFontSize * PT_TO_MM * 1.12;
  const nameLines = fitLines(doc, content.name, contentWidth, 2);
  const nameBaselines = nameLines.map((_, index) => topY + nameLineHeight * (index + 1));
  const nameBottom = nameBaselines[nameBaselines.length - 1] || topY;
  const priceY = nameBottom + priceLineHeight + (isBagLabel ? 0.06 * bagScale : compact ? 0.35 : 0.55);
  const fieldY = priceY + detailLineHeight + (isBagLabel ? 0.1 * bagScale : compact ? 0.45 : 1.35);
  const articleY = content.article
    ? fieldY + articleFontSize * PT_TO_MM * 1.05 + (isBagLabel ? 0 : 0.2)
    : null;
  const barcodeTextGap = isBagLabel ? 1.9 * bagScale : compact ? 2.3 : 2.8;
  const bottomMargin = isBagLabel ? 0.8 * bagScale : compact ? 1.6 : 2.2;
  const barcodeTextY = heightMm - bottomMargin;
  const barcodeBottom = barcodeTextY - barcodeTextGap;
  const minimumBarcodeTop = (articleY || fieldY) + (isBagLabel ? 0.3 * bagScale : 1.2);
  const desiredBarcodeHeight = isBagLabel
    ? 8.5 * bagScale
    : compact
    ? clamp(heightMm * 0.2, 5.5, 7)
    : clamp(heightMm * 0.25, 8, 10);
  const barcodeY = Math.max(minimumBarcodeTop, barcodeBottom - desiredBarcodeHeight);
  const barcodeHeight = Math.max(isBagLabel ? 3 * bagScale : 4.5, barcodeBottom - barcodeY);

  return {
    marginX, contentWidth, nameFontSize, detailFontSize, priceFontSize, barcodeTextFontSize, articleFontSize,
    nameLines,
    nameBaselines,
    priceY,
    priceBox: {
      y: priceY - priceFontSize * PT_TO_MM * 0.92,
      height: priceFontSize * PT_TO_MM * 1.25,
    },
    fieldY,
    articleY,
    barcodeY,
    barcodeHeight,
    barcodeTextY,
  };
};

const bars = (value, width) => {
  const codes = [Code128Reader.CODE_START_B, ...String(value).split("").map((c) => Math.max(0, Math.min(94, c.charCodeAt(0) - 32)))];
  codes.push(codes.reduce((sum, code, index) => sum + code * (index || 1), 0) % 103, Code128Reader.CODE_STOP);
  const modules = codes.flatMap((code) => Array.from(Code128Reader.CODE_PATTERNS[code] || []));
  const unit = (width - 4) / modules.reduce((a, b) => a + b, 0);
  let x = 2;
  return modules.map((n, i) => {
    const bar = { x, w: n * unit, black: i % 2 === 0 };
    x += n * unit;
    return bar;
  });
};

export async function generateProductLabelJobPdf(job) {
  if (!job?.labels?.length) throw new Error("Cannot generate an empty label job");
  const orientation = job.widthMm >= job.heightMm ? "landscape" : "portrait";
  const doc = new jsPDF({ orientation, unit: "mm", format: [job.widthMm, job.heightMm], compress: true });
  const requiresArabicFont = job.labels.some((label) => [label.productName, label.color, label.articleCode, label.article_code].some(hasArabic));
  if (requiresArabicFont) await registerArabicFont(doc);
  const layouts = [];

  for (let index = 0; index < job.labels.length; index += 1) {
    const label = job.labels[index];
    if (index) doc.addPage([job.widthMm, job.heightMm], orientation);
    const content = buildProductLabelTemplateContent(label);
    const widthMm = doc.internal.pageSize.getWidth();
    const heightMm = doc.internal.pageSize.getHeight();
    const layout = buildProductLabelPdfLayout(doc, content, widthMm, heightMm);
    layouts.push(layout);

    setLabelFont(doc, content.name);
    doc.setTextColor(15, 23, 42);
    doc.setFontSize(layout.nameFontSize);
    layout.nameLines.forEach((line, lineIndex) =>
      drawLabelText(doc, line, widthMm / 2, layout.nameBaselines[lineIndex], { align: "center" })
    );

    doc.setFont("helvetica", "bold");
    doc.setFontSize(layout.priceFontSize);
    const priceText = `${formatPrice(content.price)} EGP`;
    const priceBoxWidth = Math.min(layout.contentWidth, doc.getTextWidth(priceText) + 6);
    const priceBoxX = (widthMm - priceBoxWidth) / 2;
    doc.setFillColor(15, 23, 42);
    doc.roundedRect(priceBoxX, layout.priceBox.y, priceBoxWidth, layout.priceBox.height, 1.2, 1.2, "F");
    doc.setTextColor(255, 255, 255);
    doc.text(priceText, widthMm / 2, layout.priceY, { align: "center" });
    doc.setTextColor(15, 23, 42);
    const detailText = `${content.fieldLabel}: ${content.fieldValue || "-"}`;
    let fittedDetailFontSize = layout.detailFontSize;
    doc.setFontSize(fittedDetailFontSize);
    while (fittedDetailFontSize > 5.5 && doc.getTextWidth(detailText) > layout.contentWidth) {
      fittedDetailFontSize -= 0.25;
      doc.setFontSize(fittedDetailFontSize);
    }
    drawLabelText(doc, detailText, widthMm / 2, layout.fieldY, { align: "center" });
    if (content.article && layout.articleY) {
      doc.setFontSize(layout.articleFontSize);
      drawLabelText(doc, `ART: ${content.article}`, widthMm / 2, layout.articleY, { align: "center" });
    }

    doc.setFillColor(0, 0, 0);
    bars(content.barcode, layout.contentWidth)
      .filter((bar) => bar.black)
      .forEach((bar) => doc.rect(layout.marginX + bar.x, layout.barcodeY, bar.w, layout.barcodeHeight, "F"));

    doc.setFont("helvetica", "bold");
    doc.setFontSize(layout.barcodeTextFontSize);
    doc.text(content.barcode, widthMm / 2, layout.barcodeTextY, { align: "center" });
  }

  return {
    blob: doc.output("blob"),
    debug: {
      widthMm: doc.internal.pageSize.getWidth(),
      heightMm: doc.internal.pageSize.getHeight(),
      pages: doc.getNumberOfPages(),
      qr: false,
      layouts,
    },
  };
}
