const CASHIER_ROLES = new Set(["cashier", "pos cashier", "كاشير"]);

export const normalizePosRole = (user = {}) =>
  String(user?.role || user?.role_name || "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");

export const canManagePosSalePrices = (user = {}) =>
  !CASHIER_ROLES.has(normalizePosRole(user));
