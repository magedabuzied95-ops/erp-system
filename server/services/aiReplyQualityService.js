const text = (value = "") => String(value ?? "").trim();
const asArray = (value) => (Array.isArray(value) ? value : []);

export const hasBrokenReplyEncoding = (value = "") => {
  const source = text(value);
  if (!source) return false;
  if (/\uFFFD|Ã.|Â.|â(?:€|œ|™|€¦)/.test(source)) return true;
  const suspicious = (source.match(/[طظ]/g) || []).length;
  const arabic = (source.match(/[\u0600-\u06ff]/g) || []).length;
  return suspicious >= 4 && arabic > 0 && suspicious / arabic >= 0.28;
};

const productName = (product = {}) => text(product.name || product.title || product.product_name || product.base_name);
const productUrl = (product = {}) => text(product.product_url || product.productUrl || product.url);

export const safeGroundedReply = ({ products = [], intent = "" } = {}) => {
  const grounded = asArray(products).filter((product) => productName(product)).slice(0, 3);
  if (grounded.length) {
    const lines = ["لقيتلك اختيارات متاحة من بيانات المتجر:"];
    grounded.forEach((product, index) => {
      lines.push(`${index + 1}- ${productName(product)}`);
      if (productUrl(product)) lines.push(productUrl(product));
    });
    lines.push("قولّي المقاس واللون اللي محتاجهم عشان أأكد لك المتاح.");
    return lines.join("\n");
  }
  if (intent === "greeting") return "أهلًا وسهلًا بيك. تحب تشوف موديلات رجالي ولا حريمي ولا أطفال؟";
  return "ممكن تقولّي رجالي ولا حريمي ولا أطفال، واسم الموديل أو المقاس اللي محتاجه؟ هطلع لك المتاح من المتجر مباشرة.";
};

export const sanitizeGroundedAiReply = ({ reply = "", products = [], intent = "" } = {}) => {
  const source = text(reply);
  if (source && !hasBrokenReplyEncoding(source)) return { reply: source, replaced: false, reason: "ok" };
  return {
    reply: safeGroundedReply({ products, intent }),
    replaced: true,
    reason: source ? "broken_encoding" : "empty_reply",
  };
};

export default { hasBrokenReplyEncoding, safeGroundedReply, sanitizeGroundedAiReply };
