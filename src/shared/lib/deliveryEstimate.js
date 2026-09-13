/*
 * "متوقع وصول طلبك الثلاثاء 15 سبتمبر" — the calendar maths behind it.
 *
 * Pure: it never reads a clock. The caller passes the shop's wall clock (Cairo,
 * from appTimezone's zonedParts) so the server, the settings preview and the
 * tests all agree on the same day. Only the server computes what a shopper sees;
 * the browser formats the day keys it is handed.
 *
 * The model, in working days of the shop and the courier (they share one
 * calendar — Bosta does not deliver on the days the shop does not ship):
 *   1. An order placed on a working day before the cut-off counts from today;
 *      after the cut-off, or on a day off, it counts from the next working day.
 *   2. Handling (storefront.shipping_handling_*_days, or a zone override) moves
 *      that start forward to the day the parcel is handed to the courier.
 *   3. The zone's transit days move it to the customer's door.
 */

export const DELIVERY_ESTIMATE_ENABLED_KEY = "storefront.delivery_estimate_enabled";
export const ORDER_CUTOFF_TIME_KEY = "storefront.order_cutoff_time";
export const SHIPPING_DAYS_OFF_KEY = "storefront.shipping_days_off";
export const SHIPPING_HOLIDAYS_KEY = "storefront.shipping_holidays";

export const DEFAULT_ORDER_CUTOFF_TIME = "14:00";
// Friday — the Egyptian weekend day couriers do not deliver on.
export const DEFAULT_SHIPPING_DAYS_OFF = [5];
// A window wider than this is not an estimate anyone can plan around; the
// storefront falls back to the zone's own wording instead of printing it.
export const MAX_ESTIMATE_SPAN_DAYS = 45;

const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME = /^([01]?\d|2[0-3]):([0-5]\d)$/;

const wholeOrNull = (value) => {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : null;
};

export const isDateKey = (value) => {
  const match = DATE_KEY.exec(String(value || "").trim());
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toISOString().slice(0, 10) === match[0];
};

export const addDaysToKey = (dateKey, days = 0) => {
  const match = DATE_KEY.exec(String(dateKey || "").trim());
  if (!match) return "";
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + Number(days || 0))).toISOString().slice(0, 10);
};

export const weekdayOfKey = (dateKey) => {
  const match = DATE_KEY.exec(String(dateKey || "").trim());
  return match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))).getUTCDay() : 0;
};

export const daysBetweenKeys = (fromKey, toKey) => {
  if (!isDateKey(fromKey) || !isDateKey(toKey)) return 0;
  return Math.round((Date.parse(`${toKey}T00:00:00Z`) - Date.parse(`${fromKey}T00:00:00Z`)) / 86400000);
};

/** "14:30" → minutes after midnight; anything unreadable → the default cut-off. */
export const normalizeCutoffTime = (value) => {
  const match = TIME.exec(String(value ?? "").trim());
  const [hours, minutes] = match ? [Number(match[1]), Number(match[2])] : DEFAULT_ORDER_CUTOFF_TIME.split(":").map(Number);
  return {
    minutes: hours * 60 + minutes,
    text: `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`,
  };
};

/** Weekdays (0 = Sunday) the shop does not ship; a week with no working day is refused. */
export const normalizeDaysOff = (value) => {
  const list = Array.isArray(value) ? value : DEFAULT_SHIPPING_DAYS_OFF;
  const days = Array.from(new Set(list.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))).sort();
  return days.length >= 7 ? [...DEFAULT_SHIPPING_DAYS_OFF] : days;
};

export const normalizeHolidays = (value) =>
  Array.from(new Set((Array.isArray(value) ? value : []).map((day) => String(day || "").trim()).filter(isDateKey))).sort();

export const normalizeDeliveryEstimateSettings = (settings = {}) => ({
  enabled: !["false", "0", "off", "no"].includes(String(settings.enabled ?? true).trim().toLowerCase()),
  cutoff: normalizeCutoffTime(settings.cutoffTime),
  daysOff: normalizeDaysOff(settings.daysOff),
  holidays: normalizeHolidays(settings.holidays),
});

const makeCalendar = ({ daysOff = [], holidays = [] }) => {
  const off = new Set(daysOff);
  const closed = new Set(holidays);
  const isWorkingDay = (dateKey) => !off.has(weekdayOfKey(dateKey)) && !closed.has(dateKey);
  // A year of consecutive holidays would otherwise loop for ever.
  const nextWorkingDay = (dateKey) => {
    let day = dateKey;
    for (let guard = 0; guard < 366 && !isWorkingDay(day); guard += 1) day = addDaysToKey(day, 1);
    return day;
  };
  const addWorkingDays = (dateKey, count) => {
    let day = nextWorkingDay(dateKey);
    for (let step = 0; step < count; step += 1) day = nextWorkingDay(addDaysToKey(day, 1));
    return day;
  };
  return { isWorkingDay, nextWorkingDay, addWorkingDays };
};

/**
 * Transit days for a zone: its own transit range, else its legacy total delivery
 * range, else the numbers in its free-text wording ("2-4 business days"). The
 * same order merchantPolicies uses for the product schema.
 */
