-- Employee credit sales settle into employee advances (سلف الموظفين).
--
-- A customer row can now be linked to an employee. When such a customer takes a
-- deferred invoice (آجل), the invoice is settled immediately against that
-- employee's advances instead of sitting as customer debt: the order is stored as
-- paid with payment_method = 'employee_advance', and an employee_advances row
-- (plus its backing expenses row) carries the amount to payroll.
--
-- Additive only: no existing table, column, index, or data is removed or
-- rewritten. Existing invoices are untouched -- the rule applies to new deferred
-- invoices only. The same columns are ensured at runtime by
-- ensureEmployeeAdvanceSalesSchema(), so this file is the record, not the gate.

-- 1. The missing link: customer -> employee.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS linked_employee_id BIGINT NULL;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS linked_employee_linked_at TIMESTAMP NULL;
CREATE INDEX IF NOT EXISTS idx_customers_linked_employee
  ON customers (tenant_id, linked_employee_id)
  WHERE linked_employee_id IS NOT NULL;

-- 2. The marker on the invoice ("تم إضافتها لسلف الموظف").
ALTER TABLE orders ADD COLUMN IF NOT EXISTS settled_via_employee_advance BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS employee_advance_id BIGINT NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS employee_advance_employee_id BIGINT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_employee_advance
  ON orders (tenant_id, employee_advance_employee_id)
  WHERE settled_via_employee_advance = TRUE;

-- 3. The back-reference, so a price edit finds the one advance to re-sync.
ALTER TABLE employee_advances ADD COLUMN IF NOT EXISTS order_id BIGINT NULL;
ALTER TABLE employee_advances ADD COLUMN IF NOT EXISTS source VARCHAR(40) NOT NULL DEFAULT 'manual';
CREATE UNIQUE INDEX IF NOT EXISTS idx_employee_advances_order
  ON employee_advances (order_id)
  WHERE order_id IS NOT NULL;

-- 4. The backing expense also points at the invoice it came from.
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS order_id BIGINT NULL;
CREATE INDEX IF NOT EXISTS idx_expenses_order ON expenses (order_id) WHERE order_id IS NOT NULL;
