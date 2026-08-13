import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { AlertTriangle, Bot, CheckCircle2, Clock, Copy, FileText, KeyRound, MessageCircle, PlayCircle, Plus, RefreshCw, Send, Settings2, ShieldCheck, Sparkles, Trash2, Workflow, Zap } from "lucide-react";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";
import MarketingStudioHeader from "../components/MarketingStudioHeader";

import {
  createCommentDmRule,
  deleteCommentDmRule,
  enableMetaWebhookSubscription,
  getCommentDmLogs,
  getCommentDmRules,
  getMarketingSettings,
  getMetaCapabilities,
  getMetaHealth,
  getMetaIntegrationStatus,
  getMetaWebhookHealth,
  saveInstagramBusinessAccessToken,
  removeInstagramBusinessAccessToken,
  saveInstagramAppSecret,
  removeInstagramAppSecret,
  refreshMarketingMetaTokens,
  getMetaOAuthPages,
  getMetaSetupCheck,
  getMetaWebhookSelfTest,
  selectMetaOAuthPage,
  startMetaOAuth,
  testMetaMessage,
  testMetaPublish,
  testCommentDmRule,
  testMarketingAutoRefresh,
  updateCommentDmRule,
  updateMarketingSettings,
} from "../services/marketingApi";

const blankRule = {
  name: "",
  platform: "facebook",
  post_id: "",
  platform_post_id: "",
  trigger_keywords: "",
  excluded_keywords: "",
  match_mode: "any",
    response_message: "مرحبًا {{commenter_name}}، شكرًا لتعليقك. أرسل لنا المقاس وسنساعدك في الطلب.",
  fallback_reply: "Thanks for your message. A team member will follow up shortly.",
  ai_generated_replies: true,
  template_name: "Default lead reply",
  is_active: true,
};

const listToInput = (value) => (Array.isArray(value) ? value.join(", ") : String(value || ""));

const inputToList = (value) =>
  String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

const META_OAUTH_TIMEOUT_MS = 30000;
const META_PARTIAL_SETUP_MESSAGE = "Connected partially — verify webhook to complete setup";

const metaOAuthDevLog = (message, details = {}) => {
  if (import.meta.env.DEV) {
    console.debug(`[meta-oauth] ${message}`, details);
  }
};

const statusTone = (connected) =>
  connected
    ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-100"
    : "border-amber-400/25 bg-amber-400/10 text-amber-100";

const hubStatusTone = (status = "") => {
  const value = String(status || "").toLowerCase();
  if (["connected", "fully_connected", "healthy", "active", "success"].includes(value)) return "border-emerald-400/25 bg-emerald-400/10 text-emerald-100";
  if (["partially_connected", "partial", "missing_permissions", "permissions_unknown", "webhook_issue", "expiring_soon"].includes(value)) return "border-amber-400/25 bg-amber-400/10 text-amber-100";
  return "border-rose-400/25 bg-rose-400/10 text-rose-100";
};

const statusLabel = (status = "") => {
  const labels = {
    fully_connected: "Connected",
    connected: "Connected",
    partially_connected: "Partially connected",
    missing_permissions: "Missing permissions",
    permissions_unknown: "Permissions unknown",
    token_expired: "Token expired",
    webhook_issue: "Webhook issue",
    not_connected: "Not connected",
  };
  return labels[String(status || "").toLowerCase()] || status || "Not connected";
};

function StatusBadge({ status }) {
  return <span className={`inline-flex min-h-9 items-center rounded-full border px-3 py-1.5 text-sm font-black ${hubStatusTone(status)}`}>{statusLabel(status)}</span>;
}

const isConnectedStatus = (status = "") => ["connected", "fully_connected"].includes(String(status || "").toLowerCase());

const subscriptionVerified = (subscription = {}) =>
  subscription.subscribed_apps_status === "subscribed" &&
  subscription.webhook_subscription_status === "subscribed";

const capabilityConnected = (capability = {}) =>
  capability?.connected === true || capability?.ok === true || isConnectedStatus(capability?.status);

const resolveMetaSetupCompletion = ({ status = {}, health = {}, capabilities = {}, webhook = {}, form = {} } = {}) => {
  const safeStatus = status && typeof status === "object" ? status : {};
  const safeHealth = health && typeof health === "object" ? health : {};
  const safeCapabilities = capabilities && typeof capabilities === "object" ? capabilities : {};
  const safeWebhook = webhook && typeof webhook === "object" ? webhook : {};
  const safeForm = form && typeof form === "object" ? form : {};
  const backendCompletion =
    safeHealth?.setup_completion ||
    safeCapabilities?.setup_completion ||
    safeStatus?.setup_completion ||
    safeWebhook?.setup_completion ||
    {};
  const config = safeStatus?.config || safeHealth?.config || {};
  const subscription = safeWebhook?.subscribed_apps || safeStatus?.subscribed_apps || {};
  const capabilityMap = safeCapabilities?.capabilities || safeHealth?.capabilities || {};
  const channels = safeStatus?.channels || safeHealth?.channels || {};
  const token = safeHealth?.token || {};
  const tokenActive = Boolean(
    config.page_access_token_configured &&
      !["token_expired", "invalid", "revoked", "error"].includes(String(token.status || config.token_health_status || config.token_status || "").toLowerCase())
  );
  const messengerConnected = Boolean(
    channels.facebook?.messenger_connected ||
      capabilityConnected(capabilityMap.messenger) ||
      capabilityConnected(capabilityMap.facebook_messenger)
  );
  const instagramMessagingConnected = Boolean(
    channels.instagram?.dm_connected ||
      capabilityConnected(capabilityMap.instagram_dm) ||
      capabilityConnected(capabilityMap.instagram)
  );
  const operationalMessagingVerified = Boolean(
    tokenActive &&
      (safeForm.page_id || config.facebook_page_id) &&
      messengerConnected &&
      (safeForm.instagram_account_id || config.instagram_business_account_id) &&
      instagramMessagingConnected
  );
  const completion = {
    oauth_connected: Boolean(backendCompletion.oauth_connected ?? (safeForm.page_access_token_set || safeForm.access_token_set || config.page_access_token_configured)),
    page_selected: Boolean(backendCompletion.page_selected ?? (safeForm.page_id || config.facebook_page_id)),
    instagram_connected: Boolean(backendCompletion.instagram_connected ?? (safeForm.instagram_account_id || config.instagram_business_account_id)),
    permissions_saved: Boolean(backendCompletion.permissions_saved ?? (safeCapabilities?.permissions?.granted?.length || isConnectedStatus(safeHealth?.overall_status))),
    webhook_verified: Boolean(backendCompletion.webhook_verified === true || operationalMessagingVerified || safeWebhook?.webhook_verified || safeHealth?.webhook?.webhook_verified),
    webhook_enabled: Boolean(backendCompletion.webhook_enabled === true || operationalMessagingVerified || safeWebhook?.webhook_enabled || config.webhook_enabled),
    subscribed_apps_verified: Boolean(backendCompletion.subscribed_apps_verified === true || operationalMessagingVerified || subscriptionVerified(subscription)),
    operational_messaging_verified: Boolean(backendCompletion.operational_messaging_verified ?? operationalMessagingVerified),
  };
  completion.complete = Boolean(
    backendCompletion.complete === true ||
      (completion.oauth_connected &&
        completion.page_selected &&
        completion.instagram_connected &&
        completion.permissions_saved &&
        completion.webhook_verified &&
        completion.webhook_enabled &&
        completion.subscribed_apps_verified)
  );
  completion.overall_status = completion.complete ? "fully_connected" : safeHealth?.overall_status || safeStatus?.overall_status || config.status || "not_connected";
  completion.checklist_count = completion.complete
    ? 6
    : [
        completion.oauth_connected,
        completion.page_selected,
        completion.instagram_connected,
        completion.permissions_saved,
        completion.webhook_verified && completion.webhook_enabled && completion.subscribed_apps_verified,
      ].filter(Boolean).length;
  return completion;
};

function SkeletonBlock() {
  return (
    <div className="animate-pulse rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="h-4 w-32 rounded bg-[var(--surface)]" />
      <div className="mt-3 h-3 w-full rounded bg-[var(--surface)]" />
      <div className="mt-2 h-3 w-2/3 rounded bg-[var(--surface)]" />
    </div>
  );
}

function CopyButton({ value, label = "" }) {
  const { t } = useTranslation();
  const copyLabel = label || t("marketing.metaSettings.actions.copy");
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard?.writeText(String(value || ""));
        toast.success(t("marketing.metaSettings.toasts.copiedLabel", { label: copyLabel }));
      }}
      className="inline-flex min-h-[var(--control-height-md)] items-center gap-2 rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2 text-sm font-black text-[var(--text)] transition hover:bg-[var(--surface)]"
    >
      <Copy className="h-3.5 w-3.5" />
      {copyLabel}
    </button>
  );
}

function CapabilityPill({ connected, connectedLabel = "Connected", disconnectedLabel = "Not connected" }) {
  return <span className={`inline-flex min-h-9 items-center rounded-full border px-3 py-1.5 text-sm font-black ${statusTone(connected)}`}>{connected ? connectedLabel : disconnectedLabel}</span>;
}

function CapabilityCard({ icon: Icon, title, subtitle, connected, status, checks = [], details, connectedLabel, disconnectedLabel, emptyLabel, onTest }) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-[var(--shadow-card)]">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-amber-300/20 bg-amber-400/10 text-amber-200">
            <Icon className="h-5 w-5" />
          </span>
          <div>
            <div className="font-black text-[var(--text)]">{title}</div>
            {subtitle ? <div className="mt-1 text-sm leading-6 text-[var(--muted)]">{subtitle}</div> : null}
          </div>
        </div>
        {status ? <StatusBadge status={status} /> : <CapabilityPill connected={connected} connectedLabel={connectedLabel} disconnectedLabel={disconnectedLabel} />}
      </div>
      {checks.length ? (
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {checks.map((check) => (
            <div key={check.label} className="flex min-h-10 items-center gap-2.5 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--muted)]">
              <CheckCircle2 className={`h-4 w-4 shrink-0 ${check.ok ? "text-emerald-300" : "text-amber-300"}`} />
              <span>{check.label}</span>
            </div>
          ))}
        </div>
      ) : null}
      {details?.length ? (
        <div className="mt-4 grid gap-2.5 text-sm text-[var(--muted)]">
          {details.map(([label, value]) => (
            <div key={label} className="flex justify-between gap-3">
              <span>{label}</span>
              <span className="text-right font-bold text-[var(--text)]">{value || emptyLabel || "Not available"}</span>
            </div>
          ))}
        </div>
      ) : null}
      {onTest ? (
        <button onClick={onTest} className="mt-4 inline-flex min-h-[var(--control-height-md)] items-center gap-2 rounded-[var(--radius-control)] border border-amber-400/25 bg-amber-400/10 px-3.5 py-2 text-sm font-black text-amber-100">
          <PlayCircle className="h-4 w-4" />
          Test live
        </button>
      ) : null}
    </div>
  );
}

