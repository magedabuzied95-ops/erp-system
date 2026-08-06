import { CONVERSATION_RULES } from "./conversationRules";
import type { CustomerMood, Priority, Urgency } from "./conversationTypes";

export function analyzePriority(leadScore: number, mood: CustomerMood, intents: string[]): { priority: Priority; urgency: Urgency } {
  const critical = mood === "Angry" && intents.some((intent) => ["Complaint", "Payment"].includes(intent));
  if (critical) return { priority: "Critical", urgency: "Critical" };
  if (mood === "Urgent" || intents.includes("Purchase Ready") || leadScore >= CONVERSATION_RULES.HIGH_PRIORITY_SCORE) return { priority: "High", urgency: "High" };
  if (leadScore >= CONVERSATION_RULES.MEDIUM_PRIORITY_SCORE || intents.includes("Order Tracking")) return { priority: "Medium", urgency: "Medium" };
  return { priority: "Low", urgency: "Low" };
}

