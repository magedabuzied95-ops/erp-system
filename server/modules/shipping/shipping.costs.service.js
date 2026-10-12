// Every pound the courier takes, in one place. Bosta takes money three ways and none of
// them used to reach the profit report:
//
//  1. Prepaid packages (e.g. 2,000 EGP for 20 shipments). The purchase is NOT an expense
//     on the day it is bought — it is shipping paid in advance. Each Bosta shipment draws
//     one unit from the oldest package that still has units (FIFO, never from a package
//     bought after the shipment), and that unit's cost becomes an expense on the day the
//     parcel was created. One expense row per day, kept in sync, so the expenses list does
//     not get one line per parcel.
//  2. What Bosta deducts from the COD transfer (collection fee, extra fees, small-pickup
//     fee, return fees). The real figure is the settlement's fees; it is posted as an
//     expense when the settlement is recorded (see shipping.settlements.service.js).
//  3. The small-pickup fee (70 EGP when a pickup carries fewer than 3 parcels). Bosta takes
//     it out of the transfer, so it is already inside (2); here it is only ESTIMATED from
//     the days parcels were picked up, so a settlement's gap can be explained and each
//     order carries its share. Never posted as an expense on its own — that would count it twice.
import db from "../../database/db.js";
import { postMoneyTransaction, reverseMoneyTransactionsForReference } from "../../services/accountingService.js";
import { getAppTimeZone } from "../../utils/appTimezone.js";

const text = (value) => String(value ?? "").trim();
const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;
const toNumberOrNull = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const httpError = (message, status = 400, code = "") => {
  const error = new Error(message);
  error.status = status;
  if (code) error.code = code;
  return error;
};

export const COURIER_EXPENSE_CATEGORY = "مصاريف شحن — بوسطة";
export const CANCELLED_SHIPMENT_STATUSES = ["cancelled", "canceled", "terminated"];
// A parcel is with the courier once any of these is recorded; the first one dates its pickup.
export const PICKED_UP_STATUSES = ["picked_up", "in_transit", "out_for_delivery", "delivered", "failed_delivery", "returned"];
export const DEFAULT_COST_SETTINGS = { pickup_min_parcels: 3, pickup_small_fee: 70 };

const sqlList = (values) => values.map((value) => `'${value}'`).join(", ");
const providerSql = (alias = "o") => `LOWER(COALESCE(${alias}.shipping_provider, ${alias}.shipping_provider_id, ''))`;
const trackingSql = (alias = "o") => `COALESCE(NULLIF(${alias}.shipping_tracking_number, ''), NULLIF(${alias}.tracking_number, ''), '')`;
const shipmentStatusSql = (alias = "o") => `LOWER(COALESCE(NULLIF(${alias}.shipment_status, ''), ${alias}.shipping_status, ''))`;
// The moment the parcel was created at the courier: the first create in the order's own
// timeline, falling back to the last sync for parcels created before the timeline existed.
const shippedAtSql = (alias = "o") => `COALESCE(
  (SELECT MIN((e->>'at')::timestamptz)
     FROM jsonb_array_elements(CASE WHEN jsonb_typeof(${alias}.shipment_timeline) = 'array' THEN ${alias}.shipment_timeline ELSE '[]'::jsonb END) e
    WHERE e->>'action' = 'bosta_create_delivery' AND COALESCE(e->>'at', '') ~ '^\\d{4}-\\d{2}-\\d{2}'),
  ${alias}.shipping_last_synced_at, ${alias}.updated_at, ${alias}.created_at)`;

const tenantClause = (tenantId, params, column = "o.tenant_id") => {
  if (tenantId === null || tenantId === undefined) return "TRUE";
  params.push(Number(tenantId));
  return `(${column} = $${params.length} OR ${column} IS NULL)`;
};

// Calendar day in the shop's clock, as YYYY-MM-DD.
const dayKey = (value) => {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", { timeZone: getAppTimeZone(), year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
};

// Unit n of a package costs the difference of two rounded cumulative shares, so 20 units
// of 2,000 are 100 each and 3 units of 100 are 33.33 + 33.34 + 33.33 — the units always add
// up to the price to the piastre.
export const packageUnitCost = (price, count, n) => {
  const total = Number(price) || 0;
  const units = Math.max(1, Number(count) || 1);
  return round2(round2((total * n) / units) - round2((total * (n - 1)) / units));
};

// Fewer parcels than the threshold on one pickup ⇒ the flat fee, shared by those parcels.
export const pickupFeeFor = (parcels, settings = DEFAULT_COST_SETTINGS) => {
  const count = Number(parcels) || 0;
  const min = Number(settings.pickup_min_parcels ?? DEFAULT_COST_SETTINGS.pickup_min_parcels) || 0;
  const fee = round2(settings.pickup_small_fee ?? DEFAULT_COST_SETTINGS.pickup_small_fee);
  if (count <= 0 || count >= min || fee <= 0) return 0;
  return fee;
};

