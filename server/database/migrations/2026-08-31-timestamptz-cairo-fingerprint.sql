-- Fingerprint every timestamp column, so the Cairo migration can be proven to have moved nothing.
--
--   psql -v phase=before -f this.sql      (before the migration)
--   psql -v phase=after  -f this.sql      (after it)
--   psql -f this.sql -c "…"               (see the comparison query at the foot)
--
-- For each column it records the row count, the non-null count and the sum of every value's epoch
-- seconds. A three-hour shift on even one row changes the sum, so an unchanged fingerprint is
-- proof the conversion preserved every instant.
--
-- Naive columns are read `AT TIME ZONE 'UTC'` — the same declaration the migration makes — so the
-- before and after numbers are directly comparable.

CREATE TABLE IF NOT EXISTS _tz_fingerprint (
  phase        text    NOT NULL,
  table_name   text    NOT NULL,
  column_name  text    NOT NULL,
  data_type    text    NOT NULL,
  row_count    bigint  NOT NULL,
  non_null     bigint  NOT NULL,
  epoch_sum    numeric NOT NULL,
  taken_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (phase, table_name, column_name)
);

-- One source for the phase name: a custom GUC the DO block below can read too, since a psql
-- variable is not visible inside PL/pgSQL.
SET tz.phase = :'phase';

DELETE FROM _tz_fingerprint WHERE phase = current_setting('tz.phase');

DO $fingerprint$
DECLARE
  r         record;
  reader    text;
  scanned   integer := 0;
BEGIN
  FOR r IN
    SELECT c.relname AS tbl, a.attname AS col, format_type(a.atttypid, NULL) AS ty
    FROM pg_attribute a
    JOIN pg_class c     ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND NOT c.relispartition
      AND a.attnum > 0
      AND NOT a.attisdropped
      AND a.atttypid IN ('timestamp without time zone'::regtype, 'timestamptz'::regtype)
      AND c.relname <> '_tz_fingerprint'
    ORDER BY c.relname, a.attname
  LOOP
    -- A naive column is declared UTC, exactly as the migration declares it. An instant needs no
    -- declaration. If the two agree afterwards, nothing moved.
    reader := CASE
      WHEN r.ty = 'timestamp without time zone' THEN format('(%I AT TIME ZONE ''UTC'')', r.col)
      ELSE format('%I', r.col)
    END;
    EXECUTE format(
      'INSERT INTO _tz_fingerprint (phase, table_name, column_name, data_type, row_count, non_null, epoch_sum)
       SELECT %L, %L, %L, %L, count(*), count(%I), COALESCE(SUM(FLOOR(EXTRACT(EPOCH FROM %s)))::numeric, 0)
       FROM public.%I',
      current_setting('tz.phase'), r.tbl, r.col, r.ty, r.col, reader, r.tbl
    );
    scanned := scanned + 1;
  END LOOP;
  RAISE NOTICE 'fingerprint(%): % columns', current_setting('tz.phase'), scanned;
END
$fingerprint$;

-- The verdict. Empty result = every instant survived.
--
--   SELECT b.table_name, b.column_name, b.epoch_sum AS before, a.epoch_sum AS after,
--          (a.epoch_sum - b.epoch_sum) / GREATEST(a.non_null, 1) / 3600 AS hours_per_row
--   FROM _tz_fingerprint b
--   JOIN _tz_fingerprint a USING (table_name, column_name)
--   WHERE b.phase = 'before' AND a.phase = 'after'
--     AND (b.epoch_sum <> a.epoch_sum OR b.non_null <> a.non_null OR b.row_count <> a.row_count);
