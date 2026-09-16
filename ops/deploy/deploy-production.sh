#!/usr/bin/env bash
#
# M1 ERP — Safe Production Deploy (backend-only, with pre-deploy DB backup,
# persistent logging, read-only smoke tests, and automatic CODE rollback).
#
# Policy (do NOT change without explicit approval):
#   - The production PostgreSQL database is NEVER automatically restored,
#     dropped, or overwritten by this script. A pre-deploy backup is always
#     taken; on failure the script reports its path and STOPS.
#   - Only the erp-backend service is rebuilt/recreated. Postgres, Redis,
#     staging, evolution-api, wppconnect and the channel gateway are untouched.
#   - Source of truth is GitHub origin/main.
#
set -Eeuo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
SRC="/opt/apps/erp-system"                 # git checkout = docker build context
COMPOSE="/opt/erp/docker-compose.yml"      # production compose file
SERVICE="erp-backend"                      # the ONLY service this script touches
IMAGE_REF="erp-erp-backend:latest"         # image tag compose expects for the service
DB_CONTAINER="erp-postgres"
REDIS_CONTAINER="erp-redis"
HEALTH="http://127.0.0.1:8000/health"
API_ROOT="http://127.0.0.1:8000/"
FRONTEND_INDEX="/app/dist/index.html"      # SPA built into the backend image
BACKUP_DIR="/opt/erp/backups"
LOG_DIR="/opt/erp/logs"
LOCK_FILE="/var/lock/m1-erp-production-deploy.lock"

TS="$(date +%Y%m%d-%H%M%S)"
LOG_FILE="$LOG_DIR/deploy-$TS.log"
DB_BACKUP="$BACKUP_DIR/pre-deploy-db-$TS.sql.gz"
ROLLBACK_TAG="erp-backend:rollback-$TS"

mkdir -p "$LOG_DIR" "$BACKUP_DIR"

# Persist everything (stdout+stderr) to a timestamped deploy log.
exec > >(tee -a "$LOG_FILE") 2>&1

log() { echo "[$(date +%H:%M:%S)] $*"; }

# Redact anything that could resemble a credential before it hits the log
# (e.g. a DATABASE_URL printed inside a backend stack trace).
redact() {
  sed -E \
    -e 's#(postgres(ql)?://[^:@/]+:)[^@]*@#\1***REDACTED***@#Ig' \
    -e 's#(PASSWORD|SECRET|TOKEN|APIKEY|API_KEY|JWT_SECRET)([=: ]+)[^ ,;"]+#\1\2***REDACTED***#Ig'
}

# Keep only the newest 5 timestamped rollback images. Only rollback-YYYYMMDD-HHMMSS
# tags count: hand-made tags (rollback-pre-*, rollback-before-*) sort AFTER the
# digits under sort -r and used to take the kept slots, so the tag this very
# deploy had just saved was the one deleted.
cleanup_old_rollbacks() {
  docker images erp-backend --format '{{.Repository}}:{{.Tag}}' \
    | grep -E '^erp-backend:rollback-[0-9]{8}-[0-9]{6}$' \
    | sort -r \
    | tail -n +6 \
    | xargs -r docker image rm >/dev/null 2>&1 || true
}

# Every build leaves layers in the builder cache (68 GB had piled up by
# 2026-09-16). Keep a week so rebuilds stay fast; drop replaced images.
cleanup_build_leftovers() {
  docker builder prune -af --filter until=168h >/dev/null 2>&1 || true
  docker image prune -f >/dev/null 2>&1 || true
}

container_running() {
  [ "$(docker inspect -f '{{.State.Running}}' "$1" 2>/dev/null || echo false)" = "true" ]
}

# ---------------------------------------------------------------------------
# Read-only smoke tests (no data mutation, no test orders/customers/payments)
# ---------------------------------------------------------------------------
run_smoke_tests() {
  local ok=1

  # 1. API health endpoint
  local hbody
  hbody="$(curl -sS "$HEALTH" 2>/dev/null || true)"
  if printf '%s' "$hbody" | grep -q '"status":"ok"'; then
    log "SMOKE  api /health          : OK"
  else
    log "SMOKE  api /health          : FAIL"; ok=0
  fi

  # 2. API root responds
  local acode
  acode="$(curl -sS -o /dev/null -w '%{http_code}' "$API_ROOT" 2>/dev/null || true)"
  if [ "$acode" = "200" ]; then
    log "SMOKE  api /                : OK (HTTP 200)"
  else
    log "SMOKE  api /                : FAIL (HTTP $acode)"; ok=0
  fi

  # 3. Frontend bundle built into and served from the running image
  if docker exec "$SERVICE" test -s "$FRONTEND_INDEX" 2>/dev/null; then
    log "SMOKE  frontend build        : OK ($FRONTEND_INDEX present)"
  else
    log "SMOKE  frontend build        : FAIL ($FRONTEND_INDEX missing/empty)"; ok=0
  fi

  # 4-6. Core containers running (read-only inspect)
  local c
  for c in "$SERVICE" "$DB_CONTAINER" "$REDIS_CONTAINER"; do
    if container_running "$c"; then
      log "SMOKE  container $c : running"
    else
      log "SMOKE  container $c : NOT running"; ok=0
    fi
  done

  [ "$ok" = "1" ]
}