/*
 * FIFO assignment, pure so it can be tested: each shipment (oldest first) takes a unit
 * from the oldest package that still has one and was bought on or before the shipment's
 * day. A shipment older than every package stays unassigned — it was paid some other way.
 */
export const assignShipmentsToPackages = (shipments = [], packages = []) => {
  const pool = packages.map((pkg) => ({ ...pkg, remaining: Math.max(0, (Number(pkg.shipments_count) || 0) - (Number(pkg.used) || 0)), day: dayKey(pkg.purchased_at) }));
  const assignments = [];
  for (const shipment of shipments) {
    const shipDay = dayKey(shipment.shipped_at);
    const pkg = pool.find((candidate) => candidate.remaining > 0 && candidate.day && shipDay && candidate.day <= shipDay);
    if (!pkg) continue;
    pkg.remaining -= 1;
    assignments.push({ order_id: shipment.id, package_id: pkg.id, used_at: shipment.shipped_at });
  }
  return assignments;
};

let schemaReady = null;
export const ensureCourierCostSchema = async () => {
  if (!schemaReady) {
    schemaReady = (async () => {
      await db.query(`
        CREATE TABLE IF NOT EXISTS courier_packages (
          id BIGSERIAL PRIMARY KEY,
          tenant_id BIGINT NULL,
          provider VARCHAR(40) NOT NULL DEFAULT 'bosta',
          purchased_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          price NUMERIC(12,2) NOT NULL DEFAULT 0,
          shipments_count INTEGER NOT NULL DEFAULT 1,
          money_account_id BIGINT NULL,
          money_transaction_id BIGINT NULL,
          reference VARCHAR(160) NULL,
          notes TEXT NULL,
          created_by BIGINT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          voided_at TIMESTAMPTZ NULL,
          voided_by BIGINT NULL
        )
      `);
      await db.query(`CREATE INDEX IF NOT EXISTS idx_courier_packages_tenant ON courier_packages (tenant_id, provider, purchased_at)`);
      await db.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS courier_package_id BIGINT NULL`);
      await db.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS courier_package_cost NUMERIC(12,2) NULL`);
      await db.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS courier_package_used_at TIMESTAMPTZ NULL`);
      await db.query(`CREATE INDEX IF NOT EXISTS idx_orders_courier_package ON orders (courier_package_id) WHERE courier_package_id IS NOT NULL`);
      await db.query(`
        CREATE TABLE IF NOT EXISTS courier_cost_postings (
          id BIGSERIAL PRIMARY KEY,
          tenant_id BIGINT NULL,
          provider VARCHAR(40) NOT NULL DEFAULT 'bosta',
          kind VARCHAR(40) NOT NULL,
          day DATE NOT NULL,
          expense_id BIGINT NULL,
          amount NUMERIC(12,2) NOT NULL DEFAULT 0,
          shipments INTEGER NOT NULL DEFAULT 0,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await db.query(`CREATE INDEX IF NOT EXISTS idx_courier_cost_postings_day ON courier_cost_postings (tenant_id, provider, kind, day)`);
      await db.query(`
        CREATE TABLE IF NOT EXISTS courier_cost_settings (
          tenant_key BIGINT NOT NULL DEFAULT 0,
          provider VARCHAR(40) NOT NULL DEFAULT 'bosta',
          pickup_min_parcels INTEGER NOT NULL DEFAULT 3,
          pickup_small_fee NUMERIC(12,2) NOT NULL DEFAULT 70,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (tenant_key, provider)
        )
      `);
      await db.query(`ALTER TABLE IF EXISTS courier_settlements ADD COLUMN IF NOT EXISTS expected_fees_amount NUMERIC(12,2) NULL`);
      await db.query(`ALTER TABLE IF EXISTS courier_settlements ADD COLUMN IF NOT EXISTS fee_expense_id BIGINT NULL`);
    })().catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  return schemaReady;
};

export const getCourierCostSettings = async ({ tenantId = null, provider = "bosta" } = {}, client = db) => {
  await ensureCourierCostSchema();
  const result = await client.query(`SELECT pickup_min_parcels, pickup_small_fee FROM courier_cost_settings WHERE tenant_key = $1 AND provider = $2`, [Number(tenantId) || 0, text(provider) || "bosta"]);
  const row = result.rows[0];
  return row ? { pickup_min_parcels: Number(row.pickup_min_parcels), pickup_small_fee: round2(row.pickup_small_fee) } : { ...DEFAULT_COST_SETTINGS };
};

export const saveCourierCostSettings = async ({ tenantId = null, provider = "bosta", pickupMinParcels, pickupSmallFee } = {}) => {
  await ensureCourierCostSchema();
  const min = Math.round(Number(pickupMinParcels));
  const fee = round2(pickupSmallFee);
  if (!Number.isFinite(min) || min < 0 || min > 100) throw httpError("الحد الأدنى لعدد الشحنات في البيك اب غير صحيح");
  if (!Number.isFinite(fee) || fee < 0) throw httpError("رسوم البيك اب الصغير غير صحيحة");
  await db.query(
    `
    INSERT INTO courier_cost_settings (tenant_key, provider, pickup_min_parcels, pickup_small_fee, updated_at)
    VALUES ($1, $2, $3, $4, NOW())
    ON CONFLICT (tenant_key, provider) DO UPDATE SET pickup_min_parcels = EXCLUDED.pickup_min_parcels, pickup_small_fee = EXCLUDED.pickup_small_fee, updated_at = NOW()
    `,
    [Number(tenantId) || 0, text(provider) || "bosta", min, fee]
  );
  return { pickup_min_parcels: min, pickup_small_fee: fee };
};

const expenseCategoryId = async (client, tenantId) => {
  try {
    const existing = await client.query(
      `SELECT id FROM expense_categories WHERE LOWER(name) = LOWER($1) AND ($2::bigint IS NULL OR tenant_id = $2::bigint OR tenant_id IS NULL) ORDER BY tenant_id NULLS LAST, id LIMIT 1`,
      [COURIER_EXPENSE_CATEGORY, tenantId ?? null]
    );
    if (existing.rows[0]) return existing.rows[0].id;
    const inserted = await client.query(
      `INSERT INTO expense_categories (tenant_id, name, type_key, description, is_active) VALUES ($1, $2, 'shipping', $3, TRUE) RETURNING id`,
      [tenantId ?? null, COURIER_EXPENSE_CATEGORY, "قيود تلقائية: استهلاك باقات بوسطة ورسوم التحويلات"]
    );
    return inserted.rows[0]?.id || null;
  } catch {
    // The category is a label for the expenses screen; the `category` text still groups the P&L.
    return null;
  }
};

/*
 * Writes (or rewrites) the automatic expense row behind one cost. A row whose amount drops
 * to zero is cancelled, not deleted, so its id stays valid for the posting that owns it.
 */
export const upsertCourierExpense = async (client, { tenantId = null, expenseId = null, amount, title, day, notes = "", paymentMethod = "prepaid", moneyAccountId = null }) => {
  const value = round2(amount);
  const status = value > 0 ? "paid" : "cancelled";
  const tz = getAppTimeZone();
  if (expenseId) {
    await client.query(
      `
      UPDATE expenses SET amount = $2, title = $3, status = $4, notes = $5, note = $5,
        expense_date = $6::date, created_at = (($6::date + TIME '12:00') AT TIME ZONE $7), paid_at = (($6::date + TIME '12:00') AT TIME ZONE $7),
        updated_at = NOW()
      WHERE id = $1
      `,
      [expenseId, value, title, status, notes, day, tz]
    );
    return expenseId;
  }
  if (value <= 0) return null;
  const categoryId = await expenseCategoryId(client, tenantId);
  const inserted = await client.query(
    `
    INSERT INTO expenses (tenant_id, title, amount, category, category_id, expense_type, note, notes, payment_method, status, money_account_id, expense_date, created_at, paid_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, 'shipping', $6, $6, $7, 'paid', $8, $9::date, (($9::date + TIME '12:00') AT TIME ZONE $10), (($9::date + TIME '12:00') AT TIME ZONE $10), NOW())
    RETURNING id
    `,
    [tenantId ?? null, title, value, COURIER_EXPENSE_CATEGORY, categoryId, notes, paymentMethod, toNumberOrNull(moneyAccountId), day, tz]
  );
  return inserted.rows[0]?.id || null;
};

const packageScope = (tenantId, provider, params, alias = "p") => {
  const where = [tenantClause(tenantId, params, `${alias}.tenant_id`)];
  params.push(text(provider) || "bosta");
  where.push(`LOWER(${alias}.provider) = LOWER($${params.length})`);
  return where.join(" AND ");
};

/*
 * Brings package consumption in line with the shipments, and the daily expense rows in
 * line with the consumption. Idempotent and self-healing: run it after any shipment is
 * created or cancelled and after any package is recorded or voided.
 */
export const reconcileCourierCosts = async ({ tenantId = null, provider = "bosta" } = {}) => {
  await ensureCourierCostSchema();
  const providerKey = text(provider).toLowerCase() || "bosta";
  const tz = getAppTimeZone();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`courier-costs:${tenantId ?? "global"}:${providerKey}`]);

    // 1. Units go back to their package when the parcel was cancelled before pickup, lost
    //    its tracking number, or its package was voided.
    const releaseParams = [];
    const releaseTenant = tenantClause(tenantId, releaseParams);
    const released = await client.query(
      `
      UPDATE orders o SET courier_package_id = NULL, courier_package_cost = NULL, courier_package_used_at = NULL
      WHERE o.courier_package_id IS NOT NULL AND ${releaseTenant} AND (
        ${shipmentStatusSql()} IN (${sqlList(CANCELLED_SHIPMENT_STATUSES)})
        OR ${trackingSql()} = ''
        OR EXISTS (SELECT 1 FROM courier_packages p WHERE p.id = o.courier_package_id AND p.voided_at IS NOT NULL)
      )
      RETURNING o.id
      `,
      releaseParams
    );

    // 2. Unassigned live shipments draw from the packages, oldest first.
    const pkgParams = [];
    const packages = (await client.query(
      `
      SELECT p.id, p.purchased_at, p.price, p.shipments_count,
        (SELECT COUNT(*)::int FROM orders o WHERE o.courier_package_id = p.id) AS used
      FROM courier_packages p
      WHERE ${packageScope(tenantId, providerKey, pkgParams)} AND p.voided_at IS NULL
      ORDER BY p.purchased_at ASC, p.id ASC
      `,
      pkgParams
    )).rows;
    let assigned = 0;
    const open = packages.filter((pkg) => Number(pkg.used) < Number(pkg.shipments_count));
    if (open.length) {
      const shipParams = [];
      const shipTenant = tenantClause(tenantId, shipParams);
      shipParams.push(providerKey);
      const providerParam = `$${shipParams.length}`;
      shipParams.push(new Date(open[0].purchased_at).toISOString());
      const sinceParam = `$${shipParams.length}`;
      const shipments = (await client.query(
        `
        SELECT * FROM (
          SELECT o.id, ${shippedAtSql()} AS shipped_at
          FROM orders o
          WHERE ${shipTenant}
            AND o.courier_package_id IS NULL
            AND ${providerSql()} = ${providerParam}
            AND ${trackingSql()} <> ''
            AND ${shipmentStatusSql()} NOT IN (${sqlList(CANCELLED_SHIPMENT_STATUSES)})
        ) s
        WHERE s.shipped_at >= ((${sinceParam}::timestamptz AT TIME ZONE '${tz}')::date)::timestamp AT TIME ZONE '${tz}'
        ORDER BY s.shipped_at ASC, s.id ASC
        LIMIT 5000
        `,
        shipParams
      )).rows;
      const assignments = assignShipmentsToPackages(shipments, open);
      if (assignments.length) {
        await client.query(
          `
          UPDATE orders o SET courier_package_id = a.package_id, courier_package_used_at = a.used_at
          FROM UNNEST($1::bigint[], $2::bigint[], $3::timestamptz[]) AS a(order_id, package_id, used_at)
          WHERE o.id = a.order_id AND o.courier_package_id IS NULL
          `,
          [assignments.map((a) => a.order_id), assignments.map((a) => a.package_id), assignments.map((a) => new Date(a.used_at).toISOString())]
        );
        assigned = assignments.length;
      }
    }

    // 3. Each unit's cost by its position inside its package (see packageUnitCost).
    const costParams = [];
    await client.query(
      `
      WITH ranked AS (
        SELECT o.id, p.price, p.shipments_count,
          ROW_NUMBER() OVER (PARTITION BY o.courier_package_id ORDER BY o.courier_package_used_at ASC, o.id ASC) AS n
        FROM orders o
        JOIN courier_packages p ON p.id = o.courier_package_id
        WHERE ${packageScope(tenantId, providerKey, costParams)}
      ), priced AS (
        SELECT id, ROUND(price * n / GREATEST(shipments_count, 1), 2) - ROUND(price * (n - 1) / GREATEST(shipments_count, 1), 2) AS cost FROM ranked
      )
      UPDATE orders o SET courier_package_cost = priced.cost
      FROM priced
      WHERE o.id = priced.id AND o.courier_package_cost IS DISTINCT FROM priced.cost
      `,
      costParams
    );

    // 4. One expense row per day of consumption.
    const dayParams = [];
    const days = (await client.query(
      `
      SELECT TO_CHAR((o.courier_package_used_at AT TIME ZONE '${tz}')::date, 'YYYY-MM-DD') AS day,
        COALESCE(SUM(o.courier_package_cost), 0)::numeric AS amount, COUNT(*)::int AS shipments
      FROM orders o
      JOIN courier_packages p ON p.id = o.courier_package_id
      WHERE ${packageScope(tenantId, providerKey, dayParams)}
      GROUP BY 1
      `,
      dayParams
    )).rows;
    const postParams = [];
    const postings = (await client.query(
      `SELECT id, TO_CHAR(day, 'YYYY-MM-DD') AS day, expense_id, amount, shipments FROM courier_cost_postings p WHERE ${packageScope(tenantId, providerKey, postParams)} AND p.kind = 'package' FOR UPDATE`,
      postParams
    )).rows;
    const byDay = new Map(postings.map((row) => [row.day, row]));
    const wanted = new Map(days.map((row) => [row.day, { amount: round2(row.amount), shipments: Number(row.shipments) }]));
    for (const day of new Set([...byDay.keys(), ...wanted.keys()])) {
      const target = wanted.get(day) || { amount: 0, shipments: 0 };
      const posting = byDay.get(day);
      if (posting && round2(posting.amount) === target.amount && Number(posting.shipments) === target.shipments && (posting.expense_id || target.amount <= 0)) continue;
      const expenseId = await upsertCourierExpense(client, {
        tenantId,
        expenseId: posting?.expense_id || null,
        amount: target.amount,
        title: `استهلاك باقة بوسطة — ${target.shipments} شحنة`,
        day,
        notes: "قيد تلقائي: نصيب الشحنات اللي طلعت في اليوم ده من باقات بوسطة المدفوعة مقدماً. بيتعدّل لوحده — ماتعدّلوش يدوي.",
      });
      if (posting) {
        await client.query(`UPDATE courier_cost_postings SET amount = $2, shipments = $3, expense_id = COALESCE($4, expense_id), updated_at = NOW() WHERE id = $1`, [posting.id, target.amount, target.shipments, expenseId]);
      } else if (target.amount > 0) {
        await client.query(
          `INSERT INTO courier_cost_postings (tenant_id, provider, kind, day, expense_id, amount, shipments) VALUES ($1, $2, 'package', $3::date, $4, $5, $6)`,
          [tenantId ?? null, providerKey, day, expenseId, target.amount, target.shipments]
        );
      }
    }

    // 5. Settlements recorded before their fees reached the expenses get their row now.
    //    Checked first, never caught: a failed statement aborts the whole transaction and the
    //    COMMIT below would silently roll back everything above it.
    const feeParams = [];
    const hasSettlements = (await client.query(
      `SELECT COUNT(*)::int AS n FROM information_schema.columns WHERE table_name = 'courier_settlements' AND column_name = 'fee_expense_id'`
    )).rows[0]?.n > 0;
    const unposted = hasSettlements ? (await client.query(
      `
      SELECT s.id, s.fees_amount, s.settled_at, s.money_account_id, s.reference
      FROM courier_settlements s
      WHERE ${tenantClause(tenantId, feeParams, "s.tenant_id")} AND s.fees_amount > 0 AND s.fee_expense_id IS NULL
      `,
      feeParams
    )).rows : [];
    for (const settlement of unposted) {
      const expenseId = await postSettlementFeeExpense(client, { tenantId, settlement });
      if (expenseId) await client.query(`UPDATE courier_settlements SET fee_expense_id = $2 WHERE id = $1`, [settlement.id, expenseId]);
    }

    await client.query("COMMIT");
    return { released: released.rowCount, assigned, settlement_fees_posted: unposted.length };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
};

