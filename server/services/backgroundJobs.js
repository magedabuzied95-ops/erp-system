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

    const privateReplyContext = PRIVATE_REPLY_REQUIRES_WEBHOOK_COMMENT_CONTEXT({ row });
    if (privateReplyContext.source === "meta_comment_poll") {
      if (!privateReplyContext.allowFromPoll) {
        debugSocialCommentsWarn("[social-comments][private-reply] rejected", {
          tenant_id: tenantId,
          platform,
          comment_id: commentId,
          post_id: postId || row.post_id || "",
          reason: privateReplyContext.rejectReason,
        });
        debugSocialCommentsWarn("SOCIAL_COMMENT_PRIVATE_REPLY_REJECTED", {
          tenant_id: tenantId,
          platform,
          comment_id: commentId,
          post_id: postId || row.post_id || "",
          reason: privateReplyContext.rejectReason,
        });
        return { ok: true, skipped: true, reason: privateReplyContext.rejectReason };
      }

      debugSocialCommentsLog("SOCIAL_COMMENT_PRIVATE_REPLY_ALLOWED_FROM_POLL", {
        tenant_id: tenantId,
        platform,
        comment_id: commentId,
        post_id: postId || row.post_id || "",
        created_at: row.created_at || null,
        processed_at: row.processed_at || null,
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
      return { ok: true, skipped: true, reason: currentPrivateReplyStatus === "sending" ? "already_sending" : "already_sent" };
    }

    const settings = await getSocialAutomationSettings(tenantId).catch(() => ({}));
    let productContext = row.product_context || row.raw_payload?.product_context || null;
    if (platform === "facebook" && !productContext) {
      productContext = await resolveSocialCommentPublishedProductContext({ tenantId, row }).catch(() => null);
    }
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
    const message = runtimePrivateReplyMessage || (productContext?.found
      ? buildProductAwarePrivateReply({ row, productContext, settings })
      : (renderTemplate(template || fallbackMessage, {
          commenter_name: row.commenter_name || "",
          original_comment_text: row.original_comment_text || "",
          post_permalink: row.post_permalink || row.post_permalink_url || "",
          post_id: row.post_id || postId || "",
          platform,
        }).trim() || fallbackMessage));

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
      const status = Number(error?.status || error?.metaResponse?.error?.code || 0);
      const messageText = error?.message || "private reply failed";
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
      throw error;
    }
  });
};
