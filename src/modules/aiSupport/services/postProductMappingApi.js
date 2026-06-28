import { api } from "../../../shared/api/api";

const clean = (value = "") => String(value ?? "").trim();

const unwrapList = (payload) => {
  const candidate =
    payload?.linked_products ||
    payload?.data?.linked_products ||
    payload?.items ||
    payload?.data?.items ||
    payload?.products ||
    payload?.data?.products ||
    payload?.data ||
    payload ||
    [];
  return Array.isArray(candidate) ? candidate : [];
};

const unwrapObject = (payload) => payload?.data || payload || {};

export const getPostProductLinks = async ({ postId = "", platform = "", tenantId = "", timeoutMs = 15000 } = {}) => {
  const response = await api.get(`/social-comments/posts/${encodeURIComponent(clean(postId))}/product-links`, {
    params: {
      platform: clean(platform),
      tenant_id: clean(tenantId),
    },
    timeoutMs,
  });
  const data = unwrapObject(response);
  return {
    ...data,
    linked_products: unwrapList(data),
    primary_product: data?.primary_product || null,
    count: Number(data?.count || unwrapList(data).length || 0) || 0,
  };
};

export const savePostProductLinks = async ({ postId = "", platform = "", tenantId = "", productIds = [], primaryProductId = null, timeoutMs = 15000 } = {}) => {
  const response = await api.put(
    `/social-comments/posts/${encodeURIComponent(clean(postId))}/product-links`,
    {
      platform: clean(platform),
      tenant_id: clean(tenantId),
      product_ids: Array.isArray(productIds) ? productIds : [],
      primary_product_id: primaryProductId,
    },
    { timeoutMs }
  );
  const data = unwrapObject(response);
  return {
    ...data,
    linked_products: unwrapList(data),
    primary_product: data?.primary_product || null,
    count: Number(data?.count || unwrapList(data).length || 0) || 0,
  };
};

export const removePostProductLink = async ({ postId = "", platform = "", tenantId = "", productId = null, timeoutMs = 15000 } = {}) => {
  const response = await api.delete(`/social-comments/posts/${encodeURIComponent(clean(postId))}/product-links`, {
    params: {
      platform: clean(platform),
      tenant_id: clean(tenantId),
      product_id: productId ?? "",
    },
    timeoutMs,
  });
  const data = unwrapObject(response);
  return {
    ...data,
    linked_products: unwrapList(data),
    primary_product: data?.primary_product || null,
    count: Number(data?.count || unwrapList(data).length || 0) || 0,
  };
};

export const searchStorefrontProducts = async ({ query = "", offset = 0, limit = 20, timeoutMs = 15000 } = {}) => {
  const response = await api.get("/storefront/products/search", {
    params: {
      q: clean(query),
      offset: Math.max(0, Number(offset) || 0),
      limit: Math.max(1, Math.min(50, Number(limit) || 20)),
    },
    timeoutMs,
  });
  const data = unwrapObject(response);
  const items = Array.isArray(data?.items)
    ? data.items
    : Array.isArray(data?.products)
      ? data.products
      : Array.isArray(data?.data)
        ? data.data
        : Array.isArray(data)
          ? data
          : [];
  return {
    ...data,
    items,
    products: items,
  };
};
