import { api } from "../../../shared/api/api";

const tokenPath = (token) => `/employee-portal/${encodeURIComponent(token)}`;

export const getEmployeePortalOnlineOrders = (token, params = {}) =>
  api.get(`${tokenPath(token)}/online-orders`, {
    params,
    cache: "no-store",
    suppressErrorStatuses: [404, 422],
  });

export const runEmployeePortalOnlineOrderAction = (token, orderId, action, input = {}) =>
  api.post(`${tokenPath(token)}/online-orders/${encodeURIComponent(orderId)}/actions/${encodeURIComponent(action)}`, input || {}, {
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

// "+" on أوردرات الشحن: search the catalogue, price the draft, write the order.
export const employeePortalNewOrderApi = (token) => ({
  catalog: (query = "") => api.get(`${tokenPath(token)}/new-online-order/catalog`, { cache: "no-store", params: { q: query }, suppressErrorStatuses: [403, 404] }),
  preview: (body) => api.post(`${tokenPath(token)}/new-online-order/preview`, body, { suppressErrorStatuses: [400, 403, 404] }),
  create: (body) => api.post(`${tokenPath(token)}/new-online-order`, body, { suppressErrorStatuses: [400, 403, 404, 409] }),
});

// طلب بيك أب — book / cancel a Bosta courier to the shop.
export const employeePortalPickupsApi = (token) => ({
  load: () => api.get(`${tokenPath(token)}/bosta-pickups`, { cache: "no-store", suppressErrorStatuses: [400, 404, 422, 502] }),
  create: (body) => api.post(`${tokenPath(token)}/bosta-pickups`, body, { suppressErrorStatuses: [400, 404, 422, 502] }),
  cancel: (pickupId) => api.delete(`${tokenPath(token)}/bosta-pickups/${encodeURIComponent(pickupId)}`, { suppressErrorStatuses: [400, 404, 422, 502] }),
});
