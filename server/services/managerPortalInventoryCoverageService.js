import db from "../database/db.js";
import { buildInventoryCountVariantImageSelects, ensureInventoryCountSchema } from "./inventoryCountService.js";

// تغطية الجرد: every model the shop carries, and whether it was counted in a
// month. A model is "counted" once any of its sizes sits on a count that was not
// cancelled — a rejected count still says somebody counted it, so it is shown
// with its status rather than hidden. The catalogue side is every active model
// plus anything counted that month, so a model archived after its count does
// not vanish from the month it was counted in.

const MONTH_RE = /^(\d{4})-(\d{2})$/;
const AUDIENCES = ["men", "women", "kids"];
const AUDIENCE_ALIASES = new Map([
  ["men", "men"], ["man", "men"], ["male", "men"], ["mens", "men"], ["رجال", "men"], ["رجالي", "men"],
  ["women", "women"], ["woman", "women"], ["female", "women"], ["ladies", "women"], ["lady", "women"], ["نساء", "women"], ["نسائي", "women"], ["حريمي", "women"],
  ["kids", "kids"], ["kid", "kids"], ["children", "kids"], ["child", "kids"], ["boys", "kids"], ["girls", "kids"], ["اطفال", "kids"], ["أطفال", "kids"], ["طفل", "kids"],
]);
const normalizeAudience = (value) => AUDIENCE_ALIASES.get(String(value || "").trim().toLowerCase()) || "";

const monthWindow = (month = "") => {
  const match = MONTH_RE.exec(String(month || "").trim());
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit" }).format(new Date());
  const [year, monthNumber] = match ? [Number(match[1]), Number(match[2])] : today.split("-").map(Number);
  const pad = (n) => String(n).padStart(2, "0");
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return { month: `${year}-${pad(monthNumber)}`, start: `${year}-${pad(monthNumber)}-01`, end: `${year}-${pad(monthNumber)}-${pad(lastDay)}` };
};

const numberOrNull = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
};

// An inline base64 picture is a whole image per row; only real URLs leave the database.
const urlOnly = (expr) => `CASE WHEN (${expr}) IS NULL OR LEFT(${expr}, 5) = 'data:' OR LENGTH(${expr}) > 1024 THEN '' ELSE ${expr} END`;

const tableExists = async (name) => {
  const result = await db.query("SELECT to_regclass($1) AS reg", [`public.${name}`]);
  return Boolean(result.rows[0]?.reg);
};

