CREATE TABLE inventory (
    id SERIAL PRIMARY KEY,
    variant_id INTEGER UNIQUE NOT NULL,
    quantity INTEGER DEFAULT 0,
    reserved_qty INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS inventory_movements (
    id BIGSERIAL PRIMARY KEY,
    tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    product_id BIGINT NULL REFERENCES products(id) ON DELETE SET NULL,
    variant_id BIGINT NULL REFERENCES product_variants(id) ON DELETE SET NULL,
    customer_id BIGINT NULL,
    warehouse_id BIGINT NULL REFERENCES warehouses(id) ON DELETE SET NULL,
    branch_id BIGINT NULL REFERENCES branches(id) ON DELETE SET NULL,
    movement_type VARCHAR(50) NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 0,
    quantity_before INTEGER NOT NULL DEFAULT 0,
    quantity_delta INTEGER NOT NULL DEFAULT 0,
    quantity_change INTEGER NOT NULL DEFAULT 0,
    quantity_after INTEGER NOT NULL DEFAULT 0,
    before_qty INTEGER NOT NULL DEFAULT 0,
    after_qty INTEGER NOT NULL DEFAULT 0,
    unit_cost NUMERIC(12,2) NULL,
    total_cost NUMERIC(12,2) NULL,
    reference_type VARCHAR(100),
    reference_id BIGINT,
    reason TEXT,
    notes TEXT,
    note TEXT,
    undone_at TIMESTAMP NULL,
    undone_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_inventory_movements_product_id ON inventory_movements (product_id);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_variant_id ON inventory_movements (variant_id);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_movement_type ON inventory_movements (movement_type);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_created_at ON inventory_movements (created_at);
