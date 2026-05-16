import db from "../database/db.js";
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
const safeOptionInUseMessage = "This classification option is used by products and cannot be deleted.";

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

const optionUsageCount = async (client, { groupId, value }) => {
  const groupResult = await client.query("SELECT key FROM product_classification_groups WHERE id = $1", [groupId]);
  const groupKey = normalizeKey(groupResult.rows[0]?.key);
  const columnCandidates = {
    gender: ["gender"],
    product_type: ["product_type", "productType", "type"],
    style: ["style"],
    grade: ["grade", "product_grade"],
  }[groupKey] || [groupKey];
  const normalizedValue = normalizeText(value).toLowerCase();
  let total = 0;

  for (const tableName of ["products", "product_variants"]) {
    const columnsResult = await client.query(
      `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = $1
        AND column_name = ANY($2::text[])
      `,
      [tableName, columnCandidates]
    );
    const columns = columnsResult.rows.map((row) => row.column_name);
    if (!columns.length) continue;
    const where = columns.map((column) => `LOWER(TRIM(COALESCE("${column}"::text, ''))) = $1`).join(" OR ");
    const result = await client.query(`SELECT COUNT(*)::int AS total FROM ${tableName} WHERE ${where}`, [normalizedValue]);
    total += Number(result.rows[0]?.total || 0);
  }

  return total;
};

export const listProductClassifications = async (req, res) => {
  try {
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
      RETURNING id
      `,
      [id]
    );
    console.log("[product-classifications] delete group", {
      id,
      affectedRows: result.rowCount,
      optionAffectedRows: optionsResult.rowCount,
      result: result.rows[0],
    });
    await client.query("COMMIT");
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
    const payload = optionPayload(req.body || {});
    const groupId = await resolveGroupId(payload);
    if (!groupId) {
      return res.status(400).json({ success: false, message: "group_id or group_key is required" });
    }
    if (!payload.value || !payload.label_ar || !payload.label_en) {
      return res.status(400).json({ success: false, message: "value, label_ar, and label_en are required" });
    }
    await client.query("BEGIN");
    await assertUniqueOptionValue(client, { groupId, value: payload.value });
    const result = await client.query(
      `
      INSERT INTO product_classification_options (group_id, value, label_ar, label_en, icon, color, sort_order, is_active)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (group_id, value) DO UPDATE SET
        label_ar = EXCLUDED.label_ar,
        label_en = EXCLUDED.label_en,
        icon = EXCLUDED.icon,
        color = EXCLUDED.color,
        sort_order = EXCLUDED.sort_order,
        is_active = EXCLUDED.is_active,
        deleted_at = NULL,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
      `,
      [groupId, payload.value, payload.label_ar, payload.label_en, payload.icon, payload.color, payload.sort_order, payload.is_active]
    );
    await client.query("COMMIT");
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
      SELECT id, group_id, value
      FROM product_classification_options
      WHERE id = $1 AND deleted_at IS NULL
      `,
      [id]
    );
    const option = optionResult.rows[0];
    if (!option) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, message: "Classification option not found" });
    }
    const usageCount = await optionUsageCount(client, { groupId: option.group_id, value: option.value });
    if (usageCount > 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({ success: false, message: safeOptionInUseMessage });
    }
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
