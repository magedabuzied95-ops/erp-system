import {
  isBasicColorEdition,
  isInvalidEditionName,
  normalizeColorName,
} from "../../src/shared/lib/editionNameGenerator.js";

const TRUSTED_DOMAINS = [
  "nike.com",
  "adidas.com",
  "stockx.com",
  "goat.com",
  "flightclub.com",
  "farfetch.com",
  "footlocker.com",
];

const COLORWAY_PHRASES = [
  "Reverse Mocha",
  "Black Phantom",
  "Dark Mocha",
  "Mocha",
  "Medium Olive",
  "Olive",
  "Fragment",
  "Sail",
  "Bred",
  "Chicago",
  "Panda",
  "University Blue",
  "Coconut Milk",
  "Military Black",
  "Lost and Found",
  "Light Smoke Grey",
  "Smoke Grey",
  "Wolf Grey",
  "Cool Grey",
  "Shadow Grey",
  "Neutral Grey",
  "Black Toe",
  "Royal",
  "Obsidian",
  "Court Purple",
  "Pine Green",
  "Thunder",
  "Taxi",
  "Oreo",
  "UNC",
  "Triple Black",
  "Triple White",
];

const NO_TRUSTED_MATCH = {
  edition_name: "",
  confidence: 0,
  source: "NO_TRUSTED_MATCH",
  source_url: "",
  source_title: "",
  candidates: [],
};

const cleanText = (value = "") => String(value ?? "").replace(/\s+/g, " ").trim();

const titleCase = (value = "") =>
  cleanText(value)
    .split(/\s+/)
    .map((part) => (part ? `${part.charAt(0).toUpperCase()}${part.slice(1).toLowerCase()}` : ""))
    .join(" ");

