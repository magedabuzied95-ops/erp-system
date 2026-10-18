import test from "node:test";
import assert from "node:assert/strict";
import { buildTerminalConfirmedPayment } from "../../src/modules/pos/lib/posTerminalConfirmedPayment.js";

test("a split sale keeps its cash part after the terminal approves the card part (INV-2183)", () => {
  const payment = buildTerminalConfirmedPayment({
    paymentMode: "split",
    terminalAmount: 640,
    cashAmount: 460,
  });
  assert.deepEqual(payment, {
    paymentMethod: "split",
    cash: 460,
    card: 640,
    wallet: 0,
    vodafoneCash: 0,
    customerWallet: 0,
    paidAmount: 1100,
  });
});

test("every non-card split part rides along with the terminal amount", () => {
  const payment = buildTerminalConfirmedPayment({
    paymentMode: "split",
    terminalAmount: "300",
    cashAmount: "100",
    walletAmount: 50,
    vodafoneCashAmount: 25,
    customerWalletAmount: 25,
  });
  assert.equal(payment.paymentMethod, "split");
  assert.equal(payment.paidAmount, 500);
  assert.equal(payment.card, 300);
});

test("a card-only sale stays a card sale for the terminal amount", () => {
  const payment = buildTerminalConfirmedPayment({ paymentMode: "card", terminalAmount: 1050, cashAmount: 999 });
  assert.equal(payment.paymentMethod, "card");
  assert.equal(payment.cash, 0);
  assert.equal(payment.paidAmount, 1050);
});

test("a split with nothing besides the card is sent as card", () => {
  const payment = buildTerminalConfirmedPayment({ paymentMode: "split", terminalAmount: 800 });
  assert.equal(payment.paymentMethod, "card");
  assert.equal(payment.paidAmount, 800);
});
