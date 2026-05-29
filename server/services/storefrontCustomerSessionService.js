import crypto from "node:crypto";
import db from "../database/db.js";
import { ensureLoyaltySchema, getCustomerLoyaltySummary } from "./loyaltyService.js";
import { getPhoneSearchVariants, normalizePhone, phoneSqlDigits } from "../utils/phoneSearch.js";

const SESSION_TTL_DAYS = 180;
const TOKEN_BYTES = 32;

const toText = (value = "") => String(value ?? "").trim();
const jsonValue = (value) => JSON.stringify(value === undefined ? null : value);
const nowIso = () => new Date().toISOString();
const phoneDebug = (value = "") => {
  const digits = String(value || "").replace(/\D/g, "");
  return { phone_length: digits.length, phone_suffix: digits.slice(-4) };
};
const debugSession = (event, payload = {}) => {
  console.log(`[storefront-customer-session] ${event}`, payload);
};
const EASTERN_DIGITS = {
  "٠": "0",
  "١": "1",
  "٢": "2",
  "٣": "3",
  "٤": "4",
  "٥": "5",
  "٦": "6",
  "٧": "7",
  "٨": "8",
  "٩": "9",
  "۰": "0",
  "۱": "1",
  "۲": "2",
  "۳": "3",
  "۴": "4",
  "۵": "5",
  "۶": "6",
  "۷": "7",
  "۸": "8",
  "۹": "9",
};

const normalizeDigits = (value = "") => String(value || "").replace(/[٠-٩۰-۹]/g, (digit) => EASTERN_DIGITS[digit] || digit);

export const normalizeEgyptianMobile = (value = "") => {
  const raw = normalizePhone(normalizeDigits(value));
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("20") && digits.length === 12) return `0${digits.slice(2)}`;
  if (digits.startsWith("1") && digits.length === 10) return `0${digits}`;
  if (digits.startsWith("01") && digits.length === 11) return digits;
  return digits.startsWith("0") ? digits : raw;
};

export const isValidEgyptianMobile = (value = "") => /^01[0125]\d{8}$/.test(normalizeEgyptianMobile(value));

const publicCustomer = (customer = {}, loyalty = null) => ({
  name: customer.name || "",
  phone: customer.phone || "",
  loyalty: loyalty || {
    loyalty_points: Number(customer.loyalty_points || 0),
    loyalty_tier: customer.loyalty_tier || "Bronze",
    wallet_balance: Number(customer.wallet_balance || 0),
  },
  storefront: {
    identified: true,
    first_visit_at: customer.first_visit_at || null,
    last_visit_at: customer.last_visit_at || null,
    storefront_last_seen_at: customer.storefront_last_seen_at || null,
    registration_source: customer.registration_source || "",
  },
});

