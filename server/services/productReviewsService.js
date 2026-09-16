/*
 * Product reviews — written only by someone who bought the product and received it.
 * ---------------------------------------------------------------------------
 * The whole value of a star rating is that it cannot be manufactured, so eligibility is
 * decided HERE, from the order book, and never from anything the client sends. A review row
 * is bound to a real order line: (order_id, product_id). That single fact gives us, for free,
 * the "verified buyer" badge, one review per purchase, and the impossibility of reviewing a
 * product the shop never sold to this phone.
 *
 * Delivered, not merely ordered: an order the customer has not yet received cannot be
 * reviewed. `shipping_events.status = 'delivered'` is the same signal the shipping centre
 * reads, so a review window opens exactly when Bosta says the box arrived.
 *
 * Nothing published without a human: rows land as `pending` and only the ERP can move them to
 * `published`. The rating summary — the number that reaches the page and the Product schema —
 * counts published rows alone, so a moderation queue is never a live rating.
 */

import db from "../database/db.js";
import { getPhoneSearchVariants, normalizePhone } from "../utils/phoneSearch.js";

export const REVIEW_STATUSES = Object.freeze(["pending", "published", "rejected"]);
export const REVIEW_BODY_MAX = 2000;
export const REVIEW_IMAGES_MAX = 5;
export const REVIEW_PAGE_DEFAULT = 10;
export const REVIEW_PAGE_MAX = 50;
/* A window, not a deadline: a year after delivery the memory is the product's, not this
 * purchase's, and an old order is the easiest thing for a stolen phone number to reach. */
export const REVIEW_WINDOW_DAYS = 365;

const err = (message, status = 400, code = "") => {
  const error = new Error(message);
  error.status = status;
  if (code) error.code = code;
  return error;
};

const text = (value = "") => String(value ?? "").trim();
const positiveInt = (value) => {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

let schemaReady = null;
export const ensureProductReviewsSchema = async (client = db) => {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS product_reviews (
        id BIGSERIAL PRIMARY KEY,
        tenant_id BIGINT NOT NULL,
        product_id BIGINT NOT NULL,
        variant_id BIGINT NULL,
        color TEXT NULL,
        size TEXT NULL,
        order_id BIGINT NOT NULL,
        customer_id BIGINT NULL,
        phone TEXT NULL,
        customer_name TEXT NULL,
        rating SMALLINT NOT NULL,
        body TEXT NULL,
        images JSONB NOT NULL DEFAULT '[]'::jsonb,
        status TEXT NOT NULL DEFAULT 'pending',
        moderated_by BIGINT NULL,
        moderated_at TIMESTAMPTZ NULL,
        moderation_note TEXT NULL,
        reply_body TEXT NULL,
        reply_at TIMESTAMPTZ NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT product_reviews_rating_range CHECK (rating BETWEEN 1 AND 5),
        CONSTRAINT product_reviews_status_known CHECK (status IN ('pending', 'published', 'rejected'))
      )
    `);
    // One purchase, one review. A second submission for the same order line updates the row it
    // already owns rather than stacking a second star on the same sale.
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_product_reviews_order_line
      ON product_reviews (tenant_id, order_id, product_id)`);
    // The product page's read: published rows for one product, newest first.
    await client.query(`CREATE INDEX IF NOT EXISTS idx_product_reviews_published
      ON product_reviews (tenant_id, product_id, created_at DESC) WHERE status = 'published'`);
    // The moderation queue's read.
    await client.query(`CREATE INDEX IF NOT EXISTS idx_product_reviews_status
      ON product_reviews (tenant_id, status, created_at DESC)`);
  })().catch((error) => {
    schemaReady = null; // a failed ensure must not become a cached rejection
    throw error;
  });
  return schemaReady;
};

