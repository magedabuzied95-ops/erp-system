import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import db from "../server/database/db.js";
import { createUser, getUsers, updateUserRole, updateUserStatus } from "../server/controllers/usersController.js";

const makeResponse = () => {
  const response = {
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
  };
  return response;
};

test("server mounts /api/users and users routes expose PATCH aliases", () => {
  const serverSource = readFileSync(new URL("../server/server.js", import.meta.url), "utf8");
  const routesSource = readFileSync(new URL("../server/routes/users.routes.js", import.meta.url), "utf8");

  assert.match(serverSource, /app\.use\("\/api\/users",\s*usersRoutes\)/);
  assert.match(routesSource, /router\.patch\("\/:\id\/role"/);
  assert.match(routesSource, /router\.patch\("\/:\id\/status"/);
});

test("createUser accepts the exact Users.jsx payload and hashes passwords", async () => {
  const originalQuery = db.query.bind(db);
  const queries = [];
  db.query = async (sql, params = []) => {
    const text = String(sql || "");
    queries.push({ sql: text, params });
    if (text.includes("information_schema.columns") && text.includes("FROM information_schema.columns")) {
      return {
        rows: [{ column_name: "role_id" }, { column_name: "role" }, { column_name: "password" }, { column_name: "is_active" }],
      };
    }
    if (text.includes("SELECT COUNT(*)::int AS count") && text.includes("FROM roles") && text.includes("is_system = TRUE")) {
      return { rows: [{ count: 1 }] };
    }
    if (/SELECT\s+id\s+FROM\s+roles/i.test(text) && text.includes("LIMIT 1")) {
      assert.match(text.replace(/\s+/g, " "), /SELECT id\s+FROM roles\s+WHERE id = \$1\s+LIMIT 1/i);
      assert.doesNotMatch(text.replace(/\s+/g, " "), /WHERE[^]*tenant_id\s*=/i);
      return {
        rows: [
          {
            id: 12,
            name: "cashier",
            slug: "cashier",
          },
        ],
      };
    }
    if (/SELECT\s+id,\s*tenant_id,\s*name,\s*slug\s+FROM\s+roles/i.test(text)) {
      assert.match(text.replace(/\s+/g, " "), /SELECT id,\s*tenant_id,\s*name,\s*slug\s+FROM roles\s+WHERE id = \$1\s+LIMIT 1/i);
      return {
        rows: [
          {
            id: 12,
            tenant_id: null,
            name: "cashier",
            slug: "cashier",
          },
        ],
      };
    }
    if (text.includes("SELECT id") && text.includes("FROM users") && text.includes("LOWER(email)")) {
      return { rows: [] };
    }
    if (text.includes("INSERT INTO users")) {
      return {
        rows: [
          {
            id: 91,
            tenant_id: 7,
            name: params[1],
            email: params[2],
            role_id: params[3],
            is_active: true,
            role: params[6],
          },
        ],
      };
    }
    throw new Error(`Unexpected query in createUser test: ${text.slice(0, 120)}`);
  };

  try {
    const req = {
      body: {
        name: "Test User",
        email: "test.user@example.com",
        password: "Secret123!",
        role_id: 12,
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
    const res = makeResponse();

    await createUser(req, res);

    assert.equal(res.statusCode, 201);
    assert.equal(res.payload?.success, true);
    assert.equal(res.payload?.user?.email, "test.user@example.com");
    assert.equal(res.payload?.user?.name, "Test User");
    const insertQuery = queries.find((entry) => String(entry.sql).includes("INSERT INTO users"));
    assert.ok(insertQuery, "expected insert query to run");
    assert.equal(insertQuery.params[3], 12);
    assert.match(String(insertQuery.params[4] || ""), /^\$2[aby]\$/);
    assert.notEqual(insertQuery.params[4], "Secret123!");
  } finally {
    db.query = originalQuery;
  }
});

test("createUser resolves a global role by numeric id for tenant-scoped requests", async () => {
  const originalQuery = db.query.bind(db);
  const queries = [];
  db.query = async (sql, params = []) => {
    const text = String(sql || "");
    queries.push({ sql: text, params });
    if (text.includes("information_schema.columns") && text.includes("FROM information_schema.columns")) {
      return {
        rows: [{ column_name: "role_id" }, { column_name: "password" }, { column_name: "is_active" }],
      };
    }
    if (text.includes("SELECT COUNT(*)::int AS count") && text.includes("FROM roles") && text.includes("is_system = TRUE")) {
      return { rows: [{ count: 1 }] };
    }
    if (/SELECT\s+id\s+FROM\s+roles/i.test(text) && text.includes("LIMIT 1")) {
      assert.match(text.replace(/\s+/g, " "), /SELECT id\s+FROM roles\s+WHERE id = \$1\s+LIMIT 1/i);
      assert.doesNotMatch(text.replace(/\s+/g, " "), /WHERE[^]*tenant_id\s*=/i);
      assert.equal(params[0], 1);
      return {
        rows: [
          {
            id: 1,
            tenant_id: null,
            name: "Admin",
            slug: null,
          },
        ],
      };
    }
    if (/SELECT\s+id,\s*tenant_id,\s*name,\s*slug\s+FROM\s+roles/i.test(text)) {
      assert.match(text.replace(/\s+/g, " "), /SELECT id,\s*tenant_id,\s*name,\s*slug\s+FROM roles\s+WHERE id = \$1\s+LIMIT 1/i);
      return {
        rows: [
          {
            id: 1,
            tenant_id: null,
            name: "Admin",
            slug: null,
          },
        ],
      };
    }
    if (text.includes("SELECT id") && text.includes("FROM users") && text.includes("LOWER(email)")) {
      return { rows: [] };
    }
    if (text.includes("INSERT INTO users")) {
      return {
        rows: [
          {
            id: 92,
            tenant_id: 1,
            name: params[1],
            email: params[2],
            role_id: params[3],
            is_active: true,
          },
        ],
      };
    }
    throw new Error(`Unexpected query in tenant role lookup test: ${text.slice(0, 120)}`);
  };

  try {
    const req = {
      body: {
        name: "Tenant User",
        email: "tenant.user@example.com",
        password: "Secret123!",
        role_id: 1,
      },
      user: {
        id: 1,
        role: "admin",
        tenant_id: 1,
      },
      params: {},
      originalUrl: "/api/users",
      method: "POST",
    };
    const res = makeResponse();

    await createUser(req, res);

    assert.equal(res.statusCode, 201);
    assert.equal(res.payload?.user?.role_id, 1);
    const roleQuery = queries.find((entry) => String(entry.sql).includes("FROM roles"));
    assert.ok(roleQuery, "expected role lookup query to run");
    assert.equal(roleQuery.params[0], 1);
  } finally {
    db.query = originalQuery;
  }
});

test("getUsers hides QA demo and debug users by default", async () => {
  const originalQuery = db.query.bind(db);
  db.query = async (sql, params = []) => {
    const text = String(sql || "");
    if (text.includes("FROM users u") && text.includes("LEFT JOIN roles r")) {
      return {
        rows: [
          { id: 1, tenant_id: 7, name: "QA User A", email: "qa@example.com", role_id: 12, is_active: true, role: "cashier" },
          { id: 2, tenant_id: 7, name: "Real User", email: "real@example.com", role_id: 12, is_active: true, role: "cashier" },
        ],
      };
    }
    throw new Error(`Unexpected query in getUsers filter test: ${text.slice(0, 120)}`);
  };

  try {
    const req = {
      user: {
        id: 1,
        role: "admin",
        tenant_id: 7,
      },
      params: {},
      query: {},
      originalUrl: "/api/users",
      method: "GET",
    };
    const res = makeResponse();

    await getUsers(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.payload?.success, true);
    assert.equal(res.payload?.users?.length, 1);
    assert.equal(res.payload?.users?.[0]?.email, "real@example.com");
  } finally {
    db.query = originalQuery;
  }
});

test("updateUserRole resolves role slugs to numeric role_id for PATCH and PUT aliases", async () => {
  const originalQuery = db.query.bind(db);
  const queries = [];
  db.query = async (sql, params = []) => {
    const text = String(sql || "");
    queries.push({ sql: text, params });
    if (text.includes("information_schema.columns") && text.includes("FROM information_schema.columns")) {
      return {
        rows: [{ column_name: "role_id" }, { column_name: "role" }],
      };
    }
    if (text.includes("SELECT COUNT(*)::int AS count") && text.includes("FROM roles") && text.includes("is_system = TRUE")) {
      return { rows: [{ count: 1 }] };
    }
    if (/SELECT\s+id\s+FROM\s+roles/i.test(text) && text.includes("LIMIT 1")) {
      assert.match(text.replace(/\s+/g, " "), /SELECT id\s+FROM roles\s+WHERE id = \$1\s+LIMIT 1/i);
      return {
        rows: [
          {
            id: 12,
            name: "cashier",
            slug: "cashier",
          },
        ],
      };
    }
    if (/SELECT\s+id,\s*tenant_id,\s*name,\s*slug\s+FROM\s+roles/i.test(text)) {
      assert.match(text.replace(/\s+/g, " "), /SELECT id,\s*tenant_id,\s*name,\s*slug\s+FROM roles\s+WHERE id = \$1\s+LIMIT 1/i);
      return {
        rows: [
          {
            id: 12,
            name: "cashier",
            slug: "cashier",
          },
        ],
      };
    }
    if (text.includes("UPDATE users") && text.includes("SET role_id = $1, role = $2")) {
      return {
        rows: [
          {
            id: 91,
            tenant_id: 7,
            name: "Test User",
            email: "test.user@example.com",
            role_id: params[0],
            role: params[1],
          },
        ],
      };
    }
    throw new Error(`Unexpected query in updateUserRole test: ${text.slice(0, 120)}`);
  };

  try {
    const req = {
      body: {
        role_id: 12,
      },
      user: {
        id: 1,
        role: "admin",
        tenant_id: 7,
      },
      params: {
        id: 91,
      },
      originalUrl: "/api/users/91/role",
      method: "PATCH",
    };
    const res = makeResponse();

    await updateUserRole(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.payload?.success, true);
    assert.equal(res.payload?.user?.role_id, 12);
    const updateQuery = queries.find((entry) => String(entry.sql).includes("UPDATE users"));
    assert.ok(updateQuery, "expected role update query to run");
    assert.equal(updateQuery.params[0], 12);
    assert.equal(updateQuery.params[1], "cashier");
  } finally {
    db.query = originalQuery;
  }
});

test("updateUserStatus persists the active flag and returns updated user", async () => {
  const originalQuery = db.query.bind(db);
  const queries = [];
  db.query = async (sql, params = []) => {
    const text = String(sql || "");
    queries.push({ sql: text, params });
    if (text.includes("UPDATE users") && text.includes("SET is_active = $1")) {
      return {
        rows: [
          {
            id: 91,
            tenant_id: 7,
            name: "Test User",
            email: "test.user@example.com",
            role_id: 2,
            is_active: false,
          },
        ],
      };
    }
    throw new Error(`Unexpected query in updateUserStatus test: ${text.slice(0, 120)}`);
  };

  try {
    const req = {
      body: {
        is_active: false,
      },
      user: {
        id: 1,
        role: "admin",
        tenant_id: 7,
      },
      params: {
        id: 91,
      },
      originalUrl: "/api/users/91/status",
      method: "PATCH",
    };
    const res = makeResponse();

    await updateUserStatus(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.payload?.success, true);
    assert.equal(res.payload?.user?.is_active, false);
    const updateQuery = queries.find((entry) => String(entry.sql).includes("UPDATE users"));
    assert.ok(updateQuery, "expected status update query to run");
    assert.equal(updateQuery.params[0], false);
  } finally {
    db.query = originalQuery;
  }
});

test("GET /api/roles seeds built-ins and exposes numeric Admin/Cashier roles", async () => {
  const originalQuery = db.query.bind(db);
  const state = {
    roles: [],
    permissions: [],
    rolePermissions: [],
    nextRoleId: 1,
    nextPermissionId: 1,
  };

  const normalizeSql = (sql = "") => String(sql || "").replace(/\s+/g, " ").trim();

  db.query = async (sql, params = []) => {
    const text = normalizeSql(sql);

    if (text.startsWith("CREATE TABLE") || text.startsWith("ALTER TABLE") || text.startsWith("CREATE INDEX") || text.startsWith("CREATE UNIQUE INDEX")) {
      return { rows: [] };
    }

    if (text.includes("SELECT COUNT(*)::int AS count") && text.includes("FROM roles") && text.includes("is_system = TRUE")) {
      return { rows: [{ count: state.roles.filter((role) => role.is_system).length }] };
    }

    if (text.startsWith("INSERT INTO roles")) {
      const [name, slug, description] = params;
      const existingIndex = state.roles.findIndex((role) => String(role.name).toLowerCase() === String(name).toLowerCase());
      const roleRow = {
        id: existingIndex >= 0 ? state.roles[existingIndex].id : state.nextRoleId++,
        tenant_id: 1,
        name,
        slug,
        description,
        is_system: true,
      };
      if (existingIndex >= 0) state.roles[existingIndex] = roleRow;
      else state.roles.push(roleRow);
      return { rows: [roleRow] };
    }

    if (text.startsWith("DELETE FROM role_permissions")) {
      const roleId = Number(params[0]);
      state.rolePermissions = state.rolePermissions.filter((row) => Number(row.role_id) !== roleId);
      return { rows: [] };
    }

    if (text.startsWith("INSERT INTO permissions")) {
      const [moduleName, action, description] = params;
      const existing = state.permissions.find((permission) => permission.module === moduleName && permission.action === action);
      const permission = existing || {
        id: state.nextPermissionId++,
        module: moduleName,
        action,
        description,
      };
      if (!existing) state.permissions.push(permission);
      return { rows: [{ id: permission.id }] };
    }

    if (text.startsWith("INSERT INTO role_permissions")) {
      const [roleId, permissionId] = params;
      if (!state.rolePermissions.some((row) => Number(row.role_id) === Number(roleId) && Number(row.permission_id) === Number(permissionId))) {
        state.rolePermissions.push({ role_id: Number(roleId), permission_id: Number(permissionId) });
      }
      return { rows: [] };
    }

    if (text.includes("FROM roles r") && text.includes("LEFT JOIN role_permissions") && text.includes("LEFT JOIN permissions")) {
      return {
        rows: state.roles.map((role) => {
          const permissions = state.rolePermissions
            .filter((row) => Number(row.role_id) === Number(role.id))
            .map((row) => state.permissions.find((permission) => Number(permission.id) === Number(row.permission_id)))
            .filter(Boolean)
            .map((permission) => `${permission.module}.${permission.action}`);
          return { ...role, permissions };
        }),
      };
    }

    throw new Error(`Unexpected query in roles seed regression test: ${text.slice(0, 160)}`);
  };

  try {
    const { getRoles } = await import("../server/controllers/rolesController.js");
    const req = {
      user: {
        id: 1,
        role: "admin",
        tenant_id: 7,
      },
      params: {},
      query: {},
      originalUrl: "/api/roles",
      method: "GET",
    };
    const res = makeResponse();

    await getRoles(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.payload?.success, true);
    const roles = Array.isArray(res.payload?.roles) ? res.payload.roles : [];
    const admin = roles.find((role) => String(role.name).toLowerCase() === "admin");
    const cashier = roles.find((role) => String(role.name).toLowerCase() === "cashier");
    assert.ok(admin, "expected admin role");
    assert.ok(cashier, "expected cashier role");
    assert.equal(Number.isInteger(Number(admin.id)) && Number(admin.id) > 0, true);
    assert.equal(Number.isInteger(Number(cashier.id)) && Number(cashier.id) > 0, true);
  } finally {
    db.query = originalQuery;
  }
});
