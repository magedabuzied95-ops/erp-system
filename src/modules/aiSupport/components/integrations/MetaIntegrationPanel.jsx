// Meta (Facebook Messenger + Instagram) integration panel.
//
// This is the single owner of Meta connection management. It used to be spread
// across /marketing/settings (OAuth wizard, capability cards, webhook
// diagnostics, token entry) and /admin/ai-channels (status tiles, test sends);
// both of those surfaces are gone and everything they could do lives here.
//
// The AI-mode and tone controls the old channels page carried are deliberately
// NOT here: those are conversation settings and already live in the inbox
// itself. This panel answers one question only — is the account connected, and
// what is stopping it.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  KeyRound,
  Link2,
  MessageCircle,
  PlayCircle,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  Workflow,
} from "lucide-react";

import {
  enableMetaWebhookSubscription,
  getMarketingSettings,
  getMetaCapabilities,
  getMetaHealth,
  getMetaIntegrationStatus,
  getMetaOAuthPages,
  getMetaSetupCheck,
  getMetaWebhookHealth,
  getMetaWebhookSelfTest,
  refreshMarketingMetaTokens,
  removeInstagramAppSecret,
  removeInstagramBusinessAccessToken,
  saveInstagramAppSecret,
  saveInstagramBusinessAccessToken,
  selectMetaOAuthPage,
  startMetaOAuth,
  testMarketingAutoRefresh,
  testMetaMessage,
  testMetaPublish,
  updateMarketingSettings,
} from "../../../marketing/services/marketingApi";
import {
  ActionButton,
  CheckRow,
  CopyRow,
  FieldRow,
  PanelSection,
  PanelSkeleton,
  StatusPill,
  TextInput,
  clean,
  formatDateTime,
  stateLabel,
} from "./integrationsUi.jsx";

// Literal keys, not an interpolated meta.steps.<key> lookup — see stateLabel.
const stepLabel = (t, key) => {
  if (key === "login") return t("aiSupport.integrations.meta.steps.login");
  if (key === "page") return t("aiSupport.integrations.meta.steps.page");
  if (key === "instagram") return t("aiSupport.integrations.meta.steps.instagram");
  if (key === "permissions") return t("aiSupport.integrations.meta.steps.permissions");
  if (key === "webhook") return t("aiSupport.integrations.meta.steps.webhook");
  return t("aiSupport.integrations.meta.steps.complete");
};

const META_OAUTH_TIMEOUT_MS = 30000;
const SUPPRESSED = { suppressErrorStatuses: [400, 403, 404, 409, 500] };
const DEAD_TOKEN_STATUSES = ["token_expired", "expired", "invalid", "revoked", "error"];

const devLog = (message, details = {}) => {
  if (import.meta.env.DEV) console.debug(`[meta-oauth] ${message}`, details);
};

const isConnectedStatus = (status = "") => ["connected", "fully_connected"].includes(clean(status).toLowerCase());

const subscriptionVerified = (subscription = {}) =>
  subscription.subscribed_apps_status === "subscribed" && subscription.webhook_subscription_status === "subscribed";

const capabilityConnected = (capability = {}) =>
  capability?.connected === true || capability?.ok === true || isConnectedStatus(capability?.status);

