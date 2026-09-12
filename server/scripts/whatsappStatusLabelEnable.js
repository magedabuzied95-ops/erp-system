/**
 * Turns the order-status labels on or off.
 *
 * It exists because the only thing standing between "configured" and "working" is a boolean,
 * and the generic settings screen edits this json setting as text fields — which is how a
 * setting ends up holding the string "true" next to a feature that is off.
 *
 * It REFUSES to enable while mapped labels are missing from WhatsApp. Enabling in that state
 * does nothing at all and looks exactly like a bug: the setting says on, the chats stay bare.
 * `--force` is there for the case where that is genuinely what you want (labels being created
 * on the phone right now, say), and it says plainly what will be skipped.
 *
 *   docker exec erp-backend node server/scripts/whatsappStatusLabelEnable.js on
 *   docker exec erp-backend node server/scripts/whatsappStatusLabelEnable.js off
 *   docker exec erp-backend node server/scripts/whatsappStatusLabelEnable.js on --force
 */
import { setSetting } from "../services/settingsService.js";
import { listWhatsappLabels } from "../services/whatsappCapabilitiesService.js";
import { loadStatusLabelConfig, normalizeStatusLabelConfig } from "../services/whatsappOrderLabelService.js";

const text = (value = "") => String(value ?? "").trim();
const key = (value = "") => text(value).toLowerCase().replace(/\s+/g, " ");

const run = async () => {
  const args = process.argv.slice(2).map((value) => text(value).toLowerCase());
  const force = args.includes("--force");
  const verb = args.find((value) => ["on", "off", "true", "false", "enable", "disable"].includes(value));
  if (!verb) {
    console.error("Say which: `on` or `off`.");
    process.exitCode = 1;
    return;
  }
  const enabling = ["on", "true", "enable"].includes(verb);

  const config = await loadStatusLabelConfig();

  if (enabling) {
    let missing = [];
    try {
      const { labels } = await listWhatsappLabels({});
      const byName = new Set(labels.map((label) => key(label.name)));
      missing = [...new Set(
        Object.values(config.labels).map((name) => text(name)).filter((name) => name && !byName.has(key(name)))
      )];
    } catch (error) {
      console.error(`Could not read the labels from WhatsApp to check first: ${error?.message || error}`);
      if (!force) {
        console.error("Not enabling blind. Re-run with --force if you want it on anyway.");
        process.exitCode = 1;
        return;
      }
    }
    if (missing.length && !force) {
      console.error(`${missing.length} mapped label(s) do not exist in WhatsApp yet:`);
      for (const name of missing) console.error(`  - ${name}`);
      console.error("\nEnabling now would change nothing: those statuses are skipped. Create the labels in");
      console.error("WhatsApp Business first (server/scripts/whatsappStatusLabelCheck.js lists them), or re-run");
      console.error("with --force to enable anyway.");
      process.exitCode = 1;
      return;
    }
    if (missing.length) {
      console.warn(`Enabling with ${missing.length} label(s) still missing — those statuses will be skipped:`);
      for (const name of missing) console.warn(`  - ${name}`);
    }
  }

  const next = normalizeStatusLabelConfig({ ...config, enabled: enabling });
  await setSetting("whatsapp.status_labels", next, "ai_channels", null);
  console.log(`Order status labels are now ${next.enabled ? "ENABLED" : "disabled"}${next.exclusive ? " (exclusive)" : ""}.`);
  if (next.enabled) {
    console.log("The next order status change will write its label onto that customer's chat.");
    console.log("Labels outside this mapping are never touched — an existing 'AI handoff' or 'New customer' stays put.");
  }
};

run().catch((error) => {
  console.error("[whatsapp-status-label-enable] failed", error);
  process.exitCode = 1;
});
