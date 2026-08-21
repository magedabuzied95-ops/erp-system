// The invoice as an ordered list of blocks, instead of a layout written into four files.
// ------------------------------------------------------------------------------------
// A template's `blocks` array IS the document: the order you see is the order it prints,
// and anything the operator adds — a paragraph, a stamp, a QR, a custom row — is just
// another entry in that array. Renderers stop deciding what comes after what; they only
// know how to draw one block on their own medium.
//
// Two rules keep this honest:
//
//   1. Position on a printed invoice means ORDER, not coordinates. The sheet grows with
//      the item count, so a block pinned to an absolute spot would collide with the
//      table on a large order. Blocks stack; each one chooses its alignment and width.
//   2. The default list reproduces today's invoice exactly. A template that has never
//      been touched must print what it printed before any of this existed.
//
// Outputs are named after the surface, because the same document is not shown the same
// way in all of them — the in-app preview has never carried the return policy, and the
// customer's public link always has.

export const INVOICE_BLOCK_SCHEMA_VERSION = 1;

export const INVOICE_BLOCK_OUTPUTS = ["card", "public", "print", "thermal"];

// Built-in blocks are drawn by each renderer's own existing code, so turning the layout
// into data changed no pixels. Custom blocks are drawn by the shared block renderers.
export const BUILT_IN_BLOCK_TYPES = [
  // The header draws the logo, the store name, the invoice number and the date as one
  // unit — on A4 they sit side by side — so it moves as one. Listing them separately
  // would put a row in the editor that cannot actually go anywhere.
  "brand",
  "customer_meta",
  "items_table",
  "totals",
  "policy",
  "social",
  "store_contact",
];

export const CUSTOM_BLOCK_TYPES = ["text", "image", "qr", "barcode", "field_row", "divider", "spacer"];

export const INVOICE_BLOCK_TYPES = [...BUILT_IN_BLOCK_TYPES, ...CUSTOM_BLOCK_TYPES];

export const BLOCK_ALIGNMENTS = ["start", "center", "end"];
export const BLOCK_TEXT_SIZES = ["sm", "md", "lg"];

// Order-derived values a custom row can show without the operator typing anything.
export const FIELD_ROW_SOURCES = [
  "custom",
  "invoice_number",
  "order_date",
  "customer_name",
  "customer_phone",
  "customer_address",
  "payment_method",
  "order_status",
  "seller_name",
  "subtotal",
  "discount",
  "shipping",
  "grand_total",
  "paid",
  "remaining",
];

export const QR_SOURCES = ["public_url", "custom"];
export const BARCODE_SOURCES = ["invoice_number", "custom"];

const builtIn = (type, hiddenIn = []) => ({ id: `builtin:${type}`, type, hidden_in: hiddenIn });

// Transcribed from what each surface renders today:
//   - the in-app card and the storefront confirmation show the invoice only
//   - the customer's public link adds the policy, the review buttons and the footer
//   - the A4 sheet carries all of them
export const DEFAULT_INVOICE_BLOCKS = Object.freeze([
  builtIn("brand"),
  builtIn("customer_meta"),
  builtIn("items_table"),
  builtIn("totals"),
  builtIn("policy", ["card"]),
  builtIn("social", ["card"]),
  builtIn("store_contact", ["card"]),
]);

const clampNumber = (value, fallback, min, max) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
};

const coerceBoolean = (value, fallback) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  if (typeof value === "string") return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
  return fallback;
};

const toText = (value, maxLength = 2000) => String(value ?? "").slice(0, maxLength);

const oneOf = (value, allowed, fallback) => (allowed.includes(String(value || "")) ? String(value) : fallback);

// A block can carry a link or an image the customer's browser will fetch, so anything
// that is not http(s) is dropped rather than stored.
const toPublicUrl = (value) => {
  const text = String(value ?? "").trim();
  if (!text) return "";
  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    return "";
  }
  return ["http:", "https:"].includes(parsed.protocol) ? parsed.toString() : "";
};

const localized = (value) => {
  const source = value && typeof value === "object" ? value : {};
  return { ar: toText(source.ar), en: toText(source.en) };
};

