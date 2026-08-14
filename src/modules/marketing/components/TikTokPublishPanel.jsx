// TikTok posting options inside the Social Publisher composer.
//
// Renders only what /tiktok/posting-options returns for THIS creator: the
// privacy list, the interaction toggles, and the duration cap all come from
// TikTok. Nothing about the creator's capabilities is hardcoded, and an
// interaction the creator has switched off is rendered disabled rather than
// sent as a value TikTok would reject.
//
// The panel owns the options *state* but not the publish action: the composer's
// existing Publish / Draft buttons stay the only way to post, so selecting a
// video never auto-publishes.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, ExternalLink, Loader2, RefreshCw } from "lucide-react";

import { api } from "../../../shared/api/api";
import {  deriveTikTokOptionAvailability,
  reconcileTikTokOptions,
  tiktokAccountReadiness,
  tiktokComplianceStatementKey,
  tiktokContentLabelKey,
  validateTikTokComposerOptions,
} from "../lib/tiktokPublishOptions";

const Toggle = ({ label, hint, checked, disabled, onChange }) => (
  <label className={`flex items-start gap-2.5 rounded-xl border p-3 transition ${
    disabled ? "cursor-not-allowed border-white/5 bg-white/[0.02] opacity-60" : "cursor-pointer border-white/10 bg-white/[0.03] hover:border-white/20"
  }`}>
    <input
      type="checkbox"
      className="mt-0.5 h-4 w-4 accent-emerald-400"
      checked={checked}
      disabled={disabled}
      onChange={(event) => onChange(event.target.checked)}
    />
    <span className="min-w-0">
      <span className="block text-xs font-medium text-slate-100">{label}</span>
      {hint ? <span className="mt-0.5 block text-[11px] leading-relaxed text-slate-400">{hint}</span> : null}
    </span>
  </label>
);

