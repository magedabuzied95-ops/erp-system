import { api } from "./api";
import { collectAllOrders } from "./ordersPaging";

export { ORDERS_PAGE_LIMIT, ORDERS_MAX_ROWS, ORDERS_PAGE_CONCURRENCY } from "./ordersPaging";

// A cheap COUNT tells the walk how many pages exist, so pages after the first can
// be asked for together instead of one slow round trip at a time. It is a hint
// only: a failure, or a count inflated by soft-deleted rows, just costs one more
// request, so it never blocks the list.
const countOrders = () => api.get("/orders/stats/count");

export const fetchAllOrders = (options = {}) =>
  collectAllOrders(
    typeof options.get === "function" ? options.get : (endpoint) => api.get(endpoint),
    { getCount: countOrders, ...options }
  );
