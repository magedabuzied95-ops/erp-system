/*
 * A deleted invoice used to be the one thing that happened in the shop and left the manager
 * with nothing to read. An edit, a return and an exchange all land in the operations feed and
 * fire a push; a delete just made the row stop appearing in the sales list — no notification,
 * no trace, no way to tell "that sale was voided" from "that sale never happened".
 *
 * These tests pin both halves of the fix:
 *   1. every removal path raises a manager notification carrying the invoice, its value, who
 *      removed it and whether the stock came back — and two different invoices deleted inside
 *      the dedupe window stay two notifications, because they are keyed on the delete, not on
 *      a shared "order_deleted" bucket;
 *   2. the operations feed surfaces the deletion itself, including the permanent one whose
 *      orders row no longer exists, and counts it WITHOUT calling it a refund.
 */
import test from "node:test";
import assert from "node:assert/strict";
import db from "../../server/database/db.js";
import { clearSettingsCache } from "../../server/services/settingsService.js";
import { getManagerPortalOperations } from "../../server/services/managerPortalService.js";
import { sendManagerInvoiceDeletedPush } from "../../server/services/managerPortalPushService.js";

const DELETED_ORDER = {
  id: 501,
  invoice_number: "INV-501",
  customer_name: "منى",
  customer_phone: "01000000501",
  branch_id: 3,
  deleted_at: "2026-09-05T10:00:00.000Z",
  created_at: "2026-09-05T08:00:00.000Z",
  status: "cancelled",
  order_total: 1500,
  paid_amount: 1500,
  delete_reason: "طلب العميل الإلغاء",
  stock_restored_at: "2026-09-05T10:00:00.000Z",
  payment_method: "cash",
  order_shift_id: 9,
  branch_name: "فرع سموحة",
  actor_name: "أحمد",
};

const HARD_DELETE_LOG = {
  id: 77,
  entity_id: 502,
  created_at: "2026-09-05T11:00:00.000Z",
  actor_name: "أحمد",
  details: JSON.stringify({
    order_code: "INV-502",
    invoice_number: "INV-502",
    total_amount: 800,
    tenant_id: 1,
    branch_id: 3,
    customer_name: "سارة",
    reason: "فاتورة تجريبية",
    deleted_by_name: "المدير",
    stock_already_restored: false,
    items: [{ name: "حذاء", quantity: 1, line_total: 800, price: 800, variant_id: null }],
  }),
};

// Every query the operations feed fires is answered by shape, so a test can hand exactly one
// source its rows and leave the other three empty without stubbing a database.
const stubOperationsDb = ({ deletedRows = [], hardDeleteRows = [] } = {}) => {
  const original = db.query;
  const seen = [];
  clearSettingsCache();
  db.query = async (sql, params = []) => {
    const text = String(sql);
    seen.push({ text, params });
    if (/to_regclass/.test(text)) return { rows: [{ regclass: "public.exists" }] };
    if (/information_schema\.columns/.test(text)) return { rows: [{ exists: 1 }] };
    if (/o\.deleted_at IS NOT NULL/.test(text)) return { rows: deletedRows };
    if (/PERMANENT_DELETE_ORDER/.test(text)) return { rows: hardDeleteRows };
    if (/FROM order_items oi/.test(text)) {
      return {
        rows: [{ order_id: 501, quantity: 2, variant_id: null, product_name: "شنطة", total_amount: 1500 }],
      };
    }
    return { rows: [] };
  };
  return { seen, restore: () => { db.query = original; clearSettingsCache(); } };
};

const manager = { tenant_id: 1, branch_id: 3, branch_scope: "branch" };

