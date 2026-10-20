import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowDown, ArrowUp, ExternalLink, Inbox, LoaderCircle, Search } from "lucide-react";

import { Select } from "../../../../shared/ui";
import { enumOptions, formatValue, renderCustom } from "../recordsFormat";
import BoolPill from "./BoolPill";

const NUMERIC = new Set(["number", "money"]);
const INLINE_TYPES = new Set(["text", "number", "money"]);

function FilterCell({ column, filters, onFilterChange }) {
  const { t } = useTranslation();
  const value = filters[column.key] ?? "";
  const label = t(`metaAdsRecords.${column.label}`);
  if (column.noFilter || column.type === "custom") return <th className="mar-grid__filter" aria-hidden="true" />;

  let control;
  if (column.type === "enum" || column.type === "status") {
    control = (
      <Select className="mar-grid__select" aria-label={label} value={value} onChange={(event) => onFilterChange(column.key, event.target.value)}>
        <option value="">{t("metaAds.common.choose")}</option>
        {enumOptions(t, column.enum).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </Select>
    );
  } else if (column.type === "bool") {
    control = (
      <Select className="mar-grid__select" aria-label={label} value={value} onChange={(event) => onFilterChange(column.key, event.target.value)}>
        <option value="">{t("metaAds.common.all")}</option>
        <option value="true">{t("metaAds.common.yes")}</option>
        <option value="false">{t("metaAds.common.no")}</option>
      </Select>
    );
  } else if (NUMERIC.has(column.type)) {
    const op = filters[`${column.key}_op`] || "eq";
    control = (
      <span className="mar-grid__number">
        <button
          type="button"
          className="mar-grid__op"
          title={t(`metaAdsRecords.list.op.${op}`)}
          aria-label={t(`metaAdsRecords.list.op.${op}`)}
          onClick={() => onFilterChange(`${column.key}_op`, op === "eq" ? "gt" : op === "gt" ? "lt" : "eq")}
        >
          {op === "eq" ? "=" : op === "gt" ? ">" : "<"}
        </button>
        <input type="number" inputMode="decimal" className="mar-grid__input" aria-label={label} placeholder="0" value={value} onChange={(event) => onFilterChange(column.key, event.target.value)} />
      </span>
    );
  } else if (column.type === "date" || column.type === "datetime") {
    control = <input type="date" className="mar-grid__input" aria-label={label} value={value} onChange={(event) => onFilterChange(column.key, event.target.value)} />;
  } else {
    control = (
      <span className="mar-grid__text">
        <Search size={13} aria-hidden="true" />
        <input type="search" className="mar-grid__input" aria-label={label} placeholder={t("metaAdsRecords.list.searchPlaceholder")} value={value} onChange={(event) => onFilterChange(column.key, event.target.value)} />
      </span>
    );
  }
  return <th className="mar-grid__filter">{control}</th>;
}

function Cell({ column, row, editing, setEditing, onInlineSave, canInline }) {
  const { t, i18n } = useTranslation();
  const value = row[column.key];

  if (column.type === "bool") {
    return <BoolPill value={value} onToggle={canInline && column.editable ? (next) => onInlineSave(row, column.key, next) : undefined} />;
  }
  if (editing) {
    const commit = () => {
      setEditing(null);
      if (String(editing.value ?? "") !== String(value ?? "")) onInlineSave(row, column.key, editing.value);
    };
    return (
      <input
        autoFocus
        className="mar-grid__edit"
        type={NUMERIC.has(column.type) ? "number" : "text"}
        value={editing.value ?? ""}
        onClick={(event) => event.stopPropagation()}
        onChange={(event) => setEditing({ ...editing, value: event.target.value })}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit();
          if (event.key === "Escape") setEditing(null);
        }}
      />
    );
  }
  if (column.type === "custom") return <span>{renderCustom(t, column.render, row)}</span>;
  if (column.type === "link") {
    return value ? (
      <a className="mar-link" href={value} target="_blank" rel="noreferrer noopener" onClick={(event) => event.stopPropagation()}>
        {t("metaAdsRecords.list.visitWebsite")}
        <ExternalLink size={12} aria-hidden="true" />
      </a>
    ) : <span className="mar-muted mar-italic">{t("metaAdsRecords.list.noUrl")}</span>;
  }
  const text = formatValue(t, i18n, column, row);
  if (column.type === "status" || column.type === "enum") return <span className="mar-grid__strong">{text || "—"}</span>;
  return <span className="mar-grid__clip" title={text}>{text}</span>;
}

