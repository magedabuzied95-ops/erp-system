/**
 * Product lifecycle: when each colour/size entered the system, every purchase
 * invoice and sales invoice it appears on, and every other stock movement.
 *
 * The source documents are the truth for purchases and sales (purchase_items,
 * order_items); inventory_movements supplies everything else. The movement
 * types that merely mirror those documents are left out so a sale is not
 * listed twice.
 *
 * Costs are never selected: the dialog is a history view for every role with
 * inventory access, and the owner ruled cost out of it.
 */

const DOCUMENT_MIRROR_MOVEMENTS = ["PURCHASE_IN", "PURCHASE", "SALE_OUT", "SALE"];
const INACTIVE_PURCHASE_STATUSES = ["draft", "cancelled", "canceled", "reversed"];
const INACTIVE_ORDER_STATUSES = ["draft", "cancelled", "canceled", "deleted"];
export const LIFECYCLE_KINDS = ["created", "purchase", "sale", "count", "movement"];
// A stock count only becomes history once it has left the counter's hands: a
// draft still being typed on a phone is not an event anyone should read.
const VISIBLE_COUNT_STATUSES = ["pending_review", "completed", "rejected"];

const toPositiveInt = (value) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const clampInt = (value, fallback, min, max) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
};

const toNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const auditTableCache = new WeakMap();
// employees is a core table, but the lifecycle SQL also runs against shadow
// schemas in tests, so the creator join is probed exactly like audit_logs.
const employeesTableCache = new WeakMap();
const hasEmployees = async (client) => {
  if (employeesTableCache.has(client)) return employeesTableCache.get(client);
  const result = await client.query(`SELECT to_regclass('employees') IS NOT NULL AS present`);
  const present = Boolean(result.rows[0]?.present);
  if (client && typeof client === "object") employeesTableCache.set(client, present);
  return present;
};

const hasAuditLogs = async (client) => {
  if (auditTableCache.has(client)) return auditTableCache.get(client);
  const result = await client.query(`SELECT to_regclass('audit_logs') IS NOT NULL AS present`);
  const present = Boolean(result.rows[0]?.present);
  if (client && typeof client === "object") auditTableCache.set(client, present);
  return present;
};

// inventory_count_items is created lazily the first time a count runs, and its
// per-row counter identity (counted_by/counted_at) is newer than the table, so
// both the table and the column are probed. Without the column the counter
// falls back to whoever submitted the session — the history still answers "who
// counted this", just at session granularity.
const countTableCache = new WeakMap();
const inventoryCountSupport = async (client) => {
  if (countTableCache.has(client)) return countTableCache.get(client);
  const result = await client.query(`
    SELECT
      to_regclass('inventory_count_items') IS NOT NULL
        AND to_regclass('inventory_count_sessions') IS NOT NULL AS present,
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'inventory_count_items' AND column_name = 'counted_by'
      ) AS has_counter
  `);
  const support = {
    present: Boolean(result.rows[0]?.present),
    hasCounter: Boolean(result.rows[0]?.has_counter),
  };
  if (client && typeof client === "object") countTableCache.set(client, support);
  return support;
};

// Who added each colour/size. product_variants has no created_by; the product save
// writes one audit row per batch listing the new variant ids. Read once per query,
// not once per variant. $1 = product id.
const creatorsCte = (withAudit, withEmployees = false) =>
  withAudit
    ? `creators AS (
         SELECT DISTINCT ON (ids.variant_id)
           ids.variant_id,
           COALESCE(
             ${withEmployees ? "NULLIF(e.full_name, '')," : ""}
             NULLIF(a.details ->> 'entry_employee_name', ''),
             NULLIF(u.name, ''),
             u.email
           ) AS name
         FROM audit_logs a
         CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(a.details -> 'variant_ids', '[]'::jsonb)) AS ids_raw(value)
         CROSS JOIN LATERAL (SELECT ids_raw.value::bigint AS variant_id) ids
         LEFT JOIN users u ON u.id = a.user_id
         -- The PIN-verified employee wins over the (often shared) ERP login.
         -- Joined on text so a malformed id can never abort the query.
         ${withEmployees ? "LEFT JOIN employees e ON e.id::text = a.details ->> 'entry_employee_id'" : ""}
         WHERE a.action = 'product.variants_created'
           AND a.entity_type = 'product'
           AND a.entity_id = $1::bigint
           AND jsonb_typeof(a.details -> 'variant_ids') = 'array'
         ORDER BY ids.variant_id, a.id
       )`
    : `creators AS (SELECT NULL::bigint AS variant_id, NULL::text AS name WHERE FALSE)`;

