import { loadWhatsappQueueSettings } from "./config.js";
import { enqueueWhatsappMessage, logLifecycle } from "./queueService.js";

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
