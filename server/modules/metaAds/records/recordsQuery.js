// Generic list / record / write queries for the Meta Ads record pages, driven by
// the registry in resources.js. Every statement is tenant-scoped, and every
// identifier that reaches SQL comes from the registry (never from the request).

import db from "../../../database/db.js";
import { httpError, nullableNum, text } from "../metaAdsCore.js";
import { decryptSecret, encryptSecret, maskSecret } from "../metaAdsGraph.js";
import { LOOKUPS, getResource } from "./resources.js";

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 500;
const NUMBER_OPS = { eq: "=", ne: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=" };
const CAIRO = "Africa/Cairo";

const has = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);
const isBlank = (value) => value === undefined || value === null || String(value).trim() === "";

// ------------------------------------------------------------------ table columns (cached)

const tableColumns = new Map();
const columnsOf = async (table) => {
  if (!tableColumns.has(table)) {
    const { rows } = await db.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1 ORDER BY ordinal_position`,
      [table],
    );
    tableColumns.set(table, rows.map((row) => row.column_name));
  }
  return tableColumns.get(table);
};

// ------------------------------------------------------------------ filters / ordering

const buildWhere = (resource, tenantId, query = {}) => {
  const params = [tenantId];
  const where = ["t.tenant_id = $1"];
  const add = (value) => {
    params.push(value);
    return `$${params.length}`;
  };

  const q = text(query.q);
  if (q && resource.search?.length) {
    const p = add(`%${q}%`);
    where.push(`(${resource.search.map((expr) => `COALESCE(${expr}::text, '') ILIKE ${p}`).join(" OR ")})`);
  }

  for (const [key, column] of Object.entries(resource.columns || {})) {
    const raw = query[`f_${key}`];
    if (isBlank(raw)) continue;
    const value = text(raw);
    switch (column.type) {
      case "text":
        where.push(`COALESCE(${column.sql}::text, '') ILIKE ${add(`%${value}%`)}`);
        break;
      case "enum":
        where.push(`${column.sql}::text = ${add(value)}::text`);
        break;
      case "bool":
        if (value === "true" || value === "false") where.push(`COALESCE(${column.sql}, FALSE) = ${add(value === "true")}::boolean`);
        break;
      case "number": {
        const amount = nullableNum(value);
        if (amount === null) break;
        const op = NUMBER_OPS[text(query[`f_${key}_op`])] || "=";
        where.push(`COALESCE(${column.sql}, 0) ${op} ${add(amount)}::numeric`);
        break;
      }
      case "date":
        if (/^\d{4}-\d{2}-\d{2}$/.test(value)) where.push(`${column.sql}::date = ${add(value)}::date`);
        break;
      case "datetime":
        if (/^\d{4}-\d{2}-\d{2}$/.test(value)) where.push(`(${column.sql} AT TIME ZONE '${CAIRO}')::date = ${add(value)}::date`);
        break;
      case "id": {
        const id = nullableNum(value);
        if (id !== null) where.push(`${column.sql} = ${add(id)}::bigint`);
        break;
      }
      default:
        break;
    }
  }

  for (const [param, relation] of Object.entries(resource.relations || {})) {
    const raw = query[param];
    if (isBlank(raw)) continue;
    if (relation.type === "id") {
      const id = nullableNum(raw);
      if (id === null) continue;
      where.push(`${relation.sql} = ${add(id)}::bigint`);
    } else {
      where.push(`${relation.sql} = ${add(text(raw))}::text`);
    }
  }

  return { where: where.join(" AND "), params };
};

const buildOrder = (resource, query = {}) => {
  const sort = text(query.sort);
  if (sort && has(resource.columns, sort) && resource.columns[sort].sql) {
    const dir = text(query.dir).toLowerCase() === "asc" ? "ASC" : "DESC";
    return `${resource.columns[sort].sql} ${dir} NULLS LAST, t.id DESC`;
  }
  return resource.order;
};

const pageOf = (query = {}) => {
  const page = Math.max(1, Math.floor(Number(query.page) || 1));
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(Number(query.page_size) || DEFAULT_PAGE_SIZE)));
  return { page, pageSize };
};

const selectList = (resource) => {
  const parts = ["t.id"];
  for (const [key, column] of Object.entries(resource.columns)) parts.push(`${column.sql} AS "${key}"`);
  for (const extra of resource.extra || []) parts.push(extra);
  return parts.join(", ");
};

// ------------------------------------------------------------------ catalog resources

const catalogRows = (resource, query = {}) => {
  let rows = resource.catalog();
  const q = text(query.q).toLowerCase();
  if (q) rows = rows.filter((row) => JSON.stringify(row).toLowerCase().includes(q));
  const code = text(query.f_code).toLowerCase();
  if (code) rows = rows.filter((row) => row.code.toLowerCase().includes(code));
  return rows;
};

// ------------------------------------------------------------------ reads

// `scope` (optional, server-chosen, never from the request): (nextParamIndex) → { sql, params },
// ANDed onto the WHERE — the Meta review account's narrowing (metaAdsReviewer.js).
const withScope = (built, scope) => {
  if (!scope) return built;
  const extra = scope(built.params.length + 1);
  return { where: `${built.where} AND (${extra.sql})`, params: [...built.params, ...(extra.params || [])] };
};

export const listRecords = async (tenantId, key, query = {}, { scope = null } = {}) => {
  const resource = getResource(key);
  const { page, pageSize } = pageOf(query);
  if (resource.catalog) {
    const all = catalogRows(resource, query);
    return { rows: all.slice((page - 1) * pageSize, page * pageSize), total: all.length, page, page_size: pageSize };
  }
  const { where, params } = withScope(buildWhere(resource, tenantId, query), scope);
  const from = `FROM ${resource.table} t ${resource.joins || ""} WHERE ${where}`;
  const totalResult = await db.query(`SELECT COUNT(*) AS n ${from}`, params);
  const { rows } = await db.query(
    `SELECT ${selectList(resource)} ${from} ORDER BY ${buildOrder(resource, query)} LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
    params,
  );
  return { rows, total: Number(totalResult.rows[0]?.n || 0), page, page_size: pageSize };
};

