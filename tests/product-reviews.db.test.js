/*
 * Who is allowed to leave a star, and when the star counts.
 *
 * Every guarantee this feature sells lives in SQL — "bought it", "received it", "once", "not
 * until a human approves". A mock of that SQL would only prove the mock works, so this runs
 * against a REAL database inside its own schema, which shadows orders / order_items /
 * shipping_events / products so the test cannot reach a real table. The schema is dropped when
 * it finishes, and the whole file skips itself when no database is reachable.
 */
import test from "node:test";
import assert from "node:assert/strict";

const SCHEMA = "product_reviews_test";
const CONNECT_TIMEOUT_MS = 3000;

const pgConfig = {
  connectionString: process.env.DATABASE_URL || undefined,
  user: process.env.PGUSER || "postgres",
  host: process.env.PGHOST || "localhost",
  database: process.env.PGDATABASE || "erp_db",
  password: process.env.PGPASSWORD || "065342",
  port: Number(process.env.PGPORT) || 5432,
  connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
};

const reachable = async () => {
  try {
    const pg = await import("pg");
    const Pool = pg.default?.Pool || pg.Pool;
    const pool = new Pool(pgConfig);
    await pool.query("SELECT 1");
    await pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await pool.query(`CREATE SCHEMA ${SCHEMA}`);
    await pool.end();
    return true;
  } catch {
    return false;
  }
};

const ready = await reachable();

