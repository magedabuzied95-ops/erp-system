import { resolveDecisionRules } from "./decisionRules";
import type { BusinessDecision, DecisionInput, DecisionPriority, DecisionProduct, DecisionReason, DecisionValue } from "./decisionTypes";
import { OfferStrategy } from "./strategies/OfferStrategy";
import { CrossSellStrategy } from "./strategies/CrossSellStrategy";
import { UpsellStrategy } from "./strategies/UpsellStrategy";
import { CouponStrategy } from "./strategies/CouponStrategy";
import { ShippingStrategy } from "./strategies/ShippingStrategy";
import { WorkflowStrategy } from "./strategies/WorkflowStrategy";
import { EscalationStrategy } from "./strategies/EscalationStrategy";
import { AutomationStrategy } from "./strategies/AutomationStrategy";
import { RiskStrategy } from "./strategies/RiskStrategy";
import { WarningStrategy } from "./strategies/WarningStrategy";

const priorityRank: Record<DecisionPriority, number> = { Low: 1, Medium: 2, High: 3, Critical: 4 };
const asReason = <T>(decision: string, recommendation: DecisionValue<T>): DecisionReason => ({ decision, reason: recommendation.reason, confidence: recommendation.confidence, source: recommendation.source });

function normalizeRecommendedProducts(input: DecisionInput): DecisionProduct[] {
  return input.conversationIntelligence.recommendedProducts.map((item) => ({
    id: String(item.product.id || item.product.product_id || ""), name: item.product.name || item.product.title || "Product",
    score: item.score, price: Number(item.product.price || 0), category: item.product.category || "",
    reason: item.reasons.join("; ") || "Recommended by Conversation Intelligence.", confidence: Math.min(100, item.score), source: "Conversation",
  }));
}

export function makeDecision(input: DecisionInput): BusinessDecision {
  const rules = resolveDecisionRules(input.businessRules);
  const risk = RiskStrategy.evaluate(input, rules);
  const offer = OfferStrategy.evaluate(input, rules);
  const crossSell = CrossSellStrategy.evaluate(input, rules);
  const upsell = UpsellStrategy.evaluate(input, rules);
  const coupon = CouponStrategy.evaluate(input, rules);
  const shippingOffer = ShippingStrategy.evaluate(input, rules);
  const nextWorkflow = WorkflowStrategy.evaluateWithRisk(input, rules, risk);
  const escalation = EscalationStrategy.evaluateWithRisk(input, rules, risk);
  const automation = AutomationStrategy.evaluateWithRisk(input, rules, risk);
  const warnings = WarningStrategy.evaluate(input, rules);
  const followUp = { value: { recommendedAfter: input.conversationIntelligence.followUpRecommendation.recommendedAfter, channel: input.conversationIntelligence.followUpRecommendation.channel }, reason: input.conversationIntelligence.followUpRecommendation.reason, confidence: input.conversationIntelligence.confidence, source: "Conversation" as const };
  const priorities: DecisionPriority[] = [input.conversationIntelligence.priority, escalation.value.priority, risk.level];
  const priority = priorities.sort((a, b) => priorityRank[b] - priorityRank[a])[0];
  const reasoning = [asReason("Recommended Offer", offer.offer), asReason("Recommended Discount", offer.discount), asReason("Coupon", coupon), asReason("Shipping Offer", shippingOffer), asReason("Next Workflow", nextWorkflow), asReason("Escalation", escalation), asReason("Automation", automation), asReason("Follow-up", followUp), ...warnings.map((warning) => asReason(`Warning: ${warning.value}`, warning))];
  const confidence = Math.round(reasoning.reduce((sum, item) => sum + item.confidence, 0) / Math.max(1, reasoning.length));
  return { priority, recommendedOffer: offer.offer, recommendedDiscount: offer.discount, recommendedProducts: normalizeRecommendedProducts(input), crossSell, upsell, coupon, shippingOffer, nextWorkflow, escalation, automation, followUp, warnings, reasoning, confidence };
}

export type { BusinessDecision, DecisionInput } from "./decisionTypes";

