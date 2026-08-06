import type { AssignmentRecommendation, CurrentAgent } from "./conversationTypes";

export function recommendAssignment(intents: string[], currentAgent?: CurrentAgent): AssignmentRecommendation {
  let team: AssignmentRecommendation["team"] = "Sales";
  if (intents.some((intent) => ["Complaint", "Exchange", "Support", "Order Tracking"].includes(intent))) team = "Support";
  else if (intents.includes("Payment")) team = "Accounting";
  else if (intents.includes("Availability") || intents.includes("Delivery")) team = "Warehouse";
  else if (intents.includes("Spam")) team = "Manager";
  const retainCurrentAgent = Boolean(currentAgent?.available && currentAgent.team?.toLowerCase() === team.toLowerCase());
  return { team, retainCurrentAgent, reason: retainCurrentAgent ? `The current agent is available in ${team}.` : `The detected intent is best handled by ${team}.` };
}

