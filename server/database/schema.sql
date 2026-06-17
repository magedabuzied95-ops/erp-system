CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS tenants (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(120) NOT NULL UNIQUE,
  company_name TEXT,
  company_logo_url TEXT,
  favicon_url TEXT,
  status VARCHAR(50) NOT NULL DEFAULT 'active',
  plan VARCHAR(50) NOT NULL DEFAULT 'trial',
  trial_ends_at TIMESTAMP NULL,
  expires_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS company_profiles (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
  company_name VARCHAR(255) NOT NULL,
  legal_name VARCHAR(255),
  logo_url TEXT,
  favicon_url TEXT,
  address TEXT,
  phone VARCHAR(50),
  email VARCHAR(255),
  tax_number VARCHAR(120),
  currency VARCHAR(10) NOT NULL DEFAULT 'USD',
  language VARCHAR(20) NOT NULL DEFAULT 'en',
  invoice_prefix VARCHAR(30) DEFAULT 'INV',
  invoice_footer TEXT,
  branch_mode BOOLEAN NOT NULL DEFAULT FALSE,
  pos_mode BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
  plan VARCHAR(50) NOT NULL DEFAULT 'trial',
  status VARCHAR(50) NOT NULL DEFAULT 'active',
  billing_provider VARCHAR(100) DEFAULT 'manual',
  billing_email VARCHAR(255),
  start_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  end_date TIMESTAMP NULL,
  trial_ends_at TIMESTAMP NULL,
  auto_renew BOOLEAN NOT NULL DEFAULT FALSE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS roles (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  slug VARCHAR(120),
  description TEXT,
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, name)
);

CREATE TABLE IF NOT EXISTS permissions (
  id BIGSERIAL PRIMARY KEY,
  module VARCHAR(100) NOT NULL,
  action VARCHAR(50) NOT NULL,
  description TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (module, action)
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id BIGINT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id BIGINT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT REFERENCES tenants(id) ON DELETE SET NULL,
  role_id BIGINT REFERENCES roles(id) ON DELETE SET NULL,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  phone VARCHAR(50),
  password VARCHAR(255) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  is_super_admin BOOLEAN NOT NULL DEFAULT FALSE,
  last_login_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, email)
);

