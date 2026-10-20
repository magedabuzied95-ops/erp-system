// WhatsApp → Connect Account (inbox top bar). The centralised onboarding card (Genie parity):
// quota bar, checklist, and "Continue with Meta" running Meta's Embedded Signup — either for a new
// Cloud API number or for a number that stays on the WhatsApp Business app (coexistence).
//
// The dialog half is shared with the integrations card (same SDK loader, same trusted origins,
// same /whatsapp/embedded-signup/state + /callback). What follows the callback lives in
// /whatsapp-official/connect: a new number asks for a 6-digit PIN and is registered; a
// coexistence number is never registered — the server runs Meta's contacts/history syncs instead.

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, ExternalLink, Home, KeyRound, Lock, RefreshCw, Smartphone } from "lucide-react";
import { FaWhatsapp } from "react-icons/fa";

import { api } from "../../../../shared/api/api";
import { ActionButton, PanelSkeleton, clean } from "../integrations/integrationsUi.jsx";
import { TRUSTED_SIGNUP_ORIGINS, loadFacebookSdk } from "../integrations/WhatsAppEmbeddedSignupCard.jsx";

const SUPPRESSED = { suppressErrorStatuses: [400, 403, 404, 409, 500, 502, 504] };
const FINISH_EVENTS = new Set(["FINISH", "FINISH_ONLY_WABA", "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING"]);

const QUALITY_TONE = {
  GREEN: "text-emerald-300",
  YELLOW: "text-amber-300",
  RED: "text-rose-300",
};

const statusTone = (status) => {
  if (status === "connected") return "border-emerald-300/25 bg-emerald-400/10 text-emerald-100";
  if (status === "suspended") return "border-amber-300/25 bg-amber-400/10 text-amber-100";
  return "border-white/10 bg-white/[0.06] text-slate-300";
};

// Literal keys so a missing translation stays greppable.
const statusLabel = (t, status) => {
  if (status === "connected") return t("waOfficialConnect.status.connected");
  if (status === "suspended") return t("waOfficialConnect.status.suspended");
  if (status === "disconnected") return t("waOfficialConnect.status.disconnected");
  return status || "—";
};

// A new (non-coexistence) number still waiting for its PIN: registration failed, or it was never
// attempted and Meta did not already report the number as connected when it was onboarded.
const needsRegistration = (number = {}) => {
  if (number.status !== "connected" || number.coexistence) return false;
  if (number.registration_status === "registered") return false;
  if (number.registration_status === "failed") return true;
  return String(number.onboarding_result?.phone_number_status || "").toUpperCase() !== "CONNECTED";
};

