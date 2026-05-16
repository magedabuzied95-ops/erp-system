import db from "../database/db.js";

const CLASSIFICATION_GROUPS = [
  {
    key: "gender",
    name_ar: "الجنس",
    name_en: "Gender",
    sort_order: 1,
    options: [
      { value: "men", label_ar: "رجالي", label_en: "Men", sort_order: 1, icon: "M", color: "#7c3aed" },
      { value: "women", label_ar: "حريمي", label_en: "Women", sort_order: 2, icon: "W", color: "#db2777" },
      { value: "kids", label_ar: "أطفال", label_en: "Kids", sort_order: 3, icon: "K", color: "#2563eb" },
    ],
  },
  {
    key: "product_type",
    name_ar: "نوع المنتج",
    name_en: "Product Type",
    sort_order: 2,
    options: [
      { value: "sneakers", label_ar: "سنيكرز", label_en: "Sneakers", sort_order: 1, icon: "S", color: "#111827" },
      { value: "slides", label_ar: "شبشب", label_en: "Slides", sort_order: 2, icon: "L", color: "#0f766e" },
      { value: "bags", label_ar: "شنط", label_en: "Bags", sort_order: 3, icon: "B", color: "#b45309" },
    ],
  },
  {
    key: "style",
    name_ar: "الستايل",
    name_en: "Style",
    sort_order: 3,
    options: [
      { value: "running", label_ar: "رياضي", label_en: "Running", sort_order: 1, icon: "Run", color: "#2563eb" },
      { value: "casual", label_ar: "كاجوال", label_en: "Casual", sort_order: 2, icon: "Cas", color: "#7c3aed" },
      { value: "school", label_ar: "مدرسي", label_en: "School", sort_order: 3, icon: "Sch", color: "#0891b2" },
    ],
  },
  {
    key: "grade",
    name_ar: "الفئة",
    name_en: "Grade",
    sort_order: 4,
    options: [
      { value: "vietnam_import", label_ar: "فيتنام مستورد", label_en: "Vietnam Import", sort_order: 1, icon: "VN", color: "#16a34a" },
      { value: "mirror", label_ar: "ميرور", label_en: "Mirror", sort_order: 2, icon: "M", color: "#6d28d9" },
      { value: "local", label_ar: "محلي", label_en: "Local", sort_order: 3, icon: "L", color: "#f97316" },
    ],
  },
];

const CLASSIFICATION_KEYS = CLASSIFICATION_GROUPS.map((group) => group.key);

const normalizeText = (value) => String(value ?? "").trim();

const normalizeKey = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/[^a-z0-9_]/g, "");

const toBoolean = (value, fallback = true) => {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  const text = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "active"].includes(text)) return true;
  if (["0", "false", "no", "inactive"].includes(text)) return false;
  return fallback;
};

const toInt = (value, fallback = 0) => {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizeSeedGroup = (group) => ({
  key: normalizeKey(group.key),
  name_ar: normalizeText(group.name_ar),
  name_en: normalizeText(group.name_en),
  sort_order: toInt(group.sort_order, 0),
  is_active: toBoolean(group.is_active, true),
  options: Array.isArray(group.options) ? group.options : [],
});

const normalizeSeedOption = (option) => ({
  value: normalizeKey(option.value),
  label_ar: normalizeText(option.label_ar),
  label_en: normalizeText(option.label_en),
  icon: normalizeText(option.icon),
  color: normalizeText(option.color),
  sort_order: toInt(option.sort_order, 0),
  is_active: toBoolean(option.is_active, true),
});

export const ensureProductClassificationSchema = async () => {
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
    await client.query(`CREATE INDEX IF NOT EXISTS idx_product_classification_groups_sort ON product_classification_groups (sort_order, id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_product_classification_options_group_sort ON product_classification_options (group_id, sort_order, id)`);
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

    for (const group of CLASSIFICATION_GROUPS) {
      const groupRow = normalizeSeedGroup(group);
      const groupResult = await client.query(
        `
        INSERT INTO product_classification_groups (key, name_ar, name_en, sort_order, is_active, deleted_at)
        VALUES ($1, $2, $3, $4, $5, NULL)
        ON CONFLICT (key) DO UPDATE SET
          name_ar = EXCLUDED.name_ar,
          name_en = EXCLUDED.name_en,
          sort_order = EXCLUDED.sort_order,
          is_active = product_classification_groups.is_active,
          updated_at = CURRENT_TIMESTAMP
        RETURNING id
        `,
        [groupRow.key, groupRow.name_ar, groupRow.name_en, groupRow.sort_order, groupRow.is_active]
      );
      const groupId = groupResult.rows[0]?.id;
      if (!groupId) continue;

      for (const option of groupRow.options) {
        const optionRow = normalizeSeedOption(option);
        await client.query(
          `
          INSERT INTO product_classification_options (group_id, value, label_ar, label_en, icon, color, sort_order, is_active, deleted_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL)
          ON CONFLICT (group_id, value) DO UPDATE SET
            label_ar = EXCLUDED.label_ar,
            label_en = EXCLUDED.label_en,
            icon = EXCLUDED.icon,
            color = EXCLUDED.color,
            sort_order = EXCLUDED.sort_order,
            is_active = product_classification_options.is_active,
            updated_at = CURRENT_TIMESTAMP
          `,
          [groupId, optionRow.value, optionRow.label_ar, optionRow.label_en, optionRow.icon, optionRow.color, optionRow.sort_order, optionRow.is_active]
        );
      }
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
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

  return groupsResult.rows.map((group) => ({
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
