import bcrypt from "bcryptjs";
import process from "node:process";
import db from "../database/db.js";

const modules = [
  "dashboard",
  "products",
  "pos",
  "orders",
  "purchases",
  "suppliers",
  "customers",
  "inventory",
  "warehouses",
  "branches",
  "accounting",
  "loyalty",
  "employees",
  "reports",
  "settings",
  "marketing",
  "website",
  "roles",
  "users",
  "attendance",
];

const actions = ["view", "create", "edit", "update", "delete", "approve", "export", "print", "transfer", "redeem"];
const marketingActions = ["view", "create", "update", "delete", "publish", "settings"];
const websiteActions = ["view", "orders", "settings"];
const attendancePermissions = [
  "attendance.view",
  "attendance.create",
  "attendance.edit",
  "attendance.update",
  "attendance.delete",
];
const marketingPermissions = [
  "marketing.view",
  "marketing.create",
  "marketing.update",
  "marketing.delete",
  "marketing.publish",
  "marketing.settings",
];
const websitePermissions = ["website.view", "website.orders", "website.settings"];

const getModuleActions = (moduleName) => {
  if (moduleName === "marketing") return marketingActions;
  if (moduleName === "website") return websiteActions;
  return actions;
};

const extraPermissions = [
  { module: "products", action: "barcode_shop", description: "print product Barcode Shop QR labels" },
  { module: "pos", action: "scan_product_qr", description: "scan Barcode Shop product QR labels in POS" },
  { module: "pos", action: "sell", description: "sell through POS" },
  { module: "inventory", action: "movements:view", description: "view inventory movement history" },
  { module: "inventory", action: "movements:undo", description: "undo manual inventory stock adjustments" },
  { module: "inventory", action: "alerts:view", description: "view low stock alerts" },
];

const roleMatrix = {
  super_admin: [
    ...modules.flatMap((module) => getModuleActions(module).map((action) => `${module}.${action}`)),
    ...attendancePermissions,
    ...marketingPermissions,
    ...websitePermissions,
    "products.barcode_shop",
    "pos.scan_product_qr",
    "pos.sell",
    "inventory.movements:view",
    "inventory.movements:undo",
    "inventory.alerts:view",
  ],
  admin: [
    ...modules.flatMap((module) => getModuleActions(module).map((action) => `${module}.${action}`)),
    ...attendancePermissions,
    ...marketingPermissions,
    ...websitePermissions,
    "products.barcode_shop",
    "pos.scan_product_qr",
    "pos.sell",
    "inventory.movements:view",
    "inventory.movements:undo",
    "inventory.alerts:view",
  ],
  manager: [
    "dashboard.view",
    "products.view",
    "products.create",
    "products.edit",
    "pos.view",
    "pos.create",
    "orders.view",
    "orders.create",
    "purchases.view",
    "purchases.create",
    "suppliers.view",
    "inventory.view",
    "warehouses.view",
    "accounting.view",
    "loyalty.view",
    "loyalty.create",
    "loyalty.redeem",
    "loyalty.edit",
    "loyalty.export",
    "employees.view",
    "employees.export",
    "employees.print",
    "reports.view",
    "settings.view",
    "marketing.view",
    "marketing.create",
    "marketing.update",
    "marketing.delete",
    "marketing.publish",
    "marketing.settings",
    "website.view",
    "website.orders",
    "website.settings",
    "products.barcode_shop",
    "pos.scan_product_qr",
  ],
  accountant: [
    "dashboard.view",
    "accounting.view",
    "accounting.create",
    "accounting.edit",
    "accounting.approve",
    "reports.view",
    "loyalty.view",
    "attendance.view",
    "employees.view",
    "employees.export",
    "marketing.view",
    "website.orders",
  ],
  cashier: [
    "dashboard.view",
    "products.view",
    "pos.view",
    "pos.create",
    "pos.sell",
    "orders.view",
    "orders.create",
    "customers.view",
    "customers.create",
    "settings.view",
    "loyalty.view",
    "loyalty.create",
    "loyalty.redeem",
    "attendance.view",
    "attendance.create",
    "employees.view",
    "pos.scan_product_qr",
  ],
  warehouse_staff: [
    "dashboard.view",
    "products.view",
    "inventory.view",
    "inventory.edit",
    "warehouses.view",
    "warehouses.transfer",
    "attendance.view",
    "employees.view",
  ],
  sales_agent: [
    "dashboard.view",
    "pos.view",
    "pos.create",
    "pos.sell",
    "orders.view",
    "orders.create",
    "customers.view",
    "customers.create",
    "products.view",
    "settings.view",
    "loyalty.view",
    "attendance.view",
    "attendance.create",
    "employees.view",
    "pos.scan_product_qr",
    "marketing.view",
    "marketing.create",
    "marketing.update",
    "website.view",
    "website.orders",
  ],
};

