/*
 * WhatsApp message templates, managed from the inbox (top bar → WhatsApp → Templates).
 *
 * Meta is the authority on a template's fate, but a template starts life as a draft the team
 * edits before anything is sent to Meta, so the drafts live here and Meta's verdict is synced
 * back onto them: DRAFT → PENDING → APPROVED / REJECTED (also PAUSED / DISABLED, Meta's own).
 *
 * Credentials: the number connected through Embedded Signup wins (its WABA and its own token);
 * the WHATSAPP_* environment pair is the fallback, so a store configured by env keeps working.
 *
 * Meta's rules this file enforces before submitting — each one is a rejection otherwise:
 *  - name: lowercase letters, digits and underscores only, ≤ 512;
 *  - body ≤ 1024, header text ≤ 60, footer ≤ 60, ≤ 10 buttons, button text ≤ 25;
 *  - variables are {{1}}..{{n}} with no gaps, and every one carries an example value;
 *  - the body may not start or end with a variable;
 *  - a media header needs an example uploaded through the resumable-upload API (a "handle").
 */

import db from "../database/db.js";
import { cloudConfig, graphRequest } from "./whatsappCloudProvider.js";
import { embeddedSignupConfig, integrationAccessToken, listIntegrations } from "./whatsappEmbeddedSignupService.js";

const GRAPH_HOST = "https://graph.facebook.com";

export const TEMPLATE_STATUSES = Object.freeze(["DRAFT", "PENDING", "APPROVED", "REJECTED", "PAUSED", "DISABLED"]);
export const TEMPLATE_CATEGORIES = Object.freeze(["MARKETING", "UTILITY", "AUTHENTICATION"]);
export const HEADER_FORMATS = Object.freeze(["NONE", "TEXT", "IMAGE", "VIDEO", "DOCUMENT"]);
export const BUTTON_TYPES = Object.freeze(["QUICK_REPLY", "URL", "PHONE_NUMBER", "COPY_CODE"]);

const text = (value = "") => String(value ?? "").trim();
const httpError = (message, status = 400, code = "WHATSAPP_TEMPLATE_INVALID") =>
  Object.assign(new Error(message), { status, code });
const tenantOf = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw httpError("A valid tenant id is required");
  return Math.trunc(parsed);
};

let schemaReady = null;
export const ensureWhatsappTemplateSchema = () => {
  schemaReady ||= db.query(`
    CREATE TABLE IF NOT EXISTS whatsapp_message_templates (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL,
      name VARCHAR(512) NOT NULL,
      language VARCHAR(16) NOT NULL DEFAULT 'ar',
      category VARCHAR(20) NOT NULL DEFAULT 'MARKETING',
      header_format VARCHAR(12) NOT NULL DEFAULT 'NONE',
      header_text TEXT NOT NULL DEFAULT '',
      header_example TEXT NOT NULL DEFAULT '',
      header_media_url TEXT NOT NULL DEFAULT '',
      header_handle TEXT NOT NULL DEFAULT '',
      body_text TEXT NOT NULL DEFAULT '',
      body_examples JSONB NOT NULL DEFAULT '[]'::jsonb,
      footer_text TEXT NOT NULL DEFAULT '',
      buttons JSONB NOT NULL DEFAULT '[]'::jsonb,
      status VARCHAR(16) NOT NULL DEFAULT 'DRAFT',
      meta_template_id VARCHAR(64) NOT NULL DEFAULT '',
      waba_id VARCHAR(64) NOT NULL DEFAULT '',
      rejection_reason TEXT NOT NULL DEFAULT '',
      quality_score VARCHAR(24) NOT NULL DEFAULT '',
      last_synced_at TIMESTAMPTZ,
      submitted_at TIMESTAMPTZ,
      created_by INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT uq_whatsapp_template_name_language UNIQUE (tenant_id, name, language)
    )
  `).catch((error) => {
    schemaReady = null;
    throw error;
  });
  return schemaReady;
};

/* ------------------------------------------------------------------ credentials */

