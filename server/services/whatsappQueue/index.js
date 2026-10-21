import { loadWhatsappQueueSettings } from "./config.js";
import { enqueueWhatsappMessage, logLifecycle } from "./queueService.js";
import { TEMPLATE_CATEGORIES, templateDefinition } from "../whatsappTemplates.js";

/*
 * WHICH NUMBER an automation leaves from — the store's cost policy (owner, 2026-10-21).
 *
 * Since 2026-10-01 Meta bills every template it delivers, utility ones too. So:
 *   - order / payment / shipping messages leave from EVOLUTION (free), even for a customer who
 *     wrote to the official number — on the coexistence number that is the same chat anyway;
 *   - marketing (campaigns, abandoned cart, price drop, review asks, thank-you) leaves from the
 *     official number named by WHATSAPP_MARKETING_CLOUD_PHONE_NUMBER_ID, where Evolution would
 *     risk the number. Unset (today, before M1 is on Cloud), marketing keeps its current route.
 *
 * WHATSAPP_TRANSACTIONAL_VIA_EVOLUTION=false switches the policy off (every message then follows
 * the number its caller chose, as before). WHATSAPP_TRANSACTIONAL_EVOLUTION_INSTANCE names the
 * Evolution instance; empty = the gateway's default instance.
 */
const policyText = (value) => String(value ?? "").trim();
export const automationIsMarketing = (automationType = "") =>
  automationType === "marketing_broadcast" || templateDefinition(automationType)?.category === TEMPLATE_CATEGORIES.MARKETING;
export const routeAutomationInstance = ({ automationType = "", instance = "" } = {}) => {
  const current = policyText(instance);
  if (policyText(process.env.WHATSAPP_TRANSACTIONAL_VIA_EVOLUTION).toLowerCase() === "false") return current;
  if (automationIsMarketing(automationType)) {
    const marketingLine = policyText(process.env.WHATSAPP_MARKETING_CLOUD_PHONE_NUMBER_ID);
    return marketingLine ? `cloud:${marketingLine}` : current;
  }
  return current.toLowerCase().startsWith("cloud:") ? policyText(process.env.WHATSAPP_TRANSACTIONAL_EVOLUTION_INSTANCE) : current;
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
  instance = routeAutomationInstance({ automationType, instance });
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