let idCounter = 0;
const nextId = (type) => {
  idCounter += 1;
  return `${type}:${Date.now().toString(36)}${idCounter.toString(36)}`;
};

export const createInvoiceBlock = (type) => {
  const base = { id: nextId(type), type, hidden_in: [], align: "start" };
  switch (type) {
    case "text":
      return { ...base, content: { ar: "", en: "" }, size: "md", bold: false, boxed: false };
    case "image":
      return { ...base, url: "", width_pct: 100, align: "center" };
    case "qr":
      return { ...base, source: "public_url", value: "", size_px: 120, align: "center", caption: { ar: "", en: "" } };
    case "barcode":
      return { ...base, source: "invoice_number", value: "", align: "center" };
    case "field_row":
      return { ...base, label: { ar: "", en: "" }, source: "custom", value: "" };
    case "spacer":
      return { ...base, height_px: 16 };
    default:
      return base;
  }
};

const normalizeBlock = (raw = {}) => {
  const type = String(raw.type || "");
  if (!INVOICE_BLOCK_TYPES.includes(type)) return null;

  const hiddenIn = Array.isArray(raw.hidden_in)
    ? [...new Set(raw.hidden_in.map(String).filter((output) => INVOICE_BLOCK_OUTPUTS.includes(output)))]
    : [];
  const base = {
    // A built-in keeps its stable id so reordering never orphans it; a custom block that
    // arrives without one gets a fresh id rather than colliding with its neighbour.
    id: toText(raw.id, 80) || (BUILT_IN_BLOCK_TYPES.includes(type) ? `builtin:${type}` : nextId(type)),
    type,
    hidden_in: hiddenIn,
    align: oneOf(raw.align, BLOCK_ALIGNMENTS, "start"),
  };

  switch (type) {
    case "text":
      return {
        ...base,
        content: localized(raw.content),
        size: oneOf(raw.size, BLOCK_TEXT_SIZES, "md"),
        bold: coerceBoolean(raw.bold, false),
        boxed: coerceBoolean(raw.boxed, false),
      };
    case "image":
      return { ...base, url: toPublicUrl(raw.url), width_pct: clampNumber(raw.width_pct, 100, 10, 100) };
    case "qr":
      return {
        ...base,
        source: oneOf(raw.source, QR_SOURCES, "public_url"),
        value: toText(raw.value, 500),
        size_px: clampNumber(raw.size_px, 120, 48, 320),
        caption: localized(raw.caption),
      };
    case "barcode":
      return { ...base, source: oneOf(raw.source, BARCODE_SOURCES, "invoice_number"), value: toText(raw.value, 120) };
    case "field_row":
      return {
        ...base,
        label: localized(raw.label),
        source: oneOf(raw.source, FIELD_ROW_SOURCES, "custom"),
        value: toText(raw.value, 500),
      };
    case "spacer":
      return { ...base, height_px: clampNumber(raw.height_px, 16, 4, 200) };
    default:
      return base;
  }
};

// A stored list is never trusted to be complete. Unknown types are dropped, duplicate
// built-ins collapse, and any built-in the stored list is missing is appended in its
// default position — so a template written by an older build keeps working after a
// block type is added, instead of silently losing a section of the invoice.
export const normalizeInvoiceBlocks = (blocks) => {
  if (!Array.isArray(blocks) || !blocks.length) return DEFAULT_INVOICE_BLOCKS.map((block) => ({ ...block, hidden_in: [...block.hidden_in] }));

  const seenBuiltIns = new Set();
  const normalized = [];
  for (const raw of blocks) {
    const block = normalizeBlock(raw);
    if (!block) continue;
    if (BUILT_IN_BLOCK_TYPES.includes(block.type)) {
      if (seenBuiltIns.has(block.type)) continue;
      seenBuiltIns.add(block.type);
    }
    normalized.push(block);
  }

  DEFAULT_INVOICE_BLOCKS.forEach((fallback, index) => {
    if (seenBuiltIns.has(fallback.type)) return;
    const insertAt = Math.min(index, normalized.length);
    normalized.splice(insertAt, 0, { ...fallback, hidden_in: [...fallback.hidden_in] });
  });

  return normalized;
};

