import assert from "node:assert/strict";
import test from "node:test";
import jwt from "jsonwebtoken";

import db from "../server/database/db.js";
import { protect } from "../server/middleware/authMiddleware.js";

test("protect never puts the password hash on req.user", async () => {
  const originalQuery = db.query.bind(db);
  db.query = async (sql) => {
    const text = String(sql).replace(/\s+/g, " ");
    if (text.includes("FROM users u") && text.includes("WHERE u.id = $1")) {
      return { rows: [{ id: 9, tenant_id: 1, email: "x@y.z", role: "admin", role_name: "admin", is_active: true, password: "$2b$10$hash" }] };
    }
    return { rows: [], rowCount: 0 };
  };
  try {
    const token = jwt.sign({ id: 9, role: "admin", tenant_id: 1 }, process.env.JWT_SECRET || "SECRET_KEY");
    const req = { headers: { authorization: `Bearer ${token}` } };
    let nextCalled = false;
    await protect(req, { status() { return this; }, json() { return this; } }, () => { nextCalled = true; });
    assert.equal(nextCalled, true);
    assert.equal(req.user.id, 9);
    assert.equal("password" in req.user, false);
  } finally {
    db.query = originalQuery;
  }
});
