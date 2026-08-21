const GRAPH_API_VERSION = "v25.0";
const GRAPH_API_BASE_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

import process from "node:process";
import crypto from "node:crypto";
import { validateMetaToken } from "./metaTokenService.js";
import { getStoryImageMetadata, isGeneratedStoryImageUrl } from "./storyImageService.js";
import {
  isGraphRateLimitError,
  noteGraphResponse,
  runGraphRequest,
  getMetaGraphBudgetSnapshot,
} from "./metaGraphRateLimiter.js";

const trimString = (value) => String(value || "").trim();
const trimSlashes = (value = "") => String(value).replace(/^\/+|\/+$/g, "");

const getPublicBackendUrl = () => trimString(process.env.PUBLIC_BACKEND_URL).replace(/\/+$/g, "");

const toPublicUploadUrl = (value) => {
  const imageUrl = trimString(value);
  if (!imageUrl) return "";
  if (/^https?:\/\//i.test(imageUrl)) return imageUrl;

  const publicBackendUrl = getPublicBackendUrl();
  if (!publicBackendUrl) return imageUrl;

  if (imageUrl.startsWith("/uploads/") || imageUrl.startsWith("uploads/")) {
    return `${publicBackendUrl}/${trimSlashes(imageUrl)}`;
  }
  if (imageUrl.startsWith("products/") || imageUrl.startsWith("/products/")) {
    return `${publicBackendUrl}/uploads/${trimSlashes(imageUrl)}`;
  }
  return imageUrl;
};

const isPrivateHostname = (hostname = "") => {
  const host = hostname.toLowerCase();
  if (!host || host === "localhost" || host === "0.0.0.0" || host === "::1") return true;
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)) return true;
  const private172 = host.match(/^172\.(\d+)\./);
  return private172 ? Number(private172[1]) >= 16 && Number(private172[1]) <= 31 : false;
};

const isPublicHttpsUrl = (value) => {
  const imageUrl = trimString(value);
  if (!imageUrl) return false;
  try {
    const parsed = new URL(imageUrl);
    return parsed.protocol === "https:" && !isPrivateHostname(parsed.hostname);
  } catch {
    return false;
  }
};

const parseMetaResponse = async (response) => {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
};

const getMetaErrorMessage = (payload, fallback = "Meta Graph API request failed") => {
  if (payload?.error?.message) return payload.error.message;
  if (payload?.error) return JSON.stringify(payload.error);
  if (payload?.message) return payload.message;
  return fallback;
};

