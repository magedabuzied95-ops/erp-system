import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, MessagesSquare, Moon, Settings, Smartphone, Sun } from "lucide-react";
import { FaFacebookMessenger, FaInstagram, FaTiktok, FaWhatsapp } from "react-icons/fa";
import LanguageSwitcher from "../../../shared/components/LanguageSwitcher";
import { useTheme } from "../../../theme/useTheme";

/*
 * The inbox's own top bar: one menu per channel plus Config, the way Genie ERP
 * lays out its chat app. Nothing here is a new feature — every entry opens
 * something M1 already has (a control-center section or an existing page), so
 * the bar is a map of the inbox's tools rather than a second copy of them.
 * docs/inbox-topbar-genie-parity.md records which Genie page each entry stands
 * in for, and what is still to be built.
 *
 * Entry shapes:
 *   { section }            → opens that control-center section over the inbox
 *   { to }                 → navigates to an ERP page
 *   { comments: platform } → switches the inbox to that platform's comments
 */
const MENUS = [
  {
    key: "whatsapp",
    icon: FaWhatsapp,
    tone: "text-emerald-300",
    items: [
      { key: "waAccount", section: "whatsapp" },
      { key: "waTemplates", section: "wa_templates" },
      { key: "waCampaigns", section: "broadcasts" },
      { key: "waSequences", section: "sequences" },
      { key: "waInvoiceMessages", section: "invoice_messages" },
      { key: "flows", to: "/ai-studio/workflows" },
      { key: "waCatalog", to: "/settings" },
      { key: "waOrders", to: "/orders" },
      { key: "waUsage", section: "wa_usage" },
      { key: "waApiKeys", section: "wa_api_keys" },
      { key: "waWebhooks", section: "wa_webhooks" },
    ],
  },
  {
    key: "whatsappWeb",
    icon: Smartphone,
    tone: "text-lime-300",
    items: [
      { key: "webConnection", section: "whatsapp_web" },
      { key: "webQueue", section: "queue" },
      { key: "webAutomations", section: "automations" },
    ],
  },
  {
    key: "messenger",
    icon: FaFacebookMessenger,
    tone: "text-sky-300",
    items: [
      { key: "fbPages", section: "fb_pages" },
      { key: "fbConnect", section: "fb_connect" },
      { key: "posts", to: "/marketing/posts" },
      { key: "comments", comments: "facebook" },
      { key: "stories", to: "/marketing/ai-center" },
      { key: "autoReplies", section: "comments" },
      { key: "flows", to: "/ai-studio/workflows" },
    ],
  },
  {
    key: "instagram",
    icon: FaInstagram,
    tone: "text-pink-300",
    items: [
      { key: "igAccounts", section: "ig_accounts" },
      { key: "igConnect", section: "ig_connect" },
      { key: "comments", comments: "instagram" },
      { key: "posts", to: "/marketing/posts" },
      { key: "stories", to: "/marketing/ai-center" },
      { key: "autoReplies", section: "comments" },
      { key: "flows", to: "/ai-studio/workflows" },
    ],
  },
  {
    key: "tiktok",
    icon: FaTiktok,
    tone: "text-slate-200",
    items: [{ key: "tiktokConnect", section: "tiktok" }],
  },
  {
    key: "config",
    icon: Settings,
    tone: "text-amber-300",
    items: [
      { key: "agent", section: "agent" },
      { key: "teach", section: "teach" },
      { key: "actions", section: "actions" },
      { key: "playground", section: "playground" },
      { key: "quickReplies", section: "quick_replies" },
      { key: "tags", section: "cfg_tags" },
      { key: "teams", section: "cfg_teams" },
      { key: "groups", section: "cfg_groups" },
      { key: "shifts", section: "cfg_shifts" },
      { key: "presence", section: "cfg_presence" },
      { key: "backups", section: "cfg_backups" },
      { key: "performance", section: "performance" },
      { key: "connections", section: "overview" },
    ],
  },
];

// Literal keys so a missing translation stays greppable.
const menuLabel = (t, key) => {
  if (key === "whatsapp") return t("aiSupport.inbox.topbar.menus.whatsapp");
  if (key === "whatsappWeb") return t("aiSupport.inbox.topbar.menus.whatsappWeb");
  if (key === "messenger") return t("aiSupport.inbox.topbar.menus.messenger");
  if (key === "instagram") return t("aiSupport.inbox.topbar.menus.instagram");
  if (key === "tiktok") return t("aiSupport.inbox.topbar.menus.tiktok");
  return t("aiSupport.inbox.topbar.menus.config");
};

