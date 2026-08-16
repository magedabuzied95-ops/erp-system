-- Agreement scoring: what the AI drafted vs what the employee actually sent.
--
-- Additive only: no existing table, column, index or row is removed or rewritten.
--
-- Why a new table rather than ai_reply_corrections: that one is filled by hand, when
-- an employee decides a reply was wrong enough to log. It records the failures someone
-- chose to report. Autonomy needs the denominator too — every draft, including the
-- ones sent unchanged — and a table only a human populates cannot provide it.
--
-- Deliberately NOT part of bootstrapStartup: a failing startup migration crash-loops
-- the backend, and a measurement table is never worth that risk. The recorder degrades
-- to a no-op when the table is absent, so nothing is coupled to this having been run.

CREATE TABLE IF NOT EXISTS ai_reply_agreement (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  conversation_id TEXT NOT NULL DEFAULT '',
  message_id TEXT NOT NULL DEFAULT '',
  channel TEXT NOT NULL DEFAULT '',
  -- Both texts are kept, not just the score. A rate tells you something is wrong; only
  -- the pair tells you what, and re-scoring old replies under a changed metric is
  -- impossible without them.
  draft_text TEXT NOT NULL DEFAULT '',
  sent_text TEXT NOT NULL DEFAULT '',
  similarity NUMERIC(6, 4) NULL,
  verdict TEXT NOT NULL DEFAULT '',
  -- What the system believed about the draft at the time, so agreement can be read
  -- against confidence: a high-confidence draft that gets rewritten is a different
  -- problem from a low-confidence one that does.
  confidence_score NUMERIC(6, 2) NULL,
  auto_send_eligible BOOLEAN NULL,
  generation_source TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_ai_reply_agreement_tenant
  ON ai_reply_agreement (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_reply_agreement_verdict
  ON ai_reply_agreement (tenant_id, verdict, created_at DESC);
-- One row per sent message: the send path can retry, and a duplicate would inflate
-- whichever verdict happened to be retried.
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_reply_agreement_message
  ON ai_reply_agreement (tenant_id, message_id)
  WHERE message_id <> '';
