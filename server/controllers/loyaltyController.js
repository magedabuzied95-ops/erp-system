import db from "../database/db.js";
import { getTenantId, isSuperAdminUser } from "../utils/requestScope.js";
import { columnExists, getActiveLoyaltyRule, resolveLoyaltyTier, safeLoyaltyTablesReady, tableExists } from "../utils/loyalty.js";
import { adjustCustomerLoyaltyPoints, rebuildAllCustomerLoyalty, rebuildCustomerLoyalty } from "../services/loyaltyService.js";

const normalizeRule = (rule = {}) => ({
  id: rule.id,
  tenant_id: rule.tenant_id,
  name: rule.name,
  points_per_currency_amount: Number(rule.points_per_currency_amount || 0),
  minimum_order_amount: Number(rule.minimum_order_amount || 0),
  redeem_value: Number(rule.redeem_value || 0),
  bronze_threshold: Number(rule.bronze_threshold || 0),
  silver_threshold: Number(rule.silver_threshold || 0),
  gold_threshold: Number(rule.gold_threshold || 0),
  platinum_threshold: Number(rule.platinum_threshold || 0),
  is_active: Boolean(rule.is_active),
  created_at: rule.created_at,
  updated_at: rule.updated_at,
});

const normalizeCustomerRow = (row = {}) => ({
  id: row.id,
  customer_id: row.customer_id || row.id,
  name: row.name,
  phone: row.phone,
  email: row.email,
  status: row.status,
  tier: row.tier || "Bronze",
  total_points_earned: Number(row.total_points_earned || 0),
  total_points_redeemed: Number(row.total_points_redeemed || 0),
  available_points: Number(row.available_points || row.loyalty_points || 0),
  lifetime_spent: Number(row.lifetime_spent || 0),
  last_order_at: row.last_order_at || null,
});

const buildDefaultLoyaltyProfile = (customer = {}) => {
  const availablePoints = Number(
    customer.loyalty_points ??
      customer.available_points ??
      customer.points_balance ??
      customer.current_points ??
      customer.points ??
      0
  );

  return {
    tier: "Bronze",
    total_points_earned: 0,
    total_points_redeemed: 0,
    available_points: availablePoints,
    points_balance: availablePoints,
    lifetime_points: 0,
    lifetime_spent: 0,
    wallet_balance: Number(customer.wallet_balance ?? customer.balance ?? 0),
    last_order_at: null,
  };
};

const normalizeLoyaltyProfile = (row = {}, fallback = {}, rule = null) => {
  const availablePoints = Number(
    row.available_points ??
      row.points_balance ??
      row.current_points ??
      row.points ??
      fallback.available_points ??
      fallback.points_balance ??
      0
  );
  const lifetimePoints = Number(row.lifetime_points ?? row.total_points_earned ?? fallback.lifetime_points ?? 0);
  const totalEarned = Number(row.total_points_earned ?? lifetimePoints ?? fallback.total_points_earned ?? 0);
  const totalRedeemed = Number(row.total_points_redeemed ?? row.redeemed_points ?? fallback.total_points_redeemed ?? 0);
  const tier = row.tier || row.tier_name || row.loyalty_tier || resolveLoyaltyTier(totalEarned, rule || {});

  return {
    ...fallback,
    ...row,
    tier: tier || "Bronze",
    total_points_earned: totalEarned,
    total_points_redeemed: totalRedeemed,
    available_points: availablePoints,
    points_balance: availablePoints,
    lifetime_points: lifetimePoints,
    lifetime_spent: Number(row.lifetime_spent ?? fallback.lifetime_spent ?? 0),
    wallet_balance: Number(row.wallet_balance ?? fallback.wallet_balance ?? 0),
    last_order_at: row.last_order_at || fallback.last_order_at || null,
  };
};

