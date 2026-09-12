import { adjustVariantStock } from "../services/inventoryService.js";

// Stock the owner adds in the product editor before any purchase invoice exists.
//
// The editor's quantity box is the planned purchase quantity (default_purchase_qty) —
// it is what lists a colour/size on the purchase invoice page. Raising it on a colour or
// size that has NO stock now also puts those units on the shelf at once, so the POS can
// sell them, while the planned quantity keeps the line on the purchase page.
//
// Those units are "provisional": not yet backed by an invoice. When a purchase invoice
// for that variant is posted, the invoice REPLACES them instead of adding on top — a
// settling movement takes back the part the invoice covers, so 5 added by hand + an
// invoice of 5 is 5 units, not 10. Deleting that invoice gives the settlement back.
//
// No schema: the ledger is inventory_movements itself. The pending (not yet invoiced)
// quantity of a variant is the signed sum of these three movement types.
export const PROVISIONAL_STOCK_IN = "PROVISIONAL_STOCK_IN";
export const PROVISIONAL_STOCK_SETTLED = "PROVISIONAL_STOCK_SETTLED";
export const PROVISIONAL_SETTLEMENT_REVERSED = "PROVISIONAL_SETTLEMENT_REVERSED";
// Lowering the quantity again takes back provisional units that no invoice covers yet.
export const PROVISIONAL_STOCK_REMOVED = "PROVISIONAL_STOCK_REMOVED";
export const PROVISIONAL_MOVEMENT_TYPES = [PROVISIONAL_STOCK_IN, PROVISIONAL_STOCK_SETTLED, PROVISIONAL_SETTLEMENT_REVERSED, PROVISIONAL_STOCK_REMOVED];

const toWholeQty = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
};

const positiveIds = (values = []) => [...new Set(
  values.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0)
)];

/**
 * Pure: which saved variants get provisional stock, and how much.
 *
 * A variant qualifies only when the save RAISED its planned quantity (an unrelated save
 * of a product whose planned quantities were already there must never mint stock) and it
 * has no stock right now. It receives the part of the new quantity that is not already
 * pending, so raising 5 to 8 on a sold-out, not-yet-invoiced size adds 3, not 8.
 */
export const planProvisionalStockAdds = ({ previousVariants = [], savedVariants = [], pendingByVariant = new Map() } = {}) => {
  const previousPlanned = new Map(
    previousVariants.map((variant) => [String(variant.id), toWholeQty(variant.default_purchase_qty)])
  );
  const plan = [];
  const seen = new Set();
  for (const variant of savedVariants) {
    const id = Number(variant?.id);
    if (!Number.isInteger(id) || id <= 0 || seen.has(id)) continue;
    seen.add(id);
    const nextPlanned = toWholeQty(variant.default_purchase_qty);
    const wasPlanned = previousPlanned.get(String(id)) ?? 0;
    if (nextPlanned <= wasPlanned) continue;
    if (Number(variant.stock || 0) > 0) continue;
    const pending = toWholeQty(pendingByVariant.get(id));
    const quantity = nextPlanned - pending;
    if (quantity <= 0) continue;
    plan.push({ variantId: id, productId: Number(variant.product_id) || null, quantity, color: variant.color || "", size: variant.size || "" });
  }
  return plan;
};

/**
 * Pure: the undo of the above. A save that LOWERS the planned quantity of a variant with
 * pending provisional units takes back the drop — never more than is pending above the new
 * quantity, and never more than is still on the shelf (sold units stay sold). Only a real
 * decrease in this save counts: a purchase invoice resets the planned quantity to 0 while
 * leaving part of a partly-invoiced batch pending, and a later unrelated save must not
 * read that as a removal.
 */
export const planProvisionalStockRemovals = ({ previousVariants = [], savedVariants = [], pendingByVariant = new Map() } = {}) => {
  const previousPlanned = new Map(
    previousVariants.map((variant) => [String(variant.id), toWholeQty(variant.default_purchase_qty)])
  );
  const plan = [];
  const seen = new Set();
  for (const variant of savedVariants) {
    const id = Number(variant?.id);
    if (!Number.isInteger(id) || id <= 0 || seen.has(id) || !previousPlanned.has(String(id))) continue;
    seen.add(id);
    const nextPlanned = toWholeQty(variant.default_purchase_qty);
    const wasPlanned = previousPlanned.get(String(id));
    if (nextPlanned >= wasPlanned) continue;
    const pending = toWholeQty(pendingByVariant.get(id));
    const quantity = Math.min(pending - nextPlanned, wasPlanned - nextPlanned, toWholeQty(variant.stock));
    if (quantity <= 0) continue;
    plan.push({ variantId: id, productId: Number(variant.product_id) || null, quantity, color: variant.color || "", size: variant.size || "" });
  }
  return plan;
};

