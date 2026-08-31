import { getSetting } from "../settingsService.js";
import {
  WHATSAPP_QUEUE_CATEGORY_DEFAULTS,
  WHATSAPP_QUEUE_DEFAULTS,
  normalizeWhatsappAutomationExpiry,
  normalizeWhatsappMessageVariants,
  normalizeWhatsappQueueCategories,
  normalizeWhatsappQueueConfig,
  whatsappAutomationCategory,
} from "../../../shared/whatsappQueueDefaults.js";

/*
 * Every knob the queue obeys, read from Settings. Nothing here falls back to a literal in the
 * worker: if a value is missing it comes from shared/whatsappQueueDefaults.js, which is the same
 * file the admin panel renders its defaults from.
 */

export const WHATSAPP_QUEUE_SETTING_KEY = "whatsapp.queue";
export const WHATSAPP_QUEUE_CATEGORY_SETTING_KEY = "whatsapp.queue_categories";
export const WHATSAPP_AUTOMATION_EXPIRY_SETTING_KEY = "whatsapp.automation_expiry";
export const WHATSAPP_MESSAGE_VARIANT_SETTING_KEY = "whatsapp.message_variants";

export const loadQueueConfig = async () =>
  normalizeWhatsappQueueConfig(await getSetting(WHATSAPP_QUEUE_SETTING_KEY, undefined).catch(() => undefined));

export const loadCategoryConfig = async () =>
  normalizeWhatsappQueueCategories(await getSetting(WHATSAPP_QUEUE_CATEGORY_SETTING_KEY, undefined).catch(() => undefined));

export const loadAutomationExpiry = async () =>
  normalizeWhatsappAutomationExpiry(await getSetting(WHATSAPP_AUTOMATION_EXPIRY_SETTING_KEY, undefined).catch(() => undefined));

export const loadMessageVariants = async () =>
  normalizeWhatsappMessageVariants(await getSetting(WHATSAPP_MESSAGE_VARIANT_SETTING_KEY, undefined).catch(() => undefined));

/* Everything the enqueue path and the worker need, in one read. */
export const loadWhatsappQueueSettings = async () => {
  const [queue, categories, automationExpiry, variants] = await Promise.all([
    loadQueueConfig(),
    loadCategoryConfig(),
    loadAutomationExpiry(),
    loadMessageVariants(),
  ]);
  return { queue, categories, automationExpiry, variants };
};

/*
 * The rules that apply to one automation type: its category's rulebook, with the per-type expiry
 * override on top when the operator has set one. 0 means "no override" — not "expire instantly".
 */
export const rulesForAutomation = (automationType, settings) => {
  const category = whatsappAutomationCategory(automationType);
  const categoryRules = settings?.categories?.[category]
    || WHATSAPP_QUEUE_CATEGORY_DEFAULTS[category]
    || WHATSAPP_QUEUE_CATEGORY_DEFAULTS.engagement;
  const override = Number(settings?.automationExpiry?.[automationType] || 0);
  return {
    category,
    expiry_minutes: override > 0 ? override : categoryRules.expiry_minutes,
    max_retries: categoryRules.max_retries,
    retry_backoff_seconds: categoryRules.retry_backoff_seconds,
    messages_per_minute: categoryRules.messages_per_minute > 0
      ? categoryRules.messages_per_minute
      : (settings?.queue?.messages_per_minute || WHATSAPP_QUEUE_DEFAULTS.messages_per_minute),
  };
};
