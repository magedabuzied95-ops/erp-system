import { useEffect, useState } from "react";

import { loadProductClassificationsShared, peekCachedProductClassifications } from "../services/productClassificationsApi";

// The list is shared across every mounted consumer and kept for a few minutes (see
// loadProductClassificationsShared), so a component that remounts per record — the AI Inbox
// product picker, keyed by conversation — no longer refetches it on every switch. refresh()
// still goes to the server.
export function useProductClassifications({ includeInactive = false } = {}) {
  const [state, setState] = useState(() => {
    const cached = peekCachedProductClassifications({ includeInactive });
    return cached ? { loading: false, error: "", groups: cached } : { loading: true, error: "", groups: [] };
  });
  const [refreshToken, setRefreshToken] = useState(0);
  const refresh = () => setRefreshToken((value) => value + 1);

  useEffect(() => {
    let cancelled = false;
    // Only an explicit refresh() bypasses the shared answer.
    const force = refreshToken > 0;

    loadProductClassificationsShared({ includeInactive }, { force })
      .then((groups) => {
        if (cancelled) return;
        setState((current) => (
          !current.loading && !current.error && current.groups === groups
            ? current
            : { loading: false, error: "", groups }
        ));
      })
      .catch((error) => {
        if (cancelled) return;
        setState({
          loading: false,
          error: error?.message || "Failed to load product classifications",
          groups: [],
        });
      });

    return () => {
      cancelled = true;
    };
  }, [includeInactive, refreshToken]);

  return { ...state, refresh };
}
