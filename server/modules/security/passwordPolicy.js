// Staff password policy (Amazon SP-API security requirements):
// at least 12 characters with upper, lower, digit and special character; rotated every 365 days.
// Pure functions only - callers decide what to do with the verdict.

export const PASSWORD_MIN_LENGTH = 12;
// bcrypt silently ignores everything after 72 bytes, so a longer password would give a false
// sense of strength.
export const PASSWORD_MAX_BYTES = 72;
export const DEFAULT_PASSWORD_MAX_AGE_DAYS = 365;
// Accounts whose password predates the policy have no password_changed_at. Their 365-day clock
// starts on the day the policy shipped instead of being treated as already expired.
export const PASSWORD_POLICY_EPOCH = new Date("2026-09-16T00:00:00+03:00");

const DAY_MS = 24 * 60 * 60 * 1000;

export const PASSWORD_POLICY_MESSAGES = Object.freeze({
  too_short: `كلمة المرور لازم تكون ${PASSWORD_MIN_LENGTH} حرف على الأقل`,
  too_long: "كلمة المرور طويلة جداً (الحد الأقصى 72 بايت)",
  missing_upper: "كلمة المرور لازم تحتوي على حرف إنجليزي كبير (A-Z)",
  missing_lower: "كلمة المرور لازم تحتوي على حرف إنجليزي صغير (a-z)",
  missing_digit: "كلمة المرور لازم تحتوي على رقم",
  missing_special: "كلمة المرور لازم تحتوي على رمز خاص مثل ! @ # $ %",
  contains_identity: "كلمة المرور لا يجب أن تحتوي على البريد الإلكتروني أو الاسم",
  whitespace_edges: "كلمة المرور لا يجب أن تبدأ أو تنتهي بمسافة",
});

export const validateStaffPassword = (password, { email = "", name = "" } = {}) => {
  const value = typeof password === "string" ? password : String(password ?? "");
  const errors = [];
  if ([...value].length < PASSWORD_MIN_LENGTH) errors.push("too_short");
  if (Buffer.byteLength(value, "utf8") > PASSWORD_MAX_BYTES) errors.push("too_long");
  if (!/[A-Z]/.test(value)) errors.push("missing_upper");
  if (!/[a-z]/.test(value)) errors.push("missing_lower");
  if (!/[0-9]/.test(value)) errors.push("missing_digit");
  if (!/[^A-Za-z0-9\s]/.test(value)) errors.push("missing_special");
  if (value !== value.trim()) errors.push("whitespace_edges");

  const lowered = value.toLowerCase();
  const localPart = String(email || "").split("@")[0].trim().toLowerCase();
  const nameParts = String(name || "").toLowerCase().split(/\s+/).filter((part) => part.length >= 4);
  if ((localPart.length >= 4 && lowered.includes(localPart)) || nameParts.some((part) => lowered.includes(part))) {
    errors.push("contains_identity");
  }

  return {
    valid: errors.length === 0,
    errors,
    messages: errors.map((code) => PASSWORD_POLICY_MESSAGES[code]),
  };
};

export const passwordPolicyErrorResponse = (verdict) => ({
  success: false,
  code: "PASSWORD_POLICY",
  message: verdict.messages.join(" • "),
  errors: verdict.errors,
});

export const passwordExpiresAt = (passwordChangedAt, maxAgeDays = DEFAULT_PASSWORD_MAX_AGE_DAYS) => {
  const changed = passwordChangedAt ? new Date(passwordChangedAt) : null;
  const base = changed && !Number.isNaN(changed.getTime()) ? changed : PASSWORD_POLICY_EPOCH;
  const days = Number(maxAgeDays) > 0 ? Number(maxAgeDays) : DEFAULT_PASSWORD_MAX_AGE_DAYS;
  return new Date(base.getTime() + days * DAY_MS);
};

// Everything the login needs to decide whether the password must be replaced now.
export const assessPasswordStatus = ({ user = {}, plainPassword, maxAgeDays, now = new Date() } = {}) => {
  const expiresAt = passwordExpiresAt(user.password_changed_at, maxAgeDays);
  const expired = now.getTime() >= expiresAt.getTime();
  const compliant = plainPassword === undefined
    ? true
    : validateStaffPassword(plainPassword, { email: user.email, name: user.name }).valid;
  const mustChange = user.must_change_password === true;
  const reasons = [];
  if (expired) reasons.push("expired");
  if (!compliant) reasons.push("weak");
  if (mustChange) reasons.push("reset_by_admin");
  return {
    expires_at: expiresAt.toISOString(),
    days_left: Math.ceil((expiresAt.getTime() - now.getTime()) / DAY_MS),
    expired,
    compliant,
    must_change: mustChange,
    change_required: reasons.length > 0,
    reasons,
  };
};