export const resolveTemplateCredentials = async (tenantId) => {
  const env = cloudConfig();
  const rows = await listIntegrations({ tenantId }).catch(() => []);
  const connected = rows.find((row) => row.status === "connected" && text(row.waba_id) && row.access_token_encrypted);
  const token = connected ? text(integrationAccessToken(connected)) : "";
  if (connected && token) {
    return { accessToken: token, wabaId: text(connected.waba_id), graphVersion: env.graphVersion, source: "embedded_signup" };
  }
  // A number wired without its own token (Meta's test number) sends with the server token, and
  // its templates live on ITS WABA — the env WHATSAPP_BUSINESS_ACCOUNT_ID can name an older one
  // that number is not on, which made every sync fail with "object does not exist".
  const envWired = rows.find((row) => row.status === "connected" && text(row.waba_id) && !row.access_token_encrypted);
  if (env.accessToken && (envWired || env.businessAccountId)) {
    return { accessToken: env.accessToken, wabaId: envWired ? text(envWired.waba_id) : env.businessAccountId, graphVersion: env.graphVersion, source: "env" };
  }
  throw httpError(
    "No official WhatsApp account is connected. Connect one from WhatsApp → Official account first.",
    409,
    "WHATSAPP_CLOUD_NOT_CONNECTED"
  );
};

/* ------------------------------------------------------------------ validation */

