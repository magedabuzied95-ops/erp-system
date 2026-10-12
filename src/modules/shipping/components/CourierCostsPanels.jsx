import { dateKeyInAppTimezone } from "../../../shared/lib/appTimezone";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Ban, Boxes, Calculator, Crosshair, Loader2, PackagePlus, RefreshCw, Save, Search } from "lucide-react";
import toast from "react-hot-toast";
import { api } from "../../../shared/api/api";
import ThemedSelect from "../../../shared/ui/ThemedSelect";

// Every pound Bosta takes, next to the settlements: the prepaid packages each shipment
// draws from, and what each shipment really cost against what the customer paid for it.

const fmtMoney = (value) => `${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ج.م`;
const fmtDay = (value) => (value ? new Date(value).toLocaleDateString() : "-");
const cardClass = "rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-4";
const inputClass = "h-[var(--control-height-md)] w-full rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--card)] px-3 text-sm font-bold text-[var(--text)] outline-none focus:border-emerald-300/50";
const panelClass = "rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-2xl shadow-[var(--shadow)]";
const thClass = "px-3 py-3 text-start font-black";

function Stat({ label, value, sub, tone = "" }) {
  return (
    <div className={cardClass}>
      <div className="text-xs font-black text-[var(--text-tertiary)]">{label}</div>
      <div className={`mt-2 text-xl font-black ${tone}`}>{value}</div>
      {sub ? <div className="mt-1 text-xs font-bold text-[var(--muted)]">{sub}</div> : null}
    </div>
  );
}

