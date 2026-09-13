import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { isTrustedVodafoneSender, parseVodafoneCashSms } from "../server/modules/walletTransfers/vodafoneCashSms.js";
import { decideTransferMatch, namesMatch } from "../server/modules/walletTransfers/transferMatchDecision.js";
import { isTrustedTransferSender, parseTransferSms } from "../server/modules/walletTransfers/transferSms.js";

// The owner's iPhone forwards each Vodafone Cash SMS; the server reads it and approves the
// website order it proves. Message shapes are the real ones, with made-up people.

const INCOMING = `تم استلام مبلغ 1700 جنيه من رقم 01011112222 المسجل بإسم Sara M Test على رقم محفظتك  01033334444.
رصيدك الحالي: 67839.59 جنيه
تاريخ العملية: 15:57 26-09-13
رقم العملية: 023667172814
تابع كل مصروفاتك من تاريخ المعاملات على أبلكيشن أنا فودافون http://vf.eg/vfcash`;

const OUTGOING = `تم تحويل 3000 جنيه لرقم 01055556666 مصاريف الخدمة 1 جنيه رصيد حسابك فى فودافون كاش الحالي 66139.59.
تاريخ العملية 03:24 26-09-13 :
رقم العملية 023655832529 :
 حول فلوسك أسرع وأسهل من خلال تطبيق أنا فودافون، وتحكم في معاملاتك من خلال http://vf.eg/vfcash`;

test("an incoming Vodafone Cash SMS yields amount, sender, wallet, time and reference", () => {
  assert.deepEqual(parseVodafoneCashSms(INCOMING), {
    kind: "incoming",
    amount: 1700,
    fee: null,
    counterpartyPhone: "01011112222",
    counterpartyName: "Sara M Test",
    walletNumber: "01033334444",
    balanceAfter: 67839.59,
    occurredLocal: "2026-09-13 15:57:00",
    reference: "023667172814",
    complete: true,
  });
});

test("an outgoing transfer is recognised and never mistaken for money received", () => {
  const parsed = parseVodafoneCashSms(OUTGOING);
  assert.equal(parsed.kind, "outgoing");
  assert.equal(parsed.amount, 3000);
  assert.equal(parsed.fee, 1);
  assert.equal(parsed.balanceAfter, 66139.59);
  assert.equal(parsed.occurredLocal, "2026-09-13 03:24:00");
  assert.equal(parsed.reference, "023655832529");
});

test("Arabic-Indic digits, decimals, thousands separators and a name-less sender still parse", () => {
  const parsed = parseVodafoneCashSms("تم استلام مبلغ ١,٢٥٠.٥٠ جنيه من رقم ٠١٠١١١١٢٢٢٢ على رقم محفظتك ٠١٠٣٣٣٣٤٤٤٤. تاريخ العملية: 09:05 26-01-02 رقم العملية: ٠٠٠١٢٣٤٥٦٧");
  assert.equal(parsed.kind, "incoming");
  assert.equal(parsed.amount, 1250.5);
  assert.equal(parsed.counterpartyPhone, "01011112222");
  assert.equal(parsed.counterpartyName, "");
  assert.equal(parsed.occurredLocal, "2026-01-02 09:05:00");
  assert.equal(parsed.reference, "0001234567");
});

test("an unrelated or reference-less message is kept as unparsed, not as a transfer", () => {
  assert.equal(parseVodafoneCashSms("كود التحقق الخاص بك 1234").kind, "unknown");
  assert.equal(parseVodafoneCashSms("تم استلام مبلغ 500 جنيه من رقم 01011112222 على رقم محفظتك 01033334444").complete, false);
});

test("only a sender naming Vodafone may confirm on its own", () => {
  assert.equal(isTrustedVodafoneSender("VF-Cash"), true);
  assert.equal(isTrustedVodafoneSender("Vodafone"), true);
  assert.equal(isTrustedVodafoneSender("+201011112222"), false);
  assert.equal(isTrustedVodafoneSender(""), false);
});

const transfer = { counterparty_phone: "01011112222", reference: "023667172814", amount: 1700 };
const order = (id, phone, extra = {}) => ({ id, customer_phone: phone, shipping_payment_reference: "", ...extra });

test("one waiting order with the amount placed by the sending phone is approved automatically", () => {
  const decision = decideTransferMatch({ transfer, candidates: [order(7, "+20 101 111 2222"), order(8, "01099990000")], trustedSender: true });
  assert.equal(decision.action, "confirm");
  assert.equal(decision.order.id, 7);
  assert.equal(decision.matchMethod, "auto_phone");
  assert.deepEqual(decision.candidateIds, [7, 8]);
});

test("an order quoting the transaction number is approved even from another phone", () => {
  const decision = decideTransferMatch({ transfer, candidates: [order(9, "01099990000", { shipping_payment_reference: "رقم العملية 023667172814" })], trustedSender: true });
  assert.equal(decision.action, "confirm");
  assert.equal(decision.matchMethod, "auto_reference");
});

test("the amount alone never approves an order — it waits for a person", () => {
  const decision = decideTransferMatch({ transfer, candidates: [order(10, "01099990000")], trustedSender: true });
  assert.equal(decision.action, "review");
  assert.equal(decision.reviewReason, "amount_only");
});

