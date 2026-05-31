const PUBLISHED_STATUSES = new Set(["published", "already_published", "posted", "completed"]);

export const normalizeQueueStatus = (status = "") => {
  const normalized = String(status || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/_+/g, "_");
  if (PUBLISHED_STATUSES.has(normalized)) return "published";
  if (normalized === "pendingapproval") return "pending_approval";
  if (normalized === "scheduled") return "approved";
  return normalized;
};

const rawStatusValues = (item = {}) => [item.status, item.publish_status, item.post_status, item.state];
const failedPlatformsFromResults = (results = {}) =>
  Object.values(results || {}).some((value) => value?.status && !["published", "skipped"].includes(value.status));

export const isPublishedQueueItem = (item = {}) =>
  rawStatusValues(item).some((status) => normalizeQueueStatus(status) === "published");

export const getQueueStatusInfo = (item = {}, options = {}) => {
  const rawStatus = item.status ?? "";
  const rawPublishStatus = item.publish_status ?? "";
  const rawPostStatus = item.post_status ?? "";
  const rawState = item.state ?? "";
  const normalizedStatusValues = rawStatusValues(item).map(normalizeQueueStatus).filter(Boolean);
  const normalizedStatus = normalizedStatusValues.includes("archived")
    ? "archived"
    : normalizedStatusValues.includes("published")
    ? "published"
    : normalizeQueueStatus(rawStatus || rawPublishStatus || rawPostStatus || rawState || "pending_approval");
  const displayStatus = options.publishing
    ? "Publishing"
      : ({
        ready: "Ready",
        published: "Published",
        pending_approval: "Pending Approval",
        queued_publish: "Queued Publish",
        publishing: "Publishing",
        publish_failed: "Publish Failed",
        archived: "Archived",
        failed: "Failed",
        queued: "Queued",
        generating_image: "Generating Image",
        uploading: "Uploading",
      }[normalizedStatus] || normalizedStatus.replaceAll("_", " "));
  return {
    id: item.id,
    status: rawStatus,
    publishStatus: rawPublishStatus,
    postStatus: rawPostStatus,
    state: rawState,
    normalizedStatus,
    normalizedStatusValues,
    displayStatus,
    source: options.source || "",
    queueType: options.queueType || item.content_type || item.strategy_type || "",
  };
};

export const canApproveQueueItem = (item = {}) =>
  Boolean(item?.id) && ["pending_approval", "ready"].includes(getQueueStatusInfo(item).normalizedStatus);

export const canPublishQueueItem = (item = {}) =>
  Boolean(item?.id) && (
    ["pending_approval", "approved", "ready", "publish_failed"].includes(getQueueStatusInfo(item).normalizedStatus) ||
    (getQueueStatusInfo(item).normalizedStatus === "published" && failedPlatformsFromResults(item.platform_publish_results))
  );
