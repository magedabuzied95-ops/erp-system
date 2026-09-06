-- Products page + POS: a re-bought product must come back to the TOP of the list.
--
-- Both lists sorted by products.id DESC, which is creation order. Buying more of a
-- product that already exists keeps its original id, so a fresh restock stayed buried
-- at the bottom next to items nobody has touched in months. last_stocked_at records
-- the last time stock actually came IN, and the lists sort on that instead.
--
-- The DEFAULT backfills every existing row with one identical timestamp (Postgres 11+
-- stores it as a missing value, so there is no table rewrite), which means the current
-- order is preserved exactly: old rows tie on the timestamp and fall back to id DESC.
--
-- The server also applies this ALTER lazily via ensureProductSchema()/ensurePurchaseCreateSchema(),
-- but running it here first keeps the ACCESS EXCLUSIVE lock off the request path.

SET lock_timeout = '5s';

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS last_stocked_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_products_last_stocked_at
  ON products (last_stocked_at DESC, id DESC);
