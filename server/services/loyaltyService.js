import { applyWalletActivity, calculateWalletCashback } from "./walletService.js";
import { getPhoneSearchVariants, normalizePhone, phoneSqlDigits } from "../utils/phoneSearch.js";

export const LOYALTY_RULES = {
  spendAmount: 1,
  earnPoints: 1,
};

export const TIER_THRESHOLDS = {
  Bronze: 0,
  Silver: 5000,
  Gold: 20000,
  Platinum: 50000,
};

let loyaltySchemaReadyPromise = null;

export const ensureLoyaltySchema = async (client) => {
  if (!loyaltySchemaReadyPromise) {
    loyaltySchemaReadyPromise = (async () => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS customer_loyalty (
          id BIGSERIAL PRIMARY KEY,
          tenant_id BIGINT,
          customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
          tier VARCHAR(50) NOT NULL DEFAULT 'Bronze',
          total_points_earned NUMERIC(12,2) NOT NULL DEFAULT 0,
          total_points_redeemed NUMERIC(12,2) NOT NULL DEFAULT 0,
          available_points NUMERIC(12,2) NOT NULL DEFAULT 0,
          lifetime_points NUMERIC(12,2) NOT NULL DEFAULT 0,
          lifetime_spent NUMERIC(12,2) NOT NULL DEFAULT 0,
          last_order_at TIMESTAMP NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (tenant_id, customer_id)
        )
      `);

      await client.query(`ALTER TABLE customer_loyalty ADD COLUMN IF NOT EXISTS lifetime_points NUMERIC(12,2) NOT NULL DEFAULT 0`);

      await client.query(`ALTER TABLE IF EXISTS customers ADD COLUMN IF NOT EXISTS loyalty_points NUMERIC(12,2) NOT NULL DEFAULT 0`);
      await client.query(`ALTER TABLE IF EXISTS customers ADD COLUMN IF NOT EXISTS loyalty_tier VARCHAR(50) NOT NULL DEFAULT 'Bronze'`);
      await client.query(`ALTER TABLE IF EXISTS customers ADD COLUMN IF NOT EXISTS total_spent NUMERIC(12,2) NOT NULL DEFAULT 0`);
      await client.query(`ALTER TABLE IF EXISTS customers ADD COLUMN IF NOT EXISTS total_orders INTEGER NOT NULL DEFAULT 0`);
      await client.query(`ALTER TABLE IF EXISTS customers ADD COLUMN IF NOT EXISTS loyalty_updated_at TIMESTAMP NULL`);
      await client.query(`ALTER TABLE IF EXISTS customers ADD COLUMN IF NOT EXISTS wallet_balance NUMERIC(12,2) NOT NULL DEFAULT 0`);
      await client.query(`ALTER TABLE IF EXISTS customers ADD COLUMN IF NOT EXISTS status VARCHAR(50) NOT NULL DEFAULT 'active'`);
      await client.query(`ALTER TABLE IF EXISTS customers ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP`);

      await client.query(`
        CREATE TABLE IF NOT EXISTS customer_loyalty_history (
          id BIGSERIAL PRIMARY KEY,
          tenant_id BIGINT,
          customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
          order_id BIGINT NULL REFERENCES orders(id) ON DELETE SET NULL,
          source VARCHAR(50) NOT NULL DEFAULT 'pos',
          points_change NUMERIC(12,2) NOT NULL DEFAULT 0,
          balance_after NUMERIC(12,2) NOT NULL DEFAULT 0,
          reason TEXT NOT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);

      await client.query(`ALTER TABLE customer_loyalty_history ADD COLUMN IF NOT EXISTS tenant_id BIGINT`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_customer_loyalty_history_customer ON customer_loyalty_history (tenant_id, customer_id, created_at DESC)`);
      await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_loyalty_history_order_reason
        ON customer_loyalty_history (COALESCE(tenant_id, 0), customer_id, order_id, source, reason)
        WHERE order_id IS NOT NULL
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS loyalty_transactions (
          id BIGSERIAL PRIMARY KEY,
          tenant_id BIGINT,
          customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
          order_id BIGINT NULL REFERENCES orders(id) ON DELETE SET NULL,
          transaction_type VARCHAR(50) NOT NULL,
          points NUMERIC(12,2) NOT NULL DEFAULT 0,
          amount_value NUMERIC(12,2) NOT NULL DEFAULT 0,
          description TEXT,
          created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);

      await client.query(`CREATE INDEX IF NOT EXISTS idx_customer_loyalty_customer ON customer_loyalty (tenant_id, customer_id)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_loyalty_transactions_customer ON loyalty_transactions (tenant_id, customer_id, created_at DESC)`);
    })().catch((error) => {
      loyaltySchemaReadyPromise = null;
      throw error;
    });
  }

  return loyaltySchemaReadyPromise;
};

export const calculateEarnedPoints = (orderTotal = 0) => {
  const total = Math.max(0, Number(orderTotal || 0));
  return Math.floor(total / LOYALTY_RULES.spendAmount) * LOYALTY_RULES.earnPoints;
};

export const calculatePoints = (order = {}) =>
  calculateEarnedPoints(order.total_amount ?? order.total ?? order.total_price ?? order.orderTotal ?? 0);

export const calculateTier = (points = 0) => {
  const value = Number(points || 0);
  if (value >= TIER_THRESHOLDS.Platinum) return "Platinum";
  if (value >= TIER_THRESHOLDS.Gold) return "Gold";
  if (value >= TIER_THRESHOLDS.Silver) return "Silver";
  return "Bronze";
};

export const resolveCustomerTier = (lifetimePoints = 0) => {
  const points = Number(lifetimePoints || 0);
  return calculateTier(points);
};

const isCancelled = (status) => ["cancelled", "canceled", "void", "refunded"].includes(String(status || "").toLowerCase());

const isPaidOrCompleted = (order = {}) => {
  const status = String(order.status || "").toLowerCase();
  const paymentStatus = String(order.payment_status || order.paymentStatus || "").toLowerCase();
  const total = Number(order.total_amount ?? order.total ?? order.total_price ?? order.orderTotal ?? 0);
  const paid = Number(order.paid_amount ?? order.paidAmount ?? 0);
  return ["completed", "complete", "delivered", "done", "paid"].includes(status)
    || ["paid", "completed", "complete", "settled"].includes(paymentStatus)
    || (total > 0 && paid >= total);
};

const normalizeSource = (order = {}) => {
  const source = String(order.source || order.channel || "pos").toLowerCase();
  return source === "website" || source === "storefront" || source === "web" ? "website" : "pos";
};

const readCustomerBalance = async (client, { tenantId, customerId }) => {
  const result = await client.query(
    `
    SELECT
      COALESCE(loyalty_points, 0) AS loyalty_points,
      COALESCE(total_spent, 0) AS total_spent,
      COALESCE(total_orders, 0) AS total_orders
    FROM customers
    WHERE id = $1
      AND ($2::bigint IS NULL OR tenant_id = $2::bigint OR tenant_id IS NULL)
    FOR UPDATE
    `,
    [customerId, tenantId]
  );
  return result.rows[0] || { loyalty_points: 0, total_spent: 0, total_orders: 0 };
};

const syncCustomerLoyalty = async (client, { tenantId, customerId, points, totalSpent, totalOrders }) => {
  const tier = calculateTier(points);
  await client.query(
    `
    UPDATE customers
    SET loyalty_points = $1,
        loyalty_tier = $2,
        total_spent = $3,
        total_orders = $4,
        loyalty_updated_at = NOW(),
        updated_at = NOW()
    WHERE id = $5
      AND ($6::bigint IS NULL OR tenant_id = $6::bigint OR tenant_id IS NULL)
    `,
    [points, tier, totalSpent, totalOrders, customerId, tenantId]
  );

  await client.query(
    `
    INSERT INTO customer_loyalty (
      tenant_id,
      customer_id,
      tier,
      total_points_earned,
      total_points_redeemed,
      available_points,
      lifetime_points,
      lifetime_spent,
      last_order_at,
      updated_at
    )
    VALUES ($1,$2,$3,$4,0,$4,$4,$5,NOW(),NOW())
    ON CONFLICT (tenant_id, customer_id)
    DO UPDATE SET
      tier = EXCLUDED.tier,
      total_points_earned = GREATEST(customer_loyalty.total_points_earned, EXCLUDED.total_points_earned),
      available_points = EXCLUDED.available_points,
      lifetime_points = EXCLUDED.lifetime_points,
      lifetime_spent = EXCLUDED.lifetime_spent,
      last_order_at = EXCLUDED.last_order_at,
      updated_at = NOW()
    `,
    [tenantId, customerId, tier, points, totalSpent]
  );

  return { points, tier, total_spent: totalSpent, total_orders: totalOrders };
};

export const applyOrderLoyalty = async (client, order = {}) => {
  await ensureLoyaltySchema(client);
  const customerId = order.customer_id || order.customerId;
  const orderId = order.id || order.order_id || order.orderId;
  const tenantId = order.tenant_id ?? order.tenantId ?? null;
  const source = normalizeSource(order);
  const orderTotal = Math.max(0, Number(order.total_amount ?? order.total ?? order.total_price ?? order.orderTotal ?? 0));

  if (!customerId || !orderId) return { applied: false, reason: "missing_customer_or_order" };
  if (isCancelled(order.status) || isCancelled(order.payment_status)) return reverseOrderLoyalty(client, order);
  if (!isPaidOrCompleted(order)) return { applied: false, reason: "order_not_paid_or_completed" };

  const points = calculatePoints({ orderTotal });
  if (points <= 0) return { applied: false, reason: "zero_points" };

  const customer = await readCustomerBalance(client, { tenantId, customerId });
  const currentPoints = Number(customer.loyalty_points || 0);
  const nextPoints = currentPoints + points;
  const nextSpent = Number(customer.total_spent || 0) + orderTotal;
  const nextOrders = Number(customer.total_orders || 0) + 1;

  const inserted = await client.query(
    `
    INSERT INTO customer_loyalty_history (
      tenant_id,
      customer_id,
      order_id,
      source,
      points_change,
      balance_after,
      reason
    )
    VALUES ($1,$2,$3,$4,$5,$6,'order_earned')
    ON CONFLICT DO NOTHING
    RETURNING *
    `,
    [tenantId, customerId, orderId, source, points, nextPoints]
  );

  if (!inserted.rows[0]) {
    return { applied: false, duplicate: true, reason: "already_applied" };
  }

  await client.query(
    `
    INSERT INTO loyalty_transactions (
      tenant_id,
      customer_id,
      order_id,
      transaction_type,
      points,
      amount_value,
      description,
      created_by
    )
    VALUES ($1,$2,$3,'earned',$4,$5,$6,$7)
    ON CONFLICT DO NOTHING
    `,
    [tenantId, customerId, orderId, points, orderTotal, `Earned ${points} points from order #${orderId}`, order.created_by || order.userId || null]
  );

  const summary = await syncCustomerLoyalty(client, {
    tenantId,
    customerId,
    points: nextPoints,
    totalSpent: nextSpent,
    totalOrders: nextOrders,
  });

  return { applied: true, pointsEarned: points, availablePoints: nextPoints, tier: summary.tier };
};

export const reverseOrderLoyalty = async (client, order = {}) => {
  await ensureLoyaltySchema(client);
  const customerId = order.customer_id || order.customerId;
  const orderId = order.id || order.order_id || order.orderId;
  const tenantId = order.tenant_id ?? order.tenantId ?? null;
  const source = normalizeSource(order);
  const orderTotal = Math.max(0, Number(order.total_amount ?? order.total ?? order.total_price ?? order.orderTotal ?? 0));

  if (!customerId || !orderId) return { reversed: false, reason: "missing_customer_or_order" };

  const earned = await client.query(
    `
    SELECT *
    FROM customer_loyalty_history
    WHERE customer_id = $1
      AND order_id = $2
      AND source = $3
      AND reason = 'order_earned'
      AND ($4::bigint IS NULL OR tenant_id = $4::bigint OR tenant_id IS NULL)
    ORDER BY id DESC
    LIMIT 1
    `,
    [customerId, orderId, source, tenantId]
  );
  const earnedRow = earned.rows[0];
  if (!earnedRow) return { reversed: false, reason: "no_points_to_reverse" };

  const customer = await readCustomerBalance(client, { tenantId, customerId });
  const points = Math.abs(Number(earnedRow.points_change || 0));
  const nextPoints = Math.max(0, Number(customer.loyalty_points || 0) - points);
  const nextSpent = Math.max(0, Number(customer.total_spent || 0) - orderTotal);
  const nextOrders = Math.max(0, Number(customer.total_orders || 0) - 1);

  const inserted = await client.query(
    `
    INSERT INTO customer_loyalty_history (
      tenant_id,
      customer_id,
      order_id,
      source,
      points_change,
      balance_after,
      reason
    )
    VALUES ($1,$2,$3,$4,$5,$6,'order_reversed')
    ON CONFLICT DO NOTHING
    RETURNING *
    `,
    [tenantId, customerId, orderId, source, -points, nextPoints]
  );

  if (!inserted.rows[0]) return { reversed: false, duplicate: true, reason: "already_reversed" };

  await client.query(
    `
    INSERT INTO loyalty_transactions (
      tenant_id,
      customer_id,
      order_id,
      transaction_type,
      points,
      amount_value,
      description,
      created_by
    )
    VALUES ($1,$2,$3,'reversed',$4,$5,$6,$7)
    ON CONFLICT DO NOTHING
    `,
    [tenantId, customerId, orderId, -points, orderTotal, `Reversed ${points} points from order #${orderId}`, order.cancelled_by || order.userId || null]
  );

  const summary = await syncCustomerLoyalty(client, {
    tenantId,
    customerId,
    points: nextPoints,
    totalSpent: nextSpent,
    totalOrders: nextOrders,
  });

  return { reversed: true, pointsReversed: points, availablePoints: nextPoints, tier: summary.tier };
};

export const rebuildCustomerLoyalty = async (client, customerId, tenantId = null) => {
  await ensureLoyaltySchema(client);
  await readCustomerBalance(client, { tenantId, customerId });

  await client.query(
    `
    DELETE FROM customer_loyalty_history
    WHERE customer_id = $1
      AND reason IN ('order_earned', 'order_reversed')
      AND ($2::bigint IS NULL OR tenant_id = $2::bigint OR tenant_id IS NULL)
    `,
    [customerId, tenantId]
  );

  const orders = await client.query(
    `
    SELECT *
    FROM orders
    WHERE customer_id = $1
      AND ($2::bigint IS NULL OR tenant_id = $2::bigint OR tenant_id IS NULL)
    ORDER BY created_at ASC, id ASC
    `,
    [customerId, tenantId]
  );

  await syncCustomerLoyalty(client, { tenantId, customerId, points: 0, totalSpent: 0, totalOrders: 0 });
  for (const order of orders.rows) {
    if (isCancelled(order.status) || isCancelled(order.payment_status)) continue;
    await applyOrderLoyalty(client, order);
  }

  const summary = await getCustomerLoyaltySummary(client, customerId, tenantId);
  return { rebuilt: true, ...summary };
};

export const rebuildAllCustomerLoyalty = async (client, tenantId = null) => {
  await ensureLoyaltySchema(client);
  const customers = await client.query(
    `
    SELECT id
    FROM customers
    WHERE ($1::bigint IS NULL OR tenant_id = $1::bigint OR tenant_id IS NULL)
    ORDER BY id ASC
    `,
    [tenantId]
  );
  const results = [];
  for (const customer of customers.rows) {
    results.push(await rebuildCustomerLoyalty(client, customer.id, tenantId));
  }
  return { count: results.length, results };
};

export const adjustCustomerLoyaltyPoints = async (client, {
  tenantId = null,
  customerId,
  pointsChange,
  reason = "manual_adjustment",
  source = "admin",
}) => {
  await ensureLoyaltySchema(client);
  const change = Number(pointsChange || 0);
  if (!customerId || !Number.isFinite(change) || change === 0) {
    const error = new Error("Valid customer and points change are required");
    error.status = 400;
    throw error;
  }

  const customer = await readCustomerBalance(client, { tenantId, customerId });
  const nextPoints = Math.max(0, Number(customer.loyalty_points || 0) + change);
  await client.query(
    `
    INSERT INTO customer_loyalty_history (
      tenant_id,
      customer_id,
      source,
      points_change,
      balance_after,
      reason
    )
    VALUES ($1,$2,$3,$4,$5,$6)
    `,
    [tenantId, customerId, source, change, nextPoints, reason]
  );
  const summary = await syncCustomerLoyalty(client, {
    tenantId,
    customerId,
    points: nextPoints,
    totalSpent: Number(customer.total_spent || 0),
    totalOrders: Number(customer.total_orders || 0),
  });
  return { adjusted: true, points_change: change, ...summary };
};

export const getCustomerLoyaltySummary = async (client, customerId, tenantId = null, limit = 8) => {
  await ensureLoyaltySchema(client);
  const customer = await client.query(
    `
    SELECT id, loyalty_points, loyalty_tier, total_spent, total_orders, wallet_balance
    FROM customers
    WHERE id = $1
      AND ($2::bigint IS NULL OR tenant_id = $2::bigint OR tenant_id IS NULL)
    LIMIT 1
    `,
    [customerId, tenantId]
  );
  const row = customer.rows[0] || {};
  const points = Number(row.loyalty_points || 0);
  const tier = row.loyalty_tier || calculateTier(points);
  const thresholds = Object.entries(TIER_THRESHOLDS);
  const currentIndex = Math.max(0, thresholds.findIndex(([name]) => name === tier));
  const next = thresholds[Math.min(currentIndex + 1, thresholds.length - 1)];
  const current = thresholds[currentIndex] || thresholds[0];
  const span = Math.max(1, Number(next[1]) - Number(current[1]));
  const progress = next[0] === current[0] ? 100 : Math.min(100, Math.max(0, ((points - Number(current[1])) / span) * 100));
  const history = await client.query(
    `
    SELECT *
    FROM customer_loyalty_history
    WHERE customer_id = $1
      AND ($2::bigint IS NULL OR tenant_id = $2::bigint OR tenant_id IS NULL)
    ORDER BY created_at DESC, id DESC
    LIMIT $3
    `,
    [customerId, tenantId, limit]
  );

  return {
    points,
    available_points: points,
    tier,
    total_spent: Number(row.total_spent || 0),
    total_orders: Number(row.total_orders || 0),
    wallet_balance: Number(row.wallet_balance || 0),
    next_tier: next[0] === tier ? null : next[0],
    points_to_next_tier: next[0] === tier ? 0 : Math.max(0, Number(next[1]) - points),
    progress,
    recent_history: history.rows,
    transactions: history.rows,
  };
};

export const resolveOrCreateCustomerAccount = async (client, {
  tenantId,
  customerId = null,
  name = "Customer",
  phone = "",
  email = "",
  address = "",
}) => {
  await ensureLoyaltySchema(client);
  if (customerId) {
    const existing = await client.query(
      `SELECT * FROM customers WHERE id = $1 AND ($2::bigint IS NULL OR tenant_id = $2::bigint OR tenant_id IS NULL) LIMIT 1`,
      [customerId, tenantId]
    );
    if (existing.rows[0]) return existing.rows[0];
  }

  const normalizedPhone = normalizePhone(phone);
  const phoneVariants = getPhoneSearchVariants(normalizedPhone);
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!phoneVariants.length && !normalizedEmail) {
    const guestPhone = `guest:${tenantId || "default"}`;
    const guest = await client.query(
      `
      SELECT *
      FROM customers
      WHERE phone = $1
        AND ($2::bigint IS NULL OR tenant_id = $2::bigint OR tenant_id IS NULL)
      LIMIT 1
      FOR UPDATE
      `,
      [guestPhone, tenantId]
    );
    if (guest.rows[0]) return guest.rows[0];
    const createdGuest = await client.query(
      `
      INSERT INTO customers (tenant_id, name, phone, status)
      VALUES ($1,$2,$3,'active')
      RETURNING *
      `,
      [tenantId, "Guest Customer", guestPhone]
    );
    return createdGuest.rows[0];
  }
  const clauses = [];
  const params = [];
  if (phoneVariants.length) {
    params.push(phoneVariants);
    clauses.push(`${phoneSqlDigits("phone")} = ANY($${params.length}::text[])`);
  }
  if (normalizedEmail) {
    params.push(normalizedEmail);
    clauses.push(`LOWER(COALESCE(email, '')) = $${params.length}`);
  }
  if (clauses.length) {
    params.push(tenantId);
    const found = await client.query(
      `
      SELECT *
      FROM customers
      WHERE (${clauses.join(" OR ")})
        AND ($${params.length}::bigint IS NULL OR tenant_id = $${params.length}::bigint OR tenant_id IS NULL)
      ORDER BY updated_at DESC NULLS LAST, id DESC
      LIMIT 1
      FOR UPDATE
      `,
      params
    );
    if (found.rows[0]) {
      await client.query(
        `
        UPDATE customers
        SET name = COALESCE(NULLIF($1, ''), name),
            phone = COALESCE(NULLIF($2, ''), phone),
            email = COALESCE(NULLIF($3, ''), email),
            address = COALESCE(NULLIF($4, ''), address),
            updated_at = NOW()
        WHERE id = $5
        `,
        [name, normalizedPhone || phone, normalizedEmail, address, found.rows[0].id]
      );
      return { ...found.rows[0], phone: normalizedPhone || found.rows[0].phone, email: normalizedEmail || found.rows[0].email };
    }
  }

  const created = await client.query(
    `
    INSERT INTO customers (tenant_id, name, phone, email, address, status)
    VALUES ($1,$2,$3,$4,$5,'active')
    RETURNING *
    `,
    [tenantId, String(name || "").trim() || "Customer", normalizedPhone || phone || null, normalizedEmail || null, address || null]
  );
  return created.rows[0];
};

export const processOrderLoyalty = async (client, {
  tenantId,
  orderId,
  customerId,
  orderTotal,
  paidAmount,
  status,
  paymentStatus,
  redeemPoints = 0,
  walletRedemptionAmount = 0,
  skipEarning = false,
  fullWalletRedemptionOnly = false,
  userId = null,
}) => {
  await ensureLoyaltySchema(client);

  const emptyResult = {
    earned: false,
    redeemed: false,
    pointsEarned: 0,
    pointsRedeemed: 0,
    availablePoints: 0,
    lifetimePoints: 0,
    tier: "Bronze",
    previousTier: "Bronze",
    tierUpgraded: false,
    cashbackAmount: 0,
    walletRedeemedAmount: 0,
    walletBalance: 0,
    activities: [],
  };

  if (!customerId) {
    return { ...emptyResult, reason: "missing_customer" };
  }

  const total = Math.max(0, Number(orderTotal || 0));
  const allowEarning = !skipEarning && !fullWalletRedemptionOnly;
  const requestedRedeem = Math.max(0, Number(redeemPoints || 0));
  const activities = [];
  let pointsRedeemed = 0;

  if (requestedRedeem > 0) {
    const current = await readCustomerBalance(client, { tenantId, customerId });
    const availablePoints = Number(current.loyalty_points || 0);
    if (requestedRedeem > availablePoints) {
      return { ...emptyResult, reason: "over_redemption", maxRedeemable: availablePoints };
    }
    const redemptionBalance = Math.max(0, availablePoints - requestedRedeem);
    const redemption = await client.query(
      `
      INSERT INTO customer_loyalty_history (
        tenant_id,
        customer_id,
        order_id,
        source,
        points_change,
        balance_after,
        reason
      )
      VALUES ($1,$2,$3,$4,$5,$6,'order_redeemed')
      ON CONFLICT DO NOTHING
      RETURNING *
      `,
      [tenantId, customerId, orderId || null, "pos", -Math.abs(requestedRedeem), redemptionBalance]
    );
    if (!redemption.rows[0]) {
      return { ...emptyResult, reason: "redemption_already_applied", duplicate: true };
    }
    await syncCustomerLoyalty(client, {
      tenantId,
      customerId,
      points: redemptionBalance,
      totalSpent: Number(current.total_spent || 0),
      totalOrders: Number(current.total_orders || 0),
    });
    pointsRedeemed = requestedRedeem;
    activities.push(`Redeemed ${requestedRedeem} points`);

    await client.query(
      `
      INSERT INTO loyalty_transactions (
        tenant_id,
        customer_id,
        order_id,
        transaction_type,
        points,
        amount_value,
        description,
        created_by
      )
      VALUES ($1,$2,$3,'redeemed',$4,$5,$6,$7)
      `,
      [tenantId, customerId, orderId || null, -Math.abs(requestedRedeem), total, `Redeemed ${requestedRedeem} points on order #${orderId}`, userId]
    );
  }

  const order = {
    id: orderId,
    tenant_id: tenantId,
    customer_id: customerId,
    total_amount: total,
    paid_amount: paidAmount,
    status,
    payment_status: paymentStatus,
    source: "pos",
    channel: "pos",
    userId,
  };
  const loyaltyAction = isCancelled(status) || isCancelled(paymentStatus)
    ? await reverseOrderLoyalty(client, order)
    : allowEarning
      ? await applyOrderLoyalty(client, order)
      : { applied: false, pointsEarned: 0 };

  const summary = await getCustomerLoyaltySummary(client, customerId, tenantId);
  const pointsEarned = Number(loyaltyAction.pointsEarned || 0);
  if (pointsEarned > 0) activities.push(`Earned ${pointsEarned} points`);
  const previousTier = "Bronze";
  const tier = summary.tier || "Bronze";
  const tierUpgraded = false;

  const cashbackAmount = calculateWalletCashback({ tier, orderTotal: total });
  const wallet = await applyWalletActivity(client, {
    tenantId,
    customerId,
    orderId,
    cashbackAmount,
    redemptionAmount: walletRedemptionAmount,
    userId,
  });

  if (wallet.cashbackAmount > 0) {
    activities.push(`Received ${wallet.cashbackAmount.toFixed(2)} cashback`);
  }

  return {
    earned: pointsEarned > 0,
    redeemed: requestedRedeem > 0,
    pointsEarned,
    pointsRedeemed,
    availablePoints: summary.points,
    lifetimePoints: summary.points,
    tier,
    previousTier,
    tierUpgraded,
    cashbackAmount: wallet.cashbackAmount,
    walletRedeemedAmount: wallet.redeemedAmount,
    walletBalance: wallet.balance,
    activities,
  };
};
