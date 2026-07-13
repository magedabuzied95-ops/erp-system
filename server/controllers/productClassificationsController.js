import db from "../database/db.js";
import { invalidateCachePattern } from "../services/cacheService.js";
import {
  ensureProductClassificationSchema,
  fetchProductClassificationGroupByKey,
  fetchProductClassificationGroups,
  fetchProductClassificationOptions,
  normalizeClassificationInput,
} from "../services/productClassificationsService.js";

const normalizeKey = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/[^a-z0-9_]/g, "");

const normalizeText = (value) => String(value ?? "").trim();
const toInt = (value, fallback = 0) => {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const toBoolean = (value, fallback = true) => {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  const text = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "active"].includes(text)) return true;
  if (["0", "false", "no", "inactive"].includes(text)) return false;
  return fallback;
};

const removedClassificationKeys = new Set(["style"]);
const isRemovedClassificationKey = (key) => removedClassificationKeys.has(normalizeKey(key));

const groupPayload = (body = {}) => ({
  key: normalizeKey(body.key),
  name_ar: normalizeText(body.name_ar),
  name_en: normalizeText(body.name_en),
  sort_order: toInt(body.sort_order, 0),
  is_active: toBoolean(body.is_active, true),
});

const optionPayload = (body = {}) => ({
  group_id: body.group_id ?? null,
  group_key: normalizeKey(body.group_key),
  value: normalizeText(body.value).toLowerCase().replace(/[\s-]+/g, "_").replace(/[^a-z0-9_]/g, ""),
  label_ar: normalizeText(body.label_ar),
  label_en: normalizeText(body.label_en),
  icon: normalizeText(body.icon),
  color: normalizeText(body.color),
  sort_order: toInt(body.sort_order, 0),
  is_active: toBoolean(body.is_active, true),
});

const serializeOption = (option = {}) => ({
  id: option.id,
  value: option.value,
  name_ar: option.name_ar || option.label_ar || "",
  name_en: option.name_en || option.label_en || "",
  label_ar: option.label_ar,
  label_en: option.label_en,
  english_name: option.english_name || option.label_en || "",
  icon: option.icon,
  color: option.color,
  sort_order: option.sort_order,
  is_active: option.is_active,
});

const serializeGroups = (groups = []) =>
  groups.map((group) => ({
    ...group,
    options: (group.options || []).map(serializeOption),
  }));

const resolveGroupId = async ({ group_id, group_key }) => {
  if (group_id) return Number(group_id);
  const key = normalizeKey(group_key);
  if (!key) return null;
  const groups = await fetchProductClassificationGroups({ includeInactive: true });
  return groups.find((group) => String(group.key || "") === key)?.id || null;
};


const safeDuplicateOptionMessage = "This classification option already exists in the same group.";

const assertUniqueOptionValue = async (client, { groupId, value, excludeId = null }) => {
  const params = [groupId, value];
  const excludeClause = excludeId ? "AND id <> $3" : "";
  if (excludeId) params.push(excludeId);
  const result = await client.query(
    `
    SELECT id
    FROM product_classification_options
    WHERE group_id = $1
      AND LOWER(TRIM(value)) = LOWER(TRIM($2))
      AND deleted_at IS NULL
      ${excludeClause}
    LIMIT 1
    `,
    params
  );
  if (result.rows[0]) {
    const error = new Error(safeDuplicateOptionMessage);
    error.status = 400;
    throw error;
  }
};

const invalidateProductClassificationCaches = async () => {
  await Promise.all([
    invalidateCachePattern("storefront:*"),
    invalidateCachePattern("product-classifications:*"),
  ]).catch((error) => {
    console.warn("[product-classifications] cache invalidation skipped", error?.message || error);
  });
};

