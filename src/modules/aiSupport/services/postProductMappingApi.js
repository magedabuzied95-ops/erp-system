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

export const getPostProductLinks = async ({ postId = "", platform = "", tenantId = "", postIdentity = null, timeoutMs = 15000 } = {}) => {
  const safeIdentity = postIdentity && typeof postIdentity === "object" ? postIdentity : {};
  const response = await api.get(`/social-comments/posts/${encodeURIComponent(clean(postId))}/product-links`, {
    params: {
      platform: clean(platform),
      tenant_id: clean(tenantId),
      post_link_key: clean(safeIdentity.post_link_key || ""),
      platform_post_id: clean(safeIdentity.platform_post_id || ""),
      source_post_id: clean(safeIdentity.source_post_id || ""),
      permalink_post_id: clean(safeIdentity.permalink_post_id || ""),
      canonical_post_id: clean(safeIdentity.canonical_post_id || ""),
      post_identity_post_id: clean(safeIdentity.post_id || ""),
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

export const savePostProductLinks = async ({ postId = "", platform = "", tenantId = "", productIds = [], primaryProductId = null, postIdentity = null, timeoutMs = 15000 } = {}) => {
  const safePostId = clean(postId);
  const safePlatform = clean(platform);
  const safeTenantId = clean(tenantId);
  const safeIdentity = postIdentity && typeof postIdentity === "object" ? postIdentity : {};
  const normalizedProductIds = Array.isArray(productIds)
    ? Array.from(new Set(productIds.map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0)))
    : [];
  console.info("PRODUCT_LINKS_API_SAVE_REQUEST", {
    postId: safePostId,
    platform: safePlatform,
    tenantId: safeTenantId,
    productIds: normalizedProductIds,
    primaryProductId,
  });
  try {
    const response = await api.put(
      `/social-comments/posts/${encodeURIComponent(safePostId)}/product-links`,
      {
        platform: safePlatform,
        tenant_id: safeTenantId,
        post_link_key: clean(safeIdentity.post_link_key || ""),
        product_ids: normalizedProductIds,
        primary_product_id: primaryProductId,
        ...(postIdentity && typeof postIdentity === "object" ? { post_identity: postIdentity } : {}),
      },
      { timeoutMs }
    );
    const data = unwrapObject(response);
    console.info("PRODUCT_LINKS_API_SAVE_RESPONSE", {
      postId: safePostId,
      platform: safePlatform,
      status: response?.__status ?? response?.status ?? 200,
      count: Number(data?.count || unwrapList(data).length || 0) || 0,
    });
    return {
      ...data,
      linked_products: unwrapList(data),
      primary_product: data?.primary_product || null,
      count: Number(data?.count || unwrapList(data).length || 0) || 0,
    };
  } catch (error) {
    console.error("PRODUCT_LINKS_API_SAVE_ERROR", {
      postId: safePostId,
      platform: safePlatform,
      status: error?.status || error?.responseBody?.status || null,
      message: error?.message || "Failed to save product links",
      responseBody: error?.responseBody || null,
    });
    throw error;
  }
};

export const removePostProductLink = async ({ postId = "", platform = "", tenantId = "", productId = null, postIdentity = null, timeoutMs = 15000 } = {}) => {
  const safeIdentity = postIdentity && typeof postIdentity === "object" ? postIdentity : {};
  const response = await api.delete(`/social-comments/posts/${encodeURIComponent(clean(postId))}/product-links`, {
    params: {
      platform: clean(platform),
      tenant_id: clean(tenantId),
      product_id: productId ?? "",
      post_link_key: clean(safeIdentity.post_link_key || ""),
      platform_post_id: clean(safeIdentity.platform_post_id || ""),
      source_post_id: clean(safeIdentity.source_post_id || ""),
      permalink_post_id: clean(safeIdentity.permalink_post_id || ""),
      canonical_post_id: clean(safeIdentity.canonical_post_id || ""),
      post_identity_post_id: clean(safeIdentity.post_id || ""),
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

export const searchStorefrontProducts = async ({
  query = "",
  offset = 0,
  limit = 20,
  gender = "",
  productType = "",
  brand = "",
  size = "",
  inStock = false,
  timeoutMs = 15000,
} = {}) => {
  const response = await api.get("/storefront/products/search", {
    params: {
      q: clean(query),
      offset: Math.max(0, Number(offset) || 0),
      limit: Math.max(1, Math.min(50, Number(limit) || 20)),
      ...(clean(gender) ? { gender: clean(gender) } : {}),
      ...(clean(productType) ? { product_type: clean(productType) } : {}),
      ...(clean(brand) ? { brand: clean(brand) } : {}),
      ...(clean(size) ? { size: clean(size) } : {}),
      ...(inStock ? { in_stock: 1 } : {}),
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
