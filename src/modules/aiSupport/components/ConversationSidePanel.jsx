import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import {
  Eye,
  FileText,
  Footprints,
  Image as ImageIcon,
  Link2,
  MessageSquare,
  Mic,
  Package,
  Pencil,
  Search,
  ShoppingBag,
  Sparkles,
  Star,
  Tag,
  UserRound,
  X,
} from "lucide-react";
import { api } from "../../../shared/api/api";
import { aiInboxConversationEndpoint } from "../lib/conversationHelpers";
import { aiInboxLabelsFromConversation } from "../../../../shared/aiInboxConversationLabels.js";
import { resolveChatMediaUrl } from "../../../shared/lib/imageUrls";
import ConversationParticipants from "./ConversationParticipants.jsx";

/*
 * Genie's conversation side panel (opens from the customer's photo), shaped for
 * a shoe shop. Three tabs:
 *   Info     the shop's quick actions (new order · send product · send by size ·
 *            orders · lead · Customer 360), labels, the stage, context & summary
 *            (written by the team; the summary starts from the AI's), what we
 *            know of the customer's shoes (size, colours, models), participants
 *            (the owner, who else has it open, transfer)
 *   Media    pictures and video, voice, files, links shared in the thread
 *   Starred  the messages starred in this browser
 */

const STAR_STORAGE_KEY = "m1:ai-inbox:starred-messages:v1";
const URL_PATTERN = /https?:\/\/[^\s<>"')]+/gi;
const clean = (value) => String(value ?? "").trim();
const messageText = (message = {}) => clean(message.customer_message || message.staff_message || message.ai_answer || message.message_text || message.text);
const messageIds = (message = {}) => [message.id, message.message_id, message.external_message_id, message.provider_message_id, message.whatsapp_message_id].map(clean).filter(Boolean);
const readStarred = () => {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STAR_STORAGE_KEY) || "[]");
    return new Set(Array.isArray(parsed) ? parsed.map(clean) : []);
  } catch {
    return new Set();
  }
};
const relative = (value, language) => {
  const time = new Date(value || 0).getTime();
  if (!time) return "";
  const minutes = Math.max(0, Math.round((Date.now() - time) / 60000));
  const format = new Intl.RelativeTimeFormat(`${String(language || "ar").split("-")[0]}-u-nu-latn`, { numeric: "always" });
  if (minutes < 60) return format.format(-minutes, "minute");
  if (minutes < 1440) return format.format(-Math.round(minutes / 60), "hour");
  return format.format(-Math.round(minutes / 1440), "day");
};

