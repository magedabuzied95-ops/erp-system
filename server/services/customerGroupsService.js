import db from "../database/db.js";
import { canonicalPhoneKey, canonicalPhoneSql } from "../utils/phoneSearch.js";
import {
  addCustomerTags,
  ensureCustomerTagsSchema,
  listCustomerTags,
  normalizeCustomerTags,
  setCustomerTags,
} from "./customerTagsService.js";

/*
 * Customer groups (inbox top bar → Config → Groups).
 *
 * A group IS a customer tag. Membership lives where tags already live — `customers.tags` — so
 * a group is, with no extra code:
 *   • a campaign audience: the broadcast audience filter already takes `tags` (any-of), so a
 *     group's name in that field targets exactly its members (marketingBroadcastService);
 *   • visible on the customer card and editable from the conversation's tag chips;
 *   • every tag someone already typed shows up here as a group on day one.
 *
 * The only thing tags cannot do is exist with nobody in them, so a tiny registry
 * (`customer_groups`) remembers names created here before the first customer is added. A group's
 * list = registry ∪ tags in use. Rename and delete rewrite the tag on every customer carrying it.
 * Matching is exact-string, the same as the broadcast audience filter.
 */

let schemaReady = null;

export const ensureCustomerGroupsSchema = () => {
  schemaReady ||= (async () => {
    await ensureCustomerTagsSchema();
    await db.query(`
      CREATE TABLE IF NOT EXISTS customer_groups (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL,
        name VARCHAR(40) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_groups_tenant_name ON customer_groups (tenant_id, name)`);
  })().catch((error) => {
    schemaReady = null;
    throw error;
  });
  return schemaReady;
};

const httpError = (message, status = 400, code = "CUSTOMER_GROUP_ERROR") => Object.assign(new Error(message), { status, code });
const text = (value = "") => String(value ?? "").trim();
const tenantOf = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 1;
};

// Same rules as a tag (trimmed, single spaces, 40 chars) — a group name must survive as a tag.
const groupName = (value) => {
  const [name] = normalizeCustomerTags([value]);
  if (!name) throw httpError("Group name is required", 400, "CUSTOMER_GROUP_NAME_REQUIRED");
  return name;
};

export const listGroups = async ({ tenantId } = {}) => {
  await ensureCustomerGroupsSchema();
  const [registry, tags] = await Promise.all([
    db.query(`SELECT id, name, created_at FROM customer_groups WHERE tenant_id = $1`, [tenantOf(tenantId)]),
    listCustomerTags({ tenantId: tenantOf(tenantId) }),
  ]);
  const byName = new Map();
  for (const row of tags) byName.set(row.tag, { name: row.tag, customers: row.customers, saved: false, created_at: null });
  for (const row of registry.rows) {
    const current = byName.get(row.name);
    byName.set(row.name, { name: row.name, customers: current?.customers || 0, saved: true, created_at: row.created_at || null });
  }
  return [...byName.values()].sort((a, b) => b.customers - a.customers || a.name.localeCompare(b.name));
};

export const createGroup = async ({ tenantId, name } = {}) => {
  await ensureCustomerGroupsSchema();
  const safeName = groupName(name);
  await db.query(
    `INSERT INTO customer_groups (tenant_id, name) VALUES ($1, $2) ON CONFLICT (tenant_id, name) DO NOTHING`,
    [tenantOf(tenantId), safeName]
  );
  return { name: safeName };
};

export const renameGroup = async ({ tenantId, name, newName } = {}) => {
  await ensureCustomerGroupsSchema();
  const from = text(name);
  const to = groupName(newName);
  if (!from) throw httpError("Group name is required", 400, "CUSTOMER_GROUP_NAME_REQUIRED");
  if (from === to) return { name: to, customers_updated: 0 };
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    // Swap the tag in place, dropping a duplicate if the customer already had the new name.
    const updated = await client.query(
      `
      UPDATE customers c
      SET tags = COALESCE((
            SELECT jsonb_agg(item ORDER BY first_pos)
            FROM (
              SELECT CASE WHEN element = $2::text THEN $3::text ELSE element END AS item, MIN(pos) AS first_pos
              FROM jsonb_array_elements_text(COALESCE(c.tags, '[]'::jsonb)) WITH ORDINALITY AS e(element, pos)
              GROUP BY 1
            ) swapped
          ), '[]'::jsonb),
          updated_at = NOW()
      WHERE c.tenant_id = $1 AND COALESCE(c.tags, '[]'::jsonb) @> jsonb_build_array($2::text)
      `,
      [tenantOf(tenantId), from, to]
    );
    await client.query(`DELETE FROM customer_groups WHERE tenant_id = $1 AND name = $2`, [tenantOf(tenantId), from]);
    await client.query(`INSERT INTO customer_groups (tenant_id, name) VALUES ($1, $2) ON CONFLICT (tenant_id, name) DO NOTHING`, [tenantOf(tenantId), to]);
    await client.query("COMMIT");
    return { name: to, customers_updated: updated.rowCount || 0 };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
};

