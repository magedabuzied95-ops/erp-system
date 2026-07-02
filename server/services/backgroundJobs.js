import db from "../database/db.js";
import { registerJobHandler } from "./jobQueueService.js";
import { sendWhatsappNotification } from "../utils/whatsapp.js";
import { getSocialAutomationSettings } from "./socialAutomationSettingsService.js";
import {
  persistSocialCommentAutomationState,
  buildSocialCommentSuggestedReply,
  PRIVATE_REPLY_REQUIRES_WEBHOOK_COMMENT_CONTEXT,
  resolveSocialCommentPublishedProductContext,
} from "./socialCommentAutomationService.js";
import { renderTemplate, sendPrivateReply } from "./marketingCommentAutomationService.js";

let registered = false;

const hasValue = (value) => value !== undefined && value !== null && String(value).trim() !== "";
const parseDateOrNull = (value = null) => {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};
const isSocialCommentsDebugEnabled = () => String(process.env.DEBUG_SOCIAL_COMMENTS || "").toLowerCase() === "true";
const debugSocialCommentsLog = (...args) => {
  if (isSocialCommentsDebugEnabled()) console.log(...args);
};
const debugSocialCommentsWarn = (...args) => {
  if (isSocialCommentsDebugEnabled()) console.warn(...args);
};
const renderSocialCommentTemplateText = (template = "", context = {}) =>
  String(template || "").replace(/\{\{\s*(\w+)\s*\}\}|\{\s*(\w+)\s*\}/g, (_match, leftKey, rightKey) => {
    const key = leftKey || rightKey || "";
    return String(context[key] ?? context[key.toLowerCase()] ?? "").trim();
  });
const SOCIAL_COMMENT_GENERIC_PRIVATE_REPLIES = new Set([
  "تم الرد على حضرتك خاص",
  "تم الرد على حضرتك في الخاص",
  "تم الرد على حضرتك في الخاص ✅",
  "تم إرسال التفاصيل في رسالة خاصة",
  "تم إرسال التفاصيل في رسالة خاصة ",
]);
const isGenericSocialCommentPrivateReply = (value = "") => {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  return SOCIAL_COMMENT_GENERIC_PRIVATE_REPLIES.has(normalized);
};
const buildPrivateReplyLogPayload = ({ postId = "", commentId = "", productContext = null, replyPreview = "", messagePreview = "" } = {}) => ({
  post_id: String(postId || "").trim(),
  comment_id: String(commentId || "").trim(),
  has_product_context: Boolean(productContext?.found || productContext?.has_product_context),
  product_ids: Array.isArray(productContext?.product_ids)
    ? productContext.product_ids
    : Array.isArray(productContext?.mapped_products)
      ? productContext.mapped_products
        .map((item) => Number(item?.product_id || item?.id || 0))
        .filter((value) => Number.isFinite(value) && value > 0)
      : [],
  primary_product_id: Number(
    productContext?.primary_product?.product_id ||
    productContext?.primary_product?.id ||
    productContext?.product_id ||
    0
  ) || null,
  product_name: String(productContext?.product_name || productContext?.primary_product?.name || "").trim(),
  reply_preview: String(replyPreview || "").trim(),
  message_preview: String(messagePreview || replyPreview || "").trim(),
});

