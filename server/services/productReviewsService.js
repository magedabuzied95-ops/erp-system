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

import { createHmac } from "node:crypto";

import db from "../database/db.js";
import { generateOrderLinkCode, orderLinkSecret } from "../utils/orderLinkSecret.js";
import { getPhoneSearchVariants, normalizePhone } from "../utils/phoneSearch.js";
import { resolvePublicAppUrl } from "../utils/whatsapp.js";

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
  { phone = "", productId = 0, orderId = 0, limit = 50, includeReviewed = false, client = db } = {}
) => {
  const variants = getPhoneSearchVariants(phone);
  if (!positiveInt(tenantId) || !variants.length) return [];
  await ensureProductReviewsSchema(client);
  const wantedProduct = positiveInt(productId);
  // One row per (order, product) — the unit a review is written for. An order holding the same
  // shoe in two sizes is one purchase to review, not two; its sizes and colours are listed
  // together, and the first variant stands for the line.
  const { rows } = await client.query(
    `
    SELECT
      o.id                AS order_id,
      -- What the customer calls this order. Orders carry several numbers; these are the two the
      -- shopper is ever shown (/track, the account page), with the row id as the last resort.
      COALESCE(NULLIF(o.display_order_number, ''), NULLIF(o.public_order_number, ''), o.id::text) AS order_number,
      oi.product_id       AS product_id,
      MIN(oi.variant_id)  AS variant_id,
      string_agg(DISTINCT NULLIF(oi.size, ''), ', ')  AS size,
      string_agg(DISTINCT NULLIF(oi.color, ''), ', ') AS color,
      p.name              AS product_name,
      p.slug              AS product_slug,
      COALESCE(
        MIN(NULLIF(oi.variant_image, '')), MIN(NULLIF(oi.product_image, '')), MIN(NULLIF(oi.image_url, '')),
        NULLIF(p.thumbnail_url, ''), NULLIF(p.image_url, '')
      )                   AS product_image,
      delivery.delivered_at AS delivered_at,
      pr.id               AS review_id,
      pr.status           AS review_status,
      pr.rating           AS review_rating,
      -- pr.id is grouped and is the table's key, so the rest of the row may be read as is.
      pr.body             AS review_body,
      pr.images           AS review_images
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
      AND ($7::bigint = 0 OR o.id = $7::bigint)
    GROUP BY o.id, o.display_order_number, o.public_order_number, oi.product_id,
             p.name, p.slug, p.thumbnail_url, p.image_url, delivery.delivered_at,
             pr.id, pr.status, pr.rating
    ORDER BY delivery.delivered_at DESC, MIN(oi.id)
    LIMIT $5
    `,
    [
      positiveInt(tenantId),
      variants,
      String(REVIEW_WINDOW_DAYS),
      wantedProduct,
      Math.min(REVIEW_PAGE_MAX, Math.max(1, Number(limit) || 50)),
      Boolean(includeReviewed),
      positiveInt(orderId),
    ]
  );
  return rows;
};

/* ------------------------------------------------------------ review link
 *
 * The link a customer taps in the WhatsApp message (/review/:code). Asking someone to sign in
 * with a one-time code before they may say "the shoes were great" loses most of the reviews, so
 * the code IS the credential — exactly like the shipping-fee upload link (/pay/:code). It lives in
 * the same order_confirmation_codes table under its own action and its own HMAC namespace, so a
 * review code can never confirm, cancel or pay anything, and those codes can never write a
 * review. All a review code can do is write a review for a product in ITS order, and the phone
 * the eligibility is checked against is the order's own.
 */
export const REVIEW_LINK_ACTION = "product_review";
// Long enough to cover a slow reply to the message; the review window itself is REVIEW_WINDOW_DAYS.
const REVIEW_LINK_TTL_DAYS = Math.max(1, Number(process.env.REVIEW_LINK_TTL_DAYS || 45) || 45);
const REVIEW_LINK_REUSE_MIN_MS = 7 * 24 * 60 * 60 * 1000;

export const hashReviewLinkCode = (code = "") =>
  createHmac("sha256", orderLinkSecret()).update(`${REVIEW_LINK_ACTION}:${text(code)}`).digest("hex");

export const reviewLinkPublicUrl = (code = "") => {
  const safeCode = text(code);
  if (!safeCode) return "";
  return `${text(resolvePublicAppUrl()).replace(/\/+$/, "")}/review/${encodeURIComponent(safeCode)}`;
};

// One live link per order, handed out again while it has a week left, so the account page and a
// WhatsApp message sent the same day point at the same code.
export const issueReviewLink = async ({ tenantId, orderId, client = db } = {}) => {
  const tenant = positiveInt(tenantId);
  const order = positiveInt(orderId);
  if (!tenant || !order) throw err("order is required", 400, "ORDER_REQUIRED");
  const existing = await client.query(
    `SELECT code, expires_at FROM order_confirmation_codes WHERE tenant_id = $1 AND order_id = $2 AND action = $3 LIMIT 1`,
    [tenant, order, REVIEW_LINK_ACTION]
  );
  const row = existing.rows[0];
  if (row?.code && new Date(row.expires_at).getTime() - Date.now() > REVIEW_LINK_REUSE_MIN_MS) {
    return { code: row.code, url: reviewLinkPublicUrl(row.code), expiresAt: row.expires_at };
  }
  const code = generateOrderLinkCode();
  const expiresAt = new Date(Date.now() + REVIEW_LINK_TTL_DAYS * 24 * 60 * 60 * 1000);
  await client.query(
    `
    INSERT INTO order_confirmation_codes (tenant_id, order_id, action, code, code_hash, expires_at, used_at, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, NULL, NOW(), NOW())
    ON CONFLICT (tenant_id, order_id, action)
    DO UPDATE SET code = EXCLUDED.code, code_hash = EXCLUDED.code_hash, expires_at = EXCLUDED.expires_at,
                  used_at = NULL, used_action = NULL, used_order_status = NULL, updated_at = NOW()
    `,
    [tenant, order, REVIEW_LINK_ACTION, code, hashReviewLinkCode(code), expiresAt]
  );
  return { code, url: reviewLinkPublicUrl(code), expiresAt };
};