const creatorJoin = (variantAlias) => `LEFT JOIN creators creator ON creator.variant_id = ${variantAlias}.id`;

const variantScope = `
  SELECT v.id, v.color, v.size, v.article_code, v.stock, v.created_at, v.is_active, v.deleted_at
  FROM product_variants v
  WHERE v.product_id = $1::bigint
    AND ($2::bigint IS NULL OR v.tenant_id IS NULL OR v.tenant_id = $2::bigint)
`;

// When the count happened. counted_at is the moment the employee entered the
// quantity — which for an offline count is earlier than the row reaching us —
// so it wins over the row's write time and over the session's own stamps.
const countedAtExpr = (hasCounter) =>
  hasCounter
    ? "COALESCE(ci.counted_at, ci.updated_at, cs.submitted_at, cs.created_at)"
    : "COALESCE(ci.updated_at, cs.submitted_at, cs.created_at)";

// Who physically counted a colour, and when. One event per count session and
// colour: the size rows carry what was counted against what the system expected.
// The counter is the employee on the item row; a row written before counted_by
// existed falls back to whoever submitted or opened the session.
const countEventsCte = ({ present, hasCounter }) =>
  present
    ? `count_events AS (
         SELECT
           'count'::text AS kind,
           MAX(${countedAtExpr(hasCounter)})::timestamptz AS occurred_at,
           'count:' || cs.id || ':' || COALESCE(v.color, '') AS event_key,
           COALESCE(v.color, '') AS color,
           jsonb_agg(jsonb_build_object(
             'variant_id', v.id,
             'size', COALESCE(v.size, ''),
             'quantity', ci.counted_quantity,
             'expected', ci.system_quantity,
             'difference', ci.difference_quantity
           ) ORDER BY ci.id) AS lines,
           cs.id::bigint AS document_id,
           COALESCE(NULLIF(cs.title, ''), '#' || cs.id) AS document_number,
           COALESCE(cs.status, '') AS document_status,
           COALESCE(
             ${hasCounter ? "MIN(NULLIF(cbu.name, '')), MIN(cbu.email)," : ""}
             MIN(NULLIF(su.name, '')), MIN(su.email),
             MIN(NULLIF(ou.name, '')), MIN(ou.email),
             MIN(NULLIF(ccu.name, '')), MIN(ccu.email)
           ) AS actor_name,
           NULLIF(b.name, '') AS party_name,
           NULL::text AS channel,
           NULL::timestamptz AS voided_at,
           NULL::text AS voided_by_name,
           jsonb_build_object(
             'session_title', NULLIF(cs.title, ''),
             'branch_name', NULLIF(b.name, ''),
             'expected', SUM(ci.system_quantity),
             'difference', SUM(ci.difference_quantity),
             'approved_by_name', COALESCE(MIN(NULLIF(au.name, '')), MIN(au.email))
           ) AS extra
         FROM inventory_count_items ci
         JOIN inventory_count_sessions cs ON cs.id = COALESCE(ci.inventory_count_session_id, ci.inventory_count_id)
         JOIN scoped_variants v ON v.id = COALESCE(ci.product_variant_id, ci.variant_id)
         LEFT JOIN branches b ON b.id = cs.branch_id
         ${hasCounter ? "LEFT JOIN users cbu ON cbu.id = ci.counted_by" : ""}
         LEFT JOIN users su ON su.id = cs.submitted_by
         LEFT JOIN users ou ON ou.id = cs.opened_by
         LEFT JOIN users ccu ON ccu.id = cs.created_by
         LEFT JOIN users au ON au.id = cs.approved_by
         WHERE ($2::bigint IS NULL OR cs.tenant_id IS NULL OR cs.tenant_id = $2::bigint)
           AND LOWER(COALESCE(cs.status, '')) = ANY($9::text[])
         GROUP BY cs.id, cs.title, cs.status, b.name, COALESCE(v.color, '')
       )`
    : `count_events AS (
         SELECT
           'count'::text AS kind, NULL::timestamptz AS occurred_at, ''::text AS event_key, ''::text AS color,
           '[]'::jsonb AS lines, NULL::bigint AS document_id, NULL::text AS document_number, NULL::text AS document_status,
           NULL::text AS actor_name, NULL::text AS party_name, NULL::text AS channel, NULL::timestamptz AS voided_at,
           NULL::text AS voided_by_name, '{}'::jsonb AS extra
         -- $9 stays referenced so the parameter list is identical either way.
         WHERE FALSE AND $9::text[] IS NOT NULL
       )`;