export const getLoyaltyRules = async (req, res) => {
  let client;

  try {
    client = await db.connect();
    const tenantId = isSuperAdminUser(req.user) ? null : getTenantId(req, req.user?.tenant_id);

    if (!(await tableExists(client, "loyalty_rules"))) {
      return res.status(200).json({ success: true, rules: [] });
    }

    const result = await client.query(
      `
      SELECT *
      FROM loyalty_rules
      ${tenantId === null ? "" : "WHERE tenant_id = $1"}
      ORDER BY is_active DESC, updated_at DESC, id DESC
      `,
      tenantId === null ? [] : [tenantId]
    );

    return res.status(200).json({ success: true, rules: result.rows.map(normalizeRule) });
  } catch (error) {
    console.log("Get loyalty rules error:", error);
    return res.status(200).json({ success: true, rules: [] });
  } finally {
    client?.release();
  }
};

export const createLoyaltyRule = async (req, res) => {
  let client;

  try {
    client = await db.connect();
    const tenantId = isSuperAdminUser(req.user) ? null : getTenantId(req, req.user?.tenant_id);

    if (!(await tableExists(client, "loyalty_rules"))) {
      return res.status(200).json({ success: false, message: "Loyalty rules table unavailable" });
    }

    if (tenantId === null) {
      return res.status(400).json({ success: false, message: "Tenant context required" });
    }

    const {
      name,
      points_per_currency_amount,
      minimum_order_amount,
      redeem_value,
      bronze_threshold,
      silver_threshold,
      gold_threshold,
      platinum_threshold,
      is_active,
    } = req.body || {};

    const result = await client.query(
      `
      INSERT INTO loyalty_rules (
        tenant_id,
        name,
        points_per_currency_amount,
        minimum_order_amount,
        redeem_value,
        bronze_threshold,
        silver_threshold,
        gold_threshold,
        platinum_threshold,
        is_active,
        created_by
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      RETURNING *
      `,
      [
        tenantId,
        name || "Default Loyalty Rule",
        points_per_currency_amount ?? 1,
        minimum_order_amount ?? 0,
        redeem_value ?? 1,
        bronze_threshold ?? 0,
        silver_threshold ?? 500,
        gold_threshold ?? 1500,
        platinum_threshold ?? 3000,
        is_active ?? true,
        req.user?.id || null,
      ]
    );

    return res.status(201).json({ success: true, rule: normalizeRule(result.rows[0]) });
  } catch (error) {
    console.log("Create loyalty rule error:", error);
    return res.status(500).json({ success: false, message: "Server Error" });
  } finally {
    client?.release();
  }
};

export const updateLoyaltyRule = async (req, res) => {
  let client;

  try {
    client = await db.connect();
    const tenantId = isSuperAdminUser(req.user) ? null : getTenantId(req, req.user?.tenant_id);
    const { id } = req.params;
    const payload = req.body || {};

    if (!(await tableExists(client, "loyalty_rules"))) {
      return res.status(200).json({ success: false, message: "Loyalty rules table unavailable" });
    }

    if (tenantId === null) {
      return res.status(400).json({ success: false, message: "Tenant context required" });
    }

    const existing = await client.query(
      `
      SELECT *
      FROM loyalty_rules
      WHERE id = $1
        AND tenant_id = $2
      LIMIT 1
      `,
      [id, tenantId]
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Rule not found" });
    }

    const rule = existing.rows[0];
    const updated = await client.query(
      `
      UPDATE loyalty_rules
      SET
        name = COALESCE($1, name),
        points_per_currency_amount = COALESCE($2, points_per_currency_amount),
        minimum_order_amount = COALESCE($3, minimum_order_amount),
        redeem_value = COALESCE($4, redeem_value),
        bronze_threshold = COALESCE($5, bronze_threshold),
        silver_threshold = COALESCE($6, silver_threshold),
        gold_threshold = COALESCE($7, gold_threshold),
        platinum_threshold = COALESCE($8, platinum_threshold),
        is_active = COALESCE($9, is_active),
        updated_at = NOW()
      WHERE id = $10
        AND tenant_id = $11
      RETURNING *
      `,
      [
        payload.name ?? rule.name,
        payload.points_per_currency_amount ?? rule.points_per_currency_amount,
        payload.minimum_order_amount ?? rule.minimum_order_amount,
        payload.redeem_value ?? rule.redeem_value,
        payload.bronze_threshold ?? rule.bronze_threshold,
        payload.silver_threshold ?? rule.silver_threshold,
        payload.gold_threshold ?? rule.gold_threshold,
        payload.platinum_threshold ?? rule.platinum_threshold,
        payload.is_active ?? rule.is_active,
        id,
        tenantId,
      ]
    );

    return res.status(200).json({ success: true, rule: normalizeRule(updated.rows[0]) });
  } catch (error) {
    console.log("Update loyalty rule error:", error);
    return res.status(500).json({ success: false, message: "Server Error" });
  } finally {
    client?.release();
  }
};