CREATE TABLE IF NOT EXISTS categories (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  parent_id BIGINT NULL REFERENCES categories(id) ON DELETE SET NULL,
  name VARCHAR(255) NOT NULL,
  image_url TEXT,
  status VARCHAR(50) NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS brands (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(255) NOT NULL DEFAULT '',
  logo_url TEXT,
  image_url TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  status VARCHAR(50) NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS manufacturers (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL UNIQUE,
  contact_person VARCHAR(255),
  phone VARCHAR(50),
  email VARCHAR(255),
  address TEXT,
  country VARCHAR(100),
  notes TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS units (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  abbreviation VARCHAR(50),
  status VARCHAR(50) NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS products (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  category_id BIGINT NULL REFERENCES categories(id) ON DELETE SET NULL,
  brand_id BIGINT NULL REFERENCES brands(id) ON DELETE SET NULL,
  unit_id BIGINT NULL REFERENCES units(id) ON DELETE SET NULL,
  name VARCHAR(255) NOT NULL,
  sku VARCHAR(120),
  barcode VARCHAR(120),
  edition_name TEXT NULL,
  edition_slug TEXT NULL,
  slug TEXT DEFAULT '',
  canonical_slug TEXT DEFAULT '',
  qr_token TEXT,
  image_url TEXT,
  gallery_images JSONB NOT NULL DEFAULT '[]'::jsonb,
  variation_mode VARCHAR(30) NOT NULL DEFAULT 'full_variations',
  fixed_size_label VARCHAR(80) DEFAULT '',
  cost_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  selling_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  regular_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  price NUMERIC(12,2) NOT NULL DEFAULT 0,
  sale_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  sale_price_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  sale_reason VARCHAR(40) DEFAULT '',
  sale_start_at TIMESTAMP NULL,
  sale_end_at TIMESTAMP NULL,
  use_custom_compare_price BOOLEAN NOT NULL DEFAULT FALSE,
  custom_compare_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  wholesale_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  purchase_alerts_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  purchase_alert_by_color BOOLEAN NOT NULL DEFAULT FALSE,
  carton_size INTEGER NULL,
  suggested_purchase_cartons INTEGER NOT NULL DEFAULT 1,
  tax_rate NUMERIC(8,2) NOT NULL DEFAULT 0,
  description TEXT,
  gender VARCHAR(50) DEFAULT '',
  product_type VARCHAR(80) DEFAULT '',
  style VARCHAR(80) DEFAULT '',
  grade VARCHAR(80) DEFAULT '',
  stock INTEGER NOT NULL DEFAULT 0,
  low_stock_alert INTEGER NOT NULL DEFAULT 0,
  low_stock_tracking_mode VARCHAR(30) NOT NULL DEFAULT 'variant',
  product_low_stock_threshold INTEGER NOT NULL DEFAULT 0,
  minimum_distinct_sizes_required INTEGER NOT NULL DEFAULT 0,
  status VARCHAR(50) NOT NULL DEFAULT 'active',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_products_gender ON products (gender);
CREATE INDEX IF NOT EXISTS idx_products_product_type ON products (product_type);
CREATE INDEX IF NOT EXISTS idx_products_style ON products (style);
CREATE INDEX IF NOT EXISTS idx_products_grade ON products (grade);

CREATE TABLE IF NOT EXISTS product_classification_groups (
  id BIGSERIAL PRIMARY KEY,
  key VARCHAR(80) NOT NULL UNIQUE,
  name_ar VARCHAR(255) NOT NULL DEFAULT '',
  name_en VARCHAR(255) NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS product_classification_options (
  id BIGSERIAL PRIMARY KEY,
  group_id BIGINT NOT NULL REFERENCES product_classification_groups(id) ON DELETE CASCADE,
  value VARCHAR(120) NOT NULL,
  label_ar VARCHAR(255) NOT NULL DEFAULT '',
  label_en VARCHAR(255) NOT NULL DEFAULT '',
  icon VARCHAR(80) DEFAULT '',
  color VARCHAR(80) DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(group_id, value)
);

CREATE INDEX IF NOT EXISTS idx_product_classification_groups_sort ON product_classification_groups (sort_order, id);
CREATE INDEX IF NOT EXISTS idx_product_classification_options_group_sort ON product_classification_options (group_id, sort_order, id);

CREATE TABLE IF NOT EXISTS product_variants (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  manufacturer_id BIGINT NULL,
  color VARCHAR(100),
  size VARCHAR(100),
  sku VARCHAR(120),
  barcode VARCHAR(120),
  article_code TEXT,
  image_url TEXT,
  cost_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  selling_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  regular_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  price NUMERIC(12,2) NOT NULL DEFAULT 0,
  sale_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  stock INTEGER NOT NULL DEFAULT 0,
  default_purchase_qty INTEGER NOT NULL DEFAULT 0,
  low_stock_alert INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  deleted_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS product_variant_images (
  id BIGSERIAL PRIMARY KEY,
  product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  variant_id BIGINT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  color_name VARCHAR(255) NOT NULL DEFAULT '',
  color_value VARCHAR(255) NOT NULL DEFAULT '',
  image_url TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_product_variant_images_product_color ON product_variant_images (product_id, color_name, sort_order, id);
CREATE INDEX IF NOT EXISTS idx_product_variant_images_variant ON product_variant_images (variant_id, sort_order, id);
CREATE INDEX IF NOT EXISTS idx_product_variant_images_primary ON product_variant_images (product_id, color_name, is_primary);

CREATE TABLE IF NOT EXISTS warehouses (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  code VARCHAR(50),
  branch_name VARCHAR(255),
  location TEXT,
  latitude NUMERIC,
  longitude NUMERIC,
  allowed_radius_meters INTEGER NOT NULL DEFAULT 100,
  qr_token TEXT UNIQUE DEFAULT gen_random_uuid()::text,
  status VARCHAR(50) NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS branches (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  code VARCHAR(50),
  phone VARCHAR(50),
  address TEXT,
  manager VARCHAR(255),
  default_warehouse_id BIGINT NULL REFERENCES warehouses(id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  latitude NUMERIC,
  longitude NUMERIC,
  attendance_radius_meters INTEGER NOT NULL DEFAULT 100,
  allowed_radius_meters INTEGER NOT NULL DEFAULT 100,
  qr_token TEXT UNIQUE DEFAULT gen_random_uuid()::text,
  attendance_qr_token TEXT UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
  attendance_public_code VARCHAR(32) UNIQUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS warehouse_inventory (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  warehouse_id BIGINT NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  variant_id BIGINT NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  stock INTEGER NOT NULL DEFAULT 0,
  reserved_qty INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, warehouse_id, variant_id)
);

CREATE TABLE IF NOT EXISTS stock_transfers (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  variant_id BIGINT NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  from_warehouse BIGINT NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  to_warehouse BIGINT NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL DEFAULT 0,
  status VARCHAR(50) NOT NULL DEFAULT 'completed',
  note TEXT,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
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

CREATE TABLE IF NOT EXISTS inventory_count_sessions (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NULL REFERENCES tenants(id) ON DELETE SET NULL,
  branch_id BIGINT NULL REFERENCES branches(id) ON DELETE SET NULL,
  warehouse_id BIGINT NULL REFERENCES warehouses(id) ON DELETE SET NULL,
  title VARCHAR(255) NOT NULL DEFAULT 'جرد جديد',
  status VARCHAR(30) NOT NULL DEFAULT 'draft',
  notes TEXT NOT NULL DEFAULT '',
  opened_at TIMESTAMP NULL,
  completed_at TIMESTAMP NULL,
  cancelled_at TIMESTAMP NULL,
  created_by BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
  opened_by BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
  completed_by BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
  cancelled_by BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS inventory_count_items (
  id BIGSERIAL PRIMARY KEY,
  inventory_count_id BIGINT NULL,
  inventory_count_session_id BIGINT NULL REFERENCES inventory_count_sessions(id) ON DELETE CASCADE,
  product_id BIGINT NULL REFERENCES products(id) ON DELETE SET NULL,
  product_variant_id BIGINT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  variant_id BIGINT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  system_quantity INTEGER NOT NULL DEFAULT 0,
  counted_quantity INTEGER NOT NULL DEFAULT 0,
  difference_quantity INTEGER NOT NULL DEFAULT 0,
  expected_qty INTEGER NOT NULL DEFAULT 0,
  actual_qty INTEGER NOT NULL DEFAULT 0,
  difference_qty INTEGER NOT NULL DEFAULT 0,
  reason TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_inventory_count_sessions_tenant_created ON inventory_count_sessions (tenant_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_count_sessions_status ON inventory_count_sessions (status, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_count_sessions_branch_id ON inventory_count_sessions (branch_id);
CREATE INDEX IF NOT EXISTS idx_inventory_count_sessions_warehouse_id ON inventory_count_sessions (warehouse_id);
CREATE INDEX IF NOT EXISTS idx_inventory_count_items_session_id ON inventory_count_items (inventory_count_session_id);
CREATE INDEX IF NOT EXISTS idx_inventory_count_items_variant_id ON inventory_count_items (product_variant_id);
CREATE INDEX IF NOT EXISTS idx_inventory_count_items_inventory_count_id ON inventory_count_items (inventory_count_id);

  CREATE TABLE IF NOT EXISTS customers (
    id BIGSERIAL PRIMARY KEY,
    tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(50),
    email VARCHAR(255),
    address TEXT,
    wallet_balance NUMERIC(12,2) NOT NULL DEFAULT 0,
    loyalty_points NUMERIC(12,2) NOT NULL DEFAULT 0,
    loyalty_tier VARCHAR(50) NOT NULL DEFAULT 'Bronze',
    total_spent NUMERIC(12,2) NOT NULL DEFAULT 0,
    total_orders INTEGER NOT NULL DEFAULT 0,
    loyalty_updated_at TIMESTAMP NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'active',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS loyalty_rules (
    id BIGSERIAL PRIMARY KEY,
    tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL DEFAULT 'Default Loyalty Rule',
    points_per_currency_amount NUMERIC(12,4) NOT NULL DEFAULT 1,
    minimum_order_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    redeem_value NUMERIC(12,4) NOT NULL DEFAULT 1,
    bronze_threshold NUMERIC(12,2) NOT NULL DEFAULT 0,
    silver_threshold NUMERIC(12,2) NOT NULL DEFAULT 0,
    gold_threshold NUMERIC(12,2) NOT NULL DEFAULT 0,
    platinum_threshold NUMERIC(12,2) NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS customer_loyalty (
    id BIGSERIAL PRIMARY KEY,
    tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    tier VARCHAR(50) NOT NULL DEFAULT 'Bronze',
    total_points_earned NUMERIC(12,2) NOT NULL DEFAULT 0,
    total_points_redeemed NUMERIC(12,2) NOT NULL DEFAULT 0,
    available_points NUMERIC(12,2) NOT NULL DEFAULT 0,
    lifetime_spent NUMERIC(12,2) NOT NULL DEFAULT 0,
    last_order_at TIMESTAMP NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (tenant_id, customer_id)
  );

  CREATE TABLE IF NOT EXISTS suppliers (
    id BIGSERIAL PRIMARY KEY,
    tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  phone VARCHAR(50),
  email VARCHAR(255),
  address TEXT,
  debt_balance NUMERIC(12,2) NOT NULL DEFAULT 0,
  status VARCHAR(50) NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS orders (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  invoice_number VARCHAR(100) NOT NULL DEFAULT ('INV-PENDING-' || EXTRACT(EPOCH FROM NOW())::BIGINT || '-' || FLOOR(RANDOM() * 1000)::INT),
  public_order_number VARCHAR(40),
  display_order_number VARCHAR(40),
  customer_id BIGINT NULL REFERENCES customers(id) ON DELETE SET NULL,
  customer_name VARCHAR(255),
  channel VARCHAR(50) NOT NULL DEFAULT 'pos',
  cashier_id BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
  sales_employee_id BIGINT NULL,
  seller_user_id BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
  cashier_user_id BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
  seller_name VARCHAR(255),
  cashier_name VARCHAR(255),
  shift_id BIGINT NULL REFERENCES cashbox(id) ON DELETE SET NULL,
  branch_id BIGINT NULL REFERENCES branches(id) ON DELETE SET NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  payment_status VARCHAR(50) NOT NULL DEFAULT 'unpaid',
  transfer_proof_status VARCHAR(50),
  deleted_at TIMESTAMP NULL,
  cancelled_at TIMESTAMP NULL,
  cancelled_by BIGINT NULL,
  cancel_reason TEXT,
  stock_reverted_at TIMESTAMP NULL,
  inventory_rollback_done BOOLEAN NOT NULL DEFAULT FALSE,
  customer_address TEXT,
  governorate VARCHAR(120),
  city_area VARCHAR(160),
  governorate_id VARCHAR(160),
  city_id VARCHAR(160),
  area_id VARCHAR(160),
  district_id VARCHAR(160),
  zone_id VARCHAR(160),
  shipping_city_id VARCHAR(160),
  shipping_zone_id VARCHAR(160),
  shipping_district_id VARCHAR(160),
  shipping_address_line TEXT,
  street_address TEXT,
  building_number VARCHAR(80),
  floor_number VARCHAR(80),
  apartment_number VARCHAR(80),
  shipping_tracking_number VARCHAR(160),
  shipping_provider_delivery_id VARCHAR(160),
  shipping_label_url TEXT,
  shipping_last_synced_at TIMESTAMP NULL,
  shipping_raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  landmark TEXT,
  delivery_notes TEXT,
  order_notes TEXT,
  shipping_provider VARCHAR(80) NOT NULL DEFAULT 'manual',
  shipping_provider_id VARCHAR(80) NOT NULL DEFAULT 'in_store_delivery',
  shipping_cost NUMERIC(12,2) NOT NULL DEFAULT 0,
  shipping_status VARCHAR(80) NOT NULL DEFAULT 'pending',
  shipment_status VARCHAR(80),
  shipment_id VARCHAR(160),
  tracking_number VARCHAR(160),
  tracking_url TEXT,
  courier_notes TEXT,
  shipment_timeline JSONB NOT NULL DEFAULT '[]'::jsonb,
  last_shipping_sync_at TIMESTAMP NULL,
  ai_agent_session_id TEXT,
  ai_agent_conversation_id TEXT,
  ai_agent_intent_hash TEXT,
  ai_agent_status VARCHAR(50),
  ai_agent_confidence NUMERIC(5,4),
  ai_agent_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
  discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  invoice_discount_type VARCHAR(20),
  invoice_discount_value NUMERIC(12,2) NOT NULL DEFAULT 0,
  invoice_discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  invoice_discount_reason TEXT,
  tax_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  service_fee NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  total NUMERIC(12,2) NOT NULL DEFAULT 0,
  paid_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  change_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  notes TEXT,
  public_token TEXT UNIQUE,
  invoice_public_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, invoice_number)
);

CREATE INDEX IF NOT EXISTS idx_orders_public_order_number ON orders (public_order_number);
CREATE INDEX IF NOT EXISTS idx_orders_display_order_number ON orders (display_order_number);
CREATE INDEX IF NOT EXISTS idx_orders_tenant_created ON orders (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_branch_created ON orders (branch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_invoice_number ON orders (invoice_number);

CREATE TABLE IF NOT EXISTS shipping_events (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT REFERENCES orders(id) ON DELETE CASCADE,
  provider VARCHAR(80) NOT NULL,
  status VARCHAR(80) NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  event_key TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_shipping_events_provider_event_key
  ON shipping_events(provider, event_key)
  WHERE event_key IS NOT NULL AND event_key <> '';
CREATE INDEX IF NOT EXISTS idx_shipping_events_order_id ON shipping_events(order_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ai_agent_settings (
  tenant_id BIGINT PRIMARY KEY,
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ai_customer_profiles (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  first_name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  external_customer_id TEXT NOT NULL DEFAULT '',
  preferred_size TEXT NOT NULL DEFAULT '',
  preferred_colors JSONB NOT NULL DEFAULT '[]'::jsonb,
  preferred_models JSONB NOT NULL DEFAULT '[]'::jsonb,
  favorite_brands JSONB NOT NULL DEFAULT '[]'::jsonb,
  budget_range JSONB NOT NULL DEFAULT '{}'::jsonb,
  viewed_products JSONB NOT NULL DEFAULT '[]'::jsonb,
  abandoned_products JSONB NOT NULL DEFAULT '[]'::jsonb,
  order_history JSONB NOT NULL DEFAULT '[]'::jsonb,
  support_history JSONB NOT NULL DEFAULT '[]'::jsonb,
  city_area TEXT NOT NULL DEFAULT '',
  conversation_summary TEXT NOT NULL DEFAULT '',
  customer_sentiment TEXT NOT NULL DEFAULT 'neutral',
  memory_score INTEGER NOT NULL DEFAULT 0,
  last_seen_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, phone)
);
CREATE INDEX IF NOT EXISTS idx_ai_customer_profiles_external_customer_id ON ai_customer_profiles (tenant_id, external_customer_id);

CREATE TABLE IF NOT EXISTS ai_customer_memories (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  profile_id BIGINT NULL REFERENCES ai_customer_profiles(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL DEFAULT '',
  memory_type TEXT NOT NULL DEFAULT 'preference',
  memory_key TEXT NOT NULL DEFAULT '',
  memory_value JSONB NOT NULL DEFAULT '{}'::jsonb,
  score INTEGER NOT NULL DEFAULT 0,
  last_seen_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ai_customer_interactions (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  profile_id BIGINT NULL REFERENCES ai_customer_profiles(id) ON DELETE SET NULL,
  session_id TEXT NOT NULL DEFAULT '',
  source_channel TEXT NOT NULL DEFAULT 'web_chat',
  message TEXT NOT NULL DEFAULT '',
  ai_response TEXT NOT NULL DEFAULT '',
  intent_type TEXT NOT NULL DEFAULT '',
  detected_intent TEXT NOT NULL DEFAULT '',
  sentiment TEXT NOT NULL DEFAULT 'neutral',
  confidence NUMERIC(5,4) NOT NULL DEFAULT 0,
  intent_confidence NUMERIC(5,2),
  detected_language TEXT,
  handoff_to_human BOOLEAN DEFAULT FALSE,
  resolution_status TEXT DEFAULT 'open',
  ai_response_time_ms INTEGER,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ai_followup_tasks (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  profile_id BIGINT NULL REFERENCES ai_customer_profiles(id) ON DELETE SET NULL,
  session_id TEXT NOT NULL DEFAULT '',
  source_channel TEXT NOT NULL DEFAULT 'web_chat',
  trigger_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  scheduled_at TIMESTAMP NOT NULL,
  last_sent_at TIMESTAMP NULL,
  cooldown_until TIMESTAMP NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ai_reply_corrections (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  conversation_id TEXT NOT NULL DEFAULT '',
  message_id TEXT NOT NULL DEFAULT '',
  customer_question TEXT NOT NULL DEFAULT '',
  ai_wrong_answer TEXT NOT NULL DEFAULT '',
  employee_correct_answer TEXT NOT NULL DEFAULT '',
  correction_type TEXT NOT NULL DEFAULT 'other',
  product_id BIGINT NULL,
  channel TEXT NOT NULL DEFAULT 'web_chat',
  created_by BIGINT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_ai_reply_corrections_tenant_id ON ai_reply_corrections (tenant_id);
CREATE INDEX IF NOT EXISTS idx_ai_reply_corrections_conversation_id ON ai_reply_corrections (tenant_id, conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_reply_corrections_product_id ON ai_reply_corrections (tenant_id, product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_reply_corrections_correction_type ON ai_reply_corrections (tenant_id, correction_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_reply_corrections_created_at ON ai_reply_corrections (created_at DESC);

CREATE TABLE IF NOT EXISTS ai_lead_opportunities (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  profile_id BIGINT NOT NULL REFERENCES ai_customer_profiles(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL DEFAULT '',
  source_key TEXT NOT NULL DEFAULT '',
  source_label TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',
  notes TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_lead_opportunities_scope ON ai_lead_opportunities (tenant_id, profile_id, conversation_id, source_key);
CREATE INDEX IF NOT EXISTS idx_ai_lead_opportunities_tenant_status ON ai_lead_opportunities (tenant_id, status, created_at DESC);

ALTER TABLE IF EXISTS ai_conversations
  ADD COLUMN IF NOT EXISTS detected_intent TEXT,
  ADD COLUMN IF NOT EXISTS intent_confidence NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS sentiment TEXT,
  ADD COLUMN IF NOT EXISTS detected_language TEXT,
  ADD COLUMN IF NOT EXISTS handoff_to_human BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS resolution_status TEXT DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS ai_response_time_ms INTEGER,
  ADD COLUMN IF NOT EXISTS ai_enabled BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE IF EXISTS ai_support_sessions
  ADD COLUMN IF NOT EXISTS detected_intent TEXT,
  ADD COLUMN IF NOT EXISTS intent_confidence NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS sentiment TEXT,
  ADD COLUMN IF NOT EXISTS detected_language TEXT,
  ADD COLUMN IF NOT EXISTS handoff_to_human BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS resolution_status TEXT DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS ai_response_time_ms INTEGER,
  ADD COLUMN IF NOT EXISTS ai_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS thread_kind TEXT NOT NULL DEFAULT 'dm',
  ADD COLUMN IF NOT EXISTS read_at TIMESTAMP NULL,
  ADD COLUMN IF NOT EXISTS last_ai_reply_draft JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS last_ai_reply_draft_updated_at TIMESTAMP NULL;

ALTER TABLE IF EXISTS ai_support_messages
  ADD COLUMN IF NOT EXISTS detected_intent TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS intent_confidence NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS sentiment TEXT,
  ADD COLUMN IF NOT EXISTS detected_language TEXT,
  ADD COLUMN IF NOT EXISTS handoff_to_human BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS resolution_status TEXT DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS ai_response_time_ms INTEGER,
  ADD COLUMN IF NOT EXISTS message_type TEXT NOT NULL DEFAULT 'text',
  ADD COLUMN IF NOT EXISTS product_cards JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS external_reply_id TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS error_code TEXT NOT NULL DEFAULT '';

ALTER TABLE IF EXISTS ai_channel_conversations
  ADD COLUMN IF NOT EXISTS thread_kind TEXT NOT NULL DEFAULT 'dm';
ALTER TABLE IF EXISTS ai_channel_conversations
  ADD COLUMN IF NOT EXISTS lead_status TEXT NOT NULL DEFAULT 'new';
ALTER TABLE IF EXISTS ai_channel_conversations
  ADD COLUMN IF NOT EXISTS read_at TIMESTAMP NULL;
ALTER TABLE IF EXISTS ai_customer_profiles
  ADD COLUMN IF NOT EXISTS external_customer_id TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS social_comment_automation_runs (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  platform TEXT NOT NULL,
  channel TEXT NOT NULL,
  post_id TEXT NOT NULL DEFAULT '',
  post_permalink TEXT NOT NULL DEFAULT '',
  comment_id TEXT NOT NULL,
  parent_comment_id TEXT NOT NULL DEFAULT '',
  root_comment_id TEXT NOT NULL DEFAULT '',
  commenter_id TEXT NOT NULL DEFAULT '',
  commenter_name TEXT NOT NULL DEFAULT '',
  commenter_profile_picture_url TEXT NOT NULL DEFAULT '',
  original_comment_text TEXT NOT NULL DEFAULT '',
  classification_label TEXT NULL,
  classification_score NUMERIC(6,4) NULL,
  action_taken TEXT NULL,
  public_reply_status TEXT NULL,
  dm_status TEXT NULL,
  like_status TEXT NULL,
  inbox_conversation_id TEXT NULL,
  error_code TEXT NULL,
  automation_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  processed_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, platform, comment_id)
);

CREATE INDEX IF NOT EXISTS idx_social_comment_automation_runs_tenant_created ON social_comment_automation_runs (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_social_comment_automation_runs_tenant_platform ON social_comment_automation_runs (tenant_id, platform, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_social_comment_automation_runs_tenant_comment ON social_comment_automation_runs (tenant_id, comment_id);

CREATE TABLE IF NOT EXISTS social_automation_settings (
  tenant_id BIGINT PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  auto_like_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  auto_public_reply_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  auto_private_message_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  min_confidence NUMERIC(6,4) NOT NULL DEFAULT 0.9000,
  public_reply_template TEXT NOT NULL DEFAULT 'تم إرسال التفاصيل في رسالة خاصة ',
  private_message_template TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE IF EXISTS social_automation_settings
  ADD COLUMN IF NOT EXISTS tenant_id BIGINT,
  ADD COLUMN IF NOT EXISTS auto_like_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS auto_public_reply_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS auto_private_message_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS min_confidence NUMERIC(6,4) NOT NULL DEFAULT 0.9000,
  ADD COLUMN IF NOT EXISTS public_reply_template TEXT NOT NULL DEFAULT 'تم إرسال التفاصيل في رسالة خاصة ',
  ADD COLUMN IF NOT EXISTS private_message_template TEXT NULL,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE IF EXISTS ai_customer_interactions
  ADD COLUMN IF NOT EXISTS detected_intent TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS intent_confidence NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS detected_language TEXT,
  ADD COLUMN IF NOT EXISTS handoff_to_human BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS resolution_status TEXT DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS ai_response_time_ms INTEGER;

UPDATE ai_customer_interactions
SET detected_intent = intent_type
WHERE COALESCE(detected_intent, '') = '' AND COALESCE(intent_type, '') <> '';

ALTER TABLE IF EXISTS orders
  ADD COLUMN IF NOT EXISTS cashier_id BIGINT NULL REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE IF EXISTS orders
  ADD COLUMN IF NOT EXISTS sales_employee_id BIGINT NULL;

ALTER TABLE IF EXISTS orders
  ADD COLUMN IF NOT EXISTS seller_user_id BIGINT NULL REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE IF EXISTS orders
  ADD COLUMN IF NOT EXISTS cashier_user_id BIGINT NULL REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE IF EXISTS orders
  ADD COLUMN IF NOT EXISTS seller_name VARCHAR(255);

ALTER TABLE IF EXISTS orders
  ADD COLUMN IF NOT EXISTS cashier_name VARCHAR(255);

ALTER TABLE IF EXISTS orders
  ADD COLUMN IF NOT EXISTS shift_id BIGINT NULL REFERENCES cashbox(id) ON DELETE SET NULL;

ALTER TABLE IF EXISTS orders
  ADD COLUMN IF NOT EXISTS invoice_discount_type VARCHAR(20),
  ADD COLUMN IF NOT EXISTS invoice_discount_value NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS invoice_discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS invoice_discount_reason TEXT;

DROP VIEW IF EXISTS pos_orders CASCADE;

CREATE VIEW pos_orders AS
SELECT
  id,
  tenant_id,
  invoice_number,
  customer_id,
  customer_name,
  channel,
  cashier_id,
  sales_employee_id,
  seller_user_id,
  cashier_user_id,
  seller_name,
  cashier_name,
  shift_id,
  branch_id,
  status,
  payment_status,
  subtotal,
  discount_amount,
  tax_amount,
  service_fee,
  total_amount,
  total_price,
  paid_amount,
  change_amount,
  notes,
  created_by,
  created_at,
  updated_at
FROM orders;

CREATE TABLE IF NOT EXISTS loyalty_transactions (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  order_id BIGINT NULL REFERENCES orders(id) ON DELETE SET NULL,
  transaction_type VARCHAR(50) NOT NULL,
  points NUMERIC(12,2) NOT NULL DEFAULT 0,
  amount_value NUMERIC(12,2) NOT NULL DEFAULT 0,
  description TEXT,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS customer_loyalty_history (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT,
  customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  order_id BIGINT NULL REFERENCES orders(id) ON DELETE SET NULL,
  source VARCHAR(50) NOT NULL DEFAULT 'pos',
  points_change NUMERIC(12,2) NOT NULL DEFAULT 0,
  balance_after NUMERIC(12,2) NOT NULL DEFAULT 0,
  reason TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS customer_wallets (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  balance NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_cashback_earned NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_redeemed NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, customer_id)
);

CREATE TABLE IF NOT EXISTS wallet_transactions (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  order_id BIGINT NULL REFERENCES orders(id) ON DELETE SET NULL,
  transaction_type VARCHAR(50) NOT NULL,
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  before_balance NUMERIC(12,2) NOT NULL DEFAULT 0,
  after_balance NUMERIC(12,2) NOT NULL DEFAULT 0,
  balance_after NUMERIC(12,2) NOT NULL DEFAULT 0,
  reference_type VARCHAR(50),
  reference_id BIGINT,
  notes TEXT,
  description TEXT,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS order_items (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id BIGINT NULL REFERENCES products(id) ON DELETE SET NULL,
  variant_id BIGINT NULL REFERENCES product_variants(id) ON DELETE SET NULL,
  product_name VARCHAR(255) NOT NULL,
  variant_name VARCHAR(255),
  sku VARCHAR(120),
  barcode VARCHAR(120),
  quantity INTEGER NOT NULL DEFAULT 1,
  returned_quantity INTEGER NOT NULL DEFAULT 0,
  sale_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_amount NUMERIC(12,2) NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS returns (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  return_number VARCHAR(100) NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  reason TEXT,
  restock BOOLEAN NOT NULL DEFAULT FALSE,
  refund_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  shift_id BIGINT NULL,
  cashier_user_id BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, return_number)
);

CREATE TABLE IF NOT EXISTS return_items (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  return_id BIGINT NOT NULL REFERENCES returns(id) ON DELETE CASCADE,
  order_item_id BIGINT NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
  variant_id BIGINT NULL REFERENCES product_variants(id) ON DELETE SET NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  refund_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  restock BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS purchases (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  supplier_id BIGINT NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  warehouse_id BIGINT NULL REFERENCES warehouses(id) ON DELETE SET NULL,
  purchase_number VARCHAR(100) NOT NULL DEFAULT ('PUR-' || EXTRACT(EPOCH FROM NOW())::BIGINT || '-' || FLOOR(RANDOM() * 1000)::INT),
  status VARCHAR(50) NOT NULL DEFAULT 'draft',
  payment_status VARCHAR(50) NOT NULL DEFAULT 'unpaid',
  subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  total NUMERIC(12,2) NOT NULL DEFAULT 0,
  paid_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  notes TEXT,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, purchase_number)
);

CREATE TABLE IF NOT EXISTS purchase_items (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  purchase_id BIGINT NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  product_id BIGINT NULL REFERENCES products(id) ON DELETE SET NULL,
  variant_id BIGINT NULL REFERENCES product_variants(id) ON DELETE SET NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  cost_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  total NUMERIC(12,2) NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS expenses (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  category VARCHAR(255),
  payment_method VARCHAR(50) DEFAULT 'cash',
  note TEXT,
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  approved_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  approved_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS income (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  category VARCHAR(255),
  note TEXT,
  status VARCHAR(50) NOT NULL DEFAULT 'posted',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS cashbox (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  balance NUMERIC(12,2) NOT NULL DEFAULT 0,
  status VARCHAR(50) NOT NULL DEFAULT 'open',
  opened_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  opened_at TIMESTAMP NULL,
  closed_at TIMESTAMP NULL,
  shift_summary TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS cashbox_movements (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  cashbox_id BIGINT NOT NULL REFERENCES cashbox(id) ON DELETE CASCADE,
  shift_id BIGINT NULL,
  user_id BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
  branch_id BIGINT NULL REFERENCES branches(id) ON DELETE SET NULL,
  movement_type VARCHAR(50) NOT NULL,
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  note TEXT,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS cash_drawer_shifts (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id BIGINT NULL REFERENCES branches(id) ON DELETE SET NULL,
  financial_account_id BIGINT NULL,
  opened_by BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  opened_by_user_id BIGINT NULL REFERENCES users(id) ON DELETE RESTRICT,
  closed_by BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
  closed_by_user_id BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
  opened_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  closed_at TIMESTAMP NULL,
  opening_cash NUMERIC(12,2) NOT NULL DEFAULT 0,
  expected_cash NUMERIC(12,2) NOT NULL DEFAULT 0,
  actual_cash NUMERIC(12,2) NULL,
  closing_cash NUMERIC(12,2) NULL,
  difference NUMERIC(12,2) NOT NULL DEFAULT 0,
  cash_difference NUMERIC(12,2) NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'open',
  notes TEXT NOT NULL DEFAULT ''
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cash_drawer_one_open_shift
  ON cash_drawer_shifts (tenant_id, branch_id, opened_by)
  WHERE status = 'open';

CREATE INDEX IF NOT EXISTS idx_pos_shifts_user_branch_status
  ON cash_drawer_shifts (opened_by_user_id, branch_id, status);

CREATE TABLE IF NOT EXISTS cash_drawer_shift_events (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  shift_id BIGINT NOT NULL REFERENCES cash_drawer_shifts(id) ON DELETE CASCADE,
  event_type VARCHAR(50) NOT NULL,
  source_type VARCHAR(100) NULL,
  source_id BIGINT NULL,
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by BIGINT NULL REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_cash_drawer_events_shift
  ON cash_drawer_shift_events (tenant_id, shift_id, created_at DESC);

CREATE TABLE IF NOT EXISTS journal_entries (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entry_number VARCHAR(100) NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'draft',
  reference_type VARCHAR(100),
  reference_id BIGINT,
  description TEXT,
  notes TEXT,
  entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, entry_number)
);

CREATE TABLE IF NOT EXISTS accounts (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code VARCHAR(50) NOT NULL,
  name VARCHAR(255) NOT NULL,
  type VARCHAR(50) NOT NULL,
  parent_id BIGINT NULL REFERENCES accounts(id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, code)
);

CREATE TABLE IF NOT EXISTS journal_entry_lines (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  journal_entry_id BIGINT NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  debit NUMERIC(12,2) NOT NULL DEFAULT 0,
  credit NUMERIC(12,2) NOT NULL DEFAULT 0,
  branch_id BIGINT NULL REFERENCES branches(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS journal_lines (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  journal_entry_id BIGINT NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  account_name VARCHAR(255) NOT NULL,
  account_code VARCHAR(100),
  debit NUMERIC(12,2) NOT NULL DEFAULT 0,
  credit NUMERIC(12,2) NOT NULL DEFAULT 0,
  note TEXT
);

CREATE TABLE IF NOT EXISTS commission_rules (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  scope_type VARCHAR(50) NOT NULL DEFAULT 'global',
  scope_id BIGINT NULL,
  rule_type VARCHAR(50) NOT NULL DEFAULT 'percentage',
  value NUMERIC(12,2) NOT NULL DEFAULT 0,
  apply_to VARCHAR(50) NOT NULL DEFAULT 'sale',
  priority INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS employee_sales (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  cashier_id BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
  sales_employee_id BIGINT NULL,
  shift_id BIGINT NULL REFERENCES cashbox(id) ON DELETE SET NULL,
  branch_id BIGINT NULL REFERENCES branches(id) ON DELETE SET NULL,
  total_sales NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_orders INTEGER NOT NULL DEFAULT 1,
  commission_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  refund_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  status VARCHAR(50) NOT NULL DEFAULT 'recorded',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, order_id)
);

CREATE TABLE IF NOT EXISTS employee_commissions (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  order_item_id BIGINT NULL REFERENCES order_items(id) ON DELETE CASCADE,
  product_id BIGINT NULL REFERENCES products(id) ON DELETE SET NULL,
  category_id BIGINT NULL REFERENCES categories(id) ON DELETE SET NULL,
  commission_rule_id BIGINT NULL REFERENCES commission_rules(id) ON DELETE SET NULL,
  rule_type VARCHAR(50) NOT NULL DEFAULT 'percentage',
  scope_type VARCHAR(50) NOT NULL DEFAULT 'global',
  sale_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  commission_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  status VARCHAR(50) NOT NULL DEFAULT 'earned',
  branch_id BIGINT NULL REFERENCES branches(id) ON DELETE SET NULL,
  shift_id BIGINT NULL REFERENCES cashbox(id) ON DELETE SET NULL,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS transactions (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL,
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  payment_method VARCHAR(50) NOT NULL DEFAULT 'cash',
  note TEXT,
  cashbox_id BIGINT NULL REFERENCES cashbox(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS payment_transactions (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id BIGINT NULL REFERENCES branches(id) ON DELETE SET NULL,
  order_id BIGINT NULL REFERENCES orders(id) ON DELETE SET NULL,
  provider VARCHAR(50) NOT NULL DEFAULT 'paymob',
  provider_order_id TEXT,
  terminal_id TEXT,
  amount_cents BIGINT NOT NULL DEFAULT 0,
  currency VARCHAR(10) NOT NULL DEFAULT 'EGP',
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  request_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  response_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT,
  transaction_reference TEXT,
  confirmed_amount_cents BIGINT NOT NULL DEFAULT 0,
  confirmed_at TIMESTAMP NULL,
  confirmation_source TEXT,
  confirmed_by BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
  created_by BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_payment_transactions_order ON payment_transactions (tenant_id, order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_provider_order ON payment_transactions (provider, provider_order_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_transactions_reference ON payment_transactions (provider, transaction_reference) WHERE transaction_reference IS NOT NULL AND transaction_reference <> '';

CREATE TABLE IF NOT EXISTS payment_transaction_events (
  id BIGSERIAL PRIMARY KEY,
  transaction_id BIGINT NULL REFERENCES payment_transactions(id) ON DELETE SET NULL,
  provider VARCHAR(50) NOT NULL DEFAULT 'paymob',
  provider_event_id TEXT,
  event_type VARCHAR(80) NOT NULL DEFAULT 'payment_status',
  status VARCHAR(50),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_transaction_events_provider_event ON payment_transaction_events (provider, provider_event_id) WHERE provider_event_id IS NOT NULL AND provider_event_id <> '';

CREATE TABLE IF NOT EXISTS ledger_entries (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entry_type VARCHAR(50) NOT NULL,
  party_type VARCHAR(50),
  party_id BIGINT,
  reference_type VARCHAR(100),
  reference_id BIGINT,
  debit NUMERIC(12,2) NOT NULL DEFAULT 0,
  credit NUMERIC(12,2) NOT NULL DEFAULT 0,
  running_balance NUMERIC(12,2) NOT NULL DEFAULT 0,
  note TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT REFERENCES tenants(id) ON DELETE SET NULL,
  user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(120) NOT NULL,
  entity_type VARCHAR(120),
  entity_id BIGINT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS employees (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id BIGINT NULL REFERENCES branches(id) ON DELETE SET NULL,
  employee_code VARCHAR(100) NOT NULL,
  full_name VARCHAR(255) NOT NULL,
  photo_url TEXT,
  phone VARCHAR(50),
  email VARCHAR(255),
  national_id VARCHAR(120),
  role VARCHAR(120),
  job_title VARCHAR(120),
  position VARCHAR(120),
  salary NUMERIC(12,2) NOT NULL DEFAULT 0,
  hire_date DATE NOT NULL DEFAULT CURRENT_DATE,
  status VARCHAR(50) NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, employee_code)
);

CREATE TABLE IF NOT EXISTS employee_shifts (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id BIGINT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  shift_name VARCHAR(255) NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  allowed_late_minutes INTEGER NOT NULL DEFAULT 0,
  overtime_after_minutes INTEGER NOT NULL DEFAULT 0,
  working_days JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS attendance_logs (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id BIGINT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  shift_id BIGINT NULL REFERENCES employee_shifts(id) ON DELETE SET NULL,
  branch_id BIGINT NULL REFERENCES branches(id) ON DELETE SET NULL,
  attendance_date DATE NOT NULL,
  check_in TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  check_out TIMESTAMP NULL,
  check_in_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  check_out_at TIMESTAMP NULL,
  check_in_latitude NUMERIC NULL,
  check_in_longitude NUMERIC NULL,
  check_in_gps_distance_meters NUMERIC NULL,
  check_in_gps_verification_result VARCHAR(30),
  check_out_latitude NUMERIC NULL,
  check_out_longitude NUMERIC NULL,
  check_out_gps_distance_meters NUMERIC NULL,
  check_out_gps_verification_result VARCHAR(30),
  attendance_source VARCHAR(50) NOT NULL DEFAULT 'manual',
  status VARCHAR(30) NOT NULL DEFAULT 'checked_in',
  work_minutes INTEGER NOT NULL DEFAULT 0,
  late_minutes INTEGER NOT NULL DEFAULT 0,
  early_leave_minutes INTEGER NOT NULL DEFAULT 0,
  overtime_minutes INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, employee_id, attendance_date)
);

CREATE TABLE IF NOT EXISTS attendance_events (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id BIGINT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  branch_id BIGINT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  attendance_log_id BIGINT NULL REFERENCES attendance_logs(id) ON DELETE SET NULL,
  action_type VARCHAR(30) NOT NULL,
  action_timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  user_agent TEXT,
  ip_address TEXT,
  latitude NUMERIC NULL,
  longitude NUMERIC NULL,
  gps_distance_meters NUMERIC NULL,
  gps_verification_result VARCHAR(30),
  source VARCHAR(50) NOT NULL DEFAULT 'branch_qr',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_logs_employee_date_unique
  ON attendance_logs (employee_id, attendance_date);

ALTER TABLE IF EXISTS orders
  ADD COLUMN IF NOT EXISTS attendance_log_id BIGINT NULL REFERENCES attendance_logs(id) ON DELETE SET NULL;

ALTER TABLE IF EXISTS orders
  ADD COLUMN IF NOT EXISTS payment_method VARCHAR(50) DEFAULT 'cash';

ALTER TABLE IF EXISTS orders
  ADD COLUMN IF NOT EXISTS cash_amount NUMERIC(12,2) NOT NULL DEFAULT 0;

ALTER TABLE IF EXISTS orders
  ADD COLUMN IF NOT EXISTS card_amount NUMERIC(12,2) NOT NULL DEFAULT 0;

ALTER TABLE IF EXISTS orders
  ADD COLUMN IF NOT EXISTS wallet_payment_amount NUMERIC(12,2) NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_employees_tenant_branch ON employees (tenant_id, branch_id);

CREATE TABLE IF NOT EXISTS employee_chat_threads (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id BIGINT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  branch_id BIGINT NULL REFERENCES branches(id) ON DELETE SET NULL,
  status VARCHAR(40) NOT NULL DEFAULT 'open',
  last_message_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_employee_chat_threads_employee ON employee_chat_threads (employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_chat_threads_tenant_last ON employee_chat_threads (tenant_id, last_message_at DESC NULLS LAST, updated_at DESC);

CREATE TABLE IF NOT EXISTS employee_chat_messages (
  id BIGSERIAL PRIMARY KEY,
  thread_id BIGINT NOT NULL REFERENCES employee_chat_threads(id) ON DELETE CASCADE,
  sender_type VARCHAR(20) NOT NULL CHECK (sender_type IN ('employee', 'admin')),
  sender_employee_id BIGINT NULL REFERENCES employees(id) ON DELETE SET NULL,
  sender_user_id BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
  body TEXT NOT NULL DEFAULT '',
  attachment_url TEXT NULL,
  attachment_type VARCHAR(40) NULL,
  attachment_name TEXT NULL,
  attachment_size BIGINT NULL,
  attachment_mime TEXT NULL,
  read_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_employee_chat_messages_thread_created ON employee_chat_messages (thread_id, created_at ASC, id ASC);
CREATE INDEX IF NOT EXISTS idx_employee_chat_messages_unread ON employee_chat_messages (thread_id, sender_type, read_at) WHERE read_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_employee_shifts_tenant_employee ON employee_shifts (tenant_id, employee_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_logs_tenant_employee_date ON attendance_logs (tenant_id, employee_id, attendance_date DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_logs_tenant_branch_date ON attendance_logs (tenant_id, branch_id, attendance_date DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_logs_tenant_shift_date ON attendance_logs (tenant_id, shift_id, attendance_date DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_branches_attendance_qr_token ON branches (attendance_qr_token);
CREATE UNIQUE INDEX IF NOT EXISTS idx_branches_attendance_public_code ON branches (attendance_public_code);
CREATE INDEX IF NOT EXISTS idx_attendance_events_duplicate_window ON attendance_events (tenant_id, employee_id, branch_id, action_type, action_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_events_branch_timestamp ON attendance_events (tenant_id, branch_id, action_timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_users_tenant_id ON users (tenant_id);
CREATE INDEX IF NOT EXISTS idx_roles_tenant_id ON roles (tenant_id);
CREATE INDEX IF NOT EXISTS idx_products_tenant_id ON products (tenant_id);
CREATE INDEX IF NOT EXISTS idx_variants_tenant_id ON product_variants (tenant_id);
CREATE INDEX IF NOT EXISTS idx_product_variants_article_code_lower ON product_variants (LOWER(TRIM(article_code))) WHERE article_code IS NOT NULL AND TRIM(article_code) <> '';
CREATE INDEX IF NOT EXISTS idx_orders_tenant_id ON orders (tenant_id);
CREATE INDEX IF NOT EXISTS idx_pos_orders_shift_id ON orders (shift_id);
CREATE INDEX IF NOT EXISTS idx_pos_orders_seller_user_id ON orders (seller_user_id);
CREATE INDEX IF NOT EXISTS idx_pos_orders_cashier_user_id ON orders (cashier_user_id);
CREATE INDEX IF NOT EXISTS idx_purchases_tenant_id ON purchases (tenant_id);
CREATE INDEX IF NOT EXISTS idx_customers_tenant_id ON customers (tenant_id);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers (phone);
CREATE INDEX IF NOT EXISTS idx_loyalty_rules_tenant_id ON loyalty_rules (tenant_id);
CREATE INDEX IF NOT EXISTS idx_customer_loyalty_tenant_id ON customer_loyalty (tenant_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_loyalty_transactions_tenant_customer ON loyalty_transactions (tenant_id, customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_customer_loyalty_history_customer ON customer_loyalty_history (tenant_id, customer_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_loyalty_history_order_reason
  ON customer_loyalty_history (COALESCE(tenant_id, 0), customer_id, order_id, source, reason)
  WHERE order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_suppliers_tenant_id ON suppliers (tenant_id);
CREATE INDEX IF NOT EXISTS idx_expenses_tenant_id ON expenses (tenant_id);
CREATE INDEX IF NOT EXISTS idx_cashbox_tenant_id ON cashbox (tenant_id);
CREATE INDEX IF NOT EXISTS idx_employee_sales_tenant_id ON employee_sales (tenant_id, sales_employee_id, cashier_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_employee_commissions_tenant_id ON employee_commissions (tenant_id, employee_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_commission_rules_tenant_id ON commission_rules (tenant_id, is_active, scope_type);

CREATE TABLE IF NOT EXISTS marketing_campaigns (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status VARCHAR(30) NOT NULL DEFAULT 'draft',
  start_date DATE NULL,
  end_date DATE NULL,
  budget NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, name)
);

CREATE TABLE IF NOT EXISTS marketing_post_templates (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  channel VARCHAR(30) NOT NULL DEFAULT 'facebook',
  title_template TEXT NOT NULL DEFAULT '',
  caption_template TEXT NOT NULL DEFAULT '',
  hashtags TEXT NOT NULL DEFAULT '',
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, name)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_marketing_post_templates_default
  ON marketing_post_templates (tenant_id)
  WHERE is_default = TRUE;

CREATE TABLE IF NOT EXISTS marketing_posts (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  product_id BIGINT NULL REFERENCES products(id) ON DELETE SET NULL,
  campaign_id BIGINT NULL REFERENCES marketing_campaigns(id) ON DELETE SET NULL,
  template_id BIGINT NULL REFERENCES marketing_post_templates(id) ON DELETE SET NULL,
  title TEXT NOT NULL DEFAULT '',
  caption TEXT NOT NULL DEFAULT '',
  hashtags TEXT NOT NULL DEFAULT '',
  image_url TEXT NOT NULL DEFAULT '',
  media_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
  channel VARCHAR(30) NOT NULL DEFAULT 'facebook',
  status VARCHAR(30) NOT NULL DEFAULT 'draft',
  scheduled_at TIMESTAMP NULL,
  published_at TIMESTAMP NULL,
  external_post_id VARCHAR(255) NULL,
  platform_post_id TEXT NULL,
  platform_publish_results JSONB NOT NULL DEFAULT '{}'::jsonb,
  story_status VARCHAR(30) NOT NULL DEFAULT 'draft',
  story_type VARCHAR(30) NOT NULL DEFAULT 'story',
  story_scheduled_at TIMESTAMP NULL,
  story_published_at TIMESTAMP NULL,
  story_publish_results JSONB NOT NULL DEFAULT '{}'::jsonb,
  story_error_message TEXT NULL,
  error_message TEXT NULL,
  tracking_code TEXT NULL,
  tracking_link TEXT NULL,
  tracking_source TEXT NULL,
  tracking_kind VARCHAR(30) NOT NULL DEFAULT 'post',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE IF EXISTS marketing_posts
  ADD COLUMN IF NOT EXISTS media_urls JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE IF EXISTS marketing_posts
  ADD COLUMN IF NOT EXISTS platform_post_id TEXT NULL;
ALTER TABLE IF EXISTS marketing_posts
  ADD COLUMN IF NOT EXISTS platform_publish_results JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE IF EXISTS marketing_posts
  ADD COLUMN IF NOT EXISTS story_status VARCHAR(30) NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS story_type VARCHAR(30) NOT NULL DEFAULT 'story',
  ADD COLUMN IF NOT EXISTS story_scheduled_at TIMESTAMP NULL,
  ADD COLUMN IF NOT EXISTS story_published_at TIMESTAMP NULL,
  ADD COLUMN IF NOT EXISTS story_publish_results JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS story_error_message TEXT NULL,
  ADD COLUMN IF NOT EXISTS tracking_code TEXT NULL,
  ADD COLUMN IF NOT EXISTS tracking_link TEXT NULL,
  ADD COLUMN IF NOT EXISTS tracking_source TEXT NULL,
  ADD COLUMN IF NOT EXISTS tracking_kind VARCHAR(30) NOT NULL DEFAULT 'post';

CREATE INDEX IF NOT EXISTS idx_marketing_posts_tenant_status
  ON marketing_posts (tenant_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_marketing_posts_tenant_channel
  ON marketing_posts (tenant_id, channel, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_marketing_posts_tenant_schedule
  ON marketing_posts (tenant_id, scheduled_at DESC);

CREATE TABLE IF NOT EXISTS marketing_post_analytics (
  id BIGSERIAL PRIMARY KEY,
  post_id BIGINT NOT NULL REFERENCES marketing_posts(id) ON DELETE CASCADE,
  platform VARCHAR(30) NOT NULL,
  platform_post_id TEXT NOT NULL,
  likes INTEGER NULL,
  comments INTEGER NULL,
  shares INTEGER NULL,
  reach INTEGER NULL,
  impressions INTEGER NULL,
  saves INTEGER NULL,
  clicks INTEGER NULL,
  synced_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (post_id, platform)
);

ALTER TABLE IF EXISTS marketing_post_analytics
  ADD COLUMN IF NOT EXISTS platform VARCHAR(30) NOT NULL DEFAULT 'facebook',
  ADD COLUMN IF NOT EXISTS platform_post_id TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS likes INTEGER NULL,
  ADD COLUMN IF NOT EXISTS comments INTEGER NULL,
  ADD COLUMN IF NOT EXISTS shares INTEGER NULL,
  ADD COLUMN IF NOT EXISTS reach INTEGER NULL,
  ADD COLUMN IF NOT EXISTS impressions INTEGER NULL,
  ADD COLUMN IF NOT EXISTS saves INTEGER NULL,
  ADD COLUMN IF NOT EXISTS clicks INTEGER NULL,
  ADD COLUMN IF NOT EXISTS synced_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_marketing_post_analytics_platform_synced
  ON marketing_post_analytics (platform, synced_at DESC);

CREATE INDEX IF NOT EXISTS idx_marketing_post_analytics_post_id
  ON marketing_post_analytics (post_id);

CREATE TABLE IF NOT EXISTS marketing_attribution_events (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_type VARCHAR(50) NOT NULL,
  session_id TEXT NULL,
  source TEXT NULL,
  platform TEXT NULL,
  post_id BIGINT NULL REFERENCES marketing_posts(id) ON DELETE SET NULL,
  campaign TEXT NULL,
  product_id BIGINT NULL REFERENCES products(id) ON DELETE SET NULL,
  order_id BIGINT NULL REFERENCES orders(id) ON DELETE SET NULL,
  tracking_code TEXT NULL,
  tracking_link TEXT NULL,
  attribution_type TEXT NULL,
  referrer TEXT NULL,
  user_agent TEXT NULL,
  ip_address TEXT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE IF EXISTS marketing_attribution_events
  ADD COLUMN IF NOT EXISTS session_id TEXT NULL,
  ADD COLUMN IF NOT EXISTS source TEXT NULL,
  ADD COLUMN IF NOT EXISTS platform TEXT NULL,
  ADD COLUMN IF NOT EXISTS post_id BIGINT NULL,
  ADD COLUMN IF NOT EXISTS campaign TEXT NULL,
  ADD COLUMN IF NOT EXISTS product_id BIGINT NULL,
  ADD COLUMN IF NOT EXISTS order_id BIGINT NULL,
  ADD COLUMN IF NOT EXISTS tracking_code TEXT NULL,
  ADD COLUMN IF NOT EXISTS tracking_link TEXT NULL,
  ADD COLUMN IF NOT EXISTS attribution_type TEXT NULL,
  ADD COLUMN IF NOT EXISTS referrer TEXT NULL,
  ADD COLUMN IF NOT EXISTS user_agent TEXT NULL,
  ADD COLUMN IF NOT EXISTS ip_address TEXT NULL,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_marketing_attribution_events_tenant_created
  ON marketing_attribution_events (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_marketing_attribution_events_event_type
  ON marketing_attribution_events (event_type, created_at DESC);

CREATE TABLE IF NOT EXISTS ai_marketing_settings (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  planning_mode VARCHAR(20) NOT NULL DEFAULT 'weekly',
  stories_per_day INTEGER NOT NULL DEFAULT 20,
  posts_per_day INTEGER NOT NULL DEFAULT 3,
  auto_publish BOOLEAN NOT NULL DEFAULT FALSE,
  require_approval BOOLEAN NOT NULL DEFAULT TRUE,
  campaign_mode VARCHAR(20) NOT NULL DEFAULT 'balanced',
  active_strategies JSONB NOT NULL DEFAULT '{}'::jsonb,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  daily_content_quotas JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id)
);

ALTER TABLE IF EXISTS ai_marketing_settings
  ADD COLUMN IF NOT EXISTS tenant_id BIGINT,
  ADD COLUMN IF NOT EXISTS planning_mode VARCHAR(20) NOT NULL DEFAULT 'weekly',
  ADD COLUMN IF NOT EXISTS stories_per_day INTEGER NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS posts_per_day INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS auto_publish BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS require_approval BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS campaign_mode VARCHAR(20) NOT NULL DEFAULT 'balanced',
  ADD COLUMN IF NOT EXISTS active_strategies JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS daily_content_quotas JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_marketing_settings_tenant
  ON ai_marketing_settings (tenant_id);

CREATE TABLE IF NOT EXISTS ai_marketing_content_queue (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  content_type VARCHAR(20) NOT NULL DEFAULT 'story',
  strategy_type VARCHAR(60) NOT NULL DEFAULT 'random_discovery',
  department_id BIGINT NULL,
  department_name TEXT NOT NULL DEFAULT '',
  segment_type VARCHAR(80) NOT NULL DEFAULT '',
  segment_id BIGINT NULL,
  segment_name TEXT NOT NULL DEFAULT '',
  product_id BIGINT NULL REFERENCES products(id) ON DELETE SET NULL,
  variant_id BIGINT NULL REFERENCES product_variants(id) ON DELETE SET NULL,
  title TEXT NOT NULL DEFAULT '',
  caption TEXT NOT NULL DEFAULT '',
  image_url TEXT NOT NULL DEFAULT '',
  media_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
  primary_image_url TEXT NOT NULL DEFAULT '',
  variant_image_url TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '',
  size TEXT NOT NULL DEFAULT '',
  product_url TEXT NOT NULL DEFAULT '',
  design_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  status VARCHAR(30) NOT NULL DEFAULT 'generated',
  scheduled_at TIMESTAMP NULL,
  published_at TIMESTAMP NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE IF EXISTS ai_marketing_content_queue
  ADD COLUMN IF NOT EXISTS tenant_id BIGINT,
  ADD COLUMN IF NOT EXISTS content_type VARCHAR(20) NOT NULL DEFAULT 'story',
  ADD COLUMN IF NOT EXISTS strategy_type VARCHAR(60) NOT NULL DEFAULT 'random_discovery',
  ADD COLUMN IF NOT EXISTS department_id BIGINT NULL,
  ADD COLUMN IF NOT EXISTS department_name TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS segment_type VARCHAR(80) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS segment_id BIGINT NULL,
  ADD COLUMN IF NOT EXISTS segment_name TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS product_id BIGINT NULL,
  ADD COLUMN IF NOT EXISTS variant_id BIGINT NULL,
  ADD COLUMN IF NOT EXISTS title TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS caption TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS image_url TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS media_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS primary_image_url TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS variant_image_url TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS color TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS size TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS product_url TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS design_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS status VARCHAR(30) NOT NULL DEFAULT 'generated',
  ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMP NULL,
  ADD COLUMN IF NOT EXISTS published_at TIMESTAMP NULL,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS error_message TEXT NULL,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_ai_marketing_queue_tenant_status
  ON ai_marketing_content_queue (tenant_id, status, scheduled_at, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_marketing_queue_tenant_product_day
  ON ai_marketing_content_queue (tenant_id, product_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ai_marketing_generation_runs (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  run_type VARCHAR(20) NOT NULL DEFAULT 'daily',
  status VARCHAR(30) NOT NULL DEFAULT 'running',
  requested_stories INTEGER NOT NULL DEFAULT 0,
  requested_posts INTEGER NOT NULL DEFAULT 0,
  generated_stories INTEGER NOT NULL DEFAULT 0,
  generated_posts INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TIMESTAMP NULL
);

ALTER TABLE IF EXISTS ai_marketing_generation_runs
  ADD COLUMN IF NOT EXISTS tenant_id BIGINT,
  ADD COLUMN IF NOT EXISTS run_type VARCHAR(20) NOT NULL DEFAULT 'daily',
  ADD COLUMN IF NOT EXISTS status VARCHAR(30) NOT NULL DEFAULT 'running',
  ADD COLUMN IF NOT EXISTS requested_stories INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS requested_posts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS generated_stories INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS generated_posts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS failed_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS finished_at TIMESTAMP NULL;

CREATE INDEX IF NOT EXISTS idx_ai_marketing_runs_tenant_started
  ON ai_marketing_generation_runs (tenant_id, started_at DESC);

ALTER TABLE IF EXISTS orders
  ADD COLUMN IF NOT EXISTS marketing_source TEXT NULL,
  ADD COLUMN IF NOT EXISTS marketing_platform TEXT NULL,
  ADD COLUMN IF NOT EXISTS marketing_post_id BIGINT NULL,
  ADD COLUMN IF NOT EXISTS marketing_campaign TEXT NULL,
  ADD COLUMN IF NOT EXISTS attribution_type TEXT NULL,
  ADD COLUMN IF NOT EXISTS marketing_tracking_code TEXT NULL,
  ADD COLUMN IF NOT EXISTS marketing_session_id TEXT NULL;

CREATE TABLE IF NOT EXISTS marketing_settings (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE UNIQUE,
  provider VARCHAR(50) NOT NULL DEFAULT 'meta',
  page_id TEXT NOT NULL DEFAULT '',
  instagram_account_id TEXT NOT NULL DEFAULT '',
  access_token_encrypted TEXT NULL,
  long_lived_user_token TEXT NULL,
  page_access_token TEXT NULL,
  token_expires_at TIMESTAMP NULL,
  token_status VARCHAR(30) NOT NULL DEFAULT 'missing',
  token_last_validated_at TIMESTAMP NULL,
  last_auto_refresh_at TIMESTAMP NULL,
  next_refresh_check_at TIMESTAMP NULL,
  token_error_message TEXT NULL,
  is_connected BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE IF EXISTS marketing_settings
  ADD COLUMN IF NOT EXISTS long_lived_user_token TEXT NULL,
  ADD COLUMN IF NOT EXISTS page_access_token TEXT NULL,
  ADD COLUMN IF NOT EXISTS token_expires_at TIMESTAMP NULL,
  ADD COLUMN IF NOT EXISTS token_status VARCHAR(30) NOT NULL DEFAULT 'missing',
  ADD COLUMN IF NOT EXISTS token_last_validated_at TIMESTAMP NULL,
  ADD COLUMN IF NOT EXISTS last_auto_refresh_at TIMESTAMP NULL,
  ADD COLUMN IF NOT EXISTS next_refresh_check_at TIMESTAMP NULL,
  ADD COLUMN IF NOT EXISTS token_error_message TEXT NULL;
