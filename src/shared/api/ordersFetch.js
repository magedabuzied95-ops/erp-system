import { api } from "./api";
import { collectAllOrders } from "./ordersPaging";

export { ORDERS_PAGE_LIMIT, ORDERS_MAX_ROWS } from "./ordersPaging";

export const fetchAllOrders = (options = {}) =>
  collectAllOrders(
    typeof options.get === "function" ? options.get : (endpoint) => api.get(endpoint),
    options
  );
