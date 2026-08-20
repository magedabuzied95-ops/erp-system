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
