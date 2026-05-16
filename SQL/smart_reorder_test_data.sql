-- Smart Reorder diagnostic sample data.
-- Safe to run multiple times. It updates/creates marked sample products and does not delete existing data.

ALTER TABLE IF EXISTS product_variants
  ADD COLUMN IF NOT EXISTS purchase_pack_type VARCHAR(20) NOT NULL DEFAULT 'unit',
  ADD COLUMN IF NOT EXISTS purchase_pack_qty INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS reorder_trigger_percent NUMERIC(6,2) NOT NULL DEFAULT 70,
  ADD COLUMN IF NOT EXISTS size_distribution_json JSONB NULL,
  ADD COLUMN IF NOT EXISTS supplier_id BIGINT NULL,
  ADD COLUMN IF NOT EXISTS last_purchase_cost NUMERIC(12,2) NULL;

ALTER TABLE IF EXISTS order_items
  ADD COLUMN IF NOT EXISTS returned_quantity INTEGER NOT NULL DEFAULT 0;

DO $$
DECLARE
  v_tenant_id BIGINT;
  v_product_id BIGINT;
  v_variant_id BIGINT;
  v_order_id BIGINT;
  v_invoice_number TEXT;
BEGIN
  SELECT id INTO v_tenant_id
  FROM tenants
  ORDER BY id
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    INSERT INTO tenants (name, slug, status)
    VALUES ('Smart Reorder Test Tenant', 'smart-reorder-test', 'active')
    RETURNING id INTO v_tenant_id;
  END IF;

  -- Pack 5, low stock: should become BUY_NOW or WATCH.
  SELECT id INTO v_product_id
  FROM products
  WHERE tenant_id = v_tenant_id AND sku = 'SR-TEST-PACK5-LOW'
  ORDER BY id
  LIMIT 1;

  IF v_product_id IS NULL THEN
    INSERT INTO products (tenant_id, name, sku, image_url, cost_price, price, stock, low_stock_alert, status)
    VALUES (v_tenant_id, 'Smart Reorder Test - Pack 5 Low Stock', 'SR-TEST-PACK5-LOW', '', 100, 150, 2, 5, 'active')
    RETURNING id INTO v_product_id;
  ELSE
    UPDATE products
    SET name = 'Smart Reorder Test - Pack 5 Low Stock',
        stock = 2,
        status = 'active',
        updated_at = CURRENT_TIMESTAMP
    WHERE id = v_product_id;
  END IF;

  SELECT id INTO v_variant_id
  FROM product_variants
  WHERE tenant_id = v_tenant_id AND sku = 'SR-TEST-PACK5-LOW-RED-42'
  ORDER BY id
  LIMIT 1;

  IF v_variant_id IS NULL THEN
    INSERT INTO product_variants (tenant_id, product_id, color, size, sku, stock, cost_price, price, purchase_pack_type, purchase_pack_qty, reorder_trigger_percent)
    VALUES (v_tenant_id, v_product_id, 'Red', '42', 'SR-TEST-PACK5-LOW-RED-42', 2, 100, 150, 'carton', 5, 40)
    RETURNING id INTO v_variant_id;
  ELSE
    UPDATE product_variants
    SET product_id = v_product_id,
        color = 'Red',
        size = '42',
        stock = 2,
        purchase_pack_type = 'carton',
        purchase_pack_qty = 5,
        reorder_trigger_percent = 40,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = v_variant_id;
  END IF;

  -- Pack 15, high sell-through: should become BUY_NOW.
  SELECT id INTO v_product_id
  FROM products
  WHERE tenant_id = v_tenant_id AND sku = 'SR-TEST-PACK15-FAST'
  ORDER BY id
  LIMIT 1;

  IF v_product_id IS NULL THEN
    INSERT INTO products (tenant_id, name, sku, image_url, cost_price, price, stock, low_stock_alert, status)
    VALUES (v_tenant_id, 'Smart Reorder Test - Pack 15 Fast', 'SR-TEST-PACK15-FAST', '', 120, 180, 1, 5, 'active')
    RETURNING id INTO v_product_id;
  ELSE
    UPDATE products
    SET name = 'Smart Reorder Test - Pack 15 Fast',
        stock = 1,
        status = 'active',
        updated_at = CURRENT_TIMESTAMP
    WHERE id = v_product_id;
  END IF;

  SELECT id INTO v_variant_id
  FROM product_variants
  WHERE tenant_id = v_tenant_id AND sku = 'SR-TEST-PACK15-FAST-BLUE-43'
  ORDER BY id
  LIMIT 1;

  IF v_variant_id IS NULL THEN
    INSERT INTO product_variants (tenant_id, product_id, color, size, sku, stock, cost_price, price, purchase_pack_type, purchase_pack_qty, reorder_trigger_percent)
    VALUES (v_tenant_id, v_product_id, 'Blue', '43', 'SR-TEST-PACK15-FAST-BLUE-43', 1, 120, 180, 'carton', 15, 70)
    RETURNING id INTO v_variant_id;
  ELSE
    UPDATE product_variants
    SET product_id = v_product_id,
        color = 'Blue',
        size = '43',
        stock = 1,
        purchase_pack_type = 'carton',
        purchase_pack_qty = 15,
        reorder_trigger_percent = 70,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = v_variant_id;
  END IF;

  v_invoice_number := 'SR-TEST-FAST-' || v_variant_id;

  SELECT id INTO v_order_id
  FROM orders
  WHERE tenant_id = v_tenant_id
    AND invoice_number = v_invoice_number
  LIMIT 1;

  IF v_order_id IS NULL THEN
    INSERT INTO orders (tenant_id, invoice_number, customer_name, channel, status, payment_status, subtotal, total_amount, total_price, total, paid_amount)
    VALUES (v_tenant_id, v_invoice_number, 'Smart Reorder Test', 'pos', 'completed', 'paid', 3600, 3600, 3600, 3600, 3600)
    RETURNING id INTO v_order_id;
  ELSE
    UPDATE orders
    SET status = 'completed',
        payment_status = 'paid',
        updated_at = CURRENT_TIMESTAMP
    WHERE id = v_order_id;
  END IF;

  IF EXISTS (SELECT 1 FROM order_items WHERE tenant_id = v_tenant_id AND order_id = v_order_id AND variant_id = v_variant_id) THEN
    UPDATE order_items
    SET quantity = 20,
        returned_quantity = 0,
        product_id = v_product_id,
        product_name = 'Smart Reorder Test - Pack 15 Fast',
        total_amount = 3600
    WHERE tenant_id = v_tenant_id AND order_id = v_order_id AND variant_id = v_variant_id;
  ELSE
    INSERT INTO order_items (tenant_id, order_id, product_id, variant_id, product_name, variant_name, quantity, sale_price, total_amount, returned_quantity)
    VALUES (v_tenant_id, v_order_id, v_product_id, v_variant_id, 'Smart Reorder Test - Pack 15 Fast', 'Blue / 43', 20, 180, 3600, 0);
  END IF;

  -- Pack 15, low sell-through and healthy stock: should become DO_NOT_BUY.
  SELECT id INTO v_product_id
  FROM products
  WHERE tenant_id = v_tenant_id AND sku = 'SR-TEST-PACK15-SLOW'
  ORDER BY id
  LIMIT 1;

  IF v_product_id IS NULL THEN
    INSERT INTO products (tenant_id, name, sku, image_url, cost_price, price, stock, low_stock_alert, status)
    VALUES (v_tenant_id, 'Smart Reorder Test - Pack 15 Slow', 'SR-TEST-PACK15-SLOW', '', 90, 140, 20, 5, 'active')
    RETURNING id INTO v_product_id;
  ELSE
    UPDATE products
    SET name = 'Smart Reorder Test - Pack 15 Slow',
        stock = 20,
        status = 'active',
        updated_at = CURRENT_TIMESTAMP
    WHERE id = v_product_id;
  END IF;

  SELECT id INTO v_variant_id
  FROM product_variants
  WHERE tenant_id = v_tenant_id AND sku = 'SR-TEST-PACK15-SLOW-GREEN-44'
  ORDER BY id
  LIMIT 1;

  IF v_variant_id IS NULL THEN
    INSERT INTO product_variants (tenant_id, product_id, color, size, sku, stock, cost_price, price, purchase_pack_type, purchase_pack_qty, reorder_trigger_percent)
    VALUES (v_tenant_id, v_product_id, 'Green', '44', 'SR-TEST-PACK15-SLOW-GREEN-44', 20, 90, 140, 'carton', 15, 70);
  ELSE
    UPDATE product_variants
    SET product_id = v_product_id,
        color = 'Green',
        size = '44',
        stock = 20,
        purchase_pack_type = 'carton',
        purchase_pack_qty = 15,
        reorder_trigger_percent = 70,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = v_variant_id;
  END IF;
END $$;
