const SENSITIVE_KEY = /(cookie|token|secret|password|authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|session[_-]?data|config_ciphertext)/i;

export const redact = (value, depth = 0) => {
  if (value === null || value === undefined) return value;
  if (depth > 5) return "[TRUNCATED]";
  if (Array.isArray(value)) return value.slice(0, 30).map((item) => redact(item, depth + 1));
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        SENSITIVE_KEY.test(key) ? "[REDACTED]" : redact(item, depth + 1),
      ])
    );
  }
  if (typeof value === "string" && value.length > 2_000) return `${value.slice(0, 2_000)}...[TRUNCATED]`;
  return value;
};

const write = (level, event, fields = {}) => {
  const payload = redact({
    timestamp: new Date().toISOString(),
    service: "m1-channel-gateway",
    level,
    event,
    ...fields,
  });
  const method = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  method(JSON.stringify(payload));
};

export const logger = {
  info: (event, fields) => write("info", event, fields),
  warn: (event, fields) => write("warn", event, fields),
  error: (event, fields) => write("error", event, fields),
};

export default logger;