// Secrets never leave the server: drop every *_encrypted column and say whether it
// is set, with a masked hint the form can show ("abcd••••wxyz").
const scrub = (row) => {
  const out = {};
  for (const [key, value] of Object.entries(row)) {
    if (key.endsWith("_encrypted")) {
      const base = key.slice(0, -"_encrypted".length);
      const plain = decryptSecret(value);
      out[`has_${base}`] = Boolean(plain);
      out[`${base}_masked`] = plain ? maskSecret(plain) : "";
      continue;
    }
    out[key] = value;
  }
  if (has(row, "user_access_token_encrypted")) out.has_token = out.has_user_access_token;
  return out;
};

const loadRow = async (resource, tenantId, id) => {
  const display = Object.entries(resource.display || {}).map(([key, sql]) => `${sql} AS "${key}"`);
  const { rows } = await db.query(
    `SELECT t.*${display.length ? `, ${display.join(", ")}` : ""} FROM ${resource.table} t ${resource.joins || ""} WHERE t.tenant_id = $1 AND t.id = $2`,
    [tenantId, id],
  );
  if (!rows[0]) throw httpError(404, "Record not found", "META_ADS_RECORD_NOT_FOUND");
  return rows[0];
};

const recordId = (value) => {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw httpError(404, "Record not found", "META_ADS_RECORD_NOT_FOUND");
  return id;
};

const neighborsOf = async (resource, tenantId, id, query, scope = null) => {
  const run = async (filters) => {
    const { where, params } = withScope(buildWhere(resource, tenantId, filters), scope);
    params.push(id);
    const { rows } = await db.query(
      `WITH o AS (
         SELECT t.id, ROW_NUMBER() OVER (ORDER BY ${buildOrder(resource, filters)}) AS rn, COUNT(*) OVER () AS total
           FROM ${resource.table} t ${resource.joins || ""} WHERE ${where}
       )
       SELECT cur.rn, cur.total,
              (SELECT id FROM o WHERE o.rn = cur.rn - 1) AS prev_id,
              (SELECT id FROM o WHERE o.rn = cur.rn + 1) AS next_id
         FROM o cur WHERE cur.id = $${params.length}`,
      params,
    );
    return rows[0] || null;
  };
  // The pager walks the list the user came from; if the record is not in it
  // (filters changed, record edited out of it) fall back to the whole table.
  const hit = (await run(query || {})) || (await run({}));
  if (!hit) return { index: 0, total: 0, prev_id: null, next_id: null };
  return { index: Number(hit.rn), total: Number(hit.total), prev_id: hit.prev_id ? Number(hit.prev_id) : null, next_id: hit.next_id ? Number(hit.next_id) : null };
};

