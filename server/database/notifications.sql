CREATE TABLE IF NOT EXISTS notifications (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NULL,
  user_id BIGINT NULL,
  role_key VARCHAR(120) NULL,
  branch_id BIGINT NULL,
  type VARCHAR(120) NOT NULL,
  category VARCHAR(80) NOT NULL DEFAULT 'system',
  priority VARCHAR(20) NOT NULL DEFAULT 'medium',
  title TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  action_url TEXT NULL,
  action_label VARCHAR(160) NULL,
  entity_type VARCHAR(120) NULL,
  entity_id VARCHAR(160) NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  read_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT notifications_priority_check CHECK (priority IN ('low', 'medium', 'high', 'critical'))
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications (user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_branch_id ON notifications (branch_id);
CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON notifications (is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_priority ON notifications (priority);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_entity ON notifications (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_notifications_tenant_created ON notifications (tenant_id, created_at DESC);
