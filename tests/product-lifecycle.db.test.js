/*
 * The product history dialog: when each colour/size entered the system, which purchase and
 * sales invoices it sits on, who made them - and never what it cost.
 *
 * Runs against a REAL database inside its own schema that shadows every table the queries
 * read, so it cannot touch real rows. Skips itself when no database is reachable.
 */
import test from "node:test";
import assert from "node:assert/strict";

const SCHEMA = "product_lifecycle_test";

const pgConfig = {
  connectionString: process.env.DATABASE_URL || undefined,
  user: process.env.PGUSER || "postgres",
  host: process.env.PGHOST || "localhost",
  database: process.env.PGDATABASE || "erp_db",
  password: process.env.PGPASSWORD || "065342",
  port: Number(process.env.PGPORT) || 5432,
  connectionTimeoutMillis: 3000,
};

const reachable = async () => {
  try {
    const pg = await import("pg");
    const Pool = pg.default?.Pool || pg.Pool;
    const pool = new Pool(pgConfig);
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
  test("product lifecycle (skipped: no database)", { skip: true }, () => {});
} else {
  process.env.PGOPTIONS = `-c client_encoding=UTF8 -c search_path=${SCHEMA},public`;
  const { default: db } = await import("../server/database/db.js");
  const lifecycle = await import("../server/lib/productLifecycle.js");

  const TENANT = 7;
  const OTHER_TENANT = 8;
  const PRODUCT = 50;

  await db.query(`CREATE TABLE users (id BIGINT PRIMARY KEY, name TEXT, email TEXT)`);
  await db.query(`CREATE TABLE suppliers (id BIGINT PRIMARY KEY, name TEXT)`);
  await db.query(`CREATE TABLE products (id BIGINT PRIMARY KEY, tenant_id BIGINT, name TEXT, sku TEXT, product_code TEXT, image_url TEXT, cost_price NUMERIC, created_at TIMESTAMPTZ)`);
  await db.query(`
    CREATE TABLE product_variants (
      id BIGINT PRIMARY KEY, tenant_id BIGINT, product_id BIGINT, color TEXT, size TEXT, article_code TEXT,
      stock INT DEFAULT 0, cost_price NUMERIC, image_url TEXT, is_active BOOLEAN DEFAULT TRUE, deleted_at TIMESTAMPTZ, created_at TIMESTAMPTZ
    )`);
  await db.query(`
    CREATE TABLE purchases (
      id BIGINT PRIMARY KEY, tenant_id BIGINT, supplier_id BIGINT, purchase_number TEXT, legacy_purchase_number TEXT,
      status TEXT, created_by BIGINT, created_at TIMESTAMPTZ, deleted_at TIMESTAMPTZ, deleted_by BIGINT,
      reversed_at TIMESTAMPTZ, reversed_by BIGINT
    )`);
  await db.query(`
    CREATE TABLE purchase_items (
      id BIGSERIAL PRIMARY KEY, purchase_id BIGINT, product_id BIGINT, variant_id BIGINT, quantity INT,
      cost_price NUMERIC, unit_cost NUMERIC, metadata JSONB DEFAULT '{}'::jsonb
    )`);
  await db.query(`
    CREATE TABLE orders (
      id BIGINT PRIMARY KEY, tenant_id BIGINT, invoice_number TEXT, public_order_number TEXT, display_order_number TEXT,
      status TEXT, seller_name TEXT, cashier_name TEXT, customer_name TEXT, channel TEXT, source TEXT,
      created_by BIGINT, created_at TIMESTAMPTZ, deleted_at TIMESTAMPTZ, deleted_by BIGINT
    )`);
  await db.query(`
    CREATE TABLE order_items (
      id BIGSERIAL PRIMARY KEY, order_id BIGINT, product_id BIGINT, variant_id BIGINT, quantity INT,
      returned_quantity INT DEFAULT 0, size TEXT, color TEXT
    )`);
  await db.query(`
    CREATE TABLE inventory_movements (
      id BIGSERIAL PRIMARY KEY, tenant_id BIGINT, product_id BIGINT, variant_id BIGINT, movement_type TEXT,
      quantity_change INT, quantity_before INT, quantity_after INT, unit_cost NUMERIC, reference_type TEXT,
      reference_id BIGINT, reason TEXT, notes TEXT, note TEXT, created_by BIGINT, created_at TIMESTAMPTZ,
      undone_at TIMESTAMPTZ, undone_by BIGINT
    )`);
  await db.query(`
    CREATE TABLE product_variant_images (
      id BIGSERIAL PRIMARY KEY, tenant_id BIGINT, product_id BIGINT, variant_id BIGINT, color_name TEXT, color_value TEXT,
      image_url TEXT, sort_order INT DEFAULT 0, is_primary BOOLEAN DEFAULT FALSE
    )`);
  await db.query(`
    CREATE TABLE audit_logs (
      id BIGSERIAL PRIMARY KEY, tenant_id BIGINT, user_id BIGINT, action TEXT, entity_type TEXT,
      entity_id BIGINT, details JSONB DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ DEFAULT NOW()
    )`);

  await db.query(`INSERT INTO users VALUES (1, 'Ahmed', 'a@x'), (2, 'Mona', 'm@x'), (3, NULL, 'sara@x')`);
  await db.query(`INSERT INTO suppliers VALUES (9, 'Eleven 7')`);
  await db.query(`INSERT INTO products VALUES ($1, $2, 'ADIDAS', 'ADS-10', 'ADS-10', '', 999, '2026-09-01T09:00:00+03')`, [PRODUCT, TENANT]);
  await db.query(`
    INSERT INTO product_variants (id, tenant_id, product_id, color, size, article_code, stock, cost_price, created_at, is_active) VALUES
      (501, $1, $2, 'Navy', '34', 'B253', 3, 999, '2026-09-01T09:00:10+03', TRUE),
      (502, $1, $2, 'Navy', '35', 'B253', 0, 999, '2026-09-01T09:00:20+03', TRUE),
      (503, $1, $2, 'White', '34', 'B254', 5, 999, '2026-09-05T12:00:00+03', FALSE)
  `, [TENANT, PRODUCT]);
  await db.query(`UPDATE product_variants SET image_url = '/uploads/white-own.jpg' WHERE id = 503`);
  await db.query(`
    INSERT INTO product_variant_images (tenant_id, product_id, variant_id, color_name, image_url, sort_order, is_primary) VALUES
      ($1, $2, NULL, 'navy', '/uploads/navy-back.jpg', 1, FALSE),
      ($1, $2, NULL, 'Navy', '/uploads/navy-front.jpg', 2, TRUE),
      ($1, $2, NULL, 'White', '/uploads/white-gallery.jpg', 0, FALSE),
      ($1, $2, 503, 'White', '/uploads/white-variant.jpg', 5, FALSE)
  `, [TENANT, PRODUCT]);
  await db.query(
    `INSERT INTO audit_logs (tenant_id, user_id, action, entity_type, entity_id, details)
     VALUES ($1, 1, 'product.variants_created', 'product', $2, '{"variant_ids":[501,502]}')`,
    [TENANT, PRODUCT]
  );
  await db.query(`
    INSERT INTO purchases VALUES
      (70, $1, 9, 'PO-70', NULL, 'fully_received', 2, '2026-09-02T10:00:00+03', NULL, NULL, NULL, NULL),
      (71, $1, 9, 'PO-71', NULL, 'fully_received', 2, '2026-09-03T10:00:00+03', '2026-09-04T10:00:00+03', 1, NULL, NULL),
      (72, $2, 9, 'PO-72', NULL, 'fully_received', 2, '2026-09-03T11:00:00+03', NULL, NULL, NULL, NULL)
  `, [TENANT, OTHER_TENANT]);
  await db.query(`
    INSERT INTO purchase_items (purchase_id, product_id, variant_id, quantity, cost_price, unit_cost) VALUES
      (70, $1, 501, 4, 999, 999), (70, $1, 502, 2, 999, 999),
      (71, $1, 501, 10, 999, 999),
      (72, $1, 501, 50, 999, 999)
  `, [PRODUCT]);
  await db.query(`
    INSERT INTO orders VALUES
      (80, $1, 'INV-80', NULL, NULL, 'confirmed', 'Mona', 'Sara', 'Customer A', 'pos', 'pos', 3, '2026-09-06T15:00:00+03', NULL, NULL),
      (81, $1, NULL, 'M1-81', NULL, 'cancelled', NULL, NULL, 'Customer B', 'website', 'website', NULL, '2026-09-07T15:00:00+03', NULL, NULL)
  `, [TENANT]);
  await db.query(`
    INSERT INTO order_items (order_id, product_id, variant_id, quantity, returned_quantity, size, color) VALUES
      (80, $1, 501, 1, 0, '34', 'Navy'),
      (81, $1, 502, 2, 0, '35', 'Navy')
  `, [PRODUCT]);
  await db.query(`
    INSERT INTO inventory_movements (tenant_id, product_id, variant_id, movement_type, quantity_change, quantity_before, quantity_after, unit_cost, reference_type, reference_id, reason, created_by, created_at) VALUES
      ($1, $2, 501, 'PURCHASE_IN', 4, 0, 4, 999, 'purchase', 70, NULL, 2, '2026-09-02T10:00:00+03'),
      ($1, $2, 501, 'SALE_OUT', -1, 4, 3, 999, 'order', 80, NULL, 3, '2026-09-06T15:00:00+03'),
      ($1, $2, 503, 'COUNT_ADJUSTMENT', 5, 0, 5, 999, 'inventory_count', 5, 'found in store', 1, '2026-09-08T09:00:00+03')
  `, [TENANT, PRODUCT]);

  const load = (options = {}) =>
    lifecycle.loadProductLifecycleEvents(db, { productId: PRODUCT, tenantId: TENANT, limit: 50, offset: 0, ...options });

  test("the timeline lists creation, purchases, sales and other movements, newest first", async () => {
    const { events, total } = await load();
    assert.deepEqual(
      events.map((event) => event.key),
      [
        "movement:3",
        "sale:81:Navy",
        "sale:80:Navy",
        "created:White:202609051200",
        "purchase:71:Navy",
        "purchase:70:Navy",
        "created:Navy:202609010900",
      ]
    );
    assert.equal(total, 7);
  });

  test("movements that mirror a purchase or a sale are not listed twice", async () => {
    const { events } = await load({ kinds: ["movement"] });
    assert.equal(events.length, 1);
    assert.equal(events[0].document_status, "COUNT_ADJUSTMENT");
    assert.equal(events[0].extra.reason, "found in store");
    assert.deepEqual(events[0].lines[0], { variant_id: 503, size: "34", quantity: 5, before: 0, after: 5 });
    assert.equal(events[0].actor_name, "Ahmed");
  });

  test("a colour's sizes created together are one event, with who added them", async () => {
    const { events } = await load({ kinds: ["created"] });
    const navy = events.find((event) => event.color === "Navy");
    assert.deepEqual(navy.lines.map((line) => line.size), ["34", "35"]);
    assert.equal(navy.actor_name, "Ahmed");
    const white = events.find((event) => event.color === "White");
    assert.equal(white.actor_name, null, "no audit row: unknown, never guessed");
  });

  test("a purchase invoice carries its number, supplier, author and quantities per size", async () => {
    const { events } = await load({ kinds: ["purchase"] });
    const po70 = events.find((event) => event.document_id === 70);
    assert.equal(po70.document_number, "PO-70");
    assert.equal(po70.party_name, "Eleven 7");
    assert.equal(po70.actor_name, "Mona");
    assert.equal(po70.quantity, 6);
    assert.deepEqual(po70.lines.map((line) => [line.size, line.quantity]), [["34", 4], ["35", 2]]);
    const po71 = events.find((event) => event.document_id === 71);
    assert.ok(po71.voided_at, "a deleted invoice stays in the history, marked");
    assert.equal(po71.voided_by_name, "Ahmed");
  });

  test("another tenant's invoice never appears", async () => {
    const { events } = await load({ kinds: ["purchase"] });
    assert.equal(events.some((event) => event.document_id === 72), false);
  });

  test("a sale shows the seller, cashier, customer and channel", async () => {
    const { events } = await load({ kinds: ["sale"] });
    const sale = events.find((event) => event.document_id === 80);
    assert.equal(sale.document_number, "INV-80");
    assert.equal(sale.actor_name, "Mona");
    assert.equal(sale.extra.cashier_name, "Sara");
    assert.equal(sale.extra.created_by_name, "sara@x");
    assert.equal(sale.party_name, "Customer A");
    assert.equal(sale.channel, "pos");
    assert.equal(events.find((event) => event.document_id === 81).document_number, "M1-81");
  });

  test("filters narrow by colour and by size", async () => {
    const white = await load({ color: "white" });
    assert.deepEqual(white.events.map((event) => event.key), ["movement:3", "created:White:202609051200"]);
    const size35 = await load({ size: "35" });
    assert.deepEqual(size35.events.map((event) => event.key), ["sale:81:Navy", "purchase:70:Navy", "created:Navy:202609010900"]);
  });

  test("pages report whether more events remain", async () => {
    const first = await load({ limit: 3, offset: 0 });
    assert.equal(first.events.length, 3);
    assert.equal(first.has_more, true);
    const last = await load({ limit: 3, offset: 6 });
    assert.equal(last.events.length, 1);
    assert.equal(last.has_more, false);
  });

  test("per-size totals count live invoices only", async () => {
    const variants = await lifecycle.loadProductLifecycleVariants(db, { productId: PRODUCT, tenantId: TENANT });
    const navy34 = variants.find((variant) => variant.id === 501);
    assert.equal(navy34.purchased_quantity, 4, "deleted PO-71 and the other tenant's PO-72 are excluded");
    assert.equal(navy34.purchase_invoices, 1);
    assert.equal(navy34.sold_quantity, 1);
    assert.equal(navy34.created_by_name, "Ahmed");
    const navy35 = variants.find((variant) => variant.id === 502);
    assert.equal(navy35.sold_quantity, 0, "a cancelled order is not a sale");
    assert.equal(variants.find((variant) => variant.id === 503).archived, true);

    const summary = lifecycle.summarizeLifecycleVariants(variants);
    assert.equal(summary.colors, 2);
    assert.equal(summary.purchased_quantity, 6);
    assert.equal(summary.stock, 3, "an archived size is not stock on hand");
  });

  test("each size row carries its colour picture: gallery primary first, then the row image", async () => {
    const variants = await lifecycle.loadProductLifecycleVariants(db, { productId: PRODUCT, tenantId: TENANT });
    const image = (id) => variants.find((variant) => variant.id === id).image_url;
    assert.equal(image(501), "/uploads/navy-front.jpg", "colour match is case-insensitive and the primary wins");
    assert.equal(image(502), "/uploads/navy-front.jpg");
    assert.equal(image(503), "/uploads/white-variant.jpg", "a picture pinned to the size row beats the colour gallery");
  });

  test("no cost ever leaves the server", async () => {
    const timeline = await load();
    const variants = await lifecycle.loadProductLifecycleVariants(db, { productId: PRODUCT, tenantId: TENANT });
    const header = await lifecycle.loadProductLifecycleHeader(db, { productId: PRODUCT, tenantId: TENANT });
    const payload = JSON.stringify({ timeline, variants, header });
    assert.equal(payload.includes("999"), false);
    assert.equal(/cost/i.test(payload), false);
  });

  test("a product from another tenant is not found", async () => {
    const header = await lifecycle.loadProductLifecycleHeader(db, { productId: PRODUCT, tenantId: OTHER_TENANT });
    assert.equal(header, null);
  });

  test.after(async () => {
    await db.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await db.end?.();
  });
}
