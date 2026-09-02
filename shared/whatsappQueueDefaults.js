/*
 * The WhatsApp outbound queue: its vocabulary, its defaults, and the message variants.
 *
 * Shared with the admin panel so the operator edits exactly the values the worker reads.
 *
 * Why this exists: the WhatsApp session went down for roughly a day while the shop kept selling.
 * Every invoice receipt, every "شكراً لثقتكم", every Google-review ask was POSTed straight at
 * Evolution, which accepted them over HTTP while its socket was dead and buffered them in Baileys'
 * own send queue. The moment the socket came back it flushed the lot in minutes and WhatsApp
 * restricted the account for automated/bulk messaging. The ERP never saw any of it: it had
 * stamped every one of them "sent" at the moment Evolution accepted the POST.
 *
 * None of the numbers below are claimed to be "safe for WhatsApp" — nobody outside WhatsApp knows
 * what that number is. They are deliberately conservative starting points, and every one of them
 * is editable from Settings.
 */

export const WHATSAPP_QUEUE_STATUSES = Object.freeze([
  "pending",
  "scheduled",
  "sending",
  "sent",
  "failed",
  "expired",
  "cancelled",
]);

/* Statuses a worker may still pick up. */
export const WHATSAPP_QUEUE_CLAIMABLE_STATUSES = Object.freeze(["pending", "scheduled"]);

/* Statuses nothing will ever move again. */
export const WHATSAPP_QUEUE_TERMINAL_STATUSES = Object.freeze(["sent", "expired", "cancelled", "failed"]);

export const WHATSAPP_QUEUE_RUNTIME_STATES = Object.freeze(["running", "paused", "paused_for_review"]);

/*
 * Two categories, two rulebooks.
 *
 * Transactional is what the customer is waiting for — they placed an order and the message is the
 * receipt for it. It tolerates a long expiry and several retries, because arriving late still
 * beats never arriving.
 *
 * Engagement is what the SHOP wants — a thank-you, a review ask, an offer. It is tied to a moment;
 * once that moment has passed the message is noise, and a wall of it is what gets an account
 * restricted. So it expires fast and retries barely at all.
 */
export const WHATSAPP_QUEUE_CATEGORIES = Object.freeze(["transactional", "engagement"]);

export const WHATSAPP_AUTOMATION_TYPES = Object.freeze({
  order_confirmation: "transactional",
  payment_review: "transactional",
  invoice_receipt: "engagement",
  shipment_created: "transactional",
  shipped: "transactional",
  out_for_delivery: "transactional",
  delivered: "transactional",
  google_review_request: "engagement",
  thank_you: "engagement",
  abandoned_cart: "engagement",
});

export const WHATSAPP_AUTOMATION_LABELS = Object.freeze({
  order_confirmation: { en: "Order confirmation", ar: "تأكيد الطلب" },
  payment_review: { en: "Payment review", ar: "مراجعة الدفع" },
  invoice_receipt: { en: "Invoice receipt + review ask", ar: "الفاتورة وطلب التقييم" },
  shipment_created: { en: "Shipment created", ar: "تم إنشاء الشحنة" },
  shipped: { en: "Shipped", ar: "تم الشحن" },
  out_for_delivery: { en: "Out for delivery", ar: "خارج للتسليم" },
  delivered: { en: "Delivered", ar: "تم التسليم" },
  google_review_request: { en: "Google review request", ar: "طلب تقييم جوجل" },
  thank_you: { en: "Thank you", ar: "رسالة شكر" },
  abandoned_cart: { en: "Abandoned cart", ar: "السلة المتروكة" },
});

/* Every placeholder the queue understands. Existing templates already use the {{token}} form. */
export const WHATSAPP_QUEUE_PLACEHOLDERS = Object.freeze([
  { token: "customer_name", en: "Customer name", ar: "اسم العميل" },
  { token: "invoice_number", en: "Invoice number", ar: "رقم الفاتورة" },
  { token: "invoice_url", en: "Invoice link", ar: "رابط الفاتورة" },
  { token: "order_number", en: "Order number", ar: "رقم الطلب" },
  { token: "google_review_url", en: "Google review link", ar: "رابط تقييم جوجل" },
  { token: "provider", en: "Shipping company", ar: "شركة الشحن" },
  { token: "tracking_number", en: "Tracking number", ar: "رقم التتبع" },
  { token: "tracking_url", en: "Tracking link", ar: "رابط التتبع" },
  { token: "cod_amount", en: "Amount to collect", ar: "المبلغ المطلوب" },
  { token: "store_name", en: "Store name", ar: "اسم المتجر" },
  { token: "total", en: "Order total", ar: "إجمالي الطلب" },
]);

