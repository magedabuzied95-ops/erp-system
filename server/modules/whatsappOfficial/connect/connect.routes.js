import express from "express";

const router = express.Router();

// Mounted at /api/whatsapp-official-public with no auth.
export const publicConnectRoutes = express.Router();

export default router;
