import { createPortal } from "react-dom";
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, X } from "lucide-react";

import { useTranslation } from "react-i18next";

import i18n from "../../../i18n/i18n";

import "./QuickPosFilters.m1.css";

/** Module-scope translator for helpers defined outside a component. */
const tt = (key, options) => i18n.t(key, options);

const normalizeText = (value = "") => String(value || "").trim().toLowerCase();

/*
 * Product classifications carry no colour of their own, so each type gets one
 * from a fixed palette keyed by a hash of its id. Deterministic on purpose: a
 * cashier learns "Sneakers is the blue one" only if it is blue on every till,
 * every session, and stays blue when a new type is added beside it — which
 * rules out colouring by array index.
 *
 * Values are literal rather than derived from a hue, so contrast against the
 * dark POS surface is predictable: near-black text on the solid fill when
 * active, the hue itself on a dark tint when not.
 */
const TYPE_PALETTE = [
  "#38bdf8", // sky
  "#a78bfa", // violet
  "#fbbf24", // amber
  "#fb7185", // rose
  "#2dd4bf", // teal
  "#a3e635", // lime
  "#fb923c", // orange
  "#e879f9", // fuchsia
];

const typeColor = (id = "") => {
  const key = String(id || "");
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) >>> 0;
  }
  return TYPE_PALETTE[hash % TYPE_PALETTE.length];
};

function QuickMultiSelect({ id, label, options, selectedValues, open, onOpenChange, onToggle, onClear }) {
  const buttonRef = useRef(null);
  const popoverRef = useRef(null);
  const [position, setPosition] = useState({ top: 0, left: 0, width: 256 });
  const [query, setQuery] = useState("");
  const selectedSet = useMemo(() => new Set(Array.isArray(selectedValues) ? selectedValues.map(String) : []), [selectedValues]);
  const filteredOptions = useMemo(() => {
    const seen = new Set();
    return (Array.isArray(options) ? options : [])
      .filter((option) => option?.id && option?.name)
      .filter((option) => {
        const key = String(option.id);
        if (seen.has(key)) return false;
        seen.add(key);
        return !query || normalizeText(option.name).includes(normalizeText(query));
      });
  }, [options, query]);
  const updatePosition = () => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    // Wider than the old list needed: the options wrap as chips now, and a
    // narrow column would put most of them on a line of their own again.
    const width = Math.max(320, Math.min(460, window.innerWidth - 16));
    const left = Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - width - 8));
    setPosition({
      top: Math.min(rect.bottom + 8, window.innerHeight - 16),
      left,
      width,
    });
  };

  useLayoutEffect(() => {
    if (!open) return undefined;
    updatePosition();
    return undefined;
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;

    const handlePointerDown = (event) => {
      const target = event.target;
      if (buttonRef.current?.contains(target) || popoverRef.current?.contains(target)) return;
      onOpenChange("");
    };
    const handleViewportChange = () => updatePosition();

    document.addEventListener("mousedown", handlePointerDown, true);
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown, true);
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [open, onOpenChange]);

  const popover = open && typeof document !== "undefined" ? createPortal(
    <div
      ref={popoverRef}
      className="m1-quick-select-popover rounded-2xl border p-2"
      style={{
        position: "fixed",
        top: `${position.top}px`,
        left: `${position.left}px`,
        width: `${position.width}px`,
        zIndex: 9999,
      }}
    >
      <div className="flex items-center gap-2">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={tt("pos.filters.search")}
          className="m1-quick-select-search h-[var(--control-height-md)] min-w-0 flex-1 rounded-xl border px-3 text-xs font-bold outline-none"
        />
        {selectedSet.size ? (
          <button
            type="button"
            onClick={onClear}
            className="inline-flex h-[var(--control-height-md)] shrink-0 items-center gap-1 rounded-xl border border-amber-200/20 bg-amber-400/10 px-2 text-[11px] font-black text-amber-100 transition hover:bg-amber-400/15"
          >
            <X className="h-3 w-3" />
            {tt("pos.filters.clearAll")}
          </button>
        ) : null}
      </div>
      {/*
       * Options wrap as chips rather than stacking one per row: a factory or
       * brand name is a couple of words, so a full-width row per option pushed
       * a 30-item list into a long scroll for no reason. Same shape as the
       * chips in the filters panel, so both surfaces read alike.
       */}
      <div className="m1-quick-select-options mt-2 flex max-h-64 flex-wrap content-start gap-1.5 overflow-y-auto p-0.5">
        {filteredOptions.length ? filteredOptions.map((option) => {
          const active = selectedSet.has(String(option.id));
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => onToggle(option.id)}
              className={`m1-quick-select-chip inline-flex max-w-full items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition ${active ? "is-active" : ""}`}
            >
              <span className="truncate">{option.name}</span>
              {active ? <Check className="h-3 w-3 shrink-0" /> : null}
            </button>
          );
        }) : (
          <div className="m1-quick-select-empty w-full px-3 py-5 text-center text-xs font-bold">{tt("common.noResults")}</div>
        )}
      </div>
    </div>,
    document.body
  ) : null;

  return (
    <div className="shrink-0">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => onOpenChange(open ? "" : id)}
        className={`inline-flex h-[var(--control-height-lg)] items-center gap-2 rounded-xl border px-4 text-sm font-black transition ${ open || selectedSet.size ? "border-emerald-300/40 bg-emerald-400/12 text-emerald-100" : "border-white/10 bg-black/35 text-zinc-100 hover:border-emerald-300/30 hover:bg-emerald-400/10" }`}
      >
        <span>{label}{selectedSet.size ? ` (${selectedSet.size})` : ""}</span>
        <ChevronDown className={`h-4 w-4 transition ${open ? "rotate-180" : ""}`} />
      </button>
      {popover}
    </div>
  );
}

