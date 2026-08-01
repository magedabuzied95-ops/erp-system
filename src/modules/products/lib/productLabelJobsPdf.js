import { jsPDF } from "jspdf";
import Code128Reader from "@zxing/library/esm/core/oned/Code128Reader";

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

export async function generateProductLabelJobPdf(job) {
  if (!job?.labels?.length) throw new Error("Cannot generate an empty label job");
  const orientation = job.widthMm >= job.heightMm ? "landscape" : "portrait";
  const doc = new jsPDF({ orientation, unit: "mm", format: [job.widthMm, job.heightMm], compress: true });
  const layouts = [];

  for (let index = 0; index < job.labels.length; index += 1) {
    const label = job.labels[index];
    if (index) doc.addPage([job.widthMm, job.heightMm], orientation);
    const content = buildProductLabelTemplateContent(label);
    const pageWidthMm = doc.internal.pageSize.getWidth();
    const pageHeightMm = doc.internal.pageSize.getHeight();
    const rotateContent90 = Boolean(job.rotateContent90);
    const widthMm = rotateContent90 ? Number(job.layoutWidthMm || pageHeightMm) : pageWidthMm;
    const heightMm = rotateContent90 ? Number(job.layoutHeightMm || pageWidthMm) : pageHeightMm;
    const layout = buildProductLabelPdfLayout(doc, content, widthMm, heightMm);
    const point = (x, y) => rotateContent90 ? { x: pageWidthMm - y, y: x } : { x, y };
    const rectangle = (x, y, width, height) => rotateContent90
      ? { x: pageWidthMm - y - height, y: x, width: height, height: width }
      : { x, y, width, height };
    const drawCenteredText = (value, centerX, y) => {
      if (!rotateContent90) {
        doc.text(value, centerX, y, { align: "center" });
        return;
      }
      const logicalLeft = centerX - doc.getTextWidth(value) / 2;
      const position = point(logicalLeft, y);
      doc.text(value, position.x, position.y, { angle: 90, rotationDirection: 0 });
    };
    layouts.push(layout);

    doc.setFont("helvetica", "bold");
    doc.setTextColor(15, 23, 42);
    doc.setFontSize(layout.nameFontSize);
    layout.nameLines.forEach((line, lineIndex) => drawCenteredText(line, widthMm / 2, layout.nameBaselines[lineIndex]));

    doc.setFont("helvetica", "bold");
    doc.setFontSize(layout.priceFontSize);
    const priceText = `${formatPrice(content.price)} EGP`;
    const priceBoxWidth = Math.min(layout.contentWidth, doc.getTextWidth(priceText) + 6);
    const priceBoxX = (widthMm - priceBoxWidth) / 2;
    doc.setFillColor(15, 23, 42);
    const priceBox = rectangle(priceBoxX, layout.priceBox.y, priceBoxWidth, layout.priceBox.height);
    doc.roundedRect(priceBox.x, priceBox.y, priceBox.width, priceBox.height, 1.2, 1.2, "F");
    doc.setTextColor(255, 255, 255);
    drawCenteredText(priceText, widthMm / 2, layout.priceY);
    doc.setTextColor(15, 23, 42);
    const detailText = `${content.fieldLabel}: ${content.fieldValue || "-"}`;
    let fittedDetailFontSize = layout.detailFontSize;
    doc.setFontSize(fittedDetailFontSize);
    while (fittedDetailFontSize > 5.5 && doc.getTextWidth(detailText) > layout.contentWidth) {
      fittedDetailFontSize -= 0.25;
      doc.setFontSize(fittedDetailFontSize);
    }
    drawCenteredText(detailText, widthMm / 2, layout.fieldY);
    if (content.article && layout.articleY) {
      doc.setFontSize(layout.articleFontSize);
      drawCenteredText(`ART: ${content.article}`, widthMm / 2, layout.articleY);
    }

    doc.setFillColor(0, 0, 0);
    bars(content.barcode, layout.contentWidth)
      .filter((bar) => bar.black)
      .forEach((bar) => {
        const barcodeBar = rectangle(layout.marginX + bar.x, layout.barcodeY, bar.w, layout.barcodeHeight);
        doc.rect(barcodeBar.x, barcodeBar.y, barcodeBar.width, barcodeBar.height, "F");
      });

    doc.setFont("helvetica", "bold");
    doc.setFontSize(layout.barcodeTextFontSize);
    drawCenteredText(content.barcode, widthMm / 2, layout.barcodeTextY);
  }

  return {
    blob: doc.output("blob"),
    debug: {
      widthMm: doc.internal.pageSize.getWidth(),
      heightMm: doc.internal.pageSize.getHeight(),
      layoutWidthMm: Number(job.layoutWidthMm || doc.internal.pageSize.getWidth()),
      layoutHeightMm: Number(job.layoutHeightMm || doc.internal.pageSize.getHeight()),
      rotateContent90: Boolean(job.rotateContent90),
      pages: doc.getNumberOfPages(),
      qr: false,
      layouts,
    },
  };
}
