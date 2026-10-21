/*
 * Inbox tags (Config → Tags): the central list behind the conversation labels.
 *
 * Before this table the label catalogue was a hardcoded list (AI_INBOX_DEFAULT_LABELS in
 * shared/aiInboxConversationLabels.js) plus whatever free-text "custom" labels an operator typed
 * in the labels modal. The VALUES a conversation carries are unchanged: an array of
 * { id, name, color, leadStatus? } in ai_channel_conversations.metadata.conversation_labels (and a
 * mirror in ai_customer_profiles.customer_profile.conversation_labels). A definition's `key` IS
 * that label id, so every stored label stays valid:
 *   - the six defaults are seeded with their own ids (new, contacted, ...), which keep driving
 *     lead status through the normaliser;
 *   - labels already in use on conversations are adopted on first read (and on every list), so
 *     custom labels typed before this page existed show up here with their usage;
 *   - a new tag gets the same id the modal would have given it (customAiInboxLabel(name).id).
 * Rename / recolour rewrites the stored copies on conversations too, so chips everywhere follow.
 * Delete is a soft delete (deleted_at): the tag leaves the picker, conversations that carry it keep
 * it, and the seed/adopt pass never brings it back.
 */
import db from "../database/db.js";
import {
  AI_INBOX_DEFAULT_LABELS,
  AI_INBOX_LABEL_COLOR_KEYS,
  AI_INBOX_RETIRED_STAGE_LABEL_KEYS,
  customAiInboxLabel,
} from "../../shared/aiInboxConversationLabels.js";

const httpError = (message, status = 400, code = "INBOX_TAG_INVALID") =>
  Object.assign(new Error(message), { status, code });

const tenantOf = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw httpError("A valid tenant id is required");
  return parsed;
};

const text = (value = "") => String(value ?? "").trim().replace(/\s+/g, " ");

let schemaReady = null;
export const ensureInboxTagsSchema = () => {
  schemaReady ||= db.query(`
    CREATE TABLE IF NOT EXISTS conversation_label_definitions (
      id BIGSERIAL PRIMARY KEY,
      tenant_id BIGINT NOT NULL,
      key VARCHAR(64) NOT NULL,
      name VARCHAR(40) NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      color VARCHAR(16) NOT NULL DEFAULT 'sky',
      lead_status VARCHAR(32) NULL,
      created_by BIGINT NULL,
      created_by_name TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ NULL,
      CONSTRAINT uq_conversation_label_definitions_key UNIQUE (tenant_id, key)
    )
  `).catch((error) => {
    schemaReady = null;
    throw error;
  });
  return schemaReady;
};

// Labels on conversations, as rows of (key, name, color, uses). jsonb_typeof guards the odd row
// whose metadata holds a non-array.
const USAGE_SQL = `
  SELECT LOWER(e->>'id') AS key,
         MAX(e->>'name') AS name,
         MAX(e->>'color') AS color,
         COUNT(DISTINCT c.id)::int AS uses
  FROM ai_channel_conversations c
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(c.metadata->'conversation_labels') = 'array' THEN c.metadata->'conversation_labels' ELSE '[]'::jsonb END
  ) AS e
  WHERE c.tenant_id = $1 AND COALESCE(e->>'id', '') <> ''
  GROUP BY LOWER(e->>'id')
`;

const loadUsage = async (tenantId) => {
  try {
    const result = await db.query(USAGE_SQL, [tenantId]);
    return result.rows;
  } catch (error) {
    // A fresh database without the inbox tables yet: no usage, not an error.
    if (error?.code === "42P01") return [];
    throw error;
  }
};

const seededTenants = new Set();

