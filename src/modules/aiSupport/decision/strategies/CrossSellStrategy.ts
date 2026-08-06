import type { BusinessRules, DecisionInput, DecisionProduct, Strategy } from "../decisionTypes";

export const CrossSellStrategy: Strategy<DecisionProduct[]> = {
  evaluate(input) {
    const purchased = new Set(input.orders.flatMap((order) => order.items || []).map((item) => String(item.productId)));
    const categories = new Set(input.orders.flatMap((order) => order.items || []).map((item) => item.category).filter(Boolean));
    return input.inventory.products.filter((product) => !purchased.has(String(product.productId)) && Number(product.stock || 0) > 0).map((product) => {
      const related = input.inventory.products.some((source) => purchased.has(String(source.productId)) && source.relatedProductIds?.map(String).includes(String(product.productId)));
      const categoryMatch = Boolean(product.category && categories.has(product.category));
      const score = (related ? 60 : 0) + (categoryMatch ? 25 : 0) + (Number(product.stock || 0) > 0 ? 15 : 0);
      return { id: String(product.productId), name: product.name || "Product", score, price: Number(product.price || 0), category: product.category || "", reason: related ? "Related to a purchased product." : "Matches purchase-history category.", confidence: Math.min(95, score), source: "Inventory + Orders" as const };
    }).filter((item) => item.score > 15).sort((a, b) => b.score - a.score).slice(0, 5);
  },
};

