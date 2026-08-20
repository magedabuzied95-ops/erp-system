// Invoice templates — storage + resolution for the customer-facing invoice.
// --------------------------------------------------------------------------
// Shape/normalization/resolution rules all live in shared/invoiceTemplate.js so the
// studio UI and this service can never disagree about what a template is. This file
// owns only persistence and the tenant-scoped queries.
//
// Nothing renders from these rows yet. The four existing renderers are untouched, so a
// tenant with zero rows keeps producing exactly the invoice it produces today.

import db from "../database/db.js";
import {
  INVOICE_TEMPLATE_DEFAULTS,
  mergeInvoiceTemplateConfig,
  normalizeInvoiceTemplateChannel,
  normalizeInvoiceTemplateConfig,
  resolveInvoiceTemplate,
} from "../../shared/invoiceTemplate.js";

// DDL under a request is how the POS seller-users endpoint started timing out — every
// call queued behind the same lock. Ensure once per process, then never again.
let schemaReadyPromise = null;

export const ensureInvoiceTemplateSchema = async (clientOrPool = db) => {
  if (!schemaReadyPromise) {
    schemaReadyPromise = (async () => {
      try {
        await clientOrPool.query(`
          CREATE TABLE IF NOT EXISTS invoice_templates (
            id BIGSERIAL PRIMARY KEY,
            tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            name VARCHAR(160) NOT NULL,
            is_default BOOLEAN NOT NULL DEFAULT FALSE,
            scope_channel VARCHAR(20) NOT NULL DEFAULT 'all',
            scope_branch_id BIGINT NULL REFERENCES branches(id) ON DELETE SET NULL,
            config JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_by BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
          )
        `);
        await clientOrPool.query(`
          CREATE INDEX IF NOT EXISTS idx_invoice_templates_tenant_scope
            ON invoice_templates (tenant_id, scope_channel, scope_branch_id)
        `);
        // Exactly one default per tenant, enforced by the database rather than by the
        // route — two defaults would make resolveInvoiceTemplate pick by row order.
        await clientOrPool.query(`
          CREATE UNIQUE INDEX IF NOT EXISTS idx_invoice_templates_one_default
            ON invoice_templates (tenant_id)
            WHERE is_default
        `);
      } catch (error) {
        schemaReadyPromise = null;
        throw error;
      }
    })();
  }
  return schemaReadyPromise;
};

// /api/public/invoice-template is unauthenticated and runs once per customer opening
// their invoice link, while the answer is identical for everyone on a tenant and
// changes only when an operator saves. Cache the resolution input, not the operator's
// own list — the studio must always read the row it just wrote.
const RESOLVE_CACHE_TTL_MS = 60_000;
const resolveCache = new Map();

const invalidateResolveCache = (tenantId) => {
  resolveCache.delete(String(tenantId));
};

const mapRow = (row = {}) => ({
  id: row.id,
  tenant_id: row.tenant_id,
  name: row.name,
  is_default: Boolean(row.is_default),
  scope_channel: normalizeInvoiceTemplateChannel(row.scope_channel),
  scope_branch_id: row.scope_branch_id ?? null,
  config: normalizeInvoiceTemplateConfig(row.config || {}),
  created_by: row.created_by ?? null,
  created_at: row.created_at,
  updated_at: row.updated_at,
});

const badRequest = (message) => {
  const error = new Error(message);
  error.status = 400;
  return error;
};

const notFound = (message) => {
  const error = new Error(message);
  error.status = 404;
  return error;
};

const normalizeName = (value) => {
  const name = String(value || "").trim().slice(0, 160);
  if (!name) throw badRequest("Template name is required");
  return name;
};

const normalizeBranchId = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const branchId = Number(value);
  if (!Number.isFinite(branchId) || branchId <= 0) throw badRequest("Invalid branch");
  return branchId;
};

// Ordered so resolveInvoiceTemplate's "most specific wins" reads off the list directly:
// branch-scoped rows before tenant-wide ones, channel-scoped before "all".
const LIST_ORDER = `
  ORDER BY (scope_branch_id IS NULL) ASC,
           (scope_channel = 'all') ASC,
           is_default DESC,
           created_at ASC
`;

export const listInvoiceTemplates = async (tenantId) => {
  await ensureInvoiceTemplateSchema();
  if (!tenantId) return [];
  const result = await db.query(
    `SELECT * FROM invoice_templates WHERE tenant_id = $1 ${LIST_ORDER}`,
    [tenantId]
  );
  return result.rows.map(mapRow);
};

