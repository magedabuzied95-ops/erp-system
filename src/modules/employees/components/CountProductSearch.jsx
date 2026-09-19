import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Camera, Check, Filter, Loader2, Package2, Plus, Search, X } from "lucide-react";

import i18n from "../../../i18n/i18n";
import { resolveProductImageUrl } from "../../../shared/lib/imageUrls";
import { lookupEmployeePortalInventoryVariants } from "../services/employeePortalInventoryApi";
import { getCountSearchIndex, highlightParts, searchCountIndex } from "../services/employeeDrafts/countSearchIndex.js";

const tt = (key, options) => i18n.t(key, options);

const RESULT_LIMIT = 30;
const SERVER_FALLBACK_DELAY_MS = 450;
const SERVER_FALLBACK_TIMEOUT_MS = 8000;

function ResultThumb({ src }) {
  const [failed, setFailed] = useState(false);
  const resolved = resolveProductImageUrl(src);
  useEffect(() => setFailed(false), [resolved]);
  if (!resolved || failed) {
    return (
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-control)] border border-slate-200 bg-slate-100 text-slate-400">
        <Package2 className="h-4 w-4" />
      </span>
    );
  }
  return (
    <img
      src={resolved}
      alt=""
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className="h-11 w-11 shrink-0 rounded-[var(--radius-control)] border border-slate-200 bg-slate-100 object-cover"
    />
  );
}

// One result row. Memoised on the group object (stable per snapshot) and its
// sheet state, so typing another letter only re-renders rows whose match changed.
const ResultRow = memo(function ResultRow({ group, query, state, busy, onPick }) {
  const [before, hit, after] = highlightParts(group.product_name, query);
  return (
    <li>
      <button
        type="button"
        onClick={() => onPick(group, state)}
        disabled={busy}
        className="flex w-full min-w-0 items-center gap-2.5 px-2.5 py-2 text-start transition-colors active:bg-slate-100 disabled:opacity-60"
      >
        <ResultThumb src={group.image_url} />
        <span className="min-w-0 flex-1">
          {/* dir=auto: an English name inside the RTL sheet would otherwise lose
              its BEGINNING to the ellipsis — the part that identifies it. */}
          <span dir="auto" className="block truncate text-start text-sm font-black text-slate-950">
            {before}
            {hit ? <mark className="rounded-sm bg-amber-200/70 px-0.5 text-inherit">{hit}</mark> : null}
            {after}
          </span>
          <span className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] font-bold text-slate-500">
            <span className="max-w-[8rem] truncate rounded-full border border-slate-200 bg-slate-50 px-1.5 py-px text-slate-700">
              {group.color || tt("employeePortal.stockCount.unknownColor")}
            </span>
            {group.article_code ? <bdi dir="ltr">{group.article_code}</bdi> : null}
            <span>{tt("employeePortal.stockCount.sizeCount", { count: group.sizes.length })}</span>
            <span>{tt("employeePortal.stockCount.stockShort", { count: group.stock })}</span>
          </span>
        </span>
        {state === "added" ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-black text-emerald-700">
            <Check className="h-3.5 w-3.5" />
            {tt("employeePortal.stockCount.onSheet")}
          </span>
        ) : (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary px-2.5 py-1.5 text-[11px] font-black text-[var(--primary-contrast)]">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            {state === "partial" ? tt("employeePortal.stockCount.addRest") : tt("employeePortal.stockCount.add")}
          </span>
        )}
      </button>
    </li>
  );
});

/**
 * The stock count's product search.
 *
 * It owns its own text: the count screen is a long list of steppers, and lifting
 * every key press into it re-rendered all of them per letter — that was the
 * stutter. Results come from the phone's catalogue index synchronously, so they
 * track the thumb with no spinner and never get swapped out from under it by a
 * late server answer. The server is asked only when the phone finds NOTHING
 * (a product added since the last catalogue refresh).
 */
