import db from "../database/db.js";
import {
  buildAiMarketingPostingInsightsResponse,
  countThemeStoriesForDate,
  enqueueAiMarketingBatchGeneration,
  ensureAiMarketingCenterSchema,
  getAiMarketingSettings,
  publishAiMarketingQueueItemNow,
  themeDateKey,
} from "./aiMarketingCenterService.js";

const AUTOPILOT_ADVISORY_LOCK = 74017211;
const RUNNER_INTERVAL_MS = Number(process.env.AI_STORY_AUTOPILOT_INTERVAL_MS || 60 * 1000);

const cleanText = (value) => String(value ?? "").trim();
const boolValue = (value, fallback) => (value === undefined || value === null ? fallback : value === true || value === "true" || value === 1 || value === "1");
const intValue = (value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
};

const jsonObject = (value, fallback = {}) => {
  if (!value) return fallback;
  if (typeof value === "object" && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
};

const jsonArray = (value, fallback = []) => {
  if (Array.isArray(value)) return value;
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
};

/* ------------------------------------------------------------------ *
 * Facebook story timing baseline
 *
 * Slots are the publicly documented engagement peaks for Facebook/Meta
 * stories on an Egypt/MENA audience. They are only the fallback: once the
 * tenant has real page insights, `buildSuggestedStorySlots` blends the
 * measured best hours on top of this baseline.
 * ------------------------------------------------------------------ */
export const FACEBOOK_STORY_SLOT_BASELINE = [
  { time: "08:30", score: 62, label: "صباح الشغل", reason: "أول تصفح بعد الصحيان وفي المواصلات" },
  { time: "12:30", score: 74, label: "بريك الضهر", reason: "ذروة تصفح وقت الراحة والغداء" },
  { time: "15:30", score: 68, label: "العصر", reason: "فترة هدوء بعد الشغل وقبل الزحمة" },
  { time: "18:30", score: 86, label: "بعد الشغل", reason: "رجوع البيت وأعلى معدل فتح للاستوري" },
  { time: "21:00", score: 100, label: "الذروة", reason: "أعلى وقت تفاعل ومشاهدات في اليوم" },
  { time: "23:00", score: 71, label: "قبل النوم", reason: "تصفح متأخر بمعدل إتمام مشاهدة عالي" },
];

const DAY_LABELS = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
const DAY_BASELINE_WEIGHT = { 0: 0.86, 1: 0.82, 2: 0.86, 3: 0.9, 4: 1, 5: 0.96, 6: 0.92 };

export const STORY_AUTOPILOT_DEFAULTS = {
  enabled: false,
  platforms: ["facebook"],
  schedule_mode: "suggested_slots",
  slots: ["12:30", "18:30", "21:00"],
  active_days: [0, 1, 2, 3, 4, 5, 6],
  window_start: "09:00",
  window_end: "23:30",
  timezone: "Africa/Cairo",
  max_per_day: 6,
  max_per_run: 1,
  min_gap_minutes: 45,
  slot_grace_minutes: 20,
  catchup_grace_minutes: 120,
  require_approval: false,
  skip_without_generated_asset: true,
  max_retries: 2,
  retry_backoff_minutes: 30,
  follow_insights: true,
  // Full autopilot: the scan itself keeps the upcoming days generated (products
  // picked by the theme calendar, times stamped from Meta insights) so nobody
  // has to click "إنشاء الطابور" ever again.
  auto_generate: false,
  auto_generate_days_ahead: 1,
};

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

const normalizeTime = (value, fallback) => {
  const raw = cleanText(value);
  if (TIME_PATTERN.test(raw)) return raw;
  const short = /^(\d{1,2}):(\d{1,2})$/.exec(raw);
  if (short) {
    const hour = intValue(short[1], -1, { min: 0, max: 23 });
    const minute = intValue(short[2], -1, { min: 0, max: 59 });
    if (hour >= 0 && minute >= 0) return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }
  return fallback;
};

const timeToMinutes = (value) => {
  const normalized = normalizeTime(value, "");
  if (!normalized) return null;
  const [hour, minute] = normalized.split(":").map(Number);
  return hour * 60 + minute;
};

const minutesToTime = (minutes) => {
  const safe = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
};

const normalizePlatforms = (value, fallback = STORY_AUTOPILOT_DEFAULTS.platforms) => {
  const allowed = ["facebook", "instagram"];
  const list = jsonArray(value, []).map((entry) => cleanText(entry).toLowerCase()).filter((entry) => allowed.includes(entry));
  return list.length ? Array.from(new Set(list)) : fallback;
};

const normalizeDays = (value, fallback = STORY_AUTOPILOT_DEFAULTS.active_days) => {
  const list = jsonArray(value, [])
    .map((entry) => intValue(entry, -1, { min: 0, max: 6 }))
    .filter((entry) => entry >= 0 && entry <= 6);
  return list.length ? Array.from(new Set(list)).sort((a, b) => a - b) : fallback;
};

const normalizeSlots = (value, fallback = STORY_AUTOPILOT_DEFAULTS.slots) => {
  const list = jsonArray(value, [])
    .map((entry) => normalizeTime(typeof entry === "object" ? entry?.time : entry, ""))
    .filter(Boolean);
  return list.length ? Array.from(new Set(list)).sort((a, b) => timeToMinutes(a) - timeToMinutes(b)).slice(0, 12) : fallback;
};

const normalizeTimezone = (value, fallback = STORY_AUTOPILOT_DEFAULTS.timezone) => {
  const raw = cleanText(value);
  if (!raw) return fallback;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: raw }).format(new Date());
    return raw;
  } catch {
    return fallback;
  }
};

