-- Additive CRM foundation with idempotent lead backfill. Never sends messages.
BEGIN;

-- Definitions only. Staff access is explicitly granted in the existing registry.
INSERT INTO permissions(module,action,description) VALUES
  ('crm','view','View CRM opportunities within the permitted scope'),
  ('crm','create','Create CRM opportunities'),
  ('crm','edit','Edit CRM opportunities within the permitted scope'),
  ('crm','manage','Manage CRM pipelines and stages')
ON CONFLICT (module,action) DO NOTHING;

CREATE TABLE IF NOT EXISTS crm_pipelines (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS crm_one_default_pipeline
  ON crm_pipelines(tenant_id) WHERE is_default;

CREATE TABLE IF NOT EXISTS crm_stages (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  pipeline_id BIGINT NOT NULL,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  legacy_key TEXT CHECK (legacy_key IN ('new','contacted','interested','negotiation','won','lost')),
  sequence INTEGER NOT NULL DEFAULT 10,
  color TEXT NOT NULL DEFAULT '#64748b' CHECK (color ~ '^#[0-9a-fA-F]{6}$'),
  is_won BOOLEAN NOT NULL DEFAULT FALSE,
  is_lost BOOLEAN NOT NULL DEFAULT FALSE,
  is_archived BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (NOT (is_won AND is_lost)),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, pipeline_id, id),
  FOREIGN KEY (tenant_id,pipeline_id) REFERENCES crm_pipelines(tenant_id,id)
);
CREATE UNIQUE INDEX IF NOT EXISTS crm_stage_legacy_key
  ON crm_stages(tenant_id,pipeline_id,legacy_key) WHERE legacy_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS crm_stages_order ON crm_stages(tenant_id,pipeline_id,sequence,id);

INSERT INTO crm_pipelines(tenant_id,name,is_default)
SELECT id,'Sales',TRUE FROM tenants
ON CONFLICT (tenant_id) WHERE is_default DO NOTHING;

INSERT INTO crm_stages(tenant_id,pipeline_id,name,legacy_key,sequence,color,is_won,is_lost)
SELECT p.tenant_id,p.id,s.name,s.key,s.sequence,s.color,s.won,s.lost
FROM crm_pipelines p
CROSS JOIN (VALUES
  ('New','new',10,'#0ea5e9',FALSE,FALSE),
  ('Contacted','contacted',20,'#06b6d4',FALSE,FALSE),
  ('Interested','interested',30,'#f59e0b',FALSE,FALSE),
  ('Negotiation','negotiation',40,'#8b5cf6',FALSE,FALSE),
  ('Won','won',50,'#10b981',TRUE,FALSE),
  ('Lost','lost',60,'#f43f5e',FALSE,TRUE)
) AS s(name,key,sequence,color,won,lost)
WHERE p.is_default
ON CONFLICT (tenant_id,pipeline_id,legacy_key) WHERE legacy_key IS NOT NULL DO NOTHING;

-- Existing opportunities remain the deal entity. Existing rows remain untouched.
ALTER TABLE ai_lead_opportunities ADD COLUMN IF NOT EXISTS customer_id BIGINT;
ALTER TABLE ai_lead_opportunities ADD COLUMN IF NOT EXISTS pipeline_id BIGINT;
ALTER TABLE ai_lead_opportunities ADD COLUMN IF NOT EXISTS stage_id BIGINT;
ALTER TABLE ai_lead_opportunities ADD COLUMN IF NOT EXISTS expected_revenue NUMERIC(18,2);
ALTER TABLE ai_lead_opportunities ADD COLUMN IF NOT EXISTS probability NUMERIC(5,2);
ALTER TABLE ai_lead_opportunities ADD COLUMN IF NOT EXISTS priority SMALLINT;
ALTER TABLE ai_lead_opportunities ADD COLUMN IF NOT EXISTS expected_closing DATE;
ALTER TABLE ai_lead_opportunities ADD COLUMN IF NOT EXISTS assigned_user_id BIGINT;
ALTER TABLE ai_lead_opportunities ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE ai_lead_opportunities ALTER COLUMN profile_id DROP NOT NULL;
ALTER TABLE ai_lead_opportunities ADD COLUMN IF NOT EXISTS channel_conversation_id BIGINT;
CREATE UNIQUE INDEX IF NOT EXISTS crm_primary_conversation
  ON ai_lead_opportunities(tenant_id,channel_conversation_id) WHERE channel_conversation_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS crm_opportunity_tenant_id
  ON ai_lead_opportunities(tenant_id,id);
