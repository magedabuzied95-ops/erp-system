import bcrypt from "bcryptjs";

import db from "../database/db.js";
import { loadMetaReviewerScope } from "../services/metaReviewerAccessService.js";

const action = String(process.env.META_REVIEWER_ACTION || "").trim().toLowerCase();
const email = String(process.env.META_REVIEWER_EMAIL || "").trim().toLowerCase();
const password = String(process.env.META_REVIEWER_PASSWORD || "");
const displayName = String(process.env.META_REVIEWER_DISPLAY_NAME || "Meta Reviewer").trim();
const expiresAt = String(process.env.META_REVIEWER_EXPIRES_AT || "").trim();

const stop = (message) => { throw new Error(message); };
const requireEmail = () => { if (!email || !email.includes("@")) stop("META_REVIEWER_EMAIL is required."); };
const requirePassword = () => { if (password.length < 16) stop("META_REVIEWER_PASSWORD must contain at least 16 characters."); };

const main = async () => {
  if (!["create", "rotate-password", "disable", "delete"].includes(action)) {
    stop("META_REVIEWER_ACTION must be create, rotate-password, disable, or delete.");
  }
  requireEmail();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS account_expires_at TIMESTAMPTZ NULL`);
    const columnsResult = await client.query(`SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'users'`);
    const columns = new Set(columnsResult.rows.map((row) => row.column_name));

    if (action === "delete") {
      await client.query(`DELETE FROM users WHERE LOWER(email) = LOWER($1) AND role_id IN (SELECT id FROM roles WHERE LOWER(name) = 'meta_reviewer')`, [email]);
      await client.query("COMMIT");
      console.log("Meta reviewer account deleted.");
      return;
    }
    if (action === "disable") {
      await client.query(`UPDATE users SET is_active = FALSE, account_expires_at = NOW() WHERE LOWER(email) = LOWER($1) AND role_id IN (SELECT id FROM roles WHERE LOWER(name) = 'meta_reviewer')`, [email]);
      await client.query("COMMIT");
      console.log("Meta reviewer account disabled.");
      return;
    }

    requirePassword();
    const passwordHash = await bcrypt.hash(password, 12);
    if (action === "rotate-password") {
      const passwordColumn = ["password", "password_hash", "hashed_password", "password_digest"].find((name) => columns.has(name));
      if (!passwordColumn) stop("No supported password column exists.");
      const result = await client.query(`UPDATE users SET ${passwordColumn} = $1, updated_at = NOW() WHERE LOWER(email) = LOWER($2) AND role_id IN (SELECT id FROM roles WHERE LOWER(name) = 'meta_reviewer')`, [passwordHash, email]);
      if (!result.rowCount) stop("Meta reviewer account was not found.");
      await client.query("COMMIT");
      console.log("Meta reviewer password rotated.");
      return;
    }

    const scope = loadMetaReviewerScope();
    if (!scope.enabled) stop("The tenant, page, allowed test PSID and HMAC scope secrets must be configured before account creation.");
    const expiry = new Date(expiresAt);
    if (!expiresAt || Number.isNaN(expiry.getTime()) || expiry <= new Date()) stop("META_REVIEWER_EXPIRES_AT must be a future date.");

    const roleResult = await client.query(`INSERT INTO roles (tenant_id, name, description) VALUES ($1, 'meta_reviewer', 'Temporary isolated Meta pages_messaging reviewer') ON CONFLICT (tenant_id, name) DO UPDATE SET description = EXCLUDED.description RETURNING id`, [scope.tenantId]);
    const roleId = roleResult.rows[0].id;
    for (const permission of [["ai_inbox_messenger", "view"], ["ai_inbox_messenger", "reply"]]) {
      const permissionResult = await client.query(`INSERT INTO permissions (module, action, description) VALUES ($1,$2,$3) ON CONFLICT (module, action) DO UPDATE SET description = EXCLUDED.description RETURNING id`, [permission[0], permission[1], `${permission[1]} isolated Meta review inbox`]);
      await client.query(`INSERT INTO role_permissions (role_id, permission_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [roleId, permissionResult.rows[0].id]);
    }

    const names = ["tenant_id", "role_id", "name", "email", "password", "is_active", "is_super_admin", "account_expires_at"];
    const values = [scope.tenantId, roleId, displayName, email, passwordHash, true, false, expiry.toISOString()];
    if (columns.has("role")) { names.push("role"); values.push("meta_reviewer"); }
    const placeholders = values.map((_, index) => `$${index + 1}`).join(",");
    await client.query(`INSERT INTO users (${names.join(",")}) VALUES (${placeholders}) ON CONFLICT (tenant_id, email) DO UPDATE SET role_id = EXCLUDED.role_id, name = EXCLUDED.name, password = EXCLUDED.password, is_active = TRUE, is_super_admin = FALSE, account_expires_at = EXCLUDED.account_expires_at${columns.has("role") ? ", role = 'meta_reviewer'" : ""}`, values);
    await client.query("COMMIT");
    console.log("Meta reviewer account created or refreshed with an expiration date.");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

main().catch((error) => {
  console.error(`Meta reviewer management failed: ${error.message}`);
  process.exitCode = 1;
}).finally(() => db.end());
