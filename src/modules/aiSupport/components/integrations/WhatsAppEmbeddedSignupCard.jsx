// WhatsApp Embedded Signup — the browser half.
//
// Meta's dialog hands back two things through two different channels, and both are needed:
//
//   * the AUTHORIZATION CODE, through the FB.login callback
//   * the WABA id / phone number id, through a window.postMessage event
//
// They arrive independently and in no guaranteed order, so the ids are held in a ref and the POST
// to our backend fires when the code lands, carrying whatever ids showed up. The code is never
// exchanged here: it goes straight to the server, which holds the app secret.
//
// The SDK is loaded on demand rather than on page load. It comes from connect.facebook.net, which
// ad blockers routinely block — the same thing that once broke the Meta pixel here — so a failed
// load has to say so plainly instead of leaving a button that does nothing.

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link2, Link2Off, MessageCircle, RefreshCw } from "lucide-react";

import { api } from "../../../../shared/api/api";
import {
  ActionButton,
  FieldRow,
  PanelSection,
  StatusPill,
  clean,
  formatDateTime,
  stateLabel,
} from "./integrationsUi.jsx";

const SDK_SCRIPT_ID = "facebook-jssdk";
const SDK_SRC = "https://connect.facebook.net/en_US/sdk.js";

// Meta's dialog posts from these origins. Anything else is not Meta and its payload is ignored:
// without this check any page that can reach this tab could fake a FINISH.
const TRUSTED_SIGNUP_ORIGINS = new Set([
  "https://www.facebook.com",
  "https://web.facebook.com",
  "https://business.facebook.com",
  "https://m.facebook.com",
]);

const loadFacebookSdk = ({ appId, graphVersion }) =>
  new Promise((resolve, reject) => {
    if (typeof window === "undefined") {
      reject(new Error("NO_WINDOW"));
      return;
    }
    const init = () => {
      try {
        window.FB.init({ appId, autoLogAppEvents: true, xfbml: false, version: graphVersion || "v20.0" });
        resolve(window.FB);
      } catch (error) {
        reject(error);
      }
    };
    if (window.FB) {
      init();
      return;
    }
    const existing = document.getElementById(SDK_SCRIPT_ID);
    if (!existing) {
      const script = document.createElement("script");
      script.id = SDK_SCRIPT_ID;
      script.src = SDK_SRC;
      script.async = true;
      script.crossOrigin = "anonymous";
      script.onerror = () => reject(new Error("SDK_BLOCKED"));
      document.body.appendChild(script);
    }
    // The script may already be in flight from an earlier click; either way the SDK announces
    // itself through fbAsyncInit, and the timeout is what turns "blocked" into a real message.
    const previousAsyncInit = window.fbAsyncInit;
    window.fbAsyncInit = () => {
      if (typeof previousAsyncInit === "function") previousAsyncInit();
      init();
    };
    const startedAt = Date.now();
    const poll = window.setInterval(() => {
      if (window.FB) {
        window.clearInterval(poll);
        init();
        return;
      }
      if (Date.now() - startedAt > 12000) {
        window.clearInterval(poll);
        reject(new Error("SDK_BLOCKED"));
      }
    }, 200);
  });