const normalizeImageUrl = (value = "") => {
  const text = cleanText(value);
  if (/^https?:\/\//i.test(text)) return text;
  return "";
};

const getHostname = (value = "") => {
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
};

const getTrustedDomain = (value = "") => {
  const hostname = getHostname(value);
  if (!hostname) return "";
  return TRUSTED_DOMAINS.find((domain) => hostname === domain || hostname.endsWith(`.${domain}`)) || "";
};

const providerKeysAvailable = () =>
  Boolean(
    cleanText(process.env.SERPAPI_KEY || process.env.SERPAPI_API_KEY || process.env.SERP_API_KEY) ||
      (cleanText(process.env.GOOGLE_CSE_API_KEY || process.env.GOOGLE_SEARCH_API_KEY || process.env.GOOGLE_API_KEY) &&
        cleanText(process.env.GOOGLE_CSE_CX || process.env.GOOGLE_SEARCH_CX || process.env.GOOGLE_CSE_ID))
  );

const isRawColorOnly = (candidate = "", input = {}) => {
  const normalizedCandidate = normalizeColorName(candidate);
  const normalizedColor = normalizeColorName(input.color_name || input.color || "");
  return Boolean(normalizedCandidate && normalizedColor && normalizedCandidate === normalizedColor);
};

const isAllowedCandidate = (candidate = "", sourceText = "", input = {}) => {
  const name = cleanText(candidate);
  if (!name || name.length < 2 || name.length > 48) return false;
  if (isInvalidEditionName(name, input.color_name || input.color || "")) return false;
  if (isRawColorOnly(name, input)) return false;

  const normalized = normalizeColorName(name);
  const confirmedPhrase = COLORWAY_PHRASES.some((phrase) => normalizeColorName(phrase) === normalized);
  if (isBasicColorEdition(name) && !confirmedPhrase) return false;
  if (["brown edition", "black edition", "grey edition", "gray edition"].includes(normalized)) return false;
  if (["triple black", "triple white"].includes(normalized)) {
    return sourceText.toLowerCase().includes(normalized);
  }
  return true;
};

const extractColorwayCandidates = (text = "", input = {}) => {
  const source = cleanText(text).replace(/[|()[\]{}]/g, " ");
  if (!source) return [];
  const lower = source.toLowerCase();
  const candidates = [];

  for (const phrase of COLORWAY_PHRASES) {
    if (lower.includes(phrase.toLowerCase()) && isAllowedCandidate(phrase, source, input)) {
      candidates.push(phrase);
    }
  }

  const patternMatches = [
    ...source.matchAll(/\b(?:colorway|colourway|edition|style|release)\s*[:-]\s*([A-Za-z][A-Za-z0-9 /-]{2,40})/gi),
    ...source.matchAll(/["']([A-Z][A-Za-z0-9 /-]{2,40})["']/g),
  ];

  for (const match of patternMatches) {
    const value = titleCase(String(match[1] || "").split(/[,.;]/)[0]);
    if (isAllowedCandidate(value, source, input)) candidates.push(value);
  }

  return candidates;
};

const buildQuery = (input = {}) =>
  [
    normalizeImageUrl(input.image_url),
    input.brand,
    input.manufacturer,
    input.product_name,
    "sneaker colorway official",
    TRUSTED_DOMAINS.map((domain) => `site:${domain}`).join(" OR "),
  ]
    .map(cleanText)
    .filter(Boolean)
    .join(" ");

const normalizeResultRows = (rows = [], provider = "") =>
  rows.map((row) => ({
    title: cleanText(row.title || row.name || row.source || ""),
    snippet: cleanText(row.snippet || row.description || row.subtitle || row.source_name || ""),
    link: cleanText(row.link || row.url || row.source_link || row.source || ""),
    provider,
  }));

const serpApiSearch = async (input = {}) => {
  const apiKey = cleanText(process.env.SERPAPI_KEY || process.env.SERPAPI_API_KEY || process.env.SERP_API_KEY);
  const imageUrl = normalizeImageUrl(input.image_url);
  if (!apiKey || !imageUrl || typeof fetch !== "function") return [];

  const lensUrl = new URL("https://serpapi.com/search.json");
  lensUrl.searchParams.set("engine", "google_lens");
  lensUrl.searchParams.set("url", imageUrl);
  lensUrl.searchParams.set("api_key", apiKey);

  const lensResponse = await fetch(lensUrl);
  if (!lensResponse.ok) throw new Error(`SerpAPI Lens failed: ${lensResponse.status}`);
  const lensData = await lensResponse.json();
  const lensRows = [
    ...(Array.isArray(lensData.visual_matches) ? lensData.visual_matches : []),
    ...(Array.isArray(lensData.image_results) ? lensData.image_results : []),
    ...(Array.isArray(lensData.organic_results) ? lensData.organic_results : []),
  ];

  const imageRows = normalizeResultRows(lensRows, "SerpAPI Lens");
  if (imageRows.some((row) => getTrustedDomain(row.link))) return imageRows;

  const imagesUrl = new URL("https://serpapi.com/search.json");
  imagesUrl.searchParams.set("engine", "google_images");
  imagesUrl.searchParams.set("q", buildQuery(input));
  imagesUrl.searchParams.set("api_key", apiKey);

  const imagesResponse = await fetch(imagesUrl);
  if (!imagesResponse.ok) throw new Error(`SerpAPI Images failed: ${imagesResponse.status}`);
  const imagesData = await imagesResponse.json();
  return [
    ...imageRows,
    ...normalizeResultRows([
      ...(Array.isArray(imagesData.images_results) ? imagesData.images_results : []),
      ...(Array.isArray(imagesData.organic_results) ? imagesData.organic_results : []),
    ], "SerpAPI Images"),
  ];
};

const googleCustomSearch = async (input = {}) => {
  const apiKey = cleanText(process.env.GOOGLE_CSE_API_KEY || process.env.GOOGLE_SEARCH_API_KEY || process.env.GOOGLE_API_KEY);
  const cx = cleanText(process.env.GOOGLE_CSE_CX || process.env.GOOGLE_SEARCH_CX || process.env.GOOGLE_CSE_ID);
  if (!apiKey || !cx || typeof fetch !== "function") return [];

  const url = new URL("https://www.googleapis.com/customsearch/v1");
  url.searchParams.set("key", apiKey);
  url.searchParams.set("cx", cx);
  url.searchParams.set("q", buildQuery(input));
  url.searchParams.set("num", "10");

  const response = await fetch(url);
  if (!response.ok) throw new Error(`Google CSE failed: ${response.status}`);
  const data = await response.json();
  return normalizeResultRows(Array.isArray(data.items) ? data.items : [], "Google CSE");
};

const rankTrustedCandidates = (rows = [], input = {}) => {
  const grouped = new Map();

  for (const row of rows) {
    const domain = getTrustedDomain(row.link);
    if (!domain) continue;
    const title = cleanText(row.title);
    const snippet = cleanText(row.snippet);
    const text = `${title} ${snippet}`;
    const names = extractColorwayCandidates(text, input);

    for (const name of names) {
      const key = normalizeColorName(name);
      const confidence =
        0.72 +
        (title.toLowerCase().includes(name.toLowerCase()) ? 0.1 : 0) +
        (cleanText(input.brand) && text.toLowerCase().includes(cleanText(input.brand).toLowerCase()) ? 0.05 : 0) +
        (cleanText(input.product_name) && text.toLowerCase().includes(cleanText(input.product_name).toLowerCase().split(/\s+/)[0]) ? 0.03 : 0);
      const candidate = {
        name,
        edition_name: name,
        confidence: Math.min(0.96, confidence),
        source: domain,
        source_url: row.link,
        source_title: title || snippet,
        title: title || snippet,
        provider: row.provider,
      };
      const existing = grouped.get(key);
      if (!existing || candidate.confidence > existing.confidence) grouped.set(key, candidate);
    }
  }

  return Array.from(grouped.values()).sort((a, b) => b.confidence - a.confidence).slice(0, 8);
};

export const suggestEditionFromImage = async (input = {}) => {
  const normalizedInput = {
    ...input,
    image_url: normalizeImageUrl(input.image_url || input.imageUrl || input.images?.[0]),
    image_base64_optional: cleanText(input.image_base64_optional || input.imageBase64Optional),
    color_name: normalizeColorName(input.color_name || input.color || ""),
    product_name: cleanText(input.product_name || input.productName),
    brand: cleanText(input.brand),
    manufacturer: cleanText(input.manufacturer || input.manufacturer_name),
  };

  if (!providerKeysAvailable()) return NO_TRUSTED_MATCH;
  if (!normalizedInput.image_url) return NO_TRUSTED_MATCH;

  const attempts = [serpApiSearch(normalizedInput), googleCustomSearch(normalizedInput)];
  const rows = (await Promise.allSettled(attempts)).flatMap((result) => (result.status === "fulfilled" ? result.value : []));
  const candidates = rankTrustedCandidates(rows, normalizedInput);
  const best = candidates[0];

  if (!best) return NO_TRUSTED_MATCH;

  return {
    edition_name: best.name,
    confidence: best.confidence,
    source: best.source,
    source_url: best.source_url,
    source_title: best.source_title,
    candidates,
  };
};
