import db from "../database/db.js";
import {
  INBOX_CHANNELS,
  loadActiveShiftsForUsers,
  normalizeChannelList,
  normalizeInboxChannel,
  shiftAvailability,
} from "./inboxShiftsService.js";

/*
 * Inbox teams (inbox top bar → Config → Teams).
 *
 * A team is a named set of colleagues plus a distribution strategy and the channels it covers
 * (empty = every channel):
 *   manual       — nothing automatic; the team is just a grouping.
 *   broadcast    — nothing automatic either: every member sees the chat in the shared list.
 *   round_robin  — a new unassigned chat goes to the next member in turn.
 *   least_busy   — … to the member with the fewest open (human_takeover) chats.
 *
 * Auto distribution goes through the SAME code path as the "assign to colleague" button
 * (PATCH /ai-inbox/:id/assign → assignAiSupportConversation + syncLeadAssignmentMetadata), so an
 * auto-assigned chat is indistinguishable from a hand-assigned one. Note what that path means:
 * an assigned chat is a human_takeover chat — the AI stops answering it. That is why a chat the
 * AI bot is answering on its own (fully automatic / just auto-sent) is left alone; the team gets
 * it on the first inbound after it is handed to a human.
 *
 * Safety: never throws, never touches a chat that already has an assignee, a closed chat, or a
 * chat with no session row; off entirely unless an ACTIVE round_robin/least_busy team exists.
 */

export const TEAM_DISTRIBUTIONS = Object.freeze(["manual", "round_robin", "least_busy", "broadcast"]);
const AUTO_DISTRIBUTIONS = ["round_robin", "least_busy"];

let schemaReady = null;

