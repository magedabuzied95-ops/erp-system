import db from "../database/db.js";
import { getSetting } from "./settingsService.js";
import { resolvePublicAppUrl } from "../utils/whatsapp.js";
import { getPhoneSearchVariants, normalizePhone, phoneSqlDigits } from "../utils/phoneSearch.js";
import { normalizeWhatsappPhone, normalizeWhatsappSessionId } from "../utils/whatsappIdentity.js";
import { queueWhatsappAutomation } from "./whatsappQueue/index.js";

/*
 * Price Drop Alert — "نبّهني لو السعر نزل".
 *
 * A storefront customer follows a product, from the button on the product page or by putting it
 * in their wishlist. The follow remembers the price they saw (`reference_price`). A background
 * tick re-reads every followed product's price from the storefront's own catalog path and, when
 * the price has fallen far enough below that reference while the product is in stock, tells the
 * customer: a row in website_notifications always, and a WhatsApp card when the shop has switched
 * that channel on.
 *
 * The reference only ever moves DOWN, and only when an alert is claimed. A price that rises and
 * then comes back to where the customer first saw it is not a drop to them, and a customer who
 * was told about 800 → 700 is next told only when it goes below 700.
 *
 * Send-once is a claim on the row (reference_price must still be the value we read), the same
 * claim-before-send shape as the abandoned-cart reminder: a crash between the claim and the send
 * loses one alert rather than sending two.
 */

export const PRICE_DROP_AUTOMATION_TYPE = "price_drop_alert";
export const PRICE_DROP_SETTING_KEYS = Object.freeze({
  enabled: "storefront.price_drop_alert.enabled",
  whatsapp: "storefront.price_drop_alert.whatsapp_enabled",
  minPercent: "storefront.price_drop_alert.min_percent",
});

const COOLDOWN_HOURS = 24;
const PRODUCTS_PER_TICK = 400;
const QUIET_HOURS = { start: 23, end: 10 }; // Cairo: nothing leaves between 23:00 and 10:00

const text = (value = "") => String(value ?? "").trim();
const money = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
const bool = (value, fallback = false) => {
  if (value === true || value === "true" || value === 1 || value === "1") return true;
  if (value === false || value === "false" || value === 0 || value === "0") return false;
  return fallback;
};
const formatEgp = (value) => Number(money(value)).toLocaleString("en-US");

let schemaReady = null;
export const ensurePriceDropAlertSchema = (executor = db) => {
  if (!schemaReady) {
    schemaReady = (async () => {
      await executor.query(`
        CREATE TABLE IF NOT EXISTS storefront_price_alerts (
          id BIGSERIAL PRIMARY KEY,
          tenant_id BIGINT NOT NULL,
          customer_id BIGINT NULL,
          phone VARCHAR(80) NOT NULL,
          product_id BIGINT NOT NULL,
          via_button BOOLEAN NOT NULL DEFAULT FALSE,
          via_wishlist BOOLEAN NOT NULL DEFAULT FALSE,
          followed_price NUMERIC(12,2) NULL,
          reference_price NUMERIC(12,2) NULL,
          last_seen_price NUMERIC(12,2) NULL,
          last_notified_price NUMERIC(12,2) NULL,
          last_notified_at TIMESTAMPTZ NULL,
          notify_count INTEGER NOT NULL DEFAULT 0,
          checked_at TIMESTAMPTZ NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (tenant_id, phone, product_id)
        )
      `);
      await executor.query(`
        CREATE INDEX IF NOT EXISTS idx_storefront_price_alerts_active_product
        ON storefront_price_alerts (tenant_id, product_id)
        WHERE via_button OR via_wishlist
      `);
    })().catch((error) => {
      schemaReady = null; // a failed ensure must not become a cached rejection
      throw error;
    });
  }
  return schemaReady;
};

export const loadPriceDropConfig = async () => {
  const [enabled, whatsapp, minPercent] = await Promise.all([
    getSetting(PRICE_DROP_SETTING_KEYS.enabled, true).catch(() => true),
    getSetting(PRICE_DROP_SETTING_KEYS.whatsapp, false).catch(() => false),
    getSetting(PRICE_DROP_SETTING_KEYS.minPercent, 5).catch(() => 5),
  ]);
  const percent = Number(minPercent);
  return {
    enabled: bool(enabled, true),
    whatsapp_enabled: bool(whatsapp, false),
    min_percent: Number.isFinite(percent) ? Math.min(90, Math.max(0, percent)) : 5,
  };
};

/*
 * Is this a drop worth telling the customer about? Pure, so the rule is testable on its own.
 * `minPercent` guards against a 1-pound rounding change reading as news.
 */
