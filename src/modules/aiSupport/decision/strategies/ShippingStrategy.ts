import type { BusinessRules, DecisionInput, DecisionValue, ShippingType, Strategy } from "../decisionTypes";

export const ShippingStrategy: Strategy<DecisionValue<ShippingType>> = {
  evaluate(input, rules) {
    const spend = input.crmIntelligence.metrics.lifetimeSpend;
    const stockAvailable = input.inventory.products.some((product) => Number(product.stock || 0) >= rules.shipping.pickupStockMinimum);
    if (spend >= rules.shipping.freeShippingMinimumSpend) return { value: "Free Shipping", reason: "Customer spend meets the configured free-shipping threshold.", confidence: 94, source: "CRM" };
    if (rules.shipping.expressUrgency.includes(input.conversationIntelligence.priority)) return { value: "Express", reason: "Conversation urgency qualifies for express handling.", confidence: 88, source: "Conversation" };
    if (stockAvailable && input.currentConversation.channel === "store") return { value: "Store Pickup", reason: "Requested-channel stock is available for pickup.", confidence: 80, source: "Inventory" };
    return { value: "Normal", reason: "No premium shipping rule was triggered.", confidence: 85, source: "Business Rules" };
  },
};

