/**
 * Saved report presets — B-3 of the retirement assessment.
 *
 * The legacy page kept presets in `localStorage` under `erp.reports.presets.v1`. That is
 * why the retirement assessment could not answer "does anybody rely on this?": the data
 * lived in each person's browser where no query could reach it, and retiring the page
 * would have deleted it with no warning and no export.
 *
 * These live in the database instead, and that choice is load-bearing rather than tidy:
 *
 *   - **Per user, not per browser.** A preset is scoped to `(tenant_id, user_id)` and
 *     every read filters on the caller's own id. Two people sharing a terminal — normal
 *     in a shop — cannot see each other's saved views, which localStorage could not
 *     promise.
 *   - **Filters only, never results.** A preset stores the QUESTION, never the answer.
 *     Nothing here holds a figure, a row, a total or a customer. So a preset can never
 *     become a way to read numbers the reader's permissions would otherwise withhold, and
 *     a stale preset shows today's data rather than a snapshot of somebody's Tuesday.
 *   - **Validated against the server's own contract.** Keys outside the supported filter
 *     set are dropped on the way in, not on the way out. A preset written by an older
 *     client, or by hand, cannot smuggle a key the query layer would then have to defend
 *     against.
 */

import db from "../../database/db.js";
import { parseAnalyticsFilters } from "./analyticsFilters.js";
import { ORDER_FILTER_KEYS } from "./analyticsOrderFilters.js";

/** Every key a preset may carry. Anything else is dropped silently on save. */
export const PRESET_FILTER_KEYS = Object.freeze([
  "preset", "from", "to", "compare",
  ...ORDER_FILTER_KEYS,
  // R3/R4 product-attribute filters and the table state that makes a saved view useful.
  "productType", "brandId", "category", "gender", "dimension", "sort", "sortDir",
]);

/** Pages a preset may belong to. A preset is meaningless outside the page it was saved on. */
export const PRESET_PAGES = Object.freeze([
  "overview", "sales", "inventory", "purchasing", "customers", "employees", "reconciliation", "coupons",
]);

export const MAX_PRESETS_PER_USER = 24;
const MAX_NAME_LENGTH = 60;

/**
 * Create the table once per process.
 *
 * Memoised deliberately. `ensureAccountingSchema` runs its DDL on every request and that
 * is what produced the 40P01 deadlock against the analytics reads; a promise cached at
 * module scope means the DDL is attempted once and every later call awaits the same
 * result. `IF NOT EXISTS` throughout, so a second process racing this is harmless.
 */
let schemaPromise = null;
export const ensurePresetSchema = () => {
  if (!schemaPromise) {
    schemaPromise = db
      .query(`
        CREATE TABLE IF NOT EXISTS report_presets (
          id          BIGSERIAL PRIMARY KEY,
          tenant_id   BIGINT      NOT NULL,
          user_id     BIGINT      NOT NULL,
          page        VARCHAR(32) NOT NULL,
          name        VARCHAR(80) NOT NULL,
          filters     JSONB       NOT NULL DEFAULT '{}'::jsonb,
          pinned      BOOLEAN     NOT NULL DEFAULT FALSE,
          created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
          updated_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
        )
      `)
      .then(() =>
        db.query(`
          CREATE INDEX IF NOT EXISTS idx_report_presets_owner
            ON report_presets (tenant_id, user_id, page)
        `)
      )
      .catch((error) => {
        // Let the next call retry rather than caching a failure forever, but never let a
        // schema problem take the report down with it — the caller decides.
        schemaPromise = null;
        throw error;
      });
  }
  return schemaPromise;
};

/**
 * Keep only keys the server supports, then prove the result parses.
 *
 * Two passes on purpose. The allowlist stops an unknown key being stored at all; the
 * parse proves the VALUES are ones the query layer would accept, so a preset can never
 * be saved that fails the moment it is applied.
 */
export const sanitiseFilters = (input = {}) => {
  const picked = {};
  for (const key of PRESET_FILTER_KEYS) {
    const value = input?.[key];
    if (value === undefined || value === null || value === "") continue;
    if (typeof value === "object") continue; // no nested structures; a filter is a scalar
    picked[key] = String(value).slice(0, 120);
  }

  // parseAnalyticsFilters throws on a range it cannot use, which is exactly the check we
  // want — a preset that cannot be applied must not be storable.
  const parsed = parseAnalyticsFilters({ query: picked, user: { tenant_id: 1 } });

  const clean = {};
  for (const key of PRESET_FILTER_KEYS) {
    if (picked[key] === undefined) continue;
    // Ids are kept only where the parser accepted them as positive integers.
    if (["branchId", "customerId", "shiftId", "salespersonId", "brandId"].includes(key)) {
      if (parsed[key]) clean[key] = String(parsed[key]);
      continue;
    }
    clean[key] = picked[key];
  }
  return clean;
};

