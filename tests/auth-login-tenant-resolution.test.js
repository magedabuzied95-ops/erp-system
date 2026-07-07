import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import test from "node:test";

import db from "../server/database/db.js";
import { login } from "../server/controllers/authController.js";

const makeResponse = () => ({
  statusCode: 200,
  payload: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(value) {
    this.payload = value;
    return value;
  },
});

const normalizeSql = (sql = "") => String(sql || "").replace(/\s+/g, " ").trim();

const makeLoginDbStub = ({ tenants = [], users = [] } = {}) => {
  const state = {
    tenants,
    users,
  };

  const query = async (sql, params = []) => {
    const text = normalizeSql(sql);

    if (text.includes("information_schema.columns") && text.includes("table_name = 'users'") && text.includes("column_name = 'last_login_at'")) {
      return { rows: [{ column_name: "last_login_at", data_type: "timestamp without time zone", is_nullable: "YES" }] };
    }

    if (text.includes("information_schema.columns") && text.includes("table_name = 'users'")) {
      return {
        rows: [
          { column_name: "tenant_id" },
          { column_name: "name" },
          { column_name: "email" },
          { column_name: "password" },
          { column_name: "is_active" },
          { column_name: "role_id" },
          { column_name: "role" },
        ],
      };
    }

    if (text.startsWith("WITH inserted AS") && text.includes("FROM tenants")) {
      return { rows: [{ id: state.tenants[0]?.id || 1 }] };
    }

    if (
      text.startsWith("CREATE TABLE") ||
      text.startsWith("ALTER TABLE") ||
      text.startsWith("CREATE INDEX") ||
      text.startsWith("CREATE EXTENSION") ||
      text === "BEGIN" ||
      text === "COMMIT" ||
      text === "ROLLBACK"
    ) {
      return { rows: [], rowCount: 0 };
    }

    if (text.includes("FROM tenants") && text.includes("LOWER(slug) = LOWER($1)")) {
      const lookup = String(params[0] || "").trim().toLowerCase();
      const tenant = state.tenants.find((item) => String(item.slug || "").trim().toLowerCase() === lookup || String(item.name || "").trim().toLowerCase() === lookup);
      return { rows: tenant ? [{ id: tenant.id }] : [] };
    }

    if (text.includes("SELECT u.id") && text.includes("FROM users u") && text.includes("AND u.tenant_id = $2")) {
      const email = String(params[0] || "").trim().toLowerCase();
      const tenantId = Number(params[1]);
      const rows = state.users
        .filter((user) => String(user.email || "").trim().toLowerCase() === email)
        .filter((user) => Number(user.tenant_id || 0) === tenantId)
        .map((user) => ({
          id: user.id,
          tenant_id: user.tenant_id,
          role_id: user.role_id || null,
          name: user.name,
          email: user.email,
          phone: null,
          is_active: user.is_active !== false,
          is_super_admin: user.is_super_admin === true,
          last_login_at: null,
          created_at: "2026-07-07T00:00:00.000Z",
          updated_at: "2026-07-07T00:00:00.000Z",
          password: user.password,
          role_name: user.role_name || user.role || "user",
        }));
      return { rows };
    }

    if (text.includes("SELECT u.id") && text.includes("FROM users u") && text.includes("u.is_active IS DISTINCT FROM FALSE")) {
      const email = String(params[0] || "").trim().toLowerCase();
      const rows = state.users
        .filter((user) => String(user.email || "").trim().toLowerCase() === email)
        .filter((user) => user.is_active !== false)
        .filter((user) => {
          if (user.tenant_id == null) return true;
          const tenant = state.tenants.find((item) => Number(item.id) === Number(user.tenant_id));
          return !tenant || String(tenant.status || "active").trim().toLowerCase() === "active";
        })
        .map((user) => ({
          id: user.id,
          tenant_id: user.tenant_id,
          role_id: user.role_id || null,
          name: user.name,
          email: user.email,
          phone: null,
          is_active: user.is_active !== false,
          is_super_admin: user.is_super_admin === true,
          last_login_at: null,
          created_at: "2026-07-07T00:00:00.000Z",
          updated_at: "2026-07-07T00:00:00.000Z",
          password: user.password,
          role_name: user.role_name || user.role || "user",
        }));
      return { rows };
    }

    if (text.startsWith("UPDATE users u SET tenant_id")) {
      return { rows: [], rowCount: 0 };
    }

    if (text.startsWith("SELECT id FROM users WHERE tenant_id IS NULL")) {
      return { rows: [] };
    }

    if (text.includes("SELECT DISTINCT p.module, p.action")) {
      return { rows: [] };
    }

    if (text.includes("UPDATE users SET last_login_at = NOW()")) {
      return { rows: [] };
    }

    if (text.includes("FROM tenants t") && text.includes("LEFT JOIN company_profiles c")) {
      const tenantId = Number(params[0]);
      const tenant = state.tenants.find((item) => Number(item.id) === tenantId);
      return tenant
        ? {
            rows: [
              {
                id: tenant.id,
                slug: tenant.slug,
                company_name: tenant.company_name || tenant.name || "",
                company_logo_url: "",
                favicon_url: "",
              },
            ],
          }
        : { rows: [] };
    }

    throw new Error(`Unexpected query in auth login tenant test: ${text.slice(0, 180)}`);
  };

  return { query };
};

