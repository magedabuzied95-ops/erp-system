import type { BusinessRules } from "./decisionTypes";

export const DEFAULT_DECISION_RULES: BusinessRules = Object.freeze({
  offer: Object.freeze({ returningDiscount: 5, vipDiscount: 10, maxDiscount: 15, bundleMinimumItems: 2, giftMinimumSpend: 5000, freeShippingMinimumSpend: 1500 }),
  coupon: Object.freeze({ enabled: true, defaultAmount: 5, expirationDays: 7, minimumLeadScore: 60 }),
  shipping: Object.freeze({ expressUrgency: ["High", "Critical"], freeShippingMinimumSpend: 1500, pickupStockMinimum: 1 }),
  risk: Object.freeze({ repeatedComplaints: 3, repeatedReturns: 3, largeOrderAmount: 10000, waitingMinutes: 30, lowStockThreshold: 3 }),
  automation: Object.freeze({ minimumConfidence: 70, blockedIntents: ["Complaint", "Exchange", "Payment"], blockedRiskLevels: ["High", "Critical"] }),
});

export function resolveDecisionRules(overrides?: Partial<BusinessRules>): BusinessRules {
  return {
    offer: { ...DEFAULT_DECISION_RULES.offer, ...overrides?.offer }, coupon: { ...DEFAULT_DECISION_RULES.coupon, ...overrides?.coupon },
    shipping: { ...DEFAULT_DECISION_RULES.shipping, ...overrides?.shipping }, risk: { ...DEFAULT_DECISION_RULES.risk, ...overrides?.risk },
    automation: { ...DEFAULT_DECISION_RULES.automation, ...overrides?.automation },
  };
}

