/*
 * Who entered the product: the employee PIN that proves it, and the product
 * history dialog reading that person's name instead of the shared ERP login.
 *
 * Runs against a REAL database inside its own schema that shadows every table
 * the queries read, so it cannot touch real rows. Skips itself when no database
 * is reachable.
 */
import test from "node:test";
import assert from "node:assert/strict";

const SCHEMA = "product_entry_employee_test";

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
  test("product entry employee (skipped: no database)", { skip: true }, () => {});
} else {
  process.env.PGOPTIONS = `-c client_encoding=UTF8 -c search_path=${SCHEMA},public`;
  const { default: db } = await import("../server/database/db.js");
  const lifecycle = await import("../server/lib/productLifecycle.js");
  const pins = await import("../server/services/employeeStaffPinService.js");

  const TENANT = 7;
  const PRODUCT = 90;
  const MAGED = 11;
  const SAMY = 12;

  await db.query(`CREATE TABLE users (id BIGINT PRIMARY KEY, name TEXT, email TEXT)`);
  await db.query(`
    CREATE TABLE employees (
      id BIGINT PRIMARY KEY, tenant_id BIGINT, branch_id BIGINT, employee_code TEXT, full_name TEXT,
      job_title TEXT, status TEXT DEFAULT 'active', updated_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  await db.query(`CREATE TABLE suppliers (id BIGINT PRIMARY KEY, name TEXT)`);
  await db.query(`CREATE TABLE products (id BIGINT PRIMARY KEY, tenant_id BIGINT, name TEXT, sku TEXT, product_code TEXT, image_url TEXT, cost_price NUMERIC, created_by_employee_id BIGINT, created_at TIMESTAMPTZ)`);
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
  await db.query(`CREATE TABLE branches (id BIGINT PRIMARY KEY, name TEXT)`);
  await db.query(`
    CREATE TABLE inventory_count_sessions (
      id BIGINT PRIMARY KEY, tenant_id BIGINT, branch_id BIGINT, title TEXT, status TEXT,
      submitted_by BIGINT, submitted_at TIMESTAMPTZ, opened_by BIGINT, created_by BIGINT,
      approved_by BIGINT, created_at TIMESTAMPTZ
    )`);
  await db.query(`
    CREATE TABLE inventory_count_items (
      id BIGSERIAL PRIMARY KEY, inventory_count_session_id BIGINT, inventory_count_id BIGINT,
      product_id BIGINT, product_variant_id BIGINT, variant_id BIGINT,
      system_quantity INT, counted_quantity INT, difference_quantity INT,
      counted_by BIGINT, counted_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
    )`);

  await db.query(`INSERT INTO users VALUES (1, 'حساب المحل', 'shop@x')`);
  await db.query(
    `INSERT INTO employees (id, tenant_id, employee_code, full_name, job_title, status) VALUES
       ($1, $3, 'E-11', 'ماجد', 'بائع', 'active'),
       ($2, $3, 'E-12', 'سامي', 'بائع', 'active')`,
    [MAGED, SAMY, TENANT]
  );
  await db.query(`INSERT INTO products (id, tenant_id, name, sku, product_code, image_url, created_by_employee_id, created_at) VALUES ($1, $2, 'ADIDAS', 'ADS-90', 'ADS-90', '', $3, NOW())`, [PRODUCT, TENANT, MAGED]);
  await db.query(
    `INSERT INTO product_variants (id, tenant_id, product_id, color, size, stock, created_at) VALUES
       (901, $1, $2, 'Navy', '40', 1, NOW()),
       (902, $1, $2, 'Beige', '41', 1, NOW()),
       (903, $1, $2, 'White', '42', 1, NOW())`,
    [TENANT, PRODUCT]
  );
  // 901: PIN-verified employee. 902: the employee row is gone, only the stamped
  // name survives. 903: an old row saved before PINs existed.
  await db.query(
    `INSERT INTO audit_logs (tenant_id, user_id, action, entity_type, entity_id, details) VALUES
       ($1, 1, 'product.variants_created', 'product', $2, $3::jsonb),
       ($1, 1, 'product.variants_created', 'product', $2, $4::jsonb),
       ($1, 1, 'product.variants_created', 'product', $2, '{"variant_ids":[903]}')`,
    [
      TENANT,
      PRODUCT,
      JSON.stringify({ variant_ids: [901], entry_employee_id: MAGED, entry_employee_name: "ماجد" }),
      JSON.stringify({ variant_ids: [902], entry_employee_id: 999, entry_employee_name: "موظف قديم" }),
    ]
  );

  const variantsByColor = async () => {
    const rows = await lifecycle.loadProductLifecycleVariants(db, { productId: PRODUCT, tenantId: TENANT });
    return new Map(rows.map((row) => [row.color, row]));
  };

  test("the colour shows the employee who typed it, not the shared login", async () => {
    const rows = await variantsByColor();
    assert.equal(rows.get("Navy").created_by_name, "ماجد");
  });

  test("a deleted employee still answers who added it, from the stamped name", async () => {
    const rows = await variantsByColor();
    assert.equal(rows.get("Beige").created_by_name, "موظف قديم");
  });

  test("a row saved before PINs existed still shows the ERP login", async () => {
    const rows = await variantsByColor();
    assert.equal(rows.get("White").created_by_name, "حساب المحل");
  });

  test("the history header names the employee who entered the product", async () => {
    const header = await lifecycle.loadProductLifecycleHeader(db, { productId: PRODUCT, tenantId: TENANT });
    assert.equal(header.created_by_employee_id, MAGED);
    assert.equal(header.created_by_employee_name, "ماجد");
  });

  test("the timeline event carries the employee too", async () => {
    const { events } = await lifecycle.loadProductLifecycleEvents(db, {
      productId: PRODUCT,
      tenantId: TENANT,
      kinds: ["created"],
      limit: 50,
      offset: 0,
    });
    const navy = events.find((event) => event.color === "Navy");
    assert.equal(navy.actor_name, "ماجد");
  });

  test("a PIN is set from the portal and then proves the employee", async () => {
    await pins.setEmployeeStaffPin({ employeeId: MAGED, tenantId: TENANT, pin: "4827" });
    const verified = await pins.verifyEmployeeStaffPin({ employeeId: MAGED, tenantId: TENANT, pin: "4827" });
    assert.equal(verified.name, "ماجد");
    // Arabic-Indic digits are what an Arabic keyboard actually sends.
    const arabicDigits = await pins.verifyEmployeeStaffPin({ employeeId: MAGED, tenantId: TENANT, pin: "٤٨٢٧" });
    assert.equal(arabicDigits.id, MAGED);
  });

  test("nobody can enter under another employee's name", async () => {
    await pins.setEmployeeStaffPin({ employeeId: SAMY, tenantId: TENANT, pin: "9351" });
    await assert.rejects(
      () => pins.verifyEmployeeStaffPin({ employeeId: SAMY, tenantId: TENANT, pin: "4827" }),
      (error) => error.code === "staff_pin_invalid"
    );
    const stored = await db.query(`SELECT staff_pin_hash FROM employees WHERE id = $1`, [SAMY]);
    assert.notEqual(stored.rows[0].staff_pin_hash, "9351", "the PIN is stored hashed, never in the clear");
  });

  test("an employee with no PIN cannot be picked", async () => {
    await db.query(`INSERT INTO employees (id, tenant_id, employee_code, full_name, status) VALUES (13, $1, 'E-13', 'بدون رقم', 'active')`, [TENANT]);
    await assert.rejects(
      () => pins.verifyEmployeeStaffPin({ employeeId: 13, tenantId: TENANT, pin: "1122" }),
      (error) => error.code === "staff_pin_missing"
    );
    const listed = await pins.listProductEntryEmployees({ tenantId: TENANT });
    assert.equal(listed.find((row) => row.id === 13).has_pin, false);
    assert.equal(listed.find((row) => row.id === MAGED).has_pin, true);
  });

  test("changing a PIN needs the current one", async () => {
    await assert.rejects(
      () => pins.setEmployeeStaffPin({ employeeId: SAMY, tenantId: TENANT, pin: "7742" }),
      (error) => error.code === "staff_pin_current_required"
    );
    await assert.rejects(
      () => pins.setEmployeeStaffPin({ employeeId: SAMY, tenantId: TENANT, pin: "7742", currentPin: "0000" }),
      (error) => error.code === "staff_pin_current_invalid"
    );
    await pins.setEmployeeStaffPin({ employeeId: SAMY, tenantId: TENANT, pin: "7742", currentPin: "9351" });
    const verified = await pins.verifyEmployeeStaffPin({ employeeId: SAMY, tenantId: TENANT, pin: "7742" });
    assert.equal(verified.id, SAMY);
  });

  test("a guessable PIN is refused", async () => {
    for (const pin of ["12", "1111", "1234"]) {
      await assert.rejects(
        () => pins.setEmployeeStaffPin({ employeeId: 13, tenantId: TENANT, pin }),
        (error) => error.code === "staff_pin_length" || error.code === "staff_pin_weak",
        `refused: ${pin}`
      );
    }
  });

  test("the save trusts a signed token, and refuses one issued for someone else", async () => {
    const token = pins.issueProductEntryToken({ id: MAGED, tenant_id: TENANT, name: "ماجد" });
    const resolved = await pins.resolveProductEntryEmployee({ tenantId: TENANT, token });
    assert.equal(resolved.id, MAGED);
    await assert.rejects(
      () => pins.resolveProductEntryEmployee({ tenantId: TENANT, token, employeeId: SAMY }),
      (error) => error.code === "entry_employee_mismatch"
    );
    // A tampered token is not an identity.
    assert.equal(await pins.resolveProductEntryEmployee({ tenantId: TENANT, token: `${token}x` }), null);
    assert.equal(await pins.resolveProductEntryEmployee({ tenantId: TENANT }), null);
  });

  test("repeated wrong PINs lock the employee out for a while", async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await assert.rejects(() => pins.verifyEmployeeStaffPin({ employeeId: MAGED, tenantId: TENANT, pin: "0001" }));
    }
    await assert.rejects(
      () => pins.verifyEmployeeStaffPin({ employeeId: MAGED, tenantId: TENANT, pin: "4827" }),
      (error) => error.code === "staff_pin_locked",
      "the right PIN is refused too while locked"
    );
  });

  test("the gate arms itself with the first PIN", async () => {
    // A tenant where nobody has a PIN yet must not be locked out of its catalogue.
    assert.equal(await pins.hasAnyStaffPin({ tenantId: 99 }), false);
    assert.equal(await pins.hasAnyStaffPin({ tenantId: TENANT }), true);
  });

  test.after(async () => {
    await db.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await db.end?.();
  });
}
