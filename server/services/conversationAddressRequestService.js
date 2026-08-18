import { randomBytes } from "node:crypto";

import db from "../database/db.js";
import { resolvePublicAppUrl } from "../utils/whatsapp.js";
import { emitToRooms } from "../utils/socket.js";
import { saveCustomerAddress } from "./aiAgentOrderService.js";
import { appendManualAiSupportReply } from "./aiSupportLogService.js";

/* ======================================================
   CUSTOMER ADDRESS-REQUEST LINKS
   ------------------------------------------------------
   The seller sends the customer a one-conversation link; the customer types
   their own shipping address on a public storefront page instead of dictating
   it over chat. The submitted address lands back on the conversation, ready
   for the order composer to pick up.

   A link belongs to a conversation, not to an order: it is issued while the
   order is still being negotiated, before any draft exists.
====================================================== */

const ADDRESS_REQUEST_TTL_HOURS = 72;
const ADDRESS_REQUEST_STATUSES = new Set(["pending", "submitted", "cancelled"]);

const text = (value = "") => String(value ?? "").trim();

let schemaReadyPromise = null;

// Lazy, first-use schema: nothing here runs at boot, so a failed migration can
// never crash-loop the server the way a bootstrapStartup backfill can.
const ensureAddressRequestSchema = () => {
  if (!schemaReadyPromise) {
    schemaReadyPromise = (async () => {
      await db.query(`
        CREATE TABLE IF NOT EXISTS conversation_address_requests (
          id BIGSERIAL PRIMARY KEY,
          tenant_id BIGINT,
          session_id TEXT NOT NULL,
          channel VARCHAR(60) DEFAULT '',
          code VARCHAR(64) NOT NULL,
          status VARCHAR(20) NOT NULL DEFAULT 'pending',
          customer_name VARCHAR(200) DEFAULT '',
          customer_phone VARCHAR(80) DEFAULT '',
          address JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_by BIGINT,
          expires_at TIMESTAMPTZ NOT NULL,
          submitted_at TIMESTAMPTZ,
          submitted_ip VARCHAR(80) DEFAULT '',
          submitted_user_agent TEXT DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS conversation_address_requests_code ON conversation_address_requests (code)`);
      await db.query(`CREATE INDEX IF NOT EXISTS conversation_address_requests_session ON conversation_address_requests (tenant_id, session_id, created_at DESC)`);
    })().catch((error) => {
      schemaReadyPromise = null;
      throw error;
    });
  }
  return schemaReadyPromise;
};

// base64url with the padding stripped: URL-safe, no encoding needed in chat apps.
const generateAddressRequestCode = () => randomBytes(18).toString("base64url").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 24);

export const buildAddressRequestPublicUrl = (code = "") => {
  const safeCode = text(code);
  if (!safeCode) return "";
  const baseUrl = text(resolvePublicAppUrl() || process.env.PUBLIC_APP_URL || process.env.FRONTEND_URL || "").replace(/\/+$/, "");
  return baseUrl ? `${baseUrl}/addr/${encodeURIComponent(safeCode)}` : `/addr/${encodeURIComponent(safeCode)}`;
};

// The link is public: whoever holds it sees the prefill. The name is what the
// seller already typed to the customer; the phone is only ever shown masked.
export const maskPhone = (phone = "") => {
  const digits = text(phone).replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length <= 5) return `${digits.slice(0, 1)}•••`;
  return `${digits.slice(0, 4)}${"•".repeat(Math.max(3, digits.length - 7))}${digits.slice(-3)}`;
};

const rowIsExpired = (row = {}) => {
  const expiresAt = row?.expires_at ? new Date(row.expires_at).getTime() : 0;
  return Boolean(expiresAt) && expiresAt < Date.now();
};

const serializeForStaff = (row = null) => {
  if (!row) return null;
  return {
    id: row.id,
    code: row.code,
    url: buildAddressRequestPublicUrl(row.code),
    status: rowIsExpired(row) && row.status === "pending" ? "expired" : row.status,
    customer_name: row.customer_name || "",
    customer_phone: row.customer_phone || "",
    address: row.address || {},
    expires_at: row.expires_at,
    submitted_at: row.submitted_at,
    created_at: row.created_at,
  };
};

