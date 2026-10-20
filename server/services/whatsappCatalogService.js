import db from "../database/db.js";
import { getSetting } from "./settingsService.js";
import { cloudConfig, graphRequest } from "./whatsappCloudProvider.js";
import { integrationAccessToken, listIntegrations } from "./whatsappEmbeddedSignupService.js";
import { ensureMetaDuplicateSkuKeys, metaContentIdFor, skuKey } from "./metaCatalogContentIdService.js";
import { extractWhatsappOrders, parseCompositeRetailerId } from "./whatsappOrderMessages.js";

/*
 * WhatsApp commerce — the catalogues the shop sells from on WhatsApp, their products, and the
 * carts customers send from them ("order" messages).
 *
 * Nothing here owns the catalogue itself: the products reach Meta through the existing XML feed
 * (/feeds/meta.xml, metaCatalogFeedService), and a catalogue is owned by the Business in Commerce
 * Manager. This service only READS what Meta holds, flips the two per-number commerce switches,
 * and keeps a log of incoming carts. It never creates an ERP order on its own.
 *
 * Every Graph call is best effort: the tokens we hold may lack catalog_management, and a missing
 * permission must leave the page showing what IS known instead of failing as a whole.
 */

const text = (value = "") => String(value ?? "").trim();
const httpError = (message, status = 400, code = "WHATSAPP_COMMERCE_INVALID", details = null) =>
  Object.assign(new Error(message), { status, code, ...(details ? { details } : {}) });
const tenantOf = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw httpError("A valid tenant id is required");
  return Math.trunc(parsed);
};

