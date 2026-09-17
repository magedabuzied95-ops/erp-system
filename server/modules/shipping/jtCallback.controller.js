import { jtValidateCallback } from "./jtSandbox.js";
import { jtRuntimeConfig } from "./jtConfig.js";
import { applyJtCallbackEvent, validateJtCallbackEvent } from "./jtStore.js";

const failure = (res, status, code) => res.status(status).json({ code: "0", msg: code, data: "FAIL" });

export const handleJtCallback = async (req, res) => {
  let config;
  try { config = jtRuntimeConfig(); } catch { return failure(res, 503, "jt_unavailable"); }
  const bizContent = req.body?.bizContent;
  if (typeof bizContent !== "string" || bizContent.length > 32768) return failure(res, 400, "invalid_biz_content");
  if (!jtValidateCallback({
    apiAccount: req.get("apiAccount"),
    digest: req.get("digest"),
    timestamp: req.get("timestamp"),
    bizContent,
  }, config)) return failure(res, 401, "invalid_signature");
  let payload;
  try { payload = JSON.parse(bizContent); } catch { return failure(res, 400, "invalid_json"); }
  const event = validateJtCallbackEvent(payload);
  if (!event) return failure(res, 422, "invalid_event");
  try {
    const result = await applyJtCallbackEvent(event, undefined, config.environment);
    if (!result.found || result.billMismatch) return failure(res, 404, "unknown_shipment");
    console.info("[jt-callback]", { txlogisticId: event.txlogisticId, scanType: event.scanType, duplicate: result.duplicate });
    return res.json({ code: "1", msg: "success", data: "SUCCESS" });
  } catch (error) {
    console.error("[jt-callback] storage error", { name: error?.name, code: error?.code });
    return failure(res, 503, "temporary_error");
  }
};
