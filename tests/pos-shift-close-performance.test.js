import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const frontend = fs.readFileSync("src/modules/pos/pages/POSPro.jsx", "utf8");
const backend = fs.readFileSync("server/controllers/posController.js", "utf8");

test("shift close dialog opens before the report request completes", () => {
  const handler = frontend.slice(frontend.indexOf("const handleCloseShift"), frontend.indexOf("const handleConfirmCloseShift"));
  assert.ok(handler.indexOf("setShiftCloseOpen(true)") < handler.indexOf("await api.get(`/pos/shifts/${shiftId}/report`)"));
  assert.match(handler, /using active shift snapshot/);
});

test("closing response does not wait for report generation or WhatsApp", () => {
  const handler = backend.slice(backend.indexOf("export const closePosShift"), backend.indexOf("export const createQuickPosExpense"));
  assert.ok(handler.indexOf("res.status(200).json(responsePayload)") < handler.indexOf("setImmediate"));
  assert.match(handler, /report: null/);
  assert.match(handler, /buildPosShiftReport\(db/);
  assert.match(handler, /await sendTextMessage/);
});

test("POS shift schemas are initialized once per server process", () => {
  assert.match(backend, /let posUserShiftSchemaReadyPromise = null/);
  assert.match(backend, /if \(posUserShiftSchemaReadyPromise\) return posUserShiftSchemaReadyPromise/);
  assert.match(backend, /let posExpenseSchemaReadyPromise = null/);
  assert.match(backend, /if \(posExpenseSchemaReadyPromise\) return posExpenseSchemaReadyPromise/);
});
