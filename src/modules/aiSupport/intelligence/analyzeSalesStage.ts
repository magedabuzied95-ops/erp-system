import type { SalesStage } from "./conversationTypes";

interface SalesStageInput { intents: string[]; buyingSignals: string[]; objections: string[]; completedOrders: number; totalOrders: number; lostCustomer: boolean; }

export function analyzeSalesStage(input: SalesStageInput): SalesStage {
  if (input.lostCustomer) return "Lost";
  if (input.intents.some((intent) => ["Complaint", "Exchange", "Order Tracking", "Support"].includes(intent))) return "Support";
  if (input.intents.includes("Purchase Ready")) return "Ready To Buy";
  if (input.objections.includes("Price") || input.buyingSignals.includes("Asked discount")) return "Negotiating";
  if (input.buyingSignals.length >= 3) return "Comparing";
  if (input.completedOrders > 1) return "Returning Customer";
  if (input.completedOrders === 1 || input.totalOrders > 0) return "Purchased";
  if (input.buyingSignals.length) return "Interested";
  return "New Lead";
}

