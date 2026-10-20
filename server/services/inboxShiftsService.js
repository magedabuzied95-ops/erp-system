import db from "../database/db.js";
import { getAppTimeZone, zonedParts } from "../utils/appTimezone.js";

/*
 * Inbox availability shifts (inbox top bar → Config → Shifts).
 *
 * When a colleague is "on" to answer customers: days of the week plus a start and end
 * wall-clock time on the shop's ONE Cairo clock (utils/appTimezone.js), optionally limited
 * to some channels. Team auto-distribution (inboxTeamsService) only hands a new chat to a
 * member who is on shift right now.
 *
 * Why not the HR shifts. `employee_shifts` / `employee_shift_schedules` are attendance
 * shifts: keyed by employee_id (not the login that answers chats), sized for the branch
 * floor (10h with late/overtime rules), dated per day by the opening rotation, and with no
 * notion of channels. Many people who answer the inbox (the owner, admins) have no employee
 * row at all. Reading them for chat availability would make "who answers WhatsApp tonight"
 * depend on who opens the shop tomorrow. So this is its own small model; HR is untouched.
 *
 * A shift whose end is earlier than (or equal to) its start crosses midnight: Thu 22:00–02:00
 * covers Thursday 22:00 → Friday 02:00 and belongs to Thursday in `days`. start == end means
 * the whole day.
 */

let schemaReady = null;