export const normalizeStoryAutopilotConfig = (input = {}, base = STORY_AUTOPILOT_DEFAULTS) => {
  const config = jsonObject(input, {});
  return {
    enabled: boolValue(config.enabled, base.enabled),
    platforms: normalizePlatforms(config.platforms, base.platforms),
    schedule_mode: ["suggested_slots", "queue_schedule"].includes(config.schedule_mode) ? config.schedule_mode : base.schedule_mode,
    slots: normalizeSlots(config.slots, base.slots),
    active_days: normalizeDays(config.active_days, base.active_days),
    window_start: normalizeTime(config.window_start, base.window_start),
    window_end: normalizeTime(config.window_end, base.window_end),
    timezone: normalizeTimezone(config.timezone, base.timezone),
    // The owner sets every limit from the UI; these bounds are only runaway guards,
    // deliberately far wider than any value the settings screen offers.
    max_per_day: intValue(config.max_per_day, base.max_per_day, { min: 1, max: 500 }),
    max_per_run: intValue(config.max_per_run, base.max_per_run, { min: 1, max: 100 }),
    min_gap_minutes: intValue(config.min_gap_minutes, base.min_gap_minutes, { min: 0, max: 1440 }),
    slot_grace_minutes: intValue(config.slot_grace_minutes, base.slot_grace_minutes, { min: 1, max: 1440 }),
    catchup_grace_minutes: intValue(config.catchup_grace_minutes, base.catchup_grace_minutes, { min: 0, max: 10080 }),
    require_approval: boolValue(config.require_approval, base.require_approval),
    skip_without_generated_asset: boolValue(config.skip_without_generated_asset, base.skip_without_generated_asset),
    max_retries: intValue(config.max_retries, base.max_retries, { min: 0, max: 50 }),
    retry_backoff_minutes: intValue(config.retry_backoff_minutes, base.retry_backoff_minutes, { min: 1, max: 1440 }),
    follow_insights: boolValue(config.follow_insights, base.follow_insights),
    auto_generate: boolValue(config.auto_generate, base.auto_generate),
    auto_generate_days_ahead: intValue(config.auto_generate_days_ahead, base.auto_generate_days_ahead, { min: 1, max: 7 }),
  };
};

/* ------------------------------------------------------------------ *
 * Schema
 * ------------------------------------------------------------------ */
let autopilotSchemaReady = false;
let autopilotSchemaPromise = null;

