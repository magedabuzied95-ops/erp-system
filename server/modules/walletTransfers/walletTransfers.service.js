import { randomBytes, timingSafeEqual } from "node:crypto";
import db from "../../database/db.js";
import { createNotification } from "../../services/notificationsService.js";
import { getSetting, setSetting } from "../../services/settingsService.js";
import { canonicalPhoneKey } from "../../utils/phoneSearch.js";
import { applyTransferPaymentConfirmation } from "./transferPaymentConfirmation.js";
import { decideTransferMatch } from "./transferMatchDecision.js";
import { isTrustedTransferSender, parseTransferSms } from "./transferSms.js";

// Every money SMS the owner's phone forwards (Vodafone Cash, CIB, United Bank) becomes one
// row here, whatever it says. An incoming transfer is matched to a website order waiting on its transfer proof:
// the order is approved on its own only when exactly one waiting order has that amount AND
// was placed by the phone or the name that sent the money (or quotes the transaction number). Anything
// less certain waits in the review list with the orders it could belong to.

export const WALLET_SMS_SECRET_KEY = "payments.wallet_sms_webhook_secret";
// A customer usually transfers first and checks out after, but both orders happen.
const MATCH_WINDOW_BEFORE = "3 days";
const MATCH_WINDOW_AFTER = "2 days";
// Customers pick "InstaPay" and pay the wallet, or the other way round; the SMS says where
// the money landed, not which button they pressed, so both kinds of order are candidates.
const TRANSFER_PAYMENT_METHODS = ["vodafone_cash", "instapay"];
export const PROVIDER_LABELS = { vodafone_cash: "فودافون كاش", cib: "إنستاباي CIB", united_bank: "المصرف المتحد" };
const PLACEHOLDER_WALLETS = new Set(["", "1000000000"]);

const text = (value = "") => String(value ?? "").trim();

let schemaPromise = null;

// New table, no foreign key: a key onto orders would lock the hottest table at boot.
export const ensureWalletTransfersSchema = (client = db) => {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS wallet_transfers (
          id BIGSERIAL PRIMARY KEY,
          tenant_id BIGINT,
          provider TEXT NOT NULL DEFAULT 'vodafone_cash',
          direction TEXT NOT NULL,
          status TEXT NOT NULL,
          amount NUMERIC(12,2),
          fee NUMERIC(12,2),
          counterparty_phone TEXT,
          counterparty_name TEXT,
          wallet_number TEXT,
          balance_after NUMERIC(14,2),
          reference TEXT,
          occurred_at TIMESTAMPTZ,
          sms_sender TEXT,
          raw_text TEXT NOT NULL,
          order_id BIGINT,
          match_method TEXT,
          review_reason TEXT,
          candidate_order_ids BIGINT[] NOT NULL DEFAULT '{}',
          matched_at TIMESTAMPTZ,
          matched_by BIGINT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      // NULL references (unreadable messages) never collide, so a plain unique index is enough.
      await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS wallet_transfers_provider_reference_uidx ON wallet_transfers (provider, reference)`);
      await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS wallet_transfers_matched_order_uidx ON wallet_transfers (order_id) WHERE status = 'matched'`);
      await client.query(`CREATE INDEX IF NOT EXISTS wallet_transfers_tenant_status_idx ON wallet_transfers (tenant_id, status, occurred_at DESC)`);
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
};

/* ------------------------------------------------------------------ secret */

export const getWalletSmsSecret = async () => text(await getSetting(WALLET_SMS_SECRET_KEY, ""));

export const rotateWalletSmsSecret = async (userId = null) => {
  const secret = randomBytes(24).toString("hex");
  await setSetting(WALLET_SMS_SECRET_KEY, secret, "payments", userId);
  return secret;
};

export const walletSmsSecretMatches = async (candidate = "") => {
  const secret = await getWalletSmsSecret();
  const given = text(candidate);
  if (!secret || !given) return { configured: Boolean(secret), ok: false };
  const left = Buffer.from(secret);
  const right = Buffer.from(given);
  return { configured: true, ok: left.length === right.length && timingSafeEqual(left, right) };
};

/* ---------------------------------------------------------------- matching */

const knownWalletKeys = async () => {
  const values = await Promise.all([
    getSetting("storefront.payment_methods.vodafone_cash_number", ""),
    getSetting("payments.vodafone_cash_number", ""),
  ]);
  return new Set(values.map((value) => canonicalPhoneKey(value)).filter((key) => !PLACEHOLDER_WALLETS.has(key)));
};