export const ensureStorefrontCustomerSessionSchema = async (clientOrPool = db) => {
  await clientOrPool.query(`
    CREATE TABLE IF NOT EXISTS customers (
      id BIGSERIAL PRIMARY KEY,
      tenant_id BIGINT,
      branch_id BIGINT NULL,
      name VARCHAR(255) NOT NULL DEFAULT '',
      phone VARCHAR(50),
      email VARCHAR(255),
      address TEXT,
      status VARCHAR(50) NOT NULL DEFAULT 'active',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      loyalty_points NUMERIC(12,2) NOT NULL DEFAULT 0,
      loyalty_tier VARCHAR(50) NOT NULL DEFAULT 'Bronze',
      wallet_balance NUMERIC(12,2) NOT NULL DEFAULT 0,
      total_spent NUMERIC(12,2) NOT NULL DEFAULT 0,
      total_orders INTEGER NOT NULL DEFAULT 0
    )
  `);
  await clientOrPool.query(`ALTER TABLE IF EXISTS customers ADD COLUMN IF NOT EXISTS tenant_id BIGINT`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS customers ADD COLUMN IF NOT EXISTS branch_id BIGINT NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS customers ADD COLUMN IF NOT EXISTS name VARCHAR(255) NOT NULL DEFAULT ''`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS customers ADD COLUMN IF NOT EXISTS phone VARCHAR(50)`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS customers ADD COLUMN IF NOT EXISTS status VARCHAR(50) NOT NULL DEFAULT 'active'`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS customers ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS customers ADD COLUMN IF NOT EXISTS loyalty_points NUMERIC(12,2) NOT NULL DEFAULT 0`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS customers ADD COLUMN IF NOT EXISTS loyalty_tier VARCHAR(50) NOT NULL DEFAULT 'Bronze'`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS customers ADD COLUMN IF NOT EXISTS wallet_balance NUMERIC(12,2) NOT NULL DEFAULT 0`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS customers ADD COLUMN IF NOT EXISTS total_spent NUMERIC(12,2) NOT NULL DEFAULT 0`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS customers ADD COLUMN IF NOT EXISTS total_orders INTEGER NOT NULL DEFAULT 0`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS customers ADD COLUMN IF NOT EXISTS loyalty_updated_at TIMESTAMP NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS customers ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS customers ADD COLUMN IF NOT EXISTS registration_source VARCHAR(80) NOT NULL DEFAULT ''`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS customers ADD COLUMN IF NOT EXISTS first_visit_at TIMESTAMP NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS customers ADD COLUMN IF NOT EXISTS last_visit_at TIMESTAMP NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS customers ADD COLUMN IF NOT EXISTS storefront_last_seen_at TIMESTAMP NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS customers ADD COLUMN IF NOT EXISTS is_storefront_customer BOOLEAN NOT NULL DEFAULT FALSE`);
  await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_customers_storefront_phone ON customers (tenant_id, phone)`);

  await clientOrPool.query(`
    CREATE TABLE IF NOT EXISTS storefront_customer_sessions (
      id BIGSERIAL PRIMARY KEY,
      tenant_id BIGINT NOT NULL,
      customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      cart_items JSONB NOT NULL DEFAULT '[]'::jsonb,
      wishlist_items JSONB NOT NULL DEFAULT '[]'::jsonb,
      addresses JSONB NOT NULL DEFAULT '[]'::jsonb,
      user_agent TEXT NOT NULL DEFAULT '',
      ip_address TEXT NOT NULL DEFAULT '',
      last_seen_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at TIMESTAMP NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_storefront_customer_sessions_customer ON storefront_customer_sessions (tenant_id, customer_id, updated_at DESC)`);

  await clientOrPool.query(`
    CREATE TABLE IF NOT EXISTS storefront_customer_events (
      id BIGSERIAL PRIMARY KEY,
      tenant_id BIGINT NOT NULL,
      customer_id BIGINT NULL REFERENCES customers(id) ON DELETE SET NULL,
      event_type VARCHAR(80) NOT NULL,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_storefront_customer_events_tenant_type ON storefront_customer_events (tenant_id, event_type, created_at DESC)`);
};

const tokenHash = (token = "") => crypto.createHash("sha256").update(String(token)).digest("hex");
const createToken = () => crypto.randomBytes(TOKEN_BYTES).toString("base64url");

export const readStorefrontCustomerToken = (req = {}) => {
  const headerToken = toText(req.headers?.["x-storefront-customer-token"]);
  if (headerToken) return headerToken;
  const cookie = toText(req.headers?.cookie);
  const match = cookie.match(/(?:^|;\s*)sf_customer_session=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : "";
};

export const setStorefrontCustomerCookie = (res, token, req = {}) => {
  const maxAge = SESSION_TTL_DAYS * 24 * 60 * 60;
  const isSecureRequest =
    Boolean(req.secure) ||
    String(req.headers?.["x-forwarded-proto"] || "").split(",")[0].trim() === "https" ||
    String(req.headers?.origin || "").startsWith("https://");
  const sameSite = isSecureRequest ? "None" : "Lax";
  res.setHeader(
    "Set-Cookie",
    `sf_customer_session=${encodeURIComponent(token)}; Max-Age=${maxAge}; Path=/; SameSite=${sameSite}; HttpOnly${isSecureRequest ? "; Secure" : ""}`
  );
};

const trackEvent = async (client, { tenantId, customerId = null, eventType, metadata = {} }) => {
  await client.query(
    `
    INSERT INTO storefront_customer_events (tenant_id, customer_id, event_type, metadata)
    VALUES ($1, $2, $3, $4::jsonb)
    `,
    [tenantId, customerId, eventType, jsonValue(metadata)]
  );
};

const findCustomerByPhone = async (client, { tenantId, phone }) => {
  const variants = getPhoneSearchVariants(normalizeDigits(phone));
  if (!variants.length) return null;
  const result = await client.query(
    `
    SELECT *
    FROM customers
    WHERE tenant_id = $1
      AND ${phoneSqlDigits("phone")} = ANY($2::text[])
    ORDER BY updated_at DESC NULLS LAST, id DESC
    LIMIT 1
    FOR UPDATE
    `,
    [tenantId, variants]
  );
  return result.rows[0] || null;
};

const getCustomerColumns = async (client) => {
  const result = await client.query(
    `
    SELECT column_name, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'customers'
    `
  );
  return new Map(result.rows.map((row) => [row.column_name, row]));
};

const columnNeedsExplicitValue = (columns, columnName) => {
  const column = columns.get(columnName);
  return Boolean(column && column.is_nullable === "NO" && !column.column_default);
};

const tableExists = async (client, tableName) => {
  const result = await client.query(
    `
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = current_schema()
        AND table_name = $1
    ) AS exists
    `,
    [tableName]
  );
  return Boolean(result.rows[0]?.exists);
};

const resolveDefaultBranchId = async (client, { tenantId }) => {
  if (!(await tableExists(client, "branches"))) return null;
  const branchColumns = await client.query(
    `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'branches'
    `
  );
  const names = new Set(branchColumns.rows.map((row) => row.column_name));
  const where = names.has("tenant_id") ? "WHERE tenant_id = $1 OR tenant_id IS NULL" : "";
  const tenantSort = names.has("tenant_id") ? "CASE WHEN tenant_id = $1 THEN 0 ELSE 1 END," : "";
  const activeSort = names.has("is_active") ? "COALESCE(is_active, TRUE) DESC," : "";
  const result = await client.query(
    `
    SELECT id
    FROM branches
    ${where}
    ORDER BY ${tenantSort} ${activeSort} id ASC
    LIMIT 1
    `,
    names.has("tenant_id") ? [tenantId] : []
  );
  return result.rows[0]?.id || null;
};

const insertStorefrontCustomer = async (client, { tenantId, name, normalizedPhone }) => {
  const columns = await getCustomerColumns(client);
  const insertColumns = [];
  const insertValues = [];
  const params = [];
  const addParam = (columnName, value) => {
    if (!columns.has(columnName)) return;
    insertColumns.push(columnName);
    params.push(value);
    insertValues.push(`$${params.length}`);
  };
  const addSql = (columnName, sqlValue) => {
    if (!columns.has(columnName)) return;
    insertColumns.push(columnName);
    insertValues.push(sqlValue);
  };

  addParam("tenant_id", tenantId);
  addParam("name", toText(name).slice(0, 120) || "Storefront Customer");
  addParam("phone", normalizedPhone);
  addParam("status", "active");
  addParam("registration_source", "storefront");
  addSql("created_at", "CURRENT_TIMESTAMP");
  addSql("updated_at", "CURRENT_TIMESTAMP");
  addSql("first_visit_at", "CURRENT_TIMESTAMP");
  addSql("last_visit_at", "CURRENT_TIMESTAMP");
  addSql("storefront_last_seen_at", "CURRENT_TIMESTAMP");
  addParam("is_storefront_customer", true);
  addParam("loyalty_points", 0);
  addParam("loyalty_tier", "Bronze");
  addParam("wallet_balance", 0);
  addParam("total_spent", 0);
  addParam("total_orders", 0);

  if (columns.has("branch_id")) {
    const branchId = await resolveDefaultBranchId(client, { tenantId });
    if (branchId || columnNeedsExplicitValue(columns, "branch_id")) {
      if (!branchId && columnNeedsExplicitValue(columns, "branch_id")) {
        const error = new Error("CUSTOMER_BRANCH_REQUIRED");
        error.status = 500;
        error.publicCode = "customer_branch_required";
        error.queryLocation = "storefront_customer.insert.branch_id";
        error.detail = "customers.branch_id is required but no default branch exists";
        throw error;
      }
      addParam("branch_id", branchId);
    }
  }

  for (const [columnName, column] of columns.entries()) {
    if (["id"].includes(columnName) || insertColumns.includes(columnName)) continue;
    if (column.is_nullable === "NO" && !column.column_default) {
      const error = new Error("CUSTOMER_REQUIRED_COLUMN_UNSUPPORTED");
      error.status = 500;
      error.publicCode = "customer_required_column_unsupported";
      error.queryLocation = `storefront_customer.insert.${columnName}`;
      error.detail = `customers.${columnName} is required and has no default`;
      throw error;
    }
  }

  debugSession("insert payload", {
    location: "storefront_customer.insert",
    insert_payload_keys: insertColumns,
  });

  try {
    const created = await client.query(
      `
      INSERT INTO customers (${insertColumns.join(", ")})
      VALUES (${insertValues.join(", ")})
      RETURNING *
      `,
      params
    );
    return created.rows[0];
  } catch (error) {
    error.queryLocation ||= "storefront_customer.insert";
    error.insertPayloadKeys = insertColumns;
    throw error;
  }
};

const ensureCustomerLoyaltyAccount = async (client, { tenantId, customerId }) => {
  await ensureLoyaltySchema(client);
  await client.query(
    `
    INSERT INTO customer_loyalty (tenant_id, customer_id, tier, total_points_earned, available_points, lifetime_points)
    VALUES ($1, $2, 'Bronze', 0, 0, 0)
    ON CONFLICT DO NOTHING
    `,
    [tenantId, customerId]
  );
};

const resolveOrCreateStorefrontCustomer = async (client, { tenantId, name, phone }) => {
  const normalizedPhone = normalizeEgyptianMobile(phone);
  debugSession("normalized phone", {
    tenant_id: tenantId,
    ...phoneDebug(normalizedPhone),
  });
  let existing = null;
  try {
    existing = await findCustomerByPhone(client, { tenantId, phone: normalizedPhone });
  } catch (error) {
    error.queryLocation ||= "storefront_customer.find_by_phone";
    throw error;
  }
  debugSession("customer exists result", {
    tenant_id: tenantId,
    customer_exists: Boolean(existing),
    customer_id: existing?.id || null,
  });
  if (existing) {
    try {
      const updated = await client.query(
        `
        UPDATE customers
        SET name = COALESCE(NULLIF($1, ''), name),
            phone = COALESCE(NULLIF($2, ''), phone),
            is_storefront_customer = TRUE,
            registration_source = COALESCE(NULLIF(registration_source, ''), 'storefront'),
            first_visit_at = COALESCE(first_visit_at, CURRENT_TIMESTAMP),
            last_visit_at = CURRENT_TIMESTAMP,
            storefront_last_seen_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $3
        RETURNING *
        `,
        [toText(name).slice(0, 120), normalizedPhone, existing.id]
      );
      return { customer: updated.rows[0], created: false };
    } catch (error) {
      error.queryLocation ||= "storefront_customer.update_existing";
      throw error;
    }
  }

  const created = await insertStorefrontCustomer(client, { tenantId, name, normalizedPhone });
  return { customer: created, created: true };
};

const upsertSession = async (client, { tenantId, customerId, token, cartItems = [], wishlistItems = [], req = {} }) => {
  const hash = tokenHash(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  const result = await client.query(
    `
    INSERT INTO storefront_customer_sessions (
      tenant_id, customer_id, token_hash, cart_items, wishlist_items,
      user_agent, ip_address, expires_at, last_seen_at, updated_at
    )
    VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT (token_hash) DO UPDATE SET
      customer_id = EXCLUDED.customer_id,
      cart_items = EXCLUDED.cart_items,
      wishlist_items = EXCLUDED.wishlist_items,
      user_agent = EXCLUDED.user_agent,
      ip_address = EXCLUDED.ip_address,
      expires_at = EXCLUDED.expires_at,
      last_seen_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
    RETURNING *
    `,
    [
      tenantId,
      customerId,
      hash,
      jsonValue(Array.isArray(cartItems) ? cartItems : []),
      jsonValue(Array.isArray(wishlistItems) ? wishlistItems : []),
      toText(req.headers?.["user-agent"]).slice(0, 500),
      toText(req.ip || req.socket?.remoteAddress).slice(0, 120),
      expiresAt,
    ]
  );
  return result.rows[0];
};

const latestCustomerSession = async (client, { tenantId, customerId }) => {
  const result = await client.query(
    `
    SELECT *
    FROM storefront_customer_sessions
    WHERE tenant_id = $1
      AND customer_id = $2
      AND expires_at > CURRENT_TIMESTAMP
    ORDER BY updated_at DESC, id DESC
    LIMIT 1
    FOR UPDATE
    `,
    [tenantId, customerId]
  );
  return result.rows[0] || null;
};

export const createOrRestoreStorefrontCustomerSession = async ({ tenantId, name, phone, cartItems = [], wishlistItems = [], req = {} }) => {
  if (!isValidEgyptianMobile(phone)) {
    const error = new Error("INVALID_PHONE");
    error.status = 400;
    throw error;
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await ensureStorefrontCustomerSessionSchema(client);
    const { customer, created } = await resolveOrCreateStorefrontCustomer(client, { tenantId, name, phone });
    await ensureCustomerLoyaltyAccount(client, { tenantId, customerId: customer.id }).catch(() => {});
    const token = createToken();
    const previousSession = created ? null : await latestCustomerSession(client, { tenantId, customerId: customer.id });
    const mergedCartItems = mergeCartItems(previousSession?.cart_items || [], cartItems);
    const mergedWishlistItems = mergeWishlistItems(previousSession?.wishlist_items || [], wishlistItems);
    const session = await upsertSession(client, { tenantId, customerId: customer.id, token, cartItems: mergedCartItems, wishlistItems: mergedWishlistItems, req });
    await trackEvent(client, {
      tenantId,
      customerId: customer.id,
      eventType: created ? "modal_completed_new_customer" : "returning_customer_detected",
      metadata: { source: "storefront_customer_capture", cart_count: Array.isArray(cartItems) ? cartItems.length : 0, at: nowIso() },
    });
    await client.query("COMMIT");
    const loyalty = await getCustomerLoyaltySummary(customer.id, tenantId).catch(() => null);
    return {
      token,
      customer: publicCustomer(customer, loyalty),
      cart_items: session.cart_items || [],
      wishlist_items: session.wishlist_items || [],
      created,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[storefront-customer-session] transaction failed", {
      tenant_id: tenantId,
      ...phoneDebug(phone),
      query_location: error?.queryLocation || "",
      insert_payload_keys: error?.insertPayloadKeys || undefined,
      message: error?.message || String(error),
      code: error?.code || "",
      detail: error?.detail || "",
      table: error?.table || "",
      column: error?.column || "",
      constraint: error?.constraint || "",
    });
    throw error;
  } finally {
    client.release();
  }
};

export const getStorefrontCustomerSession = async ({ tenantId, token }) => {
  if (!token) return null;
  await ensureStorefrontCustomerSessionSchema();
  const result = await db.query(
    `
    SELECT
      s.id AS session_id,
      s.customer_id,
      s.cart_items,
      s.wishlist_items,
      s.addresses,
      c.name,
      c.phone,
      c.loyalty_points,
      c.loyalty_tier,
      c.wallet_balance,
      c.first_visit_at,
      c.last_visit_at,
      c.storefront_last_seen_at,
      c.registration_source
    FROM storefront_customer_sessions s
    JOIN customers c ON c.id = s.customer_id
    WHERE s.tenant_id = $1
      AND s.token_hash = $2
      AND s.expires_at > CURRENT_TIMESTAMP
    LIMIT 1
    `,
    [tenantId, tokenHash(token)]
  );
  const row = result.rows[0];
  if (!row) return null;
  await db.query(
    `
    UPDATE storefront_customer_sessions SET last_seen_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $1
    `,
    [row.session_id]
  );
  await db.query(
    `
    UPDATE customers
    SET last_visit_at = CURRENT_TIMESTAMP,
        storefront_last_seen_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = $1
    `,
    [row.customer_id]
  );
  const loyalty = await getCustomerLoyaltySummary(row.customer_id, tenantId).catch(() => null);
  return {
    customer: publicCustomer(row, loyalty),
    cart_items: row.cart_items || [],
    wishlist_items: row.wishlist_items || [],
    addresses: row.addresses || [],
  };
};

export const restoreStorefrontCustomerCart = async ({ tenantId, token, cartItems = [], wishlistItems = [] }) => {
  if (!token) return null;
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await ensureStorefrontCustomerSessionSchema(client);
    const found = await client.query(
      `
      SELECT *
      FROM storefront_customer_sessions
      WHERE tenant_id = $1
        AND token_hash = $2
        AND expires_at > CURRENT_TIMESTAMP
      LIMIT 1
      FOR UPDATE
      `,
      [tenantId, tokenHash(token)]
    );
    const session = found.rows[0];
    if (!session) {
      await client.query("ROLLBACK");
      return null;
    }
    const mergedCart = mergeCartItems(session.cart_items || [], cartItems);
    const mergedWishlist = mergeWishlistItems(session.wishlist_items || [], wishlistItems);
    const updated = await client.query(
      `
      UPDATE storefront_customer_sessions
      SET cart_items = $1::jsonb,
          wishlist_items = $2::jsonb,
          last_seen_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $3
      RETURNING *
      `,
      [jsonValue(mergedCart), jsonValue(mergedWishlist), session.id]
    );
    await trackEvent(client, {
      tenantId,
      customerId: session.customer_id,
      eventType: "cart_restored",
      metadata: { local_cart_count: Array.isArray(cartItems) ? cartItems.length : 0, restored_cart_count: mergedCart.length },
    });
    await client.query("COMMIT");
    return {
      cart_items: updated.rows[0]?.cart_items || mergedCart,
      wishlist_items: updated.rows[0]?.wishlist_items || mergedWishlist,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
};

export const mergeCartItems = (serverItems = [], localItems = []) => {
  const byLine = new Map();
  for (const item of [...(Array.isArray(serverItems) ? serverItems : []), ...(Array.isArray(localItems) ? localItems : [])]) {
    const lineId = toText(item?.lineId || `${item?.product_id || item?.productId || item?.id || ""}:${item?.variant_id || item?.variantId || ""}`);
    if (!lineId || lineId === ":") continue;
    const current = byLine.get(lineId);
    const quantity = Math.max(1, Number(item?.quantity || 1));
    if (current) byLine.set(lineId, { ...current, ...item, lineId, quantity: Math.min(Number(item?.stock || current.stock || 99), Number(current.quantity || 1) + quantity) });
    else byLine.set(lineId, { ...item, lineId, quantity });
  }
  return Array.from(byLine.values()).slice(0, 50);
};

export const mergeWishlistItems = (serverItems = [], localItems = []) => {
  const byId = new Map();
  for (const item of [...(Array.isArray(serverItems) ? serverItems : []), ...(Array.isArray(localItems) ? localItems : [])]) {
    const id = toText(item?.id || item?.product_id || item?.productId);
    if (!id) continue;
    byId.set(id, { ...item, id });
  }
  return Array.from(byId.values()).slice(0, 200);
};