export const createAddressRequest = async ({
  tenantId,
  sessionId,
  channel = "",
  customerName = "",
  customerPhone = "",
  createdBy = null,
} = {}) => {
  await ensureAddressRequestSchema();
  const safeSessionId = text(sessionId);
  if (!safeSessionId) {
    throw Object.assign(new Error("Conversation id is required"), { status: 400, code: "ADDRESS_REQUEST_SESSION_REQUIRED" });
  }
  // One live link per conversation: re-sending reuses the pending code (the
  // customer may already have it) and just extends its life.
  const existing = await db.query(
    `
    SELECT * FROM conversation_address_requests
    WHERE COALESCE(tenant_id, 0) = COALESCE($1::bigint, 0)
      AND session_id = $2
      AND status = 'pending'
      AND expires_at > NOW()
    ORDER BY created_at DESC
    LIMIT 1
    `,
    [tenantId || null, safeSessionId]
  );
  const expiresAt = new Date(Date.now() + ADDRESS_REQUEST_TTL_HOURS * 3600_000);
  if (existing.rows[0]) {
    const refreshed = await db.query(
      `
      UPDATE conversation_address_requests
      SET expires_at = $2,
          customer_name = COALESCE(NULLIF($3, ''), customer_name),
          customer_phone = COALESCE(NULLIF($4, ''), customer_phone),
          updated_at = NOW()
      WHERE id = $1
      RETURNING *
      `,
      [existing.rows[0].id, expiresAt, text(customerName), text(customerPhone)]
    );
    return { ...serializeForStaff(refreshed.rows[0]), reused: true };
  }
  const inserted = await db.query(
    `
    INSERT INTO conversation_address_requests
      (tenant_id, session_id, channel, code, status, customer_name, customer_phone, created_by, expires_at)
    VALUES ($1, $2, $3, $4, 'pending', $5, $6, $7, $8)
    RETURNING *
    `,
    [tenantId || null, safeSessionId, text(channel), generateAddressRequestCode(), text(customerName), text(customerPhone), createdBy || null, expiresAt]
  );
  return { ...serializeForStaff(inserted.rows[0]), reused: false };
};

export const getLatestAddressRequest = async ({ tenantId, sessionId } = {}) => {
  await ensureAddressRequestSchema();
  const safeSessionId = text(sessionId);
  if (!safeSessionId) return null;
  const result = await db.query(
    `
    SELECT * FROM conversation_address_requests
    WHERE COALESCE(tenant_id, 0) = COALESCE($1::bigint, 0)
      AND session_id = $2
    ORDER BY created_at DESC
    LIMIT 1
    `,
    [tenantId || null, safeSessionId]
  );
  return serializeForStaff(result.rows[0] || null);
};

const loadRowByCode = async (code = "") => {
  await ensureAddressRequestSchema();
  const safeCode = text(code);
  if (!safeCode || safeCode.length > 64) {
    throw Object.assign(new Error("رابط العنوان غير صالح."), { status: 404, code: "ADDRESS_REQUEST_NOT_FOUND" });
  }
  const result = await db.query(`SELECT * FROM conversation_address_requests WHERE code = $1 LIMIT 1`, [safeCode]);
  const row = result.rows[0];
  if (!row || !ADDRESS_REQUEST_STATUSES.has(row.status)) {
    throw Object.assign(new Error("رابط العنوان غير صالح أو تم إلغاؤه."), { status: 404, code: "ADDRESS_REQUEST_NOT_FOUND" });
  }
  return row;
};

// What the public page is allowed to see: the prefill and the state — never the
// conversation, never the raw phone.
export const loadPublicAddressRequest = async (code = "") => {
  const row = await loadRowByCode(code);
  if (row.status === "pending" && rowIsExpired(row)) {
    throw Object.assign(new Error("انتهت صلاحية هذا الرابط. اطلب من فريق المتجر رابطًا جديدًا."), { status: 410, code: "ADDRESS_REQUEST_EXPIRED" });
  }
  return {
    status: row.status,
    customer_name: row.customer_name || "",
    customer_phone_masked: maskPhone(row.customer_phone),
    has_phone: Boolean(text(row.customer_phone)),
    expires_at: row.expires_at,
    submitted_at: row.submitted_at,
    address: row.status === "submitted" ? row.address || {} : {},
  };
};

// The ids arrive from an anonymous browser: prove the district really sits in
// the claimed zone and city before anything downstream trusts them for a
// Bosta shipment.
const validateBostaHierarchy = async ({ cityId, zoneId, districtId }) => {
  const result = await db.query(
    `
    SELECT d.id AS district_id, z.id AS zone_id, c.id AS city_id,
           COALESCE(NULLIF(c.name_ar, ''), c.name_en) AS city_label,
           COALESCE(NULLIF(z.name_ar, ''), z.name_en) AS zone_label,
           COALESCE(NULLIF(d.name_ar, ''), d.name_en) AS district_label
    FROM shipping_districts d
    JOIN shipping_zones z ON z.id = d.zone_id
    JOIN shipping_cities c ON c.id = d.city_id
    WHERE d.id::text = $1 AND z.id::text = $2 AND c.id::text = $3
      AND d.dropoff_available IS TRUE
    LIMIT 1
    `,
    [text(districtId), text(zoneId), text(cityId)]
  );
  if (!result.rows[0]) {
    throw Object.assign(new Error("اختيار المنطقة غير صحيح — اختر المدينة والمنطقة والحي من القائمة."), {
      status: 422,
      code: "ADDRESS_REQUEST_LOCATION_INVALID",
    });
  }
  return result.rows[0];
};

