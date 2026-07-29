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
    <div className={`${compact ? "xl:mt-0" : "mt-1.5"} rounded-[14px] border border-white/8 bg-zinc-950 p-2`}>
      {codes.length ? (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {codes.map((code) => (
            <span key={code} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-amber-400/30 bg-amber-400/10 px-3 text-xs font-bold text-amber-200">
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
      <div className="flex gap-2">
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
          className="h-9 min-w-0 flex-1 bg-transparent px-2 text-sm text-white outline-none placeholder:text-zinc-500"
        />
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => addDraft()}
          className="inline-flex h-9 items-center gap-1 rounded-[10px] border border-white/10 px-3 text-xs font-bold text-zinc-200 hover:bg-white/5"
        >
          <Plus size={14} />
          {compact ? null : "إضافة"}
        </button>
      </div>
    </div>
  );
}
