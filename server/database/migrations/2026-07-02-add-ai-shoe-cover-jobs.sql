ALTER TABLE IF EXISTS product_variant_images
  ADD COLUMN IF NOT EXISTS generated_by_ai BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS ai_shoe_cover_jobs (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  variant_id BIGINT NULL REFERENCES product_variants(id) ON DELETE SET NULL,
  target_type TEXT NOT NULL DEFAULT 'product',
  target_key TEXT NOT NULL DEFAULT 'product',
  product_type TEXT NOT NULL DEFAULT '',
  source_image_url TEXT NOT NULL DEFAULT '',
  source_image_hash TEXT NOT NULL DEFAULT '',
  generated_image_url TEXT NOT NULL DEFAULT '',
  generated_image_hash TEXT NOT NULL DEFAULT '',
  ai_cover_image_id BIGINT NULL REFERENCES product_variant_images(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT NOT NULL DEFAULT '',
  queued_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TIMESTAMP NULL,
  generated_at TIMESTAMP NULL,
  completed_at TIMESTAMP NULL,
  next_retry_at TIMESTAMP NULL,
  last_requested_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_shoe_cover_jobs_target_unique
  ON ai_shoe_cover_jobs (tenant_id, product_id, target_type, target_key);

CREATE INDEX IF NOT EXISTS idx_ai_shoe_cover_jobs_status_retry
  ON ai_shoe_cover_jobs (status, next_retry_at, updated_at, id);

CREATE INDEX IF NOT EXISTS idx_ai_shoe_cover_jobs_product
  ON ai_shoe_cover_jobs (tenant_id, product_id, updated_at DESC, id DESC);
