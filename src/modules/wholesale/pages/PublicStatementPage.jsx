import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { FileDown, Loader2, Send } from "lucide-react";
import { api } from "../../../shared/api/api";
import { resolveProductImageUrl } from "../../../shared/lib/imageUrls";
import i18n from "../../../i18n/i18n";

// The wholesale credit customer's own page (/s/:token): their account -- every invoice
// with what it held, payments, returns, the running balance -- and a form to send a
// payment with its transfer screenshot (recorded after staff approve it). No login.

const money = (value) => Number(value || 0).toLocaleString("ar-EG", { maximumFractionDigits: 2 });
const day = (value) => (value ? new Date(value).toLocaleDateString("ar-EG", { day: "numeric", month: "short", year: "numeric" }) : "");

export default function PublicStatementPage() {
  const { token } = useParams();
  const { t } = useTranslation();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ amount: "", method: "vodafone_cash", reference: "", note: "" });
  const [file, setFile] = useState(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  // Customers are Egyptian; the page is Arabic whatever the browser says.
  useEffect(() => {
    if (!String(i18n.language || "").startsWith("ar")) i18n.changeLanguage("ar");
  }, []);

  const load = useCallback(() => {
    api.get(`/public/wholesale/statement/${encodeURIComponent(token || "")}`, { suppressErrorStatuses: [404, 400] })
      .then((res) => { setData(res.data); setError(""); })
      .catch((err) => setError(err.status === 404 ? t("orders.wholesale.statement.notFound") : err.message));
  }, [token, t]);
  useEffect(() => { load(); }, [load]);

  const send = async (event) => {
    event.preventDefault();
    if (!file || !(Number(form.amount) > 0)) return;
    setSending(true);
    try {
      const body = new FormData();
      Object.entries(form).forEach(([key, value]) => body.set(key, value));
      body.set("screenshot", file, file.name || "transfer.jpg");
      await api.post(`/public/wholesale/statement/${encodeURIComponent(token)}/payments`, body);
      setSent(true);
      setForm({ amount: "", method: form.method, reference: "", note: "" });
      setFile(null);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  };

  const describe = useCallback((entry) => {
    const s = (key, vars) => t(`orders.wholesale.statement.${key}`, vars);
    if (entry.type === "invoice") return s("invoice", { ref: entry.reference });
    if (entry.type === "paid_at_sale") return s("paidAtSale", { ref: entry.reference });
    if (entry.type === "payment") return s("payment", { method: s(`methods.${entry.method}`) || entry.method });
    if (entry.type === "return_damaged") return s("returnDamaged", { ref: entry.invoice || entry.reference });
    return s("returnRow", { ref: entry.invoice || entry.reference });
  }, [t]);

  const rows = useMemo(() => [...(data?.entries || [])].reverse(), [data]);

  if (error && !data) {
    return <div className="mx-auto max-w-xl p-6 text-center text-base font-black text-red-600">{error}</div>;
  }
  if (!data) {
    return <div className="flex items-center justify-center gap-2 p-10 text-sm font-bold text-gray-500"><Loader2 className="animate-spin" size={16} />{t("orders.wholesale.statement.loading")}</div>;
  }

  const owes = data.balance > 0.009;
  const card = "rounded-2xl border border-gray-200 bg-white p-4 shadow-sm";

  return (
    <div className="min-h-screen bg-gray-50 px-3 py-5 text-gray-900 print:bg-white print:p-0">
      <div className="mx-auto grid max-w-3xl gap-4">
        <header className={`${card} flex flex-wrap items-center justify-between gap-3`}>
          <div>
            <div className="text-xs font-bold text-gray-500">{data.company}</div>
            <h1 className="text-xl font-black">{t("orders.wholesale.statement.title")} — {data.customer.name}</h1>
          </div>
          <button type="button" onClick={() => window.print()} className="inline-flex items-center gap-2 rounded-xl border border-gray-300 px-3 py-2 text-sm font-black print:hidden">
            <FileDown size={16} /> {t("orders.wholesale.statement.print")}
          </button>
        </header>

        <section className={`${card} text-center`}>
          <div className="text-sm font-bold text-gray-500">{owes ? t("orders.wholesale.statement.balanceLabel") : t("orders.wholesale.statement.creditNote")}</div>
          <div className={`mt-1 text-4xl font-black ${owes ? "text-red-600" : "text-emerald-600"}`}>{money(Math.abs(data.balance))} {t("orders.wholesale.common.egp")}</div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-xs font-bold text-gray-600">
            <div>{t("orders.wholesale.statement.invoiced")}<div className="text-base font-black text-gray-900">{money(data.totals.invoiced)}</div></div>
            <div>{t("orders.wholesale.statement.paid")}<div className="text-base font-black text-gray-900">{money(data.totals.paid)}</div></div>
            <div>{t("orders.wholesale.statement.returned")}<div className="text-base font-black text-gray-900">{money(data.totals.returned)}</div></div>
          </div>
        </section>

        {data.pending?.length ? (
          <section className={`${card} border-amber-300 bg-amber-50 print:hidden`}>
            <h2 className="text-sm font-black text-amber-800">{t("orders.wholesale.statement.pendingTitle")}</h2>
            <ul className="mt-2 grid gap-1 text-sm font-bold text-amber-900">
              {data.pending.map((p) => <li key={p.id}>{day(p.created_at)} — {t("orders.wholesale.statement.pendingRow", { amount: money(p.amount), method: p.method_label })}</li>)}
            </ul>
          </section>
        ) : null}

        <section className={card}>
          {!rows.length ? <p className="text-sm font-bold text-gray-500">{t("orders.wholesale.statement.empty")}</p> : (
            <ul className="divide-y divide-gray-100">
              {rows.map((entry, index) => (
                <li key={`${entry.type}-${entry.reference}-${index}`} className="py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-gray-500">{day(entry.date)}</div>
                      <div className="text-sm font-black">{describe(entry)}</div>
                      {entry.lines?.length ? (
                        <ul className="mt-1 text-xs font-bold text-gray-600">
                          {entry.lines.map((line, i) => <li key={i}>{line.product_name}{line.color ? ` — ${line.color}` : ""}: {line.units}</li>)}
                        </ul>
                      ) : null}
                      {entry.refunded_in_cash ? <div className="text-xs font-bold text-gray-500">{t("orders.wholesale.statement.refundedCash")}</div> : null}
                      {entry.proof_url ? (
                        <a href={resolveProductImageUrl(entry.proof_url)} target="_blank" rel="noreferrer" className="text-xs font-black text-blue-700 underline print:hidden">{t("orders.wholesale.statement.proof")}</a>
                      ) : null}
                    </div>
                    <div className="shrink-0 text-end">
                      {entry.debit ? <div className="text-sm font-black text-red-600">+{money(entry.debit)}</div> : null}
                      {entry.credit ? <div className="text-sm font-black text-emerald-600">−{money(entry.credit)}</div> : null}
                      <div className="text-[11px] font-bold text-gray-500">{t("orders.wholesale.statement.balance")}: {money(entry.balance)}</div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={`${card} print:hidden`}>
          <h2 className="text-base font-black">{t("orders.wholesale.statement.payTitle")}</h2>
          <p className="mt-1 text-xs font-bold text-gray-500">{t("orders.wholesale.statement.payHint")}</p>
          {sent ? <p className="mt-2 rounded-xl bg-emerald-50 p-2 text-sm font-black text-emerald-700">{t("orders.wholesale.statement.sent")}</p> : null}
          {error ? <p className="mt-2 text-sm font-black text-red-600">{error}</p> : null}
          <form onSubmit={send} className="mt-3 grid gap-3">
            <div className="flex flex-wrap gap-2">
              {data.methods.map((m) => (
                <button key={m.value} type="button" onClick={() => setForm((f) => ({ ...f, method: m.value }))}
                  className={`rounded-full border px-3 py-1.5 text-sm font-black ${form.method === m.value ? "border-gray-900 bg-gray-900 text-white" : "border-gray-300 bg-white"}`}>
                  {t(`orders.wholesale.statement.methods.${m.value}`)}
                </button>
              ))}
            </div>
            <label className="grid gap-1 text-xs font-black text-gray-600">
              {t("orders.wholesale.statement.amount")}
              <input required inputMode="decimal" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value.replace(/[^\d.]/g, "") }))} className="h-11 rounded-xl border border-gray-300 px-3 text-base font-black" />
            </label>
            <label className="grid gap-1 text-xs font-black text-gray-600">
              {t("orders.wholesale.statement.screenshot")}
              <input required type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => setFile(e.target.files?.[0] || null)} className="text-sm" />
            </label>
            <label className="grid gap-1 text-xs font-black text-gray-600">
              {t("orders.wholesale.statement.reference")}
              <input value={form.reference} onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))} className="h-11 rounded-xl border border-gray-300 px-3 text-sm font-bold" />
            </label>
            <label className="grid gap-1 text-xs font-black text-gray-600">
              {t("orders.wholesale.statement.note")}
              <input value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} className="h-11 rounded-xl border border-gray-300 px-3 text-sm font-bold" />
            </label>
            <button type="submit" disabled={sending || !file || !(Number(form.amount) > 0)} className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-gray-900 text-base font-black text-white disabled:opacity-40">
              {sending ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />} {t("orders.wholesale.statement.send")}
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}