const rowToPreset = (row) => ({
  id: String(row.id),
  page: row.page,
  name: row.name,
  filters: row.filters || {},
  pinned: Boolean(row.pinned),
  updatedAt: row.updated_at,
});

const owner = (context) => {
  const tenantId = context?.tenantId ?? null;
  const userId = context?.userId ?? null;
  if (!userId) throw Object.assign(new Error("A preset needs an owner"), { status: 401 });
  return { tenantId: tenantId ?? 0, userId };
};

export const listPresets = async ({ tenantId, userId, page }) => {
  await ensurePresetSchema();
  const scope = owner({ tenantId, userId });
  const clauses = ["tenant_id = $1", "user_id = $2"];
  const params = [scope.tenantId, scope.userId];
  if (page && PRESET_PAGES.includes(page)) {
    params.push(page);
    clauses.push(`page = $${params.length}`);
  }
  const result = await db.query(
    `SELECT * FROM report_presets WHERE ${clauses.join(" AND ")}
      ORDER BY pinned DESC, updated_at DESC LIMIT ${MAX_PRESETS_PER_USER}`,
    params
  );
  return { data: { presets: result.rows.map(rowToPreset) }, meta: { max: MAX_PRESETS_PER_USER } };
};

export const createPreset = async ({ tenantId, userId, page, name, filters }) => {
  await ensurePresetSchema();
  const scope = owner({ tenantId, userId });

  const cleanName = String(name || "").trim().slice(0, MAX_NAME_LENGTH);
  if (!cleanName) throw Object.assign(new Error("A preset needs a name"), { status: 400 });
  if (!PRESET_PAGES.includes(page)) throw Object.assign(new Error("Unknown report page"), { status: 400 });

  const count = await db.query(
    `SELECT COUNT(*)::int AS total FROM report_presets WHERE tenant_id = $1 AND user_id = $2`,
    [scope.tenantId, scope.userId]
  );
  if (Number(count.rows[0].total) >= MAX_PRESETS_PER_USER) {
    throw Object.assign(new Error(`At most ${MAX_PRESETS_PER_USER} presets`), { status: 409 });
  }

  const result = await db.query(
    `INSERT INTO report_presets (tenant_id, user_id, page, name, filters)
     VALUES ($1, $2, $3, $4, $5::jsonb) RETURNING *`,
    [scope.tenantId, scope.userId, page, cleanName, JSON.stringify(sanitiseFilters(filters))]
  );
  return { data: { preset: rowToPreset(result.rows[0]) } };
};

export const updatePreset = async ({ tenantId, userId, id, name, pinned }) => {
  await ensurePresetSchema();
  const scope = owner({ tenantId, userId });
  const sets = [];
  const params = [scope.tenantId, scope.userId, id];

  if (name !== undefined) {
    params.push(String(name).trim().slice(0, MAX_NAME_LENGTH));
    sets.push(`name = $${params.length}`);
  }
  if (pinned !== undefined) {
    params.push(Boolean(pinned));
    sets.push(`pinned = $${params.length}`);
  }
  if (!sets.length) throw Object.assign(new Error("Nothing to update"), { status: 400 });

  // The owner clause is in the WHERE, not checked beforehand: one statement, no window
  // between the check and the write in which the row could change hands.
  const result = await db.query(
    `UPDATE report_presets SET ${sets.join(", ")}, updated_at = NOW()
      WHERE tenant_id = $1 AND user_id = $2 AND id = $3 RETURNING *`,
    params
  );
  if (!result.rows.length) throw Object.assign(new Error("Preset not found"), { status: 404 });
  return { data: { preset: rowToPreset(result.rows[0]) } };
};

export const deletePreset = async ({ tenantId, userId, id }) => {
  await ensurePresetSchema();
  const scope = owner({ tenantId, userId });
  const result = await db.query(
    `DELETE FROM report_presets WHERE tenant_id = $1 AND user_id = $2 AND id = $3 RETURNING id`,
    [scope.tenantId, scope.userId, id]
  );
  if (!result.rows.length) throw Object.assign(new Error("Preset not found"), { status: 404 });
  return { data: { deleted: String(result.rows[0].id) } };
};

