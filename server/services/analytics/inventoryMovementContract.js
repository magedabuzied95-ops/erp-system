/**
 * What each inventory movement type means, traced through its write path.
 *
 * Every type was verified against the code that writes it and against production data
 * (R4 audit, 2026-08-11). Nothing here is inferred from a movement's name.
 *
 * The contract exists because "units sold" and "units that moved" are different
 * questions. An order edit, a stock count and a purchase correction all change stock
 * without a customer buying anything, and counting them as demand would make a
 * mis-keyed order look like a sale.
 */

export const MOVEMENT_SEMANTICS = Object.freeze({
  PURCHASE_IN: {
    trigger: "A purchase is received (routes/purchases.js)",
    meaning: "Stock arrives from a supplier",
    direction: "in",
    sign: "positive",
    economic: true,
    customerDemand: false,
    purchaseInflow: true,
    returnFlow: false,
    receiptEvent: true,
    reverses: null,
  },
  SALE_OUT: {
    trigger: "An order is confirmed (ordersController, storefrontController)",
    meaning: "A customer bought the unit",
    direction: "out",
    sign: "negative",
    economic: true,
    customerDemand: true,
    purchaseInflow: false,
    returnFlow: false,
    receiptEvent: false,
    reverses: null,
  },
  RETURN_IN: {
    trigger: "A customer return with disposition=restock",
    meaning: "A sold unit came back and is sellable again",
    direction: "in",
    sign: "positive",
    economic: true,
    // Demand is measured net of returns from order_items.returned_quantity, which is the
    // canonical source. Counting this movement as well would deduct the return twice.
    customerDemand: false,
    purchaseInflow: false,
    returnFlow: true,
    receiptEvent: false,
    reverses: "SALE_OUT",
  },
  SUPPLIER_RETURN_HOLD: {
    trigger: "A customer return with disposition=manufacturing_defect",
    meaning: "A defective unit is held for return to the supplier; ownership has not transferred",
    direction: "out",
    // Historically negative when correcting a prior restock; zero going forward, because
    // the unit already left stock at SALE_OUT and is only changing disposition.
    sign: "negative-or-zero",
    economic: true,
    customerDemand: false,
    purchaseInflow: false,
    returnFlow: false,
    receiptEvent: false,
    reverses: null,
  },
  COUNT_ADJUSTMENT: {
    trigger: "A stock count is applied (inventoryCountService, smartWarehouseService)",
    meaning: "Counted stock differs from recorded stock — shrinkage or a found unit",
    direction: "both",
    sign: "either",
    economic: true,
    customerDemand: false,
    purchaseInflow: false,
    returnFlow: false,
    receiptEvent: false,
    reverses: null,
  },
  ORDER_EDIT_DEDUCT: {
    trigger: "A line is added to an existing order (ordersController)",
    meaning: "Correction to an order that was already recorded",
    direction: "out",
    sign: "negative",
    economic: false,
    customerDemand: false,
    purchaseInflow: false,
    returnFlow: false,
    receiptEvent: false,
    reverses: "ORDER_EDIT_RESTORE",
  },
  ORDER_EDIT_RESTORE: {
    trigger: "A line is removed from an existing order (ordersController)",
    meaning: "Correction to an order that was already recorded",
    direction: "in",
    sign: "positive",
    economic: false,
    customerDemand: false,
    purchaseInflow: false,
    returnFlow: false,
    receiptEvent: false,
    reverses: "ORDER_EDIT_DEDUCT",
  },
  PURCHASE_EDIT_STOCK_IN: {
    trigger: "A received purchase line is edited upward (routes/purchases.js)",
    meaning: "Correction to a recorded receipt",
    direction: "in",
    sign: "positive",
    economic: false,
    customerDemand: false,
    purchaseInflow: true,
    returnFlow: false,
    // A correction to a receipt is not itself a new receipt: using it as a receipt date
    // would reset a product's apparent arrival to the day somebody fixed a typo.
    receiptEvent: false,
    reverses: "PURCHASE_IN",
  },
  PURCHASE_EDIT_STOCK_OUT: {
    trigger: "A received purchase line is edited downward (routes/purchases.js)",
    meaning: "Correction to a recorded receipt",
    direction: "out",
    sign: "negative",
    economic: false,
    customerDemand: false,
    purchaseInflow: true,
    returnFlow: false,
    receiptEvent: false,
    reverses: "PURCHASE_IN",
  },
});

export const KNOWN_MOVEMENT_TYPES = Object.freeze(Object.keys(MOVEMENT_SEMANTICS));

/**
 * Types that count as customer demand.
 *
 * Only SALE_OUT. Demand is otherwise measured from order_items, which nets returns via
 * returned_quantity — the same basis R2 and R3 use, so the three screens agree.
 */
export const DEMAND_MOVEMENT_TYPES = Object.freeze(
  KNOWN_MOVEMENT_TYPES.filter((type) => MOVEMENT_SEMANTICS[type].customerDemand)
);

/**
 * Types that establish when stock arrived.
 *
 * PURCHASE_IN only. Purchase edits adjust a receipt's quantity but are not themselves
 * an arrival, and treating them as one would make corrected stock look newer than it is.
 */
export const RECEIPT_MOVEMENT_TYPES = Object.freeze(
  KNOWN_MOVEMENT_TYPES.filter((type) => MOVEMENT_SEMANTICS[type].receiptEvent)
);

/** SQL-safe literal list, built from the allowlist rather than from a request. */
export const sqlTypeList = (types) => types.map((type) => `'${type}'`).join(", ");

/**
 * Movement types present in the data but absent from the contract.
 *
 * An unknown type must never be silently bucketed: it either represents demand or it
 * does not, and guessing would corrupt every velocity figure downstream. The caller
 * raises a warning and excludes it.
 */
export const unknownMovementTypes = (observed = []) =>
  [...new Set(observed.map((type) => String(type || "").trim().toUpperCase()).filter(Boolean))]
    .filter((type) => !MOVEMENT_SEMANTICS[type]);
