import express from "express";
import db from "../database/db.js";
import { packingDetailsEnabled, renderPackingPage, verifyPackingToken } from "../modules/shipping/packingSlip.js";
import { itemsForOrders } from "../modules/shipping/shipping.portal.service.js";

// The page the QR on an airway bill opens: the parcel's models, nothing else. The token is
// signed per order, so ids cannot be walked; the page carries no price and no customer data.
const router = express.Router();

const notFoundPage = (message) => `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>M1 Store</title></head><body style="font-family:system-ui,sans-serif;padding:32px;text-align:center">${message}</body></html>`;

router.get("/:token", async (req, res) => {
  res.set("Cache-Control", "private, no-store");
  res.set("X-Robots-Tag", "noindex, nofollow");
  res.type("html");
  try {
    const orderId = verifyPackingToken(req.params.token);
    if (!orderId || !(await packingDetailsEnabled())) return res.status(404).send(notFoundPage("الرابط ده مش شغال."));
    const { rows } = await db.query(
      `SELECT id, COALESCE(NULLIF(public_order_number, ''), NULLIF(invoice_number, ''), id::text) AS order_number FROM orders WHERE id = $1 LIMIT 1`,
      [orderId]
    );
    if (!rows[0]) return res.status(404).send(notFoundPage("الأوردر مش موجود."));
    const items = (await itemsForOrders([orderId])).get(String(orderId)) || [];
    return res.send(renderPackingPage({ orderNumber: rows[0].order_number, items }));
  } catch (error) {
    console.error("[public-packing] page failed", { message: error?.message || String(error) });
    return res.status(500).send(notFoundPage("حصلت مشكلة، جرّب تاني."));
  }
});

export default router;
