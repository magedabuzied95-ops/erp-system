const text = (value = "") => String(value ?? "").trim();

const toLatinDigits = (value = "") =>
  text(value)
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)));

export const normalizeMetaText = (value = "") =>
  text(value).replace(/\s+/g, " ").toLowerCase();

export const normalizeMetaEmail = (value = "") => {
  const normalized = normalizeMetaText(value);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : "";
};

export const normalizeMetaEgyptPhone = (value = "") => {
  let digits = toLatinDigits(value).replace(/\D/g, "");
  if (digits.startsWith("0020")) digits = digits.slice(2);
  if (digits.startsWith("0") && digits.length === 11) digits = `20${digits.slice(1)}`;
  else if (/^1[0125]\d{8}$/.test(digits)) digits = `20${digits}`;
  return /^201[0125]\d{8}$/.test(digits) ? digits : "";
};

export const splitMetaName = (customer = {}) => {
  const firstName = normalizeMetaText(customer.first_name ?? customer.firstName);
  const lastName = normalizeMetaText(customer.last_name ?? customer.lastName);
  if (firstName || lastName) return { firstName, lastName };
  const parts = normalizeMetaText(customer.full_name ?? customer.name ?? customer.customer_name)
    .split(/\s+/)
    .filter(Boolean);
  return { firstName: parts[0] || "", lastName: parts.slice(1).join(" ") };
};

export const normalizeMetaCustomer = (customer = {}) => {
  const { firstName, lastName } = splitMetaName(customer);
  const email = normalizeMetaEmail(customer.email ?? customer.customer_email);
  const phone = normalizeMetaEgyptPhone(customer.phone ?? customer.primary_phone ?? customer.customer_phone);
  const city = normalizeMetaText(
    customer.city ?? customer.city_name ?? customer.city_area ?? customer.area ?? customer.district
  );
  const state = normalizeMetaText(
    customer.state ?? customer.governorate ?? customer.governorate_name ?? customer.province
  );
  const externalId = text(customer.external_id ?? customer.customer_id ?? customer.id);
  const hasCustomerData = Boolean(email || phone || firstName || lastName || city || state || externalId);
  return {
    ...(email ? { email } : {}),
    ...(phone ? { phone } : {}),
    ...(firstName ? { firstName } : {}),
    ...(lastName ? { lastName } : {}),
    ...(city ? { city } : {}),
    ...(state ? { state } : {}),
    ...(hasCustomerData ? { country: "eg" } : {}),
    ...(externalId ? { externalId } : {}),
  };
};

export const buildMetaAdvancedMatching = (customer = {}) => {
  const normalized = normalizeMetaCustomer(customer);
  return {
    ...(normalized.email ? { em: normalized.email } : {}),
    ...(normalized.phone ? { ph: normalized.phone } : {}),
    ...(normalized.firstName ? { fn: normalized.firstName } : {}),
    ...(normalized.lastName ? { ln: normalized.lastName } : {}),
    ...(normalized.city ? { ct: normalized.city } : {}),
    ...(normalized.state ? { st: normalized.state } : {}),
    ...(normalized.country ? { country: normalized.country } : {}),
    ...(normalized.externalId ? { external_id: normalized.externalId } : {}),
  };
};
