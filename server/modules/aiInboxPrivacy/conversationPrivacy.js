import db from "../../database/db.js";
import { canonicalPhoneKey, canonicalPhoneSql } from "../../utils/phoneSearch.js";

// Conversation privacy: the owner can take one conversation out of every
// non-admin's inbox, or leave it to a named few employees.
//
// Two decisions shape this file:
//
// 1. The rule is keyed on the CUSTOMER, not on the session row. A session id is
//    rebuilt by the syncs and the same human arrives again on another channel, so
//    a privacy row holds up to three identities (canonical phone, channel
//    customer id, session id) and matching ANY of them hides the thread. That is
//    why a new conversation from a hidden customer starts hidden too.
// 2. Hiding is enforced in several places on purpose. The list query filters
//    (loadAiInbox); aiInboxPrivacyBoundary.js checks every conversation-scoped
//    route — because targeted `sessionKeys` lookups deliberately skip the list
//    filters so send/reply can still resolve an id, and because a URL typed by
//    hand must not open the thread; the portal push drops the recipients who may
//    not read it; and the customer profile behind the thread is closed too, since
//    the name, the spend and the order history are most of what the thread shows.
//
// Admins are never filtered. A viewer with no employee row is treated as nobody,
// so an unexpected account sees LESS, never more.

const text = (value = "") => String(value ?? "").trim();

const idOrNull = (value) => {
  const next = Number(value);
  return Number.isFinite(next) && next > 0 ? Math.trunc(next) : null;
};

export const PRIVACY_MODE_EVERYONE = "everyone";
export const PRIVACY_MODE_RESTRICTED = "restricted";

let schemaPromise = null;

