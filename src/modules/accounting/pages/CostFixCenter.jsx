import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { AlertTriangle, CheckCircle2, Loader2, RefreshCcw, Save, Wand2 } from "lucide-react";
import toast from "react-hot-toast";

import { getCurrentUser, isAdminUser } from "../../../shared/auth/authStorage";
import AccountingShell from "../components/AccountingShell";
import { formatCurrency } from "../lib/financeStore";
import { accountingApi } from "../services/accountingApi";

const rowKey = (row) => `${row.product_id || "p"}:${row.variant_id || "base"}:${row.unresolved_order_item_id || "catalog"}`;
const moneyValue = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(parsed, 0) : 0;
};

function CostFixCenter() {
  const { t } = useTranslation();
  const canManageCosts = isAdminUser(getCurrentUser());
  const [rows, setRows] = useState([]);
  const [costDrafts, setCostDrafts] = useState({});
  const [reasonDrafts, setReasonDrafts] = useState({});
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);

  const loadRows = async () => {
    if (!canManageCosts) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const result = await accountingApi.getMissingCostItems();
      const nextRows = Array.isArray(result?.rows) ? result.rows : [];
      setRows(nextRows);
      setCostDrafts(
        Object.fromEntries(
          nextRows.map((row) => [
            rowKey(row),
            Number(row.current_override_cost || 0) > 0 ? String(row.current_override_cost) : row.suggested_cost > 0 ? String(row.suggested_cost) : "",
          ])
        )
      );
      setReasonDrafts(
        Object.fromEntries(
          nextRows
            .filter((row) => row.resolution_type === "order_line_override")
            .map((row) => [rowKey(row), t("accounting.costFix.placeholders.historicalReason")])
        )
      );
    } catch (error) {
      toast.error(error?.message || t("accounting.costFix.errors.loadFailed"));
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRows();
  }, [canManageCosts]);

  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, row) => ({
          soldQuantity: acc.soldQuantity + Number(row.sold_quantity || 0),
          affectedLines: acc.affectedLines + Number(row.affected_order_lines || 0),
          suggestedValue: acc.suggestedValue + Number(row.suggested_cost || 0) * Number(row.sold_quantity || 0),
        }),
        { soldQuantity: 0, affectedLines: 0, suggestedValue: 0 }
      ),
    [rows]
  );
  const catalogRows = useMemo(() => rows.filter((row) => row.resolution_type !== "order_line_override"), [rows]);
  const historicalRows = useMemo(() => rows.filter((row) => row.resolution_type === "order_line_override"), [rows]);

  const setDraft = (key, value) => {
    setCostDrafts((current) => ({ ...current, [key]: value }));
  };

  const setReasonDraft = (key, value) => {
    setReasonDrafts((current) => ({ ...current, [key]: value }));
  };

  const updatesFromRows = (targetRows) =>
    targetRows
      .map((row) => ({
        product_id: row.product_id,
        variant_id: row.variant_id,
        cost: moneyValue(costDrafts[rowKey(row)]),
      }))
      .filter((update) => update.cost > 0 && (update.product_id || update.variant_id));

  const saveUpdates = async (targetRows, key = "all") => {
    const updates = updatesFromRows(targetRows);
    if (!updates.length) {
      toast.error(t("accounting.costFix.errors.costPositive"));
      return false;
    }

    setSavingKey(key);
    try {
      const result = await accountingApi.updateCosts({ updates });
      toast.success(t("accounting.costFix.toasts.costSaved", { count: Number(result?.updated || updates.length) }));
      setSavedNotice(true);
      await loadRows();
      return true;
    } catch (error) {
      toast.error(error?.message || t("accounting.costFix.errors.saveFailed"));
      return false;
    } finally {
      setSavingKey("");
    }
  };

  const historicalUpdatesFromRows = (targetRows) =>
    targetRows
      .map((row) => ({
        order_item_id: row.order_item_id || row.unresolved_order_item_id,
        unit_cost: moneyValue(costDrafts[rowKey(row)]),
        reason: reasonDrafts[rowKey(row)] || t("accounting.costFix.placeholders.historicalReason"),
      }))
      .filter((update) => update.order_item_id && update.unit_cost > 0);

  const saveHistoricalUpdates = async (targetRows, key = "historical-all") => {
    const updates = historicalUpdatesFromRows(targetRows);
    if (!updates.length) {
      toast.error(t("accounting.costFix.errors.overrideCostPositive"));
      return false;
    }

    setSavingKey(key);
    try {
      const result = await accountingApi.updateOrderLineCosts({ updates });
      toast.success(t("accounting.costFix.toasts.overrideSaved", { count: Number(result?.updated || updates.length) }));
      setSavedNotice(true);
      await loadRows();
      return true;
    } catch (error) {
      toast.error(error?.message || t("accounting.costFix.errors.overrideSaveFailed"));
      return false;
    } finally {
      setSavingKey("");
    }
  };

  const applySuggestedCosts = () => {
    setCostDrafts(
      Object.fromEntries(
        rows.map((row) => [
          rowKey(row),
          row.suggested_cost > 0 ? String(row.suggested_cost) : costDrafts[rowKey(row)] || "",
        ])
      )
    );
    toast.success(t("accounting.costFix.toasts.suggestedApplied"));
  };

  const syncAccounting = async () => {
    setSyncing(true);
    try {
      const result = await accountingApi.rebuildLedgerEntries();
      toast.success(t("accounting.reports.toasts.syncSuccess", {
        created: Number(result?.created || 0),
        deleted: Number(result?.deleted_old_generated_entries || 0),
        skipped: Number(result?.skipped || 0),
      }));
      setSavedNotice(false);
      await loadRows();
    } catch (error) {
      toast.error(error?.message || t("accounting.reports.errors.syncFailed"));
    } finally {
      setSyncing(false);
    }
  };

  const saveAndSync = async () => {
    const savedCatalog = catalogRows.length ? await saveUpdates(catalogRows, "save-sync") : true;
    const savedHistorical = historicalRows.length ? await saveHistoricalUpdates(historicalRows, "save-sync") : true;
    if (savedCatalog && savedHistorical) await syncAccounting();
  };

  if (!canManageCosts) {
    return (
      <AccountingShell title={t("accounting.costFix.title")} subtitle={t("accounting.costFix.permissionSubtitle")} tabs={costFixTabs(t)}>
        <div className="rounded-3xl border border-amber-300/20 bg-amber-300/10 p-6 text-sm text-amber-100">
          {t("accounting.costFix.noAccess")}
        </div>
      </AccountingShell>
    );
  }

  return (
    <AccountingShell
      title={t("accounting.costFix.title")}
      subtitle={t("accounting.costFix.subtitle")}
      actions={
        <>
          <button type="button" onClick={loadRows} disabled={loading || syncing || Boolean(savingKey)} className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-black text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
            {t("accounting.common.actions.refresh")}
          </button>
          <button type="button" onClick={saveAndSync} disabled={!rows.length || syncing || Boolean(savingKey)} className="inline-flex items-center gap-2 rounded-2xl bg-amber-300 px-4 py-2 text-sm font-black text-black transition hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-60">
            {syncing || savingKey === "save-sync" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
            {t("accounting.costFix.actions.saveAndSync")}
          </button>
        </>
      }
      tabs={costFixTabs(t)}
    >
      {savedNotice ? (
        <div className="flex flex-col gap-3 rounded-3xl border border-emerald-300/20 bg-emerald-300/10 p-4 text-sm text-emerald-100 shadow-2xl shadow-black/10 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="h-5 w-5" />
            {t("accounting.costFix.savedNotice")}
          </div>
          <button type="button" onClick={syncAccounting} disabled={syncing} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-300 px-4 py-2 font-black text-emerald-950 transition hover:bg-emerald-200 disabled:opacity-60">
            {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
            {t("accounting.reports.actions.syncEntries")}
          </button>
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-3">
        <Metric label={t("accounting.costFix.metrics.missingCostRows")} value={rows.length} />
        <Metric label={t("accounting.costFix.metrics.affectedOrderLines")} value={totals.affectedLines} />
        <Metric label={t("accounting.costFix.metrics.suggestedCogsValue")} value={formatCurrency(totals.suggestedValue)} />
      </div>

      <div className="rounded-3xl border border-white/10 bg-zinc-950 shadow-2xl shadow-black/20">
        <div className="flex flex-col gap-3 border-b border-white/10 p-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="m1-section-title text-white">{t("accounting.costFix.catalogTitle")}</h2>
            <p className="mt-1 text-sm text-zinc-400">{t("accounting.costFix.catalogSubtitle")}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={applySuggestedCosts} disabled={!catalogRows.length || Boolean(savingKey)} className="inline-flex items-center gap-2 rounded-2xl border border-primary/30 bg-primary/10 px-4 py-2 text-sm font-black text-primary transition hover:bg-primary/20 disabled:opacity-60">
              <Wand2 className="h-4 w-4" />
              {t("accounting.costFix.actions.applySuggested")}
            </button>
            <button type="button" onClick={() => saveUpdates(catalogRows)} disabled={!catalogRows.length || Boolean(savingKey)} className="inline-flex items-center gap-2 rounded-2xl bg-primary px-4 py-2 text-sm font-black text-zinc-950 transition hover:bg-primary disabled:opacity-60">
              {savingKey === "all" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {t("accounting.costFix.actions.saveAll")}
            </button>
          </div>
        </div>

        {loading ? (
          <State icon={<Loader2 className="h-5 w-5 animate-spin" />} title={t("accounting.costFix.states.loadingMissingTitle")} text={t("accounting.costFix.states.loadingMissingText")} />
        ) : null}

        {!loading && !catalogRows.length ? (
          <State icon={<CheckCircle2 className="h-5 w-5" />} title={t("accounting.costFix.states.noCatalogTitle")} text={t("accounting.costFix.states.noCatalogText")} />
        ) : null}

        {!loading && catalogRows.length ? (
          <div className="m1-table-container overflow-x-auto">
            <table className="m1-table m1-table--compact min-w-full">
              <thead className="bg-white/[0.03]">
                <tr className="text-left text-[11px] font-black uppercase tracking-[0.16em] text-zinc-500">
                  <th className="px-4 py-3">{t("accounting.costFix.labels.product")}</th>
                  <th className="px-4 py-3">{t("accounting.costFix.labels.variantSku")}</th>
                  <th className="px-4 py-3 text-right">{t("accounting.costFix.labels.soldQty")}</th>
                  <th className="px-4 py-3 text-right">{t("accounting.costFix.labels.affectedLines")}</th>
                  <th className="px-4 py-3 text-right">{t("accounting.costFix.labels.currentCost")}</th>
                  <th className="px-4 py-3 text-right">{t("accounting.costFix.labels.suggestedCost")}</th>
                  <th className="px-4 py-3">{t("accounting.costFix.labels.newCost")}</th>
                  <th className="px-4 py-3 text-right">{t("accounting.common.actions.save")}</th>
                </tr>
              </thead>
              <tbody>
                {catalogRows.map((row) => {
                  const key = rowKey(row);
                  const canSaveRow = Boolean(row.product_id || row.variant_id);
                  return (
                    <tr key={key} className="bg-zinc-950/80 text-sm text-zinc-200 transition hover:bg-white/[0.04]">
                      <td className="px-4 py-4">
                        <div className="font-black text-white">{row.product_name}</div>
                        <div className="mt-1 text-xs text-zinc-500">{row.product_id ? t("accounting.costFix.labels.productNumber", { id: row.product_id }) : t("accounting.costFix.labels.unresolvedHistoricalLine")}</div>
                      </td>
                      <td className="px-4 py-4">
                        <div className="font-semibold text-zinc-100">{row.variant_label || t("accounting.costFix.labels.baseProduct")}</div>
                        <div className="mt-1 text-xs text-zinc-500">{row.sku || (row.variant_id ? t("accounting.costFix.labels.variantNumber", { id: row.variant_id }) : t("accounting.costFix.labels.noSku"))}</div>
                      </td>
                      <td className="px-4 py-4 text-right font-black text-white">{Number(row.sold_quantity || 0).toLocaleString()}</td>
                      <td className="px-4 py-4 text-right font-black text-amber-200">{Number(row.affected_order_lines || 0).toLocaleString()}</td>
                      <td className="px-4 py-4 text-right text-rose-200">{formatCurrency(row.current_cost || 0)}</td>
                      <td className="px-4 py-4 text-right">
                        <div className="font-black text-primary">{formatCurrency(row.suggested_cost || 0)}</div>
                        <div className="mt-1 text-xs text-zinc-500">{t("accounting.costFix.labels.lastAvg", { last: formatCurrency(row.last_purchase_cost || 0), avg: formatCurrency(row.average_purchase_cost || 0) })}</div>
                      </td>
                      <td className="px-4 py-4">
                        <input type="number" min="0" step="0.01" value={costDrafts[key] || ""} onChange={(event) => setDraft(key, event.target.value)} disabled={!canSaveRow} className="w-32 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-black text-white outline-none transition placeholder:text-zinc-600 focus:border-primary/70 disabled:cursor-not-allowed disabled:opacity-50" placeholder={canSaveRow ? "0.00" : t("accounting.costFix.labels.noTarget")} />
                      </td>
                      <td className="px-4 py-4 text-right">
                        <button type="button" onClick={() => saveUpdates([row], key)} disabled={!canSaveRow || savingKey === key || Boolean(savingKey && savingKey !== key)} className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-black text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60">
                          {savingKey === key ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                          {canSaveRow ? t("accounting.common.actions.save") : t("accounting.costFix.labels.noTarget")}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>

      <div className="rounded-3xl border border-white/10 bg-zinc-950 shadow-2xl shadow-black/20">
        <div className="flex flex-col gap-3 border-b border-white/10 p-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="m1-section-title text-white">{t("accounting.costFix.historicalTitle")}</h2>
            <p className="mt-1 text-sm text-zinc-400">{t("accounting.costFix.historicalSubtitle")}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => saveHistoricalUpdates(historicalRows)} disabled={!historicalRows.length || Boolean(savingKey)} className="inline-flex items-center gap-2 rounded-2xl bg-amber-300 px-4 py-2 text-sm font-black text-black transition hover:bg-amber-200 disabled:opacity-60">
              {savingKey === "historical-all" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {t("accounting.costFix.actions.saveAllOverrides")}
            </button>
          </div>
        </div>

        {loading ? (
          <State icon={<Loader2 className="h-5 w-5 animate-spin" />} title={t("accounting.costFix.states.loadingHistoricalTitle")} text={t("accounting.costFix.states.loadingHistoricalText")} />
        ) : null}

        {!loading && !historicalRows.length ? (
          <State icon={<CheckCircle2 className="h-5 w-5" />} title={t("accounting.costFix.states.noHistoricalTitle")} text={t("accounting.costFix.states.noHistoricalText")} />
        ) : null}

        {!loading && historicalRows.length ? (
          <div className="m1-table-container overflow-x-auto">
            <table className="m1-table m1-table--compact min-w-full">
              <thead className="bg-white/[0.03]">
                <tr className="text-left text-[11px] font-black uppercase tracking-[0.16em] text-zinc-500">
                  <th className="px-4 py-3">{t("accounting.costFix.labels.order")}</th>
                  <th className="px-4 py-3">{t("accounting.costFix.labels.itemSnapshot")}</th>
                  <th className="px-4 py-3 text-right">{t("accounting.costFix.labels.soldQty")}</th>
                  <th className="px-4 py-3 text-right">{t("accounting.costFix.labels.currentOverride")}</th>
                  <th className="px-4 py-3">{t("accounting.costFix.labels.unitCost")}</th>
                  <th className="px-4 py-3">{t("accounting.costFix.labels.reason")}</th>
                  <th className="px-4 py-3 text-right">{t("accounting.common.actions.save")}</th>
                </tr>
              </thead>
              <tbody>
                {historicalRows.map((row) => {
                  const key = rowKey(row);
                  return (
                    <tr key={key} className="bg-zinc-950/80 text-sm text-zinc-200 transition hover:bg-white/[0.04]">
                      <td className="px-4 py-4">
                        <div className="font-black text-white">{row.order_reference || `ORD-${row.order_id}`}</div>
                        <div className="mt-1 text-xs text-zinc-500">Line #{row.order_item_id || row.unresolved_order_item_id}</div>
                      </td>
                      <td className="px-4 py-4">
                        <div className="font-semibold text-zinc-100">{row.item_name || row.product_name_snapshot || row.product_name}</div>
                        <div className="mt-1 text-xs text-zinc-500">{row.sku_snapshot || "No SKU snapshot"}</div>
                      </td>
                      <td className="px-4 py-4 text-right font-black text-white">{Number(row.sold_quantity || 0).toLocaleString()}</td>
                      <td className="px-4 py-4 text-right text-amber-200">{formatCurrency(row.current_override_cost || 0)}</td>
                      <td className="px-4 py-4">
                        <input type="number" min="0" step="0.01" value={costDrafts[key] || ""} onChange={(event) => setDraft(key, event.target.value)} className="w-32 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-black text-white outline-none transition placeholder:text-zinc-600 focus:border-amber-300/70" placeholder="0.00" />
                      </td>
                      <td className="px-4 py-4">
                        <input type="text" value={reasonDrafts[key] || ""} onChange={(event) => setReasonDraft(key, event.target.value)} className="min-w-64 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none transition placeholder:text-zinc-600 focus:border-amber-300/70" placeholder={t("accounting.costFix.placeholders.historicalReason")} />
                      </td>
                      <td className="px-4 py-4 text-right">
                        <button type="button" onClick={() => saveHistoricalUpdates([row], key)} disabled={savingKey === key || Boolean(savingKey && savingKey !== key)} className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-black text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60">
                          {savingKey === key ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                          {t("accounting.costFix.actions.saveOverride")}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </AccountingShell>
  );
}

function Metric({ label, value }) {
  return (
    <div className="rounded-3xl border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10">
      <div className="text-[11px] font-black uppercase tracking-[0.18em] text-zinc-500">{label}</div>
      <div className="mt-3 text-2xl font-black text-white">{value}</div>
    </div>
  );
}

function costFixTabs(t) {
  return [
    { to: "/accounting", label: t("accounting.tabs.dashboard") },
    { to: "/accounting/reports", label: t("accounting.tabs.reports") },
    { to: "/accounting/profit-loss", label: t("accounting.tabs.profitLoss") },
    { to: "/accounting/ledgers", label: t("accounting.tabs.ledgers") },
    { to: "/accounting/cost-fix", label: t("accounting.tabs.costFix"), end: true },
    { to: "/accounting/audit-trail", label: t("accounting.tabs.auditTrail") },
  ];
}

function State({ icon, title, text }) {
  return (
    <div className="flex items-start gap-3 p-6 text-zinc-300">
      <div className="rounded-2xl border border-white/10 bg-white/5 p-3 text-amber-200">{icon || <AlertTriangle className="h-5 w-5" />}</div>
      <div>
        <div className="font-black text-white">{title}</div>
        <div className="mt-1 text-sm text-zinc-400">{text}</div>
      </div>
    </div>
  );
}

export default CostFixCenter;
