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
import { renderTemplate, sendUnifiedSocialCommentPrivateReply } from "./marketingCommentAutomationService.js";
import { buildSocialCommentPrivateReplyMessage } from "./socialCommentPrivateReplyService.js";
import { getPublicAppUrl } from "../utils/publicUrl.js";

let registered = false;

const hasValue = (value) => value !== undefined && value !== null && String(value).trim() !== "";
const asArray = (value) => Array.isArray(value) ? value : value == null ? [] : [value];
const isEmptyLatencyTraceValue = (value) =>
  value == null || (typeof value === "string" && value.trim() === "");
const parseDateOrNull = (value = null) => {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};
const selectLatestDateOrNull = (...values) =>
  values
    .map((value) => parseDateOrNull(value || null))
    .filter(Boolean)
    .sort((a, b) => b.getTime() - a.getTime())[0] || null;
const resolveSocialCommentAiGenerationMs = ({
  aiReplyRenderStartedAt = null,
  aiReplyRenderCompletedAt = null,
  aiStartedAt = null,
  aiCompletedAt = null,
} = {}) => {
  const diff = (end, start) => (end && start ? Math.max(0, end.getTime() - start.getTime()) : null);
  return diff(aiReplyRenderCompletedAt, aiReplyRenderStartedAt) ?? diff(aiCompletedAt, aiStartedAt);
};
const buildSocialCommentCorrelationId = ({ tenantId = null, commentId = "", postId = "", runId = null } = {}) => {
  const safeTenantId = Number(tenantId || 0) || 0;
  const safeCommentId = String(commentId || "").trim();
  const safePostId = String(postId || "").trim();
  const safeRunId = Number(runId || 0) || null;
  return `social-comment:${safeTenantId}:${safePostId || "post"}:${safeCommentId || "comment"}:${safeRunId || "pending"}`;
};
const normalizeTimestampForDb = (value = null, label = "timestamp") => {
  if (value == null || value === "") return null;
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    console.warn("SOCIAL_COMMENT_TIMESTAMP_NORMALIZATION_FAILED", {
      label,
      value: String(value || "").trim(),
    });
    return null;
  }
  return parsed.toISOString();
};
const metadataObject = (value = {}) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});
function mergeSocialCommentLatencyTrace(existingTrace = {}, patchTrace = {}, context = "") {
  const currentTrace = metadataObject(existingTrace || {});
  const incomingTrace = metadataObject(patchTrace || {});
  const latency_trace = { ...currentTrace };
  for (const [key, rawValue] of Object.entries(incomingTrace)) {
    if (isEmptyLatencyTraceValue(rawValue)) {
      if (!(key in latency_trace)) latency_trace[key] = rawValue;
      continue;
    }
    latency_trace[key] = typeof rawValue === "string" ? rawValue.trim() : rawValue;
  }
  console.log("SOCIAL_COMMENT_TRACE_STATE", {
    context,
    keys: Object.keys(latency_trace),
    latency_trace,
  });
  return latency_trace;
}
function mergeSocialCommentRuntimeMonitor(existingRuntimeMonitor = {}, nextRuntimeMonitor = {}, context = "") {
  const currentRuntimeMonitor = metadataObject(existingRuntimeMonitor || {});
  const patchRuntimeMonitor = metadataObject(nextRuntimeMonitor || {});
  const latency_trace = mergeSocialCommentLatencyTrace(
    currentRuntimeMonitor.latency_trace || {},
    patchRuntimeMonitor.latency_trace || {},
    `${context}.latency_trace`
  );
  const runtime_monitor = {
    ...currentRuntimeMonitor,
    ...patchRuntimeMonitor,
    latency_trace,
    latency_summary: computeSocialCommentLatencySummary(latency_trace),
  };
  console.log("SOCIAL_COMMENT_RUNTIME_MONITOR_STATE", {
    context,
    has_latency_trace: Boolean(runtime_monitor.latency_trace && Object.keys(runtime_monitor.latency_trace).length),
    latency_trace_keys: Object.keys(runtime_monitor.latency_trace || {}),
    status: String(runtime_monitor.status || "").trim(),
    private_reply_status: String(runtime_monitor.private_reply_status || runtime_monitor.private_reply?.status || "").trim(),
  });
  return runtime_monitor;
}
const SOCIAL_COMMENT_LATENCY_REQUIRED_FIELDS = [
  "detected_at",
  "enqueue_at",
  "ai_started_at",
  "ai_completed_at",
  "private_reply_enqueued_at",
  "private_reply_started_at",
  "send_started_at",
  "send_completed_at",
];
const collectMissingSocialCommentLatencyFields = (trace = {}, requiredFields = SOCIAL_COMMENT_LATENCY_REQUIRED_FIELDS) => {
  const normalized = metadataObject(trace || {});
  return asArray(requiredFields).filter((field) => !parseDateOrNull(normalized[field] || null));
};
const computeSocialCommentLatencySummary = (trace = {}) => {
  const parse = (value) => parseDateOrNull(value || null);
  const diff = (end, start) => (end && start ? Math.max(0, end.getTime() - start.getTime()) : null);
  const webhookReceivedAt = parse(trace.webhook_received_at);
  const detectedAt = parse(trace.detected_at || trace.webhook_received_at);
  const enqueueAt = parse(trace.enqueue_at);
  const dequeueAt = parse(trace.dequeue_at);
  const aiStartedAt = parse(trace.ai_started_at);
  const aiCompletedAt = parse(trace.ai_completed_at);
  const privateReplyEnqueuedAt = parse(trace.private_reply_enqueued_at || trace.enqueue_at);
  const privateReplyStartedAt = parse(trace.private_reply_started_at || trace.dequeue_at);
  const sendStartedAt = parse(trace.send_started_at);
  const sendCompletedAt = parse(trace.send_completed_at);
  const aiConfigLookupStartedAt = parse(trace.ai_config_lookup_started_at);
  const aiConfigLookupCompletedAt = parse(trace.ai_config_lookup_completed_at);
  const aiProductContextLookupStartedAt = parse(trace.ai_product_context_lookup_started_at);
  const aiProductContextLookupCompletedAt = parse(trace.ai_product_context_lookup_completed_at);
  const aiSalesContextBuildStartedAt = parse(trace.ai_sales_context_build_started_at);
  const aiSalesContextBuildCompletedAt = parse(trace.ai_sales_context_build_completed_at);
  const aiIntentDetectionStartedAt = parse(trace.ai_intent_detection_started_at);
  const aiIntentDetectionCompletedAt = parse(trace.ai_intent_detection_completed_at);
  const aiReplyRenderStartedAt = parse(trace.ai_reply_render_started_at);
  const aiReplyRenderCompletedAt = parse(trace.ai_reply_render_completed_at);
  const publicReplySendStartedAt = parse(trace.public_reply_send_started_at);
  const publicReplySendCompletedAt = parse(trace.public_reply_send_completed_at);
  const privateReplyEnqueueStartedAt = parse(trace.private_reply_enqueue_started_at);
  const privateReplyEnqueueCompletedAt = parse(trace.private_reply_enqueue_completed_at);
  const runtimePhaseCompletedAt = selectLatestDateOrNull(
    trace.runtime_phase_completed_at || null,
    trace.private_reply_enqueue_completed_at || null,
    trace.public_reply_send_completed_at || null,
    trace.ai_completed_at || null
  );
  const missingFields = collectMissingSocialCommentLatencyFields(trace);
  return {
    webhook_to_enqueue_ms: diff(enqueueAt, webhookReceivedAt),
    enqueue_to_ai_start_ms: diff(aiStartedAt, enqueueAt || dequeueAt),
    ai_generation_ms: resolveSocialCommentAiGenerationMs({
      aiReplyRenderStartedAt,
      aiReplyRenderCompletedAt,
      aiStartedAt,
      aiCompletedAt,
    }),
    runtime_phase_ms: diff(runtimePhaseCompletedAt, aiStartedAt),
    ai_to_private_reply_enqueue_ms: diff(privateReplyEnqueuedAt, aiCompletedAt),
    private_reply_queue_wait_ms: diff(privateReplyStartedAt, privateReplyEnqueuedAt),
    send_ms: diff(sendCompletedAt, sendStartedAt),
    total_comment_reply_ms: diff(sendCompletedAt || aiCompletedAt, detectedAt || webhookReceivedAt),
    missing_fields: missingFields,
    ai_breakdown: {
      config_lookup_ms: diff(aiConfigLookupCompletedAt, aiConfigLookupStartedAt),
      product_context_lookup_ms: diff(aiProductContextLookupCompletedAt, aiProductContextLookupStartedAt),
      sales_context_build_ms: diff(aiSalesContextBuildCompletedAt, aiSalesContextBuildStartedAt),
      intent_detection_ms: diff(aiIntentDetectionCompletedAt, aiIntentDetectionStartedAt),
      reply_render_ms: diff(aiReplyRenderCompletedAt, aiReplyRenderStartedAt),
      public_reply_send_ms: diff(publicReplySendCompletedAt, publicReplySendStartedAt),
      private_reply_enqueue_ms: diff(privateReplyEnqueueCompletedAt, privateReplyEnqueueStartedAt),
    },
  };
};
const logSocialCommentLatencySendDone = ({
  row = {},
  commentId = "",
  postId = "",
  status = "",
  metaStatus = null,
  metaMessage = "",
} = {}) => {
  const trace = metadataObject(row?.automation_state?.runtime_monitor?.latency_trace || row?.latency_trace || {});
  const runId = Number(row?.id || trace?.run_id || 0) || null;
  const correlationId = String(trace?.correlation_id || buildSocialCommentCorrelationId({
    tenantId: row?.tenant_id || null,
    commentId,
    postId,
    runId,
  }) || "").trim();
  const summary = computeSocialCommentLatencySummary(trace);
  const missingFields = summary.missing_fields || [];
  if (missingFields.length) {
    console.warn("SOCIAL_COMMENT_LATENCY_MISSING_FIELDS", {
      comment_id: String(commentId || "").trim(),
      post_id: String(postId || row.post_id || "").trim(),
      missing_fields: missingFields,
      present_fields: SOCIAL_COMMENT_LATENCY_REQUIRED_FIELDS.filter((field) => !missingFields.includes(field)),
    });
  }
  console.log("SOCIAL_COMMENT_LATENCY_SEND_DONE", {
    tenant_id: Number(row?.tenant_id || 0) || null,
    comment_id: String(commentId || "").trim(),
    post_id: String(postId || row.post_id || "").trim(),
    run_id: runId,
    correlation_id: correlationId,
    status: String(status || "").trim(),
    detected_at: trace.detected_at || "",
    enqueue_at: trace.enqueue_at || "",
    ai_started_at: trace.ai_started_at || "",
    ai_completed_at: trace.ai_completed_at || "",
    private_reply_enqueued_at: trace.private_reply_enqueued_at || "",
    private_reply_started_at: trace.private_reply_started_at || "",
    send_started_at: trace.send_started_at || "",
    send_completed_at: trace.send_completed_at || "",
    webhook_to_enqueue_ms: summary.webhook_to_enqueue_ms ?? null,
    enqueue_to_ai_start_ms: summary.enqueue_to_ai_start_ms ?? null,
    ai_generation_ms: summary.ai_generation_ms ?? null,
    runtime_phase_ms: summary.runtime_phase_ms ?? null,
    ai_to_private_reply_enqueue_ms: summary.ai_to_private_reply_enqueue_ms ?? null,
    private_reply_queue_wait_ms: summary.private_reply_queue_wait_ms ?? null,
    send_ms: summary.send_ms ?? null,
    total_comment_reply_ms: summary.total_comment_reply_ms ?? null,
    total_ms: summary.total_comment_reply_ms ?? null,
    ai_breakdown: summary.ai_breakdown || null,
    latency_summary: summary,
    meta_status: metaStatus,
    meta_message: metaMessage,
    missing_fields: missingFields,
  });
};
const withSocialCommentLatencyState = ({ row = {}, automationState = {}, patch = {}, status = "", errorMessage = "" } = {}) => {
  const safeState = metadataObject(automationState || {});
  const currentMonitor = metadataObject(safeState.runtime_monitor || row.automation_state?.runtime_monitor || {});
  const normalizeTrace = (trace = {}) => ({
    ...metadataObject(trace || {}),
    webhook_received_at: normalizeTimestampForDb(trace.webhook_received_at || null, "backgroundJobs.withSocialCommentLatencyState.webhook_received_at"),
    detected_at: normalizeTimestampForDb(trace.detected_at || null, "backgroundJobs.withSocialCommentLatencyState.detected_at"),
    stored_at: normalizeTimestampForDb(trace.stored_at || null, "backgroundJobs.withSocialCommentLatencyState.stored_at"),
    comment_stored_at: normalizeTimestampForDb(trace.comment_stored_at || null, "backgroundJobs.withSocialCommentLatencyState.comment_stored_at"),
    enqueue_at: normalizeTimestampForDb(trace.enqueue_at || null, "backgroundJobs.withSocialCommentLatencyState.enqueue_at"),
    private_reply_enqueued_at: normalizeTimestampForDb(trace.private_reply_enqueued_at || null, "backgroundJobs.withSocialCommentLatencyState.private_reply_enqueued_at"),
    dequeue_at: normalizeTimestampForDb(trace.dequeue_at || null, "backgroundJobs.withSocialCommentLatencyState.dequeue_at"),
    private_reply_started_at: normalizeTimestampForDb(trace.private_reply_started_at || null, "backgroundJobs.withSocialCommentLatencyState.private_reply_started_at"),
    ai_started_at: normalizeTimestampForDb(trace.ai_started_at || null, "backgroundJobs.withSocialCommentLatencyState.ai_started_at"),
    ai_completed_at: normalizeTimestampForDb(trace.ai_completed_at || null, "backgroundJobs.withSocialCommentLatencyState.ai_completed_at"),
    ai_config_lookup_started_at: normalizeTimestampForDb(trace.ai_config_lookup_started_at || null, "backgroundJobs.withSocialCommentLatencyState.ai_config_lookup_started_at"),
    ai_config_lookup_completed_at: normalizeTimestampForDb(trace.ai_config_lookup_completed_at || null, "backgroundJobs.withSocialCommentLatencyState.ai_config_lookup_completed_at"),
    ai_product_context_lookup_started_at: normalizeTimestampForDb(trace.ai_product_context_lookup_started_at || null, "backgroundJobs.withSocialCommentLatencyState.ai_product_context_lookup_started_at"),
    ai_product_context_lookup_completed_at: normalizeTimestampForDb(trace.ai_product_context_lookup_completed_at || null, "backgroundJobs.withSocialCommentLatencyState.ai_product_context_lookup_completed_at"),
    ai_sales_context_build_started_at: normalizeTimestampForDb(trace.ai_sales_context_build_started_at || null, "backgroundJobs.withSocialCommentLatencyState.ai_sales_context_build_started_at"),
    ai_sales_context_build_completed_at: normalizeTimestampForDb(trace.ai_sales_context_build_completed_at || null, "backgroundJobs.withSocialCommentLatencyState.ai_sales_context_build_completed_at"),
    ai_intent_detection_started_at: normalizeTimestampForDb(trace.ai_intent_detection_started_at || null, "backgroundJobs.withSocialCommentLatencyState.ai_intent_detection_started_at"),
    ai_intent_detection_completed_at: normalizeTimestampForDb(trace.ai_intent_detection_completed_at || null, "backgroundJobs.withSocialCommentLatencyState.ai_intent_detection_completed_at"),
    ai_reply_render_started_at: normalizeTimestampForDb(trace.ai_reply_render_started_at || null, "backgroundJobs.withSocialCommentLatencyState.ai_reply_render_started_at"),
    ai_reply_render_completed_at: normalizeTimestampForDb(trace.ai_reply_render_completed_at || null, "backgroundJobs.withSocialCommentLatencyState.ai_reply_render_completed_at"),
    public_reply_send_started_at: normalizeTimestampForDb(trace.public_reply_send_started_at || null, "backgroundJobs.withSocialCommentLatencyState.public_reply_send_started_at"),
    public_reply_send_completed_at: normalizeTimestampForDb(trace.public_reply_send_completed_at || null, "backgroundJobs.withSocialCommentLatencyState.public_reply_send_completed_at"),
    private_reply_enqueue_started_at: normalizeTimestampForDb(trace.private_reply_enqueue_started_at || null, "backgroundJobs.withSocialCommentLatencyState.private_reply_enqueue_started_at"),
    private_reply_enqueue_completed_at: normalizeTimestampForDb(trace.private_reply_enqueue_completed_at || null, "backgroundJobs.withSocialCommentLatencyState.private_reply_enqueue_completed_at"),
    send_started_at: normalizeTimestampForDb(trace.send_started_at || null, "backgroundJobs.withSocialCommentLatencyState.send_started_at"),
    send_completed_at: normalizeTimestampForDb(trace.send_completed_at || null, "backgroundJobs.withSocialCommentLatencyState.send_completed_at"),
  });
  const nextTrace = mergeSocialCommentLatencyTrace(
    normalizeTrace(currentMonitor.latency_trace || row.automation_state?.runtime_monitor?.latency_trace || {}),
    normalizeTrace(metadataObject(patch || {})),
    "backgroundJobs.withSocialCommentLatencyState"
  );
  return {
    ...safeState,
    runtime_monitor: mergeSocialCommentRuntimeMonitor(
      currentMonitor,
      {
        status: String(status || currentMonitor.status || "").trim(),
        error_message: String(errorMessage || currentMonitor.error_message || "").trim(),
        latency_trace: nextTrace,
        updated_at: new Date().toISOString(),
      },
      "backgroundJobs.withSocialCommentLatencyState"
    ),
  };
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
const isAbsoluteHttpUrl = (value = "") => /^https?:\/\//i.test(String(value || "").trim());
const ensureAbsoluteProductLink = (value = "") => {
  const normalized = String(value || "").trim();
  const publicUrl = String(getPublicAppUrl() || "").trim().replace(/\/+$/g, "");
  if (!normalized) return publicUrl ? `${publicUrl}/shop/products` : "";
  if (isAbsoluteHttpUrl(normalized)) return normalized;
  if (!publicUrl) return normalized;
  return `${publicUrl}${normalized.startsWith("/") ? normalized : `/${normalized}`}`;
};
const sortSizesAscending = (values = []) =>
  asArray(values)
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .filter((value, index, array) => array.indexOf(value) === index)
    .sort((left, right) => {
      const leftNumber = Number.parseFloat(left);
      const rightNumber = Number.parseFloat(right);
      const leftIsNumber = Number.isFinite(leftNumber);
      const rightIsNumber = Number.isFinite(rightNumber);
      if (leftIsNumber && rightIsNumber) return leftNumber - rightNumber;
      if (leftIsNumber) return -1;
      if (rightIsNumber) return 1;
      return left.localeCompare(right, "ar", { numeric: true, sensitivity: "base" });
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
const selectFinalPrivateReplyMessage = ({
  hasProductContext = false,
  queuedPrivateReplyPayload = null,
  storedPrivateReplyPayload = null,
  runtimeProductAwareMessage = "",
  renderedFallbackMessage = "",
} = {}) => {
  const candidates = [
    {
      source: "queued_rendered_reply",
      value: queuedPrivateReplyPayload?.rendered_reply,
    },
    {
      source: "stored_rendered_reply",
      value: storedPrivateReplyPayload?.rendered_reply,
    },
    {
      source: "queued_message",
      value: queuedPrivateReplyPayload?.message,
    },
    {
      source: "stored_message",
      value: storedPrivateReplyPayload?.message,
    },
    {
      source: "runtime_product_context",
      value: runtimeProductAwareMessage,
    },
    {
      source: "rendered_fallback",
      value: renderedFallbackMessage,
    },
  ].map((candidate) => ({
    source: candidate.source,
    value: String(candidate.value || "").trim(),
  }));

  const preferredCandidate = candidates.find((candidate) =>
    candidate.value && (!hasProductContext || !isGenericSocialCommentPrivateReply(candidate.value))
  );
  const fallbackCandidate = candidates.find((candidate) => candidate.value);
  const selected = preferredCandidate || fallbackCandidate || { source: "empty", value: "" };

  return {
    selectedSource: selected.source,
    message: selected.value,
    candidates,
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
const buildPolishedProductAwarePrivateReply = ({ row = {}, productContext = {} } = {}) => {
  const customerName = String(row.commenter_name || row.customer_name || "").trim();
  const productName = String(productContext.product_name || row.product_name || "").trim();
  const sizesList = sortSizesAscending(productContext.available_sizes || productContext.sizes || []);
  const sizesLabel = sizesList.length
    ? sizesList.join(", ")
    : "برجاء تأكيد المقاس المطلوب وهنراجع التوفر لحضرتك";
  const productLink = ensureAbsoluteProductLink(
    productContext.product_link ||
    productContext.product_url ||
    productContext.storefront_url ||
    row.product_url ||
    ""
  );
  return [
    customerName ? `أهلًا بحضرتك يا ${customerName}` : "أهلًا بحضرتك",
    "",
    "✅ المنتج اللي سألت عنه:",
    productName || "المنتج",
    "",
    `المقاسات المتاحة: ${sizesLabel}`,
    "",
    "لينك المنتج:",
    productLink,
    "",
    "لو مقاس حضرتك موجود، ابعتلنا المقاس ونكمل الطلب فورًا ️",
  ].join("\n").trim();
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
    const runId = Number(row.id || payload?.row?.id || job?.id || 0) || null;
    const correlationId = String(
      payload?.latency_trace?.correlation_id ||
      row?.automation_state?.runtime_monitor?.latency_trace?.correlation_id ||
      buildSocialCommentCorrelationId({
        tenantId,
        commentId,
        postId: postId || row.post_id || "",
        runId,
      })
    ).trim();
    const latencyTrace = payload?.latency_trace && typeof payload.latency_trace === "object"
      ? payload.latency_trace
      : (row?.latency_trace && typeof row.latency_trace === "object" ? row.latency_trace : {});
    const dequeueAt = new Date();
    const enqueueAt = parseDateOrNull(job?.createdAt || latencyTrace.enqueue_at || latencyTrace.private_reply_enqueued_at || payload?.created_at || null);
    const detectedAt = parseDateOrNull(latencyTrace.detected_at || row?.automation_state?.runtime_monitor?.latency_trace?.detected_at || null);
    const privateReplyStartedAt = dequeueAt;
    const currentLatencyTrace = mergeSocialCommentLatencyTrace(
      metadataObject(row?.automation_state?.runtime_monitor?.latency_trace || row?.latency_trace || {}),
      {
        enqueue_at: normalizeTimestampForDb(enqueueAt || latencyTrace.enqueue_at || null, "backgroundJobs.private_reply.enqueue_at"),
        private_reply_enqueued_at: normalizeTimestampForDb(latencyTrace.private_reply_enqueued_at || enqueueAt || dequeueAt, "backgroundJobs.private_reply.private_reply_enqueued_at"),
        private_reply_started_at: normalizeTimestampForDb(privateReplyStartedAt, "backgroundJobs.private_reply.private_reply_started_at"),
        detected_at: normalizeTimestampForDb(detectedAt || null, "backgroundJobs.private_reply.detected_at"),
        ai_started_at: normalizeTimestampForDb(latencyTrace.ai_started_at || row?.automation_state?.runtime_monitor?.latency_trace?.ai_started_at || null, "backgroundJobs.private_reply.ai_started_at"),
        ai_completed_at: normalizeTimestampForDb(latencyTrace.ai_completed_at || row?.automation_state?.runtime_monitor?.latency_trace?.ai_completed_at || null, "backgroundJobs.private_reply.ai_completed_at"),
        ai_config_lookup_started_at: normalizeTimestampForDb(latencyTrace.ai_config_lookup_started_at || row?.automation_state?.runtime_monitor?.latency_trace?.ai_config_lookup_started_at || null, "backgroundJobs.private_reply.ai_config_lookup_started_at"),
        ai_config_lookup_completed_at: normalizeTimestampForDb(latencyTrace.ai_config_lookup_completed_at || row?.automation_state?.runtime_monitor?.latency_trace?.ai_config_lookup_completed_at || null, "backgroundJobs.private_reply.ai_config_lookup_completed_at"),
        ai_product_context_lookup_started_at: normalizeTimestampForDb(latencyTrace.ai_product_context_lookup_started_at || row?.automation_state?.runtime_monitor?.latency_trace?.ai_product_context_lookup_started_at || null, "backgroundJobs.private_reply.ai_product_context_lookup_started_at"),
        ai_product_context_lookup_completed_at: normalizeTimestampForDb(latencyTrace.ai_product_context_lookup_completed_at || row?.automation_state?.runtime_monitor?.latency_trace?.ai_product_context_lookup_completed_at || null, "backgroundJobs.private_reply.ai_product_context_lookup_completed_at"),
        ai_sales_context_build_started_at: normalizeTimestampForDb(latencyTrace.ai_sales_context_build_started_at || row?.automation_state?.runtime_monitor?.latency_trace?.ai_sales_context_build_started_at || null, "backgroundJobs.private_reply.ai_sales_context_build_started_at"),
        ai_sales_context_build_completed_at: normalizeTimestampForDb(latencyTrace.ai_sales_context_build_completed_at || row?.automation_state?.runtime_monitor?.latency_trace?.ai_sales_context_build_completed_at || null, "backgroundJobs.private_reply.ai_sales_context_build_completed_at"),
        ai_intent_detection_started_at: normalizeTimestampForDb(latencyTrace.ai_intent_detection_started_at || row?.automation_state?.runtime_monitor?.latency_trace?.ai_intent_detection_started_at || null, "backgroundJobs.private_reply.ai_intent_detection_started_at"),
        ai_intent_detection_completed_at: normalizeTimestampForDb(latencyTrace.ai_intent_detection_completed_at || row?.automation_state?.runtime_monitor?.latency_trace?.ai_intent_detection_completed_at || null, "backgroundJobs.private_reply.ai_intent_detection_completed_at"),
        ai_reply_render_started_at: normalizeTimestampForDb(latencyTrace.ai_reply_render_started_at || row?.automation_state?.runtime_monitor?.latency_trace?.ai_reply_render_started_at || null, "backgroundJobs.private_reply.ai_reply_render_started_at"),
        ai_reply_render_completed_at: normalizeTimestampForDb(latencyTrace.ai_reply_render_completed_at || row?.automation_state?.runtime_monitor?.latency_trace?.ai_reply_render_completed_at || null, "backgroundJobs.private_reply.ai_reply_render_completed_at"),
        public_reply_send_started_at: normalizeTimestampForDb(latencyTrace.public_reply_send_started_at || row?.automation_state?.runtime_monitor?.latency_trace?.public_reply_send_started_at || null, "backgroundJobs.private_reply.public_reply_send_started_at"),
        public_reply_send_completed_at: normalizeTimestampForDb(latencyTrace.public_reply_send_completed_at || row?.automation_state?.runtime_monitor?.latency_trace?.public_reply_send_completed_at || null, "backgroundJobs.private_reply.public_reply_send_completed_at"),
        private_reply_enqueue_started_at: normalizeTimestampForDb(latencyTrace.private_reply_enqueue_started_at || row?.automation_state?.runtime_monitor?.latency_trace?.private_reply_enqueue_started_at || null, "backgroundJobs.private_reply.private_reply_enqueue_started_at"),
        private_reply_enqueue_completed_at: normalizeTimestampForDb(latencyTrace.private_reply_enqueue_completed_at || row?.automation_state?.runtime_monitor?.latency_trace?.private_reply_enqueue_completed_at || null, "backgroundJobs.private_reply.private_reply_enqueue_completed_at"),
        send_started_at: normalizeTimestampForDb(latencyTrace.send_started_at || null, "backgroundJobs.private_reply.send_started_at"),
        send_completed_at: normalizeTimestampForDb(latencyTrace.send_completed_at || null, "backgroundJobs.private_reply.send_completed_at"),
        webhook_received_at: normalizeTimestampForDb(latencyTrace.webhook_received_at || row?.automation_state?.runtime_monitor?.latency_trace?.webhook_received_at || null, "backgroundJobs.private_reply.webhook_received_at"),
      },
      "backgroundJobs.private_reply.currentLatencyTrace"
    );
    console.log("[jobs] start social.comment.private_reply", {
      tenant_id: tenantId,
      platform,
      post_id: postId || row.post_id || "",
      comment_id: commentId,
      run_id: runId,
      correlation_id: correlationId,
      enqueue_at: currentLatencyTrace.enqueue_at || "",
      private_reply_enqueued_at: currentLatencyTrace.private_reply_enqueued_at || "",
      private_reply_started_at: currentLatencyTrace.private_reply_started_at || "",
      detected_at: currentLatencyTrace.detected_at || "",
    });
    console.log("SOCIAL_COMMENT_LATENCY_DEQUEUED", {
      comment_id: commentId,
      post_id: postId || row.post_id || "",
      run_id: runId,
      correlation_id: correlationId,
      dequeue_at: dequeueAt.toISOString(),
      since_enqueue_ms: enqueueAt ? dequeueAt.getTime() - enqueueAt.getTime() : null,
      attempt: job?.attemptsMade || 1,
    });
    row.automation_state = withSocialCommentLatencyState({
      row,
      automationState: row.automation_state,
      patch: {
        dequeue_at: dequeueAt.toISOString(),
        private_reply_started_at: privateReplyStartedAt.toISOString(),
        enqueue_at: currentLatencyTrace.enqueue_at || (enqueueAt ? enqueueAt.toISOString() : ""),
        private_reply_enqueued_at: currentLatencyTrace.private_reply_enqueued_at || (enqueueAt ? enqueueAt.toISOString() : ""),
        detected_at: currentLatencyTrace.detected_at || "",
        webhook_received_at: currentLatencyTrace.webhook_received_at || "",
      },
      status: "processing",
    });
    await persistSocialCommentAutomationState({
      tenantId,
      platform,
      commentId,
      sessionId: row.inbox_conversation_id || "",
      channel: row.channel || "",
      automationState: row.automation_state,
    }).catch(() => null);
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
      run_id: runId,
      correlation_id: correlationId,
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
    const queuedPrivateReplyPayload = payload?.row?.automation_state?.private_reply || null;
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
    const fallbackMessage = buildSocialCommentSuggestedReply({
      classificationLabel: row.classification_label || "",
      commenterName: row.commenter_name || "",
      originalCommentText: row.original_comment_text || "",
      postPermalink: row.post_permalink || row.post_permalink_url || "",
    });
    const template = String(
      queuedPrivateReplyPayload?.template ||
      privateReplyPayload?.template ||
      settings?.private_message_template ||
      ""
    ).trim();
    const renderedFallbackMessage = renderTemplate(fallbackMessage, {
      commenter_name: row.commenter_name || "",
      original_comment_text: row.original_comment_text || "",
      post_permalink: row.post_permalink || row.post_permalink_url || "",
      post_id: row.post_id || postId || "",
      platform,
    }).trim() || fallbackMessage;
    const finalMessageSelection = await buildSocialCommentPrivateReplyMessage({
      tenantId,
      platform,
      commentId,
      postId: postId || row.post_id || "",
      customerName: row.commenter_name || row.customer_name || "",
      productContext: productContext || null,
      automationTemplate: template,
      fallbackTemplate: renderedFallbackMessage,
    });
    if ((productContext?.found || productContext?.has_product_context) && isGenericSocialCommentPrivateReply(finalMessageSelection.message)) {
      console.warn("SOCIAL_COMMENT_PRIVATE_REPLY_PRODUCT_CONTEXT_DROPPED", buildPrivateReplyLogPayload({
        postId: postId || row.post_id || "",
        commentId,
        productContext,
        replyPreview: finalMessageSelection.message,
        messagePreview: finalMessageSelection.message,
      }));
    }
    let message = String(finalMessageSelection.message || "").trim();
    console.log("SOCIAL_COMMENT_PRIVATE_REPLY_FINAL_MESSAGE_SELECTED", {
      comment_id: commentId,
      has_product_context: Boolean(productContext?.found || productContext?.has_product_context),
      selected_source: finalMessageSelection.selectedSource,
      automation_state_rendered_reply_preview: String(privateReplyPayload?.rendered_reply || "").trim().slice(0, 280),
      automation_state_message_preview: String(privateReplyPayload?.message || "").trim().slice(0, 280),
      private_reply_payload_message_preview: String(queuedPrivateReplyPayload?.message || "").trim().slice(0, 280),
      message_preview: message.slice(0, 280),
    });
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

    console.log("SOCIAL_COMMENT_PRIVATE_REPLY_PRE_SEND_STAGE", {
      stage: "persist_sending_start",
      comment_id: commentId,
      post_id: postId || row.post_id || "",
    });
    try {
      const sendingState = withSocialCommentLatencyState({
        row,
        automationState: {
          ...(row.automation_state || {}),
          private_reply: {
            ...(row.automation_state?.private_reply || {}),
            status: "sending",
            sent_at: row.automation_state?.private_reply?.sent_at || "",
            updated_at: new Date().toISOString(),
          },
        },
        patch: {
          ai_completed_at: new Date().toISOString(),
        },
        status: "sending",
      });
      await persistSocialCommentAutomationState({
        tenantId,
        platform,
        commentId,
        sessionId: row.inbox_conversation_id || "",
        channel: row.channel || "",
        dmStatus: "sending",
        automationState: sendingState,
      });
      row.automation_state = sendingState;
      console.log("SOCIAL_COMMENT_PRIVATE_REPLY_PRE_SEND_STAGE", {
        stage: "persist_sending_done",
        comment_id: commentId,
        post_id: postId || row.post_id || "",
      });
    } catch (error) {
      console.log("SOCIAL_COMMENT_PRIVATE_REPLY_PRE_SEND_EXIT", {
        branch: "persist_sending_failed_continues",
        comment_id: commentId,
        post_id: postId || row.post_id || "",
        message: error?.message || String(error || ""),
      });
    }

    let preSendStage = "send_try_enter";
    try {
      console.log("SOCIAL_COMMENT_PRIVATE_REPLY_PRE_SEND_STAGE", {
        stage: preSendStage,
        comment_id: commentId,
        post_id: postId || row.post_id || "",
      });
      preSendStage = "product_context_guard_check";
      console.log("SOCIAL_COMMENT_PRIVATE_REPLY_FINAL_MESSAGE_SELECTED", {
        comment_id: commentId,
        has_product_context: Boolean(productContext?.found || productContext?.has_product_context),
        selected_source: finalMessageSelection.selectedSource,
        automation_state_rendered_reply_preview: String(privateReplyPayload?.rendered_reply || "").trim().slice(0, 280),
        automation_state_message_preview: String(privateReplyPayload?.message || "").trim().slice(0, 280),
        private_reply_payload_message_preview: String(queuedPrivateReplyPayload?.message || "").trim().slice(0, 280),
        message_preview: String(message || "").trim().slice(0, 280),
      });
      console.log("SOCIAL_COMMENT_PRIVATE_REPLY_PRE_SEND_STAGE", {
        stage: "post_guard_message_ready",
        comment_id: commentId,
        post_id: postId || row.post_id || "",
        has_message: Boolean(String(message || "").trim()),
      });
      preSendStage = "context_used_log";
      console.log("SOCIAL_COMMENT_PRIVATE_REPLY_CONTEXT_USED", buildPrivateReplyLogPayload({
        postId: postId || row.post_id || "",
        commentId,
        productContext,
        replyPreview: message,
        messagePreview: message,
      }));
      console.log("SOCIAL_COMMENT_PRIVATE_REPLY_PRE_SEND_STAGE", {
        stage: "context_used_logged",
        comment_id: commentId,
        post_id: postId || row.post_id || "",
      });
      preSendStage = "send_start_log";
      console.log("SOCIAL_COMMENT_PRIVATE_REPLY_SEND_START", {
        ...buildPrivateReplyProductDebugPayload({
          tenantId,
          platform,
          postId: postId || row.post_id || "",
          commentId,
          productContext,
          messagePreview: message,
          replyPreview: message,
        }),
        run_id: runId,
        correlation_id: correlationId,
      });
      console.log("SOCIAL_COMMENT_PRIVATE_REPLY_START", {
        tenant_id: tenantId,
        platform,
        post_id: postId || row.post_id || "",
        comment_id: commentId,
        run_id: runId,
        correlation_id: correlationId,
      });
      console.log("SOCIAL_COMMENT_PRIVATE_REPLY_PRE_SEND_STAGE", {
        stage: "send_start_logged",
        comment_id: commentId,
        post_id: postId || row.post_id || "",
      });
      const sendStartAt = new Date();
      row.automation_state = withSocialCommentLatencyState({
        row,
        automationState: row.automation_state,
        patch: {
          send_started_at: sendStartAt.toISOString(),
        },
        status: "sending",
      });
      await persistSocialCommentAutomationState({
        tenantId,
        platform,
        commentId,
        sessionId: row.inbox_conversation_id || "",
        channel: row.channel || "",
        dmStatus: "sending",
        automationState: row.automation_state,
      }).catch(() => null);
      console.log("SOCIAL_COMMENT_LATENCY_SEND_START", {
        comment_id: commentId,
        post_id: postId || row.post_id || "",
        send_start_at: sendStartAt.toISOString(),
        since_dequeue_ms: sendStartAt.getTime() - dequeueAt.getTime(),
        since_detected_ms: detectedAt ? sendStartAt.getTime() - detectedAt.getTime() : null,
      });
      console.log("SOCIAL_COMMENT_PRIVATE_REPLY_PRE_SEND_STAGE", {
        stage: "before_send_private_reply_call",
        comment_id: commentId,
        post_id: postId || row.post_id || "",
      });
      console.log("SOCIAL_COMMENT_PRIVATE_REPLY_SEND_MESSAGE_TRACE", {
        comment_id: commentId,
        post_id: postId || row.post_id || "",
        selected_source: finalMessageSelection.selectedSource,
        message_preview: String(message || "").trim().slice(0, 280),
      });
      debugSocialCommentsLog("GRAPH_PRIVATE_REPLY_REQUEST", {
        target_comment_id: commentId,
        platform,
        post_id: postId || row.post_id || "",
      });
      const result = await sendUnifiedSocialCommentPrivateReply({
        tenantId,
        platform,
        commentId,
        message,
        callsite: "backgroundJobs.social.comment.private_reply",
        postId: postId || row.post_id || "",
        conversationId: row.inbox_conversation_id || row.external_conversation_id || "",
        productContext,
        customerName: row.commenter_name || row.customer_name || "",
      });
      debugSocialCommentsLog("GRAPH_PRIVATE_REPLY_RESPONSE", {
        target_comment_id: commentId,
        platform,
        post_id: postId || row.post_id || "",
        ok: true,
        external_id: result?.id || result?.message_id || result?.reply_id || "",
      });
      const sentAt = new Date().toISOString();
      row.automation_state = withSocialCommentLatencyState({
        row,
        automationState: {
          ...(row.automation_state || {}),
          private_reply: {
            ...(row.automation_state?.private_reply || {}),
            status: "sent",
            sent_at: sentAt,
            updated_at: sentAt,
          },
        },
        patch: {
          send_completed_at: sentAt,
        },
        status: "sent",
      });
      await persistSocialCommentAutomationState({
        tenantId,
        platform,
        commentId,
        sessionId: row.inbox_conversation_id || "",
        channel: row.channel || "",
        dmStatus: "sent",
        errorCode: "",
        automationState: row.automation_state,
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
        run_id: runId,
        correlation_id: correlationId,
        external_id: result?.id || result?.message_id || result?.reply_id || "",
      });
      console.log("SOCIAL_COMMENT_PRIVATE_REPLY_SEND_SUCCESS", {
        tenant_id: tenantId,
        platform,
        comment_id: commentId,
        post_id: postId || row.post_id || "",
        run_id: runId,
        correlation_id: correlationId,
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
      logSocialCommentLatencySendDone({
        row,
        commentId,
        postId: postId || row.post_id || "",
        status: "success",
        metaStatus: "ok",
        metaMessage: "",
      });
      console.log("SOCIAL_COMMENT_FLOW_COMPLETE", {
        tenant_id: tenantId,
        platform,
        comment_id: commentId,
        post_id: postId || row.post_id || "",
        run_id: runId,
        correlation_id: correlationId,
      });
      return result;
    } catch (error) {
      console.log("SOCIAL_COMMENT_PRIVATE_REPLY_PRE_SEND_EXIT", {
        branch: "send_try_catch",
        stage: preSendStage,
        comment_id: commentId,
        post_id: postId || row.post_id || "",
        message: error?.message || String(error || ""),
      });
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
        const duplicateSentAt = new Date().toISOString();
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
          automationState: withSocialCommentLatencyState({
            row,
            automationState: {
              ...(row.automation_state || {}),
              private_reply: {
                ...(row.automation_state?.private_reply || {}),
                status: "duplicate",
                reason: "already_replied",
                sent_at: row.automation_state?.private_reply?.sent_at || duplicateSentAt,
                updated_at: duplicateSentAt,
              },
            },
            patch: {
              send_completed_at: duplicateSentAt,
            },
            status: "duplicate",
            errorMessage: messageText,
          }),
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
        logSocialCommentLatencySendDone({
          row,
          commentId,
          postId: postId || row.post_id || "",
          status: "duplicate",
          metaStatus: status || 400,
          metaMessage: messageText,
        });
        console.log("SOCIAL_COMMENT_FLOW_COMPLETE", {
          tenant_id: tenantId,
          platform,
          comment_id: commentId,
          post_id: postId || row.post_id || "",
          run_id: runId,
          correlation_id: correlationId,
          status: "duplicate",
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
        const failedAt = new Date().toISOString();
        await persistSocialCommentAutomationState({
          tenantId,
          platform,
          commentId,
          sessionId: row.inbox_conversation_id || "",
          channel: row.channel || "",
          dmStatus: "failed",
          errorCode: "private_reply_failed",
          automationState: withSocialCommentLatencyState({
            row,
            automationState: {
              ...(row.automation_state || {}),
              private_reply: {
                ...(row.automation_state?.private_reply || {}),
                status: "failed",
                error: messageText,
                updated_at: failedAt,
              },
            },
            patch: {
              send_completed_at: failedAt,
            },
            status: "failed",
            errorMessage: messageText,
          }),
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
      logSocialCommentLatencySendDone({
        row,
        commentId,
        postId: postId || row.post_id || "",
        status: "failure",
        metaStatus: status || null,
        metaMessage: messageText,
      });
      throw error;
    }
  });
};
