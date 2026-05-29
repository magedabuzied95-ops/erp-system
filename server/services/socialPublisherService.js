const GRAPH_API_VERSION = "v19.0";
const GRAPH_API_BASE_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

import { validateMetaToken } from "./metaTokenService.js";

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

const getMetaErrorMessage = (payload, fallback = "Meta Graph API request failed") => {
  if (payload?.error?.message) return payload.error.message;
  if (payload?.error) return JSON.stringify(payload.error);
  if (payload?.message) return payload.message;
  return fallback;
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

const buildMessage = (post = {}) =>
  [post.title, post.caption, post.hashtags]
    .map(trimString)
    .filter(Boolean)
    .join("\n\n");

const uniqueList = (items = []) =>
  Array.from(new Set(items.map(trimString).filter(Boolean)));

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

const getPostImageUrls = (post = {}) => {
  const rawImageUrls = uniqueList([post.image_url, ...parseMediaUrls(post.media_urls)]);
  const publicImageUrls = uniqueList(rawImageUrls.map(toPublicUploadUrl));
  const validPublicImageUrls = publicImageUrls.filter(isPublicHttpsUrl);

  console.log("[marketing] Meta publish images", {
    found_count: rawImageUrls.length,
    final_public_image_urls: publicImageUrls,
    valid_public_image_urls: validPublicImageUrls,
  });

  return validPublicImageUrls;
};

const getPageId = (settings = {}) => trimString(settings.facebook_page_id || settings.page_id);
const getInstagramAccountId = (settings = {}) => trimString(settings.instagram_account_id);
const logMetaRequest = ({ target, mode, imageUrl }) => {
  console.log("[marketing] Meta publish request", {
    target,
    mode,
    image_url: imageUrl || null,
  });
};

const callMeta = async ({ endpoint, params, mode, imageUrl }) => {
  const target = `${GRAPH_API_BASE_URL}${endpoint}`;
  logMetaRequest({ target, mode, imageUrl });

  const response = await fetch(target, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  const payload = await parseMetaResponse(response);

  if (response.ok) {
    console.log("[marketing] Meta publish response", {
      target,
      status: response.status,
      response: payload,
    });
    return payload;
  }

  console.error("[marketing] Meta publish error", {
    target,
    status: response.status,
    response: payload,
  });

  const error = new Error(getMetaErrorMessage(payload));
  error.status = response.status;
  error.metaResponse = payload;
  throw error;
};

const uploadUnpublishedPhoto = async ({ pageId, accessToken, imageUrl }) =>
  callMeta({
    endpoint: `/${encodeURIComponent(pageId)}/photos`,
    mode: "photos.unpublished",
    imageUrl,
    params: {
      url: imageUrl,
      published: "false",
      access_token: accessToken,
    },
  });

const publishMultiPhotoFeed = async ({ pageId, accessToken, message, imageUrls }) => {
  const uploadedPhotoIds = [];
  const uploadErrors = [];

  for (const imageUrl of imageUrls) {
    try {
      const payload = await uploadUnpublishedPhoto({ pageId, accessToken, imageUrl });
      const photoId = trimString(payload?.id);
      if (photoId) {
        uploadedPhotoIds.push(photoId);
      } else {
        const errorMessage = "Meta photo upload response did not include id.";
        uploadErrors.push({ image_url: imageUrl, error: errorMessage, response: payload });
        console.error("[marketing] Meta photo upload missing id", {
          image_url: imageUrl,
          response: payload,
        });
      }
    } catch (error) {
      uploadErrors.push({
        image_url: imageUrl,
        error: error?.message || "Meta photo upload failed",
        response: error?.metaResponse || null,
      });
      console.error("[marketing] Meta photo upload failed; continuing with remaining images", {
        image_url: imageUrl,
        error: error?.message,
        response: error?.metaResponse || null,
      });
    }
  }

  console.log("[marketing] Meta uploaded photo ids", {
    uploaded_photo_ids: uploadedPhotoIds,
    failed_uploads: uploadErrors,
  });

  if (!uploadedPhotoIds.length) {
    return {
      success: false,
      status: "failed",
      error_message: uploadErrors[0]?.error || "No Facebook photos uploaded successfully.",
      published_at: null,
      platform_post_id: null,
      external_post_id: null,
      meta_response: { uploaded_photo_ids: uploadedPhotoIds, failed_uploads: uploadErrors },
      mode: "multi_photo",
    };
  }

  const params = {
    message,
    access_token: accessToken,
  };

  uploadedPhotoIds.forEach((photoId, index) => {
    params[`attached_media[${index}]`] = JSON.stringify({ media_fbid: photoId });
  });

  const payload = await callMeta({
    endpoint: `/${encodeURIComponent(pageId)}/feed`,
    mode: "feed.multi_photo",
    params,
  });
  const result = publishResult({ payload, mode: "multi_photo" });

  console.log("[marketing] Meta final feed post", {
    platform_post_id: result.platform_post_id,
    uploaded_photo_ids: uploadedPhotoIds,
  });

  return {
    ...result,
    meta_response: {
      feed: payload,
      uploaded_photo_ids: uploadedPhotoIds,
      failed_uploads: uploadErrors,
    },
  };
};

const publishResult = ({ payload, mode }) => {
  const platformPostId = trimString(payload?.post_id || payload?.id);
  if (!platformPostId) {
    return {
      success: false,
      status: "failed",
      error_message: "Meta Graph API response did not include id or post_id.",
      published_at: null,
      platform_post_id: null,
      external_post_id: null,
      meta_response: payload,
      mode,
    };
  }

  return {
    success: true,
    status: "published",
    error_message: null,
    published_at: new Date().toISOString(),
    platform_post_id: platformPostId,
    external_post_id: platformPostId,
    meta_response: payload,
    mode,
  };
};

const toPlatformPublishResult = (result = {}) => ({
  status: result.status || "failed",
  platform_post_id: result.platform_post_id || result.external_post_id || null,
  error: result.error_message || null,
});

const summarizeAllPublish = (facebookResult, instagramResult) => {
  const platformResults = {
    facebook: toPlatformPublishResult(facebookResult),
    instagram: toPlatformPublishResult(instagramResult),
  };
  const facebookSuccess = platformResults.facebook.status === "published";
  const instagramSuccess = platformResults.instagram.status === "published";
  const successCount = [facebookSuccess, instagramSuccess].filter(Boolean).length;

  let status = "failed";
  if (successCount === 2) status = "published";
  if (successCount === 1) status = "partial_success";

  const message =
    status === "published"
      ? "Published to Facebook and Instagram"
      : facebookSuccess && !instagramSuccess
        ? "Facebook published, Instagram failed"
        : !facebookSuccess && instagramSuccess
          ? "Instagram published, Facebook failed"
          : `${platformResults.facebook.error || "Facebook failed"}; ${platformResults.instagram.error || "Instagram failed"}`;

  return {
    success: status === "published",
    status,
    error_message: status === "published" ? null : message,
    published_at: successCount > 0 ? new Date().toISOString() : null,
    platform_post_id: platformResults.facebook.platform_post_id || platformResults.instagram.platform_post_id,
    external_post_id: platformResults.facebook.platform_post_id || platformResults.instagram.platform_post_id,
    platform_publish_results: platformResults,
    meta_response: {
      facebook: facebookResult?.meta_response || null,
      instagram: instagramResult?.meta_response || null,
    },
    mode: "all",
  };
};

const publishAllChannels = async ({ post, settings, accessToken }) => {
  console.log("[publish-all] starting", { post_id: post?.id || null });

  const [facebookResult, instagramResult] = await Promise.all([
    publishFacebookPost({ post, settings, accessToken }),
    publishInstagramPost({ post, settings, accessToken }),
  ]);

  if (facebookResult.status === "published") {
    console.log("[publish-all] facebook success", {
      platform_post_id: facebookResult.platform_post_id || facebookResult.external_post_id || null,
    });
  } else {
    console.error("[publish-all] facebook fail", {
      error: facebookResult.error_message || "Facebook publish failed",
    });
  }

  if (instagramResult.status === "published") {
    console.log("[publish-all] instagram success", {
      platform_post_id: instagramResult.platform_post_id || instagramResult.external_post_id || null,
    });
  } else {
    console.error("[publish-all] instagram fail", {
      error: instagramResult.error_message || "Instagram publish failed",
    });
  }

  const aggregate = summarizeAllPublish(facebookResult, instagramResult);
  console.log("[publish-all] final aggregate result", aggregate);
  return aggregate;
};

export const publishInstagramPost = async ({ post, settings, accessToken }) => {
  const instagramAccountId = getInstagramAccountId(settings);
  const message = buildMessage(post);
  const imageUrls = getPostImageUrls(post);

  console.log("[instagram] ig account id", { instagram_account_id: instagramAccountId || null });
  console.log("[instagram] image count", { image_count: imageUrls.length });

  if (!instagramAccountId) {
    return {
      success: false,
      status: "failed",
      error_message: "Instagram account ID is not configured.",
      external_post_id: null,
      platform_post_id: null,
      published_at: null,
    };
  }

  if (!imageUrls.length) {
    return {
      success: false,
      status: "failed",
      error_message: "Instagram publishing requires a valid public HTTPS image URL.",
      external_post_id: null,
      platform_post_id: null,
      published_at: null,
    };
  }

  try {
    if (imageUrls.length > 1) {
      const childContainerIds = [];
      const childErrors = [];

      for (const imageUrl of imageUrls) {
        try {
          const childContainer = await callMeta({
            endpoint: `/${encodeURIComponent(instagramAccountId)}/media`,
            mode: "instagram.carousel_item",
            imageUrl,
            params: {
              image_url: imageUrl,
              is_carousel_item: "true",
              access_token: accessToken,
            },
          });
          const childContainerId = trimString(childContainer?.id);
          if (childContainerId) {
            childContainerIds.push(childContainerId);
          } else {
            childErrors.push({ image_url: imageUrl, error: "Instagram carousel item response did not include id.", response: childContainer });
            console.error("[instagram] carousel item missing id", { image_url: imageUrl, response: childContainer });
          }
        } catch (error) {
          childErrors.push({
            image_url: imageUrl,
            error: error?.message || "Instagram carousel item upload failed",
            response: error?.metaResponse || null,
          });
          console.error("[instagram] carousel item failed; continuing with remaining images", {
            image_url: imageUrl,
            error: error?.message,
            response: error?.metaResponse || null,
          });
        }
      }

      console.log("[instagram] carousel child container ids", {
        child_container_ids: childContainerIds,
        failed_children: childErrors,
      });

      if (childContainerIds.length >= 2) {
        const carouselContainer = await callMeta({
          endpoint: `/${encodeURIComponent(instagramAccountId)}/media`,
          mode: "instagram.carousel",
          params: {
            media_type: "CAROUSEL",
            children: childContainerIds.join(","),
            caption: message,
            access_token: accessToken,
          },
        });
        const carouselContainerId = trimString(carouselContainer?.id);
        console.log("[instagram] carousel container id", { carousel_container_id: carouselContainerId || null });

        if (!carouselContainerId) {
          return {
            success: false,
            status: "failed",
            error_message: "Instagram carousel container response did not include id.",
            external_post_id: null,
            platform_post_id: null,
            published_at: null,
            meta_response: { carousel: carouselContainer, child_container_ids: childContainerIds, failed_children: childErrors },
            mode: "instagram_carousel",
          };
        }

        const publishResponse = await callMeta({
          endpoint: `/${encodeURIComponent(instagramAccountId)}/media_publish`,
          mode: "instagram.carousel_publish",
          params: {
            creation_id: carouselContainerId,
            access_token: accessToken,
          },
        });
        console.log("[instagram] media_publish response", publishResponse);
        const result = publishResult({ payload: publishResponse, mode: "instagram_carousel" });
        return {
          ...result,
          meta_response: {
            publish: publishResponse,
            carousel_container_id: carouselContainerId,
            child_container_ids: childContainerIds,
            failed_children: childErrors,
          },
        };
      }

      if (!childContainerIds.length) {
        return {
          success: false,
          status: "failed",
          error_message: childErrors[0]?.error || "No Instagram carousel images uploaded successfully.",
          external_post_id: null,
          platform_post_id: null,
          published_at: null,
          meta_response: { child_container_ids: childContainerIds, failed_children: childErrors },
          mode: "instagram_carousel",
        };
      }

      console.warn("[instagram] carousel fallback to single image because fewer than 2 child containers uploaded", {
        child_container_ids: childContainerIds,
      });
    }

    const imageUrl = imageUrls[0];
    const mediaContainer = await callMeta({
      endpoint: `/${encodeURIComponent(instagramAccountId)}/media`,
      mode: "instagram.media",
      imageUrl,
      params: {
        image_url: imageUrl,
        caption: message,
        access_token: accessToken,
      },
    });
    const creationId = trimString(mediaContainer?.id);
    console.log("[instagram] media container id", { media_container_id: creationId || null });

    if (!creationId) {
      return {
        success: false,
        status: "failed",
        error_message: "Instagram media container response did not include id.",
        external_post_id: null,
        platform_post_id: null,
        published_at: null,
        meta_response: mediaContainer,
      };
    }

    const publishResponse = await callMeta({
      endpoint: `/${encodeURIComponent(instagramAccountId)}/media_publish`,
      mode: "instagram.media_publish",
      params: {
        creation_id: creationId,
        access_token: accessToken,
      },
    });
    console.log("[instagram] media_publish response", publishResponse);
    return publishResult({ payload: publishResponse, mode: "instagram" });
  } catch (error) {
    return {
      success: false,
      status: "failed",
      error_message: error?.message || "Instagram publish failed",
      external_post_id: null,
      platform_post_id: null,
      published_at: null,
      meta_response: error?.metaResponse || null,
      mode: "instagram",
    };
  }
};

export const publishFacebookPost = async ({ post, settings, accessToken }) => {
  const pageId = getPageId(settings);
  const message = buildMessage(post);

  if (!pageId) {
    return { success: false, status: "failed", error_message: "Facebook page ID is not configured.", external_post_id: null, platform_post_id: null, published_at: null };
  }

  const imageUrls = getPostImageUrls(post);

  try {
    if (imageUrls.length === 1) {
      const imageUrl = imageUrls[0];
      const payload = await callMeta({
        endpoint: `/${encodeURIComponent(pageId)}/photos`,
        mode: "photos",
        imageUrl,
        params: {
          url: imageUrl,
          caption: message,
          access_token: accessToken,
        },
      });
      return publishResult({ payload, mode: "photos" });
    }

    if (imageUrls.length > 1) {
      return await publishMultiPhotoFeed({ pageId, accessToken, message, imageUrls });
    }

    const attemptedImageUrls = uniqueList([post.image_url, ...parseMediaUrls(post.media_urls)].map(toPublicUploadUrl));
    if (attemptedImageUrls.length) {
      console.warn("[marketing] Meta image publish skipped; falling back to feed because image_url is not a public HTTPS URL", {
        image_urls: attemptedImageUrls,
      });
    }

    const payload = await callMeta({
      endpoint: `/${encodeURIComponent(pageId)}/feed`,
      mode: "feed",
      params: {
        message,
        access_token: accessToken,
      },
    });
    return publishResult({ payload, mode: "feed" });
  } catch (error) {
    return {
      success: false,
      status: "failed",
      error_message: error?.message || "Meta Graph API request failed",
      external_post_id: null,
      platform_post_id: null,
      published_at: null,
      meta_response: error?.metaResponse || null,
    };
  }
};

export const publishFacebookText = async ({ message, settings }) => {
  const pageId = getPageId(settings);
  const { accessToken } = validateMetaToken(settings);

  if (!pageId) throw new Error("Facebook page ID is not configured.");
  if (!accessToken) throw new Error("Meta access token is not configured.");

  return callMeta({
    endpoint: `/${encodeURIComponent(pageId)}/feed`,
    mode: "feed",
    params: {
      message: trimString(message) || "Test post from ERP",
      access_token: accessToken,
    },
  });
};

export const publishPost = async (post = {}, settings = {}) => {
  if (!settings?.is_connected) {
    return {
      success: false,
      status: "failed",
      error_message: "Meta account is not connected yet.",
      external_post_id: null,
      platform_post_id: null,
      published_at: null,
    };
  }

  const requestedChannel = trimString(post.channel || "facebook").toLowerCase();
  const publisherUsed = requestedChannel === "all" ? "all" : requestedChannel === "instagram" ? "instagram" : "facebook";

  let accessToken;
  try {
    const validation = validateMetaToken(settings);
    accessToken = validation.accessToken;
    if (validation.warning) {
      console.warn("[publish] Meta token warning", { status: validation.status, warning: validation.warning });
    }
  } catch (error) {
    console.error("[publish] Meta token validation failed", {
      status: error?.tokenStatus || null,
      error: error?.message,
    });
    const errorMessage = error?.message || "Meta access token is not valid.";
    const failedResult = { success: false, status: "failed", error_message: errorMessage, external_post_id: null, platform_post_id: null, published_at: null };
    if (requestedChannel === "all") {
      return {
        ...failedResult,
        platform_publish_results: {
          facebook: { status: "failed", platform_post_id: null, error: errorMessage },
          instagram: { status: "failed", platform_post_id: null, error: errorMessage },
        },
      };
    }
    return failedResult;
  }

  console.log("[publish] publisher used:", publisherUsed);

  if (requestedChannel === "instagram") {
    return publishInstagramPost({ post, settings, accessToken });
  }

  if (requestedChannel === "all") {
    return publishAllChannels({ post, settings, accessToken });
  }

  if (requestedChannel === "facebook") {
    return publishFacebookPost({ post, settings, accessToken });
  }

  return {
    success: false,
    status: "failed",
    error_message: `Unsupported publish channel: ${requestedChannel}`,
    external_post_id: null,
    platform_post_id: null,
    published_at: null,
  };
};

export default publishPost;
