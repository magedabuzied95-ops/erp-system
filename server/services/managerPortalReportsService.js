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
import { getSalesProducts, getSalesSummary } from "./analytics/analyticsSalesService.js";
import { getInventorySummary } from "./analytics/analyticsInventoryService.js";
import { getPurchasingSummary, getPurchasingSuppliers } from "./analytics/analyticsPurchasingService.js";
import { getCustomersSummary } from "./analytics/analyticsCustomersService.js";
import { getEmployeesList, getEmployeesSummary } from "./analytics/analyticsEmployeesService.js";
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

/**
 * The Reporting Center's screens, and the ONE list from each that earns its place on a
 * phone beside the KPIs.
 *
 * Each entry returns the service envelope plus `rows` in one shape the screen can render
 * without knowing which report it is looking at: `{ key, code, label, value, secondary,
 * share }`. `code` is an enum the UI translates (a stock-health bucket, a customer
 * segment); `label` is already human (a product, a supplier, a seller) and is never
 * translated, because a supplier's name is their name.
 *
 * A section that needs a second query makes one — the phone asks for a single section at
 * a time, so no manager ever pays for the five they are not looking at.
 */
const PHONE_ROWS = 6;

const toRows = (rows = [], limit = PHONE_ROWS) => rows.filter(Boolean).slice(0, limit);

const SECTIONS = {
  overview: async ({ filters, permissions }) => {
    const payload = await getExecutiveOverview({ filters, permissions });
    // The overview carries its own purpose-built blocks (payment mix, categories), so it
    // needs no generic list.
    return { payload, rows: null };
  },

  sales: async ({ filters, permissions }) => {
    const payload = await getSalesSummary({ filters, permissions });
    const products = await getSalesProducts({ filters, permissions });
    const ranked = products?.data?.rankings?.topBySales || [];
    return {
      payload,
      rows: toRows(
        ranked.map((row) => ({
          key: `product-${row.productId}`,
          label: row.productName,
          value: row.netSales,
          secondary: row.units,
          share: null,
        }))
      ),
    };
  },

  /*
   * Stock value and supplier spend are COST figures, so they are null for a manager who
   * has not unlocked profit. A list of dashes is not a report, and inventing a number to
   * fill it would be worse — so when cost is masked these two rank by units instead and
   * say so by switching the value's kind. The ranking stays truthful either way.
   */
  inventory: async ({ filters, permissions }) => {
    const payload = await getInventorySummary({ filters, permissions });
    const buckets = payload?.data?.health?.buckets || {};
    const byValue = Boolean(permissions.cost);
    return {
      payload,
      valueKind: byValue ? "money" : "count",
      rows: toRows(
        Object.entries(buckets)
          .map(([code, bucket]) => ({
            key: `health-${code}`,
            code,
            value: byValue ? Number(bucket?.value || 0) : Number(bucket?.units || 0),
            secondary: byValue ? Number(bucket?.units || 0) : null,
            share: null,
          }))
          .filter((row) => row.value > 0 || Number(row.secondary || 0) > 0)
          .sort((a, b) => b.value - a.value),
        8
      ),
    };
  },

  purchasing: async ({ filters, permissions }) => {
    const payload = await getPurchasingSummary({ filters, permissions });
    const suppliers = await getPurchasingSuppliers({ filters, permissions });
    const byValue = Boolean(permissions.cost);
    return {
      payload,
      valueKind: byValue ? "money" : "count",
      rows: toRows(
        // The service ranks by spend; ranking by units has to re-sort, or the biggest
        // bar would sit in the middle of the list.
        (suppliers?.data?.rows || [])
          .map((row) => ({
            key: `supplier-${row.supplierId}`,
            label: row.supplierName,
            value: byValue ? row.spend : row.units,
            secondary: byValue ? row.units : null,
            share: byValue ? row.spendShare ?? null : null,
          }))
          .sort((a, b) => Number(b.value || 0) - Number(a.value || 0))
      ),
    };
  },

  customers: async ({ filters, permissions }) => {
    const payload = await getCustomersSummary({ filters, permissions });
    const segments = payload?.data?.segments || [];
    const total = segments.reduce((sum, row) => sum + Number(row.revenue || 0), 0);
    return {
      payload,
      rows: toRows(
        segments.map((row) => ({
          key: `segment-${row.segment}`,
          code: row.segment,
          value: Number(row.revenue || 0),
          secondary: Number(row.customers || 0),
          share: total > 0 ? Number(row.revenue || 0) / total : null,
        }))
      ),
    };
  },

  employees: async ({ filters, permissions }) => {
    const payload = await getEmployeesSummary({ filters, permissions });
    const sellers = await getEmployeesList({ filters, permissions });
    return {
      payload,
      rows: toRows(
        (sellers?.data?.rows || []).map((row) => ({
          key: `seller-${row.seller}`,
          // The service marks orders it could not attribute rather than sharing them
          // out; the row keeps that marker so the phone can say so instead of showing
          // an internal sentinel as somebody's name.
          code: row.unattributed ? "unattributed" : null,
          label: row.unattributed ? "" : row.seller,
          value: row.netSales,
          secondary: row.orders,
          share: row.salesShare ?? null,
        }))
      ),
    };
  },
};

export const REPORT_SECTIONS = Object.freeze(Object.keys(SECTIONS));

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

  const section = SECTIONS[query.section] ? query.section : "overview";
  const { payload, rows, valueKind = "money" } = await SECTIONS[section]({
    filters,
    permissions: { view: true, cost: profitOk, profit: profitOk },
  });

  return {
    ...payload,
    section,
    rows,
    value_kind: valueKind,
    range,
    profit_unlocked: profitOk,
    branch: { id: branchId, name: branchId ? manager.branch_name || "" : "", scope: manager.branch_scope || "branch" },
  };
};
