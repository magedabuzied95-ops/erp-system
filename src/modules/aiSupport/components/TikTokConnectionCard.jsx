// TikTok connection card for the Channel Settings page.
//
// Deliberately NOT part of the CHANNELS grid above it: that grid is for
// conversation channels and is driven by per-channel message stats. TikTok is a
// publishing channel — our app type has no TikTok DMs and no comment access —
// so rendering it there would imply an inbox that does not exist.
//
// Nothing secret is rendered here. The API only ever returns the display name,
// username, avatar, status, granted scope names, and timestamps; the client
// key, client secret, access token, and refresh token never leave the backend.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, CheckCircle2, Link2, Loader2, Music2, RefreshCw, Unlink } from "lucide-react";
import toast from "react-hot-toast";

import { api } from "../../../shared/api/api";

const text = (value, fallback = "") => String(value ?? fallback).trim();

// Mirrors TIKTOK_CONNECTION_STATUS on the backend, plus the two transient
// client-only states the user needs to see (connecting / refreshing).
const STATE = {
  LOADING: "loading",
  NOT_CONNECTED: "not_connected",
  CONNECTING: "connecting",
  CONNECTED: "connected",
  REFRESHING: "refreshing",
  RECONNECT_REQUIRED: "reconnect_required",
  ERROR: "error",
};

const TONE = {
  [STATE.CONNECTED]: "border-emerald-300/25 bg-emerald-400/[0.055]",
  [STATE.RECONNECT_REQUIRED]: "border-amber-300/30 bg-amber-400/[0.06]",
  [STATE.ERROR]: "border-rose-300/30 bg-rose-400/[0.06]",
};

const formatDate = (value, locale) => {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : parsed.toLocaleString(locale);
};

