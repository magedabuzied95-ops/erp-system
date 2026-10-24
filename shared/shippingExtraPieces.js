// The zone's shipping price covers ONE piece. Each further piece adds `perPiece`, up to
// `maxExtraPieces` of them (0 = no cap): with 10 and 2, one piece pays the zone price, two pay
// +10, three and more pay +20. A free zone (price 0) stays free — there is nothing to add to.
// Free shipping (threshold or coupon) waives the whole fee, surcharge included; callers apply
// that after this.

const count = (value, fallback = 0) => {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

export const countShippingPieces = (items = []) =>
  (Array.isArray(items) ? items : []).reduce((sum, item) => sum + Math.max(1, count(item?.quantity ?? item?.qty, 1)), 0);

export const extraPiecesShippingFee = ({ basePrice = 0, pieces = 1, perPiece = 0, maxExtraPieces = 0 } = {}) => {
  const fee = Math.max(0, Number(perPiece) || 0);
  if (!(Number(basePrice) > 0) || !(fee > 0)) return 0;
  const extra = Math.max(0, count(pieces, 1) - 1);
  const cap = count(maxExtraPieces, 0);
  return (cap > 0 ? Math.min(extra, cap) : extra) * fee;
};
