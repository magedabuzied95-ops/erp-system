import { api } from "../../../shared/api/api";

const unwrapArray = (payload) =>
  Array.isArray(payload?.data)
    ? payload.data
    : Array.isArray(payload?.timeline)
      ? payload.timeline
      : Array.isArray(payload?.posts)
      ? payload.posts
      : Array.isArray(payload?.campaigns)
        ? payload.campaigns
        : Array.isArray(payload?.suggestions)
          ? payload.suggestions
          : Array.isArray(payload)
            ? payload
            : [];

const unwrapItem = (payload) => payload?.campaign ?? payload?.data ?? payload?.post ?? payload?.template ?? payload?.settings ?? payload ?? null;

const logMarketingApiError = (endpointName, endpoint, payload, error) => {
  if (typeof console === "undefined") return;
  console.error("[marketing-api] request failed", {
    endpointName,
    endpoint,
    status: error?.status ?? error?.response?.status ?? null,
    responseBody: error?.responseBody ?? error?.response?.data ?? null,
    requestPayload: payload ?? null,
    message: error?.message || "Request failed",
  });
};

const withMarketingApiLogging = async (endpointName, endpoint, payload, callback) => {
  try {
    return await callback();
  } catch (error) {
    logMarketingApiError(endpointName, endpoint, payload, error);
    throw error;
  }
};

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
export const getAutonomousAiMarketingSettings = async () => unwrapItem(await api.get("/marketing/ai-center/settings"));
export const updateAutonomousAiMarketingSettings = async (body) => unwrapItem(await api.patch("/marketing/ai-center/settings", body));
export const getAutonomousAiMarketingOverview = async () => unwrapItem(await api.get("/marketing/ai-center/overview"));
export const getStoryAutopilot = async () => api.get("/marketing/ai-center/story-autopilot");
export const updateStoryAutopilot = async (body) => api.patch("/marketing/ai-center/story-autopilot", body);
export const getStoryAutopilotSuggestions = async (count) =>
  api.get(`/marketing/ai-center/story-autopilot/suggestions${count ? `?count=${encodeURIComponent(count)}` : ""}`);
export const applyStoryAutopilotSuggestions = async (count) =>
  api.post("/marketing/ai-center/story-autopilot/suggestions/apply", count ? { count } : {});
export const runStoryAutopilotNow = async () => api.post("/marketing/ai-center/story-autopilot/run-now", {});
export const getAutonomousAiMarketingQueue = async (params = {}, options = {}) => {
  const query = new URLSearchParams();
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim() !== "") query.set(key, value);
  });
  const suffix = query.toString() ? `?${query.toString()}` : "";
  const payload = await api.get(`/marketing/ai-center/queue${suffix}`, options);
  return Array.isArray(payload?.queue) ? payload.queue : unwrapArray(payload);
};
export const generateAutonomousAiMarketingDaily = async () => api.post("/marketing/ai-center/generate/daily", {});
export const generateAutonomousAiMarketingWeekly = async () => api.post("/marketing/ai-center/generate/weekly", {});
export const generateAutonomousAiMarketingMonthly = async () => api.post("/marketing/ai-center/generate/monthly", {});
export const generateAutonomousAiMarketingVideosDaily = async (body = {}) => api.post("/marketing/ai-center/videos/generate/daily", body);
export const generateAutonomousAiMarketingVideosWeekly = async (body = {}) => api.post("/marketing/ai-center/videos/generate/weekly", body);
export const generateAutonomousAiMarketingVideosMonthly = async (body = {}) => api.post("/marketing/ai-center/videos/generate/monthly", body);
export const syncAutonomousAiMarketingInsights = async () => unwrapItem(await api.post("/marketing/ai-center/insights/sync", {}));
export const approveAutonomousAiMarketingQueueItem = async (id) => unwrapItem(await api.post(`/marketing/ai-center/queue/${id}/approve`, {}));
export const generateAutonomousAiMarketingQueueStoryAsset = async (id) =>
  api.post(`/marketing/ai-center/queue/${id}/generate-story-asset`, { force: true });
