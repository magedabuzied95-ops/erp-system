// The AI Inbox control center.
//
// Everything that configures the inbox, in one panel that opens over the conversations instead of
// navigating away from them. It replaces the 224px gear menu that used to list five items, and it
// absorbs the integrations center whole — the connection panels are mounted here directly rather than
// behind a second overlay, because a setting reachable from two shells is a setting nobody can tell
// the true state of.
//
// Sections are grouped by what they change:
//   • the agent — how it speaks, what it may do on its own, and a sandbox to try it;
//   • the workspace — the replies, comment rules and invoice messages the team uses;
//   • the numbers — who answered and how fast;
//   • the connections — the channels everything above depends on.
//
// The `?config=<section>` deep link survives a reload, and `?integrations=<tab>` keeps working: the
// old links land on the matching connection section.

import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  BarChart3,
  Bot,
  CalendarClock,
  Clock3,
  DatabaseBackup,
  FileText,
  KeyRound,
  Gauge,
  GraduationCap,
  LayoutGrid,
  Megaphone,
  MessageSquareText,
  Music2,
  PlayCircle,
  Power,
  Receipt,
  Smartphone,
  SlidersHorizontal,
  Tag,
  Users,
  UsersRound,
  Webhook,
  Workflow,
  X,
  Zap,
} from "lucide-react";
import { FaFacebookF, FaInstagram, FaWhatsapp } from "react-icons/fa";

import { QuickRepliesPanel } from "../QuickReplies.jsx";
import { CommentsSettingsPanel } from "../CommentsSettings.jsx";
import WhatsappMessageVariantsEditor from "../WhatsappMessageVariantsEditor.jsx";
import AgentBehaviourPanel from "./AgentBehaviourPanel.jsx";
import AgentActionsPanel from "./AgentActionsPanel.jsx";
import AgentPlaygroundPanel from "./AgentPlaygroundPanel.jsx";
import TeachAgentPanel from "./TeachAgentPanel.jsx";
import TeamPerformancePanel from "./TeamPerformancePanel.jsx";
import BroadcastsPanel from "./BroadcastsPanel.jsx";

// The connection panels are the heaviest thing in here and the least often opened; they load on demand.
const MetaIntegrationPanel = lazy(() => import("../integrations/MetaIntegrationPanel.jsx"));
const WhatsAppIntegrationPanel = lazy(() => import("../integrations/WhatsAppIntegrationPanel.jsx"));
const WhatsAppAutomationsPanel = lazy(() => import("../integrations/WhatsAppAutomationsPanel.jsx"));
const WhatsAppQueuePanel = lazy(() => import("../integrations/WhatsAppQueuePanel.jsx"));
const TikTokIntegrationPanel = lazy(() => import("../integrations/TikTokIntegrationPanel.jsx"));
const IntegrationsOverviewPanel = lazy(() => import("./IntegrationsOverviewPanel.jsx"));
const SequencesPanel = lazy(() => import("./SequencesPanel.jsx"));
const WhatsAppTemplatesPanel = lazy(() => import("./WhatsAppTemplatesPanel.jsx"));
const WhatsAppUsagePanel = lazy(() => import("./WhatsAppUsagePanel.jsx"));
const WhatsAppDeveloperPanel = lazy(() => import("./WhatsAppDeveloperPanel.jsx"));
const InboxTeamsPanel = lazy(() => import("./InboxTeamsPanel.jsx"));
const CustomerGroupsPanel = lazy(() => import("./CustomerGroupsPanel.jsx"));
const InboxShiftsPanel = lazy(() => import("./InboxShiftsPanel.jsx"));
const InboxTagsPanel = lazy(() => import("./InboxTagsPanel.jsx"));
const MetaAccountsPanel = lazy(() => import("./MetaAccountsPanel.jsx"));
const PresenceLogPanel = lazy(() => import("./PresenceLogPanel.jsx"));
const ChatBackupsPanel = lazy(() => import("./ChatBackupsPanel.jsx"));

const MetaGlyph = () => (
  <span className="relative inline-flex h-4 w-5 items-center" aria-hidden="true">
    <FaFacebookF className="h-4 w-4 text-blue-300" />
    <FaInstagram className="absolute -right-1 bottom-0 h-3 w-3 text-pink-300" />
  </span>
);