export default function TikTokConnectionCard() {
  const { t, i18n } = useTranslation();
  const [status, setStatus] = useState(null);
  const [uiState, setUiState] = useState(STATE.LOADING);
  const [busy, setBusy] = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      const response = await api.get("/tiktok/status");
      const data = response?.data?.data || null;
      setStatus(data);
      setUiState(data?.reconnect_required
        ? STATE.RECONNECT_REQUIRED
        : data?.connected
          ? STATE.CONNECTED
          : text(data?.status) === "error"
            ? STATE.ERROR
            : STATE.NOT_CONNECTED);
    } catch {
      // A failed status read is not a failed connection: keep the card in a
      // neutral state rather than claiming the account is broken.
      setStatus(null);
      setUiState(STATE.NOT_CONNECTED);
    }
  }, []);

  useEffect(() => { void loadStatus(); }, [loadStatus]);

  // The OAuth callback redirects back to this page with ?tiktok=connected|denied|error.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const outcome = params.get("tiktok");
    if (!outcome) return;
    if (outcome === "connected") toast.success(t("marketing.tiktok.connectedToast"));
    else if (outcome === "denied") toast.error(t("marketing.tiktok.deniedToast"));
    else toast.error(t("marketing.tiktok.errorToast"));
    params.delete("tiktok");
    params.delete("reason");
    const query = params.toString();
    window.history.replaceState({}, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
    void loadStatus();
  }, [loadStatus, t]);

  const connect = useCallback(async () => {
    setBusy(true);
    setUiState(STATE.CONNECTING);
    try {
      const response = await api.post("/tiktok/oauth/start");
      const url = text(response?.data?.data?.authorize_url);
      if (!url) throw new Error("missing_authorize_url");
      // Full navigation, not a popup: TikTok's consent page blocks framing and
      // popup blockers would silently swallow the flow.
      window.location.assign(url);
    } catch (error) {
      setBusy(false);
      setUiState(STATE.NOT_CONNECTED);
      toast.error(error?.response?.data?.message || t("marketing.tiktok.connectFailed"));
    }
  }, [t]);

  const refresh = useCallback(async () => {
    setBusy(true);
    setUiState(STATE.REFRESHING);
    try {
      await api.post("/tiktok/oauth/refresh");
      toast.success(t("marketing.tiktok.refreshed"));
    } catch (error) {
      toast.error(error?.response?.data?.message || t("marketing.tiktok.refreshFailed"));
    } finally {
      setBusy(false);
      await loadStatus();
    }
  }, [loadStatus, t]);

  const disconnect = useCallback(async () => {
    if (!window.confirm(t("marketing.tiktok.disconnectConfirm"))) return;
    setBusy(true);
    try {
      await api.post("/tiktok/disconnect");
      toast.success(t("marketing.tiktok.disconnected"));
    } catch (error) {
      toast.error(error?.response?.data?.message || t("marketing.tiktok.disconnectFailed"));
    } finally {
      setBusy(false);
      await loadStatus();
    }
  }, [loadStatus, t]);

  const account = status?.account || null;
  const config = status?.config || null;
  const comments = status?.comments || null;

  const statusLabel = useMemo(() => {
    switch (uiState) {
      case STATE.LOADING: return t("marketing.tiktok.state.loading");
      case STATE.CONNECTING: return t("marketing.tiktok.state.connecting");
      case STATE.REFRESHING: return t("marketing.tiktok.state.refreshing");
      case STATE.CONNECTED: return t("marketing.tiktok.state.connected");
      case STATE.RECONNECT_REQUIRED: return t("marketing.tiktok.state.reconnectRequired");
      case STATE.ERROR: return t("marketing.tiktok.state.error");
      default: return t("marketing.tiktok.state.notConnected");
    }
  }, [uiState, t]);

  const notConfigured = config && !config.configured;

  return (
    <section className={`rounded-3xl border p-5 shadow-xl transition ${TONE[uiState] || "border-white/10 bg-slate-950/30"}`}>
      <header className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-2xl bg-slate-900/60 text-slate-100">
            <Music2 className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h3 className="text-base font-semibold text-slate-100">{t("marketing.tiktok.title")}</h3>
            <p className="text-xs text-slate-400">{t("marketing.tiktok.subtitle")}</p>
          </div>
        </div>
        <span className="flex items-center gap-1.5 rounded-full border border-white/10 px-3 py-1 text-xs text-slate-200">
          {uiState === STATE.LOADING || busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
          {uiState === STATE.CONNECTED ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-300" aria-hidden="true" /> : null}
          {uiState === STATE.RECONNECT_REQUIRED || uiState === STATE.ERROR
            ? <AlertTriangle className="h-3.5 w-3.5 text-amber-300" aria-hidden="true" />
            : null}
          {statusLabel}
        </span>
      </header>

      {notConfigured ? (
        <p className="mt-4 rounded-2xl border border-amber-300/25 bg-amber-400/[0.06] p-3 text-xs text-amber-100">
          {t("marketing.tiktok.notConfigured")}
        </p>
      ) : null}

      {account && uiState !== STATE.NOT_CONNECTED ? (
        <div className="mt-4 grid gap-3">
          <div className="flex items-center gap-3">
            {account.avatar_url ? (
              <img src={account.avatar_url} alt="" className="h-10 w-10 rounded-full object-cover" />
            ) : null}
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-slate-100">{account.display_name || "—"}</p>
              <p className="truncate text-xs text-slate-400">{account.username ? `@${account.username}` : "—"}</p>
            </div>
          </div>

          <dl className="grid grid-cols-2 gap-2 rounded-2xl border border-white/10 bg-slate-950/30 p-3 text-xs">
            <div>
              <dt className="text-slate-400">{t("marketing.tiktok.lastSync")}</dt>
              <dd className="text-slate-200">{formatDate(account.last_sync_at, i18n.language)}</dd>
            </div>
            <div>
              <dt className="text-slate-400">{t("marketing.tiktok.tokenExpires")}</dt>
              <dd className="text-slate-200">{formatDate(account.access_token_expires_at, i18n.language)}</dd>
            </div>
          </dl>

          <div className="flex flex-wrap gap-1.5">
            {account.capabilities?.direct_post ? (
              <span className="rounded-full border border-emerald-300/25 px-2.5 py-1 text-[11px] text-emerald-200">{t("marketing.tiktok.capability.directPost")}</span>
            ) : null}
            {account.capabilities?.draft_upload ? (
              <span className="rounded-full border border-sky-300/25 px-2.5 py-1 text-[11px] text-sky-200">{t("marketing.tiktok.capability.draft")}</span>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* Stated explicitly so nobody assumes comments are merely unconfigured. */}
      {comments && !comments.available ? (
        <p className="mt-4 rounded-2xl border border-white/10 bg-slate-950/40 p-3 text-[11px] leading-relaxed text-slate-400">
          <span className="font-mono text-slate-300">{comments.status}</span>
          {" — "}
          {t("marketing.tiktok.commentsPending")}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        {uiState === STATE.CONNECTED || uiState === STATE.REFRESHING ? (
          <>
            <button type="button" onClick={refresh} disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 px-3 py-2 text-xs text-slate-200 disabled:opacity-50">
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              {t("marketing.tiktok.actions.refresh")}
            </button>
            <button type="button" onClick={disconnect} disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-xl border border-rose-300/25 px-3 py-2 text-xs text-rose-200 disabled:opacity-50">
              <Unlink className="h-3.5 w-3.5" aria-hidden="true" />
              {t("marketing.tiktok.actions.disconnect")}
            </button>
          </>
        ) : (
          <button type="button" onClick={connect} disabled={busy || notConfigured}
            className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-300/25 bg-emerald-400/10 px-3 py-2 text-xs text-emerald-100 disabled:opacity-50">
            <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
            {uiState === STATE.RECONNECT_REQUIRED ? t("marketing.tiktok.actions.reconnect") : t("marketing.tiktok.actions.connect")}
          </button>
        )}
      </div>
    </section>
  );
}