const eventsSql = (withAudit, countSupport, withEmployees = false) => `
  WITH scoped_variants AS (${variantScope}),
  ${creatorsCte(withAudit, withEmployees)},
  ${countEventsCte(countSupport)},
  created_events AS (
    SELECT
      'created'::text AS kind,
      MIN(v.created_at)::timestamptz AS occurred_at,
      'created:' || COALESCE(v.color, '') || ':' || to_char(date_trunc('minute', v.created_at), 'YYYYMMDDHH24MI') AS event_key,
      COALESCE(v.color, '') AS color,
      jsonb_agg(jsonb_build_object('variant_id', v.id, 'size', COALESCE(v.size, ''), 'quantity', NULL) ORDER BY v.id) AS lines,
      NULL::bigint AS document_id,
      NULL::text AS document_number,
      NULL::text AS document_status,
      MIN(creator.name) AS actor_name,
      NULL::text AS party_name,
      NULL::text AS channel,
      NULL::timestamptz AS voided_at,
      NULL::text AS voided_by_name,
      '{}'::jsonb AS extra
    FROM scoped_variants v
    ${creatorJoin("v")}
    GROUP BY COALESCE(v.color, ''), date_trunc('minute', v.created_at)
  ),
  purchase_events AS (
    SELECT
      'purchase'::text AS kind,
      p.created_at::timestamptz AS occurred_at,
      'purchase:' || p.id || ':' || line.color AS event_key,
      line.color,
      jsonb_agg(jsonb_build_object('variant_id', pi.variant_id, 'size', line.size, 'quantity', pi.quantity) ORDER BY pi.id) AS lines,
      p.id::bigint AS document_id,
      COALESCE(NULLIF(p.purchase_number, 'PO-PENDING'), NULLIF(p.legacy_purchase_number, ''), '#' || p.id) AS document_number,
      COALESCE(p.status, '') AS document_status,
      COALESCE(NULLIF(cu.name, ''), cu.email) AS actor_name,
      s.name AS party_name,
      NULL::text AS channel,
      COALESCE(p.deleted_at, p.reversed_at)::timestamptz AS voided_at,
      COALESCE(NULLIF(du.name, ''), du.email, NULLIF(ru.name, ''), ru.email) AS voided_by_name,
      jsonb_build_object('deleted', p.deleted_at IS NOT NULL, 'reversed', p.reversed_at IS NOT NULL) AS extra
    FROM purchase_items pi
    JOIN purchases p ON p.id = pi.purchase_id
    LEFT JOIN product_variants v ON v.id = pi.variant_id
    CROSS JOIN LATERAL (
      SELECT
        COALESCE(v.color, pi.metadata ->> 'color', '') AS color,
        COALESCE(v.size, pi.metadata ->> 'size', '') AS size
    ) line
    LEFT JOIN suppliers s ON s.id = p.supplier_id
    LEFT JOIN users cu ON cu.id = p.created_by
    LEFT JOIN users du ON du.id = p.deleted_by
    LEFT JOIN users ru ON ru.id = p.reversed_by
    WHERE pi.product_id = $1::bigint
      AND ($2::bigint IS NULL OR p.tenant_id IS NULL OR p.tenant_id = $2::bigint)
    GROUP BY p.id, p.created_at, p.purchase_number, p.legacy_purchase_number, p.status, p.deleted_at, p.reversed_at,
             cu.name, cu.email, s.name, du.name, du.email, ru.name, ru.email, line.color
  ),
  sale_events AS (
    SELECT
      'sale'::text AS kind,
      o.created_at::timestamptz AS occurred_at,
      'sale:' || o.id || ':' || line.color AS event_key,
      line.color,
      jsonb_agg(jsonb_build_object(
        'variant_id', oi.variant_id,
        'size', line.size,
        'quantity', oi.quantity,
        'returned', COALESCE(oi.returned_quantity, 0)
      ) ORDER BY oi.id) AS lines,
      o.id::bigint AS document_id,
      COALESCE(NULLIF(o.invoice_number, ''), NULLIF(o.public_order_number, ''), NULLIF(o.display_order_number, ''), '#' || o.id) AS document_number,
      COALESCE(o.status, '') AS document_status,
      COALESCE(NULLIF(o.seller_name, ''), NULLIF(cu.name, ''), cu.email, NULLIF(o.cashier_name, '')) AS actor_name,
      NULLIF(o.customer_name, '') AS party_name,
      COALESCE(NULLIF(o.channel, ''), NULLIF(o.source, '')) AS channel,
      o.deleted_at::timestamptz AS voided_at,
      COALESCE(NULLIF(du.name, ''), du.email) AS voided_by_name,
      jsonb_build_object(
        'seller_name', NULLIF(o.seller_name, ''),
        'cashier_name', NULLIF(o.cashier_name, ''),
        'created_by_name', COALESCE(NULLIF(cu.name, ''), cu.email),
        'deleted', o.deleted_at IS NOT NULL
      ) AS extra
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    LEFT JOIN product_variants v ON v.id = oi.variant_id
    CROSS JOIN LATERAL (
      SELECT COALESCE(v.color, oi.color, '') AS color, COALESCE(v.size, oi.size, '') AS size
    ) line
    LEFT JOIN users cu ON cu.id = o.created_by
    LEFT JOIN users du ON du.id = o.deleted_by
    WHERE (oi.product_id = $1::bigint OR oi.variant_id IN (SELECT id FROM scoped_variants))
      AND ($2::bigint IS NULL OR o.tenant_id IS NULL OR o.tenant_id = $2::bigint)
    GROUP BY o.id, o.created_at, o.invoice_number, o.public_order_number, o.display_order_number, o.status,
             o.seller_name, o.cashier_name, o.customer_name, o.channel, o.source, o.deleted_at,
             cu.name, cu.email, du.name, du.email, line.color
  ),
  movement_events AS (
    SELECT
      'movement'::text AS kind,
      m.created_at::timestamptz AS occurred_at,
      'movement:' || m.id AS event_key,
      COALESCE(v.color, '') AS color,
      jsonb_build_array(jsonb_build_object(
        'variant_id', m.variant_id,
        'size', COALESCE(v.size, ''),
        'quantity', m.quantity_change,
        'before', m.quantity_before,
        'after', m.quantity_after
      )) AS lines,
      m.reference_id::bigint AS document_id,
      NULL::text AS document_number,
      UPPER(COALESCE(m.movement_type, '')) AS document_status,
      COALESCE(NULLIF(u.name, ''), u.email) AS actor_name,
      NULL::text AS party_name,
      NULLIF(m.reference_type, '') AS channel,
      m.undone_at::timestamptz AS voided_at,
      COALESCE(NULLIF(uu.name, ''), uu.email) AS voided_by_name,
      jsonb_build_object('reason', COALESCE(NULLIF(m.reason, ''), NULLIF(m.notes, ''), NULLIF(m.note, ''))) AS extra
    FROM inventory_movements m
    LEFT JOIN product_variants v ON v.id = m.variant_id
    LEFT JOIN users u ON u.id = m.created_by
    LEFT JOIN users uu ON uu.id = m.undone_by
    WHERE m.product_id = $1::bigint
      AND ($2::bigint IS NULL OR m.tenant_id IS NULL OR m.tenant_id = $2::bigint)
      AND UPPER(COALESCE(m.movement_type, '')) <> ALL($3::text[])
  ),
  all_events AS (
    SELECT * FROM created_events
    UNION ALL SELECT * FROM purchase_events
    UNION ALL SELECT * FROM sale_events
    UNION ALL SELECT * FROM count_events
    UNION ALL SELECT * FROM movement_events
  )
  SELECT *, COUNT(*) OVER () AS total_count
  FROM all_events e
  WHERE ($4::text[] IS NULL OR e.kind = ANY($4::text[]))
    AND ($5::text IS NULL OR LOWER(TRIM(e.color)) = LOWER(TRIM($5::text)))
    AND ($6::text IS NULL OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(e.lines) l WHERE LOWER(TRIM(l ->> 'size')) = LOWER(TRIM($6::text))
    ))
  ORDER BY e.occurred_at DESC NULLS LAST, e.event_key DESC
  LIMIT $7 OFFSET $8
`;

