import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { CheckCircle2, Loader2, Smartphone, X } from "lucide-react";
import { api } from "../../../shared/api/api";
import { subscribeRealtime, useRealtimeConnection } from "../../../shared/realtime/socketStore";
import { playRealtimeSound } from "../../../services/realtimeFeedbackService";
import { formatCurrency } from "../lib/posUtils";

/*
 * The customer at the counter pays by Vodafone Cash / InstaPay and the cashier waits for the
 * money. The owner's phone forwards the SMS to /api/wallet-transfers/sms; any transfer no
 * website order took is pushed to the tills ("wallet_transfers:incoming"). While the open
 * invoice takes money by wallet, a transfer of exactly that amount shows here, and confirming
 * it checks the invoice out with the transfer attached — the server claims it inside the sale,
 * so one transfer can never pay two invoices.
 *
 * The socket is the fast path; a poll runs alongside while the till waits, because a cashier
 * whose login has no tenant never joins the tenant room, and a reconnect loses events.
 */
const POLL_MS = 8000;
const sameAmount = (left, right) => Math.abs(Number(left || 0) - Number(right || 0)) < 0.01;

export default function PosWalletTransferAlert({ active = false, expectedAmount = 0, onConfirm }) {
  const { t, i18n } = useTranslation();
  const { connected } = useRealtimeConnection();
  const [transfers, setTransfers] = useState([]);
  const [dismissed, setDismissed] = useState(() => new Set());
  const [confirmingId, setConfirmingId] = useState(null);
  const announced = useRef(new Set());
  const watching = active && Number(expectedAmount) > 0;

  const load = useCallback(async () => {
    try {
      const response = await api.get("/wallet-transfers/pos-incoming");
      const rows = Array.isArray(response?.transfers) ? response.transfers : Array.isArray(response?.data?.transfers) ? response.data.transfers : [];
      setTransfers(rows);
    } catch {
      // A till without the permission, or a dead uplink: the card simply never shows.
    }
  }, []);

  useEffect(() => {
    if (!watching) return undefined;
    load();
    const timer = window.setInterval(load, POLL_MS);
    return () => window.clearInterval(timer);
  }, [watching, load]);

  useEffect(() => {
    if (watching && connected) load();
  }, [watching, connected, load]);

  useEffect(() => {
    const offIncoming = subscribeRealtime("wallet_transfers:incoming", (payload = {}) => {
      if (!payload?.id) return;
      setTransfers((list) => [payload, ...list.filter((item) => Number(item.id) !== Number(payload.id))]);
    });
    const offSettled = subscribeRealtime("wallet_transfers:settled", (payload = {}) => {
      if (!payload?.id) return;
      setTransfers((list) => list.filter((item) => Number(item.id) !== Number(payload.id)));
    });
    return () => {
      offIncoming();
      offSettled();
    };
  }, []);

  const matching = useMemo(
    () => (watching ? transfers.filter((item) => sameAmount(item.amount, expectedAmount) && !dismissed.has(Number(item.id))) : []),
    [dismissed, expectedAmount, transfers, watching]
  );
  const transfer = matching[0] || null;

  useEffect(() => {
    if (!transfer || announced.current.has(transfer.id)) return;
    announced.current.add(transfer.id);
    playRealtimeSound("paymentSuccess", { priority: "high", key: `wallet-transfer-${transfer.id}` }).catch(() => {});
  }, [transfer]);

  const confirm = async () => {
    if (!transfer || confirmingId) return;
    setConfirmingId(transfer.id);
    try {
      const order = await onConfirm?.(transfer);
      if (order) setTransfers((list) => list.filter((item) => Number(item.id) !== Number(transfer.id)));
    } finally {
      setConfirmingId(null);
    }
  };

  if (!transfer || typeof document === "undefined") return null;
  const language = i18n.language?.startsWith("ar") ? "ar" : "en";
  const who = transfer.counterparty_name || transfer.counterparty_phone || "";
  const busy = Boolean(confirmingId);

  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 top-3 z-[2147483000] flex justify-center px-4" role="alert">
      <div className="pointer-events-auto w-full max-w-md rounded-2xl border border-emerald-400/60 bg-emerald-950/95 p-4 text-emerald-50 shadow-2xl backdrop-blur">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-500/20 text-emerald-300">
            <Smartphone className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold text-emerald-200">
              {t("pos.walletTransfer.arrived", { provider: transfer.provider_label || "" })}
            </div>
            <div className="mt-1 text-2xl font-black">{formatCurrency(transfer.amount, language)}</div>
            {who ? <div className="mt-0.5 truncate text-xs text-emerald-200/80">{t("pos.walletTransfer.from", { who })}</div> : null}
            <div className="mt-1 inline-flex items-center gap-1 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[11px] font-bold text-emerald-200">
              <CheckCircle2 className="h-3 w-3" />
              {t("pos.walletTransfer.matchesInvoice")}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setDismissed((current) => new Set(current).add(Number(transfer.id)))}
            disabled={busy}
            aria-label={t("pos.walletTransfer.dismiss")}
            title={t("pos.walletTransfer.dismiss")}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-emerald-200/80 hover:bg-emerald-500/20 disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <button
          type="button"
          onClick={confirm}
          disabled={busy}
          className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 text-base font-black text-emerald-950 hover:bg-emerald-400 disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-5 w-5" />}
          {busy ? t("pos.walletTransfer.confirming") : t("pos.walletTransfer.confirm")}
        </button>
      </div>
    </div>,
    document.fullscreenElement || document.body
  );
}