export const getLoyaltyCustomers = async (req, res) => {
  let client;

  try {
    client = await db.connect();
    const tenantId = isSuperAdminUser(req.user) ? null : getTenantId(req, req.user?.tenant_id);
    const ready = await safeLoyaltyTablesReady(client);

    if (!(await tableExists(client, "customers"))) {
      return res.status(200).json({
        success: true,
        customers: [],
        summary: {
          totalCustomers: 0,
          totalPointsIssued: 0,
          totalPointsRedeemed: 0,
          topCustomers: [],
          tierDistribution: [],
          transactions: [],
        },
      });
    }

    const customersResult = ready.customer_loyalty
      ? await client.query(
          `
          SELECT
            c.id,
            c.name,
            c.phone,
            c.email,
            c.status,
            COALESCE(cl.tier, 'Bronze') AS tier,
            COALESCE(cl.total_points_earned, 0) AS total_points_earned,
            COALESCE(cl.total_points_redeemed, 0) AS total_points_redeemed,
            COALESCE(cl.available_points, c.loyalty_points, 0) AS available_points,
            COALESCE(cl.lifetime_spent, 0) AS lifetime_spent,
            cl.last_order_at
          FROM customers c
          LEFT JOIN customer_loyalty cl
            ON cl.customer_id = c.id
           AND cl.tenant_id = c.tenant_id
          ${tenantId === null ? "" : "WHERE c.tenant_id = $1"}
          ORDER BY COALESCE(cl.available_points, c.loyalty_points, 0) DESC, c.name ASC
          `,
          tenantId === null ? [] : [tenantId]
        )
      : await client.query(
          `
          SELECT
            c.id,
            c.name,
            c.phone,
            c.email,
            c.status,
            'Bronze' AS tier,
            0 AS total_points_earned,
            0 AS total_points_redeemed,
            COALESCE(c.loyalty_points, 0) AS available_points,
            0 AS lifetime_spent,
            NULL AS last_order_at
          FROM customers c
          ${tenantId === null ? "" : "WHERE c.tenant_id = $1"}
          ORDER BY c.name ASC
          `,
          tenantId === null ? [] : [tenantId]
        );

    const transactionsResult = ready.loyalty_transactions
      ? await client.query(
          `
          SELECT
            lt.*,
            c.name AS customer_name,
            c.phone,
            c.email
          FROM loyalty_transactions lt
          LEFT JOIN customers c ON c.id = lt.customer_id
          ${tenantId === null ? "" : "WHERE lt.tenant_id = $1"}
          ORDER BY lt.created_at DESC
          LIMIT 50
          `,
          tenantId === null ? [] : [tenantId]
        )
      : { rows: [] };

    const rows = customersResult.rows.map(normalizeCustomerRow);
    const totalCustomers = rows.length;
    const totalPointsIssued = rows.reduce((sum, row) => sum + Number(row.total_points_earned || 0), 0);
    const totalPointsRedeemed = rows.reduce((sum, row) => sum + Number(row.total_points_redeemed || 0), 0);

    const tierDistribution = rows.reduce((acc, row) => {
      const tier = row.tier || "Bronze";
      const found = acc.find((item) => item.tier === tier);
      if (found) {
        found.count += 1;
      } else {
        acc.push({ tier, count: 1 });
      }
      return acc;
    }, []);

    return res.status(200).json({
      success: true,
      customers: rows,
      summary: {
        totalCustomers,
        totalPointsIssued,
        totalPointsRedeemed,
        topCustomers: rows.slice(0, 10),
        tierDistribution,
        transactions: transactionsResult.rows,
      },
    });
  } catch (error) {
    console.log("Get loyalty customers error:", error);
    return res.status(200).json({
      success: true,
      customers: [],
      summary: {
        totalCustomers: 0,
        totalPointsIssued: 0,
        totalPointsRedeemed: 0,
        topCustomers: [],
        tierDistribution: [],
        transactions: [],
      },
    });
  } finally {
    client?.release();
  }
};

