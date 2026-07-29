import { jsPDF } from "jspdf";
import Code128Reader from "@zxing/library/esm/core/oned/Code128Reader";
import { resolveProductImageUrl } from "../../../shared/lib/imageUrls.js";

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
  const marginX = clamp(widthMm * 0.02, 1.25, 2.25);
  const contentWidth = widthMm - marginX * 2;
  const compact = heightMm <= 36 || widthMm <= 28;
  const nameFontSize = compact ? 7 : clamp(widthMm * 0.19, 9, 10.4);
  const detailFontSize = compact ? 5.7 : clamp(widthMm * 0.17, 7.5, 9);
  const priceFontSize = compact ? 6.5 : clamp(widthMm * 0.245, 11, 13);
  const barcodeTextFontSize = compact ? 5 : clamp(widthMm * 0.14, 5.5, 7);
  const articleFontSize = compact ? 4.5 : 5.5;
  const nameLineHeight = nameFontSize * PT_TO_MM * 1.12;
  const detailLineHeight = detailFontSize * PT_TO_MM * 1.15;
  const priceLineHeight = priceFontSize * PT_TO_MM;
  const topY = compact ? 3.1 : 3.8;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(nameFontSize);
  const nameLines = fitLines(doc, content.name, contentWidth, 2);
  const nameBaselines = nameLines.map((_, index) => topY + nameLineHeight * (index + 1));
  const nameBottom = nameBaselines[nameBaselines.length - 1] || topY;
  const priceY = nameBottom + priceLineHeight + (compact ? 0.35 : 0.55);
  const fieldY = priceY + detailLineHeight + (compact ? 0.45 : 1.35);
  const articleY = content.article
    ? fieldY + articleFontSize * PT_TO_MM * 1.05 + 0.2
    : null;
  const barcodeTextGap = compact ? 2.3 : 2.8;
  const bottomMargin = compact ? 1.6 : 2.2;
  const barcodeTextY = heightMm - bottomMargin;
  const barcodeBottom = barcodeTextY - barcodeTextGap;
  const minimumBarcodeTop = (articleY || fieldY) + 1.2;
  const desiredBarcodeHeight = compact
    ? clamp(heightMm * 0.2, 5.5, 7)
    : clamp(heightMm * 0.25, 8, 10);
  const barcodeY = Math.max(minimumBarcodeTop, barcodeBottom - desiredBarcodeHeight);
  const barcodeHeight = Math.max(4.5, barcodeBottom - barcodeY);

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

const loadImageDataUrl = async (source) => {
  const url = resolveProductImageUrl(source);
  if (!url) return "";
  if (url.startsWith("data:")) return url;
  try {
    const response = await fetch(url, { mode: "cors", credentials: "omit" });
    if (!response.ok) return "";
    const blob = await response.blob();
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => resolve("");
      reader.readAsDataURL(blob);
    });
  } catch {
    return "";
  }
};

const drawBarcode = (doc, value, { x, y, width, height, textY, fontSize = 6 }) => {
  doc.setFillColor(0, 0, 0);
  bars(value, width)
    .filter((bar) => bar.black)
    .forEach((bar) => doc.rect(x + bar.x, y, bar.w, height, "F"));
  doc.setFont("helvetica", "bold");
  doc.setFontSize(fontSize);
  doc.setTextColor(15, 23, 42);
  doc.text(value, x + width / 2, textY, { align: "center" });
};

const drawShoeBoxLabel = async (doc, content, widthMm, heightMm) => {
  const imageData = await loadImageDataUrl(content.imageUrl);
  const imageCell = { x: 2.2, y: 2.2, w: 38, h: 32.5 };
  const detailX = 42.3;
  const detailWidth = widthMm - detailX - 2.2;

  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.25);
  doc.rect(0.4, 0.4, widthMm - 0.8, heightMm - 0.8);
  doc.setFillColor(248, 250, 252);
  doc.rect(imageCell.x, imageCell.y, imageCell.w, imageCell.h, "F");
  if (imageData) {
    try {
      doc.addImage(imageData, imageCell.x, imageCell.y, imageCell.w, imageCell.h, undefined, "FAST");
    } catch {
      // Keep the neutral image cell if a browser cannot decode the source image.
    }
  }

  doc.setFillColor(2, 6, 23);
  doc.roundedRect(detailX, 2.2, detailWidth, 10.2, 1.5, 1.5, "F");
  doc.setFont("helvetica", "bold");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(9);
  const titleLines = fitLines(doc, content.name, detailWidth - 3, 2);
  const titleStart = titleLines.length > 1 ? 6 : 7.8;
  titleLines.forEach((line, index) => doc.text(line, detailX + detailWidth / 2, titleStart + index * 3.5, { align: "center" }));

  doc.setFillColor(2, 6, 23);
  doc.roundedRect(detailX, 14, 17.5, 7.2, 1.4, 1.4, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(7);
  doc.text(`SIZE  ${content.fieldValue.split("/")[0].trim() || "-"}`, detailX + 8.75, 18.7, { align: "center" });

  doc.roundedRect(detailX + 19, 14, detailWidth - 19, 7.2, 1.4, 1.4, "F");
  doc.setFontSize(6.3);
  const colorText = content.fieldValue.split("COLOR:")[1]?.trim() || "-";
  doc.text(`COLOR  ${colorText}`, detailX + 19 + (detailWidth - 19) / 2, 18.7, { align: "center", maxWidth: detailWidth - 22 });

  if (content.article) {
    doc.setTextColor(15, 23, 42);
    doc.setFontSize(6.2);
    doc.text(`ART: ${content.article}`, detailX + detailWidth / 2, 25.1, { align: "center", maxWidth: detailWidth - 2 });
  }

  drawBarcode(doc, content.barcode, {
    x: 2.2,
    y: 37,
    width: widthMm - 4.4,
    height: 8,
    textY: 48.1,
    fontSize: 6,
  });
};

export async function generateProductLabelJobPdf(job) {
  if (!job?.labels?.length) throw new Error("Cannot generate an empty label job");
  const orientation = job.widthMm >= job.heightMm ? "landscape" : "portrait";
  const doc = new jsPDF({ orientation, unit: "mm", format: [job.widthMm, job.heightMm], compress: true });
  const layouts = [];

  for (let index = 0; index < job.labels.length; index += 1) {
    const label = job.labels[index];
    if (index) doc.addPage([job.widthMm, job.heightMm], orientation);
    const content = buildProductLabelTemplateContent(label);
    const widthMm = doc.internal.pageSize.getWidth();
    const heightMm = doc.internal.pageSize.getHeight();
    if (job.key === "box") {
      await drawShoeBoxLabel(doc, content, widthMm, heightMm);
      layouts.push({ template: "shoe-box-image", widthMm, heightMm });
      continue;
    }
    const layout = buildProductLabelPdfLayout(doc, content, widthMm, heightMm);
    layouts.push(layout);

    doc.setFont("helvetica", "bold");
    doc.setTextColor(15, 23, 42);
    doc.setFontSize(layout.nameFontSize);
    layout.nameLines.forEach((line, lineIndex) =>
      doc.text(line, widthMm / 2, layout.nameBaselines[lineIndex], { align: "center" })
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
    doc.text(detailText, widthMm / 2, layout.fieldY, { align: "center" });
    if (content.article && layout.articleY) {
      doc.setFontSize(layout.articleFontSize);
      doc.text(`ART: ${content.article}`, widthMm / 2, layout.articleY, { align: "center" });
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