CREATE INDEX IF NOT EXISTS crm_opportunity_board
  ON ai_lead_opportunities(tenant_id,pipeline_id,stage_id,updated_at DESC,id DESC);

CREATE OR REPLACE FUNCTION crm_default_opportunity_stage() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.stage_id IS NULL THEN
    SELECT p.id,s.id INTO NEW.pipeline_id,NEW.stage_id FROM crm_pipelines p JOIN crm_stages s
      ON s.tenant_id=p.tenant_id AND s.pipeline_id=p.id
      AND s.legacy_key=CASE WHEN NEW.status IN ('won','lost') THEN NEW.status ELSE 'new' END
      WHERE p.tenant_id=NEW.tenant_id AND p.is_default LIMIT 1;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS crm_default_opportunity_trigger ON ai_lead_opportunities;
CREATE TRIGGER crm_default_opportunity_trigger BEFORE INSERT ON ai_lead_opportunities
FOR EACH ROW EXECUTE FUNCTION crm_default_opportunity_stage();

CREATE TABLE IF NOT EXISTS crm_stage_history (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  opportunity_id BIGINT NOT NULL,
  from_stage_id BIGINT,
  to_stage_id BIGINT NOT NULL,
  actor_user_id BIGINT,
  source TEXT NOT NULL CHECK (source IN ('manual','inbox','auto','migration')),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY(tenant_id,opportunity_id) REFERENCES ai_lead_opportunities(tenant_id,id),
  FOREIGN KEY(tenant_id,from_stage_id) REFERENCES crm_stages(tenant_id,id),
  FOREIGN KEY(tenant_id,to_stage_id) REFERENCES crm_stages(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS crm_history_opportunity
  ON crm_stage_history(tenant_id,opportunity_id,occurred_at,id);

CREATE OR REPLACE FUNCTION crm_record_stage_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.stage_id IS NOT NULL AND (TG_OP='INSERT' OR OLD.stage_id IS DISTINCT FROM NEW.stage_id) THEN
    INSERT INTO crm_stage_history(tenant_id,opportunity_id,from_stage_id,to_stage_id,actor_user_id,source)
    VALUES(NEW.tenant_id,NEW.id,CASE WHEN TG_OP='UPDATE' THEN OLD.stage_id ELSE NULL END,NEW.stage_id,
      NULLIF(current_setting('m1.crm_actor',true),'')::bigint,
      COALESCE(NULLIF(current_setting('m1.crm_source',true),''),'auto'));
    IF TG_OP='UPDATE' AND NULLIF(NEW.conversation_id,'') IS NOT NULL
      AND to_regclass('message_sequence_enrollments') IS NOT NULL THEN
      UPDATE message_sequence_enrollments e SET status='stopped',stopped_reason='stage_changed',
        finished_at=NOW(),locked_at=NULL,updated_at=NOW()
      FROM message_sequences s WHERE s.id=e.sequence_id AND s.tenant_id=NEW.tenant_id
        AND e.tenant_id=NEW.tenant_id AND e.session_id=NEW.conversation_id
        AND e.status='active' AND s.trigger_type='lead_stage';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS crm_stage_history_trigger ON ai_lead_opportunities;
CREATE TRIGGER crm_stage_history_trigger AFTER INSERT OR UPDATE OF stage_id ON ai_lead_opportunities
FOR EACH ROW EXECUTE FUNCTION crm_record_stage_history();

-- All existing inbox writers (staff, automatic stage and sequences) converge here.
-- This trigger never enrolls a sequence or sends a message.
CREATE OR REPLACE FUNCTION crm_sync_inbox_lead() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE sid bigint; pid bigint; oid bigint; session_key text; details jsonb; stage_key text;
BEGIN
  IF current_setting('m1.crm_skip_sync',true)='1' THEN RETURN NEW; END IF;
  stage_key := COALESCE(NULLIF(NEW.lead_status,''),'new');
  IF NOT (COALESCE(NEW.metadata,'{}'::jsonb) ? 'crm_lead'
      OR COALESCE(NEW.metadata,'{}'::jsonb) ? 'campaign_lead' OR stage_key <> 'new') THEN RETURN NEW; END IF;
  session_key := CASE WHEN NEW.external_conversation_id LIKE NEW.channel || ':%'
    THEN NEW.external_conversation_id ELSE NEW.channel || ':' || NEW.external_conversation_id END;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_id::text || ':' || session_key,0));
  SELECT p.id,s.id INTO pid,sid FROM crm_pipelines p JOIN crm_stages s
    ON s.pipeline_id=p.id AND s.tenant_id=p.tenant_id AND s.legacy_key=stage_key
    WHERE p.tenant_id=NEW.tenant_id AND p.id=COALESCE(
      (SELECT pipeline_id FROM ai_lead_opportunities WHERE tenant_id=NEW.tenant_id
        AND (channel_conversation_id=NEW.id OR conversation_id=session_key) ORDER BY id LIMIT 1),
      (SELECT id FROM crm_pipelines WHERE tenant_id=NEW.tenant_id AND is_default LIMIT 1)) LIMIT 1;
  IF sid IS NULL THEN RETURN NEW; END IF;
  details := COALESCE(NEW.metadata->'crm_lead_details','{}'::jsonb);
  SELECT id INTO oid FROM ai_lead_opportunities
    WHERE tenant_id=NEW.tenant_id AND (channel_conversation_id=NEW.id OR
      conversation_id=session_key OR
      (channel_conversation_id IS NULL AND conversation_id=NEW.external_conversation_id AND source_key=NEW.channel))
    ORDER BY (channel_conversation_id IS NOT NULL) DESC,id LIMIT 1 FOR UPDATE;
  IF oid IS NULL THEN
    INSERT INTO ai_lead_opportunities(tenant_id,profile_id,conversation_id,source_key,title,pipeline_id,stage_id,channel_conversation_id,status)
    VALUES(NEW.tenant_id,NEW.customer_profile_id,session_key,'crm',COALESCE(NULLIF(details->>'lead_name',''),NULLIF(NEW.customer_name,''),session_key),pid,sid,NEW.id,
      CASE WHEN stage_key IN ('won','lost') THEN stage_key ELSE 'open' END)
    ON CONFLICT DO NOTHING
    RETURNING id INTO oid;
    IF oid IS NULL THEN SELECT id INTO oid FROM ai_lead_opportunities WHERE tenant_id=NEW.tenant_id
      AND (channel_conversation_id=NEW.id OR conversation_id=session_key) ORDER BY id LIMIT 1; END IF;
  END IF;
  UPDATE ai_lead_opportunities SET channel_conversation_id=NEW.id,conversation_id=session_key,
    status=CASE WHEN stage_id IS NOT NULL AND ((TG_OP='UPDATE' AND OLD.lead_status IS NOT DISTINCT FROM NEW.lead_status)
      OR (TG_OP='INSERT' AND stage_key='new')) THEN status
      WHEN stage_key IN ('won','lost') THEN stage_key ELSE 'open' END,
    pipeline_id=COALESCE(pipeline_id,pid),
    stage_id=CASE WHEN stage_id IS NULL OR (TG_OP='UPDATE' AND OLD.lead_status IS DISTINCT FROM NEW.lead_status)
      OR (TG_OP='INSERT' AND stage_key<>'new') THEN sid ELSE stage_id END,
    title=COALESCE(NULLIF(details->>'lead_name',''),NULLIF(title,''),NEW.customer_name,session_key),
    expected_revenue=CASE WHEN details ? 'expected_revenue' AND details->>'expected_revenue' IS NULL THEN NULL
      WHEN details->>'expected_revenue' ~ '^[0-9]{1,12}([.][0-9]{1,2})?$' THEN (details->>'expected_revenue')::numeric ELSE expected_revenue END,
    expected_closing=CASE WHEN details ? 'expected_closing' AND COALESCE(details->>'expected_closing','')='' THEN NULL
      WHEN details->>'expected_closing' ~ '^[1-9][0-9]{3}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$' THEN
        CASE WHEN to_char(to_date(details->>'expected_closing','YYYY-MM-DD'),'YYYY-MM-DD')=details->>'expected_closing'
          THEN to_date(details->>'expected_closing','YYYY-MM-DD') ELSE expected_closing END ELSE expected_closing END,
    priority=CASE WHEN details->>'priority' ~ '^[0-5]$' THEN (details->>'priority')::smallint ELSE priority END,
    notes=COALESCE(details->>'notes',notes),
    metadata=metadata || jsonb_build_object('crm_lead_details',details),version=version+1,updated_at=NOW()
    WHERE tenant_id=NEW.tenant_id AND id=oid;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS crm_sync_inbox_trigger ON ai_channel_conversations;
