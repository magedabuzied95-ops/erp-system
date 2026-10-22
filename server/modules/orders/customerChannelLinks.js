import db from "../../database/db.js";
import { canonicalPhoneKey, canonicalPhoneSql } from "../../utils/phoneSearch.js";

/*
 * One customer, several doors: a Messenger or Instagram thread knows the person by a page-scoped
 * id, WhatsApp by their number, and nothing tied the two together — so when WhatsApp failed there
 * was no way back to the Messenger chat the order came from, and the reverse.
 *
 * The tie already exists in the data, it was just never read: the moment a customer types their
 * number into the address link, or staff write an order from the chat, that thread and that number
 * are recorded side by side (conversation_address_requests.session_id + customer_phone,
 * orders.ai_agent_conversation_id + customer_phone). So the link is derived at read time from those
 * two, with no table of its own to fall out of step and nothing to backfill:
 *
 *   thread → the numbers typed in it → every other thread those numbers were typed in
 *                                     → the WhatsApp thread of each number (whatsapp:20…)
 *
 * Only an Egyptian mobile counts as a number here. A Meta id travels in phone columns all over the
 * inbox, and keying on it would "link" a stranger who happens to share nothing but a column.
 */

const text = (value = "") => String(value ?? "").trim();

const EGYPT_MOBILE_KEY = /^1[0125]\d{8}$/;
const mobileKey = (value = "") => {
  const key = canonicalPhoneKey(value);
  return EGYPT_MOBILE_KEY.test(key) ? key : "";
};
export const localMobileFromKey = (key = "") => (EGYPT_MOBILE_KEY.test(key) ? `0${key}` : "");
const whatsappSessionForKey = (key = "") => (EGYPT_MOBILE_KEY.test(key) ? `whatsapp:20${key}` : "");
const keyFromWhatsappSession = (sessionId = "") => {
  const match = /^whatsapp:(\d+)$/.exec(text(sessionId));
  return match ? mobileKey(match[1]) : "";
};

// The kind of door a thread is, in the four words the UI has buttons for. Comment threads are a
// post, not a person, so they never show as a way to reach someone.
export const channelKind = (channel = "", sessionId = "") => {
  const value = `${text(channel)} ${text(sessionId)}`.toLowerCase();
  if (/comment|_post:/.test(value)) return "";
  if (value.includes("whatsapp")) return "whatsapp";
  if (value.includes("instagram")) return "instagram";
  if (value.includes("tiktok")) return "tiktok";
  if (value.includes("messenger") || value.includes("facebook")) return "messenger";
  return "";
};

const tableExists = async (name, client) => {
  const result = await client.query(`SELECT to_regclass($1) AS name`, [`public.${name}`]);
  return Boolean(result.rows[0]?.name);
};

// Numbers recorded in these threads: phone keys by session id.
const phoneKeysBySession = async (sessionIds = [], { tenantId = null, client = db } = {}) => {
  const bySession = new Map();
  const add = (sessionId, phone) => {
    const key = mobileKey(phone);
    if (!key) return;
    if (!bySession.has(sessionId)) bySession.set(sessionId, new Set());
    bySession.get(sessionId).add(key);
  };
  const sessions = [...new Set(sessionIds.map(text).filter(Boolean))];
  if (!sessions.length) return bySession;
  for (const sessionId of sessions) add(sessionId, keyFromWhatsappSession(sessionId) ? `0${keyFromWhatsappSession(sessionId)}` : "");
  const [orders, requests] = await Promise.all([
    client.query(
      `
      SELECT ai_agent_conversation_id AS session_id, customer_phone
      FROM orders
      WHERE ($1::bigint IS NULL OR tenant_id = $1::bigint OR tenant_id IS NULL)
        AND ai_agent_conversation_id = ANY($2::text[])
      `,
      [tenantId, sessions]
    ),
    tableExists("conversation_address_requests", client).then((exists) =>
      exists
        ? client.query(
          `
          SELECT session_id, customer_phone
          FROM conversation_address_requests
          WHERE COALESCE(tenant_id, 0) = COALESCE($1::bigint, 0)
            AND session_id = ANY($2::text[])
            AND status = 'submitted'
          `,
          [tenantId, sessions]
        )
        : { rows: [] }
    ),
  ]);
  for (const row of [...orders.rows, ...requests.rows]) add(text(row.session_id), row.customer_phone);
  return bySession;
};

