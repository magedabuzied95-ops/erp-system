/**
 * The totals block a POS receipt prints from.
 *
 * `order` is whatever the till is printing: the server order merged with the
 * till's own figures after an online sale, the offline receipt snapshot, or an
 * invoice reloaded from Recent Operations. `order.totals` (when present) are the
 * till's own cart totals for that sale; `fallbackTotals` are the live cart's.
 *
 * The receipt prints item, invoice, coupon and loyalty discounts on separate
 * lines. On the server `orders.discount_amount` is all of them COMBINED, so it
 * must never be read as the invoice discount: an online receipt used to print
 * that combined figure on the invoice line while the item, coupon and loyalty
 * lines still printed from the till -- every discount appeared twice, and the
 * same cart printed differently online and offline. The invoice line comes from
 * the till's own invoice discount, else the server's `invoice_discount_amount`.
 */
const firstNumber = (...values) => {
  for (const value of values) {
    if (value === undefined || value === null || value === "") continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return 0;
};

export const resolveReceiptRenderTotals = (order = {}, fallbackTotals = {}) => {
  const source = order || {};
  const orderTotals = source.totals || {};
  const cartTotals = fallbackTotals || {};
  return {
    ...cartTotals,
    ...orderTotals,
    subtotal: firstNumber(source.subtotal, orderTotals.subtotal, cartTotals.subtotal),
    itemDiscountTotal: firstNumber(source.item_discount_total, orderTotals.itemDiscountTotal, cartTotals.itemDiscountTotal),
    invoiceDiscount: firstNumber(
      orderTotals.invoiceDiscount,
      source.invoice_discount_amount,
      source.invoice_discount,
      orderTotals.discount,
      cartTotals.invoiceDiscount
    ),
    couponDiscount: firstNumber(source.coupon_discount, orderTotals.couponDiscount, cartTotals.couponDiscount),
    loyaltyDiscount: firstNumber(source.loyalty_discount, orderTotals.loyaltyDiscount, cartTotals.loyaltyDiscount),
    serviceFee: firstNumber(source.service_fee, orderTotals.serviceFee, orderTotals.service, cartTotals.serviceFee),
    taxAmount: firstNumber(source.tax_amount, source.vat_amount, orderTotals.taxAmount, orderTotals.tax, cartTotals.taxAmount),
    total: firstNumber(source.total, orderTotals.total, cartTotals.total),
  };
};
