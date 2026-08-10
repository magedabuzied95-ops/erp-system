// Employee Portal working-draft store (Warehouse Request + Inventory Count).
//
// INVARIANTS
// - IndexedDB is a WORKING DRAFT only. It is NEVER authoritative inventory
//   state. The server remains the source of truth for stock, permissions,
//   sessions, products and every final mutation; cached data must never
//   authorize a submission/adjustment/finalization.
// - Namespaces are built from STABLE identity IDs (tenant + employee + branch,
//   plus session for inventory) resolved from server/session data. The raw
//   Employee Portal token is NEVER stored, keyed, or logged — so a draft
//   survives a token rotation for the same tenant/employee/branch/session.
// - Every operation is fail-safe: a read failure resolves to null (caller uses
//   the server), a write failure is swallowed. Diagnostics are content-free
//   (counts/flags only) — draft contents are never logged.

import { createDraftIdbAdapter, createMemoryDraftAdapter } from "./draftDb.js";

export const DRAFT_SCHEMA_VERSION = 1;
const TTL_MS = 30 * 24 * 60 * 60 * 1000; // abandoned drafts expire after 30 days
const DEBOUNCE_MS = 600;

const str = (v) => String(v ?? "").trim();
const now = () => Date.now();

let adapter = null;
const getAdapter = () => {
  if (adapter) return adapter;
  try {
    const idb = createDraftIdbAdapter();
    adapter = idb.available() ? idb : createMemoryDraftAdapter();
  } catch {
    adapter = createMemoryDraftAdapter();
  }
  return adapter;
};

export const __setAdapterForTests = (a) => { adapter = a; };
export const __resetAdapterForTests = () => { adapter = null; };

const guard = async (fn, fallback) => {
  try {
    return await fn(getAdapter());
  } catch {
    return fallback;
  }
};

// ---- Identity → namespace key (token NEVER included) -----------------------
// Requires tenant + employee + branch. Without all three we refuse to cache
// authenticated draft data (returns "").
const baseKey = (identity = {}) => {
  const t = str(identity.tenantId);
  const e = str(identity.employeeId);
  const b = str(identity.branchId);
  if (!t || !e || !b) return "";
  return `v${DRAFT_SCHEMA_VERSION}:t=${t}:e=${e}:b=${b}`;
};

export const warehouseKey = (identity = {}) => {
  const base = baseKey(identity);
  return base ? `wh:${base}` : "";
};

export const inventoryKey = (identity = {}) => {
  const base = baseKey(identity);
  const s = str(identity.sessionId);
  return base && s ? `inv:${base}:s=${s}` : "";
};

// ---- Debounced writes (per key; latest value wins) -------------------------
const pending = new Map(); // key -> { timer, record }

const flushKey = async (key) => {
  const entry = pending.get(key);
  if (!entry) return;
  pending.delete(key);
  if (entry.timer) clearTimeout(entry.timer);
  await guard((a) => a.set(key, entry.record), undefined);
};

export const flushPendingDraftWrites = async () => {
  const keys = [...pending.keys()];
  await Promise.all(keys.map(flushKey));
};

const scheduleWrite = (key, record) => {
  if (!key) return;
  const existing = pending.get(key);
  if (existing?.timer) clearTimeout(existing.timer);
  const timer = setTimeout(() => { void flushKey(key); }, DEBOUNCE_MS);
  // In Node/timers, unref so a pending write never holds the process open.
  if (typeof timer?.unref === "function") timer.unref();
  pending.set(key, { timer, record });
};

const makeRecord = (kind, identity, draft) => ({
  schema: DRAFT_SCHEMA_VERSION,
  kind,
  identity: {
    tenantId: str(identity.tenantId),
    employeeId: str(identity.employeeId),
    branchId: str(identity.branchId),
    sessionId: str(identity.sessionId) || undefined,
  },
  updatedAt: now(),
  draft,
});

const readRecord = async (key) => {
  if (!key) return null;
  // If a debounced write is pending for this key, prefer it (freshest).
  const p = pending.get(key);
  if (p) return p.record;
  const record = await guard((a) => a.get(key), null);
  if (!record || typeof record !== "object") return null;
  if (record.schema !== DRAFT_SCHEMA_VERSION) return null; // schema bump invalidates
  if (typeof record.updatedAt === "number" && now() - record.updatedAt > TTL_MS) {
    void guard((a) => a.delete(key), undefined);
    return null;
  }
  return record;
};

