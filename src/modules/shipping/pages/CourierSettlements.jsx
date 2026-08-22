import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { ArrowRight, Banknote, CheckCheck, Landmark, Loader2, RefreshCw, Search, Truck, X } from "lucide-react";
import toast from "react-hot-toast";
import { api } from "../../../shared/api/api";

// The courier's money has two moments. Step one (delivered ⇒ collected) happens on
// the webhook without anyone's hand; this page is step two: the bank transfer is
// here, which parcels does it cover, what did Bosta keep, what hit the account.

const PROVIDER = "bosta";
const fmtMoney = (value) => `${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ج.م`;
const fmtDate = (value) => (value ? new Date(value).toLocaleString() : "-");
const toDateInput = (date = new Date()) => {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};
const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;

const cardClass = "rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-4";
const inputClass = "h-[var(--control-height-md)] w-full rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--card)] px-3 text-sm font-bold text-[var(--text)] outline-none focus:border-emerald-300/50";
const ghostButton = "inline-flex items-center gap-2 rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--card)] px-4 py-2 text-sm font-black text-[var(--text)] hover:border-[var(--border-strong)] hover:bg-[var(--table-hover)] disabled:opacity-60";

function Kpi({ label, value, sub, tone = "" }) {
  return (
    <div className={cardClass}>
      <div className="text-xs font-black uppercase tracking-[0.16em] text-[var(--text-tertiary)]">{label}</div>
      <div className={`mt-2 text-2xl font-black ${tone}`}>{value}</div>
      {sub ? <div className="mt-1 text-xs font-bold text-[var(--muted)]">{sub}</div> : null}
    </div>
  );
}