CREATE TRIGGER crm_sync_inbox_trigger AFTER INSERT OR UPDATE OF lead_status,metadata ON ai_channel_conversations
FOR EACH ROW EXECUTE FUNCTION crm_sync_inbox_lead();

-- Backfill using the same trigger without editing the conversation data.
-- Ambiguous legacy deals require review; never merge distinct records silently.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM ai_channel_conversations c JOIN ai_lead_opportunities o ON o.tenant_id=c.tenant_id
      AND o.channel_conversation_id IS NULL AND NULLIF(o.conversation_id,'') IS NOT NULL
      AND o.conversation_id=c.external_conversation_id AND o.source_key<>c.channel
      AND c.external_conversation_id NOT LIKE c.channel || ':%'
    WHERE COALESCE(c.metadata,'{}'::jsonb) ? 'crm_lead'
      OR COALESCE(c.metadata,'{}'::jsonb) ? 'campaign_lead' OR COALESCE(c.lead_status,'new') <> 'new'
  ) THEN RAISE EXCEPTION 'CRM backfill stopped: a bare legacy conversation has unverified channel attribution';
  END IF;
  IF EXISTS (
    SELECT c.id FROM ai_channel_conversations c JOIN ai_lead_opportunities o
      ON o.tenant_id=c.tenant_id AND (o.channel_conversation_id=c.id OR
        (o.channel_conversation_id IS NULL AND (o.conversation_id=CASE
          WHEN c.external_conversation_id LIKE c.channel || ':%' THEN c.external_conversation_id
          ELSE c.channel || ':' || c.external_conversation_id END OR
          (o.conversation_id=c.external_conversation_id AND o.source_key=c.channel))))
    WHERE COALESCE(c.metadata,'{}'::jsonb) ? 'crm_lead'
      OR COALESCE(c.metadata,'{}'::jsonb) ? 'campaign_lead' OR COALESCE(c.lead_status,'new') <> 'new'
    GROUP BY c.tenant_id,c.id HAVING count(*) > 1
  ) THEN RAISE EXCEPTION 'CRM backfill stopped: multiple legacy opportunities match a conversation; review before migration';
  END IF;