// Defaults once per tenant per process; labels in use are adopted on every list (cheap, and it is
// how a label typed ad hoc in the modal reaches this page). ON CONFLICT DO NOTHING never revives a
// soft-deleted key.
const seedAndAdopt = async (tenantId, usage) => {
  if (!seededTenants.has(tenantId)) {
    // The catalogue used to start with one label per CRM stage ("New", "Won"…), so the
    // labels filter repeated the stages filter. Labels and stages are apart now: the
    // system's own stage clones leave the catalogue (soft delete — a conversation that
    // carries one keeps it, and ON CONFLICT below never revives it). A tag an operator
    // made by hand is never touched.
    await db.query(
      `UPDATE conversation_label_definitions
          SET deleted_at = NOW(), updated_at = NOW()
        WHERE tenant_id = $1 AND deleted_at IS NULL AND created_by_name = 'system'
          AND key = ANY($2::text[]) AND lead_status = key`,
      [tenantId, AI_INBOX_RETIRED_STAGE_LABEL_KEYS]
    );
    for (const label of AI_INBOX_DEFAULT_LABELS) {
      await db.query(
        `INSERT INTO conversation_label_definitions (tenant_id, key, name, color, lead_status, created_by_name)
         VALUES ($1, $2, $3, $4, $5, 'system')
         ON CONFLICT (tenant_id, key) DO NOTHING`,
        [tenantId, label.id, label.name, label.color, label.leadStatus || null]
      );
    }
    seededTenants.add(tenantId);
  }
  const keys = [];
  const names = [];
  const colors = [];
  for (const row of usage) {
    const key = text(row.key).toLowerCase().slice(0, 64);
    const name = text(row.name).slice(0, 40);
    if (!key || !name) continue;
    keys.push(key);
    names.push(name);
    colors.push(AI_INBOX_LABEL_COLOR_KEYS.includes(row.color) ? row.color : customAiInboxLabel(name)?.color || "sky");
  }
  if (!keys.length) return;
  await db.query(
    `INSERT INTO conversation_label_definitions (tenant_id, key, name, color, created_by_name)
     SELECT $1, u.key, u.name, u.color, 'imported'
     FROM unnest($2::text[], $3::text[], $4::text[]) AS u(key, name, color)
     ON CONFLICT (tenant_id, key) DO NOTHING`,
    [tenantId, keys, names, colors]
  );
};

const publicTag = (row, usesByKey = new Map()) => ({
  id: Number(row.id),
  key: row.key,
  name: row.name,
  description: row.description || "",
  color: row.color,
  lead_status: row.lead_status || null,
  created_by: row.created_by ? Number(row.created_by) : null,
  created_by_name: row.created_by_name || "",
  created_at: row.created_at,
  updated_at: row.updated_at,
  uses: usesByKey.get(row.key) || 0,
});

export const listInboxTags = async ({ tenantId } = {}) => {
  const tenant = tenantOf(tenantId);
  await ensureInboxTagsSchema();
  const usage = await loadUsage(tenant);
  await seedAndAdopt(tenant, usage);
  const usesByKey = new Map(usage.map((row) => [row.key, Number(row.uses) || 0]));
  const result = await db.query(
    `SELECT * FROM conversation_label_definitions WHERE tenant_id = $1 AND deleted_at IS NULL ORDER BY (lead_status IS NULL), id`,
    [tenant]
  );
  return result.rows.map((row) => publicTag(row, usesByKey));
};

// The picker's catalogue, in the shape the labels modal already speaks ({ id, name, color, leadStatus }).
export const listInboxTagOptions = async ({ tenantId } = {}) => {
  const tags = await listInboxTags({ tenantId });
  return tags.map((tag) => ({
    id: tag.key,
    name: tag.name,
    color: tag.color,
    description: tag.description,
    ...(tag.lead_status ? { leadStatus: tag.lead_status } : {}),
  }));
};

const cleanInput = (body = {}, { partial = false } = {}) => {
  const out = {};
  if (!partial || body.name !== undefined) {
    out.name = text(body.name).slice(0, 40);
    if (!out.name) throw httpError("Tag name is required", 400, "INBOX_TAG_NAME_REQUIRED");
  }
  if (!partial || body.description !== undefined) out.description = String(body.description ?? "").trim().slice(0, 500);
  if (!partial || body.color !== undefined) {
    const color = text(body.color).toLowerCase();
    if (color && !AI_INBOX_LABEL_COLOR_KEYS.includes(color)) throw httpError("Unknown tag colour", 400, "INBOX_TAG_COLOR_INVALID");
    if (color || !partial) out.color = color || null;
  }
  return out;
};