function Section({ icon: Icon, title, action, children }) {
  return (
    <section className="rounded-2xl border border-border bg-surface p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-bold text-text">
          {Icon ? <Icon className="h-4 w-4 text-text-muted" /> : null}
          {title}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function NoteBox({ label, value, placeholder, onSave }) {
  const { t } = useTranslation();
  const [mode, setMode] = useState("preview");
  const [draft, setDraft] = useState(value || "");
  useEffect(() => { setDraft(value || ""); }, [value]);
  return (
    <div className="mb-2">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-bold text-text-muted">{label}</span>
        <span className="flex overflow-hidden rounded-lg border border-border text-[11px]">
          <button type="button" onClick={() => setMode("preview")} className={`inline-flex items-center gap-1 px-2 py-1 ${mode === "preview" ? "bg-surface-hover font-bold" : "text-text-muted"}`}><Eye className="h-3 w-3" />{t("aiSupport.inbox.sidePanel.preview")}</button>
          <button type="button" onClick={() => setMode("write")} className={`inline-flex items-center gap-1 px-2 py-1 ${mode === "write" ? "bg-surface-hover font-bold" : "text-text-muted"}`}><Pencil className="h-3 w-3" />{t("aiSupport.inbox.sidePanel.write")}</button>
        </span>
      </div>
      {mode === "write" ? (
        <>
          <textarea dir="auto" rows={4} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={placeholder} className="w-full rounded-lg border border-border bg-surface-soft p-2 text-sm leading-6 focus:border-primary focus:outline-none" />
          <div className="mt-1 flex justify-end gap-2">
            <button type="button" onClick={() => { setDraft(value || ""); setMode("preview"); }} className="px-2 text-xs text-text-muted">{t("aiSupport.inbox.sidePanel.cancel")}</button>
            <button type="button" onClick={async () => { if (await onSave(draft)) setMode("preview"); }} className="rounded-md bg-primary px-3 py-1 text-xs font-bold text-primary-foreground">{t("aiSupport.inbox.sidePanel.save")}</button>
          </div>
        </>
      ) : (
        <div dir="auto" className="min-h-10 whitespace-pre-wrap rounded-lg bg-surface-soft p-2 text-sm leading-6 text-text">
          {clean(value) || <span className="italic text-text-muted">{t("aiSupport.inbox.sidePanel.nothing")}</span>}
        </div>
      )}
    </div>
  );
}

export default function ConversationSidePanel({
  open = false,
  conversation = null,
  headers,
  stageOptions = [],
  currentStage = "",
  staffViewers = [],
  onClose,
  onStageChange,
  onEditLabels,
  onCreateOrder,
  onSendProduct,
  onSendBySize,
  onOpenOrders,
  onOpenLead,
  onOpenCustomer360,
  // Participants (ConversationParticipants): owner + added members.
  tenantId,
  canManageParticipants = false,
  onAssigned,
  onParticipantsChange,
  onNotice,
  // Inline: a column of the inbox grid beside the chat (Genie), not a floating sheet.
  inline = false,
}) {
  const { t, i18n } = useTranslation();
  const [tab, setTab] = useState("info");
  const [mediaKind, setMediaKind] = useState("media");
  const [query, setQuery] = useState("");
  const [details, setDetails] = useState({});
  const [aiSummary, setAiSummary] = useState("");
  const [starredTick, setStarredTick] = useState(0);
  const sessionId = clean(conversation?.session_id || conversation?.conversation_id);
  const labels = useMemo(() => aiInboxLabelsFromConversation(conversation || {}), [conversation]);
  const messages = useMemo(() => (Array.isArray(conversation?.messages) ? conversation.messages : []), [conversation?.messages]);

  useEffect(() => {
    if (!open || !sessionId) return undefined;
    let alive = true;
    api.get(aiInboxConversationEndpoint(sessionId, "/lead"), { headers, suppressErrorStatuses: [404, 500, 502, 503] })
      .then((payload) => { if (alive) { setDetails(payload?.lead?.details || {}); setAiSummary(clean(payload?.lead?.ai_summary)); } })
      .catch(() => {});
    return () => { alive = false; };
  }, [headers, open, sessionId]);

  useEffect(() => { if (open) setStarredTick((value) => value + 1); }, [open, tab]);

  const media = useMemo(() => {
    const out = { media: [], audio: [], docs: [], links: [] };
    for (const message of messages) {
      const attachments = Array.isArray(message.visual_attachments) ? message.visual_attachments : Array.isArray(message.attachments) ? message.attachments : [];
      for (const item of attachments) {
        const url = clean(item?.url || item?.media_url || item?.preview_url);
        if (!url) continue;
        const kind = clean(item?.type || item?.media_type || item?.mime_type).toLowerCase();
        const entry = { url, name: clean(item?.file_name || item?.filename || item?.title) || url.split("/").pop(), at: message.created_at, kind };
        if (kind.includes("audio") || kind.includes("voice") || kind.includes("ptt")) out.audio.push(entry);
        else if (kind.includes("image") || kind.includes("video") || kind.includes("photo") || kind === "sticker") out.media.push(entry);
        else out.docs.push(entry);
      }
      for (const match of messageText(message).match(URL_PATTERN) || []) out.links.push({ url: match, name: match, at: message.created_at });
    }
    for (const key of Object.keys(out)) out[key].reverse();
    return out;
  }, [messages]);

  const starred = useMemo(() => {
    const keys = readStarred();
    return messages.filter((message) => messageIds(message).some((id) => keys.has(id))).reverse();
    // starredTick: re-read the browser's starred set when the tab opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, starredTick]);

  if (!open || !conversation) return null;

  const name = clean(conversation.customer_name || conversation.display_name || conversation.customer_profile?.name) || sessionId;
  const profile = conversation.customer_profile || {};
  const saveDetail = async (field, value) => {
    try {
      const payload = await api.patch(aiInboxConversationEndpoint(sessionId, "/lead"), { [field]: value }, { headers });
      setDetails(payload?.details || { ...details, [field]: value });
      return true;
    } catch {
      return false;
    }
  };
  const q = query.toLowerCase();
  const shoeFacts = [
    [t("aiSupport.inbox.sidePanel.size"), clean(profile.preferred_size || profile.size_preference || profile.preferences?.size)],
    [t("aiSupport.inbox.sidePanel.colors"), [].concat(profile.preferred_colors || profile.preferences?.colors || []).filter(Boolean).join("، ")],
    [t("aiSupport.inbox.sidePanel.models"), [].concat(profile.preferred_models || profile.interested_products || []).map((item) => (typeof item === "string" ? item : item?.name)).filter(Boolean).slice(0, 4).join("، ")],
  ].filter(([, value]) => value);

  const quick = [
    onCreateOrder ? { key: "order", icon: ShoppingBag, label: t("aiSupport.inbox.sidePanel.newOrder"), run: onCreateOrder } : null,
    onSendProduct ? { key: "product", icon: Package, label: t("aiSupport.inbox.sidePanel.sendProduct"), run: onSendProduct } : null,
    onSendBySize ? { key: "size", icon: Footprints, label: t("aiSupport.inbox.sidePanel.sendBySize"), run: onSendBySize } : null,
    onOpenOrders ? { key: "orders", icon: FileText, label: t("aiSupport.inbox.sidePanel.orders"), run: onOpenOrders } : null,
    onOpenLead ? { key: "lead", icon: Sparkles, label: t("aiSupport.inbox.sidePanel.lead"), run: onOpenLead } : null,
    onOpenCustomer360 ? { key: "c360", icon: UserRound, label: t("aiSupport.inbox.sidePanel.customer360"), run: onOpenCustomer360 } : null,
  ].filter(Boolean);

  const panel = (
    <aside
      aria-label={t("aiSupport.inbox.sidePanel.title")}
      data-conversation-side-panel="true"
      className={inline
        ? "flex h-full min-h-0 w-full flex-col overflow-hidden rounded-3xl border border-border bg-surface-soft text-text"
        : "fixed bottom-3 end-3 top-[4.5rem] z-[1000] flex w-[360px] max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-2xl border border-border bg-surface-soft text-text shadow-2xl"}
    >
      <div className="flex shrink-0 items-start justify-between gap-2 px-4 pb-2 pt-3">
        <div className="min-w-0">
          <div dir="auto" className="truncate text-base font-bold">{name}</div>
          <div className="flex items-center gap-1 text-xs text-text-muted"><MessageSquare className="h-3.5 w-3.5" />{relative(conversation.last_message_at || conversation.updated_at, i18n.language)}</div>
        </div>
        <button type="button" onClick={onClose} aria-label={t("aiSupport.inbox.sidePanel.close")} className="grid h-8 w-8 place-items-center rounded-lg text-text-muted hover:bg-surface-hover"><X className="h-4 w-4" /></button>
      </div>
      <div role="tablist" className="flex shrink-0 border-b border-border">
        {[["info", t("aiSupport.inbox.sidePanel.tabs.info")], ["media", t("aiSupport.inbox.sidePanel.tabs.media")], ["starred", t("aiSupport.inbox.sidePanel.tabs.starred")]].map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => { setTab(key); setQuery(""); }} className={`relative flex-1 py-2.5 text-sm font-semibold ${tab === key ? "text-primary" : "text-text-muted hover:text-text"}`}>
            {label}
            {tab === key ? <span className="absolute inset-x-4 bottom-0 h-0.5 rounded-full bg-primary" /> : null}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {tab === "info" ? (
          <>
            {quick.length ? (
              <div className="grid grid-cols-3 gap-2">
                {quick.map(({ key, icon: Icon, label, run }) => (
                  <button key={key} type="button" onClick={run} className="flex flex-col items-center gap-1 rounded-xl border border-border bg-surface px-1 py-2.5 text-center text-[11px] font-bold text-text transition hover:border-primary/50 hover:text-primary">
                    <Icon className="h-5 w-5 text-primary" />
                    <span className="leading-4">{label}</span>
                  </button>
                ))}
              </div>
            ) : null}

            <Section icon={Tag} title={t("aiSupport.inbox.sidePanel.labels")} action={onEditLabels ? <button type="button" onClick={onEditLabels} className="text-xs font-bold text-primary">{t("aiSupport.inbox.crmCard.editLabels")}</button> : null}>
              {labels.length ? (
                <div className="flex flex-wrap gap-1.5">{labels.map((label) => <span key={label.id} className="rounded-full bg-surface-soft px-2.5 py-1 text-xs font-semibold">{label.name}</span>)}</div>
              ) : (
                <button type="button" onClick={onEditLabels} className="inline-flex items-center gap-1.5 text-sm text-text-muted"><Tag className="h-4 w-4" />{t("aiSupport.inbox.sidePanel.addLabel")}</button>
              )}
            </Section>

            <Section icon={Sparkles} title={t("aiSupport.inbox.sidePanel.stage")} action={onOpenLead ? <button type="button" onClick={onOpenLead} className="text-xs font-bold text-primary">{t("aiSupport.inbox.sidePanel.openLead")}</button> : null}>
              {!currentStage ? <p className="mb-1.5 text-xs text-text-muted">{t("aiSupport.inbox.crmCard.notLead")}</p> : null}
              <div className="flex flex-wrap gap-1.5">
                {stageOptions.map((stage) => (
                  <button key={stage.id} type="button" disabled={stage.id === currentStage} onClick={() => onStageChange?.(stage.id)} className={`rounded-full px-2.5 py-1 text-xs font-bold ${stage.id === currentStage ? "bg-primary text-primary-foreground" : "bg-surface-soft text-text hover:bg-surface-hover"}`}>{stage.label}</button>
                ))}
              </div>
            </Section>

            <Section icon={Sparkles} title={t("aiSupport.inbox.sidePanel.contextSummary")}>
              <NoteBox label={t("aiSupport.inbox.sidePanel.context")} value={details.context} placeholder={t("aiSupport.inbox.sidePanel.contextPlaceholder")} onSave={(value) => saveDetail("context", value)} />
              <NoteBox label={t("aiSupport.inbox.sidePanel.summary")} value={clean(details.summary) || aiSummary} placeholder={t("aiSupport.inbox.sidePanel.summaryPlaceholder")} onSave={(value) => saveDetail("summary", value)} />
            </Section>

            {shoeFacts.length ? (
              <Section icon={Footprints} title={t("aiSupport.inbox.sidePanel.shoeProfile")}>
                <dl className="space-y-1 text-sm">
                  {shoeFacts.map(([label, value]) => (
                    <div key={label} className="flex justify-between gap-3"><dt className="text-text-muted">{label}</dt><dd dir="auto" className="text-end font-semibold">{value}</dd></div>
                  ))}
                </dl>
              </Section>
            ) : null}

            <ConversationParticipants
              conversation={conversation}
              headers={headers}
              tenantId={tenantId}
              staffViewers={staffViewers}
              canManage={canManageParticipants}
              onAssigned={onAssigned}
              onParticipantsChange={onParticipantsChange}
              onNotice={onNotice}
            />
          </>
        ) : null}

        {tab === "media" ? (
          <>
            <div className="grid grid-cols-4 gap-1 rounded-xl bg-surface p-1">
              {[["media", ImageIcon], ["audio", Mic], ["docs", FileText], ["links", Link2]].map(([key, Icon]) => (
                <button key={key} type="button" onClick={() => setMediaKind(key)} className={`inline-flex items-center justify-center gap-1 rounded-lg py-1.5 text-xs font-bold ${mediaKind === key ? "bg-primary text-primary-foreground" : "text-text-muted hover:text-text"}`}>
                  <Icon className="h-3.5 w-3.5" />{t(`aiSupport.inbox.sidePanel.mediaKinds.${key}`)}
                </button>
              ))}
            </div>
            <label className="relative flex h-9 items-center rounded-lg border border-border bg-surface">
              <Search className="pointer-events-none absolute start-2.5 h-4 w-4 text-text-muted" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("aiSupport.inbox.sidePanel.search")} className="h-9 w-full bg-transparent ps-8 pe-2 text-sm outline-none" />
            </label>
            {(() => {
              const items = media[mediaKind].filter((item) => !q || `${item.name} ${item.url}`.toLowerCase().includes(q));
              if (!items.length) return <p className="py-10 text-center text-sm text-text-muted">{t("aiSupport.inbox.sidePanel.noMedia")}</p>;
              if (mediaKind === "media") {
                return (
                  <div className="grid grid-cols-3 gap-1.5">
                    {items.map((item) => (
                      <a key={`${item.url}:${item.at}`} href={resolveChatMediaUrl(item.url)} target="_blank" rel="noopener noreferrer" className="block aspect-square overflow-hidden rounded-lg bg-surface">
                        {item.kind.includes("video") ? <video src={resolveChatMediaUrl(item.url)} className="h-full w-full object-cover" muted /> : <img src={resolveChatMediaUrl(item.url)} alt="" loading="lazy" className="h-full w-full object-cover" />}
                      </a>
                    ))}
                  </div>
                );
              }
              return (
                <ul className="space-y-1.5">
                  {items.map((item) => (
                    <li key={`${item.url}:${item.at}`} className="rounded-lg bg-surface p-2">
                      {mediaKind === "audio" ? <audio src={resolveChatMediaUrl(item.url)} controls className="w-full" /> : (
                        <a href={mediaKind === "links" ? item.url : resolveChatMediaUrl(item.url)} target="_blank" rel="noopener noreferrer" dir="auto" className="block truncate text-sm text-primary hover:underline">{item.name}</a>
                      )}
                    </li>
                  ))}
                </ul>
              );
            })()}
          </>
        ) : null}

        {tab === "starred" ? (
          <>
            <label className="relative flex h-9 items-center rounded-lg border border-border bg-surface">
              <Search className="pointer-events-none absolute start-2.5 h-4 w-4 text-text-muted" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("aiSupport.inbox.sidePanel.searchStarred")} className="h-9 w-full bg-transparent ps-8 pe-2 text-sm outline-none" />
            </label>
            {(() => {
              const items = starred.filter((message) => !q || messageText(message).toLowerCase().includes(q));
              if (!items.length) return <div className="flex flex-col items-center gap-2 py-10 text-sm text-text-muted"><Star className="h-6 w-6" />{t("aiSupport.inbox.sidePanel.noStarred")}</div>;
              return (
                <ul className="space-y-1.5">
                  {items.map((message, index) => (
                    <li key={messageIds(message)[0] || index} className="rounded-lg bg-surface p-2.5">
                      <div dir="auto" className="whitespace-pre-wrap text-sm">{messageText(message) || "—"}</div>
                      <div className="mt-1 text-[10px] text-text-muted">{relative(message.created_at, i18n.language)}</div>
                    </li>
                  ))}
                </ul>
              );
            })()}
          </>
        ) : null}
      </div>
    </aside>
  );
  return inline ? panel : createPortal(panel, document.fullscreenElement || document.body);
}