export const evaluatePriceDrop = ({ referencePrice, currentPrice, inStock, minPercent = 5 } = {}) => {
  const reference = money(referencePrice);
  const current = money(currentPrice);
  if (!(reference > 0) || !(current > 0)) return { drop: false, reason: "no_price" };
  if (current >= reference) return { drop: false, reason: "not_lower" };
  const amount = money(reference - current);
  const percent = (amount / reference) * 100;
  if (percent + 1e-9 < Number(minPercent || 0)) return { drop: false, reason: "below_threshold", amount, percent };
  if (!inStock) return { drop: false, reason: "out_of_stock", amount, percent };
  return { drop: true, amount, percent: Math.round(percent) };
};

const cairoHour = (date) => Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Cairo", hour: "2-digit", hourCycle: "h23" }).format(date));

/* A price alert at 3am is a notification nobody wanted. Returns null for "now". */
export const quietHoursSendAt = (now = new Date()) => {
  const hour = cairoHour(now);
  const quiet = hour >= QUIET_HOURS.start || hour < QUIET_HOURS.end;
  if (!quiet) return null;
  const hoursUntil = hour >= QUIET_HOURS.start ? 24 - hour + QUIET_HOURS.end : QUIET_HOURS.end - hour;
  const at = new Date(now.getTime() + hoursUntil * 3600_000);
  at.setMinutes(0, 0, 0);
  return at;
};

export const productUrlFor = (product = {}, baseUrl = resolvePublicAppUrl()) =>
  `${String(baseUrl || "").replace(/\/+$/, "")}/shop/product/${encodeURIComponent(text(product.slug) || String(product.id || ""))}`;

export const buildPriceDropMessage = ({ product = {}, oldPrice, newPrice, customerName = "", baseUrl } = {}) => {
  const url = productUrlFor(product, baseUrl);
  const name = text(product.name);
  const firstName = text(customerName).split(/\s+/)[0] || "";
  const greeting = firstName ? `خبر حلو يا ${firstName} 🎉` : "خبر حلو 🎉";
  const body = `${greeting}\nالمنتج اللي بتتابعه سعره نزل.`;
  const priceLine = `بدل ${formatEgp(oldPrice)} بقى ${formatEgp(newPrice)} جنيه`;
  return {
    url,
    body,
    title: "السعر نزل",
    notificationBody: `${name}: ${priceLine}`,
    card: { imageUrl: text(product.image_url), body: `${name}\n${priceLine}`, buttonText: "اشتري دلوقتي 🛒", url },
    fallbackText: `${body}\n${name}\n${priceLine}\n\n${url}`,
  };
};

const loadSnapshots = async (tenantId, productIds) => {
  const { loadStorefrontProductPriceSnapshots } = await import("../controllers/storefrontController.js");
  return loadStorefrontProductPriceSnapshots(tenantId, productIds);
};

/* ---------------------------------------------------------------- customer-facing follow API */

const findCustomerId = async ({ tenantId, phone }) => {
  const variants = getPhoneSearchVariants(phone);
  if (!variants.length) return null;
  const result = await db.query(
    `SELECT id FROM customers WHERE tenant_id = $1 AND ${phoneSqlDigits("phone")} = ANY($2::text[]) ORDER BY id ASC LIMIT 1`,
    [tenantId, variants]
  ).catch(() => ({ rows: [] }));
  return result.rows[0]?.id || null;
};

/*
 * Follow or unfollow one product for one customer, through one of the two doors. The row stays
 * while either door holds it open; the reference resets only when the follow starts afresh, so
 * pressing the button on a product already in the wishlist keeps the price they first saw.
 */
