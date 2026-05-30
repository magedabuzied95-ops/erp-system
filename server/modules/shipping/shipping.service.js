import db from "../../database/db.js";
import { getSetting, setSetting } from "../../services/settingsService.js";
import { createBostaClient } from "./providers/bosta.client.js";
import { buildBostaAddressLine, mapOrderToBostaDeliveryPayload, normalizeBostaDeliveryResponse, normalizeBostaMasterLocations } from "./providers/bosta.mapper.js";

const text = (value = "") => String(value ?? "").trim();
const nowIso = () => new Date().toISOString();
let shippingSchemaEnsured = false;
let shippingSchemaEnsurePromise = null;

const BOSTA_SUBSCRIPTION_REQUIRED_MESSAGE = "Your Bosta account is connected successfully, but shipment creation requires an active Bosta shipping plan or bundle.";

const bostaErrorCode = (payload = {}) => {
  const nestedError = payload?.error && typeof payload.error === "object" ? payload.error : {};
  return text(payload?.errorCode || payload?.code || nestedError?.errorCode || nestedError?.code);
};

const bostaErrorMessage = (payload = {}, fallback = "") => {
  const nestedError = payload?.error && typeof payload.error === "object" ? payload.error : {};
  return text(payload?.message || nestedError?.message || (typeof payload?.error === "string" ? payload.error : "") || fallback);
};

const isBostaSubscriptionRequiredError = (payload = {}, fallbackMessage = "") => {
  const code = bostaErrorCode(payload);
  const message = bostaErrorMessage(payload, fallbackMessage).toLowerCase();
  return code === "8000002" && message.includes("active bundle subscription required");
};

const bostaDeliveryError = (payload = {}, fallbackMessage = "Bosta delivery creation failed", fallbackStatus = 400) => {
  const subscriptionRequired = isBostaSubscriptionRequiredError(payload, fallbackMessage);
  const error = new Error(subscriptionRequired ? BOSTA_SUBSCRIPTION_REQUIRED_MESSAGE : bostaErrorMessage(payload, fallbackMessage));
  error.status = subscriptionRequired ? 409 : fallbackStatus;
  error.code = subscriptionRequired ? "BOSTA_SUBSCRIPTION_REQUIRED" : (bostaErrorCode(payload) || "BOSTA_CREATE_FAILED");
  error.payload = payload;
  return error;
};

export const ensureShippingSchema = async (client = db) => {
  if (shippingSchemaEnsured) return;
  if (shippingSchemaEnsurePromise) {
    await shippingSchemaEnsurePromise;
    return;
  }
  shippingSchemaEnsurePromise = (async () => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS shipping_providers (
      id BIGSERIAL PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      api_base_url TEXT,
      api_key_encrypted TEXT,
      api_key TEXT,
      last_locations_sync_at TIMESTAMP NULL,
      last_locations_sync_counts JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS shipping_cities (
      id BIGSERIAL PRIMARY KEY,
      provider_id BIGINT NOT NULL REFERENCES shipping_providers(id) ON DELETE CASCADE,
      provider_city_id TEXT NOT NULL,
      name_en TEXT NOT NULL,
      name_ar TEXT,
      code TEXT,
      pickup_available BOOLEAN NOT NULL DEFAULT TRUE,
      dropoff_available BOOLEAN NOT NULL DEFAULT TRUE,
      raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(provider_id, provider_city_id)
    )
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS shipping_zones (
      id BIGSERIAL PRIMARY KEY,
      provider_id BIGINT NOT NULL REFERENCES shipping_providers(id) ON DELETE CASCADE,
      city_id BIGINT NOT NULL REFERENCES shipping_cities(id) ON DELETE CASCADE,
      provider_zone_id TEXT NOT NULL,
      name_en TEXT NOT NULL,
      name_ar TEXT,
      pickup_available BOOLEAN NOT NULL DEFAULT TRUE,
      dropoff_available BOOLEAN NOT NULL DEFAULT TRUE,
      raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(provider_id, provider_zone_id)
    )
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS shipping_districts (
      id BIGSERIAL PRIMARY KEY,
      provider_id BIGINT NOT NULL REFERENCES shipping_providers(id) ON DELETE CASCADE,
      city_id BIGINT NOT NULL REFERENCES shipping_cities(id) ON DELETE CASCADE,
      zone_id BIGINT NOT NULL REFERENCES shipping_zones(id) ON DELETE CASCADE,
      provider_district_id TEXT NOT NULL,
      name_en TEXT NOT NULL,
      name_ar TEXT,
      pickup_available BOOLEAN NOT NULL DEFAULT TRUE,
      dropoff_available BOOLEAN NOT NULL DEFAULT TRUE,
      raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(provider_id, provider_district_id)
    )
  `);
  await client.query("CREATE INDEX IF NOT EXISTS idx_shipping_cities_provider_dropoff ON shipping_cities(provider_id, dropoff_available)");
  await client.query("CREATE INDEX IF NOT EXISTS idx_shipping_zones_city_dropoff ON shipping_zones(city_id, dropoff_available)");
  await client.query("CREATE INDEX IF NOT EXISTS idx_shipping_districts_zone_dropoff ON shipping_districts(zone_id, dropoff_available)");
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS shipping_city_id VARCHAR(160)`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS shipping_zone_id VARCHAR(160)`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS shipping_district_id VARCHAR(160)`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS shipping_address_line TEXT`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS street_address TEXT`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS building_number VARCHAR(80)`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS floor_number VARCHAR(80)`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS apartment_number VARCHAR(80)`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS shipping_tracking_number VARCHAR(160)`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS shipping_provider_delivery_id VARCHAR(160)`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS shipping_label_url TEXT`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS shipping_last_synced_at TIMESTAMP NULL`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS last_shipping_sync_at TIMESTAMP NULL`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS shipping_raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS tracking_url TEXT`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS shipment_timeline JSONB NOT NULL DEFAULT '[]'::jsonb`);
  shippingSchemaEnsured = true;
  })().catch((error) => {
    shippingSchemaEnsurePromise = null;
    throw error;
  });
  await shippingSchemaEnsurePromise;
};

