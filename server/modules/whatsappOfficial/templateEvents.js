// Template webhook events from the WABA subscription → whatsapp_message_templates.
//
//   message_template_status_update   { event, message_template_id, message_template_name,
//                                      message_template_language, reason }      → status + rejection reason
//   template_category_update         { message_template_id, …, new_category | correct_category }  → category
//   message_template_quality_update  { message_template_id, …, new_quality_score }               → quality score
//
// Every change stamps last_synced_at, emits `whatsapp:template_updated` to the tenant room (the
// templates list refreshes) and fires the public-API `template.status` webhook for status changes.
// Called by the WABA webhook dispatcher (connect area). Never throws: Meta's webhook must get its
// 200 regardless.
//
// Contract: applyTemplateWebhookEvent({ tenantId, wabaId, field, value }) → { updated: n }
import db from "../../database/db.js";
import { dispatchWhatsappEvent } from "../../services/whatsappApiAccessService.js";
import { findIntegrationByWabaId, listIntegrations } from "../../services/whatsappEmbeddedSignupService.js";
import { ensureWhatsappTemplateSchema } from "../../services/whatsappTemplateStudioService.js";
import { emitToRooms } from "../../utils/socket.js";

const text = (value = "") => String(value ?? "").trim();

// Meta's event → our stored status (TEMPLATE_STATUSES in the template studio). null = leave it.
export const statusFromTemplateEvent = (event = "") => {
  const value = text(event).toUpperCase();
  if (value === "APPROVED" || value === "REINSTATED") return "APPROVED";
  if (value === "REJECTED") return "REJECTED";
  if (value === "PAUSED") return "PAUSED";
  if (value === "DISABLED" || value === "PENDING_DELETION" || value === "ARCHIVED") return "DISABLED";
  if (value === "PENDING" || value === "IN_APPEAL") return "PENDING";
  return null; // FLAGGED, LIMIT_EXCEEDED, … are signals, not a new state
};

const CATEGORIES = new Set(["MARKETING", "UTILITY", "AUTHENTICATION"]);

const findRows = async ({ tenantId, wabaId, value }) => {
  const metaId = text(value?.message_template_id);
  const name = text(value?.message_template_name);
  const language = text(value?.message_template_language);
  const params = [];
  const where = [];
  if (tenantId) {
    params.push(Number(tenantId));
    where.push(`tenant_id = $${params.length}`);
  } else if (wabaId) {
    params.push(wabaId);
    where.push(`waba_id = $${params.length}`);
  } else {
    return [];
  }
  const match = [];
  if (metaId) {
    params.push(metaId);
    match.push(`meta_template_id = $${params.length}`);
  }
  if (name && language) {
    params.push(name, language);
    match.push(`(name = $${params.length - 1} AND language = $${params.length})`);
  }
  if (!match.length) return [];
  const result = await db.query(`SELECT * FROM whatsapp_message_templates WHERE ${where.join(" AND ")} AND (${match.join(" OR ")})`, params);
  // A Meta id match wins over a name match (a deleted + recreated template keeps the name).
  const byId = result.rows.filter((row) => metaId && text(row.meta_template_id) === metaId);
  return byId.length ? byId : result.rows;
};

const phoneNumbersOfWaba = async (tenantId, wabaId) => {
  if (!tenantId || !wabaId) return [];
  const rows = await listIntegrations({ tenantId }).catch(() => []);
  return rows.filter((row) => text(row.waba_id) === wabaId && text(row.phone_number_id)).map((row) => text(row.phone_number_id));
};

