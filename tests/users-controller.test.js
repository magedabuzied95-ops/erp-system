import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import db from "../server/database/db.js";
import { createUser, updateUserRole, updateUserStatus } from "../server/controllers/usersController.js";

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

test("createUser resolves role slugs to numeric role_id and hashes passwords", async () => {
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
    if (text.includes("FROM roles") && text.includes("LIMIT 1")) {
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
            is_active: true,
            role_id: params[4],
            role: params[5],
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
    const res = makeResponse();

    await createUser(req, res);

    assert.equal(res.statusCode, 201);
    assert.equal(res.payload?.success, true);
    assert.equal(res.payload?.user?.email, "test.user@example.com");
    assert.equal(res.payload?.user?.name, "Test User");
    const insertQuery = queries.find((entry) => String(entry.sql).includes("INSERT INTO users"));
    assert.ok(insertQuery, "expected insert query to run");
    assert.equal(insertQuery.params[4], 12);
    assert.equal(insertQuery.params[5], "cashier");
    assert.notEqual(insertQuery.params[3], "Secret123!");
    assert.match(String(insertQuery.params[3] || ""), /^\$2[aby]\$/);
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
    if (text.includes("FROM roles") && text.includes("LIMIT 1")) {
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
        role: "cashier",
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