wait_for_health() {
  local i code
  for i in $(seq 1 30); do
    code="$(curl -sS -o /dev/null -w '%{http_code}' "$HEALTH" 2>/dev/null || true)"
    if [ "$code" = "200" ]; then return 0; fi
    log "  waiting for health $i/30 (last HTTP ${code:-none})..."
    sleep 2
  done
  return 1
}

# ---------------------------------------------------------------------------
# Deploy lock
# ---------------------------------------------------------------------------
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  log "ABORT: another production deploy is already running."
  exit 1
fi

log "======================================================================"
log "M1 ERP SAFE PRODUCTION DEPLOY"
log "Timestamp : $TS"
log "Log file  : $LOG_FILE"
log "======================================================================"

cd "$SRC"

# ---------------------------------------------------------------------------
# [1/9] Pre-deploy health
# ---------------------------------------------------------------------------
log "[1/9] Verify production is healthy BEFORE deploy"
PRE_CODE="$(curl -sS -o /dev/null -w '%{http_code}' "$HEALTH" 2>/dev/null || true)"
if [ "$PRE_CODE" != "200" ]; then
  log "ABORT: production not healthy before deploy (HTTP ${PRE_CODE:-none}). Nothing changed."
  exit 1
fi
log "      pre-deploy health: HTTP 200"

# ---------------------------------------------------------------------------
# [2/9] Branch + clean tree + fetch
# ---------------------------------------------------------------------------
log "[2/9] Verify branch is main and working tree is clean"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [ "$BRANCH" != "main" ]; then
  log "ABORT: source checkout is on '$BRANCH', not 'main'. Nothing changed."
  exit 1
fi

git fetch origin main

if [ -n "$(git status --porcelain)" ]; then
  log "ABORT: source working tree is dirty. Nothing changed."
  git status --short
  exit 1
fi
log "      branch=main, tree clean"

# ---------------------------------------------------------------------------
# [3/9] Identify commits
# ---------------------------------------------------------------------------
log "[3/9] Identify commits"
PREV_COMMIT="$(git rev-parse --short HEAD)"
TARGET_COMMIT="$(git rev-parse --short origin/main)"
log "      current/source commit : $PREV_COMMIT"
log "      target origin/main     : $TARGET_COMMIT"
if [ "$PREV_COMMIT" = "$TARGET_COMMIT" ]; then
  log "      note: source already at target commit (rebuild will still run)."
fi

# ---------------------------------------------------------------------------
# [4/9] Verify compose build context
# ---------------------------------------------------------------------------
log "[4/9] Verify compose build context"
CONTEXT="$(docker compose -f "$COMPOSE" config | awk '/context:/ {print $2; exit}')"
if [ "$CONTEXT" != "$SRC" ]; then
  log "ABORT: unexpected build context: '$CONTEXT' (expected '$SRC'). Nothing changed."
  exit 1
fi
log "      build context: $CONTEXT"

# ---------------------------------------------------------------------------
# [5/9] Save rollback image (previous running image)
# ---------------------------------------------------------------------------
log "[5/9] Save rollback image from currently running backend"
OLD_IMAGE="$(docker inspect "$SERVICE" --format '{{.Image}}')"
docker tag "$OLD_IMAGE" "$ROLLBACK_TAG"
log "      rollback image: $ROLLBACK_TAG"

# ---------------------------------------------------------------------------
# [6/9] Pre-deploy PostgreSQL backup (MANDATORY — abort if it fails)
#        Credentials are evaluated INSIDE the container and never printed.
# ---------------------------------------------------------------------------
log "[6/9] Pre-deploy PostgreSQL backup"
if ! docker exec "$DB_CONTAINER" sh -c \
      'pg_dump --no-owner --no-privileges -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
      2> >(redact >&2) | gzip -c > "$DB_BACKUP"; then
  log "ABORT: pg_dump failed — production backend NOT changed."
  rm -f "$DB_BACKUP"
  exit 1
fi
# Verify the dump: non-empty file, intact gzip, and a real pg_dump header.
# NOTE: read the header via command substitution with `sed -n '1,30p'` (which
# consumes the WHOLE stream rather than closing early). Piping a large
# decompressed dump into `head`/`grep -q` would SIGPIPE gzip and, under
# `pipefail`, misreport a perfectly valid backup as failed.
DUMP_HEAD=""
if [ -s "$DB_BACKUP" ] && gzip -t "$DB_BACKUP" 2>/dev/null; then
  DUMP_HEAD="$(gzip -dc "$DB_BACKUP" 2>/dev/null | sed -n '1,30p')"