END $$;

UPDATE ai_channel_conversations SET lead_status=lead_status
WHERE (COALESCE(metadata,'{}'::jsonb) ? 'crm_lead' OR COALESCE(metadata,'{}'::jsonb) ? 'campaign_lead'
  OR COALESCE(lead_status,'new') <> 'new')
  AND NOT EXISTS (SELECT 1 FROM ai_lead_opportunities o
    WHERE o.tenant_id=ai_channel_conversations.tenant_id AND o.channel_conversation_id=ai_channel_conversations.id);

UPDATE ai_lead_opportunities o SET pipeline_id=p.id,stage_id=s.id
FROM crm_pipelines p JOIN crm_stages s ON s.tenant_id=p.tenant_id AND s.pipeline_id=p.id
WHERE o.tenant_id=p.tenant_id AND p.is_default AND o.stage_id IS NULL
  AND s.legacy_key=CASE WHEN o.status IN ('won','lost') THEN o.status ELSE 'new' END;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='ai_lead_opportunities'::regclass AND conname='crm_opportunity_stage_scope') THEN
    ALTER TABLE ai_lead_opportunities ADD CONSTRAINT crm_opportunity_stage_scope
      FOREIGN KEY (tenant_id,pipeline_id,stage_id) REFERENCES crm_stages(tenant_id,pipeline_id,id);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS crm_primary_session
  ON ai_lead_opportunities(tenant_id,conversation_id) WHERE channel_conversation_id IS NOT NULL;

COMMIT;
