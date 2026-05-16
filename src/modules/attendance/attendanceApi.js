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

export const getDailyAttendanceReport = (params = {}) => request("/attendance/reports/daily", params);
export const getEmployeeAttendanceReport = (id, params = {}) => request(`/attendance/reports/employee/${id}`, params);
export const getBranchAttendanceReport = (params = {}) => request("/attendance/reports/branch", params);
export const getAttendanceKioskSnapshot = (params = {}) => request("/attendance/kiosk", params);
export const getAttendanceToday = (params = {}) => request("/attendance/today", params);
export const getAttendanceReports = (params = {}) => request("/attendance/reports", params);
export const getOpeningCandidates = (params = {}) => request("/shifts/opening-candidates", params);
export const getNextOpeningAssignment = (params = {}) => request("/shifts/next-opening", params);
export const getOpeningRotationReport = (params = {}) => request("/shifts/opening-rotation-report", params);