export function CourierPackagesPanel({ provider = "bosta", accounts = [] }) {
  const { t } = useTranslation();
  const [data, setData] = useState({ packages: [], summary: {}, settings: {} });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ price: "", count: "", purchasedAt: dateKeyInAppTimezone(new Date()), accountId: "", reference: "", notes: "" });
  const [settings, setSettings] = useState({ min: "", fee: "" });
  const [savingSettings, setSavingSettings] = useState(false);
  const [renew, setRenew] = useState({ enabled: false, price: "", shipments: "", accountId: "", since: "" });
  const [savingRenew, setSavingRenew] = useState(false);
  const [calibrateUsed, setCalibrateUsed] = useState("");
  const [calibrating, setCalibrating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.get("/shipping/courier-costs/packages", { params: { provider } });
      setData({ packages: response?.packages || [], summary: response?.summary || {}, settings: response?.settings || {} });
      setSettings({ min: String(response?.settings?.pickup_min_parcels ?? ""), fee: String(response?.settings?.pickup_small_fee ?? "") });
      const saved = response?.settings || {};
      // Unset fields start from the last package entered by hand — usually the same deal.
      const lastPackage = (response?.packages || []).find((pkg) => !pkg.voided_at);
      setRenew({
        enabled: Boolean(saved.auto_renew_enabled),
        price: String(saved.auto_renew_price ?? lastPackage?.price ?? ""),
        shipments: String(saved.auto_renew_shipments ?? lastPackage?.shipments_count ?? ""),
        accountId: saved.auto_renew_account_id ? String(saved.auto_renew_account_id) : (lastPackage?.money_account_id ? String(lastPackage.money_account_id) : ""),
        since: saved.auto_renew_since ? dateKeyInAppTimezone(new Date(saved.auto_renew_since)) : dateKeyInAppTimezone(new Date()),
      });
    } catch (error) {
      toast.error(error.message);
    } finally {
      setLoading(false);
    }
  }, [provider]);
  useEffect(() => { load(); }, [load]);

  const unit = Number(form.price) > 0 && Number(form.count) > 0 ? Number(form.price) / Number(form.count) : 0;

  const submit = async (event) => {
    event.preventDefault();
    if (!(Number(form.price) > 0) || !(Number(form.count) > 0)) return toast.error(t("shipping.settlements.packages.form.invalid"));
    setSaving(true);
    try {
      const result = await api.post("/shipping/courier-costs/packages", {
        provider,
        price: Number(form.price),
        shipments_count: Number(form.count),
        purchased_at: form.purchasedAt ? new Date(`${form.purchasedAt}T12:00:00`).toISOString() : null,
        money_account_id: form.accountId || null,
        reference: form.reference,
        notes: form.notes,
      });
      toast.success(t("shipping.settlements.packages.form.success", { count: Number(result?.reconcile?.assigned || 0) }));
      setForm((prev) => ({ ...prev, price: "", count: "", reference: "", notes: "" }));
      await load();
    } catch (error) {
      toast.error(error.message || t("shipping.settlements.packages.form.failed"));
    } finally {
      setSaving(false);
    }
  };

  const voidPackage = async (pkg) => {
    if (!window.confirm(t("shipping.settlements.packages.voidConfirm", { id: pkg.id }))) return;
    try {
      await api.post(`/shipping/courier-costs/packages/${pkg.id}/void`, {});
      toast.success(t("shipping.settlements.packages.voided"));
      await load();
    } catch (error) {
      toast.error(error.message);
    }
  };

  const saveSettings = async () => {
    setSavingSettings(true);
    try {
      await api.put("/shipping/courier-costs/settings", { provider, pickup_min_parcels: Number(settings.min), pickup_small_fee: Number(settings.fee) });
      toast.success(t("shipping.settlements.packages.settings.saved"));
      await load();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSavingSettings(false);
    }
  };

  const saveRenew = async (enabled) => {
    if (enabled && (!(Number(renew.price) > 0) || !(Number(renew.shipments) > 0))) return toast.error(t("shipping.settlements.packages.form.invalid"));
    setSavingRenew(true);
    try {
      const result = await api.put("/shipping/courier-costs/settings", {
        provider,
        auto_renew: { enabled, price: Number(renew.price) || null, shipments: Number(renew.shipments) || null, account_id: renew.accountId || null, since: renew.since ? new Date(`${renew.since}T00:00:00`).toISOString() : null },
      });
      const created = Number(result?.settings?.reconcile?.auto_packages || 0);
      toast.success(enabled ? t("shipping.settlements.packages.renew.on", { count: created }) : t("shipping.settlements.packages.renew.off"));
      await load();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSavingRenew(false);
    }
  };

  const currentPackage = data.packages.find((pkg) => !pkg.voided_at && !pkg.closed_at) || null;
  const calibrate = async (event) => {
    event.preventDefault();
    if (calibrateUsed === "" || !currentPackage) return;
    if (!window.confirm(t("shipping.settlements.packages.calibrate.confirm", { used: calibrateUsed, total: currentPackage.shipments_count }))) return;
    setCalibrating(true);
    try {
      await api.post("/shipping/courier-costs/packages/calibrate", { provider, used: Number(calibrateUsed) });
      toast.success(t("shipping.settlements.packages.calibrate.done"));
      setCalibrateUsed("");
      await load();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setCalibrating(false);
    }
  };

  const summary = data.summary || {};
  const accountOptions = useMemo(() => [{ value: "", label: t("shipping.settlements.form.accountAuto") }, ...accounts.map((account) => ({ value: String(account.id), label: `${account.name}${account.branch_name ? ` — ${account.branch_name}` : ""}` }))], [accounts, t]);

  return (
    <div className="space-y-5">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label={t("shipping.settlements.packages.kpi.remaining")} value={t("shipping.settlements.packages.kpi.shipments", { count: Number(summary.remaining_shipments || 0) })} sub={fmtMoney(summary.remaining_value)} tone={Number(summary.remaining_shipments || 0) <= 3 ? "text-rose-300" : "text-emerald-200"} />
        <Stat label={t("shipping.settlements.packages.kpi.unit")} value={summary.current_unit_cost === null || summary.current_unit_cost === undefined ? "-" : fmtMoney(summary.current_unit_cost)} sub={t("shipping.settlements.packages.kpi.unitHint")} />
        <Stat label={t("shipping.settlements.packages.kpi.uncovered")} value={Number(summary.uncovered_shipments || 0)} sub={summary.uncovered_since ? t("shipping.settlements.packages.kpi.uncoveredHint", { date: fmtDay(summary.uncovered_since) }) : t("shipping.settlements.packages.kpi.noPackages")} tone={Number(summary.uncovered_shipments || 0) ? "text-amber-200" : ""} />
        <div className={cardClass}>
          <div className="text-xs font-black text-[var(--text-tertiary)]">{t("shipping.settlements.packages.settings.title")}</div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <label className="block text-[11px] font-black text-[var(--text-tertiary)]">{t("shipping.settlements.packages.settings.min")}
              <input type="number" min="0" step="1" value={settings.min} onChange={(event) => setSettings((prev) => ({ ...prev, min: event.target.value }))} className={`${inputClass} mt-1`} />
            </label>
            <label className="block text-[11px] font-black text-[var(--text-tertiary)]">{t("shipping.settlements.packages.settings.fee")}
              <input type="number" min="0" step="0.01" value={settings.fee} onChange={(event) => setSettings((prev) => ({ ...prev, fee: event.target.value }))} className={`${inputClass} mt-1`} />
            </label>
          </div>
          <button type="button" onClick={saveSettings} disabled={savingSettings} className="mt-2 inline-flex items-center gap-2 rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--card)] px-3 py-1.5 text-xs font-black hover:bg-[var(--table-hover)] disabled:opacity-60">
            {savingSettings ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} {t("shipping.settlements.packages.settings.save")}
          </button>
        </div>
      </section>

      {currentPackage ? (
        <form onSubmit={calibrate} className={`${cardClass} flex flex-wrap items-end justify-between gap-3`}>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-base font-black"><Crosshair className="h-5 w-5 text-emerald-300" /> {t("shipping.settlements.packages.calibrate.title")}</div>
            <p className="mt-1 text-xs font-semibold leading-5 text-[var(--muted)]">{t("shipping.settlements.packages.calibrate.hint", { id: currentPackage.id, used: currentPackage.used, total: currentPackage.shipments_count })}</p>
          </div>
          <label className="block w-44 text-xs font-black text-[var(--text-tertiary)]">{t("shipping.settlements.packages.calibrate.used", { total: currentPackage.shipments_count })}
            <input type="number" min="0" max={currentPackage.shipments_count} step="1" value={calibrateUsed} onChange={(event) => setCalibrateUsed(event.target.value)} className={`${inputClass} mt-1`} placeholder={String(currentPackage.used)} />
          </label>
          <button type="submit" disabled={calibrating || calibrateUsed === ""} className="inline-flex items-center gap-2 rounded-[var(--radius-control)] bg-primary px-4 py-2 text-sm font-black text-[var(--primary-contrast)] disabled:opacity-50">
            {calibrating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Crosshair className="h-4 w-4" />} {t("shipping.settlements.packages.calibrate.submit")}
          </button>
        </form>
      ) : null}

      <section className={`${cardClass} space-y-3`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-base font-black"><RefreshCw className="h-5 w-5 text-emerald-300" /> {t("shipping.settlements.packages.renew.title")}</div>
            <p className="mt-1 text-xs font-semibold leading-5 text-[var(--muted)]">{t("shipping.settlements.packages.renew.hint")}</p>
          </div>
          <span className={`rounded-full px-3 py-1 text-xs font-black ${renew.enabled ? "bg-emerald-400/15 text-emerald-200" : "border border-[var(--border)] text-[var(--muted)]"}`}>{renew.enabled ? t("shipping.settlements.packages.renew.statusOn") : t("shipping.settlements.packages.renew.statusOff")}</span>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <label className="block text-xs font-black text-[var(--text-tertiary)]">{t("shipping.settlements.packages.form.price")}
            <input type="number" min="0" step="0.01" value={renew.price} onChange={(event) => setRenew((prev) => ({ ...prev, price: event.target.value }))} className={`${inputClass} mt-1`} placeholder="2000" />
          </label>
          <label className="block text-xs font-black text-[var(--text-tertiary)]">{t("shipping.settlements.packages.form.count")}
            <input type="number" min="1" step="1" value={renew.shipments} onChange={(event) => setRenew((prev) => ({ ...prev, shipments: event.target.value }))} className={`${inputClass} mt-1`} placeholder="20" />
          </label>
          <label className="block text-xs font-black text-[var(--text-tertiary)]">{t("shipping.settlements.packages.form.account")}
            <div className="mt-1"><ThemedSelect value={renew.accountId} onChange={(value) => setRenew((prev) => ({ ...prev, accountId: value }))} options={accountOptions} ariaLabel={t("shipping.settlements.packages.form.account")} triggerClassName={inputClass} /></div>
          </label>
          <label className="block text-xs font-black text-[var(--text-tertiary)]">{t("shipping.settlements.packages.renew.since")}
            <input type="date" value={renew.since} onChange={(event) => setRenew((prev) => ({ ...prev, since: event.target.value }))} className={`${inputClass} mt-1`} />
          </label>
        </div>
        <p className="text-xs font-semibold text-[var(--muted)]">{t("shipping.settlements.packages.renew.sinceHint")}</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => saveRenew(true)} disabled={savingRenew} className="inline-flex items-center gap-2 rounded-[var(--radius-control)] bg-primary px-4 py-2 text-sm font-black text-[var(--primary-contrast)] disabled:opacity-50">
            {savingRenew ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} {renew.enabled ? t("shipping.settlements.packages.renew.update") : t("shipping.settlements.packages.renew.enable")}
          </button>
          {renew.enabled ? <button type="button" onClick={() => saveRenew(false)} disabled={savingRenew} className="inline-flex items-center gap-2 rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--card)] px-4 py-2 text-sm font-black hover:bg-[var(--table-hover)] disabled:opacity-50">{t("shipping.settlements.packages.renew.disable")}</button> : null}
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <section className={panelClass}>
          <div className="mb-3 flex items-center gap-2 text-base font-black"><Boxes className="h-5 w-5 text-emerald-300" /> {t("shipping.settlements.packages.title")}</div>
          {loading ? <div className="grid h-48 place-items-center"><Loader2 className="h-7 w-7 animate-spin" /></div> : (
            <div className="overflow-auto rounded-2xl border border-[var(--border)]">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="bg-[var(--table-head)] text-xs text-[var(--text-tertiary)]">
                  <tr>
                    <th className={thClass}>#</th>
                    <th className={thClass}>{t("shipping.settlements.packages.table.date")}</th>
                    <th className={thClass}>{t("shipping.settlements.packages.table.price")}</th>
                    <th className={thClass}>{t("shipping.settlements.packages.table.unit")}</th>
                    <th className={thClass}>{t("shipping.settlements.packages.table.usage")}</th>
                    <th className={thClass}>{t("shipping.settlements.packages.table.remaining")}</th>
                    <th className={thClass}>{t("shipping.settlements.history.account")}</th>
                    <th className="px-3 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {data.packages.map((pkg) => {
                    const pct = Math.min(100, Math.round((Number(pkg.used) / Math.max(1, Number(pkg.shipments_count))) * 100));
                    return (
                      <tr key={pkg.id} className={`border-t border-[var(--border)] ${pkg.voided_at ? "opacity-50" : ""}`}>
                        <td className="px-3 py-3 font-black">#{pkg.id}{pkg.source === "auto" ? <div className="mt-1 w-fit rounded-full bg-sky-400/15 px-2 py-0.5 text-[10px] font-black text-sky-200">{t("shipping.settlements.packages.renew.tag")}</div> : null}{pkg.closed_at ? <div className="mt-1 w-fit rounded-full border border-[var(--border)] px-2 py-0.5 text-[10px] font-black text-[var(--muted)]" title={t("shipping.settlements.packages.calibrate.closedHint")}>{t("shipping.settlements.packages.calibrate.closedTag")}</div> : null}</td>
                        <td className="px-3 py-3 text-xs"><div className="font-bold">{fmtDay(pkg.purchased_at)}</div>{pkg.reference ? <div className="font-mono text-[var(--muted)]">{pkg.reference}</div> : null}</td>
                        <td className="px-3 py-3 font-bold">{fmtMoney(pkg.price)}</td>
                        <td className="px-3 py-3">{fmtMoney(pkg.unit_cost)}</td>
                        <td className="px-3 py-3">
                          {/* A closed package holds its whole period, so "31 / 20" would read as an overdraft. */}
                          {pkg.closed_at ? (
                            <div className="text-xs font-black">{t("shipping.settlements.packages.calibrate.carried", { count: Number(pkg.used) })}</div>
                          ) : (
                            <>
                              <div className="text-xs font-black">{pkg.used} / {pkg.shipments_count}</div>
                              <div className="mt-1 h-1.5 w-28 overflow-hidden rounded-full bg-[var(--card-soft)]"><div className="h-full rounded-full bg-emerald-400" style={{ width: `${pct}%` }} /></div>
                            </>
                          )}
                        </td>
                        <td className="px-3 py-3 font-black">{pkg.voided_at ? t("shipping.settlements.packages.voidedTag") : `${pkg.remaining} · ${fmtMoney(pkg.remaining_value)}`}</td>
                        <td className="px-3 py-3 text-xs">{pkg.money_account_name || "-"}{pkg.payment_note && !pkg.money_transaction_id ? <div className="mt-1 font-black text-rose-300" title={pkg.payment_note}>{t("shipping.settlements.packages.renew.unpaid")}</div> : null}</td>
                        <td className="px-3 py-3">{!pkg.voided_at ? <button type="button" onClick={() => voidPackage(pkg)} className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--card)] px-2.5 py-1 text-xs font-black text-rose-300 hover:bg-[var(--table-hover)]"><Ban className="h-3.5 w-3.5" /> {t("shipping.settlements.packages.void")}</button> : null}</td>
                      </tr>
                    );
                  })}
                  {!data.packages.length ? <tr><td colSpan={8} className="px-4 py-14 text-center text-sm font-bold text-[var(--text-tertiary)]">{t("shipping.settlements.packages.empty")}</td></tr> : null}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <form onSubmit={submit} className={`h-fit space-y-3 ${panelClass}`}>
          <div className="flex items-center gap-2 text-base font-black"><PackagePlus className="h-5 w-5 text-emerald-300" /> {t("shipping.settlements.packages.form.title")}</div>
          <p className="text-xs font-semibold leading-5 text-[var(--muted)]">{t("shipping.settlements.packages.form.hint")}</p>
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-xs font-black text-[var(--text-tertiary)]">{t("shipping.settlements.packages.form.price")}
              <input type="number" min="0" step="0.01" value={form.price} onChange={(event) => setForm((prev) => ({ ...prev, price: event.target.value }))} className={`${inputClass} mt-1`} placeholder="2000" />
            </label>
            <label className="block text-xs font-black text-[var(--text-tertiary)]">{t("shipping.settlements.packages.form.count")}
              <input type="number" min="1" step="1" value={form.count} onChange={(event) => setForm((prev) => ({ ...prev, count: event.target.value }))} className={`${inputClass} mt-1`} placeholder="20" />
            </label>
          </div>
          {unit > 0 ? <div className="rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--card-soft)] px-3 py-2 text-sm font-black text-amber-100">{t("shipping.settlements.packages.form.unit", { amount: fmtMoney(unit) })}</div> : null}
          <label className="block text-xs font-black text-[var(--text-tertiary)]">{t("shipping.settlements.packages.form.date")}
            <input type="date" value={form.purchasedAt} onChange={(event) => setForm((prev) => ({ ...prev, purchasedAt: event.target.value }))} className={`${inputClass} mt-1`} />
          </label>
          <label className="block text-xs font-black text-[var(--text-tertiary)]">{t("shipping.settlements.packages.form.account")}
            <div className="mt-1"><ThemedSelect value={form.accountId} onChange={(value) => setForm((prev) => ({ ...prev, accountId: value }))} options={accountOptions} ariaLabel={t("shipping.settlements.packages.form.account")} triggerClassName={inputClass} /></div>
          </label>
          <label className="block text-xs font-black text-[var(--text-tertiary)]">{t("shipping.settlements.form.reference")}
            <input value={form.reference} onChange={(event) => setForm((prev) => ({ ...prev, reference: event.target.value }))} className={`${inputClass} mt-1`} />
          </label>
          <label className="block text-xs font-black text-[var(--text-tertiary)]">{t("shipping.settlements.form.notes")}
            <textarea rows={2} value={form.notes} onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))} className="mt-1 w-full rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm font-bold text-[var(--text)] outline-none focus:border-emerald-300/50" />
          </label>
          <button type="submit" disabled={saving} className="inline-flex w-full items-center justify-center gap-2 rounded-[var(--radius-control)] bg-primary px-4 py-2.5 text-sm font-black text-[var(--primary-contrast)] disabled:opacity-50">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackagePlus className="h-4 w-4" />} {t("shipping.settlements.packages.form.submit")}
          </button>
        </form>
      </div>
    </div>
  );
}

