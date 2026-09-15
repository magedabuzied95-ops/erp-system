import { createHmac, timingSafeEqual } from "node:crypto";
import QRCode from "qrcode";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { getSetting } from "../../services/settingsService.js";
import { absolutePublicUploadUrl, getPublicBackendUrl } from "../../utils/publicUrl.js";

// What is in the parcel, readable without opening the invoice (owner request 2026-09-15):
//  1. the Bosta package description lists every piece with colour, size and article code;
//  2. an airway bill printed from the ERP carries a QR that opens a page of the parcel's
//     models — photo, colour, size, article, quantity. No prices and no customer data: the
//     page is for whoever packs or checks the parcel, so it is open to anyone with the QR.
// Both sit behind orders.bosta_awb_packing_details, so switching it off restores the old
// name-only description and the plain Bosta label without a deploy.

const text = (value = "") => String(value ?? "").trim();

export const packingDetailsEnabled = async () => {
  const value = await getSetting("orders.bosta_awb_packing_details", true).catch(() => true);
  return !(value === false || ["false", "0", "off", "no"].includes(String(value).trim().toLowerCase()));
};

/* ------------------------------------------------------------ description */

const DESCRIPTION_MAX = 400;

export const describePackingItem = (item = {}) => {
  const name = text(item.product_name || item.name) || "منتج";
  const parts = [
    name,
    text(item.color),
    text(item.size) ? `مقاس ${text(item.size)}` : "",
    text(item.article_code),
  ].filter(Boolean);
  const quantity = Math.max(1, Number(item.quantity) || 1);
  return `${parts.join(" - ")} (x${quantity})`;
};

// Every piece, until Bosta's field would get long; the rest are counted, never silently dropped.
export const buildPackingDescription = (items = [], fallback = "") => {
  const lines = (Array.isArray(items) ? items : []).map(describePackingItem);
  if (!lines.length) return fallback;
  const shown = [];
  for (const line of lines) {
    const next = [...shown, line].join(" + ");
    if (shown.length && next.length > DESCRIPTION_MAX) break;
    shown.push(line);
  }
  const hidden = lines.length - shown.length;
  const description = shown.join(" + ") + (hidden > 0 ? ` + ${hidden} قطع تانية` : "");
  return description.slice(0, DESCRIPTION_MAX + 40);
};

/* ------------------------------------------------------------------ token */

const packingSecret = () =>
  text(process.env.PACKING_LINK_SECRET || process.env.JWT_SECRET || process.env.APP_SECRET || process.env.SESSION_SECRET) || "packing-local-secret";

const signature = (orderId) => createHmac("sha256", packingSecret()).update(`packing:${orderId}`).digest("base64url").slice(0, 22);

export const packingToken = (orderId) => `${Number(orderId)}.${signature(Number(orderId))}`;

export const verifyPackingToken = (token = "") => {
  const [rawId, sig = ""] = text(token).split(".");
  const orderId = Number(rawId);
  if (!Number.isInteger(orderId) || orderId <= 0 || !sig) return null;
  const expected = Buffer.from(signature(orderId));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  return orderId;
};

export const packingPageUrl = (orderId) => {
  const origin = getPublicBackendUrl();
  return origin ? `${origin}/api/public/packing/${packingToken(orderId)}` : "";
};

/* ------------------------------------------------------------------- page */

const escapeHtml = (value = "") => text(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));