const buildPrivateReplyProductDebugPayload = ({
  tenantId = null,
  platform = "",
  postId = "",
  commentId = "",
  productContext = null,
  replyPreview = "",
  messagePreview = "",
} = {}) => {
  const mappedProducts = asArray(productContext?.mapped_products || []);
  const productIds = Array.isArray(productContext?.product_ids)
    ? productContext.product_ids
    : mappedProducts.map((item) => Number(item?.product_id || item?.id || 0)).filter((value) => Number.isFinite(value) && value > 0);
  const primaryProduct = productContext?.primary_product || mappedProducts[0] || null;
  return {
    tenant_id: Number(tenantId || 0) || null,
    platform: String(platform || "").trim(),
    post_id: String(postId || "").trim(),
    comment_id: String(commentId || "").trim(),
    has_product_context: Boolean(productContext?.found || productContext?.has_product_context),
    product_ids: productIds,
    primary_product_id: Number(primaryProduct?.product_id || primaryProduct?.id || productContext?.product_id || 0) || null,
    product_name: String(productContext?.product_name || primaryProduct?.name || primaryProduct?.product_name || primaryProduct?.title || "").trim(),
    final_price: String(productContext?.final_price || productContext?.price || productContext?.sale_price || productContext?.selling_price || "").trim(),
    available_sizes: asArray(productContext?.available_sizes || productContext?.sizes || primaryProduct?.available_sizes || primaryProduct?.sizes || []),
    available_colors: asArray(productContext?.available_colors || productContext?.colors || primaryProduct?.available_colors || primaryProduct?.colors || []),
    product_link: String(productContext?.product_link || productContext?.product_url || productContext?.storefront_url || primaryProduct?.product_link || primaryProduct?.product_url || primaryProduct?.storefront_url || "").trim(),
    context_source: String(productContext?.source || productContext?.context_source || "").trim(),
    has_message: Boolean(String(messagePreview || "").trim()),
    has_rendered_reply: Boolean(String(replyPreview || "").trim()),
    has_private_reply_payload: Boolean(productContext),
    message_preview: String(messagePreview || replyPreview || "").trim(),
    reply_preview: String(replyPreview || "").trim(),
  };
};
const buildPrivateReplyExitPayload = ({
  reason = "",
  job = {},
  postId = "",
  commentId = "",
  productContext = null,
  message = "",
  renderedReply = "",
  privateReplyPayload = null,
  status = "",
} = {}) => ({
  reason: String(reason || "").trim(),
  job_id: job?.id || null,
  post_id: String(postId || "").trim(),
  comment_id: String(commentId || "").trim(),
  has_product_context: Boolean(productContext?.found || productContext?.has_product_context),
  has_message: Boolean(String(message || "").trim()),
  has_rendered_reply: Boolean(String(renderedReply || "").trim()),
  has_private_reply_payload: Boolean(privateReplyPayload),
  status: String(status || "").trim(),
});
const parsePrivateReplyCommentTimestamp = (row = {}) => {
  const candidates = [
    row.created_at,
    row.processed_at,
    row.updated_at,
    row.raw_payload?.received_at,
    row.raw_payload?.entry?.[0]?.time,
    row.raw_payload?.entry?.[0]?.changes?.[0]?.value?.created_time,
    row.comment_created_time,
  ];
  for (const candidate of candidates) {
    const value = String(candidate || "").trim();
    if (!value) continue;
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }
  return null;
};
const buildProductAwarePrivateReply = ({ row = {}, productContext = {}, settings = {} } = {}) => {
  const defaultTemplate = [
    "أهلًا بحضرتك",
    "ده المنتج اللي سألت عنه:",
    "{product_name}",
    "السعر: {price}",
    "المقاسات المتاحة: {sizes}",
    "اطلبه من هنا:",
    "{product_url}",
  ].join("\n");
  const template = String(settings?.private_message_template || "").trim() || defaultTemplate;
  const sizesText = Array.isArray(productContext.sizes) ? productContext.sizes.filter(Boolean).join(", ") : "";
  return renderSocialCommentTemplateText(template, {
    product_name: productContext.product_name || row.product_name || "",
    price: productContext.price || productContext.sale_price || productContext.selling_price || row.product_price || "",
    sizes: sizesText || "غير متوفرة حاليا",
    product_url: productContext.product_url || row.product_url || "",
    product_color: productContext.color || "",
    product_size: productContext.size || "",
  }).trim();
};

