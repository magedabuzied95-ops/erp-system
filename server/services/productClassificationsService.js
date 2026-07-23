import db from "../database/db.js";

const CLASSIFICATION_KEYS = ["gender", "product_type", "grade", "bag_type"];
let productClassificationSchemaPromise = null;
let productClassificationSchemaEnsured = false;

const normalizeText = (value) => String(value ?? "").trim();

const normalizeKey = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/[^a-z0-9_]/g, "");

const ensureProductClassificationSchemaNow = async () => {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query(`
      CREATE TABLE IF NOT EXISTS product_classification_groups (
        id BIGSERIAL PRIMARY KEY,
        key VARCHAR(80) NOT NULL UNIQUE,
        name_ar VARCHAR(255) NOT NULL DEFAULT '',
        name_en VARCHAR(255) NOT NULL DEFAULT '',
        sort_order INTEGER NOT NULL DEFAULT 0,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS product_classification_options (
        id BIGSERIAL PRIMARY KEY,
        group_id BIGINT NOT NULL REFERENCES product_classification_groups(id) ON DELETE CASCADE,
        value VARCHAR(120) NOT NULL,
        label_ar VARCHAR(255) NOT NULL DEFAULT '',
        label_en VARCHAR(255) NOT NULL DEFAULT '',
        icon VARCHAR(80) DEFAULT '',
        color VARCHAR(80) DEFAULT '',
        sort_order INTEGER NOT NULL DEFAULT 0,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(group_id, value)
      )
    `);
    await client.query(`ALTER TABLE product_classification_groups ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP`);
    await client.query(`ALTER TABLE product_classification_options ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP`);
    await client.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS bag_type TEXT`);
    await client.query(`
      INSERT INTO product_classification_groups (key, name_ar, name_en, sort_order, is_active, deleted_at)
      VALUES ('bag_type', 'نوع الشنطة', 'Bag Type', 5, TRUE, NULL)
      ON CONFLICT (key) DO UPDATE SET
        name_ar = EXCLUDED.name_ar,
        name_en = EXCLUDED.name_en,
        deleted_at = NULL
    `);
    await client.query(`
      INSERT INTO product_classification_options
        (group_id, value, label_ar, label_en, icon, color, sort_order, is_active, deleted_at)
      SELECT bag_group.id, option.value, option.label_ar, option.label_en, 'B', '', option.sort_order, TRUE, NULL
      FROM product_classification_groups bag_group
      CROSS JOIN (
        VALUES
          ('handbag', 'شنطة يد', 'Handbag', 1),
          ('shoulder-bag', 'شنطة كتف', 'Shoulder Bag', 2),
          ('crossbody-bag', 'كروس', 'Crossbody Bag', 3),
          ('tote-bag', 'توت', 'Tote Bag', 4),
          ('waist-bag', 'شنطة خصر', 'Waist Bag', 5),
          ('school-bag', 'شنطة مدرسية', 'School Bag', 6),
          ('clutch', 'كلاتش', 'Clutch', 7),
          ('bucket-bag', 'باكيت', 'Bucket Bag', 8)
      ) AS option(value, label_ar, label_en, sort_order)
      WHERE bag_group.key = 'bag_type'
      ON CONFLICT (group_id, value) DO NOTHING
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_product_classification_groups_sort ON product_classification_groups (sort_order, id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_product_classification_options_group_sort ON product_classification_options (group_id, sort_order, id)`);
    const repairedProductTypeGroup = await client.query(`
      WITH candidate AS (
        SELECT g.id
        FROM product_classification_groups g
        LEFT JOIN product_classification_options o
          ON o.group_id = g.id
         AND o.deleted_at IS NULL
        WHERE g.deleted_at IS NULL
          AND (
            LOWER(TRIM(g.key)) = 'slippers'
            OR LOWER(TRIM(o.value)) IN ('sneakers', 'bags', 'crocs')
          )
          AND NOT EXISTS (
            SELECT 1
            FROM product_classification_groups current_type
            WHERE current_type.deleted_at IS NULL
              AND LOWER(TRIM(current_type.key)) = 'product_type'
          )
        GROUP BY g.id, g.key
        ORDER BY
          CASE WHEN LOWER(TRIM(g.key)) = 'slippers' THEN 0 ELSE 1 END,
          COUNT(o.id) DESC,
          g.id ASC
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
    if (repairedProductTypeGroup.rowCount > 0) {
      await client.query(`
        INSERT INTO product_classification_options (group_id, value, label_ar, label_en, icon, color, sort_order, is_active, deleted_at)
        SELECT id, 'slippers', 'سليبرز', 'Slippers', 'S', '', 4, TRUE, NULL
        FROM product_classification_groups
        WHERE deleted_at IS NULL
          AND LOWER(TRIM(key)) = 'product_type'
        ON CONFLICT (group_id, value) DO UPDATE SET
          label_ar = EXCLUDED.label_ar,
          label_en = EXCLUDED.label_en,
          icon = EXCLUDED.icon,
          sort_order = EXCLUDED.sort_order,
          is_active = TRUE,
          deleted_at = NULL,
          updated_at = CURRENT_TIMESTAMP
      `);
    }
    // Repair the legacy hidden Slides option once. After its label is migrated to
    // Slippers, a future deliberate deactivation remains respected on restarts.
    await client.query(`
      INSERT INTO product_classification_options (group_id, value, label_ar, label_en, icon, color, sort_order, is_active, deleted_at)
      SELECT id, 'slippers', 'سليبرز', 'Slippers', 'S', '', 4, TRUE, NULL
      FROM product_classification_groups
      WHERE deleted_at IS NULL
        AND LOWER(TRIM(key)) = 'product_type'
      ON CONFLICT (group_id, value) DO UPDATE SET
        label_ar = EXCLUDED.label_ar,
        label_en = EXCLUDED.label_en,
        icon = COALESCE(NULLIF(product_classification_options.icon, ''), EXCLUDED.icon),
        sort_order = EXCLUDED.sort_order,
        is_active = TRUE,
        deleted_at = NULL,
        updated_at = CURRENT_TIMESTAMP
      WHERE LOWER(TRIM(product_classification_options.label_en)) = 'slides'
        AND (
          product_classification_options.is_active = FALSE
          OR product_classification_options.deleted_at IS NOT NULL
        )
    `);
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM (
            SELECT group_id, LOWER(TRIM(value)) AS normalized_value, COUNT(*) AS total
            FROM product_classification_options
            WHERE deleted_at IS NULL
            GROUP BY group_id, LOWER(TRIM(value))
          ) duplicates
          WHERE duplicates.total > 1
        ) THEN
          EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS idx_product_classification_options_group_normalized_value ON product_classification_options (group_id, LOWER(TRIM(value))) WHERE deleted_at IS NULL';
        END IF;
      END
      $$;
    `);

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

export const ensureProductClassificationSchema = async () => {
  if (productClassificationSchemaEnsured) return;
  if (!productClassificationSchemaPromise) {
    productClassificationSchemaPromise = ensureProductClassificationSchemaNow()
      .then(() => {
        productClassificationSchemaEnsured = true;
      })
      .catch((error) => {
        productClassificationSchemaPromise = null;
        throw error;
      });
  }
  await productClassificationSchemaPromise;
};

const fetchGroupsBase = async ({ includeInactive = false } = {}) => {
  const activeGroupClause = includeInactive ? "" : "AND is_active = TRUE";
  const activeOptionClause = includeInactive ? "" : "AND o.is_active = TRUE";
  const groupsResult = await db.query(
    `
    SELECT id, key, name_ar, name_en, name_en AS english_name, sort_order, is_active, created_at, updated_at
    FROM product_classification_groups
    WHERE deleted_at IS NULL
      ${activeGroupClause}
    ORDER BY sort_order ASC, id ASC
    `
  );
  const optionsResult = await db.query(
    `
    SELECT
      o.id,
      o.group_id,
      o.value,
      o.label_ar,
      o.label_en,
      o.label_en AS english_name,
      o.icon,
      o.color,
      o.sort_order,
      o.is_active,
      o.created_at,
      o.updated_at,
      g.key AS group_key
    FROM product_classification_options o
    JOIN product_classification_groups g ON g.id = o.group_id
    WHERE o.deleted_at IS NULL
      AND g.deleted_at IS NULL
      ${activeOptionClause}
    ORDER BY o.group_id ASC, o.sort_order ASC, o.id ASC
    `
  );

  const optionsByGroupId = new Map();
  optionsResult.rows.forEach((option) => {
    if (!optionsByGroupId.has(option.group_id)) optionsByGroupId.set(option.group_id, []);
    optionsByGroupId.get(option.group_id).push(option);
  });

  return groupsResult.rows
    .filter((group) => normalizeKey(group.key) !== "style")
    .map((group) => ({
      ...group,
      label_ar: group.name_ar,
      label_en: group.name_en,
      options: optionsByGroupId.get(group.id) || [],
    }));
};

export const fetchProductClassificationGroups = async ({ includeInactive = false } = {}) => {
  await ensureProductClassificationSchema();
  return fetchGroupsBase({ includeInactive });
};

export const fetchProductClassificationGroupByKey = async (groupKey, { includeInactive = false } = {}) => {
  const key = normalizeKey(groupKey);
  const groups = await fetchProductClassificationGroups({ includeInactive });
  return groups.find((item) => String(item.key || "") === key) || null;
};

export const fetchProductClassificationOptions = async (groupKey, { includeInactive = false } = {}) => {
  const group = await fetchProductClassificationGroupByKey(groupKey, { includeInactive });
  return group?.options || [];
};

export const buildClassificationAliasList = (option = {}) => {
  const aliases = [option.value, option.label_ar, option.label_en, option.name_ar, option.name_en, option.english_name]
    .map(normalizeText)
    .filter(Boolean)
    .map((value) => value.toLowerCase());
  return [...new Set(aliases)];
};

export const buildClassificationLookup = (groups = []) => {
  const lookup = new Map();
  groups.forEach((group) => {
    (group.options || []).forEach((option) => {
      const aliases = buildClassificationAliasList(option);
      const canonical = normalizeText(option.value).toLowerCase();
      aliases.forEach((alias) => lookup.set(alias, canonical));
    });
  });
  return lookup;
};

export const normalizeClassificationInput = async (groupKey, value) => {
  const raw = normalizeText(value);
  if (!raw) return "";

  const options = await fetchProductClassificationOptions(groupKey, { includeInactive: true });
  const lookup = buildClassificationLookup([{ options }]);
  return lookup.get(raw.toLowerCase()) || raw;
};

export const getClassificationFilterAliases = async (groupKey, value) => {
  const raw = normalizeText(value);
  if (!raw) return [];

  const options = await fetchProductClassificationOptions(groupKey, { includeInactive: true });
  const lookup = buildClassificationLookup([{ options }]);
  const canonical = lookup.get(raw.toLowerCase()) || raw.toLowerCase();
  const matchedOption =
    options.find((option) => normalizeText(option.value).toLowerCase() === canonical) ||
    options.find((option) => buildClassificationAliasList(option).includes(raw.toLowerCase()));
  if (!matchedOption) return [raw.toLowerCase()];
  return buildClassificationAliasList(matchedOption);
};

export const classificationGroupKeys = CLASSIFICATION_KEYS;
