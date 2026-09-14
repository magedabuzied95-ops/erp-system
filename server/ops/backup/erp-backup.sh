#!/usr/bin/env bash
# Nightly ERP backup: every database in the Postgres container, checked, copied off the host.
#
# Before this, the only backups were dumps on the same disk as the database (deploy's
# pre-deploy dump and the product-image mirror). A dead disk, a deleted droplet or a
# ransomware wipe took the database and every copy of it at once.
#
# What it does, in order, stopping at the first failure:
#   1. pg_dump -Fc of each non-template database in $PG_CONTAINER (plus roles, best effort)
#   2. pg_restore --list on each dump, so a truncated file fails HERE and not on restore day
#   3. sha256 of every file
#   4. copy the set off the host with rclone (never `sync`: a local deletion never deletes remotely)
#   5. copy uploads (product images, payment proofs, chat media) off the host, copy-only
#   6. rotate: local 7 days; remote daily 35 days, first-of-month sets kept 400 days
#   7. record success and ping $ERP_BACKUP_HEALTHCHECK_URL, so a backup that STOPS running alerts
#
# Config comes from /etc/erp-backup.env (see README.md). Nothing here touches the running app.
set -Eeuo pipefail

ENV_FILE="${ERP_BACKUP_ENV_FILE:-/etc/erp-backup.env}"
# shellcheck disable=SC1090
[[ -f "$ENV_FILE" ]] && source "$ENV_FILE"

PG_CONTAINER="${PG_CONTAINER:-erp-postgres}"
PG_USER="${PG_USER:-erp_user}"
LOCAL_DIR="${ERP_BACKUP_LOCAL_DIR:-/opt/erp/backups/nightly}"
UPLOADS_DIR="${ERP_UPLOADS_DIR:-/opt/erp/uploads}"
REMOTE="${ERP_BACKUP_REMOTE:-}"               # e.g. erp-backup:  (an rclone remote, ideally a crypt remote)
HEALTHCHECK_URL="${ERP_BACKUP_HEALTHCHECK_URL:-}"
LOCAL_KEEP_DAYS="${ERP_BACKUP_LOCAL_KEEP_DAYS:-7}"
REMOTE_DAILY_KEEP_DAYS="${ERP_BACKUP_REMOTE_DAILY_KEEP_DAYS:-35}"
REMOTE_MONTHLY_KEEP_DAYS="${ERP_BACKUP_REMOTE_MONTHLY_KEEP_DAYS:-400}"
# Pre-deploy dumps pile up in /opt/erp/backups with every deploy and nothing rotates them.
PREDEPLOY_KEEP_DAYS="${ERP_BACKUP_PREDEPLOY_KEEP_DAYS:-14}"
PREDEPLOY_KEEP_NEWEST="${ERP_BACKUP_PREDEPLOY_KEEP_NEWEST:-10}"
LOG="${ERP_BACKUP_LOG:-/var/log/erp-backup.log}"

STAMP="$(date +%Y%m%d-%H%M%S)"
SET_DIR="$LOCAL_DIR/$STAMP"
STARTED_AT="$(date +%s)"

log() { echo "$(date -Is) $*" | tee -a "$LOG"; }

ping_healthcheck() {
  [[ -n "$HEALTHCHECK_URL" ]] || return 0
  curl -fsS -m 15 --retry 3 "$HEALTHCHECK_URL$1" >/dev/null 2>&1 || log "WARN healthcheck ping failed ($1)"
}

on_error() {
  log "FAILED at line $1 (set: $SET_DIR)"
  ping_healthcheck "/fail"
}
trap 'on_error $LINENO' ERR

exec 9>"${ERP_BACKUP_LOCK:-/var/lock/erp-backup.lock}"
if ! flock -n 9; then
  log "another backup is still running, skipping"
  exit 0
fi

ping_healthcheck "/start"
log "backup start set=$STAMP container=$PG_CONTAINER remote=${REMOTE:-<none>}"

docker inspect -f '{{.State.Running}}' "$PG_CONTAINER" | grep -q true
mkdir -p "$SET_DIR"
chmod 700 "$LOCAL_DIR" "$SET_DIR"

# 1-2. Dump and verify each database.
mapfile -t DATABASES < <(docker exec "$PG_CONTAINER" psql -U "$PG_USER" -d postgres -Atc \
  "SELECT datname FROM pg_database WHERE NOT datistemplate AND datallowconn ORDER BY datname")