test("a soft-deleted invoice reaches the operations feed as its own kind, with the goods and the stock verdict", async () => {
  const { restore } = stubOperationsDb({ deletedRows: [DELETED_ORDER] });
  try {
    const result = await getManagerPortalOperations({ manager, query: { range: "month", kind: "all" } });
    const deletion = result.operations.find((operation) => operation.id === "delete-501");
    assert.ok(deletion, "the deleted invoice must appear in the feed");
    assert.equal(deletion.kind, "delete");
    assert.equal(deletion.mechanism, "invoice_delete");
    assert.equal(deletion.permanent, false);
    assert.equal(deletion.stock_restored, true);
    assert.equal(deletion.old_total, 1500);
    assert.equal(deletion.new_total, 0);
    assert.equal(deletion.paid_amount, 1500);
    assert.equal(deletion.order_id, 501, "a soft delete still has a row the manager can open");
    assert.equal(deletion.items_out.length, 1);
    assert.equal(deletion.items_out[0].name, "شنطة");
    assert.equal(deletion.reason, "طلب العميل الإلغاء");
  } finally {
    restore();
  }
});

test("an archive says so — the invoice is hidden but every item is still off the shelf", async () => {
  const { restore } = stubOperationsDb({
    deletedRows: [{ ...DELETED_ORDER, stock_restored_at: null, status: "pending", delete_reason: "أرشفة" }],
  });
  try {
    const result = await getManagerPortalOperations({ manager, query: { range: "month", kind: "all" } });
    const deletion = result.operations.find((operation) => operation.id === "delete-501");
    assert.equal(deletion.stock_restored, false);
    assert.equal(deletion.mechanism, "invoice_archive");
  } finally {
    restore();
  }
});

test("a deleted invoice is counted as a deletion, never folded into مبالغ مرتجعة", async () => {
  const { restore } = stubOperationsDb({ deletedRows: [DELETED_ORDER] });
  try {
    const result = await getManagerPortalOperations({ manager, query: { range: "month", kind: "all" } });
    assert.equal(result.summary.deletes, 1);
    assert.equal(result.summary.deleted_amount, 1500);
    assert.equal(result.summary.refunded_amount, 0, "a delete is not a refund over the counter");
    assert.equal(result.summary.collected_amount, 0);
  } finally {
    restore();
  }
});

test("the kind filter can isolate deletions", async () => {
  const { restore } = stubOperationsDb({ deletedRows: [DELETED_ORDER] });
  try {
    const result = await getManagerPortalOperations({ manager, query: { range: "month", kind: "delete" } });
    assert.equal(result.operations.length, 1);
    assert.equal(result.operations[0].kind, "delete");
  } finally {
    restore();
  }
});

test("a permanently deleted invoice survives in the feed through the activity log, with nothing left to open", async () => {
  const { restore } = stubOperationsDb({ hardDeleteRows: [HARD_DELETE_LOG] });
  try {
    const result = await getManagerPortalOperations({ manager, query: { range: "month", kind: "all" } });
    const deletion = result.operations.find((operation) => operation.id === "hard-delete-502");
    assert.ok(deletion, "the hard delete must still be readable after the orders row is gone");
    assert.equal(deletion.permanent, true);
    assert.equal(deletion.order_id, null, "there is no invoice left to open");
    assert.equal(deletion.deleted_order_id, 502);
    assert.equal(deletion.old_total, 800);
    assert.equal(deletion.actor_name, "المدير");
    assert.equal(deletion.items_out[0].name, "حذاء");
  } finally {
    restore();
  }
});

test("a branch manager never sees another branch's permanent delete", async () => {
  const otherBranch = JSON.stringify({ ...JSON.parse(HARD_DELETE_LOG.details), branch_id: 99 });
  const { restore } = stubOperationsDb({ hardDeleteRows: [{ ...HARD_DELETE_LOG, details: otherBranch }] });
  try {
    const result = await getManagerPortalOperations({ manager, query: { range: "month", kind: "all" } });
    assert.equal(result.operations.length, 0, "activity_logs carries no branch column — the scope filter must run in JS");
  } finally {
    restore();
  }
});

// The push half. createNotification writes through the same pooled db, so capturing the INSERT
// is enough to see exactly what the manager will read.
const captureNotifications = () => {
  const original = db.query;
  const inserts = [];
  db.query = async (sql, params = []) => {
    const text = String(sql);
    if (/INSERT INTO notifications/.test(text)) {
      inserts.push({
        tenant_id: params[0],
        role_key: params[2],
        branch_id: params[3],
        type: params[4],
        category: params[5],
        priority: params[6],
        title: params[7],
        message: params[8],
        entity_type: params[11],
        entity_id: params[12],
        metadata: JSON.parse(params[13] || "{}"),
      });
      return { rows: [{ id: inserts.length, ...params }] };
    }
    return { rows: [] };
  };
  return { inserts, restore: () => { db.query = original; } };
};

