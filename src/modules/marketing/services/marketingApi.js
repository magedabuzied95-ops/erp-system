import { api } from "../../../shared/api/api";

const unwrapArray = (payload) =>
  Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.posts) ? payload.posts : Array.isArray(payload) ? payload : [];

const unwrapItem = (payload) => payload?.data ?? payload?.post ?? payload?.campaign ?? payload?.template ?? payload?.settings ?? payload ?? null;

const unique = (items = []) => Array.from(new Set(items.map((item) => String(item || "").trim()).filter(Boolean)));

const parseGallery = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
};

const imageFromGalleryItem = (item) => {
  if (!item) return "";
  if (typeof item === "string") return item;
  return item.url || item.image_url || item.image || item.path || "";
};

export const getMarketingDashboard = async (options = {}) => unwrapItem(await api.get("/marketing/dashboard", options));

export const getMarketingCampaigns = async (options = {}) => unwrapArray(await api.get("/marketing/campaigns", options));
export const createMarketingCampaign = async (body) => unwrapItem(await api.post("/marketing/campaigns", body));
export const updateMarketingCampaign = async (id, body) => unwrapItem(await api.put(`/marketing/campaigns/${id}`, body));
export const deleteMarketingCampaign = async (id) => api.delete(`/marketing/campaigns/${id}`);

export const getMarketingTemplates = async (options = {}) => unwrapArray(await api.get("/marketing/templates", options));
export const createMarketingTemplate = async (body) => unwrapItem(await api.post("/marketing/templates", body));
export const updateMarketingTemplate = async (id, body) => unwrapItem(await api.put(`/marketing/templates/${id}`, body));
export const deleteMarketingTemplate = async (id) => api.delete(`/marketing/templates/${id}`);

export const getMarketingPosts = async (params = {}, options = {}) => {
  const query = new URLSearchParams();
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      query.set(key, value);
    }
  });
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return unwrapArray(await api.get(`/marketing/posts${suffix}`, options));
};

export const getMarketingPost = async (id) => unwrapItem(await api.get(`/marketing/posts/${id}`));
export const createMarketingPost = async (body) => unwrapItem(await api.post("/marketing/posts", body));
export const updateMarketingPost = async (id, body) => unwrapItem(await api.put(`/marketing/posts/${id}`, body));
export const deleteMarketingPost = async (id) => api.delete(`/marketing/posts/${id}`);

export const generateProductMarketingPost = async (productId) => {
  const payload = await api.post(`/marketing/generate-product-post/${productId}`);
  const post = unwrapItem(payload);
  const product = payload?.product || {};
  const variants = Array.isArray(payload?.variants) ? payload.variants : [];
  const mediaUrls = unique([
    ...(Array.isArray(post?.media_urls) ? post.media_urls : []),
    ...variants.flatMap((variant) => [variant?.image_url, variant?.variant_image_url, variant?.color_image_url, variant?.image, variant?.photo_url, variant?.thumbnail_url]),
    ...variants.flatMap((variant) => parseGallery(variant?.gallery_images).map(imageFromGalleryItem)),
    ...variants.flatMap((variant) => parseGallery(variant?.images).map(imageFromGalleryItem)),
    ...variants.flatMap((variant) => parseGallery(variant?.media_urls).map(imageFromGalleryItem)),
  ]);

  return {
    ...post,
    product,
    variants,
    media_urls: mediaUrls,
  };
};
export const publishMarketingPost = async (postId) => unwrapItem(await api.post(`/marketing/publish/${postId}`, {}));
export const testFacebookPublish = async (body = { message: "Test post from ERP" }) => unwrapItem(await api.post("/marketing/test-facebook-publish", body));
export const scheduleMarketingPost = async (postId, body) => unwrapItem(await api.post(`/marketing/schedule/${postId}`, body));
export const publishStoryEverywhere = async (postId, body = {}) => unwrapItem(await api.post(`/marketing/story/publish/${postId}`, body));
export const scheduleStoryEverywhere = async (postId, body) => unwrapItem(await api.post(`/marketing/story/schedule/${postId}`, body));
export const publishProductStoryEverywhere = async (productId, body = {}) => unwrapItem(await api.post(`/marketing/story/publish-product/${productId}`, body));
export const scheduleProductStoryEverywhere = async (productId, body) => unwrapItem(await api.post(`/marketing/story/schedule-product/${productId}`, body));

export const getMarketingSettings = async () => {
  try {
    return unwrapItem(await api.get("/marketing/settings"));
  } catch (error) {
    if (Number(error?.status || error?.responseBody?.status) === 403) {
      console.warn("[marketing] settings fetch skipped due to permission denial");
      return null;
    }
    throw error;
  }
};
export const updateMarketingSettings = async (body) => unwrapItem(await api.put("/marketing/settings", body));
export const refreshMarketingMetaTokens = async (body = {}) => unwrapItem(await api.post("/marketing/settings/refresh-tokens", body));
export const testMarketingAutoRefresh = async (body = {}) => api.post("/marketing/settings/test-auto-refresh", body);
export const getCommentDmRules = async (options = {}) => unwrapArray(await api.get("/marketing/comment-dm/rules", options));
export const createCommentDmRule = async (body) => unwrapItem(await api.post("/marketing/comment-dm/rules", body));
export const updateCommentDmRule = async (id, body) => unwrapItem(await api.put(`/marketing/comment-dm/rules/${id}`, body));
export const deleteCommentDmRule = async (id) => api.delete(`/marketing/comment-dm/rules/${id}`);
export const testCommentDmRule = async (id, body = {}) => unwrapItem(await api.post(`/marketing/comment-dm/rules/${id}/test`, body));
export const getCommentDmLogs = async (options = {}) => unwrapArray(await api.get("/marketing/comment-dm/logs", options));
export const processCommentDmAutomation = async (body = {}) => unwrapItem(await api.post("/marketing/comment-dm/process-comment", body));

export const getAutoReplyRules = async (options = {}) => unwrapArray(await api.get("/marketing/automation/rules", options));
export const createAutoReplyRule = async (body) => unwrapItem(await api.post("/marketing/automation/rules", body));
export const updateAutoReplyRule = async (id, body) => unwrapItem(await api.put(`/marketing/automation/rules/${id}`, body));
export const deleteAutoReplyRule = async (id) => api.delete(`/marketing/automation/rules/${id}`);
export const getCommentEvents = async (options = {}) => unwrapArray(await api.get("/marketing/automation/comment-events", options));
export const getMarketingConversations = async (options = {}) => unwrapArray(await api.get("/marketing/automation/conversations", options));
export const getMetaWebhookStatus = async (options = {}) => unwrapItem(await api.get("/marketing/automation/webhook-status", options));
export const simulateMarketingComment = async (body = {}) => unwrapItem(await api.post("/marketing/automation/simulate-comment", body));

export const getMarketingAnalytics = async (params = {}, options = {}) => {
  const query = new URLSearchParams();
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      query.set(key, value);
    }
  });
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return unwrapItem(await api.get(`/marketing/analytics${suffix}`, options));
};

export const syncMarketingAnalytics = async (body = {}) => unwrapItem(await api.post("/marketing/analytics/sync", body));

export const getMarketingAttribution = async (params = {}, options = {}) => {
  const query = new URLSearchParams();
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      query.set(key, value);
    }
  });
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return unwrapItem(await api.get(`/marketing/attribution${suffix}`, options));
};

export const syncMarketingAttribution = async (body = {}) => unwrapItem(await api.post("/marketing/attribution/sync", body));
