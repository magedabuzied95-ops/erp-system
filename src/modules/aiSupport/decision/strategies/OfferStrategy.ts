import type { BusinessRules, DecisionInput, DecisionValue, OfferDecision, Strategy } from "../decisionTypes";

export const OfferStrategy: Strategy<{ offer: DecisionValue<OfferDecision>; discount: DecisionValue<number> }> = {
  evaluate(input, rules) {
    const health = input.crmIntelligence.health.label;
    const spend = input.crmIntelligence.metrics.lifetimeSpend;
    const activeCampaign = input.campaigns.find((campaign) => campaign.active && (!campaign.eligibleCustomerIds?.length || campaign.eligibleCustomerIds.map(String).includes(String(input.customer.id))));
    let type: OfferDecision["type"] = "No offer", value = 0, reason = "No qualifying commercial rule was triggered.";
    if (health === "VIP") { type = "VIP offer"; value = rules.offer.vipDiscount; reason = "VIP status qualifies for the configured VIP offer."; }
    else if (activeCampaign?.type === "Bundle") { type = "Bundle"; value = Number(activeCampaign.value || 0); reason = "An eligible bundle campaign is active."; }
    else if (activeCampaign?.type === "Gift" || spend >= rules.offer.giftMinimumSpend) { type = "Gift"; reason = "Customer value meets the configured gift threshold."; }
    else if (activeCampaign?.type === "Shipping" || spend >= rules.offer.freeShippingMinimumSpend) { type = "Free shipping"; reason = "Customer value meets the free-shipping rule."; }
    else if (input.orders.length > 1) { type = "Discount"; value = rules.offer.returningDiscount; reason = "Returning customer qualifies for the configured retention discount."; }
    value = Math.min(value, rules.offer.maxDiscount);
    const confidence = type === "No offer" ? 70 : 88;
    return { offer: { value: { type, value }, reason, confidence, source: "Business Rules" }, discount: { value, reason, confidence, source: "CRM + Conversation" } };
  },
};

