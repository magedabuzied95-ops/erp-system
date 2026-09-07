/*
 * Read-only inspection of a WhatsApp Business Account and one of its phone numbers.
 *
 * Every call here is a GET. Nothing registers, deregisters, migrates or writes — the number's
 * standing on the WhatsApp Business app cannot change as a side effect of running this.
 *
 * WHY IT EXISTS SEPARATELY FROM THE CONNECT FLOW
 * ----------------------------------------------
 * Meta refuses these nodes to an app access token: the WABA answers 190 (Authentication Error)
 * and the phone number answers 102, "A user access token is required to request this resource."
 * So this needs a USER or SYSTEM-USER token carrying whatsapp_business_management, which arrives
 * either from Embedded Signup or from a System User created in Business Settings. This script
 * finds one, in that order, and says plainly which it used — never the token itself.
 *
 * FIELD SUPPORT
 * -------------
 * Graph rejects an entire request when one field in it is unknown to the version in use, which
 * makes "what does this version actually support" impossible to read off a failure. So a rejected
 * batch is re-probed one field at a time and the script reports supported and unsupported
 * separately, rather than silently returning less than was asked for.
 *
 * Usage:  docker exec erp-backend node server/scripts/probeWhatsappCloudAssets.js <waba_id> [phone_number_id]
 */

import db from "../database/db.js";
import {
  findIntegrationByWabaId,
  integrationAccessToken,
} from "../services/whatsappEmbeddedSignupService.js";

const GRAPH_HOST = "https://graph.facebook.com";
const GRAPH_VERSION = String(process.env.META_GRAPH_VERSION || "v20.0").trim();

const WABA_FIELDS = [
  "id",
  "name",
  "currency",
  "timezone_id",
  "account_review_status",
  "business_verification_status",
  "owner_business_info",
  "message_template_namespace",
  "primary_funding_id",
  "purchase_order_number",
  "health_status",
];

const PHONE_FIELDS = [
  "id",
  "display_phone_number",
  "verified_name",
  "status",
  "quality_rating",
  "platform_type",
  "code_verification_status",
  "throughput",
  "name_status",
  "new_name_status",
  "certificate",
  "is_official_business_account",
  "is_pin_enabled",
  "account_mode",
  "messaging_limit_tier",
  "search_visibility",
  "health_status",
  "last_onboarded_time",
];

const graph = async ({ path, token }) => {
  const url = `${GRAPH_HOST}/${GRAPH_VERSION}${path}${path.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(token)}`;
  const response = await fetch(url);
  const body = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, body, error: body?.error || null };
};

/*
 * Ask for everything; if Graph refuses the batch, find out which individual fields it will serve.
 * Reported rather than quietly dropped: "unsupported on this version" is itself an answer.
 */
const readWithFieldFallback = async ({ node, fields, token }) => {
  const all = await graph({ path: `/${node}?fields=${encodeURIComponent(fields.join(","))}`, token });
  if (all.ok) return { values: all.body, supported: fields, unsupported: [], probed: false };

  /*
   * Only a TOKEN-level failure justifies giving up on the batch: 190 is a bad token and 102 is
   * the wrong kind of token, and neither changes per field.
   *
   * 10 and 200 deliberately do NOT short-circuit, and this was learned the hard way on the real
   * account: reading the WABA node with every field returned code 10 ("requires that the Business
   * that owns this App is a Business Solution Provider"), which reads like the whole node is
   * closed — but 13 of the 14 fields were readable one at a time and only primary_funding_id
   * actually needed BSP. Treating that as a node-level refusal hid every field behind one of them.
   */
  const code = Number(all.error?.code ?? 0);
  if (code === 190 || code === 102) {
    return { values: null, supported: [], unsupported: [], probed: false, error: all.error, status: all.status };
  }

  const supported = [];
  const unsupported = [];
  const values = {};
  for (const field of fields) {
    const one = await graph({ path: `/${node}?fields=${encodeURIComponent(field)}`, token });
    if (one.ok) {
      supported.push(field);
      Object.assign(values, one.body);
    } else {
      unsupported.push({ field, code: one.error?.code ?? null, message: String(one.error?.message || "").slice(0, 140) });
    }
  }
  return { values: supported.length ? values : null, supported, unsupported, probed: true, error: supported.length ? null : all.error, status: all.status };
};

