/*
 * Approving a month's salary closes it. An advance taken after that must not land on the
 * closed month (its advances are already settled against that run) — it belongs to the next
 * open month, so the next payroll picks it up. Before this rule every creation path stamped
 * the calendar month of the day the money left, whatever payroll had already been approved.
 *
 * The fake client below does not run SQL: it applies the scoping the query actually binds
 * (employee, tenant, "period >= requested") to a small ledger of runs, and throws on a shape
 * it does not recognise, so a rewrite that drops the scope fails instead of passing.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { nextMonth, normalizeMonth, resolveAdvanceDeductionMonth } from "../../server/utils/advanceDeductionMonth.js";

const fakeClient = ({ runs = [], tableExists = true, throwOnRuns = false } = {}) => {
  const calls = [];
  return {
    calls,
    query: async (sql, params = []) => {
      const text = String(sql);
      calls.push({ text, params });
      if (/to_regclass\('public\.employee_payroll_runs'\)/.test(text)) {
        return { rows: [{ regclass: tableExists ? "employee_payroll_runs" : null }] };
      }
      if (/FROM employee_payroll_runs/.test(text)) {
        if (throwOnRuns) throw new Error("relation vanished");
        assert.match(text, /employee_id::text = \$1::text/, "runs must be scoped to the employee");
        assert.match(text, /\$2::bigint IS NULL OR tenant_id = \$2::bigint/, "runs must be scoped to the tenant");
        assert.match(text, /payroll_period >= \$3/, "only runs at or after the requested month close it");
        const [employeeId, tenantId, base] = params;
        const matching = runs.filter((run) =>
          String(run.employee_id) === String(employeeId)
          && (tenantId === null || run.tenant_id === tenantId)
          && run.payroll_period >= base
          && String(run.status || "approved").toLowerCase() !== "cancelled");
        const last = matching.map((run) => run.payroll_period).sort().pop() || null;
        return { rows: [{ last_period: last }] };
      }
      throw new Error(`unexpected query: ${text}`);
    },
  };
};

test("nextMonth rolls within the year and across December", () => {
  assert.equal(nextMonth("2026-09"), "2026-10");
  assert.equal(nextMonth("2026-12"), "2027-01");
  assert.equal(nextMonth("garbage"), "");
});

test("normalizeMonth accepts YYYY-MM and trims longer dates", () => {
  assert.equal(normalizeMonth("2026-09-05"), "2026-09");
  assert.equal(normalizeMonth("", "2026-01"), "2026-01");
  assert.equal(normalizeMonth("9/2026", "2026-01"), "2026-01");
});

test("an open month keeps the requested month", async () => {
  const client = fakeClient({ runs: [] });
  assert.equal(await resolveAdvanceDeductionMonth({ clientOrPool: client, tenantId: 1, employeeId: 7, month: "2026-09" }), "2026-09");
});

test("an approved month pushes the advance to the next month", async () => {
  const client = fakeClient({ runs: [{ employee_id: 7, tenant_id: 1, payroll_period: "2026-09" }] });
  assert.equal(await resolveAdvanceDeductionMonth({ clientOrPool: client, tenantId: 1, employeeId: 7, month: "2026-09" }), "2026-10");
});

test("the month after the LATEST approved run, not merely the next calendar month", async () => {
  const client = fakeClient({ runs: [
    { employee_id: 7, tenant_id: 1, payroll_period: "2026-09" },
    { employee_id: 7, tenant_id: 1, payroll_period: "2026-10" },
  ] });
  assert.equal(await resolveAdvanceDeductionMonth({ clientOrPool: client, tenantId: 1, employeeId: 7, month: "2026-09" }), "2026-11");
});

test("December approval rolls into January of the next year", async () => {
  const client = fakeClient({ runs: [{ employee_id: 7, tenant_id: 1, payroll_period: "2026-12" }] });
  assert.equal(await resolveAdvanceDeductionMonth({ clientOrPool: client, tenantId: 1, employeeId: 7, month: "2026-12" }), "2027-01");
});

test("an older approved month does not close the requested one", async () => {
  const client = fakeClient({ runs: [{ employee_id: 7, tenant_id: 1, payroll_period: "2026-08" }] });
  assert.equal(await resolveAdvanceDeductionMonth({ clientOrPool: client, tenantId: 1, employeeId: 7, month: "2026-09" }), "2026-09");
});

test("another employee's approval, or another tenant's, changes nothing", async () => {
  const client = fakeClient({ runs: [
    { employee_id: 8, tenant_id: 1, payroll_period: "2026-09" },
    { employee_id: 7, tenant_id: 2, payroll_period: "2026-09" },
  ] });
  assert.equal(await resolveAdvanceDeductionMonth({ clientOrPool: client, tenantId: 1, employeeId: 7, month: "2026-09" }), "2026-09");
});

test("a cancelled run does not close the month", async () => {
  const client = fakeClient({ runs: [{ employee_id: 7, tenant_id: 1, payroll_period: "2026-09", status: "cancelled" }] });
  assert.equal(await resolveAdvanceDeductionMonth({ clientOrPool: client, tenantId: 1, employeeId: 7, month: "2026-09" }), "2026-09");
});

test("no runs table yet (first payroll never approved) keeps the requested month and asks nothing more", async () => {
  const client = fakeClient({ tableExists: false });
  assert.equal(await resolveAdvanceDeductionMonth({ clientOrPool: client, tenantId: 1, employeeId: 7, month: "2026-09" }), "2026-09");
  assert.equal(client.calls.length, 1);
});

test("a failing lookup degrades to the requested month instead of blocking the advance", async () => {
  const client = fakeClient({ throwOnRuns: true });
  assert.equal(await resolveAdvanceDeductionMonth({ clientOrPool: client, tenantId: 1, employeeId: 7, month: "2026-09" }), "2026-09");
});

test("without an employee or a client there is nothing to look up", async () => {
  assert.equal(await resolveAdvanceDeductionMonth({ clientOrPool: fakeClient(), tenantId: 1, employeeId: null, month: "2026-09" }), "2026-09");
  assert.equal(await resolveAdvanceDeductionMonth({ clientOrPool: null, tenantId: 1, employeeId: 7, month: "2026-09" }), "2026-09");
});
