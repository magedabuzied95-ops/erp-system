// /api/whatsapp-official — the Genie-style WhatsApp menu sections added on top of the existing
// WhatsApp routes. Each area owns its sub-router and applies its own auth guards (copy the
// pattern of server/routes/whatsappTemplates.js).
//   /accounts   per-number settings, display name, re-register, stickers, AI, auto reply
//   /connect    connect page, number registration (PIN), coexistence, WABA webhook events
//   /analytics  template analytics + API guide data
//   /flows      chatbot flow builder + runtime admin
import express from "express";

import accountsRoutes from "./accounts/accounts.routes.js";
import connectRoutes, { publicConnectRoutes } from "./connect/connect.routes.js";
import analyticsRoutes from "./analytics/analytics.routes.js";
import flowsRoutes from "./flows/flows.routes.js";

const router = express.Router();
router.use("/accounts", accountsRoutes);
router.use("/connect", connectRoutes);
router.use("/analytics", analyticsRoutes);
router.use("/flows", flowsRoutes);

// Unauthenticated endpoints (none yet; reserved for the connect area).
export const waOfficialPublicRoutes = publicConnectRoutes;

export default router;
