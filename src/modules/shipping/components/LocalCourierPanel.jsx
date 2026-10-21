import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Banknote, Bike, CheckCheck, Loader2, Save } from "lucide-react";
import toast from "react-hot-toast";
import { api } from "../../../shared/api/api";
import ThemedSelect from "../../../shared/ui/ThemedSelect";

// The shop's own motorcycle courier (server: modules/shipping/localCourier.js). Delivered orders
// already closed the customer's balance; here the courier hands the cash in: it lands in an open
// drawer shift (net of his fee) and the fee becomes a shipping expense. Below that, the orders
// that went out with him before this existed — still "confirmed" and owing until someone says
// they were delivered.

const PROVIDER = "local_courier";
const fmtMoney = (value) => `${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ج.م`;
const fmtDate = (value) => (value ? new Date(value).toLocaleString() : "-");
const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;

const cardClass = "rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-2xl shadow-[var(--shadow)]";
const inputClass = "h-[var(--control-height-md)] w-full rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--card)] px-3 text-sm font-bold text-[var(--text)] outline-none focus:border-emerald-300/50";
const primaryButton = "inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] bg-primary px-4 py-2.5 text-sm font-black text-[var(--primary-contrast)] disabled:opacity-50";
const labelClass = "block text-xs font-black text-[var(--text-tertiary)]";

const useSelection = () => {
  const [selected, setSelected] = useState(() => new Set());
  const toggle = (id) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  return { selected, setSelected, toggle };
};

function SettingsCard({ settings, onSaved }) {
  const { t } = useTranslation();
  const [form, setForm] = useState({ name: "", phone: "", fee: 0 });
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setForm({ name: settings.courier_name || "", phone: settings.courier_phone || "", fee: Number(settings.fee_per_order) || 0 });
  }, [settings]);
  const save = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      const result = await api.put("/shipping/local-courier/settings", { courier_name: form.name, courier_phone: form.phone, fee_per_order: form.fee });
      toast.success(t("shipping.settlements.local.settings.saved"));
      onSaved(result?.settings || settings);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <form onSubmit={save} className={`${cardClass} grid gap-3 md:grid-cols-[1fr_1fr_12rem_auto] md:items-end`}>
      <label className={labelClass}>{t("shipping.settlements.local.settings.name")}
        <input value={form.name} onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))} className={`${inputClass} mt-1`} />
      </label>
      <label className={labelClass}>{t("shipping.settlements.local.settings.phone")}
        <input value={form.phone} dir="ltr" inputMode="tel" onChange={(event) => setForm((prev) => ({ ...prev, phone: event.target.value }))} className={`${inputClass} mt-1`} />
      </label>
      <label className={labelClass}>{t("shipping.settlements.local.settings.fee")}
        <input type="number" min="0" step="0.01" value={form.fee} onChange={(event) => setForm((prev) => ({ ...prev, fee: event.target.value === "" ? 0 : Number(event.target.value) }))} className={`${inputClass} mt-1`} />
      </label>
      <button type="submit" disabled={saving} className={primaryButton}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} {t("shipping.settlements.local.settings.save")}</button>
    </form>
  );
}

