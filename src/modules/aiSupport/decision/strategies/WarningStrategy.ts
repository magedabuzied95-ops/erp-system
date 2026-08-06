import type { BusinessRules, DecisionInput, DecisionValue, Strategy } from "../decisionTypes";

export const WarningStrategy: Strategy<Array<DecisionValue<string>>> = {
  evaluate(input, rules) {
    const warnings: Array<DecisionValue<string> | false> = [
      input.inventory.products.some((product) => Number(product.stock || 0) <= (input.inventory.lowStockThreshold ?? rules.risk.lowStockThreshold)) && { value: "Inventory Low", reason: "One or more relevant products are below the configured stock threshold.", confidence: 95, source: "Inventory" },
      Number(input.currentConversation.waitingMinutes || 0) >= rules.risk.waitingMinutes && { value: "Customer Waiting", reason: "Waiting time exceeds the configured service threshold.", confidence: 98, source: "Conversation" },
      input.crmIntelligence.health.label === "VIP" && { value: "High Value Customer", reason: "CRM health identifies this customer as VIP.", confidence: 99, source: "CRM" },
      input.orders.some((order) => Number(order.total || 0) >= rules.risk.largeOrderAmount) && { value: "Large Order", reason: "Order value exceeds the configured large-order threshold.", confidence: 96, source: "Orders" },
      Number(input.customer.returnCount || 0) >= rules.risk.repeatedReturns && { value: "Repeated Returns", reason: "Return count exceeds the configured threshold.", confidence: 94, source: "Customer" },
      input.orders.some((order) => ["failed", "declined", "unpaid"].includes(String(order.status || "").toLowerCase())) && { value: "Payment Risk", reason: "Order history contains a failed or unpaid payment.", confidence: 92, source: "Orders" },
    ];
    return warnings.filter(Boolean) as Array<DecisionValue<string>>;
  },
};