export const blocksForOutput = (blocks, output = "public") =>
  normalizeInvoiceBlocks(blocks).filter((block) => !block.hidden_in.includes(output));

export const isBlockVisibleIn = (block, output) => !((block?.hidden_in) || []).includes(output);

export const toggleBlockOutput = (block, output, visible) => {
  const hidden = new Set(block?.hidden_in || []);
  if (visible) hidden.delete(output);
  else hidden.add(output);
  return { ...block, hidden_in: [...hidden] };
};

export const moveInvoiceBlock = (blocks, fromIndex, toIndex) => {
  const list = normalizeInvoiceBlocks(blocks);
  if (fromIndex < 0 || fromIndex >= list.length) return list;
  const target = Math.min(Math.max(toIndex, 0), list.length - 1);
  if (target === fromIndex) return list;
  const next = [...list];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(target, 0, moved);
  return next;
};

// ---------------------------------------------------------------------------
// Values a block resolves against the invoice it is being drawn onto.
// Kept here so the React renderer and the HTML string builder can never disagree
// about what "المتبقي" means on a given block.
// ---------------------------------------------------------------------------

export const resolveFieldRowValue = (block = {}, invoice = {}, { money = (v) => String(v ?? ""), formatDate = (v) => String(v ?? "") } = {}) => {
  const totals = invoice.totals || {};
  switch (block.source) {
    case "invoice_number": return String(invoice.invoiceNumber ?? "");
    case "order_date": return formatDate(invoice.createdAt);
    case "customer_name": return String(invoice.customer?.name ?? "");
    case "customer_phone": return String(invoice.customer?.phone ?? "");
    case "customer_address": return String(invoice.customer?.address ?? "");
    case "payment_method": return String(invoice.paymentMethod ?? "");
    case "order_status": return String(invoice.status ?? "");
    case "seller_name": return String(invoice.sellerName ?? invoice.seller_name ?? "");
    case "subtotal": return money(totals.subtotal);
    case "discount": return money(totals.discount);
    case "shipping": return money(totals.shipping);
    case "grand_total": return money(totals.grandTotal ?? totals.total);
    case "paid": return money(totals.paidAmount ?? totals.paid);
    case "remaining": return money(totals.remainingAmount ?? totals.remaining);
    default: return String(block.value ?? "");
  }
};

export const resolveQrValue = (block = {}, invoice = {}) =>
  block.source === "custom" ? String(block.value || "") : String(invoice.publicUrl || invoice.public_invoice_url || "");

export const resolveBarcodeValue = (block = {}, invoice = {}) =>
  block.source === "custom" ? String(block.value || "") : String(invoice.invoiceNumber || "");

export const localizedBlockText = (value, language = "ar") => {
  const source = value && typeof value === "object" ? value : {};
  const wanted = language === "en" ? source.en : source.ar;
  // Falling back the other way keeps a block the operator only filled in once visible in
  // both languages, rather than vanishing when the invoice prints in the other one.
  return String(wanted || source.ar || source.en || "");
};

// ---------------------------------------------------------------------------
// QR drawing. qrcode's create() is synchronous, unlike its toString/toDataURL, so both
// the React tree and the print HTML string can draw a code without awaiting anything.
// ---------------------------------------------------------------------------

export const qrSvgMarkup = (text, { size = 120, margin = 2 } = {}, createQr) => {
  const value = String(text || "").trim();
  if (!value || typeof createQr !== "function") return "";
  let matrix;
  try {
    matrix = createQr(value, { errorCorrectionLevel: "M" })?.modules;
  } catch {
    return "";
  }
  if (!matrix?.size) return "";

  const count = matrix.size;
  const total = count + margin * 2;
  let path = "";
  for (let row = 0; row < count; row += 1) {
    for (let column = 0; column < count; column += 1) {
      if (!matrix.data[row * count + column]) continue;
      path += `M${column + margin} ${row + margin}h1v1h-1z`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="${size}" height="${size}" shape-rendering="crispEdges"><rect width="${total}" height="${total}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
};
