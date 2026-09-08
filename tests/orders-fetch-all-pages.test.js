import test from "node:test";
import assert from "node:assert/strict";

const { collectAllOrders, ORDERS_PAGE_LIMIT } = await import("../src/shared/api/ordersPaging.js");

// The transport is injected, so these exercise the paging walk itself.
const fetchAllOrders = ({ get, ...options }) => collectAllOrders(get, options);

const rows = (from, count) =>
  Array.from({ length: count }, (_, i) => ({ id: from + i }));

// Serves `total` rows through the same offset paging the real endpoint uses.
const serverWith = (total, calls = []) => async (url) => {
  calls.push(url);
  const page = Number(new URL(url, "http://x").searchParams.get("page"));
  const offset = (page - 1) * ORDERS_PAGE_LIMIT;
  return rows(1 + offset, Math.max(0, Math.min(ORDERS_PAGE_LIMIT, total - offset)));
};

test("keeps paging past the first page instead of stopping at one response", async () => {
  const calls = [];
  const { orders, truncated } = await fetchAllOrders({ get: serverWith(1203, calls) });
  assert.equal(orders.length, 1203);
  assert.equal(truncated, false);
  assert.equal(calls.length, 3);
});

test("a single short page ends the walk", async () => {
  const calls = [];
  const { orders } = await fetchAllOrders({ get: serverWith(120, calls) });
  assert.equal(orders.length, 120);
  assert.equal(calls.length, 1);
});

test("an exact multiple of the page size still terminates", async () => {
  const calls = [];
  const { orders, truncated } = await fetchAllOrders({ get: serverWith(1000, calls) });
  assert.equal(orders.length, 1000);
  assert.equal(truncated, false);
  // Two full pages, then an empty third proves the list ended.
  assert.equal(calls.length, 3);
});

test("rows that shift between pages are not counted twice", async () => {
  // Page 2 repeats the last row of page 1, which is what a mid-walk insert does.
  const get = async (url) => {
    const page = Number(new URL(url, "http://x").searchParams.get("page"));
    if (page === 1) return rows(1, ORDERS_PAGE_LIMIT);
    if (page === 2) return rows(ORDERS_PAGE_LIMIT, 10);
    return [];
  };
  const { orders } = await fetchAllOrders({ get });
  assert.equal(orders.length, ORDERS_PAGE_LIMIT + 9);
  assert.equal(new Set(orders.map((o) => o.id)).size, orders.length);
});

test("a server that ignores the page cursor cannot spin the loop forever", async () => {
  let calls = 0;
  const get = async () => {
    calls += 1;
    return rows(1, ORDERS_PAGE_LIMIT);
  };
  const { orders } = await fetchAllOrders({ get });
  assert.equal(orders.length, ORDERS_PAGE_LIMIT);
  assert.equal(calls, 2);
});

test("a history past the cap is reported as truncated, never silently cut", async () => {
  const { orders, truncated } = await fetchAllOrders({
    get: serverWith(100000),
    maxRows: 1000,
  });
  assert.equal(orders.length, 1000);
  assert.equal(truncated, true);
});

// --- how the walk reaches the screen -----------------------------------------

test("each page is handed over as it lands, not held until the last one", async () => {
  const seenByPage = [];
  let resolveSecond;
  const secondPage = new Promise((resolve) => { resolveSecond = resolve; });
  const get = async (url) => {
    const page = Number(new URL(url, "http://x").searchParams.get("page"));
    if (page === 1) return rows(1, ORDERS_PAGE_LIMIT);
    if (page === 2) return secondPage;
    return [];
  };

  const walk = fetchAllOrders({
    get,
    onPage: (batch, meta) => { seenByPage.push([meta.page, batch.length]); },
  });

  // The first page is on screen while the second is still in flight.
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(seenByPage, [[1, ORDERS_PAGE_LIMIT]]);

  resolveSecond(rows(1 + ORDERS_PAGE_LIMIT, 7));
  await walk;
  assert.deepEqual(seenByPage, [[1, ORDERS_PAGE_LIMIT], [2, 7]]);
});

test("a page only hands over rows the caller has not been given yet", async () => {
  const handed = [];
  const get = async (url) => {
    const page = Number(new URL(url, "http://x").searchParams.get("page"));
    if (page === 1) return rows(1, ORDERS_PAGE_LIMIT);
    // Page 2 repeats the whole of page 1 and adds three of its own.
    if (page === 2) return [...rows(1, ORDERS_PAGE_LIMIT), ...rows(1 + ORDERS_PAGE_LIMIT, 3)];
    return [];
  };
  const { orders } = await fetchAllOrders({ get, onPage: (batch) => handed.push(...batch) });
  assert.equal(handed.length, ORDERS_PAGE_LIMIT + 3);
  assert.equal(orders.length, ORDERS_PAGE_LIMIT + 3);
});

test("a known total lets the pages after the first travel together", async () => {
  let inFlight = 0;
  let peak = 0;
  const calls = [];
  const get = async (url) => {
    calls.push(url);
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 5));
    inFlight -= 1;
    const page = Number(new URL(url, "http://x").searchParams.get("page"));
    const offset = (page - 1) * ORDERS_PAGE_LIMIT;
    return rows(1 + offset, Math.max(0, Math.min(ORDERS_PAGE_LIMIT, 1600 - offset)));
  };

  const { orders } = await fetchAllOrders({ get, getCount: async () => ({ count: 1600 }) });
  assert.equal(orders.length, 1600);
  // Page 1 alone, then 2, 3 and 4 in one wave: two round trips instead of four.
  assert.equal(peak, 3);
  assert.equal(calls.length, 4);
});

test("a count that cannot be read costs nothing but the parallel wave", async () => {
  const calls = [];
  const { orders } = await fetchAllOrders({
    get: serverWith(1203, calls),
    getCount: async () => { throw new Error("no permission"); },
  });
  assert.equal(orders.length, 1203);
  assert.equal(calls.length, 3);
});

test("the item lines are only left out when the caller asks", async () => {
  const calls = [];
  await fetchAllOrders({ get: serverWith(10, calls) });
  assert.equal(calls[0].includes("include_items"), false);

  const leanCalls = [];
  await fetchAllOrders({ get: serverWith(10, leanCalls), includeItems: false });
  assert.equal(leanCalls[0].includes("include_items=0"), true);
});
