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

export const normalizeBostaDeliveryResponse = (payload = {}) => {
  const data = payload?.data && typeof payload.data === "object" ? payload.data : payload;
  return {
    success: payload?.success !== false,
    provider: "bosta",
    shipment_id: text(pick(data, ["_id", "id", "deliveryId", "delivery_id", "shipment_id"])),
    tracking_number: text(pick(data, ["trackingNumber", "tracking_number", "trackingCode", "tracking_code", "trackingNo"])),
    tracking_url: text(pick(data, ["trackingUrl", "tracking_url", "trackingURL"])),
    label_url: text(pick(data, ["labelUrl", "label_url", "airwayBillUrl", "awbUrl"])),
    status: text(pick(data, ["status", "state", "deliveryStatus"])) || "created",
    raw_response: payload,
    error: payload?.error || payload?.message || "",
  };
};

export const mapOrderToBostaDeliveryPayload = ({ order = {}, items = [], city = {}, zone = {}, district = {}, codAmount = 0 }) => {
  const names = text(order.customer_name || order.full_name || "Online Customer").split(/\s+/);
  const firstName = names.shift() || "Customer";
  const lastName = names.join(" ") || firstName;
  const itemCount = items.reduce((sum, item) => sum + Number(item.quantity || 0), 0) || 1;
  return {
    type: 10,
    cod: Math.max(0, Number(codAmount || 0)),
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
      city: { _id: city.provider_city_id, name: city.name_en },
      zone: { _id: zone.provider_zone_id, name: zone.name_en },
      district: { _id: district.provider_district_id, name: district.name_en },
      firstLine: text(order.shipping_address_line || order.customer_address),
      secondLine: text(order.landmark),
    },
    businessReference: text(order.invoice_number || order.public_order_number || order.id),
  };
};
