import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, Loader2, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";

import { api } from "../../../shared/api/api";
import { isWhatsappSessionDown } from "../services/whatsappSession";

// A WhatsApp session drops on its own — the phone stays offline too long, or the
// account unlinks the device — and until this existed nothing in the app said so.
// The inbox just stopped moving. On 2026-08-30 the gateway had been `close` for
// 37 hours with WhatsApp carrying ~90% of the traffic, and it read to the
// operator as a broken app rather than a dead channel.
//
// Shared by BOTH inbox surfaces and the integrations panel on purpose: /inbox and
// /admin/ai-inbox are separate implementations and anything written twice drifts.

// Every poll costs the backend a round trip to the Evolution gateway, and a
// session state changes maybe twice a month — but noticing within a few minutes
// is the whole point. Three minutes buys that without every open inbox tab
// hammering the gateway. Regaining visibility re-checks immediately anyway.
const STATUS_POLL_MS = 180_000;
const PAIRING_POLL_MS = 3_000;
// WhatsApp rotates a pairing QR roughly every 20 seconds.
const QR_REFRESH_MS = 20_000;
const PAIRING_TIMEOUT_MS = 180_000;
// Reading the gateway needs settings:view and pairing needs settings:edit, so a
// staff account gets 403 here. That is not an error worth showing anyone — the
// alert simply stays invisible for them.
const SUPPRESSED = { suppressErrorStatuses: [400, 401, 403, 404, 409, 500] };

export const useWhatsappGatewayStatus = ({ headers, enabled = true } = {}) => {
  const [status, setStatus] = useState(null);
  const mountedRef = useRef(true);

  useEffect(() => () => {
    mountedRef.current = false;
  }, []);

  const refresh = useCallback(async () => {
    const payload = await api.get("/whatsapp/status", { headers, ...SUPPRESSED }).catch(() => null);
    if (!mountedRef.current) return null;
    const next = payload?.status || null;
    setStatus(next);
    return next;
  }, [headers]);

  useEffect(() => {
    if (!enabled) return undefined;
    refresh();
    const timer = window.setInterval(refresh, STATUS_POLL_MS);
    return () => window.clearInterval(timer);
  }, [enabled, refresh]);

  return { status, refresh };
};