export const applyTemplateWebhookEvent = async ({ tenantId = 0, wabaId = "", field = "", value = {} } = {}) => {
  try {
    const kind = text(field);
    if (!["message_template_status_update", "template_category_update", "message_template_quality_update"].includes(kind)) return { updated: 0 };
    await ensureWhatsappTemplateSchema();
    let tenant = Number(tenantId) || 0;
    const waba = text(wabaId);
    if (!tenant && waba) tenant = Number((await findIntegrationByWabaId(waba).catch(() => null))?.tenant_id) || 0;
    const rows = await findRows({ tenantId: tenant, wabaId: waba, value: value || {} });
    if (!rows.length) return { updated: 0 };

    const updatedRows = [];
    for (const row of rows) {
      let result = null;
      if (kind === "message_template_status_update") {
        const status = statusFromTemplateEvent(value?.event);
        const reason = text(value?.reason) && text(value?.reason).toUpperCase() !== "NONE" ? text(value.reason).slice(0, 1000) : "";
        result = await db.query(
          `UPDATE whatsapp_message_templates
              SET status = COALESCE($3::varchar, status),
                  rejection_reason = CASE WHEN COALESCE($3::varchar, status) IN ('REJECTED', 'PAUSED', 'DISABLED') THEN $4::text ELSE '' END,
                  meta_template_id = CASE WHEN meta_template_id = '' THEN $5::varchar ELSE meta_template_id END,
                  waba_id = CASE WHEN waba_id = '' THEN $6::varchar ELSE waba_id END,
                  last_synced_at = NOW(),
                  updated_at = NOW()
            WHERE tenant_id = $1 AND id = $2
            RETURNING *`,
          [row.tenant_id, row.id, status, reason, text(value?.message_template_id), waba]
        );
      } else if (kind === "template_category_update") {
        const category = text(value?.new_category || value?.correct_category || value?.category).toUpperCase();
        if (!CATEGORIES.has(category)) continue;
        result = await db.query(
          `UPDATE whatsapp_message_templates SET category = $3, last_synced_at = NOW(), updated_at = NOW()
            WHERE tenant_id = $1 AND id = $2 RETURNING *`,
          [row.tenant_id, row.id, category]
        );
      } else {
        const score = text(value?.new_quality_score || value?.quality_score?.score || value?.quality_score).toUpperCase().slice(0, 24);
        if (!score) continue;
        result = await db.query(
          `UPDATE whatsapp_message_templates SET quality_score = $3, last_synced_at = NOW(), updated_at = NOW()
            WHERE tenant_id = $1 AND id = $2 RETURNING *`,
          [row.tenant_id, row.id, score]
        );
      }
      if (result?.rows?.[0]) updatedRows.push({ before: row, after: result.rows[0] });
    }

    for (const { before, after } of updatedRows) {
      const notice = {
        tenant_id: Number(after.tenant_id),
        template_id: after.id,
        meta_template_id: text(after.meta_template_id),
        name: after.name,
        language: after.language,
        field: kind,
        status: after.status,
        previous_status: before.status,
        category: after.category,
        quality_score: after.quality_score,
        reason: after.rejection_reason,
        event: text(value?.event),
        at: new Date().toISOString(),
      };
      try {
        emitToRooms([`tenant:${after.tenant_id}`], "whatsapp:template_updated", notice);
      } catch {
        /* sockets are best-effort */
      }
      if (kind === "message_template_status_update") {
        const phoneNumberIds = await phoneNumbersOfWaba(Number(after.tenant_id), text(after.waba_id) || waba);
        void dispatchWhatsappEvent({
          tenantId: after.tenant_id,
          event: "template.status",
          phoneNumberIds,
          payload: {
            template_id: text(after.meta_template_id),
            name: after.name,
            language: after.language,
            category: after.category,
            status: after.status,
            previous_status: before.status,
            meta_event: text(value?.event).toUpperCase(),
            reason: after.rejection_reason || "",
            waba_id: text(after.waba_id) || waba,
            timestamp: Math.floor(Date.now() / 1000),
          },
        }).catch(() => {});
      }
    }
    return { updated: updatedRows.length };
  } catch (error) {
    console.warn("[wa-template-events:failed]", { field, message: error?.message || String(error) });
    return { updated: 0 };
  }
};

export default { applyTemplateWebhookEvent };
