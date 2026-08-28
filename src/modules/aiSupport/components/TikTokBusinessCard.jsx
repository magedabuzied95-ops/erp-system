// TikTok API for Business card — Channel Settings.
//
// WHY THIS IS A SECOND CARD AND NOT A SECTION INSIDE TikTokConnectionCard
// ----------------------------------------------------------------------
// They are two different TikTok apps with two different lifecycles. A merchant
// who sees one "TikTok — Connected" card reasonably concludes that TikTok is
// fully wired up. Splitting them into "TikTok Publishing" and "TikTok Business"
// keeps the two authorizations impossible to confuse.
//
// WHAT CHANGED (2026-08-28)
// -------------------------
// The Business app is APPROVED for TikTok Accounts > Account Comment, and the
// backend now implements the real OAuth + comments integration. This card
// renders the RUNTIME state from GET /api/tiktok-business/status — never a
// hardcoded "waiting" string:
//   comments.status ∈ DISABLED | NOT_CONFIGURED | NOT_CONNECTED | TOKEN_EXPIRED
//                     | MISSING_PERMISSION | API_ERROR | AVAILABLE
// Messaging is deliberately still a waiting row: the Business Messaging
// permission was never requested and is a separate application. Nothing on
// this card can enable it.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Link2,
  Loader2,
  Music2,
  RefreshCw,
  ShieldCheck,
  Unplug,
} from "lucide-react";

import { api } from "../../../shared/api/api";

const text = (value, fallback = "") => String(value ?? fallback).trim();

// status -> presentation. Tone drives the badge colours; key drives the copy.
const COMMENT_STATE_PRESENTATION = {
  AVAILABLE: { tone: "ok", labelKey: "marketing.tiktokBusiness.state.available" },
  NOT_CONNECTED: { tone: "info", labelKey: "marketing.tiktokBusiness.state.notConnected" },
  TOKEN_EXPIRED: { tone: "warn", labelKey: "marketing.tiktokBusiness.state.tokenExpired" },
  MISSING_PERMISSION: { tone: "warn", labelKey: "marketing.tiktokBusiness.state.missingPermission" },
  API_ERROR: { tone: "warn", labelKey: "marketing.tiktokBusiness.state.apiError" },
  NOT_CONFIGURED: { tone: "muted", labelKey: "marketing.tiktokBusiness.state.notConfigured" },
  DISABLED: { tone: "muted", labelKey: "marketing.tiktokBusiness.state.disabled" },
};

const TONE_CLASSES = {
  ok: "border-emerald-300/25 bg-emerald-400/[0.06] text-emerald-200",
  info: "border-sky-300/25 bg-sky-400/[0.06] text-sky-200",
  warn: "border-amber-300/25 bg-amber-400/[0.06] text-amber-200",
  muted: "border-white/10 bg-white/[0.03] text-slate-400",
};

