import { useCallback, useEffect, useRef, useState } from "react";

/**
 * One analytics endpoint, fetched independently.
 *
 * Each R3 section owns its own instance, so a failing sizes query cannot blank the
 * page — the section shows an error while summary, trend and table keep working.
 *
 * Behaviour matches useOverviewQuery: keyed on a stable serialisation, superseded
 * requests are aborted so a slow earlier response can never overwrite a newer one,
 * previous data stays visible while refetching, and an error clears the payload so a
 * failure can never be mistaken for data.
 */
export default function useAnalyticsResource(fetcher, params, { enabled = true } = {}) {
  const key = JSON.stringify(params ?? null);
  const [state, setState] = useState({ status: enabled ? "loading" : "idle", data: null, meta: null, warnings: [], error: null });
  const controllerRef = useRef(null);
  const [reloadToken, setReloadToken] = useState(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const refresh = useCallback(() => setReloadToken((value) => value + 1), []);

  useEffect(() => {
    if (!enabled) {
      setState({ status: "idle", data: null, meta: null, warnings: [], error: null });
      return undefined;
    }

    const parsed = JSON.parse(key);
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    let cancelled = false;

    setState((previous) => ({ ...previous, status: previous.data ? "refreshing" : "loading", error: null }));

    fetcherRef.current(parsed, { signal: controller.signal })
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
        if (cancelled || controller.signal.aborted || error?.name === "AbortError") return;
        const status = error?.status ?? error?.response?.status ?? null;
        setState({
          status: status === 403 ? "forbidden" : "error",
          data: null, meta: null, warnings: [],
          error: { message: error?.message || "Request failed", status, code: error?.code || null },
        });
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [key, reloadToken, enabled]);

  useEffect(() => () => controllerRef.current?.abort(), []);

  return { ...state, refresh };
}
