/*
 * The switchboard for the automatic WhatsApp messages.
 *
 * Three automations the shop can switch off without touching code, and without losing the message
 * text they send:
 *
 *   invoice            - the receipt link that follows a saved invoice (POS checkout and the
 *                        storefront order receipt).
 *   order_confirmation - the confirm/cancel message a storefront COD order gets.
 *   abandoned_cart     - the one carousel a saved cart gets after it sits untouched.
 *
 * Every switch defaults to ON so a deploy changes nothing. That is deliberate and it is why the
 * defaults are not "today's observed behaviour" for the abandoned cart: that automation is off
 * today because of its OWN `enabled` flag, which still stands. A master switch that defaulted to
 * false would have silently turned off a shop that had already switched the reminder on.
 *
 * These switches decide AUTOMATIC sends only. A human pressing "send" on the order page is asking
 * for that one message to go out now; a switch that exists to stop an automation must not refuse
 * a person. Every manual path passes force:true and bypasses these.
 *
 * Lives in shared/ because the settings registry (imported by the frontend settings screens too)
 * and the three services that read it must never drift apart.
 */

export const WHATSAPP_AUTOMATION_SETTING_KEY = "whatsapp.automations";

export const WHATSAPP_AUTOMATION_SWITCH_DEFAULTS = {
  invoice: true,
  order_confirmation: true,
  abandoned_cart: true,
};

export const WHATSAPP_AUTOMATION_SWITCH_KEYS = Object.keys(WHATSAPP_AUTOMATION_SWITCH_DEFAULTS);

/*
 * The automation's own precondition, kept where it already lives.
 *
 * Neither of these is a second switch for the same thing: the panel writes the master and the
 * legacy flag together, and reads them as an AND, so one switch is shown and both stay in step.
 * They are read as well as written because a shop may have set them from the POS settings page
 * long before this panel existed, and that answer has to keep counting.
 */
export const WHATSAPP_AUTOMATION_LEGACY_KEYS = {
  invoice: "pos.auto_send_pos_invoice_whatsapp",
  abandoned_cart: "marketing.abandoned_cart_reminder",
};

const bool = (value, fallback) => {
  if (value === true || value === "true" || value === 1 || value === "1") return true;
  if (value === false || value === "false" || value === 0 || value === "0") return false;
  return fallback;
};

export const normalizeWhatsappAutomationSwitches = (raw) => {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  return WHATSAPP_AUTOMATION_SWITCH_KEYS.reduce((switches, key) => {
    switches[key] = bool(source[key], WHATSAPP_AUTOMATION_SWITCH_DEFAULTS[key]);
    return switches;
  }, {});
};

export const whatsappAutomationEnabled = (raw, name) => normalizeWhatsappAutomationSwitches(raw)[name] === true;