export const upsertShippingProvider = async (client, { code, name, is_enabled = false, api_base_url = "", api_key = "" }) => {
  const result = await client.query(
    `
    INSERT INTO shipping_providers (code, name, is_enabled, api_base_url, api_key, updated_at)
    VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
    ON CONFLICT (code) DO UPDATE SET
      name = EXCLUDED.name,
      is_enabled = COALESCE(EXCLUDED.is_enabled, shipping_providers.is_enabled),
      api_base_url = COALESCE(NULLIF(EXCLUDED.api_base_url, ''), shipping_providers.api_base_url),
      api_key = COALESCE(NULLIF(EXCLUDED.api_key, ''), shipping_providers.api_key),
      updated_at = CURRENT_TIMESTAMP
    RETURNING *
    `,
    [code, name, Boolean(is_enabled), api_base_url, api_key]
  );
  return result.rows[0];
};

const getProvider = async (client, code = "bosta") => {
  await ensureShippingSchema(client);
  const result = await client.query("SELECT * FROM shipping_providers WHERE code = $1 LIMIT 1", [code]);
  if (result.rows[0]) return result.rows[0];
  return upsertShippingProvider(client, { code, name: code === "bosta" ? "Bosta" : code, is_enabled: false });
};

export const getBostaSettings = async () => {
  await ensureShippingSchema();
  const provider = await getProvider(db, "bosta");
  const settingsKey = await getSetting("orders.bosta_api_key", "");
  const settingsBaseUrl = await getSetting("orders.bosta_api_base_url", "");
  return {
    enabled: Boolean(provider.is_enabled),
    api_base_url: provider.api_base_url || settingsBaseUrl || process.env.BOSTA_API_BASE_URL || "https://app.bosta.co/api/v2",
    has_api_key: Boolean(provider.api_key || settingsKey || process.env.BOSTA_API_KEY),
    last_locations_sync_at: provider.last_locations_sync_at,
    last_locations_sync_counts: provider.last_locations_sync_counts || {},
  };
};

