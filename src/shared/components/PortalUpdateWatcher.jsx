import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { RefreshCw } from "lucide-react";
import { PORTAL_PATH_PATTERN, currentBuildId, fetchLiveBuild } from "../lib/portalBuildUpdate";

// The employee and manager portals live on phones as installed apps that are
// backgrounded, not closed — so a deployment never reaches them until someone
// thinks to reload (2026-09-10: a new tab shipped and "nothing appeared").
//
// Coming back to the app after a real absence reloads it onto the new build at
// once; a newer build found while the portal is in use only raises a banner, so
// nobody loses what they are typing mid-form.

const POLL_MS = 5 * 60 * 1000;
const AWAY_MS_BEFORE_AUTO_RELOAD = 60 * 1000;
const RELOADED_FOR_KEY = "portal.update.reloaded-for";

const readReloadedFor = () => {
  try {
    return sessionStorage.getItem(RELOADED_FOR_KEY) || "";
  } catch {
    return "";
  }
};

const reloadOnto = (build) => {
  try {
    sessionStorage.setItem(RELOADED_FOR_KEY, build);
  } catch {
    // Storage can be blocked; the reload still happens.
  }
  const url = new URL(window.location.href);
  url.searchParams.set("__m1_reload", String(Date.now()));
  window.location.replace(url.toString());
};

export default function PortalUpdateWatcher() {
  const { t } = useTranslation();
  const location = useLocation();
  const isPortal = PORTAL_PATH_PATTERN.test(location.pathname || "");
  const [availableBuild, setAvailableBuild] = useState("");
  const hiddenAtRef = useRef(0);
  const checkingRef = useRef(false);
  const current = useRef(currentBuildId()).current;

  const check = useCallback(async ({ allowAutoReload = false } = {}) => {
    if (!current || checkingRef.current) return;
    checkingRef.current = true;
    try {
      const live = await fetchLiveBuild().catch(() => null);
      if (!live || live === current) return;
      // Already reloaded once for this build and still on the old one (a cache in
      // the way): never loop — let the person press the button instead.
      if (allowAutoReload && readReloadedFor() !== live) {
        reloadOnto(live);
        return;
      }
      setAvailableBuild(live);
    } finally {
      checkingRef.current = false;
    }
  }, [current]);

  useEffect(() => {
    if (!isPortal || !current || import.meta.env.DEV) return undefined;
    // A page opened from a stale HTTP/app cache is already old on its first paint.
    const firstCheck = window.setTimeout(() => void check({ allowAutoReload: true }), 4000);
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAtRef.current = Date.now();
        return;
      }
      const awayFor = hiddenAtRef.current ? Date.now() - hiddenAtRef.current : 0;
      void check({ allowAutoReload: awayFor >= AWAY_MS_BEFORE_AUTO_RELOAD });
    };
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void check();
    }, POLL_MS);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearTimeout(firstCheck);
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [isPortal, current, check]);

  if (!isPortal || !availableBuild) return null;
  return (
    <div className="portal-update-banner fixed inset-x-3 top-[calc(env(safe-area-inset-top)+0.5rem)] z-[120] mx-auto flex max-w-md items-center justify-between gap-3 rounded-[var(--radius-card)] border border-border bg-surface px-3 py-2.5 text-text shadow-2xl" role="status">
      <span className="text-sm font-black">{t("orders.portalBoard.update.available")}</span>
      <button
        type="button"
        onClick={() => reloadOnto(availableBuild)}
        className="inline-flex min-h-[var(--control-height-md)] shrink-0 items-center gap-1.5 rounded-[var(--radius-control)] bg-primary px-3 text-sm font-black text-primary-foreground"
      >
        <RefreshCw className="h-4 w-4" />
        {t("orders.portalBoard.update.reload")}
      </button>
    </div>
  );
}
