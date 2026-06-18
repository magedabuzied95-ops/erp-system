const text = (value = "", fallback = "") => String(value ?? fallback).trim();

const normalizeWhatsAppDigits = (value = "") => {
  let raw = text(value);
  if (!raw) return "";
  raw = raw.replace(/^whatsapp:/i, "");
  raw = raw.replace(/@(?:s\.whatsapp\.net|lid)$/i, "");
  raw = raw.split("@")[0];
  let digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("20") && digits.length === 12) return digits;
  if (digits.startsWith("0") && digits.length === 11) return `20${digits.slice(1)}`;
  if (digits.startsWith("1") && digits.length === 10) return `20${digits}`;
  return digits;
};

export const normalizeWhatsappSessionId = (sessionId = "", phone = "") => {
  const candidates = [sessionId, phone];
  for (const candidate of candidates) {
    const normalized = normalizeWhatsAppDigits(candidate);
    if (normalized) return `whatsapp:${normalized}`;
    const raw = text(candidate);
    if (raw.toLowerCase().startsWith("whatsapp:")) {
      const stripped = normalizeWhatsAppDigits(raw.slice("whatsapp:".length));
      if (stripped) return `whatsapp:${stripped}`;
    }
  }
  return "";
};

export const normalizeWhatsappRemoteJid = (value = "") => {
  const normalized = normalizeWhatsAppDigits(value);
  return normalized ? `${normalized}@s.whatsapp.net` : "";
};

export const normalizeWhatsappPhone = normalizeWhatsAppDigits;
