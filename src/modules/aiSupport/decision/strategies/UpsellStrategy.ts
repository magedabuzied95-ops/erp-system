import type { BusinessRules, DecisionInput, DecisionProduct, Strategy } from "../decisionTypes";

export const UpsellStrategy: Strategy<DecisionProduct[]> = {
  evaluate(input) {
    const referenced = input.conversationIntelligence.recommendedProducts.map((item) => item.product);
    const baseline = Math.max(0, ...referenced.map((product) => Number(product.price || 0)), input.crmIntelligence.metrics.averageOrder);
    const category = referenced[0]?.category || input.crmIntelligence.preferences.favoriteCategory;
    return input.inventory.products.filter((product) => Number(product.stock || 0) > 0 && Number(product.price || 0) > baseline && (!category || product.category === category)).map((product) => {
      const priceLift = baseline ? Math.min(40, Math.round((Number(product.price || 0) - baseline) / baseline * 100)) : 10;
      const score = 50 + Math.max(0, 40 - priceLift);
      return { id: String(product.productId), name: product.name || "Product", score, price: Number(product.price || 0), category: product.category || "", reason: "Higher-value available alternative in the preferred category.", confidence: Math.min(90, score), source: "Inventory" as const };
    }).sort((a, b) => b.score - a.score).slice(0, 5);
  },
};

