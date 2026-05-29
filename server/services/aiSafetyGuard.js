export function guardAIReply({
  reply,
  intent,
  productContext,
  conversationMemory,
  detectedSize,
} = {}) {
  const safeReply = String(reply || "").trim();
  const effectiveProduct = productContext || conversationMemory?.lastProduct || null;

  if (!safeReply) {
    return {
      allowed: false,
      reply: "ممكن توضحلي طلبك أكتر؟ ",
      reason: "EMPTY_REPLY",
    };
  }

  if (intent === "PRICE_INQUIRY") {
    const price = effectiveProduct?.salePrice || effectiveProduct?.price;

    if (!effectiveProduct || price == null || price === "") {
      return {
        allowed: true,
        reply: "ممكن تبعتلي اسم المنتج أو صورته عشان أقولك السعر الصح؟ ",
        reason: "MISSING_PRICE_CONTEXT",
      };
    }
  }

  if (intent === "AVAILABILITY_INQUIRY") {
    if (!effectiveProduct) {
      return {
        allowed: true,
        reply: "ممكن تبعتلي اسم المنتج أو صورته عشان أتأكدلك من التوفر؟ ",
        reason: "MISSING_AVAILABILITY_CONTEXT",
      };
    }

    if (effectiveProduct.inStock === false) {
      return {
        allowed: true,
        reply: `للأسف ${effectiveProduct.name} غير متوفر حاليا.`,
        reason: "OUT_OF_STOCK_OVERRIDE",
      };
    }
  }

  if (intent === "SIZE_INQUIRY" && detectedSize && effectiveProduct?.sizes?.length) {
    const available = effectiveProduct.sizes.map(String).includes(String(detectedSize));

    if (!available) {
      return {
        allowed: true,
        reply: `للأسف مقاس ${detectedSize} مش ظاهر متاح حاليا في ${effectiveProduct.name}.`,
        reason: "SIZE_NOT_AVAILABLE_OVERRIDE",
      };
    }
  }

  return {
    allowed: true,
    reply: safeReply,
    reason: "OK",
  };
}