// The last time each size row was actually counted, and by whom. Only counts
// that left the counter's hands are shown, for the same reason the timeline
// hides a draft.
const countedCte = ({ present, hasCounter }) =>
  present
    ? `counted AS (
         SELECT DISTINCT ON (variant_key)
           COALESCE(ci.product_variant_id, ci.variant_id) AS variant_key,
           ${countedAtExpr(hasCounter)} AS counted_at,
           COALESCE(
             ${hasCounter ? "NULLIF(cbu.name, ''), cbu.email," : ""}
             NULLIF(su.name, ''), su.email,
             NULLIF(ccu.name, ''), ccu.email
           ) AS counted_by_name,
           ci.counted_quantity,
           ci.difference_quantity,
           cs.id AS session_id,
           COALESCE(cs.status, '') AS session_status
         FROM inventory_count_items ci
         JOIN inventory_count_sessions cs ON cs.id = COALESCE(ci.inventory_count_session_id, ci.inventory_count_id)
         ${hasCounter ? "LEFT JOIN users cbu ON cbu.id = ci.counted_by" : ""}
         LEFT JOIN users su ON su.id = cs.submitted_by
         LEFT JOIN users ccu ON ccu.id = cs.created_by
         WHERE COALESCE(ci.product_variant_id, ci.variant_id) IN (SELECT id FROM scoped_variants)
           AND ($2::bigint IS NULL OR cs.tenant_id IS NULL OR cs.tenant_id = $2::bigint)
           AND LOWER(COALESCE(cs.status, '')) = ANY($5::text[])
           -- Putting a colour on the sheet is not counting its sizes. A row the
           -- employee never touched carries no counted_at and no quantity, and
           -- must not claim a counter. Rows from before counted_at existed are
           -- still attributed at session level as long as a quantity was entered.
           ${hasCounter ? "AND (ci.counted_at IS NOT NULL OR COALESCE(ci.counted_quantity, 0) <> 0)" : "AND COALESCE(ci.counted_quantity, 0) <> 0"}
         ORDER BY variant_key, ${countedAtExpr(hasCounter)} DESC, ci.id DESC
       )`
    : `counted AS (
         SELECT
           NULL::bigint AS variant_key, NULL::timestamptz AS counted_at, NULL::text AS counted_by_name,
           NULL::int AS counted_quantity, NULL::int AS difference_quantity, NULL::bigint AS session_id,
           ''::text AS session_status
         WHERE FALSE AND $5::text[] IS NOT NULL
       )`;

