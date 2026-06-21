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
      product_name: firstText(item?.resolved_product_name, item?.product_name, item?.name, item?.title, "منتج"),
      variant_name: firstText(item?.resolved_variant_name, item?.variant_name, [item?.color, item?.size].filter(Boolean).join(" / ")),
      color: firstText(item?.color),
      size: firstText(item?.size),
      quantity: Number(item?.quantity || item?.qty || 1) || 1,
      image_url: firstText(
        item?.resolved_image_url,
        item?.image_url,
        item?.product_image,
        item?.variant_image,
        item?.primary_image_url,
        item?.public_image_url,
        item?.photo_url,
        item?.thumbnail_url
      ),
      resolved_image_url: firstText(item?.resolved_image_url, item?.image_url),
      resolved_product_name: firstText(item?.resolved_product_name, item?.product_name),
      resolved_variant_name: firstText(item?.resolved_variant_name, item?.variant_name),
      product_image: firstText(item?.product_image, item?.image_url),
      variant_image: firstText(item?.variant_image, item?.image_url),
      total_amount: Number(item?.total_amount || 0) || 0,
    }));

const serializeOrder = (order = null) => {
  if (!order) return null;
  const items = normalizeItems(order.items);
  const structuredAddressFields = [
    firstText(order.governorate, order.governorate_name, order.province, order.province_name, order.state, order.state_name),
    firstText(order.center, order.center_name, order.city, order.city_name, order.town, order.town_name, order.district, order.district_name),
    firstText(order.area, order.area_name, order.region, order.region_name, order.neighborhood, order.neighborhood_name, order.zone, order.zone_name),
    firstText(order.street, order.street_name, order.street_address, order.address_line),
    firstText(order.building_number, order.building_no, order.building, order.building_name),
    firstText(order.floor, order.floor_number, order.level, order.level_number),
    firstText(order.apartment, order.apartment_number, order.unit, order.unit_number, order.flat, order.flat_number),
  ].filter(Boolean);
  const hasStructuredAddress = structuredAddressFields.length > 0;
  return {
    id: order.id,
    public_order_number: order.public_order_number || order.display_order_number || order.invoice_number || order.order_number || String(order.id),
    display_order_number: order.display_order_number || "",
    invoice_number: order.invoice_number || "",
    status: order.status || "",
    customer_name: firstText(order.customer_name, order.customer?.name),
    customer_phone: firstText(order.customer_phone, order.phone, order.whatsapp, order.mobile),
    customer_address: hasStructuredAddress ? "" : firstText(order.customer_address, order.shipping_address_line, order.street_address, order.address),
    governorate: firstText(order.governorate, order.governorate_name, order.province, order.province_name, order.state, order.state_name),
    city: firstText(order.city, order.city_name, order.shipping_city_name, order.shipping_city_name_ar, order.shipping_city_name_en, order.city_area),
    center: firstText(order.center, order.center_name, order.shipping_zone_name, order.shipping_zone_name_ar, order.shipping_zone_name_en, order.city_area),
    area: firstText(order.area, order.area_name, order.shipping_district_name, order.shipping_district_name_ar, order.shipping_district_name_en, order.city_area),
    street: firstText(order.street, order.street_name, order.street_address, order.address_line, order.customer_address),
    building_number: firstText(order.building_number, order.building_no, order.building, order.building_name),
    floor: firstText(order.floor, order.floor_number, order.level, order.level_number),
    apartment: firstText(order.apartment, order.apartment_number, order.unit, order.unit_number, order.flat, order.flat_number),
    city_area: firstText(order.city_area),
    landmark: firstText(order.landmark),
    order_notes: firstText(order.order_notes),
    total_amount: Number(order.total_amount ?? order.total_price ?? order.total ?? 0) || 0,
    total_price: Number(order.total_price ?? order.total_amount ?? order.total ?? 0) || 0,
    total: Number(order.total ?? order.total_amount ?? order.total_price ?? 0) || 0,
    shipping_cost: Number(order.shipping_cost ?? 0) || 0,
    timeline: Array.isArray(order.timeline) ? order.timeline : [],
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
      already_used: Boolean(result.already_used),
      used_action: result.used_action || "",
      used_order_status: result.used_order_status || "",
      link_locked: Boolean(result.link_locked),
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
