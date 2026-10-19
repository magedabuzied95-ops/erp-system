import { isExchangeReturnPolicyQuestion } from "../utils/storeFactsQuestion.js";

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

  // "متاح استبدال او استرجاع ؟" asks for the policy; it is no complaint, and escalating it left the
  // customer with no reply at all (production, 2026-10-19). A message with a complaint word
  // ("عايز ارجعه فيه مشكلة") is not a policy question and still escalates.
  if (!matchedKeyword || isExchangeReturnPolicyQuestion(message)) {
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