// The list grid: sortable headers, a filter row, row checkboxes, navigation or
// inline-edit mode. Scrolls horizontally inside its own container.
export default function RecordGrid({
  columns,
  rows,
  loading,
  filters,
  onFilterChange,
  showFilters,
  sort,
  onSort,
  selected,
  onToggleRow,
  onToggleAll,
  mode,
  canEdit,
  onOpen,
  onInlineSave,
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(null);
  const canInline = mode === "edit" && canEdit;
  const allSelected = rows.length > 0 && rows.every((row) => selected.has(row.id));

  const cellClick = (row, column) => (event) => {
    if (canInline && column.editable && INLINE_TYPES.has(column.type)) {
      event.stopPropagation();
      setEditing({ rowId: row.id, key: column.key, value: row[column.key] ?? "" });
    }
  };

  return (
    <div className="mar-grid">
      <table className="mar-grid__table">
        <thead>
          <tr>
            <th className="mar-grid__check">
              <input type="checkbox" checked={allSelected} onChange={() => onToggleAll(!allSelected)} aria-label={t("metaAdsRecords.list.selectAll")} />
            </th>
            {columns.map((column) => {
              const active = sort.key === column.key;
              const sortable = column.type !== "custom";
              return (
                <th key={column.key} className={NUMERIC.has(column.type) ? "is-numeric" : ""} aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}>
                  {sortable ? (
                    <button type="button" className="mar-grid__sort" onClick={() => onSort(column.key)}>
                      <span>{t(`metaAdsRecords.${column.label}`)}</span>
                      {active ? (sort.dir === "asc" ? <ArrowUp size={12} aria-hidden="true" /> : <ArrowDown size={12} aria-hidden="true" />) : null}
                    </button>
                  ) : (
                    <span className="mar-grid__sort">{t(`metaAdsRecords.${column.label}`)}</span>
                  )}
                </th>
              );
            })}
          </tr>
          {showFilters ? (
            <tr className="mar-grid__filters">
              <th className="mar-grid__check" />
              {columns.map((column) => <FilterCell key={column.key} column={column} filters={filters} onFilterChange={onFilterChange} />)}
            </tr>
          ) : null}
        </thead>
        <tbody>
          {loading && !rows.length ? (
            <tr>
              <td colSpan={columns.length + 1} className="mar-grid__state">
                <LoaderCircle size={18} className="m1-spin" aria-hidden="true" />
                {t("metaAds.common.loading")}
              </td>
            </tr>
          ) : rows.length ? (
            rows.map((row) => (
              <tr
                key={row.id}
                className={`${selected.has(row.id) ? "is-selected" : ""}${mode === "navigate" ? " is-clickable" : ""}`}
                onClick={mode === "navigate" ? () => onOpen(row) : undefined}
                tabIndex={mode === "navigate" ? 0 : undefined}
                onKeyDown={mode === "navigate" ? (event) => { if (event.key === "Enter") onOpen(row); } : undefined}
              >
                <td className="mar-grid__check" onClick={(event) => event.stopPropagation()}>
                  <input type="checkbox" checked={selected.has(row.id)} onChange={() => onToggleRow(row.id)} aria-label={t("metaAdsRecords.list.selectRow")} />
                </td>
                {columns.map((column) => {
                  const isEditing = editing && editing.rowId === row.id && editing.key === column.key;
                  const inlineable = canInline && column.editable && INLINE_TYPES.has(column.type);
                  return (
                    <td
                      key={column.key}
                      className={`${NUMERIC.has(column.type) ? "is-numeric" : ""}${inlineable ? " is-editable" : ""}`}
                      onClick={cellClick(row, column)}
                    >
                      <Cell column={column} row={row} editing={isEditing ? editing : null} setEditing={setEditing} onInlineSave={onInlineSave} canInline={canInline} />
                    </td>
                  );
                })}
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={columns.length + 1} className="mar-grid__state mar-grid__state--empty">
                <span className="mar-grid__empty-icon"><Inbox size={20} aria-hidden="true" /></span>
                {t("metaAds.common.noData")}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
