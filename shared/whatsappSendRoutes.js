/*
 * Which WhatsApp number each automatic message leaves from, and the cap on Meta's paid templates.
 * Edited from the inbox: top bar → WhatsApp → "مين يبعت إيه". Read by the server's
 * routeAutomationInstance (whatsappQueue/index.js) and templateBudget.js.
 *
 * Why it exists: since 2026-10-01 Meta bills every template it delivers (≈ $0.0036 a utility one
 * in Egypt, ≈ $0.0644 a marketing one). Evolution sends for free but risks the number on bulk
 * sends. So the owner picks, message by message:
 *
 *   "evolution"    — the Evolution line (free). For order / payment / shipping messages.
 *   "official"     — the official Cloud number below (Meta bills templates). For marketing.
 *   "conversation" — the number the customer last wrote to (the behaviour before this setting).
 */

import { WHATSAPP_AUTOMATION_TYPES } from "./whatsappQueueDefaults.js";

export const WHATSAPP_SEND_ROUTE_SETTING_KEY = "whatsapp.send_routes";
export const WHATSAPP_SEND_ROUTE_CHOICES = Object.freeze(["evolution", "official", "conversation"]);

// The automations Meta prices as MARKETING (server/services/whatsappTemplates.js categories).
export const WHATSAPP_MARKETING_AUTOMATIONS = Object.freeze([
  "abandoned_cart",
  "price_drop_alert",
  "google_review_request",
  "thank_you",
  "product_review_request",
  "marketing_broadcast",
]);
export const isMarketingAutomation = (type = "") => WHATSAPP_MARKETING_AUTOMATIONS.includes(String(type));

export const WHATSAPP_SEND_ROUTE_DEFAULTS = Object.freeze({
  routes: Object.freeze(Object.fromEntries(
    Object.keys(WHATSAPP_AUTOMATION_TYPES).map((type) => [type, isMarketingAutomation(type) ? "official" : "evolution"])
  )),
  // The official (Cloud) number marketing leaves from; empty = keep each message's own number.
  official_phone_number_id: "",
  template_daily_cap: 50,
  template_monthly_cap: 500,
  // Free-form messages from the official number: Meta gives 1,000 a month free, then bills each.
  // Past the limit, replies to customers move to Evolution ("evolution") or wait for a person
  // ("block"); either way nothing past it leaves through Meta.
  service_reply_monthly_limit: 1000,
  service_reply_over_limit: "evolution",
});
export const WHATSAPP_SERVICE_OVER_LIMIT_CHOICES = Object.freeze(["evolution", "block"]);

const cap = (value, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.min(Math.floor(number), 1000000) : fallback;
};

export const normalizeWhatsappSendRoutes = (value) => {
  const source = value && typeof value === "object" ? value : {};
  const routes = {};
  for (const type of Object.keys(WHATSAPP_AUTOMATION_TYPES)) {
    const chosen = String(source.routes?.[type] ?? "").trim();
    routes[type] = WHATSAPP_SEND_ROUTE_CHOICES.includes(chosen) ? chosen : WHATSAPP_SEND_ROUTE_DEFAULTS.routes[type];
  }
  return {
    routes,
    official_phone_number_id: String(source.official_phone_number_id ?? "").replace(/\D/g, "").slice(0, 32),
    template_daily_cap: cap(source.template_daily_cap, WHATSAPP_SEND_ROUTE_DEFAULTS.template_daily_cap),
    template_monthly_cap: cap(source.template_monthly_cap, WHATSAPP_SEND_ROUTE_DEFAULTS.template_monthly_cap),
    service_reply_monthly_limit: cap(source.service_reply_monthly_limit, WHATSAPP_SEND_ROUTE_DEFAULTS.service_reply_monthly_limit),
    service_reply_over_limit: WHATSAPP_SERVICE_OVER_LIMIT_CHOICES.includes(String(source.service_reply_over_limit ?? ""))
      ? String(source.service_reply_over_limit)
      : WHATSAPP_SEND_ROUTE_DEFAULTS.service_reply_over_limit,
  };
};