export const CONTROL_CENTER_GROUPS = [
  { key: "agent", sections: ["agent", "teach", "actions", "playground"] },
  { key: "workspace", sections: ["quick_replies", "comments", "invoice_messages"] },
  { key: "whatsapp_official", sections: ["wa_templates", "wa_usage", "wa_api_keys", "wa_webhooks"] },
  { key: "growth", sections: ["broadcasts", "sequences"] },
  { key: "team", sections: ["cfg_tags", "cfg_teams", "cfg_groups", "cfg_shifts", "cfg_presence", "cfg_backups"] },
  { key: "insight", sections: ["performance"] },
  { key: "meta_accounts", sections: ["fb_pages", "fb_connect", "ig_accounts", "ig_connect"] },
  { key: "connections", sections: ["overview", "meta", "whatsapp", "whatsapp_web", "automations", "queue", "tiktok"] },
];

export const CONTROL_CENTER_SECTIONS = CONTROL_CENTER_GROUPS.flatMap((group) => group.sections);

// The five entries the old gear menu had, so a caller that used to open one of them by name still can.
export const LEGACY_MENU_SECTIONS = {
  quick_replies: "quick_replies",
  comments: "comments",
  invoice_messages: "invoice_messages",
  automations: "automations",
  integrations: "overview",
};

const SECTION_ICON = {
  agent: Bot,
  teach: GraduationCap,
  actions: Workflow,
  playground: PlayCircle,
  quick_replies: Zap,
  comments: MessageSquareText,
  invoice_messages: Receipt,
  wa_templates: FileText,
  wa_usage: Receipt,
  fb_pages: () => <FaFacebookF className="h-4 w-4 text-blue-300" aria-hidden="true" />,
  fb_connect: () => <FaFacebookF className="h-4 w-4 text-blue-300" aria-hidden="true" />,
  ig_accounts: () => <FaInstagram className="h-4 w-4 text-pink-300" aria-hidden="true" />,
  ig_connect: () => <FaInstagram className="h-4 w-4 text-pink-300" aria-hidden="true" />,
  cfg_tags: Tag,
  cfg_presence: Clock3,
  cfg_backups: DatabaseBackup,
  cfg_teams: Users,
  cfg_groups: UsersRound,
  cfg_shifts: CalendarClock,
  wa_api_keys: KeyRound,
  wa_webhooks: Webhook,
  broadcasts: Megaphone,
  sequences: Workflow,
  performance: BarChart3,
  overview: LayoutGrid,
  meta: MetaGlyph,
  whatsapp: () => <FaWhatsapp className="h-4 w-4 text-emerald-300" aria-hidden="true" />,
  whatsapp_web: Smartphone,
  automations: Power,
  queue: Gauge,
  tiktok: () => <Music2 className="h-4 w-4 text-slate-200" aria-hidden="true" />,
};

// Literal keys, never an interpolated nav.<key> lookup: a missing translation must be greppable.
const sectionLabel = (t, key) => {
  if (key === "agent") return t("aiSupport.controlCenter.nav.agent");
  if (key === "teach") return t("aiSupport.controlCenter.nav.teach");
  if (key === "actions") return t("aiSupport.controlCenter.nav.actions");
  if (key === "playground") return t("aiSupport.controlCenter.nav.playground");
  if (key === "quick_replies") return t("aiSupport.quickReplies.title");
  if (key === "comments") return t("aiSupport.commentsSettings.title");
  if (key === "invoice_messages") return t("aiSupport.aiSettings.variants.menuTitle");
  if (key === "wa_templates") return t("aiSupport.waTemplates.title");
  if (key === "fb_pages") return t("aiSupport.metaAccounts.titles.fbPages");
  if (key === "fb_connect") return t("aiSupport.metaAccounts.titles.fbConnect");
  if (key === "ig_accounts") return t("aiSupport.metaAccounts.titles.igAccounts");
  if (key === "ig_connect") return t("aiSupport.metaAccounts.titles.igConnect");
  if (key === "cfg_tags") return t("aiSupport.inbox.topbar.items.tags");
  if (key === "cfg_presence") return t("aiSupport.inbox.topbar.items.presence");
  if (key === "cfg_backups") return t("aiSupport.inbox.topbar.items.backups");
  if (key === "cfg_teams") return t("aiSupport.inbox.topbar.items.teams");
  if (key === "cfg_groups") return t("aiSupport.inbox.topbar.items.groups");
  if (key === "cfg_shifts") return t("aiSupport.inbox.topbar.items.shifts");
  if (key === "wa_usage") return t("aiSupport.inbox.topbar.items.waUsage");
  if (key === "wa_api_keys") return t("aiSupport.inbox.topbar.items.waApiKeys");
  if (key === "wa_webhooks") return t("aiSupport.inbox.topbar.items.waWebhooks");
  if (key === "broadcasts") return t("aiSupport.controlCenter.nav.broadcasts");
  if (key === "sequences") return t("aiSupport.controlCenter.nav.sequences");
  if (key === "performance") return t("aiSupport.controlCenter.nav.performance");
  if (key === "overview") return t("aiSupport.integrations.nav.overview");
  if (key === "meta") return t("aiSupport.integrations.nav.meta");
  if (key === "whatsapp") return t("aiSupport.integrations.nav.whatsapp");
  if (key === "whatsapp_web") return t("aiSupport.integrations.nav.whatsappWeb");
  if (key === "automations") return t("aiSupport.integrations.nav.automations");
  if (key === "queue") return t("aiSupport.integrations.nav.queue");
  if (key === "tiktok") return t("aiSupport.integrations.nav.tiktok");
  return key;
};

