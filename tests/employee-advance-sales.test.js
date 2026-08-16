// Deferred invoices for a customer who IS an employee become salary advances.
// These tests drive the service against a stub client, so they assert the RULE
// (when a سلفة is written, for how much, and what it refuses to do) without a
// database. The stub matches on the leading verb + table of each statement.

import test from "node:test";
import assert from "node:assert/strict";

import {
  syncOrderEmployeeAdvance,
  settleOrderAsEmployeeAdvance,
} from "../server/services/employeeAdvanceSalesService.js";

const createStubClient = ({ existingAdvance = null, linkedEmployee = null } = {}) => {
  const calls = [];
  let advanceRow = existingAdvance;

  const client = {
    calls,
    get advance() {
      return advanceRow;
    },
    async query(sql, params = []) {
      const text = String(sql).replace(/\s+/g, " ").trim();
      calls.push({ text, params });

      if (text.startsWith("SELECT * FROM employee_advances WHERE order_id")) {
        return { rows: advanceRow ? [advanceRow] : [], rowCount: advanceRow ? 1 : 0 };
      }
      if (text.includes("FROM customers c") && text.includes("JOIN employees e")) {
        return { rows: linkedEmployee ? [linkedEmployee] : [], rowCount: linkedEmployee ? 1 : 0 };
      }
      if (text.startsWith("INSERT INTO expenses")) {
        return { rows: [{ id: 9001, amount: params[2] }], rowCount: 1 };
      }
      if (text.startsWith("INSERT INTO employee_advances")) {
        advanceRow = {
          id: 7001,
          employee_id: params[1],
          amount: params[2],
          deducted_amount: 0,
          remaining_amount: params[2],
          deduction_status: "pending",
          expense_id: params[5],
          order_id: params[6],
        };
        return { rows: [advanceRow], rowCount: 1 };
      }
      if (text.startsWith("UPDATE employee_advances")) {
        advanceRow = {
          ...advanceRow,
          employee_id: params[1],
          amount: params[2],
          deduction_status: params[3],
        };
        return { rows: [advanceRow], rowCount: 1 };
      }
      if (text.startsWith("UPDATE expenses")) {
        return { rows: [{ id: params[0], amount: params[1] }], rowCount: 1 };
      }
      if (text.startsWith("UPDATE orders")) {
        return { rows: [{ paid_amount: params[1], remaining_amount: 0, payment_status: "paid" }], rowCount: 1 };
      }
      if (text.startsWith("SELECT id, tenant_id, employee_code")) {
        return { rows: linkedEmployee ? [linkedEmployee] : [], rowCount: linkedEmployee ? 1 : 0 };
      }
      return { rows: [], rowCount: 0 };
    },
  };
  return client;
};

const employee = {
  id: 42,
  tenant_id: 1,
  employee_code: "EMP-042",
  full_name: "Omar Ayoub",
  branch_id: 3,
  status: "active",
};

const order = {
  id: 260,
  customer_id: 88,
  invoice_number: "INV-260",
  branch_id: 3,
  paid_amount: 0,
  total_amount: 750,
  payment_breakdown: [],
  created_at: "2026-08-17T16:09:00.000Z",
};

test("a deferred invoice for a linked employee creates one advance for the full outstanding amount", async () => {
  const client = createStubClient({ linkedEmployee: employee });

  const result = await settleOrderAsEmployeeAdvance(client, {
    tenantId: 1,
    order,
    outstandingAmount: 750,
    actorId: 5,
  });

  assert.ok(result, "the invoice should settle into an advance");
  assert.equal(result.employee.id, 42);
  assert.equal(result.amount, 750);
  assert.equal(Number(result.advance.amount), 750);

  const inserts = client.calls.filter((call) => call.text.startsWith("INSERT INTO employee_advances"));
  assert.equal(inserts.length, 1, "exactly one سلفة per invoice");

  // The backing expense must not be a cash movement: nothing left the drawer.
  const expenseInsert = client.calls.find((call) => call.text.startsWith("INSERT INTO expenses"));
  assert.ok(expenseInsert, "the advance is backed by an expense row");
  assert.equal(expenseInsert.params[3], "employee_advance", "payment method is not a cash method");

  // The invoice itself is stamped paid and marked as settled via advances.
  const orderUpdate = client.calls.find((call) => call.text.startsWith("UPDATE orders"));
  assert.ok(orderUpdate.text.includes("settled_via_employee_advance = TRUE"));
  assert.ok(orderUpdate.text.includes("payment_status = 'paid'"));
  assert.equal(orderUpdate.params[1], 750, "the full amount reads as paid");
  assert.equal(orderUpdate.params[3], "employee_advance");
});