const settle = async () => { for (let i = 0; i < 25; i += 1) await Promise.resolve(); };

test("deleting an invoice raises a manager notification carrying the invoice, its value, the actor and the stock verdict", async () => {
  const { inserts, restore } = captureNotifications();
  try {
    await sendManagerInvoiceDeletedPush({
      kind: "delete",
      order: { id: 501, tenant_id: 1, branch_id: 3, invoice_number: "INV-501", customer_name: "منى" },
      items: [{ name: "شنطة", quantity: 2 }],
      actorName: "أحمد",
      reason: "طلب العميل الإلغاء",
      stockRestored: true,
      amount: 1500,
    });
    await settle();

    assert.equal(inserts.length, 1, "the delete must produce exactly one manager notification");
    const notification = inserts[0];
    assert.equal(notification.role_key, "manager");
    assert.equal(notification.category, "sales", "it has to ride the manager's existing sales push toggle");
    assert.equal(notification.priority, "high");
    assert.equal(notification.type, "order_deleted");
    assert.equal(notification.entity_type, "order_operation", "so the portal opens the operations feed, not a missing invoice sheet");
    assert.equal(notification.entity_id, "delete-501");
    assert.match(notification.title, /حذف فاتورة/);
    assert.match(notification.title, /INV-501/);
    assert.match(notification.message, /منى/);
    assert.match(notification.message, /1,500/);
    assert.match(notification.message, /شنطة/);
    assert.match(notification.message, /أحمد/);
    assert.match(notification.message, /المخزون رجع/);
    assert.match(notification.message, /طلب العميل الإلغاء/);
    assert.equal(notification.metadata.stock_restored, true);
    assert.equal(notification.metadata.amount, 1500);
    assert.equal(notification.metadata.open_operations, true);
  } finally {
    restore();
  }
});

test("an archive tells the manager the stock did NOT come back", async () => {
  const { inserts, restore } = captureNotifications();
  try {
    await sendManagerInvoiceDeletedPush({
      kind: "archive",
      order: { id: 501, tenant_id: 1, branch_id: 3, invoice_number: "INV-501", customer_name: "منى" },
      stockRestored: false,
      amount: 1500,
    });
    await settle();
    assert.equal(inserts[0].type, "order_archived");
    assert.equal(inserts[0].entity_id, "archive-501");
    assert.match(inserts[0].message, /المخزون لم يرجع/);
  } finally {
    restore();
  }
});

test("a permanent delete never points the manager at an invoice sheet that no longer exists", async () => {
  const { inserts, restore } = captureNotifications();
  try {
    await sendManagerInvoiceDeletedPush({
      kind: "permanent",
      order: { id: 502, tenant_id: 1, branch_id: 3, invoice_number: "INV-502", customer_name: "سارة" },
      actorName: "المدير",
      amount: 800,
    });
    await settle();
    assert.equal(inserts[0].type, "order_hard_deleted");
    assert.equal(inserts[0].entity_id, "hard-delete-502");
    assert.match(inserts[0].title, /حذف نهائي/);
    assert.equal(inserts[0].metadata.invoice_id, null, "there is no row left to open");
    assert.equal(inserts[0].metadata.order_id, 502);
  } finally {
    restore();
  }
});

test("two invoices deleted in the same minute stay two notifications", async () => {
  const { inserts, restore } = captureNotifications();
  try {
    await sendManagerInvoiceDeletedPush({ kind: "delete", order: { id: 501, tenant_id: 1, branch_id: 3, invoice_number: "INV-501" }, amount: 100 });
    await sendManagerInvoiceDeletedPush({ kind: "delete", order: { id: 502, tenant_id: 1, branch_id: 3, invoice_number: "INV-502" }, amount: 200 });
    await settle();
    assert.equal(inserts.length, 2);
    assert.notEqual(inserts[0].entity_id, inserts[1].entity_id, "the dedupe key is the delete, not the type");
  } finally {
    restore();
  }
});