export const getRecord = async (tenantId, key, rawId, query = {}, { scope = null } = {}) => {
  const resource = getResource(key);
  if (resource.catalog) {
    const all = catalogRows(resource, {});
    const index = all.findIndex((row) => row.id === String(rawId));
    if (index < 0) throw httpError(404, "Record not found", "META_ADS_RECORD_NOT_FOUND");
    return {
      record: all[index],
      counts: {},
      neighbors: { index: index + 1, total: all.length, prev_id: all[index - 1]?.id || null, next_id: all[index + 1]?.id || null },
    };
  }
  const id = recordId(rawId);
  if (scope) {
    // A record outside the scope does not exist for this reader.
    const scoped = withScope({ where: "t.tenant_id = $1 AND t.id = $2", params: [tenantId, id] }, scope);
    const { rows: visible } = await db.query(`SELECT 1 FROM ${resource.table} t ${resource.joins || ""} WHERE ${scoped.where} LIMIT 1`, scoped.params);
    if (!visible[0]) throw httpError(404, "Record not found", "META_ADS_RECORD_NOT_FOUND");
  }
  const row = await loadRow(resource, tenantId, id);
  const counts = resource.counts ? await resource.counts(tenantId, row) : {};
  const neighbors = await neighborsOf(resource, tenantId, id, query, scope);
  return { record: scrub(row), counts, neighbors };
};

// ------------------------------------------------------------------ writes

const sanitize = (key, spec, value) => {
  switch (spec.kind) {
    case "number":
      if (isBlank(value)) return spec.notNull ? (spec.fallback ?? 0) : null;
      if (nullableNum(value) === null) throw httpError(400, `Invalid number: ${key}`, "META_ADS_FIELD_INVALID");
      return nullableNum(value);
    case "bool":
      return value === true || value === "true" || value === 1 || value === "1";
    case "ts": {
      if (isBlank(value)) return null;
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) throw httpError(400, `Invalid date: ${key}`, "META_ADS_FIELD_INVALID");
      return date;
    }
    case "id": {
      if (isBlank(value)) return null;
      const id = Number(value);
      if (!Number.isInteger(id) || id <= 0) throw httpError(400, `Invalid reference: ${key}`, "META_ADS_FIELD_INVALID");
      return id;
    }
    default: {
      const plain = text(value);
      if (plain) return plain;
      return spec.notNull ? (spec.fallback ?? "") : null;
    }
  }
};

const checkRefs = async (resource, tenantId, values) => {
  for (const [key, spec] of Object.entries(resource.editable || {})) {
    if (!spec.ref || values[key] === undefined || values[key] === null) continue;
    const { rows } = await db.query(`SELECT 1 FROM ${spec.ref} WHERE tenant_id = $1 AND id = $2`, [tenantId, values[key]]);
    if (!rows[0]) throw httpError(400, `Unknown reference: ${key}`, "META_ADS_FIELD_INVALID");
  }
};

const collectValues = (resource, body = {}, current = null) => {
  const values = {};
  for (const [key, spec] of Object.entries(resource.editable || {})) {
    if (!has(body, key)) continue;
    if (spec.draftOnly && current && !current.is_draft) {
      throw httpError(409, `${key} can only change while the record is a draft`, "META_ADS_DRAFT_ONLY_FIELD");
    }
    values[key] = sanitize(key, spec, body[key]);
  }
  // A secret is replaced only when a new value is typed; `clear_<key>: true` empties it.
  for (const [key, column] of Object.entries(resource.secrets || {})) {
    if (body[`clear_${key}`] === true) values[column] = null;
    else if (!isBlank(body[key])) values[column] = encryptSecret(body[key]);
  }
  return values;
};