test("a customer who is not an employee is left alone as ordinary customer debt", async () => {
  const client = createStubClient({ linkedEmployee: null });

  const result = await settleOrderAsEmployeeAdvance(client, {
    tenantId: 1,
    order,
    outstandingAmount: 750,
  });

  assert.equal(result, null);
  assert.equal(client.calls.filter((call) => call.text.startsWith("INSERT INTO employee_advances")).length, 0);
  assert.equal(client.calls.filter((call) => call.text.startsWith("UPDATE orders")).length, 0);
});

test("a fully paid invoice records no advance", async () => {
  const client = createStubClient({ linkedEmployee: employee });

  const result = await settleOrderAsEmployeeAdvance(client, {
    tenantId: 1,
    order,
    outstandingAmount: 0,
  });

  assert.equal(result, null);
  assert.equal(client.calls.filter((call) => call.text.startsWith("INSERT INTO employee_advances")).length, 0);
});

test("re-pricing the invoice updates the same advance instead of adding a second one", async () => {
  const client = createStubClient({
    existingAdvance: {
      id: 7001,
      employee_id: 42,
      amount: 750,
      deducted_amount: 0,
      remaining_amount: 750,
      deduction_status: "pending",
      expense_id: 9001,
      order_id: 260,
    },
  });

  const result = await syncOrderEmployeeAdvance(client, {
    tenantId: 1,
    order,
    employee,
    outstandingAmount: 900,
    reason: "order-edit",
  });

  assert.equal(result.created, false);
  assert.equal(Number(result.advance.amount), 900);
  assert.equal(client.calls.filter((call) => call.text.startsWith("INSERT INTO employee_advances")).length, 0);

  const expenseUpdate = client.calls.find((call) => call.text.startsWith("UPDATE expenses"));
  assert.equal(expenseUpdate.params[1], 900, "the backing expense follows the new price");
});

test("an amount already deducted from payroll is never walked back by a price cut", async () => {
  const client = createStubClient({
    existingAdvance: {
      id: 7001,
      employee_id: 42,
      amount: 750,
      deducted_amount: 500,
      remaining_amount: 250,
      deduction_status: "partial",
      expense_id: 9001,
      order_id: 260,
    },
  });

  const result = await syncOrderEmployeeAdvance(client, {
    tenantId: 1,
    order,
    employee,
    outstandingAmount: 300,
    reason: "order-edit",
  });

  assert.equal(result.clamped, true, "the cut is clamped, not silently applied");
  assert.equal(Number(result.advance.amount), 500, "the advance never drops below what payroll already took");
});

test("an advance that payroll already settled is not reopened by an invoice edit", async () => {
  const client = createStubClient({
    existingAdvance: {
      id: 7001,
      employee_id: 42,
      amount: 750,
      deducted_amount: 750,
      remaining_amount: 0,
      deduction_status: "settled",
      expense_id: 9001,
      order_id: 260,
    },
  });

  const result = await syncOrderEmployeeAdvance(client, {
    tenantId: 1,
    order,
    employee,
    outstandingAmount: 900,
    reason: "order-edit",
  });

  assert.equal(result.frozen, true);
  assert.equal(result.changed, false);
  assert.equal(client.calls.filter((call) => call.text.startsWith("UPDATE employee_advances")).length, 0);
});

test("dropping the price to zero winds the advance down instead of leaving a phantom سلفة", async () => {
  const client = createStubClient({
    existingAdvance: {
      id: 7001,
      employee_id: 42,
      amount: 750,
      deducted_amount: 0,
      remaining_amount: 750,
      deduction_status: "pending",
      expense_id: 9001,
      order_id: 260,
    },
  });

  const result = await syncOrderEmployeeAdvance(client, {
    tenantId: 1,
    order,
    employee,
    outstandingAmount: 0,
    reason: "order-cancel",
  });

  assert.equal(Number(result.advance.amount), 0);
  assert.equal(result.advance.deduction_status, "cancelled");
});
