import assert from "node:assert/strict";
import test from "node:test";

import { ensureRolesSchema } from "../server/services/rolesService.js";

test("ensureRolesSchema backfills timestamps required by role upserts", async () => {
  const statements = [];
  const client = {
    query: async (sql) => {
      statements.push(String(sql).replace(/\s+/g, " ").trim());
      return { rows: [], rowCount: 0 };
    },
  };

  await ensureRolesSchema(client);

  assert.ok(statements.some((sql) => sql.includes("ALTER TABLE roles ADD COLUMN IF NOT EXISTS created_at")));
  assert.ok(statements.some((sql) => sql.includes("ALTER TABLE roles ADD COLUMN IF NOT EXISTS updated_at")));
});
