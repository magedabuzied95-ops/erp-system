// AI Inbox intent resolver. Phase 10.6: a substantive business request must beat a leading social
// greeting (e.g. "السلام عليكم عندكم كروكس؟" is PRODUCT_AVAILABILITY, not GREETING). The greeting is kept
// only as a secondary signal (hasGreeting), never as the primary intent when a business signal is present.
// Enum stays stable; ordering puts actionable business intents before greeting/politeness.
export function resolveIntent(message = "") {
  const text = String(message).toLowerCase();

  const hasSize = text.includes("مقاس") || text.includes("size") || text.includes("fit");
  const hasPrice = text.includes("بكام") || text.includes("السعر") || text.includes("كام") || text.includes("price") || text.includes("سعر");
  const hasAvailability = text.includes("متوفر") || text.includes("available") || text.includes("عندكم") || text.includes("عندك") || text.includes("موجود") || text.includes("فيه") || text.includes("خلص");

  // Actionable business intent takes precedence over greeting/politeness (the greeting is secondary).
  if (hasAvailability) return "AVAILABILITY_INQUIRY";
  if (hasSize) return "SIZE_INQUIRY";
  if (hasPrice) return "PRICE_INQUIRY";

  // Greeting only wins when there is no substantive business signal in the message.
  if (["السلام", "وعليكم", "اهلا", "أهلا", "ازيك", "هاي", "hi", "hello", "hey"].some((term) => text.includes(term))) {
    return "GREETING";
  }

  return "GENERAL";
}
