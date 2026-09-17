import { jtSandboxConfig, jtSandboxFields, jtSandboxId, jtSandboxRequest } from "./jtSandbox.js";
import { markJtSandboxCancelled, recordJtSandboxCreate } from "./jtStore.js";

const text = (value) => String(value ?? "").trim();
const validId = (value) => /^[A-Za-z0-9_-]{1,50}$/.test(text(value));
const validBill = (value) => /^[A-Za-z0-9_-]{1,50}$/.test(text(value));
const fail = (res, error) => res.status(error.status || 502).json({
  success: false,
  code: error.code || "JT_SANDBOX_ERROR",
  message: error.message || "J&T Sandbox request failed",
  http_status: error.httpStatus ?? null,
  jt_code: error.jtCode ?? null,
});

const run = (handler) => async (req, res) => {
  try { return await handler(req, res); } catch (error) { return fail(res, error); }
};

export const jtSandboxStatus = run(async (_req, res) => {
  jtSandboxConfig();
  return res.json({ success: true, mode: "sandbox", operations: ["create", "query", "cancel", "trace", "label"] });
});

// Uses documentation-only sample addresses and phones. Never accepts a real M1
// order id or customer address, so a Sandbox call cannot affect live orders.
export const jtSandboxCreate = run(async (_req, res) => {
  const config = jtSandboxConfig();
  const txlogisticId = jtSandboxId();
  const result = await jtSandboxRequest("create", {
    ...jtSandboxFields(config),
    txlogisticId,
    expressType: "EZ",
    deliveryType: "04",
    payType: "PP_PM",
    sender: { name: "M1 Sandbox Sender", mobile: "01000000001", countryCode: "EGY", prov: "الشرقية", city: "الزقازيق", area: "حي الزهور", street: "Test Street 1" },
    receiver: { name: "M1 Sandbox Receiver", mobile: "01000000002", countryCode: "EGY", prov: "أسيوط", city: "القوصية", area: "الصبحه", street: "Test Street 2" },
    goodsType: "ITN1",
    weight: "0.5",
    totalQuantity: 1,
    operateType: 1,
  });
  await recordJtSandboxCreate({ txlogisticId, billCode: result.data?.billCode, sortingCode: result.data?.sortingCode });
  return res.json({ success: true, mode: "sandbox", code: result.code, msg: result.msg, txlogisticId: result.data?.txlogisticId || txlogisticId, billCode: result.data?.billCode || null, sortingCode: result.data?.sortingCode || null });
});

export const jtSandboxQuery = run(async (req, res) => {
  if (!validId(req.body?.txlogisticId)) return res.status(400).json({ success: false, code: "JT_INVALID_ID" });
  const result = await jtSandboxRequest("query", { command: 1, serialNumber: [text(req.body.txlogisticId)], ...jtSandboxFields(jtSandboxConfig()) });
  return res.json({ success: true, mode: "sandbox", code: result.code, msg: result.msg, data: result.data });
});

export const jtSandboxCancel = run(async (req, res) => {
  if (!/^M1SB\d{13}[A-F0-9]{8}$/.test(text(req.body?.txlogisticId))) return res.status(400).json({ success: false, code: "JT_NOT_OUR_SANDBOX_ID" });
  const result = await jtSandboxRequest("cancel", { txlogisticId: text(req.body.txlogisticId), orderType: 2, reason: "Sandbox test cancellation", ...jtSandboxFields(jtSandboxConfig()) });
  await markJtSandboxCancelled(text(req.body.txlogisticId));
  return res.json({ success: true, mode: "sandbox", code: result.code, msg: result.msg, data: result.data });
});

export const jtSandboxTrace = run(async (req, res) => {
  if (!validBill(req.body?.billCode)) return res.status(400).json({ success: false, code: "JT_INVALID_BILL" });
  const result = await jtSandboxRequest("trace", { billCodes: text(req.body.billCode) });
  return res.json({ success: true, mode: "sandbox", code: result.code, msg: result.msg, data: result.data });
});

export const jtSandboxLabel = run(async (req, res) => {
  if (!validBill(req.body?.billCode)) return res.status(400).json({ success: false, code: "JT_INVALID_BILL" });
  const result = await jtSandboxRequest("label", { ...jtSandboxFields(jtSandboxConfig()), billCode: text(req.body.billCode), printSize: 0, printCod: 0 });
  const content = result.data?.base64EncodeContent;
  if (typeof content !== "string" || !/^[A-Za-z0-9+/=]+$/.test(content)) return res.status(502).json({ success: false, code: "JT_LABEL_MISSING" });
  const pdf = Buffer.from(content, "base64");
  if (pdf.subarray(0, 5).toString() !== "%PDF-") return res.status(502).json({ success: false, code: "JT_LABEL_INVALID" });
  res.set({ "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="jt-sandbox-${text(req.body.billCode)}.pdf"`, "Cache-Control": "no-store" });
  return res.send(pdf);
});