/** Pure: how much of each purchased variant's quantity replaces pending provisional stock. */
export const planProvisionalSettlements = ({ items = [], pendingByVariant = new Map() } = {}) => {
  const purchasedByVariant = new Map();
  for (const item of items) {
    const variantId = Number(item?.variant_id ?? item?.variantId);
    const quantity = toWholeQty(item?.quantity ?? item?.qty);
    if (!Number.isInteger(variantId) || variantId <= 0 || quantity <= 0) continue;
    const current = purchasedByVariant.get(variantId) || { quantity: 0, productId: Number(item.product_id) || null };
    current.quantity += quantity;
    purchasedByVariant.set(variantId, current);
  }
  const plan = [];
  for (const [variantId, purchased] of purchasedByVariant.entries()) {
    const settled = Math.min(toWholeQty(pendingByVariant.get(variantId)), purchased.quantity);
    if (settled > 0) plan.push({ variantId, productId: purchased.productId, quantity: settled });
  }
  return plan;
};

export const loadPendingProvisionalQty = async (client, { tenantId = null, variantIds = [] } = {}) => {
  const ids = positiveIds(variantIds);
  const pending = new Map();
  if (!ids.length) return pending;
  const result = await client.query(
    `
    SELECT variant_id, COALESCE(SUM(quantity_change), 0)::int AS pending
    FROM inventory_movements
    WHERE variant_id = ANY($1::bigint[])
      AND movement_type = ANY($2::text[])
      AND undone_at IS NULL
      AND ($3::bigint IS NULL OR tenant_id = $3::bigint OR tenant_id IS NULL)
    GROUP BY variant_id
    `,
    [ids, PROVISIONAL_MOVEMENT_TYPES, tenantId]
  );
  for (const row of result.rows) pending.set(Number(row.variant_id), Math.max(0, Number(row.pending || 0)));
  return pending;
};

/** Product editor save: put provisional stock on the variants that qualify. Same transaction. */
export const applyProvisionalStockFromEditor = async (client, { tenantId = null, productId = null, userId = null, previousVariants = [], savedVariants = [] } = {}) => {
  const previousPlanned = new Map(previousVariants.map((variant) => [String(variant.id), toWholeQty(variant.default_purchase_qty)]));
  // Only rows whose planned quantity moved in this save can add or remove anything.
  const candidates = savedVariants.filter((variant) =>
    toWholeQty(variant?.default_purchase_qty) !== (previousPlanned.get(String(variant?.id)) ?? 0)
  );
  if (!candidates.length) return [];
  const pendingByVariant = await loadPendingProvisionalQty(client, { tenantId, variantIds: candidates.map((variant) => variant.id) });
  const applied = [];
  for (const entry of planProvisionalStockRemovals({ previousVariants, savedVariants: candidates, pendingByVariant })) {
    const result = await adjustVariantStock(client, {
      tenantId,
      variantId: entry.variantId,
      productId: entry.productId || productId,
      quantityChange: -entry.quantity,
      movementType: PROVISIONAL_STOCK_REMOVED,
      referenceType: "product_edit",
      referenceId: Number(productId) || null,
      reason: "Quantity lowered in the product editor before a purchase invoice",
      notes: `Provisional stock removed ${entry.color} / ${entry.size}`.trim(),
      createdBy: userId || null,
    });
    applied.push({ ...entry, quantity: -entry.quantity, quantityAfter: result?.quantityAfter ?? null });
  }
  const plan = planProvisionalStockAdds({ previousVariants, savedVariants: candidates, pendingByVariant });
  for (const entry of plan) {
    const result = await adjustVariantStock(client, {
      tenantId,
      variantId: entry.variantId,
      productId: entry.productId || productId,
      quantityChange: entry.quantity,
      movementType: PROVISIONAL_STOCK_IN,
      referenceType: "product_edit",
      referenceId: Number(productId) || null,
      reason: "Stock added in the product editor before a purchase invoice",
      notes: `Provisional stock ${entry.color} / ${entry.size}`.trim(),
      createdBy: userId || null,
    });
    applied.push({ ...entry, quantityAfter: result?.quantityAfter ?? null });
  }
  return applied;
};

/**
 * Purchase stock was just applied for `items`: take back the provisional units it covers.
 * Must run AFTER the purchase stock-in, in the same transaction — the settlement never
 * exceeds the invoice's own quantity, so the stock cannot go negative.
 */
