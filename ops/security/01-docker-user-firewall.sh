#!/usr/bin/env bash
# Close Docker-published ports that bypass UFW, for traffic arriving from the internet (eth0) only.
#
# Why: Docker writes its own iptables rules, so a `-p 0.0.0.0:PORT` container is reachable from the
# internet even when UFW does not allow the port. The DOCKER-USER chain is the supported hook that
# Docker evaluates first. We drop NEW connections that arrive on the public interface for:
#   8080  evolution-api  (plain HTTP; still reachable on 127.0.0.1:8080 and via nginx TLS on :8443)
#   21465 wppconnect-server (no consumer found; not referenced by any env var)
#
# What keeps working: containers that call http://13.140.141.50:8080 (erp-backend, channel gateway)
# enter through their docker bridge, not eth0, so the rule never matches them. nginx :8443 proxies
# to 127.0.0.1:8080 (docker-proxy on loopback) and is unaffected too.
#
# Usage:  bash 01-docker-user-firewall.sh            apply + persist + verify
#         bash 01-docker-user-firewall.sh rollback   remove the rules (runtime + persisted)
set -euo pipefail

PUB_IF="${PUB_IF:-eth0}"
PORTS=(8080 21465)
MARK="# m1-security: DOCKER-USER public port drops"
BACKUP_DIR="/root/security-hardening-backups/$(date +%Y%m%d-%H%M%S)-docker-user"

log() { printf '[%s] %s\n' "$(date +%H:%M:%S)" "$*"; }

container_probe() {
  local c
  for c in erp-backend m1-channel-gateway-production; do
    docker exec "$c" node -e 'fetch("http://13.140.141.50:8080/",{signal:AbortSignal.timeout(5000)}).then(r=>console.log(process.argv[1],"->",r.status)).catch(e=>{console.log(process.argv[1],"ERR",e.cause?.code||e.message);process.exit(1)})' "$c"
  done
}

runtime_rules() { # $1 = -I | -D
  local op="$1" t p
  for t in iptables ip6tables; do
    for p in "${PORTS[@]}"; do
      if [[ "$op" == "-I" ]]; then
        "$t" -C DOCKER-USER -i "$PUB_IF" -p tcp -m conntrack --ctdir ORIGINAL --ctorigdstport "$p" -j DROP 2>/dev/null \
          || "$t" -I DOCKER-USER -i "$PUB_IF" -p tcp -m conntrack --ctdir ORIGINAL --ctorigdstport "$p" -j DROP
      else
        while "$t" -D DOCKER-USER -i "$PUB_IF" -p tcp -m conntrack --ctdir ORIGINAL --ctorigdstport "$p" -j DROP 2>/dev/null; do :; done
      fi
    done
  done
}

persist_block() {
  local p
  echo "$MARK BEGIN"
  echo "*filter"
  echo ":DOCKER-USER - [0:0]"
  for p in "${PORTS[@]}"; do
    echo "-A DOCKER-USER -i $PUB_IF -p tcp -m conntrack --ctdir ORIGINAL --ctorigdstport $p -j DROP"
  done
  echo "-A DOCKER-USER -j RETURN"
  echo "COMMIT"
  echo "$MARK END"
}

strip_block() { # $1 = file
  sed -i "/^$MARK BEGIN\$/,/^$MARK END\$/d" "$1"
}

if [[ "${1:-}" == "rollback" ]]; then
  log "Rolling back DOCKER-USER drops"
  runtime_rules -D
  strip_block /etc/ufw/after.rules
  strip_block /etc/ufw/after6.rules
  iptables -S DOCKER-USER
  log "Rollback done"
  exit 0
fi

[[ $EUID -eq 0 ]] || { echo "run as root"; exit 1; }
ip link show "$PUB_IF" >/dev/null

log "Backup -> $BACKUP_DIR"
mkdir -p "$BACKUP_DIR" && chmod 700 "$BACKUP_DIR"
cp -a /etc/ufw/after.rules /etc/ufw/after6.rules "$BACKUP_DIR/"
iptables-save > "$BACKUP_DIR/iptables-save.txt"
ip6tables-save > "$BACKUP_DIR/ip6tables-save.txt"

log "Baseline: containers -> Evolution via public IP"
container_probe

log "Applying runtime rules"
runtime_rules -I

log "Verify: containers still reach Evolution"
if ! container_probe; then
  log "FAILED - rolling back runtime rules"
  runtime_rules -D
  exit 1
fi

log "Persisting in /etc/ufw/after.rules and after6.rules"
for f in /etc/ufw/after.rules /etc/ufw/after6.rules; do
  strip_block "$f"
  persist_block >> "$f"
done
ufw reload >/dev/null

log "Verify after ufw reload"
iptables -S DOCKER-USER
ip6tables -S DOCKER-USER
container_probe
curl -sk -o /dev/null -w "nginx :8443 -> evolution: HTTP %{http_code}\n" \
  --resolve api.m1store-egy.com:8443:127.0.0.1 https://api.m1store-egy.com:8443/
curl -s -o /dev/null -w "api /health: HTTP %{http_code}\n" http://127.0.0.1:8000/health
log "Done. Drop counters (internet scanners should make these climb):"
iptables -L DOCKER-USER -v -n | sed -n '1,6p'