export default function MarketingSettings() {
  const { t } = useTranslation();
  const location = useLocation();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingInstagramToken, setSavingInstagramToken] = useState(false);
  const [instagramAccessToken, setInstagramAccessToken] = useState("");
  const [savingInstagramSecret, setSavingInstagramSecret] = useState(false);
  const [instagramAppSecret, setInstagramAppSecret] = useState("");
  const [reconnecting, setReconnecting] = useState(false);
  const [error, setError] = useState("");
  const [rules, setRules] = useState([]);
  const [logs, setLogs] = useState([]);
  const [metaStatus, setMetaStatus] = useState(null);
  const [metaHealth, setMetaHealth] = useState(null);
  const [metaCapabilities, setMetaCapabilities] = useState(null);
  const [webhookHealth, setWebhookHealth] = useState(null);
  const [webhookSelfTest, setWebhookSelfTest] = useState(null);
  const [webhookSelfTestLoading, setWebhookSelfTestLoading] = useState(false);
  const [setupCheck, setSetupCheck] = useState(null);
  const [diagnosticsLoading, setDiagnosticsLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState(false);
  const [oauthPages, setOauthPages] = useState([]);
  const [oauthResult, setOauthResult] = useState(null);
  const [completeSetupLoading, setCompleteSetupLoading] = useState(false);
  const [advancedMode, setAdvancedMode] = useState(false);
  const [wizardStep, setWizardStep] = useState(0);
  const oauthPopupRef = useRef(null);
  const oauthTimeoutRef = useRef(null);
  const oauthClosedIntervalRef = useRef(null);
  const [aiSettings, setAiSettings] = useState({
    autoReply: true,
    intentDetection: true,
    humanEscalation: true,
    smartLeadDetection: true,
  });
  const [simulator, setSimulator] = useState({
    commenter_name: "العميل",
    comment_text: "price and size please",
  });
  const [ruleForm, setRuleForm] = useState(blankRule);
  const [editingRuleId, setEditingRuleId] = useState(null);
  const [form, setForm] = useState({
    provider: "meta",
    page_id: "",
    instagram_account_id: "",
    access_token_encrypted: "",
    is_connected: false,
    access_token_set: false,
    long_lived_user_token_set: false,
    page_access_token_set: false,
    token_status: "missing",
    token_health_status: "missing",
    token_expires_at: null,
    token_last_validated_at: null,
    auto_refresh_enabled: false,
    last_auto_refresh_at: null,
    next_refresh_check_at: null,
    token_error_message: "",
  });

  const applySettings = (data = {}) => {
    setForm((current) => ({
      ...current,
      provider: data.provider || "meta",
      page_id: data.page_id || "",
      instagram_account_id: data.instagram_account_id || "",
      access_token_encrypted: "",
      is_connected: Boolean(data.is_connected),
      access_token_set: Boolean(data.access_token_set),
      long_lived_user_token_set: Boolean(data.long_lived_user_token_set),
      page_access_token_set: Boolean(data.page_access_token_set),
      token_status: data.token_status || data.token_health_status || "missing",
      token_health_status: data.token_health_status || data.token_status || "missing",
      token_expires_at: data.token_expires_at || null,
      token_last_validated_at: data.token_last_validated_at || null,
      auto_refresh_enabled: Boolean(data.auto_refresh_enabled),
      last_auto_refresh_at: data.last_auto_refresh_at || null,
      next_refresh_check_at: data.next_refresh_check_at || null,
      token_error_message: data.token_error_message || "",
    }));
  };

  const applyMetaStatus = (status = {}) => {
    setMetaStatus(status || null);
    const config = status?.config || {};
    if (!config || !Object.keys(config).length) return;
    setForm((current) => ({
      ...current,
      page_id: current.page_id || config.facebook_page_id || "",
      instagram_account_id: current.instagram_account_id || config.instagram_business_account_id || "",
      page_access_token_set: current.page_access_token_set || Boolean(config.page_access_token_configured),
      token_status: config.token_status || config.token_health_status || current.token_status,
      token_health_status: config.token_health_status || config.token_status || current.token_health_status,
      token_expires_at: config.token_expires_at || current.token_expires_at,
      auto_refresh_enabled: Boolean(config.auto_refresh_enabled ?? current.auto_refresh_enabled),
      last_auto_refresh_at: config.last_auto_refresh_at || current.last_auto_refresh_at,
      next_refresh_check_at: config.next_refresh_check_at || current.next_refresh_check_at,
    }));
  };

  const clearOAuthWatchers = useCallback(() => {
    if (oauthTimeoutRef.current) {
      window.clearTimeout(oauthTimeoutRef.current);
      oauthTimeoutRef.current = null;
    }
    if (oauthClosedIntervalRef.current) {
      window.clearInterval(oauthClosedIntervalRef.current);
      oauthClosedIntervalRef.current = null;
    }
    oauthPopupRef.current = null;
  }, []);

  const clearOAuthLoading = useCallback(
    (reason) => {
      clearOAuthWatchers();
      setOauthLoading(false);
      metaOAuthDevLog("loading cleared", { reason });
    },
    [clearOAuthWatchers]
  );

  const formatDateTime = (value) => {
    if (!value) return t("marketing.common.notAvailable");
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? t("marketing.common.notAvailable") : parsed.toLocaleString();
  };

  const applyRuleToForm = (rule = {}) => {
    setEditingRuleId(rule.id || null);
    setRuleForm({
      ...blankRule,
      ...rule,
      post_id: rule.post_id || "",
      trigger_keywords: listToInput(rule.trigger_keywords),
      excluded_keywords: listToInput(rule.excluded_keywords),
      is_active: Boolean(rule.is_active),
    });
  };

  const loadCommentDm = async () => {
    try {
      const [loadedRules, loadedLogs] = await Promise.all([getCommentDmRules(), getCommentDmLogs()]);
      setRules(Array.isArray(loadedRules) ? loadedRules : []);
      setLogs(Array.isArray(loadedLogs) ? loadedLogs : []);
    } catch (err) {
      toast.error(err?.message || t("marketing.automation.commentDm.loadFailed"));
    }
  };

  const loadMetaDiagnostics = async () => {
    setDiagnosticsLoading(true);
    const diagnostics = {};
    try {
      const [healthResult, capabilitiesResult, webhookResult, setupResult] = await Promise.allSettled([
        getMetaHealth({ suppressErrorStatuses: [400, 403, 404, 409, 500] }),
        getMetaCapabilities({ suppressErrorStatuses: [400, 403, 404, 409, 500] }),
        getMetaWebhookHealth({ suppressErrorStatuses: [400, 403, 404, 409, 500] }),
        getMetaSetupCheck({ suppressErrorStatuses: [400, 403, 404, 409, 500] }),
      ]);
      if (healthResult.status === "fulfilled") {
        diagnostics.health = healthResult.value;
        setMetaHealth(healthResult.value);
      }
      if (capabilitiesResult.status === "fulfilled") {
        diagnostics.capabilities = capabilitiesResult.value;
        setMetaCapabilities(capabilitiesResult.value);
      }
      if (webhookResult.status === "fulfilled") {
        diagnostics.webhook = webhookResult.value;
        setWebhookHealth(webhookResult.value);
      }
      if (setupResult.status === "fulfilled") {
        diagnostics.setup = setupResult.value;
        setSetupCheck(setupResult.value);
      }
      return diagnostics;
      console.log("[meta-ui] verify_webhook_response", {
        error: false,
        note: "request completed without thrown exception",
      });
    } finally {
      setDiagnosticsLoading(false);
    }
  };

  const refreshMetaStatus = async () => {
    const status = await getMetaIntegrationStatus({ suppressErrorStatuses: [400, 403, 404, 409, 500] });
    applyMetaStatus(status);
    const diagnostics = await loadMetaDiagnostics();
    const refreshedStatus = await getMetaIntegrationStatus({ suppressErrorStatuses: [400, 403, 404, 409, 500] });
    applyMetaStatus(refreshedStatus);
    metaOAuthDevLog("status refreshed", {
      overall_status: diagnostics.health?.overall_status,
      webhook_verified: diagnostics.webhook?.webhook_verified || diagnostics.health?.webhook?.webhook_verified,
    });
    return { status: refreshedStatus, diagnostics };
  };

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const [settingsResult, metaResult] = await Promise.allSettled([
          getMarketingSettings(),
          getMetaIntegrationStatus({ suppressErrorStatuses: [400, 403, 404, 409, 500] }),
        ]);
        const data = settingsResult.status === "fulfilled" ? settingsResult.value : null;
        if (active && data) {
          applySettings(data);
        }
        if (active && metaResult.status === "fulfilled") {
          applyMetaStatus(metaResult.value);
        }
        if (active && settingsResult.status === "rejected") {
          throw settingsResult.reason;
        }
        if (active) {
          await loadCommentDm();
          await loadMetaDiagnostics();
        }
      } catch (err) {
        if (active) {
          setError(err?.message || t("marketing.settings.loadFailed"));
          toast.error(err?.message || t("marketing.settings.loadFailed"));
        }
      } finally {
        if (active) setLoading(false);
      }
    };
    load();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const section = new URLSearchParams(location.search).get("section");
    if (!section) return;
    window.requestAnimationFrame(() => {
      document.getElementById(`marketing-settings-${section}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [location.search]);

  useEffect(() => {
    return () => clearOAuthWatchers();
  }, [clearOAuthWatchers]);

  const buildOAuthResult = ({ payload = {}, refreshed = {}, page = null } = {}) => {
    const status = refreshed?.status || {};
    const diagnostics = refreshed?.diagnostics || {};
    const config = status?.config || {};
    const webhook = diagnostics.webhook || diagnostics.health?.webhook || {};
    const health = diagnostics.health || {};
    const hasOAuthSetup = Boolean(
      page?.page_id ||
        payload.success ||
        config.page_access_token_configured ||
        config.facebook_page_id ||
        config.instagram_business_account_id ||
        form.page_access_token_set ||
        form.access_token_set ||
        form.page_id ||
        form.instagram_account_id
    );
    const completion = resolveMetaSetupCompletion({
      status,
      health,
      capabilities: diagnostics.capabilities,
      webhook,
      form,
    });
    const partial = hasOAuthSetup && !completion.complete;

    if (partial) {
      metaOAuthDevLog("partial setup detected", {
        webhook_verified: completion.webhook_verified,
        webhook_enabled: completion.webhook_enabled,
        subscribed_apps_verified: completion.subscribed_apps_verified,
        overall_status: completion.overall_status,
      });
    }

    return {
      status: partial ? "partially_connected" : payload.status || completion.overall_status || "connected",
      message: partial ? META_PARTIAL_SETUP_MESSAGE : payload.message || "Meta connected",
      page: page?.page_name || config.facebook_page_name || config.page_name || page?.page_id || form.page_id || "Connected page",
      instagram:
        page?.instagram_username ||
        page?.instagram_business_account_id ||
        config.instagram_username ||
        config.instagram_business_account_id ||
        form.instagram_account_id ||
        "لم يتم اختيار حساب إنستجرام",
    };
  };

  useEffect(() => {
    const onMessage = async (event) => {
      if (event?.data?.type !== "meta-oauth") return;
      const payload = event.data.payload || {};
      metaOAuthDevLog("callback received", { success: payload.success, status: payload.status });
      try {
        if (!payload.success) {
          toast.error(payload.message || "Meta connection failed");
          return;
        }
        if (payload.status === "pages_ready") {
          const [pagesPayload, refreshed] = await Promise.all([
            getMetaOAuthPages({ suppressErrorStatuses: [400, 403, 404, 409, 500] }),
            refreshMetaStatus(),
          ]);
          setOauthPages(Array.isArray(pagesPayload.pages) ? pagesPayload.pages : []);
          setOauthResult(buildOAuthResult({ payload, refreshed }));
          setWizardStep(1);
          toast.success(t("marketing.metaSettings.toasts.selectFacebookPage"));
          return;
        }
        setOauthPages([]);
        const refreshed = await refreshMetaStatus();
        setOauthResult(buildOAuthResult({ payload, refreshed }));
        toast.success(payload.message || "Meta connected");
      } catch (err) {
        toast.error(err?.message || "Unable to finish Meta OAuth");
      } finally {
        clearOAuthLoading("callback_received");
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [clearOAuthLoading, form.access_token_set, form.instagram_account_id, form.page_access_token_set, form.page_id]);

  const save = async () => {
    setSaving(true);
    try {
      const saved = await updateMarketingSettings(form);
      applySettings(saved);
      getMetaIntegrationStatus({ suppressErrorStatuses: [400, 403, 404, 409, 500] }).then(applyMetaStatus).catch(() => {});
      toast.success(t("marketing.settings.saved"));
    } catch (err) {
      toast.error(err?.message || t("marketing.settings.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const saveInstagramToken = async () => {
    if (!instagramAccessToken.trim()) {
      toast.error(t("marketing.metaSettings.toasts.enterInstagramToken"));
      return;
    }
    setSavingInstagramToken(true);
    try {
      const payload = await saveInstagramBusinessAccessToken({
        access_token: instagramAccessToken,
        instagram_business_account_id: form.instagram_account_id || undefined,
      });
      setInstagramAccessToken("");
      const refreshed = await refreshMetaStatus();
      applyMetaStatus(refreshed || payload);
      if (payload?.warning) toast(payload.warning, { icon: "⚠️" });
      else toast.success(t("marketing.metaSettings.toasts.instagramTokenSaved"));
    } catch (err) {
      toast.error(err?.message || "تعذر حفظ رمز Instagram");
    } finally {
      setSavingInstagramToken(false);
    }
  };

  const removeInstagramToken = async () => {
    setSavingInstagramToken(true);
    try {
      await removeInstagramBusinessAccessToken();
      setInstagramAccessToken("");
      const refreshed = await refreshMetaStatus();
      applyMetaStatus(refreshed || {});
      toast.success(t("marketing.metaSettings.toasts.instagramTokenDisabled"));
    } catch (err) {
      toast.error(err?.message || "تعذر تعطيل رمز Instagram");
    } finally {
      setSavingInstagramToken(false);
    }
  };

  const saveInstagramSecret = async () => {
    if (!instagramAppSecret.trim()) {
      toast.error(t("marketing.metaSettings.toasts.enterInstagramAppSecret"));
      return;
    }
    setSavingInstagramSecret(true);
    try {
      const payload = await saveInstagramAppSecret({ app_secret: instagramAppSecret });
      setInstagramAppSecret("");
      const refreshed = await refreshMetaStatus();
      applyMetaStatus(refreshed || payload);
      toast.success(t("marketing.metaSettings.toasts.appSecretSaved"));
    } catch (err) {
      toast.error(err?.message || "تعذر حفظ Instagram App Secret");
    } finally {
      setSavingInstagramSecret(false);
    }
  };

  const removeInstagramSecret = async () => {
    setSavingInstagramSecret(true);
    try {
      await removeInstagramAppSecret();
      setInstagramAppSecret("");
      const refreshed = await refreshMetaStatus();
      applyMetaStatus(refreshed || {});
      toast.success(t("marketing.metaSettings.toasts.appSecretDisabled"));
    } catch (err) {
      toast.error(err?.message || "تعذر تعطيل Instagram App Secret");
    } finally {
      setSavingInstagramSecret(false);
    }
  };

  const reconnect = async () => {
    setReconnecting(true);
    try {
      const saved = await refreshMarketingMetaTokens({
        provider: form.provider,
        page_id: form.page_id,
        instagram_account_id: form.instagram_account_id,
        access_token_encrypted: form.access_token_encrypted,
      });
      applySettings(saved);
      getMetaIntegrationStatus({ suppressErrorStatuses: [400, 403, 404, 409, 500] }).then(applyMetaStatus).catch(() => {});
      toast.success(t("marketing.settings.reconnected"));
    } catch (err) {
      toast.error(err?.message || t("marketing.settings.reconnectFailed"));
    } finally {
      setReconnecting(false);
    }
  };

  const testAutoRefresh = async () => {
    setReconnecting(true);
    try {
      const payload = await testMarketingAutoRefresh();
      const result = payload?.data || payload;
      applySettings(result);
      getMetaIntegrationStatus({ suppressErrorStatuses: [400, 403, 404, 409, 500] }).then(applyMetaStatus).catch(() => {});
      toast.success(payload?.skipped ? t("marketing.settings.autoRefreshSkipped") : t("marketing.settings.autoRefreshTestCompleted"));
    } catch (err) {
      toast.error(err?.message || t("marketing.settings.autoRefreshTestFailed"));
    } finally {
      setReconnecting(false);
    }
  };

  const connectMetaOAuth = async () => {
    clearOAuthWatchers();
    setOauthLoading(true);
    try {
      const result = await startMetaOAuth();
      if (!result?.auth_url) throw new Error("Meta OAuth URL was not returned");
      const popup = window.open(result.auth_url, "meta-oauth", "width=720,height=760,menubar=no,toolbar=no,status=no");
      if (!popup) {
        clearOAuthLoading("popup_blocked_redirect");
        window.location.href = result.auth_url;
        return;
      }
      oauthPopupRef.current = popup;
      metaOAuthDevLog("OAuth popup opened");
      oauthTimeoutRef.current = window.setTimeout(() => {
        clearOAuthLoading("timeout");
        toast.error(t("marketing.metaSettings.toasts.metaTimeout"));
      }, META_OAUTH_TIMEOUT_MS);
      oauthClosedIntervalRef.current = window.setInterval(() => {
        if (!oauthPopupRef.current?.closed) return;
        clearOAuthLoading("popup_closed");
        refreshMetaStatus().catch((err) => {
          metaOAuthDevLog("status refresh after popup close failed", { message: err?.message });
        });
      }, 500);
      popup.focus?.();
    } catch (err) {
      clearOAuthLoading("start_failed");
      toast.error(err?.message || "Unable to start Meta OAuth");
    }
  };

  const chooseOAuthPage = async (page) => {
    clearOAuthWatchers();
    setOauthLoading(true);
    try {
      await selectMetaOAuthPage({ page_id: page.page_id });
      setOauthPages([]);
      const refreshed = await refreshMetaStatus();
      const nextResult = buildOAuthResult({
        payload: { success: true, status: "page_selected", message: t("marketing.metaSettings.status.metaPageConnected") },
        refreshed,
        page,
      });
      setOauthResult(nextResult);
      toast.success(nextResult.status === "partially_connected" ? META_PARTIAL_SETUP_MESSAGE : "Meta Page connected");
    } catch (err) {
      toast.error(err?.message || "Unable to save selected Meta Page");
    } finally {
      clearOAuthLoading("page_selection_finished");
    }
  };

  const runMetaMessageTest = async (platform = "facebook") => {
    try {
      const result = await testMetaMessage({ platform });
      toast.success(result?.dry_run ? "Message permissions verified" : "Test message sent");
      await loadMetaDiagnostics();
      await refreshMetaStatus();
    } catch (err) {
      toast.error(err?.message || "Meta message test failed");
    }
  };

  const runMetaPublishTest = async (platform = "facebook") => {
    try {
      await testMetaPublish({ platform });
      toast.success(t("marketing.metaSettings.toasts.publishPermissionsVerified"));
      await loadMetaDiagnostics();
      await refreshMetaStatus();
    } catch (err) {
      toast.error(err?.message || "Meta publishing test failed");
    }
  };

  const runWebhookSelfTest = async () => {
    console.log("[meta-ui] verify_webhook_clicked", {
      component: "MarketingSettings",
      handler: "runWebhookSelfTest",
    });
    setWebhookSelfTestLoading(true);
    try {
      console.log("[meta-ui] verify_webhook_request", {
        endpoint: "/api/meta/webhook-enable",
        request: "enableMetaWebhookSubscription({}, { suppressErrorStatuses: [400, 403, 404, 409, 500] })",
      });
      const [result, subscription] = await Promise.all([
        getMetaWebhookSelfTest({ suppressErrorStatuses: [400, 403, 404, 409, 500] }),
        enableMetaWebhookSubscription({}, { suppressErrorStatuses: [400, 403, 404, 409, 500] }),
      ]);
      console.log("[meta-ui] verify_webhook_response", {
        self_test_success: Boolean(result?.success),
        subscription_success: subscription?.success,
        subscription_status: subscription?.subscription?.webhook_enabled,
        response_preview: {
          result,
          subscription,
        },
      });
      setWebhookSelfTest(result);
      if (result?.success && subscription?.success !== false) {
        toast.success(t("marketing.metaSettings.toasts.webhookVerified"));
      } else {
        toast.error(subscription?.subscription?.error || result?.error || "فشل التحقق من Webhook");
      }
      const refreshed = await refreshMetaStatus();
      const completion = resolveMetaSetupCompletion({
        status: refreshed.status,
        health: refreshed.diagnostics?.health,
        capabilities: refreshed.diagnostics?.capabilities,
        webhook: refreshed.diagnostics?.webhook,
        form,
      });
      metaOAuthDevLog("webhook verification refreshed setup", completion);
      if (completion.complete) {
        setOauthResult(buildOAuthResult({ payload: { success: true, status: "fully_connected", message: t("marketing.metaSettings.status.metaSetupComplete") }, refreshed }));
      }
    } catch (err) {
      toast.error(err?.message || "فشل التحقق من Webhook");
    } finally {
      setWebhookSelfTestLoading(false);
    }
  };

  const completeMetaSetup = async () => {
    setCompleteSetupLoading(true);
    try {
      const refreshed = await refreshMetaStatus();
      const completion = resolveMetaSetupCompletion({
        status: refreshed.status,
        health: refreshed.diagnostics?.health,
        capabilities: refreshed.diagnostics?.capabilities,
        webhook: refreshed.diagnostics?.webhook,
        form,
      });
      metaOAuthDevLog("complete setup evaluation", completion);
      if (completion.complete) {
        setOauthResult(buildOAuthResult({ payload: { success: true, status: "fully_connected", message: t("marketing.metaSettings.status.metaSetupComplete") }, refreshed }));
        toast.success(t("marketing.metaSettings.status.metaSetupComplete"));
      } else {
        setOauthResult(buildOAuthResult({ payload: { success: true, status: "partially_connected" }, refreshed }));
        toast.error(META_PARTIAL_SETUP_MESSAGE);
      }
    } catch (err) {
      toast.error(err?.message || "Unable to complete Meta setup");
    } finally {
      setCompleteSetupLoading(false);
    }
  };

  const saveRule = async () => {
    setSaving(true);
    try {
      const payload = {
        ...ruleForm,
        post_id: ruleForm.post_id || null,
        trigger_keywords: inputToList(ruleForm.trigger_keywords),
        excluded_keywords: inputToList(ruleForm.excluded_keywords),
      };
      if (editingRuleId) {
        await updateCommentDmRule(editingRuleId, payload);
        toast.success(t("marketing.automation.commentDm.updated"));
      } else {
        await createCommentDmRule(payload);
        toast.success(t("marketing.automation.commentDm.created"));
      }
      setEditingRuleId(null);
      setRuleForm(blankRule);
      await loadCommentDm();
    } catch (err) {
      toast.error(err?.message || t("marketing.automation.commentDm.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const removeRule = async (id) => {
    if (!window.confirm(t("marketing.automation.commentDm.deleteConfirm"))) return;
    try {
      await deleteCommentDmRule(id);
      toast.success(t("marketing.automation.commentDm.deleted"));
      if (editingRuleId === id) {
        setEditingRuleId(null);
        setRuleForm(blankRule);
      }
      await loadCommentDm();
    } catch (err) {
      toast.error(err?.message || t("marketing.automation.commentDm.deleteFailed"));
    }
  };

  const runRuleTest = async (rule) => {
    try {
      const result = await testCommentDmRule(rule.id, {
        commenter_name: "Customer",
        comment_text: inputToList(listToInput(rule.trigger_keywords))[0] || "price",
      });
      toast(result?.matched ? t("marketing.automation.commentDm.testMatched", { message: result.message }) : t("marketing.automation.commentDm.testNotMatched"));
    } catch (err) {
      toast.error(err?.message || t("marketing.automation.commentDm.testFailed"));
    }
  };

  const metaConfig = metaStatus?.config || {};
  const facebookStatus = metaStatus?.channels?.facebook || {};
  const instagramStatus = metaStatus?.channels?.instagram || {};
  const liveCapabilities = metaCapabilities?.capabilities || metaHealth?.capabilities || {};
  const liveWebhook = webhookHealth || metaHealth?.webhook || {};
  const tokenIntelligence = metaHealth?.token || {};
  const activeRulesCount = useMemo(() => rules.filter((rule) => rule.is_active !== false).length, [rules]);
  const successfulRuleCount = useMemo(() => logs.filter((log) => log.status === "sent").length, [logs]);
  const failedRuleCount = useMemo(() => logs.filter((log) => log.status === "failed").length, [logs]);
  const setupCompletion = resolveMetaSetupCompletion({
    status: metaStatus,
    health: metaHealth,
    capabilities: metaCapabilities,
    webhook: liveWebhook,
    form,
  });
  const permissionsReady = Boolean(setupCompletion.permissions_saved);
  const webhookReady = Boolean(setupCompletion.webhook_verified && setupCompletion.webhook_enabled && setupCompletion.subscribed_apps_verified);
  const tokenReady = Boolean(
    metaConfig.page_access_token_configured &&
      !["token_expired", "expired", "invalid", "revoked", "error"].includes(String(metaConfig.token_health_status || metaConfig.token_status || tokenIntelligence.status || "").toLowerCase())
  );
  const instagramTokenReady = Boolean(
    metaConfig.instagram_access_token_configured &&
      !["token_expired", "expired", "invalid", "revoked", "error"].includes(String(metaConfig.instagram_token_status || "").toLowerCase())
  );
  const messengerOperationalConnected = Boolean(
    facebookStatus.messenger_connected ||
      (tokenReady && webhookReady && (metaConfig.facebook_page_id || form.page_id))
  );
  const instagramDmOperationalConnected = Boolean(
    instagramStatus.dm_connected ||
      ((instagramTokenReady || tokenReady) && webhookReady && (metaConfig.instagram_business_account_id || form.instagram_account_id))
  );
  const setupSteps = [
    { label: t("marketing.metaSettings.steps.facebookLogin"), done: setupCompletion.oauth_connected },
    { label: t("marketing.metaSettings.steps.selectFacebookPage"), done: setupCompletion.page_selected },
    { label: t("marketing.metaSettings.steps.selectInstagramAccount"), done: setupCompletion.instagram_connected },
    { label: t("marketing.metaSettings.steps.savePermissions"), done: permissionsReady },
    { label: t("marketing.metaSettings.steps.verifyWebhook"), done: webhookReady },
    { label: t("marketing.metaSettings.steps.completeSetup"), done: setupCompletion.complete },
  ];
  const completedSteps = setupSteps.filter((step) => step.done).length;
  const partialSetupDetected = completedSteps > 0 && completedSteps < setupSteps.length;
  const setupStatus = setupCompletion.complete ? "fully_connected" : partialSetupDetected ? "partially_connected" : "not_connected";
  const missingPermissions = useMemo(() => {
    const items = [
      liveCapabilities.messenger,
      liveCapabilities.instagram_dm,
      liveCapabilities.facebook_publishing,
      liveCapabilities.instagram_publishing,
    ];
    return [...new Set(items.flatMap((item) => item?.missing_permissions || []))];
  }, [liveCapabilities]);
  const isLocalSetup = /localhost|127\.0\.0\.1/i.test(`${setupCheck?.redirect_uri || ""} ${setupCheck?.webhook_url || ""}`);
  const pageLabel = metaConfig.facebook_page_name || metaConfig.page_name || form.page_id;
  const instagramLabel = metaConfig.instagram_username || form.instagram_account_id;
  const overviewCards = [
    {
      label: t("marketing.metaSettings.panels.connectionStatus"),
      value: setupCompletion.complete ? "مكتمل" : partialSetupDetected ? "يحتاج استكمال" : "غير متصل",
      hint: pageLabel || "لم يتم اختيار صفحة فيسبوك",
      ok: setupCompletion.complete,
      icon: Workflow,
    },
    {
      label: t("marketing.metaSettings.panels.messages"),
      value: messengerOperationalConnected && instagramDmOperationalConnected ? "تعمل بالكامل" : messengerOperationalConnected || instagramDmOperationalConnected ? "تعمل جزئيًا" : "غير مفعلة",
      hint: instagramLabel || "حساب إنستجرام غير محدد",
      ok: messengerOperationalConnected && instagramDmOperationalConnected,
      icon: MessageCircle,
    },
    {
      label: t("marketing.metaSettings.panels.webhook"),
      value: webhookReady ? "سليم" : "يحتاج مراجعة",
      hint: webhookReady ? "استقبال الأحداث يعمل" : "تحقق من الاشتراك والرمز",
      ok: webhookReady,
      icon: Zap,
    },
    {
      label: t("marketing.metaSettings.panels.permissions"),
      value: permissionsReady ? "مكتملة" : `${missingPermissions.length || 0} مفقودة`,
      hint: permissionsReady ? "جاهزة للنشر والرسائل" : "راجع صلاحيات تطبيق Meta",
      ok: permissionsReady,
      icon: ShieldCheck,
    },
  ];

  return (
    <div dir="rtl" className="min-h-full bg-[var(--card)] text-[var(--text)]">
      <div className="mx-auto flex w-full flex-col gap-5 px-4 py-5 md:px-6 lg:px-8">
        <MarketingStudioHeader />
        <section className="rounded-[var(--radius-card)] border border-amber-400/15 bg-[var(--card)] p-5 shadow-[var(--shadow-card)] md:p-6">
          <div className="space-y-2">
            <div className="inline-flex min-h-9 items-center gap-2 rounded-full border border-amber-400/25 bg-amber-400/10 px-3 py-1.5 text-sm font-semibold text-amber-200">
              <Settings2 className="h-4 w-4" />
              {t("marketing.settings.eyebrow")}
            </div>
            <h1 className="m1-display">{t("marketing.settings.title")}</h1>
            <p className="max-w-3xl text-base leading-7 text-[var(--muted)]">{t("marketing.settings.subtitle")}</p>
          </div>
          <div className="sticky top-3 z-20 mt-5 flex flex-wrap gap-2 rounded-2xl border border-[var(--border)] bg-[var(--card)]/95 p-2.5 shadow-[var(--shadow-card)] backdrop-blur">
            {[
              ["facebook", "الربط والحسابات"],
              ["messaging", "الرسائل"],
              ["publishing", "النشر"],
              ["webhook", "Webhook"],
              ["automation", "الردود الآلية"],
            ].map(([section, label]) => (
              <a key={section} href={`#marketing-settings-${section}`} className="inline-flex min-h-10 items-center rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2 text-sm font-black text-[var(--text)] transition hover:border-amber-400/25 hover:bg-amber-400/10 hover:text-amber-100">
                {label}
              </a>
            ))}
            <button onClick={loadMetaDiagnostics} className="inline-flex min-h-[var(--control-height-md)] items-center gap-2 rounded-[var(--radius-control)] border border-amber-400/25 bg-amber-400/10 px-3.5 py-2 text-sm font-black text-amber-100">
              <RefreshCw className={`h-4 w-4 ${diagnosticsLoading ? "animate-spin" : ""}`} />
              تحديث الحالة
            </button>
          </div>
        </section>

        <section aria-label={t("marketing.metaSettings.summary.metaStatusAria")} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {overviewCards.map(({ label, value, hint, ok, icon: Icon }) => (
            <div key={label} className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-[var(--shadow-card)]">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-sm font-semibold text-[var(--muted)]">{label}</div>
                  <div className="mt-2 text-xl font-black text-[var(--text)]">{value}</div>
                </div>
                <span className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border ${ok ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-300" : "border-amber-400/25 bg-amber-400/10 text-amber-300"}`}>
                  <Icon className="h-5 w-5" />
                </span>
              </div>
              <p className="mt-3 text-sm leading-6 text-[var(--muted)]">{hint}</p>
            </div>
          ))}
        </section>

        {error ? <div className="rounded-2xl border border-rose-500/20 bg-rose-500/10 p-4 text-sm text-rose-100">{error}</div> : null}

        <details className="group rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] p-5 shadow-[var(--shadow-card)] md:p-6">
          <summary className="flex cursor-pointer list-none flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="inline-flex min-h-9 items-center gap-2 rounded-full border border-amber-400/20 bg-amber-400/10 px-3 py-1.5 text-sm font-semibold text-amber-200">
                <ShieldCheck className="h-4 w-4" />
                الإعدادات التقنية المتقدمة
              </div>
              <h2 className="m1-section-title mt-3">{t("marketing.metaSettings.summary.title")}</h2>
              <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{t("marketing.metaSettings.summary.subtitle")}</p>
            </div>
            <div className="flex items-center gap-3">
              <StatusBadge status={setupCheck?.env_ready ? "connected" : "missing_permissions"} />
              <span className="text-2xl text-[var(--muted)] transition group-open:rotate-180">⌄</span>
            </div>
          </summary>
          <div className="mt-5 grid gap-3 lg:grid-cols-3">
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
              <div className="text-sm font-semibold text-[var(--muted)]">{t("marketing.metaSettings.summary.runtimeEnvironment")}</div>
              <div className="mt-2 text-base font-black text-[var(--text)]">{setupCheck?.env_ready ? "جاهز" : "غير جاهز"}</div>
              <div dir="ltr" className="mt-3 space-y-2 text-sm text-[var(--muted)]">
                {["META_APP_ID", "META_APP_SECRET", "META_REDIRECT_URI", "META_VERIFY_TOKEN"].map((key) => (
                  <div key={key} className="flex items-center justify-between gap-3">
                    <span>{key}</span>
                    <span className={setupCheck?.env?.[key] === "present" ? "text-emerald-300" : "text-rose-300"}>{setupCheck?.env?.[key] || "missing"}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
              <div className="text-sm font-semibold text-[var(--muted)]">{t("marketing.metaSettings.summary.oauthRedirectUrl")}</div>
              <code dir="ltr" className="mt-2 block break-all rounded-xl bg-[var(--surface)] p-3 text-sm text-[var(--text)]">{setupCheck?.redirect_uri || "غير مهيأ"}</code>
              <div className="mt-3">
                <CopyButton value={setupCheck?.redirect_uri || ""} label={t("marketing.metaSettings.summary.copyRedirectUrl")} />
              </div>
            </div>
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
              <div className="text-sm font-semibold text-[var(--muted)]">{t("marketing.metaSettings.summary.webhookCallbackUrl")}</div>
              <code dir="ltr" className="mt-2 block break-all rounded-xl bg-[var(--surface)] p-3 text-sm text-amber-100">{setupCheck?.webhook_url || "غير مهيأ"}</code>
              <div className="mt-3 flex flex-wrap gap-2">
                <CopyButton value={setupCheck?.webhook_url || ""} label={t("marketing.metaSettings.summary.copyWebhookUrl")} />
                <CopyButton value={setupCheck?.verify_token_status === "configured" ? "configured" : ""} label={t("marketing.metaSettings.summary.copyVerifyToken")} />
              </div>
            </div>
          </div>
          {isLocalSetup ? (
            <div className="mt-4 rounded-2xl border border-amber-400/20 bg-amber-400/10 p-4 text-sm text-amber-100">
              Meta webhooks require HTTPS. Use the configured Cloudflare Tunnel URL for webhook testing. Ngrok is only an optional fallback.
            </div>
          ) : null}
          <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_0.9fr]">
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
              <div className="text-sm font-semibold text-[var(--muted)]">{t("marketing.metaSettings.summary.requiredPermissions")}</div>
              <div className="mt-3 flex flex-wrap gap-2">
                {(setupCheck?.required_permissions || []).map((permission) => (
                  <span dir="ltr" key={permission} className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm font-bold text-[var(--text)]">{permission}</span>
                ))}
              </div>
              <p className="mt-4 text-sm text-[var(--muted)]">App review reminder: production messaging and publishing require Meta review approval for the requested permissions.</p>
            </div>
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
              <div className="text-sm font-semibold text-[var(--muted)]">{t("marketing.metaSettings.summary.setupSteps")}</div>
              <div className="mt-3 space-y-2 text-sm text-[var(--muted)]">
                {(setupCheck?.setup_steps || []).map((step) => (
                  <div key={step} className="flex gap-2 rounded-xl bg-[var(--surface)] px-3 py-2">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
                    <span>{step}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </details>

        {oauthResult ? (
          <section className={`rounded-[var(--radius-card)] border p-5 shadow-[var(--shadow-card)] ${oauthResult.status === "partially_connected" ? "border-amber-400/20 bg-amber-400/10" : "border-emerald-400/20 bg-emerald-400/10"}`}>
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <div className={`text-xs font-black uppercase tracking-[0.18em] ${oauthResult.status === "partially_connected" ? "text-amber-200" : "text-emerald-200"}`}>{t("marketing.metaSettings.oauth.result")}</div>
                <h2 className="m1-section-title mt-2 text-[var(--text)]">{oauthResult.message}</h2>
              </div>
              <StatusBadge status={oauthResult.status || "connected"} />
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-4">
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <div className="text-xs text-[var(--muted)]">{t("marketing.metaSettings.oauth.connectedPage")}</div>
                <div className="mt-1 font-black text-[var(--text)]">{oauthResult.page || pageLabel || "Not available"}</div>
              </div>
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <div className="text-xs text-[var(--muted)]">{t("marketing.metaSettings.oauth.connectedInstagram")}</div>
                <div className="mt-1 font-black text-[var(--text)]">{oauthResult.instagram || instagramLabel || "Not linked"}</div>
              </div>
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <div className="text-xs text-[var(--muted)]">{t("marketing.metaSettings.oauth.missingPermissions")}</div>
                <div className="mt-1 text-sm font-black text-[var(--text)]">{missingPermissions.length ? missingPermissions.join(", ") : "لا يوجد"}</div>
              </div>
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <div className="text-xs text-[var(--muted)]">{t("marketing.metaSettings.oauth.nextAction")}</div>
                <div className="mt-1 text-sm font-black text-[var(--text)]">{setupCompletion.complete ? "اكتمل الإعداد." : missingPermissions.length ? "اطلب الصلاحيات المفقودة في مراجعة تطبيق ميتا." : liveWebhook.webhook_verified ? "شغّل اختبارات الرسائل الحية والنشر." : "تحقق من اشتراك Webhook في Meta Developer."}</div>
              </div>
            </div>
          </section>
        ) : null}

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
          <section className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] p-5 shadow-[var(--shadow-card)] md:p-6">
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div>
                <div className="inline-flex min-h-9 items-center gap-2 rounded-full border border-amber-400/20 bg-amber-400/10 px-3 py-1.5 text-sm font-semibold text-amber-200">
                  <Workflow className="h-4 w-4" />
                  مركز ربط Meta
                </div>
                <h2 className="m1-section-title mt-3">{t("marketing.metaSettings.connect.title")}</h2>
                <p className="mt-2 max-w-2xl text-base leading-7 text-[var(--muted)]">
                  يستخدم الإعداد الموجّه تسجيل الدخول عبر فيسبوك واختيار الصفحة واكتشاف حساب إنستجرام والتحقق من الصلاحيات وفحوصات Webhook. وتبقى المعرّفات اليدوية متاحة في الوضع المتقدم.
                </p>
              </div>
              <StatusBadge status={setupCompletion.overall_status || metaHealth?.overall_status || metaCapabilities?.status || setupStatus} />
            </div>
            <div className="mt-5 grid gap-3 md:grid-cols-3">
              {["تسجيل الدخول عبر فيسبوك", "اختيار صفحة", "التحقق من Webhook"].map((label, index) => (
                <button
                  key={label}
                  onClick={() => setWizardStep(index)}
                  className={`min-h-16 rounded-[var(--radius-control)] border px-4 py-3 text-right text-sm transition ${wizardStep === index ? "border-amber-400/35 bg-amber-400/10 text-amber-100" : "border-[var(--border)] bg-[var(--card)] text-[var(--muted)] hover:bg-[var(--surface)]"}`}
                >
                  <div className="text-sm font-black text-[var(--muted)]">{t("marketing.metaSettings.connect.step")} {index + 1}</div>
                  <div className="mt-1 font-black">{label}</div>
                </button>
              ))}
            </div>
            <div className="mt-5 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
              {wizardStep === 0 ? (
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <div className="font-black text-[var(--text)]">{t("marketing.metaSettings.connect.facebookLogin")}</div>
                    <p className="mt-1 text-sm text-[var(--muted)]">{t("marketing.metaSettings.connect.facebookLoginHint")}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button onClick={connectMetaOAuth} disabled={oauthLoading} className="inline-flex items-center gap-2 rounded-[var(--radius-control)] bg-[#1877f2] px-4 py-3 text-sm font-black text-white disabled:opacity-60">
                      <KeyRound className="h-4 w-4" />
                      {oauthLoading ? "Connecting..." : "Connect Meta"}
                    </button>
                    <button onClick={runWebhookSelfTest} disabled={webhookSelfTestLoading} className="inline-flex min-h-[var(--control-height-lg)] items-center gap-2 rounded-[var(--radius-control)] border border-amber-400/25 bg-amber-400/10 px-4 py-2 text-sm font-black text-amber-100 disabled:opacity-60">
                      <PlayCircle className="h-4 w-4" />
                      {webhookSelfTestLoading ? "Verifying..." : "Verify webhook"}
                    </button>
                    <button onClick={completeMetaSetup} disabled={completeSetupLoading} className="inline-flex min-h-[var(--control-height-lg)] items-center gap-2 rounded-[var(--radius-control)] border border-emerald-400/25 bg-emerald-400/10 px-4 py-2 text-sm font-black text-emerald-100 disabled:opacity-60">
                      <CheckCircle2 className="h-4 w-4" />
                      {completeSetupLoading ? "Completing..." : "Complete setup"}
                    </button>
                    <button onClick={() => setAdvancedMode((value) => !value)} className="min-h-[var(--control-height-lg)] rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm font-black text-[var(--text)]">
                      {advancedMode ? "Hide advanced mode" : "Advanced mode"}
                    </button>
                  </div>
                </div>
              ) : wizardStep === 1 ? (
                <div>
                  <div className="font-black text-[var(--text)]">{t("marketing.metaSettings.connect.selectPageAndAccount")}</div>
                  <p className="mt-1 text-sm text-[var(--muted)]">{t("marketing.metaSettings.connect.selectPageHint")} {pageLabel || "لا توجد صفحة"} / {instagramLabel || "لا يوجد حساب إنستجرام"}.</p>
                  {oauthPages.length ? (
                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                      {oauthPages.map((page) => (
                        <button key={page.page_id} onClick={() => chooseOAuthPage(page)} disabled={oauthLoading} className="rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)] p-4 text-left transition hover:bg-[var(--surface-hover)] disabled:opacity-60">
                          <div className="font-black text-[var(--text)]">{page.page_name || page.page_id}</div>
                          <div className="mt-1 text-xs text-[var(--muted)]">{t("marketing.metaSettings.connect.pageId")} {page.page_id}</div>
                          <div className="mt-2 text-xs text-primary">{t("marketing.metaSettings.connect.instagram")} {page.instagram_username || page.instagram_business_account_id || "لا يوجد حساب أعمال مرتبط"}</div>
                          <div className="mt-2 text-xs text-[var(--muted)]">Token: {page.page_access_token_masked || "configured"}</div>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <div className="font-black text-[var(--text)]">{t("marketing.metaSettings.connect.verifyWebhook")}</div>
                    <p className="mt-1 text-sm text-[var(--muted)]">{t("marketing.metaSettings.connect.verifyWebhookHint")}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button onClick={runWebhookSelfTest} disabled={webhookSelfTestLoading} className="inline-flex items-center gap-2 rounded-[var(--radius-control)] bg-primary px-3 py-2 text-xs font-black text-[var(--primary-contrast)] disabled:opacity-60">
                      <PlayCircle className="h-3.5 w-3.5" />
                      {webhookSelfTestLoading ? "Verifying..." : "Verify webhook"}
                    </button>
                    <button onClick={completeMetaSetup} disabled={completeSetupLoading} className="inline-flex items-center gap-2 rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs font-black text-[var(--text)] disabled:opacity-60">
                      <RefreshCw className={`h-3.5 w-3.5 ${completeSetupLoading ? "animate-spin" : ""}`} />
                      {completeSetupLoading ? "Completing..." : "Complete setup"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </section>

          <aside className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] p-5 shadow-[var(--shadow-card)] md:p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-black text-[var(--muted)]">{t("marketing.metaSettings.stages.title")}</div>
                <div className="mt-1 text-2xl font-black text-[var(--text)]">{completedSteps}/{setupSteps.length}</div>
              </div>
              <StatusBadge status={setupStatus} />
            </div>
            {partialSetupDetected ? (
              <div className="mt-4 rounded-xl border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-xs font-black text-amber-100">
                {META_PARTIAL_SETUP_MESSAGE}
              </div>
            ) : null}
            <div className="mt-4 space-y-2">
              {setupSteps.map((step) => (
                <div key={step.label} className="flex min-h-10 items-center gap-2.5 rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2.5 text-sm text-[var(--muted)]">
                  <CheckCircle2 className={`h-4 w-4 ${step.done ? "text-emerald-300" : "text-[var(--muted)]"}`} />
                  <span>{step.label}</span>
                </div>
              ))}
            </div>
          </aside>
        </div>

        {diagnosticsLoading && !metaHealth ? (
          <div className="grid gap-4 md:grid-cols-3">
            <SkeletonBlock />
            <SkeletonBlock />
            <SkeletonBlock />
          </div>
        ) : null}

        <section id="marketing-settings-facebook" className="scroll-mt-6 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] p-5 shadow-[var(--shadow-card)] md:p-6">
          <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="text-xs font-black uppercase tracking-[0.18em] text-[var(--muted)]">{t("marketing.metaSettings.stages.connection")}</div>
              <h2 className="m1-section-title mt-1 text-[var(--text)]">{t("marketing.metaSettings.stages.pageAndAccount")}</h2>
            </div>
            <button onClick={() => setAdvancedMode((value) => !value)} className="rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs font-black text-[var(--text)]">
              {advancedMode ? "Guided mode" : "Advanced mode"}
            </button>
          </div>
          {advancedMode ? <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-2">
              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">{t("marketing.settings.fields.provider")}</span>
              <input value={form.provider} onChange={(event) => setForm((current) => ({ ...current, provider: event.target.value }))} className="w-full rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--text)] outline-none" />
            </label>
            <label id="marketing-settings-instagram" className="scroll-mt-6 space-y-2">
              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">{t("marketing.settings.fields.facebookPageId")}</span>
              <input value={form.page_id} onChange={(event) => setForm((current) => ({ ...current, page_id: event.target.value }))} className="w-full rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--text)] outline-none" />
            </label>
            <label className="space-y-2">
              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">{t("marketing.settings.fields.instagramAccountId")}</span>
              <input value={form.instagram_account_id} onChange={(event) => setForm((current) => ({ ...current, instagram_account_id: event.target.value }))} className="w-full rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--text)] outline-none" />
            </label>
            <label className="space-y-2">
              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">{t("marketing.settings.fields.shortLivedToken")}</span>
              <input type="password" value={form.access_token_encrypted} onChange={(event) => setForm((current) => ({ ...current, access_token_encrypted: event.target.value }))} className="w-full rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--text)] outline-none" />
            </label>
          </div> : (
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">{t("marketing.metaSettings.fields.facebookPage")}</div>
                <div className="mt-2 font-black text-[var(--text)]">{pageLabel || "Not selected"}</div>
                <p className="mt-1 text-xs text-[var(--muted)]">{t("marketing.metaSettings.fields.pageIdManaged")}</p>
              </div>
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">{t("marketing.metaSettings.fields.instagramBusinessAccount")}</div>
                <div className="mt-2 font-black text-[var(--text)]">{instagramLabel || "Not selected"}</div>
                <p className="mt-1 text-xs text-[var(--muted)]">{t("marketing.metaSettings.fields.manualAccountHidden")}</p>
              </div>
            </div>
          )}

          <div className="mt-5 rounded-2xl border border-amber-400/20 bg-amber-400/5 p-4">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-2xl">
                <div className="flex items-center gap-2 font-black text-[var(--text)]">
                  <KeyRound className="h-4 w-4 text-amber-300" />
                  رمز Instagram Business Login المستقل
                </div>
                <p className="mt-1 text-sm leading-6 text-[var(--muted)]">
                  يُشفّر داخل الخادم ويُستخدم لرسائل Instagram فقط. لن يستبدل رمز صفحة Facebook ولن يظهر مرة أخرى بعد الحفظ.
                </p>
              </div>
              <div className="inline-flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs font-black text-[var(--muted)]">
                <ShieldCheck className={`h-4 w-4 ${metaConfig.instagram_access_token_configured ? "text-emerald-300" : "text-[var(--muted)]"}`} />
                {metaConfig.instagram_access_token_configured ? "محفوظ ومشفّر" : "غير محفوظ"}
              </div>
            </div>
            <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto_auto]">
              <input
                type="password"
                autoComplete="new-password"
                value={instagramAccessToken}
                onChange={(event) => setInstagramAccessToken(event.target.value)}
                placeholder={t("marketing.metaSettings.fields.pasteInstagramToken")}
                className="w-full rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--text)] outline-none focus:border-amber-400/40"
              />
              <button
                type="button"
                onClick={saveInstagramToken}
                disabled={savingInstagramToken || !instagramAccessToken.trim()}
                className="rounded-[var(--radius-control)] bg-amber-400 px-4 py-3 text-sm font-black text-[#17130a] disabled:opacity-50"
              >
                {savingInstagramToken ? "جارٍ التحقق..." : "تحقق واحفظ"}
              </button>
              {metaConfig.instagram_access_token_configured ? (
                <button
                  type="button"
                  onClick={removeInstagramToken}
                  disabled={savingInstagramToken}
                  className="rounded-[var(--radius-control)] border border-rose-400/25 bg-rose-400/10 px-4 py-3 text-sm font-black text-rose-100 disabled:opacity-50"
                >
                  تعطيل الرمز
                </button>
              ) : null}
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-xs text-[var(--muted)]">
              <span>{t("marketing.metaSettings.fields.status")} {metaConfig.instagram_token_status || "missing"}</span>
              <span>•</span>
              <span>{metaConfig.instagram_webhook_subscribed ? "Webhook مشترك" : "Webhook يحتاج تحقق"}</span>
            </div>
          </div>

          <div className="mt-4 rounded-2xl border border-emerald-400/20 bg-emerald-400/5 p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-2xl">
                <div className="flex items-center gap-2 font-black text-[var(--text)]">
                  <ShieldCheck className="h-4 w-4 text-emerald-300" />
                  Instagram App Secret لتوقيع الرسائل
                </div>
                <p className="mt-1 text-sm leading-6 text-[var(--muted)]">
                  انسخ Instagram App Secret من إعداد Instagram API. سيُحفظ مشفّرًا ويُستخدم للتحقق من Webhook الخاص بإنستجرام فقط، ولن يظهر مرة أخرى بعد الحفظ.
                </p>
              </div>
              <div className="inline-flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs font-black text-[var(--muted)]">
                <ShieldCheck className={`h-4 w-4 ${metaConfig.instagram_app_secret_configured ? "text-emerald-300" : "text-[var(--muted)]"}`} />
                {metaConfig.instagram_app_secret_configured ? "محفوظ ومشفّر" : "غير محفوظ"}
              </div>
            </div>
            <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto_auto]">
              <input
                type="password"
                autoComplete="new-password"
                value={instagramAppSecret}
                onChange={(event) => setInstagramAppSecret(event.target.value)}
                placeholder={t("marketing.metaSettings.fields.pasteAppSecret")}
                className="w-full rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--text)] outline-none focus:border-emerald-400/40"
              />
              <button
                type="button"
                onClick={saveInstagramSecret}
                disabled={savingInstagramSecret || !instagramAppSecret.trim()}
                className="rounded-[var(--radius-control)] bg-primary px-4 py-3 text-sm font-black text-[#07150f] disabled:opacity-50"
              >
                {savingInstagramSecret ? "جارٍ الحفظ..." : "حفظ السر"}
              </button>
              {metaConfig.instagram_app_secret_configured ? (
                <button
                  type="button"
                  onClick={removeInstagramSecret}
                  disabled={savingInstagramSecret}
                  className="rounded-[var(--radius-control)] border border-rose-400/25 bg-rose-400/10 px-4 py-3 text-sm font-black text-rose-100 disabled:opacity-50"
                >
                  تعطيل السر
                </button>
              ) : null}
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-3 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--text)]">
              <input type="checkbox" checked={Boolean(form.is_connected)} onChange={(event) => setForm((current) => ({ ...current, is_connected: event.target.checked }))} />
              {t("marketing.settings.status.connected")}
            </label>
            <div className="inline-flex items-center gap-2 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--muted)]">
              <ShieldCheck className="h-4 w-4 text-emerald-300" />
              {form.page_access_token_set ? t("marketing.settings.status.pageTokenSaved") : form.access_token_set ? t("marketing.settings.status.legacyTokenSaved") : t("marketing.settings.status.noTokenSaved")}
            </div>
            <div className="inline-flex items-center gap-2 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--muted)]">
              <KeyRound className="h-4 w-4 text-primary" />
              {loading ? t("marketing.common.loading") : form.is_connected ? t("marketing.settings.status.connected") : t("marketing.settings.status.disconnected")}
            </div>
            <div className="inline-flex items-center gap-2 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--muted)]">
              <Clock className="h-4 w-4 text-amber-300" />
              {t("marketing.settings.status.expires", { value: formatDateTime(form.token_expires_at) })}
            </div>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm text-[var(--muted)]">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">{t("marketing.settings.tokenStatus")}</div>
              <div className="mt-2 font-semibold text-[var(--text)]">{form.token_health_status || form.token_status || t("marketing.settings.status.missing")}</div>
              <div className="mt-1 text-xs text-[var(--muted)]">{t("marketing.settings.lastChecked", { value: formatDateTime(form.token_last_validated_at) })}</div>
            </div>
            <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4 text-sm text-[var(--text)]">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">{t("marketing.settings.autoRefresh")}</div>
              <div className="mt-2 flex items-center gap-2 font-semibold text-[var(--text)]">
                <Sparkles className="h-4 w-4 text-primary" />
                {form.auto_refresh_enabled ? t("marketing.settings.autoRefreshEnabled") : t("marketing.settings.autoRefreshDisabled")}
              </div>
              <div className="mt-1 text-xs text-[var(--muted)]">{t("marketing.settings.lastAutoRefresh", { value: formatDateTime(form.last_auto_refresh_at) })}</div>
              <div className="mt-1 text-xs text-[var(--muted)]">{t("marketing.settings.nextRefreshCheck", { value: formatDateTime(form.next_refresh_check_at) })}</div>
            </div>
            {form.token_error_message ? (
              <div className="rounded-2xl border border-amber-400/20 bg-amber-400/10 p-4 text-sm text-amber-100">
                <div className="flex items-center gap-2 font-semibold">
                  <AlertTriangle className="h-4 w-4" />
                  {t("marketing.settings.tokenWarning")}
                </div>
                <p className="mt-2 leading-6">{form.token_error_message}</p>
              </div>
            ) : null}
          </div>

          <div className="mt-5 flex flex-wrap gap-3">
            <button onClick={save} disabled={saving} className="rounded-[var(--radius-control)] bg-primary px-4 py-3 text-sm font-semibold text-[var(--primary-contrast)] disabled:opacity-60">
              {t("marketing.settings.save")}
            </button>
            <button onClick={reconnect} disabled={reconnecting || saving} className="inline-flex items-center gap-2 rounded-[var(--radius-control)] border border-primary/30 bg-primary/10 px-4 py-3 text-sm font-semibold text-primary disabled:opacity-60">
              <RefreshCw className={`h-4 w-4 ${reconnecting ? "animate-spin" : ""}`} />
              {t("marketing.settings.reconnect")}
            </button>
            <button onClick={testAutoRefresh} disabled={reconnecting || saving} className="inline-flex items-center gap-2 rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm font-semibold text-[var(--text)] disabled:opacity-60">
              <Sparkles className="h-4 w-4 text-primary" />
              {t("marketing.settings.testAutoRefresh")}
            </button>
          </div>
        </section>

        <section id="marketing-settings-messaging" className="scroll-mt-6 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] p-5 shadow-[var(--shadow-card)] md:p-6">
          <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <div className="inline-flex min-h-9 items-center gap-2 rounded-full border border-amber-400/20 bg-amber-400/10 px-3 py-1.5 text-sm font-semibold text-amber-200">
                <MessageCircle className="h-4 w-4" />
                {t("marketing.settings.capabilities.messaging", "Messaging")}
              </div>
            <h2 className="m1-section-title mt-3">{t("marketing.settings.capabilities.messagingTitle", "Meta messaging capabilities")}</h2>
            </div>
            <div className="text-sm text-[var(--muted)]">{t("marketing.settings.capabilities.webhook", "Webhook")}: {metaConfig.webhook_enabled ? t("marketing.settings.status.enabled", "Enabled") : t("marketing.settings.status.disabled", "Disabled")}</div>
          </div>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <CapabilityCard
              icon={MessageCircle}
              title={t("marketing.settings.capabilities.facebookMessenger", "ماسنجر فيسبوك")}
              subtitle={pageLabel || t("marketing.settings.capabilities.noFacebookPage", "لا توجد صفحة فيسبوك متصلة")}
              connected={messengerOperationalConnected}
              status={messengerOperationalConnected ? "connected" : liveCapabilities.messenger?.status}
              checks={[
                { label: t("marketing.metaSettings.capabilities.webhookHealthy"), ok: webhookReady || facebookStatus.webhook_healthy },
                { label: t("marketing.metaSettings.capabilities.tokenValid"), ok: tokenReady || facebookStatus.token_valid },
                { label: t("marketing.metaSettings.capabilities.receiveMessages"), ok: messengerOperationalConnected || liveCapabilities.messenger?.details?.receive_messages },
                { label: t("marketing.metaSettings.capabilities.sendReplies"), ok: messengerOperationalConnected || liveCapabilities.messenger?.details?.send_replies },
                { label: t("marketing.metaSettings.capabilities.aiAutomationActive"), ok: facebookStatus.messaging_active || liveCapabilities.messenger?.details?.auto_replies },
              ]}
              connectedLabel={t("marketing.settings.status.connected", "Connected")}
              disconnectedLabel={t("marketing.settings.status.disconnected", "Not connected")}
              emptyLabel={t("marketing.common.notAvailable", "Not available")}
              details={[
                [t("marketing.settings.capabilities.page", "Page"), pageLabel],
                ["Webhook", webhookReady ? "سليم" : "يحتاج اهتمامًا"],
                ["Token", tokenReady ? "صالح" : "يحتاج اهتمامًا"],
                ["Missing permissions", liveCapabilities.messenger?.missing_permissions?.join(", ") || "None"],
                [t("marketing.settings.capabilities.lastSync", "Last sync"), formatDateTime(metaConfig.last_sync_at)],
              ]}
              onTest={() => runMetaMessageTest("facebook")}
            />
            <CapabilityCard
              icon={Send}
              title={t("marketing.settings.capabilities.instagramDm", "رسائل إنستجرام")}
              subtitle={instagramLabel || t("marketing.settings.capabilities.noInstagramAccount", "لا يوجد حساب إنستجرام للأعمال متصل")}
              connected={instagramDmOperationalConnected}
              status={instagramDmOperationalConnected ? "connected" : liveCapabilities.instagram_dm?.status}
              checks={[
                { label: t("marketing.metaSettings.capabilities.webhookHealthy"), ok: webhookReady || instagramStatus.webhook_healthy },
                { label: t("marketing.metaSettings.capabilities.tokenValid"), ok: instagramTokenReady || tokenReady || instagramStatus.token_valid },
                { label: t("marketing.metaSettings.capabilities.receiveMessages"), ok: instagramDmOperationalConnected || liveCapabilities.instagram_dm?.details?.receive_dms },
                { label: t("marketing.metaSettings.capabilities.sendReplies"), ok: instagramDmOperationalConnected || liveCapabilities.instagram_dm?.details?.send_replies },
                { label: t("marketing.metaSettings.capabilities.storyMentionSupport"), ok: liveCapabilities.instagram_dm?.details?.story_mention_support },
                { label: t("marketing.metaSettings.capabilities.aiAutomationActive"), ok: instagramStatus.messaging_active || liveCapabilities.instagram_dm?.details?.automation_status === "enabled" },
              ]}
              connectedLabel={t("marketing.settings.status.connected", "Connected")}
              disconnectedLabel={t("marketing.settings.status.disconnected", "Not connected")}
              emptyLabel={t("marketing.common.notAvailable", "Not available")}
              details={[
                [t("marketing.settings.capabilities.igBusinessAccount", "IG Business Account"), instagramLabel],
                ["Webhook", webhookReady ? "سليم" : "يحتاج اهتمامًا"],
                ["Token", instagramTokenReady || tokenReady ? "صالح" : "يحتاج اهتمامًا"],
                ["Missing permissions", liveCapabilities.instagram_dm?.missing_permissions?.join(", ") || "None"],
                [t("marketing.settings.capabilities.lastSync", "Last sync"), formatDateTime(metaConfig.last_sync_at)],
              ]}
              onTest={() => runMetaMessageTest("instagram")}
            />
          </div>
        </section>

        <section id="marketing-settings-publishing" className="scroll-mt-6 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] p-5 shadow-[var(--shadow-card)] md:p-6">
          <div className="inline-flex min-h-9 items-center gap-2 rounded-full border border-amber-400/20 bg-amber-400/10 px-3 py-1.5 text-sm font-semibold text-amber-200">
            <FileText className="h-4 w-4" />
            {t("marketing.settings.capabilities.publishing", "النشر")}
          </div>
          <h2 className="m1-section-title mt-3">{t("marketing.settings.capabilities.publishingTitle", "قدرات النشر في ميتا")}</h2>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <CapabilityCard
              icon={FileText}
              title={t("marketing.settings.capabilities.facebookPosts", "منشورات صفحة فيسبوك")}
              subtitle={pageLabel || t("marketing.settings.capabilities.noFacebookPage", "لا توجد صفحة فيسبوك متصلة")}
              connected={Boolean(facebookStatus.publishing_connected)}
              status={liveCapabilities.facebook_publishing?.status}
              checks={[
                { label: t("marketing.metaSettings.publishing.feedPublish"), ok: liveCapabilities.facebook_publishing?.details?.feed_publishing },
                { label: t("marketing.metaSettings.publishing.mediaUpload"), ok: liveCapabilities.facebook_publishing?.details?.media_upload },
                { label: t("marketing.metaSettings.publishing.scheduledPublish"), ok: liveCapabilities.facebook_publishing?.details?.scheduled_publishing },
                { label: t("marketing.metaSettings.publishing.failedPostsProcessed"), ok: !liveCapabilities.facebook_publishing?.details?.failed_publishes },
              ]}
              connectedLabel={t("marketing.settings.status.connected", "Connected")}
              disconnectedLabel={t("marketing.settings.status.disconnected", "Not connected")}
              emptyLabel={t("marketing.common.notAvailable", "Not available")}
              details={[
                [t("marketing.settings.tokenStatus", "حالة الرمز"), form.token_health_status || form.token_status],
                ["الصلاحيات المفقودة", liveCapabilities.facebook_publishing?.missing_permissions?.join(", ") || "لا يوجد"],
                [t("marketing.settings.capabilities.expires", "Expires"), formatDateTime(form.token_expires_at)],
              ]}
              onTest={() => runMetaPublishTest("facebook")}
            />
            <CapabilityCard
              icon={Sparkles}
              title={t("marketing.settings.capabilities.instagramPosts", "Instagram feed posts")}
              subtitle={instagramLabel || t("marketing.settings.capabilities.noInstagramAccount", "لا يوجد حساب إنستجرام للأعمال متصل")}
              connected={Boolean(instagramStatus.publishing_connected)}
              status={liveCapabilities.instagram_publishing?.status}
              checks={[
                { label: t("marketing.metaSettings.publishing.feedPublish"), ok: liveCapabilities.instagram_publishing?.details?.feed_publishing },
                { label: t("marketing.metaSettings.publishing.mediaUpload"), ok: liveCapabilities.instagram_publishing?.details?.media_upload },
                { label: t("marketing.metaSettings.publishing.scheduledPublish"), ok: liveCapabilities.instagram_publishing?.details?.scheduled_publishing },
                { label: t("marketing.metaSettings.publishing.failedPostsProcessed"), ok: !liveCapabilities.instagram_publishing?.details?.failed_publishes },
              ]}
              connectedLabel={t("marketing.settings.status.connected", "Connected")}
              disconnectedLabel={t("marketing.settings.status.disconnected", "Not connected")}
              emptyLabel={t("marketing.common.notAvailable", "Not available")}
              details={[
                [t("marketing.settings.tokenStatus", "حالة الرمز"), form.token_health_status || form.token_status],
                ["الصلاحيات المفقودة", liveCapabilities.instagram_publishing?.missing_permissions?.join(", ") || "لا يوجد"],
                [t("marketing.settings.capabilities.expires", "Expires"), formatDateTime(form.token_expires_at)],
              ]}
              onTest={() => runMetaPublishTest("instagram")}
            />
          </div>
        </section>

        <section id="marketing-settings-webhook" className="scroll-mt-6 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] p-5 shadow-[var(--shadow-card)] md:p-6">
          <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <div className="inline-flex min-h-9 items-center gap-2 rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1.5 text-sm font-semibold text-amber-200">
                <Zap className="h-4 w-4" />
                تشخيص Webhook
              </div>
              <h2 className="m1-section-title mt-3">{t("marketing.metaSettings.events.receiveStatus")}</h2>
            </div>
            <StatusBadge status={liveWebhook.webhook_verified ? "connected" : "webhook_issue"} />
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button onClick={runWebhookSelfTest} disabled={webhookSelfTestLoading} className="inline-flex items-center gap-2 rounded-[var(--radius-control)] border border-primary/25 bg-primary/10 px-3 py-2 text-xs font-black text-primary disabled:opacity-60">
              <PlayCircle className="h-3.5 w-3.5" />
              {webhookSelfTestLoading ? "Verifying..." : "Verify webhook"}
            </button>
            <code className="break-all rounded-xl bg-[var(--surface)] px-3 py-2 text-xs text-primary">{webhookSelfTest?.expected_public_url || liveWebhook.webhook_url || metaStatus?.webhook_url || setupCheck?.webhook_url || "/api/meta/webhook"}</code>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              ["Webhook verified", liveWebhook.webhook_verified ? "نعم" : "لا"],
              ["Subscribed apps", liveWebhook.subscribed_apps_status || metaStatus?.subscribed_apps?.subscribed_apps_status || "Unknown"],
              ["Subscription status", liveWebhook.webhook_subscription_status || metaStatus?.subscribed_apps?.webhook_subscription_status || "Unknown"],
              ["Verification status", liveWebhook.webhook_verification_status || metaStatus?.subscribed_apps?.webhook_verification_status || "Unknown"],
              ["Subscribed fields", (liveWebhook.subscribed_apps?.subscribed_fields || metaStatus?.subscribed_apps?.subscribed_fields || []).join(", ") || "Unknown"],
              ["Self-test reachable", webhookSelfTest ? (webhookSelfTest.reachable ? "Yes" : "No") : "Not run"],
              ["Challenge OK", webhookSelfTest ? (webhookSelfTest.challenge_ok ? "Yes" : "No") : "Not run"],
              ["Token OK", webhookSelfTest ? (webhookSelfTest.token_ok ? "Yes" : "No") : "Not run"],
              ["Last webhook event", formatDateTime(liveWebhook.last_webhook_event)],
              ["Last incoming message", formatDateTime(liveWebhook.last_incoming_message)],
              ["Last successful publish", formatDateTime(liveWebhook.last_successful_publish)],
              ["عمليات تسليم فاشلة", liveWebhook.failed_webhook_deliveries ?? 0],
              ["Last retry", formatDateTime(liveWebhook.last_retry)],
              ["Event throughput 24h", liveWebhook.event_throughput_24h ?? 0],
              ["Expected public URL", webhookSelfTest?.expected_public_url || liveWebhook.webhook_url || metaStatus?.webhook_url || "/api/meta/webhook"],
            ].map(([label, value]) => (
              <div key={label} className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
                <div className="text-sm font-semibold text-[var(--muted)]">{label}</div>
                <div className="mt-2 break-words text-sm font-black text-[var(--text)]">{value}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] p-5 shadow-[var(--shadow-card)] md:p-6">
          <div className="inline-flex min-h-9 items-center gap-2 rounded-full border border-amber-400/20 bg-amber-400/10 px-3 py-1.5 text-sm font-semibold text-amber-200">
            <KeyRound className="h-4 w-4" />
            حالة رمز الوصول
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {[
              ["عمر الرمز", tokenIntelligence.age_days === null || tokenIntelligence.age_days === undefined ? "غير معروف" : `${tokenIntelligence.age_days} يوم`],
              ["Expiration countdown", tokenIntelligence.expiration_countdown_seconds === null || tokenIntelligence.expiration_countdown_seconds === undefined ? "Unknown" : `${Math.max(0, Math.floor(tokenIntelligence.expiration_countdown_seconds / 3600))}h`],
              ["Refresh history", formatDateTime(tokenIntelligence.last_refresh_at)],
              ["Last refresh status", tokenIntelligence.last_refresh_status || "not_run"],
              ["Auto-refresh success", `${tokenIntelligence.auto_refresh_success_rate ?? 0}%`],
            ].map(([label, value]) => (
              <div key={label} className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
                <div className="text-sm font-semibold text-[var(--muted)]">{label}</div>
                <div className="mt-2 text-sm font-black text-[var(--text)]">{value}</div>
              </div>
            ))}
          </div>
        </section>

        <section id="marketing-settings-automation" className="scroll-mt-6 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] p-5 shadow-[var(--shadow-card)] md:p-6">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="inline-flex min-h-9 items-center gap-2 rounded-full border border-amber-400/20 bg-amber-400/10 px-3 py-1.5 text-sm font-semibold text-amber-200">
                <MessageCircle className="h-4 w-4" />
                {t("marketing.automation.commentDm.eyebrow")}
              </div>
              <h2 className="m1-section-title mt-3">{t("marketing.automation.commentDm.title")}</h2>
              <p className="mt-2 text-base leading-7 text-[var(--muted)]">{t("marketing.settings.capabilities.automationHelp", "قواعد التعليق إلى الرسالة والردود التلقائية وسجلات الأتمتة.")} {t("marketing.settings.capabilities.activeRules", "القواعد النشطة")}: {activeRulesCount}</p>
            </div>
            <button onClick={() => { setEditingRuleId(null); setRuleForm(blankRule); }} className="inline-flex items-center gap-2 rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm font-semibold text-[var(--text)]">
              <Plus className="h-4 w-4" />
              {t("marketing.automation.newRule")}
            </button>
          </div>

          <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_1fr]">
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
              <div className="flex items-center gap-2 text-sm font-black text-[var(--text)]">
                <Bot className="h-4 w-4 text-primary" />
                AI automation controls
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {[
                  ["autoReply", "الرد التلقائي بالذكاء الاصطناعي"],
                  ["intentDetection", "اكتشاف النية بالذكاء الاصطناعي"],
                  ["humanEscalation", "قواعد التصعيد البشري"],
                  ["smartLeadDetection", "اكتشاف العملاء المحتملين الذكي"],
                ].map(([key, label]) => (
                  <label key={key} className="flex items-center justify-between gap-3 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs font-semibold text-[var(--text)]">
                    <span>{label}</span>
                    <input type="checkbox" checked={Boolean(aiSettings[key])} onChange={(event) => setAiSettings((current) => ({ ...current, [key]: event.target.checked }))} />
                  </label>
                ))}
              </div>
            </div>
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
              <div className="text-sm font-black text-[var(--text)]">{t("marketing.metaSettings.events.commentToMessagePerformance")}</div>
              <div className="mt-4 grid grid-cols-3 gap-2">
                {[
                  ["القواعد النشطة", activeRulesCount],
                  ["Sent replies", successfulRuleCount],
                  ["الردود الفاشلة", failedRuleCount],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-3">
                    <div className="text-[11px] text-[var(--muted)]">{label}</div>
                    <div className="mt-1 text-lg font-black text-[var(--text)]">{value}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
            <div className="space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
              <div className="grid gap-3 md:grid-cols-2">
                <label className="space-y-2 md:col-span-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">{t("marketing.automation.fields.ruleName")}</span>
                  <input value={ruleForm.name} onChange={(event) => setRuleForm((current) => ({ ...current, name: event.target.value }))} className="w-full rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--text)] outline-none" />
                </label>
                <label className="space-y-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">{t("marketing.social.platform")}</span>
                  <select value={ruleForm.platform} onChange={(event) => setRuleForm((current) => ({ ...current, platform: event.target.value }))} className="w-full rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--text)] outline-none">
                    <option value="facebook">{t("marketing.social.platforms.facebook")}</option>
                    <option value="instagram">{t("marketing.social.platforms.instagram")}</option>
                  </select>
                </label>
                <label className="space-y-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">{t("marketing.automation.fields.matchMode")}</span>
                  <select value={ruleForm.match_mode} onChange={(event) => setRuleForm((current) => ({ ...current, match_mode: event.target.value }))} className="w-full rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--text)] outline-none">
                    <option value="any">{t("marketing.automation.matchModes.any")}</option>
                    <option value="all">{t("marketing.automation.matchModes.all")}</option>
                    <option value="exact">{t("marketing.automation.matchModes.exact")}</option>
                  </select>
                </label>
                <label className="space-y-2 md:col-span-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">{t("marketing.automation.fields.triggerKeywords")}</span>
                  <input value={ruleForm.trigger_keywords} onChange={(event) => setRuleForm((current) => ({ ...current, trigger_keywords: event.target.value }))} placeholder={t("marketing.automation.placeholders.triggerKeywords")} className="w-full rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--text)] outline-none" />
                </label>
                <label className="space-y-2 md:col-span-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">{t("marketing.automation.fields.excludedKeywords")}</span>
                  <input value={ruleForm.excluded_keywords} onChange={(event) => setRuleForm((current) => ({ ...current, excluded_keywords: event.target.value }))} placeholder={t("marketing.automation.placeholders.excludedKeywords")} className="w-full rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--text)] outline-none" />
                </label>
                <label className="space-y-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">{t("marketing.automation.fields.erpPostId")}</span>
                  <input value={ruleForm.post_id} onChange={(event) => setRuleForm((current) => ({ ...current, post_id: event.target.value }))} className="w-full rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--text)] outline-none" />
                </label>
                <label className="space-y-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">{t("marketing.automation.fields.platformPostId")}</span>
                  <input value={ruleForm.platform_post_id} onChange={(event) => setRuleForm((current) => ({ ...current, platform_post_id: event.target.value }))} className="w-full rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--text)] outline-none" />
                </label>
                <label className="space-y-2 md:col-span-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">{t("marketing.automation.fields.dmMessage")}</span>
                  <textarea value={ruleForm.response_message} onChange={(event) => setRuleForm((current) => ({ ...current, response_message: event.target.value }))} rows={4} className="w-full rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--text)] outline-none" />
                </label>
                <label className="space-y-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">{t("marketing.metaSettings.preview.template")}</span>
                  <input value={ruleForm.template_name || ""} onChange={(event) => setRuleForm((current) => ({ ...current, template_name: event.target.value }))} className="w-full rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--text)] outline-none" />
                </label>
                <label className="flex items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--text)]">
                  <input type="checkbox" checked={Boolean(ruleForm.ai_generated_replies)} onChange={(event) => setRuleForm((current) => ({ ...current, ai_generated_replies: event.target.checked }))} />
                  الردود المُولدة بالذكاء الاصطناعي
                </label>
                <label className="space-y-2 md:col-span-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">{t("marketing.metaSettings.preview.fallbackReply")}</span>
                  <textarea value={ruleForm.fallback_reply || ""} onChange={(event) => setRuleForm((current) => ({ ...current, fallback_reply: event.target.value }))} rows={2} className="w-full rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--text)] outline-none" />
                </label>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <label className="flex items-center gap-3 text-sm text-[var(--text)]">
                  <input type="checkbox" checked={Boolean(ruleForm.is_active)} onChange={(event) => setRuleForm((current) => ({ ...current, is_active: event.target.checked }))} />
                  {t("marketing.campaigns.status.active")}
                </label>
                <button onClick={saveRule} disabled={saving} className="rounded-[var(--radius-control)] bg-primary px-4 py-3 text-sm font-semibold text-[var(--primary-contrast)] disabled:opacity-60">
                  {editingRuleId ? t("marketing.automation.updateRule") : t("marketing.automation.createRule")}
                </button>
              </div>
            </div>

            <div className="space-y-3">
              <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4">
                <div className="text-sm font-black text-[var(--text)]">{t("marketing.metaSettings.preview.simulator")}</div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <input value={simulator.commenter_name} onChange={(event) => setSimulator((current) => ({ ...current, commenter_name: event.target.value }))} className="rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] outline-none" />
                  <input value={simulator.comment_text} onChange={(event) => setSimulator((current) => ({ ...current, comment_text: event.target.value }))} className="rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] outline-none" />
                </div>
                <div className="mt-3 rounded-xl bg-[var(--surface)] p-3 text-sm leading-6 text-[var(--text)]">
                  {(ruleForm.response_message || ruleForm.fallback_reply || "").replace(/\{\{\s*commenter_name\s*\}\}/g, simulator.commenter_name || "Customer")}
                </div>
              </div>
              {rules.length ? rules.map((rule) => (
                <div key={rule.id} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                      <div className="font-semibold text-[var(--text)]">{rule.name}</div>
                      <div className="mt-1 text-xs text-[var(--muted)]">{rule.platform} / {rule.match_mode} / {rule.is_active ? t("marketing.campaigns.status.active") : t("marketing.campaigns.status.paused")}</div>
                      <div className="mt-2 text-sm text-[var(--muted)]">{listToInput(rule.trigger_keywords) || t("marketing.automation.allComments")}</div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button onClick={() => applyRuleToForm(rule)} className="rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs font-semibold text-[var(--text)]">{t("marketing.common.edit")}</button>
                      <button onClick={() => runRuleTest(rule)} className="rounded-[var(--radius-control)] border border-primary/20 bg-primary/10 px-3 py-2 text-xs font-semibold text-primary">{t("marketing.automation.test")}</button>
                      <button onClick={() => removeRule(rule.id)} className="rounded-[var(--radius-control)] border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-xs font-semibold text-rose-100">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              )) : (
                <div className="rounded-2xl border border-dashed border-[var(--border)] p-8 text-center text-sm text-[var(--muted)]">{t("marketing.automation.commentDm.empty")}</div>
              )}

              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">{t("marketing.automation.recentLogs")}</div>
                <div className="mt-3 space-y-2">
                  {logs.slice(0, 5).map((log) => (
                    <div key={log.id} className="flex items-center justify-between gap-3 rounded-xl bg-[var(--surface)] px-3 py-2 text-xs text-[var(--muted)]">
                      <span className="truncate">{log.comment_text}</span>
                      <span className={log.status === "sent" ? "text-emerald-300" : "text-rose-300"}>{log.status}</span>
                    </div>
                  ))}
                  {!logs.length ? <div className="text-sm text-[var(--muted)]">{t("marketing.automation.noLogs")}</div> : null}
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