export const registerBackgroundJobHandlers = () => {
  if (registered) return;
  registered = true;

  registerJobHandler("whatsapp.send", async (payload = {}) => {
    const result = await sendWhatsappNotification(payload);
    console.log("[jobs] whatsapp.send result", {
      provider: result?.provider || null,
      ok: Boolean(result?.ok),
      hasFallbackUrl: hasValue(result?.fallbackUrl),
      orderId: payload.orderId || payload.order_id || null,
      invoiceNumber: payload.invoiceNumber || payload.invoice_number || null,
    });
    return result;
  });

  registerJobHandler("email.send", async (payload = {}) => {
    console.warn("[jobs] email.send skipped", {
      reason: "email provider not configured",
      template: payload.template || null,
      hasRecipient: hasValue(payload.to || payload.email),
    });
    return { ok: false, skipped: true, reason: "email provider not configured" };
  });

  registerJobHandler("social.comment.private_reply", async (payload = {}, job = {}) => {
    const tenantId = Number(payload.tenantId || payload.tenant_id || 0);
    const commentId = String(payload.commentId || payload.comment_id || "").trim();
    const platform = String(payload.platform || "facebook").trim().toLowerCase() === "instagram" ? "instagram" : "facebook";
    const postId = String(payload.postId || payload.post_id || "").trim();
    if (!tenantId || !commentId) {
      throw Object.assign(new Error("Invalid social comment private reply job payload"), { status: 400 });
    }

    const rowResult = await db.query(
      `
      SELECT *
      FROM social_comment_automation_runs
      WHERE tenant_id = $1::bigint
        AND platform = $2::text
        AND comment_id = $3::text
      LIMIT 1
      `,
      [tenantId, platform, commentId]
    );
    const row = rowResult.rows?.[0]
      ? { ...(payload.row || {}), ...rowResult.rows[0] }
      : (payload.row || null);
    if (!row) {
      throw Object.assign(new Error("Social comment row not found"), { status: 404 });
    }
    const latencyTrace = payload?.latency_trace && typeof payload.latency_trace === "object"
      ? payload.latency_trace
      : (row?.latency_trace && typeof row.latency_trace === "object" ? row.latency_trace : {});
    const dequeueAt = new Date();
    const enqueueAt = parseDateOrNull(job?.createdAt || latencyTrace.enqueue_at || payload?.created_at || null);
    const detectedAt = parseDateOrNull(latencyTrace.detected_at || null);
    console.log("SOCIAL_COMMENT_LATENCY_DEQUEUED", {
      comment_id: commentId,
      post_id: postId || row.post_id || "",
      dequeue_at: dequeueAt.toISOString(),
      since_enqueue_ms: enqueueAt ? dequeueAt.getTime() - enqueueAt.getTime() : null,
      attempt: job?.attemptsMade || 1,
    });
    const dequeuedProductContext = row.product_context || row.raw_payload?.product_context || null;
    const dequeuedReplyPreview = String(
      row.automation_state?.private_reply?.rendered_reply ||
      row.automation_state?.private_reply?.message ||
      ""
    ).trim();
    console.log("SOCIAL_COMMENT_PRIVATE_REPLY_QUEUE_DEQUEUED", {
      tenant_id: tenantId,
      platform,
      post_id: postId || row.post_id || "",
      comment_id: commentId,
      attempt: job?.attemptsMade || 1,
      max_attempts: job?.maxAttempts || 1,
    });
    console.log("SOCIAL_COMMENT_PRIVATE_REPLY_PAYLOAD_DEBUG", {
      ...buildPrivateReplyExitPayload({
        reason: "queue_dequeued",
        job,
        postId: postId || row.post_id || "",
        commentId,
        productContext: dequeuedProductContext,
        message: row.automation_state?.private_reply?.message || "",
        renderedReply: row.automation_state?.private_reply?.rendered_reply || "",
        privateReplyPayload: row.automation_state?.private_reply || null,
        status: row.dm_status || row.automation_state?.private_reply?.status || "",
      }),
      ...buildPrivateReplyProductDebugPayload({
        tenantId,
        platform,
        postId: postId || row.post_id || "",
        commentId,
        productContext: dequeuedProductContext,
        messagePreview: dequeuedReplyPreview,
        replyPreview: dequeuedReplyPreview,
      }),
    });

    const privateReplyContext = PRIVATE_REPLY_REQUIRES_WEBHOOK_COMMENT_CONTEXT({ row });
    const privateReplyPayload = row.automation_state?.private_reply || null;
    const queuedPrivateReplyIntent = Boolean(
      privateReplyPayload &&
      (
        privateReplyPayload.requested ||
        ["queued", "sending", "sent"].includes(String(privateReplyPayload.status || "").toLowerCase()) ||
        String(privateReplyPayload.message || "").trim() ||
        String(privateReplyPayload.rendered_reply || "").trim()
      )
    );
    const queuedProductContext = row.product_context || row.raw_payload?.product_context || null;
    const hasQueuedProductContext = Boolean(queuedProductContext?.found || queuedProductContext?.has_product_context);
    const currentTime = new Date();
    const commentCreatedAt = parsePrivateReplyCommentTimestamp(row);
    const ageMs = commentCreatedAt ? currentTime.getTime() - commentCreatedAt.getTime() : Number.POSITIVE_INFINITY;
    const maxAllowedAgeMs = 15 * 60 * 1000;
    console.log("SOCIAL_COMMENT_PRIVATE_REPLY_AGE_CHECK", {
      post_id: postId || row.post_id || "",
      comment_id: commentId,
      comment_created_at: commentCreatedAt ? commentCreatedAt.toISOString() : "",
      job_created_at: String(job?.createdAt || job?.timestamp || payload?.created_at || "").trim(),
      current_time: currentTime.toISOString(),
      age_ms: Number.isFinite(ageMs) ? ageMs : null,
      max_allowed_age_ms: maxAllowedAgeMs,
      has_product_context: hasQueuedProductContext,
      has_private_reply_payload: Boolean(privateReplyPayload),
      queued_private_reply_intent: queuedPrivateReplyIntent,
      reject_reason: privateReplyContext.rejectReason,
    });
    if (privateReplyContext.source === "meta_comment_poll") {
      const bypassPollAgeGuard = privateReplyContext.rejectReason === "poll_comment_too_old" && (hasQueuedProductContext || queuedPrivateReplyIntent);
      const effectiveAllowFromPoll = privateReplyContext.allowFromPoll || bypassPollAgeGuard;
      const effectiveRejectReason = bypassPollAgeGuard ? "allowed_queued_private_reply" : privateReplyContext.rejectReason;
      if (!effectiveAllowFromPoll) {
        debugSocialCommentsWarn("[social-comments][private-reply] rejected", {
          tenant_id: tenantId,
          platform,
          comment_id: commentId,
          post_id: postId || row.post_id || "",
          reason: effectiveRejectReason,
        });
        debugSocialCommentsWarn("SOCIAL_COMMENT_PRIVATE_REPLY_REJECTED", {
          tenant_id: tenantId,
          platform,
          comment_id: commentId,
          post_id: postId || row.post_id || "",
          reason: effectiveRejectReason,
        });
        console.log("SOCIAL_COMMENT_PRIVATE_REPLY_EXIT", buildPrivateReplyExitPayload({
          reason: effectiveRejectReason,
          job,
          postId: postId || row.post_id || "",
          commentId,
          productContext: row.product_context || row.raw_payload?.product_context || null,
          message: row.automation_state?.private_reply?.message || "",
          renderedReply: row.automation_state?.private_reply?.rendered_reply || "",
          privateReplyPayload: row.automation_state?.private_reply || null,
          status: row.dm_status || row.automation_state?.private_reply?.status || "",
        }));
        return { ok: true, skipped: true, reason: effectiveRejectReason };
      }

      debugSocialCommentsLog("SOCIAL_COMMENT_PRIVATE_REPLY_ALLOWED_FROM_POLL", {
        tenant_id: tenantId,
        platform,
        comment_id: commentId,
        post_id: postId || row.post_id || "",
        created_at: row.created_at || null,
        processed_at: row.processed_at || null,
        bypass_poll_age_guard: bypassPollAgeGuard,
      });
    }

    const currentPrivateReplyStatus = String(row.dm_status || "").toLowerCase();
    if (currentPrivateReplyStatus === "sent" || currentPrivateReplyStatus === "sending") {
      debugSocialCommentsLog("[social-comments][private-reply] skipped", {
        tenant_id: tenantId,
        platform,
        comment_id: commentId,
        reason: currentPrivateReplyStatus === "sending" ? "already_sending" : "already_sent",
      });
      console.log("SOCIAL_COMMENT_PRIVATE_REPLY_EXIT", buildPrivateReplyExitPayload({
        reason: currentPrivateReplyStatus === "sending" ? "already_sending" : "already_sent",
        job,
        postId: postId || row.post_id || "",
        commentId,
        productContext: row.product_context || row.raw_payload?.product_context || null,
        message: row.automation_state?.private_reply?.message || "",
        renderedReply: row.automation_state?.private_reply?.rendered_reply || "",
        privateReplyPayload: row.automation_state?.private_reply || null,
        status: currentPrivateReplyStatus,
      }));
      return { ok: true, skipped: true, reason: currentPrivateReplyStatus === "sending" ? "already_sending" : "already_sent" };
    }

    const settings = await getSocialAutomationSettings(tenantId).catch(() => ({}));
    let productContext = row.product_context || row.raw_payload?.product_context || null;
    if (platform === "facebook" && !productContext) {
      productContext = await resolveSocialCommentPublishedProductContext({ tenantId, row }).catch(() => null);
    }
    console.log("SOCIAL_COMMENT_PRIVATE_REPLY_RENDER_START", {
      tenant_id: tenantId,
      platform,
      post_id: postId || row.post_id || "",
      comment_id: commentId,
      has_product_context: Boolean(productContext?.found || productContext?.has_product_context),
    });
    const runtimePrivateReplyMessage = String(
      row.automation_state?.private_reply?.rendered_reply ||
      row.automation_state?.private_reply?.message ||
      ""
    ).trim();
    const fallbackMessage = buildSocialCommentSuggestedReply({
      classificationLabel: row.classification_label || "",
      commenterName: row.commenter_name || "",
      originalCommentText: row.original_comment_text || "",
      postPermalink: row.post_permalink || row.post_permalink_url || "",
    });
    const template = String(settings?.private_message_template || "").trim();
    const renderedFallbackMessage = renderTemplate(template || fallbackMessage, {
      commenter_name: row.commenter_name || "",
      original_comment_text: row.original_comment_text || "",
      post_permalink: row.post_permalink || row.post_permalink_url || "",
      post_id: row.post_id || postId || "",
      platform,
    }).trim() || fallbackMessage;
    const initialMessage = runtimePrivateReplyMessage || renderedFallbackMessage;
    const productAwareMessage = (productContext?.found || productContext?.has_product_context)
      ? buildProductAwarePrivateReply({ row, productContext, settings })
      : "";
    if ((productContext?.found || productContext?.has_product_context) && isGenericSocialCommentPrivateReply(initialMessage)) {
      console.warn("SOCIAL_COMMENT_PRIVATE_REPLY_PRODUCT_CONTEXT_DROPPED", buildPrivateReplyLogPayload({
        postId: postId || row.post_id || "",
        commentId,
        productContext,
        replyPreview: initialMessage,
        messagePreview: initialMessage,
      }));
    }
    let message = String(
      (productContext?.found || productContext?.has_product_context) && productAwareMessage
        ? productAwareMessage
        : initialMessage
    ).trim();
    console.log("SOCIAL_COMMENT_PRIVATE_REPLY_RENDER_END", {
      ...buildPrivateReplyProductDebugPayload({
        tenantId,
        platform,
        postId: postId || row.post_id || "",
        commentId,
        productContext,
        messagePreview: message,
        replyPreview: message,
      }),
    });
    console.log("SOCIAL_COMMENT_PRIVATE_REPLY_CONTEXT_USED", buildPrivateReplyLogPayload({
      postId: postId || row.post_id || "",
      commentId,
      productContext,
      replyPreview: message,
      messagePreview: message,
    }));

    debugSocialCommentsLog("[social-comments][private-reply] sending", {
      tenant_id: tenantId,
      platform,
      comment_id: commentId,
      post_id: postId || row.post_id || "",
      attempt: job?.attemptsMade || 1,
      max_attempts: job?.maxAttempts || 1,
    });

    try {
      await persistSocialCommentAutomationState({
        tenantId,
        platform,
        commentId,
        sessionId: row.inbox_conversation_id || "",
        channel: row.channel || "",
        dmStatus: "sending",
        automationState: {
          ...(row.automation_state || {}),
          private_reply: {
            ...(row.automation_state?.private_reply || {}),
            status: "sending",
            sent_at: row.automation_state?.private_reply?.sent_at || "",
            updated_at: new Date().toISOString(),
          },
        },
      });
    } catch {}

    try {
      if ((productContext?.found || productContext?.has_product_context) && isGenericSocialCommentPrivateReply(message) && productAwareMessage) {
        console.warn("SOCIAL_COMMENT_PRIVATE_REPLY_PRODUCT_CONTEXT_DROPPED", buildPrivateReplyLogPayload({
          postId: postId || row.post_id || "",
          commentId,
          productContext,
          replyPreview: message,
          messagePreview: productAwareMessage,
        }));
        message = String(productAwareMessage || "").trim() || message;
      }
      console.log("SOCIAL_COMMENT_PRIVATE_REPLY_CONTEXT_USED", buildPrivateReplyLogPayload({
        postId: postId || row.post_id || "",
        commentId,
        productContext,
        replyPreview: message,
        messagePreview: message,
      }));
      console.log("SOCIAL_COMMENT_PRIVATE_REPLY_SEND_START", buildPrivateReplyProductDebugPayload({
        tenantId,
        platform,
        postId: postId || row.post_id || "",
        commentId,
        productContext,
        messagePreview: message,
        replyPreview: message,
      }));
      const sendStartAt = new Date();
      console.log("SOCIAL_COMMENT_LATENCY_SEND_START", {
        comment_id: commentId,
        post_id: postId || row.post_id || "",
        send_start_at: sendStartAt.toISOString(),
        since_dequeue_ms: sendStartAt.getTime() - dequeueAt.getTime(),
        since_detected_ms: detectedAt ? sendStartAt.getTime() - detectedAt.getTime() : null,
      });
      debugSocialCommentsLog("GRAPH_PRIVATE_REPLY_REQUEST", {
        target_comment_id: commentId,
        platform,
        post_id: postId || row.post_id || "",
      });
      const result = await sendPrivateReply(platform, commentId, message, tenantId);
      debugSocialCommentsLog("GRAPH_PRIVATE_REPLY_RESPONSE", {
        target_comment_id: commentId,
        platform,
        post_id: postId || row.post_id || "",
        ok: true,
        external_id: result?.id || result?.message_id || result?.reply_id || "",
      });
      await persistSocialCommentAutomationState({
        tenantId,
        platform,
        commentId,
        sessionId: row.inbox_conversation_id || "",
        channel: row.channel || "",
        dmStatus: "sent",
        errorCode: "",
        automationState: {
          ...(row.automation_state || {}),
          private_reply: {
            ...(row.automation_state?.private_reply || {}),
            status: "sent",
            sent_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        },
      }).catch(() => {});
      console.log("[social-comments][private-reply] sent", {
        tenant_id: tenantId,
        platform,
        comment_id: commentId,
        post_id: postId || row.post_id || "",
        meta_status: "ok",
        external_id: result?.id || result?.message_id || result?.reply_id || "",
      });
      console.log("SOCIAL_COMMENT_PRIVATE_REPLY_SENT", {
        tenant_id: tenantId,
        platform,
        comment_id: commentId,
        post_id: postId || row.post_id || "",
        external_id: result?.id || result?.message_id || result?.reply_id || "",
      });
      console.log("SOCIAL_COMMENT_PRIVATE_REPLY_SEND_SUCCESS", {
        tenant_id: tenantId,
        platform,
        comment_id: commentId,
        post_id: postId || row.post_id || "",
        external_id: result?.id || result?.message_id || result?.reply_id || "",
      });
      console.log("SOCIAL_COMMENT_PRIVATE_REPLY_EXIT", buildPrivateReplyExitPayload({
        reason: "sent",
        job,
        postId: postId || row.post_id || "",
        commentId,
        productContext,
        message,
        renderedReply: row.automation_state?.private_reply?.rendered_reply || "",
        privateReplyPayload: row.automation_state?.private_reply || null,
        status: "sent",
      }));
      console.log("SOCIAL_COMMENT_LATENCY_SEND_DONE", {
        comment_id: commentId,
        post_id: postId || row.post_id || "",
        status: "success",
        total_ms: detectedAt ? Date.now() - detectedAt.getTime() : null,
        meta_status: "ok",
        meta_message: "",
      });
      return result;
    } catch (error) {
      debugSocialCommentsLog("GRAPH_PRIVATE_REPLY_RESPONSE", {
        target_comment_id: commentId,
        platform,
        post_id: postId || row.post_id || "",
        ok: false,
        status: error?.status || null,
        message: error?.message || "",
      });
      const graphErrorCode = Number(
        error?.metaResponse?.error?.code ||
        error?.response?.data?.error?.code ||
        error?.graphErrorCode ||
        0
      ) || 0;
      const status = Number(error?.status || error?.response?.status || 0);
      const messageText = error?.message || "private reply failed";
      const alreadyReplied = (
        status === 400 &&
        (
          graphErrorCode === 10900 ||
          /Activity already replied to/i.test(messageText)
        )
      );
      if (alreadyReplied) {
        console.log("SOCIAL_COMMENT_PRIVATE_REPLY_ALREADY_REPLIED", {
          tenant_id: tenantId,
          platform,
          post_id: postId || row.post_id || "",
          comment_id: commentId,
          graph_error_code: graphErrorCode || null,
          message: messageText,
        });
        await persistSocialCommentAutomationState({
          tenantId,
          platform,
          commentId,
          sessionId: row.inbox_conversation_id || "",
          channel: row.channel || "",
          dmStatus: "sent",
          errorCode: "",
          automationState: {
            ...(row.automation_state || {}),
            private_reply: {
              ...(row.automation_state?.private_reply || {}),
              status: "duplicate",
              reason: "already_replied",
              sent_at: row.automation_state?.private_reply?.sent_at || new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
          },
        }).catch(() => {});
        console.log("SOCIAL_COMMENT_PRIVATE_REPLY_EXIT", buildPrivateReplyExitPayload({
          reason: "already_replied",
          job,
          postId: postId || row.post_id || "",
          commentId,
          productContext,
          message,
          renderedReply: row.automation_state?.private_reply?.rendered_reply || "",
          privateReplyPayload: row.automation_state?.private_reply || null,
          status: "duplicate",
        }));
        console.log("SOCIAL_COMMENT_LATENCY_SEND_DONE", {
          comment_id: commentId,
          post_id: postId || row.post_id || "",
          status: "duplicate",
          total_ms: detectedAt ? Date.now() - detectedAt.getTime() : null,
          meta_status: status || 400,
          meta_message: messageText,
        });
        return {
          ok: true,
          duplicate: true,
          status: "duplicate",
          reason: "already_replied",
          graph_error_code: graphErrorCode || null,
        };
      }
      const retryable = status === 429 || status >= 500 || /timeout|timed out|fetch failed|network|ECONNREFUSED|ENOTFOUND/i.test(messageText);
      if (job?.attemptsMade >= (job?.maxAttempts || 1)) {
        await persistSocialCommentAutomationState({
          tenantId,
          platform,
          commentId,
          sessionId: row.inbox_conversation_id || "",
          channel: row.channel || "",
          dmStatus: "failed",
          errorCode: "private_reply_failed",
          automationState: {
            ...(row.automation_state || {}),
            private_reply: {
              ...(row.automation_state?.private_reply || {}),
              status: "failed",
              error: messageText,
              updated_at: new Date().toISOString(),
            },
          },
        }).catch(() => {});
      }
      debugSocialCommentsWarn("[social-comments][private-reply] failed", {
        tenant_id: tenantId,
        platform,
        comment_id: commentId,
        post_id: postId || row.post_id || "",
        status: error?.status || null,
        message: messageText,
        retryable,
        attempt: job?.attemptsMade || 1,
        max_attempts: job?.maxAttempts || 1,
      });
      console.log("SOCIAL_COMMENT_PRIVATE_REPLY_FAILED", {
        tenant_id: tenantId,
        platform,
        comment_id: commentId,
        post_id: postId || row.post_id || "",
        status: error?.status || null,
        message: messageText,
        retryable,
        attempt: job?.attemptsMade || 1,
        max_attempts: job?.maxAttempts || 1,
      });
      console.log("SOCIAL_COMMENT_PRIVATE_REPLY_EXIT", buildPrivateReplyExitPayload({
        reason: retryable ? "send_failed_retryable" : "send_failed_non_retryable",
        job,
        postId: postId || row.post_id || "",
        commentId,
        productContext,
        message,
        renderedReply: row.automation_state?.private_reply?.rendered_reply || "",
        privateReplyPayload: row.automation_state?.private_reply || null,
        status: job?.attemptsMade >= (job?.maxAttempts || 1) ? "failed" : "retrying",
      }));
      console.log("SOCIAL_COMMENT_LATENCY_SEND_DONE", {
        comment_id: commentId,
        post_id: postId || row.post_id || "",
        status: "failure",
        total_ms: detectedAt ? Date.now() - detectedAt.getTime() : null,
        meta_status: status || null,
        meta_message: messageText,
      });
      throw error;
    }
  });
};