const friendlyWriteError = (error) => {
  if (error?.code === "23505") return httpError(409, "A record with the same identifier already exists", "META_ADS_DUPLICATE");
  if (error?.code === "23503") return httpError(409, "Another record still points to this one", "META_ADS_IN_USE");
  return error;
};

export const createRecord = async (tenantId, key, body = {}, userId = null) => {
  const resource = getResource(key);
  if (resource.catalog || !resource.create) throw httpError(405, "Records of this type cannot be created here", "META_ADS_NOT_ALLOWED");
  const values = collectValues(resource, body, null);
  Object.assign(values, await resource.create.prepare(tenantId, body));
  await checkRefs(resource, tenantId, values);
  const columns = await columnsOf(resource.table);
  if (columns.includes("created_by") && userId) values.created_by = userId;
  const keys = Object.keys(values).filter((column) => columns.includes(column));
  const params = [tenantId, ...keys.map((column) => values[column])];
  let id;
  try {
    const { rows } = await db.query(
      `INSERT INTO ${resource.table} (tenant_id${keys.map((column) => `, ${column}`).join("")})
       VALUES ($1${keys.map((_, index) => `, $${index + 2}`).join("")}) RETURNING id`,
      params,
    );
    id = Number(rows[0].id);
  } catch (error) {
    throw friendlyWriteError(error);
  }
  if (resource.afterWrite) await resource.afterWrite(tenantId, id);
  return getRecord(tenantId, key, id);
};