const variantsSql = (withAudit, countSupport, withEmployees = false) => `
  WITH scoped_variants AS (${variantScope}),
  ${creatorsCte(withAudit, withEmployees)},
  ${countedCte(countSupport)},
  purchased AS (
    SELECT pi.variant_id,
           SUM(pi.quantity)::int AS quantity,
           COUNT(DISTINCT p.id)::int AS invoices,
           MIN(p.created_at) AS first_at,
           MAX(p.created_at) AS last_at
    FROM purchase_items pi
    JOIN purchases p ON p.id = pi.purchase_id
    WHERE pi.variant_id IN (SELECT id FROM scoped_variants)
      AND ($2::bigint IS NULL OR p.tenant_id IS NULL OR p.tenant_id = $2::bigint)
      AND p.deleted_at IS NULL
      AND p.reversed_at IS NULL
      AND LOWER(COALESCE(p.status, '')) <> ALL($3::text[])
    GROUP BY pi.variant_id
  ),
  sold AS (
    SELECT oi.variant_id,
           SUM(oi.quantity)::int AS quantity,
           SUM(COALESCE(oi.returned_quantity, 0))::int AS returned,
           COUNT(DISTINCT o.id)::int AS invoices,
           MAX(o.created_at) AS last_at
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    WHERE oi.variant_id IN (SELECT id FROM scoped_variants)
      AND ($2::bigint IS NULL OR o.tenant_id IS NULL OR o.tenant_id = $2::bigint)
      AND o.deleted_at IS NULL
      AND LOWER(COALESCE(o.status, '')) <> ALL($4::text[])
    GROUP BY oi.variant_id
  )
  SELECT
    v.id, v.color, v.size, v.article_code, v.stock, v.created_at, v.is_active, v.deleted_at,
    creator.name AS created_by_name,
    COALESCE(pu.quantity, 0) AS purchased_quantity,
    COALESCE(pu.invoices, 0) AS purchase_invoices,
    pu.first_at AS first_purchase_at,
    pu.last_at AS last_purchase_at,
    COALESCE(so.quantity, 0) AS sold_quantity,
    COALESCE(so.returned, 0) AS returned_quantity,
    COALESCE(so.invoices, 0) AS sale_invoices,
    so.last_at AS last_sale_at,
    co.counted_at AS last_counted_at,
    co.counted_by_name AS last_counted_by_name,
    co.counted_quantity AS last_counted_quantity,
    co.difference_quantity AS last_counted_difference,
    co.session_id AS last_count_session_id,
    co.session_status AS last_count_status
  FROM scoped_variants v
  ${creatorJoin("v")}
  LEFT JOIN purchased pu ON pu.variant_id = v.id
  LEFT JOIN sold so ON so.variant_id = v.id
  LEFT JOIN counted co ON co.variant_key = v.id
  ORDER BY v.color NULLS LAST, v.id
`;

