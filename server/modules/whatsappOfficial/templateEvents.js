// Template webhook events (message_template_status_update, template_category_update,
// message_template_quality_update) → update whatsapp_message_templates. Owned by the
// template-analytics work; called by the WABA webhook dispatcher (connect/webhooks work).
//
// Contract: applyTemplateWebhookEvent({ tenantId, wabaId, field, value }) → { updated: n }
export const applyTemplateWebhookEvent = async () => ({ updated: 0 });
