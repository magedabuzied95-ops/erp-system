import { api } from "../../../shared/api/api";

const unwrapArray = (payload, fallbackKey = "groups") => {
  const value =
    payload?.[fallbackKey] ??
    payload?.data ??
    payload?.result ??
    payload?.payload ??
    payload ??
    [];
  return Array.isArray(value) ? value : [];
};

const unwrapItem = (payload, fallbackKey = "group") =>
  payload?.[fallbackKey] ??
  payload?.data ??
  payload?.result ??
  payload?.payload ??
  payload ??
  null;

export const normalizeProductClassificationOption = (option = {}) => ({
  id: option.id,
  value: option.value,
  name_ar: option.name_ar,
  name_en: option.name_en,
  label_ar: option.label_ar,
  label_en: option.label_en,
  english_name: option.english_name,
  icon: option.icon,
  color: option.color,
  sort_order: option.sort_order,
  is_active: option.is_active,
});

export const normalizeProductClassificationGroup = (group = {}) => ({
  ...group,
  options: Array.isArray(group.options) ? group.options.map(normalizeProductClassificationOption) : [],
});

export const normalizeProductClassificationGroups = (groups = []) =>
  Array.isArray(groups) ? groups.map(normalizeProductClassificationGroup) : [];

export const normalizeClassificationOptionName = (value) =>
  String(value ?? "").trim().toLowerCase();

export const getClassificationOptionNames = (option = {}) =>
  [
    option.value,
    option.label_ar,
    option.label_en,
    option.name_ar,
    option.name_en,
    option.english_name,
    option.name,
    option.label,
  ]
    .map(normalizeClassificationOptionName)
    .filter(Boolean);

export const findMatchingClassificationOption = (options = [], candidate = {}) => {
  const candidateNames = new Set(getClassificationOptionNames(candidate));
  if (candidateNames.size === 0) return null;
  return (
    (Array.isArray(options) ? options : []).find((option) =>
      getClassificationOptionNames(option).some((name) => candidateNames.has(name))
    ) || null
  );
};

export const isDuplicateClassificationOptionError = (error) => {
  const message = String(error?.responseBody?.message || error?.message || "").toLowerCase();
  return error?.status === 400 && message.includes("classification option already exists");
};

const getClassificationParams = (options = {}) => {
  if (options.includeInactive) return { includeInactive: 1 };
  return {};
};

export const getProductClassifications = async (options = {}) => {
  const response = await api.get("/product-classifications", { params: getClassificationParams(options) });
  return normalizeProductClassificationGroups(unwrapArray(response));
};

// One answer for the whole tab. useProductClassifications mounts inside per-conversation
// components (the AI Inbox product picker is keyed by conversation), so without this every
// conversation switch re-fetched the same list — 450-1100ms on production, each time. Kept
// for a few minutes, shared in flight, and dropped by every mutation below; refresh() in the
// hook bypasses it.
const CLASSIFICATIONS_TTL_MS = 5 * 60 * 1000;
const classificationsCache = new Map();

export const peekCachedProductClassifications = (options = {}) => {
  const entry = classificationsCache.get(options.includeInactive ? "all" : "active");
  return entry?.groups && Date.now() - entry.at < CLASSIFICATIONS_TTL_MS ? entry.groups : null;
};

export const loadProductClassificationsShared = (options = {}, { force = false } = {}) => {
  const key = options.includeInactive ? "all" : "active";
  const entry = classificationsCache.get(key);
  if (!force && entry?.promise) return entry.promise;
  if (!force && entry?.groups && Date.now() - entry.at < CLASSIFICATIONS_TTL_MS) return Promise.resolve(entry.groups);
  const promise = api.get("/product-classifications", { params: getClassificationParams(options) })
    .then((response) => {
      const groups = normalizeProductClassificationGroups(response?.groups);
      if (classificationsCache.get(key)?.promise === promise) classificationsCache.set(key, { groups, at: Date.now() });
      return groups;
    })
    .catch((error) => {
      if (classificationsCache.get(key)?.promise === promise) classificationsCache.delete(key);
      throw error;
    });
  classificationsCache.set(key, { ...entry, promise });
  return promise;
};

export const invalidateProductClassificationsCache = () => classificationsCache.clear();

const invalidatingClassifications = (request) => async (...args) => {
  try {
    return await request(...args);
  } finally {
    invalidateProductClassificationsCache();
  }
};

export const getProductClassificationOptions = async (groupKey, options = {}) => {
  const response = await api.get(`/product-classifications/${encodeURIComponent(groupKey)}/options`, { params: getClassificationParams(options) });
  return unwrapArray(response, "options").map(normalizeProductClassificationOption);
};

export const createProductClassificationGroup = invalidatingClassifications(async (body) => unwrapItem(await api.post("/product-classifications/groups", body)));
export const updateProductClassificationGroup = invalidatingClassifications(async (id, body) => unwrapItem(await api.patch(`/product-classifications/groups/${id}`, body)));
export const deleteProductClassificationGroup = invalidatingClassifications(async (id) => api.delete(`/product-classifications/groups/${id}`));

export const createProductClassificationOption = invalidatingClassifications(async (body) =>
  unwrapItem(await api.post("/product-classifications/options", body, { suppressErrorStatuses: [400] }), "option"));
export const updateProductClassificationOption = invalidatingClassifications(async (id, body) => unwrapItem(await api.patch(`/product-classifications/options/${id}`, body)));
export const deactivateProductClassificationOption = invalidatingClassifications(async (id, body = {}) =>
  unwrapItem(await api.patch(`/product-classifications/options/${id}`, { ...body, is_active: false })));
export const deleteProductClassificationOption = invalidatingClassifications(async (id) => api.delete(`/product-classifications/options/${id}`));