// Threads these numbers were typed in: session ids by phone key, the number's own WhatsApp thread
// included.
const sessionsByPhoneKey = async (keys = [], { tenantId = null, client = db } = {}) => {
  const byKey = new Map();
  const wanted = [...new Set(keys.filter((key) => EGYPT_MOBILE_KEY.test(key)))];
  for (const key of wanted) byKey.set(key, new Set([whatsappSessionForKey(key)]));
  if (!wanted.length) return byKey;
  const [orders, requests] = await Promise.all([
    client.query(
      `
      SELECT DISTINCT ai_agent_conversation_id AS session_id, ${canonicalPhoneSql("customer_phone")} AS phone_key
      FROM orders
      WHERE ($1::bigint IS NULL OR tenant_id = $1::bigint OR tenant_id IS NULL)
        AND COALESCE(ai_agent_conversation_id, '') <> ''
        AND ${canonicalPhoneSql("customer_phone")} = ANY($2::text[])
      `,
      [tenantId, wanted]
    ),
    tableExists("conversation_address_requests", client).then((exists) =>
      exists
        ? client.query(
          `
          SELECT DISTINCT session_id, ${canonicalPhoneSql("customer_phone")} AS phone_key
          FROM conversation_address_requests
          WHERE COALESCE(tenant_id, 0) = COALESCE($1::bigint, 0)
            AND status = 'submitted'
            AND ${canonicalPhoneSql("customer_phone")} = ANY($2::text[])
          `,
          [tenantId, wanted]
        )
        : { rows: [] }
    ),
  ]);
  for (const row of [...orders.rows, ...requests.rows]) {
    const sessionId = text(row.session_id);
    if (sessionId && byKey.has(row.phone_key)) byKey.get(row.phone_key).add(sessionId);
  }
  return byKey;
};

// The threads that really exist in the inbox, shaped for a button.
const loadThreads = async (sessionIds = [], { tenantId = null, client = db } = {}) => {
  const byId = new Map();
  const ids = [...new Set(sessionIds.map(text).filter(Boolean))];
  if (!ids.length || !(await tableExists("ai_channel_conversations", client))) return byId;
  const result = await client.query(
    `
    SELECT external_conversation_id, channel, customer_name, customer_avatar_url, last_message_at
    FROM ai_channel_conversations
    WHERE ($1::bigint IS NULL OR tenant_id = $1::bigint)
      AND external_conversation_id = ANY($2::text[])
    `,
    [tenantId, ids]
  );
  for (const row of result.rows) {
    const kind = channelKind(row.channel, row.external_conversation_id);
    if (!kind) continue;
    const existing = byId.get(row.external_conversation_id);
    // A thread can sit under two channel spellings; the newest activity is the one people use.
    if (existing && new Date(existing.last_message_at || 0) >= new Date(row.last_message_at || 0)) continue;
    byId.set(row.external_conversation_id, {
      id: row.external_conversation_id,
      channel: text(row.channel),
      kind,
      customer_name: text(row.customer_name),
      avatar_url: text(row.customer_avatar_url),
      last_message_at: row.last_message_at || null,
    });
  }
  return byId;
};

const KIND_ORDER = { whatsapp: 0, messenger: 1, instagram: 2, tiktok: 3 };
const sortThreads = (threads = []) =>
  threads.sort((a, b) =>
    (KIND_ORDER[a.kind] ?? 9) - (KIND_ORDER[b.kind] ?? 9) ||
    new Date(b.last_message_at || 0) - new Date(a.last_message_at || 0)
  );

/**
 * Batch form for a list of subjects (the portal's page of orders). Each subject is
 * `{ key, sessionIds: [], phones: [] }`; the answer maps key → { phones: ["01…"], conversations: [...] }.
 * Four queries for the whole page, whatever its size.
 */
export const linkedChannelsForSubjects = async (subjects = [], { tenantId = null, client = db } = {}) => {
  const answer = new Map();
  if (!subjects.length) return answer;
  const allSessions = subjects.flatMap((subject) => subject.sessionIds || []);
  const keysFromSessions = await phoneKeysBySession(allSessions, { tenantId, client });

  const subjectKeys = new Map();
  for (const subject of subjects) {
    const keys = new Set((subject.phones || []).map(mobileKey).filter(Boolean));
    for (const sessionId of subject.sessionIds || []) {
      for (const key of keysFromSessions.get(text(sessionId)) || []) keys.add(key);
    }
    subjectKeys.set(subject.key, keys);
  }
  const sessionsByKey = await sessionsByPhoneKey([...new Set([...subjectKeys.values()].flatMap((keys) => [...keys]))], { tenantId, client });

  const subjectSessions = new Map();
  for (const subject of subjects) {
    const sessions = new Set((subject.sessionIds || []).map(text).filter(Boolean));
    for (const key of subjectKeys.get(subject.key)) {
      for (const sessionId of sessionsByKey.get(key) || []) sessions.add(sessionId);
    }
    subjectSessions.set(subject.key, sessions);
  }
  const threads = await loadThreads([...new Set([...subjectSessions.values()].flatMap((sessions) => [...sessions]))], { tenantId, client });

  for (const subject of subjects) {
    answer.set(subject.key, {
      phones: [...subjectKeys.get(subject.key)].map(localMobileFromKey),
      conversations: sortThreads([...subjectSessions.get(subject.key)].map((id) => threads.get(id)).filter(Boolean)),
    });
  }
  return answer;
};

export const linkedChannelsForConversation = async ({ tenantId = null, sessionId = "", phones = [], client = db } = {}) => {
  const result = await linkedChannelsForSubjects([{ key: "one", sessionIds: [sessionId], phones }], { tenantId, client });
  return result.get("one") || { phones: [], conversations: [] };
};
