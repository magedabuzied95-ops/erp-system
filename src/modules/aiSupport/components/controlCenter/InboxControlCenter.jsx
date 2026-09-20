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
  Gauge,
  GraduationCap,
  LayoutGrid,
  Megaphone,
  MessageSquareText,
  Music2,
  PlayCircle,
  Power,
  Receipt,
  SlidersHorizontal,
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

const MetaGlyph = () => (
  <span className="relative inline-flex h-4 w-5 items-center" aria-hidden="true">
    <FaFacebookF className="h-4 w-4 text-blue-300" />
    <FaInstagram className="absolute -right-1 bottom-0 h-3 w-3 text-pink-300" />
  </span>
);

export const CONTROL_CENTER_GROUPS = [
  { key: "agent", sections: ["agent", "teach", "actions", "playground"] },
  { key: "workspace", sections: ["quick_replies", "comments", "invoice_messages"] },
  { key: "growth", sections: ["broadcasts"] },
  { key: "insight", sections: ["performance"] },
  { key: "connections", sections: ["overview", "meta", "whatsapp", "automations", "queue", "tiktok"] },
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
  broadcasts: Megaphone,
  performance: BarChart3,
  overview: LayoutGrid,
  meta: MetaGlyph,
  whatsapp: () => <FaWhatsapp className="h-4 w-4 text-emerald-300" aria-hidden="true" />,
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
  if (key === "broadcasts") return t("aiSupport.controlCenter.nav.broadcasts");
  if (key === "performance") return t("aiSupport.controlCenter.nav.performance");
  if (key === "overview") return t("aiSupport.integrations.nav.overview");
  if (key === "meta") return t("aiSupport.integrations.nav.meta");
  if (key === "whatsapp") return t("aiSupport.integrations.nav.whatsapp");
  if (key === "automations") return t("aiSupport.integrations.nav.automations");
  if (key === "queue") return t("aiSupport.integrations.nav.queue");
  if (key === "tiktok") return t("aiSupport.integrations.nav.tiktok");
  return key;
};

const groupLabel = (t, key) => {
  if (key === "agent") return t("aiSupport.controlCenter.groups.agent");
  if (key === "workspace") return t("aiSupport.controlCenter.groups.workspace");
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
}) {
  const { t } = useTranslation();
  const [section, setSection] = useState(
    CONTROL_CENTER_SECTIONS.includes(initialSection) ? initialSection : "agent"
  );

  useEffect(() => {
    if (open && CONTROL_CENTER_SECTIONS.includes(initialSection)) setSection(initialSection);
  }, [initialSection, open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, open]);

  const goTo = useCallback((next) => {
    if (CONTROL_CENTER_SECTIONS.includes(next)) setSection(next);
  }, []);

  const panelProps = useMemo(() => ({ headers, tenantId }), [headers, tenantId]);

  if (!open) return null;

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
              {section === "broadcasts" ? <BroadcastsPanel {...panelProps} /> : null}
              {section === "performance" ? <TeamPerformancePanel {...panelProps} /> : null}
              {section === "overview" ? <IntegrationsOverviewPanel headers={headers} onOpenSection={goTo} /> : null}
              {section === "meta" ? <MetaIntegrationPanel /> : null}
              {section === "whatsapp" ? <WhatsAppIntegrationPanel headers={headers} /> : null}
              {section === "automations" ? <WhatsAppAutomationsPanel headers={headers} /> : null}
              {section === "queue" ? <WhatsAppQueuePanel headers={headers} /> : null}
              {section === "tiktok" ? <TikTokIntegrationPanel /> : null}
            </Suspense>
          </div>
        </div>
      </section>
    </div>
  );
}
