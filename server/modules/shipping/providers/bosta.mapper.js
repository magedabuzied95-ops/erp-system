const text = (value = "") => String(value ?? "").trim();

const pick = (source = {}, keys = []) => {
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null && source[key] !== "") return source[key];
  }
  return "";
};

const bool = (value, fallback = true) => {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "string") return !["0", "false", "no", "off"].includes(value.toLowerCase());
  return Boolean(value);
};

const arrayFromPayload = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.locations)) return payload.locations;
  if (Array.isArray(payload?.cities)) return payload.cities;
  return [];
};

export const normalizeBostaMasterLocations = (payload) => {
  const rows = [];
  let skippedInvalidRows = 0;

  for (const city of arrayFromPayload(payload)) {
    const providerCityId = text(pick(city, ["cityId", "cityID", "city_id", "_id", "id"]));
    const cityName = text(pick(city, ["cityName", "name", "nameEn", "city", "city_name"]));
    if (!providerCityId || !cityName) {
      skippedInvalidRows += 1;
      continue;
    }

    const normalizedCity = {
      provider_city_id: providerCityId,
      name_en: cityName,
      name_ar: text(pick(city, ["cityOtherName", "nameAr", "arabicName", "cityOthername", "otherName"])),
      code: text(pick(city, ["cityCode", "code", "city_code"])),
      pickup_available: bool(pick(city, ["pickupAvailability", "pickup_available", "pickupAvailable"]), true),
      dropoff_available: bool(pick(city, ["dropOffAvailability", "dropoffAvailability", "dropoff_available", "dropOffAvailable"]), true),
      raw_payload: city,
      districts: [],
    };

    const districts = Array.isArray(city.districts) ? city.districts : Array.isArray(city.zones) ? city.zones : [];
    for (const district of districts) {
      const providerZoneId = text(pick(district, ["zoneId", "zoneID", "zone_id", "zoneI", "zone?.id"]));
      const providerDistrictId = text(pick(district, ["districtId", "districtID", "district_id", "districtI", "_id", "id"]));
      const districtName = text(pick(district, ["districtName", "name", "nameEn", "district", "district_name"]));
      if (!providerZoneId || !providerDistrictId || !districtName) {
        skippedInvalidRows += 1;
        continue;
      }
      normalizedCity.districts.push({
        provider_zone_id: providerZoneId,
        zone_name_en: text(pick(district, ["zoneName", "zone", "zone_name", "zoneNameEn"])) || districtName,
        zone_name_ar: text(pick(district, ["zoneOtherName", "zoneNameAr", "zone_other_name", "zoneOthername"])),
        provider_district_id: providerDistrictId,
        district_name_en: districtName,
        district_name_ar: text(pick(district, ["districtOtherName", "districtNameAr", "district_other_name", "districtOthername", "otherName"])),
        pickup_available: bool(pick(district, ["pickupAvailability", "pickup_available", "pickupAvailable"]), normalizedCity.pickup_available),
        dropoff_available: bool(pick(district, ["dropOffAvailability", "dropoffAvailability", "dropoff_available", "dropOffAvailable"]), normalizedCity.dropoff_available),
        raw_payload: district,
      });
    }
    rows.push(normalizedCity);
  }

  return { cities: rows, skippedInvalidRows };
};

// Bosta reports state as an object — `{"code":10,"value":"Pickup requested"}` — not
// a string. Reading it straight through String() stored the literal "[object Object]"
// as the shipment status, which no status map or KPI bucket can match.
export const bostaStateText = (value) => {
  if (value && typeof value === "object") {
    return text(value.value ?? value.name ?? value.state ?? value.status ?? value.code ?? "");
  }
  return text(value);
};

const BOSTA_STATE_ALIASES = {
  created: "shipment_created",
  pickup_requested: "shipment_created",
  waiting_for_route: "shipment_created",
  route_assigned: "shipment_created",
  picked_up: "picked_up",
  pickedup: "picked_up",
  received_at_warehouse: "in_transit",
  in_transit: "in_transit",
  intransit: "in_transit",
  out_for_delivery: "out_for_delivery",
  delivered: "delivered",
  returned: "returned",
  returned_to_business: "returned",
  return_to_business: "returned",
  cancelled: "cancelled",
  canceled: "cancelled",
  terminated: "cancelled",
  exception: "failed_delivery",
  failed: "failed_delivery",
  delivery_failed: "failed_delivery",
  failed_delivery: "failed_delivery",
};

