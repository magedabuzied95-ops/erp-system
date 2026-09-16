#!/usr/bin/env bash
# Collect SANITIZED evidence of the implemented security controls for the Amazon SP-API
# Developer Profile. Never copies .env files, environment variables, keys, hashes or tokens.
#
# Output: /root/amazon-spapi-security-evidence/<YYYY-MM-DD>/  (root only, 700/600)
# Usage:  bash 05-collect-evidence.sh
set -uo pipefail
[[ $EUID -eq 0 ]] || { echo "run as root"; exit 1; }

REPO=/opt/apps/erp-system
BASE=/root/amazon-spapi-security-evidence
OUT="$BASE/$(date +%F)"
mkdir -p "$OUT" && chmod 700 "$BASE" "$OUT"
umask 077
log() { printf '[%s] %s\n' "$(date +%H:%M:%S)" "$*"; }
section() { local file="$OUT/$1"; shift; { echo "# $*"; echo "# collected $(date -Is) on $(hostname)"; echo; } > "$file"; echo "$file"; }
run() { local file="$1"; shift; { echo "\$ $*"; eval "$@" 2>&1; echo; } >> "$file"; }

# Latest committed policy documents (read from git, not from the working tree).
git -C "$REPO" fetch -q origin main 2>/dev/null || true
for doc in incident-response-plan.md amazon-spapi-security-controls.md; do
  git -C "$REPO" show "origin/main:docs/security/$doc" > "$OUT/$doc" 2>/dev/null || rm -f "$OUT/$doc"
done

log "01 firewall"
f=$(section 01-firewall.txt "Host firewall (UFW) and Docker published-port filtering")
run "$f" "ufw status verbose"
run "$f" "iptables -S DOCKER-USER"
run "$f" "ip6tables -S DOCKER-USER"
run "$f" "iptables -L DOCKER-USER -v -n"
run "$f" "grep -A8 'm1-security: DOCKER-USER' /etc/ufw/after.rules"

log "02 listening ports"
f=$(section 02-listening-ports.txt "Listening sockets and owning processes")
run "$f" "ss -tulpnH | awk '{print \$1, \$5, \$7}' | sort -u"
run "$f" "docker ps --format '{{.Names}}\t{{.Image}}\t{{.Ports}}'"

log "03 IDS"
f=$(section 03-ids-suricata.txt "Intrusion detection - Suricata (af-packet IDS, ET Open rules)")
run "$f" "suricata -V"
run "$f" "systemctl is-enabled suricata; systemctl is-active suricata"
run "$f" "systemctl status suricata --no-pager | sed -n '1,12p'"
run "$f" "grep -E 'rules successfully loaded|signatures processed' /var/log/suricata/suricata.log | tail -3"
run "$f" "ls -la /var/lib/suricata/rules/"
run "$f" "grep -c . /var/lib/suricata/rules/suricata.rules"
run "$f" "cat /etc/cron.d/m1-suricata-update"
run "$f" "echo alerts_last_24h: \$(find /var/log/suricata -name 'fast.log' -mmin -1440 -exec cat {} + 2>/dev/null | wc -l)"
run "$f" "tail -n 5 /var/log/suricata/fast.log"

log "04 IPS"
f=$(section 04-ips-fail2ban.txt "Intrusion prevention - Fail2Ban (nftables)")
run "$f" "fail2ban-client version"
run "$f" "fail2ban-client status"
run "$f" "fail2ban-client status sshd"
run "$f" "fail2ban-client status recidive"
run "$f" "cat /etc/fail2ban/jail.d/m1-hardening.local"

