import { useNavigate } from "react-router-dom";
import { MessageCircle } from "lucide-react";
import { FaFacebookMessenger, FaInstagram, FaWhatsapp } from "react-icons/fa";

import { aiInboxOrderChannel, buildAiInboxOrderUrl } from "../lib/aiInboxOrderLink.js";

const CHANNEL_META = {
  instagram: { Icon: FaInstagram, label: "فتح محادثة Instagram", className: "border-fuchsia-400/30 bg-fuchsia-400/10 text-fuchsia-200 hover:bg-fuchsia-400/20" },
  messenger: { Icon: FaFacebookMessenger, label: "فتح محادثة Messenger", className: "border-sky-400/30 bg-sky-400/10 text-sky-200 hover:bg-sky-400/20" },
  whatsapp: { Icon: FaWhatsapp, label: "فتح محادثة WhatsApp", className: "border-emerald-400/30 bg-emerald-400/10 text-emerald-200 hover:bg-emerald-400/20" },
};

export default function AiInboxOrderLink({ order, compact = false, className = "" }) {
  const navigate = useNavigate();
  const url = buildAiInboxOrderUrl(order);
  if (!url) return null;

  const channel = aiInboxOrderChannel(order);
  const meta = CHANNEL_META[channel] || { Icon: MessageCircle, label: "فتح محادثة AI Inbox", className: "border-cyan-400/30 bg-cyan-400/10 text-cyan-200 hover:bg-cyan-400/20" };
  const Icon = meta.Icon;

  return (
    <button
      type="button"
      title={meta.label}
      aria-label={meta.label}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        navigate(url);
      }}
      className={`inline-flex items-center justify-center gap-1.5 rounded-full border font-black transition ${compact ? "h-6 w-6 p-0" : "px-2.5 py-1 text-[11px]"} ${meta.className} ${className}`}
    >
      <Icon className={compact ? "h-3.5 w-3.5" : "h-3.5 w-3.5"} />
      {!compact ? <span>AI Inbox</span> : null}
    </button>
  );
}

