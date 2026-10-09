// Telegram catalog channels — the owner's control surface.
//
// What it is for: pasting the three channel ids in, seeing how much of the
// catalogue is actually posted, and forcing a sweep. It deliberately does NOT
// let anyone compose a post by hand: every post in the channel is derived from
// the storefront card, so a hand-written one would be the first thing to go
// stale and nothing would ever correct it.

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Megaphone, RefreshCw, Save, Send } from "lucide-react";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";

import { api } from "../../../shared/api/api";
import ThemedSelect from "../../../shared/ui/ThemedSelect";

// Theme tokens, not raw palette utilities: this page has to read in both the
// light and the dark theme, and the design system remaps bare colour utilities
// underneath us.
const card = "rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] p-4 shadow-[var(--shadow-card)]";
const input = "w-full rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--primary)]";
const label = "mb-1 block text-xs text-[var(--muted)]";
const button = "inline-flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-2 text-sm text-[var(--text)] transition hover:bg-[var(--surface-hover)] disabled:opacity-50";
const note = "text-xs text-[var(--muted)]";

const asDate = (value) => {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString();
};

export default function TelegramChannels() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [savingKey, setSavingKey] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [preview, setPreview] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const payload = await api.get("/telegram/catalog/status");
      const data = payload?.data || payload;
      setStatus(data);
      setDrafts(Object.fromEntries((data?.channels || []).map((channel) => [channel.channel_key, {
        title: channel.title || "",
        chat_id: channel.chat_id || "",
        audience: channel.audience || channel.channel_key,
        invite_url: channel.invite_url || "",
        is_active: channel.is_active !== false,
        sort_order: channel.sort_order || 0,
      }])));
    } catch (error) {
      toast.error(error?.message || t("marketing.telegramChannels.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  const loadPreview = useCallback(async () => {
    try {
      const payload = await api.post("/telegram/catalog/preview", {});
      setPreview(payload?.data || null);
    } catch {
      setPreview(null);
    }
  }, []);

  useEffect(() => { load(); loadPreview(); }, [load, loadPreview]);

  const audienceOptions = useMemo(
    () => (status?.audiences || ["men", "women", "kids"]).map((value) => ({
      value,
      label: t(`marketing.telegramChannels.audiences.${value}`, value),
    })),
    [status, t]
  );

  const setDraft = (key, patch) => setDrafts((current) => ({ ...current, [key]: { ...current[key], ...patch } }));

  const saveChannel = async (channelKey) => {
    const draft = drafts[channelKey];
    if (!draft) return;
    setSavingKey(channelKey);
    try {
      await api.put(`/telegram/catalog/channels/${encodeURIComponent(channelKey)}`, draft);
      toast.success(t("marketing.telegramChannels.channel.saved"));
      await load();
    } catch (error) {
      toast.error(error?.message || t("marketing.telegramChannels.channel.saveFailed"));
    } finally {
      setSavingKey("");
    }
  };

  const sync = async (channelId = 0) => {
    setSyncing(true);
    try {
      const payload = await api.post("/telegram/catalog/sync", channelId ? { channel_id: channelId } : {});
      const summary = payload?.data || {};
      toast.success(
        Number.isFinite(Number(summary.created))
          ? t("marketing.telegramChannels.sync.summary", {
              created: summary.created || 0,
              updated: summary.updated || 0,
              soldOut: summary.sold_out || 0,
              unchanged: summary.unchanged || 0,
            })
          : t("marketing.telegramChannels.channel.synced")
      );
      await load();
    } catch (error) {
      toast.error(error?.message || t("marketing.telegramChannels.channel.syncFailed"));
    } finally {
      setSyncing(false);
    }
  };

  const settings = status?.settings || {};
  const queue = status?.queue || {};

  return (
    <div className="space-y-4 p-4">
      <header className={card}>
        <div className="flex items-start gap-3">
          <Megaphone className="mt-1 h-5 w-5 text-[var(--primary)]" />
          <div>
            <h1 className="m1-page-title text-[var(--text)]">{t("marketing.telegramChannels.title")}</h1>
            <p className={`mt-1 ${note}`}>{t("marketing.telegramChannels.subtitle")}</p>
          </div>
        </div>
      </header>

      {!loading && settings.enabled === false && (
        <div className={`${card} flex items-start gap-2 border-[var(--warning,#fbbf24)]/40 text-[var(--text)]`}>
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="text-sm">{t("marketing.telegramChannels.disabled")}</span>
        </div>
      )}
      {!loading && status?.bot_token_configured === false && (
        <div className={`${card} flex items-start gap-2 border-[var(--danger,#f87171)]/40 text-[var(--text)]`}>
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="text-sm">{t("marketing.telegramChannels.noBotToken")}</span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={button} onClick={() => sync(0)} disabled={syncing || settings.enabled === false}>
          <Send className="h-4 w-4" />
          {syncing ? t("marketing.telegramChannels.sync.running") : t("marketing.telegramChannels.sync.all")}
        </button>
        <button type="button" className={button} onClick={load} disabled={loading}>
          <RefreshCw className="h-4 w-4" />
          {t("marketing.telegramChannels.preview.refresh")}
        </button>
        <div className={note}>
          {t("marketing.telegramChannels.queue.title")}: {t("marketing.telegramChannels.queue.pending")} {queue.pending || 0}
          {" · "}{t("marketing.telegramChannels.queue.failed")} {queue.failed || 0}
          {" · "}{t("marketing.telegramChannels.queue.dead")} {queue.dead || 0}
        </div>
        {settings.bot_username ? (
          <div className={note}>{t("marketing.telegramChannels.botUsername")}: @{settings.bot_username}</div>
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {(status?.channels || []).map((channel) => {
          const draft = drafts[channel.channel_key] || {};
          return (
            <div key={channel.channel_key} className={card}>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold">{draft.title || channel.channel_key}</h3>
                <label className={`flex items-center gap-2 ${note}`}>
                  <input
                    type="checkbox"
                    checked={draft.is_active !== false}
                    onChange={(event) => setDraft(channel.channel_key, { is_active: event.target.checked })}
                  />
                  {t("marketing.telegramChannels.channel.active")}
                </label>
              </div>

              <div className="space-y-3">
                <div>
                  <span className={label}>{t("marketing.telegramChannels.channel.title")}</span>
                  <input
                    className={input}
                    value={draft.title || ""}
                    onChange={(event) => setDraft(channel.channel_key, { title: event.target.value })}
                  />
                </div>
                <div>
                  <span className={label}>{t("marketing.telegramChannels.channel.chatId")}</span>
                  <input
                    className={input}
                    value={draft.chat_id || ""}
                    onChange={(event) => setDraft(channel.channel_key, { chat_id: event.target.value })}
                    placeholder="-1001234567890"
                    dir="ltr"
                  />
                  <p className={`mt-1 leading-5 ${note}`}>{t("marketing.telegramChannels.channel.chatIdHint")}</p>
                </div>
                <div>
                  <span className={label}>{t("marketing.telegramChannels.channel.audience")}</span>
                  <ThemedSelect
                    value={draft.audience || ""}
                    onChange={(value) => setDraft(channel.channel_key, { audience: value })}
                    options={audienceOptions}
                    ariaLabel={t("marketing.telegramChannels.channel.audience")}
                    triggerClassName={input}
                  />
                </div>
                <div>
                  <span className={label}>{t("marketing.telegramChannels.channel.inviteUrl")}</span>
                  <input
                    className={input}
                    value={draft.invite_url || ""}
                    onChange={(event) => setDraft(channel.channel_key, { invite_url: event.target.value })}
                    dir="ltr"
                  />
                </div>
              </div>

              <dl className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                <div className="rounded-xl bg-[var(--surface-soft)] p-2">
                  <dt className="text-[var(--muted)]">{t("marketing.telegramChannels.channel.livePosts")}</dt>
                  <dd className="text-base font-semibold">{channel.live_posts}</dd>
                </div>
                <div className="rounded-xl bg-[var(--surface-soft)] p-2">
                  <dt className="text-[var(--muted)]">{t("marketing.telegramChannels.channel.soldOutPosts")}</dt>
                  <dd className="text-base font-semibold">{channel.sold_out_posts}</dd>
                </div>
                <div className="rounded-xl bg-[var(--surface-soft)] p-2">
                  <dt className="text-[var(--muted)]">{t("marketing.telegramChannels.channel.queuedJobs")}</dt>
                  <dd className="text-base font-semibold">{channel.queued_jobs}</dd>
                </div>
              </dl>

              <p className={`mt-2 ${note}`}>
                {t("marketing.telegramChannels.channel.lastSynced")}: {asDate(channel.last_synced_at) || t("marketing.telegramChannels.channel.never")}
              </p>
              {channel.last_error ? (
                <p className="mt-1 break-words text-xs text-[var(--danger,#f87171)]">{channel.last_error}</p>
              ) : null}

              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  className={button}
                  onClick={() => saveChannel(channel.channel_key)}
                  disabled={savingKey === channel.channel_key}
                >
                  <Save className="h-4 w-4" />
                  {t("marketing.telegramChannels.channel.save")}
                </button>
                <button
                  type="button"
                  className={button}
                  onClick={() => sync(channel.id)}
                  disabled={syncing || !draft.chat_id || settings.enabled === false}
                >
                  <Send className="h-4 w-4" />
                  {t("marketing.telegramChannels.channel.syncNow")}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {preview ? (
        <div className={card}>
          <h3 className="mb-2 text-sm font-semibold">{t("marketing.telegramChannels.preview.title")}</h3>
          <pre className="whitespace-pre-wrap rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] p-3 text-sm leading-6 text-[var(--text)]">{preview.caption}</pre>
          <div className="mt-2 flex flex-wrap gap-2">
            {(preview.reply_markup?.inline_keyboard || []).flat().map((item) => (
              <span key={`${item.text}-${item.url}`} className="rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-1 text-xs text-[var(--text)]">
                {item.text}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
