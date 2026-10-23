import db from "../../database/db.js";
import { coloursNamedIn } from "../../utils/colourWords.js";

/*
 * «بلّغني لما المقاس ده ينزل» — the customer asks to be told when a model (a size, a colour of it)
 * comes back, and the shop actually does it. The sales agent writes the watch (its watch_restock
 * tool) only for something out of stock right now; this worker looks every few minutes and, the
 * first time the stock is there, hands the conversation to the "back_in_stock" follow-up sequence
 * (messageSequencesService.onCustomerSignal), which writes the message, keeps quiet hours and the
 * test-only audience. A watch fires once, and lapses after WATCH_DAYS.
 */

const text = (value = "") => String(value ?? "").trim();
export const WATCH_DAYS = 60;
const TICK_EVERY_MS = 10 * 60 * 1000;
const TICK_BATCH = 50;
let lastTickAt = 0;

let schemaReady = null;
export const ensureRestockWatchSchema = async (client = db) => {
  if (!schemaReady) {
    schemaReady = client.query(`
      CREATE TABLE IF NOT EXISTS customer_restock_watches (
        id BIGSERIAL PRIMARY KEY,
        tenant_id BIGINT NOT NULL,
        session_id TEXT NOT NULL,
        channel TEXT NOT NULL DEFAULT '',
        product_id BIGINT NOT NULL,
        product_name TEXT NOT NULL DEFAULT '',
        size TEXT NOT NULL DEFAULT '',
        color TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'active',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '${WATCH_DAYS} days',
        notified_at TIMESTAMPTZ NULL
      );
      CREATE INDEX IF NOT EXISTS idx_customer_restock_watches_active
        ON customer_restock_watches (status, created_at) WHERE status = 'active';
    `).catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  return schemaReady;
};

// Sizes and colours are compared exactly; a watch's colour is stored as the catalog spells it
// (resolveCatalogColour), so "Black" never fires for "White & Black".
export const variantMatchesWatch = (variant = {}, watch = {}) => {
  const size = text(watch.size).toLowerCase();
  const color = text(watch.color).toLowerCase();
  if (size && text(variant.size).toLowerCase() !== size) return false;
  if (color && text(variant.color).toLowerCase() !== color) return false;
  return true;
};

// «٤٧», « 47 », "47" → "47"; letter sizes (M, XL) pass through.
export const normalizeSize = (value = "") =>
  text(value)
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/[^\d.a-zA-Z]/g, "")
    .slice(0, 40);

// The customer says «الأسود», the catalog says "Black": the product's own colour that the words name.
// An exact name first, then the colour words (colourWords.js), a plain colour before a two-tone one.
export const resolveCatalogColour = (variants = [], spoken = "") => {
  const wanted = text(spoken).toLowerCase();
  if (!wanted) return "";
  const colours = [...new Set(variants.map((variant) => text(variant.color)).filter(Boolean))];
  const exact = colours.find((colour) => colour.toLowerCase() === wanted);
  if (exact) return exact;
  for (const name of [wanted, ...coloursNamedIn(spoken)]) {
    const plain = colours.find((colour) => colour.toLowerCase() === name);
    if (plain) return plain;
    const within = colours.find((colour) => colour.toLowerCase().includes(name));
    if (within) return within;
  }
  return "";
};

const variantsOf = async (client, { tenantId, productId }) => {
  const result = await client.query(
    `
    SELECT pv.size, pv.color, COALESCE(pv.stock, 0)::int AS stock, p.name AS product_name
    FROM product_variants pv
    JOIN products p ON p.id = pv.product_id
    WHERE pv.product_id = $1
      AND ($2::bigint IS NULL OR p.tenant_id = $2::bigint OR p.tenant_id IS NULL)
      AND pv.is_active IS DISTINCT FROM FALSE
      AND pv.deleted_at IS NULL
    `,
    [productId, tenantId]
  );
  return result.rows;
};

export const addRestockWatch = async ({ tenantId, sessionId, channel = "", productId, size = "", color = "", client = db } = {}) => {
  const id = Number(String(productId ?? "").replace(/\D/g, ""));
  if (!Number(tenantId) || !text(sessionId) || !Number.isInteger(id) || id <= 0) return { ok: false, reason: "bad_input" };
  await ensureRestockWatchSchema(client);
  const variants = await variantsOf(client, { tenantId: Number(tenantId), productId: id });
  if (!variants.length) return { ok: false, reason: "product_not_found" };
  const catalogColour = resolveCatalogColour(variants, color);
  if (text(color) && !catalogColour) return { ok: false, reason: "color_not_found" };
  const watch = { size: normalizeSize(size), color: catalogColour.slice(0, 60) };
  const matching = variants.filter((variant) => variantMatchesWatch(variant, watch));
  // In stock right now: nothing to wait for — the agent should just offer it.
  if (matching.some((variant) => Number(variant.stock) > 0)) return { ok: false, reason: "in_stock_now" };
  const existing = await client.query(
    `SELECT id FROM customer_restock_watches WHERE tenant_id = $1 AND session_id = $2 AND product_id = $3 AND size = $4 AND color = $5 AND status = 'active' LIMIT 1`,
    [Number(tenantId), text(sessionId), id, watch.size, watch.color]
  );
  if (existing.rows[0]) return { ok: true, id: Number(existing.rows[0].id), already_watching: true };
  const inserted = await client.query(
    `INSERT INTO customer_restock_watches (tenant_id, session_id, channel, product_id, product_name, size, color)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [Number(tenantId), text(sessionId), text(channel), id, text(variants[0].product_name), watch.size, watch.color]
  );
  return { ok: true, id: Number(inserted.rows[0].id) };
};

/*
 * Every TICK_EVERY_MS at most (it rides the one-minute sequences interval): lapse old watches, then
 * fire each active watch whose stock is back. `signal` is onCustomerSignal, replaceable in tests.
 */
export const runRestockWatchTick = async ({ client = db, signal = null, force = false } = {}) => {
  if (!force && Date.now() - lastTickAt < TICK_EVERY_MS) return { skipped: true };
  lastTickAt = Date.now();
  await ensureRestockWatchSchema(client);
  await client.query(`UPDATE customer_restock_watches SET status = 'expired' WHERE status = 'active' AND expires_at < NOW()`);
  const watches = await client.query(
    `SELECT * FROM customer_restock_watches WHERE status = 'active' ORDER BY created_at ASC LIMIT $1`,
    [TICK_BATCH]
  );
  const notify = signal || (await import("../../services/messageSequencesService.js")).onCustomerSignal;
  let fired = 0;
  for (const watch of watches.rows) {
    const variants = await variantsOf(client, { tenantId: Number(watch.tenant_id), productId: Number(watch.product_id) }).catch(() => []);
    if (!variants.some((variant) => Number(variant.stock) > 0 && variantMatchesWatch(variant, watch))) continue;
    // Claimed first, so two ticks never message the same customer twice.
    const claimed = await client.query(
      `UPDATE customer_restock_watches SET status = 'notified', notified_at = NOW() WHERE id = $1 AND status = 'active' RETURNING id`,
      [watch.id]
    );
    if (!claimed.rows.length) continue;
    await notify({
      tenantId: Number(watch.tenant_id),
      sessionId: watch.session_id,
      channel: watch.channel,
      signal: "back_in_stock",
      context: { product_id: Number(watch.product_id), product_name: watch.product_name, size: watch.size, color: watch.color },
    }).catch((error) => console.warn("[restock-watch:notify-failed]", { watch_id: watch.id, message: error?.message }));
    fired += 1;
  }
  return { checked: watches.rows.length, fired };
};
