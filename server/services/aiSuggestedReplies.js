export function buildSuggestedReplies(baseReply = "", context = {}) {
  const reply = String(baseReply || "").trim();

  if (!reply) {
    return [];
  }

  const productName = context?.productContext?.name || context?.memory?.lastProduct?.name;
  const price =
    context?.productContext?.salePrice ||
    context?.productContext?.price ||
    context?.memory?.lastProduct?.price;

  const suggestions = [
    {
      id: "casual",
      label: "Casual",
      tone: "casual",
      text: reply,
    },
  ];

  if (productName && price) {
    suggestions.push({
      id: "professional",
      label: "Professional",
      tone: "professional",
      text: `سعر ${productName} الحالي هو ${price} جنيه.`,
    });

    suggestions.push({
      id: "sales",
      label: "Sales",
      tone: "sales",
      text: `سعر ${productName} حاليا ${price} جنيه والموديل عليه طلب عالي.`,
    });
  } else {
    suggestions.push({
      id: "professional",
      label: "Professional",
      tone: "professional",
      text: reply,
    });

    suggestions.push({
      id: "friendly",
      label: "Friendly",
      tone: "friendly",
      text: `${reply} `,
    });
  }

  return suggestions.slice(0, 3);
}
