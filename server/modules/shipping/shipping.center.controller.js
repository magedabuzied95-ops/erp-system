import {
  bulkShippingCenterAction,
  getShippingCenterMeta,
  getShippingCenterSummary,
  listShippingCenterOrders,
  shippingCenterProviderInterface,
} from "./shipping.center.service.js";

const sendError = (res, error, fallback = "Shipping Center request failed") => {
  const status = Number(error?.status || error?.statusCode || 500);
  return res.status(status >= 400 && status < 600 ? status : 500).json({
    success: false,
    message: error?.message || fallback,
    code: error?.code || undefined,
  });
};

export const getShippingCenter = async (req, res) => {
  try {
    const [orders, summary, meta] = await Promise.all([
      listShippingCenterOrders(req.query),
      getShippingCenterSummary(req.query),
      getShippingCenterMeta(),
    ]);
    return res.json({ success: true, ...orders, summary, meta, provider_interface: shippingCenterProviderInterface });
  } catch (error) {
    return sendError(res, error);
  }
};

export const getShippingCenterSummaryController = async (req, res) => {
  try {
    return res.json({ success: true, summary: await getShippingCenterSummary(req.query) });
  } catch (error) {
    return sendError(res, error);
  }
};

export const getShippingCenterMetaController = async (_req, res) => {
  try {
    return res.json({ success: true, meta: await getShippingCenterMeta(), provider_interface: shippingCenterProviderInterface });
  } catch (error) {
    return sendError(res, error);
  }
};

export const bulkShippingCenterActionController = async (req, res) => {
  try {
    const result = await bulkShippingCenterAction({
      action: req.body?.action,
      orderIds: req.body?.order_ids || req.body?.orderIds || [],
    });
    return res.json({ success: true, ...result });
  } catch (error) {
    return sendError(res, error);
  }
};
