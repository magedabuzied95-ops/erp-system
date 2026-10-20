import { useEffect, useRef, useState } from "react";
import { LoaderCircle, Search } from "lucide-react";
import { useTranslation } from "react-i18next";

import { metaErrorMessage } from "../../../shared/metaAdsApi";

// Search box with a suggestion list (locations / interests / languages). `search(q)`
// resolves to an array; picking a row calls onPick(row) and clears the box.
export default function TokenSearch({ placeholder, search, onPick, rowKey, renderRow, minChars = 2, ariaLabel }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [active, setActive] = useState(-1);
  const boxRef = useRef(null);
  const seq = useRef(0);

  useEffect(() => {
    const q = query.trim();
    if (q.length < minChars) {
      setRows([]);
      setLoading(false);
      setError("");
      return undefined;
    }
    const id = ++seq.current;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const result = await search(q);
        if (id !== seq.current) return;
        setRows(Array.isArray(result) ? result : []);
        setError("");
        setActive(-1);
      } catch (err) {
        if (id !== seq.current) return;
        setRows([]);
        setError(metaErrorMessage(err) || t("metaAdsWizard.common.searchFailed"));
      } finally {
        if (id === seq.current) setLoading(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [query, minChars, search, t]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event) => {
      if (!boxRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const pick = (row) => {
    onPick(row);
    setQuery("");
    setRows([]);
    setOpen(false);
  };

  const onKeyDown = (event) => {
    if (!rows.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((index) => Math.min(rows.length - 1, index + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => Math.max(0, index - 1));
    } else if (event.key === "Enter" && active >= 0) {
      event.preventDefault();
      pick(rows[active]);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  };

  const showList = open && query.trim().length >= minChars;

  return (
    <div className="wz-search" ref={boxRef}>
      <span className="wz-input">
        <span className="wz-input__slot" aria-hidden="true">
          {loading ? <LoaderCircle size={16} className="m1-spin" /> : <Search size={16} />}
        </span>
        <input
          className="wz-input__control"
          type="search"
          value={query}
          placeholder={placeholder}
          aria-label={ariaLabel || placeholder}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
      </span>
      {showList ? (
        <div className="wz-search__list" role="listbox">
          {error ? <div className="wz-search__empty wz-error">{error}</div> : null}
          {!error && !loading && !rows.length ? <div className="wz-search__empty">{t("metaAdsWizard.common.noResults")}</div> : null}
          {rows.map((row, index) => (
            <button
              key={rowKey(row)}
              type="button"
              role="option"
              aria-selected={index === active}
              className={`wz-search__row ${index === active ? "is-active" : ""}`.trim()}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => pick(row)}
            >
              {renderRow(row)}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
