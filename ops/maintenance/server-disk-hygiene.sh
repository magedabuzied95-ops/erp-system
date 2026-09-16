#!/usr/bin/env bash
# One-off cleanup + durable disk hygiene for the production VPS (2026-09-16 audit).
#
# Run it straight from origin/main, no pull needed:
#   ssh root@13.140.141.50 'git -C /opt/apps/erp-system fetch -q origin && git -C /opt/apps/erp-system show origin/main:ops/maintenance/server-disk-hygiene.sh | bash'
#
# What it does:
#   1. installs ops/deploy/deploy-production.sh + ops/deploy/docker-compose.yml
#      (rollback-tag fix, build-cache prune after deploy, commit in /health,
#      log rotation, no swap for erp-artwork) — old copies kept as *.bak-<ts>
#   2. caps journald at 500M, weekly builder-cache prune cron
#   3. /etc/docker/daemon.json with log rotation + builder GC, ONLY if absent;
#      dockerd is NOT restarted, it applies on the next reboot
#   4. recreates erp-artwork (frees the swap it holds, applies the new limits)
#   5. removes stopped leftovers, old release copies and apt cache
#
# Never touches: Postgres/Redis/Evolution volumes, uploads, DB backups, the
# staging stack, wppconnect, and erp-ollama (compose names it the text-model
# provider for descriptions/SEO — it is stopped, decide about it separately).
set -uo pipefail

REPO=/opt/apps/erp-system
ERP=/opt/erp
TS="$(date +%Y%m%d-%H%M%S)"
say() { echo "[$(date +%H:%M:%S)] $*"; }

say "disk before:"; df -h / | tail -1

# --- 1. deploy script + compose ---------------------------------------------
TMP="$(mktemp -d)"
git -C "$REPO" show origin/main:ops/deploy/deploy-production.sh > "$TMP/deploy-production.sh"
git -C "$REPO" show origin/main:ops/deploy/docker-compose.yml > "$TMP/docker-compose.yml"
if bash -n "$TMP/deploy-production.sh" \
  && docker compose -f "$TMP/docker-compose.yml" --project-directory "$ERP" config -q; then
  cp -p "$ERP/deploy-production.sh" "$ERP/deploy-production.sh.bak-$TS"
  cp -p "$ERP/docker-compose.yml" "$ERP/docker-compose.yml.bak-$TS"
  install -m 755 "$TMP/deploy-production.sh" "$ERP/deploy-production.sh"
  install -m 644 "$TMP/docker-compose.yml" "$ERP/docker-compose.yml"
  say "installed deploy script + compose (backups: *.bak-$TS)"
else
  say "SKIP: new deploy script/compose failed validation — nothing replaced"
fi
rm -rf "$TMP"

# --- 2. journald cap + weekly build-cache prune -------------------------------
mkdir -p /etc/systemd/journald.conf.d
printf '[Journal]\nSystemMaxUse=500M\n' > /etc/systemd/journald.conf.d/size.conf
systemctl restart systemd-journald
journalctl --vacuum-size=500M >/dev/null 2>&1 || true
say "journald capped at 500M"

cat > /etc/cron.weekly/docker-builder-prune <<'EOF'
#!/bin/sh
docker builder prune -af --filter until=168h >/dev/null 2>&1 || true
docker image prune -f >/dev/null 2>&1 || true
EOF
chmod 755 /etc/cron.weekly/docker-builder-prune
say "weekly docker prune cron installed"

# --- 3. daemon.json (defaults for every future container) --------------------
if [ ! -e /etc/docker/daemon.json ]; then
  cat > /etc/docker/daemon.json.new <<'EOF'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "20m", "max-file": "3" },
  "builder": { "gc": { "enabled": true, "defaultKeepStorage": "15GB" } }
}
EOF
  if dockerd --validate --config-file /etc/docker/daemon.json.new >/dev/null 2>&1; then
    mv /etc/docker/daemon.json.new /etc/docker/daemon.json
    say "daemon.json written (takes effect after the next reboot / docker restart)"
  else
    rm -f /etc/docker/daemon.json.new
    say "SKIP: daemon.json failed validation"
  fi
else
  say "daemon.json already exists — left as is"
fi

# --- 4. erp-artwork: new limits + give the swap back --------------------------
docker compose -f "$ERP/docker-compose.yml" up -d --no-deps --no-build --force-recreate erp-artwork \
  && say "erp-artwork recreated" || say "WARN: erp-artwork recreate failed"

# --- 5. leftovers ---------------------------------------------------------------
for c in erp-metabase-1 m1-instagram-bridge-production-test erp-system-frontend-1; do
  docker rm "$c" >/dev/null 2>&1 && say "removed container $c"
done
for i in metabase/metabase:latest erp-instagram-bridge:latest erp-system-frontend:latest \
         erp-system-backend:latest evoapicloud/evolution-api:v2.3.7; do
  docker rmi "$i" >/dev/null 2>&1 && say "removed image $i"
done
for v in m1_production_instagram_test_profile m1_staging_instagram_profile \
         evolution-v236-test-postgres evolution-v236-test-redis evolution-v236-test-instances \
         erp_pgdata erp-system_uploads_data; do
  docker volume rm "$v" >/dev/null 2>&1 && say "removed volume $v"
done

# Old code copies (all in git). The live build context is $REPO itself.
shopt -s nullglob
old=(/opt/apps/erp-env-* /opt/apps/erp-release-* /opt/apps/erp-system-deploy-* \
     /opt/apps/erp-system-failed-v1.0.0 /opt/apps/erp-system-phase3e-* \
     /opt/apps/erp-system-release /opt/apps/erp-system-release-bag-* \
     /opt/releases/* /opt/reconcile /opt/archived-erp-source-20260808)
for p in "${old[@]}"; do
  [ "$p" = "$REPO" ] && continue
  rm -rf -- "$p"
done
say "removed ${#old[@]} old release paths"

apt-get clean 2>/dev/null || say "apt busy — cache left"

say "backend health: $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8000/health)"
say "disk after:"; df -h / | tail -1
