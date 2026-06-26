CREATE TABLE IF NOT EXISTS customer_otps (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  phone TEXT NOT NULL,
  otp_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  attempts_count INTEGER NOT NULL DEFAULT 0,
  used BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_customer_otps_tenant_phone ON customer_otps (tenant_id, phone);
CREATE INDEX IF NOT EXISTS idx_customer_otps_expires_at ON customer_otps (expires_at);