/**
 * One-time import of the legacy localStorage presets.
 *
 * The legacy shape is `{ id, name, activeTab, filters, pinned }`, where `activeTab` is
 * the legacy tab name and `filters` is its own filter object — including the two controls
 * that filter on columns nothing writes. Those keys are dropped by the allowlist, so an
 * imported preset filters on exactly what it can honestly filter on, and the response
 * says which keys were dropped rather than pretending the import was lossless.
 *
 * Idempotent by (page, name): running it twice does not duplicate, so a reader who clicks
 * import on two devices ends up with one copy.
 */
const LEGACY_TAB_TO_PAGE = Object.freeze({
  insights: "overview",
  sales: "sales",
  employees: "employees",
  inventory: "inventory",
  customers: "customers",
  financial: "reconciliation",
});

/**
 * The legacy filter object uses different names for the same things. Translating them is
 * the difference between importing a preset and importing its name.
 *
 * `startDate`/`endDate` -> `from`/`to`, and the legacy range presets are renamed. A
 * legacy "month" meant the current calendar month, which is `thisMonth` here; "week"
 * meant the current week. Getting this wrong would silently move somebody's saved window,
 * which is worse than refusing to import it.
 */
const LEGACY_RANGE_TO_PRESET = Object.freeze({
  today: "today",
  week: "thisWeek",
  month: "thisMonth",
  custom: "custom",
});

export const translateLegacyFilters = (legacyFilters = {}) => {
  const translated = { ...legacyFilters };

  if (legacyFilters.startDate) translated.from = legacyFilters.startDate;
  if (legacyFilters.endDate) translated.to = legacyFilters.endDate;
  delete translated.startDate;
  delete translated.endDate;

  const range = String(legacyFilters.preset || legacyFilters.range || "").toLowerCase();
  if (range) {
    // An unrecognised range is dropped rather than guessed. The reader keeps the rest of
    // the preset and lands on the default window, which is visible and correctable; a
    // wrong window looks right and is not.
    if (LEGACY_RANGE_TO_PRESET[range]) translated.preset = LEGACY_RANGE_TO_PRESET[range];
    else delete translated.preset;
  }

  return translated;
};

export const importLegacyPresets = async ({ tenantId, userId, presets = [] }) => {
  await ensurePresetSchema();
  const scope = owner({ tenantId, userId });

  const imported = [];
  const skipped = [];
  const droppedKeys = new Set();

  for (const legacy of Array.isArray(presets) ? presets.slice(0, MAX_PRESETS_PER_USER) : []) {
    const name = String(legacy?.name || "").trim().slice(0, MAX_NAME_LENGTH);
    const page = LEGACY_TAB_TO_PAGE[String(legacy?.activeTab || "").toLowerCase()] || "overview";
    if (!name) { skipped.push({ name: legacy?.name ?? null, reason: "no name" }); continue; }

    const translated = translateLegacyFilters(legacy?.filters || {});
    for (const key of Object.keys(translated)) {
      if (!PRESET_FILTER_KEYS.includes(key) && translated[key]) droppedKeys.add(key);
    }

    let filters;
    try {
      filters = sanitiseFilters(translated);
    } catch (error) {
      skipped.push({ name, reason: error.message });
      continue;
    }

    const result = await db.query(
      `INSERT INTO report_presets (tenant_id, user_id, page, name, filters, pinned)
       SELECT $1, $2, $3, $4, $5::jsonb, $6
        WHERE NOT EXISTS (
          SELECT 1 FROM report_presets
           WHERE tenant_id = $1 AND user_id = $2 AND page = $3 AND name = $4
        )
       RETURNING *`,
      [scope.tenantId, scope.userId, page, name, JSON.stringify(filters), Boolean(legacy?.pinned)]
    );

    if (result.rows.length) imported.push(rowToPreset(result.rows[0]));
    else skipped.push({ name, reason: "already imported" });
  }

  return {
    data: { imported, skipped },
    meta: {
      // Named, not silently swallowed: the reader should know their warehouse filter did
      // not survive, and why, rather than discovering it the next time they open the view.
      droppedFilterKeys: [...droppedKeys],
    },
  };
};