const getRow = async (tenant, id) => {
  const result = await db.query(
    `SELECT * FROM conversation_label_definitions WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
    [tenant, Number(id) || 0]
  );
  if (!result.rows[0]) throw httpError("Tag not found", 404, "INBOX_TAG_NOT_FOUND");
  return result.rows[0];
};

const assertNameFree = async (tenant, name, exceptId = 0) => {
  const clash = await db.query(
    `SELECT id FROM conversation_label_definitions WHERE tenant_id = $1 AND LOWER(name) = LOWER($2) AND deleted_at IS NULL AND id <> $3 LIMIT 1`,
    [tenant, name, Number(exceptId) || 0]
  );
  if (clash.rows[0]) throw httpError("A tag with this name already exists", 409, "INBOX_TAG_NAME_TAKEN");
};

export const createInboxTag = async ({ tenantId, body = {}, user = {} } = {}) => {
  const tenant = tenantOf(tenantId);
  await ensureInboxTagsSchema();
  const input = cleanInput(body);
  await assertNameFree(tenant, input.name);
  const candidate = customAiInboxLabel(input.name);
  // A name equal to a default ("Won") yields that default's id — that key already exists (live or
  // deleted), so it is revived instead of duplicated.
  const key = candidate.id;
  const color = input.color || candidate.color;
  const createdBy = Number(user?.id || user?.user_id) || null;
  const createdByName = text(user?.name || user?.full_name || user?.username || user?.email || "");
  const result = await db.query(
    `INSERT INTO conversation_label_definitions (tenant_id, key, name, description, color, lead_status, created_by, created_by_name)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (tenant_id, key) DO UPDATE
       SET name = EXCLUDED.name,
           description = EXCLUDED.description,
           color = EXCLUDED.color,
           deleted_at = NULL,
           updated_at = NOW()
       WHERE conversation_label_definitions.deleted_at IS NOT NULL
     RETURNING *`,
    [tenant, key, input.name, input.description, color, candidate.leadStatus || null, createdBy, createdByName]
  );
  if (!result.rows[0]) throw httpError("A tag with this name already exists", 409, "INBOX_TAG_NAME_TAKEN");
  return publicTag(result.rows[0]);
};

// Rewrites the stored copies on conversations so chips across the inbox show the new name/colour.
const propagateToConversations = async (tenant, key, name, color) => {
  const patch = JSON.stringify({ name, color });
  const filter = JSON.stringify([{ id: key }]);
  const rewrite = (column) => `
    (SELECT COALESCE(jsonb_agg(CASE WHEN LOWER(x.e->>'id') = $2 THEN x.e || $3::jsonb ELSE x.e END ORDER BY x.ord), '[]'::jsonb)
     FROM jsonb_array_elements(${column}->'conversation_labels') WITH ORDINALITY AS x(e, ord))`;
  await db.query(
    `UPDATE ai_channel_conversations
     SET metadata = jsonb_set(metadata, '{conversation_labels}', ${rewrite("metadata")}, true)
     WHERE tenant_id = $1
       AND jsonb_typeof(metadata->'conversation_labels') = 'array'
       AND metadata->'conversation_labels' @> $4::jsonb`,
    [tenant, key, patch, filter]
  ).catch((error) => { if (error?.code !== "42P01") throw error; });
  await db.query(
    `UPDATE ai_customer_profiles
     SET customer_profile = jsonb_set(customer_profile, '{conversation_labels}', ${rewrite("customer_profile")}, true)
     WHERE tenant_id = $1
       AND jsonb_typeof(customer_profile->'conversation_labels') = 'array'
       AND customer_profile->'conversation_labels' @> $4::jsonb`,
    [tenant, key, patch, filter]
  ).catch((error) => { if (error?.code !== "42P01") throw error; });
};

export const updateInboxTag = async ({ tenantId, id, body = {} } = {}) => {
  const tenant = tenantOf(tenantId);
  await ensureInboxTagsSchema();
  const row = await getRow(tenant, id);
  const input = cleanInput(body, { partial: true });
  if (input.name) await assertNameFree(tenant, input.name, row.id);
  const name = input.name || row.name;
  const color = input.color || row.color;
  const description = input.description !== undefined ? input.description : row.description;
  const result = await db.query(
    `UPDATE conversation_label_definitions
     SET name = $3, color = $4, description = $5, updated_at = NOW()
     WHERE tenant_id = $1 AND id = $2
     RETURNING *`,
    [tenant, row.id, name, color, description]
  );
  if (name !== row.name || color !== row.color) await propagateToConversations(tenant, row.key, name, color);
  return publicTag(result.rows[0]);
};

export const deleteInboxTag = async ({ tenantId, id } = {}) => {
  const tenant = tenantOf(tenantId);
  await ensureInboxTagsSchema();
  const row = await getRow(tenant, id);
  // The pipeline stages are what lead status is read from; removing one would leave conversations
  // with no way to reach that stage from the picker. Rename them instead.
  if (row.lead_status) throw httpError("Pipeline tags can be renamed but not deleted", 409, "INBOX_TAG_DRIVES_LEAD_STATUS");
  await db.query(
    `UPDATE conversation_label_definitions SET deleted_at = NOW(), updated_at = NOW() WHERE tenant_id = $1 AND id = $2`,
    [tenant, row.id]
  );
  return { id: Number(row.id), key: row.key };
};
