import type { BusinessRules, CouponDecision, DecisionInput, DecisionValue, Strategy } from "../decisionTypes";

export const CouponStrategy: Strategy<DecisionValue<CouponDecision>> = {
  evaluate(input, rules) {
    const campaign = input.campaigns.find((item) => item.active && item.type === "Coupon");
    const eligible = rules.coupon.enabled && input.conversationIntelligence.leadScore >= rules.coupon.minimumLeadScore;
    if (!campaign && !eligible) return { value: { code: null, amount: 0, expiresAt: null }, reason: "Coupon eligibility rules were not met.", confidence: 85, source: "Business Rules" };
    const expiration = campaign?.expiresAt || new Date(Date.now() + rules.coupon.expirationDays * 86400000).toISOString();
    return { value: { code: campaign?.couponCode || `CRM-${String(input.customer.id || "LEAD")}`, amount: Number(campaign?.value ?? rules.coupon.defaultAmount), expiresAt: expiration }, reason: campaign ? "An active coupon campaign applies." : "Lead score meets the configured coupon threshold.", confidence: campaign ? 95 : 82, source: campaign ? "Campaigns" : "CRM + Conversation" };
  },
};