const runLogin = async ({ tenants, users, body }) => {
  const originalQuery = db.query.bind(db);
  const originalConnect = db.connect?.bind(db);
  const stub = makeLoginDbStub({ tenants, users });
  db.query = stub.query;
  db.connect = async () => ({
    query: stub.query,
    release() {},
  });

  try {
    const req = {
      body,
      headers: {},
      query: {},
      params: {},
      originalUrl: "/api/auth/login",
      method: "POST",
    };
    const res = makeResponse();
    await login(req, res);
    return res;
  } finally {
    db.query = originalQuery;
    if (originalConnect) {
      db.connect = originalConnect;
    }
  }
};

test("login with tenant slug uses the exact tenant match", async () => {
  const password = "Secret123!";
  const hashedPassword = await bcrypt.hash(password, 10);

  const res = await runLogin({
    tenants: [{ id: 1, slug: "acme", status: "active", name: "Acme" }],
    users: [{ id: 11, tenant_id: 1, email: "cashier@gmail.com", password: hashedPassword, is_active: true, role_name: "cashier" }],
    body: {
      email: "cashier@gmail.com",
      password,
      workspace: " acme ",
      tenant_slug: " acme ",
    },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload?.success, true);
  assert.equal(res.payload?.user?.email, "cashier@gmail.com");
  assert.equal(res.payload?.user?.tenant_id, 1);
});

test("login without tenant succeeds when email exists in one active tenant", async () => {
  const password = "Secret123!";
  const hashedPassword = await bcrypt.hash(password, 10);

  const res = await runLogin({
    tenants: [{ id: 1, slug: "acme", status: "active", name: "Acme" }],
    users: [{ id: 11, tenant_id: 1, email: "cashier@gmail.com", password: hashedPassword, is_active: true, role_name: "cashier" }],
    body: {
      email: "cashier@gmail.com",
      password,
      workspace: "",
    },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload?.success, true);
  assert.equal(res.payload?.user?.email, "cashier@gmail.com");
  assert.equal(res.payload?.user?.tenant_id, 1);
});

test("login without tenant returns workspace required when email exists in multiple tenants", async () => {
  const password = "Secret123!";
  const hashedPassword = await bcrypt.hash(password, 10);

  const res = await runLogin({
    tenants: [
      { id: 1, slug: "acme", status: "active", name: "Acme" },
      { id: 2, slug: "beta", status: "active", name: "Beta" },
    ],
    users: [
      { id: 11, tenant_id: 1, email: "cashier@gmail.com", password: hashedPassword, is_active: true, role_name: "cashier" },
      { id: 12, tenant_id: 2, email: "cashier@gmail.com", password: hashedPassword, is_active: true, role_name: "cashier" },
    ],
    body: {
      email: "cashier@gmail.com",
      password,
      workspace: "",
    },
  });

  assert.equal(res.statusCode, 400);
  assert.equal(res.payload?.success, false);
  assert.match(String(res.payload?.message || ""), /workspace/i);
});
