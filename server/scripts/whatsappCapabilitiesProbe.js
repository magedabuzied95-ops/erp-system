/**
 * Does this Evolution build actually expose the endpoints the capabilities service calls?
 *
 * Every path in `whatsappCapabilitiesService` is written against the Evolution v2 API. A
 * path that moved between builds fails the same way a broken feature does — one rejected
 * call, buried in a log — so this asks the live gateway directly, before anything is turned
 * on for customers.
 *
 * It is READ-ONLY by construction. Nothing here sends a message, changes a setting, joins a
 * group or touches a customer's chat: the probes are the GET endpoints plus one number
 * lookup, which is a query and not a send. A 404 means the path is wrong for this build; a
 * 401/403 means the key is wrong; anything else means the path exists.
 *
 * Run it on the box that holds the credentials:
 *   node server/scripts/whatsappCapabilitiesProbe.js
 */
import "dotenv/config";

const text = (value = "") => String(value ?? "").trim();

const apiUrl = () => text(process.env.EVOLUTION_API_URL).replace(/\/+$/g, "");
const apiKey = () => text(process.env.EVOLUTION_API_KEY);
const instanceName = () =>
  text(process.env.WHATSAPP_INSTANCE_NAME) || text(process.env.EVOLUTION_INSTANCE_NAME) || "m1-store";

const probe = async ({ label, path, method = "GET", body = null }) => {
  const url = `${apiUrl()}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, {
      method,
      signal: controller.signal,
      headers: { apikey: apiKey(), "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const raw = await response.text();
    let parsed = null;
    try {
      parsed = raw ? JSON.parse(raw) : null;
    } catch {
      parsed = raw;
    }
    const verdict = response.status === 404
      ? "PATH NOT FOUND — the service calls a path this build does not have"
      : response.status === 401 || response.status === 403
        ? "AUTH — the api key was refused"
        : response.ok
          ? "OK"
          : `EXISTS but refused (${response.status})`;
    return { label, path, status: response.status, verdict, sample: typeof parsed === "string" ? parsed.slice(0, 200) : parsed };
  } catch (error) {
    return { label, path, status: 0, verdict: `UNREACHABLE — ${error?.message || error}`, sample: null };
  } finally {
    clearTimeout(timer);
  }
};

const run = async () => {
  if (!apiUrl() || !apiKey()) {
    console.error("EVOLUTION_API_URL and EVOLUTION_API_KEY must be set to probe the gateway.");
    process.exitCode = 1;
    return;
  }
  const instance = encodeURIComponent(instanceName());
  console.log(`Probing ${apiUrl()} / instance "${instanceName()}"\n`);

  const probes = [
    { label: "instance settings", path: `/settings/find/${instance}` },
    { label: "labels", path: `/label/findLabels/${instance}` },
    { label: "groups", path: `/group/fetchAllGroups/${instance}?getParticipants=false` },
    { label: "privacy settings", path: `/chat/fetchPrivacySettings/${instance}` },
    // A lookup, not a send: it asks whether a number is registered and delivers nothing.
    // The store's own instance number is used so no customer is touched even indirectly.
    {
      label: "number check",
      path: `/chat/whatsappNumbers/${instance}`,
      method: "POST",
      body: { numbers: [text(process.env.WHATSAPP_PROBE_NUMBER) || "201000000000"] },
    },
  ];

  const results = [];
  for (const entry of probes) {
    // Sequential on purpose: Evolution is one Baileys process and a burst of probes is a
    // worse first impression than five calls in a row.
    results.push(await probe(entry));
  }

  for (const result of results) {
    console.log(`${result.verdict.padEnd(52)} ${result.label}  [${result.status}] ${result.path}`);
  }

  const broken = results.filter((result) => result.status === 404);
  console.log("");
  if (broken.length) {
    console.log(`${broken.length} endpoint(s) are not on this build — fix the path in whatsappCapabilitiesService before enabling the feature that uses it:`);
    for (const result of broken) console.log(`  - ${result.label}: ${result.path}`);
    process.exitCode = 1;
    return;
  }
  console.log("Every probed endpoint exists on this build.");
};

run().catch((error) => {
  console.error("[whatsapp-capabilities-probe] failed", error);
  process.exitCode = 1;
});
