-- Price Drop Alert ("نبّهني لو السعر نزل").
-- The server also creates this at boot (ensurePriceDropAlertSchema in
-- server/services/storefrontPriceDropAlertService.js); this file is the same DDL for a manual apply.
SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS storefront_price_alerts (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  customer_id BIGINT NULL,
  phone VARCHAR(80) NOT NULL,
  product_id BIGINT NOT NULL,
  via_button BOOLEAN NOT NULL DEFAULT FALSE,
  via_wishlist BOOLEAN NOT NULL DEFAULT FALSE,
  followed_price NUMERIC(12,2) NULL,
  reference_price NUMERIC(12,2) NULL,
  last_seen_price NUMERIC(12,2) NULL,
  last_notified_price NUMERIC(12,2) NULL,
  last_notified_at TIMESTAMPTZ NULL,
  notify_count INTEGER NOT NULL DEFAULT 0,
  checked_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, phone, product_id)
);

CREATE INDEX IF NOT EXISTS idx_storefront_price_alerts_active_product
  ON storefront_price_alerts (tenant_id, product_id)
  WHERE via_button OR via_wishlist;
