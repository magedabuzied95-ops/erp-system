const trimSlash = (value = "") => String(value || "").replace(/\/+$/, "");

const jsonRequest = async (url, { apiKey, method = "GET", body } = {}) => {
  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  if (apiKey) headers.Authorization = apiKey;

  const response = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text };
  }
  if (!response.ok) {
    const message = payload?.message || payload?.error || `Bosta request failed with ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
};

export const createBostaClient = ({ apiKey, apiBaseUrl } = {}) => {
  const baseUrl = trimSlash(apiBaseUrl || process.env.BOSTA_API_BASE_URL || "https://app.bosta.co/api/v2");
  const token = apiKey || process.env.BOSTA_API_KEY || "";
  const path = (envKey, fallback) => process.env[envKey] || fallback;
  const url = (pathName) => `${baseUrl}${String(pathName || "").startsWith("/") ? "" : "/"}${pathName}`;

  const requireApiKey = () => {
    if (!token) {
      const error = new Error("Bosta API key is missing");
      error.code = "BOSTA_API_KEY_MISSING";
      throw error;
    }
  };

  return {
    getMasterLocations: async () => {
      requireApiKey();
      return jsonRequest(url(path("BOSTA_MASTER_LOCATIONS_PATH", "/cities/getAllDistricts")), { apiKey: token });
    },
    createDelivery: async (deliveryPayload) => {
      requireApiKey();
      return jsonRequest(url(path("BOSTA_CREATE_DELIVERY_PATH", "/deliveries")), { apiKey: token, method: "POST", body: deliveryPayload });
    },
    // Bosta merges the labels itself and answers with one base64 PDF, so a bulk
    // print is a single call that needs no PDF stitching on our side. The ERP used
    // to read a `shipping_label_url` column Bosta never fills — create-delivery
    // carries no label — so printing silently produced nothing at all.
    massAirwayBill: async (deliveryIds = [], { lang = "ar" } = {}) => {
      requireApiKey();
      const ids = (Array.isArray(deliveryIds) ? deliveryIds : [deliveryIds])
        .map((id) => String(id ?? "").trim())
        .filter(Boolean);
      if (!ids.length) {
        const error = new Error("No Bosta delivery id to print");
        error.code = "BOSTA_AWB_NO_DELIVERY_ID";
        throw error;
      }
      const template = path("BOSTA_MASS_AWB_PATH", "/deliveries/mass-awb");
      // Each id is encoded on its own and the commas stay literal: Bosta's own
      // WooCommerce client sends a raw comma list, and a %2C separator is not worth
      // betting a bulk print on.
      const query = `ids=${ids.map((id) => encodeURIComponent(id)).join(",")}&lang=${encodeURIComponent(lang)}`;
      return jsonRequest(`${url(template)}?${query}`, { apiKey: token });
    },
    airwayBill: async (deliveryId) => {
      requireApiKey();
      const template = path("BOSTA_AWB_PATH", "/deliveries/awb/{id}");
      return jsonRequest(url(template.replace("{id}", encodeURIComponent(deliveryId))), { apiKey: token });
    },
    getDeliveryStatus: async (identifier) => {
      requireApiKey();
      const template = path("BOSTA_DELIVERY_STATUS_PATH", "/deliveries/{id}");
      return jsonRequest(url(template.replace("{id}", encodeURIComponent(identifier))), { apiKey: token });
    },
    cancelDelivery: async (identifier) => {
      requireApiKey();
      const template = path("BOSTA_CANCEL_DELIVERY_PATH", "/deliveries/{id}/cancel");
      return jsonRequest(url(template.replace("{id}", encodeURIComponent(identifier))), { apiKey: token, method: "POST", body: {} });
    },
    // TODO(bosta): add pricing endpoint once commercial pricing rules are finalized.
    getPricing: async () => {
      throw new Error("Bosta pricing integration is not implemented yet");
    },
    // TODO(bosta): add pickup request endpoint and branch-origin validation.
    createPickupRequest: async () => {
      throw new Error("Bosta pickup request integration is not implemented yet");
    },
    // TODO(bosta): add webhook signature verification and delivery status handlers.
    verifyWebhook: () => false,
  };
};
