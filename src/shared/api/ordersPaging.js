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

// How many pages after the first may be in flight together. The walk used to be
// strictly sequential, so a 1,200-order history cost three full round trips to
// the slowest query the API has before a single row was on screen.
export const ORDERS_PAGE_CONCURRENCY = 4;

const asOrdersArray = (payload) =>
  Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.orders)
      ? payload.orders
      : Array.isArray(payload?.data)
        ? payload.data
        : [];

const asCount = (payload) => {
  const raw = payload && typeof payload === "object"
    ? (payload.count ?? payload.total ?? payload.data?.count)
    : payload;
  const numeric = Number(raw);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
};

export const collectAllOrders = async (get, options = {}) => {
  const maxRows = Number(options.maxRows) > 0 ? Number(options.maxRows) : ORDERS_MAX_ROWS;
  const maxPages = Math.ceil(maxRows / ORDERS_PAGE_LIMIT) + 1;
  const concurrency = Math.max(1, Math.min(Number(options.concurrency) || ORDERS_PAGE_CONCURRENCY, 8));
  const onPage = typeof options.onPage === "function" ? options.onPage : null;
  const getCount = typeof options.getCount === "function" ? options.getCount : null;
  // The dashboard and the reports read rows, never item lines, and the lines are
  // by far the heaviest part of the response. Asking for them to be left out is
  // opt-in so every other caller keeps the payload it has today.
  const query = options.includeItems === false ? "&include_items=0" : "";

  const orders = [];
  const seen = new Set();
  let truncated = false;
  let ended = false;

  const fetchPage = async (page) => asOrdersArray(await get(`/orders?page=${page}&limit=${ORDERS_PAGE_LIMIT}${query}`));

  // Returns the rows this page contributed, and records why the walk should stop.
  const absorb = async (batch, page) => {
    const fresh = [];
    for (const order of batch) {
      // Offset paging re-reads the table per request, so an order created between
      // two pages shifts every later row down one and repeats a row we already
      // hold. Keying by id keeps that shift from duplicating invoices.
      const id = order?.id === undefined || order?.id === null ? "" : String(order.id);
      if (id && seen.has(id)) continue;
      if (id) seen.add(id);
      fresh.push(order);
    }
    orders.push(...fresh);

    // A short page is the end of the list.
    if (batch.length < ORDERS_PAGE_LIMIT) ended = true;
    // A full page that carried nothing new means the page cursor is not moving.
    // Without this the loop would spin forever against a server that ignores it.
    else if (!fresh.length) ended = true;
    else if (orders.length >= maxRows || page >= maxPages) {
      truncated = true;
      ended = true;
    }

    // The caller can paint each page as it lands instead of waiting for the last
    // one. Its failure must not lose rows that already arrived.
    if (onPage && fresh.length) await onPage(fresh, { page, orders });
  };

  // The count is only a hint for how many pages to ask for at once, so a server
  // that cannot answer it (or answers with soft-deleted rows counted in) costs
  // nothing beyond an extra empty page.
  const countPromise = getCount ? Promise.resolve().then(getCount).then(asCount).catch(() => null) : Promise.resolve(null);
  const [firstPage, counted] = await Promise.all([fetchPage(1), countPromise]);
  await absorb(firstPage, 1);

  const lastPageFromCount = counted === null
    ? null
    : Math.min(maxPages, Math.ceil(Math.min(counted, maxRows) / ORDERS_PAGE_LIMIT));

  let page = 2;
  while (!ended && page <= maxPages) {
    // Without a count there is nothing to say a second page exists, so the walk
    // stays one request at a time and only widens once it knows there is more.
    const remaining = lastPageFromCount === null ? 1 : Math.max(1, lastPageFromCount - page + 1);
    const width = Math.min(concurrency, remaining, maxPages - page + 1);
    const pages = Array.from({ length: width }, (_, index) => page + index);
    const batches = await Promise.all(pages.map((number) => fetchPage(number)));
    for (let index = 0; index < batches.length; index += 1) {
      if (ended) break;
      await absorb(batches[index], pages[index]);
    }
    page += width;
  }

  return { orders, truncated };
};