/*
 * Every order line this phone is entitled to speak about: delivered, inside the window, kept.
 *
 * One query answers both of the storefront's questions, so the two can never disagree about who
 * is eligible — but they want different halves of the answer. The account page asks "what is
 * waiting for me to review?" and must not list purchases already reviewed (the default). Writing
 * a review asks "does this phone own this line?", and there the line stays eligible after the
 * first review, because a customer is allowed to correct what they wrote; `includeReviewed`
 * opens that. Each row carries its own review's id and status either way, so a caller can show
 * "you rated this 5 — edit" instead of pretending the purchase is not there.
 */
export const listReviewableItems = async (
  tenantId,
  { phone = "", productId = 0, limit = 50, includeReviewed = false, client = db } = {}
) => {
  const variants = getPhoneSearchVariants(phone);
  if (!positiveInt(tenantId) || !variants.length) return [];
  await ensureProductReviewsSchema(client);
  const wantedProduct = positiveInt(productId);
  const { rows } = await client.query(
    `
    SELECT
      o.id                AS order_id,
      -- What the customer calls this order. Orders carry several numbers; these are the two the
      -- shopper is ever shown (/track, the account page), with the row id as the last resort.
      COALESCE(NULLIF(o.display_order_number, ''), NULLIF(o.public_order_number, ''), o.id::text) AS order_number,
      oi.product_id       AS product_id,
      oi.variant_id       AS variant_id,
      oi.size             AS size,
      oi.color            AS color,
      p.name              AS product_name,
      p.slug              AS product_slug,
      delivery.delivered_at AS delivered_at,
      pr.id               AS review_id,
      pr.status           AS review_status,
      pr.rating           AS review_rating
    FROM orders o
    JOIN order_items oi ON oi.order_id = o.id
    JOIN products p ON p.id = oi.product_id
    JOIN LATERAL (
      SELECT MAX(se.created_at) AS delivered_at
      FROM shipping_events se
      WHERE se.order_id = o.id AND LOWER(se.status) = 'delivered'
    ) delivery ON TRUE
    LEFT JOIN product_reviews pr
      ON pr.tenant_id = o.tenant_id AND pr.order_id = o.id AND pr.product_id = oi.product_id
    WHERE o.tenant_id = $1
      AND regexp_replace(COALESCE(o.customer_phone, ''), '[^0-9]', '', 'g') = ANY($2::text[])
      AND delivery.delivered_at IS NOT NULL
      AND delivery.delivered_at > NOW() - ($3 || ' days')::interval
      -- A line that came back is not a purchase this customer kept.
      AND COALESCE(oi.quantity, 0) - COALESCE(oi.returned_quantity, 0) > 0
      AND ($6::boolean OR pr.id IS NULL)
      AND ($4::bigint = 0 OR oi.product_id = $4::bigint)
    GROUP BY o.id, o.display_order_number, o.public_order_number, oi.product_id, oi.variant_id,
             oi.size, oi.color, p.name, p.slug, delivery.delivered_at,
             pr.id, pr.status, pr.rating
    ORDER BY delivery.delivered_at DESC
    LIMIT $5
    `,
    [
      positiveInt(tenantId),
      variants,
      String(REVIEW_WINDOW_DAYS),
      wantedProduct,
      Math.min(REVIEW_PAGE_MAX, Math.max(1, Number(limit) || 50)),
      Boolean(includeReviewed),
    ]
  );
  return rows;
};

/*
 * Write a review. The client sends what the customer typed; the ORDER is looked up here, and a
 * body that names an order this phone does not own, or a product that order does not contain,
 * simply finds no eligible line and is refused. Nothing about the badge is taken on trust.
 */