const findCandidateOrders = async (client, transfer) => {
  const result = await client.query(
    `
    SELECT id, tenant_id, invoice_number, customer_name, customer_phone, shipping_payment_reference,
           COALESCE(NULLIF(total_amount, 0), NULLIF(total, 0), total_price, 0) AS order_total, created_at
    FROM orders
    WHERE ($1::bigint IS NULL OR tenant_id = $1::bigint OR tenant_id IS NULL)
      AND LOWER(COALESCE(payment_method, '')) = ANY($4::text[])
      AND transfer_proof_status = 'pending'
      AND LOWER(COALESCE(status, '')) NOT IN ('cancelled', 'canceled', 'payment_rejected', 'returned')
      AND created_at >= $2::timestamptz - INTERVAL '${MATCH_WINDOW_BEFORE}'
      AND created_at <= $2::timestamptz + INTERVAL '${MATCH_WINDOW_AFTER}'
      -- A shipping-fee advance order (restricted closing system) waits on the fee, not the total.
      AND ABS(
        COALESCE(NULLIF(total_amount, 0), NULLIF(total, 0), total_price, 0)
        - CASE WHEN COALESCE(cod_amount, 0) < COALESCE(NULLIF(total_amount, 0), NULLIF(total, 0), total_price, 0)
               THEN COALESCE(cod_amount, 0) ELSE 0 END
        - $3::numeric
      ) < 0.01
      AND NOT EXISTS (SELECT 1 FROM wallet_transfers wt WHERE wt.order_id = orders.id AND wt.status = 'matched')
    ORDER BY created_at DESC
    LIMIT 20
    `,
    [transfer.tenant_id ?? null, transfer.occurred_at || transfer.created_at || new Date(), transfer.amount, TRANSFER_PAYMENT_METHODS]
  );
  return result.rows;
};

const confirmOrderForTransfer = async (client, { transfer, orderId, matchMethod, userId = null }) => {
  const locked = await client.query(`SELECT * FROM orders WHERE id = $1 FOR UPDATE`, [orderId]);
  const order = locked.rows[0];
  if (!order) return null;
  // The automatic path only ever approves an order still waiting; a person may override that.
  if (matchMethod !== "manual" && text(order.transfer_proof_status).toLowerCase() !== "pending") return null;
  let confirmation = null;
  if (text(order.transfer_proof_status).toLowerCase() !== "approved") {
    confirmation = await applyTransferPaymentConfirmation(client, {
      order,
      tenantId: null,
      loyaltyTenantId: transfer.tenant_id ?? null,
      userId,
      logTag: "wallet-transfers.confirm",
    });
  }
  const updated = await client.query(
    `
    UPDATE wallet_transfers
    SET status = 'matched', order_id = $2, match_method = $3, review_reason = NULL,
        matched_at = NOW(), matched_by = $4, updated_at = NOW()
    WHERE id = $1
    RETURNING *
    `,
    [transfer.id, order.id, confirmation ? matchMethod : `${matchMethod}_already_approved`, userId]
  );
  return { transfer: updated.rows[0], order: confirmation?.order || order, confirmed: Boolean(confirmation?.order) };
};

// Runs inside the caller's transaction with the transfer row already locked.
const matchTransferRow = async (client, transfer) => {
  const candidates = await findCandidateOrders(client, transfer);
  // Only the wallet has a number to check against settings; a bank SMS names a masked account.
  const wallets = transfer.provider === "vodafone_cash" ? await knownWalletKeys() : new Set();
  const walletKnown = !wallets.size || wallets.has(canonicalPhoneKey(transfer.wallet_number));
  const decision = decideTransferMatch({
    transfer,
    candidates,
    trustedSender: isTrustedTransferSender(transfer.provider, transfer.sms_sender),
    walletKnown,
  });
  if (decision.action === "confirm") {
    const result = await confirmOrderForTransfer(client, { transfer, orderId: decision.order.id, matchMethod: decision.matchMethod });
    if (result) return { outcome: "matched", ...result };
  }
  const status = decision.action === "unmatched" ? "unmatched" : "needs_review";
  const updated = await client.query(
    `UPDATE wallet_transfers SET status = $2, review_reason = $3, candidate_order_ids = $4::bigint[], updated_at = NOW() WHERE id = $1 RETURNING *`,
    [transfer.id, status, decision.reviewReason || null, decision.candidateIds]
  );
  return { outcome: status, transfer: updated.rows[0], order: null, confirmed: false };
};