export const ensureInboxShiftsSchema = () => {
  schemaReady ||= (async () => {
    await db.query(`
      CREATE TABLE IF NOT EXISTS inbox_shifts (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL,
        name VARCHAR(120) NOT NULL,
        days JSONB NOT NULL DEFAULT '[0,1,2,3,4,5,6]'::jsonb,
        start_time VARCHAR(5) NOT NULL DEFAULT '09:00',
        end_time VARCHAR(5) NOT NULL DEFAULT '17:00',
        applies_to_all BOOLEAN NOT NULL DEFAULT TRUE,
        channels JSONB NOT NULL DEFAULT '[]'::jsonb,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS inbox_shift_members (
        shift_id INTEGER NOT NULL REFERENCES inbox_shifts(id) ON DELETE CASCADE,
        user_id BIGINT NOT NULL,
        user_name VARCHAR(160) NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (shift_id, user_id)
      )
    `);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_inbox_shifts_tenant ON inbox_shifts (tenant_id)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_inbox_shift_members_user ON inbox_shift_members (user_id)`);
  })().catch((error) => {
    schemaReady = null;
    throw error;
  });
  return schemaReady;
};

const httpError = (message, status = 400, code = "INBOX_SHIFT_ERROR") => Object.assign(new Error(message), { status, code });
const text = (value = "") => String(value ?? "").trim();
const tenantOf = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 1;
};

export const INBOX_CHANNELS = Object.freeze(["whatsapp", "facebook_messenger", "instagram", "telegram"]);

export const normalizeInboxChannel = (value = "") => {
  const lower = text(value).toLowerCase();
  if (!lower) return "";
  if (lower.includes("instagram")) return "instagram";
  if (lower.includes("messenger") || lower.includes("facebook")) return "facebook_messenger";
  if (lower.includes("whatsapp")) return "whatsapp";
  if (lower.includes("telegram")) return "telegram";
  return lower;
};

export const normalizeChannelList = (value) => {
  const list = Array.isArray(value) ? value : [];
  return [...new Set(list.map(normalizeInboxChannel).filter((channel) => INBOX_CHANNELS.includes(channel)))];
};

export const normalizeDays = (value) => {
  const list = Array.isArray(value) ? value : [];
  return [...new Set(list.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))].sort((a, b) => a - b);
};

// "9:5", "09:05", "09:05:00" → "09:05"; anything else → "".
export const normalizeClock = (value = "") => {
  const match = text(value).match(/^(\d{1,2}):(\d{1,2})(?::\d{1,2})?$/);
  if (!match) return "";
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return "";
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
};

const clockMinutes = (value) => {
  const clock = normalizeClock(value);
  if (!clock) return null;
  const [hours, minutes] = clock.split(":").map(Number);
  return hours * 60 + minutes;
};

/*
 * Pure: does this shift cover the instant `at`, read on the given zone's wall clock?
 * Takes the shift's own fields (days, start_time, end_time, is_active, applies_to_all,
 * channels) and an optional channel. No DB, no process clock — testable on its own.
 */
export const shiftCoversAt = (shift = {}, at = new Date(), { channel = "", timeZone = getAppTimeZone() } = {}) => {
  if (!shift || shift.is_active === false) return false;
  if (channel && shift.applies_to_all === false) {
    const channels = normalizeChannelList(shift.channels);
    if (!channels.includes(normalizeInboxChannel(channel))) return false;
  }
  const days = normalizeDays(shift.days);
  const start = clockMinutes(shift.start_time);
  const end = clockMinutes(shift.end_time);
  if (!days.length || start === null || end === null) return false;
  const parts = zonedParts(at, timeZone);
  if (!parts) return false;
  const minute = parts.hour * 60 + parts.minute;
  const today = parts.weekday;
  const yesterday = (today + 6) % 7;
  if (start === end) return days.includes(today);
  if (start < end) return days.includes(today) && minute >= start && minute < end;
  // Crosses midnight: the evening part belongs to today, the early-morning part to yesterday's shift.
  return (days.includes(today) && minute >= start) || (days.includes(yesterday) && minute < end);
};

const publicShift = (row = {}, members = []) => ({
  id: Number(row.id),
  name: text(row.name),
  days: normalizeDays(row.days),
  start_time: normalizeClock(row.start_time) || "09:00",
  end_time: normalizeClock(row.end_time) || "17:00",
  applies_to_all: row.applies_to_all !== false,
  channels: normalizeChannelList(row.channels),
  is_active: row.is_active !== false,
  members,
  created_at: row.created_at || null,
  updated_at: row.updated_at || null,
});

const normalizeMembers = (value) => {
  const list = Array.isArray(value) ? value : [];
  const seen = new Set();
  const members = [];
  for (const item of list) {
    const userId = Number(typeof item === "object" ? item?.user_id ?? item?.id : item);
    if (!Number.isFinite(userId) || userId <= 0 || seen.has(userId)) continue;
    seen.add(userId);
    members.push({ user_id: Math.trunc(userId), user_name: text(typeof item === "object" ? item?.user_name ?? item?.name : "").slice(0, 160) });
  }
  return members.slice(0, 200);
};

const loadMembers = async (shiftIds = []) => {
  if (!shiftIds.length) return new Map();
  const result = await db.query(
    `SELECT shift_id, user_id, user_name FROM inbox_shift_members WHERE shift_id = ANY($1::int[]) ORDER BY user_name ASC, user_id ASC`,
    [shiftIds]
  );
  const map = new Map();
  for (const row of result.rows) {
    const key = Number(row.shift_id);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push({ user_id: Number(row.user_id), user_name: text(row.user_name) });
  }
  return map;
};

export const listShifts = async ({ tenantId } = {}) => {
  await ensureInboxShiftsSchema();
  const result = await db.query(`SELECT * FROM inbox_shifts WHERE tenant_id = $1 ORDER BY is_active DESC, start_time ASC, id ASC`, [tenantOf(tenantId)]);
  const members = await loadMembers(result.rows.map((row) => Number(row.id)));
  return result.rows.map((row) => publicShift(row, members.get(Number(row.id)) || []));
};

const validateShiftInput = (input = {}) => {
  const name = text(input.name).slice(0, 120);
  if (!name) throw httpError("Shift name is required", 400, "INBOX_SHIFT_NAME_REQUIRED");
  const startTime = normalizeClock(input.start_time);
  const endTime = normalizeClock(input.end_time);
  if (!startTime || !endTime) throw httpError("Start and end time must be HH:MM", 400, "INBOX_SHIFT_TIME_INVALID");
  const days = normalizeDays(input.days);
  if (!days.length) throw httpError("Pick at least one day", 400, "INBOX_SHIFT_DAYS_REQUIRED");
  const appliesToAll = input.applies_to_all !== false;
  const channels = appliesToAll ? [] : normalizeChannelList(input.channels);
  if (!appliesToAll && !channels.length) throw httpError("Pick at least one channel or apply to all", 400, "INBOX_SHIFT_CHANNELS_REQUIRED");
  return { name, startTime, endTime, days, appliesToAll, channels, isActive: input.is_active !== false, members: normalizeMembers(input.members) };
};

const replaceMembers = async (client, shiftId, members) => {
  await client.query(`DELETE FROM inbox_shift_members WHERE shift_id = $1`, [shiftId]);
  for (const member of members) {
    await client.query(
      `INSERT INTO inbox_shift_members (shift_id, user_id, user_name) VALUES ($1, $2, $3) ON CONFLICT (shift_id, user_id) DO UPDATE SET user_name = EXCLUDED.user_name`,
      [shiftId, member.user_id, member.user_name]
    );
  }
};

const getShiftRow = async (client, tenantId, id) => {
  const result = await client.query(`SELECT * FROM inbox_shifts WHERE tenant_id = $1 AND id = $2`, [tenantOf(tenantId), Number(id) || 0]);
  if (!result.rows[0]) throw httpError("Shift not found", 404, "INBOX_SHIFT_NOT_FOUND");
  return result.rows[0];
};

const withTransaction = async (task) => {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const value = await task(client);
    await client.query("COMMIT");
    return value;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
};

export const createShift = async ({ tenantId, input = {} } = {}) => {
  await ensureInboxShiftsSchema();
  const value = validateShiftInput(input);
  const id = await withTransaction(async (client) => {
    const inserted = await client.query(
      `INSERT INTO inbox_shifts (tenant_id, name, days, start_time, end_time, applies_to_all, channels, is_active)
       VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7::jsonb, $8) RETURNING id`,
      [tenantOf(tenantId), value.name, JSON.stringify(value.days), value.startTime, value.endTime, value.appliesToAll, JSON.stringify(value.channels), value.isActive]
    );
    const shiftId = Number(inserted.rows[0].id);
    await replaceMembers(client, shiftId, value.members);
    return shiftId;
  });
  return (await listShifts({ tenantId })).find((shift) => shift.id === id) || null;
};

export const updateShift = async ({ tenantId, id, input = {} } = {}) => {
  await ensureInboxShiftsSchema();
  const value = validateShiftInput(input);
  await withTransaction(async (client) => {
    const row = await getShiftRow(client, tenantId, id);
    await client.query(
      `UPDATE inbox_shifts SET name = $3, days = $4::jsonb, start_time = $5, end_time = $6, applies_to_all = $7, channels = $8::jsonb, is_active = $9, updated_at = NOW()
       WHERE tenant_id = $1 AND id = $2`,
      [tenantOf(tenantId), Number(row.id), value.name, JSON.stringify(value.days), value.startTime, value.endTime, value.appliesToAll, JSON.stringify(value.channels), value.isActive]
    );
    await replaceMembers(client, Number(row.id), value.members);
  });
  return (await listShifts({ tenantId })).find((shift) => shift.id === Number(id)) || null;
};

export const deleteShift = async ({ tenantId, id } = {}) => {
  await ensureInboxShiftsSchema();
  const result = await db.query(`DELETE FROM inbox_shifts WHERE tenant_id = $1 AND id = $2 RETURNING id`, [tenantOf(tenantId), Number(id) || 0]);
  if (!result.rows[0]) throw httpError("Shift not found", 404, "INBOX_SHIFT_NOT_FOUND");
  return { id: Number(result.rows[0].id) };
};

/*
 * Every ACTIVE shift each of these users belongs to, as Map<userId, shift[]>.
 * One query for a whole team, used by the distributor.
 */
export const loadActiveShiftsForUsers = async ({ tenantId, userIds = [] } = {}) => {
  const ids = [...new Set(userIds.map(Number).filter((value) => Number.isFinite(value) && value > 0))];
  const map = new Map();
  if (!ids.length) return map;
  await ensureInboxShiftsSchema();
  const result = await db.query(
    `SELECT m.user_id, s.*
       FROM inbox_shift_members m
       JOIN inbox_shifts s ON s.id = m.shift_id
      WHERE s.tenant_id = $1 AND s.is_active = TRUE AND m.user_id = ANY($2::bigint[])`,
    [tenantOf(tenantId), ids]
  );
  for (const row of result.rows) {
    const key = Number(row.user_id);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  return map;
};

/*
 * Pure: availability from a user's active shifts.
 *   scheduled — the user has at least one active shift (so shifts apply to them);
 *   on_shift  — one of those shifts covers `at` (and the channel, when given).
 * Someone with no active shift is unscheduled, and "available" means !scheduled || on_shift.
 */
export const shiftAvailability = (shifts = [], at = new Date(), options = {}) => {
  const active = (Array.isArray(shifts) ? shifts : []).filter((shift) => shift && shift.is_active !== false);
  const onShift = active.some((shift) => shiftCoversAt(shift, at, options));
  return { scheduled: active.length > 0, on_shift: onShift, available: active.length === 0 || onShift };
};

// True only when one of the user's active shifts covers `at` (and the channel, when given).
export const isUserOnShift = async (userId, at = new Date(), { tenantId = 1, channel = "" } = {}) => {
  const map = await loadActiveShiftsForUsers({ tenantId, userIds: [userId] });
  return shiftAvailability(map.get(Number(userId)) || [], at, { channel }).on_shift;
};
