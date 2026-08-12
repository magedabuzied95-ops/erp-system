-- AI Studio Phase 11 — Live Assisted AI Inbox Rollout. Additive only.
-- Per-channel assisted enablement for staged rollout (default '{}' = all channels OFF). Mirrors
-- ensureInboundIntakeSchema in aiInboundIntakeService.js. Send-side outcomes (approved/stale) are recorded
-- in the existing ai_inbound_intake_log via recordAssistedOutcome (no schema change — outcome is free TEXT).
ALTER TABLE ai_workflow_tenant_settings ADD COLUMN IF NOT EXISTS inbound_ai_channels JSONB NOT NULL DEFAULT '{}'::jsonb;
