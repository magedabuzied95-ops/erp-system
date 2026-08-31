import db from "../../database/db.js";
import { ensureWhatsappQueueSchema } from "./schema.js";
import { renderWhatsappTemplate } from "../../../shared/whatsappQueueDefaults.js";

/*
 * Message variants, chosen round robin.
 *
 * The point is to stop the shop sounding like a machine: with three thank-you texts configured,
 * customer 1 gets A, customer 2 gets B, customer 3 gets C, customer 4 gets A again. It is not a
 * way past anyone's protections — the pacing and the expiry are what keep the account safe. This
 * just keeps a human-facing message from being byte-identical a thousand times over.
 *
 * The position lives in the database, not in a module variable: a restart mid-rotation would
 * otherwise send every customer back to variant A.
 */

export const pickVariant = (variants = [], position = 0) => {
  const enabled = (Array.isArray(variants) ? variants : []).filter((variant) => variant?.enabled !== false && String(variant?.body || "").trim());
  if (!enabled.length) return null;
  const index = ((Number(position) || 0) % enabled.length + enabled.length) % enabled.length;
  return enabled[index];
};

/*
 * Take the next rotation slot for this automation type.
 *
 * One statement, so two concurrent sales cannot both read position 0 and both send variant A.
 * The UPDATE returns the value it just wrote, and the caller uses `position - 1` — the slot it
 * claimed — rather than the new value.
 */
export const nextRotationPosition = async ({ tenantId = 0, automationType = "", client = db } = {}) => {
  const safeTenantId = Number(tenantId) || 0;
  const type = String(automationType || "").trim();
  if (!type) return 0;
  const result = await client.query(
    `
    INSERT INTO whatsapp_variant_rotation (tenant_id, automation_type, position, updated_at)
    VALUES ($1, $2, 1, NOW())
    ON CONFLICT (tenant_id, automation_type) DO UPDATE
      SET position = whatsapp_variant_rotation.position + 1,
          updated_at = NOW()
    RETURNING position
    `,
    [safeTenantId, type]
  );
  return Math.max(0, Number(result.rows[0]?.position || 1) - 1);
};

/*
 * Resolve the body this queue item will carry, once and for good.
 *
 * With no variants configured for the type, `fallbackBody` is returned untouched — which is how
 * turning the queue on leaves every existing message byte-for-byte as it is today.
 */
export const resolveMessageBody = async ({
  tenantId = 0,
  automationType = "",
  variants = {},
  values = {},
  fallbackBody = "",
  client = db,
} = {}) => {
  const list = Array.isArray(variants?.[automationType]) ? variants[automationType] : [];
  const usable = list.filter((variant) => variant?.enabled !== false && String(variant?.body || "").trim());
  if (!usable.length) return { variantId: null, body: String(fallbackBody ?? ""), rotationPosition: null };

  await ensureWhatsappQueueSchema();
  const position = await nextRotationPosition({ tenantId, automationType, client });
  const variant = pickVariant(usable, position);
  if (!variant) return { variantId: null, body: String(fallbackBody ?? ""), rotationPosition: position };

  const body = renderWhatsappTemplate(variant.body, values);
  // A variant that renders to nothing — every line dropped for a missing value — must not be
  // sent as an empty message. The automation's own text is the safety net.
  if (!body.trim()) return { variantId: null, body: String(fallbackBody ?? ""), rotationPosition: position };
  return { variantId: variant.id, body, rotationPosition: position };
};