test("an untrusted sender, a foreign wallet or two matching orders all go to review", () => {
  const candidates = [order(7, "01011112222")];
  assert.equal(decideTransferMatch({ transfer, candidates, trustedSender: false }).reviewReason, "untrusted_sender");
  assert.equal(decideTransferMatch({ transfer, candidates, trustedSender: true, walletKnown: false }).reviewReason, "unknown_wallet");
  assert.equal(decideTransferMatch({ transfer, candidates: [order(7, "01011112222"), order(8, "01011112222")], trustedSender: true }).reviewReason, "several_orders");
  assert.equal(decideTransferMatch({ transfer, candidates: [], trustedSender: true }).action, "unmatched");
});

const UNITED = "عملية ايداع مبلغ 1150.00 EGP حساب رقم 001 يوم   2026-09-13 15:14:53 الرصيد  45000.87 دائن للاستعلام 19200";
const CIB = "يرجى العلم انه تم تنفيذ تحويل لحظي بمبلغ 2700.00 جم إلى حسابك المنتهي بـ ********1234 من احمدسمير علىحسن برقم مرجعي E46bbe82 بتاريخ 11-09-2026 21:59 للمزيد، برجاء الاتصال بـ 19666";

test("a United Bank deposit parses, with a reference built from time, amount and balance", () => {
  const parsed = parseTransferSms(UNITED);
  assert.equal(parsed.provider, "united_bank");
  assert.equal(parsed.kind, "incoming");
  assert.equal(parsed.amount, 1150);
  assert.equal(parsed.balanceAfter, 45000.87);
  assert.equal(parsed.occurredLocal, "2026-09-13 15:14:53");
  assert.equal(parsed.reference, "20260913151453-1150-45000.87");
  assert.equal(parsed.counterpartyName, "");
});

test("a CIB instant transfer parses amount, sender name, reference and a DD-MM-YYYY date", () => {
  const parsed = parseTransferSms(CIB);
  assert.equal(parsed.provider, "cib");
  assert.equal(parsed.amount, 2700);
  assert.equal(parsed.counterpartyName, "احمدسمير علىحسن");
  assert.equal(parsed.walletNumber, "1234");
  assert.equal(parsed.reference, "e46bbe82");
  assert.equal(parsed.occurredLocal, "2026-09-11 21:59:00");
});

test("the dispatcher still reads Vodafone Cash, and each source trusts only its own sender", () => {
  assert.equal(parseTransferSms(INCOMING).provider, "vodafone_cash");
  assert.equal(parseTransferSms("كود التحقق 1234").provider, "unknown");
  assert.equal(isTrustedTransferSender("cib", "CIB"), true);
  assert.equal(isTrustedTransferSender("united_bank", "United Bank"), true);
  assert.equal(isTrustedTransferSender("cib", "VF-Cash"), false);
  assert.equal(isTrustedTransferSender("vodafone_cash", "United Bank"), false);
});

test("a bank's space-less name matches the name typed at checkout, but a bare first name does not", () => {
  assert.equal(namesMatch("أحمد سمير علي حسن", "احمدسمير علىحسن"), true);
  assert.equal(namesMatch("احمد سمير", "احمدسمير علىحسن"), true);
  assert.equal(namesMatch("احمد", "احمدسمير علىحسن"), false);
  assert.equal(namesMatch("Sara Test", "احمدسمير علىحسن"), false);
  const cibTransfer = { counterparty_name: "احمدسمير علىحسن", reference: "e46bbe82", amount: 2700 };
  const decision = decideTransferMatch({ transfer: cibTransfer, candidates: [order(11, "01099990000", { customer_name: "أحمد سمير علي حسن" }), order(12, "01088880000", { customer_name: "Other" })], trustedSender: true });
  assert.equal(decision.action, "confirm");
  assert.equal(decision.order.id, 11);
  assert.equal(decision.matchMethod, "auto_name");
  assert.equal(decideTransferMatch({ transfer: { ...cibTransfer }, candidates: [order(13, "010", { shipping_payment_reference: "E46BBE82" })], trustedSender: true }).matchMethod, "auto_reference");
});

test("a United Bank deposit has nothing to prove who sent it, so it only ever goes to review", () => {
  const deposit = { reference: "20260913151453-1150-45000.87", amount: 1150 };
  assert.equal(decideTransferMatch({ transfer: deposit, candidates: [order(14, "01011112222")], trustedSender: true }).reviewReason, "amount_only");
});

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");

test("wiring: boot creates the table, routes are mounted, checkout re-matches, staff approval shares the core", () => {
  const server = read("../server/server.js");
  const boot = server.slice(server.indexOf("const bootstrapStartup"));
  assert.match(boot, /await ensureWalletTransfersSchema\(db\)/);
  assert.match(server, /app\.use\("\/api\/wallet-transfers", walletTransfersRoutes\)/);
  assert.match(read("../server/controllers/storefrontController.js"), /paymentMethod === "vodafone_cash"\) void rematchWalletTransfersForOrder\(/);
  const orders = read("../server/controllers/ordersController.js");
  const confirm = orders.slice(orders.indexOf("export const confirmShippingPayment"), orders.indexOf("export const rejectShippingPayment"));
  assert.match(confirm, /applyTransferPaymentConfirmation\(client,/);
  assert.doesNotMatch(confirm, /UPDATE orders/);
  const routes = read("../server/modules/walletTransfers/walletTransfers.routes.js");
  assert.match(routes, /router\.post\("\/sms", async/);
  assert.match(routes, /walletSmsSecretMatches\(/);
  assert.match(read("../shared/settingsRegistry.js"), /"payments\.wallet_sms_webhook_secret", "payments", "secret"/);
});
