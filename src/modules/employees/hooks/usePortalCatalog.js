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
      if (aliveRef.current && result?.snapshot) {
        setSnapshot(result.snapshot);
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
      if (cached) setSnapshot(cached);
      if (typeof navigator !== "undefined" && navigator.onLine === false) return;
      await refresh();
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, token, identityKey]);

  // Coming back into signal is the natural moment to catch up.
  useEffect(() => {
    if (!enabled || typeof window === "undefined") return undefined;
    const onOnline = () => { void refresh(); };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [enabled, refresh]);

  return { snapshot, refreshing, refresh };
}
