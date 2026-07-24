import { jsPDF } from "jspdf";
import Code128Reader from "@zxing/library/esm/core/oned/Code128Reader";

export const buildProductLabelTemplateContent = (label = {}) => ({
  barcode: String(label.barcodeValue || ""),
  name: String(label.productName || ""),
  price: Number(label.price || 0),
  fieldLabel: label.type === "bag" ? "اللون" : "المقاس",
  fieldValue: label.type === "bag" ? String(label.color || "") : String(label.size || ""),
  qr: false,
});

const bars = (value, width) => {
  const codes = [Code128Reader.CODE_START_B, ...String(value).split("").map((c) => Math.max(0, Math.min(94, c.charCodeAt(0) - 32)))];
  codes.push(codes.reduce((sum, code, index) => sum + code * (index || 1), 0) % 103, Code128Reader.CODE_STOP);
  const modules = codes.flatMap((code) => Array.from(Code128Reader.CODE_PATTERNS[code] || []));
  const unit = (width - 4) / modules.reduce((a, b) => a + b, 0);
  let x = 2;
  return modules.map((n, i) => { const bar = { x, w: n * unit, black: i % 2 === 0 }; x += n * unit; return bar; });
};

export async function generateProductLabelJobPdf(job) {
  if (!job?.labels?.length) throw new Error("Cannot generate an empty label job");
  const doc = new jsPDF({ orientation: job.widthMm >= job.heightMm ? "landscape" : "portrait", unit: "mm", format: [job.widthMm, job.heightMm], compress: true });
  job.labels.forEach((label, index) => {
    if (index) doc.addPage([job.widthMm, job.heightMm], job.widthMm >= job.heightMm ? "landscape" : "portrait");
    const c = buildProductLabelTemplateContent(label);
    const w = doc.internal.pageSize.getWidth();
    const h = doc.internal.pageSize.getHeight();
    doc.setFont("helvetica", "bold"); doc.setTextColor(15, 23, 42);
    doc.setFontSize(Math.max(7, Math.min(13, h / 4))); doc.text(c.name || "Product", w / 2, 6, { align: "center", maxWidth: w - 6 });
    doc.setFontSize(Math.max(6, Math.min(10, h / 5))); doc.text(`${c.price.toFixed(2)} EGP`, w / 2, 12, { align: "center" });
    doc.text(`${c.fieldLabel}: ${c.fieldValue || "-"}`, w / 2, 17, { align: "center" });
    const barcodeY = Math.max(19, h * 0.44), barcodeH = Math.max(6, h * 0.28);
    doc.setFillColor(0, 0, 0); bars(c.barcode, w - 6).filter((b) => b.black).forEach((b) => doc.rect(3 + b.x, barcodeY, b.w, barcodeH, "F"));
    doc.setFontSize(Math.max(5, Math.min(8, h / 7))); doc.text(c.barcode, w / 2, Math.min(h - 2, barcodeY + barcodeH + 4), { align: "center" });
  });
  return { blob: doc.output("blob"), debug: { widthMm: doc.internal.pageSize.getWidth(), heightMm: doc.internal.pageSize.getHeight(), pages: doc.getNumberOfPages(), qr: false } };
}