export const setPriceAlertFollow = async ({ tenantId, customerId = null, phone, productId, source = "button", following = true }) => {
  await ensurePriceDropAlertSchema();
  // Normalised exactly as saveWishlist stores it, so both doors land on the same row.
  const cleanPhone = normalizePhone(text(phone));
  const id = Number(productId);
  if (!cleanPhone || !(id > 0)) {
    const error = new Error("phone and product_id are required");
    error.status = 400;
    throw error;
  }
  const column = source === "wishlist" ? "via_wishlist" : "via_button";
  const tenant = Number(tenantId) || 1;

  if (!following) {
    const result = await db.query(
      `UPDATE storefront_price_alerts SET ${column} = FALSE, updated_at = NOW()
       WHERE tenant_id = $1 AND phone = $2 AND product_id = $3
       RETURNING via_button, via_wishlist`,
      [tenant, cleanPhone, id]
    );
    const row = result.rows[0];
    return { following: Boolean(row && (row.via_button || row.via_wishlist)) };
  }

  const snapshot = (await loadSnapshots(tenant, [id])).get(id) || null;
  if (!snapshot && source === "button") {
    const error = new Error("Product not found");
    error.status = 404;
    throw error;
  }
  const price = snapshot?.price > 0 ? snapshot.price : null;
  const resolvedCustomerId = customerId || await findCustomerId({ tenantId: tenant, phone: cleanPhone });
  const result = await db.query(
    `
    INSERT INTO storefront_price_alerts (tenant_id, customer_id, phone, product_id, ${column}, followed_price, reference_price, last_seen_price)
    VALUES ($1, $2, $3, $4, TRUE, $5, $5, $5)
    ON CONFLICT (tenant_id, phone, product_id) DO UPDATE SET
      ${column} = TRUE,
      customer_id = COALESCE(storefront_price_alerts.customer_id, EXCLUDED.customer_id),
      followed_price = CASE WHEN storefront_price_alerts.via_button OR storefront_price_alerts.via_wishlist
        THEN COALESCE(storefront_price_alerts.followed_price, EXCLUDED.followed_price) ELSE EXCLUDED.followed_price END,
      reference_price = CASE WHEN storefront_price_alerts.via_button OR storefront_price_alerts.via_wishlist
        THEN COALESCE(storefront_price_alerts.reference_price, EXCLUDED.reference_price) ELSE EXCLUDED.reference_price END,
      updated_at = NOW()
    RETURNING product_id, followed_price, reference_price
    `,
    [tenant, resolvedCustomerId, cleanPhone, id, price]
  );
  const row = result.rows[0] || {};
  return { following: true, product_id: id, followed_price: row.followed_price === null ? null : Number(row.followed_price) };
};

/*
 * The detailed list prices every product it returns, so it stays bounded. It used to stop at 60
 * (max 100) while the wishlist follows every hearted product with no cap: past that a live follow
 * fell off the list, the product page bell offered "follow" for a product already followed and
 * could never unfollow it, and the wishlist panel missed its drops. The cap now covers any
 * realistic wishlist, and listPriceAlertFollowIds answers "is this followed?" with no cap at all.
 */
export const PRICE_ALERT_LIST_LIMIT = 200;
export const PRICE_ALERT_LIST_MAX = 500;
export const PRICE_ALERT_FOLLOW_IDS_MAX = 5000;

/* The customer's follows with today's price beside the price they followed at. */
export const listPriceAlertsForCustomer = async ({ tenantId, phone, limit = PRICE_ALERT_LIST_LIMIT }) => {
  await ensurePriceDropAlertSchema();
  const tenant = Number(tenantId) || 1;
  const result = await db.query(
    `
    SELECT product_id, via_button, via_wishlist, followed_price, reference_price, last_notified_at, created_at
    FROM storefront_price_alerts
    WHERE tenant_id = $1 AND phone = $2 AND (via_button OR via_wishlist)
    ORDER BY COALESCE(last_notified_at, created_at) DESC
    LIMIT $3
    `,
    [tenant, normalizePhone(text(phone)), Math.min(PRICE_ALERT_LIST_MAX, Math.max(1, Number(limit) || PRICE_ALERT_LIST_LIMIT))]
  );
  if (!result.rows.length) return [];
  const snapshots = await loadSnapshots(tenant, result.rows.map((row) => row.product_id));
  return result.rows.map((row) => {
    const product = snapshots.get(Number(row.product_id)) || null;
    const followed = row.followed_price === null ? null : Number(row.followed_price);
    const current = product?.price > 0 ? product.price : null;
    return {
      product_id: Number(row.product_id),
      via_button: row.via_button,
      via_wishlist: row.via_wishlist,
      followed_price: followed,
      current_price: current,
      dropped: Boolean(followed && current && current < followed),
      last_notified_at: row.last_notified_at,
      product: product ? { id: product.id, slug: product.slug, name: product.name, image_url: product.image_url, in_stock: product.in_stock } : null,
    };
  });
};

/* Every product this customer follows, ids only: no pricing, so no practical cap. */
export const listPriceAlertFollowIds = async ({ tenantId, phone }) => {
  await ensurePriceDropAlertSchema();
  const cleanPhone = normalizePhone(text(phone));
  if (!cleanPhone) return [];
  const result = await db.query(
    `
    SELECT product_id
    FROM storefront_price_alerts
    WHERE tenant_id = $1 AND phone = $2 AND (via_button OR via_wishlist)
    ORDER BY product_id
    LIMIT $3
    `,
    [Number(tenantId) || 1, cleanPhone, PRICE_ALERT_FOLLOW_IDS_MAX]
  );
  return result.rows.map((row) => Number(row.product_id)).filter((id) => id > 0);
};