export const createReview = async ({
  tenantId,
  orderId,
  productId,
  customerId = null,
  phone = "",
  customerName = "",
  rating,
  body = "",
  images = [],
  client = db,
} = {}) => {
  const tenant = positiveInt(tenantId);
  const order = positiveInt(orderId);
  const product = positiveInt(productId);
  const stars = Number.parseInt(String(rating ?? ""), 10);
  if (!tenant) throw err("tenant is required", 400);
  if (!order || !product) throw err("order_id and product_id are required", 400);
  if (!Number.isFinite(stars) || stars < 1 || stars > 5) throw err("rating must be 1 to 5", 400, "RATING_RANGE");

  await ensureProductReviewsSchema(client);
  // includeReviewed: a customer correcting their own review is still the owner of that purchase.
  const eligible = await listReviewableItems(tenant, { phone, productId: product, includeReviewed: true, client });
  const line = eligible.find((item) => Number(item.order_id) === order);
  if (!line) throw err("This order is not eligible for a review", 403, "NOT_ELIGIBLE");

  const cleanImages = (Array.isArray(images) ? images : [])
    .map((image) => text(typeof image === "string" ? image : image?.url))
    .filter(Boolean)
    .slice(0, REVIEW_IMAGES_MAX);

  const { rows } = await client.query(
    `
    INSERT INTO product_reviews
      (tenant_id, product_id, variant_id, size, color, order_id, customer_id, phone, customer_name,
       rating, body, images, status)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, 'pending')
    ON CONFLICT (tenant_id, order_id, product_id) DO UPDATE SET
      rating = EXCLUDED.rating,
      body = EXCLUDED.body,
      images = EXCLUDED.images,
      -- An edit re-enters the queue: the text a manager approved is not the text that stands.
      status = 'pending',
      moderated_by = NULL,
      moderated_at = NULL,
      updated_at = CURRENT_TIMESTAMP
    RETURNING *
    `,
    [
      tenant,
      product,
      line.variant_id || null,
      text(line.size) || null,
      text(line.color) || null,
      order,
      positiveInt(customerId) || null,
      normalizePhone(phone) || null,
      text(customerName).slice(0, 120) || null,
      stars,
      text(body).slice(0, REVIEW_BODY_MAX) || null,
      JSON.stringify(cleanImages),
    ]
  );
  return rows[0];
};

/*
 * What the product page shows, and the only numbers allowed anywhere near the Product schema:
 * published rows alone. `distribution` is the 5→1 bar chart; a shopper reads the shape of the
 * ratings faster than the average.
 */
export const getProductRatingSummary = async (tenantId, productIds = [], { client = db } = {}) => {
  const ids = (Array.isArray(productIds) ? productIds : [productIds]).map(positiveInt).filter(Boolean);
  if (!positiveInt(tenantId) || !ids.length) return new Map();
  await ensureProductReviewsSchema(client);
  const { rows } = await client.query(
    `
    SELECT
      product_id,
      COUNT(*)::int AS review_count,
      ROUND(AVG(rating)::numeric, 2)::float8 AS rating_average,
      COUNT(*) FILTER (WHERE rating = 5)::int AS star_5,
      COUNT(*) FILTER (WHERE rating = 4)::int AS star_4,
      COUNT(*) FILTER (WHERE rating = 3)::int AS star_3,
      COUNT(*) FILTER (WHERE rating = 2)::int AS star_2,
      COUNT(*) FILTER (WHERE rating = 1)::int AS star_1
    FROM product_reviews
    WHERE tenant_id = $1 AND product_id = ANY($2::bigint[]) AND status = 'published'
    GROUP BY product_id
    `,
    [positiveInt(tenantId), ids]
  );
  return new Map(
    rows.map((row) => [
      Number(row.product_id),
      {
        product_id: Number(row.product_id),
        review_count: row.review_count,
        rating_average: row.rating_average,
        distribution: { 5: row.star_5, 4: row.star_4, 3: row.star_3, 2: row.star_2, 1: row.star_1 },
      },
    ])
  );
};

/*
 * The name under a published review. A customer writing about a pair of shoes did not agree to
 * publish their full name on a page the whole internet reads, so the surname is reduced to an
 * initial — "محمد عبد الله" is shown as "محمد ع." — and someone who left no name is a customer.
 * The ERP queue still reads the full row: a manager judging a one-star has to be able to call.
 */