log "05 anti-malware"
f=$(section 05-antimalware-clamav.txt "Anti-malware - ClamAV with freshclam signature updates and scheduled scans")
run "$f" "clamscan --version"
run "$f" "systemctl is-active clamav-freshclam"
run "$f" "ls -la /var/lib/clamav/ | grep -E '\\.c[lv]d'"
run "$f" "tail -n 5 /var/log/clamav/freshclam.log"
run "$f" "systemctl list-timers m1-clamscan.timer --no-pager"
run "$f" "cat /etc/systemd/system/m1-clamscan.service /etc/systemd/system/m1-clamscan.timer"
run "$f" "ls -la /var/log/clamav-scan/ | tail -10"
run "$f" "for l in \$(ls -t /var/log/clamav-scan/scan-*.log 2>/dev/null | head -3); do echo == \$l; grep -E 'mode=|Infected files|Scanned files|finished=' \$l; done"

log "06 segmentation"
f=$(section 06-network-segmentation.txt "Network segmentation - Docker networks and exposure")
run "$f" "docker network ls --format '{{.Name}}\t{{.Driver}}\tinternal={{.Internal}}'"
run "$f" "for c in \$(docker ps --format '{{.Names}}'); do echo \"\$c: \$(docker inspect -f '{{range \$k,\$v := .NetworkSettings.Networks}}{{\$k}} {{end}}' \$c)| published: \$(docker port \$c | tr '\\n' ' ')\"; done"
{
  echo
  echo "Summary:"
  echo "- Databases (erp-postgres, redis, evolution-postgres, staging DB) publish no internet-facing port;"
  echo "  production Postgres/Redis are bound to 127.0.0.1 only."
  echo "- Staging data services run on an internal-only Docker network (m1-staging-network, internal=true)."
  echo "- The WhatsApp gateway (evolution) runs on its own network (evolution_default)."
  echo "- Internet-facing: Nginx 80/443 (TLS, fronted by Cloudflare) and 8443 (TLS). Docker ports 8080/21465"
  echo "  are dropped for traffic arriving on eth0 by DOCKER-USER rules (see 01-firewall.txt)."
} >> "$f"

log "07 remote access"
f=$(section 07-ssh-access.txt "Remote access - SSH configuration and privileged accounts")
run "$f" "sshd -T | grep -Ei '^(permitrootlogin|passwordauthentication|kbdinteractiveauthentication|pubkeyauthentication|maxauthtries|logingracetime|x11forwarding|loglevel) '"
run "$f" "cat /etc/ssh/sshd_config.d/00-m1-hardening.conf"
run "$f" "awk -F: '\$7 !~ /(nologin|false|sync)\$/ {print \$1, \$3, \$7}' /etc/passwd"
run "$f" "getent group sudo docker"
run "$f" "for d in /root /home/*; do k=\$d/.ssh/authorized_keys; [ -f \$k ] && echo \"\$k: \$(grep -cvE '^\\s*(#|\$)' \$k) key(s), mode \$(stat -c %a \$k)\"; done"
run "$f" "journalctl -u ssh --since '7 days ago' -o cat | grep -oE 'Accepted (password|publickey)' | sort | uniq -c"

log "08 OS password policy"
f=$(section 08-os-password-policy.txt "Operating-system password policy")
run "$f" "cat /etc/security/pwquality.conf.d/50-m1.conf"
run "$f" "grep -n pam_pwquality /etc/pam.d/common-password"
run "$f" "grep -E '^(PASS_MAX_DAYS|PASS_WARN_AGE|ENCRYPT_METHOD)' /etc/login.defs"
run "$f" "for u in \$(awk -F: '\$2 !~ /^[!*]/ && \$2 != \"\" {print \$1}' /etc/shadow); do echo \"== \$u\"; chage -l \$u | grep -E 'Last password change|Password expires|Maximum number'; done"
run "$f" "cat /etc/cron.d/m1-password-expiry"