export const WHATSAPP_QUEUE_DEFAULTS = Object.freeze({
  /*
   * OFF means "send exactly the way the shop sends today" — every automation goes straight out,
   * unqueued, unchanged. Turning it ON is what puts the pacer in the path.
   */
  enabled: true,

  /* Pacing. All four are the operator's call, not a number this code claims to know. */
  messages_per_minute: 6,
  min_delay_seconds: 6,
  max_delay_seconds: 18,
  batch_size: 5,

  /*
   * The circuit breaker. Any ONE of these trips it, and a tripped queue does not drain on its
   * own — it waits in paused_for_review until a human has looked at the backlog.
   */
  offline_pause_minutes: 30,
  pending_pause_threshold: 50,
  failure_pause_threshold: 10,
  failure_window_minutes: 15,

  /*
   * How long the session may be down before an admin is told, independent of how much is waiting.
   *
   * This exists because the backlog alone is a terrible smoke alarm. In September the session was
   * dead for three days and nothing fired: expiry kept draining the queue as fast as it filled, so
   * the pending count never came near pending_pause_threshold, and the circuit breaker only judges
   * an outage at the moment of reconnect — which never came. The shop found out because a person
   * noticed the invoices had stopped. A dead channel is worth saying out loud on its own.
   *
   * 0 disables it.
   */
  offline_alert_minutes: 20,

  /* How long a claimed row may sit in `sending` before another worker may reclaim it. */
  claim_timeout_minutes: 10,
});

export const WHATSAPP_QUEUE_CATEGORY_DEFAULTS = Object.freeze({
  transactional: {
    /* A receipt is still worth having a day later. */
    expiry_minutes: 1440,
    max_retries: 4,
    retry_backoff_seconds: 120,
    /* 0 = inherit the global rate. */
    messages_per_minute: 0,
  },
  engagement: {
    /* A thank-you four hours after the sale is a thank-you; four days later it is spam. */
    expiry_minutes: 240,
    max_retries: 1,
    retry_backoff_seconds: 600,
    messages_per_minute: 0,
  },
});

/*
 * Per-automation expiry overrides, in minutes. 0 (or absent) means "use the category's value".
 * The three that caused the incident are the ones that ship pinned short.
 */
export const WHATSAPP_AUTOMATION_EXPIRY_DEFAULTS = Object.freeze({
  invoice_receipt: 180,
  google_review_request: 120,
  thank_you: 120,
  abandoned_cart: 360,
});

/*
 * Message variants. Empty by default — deliberately: with no variants configured the automation's
 * own message goes out byte-for-byte as it does today, so switching the queue on changes pacing
 * and nothing else. Adding variants is an explicit act by the operator.
 *
 * Shape: { [automation_type]: [{ id, label, enabled, body }] }
 * Selection is round robin over the enabled variants, per automation type.
 */
export const WHATSAPP_MESSAGE_VARIANT_DEFAULTS = Object.freeze({});

export const clampNumber = (value, fallback, min, max) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
};

export const normalizeWhatsappQueueConfig = (raw) => {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const minDelay = clampNumber(source.min_delay_seconds, WHATSAPP_QUEUE_DEFAULTS.min_delay_seconds, 0, 3600);
  return {
    enabled: source.enabled === undefined ? WHATSAPP_QUEUE_DEFAULTS.enabled : source.enabled === true,
    messages_per_minute: clampNumber(source.messages_per_minute, WHATSAPP_QUEUE_DEFAULTS.messages_per_minute, 1, 600),
    min_delay_seconds: minDelay,
    // A max below the min would make the random delay range invalid; the min wins.
    max_delay_seconds: Math.max(minDelay, clampNumber(source.max_delay_seconds, WHATSAPP_QUEUE_DEFAULTS.max_delay_seconds, 0, 3600)),
    batch_size: clampNumber(source.batch_size, WHATSAPP_QUEUE_DEFAULTS.batch_size, 1, 200),
    offline_pause_minutes: clampNumber(source.offline_pause_minutes, WHATSAPP_QUEUE_DEFAULTS.offline_pause_minutes, 0, 10080),
    pending_pause_threshold: clampNumber(source.pending_pause_threshold, WHATSAPP_QUEUE_DEFAULTS.pending_pause_threshold, 0, 100000),
    failure_pause_threshold: clampNumber(source.failure_pause_threshold, WHATSAPP_QUEUE_DEFAULTS.failure_pause_threshold, 0, 100000),
    failure_window_minutes: clampNumber(source.failure_window_minutes, WHATSAPP_QUEUE_DEFAULTS.failure_window_minutes, 1, 10080),
    offline_alert_minutes: clampNumber(source.offline_alert_minutes, WHATSAPP_QUEUE_DEFAULTS.offline_alert_minutes, 0, 10080),
    claim_timeout_minutes: clampNumber(source.claim_timeout_minutes, WHATSAPP_QUEUE_DEFAULTS.claim_timeout_minutes, 1, 1440),
  };
};