const applyStoryAutopilotSchema = async () => {
  // The base tables (and their defaults) belong to the AI Marketing Center; we only
  // extend them, so let that schema run first instead of half-creating them here.
  await ensureAiMarketingCenterSchema();
  await db.query(`
    ALTER TABLE IF EXISTS ai_marketing_settings
      ADD COLUMN IF NOT EXISTS story_autopilot_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS story_autopilot_config JSONB NOT NULL DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS story_autopilot_state JSONB NOT NULL DEFAULT '{}'::jsonb
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS ai_marketing_story_autopilot_log (
      id BIGSERIAL PRIMARY KEY,
      tenant_id BIGINT NOT NULL,
      queue_id BIGINT NULL,
      event_type VARCHAR(60) NOT NULL,
      status VARCHAR(30) NOT NULL DEFAULT 'info',
      message TEXT NOT NULL DEFAULT '',
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await db.query(
    `CREATE INDEX IF NOT EXISTS idx_ai_story_autopilot_log_tenant ON ai_marketing_story_autopilot_log (tenant_id, created_at DESC)`
  );
};

export const ensureStoryAutopilotSchema = async () => {
  if (autopilotSchemaReady) return;
  if (!autopilotSchemaPromise) {
    autopilotSchemaPromise = applyStoryAutopilotSchema()
      .then(() => {
        autopilotSchemaReady = true;
      })
      .catch((error) => {
        autopilotSchemaPromise = null;
        throw error;
      });
  }
  await autopilotSchemaPromise;
};

const writeAutopilotLog = async ({ tenantId, queueId = null, eventType, status = "info", message = "", metadata = {} }) => {
  try {
    await db.query(
      `
      INSERT INTO ai_marketing_story_autopilot_log (tenant_id, queue_id, event_type, status, message, metadata)
      VALUES ($1::bigint, $2::bigint, $3::text, $4::text, $5::text, $6::jsonb)
      `,
      [tenantId, queueId, eventType, status, cleanText(message).slice(0, 800), JSON.stringify(metadata || {})]
    );
  } catch (error) {
    console.warn("[story-autopilot] log write failed", { message: error?.message || String(error) });
  }
};

/* ------------------------------------------------------------------ *
 * Timezone helpers — DB timestamps are treated as UTC instants.
 * ------------------------------------------------------------------ */
const zonedParts = (date, timeZone) => {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const parts = formatter.formatToParts(date).reduce((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});
  const weekdayIndex = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday);
  const hour = Number(parts.hour) % 24;
  const minute = Number(parts.minute);
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour,
    minute,
    weekday: weekdayIndex < 0 ? date.getUTCDay() : weekdayIndex,
    minutesOfDay: hour * 60 + minute,
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
  };
};

const zoneOffsetMinutes = (date, timeZone) => {
  const parts = zonedParts(date, timeZone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0, 0);
  return Math.round((asUtc - Math.floor(date.getTime() / 60000) * 60000) / 60000);
};

const zonedInstant = (referenceDate, timeZone, { dayOffset = 0, minutesOfDay = 0 } = {}) => {
  const parts = zonedParts(referenceDate, timeZone);
  const offset = zoneOffsetMinutes(referenceDate, timeZone);
  const utcMidnight = Date.UTC(parts.year, parts.month - 1, parts.day, 0, 0, 0, 0);
  return new Date(utcMidnight + (dayOffset * 1440 + minutesOfDay - offset) * 60000);
};

const isWithinWindow = (minutesOfDay, startMinutes, endMinutes) => {
  if (startMinutes === null || endMinutes === null) return true;
  if (startMinutes <= endMinutes) return minutesOfDay >= startMinutes && minutesOfDay <= endMinutes;
  return minutesOfDay >= startMinutes || minutesOfDay <= endMinutes;
};

/* ------------------------------------------------------------------ *
 * Settings access
 * ------------------------------------------------------------------ */
const readAutopilotRow = async (tenantId) => {
  const result = await db.query(
    `
    SELECT tenant_id, active, story_autopilot_enabled, story_autopilot_config, story_autopilot_state
    FROM ai_marketing_settings
    WHERE tenant_id = $1::bigint
    LIMIT 1
    `,
    [tenantId]
  );
  return result.rows[0] || null;
};

export const getStoryAutopilotSettings = async (tenantId) => {
  await ensureStoryAutopilotSchema();
  const row = await readAutopilotRow(tenantId);
  const config = normalizeStoryAutopilotConfig({
    ...jsonObject(row?.story_autopilot_config, {}),
    enabled: row?.story_autopilot_enabled === true,
  });
  return {
    ...config,
    engine_active: row ? row.active !== false : true,
    state: jsonObject(row?.story_autopilot_state, {}),
  };
};

export const updateStoryAutopilotSettings = async (tenantId, patch = {}, { silent = false } = {}) => {
  await ensureStoryAutopilotSchema();
  const currentConfig = { ...(await getStoryAutopilotSettings(tenantId)) };
  delete currentConfig.state;
  const next = normalizeStoryAutopilotConfig({ ...currentConfig, ...jsonObject(patch, {}) }, currentConfig);

  const result = await db.query(
    `
    INSERT INTO ai_marketing_settings (tenant_id, story_autopilot_enabled, story_autopilot_config)
    VALUES ($1::bigint, $2::boolean, $3::jsonb)
    ON CONFLICT (tenant_id) DO UPDATE
      SET story_autopilot_enabled = EXCLUDED.story_autopilot_enabled,
          story_autopilot_config = EXCLUDED.story_autopilot_config,
          updated_at = CURRENT_TIMESTAMP
    RETURNING tenant_id, story_autopilot_enabled, story_autopilot_config, story_autopilot_state
    `,
    [tenantId, next.enabled, JSON.stringify(next)]
  );
  // silent = an internal self-adjustment (daily slot refresh, auto-generation
  // alignment); those write their own specific log events instead of spamming
  // the feed with a generic "settings updated" every day.
  if (!silent) {
    await writeAutopilotLog({
      tenantId,
      eventType: "settings_updated",
      status: "info",
      message: next.enabled ? "تم تفعيل النشر التلقائي للاستوري." : "تم إيقاف النشر التلقائي للاستوري.",
      metadata: { enabled: next.enabled, schedule_mode: next.schedule_mode, slots: next.slots, platforms: next.platforms },
    });
  }
  const row = result.rows[0] || null;
  return { ...next, state: jsonObject(row?.story_autopilot_state, {}) };
};

const mergeAutopilotState = async (tenantId, patch = {}) => {
  await db.query(
    `
    UPDATE ai_marketing_settings
    SET story_autopilot_state = COALESCE(story_autopilot_state, '{}'::jsonb) || $2::jsonb,
        updated_at = CURRENT_TIMESTAMP
    WHERE tenant_id = $1::bigint
    `,
    [tenantId, JSON.stringify(patch)]
  );
};

/* ------------------------------------------------------------------ *
 * Suggested posting times
 * ------------------------------------------------------------------ */
const snapToSlot = (hour, minute = 0) => minutesToTime(Math.round((hour * 60 + minute) / 15) * 15);

export const buildSuggestedStorySlots = async ({ tenantId, count = 4, timezone = STORY_AUTOPILOT_DEFAULTS.timezone } = {}) => {
  let insights = null;
  try {
    const response = await buildAiMarketingPostingInsightsResponse({ tenantId, force: false });
    insights = response?.insights || response?.data || response || null;
  } catch (error) {
    console.warn("[story-autopilot] posting insights unavailable", { message: error?.message || String(error) });
  }

  const measuredHours = Array.isArray(insights?.best_hours) ? insights.best_hours : [];
  const source = cleanText(insights?.source || "fallback");
  const hasMeasured = source && source !== "fallback" && measuredHours.length > 0;

  const scored = new Map();
  FACEBOOK_STORY_SLOT_BASELINE.forEach((slot) => {
    scored.set(slot.time, { ...slot, source: "facebook_baseline" });
  });

  if (hasMeasured) {
    const maxScore = measuredHours.reduce((max, row) => Math.max(max, Number(row?.score || row?.value || 0)), 0) || 1;
    measuredHours.slice(0, 8).forEach((row) => {
      const hour = intValue(row?.hour ?? row?.hour_of_day, -1, { min: 0, max: 23 });
      if (hour < 0) return;
      const minute = intValue(row?.minute, 0, { min: 0, max: 59 });
      const time = snapToSlot(hour, minute);
      const measuredScore = Math.round((Number(row?.score || row?.value || 0) / maxScore) * 100);
      const existing = scored.get(time);
      scored.set(time, {
        time,
        score: Math.max(measuredScore, existing ? Math.round(existing.score * 0.6) : 0),
        label: existing?.label || "وقت مُقاس من صفحتك",
        reason: existing
          ? `${existing.reason} — ومؤكد من تفاعل صفحتك الفعلي`
          : "أعلى تفاعل مسجَّل على صفحتك في هذه الساعة",
        source: "page_insights",
      });
    });
  }

  const slots = Array.from(scored.values())
    .sort((a, b) => b.score - a.score || timeToMinutes(a.time) - timeToMinutes(b.time))
    .slice(0, Math.max(1, Math.min(8, count)))
    .sort((a, b) => timeToMinutes(a.time) - timeToMinutes(b.time));

  const measuredDays = Array.isArray(insights?.best_days) ? insights.best_days : [];
  const dayScoreMap = new Map(
    measuredDays
      .map((row) => [intValue(row?.day ?? row?.day_of_week, -1, { min: 0, max: 6 }), Number(row?.score || row?.value || 0)])
      .filter(([day]) => day >= 0)
  );
  const maxDayScore = Math.max(1, ...Array.from(dayScoreMap.values()));
  const days = DAY_LABELS.map((label, day) => ({
    day,
    label,
    score: dayScoreMap.has(day)
      ? Math.round((dayScoreMap.get(day) / maxDayScore) * 100)
      : Math.round(DAY_BASELINE_WEIGHT[day] * 100),
    source: dayScoreMap.has(day) ? "page_insights" : "facebook_baseline",
  }));

  return {
    slots,
    days,
    timezone: normalizeTimezone(timezone),
    source: hasMeasured ? "page_insights" : "facebook_baseline",
    measured_hours: hasMeasured ? measuredHours.length : 0,
    generated_at: new Date().toISOString(),
  };
};

export const applySuggestedStorySlots = async (tenantId, { count, silent = false } = {}) => {
  const current = await getStoryAutopilotSettings(tenantId);
  const suggestion = await buildSuggestedStorySlots({
    tenantId,
    count: intValue(count, Math.min(current.max_per_day, 4), { min: 1, max: 8 }),
    timezone: current.timezone,
  });
  // Only the times are applied — max_per_day and the rest stay exactly as the owner set them.
  const slots = suggestion.slots.map((slot) => slot.time);
  const settings = await updateStoryAutopilotSettings(tenantId, { slots }, { silent });
  await writeAutopilotLog({
    tenantId,
    eventType: "suggested_slots_applied",
    status: "success",
    message: "تم تطبيق الأوقات المقترحة.",
    metadata: { slots, source: suggestion.source },
  });
  return { settings, suggestion };
};

/* ------------------------------------------------------------------ *
 * Due-slot resolution
 * ------------------------------------------------------------------ */
const dueSlotFor = ({ config, now, lastPublishedAt }) => {
  const parts = zonedParts(now, config.timezone);
  if (!config.active_days.includes(parts.weekday)) {
    return { due: false, reason: "inactive_day", localTime: minutesToTime(parts.minutesOfDay), weekday: parts.weekday };
  }
  const windowStart = timeToMinutes(config.window_start);
  const windowEnd = timeToMinutes(config.window_end);
  if (!isWithinWindow(parts.minutesOfDay, windowStart, windowEnd)) {
    return { due: false, reason: "outside_window", localTime: minutesToTime(parts.minutesOfDay), weekday: parts.weekday };
  }

  if (config.schedule_mode === "queue_schedule") {
    return { due: true, reason: "queue_schedule", slot: null, localTime: minutesToTime(parts.minutesOfDay), weekday: parts.weekday };
  }

  const lastMinutes = lastPublishedAt ? zonedParts(new Date(lastPublishedAt), config.timezone) : null;
  const sameDay = lastMinutes && lastMinutes.dateKey === parts.dateKey;
  const slot = config.slots
    .map((time) => ({ time, minutes: timeToMinutes(time) }))
    .filter((entry) => entry.minutes !== null)
    .filter((entry) => parts.minutesOfDay >= entry.minutes && parts.minutesOfDay <= entry.minutes + config.slot_grace_minutes)
    .sort((a, b) => b.minutes - a.minutes)[0];

  if (!slot) {
    return { due: false, reason: "no_due_slot", localTime: minutesToTime(parts.minutesOfDay), weekday: parts.weekday };
  }
  if (sameDay && lastMinutes.minutesOfDay >= slot.minutes) {
    return { due: false, reason: "slot_already_served", slot: slot.time, localTime: minutesToTime(parts.minutesOfDay), weekday: parts.weekday };
  }
  return { due: true, reason: "slot_due", slot: slot.time, localTime: minutesToTime(parts.minutesOfDay), weekday: parts.weekday };
};

export const nextStorySlotAt = (config, now = new Date()) => {
  if (config.schedule_mode !== "suggested_slots" || !config.slots.length) return null;
  const parts = zonedParts(now, config.timezone);
  for (let dayOffset = 0; dayOffset < 8; dayOffset += 1) {
    const weekday = (parts.weekday + dayOffset) % 7;
    if (!config.active_days.includes(weekday)) continue;
    const candidate = config.slots
      .map((time) => timeToMinutes(time))
      .filter((minutes) => minutes !== null)
      .filter((minutes) => dayOffset > 0 || minutes > parts.minutesOfDay)
      .sort((a, b) => a - b)[0];
    if (candidate === undefined) continue;
    return zonedInstant(now, config.timezone, { dayOffset, minutesOfDay: candidate }).toISOString();
  }
  return null;
};

/* ------------------------------------------------------------------ *
 * Candidate selection
 * ------------------------------------------------------------------ */
const publishedTodayCount = async (tenantId, config, now) => {
  const dayStart = zonedInstant(now, config.timezone, { dayOffset: 0, minutesOfDay: 0 });
  const result = await db.query(
    `
    SELECT COUNT(*)::int AS total
    FROM ai_marketing_content_queue
    WHERE tenant_id = $1::bigint
      AND content_type = 'story'
      AND status = 'published'
      AND published_at >= $2::timestamp
      -- Manual "انشر العروض" pushes ride on top of the automatic quota, so they
      -- neither consume the daily cap nor block the themed stories behind them.
      AND COALESCE(metadata->>'offers_push', '') <> 'true'
    `,
    [tenantId, dayStart.toISOString()]
  );
  return Number(result.rows[0]?.total || 0);
};

const lastStoryPublishAt = async (tenantId) => {
  const result = await db.query(
    `
    -- Queue timestamps are stored as UTC wall clock in a timestamp column; the
    -- AT TIME ZONE cast makes the driver hand back the correct absolute instant
    -- no matter what timezone the Node process runs in.
    SELECT (published_at AT TIME ZONE 'UTC') AS published_at
    FROM ai_marketing_content_queue
    WHERE tenant_id = $1::bigint
      AND content_type = 'story'
      AND status = 'published'
      AND published_at IS NOT NULL
    ORDER BY published_at DESC
    LIMIT 1
    `,
    [tenantId]
  );
  return result.rows[0]?.published_at || null;
};

const eligibleStoryItems = async (tenantId, config, now, { limit = 5, offersPushOnly = false } = {}) => {
  const params = [tenantId, limit];
  const clauses = [
    "q.tenant_id = $1::bigint",
    "q.content_type = 'story'",
    // Once the daily cap is spent, only manually pushed offers may still flow.
    ...(offersPushOnly ? ["q.metadata->>'offers_push' = 'true'"] : []),
    // `publish_failed` belongs here: a publish that lost to a transient Meta
    // answer — a rate limit, a 5xx — is exactly what `max_retries` and
    // `retry_backoff_minutes` below were written for. Without it those two
    // settings were dead config, every failure needed a human to click retry, and
    // the queue quietly filled with stories that would never go out.
    "q.status IN ('ready', 'generated', 'scheduled', 'publish_failed')",
    "COALESCE(q.publish_status, '') NOT IN ('published', 'publishing', 'queued_publish')",
  ];

  if (config.schedule_mode === "queue_schedule") {
    params.push(now.toISOString());
    clauses.push(`q.scheduled_at IS NOT NULL AND q.scheduled_at <= $${params.length}::timestamp`);
    if (config.catchup_grace_minutes > 0) {
      params.push(new Date(now.getTime() - config.catchup_grace_minutes * 60000).toISOString());
      clauses.push(`q.scheduled_at >= $${params.length}::timestamp`);
    }
  }

  if (config.require_approval) {
    clauses.push(`EXISTS (
      SELECT 1 FROM ai_marketing_content_timeline t
      WHERE t.queue_id = q.id AND t.tenant_id = q.tenant_id AND t.action = 'approved'
    )`);
  }

  params.push(config.max_retries);
  clauses.push(`COALESCE(q.publish_attempts, 0) <= $${params.length}::int`);

  params.push(new Date(now.getTime() - config.retry_backoff_minutes * 60000).toISOString());
  clauses.push(`(q.last_publish_attempt_at IS NULL OR q.last_publish_attempt_at <= $${params.length}::timestamp)`);

  const result = await db.query(
    `
    SELECT q.id, q.product_id, q.variant_id, q.title, q.scheduled_at, q.publish_attempts,
           q.final_asset_url, q.rendered_image_url, q.story_image_url, q.metadata, q.design_json
    FROM ai_marketing_content_queue q
    WHERE ${clauses.join(" AND ")}
    ORDER BY q.scheduled_at ASC NULLS LAST, q.created_at ASC
    LIMIT $2::int
    `,
    params
  );
  return result.rows;
};

const hasGeneratedAsset = (row = {}) => {
  const metadata = jsonObject(row.metadata, {});
  const design = jsonObject(row.design_json, {});
  const snapshot = jsonObject(metadata.story_asset_snapshot || design.story_asset_snapshot, {});
  const url = cleanText(snapshot.assetUrl || snapshot.asset_url || row.final_asset_url || row.rendered_image_url || row.story_image_url);
  return Boolean(url);
};

/* ------------------------------------------------------------------ *
 * Auto-generation — the "full autopilot" half.
 *
 * The publish runner below only ever drains a queue someone filled. This keeps
 * the queue filled: every scan, each upcoming day inside the horizon that has
 * no scheduled stories yet gets one sized generation run (products chosen by
 * the theme calendar's own cycles, times stamped from the Meta insight
 * windows), and the publish config is widened so the day actually fits.
 * Day math is deliberately SERVER-local — the exact clock
 * buildThemeCalendarStories and scheduledTimeFor plan with.
 * ------------------------------------------------------------------ */
const serverDayStart = (now, offset = 0) => {
  const base = new Date(now.getTime());
  base.setHours(0, 0, 0, 0);
  return new Date(base.getTime() + offset * 86400000);
};

const scheduledStoriesCountBetween = async (tenantId, from, to) => {
  const result = await db.query(
    `
    SELECT COUNT(*)::int AS total
    FROM ai_marketing_content_queue
    WHERE tenant_id = $1::bigint
      AND content_type = 'story'
      AND status <> 'archived'
      AND scheduled_at >= $2::timestamp
      AND scheduled_at < $3::timestamp
    `,
    [tenantId, from.toISOString(), to.toISOString()]
  );
  return Number(result.rows[0]?.total || 0);
};

const maybeRunAutoGeneration = async (tenantId, config, now) => {
  const state = jsonObject(config.state, {});
  const ledger = jsonObject(state.auto_generated_days, {});
  const outcome = { fired: [], skipped: [] };

  const engineSettings = await getAiMarketingSettings(tenantId);
  if (engineSettings.active === false) return outcome;

  const cutoffKey = themeDateKey(serverDayStart(now, -14));
  for (const key of Object.keys(ledger)) {
    if (key < cutoffKey) delete ledger[key];
  }

  // Offset 0 is the first-activation case: the day it gets switched on, today
  // itself is usually empty. It only fires while today's window still has real
  // room (≥2h before window end) and the server's "today" IS the tenant's
  // "today" — around midnight they disagree and a run would schedule into
  // hours the tenant already finished.
  const tenantParts = zonedParts(now, config.timezone);
  const windowEndMinutes = timeToMinutes(config.window_end) ?? 1410;
  const todayStillUseful =
    tenantParts.dateKey === themeDateKey(serverDayStart(now, 0)) && tenantParts.minutesOfDay <= windowEndMinutes - 120;

  let maxNeeded = 0;
  for (let offset = 0; offset <= config.auto_generate_days_ahead; offset += 1) {
    if (offset === 0 && !todayStillUseful) continue;
    const target = serverDayStart(now, offset);
    const dateKey = themeDateKey(target);
    if (ledger[dateKey]) continue;

    const needed = engineSettings.story_selection_mode === "theme_calendar"
      ? countThemeStoriesForDate(engineSettings, target)
      : intValue(engineSettings.stories_per_day, 12, { min: 0, max: 200 });
    if (needed <= 0) {
      ledger[dateKey] = { skipped: "no_blocks_for_day", at: now.toISOString() };
      outcome.skipped.push({ date: dateKey, reason: "no_blocks_for_day" });
      continue;
    }

    const existing = await scheduledStoriesCountBetween(tenantId, target, serverDayStart(now, offset + 1));
    if (existing > 0) {
      // Someone (a manual plan, an earlier run) already covered this day.
      ledger[dateKey] = { skipped: "already_scheduled", existing, at: now.toISOString() };
      outcome.skipped.push({ date: dateKey, reason: "already_scheduled", existing });
      continue;
    }

    const run = await enqueueAiMarketingBatchGeneration({
      tenantId,
      runType: "plan",
      plan: { days: 1, start_offset: offset, stories_per_day: Math.min(40, needed), posts_per_day: 0 },
    });
    ledger[dateKey] = { run_id: run.run_id, requested: needed, at: now.toISOString() };
    outcome.fired.push({ date: dateKey, run_id: run.run_id, requested: needed });
    maxNeeded = Math.max(maxNeeded, needed);
    await writeAutopilotLog({
      tenantId,
      eventType: "auto_generation_started",
      status: "success",
      message: `تم تجهيز استوريهات يوم ${dateKey} تلقائيًا (${needed} استوري).`,
      metadata: { date: dateKey, run_id: run.run_id, requested: needed, selection_mode: engineSettings.story_selection_mode },
    });
  }

  if (outcome.fired.length || outcome.skipped.length) {
    await mergeAutopilotState(tenantId, { auto_generated_days: ledger, last_auto_generation_at: now.toISOString() });
  }

  // Widen the publish config so the generated day can actually go out: the
  // queue's own timestamps drive publishing, the cap covers the day's volume,
  // and late renders survive the catch-up window.
  if (outcome.fired.length && maxNeeded > 0) {
    const aligned = {};
    if (config.schedule_mode !== "queue_schedule") aligned.schedule_mode = "queue_schedule";
    if (config.max_per_day < maxNeeded) aligned.max_per_day = maxNeeded;
    if (config.catchup_grace_minutes < 240) aligned.catchup_grace_minutes = 240;
    const windowStart = timeToMinutes(config.window_start) ?? 540;
    const windowEnd = timeToMinutes(config.window_end) ?? 1410;
    const windowMinutes = Math.max(60, windowEnd - windowStart);
    const fittingGap = Math.max(5, Math.floor(windowMinutes / Math.max(1, maxNeeded * 2)));
    if (config.min_gap_minutes > fittingGap) aligned.min_gap_minutes = fittingGap;
    if (Object.keys(aligned).length) {
      await updateStoryAutopilotSettings(tenantId, aligned, { silent: true });
      await writeAutopilotLog({
        tenantId,
        eventType: "auto_generation_aligned",
        status: "info",
        message: "تم ضبط إعدادات النشر تلقائيًا على مواعيد الطابور.",
        metadata: aligned,
      });
    }
  }

  return outcome;
};

// suggested_slots mode publishes at fixed times — when the owner opted into
// follow_insights those times re-derive themselves from the page's measured
// engagement once a day instead of waiting for a manual "طبّق الأوقات".
const maybeRefreshInsightSlots = async (tenantId, config, now) => {
  if (config.schedule_mode !== "suggested_slots" || !config.follow_insights) return false;
  const todayKey = zonedParts(now, config.timezone).dateKey;
  const state = jsonObject(config.state, {});
  if (state.last_insight_slot_refresh_date === todayKey) return false;
  await applySuggestedStorySlots(tenantId, { silent: true });
  await mergeAutopilotState(tenantId, { last_insight_slot_refresh_date: todayKey });
  return true;
};

/* ------------------------------------------------------------------ *
 * Runner
 * ------------------------------------------------------------------ */
export const runStoryAutopilotForTenant = async (tenantId, { trigger = "scheduler", force = false } = {}) => {
  await ensureStoryAutopilotSchema();
  const now = new Date();
  const config = await getStoryAutopilotSettings(tenantId);
  const summary = { tenant_id: tenantId, trigger, published: [], failed: [], skipped: [], config_slot: null };

  if (!config.enabled && !force) {
    summary.skipped.push({ reason: "autopilot_disabled" });
    return summary;
  }
  if (config.engine_active === false) {
    // The AI Marketing Center itself is paused — the autopilot must not override that.
    summary.skipped.push({ reason: "engine_paused" });
    return summary;
  }

  // The self-maintaining half runs before any slot gating: keeping tomorrow
  // generated and the slot times fresh must not wait for a publish moment.
  if (config.auto_generate) {
    try {
      summary.auto_generation = await maybeRunAutoGeneration(tenantId, config, now);
    } catch (error) {
      console.warn("[story-autopilot] auto-generation failed", { tenant_id: tenantId, message: error?.message || String(error) });
      await writeAutopilotLog({
        tenantId,
        eventType: "auto_generation_failed",
        status: "failed",
        message: error?.message || "فشل التوليد التلقائي.",
      });
    }
  }
  try {
    await maybeRefreshInsightSlots(tenantId, config, now);
  } catch (error) {
    console.warn("[story-autopilot] insight slot refresh failed", { tenant_id: tenantId, message: error?.message || String(error) });
  }

  const lastPublishedAt = await lastStoryPublishAt(tenantId);
  const slotState = force ? { due: true, reason: "manual_run", slot: null } : dueSlotFor({ config, now, lastPublishedAt });
  summary.config_slot = slotState.slot || null;
  if (!slotState.due) {
    summary.skipped.push({ reason: slotState.reason, local_time: slotState.localTime });
    await mergeAutopilotState(tenantId, { last_run_at: now.toISOString(), last_skip_reason: slotState.reason });
    return summary;
  }

  if (config.min_gap_minutes > 0 && lastPublishedAt) {
    const gapMinutes = (now.getTime() - new Date(lastPublishedAt).getTime()) / 60000;
    if (gapMinutes < config.min_gap_minutes && !force) {
      summary.skipped.push({ reason: "min_gap_not_reached", gap_minutes: Math.round(gapMinutes) });
      await mergeAutopilotState(tenantId, { last_run_at: now.toISOString(), last_skip_reason: "min_gap_not_reached" });
      return summary;
    }
  }

  const alreadyPublished = await publishedTodayCount(tenantId, config, now);
  const remainingToday = Math.max(0, config.max_per_day - alreadyPublished);
  // The daily cap bounds the AUTOMATIC flow. Offers the owner pushed by hand
  // (metadata.offers_push) keep flowing past it — a human explicitly asked.
  const offersPushOnly = remainingToday === 0;

  const batchSize = offersPushOnly ? config.max_per_run : Math.min(config.max_per_run, remainingToday);
  const candidates = await eligibleStoryItems(tenantId, config, now, { limit: batchSize * 3, offersPushOnly });
  if (!candidates.length) {
    if (offersPushOnly) {
      summary.skipped.push({ reason: "daily_cap_reached", published_today: alreadyPublished });
      await mergeAutopilotState(tenantId, { last_run_at: now.toISOString(), last_skip_reason: "daily_cap_reached" });
      return summary;
    }
    summary.skipped.push({ reason: "no_eligible_story" });
    await mergeAutopilotState(tenantId, { last_run_at: now.toISOString(), last_skip_reason: "no_eligible_story" });
    await writeAutopilotLog({
      tenantId,
      eventType: "run_skipped",
      status: "skipped",
      message: "لا توجد استوريهات جاهزة للنشر التلقائي.",
      metadata: { slot: slotState.slot, schedule_mode: config.schedule_mode },
    });
    return summary;
  }

  await writeAutopilotLog({
    tenantId,
    eventType: "run_started",
    status: "info",
    message: `تشغيل النشر التلقائي (${trigger}).`,
    metadata: { slot: slotState.slot, batch_size: batchSize, candidates: candidates.length, platforms: config.platforms },
  });

  for (const candidate of candidates) {
    if (summary.published.length >= batchSize) break;
    if (config.skip_without_generated_asset && !hasGeneratedAsset(candidate)) {
      summary.skipped.push({ queue_id: candidate.id, reason: "missing_generated_asset" });
      continue;
    }
    try {
      await db.query(
        `
        UPDATE ai_marketing_content_queue
        SET metadata = COALESCE(metadata, '{}'::jsonb) || $3::jsonb,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $1::bigint AND tenant_id = $2::bigint
        `,
        [
          candidate.id,
          tenantId,
          JSON.stringify({
            published_by_autopilot: "true",
            autopilot_slot: slotState.slot || "",
            autopilot_trigger: trigger,
            autopilot_platforms: config.platforms,
            autopilot_attempted_at: now.toISOString(),
          }),
        ]
      );

      const result = await publishAiMarketingQueueItemNow(tenantId, candidate.id, {
        platforms: config.platforms,
        source: "story_autopilot",
      });
      const status = cleanText(result?.status || result?.publish_status || "");
      if (status === "published" || status === "partial_success") {
        summary.published.push({ queue_id: candidate.id, status, title: candidate.title || "" });
        await writeAutopilotLog({
          tenantId,
          queueId: candidate.id,
          eventType: "published",
          status: "success",
          message: "تم نشر الاستوري تلقائيًا.",
          metadata: { slot: slotState.slot, platforms: config.platforms, publish_status: status },
        });
      } else {
        summary.failed.push({ queue_id: candidate.id, error: result?.publish_error || result?.error_message || "publish_failed" });
        await writeAutopilotLog({
          tenantId,
          queueId: candidate.id,
          eventType: "publish_failed",
          status: "failed",
          message: cleanText(result?.publish_error || result?.error_message || "فشل النشر التلقائي."),
          metadata: { slot: slotState.slot, platforms: config.platforms, publish_status: status },
        });
      }
    } catch (error) {
      summary.failed.push({ queue_id: candidate.id, error: error?.message || String(error) });
      await writeAutopilotLog({
        tenantId,
        queueId: candidate.id,
        eventType: "publish_failed",
        status: "failed",
        message: error?.message || "فشل النشر التلقائي.",
        metadata: { slot: slotState.slot, platforms: config.platforms },
      });
    }
  }

  await mergeAutopilotState(tenantId, {
    last_run_at: now.toISOString(),
    last_slot: slotState.slot || "",
    last_skip_reason: summary.published.length ? "" : "publish_failed",
    ...(summary.published.length ? { last_published_at: new Date().toISOString() } : {}),
  });
  return summary;
};

let autopilotScanRunning = false;

export const runStoryAutopilotScan = async () => {
  if (autopilotScanRunning) return { skipped: true, reason: "already_running" };
  autopilotScanRunning = true;
  let lockAcquired = false;
  const totals = { tenants: 0, published: 0, failed: 0 };
  try {
    await ensureStoryAutopilotSchema();
    const lock = await db.query("SELECT pg_try_advisory_lock($1) AS locked", [AUTOPILOT_ADVISORY_LOCK]);
    lockAcquired = Boolean(lock.rows[0]?.locked);
    if (!lockAcquired) return { skipped: true, reason: "lock_busy" };

    const tenants = await db.query(
      `SELECT tenant_id FROM ai_marketing_settings WHERE story_autopilot_enabled = TRUE ORDER BY tenant_id ASC`
    );
    totals.tenants = tenants.rows.length;
    for (const row of tenants.rows) {
      try {
        const summary = await runStoryAutopilotForTenant(row.tenant_id, { trigger: "scheduler" });
        totals.published += summary.published.length;
        totals.failed += summary.failed.length;
      } catch (error) {
        totals.failed += 1;
        console.error("[story-autopilot] tenant run failed", { tenant_id: row.tenant_id, message: error?.message || String(error) });
      }
    }
    return totals;
  } catch (error) {
    console.error("[story-autopilot] scan error", error);
    return { error: error?.message || String(error), ...totals };
  } finally {
    if (lockAcquired) {
      try {
        await db.query("SELECT pg_advisory_unlock($1)", [AUTOPILOT_ADVISORY_LOCK]);
      } catch (unlockError) {
        console.warn("[story-autopilot] advisory unlock failed", unlockError?.message || unlockError);
      }
    }
    autopilotScanRunning = false;
  }
};

export const startStoryAutopilotRunner = () => {
  if (globalThis.__aiStoryAutopilotRunner?.started) return;
  const timer = setInterval(() => {
    void runStoryAutopilotScan().catch((error) => {
      console.error("[story-autopilot] scan crash", error);
    });
  }, RUNNER_INTERVAL_MS);
  if (typeof timer.unref === "function") timer.unref();
  globalThis.__aiStoryAutopilotRunner = { started: true, timer };
  console.log("[story-autopilot] runner started", { intervalMs: RUNNER_INTERVAL_MS });
  void runStoryAutopilotScan().catch(() => {});
};

export const stopStoryAutopilotRunner = () => {
  if (globalThis.__aiStoryAutopilotRunner?.timer) clearInterval(globalThis.__aiStoryAutopilotRunner.timer);
  globalThis.__aiStoryAutopilotRunner = { started: false, timer: null };
};

/* ------------------------------------------------------------------ *
 * Status for the UI
 * ------------------------------------------------------------------ */
export const getStoryAutopilotStatus = async (tenantId) => {
  await ensureStoryAutopilotSchema();
  const now = new Date();
  const settings = await getStoryAutopilotSettings(tenantId);
  const [publishedToday, lastPublishedAt, readyCount, logRows] = await Promise.all([
    publishedTodayCount(tenantId, settings, now),
    lastStoryPublishAt(tenantId),
    db
      .query(
        `
        SELECT COUNT(*)::int AS total
        FROM ai_marketing_content_queue
        WHERE tenant_id = $1::bigint
          AND content_type = 'story'
          AND status IN ('ready', 'generated', 'scheduled')
          AND COALESCE(publish_status, '') NOT IN ('published', 'publishing', 'queued_publish')
        `,
        [tenantId]
      )
      .then((result) => Number(result.rows[0]?.total || 0)),
    db
      .query(
        `
        SELECT queue_id, event_type, status, message, created_at
        FROM ai_marketing_story_autopilot_log
        WHERE tenant_id = $1::bigint
        ORDER BY created_at DESC
        LIMIT 12
        `,
        [tenantId]
      )
      .then((result) => result.rows),
  ]);

  const parts = zonedParts(now, settings.timezone);
  return {
    settings,
    status: {
      enabled: settings.enabled,
      local_time: minutesToTime(parts.minutesOfDay),
      local_day: DAY_LABELS[parts.weekday],
      timezone: settings.timezone,
      published_today: publishedToday,
      remaining_today: Math.max(0, settings.max_per_day - publishedToday),
      last_published_at: lastPublishedAt,
      last_run_at: settings.state?.last_run_at || null,
      last_skip_reason: settings.state?.last_skip_reason || "",
      ready_stories: readyCount,
      next_slot_at: nextStorySlotAt(settings, now),
      auto_generate: settings.auto_generate === true,
      auto_generate_days_ahead: settings.auto_generate_days_ahead,
      last_auto_generation_at: settings.state?.last_auto_generation_at || null,
      auto_generated_days: jsonObject(settings.state?.auto_generated_days, {}),
    },
    log: logRows,
  };
};

export default {
  ensureStoryAutopilotSchema,
  getStoryAutopilotSettings,
  updateStoryAutopilotSettings,
  getStoryAutopilotStatus,
  buildSuggestedStorySlots,
  applySuggestedStorySlots,
  runStoryAutopilotForTenant,
  runStoryAutopilotScan,
  startStoryAutopilotRunner,
  stopStoryAutopilotRunner,
};