export function CourierCostsPanel({ provider = "bosta" }) {
  const { t } = useTranslation();
  const [filters, setFilters] = useState(() => {
    const today = dateKeyInAppTimezone(new Date());
    return { search: "", dateFrom: `${today.slice(0, 8)}01`, dateTo: today };
  });
  const [data, setData] = useState({ rows: [], summary: {}, pickups: [] });
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.get("/shipping/courier-costs/report", { params: { provider, search: filters.search, date_from: filters.dateFrom, date_to: filters.dateTo } });
      setData({ rows: response?.rows || [], summary: response?.summary || {}, pickups: response?.pickups || [] });
    } catch (error) {
      toast.error(error.message);
    } finally {
      setLoading(false);
    }
  }, [provider, filters.search, filters.dateFrom, filters.dateTo]);
  useEffect(() => { load(); }, [load]);

  const summary = data.summary || {};
  const settlements = summary.settlements || {};
  const smallPickups = data.pickups.filter((day) => Number(day.fee) > 0);

  return (
    <div className="space-y-5">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label={t("shipping.settlements.costs.kpi.total")} value={fmtMoney(summary.total_cost)} sub={t("shipping.settlements.costs.kpi.totalSub", { count: Number(summary.shipments || 0), avg: fmtMoney(summary.average_cost) })} tone="text-orange-200" />
        <Stat label={t("shipping.settlements.costs.kpi.package")} value={fmtMoney(summary.package_cost)} sub={Number(summary.uncovered_shipments || 0) ? t("shipping.settlements.costs.kpi.uncovered", { count: Number(summary.uncovered_shipments) }) : t("shipping.settlements.costs.kpi.packageSub")} />
        <Stat label={t("shipping.settlements.costs.kpi.fees")} value={fmtMoney(summary.bosta_fees)} sub={t("shipping.settlements.costs.kpi.pickups", { count: Number(summary.small_pickups || 0), amount: fmtMoney(summary.pickup_fees_estimate) })} />
        <Stat label={t("shipping.settlements.costs.kpi.margin")} value={fmtMoney(summary.shipping_margin)} sub={t("shipping.settlements.costs.kpi.charged", { amount: fmtMoney(summary.shipping_charged) })} tone={Number(summary.shipping_margin || 0) < 0 ? "text-rose-300" : "text-emerald-200"} />
      </section>

      {settlements.count ? (
        <section className={`${cardClass} flex flex-wrap items-center justify-between gap-3`}>
          <div>
            <div className="text-xs font-black text-[var(--text-tertiary)]">{t("shipping.settlements.costs.reconcile.title")}</div>
            <p className="mt-1 text-xs font-semibold text-[var(--muted)]">{t("shipping.settlements.costs.reconcile.hint", { count: settlements.count, fees: fmtMoney(settlements.fees), expected: fmtMoney(settlements.expected) })}</p>
          </div>
          <div className={`text-xl font-black ${Math.abs(Number(settlements.difference || 0)) > 0.009 ? "text-rose-300" : "text-emerald-200"}`}>{t("shipping.settlements.costs.reconcile.difference")}: {fmtMoney(settlements.difference)}</div>
        </section>
      ) : null}

      <section className={panelClass}>
        <div className="mb-4 grid gap-2 md:grid-cols-4">
          <div className="relative md:col-span-2">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-tertiary)]" />
            <input value={filters.search} onChange={(event) => setFilters((prev) => ({ ...prev, search: event.target.value }))} placeholder={t("shipping.settlements.filters.search")} className={`${inputClass} pl-9`} />
          </div>
          <input type="date" value={filters.dateFrom} onChange={(event) => setFilters((prev) => ({ ...prev, dateFrom: event.target.value }))} className={inputClass} aria-label={t("shipping.settlements.filters.from")} />
          <input type="date" value={filters.dateTo} onChange={(event) => setFilters((prev) => ({ ...prev, dateTo: event.target.value }))} className={inputClass} aria-label={t("shipping.settlements.filters.to")} />
        </div>
        {loading ? <div className="grid h-64 place-items-center"><Loader2 className="h-8 w-8 animate-spin" /></div> : (
          <div className="overflow-auto rounded-2xl border border-[var(--border)]">
            <table className="w-full min-w-[980px] text-sm">
              <thead className="sticky top-0 z-10 bg-[var(--table-head)] text-xs text-[var(--text-tertiary)]">
                <tr>
                  <th className={thClass}>{t("shipping.settlements.table.order")}</th>
                  <th className={thClass}>{t("shipping.settlements.table.customer")}</th>
                  <th className={thClass}>{t("shipping.settlements.costs.table.shipped")}</th>
                  <th className={thClass}>{t("shipping.settlements.costs.table.package")}</th>
                  <th className={thClass}>{t("shipping.settlements.costs.table.fees")}</th>
                  <th className={thClass}>{t("shipping.settlements.costs.table.pickup")}</th>
                  <th className={thClass}>{t("shipping.settlements.costs.table.total")}</th>
                  <th className={thClass}>{t("shipping.settlements.costs.table.charged")}</th>
                  <th className={thClass}>{t("shipping.settlements.costs.table.margin")}</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => (
                  <tr key={row.id} className={`border-t border-[var(--border)] ${row.cancelled ? "opacity-50" : ""}`}>
                    <td className="px-3 py-3 font-black"><Link to={`/orders/${row.id}`} className="hover:text-emerald-300">{row.order_number}</Link><div className="font-mono text-[11px] font-bold text-primary">{row.tracking_number}</div></td>
                    <td className="px-3 py-3"><div className="font-bold">{row.customer_name || "-"}</div><div className="text-xs text-[var(--muted)]" dir="ltr">{row.customer_phone || ""}</div></td>
                    <td className="px-3 py-3 text-xs text-[var(--muted)]">{fmtDay(row.shipped_at)}{row.cancelled ? <div className="font-black text-rose-300">{t("shipping.settlements.costs.table.cancelled")}</div> : null}</td>
                    <td className="px-3 py-3">{row.package_cost === null ? <span className="text-xs font-black text-amber-200">{t("shipping.settlements.costs.table.noPackage")}</span> : fmtMoney(row.package_cost)}</td>
                    <td className="px-3 py-3 text-orange-200">{fmtMoney(row.fees_source === "settled" ? row.fees_total : row.bosta_fees)}<div className="text-[11px] font-bold text-[var(--muted)]">{row.fees_source === "settled" ? t("shipping.settlements.costs.table.settled") : t("shipping.settlements.costs.table.estimate")}</div></td>
                    <td className="px-3 py-3 text-xs">{row.pickup_fee_share > 0 ? <span className={`font-black ${row.fees_source === "settled" ? "text-[var(--muted)]" : "text-rose-300"}`}>{fmtMoney(row.pickup_fee_share)}</span> : "-"}{row.pickup_fee_share > 0 && row.fees_source === "settled" ? <div className="text-[11px] font-bold text-[var(--muted)]">{t("shipping.settlements.costs.table.insideSettled")}</div> : null}{row.pickup_parcels ? <div className="text-[11px] text-[var(--muted)]">{t("shipping.settlements.costs.table.pickupParcels", { count: row.pickup_parcels })}</div> : null}</td>
                    <td className="px-3 py-3 font-black">{fmtMoney(row.total_cost)}</td>
                    <td className="px-3 py-3">{fmtMoney(row.shipping_charged)}</td>
                    <td className={`px-3 py-3 font-black ${row.shipping_margin === null ? "" : row.shipping_margin < 0 ? "text-rose-300" : "text-emerald-200"}`}>{row.shipping_margin === null ? "-" : fmtMoney(row.shipping_margin)}</td>
                  </tr>
                ))}
                {!data.rows.length ? <tr><td colSpan={9} className="px-4 py-16 text-center text-sm font-bold text-[var(--text-tertiary)]">{t("shipping.settlements.table.empty")}</td></tr> : null}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {smallPickups.length ? (
        <section className={panelClass}>
          <div className="mb-2 flex items-center gap-2 text-base font-black"><Calculator className="h-5 w-5 text-rose-300" /> {t("shipping.settlements.costs.pickups.title")}</div>
          <p className="mb-3 text-xs font-semibold text-[var(--muted)]">{t("shipping.settlements.costs.pickups.hint")}</p>
          <div className="flex flex-wrap gap-2">
            {smallPickups.map((day) => (
              <span key={day.day} className="rounded-full border border-[var(--border)] bg-[var(--card)] px-3 py-1 text-xs font-black">{day.day} · {t("shipping.settlements.costs.table.pickupParcels", { count: day.parcels })} · <span className="text-rose-300">{fmtMoney(day.fee)}</span></span>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
