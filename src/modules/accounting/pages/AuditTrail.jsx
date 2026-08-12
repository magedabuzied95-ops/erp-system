import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { AlertTriangle, Eye, Loader2, RefreshCcw, Search, ShieldCheck, X } from "lucide-react";
import toast from "react-hot-toast";

import { getCurrentUser, hasPermission, isAdminUser } from "../../../shared/auth/authStorage";
import AccountingShell from "../components/AccountingShell";
import { accountingApi } from "../services/accountingApi";

const initialFilters = {
  from_date: "",
  to_date: "",
  action: "",
  user_id: "",
  entity_type: "",
  search: "",
};
const inputClass = "w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none transition placeholder:text-zinc-600 focus:border-primary/70";

const formatDate = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString();
};

const compactJson = (value) => {
  if (value === null || value === undefined) return "-";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > 90 ? `${text.slice(0, 90)}...` : text;
};

function AuditTrail() {
  const { t } = useTranslation();
  const currentUser = getCurrentUser();
  const canViewAudit = isAdminUser(currentUser) || hasPermission("accounting.edit", currentUser);
  const [rows, setRows] = useState([]);
  const [filters, setFilters] = useState(initialFilters);
  const [appliedFilters, setAppliedFilters] = useState(initialFilters);
  const [loading, setLoading] = useState(true);
  const [selectedJson, setSelectedJson] = useState(null);

  const actions = useMemo(
    () => Array.from(new Set(rows.map((row) => row.action).filter(Boolean))).sort(),
    [rows]
  );
  const entityTypes = useMemo(
    () => Array.from(new Set(rows.map((row) => row.entity_type).filter(Boolean))).sort(),
    [rows]
  );

  const loadRows = async (params = appliedFilters) => {
    if (!canViewAudit) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const result = await accountingApi.getAuditLogs(params);
      setRows(Array.isArray(result?.rows) ? result.rows : []);
      setAppliedFilters(params);
    } catch (error) {
      toast.error(error?.message || t("accounting.auditTrail.errors.loadFailed"));
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRows(initialFilters);
  }, [canViewAudit]);

  const updateFilter = (key, value) => {
    setFilters((current) => ({ ...current, [key]: value }));
  };

  const applyFilters = (event) => {
    event.preventDefault();
    loadRows(filters);
  };

  if (!canViewAudit) {
    return (
      <AccountingShell title={t("accounting.auditTrail.title")} subtitle={t("accounting.auditTrail.permissionSubtitle")} tabs={auditTabs(t)}>
        <div className="rounded-3xl border border-amber-300/20 bg-amber-300/10 p-6 text-sm text-amber-100">
          {t("accounting.auditTrail.noAccess")}
        </div>
      </AccountingShell>
    );
  }

  return (
    <AccountingShell
      title={t("accounting.auditTrail.title")}
      subtitle={t("accounting.auditTrail.subtitle")}
      actions={
        <button type="button" onClick={() => loadRows(appliedFilters)} disabled={loading} className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-black text-white transition hover:bg-white/10 disabled:opacity-60">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
          {t("accounting.common.actions.refresh")}
        </button>
      }
      tabs={auditTabs(t)}
    >
      <form onSubmit={applyFilters} className="grid gap-3 rounded-3xl border border-white/10 bg-zinc-950/90 p-4 shadow-2xl shadow-black/10 md:grid-cols-3 xl:grid-cols-6">
        <FilterField label={t("accounting.common.labels.from")}>
          <input type="date" value={filters.from_date} onChange={(event) => updateFilter("from_date", event.target.value)} className={inputClass} />
        </FilterField>
        <FilterField label={t("accounting.common.labels.to")}>
          <input type="date" value={filters.to_date} onChange={(event) => updateFilter("to_date", event.target.value)} className={inputClass} />
        </FilterField>
        <FilterField label={t("accounting.auditTrail.labels.action")}>
          <input list="audit-actions" value={filters.action} onChange={(event) => updateFilter("action", event.target.value)} placeholder={t("accounting.auditTrail.placeholders.anyAction")} className={inputClass} />
          <datalist id="audit-actions">
            {actions.map((action) => <option key={action} value={action} />)}
          </datalist>
        </FilterField>
        <FilterField label={t("accounting.auditTrail.labels.entity")}>
          <input list="audit-entities" value={filters.entity_type} onChange={(event) => updateFilter("entity_type", event.target.value)} placeholder={t("accounting.auditTrail.placeholders.anyEntity")} className={inputClass} />
          <datalist id="audit-entities">
            {entityTypes.map((entityType) => <option key={entityType} value={entityType} />)}
          </datalist>
        </FilterField>
        <FilterField label={t("accounting.auditTrail.labels.userId")}>
          <input type="number" min="1" value={filters.user_id} onChange={(event) => updateFilter("user_id", event.target.value)} placeholder={t("accounting.auditTrail.placeholders.anyUser")} className={inputClass} />
        </FilterField>
        <div className="flex items-end">
          <button type="submit" className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-2 text-sm font-black text-zinc-950 transition hover:bg-primary">
            <Search className="h-4 w-4" />
            {t("accounting.common.actions.search")}
          </button>
        </div>
        <div className="md:col-span-3 xl:col-span-6">
          <input value={filters.search} onChange={(event) => updateFilter("search", event.target.value)} placeholder={t("accounting.auditTrail.placeholders.search")} className={inputClass} />
        </div>
      </form>

      <div className="rounded-3xl border border-white/10 bg-zinc-950 shadow-2xl shadow-black/20">
        <div className="flex items-center justify-between border-b border-white/10 p-4">
          <div>
            <h2 className="m1-section-title text-white">{t("accounting.auditTrail.eventsTitle")}</h2>
            <p className="mt-1 text-sm text-zinc-400">{t("accounting.auditTrail.recentEntries", { count: rows.length })}</p>
          </div>
          <ShieldCheck className="h-6 w-6 text-primary" />
        </div>

        {loading ? (
          <State icon={<Loader2 className="h-5 w-5 animate-spin" />} title={t("accounting.auditTrail.states.loadingTitle")} text={t("accounting.auditTrail.states.loadingText")} />
        ) : null}

        {!loading && !rows.length ? (
          <State icon={<AlertTriangle className="h-5 w-5" />} title={t("accounting.auditTrail.states.emptyTitle")} text={t("accounting.auditTrail.states.emptyText")} />
        ) : null}

        {!loading && rows.length ? (
          <div className="m1-table-container overflow-x-auto">
            <table className="m1-table m1-table--compact min-w-[1120px] w-full text-left">
              <thead className="bg-white/[0.03] text-[11px] font-black uppercase tracking-[0.16em] text-zinc-500">
                <tr>
                  <th className="px-4 py-3">{t("accounting.common.labels.date")}</th>
                  <th className="px-4 py-3">{t("accounting.auditTrail.labels.user")}</th>
                  <th className="px-4 py-3">{t("accounting.auditTrail.labels.action")}</th>
                  <th className="px-4 py-3">{t("accounting.auditTrail.labels.entity")}</th>
                  <th className="px-4 py-3">{t("accounting.auditTrail.labels.before")}</th>
                  <th className="px-4 py-3">{t("accounting.auditTrail.labels.after")}</th>
                  <th className="px-4 py-3">{t("accounting.auditTrail.labels.metadata")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="bg-zinc-950/80 text-sm text-zinc-200 transition hover:bg-white/[0.04]">
                    <td className="px-4 py-4 text-zinc-300">{formatDate(row.created_at)}</td>
                    <td className="px-4 py-4">
                      <div className="font-black text-white">{row.user_name || t("accounting.auditTrail.fallbacks.system")}</div>
                      <div className="mt-1 text-xs text-zinc-500">{row.user_email || (row.user_id ? t("accounting.auditTrail.fallbacks.userNumber", { id: row.user_id }) : t("accounting.auditTrail.fallbacks.noUser"))}</div>
                    </td>
                    <td className="px-4 py-4">
                      <span className="rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-black text-primary">{row.action}</span>
                    </td>
                    <td className="px-4 py-4">
                      <div className="font-semibold text-white">{row.entity_type}</div>
                      <div className="mt-1 text-xs text-zinc-500">{row.entity_id ? `#${row.entity_id}` : t("accounting.auditTrail.fallbacks.noEntityId")}</div>
                    </td>
                    <JsonCell title={t("accounting.auditTrail.labels.before")} value={row.before_data} onOpen={setSelectedJson} viewLabel={t("accounting.common.actions.view")} />
                    <JsonCell title={t("accounting.auditTrail.labels.after")} value={row.after_data} onOpen={setSelectedJson} viewLabel={t("accounting.common.actions.view")} />
                    <JsonCell title={t("accounting.auditTrail.labels.metadata")} value={row.metadata} onOpen={setSelectedJson} viewLabel={t("accounting.common.actions.view")} />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>

      {selectedJson ? <JsonModal payload={selectedJson} onClose={() => setSelectedJson(null)} /> : null}
    </AccountingShell>
  );
}

function FilterField({ label, children }) {
  return (
    <label className="space-y-2">
      <span className="text-[11px] font-black uppercase tracking-[0.18em] text-zinc-500">{label}</span>
      {children}
    </label>
  );
}

function auditTabs(t) {
  return [
    { to: "/accounting", label: t("accounting.tabs.dashboard") },
    { to: "/accounting/journal-entries", label: t("accounting.tabs.journal") },
    { to: "/accounting/accounts", label: t("accounting.tabs.accounts") },
    { to: "/accounting/reports", label: t("accounting.tabs.reports") },
    { to: "/accounting/profit-loss", label: t("accounting.tabs.profitLoss") },
    { to: "/accounting/cost-fix", label: t("accounting.tabs.costFix") },
    { to: "/accounting/audit-trail", label: t("accounting.tabs.auditTrail"), end: true },
  ];
}

function JsonCell({ title, value, onOpen, viewLabel }) {
  const empty = value === null || value === undefined;
  return (
    <td className="px-4 py-4 align-top">
      <div className="max-w-[220px] truncate font-mono text-xs text-zinc-400">{compactJson(value)}</div>
      {!empty ? (
        <button type="button" onClick={() => onOpen({ title, value })} className="mt-2 inline-flex items-center gap-1 rounded-xl border border-white/10 bg-white/5 px-2 py-1 text-xs font-black text-white transition hover:bg-white/10">
          <Eye className="h-3.5 w-3.5" />
          {viewLabel}
        </button>
      ) : null}
    </td>
  );
}

function JsonModal({ payload, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="max-h-[86vh] w-full max-w-3xl overflow-hidden rounded-3xl border border-white/10 bg-zinc-950 shadow-2xl shadow-black">
        <div className="flex items-center justify-between border-b border-white/10 p-4">
          <h3 className="m1-section-title text-white">{payload.title}</h3>
          <button type="button" onClick={onClose} className="rounded-2xl border border-white/10 bg-white/5 p-2 text-white transition hover:bg-white/10">
            <X className="h-5 w-5" />
          </button>
        </div>
        <pre className="max-h-[70vh] overflow-auto p-4 text-xs leading-6 text-zinc-200">{JSON.stringify(payload.value, null, 2)}</pre>
      </div>
    </div>
  );
}

function State({ icon, title, text }) {
  return (
    <div className="flex items-start gap-3 p-6 text-zinc-300">
      <div className="rounded-2xl border border-white/10 bg-white/5 p-3 text-amber-200">{icon}</div>
      <div>
        <div className="font-black text-white">{title}</div>
        <div className="mt-1 text-sm text-zinc-400">{text}</div>
      </div>
    </div>
  );
}

export default AuditTrail;