const itemLabel = (t, key) => {
  switch (key) {
    case "waAccount": return t("aiSupport.inbox.topbar.items.waAccount");
    case "waTemplates": return t("aiSupport.inbox.topbar.items.waTemplates");
    case "waCampaigns": return t("aiSupport.inbox.topbar.items.waCampaigns");
    case "waSequences": return t("aiSupport.inbox.topbar.items.waSequences");
    case "waInvoiceMessages": return t("aiSupport.inbox.topbar.items.waInvoiceMessages");
    case "waCatalog": return t("aiSupport.inbox.topbar.items.waCatalog");
    case "waOrders": return t("aiSupport.inbox.topbar.items.waOrders");
    case "waUsage": return t("aiSupport.inbox.topbar.items.waUsage");
    case "waApiKeys": return t("aiSupport.inbox.topbar.items.waApiKeys");
    case "waWebhooks": return t("aiSupport.inbox.topbar.items.waWebhooks");
    case "webConnection": return t("aiSupport.inbox.topbar.items.webConnection");
    case "webQueue": return t("aiSupport.inbox.topbar.items.webQueue");
    case "webAutomations": return t("aiSupport.inbox.topbar.items.webAutomations");
    case "fbPages": return t("aiSupport.metaAccounts.titles.fbPages");
    case "fbConnect": return t("aiSupport.metaAccounts.titles.fbConnect");
    case "igAccounts": return t("aiSupport.metaAccounts.titles.igAccounts");
    case "igConnect": return t("aiSupport.metaAccounts.titles.igConnect");
    case "comments": return t("aiSupport.inbox.topbar.items.comments");
    case "posts": return t("aiSupport.inbox.topbar.items.posts");
    case "stories": return t("aiSupport.inbox.topbar.items.stories");
    case "autoReplies": return t("aiSupport.inbox.topbar.items.autoReplies");
    case "flows": return t("aiSupport.inbox.topbar.items.flows");
    case "tiktokConnect": return t("aiSupport.inbox.topbar.items.tiktokConnect");
    case "agent": return t("aiSupport.inbox.topbar.items.agent");
    case "teach": return t("aiSupport.inbox.topbar.items.teach");
    case "actions": return t("aiSupport.inbox.topbar.items.actions");
    case "playground": return t("aiSupport.inbox.topbar.items.playground");
    case "quickReplies": return t("aiSupport.inbox.topbar.items.quickReplies");
    case "tags": return t("aiSupport.inbox.topbar.items.tags");
    case "presence": return t("aiSupport.inbox.topbar.items.presence");
    case "backups": return t("aiSupport.inbox.topbar.items.backups");
    case "teams": return t("aiSupport.inbox.topbar.items.teams");
    case "groups": return t("aiSupport.inbox.topbar.items.groups");
    case "shifts": return t("aiSupport.inbox.topbar.items.shifts");
    case "performance": return t("aiSupport.inbox.topbar.items.performance");
    default: return t("aiSupport.inbox.topbar.items.connections");
  }
};

export default function InboxTopBar({
  chatsActive = true,
  onChats,
  onOpenSection,
  onNavigate,
  onComments,
  availableSections = null,
  activeSection = "",
}) {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();
  const [openMenu, setOpenMenu] = useState("");
  const barRef = useRef(null);

  useEffect(() => {
    if (!openMenu) return undefined;
    const close = (event) => {
      if (event.type === "keydown" && event.key !== "Escape") return;
      if (event.type === "mousedown" && barRef.current?.contains(event.target)) return;
      setOpenMenu("");
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", close);
    };
  }, [openMenu]);

  // The menu that owns the open page (the first one, where two share a section).
  const activeMenu = activeSection ? MENUS.find((menu) => menu.items.some((item) => item.section === activeSection))?.key || "" : "";

  const run = (item) => {
    setOpenMenu("");
    if (item.section) onOpenSection?.(item.section);
    else if (item.comments) onComments?.(item.comments);
    else if (item.to) onNavigate?.(item.to);
  };

  return (
    <nav ref={barRef} className="ai-inbox-topbar" aria-label={t("aiSupport.inbox.topbar.label")}>
      <button
        type="button"
        onClick={() => { setOpenMenu(""); onChats?.(); }}
        className={`ai-inbox-topbar__tab ${chatsActive ? "is-active" : ""}`}
        aria-current={chatsActive ? "page" : undefined}
      >
        <MessagesSquare className="h-4 w-4 text-cyan-300" aria-hidden="true" />
        <span>{t("aiSupport.inbox.topbar.chats")}</span>
      </button>
      {MENUS.map((menu) => {
        const Icon = menu.icon;
        const items = menu.items.filter((item) => !item.section || !availableSections || availableSections.includes(item.section));
        if (!items.length) return null;
        const open = openMenu === menu.key;
        return (
          <div key={menu.key} className="ai-inbox-topbar__menu">
            <button
              type="button"
              onClick={() => setOpenMenu(open ? "" : menu.key)}
              className={`ai-inbox-topbar__tab ${open ? "is-open" : ""} ${activeMenu === menu.key ? "is-active" : ""}`}
              aria-haspopup="menu"
              aria-expanded={open}
            >
              <Icon className={`h-4 w-4 ${menu.tone}`} aria-hidden="true" />
              <span>{menuLabel(t, menu.key)}</span>
              <ChevronDown className={`h-3.5 w-3.5 opacity-60 transition ${open ? "rotate-180" : ""}`} aria-hidden="true" />
            </button>
            {open ? (
              <div role="menu" className="ai-inbox-topbar__dropdown">
                {items.map((item) => (
                  <button key={`${menu.key}:${item.key}`} type="button" role="menuitem" onClick={() => run(item)} className={`ai-inbox-topbar__item ${item.section && item.section === activeSection ? "is-current" : ""}`}>
                    {itemLabel(t, item.key)}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
      {/* The shell topbar is hidden on this route, and with it the language and theme
          switches — so the inbox carries its own. */}
      <div className="ai-inbox-topbar__tools">
        <LanguageSwitcher compact className="shrink-0" />
        <button
          type="button"
          onClick={() => setTheme(theme.mode === "dark" ? "light" : "dark")}
          className="ai-inbox-topbar__tab"
          aria-label={theme.mode === "dark" ? t("appearance.lightMode") : t("appearance.darkMode")}
          title={theme.mode === "dark" ? t("appearance.lightMode") : t("appearance.darkMode")}
        >
          {theme.mode === "dark" ? <Sun className="h-4 w-4" aria-hidden="true" /> : <Moon className="h-4 w-4" aria-hidden="true" />}
        </button>
      </div>
    </nav>
  );
}
