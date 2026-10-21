import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Bookmark, Check, Clock3, Filter, GitBranch, Minus, Search, Tag, Trash2, Users, X } from "lucide-react";
import { api } from "../../../shared/api/api";
import { collectAncestorZIndexes, resolveMenuZIndex } from "../../../shared/ui/selectMenuLayer";
import {
  AI_INBOX_DEFAULT_LABELS,
  normalizeAiInboxConversationLabels,
} from "../../../../shared/aiInboxConversationLabels.js";
import {
  EMPTY_PANEL_FILTERS,
  PANEL_UNASSIGNED_MEMBER,
  normalizePanelFilters,
  panelFilterCount,
  panelFilterTabCounts,
} from "../lib/inboxFilterPanel.js";

/*
 * Genie ERP's conversation filter panel, for the desktop inbox. Six tabs:
 * Accounts (every line we run, grouped by platform), Labels, Stages, Members,
 * Activity, and Saved combinations. The panel only edits a value; the inbox
 * sends it to the list API, which filters in SQL (lib/inboxFilterPanel.js).
 *
 * The option lists load on first open and stay for the session. Saved filters
 * are kept per user in this browser.
 */

const TABS = [
  { key: "accounts", icon: Filter },
  { key: "labels", icon: Tag },
  { key: "stages", icon: GitBranch },
  { key: "members", icon: Users },
  { key: "activity", icon: Clock3 },
  { key: "saved", icon: Bookmark },
];

const PLATFORM_ORDER = ["whatsapp", "facebook_messenger", "instagram"];
const PLATFORM_TITLES = { whatsapp: "WhatsApp", facebook_messenger: "Messenger", instagram: "Instagram" };

const LABEL_DOTS = {
  sky: "#0ea5e9", cyan: "#06b6d4", amber: "#f59e0b", violet: "#8b5cf6", emerald: "#10b981",
  rose: "#f43f5e", orange: "#f97316", teal: "#14b8a6", slate: "#94a3b8", blue: "#3b82f6",
  red: "#ef4444", green: "#22c55e", purple: "#a855f7", pink: "#ec4899", yellow: "#eab308", gray: "#9ca3af",
};
const labelDot = (color = "") => (/^#[0-9a-f]{3,8}$/i.test(String(color)) ? color : LABEL_DOTS[String(color).toLowerCase()] || "#94a3b8");

const clean = (value) => String(value ?? "").trim();
const fold = (value) => clean(value).toLowerCase();

// Option lists, kept between opens for the session.
let optionCache = null;
const loadOptions = async () => {
  const quiet = { suppressErrorStatuses: [401, 403, 404, 500, 502, 503], timeoutMs: 10000 };
  const [accounts, labels, staff] = await Promise.all([
    api.get("/ai-inbox/filter-accounts", quiet).then((payload) => (Array.isArray(payload?.accounts) ? payload.accounts : [])).catch(() => null),
    api.get("/inbox-config/tags/options", quiet)
      .then((payload) => (Array.isArray(payload?.labels) ? normalizeAiInboxConversationLabels(payload.labels, { max: 500 }) : null))
      .catch(() => null),
    api.get("/ai-inbox/staff", quiet).then((payload) => (Array.isArray(payload?.staff) ? payload.staff : [])).catch(() => null),
  ]);
  optionCache = {
    accounts: accounts || optionCache?.accounts || [],
    labels: labels?.length ? labels : optionCache?.labels || AI_INBOX_DEFAULT_LABELS,
    staff: staff || optionCache?.staff || [],
  };
  return optionCache;
};

const readSaved = (storageKey) => {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey) || "[]");
    return Array.isArray(parsed) ? parsed.filter((item) => item && item.id && item.name) : [];
  } catch {
    return [];
  }
};
const writeSaved = (storageKey, items) => {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(items));
  } catch {
    // Private window or blocked storage: the saved list just lives until reload.
  }
};

function CheckBox({ state = "off" }) {
  const on = state === "on";
  const mixed = state === "mixed";
  return (
    <span
      aria-hidden="true"
      className={`grid h-4 w-4 shrink-0 place-items-center rounded border transition ${on || mixed ? "border-primary bg-primary text-primary-foreground" : "border-border-strong bg-surface"}`}
    >
      {on ? <Check className="h-3 w-3" strokeWidth={3} /> : mixed ? <Minus className="h-3 w-3" strokeWidth={3} /> : null}
    </span>
  );
}