function CollectionsSection({ settings, shifts, onSettled, refreshKey }) {
  const { t } = useTranslation();
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState({});
  const [loading, setLoading] = useState(true);
  const { selected, setSelected, toggle } = useSelection();
  const [shiftId, setShiftId] = useState("");
  const [fees, setFees] = useState("");
  const [notes, setNotes] = useState("");
  // InstaPay / Visa the customers paid straight to the shop; the rest is the cash he hands in.
  const [instapay, setInstapay] = useState("");
  const [card, setCard] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.get("/shipping/settlements/collections", { params: { provider: PROVIDER, state: "pending" } });
      setRows(Array.isArray(response?.rows) ? response.rows : []);
      setSummary(response?.summary || {});
      setSelected(new Set());
    } catch (error) {
      toast.error(error.message);
    } finally {
      setLoading(false);
    }
  }, [setSelected]);
  useEffect(() => { load(); }, [load, refreshKey]);
  useEffect(() => {
    if (!shiftId && shifts.length === 1) setShiftId(String(shifts[0].id));
  }, [shifts, shiftId]);

  const selectedRows = useMemo(() => rows.filter((row) => selected.has(row.id)), [rows, selected]);
  const gross = round2(selectedRows.reduce((sum, row) => sum + Number(row.collected_amount || 0), 0));
  const defaultFees = round2((Number(settings.fee_per_order) || 0) * selectedRows.length);
  const feeValue = fees === "" ? defaultFees : round2(fees);
  const net = round2(gross - feeValue);
  const instapayValue = round2(instapay);
  const cardValue = round2(card);
  const cash = round2(net - instapayValue - cardValue);
  const needsShift = cash > 0;
  const shiftOptions = shifts.map((shift) => ({ value: String(shift.id), label: `${shift.cashier_name}${shift.branch_name ? ` — ${shift.branch_name}` : ""} · ${fmtDate(shift.opened_at)}` }));

  const submit = async (event) => {
    event.preventDefault();
    if (!selectedRows.length) return toast.error(t("shipping.settlements.local.settle.noSelection"));
    if (cash < 0) return toast.error(t("shipping.settlements.local.settle.paymentsExceed"));
    if (needsShift && !shiftId) return toast.error(t("shipping.settlements.local.settle.noShift"));
    setSaving(true);
    try {
      const result = await api.post("/shipping/local-courier/settlements", { order_ids: selectedRows.map((row) => row.id), fees_amount: feeValue, shift_id: needsShift ? Number(shiftId) : null, payments: { cash, instapay: instapayValue, card: cardValue }, notes });
      toast.success(t("shipping.settlements.local.settle.done", { net: fmtMoney(result?.settlement?.net_amount) }));
      setFees("");
      setInstapay("");
      setCard("");
      setNotes("");
      await load();
      onSettled();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_22rem]">
      <section className={cardClass}>
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-black">{t("shipping.settlements.local.collections.title")}</h2>
          <div className="text-sm font-black text-sky-200">{t("shipping.settlements.local.collections.withCourier", { amount: fmtMoney(summary.pending_amount), count: Number(summary.pending_count || 0) })}</div>
        </div>
        {loading ? <div className="grid h-40 place-items-center"><Loader2 className="h-6 w-6 animate-spin" /></div> : (
          <div className="overflow-auto rounded-2xl border border-[var(--border)]">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-[var(--table-head)] text-xs uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
                <tr>
                  <th className="w-10 px-3 py-3"><input type="checkbox" checked={Boolean(rows.length) && selected.size === rows.length} onChange={() => setSelected(selected.size === rows.length ? new Set() : new Set(rows.map((row) => row.id)))} aria-label={t("shipping.settlements.selectAll")} /></th>
                  <th className="px-3 py-3 text-start font-black">{t("shipping.settlements.table.order")}</th>
                  <th className="px-3 py-3 text-start font-black">{t("shipping.settlements.table.customer")}</th>
                  <th className="px-3 py-3 text-start font-black">{t("shipping.settlements.local.collections.deliveredAt")}</th>
                  <th className="px-3 py-3 text-start font-black">{t("shipping.settlements.table.collected")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} onClick={() => toggle(row.id)} className={`cursor-pointer border-t border-[var(--border)] hover:bg-[var(--table-hover)] ${selected.has(row.id) ? "bg-emerald-400/10" : ""}`}>
                    <td className="px-3 py-3" onClick={(event) => event.stopPropagation()}><input type="checkbox" checked={selected.has(row.id)} onChange={() => toggle(row.id)} /></td>
                    <td className="px-3 py-3 font-black"><Link to={`/orders/${row.id}`} className="hover:text-emerald-300" onClick={(event) => event.stopPropagation()}>{row.order_number}</Link></td>
                    <td className="px-3 py-3"><div className="font-bold">{row.customer_name || "-"}</div><div className="text-xs text-[var(--muted)]" dir="ltr">{row.customer_phone || ""}</div></td>
                    <td className="px-3 py-3 text-xs text-[var(--muted)]">{fmtDate(row.courier_collected_at)}</td>
                    <td className="px-3 py-3 font-black text-amber-100">{fmtMoney(row.collected_amount)}</td>
                  </tr>
                ))}
                {!rows.length ? <tr><td colSpan={5} className="px-4 py-12 text-center text-sm font-bold text-[var(--text-tertiary)]">{t("shipping.settlements.local.collections.empty")}</td></tr> : null}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <form onSubmit={submit} className={`${cardClass} h-fit space-y-3`}>
        <div className="flex items-center gap-2 text-base font-black"><Banknote className="h-5 w-5 text-emerald-300" /> {t("shipping.settlements.local.settle.title")}</div>
        <p className="text-xs font-semibold leading-5 text-[var(--muted)]">{t("shipping.settlements.local.settle.hint")}</p>
        <div className={labelClass}>{t("shipping.settlements.local.settle.gross", { count: selectedRows.length })}
          <div className="mt-1 rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--card-soft)] px-3 py-2 text-lg font-black text-amber-100">{fmtMoney(gross)}</div>
        </div>
        <label className={labelClass}>{t("shipping.settlements.local.settle.fees")}
          <input type="number" min="0" step="0.01" value={fees} placeholder={defaultFees.toFixed(2)} onChange={(event) => setFees(event.target.value)} className={`${inputClass} mt-1`} />
          <div className="mt-1 text-xs font-bold text-[var(--muted)]">{t("shipping.settlements.local.settle.feesHint", { fee: fmtMoney(settings.fee_per_order) })}</div>
        </label>
        <div className={labelClass}>{t("shipping.settlements.local.settle.net")}
          <div className={`mt-1 rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--card-soft)] px-3 py-2 text-lg font-black ${net < 0 ? "text-rose-300" : "text-emerald-200"}`}>{fmtMoney(net)}</div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className={labelClass}>{t("shipping.settlements.local.settle.instapay")}
            <input type="number" min="0" step="0.01" value={instapay} placeholder="0" onChange={(event) => setInstapay(event.target.value)} className={`${inputClass} mt-1`} />
          </label>
          <label className={labelClass}>{t("shipping.settlements.local.settle.card")}
            <input type="number" min="0" step="0.01" value={card} placeholder="0" onChange={(event) => setCard(event.target.value)} className={`${inputClass} mt-1`} />
          </label>
        </div>
        <div className={labelClass}>{t("shipping.settlements.local.settle.cash")}
          <div className={`mt-1 rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--card-soft)] px-3 py-2 text-lg font-black ${cash < 0 ? "text-rose-300" : "text-amber-100"}`}>{fmtMoney(cash)}</div>
        </div>
        {needsShift ? (<div className={labelClass}>{t("shipping.settlements.local.settle.shift")}
          {shifts.length ? (
            <div className="mt-1"><ThemedSelect value={shiftId} onChange={setShiftId} options={shiftOptions} placeholder={t("shipping.settlements.local.settle.shiftPlaceholder")} ariaLabel={t("shipping.settlements.local.settle.shift")} triggerClassName={inputClass} /></div>
          ) : (
            <div className="mt-1 rounded-[var(--radius-control)] border border-rose-400/40 bg-rose-500/10 px-3 py-2 text-xs font-bold text-rose-200">{t("shipping.settlements.local.settle.noOpenShift")}</div>
          )}
        </div>) : null}
        <label className={labelClass}>{t("shipping.settlements.form.notes")}
          <textarea rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} className="mt-1 w-full rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm font-bold text-[var(--text)] outline-none focus:border-emerald-300/50" />
        </label>
        <button type="submit" disabled={saving || !selectedRows.length || (needsShift && !shiftId) || net < 0 || cash < 0} className={`${primaryButton} w-full`}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Banknote className="h-4 w-4" />} {t("shipping.settlements.local.settle.submit")}
        </button>
      </form>
    </div>
  );
}

