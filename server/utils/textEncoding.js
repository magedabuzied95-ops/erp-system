const ARABIC_RE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/;
const MOJIBAKE_RE = /[ØÙÛÃÂ]/;

const countMatches = (value, pattern) => String(value || "").match(pattern)?.length || 0;

const isLikelyArabicMojibake = (value) => {
  const text = String(value ?? "");
  if (!text || !MOJIBAKE_RE.test(text)) return false;
  if (ARABIC_RE.test(text)) return false;
  return true;
};

export const repairArabicMojibakeText = (value) => {
  if (typeof value !== "string") return value;
  if (!value) return value;
  if (!isLikelyArabicMojibake(value)) return value;

  try {
    const repaired = Buffer.from(value, "latin1").toString("utf8");
    if (!repaired || repaired === value) return value;

    const originalArabicCount = countMatches(value, ARABIC_RE);
    const repairedArabicCount = countMatches(repaired, ARABIC_RE);
    if (repairedArabicCount > originalArabicCount) return repaired;

    const originalMojibakeCount = countMatches(value, MOJIBAKE_RE);
    const repairedMojibakeCount = countMatches(repaired, MOJIBAKE_RE);
    if (originalMojibakeCount > 0 && repairedMojibakeCount < originalMojibakeCount) return repaired;
  } catch {
    return value;
  }

  return value;
};
