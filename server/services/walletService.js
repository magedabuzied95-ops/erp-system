export const WALLET_CASHBACK_RATES = {
  Bronze: 0,
  Silver: 0.02,
  Gold: 0.03,
  Platinum: 0.05,
};

export const ensureWalletSchema = async (client) => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS customer_wallets (
      id BIGSERIAL PRIMARY KEY,
      tenant_id BIGINT,
      customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      balance NUMERIC(12,2) NOT NULL DEFAULT 0,
      total_cashback_earned NUMERIC(12,2) NOT NULL DEFAULT 0,
      total_redeemed NUMERIC(12,2) NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (tenant_id, customer_id)
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS wallet_transactions (
      id BIGSERIAL PRIMARY KEY,
      tenant_id BIGINT,
      customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      order_id BIGINT NULL REFERENCES orders(id) ON DELETE SET NULL,
      transaction_type VARCHAR(50) NOT NULL,
      amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      before_balance NUMERIC(12,2) NOT NULL DEFAULT 0,
      after_balance NUMERIC(12,2) NOT NULL DEFAULT 0,
      balance_after NUMERIC(12,2) NOT NULL DEFAULT 0,
      reference_type VARCHAR(50),
      reference_id BIGINT,
      notes TEXT,
      description TEXT,
      created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await client.query(`ALTER TABLE IF EXISTS wallet_transactions ADD COLUMN IF NOT EXISTS before_balance NUMERIC(12,2) NOT NULL DEFAULT 0`);
  await client.query(`ALTER TABLE IF EXISTS wallet_transactions ADD COLUMN IF NOT EXISTS after_balance NUMERIC(12,2) NOT NULL DEFAULT 0`);
  await client.query(`ALTER TABLE IF EXISTS wallet_transactions ADD COLUMN IF NOT EXISTS reference_type VARCHAR(50)`);
  await client.query(`ALTER TABLE IF EXISTS wallet_transactions ADD COLUMN IF NOT EXISTS reference_id BIGINT`);
  await client.query(`ALTER TABLE IF EXISTS wallet_transactions ADD COLUMN IF NOT EXISTS notes TEXT`);
  await client.query(`
    UPDATE wallet_transactions
    SET after_balance = COALESCE(NULLIF(after_balance, 0), balance_after),
        before_balance = COALESCE(NULLIF(before_balance, 0), balance_after - amount)
    WHERE after_balance = 0 OR before_balance = 0
  `);

  await client.query(`CREATE INDEX IF NOT EXISTS idx_customer_wallets_customer ON customer_wallets (tenant_id, customer_id)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_wallet_transactions_customer ON wallet_transactions (tenant_id, customer_id, created_at DESC)`);
};

const columnExists = async (client, tableName, columnName) => {
  const result = await client.query(
    `
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = $1
      AND column_name = $2
    LIMIT 1
    `,
    [tableName, columnName]
  );
  return result.rows.length > 0;
};

export const calculateWalletCashback = ({ tier = "Bronze", orderTotal = 0 }) => {
  const rate = Number(WALLET_CASHBACK_RATES[tier] || 0);
  return Number((Math.max(0, Number(orderTotal || 0)) * rate).toFixed(2));
};

const normalizeWalletType = (type = "") => {
  const value = String(type || "").trim().toLowerCase();
  if (value === "cashback") return "loyalty_conversion";
  if (value === "redemption") return "order_payment";
  return value || "manual_add";
};

export const getWalletBalance = async (client, { tenantId, customerId } = {}) => {
  await ensureWalletSchema(client);
  if (!customerId) return 0;
  const result = await client.query(
    `
    SELECT balance
    FROM customer_wallets
    WHERE customer_id = $1
      AND ($2::bigint IS NULL OR tenant_id = $2::bigint)
    `,
    [customerId, tenantId]
  );
  return Number(result.rows[0]?.balance || 0);
};

export const recordWalletTransaction = async (client, {
  tenantId,
  customerId,
  type,
  amount,
  orderId = null,
  referenceType = null,
  referenceId = null,
  notes = "",
  userId = null,
}) => {
  await ensureWalletSchema(client);
  if (!customerId) {
    return { amount: 0, beforeBalance: 0, afterBalance: 0 };
  }

  const normalizedAmount = Number(Number(amount || 0).toFixed(2));
  if (normalizedAmount === 0) {
    return { amount: 0, beforeBalance: await getWalletBalance(client, { tenantId, customerId }), afterBalance: await getWalletBalance(client, { tenantId, customerId }) };
  }

  const walletResult = await client.query(
    `
    INSERT INTO customer_wallets (tenant_id, customer_id, balance, updated_at)
    VALUES ($1,$2,0,NOW())
    ON CONFLICT (tenant_id, customer_id)
    DO UPDATE SET updated_at = customer_wallets.updated_at
    RETURNING *
    `,
    [tenantId, customerId]
  );

  const lockResult = await client.query(
    `
    SELECT *
    FROM customer_wallets
    WHERE id = $1
    FOR UPDATE
    `,
    [walletResult.rows[0].id]
  );

  const beforeBalance = Number(lockResult.rows[0]?.balance || 0);
  const afterBalance = Number((beforeBalance + normalizedAmount).toFixed(2));
  if (afterBalance < 0) {
    const error = new Error("رصيد المحفظة غير كاف");
    error.status = 400;
    throw error;
  }

  await client.query(
    `
    UPDATE customer_wallets
    SET balance = $1,
        total_redeemed = total_redeemed + $2,
        total_cashback_earned = total_cashback_earned + $3,
        updated_at = NOW()
    WHERE id = $4
    `,
    [
      afterBalance,
      normalizedAmount < 0 ? Math.abs(normalizedAmount) : 0,
      normalizeWalletType(type) === "loyalty_conversion" && normalizedAmount > 0 ? normalizedAmount : 0,
      lockResult.rows[0].id,
    ]
  );

  await client.query(
    `
    INSERT INTO wallet_transactions (
      tenant_id,
      customer_id,
      order_id,
      transaction_type,
      amount,
      before_balance,
      after_balance,
      balance_after,
      reference_type,
      reference_id,
      notes,
      description,
      created_by
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$7,$8,$9,$10,$10,$11)
    `,
    [
      tenantId,
      customerId,
      orderId || null,
      normalizeWalletType(type),
      normalizedAmount,
      beforeBalance,
      afterBalance,
      referenceType,
      referenceId,
      notes,
      userId,
    ]
  );

  if (await columnExists(client, "customers", "wallet_balance")) {
    await client.query(
      `
      UPDATE customers
      SET wallet_balance = $1,
          updated_at = NOW()
      WHERE id = $2
        AND ($3::bigint IS NULL OR tenant_id = $3::bigint)
      `,
      [afterBalance, customerId, tenantId]
    );
  }

  return { amount: normalizedAmount, beforeBalance, afterBalance, balance: afterBalance };
};

export const applyWalletActivity = async (client, {
  tenantId,
  customerId,
  orderId,
  cashbackAmount = 0,
  redemptionAmount = 0,
  userId = null,
}) => {
  await ensureWalletSchema(client);

  if (!customerId) {
    return { cashbackAmount: 0, redeemedAmount: 0, balance: 0 };
  }

  const requestedRedemption = Math.max(0, Number(redemptionAmount || 0));
  const currentBalance = await getWalletBalance(client, { tenantId, customerId });
  if (requestedRedemption > currentBalance) {
    const error = new Error("رصيد المحفظة غير كاف");
    error.status = 400;
    throw error;
  }
  const redeemedAmount = requestedRedemption;
  const earnedCashback = Math.max(0, Number(cashbackAmount || 0));
  let balance = currentBalance;

  if (redeemedAmount > 0) {
    const wallet = await recordWalletTransaction(client, {
      tenantId,
      customerId,
      orderId,
      type: "order_payment",
      amount: -Math.abs(redeemedAmount),
      referenceType: "order",
      referenceId: orderId || null,
      notes: `Wallet payment on order #${orderId}`,
      userId,
    });
    balance = wallet.balance;
  }

  if (earnedCashback > 0) {
    const wallet = await recordWalletTransaction(client, {
      tenantId,
      customerId,
      orderId,
      type: "loyalty_conversion",
      amount: earnedCashback,
      referenceType: "order",
      referenceId: orderId || null,
      notes: `Received ${earnedCashback.toFixed(2)} wallet cashback from order #${orderId}`,
      userId,
    });
    balance = wallet.balance;
  }

  return {
    cashbackAmount: earnedCashback,
    redeemedAmount,
    balance,
  };
};
