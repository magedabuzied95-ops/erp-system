-- Semantic product search (pgvector).
--
-- Additive only: no existing table, column, index or row is removed or rewritten.
--
-- This file does NOT install pgvector. `CREATE EXTENSION` needs superuser on most
-- managed Postgres, so it stays a deliberate DBA step:
--
--     CREATE EXTENSION IF NOT EXISTS vector;
--
-- Everything below is written so that running it BEFORE the extension exists is
-- harmless and running it after is complete. The application detects the extension at
-- runtime and falls back to lexical retrieval when it is absent, so no deploy is
-- coupled to this migration having been applied.
--
-- Deliberately NOT part of bootstrapStartup: a migration that can fail on a fresh or
-- partially-provisioned database would crash-loop the backend, and a search
-- improvement is never worth that risk.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
    RAISE NOTICE 'pgvector is not installed; skipping embedding column and index. Run: CREATE EXTENSION IF NOT EXISTS vector;';
    RETURN;
  END IF;

  -- 1536 dimensions matches text-embedding-3-small, the cheapest OpenAI embedding
  -- model. Changing the model means changing this and re-embedding: a vector column
  -- has a fixed width and mixed-width rows cannot be compared.
  EXECUTE 'ALTER TABLE products ADD COLUMN IF NOT EXISTS embedding vector(1536)';
  EXECUTE 'ALTER TABLE products ADD COLUMN IF NOT EXISTS embedding_model VARCHAR(64)';
  EXECUTE 'ALTER TABLE products ADD COLUMN IF NOT EXISTS embedding_updated_at TIMESTAMP NULL';
  -- The exact text that was embedded. Without it there is no way to know which rows
  -- are stale after a name or description edit, short of re-embedding the catalog.
  EXECUTE 'ALTER TABLE products ADD COLUMN IF NOT EXISTS embedding_source_hash VARCHAR(64)';

  -- IVFFlat over cosine distance. `lists` is a bucket count: too high on a small
  -- catalog and recall collapses, so 100 suits catalogs in the low tens of thousands.
  -- The index is only useful once rows are populated — building it on an empty table
  -- produces a poor partitioning — but creating it early is harmless and idempotent.
  EXECUTE 'CREATE INDEX IF NOT EXISTS idx_products_embedding
           ON products USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)';

  -- Finding rows that still need embedding must not scan the whole catalog.
  EXECUTE 'CREATE INDEX IF NOT EXISTS idx_products_embedding_pending
           ON products (tenant_id) WHERE embedding IS NULL';
END
$$;
