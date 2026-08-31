import db from "../database/db.js";

let bootstrapPromise = null;

const DEFAULT_TENANT = {
  name: "ERP Platform",
  slug: "platform",
  status: "active",
  plan: "enterprise",
};

const bootstrapStatements = [
  `
  CREATE TABLE IF NOT EXISTS tenants (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(120) NOT NULL UNIQUE,
    status VARCHAR(50) NOT NULL DEFAULT 'active',
    plan VARCHAR(50) NOT NULL DEFAULT 'trial',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  `,
  `
  ALTER TABLE IF EXISTS users
    ADD COLUMN IF NOT EXISTS tenant_id BIGINT REFERENCES tenants(id) ON DELETE SET NULL;
  `,
  `
  ALTER TABLE IF EXISTS users
    ADD COLUMN IF NOT EXISTS role VARCHAR(100) DEFAULT 'user';
  `,
  `
  ALTER TABLE IF EXISTS users
    ADD COLUMN IF NOT EXISTS is_super_admin BOOLEAN NOT NULL DEFAULT FALSE;
  `,
  `
  ALTER TABLE IF EXISTS users
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;
  `,
  `
  WITH inserted AS (
    INSERT INTO tenants (name, slug, status, plan)
    SELECT $1, $2, $3, $4
    WHERE NOT EXISTS (SELECT 1 FROM tenants)
    ON CONFLICT (slug) DO NOTHING
    RETURNING id
  )
  SELECT id FROM inserted
  UNION ALL
  SELECT id FROM tenants
  ORDER BY id
  LIMIT 1;
  `,
];

const backfillUsers = async (client, tenantId) => {
  const roleAwareBackfill = await client.query(
    `
    UPDATE users u
    SET tenant_id = $1,
        updated_at = CURRENT_TIMESTAMP
    WHERE u.tenant_id IS NULL
      AND (
        LOWER(COALESCE(u.role, '')) IN ('admin', 'super_admin', 'platform_admin')
        OR u.is_super_admin = TRUE
      )
      AND NOT EXISTS (
        SELECT 1
        FROM users existing
        WHERE existing.tenant_id = $1
          AND LOWER(existing.email) = LOWER(u.email)
          AND existing.id <> u.id
      );
    `,
    [tenantId]
  );

  const generalBackfill = await client.query(
    `
    UPDATE users u
    SET tenant_id = $1,
        updated_at = CURRENT_TIMESTAMP
    WHERE u.tenant_id IS NULL
      AND NOT EXISTS (
        SELECT 1
        FROM users existing
        WHERE existing.tenant_id = $1
          AND LOWER(existing.email) = LOWER(u.email)
          AND existing.id <> u.id
      );
    `,
    [tenantId]
  );

  const remainingUsers = await client.query(`
    SELECT id
    FROM users
    WHERE tenant_id IS NULL
    ORDER BY id ASC;
  `);

  let conflictUsers = 0;
  for (const user of remainingUsers.rows) {
    const tenantResult = await client.query(
      `
      INSERT INTO tenants (name, slug, status, plan)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (slug) DO UPDATE
      SET updated_at = CURRENT_TIMESTAMP
      RETURNING id;
      `,
      [`ERP User ${user.id}`, `user-${user.id}-tenant`, DEFAULT_TENANT.status, DEFAULT_TENANT.plan]
    );

    const userTenantId = tenantResult.rows[0]?.id;
    if (!userTenantId) continue;

    const updated = await client.query(
      `
      UPDATE users
      SET tenant_id = $1,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
        AND tenant_id IS NULL;
      `,
      [userTenantId, user.id]
    );

    conflictUsers += updated.rowCount || 0;
  }

  return {
    adminUsers: roleAwareBackfill.rowCount || 0,
    users: generalBackfill.rowCount || 0,
    conflictUsers,
  };
};

export const ensureDefaultTenantAndBackfillUsers = async () => {
  if (!bootstrapPromise) {
    bootstrapPromise = (async () => {
      const client = await db.connect();

      try {
        await client.query("BEGIN");
        await client.query(bootstrapStatements[0]);
        await client.query(bootstrapStatements[1]);
        await client.query(bootstrapStatements[2]);
        await client.query(bootstrapStatements[3]);
        await client.query(bootstrapStatements[4]);
        const tenantResult = await client.query(bootstrapStatements[5], [
          DEFAULT_TENANT.name,
          DEFAULT_TENANT.slug,
          DEFAULT_TENANT.status,
          DEFAULT_TENANT.plan,
        ]);
        const tenantId = tenantResult.rows[0]?.id || null;

        if (!tenantId) {
          throw new Error("Default tenant bootstrap failed");
        }

        let backfill = { adminUsers: 0, users: 0, conflictUsers: 0 };
        try {
          backfill = await backfillUsers(client, tenantId);
        } catch (error) {
          if (error.code !== "42P01" && error.code !== "42703") {
            throw error;
          }
        }

        await client.query("COMMIT");

        if (backfill.adminUsers || backfill.users || backfill.conflictUsers) {
          console.log("[tenant] bootstrap backfill", {
            tenant_id: tenantId,
            ...backfill,
          });
        }

        return tenantId;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    })().catch((error) => {
      bootstrapPromise = null;
      throw error;
    });
  }

  return bootstrapPromise;
};

export default ensureDefaultTenantAndBackfillUsers;