function CountProductSearch({
  snapshot,
  filters,
  selectedSize,
  activeFilterCount = 0,
  filtersOpen = false,
  onOpenFilters,
  onResetFilters,
  onOpenScanner,
  disabled = false,
  online = true,
  token,
  sessionId,
  sheetVariantIds,
  onAdd,
  onJump,
  onActiveChange,
}) {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [busyKey, setBusyKey] = useState("");
  const [remote, setRemote] = useState({ query: "", groups: [], loading: false });
  const inputRef = useRef(null);
  const cardRef = useRef(null);
  const [focused, setFocused] = useState(false);

  // Searching is a mode: the box rises to the top of the screen so the results
  // sit ABOVE the phone's keyboard instead of behind it, and the screen is told
  // so it can get its sticky header out of the way.
  const active = focused || Boolean(query);
  useEffect(() => { onActiveChange?.(active); }, [active, onActiveChange]);
  const riseToTop = useCallback(() => {
    if (typeof window === "undefined") return;
    // After the keyboard has started to open, or the scroll is undone by it.
    window.setTimeout(() => cardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 120);
  }, []);

  const index = useMemo(() => getCountSearchIndex(snapshot), [snapshot]);
  const local = useMemo(
    () => searchCountIndex(index, deferredQuery, { filters, size: selectedSize, limit: RESULT_LIMIT }),
    [deferredQuery, filters, index, selectedSize]
  );

  const trimmed = deferredQuery.trim();
  const needsServer = Boolean(trimmed.length >= 2 && !local.groups.length && online && sessionId && !disabled);

  // Server fallback: only for a query the phone cannot answer at all.
  useEffect(() => {
    if (!needsServer) {
      setRemote((current) => (current.query || current.loading ? { query: "", groups: [], loading: false } : current));
      return undefined;
    }
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    setRemote({ query: trimmed, groups: [], loading: true });
    const timer = window.setTimeout(async () => {
      try {
        const response = await lookupEmployeePortalInventoryVariants(token, sessionId, { query: trimmed, limit: 40 }, {
          signal: controller?.signal,
          timeoutMs: SERVER_FALLBACK_TIMEOUT_MS,
        });
        const rows = (Array.isArray(response?.items) ? response.items : []).map((row) => ({
          ...row,
          product_variant_id: row.product_variant_id ?? row.variant_id ?? row.id,
          grade: row.grade ?? row.category ?? "",
        }));
        // The server page is capped, so a colour may arrive without all its
        // sizes: flag it and the screen re-resolves the full run before adding.
        const groups = getCountSearchIndex({ variants: rows }).map((group) => ({ ...group, complete: false }));
        setRemote({ query: trimmed, groups, loading: false });
      } catch (error) {
        if (error?.name === "AbortError") return;
        setRemote({ query: trimmed, groups: [], loading: false });
      }
    }, SERVER_FALLBACK_DELAY_MS);
    return () => {
      window.clearTimeout(timer);
      controller?.abort();
    };
  }, [needsServer, sessionId, token, trimmed]);

  const groups = local.groups.length ? local.groups : remote.query === trimmed ? remote.groups : [];
  const total = local.groups.length ? local.total : groups.length;
  const searching = needsServer && (remote.loading || remote.query !== trimmed);

  const stateOf = useCallback((group) => {
    if (!sheetVariantIds || !sheetVariantIds.size) return "new";
    let present = 0;
    for (const id of group.variantIds) if (sheetVariantIds.has(id)) present += 1;
    if (!present) return "new";
    return present >= group.variantIds.length ? "added" : "partial";
  }, [sheetVariantIds]);

  const pick = useCallback(async (group, state) => {
    if (state === "added") {
      onJump?.(group);
      setQuery("");
      return;
    }
    setBusyKey(group.key);
    try {
      await onAdd?.({ ...group, complete: group.complete !== false });
      // Ready for the next product: the box empties and keeps the keyboard.
      setQuery("");
      inputRef.current?.focus();
    } finally {
      setBusyKey("");
    }
  }, [onAdd, onJump]);

  const onKeyDown = (event) => {
    if (event.key === "Escape") {
      setQuery("");
      return;
    }
    if (event.key !== "Enter") return;
    event.preventDefault();
    // Enter commits only an unambiguous answer: a scanned/typed exact code, or
    // the single product left on the list.
    if (groups.length === 1 || (local.exact && groups.length)) void pick(groups[0], stateOf(groups[0]));
  };

  const showPanel = Boolean(trimmed);

  return (
    <section ref={cardRef} className="inventory-search-card rounded-[1.25rem] border border-slate-200 bg-white p-2.5 shadow-sm">
      <div className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          onClick={onOpenFilters}
          aria-expanded={filtersOpen}
          className={`relative inline-flex h-[var(--control-height-lg)] w-11 shrink-0 items-center justify-center rounded-[var(--radius-control)] border transition ${filtersOpen || activeFilterCount > 0 ? "border-violet-400/40 bg-violet-500/10 text-violet-700" : "border-slate-200 bg-white text-slate-600"}`}
          aria-label={tt("employeePortal.common.filters")}
          title={tt("employeePortal.common.filters")}
        >
          <Filter className="h-4 w-4" />
          {activeFilterCount > 0 ? (
            <span className="absolute -end-1 -top-1 inline-flex min-h-4 min-w-4 items-center justify-center rounded-full bg-violet-600 px-1 text-[10px] font-black text-white">
              {activeFilterCount}
            </span>
          ) : null}
        </button>
        <label className="flex h-[var(--control-height-lg)] min-w-0 flex-1 items-center gap-2 rounded-[var(--radius-control)] border border-slate-200 bg-slate-50 px-3 focus-within:border-emerald-400 focus-within:bg-white">
          <Search className="h-4 w-4 shrink-0 text-slate-400" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            onFocus={() => { setFocused(true); riseToTop(); }}
            onBlur={() => setFocused(false)}
            disabled={disabled}
            type="search"
            enterKeyHint="search"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder={tt("employeePortal.stockCount.searchItems")}
            className="w-full min-w-0 appearance-none bg-transparent text-base font-semibold text-slate-950 outline-none placeholder:text-slate-400 disabled:opacity-70 [&::-webkit-search-cancel-button]:hidden"
          />
          {query ? (
            <button
              type="button"
              onClick={() => { setQuery(""); inputRef.current?.focus(); }}
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-200 text-slate-600"
              aria-label={tt("employeePortal.stockCount.clearSearch")}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </label>
        <button
          type="button"
          onClick={onOpenScanner}
          disabled={disabled}
          className="inline-flex h-[var(--control-height-lg)] w-11 shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-primary text-[var(--primary-contrast)] disabled:opacity-60"
          aria-label={tt("employeePortal.scanner.scan")}
          title={tt("employeePortal.scanner.scan")}
        >
          <Camera className="h-4 w-4" />
        </button>
      </div>

      {showPanel ? (
        <div className="mt-2 overflow-hidden rounded-[var(--radius-card)] border border-slate-200 bg-white" role="region" aria-live="polite">
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 px-3 py-1.5 text-[11px] font-black text-slate-500">
            <span>
              {searching
                ? tt("employeePortal.stockCount.searchingServer")
                : total > groups.length
                  ? tt("employeePortal.stockCount.resultsCapped", { shown: groups.length, total })
                  : tt("employeePortal.stockCount.resultsCount", { count: total })}
            </span>
            {searching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          </div>
          {groups.length ? (
            // Its own scroller with a height cap: results never push the count
            // sheet around while the employee types.
            <ul className="max-h-[min(46vh,22rem)] divide-y divide-slate-100 overflow-y-auto overscroll-contain" style={{ WebkitOverflowScrolling: "touch" }}>
              {groups.map((group) => (
                <ResultRow
                  key={group.key}
                  group={group}
                  query={deferredQuery}
                  state={stateOf(group)}
                  busy={busyKey === group.key}
                  onPick={pick}
                />
              ))}
            </ul>
          ) : !searching ? (
            <div className="px-3 py-4 text-center">
              <p className="text-sm font-black text-slate-700">{tt("employeePortal.stockCount.noResults")}</p>
              <p className="mt-1 text-xs font-semibold text-slate-500">
                {activeFilterCount > 0 ? tt("employeePortal.stockCount.noResultsFiltered") : tt("employeePortal.stockCount.noResultsHint")}
              </p>
              {activeFilterCount > 0 ? (
                <button
                  type="button"
                  onClick={onResetFilters}
                  className="mt-2 inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-black text-slate-700"
                >
                  <X className="h-3.5 w-3.5" />
                  {tt("employeePortal.stockCount.clearFilters")}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

export default memo(CountProductSearch);
