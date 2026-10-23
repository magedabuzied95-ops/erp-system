-- Sales channel analytics (2026-10-24).
--
-- storefront_traffic_sessions holds one row per storefront visit with the source it came
-- from (channel + medium, classified by shared/trafficSource.js) and whether it added to
-- the cart. orders.traffic_* carries the session an order was placed in, so the sales
-- channels report (/reports/channels) can credit orders and revenue to a source.
--
-- Idempotent. ensureTrafficSchema() in server/modules/channelAnalytics/channelAnalytics.js
-- runs the same statements once per boot (the house pattern), so this file is the record
-- rather than the gate.
CREATE TABLE IF NOT EXISTS storefront_traffic_sessions (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  session_key TEXT NOT NULL,
  visitor_key TEXT NOT NULL DEFAULT '',
  channel TEXT NOT NULL,
  medium TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT '',
  campaign TEXT NOT NULL DEFAULT '',
  utm_source TEXT NOT NULL DEFAULT '',
  utm_medium TEXT NOT NULL DEFAULT '',
  utm_campaign TEXT NOT NULL DEFAULT '',
  utm_content TEXT NOT NULL DEFAULT '',
  utm_term TEXT NOT NULL DEFAULT '',
  click_id_type TEXT NOT NULL DEFAULT '',
  referrer_host TEXT NOT NULL DEFAULT '',
  landing_path TEXT NOT NULL DEFAULT '',
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cart_added_at TIMESTAMPTZ NULL,
  cart_adds INTEGER NOT NULL DEFAULT 0,
  UNIQUE (tenant_id, session_key)
);
CREATE INDEX IF NOT EXISTS idx_storefront_traffic_sessions_tenant_started
  ON storefront_traffic_sessions (tenant_id, started_at);
ALTER TABLE IF EXISTS orders
  ADD COLUMN IF NOT EXISTS traffic_session_key TEXT NULL,
  ADD COLUMN IF NOT EXISTS traffic_channel TEXT NULL,
  ADD COLUMN IF NOT EXISTS traffic_medium TEXT NULL,
  ADD COLUMN IF NOT EXISTS traffic_source TEXT NULL,
  ADD COLUMN IF NOT EXISTS traffic_campaign TEXT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_tenant_traffic_created
  ON orders (tenant_id, created_at)
  WHERE traffic_channel IS NOT NULL;
