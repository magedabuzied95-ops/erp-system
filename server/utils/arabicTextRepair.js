import iconv from "iconv-lite";

const CORRUPTED_ARABIC_MARKERS = [
  "\u00d8",
  "\u00d9",
  "\u00c3",
  "\u00c2",
  "\u00e2",
  "\u0637\u00a7",
  "\u0638\u201e",
  "\u0638\u0679",
  "\u0638\u2026",
];

const SOURCE_REPAIR_RANGES = [
  [0x0600, 0x06ff],
  [0x0750, 0x077f],
  [0x08a0, 0x08ff],
  [0x2000, 0x27bf],
  [0x1f300, 0x1faff],
];

let corruptedArabicRepairPattern = null;
let corruptedArabicRepairMap = null;

const escapeRegExp = (value = "") => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const hasCorruptedArabicMarker = (value = "") => {
  const next = String(value ?? "");
  if (!next) return false;
  return (
    CORRUPTED_ARABIC_MARKERS.some((marker) => next.includes(marker)) ||
    /(?:[\u0637\u0638][\u00a1-\u00ff\u0600-\u06ff\u2018-\u203a]){2,}/.test(next)
  );
};

const getCorruptedArabicRepairPattern = () => {
  if (corruptedArabicRepairPattern) return corruptedArabicRepairPattern;

  const map = new Map();
  for (const [start, end] of SOURCE_REPAIR_RANGES) {
    for (let cp = start; cp <= end; cp += 1) {
      const char = String.fromCodePoint(cp);
      const bytes = Buffer.from(char, "utf8");
      for (const encoding of ["windows-1256", "windows-1252"]) {
        const mojibake = iconv.decode(bytes, encoding);
        if (mojibake && mojibake !== char && mojibake.length > 1) {
          map.set(mojibake, char);
        }
      }
    }
  }

  corruptedArabicRepairMap = map;
  const keys = [...map.keys()]
    .filter((key) =>
      CORRUPTED_ARABIC_MARKERS.some((marker) => key.includes(marker)) ||
      /[\u00e2\u064b\u06ba\u0637\u0638]/.test(key)
    )
    .sort((a, b) => b.length - a.length);

  corruptedArabicRepairPattern = keys.length ? new RegExp(keys.map(escapeRegExp).join("|"), "g") : /$^/g;
  return corruptedArabicRepairPattern;
};

export const repairCorruptedArabicValue = (value = "") => {
  const original = String(value ?? "");
  if (!original || !hasCorruptedArabicMarker(original)) return original;

  const pattern = getCorruptedArabicRepairPattern();
  let next = original;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const repaired = next.replace(pattern, (match) => corruptedArabicRepairMap.get(match) || match);
    if (repaired === next) break;
    next = repaired;
  }

  return next;
};

export const repairCorruptedArabicText = repairCorruptedArabicValue;

export const corruptedArabicWhereClause = (columns = [], startIndex = 1) => {
  let index = startIndex;
  const clauses = [];
  const params = [];

  for (const column of columns) {
    for (const marker of CORRUPTED_ARABIC_MARKERS) {
      clauses.push(`${column} LIKE $${index}`);
      params.push(`%${marker}%`);
      index += 1;
    }
  }

  return { clause: clauses.join(" OR "), params };
};
