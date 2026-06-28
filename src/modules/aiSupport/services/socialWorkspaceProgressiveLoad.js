const clean = (value = "") => String(value ?? "").trim();
const SOCIAL_WORKSPACE_CACHE_TTL_MS = 15000;

const workspaceCache = new Map();
const workspaceInflight = new Map();

export const socialWorkspaceCacheKey = ({ tenantId = "", postId = "", platform = "" } = {}) =>
  [clean(tenantId).toLowerCase(), clean(platform).toLowerCase(), clean(postId)].filter(Boolean).join(":");

export const readSocialWorkspaceCache = (cacheKey = "") => {
  const key = clean(cacheKey);
  if (!key) return null;
  const entry = workspaceCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    workspaceCache.delete(key);
    return null;
  }
  return entry.value;
};

export const primeSocialWorkspaceCache = (cacheKey = "", value = null) => {
  const key = clean(cacheKey);
  if (!key || !value) return;
  workspaceCache.set(key, {
    value,
    expiresAt: Date.now() + SOCIAL_WORKSPACE_CACHE_TTL_MS,
  });
};

export const prefetchSocialWorkspace = async ({ api, headers, tenantId = "", postId = "", platform = "" } = {}) => {
  const cacheKey = socialWorkspaceCacheKey({ tenantId, postId, platform });
  if (!cacheKey) return null;

  const cached = readSocialWorkspaceCache(cacheKey);
  if (cached) return cached;

  const inflight = workspaceInflight.get(cacheKey);
  if (inflight) return inflight;

  const request = (async () => {
    const params = {
      tenant_id: clean(tenantId),
      platform: clean(platform),
    };

    const [threadPayload, templatePayload] = await Promise.allSettled([
      api.get(`/social-comments/posts/${encodeURIComponent(postId)}/comments`, {
        params,
        headers,
      }),
      api.get(`/social-comments/posts/${encodeURIComponent(postId)}/template`, {
        params,
        headers,
      }),
    ]);

    const payload = {
      thread:
        threadPayload.status === "fulfilled"
          ? {
              post: threadPayload.value?.post || null,
              comments: Array.isArray(threadPayload.value?.comments) ? threadPayload.value.comments : [],
            }
          : null,
      template:
        templatePayload.status === "fulfilled"
          ? {
              template: templatePayload.value?.template || null,
            }
          : null,
    };

    primeSocialWorkspaceCache(cacheKey, payload);
    return payload;
  })().finally(() => {
    workspaceInflight.delete(cacheKey);
  });

  workspaceInflight.set(cacheKey, request);
  return request;
};

export const invalidateSocialWorkspaceCache = (cacheKey = "") => {
  const key = clean(cacheKey);
  if (!key) return;
  workspaceCache.delete(key);
  workspaceInflight.delete(key);
};

