import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { normalizeReceipt, receiptDiskPath, receiptVisionProvider } from "../server/modules/walletTransfers/paymentReceiptVision.js";
import { decideTransferMatch } from "../server/modules/walletTransfers/transferMatchDecision.js";
import { parseTransferSms } from "../server/modules/walletTransfers/transferSms.js";

// The customer's receipt and the owner's InstaPay notification name the same address. Reading it
// off the picture is the only thing that joins them, so what the model may return is fenced in here.

test("a receipt reading keeps a real address and the amount, and drops what was only guessed", () => {
  const read = normalizeReceipt({
    sender_address: " ZeinabAbdelnasser@instapay ",
    sender_name: "زينب عبد الناصر محمود",
    amount: "1.00 EGP",
    reference: "492877894718",
    recipient: "01024960585",
  });
  assert.equal(read.senderAddress, "zeinababdelnasser@instapay");
  assert.equal(read.amount, 1);
  assert.equal(read.reference, "492877894718");
  assert.equal(read.senderName, "زينب عبد الناصر محمود");
});

test("anything that is not an address is no address at all", () => {
  for (const value of ["", "not visible", "غير واضح", "zeinab abdelnasser", "01024960585", "a@b@c"]) {
    assert.equal(normalizeReceipt({ sender_address: value }).senderAddress, "", value);
  }
  // A long address wrapped onto two lines in a narrow screenshot is one address, not prose.
  assert.equal(normalizeReceipt({ sender_address: "zeinababdelnasser@\ninstapay" }).senderAddress, "zeinababdelnasser@instapay");
  assert.equal(normalizeReceipt({ amount: "0" }).amount, null);
  assert.equal(normalizeReceipt({}).senderAddress, "");
});

test("only a file that stays inside uploads/ is ever opened and sent to a model", () => {
  const root = process.platform === "win32" ? "C:\\app" : "/app";
  assert.notEqual(receiptDiskPath("/uploads/payment-proofs/1.jpg", root), "");
  assert.equal(receiptDiskPath("/uploads/../../etc/passwd", root), "");
  assert.equal(receiptDiskPath("/etc/passwd", root), "");
  assert.equal(receiptDiskPath("", root), "");
});

test("no model configured, or the flag switched off, means the feature is simply absent", () => {
  assert.equal(receiptVisionProvider({ PAYMENT_RECEIPT_VISION: "off", AI_VISION_MODEL: "qwen-vl", AI_TEXT_BASE_URL: "https://api.groq.com/openai" }), null);
  assert.equal(receiptVisionProvider({}), null);
  assert.equal(receiptVisionProvider({ OPENAI_API_KEY: "sk-test" }), null, "a key with no vision model is not a reader");
  assert.equal(receiptVisionProvider({ OPENAI_API_KEY: "sk-test", OPENAI_VISION_MODEL: "gpt-4o-mini" }).model, "gpt-4o-mini");
  assert.equal(receiptVisionProvider({ AI_VISION_MODEL: "qwen-vl", AI_TEXT_BASE_URL: "https://api.groq.com/openai" }).kind, "compatible");
});

test("the address read off the receipt is what the InstaPay notification then matches", () => {
  const notification = parseTransferSms("انستاباي لقد استلمت 1.00 جنيه من zeinababdelnasser@instapay", { receivedAt: new Date("2026-09-20T02:07:31Z") });
  const read = normalizeReceipt({ sender_address: "zeinababdelnasser@instapay", amount: "1.00" });
  const order = {
    id: 31,
    customer_phone: "01099998888",
    customer_name: "زينب عبد الناصر",
    // What attachReceiptSenderAddress writes on the order.
    shipping_payment_reference: read.senderAddress,
  };
  const decision = decideTransferMatch({
    transfer: { counterparty_name: notification.counterpartyName, counterparty_phone: "", reference: notification.reference, amount: notification.amount },
    candidates: [order],
    trustedSender: true,
  });
  assert.equal(decision.action, "confirm");
  assert.equal(decision.order.id, 31);
  assert.equal(decision.matchMethod, "auto_reference");
});

test("wiring: the upload reads the receipt, and the model may never approve money by itself", () => {
  const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
  const proof = read("../server/modules/shipping/paymentProofLink.js");
  assert.match(proof, /attachReceiptSenderAddress\(\{/);
  assert.match(proof, /expectedAmounts:/);
  const vision = read("../server/modules/walletTransfers/paymentReceiptVision.js");
  // The only column the reading may write is the reference; approving is the matcher's alone.
  assert.match(vision, /SET shipping_payment_reference = \$2/);
  assert.doesNotMatch(vision, /transfer_proof_status\s*=\s*'approved'/);
  assert.doesNotMatch(vision, /payment_status\s*=/);
  // A reference already on the order is never overwritten.
  assert.match(vision, /COALESCE\(shipping_payment_reference, ''\) = ''/);
});