const notifyOutcome = (result) => {
  const transfer = result?.transfer;
  // Money with no order at all is not news: the bank already texted the owner, and a business
  // account takes plenty of deposits that were never website orders. The page still lists it.
  if (!transfer || !["matched", "needs_review"].includes(result.outcome)) return;
  const amount = `${Number(transfer.amount || 0).toLocaleString("en-US")} ج.م`;
  const who = transfer.counterparty_name || transfer.counterparty_phone || "";
  const source = PROVIDER_LABELS[transfer.provider] || "تحويل";
  const from = who ? ` من ${who}` : "";
  const notification = result.outcome === "matched"
    ? {
        priority: "medium",
        title: `تم تأكيد تحويل ${source} تلقائياً`,
        message: `${amount}${from} — طلب ${result.order?.invoice_number || `#${transfer.order_id}`}`,
        action_url: `/orders/${transfer.order_id}`,
        action_label: "فتح الطلب",
      }
    : {
        priority: "high",
        title: `تحويل ${source} محتاج مراجعة`,
        message: `${amount}${from}`,
        action_url: "/orders/wallet-transfers",
        action_label: "مراجعة التحويلات",
      };
  createNotification({
    tenant_id: transfer.tenant_id,
    role_key: "manager",
    type: `wallet_transfer_${result.outcome}`,
    category: "payments",
    entity_type: "wallet_transfer",
    entity_id: String(transfer.id),
    metadata: { transfer_id: transfer.id, order_id: transfer.order_id || null },
    ...notification,
  }).catch((error) => console.warn("[wallet-transfers] notification skipped", { id: transfer.id, message: error?.message || String(error) }));
};

/* ------------------------------------------------------------------ ingest */

export const ingestTransferSms = async ({ tenantId = null, rawText = "", sender = "" } = {}) => {
  await ensureWalletTransfersSchema();
  const raw = text(rawText).slice(0, 4000);
  if (!raw) return { outcome: "empty" };
  const parsed = parseTransferSms(raw);
  const direction = parsed.kind === "incoming" ? "incoming" : parsed.kind === "outgoing" ? "outgoing" : "unknown";
  const status = !parsed.complete ? "unparsed" : direction === "incoming" ? "unmatched" : "outgoing";

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const inserted = await client.query(
      `
      INSERT INTO wallet_transfers (
        tenant_id, provider, direction, status, amount, fee, counterparty_phone, counterparty_name,
        wallet_number, balance_after, reference, occurred_at, sms_sender, raw_text
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
              COALESCE($12::timestamp AT TIME ZONE 'Africa/Cairo', NOW()), $13, $14)
      ON CONFLICT (provider, reference) DO NOTHING
      RETURNING *
      `,
      [
        tenantId, parsed.provider, direction, status, parsed.amount, parsed.fee, parsed.counterpartyPhone || null,
        parsed.counterpartyName || null, parsed.walletNumber || null, parsed.balanceAfter,
        parsed.reference || null, parsed.occurredLocal || null, text(sender).slice(0, 200) || null, raw,
      ]
    );
    const row = inserted.rows[0];
    if (!row) {
      await client.query("COMMIT");
      return { outcome: "duplicate", reference: parsed.reference };
    }
    if (status !== "unmatched") {
      await client.query("COMMIT");
      if (status === "unparsed") console.warn("[wallet-transfers] SMS not understood", { id: row.id, sender: row.sms_sender });
      return { outcome: status, transfer: row };
    }
    const result = await matchTransferRow(client, row);
    await client.query("COMMIT");
    notifyOutcome(result);
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
};

