import { FileText } from "lucide-react";

import ChatImageAttachment from "../../modules/employees/components/ChatImageAttachment";
import WhatsAppVoiceMessage from "../../modules/employees/components/WhatsAppVoiceMessage";
import { messageAttachmentDuration } from "../../modules/employees/lib/chatAttachments";
import {
  formatPortalChatFileSize,
  isPortalChatAudioMessage,
  isPortalChatImageMessage,
  portalChatAttachmentMime,
  portalChatAttachmentName,
  portalChatAttachmentRawUrl,
  portalChatAttachmentSize,
  portalChatAttachmentType,
  portalChatAttachmentUrl,
} from "./portalChatUtils";

export default function PortalChatAttachment({
  message,
  compact = false,
  outgoing = false,
  timeText = "",
  showChecks = false,
  read = false,
  onImageClick,
  labels = {},
}) {
  const rawUrl = portalChatAttachmentRawUrl(message);
  const href = portalChatAttachmentUrl(message);
  const type = portalChatAttachmentType(message);
  if (!rawUrl && !href && !type) return null;

  const isImage = isPortalChatImageMessage(message);
  const isAudio = isPortalChatAudioMessage(message);
  const name = portalChatAttachmentName(message) || (isImage ? labels.image || "صورة" : labels.file || "ملف");

  if (isImage) {
    return (
      <ChatImageAttachment
        src={href}
        alt={name}
        compact={compact}
        onClick={onImageClick}
        originalUrl={rawUrl}
        messageId={message?.id}
      />
    );
  }

  if (isAudio) {
    return (
      <WhatsAppVoiceMessage
        src={href}
        outgoing={outgoing}
        label={labels.voice || "رسالة صوتية"}
        timeText={timeText}
        showChecks={showChecks}
        read={read}
        duration={messageAttachmentDuration(message)}
      />
    );
  }

  if (!href) return null;

  return (
    <a href={href} target="_blank" rel="noreferrer" download className="mb-2 flex items-center gap-3 rounded-2xl border border-black/10 bg-black/5 p-3 text-inherit no-underline">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/70 text-slate-700">
        <FileText className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-black" dir="auto">{name}</span>
        <span className="mt-0.5 block text-[10px] font-bold opacity-70" dir="ltr">
          {portalChatAttachmentMime(message) || labels.file || "ملف"} {formatPortalChatFileSize(portalChatAttachmentSize(message))}
        </span>
      </span>
    </a>
  );
}
