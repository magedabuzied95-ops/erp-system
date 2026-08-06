import type { CopilotContext } from "./CopilotContext";
import type { CopilotAction } from "./CopilotTypes";

export function buildRecommendedActions(context: CopilotContext): CopilotAction[] {
  const decision = context.analysis.decision;
  if (!decision) return [];
  const allowed = new Set(context.permissions.allowedActions);
  const action = (name: string, priority: CopilotAction["priority"], reason: string, parameters: Record<string, unknown> = {}): CopilotAction => ({ action: name, priority, reason, permitted: allowed.has(name), parameters });
  const actions = [action(decision.nextWorkflow.value, decision.priority, decision.nextWorkflow.reason, { conversationId: context.conversation.id })];
  if (decision.escalation.value.target !== "None") actions.push(action("Escalate", decision.escalation.value.priority, decision.escalation.reason, { target: decision.escalation.value.target }));
  if (decision.coupon.value.code) actions.push(action("Apply Coupon", "Medium", decision.coupon.reason, { code: decision.coupon.value.code, amount: decision.coupon.value.amount }));
  if (decision.shippingOffer.value !== "Normal") actions.push(action("Apply Shipping Offer", "Medium", decision.shippingOffer.reason, { shipping: decision.shippingOffer.value }));
  return actions;
}