export const saveBostaSettings = async ({ enabled, apiKey, apiBaseUrl, updatedBy } = {}) => {
  await ensureShippingSchema();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    if (apiKey !== undefined) await setSetting("orders.bosta_api_key", apiKey, "shipping", updatedBy);
    if (apiBaseUrl !== undefined) await setSetting("orders.bosta_api_base_url", apiBaseUrl, "shipping", updatedBy);
    const provider = await upsertShippingProvider(client, {
      code: "bosta",
      name: "Bosta",
      is_enabled: Boolean(enabled),
      api_base_url: text(apiBaseUrl),
      api_key: text(apiKey),
    });
    await client.query("COMMIT");
    const { api_key: _apiKey, api_key_encrypted: _apiKeyEncrypted, ...safeProvider } = provider;
    return { ...safeProvider, has_api_key: Boolean(provider.api_key || apiKey) };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

const bostaConfig = async () => {
  const provider = await getProvider(db, "bosta");
  return {
    apiKey: provider.api_key || (await getSetting("orders.bosta_api_key", "")) || process.env.BOSTA_API_KEY || "",
    apiBaseUrl: provider.api_base_url || (await getSetting("orders.bosta_api_base_url", "")) || process.env.BOSTA_API_BASE_URL || "https://app.bosta.co/api/v2",
  };
};

export const syncBostaLocations = async () => {
  await ensureShippingSchema();
  const config = await bostaConfig();
  const client = createBostaClient(config);
  console.log("[bosta] syncing master locations");
  const payload = await client.getMasterLocations();
  const { cities, skippedInvalidRows } = normalizeBostaMasterLocations(payload);
  const pg = await db.connect();
  const counts = { citiesSynced: 0, zonesSynced: 0, districtsSynced: 0, skippedInvalidRows };
  try {
    await pg.query("BEGIN");
    const provider = await upsertShippingProvider(pg, { code: "bosta", name: "Bosta", is_enabled: true, api_base_url: config.apiBaseUrl, api_key: config.apiKey });
    for (const city of cities) {
      const cityResult = await pg.query(
        `
        INSERT INTO shipping_cities (provider_id, provider_city_id, name_en, name_ar, code, pickup_available, dropoff_available, raw_payload, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,CURRENT_TIMESTAMP)
        ON CONFLICT (provider_id, provider_city_id) DO UPDATE SET
          name_en = EXCLUDED.name_en, name_ar = EXCLUDED.name_ar, code = EXCLUDED.code,
          pickup_available = EXCLUDED.pickup_available, dropoff_available = EXCLUDED.dropoff_available,
          raw_payload = EXCLUDED.raw_payload, updated_at = CURRENT_TIMESTAMP
        RETURNING *
        `,
        [provider.id, city.provider_city_id, city.name_en, city.name_ar, city.code, city.pickup_available, city.dropoff_available, JSON.stringify(city.raw_payload)]
      );
      counts.citiesSynced += 1;
      const cityRow = cityResult.rows[0];
      const zonesByProviderId = new Map();
      for (const district of city.districts) {
        let zoneRow = zonesByProviderId.get(district.provider_zone_id);
        if (!zoneRow) {
          const zoneResult = await pg.query(
            `
            INSERT INTO shipping_zones (provider_id, city_id, provider_zone_id, name_en, name_ar, pickup_available, dropoff_available, raw_payload, updated_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,CURRENT_TIMESTAMP)
            ON CONFLICT (provider_id, provider_zone_id) DO UPDATE SET
              city_id = EXCLUDED.city_id, name_en = EXCLUDED.name_en, name_ar = EXCLUDED.name_ar,
              pickup_available = EXCLUDED.pickup_available, dropoff_available = EXCLUDED.dropoff_available,
              raw_payload = EXCLUDED.raw_payload, updated_at = CURRENT_TIMESTAMP
            RETURNING *
            `,
            [provider.id, cityRow.id, district.provider_zone_id, district.zone_name_en, district.zone_name_ar, district.pickup_available, district.dropoff_available, JSON.stringify(district.raw_payload)]
          );
          zoneRow = zoneResult.rows[0];
          zonesByProviderId.set(district.provider_zone_id, zoneRow);
          counts.zonesSynced += 1;
        }
        await pg.query(
          `
          INSERT INTO shipping_districts (provider_id, city_id, zone_id, provider_district_id, name_en, name_ar, pickup_available, dropoff_available, raw_payload, updated_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,CURRENT_TIMESTAMP)
          ON CONFLICT (provider_id, provider_district_id) DO UPDATE SET
            city_id = EXCLUDED.city_id, zone_id = EXCLUDED.zone_id, name_en = EXCLUDED.name_en, name_ar = EXCLUDED.name_ar,
            pickup_available = EXCLUDED.pickup_available, dropoff_available = EXCLUDED.dropoff_available,
            raw_payload = EXCLUDED.raw_payload, updated_at = CURRENT_TIMESTAMP
          `,
          [provider.id, cityRow.id, zoneRow.id, district.provider_district_id, district.district_name_en, district.district_name_ar, district.pickup_available, district.dropoff_available, JSON.stringify(district.raw_payload)]
        );
        counts.districtsSynced += 1;
      }
    }
    await pg.query(
      "UPDATE shipping_providers SET last_locations_sync_at = CURRENT_TIMESTAMP, last_locations_sync_counts = $2::jsonb, updated_at = CURRENT_TIMESTAMP WHERE id = $1",
      [provider.id, JSON.stringify(counts)]
    );
    await pg.query("COMMIT");
    console.log("[bosta] location sync complete", counts);
    return counts;
  } catch (error) {
    await pg.query("ROLLBACK");
    console.error("[bosta] location sync failed", { message: error.message });
    throw error;
  } finally {
    pg.release();
  }
};

const providerWhere = async (providerCode) => {
  const provider = await getProvider(db, providerCode);
  return provider.id;
};

export const listShippingCities = async ({ provider = "bosta", dropoffOnly = false, pickupOnly = false } = {}) => {
  const providerId = await providerWhere(provider);
  const filters = ["provider_id = $1"];
  if (dropoffOnly) filters.push("dropoff_available IS TRUE");
  if (pickupOnly) filters.push("pickup_available IS TRUE");
  const result = await db.query(`SELECT * FROM shipping_cities WHERE ${filters.join(" AND ")} ORDER BY name_en`, [providerId]);
  return result.rows;
};

export const listShippingZones = async ({ provider = "bosta", cityId, dropoffOnly = false, pickupOnly = false } = {}) => {
  const providerId = await providerWhere(provider);
  const filters = ["provider_id = $1"];
  const params = [providerId];
  if (cityId) {
    params.push(cityId);
    filters.push("city_id = $" + params.length);
  }
  if (dropoffOnly) filters.push("dropoff_available IS TRUE");
  if (pickupOnly) filters.push("pickup_available IS TRUE");
  const result = await db.query(`SELECT * FROM shipping_zones WHERE ${filters.join(" AND ")} ORDER BY name_en`, params);
  return result.rows;
};

export const listShippingDistricts = async ({ provider = "bosta", zoneId, dropoffOnly = false, pickupOnly = false } = {}) => {
  const providerId = await providerWhere(provider);
  const filters = ["provider_id = $1"];
  const params = [providerId];
  if (zoneId) {
    params.push(zoneId);
    filters.push("zone_id = $" + params.length);
  }
  if (dropoffOnly) filters.push("dropoff_available IS TRUE");
  if (pickupOnly) filters.push("pickup_available IS TRUE");
  const result = await db.query(`SELECT * FROM shipping_districts WHERE ${filters.join(" AND ")} ORDER BY name_en`, params);
  return result.rows;
};

export const searchShippingLocations = async ({ provider = "bosta", q = "", limit = 50 } = {}) => {
  const providerId = await providerWhere(provider);
  const pattern = `%${text(q)}%`;
  const result = await db.query(
    `
    SELECT
      c.id AS city_id, c.provider_city_id, c.name_en AS city_name_en, c.name_ar AS city_name_ar, c.code AS city_code,
      z.id AS zone_id, z.provider_zone_id, z.name_en AS zone_name_en, z.name_ar AS zone_name_ar,
      d.id AS district_id, d.provider_district_id, d.name_en AS district_name_en, d.name_ar AS district_name_ar,
      c.pickup_available AS city_pickup_available, c.dropoff_available AS city_dropoff_available,
      z.pickup_available AS zone_pickup_available, z.dropoff_available AS zone_dropoff_available,
      d.pickup_available AS district_pickup_available, d.dropoff_available AS district_dropoff_available
    FROM shipping_districts d
    JOIN shipping_zones z ON z.id = d.zone_id
    JOIN shipping_cities c ON c.id = d.city_id
    WHERE d.provider_id = $1
      AND ($2 = '%%' OR c.name_en ILIKE $2 OR c.name_ar ILIKE $2 OR z.name_en ILIKE $2 OR z.name_ar ILIKE $2 OR d.name_en ILIKE $2 OR d.name_ar ILIKE $2)
    ORDER BY c.name_en, z.name_en, d.name_en
    LIMIT $3
    `,
    [providerId, pattern, Math.max(1, Math.min(Number(limit) || 50, 200))]
  );
  return result.rows;
};

const orderCodAmount = (order = {}) => {
  const total = Number(order.total_amount ?? order.total_price ?? order.total ?? 0);
  const paid = Number(order.paid_amount ?? 0);
  if (String(order.payment_method || order.payment_status || "").toLowerCase().includes("cod")) return Math.max(0, total - paid);
  return Math.max(0, Number(order.cod_amount || 0));
};

const loadOrderShipmentContext = async (client, orderId) => {
  const orderResult = await client.query("SELECT * FROM orders WHERE id = $1 LIMIT 1", [orderId]);
  const order = orderResult.rows[0];
  if (!order) {
    const error = new Error("Order not found");
    error.status = 404;
    throw error;
  }
  const itemsResult = await client.query("SELECT * FROM order_items WHERE order_id = $1 ORDER BY id", [orderId]);
  const cityResult = await client.query("SELECT * FROM shipping_cities WHERE id::text = $1 OR provider_city_id = $1 LIMIT 1", [text(order.shipping_city_id || order.city_id)]);
  const zoneResult = await client.query("SELECT * FROM shipping_zones WHERE id::text = $1 OR provider_zone_id = $1 LIMIT 1", [text(order.shipping_zone_id)]);
  const districtResult = await client.query("SELECT * FROM shipping_districts WHERE id::text = $1 OR provider_district_id = $1 OR id::text = $2 LIMIT 1", [text(order.shipping_district_id || order.area_id), text(order.area_id)]);
  return { order, items: itemsResult.rows, city: cityResult.rows[0], zone: zoneResult.rows[0], district: districtResult.rows[0] };
};

export const createBostaShipmentForOrder = async (orderId) => {
  await ensureShippingSchema();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const context = await loadOrderShipmentContext(client, orderId);
    const { order, items, city, zone, district } = context;
    const missing = [];
    if (!text(order.customer_name)) missing.push("customer name");
    if (!text(order.customer_phone)) missing.push("customer phone");
    if (!city) missing.push("Bosta city");
    if (!zone) missing.push("Bosta zone");
    if (!district) missing.push("Bosta district");
    const fullAddress = buildBostaAddressLine(order);
    if (!fullAddress) missing.push("detailed address");
    if (missing.length) {
      const error = new Error(`Cannot create Bosta shipment. Missing ${missing.join(", ")}`);
      error.status = 400;
      throw error;
    }
    if (fullAddress.length < 12) {
      const error = new Error("Please enter a detailed delivery address before creating a Bosta shipment.");
      error.status = 400;
      error.code = "BOSTA_ADDRESS_TOO_SHORT";
      throw error;
    }

    const config = await bostaConfig();
    const bosta = createBostaClient(config);
    const deliveryPayload = mapOrderToBostaDeliveryPayload({ order, items, city, zone, district, codAmount: orderCodAmount(order) });
    console.log("[bosta-create-payload]", JSON.stringify(deliveryPayload));
    console.log("[bosta] creating delivery", { orderId: order.id, city: city.provider_city_id, zone: zone.provider_zone_id, district: district.provider_district_id });
    let rawBostaResponse;
    try {
      rawBostaResponse = await bosta.createDelivery(deliveryPayload);
      console.log("[bosta-create-response]", JSON.stringify(rawBostaResponse));
    } catch (apiError) {
      const rawErrorPayload = apiError?.payload || { message: apiError?.message, status: apiError?.status };
      console.error("[bosta-create-response]", JSON.stringify(rawErrorPayload));
      throw bostaDeliveryError(
        rawErrorPayload,
        apiError?.message || "Bosta delivery creation failed",
        apiError?.status >= 400 && apiError.status < 500 ? 400 : 502
      );
    }
    const response = normalizeBostaDeliveryResponse(rawBostaResponse);
    if (!response.success) {
      throw bostaDeliveryError(response.raw_response, response.error || "Bosta delivery creation failed", 400);
    }

    const status = response.status || "created";
    const timelineEvent = { at: nowIso(), action: "bosta_create_delivery", provider: "bosta", status, shipment_id: response.shipment_id, tracking_number: response.tracking_number };
    const updateResult = await client.query(
      `
      UPDATE orders SET
        shipping_provider = 'bosta',
        shipping_provider_id = 'bosta',
        shipping_provider_delivery_id = $2,
        shipment_id = $2,
        shipping_tracking_number = $3,
        tracking_number = $3,
        tracking_url = $4,
        shipping_label_url = $5,
        shipping_status = $6,
        shipment_status = $6,
        shipping_last_synced_at = CURRENT_TIMESTAMP,
        last_shipping_sync_at = CURRENT_TIMESTAMP,
        shipping_raw_payload = $7::jsonb,
        shipment_timeline = COALESCE(shipment_timeline, '[]'::jsonb) || $8::jsonb,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING *
      `,
      [order.id, response.shipment_id, response.tracking_number, response.tracking_url, response.label_url, status, JSON.stringify(response.raw_response), JSON.stringify([timelineEvent])]
    );
    await client.query("COMMIT");
    return { ...response, order: updateResult.rows[0] };
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("[bosta] create shipment failed", { orderId, message: error.message });
    throw error;
  } finally {
    client.release();
  }
};

