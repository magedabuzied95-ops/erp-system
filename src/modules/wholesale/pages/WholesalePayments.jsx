import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, ImageIcon, Loader2, Plus, Search, X } from "lucide-react";
import toast from "react-hot-toast";
import { api } from "../../../shared/api/api";
import { resolveProductImageUrl } from "../../../shared/lib/imageUrls";

// Wholesale copy only: payments credit customers sent from their statement link (with the
// transfer screenshot) wait here for approval; staff can also record one they already
// checked. Approving records an ordinary customer payment.

const cardClass = "rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-4";
const inputClass = "h-[var(--control-height-md)] min-w-0 rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--card)] px-3 text-sm font-bold text-[var(--text)] outline-none focus:border-[var(--border-strong)]";
const chipClass = (on) => `rounded-full border px-3 py-1 text-sm font-black ${on ? "border-primary bg-primary text-[var(--primary-contrast)]" : "border-[var(--border)] bg-[var(--card)] text-[var(--text)]"}`;
const primaryButton = "inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] bg-primary px-3 py-2 text-sm font-black text-[var(--primary-contrast)] disabled:opacity-60";
const ghostButton = "inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm font-black text-[var(--text)] disabled:opacity-60";
const METHODS = ["vodafone_cash", "instapay", "post", "bank_transfer", "cash"];
const money = (value) => Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });

function AddPayment({ onDone }) {
  const { t } = useTranslation();
  const [term, setTerm] = useState("");
  const [customers, setCustomers] = useState([]);
  const [customer, setCustomer] = useState(null);
  const [form, setForm] = useState({ amount: "", method: "vodafone_cash", reference: "", note: "" });
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (customer) return undefined;
    const id = setTimeout(() => {
      api.get("/wholesale/customers", { params: { search: term, limit: 10 } }).then((res) => setCustomers(res.data || [])).catch(() => {});
    }, 200);
    return () => clearTimeout(id);
  }, [term, customer]);

  const save = async (event) => {
    event.preventDefault();
    if (!customer || !(Number(form.amount) > 0)) return;
    setBusy(true);
    try {
      const body = new FormData();
      body.set("customer_id", String(customer.id));
      Object.entries(form).forEach(([key, value]) => body.set(key, value));
      if (file) body.set("screenshot", file, file.name || "transfer.jpg");
      await api.post("/wholesale/payments", body);
      toast.success(t("orders.wholesale.payments.approved"));
      setForm({ amount: "", method: form.method, reference: "", note: "" });
      setFile(null);
      setCustomer(null);
      setTerm("");
      onDone();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={save} className={`${cardClass} grid gap-3`}>
      <h3 className="font-black text-[var(--text)]">{t("orders.wholesale.payments.add")}</h3>
      {customer ? (
        <div className="flex items-center justify-between gap-2 rounded-[var(--radius-control)] border border-[var(--border)] px-3 py-2">
          <span className="text-sm font-black text-[var(--text)]">{customer.name} <span className="text-xs text-[var(--muted)]" dir="ltr">{customer.phone}</span></span>
          <button type="button" className={ghostButton} onClick={() => setCustomer(null)}><X size={14} /></button>
        </div>
      ) : (
        <div className="relative">
          <Search size={16} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
          <input className={`${inputClass} w-full ps-9`} value={term} onChange={(e) => setTerm(e.target.value)} placeholder={t("orders.wholesale.payments.customerPlaceholder")} />
          {customers.length ? (
            <ul className="mt-1 max-h-48 overflow-y-auto rounded-[var(--radius-control)] border border-[var(--border)]">
              {customers.map((c) => (
                <li key={c.id}><button type="button" className="w-full px-3 py-2 text-start text-sm font-bold text-[var(--text)] hover:bg-[var(--table-hover)]" onClick={() => setCustomer(c)}>{c.name} <span className="text-xs text-[var(--muted)]" dir="ltr">{c.phone}</span></button></li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {METHODS.map((m) => <button key={m} type="button" className={chipClass(form.method === m)} onClick={() => setForm((f) => ({ ...f, method: m }))}>{t(`orders.wholesale.statement.methods.${m}`)}</button>)}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <input className={inputClass} inputMode="decimal" placeholder={t("orders.wholesale.statement.amount")} value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value.replace(/[^\d.]/g, "") }))} />
        <input className={inputClass} placeholder={t("orders.wholesale.statement.reference")} value={form.reference} onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))} />
        <input className={inputClass} placeholder={t("orders.wholesale.statement.note")} value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} />
        <label className="flex items-center gap-2 text-xs font-black text-[var(--muted)]">
          <ImageIcon size={16} />
          <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => setFile(e.target.files?.[0] || null)} className="text-xs" />
        </label>
      </div>
      <div className="flex justify-end">
        <button type="submit" className={primaryButton} disabled={busy || !customer || !(Number(form.amount) > 0)}>
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />} {t("orders.wholesale.payments.save")}
        </button>
      </div>
    </form>
  );
}