const resolveToken = async (wabaId) => {
  const stored = await findIntegrationByWabaId(wabaId).catch(() => null);
  const fromStore = stored ? integrationAccessToken(stored) : "";
  if (fromStore) return { token: fromStore, source: "stored_embedded_signup_integration" };
  const fromEnv = String(
    process.env.WHATSAPP_ACCESS_TOKEN ||
      process.env.WHATSAPP_CLOUD_ACCESS_TOKEN ||
      process.env.META_WHATSAPP_ACCESS_TOKEN ||
      ""
  ).trim();
  if (fromEnv) return { token: fromEnv, source: "env_system_user_token" };
  return { token: "", source: "" };
};

const main = async () => {
  const wabaId = String(process.argv[2] || "").trim();
  const phoneNumberId = String(process.argv[3] || "").trim();
  if (!wabaId) {
    console.error("usage: node server/scripts/probeWhatsappCloudAssets.js <waba_id> [phone_number_id]");
    process.exitCode = 2;
    return;
  }

  const { token, source } = await resolveToken(wabaId);
  console.log(`graph_version: ${GRAPH_VERSION}`);
  console.log(`token_source : ${source || "NONE"}`);
  if (!token) {
    console.error(
      "\nNo WhatsApp-scoped token is available.\n" +
      "Meta refuses these nodes to an app access token (WABA -> 190, phone number -> 102).\n" +
      "Provide one of:\n" +
      "  * run Embedded Signup from the integrations page, or\n" +
      "  * set WHATSAPP_ACCESS_TOKEN to a System User token that has whatsapp_business_management\n" +
      "    and whatsapp_business_messaging, with this WABA assigned to it."
    );
    process.exitCode = 1;
    return;
  }

  const waba = await readWithFieldFallback({ node: wabaId, fields: WABA_FIELDS, token });
  console.log(`\n=== WABA ${wabaId} ===`);
  if (waba.values) console.log(JSON.stringify(waba.values, null, 2));
  else console.log(`unreadable: HTTP ${waba.status} code=${waba.error?.code ?? "-"} ${waba.error?.message || ""}`);
  if (waba.probed) {
    console.log(`supported fields  : ${waba.supported.join(", ") || "(none)"}`);
    console.log(`unsupported fields: ${waba.unsupported.map((entry) => entry.field).join(", ") || "(none)"}`);
  }

  const numbers = await graph({
    path: `/${wabaId}/phone_numbers?fields=${encodeURIComponent(PHONE_FIELDS.filter((field) => field !== "health_status").join(","))}`,
    token,
  });
  console.log(`\n=== ${wabaId}/phone_numbers ===`);
  console.log(numbers.ok ? JSON.stringify(numbers.body, null, 2) : `unreadable: HTTP ${numbers.status} code=${numbers.error?.code ?? "-"} ${numbers.error?.message || ""}`);

  if (phoneNumberId) {
    const phone = await readWithFieldFallback({ node: phoneNumberId, fields: PHONE_FIELDS, token });
    console.log(`\n=== phone number ${phoneNumberId} ===`);
    if (phone.values) console.log(JSON.stringify(phone.values, null, 2));
    else console.log(`unreadable: HTTP ${phone.status} code=${phone.error?.code ?? "-"} ${phone.error?.message || ""}`);
    if (phone.probed) {
      console.log(`supported fields  : ${phone.supported.join(", ") || "(none)"}`);
      console.log(`unsupported fields: ${phone.unsupported.map((entry) => entry.field).join(", ") || "(none)"}`);
    }

    /*
     * The one line the operator actually wants: is this number still on the phone, or has it moved
     * onto the platform only. platform_type is Meta's own answer; anything we do not recognise is
     * reported verbatim rather than guessed at.
     */
    const platformType = String(phone.values?.platform_type || "").toUpperCase();
    const coexistence = platformType === "CLOUD_API"
      ? "cloud_api_only"
      : platformType === "SMB_APP" || platformType === "BUSINESS_APP"
        ? "business_app_coexistence"
        : platformType === "ON_PREMISE"
          ? "on_premise"
          : platformType
            ? `unrecognised:${platformType.toLowerCase()}`
            : "unknown";
    console.log(`\ncoexistence: ${coexistence} (platform_type=${platformType || "-"})`);
  }
};

main()
  .catch((error) => {
    console.error("probe failed:", error?.message || String(error));
    process.exitCode = 1;
  })
  .finally(() => db.end?.().catch(() => {}));