const DEFAULT_BACKEND_URL = "https://api.m1store-egy.com";
const backendBaseUrl = () => text(process.env.PUBLIC_BACKEND_URL || process.env.API_PUBLIC_URL || DEFAULT_BACKEND_URL).replace(/\/+$/g, "");
// Built exactly as metaCatalogFeedService does: the feed is mounted at /feeds on the API host.
export const metaFeedUrl = () => `${backendBaseUrl()}/feeds/meta.xml`;
const absoluteMediaUrl = (value = "") => {
  const url = text(value);
  if (!url || /^https?:\/\//i.test(url)) return url;
  return `${backendBaseUrl()}/${url.replace(/^\/+/g, "")}`;
};

export const ORDER_STATUSES = Object.freeze(["new", "converted", "cancelled"]);

/* ------------------------------------------------------------------ schema */

let schemaReady = null;
export const ensureWhatsappCommerceSchema = () => {
  schemaReady ||= db
    .query(`
      CREATE TABLE IF NOT EXISTS whatsapp_catalogs (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL,
        catalog_id VARCHAR(64) NOT NULL,
        name TEXT NOT NULL DEFAULT '',
        source VARCHAR(16) NOT NULL DEFAULT 'settings',
        account_label TEXT NOT NULL DEFAULT '',
        phone_number_id VARCHAR(64) NOT NULL DEFAULT '',
        vertical VARCHAR(64) NOT NULL DEFAULT '',
        product_count INTEGER,
        feed_count INTEGER,
        last_upload_errors INTEGER,
        status VARCHAR(16) NOT NULL DEFAULT 'unknown',
        last_synced_at TIMESTAMPTZ,
        cart_enabled BOOLEAN,
        catalog_visible BOOLEAN,
        error TEXT NOT NULL DEFAULT '',
        refreshed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_whatsapp_catalog UNIQUE (tenant_id, catalog_id)
      );
      CREATE TABLE IF NOT EXISTS whatsapp_orders (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL,
        wa_message_id VARCHAR(255) NOT NULL UNIQUE,
        customer_phone VARCHAR(64) NOT NULL DEFAULT '',
        customer_name TEXT NOT NULL DEFAULT '',
        conversation_id VARCHAR(255) NOT NULL DEFAULT '',
        catalog_id VARCHAR(64) NOT NULL DEFAULT '',
        phone_number_id VARCHAR(64) NOT NULL DEFAULT '',
        note TEXT NOT NULL DEFAULT '',
        items JSONB NOT NULL DEFAULT '[]'::jsonb,
        total NUMERIC(14,2) NOT NULL DEFAULT 0,
        currency VARCHAR(8) NOT NULL DEFAULT '',
        status VARCHAR(16) NOT NULL DEFAULT 'new',
        erp_order_id INTEGER,
        ordered_at TIMESTAMPTZ,
        status_changed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_whatsapp_orders_tenant_created ON whatsapp_orders (tenant_id, created_at DESC);
    `)
    .catch((error) => {
      schemaReady = null;
      throw error;
    });
  return schemaReady;
};

/* ------------------------------------------------------------------ credentials */

/*
 * Every token we might read a catalogue with, best first: each connected Embedded Signup number,
 * then the env Cloud token, then an optional dedicated system-user token with catalog_management.
 */
const resolveCommerceAccounts = async (tenantId) => {
  const env = cloudConfig();
  const rows = await listIntegrations({ tenantId }).catch(() => []);
  const numbers = [];
  for (const row of rows) {
    if (row.status !== "connected" || !text(row.phone_number_id)) continue;
    const token = text(integrationAccessToken(row));
    if (!token) continue;
    numbers.push({
      phoneNumberId: text(row.phone_number_id),
      wabaId: text(row.waba_id),
      label: text(row.verified_name) || text(row.display_phone_number) || text(row.phone_number_id),
      displayPhoneNumber: text(row.display_phone_number),
      token,
    });
  }
  if (env.accessToken && env.phoneNumberId && !numbers.some((item) => item.phoneNumberId === env.phoneNumberId)) {
    numbers.push({
      phoneNumberId: env.phoneNumberId,
      wabaId: env.businessAccountId,
      label: env.phoneNumberId,
      displayPhoneNumber: "",
      token: env.accessToken,
    });
  }
  const tokens = [...new Set([
    ...numbers.map((item) => item.token),
    env.accessToken,
    text(process.env.META_CATALOG_ACCESS_TOKEN || process.env.META_SYSTEM_USER_TOKEN),
  ].filter(Boolean))];
  return { numbers, tokens, graphVersion: env.graphVersion };
};

// The first token that answers wins; the last Meta error is thrown when none does.
const graphTry = async ({ path, tokens = [], method = "GET" }) => {
  if (!tokens.length) {
    throw httpError("No Meta access token is configured for WhatsApp.", 409, "WHATSAPP_CLOUD_NOT_CONNECTED");
  }
  let lastError = null;
  for (const accessToken of tokens) {
    try {
      return await graphRequest({ path, method, accessToken });
    } catch (error) {
      lastError = error;
      // A timeout or outage will not improve with another token.
      if (["WHATSAPP_CLOUD_TIMEOUT", "WHATSAPP_CLOUD_UNREACHABLE"].includes(error?.code)) break;
    }
  }
  throw lastError;
};

const errorText = (error) => {
  const code = error?.details?.graph_code;
  return `${text(error?.message) || "Meta request failed"}${code ? ` (#${code})` : ""}`;
};

/* ------------------------------------------------------------------ catalogues */

const readCommerceSettings = async ({ number, graphVersion }) => {
  const payload = await graphRequest({
    path: `/${graphVersion}/${number.phoneNumberId}/whatsapp_commerce_settings`,
    accessToken: number.token,
  });
  const row = Array.isArray(payload?.data) ? payload.data[0] || {} : payload || {};
  return {
    cart_enabled: row.is_cart_enabled === true,
    catalog_visible: row.is_catalog_visible === true,
    commerce_settings_id: text(row.id),
  };
};

const latestFeedUpload = (feeds = []) => {
  let latest = null;
  let errors = 0;
  for (const feed of feeds) {
    const upload = feed?.latest_upload || {};
    const at = upload.end_time ? new Date(upload.end_time) : null;
    if (at && !Number.isNaN(at.getTime()) && (!latest || at > latest)) {
      latest = at;
      errors = Number(upload.error_count) || 0;
    }
  }
  return { lastSyncedAt: latest ? latest.toISOString() : null, errors: latest ? errors : null };
};

const describeCatalog = async ({ catalogId, tokens, graphVersion }) => {
  const result = { name: "", vertical: "", product_count: null, feed_count: null, last_synced_at: null, last_upload_errors: null, errors: [] };
  try {
    const info = await graphTry({ path: `/${graphVersion}/${catalogId}?fields=name,product_count,vertical`, tokens });
    result.name = text(info?.name);
    result.vertical = text(info?.vertical);
    result.product_count = Number.isFinite(Number(info?.product_count)) ? Number(info.product_count) : null;
  } catch (error) {
    result.errors.push(errorText(error));
  }
  try {
    const feeds = await graphTry({
      path: `/${graphVersion}/${catalogId}/product_feeds?fields=name,latest_upload{end_time,error_count},schedule`,
      tokens,
    });
    const list = Array.isArray(feeds?.data) ? feeds.data : [];
    const latest = latestFeedUpload(list);
    result.feed_count = list.length;
    result.last_synced_at = latest.lastSyncedAt;
    result.last_upload_errors = latest.errors;
  } catch (error) {
    // The feeds edge needs catalog_management even when the node itself is readable.
    if (!result.errors.length) result.errors.push(errorText(error));
  }
  return result;
};

const catalogStatus = (details) => {
  if (details.errors.length && !details.name && details.product_count === null) return "error";
  if (details.last_upload_errors > 0) return "warning";
  return "active";
};

export const syncWhatsappCatalogs = async ({ tenantId } = {}) => {
  const tenant = tenantOf(tenantId);
  await ensureWhatsappCommerceSchema();
  const { numbers, tokens, graphVersion } = await resolveCommerceAccounts(tenant);
  const found = new Map();
  const notes = [];

  const settingsCatalogId = text(await getSetting("storefront.facebook_catalog_id", "").catch(() => ""));
  if (/^\d+$/.test(settingsCatalogId)) {
    found.set(settingsCatalogId, { catalog_id: settingsCatalogId, source: "settings", account_label: "", phone_number_id: "", cart_enabled: null, catalog_visible: null });
  } else if (settingsCatalogId) {
    notes.push(`storefront.facebook_catalog_id "${settingsCatalogId}" is not a numeric catalogue id`);
  }

  for (const number of numbers) {
    let commerce = null;
    try {
      commerce = await readCommerceSettings({ number, graphVersion });
    } catch (error) {
      notes.push(`${number.label}: commerce settings — ${errorText(error)}`);
    }
    let wabaCatalogs = [];
    if (number.wabaId) {
      try {
        const payload = await graphTry({ path: `/${graphVersion}/${number.wabaId}/product_catalogs?fields=id,name`, tokens: [number.token, ...tokens] });
        wabaCatalogs = Array.isArray(payload?.data) ? payload.data : [];
      } catch (error) {
        notes.push(`${number.label}: linked catalogue — ${errorText(error)}`);
      }
    }
    for (const catalog of wabaCatalogs) {
      const id = text(catalog?.id);
      if (!id) continue;
      const previous = found.get(id);
      found.set(id, {
        catalog_id: id,
        // A catalogue both in settings and on the number is the number's: that is where it sells.
        source: "waba",
        account_label: number.label,
        phone_number_id: number.phoneNumberId,
        cart_enabled: commerce ? commerce.cart_enabled : previous?.cart_enabled ?? null,
        catalog_visible: commerce ? commerce.catalog_visible : previous?.catalog_visible ?? null,
        name_hint: text(catalog?.name),
      });
    }
  }

  const saved = [];
  for (const entry of found.values()) {
    const details = await describeCatalog({ catalogId: entry.catalog_id, tokens, graphVersion });
    const result = await db.query(
      `
      INSERT INTO whatsapp_catalogs (
        tenant_id, catalog_id, name, source, account_label, phone_number_id, vertical, product_count,
        feed_count, last_upload_errors, status, last_synced_at, cart_enabled, catalog_visible, error, refreshed_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW())
      ON CONFLICT ON CONSTRAINT uq_whatsapp_catalog DO UPDATE SET
        name = COALESCE(NULLIF(EXCLUDED.name, ''), whatsapp_catalogs.name),
        source = EXCLUDED.source,
        account_label = EXCLUDED.account_label,
        phone_number_id = EXCLUDED.phone_number_id,
        vertical = COALESCE(NULLIF(EXCLUDED.vertical, ''), whatsapp_catalogs.vertical),
        product_count = COALESCE(EXCLUDED.product_count, whatsapp_catalogs.product_count),
        feed_count = COALESCE(EXCLUDED.feed_count, whatsapp_catalogs.feed_count),
        last_upload_errors = COALESCE(EXCLUDED.last_upload_errors, whatsapp_catalogs.last_upload_errors),
        status = EXCLUDED.status,
        last_synced_at = COALESCE(EXCLUDED.last_synced_at, whatsapp_catalogs.last_synced_at),
        cart_enabled = EXCLUDED.cart_enabled,
        catalog_visible = EXCLUDED.catalog_visible,
        error = EXCLUDED.error,
        refreshed_at = NOW()
      RETURNING *
      `,
      [
        tenant,
        entry.catalog_id,
        details.name || entry.name_hint || "",
        entry.source,
        entry.account_label,
        entry.phone_number_id,
        details.vertical,
        details.product_count,
        details.feed_count,
        details.last_upload_errors,
        catalogStatus(details),
        details.last_synced_at,
        entry.cart_enabled,
        entry.catalog_visible,
        details.errors.join(" · "),
      ]
    );
    if (result.rows[0]) saved.push(result.rows[0]);
  }

  // A catalogue no longer configured anywhere leaves the list — but only when this sync could see
  // something; a sync where every call failed must not wipe what the page last knew.
  if (found.size) {
    await db.query(`DELETE FROM whatsapp_catalogs WHERE tenant_id = $1 AND NOT (catalog_id = ANY($2::text[]))`, [tenant, [...found.keys()]]);
  }
  return { catalogs: saved.length, notes };
};

export const listWhatsappCatalogs = async ({ tenantId } = {}) => {
  const tenant = tenantOf(tenantId);
  await ensureWhatsappCommerceSchema();
  const [rowsResult, accounts] = await Promise.all([
    db.query(`SELECT * FROM whatsapp_catalogs WHERE tenant_id = $1 ORDER BY source DESC, name ASC, id ASC`, [tenant]),
    resolveCommerceAccounts(tenant),
  ]);
  const settingsCatalogId = text(await getSetting("storefront.facebook_catalog_id", "").catch(() => ""));
  const rows = rowsResult.rows || [];
  // Live switch states per number — cheap (one call each) and the only source of truth.
  const numbers = await Promise.all(
    accounts.numbers.map(async (number) => {
      const base = {
        phone_number_id: number.phoneNumberId,
        label: number.label,
        display_phone_number: number.displayPhoneNumber,
        catalog_id: rows.find((row) => row.phone_number_id === number.phoneNumberId)?.catalog_id || "",
      };
      try {
        return { ...base, ...(await readCommerceSettings({ number, graphVersion: accounts.graphVersion })), error: "" };
      } catch (error) {
        const stored = rows.find((row) => row.phone_number_id === number.phoneNumberId);
        return { ...base, cart_enabled: stored?.cart_enabled ?? null, catalog_visible: stored?.catalog_visible ?? null, error: errorText(error) };
      }
    })
  );
  return {
    catalogs: rows.map(publicCatalogShape),
    numbers,
    feed_url: metaFeedUrl(),
    settings_catalog_id: settingsCatalogId,
  };
};

const publicCatalogShape = (row = {}) => ({
  id: row.id,
  catalog_id: row.catalog_id,
  name: row.name || "",
  source: row.source,
  account_label: row.account_label || "",
  phone_number_id: row.phone_number_id || "",
  vertical: row.vertical || "",
  product_count: row.product_count,
  feed_count: row.feed_count,
  last_upload_errors: row.last_upload_errors,
  status: row.status,
  last_synced_at: row.last_synced_at,
  cart_enabled: row.cart_enabled,
  catalog_visible: row.catalog_visible,
  error: row.error || "",
  refreshed_at: row.refreshed_at,
});

export const updateWhatsappCommerceSettings = async ({ tenantId, phoneNumberId = "", isCatalogVisible, isCartEnabled } = {}) => {
  const tenant = tenantOf(tenantId);
  await ensureWhatsappCommerceSchema();
  const { numbers, graphVersion } = await resolveCommerceAccounts(tenant);
  if (!numbers.length) throw httpError("No official WhatsApp number is connected.", 409, "WHATSAPP_CLOUD_NOT_CONNECTED");
  const number = text(phoneNumberId) ? numbers.find((item) => item.phoneNumberId === text(phoneNumberId)) : numbers[0];
  if (!number) throw httpError("That WhatsApp number is not connected.", 404, "WHATSAPP_NUMBER_NOT_FOUND");

  const current = await readCommerceSettings({ number, graphVersion }).catch(() => null);
  const visible = typeof isCatalogVisible === "boolean" ? isCatalogVisible : current?.catalog_visible ?? false;
  const cart = typeof isCartEnabled === "boolean" ? isCartEnabled : current?.cart_enabled ?? false;
  const params = new URLSearchParams({ is_catalog_visible: String(visible), is_cart_enabled: String(cart) });
  await graphRequest({
    path: `/${graphVersion}/${number.phoneNumberId}/whatsapp_commerce_settings?${params.toString()}`,
    method: "POST",
    accessToken: number.token,
  });
  await db.query(
    `UPDATE whatsapp_catalogs SET cart_enabled = $1, catalog_visible = $2 WHERE tenant_id = $3 AND phone_number_id = $4`,
    [cart, visible, tenant, number.phoneNumberId]
  );
  return { phone_number_id: number.phoneNumberId, cart_enabled: cart, catalog_visible: visible };
};

/* ------------------------------------------------------------------ ERP mapping */

/*
 * Retailer id → ERP size. The feed publishes a size under its SKU when no other published size
 * shares it, else as "<productId>-<variantId>" (metaCatalogContentIdService). Both shapes are
 * looked up, and a SKU match is only trusted when the feed would really publish that size under
 * that SKU (its content id equals the retailer id).
 */
export const resolveRetailerIds = async (retailerIds = []) => {
  const ids = [...new Set((Array.isArray(retailerIds) ? retailerIds : []).map(text).filter(Boolean))];
  const map = new Map();
  if (!ids.length) return map;
  const composite = ids.map(parseCompositeRetailerId).filter(Boolean);
  const skus = [...new Set(ids.map(skuKey).filter(Boolean))];
  const result = await db.query(
    `
    SELECT pv.id AS variant_id, pv.product_id, pv.sku, pv.color, pv.size, pv.image_url AS variant_image_url,
           p.name AS product_name, p.image_url AS product_image_url,
           (pv.deleted_at IS NULL AND pv.is_active IS DISTINCT FROM FALSE) AS variant_live
    FROM product_variants pv
    JOIN products p ON p.id = pv.product_id
    WHERE pv.id = ANY($1::int[]) OR LOWER(TRIM(pv.sku)) = ANY($2::text[])
    ORDER BY (pv.deleted_at IS NULL) DESC, pv.id ASC
    `,
    [composite.map((item) => item.variantId), skus]
  );
  const keys = await ensureMetaDuplicateSkuKeys().catch(() => null);
  for (const row of result.rows || []) {
    const entry = {
      product_id: row.product_id,
      variant_id: row.variant_id,
      product_name: text(row.product_name),
      sku: text(row.sku),
      color: text(row.color),
      size: text(row.size),
      image_url: absoluteMediaUrl(row.variant_image_url || row.product_image_url),
    };
    const compositeId = `${row.product_id}-${row.variant_id}`;
    if (ids.includes(compositeId) && !map.has(compositeId)) map.set(compositeId, entry);
    const contentId = metaContentIdFor({ productId: row.product_id, variantId: row.variant_id, sku: row.sku }, keys);
    for (const id of ids) {
      if (map.has(id) || skuKey(id) !== skuKey(row.sku)) continue;
      // Without the duplicate set (cold start) a SKU match is still the best guess.
      if (!contentId || skuKey(contentId) === skuKey(id)) map.set(id, entry);
    }
  }
  return map;
};

/* ------------------------------------------------------------------ products */

const assertKnownCatalog = async (tenant, catalogId) => {
  const id = text(catalogId);
  if (!/^\d+$/.test(id)) throw httpError("A valid catalogue id is required", 400, "WHATSAPP_CATALOG_INVALID");
  const known = await db.query(`SELECT 1 FROM whatsapp_catalogs WHERE tenant_id = $1 AND catalog_id = $2 LIMIT 1`, [tenant, id]);
  if (known.rows.length) return id;
  const settingsCatalogId = text(await getSetting("storefront.facebook_catalog_id", "").catch(() => ""));
  if (settingsCatalogId === id) return id;
  throw httpError("This catalogue is not linked to this account. Sync catalogues first.", 404, "WHATSAPP_CATALOG_NOT_FOUND");
};

const PRODUCT_FIELDS = "id,retailer_id,name,price,availability,image_url,url";

export const listCatalogProducts = async ({ tenantId, catalogId, search = "", after = "", before = "", limit = 50 } = {}) => {
  const tenant = tenantOf(tenantId);
  await ensureWhatsappCommerceSchema();
  const id = await assertKnownCatalog(tenant, catalogId);
  const { tokens, graphVersion } = await resolveCommerceAccounts(tenant);
  const params = new URLSearchParams({ fields: PRODUCT_FIELDS, limit: String(Math.min(Math.max(Number(limit) || 50, 1), 100)) });
  const needle = text(search).slice(0, 120);
  if (needle) {
    params.set("filter", JSON.stringify({ or: [{ name: { i_contains: needle } }, { retailer_id: { i_contains: needle } }] }));
  }
  if (text(after)) params.set("after", text(after));
  else if (text(before)) params.set("before", text(before));
  const payload = await graphTry({ path: `/${graphVersion}/${id}/products?${params.toString()}`, tokens });
  const items = Array.isArray(payload?.data) ? payload.data : [];
  const mapping = await resolveRetailerIds(items.map((item) => item.retailer_id)).catch(() => new Map());
  return {
    catalog_id: id,
    products: items.map((item) => {
      const erp = mapping.get(text(item.retailer_id)) || null;
      return {
        id: text(item.id),
        retailer_id: text(item.retailer_id),
        name: text(item.name),
        price: text(item.price),
        availability: text(item.availability),
        image_url: text(item.image_url),
        url: text(item.url),
        erp: erp ? { product_id: erp.product_id, variant_id: erp.variant_id, product_name: erp.product_name, color: erp.color, size: erp.size } : null,
      };
    }),
    paging: {
      after: payload?.paging?.next ? text(payload?.paging?.cursors?.after) : "",
      before: payload?.paging?.previous ? text(payload?.paging?.cursors?.before) : "",
    },
  };
};

/* ------------------------------------------------------------------ orders */

/*
 * Called fire-and-forget from the Cloud webhook after its signature check. A body with no order
 * message returns before touching the database, which is every webhook but a cart.
 */
export const recordWhatsappOrders = async ({ tenantId, body } = {}) => {
  const orders = extractWhatsappOrders(body);
  if (!orders.length) return { recorded: 0 };
  const tenant = tenantOf(tenantId);
  await ensureWhatsappCommerceSchema();
  const mapping = await resolveRetailerIds(orders.flatMap((order) => order.items.map((item) => item.product_retailer_id))).catch(() => new Map());
  let recorded = 0;
  for (const order of orders) {
    const items = order.items.map((item) => {
      const erp = mapping.get(item.product_retailer_id);
      return erp ? { ...item, product_id: erp.product_id, variant_id: erp.variant_id } : item;
    });
    const result = await db.query(
      `
      INSERT INTO whatsapp_orders (
        tenant_id, wa_message_id, customer_phone, customer_name, conversation_id, catalog_id,
        phone_number_id, note, items, total, currency, status, ordered_at, created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, 'new', $12, NOW())
      ON CONFLICT (wa_message_id) DO NOTHING
      RETURNING id
      `,
      [
        tenant,
        order.wa_message_id,
        order.customer_phone,
        order.customer_name,
        order.conversation_id,
        order.catalog_id,
        order.phone_number_id,
        order.note,
        JSON.stringify(items),
        order.total,
        order.currency,
        order.ordered_at,
      ]
    );
    if (result.rows.length) {
      recorded += 1;
      console.info("[whatsapp:catalog-order]", {
        tenant_id: tenant,
        order_id: result.rows[0].id,
        phone_suffix: order.customer_phone.slice(-4),
        items: items.length,
        total: order.total,
        currency: order.currency,
      });
    }
  }
  return { recorded };
};

const publicOrderShape = (row = {}) => ({
  id: row.id,
  wa_message_id: row.wa_message_id,
  customer_phone: row.customer_phone,
  customer_name: row.customer_name || "",
  conversation_id: row.conversation_id || "",
  catalog_id: row.catalog_id || "",
  catalog_name: row.catalog_name || "",
  note: row.note || "",
  items: Array.isArray(row.items) ? row.items : [],
  item_count: Array.isArray(row.items) ? row.items.reduce((sum, item) => sum + (Number(item?.quantity) || 0), 0) : 0,
  total: Number(row.total) || 0,
  currency: row.currency || "",
  status: row.status,
  erp_order_id: row.erp_order_id,
  ordered_at: row.ordered_at || row.created_at,
  created_at: row.created_at,
  status_changed_at: row.status_changed_at,
});

export const listWhatsappOrders = async ({ tenantId, status = "", search = "", limit = 50, offset = 0 } = {}) => {
  const tenant = tenantOf(tenantId);
  await ensureWhatsappCommerceSchema();
  const values = [tenant];
  const where = ["o.tenant_id = $1"];
  if (ORDER_STATUSES.includes(text(status))) {
    values.push(text(status));
    where.push(`o.status = $${values.length}`);
  }
  const needle = text(search).slice(0, 80);
  if (needle) {
    values.push(`%${needle}%`);
    where.push(`(o.customer_phone ILIKE $${values.length} OR o.customer_name ILIKE $${values.length})`);
  }
  const pageSize = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const skip = Math.max(Number(offset) || 0, 0);
  const listValues = [...values, pageSize, skip];
  const [rows, counts] = await Promise.all([
    db.query(
      `
      SELECT o.*, c.name AS catalog_name
      FROM whatsapp_orders o
      LEFT JOIN whatsapp_catalogs c ON c.tenant_id = o.tenant_id AND c.catalog_id = o.catalog_id
      WHERE ${where.join(" AND ")}
      ORDER BY o.created_at DESC, o.id DESC
      LIMIT $${values.length + 1} OFFSET $${values.length + 2}
      `,
      listValues
    ),
    db.query(`SELECT status, COUNT(*)::int AS count FROM whatsapp_orders WHERE tenant_id = $1 GROUP BY status`, [tenant]),
  ]);
  return {
    orders: (rows.rows || []).map(publicOrderShape),
    counts: Object.fromEntries((counts.rows || []).map((row) => [row.status, row.count])),
  };
};

// Names and pictures for a cart: the ERP size when mapped, else what Meta's catalogue says.
const catalogItemsByRetailerId = async ({ tenant, catalogId, retailerIds }) => {
  const found = new Map();
  if (!/^\d+$/.test(text(catalogId)) || !retailerIds.length) return found;
  const { tokens, graphVersion } = await resolveCommerceAccounts(tenant);
  const params = new URLSearchParams({
    fields: "retailer_id,name,image_url,price",
    limit: String(Math.min(retailerIds.length, 100)),
    filter: JSON.stringify({ retailer_id: { is_any: retailerIds.slice(0, 100) } }),
  });
  const payload = await graphTry({ path: `/${graphVersion}/${text(catalogId)}/products?${params.toString()}`, tokens });
  for (const item of Array.isArray(payload?.data) ? payload.data : []) {
    found.set(text(item.retailer_id), { name: text(item.name), image_url: text(item.image_url) });
  }
  return found;
};

export const getWhatsappOrder = async ({ tenantId, id } = {}) => {
  const tenant = tenantOf(tenantId);
  await ensureWhatsappCommerceSchema();
  const result = await db.query(
    `
    SELECT o.*, c.name AS catalog_name
    FROM whatsapp_orders o
    LEFT JOIN whatsapp_catalogs c ON c.tenant_id = o.tenant_id AND c.catalog_id = o.catalog_id
    WHERE o.tenant_id = $1 AND o.id = $2
    `,
    [tenant, Number(id) || 0]
  );
  const row = result.rows[0];
  if (!row) throw httpError("WhatsApp order not found", 404, "WHATSAPP_ORDER_NOT_FOUND");
  const order = publicOrderShape(row);
  const retailerIds = order.items.map((item) => text(item.product_retailer_id)).filter(Boolean);
  const erp = await resolveRetailerIds(retailerIds).catch(() => new Map());
  const missing = retailerIds.filter((retailerId) => !erp.has(retailerId));
  const meta = missing.length
    ? await catalogItemsByRetailerId({ tenant, catalogId: order.catalog_id, retailerIds: missing }).catch(() => new Map())
    : new Map();
  order.items = order.items.map((item) => {
    const mapped = erp.get(text(item.product_retailer_id));
    const remote = meta.get(text(item.product_retailer_id));
    return {
      ...item,
      name: mapped ? [mapped.product_name, mapped.color, mapped.size].filter(Boolean).join(" · ") : remote?.name || "",
      image_url: mapped?.image_url || remote?.image_url || "",
      erp: mapped ? { product_id: mapped.product_id, variant_id: mapped.variant_id, sku: mapped.sku } : null,
    };
  });
  return order;
};

export const updateWhatsappOrderStatus = async ({ tenantId, id, status, erpOrderId = null } = {}) => {
  const tenant = tenantOf(tenantId);
  const next = text(status);
  if (!ORDER_STATUSES.includes(next)) throw httpError("Status must be new, converted or cancelled", 400, "WHATSAPP_ORDER_STATUS_INVALID");
  await ensureWhatsappCommerceSchema();
  const linked = Number(erpOrderId);
  const result = await db.query(
    `
    UPDATE whatsapp_orders
    SET status = $1,
        erp_order_id = CASE WHEN $2::boolean THEN COALESCE($3::int, erp_order_id) ELSE erp_order_id END,
        status_changed_at = NOW()
    WHERE tenant_id = $4 AND id = $5
    RETURNING id
    `,
    [next, next === "converted", Number.isFinite(linked) && linked > 0 ? Math.trunc(linked) : null, tenant, Number(id) || 0]
  );
  if (!result.rows.length) throw httpError("WhatsApp order not found", 404, "WHATSAPP_ORDER_NOT_FOUND");
  return getWhatsappOrder({ tenantId: tenant, id });
};

export default {
  ensureWhatsappCommerceSchema,
  syncWhatsappCatalogs,
  listWhatsappCatalogs,
  updateWhatsappCommerceSettings,
  listCatalogProducts,
  resolveRetailerIds,
  recordWhatsappOrders,
  listWhatsappOrders,
  getWhatsappOrder,
  updateWhatsappOrderStatus,
  metaFeedUrl,
};
