import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { ArrowRight, Ban, CheckCircle2, Copy, KeyRound, Link2, Loader2, RefreshCw, Smartphone } from "lucide-react";
import toast from "react-hot-toast";
import { api } from "../../../shared/api/api";

// Vodafone Cash SMS the owner's phone forwarded. Most approve their order on their own;
// this page is where the rest are settled by hand, and where the phone's key lives.

const TABS = ["review", "matched", "ignored", "all"];
const fmtMoney = (value) => `${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} ج.م`;
const fmtDate = (value) => (value ? new Date(value).toLocaleString() : "-");

const cardClass = "rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-4";
const inputClass = "h-[var(--control-height-md)] min-w-0 rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--card)] px-3 text-sm font-bold text-[var(--text)] outline-none focus:border-[var(--border-strong)]";
const ghostButton = "inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm font-black text-[var(--text)] hover:border-[var(--border-strong)] hover:bg-[var(--table-hover)] disabled:opacity-60";
const primaryButton = "inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] bg-primary px-3 py-2 text-sm font-black text-[var(--primary-contrast)] disabled:opacity-60";

const STATUS_TONE = {
  matched: "border-emerald-400/40 bg-emerald-400/10 text-emerald-500",
  needs_review: "border-amber-400/40 bg-amber-400/10 text-amber-500",
  unmatched: "border-orange-400/40 bg-orange-400/10 text-orange-500",
  unparsed: "border-red-400/40 bg-red-400/10 text-red-500",
};

function copy(value, message) {
  navigator.clipboard?.writeText(value).then(() => toast.success(message)).catch(() => {});
}

