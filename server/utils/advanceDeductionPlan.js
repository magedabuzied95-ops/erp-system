// How much of each outstanding advance one payroll takes. The approver may take
// only part of what is due this month; the rest stays on the advance and is
// carried to the next month's payroll.
//
// No requested amount means all of it (the behaviour before the split existed).
// A smaller amount is spent oldest-first, so the rows must arrive in the order
// they should be paid off. A request above what is due is capped, a negative
// one is zero.

const toNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const money = (value) => Number(toNumber(value).toFixed(2));

export const planAdvanceDeductions = (rows = [], requested) => {
  const outstanding = money(rows.reduce((sum, row) => sum + Math.max(toNumber(row.outstanding_amount), 0), 0));
  const hasRequest = requested !== undefined && requested !== null && String(requested).trim() !== "";
  const total = hasRequest ? money(Math.min(Math.max(toNumber(requested), 0), outstanding)) : outstanding;
  let budget = total;
  const planned = rows.map((row) => {
    const owed = Math.max(money(row.outstanding_amount), 0);
    const take = money(Math.min(owed, budget));
    budget = money(budget - take);
    return { ...row, payroll_deduction_amount: take, carried_amount: money(owed - take) };
  });
  return { rows: planned, total, outstanding, carried: money(outstanding - total) };
};

export default planAdvanceDeductions;
