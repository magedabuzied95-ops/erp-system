/*
 * Every display decision the WhatsApp queue dashboard makes, as pure functions.
 *
 * Kept out of the panel so they can be tested directly: the ERP sits behind a login, so a panel
 * whose judgement calls — is the queue latched, is the backlog over the line, is a brake switched
 * off — are only reachable through the UI is a panel nothing verifies.
 */

/* The seven row states, in the order a message travels through them. */
export const STATUS_ORDER = ["pending", "scheduled", "sending", "sent", "failed", "expired", "cancelled"];

export const STATUS_TONE = {
  pending: "text-amber-200",
  scheduled: "text-sky-200",
  sending: "text-cyan-200",
  sent: "text-emerald-200",
  failed: "text-rose-200",
  expired: "text-slate-400",
  cancelled: "text-slate-500",
};

export const relativeAge = (value, t, now = Date.now()) => {
  if (!value) return "—";
  const parsed = new Date(value).getTime();
  if (Number.isNaN(parsed)) return "—";
  const minutes = Math.max(0, Math.round((now - parsed) / 60000));
  if (minutes < 60) return t("aiSupport.integrations.queue.ageMinutes", { count: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 48) return t("aiSupport.integrations.queue.ageHours", { count: hours });
  return t("aiSupport.integrations.queue.ageDays", { count: Math.round(hours / 24) });
};

export const queueViewModel = (data) => {
  const source = data && typeof data === "object" ? data : {};
  const connection = source.connection || {};
  const queue = source.queue || {};
  const counts = source.counts || {};
  const rate = source.settings?.queue || {};
  const backlog = Number(counts.pending || 0) + Number(counts.scheduled || 0);
  const threshold = Number(rate.pending_pause_threshold || 0);
  return {
    connected: connection.connected === true,
    state: queue.state || "running",
    paused: queue.state !== "running",
    // paused_for_review is the one an operator must act on; a manual pause is their own doing.
    forReview: queue.state === "paused_for_review",
    pauseReason: queue.pause_reason || "manual",
    backlog,
    // 0 disables the brake, so the backlog can never be "over" it.
    backlogOverThreshold: threshold > 0 && backlog > threshold,
    thresholdDisabled: threshold === 0,
    stats: STATUS_ORDER.map((status) => ({
      status,
      value: Number(counts[status] || 0),
      tone: STATUS_TONE[status],
    })),
    rate,
    preview: source.resume_preview || { pending: 0, stale: 0 },
    throughput: source.throughput || {},
    oldest: source.oldest_pending || null,
  };
};