export const publishAutonomousAiMarketingQueueItemNow = async (id) => unwrapItem(await api.post(`/marketing/ai-center/queue/${id}/publish-now`, {}));
export const archiveAutonomousAiMarketingQueueItem = async (id) => unwrapItem(await api.post(`/marketing/ai-center/queue/${id}/archive`, {}));
export const restoreAutonomousAiMarketingQueueItem = async (id) => unwrapItem(await api.post(`/marketing/ai-center/queue/${id}/restore`, {}));
export const duplicateAutonomousAiMarketingQueueItem = async (id) => unwrapItem(await api.post(`/marketing/ai-center/queue/${id}/duplicate`, {}));
export const bulkAutonomousAiMarketingQueueAction = async (body) => unwrapItem(await api.post("/marketing/ai-center/queue/bulk", body));
export const getAutonomousAiMarketingQueueTimeline = async (id) => unwrapArray(await api.get(`/marketing/ai-center/queue/${id}/timeline`));
export const deleteAutonomousAiMarketingQueueItem = async (id) => {
  try {
    const payload = await api.delete(`/marketing/ai-center/queue/${id}`, { suppressErrorStatuses: [404] });
    return { status: 200, payload };
  } catch (error) {
    if (Number(error?.status) === 404) {
      return { status: 404, payload: error.responseBody || null, stale: true };
    }
    throw error;
  }
};
export const pauseAutonomousAiMarketing = async () => unwrapItem(await api.post("/marketing/ai-center/pause", {}));
export const resumeAutonomousAiMarketing = async () => unwrapItem(await api.post("/marketing/ai-center/resume", {}));
export const getAiMarketingSuggestions = async (options = {}) => unwrapArray(await api.get("/marketing/ai-center/suggestions", options));
export const getAiMarketingDrafts = async (params = {}, options = {}) => {
  const query = new URLSearchParams();
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim() !== "") query.set(key, value);
  });
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return unwrapArray(await api.get(`/marketing/ai-center/drafts${suffix}`, options));
};
export const createAiMarketingDraft = async (body) => unwrapItem(await api.post("/marketing/ai-center/drafts", body));
export const updateAiMarketingDraft = async (id, body) => unwrapItem(await api.patch(`/marketing/ai-center/drafts/${id}`, body));
export const approveAiMarketingDraft = async (id) => unwrapItem(await api.post(`/marketing/ai-center/drafts/${id}/approve`, {}));
export const rejectAiMarketingDraft = async (id) => unwrapItem(await api.post(`/marketing/ai-center/drafts/${id}/reject`, {}));
export const scheduleAiMarketingDraft = async (id, body) => unwrapItem(await api.post(`/marketing/ai-center/drafts/${id}/schedule`, body));
export const publishNowAiMarketingDraft = async (id) => unwrapItem(await api.post(`/marketing/ai-center/drafts/${id}/publish-now`, {}));
export const generateAiMarketingWeeklyPack = async (body) => api.post("/marketing/ai-center/generate-weekly-pack", body);
export const getAiMarketingAutomationSettings = async () => unwrapItem(await api.get("/marketing/ai-center/automation-settings"));
export const getAiMarketingAutomationLogs = async (params = {}, options = {}) => {
  const query = new URLSearchParams();
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim() !== "") query.set(key, value);
  });
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return unwrapArray(await api.get(`/marketing/ai-center/automation-logs${suffix}`, options));
};
export const getAiMarketingBrandIdentity = async () => unwrapItem(await api.get("/marketing/ai-center/brand-identity"));
export const updateAiMarketingBrandIdentity = async (body) => unwrapItem(await api.put("/marketing/ai-center/brand-identity", body));
export const updateAiMarketingAutomationSettings = async (body) => unwrapItem(await api.put("/marketing/ai-center/automation-settings", body));
export const runAiMarketingAutomationNow = async () => api.post("/marketing/ai-center/run-automation-now", {});
export const runAiMarketingAutoPublishNow = async () => api.post("/marketing/ai-center/auto-publish/run-now", {});
export const generateStoryCampaign = async (body) =>
  withMarketingApiLogging("generateStoryCampaign", "POST /api/marketing/story-campaigns/generate", body, async () =>
    unwrapItem(await api.post("/marketing/story-campaigns/generate", body, { debugLabel: "generateStoryCampaign" }))
  );
export const getStoryCampaigns = async (params = {}, options = {}) => {
  const query = new URLSearchParams();
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim() !== "") query.set(key, value);
  });
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return unwrapArray(await api.get(`/marketing/story-campaigns${suffix}`, options));
};
export const getStoryCampaign = async (id) => unwrapItem(await api.get(`/marketing/story-campaigns/${id}`));
export const updateStoryCampaign = async (id, body) => unwrapItem(await api.patch(`/marketing/story-campaigns/${id}`, body));
export const deleteStoryCampaign = async (id) => api.delete(`/marketing/story-campaigns/${id}`);
export const createStoryCampaignExport = async (campaignId, body) => unwrapItem(await api.post(`/marketing/story-campaigns/${campaignId}/exports`, body));
export const getStoryCampaignExports = async (campaignId) => unwrapArray(await api.get(`/marketing/story-campaigns/${campaignId}/exports`));
export const getStoryTriggerSuggestions = async (options = {}) =>
  withMarketingApiLogging("getStoryTriggerSuggestions", "GET /api/marketing/story-triggers/suggestions", null, async () =>
    unwrapArray(await api.get("/marketing/story-triggers/suggestions", { ...options, debugLabel: "getStoryTriggerSuggestions" }))
  );
