import { loadWhatsappQueueSettings, loadWhatsappSendRoutes } from "./config.js";
import { enqueueWhatsappMessage, logLifecycle } from "./queueService.js";
import { TEMPLATE_CATEGORIES, templateDefinition } from "../whatsappTemplates.js";

/*
 * WHICH NUMBER an automation leaves from — chosen per message by the owner in the inbox
 * (WhatsApp → "مين يبعت إيه", setting whatsapp.send_routes, shared/whatsappSendRoutes.js):
 *
 *   evolution    → never a Cloud number (free). The default for order / payment / shipping.
 *   official     → the official Cloud number named in the setting (or, unset there,
 *                  WHATSAPP_MARKETING_CLOUD_PHONE_NUMBER_ID). No number named = unchanged.
 *                  The default for marketing, where Evolution would risk the number.
 *   conversation → the number the caller picked (the customer's last number), as before.
 *
 * Why: since 2026-10-01 Meta bills every template it delivers, utility ones too.
 * WHATSAPP_TRANSACTIONAL_VIA_EVOLUTION=false switches all routing off (server-side kill switch);
 * WHATSAPP_TRANSACTIONAL_EVOLUTION_INSTANCE names the Evolution instance (empty = default).
 */
const policyText = (value) => String(value ?? "").trim();
export const automationIsMarketing = (automationType = "") =>
  automationType === "marketing_broadcast" || templateDefinition(automationType)?.category === TEMPLATE_CATEGORIES.MARKETING;
export const automationRoute = async (automationType = "") => {
  const config = await loadWhatsappSendRoutes().catch(() => null);
  return {
    route: config?.routes?.[automationType] || (automationIsMarketing(automationType) ? "official" : "evolution"),
    officialLine: policyText(config?.official_phone_number_id) || policyText(process.env.WHATSAPP_MARKETING_CLOUD_PHONE_NUMBER_ID),
  };
};
export const routeAutomationInstance = async ({ automationType = "", instance = "" } = {}) => {
  const current = policyText(instance);
  if (policyText(process.env.WHATSAPP_TRANSACTIONAL_VIA_EVOLUTION).toLowerCase() === "false") return current;
  const { route, officialLine } = await automationRoute(automationType);
  if (route === "evolution") {
    return current.toLowerCase().startsWith("cloud:") ? policyText(process.env.WHATSAPP_TRANSACTIONAL_EVOLUTION_INSTANCE) : current;
  }
  const chosen = route === "official" ? (officialLine ? `cloud:${officialLine}` : current) : current;
  // An order message on the official number past its free monthly replies moves to Evolution, as
  // a chat reply does. Marketing never does: bulk from Evolution is what risks the number — past
  // the allowance it is simply refused before Meta (templateBudget.js).
  if (automationIsMarketing(automationType)) return chosen;
  const { officialReplyRoute } = await import("../../modules/whatsappOfficial/templateBudget.js");
  return (await officialReplyRoute(chosen)).instance;
};

/*
 * The single door every automation walks through.
 *
 * With the queue OFF, `directSend` runs and the shop behaves exactly as it did before any of this
 * existed — that is the compatibility contract, and it is why the direct path stays in place in
 * every caller rather than being deleted.
 *
 * With the queue ON, the message becomes a row and the worker decides when it leaves.
 */
export const queueWhatsappAutomation = async ({
  tenantId = 0,
  automationType = "",
  customerId = null,
  orderId = null,
  invoiceNumber = "",
  recipientPhone = "",
  instance = "",
  send = {},
  values = {},
  fallbackBody = "",
  onSent = null,
  idempotencySuffix = "",
  scheduledAt = null,
  directSend = null,
} = {}) => {
  instance = await routeAutomationInstance({ automationType, instance });
  let settings = null;
  try {
    settings = await loadWhatsappQueueSettings();
  } catch (error) {
    logLifecycle("settings-unavailable", { automation_type: automationType, error: error?.message || String(error) });
  }

  if (!settings?.queue?.enabled) {
    if (typeof directSend !== "function") return { queued: false, direct: false, reason: "queue_disabled_no_direct_path" };
    return { queued: false, direct: true, result: await directSend() };
  }

  try {
    const enqueued = await enqueueWhatsappMessage({
      tenantId,
      automationType,
      customerId,
      orderId,
      invoiceNumber,
      recipientPhone,
      instance,
      send,
      values,
      fallbackBody,
      onSent,
      idempotencySuffix,
      scheduledAt,
      settings,
    });
    return { queued: enqueued.queued, duplicate: enqueued.duplicate, id: enqueued.id, variantId: enqueued.variantId, direct: false };
  } catch (error) {
    /*
     * The queue is unreachable — a database problem, not a WhatsApp one. Dropping the customer's
     * receipt on the floor would be the worse failure, and one message going out unpaced carries
     * none of the burst risk this queue exists to prevent: a DB outage is not correlated with a
     * WhatsApp reconnect, and if the DB is down the shop is not writing orders either.
     */
    console.error("[wa-queue] enqueue failed, falling back to direct send", {
      automation_type: automationType,
      order_id: orderId,
      message: error?.message || String(error),
    });
    if (typeof directSend !== "function") throw error;
    return { queued: false, direct: true, fallback: true, result: await directSend() };
  }
};

export const whatsappQueueEnabled = async () => {
  const settings = await loadWhatsappQueueSettings().catch(() => null);
  return settings?.queue?.enabled === true;
};

export { enqueueWhatsappMessage } from "./queueService.js";
export { ensureWhatsappQueueSchema } from "./schema.js";
export { runWhatsappQueueTick, startWhatsappQueueWorker, stopWhatsappQueueWorker } from "./worker.js";
