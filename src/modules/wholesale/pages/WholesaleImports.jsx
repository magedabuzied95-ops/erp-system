import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight, Download, Loader2, Plus, Trash2, Truck } from "lucide-react";
import toast from "react-hot-toast";
import { api } from "../../../shared/api/api";
import ThemedSelect from "../../../shared/ui/ThemedSelect.jsx";

// Wholesale copy only: shipments bought in dollars / yuan, the transfers that paid for them
// (through an agent or as cash dollars), the real cost per piece, FX loss and capital.

const cardClass = "rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-4";
const inputClass = "h-[var(--control-height-md)] w-full min-w-0 rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--card)] px-3 text-sm font-bold text-[var(--text)] outline-none focus:border-[var(--border-strong)]";
const labelClass = "mb-1 block text-xs font-black text-[var(--text-muted)]";
const chipClass = (on) => `rounded-full border px-3 py-1 text-sm font-black ${on ? "border-primary bg-primary text-[var(--primary-contrast)]" : "border-[var(--border)] bg-[var(--card)] text-[var(--text)]"}`;
const primaryButton = "inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] bg-primary px-3 py-2 text-sm font-black text-[var(--primary-contrast)] disabled:opacity-60";
const ghostButton = "inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm font-black text-[var(--text)] disabled:opacity-60";
const CURRENCIES = ["USD", "CNY"];
const CHANNELS = ["agent", "cash_usd"];
const COST_KINDS = ["freight", "customs", "clearance", "local_transport", "agent_fee", "other"];
const money = (value) => Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
const rate = (value) => Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 4 });
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Cairo" });

function Field({ label, children }) {
  return (
    <label className="block min-w-0">
      <span className={labelClass}>{label}</span>
      {children}
    </label>
  );
}

function Stat({ label, value, tone = "" }) {
  return (
    <div className="min-w-0 rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--card)] p-3">
      <div className="truncate text-xs font-black text-[var(--text-muted)]">{label}</div>
      <div className={`mt-1 truncate text-base font-black ${tone || "text-[var(--text)]"}`}>{value}</div>
    </div>
  );
}

const emptyShipment = () => ({
  name: "",
  supplier_name: "",
  currency: "USD",
  booking_rate: "",
  status: "open",
  notes: "",
  ordered_at: today(),
  arrived_at: "",
  purchase_id: null,
  lines: [],
  costs: [],
});

