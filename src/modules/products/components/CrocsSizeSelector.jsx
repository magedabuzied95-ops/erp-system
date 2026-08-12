import { useMemo, useState } from "react";
import { Check, Plus, X } from "lucide-react";

import {
  CROCS_SIZE_GROUPS,
  crocsSizeKey,
  isKnownCrocsSize,
  normalizeCrocsSizeValue,
  sortCrocsSizes,
} from "../../../shared/lib/crocsSizes";

export default function CrocsSizeSelector({ existingSizes = [], onApply, onClose }) {
  const [selectedSizes, setSelectedSizes] = useState([]);
  const [showCustom, setShowCustom] = useState(false);
  const [customSize, setCustomSize] = useState("");
  const [customError, setCustomError] = useState("");
  const existingKeys = useMemo(
    () => new Set(existingSizes.map((size) => crocsSizeKey(size)).filter(Boolean)),
    [existingSizes]
  );
  const selectedKeys = useMemo(
    () => new Set(selectedSizes.map((size) => crocsSizeKey(size)).filter(Boolean)),
    [selectedSizes]
  );
  const legacySizes = useMemo(
    () => existingSizes.filter((size) => normalizeCrocsSizeValue(size) && !isKnownCrocsSize(size)),
    [existingSizes]
  );

  const toggleSize = (size) => {
    const normalized = normalizeCrocsSizeValue(size);
    const key = crocsSizeKey(normalized);
    if (!key || existingKeys.has(key)) return;
    setSelectedSizes((current) => (
      current.some((item) => crocsSizeKey(item) === key)
        ? current.filter((item) => crocsSizeKey(item) !== key)
        : sortCrocsSizes([...current, normalized])
    ));
  };

  const addCustomSize = () => {
    const normalized = normalizeCrocsSizeValue(customSize);
    const key = crocsSizeKey(normalized);
    if (!key) {
      setCustomError("اكتب المقاس أولًا");
      return;
    }
    if (existingKeys.has(key) || selectedKeys.has(key)) {
      setCustomError("المقاس موجود بالفعل");
      return;
    }
    setSelectedSizes((current) => sortCrocsSizes([...current, normalized]));
    setCustomSize("");
    setCustomError("");
    setShowCustom(false);
  };

  return (
    <div className="absolute left-0 top-full z-40 mt-2 w-[min(92vw,520px)] rounded-[var(--radius-card)] border border-border bg-surface-raised p-4 shadow-[var(--shadow-overlay)]" dir="rtl">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-black text-text">مقاسات كروكس</p>
          <p className="mt-1 text-[11px] leading-5 text-text-muted">اختر المقاس المكتوب فعليًا على المنتج. لن يتم إجراء أي تحويل.</p>
        </div>
        <button type="button" onClick={onClose} aria-label="إغلاق" className="grid h-[var(--control-height-sm)] w-8 shrink-0 place-items-center rounded-full border border-border text-text-muted hover:bg-surface-hover">
          <X size={15} />
        </button>
      </div>

      <div className="mt-4 max-h-[52vh] space-y-4 overflow-y-auto pe-1">
        {CROCS_SIZE_GROUPS.map((group) => (
          <section key={group.id}>
            <div className="mb-2 text-xs font-black text-amber-200">{group.label}</div>
            <div className="flex flex-wrap gap-2">
              {group.sizes.map((size) => {
                const key = crocsSizeKey(size);
                const existing = existingKeys.has(key);
                const selected = selectedKeys.has(key);
                return (
                  <button
                    key={size}
                    type="button"
                    disabled={existing}
                    aria-pressed={existing || selected}
                    onClick={() => toggleSize(size)}
                    className={`inline-flex min-h-[var(--control-height-md)] items-center justify-center gap-1 rounded-[var(--radius-control)] border px-3 text-xs font-black transition ${ existing ? "cursor-not-allowed border-success/25 bg-success-subtle text-success opacity-70" : selected ? "border-primary bg-primary text-[var(--primary-contrast)]" : "border-border bg-surface-soft text-text hover:border-primary/40 hover:bg-primary/10" }`}
                  >
                    {(existing || selected) ? <Check size={13} /> : null}
                    {size}
                  </button>
                );
              })}
            </div>
          </section>
        ))}

        {legacySizes.length ? (
          <section>
            <div className="mb-2 text-xs font-black text-text-muted">مقاسات موجودة / قديمة</div>
            <div className="flex flex-wrap gap-2">
              {legacySizes.map((size, index) => (
                <span key={`${size}-${index}`} className="inline-flex min-h-9 items-center gap-1 rounded-[var(--radius-control)] border border-primary/20 bg-primary/10 px-3 text-xs font-black text-primary">
                  <Check size={13} /> {size}
                </span>
              ))}
            </div>
          </section>
        ) : null}

        <section className="rounded-[var(--radius-card)] border border-border bg-surface-soft p-3">
          {!showCustom ? (
            <button type="button" onClick={() => setShowCustom(true)} className="inline-flex h-[var(--control-height-md)] items-center gap-2 rounded-[var(--radius-control)] border border-border px-3 text-xs font-black text-text hover:bg-surface-hover">
              <Plus size={14} /> مقاس آخر
            </button>
          ) : (
            <div className="flex flex-wrap items-start gap-2">
              <div className="min-w-[150px] flex-1">
                <input
                  autoFocus
                  value={customSize}
                  onChange={(event) => { setCustomSize(event.target.value); setCustomError(""); }}
                  onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addCustomSize(); } }}
                  placeholder="مثال: C11"
                  className="h-[var(--control-height-md)] w-full rounded-[var(--radius-control)] border border-border bg-surface px-3 text-sm font-bold text-text outline-none focus:border-amber-300/50"
                />
                {customError ? <p className="mt-1 text-[11px] font-bold text-rose-300">{customError}</p> : null}
              </div>
              <button type="button" onClick={addCustomSize} className="h-[var(--control-height-md)] rounded-[var(--radius-control)] bg-primary px-4 text-xs font-black text-[var(--primary-contrast)]">إضافة</button>
            </div>
          )}
        </section>
      </div>

      <div className="mt-4 flex items-center justify-end gap-2 border-t border-border pt-3">
        <button type="button" onClick={onClose} className="h-[var(--control-height-md)] rounded-[var(--radius-control)] border border-border px-4 text-xs font-black text-text-muted hover:bg-surface-hover">إلغاء</button>
        <button
          type="button"
          disabled={!selectedSizes.length}
          onClick={() => onApply?.(selectedSizes)}
          className="h-[var(--control-height-md)] rounded-[var(--radius-control)] bg-primary px-4 text-xs font-black text-[var(--primary-contrast)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          إضافة المقاسات المحددة ({selectedSizes.length})
        </button>
      </div>
    </div>
  );
}
