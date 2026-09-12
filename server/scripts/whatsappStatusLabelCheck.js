/**
 * Can the status labels actually work?
 *
 * The mapping is by label NAME, which makes it configurable by a human but also makes it
 * silently inert: a name that was never created in WhatsApp Business is saved, enabled, and
 * does nothing. From outside there is no difference between "labels are off" and "labels are
 * on and every name is wrong".
 *
 * This answers it, read-only. It lists the labels that exist on the account, the names the
 * setting is asking for, and the gap between them — then says exactly what to create.
 *
 * Nothing is sent, nothing is labelled, nothing is written. Run it in the container that holds
 * the credentials:
 *   docker exec erp-backend node server/scripts/whatsappStatusLabelCheck.js
 */
import { listWhatsappLabels } from "../services/whatsappCapabilitiesService.js";
import { loadStatusLabelConfig } from "../services/whatsappOrderLabelService.js";

const text = (value = "") => String(value ?? "").trim();
const key = (value = "") => text(value).toLowerCase().replace(/\s+/g, " ");

const run = async () => {
  let config;
  try {
    config = await loadStatusLabelConfig();
  } catch (error) {
    console.error(`Could not read the whatsapp.status_labels setting: ${error?.message || error}`);
    process.exitCode = 1;
    return;
  }

  console.log(`Status labels: ${config.enabled ? "ENABLED" : "disabled"}${config.exclusive ? " (exclusive)" : ""}\n`);

  let available;
  try {
    ({ labels: available } = await listWhatsappLabels({}));
  } catch (error) {
    console.error(`Could not read the labels from WhatsApp: ${error?.message || error}`);
    process.exitCode = 1;
    return;
  }

  console.log(`Labels that exist in WhatsApp Business (${available.length}):`);
  if (!available.length) console.log("  (none — this account has no labels at all yet)");
  for (const label of available) console.log(`  - ${label.name}`);

  const byName = new Map(available.map((label) => [key(label.name), label]));
  const wanted = Object.entries(config.labels).filter(([, name]) => text(name));

  console.log(`\nWhat each order status is asking for (${wanted.length} mapped, ${Object.keys(config.labels).length - wanted.length} deliberately unlabelled):`);
  const missing = new Set();
  for (const [status, name] of wanted) {
    const match = byName.get(key(name));
    if (!match) missing.add(text(name));
    console.log(`  ${match ? "OK     " : "MISSING"}  ${status.padEnd(22)} -> ${name}`);
  }

  console.log("");
  if (!missing.size) {
    console.log(config.enabled
      ? "Every mapped label exists. Nothing to do — the next status change will land on the chat."
      : "Every mapped label exists. Turn the setting on to start using them.");
    return;
  }
  console.log(`${missing.size} label(s) are mapped but do not exist in WhatsApp. Create them in WhatsApp Business, spelled exactly like this:`);
  for (const name of missing) console.log(`  - ${name}`);
  console.log("\nUntil they exist, those statuses are skipped and no other behaviour changes.");
  // Deliberately not a failure exit: a label that has not been created yet is a setup step,
  // not a broken deployment, and this script is safe to leave in a health check.
};

run().catch((error) => {
  console.error("[whatsapp-status-label-check] failed", error);
  process.exitCode = 1;
});
