import { useState } from "react";
import { Plus, X } from "lucide-react";

import { normalizeArticleCodes } from "../../../../shared/articleCode";

export default function ArticleCodeMultiInput({
  value = [],
  onChange,
  placeholder = "مثال: SM17",
  compact = false,
}) {
  const [draft, setDraft] = useState("");
  const codes = normalizeArticleCodes(value);

  const addDraft = (raw = draft) => {
    const additions = String(raw || "")
      .split(/[\n,،]+/)
      .map((item) => item.trim())
      .filter(Boolean);
    if (!additions.length) return;
    onChange?.(normalizeArticleCodes(codes, additions));
    setDraft("");
  };

  return (
    <div
      className={`rounded-[14px] border border-white/8 bg-zinc-950 ${
        compact ? "flex min-h-10 items-center gap-1.5 p-1 xl:mt-0" : "mt-1.5 p-1.5"
      }`}
    >
      {codes.length ? (
        <div className={compact ? "flex min-w-0 flex-1 flex-nowrap gap-1 overflow-x-auto" : "mb-1 flex flex-wrap gap-1"}>
          {codes.map((code) => (
            <span
              key={code}
              className={`inline-flex shrink-0 items-center rounded-full border border-amber-400/30 bg-amber-400/10 text-xs font-bold text-amber-200 ${
                compact ? "h-7 gap-1 px-2" : "h-7 gap-1 px-2.5"
              }`}
            >
              {code}
              <button
                type="button"
                onClick={() => onChange?.(codes.filter((item) => item !== code))}
                className="rounded-full p-0.5 text-amber-100/70 hover:bg-white/10 hover:text-white"
                aria-label={`حذف ${code}`}
              >
                <X size={13} />
              </button>
            </span>
          ))}
        </div>
      ) : null}
      <div className={compact ? "flex shrink-0 gap-1" : "flex gap-2"}>
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === ",") {
              event.preventDefault();
              addDraft();
            }
          }}
          onBlur={() => addDraft()}
          placeholder={placeholder}
          className={`min-w-0 bg-transparent text-sm text-white outline-none placeholder:text-zinc-500 ${
            compact ? "h-[var(--control-height-sm)] w-16 px-1" : "h-[var(--control-height-sm)] flex-1 px-2"
          }`}
        />
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => addDraft()}
          className={`inline-flex items-center justify-center rounded-[10px] border border-white/10 text-xs font-bold text-zinc-200 hover:bg-white/5 ${
            compact ? "h-[var(--control-height-sm)] w-8 p-0" : "h-[var(--control-height-sm)] gap-1 px-2.5"
          }`}
        >
          <Plus size={14} />
          {compact ? null : "إضافة"}
        </button>
      </div>
    </div>
  );
}