export const getInvoiceTemplate = async (tenantId, id) => {
  await ensureInvoiceTemplateSchema();
  const result = await db.query(
    `SELECT * FROM invoice_templates WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
    [id, tenantId]
  );
  return result.rows[0] ? mapRow(result.rows[0]) : null;
};

export const createInvoiceTemplate = async (tenantId, payload = {}, userId = null) => {
  await ensureInvoiceTemplateSchema();
  if (!tenantId) throw badRequest("Tenant context missing");

  const name = normalizeName(payload.name);
  const scopeChannel = normalizeInvoiceTemplateChannel(payload.scope_channel ?? payload.scopeChannel);
  const scopeBranchId = normalizeBranchId(payload.scope_branch_id ?? payload.scopeBranchId);
  // A brand-new template starts from today's rendered invoice, not from a blank page.
  const config = mergeInvoiceTemplateConfig(INVOICE_TEMPLATE_DEFAULTS, payload.config || {});

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    // The first template a tenant ever creates becomes its default; there is no useful
    // state where templates exist but none of them is the fallback.
    const existing = await client.query(
      `SELECT 1 FROM invoice_templates WHERE tenant_id = $1 LIMIT 1`,
      [tenantId]
    );
    const requestedDefault = payload.is_default ?? payload.isDefault;
    const isDefault = existing.rowCount === 0 ? true : Boolean(requestedDefault);
    if (isDefault) {
      await client.query(
        `UPDATE invoice_templates SET is_default = FALSE, updated_at = CURRENT_TIMESTAMP WHERE tenant_id = $1 AND is_default`,
        [tenantId]
      );
    }
    const result = await client.query(
      `
      INSERT INTO invoice_templates (tenant_id, name, is_default, scope_channel, scope_branch_id, config, created_by)
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
      RETURNING *
      `,
      [tenantId, name, isDefault, scopeChannel, scopeBranchId, JSON.stringify(config), userId]
    );
    await client.query("COMMIT");
    invalidateResolveCache(tenantId);
    return mapRow(result.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
};

export const updateInvoiceTemplate = async (tenantId, id, payload = {}) => {
  await ensureInvoiceTemplateSchema();
  const current = await getInvoiceTemplate(tenantId, id);
  if (!current) throw notFound("Invoice template not found");

  const has = (key) => Object.prototype.hasOwnProperty.call(payload, key);
  const name = has("name") ? normalizeName(payload.name) : current.name;
  const scopeChannel = has("scope_channel") || has("scopeChannel")
    ? normalizeInvoiceTemplateChannel(payload.scope_channel ?? payload.scopeChannel)
    : current.scope_channel;
  const scopeBranchId = has("scope_branch_id") || has("scopeBranchId")
    ? normalizeBranchId(payload.scope_branch_id ?? payload.scopeBranchId)
    : current.scope_branch_id;
  // A PATCH from the studio carries only the groups the operator touched.
  const config = has("config") ? mergeInvoiceTemplateConfig(current.config, payload.config) : current.config;
  const wantsDefault = has("is_default") || has("isDefault")
    ? Boolean(payload.is_default ?? payload.isDefault)
    : current.is_default;
  // Clearing the flag on the only default would leave the tenant without a fallback.
  const isDefault = current.is_default && !wantsDefault ? true : wantsDefault;

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    if (isDefault && !current.is_default) {
      await client.query(
        `UPDATE invoice_templates SET is_default = FALSE, updated_at = CURRENT_TIMESTAMP WHERE tenant_id = $1 AND is_default`,
        [tenantId]
      );
    }
    const result = await client.query(
      `
      UPDATE invoice_templates
      SET name = $1,
          is_default = $2,
          scope_channel = $3,
          scope_branch_id = $4,
          config = $5::jsonb,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $6 AND tenant_id = $7
      RETURNING *
      `,
      [name, isDefault, scopeChannel, scopeBranchId, JSON.stringify(config), id, tenantId]
    );
    await client.query("COMMIT");
    invalidateResolveCache(tenantId);
    return mapRow(result.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
};

export const duplicateInvoiceTemplate = async (tenantId, id, payload = {}, userId = null) => {
  const source = await getInvoiceTemplate(tenantId, id);
  if (!source) throw notFound("Invoice template not found");
  return createInvoiceTemplate(
    tenantId,
    {
      name: payload.name || `${source.name} (copy)`,
      scope_channel: source.scope_channel,
      scope_branch_id: source.scope_branch_id,
      config: source.config,
      is_default: false,
    },
    userId
  );
};

export const deleteInvoiceTemplate = async (tenantId, id) => {
  await ensureInvoiceTemplateSchema();
  const current = await getInvoiceTemplate(tenantId, id);
  if (!current) throw notFound("Invoice template not found");
  // Deleting the default would silently change every invoice that resolves through it.
  // Promote another template first, then delete.
  if (current.is_default) throw badRequest("Set another template as default before deleting this one");
  await db.query(`DELETE FROM invoice_templates WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
  invalidateResolveCache(tenantId);
  return { id: current.id };
};

// What a renderer asks for: the config that applies to one invoice. Always returns a
// full config — a tenant with no templates gets the defaults, which reproduce today's
// invoice exactly.
export const resolveInvoiceTemplateForOrder = async (tenantId, { templateId = null, channel = "all", branchId = null } = {}) => {
  const cacheKey = String(tenantId);
  const cached = resolveCache.get(cacheKey);
  const templates = cached && cached.expiresAt > Date.now()
    ? cached.rows
    : await listInvoiceTemplates(tenantId).then((rows) => {
        resolveCache.set(cacheKey, { rows, expiresAt: Date.now() + RESOLVE_CACHE_TTL_MS });
        return rows;
      });
  const template = resolveInvoiceTemplate(templates, { templateId, channel, branchId });
  return {
    template_id: template?.id ?? null,
    template_name: template?.name ?? null,
    config: template ? template.config : normalizeInvoiceTemplateConfig(INVOICE_TEMPLATE_DEFAULTS),
  };
};