const removeKey = async (key) => {
  if (!key) return false;
  const p = pending.get(key);
  if (p?.timer) clearTimeout(p.timer);
  pending.delete(key);
  await guard((a) => a.delete(key), undefined);
  return true;
};

// ---- Warehouse Request draft ----------------------------------------------
export const saveWarehouseDraft = (identity, draft) => {
  const key = warehouseKey(identity);
  if (!key) return false;
  scheduleWrite(key, makeRecord("warehouse", identity, draft));
  return true;
};

export const loadWarehouseDraft = async (identity) => {
  const record = await readRecord(warehouseKey(identity));
  return record ? record.draft : null;
};

export const clearWarehouseDraft = (identity) => removeKey(warehouseKey(identity));

// ---- Inventory Count draft -------------------------------------------------
export const saveInventoryDraft = (identity, draft) => {
  const key = inventoryKey(identity);
  if (!key) return false;
  scheduleWrite(key, makeRecord("inventory", identity, draft));
  return true;
};

export const loadInventoryDraft = async (identity) => {
  const record = await readRecord(inventoryKey(identity));
  return record ? record.draft : null;
};

export const clearInventoryDraft = (identity) => removeKey(inventoryKey(identity));

// ---- Retention / cleanup ---------------------------------------------------
// Delete expired drafts (opportunistic sweep on mount). Bounded + content-free.
export const sweepExpiredDrafts = async () => {
  const keys = await guard((a) => a.keys(), []);
  if (!Array.isArray(keys) || !keys.length) return 0;
  let removed = 0;
  for (const key of keys) {
    const record = await guard((a) => a.get(key), null);
    const stale = !record || record.schema !== DRAFT_SCHEMA_VERSION
      || (typeof record.updatedAt === "number" && now() - record.updatedAt > TTL_MS);
    if (stale) {
      await guard((a) => a.delete(key), undefined);
      removed += 1;
    }
  }
  return removed;
};

// ---- Inventory reconciliation (pure) ---------------------------------------
// Merge a restored LOCAL draft with the authoritative SERVER session rows by
// stable variant identity. Precedence is explicit and safe:
//   - No duplicates (keyed by variant id).
//   - Server rows are the baseline (authoritative for stock/expected values).
//   - A LOCAL counted quantity overlays the server row ONLY when the local edit
//     is strictly newer than the server row's timestamp (a newer unsynced local
//     edit is never overwritten by a stale server value).
//   - When the server row is newer AND the local counted value differs, the row
//     is flagged `_conflict: true` so the UI can surface it instead of silently
//     choosing.
// Field accessors are injectable so this stays correct regardless of the exact
// column names used by the session payload.
export const reconcileInventoryRows = ({
  localRows = [],
  serverRows = [],
  keyOf = (r) => String(r?.variant_id ?? r?.id ?? ""),
  countOf = (r) => Number(r?.counted_quantity ?? r?.count ?? 0),
  localTs = (r) => Number(r?.local_updated_at ?? r?.updatedAt ?? 0),
  serverTs = (r) => Number(r?.updated_at ?? r?.server_updated_at ?? 0),
} = {}) => {
  const merged = new Map();
  for (const row of Array.isArray(serverRows) ? serverRows : []) {
    const k = keyOf(row);
    if (k) merged.set(k, row);
  }
  for (const local of Array.isArray(localRows) ? localRows : []) {
    const k = keyOf(local);
    if (!k) continue;
    const server = merged.get(k);
    if (!server) { merged.set(k, local); continue; }
    if (localTs(local) > serverTs(server)) {
      merged.set(k, { ...server, ...local }); // newer local edit wins
    } else if (countOf(local) !== countOf(server)) {
      merged.set(k, { ...server, _conflict: true }); // stale local edit differs -> surface
    }
  }
  return [...merged.values()];
};

// Wipe every draft (logout / session invalidation) so a previous employee's
// working data is unreachable by the next user on the device.
export const clearAllDrafts = async () => {
  for (const [, entry] of pending) if (entry.timer) clearTimeout(entry.timer);
  pending.clear();
  await guard((a) => a.clear(), undefined);
  return true;
};
