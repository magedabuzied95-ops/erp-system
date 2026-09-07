import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { ABANDONED_CART_DEFAULTS } from "../shared/abandonedCartDefaults.js";
import {
  WHATSAPP_AUTOMATION_SETTING_KEY,
  WHATSAPP_AUTOMATION_SWITCH_DEFAULTS,
  WHATSAPP_AUTOMATION_SWITCH_KEYS,
  normalizeWhatsappAutomationSwitches,
  whatsappAutomationEnabled,
} from "../shared/whatsappAutomationDefaults.js";

/*
 * The on/off switchboard for the three automatic WhatsApp messages: the invoice receipt, the order
 * confirmation, and the abandoned-cart reminder.
 *
 * The contract worth defending is not "a boolean is stored". It is:
 *   - a shop that never opens the panel keeps exactly the behaviour it has today;
 *   - a switch that is off stops the AUTOMATIC send and nothing else - a person can still send it;
 *   - one switch on screen never disagrees with the older per-feature flag behind it.
 */

const readSource = (relative) => fs.readFileSync(new URL(relative, import.meta.url), "utf8");

const routeSource = readSource("../server/routes/whatsappAutomations.js");
const confirmationSource = readSource("../server/services/whatsappOrderConfirmationService.js");
const reminderSource = readSource("../server/services/abandonedCartReminderService.js");
const serverSource = readSource("../server/server.js");
const registrySource = readSource("../shared/settingsRegistry.js");

// ---------------------------------------------------------------------------------------------
// The switch values themselves.
// ---------------------------------------------------------------------------------------------

test("every switch defaults to on, so a deploy changes nothing about what the shop sends", () => {
  for (const key of WHATSAPP_AUTOMATION_SWITCH_KEYS) {
    assert.equal(WHATSAPP_AUTOMATION_SWITCH_DEFAULTS[key], true, `${key} must default to on`);
  }
  // A missing row, an empty object, junk - all of them mean "carry on as before".
  for (const stored of [undefined, null, {}, [], "", 0, "nonsense"]) {
    assert.deepEqual(normalizeWhatsappAutomationSwitches(stored), WHATSAPP_AUTOMATION_SWITCH_DEFAULTS);
  }
});

test("a stored switch is read back, and one absent key does not drag the others down", () => {
  const stored = normalizeWhatsappAutomationSwitches({ abandoned_cart: false });
  assert.equal(stored.abandoned_cart, false);
  assert.equal(stored.invoice, true);
  assert.equal(stored.order_confirmation, true);
});

test("the values a settings row can actually come back as are all understood", () => {
  assert.equal(whatsappAutomationEnabled({ invoice: "false" }, "invoice"), false);
  assert.equal(whatsappAutomationEnabled({ invoice: 0 }, "invoice"), false);
  assert.equal(whatsappAutomationEnabled({ invoice: "true" }, "invoice"), true);
  assert.equal(whatsappAutomationEnabled({ invoice: 1 }, "invoice"), true);
  // An unknown name is not a switch anybody can turn off by accident.
  assert.equal(whatsappAutomationEnabled({}, "not_an_automation"), false);
});

// ---------------------------------------------------------------------------------------------
// The route's real read/write logic, executed with stubbed settings.
// ---------------------------------------------------------------------------------------------

const from = routeSource.indexOf("const POS_INVOICE_KEY");
const to = routeSource.indexOf('router.get("/"');
assert.ok(from > -1 && to > from, "the route's settings block was found");

const buildRouteLogic = (store) => {
  const written = [];
  const getSetting = async (key, fallback) => (key in store ? store[key] : fallback);
  const setSetting = async (key, value) => {
    store[key] = value;
    written.push({ key, value });
  };
  const module = new Function(
    "getSetting",
    "setSetting",
    "ABANDONED_CART_DEFAULTS",
    "WHATSAPP_AUTOMATION_SETTING_KEY",
    "WHATSAPP_AUTOMATION_SWITCH_KEYS",
    "normalizeWhatsappAutomationSwitches",
    `${routeSource.slice(from, to)}\nreturn { readAutomations, applyAutomationUpdates, readUpdates, asBoolean };`
  )(
    getSetting,
    setSetting,
    ABANDONED_CART_DEFAULTS,
    WHATSAPP_AUTOMATION_SETTING_KEY,
    WHATSAPP_AUTOMATION_SWITCH_KEYS,
    normalizeWhatsappAutomationSwitches
  );
  return { ...module, store, written };
};