/* ---------------------------------------------------------------- the background tick */

/*
 * The wishlist is the second door, and it is kept in step here rather than trusted to every code
 * path that writes customer_wishlist: a wishlist row switched on for price drops opens the door,
 * a deleted one (or one whose flag was switched off) closes it.
 */
const syncWishlistFollows = async () => {
  await db.query(`
    INSERT INTO storefront_price_alerts (tenant_id, customer_id, phone, product_id, via_wishlist)
    SELECT cw.tenant_id, cw.customer_id, cw.phone, cw.product_id, TRUE
    FROM customer_wishlist cw
    WHERE cw.notify_price_drop IS NOT FALSE AND COALESCE(cw.phone, '') <> ''
    ON CONFLICT (tenant_id, phone, product_id) DO UPDATE SET
      via_wishlist = TRUE,
      reference_price = CASE WHEN storefront_price_alerts.via_button OR storefront_price_alerts.via_wishlist
        THEN storefront_price_alerts.reference_price ELSE NULL END,
      followed_price = CASE WHEN storefront_price_alerts.via_button OR storefront_price_alerts.via_wishlist
        THEN storefront_price_alerts.followed_price ELSE NULL END,
      updated_at = NOW()
    WHERE storefront_price_alerts.via_wishlist = FALSE
  `);
  await db.query(`
    UPDATE storefront_price_alerts a SET via_wishlist = FALSE, updated_at = NOW()
    WHERE a.via_wishlist = TRUE
      AND NOT EXISTS (
        SELECT 1 FROM customer_wishlist cw
        WHERE cw.tenant_id = a.tenant_id AND cw.phone = a.phone AND cw.product_id = a.product_id
          AND cw.notify_price_drop IS NOT FALSE
      )
  `);
};

const claimAlert = async ({ alert, price }) => {
  const result = await db.query(
    `
    UPDATE storefront_price_alerts
    SET reference_price = $2, last_seen_price = $2, last_notified_price = $2, last_notified_at = NOW(),
        notify_count = notify_count + 1, checked_at = NOW(), updated_at = NOW()
    WHERE id = $1
      AND reference_price = $3
      AND (via_button OR via_wishlist)
      AND (last_notified_at IS NULL OR last_notified_at < NOW() - make_interval(hours => $4))
    RETURNING id, last_notified_at
    `,
    [alert.id, price, alert.reference_price, COOLDOWN_HOURS]
  );
  return result.rows[0] || null;
};

const notifyCustomer = async ({ alert, product, oldPrice, newPrice, config, claimedAt }) => {
  const customer = alert.customer_id
    ? (await db.query(`SELECT name FROM customers WHERE id = $1 LIMIT 1`, [alert.customer_id]).catch(() => ({ rows: [] }))).rows[0]
    : null;
  const message = buildPriceDropMessage({ product, oldPrice, newPrice, customerName: customer?.name || "" });

  await db.query(
    `INSERT INTO website_notifications (tenant_id, customer_id, phone, type, title, body, metadata)
     VALUES ($1, $2, $3, 'price_drop', $4, $5, $6::jsonb)`,
    [
      alert.tenant_id,
      alert.customer_id,
      alert.phone,
      message.title,
      message.notificationBody,
      JSON.stringify({ product_id: product.id, slug: product.slug, old_price: oldPrice, new_price: newPrice, url: message.url, image_url: product.image_url }),
    ]
  ).catch((error) => console.warn("[price-drop] website notification not written", { alert_id: alert.id, message: error?.message }));

  if (!config.whatsapp_enabled) return { whatsapp: "disabled" };

  const stamp = claimedAt instanceof Date ? claimedAt.toISOString() : String(claimedAt || "");
  const card = message.card;
  const queued = await queueWhatsappAutomation({
    tenantId: alert.tenant_id || 0,
    automationType: PRICE_DROP_AUTOMATION_TYPE,
    customerId: alert.customer_id || null,
    recipientPhone: alert.phone,
    send: { kind: "carousel", cards: [card], fallbackText: message.fallbackText },
    values: {
      customer_name: customer?.name || "",
      product_name: product.name,
      old_price: formatEgp(oldPrice),
      new_price: formatEgp(newPrice),
      product_url: message.url,
      store_name: "M1 Store",
    },
    fallbackBody: message.body,
    idempotencySuffix: `alert:${alert.id}:${stamp}`,
    scheduledAt: quietHoursSendAt(),
    onSent: {
      product_card_transcript: {
        session_id: normalizeWhatsappSessionId(alert.phone),
        product_cards: [{
          product_id: String(product.id),
          product_name: product.name,
          name: product.name,
          price: newPrice,
          image_url: product.image_url,
          quantity: 1,
        }],
        client_request_id: `price_drop:${alert.id}:${stamp}`,
        source: "price_drop_alert",
        source_path: "price_drop_automation",
        insert_source: "price_drop_automation",
        resolved_phone: normalizeWhatsappPhone(alert.phone),
      },
    },
    directSend: async () => {
      const { sendCartCarouselMessage } = await import("./whatsappGatewayService.js");
      return sendCartCarouselMessage({ phone: alert.phone, body: message.body, cards: [card], fallbackText: message.fallbackText });
    },
  }).catch((error) => {
    console.warn("[price-drop] whatsapp not sent", { alert_id: alert.id, phoneSuffix: text(alert.phone).slice(-4), message: error?.message || String(error) });
    return { queued: false, error: true };
  });
  return { whatsapp: queued };
};

