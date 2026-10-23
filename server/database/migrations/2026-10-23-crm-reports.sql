BEGIN;
INSERT INTO permissions(module,action,description) VALUES
  ('crm','reports','View CRM conversion, ownership and source reports within the permitted scope'),
  ('crm','export','Export permitted CRM reports')
ON CONFLICT (module,action) DO NOTHING;
CREATE INDEX IF NOT EXISTS crm_history_stage_cohort
  ON crm_stage_history(tenant_id,to_stage_id,opportunity_id,occurred_at);
CREATE INDEX IF NOT EXISTS crm_opportunity_created_cohort
  ON ai_lead_opportunities(tenant_id,created_at,id) WHERE stage_id IS NOT NULL;
COMMIT;