export const refreshStoryTriggerSuggestions = async () =>
  withMarketingApiLogging("refreshStoryTriggerSuggestions", "POST /api/marketing/story-triggers/refresh", {}, async () =>
    api.post("/marketing/story-triggers/refresh", {}, { debugLabel: "refreshStoryTriggerSuggestions" })
  );
export const generateStoryCampaignFromTrigger = async (id) =>
  withMarketingApiLogging("generateStoryCampaignFromTrigger", `POST /api/marketing/story-triggers/${id}/generate-campaign`, {}, async () =>
    unwrapItem(await api.post(`/marketing/story-triggers/${id}/generate-campaign`, {}, { debugLabel: "generateStoryCampaignFromTrigger" }))
  );
export const dismissStoryTriggerSuggestion = async (id) => unwrapItem(await api.patch(`/marketing/story-triggers/${id}/dismiss`, {}));

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

export const getSocialPublisherPosts = async (params = {}, options = {}) => {
  const query = new URLSearchParams();
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      query.set(key, value);
    }
  });
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return unwrapArray(await api.get(`/social-publisher/posts${suffix}`, options));
};
export const getSocialPublisherProducts = async (params = {}, options = {}) => {
  const query = new URLSearchParams();
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      query.set(key, value);
    }
  });
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return unwrapArray(await api.get(`/social-publisher/products/search${suffix}`, options));
};
export const getSocialPublisherMetaAccounts = async (options = {}) => unwrapItem(await api.get("/social-publisher/meta-accounts", options));
export const createSocialPublisherPost = async (body) => unwrapItem(await api.post("/social-publisher/posts", body));
export const publishSocialPublisherPost = async (id) => unwrapItem(await api.post(`/social-publisher/posts/${id}/publish`, {}));

// Same endpoint, full envelope. unwrapItem() collapses the response to `data`
// (the post row), which drops the sibling `tiktok_result` the composer needs to
// start status tracking. Kept as a separate export so every existing caller of
// publishSocialPublisherPost keeps its current return shape.
//
// NOTE: `api` resolves to the parsed response body itself, not an axios-style
// { data } wrapper — so the envelope IS the return value and must not be
// unwrapped again.
export const publishSocialPublisherPostDetailed = async (id) =>
  (await api.post(`/social-publisher/posts/${id}/publish`, {})) ?? null;

export const getTikTokPublishStatus = async (jobId) =>
  (await api.get(`/tiktok/publish/${jobId}/status`))?.data ?? null;

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
export const getMetaIntegrationStatus = async (options = {}) => api.get("/integrations/meta/status", options);
export const saveInstagramBusinessAccessToken = async (body = {}) =>
  api.post("/integrations/meta/instagram/access-token", body);
export const removeInstagramBusinessAccessToken = async () =>
  api.delete("/integrations/meta/instagram/access-token");
export const saveInstagramAppSecret = async (body = {}) =>
  api.post("/integrations/meta/instagram/app-secret", body);
export const removeInstagramAppSecret = async () =>
  api.delete("/integrations/meta/instagram/app-secret");
export const getMetaHealth = async (options = {}) => unwrapItem(await api.get("/meta/health", options));
export const getMetaCapabilities = async (options = {}) => unwrapItem(await api.get("/meta/capabilities", options));
export const getMetaWebhookHealth = async (options = {}) => unwrapItem(await api.get("/meta/webhook-health", options));
export const getMetaWebhookSelfTest = async (options = {}) => api.get("/meta/webhook-self-test", options);
export const enableMetaWebhookSubscription = async (body = {}, options = {}) => api.post("/meta/webhook-enable", body, options);
export const testMetaMessage = async (body = {}) => unwrapItem(await api.post("/meta/test-message", body));
export const testMetaPublish = async (body = {}) => unwrapItem(await api.post("/meta/test-publish", body));
export const getMetaSetupCheck = async (options = {}) => unwrapItem(await api.get("/meta/setup-check", options));
export const startMetaOAuth = async () => unwrapItem(await api.get("/meta/oauth/start?mode=json"));
export const getMetaOAuthPages = async (options = {}) => unwrapItem(await api.get("/meta/oauth/pages", options));
export const selectMetaOAuthPage = async (body = {}) => unwrapItem(await api.post("/meta/oauth/select-page", body));
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