// The order a code stands for. Matched by hash AND action, so a /pay/ or /c/ code is simply
// unknown here. Unknown and expired are told apart because the page says different things.
const resolveReviewLinkOrder = async (code = "", { client = db } = {}) => {
  const safeCode = text(code);
  if (!/^[A-Za-z0-9]{16}$/.test(safeCode)) throw err("Unknown review link", 404, "REVIEW_LINK_NOT_FOUND");
  const { rows } = await client.query(
    `
    SELECT c.tenant_id, c.order_id, c.expires_at, o.customer_phone, o.customer_name,
           COALESCE(NULLIF(o.display_order_number, ''), NULLIF(o.public_order_number, ''), o.id::text) AS order_number
    FROM order_confirmation_codes c
    JOIN orders o ON o.id = c.order_id
    WHERE c.code_hash = $1 AND c.action = $2
    LIMIT 1
    `,
    [hashReviewLinkCode(safeCode), REVIEW_LINK_ACTION]
  );
  const row = rows[0];
  if (!row) throw err("Unknown review link", 404, "REVIEW_LINK_NOT_FOUND");
  if (new Date(row.expires_at).getTime() <= Date.now()) throw err("This review link has expired", 410, "REVIEW_LINK_EXPIRED");
  return row;
};

const firstName = (name = "") => text(name).split(/\s+/).filter(Boolean)[0] || "";

const linkItemView = (item = {}) => ({
  product_id: Number(item.product_id),
  product_name: item.product_name,
  product_slug: item.product_slug,
  product_image: item.product_image || "",
  size: item.size || "",
  color: item.color || "",
  // The customer's own words and photo count come back so an edit starts from what they wrote;
  // this page is reached only with their order's code.
  review: item.review_id
    ? {
      id: Number(item.review_id),
      status: item.review_status,
      rating: item.review_rating,
      body: item.review_body || "",
      photo_count: Array.isArray(item.review_images) ? item.review_images.length : 0,
    }
    : null,
});

/* What /review/:code shows: the order's products, each with the review already written for it. */
export const loadReviewLinkPage = async ({ code, client = db } = {}) => {
  const order = await resolveReviewLinkOrder(code, { client });
  const items = await listReviewableItems(order.tenant_id, {
    phone: order.customer_phone,
    orderId: order.order_id,
    includeReviewed: true,
    client,
  });
  return {
    order_number: order.order_number,
    // A first name to greet with; the surname never leaves the server on this page either.
    customer_first_name: firstName(order.customer_name),
    items: items.map(linkItemView),
  };
};

export const submitReviewLink = async ({ code, productId, rating, body = "", images = [], client = db } = {}) => {
  const order = await resolveReviewLinkOrder(code, { client });
  const review = await createReview({
    tenantId: order.tenant_id,
    orderId: order.order_id,
    productId,
    phone: order.customer_phone,
    customerName: order.customer_name || "",
    rating,
    body,
    images,
    client,
  });
  await client.query(
    `UPDATE order_confirmation_codes SET used_at = COALESCE(used_at, NOW()), used_action = 'review', updated_at = NOW()
     WHERE tenant_id = $1 AND order_id = $2 AND action = $3`,
    [order.tenant_id, order.order_id, REVIEW_LINK_ACTION]
  );
  return { id: Number(review.id), product_id: Number(review.product_id), rating: review.rating, status: review.status };
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
      -- An edit that brings no photos keeps the ones already there: changing the stars must not
      -- quietly delete the pictures. New photos replace the old set, and the page says so.
      images = CASE WHEN jsonb_array_length(EXCLUDED.images) = 0 THEN product_reviews.images ELSE EXCLUDED.images END,
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
           -- The review keeps its own order_id, so a number survives even an order that was
           -- deleted after the review was written.
           COALESCE(NULLIF(o.display_order_number, ''), NULLIF(o.public_order_number, ''), pr.order_id::text) AS order_number
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

/* The three tab counts on the moderation page. Every status is present, zero or not, so the
 * page never has to guess whether a missing key means "none" or "not loaded". */
export const getReviewCounts = async (tenantId, { client = db } = {}) => {
  const counts = Object.fromEntries(REVIEW_STATUSES.map((status) => [status, 0]));
  if (!positiveInt(tenantId)) return counts;
  await ensureProductReviewsSchema(client);
  const { rows } = await client.query(
    `SELECT status, COUNT(*)::int AS n FROM product_reviews WHERE tenant_id = $1 GROUP BY status`,
    [positiveInt(tenantId)]
  );
  rows.forEach((row) => {
    if (row.status in counts) counts[row.status] = row.n;
  });
  return counts;
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