export default function TikTokPublishPanel({
  active,
  mediaType,
  mediaFile,
  options,
  onOptionsChange,
  onReadinessChange,
}) {
  const { t } = useTranslation();
  const [connection, setConnection] = useState(null);
  const [connectionLoading, setConnectionLoading] = useState(true);
  const [creatorInfo, setCreatorInfo] = useState(null);
  const [creatorLoading, setCreatorLoading] = useState(false);
  const [creatorError, setCreatorError] = useState("");
  const [durationSec, setDurationSec] = useState(0);

  const readiness = useMemo(() => tiktokAccountReadiness(connection), [connection]);

  const loadConnection = useCallback(async () => {
    setConnectionLoading(true);
    try {
      const response = await api.get("/tiktok/status");
      setConnection(response?.data || null);
    } catch {
      setConnection(null);
    } finally {
      setConnectionLoading(false);
    }
  }, []);

  const loadCreatorInfo = useCallback(async () => {
    setCreatorLoading(true);
    setCreatorError("");
    try {
      const response = await api.get("/tiktok/posting-options");
      setCreatorInfo(response?.data || null);
    } catch (error) {
      setCreatorInfo(null);
      setCreatorError(error?.responseBody?.message || error?.message || t("marketing.tiktok.optionsLoadFailed"));
    } finally {
      setCreatorLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (!active) return;
    void loadConnection();
  }, [active, loadConnection]);

  // Creator info is fetched only once the account is known-good, and re-fetched
  // whenever the panel is reopened: TikTok requires the displayed options to be
  // the creator's current ones, so a cached list is not acceptable.
  useEffect(() => {
    if (!active || !readiness.ready) return;
    void loadCreatorInfo();
  }, [active, readiness.ready, loadCreatorInfo]);

  // Read the real duration from the file so the creator's max_video_post_duration_sec
  // can be enforced before an upload rather than after it.
  useEffect(() => {
    if (!mediaFile || !String(mediaFile.type || "").startsWith("video/")) {
      setDurationSec(0);
      return undefined;
    }
    const url = URL.createObjectURL(mediaFile);
    const probe = document.createElement("video");
    probe.preload = "metadata";
    const onLoaded = () => {
      setDurationSec(Number.isFinite(probe.duration) ? Math.round(probe.duration) : 0);
      URL.revokeObjectURL(url);
    };
    probe.addEventListener("loadedmetadata", onLoaded);
    probe.src = url;
    return () => {
      probe.removeEventListener("loadedmetadata", onLoaded);
      URL.revokeObjectURL(url);
    };
  }, [mediaFile]);

  const availability = useMemo(
    () => deriveTikTokOptionAvailability(creatorInfo || {}, options),
    [creatorInfo, options]
  );

  const validation = useMemo(
    () => validateTikTokComposerOptions({
      options,
      creatorInfo: creatorInfo || {},
      video: { mediaType, fileName: mediaFile?.name || "", fileSize: mediaFile?.size || 0, durationSec, maxDurationSec: availability.maxDurationSec },
    }),
    [options, creatorInfo, mediaType, mediaFile, durationSec, availability.maxDurationSec]
  );

  // The composer disables Publish from this; it is the single source of truth
  // for "is TikTok ready to post right now".
  useEffect(() => {
    onReadinessChange?.({
      ready: readiness.ready && Boolean(creatorInfo) && validation.valid,
      loading: connectionLoading || creatorLoading,
      accountReady: readiness.ready,
      reasonKey: readiness.reasonKey,
      errors: validation.errors,
      durationSec,
      // Handed up so the composer can build the payload against the same
      // creator_info the user was shown, without a second fetch.
      creatorInfo: creatorInfo || null,
    });
  }, [readiness, creatorInfo, validation, connectionLoading, creatorLoading, durationSec, onReadinessChange]);

  const update = useCallback((patch) => {
    onOptionsChange(reconcileTikTokOptions({ ...options, ...patch }, creatorInfo || {}));
  }, [options, creatorInfo, onOptionsChange]);

  if (!active) return null;

  if (connectionLoading) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-xs text-slate-300">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        {t("marketing.tiktok.loadingAccount")}
      </div>
    );
  }

  if (!readiness.ready) {
    return (
      <div className="rounded-2xl border border-amber-300/25 bg-amber-400/[0.06] p-4">
        <p className="flex items-start gap-2 text-xs text-amber-100">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {t(readiness.reasonKey)}
        </p>
        {readiness.needsSettings ? (
          <a
            href="/admin/ai-channels"
            className="mt-3 inline-flex items-center gap-1.5 rounded-xl border border-amber-300/30 px-3 py-2 text-xs text-amber-100 hover:bg-amber-400/10"
          >
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            {t("marketing.tiktok.goToChannelSettings")}
          </a>
        ) : null}
      </div>
    );
  }

  return (
    <div className="grid gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <header className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-slate-100">{t("marketing.tiktok.optionsTitle")}</p>
          {creatorInfo?.creator_nickname ? (
            <p className="truncate text-[11px] text-slate-400">{creatorInfo.creator_nickname}</p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={loadCreatorInfo}
          disabled={creatorLoading}
          className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 text-[11px] text-slate-300 disabled:opacity-50"
        >
          {creatorLoading
            ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
            : <RefreshCw className="h-3 w-3" aria-hidden="true" />}
          {t("marketing.tiktok.reloadOptions")}
        </button>
      </header>

      {creatorLoading && !creatorInfo ? (
        <p className="text-[11px] text-slate-400">{t("marketing.tiktok.loadingOptions")}</p>
      ) : null}

      {creatorError ? (
        <p className="rounded-xl border border-rose-300/25 bg-rose-400/[0.06] p-3 text-[11px] text-rose-100">{creatorError}</p>
      ) : null}

      {creatorInfo ? (
        <>
          <div>
            <label htmlFor="tiktok-privacy" className="mb-1.5 block text-[11px] font-medium text-slate-300">
              {t("marketing.tiktok.privacyLabel")}
            </label>
            <select
              id="tiktok-privacy"
              value={options.privacy_level}
              onChange={(event) => update({ privacy_level: event.target.value })}
              className="w-full rounded-xl border border-white/10 bg-slate-950/50 px-3 py-2 text-xs text-slate-100"
            >
              {/* No preselected value: TikTok requires an explicit choice. */}
              <option value="">{t("marketing.tiktok.privacyPlaceholder")}</option>
              {availability.privacy_levels.map((level) => (
                <option key={level.value} value={level.value} disabled={level.disabled}>
                  {level.labelKey ? t(level.labelKey) : level.value}
                  {level.disabled ? ` — ${t(level.disabledReasonKey)}` : ""}
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-2 sm:grid-cols-3">
            <Toggle
              label={t("marketing.tiktok.allowComment")}
              hint={availability.canAllowComment ? "" : t("marketing.tiktok.creatorDisabled")}
              checked={!options.disable_comment && availability.canAllowComment}
              disabled={!availability.canAllowComment}
              onChange={(checked) => update({ disable_comment: !checked })}
            />
            <Toggle
              label={t("marketing.tiktok.allowDuet")}
              hint={availability.canAllowDuet ? "" : t("marketing.tiktok.creatorDisabled")}
              checked={!options.disable_duet && availability.canAllowDuet}
              disabled={!availability.canAllowDuet}
              onChange={(checked) => update({ disable_duet: !checked })}
            />
            <Toggle
              label={t("marketing.tiktok.allowStitch")}
              hint={availability.canAllowStitch ? "" : t("marketing.tiktok.creatorDisabled")}
              checked={!options.disable_stitch && availability.canAllowStitch}
              disabled={!availability.canAllowStitch}
              onChange={(checked) => update({ disable_stitch: !checked })}
            />
          </div>

          {availability.maxDurationSec ? (
            <p className="text-[11px] text-slate-400">
              {t("marketing.tiktok.maxDuration", { max: availability.maxDurationSec })}
              {durationSec ? ` — ${t("marketing.tiktok.currentDuration", { seconds: durationSec })}` : ""}
            </p>
          ) : null}

          {/* Commercial disclosure: off by default, and with it on at least one
              sub-option is mandatory before publishing is allowed. */}
          <div className="grid gap-2 rounded-xl border border-white/10 bg-slate-950/30 p-3">
            <Toggle
              label={t("marketing.tiktok.commercialToggle")}
              hint={t("marketing.tiktok.commercialHint")}
              checked={options.commercial_content_toggle}
              onChange={(checked) => update({ commercial_content_toggle: checked })}
            />
            {options.commercial_content_toggle ? (
              <div className="grid gap-2 sm:grid-cols-2">
                <Toggle
                  label={t("marketing.tiktok.yourBrand")}
                  hint={t("marketing.tiktok.yourBrandHint")}
                  checked={options.brand_organic_toggle}
                  onChange={(checked) => update({ brand_organic_toggle: checked })}
                />
                <Toggle
                  label={t("marketing.tiktok.brandedContent")}
                  hint={t("marketing.tiktok.brandedContentHint")}
                  checked={options.brand_content_toggle}
                  onChange={(checked) => update({ brand_content_toggle: checked })}
                />
              </div>
            ) : null}
            {tiktokContentLabelKey(options) ? (
              <p className="text-[11px] text-emerald-200">{t(tiktokContentLabelKey(options))}</p>
            ) : null}
          </div>

          {validation.errors.length ? (
            <ul className="grid gap-1 rounded-xl border border-amber-300/25 bg-amber-400/[0.06] p-3 text-[11px] text-amber-100">
              {validation.errors.map((error) => (
                <li key={error.key}>{t(error.key, error.params || {})}</li>
              ))}
            </ul>
          ) : null}

          {/* Required consent statement — its wording changes with the disclosure
              selection, per TikTok's content-sharing guidelines. */}
          <p className="text-[11px] leading-relaxed text-slate-400">{t(tiktokComplianceStatementKey(options))}</p>
        </>
      ) : null}
    </div>
  );
}
