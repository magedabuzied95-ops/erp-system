import { useEffect } from "react";

import { subscribeRealtime } from "../../shared/realtime/socketStore";
import { emitRealtimeFeedback } from "../../services/realtimeFeedbackService";

const SOCKET_EVENTS = [
  "new_order",
  "payment_success",
  "payment_confirmed",
  "low_stock",
  "attendance:check-in",
  "attendance:check-out",
  "ai:new-message",
  "ai:recommendation",
  "ai:exact-product-found",
  "ai:no-results",
  "ai:escalation",
  "ai:customer-message",
];

const eventAlias = {
  "attendance:check-in": "attendance_check_in",
  "attendance:check-out": "attendance_check_out",
  "ai:new-message": "ai_message",
  "ai:recommendation": "ai_recommendation",
  "ai:exact-product-found": "ai_exact_product_found",
  "ai:no-results": "ai_no_results",
  "ai:escalation": "ai_escalation",
  "ai:customer-message": "ai_customer_message",
};

export function RealtimeToastManager() {
  useEffect(() => {
    const unsubscribers = SOCKET_EVENTS.map((eventName) =>
      subscribeRealtime(eventName, (payload = {}) => {
        emitRealtimeFeedback(eventAlias[eventName] || eventName, payload);
      })
    );
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, []);

  return null;
}

export default RealtimeToastManager;