const repairProductTypeGroupIfNeeded = async () => {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const repaired = await client.query(`
      WITH candidate AS (
        SELECT g.id
        FROM product_classification_groups g
        LEFT JOIN product_classification_options o
          ON o.group_id = g.id
         AND o.deleted_at IS NULL
        WHERE g.deleted_at IS NULL
          AND LOWER(TRIM(COALESCE(o.value, ''))) IN ('sneakers', 'bags', 'crocs')
          AND NOT EXISTS (
            SELECT 1
            FROM product_classification_groups current_type
            WHERE current_type.deleted_at IS NULL
              AND LOWER(TRIM(current_type.key)) = 'product_type'
          )
        GROUP BY g.id
        HAVING COUNT(DISTINCT LOWER(TRIM(o.value))) >= 2
        ORDER BY COUNT(DISTINCT LOWER(TRIM(o.value))) DESC, g.id ASC
        LIMIT 1
      )
      UPDATE product_classification_groups g
      SET key = 'product_type',
          name_ar = 'نوع المنتج',
          name_en = 'Product Type',
          is_active = TRUE,
          deleted_at = NULL,
          updated_at = CURRENT_TIMESTAMP
      FROM candidate
      WHERE g.id = candidate.id
      RETURNING g.id
    `);
    if (repaired.rowCount > 0) {
      await client.query(`
        INSERT INTO product_classification_options (group_id, value, label_ar, label_en, icon, color, sort_order, is_active, deleted_at)
        VALUES ($1, 'slippers', 'سليبرز', 'Slippers', 'S', '', 4, TRUE, NULL)
        ON CONFLICT (group_id, value) DO UPDATE SET
          label_ar = EXCLUDED.label_ar,
          label_en = EXCLUDED.label_en,
          icon = EXCLUDED.icon,
          sort_order = EXCLUDED.sort_order,
          is_active = TRUE,
          deleted_at = NULL,
          updated_at = CURRENT_TIMESTAMP
      `, [repaired.rows[0].id]);
    }
    await client.query("COMMIT");
    if (repaired.rowCount > 0) await invalidateProductClassificationCaches();
    return repaired.rowCount > 0;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

const columnCandidatesForGroup = (groupKey) => ({
  gender: ["gender"],
  product_type: ["product_type", "productType", "type"],
  grade: ["grade", "product_grade"],
}[normalizeKey(groupKey)] || [normalizeKey(groupKey)]);

const existingColumns = async (client, tableName, candidates = []) => {
  if (!candidates.length) return [];
  const result = await client.query(
    `
    SELECT column_name, is_nullable
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = $1
      AND column_name = ANY($2::text[])
    `,
    [tableName, candidates]
  );
  return result.rows;
};

const tableExists = async (client, tableName) => {
  const result = await client.query(
    `
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = current_schema()
      AND table_name = $1
    LIMIT 1
    `,
    [tableName]
  );
  return Boolean(result.rows[0]);
};

const clearProductClassificationReferences = async (client, { groupKey, options = [] }) => {
  const aliases = [...new Set(options.flatMap((option = {}) => [
    option.value,
    option.label_ar,
    option.label_en,
    option.name_ar,
    option.name_en,
    option.english_name,
  ]).map((value) => normalizeText(value).toLowerCase()).filter(Boolean))];
  const optionIds = options.map((option) => Number(option.id)).filter((id) => Number.isFinite(id));
  const groupColumns = columnCandidatesForGroup(groupKey);
  const touched = [];

  for (const tableName of ["products", "product_variants"]) {
    const fieldColumns = await existingColumns(client, tableName, groupColumns);
    for (const column of fieldColumns) {
      if (!aliases.length) continue;
      const nextValue = column.is_nullable === "NO" ? "" : null;
      const result = await client.query(
        `UPDATE ${tableName} SET "${column.column_name}" = $1 WHERE LOWER(TRIM(COALESCE("${column.column_name}"::text, ''))) = ANY($2::text[])`,
        [nextValue, aliases]
      );
      touched.push({ table: tableName, column: column.column_name, rows: result.rowCount });
    }

    const idColumns = await existingColumns(client, tableName, ["product_classification_id", "classification_id"]);
    for (const column of idColumns) {
      if (!optionIds.length) continue;
      const nextValue = column.is_nullable === "NO" ? 0 : null;
      const result = await client.query(
        `UPDATE ${tableName} SET "${column.column_name}" = $1 WHERE "${column.column_name}" = ANY($2::bigint[])`,
        [nextValue, optionIds]
      );
      touched.push({ table: tableName, column: column.column_name, rows: result.rowCount });
    }
  }

  if (await tableExists(client, "product_classifications")) {
    const joinColumns = await existingColumns(client, "product_classifications", ["option_id", "classification_id", "product_classification_id"]);
    const conditions = joinColumns
      .map((column) => `"${column.column_name}" = ANY($1::bigint[])`)
      .join(" OR ");
    if (conditions && optionIds.length) {
      const result = await client.query(`DELETE FROM product_classifications WHERE ${conditions}`, [optionIds]);
      touched.push({ table: "product_classifications", column: "mapping", rows: result.rowCount });
    }
  }

  console.log("[product-classifications-cleanup]", { groupKey, optionIds, aliases, touched });
};

export const listProductClassifications = async (req, res) => {
  try {
    await ensureProductClassificationSchema();
    await repairProductTypeGroupIfNeeded();
    const includeInactive = String(req.query.includeInactive || "").trim() === "1";
    const activeOnly = String(req.query.activeOnly || "").trim() === "1";
    const groups = await fetchProductClassificationGroups({ includeInactive: includeInactive && !activeOnly });
    res.json({ success: true, groups: serializeGroups(groups) });
  } catch (error) {
    console.error("[product-classifications] list error", error);
    res.status(500).json({ success: false, message: error.message || "Failed to load product classifications" });
  }
};

export const listProductClassificationOptions = async (req, res) => {
  try {
    const includeInactive = String(req.query.includeInactive || "").trim() === "1";
    const activeOnly = String(req.query.activeOnly || "").trim() === "1";
    const group = await fetchProductClassificationGroupByKey(req.params.groupKey, { includeInactive: includeInactive && !activeOnly });
    if (!group) {
      return res.status(404).json({ success: false, message: "Classification group not found" });
    }
    res.json({ success: true, group: { ...group, options: serializeGroups([group])[0]?.options || [] }, options: serializeGroups([group])[0]?.options || [] });
  } catch (error) {
    console.error("[product-classifications] options error", error);
    res.status(500).json({ success: false, message: error.message || "Failed to load classification options" });
  }
};

export const createProductClassificationGroup = async (req, res) => {
  const client = await db.connect();
  try {
    await ensureProductClassificationSchema();
    const payload = groupPayload(req.body || {});
    if (!payload.key || !payload.name_ar || !payload.name_en) {
      return res.status(400).json({ success: false, message: "key, name_ar, and name_en are required" });
    }
    if (isRemovedClassificationKey(payload.key)) {
      return res.status(400).json({ success: false, message: "This classification group is no longer supported" });
    }
    await client.query("BEGIN");
    const result = await client.query(
      `
      INSERT INTO product_classification_groups (key, name_ar, name_en, sort_order, is_active)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (key) DO UPDATE SET
        name_ar = EXCLUDED.name_ar,
        name_en = EXCLUDED.name_en,
        sort_order = EXCLUDED.sort_order,
        is_active = EXCLUDED.is_active,
        deleted_at = NULL,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
      `,
      [payload.key, payload.name_ar, payload.name_en, payload.sort_order, payload.is_active]
    );
    await client.query("COMMIT");
    await invalidateProductClassificationCaches();
    res.status(201).json({ success: true, group: serializeGroups([{ ...result.rows[0], options: [] }])[0] });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("[product-classifications] create group error", error);
    res.status(500).json({ success: false, message: error.message || "Failed to create group" });
  } finally {
    client.release();
  }
};

export const updateProductClassificationGroup = async (req, res) => {
  const client = await db.connect();
  try {
    await ensureProductClassificationSchema();
    const payload = groupPayload(req.body || {});
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ success: false, message: "Invalid group id" });
    }
    if (!payload.key || !payload.name_ar || !payload.name_en) {
      return res.status(400).json({ success: false, message: "key, name_ar, and name_en are required" });
    }
    const currentGroup = await client.query(
      "SELECT key FROM product_classification_groups WHERE id = $1 AND deleted_at IS NULL LIMIT 1",
      [id]
    );
    const currentKey = normalizeKey(currentGroup.rows[0]?.key);
    if (currentKey && payload.key !== currentKey) {
      return res.status(400).json({ success: false, message: "Classification group keys cannot be changed after creation" });
    }
    if (isRemovedClassificationKey(payload.key)) {
      return res.status(400).json({ success: false, message: "This classification group is no longer supported" });
    }
    await client.query("BEGIN");
    const result = await client.query(
      `
      UPDATE product_classification_groups
      SET key = $1, name_ar = $2, name_en = $3, sort_order = $4, is_active = $5, updated_at = CURRENT_TIMESTAMP
      WHERE id = $6 AND deleted_at IS NULL
      RETURNING *
      `,
      [payload.key, payload.name_ar, payload.name_en, payload.sort_order, payload.is_active, id]
    );
    await client.query("COMMIT");
    await invalidateProductClassificationCaches();
    if (!result.rows[0]) {
      return res.status(404).json({ success: false, message: "Classification group not found" });
    }
    res.json({ success: true, group: { ...result.rows[0], options: [] } });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("[product-classifications] update group error", error);
    res.status(500).json({ success: false, message: error.message || "Failed to update group" });
  } finally {
    client.release();
  }
};

