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

// WHAT THE OPERATOR CHOSE, not what the chooser filled in. The desktop chooser pre-selects the
// first colour and the first size the moment a product is opened, so EVERY card it builds carries
// both — the card alone can never say what was picked. `pickedScope` is the click that did:
// "color" for a swatch, "color_size" for a size. The three results are the phone's own
// (AiInboxPwa handleSendProduct), and the server reads them the same way: no scope, or one it
// cannot honour, means the card is expanded into every colour of the product.
export const resolveCardSendScope = ({ card = {}, pickedScope = "" } = {}) => {
  const clean = (value) => String(value ?? "").trim();
  const hasColor = Boolean(clean(card.color));
  if (pickedScope === "color_size" && hasColor && clean(card.size)) return "color_size";
  if (pickedScope && hasColor) return "color";
  return "all_colors";
};

// Nothing ticked is not "nothing chosen": the product open in the colour/size chooser
// is what the operator is looking at, and its card is what the confirm button sends.
export const resolveSubmitBatch = ({ allowMultiple = false, selectedCards = [], activeCard = null } = {}) => {
  if (allowMultiple && Array.isArray(selectedCards) && selectedCards.length) return selectedCards;
  return activeCard ? [activeCard] : [];
};