const parseMediaUrls = (value) => {
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

const uniqueList = (items = []) => Array.from(new Set(items.map(trimString).filter(Boolean)));

const getStoryImageCandidate = (story = {}) => {
  const rawCandidates = uniqueList([story.assetUrl, story.image_url, ...parseMediaUrls(story.media_urls)]);
  const generatedCandidates = rawCandidates.filter(isGeneratedStoryImageUrl);
  if (shouldRequireGeneratedStoryAsset(story) && generatedCandidates.length) {
    const candidates = generatedCandidates.map((raw) => ({ raw, publicUrl: toPublicUploadUrl(raw) }));
    return candidates.find((item) => isPublicHttpsUrl(item.publicUrl)) || { raw: "", publicUrl: "" };
  }
  if (shouldRequireGeneratedStoryAsset(story)) return { raw: "", publicUrl: "" };
  const orderedCandidates = generatedCandidates.length ? [...generatedCandidates, ...rawCandidates.filter((item) => !isGeneratedStoryImageUrl(item))] : rawCandidates;
  const candidates = orderedCandidates.map((raw) => ({ raw, publicUrl: toPublicUploadUrl(raw) }));
  return candidates.find((item) => isPublicHttpsUrl(item.publicUrl)) || { raw: "", publicUrl: "" };
};

const getStoryImageCandidates = (story = {}) => {
  const rawCandidates = uniqueList([story.assetUrl, story.image_url, ...parseMediaUrls(story.media_urls)]);
  const generatedCandidates = rawCandidates.filter(isGeneratedStoryImageUrl);
  if (shouldRequireGeneratedStoryAsset(story)) {
    return generatedCandidates
      .map((raw) => ({ raw, publicUrl: toPublicUploadUrl(raw) }))
      .filter((item) => isPublicHttpsUrl(item.publicUrl));
  }
  const orderedCandidates = generatedCandidates.length ? [...generatedCandidates, ...rawCandidates.filter((item) => !isGeneratedStoryImageUrl(item))] : rawCandidates;
  return orderedCandidates
    .map((raw) => ({ raw, publicUrl: toPublicUploadUrl(raw) }))
    .filter((item) => isPublicHttpsUrl(item.publicUrl));
};

const logFinalStoryMedia = async ({ story, platform, candidate }) => {
  let metadata;
  try {
    metadata = candidate.raw ? await getStoryImageMetadata(candidate.raw) : null;
  } catch (error) {
    metadata = { error: error?.message || "metadata unavailable" };
  }
  console.log("[fast-story] final publish media", {
    platform,
    storyId: story?.id || null,
    post_id: story?.id || null,
    product_id: story?.product_id || null,
    creativeId: story?.design_json?.creative_id || story?.creative_id || null,
    assetId: story?.assetId || (Array.isArray(story?.publish_asset_ids) ? story.publish_asset_ids[0] || null : story?.asset_id || null),
    assetUrl: candidate.publicUrl || "",
    publishJobId: story?.publish_job_id || null,
    templateKey: story?.templateKey || story?.design_json?.template_key || story?.design_json?.layout_type || "",
    templateVersion: story?.templateVersion || story?.design_json?.template_version || "",
    template: story?.design_json?.story_asset_renderer || story?.story_asset_renderer || "",
    layout: story?.design_json?.layout_type || story?.layout_type || "",
    story_type: story?.story_type || "story",
    final_media_url: candidate.publicUrl || "",
    final_media_raw_url: candidate.raw || "",
    is_generated_story_asset: isGeneratedStoryImageUrl(candidate.raw || candidate.publicUrl),
    image_metadata_before_publish: metadata,
  });
  return metadata;
};

const shouldRequireGeneratedStoryAsset = (story = {}) =>
  Boolean(story.require_generated_story_asset) || String(story.story_type || "").toLowerCase() === "product";

const verifiedChecksums = new Map();
const checksumForPublicAsset = async (url = "") => {
  if (verifiedChecksums.has(url)) return verifiedChecksums.get(url);
  const response = await fetch(url, { headers: { "Cache-Control": "no-cache" } });
  if (!response.ok) throw new Error(`Story asset checksum verification failed (${response.status})`);
  const checksum = crypto.createHash("sha256").update(Buffer.from(await response.arrayBuffer())).digest("hex");
  verifiedChecksums.set(url, checksum);
  if (verifiedChecksums.size > 100) verifiedChecksums.delete(verifiedChecksums.keys().next().value);
  return checksum;
};

const assertGeneratedStoryAsset = async ({ story, platform, candidate }) => {
  const metadata = await logFinalStoryMedia({ story, platform, candidate });
  const finalMediaUrl = candidate.publicUrl || "";
  const generatedStoryAsset = isGeneratedStoryImageUrl(candidate.raw || candidate.publicUrl) ||
    /\/(?:erp\/)?stories\//i.test(finalMediaUrl) ||
    (metadata?.width === 1080 && metadata?.height === 1920);
  if (shouldRequireGeneratedStoryAsset(story) && !generatedStoryAsset) {
    throw new Error("Fast story publish blocked: Instagram media URL is not generated story asset");
  }
  if (shouldRequireGeneratedStoryAsset(story) && (metadata?.width !== 1080 || metadata?.height !== 1920)) {
    throw new Error("Fast story publish blocked: generated story asset is not 1080x1920");
  }
  if (shouldRequireGeneratedStoryAsset(story)) {
    if (!trimString(story.storyId || story.id) || !trimString(story.assetId) ||
        !trimString(story.templateKey) || !trimString(story.templateVersion) || !trimString(story.checksum)) {
      throw new Error("Fast story publish blocked: immutable story asset contract is incomplete");
    }
    const actualChecksum = await checksumForPublicAsset(finalMediaUrl);
    if (actualChecksum !== trimString(story.checksum)) {
      throw new Error("Fast story publish blocked: story asset checksum mismatch");
    }
  }
};

const getPageId = (settings = {}) => trimString(settings.facebook_page_id || settings.page_id);
const getInstagramAccountId = (settings = {}) => trimString(settings.instagram_account_id);

// Every story call goes through the shared Graph governor. A publish is the one
// Meta call an owner is actually watching, so it runs in the priority lane and
// retries a rate-limit answer instead of reporting `(#4) Application request limit
// reached` straight back to the queue card.
const STORY_RATE_LIMIT_RETRIES = Math.max(0, Number(process.env.META_STORY_RATE_LIMIT_RETRIES || 2) || 0);

const callMeta = async ({ endpoint, params, mode, imageUrl }) => {
  const target = `${GRAPH_API_BASE_URL}${endpoint}`;
  return runGraphRequest({
    lane: "publish",
    label: mode || endpoint,
    retries: STORY_RATE_LIMIT_RETRIES,
    run: async (attempt) => {
      console.log("[story-meta] request", { target, mode, image_url: imageUrl || null, attempt });
      const response = await fetch(target, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(params),
      });
      noteGraphResponse(response);
      const payload = await parseMetaResponse(response);
      if (response.ok) {
        console.log("[story-meta] response", { target, status: response.status, response: payload });
        return payload;
      }
      console.error("[story-meta] error", { target, status: response.status, response: payload });
      const error = new Error(getMetaErrorMessage(payload));
      error.status = response.status;
      error.metaResponse = payload;
      error.meta = payload?.error || payload;
      throw error;
    },
  });
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const INSTAGRAM_SLIDE_DELAY_MS = 1200;
const FACEBOOK_SLIDE_DELAY_MS = Math.max(0, Number(process.env.META_FACEBOOK_SLIDE_DELAY_MS || 1200) || 0);

const instagramCompatibleImageUrl = (value = "") => {
  const source = trimString(value);
  if (!source) return "";
  if (/\.jpe?g(?:$|[?#])/i.test(source)) return source;
  try {
    const parsed = new URL(source);
    if (!/\.cloudinary\.com$/i.test(parsed.hostname) || !parsed.pathname.includes("/image/upload/")) return source;
    parsed.pathname = parsed.pathname
      .replace("/image/upload/", "/image/upload/f_jpg,q_92,fl_strip_profile/")
      .replace(/\.png$/i, ".jpg");
    return parsed.toString();
  } catch {
    return source;
  }
};

const assertInstagramImageIsFetchable = async (imageUrl = "") => {
  const response = await fetch(imageUrl, {
    method: "HEAD",
    headers: { "Cache-Control": "no-cache", Accept: "image/jpeg" },
  });
  const contentType = trimString(response.headers.get("content-type")).toLowerCase();
  if (!response.ok || !contentType.startsWith("image/jpeg")) {
    const error = new Error(`Instagram Story media preflight failed: expected public JPEG, received ${contentType || `HTTP ${response.status}`}.`);
    error.status = response.status || 422;
    throw error;
  }
};

const isRetryableInstagramContainerError = (error) => {
  // A rate limit has already been retried and backed off inside the governor; a
  // second loop on top of that just spends the recovery window re-triggering it.
  if (isGraphRateLimitError(error)) return false;
  const message = `${error?.message || ""} ${JSON.stringify(error?.metaResponse || {})}`.toLowerCase();
  return Number(error?.status || 0) === 429 || Number(error?.status || 0) >= 500 ||
    ["fetch failed", "only photo or video", "temporarily unavailable", "please try again"].some((token) => message.includes(token));
};

const storyLinkMetadata = (story = {}) => ({
  product_url: trimString(story.product_url || story.design_json?.product_url),
  cta_url: trimString(story.cta_url || story.design_json?.cta_url || story.product_url || story.design_json?.product_url),
});

const result = ({ status, id = null, error = null, story = {} }) => ({ status, platform_story_id: id, id, error, ...storyLinkMetadata(story) });

// `(#4) Application request limit reached` tells the owner nothing about what to
// do next. Name the cause and the recovery window so the queue card is readable.
const describePublishError = (error) => {
  const message = trimString(error?.message) || "Story publish failed";
  if (!isGraphRateLimitError(error)) return message;
  const snapshot = getMetaGraphBudgetSnapshot();
  const minutes = Math.ceil(snapshot.breaker_ms_remaining / 60000);
  const waitHint = minutes > 0 ? ` سيُعاد النشر تلقائيًا بعد حوالي ${minutes} دقيقة.` : "";
  return `${message} — تم استهلاك حد طلبات تطبيق ميتا مؤقتًا (${Math.round(snapshot.pressure)}% من الحصة).${waitHint}`;
};

const isUnsupportedFacebookCtaError = (error) => {
  const text = `${error?.message || ""} ${JSON.stringify(error?.metaResponse || {})}`.toLowerCase();
  return ["unsupported", "unknown", "invalid parameter", "unexpected", "call_to_action", "link", "cta_url"].some((token) => text.includes(token));
};

const facebookStoryCtaParams = (story = {}) => {
  const { cta_url: ctaUrl } = storyLinkMetadata(story);
  if (!ctaUrl) return {};
  return {
    link: ctaUrl,
    cta_url: ctaUrl,
    call_to_action: JSON.stringify({
      type: "VIEW_DETAILS",
      value: { link: ctaUrl },
    }),
  };
};

export const publishInstagramStory = async ({ story, settings, accessToken }) => {
  const instagramAccountId = getInstagramAccountId(settings);
  const candidate = getStoryImageCandidate(story);
  const imageUrl = instagramCompatibleImageUrl(candidate.publicUrl);
  console.log("[story-instagram] ig account id", { instagram_account_id: instagramAccountId || null });
  if (!instagramAccountId) return result({ status: "failed", error: "Instagram account ID is not configured.", story });
  if (!imageUrl) return result({ status: "failed", error: "Instagram Story requires a valid public HTTPS image URL.", story });

  try {
    await assertGeneratedStoryAsset({ story, platform: "instagram", candidate });
    await assertInstagramImageIsFetchable(imageUrl);
    let container = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        container = await callMeta({
          endpoint: `/${encodeURIComponent(instagramAccountId)}/media`,
          mode: "instagram.story.container",
          imageUrl,
          params: {
            media_type: "STORIES",
            image_url: imageUrl,
            access_token: accessToken,
          },
        });
        break;
      } catch (error) {
        if (!isRetryableInstagramContainerError(error) || attempt === 3) throw error;
        console.warn("[story-instagram] retrying container creation", {
          attempt,
          image_url: imageUrl,
          error: error?.message || "Instagram container creation failed",
        });
        await delay(attempt * 2000);
      }
    }
    const containerId = trimString(container?.id);
    console.log("[story-instagram] container id", { container_id: containerId || null });
    if (!containerId) return result({ status: "failed", error: "Instagram Story container response did not include id.", story });

    let published = null;
    let publishError = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        published = await callMeta({
          endpoint: `/${encodeURIComponent(instagramAccountId)}/media_publish`,
          mode: "instagram.story.publish",
          params: {
            creation_id: containerId,
            access_token: accessToken,
          },
        });
        publishError = null;
        break;
      } catch (error) {
        publishError = error;
        if (!String(error?.message || "").toLowerCase().includes("media id is not available") || attempt === 3) {
          throw error;
        }
        await delay(5000);
      }
    }
    if (publishError) throw publishError;
    const publishId = trimString(published?.id);
    console.log("[story-instagram] publish id", { publish_id: publishId || null, response: published });
    return publishId ? result({ status: "published", id: publishId, story }) : result({ status: "failed", error: "Instagram Story publish response did not include id.", story });
  } catch (error) {
    console.error("[story-instagram] error", { error: error?.message, response: error?.metaResponse || null });
    return result({ status: "failed", error: describePublishError(error) || "Instagram Story publish failed", story });
  }
};

