#!/usr/bin/env bash
# Monthly proof that the off-host backup can actually be restored.
#
# A backup nobody has restored is a guess. This pulls the newest database set back FROM
# THE REMOTE (not the local copy, which dies with the host), checks its SHA256SUMS,
# restores the ERP database into a throwaway Postgres container with no network and no
# published port, and compares row counts on the tables the business runs on against
# production. Production is only read. The scratch container and files are removed.
#
# Usage: erp-restore-test.sh            newest daily set
#        erp-restore-test.sh <set-id>   a specific set, e.g. 20260915-030001
set -Eeuo pipefail

ENV_FILE="${ERP_BACKUP_ENV_FILE:-/etc/erp-backup.env}"
# shellcheck disable=SC1090
[[ -f "$ENV_FILE" ]] && source "$ENV_FILE"

PG_CONTAINER="${PG_CONTAINER:-erp-postgres}"
PG_USER="${PG_USER:-erp_user}"
PG_DATABASE="${PG_DATABASE:-erp_production}"
REMOTE="${ERP_BACKUP_REMOTE:?ERP_BACKUP_REMOTE is required}"
HEALTHCHECK_URL="${ERP_RESTORE_TEST_HEALTHCHECK_URL:-}"
LOG="${ERP_BACKUP_LOG:-/var/log/erp-backup.log}"
# A set is up to a day old, so production may have moved on; a table that SHRANK or
# lost more than this share of rows means the dump is incomplete.
MAX_MISSING_SHARE="${ERP_RESTORE_TEST_MAX_MISSING_SHARE:-0.05}"
TABLES=(orders order_items products product_variants customers money_transactions inventory_movements ai_support_messages users)

WORK="$(mktemp -d /tmp/erp-restore-test.XXXXXX)"
SCRATCH="erp-restore-test-$$"

log() { echo "$(date -Is) [restore-test] $*" | tee -a "$LOG"; }
ping_healthcheck() {
  [[ -n "$HEALTHCHECK_URL" ]] || return 0
  curl -fsS -m 15 --retry 3 "$HEALTHCHECK_URL$1" >/dev/null 2>&1 || true
}
cleanup() {
  docker rm -f "$SCRATCH" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT
trap 'log "FAILED at line $LINENO"; ping_healthcheck "/fail"' ERR

ping_healthcheck "/start"
SET="${1:-$(rclone lsf --dirs-only "${REMOTE}db/daily" | sed 's#/$##' | sort | tail -n 1)}"
[[ -n "$SET" ]]
log "testing set $SET"

rclone copy "${REMOTE}db/daily/$SET" "$WORK" --log-level NOTICE --log-file "$LOG"
( cd "$WORK" && sha256sum -c SHA256SUMS --quiet )
log "checksums ok"

IMAGE="$(cat "$WORK/postgres-image.txt" 2>/dev/null || docker inspect -f '{{.Config.Image}}' "$PG_CONTAINER")"
docker run -d --name "$SCRATCH" --network none -e POSTGRES_PASSWORD=restore-test \
  -v "$WORK:/restore:ro" "$IMAGE" >/dev/null
for _ in $(seq 1 60); do
  docker exec "$SCRATCH" pg_isready -U postgres >/dev/null 2>&1 && break
  sleep 2
done
docker exec "$SCRATCH" pg_isready -U postgres >/dev/null

docker exec "$SCRATCH" createdb -U postgres restored
# --exit-on-error: the old restoreDb.sh piped into psql without ON_ERROR_STOP and printed
# "Restore completed." over any number of errors.
docker exec "$SCRATCH" pg_restore -U postgres -d restored --no-owner --no-privileges --exit-on-error \
  "/restore/$PG_DATABASE.dump"
log "restore ok"

count() { # container user database table
  docker exec "$1" psql -U "$2" -d "$3" -Atc "SELECT COUNT(*) FROM public.\"$4\"" 2>/dev/null || echo "missing"
}

failed=0
for table in "${TABLES[@]}"; do
  live="$(count "$PG_CONTAINER" "$PG_USER" "$PG_DATABASE" "$table")"
  restored="$(count "$SCRATCH" postgres restored "$table")"
  if [[ "$live" == "missing" ]]; then
    log "skip $table (not in production)"
    continue
  fi
  if [[ "$restored" == "missing" ]]; then
    log "FAIL $table missing from the restore (production has $live rows)"
    failed=1
    continue
  fi
  if awk -v l="$live" -v r="$restored" -v s="$MAX_MISSING_SHARE" 'BEGIN { exit !(l > 0 && (l - r) / l > s) }'; then
    log "FAIL $table restored=$restored production=$live"
    failed=1
  else
    log "ok   $table restored=$restored production=$live"
  fi
done

if [[ "$failed" -ne 0 ]]; then
  log "RESTORE TEST FAILED for set $SET"
  ping_healthcheck "/fail"
  exit 1
fi
log "RESTORE TEST PASSED for set $SET"
ping_healthcheck ""