// Fire-and-forget hook for the shipment paths: a slow or failed reconcile must never fail
// the shipment itself — the next reconcile catches up.
// An order without a tenant would write tenant-less expense rows that the tenant's own
// reports never read; those wait for the next reconcile from the screen, which has one.
export const reconcileCourierCostsSoon = (options = {}) => {
  if (options.tenantId === null || options.tenantId === undefined) return;
  reconcileCourierCosts(options).catch((error) => console.warn("[courier-costs] reconcile skipped", { message: error?.message }));
};

export const postSettlementFeeExpense = async (client, { tenantId = null, settlement }) => upsertCourierExpense(client, {
  tenantId,
  amount: settlement.fees_amount,
  title: `رسوم بوسطة من التحويل — تسوية #${settlement.id}`,
  day: dayKey(settlement.settled_at) || dayKey(new Date()),
  notes: `قيد تلقائي: اللي بوسطة خصمته من التحويل (تحصيل، زيادات، بيك اب، مرتجعات)${text(settlement.reference) ? ` — مرجع ${text(settlement.reference)}` : ""}.`,
  paymentMethod: "bank_transfer",
  moneyAccountId: settlement.money_account_id,
});

export const createCourierPackage = async ({ tenantId = null, provider = "bosta", price, shipmentsCount, purchasedAt = null, moneyAccountId = null, reference = "", notes = "", createdBy = null } = {}) => {
  await ensureCourierCostSchema();
  const amount = round2(price);
  const count = Math.round(Number(shipmentsCount));
  if (!(amount > 0)) throw httpError("اكتب سعر الباقة");
  if (!Number.isFinite(count) || count < 1 || count > 100000) throw httpError("اكتب عدد الشحنات اللي في الباقة");
  const when = purchasedAt ? new Date(purchasedAt) : new Date();
  if (Number.isNaN(when.getTime())) throw httpError("تاريخ الشراء غير صحيح");
  const providerKey = text(provider).toLowerCase() || "bosta";
  const client = await db.connect();
  let pkg;
  try {
    await client.query("BEGIN");
    pkg = (await client.query(
      `
      INSERT INTO courier_packages (tenant_id, provider, purchased_at, price, shipments_count, money_account_id, reference, notes, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
      `,
      [tenantId ?? null, providerKey, when.toISOString(), amount, count, toNumberOrNull(moneyAccountId), text(reference) || null, text(notes) || null, toNumberOrNull(createdBy)]
    )).rows[0];
    // The money leaves the account now; it becomes an expense only as shipments use it.
    if (tenantId !== null && tenantId !== undefined) {
      const outbound = await postMoneyTransaction(client, {
        __inTransaction: true,
        tenantId,
        direction: "out",
        amount,
        transactionType: "supplier_payment",
        referenceType: "courier_package",
        referenceId: pkg.id,
        moneyAccountId: toNumberOrNull(moneyAccountId),
        accountType: toNumberOrNull(moneyAccountId) ? undefined : "bank",
        paymentMethod: "bank_transfer",
        notes: `باقة ${providerKey} — ${count} شحنة${text(reference) ? ` — ${text(reference)}` : ""}`,
        createdBy: toNumberOrNull(createdBy),
        metadata: { provider: providerKey, shipments: count, price: amount },
      });
      if (outbound?.id) {
        await client.query(`UPDATE courier_packages SET money_transaction_id = $2, money_account_id = COALESCE(money_account_id, $3) WHERE id = $1`, [pkg.id, outbound.id, outbound.account_id || null]);
      }
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  const reconcile = await reconcileCourierCosts({ tenantId, provider: providerKey });
  return { package: pkg, reconcile };
};

// A package entered by mistake: its units return, the shipments move to other packages
// (or stay unassigned), and the money comes back to the account.
export const voidCourierPackage = async ({ tenantId = null, id, voidedBy = null } = {}) => {
  await ensureCourierCostSchema();
  const params = [Number(id)];
  const where = [`p.id = $1`, tenantClause(tenantId, params, "p.tenant_id")];
  const client = await db.connect();
  let pkg;
  try {
    await client.query("BEGIN");
    pkg = (await client.query(`SELECT p.* FROM courier_packages p WHERE ${where.join(" AND ")} FOR UPDATE`, params)).rows[0];
    if (!pkg) throw httpError("الباقة مش موجودة", 404);
    if (pkg.voided_at) throw httpError("الباقة دي اتلغت قبل كده", 409);
    await client.query(`UPDATE courier_packages SET voided_at = NOW(), voided_by = $2 WHERE id = $1`, [pkg.id, toNumberOrNull(voidedBy)]);
    if (tenantId !== null && tenantId !== undefined && pkg.money_transaction_id) {
      await reverseMoneyTransactionsForReference(client, {
        tenantId,
        referenceType: "courier_package",
        referenceId: pkg.id,
        notes: `إلغاء باقة ${pkg.provider} #${pkg.id}`,
        createdBy: toNumberOrNull(voidedBy),
      });
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  const reconcile = await reconcileCourierCosts({ tenantId, provider: pkg.provider });
  return { id: pkg.id, reconcile };
};

export const listCourierPackages = async ({ tenantId = null, provider = "bosta" } = {}) => {
  await ensureCourierCostSchema();
  const params = [];
  const rows = (await db.query(
    `
    SELECT p.*, ma.name AS money_account_name, u.name AS created_by_name,
      COALESCE(c.used, 0)::int AS used, COALESCE(c.used_cost, 0)::numeric AS used_cost,
      c.first_used_at, c.last_used_at
    FROM courier_packages p
    LEFT JOIN money_accounts ma ON ma.id = p.money_account_id
    LEFT JOIN users u ON u.id = p.created_by
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS used, SUM(o.courier_package_cost) AS used_cost, MIN(o.courier_package_used_at) AS first_used_at, MAX(o.courier_package_used_at) AS last_used_at
      FROM orders o WHERE o.courier_package_id = p.id
    ) c ON TRUE
    WHERE ${packageScope(tenantId, provider, params)}
    ORDER BY p.purchased_at DESC, p.id DESC
    LIMIT 200
    `,
    params
  )).rows.map((row) => ({
    ...row,
    price: round2(row.price),
    unit_cost: round2(Number(row.price) / Math.max(1, Number(row.shipments_count))),
    used_cost: round2(row.used_cost),
    remaining: row.voided_at ? 0 : Math.max(0, Number(row.shipments_count) - Number(row.used)),
    remaining_value: row.voided_at ? 0 : round2(Number(row.price) - Number(row.used_cost || 0)),
  }));

  // Shipments since the first package that no package covers: the account is shipping on
  // credit (or a package was never entered) and those parcels have no shipping cost yet.
  const active = rows.filter((row) => !row.voided_at);
  let uncovered = { count: 0, since: null };
  if (active.length) {
    const firstPurchase = active.reduce((min, row) => (new Date(row.purchased_at) < new Date(min) ? row.purchased_at : min), active[0].purchased_at);
    const tz = getAppTimeZone();
    const uParams = [];
    const uTenant = tenantClause(tenantId, uParams);
    uParams.push(text(provider).toLowerCase() || "bosta");
    const providerParam = `$${uParams.length}`;
    uParams.push(new Date(firstPurchase).toISOString());
    const sinceParam = `$${uParams.length}`;
    const result = await db.query(
      `
      SELECT COUNT(*)::int AS count FROM (
        SELECT ${shippedAtSql()} AS shipped_at FROM orders o
        WHERE ${uTenant} AND o.courier_package_id IS NULL AND ${providerSql()} = ${providerParam}
          AND ${trackingSql()} <> '' AND ${shipmentStatusSql()} NOT IN (${sqlList(CANCELLED_SHIPMENT_STATUSES)})
      ) s WHERE s.shipped_at >= ((${sinceParam}::timestamptz AT TIME ZONE '${tz}')::date)::timestamp AT TIME ZONE '${tz}'
      `,
      uParams
    );
    uncovered = { count: Number(result.rows[0]?.count || 0), since: firstPurchase };
  }

  return {
    packages: rows,
    summary: {
      remaining_shipments: active.reduce((sum, row) => sum + row.remaining, 0),
      remaining_value: round2(active.reduce((sum, row) => sum + row.remaining_value, 0)),
      current_unit_cost: active.filter((row) => row.remaining > 0).sort((a, b) => new Date(a.purchased_at) - new Date(b.purchased_at))[0]?.unit_cost ?? null,
      uncovered_shipments: uncovered.count,
      uncovered_since: uncovered.since,
    },
    settings: await getCourierCostSettings({ tenantId, provider }),
  };
};

/*
 * The estimated pickup fee per parcel: parcels grouped by the day they reached the courier
 * (first "picked up or later" event), and a day under the threshold costs the flat fee,
 * shared by its parcels. Returns Map(order_id → { day, parcels, fee_share }) plus the days.
 */
export const estimatePickupFees = async ({ tenantId = null, provider = "bosta", orderIds = null, dateFrom = "", dateTo = "", settings = null } = {}, client = db) => {
  const config = settings || (await getCourierCostSettings({ tenantId, provider }, client));
  const tz = getAppTimeZone();
  const params = [];
  const where = [tenantClause(tenantId, params), `${providerSql()} = $${params.push(text(provider).toLowerCase() || "bosta")}`];
  const result = await client.query(
    `
    WITH firsts AS (
      SELECT se.order_id, MIN(se.created_at) AS picked_at
      FROM shipping_events se
      JOIN orders o ON o.id = se.order_id
      WHERE ${where.join(" AND ")} AND se.status IN (${sqlList(PICKED_UP_STATUSES)})
      GROUP BY se.order_id
    )
    SELECT order_id, TO_CHAR((picked_at AT TIME ZONE '${tz}')::date, 'YYYY-MM-DD') AS day FROM firsts
    `,
    params
  ).catch(() => ({ rows: [] }));
  const byDay = new Map();
  for (const row of result.rows) {
    if (!byDay.has(row.day)) byDay.set(row.day, []);
    byDay.get(row.day).push(Number(row.order_id));
  }
  const perOrder = new Map();
  const days = [];
  for (const [day, ids] of byDay) {
    const fee = pickupFeeFor(ids.length, config);
    const shares = ids.map((_, index) => (fee > 0 ? (index === ids.length - 1 ? round2(fee - round2(fee / ids.length) * (ids.length - 1)) : round2(fee / ids.length)) : 0));
    ids.forEach((id, index) => perOrder.set(id, { day, parcels: ids.length, fee_share: shares[index] }));
    if ((!dateFrom || day >= dateFrom) && (!dateTo || day <= dateTo)) days.push({ day, parcels: ids.length, fee });
  }
  const wanted = Array.isArray(orderIds) ? new Set(orderIds.map(Number)) : null;
  if (wanted) for (const id of [...perOrder.keys()]) if (!wanted.has(id)) perOrder.delete(id);
  days.sort((a, b) => (a.day < b.day ? 1 : -1));
  return { perOrder, days, settings: config };
};

/*
 * What each shipment cost: its package unit, Bosta's own per-parcel fees (or, once
 * settled, its actual share of what was deducted), and its share of a small pickup —
 * against what the customer paid for shipping.
 */
export const getCourierCostReport = async ({ tenantId = null, provider = "bosta", dateFrom = "", dateTo = "", search = "", limit = 500 } = {}) => {
  await ensureCourierCostSchema();
  const providerKey = text(provider).toLowerCase() || "bosta";
  const tz = getAppTimeZone();
  const params = [];
  const where = [
    tenantClause(tenantId, params),
    `${providerSql()} = $${params.push(providerKey)}`,
    `${trackingSql()} <> ''`,
  ];
  if (dateFrom) where.push(`(s.shipped_at AT TIME ZONE '${tz}')::date >= $${params.push(dateFrom)}::date`);
  if (dateTo) where.push(`(s.shipped_at AT TIME ZONE '${tz}')::date <= $${params.push(dateTo)}::date`);
  if (text(search)) {
    const i = params.push(`%${text(search)}%`);
    where.push(`(COALESCE(o.public_order_number, '') ILIKE $${i} OR COALESCE(o.invoice_number, '') ILIKE $${i} OR COALESCE(o.customer_name, '') ILIKE $${i} OR COALESCE(o.customer_phone, '') ILIKE $${i} OR ${trackingSql()} ILIKE $${i})`);
  }
  const limitParam = params.push(Math.min(Math.max(Number(limit) || 500, 1), 3000));
  const rows = (await db.query(
    `
    SELECT
      o.id,
      COALESCE(o.public_order_number, o.display_order_number, o.invoice_number, 'ORD-' || o.id::text) AS order_number,
      o.customer_name, o.customer_phone,
      ${trackingSql()} AS tracking_number,
      ${shipmentStatusSql()} AS shipment_status,
      s.shipped_at,
      COALESCE(o.shipping_cost, 0)::numeric AS shipping_charged,
      o.courier_package_id, o.courier_package_cost,
      o.bosta_shipment_fees,
      i.fee_amount AS settled_fee,
      o.courier_settlement_id
    FROM orders o
    CROSS JOIN LATERAL (SELECT ${shippedAtSql()} AS shipped_at) s
    LEFT JOIN courier_settlement_items i ON i.order_id = o.id AND i.settlement_id = o.courier_settlement_id
    WHERE ${where.join(" AND ")}
    ORDER BY s.shipped_at DESC, o.id DESC
    LIMIT $${limitParam}
    `,
    params
  )).rows;
  const pickups = await estimatePickupFees({ tenantId, provider: providerKey, orderIds: rows.map((row) => row.id), dateFrom, dateTo });
  const cancelled = new Set(CANCELLED_SHIPMENT_STATUSES);
  const shaped = rows.map((row) => {
    const pickup = pickups.perOrder.get(Number(row.id)) || null;
    const isCancelled = cancelled.has(String(row.shipment_status || ""));
    const packageCost = row.courier_package_cost === null ? null : round2(row.courier_package_cost);
    const settled = row.settled_fee !== null && row.settled_fee !== undefined;
    // Once settled, the actual deduction already contains the pickup fee; before that the
    // per-parcel fee and the pickup share are the best estimate of what will be deducted.
    const bostaFees = settled ? round2(row.settled_fee) : round2(Number(row.bosta_shipment_fees || 0) + Number(pickup?.fee_share || 0));
    const totalCost = isCancelled ? 0 : round2((packageCost || 0) + bostaFees);
    return {
      id: row.id,
      order_number: row.order_number,
      customer_name: row.customer_name,
      customer_phone: row.customer_phone,
      tracking_number: row.tracking_number,
      shipment_status: row.shipment_status,
      shipped_at: row.shipped_at,
      shipping_charged: round2(row.shipping_charged),
      package_id: row.courier_package_id ? Number(row.courier_package_id) : null,
      package_cost: packageCost,
      bosta_fees: round2(row.bosta_shipment_fees || 0),
      pickup_fee_share: pickup?.fee_share || 0,
      pickup_parcels: pickup?.parcels || null,
      fees_source: settled ? "settled" : "estimate",
      fees_total: bostaFees,
      total_cost: totalCost,
      shipping_margin: isCancelled ? null : round2(Number(row.shipping_charged || 0) - totalCost),
      settlement_id: row.courier_settlement_id ? Number(row.courier_settlement_id) : null,
      cancelled: isCancelled,
    };
  });
  const live = shaped.filter((row) => !row.cancelled);
  const summary = {
    shipments: live.length,
    package_cost: round2(live.reduce((sum, row) => sum + (row.package_cost || 0), 0)),
    uncovered_shipments: live.filter((row) => row.package_cost === null).length,
    bosta_fees: round2(live.reduce((sum, row) => sum + row.fees_total, 0)),
    pickup_fees_estimate: round2(pickups.days.reduce((sum, day) => sum + day.fee, 0)),
    small_pickups: pickups.days.filter((day) => day.fee > 0).length,
    total_cost: round2(live.reduce((sum, row) => sum + row.total_cost, 0)),
    shipping_charged: round2(live.reduce((sum, row) => sum + row.shipping_charged, 0)),
  };
  summary.shipping_margin = round2(summary.shipping_charged - summary.total_cost);
  summary.average_cost = summary.shipments ? round2(summary.total_cost / summary.shipments) : 0;

  // What the transfers actually deducted in the window against what Bosta's own per-parcel
  // figures say — the gap is what to ask Bosta about (returns, pickups, anything unlisted).
  const sParams = [];
  const sWhere = [tenantClause(tenantId, sParams, "s.tenant_id"), `LOWER(s.provider) = $${sParams.push(providerKey)}`];
  if (dateFrom) sWhere.push(`(s.settled_at AT TIME ZONE '${tz}')::date >= $${sParams.push(dateFrom)}::date`);
  if (dateTo) sWhere.push(`(s.settled_at AT TIME ZONE '${tz}')::date <= $${sParams.push(dateTo)}::date`);
  const settlements = (await db.query(
    `SELECT COUNT(*)::int AS count, COALESCE(SUM(s.fees_amount), 0)::numeric AS fees, COALESCE(SUM(s.expected_fees_amount), 0)::numeric AS expected FROM courier_settlements s WHERE ${sWhere.join(" AND ")}`,
    sParams
  ).catch(() => ({ rows: [{}] }))).rows[0] || {};
  summary.settlements = {
    count: Number(settlements.count || 0),
    fees: round2(settlements.fees),
    expected: round2(settlements.expected),
    difference: round2(Number(settlements.fees || 0) - Number(settlements.expected || 0)),
  };
  return { rows: shaped, summary, pickups: pickups.days.slice(0, 60), settings: pickups.settings };
};
