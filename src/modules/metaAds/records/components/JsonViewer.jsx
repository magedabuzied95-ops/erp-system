import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import { ChevronDown, Code2, Copy, ListTree } from "lucide-react";

// Read-only JSON viewer: collapsible tree, raw text, copy. Accepts an object, an
// array, or a JSON string.

const parse = (value) => {
  if (typeof value !== "string") return value ?? {};
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

const isBranch = (value) => value !== null && typeof value === "object";

function Leaf({ value }) {
  if (value === null) return <span className="mar-json__null">null</span>;
  if (typeof value === "string") return <span className="mar-json__string">"{value}"</span>;
  if (typeof value === "number") return <span className="mar-json__number">{String(value)}</span>;
  if (typeof value === "boolean") return <span className="mar-json__bool">{String(value)}</span>;
  return <span>{String(value)}</span>;
}

function Node({ name, value, depth }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(depth < 1);
  if (!isBranch(value)) {
    return (
      <div className="mar-json__row">
        {name !== undefined ? <span className="mar-json__key">{name}:</span> : null}
        <Leaf value={value} />
      </div>
    );
  }
  const entries = Array.isArray(value) ? value.map((item, index) => [index, item]) : Object.entries(value);
  const summary = Array.isArray(value) ? `[${entries.length}]` : `{${entries.length}}`;
  return (
    <div className="mar-json__branch">
      <button type="button" className="mar-json__toggle" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <ChevronDown size={13} className={open ? "" : "mar-json__chev--closed"} aria-hidden="true" />
        {name !== undefined ? <span className="mar-json__key">{name}:</span> : null}
        <span className="mar-json__summary">{summary}</span>
      </button>
      {open ? (
        <div className="mar-json__children">
          {entries.length ? (
            entries.map(([key, item]) => <Node key={key} name={key} value={item} depth={depth + 1} />)
          ) : (
            <div className="mar-json__empty">{Array.isArray(value) ? t("metaAdsRecords.json.emptyArray") : t("metaAdsRecords.json.emptyObject")}</div>
          )}
        </div>
      ) : null}
    </div>
  );
}

export default function JsonViewer({ value }) {
  const { t } = useTranslation();
  const [mode, setMode] = useState("tree");
  const data = useMemo(() => parse(value), [value]);
  const raw = useMemo(() => (typeof data === "string" ? data : JSON.stringify(data, null, 2)), [data]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(raw);
      toast.success(t("metaAds.common.copied"));
    } catch {
      toast.error(t("metaAdsRecords.json.copyFailed"));
    }
  };

  return (
    <div className="mar-json">
      <div className="mar-json__bar">
        <div className="mar-json__modes" role="tablist">
          <button type="button" role="tab" aria-selected={mode === "tree"} className={mode === "tree" ? "is-active" : ""} onClick={() => setMode("tree")}>
            <ListTree size={14} aria-hidden="true" />
            {t("metaAdsRecords.json.tree")}
          </button>
          <button type="button" role="tab" aria-selected={mode === "raw"} className={mode === "raw" ? "is-active" : ""} onClick={() => setMode("raw")}>
            <Code2 size={14} aria-hidden="true" />
            {t("metaAdsRecords.json.raw")}
          </button>
        </div>
        <button type="button" className="mar-json__copy" onClick={copy}>
          <Copy size={14} aria-hidden="true" />
          {t("metaAdsRecords.json.copy")}
        </button>
      </div>
      <div className="mar-json__body" dir="ltr">
        {mode === "raw" ? <pre className="mar-json__raw">{raw}</pre> : <Node value={data} depth={0} />}
      </div>
    </div>
  );
}
