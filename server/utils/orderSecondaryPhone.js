import { normalizePhone } from "./phoneSearch.js";

/* An optional second number the courier can call when the first one does not answer.

   One nullable column on orders. It is added at boot (bootstrapStartup), not in a runtime ensure:
   several of the orders ensures are switched off in production, and a column added only there
   exists in development and never in production. ADD COLUMN IF NOT EXISTS with no default is a
   metadata-only change — no rewrite, no backfill, nothing that can take the boot down. */
export const ORDER_SECONDARY_PHONE_COLUMN = "customer_secondary_phone";

let secondaryPhoneColumnPromise = null;
export const ensureOrderSecondaryPhoneColumn = async (clientOrPool) => {
  if (!secondaryPhoneColumnPromise) {
    secondaryPhoneColumnPromise = clientOrPool
      .query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS ${ORDER_SECONDARY_PHONE_COLUMN} VARCHAR(80) NULL`)
      .catch((error) => {
        secondaryPhoneColumnPromise = null;
        throw error;
      });
  }
  return secondaryPhoneColumnPromise;
};

const EGYPT_MOBILE = /^01[0125][0-9]{8}$/;

// +201…, 00201…, 201… and 01… are the same Egyptian mobile; the order keeps the local form.
export const toLocalEgyptMobile = (value = "") => {
  let digits = normalizePhone(value).replace(/\D/g, "");
  if (digits.startsWith("0020")) digits = digits.slice(4);
  else if (digits.startsWith("20") && digits.length === 12) digits = digits.slice(2);
  if (digits.length === 10 && digits.startsWith("1")) digits = `0${digits}`;
  return digits;
};

/**
 * The second number as the order should store it.
 *
 * Empty stays empty. A number equal to the first one is dropped — Bosta would just ring the same
 * phone twice. Anything that is not an Egyptian mobile comes back as an error so the caller can
 * say so instead of silently losing what the customer typed.
 */
export const parseOrderSecondaryPhone = (value = "", primaryPhone = "") => {
  const raw = String(value ?? "").trim();
  if (!raw) return { value: "", error: "" };
  const local = toLocalEgyptMobile(raw);
  if (!EGYPT_MOBILE.test(local)) return { value: "", error: "invalid_secondary_phone" };
  if (local === toLocalEgyptMobile(primaryPhone)) return { value: "", error: "" };
  return { value: local, error: "" };
};