export const ensureConversationPrivacySchema = async (client = db) => {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS ai_conversation_privacy (
          id BIGSERIAL PRIMARY KEY,
          tenant_id BIGINT NOT NULL,
          phone_key TEXT NOT NULL DEFAULT '',
          external_key TEXT NOT NULL DEFAULT '',
          session_key TEXT NOT NULL DEFAULT '',
          customer_label TEXT NOT NULL DEFAULT '',
          channel TEXT NOT NULL DEFAULT '',
          created_by_user_id BIGINT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS ai_conversation_privacy_identity_idx
          ON ai_conversation_privacy (tenant_id, phone_key, external_key, session_key)
      `);
      await client.query(`
        CREATE TABLE IF NOT EXISTS ai_conversation_privacy_viewers (
          privacy_id BIGINT NOT NULL REFERENCES ai_conversation_privacy(id) ON DELETE CASCADE,
          employee_id BIGINT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (privacy_id, employee_id)
        )
      `);
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  await schemaPromise;
};

export const resetConversationPrivacySchemaForTests = () => {
  schemaPromise = null;
  customerPhoneColumnsPromise = null;
  privacyRowsCache.clear();
  hiddenKeysCache.clear();
  identityCache.clear();
};

// A shop that never hides anything must not pay for this feature on every inbox
// read, so the "does this tenant use it at all" answer is cached and checked first.
const privacyRowsCache = new Map();
const hiddenKeysCache = new Map();
const identityCache = new Map();
const CACHE_TTL_MS = 15 * 1000;
const IDENTITY_TTL_MS = 60 * 1000;

export const invalidateConversationPrivacyCache = () => {
  privacyRowsCache.clear();
  hiddenKeysCache.clear();
  identityCache.clear();
};

const cached = (store, key, ttl) => {
  const hit = store.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.value;
  return undefined;
};

const remember = (store, key, value) => {
  store.set(key, { value, at: Date.now() });
  return value;
};

const loadPrivacyRows = async ({ tenantId, client = db }) => {
  const tenant = idOrNull(tenantId);
  if (!tenant) return [];
  const hit = cached(privacyRowsCache, tenant, CACHE_TTL_MS);
  if (hit) return hit;
  await ensureConversationPrivacySchema(client);
  const result = await client.query(
    `SELECT
       pr.id,
       pr.phone_key,
       pr.external_key,
       pr.session_key,
       pr.customer_label,
       COALESCE(ARRAY_AGG(v.employee_id) FILTER (WHERE v.employee_id IS NOT NULL), '{}') AS employee_ids
     FROM ai_conversation_privacy pr
     LEFT JOIN ai_conversation_privacy_viewers v ON v.privacy_id = pr.id
     WHERE pr.tenant_id = $1::bigint
     GROUP BY pr.id`,
    [tenant]
  );
  const rows = result.rows.map((row) => ({
    id: Number(row.id),
    phoneKey: text(row.phone_key),
    externalKey: text(row.external_key),
    sessionKey: text(row.session_key),
    label: text(row.customer_label),
    employeeIds: (row.employee_ids || []).map(Number).filter(Boolean),
  }));
  return remember(privacyRowsCache, tenant, rows);
};

export const tenantUsesConversationPrivacy = async ({ tenantId, client = db } = {}) => {
  const rows = await loadPrivacyRows({ tenantId, client }).catch(() => []);
  return rows.length > 0;
};

// The phone a WhatsApp thread is named after. `whatsapp:201068005338` carries the
// identity even when no customer profile row exists yet.
const sessionPhoneKey = (sessionId = "") => {
  const value = text(sessionId);
  if (!/^whatsapp:/i.test(value)) return "";
  return canonicalPhoneKey(value.split(":").slice(1).join(":"));
};

export const resolveConversationIdentity = async ({ tenantId, conversationId, client = db } = {}) => {
  const tenant = idOrNull(tenantId);
  const key = text(conversationId);
  if (!tenant || !key) return null;
  const cacheKey = `${tenant}:${key}`;
  const hit = cached(identityCache, cacheKey, IDENTITY_TTL_MS);
  if (hit !== undefined) return hit;
  // Several inbox routes accept a BARE PHONE where a session id goes (the customer
  // orders panel is one), so the phone is a third way in, not only the stored ids.
  const phoneCandidate = canonicalPhoneKey(key);
  const result = await client.query(
    `SELECT
       s.session_id,
       COALESCE(s.channel, '') AS channel,
       COALESCE(c.external_customer_id, '') AS external_customer_id,
       COALESCE(p.phone, '') AS profile_phone,
       COALESCE(NULLIF(s.customer_name, ''), NULLIF(c.customer_name, ''), NULLIF(p.display_name, ''), '') AS label
     FROM ai_support_sessions s
     LEFT JOIN ai_channel_conversations c
       ON c.tenant_id = s.tenant_id AND c.external_conversation_id = s.session_id
     LEFT JOIN ai_customer_profiles p
       ON p.id = c.customer_profile_id AND p.tenant_id = s.tenant_id
     WHERE s.tenant_id = $1::bigint
       AND (
         s.session_id = $2::text
         OR c.external_conversation_id = $2::text
         OR c.external_customer_id = $2::text
         OR (
           $3::text <> ''
           AND (
             ${canonicalPhoneSql("p.phone")} = $3::text
             OR ${canonicalPhoneSql("c.external_customer_id")} = $3::text
             OR (s.session_id LIKE 'whatsapp:%' AND ${canonicalPhoneSql("s.session_id")} = $3::text)
           )
         )
       )
     ORDER BY s.updated_at DESC
     LIMIT 1`,
    [tenant, key, phoneCandidate.length >= 7 ? phoneCandidate : ""]
  );
  const row = result.rows[0];
  if (!row) return remember(identityCache, cacheKey, null);
  const identity = {
    sessionKey: text(row.session_id),
    channel: text(row.channel),
    externalKey: text(row.external_customer_id),
    phoneKey: canonicalPhoneKey(row.profile_phone) || sessionPhoneKey(row.session_id),
    label: text(row.label),
  };
  return remember(identityCache, cacheKey, identity);
};

const matchesIdentity = (row, identity) => {
  if (!row || !identity) return false;
  if (row.phoneKey && identity.phoneKey && row.phoneKey === identity.phoneKey) return true;
  if (row.externalKey && identity.externalKey && row.externalKey === identity.externalKey) return true;
  if (row.sessionKey && identity.sessionKey && row.sessionKey === identity.sessionKey) return true;
  return false;
};

/**
 * The keys a given viewer may NOT see. An admin viewer gets empty arrays; so does
 * a tenant that hides nothing, which keeps the inbox query untouched for them.
 */
export const loadHiddenKeysForViewer = async ({ tenantId, employeeId = null, isAdmin = false, client = db } = {}) => {
  const empty = { phones: [], externals: [], sessions: [] };
  if (isAdmin) return empty;
  const tenant = idOrNull(tenantId);
  if (!tenant) return empty;
  const employee = idOrNull(employeeId);
  const cacheKey = `${tenant}:${employee || 0}`;
  const hit = cached(hiddenKeysCache, cacheKey, CACHE_TTL_MS);
  if (hit) return hit;
  const rows = await loadPrivacyRows({ tenantId: tenant, client });
  if (!rows.length) return remember(hiddenKeysCache, cacheKey, empty);
  const hidden = { phones: [], externals: [], sessions: [] };
  for (const row of rows) {
    // No employee identity means no allowlist can match: the thread stays hidden.
    if (employee && row.employeeIds.includes(employee)) continue;
    if (row.phoneKey) hidden.phones.push(row.phoneKey);
    if (row.externalKey) hidden.externals.push(row.externalKey);
    if (row.sessionKey) hidden.sessions.push(row.sessionKey);
  }
  return remember(hiddenKeysCache, cacheKey, hidden);
};

export const hiddenKeysAreEmpty = (hiddenKeys = {}) =>
  !hiddenKeys
  || (!(hiddenKeys.phones || []).length && !(hiddenKeys.externals || []).length && !(hiddenKeys.sessions || []).length);

/**
 * The SQL twin of the rule above, for the inbox list. `s`, `c` and `p` are the
 * session, channel conversation and customer profile aliases both inbox queries
 * already join. Every parameter is cast on use — a reused $n in a list with no
 * other type hint is deduced from its FIRST use otherwise.
 */
export const conversationPrivacyClauseSql = ({ phonesIdx, externalsIdx, sessionsIdx }) => `NOT (
    (${canonicalPhoneSql("p.phone")} <> '' AND ${canonicalPhoneSql("p.phone")} = ANY(${phonesIdx}::text[]))
    OR (s.session_id LIKE 'whatsapp:%' AND ${canonicalPhoneSql("s.session_id")} = ANY(${phonesIdx}::text[]))
    OR (COALESCE(c.external_customer_id, '') <> '' AND c.external_customer_id = ANY(${externalsIdx}::text[]))
    OR (s.session_id = ANY(${sessionsIdx}::text[]))
  )`;

export const isConversationVisibleToViewer = async ({
  tenantId,
  conversationId,
  employeeId = null,
  isAdmin = false,
  client = db,
} = {}) => {
  if (isAdmin) return true;
  const tenant = idOrNull(tenantId);
  if (!tenant) return true;
  const rows = await loadPrivacyRows({ tenantId: tenant, client });
  if (!rows.length) return true;
  const identity = await resolveConversationIdentity({ tenantId: tenant, conversationId, client });
  // An id that resolves to nothing is not a hidden conversation; the route itself
  // answers 404 for it.
  if (!identity) return true;
  const employee = idOrNull(employeeId);
  const match = rows.find((row) => matchesIdentity(row, identity));
  if (!match) return true;
  return Boolean(employee && match.employeeIds.includes(employee));
};

// The customer drawer reads /customers/:id/profile, and the employee portal's
// inbox is allowed that route. Knowing a hidden customer's name, spend and order
// history is knowing most of what the thread would have shown, so the identifier
// is resolved to phone keys and checked against the same rules.
let customerPhoneColumnsPromise = null;

const customerPhoneColumns = async (client = db) => {
  if (!customerPhoneColumnsPromise) {
    customerPhoneColumnsPromise = client
      .query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = current_schema()
           AND table_name = 'customers'
           AND column_name = ANY($1::text[])`,
        [["phone", "phone_number", "mobile", "whatsapp", "whatsapp_number"]]
      )
      .then((result) => result.rows.map((row) => row.column_name))
      .catch((error) => {
        customerPhoneColumnsPromise = null;
        throw error;
      });
  }
  return customerPhoneColumnsPromise;
};

