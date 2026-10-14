import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { claimWalletTransferForPosOrder, posTransferMethodFor, sumPosTransferParts, toPosTransfer } from "../server/modules/walletTransfers/walletTransfers.service.js";

// A customer at the counter pays by Vodafone Cash; the forwarded SMS is offered to the open
// till, and the cashier's "confirm" checks the invoice out with the transfer attached. The
// server claims the transfer inside the sale, so one transfer can never pay two invoices.

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");

test("the till sees the provider in words, the amount as a number, and who sent it", () => {
  assert.deepEqual(
    toPosTransfer({ id: "12", provider: "vodafone_cash", amount: "2250.00", counterparty_phone: "01011112222", counterparty_name: "", occurred_at: "2026-10-14T10:00:00Z" }),
    { id: 12, provider: "vodafone_cash", provider_label: "فودافون كاش", amount: 2250, counterparty_phone: "01011112222", counterparty_name: "", occurred_at: "2026-10-14T10:00:00Z" }
  );
});

test("the claim takes only a waiting incoming transfer of exactly the wallet amount, in one statement", async () => {
  const calls = [];
  const client = { query: async (sql, params) => (calls.push({ sql, params }), { rows: [] }) };
  const claimed = await claimWalletTransferForPosOrder(client, { tenantId: 1, transferId: 7, orderId: 99, parts: { vodafone_cash: 0, instapay: 2250 }, userId: 3 });
  assert.equal(claimed, null, "no row back means another till took it, or the amount differs");
  assert.equal(calls.length, 1);
  const { sql, params } = calls[0];
  assert.match(sql, /UPDATE wallet_transfers/);
  assert.match(sql, /status IN \('unmatched', 'needs_review'\)/);
  assert.match(sql, /direction = 'incoming'/);
  // Each transfer pays only the part booked under its own method.
  assert.match(sql, /ABS\(COALESCE\(amount, 0\) - CASE WHEN provider = 'vodafone_cash' THEN \$3::numeric ELSE \$6::numeric END\) < 0\.01/);
  assert.deepEqual(params, [7, 99, 0, 3, 1, 2250]);
});

test("the invoice books a transfer the way it came: Vodafone Cash as V.CASH, every InstaPay source as INSTAPAY", () => {
  assert.equal(posTransferMethodFor("vodafone_cash"), "vodafone_cash");
  for (const provider of ["instapay", "cib", "united_bank"]) assert.equal(posTransferMethodFor(provider), "instapay");
  assert.deepEqual(
    sumPosTransferParts([{ method: "cash", amount: 250 }, { method: "wallet", amount: 1000 }, { method: "instapay", amount: 500 }, { method: "vodafone_cash", amount: 300 }]),
    { vodafone_cash: 300, instapay: 1500 }
  );
  const pos = read("../src/modules/pos/pages/POSPro.jsx");
  assert.match(pos, /const method = transfer\?\.provider === "vodafone_cash" \? "vodafone_cash" : "instapay";/);
  assert.match(pos, /setPaymentMode\(method\);/, "the payment button follows the transfer, not what the cashier pressed");
});

test("checkout refuses an online sale whose transfer is gone, and settles the claim before COMMIT", () => {
  const source = read("../server/controllers/ordersController.js");
  const claimAt = source.indexOf("claimWalletTransferForPosOrder(client");
  const refusalAt = source.indexOf('code: "WALLET_TRANSFER_UNAVAILABLE"');
  const commitAt = source.indexOf('timedCheckout(checkoutTiming, "commit_ms"');
  assert.ok(claimAt > 0 && refusalAt > claimAt && commitAt > refusalAt, "claim, then refuse, then commit");
  const block = source.slice(claimAt, refusalAt);
  assert.match(block, /if \(!claimedWalletTransfer && !offline_origin\)/, "an offline replay is a finished sale and is never refused");
  assert.match(block, /await client\.query\("ROLLBACK"\)/);
  assert.match(source.slice(refusalAt - 400, refusalAt), /status\(409\)/);
});

test("wiring: ingest pushes to the tills, the till feed is mounted, the POS sends the transfer id", () => {
  const service = read("../server/modules/walletTransfers/walletTransfers.service.js");
  assert.match(service, /notifyOutcome\(result\);\s*emitPosTransferIncoming\(result\.transfer\);/);
  assert.match(read("../server/modules/walletTransfers/walletTransfers.routes.js"), /router\.get\("\/pos-incoming", protect, permit\("orders", "create"\)/);
  const pos = read("../src/modules/pos/pages/POSPro.jsx");
  assert.match(pos, /wallet_transfer_id: editingOrder\?\.id \? null : options\?\.walletTransferId \|\| null/);
  assert.match(pos, /<PosWalletTransferAlert active=\{walletTransferAlertActive\} expectedAmount=\{expectedWalletTransferAmount\}/);
  const alert = read("../src/modules/pos/components/PosWalletTransferAlert.jsx");
  assert.match(alert, /subscribeRealtime\("wallet_transfers:incoming"/);
  assert.match(alert, /subscribeRealtime\("wallet_transfers:settled"/);
  assert.match(alert, /sameAmount\(item\.amount, expectedAmount\)/, "only a transfer of the invoice's wallet amount is offered");
});

// One InstaPay payment can arrive twice — the InstaPay app notification and the bank SMS.
test("settling an InstaPay-family transfer sets its waiting twin aside; Vodafone Cash has no twin", async () => {
  const { settleTransferTwins } = await import("../server/modules/walletTransfers/walletTransfers.service.js");
  const calls = [];
  const client = { query: async (sql, params) => (calls.push({ sql, params }), { rows: [{ id: 8, status: "ignored" }] }) };
  const at = "2026-10-14T10:00:00Z";
  assert.deepEqual(await settleTransferTwins(client, { id: 5, direction: "incoming", provider: "vodafone_cash", amount: 2250, occurred_at: at }), []);
  assert.equal(calls.length, 0, "a wallet SMS is never anybody's twin");
  const twins = await settleTransferTwins(client, { id: 5, direction: "incoming", provider: "instapay", amount: "2250.00", tenant_id: 1, occurred_at: at });
  assert.deepEqual(twins, [{ id: 8, status: "ignored" }]);
  const { sql, params } = calls[0];
  assert.match(sql, /'duplicate_of:' \|\| \$1::bigint::text/, "$1 stays a bigint: a bare $1::text would retype it and break wt.id <> $1");
  assert.match(sql, /wt\.provider <> \$3/, "a second transfer from the same source is real money, not a twin");
  assert.match(sql, /wt\.status IN \('unmatched', 'needs_review'\)/);
  assert.deepEqual(params, [5, ["instapay", "cib", "united_bank"], "instapay", 2250, 1, at]);
});

test("a till claim and every automatic or manual match also settle the twin", () => {
  const service = read("../server/modules/walletTransfers/walletTransfers.service.js");
  assert.match(service, /if \(claimed\) claimed\.twins = await settleTransferTwins\(client, claimed\);/);
  assert.match(service, /if \(matched\) matched\.twins = await settleTransferTwins\(client, matched\);/);
  assert.match(service, /const setAside = await setAsideIfTwinSettled\(client, row\);/);
  assert.match(service, /\(row\.twins \|\| \[\]\)\.forEach\(emitPosTransferSettled\);/, "tills drop the twin's card too");
});
