import { createHmac, timingSafeEqual } from "node:crypto";
import { inflateSync } from "node:zlib";
import QRCode from "qrcode";
import { PDFDocument, PDFName, StandardFonts, rgb } from "pdf-lib";
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

// Bosta's label is READ, never guessed at. The page's own drawn rules give the notes box,
// and every glyph and path point on it counts as ink the QR may not cover — which is how a
// 15 mm QR fits inside the label at Bosta's exact page size instead of under it. Whatever
// cannot be read falls back to the strip below the label, which is what every print used to
// get: 96pt of extra paper on a 420pt label.
const STRIP_HEIGHT = 96;
const AWB_QR_PADDING = 3;
// 12 mm. A thermal print smaller than this stops scanning off a phone, so below it the strip
// is the honest answer — a QR nobody can scan is worse than a taller label.
const AWB_QR_MIN = 34;
// A barcode is hundreds of path points; the notes box has none. Landing on Bosta's tracking
// barcode would be far worse than printing the strip, so a busy cell is refused outright.
const AWB_CELL_MAX_STROKES = 20;

const IDENTITY = [1, 0, 0, 1, 0, 0];
const matMul = (a, b) => [
  a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3],
  a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3],
  a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5],
];
const matApply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const within = (box, point) => point[0] >= box.x0 && point[0] <= box.x1 && point[1] >= box.y0 && point[1] <= box.y1;

const pageContentStream = (page) => {
  const contents = page.node.Contents();
  if (!contents) return "";
  const entries = typeof contents.asArray === "function" ? contents.asArray() : [contents];
  let out = "";
  for (const entry of entries) {
    const stream = typeof entry?.getContents === "function" ? entry : page.node.context.lookup(entry);
    if (typeof stream?.getContents !== "function") continue;
    const bytes = Buffer.from(stream.getContents());
    const filter = String(stream.dict?.get?.(PDFName.of("Filter")) ?? "");
    try {
      out += `${(filter.includes("FlateDecode") ? inflateSync(bytes) : bytes).toString("latin1")}\n`;
    } catch {
      return "";
    }
  }
  return out;
};

const CONTENT_TOKEN = /\((?:\\.|[^\\()])*\)|<[0-9A-Fa-f\s]*>|\[|\]|[-+]?[\d.]+|\/[^\s/<>[\]()]+|[A-Za-z'"*]+/g;

// An axis-aligned rectangle, however it was drawn: Bosta's renderer emits `re`, pdf-lib walks
// the four corners, and a reader that only knows one of them reads half a label.
const asRectangle = (points) => {
  if (points.length < 4 || points.length > 5) return null;
  const xs = [...new Set(points.map((point) => Math.round(point[0] * 100) / 100))];
  const ys = [...new Set(points.map((point) => Math.round(point[1] * 100) / 100))];
  if (xs.length !== 2 || ys.length !== 2) return null;
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.abs(xs[1] - xs[0]), h: Math.abs(ys[1] - ys[0]) };
};

