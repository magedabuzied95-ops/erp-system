import type { ConversationProduct, CRMIntelligenceInput, ProductRecommendation } from "./conversationTypes";

interface ProductInput { products: ConversationProduct[]; text: string; purchasedIds: Set<string>; crm?: CRMIntelligenceInput; }

export function recommendProducts(input: ProductInput): ProductRecommendation[] {
  const preferences = input.crm?.preferences;
  return input.products.map((product) => {
    const reasons: string[] = [];
    let score = 0;
    const id = String(product.id || product.product_id || "");
    const searchable = `${product.name || product.title || ""} ${product.brand || ""} ${product.category || ""} ${product.color || ""} ${product.size || ""}`.toLowerCase();
    if (product.category && product.category === preferences?.favoriteCategory) { score += 30; reasons.push("Matches preferred category"); }
    if (product.brand && product.brand === preferences?.favoriteBrand) { score += 25; reasons.push("Matches favorite brand"); }
    if (product.color && product.color === preferences?.favoriteColor) { score += 10; reasons.push("Matches preferred color"); }
    if (product.size && product.size === preferences?.favoriteSize) { score += 10; reasons.push("Matches preferred size"); }
    if (input.text.split(/\s+/).some((term) => term.length > 3 && searchable.includes(term))) { score += 20; reasons.push("Matches conversation interest"); }
    if (Number(product.available_stock ?? product.stock ?? 0) > 0) { score += 10; reasons.push("Available in stock"); }
    if (input.purchasedIds.has(id)) { score += 5; reasons.push("Previously purchased"); }
    if (product.viewed) { score += 5; reasons.push("Previously viewed"); }
    return { product, score, reasons };
  }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score).slice(0, 5);
}