export default function WhatsAppEmbeddedSignupCard({ onConnected }) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState(null);
  const [integrations, setIntegrations] = useState([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const mountedRef = useRef(true);
  // The ids from the postMessage, waiting for the code from the login callback.
  const signupDataRef = useRef({});
  const stateRef = useRef("");

  useEffect(() => () => { mountedRef.current = false; }, []);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const result = await api.get("/whatsapp/embedded-signup/status", { suppressErrorStatuses: [400, 403, 404, 500] });
      if (!mountedRef.current) return;
      setConfig(result?.config || null);
      setIntegrations(Array.isArray(result?.integrations) ? result.integrations : []);
    } catch (loadError) {
      if (mountedRef.current) setError(loadError?.message || t("aiSupport.integrations.whatsapp.embeddedSignup.loadFailed"));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [t]);

  useEffect(() => { load(); }, [load]);

  /*
   * Meta's dialog reports its own progress here. FINISH carries the ids; CANCEL and ERROR are the
   * two ways it ends without them, and both have to be visible — a dialog the operator closed
   * looks identical to one that failed unless we say which happened.
   */
  useEffect(() => {
    const onMessage = (event) => {
      if (!TRUSTED_SIGNUP_ORIGINS.has(event.origin)) return;
      let payload = event.data;
      if (typeof payload === "string") {
        try { payload = JSON.parse(payload); } catch { return; }
      }
      if (!payload || payload.type !== "WA_EMBEDDED_SIGNUP") return;
      const data = payload.data || {};
      if (data.event === "FINISH" || data.event === "FINISH_ONLY_WABA" || data.event === "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING") {
        signupDataRef.current = {
          waba_id: clean(data.waba_id),
          phone_number_id: clean(data.phone_number_id),
          business_id: clean(data.business_id),
          event: data,
        };
        setNotice(t("aiSupport.integrations.whatsapp.embeddedSignup.finishing"));
        return;
      }
      if (data.event === "CANCEL") {
        signupDataRef.current = {};
        setError(t("aiSupport.integrations.whatsapp.embeddedSignup.cancelled", { step: clean(data.current_step) || "-" }));
        return;
      }
      if (data.event === "ERROR") {
        signupDataRef.current = {};
        setError(clean(data.error_message) || t("aiSupport.integrations.whatsapp.embeddedSignup.failed"));
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
      const result = await api.post("/whatsapp/embedded-signup/callback", {
        code,
        state: stateRef.current,
        wabaId: captured.waba_id || "",
        phoneNumberId: captured.phone_number_id || "",
        businessId: captured.business_id || "",
        event: captured.event || null,
      });
      if (!mountedRef.current) return;
      setNotice(t("aiSupport.integrations.whatsapp.embeddedSignup.connected"));
      signupDataRef.current = {};
      stateRef.current = "";
      await load({ silent: true });
      if (typeof onConnected === "function") onConnected(result?.integration || null);
    } catch (submitError) {
      if (mountedRef.current) setError(submitError?.message || t("aiSupport.integrations.whatsapp.embeddedSignup.failed"));
    } finally {
      if (mountedRef.current) setBusy("");
    }
  }, [load, onConnected, t]);

  const startSignup = useCallback(async () => {
    setError("");
    setNotice("");
    signupDataRef.current = {};
    if (!config?.app_id || !config?.config_id) {
      setError(t("aiSupport.integrations.whatsapp.embeddedSignup.notConfigured"));
      return;
    }
    setBusy("launch");
    try {
      // One-time state, minted server-side and echoed back with the code.
      const session = await api.post("/whatsapp/embedded-signup/state", {});
      stateRef.current = clean(session?.state);
      const FB = await loadFacebookSdk({ appId: config.app_id, graphVersion: config.graph_version });
      FB.login(
        (response) => {
          const code = clean(response?.authResponse?.code);
          if (!code) {
            setBusy("");
            // No code and no explicit dialog error means the operator closed the window.
            setError((current) => current || t("aiSupport.integrations.whatsapp.embeddedSignup.noCode"));
            return;
          }
          submitCode(code);
        },
        {
          config_id: config.config_id,
          // Embedded Signup returns a CODE, not a browser access token. Without both of these the
          // SDK falls back to a normal Facebook login and hands the browser a token instead —
          // which is exactly what must not happen.
          response_type: "code",
          override_default_response_type: true,
          extras: { setup: {}, featureType: "", sessionInfoVersion: "3" },
        }
      );
    } catch (launchError) {
      setBusy("");
      setError(
        launchError?.message === "SDK_BLOCKED"
          ? t("aiSupport.integrations.whatsapp.embeddedSignup.sdkBlocked")
          : launchError?.message || t("aiSupport.integrations.whatsapp.embeddedSignup.failed")
      );
    }
  }, [config, submitCode, t]);

  const disconnect = useCallback(async (id) => {
    setBusy("disconnect");
    setError("");
    try {
      await api.post("/whatsapp/embedded-signup/disconnect", id ? { id } : {});
      setNotice(t("aiSupport.integrations.whatsapp.embeddedSignup.disconnected"));
      await load({ silent: true });
    } catch (disconnectError) {
      setError(disconnectError?.message || t("aiSupport.integrations.whatsapp.embeddedSignup.failed"));
    } finally {
      if (mountedRef.current) setBusy("");
    }
  }, [load, t]);

  const connected = integrations.find((row) => row.status === "connected") || null;
  const state = connected ? "connected" : config?.configured ? "off" : "error";

  return (
    <PanelSection
      icon={MessageCircle}
      title={t("aiSupport.integrations.whatsapp.embeddedSignup.title")}
      subtitle={t("aiSupport.integrations.whatsapp.embeddedSignup.subtitle")}
      tone={connected ? "emerald" : "slate"}
      action={
        <>
          <StatusPill state={state}>{connected ? t("aiSupport.integrations.whatsapp.embeddedSignup.statusConnected") : stateLabel(t, state)}</StatusPill>
          <ActionButton tone="ghost" icon={RefreshCw} loading={loading} onClick={() => load({ silent: true })}>
            {t("aiSupport.integrations.common.refresh")}
          </ActionButton>
        </>
      }
    >
      {connected ? (
        <>
          <div className="grid gap-2 sm:grid-cols-2">
            <FieldRow label={t("aiSupport.integrations.whatsapp.embeddedSignup.phone")} value={connected.display_phone_number} />
            <FieldRow label={t("aiSupport.integrations.whatsapp.embeddedSignup.verifiedName")} value={connected.verified_name} />
            <FieldRow label={t("aiSupport.integrations.whatsapp.embeddedSignup.wabaId")} value={connected.waba_id} />
            <FieldRow label={t("aiSupport.integrations.whatsapp.embeddedSignup.phoneNumberId")} value={connected.phone_number_id} />
            <FieldRow
              label={t("aiSupport.integrations.whatsapp.embeddedSignup.coexistence")}
              value={t(`aiSupport.integrations.whatsapp.embeddedSignup.coexistenceState.${connected.coexistence_state}`, connected.coexistence_state)}
            />
            <FieldRow
              label={t("aiSupport.integrations.whatsapp.embeddedSignup.webhook")}
              value={connected.webhook_subscribed ? t("aiSupport.integrations.common.on") : t("aiSupport.integrations.common.off")}
            />
            <FieldRow label={t("aiSupport.integrations.whatsapp.embeddedSignup.connectedAt")} value={formatDateTime(connected.connected_at)} />
            <FieldRow label={t("aiSupport.integrations.whatsapp.embeddedSignup.quality")} value={connected.quality_rating} />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <ActionButton tone="ghost" icon={Link2} loading={busy === "launch" || busy === "connect"} onClick={startSignup}>
              {t("aiSupport.integrations.whatsapp.embeddedSignup.reconnect")}
            </ActionButton>
            <ActionButton tone="rose" icon={Link2Off} loading={busy === "disconnect"} onClick={() => disconnect(connected.id)}>
              {t("aiSupport.integrations.whatsapp.embeddedSignup.disconnect")}
            </ActionButton>
          </div>
          <p className="mt-3 text-[11px] leading-5 text-slate-500">
            {t("aiSupport.integrations.whatsapp.embeddedSignup.disconnectNote")}
          </p>
        </>
      ) : (
        <>
          <p className="text-xs leading-6 text-slate-400">{t("aiSupport.integrations.whatsapp.embeddedSignup.intro")}</p>
          <div className="mt-3">
            <ActionButton tone="meta" icon={Link2} loading={busy === "launch" || busy === "connect"} onClick={startSignup}>
              {t("aiSupport.integrations.whatsapp.embeddedSignup.connect")}
            </ActionButton>
          </div>
          {config && !config.configured ? (
            <p className="mt-3 rounded-xl border border-amber-300/20 bg-amber-400/10 p-3 text-xs leading-5 text-amber-100">
              {t("aiSupport.integrations.whatsapp.embeddedSignup.notConfigured")}
            </p>
          ) : null}
          {config?.encryption && config.encryption.ok === false ? (
            <p className="mt-2 rounded-xl border border-amber-300/20 bg-amber-400/10 p-3 text-xs leading-5 text-amber-100">
              {t("aiSupport.integrations.whatsapp.embeddedSignup.encryptionMissing", { code: config.encryption.code })}
            </p>
          ) : null}
        </>
      )}

      {notice ? <p className="mt-3 rounded-xl border border-emerald-300/20 bg-emerald-400/10 p-3 text-xs leading-5 text-emerald-100">{notice}</p> : null}
      {error ? <p className="mt-3 rounded-xl border border-rose-300/20 bg-rose-400/10 p-3 text-xs leading-5 text-rose-100">{error}</p> : null}
    </PanelSection>
  );
}
