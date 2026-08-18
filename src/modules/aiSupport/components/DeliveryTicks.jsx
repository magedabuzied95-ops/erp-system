import { Check, CheckCheck, Clock } from "lucide-react";
import { useTranslation } from "react-i18next";

/*
 * delivery_status is a RAW enum. It is compared against "failed"/"sending"
 * in payload handling and travels in payloads, so the value itself must never
 * change -- only how it is shown. Keys live in a literal map rather than being
 * built by interpolation, so every one stays statically visible to the
 * missing-key guard, and an unrecognised status falls back to its raw text
 * rather than rendering nothing.
 */
export const DELIVERY_STATUS_KEYS = {
  sending: "aiSupport.inbox.delivery.sending",
  sent: "aiSupport.inbox.delivery.sent",
  delivered: "aiSupport.inbox.delivery.delivered",
  read: "aiSupport.inbox.delivery.read",
  failed: "aiSupport.inbox.delivery.failed",
  pending: "aiSupport.inbox.delivery.pending",
};

export const deliveryStatusLabel = (t, status) => {
  const key = DELIVERY_STATUS_KEYS[String(status || "").toLowerCase()];
  return key ? t(key) : String(status || "");
};

const TICK_STATES = new Set(["pending", "sending", "sent", "delivered", "read"]);

export const isTickableDeliveryStatus = (status) =>
  TICK_STATES.has(String(status || "").trim().toLowerCase());

// WhatsApp-style delivery marks: clock while pending/sending, ✓ sent,
// ✓✓ delivered, blue ✓✓ read. Everything else (failed, stored_only, unknown)
// is the caller's responsibility so failure text/styling stays where it is.
export default function DeliveryTicks({ status, className = "" }) {
  const { t } = useTranslation();
  const normalized = String(status || "").trim().toLowerCase();
  if (!TICK_STATES.has(normalized)) return null;
  const label = deliveryStatusLabel(t, normalized);
  const Icon = normalized === "pending" || normalized === "sending" ? Clock : normalized === "sent" ? Check : CheckCheck;
  return (
    <span title={label} aria-label={label} className={`inline-flex shrink-0 items-center ${className}`}>
      <Icon className={`h-3.5 w-3.5 ${normalized === "read" ? "text-sky-400" : "opacity-70"}`} strokeWidth={2.5} aria-hidden="true" />
    </span>
  );
}
