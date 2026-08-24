/**
 * Where a legacy `/reports` link should land, and what of it survives the journey.
 *
 * A bookmark is somebody's saved intent. Sending them to a page that renders the default
 * window silently answers a different question from the one they asked, and the numbers
 * will look plausible — which is the worst kind of wrong for a report someone is about to
 * act on. So every parameter is either translated, or explicitly reported as dropped.
 *
 * Pure. No routing, no storage, no network — so it can be tested exhaustively without a
 * browser, and so the retirement switch is a decision about WHERE to call it rather than
 * a rewrite of what it does.
 */

/** Legacy tab -> the route that answers the same question. */
export const TAB_ROUTES = Object.freeze({
  insights: "/reports/overview",
  sales: "/reports/sales",
  employees: "/reports/employees",
  inventory: "/reports/inventory",
  customers: "/reports/customers",
  financial: "/reports/reconciliation",
  export: "/reports/overview",
});

/** Legacy range names, and what they meant. */
export const RANGE_PRESETS = Object.freeze({
  today: "today",
  week: "thisWeek",
  month: "thisMonth",
  custom: "custom",
});

/**
 * Legacy parameter -> Reporting Center parameter.
 *
 * Only filters that survive are listed. `warehouseId` and `employeeId` are absent on
 * purpose: they filter on columns nothing writes, so carrying them across would move a
 * control that silently matched everything into a page where it would silently do
 * nothing — the same lie in a newer font.
 */
export const PARAM_MAP = Object.freeze({
  startDate: "from",
  endDate: "to",
  from: "from",
  to: "to",
  branchId: "branchId",
  customerId: "customerId",
  paymentMethod: "paymentMethod",
  shiftId: "shiftId",
  salespersonId: "salespersonId",
  channel: "channel",
});

/** Legacy parameters that are deliberately not carried, and why. */
export const DROPPED_PARAMS = Object.freeze({
  warehouseId: "orders.warehouse_id is populated on no orders; the legacy control matched everything",
  employeeId: "orders has no employee_id column; attribution runs through salespersonId",
  productId: "the product filter lives on the sales and inventory pages' own controls",
  categoryId: "superseded by the category filter on the pages that have one",
});

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * @param {string} search  the legacy URL's query string, with or without a leading "?"
 * @returns {{ path: string, search: string, tab: string, carried: string[], dropped: Array }}
 */
export const resolveLegacyReportsTarget = (search = "") => {
  const params = new URLSearchParams(String(search || "").replace(/^\?/, ""));

  const tab = String(params.get("tab") || params.get("activeTab") || "").toLowerCase();
  const path = TAB_ROUTES[tab] || TAB_ROUTES.sales;

  const next = new URLSearchParams();
  const carried = [];
  const dropped = [];

  for (const [key, value] of params.entries()) {
    if (key === "tab" || key === "activeTab") continue;
    if (!value) continue;

    if (DROPPED_PARAMS[key]) {
      dropped.push({ key, value, reason: DROPPED_PARAMS[key] });
      continue;
    }

    const mapped = PARAM_MAP[key];
    if (!mapped) {
      // Unknown parameters are dropped rather than forwarded. Forwarding one that the new
      // filter contract rejects would produce a 400 on a link that used to work.
      dropped.push({ key, value, reason: "not part of the Reporting Center filter contract" });
      continue;
    }

    // A date that is not a date must not become a window. The server would reject it, and
    // the reader would see an error instead of their report.
    if ((mapped === "from" || mapped === "to") && !ISO_DATE.test(value)) {
      dropped.push({ key, value, reason: "not a usable date" });
      continue;
    }

    next.set(mapped, value);
    carried.push(mapped);
  }

  // The legacy range preset, translated. An explicit from/to always wins, because that is
  // what the reader actually pinned.
  const range = String(params.get("preset") || params.get("range") || "").toLowerCase();
  if (range && !(next.has("from") && next.has("to"))) {
    if (RANGE_PRESETS[range]) {
      next.set("preset", RANGE_PRESETS[range]);
      carried.push("preset");
    } else {
      dropped.push({ key: "preset", value: range, reason: "unrecognised range; the default window is used" });
    }
  }

  const query = next.toString();
  return {
    path,
    search: query ? `?${query}` : "",
    tab: tab || "sales",
    carried,
    dropped,
    href: `${path}${query ? `?${query}` : ""}`,
  };
};