test("a shop that has never opened the panel reads exactly its current behaviour", async () => {
  // Nothing stored anywhere: the invoice receipt is on (the POS flag defaults on), the
  // confirmation is on, and the abandoned-cart reminder is off because its own flag ships off.
  const { readAutomations } = buildRouteLogic({});
  const view = await readAutomations();
  assert.equal(view.invoice, true);
  assert.equal(view.order_confirmation, true);
  assert.equal(view.abandoned_cart, false, "the reminder's own enabled flag still ships off");
});

test("an older answer given on the POS settings page is not overridden by the master switch", async () => {
  const { readAutomations } = buildRouteLogic({ "pos.auto_send_pos_invoice_whatsapp": false });
  const view = await readAutomations();
  assert.equal(view.invoice, false, "the panel shows off, because the effective answer is off");
  assert.equal(view.detail.master.invoice, true);
  assert.equal(view.detail.pos_invoice_auto_send, false, "and it can say which half said no");
});

test("a shop that had switched the reminder on keeps it on", async () => {
  const { readAutomations } = buildRouteLogic({
    "marketing.abandoned_cart_reminder": { ...ABANDONED_CART_DEFAULTS, enabled: true },
  });
  assert.equal((await readAutomations()).abandoned_cart, true);
});

test("switching one on writes the master AND the old flag, so the two can never disagree", async () => {
  const logic = buildRouteLogic({});
  await logic.applyAutomationUpdates(logic.readUpdates({ abandoned_cart: true }));
  assert.equal(logic.store["marketing.abandoned_cart_reminder"].enabled, true);
  assert.equal(logic.store[WHATSAPP_AUTOMATION_SETTING_KEY].abandoned_cart, true);
  assert.equal(await logic.readAutomations().then((view) => view.abandoned_cart), true);
});

test("turning the reminder on keeps its message text and delay untouched", async () => {
  const custom = { ...ABANDONED_CART_DEFAULTS, enabled: false, body: "نص المتجر", delay_minutes: 45 };
  const logic = buildRouteLogic({ "marketing.abandoned_cart_reminder": custom });
  await logic.applyAutomationUpdates({ abandoned_cart: true });
  const saved = logic.store["marketing.abandoned_cart_reminder"];
  assert.equal(saved.body, "نص المتجر", "a switch must not rewrite the wording");
  assert.equal(saved.delay_minutes, 45);
  assert.equal(saved.enabled, true);
});

test("switching the invoice receipt off also clears the POS flag behind it", async () => {
  const logic = buildRouteLogic({});
  await logic.applyAutomationUpdates({ invoice: false });
  assert.equal(logic.store["pos.auto_send_pos_invoice_whatsapp"], false);
  assert.equal((await logic.readAutomations()).invoice, false);
});

test("a switch the caller did not send is left alone", async () => {
  const logic = buildRouteLogic({});
  const updates = logic.readUpdates({ order_confirmation: false, nonsense: true });
  assert.deepEqual(updates, { order_confirmation: false });
  await logic.applyAutomationUpdates(updates);
  assert.equal(logic.store[WHATSAPP_AUTOMATION_SETTING_KEY].invoice, true, "untouched switches stay on");
  assert.equal(
    logic.written.some((entry) => entry.key === "pos.auto_send_pos_invoice_whatsapp"),
    false,
    "and no mirror is written for a switch nobody moved"
  );
});

