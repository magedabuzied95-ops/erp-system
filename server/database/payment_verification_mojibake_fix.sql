BEGIN;

-- Repair only rows that already contain UTF-8 mojibake from Arabic payment labels.
-- Safe to run repeatedly: rows without mojibake are left untouched.

ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS order_notes TEXT;
ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS delivery_notes TEXT;
ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS courier_notes TEXT;
ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS shipping_payment_reference TEXT;

UPDATE orders
SET notes = convert_from(convert_to(notes, 'LATIN1'), 'UTF8')
WHERE notes IS NOT NULL
  AND (notes LIKE '%' || CHR(216) || '%' OR notes LIKE '%' || CHR(217) || '%');

UPDATE orders
SET order_notes = convert_from(convert_to(order_notes, 'LATIN1'), 'UTF8')
WHERE order_notes IS NOT NULL
  AND (order_notes LIKE '%' || CHR(216) || '%' OR order_notes LIKE '%' || CHR(217) || '%');

UPDATE orders
SET delivery_notes = convert_from(convert_to(delivery_notes, 'LATIN1'), 'UTF8')
WHERE delivery_notes IS NOT NULL
  AND (delivery_notes LIKE '%' || CHR(216) || '%' OR delivery_notes LIKE '%' || CHR(217) || '%');

UPDATE orders
SET courier_notes = convert_from(convert_to(courier_notes, 'LATIN1'), 'UTF8')
WHERE courier_notes IS NOT NULL
  AND (courier_notes LIKE '%' || CHR(216) || '%' OR courier_notes LIKE '%' || CHR(217) || '%');

UPDATE orders
SET shipping_payment_reference = convert_from(convert_to(shipping_payment_reference, 'LATIN1'), 'UTF8')
WHERE shipping_payment_reference IS NOT NULL
  AND (shipping_payment_reference LIKE '%' || CHR(216) || '%' OR shipping_payment_reference LIKE '%' || CHR(217) || '%');

COMMIT;
