import { canonicalPhoneKey } from "../../utils/phoneSearch.js";

const alnum = (value = "") => String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

// CIB writes "محمدمجدى علىالبواب" for "محمد مجدي علي البواب": compare names with the
// spaces gone and the letters banks and people spell interchangeably folded together.
export const nameKey = (value = "") =>
  String(value ?? "")
    .toLowerCase()
    .replace(/[ً-ٰٟـ]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/[^a-zء-ي]/g, "");

// One name must be the other, or its start — "محمد مجدي" typed at checkout still owns the
// transfer from "محمد مجدي علي البواب" — and the shorter one must be long enough to mean a person.
export const namesMatch = (a = "", b = "") => {
  const left = nameKey(a);
  const right = nameKey(b);
  if (!left || !right) return false;
  if (left === right) return left.length >= 6;
  const [shorter, longer] = left.length <= right.length ? [left, right] : [right, left];
  return shorter.length >= 8 && longer.startsWith(shorter);
};

// InstaPay names the sender by their address — "zeinababdelnasser@instapay". The part
// before the @ is what a person recognises and what a customer types at checkout; the
// domain is the same for everyone, so it never takes part in a comparison.
const senderIdentity = (value = "") => String(value ?? "").split("@")[0].trim();

// Pure: which of the waiting orders the transfer proves, and how sure we are.
export const decideTransferMatch = ({ transfer, candidates = [], trustedSender = false, walletKnown = true }) => {
  const senderKey = canonicalPhoneKey(transfer.counterparty_phone);
  const reference = alnum(transfer.reference);
  const identity = senderIdentity(transfer.counterparty_name);
  const identityKey = alnum(identity);
  const methodFor = (order) => {
    if (senderKey && canonicalPhoneKey(order.customer_phone) === senderKey) return "auto_phone";
    const quoted = alnum(order.shipping_payment_reference);
    if (quoted && reference.length >= 6 && quoted.includes(reference)) return "auto_reference";
    if (quoted && senderKey && canonicalPhoneKey(quoted) === senderKey) return "auto_reference";
    // The customer who wrote their own InstaPay address on the order owns this transfer.
    if (quoted && identityKey.length >= 6 && quoted.includes(identityKey)) return "auto_reference";
    if (identity && namesMatch(order.customer_name, identity)) return "auto_name";
    return "";
  };
  const strong = candidates.filter((order) => methodFor(order));
  const ordered = [...strong, ...candidates.filter((order) => !strong.includes(order))];
  const candidateIds = ordered.map((order) => Number(order.id));

  if (strong.length === 1 && trustedSender && walletKnown) {
    return { action: "confirm", order: strong[0], matchMethod: methodFor(strong[0]), candidateIds };
  }
  if (!candidates.length) return { action: "unmatched", reviewReason: null, candidateIds };
  const reviewReason = !trustedSender
    ? "untrusted_sender"
    : !walletKnown
      ? "unknown_wallet"
      : strong.length > 1
        ? "several_orders"
        : "amount_only";
  return { action: "review", reviewReason, candidateIds };
};
