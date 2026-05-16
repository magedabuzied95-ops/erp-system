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

export const getProductClassificationOptions = async (groupKey, options = {}) => {
  const response = await api.get(`/product-classifications/${encodeURIComponent(groupKey)}/options`, { params: getClassificationParams(options) });
  return unwrapArray(response, "options").map(normalizeProductClassificationOption);
};

export const createProductClassificationGroup = async (body) => unwrapItem(await api.post("/product-classifications/groups", body));
export const updateProductClassificationGroup = async (id, body) => unwrapItem(await api.patch(`/product-classifications/groups/${id}`, body));
export const deleteProductClassificationGroup = async (id) => api.delete(`/product-classifications/groups/${id}`);

export const createProductClassificationOption = async (body) =>
  unwrapItem(await api.post("/product-classifications/options", body, { suppressErrorStatuses: [400] }), "option");
export const updateProductClassificationOption = async (id, body) => unwrapItem(await api.patch(`/product-classifications/options/${id}`, body));
export const deactivateProductClassificationOption = async (id, body = {}) =>
  unwrapItem(await api.patch(`/product-classifications/options/${id}`, { ...body, is_active: false }));
export const deleteProductClassificationOption = async (id) => api.delete(`/product-classifications/options/${id}`);