[[ ${#DATABASES[@]} -gt 0 ]]

for database in "${DATABASES[@]}"; do
  dump="$SET_DIR/$database.dump"
  docker exec "$PG_CONTAINER" pg_dump -U "$PG_USER" -d "$database" -Fc --no-owner > "$dump"
  docker exec -i "$PG_CONTAINER" pg_restore --list > /dev/null < "$dump"
  log "dumped $database $(du -h "$dump" | cut -f1)"
done

# Roles and grants need a superuser; a restore still works without them (--no-owner).
if docker exec "$PG_CONTAINER" pg_dumpall -U "$PG_USER" --globals-only > "$SET_DIR/globals.sql" 2>/dev/null; then
  log "dumped roles"
else
  rm -f "$SET_DIR/globals.sql"
  log "WARN roles not dumped ($PG_USER is not a superuser); restore with --no-owner"
fi

docker inspect -f '{{.Config.Image}}' "$PG_CONTAINER" > "$SET_DIR/postgres-image.txt"

# 3. Checksums.
( cd "$SET_DIR" && sha256sum -- * > SHA256SUMS )

# 6a. Local rotation (the set just written is never older than a day).
find "$LOCAL_DIR" -mindepth 1 -maxdepth 1 -type d -mtime +"$LOCAL_KEEP_DAYS" -exec rm -rf {} +
if compgen -G "/opt/erp/backups/pre-deploy-db-*.sql.gz" > /dev/null; then
  ls -1t /opt/erp/backups/pre-deploy-db-*.sql.gz | tail -n +"$((PREDEPLOY_KEEP_NEWEST + 1))" | while read -r old; do
    if [[ -n "$(find "$old" -mtime +"$PREDEPLOY_KEEP_DAYS")" ]]; then
      rm -f -- "$old"
      log "rotated $old"
    fi
  done
fi

if [[ -z "$REMOTE" ]]; then
  log "WARN ERP_BACKUP_REMOTE is not set: this set exists ONLY on this host"
  ping_healthcheck "/fail"
  exit 1
fi
command -v rclone > /dev/null

# 4. Database set off the host. Monthly sets go to their own prefix with a longer life.
rclone copy "$SET_DIR" "${REMOTE}db/daily/$STAMP" --checksum --log-level NOTICE --log-file "$LOG"
if [[ "$(date +%d)" == "01" ]]; then
  rclone copy "$SET_DIR" "${REMOTE}db/monthly/$STAMP" --checksum --log-level NOTICE --log-file "$LOG"
fi
remote_files="$(rclone lsf "${REMOTE}db/daily/$STAMP" | wc -l)"
local_files="$(find "$SET_DIR" -maxdepth 1 -type f | wc -l)"
[[ "$remote_files" -eq "$local_files" ]]
log "db set uploaded files=$remote_files"

# 5. Uploads, copy-only: a file deleted here (by a bug or by hand) survives remotely.
if [[ -d "$UPLOADS_DIR" ]]; then
  rclone copy "$UPLOADS_DIR" "${REMOTE}uploads" --size-only --transfers 8 --log-level NOTICE --log-file "$LOG"
  log "uploads copied"
fi

# 6b. Remote rotation, database sets only. Uploads are never deleted remotely.
rclone delete "${REMOTE}db/daily" --min-age "${REMOTE_DAILY_KEEP_DAYS}d" --log-level NOTICE --log-file "$LOG"
rclone delete "${REMOTE}db/monthly" --min-age "${REMOTE_MONTHLY_KEEP_DAYS}d" --log-level NOTICE --log-file "$LOG"
rclone rmdirs "${REMOTE}db" --leave-root --log-level NOTICE --log-file "$LOG" || true

# 7. Record success.
SECONDS_TAKEN=$(( $(date +%s) - STARTED_AT ))
printf '{"set":"%s","finished_at":"%s","seconds":%s,"databases":"%s"}\n' \
  "$STAMP" "$(date -Is)" "$SECONDS_TAKEN" "${DATABASES[*]}" > "$LOCAL_DIR/last-success.json"
log "backup ok set=$STAMP seconds=$SECONDS_TAKEN"
ping_healthcheck ""
