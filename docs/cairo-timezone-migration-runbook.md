# Cairo timezone migration — production runbook

Moves the database off naive timestamps and onto real instants, then onto the Cairo calendar.

## What this fixes

`CURRENT_DATE` and `created_at::date` resolved at **midnight UTC**, which is 02:00 or 03:00 in
Cairo. A sale rung up at 01:30 was stored `22:30` the previous day and counted on the previous day
by every report, every shift close and every "today" KPI in the system.

After this, the day boundary is Cairo midnight. Nothing else about the system changes — display was
already correct and stays correct.

## What it does NOT do

It does **not** move any row in time. Each naive value is *declared* as the UTC it always meant, so
the instant is preserved exactly. `verifyTimestamptzMigration.js` proves this over every column.

It does **not** touch:

| Type | Why |
|---|---|
| `date` columns (`attendance_date`, `business_date`, `expense_date`) | already a calendar day |
| `time` columns (shift start/end, publish windows) | a wall clock by nature; no instant to preserve |
| columns already `timestamptz` | nothing to do |

## Before you start

- **Take a full backup.** This rewrites 650+ columns. Without a backup it is not reversible.
- **Schedule a window.** Converting takes an `ACCESS EXCLUSIVE` lock per table — the application
  must be stopped. On the development dataset it took ~25 seconds; production is larger, so budget
  generously and measure on a restored copy first.
- **Confirm the database is in UTC.** The whole conversion rests on this. The migration refuses to
  run otherwise, but check first so you find out before the window, not during it:

```bash
psql "$DATABASE_URL" -c "SHOW timezone;"
```

## Steps

**1. Rehearse on a restored copy.** Not optional for a change this wide.

```bash
createdb erp_rehearsal && pg_restore -d erp_rehearsal /path/to/backup.dump
```

**2. Fingerprint every timestamp column** (sums the epoch of every value, so any shift shows up):

```bash
PGDATABASE=erp_rehearsal node server/scripts/verifyTimestamptzMigration.js --before
```

**3. Stop the application.**

```bash
pm2 stop all
```

**4. Run the migration.**

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f server/database/migrations/2026-08-31-timestamptz-cairo.sql
```

It prints `timestamptz migration: converted N column(s)`. It is one transaction: if anything fails,
nothing is applied.

**5. Verify no row moved.** This is the gate — do not continue if it fails.

```bash
PGDATABASE=erp_rehearsal node server/scripts/verifyTimestamptzMigration.js --after
```

Expect `PASS — every instant survived and every column is an instant`. Anything else: restore the
backup and stop.

**6. Deploy the application code**, which pins each connection to `Africa/Cairo` and stops creating
naive columns. The migration and the code go together — deploying either alone leaves the day
boundary half-fixed.

**7. Restart.** `ALTER DATABASE … SET timezone` only reaches **new** sessions, so pooled
connections keep the old zone until they are re-established.

```bash
pm2 restart all
```

**8. Confirm.**

```bash
psql "$DATABASE_URL" -c "SHOW timezone;"                    # Africa/Cairo
psql "$DATABASE_URL" -c "SELECT CURRENT_DATE, NOW();"        # today's Cairo date
```

Then in the app: open today's sales and confirm a late-night order appears on the day it was rung
up rather than the day before.

## The one thing that must not change

**Leave the server process on UTC.** `TZ=Africa/Cairo` on the container looks like it belongs with
this change and does the opposite of what you want: `timestamptz` values are immune to it, but
node-postgres parses a bare `date` at *local* midnight, so `attendance_date = 2026-08-31` would
serialise as `2026-08-30T21:00:00Z` and every date-only field in the API would read a day early.

Cairo belongs on the database session, never on the process clock. `server/database/db.js` logs a
warning at boot if it finds a non-UTC `TZ`, and `tests/cairo-timezone.test.js` guards it.

## Rollback

There is no reverse migration — restore the backup. Converting back would need the same care in the
other direction, and by then new rows would have been written that the old schema cannot represent
unambiguously.

If you must undo only the *reading* lens without touching the data, the day boundary reverts to UTC
with:

```sql
ALTER DATABASE <db> SET timezone TO 'UTC';
```

…and unset `PGTIMEZONE` (or set it to `UTC`) for the application. The columns stay `timestamptz`,
which is correct regardless; only the calendar the reports use moves back.

## Related

- `server/database/migrations/2026-08-31-timestamptz-cairo.sql` — the migration
- `server/scripts/verifyTimestamptzMigration.js` — the before/after proof
- `tests/cairo-timezone.test.js` — guards the fix against being undone
- `src/shared/lib/appTimezone.js` — the entry/display side, unchanged by this
