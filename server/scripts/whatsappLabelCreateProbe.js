/**
 * Can a label be CREATED over the API, or is the phone really the only way?
 *
 * Evolution documents two label routes — `findLabels` (read) and `handleLabel` (put an
 * EXISTING label on a chat). Baileys underneath it can create one, so the question is only
 * whether this build exposes that. It matters a lot: creating eight labels by hand on a phone
 * is the single step standing between a finished feature and a working one.
 *
 * Every candidate is probed with a body that validation must reject, so a route that exists
 * answers 400 and creates nothing. 404 means the route is not on this build. The one thing
 * this must never do is actually create a junk label, which is why no candidate is ever sent
 * a name.
 *
 *   docker exec erp-backend node server/scripts/whatsappLabelCreateProbe.js
 */
const text = (value = "") => String(value ?? "").trim();

const apiUrl = () => text(process.env.EVOLUTION_API_URL).replace(/\/+$/g, "");
const apiKey = () => text(process.env.EVOLUTION_API_KEY);
const instanceName = () =>
  text(process.env.WHATSAPP_INSTANCE_NAME) || text(process.env.EVOLUTION_INSTANCE_NAME) || "m1-store";

const probe = async ({ label, path, method = "POST" }) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`${apiUrl()}${path}`, {
      method,
      signal: controller.signal,
      headers: { apikey: apiKey(), "Content-Type": "application/json" },
      // Deliberately empty: a create route needs a name, so this is refused rather than obeyed.
      body: JSON.stringify({}),
    });
    const raw = await response.text();
    return { label, path, method, status: response.status, body: raw.slice(0, 220) };
  } catch (error) {
    return { label, path, method, status: 0, body: error?.message || String(error) };
  } finally {
    clearTimeout(timer);
  }
};

const run = async () => {
  if (!apiUrl() || !apiKey()) {
    console.error("EVOLUTION_API_URL and EVOLUTION_API_KEY must be set.");
    process.exitCode = 1;
    return;
  }
  const instance = encodeURIComponent(instanceName());
  console.log(`Probing label-creation routes on ${apiUrl()} / "${instanceName()}"\n`);

  const candidates = [
    { label: "label/create", path: `/label/create/${instance}` },
    { label: "label/addLabel", path: `/label/addLabel/${instance}` },
    { label: "label/createLabel", path: `/label/createLabel/${instance}` },
    { label: "chat/addLabel", path: `/chat/addLabel/${instance}` },
    { label: "label/handleLabel (known)", path: `/label/handleLabel/${instance}` },
  ];

  const results = [];
  for (const candidate of candidates) results.push(await probe(candidate));

  for (const result of results) {
    const verdict = result.status === 404
      ? "not on this build"
      : result.status === 400 || result.status === 422
        ? "EXISTS (empty body refused)"
        : result.status === 0
          ? `unreachable — ${result.body}`
          : `answered ${result.status}`;
    console.log(`${verdict.padEnd(30)} ${result.label.padEnd(26)} [${result.status}] ${result.path}`);
    if (result.status && result.status !== 404) console.log(`${" ".repeat(30)} ${result.body}`);
  }

  const creatable = results.filter(
    (result) => !result.label.includes("known") && (result.status === 400 || result.status === 422)
  );
  console.log("");
  if (creatable.length) {
    console.log("A label-creation route EXISTS on this build:");
    for (const result of creatable) console.log(`  - ${result.path}`);
    console.log("The labels can be created from here instead of by hand on the phone.");
    return;
  }
  console.log("No label-creation route on this build — WhatsApp labels can only be created on the phone.");
  console.log("findLabels reads them and handleLabel puts an existing one on a chat; neither makes a new one.");
};

run().catch((error) => {
  console.error("[whatsapp-label-create-probe] failed", error);
  process.exitCode = 1;
});
