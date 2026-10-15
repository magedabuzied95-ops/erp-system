import db from "../../database/db.js";
import { DOZEN_PIECES } from "./wholesale.units.js";
import { ensureWholesaleSchema } from "./wholesale.schema.js";

// The wholesale customer's account: what they owe and why. Retail's statement mixes the
// loyalty wallet into the balance and ignores what was paid at the till, so wholesale keeps
// its own ledger over the same rows:
//   + every invoice of the customer (cash ones net to zero)
//   - what was paid at the till (payment_breakdown; credit, exchange and wallet legs excluded)
//   - customer payments (customer_payments)
//   - returns refunded to the customer's account (refund_method = wallet), sound or damaged
// A damaged return is credited like any return; it simply never goes back to stock.

const CANCELLED = ["cancelled", "canceled", "void", "voided"];
const NON_CASH_LEGS = ["credit_sale", "exchange_credit", "return_credit", "customer_wallet", "wallet"];
const round = (value) => Math.round((Number(value) || 0) * 100) / 100;
const text = (value) => String(value ?? "").trim();

/** 30 pieces of a model with carton 24 / series 6 -> "1 كرتونة + 1 سيرية". */
export const describeUnits = (pieces, settings = null) => {
  let left = Math.max(0, Math.trunc(Number(pieces) || 0));
  if (!settings || !left) return `${left} قطعة`;
  const parts = [];
  const take = (size, label) => {
    if (!size || size <= 1 || left < size) return;
    const count = Math.floor(left / size);
    left -= count * size;
    parts.push(`${count} ${label}`);
  };
  if (settings.sell_carton) take(Number(settings.carton_pieces), "كرتونة");
  if (settings.sell_series) take(Number(settings.series_pieces), "سيرية");
  if (settings.sell_dozen) take(DOZEN_PIECES, "دستة");
  if (left) parts.push(`${left} قطعة`);
  return parts.join(" + ");
};

const loadSettingsByProduct = async (client, tenantId, productIds) => {
  if (!productIds.length) return new Map();
  const { rows } = await client.query(
    `SELECT product_id, sell_series, series_pieces, sell_carton, carton_pieces, sell_dozen
       FROM wholesale_product_packs WHERE tenant_id = $1 AND product_id = ANY($2::bigint[])`,
    [tenantId, productIds]
  );
  return new Map(rows.map((row) => [Number(row.product_id), row]));
};

