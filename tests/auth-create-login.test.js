import assert from "node:assert/strict";
import test from "node:test";

import db from "../server/database/db.js";
import { createUser } from "../server/controllers/usersController.js";
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

test("created user can log in immediately with the same email and password", async () => {
  const originalQuery = db.query.bind(db);
  const originalConnect = db.connect?.bind(db);
  const state = {
    tenants: [{ id: 7, slug: "acme", name: "Acme Workspace" }],
    roles: [{ id: 12, name: "cashier", slug: "cashier" }],
    users: [],
    nextUserId: 91,
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

    if (text.includes("WITH inserted AS") && text.includes("FROM tenants")) {
      return { rows: [{ id: state.tenants[0].id }] };
    }

    if (text.includes("FROM tenants") && text.includes("LOWER(slug)")) {
      const lookup = String(params[0] || "").toLowerCase();
      const tenant = state.tenants.find((item) => String(item.slug || "").toLowerCase() === lookup || String(item.name || "").toLowerCase() === lookup);
      return { rows: tenant ? [{ id: tenant.id }] : [] };
    }

    if (text.includes("FROM roles") && text.includes("LIMIT 1")) {
      return { rows: [state.roles[0]] };
    }

    if (text.includes("SELECT id") && text.includes("FROM users") && text.includes("LOWER(email)")) {
      const email = String(params[0] || "").toLowerCase();
      const tenantId = params.length > 1 ? Number(params[1]) : null;
      const rows = state.users
        .filter((user) => String(user.email || "").toLowerCase() === email)
        .filter((user) => tenantId === null || Number(user.tenant_id || 0) === tenantId || user.tenant_id == null)
        .map((user) => ({ id: user.id }));
      return { rows };
    }

    if (text.includes("FROM users") && text.includes("tenant_id IS NULL") && text.startsWith("SELECT id")) {
      return { rows: [] };
    }

    if (text.startsWith("INSERT INTO users")) {
      const columnMatch = text.match(/INSERT INTO users\s*\(([\s\S]*?)\)\s*VALUES/i);
      const columns = columnMatch
        ? columnMatch[1]
            .split(",")
            .map((value) => value.trim().replace(/"/g, ""))
            .filter(Boolean)
        : [];
      const row = {
        id: state.nextUserId++,
        is_active: true,
        is_super_admin: false,
      };
      columns.forEach((column, index) => {
        row[column] = params[index];
      });
      state.users.push({ ...row });
      return {
        rows: [
          {
            id: row.id,
            tenant_id: row.tenant_id,
            name: row.name,
            email: row.email,
            role_id: row.role_id,
            role: row.role || null,
            is_active: row.is_active,
          },
        ],
      };
    }

    if (text.startsWith("UPDATE users u") || text.startsWith("UPDATE users\nSET tenant_id")) {
      return { rows: [], rowCount: 0 };
    }

    if (text.includes("SELECT u.id") && text.includes("FROM users u") && text.includes("LEFT JOIN roles r")) {
      const email = String(params[0] || "").toLowerCase();
      const tenantId = params.length > 1 ? Number(params[1]) : null;
      const rows = state.users
        .filter((user) => String(user.email || "").toLowerCase() === email)
        .filter((user) => tenantId === null || Number(user.tenant_id || 0) === tenantId || user.tenant_id == null)
        .map((user) => ({
          id: user.id,
          tenant_id: user.tenant_id,
          role_id: user.role_id,
          name: user.name,
          email: user.email,
          phone: user.phone || null,
          is_active: user.is_active,
          is_super_admin: user.is_super_admin,
          last_login_at: user.last_login_at || null,
          created_at: user.created_at || new Date().toISOString(),
          updated_at: user.updated_at || new Date().toISOString(),
          password: user.password,
          role_name: user.role || null,
        }));
      return { rows };
    }

    if (text.includes("SELECT DISTINCT p.module, p.action")) {
      return { rows: [] };
    }

    if (text.includes("UPDATE users SET last_login_at = NOW()")) {
      return { rows: [] };
    }

    if (text.includes("SELECT id FROM users WHERE tenant_id IS NULL")) {
      return { rows: [] };
    }

    if (text.includes("FROM tenants t") && text.includes("LEFT JOIN company_profiles c")) {
      return {
        rows: [
          {
            id: 7,
            slug: "acme",
            company_name: "Acme Workspace",
            company_logo_url: "",
            favicon_url: "",
          },
        ],
      };
    }

    if (text === "BEGIN" || text === "COMMIT" || text === "ROLLBACK") {
      return { rows: [] };
    }

    if (text.startsWith("CREATE TABLE") || text.startsWith("ALTER TABLE") || text.startsWith("CREATE INDEX") || text.startsWith("WITH inserted AS")) {
      return { rows: [] };
    }

    throw new Error(`Unexpected query in create/login integration test: ${text.slice(0, 160)}`);
  };

  db.query = query;
  db.connect = async () => ({
    query,
    release() {},
  });

  try {
    const createReq = {
      body: {
        name: "New User",
        email: "new.user@example.com",
        password: "Secret123!",
        role: "cashier",
      },
      user: {
        id: 1,
        role: "admin",
        tenant_id: 7,
      },
      params: {},
      originalUrl: "/api/users",
      method: "POST",
    };
    const createRes = makeResponse();
    await createUser(createReq, createRes);
    assert.equal(createRes.statusCode, 201);
    assert.equal(state.users.length, 1);
    assert.equal(state.users[0].tenant_id, 7);
    assert.equal(state.users[0].is_active, true);
    assert.ok(state.users[0].password);
    assert.notEqual(state.users[0].password, "Secret123!");

    const loginReq = {
      body: {
        email: "new.user@example.com",
        password: "Secret123!",
        workspace: "acme",
        tenant_slug: "acme",
      },
      headers: {},
      query: {},
      params: {},
      originalUrl: "/api/auth/login",
      method: "POST",
    };
    const loginRes = makeResponse();
    await login(loginReq, loginRes);

    assert.equal(loginRes.statusCode, 200);
    assert.equal(loginRes.payload?.success, true);
    assert.equal(loginRes.payload?.user?.email, "new.user@example.com");
    assert.equal(loginRes.payload?.user?.tenant_id, 7);
    assert.ok(loginRes.payload?.token);
  } finally {
    db.query = originalQuery;
    if (originalConnect) {
      db.connect = originalConnect;
    }
  }
});
