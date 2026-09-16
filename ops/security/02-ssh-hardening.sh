#!/usr/bin/env bash
# SSH hardening: keys only, root only with a key, fewer auth tries, no X11.
#
# Evidence gathered before writing this (2026-09-16, 30-day journal):
#   - every login from the owner's networks used a public key;
#   - the only password logins were root -> root from the server's own IP (manual, irregular).
# Contabo's VNC console stays available as an out-of-band way in if SSH ever breaks.
#
# SAFETY: keep your current SSH session OPEN while running this, then open a SECOND terminal and
# confirm `ssh root@13.140.141.50 echo ok` works before closing the first one.
#
# Usage:  bash 02-ssh-hardening.sh            apply + validate + reload
#         bash 02-ssh-hardening.sh rollback   remove the drop-in and reload
set -euo pipefail

DROPIN=/etc/ssh/sshd_config.d/00-m1-hardening.conf
BACKUP_DIR="/root/security-hardening-backups/$(date +%Y%m%d-%H%M%S)-sshd"
log() { printf '[%s] %s\n' "$(date +%H:%M:%S)" "$*"; }

if [[ "${1:-}" == "rollback" ]]; then
  rm -f "$DROPIN"
  sshd -t && systemctl reload ssh
  log "Rolled back; effective settings:"
  sshd -T | grep -Ei '^(permitrootlogin|passwordauthentication) '
  exit 0
fi

[[ $EUID -eq 0 ]] || { echo "run as root"; exit 1; }

# Refuse to lock ourselves out: root must have at least one authorized key.
keys=$(grep -cvE '^\s*(#|$)' /root/.ssh/authorized_keys 2>/dev/null || echo 0)
[[ "$keys" -ge 1 ]] || { echo "root has no authorized_keys - aborting"; exit 1; }

log "Backup -> $BACKUP_DIR"
mkdir -p "$BACKUP_DIR" && chmod 700 "$BACKUP_DIR"
cp -a /etc/ssh/sshd_config /etc/ssh/sshd_config.d "$BACKUP_DIR/"
sshd -T > "$BACKUP_DIR/sshd-T-before.txt"

# sshd keeps the FIRST value it reads; sshd_config includes sshd_config.d/*.conf at the top in
# lexical order, so a 00- file wins over cloud-init's 50- file.
cat > "$DROPIN" <<'EOF'
# M One Shoes Store - SSH hardening (Amazon SP-API security controls)
PermitRootLogin prohibit-password
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitEmptyPasswords no
PubkeyAuthentication yes
MaxAuthTries 3
LoginGraceTime 30
X11Forwarding no
LogLevel VERBOSE
EOF
chmod 644 "$DROPIN"

if ! sshd -t; then
  log "sshd -t FAILED - removing drop-in"
  rm -f "$DROPIN"
  exit 1
fi

systemctl reload ssh
log "Reloaded (existing sessions are not dropped). Effective settings:"
sshd -T | grep -Ei '^(permitrootlogin|passwordauthentication|kbdinteractiveauthentication|pubkeyauthentication|maxauthtries|logingracetime|x11forwarding|loglevel) '
sshd -T > "$BACKUP_DIR/sshd-T-after.txt"
log "NOW open a second terminal and confirm key login works before closing this one."
