// Columns that must never leave the server or ride along on req.user.
// A `SELECT u.*` / `RETURNING *` on users used to send the bcrypt hash to the browser.
const SENSITIVE_USER_FIELDS = Object.freeze([
  "password",
  "password_hash",
  "hashed_password",
  "password_digest",
  "mfa_secret",
  "mfa_secret_encrypted",
  "mfa_pending_secret_encrypted",
  "mfa_recovery_codes",
  "mfa_recovery_codes_hash",
]);

const stripSensitiveUserFields = (user) => {
  if (!user || typeof user !== "object") return user;
  const safe = { ...user };
  for (const field of SENSITIVE_USER_FIELDS) delete safe[field];
  return safe;
};

export { SENSITIVE_USER_FIELDS, stripSensitiveUserFields };
