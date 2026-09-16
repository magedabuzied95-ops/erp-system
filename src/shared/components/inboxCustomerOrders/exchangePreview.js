/*
 * The figures the staff member reads before pressing "استبدال". A preview only: the
 * server prorates the invoice discount out of the credit and prices the replacement from
 * the catalogue, so this must never be sent as the amount to charge - it exists so the
 * person in the conversation can tell the customer what to expect.
 */
const round = (value) => Math.round((Number(value) || 0) * 100) / 100;
const asArray = (value) => (Array.isArray(value) ? value : []);

export const previewExchangeMoney = ({ returning = [], replacement = [], shippingCost = 0 } = {}) => {
  const credit = asArray(returning).reduce(
    (sum, line) => sum + Number(line.unit_price || 0) * Number(line.selected || 0),
    0
  );
  const goods = asArray(replacement).reduce(
    (sum, line) => sum + Number(line.price || 0) * Number(line.quantity || 1),
    0
  );
  const total = goods + Number(shippingCost || 0);
  return {
    credit: round(credit),
    new_total: round(total),
    // The courier collects the difference and nothing else.
    collect_on_delivery: round(Math.max(0, total - credit)),
    // A cheaper replacement leaves store credit, never cash at the door.
    remaining_credit: round(Math.max(0, credit - total)),
  };
};
