// /api/whatsapp-official/connect — the "Connect Account" section of the WhatsApp menu.
//
// The Meta dialog itself still posts to the existing /api/whatsapp/embedded-signup/* routes
// (state + callback). These endpoints are the page around it and what follows the callback:
//   GET  /overview   quota (N of WHATSAPP_MAX_NUMBERS), signup config, connected numbers
//   POST /complete   { id, mode: "cloud"|"coexistence", pin? } — register a new number with its
//                    PIN, or run the coexistence syncs; then read Meta's status into the row
//   POST /register   { id, pin } — retry registration of a new (non-coexistence) number
//   POST /refresh    { id } — re-read display-name status / limit tier / quality into the row
import express from "express";

import { protect } from "../../../middleware/authMiddleware.js";
import permit from "../../../middleware/permissionMiddleware.js";
import {
  connectIntegrationShape,
  connectOverview,
  findTenantIntegration,
  isCoexistenceIntegration,
  refreshIntegrationLiveStatus,
  registerIntegrationNumber,
  requestCoexistenceSync,
} from "./connectService.js";

const router = express.Router();

// Mounted at /api/whatsapp-official-public with no auth. Nothing public is needed yet.
export const publicConnectRoutes = express.Router();

// Same tenant scope the embedded-signup routes store integrations under.
const tenantScope = (req) =>
  Number(req.user?.tenant_id || req.user?.tenantId || req.tenant?.id || req.headers?.["x-tenant-id"] || 0) || 0;

const fail = (res, error, fallback) => {
  const status = error?.status && error.status < 500 ? error.status : 400;
  if (!error?.status || error.status >= 500) console.warn("[wa-connect:route-failed]", { code: error?.code || "", message: error?.message || String(error) });
  return res.status(status).json({ success: false, code: error?.code || "WA_CONNECT_FAILED", message: error?.message || fallback, details: error?.details || null });
};

const integrationFor = async (req) => {
  const row = await findTenantIntegration({ tenantId: tenantScope(req), id: req.body?.id || req.query?.id });
  if (!row) throw Object.assign(new Error("WhatsApp number not found"), { status: 404, code: "WA_INTEGRATION_NOT_FOUND" });
  return row;
};

router.get("/overview", protect, permit("settings", "view"), async (req, res) => {
  try {
    return res.json({ success: true, ...(await connectOverview({ tenantId: tenantScope(req) })) });
  } catch (error) {
    return fail(res, error, "Failed to load the WhatsApp connect page");
  }
});

router.post("/complete", protect, permit("settings", "edit"), async (req, res) => {
  try {
    let row = await integrationFor(req);
    const mode = String(req.body?.mode || "").trim();
    const coexistence = isCoexistenceIntegration(row, mode);
    let registration = null;
    let sync = null;
    if (coexistence) {
      // Never register a Business-app number. The syncs are best-effort and never fail this call.
      const synced = await requestCoexistenceSync({ row }).catch((error) => ({ outcome: { error: error?.message || String(error) }, row }));
      sync = synced.outcome;
      row = synced.row;
    } else if (String(req.body?.pin || "").trim()) {
      const registered = await registerIntegrationNumber({ row, pin: req.body.pin });
      registration = { ok: registered.ok, status: registered.status, error: registered.error };
      row = registered.row;
    } else {
      registration = { ok: false, status: "pin_required", error: "" };
    }
    const refreshed = await refreshIntegrationLiveStatus(row);
    return res.json({ success: true, coexistence, registration, sync, integration: connectIntegrationShape(refreshed.row) });
  } catch (error) {
    return fail(res, error, "Failed to finish the WhatsApp connection");
  }
});

router.post("/register", protect, permit("settings", "edit"), async (req, res) => {
  try {
    const row = await integrationFor(req);
    const registered = await registerIntegrationNumber({ row, pin: req.body?.pin });
    const refreshed = registered.ok ? await refreshIntegrationLiveStatus(registered.row) : { row: registered.row };
    return res.json({
      success: true,
      registration: { ok: registered.ok, status: registered.status, error: registered.error },
      integration: connectIntegrationShape(refreshed.row),
    });
  } catch (error) {
    return fail(res, error, "Failed to register the WhatsApp number");
  }
});

router.post("/refresh", protect, permit("settings", "view"), async (req, res) => {
  try {
    const row = await integrationFor(req);
    const refreshed = await refreshIntegrationLiveStatus(row);
    return res.json({ success: true, ok: refreshed.ok, error: refreshed.error || "", integration: connectIntegrationShape(refreshed.row) });
  } catch (error) {
    return fail(res, error, "Failed to refresh the WhatsApp number");
  }
});

export default router;