log "09 logging"
f=$(section 09-logging-monitoring.txt "Logging, audit and monitoring")
run "$f" "systemctl is-active auditd rsyslog systemd-journald"
run "$f" "auditctl -s | grep -E '^(enabled|failure|backlog_limit)'"
run "$f" "auditctl -l"
run "$f" "grep -E '^(max_log_file|num_logs|max_log_file_action)' /etc/audit/auditd.conf"
run "$f" "cat /etc/systemd/journald.conf.d/50-m1-retention.conf"
run "$f" "ls -la /var/log/auth.log /var/log/ufw.log /var/log/fail2ban.log /var/log/audit/audit.log"
run "$f" "grep -E 'rotate|weekly|daily' /etc/logrotate.d/rsyslog /etc/logrotate.d/m1-security | sort -u"
run "$f" "ls -la /var/log/audit/ | tail -3"

log "10 TLS"
f=$(section 10-tls-encryption.txt "Encryption in transit")
run "$f" "nginx -T 2>/dev/null | grep -E '^\\s*(listen|ssl_protocols|ssl_ciphers|return 301|server_name)' | sed 's/^\\s*//'"
run "$f" "certbot certificates 2>/dev/null | grep -E 'Certificate Name|Domains|Expiry'"
run "$f" "systemctl is-active certbot.timer"
run "$f" "echo | openssl s_client -connect 127.0.0.1:443 -servername api.m1store-egy.com 2>/dev/null | grep -E 'Protocol|Cipher|Verify return'"
run "$f" "echo | timeout 5 openssl s_client -connect 127.0.0.1:443 -servername api.m1store-egy.com -tls1_1 2>&1 | grep -iE 'alert|no protocols|handshake failure|wrong version' | head -2; echo '(TLS 1.1 handshake must fail)'"
run "$f" "curl -s -o /dev/null -w 'http -> %{http_code} %{redirect_url}\\n' -H 'Host: api.m1store-egy.com' http://127.0.0.1/"
run "$f" "curl -s -o /dev/null -w 'public https -> %{http_code} TLS=%{ssl_verify_result}\\n' https://api.m1store-egy.com/api/health"
{
  echo
  echo "Amazon SP-API traffic: all calls to Amazon (LWA token endpoint and SP-API endpoints) are HTTPS-only."
  echo "Encryption at rest: NOT claimed for the whole disk. MFA secrets are encrypted at rest (AES-256-GCM);"
  echo "application passwords are bcrypt hashes (cost 12); secret settings are AES-256-GCM encrypted."
} >> "$f"

log "11 application controls"
f=$(section 11-application-auth.txt "Application authentication, password policy, MFA, RBAC and audit (counts only)")
docker exec -i erp-backend node --input-type=module >> "$f" 2>/dev/null <<'NODE'
import db from "/app/server/database/db.js";
const q = async (sql) => (await db.query(sql)).rows;
const out = {};
out.security_settings = await q(`SELECT key, value FROM system_settings WHERE key IN ('security.mfa_required','security.enforce_password_rotation','security.password_max_age_days','security.require_strong_password') ORDER BY key`);
out.defaults_when_unset = { "security.mfa_required": false, "security.enforce_password_rotation": false, "security.password_max_age_days": 365, "security.require_strong_password": true };
out.active_users = (await q(`SELECT COUNT(*)::int AS n FROM users WHERE is_active IS DISTINCT FROM FALSE`))[0].n;
out.users_with_mfa = (await q(`SELECT COUNT(*)::int AS n FROM users WHERE mfa_enabled = TRUE AND is_active IS DISTINCT FROM FALSE`))[0].n;
out.admin_like_users_without_mfa = (await q(`SELECT COUNT(*)::int AS n FROM users u LEFT JOIN roles r ON r.id = u.role_id WHERE u.is_active IS DISTINCT FROM FALSE AND (u.is_super_admin = TRUE OR LOWER(REPLACE(COALESCE(r.name, u.role, ''), '_', ' ')) IN ('admin','super admin','superadmin','owner','manager')) AND u.mfa_enabled IS NOT TRUE`))[0].n;
out.passwords_changed_under_policy = (await q(`SELECT COUNT(*)::int AS n FROM users WHERE password_changed_at IS NOT NULL`))[0].n;
out.roles_with_amazon_permissions = await q(`SELECT r.name AS role, p.module || '.' || p.action AS permission FROM role_permissions rp JOIN roles r ON r.id = rp.role_id JOIN permissions p ON p.id = rp.permission_id WHERE p.module = 'amazon' ORDER BY 1, 2`);
out.security_events_by_type_30d = await q(`SELECT event_type, outcome, COUNT(*)::int AS n FROM security_audit_events WHERE created_at > NOW() - INTERVAL '30 days' GROUP BY 1, 2 ORDER BY 1, 2`);
out.password_hashing = "bcrypt (bcryptjs), cost 12 for new/changed passwords";
out.mfa = "RFC 6238 TOTP, secrets AES-256-GCM encrypted, 10 hashed single-use recovery codes, replay protection, 5 failures / 15 min lock";
out.login_throttling = "5 wrong passwords per account / 15 min lock; 30 attempts per client IP / 15 min";
out.sessions = "JWT with token_version; password or MFA change revokes existing sessions; lookup failure fails closed";
console.log(JSON.stringify(out, null, 2));
process.exit(0);
NODE

