import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import toast from "react-hot-toast";
import { ChevronDown, ChevronLeft, ChevronRight, Filter, MousePointer2, Pencil, Plus, Search, Settings, Trash2, X } from "lucide-react";

import { hasPermission } from "../../../shared/auth/authStorage";
import { EmptyState } from "../../../shared/ui";
import { isForbiddenError, isNotReadyError } from "../shared/metaAdsApi";
import { localeFor } from "../shared/metaAdsFormat";
import { RESOURCE_PAGE_KEY, recordPath } from "../shared/metaAdsNav";
import RecordGrid from "./components/RecordGrid";
import { getRecordResource } from "./recordRegistry";
import { recordsApi } from "./recordsApi";
import { describeError } from "./recordsErrors";
import { readHiddenColumns, writeHiddenColumns } from "./recordsFormat";
import "./records.css";

const PAGE_SIZE = 50;

// /meta-ads/r/:resource — the list grid of one Meta Ads table.
export default function RecordListPage() {
  const { resource } = useParams();
  const def = getRecordResource(resource);
  if (!def) return <Navigate to="/meta-ads" replace />;
  return <RecordList key={resource} resource={resource} def={def} />;
}

function ColumnSettings({ columns, hidden, onChange, onClose }) {
  const { t } = useTranslation();
  const ref = useRef(null);
  useEffect(() => {
    const onDown = (event) => {
      if (ref.current && !ref.current.contains(event.target)) onClose();
    };
    const onKey = (event) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);
  return (
    <div className="mar-popover" ref={ref} role="dialog" aria-label={t("metaAdsRecords.list.columns")}>
      <div className="mar-popover__title">{t("metaAdsRecords.list.columns")}</div>
      {columns.map((column) => {
        const visible = !hidden.includes(column.key);
        return (
          <label key={column.key} className="mar-popover__item">
            <input
              type="checkbox"
              checked={visible}
              onChange={() => onChange(visible ? [...hidden, column.key] : hidden.filter((key) => key !== column.key))}
            />
            <span>{t(`metaAdsRecords.${column.label}`)}</span>
          </label>
        );
      })}
      {hidden.length ? (
        <button type="button" className="mar-link-button" onClick={() => onChange([])}>
          {t("metaAdsRecords.list.showAllColumns")}
        </button>
      ) : null}
    </div>
  );
}

function RecordList({ resource, def }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const canManage = hasPermission("meta_ads.manage");
  const locale = localeFor(i18n.language);

  const [q, setQ] = useState("");
  const [filters, setFilters] = useState({});
  const [applied, setApplied] = useState({ q: "", filters: {} });
  const [sort, setSort] = useState({ key: "", dir: "desc" });
  const [page, setPage] = useState(1);
  const [mode, setMode] = useState("navigate");
  const [showFilters, setShowFilters] = useState(true);
  const [hidden, setHidden] = useState(() => readHiddenColumns(resource));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [data, setData] = useState({ rows: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [blocked, setBlocked] = useState(null);
  const [deleting, setDeleting] = useState(false);

  // Relation filters arrive in the URL from smart buttons (?campaign_id=12).
  const relations = useMemo(() => Object.fromEntries(searchParams.entries()), [searchParams]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setApplied({ q, filters });
      setPage(1);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [q, filters]);

  const listQuery = useMemo(() => {
    const params = { ...relations };
    if (applied.q) params.q = applied.q;
    for (const [key, value] of Object.entries(applied.filters)) {
      if (value === "" || value === undefined || value === null) continue;
      params[`f_${key}`] = value;
    }
    if (sort.key) {
      params.sort = sort.key;
      params.dir = sort.dir;
    }
    return params;
  }, [relations, applied, sort]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await recordsApi.list(resource, { ...listQuery, page, page_size: PAGE_SIZE });
      setData({ rows: response.rows || [], total: Number(response.total || 0) });
      setSelected(new Set());
      setBlocked(null);
    } catch (error) {
      if (isNotReadyError(error)) setBlocked("notReady");
      else if (isForbiddenError(error)) setBlocked("denied");
      else toast.error(describeError(t, error));
      setData({ rows: [], total: 0 });
    } finally {
      setLoading(false);
    }
  }, [resource, listQuery, page, t]);

  useEffect(() => {
    load();
  }, [load]);

  const columns = def.columns.filter((column) => !hidden.includes(column.key));
  const pages = Math.max(1, Math.ceil(data.total / PAGE_SIZE));
  const from = data.total ? (page - 1) * PAGE_SIZE + 1 : 0;
  const to = Math.min(data.total, page * PAGE_SIZE);
  const title = t(`metaAds.nav.pages.${RESOURCE_PAGE_KEY[resource]}`);
  const relationKeys = Object.keys(relations);

  const onFilterChange = (key, value) => setFilters((current) => ({ ...current, [key]: value }));
  const onSort = (key) => setSort((current) => (current.key === key ? { key, dir: current.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
  const toggleRow = (id) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  const toggleAll = (on) => setSelected(on ? new Set(data.rows.map((row) => row.id)) : new Set());
  const updateHidden = (keys) => {
    setHidden(keys);
    writeHiddenColumns(resource, keys);
  };
  const clearFilters = () => {
    setFilters({});
    setQ("");
  };
  const hasFilters = Boolean(q) || Object.entries(filters).some(([key, value]) => !key.endsWith("_op") && value !== "" && value !== undefined && value !== null);

  const openRecord = (row) => navigate(recordPath(resource, row.id), { state: { listQuery } });
  const createNew = () => {
    const search = new URLSearchParams(relations).toString();
    navigate(`${recordPath(resource, "new")}${search ? `?${search}` : ""}`);
  };

  const inlineSave = async (row, key, value) => {
    try {
      const response = await recordsApi.update(resource, row.id, { [key]: value });
      const saved = response.record || {};
      setData((current) => ({
        ...current,
        rows: current.rows.map((item) => (item.id === row.id ? { ...item, [key]: Object.prototype.hasOwnProperty.call(saved, key) ? saved[key] : value } : item)),
      }));
      toast.success(t("metaAds.common.saved"));
    } catch (error) {
      toast.error(describeError(t, error));
    }
  };

  const deleteSelected = async () => {
    if (!selected.size) return;
    if (!window.confirm(t("metaAdsRecords.list.confirmDeleteSelected", { count: selected.size }))) return;
    setDeleting(true);
    let failed = 0;
    let lastError = null;
    for (const id of selected) {
      try {
        await recordsApi.remove(resource, id);
      } catch (error) {
        failed += 1;
        lastError = error;
      }
    }
    setDeleting(false);
    if (failed) toast.error(`${t("metaAdsRecords.list.deleteFailed", { count: failed })} ${lastError ? describeError(t, lastError) : ""}`.trim());
    else toast.success(t("metaAds.common.deleted"));
    load();
  };

  if (blocked) {
    return (
      <div className="mar-page">
        <EmptyState
          title={blocked === "denied" ? t("metaAds.common.deniedTitle") : t("metaAds.common.notReadyTitle")}
          description={blocked === "denied" ? t("metaAds.common.deniedBody") : t("metaAds.common.notReadyBody")}
        />
      </div>
    );
  }

  return (
    <div className="mar-page">
      <header className="mar-bar">
        <div className="mar-bar__start">
          {def.create && canManage ? (
            <button type="button" className="mar-btn-primary" onClick={createNew} aria-label={t("metaAdsRecords.list.create")} title={t("metaAdsRecords.list.create")}>
              <Plus size={18} aria-hidden="true" />
            </button>
          ) : null}
          <h1 className="mar-chip-title">{title}</h1>
        </div>
        <div className="mar-bar__search">
          <span className="mar-search">
            <Search size={16} aria-hidden="true" />
            <input type="search" value={q} onChange={(event) => setQ(event.target.value)} placeholder={t("metaAdsRecords.list.searchPlaceholder")} aria-label={t("metaAds.common.search")} />
            {hasFilters ? (
              <button type="button" className="mar-search__clear" onClick={clearFilters} aria-label={t("metaAdsRecords.list.clearFilters")} title={t("metaAdsRecords.list.clearFilters")}>
                <X size={14} aria-hidden="true" />
              </button>
            ) : null}
          </span>
          <button
            type="button"
            className={`mar-icon-btn${showFilters ? " is-active" : ""}`}
            onClick={() => setShowFilters((value) => !value)}
            aria-pressed={showFilters}
            aria-label={t("metaAdsRecords.list.toggleFilters")}
            title={t("metaAdsRecords.list.toggleFilters")}
          >
            <ChevronDown size={16} aria-hidden="true" />
          </button>
        </div>
        <div className="mar-bar__end">
          <div className="mar-pager">
            <span className="mar-pager__text" dir="ltr">{t("metaAdsRecords.list.range", { from: from.toLocaleString(locale), to: to.toLocaleString(locale), total: data.total.toLocaleString(locale) })}</span>
            <button type="button" className="mar-icon-btn" disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)} aria-label={t("metaAdsRecords.list.previous")}>
              <ChevronRight size={16} className="mar-flip" aria-hidden="true" />
            </button>
            <button type="button" className="mar-icon-btn" disabled={page >= pages || loading} onClick={() => setPage((value) => value + 1)} aria-label={t("metaAdsRecords.list.next")}>
              <ChevronLeft size={16} className="mar-flip" aria-hidden="true" />
            </button>
          </div>
          <div className="mar-popover-anchor">
            <button
              type="button"
              className="mar-icon-btn"
              onClick={() => setSettingsOpen((value) => !value)}
              aria-expanded={settingsOpen}
              aria-label={t("metaAdsRecords.list.columns")}
              title={t("metaAdsRecords.list.columns")}
            >
              <Settings size={16} aria-hidden="true" />
            </button>
            {settingsOpen ? <ColumnSettings columns={def.columns} hidden={hidden} onChange={updateHidden} onClose={() => setSettingsOpen(false)} /> : null}
          </div>
        </div>
      </header>

      <div className="mar-toolbar">
        <div className="mar-segment" role="group" aria-label={t("metaAdsRecords.list.mode")}>
          <button type="button" className={mode === "navigate" ? "is-active" : ""} aria-pressed={mode === "navigate"} onClick={() => setMode("navigate")}>
            <MousePointer2 size={14} aria-hidden="true" />
            {t("metaAdsRecords.list.navigate")}
          </button>
          <button type="button" className={mode === "edit" ? "is-active" : ""} aria-pressed={mode === "edit"} onClick={() => setMode("edit")} disabled={!canManage}>
            <Pencil size={14} aria-hidden="true" />
            {t("metaAdsRecords.list.edit")}
          </button>
        </div>
        {relationKeys.length ? (
          <span className="mar-relation-chip">
            <Filter size={13} aria-hidden="true" />
            <span>{relationKeys.map((key) => t(`metaAdsRecords.relations.${key}`, { defaultValue: key, value: relations[key] })).join(" · ")}</span>
            <button type="button" onClick={() => setSearchParams({})} aria-label={t("metaAdsRecords.list.removeRelation")} title={t("metaAdsRecords.list.removeRelation")}>
              <X size={13} aria-hidden="true" />
            </button>
          </span>
        ) : null}
        {selected.size ? (
          <span className="mar-selection">
            {t("metaAdsRecords.list.selected", { count: selected.size })}
            {def.remove && canManage ? (
              <button type="button" className="mar-btn-ghost mar-btn-ghost--danger" onClick={deleteSelected} disabled={deleting}>
                <Trash2 size={14} aria-hidden="true" />
                {t("metaAds.common.delete")}
              </button>
            ) : null}
          </span>
        ) : null}
        {mode === "edit" ? <span className="mar-hint">{t("metaAdsRecords.list.editHint")}</span> : null}
      </div>

      <RecordGrid
        columns={columns}
        rows={data.rows}
        loading={loading}
        filters={filters}
        onFilterChange={onFilterChange}
        showFilters={showFilters}
        sort={sort}
        onSort={onSort}
        selected={selected}
        onToggleRow={toggleRow}
        onToggleAll={toggleAll}
        mode={mode}
        canEdit={canManage}
        onOpen={openRecord}
        onInlineSave={inlineSave}
      />
    </div>
  );
}
