import express from "express";

import { protect } from "../middleware/authMiddleware.js";
import permit from "../middleware/permissionMiddleware.js";
import { clearSettingsCache, getSetting, setSetting } from "../services/settingsService.js";
import { ABANDONED_CART_DEFAULTS } from "../../shared/abandonedCartDefaults.js";
import {
  WHATSAPP_AUTOMATION_SETTING_KEY,
  WHATSAPP_AUTOMATION_SWITCH_KEYS,
  normalizeWhatsappAutomationSwitches,
} from "../../shared/whatsappAutomationDefaults.js";

/*
 * The on/off switchboard for the automatic WhatsApp messages.
 *
 * Read is settings:view, writes are settings:edit - the same bar as the queue dashboard next to
 * it, and for the same reason: switching one of these off decides what every customer from now on
 * does or does not receive.
 *
 * Each automation has ONE switch here even where two flags stand behind it. The invoice receipt is
 * also gated by the POS settings page's own auto-send flag, and the abandoned-cart reminder by its
 * own `enabled`; the effective answer is the AND of the two, and a write sets both to the same
 * value so the panel and the older screens can never tell the operator different stories.
 */

const router = express.Router();

const POS_INVOICE_KEY = "pos.auto_send_pos_invoice_whatsapp";
const ABANDONED_CART_KEY = "marketing.abandoned_cart_reminder";

const asBoolean = (value) => {
  if (value === true || value === "true" || value === 1 || value === "1") return true;
  if (value === false || value === "false" || value === 0 || value === "0") return false;
  return null;
};

const abandonedCartConfig = (raw) => ({
  ...ABANDONED_CART_DEFAULTS,
  ...(raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}),
});

const readAutomations = async () => {
  const [master, posInvoice, abandonedCart] = await Promise.all([
    getSetting(WHATSAPP_AUTOMATION_SETTING_KEY, undefined),
    getSetting(POS_INVOICE_KEY, true),
    getSetting(ABANDONED_CART_KEY, undefined),
  ]);
  const switches = normalizeWhatsappAutomationSwitches(master);
  const cart = abandonedCartConfig(abandonedCart);
  return {
    // The effective answer per automation, which is what the panel draws.
    invoice: switches.invoice && posInvoice !== false,
    order_confirmation: switches.order_confirmation,
    abandoned_cart: switches.abandoned_cart && cart.enabled === true,
    // The parts behind it, so the panel can say WHY a switch reads off when the master is on.
    detail: {
      master: switches,
      pos_invoice_auto_send: posInvoice !== false,
      abandoned_cart_enabled: cart.enabled === true,
    },
  };
};

/*
 * Apply a partial set of switches.
 *
 * Split out of the handler so the AND-and-mirror contract can be executed by a test with stubbed
 * settings rather than only read from the source.
 */
const applyAutomationUpdates = async (updates, userId = null) => {
  const current = normalizeWhatsappAutomationSwitches(await getSetting(WHATSAPP_AUTOMATION_SETTING_KEY, undefined));
  await setSetting(WHATSAPP_AUTOMATION_SETTING_KEY, { ...current, ...updates }, "ai_channels", userId);

  // Mirror the older per-feature flags, so the AND above lands on the value the operator just
  // chose instead of on a stale "off" left behind on another screen.
  if (updates.invoice !== undefined) {
    await setSetting(POS_INVOICE_KEY, updates.invoice, "pos", userId);
  }
  if (updates.abandoned_cart !== undefined) {
    const cart = abandonedCartConfig(await getSetting(ABANDONED_CART_KEY, undefined));
    await setSetting(ABANDONED_CART_KEY, { ...cart, enabled: updates.abandoned_cart }, "ai_channels", userId);
  }
};

const readUpdates = (body) => {
  const incoming = body && typeof body === "object" ? body : {};
  const updates = {};
  for (const key of WHATSAPP_AUTOMATION_SWITCH_KEYS) {
    const value = asBoolean(incoming[key]);
    if (value !== null) updates[key] = value;
  }
  return updates;
};

router.get("/", protect, permit("settings", "view"), async (req, res) => {
  try {
    res.json({ success: true, automations: await readAutomations() });
  } catch (error) {
    console.error("[whatsapp:automations-read-error]", { message: error?.message || String(error) });
    res.status(500).json({ success: false, message: "Failed to load WhatsApp automations" });
  }
});

router.put("/", protect, permit("settings", "edit"), async (req, res) => {
  try {
    const updates = readUpdates(req.body);
    if (!Object.keys(updates).length) {
      return res.status(400).json({ success: false, message: "No automation switches were provided" });
    }

    await applyAutomationUpdates(updates, req.user?.id || null);

    clearSettingsCache();
    console.info("[whatsapp:automations-updated]", { by: req.user?.id || null, ...updates });
    res.json({ success: true, automations: await readAutomations() });
  } catch (error) {
    console.error("[whatsapp:automations-write-error]", { message: error?.message || String(error) });
    res.status(400).json({ success: false, message: error?.message || "Failed to update WhatsApp automations" });
  }
});

export default router;
