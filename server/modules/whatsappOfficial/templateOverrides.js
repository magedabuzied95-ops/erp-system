/*
 * The owner's rewrites of the automation templates, kept in the database and pushed into the
 * registry (server/services/whatsappTemplates.js → setTemplateOverrides) so the send, the
 * submission and the transcript all read the same wording.
 *
 * One row per automation. `edit` is the validated rewrite, or NULL once "restore the original" is
 * pressed — the row stays, because `needs_resubmit` has to survive the reset: a template Meta
 * already holds keeps the OLD wording on Meta until it is edited there too, and until then a send
 * still shows the customer Meta's copy. The flag is what the list shows as "edited — send it to
 * Meta again", and what the submit action picks up.
 *
 * The registry is store-wide (the definitions are code, not per tenant), so the rewrites are too.
 */

import db from "../../database/db.js";
import { setTemplateOverrides, validateTemplateEdit, baseTemplateDefinition } from "../../services/whatsappTemplates.js";

const text = (value = "") => String(value ?? "").trim();

let schemaReady = null;
export const ensureTemplateOverrideSchema = () => {
  if (!schemaReady) {
    schemaReady = db.query(`
      CREATE TABLE IF NOT EXISTS whatsapp_automation_template_overrides (
        automation_type TEXT PRIMARY KEY,
        edit JSONB,
        needs_resubmit BOOLEAN NOT NULL DEFAULT false,
        updated_by INTEGER,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        submitted_at TIMESTAMPTZ
      )
    `).catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  return schemaReady;
};

export const listTemplateOverrides = async () => {
  await ensureTemplateOverrideSchema();
  const result = await db.query(
    `SELECT automation_type, edit, needs_resubmit, updated_at, submitted_at FROM whatsapp_automation_template_overrides`
  );
  return result.rows;
};

/* Read the rows and hand them to the registry. Called at boot and after every change. */
export const refreshTemplateOverrides = async () => {
  const rows = await listTemplateOverrides();
  setTemplateOverrides(rows);
  return rows;
};

const invalid = (problems) => Object.assign(new Error("The template edit breaks a rule"), { status: 400, code: "WHATSAPP_TEMPLATE_EDIT_INVALID", problems });

/*
 * `onMeta` says whether Meta already holds this template (any status with an id): only then does
 * the change have to travel there as an edit; a template Meta never saw simply goes out with the
 * new wording on its first submission.
 */
export const saveTemplateOverride = async ({ automationType, edit, userId = null, onMeta = false }) => {
  const key = text(automationType);
  if (!baseTemplateDefinition(key)) throw Object.assign(new Error("Unknown automation template"), { status: 404, code: "WHATSAPP_TEMPLATE_UNKNOWN" });
  const { problems, edit: normalized } = validateTemplateEdit(key, edit);
  if (problems.length) throw invalid(problems);
  await ensureTemplateOverrideSchema();
  await db.query(
    `INSERT INTO whatsapp_automation_template_overrides (automation_type, edit, needs_resubmit, updated_by, updated_at)
     VALUES ($1, $2::jsonb, $3, $4, NOW())
     ON CONFLICT (automation_type) DO UPDATE
       SET edit = EXCLUDED.edit,
           needs_resubmit = whatsapp_automation_template_overrides.needs_resubmit OR EXCLUDED.needs_resubmit,
           updated_by = EXCLUDED.updated_by,
           updated_at = NOW()`,
    [key, JSON.stringify(normalized), Boolean(onMeta), userId]
  );
  await refreshTemplateOverrides();
  return normalized;
};

export const resetTemplateOverride = async ({ automationType, userId = null, onMeta = false }) => {
  const key = text(automationType);
  if (!baseTemplateDefinition(key)) throw Object.assign(new Error("Unknown automation template"), { status: 404, code: "WHATSAPP_TEMPLATE_UNKNOWN" });
  await ensureTemplateOverrideSchema();
  await db.query(
    `UPDATE whatsapp_automation_template_overrides
        SET edit = NULL,
            needs_resubmit = needs_resubmit OR $2,
            updated_by = $3,
            updated_at = NOW()
      WHERE automation_type = $1`,
    [key, Boolean(onMeta), userId]
  );
  await refreshTemplateOverrides();
};

// Meta accepted the wording now in the registry for these automations.
export const markTemplatesSubmitted = async (automationTypes = []) => {
  const keys = (Array.isArray(automationTypes) ? automationTypes : []).map(text).filter(Boolean);
  if (!keys.length) return;
  await ensureTemplateOverrideSchema();
  await db.query(
    `UPDATE whatsapp_automation_template_overrides
        SET needs_resubmit = false, submitted_at = NOW()
      WHERE automation_type = ANY($1::text[])`,
    [keys]
  );
};