function OptionRow({ checked, onToggle, children, title }) {
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={checked}
      onClick={onToggle}
      title={title}
      className={`flex w-full items-center gap-3 px-4 py-2 text-start text-sm transition hover:bg-surface-hover ${checked ? "bg-surface-soft" : ""}`}
    >
      <CheckBox state={checked ? "on" : "off"} />
      <span className="flex min-w-0 flex-1 items-center gap-2 truncate text-text">{children}</span>
    </button>
  );
}

function DayField({ label, value, onChange }) {
  // A wrapper is the visible box and the native control fills it absolutely:
  // date inputs refuse to shrink below their intrinsic width and otherwise
  // paint over their neighbour (see the manager portal's period picker).
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-xs font-semibold text-text-muted">{label}</span>
      <span className="relative block h-9 overflow-hidden rounded-lg border border-border bg-surface">
        <input
          type="date"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="absolute inset-0 h-full w-full appearance-none bg-transparent px-2 text-sm text-text outline-none"
          style={{ WebkitAppearance: "none" }}
        />
      </span>
    </label>
  );
}

export default function InboxFilterPanel({
  open = false,
  anchorRef,
  onClose,
  value = EMPTY_PANEL_FILTERS,
  onChange,
  stageOptions = [],
  storageKey = "m1.inbox.savedFilters",
}) {
  const { t } = useTranslation();
  const panelRef = useRef(null);
  const [tab, setTab] = useState("accounts");
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState(() => optionCache);
  const [layout, setLayout] = useState(null);
  const [saved, setSaved] = useState(() => readSaved(storageKey));
  const [saveName, setSaveName] = useState("");
  const [naming, setNaming] = useState(false);
  const filters = useMemo(() => normalizePanelFilters(value), [value]);
  const tabCounts = useMemo(() => panelFilterTabCounts(filters), [filters]);
  const totalCount = panelFilterCount(filters);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    loadOptions().then((next) => { if (alive) setOptions(next); });
    setSaved(readSaved(storageKey));
    return () => { alive = false; };
  }, [open, storageKey]);

  useEffect(() => { setQuery(""); setNaming(false); }, [tab, open]);

  // Fixed under the anchor (the search row), clamped into the viewport, on the
  // layer above whatever holds the anchor.
  useLayoutEffect(() => {
    if (!open) return undefined;
    const place = () => {
      const anchor = anchorRef?.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const rtl = getComputedStyle(anchor).direction === "rtl";
      const width = Math.min(540, window.innerWidth - 16);
      let left = rtl ? rect.right - width : rect.left;
      left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
      const top = rect.bottom + 6;
      setLayout({
        top,
        left,
        width,
        maxHeight: Math.max(260, Math.min(520, window.innerHeight - top - 12)),
        zIndex: resolveMenuZIndex(collectAncestorZIndexes(anchor, (node) => window.getComputedStyle(node).zIndex)),
      });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchorRef, open]);

  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event) => {
      if (panelRef.current?.contains(event.target)) return;
      if (anchorRef?.current?.contains(event.target)) return;
      onClose?.();
    };
    const onKey = (event) => { if (event.key === "Escape") onClose?.(); };
    document.addEventListener("pointerdown", onPointer, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [anchorRef, onClose, open]);

  if (!open || !layout) return null;

  const update = (patch) => onChange?.(normalizePanelFilters({ ...filters, ...patch }));
  const toggleIn = (field, id) => {
    const current = filters[field];
    update({ [field]: current.includes(id) ? current.filter((item) => item !== id) : [...current, id] });
  };

  const accounts = options?.accounts || [];
  const labels = options?.labels || [];
  const staff = options?.staff || [];
  const accountName = (key) => accounts.find((account) => account.key === key)?.label || key.split(":").slice(1).join(":");
  const labelName = (id) => labels.find((label) => clean(label.id) === id)?.name || id;
  const stageName = (id) => stageOptions.find((stage) => stage.id === id)?.label || id;
  const memberName = (id) => (id === PANEL_UNASSIGNED_MEMBER
    ? t("aiSupport.inbox.filterPanel.unassigned")
    : staff.find((person) => String(person.id) === id)?.name || `#${id}`);

  const searchable = ["accounts", "labels", "stages", "members"].includes(tab);
  const match = (textValue) => !query || fold(textValue).includes(fold(query));

  const chipsFor = {
    accounts: filters.accounts.map((id) => ({ id, label: accountName(id) })),
    labels: filters.labels.map((id) => ({ id, label: labelName(id) })),
    stages: filters.stages.map((id) => ({ id, label: stageName(id) })),
    members: filters.members.map((id) => ({ id, label: memberName(id) })),
  };

  const renderAccounts = () => {
    const groups = PLATFORM_ORDER
      .map((platform) => ({ platform, rows: accounts.filter((account) => account.platform === platform) }))
      .filter((group) => group.rows.length);
    if (!groups.length) return <p className="px-4 py-6 text-center text-sm text-text-muted">{t("aiSupport.inbox.filterPanel.noAccounts")}</p>;
    return groups.map((group) => {
      const visible = group.rows.filter((account) => match(account.label) || match(account.key));
      if (!visible.length) return null;
      const keys = group.rows.map((account) => account.key);
      const picked = keys.filter((key) => filters.accounts.includes(key)).length;
      const state = picked === 0 ? "off" : picked === keys.length ? "on" : "mixed";
      return (
        <div key={group.platform}>
          <button
            type="button"
            onClick={() => update({
              accounts: state === "on"
                ? filters.accounts.filter((key) => !keys.includes(key))
                : [...new Set([...filters.accounts, ...keys])],
            })}
            className="sticky top-0 z-[1] flex w-full items-center gap-3 border-y border-border bg-surface-soft px-4 py-2.5 text-start text-xs font-black uppercase tracking-wide text-text"
          >
            <CheckBox state={state} />
            {PLATFORM_TITLES[group.platform] || group.platform}
          </button>
          {visible.map((account) => (
            <OptionRow key={account.key} checked={filters.accounts.includes(account.key)} onToggle={() => toggleIn("accounts", account.key)} title={account.key}>
              <span className="truncate">{account.label}</span>
              {account.provider === "cloud" ? (
                <span className="shrink-0 rounded-full bg-success-subtle px-1.5 py-0.5 text-[10px] font-bold text-success">{t("aiSupport.inbox.filterPanel.official")}</span>
              ) : null}
            </OptionRow>
          ))}
        </div>
      );
    });
  };

  const renderPlainList = (field, rows) => {
    const visible = rows.filter((row) => match(row.label));
    if (!visible.length) return <p className="px-4 py-6 text-center text-sm text-text-muted">{t("aiSupport.inbox.filterPanel.nothing")}</p>;
    return visible.map((row) => (
      <OptionRow key={row.id} checked={filters[field].includes(row.id)} onToggle={() => toggleIn(field, row.id)}>
        {row.dot ? <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: row.dot }} /> : null}
        {row.avatar ? (
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary-subtle text-[10px] font-black text-primary">{row.avatar}</span>
        ) : null}
        <span className="truncate">{row.label}</span>
        {row.hint ? <span className="truncate text-xs text-text-muted">{row.hint}</span> : null}
      </OptionRow>
    ));
  };

  const renderActivity = () => {
    const choices = [
      ["", t("aiSupport.inbox.filterPanel.anyTime")],
      ["24h", t("aiSupport.inbox.filterPanel.last24h")],
      ["3d", t("aiSupport.inbox.filterPanel.last3d")],
      ["7d", t("aiSupport.inbox.filterPanel.last7d")],
      ["custom", t("aiSupport.inbox.filterPanel.customRange")],
    ];
    return (
      <div className="p-3">
        <p className="mb-2 px-1 text-xs font-semibold text-text-muted">{t("aiSupport.inbox.filterPanel.activityHint")}</p>
        <div role="radiogroup" className="space-y-1">
          {choices.map(([key, label]) => {
            const on = filters.activity === key;
            return (
              <button
                key={key || "any"}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => update({ activity: key, ...(key === "custom" ? {} : { activityFrom: "", activityTo: "" }) })}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-start text-sm transition ${on ? "bg-primary-subtle font-bold text-primary" : "text-text hover:bg-surface-hover"}`}
              >
                <span className={`grid h-4 w-4 shrink-0 place-items-center rounded-full border ${on ? "border-primary" : "border-border-strong"}`}>
                  {on ? <span className="h-2 w-2 rounded-full bg-primary" /> : null}
                </span>
                {label}
              </button>
            );
          })}
        </div>
        {filters.activity === "custom" ? (
          <div className="mt-3 grid grid-cols-2 gap-3 px-1">
            <DayField label={t("aiSupport.inbox.filterPanel.from")} value={filters.activityFrom} onChange={(day) => update({ activityFrom: day })} />
            <DayField label={t("aiSupport.inbox.filterPanel.to")} value={filters.activityTo} onChange={(day) => update({ activityTo: day })} />
          </div>
        ) : null}
      </div>
    );
  };

  const saveCurrent = () => {
    const name = clean(saveName);
    if (!name || !totalCount) return;
    const next = [{ id: `${Date.now()}`, name, filters }, ...saved.filter((item) => item.name !== name)].slice(0, 30);
    setSaved(next);
    writeSaved(storageKey, next);
    setSaveName("");
    setNaming(false);
  };
  const removeSaved = (id) => {
    const next = saved.filter((item) => item.id !== id);
    setSaved(next);
    writeSaved(storageKey, next);
  };

  const renderSaved = () => (
    <div className="flex min-h-full flex-col">
      {saved.length ? (
        <div className="flex-1 py-1">
          {saved.map((item) => {
            const count = panelFilterCount(item.filters);
            return (
              <div key={item.id} className="group flex items-center gap-2 px-2">
                <button
                  type="button"
                  onClick={() => { onChange?.(normalizePanelFilters(item.filters)); onClose?.(); }}
                  className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-2 text-start text-sm text-text transition hover:bg-surface-hover"
                >
                  <Bookmark className="h-4 w-4 shrink-0 text-primary" />
                  <span className="truncate font-semibold">{item.name}</span>
                  <span className="shrink-0 text-xs text-text-muted">{t("aiSupport.inbox.filterPanel.filtersCount", { count })}</span>
                </button>
                <button
                  type="button"
                  onClick={() => removeSaved(item.id)}
                  aria-label={t("aiSupport.inbox.filterPanel.deleteSaved")}
                  title={t("aiSupport.inbox.filterPanel.deleteSaved")}
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-text-muted transition hover:bg-danger-subtle hover:text-danger"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-10 text-center">
          <Bookmark className="h-6 w-6 text-text-muted" />
          <p className="text-sm font-bold text-text">{t("aiSupport.inbox.filterPanel.noSaved")}</p>
          <p className="text-xs text-text-muted">{t("aiSupport.inbox.filterPanel.noSavedHint")}</p>
        </div>
      )}
      {totalCount ? (
        <div className="sticky bottom-0 border-t border-border bg-surface p-3">
          {naming ? (
            <form
              className="flex items-center gap-2"
              onSubmit={(event) => { event.preventDefault(); saveCurrent(); }}
            >
              <input
                autoFocus
                value={saveName}
                onChange={(event) => setSaveName(event.target.value)}
                placeholder={t("aiSupport.inbox.filterPanel.saveNamePlaceholder")}
                className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-surface-soft px-3 text-sm text-text outline-none focus:border-primary"
              />
              <button type="submit" disabled={!clean(saveName)} className="h-9 shrink-0 rounded-lg bg-primary px-3 text-sm font-bold text-primary-foreground disabled:opacity-50">
                {t("aiSupport.inbox.filterPanel.save")}
              </button>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setNaming(true)}
              className="flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-primary-subtle text-sm font-bold text-primary transition hover:opacity-90"
            >
              <Bookmark className="h-4 w-4" />
              {t("aiSupport.inbox.filterPanel.saveCurrent")}
            </button>
          )}
        </div>
      ) : null}
    </div>
  );

  const body = {
    accounts: renderAccounts,
    labels: () => renderPlainList("labels", labels.map((label) => ({ id: clean(label.id), label: clean(label.name) || clean(label.id), dot: labelDot(label.color) }))),
    stages: () => renderPlainList("stages", stageOptions),
    members: () => renderPlainList("members", [
      { id: PANEL_UNASSIGNED_MEMBER, label: t("aiSupport.inbox.filterPanel.unassigned") },
      ...staff.map((person) => ({
        id: String(person.id),
        label: clean(person.name) || `#${person.id}`,
        hint: clean(person.branch),
        avatar: (clean(person.name).replace(/\s+/g, " ").split(" ").map((part) => part[0]).join("").slice(0, 2) || "#").toUpperCase(),
      })),
    ]),
    activity: renderActivity,
    saved: renderSaved,
  }[tab];

  const chips = chipsFor[tab] || [];

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label={t("aiSupport.inbox.filterPanel.title")}
      data-inbox-filter-panel="true"
      className="fixed flex flex-col overflow-hidden rounded-2xl border border-border bg-surface text-text shadow-2xl"
      style={{ top: layout.top, left: layout.left, width: layout.width, maxHeight: layout.maxHeight, zIndex: layout.zIndex }}
    >
      {/* All six tabs share the width — no scroll strip, nothing cut off. */}
      <div role="tablist" className="flex shrink-0 items-stretch overflow-hidden border-b border-border">
        {TABS.map(({ key, icon: Icon }) => {
          const on = tab === key;
          const count = tabCounts[key] || 0;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setTab(key)}
              className={`relative flex min-w-0 flex-1 items-center justify-center gap-1 px-1.5 py-2.5 text-xs font-semibold outline-none transition focus-visible:bg-surface-hover ${on ? "text-primary" : "text-text-muted hover:text-text"}`}
              style={{ border: 0, boxShadow: "none" }}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="truncate">{t(`aiSupport.inbox.filterPanel.tabs.${key}`)}</span>
              {count ? <span className="grid h-4 min-w-4 shrink-0 place-items-center rounded-full bg-primary px-1 text-[10px] font-black text-primary-foreground">{count}</span> : null}
              {on ? <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-primary" /> : null}
            </button>
          );
        })}
      </div>
      {searchable ? (
        <div className="shrink-0 space-y-2 p-3">
          <div className="flex items-center gap-2">
            <label className="relative flex h-9 min-w-0 flex-1 items-center rounded-lg border border-border bg-surface-soft">
              <Search className="pointer-events-none absolute start-2.5 h-4 w-4 text-text-muted" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t(`aiSupport.inbox.filterPanel.search.${tab}`)}
                className="h-9 w-full min-w-0 bg-transparent ps-8 pe-2 text-sm text-text outline-none placeholder:text-text-muted"
              />
            </label>
            {chips.length ? (
              <button type="button" onClick={() => update({ [tab]: [] })} className="shrink-0 px-1 text-xs font-semibold text-text-muted hover:text-text">
                {t("aiSupport.inbox.filterPanel.clear")}
              </button>
            ) : null}
          </div>
          {chips.length ? (
            <div className="flex flex-wrap gap-1.5">
              {chips.map((chip) => (
                <span key={chip.id} className="inline-flex max-w-full items-center gap-1 rounded-md bg-primary-subtle px-2 py-1 text-xs font-semibold text-primary">
                  <span className="truncate">{chip.label}</span>
                  <button type="button" onClick={() => toggleIn(tab, chip.id)} aria-label={t("aiSupport.inbox.filterPanel.remove", { name: chip.label })} className="grid h-4 w-4 place-items-center rounded hover:bg-primary/15">
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-1" style={{ minHeight: 220 }}>
        {options || tab === "activity" || tab === "saved" || tab === "stages"
          ? body()
          : <p className="px-4 py-6 text-center text-sm text-text-muted">{t("aiSupport.inbox.filterPanel.loading")}</p>}
      </div>
      {totalCount && tab !== "saved" ? (
        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border px-3 py-2">
          <span className="text-xs text-text-muted">{t("aiSupport.inbox.filterPanel.filtersCount", { count: totalCount })}</span>
          <button type="button" onClick={() => onChange?.({ ...EMPTY_PANEL_FILTERS })} className="text-xs font-bold text-danger hover:underline">
            {t("aiSupport.inbox.filterPanel.clearAll")}
          </button>
        </div>
      ) : null}
    </div>,
    // The inbox can go fullscreen; a body-mounted panel would sit behind it.
    document.fullscreenElement || document.body
  );
}