export const resetCustomerPhoneColumnsForTests = () => {
  customerPhoneColumnsPromise = null;
};

export const customerPhoneKeysForIdentifier = async ({ tenantId, identifier, client = db } = {}) => {
  const tenant = idOrNull(tenantId);
  const raw = text(identifier);
  if (!tenant || !raw) return [];
  const keys = new Set();
  // A phone can be the identifier itself. A short run of digits is a row id, not
  // a number, and canonicalising it would only invent a key that matches nothing.
  const direct = canonicalPhoneKey(raw);
  if (direct.length >= 7) keys.add(direct);
  if (/^\d+$/.test(raw)) {
    const columns = await customerPhoneColumns(client).catch(() => []);
    if (columns.length) {
      const projection = columns.map((column) => `COALESCE(${column}::text, '')`).join(", ");
      const result = await client
        .query(
          `SELECT ${projection} FROM customers WHERE id = $1::bigint LIMIT 1`,
          [raw]
        )
        .catch(() => ({ rows: [] }));
      for (const value of Object.values(result.rows[0] || {})) {
        const key = canonicalPhoneKey(value);
        if (key.length >= 7) keys.add(key);
      }
    }
  }
  return [...keys];
};

export const isCustomerVisibleToViewer = async ({
  tenantId,
  identifier,
  employeeId = null,
  isAdmin = false,
  client = db,
} = {}) => {
  if (isAdmin) return true;
  const tenant = idOrNull(tenantId);
  if (!tenant) return true;
  const rows = await loadPrivacyRows({ tenantId: tenant, client });
  if (!rows.length) return true;
  const keys = await customerPhoneKeysForIdentifier({ tenantId: tenant, identifier, client });
  if (!keys.length) return true;
  const match = rows.find((row) => row.phoneKey && keys.includes(row.phoneKey));
  if (!match) return true;
  const employee = idOrNull(employeeId);
  return Boolean(employee && match.employeeIds.includes(employee));
};