const normalizeLines = (lines) =>
  (Array.isArray(lines) ? lines : []).map((line) => ({
    variant_id: toPositiveInt(line?.variant_id),
    size: String(line?.size ?? ""),
    quantity: line?.quantity === null || line?.quantity === undefined ? null : toNumber(line.quantity),
    ...(line?.returned !== undefined ? { returned: toNumber(line.returned) } : {}),
    ...(line?.before !== undefined && line?.before !== null ? { before: toNumber(line.before) } : {}),
    ...(line?.after !== undefined && line?.after !== null ? { after: toNumber(line.after) } : {}),
    ...(line?.expected !== undefined && line?.expected !== null ? { expected: toNumber(line.expected) } : {}),
    ...(line?.difference !== undefined && line?.difference !== null ? { difference: toNumber(line.difference) } : {}),
  }));

export const normalizeLifecycleQuery = (query = {}) => {
  const kinds = String(query.kind ?? query.kinds ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter((value) => LIFECYCLE_KINDS.includes(value));
  const color = String(query.color ?? "").trim();
  const size = String(query.size ?? "").trim();
  return {
    kinds: kinds.length ? kinds : null,
    color: color || null,
    size: size || null,
    limit: clampInt(query.limit, 40, 1, 200),
    offset: clampInt(query.offset, 0, 0, 1_000_000),
  };
};

export const loadProductLifecycleEvents = async (client, { productId, tenantId = null, kinds = null, color = null, size = null, limit = 40, offset = 0 }) => {
  const [withAudit, countSupport, withEmployees] = await Promise.all([hasAuditLogs(client), inventoryCountSupport(client), hasEmployees(client)]);
  const result = await client.query(eventsSql(withAudit, countSupport, withEmployees), [
    productId,
    tenantId,
    DOCUMENT_MIRROR_MOVEMENTS,
    kinds,
    color,
    size,
    limit,
    offset,
    VISIBLE_COUNT_STATUSES,
  ]);
  const total = toNumber(result.rows[0]?.total_count);
  const events = result.rows.map((row) => ({
    key: row.event_key,
    kind: row.kind,
    occurred_at: row.occurred_at,
    color: row.color || "",
    lines: normalizeLines(row.lines),
    quantity: normalizeLines(row.lines).reduce((sum, line) => sum + (line.quantity || 0), 0),
    document_id: row.document_id === null ? null : Number(row.document_id),
    document_number: row.document_number || null,
    document_status: row.document_status || null,
    actor_name: row.actor_name || null,
    party_name: row.party_name || null,
    channel: row.channel || null,
    voided_at: row.voided_at || null,
    voided_by_name: row.voided_by_name || null,
    extra: row.extra && typeof row.extra === "object" ? row.extra : {},
  }));
  return { events, total, limit, offset, has_more: offset + events.length < total };
};

const galleryTableCache = new WeakMap();
const hasVariantGallery = async (client) => {
  if (galleryTableCache.has(client)) return galleryTableCache.get(client);
  const result = await client.query(`SELECT to_regclass('product_variant_images') IS NOT NULL AS present`);
  const present = Boolean(result.rows[0]?.present);
  if (client && typeof client === "object") galleryTableCache.set(client, present);
  return present;
};

const colorKey = (value) => String(value || "").trim().toLowerCase();
const firstText = (...values) => values.map((value) => String(value || "").trim()).find(Boolean) || "";

// The colour's picture for each size row: the colour gallery (primary first), then
// the row's own image columns. to_jsonb keeps this working on schemas that lack a column.
const loadVariantImages = async (client, { productId, tenantId }) => {
  const own = await client.query(
    `
    SELECT pv.id, pv.color, to_jsonb(pv) AS raw
    FROM product_variants pv
    WHERE pv.product_id = $1::bigint
      AND ($2::bigint IS NULL OR pv.tenant_id IS NULL OR pv.tenant_id = $2::bigint)
    `,
    [productId, tenantId]
  );
  const byVariant = new Map();
  const byColor = new Map();
  if (await hasVariantGallery(client)) {
    const gallery = await client.query(
      `
      SELECT variant_id, color_name, color_value, image_url
      FROM product_variant_images
      WHERE product_id = $1::bigint
        AND ($2::bigint IS NULL OR tenant_id IS NULL OR tenant_id = $2::bigint)
        AND COALESCE(image_url, '') <> ''
      ORDER BY is_primary DESC, sort_order ASC, id ASC
      `,
      [productId, tenantId]
    );
    for (const row of gallery.rows) {
      if (row.variant_id && !byVariant.has(Number(row.variant_id))) byVariant.set(Number(row.variant_id), row.image_url);
      for (const name of [row.color_name, row.color_value]) {
        const key = colorKey(name);
        if (key && !byColor.has(key)) byColor.set(key, row.image_url);
      }
    }
  }
  const images = new Map();
  for (const row of own.rows) {
    const raw = row.raw || {};
    images.set(
      Number(row.id),
      firstText(byVariant.get(Number(row.id)), byColor.get(colorKey(row.color)), raw.image_url, raw.image, raw.thumbnail_url)
    );
  }
  return images;
};

export const loadProductLifecycleVariants = async (client, { productId, tenantId = null }) => {
  const [withAudit, countSupport, withEmployees] = await Promise.all([hasAuditLogs(client), inventoryCountSupport(client), hasEmployees(client)]);
  const [result, images] = await Promise.all([
    client.query(variantsSql(withAudit, countSupport, withEmployees), [
      productId,
      tenantId,
      INACTIVE_PURCHASE_STATUSES,
      INACTIVE_ORDER_STATUSES,
      VISIBLE_COUNT_STATUSES,
    ]),
    loadVariantImages(client, { productId, tenantId }),
  ]);
  return result.rows.map((row) => ({
    id: Number(row.id),
    color: row.color || "",
    size: row.size || "",
    image_url: images.get(Number(row.id)) || "",
    article_code: row.article_code || "",
    stock: toNumber(row.stock),
    created_at: row.created_at,
    created_by_name: row.created_by_name || null,
    archived: row.is_active === false || Boolean(row.deleted_at),
    purchased_quantity: toNumber(row.purchased_quantity),
    purchase_invoices: toNumber(row.purchase_invoices),
    first_purchase_at: row.first_purchase_at,
    last_purchase_at: row.last_purchase_at,
    sold_quantity: toNumber(row.sold_quantity),
    returned_quantity: toNumber(row.returned_quantity),
    sale_invoices: toNumber(row.sale_invoices),
    last_sale_at: row.last_sale_at,
    last_counted_at: row.last_counted_at || null,
    last_counted_by_name: row.last_counted_by_name || null,
    last_counted_quantity: row.last_counted_at ? toNumber(row.last_counted_quantity) : null,
    last_counted_difference: row.last_counted_at ? toNumber(row.last_counted_difference) : null,
    last_count_session_id: row.last_count_session_id === null || row.last_count_session_id === undefined ? null : Number(row.last_count_session_id),
    last_count_status: row.last_count_status || null,
  }));
};

export const summarizeLifecycleVariants = (variants = []) => {
  const summary = {
    first_seen_at: null,
    colors: 0,
    sizes: variants.length,
    purchased_quantity: 0,
    sold_quantity: 0,
    returned_quantity: 0,
    stock: 0,
  };
  const colors = new Set();
  for (const variant of variants) {
    colors.add(String(variant.color || "").trim().toLowerCase());
    summary.purchased_quantity += variant.purchased_quantity;
    summary.sold_quantity += variant.sold_quantity;
    summary.returned_quantity += variant.returned_quantity;
    if (!variant.archived) summary.stock += variant.stock;
    const created = variant.created_at ? new Date(variant.created_at) : null;
    if (created && !Number.isNaN(created.getTime()) && (!summary.first_seen_at || created < new Date(summary.first_seen_at))) {
      summary.first_seen_at = variant.created_at;
    }
  }
  summary.colors = colors.size;
  return summary;
};

export const loadProductLifecycleHeader = async (client, { productId, tenantId = null }) => {
  const result = await client.query(
    `
    SELECT to_jsonb(p) AS product
    FROM products p
    WHERE p.id = $1::bigint
      AND ($2::bigint IS NULL OR p.tenant_id IS NULL OR p.tenant_id = $2::bigint)
    LIMIT 1
    `,
    [productId, tenantId]
  );
  const product = result.rows[0]?.product;
  if (!product) return null;
  // Who entered the product, read off the row rather than the audit trail: the
  // header answers it once even when the colours were added in several batches.
  let createdByEmployeeName = "";
  const entryEmployeeId = Number(product.created_by_employee_id || 0);
  if (entryEmployeeId > 0 && (await hasEmployees(client))) {
    const employee = await client.query(`SELECT full_name FROM employees WHERE id = $1::bigint LIMIT 1`, [entryEmployeeId]);
    createdByEmployeeName = employee.rows[0]?.full_name || "";
  }
  return {
    id: Number(product.id),
    name: product.name || "",
    sku: product.sku || "",
    product_code: product.product_code || "",
    image_url: product.image_url || "",
    created_at: product.created_at || null,
    created_by_employee_id: entryEmployeeId > 0 ? entryEmployeeId : null,
    created_by_employee_name: createdByEmployeeName,
  };
};

// Exposed for tests that assert the dialog never leaks a cost.
export const __lifecycleSql = { eventsSql, variantsSql };