export const ensureInboxTeamsSchema = () => {
  schemaReady ||= (async () => {
    await db.query(`
      CREATE TABLE IF NOT EXISTS inbox_teams (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL,
        name VARCHAR(120) NOT NULL,
        distribution VARCHAR(20) NOT NULL DEFAULT 'manual',
        channels JSONB NOT NULL DEFAULT '[]'::jsonb,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        rr_last_user_id BIGINT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS inbox_team_members (
        team_id INTEGER NOT NULL REFERENCES inbox_teams(id) ON DELETE CASCADE,
        user_id BIGINT NOT NULL,
        user_name VARCHAR(160) NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (team_id, user_id)
      )
    `);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_inbox_teams_tenant ON inbox_teams (tenant_id, is_active)`);
  })().catch((error) => {
    schemaReady = null;
    throw error;
  });
  return schemaReady;
};

const httpError = (message, status = 400, code = "INBOX_TEAM_ERROR") => Object.assign(new Error(message), { status, code });
const text = (value = "") => String(value ?? "").trim();
const tenantOf = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 1;
};

/* ------------------------------------------------------------------ pure pickers */

/*
 * Round robin: the member after `lastUserId` in ascending id order, wrapping. Ordering by id
 * (not by insertion) keeps the turn stable when the member list is edited or someone goes
 * off shift — the cursor is a user id, so it survives either.
 */
export const pickRoundRobin = (candidateIds = [], lastUserId = null) => {
  const ids = [...new Set(candidateIds.map(Number).filter((value) => Number.isFinite(value) && value > 0))].sort((a, b) => a - b);
  if (!ids.length) return null;
  const last = Number(lastUserId);
  if (!Number.isFinite(last) || last <= 0) return ids[0];
  return ids.find((id) => id > last) ?? ids[0];
};

/*
 * Least busy: the fewest open chats. Ties are broken in round-robin order from the cursor, so
 * a quiet morning (everyone on 0) still rotates instead of piling onto the lowest id.
 */
export const pickLeastBusy = (candidateIds = [], openCounts = {}, lastUserId = null) => {
  const ids = [...new Set(candidateIds.map(Number).filter((value) => Number.isFinite(value) && value > 0))];
  if (!ids.length) return null;
  const countOf = (id) => Number(openCounts instanceof Map ? openCounts.get(id) : openCounts[id]) || 0;
  const lowest = Math.min(...ids.map(countOf));
  return pickRoundRobin(ids.filter((id) => countOf(id) === lowest), lastUserId);
};

export const teamCoversChannel = (team = {}, channel = "") => {
  const channels = normalizeChannelList(team.channels);
  if (!channels.length) return true;
  return channels.includes(normalizeInboxChannel(channel));
};

/* ------------------------------------------------------------------ CRUD */

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

const publicTeam = (row = {}, members = []) => ({
  id: Number(row.id),
  name: text(row.name),
  distribution: TEAM_DISTRIBUTIONS.includes(row.distribution) ? row.distribution : "manual",
  channels: normalizeChannelList(row.channels),
  is_active: row.is_active !== false,
  members,
  created_at: row.created_at || null,
  updated_at: row.updated_at || null,
});

const loadMembers = async (teamIds = []) => {
  if (!teamIds.length) return new Map();
  const result = await db.query(
    `SELECT team_id, user_id, user_name FROM inbox_team_members WHERE team_id = ANY($1::int[]) ORDER BY user_name ASC, user_id ASC`,
    [teamIds]
  );
  const map = new Map();
  for (const row of result.rows) {
    const key = Number(row.team_id);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push({ user_id: Number(row.user_id), user_name: text(row.user_name) });
  }
  return map;
};

export const listTeams = async ({ tenantId } = {}) => {
  await ensureInboxTeamsSchema();
  const result = await db.query(`SELECT * FROM inbox_teams WHERE tenant_id = $1 ORDER BY is_active DESC, name ASC, id ASC`, [tenantOf(tenantId)]);
  const members = await loadMembers(result.rows.map((row) => Number(row.id)));
  return result.rows.map((row) => publicTeam(row, members.get(Number(row.id)) || []));
};

const validateTeamInput = (input = {}) => {
  const name = text(input.name).slice(0, 120);
  if (!name) throw httpError("Team name is required", 400, "INBOX_TEAM_NAME_REQUIRED");
  const distribution = text(input.distribution).toLowerCase() || "manual";
  if (!TEAM_DISTRIBUTIONS.includes(distribution)) throw httpError("Invalid distribution strategy", 400, "INBOX_TEAM_DISTRIBUTION_INVALID");
  return {
    name,
    distribution,
    channels: normalizeChannelList(input.channels),
    isActive: input.is_active !== false,
    members: normalizeMembers(input.members),
  };
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

const replaceMembers = async (client, teamId, members) => {
  await client.query(`DELETE FROM inbox_team_members WHERE team_id = $1`, [teamId]);
  for (const member of members) {
    await client.query(
      `INSERT INTO inbox_team_members (team_id, user_id, user_name) VALUES ($1, $2, $3) ON CONFLICT (team_id, user_id) DO UPDATE SET user_name = EXCLUDED.user_name`,
      [teamId, member.user_id, member.user_name]
    );
  }
};

// The "is any auto team on?" answer, cached per tenant so every inbound message does not cost a query.
const AUTO_CACHE_MS = 60 * 1000;
const autoTeamsCache = new Map();
const invalidateAutoCache = (tenantId) => autoTeamsCache.delete(tenantOf(tenantId));

export const createTeam = async ({ tenantId, input = {} } = {}) => {
  await ensureInboxTeamsSchema();
  const value = validateTeamInput(input);
  const id = await withTransaction(async (client) => {
    const inserted = await client.query(
      `INSERT INTO inbox_teams (tenant_id, name, distribution, channels, is_active) VALUES ($1, $2, $3, $4::jsonb, $5) RETURNING id`,
      [tenantOf(tenantId), value.name, value.distribution, JSON.stringify(value.channels), value.isActive]
    );
    const teamId = Number(inserted.rows[0].id);
    await replaceMembers(client, teamId, value.members);
    return teamId;
  });
  invalidateAutoCache(tenantId);
  return (await listTeams({ tenantId })).find((team) => team.id === id) || null;
};

export const updateTeam = async ({ tenantId, id, input = {} } = {}) => {
  await ensureInboxTeamsSchema();
  const value = validateTeamInput(input);
  await withTransaction(async (client) => {
    const found = await client.query(`SELECT id FROM inbox_teams WHERE tenant_id = $1 AND id = $2`, [tenantOf(tenantId), Number(id) || 0]);
    if (!found.rows[0]) throw httpError("Team not found", 404, "INBOX_TEAM_NOT_FOUND");
    await client.query(
      `UPDATE inbox_teams SET name = $3, distribution = $4, channels = $5::jsonb, is_active = $6, updated_at = NOW() WHERE tenant_id = $1 AND id = $2`,
      [tenantOf(tenantId), Number(id), value.name, value.distribution, JSON.stringify(value.channels), value.isActive]
    );
    await replaceMembers(client, Number(id), value.members);
  });
  invalidateAutoCache(tenantId);
  return (await listTeams({ tenantId })).find((team) => team.id === Number(id)) || null;
};

export const deleteTeam = async ({ tenantId, id } = {}) => {
  await ensureInboxTeamsSchema();
  const result = await db.query(`DELETE FROM inbox_teams WHERE tenant_id = $1 AND id = $2 RETURNING id`, [tenantOf(tenantId), Number(id) || 0]);
  if (!result.rows[0]) throw httpError("Team not found", 404, "INBOX_TEAM_NOT_FOUND");
  invalidateAutoCache(tenantId);
  return { id: Number(result.rows[0].id) };
};

/* ------------------------------------------------------------------ auto distribution */

const loadAutoTeams = async (tenantId) => {
  const key = tenantOf(tenantId);
  const cached = autoTeamsCache.get(key);
  if (cached && Date.now() - cached.at < AUTO_CACHE_MS) return cached.teams;
  await ensureInboxTeamsSchema();
  const result = await db.query(
    `SELECT * FROM inbox_teams WHERE tenant_id = $1 AND is_active = TRUE AND distribution = ANY($2::text[]) ORDER BY id ASC`,
    [key, AUTO_DISTRIBUTIONS]
  );
  const members = await loadMembers(result.rows.map((row) => Number(row.id)));
  const teams = result.rows.map((row) => ({ ...publicTeam(row, members.get(Number(row.id)) || []), rr_last_user_id: row.rr_last_user_id }));
  autoTeamsCache.set(key, { at: Date.now(), teams });
  return teams;
};

// One distribution per conversation at a time: a burst of three messages must not assign three people.
const inFlight = new Set();

const findSessionRow = async (tenantId, conversationId, channel) => {
  const raw = text(conversationId);
  const prefix = normalizeInboxChannel(channel);
  const candidates = [...new Set([raw, prefix && !raw.startsWith(`${prefix}:`) ? `${prefix}:${raw}` : ""].filter(Boolean))];
  const result = await db.query(
    `SELECT session_id, status, assigned_user_id FROM ai_support_sessions WHERE tenant_id = $1 AND session_id = ANY($2::text[]) ORDER BY updated_at DESC NULLS LAST LIMIT 1`,
    [tenantOf(tenantId), candidates]
  );
  return result.rows[0] || null;
};

/*
 * Called fire-and-forget from the inbound intake. Resolves to a small result object; NEVER rejects.
 */
export const autoDistributeConversation = async ({ tenantId, channel = "", conversationId = "", autoSent = false, autoReplyMode = "", at = new Date() } = {}) => {
  const lockKey = `${tenantOf(tenantId)}:${text(conversationId)}`;
  let locked = false;
  try {
    if (!tenantId || !text(conversationId)) return { skipped: true, reason: "missing_context" };
    const teams = await loadAutoTeams(tenantId);
    if (!teams.length) return { skipped: true, reason: "no_auto_team" };
    if (autoSent === true || text(autoReplyMode).toLowerCase() === "fully_automatic") return { skipped: true, reason: "ai_owns_conversation" };
    const covering = teams.filter((item) => item.members.length && teamCoversChannel(item, channel));
    if (!covering.length) return { skipped: true, reason: "no_team_for_channel" };
    if (inFlight.has(lockKey)) return { skipped: true, reason: "in_flight" };
    inFlight.add(lockKey);
    locked = true;

    const session = await findSessionRow(tenantId, conversationId, channel);
    if (!session) return { skipped: true, reason: "no_session" };
    if (session.assigned_user_id) return { skipped: true, reason: "already_assigned" };
    if (text(session.status) === "closed") return { skipped: true, reason: "closed" };

    // The oldest covering team with someone on shift right now takes it; nobody on shift → left unassigned.
    const shifts = await loadActiveShiftsForUsers({ tenantId, userIds: covering.flatMap((item) => item.members.map((member) => member.user_id)) });
    const isAvailable = (userId) => shiftAvailability(shifts.get(userId) || [], at, { channel }).available;
    let team = null;
    let available = [];
    for (const candidate of covering) {
      available = candidate.members.map((member) => member.user_id).filter(isAvailable);
      if (available.length) { team = candidate; break; }
    }
    if (!team) return { skipped: true, reason: "nobody_on_shift" };

    let pickedId = null;
    if (team.distribution === "least_busy") {
      const counts = await db.query(
        `SELECT assigned_user_id, COUNT(*)::int AS open
           FROM ai_support_sessions
          WHERE tenant_id = $1 AND status = 'human_takeover' AND assigned_user_id = ANY($2::bigint[])
          GROUP BY assigned_user_id`,
        [tenantOf(tenantId), available]
      );
      const openCounts = new Map(counts.rows.map((row) => [Number(row.assigned_user_id), Number(row.open) || 0]));
      pickedId = pickLeastBusy(available, openCounts, team.rr_last_user_id);
    } else {
      pickedId = pickRoundRobin(available, team.rr_last_user_id);
    }
    if (!pickedId) return { skipped: true, reason: "no_candidate", team_id: team.id };
    const member = team.members.find((item) => item.user_id === pickedId) || { user_name: "" };

    // Re-read right before writing: someone may have claimed it while we were picking.
    const fresh = await findSessionRow(tenantId, session.session_id, channel);
    if (!fresh || fresh.assigned_user_id) return { skipped: true, reason: "already_assigned" };

    // The assign route's own path (aiAgentOrders.js PATCH /inbox/:conversationId/assign). Imported
    // lazily so the pure pickers above load without the whole inbox service graph.
    const { assignAiSupportConversation } = await import("./aiSupportLogService.js");
    const { loadLeadConversationForAction, syncLeadAssignmentMetadata } = await import("./aiInboxLeadActionsService.js");
    await assignAiSupportConversation({
      tenantId,
      sessionId: fresh.session_id,
      assignedUserId: pickedId,
      assignedUserName: member.user_name,
      actorUserId: null,
    });
    const leadConversation = await loadLeadConversationForAction({ tenantId, conversationId: fresh.session_id }).catch(() => null);
    await syncLeadAssignmentMetadata({
      tenantId,
      conversation: leadConversation || { session_id: fresh.session_id },
      assignedEmployeeId: pickedId,
      assignedEmployeeName: member.user_name,
      actorUserId: null,
    }).catch(() => null);

    await db.query(`UPDATE inbox_teams SET rr_last_user_id = $3 WHERE tenant_id = $1 AND id = $2`, [tenantOf(tenantId), team.id, pickedId]);
    team.rr_last_user_id = pickedId; // keep the cached cursor in step until the cache refreshes
    return { assigned: true, team_id: team.id, user_id: pickedId, session_id: fresh.session_id };
  } catch (error) {
    console.warn("[inbox-teams] auto distribution failed", { tenant_id: tenantId, conversation_id: conversationId, message: error?.message || String(error) });
    return { ok: false, error: String(error?.message || error).slice(0, 160) };
  } finally {
    if (locked) inFlight.delete(lockKey);
  }
};

export { INBOX_CHANNELS };
