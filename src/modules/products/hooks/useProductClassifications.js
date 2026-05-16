import { useEffect, useMemo, useState } from "react";

import { api } from "../../../shared/api/api";
import { normalizeProductClassificationGroups } from "../services/productClassificationsApi";

export function useProductClassifications({ includeInactive = false } = {}) {
  const [state, setState] = useState({
    loading: true,
    error: "",
    groups: [],
  });
  const [refreshToken, setRefreshToken] = useState(0);

  const params = useMemo(() => (includeInactive ? { includeInactive: 1 } : {}), [includeInactive]);
  const refresh = () => setRefreshToken((value) => value + 1);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const response = await api.get("/product-classifications", { params });
        const normalizedGroups = normalizeProductClassificationGroups(response?.groups);
        if (cancelled) return;
        setState({
          loading: false,
          error: "",
          groups: normalizedGroups,
        });
      } catch (error) {
        if (cancelled) return;
        setState({
          loading: false,
          error: error?.message || "Failed to load product classifications",
          groups: [],
        });
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [params, refreshToken]);

  return { ...state, refresh };
}
