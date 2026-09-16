// Pure selection resolution for the AI Inbox product picker (no React, so the rule
// it enforces is unit-testable).
//
// THE RULE: what leaves the picker is always a CARD — the product together with the
// variant, colour and size the operator chose. A raw catalogue row is not a card: it
// has no variant_id, no colour and no size. Both hosts read exactly those off the
// line, so a raw row reached the restock form as "pick a colour and size" and the
// form refused to submit it; and when it did reach the server, the server re-checked
// availability against the product's FIRST variant — usually a size that is still in
// stock — and answered "available now" instead of recording the request.

export const resolveSelectedCards = ({
  allowMultiple = false,
  selectedProductIds = [],
  selectedCardsById = {},
  findProduct = () => null,
  toCard = () => null,
} = {}) => {
  if (!allowMultiple) return [];
  return (Array.isArray(selectedProductIds) ? selectedProductIds : [])
    .map((id) => {
      const stored = selectedCardsById?.[id];
      if (stored) return stored;
      // The tick snapshot survives search/filter/pagination; this only covers a
      // selection whose snapshot was lost, and it still yields a card.
      const product = findProduct(id);
      return product ? toCard(product) : null;
    })
    .filter(Boolean);
};

// Nothing ticked is not "nothing chosen": the product open in the colour/size chooser
// is what the operator is looking at, and its card is what the confirm button sends.
export const resolveSubmitBatch = ({ allowMultiple = false, selectedCards = [], activeCard = null } = {}) => {
  if (allowMultiple && Array.isArray(selectedCards) && selectedCards.length) return selectedCards;
  return activeCard ? [activeCard] : [];
};
