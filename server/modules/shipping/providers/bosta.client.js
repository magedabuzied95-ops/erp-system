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
    // `/deliveries/{id}` is not a Bosta route at all: it answers "Cannot GET" — an
    // Express 404 raised before any auth check, whereas a real path answers 401
    // errorCode 1028 even unauthenticated. So every status refresh this ERP ever
    // attempted failed with a bare 404, which is why no order has a single
    // `bosta_refresh_status` timeline entry. `/deliveries/business/{trackingNumber}`
    // is the path that exists; the env override stays so it can be repointed without
    // a deploy if Bosta moves it again.
    getDeliveryStatus: async (identifier) => {
      requireApiKey();
      const template = path("BOSTA_DELIVERY_STATUS_PATH", "/deliveries/business/{id}");
      return jsonRequest(url(template.replace("{id}", encodeURIComponent(identifier))), { apiKey: token });
    },
    // `POST /deliveries/{id}/cancel` is not a Bosta route — probed 2026-09-16 it answers
    // "Cannot GET/POST" before any auth check. Every cancel the ERP ever sent died there,
    // and the order was still marked cancelled locally while the parcel stayed live at
    // Bosta. The official spec's route is DELETE …/business/{trackingNumber}/terminate.
    cancelDelivery: async (trackingNumber) => {
      requireApiKey();
      const template = path("BOSTA_CANCEL_DELIVERY_PATH", "/deliveries/business/{id}/terminate");
      return jsonRequest(url(template.replace("{id}", encodeURIComponent(trackingNumber))), { apiKey: token, method: "DELETE" });
    },
    // Only receiver, address and notes are ever sent — see mapOrderToBostaDeliveryUpdatePayload.
    updateDelivery: async (trackingNumber, body = {}) => {
      requireApiKey();
      return jsonRequest(url(`/deliveries/business/${encodeURIComponent(trackingNumber)}`), { apiKey: token, method: "PUT", body });
    },
    // Query names from the official spec: dropOffCity / pickupCity are English city names.
    getShippingFeeEstimate: async ({ dropOffCity = "", pickupCity = "", cod = 0, type = "SEND", size = "Normal" } = {}) => {
      requireApiKey();
      const query = new URLSearchParams();
      if (dropOffCity) query.set("dropOffCity", dropOffCity);
      if (pickupCity) query.set("pickupCity", pickupCity);
      query.set("cod", String(Math.max(0, Number(cod) || 0)));
      query.set("type", type);
      query.set("size", size);
      return jsonRequest(`${url("/pricing/shipment/calculator")}?${query.toString()}`, { apiKey: token });
    },
    listPickupLocations: async () => {
      requireApiKey();
      return jsonRequest(url("/pickup-locations"), { apiKey: token });
    },
    listPickups: async ({ page = 1, limit = 20 } = {}) => {
      requireApiKey();
      return jsonRequest(`${url("/pickups")}?page=${Number(page) || 1}&limit=${Number(limit) || 20}&sortBy=-updatedAt`, { apiKey: token });
    },
    availablePickupDates: async (days = 7) => {
      requireApiKey();
      return jsonRequest(`${url("/pickups/available-dates")}?days=${Number(days) || 7}`, { apiKey: token });
    },
    createPickup: async (body = {}) => {
      requireApiKey();
      return jsonRequest(url("/pickups"), { apiKey: token, method: "POST", body });
    },
    deletePickup: async (pickupId) => {
      requireApiKey();
      return jsonRequest(url(`/pickups/${encodeURIComponent(pickupId)}`), { apiKey: token, method: "DELETE" });
    },
    // The COD Bosta has collected and not yet transferred. Needs the business id, which
    // no API-key call returns directly — the service discovers it from a pickup request.
    getUnpaidCod: async (businessId) => {
      requireApiKey();
      return jsonRequest(url(`/businesses/${encodeURIComponent(businessId)}/transactions`), { apiKey: token });
    },
  };
};
