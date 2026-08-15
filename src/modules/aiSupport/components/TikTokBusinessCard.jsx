// TikTok API for Business status card — Channel Settings.
//
// WHY THIS IS A SECOND CARD AND NOT A SECTION INSIDE TikTokConnectionCard
// ----------------------------------------------------------------------
// They are two different TikTok apps with two different approval states. A
// merchant who sees one "TikTok — Connected" card reasonably concludes that
// TikTok is fully wired up, and would then wonder why no DMs arrive. Splitting
// them into "TikTok Publishing" (connectable today) and "TikTok Business
// Messaging & Comments" (awaiting permission) makes the gap impossible to
// misread.
//
// This card is read-only by construction. There is nothing to connect: the
// developer app is PENDING, so no App ID exists and no authorization flow can
// start. Rendering a disabled Connect button would imply the flow merely needs
// a click; naming the outstanding approvals is the honest version.
//
// Nothing here is fabricated. Every value comes from GET /api/tiktok-business/status,
// which reports declared capability state — never conversations, never counts.

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Clock, Music2, ShieldAlert } from "lucide-react";

import { api } from "../../../shared/api/api";

const text = (value, fallback = "") => String(value ?? fallback).trim();

const PendingRow = ({ title, status, detail }) => (
  <div className="rounded-2xl border border-amber-300/20 bg-amber-400/[0.045] p-3">
    <div className="flex items-center justify-between gap-2">
      <p className="text-xs font-medium text-slate-100">{title}</p>
      <span className="flex shrink-0 items-center gap-1 rounded-full border border-amber-300/25 px-2 py-0.5 text-[10px] text-amber-200">
        <Clock className="h-3 w-3" aria-hidden="true" />
        {detail}
      </span>
    </div>
    {status ? <p className="mt-1 font-mono text-[10px] leading-relaxed text-slate-400">{status}</p> : null}
  </div>
);

export default function TikTokBusinessCard() {
  const { t } = useTranslation();
  const [data, setData] = useState(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await api.get("/tiktok-business/status");
      setData(response?.data?.data || null);
    } catch {
      // A failed status read must not be reported as a granted capability.
      // Leaving data null renders the same "awaiting permission" copy, which
      // stays true whether the read failed or the permission is genuinely absent.
      setData(null);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (!loaded) return null;

  const review = data?.app_review || null;
  const messaging = data?.messaging || null;
  const comments = data?.comments || null;
  const prerequisites = Array.isArray(messaging?.prerequisites) ? messaging.prerequisites : [];

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
        <span className="flex shrink-0 items-center gap-1.5 rounded-full border border-amber-300/25 px-3 py-1 text-xs text-amber-200">
          <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
          {t("marketing.tiktokBusiness.appStatusPending")}
        </span>
      </header>

      {/* The single most important sentence on this card. */}
      <p className="mt-4 rounded-2xl border border-sky-300/20 bg-sky-400/[0.05] p-3 text-[11px] leading-relaxed text-sky-100">
        {t("marketing.tiktokBusiness.separateFromPublishing")}
      </p>

      <div className="mt-4 grid gap-2">
        <PendingRow
          title={t("marketing.tiktokBusiness.messagingTitle")}
          status={text(messaging?.status)}
          detail={t("marketing.tiktokBusiness.messagingPending")}
        />
        <PendingRow
          title={t("marketing.tiktokBusiness.commentsTitle")}
          status={text(comments?.status)}
          detail={t("marketing.tiktokBusiness.commentsPending")}
        />
      </div>

      {review ? (
        <dl className="mt-3 grid gap-2 rounded-2xl border border-white/10 bg-slate-950/40 p-3 text-[11px]">
          <div className="flex items-center justify-between gap-2">
            <dt className="text-slate-400">{t("marketing.tiktokBusiness.appReview")}</dt>
            <dd className="text-slate-200">{text(review.app_name)}</dd>
          </div>
          {Array.isArray(review.requested_permissions) && review.requested_permissions.length ? (
            <div>
              <dt className="text-slate-400">{t("marketing.tiktokBusiness.requestedPermissions")}</dt>
              <dd className="mt-1 flex flex-wrap gap-1">
                {review.requested_permissions.map((permission) => (
                  <span key={permission} className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-slate-300">
                    {permission}
                  </span>
                ))}
              </dd>
            </div>
          ) : null}
        </dl>
      ) : null}

      {prerequisites.length ? (
        <div className="mt-3">
          <p className="text-[11px] font-medium text-slate-300">{t("marketing.tiktokBusiness.blockersTitle")}</p>
          <ul className="mt-1.5 grid gap-1">
            {prerequisites.map((item) => (
              <li key={item.key} className="flex items-start gap-2 text-[11px] leading-relaxed text-slate-400">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-amber-300/70" aria-hidden="true" />
                {t(`marketing.tiktokBusiness.blocker.${item.key}`, { defaultValue: item.detail || item.key })}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className="mt-4 text-[10px] leading-relaxed text-slate-500">
        {t("marketing.tiktokBusiness.noFakeData")}
      </p>
    </section>
  );
}
