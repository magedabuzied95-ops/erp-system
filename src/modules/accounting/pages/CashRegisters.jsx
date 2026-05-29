import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  Banknote,
  Download,
  DoorOpen,
  Loader2,
  Plus,
  RefreshCcw,
  Wallet,
  X,
} from "lucide-react";
import toast from "react-hot-toast";

import AccountingShell from "../components/AccountingShell";
import FinanceMetricCard from "../components/FinanceMetricCard";
import { formatCurrency, formatDateTime } from "../lib/financeStore";
import { accountingApi } from "../services/accountingApi";

const initialOpenForm = { branch_id: "", opening_cash: "", notes: "" };
const initialCloseForm = { actual_cash: "", notes: "" };
const initialMovementForm = { event_type: "cash_in", amount: "", note: "" };
const inputClass = "w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none transition placeholder:text-zinc-600 focus:border-cyan-300/70";

const money = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const durationText = (openedAt, closedAt, t) => {
  if (!openedAt) return t("accounting.common.labels.notAvailable");
  const start = new Date(openedAt).getTime();
  const end = closedAt ? new Date(closedAt).getTime() : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return t("accounting.common.labels.notAvailable");
  const minutes = Math.max(0, Math.floor((end - start) / 60000));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours ? `${hours}h ${rest}m` : `${rest}m`;
};