// Bosta's own vocabulary reduced to the statuses the ERP tracks. An unknown state is
// returned normalized rather than dropped, so a new Bosta state shows up as itself
// instead of silently becoming "created".
// Bosta's webhook sends the state as a bare numeric code (`"state": 45`) next to a
// human `description` ("Delivered"). Verified 2026-08-22 from a live callback for
// INV-516: the ERP read "45", matched nothing, and the delivered parcel sat at
// "في الطريق" until someone pressed تحديث الحالة. Codes from Bosta's delivery-states
// table; anything unlisted falls through to the description text.
export const BOSTA_STATE_CODES = {
  10: "shipment_created", // Pickup requested
  11: "shipment_created", // Waiting for route
  20: "shipment_created", // Route assigned
  21: "picked_up", // Picked up
  22: "in_transit", // Received at warehouse
  23: "in_transit", // In transit between hubs
  24: "in_transit", // Received at destination hub
  25: "in_transit", // Fulfilled
  26: "in_transit", // Ready to pickup
  30: "in_transit", // In transit
  40: "out_for_delivery",
  41: "out_for_delivery", // Out for delivery
  45: "delivered", // Delivered
  46: "returned", // Returned to business
  47: "failed_delivery", // Exception
  48: "cancelled", // Terminated
  49: "cancelled", // Cancelled
  50: "failed_delivery", // Lost / damaged
};

// `description` is the second argument so a numeric code the table does not know still
// resolves from Bosta's own wording instead of being recorded as an opaque number.
export const normalizeBostaStatus = (value, description = "") => {
  const key = bostaStateText(value).toLowerCase().replace(/[\s-]+/g, "_");
  if (!key) return description ? normalizeBostaStatus(description) : "";
  if (/^\d+$/.test(key)) {
    if (BOSTA_STATE_CODES[Number(key)]) return BOSTA_STATE_CODES[Number(key)];
    return (description ? normalizeBostaStatus(description) : "") || key;
  }
  return BOSTA_STATE_ALIASES[key] || key;
};

export const normalizeBostaDeliveryResponse = (payload = {}) => {
  const data = payload?.data && typeof payload.data === "object" ? payload.data : payload;
  const errorPayload = payload?.error && typeof payload.error === "object" ? payload.error : {};
  const providerDeliveryId = text(pick(data, ["_id", "id", "deliveryId", "delivery_id", "shipment_id"]));
  const trackingNumber = text(pick(data, ["trackingNumber", "tracking_number", "trackingCode", "tracking_code", "trackingNo"]));
  // Whether a state was actually found, as opposed to the "created" default below.
  // On the create call that default is harmless — we just made the parcel. On a status
  // refresh it is a silent lie: an unreadable response would overwrite a real status
  // with "created" and stamp a fresh sync time, which on screen is indistinguishable
  // from "the courier has not moved it yet".
  const parsedStatus = normalizeBostaStatus(
    pick(data, ["status", "state", "deliveryStatus"]),
    text(pick(data, ["description", "stateDescription", "statusDescription"])),
  );
  return {
    status_parsed: Boolean(parsedStatus),
    success: payload?.success !== false && !payload?.errorCode && !errorPayload?.errorCode,
    provider: "bosta",
    provider_delivery_id: providerDeliveryId,
    shipment_id: trackingNumber || providerDeliveryId,
    tracking_number: trackingNumber,
    tracking_url: text(pick(data, ["trackingUrl", "tracking_url", "trackingURL"])),
    label_url: text(pick(data, ["labelUrl", "label_url", "airwayBillUrl", "awbUrl"])),
    status: parsedStatus || "created",
    raw_response: payload,
    error: text(pick(payload, ["message", "errorMessage"])) || text(pick(errorPayload, ["message", "errorMessage", "details"])) || (typeof payload?.error === "string" ? text(payload.error) : ""),
    error_code: text(pick(payload, ["errorCode", "code"])) || text(pick(errorPayload, ["errorCode", "code"])),
  };
};

// The AWB endpoints answer with a base64 PDF, not a link: the official WooCommerce
// plugin base64-decodes `body.data` straight into a PDF response. The nesting differs
// between the mass and single endpoints, so both are probed, and the decoded bytes are
// checked for the %PDF magic — a truncated or HTML body must fail loudly here rather
// than reach the browser as a blank tab.
const BASE64_DATA_URI = /^data:[^;,]*;base64,/i;

