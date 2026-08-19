import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

// auto_send is the only path in the product that messages a customer with nobody
// reading it first. These lock the guards that keep it from firing wider than
// intended — each one is a rule that, if quietly dropped, sends real WhatsApp
// messages to real customers.

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const notifications = read("server/services/restockNotificationService.js");
const recovery = read("server/services/aiRestockRecoveryService.js");
const studioUi = read("src/modules/aiStudio/pages/AiStudioRestockRecovery.jsx");

test("auto_send is a real mode and only sending modes may dispatch", () => {
  assert.match(notifications, /MESSAGING_MODES = Object\.freeze\(\["off", "preview_only", "approval_send", "auto_send"\]\)/);
  assert.match(notifications, /SENDING_MODES = Object\.freeze\(\["approval_send", "auto_send"\]\)/);
  // off / preview_only must never reach a provider.
  assert.match(notifications, /if \(!SENDING_MODES\.includes\(mode\)\)[\s\S]{0,160}MODE_BLOCKED/);
});

test("an unattended send is refused unless the tenant is actually in auto_send", () => {
  // Without this, a bug upstream could dispatch without approval while the
  // tenant sits in approval_send — the mode they chose precisely to keep a human
  // in the loop.
  assert.match(notifications, /if \(auto && mode !== "auto_send"\)[\s\S]{0,160}MODE_BLOCKED/);
});

test("the audit trail separates automatic sends from approved ones", () => {
  assert.match(notifications, /auditAction = \(suffix\) => `restock_notification\.\$\{auto \? `auto_\$\{suffix\}` : suffix\}`/);
  for (const action of ["approved", "sent", "send_failed"]) {
    assert.match(notifications, new RegExp(`auditAction\\("${action}"\\)`), `${action} must route through auditAction`);
  }
  // The old hardcoded names would have logged an auto send as human-approved.
  assert.doesNotMatch(notifications, /action: "restock_notification\.(approved|sent|send_failed)"/);
});

test("recovery auto-sends only a freshly created draft, never a duplicate", () => {
  // A duplicate means this intent already has a notification for this restock
  // event; re-sending is the double-message the event dedup exists to prevent.
  assert.match(recovery, /messagingMode === "auto_send" && autoSend && d\?\.created && d\?\.notification\?\.id/);
  assert.match(recovery, /auto: true/);
});

test("the exact-variant gate still fences the auto path", () => {
  // Auto send sits INSIDE the existing explicit-intent + EXACT_VARIANT branch,
  // so legacy wishlist and product-only rows can never be messaged.
  const branch = recovery.slice(recovery.indexOf('cand.matchQuality === "EXACT_VARIANT"'));
  assert.ok(branch.indexOf('messagingMode === "auto_send"') > 0, "auto send must live inside the EXACT_VARIANT branch");
});

test("a failed auto send does not abort the rest of the recovery run", () => {
  assert.match(recovery, /notificationsAutoFailed \+= 1/);
  assert.match(recovery, /catch \(sendError\)/);
});

test("enabling auto_send asks for its own confirmation", () => {
  // Reusing the approval_send confirmation would describe the wrong risk.
  assert.match(studioUi, /mode === "auto_send" && !window\.confirm\(t\("aiStudio\.restock\.confirm\.enableAutoSend"\)\)/);
});

test("the console stops promising human approval once auto_send is on", () => {
  assert.match(studioUi, /messagingMode === "auto_send" \?[\s\S]{0,200}banner\.autoSendOn/);
  // The service header carried the same promise and had to be corrected too.
  assert.doesNotMatch(notifications, /There is NO autonomous customer messaging/);
});
