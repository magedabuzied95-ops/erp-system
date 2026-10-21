import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { LayoutGrid, Search } from "lucide-react";
import {
  RECENT_PAGES_EVENT,
  foldSearchText,
  frequentPagePaths,
  recentPagePaths,
} from "../navigation/recentPages";

/*
 * Quick search, Genie ERP's "Start typing to go anywhere…" (Ctrl K).
 *
 * Empty: Jump back (the page you were on before this one), Likely next (the
 * pages you open most), Recent. Typing: every page you may open, by name and by
 * its section, the matched letters marked. ↑↓ move, Enter goes, Ctrl+Enter opens
 * a new tab, Esc closes. The list is the sidebar's own (what this user is
 * allowed to see), so a search never offers a page the sidebar would hide.
 *
 * <CommandPaletteTrigger> is the search pill plus the last two pages visited,
 * for any top bar; one <CommandPalette> is mounted by the shell and opened by
 * the shortcut or by OPEN_COMMAND_PALETTE_EVENT.
 */

export const OPEN_COMMAND_PALETTE_EVENT = "erp:open-command-palette";
export const openCommandPalette = () => window.dispatchEvent(new CustomEvent(OPEN_COMMAND_PALETTE_EVENT));

// The shell publishes the page list (the sidebar's, translated) and where you
// are, so a top bar the shell does not own — the inbox's — can show the same
// trigger and shortcuts.
const PALETTE_STATE_EVENT = "erp:command-palette-state";
let paletteState = { items: [], userId: "", currentPath: "" };
export const publishCommandPaletteState = (next = {}) => {
  paletteState = { ...paletteState, ...next };
  window.dispatchEvent(new CustomEvent(PALETTE_STATE_EVENT));
};
export const useCommandPaletteState = () => {
  const [state, setState] = useState(paletteState);
  useEffect(() => {
    const sync = () => setState(paletteState);
    sync();
    window.addEventListener(PALETTE_STATE_EVENT, sync);
    return () => window.removeEventListener(PALETTE_STATE_EVENT, sync);
  }, []);
  return state;
};
// The trigger fed from the shell's published state.
export function ShellCommandPaletteTrigger(props) {
  const state = useCommandPaletteState();
  return <CommandPaletteTrigger items={state.items} userId={state.userId} currentPath={state.currentPath} {...props} />;
}

function Highlight({ text = "", query = "" }) {
  const q = String(query || "").trim().toLowerCase();
  const raw = String(text || "");
  const at = q ? raw.toLowerCase().indexOf(q) : -1;
  if (at < 0) return <>{raw}</>;
  return (
    <>
      {raw.slice(0, at)}
      <mark className="rounded-sm bg-transparent font-black text-primary">{raw.slice(at, at + q.length)}</mark>
      {raw.slice(at + q.length)}
    </>
  );
}

function PageIcon({ icon: Icon }) {
  return (
    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary-subtle text-primary">
      {Icon ? <Icon className="h-4 w-4" /> : <LayoutGrid className="h-4 w-4" />}
    </span>
  );
}

function Kbd({ children }) {
  return <kbd className="rounded border border-border bg-surface-soft px-1.5 py-0.5 font-mono text-[10px] text-text-muted">{children}</kbd>;
}

const SHORTCUT_FALLBACK_PATHS = ["/orders", "/products", "/dashboard", "/customers", "/pos"];

export function useRecentPageShortcuts({ items = [], userId, currentPath = "", limit = 2 }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const bump = () => setTick((value) => value + 1);
    window.addEventListener(RECENT_PAGES_EVENT, bump);
    window.addEventListener("storage", bump);
    return () => {
      window.removeEventListener(RECENT_PAGES_EVENT, bump);
      window.removeEventListener("storage", bump);
    };
  }, []);
  return useMemo(() => {
    const byPath = new Map(items.map((item) => [item.to, item]));
    const picked = recentPagePaths(userId, currentPath).map((path) => byPath.get(path)).filter(Boolean).slice(0, limit);
    // Two shortcuts always (Genie shows the last two pages): until there is that
    // much history, the most used pages of the shop fill the gap.
    for (const path of SHORTCUT_FALLBACK_PATHS) {
      if (picked.length >= limit) break;
      const item = byPath.get(path);
      if (item && path !== currentPath && !picked.includes(item)) picked.push(item);
    }
    return picked;
    // tick: re-read storage after a visit
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPath, items, limit, userId, tick]);
}

