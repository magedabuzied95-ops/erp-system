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
      /*
       * The sales flow the link was issued FOR, kept beside the link itself.
       *
       * The conversation's sales_flow lives in an in-process Map, so a deploy between the moment
       * the customer receives the link and the moment they submit it wipes the flow — and the
       * submit then finds nothing waiting for an address and creates no order, silently. That is
       * not hypothetical: it happened twice during one afternoon of testing. This row already
       * spans exactly that gap, so the snapshot rides along with it.
       */
      await db.query(`ALTER TABLE IF EXISTS conversation_address_requests ADD COLUMN IF NOT EXISTS sales_flow JSONB`);
      await db.query(`CREATE INDEX IF NOT EXISTS conversation_address_requests_session ON conversation_address_requests (tenant_id, session_id, created_at DESC)`);
      // One pending link per conversation, enforced by the database. Rapid taps
      // during the slow first rollout raced SELECT-then-INSERT into several
      // pending codes for one conversation, and every code the customer opened
      // accepted a submit — hence the duplicated thread notes. Demote the
      // strays first or the unique index can never build.
      await db.query(`
        UPDATE conversation_address_requests
        SET status = 'cancelled', updated_at = NOW()
        WHERE status = 'pending'
          AND id NOT IN (
            SELECT MAX(id)
            FROM conversation_address_requests
            WHERE status = 'pending'
            GROUP BY COALESCE(tenant_id, 0), session_id
          )
      `);
      await db.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS conversation_address_requests_one_pending
        ON conversation_address_requests (COALESCE(tenant_id, 0), session_id)
        WHERE status = 'pending'
      `);
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

// An Egyptian mobile as the customer typed it ("+20 10…", "0020…", Arabic-Indic digits) → "01xxxxxxxxx",
// or "" when it is not one.
export const localEgyptMobile = (value = "") => {
  let digits = text(value)
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06F0))
    .replace(/\D/g, "");
  if (digits.startsWith("0020")) digits = digits.slice(4);
  else if (digits.startsWith("20") && digits.length === 12) digits = digits.slice(2);
  if (digits.length === 10 && digits.startsWith("1")) digits = `0${digits}`;
  return /^01[0125][0-9]{8}$/.test(digits) ? digits : "";
};

// Messenger, Instagram and TikTok know a customer by a page-scoped id (15-17 digits), and the inbox
// hands that id around as "customer_phone". It is no number anyone can call: stored here it showed on
// the page as the customer's masked number and went on the order. Off WhatsApp only a real Egyptian
// mobile counts; a WhatsApp thread keeps what it has, since its id IS the number (foreign ones too).
export const addressRequestPhone = (value = "", channel = "") => {
  const local = localEgyptMobile(value);
  if (local) return local;
  return /whatsapp/i.test(text(channel)) ? text(value).replace(/[^\d+]/g, "").slice(0, 20) : "";
};

// The same rule as the website checkout: the order confirmation and every update after it are
// WhatsApp messages, so a main number with no WhatsApp means a customer we can never reach. Only a
// definite "no" blocks; an unreachable gateway lets the order through.
// STOREFRONT_CHECKOUT_WHATSAPP_CHECK=false turns it off here too.
const mainPhoneHasWhatsapp = async (phone = "") => {
  if (String(process.env.STOREFRONT_CHECKOUT_WHATSAPP_CHECK || "").trim().toLowerCase() === "false") return null;
  const local = localEgyptMobile(phone);
  if (!local) return null;
  try {
    const { whatsappNumberIsReachable } = await import("./whatsappCapabilitiesService.js");
    const result = await whatsappNumberIsReachable({ phone: local });
    return result?.known ? result.reachable === true : null;
  } catch (error) {
    console.warn("[address-request] whatsapp check skipped", { message: error?.message || String(error) });
    return null;
  }
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
    customer_phone: addressRequestPhone(row.customer_phone, row.channel),
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
  // The variant this link is being issued for. Stored so the submit can still build the order
  // after a restart has emptied the in-process conversation memory.
  salesFlow = null,
} = {}) => {
  await ensureAddressRequestSchema();
  const safeSessionId = text(sessionId);
  const storedPhone = addressRequestPhone(customerPhone, channel);
  if (!safeSessionId) {
    throw Object.assign(new Error("Conversation id is required"), { status: 400, code: "ADDRESS_REQUEST_SESSION_REQUIRED" });
  }
  // One live link per conversation: re-sending reuses the pending code (the
  // customer may already have it) and just extends its life. An expired
  // pending row is reused too — same URL, new lease — because the partial
  // unique index below admits only one pending row either way.
  const expiresAt = new Date(Date.now() + ADDRESS_REQUEST_TTL_HOURS * 3600_000);
  // NULL leaves whatever snapshot is already there rather than erasing it: a seller re-sending the
  // link must not wipe the variant the flow recorded.
  const salesFlowJson = salesFlow && typeof salesFlow === "object" && Object.keys(salesFlow).length
    ? JSON.stringify(salesFlow)
    : null;
  const reusePending = async () => {
    const refreshed = await db.query(
      `
      UPDATE conversation_address_requests
      SET expires_at = $3,
          customer_name = COALESCE(NULLIF($4, ''), customer_name),
          customer_phone = COALESCE(NULLIF($5, ''), customer_phone),
          sales_flow = COALESCE($6::jsonb, sales_flow),
          updated_at = NOW()
      WHERE id = (
        SELECT id FROM conversation_address_requests
        WHERE COALESCE(tenant_id, 0) = COALESCE($1::bigint, 0)
          AND session_id = $2
          AND status = 'pending'
        ORDER BY created_at DESC
        LIMIT 1
      )
      RETURNING *
      `,
      [tenantId || null, safeSessionId, expiresAt, text(customerName), storedPhone, salesFlowJson]
    );
    return refreshed.rows[0] || null;
  };
  const reused = await reusePending();
  if (reused) return { ...serializeForStaff(reused), reused: true };
  try {
    const inserted = await db.query(
      `
      INSERT INTO conversation_address_requests
        (tenant_id, session_id, channel, code, status, customer_name, customer_phone, created_by, expires_at, sales_flow)
      VALUES ($1, $2, $3, $4, 'pending', $5, $6, $7, $8, $9::jsonb)
      RETURNING *
      `,
      [tenantId || null, safeSessionId, text(channel), generateAddressRequestCode(), text(customerName), storedPhone, createdBy || null, expiresAt, salesFlowJson]
    );
    return { ...serializeForStaff(inserted.rows[0]), reused: false };
  } catch (error) {
    // Unique-index collision: a concurrent create won the race. Their pending
    // row is the conversation's one true link — hand it back.
    if (String(error?.code) === "23505") {
      const winner = await reusePending();
      if (winner) return { ...serializeForStaff(winner), reused: true };
    }
    throw error;
  }
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
    // A pending link minted before addressRequestPhone may still hold a Meta id.
    customer_phone_masked: maskPhone(addressRequestPhone(row.customer_phone, row.channel)),
    has_phone: Boolean(addressRequestPhone(row.customer_phone, row.channel)),
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
  const customerPhone = submittedPhone || addressRequestPhone(row.customer_phone, row.channel);
  // A Messenger/Instagram customer has no number until they type one here, and an order with none
  // can be neither confirmed on WhatsApp nor handed to Bosta.
  if (!customerPhone) {
    throw Object.assign(new Error("اكتب رقم موبايلك اللي عليه واتساب."), {
      status: 422,
      code: "ADDRESS_REQUEST_PHONE_REQUIRED",
      field: "customer_phone",
    });
  }
  if (await mainPhoneHasWhatsapp(customerPhone) === false) {
    throw Object.assign(new Error("الرقم ده مش عليه واتساب. اكتب رقم عليه واتساب علشان نقدر نأكدلك الطلب."), {
      status: 422,
      code: "ADDRESS_REQUEST_NOT_ON_WHATSAPP",
      field: "customer_phone",
    });
  }
  // A second number for the courier (Bosta's receiver.secondPhone), optional. Kept only when it is a
  // real Egyptian mobile and not the main number again.
  const secondaryPhone = localEgyptMobile(payload.secondary_phone);
  const secondaryPhoneKept = secondaryPhone && secondaryPhone !== localEgyptMobile(customerPhone) ? secondaryPhone : "";

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
    ...(secondaryPhoneKept ? { secondary_phone: secondaryPhoneKept } : {}),
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
      // Keyed to the request row: the transcript layer dedupes on this, so no
      // retry or race can ever put this note in the thread twice.
      idempotencyKey: `address-request-note:${row.id}`,
      clientRequestId: `address-request-note:${row.id}`,
      upsertSession: false,
    });
  } catch (error) {
    console.warn("[address-request] thread note failed", { message: error?.message });
  }

  // A Messenger sales flow that is waiting on this address has nothing left to ask: the submit
  // is the last step, so the order registers now and the customer gets the confirmation in the
  // chat without going back to type anything. Failure-isolated on purpose — an order that cannot
  // be created must never cost the customer the address they just filled in.
  try {
    const { completeSocialCommentOrderFromAddressRequest } = await import("./metaIntegrationService.js");
    await completeSocialCommentOrderFromAddressRequest({
      tenantId: row.tenant_id,
      sessionId: row.session_id,
      address,
      customerName,
      customerPhone,
      // The flow as it stood when the link went out. The live conversation memory is preferred,
      // but it does not survive a restart — and the customer may fill this in hours later.
      salesFlowSnapshot: row.sales_flow && typeof row.sales_flow === "object" ? row.sales_flow : null,
    });
  } catch (error) {
    console.warn("[address-request] social comment order completion failed", {
      session_id: row.session_id,
      message: error?.message || String(error),
    });
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

/*
 * A returning customer's last address, offered back the moment they type their number (owner,
 * 2026-10-18).
 *
 * The page is public: if any number returned its owner's address, anyone holding a link could read
 * a stranger's home by typing their phone. So the lookup is scoped to THIS conversation — the same
 * Messenger/Instagram/WhatsApp account that is holding the link — and the number must match what
 * that account used before: an address it submitted through an earlier link, or an order it placed.
 * A number never used from this account finds nothing.
 */
const sameMobile = (a = "", b = "") => {
  const left = localEgyptMobile(a);
  return Boolean(left) && left === localEgyptMobile(b);
};

export const lookupReturningCustomerAddress = async ({ code = "", phone = "" } = {}) => {
  const row = await loadRowByCode(code);
  if (row.status !== "pending" || rowIsExpired(row)) return { found: false };
  // No number typed: the one the conversation already holds (a WhatsApp link carries it, and the
  // page only ever shows it masked), so a returning WhatsApp customer is filled in on open.
  const local = localEgyptMobile(phone) || localEgyptMobile(row.customer_phone);
  if (!local) return { found: false };

  let source = null;
  const earlierLinks = await db.query(
    `
    SELECT customer_name, customer_phone, address
    FROM conversation_address_requests
    WHERE COALESCE(tenant_id, 0) = COALESCE($1::bigint, 0)
      AND session_id = $2
      AND status = 'submitted'
      AND id <> $3
    ORDER BY submitted_at DESC NULLS LAST
    LIMIT 10
    `,
    [row.tenant_id || null, row.session_id, row.id]
  ).catch(() => ({ rows: [] }));
  const link = earlierLinks.rows.find((item) => sameMobile(item.customer_phone, local));
  if (link) {
    const address = link.address && typeof link.address === "object" ? link.address : {};
    source = {
      customer_name: link.customer_name,
      secondary_phone: address.secondary_phone,
      city_id: address.shipping_city_id,
      zone_id: address.shipping_zone_id,
      district_id: address.shipping_district_id,
      street_address: address.street_address,
      building_number: address.building_number,
      floor_number: address.floor_number,
      apartment_number: address.apartment_number,
      landmark: address.landmark,
    };
  }
  if (!source) {
    const orders = await db.query(
      `
      SELECT customer_name, customer_phone, customer_secondary_phone,
             shipping_city_id, shipping_zone_id, shipping_district_id,
             street_address, building_number, floor_number, apartment_number, landmark
      FROM orders
      WHERE ai_agent_conversation_id = $1
        AND ($2::bigint IS NULL OR tenant_id = $2::bigint)
        AND COALESCE(shipping_district_id::text, '') <> ''
      ORDER BY created_at DESC
      LIMIT 10
      `,
      [row.session_id, row.tenant_id || null]
    ).catch(() => ({ rows: [] }));
    const order = orders.rows.find((item) => sameMobile(item.customer_phone, local));
    if (order) {
      source = {
        customer_name: order.customer_name,
        secondary_phone: order.customer_secondary_phone,
        city_id: order.shipping_city_id,
        zone_id: order.shipping_zone_id,
        district_id: order.shipping_district_id,
        street_address: order.street_address,
        building_number: order.building_number,
        floor_number: order.floor_number,
        apartment_number: order.apartment_number,
        landmark: order.landmark,
      };
    }
  }
  if (!source) return { found: false };

  // The ids must still be a live Bosta location, and the page needs their names to show the pick.
  const location = await validateBostaHierarchy({
    cityId: source.city_id,
    zoneId: source.zone_id,
    districtId: source.district_id,
  }).catch(() => null);
  return {
    found: true,
    customer_name: text(source.customer_name),
    secondary_phone: localEgyptMobile(source.secondary_phone),
    location: location
      ? {
          city_id: text(location.city_id),
          zone_id: text(location.zone_id),
          district_id: text(location.district_id),
          label: [location.city_label, location.zone_label, location.district_label !== location.zone_label ? location.district_label : ""]
            .filter(Boolean)
            .join(" — "),
        }
      : null,
    street_address: text(source.street_address),
    building_number: text(source.building_number),
    floor_number: text(source.floor_number),
    apartment_number: text(source.apartment_number),
    landmark: text(source.landmark),
  };
};