log "12 secrets handling"
f=$(section 12-secrets-storage.txt "Secret storage - permissions only, never contents")
run "$f" "find /opt/erp /opt/m1-erp-staging /opt/erp_backup_* -maxdepth 3 \\( -name '.env' -o -name '.env.*' -o -name '*.env' \\) ! -name '*.example' -printf '%m %u:%g %p\\n' 2>/dev/null | sort"
run "$f" "echo world-readable secret files: \$(find /opt/erp /opt/m1-erp-staging /opt/erp_backup_* -maxdepth 3 \\( -name '.env' -o -name '.env.*' -o -name '*.env' \\) ! -name '*.example' -perm /o+r 2>/dev/null | wc -l)"
run "$f" "stat -c '%a %U %n' /etc/letsencrypt/live /etc/letsencrypt/archive"
run "$f" "git -C $REPO ls-files | grep -iE '(^|/)\\.env(\\.|\$)' | grep -v example || echo 'no .env files tracked in git'"

log "13 updates and backups"
f=$(section 13-updates-backups.txt "Patch management and backups")
run "$f" "cat /etc/apt/apt.conf.d/20auto-upgrades"
run "$f" "systemctl is-active unattended-upgrades"
run "$f" "apt list --upgradable 2>/dev/null | grep -c -i security"
run "$f" "ls /var/run/reboot-required 2>/dev/null && echo REBOOT PENDING || echo no reboot pending"
run "$f" "cat /etc/cron.d/erp-backup | grep -v '^#'"
run "$f" "ls -la /opt/erp/backups | tail -5"

# Final safety net: refuse to leave anything that looks like a secret in the evidence.
log "sanitize check"
if grep -rIEn '(-----BEGIN [A-Z ]*PRIVATE KEY|AKIA[0-9A-Z]{16}|Atzr\|[A-Za-z0-9_-]{20,}|amzn1\.oa2-cs|\$2[aby]\$[0-9]{2}\$|mfa1:|sk-[A-Za-z0-9]{20,}|EAA[A-Za-z0-9]{30,}|(PASSWORD|SECRET|TOKEN|API_KEY)=[^ ]+)' "$OUT" > "$OUT/.sanitize-hits" 2>/dev/null; then
  log "POSSIBLE SECRET FOUND - review $OUT/.sanitize-hits (file names/lines only) and delete before sharing"
  cut -d: -f1,2 "$OUT/.sanitize-hits"
else
  rm -f "$OUT/.sanitize-hits"
  log "no secret patterns found"
fi

(cd "$OUT" && sha256sum ./* > SHA256SUMS)
chmod 600 "$OUT"/*
log "Evidence written to $OUT"
ls -la "$OUT"