export const submitPublicAddressRequest = async ({ code = "", payload = {}, ipAddress = "", userAgent = "" } = {}) => {
  const row = await loadRowByCode(code);
  if (row.status === "submitted") {
    // Idempotent for the customer: reopening after a double-tap shows the
    // summary instead of an error.
    return { already_submitted: true, ...(await loadPublicAddressRequest(code)) };
  }
  if (row.status !== "pending" || rowIsExpired(row)) {
    throw Object.assign(new Error("انتهت صلاحية هذا الرابط. اطلب من فريق المتجر رابطًا جديدًا."), { status: 410, code: "ADDRESS_REQUEST_EXPIRED" });
  }

  const streetAddress = text(payload.street_address);
  const buildingNumber = text(payload.building_number);
  if (!streetAddress || !buildingNumber) {
    throw Object.assign(new Error("اسم الشارع ورقم المبنى مطلوبان."), { status: 422, code: "ADDRESS_REQUEST_FIELDS_REQUIRED" });
  }
  const location = await validateBostaHierarchy({
    cityId: payload.shipping_city_id,
    zoneId: payload.shipping_zone_id,
    districtId: payload.shipping_district_id,
  });

  const customerName = text(payload.customer_name).slice(0, 200) || row.customer_name;
  // The customer may correct the number; absent that, the conversation's
  // number stands. Nothing on the public page ever echoes the stored one.
  const submittedPhone = text(payload.customer_phone).replace(/[^\d+]/g, "").slice(0, 20);
  const customerPhone = submittedPhone || row.customer_phone;

  const address = {
    shipping_provider: "bosta",
    shipping_city_id: text(payload.shipping_city_id),
    shipping_zone_id: text(payload.shipping_zone_id),
    shipping_district_id: text(payload.shipping_district_id),
    governorate: location.city_label || "",
    city_area: location.district_label || location.zone_label || "",
    street_address: streetAddress.slice(0, 500),
    building_number: buildingNumber.slice(0, 60),
    floor_number: text(payload.floor_number).slice(0, 60),
    apartment_number: text(payload.apartment_number).slice(0, 60),
    landmark: text(payload.landmark).slice(0, 200),
  };

  const updated = await db.query(
    `
    UPDATE conversation_address_requests
    SET status = 'submitted',
        customer_name = $2,
        customer_phone = $3,
        address = $4::jsonb,
        submitted_at = NOW(),
        submitted_ip = $5,
        submitted_user_agent = $6,
        updated_at = NOW()
    WHERE id = $1 AND status = 'pending'
    RETURNING *
    `,
    [row.id, customerName, customerPhone, JSON.stringify(address), text(ipAddress).slice(0, 80), text(userAgent).slice(0, 500)]
  );
  if (!updated.rows[0]) {
    // Lost the race against another submit of the same link — treat as done.
    return { already_submitted: true, ...(await loadPublicAddressRequest(code)) };
  }

  // Remember it phone-keyed too, so "عناويني" offers it in every future order.
  // Never blocks the submit.
  try {
    await saveCustomerAddress({ tenantId: row.tenant_id, phone: customerPhone, customerName, address });
  } catch (error) {
    console.warn("[address-request] saved-address write failed", { message: error?.message });
  }

  // Surface it inside the conversation thread so whoever is chatting sees it
  // land, even with the composer closed.
  try {
    await appendManualAiSupportReply({
      tenantId: row.tenant_id,
      sessionId: row.session_id,
      message: `📍 العميل أرسل عنوانه من رابط العنوان:\n${[address.governorate, address.city_area, address.street_address, `مبنى ${address.building_number}`].filter(Boolean).join(" — ")}`,
      source: "address_request_link",
      upsertSession: false,
    });
  } catch (error) {
    console.warn("[address-request] thread note failed", { message: error?.message });
  }

  try {
    emitToRooms([`tenant:${row.tenant_id}`], "ai_inbox:refresh", {
      tenant_id: row.tenant_id,
      session_id: row.session_id,
      channel: row.channel || "",
      reason: "customer_address_submitted",
      at: new Date().toISOString(),
    });
  } catch (error) {
    console.warn("[address-request] socket emit failed", { message: error?.message });
  }

  console.info("[address-request] submitted", {
    tenant_id: row.tenant_id,
    session_id: row.session_id,
    request_id: row.id,
    city_id: address.shipping_city_id,
    district_id: address.shipping_district_id,
  });

  return { already_submitted: false, ...(await loadPublicAddressRequest(code)) };
};
