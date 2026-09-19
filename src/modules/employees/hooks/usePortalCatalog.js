import { useCallback, useEffect, useRef, useState } from "react";

import { resolveProductImageUrl } from "../../../shared/lib/imageUrls";
import {
  getEmployeePortalInventoryCatalogSnapshot,
  getEmployeePortalInventoryCatalogVersion,
} from "../services/employeePortalInventoryApi";
import {
  connectionAllowsImageWarm,
  extractCatalogImageUrls,
  readPortalCatalog,
  refreshPortalCatalog,
  warmPortalCatalogImages,
} from "../services/employeeDrafts/portalCatalogCache.js";
import { getCountSearchIndex } from "../services/employeeDrafts/countSearchIndex.js";

// Building the search index is the one expensive step (tens of ms on a desktop,
// several times that on a phone). It is done HERE, in idle time, before the
// snapshot is handed to React — so the screen that renders from it finds the
// index already built instead of paying for it inside a render.
const whenIdle = () =>
  new Promise((resolve) => {
    if (typeof window !== "undefined" && typeof window.requestIdleCallback === "function") {
      window.requestIdleCallback(() => resolve(), { timeout: 1200 });
    } else {
      setTimeout(resolve, 0);
    }
  });

const prepareSnapshot = async (snapshot) => {
  if (!snapshot) return snapshot;
  await whenIdle();
  getCountSearchIndex(snapshot);
  return snapshot;
};

const catalogApi = {
  getVersion: getEmployeePortalInventoryCatalogVersion,
  getSnapshot: getEmployeePortalInventoryCatalogSnapshot,
};

// A catalogue's pictures are warmed once per version per app session: every
// screen that mounts this hook would otherwise re-post thousands of URLs.
const warmedVersions = new Set();

/**
 * The phone's copy of the product catalogue, for any portal screen that searches
 * products.
 *
 * It answers in two beats. First the cached snapshot, read with no network at
 * all, so a search works the moment the screen opens — on a weak line, or none.
 * Then, quietly, a refresh: a few-byte version check and, only if the catalogue
 * actually changed, a new snapshot. Pictures are warmed afterwards when the
 * connection can afford it.
 */
export default function usePortalCatalog(token, { identity = null, enabled = true } = {}) {
  const [snapshot, setSnapshot] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; };
  }, []);

  const warmImages = useCallback((next) => {
    const version = String(next?.version || next?.savedAt || "");
    if (!version || warmedVersions.has(version) || !connectionAllowsImageWarm()) return;
    warmedVersions.add(version);
    const urls = extractCatalogImageUrls(next, resolveProductImageUrl);
    // Fire and forget: warming is for the NEXT weak moment, never for this one.
    void warmPortalCatalogImages(urls).then((counts) => {
      if (!counts) warmedVersions.delete(version); // no worker yet: try again later
    });
  }, []);

  const refresh = useCallback(async ({ force = false } = {}) => {
    if (!token) return null;
    setRefreshing(true);
    try {
      const result = await refreshPortalCatalog({ token, identity, api: catalogApi, force });
      if (result?.snapshot) await prepareSnapshot(result.snapshot);
      if (aliveRef.current && result?.snapshot) {
        // Same object as before (an unchanged catalogue): keep React's reference
        // so nothing downstream re-renders for a refresh that changed nothing.
        setSnapshot((current) => (current && current.version === result.snapshot.version && !result.refreshed ? current : result.snapshot));
        warmImages(result.snapshot);
      }
      return result;
    } finally {
      if (aliveRef.current) setRefreshing(false);
    }
  }, [identity, token, warmImages]);

  // Identity is an object the caller may rebuild each render; key on its parts.
  const identityKey = identity
    ? `${identity.tenantId ?? identity.tenant_id ?? ""}:${identity.employeeId ?? identity.employee_id ?? ""}:${identity.branchId ?? identity.branch_id ?? ""}`
    : "";

  useEffect(() => {
    if (!enabled || !token) return undefined;
    let cancelled = false;
    (async () => {
      const cached = await readPortalCatalog({ token, identity });
      if (cancelled) return;
      if (cached) {
        await prepareSnapshot(cached);
        if (cancelled) return;
        setSnapshot(cached);
      }
      if (typeof navigator !== "undefined" && navigator.onLine === false) return;
      await refresh();
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, token, identityKey]);

  // Coming back into signal, or back to the app, is the natural moment to catch
  // up. The second one matters most: an installed portal is RESUMED from the
  // phone's app switcher far more often than it is opened, so a check that only
  // runs on mount would leave a day-old catalogue on a phone that never closed it.
  useEffect(() => {
    if (!enabled || typeof window === "undefined") return undefined;
    const onOnline = () => { void refresh(); };
    const onVisible = () => {
      if (document.visibilityState === "visible" && navigator.onLine !== false) void refresh();
    };
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, refresh]);

  return { snapshot, refreshing, refresh };
}