// Enough of a content-stream walk to put every mark on the page in page coordinates: the
// table rules as rectangles, and glyphs and path points as the ink that must stay visible.
// Bosta draws its barcodes as paths and its text glyph by glyph, so both are covered.
const readPageInk = (page) => {
  const content = pageContentStream(page);
  const tokens = content ? content.match(CONTENT_TOKEN) : null;
  if (!tokens) return null;
  let ctm = IDENTITY;
  let tm = IDENTITY;
  let tlm = IDENTITY;
  let leading = 0;
  const stack = [];
  let operands = [];
  const rects = [];
  const glyphs = [];
  const strokes = [];
  const subpaths = [];
  let clipping = false;
  const numbers = (count) => operands.filter((operand) => typeof operand === "number").slice(-count);
  const nextLine = () => { tlm = matMul([1, 0, 0, 1, 0, -leading], tlm); tm = [...tlm]; };
  for (const token of tokens) {
    if (/^[-+]?[\d.]+$/.test(token)) { operands.push(Number(token)); continue; }
    if (/^[([<\]/]/.test(token)) { operands.push(token); continue; }
    switch (token) {
      case "q": stack.push([...ctm]); break;
      case "Q": ctm = stack.pop() || ctm; break;
      case "cm": { const n = numbers(6); if (n.length === 6) ctm = matMul(n, ctm); break; }
      case "BT": tm = IDENTITY; tlm = IDENTITY; break;
      case "Tm": { const n = numbers(6); if (n.length === 6) { tm = n; tlm = [...n]; } break; }
      case "TL": { const n = numbers(1); if (n.length === 1) leading = n[0]; break; }
      case "TD": { const n = numbers(2); if (n.length === 2) { leading = -n[1]; tlm = matMul([1, 0, 0, 1, n[0], n[1]], tlm); tm = [...tlm]; } break; }
      case "Td": { const n = numbers(2); if (n.length === 2) { tlm = matMul([1, 0, 0, 1, n[0], n[1]], tlm); tm = [...tlm]; } break; }
      case "T*": nextLine(); break;
      case "'": case '"': nextLine(); glyphs.push(matApply(matMul(tm, ctm), 0, 0)); break;
      case "Tj": case "TJ": glyphs.push(matApply(matMul(tm, ctm), 0, 0)); break;
      case "re": {
        const n = numbers(4);
        if (n.length === 4) {
          subpaths.push([matApply(ctm, n[0], n[1]), matApply(ctm, n[0] + n[2], n[1]), matApply(ctm, n[0] + n[2], n[1] + n[3]), matApply(ctm, n[0], n[1] + n[3])]);
        }
        break;
      }
      case "m": { const n = numbers(2); if (n.length === 2) subpaths.push([matApply(ctm, n[0], n[1])]); break; }
      case "l": { const n = numbers(2); if (n.length === 2) subpaths[subpaths.length - 1]?.push(matApply(ctm, n[0], n[1])); break; }
      case "c": {
        const n = numbers(6);
        if (n.length === 6) subpaths[subpaths.length - 1]?.push(matApply(ctm, n[2], n[3]), matApply(ctm, n[4], n[5]));
        break;
      }
      case "h": break;
      // A path reaches the page here. Rules and boxes are the label's own frame and may be
      // drawn over; everything else is somebody's ink. Clipping paths (W n) mark nothing.
      case "W": clipping = true; break;
      case "n": case "f": case "F": case "f*": case "B": case "B*": case "b": case "b*": case "S": case "s": {
        if (!clipping && token !== "n") {
          for (const subpath of subpaths) {
            const rect = asRectangle(subpath);
            if (rect) rects.push(rect);
            else strokes.push(...subpath);
          }
        }
        subpaths.length = 0;
        clipping = false;
        break;
      }
      default: break;
    }
    operands = [];
  }
  return { rects, glyphs, strokes };
};

// The notes box: the wide half of the one divided row at the foot of the label. Everything is
// read off the label's own full-width rules, so a long package description that pushes the
// rows around does not move the QR onto something else.
const findNotesCell = (ink, box) => {
  const frame = ink.rects.filter((rect) => rect.h <= 2 && rect.w >= box.width * 0.8);
  if (frame.length < 2) return null;
  const left = Math.min(...frame.map((rect) => rect.x));
  const right = Math.max(...frame.map((rect) => rect.x + rect.w));
  const foot = box.y + box.height * 0.3;
  const rules = [...new Set(frame.map((rect) => Math.round(rect.y * 10) / 10))].sort((a, b) => a - b);
  for (let index = 0; index + 1 < rules.length; index += 1) {
    const bottom = rules[index];
    const top = rules[index + 1];
    if (top > foot) break;
    const dividers = ink.rects.filter((rect) =>
      rect.w <= 2 && rect.h >= (top - bottom) * 0.6 && rect.y >= bottom - 2 && rect.y + rect.h <= top + 2
    );
    if (dividers.length !== 1) continue;
    const divider = dividers[0].x;
    const wide = divider - left > right - divider
      ? { x0: left, x1: divider, y0: bottom, y1: top }
      : { x0: divider, x1: right, y0: bottom, y1: top };
    if (wide.x1 - wide.x0 < (right - left) * 0.5) continue;
    if (ink.strokes.filter((point) => within(wide, point)).length > AWB_CELL_MAX_STROKES) continue;
    return wide;
  }
  return null;
};

// The largest square in the box that touches nothing, taken from the LEFT: notes are written
// right to left, so the left end of the box is the last place a line of Arabic would reach —
// which is how a parcel that does carry notes keeps them readable.
const findQrSquare = (cell, ink) => {
  const marks = [...ink.glyphs, ...ink.strokes].filter((point) => within(cell, point));
  const largest = Math.min(cell.y1 - cell.y0, cell.x1 - cell.x0) - AWB_QR_PADDING * 2;
  for (let size = Math.floor(largest); size >= AWB_QR_MIN; size -= 2) {
    const y = cell.y0 + (cell.y1 - cell.y0 - size) / 2;
    for (let x = cell.x0 + AWB_QR_PADDING; x + size + AWB_QR_PADDING <= cell.x1; x += 1) {
      const area = { x0: x - AWB_QR_PADDING, x1: x + size + AWB_QR_PADDING, y0: y - AWB_QR_PADDING, y1: y + size + AWB_QR_PADDING };
      if (!marks.some((point) => within(area, point))) return { x, y, size };
    }
  }
  return null;
};

// Where this page can take the QR, or null when it cannot take one at all. Exported because
// it is the whole decision: everything below it just draws.
export const findPackingQrSpot = (page) => {
  try {
    const ink = readPageInk(page);
    if (!ink) return null;
    const cell = findNotesCell(ink, page.getMediaBox());
    return cell ? findQrSquare(cell, ink) : null;
  } catch {
    return null;
  }
};

// The old behaviour, kept for every label whose notes box cannot be read or is full: the page
// GROWS and the QR goes under it, so nothing of Bosta's is ever covered.
const drawQrStrip = (page, qr, label, font) => {
  const { x, y, width, height } = page.getMediaBox();
  page.setMediaBox(x, y - STRIP_HEIGHT, width, height + STRIP_HEIGHT);
  page.setCropBox(x, y - STRIP_HEIGHT, width, height + STRIP_HEIGHT);
  const size = STRIP_HEIGHT - 12;
  page.drawRectangle({ x, y: y - STRIP_HEIGHT, width, height: STRIP_HEIGHT, color: rgb(1, 1, 1) });
  page.drawLine({ start: { x: x + 6, y }, end: { x: x + width - 6, y }, thickness: 0.6, color: rgb(0.6, 0.6, 0.6), dashArray: [3, 3] });
  page.drawImage(qr, { x: x + 8, y: y - STRIP_HEIGHT + 6, width: size, height: size });
  page.drawText("SCAN: MODELS IN THIS PARCEL", { x: x + size + 18, y: y - 36, size: 10, font, color: rgb(0, 0, 0) });
  page.drawText(label, { x: x + size + 18, y: y - 56, size: 14, font, color: rgb(0, 0, 0) });
};

// Pages are matched to orders by position, and only when the counts agree: a QR on the wrong
// parcel would be worse than none.
export const stampPackingQrOnAirwayBill = async (pdfBase64 = "", printed = []) => {
  if (!pdfBase64 || !Array.isArray(printed) || !printed.length) return { pdf_base64: pdfBase64, stamped: false, reason: "nothing_to_stamp" };
  const pdf = await PDFDocument.load(Buffer.from(pdfBase64, "base64"));
  const pages = pdf.getPages();
  if (pages.length !== printed.length) return { pdf_base64: pdfBase64, stamped: false, reason: "page_count_mismatch", pages: pages.length, orders: printed.length };
  const urls = printed.map((row) => packingPageUrl(row.order_id));
  if (urls.some((url) => !url)) return { pdf_base64: pdfBase64, stamped: false, reason: "no_public_backend_url" };

  // One print, one page size. A job fed two page heights is a job the printer either scales
  // or jams, so the whole batch goes inside the labels or the whole batch gets the strip.
  const spots = pages.map((page) => findPackingQrSpot(page));
  const inNotesBox = spots.every(Boolean);
  const font = inNotesBox ? null : await pdf.embedFont(StandardFonts.HelveticaBold);

  for (let index = 0; index < pages.length; index += 1) {
    const page = pages[index];
    const png = await QRCode.toBuffer(urls[index], { type: "png", errorCorrectionLevel: "M", margin: 1, width: 600 });
    const qr = await pdf.embedPng(png);
    if (inNotesBox) {
      const spot = spots[index];
      // White under the QR: the notes box has a frame line through it, and a QR printed over
      // a rule is a QR with a line through its modules.
      page.drawRectangle({ x: spot.x - 1.5, y: spot.y - 1.5, width: spot.size + 3, height: spot.size + 3, color: rgb(1, 1, 1) });
      page.drawImage(qr, { x: spot.x, y: spot.y, width: spot.size, height: spot.size });
      continue;
    }
    // The embedded standard font has no Arabic glyphs; an order number is ASCII in practice.
    const label = text(printed[index].order_number || printed[index].order_id).replace(/[^\x20-\x7E]/g, "").trim() || `#${printed[index].order_id}`;
    drawQrStrip(page, qr, label, font);
  }
  const bytes = await pdf.save();
  return {
    pdf_base64: Buffer.from(bytes).toString("base64"),
    stamped: true,
    placement: inNotesBox ? "notes_box" : "strip",
    qr_size: inNotesBox ? Math.round(spots[0].size) : STRIP_HEIGHT - 12,
  };
};
