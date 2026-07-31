ALTER TABLE purchases
  ADD COLUMN IF NOT EXISTS branch_id BIGINT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'purchases_branch_id_fkey'
      AND conrelid = 'purchases'::regclass
  ) THEN
    ALTER TABLE purchases
      ADD CONSTRAINT purchases_branch_id_fkey
      FOREIGN KEY (branch_id)
      REFERENCES branches(id)
      ON DELETE SET NULL;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_purchases_tenant_branch_created
  ON purchases (tenant_id, branch_id, created_at DESC);

UPDATE purchases p
SET branch_id = (
  SELECT b.id
  FROM branches b
  WHERE b.tenant_id = p.tenant_id
    AND LOWER(TRIM(b.name)) IN (LOWER('البشبيشي'), LOWER('فرع البشبيشي'))
  ORDER BY b.id ASC
  LIMIT 1
)
WHERE p.branch_id IS NULL
  AND EXISTS (
    SELECT 1
    FROM branches b
    WHERE b.tenant_id = p.tenant_id
      AND LOWER(TRIM(b.name)) IN (LOWER('البشبيشي'), LOWER('فرع البشبيشي'))
  );
