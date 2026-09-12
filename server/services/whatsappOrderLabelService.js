/**
 * The order's state, written onto the WhatsApp chat itself.
 *
 * Everything the ERP knows about an order lives in the ERP. The person actually holding the
 * WhatsApp phone — answering "وصل فين؟" twenty times a day — sees a chat list with no state on
 * it at all, and has to go and look each one up. WhatsApp Business labels are the one surface
 * where our state can appear inside their app, filterable, with no screen of ours open.
 *
 * Rules this obeys:
 *
 * 1. OFF by default. It writes visible marks on real customer conversations, so it starts only
 *    when the shop turns it on (`whatsapp.status_labels`).
 * 2. Matched by NAME, never by id. A label id is meaningless to whoever configures this and
 *    changes if the account is re-linked; the name is what they see on the phone. A configured
 *    name that does not exist in WhatsApp is skipped — a typo costs a label, not a message.
 * 3. Never throws and never blocks. It is called from the middle of order flows that must not
 *    fail because a label did not stick.
 * 4. Exclusive by default: the previous status label comes off before the new one goes on, so a
 *    chat shows where the order IS rather than everywhere it has been.
 */
import { getSetting } from "./settingsService.js";
import { listWhatsappLabels, setWhatsappChatLabel } from "./whatsappCapabilitiesService.js";
import { WHATSAPP_STATUS_LABEL_DEFAULTS } from "../../shared/whatsappStatusLabelDefaults.js";

const text = (value = "", fallback = "") => String(value ?? fallback).trim();

const normalizeStatus = (value = "") => text(value).toLowerCase().replace(/[\s-]+/g, "_");

// Compared with the label names WhatsApp reports, which carry whatever spacing and casing the
// person typed on the phone. Arabic is left alone beyond this: normalizing it further would
// start merging labels the shop deliberately spells differently.
const labelKey = (value = "") => text(value).toLowerCase().replace(/\s+/g, " ");

export const normalizeStatusLabelConfig = (value) => {
  const source = value && typeof value === "object" ? value : {};
  const labels = source.labels && typeof source.labels === "object" ? source.labels : {};
  const normalizedLabels = {};
  for (const [status, name] of Object.entries(labels)) {
    const key = normalizeStatus(status);
    if (key) normalizedLabels[key] = text(name);
  }
  return {
    enabled: source.enabled === true,
    exclusive: source.exclusive !== false,
    labels: { ...WHATSAPP_STATUS_LABEL_DEFAULTS.labels, ...normalizedLabels },
  };
};

export const loadStatusLabelConfig = async () =>
  normalizeStatusLabelConfig(await getSetting("whatsapp.status_labels", WHATSAPP_STATUS_LABEL_DEFAULTS));

/*
 * Name -> id, cached.
 *
 * Labels change when somebody edits them on the phone, which is rare, and every status change
 * would otherwise pay a round trip to list them. The TTL is what makes a label created today
 * usable today without a restart.
 */
const labelIdCache = new Map();
const LABEL_CACHE_TTL_MS = 10 * 60 * 1000;

const labelIndex = async (instance = "") => {
  const cacheKey = text(instance) || "__default__";
  const cached = labelIdCache.get(cacheKey);
  if (cached && Date.now() - cached.at < LABEL_CACHE_TTL_MS) return cached.index;
  const { labels } = await listWhatsappLabels({ instance });
  const index = new Map();
  for (const label of labels) {
    const key = labelKey(label.name);
    if (key && label.id) index.set(key, label.id);
  }
  labelIdCache.set(cacheKey, { index, at: Date.now() });
  return index;
};

export const clearWhatsappLabelCache = () => labelIdCache.clear();

/**
 * Puts one order's current status on its customer's chat.
 *
 * @param previousStatus what the order was before. Used only to take the old label off; when it
 *   is unknown, `exclusive` falls back to clearing every OTHER status label it manages, which
 *   is the only way to leave the chat honest after a status was changed somewhere that did not
 *   tell us what it changed from.
 * @returns {Promise<{applied: boolean, reason: string}>} never throws.
 */
export const syncWhatsappOrderStatusLabel = async ({
  phone = "",
  status = "",
  previousStatus = "",
  instance = "",
  orderId = null,
} = {}) => {
  try {
    const config = await loadStatusLabelConfig();
    if (!config.enabled) return { applied: false, reason: "disabled" };

    const customerPhone = text(phone);
    const nextStatus = normalizeStatus(status);
    if (!customerPhone) return { applied: false, reason: "no_phone" };
    if (!nextStatus) return { applied: false, reason: "no_status" };

    const targetName = text(config.labels[nextStatus]);
    // A status the shop chose not to label is not a failure: it is the configuration working.
    if (!targetName && !config.exclusive) return { applied: false, reason: "status_not_labelled" };

    const index = await labelIndex(instance);
    const targetId = targetName ? index.get(labelKey(targetName)) : "";
    if (targetName && !targetId) {
      console.warn("[whatsapp-order-label] label not found in WhatsApp", {
        order_id: orderId,
        status: nextStatus,
        label_name: targetName,
      });
    }

    /*
     * What has to come off.
     *
     * With a known previous status that is just its label. Without one — the common case, since
     * most callers know only where the order landed — every other managed label is removed, so
     * a chat cannot keep wearing "تم التأكيد" after it shipped. Labels the shop uses for its own
     * purposes are untouched: only names this mapping owns are ever removed.
     */
    const removals = new Set();
    if (config.exclusive) {
      const previous = normalizeStatus(previousStatus);
      const stale = previous
        ? [config.labels[previous]]
        : Object.entries(config.labels)
            .filter(([key]) => key !== nextStatus)
            .map(([, name]) => name);
      for (const name of stale) {
        const id = text(name) ? index.get(labelKey(name)) : "";
        if (id && id !== targetId) removals.add(id);
      }
    }

    for (const labelId of removals) {
      await setWhatsappChatLabel({ phone: customerPhone, labelId, action: "remove", instance })
        .catch((error) => {
          // Removing a label the chat never had is not an error worth failing the apply for.
          console.warn("[whatsapp-order-label] remove failed", {
            order_id: orderId,
            label_id: labelId,
            message: error?.message || String(error),
          });
        });
    }

    if (!targetId) return { applied: false, reason: targetName ? "label_missing_in_whatsapp" : "status_not_labelled" };

    await setWhatsappChatLabel({ phone: customerPhone, labelId: targetId, action: "add", instance });
    console.info("[whatsapp-order-label] applied", {
      order_id: orderId,
      status: nextStatus,
      label: targetName,
      removed: removals.size,
      phone_suffix: customerPhone.slice(-4),
    });
    return { applied: true, reason: "applied", label: targetName, labelId: targetId, removed: removals.size };
  } catch (error) {
    console.warn("[whatsapp-order-label] skipped", {
      order_id: orderId,
      status,
      message: error?.message || String(error),
    });
    return { applied: false, reason: "error" };
  }
};

export default {
  loadStatusLabelConfig,
  normalizeStatusLabelConfig,
  syncWhatsappOrderStatusLabel,
  clearWhatsappLabelCache,
};
