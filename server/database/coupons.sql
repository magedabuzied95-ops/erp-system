CREATE TABLE IF NOT EXISTS coupon_campaigns (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NULL,
  name VARCHAR(255) NOT NULL,
  code_prefix VARCHAR(40) NOT NULL,
  discount_type VARCHAR(20) NOT NULL CHECK (discount_type IN ('percentage', 'fixed')),
  discount_value NUMERIC(12,2) NOT NULL DEFAULT 0,
  minimum_order_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  max_discount_amount NUMERIC(12,2),
  usage_limit_per_coupon INTEGER NOT NULL DEFAULT 1,
  total_coupons INTEGER NOT NULL DEFAULT 0,
  starts_at TIMESTAMP NULL,
  expires_at TIMESTAMP NULL,
  channel VARCHAR(20) NOT NULL DEFAULT 'all' CHECK (channel IN ('offline', 'website', 'pos', 'all')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by BIGINT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS coupons (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NULL,
  campaign_id BIGINT NOT NULL REFERENCES coupon_campaigns(id) ON DELETE CASCADE,
  code VARCHAR(80) NOT NULL UNIQUE,
  qr_value TEXT NOT NULL,
  usage_count INTEGER NOT NULL DEFAULT 0,
  usage_limit INTEGER NOT NULL DEFAULT 1,
  assigned_customer_id BIGINT NULL,
  used_by_customer_id BIGINT NULL,
  used_order_id BIGINT NULL,
  used_at TIMESTAMP NULL,
  expires_at TIMESTAMP NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS coupon_redemptions (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NULL,
  coupon_id BIGINT NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
  campaign_id BIGINT NOT NULL REFERENCES coupon_campaigns(id) ON DELETE CASCADE,
  order_id BIGINT NULL,
  customer_id BIGINT NULL,
  source VARCHAR(20) NOT NULL CHECK (source IN ('pos', 'website', 'manual')),
  order_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  final_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  used_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS coupon_id BIGINT NULL;
ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS coupon_code VARCHAR(80);
ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS coupon_discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_coupon_campaigns_tenant ON coupon_campaigns (tenant_id);
CREATE INDEX IF NOT EXISTS idx_coupon_campaigns_active ON coupon_campaigns (is_active);
CREATE INDEX IF NOT EXISTS idx_coupon_campaigns_expires ON coupon_campaigns (expires_at);
CREATE INDEX IF NOT EXISTS idx_coupons_campaign_id ON coupons (campaign_id);
CREATE INDEX IF NOT EXISTS idx_coupons_code ON coupons (code);
CREATE INDEX IF NOT EXISTS idx_coupons_active ON coupons (is_active);
CREATE INDEX IF NOT EXISTS idx_coupons_expires ON coupons (expires_at);
CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_campaign_id ON coupon_redemptions (campaign_id);
CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_coupon_id ON coupon_redemptions (coupon_id);