function QuickPosFilters({
  productTypeOptions,
  selectedProductType,
  onSelectProductType,
  genderOptions,
  selectedGenders,
  onToggleGender,
  brandOptions,
  selectedBrands,
  onToggleBrand,
  onClearBrands,
  manufacturerOptions,
  selectedManufacturers,
  onToggleManufacturer,
  onClearManufacturers,
}) {
  // memo() component: subscribe so a language change re-renders it even when props are unchanged.
  useTranslation();
  const [openMenu, setOpenMenu] = useState("");
  const genderCounts = useMemo(() => {
    const map = new Map((Array.isArray(genderOptions) ? genderOptions : []).map((option) => [String(option.id), option.count]));
    return map;
  }, [genderOptions]);
  const selectedGenderSet = useMemo(() => new Set(Array.isArray(selectedGenders) ? selectedGenders.map(String) : []), [selectedGenders]);
  const genders = [
    { id: "men", label: tt("pos.audience.men") },
    { id: "women", label: tt("pos.audience.women") },
    { id: "kids", label: tt("pos.audience.kids") },
  ];
  // A type with nothing behind it is dead weight in a row that scrolls, so it
  // goes. The active one stays even at zero, otherwise selecting a type whose
  // count later drops to zero would remove the only chip that can clear it.
  // A missing count means "unknown", not "empty" — those are kept.
  const visibleProductTypes = useMemo(() => {
    const activeId = String(selectedProductType ?? "all");
    return (Array.isArray(productTypeOptions) ? productTypeOptions : []).filter((option) => {
      const id = String(option?.id ?? "");
      if (!id) return false;
      const count = Number(option.count);
      return !Number.isFinite(count) || count > 0 || id === activeId;
    });
  }, [productTypeOptions, selectedProductType]);

  return (
    <div className="mt-2 mb-1 rounded-2xl border border-white/10 bg-white/[0.025] px-2 py-2">
      <div className="overflow-x-auto">
      <div className="flex min-w-max items-center gap-2">
        {/*
         * Product type is a single-value filter, unlike the multi-select chips
         * beside it, so clicking the active chip returns to "all" rather than
         * leaving a selection with no way off it — the row has no "All" chip,
         * matching how the gender chips already clear themselves.
         */}
        {visibleProductTypes.map((option) => {
          const id = String(option.id);
          const active = String(selectedProductType ?? "all") === id;
          const color = option.color || typeColor(id);
          return (
            <button
              key={`type-${id}`}
              type="button"
              onClick={() => onSelectProductType(active ? "all" : id)}
              style={{ "--chip-color": color }}
              className={`m1-pos-type-chip inline-flex h-[var(--control-height-lg)] items-center gap-2 rounded-xl border px-4 text-sm font-black transition ${active ? "is-active" : ""}`}
            >
              {option.name}
              {Number.isFinite(Number(option.count)) ? (
                <span className="m1-pos-type-chip-count rounded-full px-2 py-0.5 text-[11px]">{option.count}</span>
              ) : null}
            </button>
          );
        })}
        {genders.map((gender) => {
          const active = selectedGenderSet.has(gender.id);
          const count = genderCounts.get(gender.id);
          return (
            <button
              key={gender.id}
              type="button"
              onClick={() => onToggleGender(gender.id)}
              className={`inline-flex h-[var(--control-height-lg)] items-center gap-2 rounded-xl border px-4 text-sm font-black transition ${ active ? "border-emerald-300/50 bg-emerald-400 text-emerald-950 shadow-[0_0_14px_rgba(16,185,129,0.12)]" : "border-white/10 bg-black/35 text-zinc-100 hover:border-emerald-300/30 hover:bg-emerald-400/10" }`}
            >
              {gender.label}
              {Number.isFinite(Number(count)) ? <span className="rounded-full bg-black/15 px-2 py-0.5 text-[11px]">{count}</span> : null}
            </button>
          );
        })}
        <QuickMultiSelect
          id="manufacturer"
          label={tt("inventory.purchaseAlerts.filters.manufacturer")}
          options={manufacturerOptions}
          selectedValues={selectedManufacturers}
          open={openMenu === "manufacturer"}
          onOpenChange={setOpenMenu}
          onToggle={onToggleManufacturer}
          onClear={onClearManufacturers}
        />
        <QuickMultiSelect
          id="brand"
          label={tt("pos.filters.brand")}
          options={brandOptions}
          selectedValues={selectedBrands}
          open={openMenu === "brand"}
          onOpenChange={setOpenMenu}
          onToggle={onToggleBrand}
          onClear={onClearBrands}
        />
      </div>
      </div>
    </div>
  );
}

export default memo(QuickPosFilters);