export const publicReviewerName = (value = "", fallback = "عميل") => {
  const parts = text(value).split(/\s+/).filter(Boolean);
  if (!parts.length) return fallback;
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${[...parts[1]][0]}.`;
};

/* The page of reviews under a product. Phone numbers never leave this function. */
export const listPublishedReviews = async (
  tenantId,
  productId,
  { limit = REVIEW_PAGE_DEFAULT, offset = 0, client = db } = {}
) => {
  if (!positiveInt(tenantId) || !positiveInt(productId)) return [];
  await ensureProductReviewsSchema(client);
  const { rows } = await client.query(
    `
    SELECT id, product_id, variant_id, size, color, customer_name, rating, body, images,
           reply_body, reply_at, created_at
    FROM product_reviews
    WHERE tenant_id = $1 AND product_id = $2 AND status = 'published'
    ORDER BY created_at DESC
    LIMIT $3 OFFSET $4
    `,
    [
      positiveInt(tenantId),
      positiveInt(productId),
      Math.min(REVIEW_PAGE_MAX, Math.max(1, Number(limit) || REVIEW_PAGE_DEFAULT)),
      Math.max(0, Number(offset) || 0),
    ]
  );
  return rows.map((row) => ({ ...row, customer_name: publicReviewerName(row.customer_name) }));
};

/* The ERP queue. Unlike the storefront read, this one carries the phone: a manager judging a
 * one-star needs to be able to call the customer. */
export const listReviewsForModeration = async (
  tenantId,
  { status = "pending", limit = 50, offset = 0, client = db } = {}
) => {
  if (!positiveInt(tenantId)) return [];
  await ensureProductReviewsSchema(client);
  const wanted = REVIEW_STATUSES.includes(text(status)) ? text(status) : "pending";
  const { rows } = await client.query(
    `
    SELECT pr.*, p.name AS product_name, p.slug AS product_slug,
           COALESCE(NULLIF(o.display_order_number, ''), NULLIF(o.public_order_number, ''), o.id::text) AS order_number
    FROM product_reviews pr
    JOIN products p ON p.id = pr.product_id
    LEFT JOIN orders o ON o.id = pr.order_id
    WHERE pr.tenant_id = $1 AND pr.status = $2
    ORDER BY pr.created_at DESC
    LIMIT $3 OFFSET $4
    `,
    [positiveInt(tenantId), wanted, Math.min(REVIEW_PAGE_MAX, Math.max(1, Number(limit) || 50)), Math.max(0, Number(offset) || 0)]
  );
  return rows;
};

export const moderateReview = async ({ tenantId, reviewId, status, note = "", actorId = null, client = db } = {}) => {
  const wanted = text(status);
  if (!["published", "rejected", "pending"].includes(wanted)) throw err("unknown review status", 400);
  if (!positiveInt(tenantId) || !positiveInt(reviewId)) throw err("review not found", 404);
  await ensureProductReviewsSchema(client);
  const { rows } = await client.query(
    `
    UPDATE product_reviews
    SET status = $3,
        moderation_note = NULLIF($4, ''),
        moderated_by = $5,
        moderated_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    WHERE tenant_id = $1 AND id = $2
    RETURNING *
    `,
    [positiveInt(tenantId), positiveInt(reviewId), wanted, text(note).slice(0, 500), positiveInt(actorId) || null]
  );
  if (!rows[0]) throw err("review not found", 404);
  return rows[0];
};

/* The shop's public answer under a review. Clearing it is sending an empty reply. */
export const replyToReview = async ({ tenantId, reviewId, body = "", client = db } = {}) => {
  if (!positiveInt(tenantId) || !positiveInt(reviewId)) throw err("review not found", 404);
  await ensureProductReviewsSchema(client);
  const reply = text(body).slice(0, REVIEW_BODY_MAX);
  const { rows } = await client.query(
    `
    UPDATE product_reviews
    SET reply_body = NULLIF($3, ''),
        reply_at = CASE WHEN NULLIF($3, '') IS NULL THEN NULL ELSE CURRENT_TIMESTAMP END,
        updated_at = CURRENT_TIMESTAMP
    WHERE tenant_id = $1 AND id = $2
    RETURNING *
    `,
    [positiveInt(tenantId), positiveInt(reviewId), reply]
  );
  if (!rows[0]) throw err("review not found", 404);
  return rows[0];
};
