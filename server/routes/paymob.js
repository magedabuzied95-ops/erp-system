import express from "express";

import { receivePaymobWebhook } from "../controllers/posController.js";

const router = express.Router();

router.post("/webhook", receivePaymobWebhook);

export default router;
