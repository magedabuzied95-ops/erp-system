import { createContext, useEffect, useMemo, useRef, useState } from "react";

import { api } from "../../../shared/api/api";

/** Badge levels of the orders on screen: { [orderId]: { level, count, confirmed } }. */
export const OrderIdentityLevelsContext = createContext({});

const isOnlineOrder = (order = {}) => {
  const channel = String(order.channel || order.source || "").toLowerCase();
  return channel && channel !== "pos" && channel !== "amazon";
};

/** Loads badge levels for the given orders, remembering what it already asked for. */
export function useOrderIdentityLevels(orders = []) {
  const [levels, setLevels] = useState({});
  const askedRef = useRef(new Set());
  const ids = useMemo(
    () => orders.filter(isOnlineOrder).map((order) => Number(order.id)).filter((id) => id > 0),
    [orders]
  );
  const idsKey = ids.join(",");

  useEffect(() => {
    const missing = ids.filter((id) => !askedRef.current.has(id)).slice(0, 500);
    if (!missing.length) return undefined;
    let active = true;
    const timer = window.setTimeout(() => {
      missing.forEach((id) => askedRef.current.add(id));
      api
        .get(`/orders/identity-alerts?ids=${missing.join(",")}`, { suppressErrorStatuses: [403, 404, 500] })
        .then((data) => {
          if (!active || !data?.levels) return;
          setLevels((prev) => ({ ...prev, ...data.levels }));
        })
        .catch(() => {
          missing.forEach((id) => askedRef.current.delete(id));
        });
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
    // idsKey carries the ids; the array itself changes identity every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  return levels;
}