// Ported verbatim in behaviour from the old marketing settings page: the
// backend's setup_completion is authoritative when present, and everything else
// is a client-side fallback so a half-populated status payload still resolves.
const resolveMetaSetupCompletion = ({ status = {}, health = {}, capabilities = {}, webhook = {}, form = {} } = {}) => {
  const safeStatus = status && typeof status === "object" ? status : {};
  const safeHealth = health && typeof health === "object" ? health : {};
  const safeCapabilities = capabilities && typeof capabilities === "object" ? capabilities : {};
  const safeWebhook = webhook && typeof webhook === "object" ? webhook : {};
  const safeForm = form && typeof form === "object" ? form : {};
  const backendCompletion =
    safeHealth?.setup_completion || safeCapabilities?.setup_completion || safeStatus?.setup_completion || safeWebhook?.setup_completion || {};
  const config = safeStatus?.config || safeHealth?.config || {};
  const subscription = safeWebhook?.subscribed_apps || safeStatus?.subscribed_apps || {};
  const capabilityMap = safeCapabilities?.capabilities || safeHealth?.capabilities || {};
  const channels = safeStatus?.channels || safeHealth?.channels || {};
  const token = safeHealth?.token || {};
  const tokenActive = Boolean(
    config.page_access_token_configured &&
      !["token_expired", "invalid", "revoked", "error"].includes(clean(token.status || config.token_health_status || config.token_status).toLowerCase())
  );
  const messengerConnected = Boolean(
    channels.facebook?.messenger_connected || capabilityConnected(capabilityMap.messenger) || capabilityConnected(capabilityMap.facebook_messenger)
  );
  const instagramMessagingConnected = Boolean(
    channels.instagram?.dm_connected || capabilityConnected(capabilityMap.instagram_dm) || capabilityConnected(capabilityMap.instagram)
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
  return completion;
};

const EMPTY_FORM = {
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
};

const settingsToForm = (data = {}) => ({
  ...EMPTY_FORM,
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
});

export default function MetaIntegrationPanel({ onStatusChange }) {
  const { t } = useTranslation();

  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(EMPTY_FORM);
  const [metaStatus, setMetaStatus] = useState(null);
  const [metaHealth, setMetaHealth] = useState(null);
  const [metaCapabilities, setMetaCapabilities] = useState(null);
  const [webhookHealth, setWebhookHealth] = useState(null);
  const [webhookSelfTest, setWebhookSelfTest] = useState(null);
  const [setupCheck, setSetupCheck] = useState(null);
  const [oauthPages, setOauthPages] = useState([]);
  const [advancedMode, setAdvancedMode] = useState(false);
  const [instagramAccessToken, setInstagramAccessToken] = useState("");
  const [instagramAppSecret, setInstagramAppSecret] = useState("");
  const [busy, setBusy] = useState("");

  const formRef = useRef(form);
  formRef.current = form;
  const oauthPopupRef = useRef(null);
  const oauthTimeoutRef = useRef(null);
  const oauthClosedIntervalRef = useRef(null);
  const mountedRef = useRef(true);

  useEffect(() => () => { mountedRef.current = false; }, []);

  const applyMetaStatus = useCallback((status = {}) => {
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
  }, []);

  const loadDiagnostics = useCallback(async () => {
    const [healthResult, capabilitiesResult, webhookResult, setupResult] = await Promise.allSettled([
      getMetaHealth(SUPPRESSED),
      getMetaCapabilities(SUPPRESSED),
      getMetaWebhookHealth(SUPPRESSED),
      getMetaSetupCheck(SUPPRESSED),
    ]);
    const diagnostics = {};
    if (healthResult.status === "fulfilled") { diagnostics.health = healthResult.value; setMetaHealth(healthResult.value); }
    if (capabilitiesResult.status === "fulfilled") { diagnostics.capabilities = capabilitiesResult.value; setMetaCapabilities(capabilitiesResult.value); }
    if (webhookResult.status === "fulfilled") { diagnostics.webhook = webhookResult.value; setWebhookHealth(webhookResult.value); }
    if (setupResult.status === "fulfilled") { diagnostics.setup = setupResult.value; setSetupCheck(setupResult.value); }
    return diagnostics;
  }, []);

  const refreshStatus = useCallback(async () => {
    const status = await getMetaIntegrationStatus(SUPPRESSED);
    applyMetaStatus(status);
    const diagnostics = await loadDiagnostics();
    return { status, diagnostics };
  }, [applyMetaStatus, loadDiagnostics]);

  const reload = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const [settingsResult, statusResult] = await Promise.allSettled([getMarketingSettings(), getMetaIntegrationStatus(SUPPRESSED)]);
      if (!mountedRef.current) return;
      if (settingsResult.status === "fulfilled" && settingsResult.value) setForm(settingsToForm(settingsResult.value));
      if (statusResult.status === "fulfilled") applyMetaStatus(statusResult.value);
      await loadDiagnostics();
    } finally {
      if (mountedRef.current && !silent) setLoading(false);
    }
  }, [applyMetaStatus, loadDiagnostics]);

  useEffect(() => { void reload(); }, [reload]);

  const clearOAuthWatchers = useCallback(() => {
    if (oauthTimeoutRef.current) { window.clearTimeout(oauthTimeoutRef.current); oauthTimeoutRef.current = null; }
    if (oauthClosedIntervalRef.current) { window.clearInterval(oauthClosedIntervalRef.current); oauthClosedIntervalRef.current = null; }
    oauthPopupRef.current = null;
  }, []);

  useEffect(() => () => clearOAuthWatchers(), [clearOAuthWatchers]);

  // The OAuth popup posts back here when Meta redirects to our callback.
  useEffect(() => {
    const onMessage = async (event) => {
      if (event?.data?.type !== "meta-oauth") return;
      const payload = event.data.payload || {};
      devLog("callback received", { success: payload.success, status: payload.status });
      try {
        if (!payload.success) {
          toast.error(payload.message || t("aiSupport.integrations.meta.toast.connectFailed"));
          return;
        }
        if (payload.status === "pages_ready") {
          const [pagesPayload] = await Promise.all([getMetaOAuthPages(SUPPRESSED), refreshStatus()]);
          if (!mountedRef.current) return;
          setOauthPages(Array.isArray(pagesPayload?.pages) ? pagesPayload.pages : []);
          toast.success(t("aiSupport.integrations.meta.toast.selectPage"));
          return;
        }
        setOauthPages([]);
        await refreshStatus();
        toast.success(payload.message || t("aiSupport.integrations.meta.toast.connected"));
      } catch (error) {
        toast.error(error?.message || t("aiSupport.integrations.meta.toast.oauthFailed"));
      } finally {
        clearOAuthWatchers();
        if (mountedRef.current) setBusy("");
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [clearOAuthWatchers, refreshStatus, t]);

  const run = useCallback(async (key, task) => {
    setBusy(key);
    try {
      await task();
    } finally {
      if (mountedRef.current) setBusy("");
    }
  }, []);

  const connectOAuth = useCallback(async () => {
    clearOAuthWatchers();
    setBusy("oauth");
    try {
      const result = await startMetaOAuth();
      if (!result?.auth_url) throw new Error(t("aiSupport.integrations.meta.toast.noAuthUrl"));
      const popup = window.open(result.auth_url, "meta-oauth", "width=720,height=760,menubar=no,toolbar=no,status=no");
      if (!popup) {
        // Popup blocked: a full-page redirect still completes the flow.
        clearOAuthWatchers();
        setBusy("");
        window.location.href = result.auth_url;
        return;
      }
      oauthPopupRef.current = popup;
      oauthTimeoutRef.current = window.setTimeout(() => {
        clearOAuthWatchers();
        if (mountedRef.current) setBusy("");
        toast.error(t("aiSupport.integrations.meta.toast.timeout"));
      }, META_OAUTH_TIMEOUT_MS);
      oauthClosedIntervalRef.current = window.setInterval(() => {
        if (!oauthPopupRef.current?.closed) return;
        clearOAuthWatchers();
        if (mountedRef.current) setBusy("");
        refreshStatus().catch((error) => devLog("status refresh after popup close failed", { message: error?.message }));
      }, 500);
      popup.focus?.();
    } catch (error) {
      clearOAuthWatchers();
      setBusy("");
      toast.error(error?.message || t("aiSupport.integrations.meta.toast.oauthFailed"));
    }
  }, [clearOAuthWatchers, refreshStatus, t]);

  const choosePage = (page) => run(`page:${page.page_id}`, async () => {
    try {
      await selectMetaOAuthPage({ page_id: page.page_id });
      setOauthPages([]);
      await refreshStatus();
      toast.success(t("aiSupport.integrations.meta.toast.pageConnected"));
    } catch (error) {
      toast.error(error?.message || t("aiSupport.integrations.meta.toast.pageFailed"));
    }
  });

  const verifyWebhook = () => run("webhook", async () => {
    try {
      const [result, subscription] = await Promise.all([
        getMetaWebhookSelfTest(SUPPRESSED),
        enableMetaWebhookSubscription({}, SUPPRESSED),
      ]);
      setWebhookSelfTest(result);
      if (result?.success && subscription?.success !== false) toast.success(t("aiSupport.integrations.meta.toast.webhookVerified"));
      else toast.error(subscription?.subscription?.error || result?.error || t("aiSupport.integrations.meta.toast.webhookFailed"));
      await refreshStatus();
    } catch (error) {
      toast.error(error?.message || t("aiSupport.integrations.meta.toast.webhookFailed"));
    }
  });

  const completeSetup = () => run("complete", async () => {
    try {
      const refreshed = await refreshStatus();
      const completion = resolveMetaSetupCompletion({
        status: refreshed.status,
        health: refreshed.diagnostics?.health,
        capabilities: refreshed.diagnostics?.capabilities,
        webhook: refreshed.diagnostics?.webhook,
        form: formRef.current,
      });
      if (completion.complete) toast.success(t("aiSupport.integrations.meta.toast.setupComplete"));
      else toast.error(t("aiSupport.integrations.meta.toast.setupPartial"));
    } catch (error) {
      toast.error(error?.message || t("aiSupport.integrations.meta.toast.setupFailed"));
    }
  });

  const saveManualSettings = () => run("save", async () => {
    try {
      const saved = await updateMarketingSettings(formRef.current);
      setForm(settingsToForm(saved));
      await refreshStatus();
      toast.success(t("aiSupport.integrations.meta.toast.saved"));
    } catch (error) {
      toast.error(error?.message || t("aiSupport.integrations.meta.toast.saveFailed"));
    }
  });

  const reconnectTokens = () => run("reconnect", async () => {
    try {
      const saved = await refreshMarketingMetaTokens({
        provider: formRef.current.provider,
        page_id: formRef.current.page_id,
        instagram_account_id: formRef.current.instagram_account_id,
        access_token_encrypted: formRef.current.access_token_encrypted,
      });
      setForm(settingsToForm(saved));
      await refreshStatus();
      toast.success(t("aiSupport.integrations.meta.toast.reconnected"));
    } catch (error) {
      toast.error(error?.message || t("aiSupport.integrations.meta.toast.reconnectFailed"));
    }
  });

  const runAutoRefreshTest = () => run("autorefresh", async () => {
    try {
      const payload = await testMarketingAutoRefresh();
      setForm(settingsToForm(payload?.data || payload));
      await refreshStatus();
      toast.success(payload?.skipped ? t("aiSupport.integrations.meta.toast.autoRefreshSkipped") : t("aiSupport.integrations.meta.toast.autoRefreshDone"));
    } catch (error) {
      toast.error(error?.message || t("aiSupport.integrations.meta.toast.autoRefreshFailed"));
    }
  });

  const saveIgToken = () => run("ig-token", async () => {
    try {
      const payload = await saveInstagramBusinessAccessToken({
        access_token: instagramAccessToken,
        instagram_business_account_id: formRef.current.instagram_account_id || undefined,
      });
      setInstagramAccessToken("");
      await refreshStatus();
      if (payload?.warning) toast(payload.warning, { icon: "⚠️" });
      else toast.success(t("aiSupport.integrations.meta.toast.igTokenSaved"));
    } catch (error) {
      toast.error(error?.message || t("aiSupport.integrations.meta.toast.igTokenFailed"));
    }
  });

  const removeIgToken = () => run("ig-token", async () => {
    try {
      await removeInstagramBusinessAccessToken();
      setInstagramAccessToken("");
      await refreshStatus();
      toast.success(t("aiSupport.integrations.meta.toast.igTokenRemoved"));
    } catch (error) {
      toast.error(error?.message || t("aiSupport.integrations.meta.toast.igTokenRemoveFailed"));
    }
  });

  const saveIgSecret = () => run("ig-secret", async () => {
    try {
      await saveInstagramAppSecret({ app_secret: instagramAppSecret });
      setInstagramAppSecret("");
      await refreshStatus();
      toast.success(t("aiSupport.integrations.meta.toast.igSecretSaved"));
    } catch (error) {
      toast.error(error?.message || t("aiSupport.integrations.meta.toast.igSecretFailed"));
    }
  });

  const removeIgSecret = () => run("ig-secret", async () => {
    try {
      await removeInstagramAppSecret();
      setInstagramAppSecret("");
      await refreshStatus();
      toast.success(t("aiSupport.integrations.meta.toast.igSecretRemoved"));
    } catch (error) {
      toast.error(error?.message || t("aiSupport.integrations.meta.toast.igSecretRemoveFailed"));
    }
  });

  const runMessageTest = (platform) => run(`test-message:${platform}`, async () => {
    try {
      const result = await testMetaMessage({ platform });
      toast.success(result?.dry_run ? t("aiSupport.integrations.meta.toast.messagePermissionsOk") : t("aiSupport.integrations.meta.toast.testMessageSent"));
      await refreshStatus();
    } catch (error) {
      toast.error(error?.message || t("aiSupport.integrations.meta.toast.testMessageFailed"));
    }
  });

  const runPublishTest = (platform) => run(`test-publish:${platform}`, async () => {
    try {
      await testMetaPublish({ platform });
      toast.success(t("aiSupport.integrations.meta.toast.publishPermissionsOk"));
      await refreshStatus();
    } catch (error) {
      toast.error(error?.message || t("aiSupport.integrations.meta.toast.testPublishFailed"));
    }
  });

  const metaConfig = metaStatus?.config || {};
  const facebookStatus = metaStatus?.channels?.facebook || {};
  const instagramStatus = metaStatus?.channels?.instagram || {};
  const liveCapabilities = useMemo(
    () => metaCapabilities?.capabilities || metaHealth?.capabilities || {},
    [metaCapabilities?.capabilities, metaHealth?.capabilities]
  );
  const liveWebhook = webhookHealth || metaHealth?.webhook || {};
  const tokenIntelligence = metaHealth?.token || {};

  const setupCompletion = resolveMetaSetupCompletion({ status: metaStatus, health: metaHealth, capabilities: metaCapabilities, webhook: liveWebhook, form });
  const permissionsReady = Boolean(setupCompletion.permissions_saved);
  const webhookReady = Boolean(setupCompletion.webhook_verified && setupCompletion.webhook_enabled && setupCompletion.subscribed_apps_verified);
  const tokenReady = Boolean(
    metaConfig.page_access_token_configured &&
      !DEAD_TOKEN_STATUSES.includes(clean(metaConfig.token_health_status || metaConfig.token_status || tokenIntelligence.status).toLowerCase())
  );
  const instagramTokenReady = Boolean(
    metaConfig.instagram_access_token_configured && !DEAD_TOKEN_STATUSES.includes(clean(metaConfig.instagram_token_status).toLowerCase())
  );
  const messengerConnected = Boolean(facebookStatus.messenger_connected || (tokenReady && webhookReady && (metaConfig.facebook_page_id || form.page_id)));
  const instagramDmConnected = Boolean(
    instagramStatus.dm_connected || ((instagramTokenReady || tokenReady) && webhookReady && (metaConfig.instagram_business_account_id || form.instagram_account_id))
  );

  const pageLabel = metaConfig.facebook_page_name || metaConfig.page_name || form.page_id;
  const instagramLabel = metaConfig.instagram_username || form.instagram_account_id;

  const steps = [
    { key: "login", done: setupCompletion.oauth_connected },
    { key: "page", done: setupCompletion.page_selected },
    { key: "instagram", done: setupCompletion.instagram_connected },
    { key: "permissions", done: permissionsReady },
    { key: "webhook", done: webhookReady },
    { key: "complete", done: setupCompletion.complete },
  ];
  const completedSteps = steps.filter((step) => step.done).length;
  const state = setupCompletion.complete ? "connected" : completedSteps > 0 ? "partial" : "off";

  const missingPermissions = useMemo(() => {
    const items = [liveCapabilities.messenger, liveCapabilities.instagram_dm, liveCapabilities.facebook_publishing, liveCapabilities.instagram_publishing];
    return [...new Set(items.flatMap((item) => item?.missing_permissions || []))];
  }, [liveCapabilities]);

  useEffect(() => { onStatusChange?.(state); }, [onStatusChange, state]);

  if (loading) return <PanelSkeleton rows={4} />;

  const capabilityCards = [
    {
      key: "messenger",
      icon: MessageCircle,
      title: t("aiSupport.integrations.meta.capability.messenger"),
      subtitle: pageLabel || t("aiSupport.integrations.meta.noPage"),
      connected: messengerConnected,
      checks: [
        { label: t("aiSupport.integrations.meta.check.webhook"), ok: webhookReady || facebookStatus.webhook_healthy },
        { label: t("aiSupport.integrations.meta.check.token"), ok: tokenReady || facebookStatus.token_valid },
        { label: t("aiSupport.integrations.meta.check.receive"), ok: messengerConnected || liveCapabilities.messenger?.details?.receive_messages },
        { label: t("aiSupport.integrations.meta.check.send"), ok: messengerConnected || liveCapabilities.messenger?.details?.send_replies },
      ],
      missing: liveCapabilities.messenger?.missing_permissions,
      onTest: () => runMessageTest("facebook"),
      testKey: "test-message:facebook",
    },
    {
      key: "instagram_dm",
      icon: Send,
      title: t("aiSupport.integrations.meta.capability.instagramDm"),
      subtitle: instagramLabel || t("aiSupport.integrations.meta.noInstagram"),
      connected: instagramDmConnected,
      checks: [
        { label: t("aiSupport.integrations.meta.check.webhook"), ok: webhookReady || instagramStatus.webhook_healthy },
        { label: t("aiSupport.integrations.meta.check.token"), ok: instagramTokenReady || tokenReady || instagramStatus.token_valid },
        { label: t("aiSupport.integrations.meta.check.receive"), ok: instagramDmConnected || liveCapabilities.instagram_dm?.details?.receive_dms },
        { label: t("aiSupport.integrations.meta.check.storyMentions"), ok: liveCapabilities.instagram_dm?.details?.story_mention_support },
      ],
      missing: liveCapabilities.instagram_dm?.missing_permissions,
      onTest: () => runMessageTest("instagram"),
      testKey: "test-message:instagram",
    },
    {
      key: "facebook_publishing",
      icon: FileText,
      title: t("aiSupport.integrations.meta.capability.facebookPublishing"),
      subtitle: pageLabel || t("aiSupport.integrations.meta.noPage"),
      connected: Boolean(facebookStatus.publishing_connected),
      checks: [
        { label: t("aiSupport.integrations.meta.check.feedPublish"), ok: liveCapabilities.facebook_publishing?.details?.feed_publishing },
        { label: t("aiSupport.integrations.meta.check.mediaUpload"), ok: liveCapabilities.facebook_publishing?.details?.media_upload },
        { label: t("aiSupport.integrations.meta.check.scheduled"), ok: liveCapabilities.facebook_publishing?.details?.scheduled_publishing },
        { label: t("aiSupport.integrations.meta.check.noFailures"), ok: !liveCapabilities.facebook_publishing?.details?.failed_publishes },
      ],
      missing: liveCapabilities.facebook_publishing?.missing_permissions,
      onTest: () => runPublishTest("facebook"),
      testKey: "test-publish:facebook",
    },
    {
      key: "instagram_publishing",
      icon: Sparkles,
      title: t("aiSupport.integrations.meta.capability.instagramPublishing"),
      subtitle: instagramLabel || t("aiSupport.integrations.meta.noInstagram"),
      connected: Boolean(instagramStatus.publishing_connected),
      checks: [
        { label: t("aiSupport.integrations.meta.check.feedPublish"), ok: liveCapabilities.instagram_publishing?.details?.feed_publishing },
        { label: t("aiSupport.integrations.meta.check.mediaUpload"), ok: liveCapabilities.instagram_publishing?.details?.media_upload },
        { label: t("aiSupport.integrations.meta.check.scheduled"), ok: liveCapabilities.instagram_publishing?.details?.scheduled_publishing },
        { label: t("aiSupport.integrations.meta.check.noFailures"), ok: !liveCapabilities.instagram_publishing?.details?.failed_publishes },
      ],
      missing: liveCapabilities.instagram_publishing?.missing_permissions,
      onTest: () => runPublishTest("instagram"),
      testKey: "test-publish:instagram",
    },
  ];

  return (
    <div className="space-y-4">
      <PanelSection
        icon={Workflow}
        title={t("aiSupport.integrations.meta.connection.title")}
        subtitle={t("aiSupport.integrations.meta.connection.subtitle")}
        tone={state === "connected" ? "emerald" : state === "partial" ? "amber" : "slate"}
        action={
          <>
            <StatusPill state={state}>{stateLabel(t, state)}</StatusPill>
            <ActionButton tone="ghost" icon={RefreshCw} loading={busy === "refresh"} onClick={() => run("refresh", () => reload({ silent: true }))}>
              {t("aiSupport.integrations.common.refresh")}
            </ActionButton>
          </>
        }
      >
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_260px]">
          <div className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <FieldRow label={t("aiSupport.integrations.meta.field.page")} value={pageLabel} fallback={t("aiSupport.integrations.meta.noPage")} />
              <FieldRow label={t("aiSupport.integrations.meta.field.instagram")} value={instagramLabel} fallback={t("aiSupport.integrations.meta.noInstagram")} />
              <FieldRow label={t("aiSupport.integrations.meta.field.tokenStatus")} value={form.token_health_status || form.token_status} />
              <FieldRow label={t("aiSupport.integrations.meta.field.tokenExpires")} value={formatDateTime(form.token_expires_at)} />
            </div>
            <div className="flex flex-wrap gap-2">
              <ActionButton tone="meta" icon={KeyRound} loading={busy === "oauth"} onClick={connectOAuth}>
                {setupCompletion.oauth_connected ? t("aiSupport.integrations.meta.action.reconnectMeta") : t("aiSupport.integrations.meta.action.connectMeta")}
              </ActionButton>
              <ActionButton tone="amber" icon={PlayCircle} loading={busy === "webhook"} onClick={verifyWebhook}>
                {t("aiSupport.integrations.meta.action.verifyWebhook")}
              </ActionButton>
              <ActionButton tone="emerald" icon={CheckCircle2} loading={busy === "complete"} onClick={completeSetup}>
                {t("aiSupport.integrations.meta.action.completeSetup")}
              </ActionButton>
              <ActionButton tone="ghost" onClick={() => setAdvancedMode((value) => !value)}>
                {advancedMode ? t("aiSupport.integrations.common.guidedMode") : t("aiSupport.integrations.common.advancedMode")}
              </ActionButton>
            </div>
            {form.token_error_message ? (
              <p className="flex items-start gap-2 rounded-xl border border-amber-300/20 bg-amber-400/10 p-3 text-xs leading-5 text-amber-100">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {form.token_error_message}
              </p>
            ) : null}
          </div>
          <div className="rounded-xl border border-white/10 bg-slate-950/40 p-3">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[11px] font-black uppercase tracking-[0.12em] text-slate-500">{t("aiSupport.integrations.meta.steps.title")}</span>
              <span className="text-sm font-black text-white">{completedSteps}/{steps.length}</span>
            </div>
            <div className="mt-2 space-y-1.5">
              {steps.map((step) => <CheckRow key={step.key} ok={step.done} label={stepLabel(t, step.key)} />)}
            </div>
          </div>
        </div>
      </PanelSection>

      {oauthPages.length ? (
        <PanelSection icon={Link2} title={t("aiSupport.integrations.meta.pages.title")} subtitle={t("aiSupport.integrations.meta.pages.subtitle")} tone="amber">
          <div className="grid gap-2 sm:grid-cols-2">
            {oauthPages.map((page) => (
              <button
                key={page.page_id}
                type="button"
                onClick={() => choosePage(page)}
                disabled={Boolean(busy)}
                className="rounded-xl border border-white/10 bg-slate-950/50 p-3 text-start transition hover:border-cyan-300/30 hover:bg-white/[0.05] disabled:opacity-50"
              >
                <div className="truncate text-sm font-black text-white">{page.page_name || page.page_id}</div>
                <div className="mt-1 truncate text-[11px] text-slate-400">{t("aiSupport.integrations.meta.pages.pageId")}: {page.page_id}</div>
                <div className="mt-1 truncate text-[11px] text-cyan-200">
                  {t("aiSupport.integrations.meta.pages.instagram")}: {page.instagram_username || page.instagram_business_account_id || t("aiSupport.integrations.meta.pages.noLinkedInstagram")}
                </div>
              </button>
            ))}
          </div>
        </PanelSection>
      ) : null}

      <PanelSection icon={ShieldCheck} title={t("aiSupport.integrations.meta.capabilities.title")} subtitle={t("aiSupport.integrations.meta.capabilities.subtitle")}>
        <div className="grid gap-3 lg:grid-cols-2">
          {capabilityCards.map((card) => (
            <div key={card.key} className="rounded-xl border border-white/10 bg-slate-950/40 p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <card.icon className="h-4 w-4 shrink-0 text-slate-300" aria-hidden="true" />
                  <div className="min-w-0">
                    <div className="truncate text-xs font-black text-white">{card.title}</div>
                    <div className="truncate text-[11px] text-slate-400">{card.subtitle}</div>
                  </div>
                </div>
                <StatusPill state={card.connected ? "connected" : "off"}>{card.connected ? t("aiSupport.integrations.state.connected") : t("aiSupport.integrations.state.off")}</StatusPill>
              </div>
              <div className="mt-3 grid gap-1.5 sm:grid-cols-2">
                {card.checks.map((check) => <CheckRow key={check.label} ok={Boolean(check.ok)} label={check.label} />)}
              </div>
              {card.missing?.length ? (
                <p className="mt-2 text-[11px] leading-5 text-amber-200/90">{t("aiSupport.integrations.meta.missingPermissions")}: {card.missing.join(", ")}</p>
              ) : null}
              <ActionButton tone="ghost" icon={PlayCircle} loading={busy === card.testKey} onClick={card.onTest} className="mt-3">
                {t("aiSupport.integrations.meta.action.testLive")}
              </ActionButton>
            </div>
          ))}
        </div>
        {missingPermissions.length ? (
          <p className="mt-3 rounded-xl border border-amber-300/20 bg-amber-400/10 p-3 text-xs leading-5 text-amber-100">
            {t("aiSupport.integrations.meta.appReviewNote", { permissions: missingPermissions.join(", ") })}
          </p>
        ) : null}
      </PanelSection>

      <PanelSection icon={KeyRound} title={t("aiSupport.integrations.meta.instagram.title")} subtitle={t("aiSupport.integrations.meta.instagram.subtitle")}>
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="rounded-xl border border-white/10 bg-slate-950/40 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-black text-white">{t("aiSupport.integrations.meta.instagram.tokenTitle")}</span>
              <StatusPill state={metaConfig.instagram_access_token_configured ? "connected" : "off"}>
                {metaConfig.instagram_access_token_configured ? t("aiSupport.integrations.meta.instagram.stored") : t("aiSupport.integrations.meta.instagram.notStored")}
              </StatusPill>
            </div>
            <p className="mt-2 text-[11px] leading-5 text-slate-400">{t("aiSupport.integrations.meta.instagram.tokenHint")}</p>
            <TextInput
              type="password"
              autoComplete="new-password"
              className="mt-3"
              value={instagramAccessToken}
              onChange={(event) => setInstagramAccessToken(event.target.value)}
              placeholder={t("aiSupport.integrations.meta.instagram.tokenPlaceholder")}
            />
            <div className="mt-2 flex flex-wrap gap-2">
              <ActionButton tone="primary" loading={busy === "ig-token"} disabled={!instagramAccessToken.trim()} onClick={saveIgToken}>
                {t("aiSupport.integrations.common.saveAndVerify")}
              </ActionButton>
              {metaConfig.instagram_access_token_configured ? (
                <ActionButton tone="rose" loading={busy === "ig-token"} onClick={removeIgToken}>{t("aiSupport.integrations.common.disable")}</ActionButton>
              ) : null}
            </div>
            <div className="mt-2 text-[11px] text-slate-500">
              {t("aiSupport.integrations.meta.field.tokenStatus")}: {metaConfig.instagram_token_status || t("aiSupport.integrations.common.missing")}
              {" • "}
              {metaConfig.instagram_webhook_subscribed ? t("aiSupport.integrations.meta.instagram.webhookSubscribed") : t("aiSupport.integrations.meta.instagram.webhookPending")}
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-slate-950/40 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-black text-white">{t("aiSupport.integrations.meta.instagram.secretTitle")}</span>
              <StatusPill state={metaConfig.instagram_app_secret_configured ? "connected" : "off"}>
                {metaConfig.instagram_app_secret_configured ? t("aiSupport.integrations.meta.instagram.stored") : t("aiSupport.integrations.meta.instagram.notStored")}
              </StatusPill>
            </div>
            <p className="mt-2 text-[11px] leading-5 text-slate-400">{t("aiSupport.integrations.meta.instagram.secretHint")}</p>
            <TextInput
              type="password"
              autoComplete="new-password"
              className="mt-3"
              value={instagramAppSecret}
              onChange={(event) => setInstagramAppSecret(event.target.value)}
              placeholder={t("aiSupport.integrations.meta.instagram.secretPlaceholder")}
            />
            <div className="mt-2 flex flex-wrap gap-2">
              <ActionButton tone="primary" loading={busy === "ig-secret"} disabled={!instagramAppSecret.trim()} onClick={saveIgSecret}>
                {t("aiSupport.integrations.common.save")}
              </ActionButton>
              {metaConfig.instagram_app_secret_configured ? (
                <ActionButton tone="rose" loading={busy === "ig-secret"} onClick={removeIgSecret}>{t("aiSupport.integrations.common.disable")}</ActionButton>
              ) : null}
            </div>
          </div>
        </div>
      </PanelSection>

      {advancedMode ? (
        <PanelSection icon={KeyRound} title={t("aiSupport.integrations.meta.advanced.title")} subtitle={t("aiSupport.integrations.meta.advanced.subtitle")} tone="amber">
          <div className="grid gap-3 sm:grid-cols-2">
            <TextInput
              label={t("aiSupport.integrations.meta.advanced.provider")}
              value={form.provider}
              onChange={(event) => setForm((current) => ({ ...current, provider: event.target.value }))}
            />
            <TextInput
              label={t("aiSupport.integrations.meta.advanced.pageId")}
              value={form.page_id}
              onChange={(event) => setForm((current) => ({ ...current, page_id: event.target.value }))}
            />
            <TextInput
              label={t("aiSupport.integrations.meta.advanced.instagramId")}
              value={form.instagram_account_id}
              onChange={(event) => setForm((current) => ({ ...current, instagram_account_id: event.target.value }))}
            />
            <TextInput
              label={t("aiSupport.integrations.meta.advanced.shortLivedToken")}
              type="password"
              autoComplete="new-password"
              value={form.access_token_encrypted}
              onChange={(event) => setForm((current) => ({ ...current, access_token_encrypted: event.target.value }))}
            />
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <FieldRow label={t("aiSupport.integrations.meta.advanced.autoRefresh")} value={form.auto_refresh_enabled ? t("aiSupport.integrations.common.on") : t("aiSupport.integrations.common.off")} />
            <FieldRow label={t("aiSupport.integrations.meta.advanced.lastValidated")} value={formatDateTime(form.token_last_validated_at)} />
            <FieldRow label={t("aiSupport.integrations.meta.advanced.lastAutoRefresh")} value={formatDateTime(form.last_auto_refresh_at)} />
            <FieldRow label={t("aiSupport.integrations.meta.advanced.nextRefreshCheck")} value={formatDateTime(form.next_refresh_check_at)} />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <ActionButton tone="primary" loading={busy === "save"} onClick={saveManualSettings}>{t("aiSupport.integrations.common.save")}</ActionButton>
            <ActionButton tone="ghost" icon={RefreshCw} loading={busy === "reconnect"} onClick={reconnectTokens}>{t("aiSupport.integrations.meta.action.refreshTokens")}</ActionButton>
            <ActionButton tone="ghost" icon={Sparkles} loading={busy === "autorefresh"} onClick={runAutoRefreshTest}>{t("aiSupport.integrations.meta.action.testAutoRefresh")}</ActionButton>
          </div>
        </PanelSection>
      ) : null}

      <details className="group rounded-2xl border border-white/10 bg-white/[0.035]">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4">
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-xl border border-white/10 bg-white/[0.06] text-slate-200">
              <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            </span>
            <div>
              <h3 className="text-sm font-black text-white">{t("aiSupport.integrations.meta.diagnostics.title")}</h3>
              <p className="mt-0.5 text-xs text-slate-400">{t("aiSupport.integrations.meta.diagnostics.subtitle")}</p>
            </div>
          </div>
          <span className="text-lg text-slate-400 transition group-open:rotate-180">⌄</span>
        </summary>
        <div className="space-y-3 border-t border-white/10 p-4">
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-xl border border-white/10 bg-slate-950/40 p-3">
              <div className="text-[11px] font-black uppercase tracking-[0.12em] text-slate-500">{t("aiSupport.integrations.meta.diagnostics.environment")}</div>
              <div className="mt-2 space-y-1.5" dir="ltr">
                {["META_APP_ID", "META_APP_SECRET", "META_REDIRECT_URI", "META_VERIFY_TOKEN"].map((key) => (
                  <div key={key} className="flex items-center justify-between gap-3 text-[11px]">
                    <span className="text-slate-400">{key}</span>
                    <span className={setupCheck?.env?.[key] === "present" ? "font-black text-emerald-300" : "font-black text-rose-300"}>
                      {setupCheck?.env?.[key] || "missing"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <CopyRow label={t("aiSupport.integrations.meta.diagnostics.redirectUri")} value={setupCheck?.redirect_uri} copyLabel={t("aiSupport.integrations.common.copy")} />
              <CopyRow
                label={t("aiSupport.integrations.meta.diagnostics.webhookUrl")}
                value={webhookSelfTest?.expected_public_url || liveWebhook.webhook_url || metaStatus?.webhook_url || setupCheck?.webhook_url}
                copyLabel={t("aiSupport.integrations.common.copy")}
              />
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <FieldRow label={t("aiSupport.integrations.meta.diagnostics.webhookVerified")} value={liveWebhook.webhook_verified ? t("aiSupport.integrations.common.yes") : t("aiSupport.integrations.common.no")} />
            <FieldRow label={t("aiSupport.integrations.meta.diagnostics.subscribedApps")} value={liveWebhook.subscribed_apps_status || metaStatus?.subscribed_apps?.subscribed_apps_status} />
            <FieldRow label={t("aiSupport.integrations.meta.diagnostics.subscription")} value={liveWebhook.webhook_subscription_status || metaStatus?.subscribed_apps?.webhook_subscription_status} />
            <FieldRow
              label={t("aiSupport.integrations.meta.diagnostics.subscribedFields")}
              value={(liveWebhook.subscribed_apps?.subscribed_fields || metaStatus?.subscribed_apps?.subscribed_fields || []).join(", ")}
            />
            <FieldRow label={t("aiSupport.integrations.meta.diagnostics.selfTestReachable")} value={webhookSelfTest ? (webhookSelfTest.reachable ? t("aiSupport.integrations.common.yes") : t("aiSupport.integrations.common.no")) : t("aiSupport.integrations.common.notRun")} />
            <FieldRow label={t("aiSupport.integrations.meta.diagnostics.challengeOk")} value={webhookSelfTest ? (webhookSelfTest.challenge_ok ? t("aiSupport.integrations.common.yes") : t("aiSupport.integrations.common.no")) : t("aiSupport.integrations.common.notRun")} />
            <FieldRow label={t("aiSupport.integrations.meta.diagnostics.lastEvent")} value={formatDateTime(liveWebhook.last_webhook_event)} />
            <FieldRow label={t("aiSupport.integrations.meta.diagnostics.lastIncoming")} value={formatDateTime(liveWebhook.last_incoming_message)} />
            <FieldRow label={t("aiSupport.integrations.meta.diagnostics.lastPublish")} value={formatDateTime(liveWebhook.last_successful_publish)} />
            <FieldRow label={t("aiSupport.integrations.meta.diagnostics.failedDeliveries")} value={String(liveWebhook.failed_webhook_deliveries ?? 0)} />
            <FieldRow label={t("aiSupport.integrations.meta.diagnostics.throughput24h")} value={String(liveWebhook.event_throughput_24h ?? 0)} />
            <FieldRow label={t("aiSupport.integrations.meta.diagnostics.tokenAge")} value={tokenIntelligence.age_days == null ? t("aiSupport.integrations.common.unknown") : t("aiSupport.integrations.meta.diagnostics.days", { count: tokenIntelligence.age_days })} />
          </div>

          {setupCheck?.required_permissions?.length ? (
            <div className="rounded-xl border border-white/10 bg-slate-950/40 p-3">
              <div className="text-[11px] font-black uppercase tracking-[0.12em] text-slate-500">{t("aiSupport.integrations.meta.diagnostics.requiredPermissions")}</div>
              <div className="mt-2 flex flex-wrap gap-1.5" dir="ltr">
                {setupCheck.required_permissions.map((permission) => (
                  <span key={permission} className="rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-1 text-[11px] font-bold text-slate-200">{permission}</span>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </details>
    </div>
  );
}
