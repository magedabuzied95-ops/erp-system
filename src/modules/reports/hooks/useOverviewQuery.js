import { useCallback, useEffect, useRef, useState } from "react";

import { fetchExecutiveOverview } from "../services/analyticsV2Api";

/**
 * Fetch the executive overview, keyed on a stable serialisation of the filters.
 *
 * Two things this deliberately does:
 *  - aborts the in-flight request when the period changes, so a slow earlier request
 *    can never overwrite a newer result;
 *  - keeps the previous payload visible while refetching, so changing the period does
 *    not blank the page (the skeleton only shows on first load).
 */
export default function useOverviewQuery(requestParams) {
  const key = JSON.stringify(requestParams);
  const [state, setState] = useState({ status: "loading", data: null, meta: null, warnings: [], error: null });
  const controllerRef = useRef(null);
  const [reloadToken, setReloadToken] = useState(0);

  const refresh = useCallback(() => setReloadToken((value) => value + 1), []);

  useEffect(() => {
    const params = JSON.parse(key);
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    let cancelled = false;

    setState((previous) => ({
      ...previous,
      status: previous.data ? "refreshing" : "loading",
      error: null,
    }));

    fetchExecutiveOverview(params, { signal: controller.signal })
      .then((response) => {
        if (cancelled || controller.signal.aborted) return;
        setState({
          status: "success",
          data: response?.data ?? null,
          meta: response?.meta ?? null,
          warnings: Array.isArray(response?.warnings) ? response.warnings : [],
          error: null,
        });
      })
      .catch((error) => {
        if (cancelled || controller.signal.aborted) return;
        if (error?.name === "AbortError") return;
        const status = error?.status ?? error?.response?.status ?? null;
        setState({
          status: status === 403 ? "forbidden" : "error",
          // Never fall back to stale numbers on failure: an error must not look like data.
          data: null,
          meta: null,
          warnings: [],
          error: { message: error?.message || "Request failed", status, code: error?.code || null },
        });
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [key, reloadToken]);

  useEffect(() => () => controllerRef.current?.abort(), []);

  return { ...state, refresh };
}