const run = async () => {
  const client = await db.connect();

  try {
    await client.query("BEGIN");

    await client.query(`
      INSERT INTO tenants (id, name, slug, status, plan)
      VALUES (1, 'ERP Platform', 'platform', 'active', 'enterprise')
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, slug = EXCLUDED.slug, status = EXCLUDED.status, plan = EXCLUDED.plan
    `);

    await client.query(`
      INSERT INTO company_profiles (tenant_id, company_name, legal_name, currency, language, invoice_prefix, branch_mode, pos_mode)
      VALUES (1, 'ERP Platform', 'ERP Platform', 'USD', 'en', 'INV', false, true)
      ON CONFLICT (tenant_id) DO NOTHING
    `);

    await client.query(`
      INSERT INTO subscriptions (tenant_id, plan, status, billing_provider, billing_email, start_date, end_date, trial_ends_at, auto_renew)
      VALUES (1, 'enterprise', 'active', 'manual', 'billing@erp.local', NOW(), NULL, NOW() + INTERVAL '365 days', true)
      ON CONFLICT (tenant_id) DO UPDATE SET plan = EXCLUDED.plan, status = EXCLUDED.status, billing_provider = EXCLUDED.billing_provider
    `);

    await client.query(`
      INSERT INTO cashbox (id, tenant_id, name, balance, status, opened_at)
      VALUES (1, 1, 'Main Cashbox', 0, 'open', NOW())
      ON CONFLICT (id) DO UPDATE SET tenant_id = EXCLUDED.tenant_id, name = EXCLUDED.name, status = EXCLUDED.status
    `);

    for (const moduleName of modules) {
      const moduleActions = getModuleActions(moduleName);
      for (const action of moduleActions) {
        await client.query(
          `
          INSERT INTO permissions (module, action, description)
          VALUES ($1, $2, $3)
          ON CONFLICT (module, action) DO NOTHING
          `,
          [moduleName, action, `${action} ${moduleName}`]
        );
      }
    }

    for (const permission of extraPermissions) {
      await client.query(
        `
        INSERT INTO permissions (module, action, description)
        VALUES ($1, $2, $3)
        ON CONFLICT (module, action) DO NOTHING
        `,
        [permission.module, permission.action, permission.description]
      );
    }

    for (const permissionKey of marketingPermissions) {
      const [moduleName, action] = permissionKey.split(".");
      await client.query(
        `
        INSERT INTO permissions (module, action, description)
        VALUES ($1, $2, $3)
        ON CONFLICT (module, action) DO NOTHING
        `,
        [moduleName, action, `${action} ${moduleName}`]
      );
    }

    const roleNames = [
      { name: "super_admin", slug: "super_admin", system: true },
      { name: "admin", slug: "admin", system: true },
      { name: "manager", slug: "manager", system: true },
      { name: "accountant", slug: "accountant", system: true },
      { name: "cashier", slug: "cashier", system: true },
      { name: "warehouse_staff", slug: "warehouse_staff", system: true },
      { name: "sales_agent", slug: "sales_agent", system: true },
      { name: "custom_role", slug: "custom_role", system: false },
    ];

    for (const role of roleNames) {
      await client.query(
        `
        INSERT INTO roles (tenant_id, name, slug, is_system)
        VALUES (1, $1, $2, $3)
        ON CONFLICT (tenant_id, name) DO NOTHING
        `,
        [role.name, role.slug, role.system]
      );
    }

    for (const [roleName, permissionKeys] of Object.entries(roleMatrix)) {
      const roleResult = await client.query(
        `SELECT id FROM roles WHERE tenant_id = 1 AND name = $1 LIMIT 1`,
        [roleName]
      );

      if (roleResult.rows.length === 0) continue;

      const roleId = roleResult.rows[0].id;

      for (const permissionKey of permissionKeys) {
        const [moduleName, action] = permissionKey.split(".");
        const permissionResult = await client.query(
          `SELECT id FROM permissions WHERE module = $1 AND action = $2 LIMIT 1`,
          [moduleName, action]
        );

        if (permissionResult.rows.length === 0) continue;

        await client.query(
          `
          INSERT INTO role_permissions (role_id, permission_id)
          VALUES ($1, $2)
          ON CONFLICT DO NOTHING
          `,
          [roleId, permissionResult.rows[0].id]
        );
      }
    }

    const superAdminRole = await client.query(
      `SELECT id FROM roles WHERE tenant_id = 1 AND name = 'super_admin' LIMIT 1`
    );

    const hashedPassword = await bcrypt.hash("admin123", 10);

    await client.query(
      `
      INSERT INTO users (tenant_id, role_id, name, email, password, is_active, is_super_admin)
      VALUES (1, $1, 'Admin User', 'admin@erp.local', $2, true, true)
      ON CONFLICT (tenant_id, email)
      DO UPDATE SET password = EXCLUDED.password, role_id = EXCLUDED.role_id, is_super_admin = true
      `,
      [superAdminRole.rows[0]?.id || null, hashedPassword]
    );

    await client.query("COMMIT");
    console.log("Foundation seed completed.");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Foundation seed failed:", error);
    process.exitCode = 1;
  } finally {
    client.release();
  }
};

run();
