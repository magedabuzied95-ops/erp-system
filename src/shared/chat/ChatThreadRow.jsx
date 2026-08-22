import { Camera, FileText, Mic, PhoneCall, UserRound, Video } from "lucide-react";
import { memo } from "react";

import { resolveEmployeeProfileImageUrl } from "../lib/imageUrls";
import { MessageTicks } from "./PortalChatMessageList";

/*
 * One conversation row, WhatsApp's: round avatar, name + time on the first
 * line, preview with a type icon and (for our own last message) the delivery
 * ticks on the second, unread badge in the accent. Typing replaces the preview.
 */
const attachmentIcon = (type) => {
  switch (String(type || "")) {
    case "image": return Camera;
    case "audio": return Mic;
    case "video": return Video;
    case "file": return FileText;
    default: return null;
  }
};

function ChatThreadRow({
  employee,
  thread,
  active = false,
  typing = false,
  name,
  subtitle,
  preview,
  timeText,
  typingLabel,
  outgoingSenderType = "admin",
  onSelect,
  testId,
}) {
  const unread = Number(thread?.unread_count || 0);
  const lastOutgoing = thread && thread.last_sender_type === outgoingSenderType;
  const Icon = attachmentIcon(thread?.last_attachment_type);
  const ring = String(thread?.last_message || "").startsWith("📞");
  const online = Boolean(thread?.online || employee?.online);
  return (
    <button
      type="button"
      onClick={onSelect}
      data-testid={testId}
      className={`flex w-full items-center gap-3 px-3 py-2.5 text-start transition ${active ? "bg-[var(--primary-soft)]" : "hover:bg-[var(--surface-hover)]"}`}
    >
      <span className="relative shrink-0">
        <span className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-full bg-[var(--primary-soft)] text-[var(--primary)]">
          {employee?.photo_url ? (
            <>
              <img src={resolveEmployeeProfileImageUrl(employee.photo_url)} alt="" className="h-full w-full object-cover" loading="lazy" onError={(event) => { event.currentTarget.classList.add("hidden"); event.currentTarget.nextElementSibling?.classList.remove("hidden"); }} />
              <UserRound className="hidden h-5 w-5" />
            </>
          ) : (
            <UserRound className="h-5 w-5" />
          )}
        </span>
        {online ? <span className="absolute bottom-0 end-0 h-3 w-3 rounded-full border-2 border-[var(--card)] bg-[var(--success)]" aria-hidden="true" /> : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className={`truncate text-[15px] leading-5 ${unread ? "font-black text-[var(--text)]" : "font-bold text-[var(--text)]"}`} dir="auto">{name}</span>
          <span className={`shrink-0 text-[11px] tabular-nums ${unread ? "font-black text-[var(--primary)]" : "font-semibold text-[var(--muted)]"}`} dir="ltr">{timeText}</span>
        </span>
        <span className="mt-0.5 flex items-center justify-between gap-2">
          <span className={`flex min-w-0 flex-1 items-center gap-1 text-[13px] leading-5 ${unread ? "font-bold text-[var(--text)]" : "font-medium text-[var(--muted)]"}`}>
            {typing ? (
              <span className="truncate font-bold text-[var(--primary)]">{typingLabel}</span>
            ) : (
              <>
                {lastOutgoing && thread ? <MessageTicks message={{ read_at: thread.last_message_read_at, delivered_at: thread.last_message_delivered_at }} className="h-4 w-4 shrink-0" /> : null}
                {ring ? <PhoneCall className="h-3.5 w-3.5 shrink-0 text-[var(--primary)]" /> : Icon ? <Icon className="h-3.5 w-3.5 shrink-0" /> : null}
                <span className="truncate" dir="auto">{preview || subtitle}</span>
              </>
            )}
          </span>
          {unread ? (
            <span className="shrink-0 rounded-full bg-[var(--primary)] px-1.5 py-px text-[11px] font-black leading-4 text-[var(--primary-contrast)] tabular-nums" dir="ltr">{unread > 99 ? "99+" : unread}</span>
          ) : null}
        </span>
      </span>
    </button>
  );
}

export default memo(ChatThreadRow);
