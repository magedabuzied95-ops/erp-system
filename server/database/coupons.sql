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

ALTER TABLE IF EXISTS coupon_campaigns ADD COLUMN IF NOT EXISTS applies_to_shipping BOOLEAN NOT NULL DEFAULT FALSE;

-- Phase 1: rules engine
ALTER TABLE IF EXISTS coupon_campaigns ADD COLUMN IF NOT EXISTS usage_limit_per_customer INTEGER NULL;
ALTER TABLE IF EXISTS coupon_campaigns ADD COLUMN IF NOT EXISTS scope JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE IF EXISTS coupon_campaigns ADD COLUMN IF NOT EXISTS stack_policy VARCHAR(30) NOT NULL DEFAULT 'all';
ALTER TABLE IF EXISTS coupon_campaigns ADD COLUMN IF NOT EXISTS budget_cap NUMERIC(12,2) NULL;
ALTER TABLE IF EXISTS coupon_campaigns ADD COLUMN IF NOT EXISTS first_order_only BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE IF EXISTS coupon_campaigns DROP CONSTRAINT IF EXISTS coupon_campaigns_discount_type_check;
ALTER TABLE IF EXISTS coupon_campaigns ADD CONSTRAINT coupon_campaigns_discount_type_check CHECK (discount_type IN ('percentage', 'fixed', 'free_shipping'));
ALTER TABLE IF EXISTS coupon_redemptions ADD COLUMN IF NOT EXISTS reversed_at TIMESTAMP NULL;
ALTER TABLE IF EXISTS coupon_redemptions ADD COLUMN IF NOT EXISTS reversal_reason VARCHAR(80);
CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_customer ON coupon_redemptions (campaign_id, customer_id);

-- Phase 3: shared codes + customer assignment
ALTER TABLE IF EXISTS coupon_campaigns ADD COLUMN IF NOT EXISTS code_mode VARCHAR(10) NOT NULL DEFAULT 'unique';
ALTER TABLE IF EXISTS coupon_campaigns ADD COLUMN IF NOT EXISTS shared_code VARCHAR(80);
ALTER TABLE IF EXISTS coupons ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMP NULL;
CREATE INDEX IF NOT EXISTS idx_coupons_assigned_customer ON coupons (assigned_customer_id);

-- Phase 3.1: auto-issue a coupon after a customer's first order
ALTER TABLE IF EXISTS coupon_campaigns ADD COLUMN IF NOT EXISTS auto_issue_on_first_order BOOLEAN NOT NULL DEFAULT FALSE;

-- Phase 3.2: track the send, so an assigned-but-unsent coupon can be surfaced
ALTER TABLE IF EXISTS coupons ADD COLUMN IF NOT EXISTS sent_at TIMESTAMP NULL;
ALTER TABLE IF EXISTS coupons ADD COLUMN IF NOT EXISTS sent_by BIGINT NULL;
CREATE INDEX IF NOT EXISTS idx_coupons_pending_send ON coupons (campaign_id) WHERE assigned_customer_id IS NOT NULL AND sent_at IS NULL;

-- Phase 3.3: expiry reminder for a coupon that was sent but never used
ALTER TABLE IF EXISTS coupons ADD COLUMN IF NOT EXISTS reminded_at TIMESTAMP NULL;

-- Phase 4: the coupon printed at the foot of a till receipt
ALTER TABLE IF EXISTS coupon_campaigns ADD COLUMN IF NOT EXISTS print_on_receipt BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE IF EXISTS coupons ADD COLUMN IF NOT EXISTS issued_order_id BIGINT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_coupons_issued_order ON coupons (issued_order_id) WHERE issued_order_id IS NOT NULL;