function CashRegisters() {
  const { t } = useTranslation();
  const [currentShift, setCurrentShift] = useState(null);
  const [events, setEvents] = useState([]);
  const [history, setHistory] = useState([]);
  const [filters, setFilters] = useState({ branch_id: "", status: "", from_date: "", to_date: "" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState("");
  const [openModal, setOpenModal] = useState(false);
  const [closeModal, setCloseModal] = useState(false);
  const [openForm, setOpenForm] = useState(initialOpenForm);
  const [closeForm, setCloseForm] = useState(initialCloseForm);
  const [movementForm, setMovementForm] = useState(initialMovementForm);

  const loadCashDrawer = async (params = filters) => {
    setLoading(true);
    try {
      const current = await accountingApi.getCurrentCashDrawerShift({
        branch_id: params.branch_id,
      });
      const historyResult = await accountingApi.getCashDrawerHistory(params);
      setCurrentShift(current?.shift || null);
      setEvents(Array.isArray(current?.events) ? current.events : []);
      setHistory(Array.isArray(historyResult?.rows) ? historyResult.rows : []);
    } catch (error) {
      toast.error(error?.message || t("accounting.cashDrawer.errors.loadFailed"));
      setCurrentShift(null);
      setEvents([]);
      setHistory([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCashDrawer();
  }, []);

  const summary = useMemo(() => {
    const rows = Array.isArray(events) ? events : [];
    return rows.reduce(
      (acc, event) => {
        const amount = money(event.amount);
        if (event.event_type === "sale_cash") acc.sales += amount;
        if (event.event_type === "refund_cash") acc.refunds += amount;
        if (event.event_type === "expense_cash") acc.expenses += amount;
        if (event.event_type === "cash_in") acc.cashIn += amount;
        if (event.event_type === "cash_out") acc.cashOut += amount;
        return acc;
      },
      { sales: 0, refunds: 0, expenses: 0, cashIn: 0, cashOut: 0 }
    );
  }, [events]);

  const closeDifference = money(closeForm.actual_cash) - money(currentShift?.expected_cash);
  const largeDifference = Math.abs(money(currentShift?.difference ?? closeDifference)) >= 100;

  const openShift = async (event) => {
    event.preventDefault();
    if (!openForm.branch_id) {
      toast.error(t("accounting.cashDrawer.errors.branchRequired"));
      return;
    }
    setSaving("open");
    try {
      const result = await accountingApi.openCashDrawerShift({
        branch_id: openForm.branch_id,
        opening_cash: money(openForm.opening_cash),
        notes: openForm.notes,
      });
      setCurrentShift(result?.shift || null);
      setEvents(Array.isArray(result?.events) ? result.events : []);
      setOpenModal(false);
      setOpenForm(initialOpenForm);
      await loadCashDrawer({ ...filters, branch_id: openForm.branch_id });
      toast.success(t("accounting.cashDrawer.toasts.opened"));
    } catch (error) {
      toast.error(error?.message || t("accounting.cashDrawer.errors.openFailed"));
    } finally {
      setSaving("");
    }
  };

  const closeShift = async (event) => {
    event.preventDefault();
    if (!currentShift?.id) return;
    setSaving("close");
    try {
      const result = await accountingApi.closeCashDrawerShift(currentShift.id, {
        actual_cash: money(closeForm.actual_cash),
        notes: closeForm.notes,
      });
      setCurrentShift(null);
      setEvents(Array.isArray(result?.events) ? result.events : []);
      setCloseModal(false);
      setCloseForm(initialCloseForm);
      await loadCashDrawer(filters);
      toast.success(t("accounting.cashDrawer.toasts.closed"));
    } catch (error) {
      toast.error(error?.message || t("accounting.cashDrawer.errors.closeFailed"));
    } finally {
      setSaving("");
    }
  };

  const submitMovement = async (event) => {
    event.preventDefault();
    if (!currentShift?.id) {
      toast.error(t("accounting.cashDrawer.errors.openShiftFirst"));
      return;
    }
    if (money(movementForm.amount) <= 0) {
      toast.error(t("accounting.cashDrawer.errors.amountPositive"));
      return;
    }
    setSaving("movement");
    try {
      const result = await accountingApi.recordCashDrawerEvent(currentShift.id, {
        branch_id: currentShift.branch_id,
        event_type: movementForm.event_type,
        source_type: "manual",
        amount: money(movementForm.amount),
      });
      setCurrentShift(result?.shift || currentShift);
      setEvents(Array.isArray(result?.events) ? result.events : events);
      setMovementForm(initialMovementForm);
      await loadCashDrawer(filters);
      toast.success(t("accounting.cashDrawer.toasts.movementRecorded"));
    } catch (error) {
      toast.error(error?.message || t("accounting.cashDrawer.errors.movementFailed"));
    } finally {
      setSaving("");
    }
  };

  const applyFilters = (event) => {
    event.preventDefault();
    loadCashDrawer(filters);
  };

  const exportHistory = () => {
    const header = [t("accounting.cashDrawer.labels.cashier"), t("accounting.common.labels.branch"), t("accounting.common.labels.opening"), t("accounting.cashDrawer.labels.expected"), t("accounting.cashDrawer.labels.actual"), t("accounting.reports.metrics.difference"), t("accounting.cashDrawer.labels.openedAt"), t("accounting.cashDrawer.labels.closedAt"), t("accounting.common.labels.status")];
    const body = history.map((shift) => [
      shift.cashier_name || "",
      shift.branch_name || shift.branch_id || "",
      shift.opening_cash || 0,
      shift.expected_cash || 0,
      shift.actual_cash ?? "",
      shift.difference || 0,
      shift.opened_at || "",
      shift.closed_at || "",
      shift.status || "",
    ]);
    const csv = [header, ...body].map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `cash-drawer-shifts-${Date.now()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <AccountingShell
      title={t("accounting.cashDrawer.title")}
      subtitle={t("accounting.cashDrawer.subtitle")}
      actions={
        <>
          <button type="button" onClick={() => loadCashDrawer(filters)} disabled={loading} className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-black text-white transition hover:bg-white/10 disabled:opacity-60">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
            {t("accounting.common.actions.refresh")}
          </button>
          <button type="button" onClick={() => setOpenModal(true)} disabled={Boolean(currentShift)} className="inline-flex items-center gap-2 rounded-2xl bg-cyan-500 px-4 py-2 text-sm font-black text-black transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-60">
            <DoorOpen className="h-4 w-4" />
            {t("accounting.cashDrawer.actions.openShift")}
          </button>
          <button type="button" onClick={() => setCloseModal(true)} disabled={!currentShift} className="inline-flex items-center gap-2 rounded-2xl border border-amber-300/30 bg-amber-300/10 px-4 py-2 text-sm font-black text-amber-100 transition hover:bg-amber-300/20 disabled:cursor-not-allowed disabled:opacity-60">
            <Wallet className="h-4 w-4" />
            {t("accounting.cashDrawer.actions.closeShift")}
          </button>
        </>
      }
      tabs={cashDrawerTabs(t)}
    >
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <FinanceMetricCard label={t("accounting.cashDrawer.metrics.expectedCash")} value={formatCurrency(currentShift?.expected_cash || 0)} tone="emerald" icon={<Banknote className="h-5 w-5" />} />
        <FinanceMetricCard label={t("accounting.cashDrawer.metrics.cashSales")} value={formatCurrency(summary.sales)} tone="cyan" icon={<ArrowDownLeft className="h-5 w-5" />} />
        <FinanceMetricCard label={t("accounting.cashDrawer.metrics.refundsExpenses")} value={formatCurrency(summary.refunds + summary.expenses + summary.cashOut)} tone="rose" icon={<ArrowUpRight className="h-5 w-5" />} />
        <FinanceMetricCard label={t("accounting.cashDrawer.metrics.shiftDuration")} value={durationText(currentShift?.opened_at, null, t)} tone="amber" icon={<Wallet className="h-5 w-5" />} />
      </div>

      {largeDifference ? (
        <div className="flex items-start gap-3 rounded-3xl border border-rose-300/20 bg-rose-300/10 p-4 text-sm text-rose-100">
          <AlertTriangle className="h-5 w-5" />
          {t("accounting.cashDrawer.warnings.largeDifference")}
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[0.85fr_1.15fr]">
        <div className="rounded-3xl border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10">
          <h3 className="text-xl font-black text-white">{t("accounting.cashDrawer.currentShift")}</h3>
          {currentShift ? (
            <div className="mt-4 space-y-3 text-sm text-zinc-300">
              <Info label={t("accounting.cashDrawer.labels.cashier")} value={currentShift.cashier_name || t("accounting.auditTrail.fallbacks.userNumber", { id: currentShift.opened_by })} />
              <Info label={t("accounting.common.labels.branch")} value={currentShift.branch_name || t("accounting.financialAccounts.labels.branchNumber", { id: currentShift.branch_id })} />
              <Info label={t("accounting.cashDrawer.labels.openedAt")} value={formatDateTime(currentShift.opened_at)} />
              <Info label={t("accounting.cashDrawer.metrics.openingCash")} value={formatCurrency(currentShift.opening_cash)} />
              <Info label={t("accounting.cashDrawer.metrics.expectedCash")} value={formatCurrency(currentShift.expected_cash)} strong />
              <Info label={t("accounting.cashDrawer.labels.events")} value={currentShift.event_count || events.length} />
            </div>
          ) : (
            <div className="mt-4 rounded-2xl border border-dashed border-white/10 bg-white/5 p-6 text-sm text-zinc-400">
              {t("accounting.cashDrawer.empty.noOpenShift")}
            </div>
          )}

          <form onSubmit={submitMovement} className="mt-6 rounded-3xl border border-white/10 bg-white/5 p-4">
            <h4 className="font-black text-white">{t("accounting.cashDrawer.manualMovement")}</h4>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label={t("accounting.common.labels.type")}>
                <select value={movementForm.event_type} onChange={(event) => setMovementForm((current) => ({ ...current, event_type: event.target.value }))} className={inputClass}>
                  <option value="cash_in">{t("accounting.cashDrawer.movement.cashIn")}</option>
                  <option value="cash_out">{t("accounting.cashDrawer.movement.cashOut")}</option>
                </select>
              </Field>
              <Field label={t("accounting.common.labels.amount")}>
                <input type="number" min="0" step="0.01" value={movementForm.amount} onChange={(event) => setMovementForm((current) => ({ ...current, amount: event.target.value }))} className={inputClass} />
              </Field>
            </div>
            <button type="submit" disabled={!currentShift || saving === "movement"} className="mt-4 inline-flex items-center gap-2 rounded-2xl bg-cyan-500 px-4 py-2 text-sm font-black text-black transition hover:bg-cyan-400 disabled:opacity-60">
              {saving === "movement" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              {t("accounting.cashDrawer.actions.addMovement")}
            </button>
          </form>
        </div>

        <div className="rounded-3xl border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-xl font-black text-white">{t("accounting.cashDrawer.shiftEvents")}</h3>
              <p className="mt-1 text-sm text-zinc-500">{t("accounting.cashDrawer.eventsCount", { count: events.length })}</p>
            </div>
          </div>
          <div className="mt-4 max-h-[460px] space-y-3 overflow-auto pr-1">
            {events.length ? events.map((event) => (
              <div key={event.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-black text-white">{event.event_type.replaceAll("_", " ")}</div>
                    <div className="mt-1 text-xs text-zinc-500">{event.source_type || "manual"} {event.source_id ? `#${event.source_id}` : ""}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-black text-white">{formatCurrency(event.amount)}</div>
                    <div className="mt-1 text-xs text-zinc-500">{formatDateTime(event.created_at)}</div>
                  </div>
                </div>
              </div>
            )) : (
              <div className="rounded-2xl border border-dashed border-white/10 bg-white/5 p-6 text-sm text-zinc-400">{t("accounting.cashDrawer.empty.noEvents")}</div>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-3xl border border-white/10 bg-zinc-950 shadow-2xl shadow-black/20">
        <div className="flex flex-col gap-3 border-b border-white/10 p-4 lg:flex-row lg:items-end lg:justify-between">
          <form onSubmit={applyFilters} className="grid flex-1 gap-3 md:grid-cols-4">
            <Field label={t("accounting.common.labels.branchId")}>
              <input type="number" min="1" value={filters.branch_id} onChange={(event) => setFilters((current) => ({ ...current, branch_id: event.target.value }))} className={inputClass} placeholder={t("accounting.cashDrawer.placeholders.any")} />
            </Field>
            <Field label={t("accounting.common.labels.status")}>
              <select value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))} className={inputClass}>
                <option value="">{t("accounting.common.labels.all")}</option>
                <option value="open">{t("accounting.cashDrawer.status.open")}</option>
                <option value="closed">{t("accounting.cashDrawer.status.closed")}</option>
              </select>
            </Field>
            <Field label={t("accounting.common.labels.from")}>
              <input type="date" value={filters.from_date} onChange={(event) => setFilters((current) => ({ ...current, from_date: event.target.value }))} className={inputClass} />
            </Field>
            <Field label={t("accounting.common.labels.to")}>
              <input type="date" value={filters.to_date} onChange={(event) => setFilters((current) => ({ ...current, to_date: event.target.value }))} className={inputClass} />
            </Field>
            <button type="submit" className="rounded-2xl bg-cyan-500 px-4 py-2 text-sm font-black text-black md:col-span-4">{t("accounting.cashDrawer.actions.applyFilters")}</button>
          </form>
          <button type="button" onClick={exportHistory} disabled={!history.length} className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-black text-white transition hover:bg-white/10 disabled:opacity-60">
            <Download className="h-4 w-4" />
            {t("accounting.common.actions.exportCsv")}
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-[1040px] w-full text-left text-sm">
            <thead className="bg-white/[0.03] text-[11px] uppercase tracking-[0.16em] text-zinc-500">
              <tr>
                <Th>{t("accounting.cashDrawer.labels.cashier")}</Th>
                <Th>{t("accounting.common.labels.branch")}</Th>
                <Th align="right">{t("accounting.common.labels.opening")}</Th>
                <Th align="right">{t("accounting.cashDrawer.labels.expected")}</Th>
                <Th align="right">{t("accounting.cashDrawer.labels.actual")}</Th>
                <Th align="right">{t("accounting.reports.metrics.difference")}</Th>
                <Th>{t("accounting.cashDrawer.status.opened")}</Th>
                <Th>{t("accounting.cashDrawer.status.closed")}</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {history.length ? history.map((shift) => (
                <tr key={shift.id} className="bg-zinc-950/80 text-zinc-300 transition hover:bg-white/[0.04]">
                  <Td className="font-black text-white">{shift.cashier_name || t("accounting.auditTrail.fallbacks.userNumber", { id: shift.opened_by })}</Td>
                  <Td>{shift.branch_name || t("accounting.financialAccounts.labels.branchNumber", { id: shift.branch_id })}</Td>
                  <Td align="right">{formatCurrency(shift.opening_cash)}</Td>
                  <Td align="right">{formatCurrency(shift.expected_cash)}</Td>
                  <Td align="right">{shift.actual_cash === null ? "-" : formatCurrency(shift.actual_cash)}</Td>
                  <Td align="right" className={money(shift.difference) === 0 ? "font-black text-emerald-300" : "font-black text-rose-300"}>{formatCurrency(shift.difference)}</Td>
                  <Td>{formatDateTime(shift.opened_at)}</Td>
                  <Td>{shift.closed_at ? formatDateTime(shift.closed_at) : t("accounting.cashDrawer.status.open")}</Td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-zinc-500">{t("accounting.cashDrawer.empty.noShifts")}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {openModal ? (
        <Modal title={t("accounting.cashDrawer.modals.openTitle")} onClose={() => setOpenModal(false)}>
          <form onSubmit={openShift} className="space-y-4">
            <Field label={t("accounting.common.labels.branchId")}>
              <input type="number" min="1" value={openForm.branch_id} onChange={(event) => setOpenForm((current) => ({ ...current, branch_id: event.target.value }))} className={inputClass} autoFocus />
            </Field>
            <Field label={t("accounting.cashDrawer.metrics.openingCash")}>
              <input type="number" min="0" step="0.01" value={openForm.opening_cash} onChange={(event) => setOpenForm((current) => ({ ...current, opening_cash: event.target.value }))} className={inputClass} />
            </Field>
            <Field label={t("accounting.common.labels.notes")}>
              <textarea value={openForm.notes} onChange={(event) => setOpenForm((current) => ({ ...current, notes: event.target.value }))} className={`${inputClass} min-h-24`} />
            </Field>
            <button type="submit" disabled={saving === "open"} className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-cyan-500 px-4 py-3 text-sm font-black text-black disabled:opacity-60">
              {saving === "open" ? <Loader2 className="h-4 w-4 animate-spin" /> : <DoorOpen className="h-4 w-4" />}
              {t("accounting.cashDrawer.actions.openShift")}
            </button>
          </form>
        </Modal>
      ) : null}

      {closeModal ? (
        <Modal title={t("accounting.cashDrawer.modals.closeTitle")} onClose={() => setCloseModal(false)}>
          <form onSubmit={closeShift} className="space-y-4">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-zinc-300">
              <Info label={t("accounting.cashDrawer.metrics.expectedCash")} value={formatCurrency(currentShift?.expected_cash || 0)} strong />
              <Info label={t("accounting.cashDrawer.labels.differencePreview")} value={formatCurrency(closeDifference)} strong />
            </div>
            <Field label={t("accounting.cashDrawer.labels.actualCountedCash")}>
              <input type="number" min="0" step="0.01" value={closeForm.actual_cash} onChange={(event) => setCloseForm((current) => ({ ...current, actual_cash: event.target.value }))} className={inputClass} autoFocus />
            </Field>
            <Field label={t("accounting.common.labels.notes")}>
              <textarea value={closeForm.notes} onChange={(event) => setCloseForm((current) => ({ ...current, notes: event.target.value }))} className={`${inputClass} min-h-24`} />
            </Field>
            {Math.abs(closeDifference) >= 100 ? (
              <div className="rounded-2xl border border-rose-300/20 bg-rose-300/10 p-3 text-sm text-rose-100">{t("accounting.cashDrawer.warnings.addClosingNote")}</div>
            ) : null}
            <button type="submit" disabled={saving === "close"} className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-amber-300 px-4 py-3 text-sm font-black text-black disabled:opacity-60">
              {saving === "close" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wallet className="h-4 w-4" />}
              {t("accounting.cashDrawer.actions.closeShift")}
            </button>
          </form>
        </Modal>
      ) : null}
    </AccountingShell>
  );
}

function Info({ label, value, strong = false }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1">
      <span className="text-zinc-500">{label}</span>
      <span className={strong ? "font-black text-white" : "font-semibold text-zinc-200"}>{value}</span>
    </div>
  );
}