export const getManagerPortalInventoryCoverage = async ({ manager = {}, month = "", audience = "" } = {}) => {
  await ensureInventoryCountSchema();
  const tenantId = numberOrNull(manager.tenant_id);
  const branchId = manager.branch_scope === "all" ? null : numberOrNull(manager.branch_id);
  const range = monthWindow(month);
  const wantedAudience = AUDIENCES.includes(String(audience || "").toLowerCase()) ? String(audience).toLowerCase() : "";
  const [imageSelects, hasAudiences, hasGallery] = await Promise.all([buildInventoryCountVariantImageSelects(db), tableExists("product_audiences"), tableExists("product_variant_images")]);
  // Many products keep their cover inline (base64), which never leaves the database;
  // the colour gallery, then any size row's picture, stands in for it.
  const galleryImage = hasGallery
    ? `(SELECT g.image_url FROM product_variant_images g WHERE g.product_id = p.id AND COALESCE(g.image_url, '') <> '' AND LEFT(g.image_url, 5) <> 'data:' AND LENGTH(g.image_url) <= 1024 ORDER BY g.id LIMIT 1)`
    : "NULL";

  const [catalogResult, countedResult, audienceResult] = await Promise.all([
    db.query(
      `
      SELECT p.id, COALESCE(p.name, '') AS name, COALESCE(p.gender, '') AS gender,
             COALESCE(NULLIF(${urlOnly(imageSelects.productImageExpr)}, ''), ${galleryImage}, MAX(NULLIF(${urlOnly("v.image_url")}, '')), '') AS image_url,
             LOWER(COALESCE(p.status, 'active')) AS status, COALESCE(p.is_active, TRUE) AS is_active,
             COALESCE(SUM(GREATEST(COALESCE(v.stock, 0), 0)), 0)::int AS stock,
             COUNT(DISTINCT NULLIF(LOWER(TRIM(COALESCE(v.color, ''))), ''))::int AS colors
      FROM products p
      LEFT JOIN product_variants v ON v.product_id = p.id AND v.deleted_at IS NULL AND v.is_active IS DISTINCT FROM FALSE
      WHERE ($1::bigint IS NULL OR p.tenant_id = $1::bigint OR p.tenant_id IS NULL)
      GROUP BY p.id
      `,
      [tenantId]
    ),
    db.query(
      `
      SELECT DISTINCT ON (product_id, color_key)
        product_id, color_key, counted_at, session_id, session_status, counter_name, image_url
      FROM (
        SELECT
          COALESCE(ci.product_id, v.product_id) AS product_id,
          LOWER(TRIM(COALESCE(v.color, ''))) AS color_key,
          COALESCE(ci.counted_at, ci.created_at) AS counted_at,
          s.id AS session_id,
          LOWER(COALESCE(s.status, '')) AS session_status,
          COALESCE(NULLIF(ce.full_name, ''), NULLIF(se.full_name, ''), NULLIF(cu.name, ''), '') AS counter_name,
          ${urlOnly(imageSelects.colorImageExpr)} AS image_url
        FROM inventory_count_items ci
        JOIN inventory_count_sessions s ON s.id = COALESCE(ci.inventory_count_session_id, ci.inventory_count_id)
        LEFT JOIN product_variants v ON v.id = COALESCE(ci.product_variant_id, ci.variant_id)
        LEFT JOIN products p ON p.id = COALESCE(ci.product_id, v.product_id)
        LEFT JOIN employees ce ON ce.id = ci.counted_by_employee_id
        LEFT JOIN employees se ON se.id = s.created_by_employee_id
        LEFT JOIN users cu ON cu.id = ci.counted_by
        WHERE ($1::bigint IS NULL OR s.tenant_id = $1::bigint OR s.tenant_id IS NULL)
          AND ($2::bigint IS NULL OR s.branch_id = $2::bigint OR s.branch_id IS NULL)
          AND LOWER(COALESCE(s.status, '')) NOT IN ('cancelled', 'canceled')
          AND (COALESCE(ci.counted_at, ci.created_at) AT TIME ZONE 'Africa/Cairo')::date BETWEEN $3::date AND $4::date
      ) rows
      WHERE product_id IS NOT NULL
      ORDER BY product_id, color_key, counted_at DESC
      `,
      [tenantId, branchId, range.start, range.end]
    ),
    hasAudiences
      ? db.query("SELECT product_id, LOWER(audience) AS audience FROM product_audiences")
      : Promise.resolve({ rows: [] }),
  ]);

  const audiencesByProduct = new Map();
  for (const row of audienceResult.rows) {
    const key = String(row.product_id);
    if (!audiencesByProduct.has(key)) audiencesByProduct.set(key, new Set());
    const value = normalizeAudience(row.audience);
    if (value) audiencesByProduct.get(key).add(value);
  }

  // One entry per model: the latest count of each colour, folded.
  const countedByProduct = new Map();
  for (const row of countedResult.rows) {
    const key = String(row.product_id);
    let entry = countedByProduct.get(key);
    if (!entry) {
      entry = { colors: new Set(), last_counted_at: row.counted_at, counter_name: row.counter_name, counters: new Set(), statuses: new Set(), image_url: "" };
      countedByProduct.set(key, entry);
    }
    if (row.color_key) entry.colors.add(row.color_key);
    // Colours of one model are often split between people; name every one.
    if (row.counter_name) entry.counters.add(String(row.counter_name).trim());
    if (new Date(row.counted_at) > new Date(entry.last_counted_at)) {
      entry.last_counted_at = row.counted_at;
      entry.counter_name = row.counter_name;
    }
    entry.statuses.add(row.session_status || "in_progress");
    if (!entry.image_url && row.image_url) entry.image_url = row.image_url;
  }

  const modelStatus = (statuses) => {
    if (statuses.has("pending_review")) return "pending_review";
    if (statuses.has("in_progress") || statuses.has("draft")) return "in_progress";
    if (statuses.has("rejected") && !statuses.has("completed")) return "rejected";
    return "completed";
  };

  const models = [];
  for (const row of catalogResult.rows) {
    const key = String(row.id);
    const counted = countedByProduct.get(key) || null;
    const active = row.is_active && !["archived", "inactive", "deleted"].includes(row.status);
    if (!active && !counted) continue;
    const audiences = new Set(audiencesByProduct.get(key) || []);
    if (!audiences.size) {
      const fromGender = normalizeAudience(row.gender);
      if (fromGender) audiences.add(fromGender);
    }
    models.push({
      product_id: Number(row.id),
      name: row.name,
      image_url: row.image_url || counted?.image_url || "",
      audiences: [...audiences],
      stock: Number(row.stock || 0),
      colors: Number(row.colors || 0),
      counted: Boolean(counted),
      counted_colors: counted ? counted.colors.size : 0,
      last_counted_at: counted?.last_counted_at || null,
      counted_by: counted?.counter_name || "",
      counted_by_names: counted ? [...counted.counters] : [],
      count_status: counted ? modelStatus(counted.statuses) : null,
    });
  }

  const audienceCounts = Object.fromEntries(["all", ...AUDIENCES].map((key) => {
    const rows = key === "all" ? models : models.filter((model) => model.audiences.includes(key));
    return [key, { total: rows.length, counted: rows.filter((model) => model.counted).length }];
  }));
  const visible = wantedAudience ? models.filter((model) => model.audiences.includes(wantedAudience)) : models;
  const collator = new Intl.Collator(["ar", "en"], { numeric: true, sensitivity: "base" });
  visible.sort((a, b) => {
    if (a.counted !== b.counted) return a.counted ? 1 : -1;
    if (!a.counted) return b.stock - a.stock || collator.compare(a.name, b.name);
    return new Date(b.last_counted_at) - new Date(a.last_counted_at);
  });

  return {
    month: range.month,
    audience: wantedAudience || "all",
    summary: audienceCounts,
    models: visible,
  };
};
