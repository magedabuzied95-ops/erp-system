import { useNavigate } from "react-router-dom";
import { MessageCircle } from "lucide-react";
import { FaFacebookMessenger, FaInstagram, FaWhatsapp } from "react-icons/fa";

import { aiInboxOrderChannel, buildAiInboxOrderUrl } from "../lib/aiInboxOrderLink.js";

import { useTranslation } from "react-i18next";

import i18n from "../../../i18n/i18n";

/** Module-scope translator for helpers defined outside a component. */
const tt = (key, options) => i18n.t(key, options);

// Module-scope map: stores translation KEYS and resolves them at render.
const CHANNEL_META = {
  instagram: { Icon: FaInstagram, labelKey: "orders.links.openInstagram", className: "border-fuchsia-400/30 bg-fuchsia-400/10 text-fuchsia-200 hover:bg-fuchsia-400/20" },
  messenger: { Icon: FaFacebookMessenger, labelKey: "orders.links.openMessenger", className: "border-primary/30 bg-primary/10 text-primary hover:bg-primary/20" },
  whatsapp: { Icon: FaWhatsapp, labelKey: "orders.links.openWhatsapp", className: "border-emerald-400/30 bg-emerald-400/10 text-emerald-200 hover:bg-emerald-400/20" },
};

export default function AiInboxOrderLink({ order, compact = false, className = "" }) {
  const { t } = useTranslation();
  // Subscribes this screen to language changes; strings resolve through tt().
  useTranslation();
  const navigate = useNavigate();
  const url = buildAiInboxOrderUrl(order);
  if (!url) return null;

  const channel = aiInboxOrderChannel(order);
  const meta = CHANNEL_META[channel] || { Icon: MessageCircle, labelKey: "orders.links.openAiInbox", className: "border-primary/30 bg-primary/10 text-primary hover:bg-primary/20" };
  const Icon = meta.Icon;

  return (
    <button
      type="button"
      title={tt(meta.labelKey)}
      aria-label={tt(meta.labelKey)}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        navigate(url);
      }}
      className={`inline-flex items-center justify-center gap-1.5 rounded-full border font-black transition ${compact ? "h-6 w-6 p-0" : "px-2.5 py-1 text-[11px]"} ${meta.className} ${className}`}
    >
      <Icon className={compact ? "h-3.5 w-3.5" : "h-3.5 w-3.5"} />
      {!compact ? <span>{t("orders.aiInboxLink")}</span> : null}
    </button>
  );
}

