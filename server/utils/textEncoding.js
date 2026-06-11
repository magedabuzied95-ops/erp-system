import iconv from "iconv-lite";

const ARABIC_RE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/;
const MOJIBAKE_BYTE_MARKER_RE = /[ØÙÃÂ]/;
const MOJIBAKE_SYMBOL_RE = /[…›™ƒ‚]/;
const SUSPICIOUS_ARABIC_GLYPH_RE = /[ظطؤإ]/;

const countMatches = (value, pattern) => String(value || "").match(pattern)?.length || 0;

const getArabicTextMetrics = (value = "") => {
  const text = String(value ?? "");
  const compactText = text.replace(/\s+/g, "");
  return {
    text,
    compactText,
    arabicCount: countMatches(text, ARABIC_RE),
    suspiciousGlyphCount: countMatches(text, SUSPICIOUS_ARABIC_GLYPH_RE),
    mojibakeByteCount: countMatches(text, MOJIBAKE_BYTE_MARKER_RE),
    mojibakeSymbolCount: countMatches(text, MOJIBAKE_SYMBOL_RE),
  };
};

const isLikelyArabicMojibake = (value) => {
  const { compactText, arabicCount, suspiciousGlyphCount, mojibakeByteCount, mojibakeSymbolCount } = getArabicTextMetrics(value);
  if (!compactText) return false;

  if (mojibakeByteCount > 0 || mojibakeSymbolCount > 0) return true;
  if (arabicCount < 4) return false;

  const suspiciousCount = suspiciousGlyphCount;
  if (suspiciousCount < 4) return false;

  const suspiciousDensity = suspiciousCount / Math.max(1, compactText.length);
  const suspiciousToArabicRatio = suspiciousCount / Math.max(1, arabicCount);

  return suspiciousDensity >= 0.28 || suspiciousToArabicRatio >= 0.35;
};

export const repairArabicMojibakeText = (value) => {
  if (typeof value !== "string") return value;
  if (!value) return value;
  if (!isLikelyArabicMojibake(value)) return value;

  try {
    const originalMetrics = getArabicTextMetrics(value);

    const candidates = [
      iconv.decode(iconv.encode(value, "windows-1256"), "utf8"),
      Buffer.from(value, "latin1").toString("utf8"),
    ].filter((candidate) => candidate && candidate !== value);

    for (const repaired of candidates) {
      const repairedMetrics = getArabicTextMetrics(repaired);
      const originalNoise =
        originalMetrics.mojibakeByteCount +
        originalMetrics.mojibakeSymbolCount +
        originalMetrics.suspiciousGlyphCount;
      const repairedNoise =
        repairedMetrics.mojibakeByteCount +
        repairedMetrics.mojibakeSymbolCount +
        repairedMetrics.suspiciousGlyphCount;

      if (repairedMetrics.arabicCount > originalMetrics.arabicCount) return repaired;
      if (originalNoise > 0 && repairedNoise < originalNoise) return repaired;
    }
  } catch {
    return value;
  }

  return value;
};