function BacklogSection({ onClosed }) {
  const { t } = useTranslation();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [damiettaOnly, setDamiettaOnly] = useState(true);
  const { selected, setSelected, toggle } = useSelection();
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.get("/shipping/local-courier/backlog");
      setRows(Array.isArray(response?.rows) ? response.rows : []);
      setSelected(new Set());
    } catch (error) {
      toast.error(error.message);
    } finally {
      setLoading(false);
    }
  }, [setSelected]);
  useEffect(() => { load(); }, [load]);

  const visible = useMemo(() => (damiettaOnly ? rows.filter((row) => row.is_damietta) : rows), [rows, damiettaOnly]);
  const chosen = visible.filter((row) => selected.has(row.id));
  const chosenOwed = round2(chosen.reduce((sum, row) => sum + Number(row.owed || 0), 0));

  const closeChosen = async () => {
    if (!chosen.length) return;
    if (!window.confirm(t("shipping.settlements.local.backlog.confirm", { count: chosen.length, amount: fmtMoney(chosenOwed) }))) return;
    setSaving(true);
    try {
      const result = await api.post("/shipping/local-courier/backlog/delivered", { order_ids: chosen.map((row) => row.id) });
      const applied = Array.isArray(result?.applied) ? result.applied.length : 0;
      const skipped = Array.isArray(result?.skipped) ? result.skipped.length : 0;
      toast.success(t("shipping.settlements.local.backlog.done", { count: applied }) + (skipped ? ` — ${t("shipping.settlements.local.backlog.skipped", { count: skipped })}` : ""));
      await load();
      onClosed();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className={cardClass}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-black">{t("shipping.settlements.local.backlog.title")}</h2>
          <p className="mt-1 text-xs font-semibold leading-5 text-[var(--muted)]">{t("shipping.settlements.local.backlog.hint")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex items-center gap-2 text-sm font-bold"><input type="checkbox" checked={damiettaOnly} onChange={(event) => setDamiettaOnly(event.target.checked)} /> {t("shipping.settlements.local.backlog.damiettaOnly")}</label>
          <button type="button" onClick={closeChosen} disabled={saving || !chosen.length} className={primaryButton}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCheck className="h-4 w-4" />} {t("shipping.settlements.local.backlog.submit", { count: chosen.length })}
          </button>
        </div>
      </div>
      {loading ? <div className="grid h-40 place-items-center"><Loader2 className="h-6 w-6 animate-spin" /></div> : (
        <div className="overflow-auto rounded-2xl border border-[var(--border)]">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-[var(--table-head)] text-xs uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
              <tr>
                <th className="w-10 px-3 py-3"><input type="checkbox" checked={Boolean(visible.length) && chosen.length === visible.length} onChange={() => setSelected(chosen.length === visible.length ? new Set() : new Set(visible.map((row) => row.id)))} aria-label={t("shipping.settlements.selectAll")} /></th>
                <th className="px-3 py-3 text-start font-black">{t("shipping.settlements.table.order")}</th>
                <th className="px-3 py-3 text-start font-black">{t("shipping.settlements.table.customer")}</th>
                <th className="px-3 py-3 text-start font-black">{t("shipping.settlements.local.backlog.address")}</th>
                <th className="px-3 py-3 text-start font-black">{t("shipping.settlements.local.backlog.createdAt")}</th>
                <th className="px-3 py-3 text-start font-black">{t("shipping.settlements.local.backlog.owed")}</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr key={row.id} onClick={() => toggle(row.id)} className={`cursor-pointer border-t border-[var(--border)] hover:bg-[var(--table-hover)] ${selected.has(row.id) ? "bg-emerald-400/10" : ""}`}>
                  <td className="px-3 py-3" onClick={(event) => event.stopPropagation()}><input type="checkbox" checked={selected.has(row.id)} onChange={() => toggle(row.id)} /></td>
                  <td className="px-3 py-3 font-black"><Link to={`/orders/${row.id}`} className="hover:text-emerald-300" onClick={(event) => event.stopPropagation()}>{row.order_number}</Link></td>
                  <td className="px-3 py-3"><div className="font-bold">{row.customer_name || "-"}</div><div className="text-xs text-[var(--muted)]" dir="ltr">{row.customer_phone || ""}</div></td>
                  <td className="max-w-[18rem] px-3 py-3 text-xs"><div className="font-bold">{row.governorate || "-"}</div><div className="line-clamp-2 text-[var(--muted)]">{row.address || ""}</div></td>
                  <td className="px-3 py-3 text-xs text-[var(--muted)]">{fmtDate(row.created_at)}</td>
                  <td className="px-3 py-3 font-black text-amber-100">{fmtMoney(row.owed)}</td>
                </tr>
              ))}
              {!visible.length ? <tr><td colSpan={6} className="px-4 py-12 text-center text-sm font-bold text-[var(--text-tertiary)]">{t("shipping.settlements.local.backlog.empty")}</td></tr> : null}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function HistorySection({ refreshKey }) {
  const { t } = useTranslation();
  const [rows, setRows] = useState([]);
  useEffect(() => {
    api.get("/shipping/settlements", { params: { provider: PROVIDER } })
      .then((response) => setRows(Array.isArray(response?.settlements) ? response.settlements : []))
      .catch(() => setRows([]));
  }, [refreshKey]);
  if (!rows.length) return null;
  return (
    <section className={cardClass}>
      <h2 className="mb-3 text-base font-black">{t("shipping.settlements.local.history.title")}</h2>
      <div className="overflow-auto rounded-2xl border border-[var(--border)]">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-[var(--table-head)] text-xs uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
            <tr>
              <th className="px-3 py-3 text-start font-black">#</th>
              <th className="px-3 py-3 text-start font-black">{t("shipping.settlements.history.date")}</th>
              <th className="px-3 py-3 text-start font-black">{t("shipping.settlements.history.orders")}</th>
              <th className="px-3 py-3 text-start font-black">{t("shipping.settlements.history.gross")}</th>
              <th className="px-3 py-3 text-start font-black">{t("shipping.settlements.local.history.fee")}</th>
              <th className="px-3 py-3 text-start font-black">{t("shipping.settlements.local.history.drawer")}</th>
              <th className="px-3 py-3 text-start font-black">{t("shipping.settlements.history.by")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-[var(--border)]">
                <td className="px-3 py-3 font-black">#{row.id}</td>
                <td className="px-3 py-3 text-xs text-[var(--muted)]">{fmtDate(row.settled_at)}</td>
                <td className="px-3 py-3">{row.orders_count}</td>
                <td className="px-3 py-3 font-bold">{fmtMoney(row.gross_amount)}</td>
                <td className="px-3 py-3 text-orange-200">{fmtMoney(row.fees_amount)}</td>
                <td className="px-3 py-3"><div className="font-black text-emerald-200">{fmtMoney(row.net_amount)}</div>{row.payment_breakdown ? <div className="text-[11px] font-bold text-[var(--muted)]">{["cash", "instapay", "card"].filter((method) => Number(row.payment_breakdown[method]) > 0).map((method) => `${t(`shipping.settlements.local.settle.${method}`)} ${fmtMoney(row.payment_breakdown[method])}`).join(" · ")}</div> : null}</td>
                <td className="px-3 py-3 text-xs text-[var(--muted)]">{row.created_by_name || "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function LocalCourierPanel() {
  const { t } = useTranslation();
  const [settings, setSettings] = useState({ courier_name: "", courier_phone: "", fee_per_order: 0 });
  const [shifts, setShifts] = useState([]);
  const [refreshKey, setRefreshKey] = useState(0);
  useEffect(() => {
    api.get("/shipping/local-courier/settings").then((response) => {
      setSettings(response?.settings || {});
      setShifts(Array.isArray(response?.open_shifts) ? response.open_shifts : []);
    }).catch((error) => toast.error(error.message));
  }, [refreshKey]);
  const bump = () => setRefreshKey((key) => key + 1);
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 text-sm font-bold text-[var(--muted)]"><Bike className="h-5 w-5 text-emerald-300" /> {t("shipping.settlements.local.intro")}</div>
      <SettingsCard settings={settings} onSaved={setSettings} />
      <CollectionsSection settings={settings} shifts={shifts} onSettled={bump} refreshKey={refreshKey} />
      <BacklogSection onClosed={bump} />
      <HistorySection refreshKey={refreshKey} />
    </div>
  );
}
