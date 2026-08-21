// Draws one invoice block as an HTML string, for the print path.
//
// The React renderer and this one read the same block model and the same resolvers, so
// a paragraph the operator adds lands in the same place on the customer's screen and on
// the printed sheet. What differs is only the markup each medium can carry.

import QRCode from "qrcode";

import {
  localizedBlockText,
  qrSvgMarkup,
  resolveBarcodeValue,
  resolveFieldRowValue,
  resolveQrValue,
} from "../../../shared/invoiceBlocks.js";

const ALIGN_CSS = { start: "start", center: "center", end: "end" };
const SIZE_CSS = { sm: "10px", md: "12px", lg: "15px" };

const escapeHtml = (value = "") =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

// The barcode generator is a large module and the print builder is synchronous, so the
// caller hands it in when a sheet actually needs one. Without it the block is skipped
// rather than printing a broken placeholder.
export const renderInvoiceBlockHtml = (block = {}, { invoice = {}, language = "ar", money = (v) => String(v ?? ""), formatDate = (v) => String(v ?? ""), barcodeSvg = null } = {}) => {
  const align = ALIGN_CSS[block.align] || "start";

  switch (block.type) {
    case "text": {
      const content = localizedBlockText(block.content, language);
      if (!content) return "";
      const style = [
        `text-align:${align}`,
        `font-size:${SIZE_CSS[block.size] || SIZE_CSS.md}`,
        `font-weight:${block.bold ? 800 : 600}`,
        "line-height:1.6",
        "white-space:pre-wrap",
        "margin:6px 0",
        block.boxed ? "border:1px solid #e2e8f0;border-radius:10px;padding:8px" : "",
      ].filter(Boolean).join(";");
      return `<div style="${style}">${escapeHtml(content)}</div>`;
    }

    case "image": {
      if (!block.url) return "";
      return `<div style="text-align:${align};margin:6px 0"><img src="${escapeHtml(block.url)}" alt="" style="width:${Number(block.width_pct) || 100}%;max-width:100%;height:auto" /></div>`;
    }

    case "qr": {
      const svg = qrSvgMarkup(resolveQrValue(block, invoice), { size: Number(block.size_px) || 120 }, QRCode.create);
      if (!svg) return "";
      const caption = localizedBlockText(block.caption, language);
      return `<div style="text-align:${align};margin:8px 0">${svg}${caption ? `<div class="muted" style="margin-top:4px;font-size:10px">${escapeHtml(caption)}</div>` : ""}</div>`;
    }

    case "barcode": {
      const value = resolveBarcodeValue(block, invoice);
      if (!value || typeof barcodeSvg !== "function") return "";
      const svg = barcodeSvg(value) || "";
      return svg ? `<div style="text-align:${align};margin:8px 0">${svg}</div>` : "";
    }

    case "field_row": {
      const label = localizedBlockText(block.label, language);
      const value = resolveFieldRowValue(block, invoice, { money, formatDate });
      if (!label && !value) return "";
      return `<div style="display:flex;justify-content:space-between;gap:12px;margin:4px 0;font-size:12px"><span class="muted">${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
    }

    case "divider":
      return `<div style="height:1px;background:#e2e8f0;margin:8px 0"></div>`;

    case "spacer":
      return `<div style="height:${Number(block.height_px) || 16}px"></div>`;

    default:
      return "";
  }
};
