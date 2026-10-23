-- CRM stage references reuse the existing sequence engine and its enrollment table.
-- Legacy keys apply across pipelines; crm:<id> targets one tenant-scoped stage.
BEGIN;
ALTER TABLE crm_stage_history DROP CONSTRAINT IF EXISTS crm_stage_history_source_check;
ALTER TABLE crm_stage_history ADD CONSTRAINT crm_stage_history_source_check
  CHECK (source IN ('manual','inbox','auto','migration','sequence'));
CREATE INDEX IF NOT EXISTS message_sequences_crm_stage_trigger
  ON message_sequences(tenant_id,trigger_stage) WHERE is_active AND trigger_type='lead_stage';
CREATE UNIQUE INDEX IF NOT EXISTS crm_activity_request
  ON staff_task_assignments(tenant_id,source_ref_type,source_ref_id)
  WHERE source_module='crm' AND source_ref_type='crm_opportunity_activity';
CREATE INDEX IF NOT EXISTS crm_activity_opportunity
  ON staff_task_assignments(tenant_id,(metadata->>'crm_opportunity_id'),id DESC) WHERE source_module='crm';
COMMENT ON COLUMN message_sequences.trigger_stage IS 'Legacy inbox stage key or crm:<crm_stages.id>; tenant scope validated by sequence service';
COMMENT ON COLUMN message_sequences.move_to_if_replied IS 'Optional legacy inbox stage key or crm:<crm_stages.id>';
COMMENT ON COLUMN message_sequences.move_to_if_no_reply IS 'Optional legacy inbox stage key or crm:<crm_stages.id>';
COMMIT;
