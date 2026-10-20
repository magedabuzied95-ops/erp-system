import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Columns3 } from "lucide-react";

import { COLUMN_PRESETS, LEVEL_COLUMNS } from "./managerApi";

// "أعمدة": three presets, then the per-column checklist ("تخصيص الأعمدة").
export default function ColumnsMenu({ level, choice, onChange }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
    };
    const onKey = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const columnLabel = (key) => t(`metaAdsManager.columns.${key}`);
  const pickPreset = (preset) => onChange({ preset, visible: COLUMN_PRESETS[preset](level) });
  const toggle = (key) => {
    const set = new Set(choice.visible);
    if (set.has(key)) set.delete(key);
    else set.add(key);
    onChange({ preset: "custom", visible: LEVEL_COLUMNS[level].filter((item) => set.has(item)) });
  };

  return (
    <div className="ma-columns" ref={rootRef}>
      <button type="button" className="ma-outline-btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <Columns3 size={16} aria-hidden="true" />
        <span>{t("metaAdsManager.columnsButton")}</span>
      </button>
      {open ? (
        <div className="ma-columns__menu" role="menu">
          {Object.keys(COLUMN_PRESETS).map((preset) => (
            <button
              key={preset}
              type="button"
              role="menuitemradio"
              aria-checked={choice.preset === preset}
              className={`ma-columns__preset${choice.preset === preset ? " is-active" : ""}`}
              onClick={() => pickPreset(preset)}
            >
              {t(`metaAdsManager.columnPresets.${preset}`)}
            </button>
          ))}
          <div className="ma-columns__divider" />
          <div className="ma-columns__heading">{t("metaAdsManager.customizeColumns")}</div>
          {LEVEL_COLUMNS[level].map((key) => {
            const checked = choice.visible.includes(key);
            return (
              <button key={key} type="button" role="menuitemcheckbox" aria-checked={checked} className="ma-columns__check" onClick={() => toggle(key)}>
                <span className={`ma-columns__box${checked ? " is-checked" : ""}`} aria-hidden="true">{checked ? <Check size={12} /> : null}</span>
                <span>{columnLabel(key)}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
