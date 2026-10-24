-- Run outside a transaction: preserve writes while repairing existing installs.
-- The inbox looks up origin posts by tenant + commenter for every candidate.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_social_comment_automation_runs_tenant_commenter
  ON social_comment_automation_runs (tenant_id, commenter_id, created_at DESC);
