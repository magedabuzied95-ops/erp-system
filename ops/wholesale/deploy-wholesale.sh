#!/usr/bin/env bash
#
# Roll the WHOLESALE backend onto the image the retail deploy just built.
# Run it right after a successful retail deploy:
#
#   bash /opt/erp/deploy-production.sh && bash /opt/apps/erp-system/ops/wholesale/deploy-wholesale.sh
#
# Takes a wholesale DB backup, keeps the running image as a rollback tag, recreates
# erp-wholesale-backend, and puts the old image back if /health does not answer.
# Never touches erp-backend, erp-redis or the retail database.
#
set -Eeuo pipefail

SRC="/opt/apps/erp-system"
ROOT="/opt/erp-wholesale"
COMPOSE="$ROOT/docker-compose.yml"
SERVICE="erp-wholesale-backend"
DB_CONTAINER="erp-postgres"
WDB="erp_wholesale"
HEALTH="http://127.0.0.1:8001/health"
TS="$(date +%Y%m%d-%H%M%S)"
ROLLBACK_TAG="erp-wholesale-backend:rollback-$TS"
DB_BACKUP="$ROOT/backups/pre-deploy-$TS.sql.gz"
LOCK_FILE="/var/lock/m1-erp-wholesale-deploy.lock"

log() { echo "[$(date +%H:%M:%S)] $*"; }

exec 9>"$LOCK_FILE"
flock -n 9 || { log "ABORT: another wholesale deploy is running."; exit 1; }

[ -f "$COMPOSE" ] || { log "ABORT: $COMPOSE missing -- run setup-wholesale.sh first."; exit 1; }
# Keep the compose file in step with the repo copy.
install -m 0644 "$SRC/ops/wholesale/docker-compose.wholesale.yml" "$COMPOSE"
# The switch that turns the wholesale features on -- in THIS copy's env only.
ENV_FILE="$ROOT/backend.env"
if ! grep -qE '^BUSINESS_MODE=wholesale$' "$ENV_FILE"; then
  sed -i '/^BUSINESS_MODE=/d' "$ENV_FILE"
  echo "BUSINESS_MODE=wholesale" >> "$ENV_FILE"
  log "      BUSINESS_MODE=wholesale added to $ENV_FILE"
fi

wait_for_health() {
  local i
  for i in $(seq 1 45); do
    [ "$(curl -sS -o /dev/null -w '%{http_code}' "$HEALTH" 2>/dev/null || true)" = "200" ] && return 0
    sleep 2
  done
  return 1
}

log "[1/4] Backup $WDB"
docker exec "$DB_CONTAINER" sh -c 'pg_dump --no-owner --no-privileges -U "$POSTGRES_USER" -d "$0"' "$WDB" | gzip -c > "$DB_BACKUP"
gzip -dc "$DB_BACKUP" | sed -n '1,30p' | grep -q 'PostgreSQL database dump' || { rm -f "$DB_BACKUP"; log "ABORT: backup invalid -- nothing changed."; exit 1; }
log "      $DB_BACKUP ($(du -h "$DB_BACKUP" | cut -f1))"
ls -1t "$ROOT"/backups/pre-deploy-*.sql.gz 2>/dev/null | tail -n +11 | xargs -r rm -f

log "[2/4] Keep the running image as $ROLLBACK_TAG"
if docker inspect "$SERVICE" >/dev/null 2>&1; then
  docker tag "$(docker inspect "$SERVICE" --format '{{.Image}}')" "$ROLLBACK_TAG"
else
  ROLLBACK_TAG=""
fi

log "[3/4] Recreate $SERVICE on erp-erp-backend:latest"
export GIT_COMMIT="$(git -C "$SRC" rev-parse --short HEAD)"
docker compose -f "$COMPOSE" up -d --no-deps --force-recreate "$SERVICE"

log "[4/4] Health"
if wait_for_health; then
  log "DEPLOY OK -- wholesale at $GIT_COMMIT"
  docker images erp-wholesale-backend --format '{{.Repository}}:{{.Tag}}' \
    | grep -E ':rollback-[0-9]{8}-[0-9]{6}$' | sort -r | tail -n +4 | xargs -r docker image rm >/dev/null 2>&1 || true
  exit 0
fi

log "HEALTH FAILED -- last 60 log lines:"
docker logs --tail 60 "$SERVICE" 2>&1 | sed -E 's#(postgres(ql)?://[^:@/]+:)[^@]*@#\1***@#Ig'
if [ -n "$ROLLBACK_TAG" ]; then
  log "Rolling back to $ROLLBACK_TAG (database NOT restored; backup: $DB_BACKUP)"
  WHOLESALE_IMAGE="$ROLLBACK_TAG" docker compose -f "$COMPOSE" up -d --no-deps --force-recreate "$SERVICE"
  wait_for_health && log "ROLLBACK OK" || log "CRITICAL: rollback also unhealthy -- manual check needed"
fi
exit 1