const groupLabel = (t, key) => {
  if (key === "agent") return t("aiSupport.controlCenter.groups.agent");
  if (key === "workspace") return t("aiSupport.controlCenter.groups.workspace");
  if (key === "meta_accounts") return t("aiSupport.integrations.nav.meta");
  if (key === "team") return t("aiSupport.inbox.topbar.items.teams");
  if (key === "whatsapp_official") return t("aiSupport.inbox.topbar.menus.whatsapp");
  if (key === "growth") return t("aiSupport.controlCenter.groups.growth");
  if (key === "insight") return t("aiSupport.controlCenter.groups.insight");
  return t("aiSupport.controlCenter.groups.connections");
};

const PanelFallback = () => (
  <div className="grid h-48 place-items-center text-xs font-bold text-slate-500">
    <span className="h-6 w-6 animate-spin rounded-full border-2 border-white/10 border-t-cyan-300" />
  </div>
);

export default function InboxControlCenter({
  open,
  onClose,
  headers,
  tenantId,
  initialSection = "agent",
  quickReplies = null,
  commentsProps = null,
  // "overlay" (default): the modal with its own section nav — the PWA uses it. "page": fills
  // the desktop inbox under its top bar, Genie-style; the top bar is the nav, so there is none here.
  variant = "overlay",
}) {
  const { t } = useTranslation();
  const [section, setSection] = useState(
    CONTROL_CENTER_SECTIONS.includes(initialSection) ? initialSection : "agent"
  );

  useEffect(() => {
    if (open && CONTROL_CENTER_SECTIONS.includes(initialSection)) setSection(initialSection);
  }, [initialSection, open]);

  useEffect(() => {
    // A page is not a dialog: Escape inside one of its forms must not throw the draft away.
    if (!open || variant === "page") return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, open, variant]);

  const goTo = useCallback((next) => {
    if (CONTROL_CENTER_SECTIONS.includes(next)) setSection(next);
  }, []);

  const panelProps = useMemo(() => ({ headers, tenantId }), [headers, tenantId]);

  if (!open) return null;

  const panels = (
    <Suspense fallback={<PanelFallback />}>
      {section === "agent" ? <AgentBehaviourPanel {...panelProps} /> : null}
      {section === "teach" ? <TeachAgentPanel {...panelProps} /> : null}
      {section === "actions" ? <AgentActionsPanel {...panelProps} /> : null}
      {section === "playground" ? <AgentPlaygroundPanel {...panelProps} /> : null}
      {section === "quick_replies" ? (
        <QuickRepliesPanel
          mounted
          replies={quickReplies?.quickReplies || []}
          loading={quickReplies?.loading === true}
          saving={quickReplies?.saving === true}
          onCreate={quickReplies?.createReply}
          onUpdate={quickReplies?.updateReply}
          onDelete={quickReplies?.deleteReply}
          onReorder={quickReplies?.reorderReplies}
          light={false}
        />
      ) : null}
      {section === "comments" ? <CommentsSettingsPanel {...(commentsProps || {})} light={false} /> : null}
      {section === "invoice_messages" ? <WhatsappMessageVariantsEditor initialType="invoice_receipt" /> : null}
      {section === "wa_templates" ? <WhatsAppTemplatesPanel headers={headers} /> : null}
      {section === "fb_pages" ? <MetaAccountsPanel headers={headers} mode="messenger" /> : null}
      {section === "fb_connect" ? <MetaAccountsPanel headers={headers} mode="connect_messenger" /> : null}
      {section === "ig_accounts" ? <MetaAccountsPanel headers={headers} mode="instagram" /> : null}
      {section === "ig_connect" ? <MetaAccountsPanel headers={headers} mode="connect_instagram" /> : null}
      {section === "cfg_tags" ? <InboxTagsPanel headers={headers} /> : null}
      {section === "cfg_presence" ? <PresenceLogPanel headers={headers} /> : null}
      {section === "cfg_backups" ? <ChatBackupsPanel headers={headers} /> : null}
      {section === "cfg_teams" ? <InboxTeamsPanel headers={headers} /> : null}
      {section === "cfg_groups" ? <CustomerGroupsPanel headers={headers} /> : null}
      {section === "cfg_shifts" ? <InboxShiftsPanel headers={headers} /> : null}
      {section === "wa_usage" ? <WhatsAppUsagePanel headers={headers} /> : null}
      {section === "wa_api_keys" ? <WhatsAppDeveloperPanel headers={headers} mode="keys" /> : null}
      {section === "wa_webhooks" ? <WhatsAppDeveloperPanel headers={headers} mode="webhooks" /> : null}
      {section === "broadcasts" ? <BroadcastsPanel {...panelProps} /> : null}
      {section === "sequences" ? <SequencesPanel {...panelProps} /> : null}
      {section === "performance" ? <TeamPerformancePanel {...panelProps} /> : null}
      {section === "overview" ? <IntegrationsOverviewPanel headers={headers} onOpenSection={goTo} /> : null}
      {section === "meta" ? <MetaIntegrationPanel /> : null}
      {section === "whatsapp" ? <WhatsAppIntegrationPanel headers={headers} mode="cloud" /> : null}
      {section === "whatsapp_web" ? <WhatsAppIntegrationPanel headers={headers} mode="web" /> : null}
      {section === "automations" ? <WhatsAppAutomationsPanel headers={headers} /> : null}
      {section === "queue" ? <WhatsAppQueuePanel headers={headers} /> : null}
      {section === "tiktok" ? <TikTokIntegrationPanel /> : null}
    </Suspense>
  );

  if (variant === "page") {
    return (
      <section className="ai-inbox-section-page flex min-h-0 flex-1 flex-col overflow-hidden rounded-[18px] border border-white/10 bg-[#0b1120] text-white">
        <header className="flex items-center justify-between gap-3 border-b border-white/10 bg-white/[0.03] px-4 py-2.5">
          <div className="flex min-w-0 items-center gap-2.5">
            {(() => { const Icon = SECTION_ICON[section] || LayoutGrid; return <Icon className="h-4 w-4 text-cyan-200" aria-hidden="true" />; })()}
            <h2 className="truncate text-base font-black">{sectionLabel(t, section)}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("aiSupport.integrations.common.close")}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/[0.06] text-slate-300 transition hover:bg-white/10 hover:text-white"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </header>
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-3 md:p-5">{panels}</div>
      </section>
    );
  }

  return (
    <div
      className="fixed inset-0 z-[260] flex items-end justify-center bg-[#050810]/75 p-2 backdrop-blur-sm md:items-center md:p-4"
      onMouseDown={(event) => event.target === event.currentTarget && onClose?.()}
    >
      <section className="flex h-[94dvh] w-full max-w-6xl flex-col overflow-hidden rounded-[26px] border border-white/10 bg-[#0b1120] text-white shadow-[0_30px_100px_rgba(0,0,0,0.55)]">
        <header className="flex items-center justify-between gap-3 border-b border-white/10 bg-white/[0.03] px-4 py-3.5">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-cyan-300/20 bg-cyan-400/10 text-cyan-200">
              <SlidersHorizontal className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <div className="truncate text-lg font-black">{t("aiSupport.controlCenter.title")}</div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("aiSupport.integrations.common.close")}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/[0.06] text-slate-300 transition hover:bg-white/10 hover:text-white"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <nav className="flex shrink-0 gap-1.5 overflow-x-auto border-b border-white/10 bg-white/[0.02] p-2 md:w-60 md:flex-col md:overflow-y-auto md:border-b-0 md:border-s md:border-white/10">
            {CONTROL_CENTER_GROUPS.map((group) => (
              <div key={group.key} className="flex shrink-0 gap-1.5 md:mb-1 md:flex-col">
                <div className="hidden px-3 pb-1 pt-2 text-[10px] font-black uppercase tracking-[0.16em] text-slate-600 md:block">
                  {groupLabel(t, group.key)}
                </div>
                {group.sections.map((key) => {
                  const Icon = SECTION_ICON[key] || LayoutGrid;
                  const active = section === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => goTo(key)}
                      aria-current={active ? "page" : undefined}
                      className={`flex shrink-0 items-center gap-2.5 rounded-xl px-3 py-2.5 text-start text-xs font-black transition md:w-full ${
                        active
                          ? "bg-cyan-400/10 text-cyan-100 ring-1 ring-cyan-300/25"
                          : "text-slate-300 hover:bg-white/[0.05] hover:text-white"
                      }`}
                    >
                      <Icon className="h-4 w-4" aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate">{sectionLabel(t, key)}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>

          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-3 md:p-4">
            {panels}
          </div>
        </div>
      </section>
    </div>
  );
}
