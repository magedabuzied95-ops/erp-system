const text = (value = "") => String(value ?? "").trim();
const lower = (value = "") => text(value).toLowerCase();
const objectValue = (value = {}) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});
const normalizePlatform = (value = "") => (lower(value).includes("instagram") ? "instagram" : "facebook");
const extractPermalinkPostId = (value = "") => {
  const permalink = text(value);
  if (!permalink) return "";
  const patterns = [
    /facebook\.com\/[^/]+\/posts\/(\d+)/i,
    /facebook\.com\/[^/]+\/videos\/(\d+)/i,
    /facebook\.com\/photo\.php\?(?:[^#&]*&)*fbid=(\d+)/i,
    /facebook\.com\/permalink\.php\?(?:[^#&]*&)*story_fbid=(\d+)/i,
    /facebook\.com\/story\.php\?(?:[^#&]*&)*story_fbid=(\d+)/i,
    /facebook\.com\/watch\/\?v=(\d+)/i,
  ];
  for (const pattern of patterns) {
    const match = permalink.match(pattern);
    if (match?.[1]) return text(match[1]);
  }
  return "";
};

export const resolveSocialPostLinkKey = (inputPost = {}) => {
  const post = objectValue(inputPost);
  const metadata = objectValue(post.metadata);
  const raw = objectValue(post.raw || post.raw_payload);
  const rawValue = objectValue(raw.value || {});
  const platform = normalizePlatform(post.platform || metadata.platform || raw.platform || "");
  const businessId = Number(post.business_id || post.tenant_id || metadata.business_id || metadata.tenant_id || 0) || null;
  const explicitPostLinkKey = text(
    post.post_link_key ||
    post.postLinkKey ||
    metadata.post_link_key ||
    metadata.postLinkKey ||
    raw.post_link_key ||
    raw.postLinkKey ||
    rawValue.post_link_key ||
    rawValue.postLinkKey ||
    ""
  );
  const canonicalPostId = text(
    post.canonical_post_id ||
    post.final_canonical_post_id ||
    metadata.canonical_post_id ||
    metadata.final_canonical_post_id ||
    post.post_id ||
    post.platform_post_id ||
    metadata.post_id ||
    metadata.platform_post_id ||
    post.source_post_id ||
    raw.post_id ||
    raw.platform_post_id ||
    raw.source_post_id ||
    rawValue.post_id ||
    rawValue.platform_post_id ||
    rawValue.source_post_id ||
    ""
  );
  const platformPostId = text(
    post.platform_post_id ||
    post.platformPostId ||
    metadata.platform_post_id ||
    raw.platform_post_id ||
    rawValue.platform_post_id ||
    post.post_id ||
    post.source_post_id ||
    ""
  );
  const sourcePostId = text(
    post.source_post_id ||
    post.sourcePostId ||
    metadata.source_post_id ||
    raw.source_post_id ||
    rawValue.source_post_id ||
    post.post_id ||
    ""
  );
  const permalinkPostId = text(
    post.permalink_post_id ||
    post.permalinkPostId ||
    metadata.permalink_post_id ||
    raw.permalink_post_id ||
    rawValue.permalink_post_id ||
    extractPermalinkPostId(post.permalink_url || post.post_permalink_url || metadata.permalink_url || metadata.post_permalink_url || raw.permalink_url || raw.post_permalink_url || "")
  );
  const objectId = text(post.object_id || metadata.object_id || raw.object_id || rawValue.object_id || "");
  const postId = text(
    explicitPostLinkKey ||
    canonicalPostId ||
    (platform === "facebook" ? canonicalPostId : "") ||
    platformPostId ||
    sourcePostId ||
    permalinkPostId ||
    objectId ||
    post.post_id ||
    metadata.post_id ||
    ""
  );
  const postLinkKey = text(explicitPostLinkKey || postId || canonicalPostId || platformPostId || sourcePostId || permalinkPostId || objectId);
  const permalinkUrl = text(post.permalink_url || post.post_permalink_url || metadata.permalink_url || metadata.post_permalink_url || raw.permalink_url || raw.post_permalink_url || "");
  const confidenceReasons = [];
  if (explicitPostLinkKey) confidenceReasons.push("explicit_post_link_key");
  if (canonicalPostId) confidenceReasons.push("canonical_post_id");
  if (platformPostId) confidenceReasons.push("platform_post_id");
  if (sourcePostId) confidenceReasons.push("source_post_id");
  if (permalinkPostId) confidenceReasons.push("permalink_post_id");
  if (objectId) confidenceReasons.push("object_id");
  const confidence = explicitPostLinkKey ? "high" : canonicalPostId ? "high" : platformPostId || sourcePostId || permalinkPostId ? "medium" : "low";
  const identity = {
    post_link_key: postLinkKey,
    product_link_key: postLinkKey,
    business_id: businessId,
    platform,
    post_id: postId,
    canonical_post_id: canonicalPostId,
    platform_post_id: platformPostId,
    source_post_id: sourcePostId,
    permalink_post_id: permalinkPostId,
    object_id: objectId,
    permalink_url: permalinkUrl,
    confidence,
    reasons: confidenceReasons,
  };
  console.info("SOCIAL_PRODUCT_LINK_IDENTITY_RESOLVE_TRACE", {
    input_ids: {
      post_link_key: text(post.post_link_key || post.postLinkKey || ""),
      post_id: text(post.post_id || ""),
      canonical_post_id: text(post.canonical_post_id || ""),
      platform_post_id: text(post.platform_post_id || ""),
      source_post_id: text(post.source_post_id || ""),
      permalink_post_id: text(post.permalink_post_id || ""),
      object_id: text(post.object_id || ""),
      conversation_id: text(post.conversation_id || ""),
    },
    post_link_key: identity.post_link_key,
    business_id: identity.business_id,
    platform: identity.platform,
    post_id: identity.post_id,
    canonical_post_id: identity.canonical_post_id,
    platform_post_id: identity.platform_post_id,
    source_post_id: identity.source_post_id,
    permalink_post_id: identity.permalink_post_id,
    object_id: identity.object_id,
    permalink_url: identity.permalink_url,
    confidence: identity.confidence,
    reasons: identity.reasons,
  });
  return identity;
};

export const resolveSocialPostProductLinkIdentity = resolveSocialPostLinkKey;
