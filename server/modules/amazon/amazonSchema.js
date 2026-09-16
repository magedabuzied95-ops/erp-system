// Amazon integration tables. New tables only - no existing table is altered or renamed.
// Awaited from bootstrapStartup (runtime schema ensures are off in production) and
// non-fatal there: a failure disables the Amazon module, never the ERP.
// No table stores credentials, access tokens or buyer personal data.

let ensured = null;
let ready = false;

export const isAmazonSchemaReady = () => ready;

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS amazon_connection_state (
    id BIGSERIAL PRIMARY KEY,
    tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    marketplace_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'unknown',
    marketplace_name TEXT NULL,
    country_code TEXT NULL,
    currency_code TEXT NULL,
    store_name TEXT NULL,
    seller_id TEXT NULL,
    is_participating BOOLEAN NULL,
    has_suspended_listings BOOLEAN NULL,
    last_checked_at TIMESTAMPTZ NULL,
    last_success_at TIMESTAMPTZ NULL,
    last_error_at TIMESTAMPTZ NULL,
    last_error_category TEXT NULL,
    last_error_code TEXT NULL,
    last_error_message TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, marketplace_id)
  )`,
  `CREATE TABLE IF NOT EXISTS amazon_sync_runs (
    id BIGSERIAL PRIMARY KEY,
    tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    marketplace_id TEXT NOT NULL,
    job_type TEXT NOT NULL,
    trigger TEXT NOT NULL DEFAULT 'manual',
    requested_by BIGINT NULL,
    status TEXT NOT NULL DEFAULT 'running',
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at TIMESTAMPTZ NULL,
    records_read INTEGER NOT NULL DEFAULT 0,
    records_created INTEGER NOT NULL DEFAULT 0,
    records_updated INTEGER NOT NULL DEFAULT 0,
    records_failed INTEGER NOT NULL DEFAULT 0,
    cursor_before TIMESTAMPTZ NULL,
    cursor_after TIMESTAMPTZ NULL,
    error_category TEXT NULL,
    error_message TEXT NULL,
    details JSONB NULL
  )`,
  `CREATE INDEX IF NOT EXISTS amazon_sync_runs_job_idx ON amazon_sync_runs (tenant_id, job_type, started_at DESC)`,
  `CREATE INDEX IF NOT EXISTS amazon_sync_runs_started_idx ON amazon_sync_runs (started_at DESC)`,
  `CREATE TABLE IF NOT EXISTS amazon_sync_cursors (
    tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    marketplace_id TEXT NOT NULL,
    job_type TEXT NOT NULL,
    checkpoint_at TIMESTAMPTZ NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id, marketplace_id, job_type)
  )`,
  `CREATE TABLE IF NOT EXISTS amazon_orders (
    id BIGSERIAL PRIMARY KEY,
    tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    marketplace_id TEXT NOT NULL,
    amazon_order_id TEXT NOT NULL,
    m1_order_id BIGINT NULL REFERENCES orders(id) ON DELETE SET NULL,
    created_time TIMESTAMPTZ NULL,
    last_updated_time TIMESTAMPTZ NULL,
    fulfillment_status TEXT NULL,
    fulfilled_by TEXT NULL,
    fulfillment_service_level TEXT NULL,
    sales_channel TEXT NULL,
    marketplace_name TEXT NULL,
    order_total NUMERIC(14,2) NULL,
    currency_code TEXT NULL,
    items_ordered INTEGER NOT NULL DEFAULT 0,
    items_shipped INTEGER NOT NULL DEFAULT 0,
    items_unshipped INTEGER NOT NULL DEFAULT 0,
    ship_by_latest TIMESTAMPTZ NULL,
    deliver_by_latest TIMESTAMPTZ NULL,
    has_cancellation_request BOOLEAN NOT NULL DEFAULT FALSE,
    projection_status TEXT NULL,
    projection_error TEXT NULL,
    projected_at TIMESTAMPTZ NULL,
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_sync_run_id BIGINT NULL,
    UNIQUE (tenant_id, amazon_order_id)
  )`,
  `CREATE INDEX IF NOT EXISTS amazon_orders_created_idx ON amazon_orders (tenant_id, created_time DESC)`,
  `CREATE INDEX IF NOT EXISTS amazon_orders_status_idx ON amazon_orders (tenant_id, fulfillment_status)`,
  `CREATE INDEX IF NOT EXISTS amazon_orders_m1_order_idx ON amazon_orders (m1_order_id) WHERE m1_order_id IS NOT NULL`,
  `CREATE TABLE IF NOT EXISTS amazon_order_items (
    id BIGSERIAL PRIMARY KEY,
    amazon_order_row_id BIGINT NOT NULL REFERENCES amazon_orders(id) ON DELETE CASCADE,
    tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    order_item_id TEXT NOT NULL,
    seller_sku TEXT NULL,
    asin TEXT NULL,
    title TEXT NULL,
    condition_type TEXT NULL,
    quantity_ordered INTEGER NOT NULL DEFAULT 0,
    quantity_fulfilled INTEGER NOT NULL DEFAULT 0,
    quantity_unfulfilled INTEGER NOT NULL DEFAULT 0,
    unit_price NUMERIC(14,2) NULL,
    item_total NUMERIC(14,2) NULL,
    currency_code TEXT NULL,
    cancellation_requested BOOLEAN NOT NULL DEFAULT FALSE,
    mapped_variant_id BIGINT NULL REFERENCES product_variants(id) ON DELETE SET NULL,
    mapped_product_id BIGINT NULL REFERENCES products(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (amazon_order_row_id, order_item_id)
  )`,
  `CREATE INDEX IF NOT EXISTS amazon_order_items_sku_idx ON amazon_order_items (tenant_id, lower(seller_sku))`,
  `CREATE TABLE IF NOT EXISTS amazon_sku_mappings (
    id BIGSERIAL PRIMARY KEY,
    tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    marketplace_id TEXT NOT NULL,
    seller_sku TEXT NOT NULL,
    asin TEXT NULL,
    amazon_title TEXT NULL,
    status TEXT NOT NULL DEFAULT 'unmapped',
    match_method TEXT NULL,
    product_id BIGINT NULL REFERENCES products(id) ON DELETE SET NULL,
    variant_id BIGINT NULL REFERENCES product_variants(id) ON DELETE SET NULL,
    suggested_variant_id BIGINT NULL REFERENCES product_variants(id) ON DELETE SET NULL,
    suggestion_method TEXT NULL,
    candidate_count INTEGER NOT NULL DEFAULT 0,
    mapped_by BIGINT NULL,
    mapped_at TIMESTAMPTZ NULL,
    notes TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS amazon_sku_mappings_sku_key ON amazon_sku_mappings (tenant_id, marketplace_id, lower(seller_sku))`,
  `CREATE UNIQUE INDEX IF NOT EXISTS amazon_sku_mappings_variant_key ON amazon_sku_mappings (tenant_id, marketplace_id, variant_id) WHERE status = 'mapped' AND variant_id IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS amazon_sku_mappings_status_idx ON amazon_sku_mappings (tenant_id, status)`,
  `CREATE TABLE IF NOT EXISTS amazon_listings (
    id BIGSERIAL PRIMARY KEY,
    tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    marketplace_id TEXT NOT NULL,
    seller_sku TEXT NOT NULL,
    asin TEXT NULL,
    title TEXT NULL,
    listing_status TEXT NULL,
    fulfillment_channel TEXT NULL,
    merchant_quantity INTEGER NULL,
    listing_price NUMERIC(14,2) NULL,
    currency_code TEXT NULL,
    opened_at TIMESTAMPTZ NULL,
    product_type TEXT NULL,
    issues JSONB NULL,
    issue_count INTEGER NOT NULL DEFAULT 0,
    error_count INTEGER NOT NULL DEFAULT 0,
    issues_synced_at TIMESTAMPTZ NULL,
    offer_price NUMERIC(14,2) NULL,
    offer_currency_code TEXT NULL,
    price_synced_at TIMESTAMPTZ NULL,
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    removed_at TIMESTAMPTZ NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS amazon_listings_sku_key ON amazon_listings (tenant_id, marketplace_id, lower(seller_sku))`,
  `CREATE TABLE IF NOT EXISTS amazon_fba_inventory (
    id BIGSERIAL PRIMARY KEY,
    tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    marketplace_id TEXT NOT NULL,
    seller_sku TEXT NOT NULL,
    asin TEXT NULL,
    fn_sku TEXT NULL,
    condition_type TEXT NULL,
    fulfillable_qty INTEGER NOT NULL DEFAULT 0,
    inbound_qty INTEGER NOT NULL DEFAULT 0,
    reserved_qty INTEGER NOT NULL DEFAULT 0,
    unfulfillable_qty INTEGER NOT NULL DEFAULT 0,
    total_qty INTEGER NOT NULL DEFAULT 0,
    amazon_updated_at TIMESTAMPTZ NULL,
    last_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS amazon_fba_inventory_sku_key ON amazon_fba_inventory (tenant_id, marketplace_id, lower(seller_sku))`,
];

export const AMAZON_SCHEMA_STATEMENTS = STATEMENTS;

export const ensureAmazonSchema = (db) => {
  if (!ensured) {
    ensured = (async () => {
      for (const statement of STATEMENTS) await db.query(statement);
      ready = true;
    })().catch((error) => {
      ensured = null;
      throw error;
    });
  }
  return ensured;
};