export function WhatsappPairingCard({ headers, onConnected, className = "" }) {
  const { t } = useTranslation();
  const [pairing, setPairing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [connected, setConnected] = useState(false);
  const [phone, setPhone] = useState("");
  const pollRef = useRef(null);
  const mountedRef = useRef(true);
  const pairingRef = useRef(null);
  const onConnectedRef = useRef(onConnected);

  useEffect(() => {
    pairingRef.current = pairing;
  }, [pairing]);

  useEffect(() => {
    onConnectedRef.current = onConnected;
  }, [onConnected]);

  useEffect(() => () => {
    mountedRef.current = false;
    if (pollRef.current) window.clearInterval(pollRef.current);
  }, []);

  const requestPairing = useCallback(
    ({ restart = false } = {}) => {
      const trimmedPhone = phone.trim();
      return api.post(
        "/whatsapp/instance/connect",
        { ...(trimmedPhone ? { number: trimmedPhone } : {}), ...(restart ? { restart: true } : {}) },
        { headers, ...SUPPRESSED }
      );
    },
    [headers, phone]
  );

  // The operator has no way to tell the gateway "I scanned it" — WhatsApp tells
  // Evolution, not the browser. So watch the connection state until it flips,
  // then say so on screen and let the page reload its conversations.
  const watchUntilConnected = useCallback(() => {
    if (pollRef.current) window.clearInterval(pollRef.current);
    const startedAt = Date.now();
    pollRef.current = window.setInterval(async () => {
      const payload = await api.get("/whatsapp/status", { headers, ...SUPPRESSED }).catch(() => null);
      if (!mountedRef.current) return;
      if (payload?.status?.connected === true) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
        setConnected(true);
        setPairing(null);
        if (typeof onConnected === "function") onConnected();
        return;
      }
      if (Date.now() - startedAt > PAIRING_TIMEOUT_MS) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
    }, PAIRING_POLL_MS);
  }, [headers, onConnected]);

  const start = useCallback(async ({ restart = false } = {}) => {
    setBusy(true);
    setError("");
    const payload = await requestPairing({ restart }).catch((requestError) => ({ __error: requestError?.message || "" }));
    if (!mountedRef.current) return;
    setBusy(false);

    if (payload?.__error !== undefined) {
      setError(payload.__error || t("aiSupport.integrations.whatsapp.pairing.failed"));
      return;
    }
    if (payload?.already_connected) {
      setConnected(true);
      if (typeof onConnected === "function") onConnected();
      return;
    }
    if (!payload?.qr_image && !payload?.pairing_code) {
      setError(t("aiSupport.integrations.whatsapp.pairing.noQr"));
      return;
    }
    setPairing(payload);
    watchUntilConnected();
  }, [onConnected, requestPairing, t, watchUntilConnected]);

  // A WhatsApp QR is only valid for ~20 seconds, so a code left on screen is dead
  // long before the operator has walked to the shop phone. Rotate it. And if the
  // gateway hands back the SAME code — a wedged `connecting` session repeats its
  // cached one forever — escalate to a restart, because that code will never work.
  useEffect(() => {
    if (connected || !pairing?.qr_image) return undefined;
    const timer = window.setInterval(async () => {
      let next = await requestPairing().catch(() => null);
      if (next && next.qr_code && next.qr_code === pairingRef.current?.qr_code) {
        next = await requestPairing({ restart: true }).catch(() => null);
      }
      if (!mountedRef.current || !next) return;
      if (next.already_connected) {
        setConnected(true);
        setPairing(null);
        if (typeof onConnectedRef.current === "function") onConnectedRef.current();
        return;
      }
      if (next.qr_image || next.pairing_code) setPairing(next);
    }, QR_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [connected, pairing?.qr_image, requestPairing]);

  if (connected) {
    return (
      <p className={`flex items-center gap-2 rounded-xl bg-emerald-500/10 px-3 py-2 text-[12px] font-bold text-emerald-700 dark:text-emerald-200 ${className}`}>
        <Check className="h-4 w-4 shrink-0" />
        {t("aiSupport.integrations.whatsapp.pairing.connected")}
      </p>
    );
  }

  return (
    <div className={`space-y-3 ${className}`}>
      {pairing ? (
        <div className="space-y-2">
          {pairing.qr_image ? (
            <>
              <img
                src={pairing.qr_image}
                alt={t("aiSupport.integrations.whatsapp.pairing.title")}
                className="mx-auto h-52 w-52 rounded-xl bg-white p-2"
              />
              <p className="text-[11px] leading-5 text-slate-600 dark:text-slate-300">
                {t("aiSupport.integrations.whatsapp.pairing.scanHint")}
              </p>
            </>
          ) : null}
          {pairing.pairing_code ? (
            <p className="text-[11px] leading-5 text-slate-600 dark:text-slate-300">
              {t("aiSupport.integrations.whatsapp.pairing.codeHint")}{" "}
              <span className="select-all font-mono text-[15px] font-black tracking-[0.2em] text-slate-900 dark:text-slate-50">
                {pairing.pairing_code}
              </span>
            </p>
          ) : null}
          <p className="flex items-center gap-2 text-[11px] font-bold text-slate-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {t("aiSupport.integrations.whatsapp.pairing.waiting")}
          </p>
          <p className="text-[11px] leading-5 text-slate-500">{t("aiSupport.integrations.whatsapp.pairing.expired")}</p>
        </div>
      ) : (
        <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300">
          {t("aiSupport.integrations.whatsapp.pairing.phoneLabel")}
          <input
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            inputMode="tel"
            placeholder="201XXXXXXXXX"
            className="mt-1 h-9 w-full rounded-xl bg-white/80 px-3 text-[13px] font-medium text-slate-900 outline-none ring-1 ring-slate-300 focus:ring-slate-500 dark:bg-slate-900/60 dark:text-slate-50 dark:ring-slate-700"
          />
        </label>
      )}

      <button
        type="button"
        // "New code" forces a restart: without it the gateway just repeats the
        // cached code the operator has already failed to scan.
        onClick={() => start({ restart: Boolean(pairing) })}
        disabled={busy}
        className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-[12px] font-black text-slate-50 disabled:opacity-60 dark:bg-slate-50 dark:text-slate-900"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
        {pairing
          ? t("aiSupport.integrations.whatsapp.pairing.refresh")
          : t("aiSupport.integrations.whatsapp.pairing.start")}
      </button>

      {error ? <p className="text-[11px] font-bold text-rose-600 dark:text-rose-300">{error}</p> : null}
    </div>
  );
}

export default function WhatsappSessionAlert({ headers, enabled = true, onConnected, className = "" }) {
  const { t } = useTranslation();
  const { status, refresh } = useWhatsappGatewayStatus({ headers, enabled });
  const [open, setOpen] = useState(false);

  const disconnected = isWhatsappSessionDown(status);

  useEffect(() => {
    if (!disconnected) setOpen(false);
  }, [disconnected]);

  const handleConnected = useCallback(() => {
    refresh();
    if (typeof onConnected === "function") onConnected();
  }, [onConnected, refresh]);

  if (!disconnected) return null;

  return (
    <div className={`rounded-2xl bg-amber-400/15 p-3 ring-1 ring-amber-500/40 ${className}`}>
      <button type="button" onClick={() => setOpen((current) => !current)} className="flex w-full items-start gap-2 text-right">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-300" />
        <span className="flex-1">
          <span className="block text-[12px] font-black text-amber-900 dark:text-amber-100">
            {t("aiSupport.inbox.channelAlert.whatsappTitle")}
          </span>
          <span className="mt-0.5 block text-[11px] leading-5 text-amber-900/80 dark:text-amber-100/80">
            {t("aiSupport.inbox.channelAlert.whatsappBody")}
            {status?.state ? ` (${t("aiSupport.inbox.channelAlert.stateLabel")}: ${status.state})` : ""}
          </span>
        </span>
      </button>
      {open ? <WhatsappPairingCard headers={headers} onConnected={handleConnected} className="mt-3" /> : null}
    </div>
  );
}