fi
if ! printf '%s' "$DUMP_HEAD" | grep -q 'PostgreSQL database dump'; then
  log "ABORT: DB backup missing/empty/invalid — production backend NOT changed."
  rm -f "$DB_BACKUP"
  exit 1
fi
DB_SIZE="$(du -h "$DB_BACKUP" | cut -f1)"
log "      DB backup OK: $DB_BACKUP ($DB_SIZE)"

# ---------------------------------------------------------------------------
# [7/9] Update source to origin/main and BUILD (build failure = no swap)
# ---------------------------------------------------------------------------
log "[7/9] Update source and build $SERVICE"
git checkout main
git reset --hard origin/main
NEW_COMMIT="$(git rev-parse --short HEAD)"
log "      source now at commit: $NEW_COMMIT"
# Surfaces in /health and the boot log (compose passes it as GIT_COMMIT).
export GIT_COMMIT="$NEW_COMMIT"

if ! docker compose -f "$COMPOSE" build "$SERVICE"; then
  log "----------------------------------------------------------------------"
  log "BUILD FAILED — running backend was NOT replaced. No rollback needed."
  log "Previous commit still live : $PREV_COMMIT"
  log "DB backup (retained)       : $DB_BACKUP"
  log "Log file                   : $LOG_FILE"
  log "----------------------------------------------------------------------"
  exit 1
fi
log "      build OK"

# ---------------------------------------------------------------------------
# [8/9] Start new backend (backend only; --no-deps leaves db/redis untouched)
# ---------------------------------------------------------------------------
log "[8/9] Start new backend (--no-deps: postgres/redis untouched)"
docker compose -f "$COMPOSE" up -d --no-deps "$SERVICE"

# ---------------------------------------------------------------------------
# [9/9] Health + smoke tests
# ---------------------------------------------------------------------------
log "[9/9] Health check + read-only smoke tests"
DEPLOY_OK=0
if wait_for_health; then
  log "      health: HTTP 200"
  if run_smoke_tests; then
    DEPLOY_OK=1
  else
    log "      one or more smoke tests FAILED"
  fi
else
  log "      HEALTH CHECK FAILED after new backend start"
  log "----- last 100 backend log lines (redacted) -----"
  docker logs --tail 100 "$SERVICE" 2>&1 | redact || true
  log "-------------------------------------------------"
fi

if [ "$DEPLOY_OK" = "1" ]; then
  log "======================================================================"
  log "DEPLOY SUCCESS"
  log "Commit         : $NEW_COMMIT"
  log "Rollback image : $ROLLBACK_TAG"
  log "DB backup      : $DB_BACKUP"
  log "Health         : HTTP 200"
  log "Smoke tests    : PASS"
  log "Log file       : $LOG_FILE"
  log "======================================================================"
  cleanup_old_rollbacks
  cleanup_build_leftovers
  exit 0
fi

# ---------------------------------------------------------------------------
# Automatic CODE rollback (image only — database is NEVER auto-restored)
# ---------------------------------------------------------------------------
log "======================================================================"
log "DEPLOY FAILED — starting AUTOMATIC CODE ROLLBACK (image only)."
log "The production database will NOT be restored/dropped/overwritten."
log "======================================================================"

docker tag "$ROLLBACK_TAG" "$IMAGE_REF"
export GIT_COMMIT="$PREV_COMMIT"
docker compose -f "$COMPOSE" up -d --no-deps --no-build --force-recreate "$SERVICE"

if wait_for_health; then
  log "----------------------------------------------------------------------"
  log "ROLLBACK SUCCESS — previous backend image restored."
  log "Restored image : $ROLLBACK_TAG"
  log "Live commit    : $PREV_COMMIT (previous)"
  log "Health         : HTTP 200"
  log ""
  log "IMPORTANT: the failed release ($NEW_COMMIT) may have applied schema/"
  log "migration changes on startup. The database was NOT rolled back."
  log "If data/schema incompatibility is suspected, STOP and investigate."
  log "Pre-deploy DB backup (NOT restored): $DB_BACKUP"
  log "Log file       : $LOG_FILE"
  log "----------------------------------------------------------------------"
  exit 1
fi

log "======================================================================"
log "CRITICAL: rollback health check ALSO failed."
log "----- last 100 backend log lines (redacted) -----"
docker logs --tail 100 "$SERVICE" 2>&1 | redact || true
log "-------------------------------------------------"
log "Manual intervention required. Database was NOT modified by this script."
log "Pre-deploy DB backup (NOT restored): $DB_BACKUP"
log "Log file       : $LOG_FILE"
log "======================================================================"
exit 2
