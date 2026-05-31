export function resolveIntent(message = "") {
  const text = String(message).toLowerCase();

  if (["السلام", "وعليكم", "اهلا", "أهلا", "ازيك", "هاي", "hi", "hello", "hey"].some((term) => text.includes(term))) {
    return "GREETING";
  }

  if (text.includes("مقاس") || text.includes("size") || text.includes("fit")) {
    return "SIZE_INQUIRY";
  }

  if (text.includes("بكام") || text.includes("السعر") || text.includes("كام") || text.includes("price")) {
    return "PRICE_INQUIRY";
  }

  if (text.includes("متوفر") || text.includes("available") || text.includes("فيه") || text.includes("خلص")) {
    return "AVAILABILITY_INQUIRY";
  }

  return "GENERAL";
}
