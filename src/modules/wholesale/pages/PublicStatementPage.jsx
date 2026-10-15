import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ChevronLeft, FileDown, Loader2, X } from "lucide-react";
import { api } from "../../../shared/api/api";
import { resolveProductImageUrl } from "../../../shared/lib/imageUrls";
import i18n from "../../../i18n/i18n";

// The wholesale credit customer's own page (/s/:token), read only: what they owe, every
// invoice (tap one to see what it held), payments and returns. Payments are recorded by the
// shop, never from here. No login.

const money = (value) => Number(value || 0).toLocaleString("ar-EG", { maximumFractionDigits: 2 });
const day = (value) => (value ? new Date(value).toLocaleDateString("ar-EG", { day: "numeric", month: "short", year: "numeric" }) : "");
const TABS = ["all", "invoices", "payments", "returns"];
const isReturn = (entry) => entry.type === "return" || entry.type === "return_damaged";
const isPayment = (entry) => entry.type === "payment" || entry.type === "paid_at_sale";
const linesText = (lines = []) => lines.map((line) => `${line.product_name}${line.color ? ` ${line.color}` : ""}: ${line.units}`).join(" · ");

function InvoiceSheet({ invoice, entries, onClose }) {
  const { t } = useTranslation();
  const s = (key, vars) => t(`orders.wholesale.statement.${key}`, vars);
  const paid = entries.filter((e) => e.type === "paid_at_sale" && e.order_id === invoice.order_id).reduce((sum, e) => sum + e.credit, 0);
  const returned = entries.filter((e) => isReturn(e) && e.order_id === invoice.order_id).reduce((sum, e) => sum + e.credit, 0);
  const pieces = (invoice.lines || []).reduce((sum, line) => sum + Number(line.pieces || 0), 0);

  useEffect(() => {
    const onKey = (event) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4" style={{ background: "rgba(15, 23, 42, 0.55)" }} role="presentation">
      <button type="button" aria-label={s("close")} className="absolute inset-0" onClick={onClose} />
      <section role="dialog" aria-modal="true" className="relative max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-white p-4 text-gray-900 shadow-2xl sm:rounded-3xl">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-black">{s("invoice", { ref: invoice.reference })}</h2>
            <div className="text-xs font-bold text-gray-500">{day(invoice.date)} · {s("piecesCount", { count: pieces })}</div>
          </div>
          <button type="button" onClick={onClose} aria-label={s("close")} className="grid h-9 w-9 place-items-center rounded-full bg-gray-100">
            <X size={18} />
          </button>
        </div>

        <ul className="divide-y divide-gray-100 rounded-2xl border border-gray-200">
          {(invoice.lines || []).map((line, index) => (
            <li key={`${line.product_id}-${line.color}-${index}`} className="p-3">
              <div className="text-sm font-black">{line.product_name}{line.color ? ` — ${line.color}` : ""}</div>
              <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-xs font-bold text-gray-600">
                <span>{line.units} · {s("piecesCount", { count: line.pieces })}</span>
                <span>{s("pricePerPiece", { price: money(line.price) })}</span>
              </div>
              <div className="mt-1 text-end text-sm font-black">{money(line.total)} {t("orders.wholesale.common.egp")}</div>
            </li>
          ))}
        </ul>

        <dl className="mt-3 grid gap-1.5 rounded-2xl bg-gray-50 p-3 text-sm font-bold">
          <div className="flex justify-between"><dt>{s("invoiceTotal")}</dt><dd className="font-black">{money(invoice.debit)}</dd></div>
          {paid > 0 ? <div className="flex justify-between text-emerald-700"><dt>{s("paidOnInvoice")}</dt><dd className="font-black">−{money(paid)}</dd></div> : null}
          {returned > 0 ? <div className="flex justify-between text-emerald-700"><dt>{s("returnedFromInvoice")}</dt><dd className="font-black">−{money(returned)}</dd></div> : null}
          <div className="flex justify-between border-t border-gray-200 pt-1.5 text-base"><dt>{s("remainingOnInvoice")}</dt><dd className="font-black">{money(Math.max(0, invoice.debit - paid - returned))}</dd></div>
        </dl>
        <p className="mt-2 text-[11px] font-bold text-gray-500">{s("paymentsNote")}</p>
      </section>
    </div>,
    document.body
  );
}

export default function PublicStatementPage() {
  const { token } = useParams();
  const { t } = useTranslation();
  const s = useCallback((key, vars) => t(`orders.wholesale.statement.${key}`, vars), [t]);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("all");
  const [openInvoice, setOpenInvoice] = useState(null);

  // Customers are Egyptian; the page is Arabic whatever the browser says.
  useEffect(() => {
    if (!String(i18n.language || "").startsWith("ar")) i18n.changeLanguage("ar");
  }, []);

  useEffect(() => {
    api.get(`/public/wholesale/statement/${encodeURIComponent(token || "")}`, { suppressErrorStatuses: [404, 400] })
      .then((res) => { setData(res.data); setError(""); })
      .catch((err) => setError(err.status === 404 ? s("notFound") : err.message));
  }, [token, s]);

  const entries = useMemo(() => data?.entries || [], [data]);
  const newestFirst = useMemo(() => [...entries].reverse(), [entries]);
  const invoices = useMemo(() => newestFirst.filter((e) => e.type === "invoice"), [newestFirst]);
  const payments = useMemo(() => newestFirst.filter(isPayment), [newestFirst]);
  const returns = useMemo(() => newestFirst.filter(isReturn), [newestFirst]);

  const describe = (entry) => {
    if (entry.type === "invoice") return s("invoice", { ref: entry.reference });
    if (entry.type === "paid_at_sale") return s("paidAtSale", { ref: entry.reference });
    if (entry.type === "payment") return s("payment", { method: entry.method_label || s(`methods.${entry.method}`) });
    if (entry.type === "return_damaged") return s("returnDamaged", { ref: entry.invoice || entry.reference });
    return s("returnRow", { ref: entry.invoice || entry.reference });
  };

  if (error && !data) {
    return <div className="mx-auto max-w-xl p-6 text-center text-base font-black text-red-600">{error}</div>;
  }
  if (!data) {
    return <div className="flex items-center justify-center gap-2 p-10 text-sm font-bold text-gray-500"><Loader2 className="animate-spin" size={16} />{s("loading")}</div>;
  }

  const owes = data.balance > 0.009;
  const card = "rounded-2xl border border-gray-200 bg-white p-4 shadow-sm";
  const counts = { all: entries.length, invoices: invoices.length, payments: payments.length, returns: returns.length };
  const showBalance = tab === "all";
  const list = tab === "invoices" ? invoices : tab === "payments" ? payments : tab === "returns" ? returns : newestFirst;

  const amount = (entry) => (
    <div className="shrink-0 text-end">
      {entry.debit ? <div className="text-sm font-black text-red-600">+{money(entry.debit)}</div> : null}
      {entry.credit ? <div className="text-sm font-black text-emerald-600">−{money(entry.credit)}</div> : null}
      {!entry.debit && !entry.credit && entry.amount ? <div className="text-sm font-black text-gray-500">{money(entry.amount)}</div> : null}
      {showBalance ? <div className="text-[11px] font-bold text-gray-500">{s("balance")}: {money(entry.balance)}</div> : null}
    </div>
  );

  const row = (entry, index) => {
    if (entry.type === "invoice") {
      return (
        <li key={`inv-${entry.order_id}-${index}`}>
          <button type="button" onClick={() => setOpenInvoice(entry)} className="flex w-full items-center justify-between gap-3 py-3 text-start">
            <div className="min-w-0">
              <div className="text-xs font-bold text-gray-500">{day(entry.date)}</div>
              <div className="text-sm font-black">{describe(entry)}</div>
              <div className="truncate text-xs font-bold text-gray-600">{linesText(entry.lines)}</div>
              <div className="mt-0.5 text-xs font-black text-blue-700 print:hidden">{s("openInvoice")}</div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {amount(entry)}
              <ChevronLeft size={16} className="text-gray-400 ltr:rotate-180 print:hidden" />
            </div>
          </button>
        </li>
      );
    }
    return (
      <li key={`${entry.type}-${entry.reference}-${index}`} className="flex items-start justify-between gap-3 py-3">
        <div className="min-w-0">
          <div className="text-xs font-bold text-gray-500">{day(entry.date)}</div>
          <div className="text-sm font-black">{describe(entry)}</div>
          {isReturn(entry) && entry.lines?.length ? <div className="text-xs font-bold text-gray-600">{linesText(entry.lines)}</div> : null}
          {entry.type === "payment" && entry.reference && !String(entry.reference).startsWith("WSP-") ? (
            <div className="text-xs font-bold text-gray-500">{s("referenceLabel", { ref: entry.reference })}</div>
          ) : null}
          {entry.refunded_in_cash ? <div className="text-xs font-bold text-gray-500">{s("refundedCash")}</div> : null}
          {entry.proof_url ? (
            <a href={resolveProductImageUrl(entry.proof_url)} target="_blank" rel="noreferrer" className="text-xs font-black text-blue-700 underline print:hidden">{s("proof")}</a>
          ) : null}
        </div>
        {amount(entry)}
      </li>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50 px-3 py-5 text-gray-900 print:bg-white print:p-0">
      <div className="mx-auto grid max-w-3xl grid-cols-[minmax(0,1fr)] gap-4">
        <header className={`${card} flex flex-wrap items-center justify-between gap-3`}>
          <div>
            <div className="text-xs font-bold text-gray-500">{data.company}</div>
            <h1 className="text-xl font-black">{s("title")} — {data.customer.name}</h1>
          </div>
          <button type="button" onClick={() => window.print()} className="inline-flex items-center gap-2 rounded-xl border border-gray-300 px-3 py-2 text-sm font-black print:hidden">
            <FileDown size={16} /> {s("print")}
          </button>
        </header>

        <section className={`${card} text-center`}>
          <div className="text-sm font-bold text-gray-500">{owes ? s("balanceLabel") : s("creditNote")}</div>
          <div className={`mt-1 text-4xl font-black ${owes ? "text-red-600" : "text-emerald-600"}`}>{money(Math.abs(data.balance))} {t("orders.wholesale.common.egp")}</div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-xs font-bold text-gray-600">
            <div>{s("invoiced")}<div className="text-base font-black text-gray-900">{money(data.totals.invoiced)}</div></div>
            <div>{s("paid")}<div className="text-base font-black text-gray-900">{money(data.totals.paid)}</div></div>
            <div>{s("returned")}<div className="text-base font-black text-gray-900">{money(data.totals.returned)}</div></div>
          </div>
        </section>

        <div className="flex flex-wrap gap-2 print:hidden">
          {TABS.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`rounded-full border px-3 py-1.5 text-sm font-black ${tab === key ? "border-gray-900 bg-gray-900 text-white" : "border-gray-300 bg-white text-gray-900"}`}
            >
              {s(`tabs.${key}`)} ({counts[key]})
            </button>
          ))}
        </div>

        <section className={card}>
          {!list.length ? <p className="text-sm font-bold text-gray-500">{s("empty")}</p> : (
            <ul className="divide-y divide-gray-100">{list.map(row)}</ul>
          )}
        </section>
      </div>
      {openInvoice ? <InvoiceSheet invoice={openInvoice} entries={entries} onClose={() => setOpenInvoice(null)} /> : null}
    </div>
  );
}