if (!ready) {
  test("product reviews (skipped: no database)", { skip: true }, () => {});
} else {
  // Set before db.js is imported: the pool reads PGOPTIONS once, at module load.
  process.env.PGOPTIONS = `-c client_encoding=UTF8 -c search_path=${SCHEMA},public`;

  const { default: db } = await import("../server/database/db.js");
  const reviews = await import("../server/services/productReviewsService.js");

  // The four tables the eligibility query reads, shadowed. Only the columns it actually uses.
  await db.query(`CREATE TABLE products (id BIGINT PRIMARY KEY, name TEXT, slug TEXT)`);
  await db.query(`
    CREATE TABLE orders (
      id BIGINT PRIMARY KEY,
      tenant_id BIGINT,
      customer_phone TEXT,
      display_order_number TEXT,
      public_order_number TEXT
    )`);
  await db.query(`
    CREATE TABLE order_items (
      id BIGSERIAL PRIMARY KEY,
      order_id BIGINT,
      product_id BIGINT,
      variant_id BIGINT,
      quantity INT,
      returned_quantity INT,
      size TEXT,
      color TEXT
    )`);
  await db.query(`
    CREATE TABLE shipping_events (
      id BIGSERIAL PRIMARY KEY,
      order_id BIGINT,
      status TEXT,
      created_at TIMESTAMPTZ
    )`);
  await reviews.ensureProductReviewsSchema(db);

  const TENANT = 4242;
  const BUYER = "01099237793";
  const STRANGER = "01555555555";

  await db.query(`INSERT INTO products (id, name, slug) VALUES (7, 'Nike Air Force 1', 'nike-af1'), (8, 'Adidas Samba', 'adidas-samba')`);

  /* An order this phone placed, containing one line, delivered `daysAgo` days ago. */
  const seedDeliveredOrder = async ({ id, phone = BUYER, productId = 7, daysAgo = 3, quantity = 1, returned = 0 }) => {
    await db.query(
      `INSERT INTO orders (id, tenant_id, customer_phone, display_order_number) VALUES ($1, $2, $3, $4)`,
      [id, TENANT, phone, `M1-${id}`]
    );
    await db.query(
      `INSERT INTO order_items (order_id, product_id, variant_id, quantity, returned_quantity, size, color)
       VALUES ($1, $2, $3, $4, $5, '43', 'White & Black')`,
      [id, productId, 900 + id, quantity, returned]
    );
    if (daysAgo !== null) {
      await db.query(
        `INSERT INTO shipping_events (order_id, status, created_at) VALUES ($1, 'delivered', NOW() - ($2 || ' days')::interval)`,
        [id, String(daysAgo)]
      );
    }
  };

  test("a delivered order line is reviewable, and it carries what the shopper bought", async () => {
    await seedDeliveredOrder({ id: 101 });
    const items = await reviews.listReviewableItems(TENANT, { phone: BUYER });
    assert.equal(items.length, 1);
    assert.equal(Number(items[0].order_id), 101);
    assert.equal(Number(items[0].product_id), 7);
    assert.equal(items[0].order_number, "M1-101", "the number the customer sees, not the row id");
    assert.equal(items[0].size, "43");
    assert.equal(items[0].color, "White & Black");
  });

  test("an order that has not been delivered cannot be reviewed", async () => {
    await seedDeliveredOrder({ id: 102, productId: 8, daysAgo: null });
    const items = await reviews.listReviewableItems(TENANT, { phone: BUYER });
    assert.equal(items.some((item) => Number(item.order_id) === 102), false);
    await assert.rejects(
      () => reviews.createReview({ tenantId: TENANT, orderId: 102, productId: 8, phone: BUYER, rating: 5 }),
      (error) => error.code === "NOT_ELIGIBLE" && error.status === 403
    );
  });

  test("somebody else's delivered order is not reviewable by this phone", async () => {
    await seedDeliveredOrder({ id: 103, phone: STRANGER, productId: 8 });
    const mine = await reviews.listReviewableItems(TENANT, { phone: BUYER });
    assert.equal(mine.some((item) => Number(item.order_id) === 103), false);
    await assert.rejects(
      () => reviews.createReview({ tenantId: TENANT, orderId: 103, productId: 8, phone: BUYER, rating: 5 }),
      (error) => error.code === "NOT_ELIGIBLE"
    );
  });

  test("the phone matches however the order stored it", async () => {
    // Same person, three spellings. getPhoneSearchVariants is what makes them one customer.
    for (const [id, stored] of [[104, "201099237793"], [105, "+20 1099237793"], [106, "1099237793"]]) {
      await seedDeliveredOrder({ id, phone: stored, productId: 8 });
    }
    const items = await reviews.listReviewableItems(TENANT, { phone: BUYER });
    const ids = items.map((item) => Number(item.order_id));
    assert.deepEqual([104, 105, 106].filter((id) => ids.includes(id)), [104, 105, 106]);
  });

  test("a line that came back is not a purchase, and an old delivery is out of the window", async () => {
    await seedDeliveredOrder({ id: 107, productId: 8, quantity: 2, returned: 2 });
    await seedDeliveredOrder({ id: 108, productId: 8, daysAgo: reviews.REVIEW_WINDOW_DAYS + 5 });
    const ids = (await reviews.listReviewableItems(TENANT, { phone: BUYER })).map((item) => Number(item.order_id));
    assert.equal(ids.includes(107), false, "fully returned");
    assert.equal(ids.includes(108), false, "past the window");
    // A partial return is still a purchase they kept.
    await seedDeliveredOrder({ id: 109, productId: 8, quantity: 3, returned: 1 });
    const after = (await reviews.listReviewableItems(TENANT, { phone: BUYER })).map((item) => Number(item.order_id));
    assert.equal(after.includes(109), true);
  });

  test("a written review is pending, and a pending review is not a rating", async () => {
    const review = await reviews.createReview({
      tenantId: TENANT,
      orderId: 101,
      productId: 7,
      phone: BUYER,
      customerName: "Maged",
      rating: 5,
      body: "الكوتشي ممتاز والمقاس مظبوط",
      images: ["/uploads/reviews/a.jpg", "/uploads/reviews/b.jpg"],
    });
    assert.equal(review.status, "pending");
    assert.equal(review.rating, 5);
    assert.equal(review.size, "43", "the size is snapshotted from the order line, not sent by the client");
    assert.deepEqual(review.images, ["/uploads/reviews/a.jpg", "/uploads/reviews/b.jpg"]);

    // This is the whole trust property: the page shows nothing until a human says so.
    assert.deepEqual(await reviews.listPublishedReviews(TENANT, 7), []);
    assert.equal((await reviews.getProductRatingSummary(TENANT, [7])).size, 0);
  });

  test("publishing is what puts the star on the page", async () => {
    const pending = await reviews.listReviewsForModeration(TENANT);
    assert.equal(pending.length, 1);
    assert.equal(pending[0].product_name, "Nike Air Force 1");
    assert.equal(pending[0].order_number, "M1-101");
    // The queue page's tabs: every status present, zero included.
    assert.deepEqual(await reviews.getReviewCounts(TENANT), { pending: 1, published: 0, rejected: 0 });

    await reviews.moderateReview({ tenantId: TENANT, reviewId: pending[0].id, status: "published", actorId: 4 });
    assert.deepEqual(await reviews.getReviewCounts(TENANT), { pending: 0, published: 1, rejected: 0 });
    const published = await reviews.listPublishedReviews(TENANT, 7);
    assert.equal(published.length, 1);
    assert.equal(published[0].customer_name, "Maged");
    assert.equal("phone" in published[0], false, "a public row never carries the customer's phone");
    // The queue a manager reads keeps the whole name; the public page does not.
    assert.equal(pending[0].customer_name, "Maged");

    const summary = (await reviews.getProductRatingSummary(TENANT, [7])).get(7);
    assert.equal(summary.review_count, 1);
    assert.equal(summary.rating_average, 5);
    assert.equal(summary.distribution[5], 1);
  });

  test("a rejected review leaves the rating again", async () => {
    const [published] = await reviews.listReviewsForModeration(TENANT, { status: "published" });
    await reviews.moderateReview({ tenantId: TENANT, reviewId: published.id, status: "rejected", note: "صورة مش للمنتج" });
    assert.equal((await reviews.getProductRatingSummary(TENANT, [7])).size, 0);
    await reviews.moderateReview({ tenantId: TENANT, reviewId: published.id, status: "published" });
  });

  test("one purchase is one review, and editing it goes back to the queue", async () => {
    const second = await reviews.createReview({
      tenantId: TENANT,
      orderId: 101,
      productId: 7,
      phone: BUYER,
      rating: 2,
      body: "غيرت رأيي",
    });
    const { rows } = await db.query(`SELECT COUNT(*)::int AS n FROM product_reviews WHERE order_id = 101 AND product_id = 7`);
    assert.equal(rows[0].n, 1, "the same purchase never stacks a second star");
    assert.equal(second.rating, 2);
    assert.equal(second.status, "pending", "the approved text is not the text that now stands");
    assert.equal((await reviews.getProductRatingSummary(TENANT, [7])).size, 0, "and it leaves the rating while it waits");
  });

  test("the reviewed line disappears from what is left to review, but not from the purchase", async () => {
    const waiting = (await reviews.listReviewableItems(TENANT, { phone: BUYER })).map((item) => Number(item.order_id));
    assert.equal(waiting.includes(101), false, "the account page does not ask twice");

    // The purchase is still theirs, and it says what they said: "you rated this 2 — edit".
    const all = await reviews.listReviewableItems(TENANT, { phone: BUYER, includeReviewed: true });
    const line = all.find((item) => Number(item.order_id) === 101);
    assert.ok(line, "the reviewed purchase is still reachable");
    assert.equal(line.review_rating, 2);
    assert.equal(line.review_status, "pending");
  });

  test("a stranger cannot edit somebody else's review by naming their order", async () => {
    await assert.rejects(
      () => reviews.createReview({ tenantId: TENANT, orderId: 101, productId: 7, phone: STRANGER, rating: 1 }),
      (error) => error.code === "NOT_ELIGIBLE"
    );
    const { rows } = await db.query(`SELECT rating FROM product_reviews WHERE order_id = 101 AND product_id = 7`);
    assert.equal(rows[0].rating, 2, "untouched");
  });

  test("a rating outside 1-5 is refused before it reaches the table", async () => {
    for (const rating of [0, 6, -1, "٥", null]) {
      await assert.rejects(
        () => reviews.createReview({ tenantId: TENANT, orderId: 104, productId: 8, phone: BUYER, rating }),
        (error) => error.status === 400
      );
    }
  });

  test("the shop's reply rides along with the review, and clearing it clears the date", async () => {
    const [review] = await reviews.listReviewsForModeration(TENANT, { status: "pending" });
    await reviews.moderateReview({ tenantId: TENANT, reviewId: review.id, status: "published" });
    const replied = await reviews.replyToReview({ tenantId: TENANT, reviewId: review.id, body: "شكراً لحضرتك" });
    assert.equal(replied.reply_body, "شكراً لحضرتك");
    assert.ok(replied.reply_at instanceof Date);
    const cleared = await reviews.replyToReview({ tenantId: TENANT, reviewId: review.id, body: "  " });
    assert.equal(cleared.reply_body, null);
    assert.equal(cleared.reply_at, null);
  });

  test.after(async () => {
    await db.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await db.end?.();
  });
}
