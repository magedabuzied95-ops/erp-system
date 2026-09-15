-- Old orders the courier already delivered but that still sit in pending_confirmation /
-- edit_requested (delivery used to write only shipping_status). Same rule the Bosta webhook,
-- the Bosta refresh and the manual shipment action apply from commit 05ac8fb on.

-- 1) Look first
SELECT id, public_order_number, status, shipping_status, shipment_status, created_at
FROM orders
WHERE LOWER(COALESCE(status, '')) IN ('pending_confirmation', 'edit_requested')
  AND 'delivered' IN (LOWER(COALESCE(shipping_status, '')), LOWER(COALESCE(shipment_status, '')))
ORDER BY created_at;

-- 2) Fix
BEGIN;
UPDATE orders
SET status = 'delivered',
    updated_at = NOW()
WHERE LOWER(COALESCE(status, '')) IN ('pending_confirmation', 'edit_requested')
  AND 'delivered' IN (LOWER(COALESCE(shipping_status, '')), LOWER(COALESCE(shipment_status, '')));
COMMIT;
