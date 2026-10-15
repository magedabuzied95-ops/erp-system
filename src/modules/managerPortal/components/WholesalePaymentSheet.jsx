import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, Wallet, X } from "lucide-react";
import toast from "react-hot-toast";
import i18n from "../../../i18n/i18n";
import { managerPortalApi } from "../services/managerPortalApi";

const tt = (key, options) => i18n.t(key, options);

// Wholesale copy only: the manager records a credit customer's payment in a few taps —
// pick the customer (their balance shows), amount, how it came in, optional screenshot.
// It is posted at once; the customer's statement link shows it straight away.
const METHODS = ["cash", "vodafone_cash", "instapay", "post", "bank_transfer"];
const fieldLabel = "mb-1.5 block text-[11px] font-black text-slate-500";
const inputClass =
  "w-full rounded-[var(--radius-control)] border border-border bg-surface-soft px-3 text-sm font-black text-text outline-none focus:border-primary";
const money = (value) => Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });

export default function WholesalePaymentSheet({ token, onClose }) {
  const [term, setTerm] = useState("");
  const [results, setResults] = useState([]);
  const [customer, setCustomer] = useState(null);
  const [balance, setBalance] = useState(null);
  const [form, setForm] = useState({ amount: "", method: "cash", reference: "", note: "" });
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (customer) return undefined;
    const id = setTimeout(() => {
      managerPortalApi.wholesaleCustomers(token, term).then((res) => setResults(res.data || [])).catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(id);
  }, [token, term, customer]);

  useEffect(() => {
    if (!customer) { setBalance(null); return undefined; }
    let alive = true;
    managerPortalApi.wholesaleCustomerBalance(token, customer.id)
      .then((res) => { if (alive) setBalance(res.data?.balance ?? 0); })
      .catch(() => { if (alive) setBalance(null); });
    return () => { alive = false; };
  }, [token, customer]);

  const close = () => { if (!saving) onClose(); };
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  const save = async () => {
    if (!customer) { toast.error(tt("orders.wholesale.portalPayment.pickCustomer")); return; }
    if (!(Number(form.amount) > 0)) { toast.error(tt("orders.wholesale.portalPayment.enterAmount")); return; }
    setSaving(true);
    try {
      const body = new FormData();
      body.set("customer_id", String(customer.id));
      Object.entries(form).forEach(([key, value]) => body.set(key, value));
      if (file) body.set("screenshot", file, file.name || "transfer.jpg");
      const res = await managerPortalApi.recordWholesalePayment(token, body);
      toast.success(tt("orders.wholesale.portalPayment.saved", { balance: money(res.data?.balance) }));
      onClose();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[95] flex items-end justify-center bg-slate-950/55 p-3 sm:items-center">
      <button type="button" aria-label={tt("orders.wholesale.portalPayment.close")} onClick={close} className="absolute inset-0" />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="wholesale-payment-title"
        className="relative max-h-[92vh] w-full max-w-sm overflow-y-auto rounded-[var(--radius-card)] border border-border bg-surface p-4 text-text shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3">
          <h3 id="wholesale-payment-title" className="m1-section-title">{tt("orders.wholesale.portalPayment.title")}</h3>
          <button
            type="button"
            onClick={close}
            disabled={saving}
            aria-label={tt("orders.wholesale.portalPayment.close")}
            className="inline-flex h-[var(--control-height-md)] w-10 shrink-0 items-center justify-center rounded-[var(--radius-control)] border border-border bg-surface-soft text-text disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 space-y-3">
          <div>
            <span className={fieldLabel}>{tt("orders.wholesale.portalPayment.customer")}</span>
            {customer ? (
              <div className="flex items-center justify-between gap-2 rounded-[var(--radius-control)] border border-primary bg-surface-soft p-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-black">{customer.name}</div>
                  <div className="text-xs font-bold text-slate-500" dir="ltr">{customer.phone}</div>
                  <div className="mt-1 text-xs font-black text-red-600">
                    {balance === null ? "…" : tt("orders.wholesale.portalPayment.owes", { balance: money(balance) })}
                  </div>
                </div>
                <button type="button" onClick={() => setCustomer(null)} className="shrink-0 text-xs font-black text-primary">
                  {tt("orders.wholesale.portalPayment.change")}
                </button>
              </div>
            ) : (
              <>
                <input
                  value={term}
                  onChange={(event) => setTerm(event.target.value)}
                  placeholder={tt("orders.wholesale.portalPayment.search")}
                  className={`${inputClass} h-[var(--control-height-md)]`}
                  autoFocus
                />
                <div className="mt-2 max-h-48 space-y-1 overflow-y-auto">
                  {results.map((row) => (
                    <button
                      key={row.id}
                      type="button"
                      onClick={() => setCustomer(row)}
                      className="flex w-full items-center justify-between gap-2 rounded-[var(--radius-control)] border border-border bg-surface-soft px-3 py-2 text-start"
                    >
                      <span className="truncate text-sm font-black">{row.name}</span>
                      <span className="shrink-0 text-xs font-bold text-slate-500" dir="ltr">{row.phone}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          <label className="block">
            <span className={fieldLabel}>{tt("orders.wholesale.portalPayment.amount")}</span>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              value={form.amount}
              onChange={(event) => update("amount", event.target.value)}
              dir="ltr"
              className={`${inputClass} h-[var(--control-height-lg)] text-lg`}
              placeholder="0.00"
            />
          </label>

          <div className="grid grid-cols-3 gap-2">
            {METHODS.map((method) => (
              <button
                key={method}
                type="button"
                onClick={() => update("method", method)}
                aria-pressed={form.method === method}
                className={`min-h-[var(--control-height-md)] rounded-[var(--radius-control)] border px-1 text-xs font-black transition ${form.method === method ? "border-primary bg-primary text-[var(--primary-contrast)]" : "border-border bg-surface-soft text-text"}`}
              >
                {tt(`orders.wholesale.statement.methods.${method}`)}
              </button>
            ))}
          </div>

          <label className="block">
            <span className={fieldLabel}>{tt("orders.wholesale.portalPayment.screenshot")}</span>
            <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => setFile(event.target.files?.[0] || null)} className="w-full text-xs font-bold" />
          </label>

          <label className="block">
            <span className={fieldLabel}>{tt("orders.wholesale.statement.reference")}</span>
            <input value={form.reference} onChange={(event) => update("reference", event.target.value)} className={`${inputClass} h-[var(--control-height-md)]`} />
          </label>

          <label className="block">
            <span className={fieldLabel}>{tt("orders.wholesale.statement.note")}</span>
            <input value={form.note} onChange={(event) => update("note", event.target.value)} className={`${inputClass} h-[var(--control-height-md)]`} />
          </label>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={close}
            disabled={saving}
            className="h-[var(--control-height-lg)] rounded-[var(--radius-control)] border border-border bg-surface-soft text-sm font-black text-text disabled:opacity-50"
          >
            {tt("orders.wholesale.portalPayment.cancel")}
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving || !customer || !(Number(form.amount) > 0)}
            className="inline-flex h-[var(--control-height-lg)] items-center justify-center gap-2 rounded-[var(--radius-control)] bg-primary text-sm font-black text-[var(--primary-contrast)] disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wallet className="h-4 w-4" />}
            {tt("orders.wholesale.portalPayment.save")}
          </button>
        </div>
      </section>
    </div>,
    document.body
  );
}