// A website order placed AFTER the money arrived: look again at the transfers still
// waiting. Called after checkout commits; never lets a failure reach the customer.
export const rematchWalletTransfersForOrder = async ({ tenantId = null, orderId = null } = {}) => {
  try {
    await ensureWalletTransfersSchema();
    const waiting = await db.query(
      `
      SELECT id FROM wallet_transfers
      WHERE status IN ('unmatched', 'needs_review') AND direction = 'incoming'
        AND ($1::bigint IS NULL OR tenant_id = $1::bigint OR tenant_id IS NULL)
        AND occurred_at >= NOW() - INTERVAL '${MATCH_WINDOW_BEFORE}'
      ORDER BY occurred_at ASC
      LIMIT 25
      `,
      [tenantId]
    );
    for (const { id } of waiting.rows) {
      const client = await db.connect();
      try {
        await client.query("BEGIN");
        const locked = await client.query(`SELECT * FROM wallet_transfers WHERE id = $1 AND status IN ('unmatched', 'needs_review') FOR UPDATE SKIP LOCKED`, [id]);
        if (!locked.rows[0]) {
          await client.query("COMMIT");
          continue;
        }
        const result = await matchTransferRow(client, locked.rows[0]);
        await client.query("COMMIT");
        if (result.outcome === "matched") notifyOutcome(result);
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    }
  } catch (error) {
    console.warn("[wallet-transfers] rematch after checkout skipped", { orderId, message: error?.message || String(error) });
  }
};

/* ------------------------------------------------------------------- staff */

export const listWalletTransfers = async ({ tenantId = null, status = "review", limit = 100 } = {}) => {
  await ensureWalletTransfersSchema();
  const filters = {
    review: ["needs_review", "unmatched", "unparsed"],
    matched: ["matched"],
    ignored: ["ignored"],
    outgoing: ["outgoing"],
  };
  const statuses = filters[status] || null;
  const rows = await db.query(
    `
    SELECT wt.*, o.invoice_number AS order_invoice_number, o.customer_name AS order_customer_name
    FROM wallet_transfers wt
    LEFT JOIN orders o ON o.id = wt.order_id
    WHERE ($1::bigint IS NULL OR wt.tenant_id = $1::bigint OR wt.tenant_id IS NULL)
      AND ($2::text[] IS NULL OR wt.status = ANY($2::text[]))
    ORDER BY COALESCE(wt.occurred_at, wt.created_at) DESC
    LIMIT $3
    `,
    [tenantId, statuses, Math.min(Math.max(Number(limit) || 100, 1), 500)]
  );
  const candidateIds = [...new Set(rows.rows.flatMap((row) => row.candidate_order_ids || []).map(Number))];
  const candidates = candidateIds.length
    ? (await db.query(
        `
        SELECT id, invoice_number, customer_name, customer_phone, transfer_proof_status, status, created_at,
               COALESCE(NULLIF(total_amount, 0), NULLIF(total, 0), total_price, 0) AS order_total
        FROM orders WHERE id = ANY($1::bigint[])
        `,
        [candidateIds]
      )).rows
    : [];
  const byId = new Map(candidates.map((order) => [Number(order.id), order]));
  const counts = await db.query(
    `SELECT status, COUNT(*)::int AS count FROM wallet_transfers WHERE ($1::bigint IS NULL OR tenant_id = $1::bigint OR tenant_id IS NULL) GROUP BY status`,
    [tenantId]
  );
  return {
    transfers: rows.rows.map((row) => ({
      ...row,
      // Only orders still waiting on their proof are worth offering.
      candidates: (row.candidate_order_ids || [])
        .map((id) => byId.get(Number(id)))
        .filter((order) => order && text(order.transfer_proof_status).toLowerCase() === "pending"),
    })),
    counts: Object.fromEntries(counts.rows.map((row) => [row.status, row.count])),
  };
};

const httpError = (status, message) => Object.assign(new Error(message), { status });

export const matchWalletTransferManually = async ({ tenantId = null, transferId, orderId = null, invoiceNumber = "", userId = null }) => {
  await ensureWalletTransfersSchema();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const locked = await client.query(
      `SELECT * FROM wallet_transfers WHERE id = $1 AND ($2::bigint IS NULL OR tenant_id = $2::bigint OR tenant_id IS NULL) FOR UPDATE`,
      [transferId, tenantId]
    );
    const transfer = locked.rows[0];
    if (!transfer) throw httpError(404, "التحويل غير موجود");
    if (transfer.direction !== "incoming") throw httpError(400, "ده مش تحويل وارد");
    if (transfer.status === "matched") throw httpError(409, "التحويل ده مربوط بطلب بالفعل");

    const found = await client.query(
      `
      SELECT id FROM orders
      WHERE ($1::bigint IS NULL OR tenant_id = $1::bigint OR tenant_id IS NULL)
        AND (($2::bigint IS NOT NULL AND id = $2::bigint) OR ($3 <> '' AND invoice_number = $3))
      LIMIT 1
      `,
      [tenantId, orderId ? Number(orderId) : null, text(invoiceNumber)]
    );
    if (!found.rows[0]) throw httpError(404, "الطلب غير موجود");
    const taken = await client.query(`SELECT id FROM wallet_transfers WHERE order_id = $1 AND status = 'matched' LIMIT 1`, [found.rows[0].id]);
    if (taken.rows[0]) throw httpError(409, "الطلب ده مربوط بتحويل تاني بالفعل");

    const result = await confirmOrderForTransfer(client, { transfer, orderId: found.rows[0].id, matchMethod: "manual", userId });
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
};

export const ignoreWalletTransfer = async ({ tenantId = null, transferId, userId = null }) => {
  await ensureWalletTransfersSchema();
  const result = await db.query(
    `
    UPDATE wallet_transfers
    SET status = 'ignored', matched_by = $3, updated_at = NOW()
    WHERE id = $1 AND status <> 'matched'
      AND ($2::bigint IS NULL OR tenant_id = $2::bigint OR tenant_id IS NULL)
    RETURNING *
    `,
    [transferId, tenantId, userId]
  );
  if (!result.rows[0]) throw httpError(404, "التحويل غير موجود أو مربوط بطلب");
  return result.rows[0];
};