export const normalizeWhatsappQueueCategories = (raw) => {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  return Object.fromEntries(WHATSAPP_QUEUE_CATEGORIES.map((category) => {
    const defaults = WHATSAPP_QUEUE_CATEGORY_DEFAULTS[category];
    const stored = source[category] && typeof source[category] === "object" ? source[category] : {};
    return [category, {
      expiry_minutes: clampNumber(stored.expiry_minutes, defaults.expiry_minutes, 1, 43200),
      max_retries: clampNumber(stored.max_retries, defaults.max_retries, 0, 20),
      retry_backoff_seconds: clampNumber(stored.retry_backoff_seconds, defaults.retry_backoff_seconds, 5, 86400),
      messages_per_minute: clampNumber(stored.messages_per_minute, defaults.messages_per_minute, 0, 600),
    }];
  }));
};

export const normalizeWhatsappAutomationExpiry = (raw) => {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const merged = { ...WHATSAPP_AUTOMATION_EXPIRY_DEFAULTS, ...source };
  return Object.fromEntries(Object.keys(WHATSAPP_AUTOMATION_TYPES).map((type) => (
    // 0 is meaningful — it is how the operator says "no override, use the category".
    [type, clampNumber(merged[type], 0, 0, 43200)]
  )));
};

const slug = (value = "") => String(value ?? "")
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9_-]+/g, "-")
  .replace(/^-+|-+$/g, "");

export const normalizeWhatsappMessageVariants = (raw) => {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const out = {};
  for (const type of Object.keys(WHATSAPP_AUTOMATION_TYPES)) {
    const list = Array.isArray(source[type]) ? source[type] : [];
    const seen = new Set();
    const variants = [];
    list.forEach((entry, index) => {
      const record = entry && typeof entry === "object" ? entry : {};
      const body = String(record.body ?? "").trim();
      if (!body) return;
      // A stable id is what keeps a retry on the same text. An id that shifted with list order
      // would let the second attempt say something different from the first for the same event.
      let id = slug(record.id) || `${type}-${String.fromCharCode(97 + (index % 26))}`;
      while (seen.has(id)) id = `${id}-${seen.size + 1}`;
      seen.add(id);
      variants.push({
        id,
        label: String(record.label ?? "").trim() || `Variant ${variants.length + 1}`,
        enabled: record.enabled !== false,
        body,
      });
    });
    if (variants.length) out[type] = variants;
  }
  return out;
};

export const whatsappAutomationCategory = (automationType = "") =>
  WHATSAPP_AUTOMATION_TYPES[String(automationType || "").trim()] || "engagement";

/*
 * Placeholder rendering. Accepts both {{token}} and {token}: the shipment templates already in
 * production use the double form and older bodies use the single one, and a variant must never
 * print a literal placeholder at a customer because the operator typed the other one.
 */
const TOKEN_PATTERN = /\{\{\s*([a-z0-9_]+)\s*\}\}|\{\s*([a-z0-9_]+)\s*\}/gi;

export const renderWhatsappTemplate = (template = "", values = {}) => {
  const lookup = (name) => {
    const value = values?.[name];
    return value === undefined || value === null ? "" : String(value).trim();
  };
  const kept = [];
  for (const line of String(template ?? "").split(/\r?\n/)) {
    const tokens = [...line.matchAll(TOKEN_PATTERN)];
    // A line whose only reason to exist is an empty value is dropped whole, label included —
    // the rule the shipment templates already follow, so "رابط الفاتورة:" never ships bare.
    if (tokens.length && tokens.some((match) => !lookup(match[1] || match[2]))) continue;
    kept.push(line.replace(TOKEN_PATTERN, (_, a, b) => lookup(a || b)));
  }
  return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
};