export const updateRecord = async (tenantId, key, rawId, body = {}) => {
  const resource = getResource(key);
  if (resource.catalog) throw httpError(405, "This list is read-only", "META_ADS_NOT_ALLOWED");
  const id = recordId(rawId);
  const current = await loadRow(resource, tenantId, id);
  const values = collectValues(resource, body, current);
  const keys = Object.keys(values);
  if (keys.length) {
    await checkRefs(resource, tenantId, values);
    const columns = await columnsOf(resource.table);
    const sets = keys.map((column, index) => `${column} = $${index + 3}`);
    if (columns.includes("updated_at")) sets.push("updated_at = NOW()");
    try {
      await db.query(
        `UPDATE ${resource.table} SET ${sets.join(", ")} WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id, ...keys.map((column) => values[column])],
      );
    } catch (error) {
      throw friendlyWriteError(error);
    }
    if (resource.afterWrite) await resource.afterWrite(tenantId, id);
  }
  return getRecord(tenantId, key, id);
};

export const deleteRecord = async (tenantId, key, rawId) => {
  const resource = getResource(key);
  if (resource.catalog || !resource.remove) throw httpError(405, "Records of this type cannot be deleted here", "META_ADS_NOT_ALLOWED");
  const id = recordId(rawId);
  const current = await loadRow(resource, tenantId, id);
  if (resource.remove === "drafts" && !(current.is_draft || !current.meta_id)) {
    throw httpError(409, "Only drafts can be deleted here. Use \"Delete on Meta\" for live objects.", "META_ADS_DELETE_DRAFTS_ONLY");
  }
  try {
    await db.query(`DELETE FROM ${resource.table} WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
  } catch (error) {
    throw friendlyWriteError(error);
  }
  if (resource.aiObject) {
    await db.query(`DELETE FROM meta_ads_ai_instructions WHERE tenant_id = $1 AND object_type = $2 AND object_id = $3`, [tenantId, resource.aiObject, id]);
  }
  return { deleted: id };
};

export const duplicateRecord = async (tenantId, key, rawId, { suffix = " (copy)", userId = null } = {}) => {
  const resource = getResource(key);
  if (resource.catalog || !resource.duplicate) throw httpError(405, "Records of this type cannot be duplicated", "META_ADS_NOT_ALLOWED");
  const id = recordId(rawId);
  await loadRow(resource, tenantId, id);
  const columns = (await columnsOf(resource.table)).filter((column) => column !== "id");
  const overrides = resource.duplicate.overrides(text(suffix).slice(0, 40) ? ` ${text(suffix).slice(0, 40)}` : " (copy)");
  if (columns.includes("created_at")) overrides.created_at = "NOW()";
  if (columns.includes("updated_at")) overrides.updated_at = "NOW()";
  if (columns.includes("created_by")) overrides.created_by = userId ? String(Number(userId) || "NULL") : "t.created_by";
  const select = columns.map((column) => (has(overrides, column) ? overrides[column] : `t.${column}`));
  let newId;
  try {
    const { rows } = await db.query(
      `INSERT INTO ${resource.table} (${columns.join(", ")}) SELECT ${select.join(", ")} FROM ${resource.table} t WHERE t.tenant_id = $1 AND t.id = $2 RETURNING id`,
      [tenantId, id],
    );
    newId = Number(rows[0].id);
  } catch (error) {
    throw friendlyWriteError(error);
  }
  if (resource.aiObject) {
    await db.query(
      `INSERT INTO meta_ads_ai_instructions (tenant_id, object_type, object_id, message, expires_at)
       SELECT tenant_id, object_type, $4, message, expires_at FROM meta_ads_ai_instructions WHERE tenant_id = $1 AND object_type = $2 AND object_id = $3`,
      [tenantId, resource.aiObject, id, newId],
    );
  }
  return { id: newId };
};

// ------------------------------------------------------------------ AI instructions (campaign / ad set / ad)

const aiResource = async (tenantId, key, rawId) => {
  const resource = getResource(key);
  if (!resource.aiObject) throw httpError(404, "This record type has no AI instructions", "META_ADS_NOT_ALLOWED");
  const id = recordId(rawId);
  await loadRow(resource, tenantId, id);
  return { resource, id };
};

const listInstructions = async (tenantId, objectType, id) => {
  const { rows } = await db.query(
    `SELECT id, message, expires_at FROM meta_ads_ai_instructions WHERE tenant_id = $1 AND object_type = $2 AND object_id = $3 ORDER BY id`,
    [tenantId, objectType, id],
  );
  return rows;
};

export const getAiInstructions = async (tenantId, key, rawId) => {
  const { resource, id } = await aiResource(tenantId, key, rawId);
  return { rows: await listInstructions(tenantId, resource.aiObject, id) };
};

export const putAiInstructions = async (tenantId, key, rawId, body) => {
  const { resource, id } = await aiResource(tenantId, key, rawId);
  const list = Array.isArray(body) ? body : Array.isArray(body?.rows) ? body.rows : [];
  const clean = list
    .map((row) => ({ message: text(row?.message).slice(0, 4000), expires_at: sanitize("expires_at", { kind: "ts" }, row?.expires_at) }))
    .filter((row) => row.message);
  if (clean.length > 200) throw httpError(400, "Too many instructions", "META_ADS_FIELD_INVALID");
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query(`DELETE FROM meta_ads_ai_instructions WHERE tenant_id = $1 AND object_type = $2 AND object_id = $3`, [tenantId, resource.aiObject, id]);
    for (const row of clean) {
      await client.query(
        `INSERT INTO meta_ads_ai_instructions (tenant_id, object_type, object_id, message, expires_at) VALUES ($1, $2, $3, $4, $5)`,
        [tenantId, resource.aiObject, id, row.message, row.expires_at],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  return { rows: await listInstructions(tenantId, resource.aiObject, id) };
};

// ------------------------------------------------------------------ lookups

// The ERP has no chat-team table yet (AI Inbox assigns conversations to users, not
// teams), so the "Chat Team" select has no options until one exists.
export const lookup = async (tenantId, kind, query = {}) => {
  if (kind === "chat-teams") return { rows: [] };
  const def = Object.prototype.hasOwnProperty.call(LOOKUPS, kind) ? LOOKUPS[kind] : null;
  if (!def) throw httpError(404, "Unknown lookup", "META_ADS_UNKNOWN_LOOKUP");
  const params = [tenantId];
  if (def.account) params.push(nullableNum(query.account_id));
  const { rows } = await db.query(def.sql, params);
  return { rows: rows.map((row) => ({ id: Number(row.id), name: row.name || "", hint: row.hint || "" })) };
};

export { loadRow, recordId };
