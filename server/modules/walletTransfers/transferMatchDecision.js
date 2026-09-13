import { canonicalPhoneKey } from "../../utils/phoneSearch.js";

const digits = (value = "") => String(value ?? "").replace(/\D/g, "");

// Pure: which of the waiting orders the transfer proves, and how sure we are.
export const decideTransferMatch = ({ transfer, candidates = [], trustedSender = false, walletKnown = true }) => {
  const senderKey = canonicalPhoneKey(transfer.counterparty_phone);
  const reference = digits(transfer.reference);
  const strong = candidates.filter((order) => {
    if (senderKey && canonicalPhoneKey(order.customer_phone) === senderKey) return true;
    const quoted = digits(order.shipping_payment_reference);
    if (!quoted) return false;
    return Boolean((reference && quoted.includes(reference)) || (senderKey && canonicalPhoneKey(quoted) === senderKey));
  });
  const ordered = [...strong, ...candidates.filter((order) => !strong.includes(order))];
  const candidateIds = ordered.map((order) => Number(order.id));

  if (strong.length === 1 && trustedSender && walletKnown) {
    const order = strong[0];
    const byPhone = senderKey && canonicalPhoneKey(order.customer_phone) === senderKey;
    return { action: "confirm", order, matchMethod: byPhone ? "auto_phone" : "auto_reference", candidateIds };
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
