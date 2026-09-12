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
      ? "NOT FOUND — wrong path OR wrong method for this build"
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

  /*
   * Tier two: does the path exist, without using it?
   *
   * The endpoints below all SEND something, so they cannot be called for real against a live
   * customer number. They can still be proven, because Evolution validates the body before it
   * does anything: an empty body is refused by the DTO, and the status code says which kind of
   * refusal it was. 404 means the path is wrong for this build; 400/422 means the path is
   * there and only the (deliberately empty) payload was rejected — nothing was delivered.
   *
   * Deliberately NOT probed, because an empty body is not obviously harmless on them:
   *   /settings/set            — could apply a default settings object to the live instance
   *   /chat/updateProfileName|Status|Picture, /chat/updatePrivacySettings
   *                            — could overwrite the store's own profile with nothing
   *   /proxy/set               — could disable a proxy that is carrying the session
   *   /message/sendStatus      — a Status is a broadcast; not worth any chance of publishing
   *   /group/create|leaveGroup|updateParticipant
   *                            — group membership is real even when the payload is junk
   * Those stay unproven until the first real call, which is why each one is behind an
   * explicit operator action rather than automatic behaviour.
   */
  const shapeProbes = [
    { label: "send voice note", path: `/message/sendWhatsAppAudio/${instance}` },
    { label: "send poll", path: `/message/sendPoll/${instance}` },
    { label: "send location", path: `/message/sendLocation/${instance}` },
    { label: "send contact card", path: `/message/sendContact/${instance}` },
    { label: "send sticker", path: `/message/sendSticker/${instance}` },
    { label: "send video note", path: `/message/sendPtv/${instance}` },
    { label: "typing indicator", path: `/chat/sendPresence/${instance}` },
    { label: "read receipt", path: `/chat/markMessageAsRead/${instance}` },
    { label: "apply label", path: `/label/handleLabel/${instance}` },
    { label: "archive chat", path: `/chat/archiveChat/${instance}` },
    { label: "mark chat unread", path: `/chat/markChatUnread/${instance}` },
    { label: "block contact", path: `/message/updateBlockStatus/${instance}` },
    { label: "recall message", path: `/chat/deleteMessageForEveryone/${instance}`, method: "DELETE" },
    { label: "contact profile", path: `/chat/fetchProfile/${instance}` },
    { label: "business profile", path: `/chat/fetchBusinessProfile/${instance}` },
    // GET, and with no groupJid on purpose — probed with the verb it is actually called with,
    // because Express answers a known path called with the wrong method with a 404 too.
    { label: "group invite code", path: `/group/inviteCode/${instance}`, method: "GET" },
  ];

  console.log("\nPath-existence probes (empty body — refused by validation, nothing is sent):\n");
  const shapeResults = [];
  for (const entry of shapeProbes) {
    const method = entry.method || "POST";
    // fetch throws outright on a GET carrying a body, which reads as "gateway unreachable"
    // and hides whether the path is there at all. A GET probe goes out bare.
    const result = await probe({ ...entry, method, body: method === "GET" ? null : {} });
    // A 400 here is the GOOD answer: the route exists and refused an empty payload.
    const verdict = result.status === 404
      ? "NOT FOUND — wrong path OR wrong method for this build"
      : result.status === 400 || result.status === 422
        ? "EXISTS (empty body refused, as expected)"
        : result.status === 401 || result.status === 403
          ? "AUTH — the api key was refused"
          : result.status === 0
            ? result.verdict
            : `EXISTS but answered ${result.status} to an empty body — check it did nothing`;
    shapeResults.push({ ...result, verdict });
  }
  for (const result of shapeResults) {
    console.log(`${result.verdict.padEnd(52)} ${result.label}  [${result.status}] ${result.path}`);
  }

  const broken = [...results, ...shapeResults].filter((result) => result.status === 404);
  console.log("");
  if (broken.length) {
    console.log(`${broken.length} endpoint(s) are not on this build — fix the path in whatsappCapabilitiesService before enabling the feature that uses it:`);
    for (const result of broken) console.log(`  - ${result.label}: ${result.path}`);
    process.exitCode = 1;
    return;
  }
  console.log("Every probed endpoint exists on this build.");
  console.log("Unproven by design (they mutate the instance or broadcast): /settings/set, /chat/updateProfileStatus, /chat/updateProfilePicture, /chat/updatePrivacySettings, /proxy/set, /message/sendStatus, /group/create, /group/leaveGroup, /group/updateParticipant.");
};

run().catch((error) => {
  console.error("[whatsapp-capabilities-probe] failed", error);
  process.exitCode = 1;
});