test("an empty body is not a request to turn everything off", () => {
  const logic = buildRouteLogic({});
  assert.deepEqual(logic.readUpdates({}), {});
  assert.deepEqual(logic.readUpdates(null), {});
  assert.deepEqual(logic.readUpdates({ invoice: "maybe" }), {}, "a value that is not a boolean is not a switch");
});

// ---------------------------------------------------------------------------------------------
// The three send paths actually consult the switch - and only for automatic sends.
// ---------------------------------------------------------------------------------------------

const sliceFunction = (source, header) => {
  const start = source.indexOf(header);
  assert.ok(start > -1, `${header} found`);
  const end = source.indexOf("\nexport const ", start + header.length);
  return source.slice(start, end > -1 ? end : source.length);
};

test("the order confirmation is gated, and a manual send bypasses the gate", () => {
  const fn = sliceFunction(confirmationSource, "export const sendOrderConfirmation");
  assert.match(fn, /automationSwitchOn\("order_confirmation"\)/, "the switch is read");
  assert.match(fn, /isManualSend \? true : await automationSwitchOn/, "a manual send never asks");
  // The gate has to stand in front of the per-order checks, otherwise a disabled automation still
  // reports "not_cod_order" and nobody can tell it was switched off.
  const gate = fn.indexOf('"automation_disabled"');
  assert.ok(gate > -1, "the skip is recorded with a reason");
  assert.ok(
    gate < fn.indexOf('"not_storefront_order"'),
    "the switch is checked before anything about the particular order"
  );
});

test("the invoice receipt is gated for both the till and the storefront", () => {
  const fn = sliceFunction(confirmationSource, "export const sendInvoiceWhatsapp");
  assert.match(fn, /automationSwitchOn\("invoice"\)/);
  assert.match(fn, /isManualResend \? true : await automationSwitchOn/, "a manual resend never asks");
  // Before the isPosInvoice fork, so the storefront receipt is covered too - it never had a switch.
  const gate = fn.indexOf('"automation_disabled"');
  assert.ok(gate > -1, "the skip is recorded with a reason");
  assert.ok(
    gate < fn.indexOf('"setting_disabled"'),
    "checked before the POS-only flag, so the storefront receipt is covered as well"
  );
});

test("the abandoned-cart tick asks the switch before it claims a single cart", () => {
  const fn = sliceFunction(reminderSource, "export const runAbandonedCartReminderTick");
  assert.match(fn, /whatsappAutomationEnabled\(/);
  const gate = fn.indexOf('if (!switchOn) return { sent: 0, reason: "automation_disabled" };');
  assert.ok(gate > -1, "the tick returns early when the switch is off");
  assert.ok(
    gate < fn.indexOf("ensureAbandonedCartSchema"),
    "no work is done for an automation that is switched off"
  );
  assert.match(fn, /config\.enabled/, "the reminder's own flag still counts");
});

test("a settings read that fails answers ON, so a database wobble cannot silence the shop", () => {
  assert.match(
    confirmationSource,
    /automation-switch-unavailable[\s\S]{0,200}return true;/,
    "the catch returns true"
  );
});

// ---------------------------------------------------------------------------------------------
// Wiring.
// ---------------------------------------------------------------------------------------------

test("the setting is registered, so it can be read, written and seen", () => {
  assert.match(registrySource, /"whatsapp\.automations", "ai_channels", "json", WHATSAPP_AUTOMATION_SWITCH_DEFAULTS/);
});

test("the panel's routes are mounted before the gateway router that would swallow them", () => {
  const automations = serverSource.indexOf('app.use("/api/whatsapp/automations"');
  const gateway = serverSource.indexOf('app.use("/api/whatsapp", whatsappGatewayRoutes)');
  assert.ok(automations > -1 && gateway > -1);
  assert.ok(automations < gateway, "/api/whatsapp/automations must be mounted first");
});

test("reading is settings:view and writing is settings:edit", () => {
  assert.match(routeSource, /router\.get\("\/", protect, permit\("settings", "view"\)/);
  assert.match(routeSource, /router\.put\("\/", protect, permit\("settings", "edit"\)/);
});