export const publishFacebookStory = async ({ story, settings, accessToken }) => {
  const pageId = getPageId(settings);
  const candidate = getStoryImageCandidate(story);
  const imageUrl = candidate.publicUrl;
  const linkMetadata = storyLinkMetadata(story);
  if (!pageId) return result({ status: "failed", error: "Facebook page ID is not configured.", story });
  if (!imageUrl) return result({ status: "failed", error: "Facebook Story requires a valid public HTTPS image URL.", story });

  try {
    await assertGeneratedStoryAsset({ story, platform: "facebook", candidate });
    console.log("[story-facebook] CTA/link metadata", {
      post_id: story?.id || null,
      product_id: story?.product_id || null,
      product_url: linkMetadata.product_url || null,
      cta_url: linkMetadata.cta_url || null,
    });
    const photo = await callMeta({
      endpoint: `/${encodeURIComponent(pageId)}/photos`,
      mode: "facebook.story.photo_upload",
      imageUrl,
      params: {
        url: imageUrl,
        published: "false",
        access_token: accessToken,
      },
    });
    const photoId = trimString(photo?.id);
    if (!photoId) return result({ status: "failed", error: "Facebook Story photo upload response did not include id.", story });

    const publishParams = {
      photo_id: photoId,
      access_token: accessToken,
    };
    const ctaParams = facebookStoryCtaParams(story);
    let published;
    let usedFacebookCta = Boolean(Object.keys(ctaParams).length);
    try {
      published = await callMeta({
        endpoint: `/${encodeURIComponent(pageId)}/photo_stories`,
        mode: usedFacebookCta ? "facebook.story.publish.with_cta" : "facebook.story.publish",
        params: {
          ...publishParams,
          ...ctaParams,
        },
      });
    } catch (error) {
      if (!usedFacebookCta || !isUnsupportedFacebookCtaError(error)) throw error;
      usedFacebookCta = false;
      console.warn("[story-facebook] CTA/link params rejected by Graph API; retrying story publish without CTA params", {
        post_id: story?.id || null,
        product_url: linkMetadata.product_url || null,
        cta_url: linkMetadata.cta_url || null,
        error: error?.message || "Facebook CTA params unsupported",
        response: error?.metaResponse || null,
      });
      published = await callMeta({
        endpoint: `/${encodeURIComponent(pageId)}/photo_stories`,
        mode: "facebook.story.publish.without_cta_fallback",
        params: publishParams,
      });
    }
    const storyId = trimString(published?.id || published?.post_id);
    console.log("[story-facebook] response", { photo_id: photoId, response: published, used_facebook_cta: usedFacebookCta, ...linkMetadata });
    return storyId
      ? { ...result({ status: "published", id: storyId, story }), used_facebook_cta: usedFacebookCta }
      : result({ status: "failed", error: "Facebook Story publish response did not include id.", story });
  } catch (error) {
    console.error("[story-facebook] response/error", { error: error?.message, response: error?.metaResponse || null, ...linkMetadata });
    return result({ status: "failed", error: describePublishError(error) || "Facebook Story publish failed", story });
  }
};