export const deleteGroup = async ({ tenantId, name } = {}) => {
  await ensureCustomerGroupsSchema();
  const target = text(name);
  if (!target) throw httpError("Group name is required", 400, "CUSTOMER_GROUP_NAME_REQUIRED");
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const updated = await client.query(
      `
      UPDATE customers c
      SET tags = COALESCE((
            SELECT jsonb_agg(element ORDER BY pos)
            FROM jsonb_array_elements_text(COALESCE(c.tags, '[]'::jsonb)) WITH ORDINALITY AS e(element, pos)
            WHERE element <> $2::text
          ), '[]'::jsonb),
          updated_at = NOW()
      WHERE c.tenant_id = $1 AND COALESCE(c.tags, '[]'::jsonb) @> jsonb_build_array($2::text)
      `,
      [tenantOf(tenantId), target]
    );
    await client.query(`DELETE FROM customer_groups WHERE tenant_id = $1 AND name = $2`, [tenantOf(tenantId), target]);
    await client.query("COMMIT");
    return { name: target, customers_updated: updated.rowCount || 0 };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
};

const publicCustomer = (row = {}) => ({ id: Number(row.id), name: text(row.name), phone: text(row.phone) });

export const listGroupCustomers = async ({ tenantId, name, limit = 200 } = {}) => {
  await ensureCustomerGroupsSchema();
  const target = text(name);
  if (!target) return [];
  const result = await db.query(
    `SELECT c.id, c.name, c.phone FROM customers c
      WHERE c.tenant_id = $1 AND COALESCE(c.tags, '[]'::jsonb) @> jsonb_build_array($2::text)
      ORDER BY c.name ASC, c.id ASC LIMIT $3`,
    [tenantOf(tenantId), target, Math.max(1, Math.min(500, Number(limit) || 200))]
  );
  return result.rows.map(publicCustomer);
};

// Name or phone; a phone is matched on its canonical key so 010…, +2010… and 2010… are one person.
export const searchCustomers = async ({ tenantId, query = "", limit = 20 } = {}) => {
  await ensureCustomerGroupsSchema();
  const needle = text(query);
  if (needle.length < 2) return [];
  const phoneKey = canonicalPhoneKey(needle);
  const params = [tenantOf(tenantId), `%${needle}%`, Math.max(1, Math.min(50, Number(limit) || 20))];
  let phoneClause = "";
  if (phoneKey.length >= 4) {
    params.push(`%${phoneKey}%`);
    phoneClause = ` OR ${canonicalPhoneSql("c.phone")} LIKE $4`;
  }
  const result = await db.query(
    `SELECT c.id, c.name, c.phone FROM customers c
      WHERE c.tenant_id = $1 AND (c.name ILIKE $2${phoneClause})
      ORDER BY c.name ASC, c.id ASC LIMIT $3`,
    params
  );
  return result.rows.map(publicCustomer);
};

const findCustomerByPhone = async (tenantId, phone) => {
  const key = canonicalPhoneKey(phone);
  if (!key) return null;
  const result = await db.query(
    `SELECT c.id FROM customers c WHERE c.tenant_id = $1 AND ${canonicalPhoneSql("c.phone")} = $2 ORDER BY c.id ASC LIMIT 1`,
    [tenantOf(tenantId), key]
  );
  return result.rows[0] ? Number(result.rows[0].id) : null;
};

// Adds by customer id or by phone. Never creates a customer: a phone with no customer is reported back.
export const addCustomerToGroup = async ({ tenantId, name, customerId = null, phone = "" } = {}) => {
  await ensureCustomerGroupsSchema();
  const target = groupName(name);
  const id = Number(customerId) > 0 ? Number(customerId) : await findCustomerByPhone(tenantId, phone);
  if (!id) throw httpError("No customer with this phone", 404, "CUSTOMER_GROUP_CUSTOMER_NOT_FOUND");
  const result = await addCustomerTags({ tenantId: tenantOf(tenantId), id, tags: [target] });
  if (!result.tags.includes(target)) throw httpError("Could not tag this customer (20-tag limit, or the same name with different letter case)", 409, "CUSTOMER_GROUP_TAGS_FULL");
  await db.query(`INSERT INTO customer_groups (tenant_id, name) VALUES ($1, $2) ON CONFLICT (tenant_id, name) DO NOTHING`, [tenantOf(tenantId), target]);
  return { customer_id: id, tags: result.tags };
};

export const removeCustomerFromGroup = async ({ tenantId, name, customerId } = {}) => {
  await ensureCustomerGroupsSchema();
  const target = text(name);
  const id = Number(customerId);
  if (!target || !(id > 0)) throw httpError("Group and customer are required", 400, "CUSTOMER_GROUP_INPUT_INVALID");
  const current = await db.query(`SELECT tags FROM customers WHERE tenant_id = $1 AND id = $2 LIMIT 1`, [tenantOf(tenantId), id]);
  if (!current.rows[0]) throw httpError("Customer not found", 404, "CUSTOMER_GROUP_CUSTOMER_NOT_FOUND");
  const remaining = normalizeCustomerTags(current.rows[0].tags).filter((tag) => tag !== target);
  return setCustomerTags({ tenantId: tenantOf(tenantId), id, tags: remaining });
};