export const deleteProductClassificationGroup = async (req, res) => {
  const client = await db.connect();
  try {
    await ensureProductClassificationSchema();
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ success: false, message: "Invalid group id" });
    }
    await client.query("BEGIN");
    const result = await client.query(
      `
      UPDATE product_classification_groups
      SET is_active = FALSE, deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND deleted_at IS NULL
      RETURNING id, key
      `,
      [id]
    );
    if (!result.rows[0]) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, message: "Classification group not found" });
    }
    const optionsResult = await client.query(
      `
      UPDATE product_classification_options
      SET is_active = FALSE, deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE group_id = $1 AND deleted_at IS NULL
      RETURNING id, value, label_ar, label_en
      `,
      [id]
    );
    await clearProductClassificationReferences(client, { groupKey: result.rows[0].key, options: optionsResult.rows });
    console.log("[product-classifications] delete group", {
      id,
      affectedRows: result.rowCount,
      optionAffectedRows: optionsResult.rowCount,
      result: result.rows[0],
    });
    await client.query("COMMIT");
    await invalidateProductClassificationCaches();
    res.json({ success: true });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("[product-classifications] delete group error", error);
    res.status(500).json({ success: false, message: error.message || "Failed to deactivate group" });
  } finally {
    client.release();
  }
};