export default function WhatsAppConnectPanel({ headers, onOpenSection }) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [overview, setOverview] = useState({ config: null, quota: { connected: 0, max: 20 }, numbers: [] });
  const [mode, setMode] = useState("cloud");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  // The number waiting for its PIN (a new Cloud API number that is not registered yet).
  const [pinFor, setPinFor] = useState(null);
  const [pin, setPin] = useState("");

  const mountedRef = useRef(true);
  const signupDataRef = useRef({});
  const stateRef = useRef("");
  const modeRef = useRef("cloud");

  useEffect(() => () => { mountedRef.current = false; }, []);

  const load = useCallback(async () => {
    try {
      const payload = await api.get("/whatsapp-official/connect/overview", { headers, ...SUPPRESSED });
      if (!mountedRef.current) return;
      setOverview({
        config: payload?.config || null,
        quota: payload?.quota || { connected: 0, max: 20 },
        numbers: Array.isArray(payload?.numbers) ? payload.numbers : [],
      });
    } catch (loadError) {
      if (mountedRef.current) setError(loadError?.message || t("waOfficialConnect.errors.load"));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [headers, t]);

  useEffect(() => { void load(); }, [load]);

  // Meta's dialog reports FINISH / CANCEL / ERROR through postMessage; only Meta's origins count.
  useEffect(() => {
    const onMessage = (event) => {
      if (!TRUSTED_SIGNUP_ORIGINS.has(event.origin)) return;
      let payload = event.data;
      if (typeof payload === "string") {
        try { payload = JSON.parse(payload); } catch { return; }
      }
      if (!payload || payload.type !== "WA_EMBEDDED_SIGNUP") return;
      const data = payload.data || {};
      if (FINISH_EVENTS.has(data.event)) {
        signupDataRef.current = {
          waba_id: clean(data.waba_id),
          phone_number_id: clean(data.phone_number_id),
          business_id: clean(data.business_id),
          event: data,
        };
        setNotice(t("waOfficialConnect.flow.finishing"));
      } else if (data.event === "CANCEL") {
        signupDataRef.current = {};
        setError(t("waOfficialConnect.errors.cancelled", { step: clean(data.current_step) || "-" }));
      } else if (data.event === "ERROR") {
        signupDataRef.current = {};
        setError(clean(data.error_message) || t("waOfficialConnect.errors.failed"));
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [t]);

  const submitCode = useCallback(async (code) => {
    setBusy("connect");
    setError("");
    try {
      const captured = signupDataRef.current || {};
      const chosenMode = captured.event?.event === "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING" ? "coexistence" : modeRef.current;
      const result = await api.post("/whatsapp/embedded-signup/callback", {
        code,
        state: stateRef.current,
        wabaId: captured.waba_id || "",
        phoneNumberId: captured.phone_number_id || "",
        businessId: captured.business_id || "",
        event: captured.event || null,
      }, { headers, ...SUPPRESSED });
      signupDataRef.current = {};
      stateRef.current = "";
      const integration = result?.integration;
      if (!integration?.id) throw new Error(t("waOfficialConnect.errors.failed"));
      // Step after Meta: coexistence → syncs on the server; new number → ask for the PIN.
      const completed = await api.post("/whatsapp-official/connect/complete", { id: integration.id, mode: chosenMode }, { headers, ...SUPPRESSED });
      if (!mountedRef.current) return;
      if (completed?.coexistence) {
        setNotice(t("waOfficialConnect.flow.coexistenceDone"));
      } else {
        setPinFor(completed?.integration || integration);
        setPin("");
        setNotice(t("waOfficialConnect.flow.connectedNeedsPin"));
      }
      await load();
    } catch (submitError) {
      if (mountedRef.current) setError(submitError?.message || t("waOfficialConnect.errors.failed"));
    } finally {
      if (mountedRef.current) setBusy("");
    }
  }, [headers, load, t]);

  const startSignup = useCallback(async () => {
    setError("");
    setNotice("");
    setPinFor(null);
    signupDataRef.current = {};
    modeRef.current = mode;
    const config = overview.config;
    if (!config?.app_id || !config?.config_id) {
      setError(t("waOfficialConnect.errors.notConfigured"));
      return;
    }
    setBusy("launch");
    try {
      const session = await api.post("/whatsapp/embedded-signup/state", {}, { headers, ...SUPPRESSED });
      stateRef.current = clean(session?.state);
      const FB = await loadFacebookSdk({ appId: config.app_id, graphVersion: config.graph_version });
      FB.login(
        (response) => {
          const code = clean(response?.authResponse?.code);
          if (!code) {
            setBusy("");
            setError((current) => current || t("waOfficialConnect.errors.noCode"));
            return;
          }
          submitCode(code);
        },
        {
          config_id: config.config_id,
          // A CODE for the server, never a browser token.
          response_type: "code",
          override_default_response_type: true,
          extras: mode === "coexistence"
            ? { setup: {}, featureType: "whatsapp_business_app_onboarding", sessionInfoVersion: "3" }
            : { setup: {}, featureType: "", sessionInfoVersion: "3" },
        }
      );
    } catch (launchError) {
      setBusy("");
      setError(launchError?.message === "SDK_BLOCKED" ? t("waOfficialConnect.errors.sdkBlocked") : launchError?.message || t("waOfficialConnect.errors.failed"));
    }
  }, [headers, mode, overview.config, submitCode, t]);

  const register = async () => {
    if (!pinFor) return;
    if (!/^\d{6}$/.test(pin)) {
      setError(t("waOfficialConnect.pin.invalid"));
      return;
    }
    setBusy("register");
    setError("");
    try {
      const result = await api.post("/whatsapp-official/connect/register", { id: pinFor.id, pin }, { headers, ...SUPPRESSED });
      if (!mountedRef.current) return;
      if (result?.registration?.ok) {
        setPinFor(null);
        setPin("");
        setNotice(t("waOfficialConnect.pin.done"));
      } else {
        setError(t("waOfficialConnect.pin.metaRefused", { error: result?.registration?.error || "-" }));
      }
      await load();
    } catch (registerError) {
      if (mountedRef.current) setError(registerError?.message || t("waOfficialConnect.errors.failed"));
    } finally {
      if (mountedRef.current) setBusy("");
    }
  };

  const refreshNumber = async (id) => {
    setBusy(`refresh:${id}`);
    setError("");
    try {
      const result = await api.post("/whatsapp-official/connect/refresh", { id }, { headers, ...SUPPRESSED });
      if (result && result.ok === false && result.error && mountedRef.current) setError(result.error);
      await load();
    } catch (refreshError) {
      if (mountedRef.current) setError(refreshError?.message || t("waOfficialConnect.errors.failed"));
    } finally {
      if (mountedRef.current) setBusy("");
    }
  };

  if (loading) return <PanelSkeleton rows={4} />;

  const { config, quota, numbers } = overview;
  const connectedCount = Number(quota?.connected || 0);
  const maxCount = Math.max(1, Number(quota?.max || 20));
  const quotaFull = connectedCount >= maxCount;
  const host = typeof window !== "undefined" ? window.location.host : "";
  const launching = busy === "launch" || busy === "connect";
  const checklist = [
    t("waOfficialConnect.card.check.messages"),
    t("waOfficialConnect.card.check.templates"),
    t("waOfficialConnect.card.check.coexistence"),
    t("waOfficialConnect.card.check.admin"),
  ];
  const modes = [
    { key: "cloud", title: t("waOfficialConnect.mode.cloud"), hint: t("waOfficialConnect.mode.cloudHint") },
    { key: "coexistence", title: t("waOfficialConnect.mode.coexistence"), hint: t("waOfficialConnect.mode.coexistenceHint") },
  ];

  return (
    <div className="space-y-6">
      <div className="mx-auto w-full max-w-md">
        <div className="mb-4 flex justify-center">
          <span className="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 shadow-lg shadow-emerald-900/40">
            <FaWhatsapp className="h-6 w-6 text-white" aria-hidden="true" />
          </span>
        </div>

        <div className="mb-3 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
          <div className="flex min-w-0 items-center gap-2 rounded-2xl border border-white/10 bg-slate-950/40 px-3 py-2">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-emerald-500/90">
              <FaWhatsapp className="h-4 w-4 text-white" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <div className="text-[10px] font-black uppercase text-slate-500">{t("waOfficialConnect.card.channel")}</div>
              <div className="truncate text-xs font-black text-white">WhatsApp</div>
            </div>
          </div>
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden="true" />
          <div className="flex min-w-0 items-center gap-2 rounded-2xl border border-white/10 bg-slate-950/40 px-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-black uppercase text-slate-500">{t("waOfficialConnect.card.connectingTo")}</div>
              <div className="truncate text-xs font-black text-white" title={host}>{host || "—"}</div>
            </div>
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-white/10 text-slate-400">
              <Home className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
          </div>
        </div>

        <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-xl shadow-black/20">
          <div className="flex items-center gap-3">
            <span className="shrink-0 text-[11px] font-bold text-slate-400">
              {t("waOfficialConnect.card.quota", { connected: connectedCount, max: maxCount })}
            </span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full bg-teal-400" style={{ width: `${Math.min(100, (connectedCount / maxCount) * 100)}%` }} />
            </div>
          </div>

          <h2 className="mt-4 text-lg font-black text-white">{t("waOfficialConnect.card.title")}</h2>
          <p className="mt-1 text-xs leading-6 text-slate-400">{t("waOfficialConnect.card.subtitle")}</p>

          <ul className="mt-4 divide-y divide-white/5">
            {checklist.map((item) => (
              <li key={item} className="flex items-start gap-2 py-2 text-xs leading-5 text-slate-300">
                <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" aria-hidden="true" />
                <span>{item}</span>
              </li>
            ))}
          </ul>

          <div className="mt-4 grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label={t("waOfficialConnect.mode.label")}>
            {modes.map((option) => (
              <button
                key={option.key}
                type="button"
                role="radio"
                aria-checked={mode === option.key}
                onClick={() => setMode(option.key)}
                className={`rounded-2xl border p-3 text-start transition ${mode === option.key ? "border-emerald-300/50 bg-emerald-400/10" : "border-white/10 bg-slate-950/30 hover:border-white/20"}`}
              >
                <div className="text-xs font-black text-white">{option.title}</div>
                <div className="mt-1 text-[11px] leading-5 text-slate-400">{option.hint}</div>
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={startSignup}
            disabled={launching || quotaFull || busy === "register"}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 to-green-500 px-4 py-3 text-sm font-black text-white shadow-lg shadow-emerald-900/30 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {launching ? <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            {t("waOfficialConnect.card.continue")}
          </button>
          <p className="mt-2 text-center text-[11px] text-slate-500">{t("waOfficialConnect.card.metaWillAsk")}</p>

          {quotaFull ? <p className="mt-3 rounded-xl border border-amber-300/20 bg-amber-400/10 p-3 text-xs leading-5 text-amber-100">{t("waOfficialConnect.card.quotaFull")}</p> : null}
          {config && !config.configured ? (
            <p className="mt-3 rounded-xl border border-amber-300/20 bg-amber-400/10 p-3 text-xs leading-5 text-amber-100">{t("waOfficialConnect.errors.notConfigured")}</p>
          ) : null}
          {config?.encryption && config.encryption.ok === false ? (
            <p className="mt-3 rounded-xl border border-amber-300/20 bg-amber-400/10 p-3 text-xs leading-5 text-amber-100">
              {t("waOfficialConnect.errors.encryptionMissing", { code: config.encryption.code })}
            </p>
          ) : null}

          {pinFor ? (
            <div className="mt-4 rounded-2xl border border-cyan-300/20 bg-cyan-400/5 p-4">
              <div className="flex items-center gap-2 text-xs font-black text-white">
                <KeyRound className="h-4 w-4 text-cyan-300" aria-hidden="true" />
                {t("waOfficialConnect.pin.title", { phone: pinFor.display_phone_number || pinFor.phone_number_id })}
              </div>
              <p className="mt-1 text-[11px] leading-5 text-slate-400">{t("waOfficialConnect.pin.hint")}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={pin}
                  onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="••••••"
                  aria-label={t("waOfficialConnect.pin.label")}
                  className="w-36 rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-center text-sm font-black tracking-[0.4em] text-white outline-none focus:border-cyan-300/50"
                />
                <ActionButton tone="emerald" icon={KeyRound} loading={busy === "register"} onClick={register}>
                  {t("waOfficialConnect.pin.submit")}
                </ActionButton>
                <ActionButton tone="ghost" onClick={() => setPinFor(null)}>
                  {t("waOfficialConnect.pin.later")}
                </ActionButton>
              </div>
            </div>
          ) : null}

          {notice ? <p className="mt-3 rounded-xl border border-emerald-300/20 bg-emerald-400/10 p-3 text-xs leading-5 text-emerald-100">{notice}</p> : null}
          {error ? <p className="mt-3 whitespace-pre-line rounded-xl border border-rose-300/20 bg-rose-400/10 p-3 text-xs leading-5 text-rose-100">{error}</p> : null}
        </div>

        <p className="mt-3 flex items-center justify-center gap-1.5 text-[11px] text-slate-500">
          <Lock className="h-3 w-3" aria-hidden="true" />
          {t("waOfficialConnect.card.secured")}
        </p>
      </div>

      <section className="rounded-3xl border border-white/10 bg-slate-900/60 p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-black text-white">{t("waOfficialConnect.list.title")}</h3>
            <p className="text-[11px] text-slate-500">{t("waOfficialConnect.list.subtitle")}</p>
          </div>
          <div className="flex gap-2">
            <ActionButton tone="ghost" icon={RefreshCw} onClick={() => { setLoading(true); void load(); }}>
              {t("waOfficialConnect.list.reload")}
            </ActionButton>
            {typeof onOpenSection === "function" ? (
              <ActionButton tone="ghost" icon={ExternalLink} onClick={() => onOpenSection("wa_accounts")}>
                {t("waOfficialConnect.list.openAccounts")}
              </ActionButton>
            ) : null}
          </div>
        </div>

        {numbers.length ? (
          <div className="space-y-2">
            {numbers.map((number) => (
              <div key={number.id} className="flex flex-wrap items-center gap-3 rounded-2xl border border-white/10 bg-slate-950/40 p-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-emerald-500/15 text-emerald-300">
                  <Smartphone className="h-4 w-4" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-black text-white">{number.verified_name || t("waOfficialConnect.list.noName")}</div>
                  <div className="truncate text-xs text-slate-400">{number.display_phone_number || number.phone_number_id}</div>
                </div>
                <span className={`rounded-full border px-2 py-0.5 text-[11px] font-bold ${statusTone(number.status)}`}>{statusLabel(t, number.status)}</span>
                <span className="text-[11px] text-slate-400">
                  {t("waOfficialConnect.list.quality")}:{" "}
                  <span className={`font-black ${QUALITY_TONE[String(number.quality_rating || "").toUpperCase()] || "text-slate-300"}`}>{number.quality_rating || "—"}</span>
                </span>
                {number.messaging_limit_tier ? (
                  <span className="text-[11px] text-slate-400">{t("waOfficialConnect.list.limit")}: <span className="font-black text-slate-200">{number.messaging_limit_tier}</span></span>
                ) : null}
                <span className={`rounded-full border px-2 py-0.5 text-[11px] font-bold ${number.coexistence ? "border-cyan-300/25 bg-cyan-400/10 text-cyan-100" : "border-white/10 bg-white/[0.06] text-slate-300"}`}>
                  {number.coexistence ? t("waOfficialConnect.list.coexistence") : t("waOfficialConnect.list.cloudOnly")}
                </span>
                {number.disconnect_reason ? <span className="w-full text-[11px] text-amber-200">{number.disconnect_reason}</span> : null}
                {number.registration_status === "failed" && number.registration_error ? (
                  <span className="w-full text-[11px] text-rose-200">{t("waOfficialConnect.pin.metaRefused", { error: number.registration_error })}</span>
                ) : null}
                <div className="flex w-full flex-wrap gap-2 sm:w-auto">
                  {needsRegistration(number) ? (
                    <ActionButton tone="emerald" icon={KeyRound} onClick={() => { setPinFor(number); setPin(""); setError(""); }}>
                      {t("waOfficialConnect.list.register")}
                    </ActionButton>
                  ) : null}
                  {number.status === "connected" ? (
                    <ActionButton tone="ghost" icon={RefreshCw} loading={busy === `refresh:${number.id}`} onClick={() => refreshNumber(number.id)}>
                      {t("waOfficialConnect.list.refresh")}
                    </ActionButton>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="rounded-2xl border border-dashed border-white/10 p-4 text-center text-xs text-slate-500">{t("waOfficialConnect.list.empty")}</p>
        )}
      </section>
    </div>
  );
}