function ProductSearch({ onPick }) {
  const { t } = useTranslation();
  const [term, setTerm] = useState("");
  const [results, setResults] = useState([]);
  useEffect(() => {
    if (!term.trim()) { setResults([]); return undefined; }
    const id = setTimeout(() => {
      api.get("/wholesale/products", { params: { search: term, limit: 8 } }).then((res) => setResults(res.data || [])).catch(() => setResults([]));
    }, 200);
    return () => clearTimeout(id);
  }, [term]);
  return (
    <div className="relative min-w-0 flex-1">
      <input value={term} onChange={(event) => setTerm(event.target.value)} placeholder={t("orders.wholesale.imports.searchProduct")} className={inputClass} />
      {results.length ? (
        <div className="absolute inset-x-0 top-full z-20 mt-1 max-h-64 overflow-auto rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--card)] shadow-lg">
          {results.map((product) => (
            <button
              key={product.id}
              type="button"
              className="block w-full px-3 py-2 text-start text-sm font-bold text-[var(--text)] hover:bg-[var(--surface)]"
              onClick={() => { onPick(product); setTerm(""); setResults([]); }}
            >
              {product.name}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ShipmentEditor({ shipmentId, onBack, onChanged }) {
  const { t } = useTranslation();
  const [form, setForm] = useState(emptyShipment);
  const [detail, setDetail] = useState(null);
  const [purchaseKey, setPurchaseKey] = useState("");
  const [busy, setBusy] = useState("");

  const adopt = (data) => {
    setDetail(data);
    setForm({
      name: data.name,
      supplier_name: data.supplier_name,
      currency: data.currency,
      booking_rate: data.booking_rate || "",
      status: data.status,
      notes: data.notes,
      ordered_at: data.ordered_at ? String(data.ordered_at).slice(0, 10) : "",
      arrived_at: data.arrived_at ? String(data.arrived_at).slice(0, 10) : "",
      purchase_id: data.purchase_id,
      lines: data.lines.map((line) => ({ ...line })),
      costs: data.costs.map((cost) => ({ kind: cost.kind, amount_egp: cost.amount_egp, note: cost.note })),
    });
  };

  useEffect(() => {
    if (!shipmentId) return;
    api.get(`/wholesale/imports/shipments/${shipmentId}`).then((res) => adopt(res.data)).catch((error) => toast.error(error.message));
  }, [shipmentId]);

  const patch = (next) => setForm((current) => ({ ...current, ...next }));
  const patchLine = (index, next) => setForm((current) => ({ ...current, lines: current.lines.map((line, i) => (i === index ? { ...line, ...next } : line)) }));
  const patchCost = (index, next) => setForm((current) => ({ ...current, costs: current.costs.map((cost, i) => (i === index ? { ...cost, ...next } : cost)) }));

  const importPurchase = async () => {
    if (!purchaseKey.trim()) return;
    setBusy("purchase");
    try {
      const res = await api.get("/wholesale/imports/purchase-lines", { params: { purchase: purchaseKey.trim() } });
      const data = res.data;
      setForm((current) => ({
        ...current,
        purchase_id: data.purchase_id,
        supplier_name: current.supplier_name || data.supplier_name,
        name: current.name || data.purchase_number,
        lines: [...current.lines, ...data.lines],
      }));
      setPurchaseKey("");
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy("");
    }
  };

  const save = async () => {
    setBusy("save");
    try {
      const body = { ...form, booking_rate: Number(form.booking_rate) || 0 };
      const res = detail
        ? await api.put(`/wholesale/imports/shipments/${detail.id}`, body)
        : await api.post("/wholesale/imports/shipments", body);
      adopt(res.data);
      toast.success(t("orders.wholesale.imports.saved"));
      onChanged();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy("");
    }
  };

  const applyCost = async () => {
    setBusy("apply");
    try {
      const res = await api.post(`/wholesale/imports/shipments/${detail.id}/apply-cost`);
      adopt(res.data);
      toast.success(t("orders.wholesale.imports.applied", { count: res.data.variants_updated || 0 }));
      onChanged();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy("");
    }
  };

  const remove = async () => {
    if (!window.confirm(t("orders.wholesale.imports.confirmDelete"))) return;
    try {
      await api.delete(`/wholesale/imports/shipments/${detail.id}`);
      onChanged();
      onBack();
    } catch (error) {
      toast.error(error.message);
    }
  };

  const currencyName = t(`orders.wholesale.imports.currency.${form.currency}`);
  const summary = detail?.summary;
  const landedById = new Map((detail?.lines || []).map((line) => [line.id, line.landed_unit]));

  return (
    <div className="space-y-4">
      <button type="button" className={ghostButton} onClick={onBack}>
        <ArrowRight className="h-4 w-4 rtl:rotate-0 ltr:rotate-180" aria-hidden="true" />
        {t("orders.wholesale.imports.back")}
      </button>

      <section className={`${cardClass} grid grid-cols-1 gap-3 sm:grid-cols-2`}>
        <Field label={t("orders.wholesale.imports.name")}>
          <input value={form.name} onChange={(event) => patch({ name: event.target.value })} className={inputClass} />
        </Field>
        <Field label={t("orders.wholesale.imports.supplier")}>
          <input value={form.supplier_name} onChange={(event) => patch({ supplier_name: event.target.value })} className={inputClass} />
        </Field>
        <div className="min-w-0">
          <span className={labelClass}>{t("orders.wholesale.imports.currencyLabel")}</span>
          <div className="flex flex-wrap gap-2">
            {CURRENCIES.map((code) => (
              <button key={code} type="button" className={chipClass(form.currency === code)} onClick={() => patch({ currency: code })}>
                {t(`orders.wholesale.imports.currency.${code}`)}
              </button>
            ))}
          </div>
        </div>
        <Field label={t("orders.wholesale.imports.bookingRate")}>
          <input type="number" min="0" step="0.0001" inputMode="decimal" value={form.booking_rate} onChange={(event) => patch({ booking_rate: event.target.value })} className={inputClass} />
        </Field>
        <Field label={t("orders.wholesale.imports.orderedAt")}>
          <input type="date" value={form.ordered_at || ""} onChange={(event) => patch({ ordered_at: event.target.value })} className={inputClass} />
        </Field>
        <Field label={t("orders.wholesale.imports.arrivedAt")}>
          <input type="date" value={form.arrived_at || ""} onChange={(event) => patch({ arrived_at: event.target.value, status: event.target.value ? "arrived" : form.status })} className={inputClass} />
        </Field>
        <div className="min-w-0 sm:col-span-2">
          <div className="flex flex-wrap gap-2">
            {["open", "arrived"].map((status) => (
              <button key={status} type="button" className={chipClass(form.status === status)} onClick={() => patch({ status })}>
                {t(`orders.wholesale.imports.status.${status}`)}
              </button>
            ))}
          </div>
        </div>
        <Field label={t("orders.wholesale.imports.notes")}>
          <input value={form.notes} onChange={(event) => patch({ notes: event.target.value })} className={inputClass} />
        </Field>
      </section>

      <section className={cardClass}>
        <h2 className="mb-3 text-base font-black text-[var(--text)]">{t("orders.wholesale.imports.lines")}</h2>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <ProductSearch onPick={(product) => patch({ lines: [...form.lines, { product_id: product.id, variant_id: null, color: "", label: product.name, pieces: "", unit_foreign: "" }] })} />
          <div className="flex min-w-0 flex-1 gap-2">
            <input value={purchaseKey} onChange={(event) => setPurchaseKey(event.target.value)} placeholder={t("orders.wholesale.imports.fromPurchase")} className={inputClass} />
            <button type="button" className={`${ghostButton} shrink-0`} onClick={importPurchase} disabled={busy === "purchase"}>
              {busy === "purchase" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Download className="h-4 w-4" aria-hidden="true" />}
              {t("orders.wholesale.imports.importPurchase")}
            </button>
          </div>
        </div>
        <div className="space-y-2">
          {form.lines.map((line, index) => (
            <div key={`${line.id || "n"}-${index}`} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2 rounded-[var(--radius-control)] border border-[var(--border)] p-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
              <div className="col-span-2 min-w-0 sm:col-span-1">
                <span className={labelClass}>{t("orders.wholesale.imports.label")}</span>
                <div className="truncate pt-2 text-sm font-black text-[var(--text)]">{line.label || "—"}</div>
              </div>
              <Field label={t("orders.wholesale.imports.pieces")}>
                <input type="number" min="0" inputMode="numeric" value={line.pieces} onChange={(event) => patchLine(index, { pieces: event.target.value })} className={inputClass} />
              </Field>
              <Field label={t("orders.wholesale.imports.unitForeign", { currency: currencyName })}>
                <input type="number" min="0" step="0.0001" inputMode="decimal" value={line.unit_foreign} onChange={(event) => patchLine(index, { unit_foreign: event.target.value })} className={inputClass} />
              </Field>
              <div className="min-w-0">
                <span className={labelClass}>{t("orders.wholesale.imports.landedUnit")}</span>
                <div className="pt-2 text-sm font-black text-[var(--text)]">{line.id && landedById.has(line.id) ? money(landedById.get(line.id)) : "—"}</div>
              </div>
              <button type="button" aria-label={t("orders.wholesale.imports.delete")} className="self-end justify-self-end p-2 text-[var(--text-muted)]" onClick={() => patch({ lines: form.lines.filter((_, i) => i !== index) })}>
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className={cardClass}>
        <h2 className="mb-3 text-base font-black text-[var(--text)]">{t("orders.wholesale.imports.costs")}</h2>
        <div className="space-y-2">
          {form.costs.map((cost, index) => (
            <div key={`c-${index}`} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,2fr)_auto]">
              <ThemedSelect
                value={cost.kind}
                onChange={(value) => patchCost(index, { kind: value })}
                options={COST_KINDS.map((kind) => ({ value: kind, label: t(`orders.wholesale.imports.costKind.${kind}`) }))}
                ariaLabel={t("orders.wholesale.imports.costs")}
                triggerClassName={inputClass}
              />
              <input type="number" min="0" inputMode="decimal" value={cost.amount_egp} placeholder={t("orders.wholesale.imports.amountEgp")} onChange={(event) => patchCost(index, { amount_egp: event.target.value })} className={inputClass} />
              <input value={cost.note} placeholder={t("orders.wholesale.imports.notes")} onChange={(event) => patchCost(index, { note: event.target.value })} className={`${inputClass} hidden sm:block`} />
              <button type="button" aria-label={t("orders.wholesale.imports.delete")} className="p-2 text-[var(--text-muted)]" onClick={() => patch({ costs: form.costs.filter((_, i) => i !== index) })}>
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
        <button type="button" className={`${ghostButton} mt-3`} onClick={() => patch({ costs: [...form.costs, { kind: "freight", amount_egp: "", note: "" }] })}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          {t("orders.wholesale.imports.addCost")}
        </button>
      </section>

      <div className="flex flex-wrap gap-2">
        <button type="button" className={primaryButton} onClick={save} disabled={Boolean(busy)}>
          {busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
          {t("orders.wholesale.imports.save")}
        </button>
        {detail ? (
          <button type="button" className={ghostButton} onClick={applyCost} disabled={Boolean(busy)}>
            {busy === "apply" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            {t("orders.wholesale.imports.applyCost")}
          </button>
        ) : null}
        {detail ? (
          <button type="button" className={`${ghostButton} ms-auto text-[var(--danger,#B91C1C)]`} onClick={remove}>
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            {t("orders.wholesale.imports.delete")}
          </button>
        ) : null}
      </div>
      {detail?.cost_applied_at ? (
        <p className="text-xs font-bold text-[var(--text-muted)]">{t("orders.wholesale.imports.appliedAt")}: {new Date(detail.cost_applied_at).toLocaleString()}</p>
      ) : null}

      {summary ? (
        <section className={cardClass}>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label={t("orders.wholesale.imports.summary.goods")} value={`${money(summary.goods_foreign)} ${currencyName}`} />
            <Stat label={t("orders.wholesale.imports.summary.paid")} value={`${money(summary.paid_foreign)} ${currencyName}`} />
            <Stat label={t("orders.wholesale.imports.summary.remaining")} value={`${money(summary.remaining_foreign)} ${currencyName}`} />
            <Stat label={t("orders.wholesale.imports.summary.effectiveRate")} value={rate(summary.effective_rate)} />
            <Stat label={t("orders.wholesale.imports.summary.goodsEgp")} value={money(summary.goods_egp)} />
            <Stat label={t("orders.wholesale.imports.summary.costs")} value={money(summary.costs_egp)} />
            <Stat label={t("orders.wholesale.imports.summary.perPiece")} value={money(summary.extra_per_piece)} />
            <Stat label={t("orders.wholesale.imports.summary.landed")} value={money(summary.landed_total)} />
            <Stat
              label={summary.fx_loss >= 0 ? t("orders.wholesale.imports.summary.fxLoss") : t("orders.wholesale.imports.summary.fxGain")}
              value={money(Math.abs(summary.fx_loss))}
              tone={summary.fx_loss > 0 ? "text-[var(--danger,#B91C1C)]" : summary.fx_loss < 0 ? "text-[var(--success,#047857)]" : ""}
            />
            {summary.overpaid_foreign > 0 ? (
              <Stat label={t("orders.wholesale.imports.summary.overpaid")} value={`${money(summary.overpaid_foreign)} ${currencyName}`} />
            ) : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function ShipmentsTab() {
  const { t } = useTranslation();
  const [rows, setRows] = useState(null);
  const [open, setOpen] = useState(undefined);
  const load = useCallback(() => {
    api.get("/wholesale/imports/shipments").then((res) => setRows(res.data || [])).catch((error) => { toast.error(error.message); setRows([]); });
  }, []);
  useEffect(() => { load(); }, [load]);

  if (open !== undefined) return <ShipmentEditor shipmentId={open} onBack={() => setOpen(undefined)} onChanged={load} />;

  return (
    <div className="space-y-3">
      <button type="button" className={primaryButton} onClick={() => setOpen(null)}>
        <Plus className="h-4 w-4" aria-hidden="true" />
        {t("orders.wholesale.imports.newShipment")}
      </button>
      {rows === null ? <Loader2 className="h-5 w-5 animate-spin text-[var(--text-muted)]" aria-hidden="true" /> : null}
      {rows && !rows.length ? <p className="text-sm font-bold text-[var(--text-muted)]">{t("orders.wholesale.imports.empty")}</p> : null}
      {(rows || []).map((row) => {
        const currencyName = t(`orders.wholesale.imports.currency.${row.currency}`);
        return (
          <button key={row.id} type="button" className={`${cardClass} block w-full text-start`} onClick={() => setOpen(row.id)}>
            <div className="flex flex-wrap items-center gap-2">
              <Truck className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate text-base font-black text-[var(--text)]">{row.name}</span>
              <span className={chipClass(row.status === "arrived")}>{t(`orders.wholesale.imports.status.${row.status}`)}</span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label={t("orders.wholesale.imports.summary.goods")} value={`${money(row.summary.goods_foreign)} ${currencyName}`} />
              <Stat label={t("orders.wholesale.imports.summary.remaining")} value={`${money(row.summary.remaining_foreign)} ${currencyName}`} />
              <Stat label={t("orders.wholesale.imports.summary.landed")} value={money(row.summary.landed_total)} />
              <Stat
                label={row.summary.fx_loss >= 0 ? t("orders.wholesale.imports.summary.fxLoss") : t("orders.wholesale.imports.summary.fxGain")}
                value={money(Math.abs(row.summary.fx_loss))}
                tone={row.summary.fx_loss > 0 ? "text-[var(--danger,#B91C1C)]" : ""}
              />
            </div>
          </button>
        );
      })}
    </div>
  );
}

const emptyTransfer = () => ({ channel: "agent", currency: "USD", foreign_amount: "", egp_amount: "", fees_egp: "", agent_name: "", transfer_date: today(), shipment_id: "", note: "" });

function TransfersTab() {
  const { t } = useTranslation();
  const [rows, setRows] = useState(null);
  const [shipments, setShipments] = useState([]);
  const [form, setForm] = useState(emptyTransfer);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    api.get("/wholesale/imports/transfers").then((res) => setRows(res.data || [])).catch((error) => { toast.error(error.message); setRows([]); });
    api.get("/wholesale/imports/shipments").then((res) => setShipments(res.data || [])).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);
  const patch = (next) => setForm((current) => ({ ...current, ...next }));
  const currencyName = t(`orders.wholesale.imports.currency.${form.currency}`);
  const liveRate = Number(form.foreign_amount) > 0 ? (Number(form.egp_amount || 0) + Number(form.fees_egp || 0)) / Number(form.foreign_amount) : 0;

  const save = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      const res = await api.post("/wholesale/imports/transfers", { ...form, shipment_id: form.shipment_id || null });
      setRows(res.data || []);
      setForm({ ...emptyTransfer(), channel: form.channel, currency: form.currency, agent_name: form.agent_name });
      toast.success(t("orders.wholesale.imports.transfers.saved"));
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id) => {
    if (!window.confirm(t("orders.wholesale.imports.transfers.confirmDelete"))) return;
    try {
      const res = await api.delete(`/wholesale/imports/transfers/${id}`);
      setRows(res.data || []);
    } catch (error) {
      toast.error(error.message);
    }
  };

  const shipmentOptions = [
    { value: "", label: t("orders.wholesale.imports.transfers.noShipment") },
    ...shipments.filter((row) => row.currency === form.currency).map((row) => ({ value: String(row.id), label: row.name })),
  ];

  return (
    <div className="space-y-4">
      <form onSubmit={save} className={`${cardClass} space-y-3`}>
        <h2 className="text-base font-black text-[var(--text)]">{t("orders.wholesale.imports.transfers.add")}</h2>
        <div className="flex flex-wrap gap-2">
          {CHANNELS.map((channel) => (
            <button key={channel} type="button" className={chipClass(form.channel === channel)} onClick={() => patch({ channel })}>
              {t(`orders.wholesale.imports.channel.${channel}`)}
            </button>
          ))}
          <span className="mx-1 w-px bg-[var(--border)]" aria-hidden="true" />
          {CURRENCIES.map((code) => (
            <button key={code} type="button" className={chipClass(form.currency === code)} onClick={() => patch({ currency: code, shipment_id: "" })}>
              {t(`orders.wholesale.imports.currency.${code}`)}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label={t("orders.wholesale.imports.transfers.foreign", { currency: currencyName })}>
            <input type="number" min="0" step="0.01" inputMode="decimal" value={form.foreign_amount} onChange={(event) => patch({ foreign_amount: event.target.value })} className={inputClass} />
          </Field>
          <Field label={t("orders.wholesale.imports.transfers.egp")}>
            <input type="number" min="0" step="0.01" inputMode="decimal" value={form.egp_amount} onChange={(event) => patch({ egp_amount: event.target.value })} className={inputClass} />
          </Field>
          <Field label={t("orders.wholesale.imports.transfers.fees")}>
            <input type="number" min="0" step="0.01" inputMode="decimal" value={form.fees_egp} onChange={(event) => patch({ fees_egp: event.target.value })} className={inputClass} />
          </Field>
          <Stat label={t("orders.wholesale.imports.transfers.rate")} value={liveRate ? rate(liveRate) : "—"} />
          <Field label={t("orders.wholesale.imports.transfers.agent")}>
            <input value={form.agent_name} onChange={(event) => patch({ agent_name: event.target.value })} className={inputClass} />
          </Field>
          <Field label={t("orders.wholesale.imports.transfers.date")}>
            <input type="date" value={form.transfer_date} onChange={(event) => patch({ transfer_date: event.target.value })} className={inputClass} />
          </Field>
          <div className="col-span-2 min-w-0">
            <span className={labelClass}>{t("orders.wholesale.imports.transfers.shipment")}</span>
            <ThemedSelect value={String(form.shipment_id)} onChange={(value) => patch({ shipment_id: value })} options={shipmentOptions} ariaLabel={t("orders.wholesale.imports.transfers.shipment")} triggerClassName={inputClass} />
          </div>
        </div>
        <button type="submit" className={primaryButton} disabled={busy || !(Number(form.foreign_amount) > 0) || !(Number(form.egp_amount) > 0)}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}
          {t("orders.wholesale.imports.transfers.add")}
        </button>
      </form>

      {rows && !rows.length ? <p className="text-sm font-bold text-[var(--text-muted)]">{t("orders.wholesale.imports.transfers.empty")}</p> : null}
      <div className="space-y-2">
        {(rows || []).map((row) => (
          <div key={row.id} className={`${cardClass} flex flex-wrap items-center gap-x-4 gap-y-1`}>
            <span className="text-sm font-black text-[var(--text)]">{money(row.foreign_amount)} {t(`orders.wholesale.imports.currency.${row.currency}`)}</span>
            <span className="text-sm font-bold text-[var(--text-muted)]">{t("orders.wholesale.imports.transfers.egp")}: {money(row.egp_amount + row.fees_egp)} · {t("orders.wholesale.imports.transfers.rate")} {rate(row.rate)}</span>
            <span className="text-xs font-bold text-[var(--text-muted)]">{t(`orders.wholesale.imports.channel.${row.channel}`)}{row.agent_name ? ` · ${row.agent_name}` : ""}</span>
            <span className="text-xs font-bold text-[var(--text-muted)]">{String(row.transfer_date).slice(0, 10)}{row.shipment_name ? ` · ${row.shipment_name}` : ""}</span>
            <button type="button" aria-label={t("orders.wholesale.imports.delete")} className="ms-auto p-1 text-[var(--text-muted)]" onClick={() => remove(row.id)}>
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function ReportsTab() {
  const { t } = useTranslation();
  const [capital, setCapital] = useState(null);
  const [fx, setFx] = useState(null);
  useEffect(() => {
    api.get("/wholesale/imports/reports/capital").then((res) => setCapital(res.data)).catch((error) => toast.error(error.message));
    api.get("/wholesale/imports/reports/fx").then((res) => setFx(res.data)).catch((error) => toast.error(error.message));
  }, []);

  return (
    <div className="space-y-4">
      <section className={cardClass}>
        <h2 className="mb-3 text-base font-black text-[var(--text)]">{t("orders.wholesale.imports.reports.capital")}</h2>
        {capital ? (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <Stat label={`${t("orders.wholesale.imports.reports.stock")} · ${t("orders.wholesale.imports.reports.pieces", { count: capital.stock_pieces })}`} value={money(capital.stock_value)} />
              <Stat label={t("orders.wholesale.imports.reports.inTransit")} value={money(capital.in_transit)} />
              <Stat label={t("orders.wholesale.imports.reports.withAgents")} value={money(capital.with_agents)} />
              <Stat label={`${t("orders.wholesale.imports.reports.receivables")} · ${t("orders.wholesale.imports.reports.debtors", { count: capital.debtors })}`} value={money(capital.receivables)} />
              <Stat label={t("orders.wholesale.imports.reports.owed")} value={`− ${money(capital.owed_to_suppliers)}`} tone="text-[var(--danger,#B91C1C)]" />
              <Stat label={t("orders.wholesale.imports.reports.total")} value={money(capital.capital)} tone="text-primary" />
            </div>
            <p className="mt-2 text-xs font-bold text-[var(--text-muted)]">{t("orders.wholesale.imports.reports.cashNote")}</p>
          </>
        ) : <Loader2 className="h-5 w-5 animate-spin text-[var(--text-muted)]" aria-hidden="true" />}
      </section>

      <section className={cardClass}>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="flex-1 text-base font-black text-[var(--text)]">{t("orders.wholesale.imports.reports.fx")}</h2>
          {fx ? <span className="text-sm font-black text-[var(--danger,#B91C1C)]">{t("orders.wholesale.imports.reports.totalFx")}: {money(fx.total_fx_loss)}</span> : null}
        </div>
        <div className="space-y-2">
          {(fx?.shipments || []).map((row) => (
            <div key={row.id} className="grid grid-cols-2 gap-2 rounded-[var(--radius-control)] border border-[var(--border)] p-2 sm:grid-cols-5">
              <div className="col-span-2 truncate text-sm font-black text-[var(--text)] sm:col-span-1">{row.name}</div>
              <Stat label={t("orders.wholesale.imports.reports.booked")} value={`${money(row.booked_egp)} · ${rate(row.booking_rate)}`} />
              <Stat label={t("orders.wholesale.imports.reports.actual")} value={`${money(row.goods_egp)} · ${rate(row.effective_rate)}`} />
              <Stat
                label={row.fx_loss >= 0 ? t("orders.wholesale.imports.summary.fxLoss") : t("orders.wholesale.imports.summary.fxGain")}
                value={money(Math.abs(row.fx_loss))}
                tone={row.fx_loss > 0 ? "text-[var(--danger,#B91C1C)]" : ""}
              />
              <Stat label={t("orders.wholesale.imports.summary.goods")} value={`${money(row.goods_foreign)} ${t(`orders.wholesale.imports.currency.${row.currency}`)}`} />
            </div>
          ))}
        </div>
      </section>

      <section className={cardClass}>
        <h2 className="mb-3 text-base font-black text-[var(--text)]">{t("orders.wholesale.imports.reports.byChannel")}</h2>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {(fx?.channels || []).map((row) => (
            <div key={`${row.channel}-${row.currency}`} className="grid grid-cols-2 gap-2 rounded-[var(--radius-control)] border border-[var(--border)] p-2">
              <div className="col-span-2 text-sm font-black text-[var(--text)]">
                {t(`orders.wholesale.imports.channel.${row.channel}`)} · {t(`orders.wholesale.imports.currency.${row.currency}`)}
              </div>
              <Stat label={t("orders.wholesale.imports.transfers.rate")} value={rate(row.average_rate)} />
              <Stat label={t("orders.wholesale.imports.reports.count")} value={`${row.count} · ${money(row.foreign)}`} />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

export default function WholesaleImports() {
  const { t } = useTranslation();
  const [tab, setTab] = useState("shipments");
  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 p-4 max-md:space-y-3 max-md:p-0 max-md:[&_input:not([type=checkbox])]:text-base max-md:[&_select]:text-base max-md:[&_textarea]:text-base">
      <header>
        <h1 className="text-xl font-black text-[var(--text)]">{t("orders.wholesale.imports.title")}</h1>
        <p className="text-sm font-bold text-[var(--text-muted)]">{t("orders.wholesale.imports.subtitle")}</p>
      </header>
      <div className="flex flex-wrap gap-2">
        {["shipments", "transfers", "reports"].map((key) => (
          <button key={key} type="button" className={chipClass(tab === key)} onClick={() => setTab(key)}>
            {t(`orders.wholesale.imports.tabs.${key}`)}
          </button>
        ))}
      </div>
      {tab === "shipments" ? <ShipmentsTab /> : null}
      {tab === "transfers" ? <TransfersTab /> : null}
      {tab === "reports" ? <ReportsTab /> : null}
    </div>
  );
}
