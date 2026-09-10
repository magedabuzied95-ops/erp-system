import { api } from "../../../shared/api/api";

// Whether an employee may confirm / ship / print أوردرات الشحن from their portal.
export const getEmployeeOnlineOrdersAccess = (employeeId) =>
  api.get(`/employees/${encodeURIComponent(employeeId)}/online-orders-access`, { cache: "no-store" });

export const setEmployeeOnlineOrdersAccess = (employeeId, enabled) =>
  api.patch(`/employees/${encodeURIComponent(employeeId)}/online-orders-access`, { enabled: Boolean(enabled) });
