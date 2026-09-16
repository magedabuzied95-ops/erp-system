#!/usr/bin/env bash
# auditd rules, log retention, and the OS-level password policy.
#
# OS password policy (applies to local Linux accounts that have a password):
#   - minimum 12 characters, at least one digit, upper, lower and special character (pam_pwquality)
#   - maximum age 365 days, 14-day warning (login.defs + chage for existing accounts)
# SSH itself is key-only after 02-ssh-hardening.sh, so these passwords are only usable on the
# Contabo VNC console and for sudo.
#
# NOTE: when root's password reaches 365 days, key-based SSH for non-interactive commands (the
# deploy script) is refused until it is changed. A daily check logs a warning 30 days ahead, and
# the annual rotation is part of the security review calendar.
#
# Usage: bash 04-audit-logging-os-passwords.sh
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "run as root"; exit 1; }
log() { printf '[%s] %s\n' "$(date +%H:%M:%S)" "$*"; }
BACKUP_DIR="/root/security-hardening-backups/$(date +%Y%m%d-%H%M%S)-audit-pw"
mkdir -p "$BACKUP_DIR" && chmod 700 "$BACKUP_DIR"
cp -a /etc/audit /etc/login.defs /etc/security "$BACKUP_DIR/"
cp -a /etc/pam.d "$BACKUP_DIR/pam.d"

export DEBIAN_FRONTEND=noninteractive
apt-get install -y -qq auditd libpam-pwquality >/dev/null

# ---------------------------------------------------------------- auditd
log "auditd rules"
cat > /etc/audit/rules.d/50-m1-security.rules <<'EOF'
## M One Shoes Store - security audit rules
# Accounts and privilege
-w /etc/passwd -p wa -k identity
-w /etc/shadow -p wa -k identity
-w /etc/group -p wa -k identity
-w /etc/gshadow -p wa -k identity
-w /etc/sudoers -p wa -k privilege
-w /etc/sudoers.d/ -p wa -k privilege
# Remote access
-w /etc/ssh/sshd_config -p wa -k sshd_config
-w /etc/ssh/sshd_config.d/ -p wa -k sshd_config
-w /root/.ssh/ -p wa -k ssh_keys
# Network security configuration
-w /etc/ufw/ -p wa -k firewall
-w /etc/nginx/ -p wa -k nginx_config
-w /etc/fail2ban/ -p wa -k ips_config
-w /etc/suricata/ -p wa -k ids_config
-w /etc/docker/ -p wa -k docker_config
-w /opt/erp/docker-compose.yml -p wa -k docker_config
# Secrets (read access included)
-w /opt/erp/.env -p rwa -k secrets
-w /opt/erp/backend/.env -p rwa -k secrets
-w /opt/erp/channel-gateway.env -p rwa -k secrets
-w /etc/letsencrypt/live/ -p wa -k tls_keys
# Container control
-w /usr/bin/docker -p x -k docker_cli
# Commands run as root by a logged-in human (auid = the original login user)
-a always,exit -F arch=b64 -S execve -F euid=0 -F auid>=0 -F auid!=unset -F key=root_cmd
EOF
sed -i -E 's/^max_log_file = .*/max_log_file = 50/; s/^num_logs = .*/num_logs = 10/; s/^max_log_file_action = .*/max_log_file_action = ROTATE/' /etc/audit/auditd.conf
augenrules --load
systemctl restart auditd || service auditd restart
auditctl -l | wc -l

# ---------------------------------------------------------------- journald retention
log "journald retention"
mkdir -p /etc/systemd/journald.conf.d
cat > /etc/systemd/journald.conf.d/50-m1-retention.conf <<'EOF'
[Journal]
Storage=persistent
SystemMaxUse=2G
MaxRetentionSec=1year
EOF
systemctl restart systemd-journald

# ---------------------------------------------------------------- log rotation (security logs)
log "logrotate for Suricata / auth / ufw retention"
cat > /etc/logrotate.d/m1-security <<'EOF'
/var/log/suricata/*.log /var/log/suricata/*.json {
    daily
    rotate 30
    missingok
    compress
    delaycompress
    notifempty
    create 640 root adm
    sharedscripts
    postrotate
        /bin/kill -HUP $(cat /var/run/suricata.pid 2>/dev/null) 2>/dev/null || true
    endscript
}
EOF
# Keep 12 months of auth/ufw/fail2ban logs (Ubuntu default rsyslog rotation keeps 4 weeks)
sed -i -E 's/^(\s*)rotate [0-9]+/\1rotate 52/' /etc/logrotate.d/rsyslog
sed -i -E 's/^(\s*)rotate [0-9]+/\1rotate 52/' /etc/logrotate.d/fail2ban 2>/dev/null || true
[[ -f /etc/logrotate.d/suricata ]] && mv /etc/logrotate.d/suricata "$BACKUP_DIR/logrotate-suricata.disabled"
logrotate -d /etc/logrotate.d/m1-security >/dev/null 2>&1 && echo "logrotate config OK"
chmod 640 /var/log/auth.log /var/log/ufw.log /var/log/fail2ban.log 2>/dev/null || true

# ---------------------------------------------------------------- OS password policy
log "pam_pwquality: 12 chars, digit+upper+lower+special"
mkdir -p /etc/security/pwquality.conf.d
cat > /etc/security/pwquality.conf.d/50-m1.conf <<'EOF'
minlen = 12
dcredit = -1
ucredit = -1
lcredit = -1
ocredit = -1
maxrepeat = 3
dictcheck = 1
usercheck = 1
enforce_for_root
retry = 3
EOF
pam-auth-update --package --enable pwquality >/dev/null 2>&1 || true
grep -q pam_pwquality /etc/pam.d/common-password && echo "pam_pwquality active in common-password"

log "Password aging: 365 days max, 14-day warning"
sed -i -E 's/^PASS_MAX_DAYS.*/PASS_MAX_DAYS\t365/; s/^PASS_WARN_AGE.*/PASS_WARN_AGE\t14/' /etc/login.defs
for u in $(awk -F: '$2 !~ /^[!*]/ && $2 != "" {print $1}' /etc/shadow); do
  chage -M 365 -W 14 "$u"
  echo "$u: $(chage -l "$u" | grep -E 'Password expires' | sed 's/.*: //')"
done

cat > /usr/local/sbin/m1-password-expiry-check <<'EOF'
#!/usr/bin/env bash
# Logs a warning for any local password that expires within 30 days.
now=$(( $(date +%s) / 86400 ))
awk -F: '$2 !~ /^[!*]/ && $2 != "" && $5 != "" && $5 < 99999 {print $1, $3, $5}' /etc/shadow |
while read -r u last max; do
  left=$(( last + max - now ))
  if (( left <= 30 )); then
    logger -t m1-password-expiry -p auth.warning "password for $u expires in $left days - rotate it"
  fi
done
EOF
chmod 750 /usr/local/sbin/m1-password-expiry-check
echo "20 7 * * * root /usr/local/sbin/m1-password-expiry-check" > /etc/cron.d/m1-password-expiry
chmod 644 /etc/cron.d/m1-password-expiry

log "Verify"
auditctl -s | grep -E "^enabled"
auditctl -l | head -5
grep -vE '^\s*(#|$)' /etc/security/pwquality.conf.d/50-m1.conf | tr '\n' ' '; echo
grep -E '^(PASS_MAX_DAYS|PASS_WARN_AGE)' /etc/login.defs
log "Done"