export const runPriceDropAlertTick = async () => {
  const config = await loadPriceDropConfig();
  if (!config.enabled) return { notified: 0, reason: "disabled" };
  await ensurePriceDropAlertSchema();
  await syncWishlistFollows();

  // Oldest-checked first, so a large following is walked across ticks instead of starving its tail.
  const products = await db.query(
    `
    SELECT tenant_id, product_id
    FROM storefront_price_alerts
    WHERE via_button OR via_wishlist
    GROUP BY tenant_id, product_id
    ORDER BY MIN(COALESCE(checked_at, 'epoch'::timestamptz)) ASC
    LIMIT $1
    `,
    [PRODUCTS_PER_TICK]
  );
  if (!products.rows.length) return { notified: 0, products: 0 };

  const byTenant = new Map();
  for (const row of products.rows) {
    const tenant = Number(row.tenant_id) || 0;
    if (!byTenant.has(tenant)) byTenant.set(tenant, []);
    byTenant.get(tenant).push(Number(row.product_id));
  }

  let notified = 0;
  for (const [tenantId, productIds] of byTenant) {
    const snapshots = await loadSnapshots(tenantId, productIds);
    const alerts = await db.query(
      `
      SELECT id, tenant_id, customer_id, phone, product_id, followed_price, reference_price, last_notified_at
      FROM storefront_price_alerts
      WHERE tenant_id = $1 AND product_id = ANY($2::bigint[]) AND (via_button OR via_wishlist)
      `,
      [tenantId, productIds]
    );
    for (const alert of alerts.rows) {
      const product = snapshots.get(Number(alert.product_id));
      if (!product) {
        // Hidden, archived or gone: nothing to compare. Mark it checked so it does not hog the head of the walk.
        await db.query(`UPDATE storefront_price_alerts SET checked_at = NOW() WHERE id = $1`, [alert.id]).catch(() => {});
        continue;
      }
      const price = product.price;
      if (alert.reference_price === null || alert.reference_price === undefined) {
        // A wishlist follow that arrived without a price: today's price is what they saw.
        await db.query(
          `UPDATE storefront_price_alerts
           SET reference_price = $2, followed_price = COALESCE(followed_price, $2), last_seen_price = $2, checked_at = NOW()
           WHERE id = $1 AND reference_price IS NULL`,
          [alert.id, price > 0 ? price : null]
        ).catch(() => {});
        continue;
      }
      const referencePrice = Number(alert.reference_price);
      const verdict = evaluatePriceDrop({ referencePrice, currentPrice: price, inStock: product.in_stock, minPercent: config.min_percent });
      if (!verdict.drop) {
        await db.query(`UPDATE storefront_price_alerts SET last_seen_price = $2, checked_at = NOW() WHERE id = $1`, [alert.id, price > 0 ? price : null]).catch(() => {});
        continue;
      }
      const claimed = await claimAlert({ alert, price }).catch(() => null);
      if (!claimed) {
        await db.query(`UPDATE storefront_price_alerts SET last_seen_price = $2, checked_at = NOW() WHERE id = $1`, [alert.id, price]).catch(() => {});
        continue;
      }
      await notifyCustomer({ alert, product, oldPrice: referencePrice, newPrice: price, config, claimedAt: claimed.last_notified_at });
      notified += 1;
      console.info("[price-drop] customer notified", {
        alert_id: alert.id,
        product_id: product.id,
        old_price: referencePrice,
        new_price: price,
        phoneSuffix: text(alert.phone).slice(-4),
        whatsapp: config.whatsapp_enabled,
      });
    }
  }
  return { notified, products: products.rowCount };
};