export const renderPackingPage = ({ orderNumber = "", items = [] } = {}) => {
  const pieces = items.reduce((sum, item) => sum + Math.max(1, Number(item.quantity) || 1), 0);
  const cards = items.map((item) => {
    const image = absolutePublicUploadUrl(item.image_url);
    const chips = [
      text(item.color) && `<span class="chip">${escapeHtml(item.color)}</span>`,
      text(item.size) && `<span class="chip">مقاس <b dir="ltr">${escapeHtml(item.size)}</b></span>`,
      text(item.article_code) && `<span class="chip">أرتكل <b dir="ltr">${escapeHtml(item.article_code)}</b></span>`,
      `<span class="chip qty">× ${Math.max(1, Number(item.quantity) || 1)}</span>`,
    ].filter(Boolean).join("");
    return `<article class="card">
      ${image ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(item.product_name)}" loading="lazy">` : `<div class="noimg">بدون صورة</div>`}
      <div class="body"><h2>${escapeHtml(item.product_name) || "منتج"}</h2><div class="chips">${chips}</div></div>
    </article>`;
  }).join("");
  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>محتوى الشحنة ${escapeHtml(orderNumber)}</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; font-family: system-ui, -apple-system, "Segoe UI", Tahoma, sans-serif; background: #f4f2ee; color: #1b1b1b; }
  header { position: sticky; top: 0; background: #111; color: #fff; padding: 14px 16px; }
  header h1 { margin: 0; font-size: 18px; }
  header p { margin: 4px 0 0; font-size: 13px; opacity: .8; }
  main { padding: 12px 16px 32px; display: grid; gap: 12px; max-width: 720px; margin: 0 auto; }
  .card { background: #fff; border-radius: 16px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
  .card img, .noimg { width: 100%; aspect-ratio: 1 / 1; object-fit: contain; background: #fafafa; display: block; }
  .noimg { display: grid; place-items: center; color: #888; font-size: 14px; }
  .body { padding: 12px 14px 14px; }
  .body h2 { margin: 0 0 10px; font-size: 17px; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .chip { background: #f1ede4; border-radius: 999px; padding: 6px 12px; font-size: 15px; }
  .chip.qty { background: #111; color: #fff; font-weight: 700; }
</style>
</head>
<body>
<header><h1>محتوى الشحنة <span dir="ltr">${escapeHtml(orderNumber)}</span></h1><p>${pieces} قطعة · ${items.length} موديل</p></header>
<main>${cards || "<p>مفيش منتجات على الأوردر ده.</p>"}</main>
</body>
</html>`;
};

/* -------------------------------------------------------------- QR on AWB */

const STRIP_HEIGHT = 96;

// The strip is ADDED under Bosta's label (the page grows), so nothing of theirs is covered.
// Pages are matched to orders by position, and only when the counts agree: a QR on the
// wrong parcel would be worse than none.
export const stampPackingQrOnAirwayBill = async (pdfBase64 = "", printed = []) => {
  if (!pdfBase64 || !Array.isArray(printed) || !printed.length) return { pdf_base64: pdfBase64, stamped: false, reason: "nothing_to_stamp" };
  const pdf = await PDFDocument.load(Buffer.from(pdfBase64, "base64"));
  const pages = pdf.getPages();
  if (pages.length !== printed.length) return { pdf_base64: pdfBase64, stamped: false, reason: "page_count_mismatch", pages: pages.length, orders: printed.length };
  const font = await pdf.embedFont(StandardFonts.HelveticaBold);
  for (let index = 0; index < pages.length; index += 1) {
    const url = packingPageUrl(printed[index].order_id);
    if (!url) return { pdf_base64: pdfBase64, stamped: false, reason: "no_public_backend_url" };
    const page = pages[index];
    const { x, y, width, height } = page.getMediaBox();
    page.setMediaBox(x, y - STRIP_HEIGHT, width, height + STRIP_HEIGHT);
    page.setCropBox(x, y - STRIP_HEIGHT, width, height + STRIP_HEIGHT);
    const png = await QRCode.toBuffer(url, { type: "png", errorCorrectionLevel: "M", margin: 1, width: 360 });
    const qr = await pdf.embedPng(png);
    const size = STRIP_HEIGHT - 12;
    page.drawRectangle({ x, y: y - STRIP_HEIGHT, width, height: STRIP_HEIGHT, color: rgb(1, 1, 1) });
    page.drawLine({ start: { x: x + 6, y }, end: { x: x + width - 6, y }, thickness: 0.6, color: rgb(0.6, 0.6, 0.6), dashArray: [3, 3] });
    page.drawImage(qr, { x: x + 8, y: y - STRIP_HEIGHT + 6, width: size, height: size });
    // The embedded standard font has no Arabic glyphs; an order number is ASCII in practice.
    const label = text(printed[index].order_number || printed[index].order_id).replace(/[^\x20-\x7E]/g, "").trim() || `#${printed[index].order_id}`;
    page.drawText("SCAN: MODELS IN THIS PARCEL", { x: x + size + 18, y: y - 36, size: 10, font, color: rgb(0, 0, 0) });
    page.drawText(label, { x: x + size + 18, y: y - 56, size: 14, font, color: rgb(0, 0, 0) });
  }
  const bytes = await pdf.save();
  return { pdf_base64: Buffer.from(bytes).toString("base64"), stamped: true };
};