function SubmissionRow({ row, onChanged }) {
  const { t } = useTranslation();
  const [amount, setAmount] = useState(String(row.amount));
  const [busy, setBusy] = useState(false);

  const act = async (action) => {
    let reason = "";
    if (action === "reject") {
      reason = window.prompt(t("orders.wholesale.payments.rejectReason")) ?? null;
      if (reason === null) return;
    }
    setBusy(true);
    try {
      await api.post(`/wholesale/payments/${row.id}/${action}`, action === "approve" ? { amount: Number(amount) } : { reason });
      toast.success(t(action === "approve" ? "orders.wholesale.payments.approved" : "orders.wholesale.payments.rejected"));
      onChanged();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="grid gap-3 py-3 md:grid-cols-[96px_minmax(0,1fr)_auto] md:items-center">
      {row.image_url ? (
        <a href={resolveProductImageUrl(row.image_url)} target="_blank" rel="noreferrer" title={t("orders.wholesale.payments.openProof")}>
          <img src={resolveProductImageUrl(row.image_url)} alt="" className="h-24 w-24 rounded-[var(--radius-control)] border border-[var(--border)] object-cover" />
        </a>
      ) : <div className="hidden h-24 w-24 md:block" />}
      <div className="min-w-0">
        <div className="text-sm font-black text-[var(--text)]">{row.customer_name} <span className="text-xs text-[var(--muted)]" dir="ltr">{row.customer_phone}</span></div>
        <div className="mt-1 text-xs font-bold text-[var(--muted)]">
          {new Date(row.created_at).toLocaleString()} · {t(`orders.wholesale.statement.methods.${row.method}`)} · {row.source === "customer" ? t("orders.wholesale.payments.fromCustomer") : t("orders.wholesale.payments.fromStaff")}
        </div>
        {row.reference || row.note ? <div className="mt-1 text-xs font-bold text-[var(--text)]">{[row.reference, row.note].filter(Boolean).join(" — ")}</div> : null}
        {row.reject_reason ? <div className="mt-1 text-xs font-bold text-red-500">{row.reject_reason}</div> : null}
      </div>
      {row.status === "pending" ? (
        <div className="flex flex-wrap items-center gap-2">
          <input className={`${inputClass} w-28`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} />
          <button type="button" className={primaryButton} disabled={busy || !(Number(amount) > 0)} onClick={() => act("approve")}><Check size={16} /> {t("orders.wholesale.payments.approve")}</button>
          <button type="button" className={ghostButton} disabled={busy} onClick={() => act("reject")}><X size={16} /> {t("orders.wholesale.payments.reject")}</button>
        </div>
      ) : (
        <div className="text-lg font-black text-[var(--text)]">{money(row.amount)}</div>
      )}
    </li>
  );
}

export default function WholesalePayments() {
  const { t } = useTranslation();
  const [status, setStatus] = useState("pending");
  const [rows, setRows] = useState(null);

  const load = useCallback(() => {
    api.get("/wholesale/payments", { params: { status } }).then((res) => setRows(res.data || [])).catch((error) => { toast.error(error.message); setRows([]); });
  }, [status]);
  useEffect(() => { setRows(null); load(); }, [load]);

  return (
    <div className="mx-auto grid max-w-5xl gap-4 p-4 max-md:gap-3 max-md:p-0 max-md:[&_input:not([type=checkbox])]:text-base max-md:[&_select]:text-base max-md:[&_textarea]:text-base">
      <header>
        <h1 className="text-2xl font-black text-[var(--text)]">{t("orders.wholesale.payments.title")}</h1>
        <p className="mt-1 text-sm font-bold text-[var(--muted)]">{t("orders.wholesale.payments.subtitle")}</p>
      </header>
      <AddPayment onDone={load} />
      <div className="flex flex-wrap gap-2">
        {["pending", "approved", "rejected"].map((key) => <button key={key} type="button" className={chipClass(status === key)} onClick={() => setStatus(key)}>{t(`orders.wholesale.payments.tabs.${key}`)}</button>)}
      </div>
      <div className={cardClass}>
        {rows === null ? <Loader2 size={18} className="animate-spin text-[var(--muted)]" /> : !rows.length ? (
          <p className="text-sm font-bold text-[var(--muted)]">{t("orders.wholesale.payments.empty")}</p>
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {rows.map((row) => <SubmissionRow key={row.id} row={row} onChanged={load} />)}
          </ul>
        )}
      </div>
    </div>
  );
}