export const settleProvisionalStockForPurchase = async (client, { tenantId = null, purchaseId = null, referenceType = "purchase", items = [], userId = null } = {}) => {
  const variantIds = items.map((item) => item?.variant_id ?? item?.variantId);
  const pendingByVariant = await loadPendingProvisionalQty(client, { tenantId, variantIds });
  if (!pendingByVariant.size) return [];
  const plan = planProvisionalSettlements({ items, pendingByVariant });
  for (const entry of plan) {
    await adjustVariantStock(client, {
      tenantId,
      variantId: entry.variantId,
      productId: entry.productId,
      quantityChange: -entry.quantity,
      movementType: PROVISIONAL_STOCK_SETTLED,
      referenceType,
      referenceId: Number(purchaseId) || null,
      reason: "Purchase invoice replaces stock added before it",
      notes: `Purchase ${purchaseId} covers ${entry.quantity} provisional unit(s)`,
      createdBy: userId || null,
    });
  }
  return plan;
};

/**
 * A received purchase is being reversed (deleted): give back what its settlements took,
 * BEFORE its stock-out, so the units return to provisional instead of vanishing — and put
 * them back on the purchase list, since no invoice covers them any more.
 */
const loadOpenSettlementRows = async (client, { tenantId = null, purchaseId = null } = {}) => {
  const id = Number(purchaseId);
  if (!Number.isInteger(id) || id <= 0) return [];
  const result = await client.query(
    `
    SELECT s.id, s.variant_id, s.product_id, ABS(s.quantity_change)::int AS quantity
    FROM inventory_movements s
    WHERE s.movement_type = $1
      AND s.reference_type IN ('purchase', 'purchase_adjustment')
      AND s.reference_id = $2
      AND s.undone_at IS NULL
      AND ($3::bigint IS NULL OR s.tenant_id = $3::bigint OR s.tenant_id IS NULL)
      AND NOT EXISTS (
        SELECT 1 FROM inventory_movements r
        WHERE r.movement_type = $4
          AND r.reference_type = 'provisional_settlement'
          AND r.reference_id = s.id
      )
    ORDER BY s.id ASC
    `,
    [PROVISIONAL_STOCK_SETTLED, id, tenantId, PROVISIONAL_SETTLEMENT_REVERSED]
  );
  return result.rows || [];
};

/**
 * Per variant, what reversing this purchase's settlements would put back. The delete
 * pre-check adds it to the available stock: an invoice that replaced 5 provisional units
 * left the shelf at 5, yet reversing it is still possible because the 5 come back first.
 */
export const loadOpenProvisionalSettlementsForPurchase = async (client, { tenantId = null, purchaseId = null } = {}) => {
  const byVariant = new Map();
  for (const row of await loadOpenSettlementRows(client, { tenantId, purchaseId })) {
    const variantId = Number(row.variant_id);
    byVariant.set(variantId, (byVariant.get(variantId) || 0) + toWholeQty(row.quantity));
  }
  return byVariant;
};

export const reverseProvisionalSettlementsForPurchase = async (client, { tenantId = null, purchaseId = null, userId = null } = {}) => {
  const id = Number(purchaseId);
  const rows = await loadOpenSettlementRows(client, { tenantId, purchaseId });
  const reversed = [];
  for (const row of rows) {
    const quantity = toWholeQty(row.quantity);
    if (!quantity) continue;
    try {
      await adjustVariantStock(client, {
        tenantId,
        variantId: row.variant_id,
        productId: row.product_id,
        quantityChange: quantity,
        movementType: PROVISIONAL_SETTLEMENT_REVERSED,
        referenceType: "provisional_settlement",
        referenceId: row.id,
        reason: "Purchase invoice reversed; its units are provisional again",
        notes: `Reversal of settlement #${row.id} (purchase ${id})`,
        createdBy: userId || null,
      });
    } catch (error) {
      // An archived colour cannot take stock back; that must not block deleting the invoice.
      if (Number(error?.status) === 404) continue;
      throw error;
    }
    reversed.push({ variantId: Number(row.variant_id), quantity });
  }
  if (reversed.length) {
    const pending = await loadPendingProvisionalQty(client, { tenantId, variantIds: reversed.map((entry) => entry.variantId) });
    for (const [variantId, quantity] of pending.entries()) {
      if (quantity <= 0) continue;
      await client.query(
        `
        UPDATE product_variants
        SET default_purchase_qty = GREATEST(COALESCE(default_purchase_qty, 0), $1)
        WHERE id = $2
          AND ($3::bigint IS NULL OR tenant_id = $3::bigint OR tenant_id IS NULL)
        `,
        [quantity, variantId, tenantId]
      );
    }
  }
  return reversed;
};
