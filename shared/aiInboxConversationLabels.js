export const AI_INBOX_LABEL_COLOR_KEYS = ["sky", "cyan", "amber", "violet", "emerald", "rose", "orange", "teal"];

export const AI_INBOX_DEFAULT_LABELS = [
  { id: "new", name: "New", color: "sky", leadStatus: "new" },
  { id: "contacted", name: "Contacted", color: "cyan", leadStatus: "contacted" },
  { id: "interested", name: "Interested", color: "amber", leadStatus: "interested" },
  { id: "negotiation", name: "Negotiation", color: "violet", leadStatus: "negotiation" },
  { id: "won", name: "Won", color: "emerald", leadStatus: "won" },
  { id: "lost", name: "Lost", color: "rose", leadStatus: "lost" },
];

const cleanLabelText = (value = "") => String(value ?? "").trim().replace(/\s+/g, " ");

const stableLabelHash = (value = "") => {
  let hash = 0;
  for (const character of cleanLabelText(value).toLowerCase()) hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0;
  return Math.abs(hash);
};

export const customAiInboxLabel = (name = "") => {
  const cleanName = cleanLabelText(name).slice(0, 40);
  if (!cleanName) return null;
  const normalizedName = cleanName.toLowerCase();
  const defaultLabel = AI_INBOX_DEFAULT_LABELS.find((item) => item.name.toLowerCase() === normalizedName || item.id === normalizedName);
  if (defaultLabel) return { ...defaultLabel };
  const hash = stableLabelHash(cleanName);
  return {
    id: `custom-${hash.toString(36)}`,
    name: cleanName,
    color: AI_INBOX_LABEL_COLOR_KEYS[hash % AI_INBOX_LABEL_COLOR_KEYS.length],
  };
};

export const normalizeAiInboxConversationLabels = (value, { max = 12 } = {}) => {
  const source = Array.isArray(value) ? value : value ? [value] : [];
  const labels = [];
  const seen = new Set();
  for (const item of source) {
    const fallback = typeof item === "string" ? customAiInboxLabel(item) : customAiInboxLabel(item?.name || item?.label || item?.id || "");
    if (!fallback) continue;
    const id = cleanLabelText(item?.id || fallback.id).toLowerCase().slice(0, 64);
    const name = cleanLabelText(item?.name || item?.label || fallback.name).slice(0, 40);
    const defaultLabel = AI_INBOX_DEFAULT_LABELS.find((candidate) => candidate.id === id || candidate.name.toLowerCase() === name.toLowerCase());
    const colorCandidate = cleanLabelText(item?.color || defaultLabel?.color || fallback.color).toLowerCase();
    const label = defaultLabel
      ? {
          ...defaultLabel,
          name: name || defaultLabel.name,
          color: AI_INBOX_LABEL_COLOR_KEYS.includes(colorCandidate) ? colorCandidate : defaultLabel.color,
        }
      : { id: id || fallback.id, name, color: AI_INBOX_LABEL_COLOR_KEYS.includes(colorCandidate) ? colorCandidate : fallback.color };
    if (!label.id || !label.name || seen.has(label.id)) continue;
    seen.add(label.id);
    labels.push(label);
    if (labels.length >= max) break;
  }
  return labels;
};

export const aiInboxLabelsFromConversation = (conversation = {}) => {
  const stored =
    conversation?.conversation_labels ||
    conversation?.labels ||
    conversation?.channel_metadata?.conversation_labels ||
    conversation?.channel_metadata?.labels ||
    conversation?.customer_profile?.conversation_labels ||
    conversation?.customer_profile?.labels;
  const normalized = normalizeAiInboxConversationLabels(stored);
  if (normalized.length) return normalized;
  const leadStatus = cleanLabelText(conversation?.lead_status || conversation?.channel_metadata?.lead_status).toLowerCase();
  const fallback = AI_INBOX_DEFAULT_LABELS.find((item) => item.id === leadStatus);
  return fallback ? [{ ...fallback }] : [];
};