export const createProductClassificationOption = async (req, res) => {
  const client = await db.connect();
  try {
    await ensureProductClassificationSchema();
    await repairProductTypeGroupIfNeeded();
    const payload = optionPayload(req.body || {});
    const groupId = await resolveGroupId(payload);
    if (!groupId) {
      return res.status(400).json({ success: false, message: "group_id or group_key is required" });
    }
    const group = await fetchProductClassificationGroups({ includeInactive: true }).then((groups) => groups.find((item) => Number(item.id) === Number(groupId)));
    if (isRemovedClassificationKey(group?.key || payload.group_key)) {
      return res.status(400).json({ success: false, message: "This classification group is no longer supported" });
    }
    if (!payload.value || !payload.label_ar || !payload.label_en) {
      return res.status(400).json({ success: false, message: "value, label_ar, and label_en are required" });
    }
    await client.query("BEGIN");
    const existing = await client.query(
      `SELECT id
       FROM product_classification_options
       WHERE group_id = $1 AND LOWER(TRIM(value)) = LOWER(TRIM($2))
       ORDER BY id ASC
       LIMIT 1
       FOR UPDATE`,
      [groupId, payload.value]
    );
    const values = [groupId, payload.value, payload.label_ar, payload.label_en, payload.icon, payload.color, payload.sort_order, payload.is_active];
    const result = existing.rows[0]
      ? await client.query(
          `UPDATE product_classification_options
           SET group_id = $1, value = $2, label_ar = $3, label_en = $4, icon = $5, color = $6,
               sort_order = $7, is_active = $8, deleted_at = NULL, updated_at = CURRENT_TIMESTAMP
           WHERE id = $9
           RETURNING *`,
          [...values, existing.rows[0].id]
        )
      : await client.query(
          `INSERT INTO product_classification_options (group_id, value, label_ar, label_en, icon, color, sort_order, is_active)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING *`,
          values
        );
    await client.query("COMMIT");
    await invalidateProductClassificationCaches();
    res.status(201).json({ success: true, option: serializeOption(result.rows[0]) });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("[product-classifications] create option error", error);
    const status = error.status || (error.code === "23505" ? 400 : 500);
    res.status(status).json({ success: false, message: error.code === "23505" ? safeDuplicateOptionMessage : error.message || "Failed to create option" });
  } finally {
    client.release();
  }
};