const variablesIn = (value = "") => [...String(value).matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((match) => Number(match[1]));

const assertSequential = (numbers, where) => {
  const unique = [...new Set(numbers)].sort((a, b) => a - b);
  unique.forEach((value, index) => {
    if (value !== index + 1) throw httpError(`${where}: variables must be {{1}}, {{2}}… with no gaps`);
  });
  return unique.length;
};

const normalizeButtons = (value) => {
  const buttons = (Array.isArray(value) ? value : []).map((button) => ({
    type: BUTTON_TYPES.includes(text(button?.type).toUpperCase()) ? text(button.type).toUpperCase() : "QUICK_REPLY",
    text: text(button?.text).slice(0, 25),
    url: text(button?.url).slice(0, 2000),
    phone_number: text(button?.phone_number).replace(/[^\d+]/g, "").slice(0, 20),
    example: text(button?.example).slice(0, 2000),
  }));
  if (buttons.length > 10) throw httpError("A template can have at most 10 buttons");
  return buttons;
};

export const normalizeTemplateInput = (input = {}) => {
  const name = text(input.name).toLowerCase().replace(/\s+/g, "_");
  const headerFormat = HEADER_FORMATS.includes(text(input.header_format).toUpperCase()) ? text(input.header_format).toUpperCase() : "NONE";
  const category = TEMPLATE_CATEGORIES.includes(text(input.category).toUpperCase()) ? text(input.category).toUpperCase() : "MARKETING";
  return {
    name,
    language: text(input.language || "ar").slice(0, 16),
    category,
    header_format: headerFormat,
    header_text: headerFormat === "TEXT" ? text(input.header_text).slice(0, 60) : "",
    header_example: headerFormat === "TEXT" ? text(input.header_example).slice(0, 200) : "",
    header_media_url: ["IMAGE", "VIDEO", "DOCUMENT"].includes(headerFormat) ? text(input.header_media_url).slice(0, 2000) : "",
    header_handle: ["IMAGE", "VIDEO", "DOCUMENT"].includes(headerFormat) ? text(input.header_handle).slice(0, 4000) : "",
    body_text: String(input.body_text ?? "").replace(/\r\n/g, "\n").trim().slice(0, 1024),
    body_examples: (Array.isArray(input.body_examples) ? input.body_examples : []).map((item) => text(item).slice(0, 200)),
    footer_text: text(input.footer_text).slice(0, 60),
    buttons: normalizeButtons(input.buttons),
  };
};

// Draft saves only need a name; everything else is checked when it is submitted.
const assertDraftable = (template) => {
  if (!template.name) throw httpError("Template name is required");
  if (!/^[a-z0-9_]{1,512}$/.test(template.name)) {
    throw httpError("Template name may only use lowercase English letters, digits and _ (e.g. order_update)");
  }
};

export const assertSubmittable = (template) => {
  assertDraftable(template);
  if (!template.body_text) throw httpError("Body text is required");
  const bodyVars = assertSequential(variablesIn(template.body_text), "Body");
  if (bodyVars) {
    if (/^\s*\{\{\s*\d+\s*\}\}/.test(template.body_text) || /\{\{\s*\d+\s*\}\}\s*[.!؟?]?\s*$/.test(template.body_text)) {
      throw httpError("Body may not start or end with a variable — add text before and after it");
    }
    if (template.body_examples.slice(0, bodyVars).filter(Boolean).length < bodyVars) {
      throw httpError(`Body has ${bodyVars} variable(s) — every one needs an example value`);
    }
  }
  if (template.header_format === "TEXT") {
    if (!template.header_text) throw httpError("Header text is required for a text header");
    const headerVars = assertSequential(variablesIn(template.header_text), "Header");
    if (headerVars > 1) throw httpError("A text header can hold one variable at most");
    if (headerVars && !template.header_example) throw httpError("The header variable needs an example value");
  }
  if (["IMAGE", "VIDEO", "DOCUMENT"].includes(template.header_format) && !template.header_handle) {
    throw httpError("Upload a sample file for the media header first");
  }
  template.buttons.forEach((button, index) => {
    if (!button.text) throw httpError(`Button ${index + 1} needs text`);
    if (button.type === "URL") {
      if (!/^https:\/\//i.test(button.url)) throw httpError(`Button ${index + 1}: the link must start with https://`);
      if (variablesIn(button.url).length && !button.example) throw httpError(`Button ${index + 1}: the link variable needs an example`);
    }
    if (button.type === "PHONE_NUMBER" && !/^\+?\d{8,20}$/.test(button.phone_number)) {
      throw httpError(`Button ${index + 1}: enter the phone number with its country code`);
    }
    if (button.type === "COPY_CODE" && !button.example) throw httpError(`Button ${index + 1}: enter an example code`);
  });
};

/* ------------------------------------------------------------------ Meta payload */

export const buildTemplateComponents = (template) => {
  const components = [];
  if (template.header_format === "TEXT") {
    components.push({
      type: "HEADER",
      format: "TEXT",
      text: template.header_text,
      ...(variablesIn(template.header_text).length ? { example: { header_text: [template.header_example] } } : {}),
    });
  } else if (template.header_format !== "NONE") {
    components.push({ type: "HEADER", format: template.header_format, example: { header_handle: [template.header_handle] } });
  }
  const bodyVars = new Set(variablesIn(template.body_text)).size;
  components.push({
    type: "BODY",
    text: template.body_text,
    ...(bodyVars ? { example: { body_text: [template.body_examples.slice(0, bodyVars)] } } : {}),
  });
  if (template.footer_text) components.push({ type: "FOOTER", text: template.footer_text });
  if (template.buttons.length) {
    components.push({
      type: "BUTTONS",
      buttons: template.buttons.map((button) => {
        if (button.type === "URL") {
          return { type: "URL", text: button.text, url: button.url, ...(variablesIn(button.url).length ? { example: [button.example] } : {}) };
        }
        if (button.type === "PHONE_NUMBER") return { type: "PHONE_NUMBER", text: button.text, phone_number: button.phone_number };
        if (button.type === "COPY_CODE") return { type: "COPY_CODE", example: button.example };
        return { type: "QUICK_REPLY", text: button.text };
      }),
    });
  }
  return components;
};

// The reverse: a template that exists on Meta (made in WhatsApp Manager) becomes a row here.
export const templateFromMeta = (remote = {}) => {
  const components = Array.isArray(remote.components) ? remote.components : [];
  const header = components.find((item) => item.type === "HEADER") || null;
  const body = components.find((item) => item.type === "BODY") || {};
  const footer = components.find((item) => item.type === "FOOTER") || null;
  const buttons = components.find((item) => item.type === "BUTTONS")?.buttons || [];
  return {
    name: text(remote.name),
    language: text(remote.language) || "ar",
    category: TEMPLATE_CATEGORIES.includes(text(remote.category)) ? text(remote.category) : "MARKETING",
    header_format: header ? (HEADER_FORMATS.includes(text(header.format)) ? text(header.format) : "TEXT") : "NONE",
    header_text: header?.format === "TEXT" ? text(header.text) : "",
    header_example: text(header?.example?.header_text?.[0]),
    header_media_url: "",
    header_handle: text(header?.example?.header_handle?.[0]),
    body_text: text(body.text),
    body_examples: Array.isArray(body?.example?.body_text?.[0]) ? body.example.body_text[0].map(text) : [],
    footer_text: text(footer?.text),
    buttons: buttons.map((button) => ({
      type: BUTTON_TYPES.includes(text(button.type)) ? text(button.type) : "QUICK_REPLY",
      text: text(button.text),
      url: text(button.url),
      phone_number: text(button.phone_number),
      example: text(Array.isArray(button.example) ? button.example[0] : button.example),
    })),
  };
};

const metaStatus = (value = "") => {
  const status = text(value).toUpperCase();
  if (status === "IN_APPEAL" || status === "PENDING_DELETION") return "PENDING";
  return TEMPLATE_STATUSES.includes(status) ? status : "PENDING";
};

/* ------------------------------------------------------------------ storage */

const ROW_FIELDS = [
  "name", "language", "category", "header_format", "header_text", "header_example", "header_media_url",
  "header_handle", "body_text", "body_examples", "footer_text", "buttons",
];

const publicTemplate = (row) => row && ({
  ...row,
  body_examples: Array.isArray(row.body_examples) ? row.body_examples : [],
  buttons: Array.isArray(row.buttons) ? row.buttons : [],
  editable: ["DRAFT", "REJECTED", "PAUSED"].includes(row.status) || (row.status === "APPROVED" && Boolean(row.meta_template_id)),
});

export const listTemplates = async ({ tenantId }) => {
  await ensureWhatsappTemplateSchema();
  const result = await db.query(
    `SELECT * FROM whatsapp_message_templates WHERE tenant_id = $1 ORDER BY updated_at DESC, id DESC`,
    [tenantOf(tenantId)]
  );
  return result.rows.map(publicTemplate);
};

const getRow = async ({ tenantId, id }) => {
  await ensureWhatsappTemplateSchema();
  const result = await db.query(`SELECT * FROM whatsapp_message_templates WHERE tenant_id = $1 AND id = $2`, [tenantOf(tenantId), Number(id) || 0]);
  if (!result.rows[0]) throw httpError("Template not found", 404, "WHATSAPP_TEMPLATE_NOT_FOUND");
  return result.rows[0];
};

export const getTemplate = async ({ tenantId, id }) => publicTemplate(await getRow({ tenantId, id }));

const values = (template) => ROW_FIELDS.map((field) =>
  field === "body_examples" || field === "buttons" ? JSON.stringify(template[field] || []) : template[field]
);

export const createTemplate = async ({ tenantId, userId = null, input = {} }) => {
  await ensureWhatsappTemplateSchema();
  const template = normalizeTemplateInput(input);
  assertDraftable(template);
  try {
    const result = await db.query(
      `INSERT INTO whatsapp_message_templates (tenant_id, created_by, ${ROW_FIELDS.join(", ")})
       VALUES ($1, $2, ${ROW_FIELDS.map((_, index) => `$${index + 3}`).join(", ")})
       RETURNING *`,
      [tenantOf(tenantId), userId ? Number(userId) : null, ...values(template)]
    );
    return publicTemplate(result.rows[0]);
  } catch (error) {
    if (error?.code === "23505") throw httpError("A template with this name and language already exists", 409, "WHATSAPP_TEMPLATE_DUPLICATE");
    throw error;
  }
};

export const updateTemplate = async ({ tenantId, id, input = {} }) => {
  const current = await getRow({ tenantId, id });
  if (["PENDING", "DISABLED"].includes(current.status)) {
    throw httpError("This template is waiting for Meta's review and cannot be edited now", 409, "WHATSAPP_TEMPLATE_LOCKED");
  }
  const template = normalizeTemplateInput({ ...publicTemplate(current), ...input });
  // Meta keys a template by name + language; once submitted those two are fixed.
  if (current.meta_template_id) {
    template.name = current.name;
    template.language = current.language;
  }
  assertDraftable(template);
  try {
    const result = await db.query(
      `UPDATE whatsapp_message_templates
          SET ${ROW_FIELDS.map((field, index) => `${field} = $${index + 3}`).join(", ")}, updated_at = NOW()
        WHERE tenant_id = $1 AND id = $2
        RETURNING *`,
      [tenantOf(tenantId), Number(id), ...values(template)]
    );
    return publicTemplate(result.rows[0]);
  } catch (error) {
    if (error?.code === "23505") throw httpError("A template with this name and language already exists", 409, "WHATSAPP_TEMPLATE_DUPLICATE");
    throw error;
  }
};

/* ------------------------------------------------------------------ Meta actions */

export const submitTemplate = async ({ tenantId, id }) => {
  const row = await getRow({ tenantId, id });
  const template = normalizeTemplateInput(publicTemplate(row));
  assertSubmittable(template);
  const credentials = await resolveTemplateCredentials(tenantId);
  const components = buildTemplateComponents(template);
  let response;
  if (row.meta_template_id) {
    // Editing a template Meta already has: same id, new components. Category can only change
    // while it is not approved.
    response = await graphRequest({
      path: `/${credentials.graphVersion}/${row.meta_template_id}`,
      method: "POST",
      body: { components, ...(row.status !== "APPROVED" ? { category: template.category } : {}) },
      accessToken: credentials.accessToken,
    });
  } else {
    response = await graphRequest({
      path: `/${credentials.graphVersion}/${credentials.wabaId}/message_templates`,
      method: "POST",
      body: { name: template.name, language: template.language, category: template.category, components },
      accessToken: credentials.accessToken,
    });
  }
  const result = await db.query(
    `UPDATE whatsapp_message_templates
        SET status = $3, meta_template_id = COALESCE(NULLIF($4, ''), meta_template_id), waba_id = $5,
            category = COALESCE(NULLIF($6, ''), category), rejection_reason = '', submitted_at = NOW(),
            last_synced_at = NOW(), updated_at = NOW()
      WHERE tenant_id = $1 AND id = $2
      RETURNING *`,
    [tenantOf(tenantId), row.id, metaStatus(response?.status || "PENDING"), text(response?.id), credentials.wabaId, text(response?.category)]
  );
  return publicTemplate(result.rows[0]);
};

const fetchRemoteTemplates = async (credentials) => {
  const all = [];
  let path = `/${credentials.graphVersion}/${credentials.wabaId}/message_templates?fields=id,name,status,category,language,rejected_reason,quality_score,components&limit=100`;
  for (let page = 0; page < 20 && path; page += 1) {
    const payload = await graphRequest({ path, accessToken: credentials.accessToken });
    all.push(...(Array.isArray(payload?.data) ? payload.data : []));
    const next = text(payload?.paging?.next);
    path = next ? next.replace(GRAPH_HOST, "") : "";
  }
  return all;
};

// Pull Meta's verdicts onto local rows, and import templates that were made in WhatsApp
// Manager so the list shows everything the number can actually send.
export const syncTemplates = async ({ tenantId }) => {
  await ensureWhatsappTemplateSchema();
  const credentials = await resolveTemplateCredentials(tenantId);
  const remote = await fetchRemoteTemplates(credentials);
  let updated = 0;
  let imported = 0;
  for (const item of remote) {
    const status = metaStatus(item.status);
    const reason = text(item.rejected_reason) === "NONE" ? "" : text(item.rejected_reason);
    const quality = text(item.quality_score?.score);
    const touched = await db.query(
      `UPDATE whatsapp_message_templates
          SET status = $4::text, meta_template_id = $5, waba_id = $6, rejection_reason = $7, quality_score = $8,
              category = $9, last_synced_at = NOW(), updated_at = CASE WHEN status <> $4::text THEN NOW() ELSE updated_at END
        WHERE tenant_id = $1 AND name = $2 AND language = $3
        RETURNING id`,
      [tenantOf(tenantId), text(item.name), text(item.language), status, text(item.id), credentials.wabaId, reason, quality, text(item.category) || "MARKETING"]
    );
    if (touched.rowCount) {
      updated += 1;
      continue;
    }
    const template = templateFromMeta(item);
    await db.query(
      `INSERT INTO whatsapp_message_templates
         (tenant_id, ${ROW_FIELDS.join(", ")}, status, meta_template_id, waba_id, rejection_reason, quality_score, last_synced_at)
       VALUES ($1, ${ROW_FIELDS.map((_, index) => `$${index + 2}`).join(", ")}, $${ROW_FIELDS.length + 2}, $${ROW_FIELDS.length + 3},
               $${ROW_FIELDS.length + 4}, $${ROW_FIELDS.length + 5}, $${ROW_FIELDS.length + 6}, NOW())
       ON CONFLICT (tenant_id, name, language) DO NOTHING`,
      [tenantOf(tenantId), ...values(template), status, text(item.id), credentials.wabaId, reason, quality]
    );
    imported += 1;
  }
  return { remote: remote.length, updated, imported, source: credentials.source };
};

export const deleteTemplate = async ({ tenantId, id }) => {
  const row = await getRow({ tenantId, id });
  if (row.meta_template_id) {
    const credentials = await resolveTemplateCredentials(tenantId);
    const params = new URLSearchParams({ name: row.name, hsm_id: row.meta_template_id });
    await graphRequest({
      path: `/${credentials.graphVersion}/${credentials.wabaId}/message_templates?${params.toString()}`,
      method: "DELETE",
      accessToken: credentials.accessToken,
    });
  }
  await db.query(`DELETE FROM whatsapp_message_templates WHERE tenant_id = $1 AND id = $2`, [tenantOf(tenantId), row.id]);
  return { deleted: true, removed_from_meta: Boolean(row.meta_template_id) };
};

/*
 * A media header needs a sample uploaded through Meta's resumable-upload API, against the app
 * (not the WABA). The returned handle is what the template carries.
 */
export const uploadHeaderSample = async ({ tenantId, buffer, mimeType = "", fileName = "" }) => {
  if (!buffer?.length) throw httpError("A sample file is required");
  const credentials = await resolveTemplateCredentials(tenantId);
  const appId = text(embeddedSignupConfig().appId);
  if (!appId) throw httpError("META_APP_ID is not configured on the server", 409, "META_APP_ID_MISSING");
  const params = new URLSearchParams({
    file_name: fileName || "sample",
    file_length: String(buffer.length),
    file_type: mimeType || "application/octet-stream",
  });
  const session = await graphRequest({
    path: `/${credentials.graphVersion}/${appId}/uploads?${params.toString()}`,
    method: "POST",
    accessToken: credentials.accessToken,
  });
  const sessionId = text(session?.id);
  if (!sessionId) throw httpError("Meta did not open an upload session", 502, "WHATSAPP_UPLOAD_SESSION_FAILED");
  const response = await fetch(`${GRAPH_HOST}/${credentials.graphVersion}/${sessionId}`, {
    method: "POST",
    headers: { Authorization: `OAuth ${credentials.accessToken}`, file_offset: "0" },
    body: buffer,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !text(payload?.h)) {
    throw httpError(text(payload?.error?.message) || "Meta rejected the sample file", 502, "WHATSAPP_UPLOAD_FAILED");
  }
  return { handle: text(payload.h) };
};

export default {
  ensureWhatsappTemplateSchema,
  listTemplates,
  getTemplate,
  createTemplate,
  updateTemplate,
  submitTemplate,
  syncTemplates,
  deleteTemplate,
  uploadHeaderSample,
  resolveTemplateCredentials,
};