const ActionButton = ({ onClick, busy, icon: Icon, children, primary = false }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={busy}
    className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-medium transition disabled:cursor-not-allowed disabled:opacity-60 ${
      primary
        ? "bg-slate-100 text-slate-900 hover:bg-white"
        : "border border-white/15 text-slate-200 hover:border-white/30 hover:text-white"
    }`}
  >
    {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : Icon ? <Icon className="h-3.5 w-3.5" aria-hidden="true" /> : null}
    {children}
  </button>
);

export default function TikTokBusinessCard() {
  const { t, i18n } = useTranslation();
  const [data, setData] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [busyAction, setBusyAction] = useState("");
  const [notice, setNotice] = useState(null); // { tone, message }

  const load = useCallback(async ({ probe = false } = {}) => {
    try {
      const response = await api.get("/tiktok-business/status", { params: probe ? { probe: 1 } : {} });
      setData(response?.data || null);
    } catch {
      // A failed status read must not be reported as a granted capability.
      setData(null);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const runAction = useCallback(async (name, fn) => {
    setBusyAction(name);
    setNotice(null);
    try {
      await fn();
    } catch (error) {
      setNotice({
        tone: "warn",
        message: text(error?.responseBody?.message) || t("marketing.tiktokBusiness.actionFailed"),
      });
    } finally {
      setBusyAction("");
      void load();
    }
  }, [load, t]);

  const onConnect = useCallback(() => runAction("connect", async () => {
    const response = await api.post("/tiktok-business/oauth/start");
    const authorizeUrl = text(response?.data?.authorize_url);
    if (!authorizeUrl) throw new Error("authorize_url missing");
    window.location.assign(authorizeUrl);
  }), [runAction]);

  const onRefresh = useCallback(() => runAction("refresh", async () => {
    await api.post("/tiktok-business/refresh");
    setNotice({ tone: "ok", message: t("marketing.tiktokBusiness.refreshed") });
  }), [runAction, t]);

  const onProbe = useCallback(() => runAction("probe", async () => {
    await load({ probe: true });
  }), [runAction, load]);

  const onSync = useCallback(() => runAction("sync", async () => {
    const response = await api.post("/tiktok-business/comments/sync");
    const result = response?.data || {};
    setNotice({
      tone: "ok",
      message: t("marketing.tiktokBusiness.syncDone", {
        videos: Number(result.videos_checked || 0),
        comments: Number(result.comments_saved || 0),
      }),
    });
  }), [runAction, t]);

  const onDisconnect = useCallback(() => runAction("disconnect", async () => {
    await api.post("/tiktok-business/disconnect");
  }), [runAction]);

  const connection = data?.connection || null;
  const account = connection?.account || null;
  const comments = data?.comments || null;
  const messaging = data?.messaging || null;
  const review = data?.app_review || null;
  const configured = Boolean(data?.config?.configured);
  const enabled = Boolean(data?.config?.enabled);

  const commentsStatus = text(comments?.status) || (enabled ? "NOT_CONNECTED" : "DISABLED");
  const presentation = COMMENT_STATE_PRESENTATION[commentsStatus] || COMMENT_STATE_PRESENTATION.DISABLED;
  const connected = Boolean(connection?.connected);
  const appApproved = text(review?.status) === "APPROVED";

  const formatDate = useCallback((value) => {
    if (!value) return "—";
    try {
      return new Date(value).toLocaleString(i18n.language === "ar" ? "ar-EG" : "en-GB");
    } catch {
      return "—";
    }
  }, [i18n.language]);

  const actions = useMemo(() => {
    if (!enabled || !configured) return [];
    const list = [];
    if (!connected || commentsStatus === "NOT_CONNECTED") {
      list.push({ key: "connect", label: t("marketing.tiktokBusiness.actionConnect"), icon: Link2, onClick: onConnect, primary: true });
    }
    if (commentsStatus === "TOKEN_EXPIRED" || commentsStatus === "MISSING_PERMISSION") {
      list.push({ key: "connect", label: t("marketing.tiktokBusiness.actionReconnect"), icon: Link2, onClick: onConnect, primary: true });
    }
    if (connected) {
      list.push({ key: "probe", label: t("marketing.tiktokBusiness.actionCheckStatus"), icon: RefreshCw, onClick: onProbe });
      if (commentsStatus === "TOKEN_EXPIRED") {
        list.push({ key: "refresh", label: t("marketing.tiktokBusiness.actionRefreshToken"), icon: RefreshCw, onClick: onRefresh });
      }
      if (commentsStatus === "AVAILABLE") {
        list.push({ key: "sync", label: t("marketing.tiktokBusiness.actionSyncComments"), icon: RefreshCw, onClick: onSync });
      }
      list.push({ key: "disconnect", label: t("marketing.tiktokBusiness.actionDisconnect"), icon: Unplug, onClick: onDisconnect });
    }
    return list;
  }, [enabled, configured, connected, commentsStatus, t, onConnect, onProbe, onRefresh, onSync, onDisconnect]);

  if (!loaded) return null;

  return (
    <section className="rounded-3xl border border-white/10 bg-slate-950/30 p-5 shadow-xl">
      <header className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-2xl bg-slate-900/60 text-slate-100">
            <Music2 className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h3 className="text-base font-semibold text-slate-100">{t("marketing.tiktokBusiness.title")}</h3>
            <p className="text-xs text-slate-400">{t("marketing.tiktokBusiness.subtitle")}</p>
          </div>
        </div>
        {appApproved ? (
          <span className="flex shrink-0 items-center gap-1.5 rounded-full border border-emerald-300/25 px-3 py-1 text-xs text-emerald-200">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
            {t("marketing.tiktokBusiness.appStatusApproved")}
          </span>
        ) : (
          <span className="flex shrink-0 items-center gap-1.5 rounded-full border border-amber-300/25 px-3 py-1 text-xs text-amber-200">
            <Clock className="h-3.5 w-3.5" aria-hidden="true" />
            {t("marketing.tiktokBusiness.appStatusPending")}
          </span>
        )}
      </header>

      {/* The single most important sentence on this card. */}
      <p className="mt-4 rounded-2xl border border-sky-300/20 bg-sky-400/[0.05] p-3 text-[11px] leading-relaxed text-sky-100">
        {t("marketing.tiktokBusiness.separateFromPublishing")}
      </p>

      {notice ? (
        <p className={`mt-3 rounded-2xl border p-3 text-[11px] leading-relaxed ${TONE_CLASSES[notice.tone] || TONE_CLASSES.muted}`}>
          {notice.message}
        </p>
      ) : null}

      {/* Connected account */}
      {connected && account ? (
        <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/40 p-3">
          <div className="flex items-center gap-3">
            {text(account.avatar_url) ? (
              <img src={account.avatar_url} alt="" className="h-9 w-9 rounded-full object-cover" />
            ) : (
              <span className="grid h-9 w-9 place-items-center rounded-full bg-slate-900 text-slate-400">
                <Music2 className="h-4 w-4" aria-hidden="true" />
              </span>
            )}
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-slate-100">{text(account.display_name) || "—"}</p>
              <p className="truncate text-xs text-slate-400">{text(account.username) ? `@${account.username}` : "—"}</p>
            </div>
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
            <div>
              <dt className="text-slate-400">{t("marketing.tiktok.lastSync")}</dt>
              <dd className="text-slate-200">{formatDate(account.last_sync_at)}</dd>
            </div>
            <div>
              <dt className="text-slate-400">{t("marketing.tiktok.tokenExpires")}</dt>
              <dd className="text-slate-200">{formatDate(account.access_token_expires_at)}</dd>
            </div>
          </dl>
        </div>
      ) : null}

      {/* Comments — real runtime state */}
      <div className={`mt-3 rounded-2xl border p-3 ${TONE_CLASSES[presentation.tone]}`}>
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium text-slate-100">{t("marketing.tiktokBusiness.commentsTitle")}</p>
          <span className="flex shrink-0 items-center gap-1 rounded-full border border-current/25 px-2 py-0.5 text-[10px]">
            {commentsStatus === "AVAILABLE" ? (
              <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
            ) : (
              <AlertTriangle className="h-3 w-3" aria-hidden="true" />
            )}
            {t(presentation.labelKey)}
          </span>
        </div>
        <p className="mt-1 font-mono text-[10px] leading-relaxed opacity-80">{commentsStatus}</p>
        {commentsStatus === "AVAILABLE" && comments?.state?.can_reply === false ? (
          <p className="mt-1 text-[10px] leading-relaxed opacity-90">{t("marketing.tiktokBusiness.replyScopeMissing")}</p>
        ) : null}
        {Array.isArray(comments?.missing_scopes) && comments.missing_scopes.length ? (
          <p className="mt-1 font-mono text-[10px] leading-relaxed opacity-80">
            {t("marketing.tiktokBusiness.missingScopes")}: {comments.missing_scopes.join(", ")}
          </p>
        ) : null}
      </div>

      {/* Messaging — deliberately still a waiting row */}
      <div className="mt-2 rounded-2xl border border-amber-300/20 bg-amber-400/[0.045] p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium text-slate-100">{t("marketing.tiktokBusiness.messagingTitle")}</p>
          <span className="flex shrink-0 items-center gap-1 rounded-full border border-amber-300/25 px-2 py-0.5 text-[10px] text-amber-200">
            <Clock className="h-3 w-3" aria-hidden="true" />
            {t("marketing.tiktokBusiness.messagingPending")}
          </span>
        </div>
        <p className="mt-1 font-mono text-[10px] leading-relaxed text-slate-400">{text(messaging?.status)}</p>
      </div>

      {actions.length ? (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {actions.map((action) => (
            <ActionButton
              key={`${action.key}-${action.label}`}
              onClick={action.onClick}
              busy={busyAction === action.key}
              icon={action.icon}
              primary={action.primary}
            >
              {action.label}
            </ActionButton>
          ))}
        </div>
      ) : null}

      {!enabled || !configured ? (
        <p className="mt-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-[11px] leading-relaxed text-slate-400">
          {t("marketing.tiktokBusiness.serverNotConfigured")}
        </p>
      ) : null}
    </section>
  );
}