export const getConversationPrivacy = async ({ tenantId, conversationId, client = db } = {}) => {
  const tenant = idOrNull(tenantId);
  if (!tenant) return { mode: PRIVACY_MODE_EVERYONE, employee_ids: [] };
  const identity = await resolveConversationIdentity({ tenantId: tenant, conversationId, client });
  if (!identity) return { mode: PRIVACY_MODE_EVERYONE, employee_ids: [] };
  const rows = await loadPrivacyRows({ tenantId: tenant, client });
  const match = rows.find((row) => matchesIdentity(row, identity));
  if (!match) return { mode: PRIVACY_MODE_EVERYONE, employee_ids: [], identity };
  return { mode: PRIVACY_MODE_RESTRICTED, employee_ids: match.employeeIds, identity };
};

export const setConversationPrivacy = async ({
  tenantId,
  conversationId,
  mode = PRIVACY_MODE_EVERYONE,
  employeeIds = [],
  userId = null,
  client = db,
} = {}) => {
  const tenant = idOrNull(tenantId);
  if (!tenant) {
    const error = new Error("Tenant is required");
    error.status = 400;
    throw error;
  }
  await ensureConversationPrivacySchema(client);
  const identity = await resolveConversationIdentity({ tenantId: tenant, conversationId, client });
  if (!identity) {
    const error = new Error("Conversation not found");
    error.status = 404;
    throw error;
  }
  const normalizedMode = text(mode).toLowerCase() === PRIVACY_MODE_RESTRICTED
    ? PRIVACY_MODE_RESTRICTED
    : PRIVACY_MODE_EVERYONE;
  const viewers = [...new Set((Array.isArray(employeeIds) ? employeeIds : [employeeIds]).map(idOrNull).filter(Boolean))];

  if (normalizedMode === PRIVACY_MODE_EVERYONE) {
    await client.query(
      `DELETE FROM ai_conversation_privacy
       WHERE tenant_id = $1::bigint
         AND (
           (phone_key <> '' AND phone_key = $2::text)
           OR (external_key <> '' AND external_key = $3::text)
           OR (session_key <> '' AND session_key = $4::text)
         )`,
      [tenant, identity.phoneKey, identity.externalKey, identity.sessionKey]
    );
    invalidateConversationPrivacyCache();
    return { mode: PRIVACY_MODE_EVERYONE, employee_ids: [], identity };
  }

  // The local database lacks some of the unique constraints ON CONFLICT needs
  // (see portalInboxAccess.js for the same trap), so this is select-then-write.
  const existing = await client.query(
    `SELECT id FROM ai_conversation_privacy
     WHERE tenant_id = $1::bigint
       AND (
         (phone_key <> '' AND phone_key = $2::text)
         OR (external_key <> '' AND external_key = $3::text)
         OR (session_key <> '' AND session_key = $4::text)
       )
     ORDER BY id
     LIMIT 1`,
    [tenant, identity.phoneKey, identity.externalKey, identity.sessionKey]
  );
  let privacyId = idOrNull(existing.rows[0]?.id);
  if (privacyId) {
    await client.query(
      `UPDATE ai_conversation_privacy
       SET phone_key = $2::text,
           external_key = $3::text,
           session_key = $4::text,
           customer_label = $5::text,
           channel = $6::text,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1::bigint`,
      [privacyId, identity.phoneKey, identity.externalKey, identity.sessionKey, identity.label, identity.channel]
    );
  } else {
    const inserted = await client.query(
      `INSERT INTO ai_conversation_privacy
         (tenant_id, phone_key, external_key, session_key, customer_label, channel, created_by_user_id)
       VALUES ($1::bigint, $2::text, $3::text, $4::text, $5::text, $6::text, $7::bigint)
       RETURNING id`,
      [
        tenant,
        identity.phoneKey,
        identity.externalKey,
        identity.sessionKey,
        identity.label,
        identity.channel,
        idOrNull(userId),
      ]
    );
    privacyId = idOrNull(inserted.rows[0]?.id);
  }

  await client.query("DELETE FROM ai_conversation_privacy_viewers WHERE privacy_id = $1::bigint", [privacyId]);
  if (viewers.length) {
    await client.query(
      `INSERT INTO ai_conversation_privacy_viewers (privacy_id, employee_id)
       SELECT $1::bigint, employee_id FROM UNNEST($2::bigint[]) AS employee_id`,
      [privacyId, viewers]
    );
  }
  invalidateConversationPrivacyCache();
  return { mode: PRIVACY_MODE_RESTRICTED, employee_ids: viewers, identity };
};

