// Pure paging walk over the orders list endpoint, kept free of imports so it can
// be exercised directly. The transport is injected; see ordersFetch.js for the
// binding the app uses.

// The orders list endpoint caps every response at 500 rows and returns a bare
// array with no "has more" marker, so a full page is the only signal that
// another one exists. Paging until a short page comes back is what makes the
// dashboard show every invoice instead of only the newest 250.
export const ORDERS_PAGE_LIMIT = 500;

// A hard stop, so a long history can never turn one page load into an unbounded
// download. Reaching it is reported back to the caller and surfaced in the UI —
// the whole point of this helper is that truncation stops being invisible.
export const ORDERS_MAX_ROWS = 5000;

const asOrdersArray = (payload) =>
  Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.orders)
      ? payload.orders
      : Array.isArray(payload?.data)
        ? payload.data
        : [];

export const collectAllOrders = async (get, options = {}) => {
  const maxRows = Number(options.maxRows) > 0 ? Number(options.maxRows) : ORDERS_MAX_ROWS;
  const maxPages = Math.ceil(maxRows / ORDERS_PAGE_LIMIT) + 1;

  const orders = [];
  const seen = new Set();
  let page = 1;
  let truncated = false;

  for (;;) {
    const batch = asOrdersArray(await get(`/orders?page=${page}&limit=${ORDERS_PAGE_LIMIT}`));
    let added = 0;

    for (const order of batch) {
      // Offset paging re-reads the table per request, so an order created between
      // two pages shifts every later row down one and repeats a row we already
      // hold. Keying by id keeps that shift from duplicating invoices.
      const id = order?.id === undefined || order?.id === null ? "" : String(order.id);
      if (id && seen.has(id)) continue;
      if (id) seen.add(id);
      orders.push(order);
      added += 1;
    }

    // A short page is the end of the list.
    if (batch.length < ORDERS_PAGE_LIMIT) break;
    // A full page that carried nothing new means the page cursor is not moving.
    // Without this the loop would spin forever against a server that ignores it.
    if (added === 0) break;
    if (orders.length >= maxRows || page >= maxPages) {
      truncated = true;
      break;
    }
    page += 1;
  }

  return { orders, truncated };
};
