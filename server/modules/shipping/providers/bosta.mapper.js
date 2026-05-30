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
  const errorPayload = payload?.error && typeof payload.error === "object" ? payload.error : {};
  return {
    success: payload?.success !== false && !payload?.errorCode && !errorPayload?.errorCode,
    provider: "bosta",
    shipment_id: text(pick(data, ["_id", "id", "deliveryId", "delivery_id", "shipment_id"])),
    tracking_number: text(pick(data, ["trackingNumber", "tracking_number", "trackingCode", "tracking_code", "trackingNo"])),
    tracking_url: text(pick(data, ["trackingUrl", "tracking_url", "trackingURL"])),
    label_url: text(pick(data, ["labelUrl", "label_url", "airwayBillUrl", "awbUrl"])),
    status: text(pick(data, ["status", "state", "deliveryStatus"])) || "created",
    raw_response: payload,
    error: text(pick(payload, ["message", "errorMessage"])) || text(pick(errorPayload, ["message", "errorMessage", "details"])) || (typeof payload?.error === "string" ? text(payload.error) : ""),
    error_code: text(pick(payload, ["errorCode", "code"])) || text(pick(errorPayload, ["errorCode", "code"])),
  };
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

export const mapOrderToBostaDeliveryPayload = ({ order = {}, items = [], city = {}, zone = {}, district = {}, codAmount = 0 }) => {
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