export function CommandPaletteTrigger({ items = [], userId, currentPath = "", className = "", compact = false }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const shortcuts = useRecentPageShortcuts({ items, userId, currentPath });
  return (
    <div className={`flex min-w-0 items-center gap-1.5 ${className}`} data-command-palette-trigger="true">
      <button
        type="button"
        onClick={openCommandPalette}
        className={`inline-flex h-9 min-w-0 items-center gap-2 rounded-full border border-border bg-surface px-3 text-sm text-text-muted transition hover:border-primary/50 ${compact ? "w-9 justify-center px-0" : "w-56 xl:w-64"}`}
        aria-label={t("common.commandPalette.open")}
        title={t("common.commandPalette.open")}
      >
        <Search className="h-4 w-4 shrink-0 text-primary" />
        {compact ? null : (
          <>
            <span className="min-w-0 flex-1 truncate text-start">{t("common.commandPalette.placeholderShort")}</span>
            <Kbd>Ctrl K</Kbd>
          </>
        )}
      </button>
      {compact ? null : shortcuts.map((item) => {
        const Icon = item.icon;
        return (
          <button
            key={item.to}
            type="button"
            onClick={(event) => (event.ctrlKey || event.metaKey ? window.open(item.to, "_blank", "noopener") : navigate(item.to))}
            title={item.section ? `${item.section} / ${item.label}` : item.label}
            className="hidden h-9 max-w-[11rem] shrink-0 items-center gap-1.5 rounded-full px-2.5 text-sm font-semibold text-text-muted transition hover:bg-surface-hover hover:text-text lg:inline-flex"
          >
            {Icon ? <Icon className="h-4 w-4 shrink-0 text-primary" /> : <LayoutGrid className="h-4 w-4 shrink-0 text-primary" />}
            <span className="truncate">{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export default function CommandPalette({ items = [], userId, currentPath = "" }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  useEffect(() => {
    const onKey = (event) => {
      if ((event.ctrlKey || event.metaKey) && !event.altKey && String(event.key).toLowerCase() === "k") {
        event.preventDefault();
        setOpen((current) => !current);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_COMMAND_PALETTE_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_COMMAND_PALETTE_EVENT, onOpen);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(0);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  const groups = useMemo(() => {
    if (!open) return [];
    const byPath = new Map(items.map((item) => [item.to, item]));
    const q = foldSearchText(query);
    if (!q) {
      const recent = recentPagePaths(userId, currentPath).map((path) => byPath.get(path)).filter(Boolean);
      const jumpBack = recent.slice(0, 1);
      const frequent = frequentPagePaths(userId, currentPath).map((path) => byPath.get(path)).filter((item) => item && !jumpBack.includes(item)).slice(0, 3);
      const rest = recent.slice(1).filter((item) => !frequent.includes(item)).slice(0, 5);
      const out = [];
      if (jumpBack.length) out.push({ key: "jump", title: t("common.commandPalette.jumpBack"), items: jumpBack });
      if (frequent.length) out.push({ key: "likely", title: t("common.commandPalette.likelyNext"), items: frequent });
      if (rest.length) out.push({ key: "recent", title: t("common.commandPalette.recent"), items: rest });
      if (!out.length) out.push({ key: "all", title: t("common.commandPalette.allPages"), items: items.slice(0, 8) });
      return out;
    }
    const byName = [];
    const bySection = [];
    for (const item of items) {
      if (foldSearchText(item.label).includes(q)) byName.push(item);
      else if (foldSearchText(item.section).includes(q) || foldSearchText(item.to).includes(q)) bySection.push(item);
    }
    const out = [];
    if (byName.length) out.push({ key: "pages", title: t("common.commandPalette.pages"), items: byName.slice(0, 30) });
    if (bySection.length) out.push({ key: "menus", title: t("common.commandPalette.menus"), items: bySection.slice(0, 30) });
    return out;
  }, [currentPath, items, open, query, t, userId]);

  const flat = useMemo(() => groups.flatMap((group) => group.items), [groups]);
  useEffect(() => { setActive(0); }, [query]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-palette-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const go = useCallback((item, newTab = false) => {
    if (!item) return;
    setOpen(false);
    if (newTab) window.open(item.to, "_blank", "noopener");
    else navigate(item.to);
  }, [navigate]);

  if (!open) return null;

  let index = -1;
  return createPortal(
    <div
      className="fixed inset-0 z-[2147482000] flex items-start justify-center bg-black/30 px-4 pt-[10vh] backdrop-blur-[2px]"
      onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}
      data-command-palette="true"
    >
      <div role="dialog" aria-label={t("common.commandPalette.open")} className="flex max-h-[70vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-surface text-text shadow-2xl">
        <div className="flex items-center gap-3 border-b border-border px-4 py-3.5">
          <span className="text-lg font-black text-primary">/</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") { event.preventDefault(); setActive((value) => Math.min(flat.length - 1, value + 1)); }
              else if (event.key === "ArrowUp") { event.preventDefault(); setActive((value) => Math.max(0, value - 1)); }
              else if (event.key === "Enter") { event.preventDefault(); go(flat[active], event.ctrlKey || event.metaKey); }
              else if (event.key === "Escape") { event.preventDefault(); setOpen(false); }
            }}
            placeholder={t("common.commandPalette.placeholder")}
            className="min-w-0 flex-1 bg-transparent text-lg outline-none placeholder:text-text-muted"
          />
          <Search className="h-5 w-5 text-text-muted" />
        </div>
        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {groups.length ? groups.map((group) => (
            <div key={group.key} className="mb-1">
              <div className="px-3 pb-1 pt-2 font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-text-muted">{group.title}</div>
              {group.items.map((item) => {
                index += 1;
                const current = index;
                const selected = current === active;
                return (
                  <button
                    key={`${group.key}:${item.to}`}
                    type="button"
                    data-palette-index={current}
                    onMouseEnter={() => setActive(current)}
                    onClick={(event) => go(item, event.ctrlKey || event.metaKey)}
                    className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-start transition ${selected ? "bg-primary-subtle ring-1 ring-primary/30" : "hover:bg-surface-hover"}`}
                  >
                    <PageIcon icon={item.icon} />
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {item.section ? <span className="text-text-muted"><Highlight text={item.section} query={query} />{"  /  "}</span> : null}
                      <span className="font-semibold"><Highlight text={item.label} query={query} /></span>
                    </span>
                    {selected ? <span className="hidden shrink-0 items-center gap-1 text-[11px] text-text-muted sm:flex"><Kbd>Ctrl</Kbd><Kbd>↵</Kbd>{t("common.commandPalette.newTab")}</span> : null}
                  </button>
                );
              })}
            </div>
          )) : (
            <p className="px-4 py-10 text-center text-sm text-text-muted">{t("common.commandPalette.nothing")}</p>
          )}
        </div>
        <div className="flex items-center gap-4 border-t border-border px-4 py-2.5 text-[11px] text-text-muted">
          <span className="flex items-center gap-1.5"><Kbd>↑↓</Kbd>{t("common.commandPalette.navigate")}</span>
          <span className="flex items-center gap-1.5"><Kbd>↵</Kbd>{t("common.commandPalette.goTo")}</span>
          <span className="flex items-center gap-1.5"><Kbd>Ctrl ↵</Kbd>{t("common.commandPalette.newTab")}</span>
          <span className="flex items-center gap-1.5"><Kbd>Esc</Kbd>{t("common.commandPalette.close")}</span>
          <span className="ms-auto font-mono">Ctrl K</span>
        </div>
      </div>
    </div>,
    document.body
  );
}
