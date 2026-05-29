const ESCALATION_KEYWORDS = [
  "غاضب",
  "زعلان",
  "مضايق",
  "مشكلة",
  "نصب",
  "فلوسي",
  "فلوسى",
  "مرتجع",
  "استرجاع",
  "ارجع",
  "رجع",
  "غلط",
  "شكوى",
  "refund",
  "return",
  "complaint",
  "wrong",
  "scam",
  "angry",
  "upset",
  "money",
  "payment issue",
];

export function detectEscalation(message = "") {
  const text = String(message || "").toLowerCase();

  const matchedKeyword = ESCALATION_KEYWORDS.find((keyword) =>
    text.includes(keyword.toLowerCase())
  );

  if (!matchedKeyword) {
    return {
      shouldEscalate: false,
      reason: null,
      keyword: null,
    };
  }

  return {
    shouldEscalate: true,
    reason: "CUSTOMER_RISK_OR_COMPLAINT",
    keyword: matchedKeyword,
  };
}
