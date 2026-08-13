ALTER TABLE ai_inbox_quick_replies
  ADD COLUMN IF NOT EXISTS shortcut VARCHAR(4);

WITH tenant_max AS (
  SELECT tenant_id, COALESCE(MAX(CASE WHEN shortcut ~ '^[0-9]+$' THEN shortcut::integer END), 0) AS max_shortcut
  FROM ai_inbox_quick_replies
  GROUP BY tenant_id
), ranked AS (
  SELECT replies.id,
    (COALESCE(tenant_max.max_shortcut, 0) + ROW_NUMBER() OVER (PARTITION BY replies.tenant_id ORDER BY replies.sort_order ASC, replies.id ASC))::text AS generated_shortcut
  FROM ai_inbox_quick_replies AS replies
  LEFT JOIN tenant_max ON tenant_max.tenant_id = replies.tenant_id
  WHERE replies.shortcut IS NULL OR BTRIM(replies.shortcut) = ''
)
UPDATE ai_inbox_quick_replies AS replies
SET shortcut = ranked.generated_shortcut
FROM ranked
WHERE replies.id = ranked.id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_inbox_quick_replies_tenant_shortcut
  ON ai_inbox_quick_replies (tenant_id, shortcut)
  WHERE shortcut IS NOT NULL;
