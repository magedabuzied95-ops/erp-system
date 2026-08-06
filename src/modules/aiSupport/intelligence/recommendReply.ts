import type { CustomerMood, ReplyRecommendation } from "./conversationTypes";

export function recommendReply(intents: string[], mood: CustomerMood, objections: string[]): ReplyRecommendation {
  if (mood === "Angry") return { title: "Acknowledge and de-escalate", reason: "The customer shows strong dissatisfaction.", tone: "Empathetic and accountable", replyStrategy: "Acknowledge the issue, confirm ownership, then provide a clear resolution path." };
  if (intents.includes("Purchase Ready")) return { title: "Remove final purchase friction", reason: "The customer is ready to complete the purchase.", tone: "Confident and concise", replyStrategy: "Confirm availability, total price, and the immediate checkout step." };
  if (objections.length) return { title: "Resolve the primary objection", reason: `${objections[0]} is blocking progression.`, tone: "Reassuring and factual", replyStrategy: "Answer the objection with evidence, then ask one commitment-oriented question." };
  if (intents.includes("Price Inquiry")) return { title: "Clarify value and price", reason: "Pricing is the customer’s current focus.", tone: "Helpful and transparent", replyStrategy: "State the relevant pricing context and connect it to product value." };
  return { title: "Advance discovery", reason: "More qualification is needed before recommending a solution.", tone: "Consultative", replyStrategy: "Answer the current question and ask one targeted preference question." };
}

