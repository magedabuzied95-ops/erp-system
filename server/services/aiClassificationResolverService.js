import {
  fetchProductClassificationGroups,
  fetchProductClassificationGroupByKey,
  fetchProductClassificationOptions,
} from "./productClassificationsService.js";

const text = (value = "") => String(value ?? "").trim();

const normalizeClassificationText = (value = "") =>
  text(value)
    .toLowerCase()
    .replace(/[\u064b-\u065f\u0670\u0640]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/[^\p{L}\p{N}\s_-]+/gu, " ")
    .replace(/[\s_-]+/g, " ")
    .trim();

const compact = (value = "") => normalizeClassificationText(value).replace(/\s+/g, "");

const transliterationFallbacks = new Map([
  ["men", ["men", "man", "male", "mens", "رجالي", "رجال", "رجاله", "مان"]],
  ["women", ["women", "woman", "female", "ladies", "lady", "حريمي", "نسائي", "ستايل بناتي", "وومن"]],
  ["kids", ["kids", "kid", "children", "child", "اطفال", "أطفال", "اطفال", "طفل", "كيدز"]],
  ["running", ["running", "run", "runner", "راننج", "رننج", "جري", "training", "تريننج"]],
  ["casual", ["casual", "كاجوال", "يومي", "everyday", "daily"]],
  ["mirror", ["mirror", "mirro", "ميرور", "ميرو", "mirror original", "original mirror"]],
  ["vietnamese_import", ["vietnamese_import", "vietnamese import", "vietnamese", "vietnam", "فيتنامي", "فيتنام", "مستوردة", "مستورد"]],
]);

const optionAliases = (option = {}) => {
  const base = [
    option.value,
    option.label_ar,
    option.label_en,
    option.name_ar,
    option.name_en,
    option.english_name,
    option.icon,
    option.color,
  ]
    .map(text)
    .filter(Boolean);
  const aliases = new Set();
  for (const value of base) {
    aliases.add(normalizeClassificationText(value));
    aliases.add(compact(value));
  }
  const canonical = normalizeClassificationText(option.value);
  if (transliterationFallbacks.has(canonical)) {
    for (const alias of transliterationFallbacks.get(canonical)) {
      aliases.add(normalizeClassificationText(alias));
      aliases.add(compact(alias));
    }
  }
  return [...aliases].filter(Boolean);
};

const groupPromptLabel = (group = {}) => text(group.label_ar || group.name_ar || group.key || "");

export const loadActiveClassificationGroups = async () => {
  const groups = await fetchProductClassificationGroups({ includeInactive: false });
  const activeGroups = groups.filter((group) => String(group.key || "").trim());
  const optionsCount = activeGroups.reduce((count, group) => count + (group.options || []).filter((option) => option.is_active !== false).length, 0);
  console.log("[classification-options-loaded]", {
    groups_count: activeGroups.length,
    options_count: optionsCount,
    group_keys: activeGroups.map((group) => group.key),
  });
  return activeGroups;
};

export const loadActiveClassificationOptions = async () => {
  const groups = await loadActiveClassificationGroups();
  return groups.flatMap((group) => (group.options || []).map((option) => ({
    group_key: group.key,
    group_label_ar: group.label_ar || group.name_ar || "",
    group_label_en: group.label_en || group.name_en || "",
    ...option,
  })));
};

export const resolveClassificationOption = async (messageText = "", groupKey = "") => {
  const raw = text(messageText);
  const normalized = normalizeClassificationText(raw);
  if (!raw || !normalized) return { matched: false, confidence: 0, group_key: groupKey || "", option_value: "", option_label_ar: "", option_label_en: "" };
  const groups = groupKey ? [await fetchProductClassificationGroupByKey(groupKey, { includeInactive: false })].filter(Boolean) : await loadActiveClassificationGroups();
  const candidates = groups.flatMap((group) => (group.options || []).map((option) => ({ group, option })));
  let best = null;
  for (const candidate of candidates) {
    const aliases = optionAliases(candidate.option);
    const exact = aliases.includes(normalized) || aliases.includes(compact(normalized));
    const aliasMatch = aliases.some((alias) => alias && (normalized.includes(alias) || compact(normalized).includes(compact(alias))));
    if (!exact && !aliasMatch) continue;
    const exactScore = exact ? 0.95 : 0.82;
    const aliasScore = aliasMatch ? 0.88 : exactScore;
    const score = Math.max(exactScore, aliasScore);
    if (!best || score > best.confidence) {
      best = {
        matched: true,
        confidence: score,
        group_key: candidate.group.key,
        option_value: candidate.option.value,
        option_label_ar: candidate.option.label_ar || candidate.option.name_ar || "",
        option_label_en: candidate.option.label_en || candidate.option.name_en || candidate.option.english_name || "",
        option_icon: candidate.option.icon || "",
        option_color: candidate.option.color || "",
      };
    }
  }
  if (best) {
    console.log("[classification-option-resolved]", {
      message_text: raw,
      group_key: best.group_key,
      option_value: best.option_value,
      confidence: best.confidence,
    });
  }
  return best || { matched: false, confidence: 0, group_key: groupKey || "", option_value: "", option_label_ar: "", option_label_en: "", option_icon: "", option_color: "" };
};

export const getClassificationPromptOptions = async (groupKey) => {
  const group = await fetchProductClassificationGroupByKey(groupKey, { includeInactive: false });
  return (group?.options || [])
    .filter((option) => option.is_active !== false)
    .map((option) => ({
      value: option.value,
      label_ar: option.label_ar || option.name_ar || "",
      label_en: option.label_en || option.name_en || option.english_name || "",
      icon: option.icon || "",
    }));
};

export const buildDynamicClarificationQuestion = async (missingGroups = []) => {
  const groups = Array.isArray(missingGroups) ? missingGroups.map((group) => text(group)).filter(Boolean) : [];
  if (!groups.length) return "";
  const activeGroups = await loadActiveClassificationGroups();
  const groupMap = new Map(activeGroups.map((group) => [String(group.key || ""), group]));
  const parts = [];
  for (const groupKey of groups) {
    const group = groupMap.get(groupKey);
    if (!group) continue;
    const options = (group.options || []).filter((option) => option.is_active !== false).slice(0, 4);
    if (!options.length) continue;
    const labels = options.map((option) => text(option.label_ar || option.label_en || option.value)).filter(Boolean);
    parts.push(`${groupPromptLabel(group)}: ${labels.join(" ولا ")}`);
  }
  return parts.join("؟ ") + (parts.length ? "؟" : "");
};

export const resolveClassificationOptionsForMessage = async (messageText = "", groupKeys = []) => {
  const keys = Array.isArray(groupKeys) && groupKeys.length ? groupKeys : (await loadActiveClassificationGroups()).map((group) => group.key);
  const results = [];
  for (const groupKey of keys) {
    const resolved = await resolveClassificationOption(messageText, groupKey);
    if (resolved.matched) results.push(resolved);
  }
  return results;
};

export const normalizeClassificationValue = normalizeClassificationText;

export default {
  loadActiveClassificationGroups,
  loadActiveClassificationOptions,
  normalizeClassificationText,
  resolveClassificationOption,
  resolveClassificationOptionsForMessage,
  getClassificationPromptOptions,
  buildDynamicClarificationQuestion,
};
