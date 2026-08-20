import assert from "node:assert/strict";
import test from "node:test";

import { createJournalEntry, postReturnEntry, postSaleEntry } from "../server/services/accountingService.js";

// A fake client that records what the journal entry would contain. resolveAccount()
// seeds/reads the chart of accounts, so the stub answers those reads with the real
// codes and hands back ids that echo the code -- that is all the assertions need.
const ACCOUNT_IDS = {
  1000: 20, 1010: 32, 1011: 42, 1020: 33, 1100: 28,
  1200: 19, 4000: 21, 4010: 25, 4020: 26, 5000: 22,
};

const makeClient = () => {
  const captured = { lines: [] };
  const client = {
    query: async (sql, params = []) => {
      const text = String(sql);
      if (/FROM\s+accounts/i.test(text) && /SELECT/i.test(text)) {
        return { rows: Object.entries(ACCOUNT_IDS).map(([code, id]) => ({ id, code, name: code, type: "asset" })), rowCount: 25 };
      }
      if (/INSERT INTO journal_entries/i.test(text)) {
        captured.entry = params;
        return { rows: [{ id: 1 }], rowCount: 1 };
      }
      if (/INSERT INTO journal_entry_lines/i.test(text)) {
        captured.lines.push(params);
        return { rows: [{ id: captured.lines.length }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
  };
  return { client, captured };
};

const idToCode = (id) => Object.entries(ACCOUNT_IDS).find(([, v]) => v === id)?.[0] || String(id);

// journal_entry_lines inserts as (tenant_id, journal_entry_id, account_id, debit, credit, ...)
const summarize = (captured) => {
  const out = {};
  for (const [, , accountId, debit, credit] of captured.lines) {
    const code = idToCode(accountId);
    out[code] = out[code] || { debit: 0, credit: 0 };
    out[code].debit += Number(debit || 0);
    out[code].credit += Number(credit || 0);
  }
  return out;
};

const totals = (summary) => Object.values(summary).reduce(
  (acc, v) => ({ debit: acc.debit + v.debit, credit: acc.credit + v.credit }),
  { debit: 0, credit: 0 }
);

test("a cash sale debits Cash, not a card or wallet account", async () => {
  const { client, captured } = makeClient();
  await postSaleEntry(client, {
    tenantId: 1, referenceId: 1, saleAmount: 1000, cogsAmount: 600,
    paidAmount: 1000, paymentMethod: "cash",
    payments: [{ method: "cash", amount: 1000 }],
  });
  const s = summarize(captured);
  assert.equal(s["1000"].debit, 1000);
  assert.equal(s["4000"].credit, 1000);
  assert.equal(s["5000"].debit, 600);
  assert.equal(s["1200"].credit, 600);
  assert.deepEqual(totals(s), { debit: 1600, credit: 1600 });
});

test("a card sale debits the bank account and never touches Cash", async () => {
  const { client, captured } = makeClient();
  await postSaleEntry(client, {
    tenantId: 1, referenceId: 2, saleAmount: 1550, cogsAmount: 1050,
    paidAmount: 1550, paymentMethod: "card",
    payments: [{ method: "card", amount: 1550 }],
  });
  const s = summarize(captured);
  assert.equal(s["1010"].debit, 1550, "card money belongs in the bank account");
  assert.equal(s["1000"], undefined, "a card sale must not increase Cash");
  assert.deepEqual(totals(s), { debit: 2600, credit: 2600 });
});

test("a deferred sale books Accounts Receivable, not cash that never arrived", async () => {
  const { client, captured } = makeClient();
  await postSaleEntry(client, {
    tenantId: 1, referenceId: 3, saleAmount: 650, cogsAmount: 0,
    paidAmount: 0, paymentMethod: "credit_sale",
    payments: [{ method: "credit_sale", amount: 650 }],
  });
  const s = summarize(captured);
  assert.equal(s["1100"].debit, 650, "the customer owes the shop 650");
  assert.equal(s["1000"], undefined, "no money was collected, so Cash cannot move");
  assert.equal(s["4000"].credit, 650, "the revenue is still earned");
  assert.deepEqual(totals(s), { debit: 650, credit: 650 });
});

test("a deposit splits between the collected account and receivables", async () => {
  const { client, captured } = makeClient();
  await postSaleEntry(client, {
    tenantId: 1, referenceId: 4, saleAmount: 3500, cogsAmount: 0,
    paidAmount: 2000, paymentMethod: "cash",
    payments: [{ method: "cash", amount: 2000 }, { method: "credit_sale", amount: 1500 }],
  });
  const s = summarize(captured);
  assert.equal(s["1000"].debit, 2000, "only the deposit is real money");
  assert.equal(s["1100"].debit, 1500, "the balance is receivable");
  assert.equal(s["4000"].credit, 3500);
  assert.deepEqual(totals(s), { debit: 3500, credit: 3500 });
});

test("a split deposit lands in each account that actually took money", async () => {
  const { client, captured } = makeClient();
  await postSaleEntry(client, {
    tenantId: 1, referenceId: 5, saleAmount: 1000, cogsAmount: 0,
    paidAmount: 1000,
    payments: [
      { method: "cash", amount: 400 },
      { method: "instapay", amount: 350 },
      { method: "vodafone_cash", amount: 250 },
    ],
  });
  const s = summarize(captured);
  assert.equal(s["1000"].debit, 400);
  assert.equal(s["1011"].debit, 350);
  assert.equal(s["1020"].debit, 250);
  assert.deepEqual(totals(s), { debit: 1000, credit: 1000 });
});

test("an unmapped payment method still balances instead of posting one-sided", async () => {
  const { client, captured } = makeClient();
  await postSaleEntry(client, {
    tenantId: 1, referenceId: 6, saleAmount: 500, cogsAmount: 0,
    paidAmount: 500, paymentMethod: "some_new_provider",
  });
  const s = summarize(captured);
  assert.deepEqual(totals(s), { debit: 500, credit: 500 });
});

test("a restocked return walks the cost back out of COGS into Inventory", async () => {
  const { client, captured } = makeClient();
  await postReturnEntry(client, {
    tenantId: 1, referenceId: 7, amount: 1550, direction: "out",
    refundMethod: "cash", cogsAmount: 1050, restock: true,
  });
  const s = summarize(captured);
  assert.equal(s["4020"].debit, 1550);
  assert.equal(s["1000"].credit, 1550, "the cash left the drawer");
  assert.equal(s["1200"].debit, 1050, "the goods are back on the shelf");
  assert.equal(s["5000"].credit, 1050, "so their cost is no longer an expense");
  assert.deepEqual(totals(s), { debit: 2600, credit: 2600 });
});

test("a scrapped return refunds without restoring inventory", async () => {
  const { client, captured } = makeClient();
  await postReturnEntry(client, {
    tenantId: 1, referenceId: 8, amount: 300, direction: "out",
    refundMethod: "cash", cogsAmount: 200, restock: false,
  });
  const s = summarize(captured);
  assert.equal(s["4020"].debit, 300);
  assert.equal(s["1000"].credit, 300);
  assert.equal(s["1200"], undefined, "scrapped goods do not come back into inventory");
  assert.deepEqual(totals(s), { debit: 300, credit: 300 });
});

test("a refund follows the method it was actually paid out with", async () => {
  const { client, captured } = makeClient();
  await postReturnEntry(client, {
    tenantId: 1, referenceId: 9, amount: 800, direction: "out",
    refundMethod: "instapay", cogsAmount: 0,
  });
  const s = summarize(captured);
  assert.equal(s["1011"].credit, 800, "an InstaPay refund leaves the InstaPay account");
  assert.equal(s["1000"], undefined);
});

// The POS invoice edit builds its settlement entry itself (breakdown debits + one
// revenue credit) rather than going through postSaleEntry, so the amount it credits
// has to be the amount the breakdown actually debits. A deposit-plus-credit edit is
// the case where those two diverge: 1 collected against 1400 due.
const editSettlementLines = ({ breakdown = [], revenueAmount = 0 }) => [
  ...breakdown.map((payment) => ({
    account_id: payment.method === "cash" ? ACCOUNT_IDS[1000] : ACCOUNT_IDS[1100],
    debit: payment.amount,
    credit: 0,
  })),
  { account_id: ACCOUNT_IDS[4000], debit: 0, credit: revenueAmount },
];

test("an invoice edit that collects a deposit and defers the rest still balances", async () => {
  const { client, captured } = makeClient();
  const breakdown = [{ method: "cash", amount: 1 }];
  await createJournalEntry(client, {
    tenantId: 1,
    description: "POS invoice edit extra payment",
    referenceType: "order_edit",
    referenceId: 517,
    lines: editSettlementLines({ breakdown, revenueAmount: 1 }),
  });
  const s = summarize(captured);
  assert.equal(s["1000"].debit, 1, "only the deposit reached the drawer");
  assert.equal(s["4000"].credit, 1);
  assert.deepEqual(totals(s), { debit: 1, credit: 1 });
});

test("crediting the whole amount due on a deferred edit is rejected as unbalanced", async () => {
  const { client } = makeClient();
  await assert.rejects(
    createJournalEntry(client, {
      tenantId: 1,
      description: "POS invoice edit extra payment",
      referenceType: "order_edit",
      referenceId: 517,
      // What the route used to pass: amountDueNow, not the collected total.
      lines: editSettlementLines({ breakdown: [{ method: "cash", amount: 1 }], revenueAmount: 1400 }),
    }),
    /not balanced/
  );
});