function cashDrawerTabs(t) {
  return [
    { to: "/accounting", label: t("accounting.tabs.dashboard") },
    { to: "/accounting/cashbox", label: t("accounting.tabs.cashDrawer"), end: true },
    { to: "/accounting/financial-accounts", label: t("accounting.tabs.financialAccounts") },
    { to: "/accounting/payment-method-mappings", label: t("accounting.tabs.paymentMappings") },
    { to: "/accounting/expenses", label: t("accounting.tabs.expenses") },
    { to: "/accounting/income", label: t("accounting.tabs.income") },
    { to: "/accounting/journal-entries", label: t("accounting.tabs.journal") },
    { to: "/accounting/ledgers", label: t("accounting.tabs.ledgers") },
    { to: "/accounting/audit-trail", label: t("accounting.tabs.auditTrail") },
  ];
}

function Field({ label, children }) {
  return (
    <label className="block space-y-2">
      <span className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">{label}</span>
      {children}
    </label>
  );
}

function Modal({ title, children, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-lg rounded-3xl border border-white/10 bg-zinc-950 p-5 shadow-2xl shadow-black">
        <div className="mb-5 flex items-center justify-between gap-3">
          <h3 className="text-xl font-black text-white">{title}</h3>
          <button type="button" onClick={onClose} className="rounded-2xl border border-white/10 bg-white/5 p-2 text-white transition hover:bg-white/10">
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Th({ children, align = "left" }) {
  return <th className={["px-4 py-3 font-black", align === "right" ? "text-right" : ""].join(" ")}>{children}</th>;
}

function Td({ children, align = "left", className = "" }) {
  return <td className={["px-4 py-4 align-top", align === "right" ? "text-right" : "", className].join(" ")}>{children}</td>;
}

export default CashRegisters;
