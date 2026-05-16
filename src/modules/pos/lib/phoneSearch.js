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

export const matchesPhoneSearch = (value, search) => {
  const valueVariants = getPhoneSearchVariants(value);
  const searchVariants = getPhoneSearchVariants(search);
  if (valueVariants.length === 0 || searchVariants.length === 0) return false;

  return searchVariants.some((query) =>
    valueVariants.some((candidate) => candidate.includes(query) || query.includes(candidate))
  );
};