export const getLoyaltyCustomer = async (req, res) => {
  let client;

  try {
    client = await db.connect();
    const tenantId = isSuperAdminUser(req.user) ? null : getTenantId(req, req.user?.tenant_id);
    const { customerId } = req.params;

    if (!(await tableExists(client, "customers"))) {
      return res.status(404).json({ success: false, message: "Customer not found" });
    }

    const customerResult = await client.query(
      `
      SELECT *
      FROM customers
      WHERE id = $1
        AND ($2::bigint IS NULL OR tenant_id = $2::bigint)
      LIMIT 1
      `,
      [customerId, tenantId]
    );

    if (customerResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Customer not found" });
    }

    const ready = await safeLoyaltyTablesReady(client);
    const rule = await getActiveLoyaltyRule(client, tenantId);
    const defaultLoyalty = buildDefaultLoyaltyProfile(customerResult.rows[0]);
    let loyalty = defaultLoyalty;

    if (ready.customer_loyalty) {
      const hasTenantId = await columnExists(client, "customer_loyalty", "tenant_id");
      const loyaltyResult = await client.query(
        `
        SELECT *
        FROM customer_loyalty
        WHERE customer_id = $1
          ${hasTenantId ? "AND ($2::bigint IS NULL OR tenant_id = $2::bigint)" : ""}
        LIMIT 1
        `,
        hasTenantId ? [customerId, tenantId] : [customerId]
      );

      if (loyaltyResult.rows.length > 0) {
        loyalty = normalizeLoyaltyProfile(loyaltyResult.rows[0], defaultLoyalty, rule);
      }
    }

    let transactions = { rows: [] };
    if (ready.loyalty_transactions) {
      const hasTenantId = await columnExists(client, "loyalty_transactions", "tenant_id");
      transactions = await client.query(
        `
        SELECT *
        FROM loyalty_transactions
        WHERE customer_id = $1
          ${hasTenantId ? "AND ($2::bigint IS NULL OR tenant_id = $2::bigint)" : ""}
        ORDER BY created_at DESC
        LIMIT 50
        `,
        hasTenantId ? [customerId, tenantId] : [customerId]
      );
    }

    if (await tableExists(client, "customer_wallets")) {
      const hasTenantId = await columnExists(client, "customer_wallets", "tenant_id");
      const walletResult = await client.query(
        `
        SELECT *
        FROM customer_wallets
        WHERE customer_id = $1
          ${hasTenantId ? "AND ($2::bigint IS NULL OR tenant_id = $2::bigint)" : ""}
        LIMIT 1
        `,
        hasTenantId ? [customerId, tenantId] : [customerId]
      );

      loyalty.wallet_balance = Number(walletResult.rows[0]?.balance ?? loyalty.wallet_balance ?? 0);
    }

    const lastActivity = transactions.rows[0] || null;
    const maxRedeemableByTotal = Number(rule?.redeem_value || 0)
      ? Math.floor(Number(loyalty.available_points || 0) / Number(rule.redeem_value || 1))
      : Number(loyalty.available_points || 0);
    const normalizedLoyalty = normalizeLoyaltyProfile(loyalty, defaultLoyalty, rule);

    return res.status(200).json({
      success: true,
      customer: customerResult.rows[0],
      loyalty: {
        ...normalizedLoyalty,
        redeem_value: Number(rule?.redeem_value || 0),
        points_per_currency_amount: Number(rule?.points_per_currency_amount || 0),
        last_activity: lastActivity,
        max_redeemable_points: maxRedeemableByTotal,
        transactions: transactions.rows,
      },
      transactions: transactions.rows,
    });
  } catch (error) {
    console.error("[loyalty] get customer failed", error);
    return res.status(200).json({
      success: true,
      customer: null,
      loyalty: {
        tier: "Bronze",
        total_points_earned: 0,
        total_points_redeemed: 0,
        available_points: 0,
        points_balance: 0,
        lifetime_points: 0,
        lifetime_spent: 0,
        wallet_balance: 0,
        redeem_value: 0,
        points_per_currency_amount: 0,
        max_redeemable_points: 0,
        last_activity: null,
        transactions: [],
      },
      transactions: [],
    });
  } finally {
    client?.release();
  }
};

