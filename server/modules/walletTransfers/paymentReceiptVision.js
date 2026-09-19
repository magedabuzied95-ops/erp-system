import path from "node:path";

import sharp from "sharp";

import db from "../../database/db.js";
import { requestCompatibleVisionJson, resolveVisionProvider } from "../../services/aiVisionProviderService.js";

/*
 * Reading the transfer screenshot the customer uploads.
 *
 * InstaPay's notification names the sender by their InstaPay address and by nothing else — no
 * phone number, no Arabic name, no transaction number. The customer's own receipt carries that
 * same address, so lifting it off the screenshot is what joins the two ends of one transfer.
 *
 * The model only ever supplies an ADDRESS. It can never confirm money: the order is still only
 * approved by a real notification carrying that address AND the exact amount, inside the match
 * window. A misread address moves nothing on its own, and a receipt whose amount is not what the
 * order is waiting for is not written at all.
 */

const RECEIPT_KEYS = ["sender_address", "sender_name", "amount", "reference", "recipient"];

const VISION_INSTRUCTIONS = [
  "You read screenshots and photos of Egyptian money-transfer receipts: InstaPay, bank apps (CIB, Banque Misr, United Bank), and Vodafone Cash.",
  "The picture is often a camera photo of another phone's screen: blurry, angled, glared. Read only what is actually legible.",
  "sender_address: the InstaPay address the money was sent FROM, exactly as printed, e.g. name@instapay or 01012345678@instapay. It sits under 'من' / 'From'. Never invent it, never repair it, never use the RECIPIENT's address (under 'إلى' / 'To').",
  "sender_name: the sender's name as printed, Arabic or Latin.",
  "amount: the amount transferred, digits only, no currency. If fees and a total are shown, take the amount that was transferred, not the total with fees.",
  "reference: the transaction/reference number, digits or letters, as printed.",
  "recipient: the address or phone the money went TO.",
  "Any field you cannot read: return an empty string. An empty field is correct; a guess is not.",
].join("\n");

