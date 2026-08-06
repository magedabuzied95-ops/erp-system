import type { ActionRecommendation, CustomerMood } from "./conversationTypes";

export function recommendAction(intents: string[], signals: string[], objections: string[], mood: CustomerMood): ActionRecommendation {
  if (mood === "Angry" || intents.includes("Complaint")) return { title: "Transfer to human", reason: "The conversation requires accountable support handling.", priority: "Critical" };
  if (signals.includes("Asked invoice")) return { title: "Send invoice", reason: "The customer explicitly requested an invoice or payment link.", priority: "High" };
  if (objections.includes("Availability")) return { title: "Recommend alternatives", reason: "The requested option appears unavailable.", priority: "High" };
  if (signals.includes("Asked discount")) return { title: "Review discount eligibility", reason: "Price negotiation is active.", priority: "Medium" };
  if (intents.includes("Purchase Ready")) return { title: "Request address", reason: "Delivery information is needed to complete the order.", priority: "High" };
  if (intents.includes("Payment")) return { title: "Route payment assistance", reason: "The customer needs payment guidance.", priority: "Medium" };
  return { title: "Schedule follow-up", reason: "No immediate transactional action is confirmed.", priority: "Low" };
}