const pickAwbBase64 = (payload) => {
  const candidates = [
    payload?.data,
    payload?.data?.data,
    payload?.data?.pdf,
    payload?.data?.awb,
    payload?.data?.base64,
    payload?.pdf,
    payload?.awb,
    payload?.base64,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim().replace(BASE64_DATA_URI, "");
  }
  return "";
};

export const normalizeBostaAwbResponse = (payload = {}) => {
  const message = text(pick(payload, ["message", "errorMessage"]));
  const base64 = pickAwbBase64(payload);
  if (!base64) {
    return { pdf_base64: "", byte_length: 0, error: message || "Bosta returned no airway bill content" };
  }
  let buffer;
  try {
    buffer = Buffer.from(base64, "base64");
  } catch {
    return { pdf_base64: "", byte_length: 0, error: "Bosta airway bill is not valid base64" };
  }
  if (!buffer.length || buffer.subarray(0, 4).toString("latin1") !== "%PDF") {
    return { pdf_base64: "", byte_length: buffer.length, error: message || "Bosta airway bill is not a PDF" };
  }
  return { pdf_base64: buffer.toString("base64"), byte_length: buffer.length, error: "" };
};

export const buildBostaAddressLine = (order = {}) => {
  const streetAddress = text(order.street_address || order.shipping_address_line || order.customer_address);
  const parts = [
    streetAddress,
    text(order.building_number) ? `Building ${text(order.building_number)}` : "",
    text(order.floor_number) ? `Floor ${text(order.floor_number)}` : "",
    text(order.apartment_number) ? `Apartment ${text(order.apartment_number)}` : "",
    text(order.landmark) ? `Near ${text(order.landmark)}` : "",
  ].filter(Boolean);
  return parts.join(", ");
};

// Bosta's integration clients attach the status callback to the delivery itself rather
// than relying on a dashboard-wide setting, and our deliveries have never carried one.
// That fits the evidence exactly: shipping_events has never held a single row since the
// integration went live. Sent only when a full URL could be built — a half-formed
// callback is worse than none, because it looks configured.
export const mapOrderToBostaDeliveryPayload = ({ order = {}, items = [], city = {}, zone = {}, district = {}, codAmount = 0, allowOpenPackage = null, webhookUrl = "" }) => {
  const names = text(order.customer_name || order.full_name || "Online Customer").split(/\s+/);
  const firstName = names.shift() || "Customer";
  const lastName = names.join(" ") || firstName;
  const itemCount = items.reduce((sum, item) => sum + Number(item.quantity || 0), 0) || 1;
  const cityId = text(city.provider_city_id || order.shipping_city_id || order.city_id);
  const zoneId = text(zone.provider_zone_id || order.shipping_zone_id || order.zone_id);
  const districtId = text(district.provider_district_id || order.shipping_district_id || order.district_id || order.area_id);
  const cityCode = text(city.code || city.city_code || cityId);
  const fullAddress = buildBostaAddressLine(order);
  const buildingNumber = text(order.building_number);
  const floor = text(order.floor_number);
  const apartment = text(order.apartment_number);
  return {
    type: 10,
    cod: Math.max(0, Number(codAmount || 0)),
    ...(text(webhookUrl) ? { webHook: text(webhookUrl) } : {}),
    // Bosta keeps its own per-account default for this, so the flag is sent only
    // when the shop has actually decided. Omitting it is not the same as false.
    ...(typeof allowOpenPackage === "boolean" ? { allowToOpenPackage: allowOpenPackage } : {}),
    specs: {
      packageType: "Parcel",
      size: "MEDIUM",
      packageDetails: {
        itemsCount: itemCount,
        description: items.map((item) => item.product_name || item.name).filter(Boolean).slice(0, 4).join(", ") || `Order ${order.id}`,
      },
    },
    notes: text(order.delivery_notes || order.order_notes || order.notes),
    receiver: {
      firstName,
      lastName,
      phone: text(order.customer_phone || order.phone || order.primary_phone),
    },
    dropOffAddress: {
      cityCode,
      cityId,
      zoneId,
      districtId,
      city: text(city.name_en || city.name_ar || order.governorate || order.city_area),
      zone: text(zone.name_en || zone.name_ar || order.zone || order.city_area),
      district: text(district.name_en || district.name_ar || order.district || order.area || order.city_area),
      firstLine: fullAddress,
      secondLine: text(order.landmark),
      ...(buildingNumber ? { buildingNumber } : {}),
      ...(floor ? { floor } : {}),
      ...(apartment ? { apartment } : {}),
    },
    businessReference: text(order.invoice_number || order.public_order_number || order.id),
  };
};