function SettlementDetails({ id, onClose }) {
  const { t } = useTranslation();
  const [data, setData] = useState(null);
  useEffect(() => {
    let cancelled = false;
    setData(null);
    api.get(`/shipping/settlements/${id}`).then((response) => {
      if (!cancelled) setData(response?.settlement || null);
    }).catch((error) => toast.error(error.message));
    return () => { cancelled = true; };
  }, [id]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="max-h-[85vh] w-full max-w-3xl overflow-auto rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-5" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-black">{t("shipping.settlements.history.title")} #{id}</h2>
          <button type="button" onClick={onClose} className={ghostButton} aria-label={t("shipping.settlements.history.close")}><X className="h-4 w-4" /></button>
        </div>
        {!data ? <div className="grid h-40 place-items-center"><Loader2 className="h-6 w-6 animate-spin" /></div> : (
          <>
            <div className="mt-4 grid gap-3 sm:grid-cols-4">
              <Kpi label={t("shipping.settlements.history.gross")} value={fmtMoney(data.gross_amount)} />
              <Kpi label={t("shipping.settlements.history.fees")} value={fmtMoney(data.fees_amount)} tone="text-orange-200" />
              <Kpi label={t("shipping.settlements.history.net")} value={fmtMoney(data.net_amount)} tone="text-emerald-200" />
              <Kpi label={t("shipping.settlements.history.account")} value={data.money_account_name || "-"} sub={fmtDate(data.settled_at)} />
            </div>
            <div className="mt-4 overflow-auto rounded-2xl border border-[var(--border)]">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="bg-[var(--table-head)] text-xs uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
                  <tr>
                    <th className="px-3 py-2 text-start">{t("shipping.settlements.table.order")}</th>
                    <th className="px-3 py-2 text-start">{t("shipping.settlements.table.customer")}</th>
                    <th className="px-3 py-2 text-start">{t("shipping.settlements.table.tracking")}</th>
                    <th className="px-3 py-2 text-start">{t("shipping.settlements.table.collected")}</th>
                    <th className="px-3 py-2 text-start">{t("shipping.settlements.history.fees")}</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.items || []).map((item) => (
                    <tr key={item.id} className="border-t border-[var(--border)]">
                      <td className="px-3 py-2 font-black"><Link to={`/orders/${item.id}`} className="hover:text-emerald-300">{item.order_number}</Link></td>
                      <td className="px-3 py-2">{item.customer_name || "-"}</td>
                      <td className="px-3 py-2 font-mono text-xs">{item.tracking_number || "-"}</td>
                      <td className="px-3 py-2 font-bold">{fmtMoney(item.collected_amount)}</td>
                      <td className="px-3 py-2 text-orange-200">{fmtMoney(item.fee_amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function CourierSettlements() {
  const { t } = useTranslation();
  const [tab, setTab] = useState("pending");
  const [filters, setFilters] = useState({ search: "", dateFrom: "", dateTo: "" });
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState({ pending_amount: 0, pending_count: 0, settled_amount: 0, settled_count: 0 });
  const [history, setHistory] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [backfilling, setBackfilling] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [form, setForm] = useState({ fees: "", net: "", settledAt: toDateInput(), reference: "", accountId: "", notes: "" });
  const [saving, setSaving] = useState(false);
  const [detailsId, setDetailsId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [collections, settlements] = await Promise.all([
        api.get("/shipping/settlements/collections", { params: { provider: PROVIDER, state: tab === "settled" ? "settled" : "pending", search: filters.search, date_from: filters.dateFrom, date_to: filters.dateTo } }),
        api.get("/shipping/settlements", { params: { provider: PROVIDER } }),
      ]);
      setRows(Array.isArray(collections?.rows) ? collections.rows : []);
      setSummary(collections?.summary || {});
      setHistory(Array.isArray(settlements?.settlements) ? settlements.settlements : []);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setLoading(false);
    }
  }, [tab, filters.search, filters.dateFrom, filters.dateTo]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    // The receiving account list is a nicety; a missing grant must not break the page.
    api.get("/accounting/money-accounts").then((response) => {
      const list = Array.isArray(response?.accounts) ? response.accounts : Array.isArray(response?.data) ? response.data : Array.isArray(response) ? response : [];
      setAccounts(list.filter((account) => ["bank", "wallet", "payment_gateway"].includes(String(account.type || "").toLowerCase())));
    }).catch(() => setAccounts([]));
  }, []);

  const selectedRows = useMemo(() => rows.filter((row) => selected.has(row.id)), [rows, selected]);
  const gross = useMemo(() => round2(selectedRows.reduce((sum, row) => sum + Number(row.collected_amount || 0), 0)), [selectedRows]);
  const fees = round2(form.fees);
  const expectedNet = round2(gross - fees);
  const net = form.net === "" ? expectedNet : round2(form.net);
  const mismatch = Math.abs(net - expectedNet) > 0.009;

  const toggle = (id) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleAll = () => setSelected((prev) => (prev.size === rows.length && rows.length ? new Set() : new Set(rows.map((row) => row.id))));

  const runBackfill = async () => {
    setBackfilling(true);
    try {
      const result = await api.post("/shipping/settlements/collections/backfill", { provider: PROVIDER });
      const count = Array.isArray(result?.applied) ? result.applied.length : 0;
      if (count) toast.success(t("shipping.settlements.backfillDone", { count }));
      else toast(t("shipping.settlements.backfillNone"));
      await load();
    } catch (error) {
      toast.error(error.message || t("shipping.settlements.backfillFailed"));
    } finally {
      setBackfilling(false);
    }
  };

  const submit = async (event) => {
    event.preventDefault();
    if (!selectedRows.length) return toast.error(t("shipping.settlements.form.noSelection"));
    if (mismatch) return toast.error(t("shipping.settlements.form.mismatch"));
    setSaving(true);
    try {
      const result = await api.post("/shipping/settlements", {
        provider: PROVIDER,
        order_ids: selectedRows.map((row) => row.id),
        fees_amount: fees,
        net_amount: net,
        settled_at: form.settledAt ? new Date(`${form.settledAt}T12:00:00`).toISOString() : null,
        reference: form.reference,
        notes: form.notes,
        money_account_id: form.accountId || null,
      });
      toast.success(t("shipping.settlements.form.success", { id: result?.settlement?.id, net: fmtMoney(result?.settlement?.net_amount) }));
      setSelected(new Set());
      setForm({ fees: "", net: "", settledAt: toDateInput(), reference: "", accountId: form.accountId, notes: "" });
      setTab("history");
    } catch (error) {
      toast.error(error.message || t("shipping.settlements.form.failed"));
    } finally {
      setSaving(false);
    }
  };

  const tabButton = (key, label) => (
    <button type="button" onClick={() => { setTab(key); setSelected(new Set()); }} className={`rounded-[var(--radius-control)] px-4 py-2 text-sm font-black ${tab === key ? "bg-primary text-[var(--primary-contrast)]" : "border border-[var(--border)] bg-[var(--card)] text-[var(--text)]"}`}>{label}</button>
  );

  return (
    <main className="min-h-screen bg-[var(--bg)] p-4 text-[var(--text)] md:p-6">
      <div className="mx-auto w-full space-y-5">
        <header className="flex flex-col gap-4 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-2xl shadow-[var(--shadow)] lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.24em] text-emerald-300">{t("shipping.settlements.eyebrow")}</div>
            <h1 className="m1-page-title mt-2">{t("shipping.settlements.title")}</h1>
            <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-[var(--muted)]">{t("shipping.settlements.subtitle")}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link to="/operations/shipping" className={ghostButton}><ArrowRight className="h-4 w-4 rtl:rotate-180" /> {t("shipping.settlements.back")}</Link>
            <button type="button" onClick={runBackfill} disabled={backfilling} className={ghostButton}>{backfilling ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCheck className="h-4 w-4" />} {t("shipping.settlements.backfill")}</button>
            <button type="button" onClick={load} className={ghostButton}><RefreshCw className="h-4 w-4" /> {t("shipping.settlements.refresh")}</button>
          </div>
        </header>

        <section className="grid gap-3 sm:grid-cols-3">
          <Kpi label={t("shipping.settlements.kpi.pending")} value={fmtMoney(summary.pending_amount)} sub={t("shipping.settlements.kpi.pendingCount", { count: Number(summary.pending_count || 0) })} tone="text-sky-200" />
          <Kpi label={t("shipping.settlements.kpi.settled")} value={fmtMoney(summary.settled_amount)} sub={t("shipping.settlements.kpi.settledCount", { count: Number(summary.settled_count || 0) })} tone="text-emerald-200" />
          <Kpi label={t("shipping.settlements.kpi.selected")} value={fmtMoney(gross)} sub={t("shipping.settlements.kpi.selectedCount", { count: selectedRows.length })} tone="text-primary" />
        </section>

        <div className="flex flex-wrap gap-2">
          {tabButton("pending", t("shipping.settlements.tabs.pending"))}
          {tabButton("settled", t("shipping.settlements.tabs.settled"))}
          {tabButton("history", t("shipping.settlements.tabs.history"))}
        </div>

        {tab !== "history" ? (
          <div className={`grid gap-5 ${tab === "pending" ? "xl:grid-cols-[1fr_22rem]" : ""}`}>
            <section className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-2xl shadow-[var(--shadow)]">
              <div className="mb-4 grid gap-2 md:grid-cols-4">
                <div className="relative md:col-span-2">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-tertiary)]" />
                  <input value={filters.search} onChange={(event) => setFilters((prev) => ({ ...prev, search: event.target.value }))} placeholder={t("shipping.settlements.filters.search")} className={`${inputClass} pl-9`} />
                </div>
                <input type="date" value={filters.dateFrom} onChange={(event) => setFilters((prev) => ({ ...prev, dateFrom: event.target.value }))} className={inputClass} aria-label={t("shipping.settlements.filters.from")} />
                <input type="date" value={filters.dateTo} onChange={(event) => setFilters((prev) => ({ ...prev, dateTo: event.target.value }))} className={inputClass} aria-label={t("shipping.settlements.filters.to")} />
              </div>
              {loading ? <div className="grid h-64 place-items-center text-[var(--muted)]"><Loader2 className="h-8 w-8 animate-spin" /></div> : (
                <div className="overflow-auto rounded-2xl border border-[var(--border)]">
                  <table className="w-full min-w-[880px] text-sm">
                    <thead className="sticky top-0 z-10 bg-[var(--table-head)] text-xs uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
                      <tr>
                        {tab === "pending" ? <th className="w-10 px-3 py-3"><input type="checkbox" checked={Boolean(rows.length) && selected.size === rows.length} onChange={toggleAll} aria-label={t("shipping.settlements.selectAll")} /></th> : null}
                        <th className="px-3 py-3 text-start font-black">{t("shipping.settlements.table.order")}</th>
                        <th className="px-3 py-3 text-start font-black">{t("shipping.settlements.table.customer")}</th>
                        <th className="px-3 py-3 text-start font-black">{t("shipping.settlements.table.tracking")}</th>
                        <th className="px-3 py-3 text-start font-black">{t("shipping.settlements.table.collectedAt")}</th>
                        <th className="px-3 py-3 text-start font-black">{t("shipping.settlements.table.orderTotal")}</th>
                        <th className="px-3 py-3 text-start font-black">{t("shipping.settlements.table.collected")}</th>
                        {tab === "settled" ? <th className="px-3 py-3 text-start font-black">{t("shipping.settlements.table.settlement")}</th> : null}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <tr key={row.id} onClick={tab === "pending" ? () => toggle(row.id) : undefined} className={`border-t border-[var(--border)] ${tab === "pending" ? "cursor-pointer hover:bg-[var(--table-hover)]" : ""} ${selected.has(row.id) ? "bg-emerald-400/10" : ""}`}>
                          {tab === "pending" ? <td className="px-3 py-3" onClick={(event) => event.stopPropagation()}><input type="checkbox" checked={selected.has(row.id)} onChange={() => toggle(row.id)} /></td> : null}
                          <td className="px-3 py-3 font-black"><Link to={`/orders/${row.id}`} className="hover:text-emerald-300" onClick={(event) => event.stopPropagation()}>{row.order_number}</Link></td>
                          <td className="px-3 py-3"><div className="font-bold">{row.customer_name || "-"}</div><div className="text-xs text-[var(--muted)]" dir="ltr">{row.customer_phone || ""}</div></td>
                          <td className="px-3 py-3 font-mono text-xs text-primary">{row.tracking_number || "-"}</td>
                          <td className="px-3 py-3 text-xs text-[var(--muted)]">{fmtDate(row.courier_collected_at)}</td>
                          <td className="px-3 py-3">{fmtMoney(row.order_total)}</td>
                          <td className="px-3 py-3 font-black text-amber-100">{fmtMoney(row.collected_amount)}</td>
                          {tab === "settled" ? <td className="px-3 py-3"><button type="button" onClick={() => setDetailsId(row.courier_settlement_id)} className="rounded-full border border-[var(--border)] bg-[var(--card)] px-2.5 py-1 text-xs font-black hover:text-emerald-300">#{row.courier_settlement_id} · {fmtDate(row.courier_settled_at)}</button></td> : null}
                        </tr>
                      ))}
                      {!rows.length ? <tr><td colSpan={8} className="px-4 py-16 text-center text-sm font-bold text-[var(--text-tertiary)]">{t("shipping.settlements.table.empty")}</td></tr> : null}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {tab === "pending" ? (
              <form onSubmit={submit} className="h-fit space-y-3 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-2xl shadow-[var(--shadow)]">
                <div className="flex items-center gap-2 text-base font-black"><Landmark className="h-5 w-5 text-emerald-300" /> {t("shipping.settlements.form.title")}</div>
                <p className="text-xs font-semibold leading-5 text-[var(--muted)]">{t("shipping.settlements.form.hint")}</p>
                <label className="block text-xs font-black text-[var(--text-tertiary)]">{t("shipping.settlements.form.gross")}
                  <div className="mt-1 rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--card-soft)] px-3 py-2 text-lg font-black text-amber-100">{fmtMoney(gross)}</div>
                </label>
                <label className="block text-xs font-black text-[var(--text-tertiary)]">{t("shipping.settlements.form.fees")}
                  <input type="number" min="0" step="0.01" value={form.fees} onChange={(event) => setForm((prev) => ({ ...prev, fees: event.target.value }))} className={`${inputClass} mt-1`} />
                </label>
                <label className="block text-xs font-black text-[var(--text-tertiary)]">{t("shipping.settlements.form.net")}
                  <input type="number" min="0" step="0.01" value={form.net} placeholder={expectedNet.toFixed(2)} onChange={(event) => setForm((prev) => ({ ...prev, net: event.target.value }))} className={`${inputClass} mt-1 ${mismatch ? "border-rose-400/60" : ""}`} />
                  <div className={`mt-1 text-xs font-bold ${mismatch ? "text-rose-300" : "text-[var(--muted)]"}`}>{t("shipping.settlements.form.expectedNet")}: {fmtMoney(expectedNet)}</div>
                </label>
                <label className="block text-xs font-black text-[var(--text-tertiary)]">{t("shipping.settlements.form.settledAt")}
                  <input type="date" value={form.settledAt} onChange={(event) => setForm((prev) => ({ ...prev, settledAt: event.target.value }))} className={`${inputClass} mt-1`} />
                </label>
                <label className="block text-xs font-black text-[var(--text-tertiary)]">{t("shipping.settlements.form.reference")}
                  <input value={form.reference} onChange={(event) => setForm((prev) => ({ ...prev, reference: event.target.value }))} className={`${inputClass} mt-1`} />
                </label>
                <label className="block text-xs font-black text-[var(--text-tertiary)]">{t("shipping.settlements.form.account")}
                  <select value={form.accountId} onChange={(event) => setForm((prev) => ({ ...prev, accountId: event.target.value }))} className={`${inputClass} mt-1`}>
                    <option value="">{t("shipping.settlements.form.accountAuto")}</option>
                    {accounts.map((account) => <option key={account.id} value={account.id}>{account.name}{account.branch_name ? ` — ${account.branch_name}` : ""}</option>)}
                  </select>
                </label>
                <label className="block text-xs font-black text-[var(--text-tertiary)]">{t("shipping.settlements.form.notes")}
                  <textarea rows={2} value={form.notes} onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))} className="mt-1 w-full rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm font-bold text-[var(--text)] outline-none focus:border-emerald-300/50" />
                </label>
                <button type="submit" disabled={saving || !selectedRows.length || mismatch} className="inline-flex w-full items-center justify-center gap-2 rounded-[var(--radius-control)] bg-primary px-4 py-2.5 text-sm font-black text-[var(--primary-contrast)] disabled:opacity-50">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Banknote className="h-4 w-4" />} {saving ? t("shipping.settlements.form.submitting") : t("shipping.settlements.form.submit")}
                </button>
              </form>
            ) : null}
          </div>
        ) : (
          <section className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-2xl shadow-[var(--shadow)]">
            <div className="mb-3 flex items-center gap-2 text-base font-black"><Truck className="h-5 w-5 text-emerald-300" /> {t("shipping.settlements.history.title")}</div>
            <div className="overflow-auto rounded-2xl border border-[var(--border)]">
              <table className="w-full min-w-[880px] text-sm">
                <thead className="bg-[var(--table-head)] text-xs uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
                  <tr>
                    <th className="px-3 py-3 text-start font-black">#</th>
                    <th className="px-3 py-3 text-start font-black">{t("shipping.settlements.history.date")}</th>
                    <th className="px-3 py-3 text-start font-black">{t("shipping.settlements.history.reference")}</th>
                    <th className="px-3 py-3 text-start font-black">{t("shipping.settlements.history.orders")}</th>
                    <th className="px-3 py-3 text-start font-black">{t("shipping.settlements.history.gross")}</th>
                    <th className="px-3 py-3 text-start font-black">{t("shipping.settlements.history.fees")}</th>
                    <th className="px-3 py-3 text-start font-black">{t("shipping.settlements.history.net")}</th>
                    <th className="px-3 py-3 text-start font-black">{t("shipping.settlements.history.account")}</th>
                    <th className="px-3 py-3 text-start font-black">{t("shipping.settlements.history.by")}</th>
                    <th className="px-3 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {history.map((row) => (
                    <tr key={row.id} className="border-t border-[var(--border)]">
                      <td className="px-3 py-3 font-black">#{row.id}</td>
                      <td className="px-3 py-3 text-xs text-[var(--muted)]">{fmtDate(row.settled_at)}</td>
                      <td className="px-3 py-3 font-mono text-xs">{row.reference || "-"}</td>
                      <td className="px-3 py-3">{row.orders_count}</td>
                      <td className="px-3 py-3 font-bold">{fmtMoney(row.gross_amount)}</td>
                      <td className="px-3 py-3 text-orange-200">{fmtMoney(row.fees_amount)}</td>
                      <td className="px-3 py-3 font-black text-emerald-200">{fmtMoney(row.net_amount)}</td>
                      <td className="px-3 py-3">{row.money_account_name || "-"}</td>
                      <td className="px-3 py-3 text-xs text-[var(--muted)]">{row.created_by_name || "-"}</td>
                      <td className="px-3 py-3"><button type="button" onClick={() => setDetailsId(row.id)} className="rounded-full border border-[var(--border)] bg-[var(--card)] px-2.5 py-1 text-xs font-black hover:text-emerald-300">{t("shipping.settlements.history.view")}</button></td>
                    </tr>
                  ))}
                  {!history.length ? <tr><td colSpan={10} className="px-4 py-16 text-center text-sm font-bold text-[var(--text-tertiary)]">{t("shipping.settlements.history.empty")}</td></tr> : null}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
      {detailsId ? <SettlementDetails id={detailsId} onClose={() => setDetailsId(null)} /> : null}
    </main>
  );
}