const publishWhatsAppStory = async () => {
  const reason = "WhatsApp Status publishing is not available through official API.";
  console.log("[story-whatsapp] skipped reason", { reason });
  return { status: "skipped", id: null, error: reason };
};

const storyForCandidate = (story = {}, candidate = {}) => ({
  ...story,
  ...((Array.isArray(story.assetSlides) ? story.assetSlides : []).find((slide) =>
    trimString(slide?.assetUrl || slide?.asset_url) === trimString(candidate.raw || candidate.publicUrl)
  ) || {}),
  image_url: candidate.raw || candidate.publicUrl || "",
  media_urls: [candidate.raw || candidate.publicUrl || ""].filter(Boolean),
});

const aggregatePlatformSlideResults = (platform, results = []) => {
  if (results.length <= 1) return results[0] || { status: "failed", id: null, error: `${platform} story did not run` };
  const published = results.filter((item) => item.status === "published");
  const status = published.length === results.length ? "published" : published.length ? "partial_success" : "failed";
  return {
    status,
    id: published.map((item) => item.id).filter(Boolean).join(","),
    platform_story_id: published.map((item) => item.platform_story_id || item.id).filter(Boolean).join(","),
    slide_results: results,
    slide_count: results.length,
    published_slide_count: published.length,
    error: status === "published" ? null : results.filter((item) => item.status !== "published").map((item) => item.error).filter(Boolean).join("; "),
  };
};

