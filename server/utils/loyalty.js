const tableExists = async (client, tableName) => {
  const result = await client.query(`SELECT to_regclass($1) AS regclass`, [`public.${tableName}`]);
  return Boolean(result.rows[0]?.regclass);
};

const columnExists = async (client, tableName, columnName) => {
  const result = await client.query(
    `
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = $1
      AND column_name = $2
    LIMIT 1
    `,
    [tableName, columnName]
  );
  return result.rows.length > 0;
};

const DEFAULT_TIER_RULES = {
  bronze: 0,
  silver: 500,
  gold: 1500,
  platinum: 3000,
};

export const resolveLoyaltyTier = (points = 0, rule = {}) => {
  const thresholds = {
    bronze: Number(rule.bronze_threshold ?? DEFAULT_TIER_RULES.bronze),
    silver: Number(rule.silver_threshold ?? DEFAULT_TIER_RULES.silver),
    gold: Number(rule.gold_threshold ?? DEFAULT_TIER_RULES.gold),
    platinum: Number(rule.platinum_threshold ?? DEFAULT_TIER_RULES.platinum),
  };

  const total = Number(points) || 0;

  if (total >= thresholds.platinum) return "Platinum";
  if (total >= thresholds.gold) return "Gold";
  if (total >= thresholds.silver) return "Silver";
  return "Bronze";
};

export const getActiveLoyaltyRule = async (client, tenantId) => {
  if (!(await tableExists(client, "loyalty_rules"))) {
    return null;
  }

  const result = await client.query(
    `
    SELECT *
    FROM loyalty_rules
    WHERE ($1::bigint IS NULL OR tenant_id = $1::bigint)
      AND is_active = TRUE
    ORDER BY updated_at DESC, id DESC
    LIMIT 1
    `,
    [tenantId]
  );

  return result.rows[0] || null;
};

