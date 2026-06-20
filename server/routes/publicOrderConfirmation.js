import express from "express";

import { consumeOrderConfirmationLink } from "../services/whatsappOrderConfirmationService.js";

const router = express.Router();

const firstText = (...values) => {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
};

const normalizeItems = (items = []) =>
  (Array.isArray(items) ? items : [])
    .map((item) => ({
      id: item?.id ?? null,
      product_name: firstText(item?.product_name, item?.name, item?.title, "منتج"),
      variant_name: firstText(item?.variant_name, [item?.color, item?.size].filter(Boolean).join(" / ")),
      color: firstText(item?.color),
      size: firstText(item?.size),
      quantity: Number(item?.quantity || item?.qty || 1) || 1,
      image_url: firstText(item?.image_url, item?.product_image, item?.variant_image, item?.photo_url, item?.thumbnail_url),
      total_amount: Number(item?.total_amount || 0) || 0,
    }));

const serializeOrder = (order = null) => {
  if (!order) return null;
  const items = normalizeItems(order.items);
  return {
    id: order.id,
    public_order_number: order.public_order_number || order.display_order_number || order.invoice_number || order.order_number || String(order.id),
    display_order_number: order.display_order_number || "",
    invoice_number: order.invoice_number || "",
    status: order.status || "",
    customer_name: firstText(order.customer_name, order.customer?.name),
    customer_phone: firstText(order.customer_phone, order.phone, order.whatsapp, order.mobile),
    customer_address: firstText(
      order.customer_address,
      order.shipping_address_line,
      order.street_address,
      order.address
    ),
    governorate: firstText(order.governorate),
    city_area: firstText(order.city_area),
    landmark: firstText(order.landmark),
    order_notes: firstText(order.order_notes),
    total_amount: Number(order.total_amount ?? order.total_price ?? order.total ?? 0) || 0,
    total_price: Number(order.total_price ?? order.total_amount ?? order.total ?? 0) || 0,
    total: Number(order.total ?? order.total_amount ?? order.total_price ?? 0) || 0,
    shipping_cost: Number(order.shipping_cost ?? 0) || 0,
    items,
    primary_image_url: firstText(
      order.primary_image_url,
      order.image_url,
      order.product_image_url,
      order.customer_image_url,
      items[0]?.image_url
    ),
  };
};

const handleRequest = async (req, res) => {
  try {
    const result = await consumeOrderConfirmationLink({
      code: req.params.code,
      action: req.body?.action || req.query?.action || "",
      ipAddress: req.ip || req.socket?.remoteAddress || "",
      userAgent: req.headers?.["user-agent"] || "",
      source: "public_order_confirmation_link",
    });
    return res.json({
      success: true,
      action: result.action,
      message: result.message,
      target_status: result.target_status,
      already_applied: result.already_applied,
      code_expires_at: result.code_expires_at,
      used_at: result.used_at,
      supported_actions: ["confirm", "edit", "cancel"],
      order: serializeOrder(result.order),
    });
  } catch (error) {
    return res.status(error?.status || 500).json({
      success: false,
      code: error?.code || "ORDER_CONFIRMATION_LINK_ERROR",
      message: error?.message || "Unable to process order confirmation link",
    });
  }
};

router.get("/:code", handleRequest);
router.post("/:code", handleRequest);

export default router;