export const publishStoryEverywhere = async ({ story = {}, settings = {}, previousResults = {} }) => {
  console.log("[story-all] starting", {
    storyId: story?.id || null,
    post_id: story?.id || null,
    productId: story?.product_id || null,
    creativeId: story?.design_json?.creative_id || story?.creative_id || null,
    publishJobId: story?.publish_job_id || null,
    assetId: story?.assetId || (Array.isArray(story?.publish_asset_ids) ? story.publish_asset_ids[0] || null : null),
    assetUrl: story?.assetUrl || story?.image_url || "",
    templateKey: story?.templateKey || story?.design_json?.template_key || story?.design_json?.layout_type || "",
    templateVersion: story?.templateVersion || story?.design_json?.template_version || "",
    story_type: story?.story_type || "story",
  });
  let accessToken;
  try {
    const validation = validateMetaToken(settings);
    accessToken = validation.accessToken;
    if (validation.warning) {
      console.warn("[story-all] Meta token warning", { status: validation.status, warning: validation.warning });
    }
  } catch (error) {
    const failed = {
      instagram: result({ status: "failed", error: error?.message || "Meta access token is not valid.", story }),
      facebook: result({ status: "failed", error: error?.message || "Meta access token is not valid.", story }),
      whatsapp: await publishWhatsAppStory(),
    };
    console.error("[story-all] Meta token validation failed", {
      status: error?.tokenStatus || null,
      error: error?.message,
    });
    return { status: "failed", published_at: null, story_publish_results: failed, ...storyLinkMetadata(story), error_message: error?.message || "Meta access token is not valid." };
  }

  const candidates = getStoryImageCandidates(story);
  const publishCandidates = candidates.length ? candidates : [getStoryImageCandidate(story)].filter((candidate) => candidate.publicUrl);
  if (shouldRequireGeneratedStoryAsset(story) && !publishCandidates.length) {
    throw new Error("Fast story publish blocked: generated story asset is missing for this story");
  }
  const generatedAssetUrls = publishCandidates.map((candidate) => candidate.raw || candidate.publicUrl).filter(Boolean);
  console.log("[story-generated-assets]", {
    storyId: story?.id || null,
    productId: story?.product_id || null,
    creativeId: story?.design_json?.creative_id || story?.creative_id || null,
    assetId: story?.assetId || (Array.isArray(story?.publish_asset_ids) ? story.publish_asset_ids[0] || null : story?.asset_id || null),
    assetUrl: generatedAssetUrls[0] || "",
    publishJobId: story?.publish_job_id || null,
    templateKey: story?.templateKey || story?.design_json?.template_key || story?.design_json?.layout_type || "",
    templateVersion: story?.templateVersion || story?.design_json?.template_version || "",
    template: story?.design_json?.story_asset_renderer || story?.story_asset_renderer || "",
    layout: story?.design_json?.layout_type || story?.layout_type || "",
    generated_asset_count: generatedAssetUrls.length,
    generated_asset_urls: generatedAssetUrls,
    rendered_slides_length: Array.isArray(story.design_json?.slides) ? story.design_json.slides.length : generatedAssetUrls.length,
    media_urls_length: Array.isArray(story.media_urls) ? story.media_urls.length : generatedAssetUrls.length,
    source_image_count: Number(story.metadata?.source_image_count || story.design_json?.source_image_count || 0),
    generated_matches_source_count: Number(story.metadata?.source_image_count || story.design_json?.source_image_count || 0)
      ? generatedAssetUrls.length === Number(story.metadata?.source_image_count || story.design_json?.source_image_count || 0)
      : null,
    publish_candidate_count: publishCandidates.length,
  });

  if (shouldRequireGeneratedStoryAsset(story)) {
    for (const candidate of publishCandidates) {
      await assertGeneratedStoryAsset({ story: storyForCandidate(story, candidate), platform: "preflight", candidate });
    }
  }

  // An explicit target_platforms list (used by the story autopilot) narrows the fan-out.
  // Without it every Meta surface is published, which is the historical behaviour.
  const requestedPlatforms = Array.isArray(story?.target_platforms)
    ? story.target_platforms.map((platform) => String(platform || "").trim().toLowerCase()).filter(Boolean)
    : [];
  const wantsPlatform = (platform) => !requestedPlatforms.length || requestedPlatforms.includes(platform);
  const skipped = (platform) => result({ status: "skipped", error: `${platform} is not selected for this publish`, story });

  const previousInstagram = previousResults?.instagram || {};
  const previousFacebook = previousResults?.facebook || {};
  let instagram;
  if (!wantsPlatform("instagram")) {
    instagram = skipped("Instagram");
  } else if (previousInstagram.status === "published") {
    instagram = { ...previousInstagram, reused: true };
  } else {
    const previousSlides = Array.isArray(previousInstagram.slide_results) ? previousInstagram.slide_results : [];
    const instagramSlides = [];
    for (const [index, candidate] of publishCandidates.entries()) {
      const previousSlide = previousSlides[index];
      if (previousSlide?.status === "published") {
        instagramSlides.push({ ...previousSlide, reused: true });
        continue;
      }
      instagramSlides.push(await publishInstagramStory({
        story: storyForCandidate(story, candidate),
        settings,
        accessToken,
      }));
      if (index < publishCandidates.length - 1) await delay(INSTAGRAM_SLIDE_DELAY_MS);
    }
    instagram = aggregatePlatformSlideResults("Instagram", instagramSlides);
  }

  let facebook;
  if (!wantsPlatform("facebook")) {
    facebook = skipped("Facebook");
  } else if (previousFacebook.status === "published") {
    facebook = { ...previousFacebook, reused: true };
  } else {
    // Facebook slides publish one at a time, exactly like Instagram above. Each
    // slide costs two Graph calls (unpublished photo upload + photo_stories), so
    // a `Promise.all` over a five-slide story fired ten simultaneous requests and
    // spent the app budget in one burst — which is how a whole card came back as
    // `(#4) Application request limit reached` repeated once per slide.
    const previousSlides = Array.isArray(previousFacebook.slide_results) ? previousFacebook.slide_results : [];
    const facebookSlides = [];
    for (const [index, candidate] of publishCandidates.entries()) {
      const previousSlide = previousSlides[index];
      // A retry must not republish a slide that already went out, or the page ends
      // up with duplicate stories and the retry pays for them twice.
      if (previousSlide?.status === "published") {
        facebookSlides.push({ ...previousSlide, reused: true });
        continue;
      }
      facebookSlides.push(await publishFacebookStory({
        story: storyForCandidate(story, candidate),
        settings,
        accessToken,
      }));
      if (index < publishCandidates.length - 1) await delay(FACEBOOK_SLIDE_DELAY_MS);
    }
    facebook = aggregatePlatformSlideResults("Facebook", facebookSlides);
  }
  const whatsapp = previousResults?.whatsapp?.status === "skipped"
    ? { ...previousResults.whatsapp, reused: true }
    : await publishWhatsAppStory();

  const supported = [instagram, facebook].filter((item) => item.status !== "skipped");
  const successCount = supported.filter((item) => item.status === "published").length;
  const status = !supported.length
    ? "failed"
    : successCount === supported.length
      ? "published"
      : successCount > 0
        ? "partial_success"
        : "failed";
  const errorMessage = status === "published" ? null : [
    !supported.length ? "No publishing platform was selected." : "",
    instagram.status !== "published" && instagram.status !== "skipped" ? `Instagram: ${instagram.error}` : "",
    facebook.status !== "published" && facebook.status !== "skipped" ? `Facebook: ${facebook.error}` : "",
  ].filter(Boolean).join("; ");

  const aggregate = {
    status,
    published_at: successCount > 0 ? new Date().toISOString() : null,
    story_publish_results: { instagram, facebook, whatsapp },
    ...storyLinkMetadata(story),
    error_message: errorMessage,
  };
  console.log("[story-all] final result", aggregate);
  return aggregate;
};

export default publishStoryEverywhere;

export const __storyPublisherTestHooks = {
  instagramCompatibleImageUrl,
  isRetryableInstagramContainerError,
};
