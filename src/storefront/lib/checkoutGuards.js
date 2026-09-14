// Small pure rules the one-page checkout leans on. Kept out of Storefront.jsx so each can be tested
// without rendering the page.

const ARABIC_INDIC_ZERO = 0x0660;
const PERSIAN_ZERO = 0x06f0;

// By code point, so no Arabic literal sits in the source to be mangled by an editor's encoding.
const foldDigit = (char) => {
  const code = char.charCodeAt(0);
  if (code >= ARABIC_INDIC_ZERO && code <= ARABIC_INDIC_ZERO + 9) return String(code - ARABIC_INDIC_ZERO);
  if (code >= PERSIAN_ZERO && code <= PERSIAN_ZERO + 9) return String(code - PERSIAN_ZERO);
  return char;
};

export const EGYPT_MOBILE_PATTERN = /^01[0125][0-9]{8}$/;

/**
 * The local form of an Egyptian mobile as a shopper might type or autofill it: "+20 101 234 5678",
 * "010-1234-5678", Arabic-Indic digits from an Arabic keyboard and "1012345678" all become "01012345678". Anything
 * else comes back as its bare digits, so the pattern check still refuses it. Same folding as the
 * server's toLocalEgyptMobile, plus the Arabic-Indic and Persian digits a phone keyboard produces.
 */
export const normalizeEgyptMobile = (value = "") => {
  let digits = Array.from(String(value ?? ""), foldDigit).join("").replace(/\D/g, "");
  if (digits.startsWith("0020")) digits = digits.slice(4);
  else if (digits.startsWith("20") && digits.length === 12) digits = digits.slice(2);
  if (digits.length === 10 && digits.startsWith("1")) digits = `0${digits}`;
  return digits;
};

export const isEgyptMobile = (value = "") => EGYPT_MOBILE_PATTERN.test(normalizeEgyptMobile(value));

/**
 * Where to move a shopper whose selected method the store no longer accepts. Cash on delivery is
 * the pre-selected default, so when the owner switches it off the page must not keep it selected
 * all the way to a refused submit: online payment when it is on, otherwise a transfer.
 */
export const fallbackPaymentMode = ({ paymentMode = "cod", codAvailable = true, onlineAvailable = false } = {}) => {
  if (paymentMode === "cod" && !codAvailable) return onlineAvailable ? "online" : "electronic";
  if (paymentMode === "online" && !onlineAvailable) return codAvailable ? "cod" : "electronic";
  return paymentMode;
};

/**
 * Whether the shipping line is settled for the address on the form. A failed quote must not stand
 * in for one: the fee it leaves behind belongs to the previous governorate (or is 0), and the
 * server refuses any fee but the one it quotes.
 */
export const shippingQuoteSettled = ({ governorate = "", quote = {} } = {}) =>
  Boolean(governorate) && !quote.loading && !quote.failed && Boolean(quote.match_level);

/**
 * One step of the QR / link coupon auto-apply. A code waits until the cart has a subtotal and the
 * governorate is quoted: a free-shipping coupon checked before there is a fee is refused with
 * "needs a shipping fee to waive", and a coupon applied before the fee arrives is dropped as soon
 * as it does. Each distinct state is tried once (`key`), so a refusal does not retry in a loop.
 */
export const couponAutoApplyStep = ({ armed = false, code = "", subtotal = 0, couponLoading = false, quoted = false, deliveryFee = 0, lastKey = "" } = {}) => {
  const normalizedCode = String(code || "").trim().toUpperCase();
  if (!armed || !normalizedCode || !(Number(subtotal) > 0) || couponLoading || !quoted) return { run: false, key: lastKey };
  const key = `${normalizedCode}::${Number(subtotal).toFixed(2)}::${Number(deliveryFee || 0).toFixed(2)}`;
  if (key === lastKey) return { run: false, key: lastKey };
  return { run: true, key };
};

/**
 * What the courier collects at the door, for the shopper's own order pages. A transfer order is saved
 * unpaid until its proof is approved, so its remaining_amount is the whole total while the proof
 * waits — the money is already sent, and "due on delivery" would tell the customer to pay it twice.
 */
export const orderDueOnDelivery = (order = {}) => {
  const lower = (value) => String(value ?? "").trim().toLowerCase();
  const cod = ["cod", "cash", "cash_on_delivery"].includes(lower(order.payment_method));
  const awaitingTransferReview = lower(order.transfer_proof_status) === "pending" || lower(order.payment_status) === "awaiting_verification";
  if (!cod && awaitingTransferReview) return 0;
  return Math.max(0, Number(order.remaining_amount || 0));
};

// A delivery day quoted before today's cut-off (or before midnight) is wrong after it. Re-quote when
// the cut-off passes, and at least this often so "today/tomorrow" never outlives the date it named.
export const DELIVERY_QUOTE_MAX_AGE_MS = 15 * 60_000;

/** Milliseconds until the checkout's delivery estimate should be quoted again, or null without one. */
export const deliveryQuoteRefreshDelayMs = (estimate = null) => {
  if (!estimate || typeof estimate !== "object") return null;
  const minutesLeft = Number(estimate.cutoff_minutes_left);
  if (estimate.ordered_today && Number.isFinite(minutesLeft) && minutesLeft > 0) {
    // A few seconds past the cut-off, so the server's clock is already on the other side of it.
    return Math.min(DELIVERY_QUOTE_MAX_AGE_MS, Math.ceil(minutesLeft * 60_000) + 5_000);
  }
  return DELIVERY_QUOTE_MAX_AGE_MS;
};
