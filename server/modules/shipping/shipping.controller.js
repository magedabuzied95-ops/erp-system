import {
  cancelBostaShipmentForOrder,
  createBostaShipmentForOrder,
  getBostaSettings,
  listShippingCities,
  listShippingDistricts,
  listShippingZones,
  previewBostaWebhookPayload,
  processBostaWebhook,
  refreshBostaShipmentForOrder,
  saveBostaSettings,
  searchShippingLocations,
  syncBostaLocations,
} from "./shipping.service.js";

const sendError = (res, error, fallback = "Shipping request failed") => {
  const status = Number(error?.status || error?.statusCode || 500);
  return res.status(status >= 400 && status < 600 ? status : 500).json({
    success: false,
    message: error?.message || fallback,
    code: error?.code || undefined,
    details: error?.payload || undefined,
  });
};

export const getBostaProviderSettings = async (_req, res) => {
  try {
    return res.json({ success: true, settings: await getBostaSettings() });
  } catch (error) {
    return sendError(res, error);
  }
};

export const updateBostaProviderSettings = async (req, res) => {
  try {
    const provider = await saveBostaSettings({
      enabled: req.body?.enabled ?? req.body?.is_enabled,
      apiKey: req.body?.api_key ?? req.body?.apiKey,
      apiBaseUrl: req.body?.api_base_url ?? req.body?.apiBaseUrl,
      updatedBy: req.user?.id || null,
    });
    return res.json({ success: true, provider });
  } catch (error) {
    return sendError(res, error);
  }
};

export const syncBostaLocationsController = async (_req, res) => {
  try {
    return res.json({ success: true, counts: await syncBostaLocations() });
  } catch (error) {
    return sendError(res, error, "Failed to sync Bosta locations");
  }
};

export const getShippingCities = async (req, res) => {
  try {
    const cities = await listShippingCities({
      provider: req.query.provider || "bosta",
      dropoffOnly: req.query.dropoff === "1" || req.query.dropoffOnly === "true",
      pickupOnly: req.query.pickup === "1" || req.query.pickupOnly === "true",
    });
    return res.json({ success: true, cities });
  } catch (error) {
    return sendError(res, error);
  }
};

export const getShippingZones = async (req, res) => {
  try {
    const zones = await listShippingZones({
      provider: req.query.provider || "bosta",
      cityId: req.query.cityId || req.query.city_id,
      dropoffOnly: req.query.dropoff === "1" || req.query.dropoffOnly === "true",
      pickupOnly: req.query.pickup === "1" || req.query.pickupOnly === "true",
    });
    return res.json({ success: true, zones });
  } catch (error) {
    return sendError(res, error);
  }
};

export const getShippingDistricts = async (req, res) => {
  try {
    const districts = await listShippingDistricts({
      provider: req.query.provider || "bosta",
      zoneId: req.query.zoneId || req.query.zone_id,
      dropoffOnly: req.query.dropoff === "1" || req.query.dropoffOnly === "true",
      pickupOnly: req.query.pickup === "1" || req.query.pickupOnly === "true",
    });
    return res.json({ success: true, districts });
  } catch (error) {
    return sendError(res, error);
  }
};

export const searchLocations = async (req, res) => {
  try {
    const locations = await searchShippingLocations({
      provider: req.query.provider || "bosta",
      q: req.query.q || "",
      limit: req.query.limit || 50,
    });
    return res.json({ success: true, locations });
  } catch (error) {
    return sendError(res, error);
  }
};

export const createOrderBostaShipment = async (req, res) => {
  try {
    const result = await createBostaShipmentForOrder(req.params.id);
    return res.json({ success: true, ...result });
  } catch (error) {
    return sendError(res, error, "Failed to create Bosta shipment");
  }
};

export const refreshOrderBostaShipment = async (req, res) => {
  try {
    const result = await refreshBostaShipmentForOrder(req.params.id);
    return res.json({ success: true, ...result });
  } catch (error) {
    return sendError(res, error, "Failed to refresh Bosta shipment");
  }
};

export const cancelOrderBostaShipment = async (req, res) => {
  try {
    const result = await cancelBostaShipmentForOrder(req.params.id);
    return res.json({ success: true, ...result });
  } catch (error) {
    return sendError(res, error, "Failed to cancel Bosta shipment");
  }
};

export const handleBostaWebhook = async (req, res) => {
  try {
    const result = await processBostaWebhook({ req, payload: req.body || {} });
    return res.json({ success: true, ...result });
  } catch (error) {
    return sendError(res, error, "Failed to process Bosta webhook");
  }
};

export const testBostaWebhook = async (req, res) => {
  try {
    const payload = Object.keys(req.body || {}).length ? req.body : undefined;
    return res.json({ success: true, ...previewBostaWebhookPayload(payload) });
  } catch (error) {
    return sendError(res, error, "Failed to preview Bosta webhook");
  }
};
