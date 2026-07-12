import { safeSetLocalStorage, safeSetSessionStorage } from "../../../utils/safeStorage.js";

const ACTIVE_SHIFT_STORAGE_KEY = "erp.pos.active_shift";
const isPosShiftCacheDebugEnabled = () =>
  Boolean(
    import.meta.env?.DEV ||
    String(import.meta.env?.VITE_POS_DEBUG || "").trim().toLowerCase() === "true" ||
    String(import.meta.env?.VITE_POS_OFFLINE_DEBUG || "").trim().toLowerCase() === "true"
  );

const logPosShiftCacheDebug = (event, payload = {}) => {
  if (!isPosShiftCacheDebugEnabled()) return;
  console.info(event, payload);
};

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
  return (
    message.includes("networkerror") ||
    message.includes("failed to fetch") ||
    message.includes("network request failed") ||
    message.includes("load failed") ||
    message.includes("aborted") ||
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("fetch") ||
    name === "typeerror" ||
    name === "aborterror" ||
    name === "timeouterror"
  );
};

export const validateCachedActivePosShiftForContext = (
  cachedShiftState,
  { currentUser = {}, resolvedPosBranchId = "", currentTenant = {} } = {}
) => {
  const shiftId = cachedShiftState?.shift?.id ?? cachedShiftState?.shift_id ?? null;
  if (!shiftId) {
    return { valid: false, reason: "missing_shift_id" };
  }

  const cachedUserId = String(cachedShiftState?.user_id ?? cachedShiftState?.cashier_user_id ?? "").trim();
  const currentUserId = String(currentUser?.id ?? "").trim();
  if (cachedUserId && currentUserId && cachedUserId !== currentUserId) {
    return { valid: false, reason: "user_mismatch" };
  }

  const cachedTenantId = String(cachedShiftState?.tenant_id ?? "").trim();
  const currentTenantId = String(currentTenant?.id ?? currentTenant?.tenant_id ?? "").trim();
  if (cachedTenantId && currentTenantId && cachedTenantId !== currentTenantId) {
    return { valid: false, reason: "tenant_mismatch" };
  }

  const currentBranchId = String(
    resolvedPosBranchId ||
      currentUser?.branch_id ||
      currentUser?.branchId ||
      currentUser?.default_branch_id ||
      currentUser?.defaultBranchId ||
      ""
  ).trim();
  const cachedBranchId = String(cachedShiftState?.branch_id ?? cachedShiftState?.shift?.branch_id ?? "").trim();
  if (currentBranchId && cachedBranchId && currentBranchId !== cachedBranchId) {
    return { valid: false, reason: "branch_mismatch" };
  }

  return { valid: true, reason: "ok" };
};

export const readCachedActivePosShift = () => {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(ACTIVE_SHIFT_STORAGE_KEY) || window.sessionStorage.getItem(ACTIVE_SHIFT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = normalizeCachedActivePosShift(JSON.parse(raw));
    if (parsed?.shift?.id) {
      logPosShiftCacheDebug("POS_SHIFT_CACHE_LOAD", {
        shift_id: parsed.shift.id,
        branch_id: parsed.branch_id ?? parsed.shift?.branch_id ?? null,
        user_id: parsed.user_id ?? parsed.cashier_user_id ?? null,
        tenant_id: parsed.tenant_id ?? null,
        cached_at: parsed.cached_at || null,
      });
    }
    return parsed;
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

  const localStored = safeSetLocalStorage(ACTIVE_SHIFT_STORAGE_KEY, record, { maxBytes: 32 * 1024 });
  const sessionStored = safeSetSessionStorage(ACTIVE_SHIFT_STORAGE_KEY, record, { maxBytes: 32 * 1024 });
  const saved = localStored || sessionStored;
  if (!saved) {
    logPosShiftCacheDebug("POS_SHIFT_CACHE_SAVE_FAILED", {
      shift_id: shiftId,
      branch_id: record.branch_id ?? null,
      user_id: record.user_id ?? null,
      tenant_id: record.tenant_id ?? null,
    });
    return false;
  }
  logPosShiftCacheDebug("POS_SHIFT_CACHE_SAVE", {
    shift_id: shiftId,
    branch_id: record.branch_id ?? null,
    user_id: record.user_id ?? null,
    tenant_id: record.tenant_id ?? null,
    cached_at: record.cached_at,
  });
  return true;
};

export const clearCachedActivePosShift = () => {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(ACTIVE_SHIFT_STORAGE_KEY);
  window.sessionStorage.removeItem(ACTIVE_SHIFT_STORAGE_KEY);
};