export const updateProductClassificationOption = async (req, res) => {
  const client = await db.connect();
  try {
    await ensureProductClassificationSchema();
    const payload = optionPayload(req.body || {});
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ success: false, message: "Invalid option id" });
    }
    if (!payload.value || !payload.label_ar || !payload.label_en) {
      return res.status(400).json({ success: false, message: "value, label_ar, and label_en are required" });
    }
    const groupId = await resolveGroupId(payload);
    if (!groupId) {
      return res.status(400).json({ success: false, message: "group_id or group_key is required" });
    }
    await client.query("BEGIN");
    await assertUniqueOptionValue(client, { groupId, value: payload.value, excludeId: id });
    const result = await client.query(
      `
      UPDATE product_classification_options
      SET group_id = $1, value = $2, label_ar = $3, label_en = $4, icon = $5, color = $6, sort_order = $7, is_active = $8, updated_at = CURRENT_TIMESTAMP
      WHERE id = $9 AND deleted_at IS NULL
      RETURNING *
      `,
      [groupId, payload.value, payload.label_ar, payload.label_en, payload.icon, payload.color, payload.sort_order, payload.is_active, id]
    );
    await client.query("COMMIT");
    await invalidateProductClassificationCaches();
    if (!result.rows[0]) {
      return res.status(404).json({ success: false, message: "Classification option not found" });
    }
    res.json({ success: true, option: serializeOption(result.rows[0]) });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("[product-classifications] update option error", error);
    const status = error.status || (error.code === "23505" ? 400 : 500);
    res.status(status).json({ success: false, message: error.code === "23505" ? safeDuplicateOptionMessage : error.message || "Failed to update option" });
  } finally {
    client.release();
  }
};

export const deleteProductClassificationOption = async (req, res) => {
  const client = await db.connect();
  try {
    await ensureProductClassificationSchema();
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ success: false, message: "Invalid option id" });
    }
    await client.query("BEGIN");
    const optionResult = await client.query(
      `
      SELECT o.id, o.group_id, o.value, o.label_ar, o.label_en, g.key AS group_key
      FROM product_classification_options o
      JOIN product_classification_groups g ON g.id = o.group_id
      WHERE o.id = $1 AND o.deleted_at IS NULL
      `,
      [id]
    );
    const option = optionResult.rows[0];
    if (!option) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, message: "Classification option not found" });
    }
    await clearProductClassificationReferences(client, { groupKey: option.group_key, options: [option] });
    const result = await client.query(
      `
      UPDATE product_classification_options
      SET is_active = FALSE, deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND deleted_at IS NULL
      RETURNING id
      `,
      [id]
    );
    if (!result.rows[0]) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, message: "Classification option not found" });
    }
    console.log("[product-classifications] delete option", {
      id,
      affectedRows: result.rowCount,
      result: result.rows[0],
    });
    await client.query("COMMIT");
    await invalidateProductClassificationCaches();
    res.json({ success: true });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("[product-classifications] delete option error", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Failed to delete option" });
  } finally {
    client.release();
  }
};

export const resolveProductClassificationValue = normalizeClassificationInput;
export { fetchProductClassificationGroups, fetchProductClassificationOptions };