/** Tags inbox rows with their privacy state, for the admin's lock badge. */
export const decorateConversationsWithPrivacy = async ({ tenantId, conversations = [], client = db } = {}) => {
  const list = Array.isArray(conversations) ? conversations : [];
  if (!list.length) return list;
  const rows = await loadPrivacyRows({ tenantId, client }).catch(() => []);
  if (!rows.length) return list;
  for (const conversation of list) {
    const identity = {
      sessionKey: text(conversation.session_id || conversation.conversation_id || conversation.id),
      externalKey: text(conversation.external_customer_id),
      phoneKey: canonicalPhoneKey(conversation.customer_phone || conversation.profile_phone || conversation.phone)
        || sessionPhoneKey(conversation.session_id || conversation.conversation_id || conversation.id),
    };
    const match = rows.find((row) => matchesIdentity(row, identity));
    conversation.privacy_mode = match ? PRIVACY_MODE_RESTRICTED : PRIVACY_MODE_EVERYONE;
    conversation.privacy_viewer_count = match ? match.employeeIds.length : 0;
  }
  return list;
};

export default {
  ensureConversationPrivacySchema,
  isCustomerVisibleToViewer,
  loadHiddenKeysForViewer,
  hiddenKeysAreEmpty,
  conversationPrivacyClauseSql,
  isConversationVisibleToViewer,
  getConversationPrivacy,
  setConversationPrivacy,
  decorateConversationsWithPrivacy,
  tenantUsesConversationPrivacy,
  invalidateConversationPrivacyCache,
};
