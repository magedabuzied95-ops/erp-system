import { createPortal } from "react-dom";
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, X } from "lucide-react";

const normalizeText = (value = "") => String(value || "").trim().toLowerCase();

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
    const width = Math.max(256, Math.min(320, window.innerWidth - 16));
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
      className="rounded-2xl border border-white/10 bg-zinc-950 p-2 shadow-2xl shadow-black/50 ring-1 ring-emerald-300/10"
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
          placeholder="بحث..."
          className="h-9 min-w-0 flex-1 rounded-xl border border-white/10 bg-black/60 px-3 text-xs font-bold text-white outline-none placeholder:text-zinc-500 focus:border-emerald-400/40"
        />
        {selectedSet.size ? (
          <button
            type="button"
            onClick={onClear}
            className="inline-flex h-9 shrink-0 items-center gap-1 rounded-xl border border-amber-200/20 bg-amber-400/10 px-2 text-[11px] font-black text-amber-100 transition hover:bg-amber-400/15"
          >
            <X className="h-3 w-3" />
            مسح الكل
          </button>
        ) : null}
      </div>
      <div className="mt-2 max-h-64 overflow-y-auto">
        {filteredOptions.length ? filteredOptions.map((option) => {
          const active = selectedSet.has(String(option.id));
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => onToggle(option.id)}
              className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-start text-xs font-bold transition ${
                active ? "bg-emerald-400/15 text-emerald-100" : "text-zinc-200 hover:bg-white/[0.06]"
              }`}
            >
              <span className="truncate">{option.name}</span>
              <span className={`inline-flex h-4 w-4 items-center justify-center rounded border ${active ? "border-emerald-300 bg-emerald-300 text-black" : "border-white/20"}`}>
                {active ? <Check className="h-3 w-3" /> : null}
              </span>
            </button>
          );
        }) : (
          <div className="px-3 py-5 text-center text-xs font-bold text-zinc-500">لا توجد نتائج</div>
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
        className={`inline-flex h-9 items-center gap-2 rounded-xl border px-3 text-xs font-black transition ${
          open || selectedSet.size
            ? "border-emerald-300/40 bg-emerald-400/12 text-emerald-100"
            : "border-white/10 bg-black/35 text-zinc-100 hover:border-emerald-300/30 hover:bg-emerald-400/10"
        }`}
      >
        <span>{label}{selectedSet.size ? ` (${selectedSet.size})` : ""}</span>
        <ChevronDown className={`h-3.5 w-3.5 transition ${open ? "rotate-180" : ""}`} />
      </button>
      {popover}
    </div>
  );
}

function QuickPosFilters({
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
  const [openMenu, setOpenMenu] = useState("");
  const genderCounts = useMemo(() => {
    const map = new Map((Array.isArray(genderOptions) ? genderOptions : []).map((option) => [String(option.id), option.count]));
    return map;
  }, [genderOptions]);
  const selectedGenderSet = useMemo(() => new Set(Array.isArray(selectedGenders) ? selectedGenders.map(String) : []), [selectedGenders]);
  const genders = [
    { id: "men", label: "رجالي" },
    { id: "women", label: "حريمي" },
    { id: "kids", label: "أطفال" },
  ];

  return (
    <div className="mt-2 mb-1 rounded-2xl border border-white/10 bg-white/[0.025] px-2 py-2">
      <div className="overflow-x-auto">
      <div className="flex min-w-max items-center gap-2">
        {genders.map((gender) => {
          const active = selectedGenderSet.has(gender.id);
          const count = genderCounts.get(gender.id);
          return (
            <button
              key={gender.id}
              type="button"
              onClick={() => onToggleGender(gender.id)}
              className={`inline-flex h-9 items-center gap-2 rounded-xl border px-3 text-xs font-black transition ${
                active
                  ? "border-emerald-300/50 bg-emerald-400 text-emerald-950 shadow-[0_0_14px_rgba(16,185,129,0.12)]"
                  : "border-white/10 bg-black/35 text-zinc-100 hover:border-emerald-300/30 hover:bg-emerald-400/10"
              }`}
            >
              {gender.label}
              {Number.isFinite(Number(count)) ? <span className="rounded-full bg-black/15 px-1.5 py-0.5 text-[10px]">{count}</span> : null}
            </button>
          );
        })}
        <QuickMultiSelect
          id="manufacturer"
          label="المصنع"
          options={manufacturerOptions}
          selectedValues={selectedManufacturers}
          open={openMenu === "manufacturer"}
          onOpenChange={setOpenMenu}
          onToggle={onToggleManufacturer}
          onClear={onClearManufacturers}
        />
        <QuickMultiSelect
          id="brand"
          label="الماركة"
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
