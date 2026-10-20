import express from "express";

const router = express.Router();

// Mounted at /api/meta-ads-public with no auth (OAuth callback, webhook).
export const publicIntegrationsRoutes = express.Router();

export default router;
