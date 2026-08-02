import { api } from "../../shared/api/api";

const unwrap = (payload) =>
  payload?.data ??
  payload?.employees ??
  payload?.shifts ??
  payload?.attendance ??
  payload?.logs ??
  payload?.branches ??
  payload?.employee ??
  payload?.summary ??
  payload ??
  null;

const buildQuery = (params = {}) => {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    search.set(key, value);
  });
  const query = search.toString();
  return query ? `?${query}` : "";
};

const request = async (endpoint, params = {}) => unwrap(await api.get(`${endpoint}${buildQuery(params)}`));
const normalizeBranches = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.branches)) return payload.branches;
  return [];
};

const sessionExpiredError = (error) => {
  if (error?.status === 401 || error?.message === "Unauthorized") {
    const nextError = new Error("Session expired. Please login again.");
    nextError.status = 401;
    nextError.cause = error;
    throw nextError;
  }

  throw error;
};

export const getAttendanceEmployees = (params = {}) => request("/attendance/employees", params);
export const createAttendanceEmployee = (payload = {}) => api.post("/attendance/employees", payload);
export const updateAttendanceEmployee = (id, payload = {}) => api.put(`/attendance/employees/${id}`, payload);
export const deleteAttendanceEmployee = (id) => api.delete(`/attendance/employees/${id}`);
export const updateEmployeePayrollSettings = (employeeId, payload = {}) => api.patch(`/employees/${employeeId}/payroll-settings`, payload);
export const upsertSalesEmployeeProfile = (employeeId, payload = {}) => api.put(`/sales-employees/profiles/${employeeId}`, payload);
export const getBranches = async (params = {}) => {
  try {
    const payload = await api.get(`/branches${buildQuery(params)}`);
    return normalizeBranches(payload);
  } catch (error) {
    sessionExpiredError(error);
  }
};

export const getAttendanceEmployeeShifts = (employeeId, params = {}) => request(`/attendance/employees/${employeeId}/shifts`, params);
export const createAttendanceEmployeeShift = (employeeId, payload = {}) => api.post(`/attendance/employees/${employeeId}/shifts`, payload);
export const updateAttendanceShift = (id, payload = {}) => api.put(`/attendance/shifts/${id}`, payload);

export const checkInEmployee = (payload = {}) => api.post("/attendance/check-in", payload);
export const checkOutEmployee = (payload = {}) => api.post("/attendance/check-out", payload);
export const scanQrAttendance = async (payload = {}) => unwrap(await api.post("/attendance/qr-scan", payload));
export const getAttendanceDevices = (params = {}) => request("/attendance/devices", params);
export const getAttendanceDeviceSettings = () => request("/attendance/devices/settings");
export const updateAttendanceDeviceSettings = (payload = {}) => api.put("/attendance/devices/settings", payload);
export const getAttendanceHrSettings = () => request("/attendance/settings/hr");
export const updateAttendanceHrSettings = (payload = {}) => api.put("/attendance/settings/hr", payload);
export const approveAttendanceDevice = (id) => api.post(`/attendance/devices/${id}/approve`);
export const rejectAttendanceDevice = (id) => api.post(`/attendance/devices/${id}/reject`);
export const resetEmployeeAttendanceDevice = (employeeId) => api.post(`/attendance/employees/${employeeId}/reset-device`);
export const resetEmployeeTodayAttendance = (employeeId, payload = {}) =>
  api.delete(`/admin/attendance/employees/${employeeId}/today-attendance`, { body: payload });
export const saveManualAttendance = (payload = {}) => api.post("/admin/attendance/manual-entry", payload);
export const resetTodayAttendanceDeviceBindings = () => api.delete("/admin/attendance/device-bindings/today");
export const resetEmployeeAttendanceDeviceBindings = (employeeId, businessDate) =>
  api.delete("/admin/attendance/device-bindings/reset-device", {
    body: {
      employee_id: employeeId,
      business_date: businessDate,
    },
  });
export const resetAttendanceDeviceBindingByKey = (deviceKey) => api.delete("/admin/attendance/device-bindings/reset-device", { body: { device_key: deviceKey } });
export const resetAttendanceDeviceBinding = (device = {}) => {
  const bindingId = device.record_type === "binding" ? device.binding_id || device.id : device.binding_id;
  const body = bindingId
    ? { binding_id: bindingId }
    : device.device_key
      ? { device_key: device.device_key }
      : {
          employee_id: device.employee_id,
          employee_code: device.employee_code,
          business_date: device.business_date,
        };

  return api.delete("/admin/attendance/device-bindings/reset-device", { body });
};
export const resetAllAttendanceDeviceBindings = () => api.delete("/admin/attendance/device-bindings/all");

export const getDailyAttendanceReport = (params = {}) => request("/attendance/reports/daily", params);
export const getEmployeeAttendanceReport = (id, params = {}) => request(`/attendance/reports/employee/${id}`, params);
export const getBranchAttendanceReport = (params = {}) => request("/attendance/reports/branch", params);
export const getAttendanceKioskSnapshot = (params = {}) => request("/attendance/kiosk", params);
export const getAttendanceToday = (params = {}) => request("/attendance/today", params);
export const getAttendanceReports = (params = {}) => request("/attendance/reports", params);
export const getAttendanceDashboard = (params = {}) => request("/attendance/dashboard", params);
export const getAttendanceSchedules = (params = {}) => request("/attendance/schedules", params);
export const generateAttendanceOpeningSchedule = (payload = {}) => api.post("/attendance/schedules/opening/generate", payload);
export const getAttendanceList = (params = {}) => request("/attendance/list", params);
export const getAttendanceLive = (params = {}) => request("/attendance/live", params);
export const getAttendancePayrollImpact = (params = {}) => request("/attendance/payroll-impact", params);
export const getAttendanceOvertimeApprovals = (params = {}) => request("/attendance/overtime-approvals", params);
export const updateAttendanceOvertimeApproval = (id, payload = {}) => api.put(`/attendance/overtime-approvals/${id}`, payload);
export const getAttendanceCenterReports = (params = {}) => request("/attendance/center-reports", params);
export const getAttendanceLeaves = (params = {}) => request("/attendance/leaves", params);
export const getAttendanceQrSessions = (params = {}) => request("/attendance/qr-sessions", params);
export const getOpeningCandidates = (params = {}) => request("/shifts/opening-candidates", params);
export const getNextOpeningAssignment = (params = {}) => request("/shifts/next-opening", params);
export const getOpeningRotationReport = (params = {}) => request("/shifts/opening-rotation-report", params);