export const refreshBostaShipmentForOrder = async (orderId) => {
  await ensureShippingSchema();
  const orderResult = await db.query("SELECT * FROM orders WHERE id = $1 LIMIT 1", [orderId]);
  const order = orderResult.rows[0];
  if (!order) {
    const error = new Error("Order not found");
    error.status = 404;
    throw error;
  }
  const identifier = order.shipping_provider_delivery_id || order.shipment_id || order.shipping_tracking_number || order.tracking_number;
  if (!identifier) {
    const error = new Error("Order has no Bosta delivery id or tracking number");
    error.status = 400;
    throw error;
  }
  const response = normalizeBostaDeliveryResponse(await createBostaClient(await bostaConfig()).getDeliveryStatus(identifier));
  const status = response.status || order.shipping_status || "created";
  const timelineEvent = { at: nowIso(), action: "bosta_refresh_status", provider: "bosta", status };
  const updated = await db.query(
    `
    UPDATE orders SET
      shipping_status = $2,
      shipment_status = $2,
      tracking_number = COALESCE(NULLIF($3, ''), tracking_number),
      shipping_tracking_number = COALESCE(NULLIF($3, ''), shipping_tracking_number),
      tracking_url = COALESCE(NULLIF($4, ''), tracking_url),
      shipping_last_synced_at = CURRENT_TIMESTAMP,
      shipping_raw_payload = $5::jsonb,
      shipment_timeline = COALESCE(shipment_timeline, '[]'::jsonb) || $6::jsonb,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = $1
    RETURNING *
    `,
    [orderId, status, response.tracking_number, response.tracking_url, JSON.stringify(response.raw_response), JSON.stringify([timelineEvent])]
  );
  return { ...response, order: updated.rows[0] };
};

export const cancelBostaShipmentForOrder = async (orderId) => {
  await ensureShippingSchema();
  const orderResult = await db.query("SELECT * FROM orders WHERE id = $1 LIMIT 1", [orderId]);
  const order = orderResult.rows[0];
  if (!order) {
    const error = new Error("Order not found");
    error.status = 404;
    throw error;
  }
  const identifier = order.shipping_provider_delivery_id || order.shipment_id;
  if (identifier) await createBostaClient(await bostaConfig()).cancelDelivery(identifier);
  const timelineEvent = { at: nowIso(), action: "bosta_cancel_delivery", provider: "bosta", status: "cancelled" };
  const updated = await db.query(
    `
    UPDATE orders SET shipping_status = 'cancelled', shipment_status = 'cancelled',
      shipment_timeline = COALESCE(shipment_timeline, '[]'::jsonb) || $2::jsonb,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = $1 RETURNING *
    `,
    [orderId, JSON.stringify([timelineEvent])]
  );
  return { success: true, provider: "bosta", status: "cancelled", order: updated.rows[0] };
};
