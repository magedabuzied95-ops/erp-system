import { safeSetLocalStorage, safeSetSessionStorage } from "../../../utils/safeStorage.js";

const ACTIVE_SHIFT_STORAGE_KEY = "erp.pos.active_shift";

const normalizeCachedActivePosShift = (value = {}) => {
  if (!value || typeof value !== "object") return null;

  const rawShift = value.shift && typeof value.shift === "object" ? value.shift : null;
  const shift = rawShift || (value.id || value.shift_id ? value : null);
  if (!shift || (!shift.id && !shift.shift_id)) return null;

  const normalizedShift = rawShift || {
    ...shift,
    id: shift.id ?? shift.shift_id ?? null,
  };

  const normalizedBranch = value.branch && typeof value.branch === "object" ? value.branch : null;
  const branchId = value.branch_id ?? normalizedBranch?.id ?? normalizedShift.branch_id ?? null;
  const userId = value.user_id ?? value.cashier_user_id ?? normalizedShift.user_id ?? normalizedShift.cashier_user_id ?? normalizedShift.cashier_id ?? null;

  return {
    ...value,
    shift: normalizedShift,
    branch: normalizedBranch,
    shift_id: value.shift_id ?? normalizedShift.id ?? normalizedShift.shift_id ?? null,
    branch_id: branchId,
    user_id: userId,
    cashier_user_id: value.cashier_user_id ?? userId ?? null,
    tenant_id: value.tenant_id ?? normalizedShift.tenant_id ?? null,
    opened_at: value.opened_at ?? normalizedShift.opened_at ?? null,
    opening_cash: value.opening_cash ?? normalizedShift.opening_cash ?? null,
    cached_at: value.cached_at || "",
  };
};

export const isPosOfflineNetworkError = (error) => {
  if (!error) return false;
  if (error.status !== undefined && error.status !== null) return false;

  const message = String(error?.message || error?.cause?.message || "").toLowerCase();
  const name = String(error?.name || error?.cause?.name || "").toLowerCase();

  if (!message && !name) return false;
  if (name === "aborterror" || name === "timeouterror") return false;

  return (
    message.includes("networkerror") ||
    message.includes("failed to fetch") ||
    message.includes("network request failed") ||
    message.includes("load failed") ||
    message.includes("fetch") ||
    name === "typeerror"
  );
};

export const readCachedActivePosShift = () => {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(ACTIVE_SHIFT_STORAGE_KEY) || window.sessionStorage.getItem(ACTIVE_SHIFT_STORAGE_KEY);
    if (!raw) return null;
    return normalizeCachedActivePosShift(JSON.parse(raw));
  } catch {
    return null;
  }
};

export const writeCachedActivePosShift = ({ shift, branch, currentUser } = {}) => {
  if (typeof window === "undefined") return false;
  if (!shift || typeof shift !== "object") return false;

  const shiftId = shift.id ?? shift.shift_id ?? null;
  if (!shiftId) return false;

  const userId = currentUser?.id ?? shift.user_id ?? shift.cashier_user_id ?? shift.cashier_id ?? null;
  const tenantId = currentUser?.tenant_id ?? shift.tenant_id ?? null;
  const normalizedBranch = branch && typeof branch === "object" ? branch : null;
  const cachedShift = {
    ...shift,
    id: shiftId,
  };
  const record = {
    shift: cachedShift,
    branch: normalizedBranch,
    shift_id: shiftId,
    branch_id: cachedShift.branch_id ?? normalizedBranch?.id ?? null,
    user_id: userId ?? null,
    cashier_user_id: userId ?? null,
    tenant_id: tenantId ?? null,
    opened_at: cachedShift.opened_at ?? null,
    opening_cash: cachedShift.opening_cash ?? null,
    cached_at: new Date().toISOString(),
  };

  safeSetLocalStorage(ACTIVE_SHIFT_STORAGE_KEY, record, { maxBytes: 32 * 1024 });
  safeSetSessionStorage(ACTIVE_SHIFT_STORAGE_KEY, record, { maxBytes: 32 * 1024 });
  return true;
};

export const clearCachedActivePosShift = () => {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(ACTIVE_SHIFT_STORAGE_KEY);
  window.sessionStorage.removeItem(ACTIVE_SHIFT_STORAGE_KEY);
};
