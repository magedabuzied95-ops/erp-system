import { api } from "../../../shared/api/api";

const tokenPath = (token) => `/employee-portal/${encodeURIComponent(token)}`;

export const getEmployeePortalOnlineOrders = (token, params = {}) =>
  api.get(`${tokenPath(token)}/online-orders`, {
    params,
    cache: "no-store",
    suppressErrorStatuses: [404, 422],
  });

export const getEmployeePortalOnlineOrder = (token, orderId) =>
  api.get(`${tokenPath(token)}/online-orders/${encodeURIComponent(orderId)}`, {
    cache: "no-store",
    suppressErrorStatuses: [404, 422],
  });
