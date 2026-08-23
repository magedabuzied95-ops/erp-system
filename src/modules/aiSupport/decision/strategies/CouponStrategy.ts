import type { BusinessRules, CouponDecision, DecisionInput, DecisionValue, Strategy } from "../decisionTypes";

const none = (reason: string, confidence = 85): DecisionValue<CouponDecision> => ({
  value: { code: null, amount: 0, expiresAt: null },
  reason,
  confidence,
  source: "Business Rules",
});

/**
 * Offer a coupon only when a real one exists to offer.
 *
 * This used to mint `CRM-<customer id>` whenever a lead scored high enough with no campaign
 * behind it. That code is not a row in the coupons table, so the customer who tried it got
 * "Coupon not found" — the strategy cannot invent a code, because only the server's generator
 * (or a campaign's shared code) produces one that will validate at checkout.
 *
 * So: a code is surfaced only when an active Coupon campaign actually carries one, and the
 * amount and expiry come from that campaign rather than from defaults.
 */
export const CouponStrategy: Strategy<DecisionValue<CouponDecision>> = {
  evaluate(input: DecisionInput, rules: BusinessRules) {
    if (!rules.coupon.enabled) return none("Coupons are disabled in the business rules.");

    const campaign = input.campaigns.find((item) => item.active && item.type === "Coupon");
    const campaignCode = String(campaign?.couponCode || "").trim();
    if (!campaignCode) {
      return none("No active coupon campaign carries a real code to offer.");
    }

    const eligible = input.conversationIntelligence.leadScore >= rules.coupon.minimumLeadScore;
    if (!eligible) return none("Coupon eligibility rules were not met.");

    return {
      value: {
        code: campaignCode,
        amount: Number(campaign?.value ?? 0),
        expiresAt: campaign?.expiresAt || null,
      },
      reason: "An active coupon campaign applies.",
      confidence: 95,
      source: "Campaigns",
    };
  },
};
