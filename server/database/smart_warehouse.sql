CREATE TABLE IF NOT EXISTS warehouse_sections (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NULL,
  branch_id BIGINT NULL,
  warehouse_id BIGINT NULL,
  code VARCHAR(120) NOT NULL,
  name VARCHAR(255) NOT NULL DEFAULT '',
  qr_code TEXT,
  barcode VARCHAR(160),
  color VARCHAR(40) DEFAULT '#2563eb',
  notes TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS inventory_counts (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NULL,
  branch_id BIGINT NULL,
  warehouse_id BIGINT NULL,
  section_id BIGINT NULL,
  count_type VARCHAR(50) NOT NULL DEFAULT 'quick_scan',
  status VARCHAR(50) NOT NULL DEFAULT 'draft',
  created_by BIGINT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP NULL
);

CREATE TABLE IF NOT EXISTS inventory_count_items (
  id BIGSERIAL PRIMARY KEY,
  inventory_count_id BIGINT NOT NULL,
  product_id BIGINT NULL,
  variant_id BIGINT NULL,
  expected_qty INTEGER NOT NULL DEFAULT 0,
  actual_qty INTEGER NOT NULL DEFAULT 0,
  difference_qty INTEGER NOT NULL DEFAULT 0,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS master_qr_models (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NULL,
  product_id BIGINT NOT NULL,
  qr_value TEXT NOT NULL,
  generated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS section_id BIGINT;
ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS before_qty INTEGER NOT NULL DEFAULT 0;
ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS after_qty INTEGER NOT NULL DEFAULT 0;
ALTER TABLE warehouse_inventory ADD COLUMN IF NOT EXISTS branch_id BIGINT;
ALTER TABLE warehouse_inventory ADD COLUMN IF NOT EXISTS section_id BIGINT;
ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE UNIQUE INDEX IF NOT EXISTS idx_warehouse_sections_scope_code
  ON warehouse_sections (COALESCE(tenant_id, 0), COALESCE(warehouse_id, 0), code);
CREATE INDEX IF NOT EXISTS idx_warehouse_sections_branch_id ON warehouse_sections (branch_id);
CREATE INDEX IF NOT EXISTS idx_warehouse_sections_warehouse_id ON warehouse_sections (warehouse_id);
CREATE INDEX IF NOT EXISTS idx_warehouse_sections_barcode ON warehouse_sections (barcode);
CREATE INDEX IF NOT EXISTS idx_inventory_counts_section_id ON inventory_counts (section_id);
CREATE INDEX IF NOT EXISTS idx_inventory_counts_status ON inventory_counts (status);
CREATE INDEX IF NOT EXISTS idx_inventory_count_items_count_id ON inventory_count_items (inventory_count_id);
CREATE INDEX IF NOT EXISTS idx_inventory_count_items_variant_id ON inventory_count_items (variant_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_master_qr_models_product_id ON master_qr_models (product_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_master_qr_models_qr_value ON master_qr_models (qr_value);
CREATE INDEX IF NOT EXISTS idx_products_sku_perf ON products (sku);
CREATE INDEX IF NOT EXISTS idx_products_barcode_perf ON products (barcode);
CREATE INDEX IF NOT EXISTS idx_product_variants_product_id_perf ON product_variants (product_id);
CREATE INDEX IF NOT EXISTS idx_product_variants_sku_perf ON product_variants (sku);
CREATE INDEX IF NOT EXISTS idx_product_variants_barcode_perf ON product_variants (barcode);
CREATE INDEX IF NOT EXISTS idx_warehouse_inventory_branch_id ON warehouse_inventory (branch_id);
CREATE INDEX IF NOT EXISTS idx_warehouse_inventory_section_id ON warehouse_inventory (section_id);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_section_id ON inventory_movements (section_id);