test("a delete with no order id is dropped rather than notified as invoice #undefined", async () => {
  const { inserts, restore } = captureNotifications();
  try {
    const result = await sendManagerInvoiceDeletedPush({ kind: "delete", order: {}, amount: 100 });
    await settle();
    assert.equal(result.skipped, true);
    assert.equal(inserts.length, 0);
  } finally {
    restore();
  }
});

/*
 * Three separate handlers remove an invoice — cancel-and-restore, archive, and the hard delete —
 * and a manager who is told about two of them is worse off than one who is told about none: the
 * silence becomes the signal. So the wiring itself is pinned. A source sweep, because the handlers
 * open a pooled transaction and reach a dozen ledgers before they ever get to the push.
 */
import { readFileSync } from "node:fs";

test("every path that removes an invoice notifies the manager", () => {
  const source = readFileSync(new URL("../../server/controllers/ordersController.js", import.meta.url), "utf8");
  const handlerBody = (name) => {
    const start = source.indexOf(`export const ${name} = async (req, res) => {`);
    assert.notEqual(start, -1, `${name} must exist`);
    const next = source.indexOf("\nexport const ", start + 1);
    return source.slice(start, next === -1 ? source.length : next);
  };
  for (const [handler, kind] of [["deleteOrder", "delete"], ["archiveOrder", "archive"], ["permanentDeleteOrder", "permanent"]]) {
    const body = handlerBody(handler);
    assert.match(body, /sendManagerInvoiceDeletedPush\(/, `${handler} must raise the manager notification`);
    const call = body.slice(body.indexOf("sendManagerInvoiceDeletedPush("));
    assert.ok(call.includes(`kind: "${kind}"`), `${handler} must send it as kind "${kind}"`);
  }
});

test("a permanent delete copies its scope into the activity log, or the feed can never place it", () => {
  const source = readFileSync(new URL("../../server/controllers/ordersController.js", import.meta.url), "utf8");
  const start = source.indexOf("export const permanentDeleteOrder = async (req, res) => {");
  const body = source.slice(start, source.indexOf("\nexport const ", start + 1));
  const details = body.slice(body.indexOf('"PERMANENT_DELETE_ORDER"'));
  for (const field of ["tenant_id:", "branch_id:", "customer_name:", "items:"]) {
    assert.ok(details.includes(field), `the activity log is the only record left — it must carry ${field}`);
  }
});

test("the notification's tap target is the feed row it opens, for every removal path", async () => {
  const { restore: restoreFeed } = stubOperationsDb({
    deletedRows: [{ ...DELETED_ORDER, stock_restored_at: null }],
    hardDeleteRows: [HARD_DELETE_LOG],
  });
  let feed;
  try {
    feed = await getManagerPortalOperations({ manager, query: { range: "month", kind: "all" } });
  } finally {
    restoreFeed();
  }
  const feedIds = feed.operations.map((operation) => operation.id);

  // An archive is keyed "archive-501" for dedupe but the feed calls the same removal
  // "delete-501" — send the manager the dedupe key and the tap opens an empty tab.
  const { inserts, restore } = captureNotifications();
  try {
    await sendManagerInvoiceDeletedPush({ kind: "archive", order: { id: 501, tenant_id: 1, branch_id: 3, invoice_number: "INV-501" }, amount: 1500 });
    await sendManagerInvoiceDeletedPush({ kind: "permanent", order: { id: 502, tenant_id: 1, branch_id: 3, invoice_number: "INV-502" }, amount: 800 });
    await settle();
    for (const notification of inserts) {
      assert.ok(
        feedIds.includes(notification.metadata.operation_id),
        `${notification.entity_id} points at "${notification.metadata.operation_id}", which is not a row in the feed (${feedIds.join(", ")})`
      );
    }
  } finally {
    restore();
  }
});
