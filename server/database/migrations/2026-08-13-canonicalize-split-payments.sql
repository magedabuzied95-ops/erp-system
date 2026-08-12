BEGIN;

-- Split is a checkout input mode. Orders keep the single real method, or the
-- internal `mixed` marker when more than one real method was collected.
WITH allocation_methods AS (
  SELECT
    o.id,
    COUNT(DISTINCT CASE
      WHEN lower(COALESCE(p->>'method', p->>'payment_method', '')) = 'visa' THEN 'card'
      WHEN lower(COALESCE(p->>'method', p->>'payment_method', '')) = 'vodafone' THEN 'vodafone_cash'
      WHEN lower(COALESCE(p->>'method', p->>'payment_method', '')) = 'insta_pay' THEN 'instapay'
      ELSE lower(COALESCE(p->>'method', p->>'payment_method', ''))
    END) AS method_count,
    MIN(CASE
      WHEN lower(COALESCE(p->>'method', p->>'payment_method', '')) = 'visa' THEN 'card'
      WHEN lower(COALESCE(p->>'method', p->>'payment_method', '')) = 'vodafone' THEN 'vodafone_cash'
      WHEN lower(COALESCE(p->>'method', p->>'payment_method', '')) = 'insta_pay' THEN 'instapay'
      ELSE lower(COALESCE(p->>'method', p->>'payment_method', ''))
    END) AS sole_method
  FROM orders o
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(o.payment_breakdown) = 'array' THEN o.payment_breakdown ELSE '[]'::jsonb END
  ) p
  WHERE lower(COALESCE(o.payment_method, '')) IN ('split', 'multiple', 'mixed')
    AND COALESCE(NULLIF(p->>'amount', '')::numeric, 0) > 0
    AND lower(COALESCE(p->>'method', p->>'payment_method', '')) NOT IN ('credit_sale', 'exchange_credit', 'return_credit')
  GROUP BY o.id
)
UPDATE orders o
SET payment_method = CASE WHEN a.method_count = 1 THEN a.sole_method ELSE 'mixed' END
FROM allocation_methods a
WHERE o.id = a.id;

CREATE TEMP TABLE split_transaction_allocations (
  transaction_id bigint NOT NULL,
  payment_method varchar NOT NULL,
  amount numeric NOT NULL
) ON COMMIT DROP;

-- Recover allocations from the order's authoritative payment breakdown.
INSERT INTO split_transaction_allocations (transaction_id, payment_method, amount)
SELECT
  t.id,
  CASE
    WHEN lower(COALESCE(p->>'method', p->>'payment_method', '')) = 'visa' THEN 'card'
    WHEN lower(COALESCE(p->>'method', p->>'payment_method', '')) = 'vodafone' THEN 'vodafone_cash'
    WHEN lower(COALESCE(p->>'method', p->>'payment_method', '')) = 'insta_pay' THEN 'instapay'
    ELSE lower(COALESCE(p->>'method', p->>'payment_method', ''))
  END,
  SUM(COALESCE(NULLIF(p->>'amount', '')::numeric, 0))
FROM transactions t
JOIN orders o ON o.id = substring(t.note from '#([0-9]+)')::bigint
CROSS JOIN LATERAL jsonb_array_elements(
  CASE WHEN jsonb_typeof(o.payment_breakdown) = 'array' THEN o.payment_breakdown ELSE '[]'::jsonb END
) p
WHERE lower(COALESCE(t.payment_method, '')) = 'split'
  AND COALESCE(NULLIF(p->>'amount', '')::numeric, 0) > 0
  AND lower(COALESCE(p->>'method', p->>'payment_method', '')) NOT IN ('credit_sale', 'exchange_credit', 'return_credit', 'customer_wallet')
GROUP BY t.id, 2;

-- A deleted legacy order can still be reconstructed from its same-timestamp
-- money-account entries; cash is the remaining amount not present there.
INSERT INTO split_transaction_allocations (transaction_id, payment_method, amount)
SELECT t.id, lower(mt.payment_method), SUM(mt.amount)
FROM transactions t
JOIN money_transactions mt
  ON mt.reference_type = 'order'
 AND mt.reference_id = substring(t.note from '#([0-9]+)')::bigint
 AND mt.created_at = t.created_at
LEFT JOIN orders o ON o.id = mt.reference_id
WHERE lower(COALESCE(t.payment_method, '')) = 'split'
  AND o.id IS NULL
  AND lower(COALESCE(mt.payment_method, '')) NOT IN ('split', 'mixed')
GROUP BY t.id, lower(mt.payment_method);

INSERT INTO split_transaction_allocations (transaction_id, payment_method, amount)
SELECT t.id, 'cash', t.amount - COALESCE(SUM(a.amount), 0)
FROM transactions t
LEFT JOIN orders o ON o.id = substring(t.note from '#([0-9]+)')::bigint
LEFT JOIN split_transaction_allocations a ON a.transaction_id = t.id
WHERE lower(COALESCE(t.payment_method, '')) = 'split'
  AND o.id IS NULL
GROUP BY t.id, t.amount
HAVING t.amount - COALESCE(SUM(a.amount), 0) > 0;

-- Only replace a legacy row when the recovered allocations reconcile exactly.
INSERT INTO transactions (tenant_id, type, amount, payment_method, note, cashbox_id, created_at)
SELECT t.tenant_id, t.type, a.amount, a.payment_method, t.note, t.cashbox_id, t.created_at
FROM transactions t
JOIN split_transaction_allocations a ON a.transaction_id = t.id
JOIN (
  SELECT transaction_id, SUM(amount) AS allocated_amount
  FROM split_transaction_allocations
  GROUP BY transaction_id
) totals ON totals.transaction_id = t.id AND abs(totals.allocated_amount - t.amount) < 0.01
WHERE lower(COALESCE(t.payment_method, '')) = 'split';

DELETE FROM transactions t
USING (
  SELECT a.transaction_id
  FROM split_transaction_allocations a
  JOIN transactions original ON original.id = a.transaction_id
  GROUP BY a.transaction_id, original.amount
  HAVING abs(SUM(a.amount) - original.amount) < 0.01
) reconciled
WHERE t.id = reconciled.transaction_id
  AND lower(COALESCE(t.payment_method, '')) = 'split';

-- Any unrecoverable historical marker is internal only; never expose `split`
-- as a real tender type.
UPDATE transactions SET payment_method = 'mixed'
WHERE lower(COALESCE(payment_method, '')) = 'split';

COMMIT;