export const validateLoyaltyRedemption = async (req, res) => {
  let client;

  try {
    client = await db.connect();
    const tenantId = isSuperAdminUser(req.user) ? null : getTenantId(req, req.user?.tenant_id);
    const { customerId, points = 0, orderTotal = 0 } = req.body || {};
    const requestedPoints = Math.max(0, Number(points));
    const targetOrderTotal = Math.max(0, Number(orderTotal));

    if (!customerId) {
      return res.status(400).json({ success: false, message: "Customer is required" });
    }

    const customerResult = await client.query(
      `
      SELECT *
      FROM customers
      WHERE id = $1
        AND ($2::bigint IS NULL OR tenant_id = $2::bigint)
      LIMIT 1
      `,
      [customerId, tenantId]
    );

    if (customerResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Customer not found" });
    }

    const rule = await getActiveLoyaltyRule(client, tenantId);
    const availablePoints = Number(customerResult.rows[0].loyalty_points || 0);
    const redeemValue = Number(rule?.redeem_value || 0);
    const maxByTotal = redeemValue > 0 ? Math.floor(targetOrderTotal / redeemValue) : availablePoints;
    const maxRedeemablePoints = Math.max(0, Math.min(availablePoints, maxByTotal));
    const redeemableAmount = redeemValue > 0 ? maxRedeemablePoints * redeemValue : 0;
    const appliedPoints = Math.min(requestedPoints, maxRedeemablePoints);
    const appliedAmount = appliedPoints * redeemValue;

    const transactions = await client.query(
      `
      SELECT *
      FROM loyalty_transactions
      WHERE tenant_id = $1
        AND customer_id = $2
      ORDER BY created_at DESC
      LIMIT 1
      `,
      [tenantId, customerId]
    );

    return res.status(200).json({
      success: true,
      valid: requestedPoints <= maxRedeemablePoints,
      customerId,
      tier: resolveLoyaltyTier(Number(customerResult.rows[0].loyalty_points || 0), rule || {}),
      available_points: availablePoints,
      points_per_currency_amount: Number(rule?.points_per_currency_amount || 0),
      redeem_value: redeemValue,
      max_redeemable_points: maxRedeemablePoints,
      redeemable_amount: redeemableAmount,
      applied_points: appliedPoints,
      applied_amount: appliedAmount,
      last_activity: transactions.rows[0] || null,
    });
  } catch (error) {
    console.log("Validate loyalty redemption error:", error);
    return res.status(200).json({
      success: false,
      valid: false,
      available_points: 0,
      points_per_currency_amount: 0,
      redeem_value: 0,
      max_redeemable_points: 0,
      redeemable_amount: 0,
      applied_points: 0,
      applied_amount: 0,
      last_activity: null,
    });
  } finally {
    client?.release();
  }
};