const cleanText = (value = "") => String(value ?? "").trim();
const money = (value) => {
  const parsed = Number(String(value ?? "").replace(/[^\d.]/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) / 100 : null;
};

// An address is only an address: one @, nothing but address characters. A narrow screenshot wraps
// a long one onto two lines, so whitespace anywhere inside it is joined back up before judging it.
const ADDRESS = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+$/;
const address = (value = "") => {
  const candidate = cleanText(value).replace(/\s+/g, "").toLowerCase();
  return ADDRESS.test(candidate) ? candidate : "";
};

export const normalizeReceipt = (raw = {}) => ({
  senderAddress: address(raw?.sender_address),
  senderName: cleanText(raw?.sender_name).slice(0, 120),
  amount: money(raw?.amount),
  reference: cleanText(raw?.reference).replace(/\s+/g, "").slice(0, 60),
  recipient: cleanText(raw?.recipient).replace(/\s+/g, "").slice(0, 120),
});

const envFlagDisabled = (value = "") => ["0", "false", "off", "no"].includes(cleanText(value).toLowerCase());

const RECEIPT_TIMEOUT_MS = 30_000;

export const openAiVisionProvider = (env = process.env, model = "") => {
  const apiKey = cleanText(env.OPENAI_AGENT_API_KEY || env.OPENAI_API_KEY);
  const chosen = cleanText(model || env.OPENAI_VISION_MODEL || env.OPENAI_MODEL);
  if (!apiKey || !chosen) return null;
  return { kind: "openai", baseUrl: "https://api.openai.com/v1", apiKey, model: chosen, timeout: RECEIPT_TIMEOUT_MS };
};

/*
 * The compatible server configured for customer photos reads receipts too, and OpenAI stays the
 * fallback, as it is everywhere else. No model configured at all ⇒ the feature is simply off.
 *
 * PAYMENT_RECEIPT_VISION_MODEL gives receipts a model of their own (with _BASE_URL / _API_KEY, or
 * OpenAI when no base URL is given). Live 2026-09-20 the Groq day budget the inbox and the photo
 * search share was at 199,590 of 200,000 tokens by 01:40, and a receipt costs ~3,000 — so on a
 * busy day receipts would find nothing left. Their own key is how they stop queueing behind chat.
 */
export const receiptVisionProvider = (env = process.env) => {
  if (envFlagDisabled(env.PAYMENT_RECEIPT_VISION)) return null;
  const own = cleanText(env.PAYMENT_RECEIPT_VISION_MODEL);
  if (own) {
    const origin = cleanText(env.PAYMENT_RECEIPT_VISION_BASE_URL).replace(/\/+$/, "");
    if (!origin) return openAiVisionProvider(env, own);
    return {
      kind: "compatible",
      baseUrl: /\/v1$/i.test(origin) ? origin : `${origin}/v1`,
      apiKey: cleanText(env.PAYMENT_RECEIPT_VISION_API_KEY || env.AI_VISION_API_KEY || env.AI_TEXT_API_KEY) || "local",
      model: own,
      timeout: RECEIPT_TIMEOUT_MS,
    };
  }
  const configured = resolveVisionProvider(env);
  if (configured.kind === "compatible") return configured;
  return openAiVisionProvider(env);
};

// A 10 MB camera photo is mostly noise to a reader. Straighten it by its EXIF orientation —
// a sideways receipt is an unreadable one — and send a long edge the model can still resolve text in.
const MAX_EDGE = 1400;
export const receiptImageDataUrl = async (diskPath = "") => {
  const buffer = await sharp(diskPath)
    .rotate()
    .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toBuffer();
  return `data:image/jpeg;base64,${buffer.toString("base64")}`;
};

// `/uploads/payment-proofs/x.jpg` as stored on the order is a public path, not a file. Only a
// path that still sits inside uploads/ after resolving is one we will open and send anywhere.
export const receiptDiskPath = (proofPath = "", root = process.cwd()) => {
  const relative = cleanText(proofPath).replace(/^\/+/, "");
  if (!relative.startsWith("uploads/")) return "";
  const uploads = path.resolve(root, "uploads");
  const resolved = path.resolve(root, relative);
  return resolved === uploads || resolved.startsWith(uploads + path.sep) ? resolved : "";
};

// The reading itself, on a file already known to be ours. `server/scripts/paymentReceiptVisionSmoke.js`
// calls this on any picture, so the prompt that runs in production is the one you can prove.
export const readReceiptImage = async ({ diskPath = "", provider = receiptVisionProvider() } = {}) => {
  if (!provider || !diskPath) return null;
  const parsed = await requestCompatibleVisionJson({
    provider,
    instructions: VISION_INSTRUCTIONS,
    prompt: "Read this money-transfer receipt.",
    imageUrl: await receiptImageDataUrl(diskPath),
    keys: RECEIPT_KEYS,
    // Nobody is waiting on this: the customer already has their reply.
    maxRateLimitWaitMs: 20_000,
  });
  return normalizeReceipt(parsed);
};

export const readTransferReceipt = async ({ proofPath = "", provider = receiptVisionProvider() } = {}) =>
  readReceiptImage({ diskPath: receiptDiskPath(proofPath), provider });

const matchesAnyAmount = (amount, expected = []) =>
  expected.filter((value) => Number(value) > 0).some((value) => Math.abs(Number(value) - amount) < 0.01);

/**
 * Read the uploaded screenshot, write the sender's address on the order, and look again at the
 * transfers already waiting. Never throws: a screenshot nobody could read leaves the order exactly
 * where the upload left it — in review, waiting for a person.
 */
export const attachReceiptSenderAddress = async ({ order = null, proofPath = "", expectedAmounts = [] } = {}) => {
  const orderId = Number(order?.id) || 0;
  if (!orderId || !cleanText(proofPath)) return { outcome: "skipped" };
  // A reference already on the order is the customer's own word or a staff member's; never overwrite it.
  if (cleanText(order?.shipping_payment_reference)) return { outcome: "already_known" };

  let receipt = null;
  try {
    receipt = await readTransferReceipt({ proofPath });
  } catch (error) {
    console.warn("[payment-receipt] could not be read", { orderId, message: error?.message || String(error) });
    return { outcome: "unreadable" };
  }
  if (!receipt) return { outcome: "vision_off" };
  if (!receipt.senderAddress) {
    console.info("[payment-receipt] no sender address in the picture", { orderId, amount: receipt.amount });
    return { outcome: "no_address", receipt };
  }
  // The receipt must be for what this order is waiting for. A screenshot of some other payment —
  // or a misread amount — must not hand this order an address that a real transfer could then match.
  if (receipt.amount && expectedAmounts.length && !matchesAnyAmount(receipt.amount, expectedAmounts)) {
    console.warn("[payment-receipt] amount is not what the order awaits", { orderId, read: receipt.amount, expected: expectedAmounts });
    return { outcome: "amount_mismatch", receipt };
  }

  const note = [receipt.senderAddress, receipt.senderName, receipt.reference].filter(Boolean).join(" · ");
  const timelineEntry = JSON.stringify([{
    action: "payment_receipt_read",
    status: cleanText(order?.status),
    note,
    source: "receipt_vision",
    actor: "system",
    label: "قرأنا عنوان المحوِّل من صورة التحويل",
    amount: receipt.amount,
    at: new Date().toISOString(),
  }]);
  const updated = await db.query(
    `
    UPDATE orders
    SET shipping_payment_reference = $2,
        timeline = COALESCE(timeline, '[]'::jsonb) || $3::jsonb,
        updated_at = NOW()
    WHERE id = $1 AND COALESCE(shipping_payment_reference, '') = ''
    RETURNING id, tenant_id
    `,
    [orderId, receipt.senderAddress, timelineEntry]
  );
  if (!updated.rows[0]) return { outcome: "already_known", receipt };
  console.info("[payment-receipt] sender address attached", { orderId, address: receipt.senderAddress });

  // The transfer usually landed before the screenshot did, so the notification is already waiting.
  const { rematchWalletTransfersForOrder } = await import("./walletTransfers.service.js");
  await rematchWalletTransfersForOrder({ tenantId: updated.rows[0].tenant_id ?? null, orderId });
  return { outcome: "attached", receipt };
};

export default { attachReceiptSenderAddress, readTransferReceipt, normalizeReceipt, receiptVisionProvider };
