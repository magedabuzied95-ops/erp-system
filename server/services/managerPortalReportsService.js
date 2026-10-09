/**
 * Manager Portal — the Reporting Center's numbers, on a manager's phone.
 *
 * This module computes NOTHING. It resolves the manager's scope and permissions and
 * hands both to the same `getExecutiveOverview` the ERP's /reports/overview screen calls,
 * so the portal and the desktop report can never disagree. A second implementation here
 * would be a second set of numbers for one question, which is the failure the Reporting
 * Center was built to end (see docs/analytics/metric-contract.md).
 *
 * Two things it DOES decide, because they are the portal's own rules:
 *
 *   SCOPE — a branch manager sees their branch and nothing else. The branch comes from
 *   the manager row, never from the request, so a hand-edited query string cannot widen
 *   it. Only the period and the comparison mode are taken from the caller.
 *
 *   PROFIT — profit, margin, cost and inventory value stay masked until the manager
 *   unlocks them with their password, exactly as on the sales board. The mask is applied
 *   by the analytics service itself (`permissions.cost` / `permissions.profit`), so the
 *   restricted numbers are never computed into the response rather than being hidden in
 *   the UI.
 */

import { getExecutiveOverview } from "./analytics/analyticsOverviewService.js";
import { parseAnalyticsFilters } from "./analytics/analyticsFilters.js";
import { resolveManagerProfitAccess } from "./managerPortalService.js";

/** Period presets the portal offers. `today`/`yesterday` are deliberately absent. */
const RANGE_PRESETS = new Set(["last7", "last30", "thisMonth", "lastMonth", "custom"]);

const pad = (value) => String(value).padStart(2, "0");
const isoDate = (date) => `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
const addDays = (date, days) => new Date(date.getTime() + days * 86_400_000);

/**
 * The window for a preset, in the app's own calendar days.
 *
 * NOTE the portal's "today" tab counts the shop's NIGHT (a shift window that crosses
 * midnight), while every figure here counts calendar days. Offering a "today" preset
 * would put two different numbers under one word on the same screen, so the presets
 * start at seven days and the screen says which clock it is on.
 */
export const resolveReportRange = (preset, { from, to, now = new Date() } = {}) => {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const key = RANGE_PRESETS.has(preset) ? preset : "last30";

  if (key === "custom" && from && to) return { preset: "custom", from, to };
  if (key === "last7") return { preset: key, from: isoDate(addDays(today, -6)), to: isoDate(today) };
  if (key === "thisMonth") {
    return { preset: key, from: isoDate(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))), to: isoDate(today) };
  }
  if (key === "lastMonth") {
    const first = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
    const last = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 0));
    return { preset: key, from: isoDate(first), to: isoDate(last) };
  }
  return { preset: "last30", from: isoDate(addDays(today, -29)), to: isoDate(today) };
};

export const getManagerPortalReports = async ({ manager = {}, query = {}, profitToken = "" } = {}) => {
  const profitOk = await resolveManagerProfitAccess(manager, profitToken);
  const range = resolveReportRange(query.preset, { from: query.from, to: query.to });
  // A branch-scoped manager cannot widen their own scope: the value is read from the
  // manager row and the caller's branchId is dropped on the floor.
  const branchId = manager.branch_scope === "all" ? null : manager.branch_id || null;

  const filters = parseAnalyticsFilters({
    query: {
      from: range.from,
      to: range.to,
      compare: query.compare === "none" ? "none" : "previous_period",
      ...(branchId ? { branchId } : {}),
    },
    user: { tenant_id: manager.tenant_id },
  });

  const payload = await getExecutiveOverview({
    filters,
    permissions: { view: true, cost: profitOk, profit: profitOk },
  });

  return {
    ...payload,
    range,
    profit_unlocked: profitOk,
    branch: { id: branchId, name: branchId ? manager.branch_name || "" : "", scope: manager.branch_scope || "branch" },
  };
};
