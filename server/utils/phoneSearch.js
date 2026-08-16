const ARABIC_DIGIT_MAP = {
  "٠": "0",
  "١": "1",
  "٢": "2",
  "٣": "3",
  "٤": "4",
  "٥": "5",
  "٦": "6",
  "٧": "7",
  "٨": "8",
  "٩": "9",
  "۰": "0",
  "۱": "1",
  "۲": "2",
  "۳": "3",
  "۴": "4",
  "۵": "5",
  "۶": "6",
  "۷": "7",
  "۸": "8",
  "۹": "9",
};

export const normalizePhone = (value = "") =>
  String(value || "")
    .trim()
    .replace(/[٠-٩۰-۹]/g, (digit) => ARABIC_DIGIT_MAP[digit] || digit)
    .replace(/[\s\-()]/g, "")
    .replace(/[^\d+]/g, "");

export const getPhoneSearchVariants = (value = "") => {
  const digits = normalizePhone(value).replace(/\D/g, "");
  if (!digits) return [];

  const variants = new Set([digits]);
  if (digits.startsWith("20") && digits.length > 2) {
    const local = digits.slice(2);
    variants.add(local);
    variants.add(`0${local}`);
  }
  if (digits.startsWith("0") && digits.length > 1) {
    const withoutZero = digits.slice(1);
    variants.add(withoutZero);
    variants.add(`20${withoutZero}`);
  }
  if (digits.startsWith("1")) {
    variants.add(`0${digits}`);
    variants.add(`20${digits}`);
  }

  return Array.from(variants).filter(Boolean);
};

export const phoneSqlDigits = (column) =>
  `regexp_replace(translate(COALESCE(${column}, ''), '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'), '\\D', '', 'g')`;

/**
 * One key per human, whatever they typed. `+201068005338`, `00201068005338`,
 * `01068005338` and `1068005338` are the same phone, so identity checks that
 * compare raw digits miss the duplicate and let the same customer be saved
 * again. The country code is only stripped off an Egyptian mobile shape, so a
 * foreign number that happens to start with 20 keeps its digits.
 */
export const canonicalPhoneKey = (value = "") => {
  let digits = normalizePhone(value).replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (/^201\d{9}$/.test(digits)) return digits.slice(2);
  if (/^01\d{9}$/.test(digits)) return digits.slice(1);
  return digits;
};

/** The SQL twin of canonicalPhoneKey — the two must stay in step. */
export const canonicalPhoneSql = (column) => {
  const digits = `regexp_replace(${phoneSqlDigits(column)}, '^00', '')`;
  return `CASE
    WHEN ${digits} ~ '^201[0-9]{9}$' THEN substr(${digits}, 3)
    WHEN ${digits} ~ '^01[0-9]{9}$' THEN substr(${digits}, 2)
    ELSE ${digits}
  END`;
};