function SetupCard() {
  const { t } = useTranslation();
  const [setup, setSetup] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // Settings editors only; everyone else simply does not see the card.
    api.get("/wallet-transfers/setup", { suppressErrorStatuses: [403] })
      .then((data) => { if (!cancelled) setSetup(data); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  if (!setup) return null;

  const rotate = async () => {
    if (setup.secret && !window.confirm(t("orders.walletTransfers.setup.rotateConfirm"))) return;
    setBusy(true);
    try {
      setSetup(await api.post("/wallet-transfers/setup/rotate", {}));
      toast.success(t("orders.walletTransfers.setup.rotated"));
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  };

  const row = (label, value) => (
    <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
      <span className="w-28 shrink-0 text-xs font-black text-[var(--text-tertiary)]">{label}</span>
      <code className="min-w-0 flex-1 truncate rounded-lg bg-[var(--card)] px-2 py-1 text-xs" dir="ltr">{value}</code>
      <button type="button" className={ghostButton} onClick={() => copy(value, t("orders.walletTransfers.setup.copied"))} aria-label={t("orders.walletTransfers.setup.copy")}><Copy className="h-4 w-4" /></button>
    </div>
  );

  return (
    <section className={cardClass}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-base font-black"><Smartphone className="h-4 w-4" /> {t("orders.walletTransfers.setup.title")}</h2>
        <button type="button" className={setup.secret ? ghostButton : primaryButton} onClick={rotate} disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
          {setup.secret ? t("orders.walletTransfers.setup.rotate") : t("orders.walletTransfers.setup.create")}
        </button>
      </div>
      <p className="mt-1 text-sm font-semibold text-[var(--muted)]">{t("orders.walletTransfers.setup.hint")}</p>
      <div className="mt-3 grid gap-2">
        {row("URL", setup.webhook_url)}
        {row(t("orders.walletTransfers.setup.header"), setup.header_name)}
        {setup.secret ? row(t("orders.walletTransfers.setup.key"), setup.secret) : null}
      </div>
    </section>
  );
}

function TransferCard({ transfer, onChanged }) {
  const { t } = useTranslation();
  const [invoice, setInvoice] = useState("");
  const [busy, setBusy] = useState("");
  const [showRaw, setShowRaw] = useState(false);
  const settled = transfer.status === "matched" || transfer.status === "ignored";
  const canLink = transfer.direction === "incoming" && transfer.status !== "matched";

  const run = async (key, request, success) => {
    setBusy(key);
    try {
      await request();
      toast.success(success);
      onChanged();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy("");
    }
  };

  const link = (body) => run(`link:${body.order_id || body.invoice_number}`, () => api.post(`/wallet-transfers/${transfer.id}/match`, body), t("orders.walletTransfers.linked"));

  return (
    <article className={cardClass}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xl font-black">{transfer.amount !== null ? fmtMoney(transfer.amount) : t("orders.walletTransfers.unknownAmount")}</div>
          <div className="mt-1 text-sm font-bold">
            {transfer.counterparty_name || "-"} <span className="text-[var(--muted)]" dir="ltr">{transfer.counterparty_phone || ""}</span>
          </div>
          <div className="mt-1 text-xs font-semibold text-[var(--muted)]">
            {fmtDate(transfer.occurred_at || transfer.created_at)}
            {transfer.reference ? <> · <span dir="ltr">#{transfer.reference}</span></> : null}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className={`rounded-full border px-2 py-0.5 text-xs font-black ${STATUS_TONE[transfer.status] || "border-[var(--border)] text-[var(--muted)]"}`}>
            {t(`orders.walletTransfers.status.${transfer.status}`, transfer.status)}
          </span>
          {transfer.review_reason ? <span className="text-xs font-bold text-[var(--muted)]">{t(`orders.walletTransfers.reason.${transfer.review_reason}`, transfer.review_reason)}</span> : null}
        </div>
      </div>

      {transfer.status === "matched" && transfer.order_id ? (
        <Link to={`/orders/${transfer.order_id}`} className="mt-3 inline-flex items-center gap-2 text-sm font-black text-emerald-500 hover:underline">
          <CheckCircle2 className="h-4 w-4" />
          {t("orders.walletTransfers.order")} {transfer.order_invoice_number || `#${transfer.order_id}`} — {transfer.order_customer_name || ""}
          <span className="text-xs font-bold text-[var(--muted)]">({t(`orders.walletTransfers.method.${String(transfer.match_method || "").replace(/_already_approved$/, "")}`, transfer.match_method || "")})</span>
        </Link>
      ) : null}

      {canLink && transfer.candidates?.length ? (
        <div className="mt-3 grid gap-2">
          <div className="text-xs font-black text-[var(--text-tertiary)]">{t("orders.walletTransfers.candidates")}</div>
          {transfer.candidates.map((order) => (
            <div key={order.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--border)] px-3 py-2">
              <Link to={`/orders/${order.id}`} className="min-w-0 text-sm font-bold hover:underline">
                {order.invoice_number || `#${order.id}`} — {order.customer_name || "-"} <span className="text-[var(--muted)]" dir="ltr">{order.customer_phone || ""}</span>
                <span className="text-xs text-[var(--muted)]"> · {fmtMoney(order.order_total)} · {fmtDate(order.created_at)}</span>
              </Link>
              <button type="button" className={primaryButton} disabled={Boolean(busy)} onClick={() => link({ order_id: order.id })}>
                {busy === `link:${order.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                {t("orders.walletTransfers.confirmOnOrder")}
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {canLink ? (
        <form
          className="mt-3 flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (invoice.trim()) link({ invoice_number: invoice.trim() });
          }}
        >
          <input className={`${inputClass} flex-1`} value={invoice} onChange={(event) => setInvoice(event.target.value)} placeholder={t("orders.walletTransfers.invoicePlaceholder")} dir="ltr" />
          <button type="submit" className={ghostButton} disabled={Boolean(busy) || !invoice.trim()}><Link2 className="h-4 w-4" /> {t("orders.walletTransfers.linkByInvoice")}</button>
          {!settled ? (
            <button type="button" className={ghostButton} disabled={Boolean(busy)} onClick={() => run("ignore", () => api.post(`/wallet-transfers/${transfer.id}/ignore`, {}), t("orders.walletTransfers.ignored"))}>
              <Ban className="h-4 w-4" /> {t("orders.walletTransfers.ignore")}
            </button>
          ) : null}
        </form>
      ) : null}

      {transfer.status === "unparsed" || transfer.status === "needs_review" || transfer.status === "unmatched" ? (
        <button type="button" className="mt-2 text-xs font-bold text-[var(--muted)] hover:underline" onClick={() => setShowRaw((value) => !value)}>
          {showRaw ? t("orders.walletTransfers.hideSms") : t("orders.walletTransfers.showSms")}
        </button>
      ) : null}
      {showRaw ? (
        <pre className="mt-2 whitespace-pre-wrap break-words rounded-xl bg-[var(--card)] p-3 text-xs font-semibold">
          {transfer.sms_sender ? `${t("orders.walletTransfers.sender")}: ${transfer.sms_sender}\n\n` : ""}{transfer.raw_text}
        </pre>
      ) : null}
    </article>
  );
}

export default function WalletTransfers() {
  const { t } = useTranslation();
  const [tab, setTab] = useState("review");
  const [data, setData] = useState({ transfers: [], counts: {} });
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.get(`/wallet-transfers?status=${tab}`);
      setData({ transfers: response.transfers || [], counts: response.counts || {} });
    } catch (error) {
      toast.error(error.message);
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => { void load(); }, [load]);

  const counts = data.counts || {};
  const tabCount = {
    review: (counts.needs_review || 0) + (counts.unmatched || 0) + (counts.unparsed || 0),
    matched: counts.matched || 0,
    ignored: counts.ignored || 0,
  };

  return (
    <div className="mx-auto grid w-full max-w-5xl gap-4 p-3 sm:p-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <Link to="/orders" className="inline-flex items-center gap-1 text-xs font-bold text-[var(--muted)] hover:underline"><ArrowRight className="h-3 w-3 ltr:rotate-180" /> {t("orders.title")}</Link>
          <h1 className="m1-page-title mt-1">{t("orders.walletTransfers.title")}</h1>
          <p className="mt-1 max-w-2xl text-sm font-semibold text-[var(--muted)]">{t("orders.walletTransfers.subtitle")}</p>
        </div>
        <button type="button" className={ghostButton} onClick={() => { void load(); }} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> {t("orders.header.refresh")}
        </button>
      </header>

      <SetupCard />

      <div className="flex flex-wrap gap-2" role="tablist">
        {TABS.map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={tab === key ? primaryButton : ghostButton}
          >
            {t(`orders.walletTransfers.tabs.${key}`)}
            {tabCount[key] ? <span className="rounded-full bg-black/10 px-2 text-xs">{tabCount[key]}</span> : null}
          </button>
        ))}
      </div>

      {loading && !data.transfers.length ? (
        <div className="grid h-40 place-items-center"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : data.transfers.length ? (
        <div className="grid gap-3">
          {data.transfers.map((transfer) => <TransferCard key={transfer.id} transfer={transfer} onChanged={load} />)}
        </div>
      ) : (
        <div className={`${cardClass} text-center text-sm font-bold text-[var(--muted)]`}>{t(`orders.walletTransfers.empty.${tab}`)}</div>
      )}
    </div>
  );
}