export const finalizeOrderLoyalty = async (client, {
  tenantId,
  orderId,
  customerId,
  orderTotal,
  paidAmount,
  paymentStatus,
  redeemPoints = 0,
  userId = null,
}) => {
  try {
    if (!customerId) {
      return { awarded: false, reason: "missing_customer" };
    }

    if (!(await tableExists(client, "customer_loyalty")) || !(await tableExists(client, "loyalty_transactions"))) {
      return { awarded: false, reason: "loyalty_tables_missing" };
    }

    const rule = await getActiveLoyaltyRule(client, tenantId);
    const threshold = Number(rule?.minimum_order_amount ?? 0);
    const pointsPerAmount = Number(rule?.points_per_currency_amount ?? 0);
    const redeemValue = Number(rule?.redeem_value ?? 0);
    const total = Number(orderTotal) || 0;
    const paid = Number(paidAmount) || 0;
    const paymentValue = String(paymentStatus || "").toLowerCase();
    const fullyPaid = paid >= total && total > 0;
    const isCompleted = ["paid", "completed", "complete", "done", "settled"].includes(paymentValue);
    const pointsBase = paid > 0 ? paid : total;
    const requestedRedeem = Math.max(0, Number(redeemPoints || 0));

    if (!rule) {
      return { awarded: false, reason: "rule_missing" };
    }

    const profileResult = await client.query(
      `
      SELECT *
      FROM customer_loyalty
      WHERE tenant_id = $1
        AND customer_id = $2
      FOR UPDATE
      `,
      [tenantId, customerId]
    );

    const current = profileResult.rows[0] || {
      total_points_earned: 0,
      total_points_redeemed: 0,
      available_points: 0,
      lifetime_spent: 0,
      tier: "Bronze",
    };

    let availablePoints = Number(current.available_points || 0);
    let totalEarned = Number(current.total_points_earned || 0);
    let totalRedeemed = Number(current.total_points_redeemed || 0);
    let lifetimeSpent = Number(current.lifetime_spent || 0);
    const actions = [];

    if (requestedRedeem > 0) {
      if (!redeemValue) {
        return { awarded: false, reason: "redeem_rule_missing" };
      }

      const maxRedeemableByTotal = Math.floor(total / redeemValue);
      const maxRedeemable = Math.min(availablePoints, maxRedeemableByTotal);

      if (!fullyPaid && !isCompleted) {
        return { awarded: false, reason: "not_eligible" };
      }

      if (requestedRedeem > maxRedeemable) {
        return { awarded: false, reason: "over_redemption", maxRedeemable };
      }

      const redeemAmount = requestedRedeem * redeemValue;
      availablePoints = Math.max(0, availablePoints - requestedRedeem);
      totalRedeemed += requestedRedeem;
      actions.push({
        type: "redeem",
        points: requestedRedeem,
        amount_value: redeemAmount,
        description: `Redeemed ${requestedRedeem} loyalty points on order #${orderId || "N/A"}`,
      });
    }

    const eligibleForEarn = pointsPerAmount > 0 && pointsBase >= threshold && (fullyPaid || isCompleted);
    let pointsEarned = 0;
    if (eligibleForEarn) {
      pointsEarned = Math.floor(pointsBase * pointsPerAmount);
      if (pointsEarned > 0) {
        totalEarned += pointsEarned;
        availablePoints += pointsEarned;
        lifetimeSpent += pointsBase;
        actions.push({
          type: "earn",
          points: pointsEarned,
          amount_value: pointsBase,
          description: `Earned points from order #${orderId || "N/A"}`,
        });
      }
    }

    const tier = resolveLoyaltyTier(totalEarned, rule);

    await client.query(
      `
      INSERT INTO customer_loyalty (
        tenant_id,
        customer_id,
        tier,
        total_points_earned,
        total_points_redeemed,
        available_points,
        lifetime_spent,
        last_order_at,
        updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),NOW())
      ON CONFLICT (tenant_id, customer_id)
      DO UPDATE SET
        tier = EXCLUDED.tier,
        total_points_earned = EXCLUDED.total_points_earned,
        total_points_redeemed = EXCLUDED.total_points_redeemed,
        available_points = EXCLUDED.available_points,
        lifetime_spent = EXCLUDED.lifetime_spent,
        last_order_at = EXCLUDED.last_order_at,
        updated_at = NOW()
      `,
      [tenantId, customerId, tier, totalEarned, totalRedeemed, availablePoints, lifetimeSpent]
    );

    if (await columnExists(client, "customers", "loyalty_points")) {
      await client.query(
        `
        UPDATE customers
        SET loyalty_points = GREATEST(COALESCE(loyalty_points, 0) - $1 + $2, 0),
            updated_at = NOW()
        WHERE id = $3
          AND ($4::bigint IS NULL OR tenant_id = $4::bigint)
        `,
        [requestedRedeem, pointsEarned, customerId, tenantId]
      );
    }

    for (const action of actions) {
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
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        `,
        [
          tenantId,
          customerId,
          orderId || null,
          action.type,
          action.type === "redeem" ? -Math.abs(action.points) : Math.abs(action.points),
          action.amount_value,
          action.description,
          userId,
        ]
      );
    }

    return {
      awarded: pointsEarned > 0,
      redeemed: requestedRedeem > 0,
      pointsEarned,
      pointsRedeemed: requestedRedeem,
      redeemAmount: requestedRedeem * redeemValue,
      availablePoints,
      totalEarned,
      totalRedeemed,
      tier,
    };
  } catch (error) {
    console.log("Loyalty award error:", error);
    return { awarded: false, reason: "error" };
  }
};

export const safeLoyaltyTablesReady = async (client) => ({
  rules: await tableExists(client, "loyalty_rules"),
  customer_loyalty: await tableExists(client, "customer_loyalty"),
  loyalty_transactions: await tableExists(client, "loyalty_transactions"),
});

export { tableExists, columnExists };
