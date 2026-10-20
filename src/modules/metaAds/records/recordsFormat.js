// Value formatting + enum options for the record pages.

import { formatDate, formatDateTime, formatMoney, formatNumber, localeFor } from "../shared/metaAdsFormat";

const OBJECT_STATUSES = ["ACTIVE", "PAUSED", "DELETED", "ARCHIVED"];

const keysOf = (t, path) => {
  const value = t(path, { returnObjects: true });
  return value && typeof value === "object" ? Object.keys(value) : [];
};

// enum name → { base: translation branch, values?: fixed list, label?: sub key }
const ENUMS = {
  objectStatus: { base: "metaAds.status", values: OBJECT_STATUSES },
  effectiveStatus: { base: "metaAds.status", filter: (code) => code === code.toUpperCase() && code !== "DRAFT" },
  accountStatus: { base: "metaAds.status", values: ["active", "disabled", "unsettled"] },
  objective: { base: "metaAds.objectives", label: "label" },
  goal: { base: "metaAds.goals" },
  billing: { base: "metaAds.billingEvents" },
  bid: { base: "metaAds.bidStrategies" },
  cta: { base: "metaAds.cta" },
  channel: { base: "metaAds.channels" },
  level: { base: "metaAds.levels" },
  severity: { base: "metaAdsRecords.values.severity" },
  objectType: { base: "metaAdsRecords.values.objectType" },
  formStatus: { base: "metaAdsRecords.values.formStatus" },
  leadStatus: { base: "metaAdsRecords.values.leadStatus" },
  creativeType: { base: "metaAdsRecords.values.creativeType" },
  period: { base: "metaAdsRecords.values.period" },
  attribution: { base: "metaAdsRecords.values.attribution" },
  eventStatus: { base: "metaAdsRecords.values.eventStatus" },
  adFormat: { base: "metaAdsRecords.values.adFormat" },
};

export const enumLabel = (t, name, value) => {
  if (value === null || value === undefined || value === "") return "";
  const def = ENUMS[name];
  if (!def) return String(value);
  const key = `${def.base}.${value}${def.label ? `.${def.label}` : ""}`;
  return t(key, { defaultValue: String(value) });
};

export const enumOptions = (t, name) => {
  const def = ENUMS[name];
  if (!def) return [];
  let codes = def.values || keysOf(t, def.base);
  if (def.filter) codes = codes.filter(def.filter);
  return codes.map((code) => ({ value: code, label: enumLabel(t, name, code) }));
};

// Whether a form field may be edited right now (registry `editable`: true | "draft" | "create").
export const isFieldEditable = (def, { canEdit, isNew, record }) => {
  if (!canEdit || !def.editable) return false;
  if (def.editable === true) return true;
  if (def.editable === "draft") return isNew || Boolean(record?.is_draft);
  if (def.editable === "create") return isNew;
  return false;
};

export const isBlankValue = (value) => value === null || value === undefined || value === "" || (Array.isArray(value) && !value.length);

// Plain-text rendering of one value (cells, read-only fields).
export const formatValue = (t, i18n, def, row) => {
  const value = row?.[def.key];
  const locale = localeFor(i18n.language);
  switch (def.type) {
    case "enum":
      return isBlankValue(value) ? "" : enumLabel(t, def.enum, value);
    case "status":
      if (row?.is_draft) return t("metaAds.status.DRAFT");
      return isBlankValue(value) ? "" : enumLabel(t, def.enum, value);
    case "number":
      return isBlankValue(value) ? "" : formatNumber(value, locale, def.digits || (Number(value) % 1 ? 2 : 0));
    case "money":
      return isBlankValue(value) ? "" : formatMoney(value, row?.account_currency || row?.currency || "", locale);
    case "date":
      return isBlankValue(value) ? "" : formatDate(value, locale);
    case "datetime":
      return isBlankValue(value) ? "" : formatDateTime(value, locale);
    case "lookup":
      return row?.[def.display] || (isBlankValue(value) ? "" : `#${value}`);
    default:
      if (isBlankValue(value)) return "";
      return typeof value === "object" ? JSON.stringify(value) : String(value);
  }
};

// Catalog lists (optimization goals / billing events) render codes through metaAds.json.
export const renderCustom = (t, render, row) => {
  switch (render) {
    case "goal":
      return t(`metaAds.goals.${row.code}`, { defaultValue: row.code });
    case "billing":
      return t(`metaAds.billingEvents.${row.code}`, { defaultValue: row.code });
    case "objectives":
      return (row.objectives || []).map((code) => t(`metaAds.objectives.${code}.label`, { defaultValue: code })).join("، ");
    case "goals":
      return (row.goals || []).map((code) => (code === "*" ? t("metaAdsRecords.values.allGoals") : t(`metaAds.goals.${code}`, { defaultValue: code }))).join("، ");
    default:
      return "";
  }
};

// ---------------------------------------------------------------- Cairo wall clock
// datetime-local inputs show / take Cairo time whatever the browser's zone is.

const CAIRO = "Africa/Cairo";

const cairoParts = (date) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: CAIRO, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value || "00";
  return { y: get("year"), m: get("month"), d: get("day"), h: get("hour"), mi: get("minute") };
};

export const toCairoInput = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const p = cairoParts(date);
  return `${p.y}-${p.m}-${p.d}T${p.h}:${p.mi}`;
};

export const fromCairoInput = (local) => {
  if (!local) return null;
  const match = String(local).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!match) return null;
  const [, y, m, d, h, mi] = match.map(Number);
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const p = cairoParts(new Date(guess));
  const asCairo = Date.UTC(Number(p.y), Number(p.m) - 1, Number(p.d), Number(p.h), Number(p.mi));
  const offset = asCairo - guess;
  return new Date(guess - offset).toISOString();
};

// ---------------------------------------------------------------- localStorage (column visibility)

export const readHiddenColumns = (resource) => {
  try {
    const raw = window.localStorage.getItem(`metaAds.records.hidden.${resource}`);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export const writeHiddenColumns = (resource, keys) => {
  try {
    window.localStorage.setItem(`metaAds.records.hidden.${resource}`, JSON.stringify(keys));
  } catch {
    // Private mode: the choice lasts for this visit only.
  }
};
