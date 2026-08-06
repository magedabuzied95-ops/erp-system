import type { CopilotContext } from "./CopilotContext";
import type { CopilotSuggestion } from "./CopilotTypes";

export function buildSuggestions(context: CopilotContext): CopilotSuggestion[] {
  const decision = context.analysis.decision;
  if (!decision) return [];
  const suggestions: CopilotSuggestion[] = [];
  const offer = decision.recommendedOffer;
  if (offer.value.type !== "No offer") suggestions.push({ id: "offer", title: offer.value.type === "Discount" ? `Offer ${offer.value.value}% discount` : offer.value.type, category: "Offer", priority: decision.priority, reason: offer.reason, confidence: offer.confidence, sourceEngine: "Decision Engine" });
  decision.recommendedProducts.slice(0, 3).forEach((product) => suggestions.push({ id: `product:${product.id}`, title: `Recommend ${product.name}`, category: "Product", priority: "Medium", reason: product.reason, confidence: product.confidence, sourceEngine: "Decision Engine" }));
  if (decision.escalation.value.target !== "None") suggestions.push({ id: "escalation", title: `Escalate to ${decision.escalation.value.target}`, category: "Escalation", priority: decision.escalation.value.priority, reason: decision.escalation.reason, confidence: decision.escalation.confidence, sourceEngine: "Decision Engine" });
  if (decision.nextWorkflow.value === "Generate Invoice") suggestions.push({ id: "invoice", title: "Send invoice", category: "Payment", priority: "High", reason: decision.nextWorkflow.reason, confidence: decision.nextWorkflow.confidence, sourceEngine: "Decision Engine" });
  suggestions.push({ id: "workflow", title: decision.nextWorkflow.value, category: "Workflow", priority: decision.priority, reason: decision.nextWorkflow.reason, confidence: decision.nextWorkflow.confidence, sourceEngine: "Decision Engine" });
  return suggestions;
}