export const buildWholesaleStatement = async ({ tenantId, customerId, client = db }) => {
  await ensureWholesaleSchema();
  const { rows: [customer] } = await client.query(
    "SELECT id, name, phone FROM customers WHERE tenant_id = $1 AND id = $2",
    [tenantId, customerId]
  );
  if (!customer) throw Object.assign(new Error("العميل مش موجود"), { status: 404 });

  const { rows: orders } = await client.query(
    `SELECT o.id, COALESCE(o.invoice_number, 'ORD-' || o.id) AS invoice_number, o.created_at,
            COALESCE(o.total_amount, o.total, 0)::numeric AS total,
            LOWER(COALESCE(o.payment_method, '')) AS payment_method,
            COALESCE((
              SELECT SUM((entry->>'amount')::numeric)
                FROM jsonb_array_elements(COALESCE(o.payment_breakdown, '[]'::jsonb)) entry
               WHERE LOWER(COALESCE(entry->>'method', entry->>'payment_method', '')) <> ALL($3::text[])
            ), 0)::numeric AS paid_at_sale
       FROM orders o
      WHERE o.tenant_id = $1 AND o.customer_id = $2
        AND LOWER(COALESCE(o.status, '')) <> ALL($4::text[])
      ORDER BY o.created_at, o.id`,
    [tenantId, customerId, NON_CASH_LEGS, CANCELLED]
  );
  const orderIds = orders.map((o) => Number(o.id));

  const [{ rows: items }, { rows: payments }, { rows: returns }] = await Promise.all([
    orderIds.length
      ? client.query(
        `SELECT order_id, product_id, COALESCE(product_name, '') AS product_name, COALESCE(color, '') AS color,
                COALESCE(size, '') AS size, quantity, COALESCE(price, unit_price, 0) AS price,
                COALESCE(line_total, total_amount, quantity * price, 0) AS line_total
           FROM order_items WHERE order_id = ANY($1::bigint[]) ORDER BY order_id, id`,
        [orderIds]
      )
      : { rows: [] },
    client.query(
      `SELECT cp.id, cp.amount, cp.payment_method, cp.reference, cp.notes, cp.payment_date,
              s.image_url AS proof_url, s.method AS submitted_method
         FROM customer_payments cp
         LEFT JOIN wholesale_payment_submissions s ON s.tenant_id = cp.tenant_id AND s.customer_payment_id = cp.id
        WHERE cp.tenant_id = $1 AND cp.customer_id = $2
        ORDER BY cp.payment_date, cp.id`,
      [tenantId, customerId]
    ),
    orderIds.length
      ? client.query(
        `SELECT r.id, r.order_id, COALESCE(r.return_number, 'RET-' || r.id) AS return_number, r.created_at,
                COALESCE(r.refund_amount, 0) AS refund_amount, LOWER(COALESCE(r.refund_method, '')) AS refund_method,
                COALESCE(r.disposition, CASE WHEN r.restock THEN 'restock' ELSE 'damaged' END) AS disposition,
                COALESCE(r.reason, '') AS reason
           FROM returns r
          WHERE r.order_id = ANY($1::bigint[]) AND LOWER(COALESCE(r.status, '')) NOT IN ('cancelled', 'rejected')
          ORDER BY r.created_at, r.id`,
        [orderIds]
      )
      : { rows: [] },
  ]);

  const returnIds = returns.map((r) => Number(r.id));
  const { rows: returnItems } = returnIds.length
    ? await client.query(
      `SELECT ri.return_id, oi.product_id, COALESCE(oi.product_name, '') AS product_name, COALESCE(oi.color, '') AS color, ri.quantity
         FROM return_items ri JOIN order_items oi ON oi.id = ri.order_item_id
        WHERE ri.return_id = ANY($1::bigint[]) ORDER BY ri.return_id, ri.id`,
      [returnIds]
    )
    : { rows: [] };

  const productIds = [...new Set([...items, ...returnItems].map((row) => Number(row.product_id)).filter(Boolean))];
  const settings = await loadSettingsByProduct(client, tenantId, productIds);
  const groupLines = (rows) => {
    // One line per model + colour, its pieces described in the model's units.
    const map = new Map();
    for (const row of rows) {
      const key = `${row.product_id}|${row.color}`;
      const line = map.get(key) || { product_id: Number(row.product_id), product_name: row.product_name, color: row.color, pieces: 0, total: 0, price: Number(row.price || 0) };
      line.pieces += Number(row.quantity || 0);
      line.total = round(line.total + Number(row.line_total || 0));
      map.set(key, line);
    }
    return [...map.values()].map((line) => ({ ...line, units: describeUnits(line.pieces, settings.get(line.product_id)) }));
  };
  const itemsByOrder = new Map();
  for (const row of items) {
    if (!itemsByOrder.has(Number(row.order_id))) itemsByOrder.set(Number(row.order_id), []);
    itemsByOrder.get(Number(row.order_id)).push(row);
  }
  const itemsByReturn = new Map();
  for (const row of returnItems) {
    if (!itemsByReturn.has(Number(row.return_id))) itemsByReturn.set(Number(row.return_id), []);
    itemsByReturn.get(Number(row.return_id)).push(row);
  }
  const invoiceNumberOf = new Map(orders.map((o) => [Number(o.id), o.invoice_number]));

  const entries = [];
  for (const order of orders) {
    entries.push({
      type: "invoice",
      date: order.created_at,
      reference: order.invoice_number,
      order_id: Number(order.id),
      debit: round(order.total),
      credit: 0,
      lines: groupLines(itemsByOrder.get(Number(order.id)) || []),
    });
    if (Number(order.paid_at_sale) > 0.009) {
      entries.push({ type: "paid_at_sale", date: order.created_at, reference: order.invoice_number, order_id: Number(order.id), debit: 0, credit: round(order.paid_at_sale) });
    }
  }
  for (const payment of payments) {
    entries.push({
      type: "payment",
      date: payment.payment_date,
      reference: text(payment.reference) || `PAY-${payment.id}`,
      method: payment.submitted_method || payment.payment_method,
      notes: text(payment.notes),
      proof_url: payment.proof_url || null,
      debit: 0,
      credit: round(payment.amount),
    });
  }
  for (const ret of returns) {
    const toAccount = ret.refund_method === "wallet" || ret.refund_method === "customer_wallet";
    entries.push({
      type: ret.disposition === "restock" ? "return" : "return_damaged",
      date: ret.created_at,
      reference: ret.return_number,
      order_id: Number(ret.order_id),
      invoice: invoiceNumberOf.get(Number(ret.order_id)) || "",
      reason: ret.reason,
      refunded_in_cash: !toAccount,
      debit: 0,
      // A cash refund already went back to the customer; only an account refund lowers the debt.
      credit: toAccount ? round(ret.refund_amount) : 0,
      amount: round(ret.refund_amount),
      lines: groupLines((itemsByReturn.get(Number(ret.id)) || []).map((row) => ({ ...row, line_total: 0, price: 0 }))),
    });
  }

  const order = { invoice: 0, paid_at_sale: 1, payment: 2, return: 3, return_damaged: 3 };
  entries.sort((a, b) => (new Date(a.date) - new Date(b.date)) || (order[a.type] - order[b.type]));
  let balance = 0;
  for (const entry of entries) {
    balance = round(balance + entry.debit - entry.credit);
    entry.balance = balance;
  }
  const totals = entries.reduce((acc, e) => {
    acc.invoiced = round(acc.invoiced + e.debit);
    if (e.type === "payment" || e.type === "paid_at_sale") acc.paid = round(acc.paid + e.credit);
    if (e.type === "return" || e.type === "return_damaged") acc.returned = round(acc.returned + e.credit);
    return acc;
  }, { invoiced: 0, paid: 0, returned: 0 });

  return { customer: { id: Number(customer.id), name: customer.name, phone: customer.phone }, entries, totals, balance };
};
