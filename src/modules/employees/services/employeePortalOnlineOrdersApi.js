import { api } from "../../../shared/api/api";

const tokenPath = (token) => `/employee-portal/${encodeURIComponent(token)}`;

export const getEmployeePortalOnlineOrders = (token, params = {}) =>
  api.get(`${tokenPath(token)}/online-orders`, {
    params,
    cache: "no-store",
    suppressErrorStatuses: [404, 422],
  });

export const runEmployeePortalOnlineOrderAction = (token, orderId, action) =>
  api.post(`${tokenPath(token)}/online-orders/${encodeURIComponent(orderId)}/actions/${encodeURIComponent(action)}`, {}, {
    suppressErrorStatuses: [400, 403, 404, 409, 422, 502],
  });

export const printEmployeePortalOnlineOrderLabels = (token, orderIds = []) =>
  api.post(`${tokenPath(token)}/online-orders/print-labels`, { order_ids: orderIds }, {
    suppressErrorStatuses: [400, 403, 404, 409, 422, 502],
  });

export const getEmployeePortalOnlineOrder = (token, orderId) =>
  api.get(`${tokenPath(token)}/online-orders/${encodeURIComponent(orderId)}`, {
    cache: "no-store",
    suppressErrorStatuses: [404, 422],
  });
