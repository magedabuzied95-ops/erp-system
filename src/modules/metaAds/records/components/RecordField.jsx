import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { CircleHelp, ExternalLink } from "lucide-react";

import { recordPath } from "../../shared/metaAdsNav";
import { enumOptions, formatValue, fromCairoInput, isBlankValue, renderCustom, toCairoInput } from "../recordsFormat";
import { Select } from "../../../../shared/ui";
import BoolPill from "./BoolPill";

export function FieldLabel({ def, htmlFor }) {
  const { t } = useTranslation();
  return (
    <span className="mar-field__label">
      <label htmlFor={htmlFor}>{t(`metaAdsRecords.${def.label}`)}</label>
      {def.help ? (
        <span className="mar-help" tabIndex={0} title={t(`metaAdsRecords.${def.help}`)} aria-label={t(`metaAdsRecords.${def.help}`)}>
          <CircleHelp size={13} aria-hidden="true" />
        </span>
      ) : null}
    </span>
  );
}

const listItems = (value) => {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    if (item && typeof item === "object") return item.name || item.username || item.id || JSON.stringify(item);
    return String(item);
  });
};

function SecretControl({ def, record, value, onChange, editable, isNew, id }) {
  const { t } = useTranslation();
  const [changing, setChanging] = useState(false);
  const masked = record[`${def.key}_masked`];
  const isSet = Boolean(record[`has_${def.key}`]);
  if (editable && (isNew || changing)) {
    return (
      <span className="mar-secret">
        <input
          id={id}
          type="password"
          autoComplete="new-password"
          className="mar-input"
          dir="ltr"
          value={value || ""}
          onChange={(event) => onChange(def.key, event.target.value)}
          placeholder={t("metaAdsRecords.form.secretPlaceholder")}
        />
        {!isNew ? (
          <button
            type="button"
            className="mar-link-button"
            onClick={() => {
              setChanging(false);
              onChange(def.key, undefined);
            }}
          >
            {t("metaAds.common.cancel")}
          </button>
        ) : null}
      </span>
    );
  }
  return (
    <span className="mar-secret">
      <span className={isSet ? "mar-secret__mask" : "mar-muted"} dir="ltr">{isSet ? masked || "••••" : t("metaAdsRecords.form.secretNotSet")}</span>
      {editable ? (
        <button type="button" className="mar-link-button" onClick={() => setChanging(true)}>
          {t("metaAdsRecords.form.changeSecret")}
        </button>
      ) : null}
    </span>
  );
}

// One label + value row of the record sheet.
export default function RecordField({ def, record, draft, onChange, editable, isNew, lookupOptions = [] }) {
  const { t, i18n } = useTranslation();
  const id = `mar-field-${def.key}`;
  const value = Object.prototype.hasOwnProperty.call(draft, def.key) ? draft[def.key] : record[def.key];
  const merged = { ...record, [def.key]: value };

  if (def.hideEmpty && !editable && isBlankValue(value)) return null;

  let control;
  if (def.type === "secret") {
    control = <SecretControl def={def} record={record} value={draft[def.key]} onChange={onChange} editable={editable} isNew={isNew} id={id} />;
  } else if (def.type === "bool") {
    control = <BoolPill value={value} onToggle={editable ? (next) => onChange(def.key, next) : undefined} />;
  } else if (editable && (def.type === "enum" || def.type === "status")) {
    control = (
      <Select id={id} className="mar-select" value={value ?? ""} onChange={(event) => onChange(def.key, event.target.value || null)}>
        <option value="">{t("metaAds.common.choose")}</option>
        {enumOptions(t, def.enum).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </Select>
    );
  } else if (editable && def.type === "lookup") {
    const options = [...lookupOptions];
    if (value && !options.some((option) => String(option.id) === String(value))) {
      options.unshift({ id: value, name: record[def.display] || `#${value}` });
    }
    control = (
      <Select id={id} className="mar-select" value={value ?? ""} onChange={(event) => onChange(def.key, event.target.value ? Number(event.target.value) : null)}>
        <option value="">{t("metaAds.common.choose")}</option>
        {options.map((option) => <option key={option.id} value={option.id}>{option.name || `#${option.id}`}</option>)}
      </Select>
    );
  } else if (editable && def.type === "textarea") {
    control = <textarea id={id} className="mar-input mar-input--area" rows={def.rows || 4} value={value ?? ""} onChange={(event) => onChange(def.key, event.target.value)} />;
  } else if (editable && def.type === "datetime") {
    control = <input id={id} type="datetime-local" className="mar-input" value={toCairoInput(value)} onChange={(event) => onChange(def.key, fromCairoInput(event.target.value))} />;
  } else if (editable && (def.type === "number" || def.type === "money")) {
    control = <input id={id} type="number" inputMode="decimal" step="any" className="mar-input" dir="ltr" value={value ?? ""} onChange={(event) => onChange(def.key, event.target.value)} />;
  } else if (editable) {
    control = <input id={id} type="text" className="mar-input" value={value ?? ""} onChange={(event) => onChange(def.key, event.target.value)} />;
  } else if (def.type === "lookup") {
    const label = formatValue(t, i18n, def, merged);
    control = def.link && value ? <Link className="mar-link" to={recordPath(def.link, value)}>{label}</Link> : <span className="mar-value">{label || " "}</span>;
  } else if (def.type === "link") {
    control = value ? (
      <a className="mar-link" href={value} target="_blank" rel="noreferrer noopener" dir="ltr">
        {value}
        <ExternalLink size={12} aria-hidden="true" />
      </a>
    ) : <span className="mar-value">{" "}</span>;
  } else if (def.type === "list") {
    const items = listItems(value);
    control = items.length ? <span className="mar-chips">{items.map((item) => <span key={item} className="mar-chip">{item}</span>)}</span> : <span className="mar-value">{" "}</span>;
  } else if (def.type === "custom") {
    control = <span className="mar-value">{renderCustom(t, def.render, merged)}</span>;
  } else if (def.type === "textarea") {
    control = <span className="mar-value mar-value--box mar-pre">{value || " "}</span>;
  } else {
    const text = formatValue(t, i18n, def, merged);
    control = <span className={`mar-value${def.key.endsWith("meta_id") || def.key === "meta_id" ? " mar-value--box" : ""}`}>{text || " "}</span>;
  }

  return (
    <div className={`mar-field${def.type === "textarea" ? " mar-field--tall" : ""}`}>
      <FieldLabel def={def} htmlFor={editable ? id : undefined} />
      <div className="mar-field__control">{control}</div>
    </div>
  );
}
