-- Move the whole database onto real instants, then onto Cairo time.
--
-- WHY
-- ---
-- Every `timestamp without time zone` column holds a naive wall clock that the application has
-- always *meant* as UTC. Nothing in the database says so, which is why the day boundary is wrong
-- everywhere: `CURRENT_DATE` and `created_at::date` resolve at midnight UTC, i.e. 02:00/03:00 in
-- Cairo. A sale rung up at 01:30 Cairo on the 31st is stored `2026-08-30 22:30` and counted on
-- the 30th, by every report, every shift close and every "today" KPI in the system.
--
-- The naive fix — pointing the server clock at Cairo — makes it worse, not better: the stored
-- text stays `2026-08-30 22:30` but now *means* 22:30 Cairo, so that same sale reads as 10:30 PM
-- on the 30th. Every historic row silently moves three hours and the archive becomes a lie.
--
-- So: convert each column to `timestamptz`, declaring the existing values as UTC. That records
-- the instant each row always meant, changing no row's actual moment. Only then is it safe to put
-- the database on Africa/Cairo, because a timestamptz is an absolute instant and `CURRENT_DATE`,
-- `::date` and every comparison resolve in the session zone — correctly, for old rows and new.
--
-- WHAT IS NOT TOUCHED
-- -------------------
--   * `date` columns (attendance_date, business_date, expense_date …) — already a calendar day.
--   * `time` columns (shift start/end, publish windows …) — a wall clock by nature, no instant.
--   * columns already `timestamptz`.
--
-- BEFORE RUNNING
-- --------------
--   1. Take a full backup. This rewrites 600+ columns and is not reversible without one.
--   2. Stop the application. Converting takes an ACCESS EXCLUSIVE lock per table.
--   3. Confirm the guard below passes — it refuses to run unless the database is in UTC, because
--      that is the assumption the whole conversion rests on.
--   4. Restart the application afterwards: `ALTER DATABASE … SET timezone` only reaches NEW
--      sessions, so pooled connections keep the old zone until they are re-established.

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. The interlock.
--
-- If this database has not been running in UTC then its naive values do not mean UTC, and
-- declaring them as UTC would shift every row by the difference. Better to stop here than to
-- discover that in next month's payroll.
-- ---------------------------------------------------------------------------
DO $guard$
DECLARE
  session_tz text := current_setting('TimeZone');
BEGIN
  IF upper(session_tz) NOT IN ('UTC', 'ETC/UTC', 'GMT', 'UCT', 'UNIVERSAL', 'ZULU') THEN
    RAISE EXCEPTION
      'Refusing to convert: this migration reads existing naive timestamps as UTC, but the database timezone is %. Verify what the stored values actually mean before running.',
      session_tz;
  END IF;
END
$guard$;

-- ---------------------------------------------------------------------------
-- 1. Stash the views.
--
-- A view that selects a column blocks ALTER COLUMN TYPE on it, so they are dropped and rebuilt
-- around the conversion. Captured from the catalogue rather than hardcoded: production may carry
-- views this development database does not.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE _tz_views ON COMMIT DROP AS
SELECT
  c.oid                                   AS view_oid,
  n.nspname                               AS schema_name,
  c.relname                               AS view_name,
  rtrim(btrim(pg_get_viewdef(c.oid, true)), ';') AS view_def,
  pg_get_userbyid(c.relowner)             AS view_owner
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind = 'v'
  AND n.nspname = 'public';

DO $drop_views$
DECLARE
  v record;
BEGIN
  -- Newest first: a view built on another view is dropped before the one it depends on.
  FOR v IN SELECT * FROM _tz_views ORDER BY view_oid DESC LOOP
    EXECUTE format('DROP VIEW IF EXISTS %I.%I CASCADE', v.schema_name, v.view_name);
  END LOOP;
END
$drop_views$;

-- ---------------------------------------------------------------------------
-- 2. Convert every naive timestamp column to a real instant.
--
-- `USING col AT TIME ZONE 'UTC'` reads the stored wall clock as UTC and stores the instant it
-- denotes. No row's actual moment changes; the database simply stops guessing at it.
--
-- Re-runnable: a column already converted is no longer selected.
-- ---------------------------------------------------------------------------
DO $convert$
DECLARE
  r record;
  converted integer := 0;
BEGIN
  FOR r IN
    SELECT c.relname AS table_name, a.attname AS column_name
    FROM pg_attribute a
    JOIN pg_class c     ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      -- Ordinary and partitioned tables only. Partitions inherit the parent's ALTER, and a
      -- direct ALTER on one would fail.
      AND c.relkind IN ('r', 'p')
      AND NOT c.relispartition
      AND a.attnum > 0
      AND NOT a.attisdropped
      AND a.atttypid = 'timestamp without time zone'::regtype
    ORDER BY c.relname, a.attname
  LOOP
    EXECUTE format(
      'ALTER TABLE public.%I ALTER COLUMN %I TYPE timestamptz USING %I AT TIME ZONE ''UTC''',
      r.table_name, r.column_name, r.column_name
    );
    converted := converted + 1;
  END LOOP;
  RAISE NOTICE 'timestamptz migration: converted % column(s)', converted;
END
$convert$;

-- ---------------------------------------------------------------------------
-- 3. Rebuild the views.
--
-- Oldest first, the reverse of the drop order. Ownership is restored; any GRANTs on a view are
-- not, so re-apply them if this database grants view access to a role other than the owner.
-- ---------------------------------------------------------------------------
DO $recreate_views$
DECLARE
  v record;
BEGIN
  FOR v IN SELECT * FROM _tz_views ORDER BY view_oid ASC LOOP
    EXECUTE format('CREATE OR REPLACE VIEW %I.%I AS %s', v.schema_name, v.view_name, v.view_def);
    EXECUTE format('ALTER VIEW %I.%I OWNER TO %I', v.schema_name, v.view_name, v.view_owner);
  END LOOP;
END
$recreate_views$;

-- ---------------------------------------------------------------------------
-- 4. Put the database on Cairo time.
--
-- Now that every column is an instant this is purely a reading lens: `NOW()`, `CURRENT_DATE`,
-- `::date` and every range comparison resolve against the Cairo calendar, for rows written last
-- year as much as for rows written next week. Egypt's summer (+03) and winter (+02) both follow
-- from the zone, which is why the zone name is used and never a fixed offset.
--
-- Only affects sessions opened after this runs — hence the application restart.
-- ---------------------------------------------------------------------------
DO $set_tz$
BEGIN
  EXECUTE format('ALTER DATABASE %I SET timezone TO %L', current_database(), 'Africa/Cairo');
END
$set_tz$;

COMMIT;
