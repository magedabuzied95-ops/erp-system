import { registerJobHandler } from "./jobQueueService.js";
import { sendWhatsappNotification } from "../utils/whatsapp.js";

let registered = false;

const hasValue = (value) => value !== undefined && value !== null && String(value).trim() !== "";

export const registerBackgroundJobHandlers = () => {
  if (registered) return;
  registered = true;

  registerJobHandler("whatsapp.send", async (payload = {}) => {
    const result = await sendWhatsappNotification(payload);
    console.log("[jobs] whatsapp.send result", {
      provider: result?.provider || null,
      ok: Boolean(result?.ok),
      hasFallbackUrl: hasValue(result?.fallbackUrl),
      orderId: payload.orderId || payload.order_id || null,
      invoiceNumber: payload.invoiceNumber || payload.invoice_number || null,
    });
    return result;
  });

  registerJobHandler("email.send", async (payload = {}) => {
    console.warn("[jobs] email.send skipped", {
      reason: "email provider not configured",
      template: payload.template || null,
      hasRecipient: hasValue(payload.to || payload.email),
    });
    return { ok: false, skipped: true, reason: "email provider not configured" };
  });
};

