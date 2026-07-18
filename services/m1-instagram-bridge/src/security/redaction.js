const secretKey = /cookie|token|password|authorization|local.?storage|session.?id|secret/i;
const piiKey = /customer|username|display.?name|message|text|content/i;

export function redact(value, key = '') {
  if (secretKey.test(key)) return '[REDACTED]';
  if (piiKey.test(key) && typeof value === 'string') return value ? `[REDACTED:${value.length}]` : '';
  if (Array.isArray(value)) return value.map((item) => redact(item, key));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [childKey, redact(child, childKey)]));
  return value;
}