export const resolveZoneTransitDays = (zone = {}) => {
  const pair = (minValue, maxValue) => {
    const min = wholeOrNull(minValue);
    const max = wholeOrNull(maxValue);
    if (min === null && max === null) return null;
    const low = min ?? max;
    return { minDays: low, maxDays: Math.max(low, max ?? low) };
  };
  const configured = pair(zone.transit_min_days, zone.transit_max_days);
  if (configured) return { ...configured, source: "transit" };
  const legacy = pair(zone.delivery_min_days, zone.delivery_max_days);
  if (legacy) return { ...legacy, source: "delivery" };
  const digits = String(zone.estimated_delivery_text || "")
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .match(/\d+/g);
  if (digits?.length) {
    const parsed = pair(digits[0], digits[1] ?? digits[0]);
    if (parsed) return { ...parsed, source: "text" };
  }
  return null;
};

/**
 * @param now      `{ year, month, day, hour, minute }` — the shop's wall clock.
 * @param handling `{ minDays, maxDays }` working days before courier handoff.
 * @param transit  `{ minDays, maxDays }` working days in the courier's hands.
 * @returns null when there is nothing honest to show, else
 *   `{ earliest, latest, start, orderedToday, cutoff, cutoffMinutesLeft }`.
 */
export const computeDeliveryEstimate = ({ now, handling, transit, settings = {} } = {}) => {
  if (!now || !transit) return null;
  const today = `${now.year}-${String(now.month).padStart(2, "0")}-${String(now.day).padStart(2, "0")}`;
  if (!isDateKey(today)) return null;
  const config = normalizeDeliveryEstimateSettings(settings);
  if (!config.enabled) return null;
  const calendar = makeCalendar(config);

  const handlingMin = wholeOrNull(handling?.minDays) ?? 0;
  const handlingMax = Math.max(handlingMin, wholeOrNull(handling?.maxDays) ?? handlingMin);
  const transitMin = wholeOrNull(transit.minDays);
  if (transitMin === null) return null;
  const transitMax = Math.max(transitMin, wholeOrNull(transit.maxDays) ?? transitMin);

  const minuteOfDay = Number(now.hour || 0) * 60 + Number(now.minute || 0);
  const orderedToday = calendar.isWorkingDay(today) && minuteOfDay < config.cutoff.minutes;
  const start = orderedToday ? today : calendar.nextWorkingDay(addDaysToKey(today, 1));

  // Handling 0 ships on the start day; transit 0 is same-day delivery.
  const earliest = calendar.addWorkingDays(calendar.addWorkingDays(start, handlingMin), transitMin);
  const latest = calendar.addWorkingDays(calendar.addWorkingDays(start, handlingMax), transitMax);
  if (daysBetweenKeys(today, latest) > MAX_ESTIMATE_SPAN_DAYS) return null;

  return {
    today,
    start,
    earliest,
    latest,
    orderedToday,
    cutoff: config.cutoff.text,
    cutoffMinutesLeft: orderedToday ? config.cutoff.minutes - minuteOfDay : 0,
  };
};

/* ---------- wording (browser and AI replies share it) ---------- */

const dateFromKey = (dateKey) => new Date(`${dateKey}T12:00:00Z`);

// Latin digits on purpose: the storefront prints prices and dates with them.
const localeFor = (language = "ar") => (String(language).startsWith("ar") ? "ar-EG-u-nu-latn" : "en-GB");

export const formatEstimateDay = (dateKey, language = "ar", { month = true } = {}) => {
  if (!isDateKey(dateKey)) return "";
  // Assembled from parts: engines disagree on the comma after the weekday
  // ("الثلاثاء، 15 سبتمبر"), and the sentence reads better without it.
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat(localeFor(language), { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })
      .formatToParts(dateFromKey(dateKey))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return [parts.weekday, parts.day, month ? parts.month : ""].filter(Boolean).join(" ");
};

/**
 * The parts a sentence needs: `{ kind: "day" | "range", day | from + to, relative }`.
 * `relative` is "today" / "tomorrow" when the single day is that close.
 */
export const describeDeliveryEstimate = (estimate, language = "ar") => {
  if (!estimate || !isDateKey(estimate.earliest) || !isDateKey(estimate.latest)) return null;
  const { earliest, latest, today } = estimate;
  const relative = (dateKey) => {
    const gap = daysBetweenKeys(today, dateKey);
    return gap === 0 ? "today" : gap === 1 ? "tomorrow" : "";
  };
  if (earliest === latest) {
    return { kind: "day", day: formatEstimateDay(earliest, language), relative: relative(earliest) };
  }
  const sameMonth = earliest.slice(0, 7) === latest.slice(0, 7);
  return {
    kind: "range",
    from: formatEstimateDay(earliest, language, { month: !sameMonth }),
    to: formatEstimateDay(latest, language),
    relative: "",
  };
};

/** "2 س 15 د" / "2h 15m" — the time left to make today's cut-off. */
export const formatCutoffCountdown = (minutesLeft, language = "ar") => {
  const total = Math.max(0, Math.floor(Number(minutesLeft) || 0));
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  const ar = String(language).startsWith("ar");
  const h = hours ? (ar ? `${hours} س` : `${hours}h`) : "";
  const m = minutes || !hours ? (ar ? `${minutes} د` : `${minutes}m`) : "";
  return [h, m].filter(Boolean).join(" ");
};

/** One plain sentence for places without React (AI replies, order notes). */
export const deliveryEstimateSentence = (estimate, language = "ar") => {
  const parts = describeDeliveryEstimate(estimate, language);
  if (!parts) return "";
  const ar = String(language).startsWith("ar");
  if (parts.kind === "day") return ar ? `متوقع وصول طلبك ${parts.day}` : `Estimated delivery ${parts.day}`;
  return ar ? `متوقع وصول طلبك بين ${parts.from} و${parts.to}` : `Estimated delivery between ${parts.from} and ${parts.to}`;
};
