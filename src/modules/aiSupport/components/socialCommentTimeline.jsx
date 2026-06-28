import { memo } from "react";
import { Clock3, MessageSquareText, UserRound } from "lucide-react";

const clean = (value = "") => String(value ?? "").trim();

const initialsFromName = (value = "") => {
  const parts = clean(value)
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (!parts.length) return "C";
  return parts
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
};

const pictureUrlFrom = (value = "") => {
  if (!value) return "";
  if (typeof value === "string") return clean(value);
  if (typeof value !== "object") return clean(value);
  return clean(value.data?.url || value.url || value.picture?.data?.url || value.picture?.url || value.profile_pic_url || value.profile_pic || value.source || "");
};

const isValidDate = (value) => {
  const date = new Date(value);
  return !Number.isNaN(date.getTime());
};

const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

export const getRelativeTimeLabel = (value, now = new Date()) => {
  if (!value) return "وقت غير معروف";
  const date = new Date(value);
  if (!isValidDate(date)) return "وقت غير معروف";

  const diffMs = Math.max(0, now.getTime() - date.getTime());
  const diffMinutes = Math.floor(diffMs / 60000);
  if (diffMinutes < 1) return "now";
  if (diffMinutes < 60) return `${diffMinutes} min ago`;

  const nowDay = startOfDay(now);
  const itemDay = startOfDay(date);
  if (itemDay === nowDay) {
    return `Today ${date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
  }

  if (itemDay === nowDay - 86400000) {
    return "Yesterday";
  }

  return `${date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} ${date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
};

const platformMeta = (platform = "") => {
  const key = clean(platform).toLowerCase();
  if (key.includes("instagram")) {
    return {
      label: "Instagram",
      className: "border-rose-300/20 bg-rose-400/10 text-rose-100",
    };
  }
  return {
    label: "Facebook",
    className: "border-cyan-300/20 bg-cyan-400/10 text-cyan-100",
  };
};

const normalizeRuntimeStatus = (value = "") => {
  const key = clean(value).toLowerCase().replace(/\s+/g, "_");
  if (!key) return "skipped";
  if (["sent", "success", "successful", "completed", "complete", "done", "delivered", "posted", "created", "resolved", "approved", "published", "ok"].includes(key)) {
    return "success";
  }
  if (["pending", "queued", "queue", "processing", "running", "in_progress", "inprogress", "review", "manual_review", "waiting", "started", "active"].includes(key)) {
    return "pending";
  }
  if (["failed", "error", "errored", "rejected", "blocked", "cancelled", "canceled", "timeout", "timed_out", "failed_to_send"].includes(key)) {
    return "failed";
  }
  if (["skipped", "skip", "ignored", "ignore", "disabled", "not_applicable", "n/a", "na", "empty", "none"].includes(key)) {
    return "skipped";
  }
  return "pending";
};

const statusToneClass = (status = "") => {
  const key = normalizeRuntimeStatus(status);
  if (key === "success") return "border-emerald-300/20 bg-emerald-400/10 text-emerald-100";
  if (key === "pending") return "border-amber-300/20 bg-amber-400/10 text-amber-100";
  if (key === "failed") return "border-rose-300/20 bg-rose-400/10 text-rose-100";
  return "border-slate-300/20 bg-slate-400/10 text-slate-100";
};

const deriveLeadState = (source = "") => {
  const key = clean(source).toLowerCase().replace(/\s+/g, "_");
  if (!key) return "skipped";
  if (["lead_inbox", "lead", "created", "success", "sent", "converted", "qualified", "captured", "done", "resolved", "processed"].some((candidate) => key.includes(candidate))) {
    return "success";
  }
  if (["failed", "error", "rejected", "blocked"].some((candidate) => key.includes(candidate))) {
    return "failed";
  }
  if (["pending", "queued", "review", "manual", "new", "question"].some((candidate) => key.includes(candidate))) {
    return "pending";
  }
  return "pending";
};

export const resolveCommentTimelineData = (comment = {}, fallbackPlatform = "facebook") => {
  const raw = comment && typeof comment === "object" ? comment.raw || comment : {};
  const metadata = raw.metadata && typeof raw.metadata === "object" && !Array.isArray(raw.metadata) ? raw.metadata : {};
  const automationState =
    (comment.automation_state && typeof comment.automation_state === "object" && comment.automation_state) ||
    (raw.automation_state && typeof raw.automation_state === "object" && raw.automation_state) ||
    (metadata.automation_state && typeof metadata.automation_state === "object" && metadata.automation_state) ||
    {};

  const customerName = clean(
    comment.customer_name ||
      comment.commenter_name ||
      comment.from?.name ||
      raw.customer_name ||
      raw.commenter_name ||
      raw.from?.name ||
      metadata.customer_name ||
      metadata.commenter_name ||
      metadata.from?.name ||
      "عميل"
  );

  const customerAvatarUrl = clean(
    comment.customer_avatar_url ||
      comment.commenter_profile_picture_url ||
      pictureUrlFrom(comment.from?.picture) ||
      comment.profile_pic_url ||
      comment.profile_picture_url ||
      comment.customer_avatar ||
      comment.avatar ||
      comment.avatar_url ||
      comment.profile_pic ||
      raw.customer_avatar_url ||
      raw.commenter_profile_picture_url ||
      pictureUrlFrom(raw.from?.picture) ||
      raw.profile_pic_url ||
      raw.profile_picture_url ||
      raw.customer_avatar ||
      raw.avatar ||
      raw.avatar_url ||
      raw.profile_pic ||
      metadata.customer_avatar_url ||
      metadata.commenter_profile_picture_url ||
      pictureUrlFrom(metadata.from?.picture) ||
      metadata.profile_pic_url ||
      metadata.profile_picture_url ||
      metadata.customer_avatar ||
      metadata.avatar ||
      metadata.avatar_url ||
      metadata.profile_pic ||
      ""
  );

  const text = clean(
    comment.original_comment_text ||
      comment.customer_message ||
      comment.message_text ||
      comment.message ||
      comment.text ||
      raw.original_comment_text ||
      raw.customer_message ||
      raw.message_text ||
      raw.message ||
      raw.text ||
      metadata.original_comment_text ||
      metadata.customer_message ||
      metadata.message_text ||
      metadata.message ||
      metadata.text ||
      ""
  );

  const createdAt = clean(comment.created_at || comment.createdTime || comment.created_time || raw.created_at || raw.createdTime || raw.created_time || metadata.created_at || metadata.createdTime || metadata.created_time || "");
  const platform = clean(comment.platform || raw.platform || metadata.platform || fallbackPlatform || "facebook").toLowerCase();

  const likeState = normalizeRuntimeStatus(comment.like_status || raw.like_status || metadata.like_status || automationState.like_status || "");
  const publicReplyState = normalizeRuntimeStatus(
    comment.public_reply_status ||
      comment.reply_status ||
      raw.public_reply_status ||
      raw.reply_status ||
      metadata.public_reply_status ||
      metadata.reply_status ||
      automationState.public_reply_status ||
      automationState.reply_status ||
      ""
  );
  const privateReplyState = normalizeRuntimeStatus(
    comment.dm_status ||
      comment.private_reply_status ||
      raw.dm_status ||
      raw.private_reply_status ||
      metadata.dm_status ||
      metadata.private_reply_status ||
      automationState.dm_status ||
      automationState.private_reply_status ||
      ""
  );

  const aiExplicit = clean(
    automationState.overall_status ||
      automationState.status ||
      comment.ai_status ||
      comment.automation_status ||
      raw.ai_status ||
      raw.automation_status ||
      metadata.ai_status ||
      metadata.automation_status ||
      ""
  );
  const autoReplyEnabled = Boolean(
    comment.auto_reply_enabled ||
      comment.template_enabled ||
      comment.generic_enabled ||
      raw.auto_reply_enabled ||
      raw.template_enabled ||
      raw.generic_enabled ||
      metadata.auto_reply_enabled ||
      metadata.template_enabled ||
      metadata.generic_enabled
  );
  const aiState = aiExplicit
    ? normalizeRuntimeStatus(aiExplicit)
    : [likeState, publicReplyState, privateReplyState].includes("failed")
      ? "failed"
      : [likeState, publicReplyState, privateReplyState].includes("success")
        ? "success"
        : autoReplyEnabled
          ? "pending"
          : "skipped";

  const leadSource = clean(
    comment.lead_status ||
      comment.ai_lead_status ||
      comment.action_taken ||
      comment.classification_label ||
      comment.classification ||
      comment.intent ||
      raw.lead_status ||
      raw.ai_lead_status ||
      raw.action_taken ||
      raw.classification_label ||
      raw.classification ||
      raw.intent ||
      metadata.lead_status ||
      metadata.ai_lead_status ||
      metadata.action_taken ||
      metadata.classification_label ||
      metadata.classification ||
      metadata.intent ||
      ""
  );
  const leadState = deriveLeadState(leadSource);

  return {
    key: clean(comment.id || comment.comment_id || comment.external_message_id || comment.provider_message_id || raw.id || raw.comment_id || metadata.comment_id || ""),
    customerName: customerName || "عميل",
    customerAvatarUrl,
    text,
    createdAt,
    created_at: createdAt,
    created_time: createdAt,
    createdTime: createdAt,
    platform,
    platformMeta: platformMeta(platform),
    initials: initialsFromName(customerName),
    statuses: [
      { key: "like", label: "Like", status: likeState, className: statusToneClass(likeState) },
      { key: "public_reply", label: "Public Reply", status: publicReplyState, className: statusToneClass(publicReplyState) },
      { key: "private_reply", label: "Private Reply", status: privateReplyState, className: statusToneClass(privateReplyState) },
      { key: "ai", label: "AI", status: aiState, className: statusToneClass(aiState) },
      { key: "lead", label: "Lead", status: leadState, className: statusToneClass(leadState) },
    ],
  };
};

export const CommentTimelineCard = memo(function CommentTimelineCard({
  comment = {},
  selected = false,
  onSelect,
  onKeyDown,
  fallbackPlatform = "facebook",
  className = "",
  children = null,
}) {
  const data = resolveCommentTimelineData(comment, fallbackPlatform);
  const hasAvatar = Boolean(data.customerAvatarUrl);
  const interactive = typeof onSelect === "function";
  const handleKeyDown =
    onKeyDown ||
    (interactive
      ? (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onSelect(comment, data.key);
          }
        }
      : undefined);

  return (
    <article
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={interactive ? () => onSelect(comment, data.key) : undefined}
      onKeyDown={handleKeyDown}
      className={[
        "rounded-[22px] border p-3.5 shadow-[0_8px_24px_rgba(0,0,0,0.12)] transition",
        selected
          ? "border-cyan-300/50 bg-gradient-to-br from-cyan-300/15 to-slate-950/55 ring-1 ring-cyan-300/15"
          : "border-white/10 bg-slate-950/65 hover:border-white/20 hover:bg-slate-950/75",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="flex items-start gap-3.5">
        <div className="relative shrink-0">
          {hasAvatar ? (
            <img
              src={data.customerAvatarUrl}
              alt={data.customerName}
              className="h-12 w-12 rounded-full object-cover ring-1 ring-white/10"
              loading="lazy"
            />
          ) : (
            <span className="grid h-12 w-12 place-items-center rounded-full bg-gradient-to-br from-cyan-300/20 to-white/[0.04] text-sm font-black text-cyan-100 ring-1 ring-white/10">
              {data.initials || <UserRound className="h-5 w-5" />}
            </span>
          )}
          <span className="absolute -bottom-0.5 -right-0.5 grid h-5 w-5 place-items-center rounded-full border border-slate-950 bg-slate-900 text-cyan-100 shadow-[0_8px_18px_rgba(0,0,0,0.2)]">
            <MessageSquareText className="h-3 w-3" />
          </span>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-[15px] font-black leading-6 text-white">{data.customerName || "عميل"}</div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] font-black uppercase tracking-[0.08em] text-slate-300">
                <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 ${data.platformMeta.className}`}>
                  {data.platformMeta.label}
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-slate-300">
                  <Clock3 className="h-3.5 w-3.5" />
                  {getRelativeTimeLabel(data.createdAt)}
                </span>
              </div>
            </div>

            <div className="flex flex-wrap justify-end gap-1.5">
              {data.statuses.map((status) => (
                <span
                  key={status.key}
                  title={`${status.label}: ${status.status}`}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.08em] ${status.className}`}
                >
                  {status.label}
                </span>
              ))}
            </div>
          </div>

          <div className="mt-2 rounded-2xl border border-white/5 bg-white/[0.03] p-3 text-sm leading-7 text-slate-100">
            <div className="whitespace-pre-wrap">{data.text || "No comment text available."}</div>
          </div>

          {children ? <div className="mt-3">{children}</div> : null}
        </div>
      </div>
    </article>
  );
});
