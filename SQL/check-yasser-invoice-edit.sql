-- Read-only. Answers: what was changed on ياسر's invoice, and did the shift take the difference?
-- Run:  Get-Content SQL/check-yasser-invoice-edit.sql | ssh -i ~/.ssh/codex_erp_ed25519 root@13.140.141.50 "docker exec -i erp-postgres psql -U erp_user -d erp_production"

\echo '=== 1) the invoice(s) ==='
SELECT o.id,
       o.invoice_number,
       o.customer_name,
       o.created_at,
       o.shift_id                AS sale_shift,
       o.total_amount,
       o.paid_amount,
       o.remaining_amount,
       o.cash_amount,
       o.payment_method,
       o.payment_status,
       o.edit_original_paid_amount,
       o.edit_additional_paid_amount,
       o.edit_refund_or_credit_due
FROM orders o
WHERE o.customer_name ILIKE '%ياسر%'
   OR o.customer_name ILIKE '%yasser%'
   OR o.customer_name ILIKE '%yaser%'
ORDER BY o.created_at DESC
LIMIT 10;

\echo '=== 2) what the edit changed (basket before/after + totals) ==='
SELECT a.id            AS audit_id,
       a.order_id,
       a.created_at,
       COALESCE(u.name, u.email, '?')                                   AS edited_by,
       a.old_total,
       a.new_total,
       (a.new_total - a.old_total)                                      AS difference,
       a.reason,
       jsonb_pretty(a.old_items)                                        AS old_items,
       jsonb_pretty(a.new_items)                                        AS new_items
FROM order_edit_audits a
LEFT JOIN users u ON u.id = a.user_id
WHERE a.order_id IN (
        SELECT id FROM orders
        WHERE customer_name ILIKE '%ياسر%' OR customer_name ILIKE '%yasser%' OR customer_name ILIKE '%yaser%'
      )
ORDER BY a.created_at DESC
LIMIT 10;

\echo '=== 3) THE ANSWER: did the drawer take the difference, and in which shift? ==='
SELECT ev.id,
       ev.created_at,
       ev.event_type,          -- cash_in = came in, refund_cash = went out
       ev.amount,
       ev.source_type,         -- order_edit / return
       ev.source_id,           -- audit id / return id
       ev.shift_id,
       s.status                AS shift_status,
       s.opened_at             AS shift_opened_at,
       s.closed_at             AS shift_closed_at,
       s.expected_cash,
       s.actual_cash,
       COALESCE(su.name, su.email, '?') AS shift_cashier
FROM cash_drawer_shift_events ev
LEFT JOIN cash_drawer_shifts s ON s.id = ev.shift_id
LEFT JOIN users su ON su.id = s.opened_by
WHERE (ev.source_type = 'order_edit' AND ev.source_id IN (
         SELECT a.id FROM order_edit_audits a
         WHERE a.order_id IN (SELECT id FROM orders
                              WHERE customer_name ILIKE '%ياسر%' OR customer_name ILIKE '%yasser%' OR customer_name ILIKE '%yaser%')))
   OR (ev.source_type = 'return' AND ev.source_id IN (
         SELECT r.id FROM returns r
         WHERE r.order_id IN (SELECT id FROM orders
                              WHERE customer_name ILIKE '%ياسر%' OR customer_name ILIKE '%yasser%' OR customer_name ILIKE '%yaser%')))
ORDER BY ev.created_at DESC
LIMIT 20;

\echo '=== 4) any return / exchange row on the same invoice ==='
SELECT r.id, r.return_number, r.created_at, r.reason, r.refund_amount, r.refund_method,
       r.exchange_difference, r.shift_id, r.metadata
FROM returns r
WHERE r.order_id IN (SELECT id FROM orders
                     WHERE customer_name ILIKE '%ياسر%' OR customer_name ILIKE '%yasser%' OR customer_name ILIKE '%yaser%')
ORDER BY r.created_at DESC
LIMIT 10;

\echo '=== 5) the settlement block the edit stored on the invoice ==='
SELECT o.id, o.invoice_number, jsonb_pretty(o.edit_payment_difference) AS settlement
FROM orders o
WHERE (o.customer_name ILIKE '%ياسر%' OR o.customer_name ILIKE '%yasser%' OR o.customer_name ILIKE '%yaser%')
  AND o.edit_payment_difference IS NOT NULL
ORDER BY o.updated_at DESC
LIMIT 5;