export const redeemLoyaltyPoints = async (req, res) => {
  let client;

  try {
    client = await db.connect();
    await client.query("BEGIN");

    const tenantId = isSuperAdminUser(req.user) ? null : getTenantId(req, req.user?.tenant_id);
    const { customerId, points, description } = req.body || {};
    const redeemPoints = Number(points);

    if (!customerId || !Number.isFinite(redeemPoints) || redeemPoints <= 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ success: false, message: "Customer and valid points are required" });
    }

    if (tenantId === null) {
      await client.query("ROLLBACK");
      return res.status(400).json({ success: false, message: "Tenant context required" });
    }

    const ready = await safeLoyaltyTablesReady(client);
    if (!ready.customer_loyalty || !ready.loyalty_transactions) {
      await client.query("ROLLBACK");
      return res.status(200).json({ success: false, message: "Loyalty tables unavailable" });
    }

    const customerResult = await client.query(
      `
      SELECT *
      FROM customers
      WHERE id = $1
        AND tenant_id = $2
      LIMIT 1
      FOR UPDATE
      `,
      [customerId, tenantId]
    );

    if (customerResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, message: "Customer not found" });
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

    const profile = profileResult.rows[0] || {
      total_points_earned: 0,
      total_points_redeemed: 0,
      available_points: Number(customerResult.rows[0].loyalty_points || 0),
      lifetime_spent: 0,
    };

    const currentAvailable = Number(profile.available_points || 0);
    if (currentAvailable < redeemPoints) {
      await client.query("ROLLBACK");
      return res.status(400).json({ success: false, message: "Insufficient loyalty points" });
    }

    const rule = await getActiveLoyaltyRule(client, tenantId);
    const redeemValue = Number(rule?.redeem_value || 1);
    const amountValue = redeemPoints * redeemValue;
    const updatedAvailable = currentAvailable - redeemPoints;
    const updatedRedeemed = Number(profile.total_points_redeemed || 0) + redeemPoints;
    const tier = resolveLoyaltyTier(Number(profile.total_points_earned || 0), rule || {});

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
      [
        tenantId,
        customerId,
        tier,
        Number(profile.total_points_earned || 0),
        updatedRedeemed,
        updatedAvailable,
        Number(profile.lifetime_spent || 0),
      ]
    );

    if (await columnExists(client, "customers", "loyalty_points")) {
      await client.query(
        `
        UPDATE customers
        SET loyalty_points = GREATEST(COALESCE(loyalty_points, 0) - $1, 0),
            updated_at = NOW()
        WHERE id = $2
          AND tenant_id = $3
        `,
        [redeemPoints, customerId, tenantId]
      );
    }

    const txResult = await client.query(
      `
      INSERT INTO loyalty_transactions (
        tenant_id,
        customer_id,
        transaction_type,
        points,
        amount_value,
        description,
        created_by
      )
      VALUES ($1,$2,'redeem',$3,$4,$5,$6)
      RETURNING *
      `,
      [
        tenantId,
        customerId,
        -redeemPoints,
        amountValue,
        description || `Redeemed ${redeemPoints} loyalty points`,
        req.user?.id || null,
      ]
    );

    await client.query("COMMIT");

    return res.status(201).json({
      success: true,
      transaction: txResult.rows[0],
      loyalty: {
        available_points: updatedAvailable,
        total_points_redeemed: updatedRedeemed,
        total_points_earned: Number(profile.total_points_earned || 0),
        tier,
      },
    });
  } catch (error) {
    if (client) {
      await client.query("ROLLBACK").catch(() => {});
    }
    console.log("Redeem loyalty points error:", error);
    return res.status(500).json({ success: false, message: "Server Error" });
  } finally {
    client?.release();
  }
};

export const rebuildLoyalty = async (req, res) => {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const tenantId = isSuperAdminUser(req.user) ? null : getTenantId(req, req.user?.tenant_id);
    const customerId = req.body?.customerId || req.body?.customer_id || req.params?.customerId || null;
    const result = customerId
      ? await rebuildCustomerLoyalty(client, customerId, tenantId)
      : await rebuildAllCustomerLoyalty(client, tenantId);
    await client.query("COMMIT");
    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[loyalty] rebuild failed", error);
    return res.status(500).json({ success: false, message: "Failed to rebuild loyalty" });
  } finally {
    client.release();
  }
};

export const manualLoyaltyAdjustment = async (req, res) => {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const tenantId = isSuperAdminUser(req.user) ? null : getTenantId(req, req.user?.tenant_id);
    const result = await adjustCustomerLoyaltyPoints(client, {
      tenantId,
      customerId: req.body?.customerId || req.body?.customer_id,
      pointsChange: req.body?.pointsChange ?? req.body?.points_change,
      reason: req.body?.reason || "manual_adjustment",
      source: "admin",
    });
    await client.query("COMMIT");
    return res.status(200).json({ success: true, loyalty: result });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    return res.status(error.status || 500).json({ success: false, message: error.message || "Failed to adjust loyalty" });
  } finally {
    client.release();
  }
};
