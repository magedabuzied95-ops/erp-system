#!/usr/bin/env bash
# One-time: install rclone and create the encrypted R2 remote erp-backup.sh writes to.
#
# Keys are typed at a prompt (not echoed, never in shell history or a command line).
# The two crypt passwords are generated here and printed ONCE: without them the backups
# cannot be decrypted, and they must not live only on this server.
set -euo pipefail

R2_ACCOUNT_ID="${R2_ACCOUNT_ID:-b3fd53dd44ff88c783003613ec233fa0}"
R2_BUCKET="${R2_BUCKET:-m1-erp-backups}"

if ! command -v rclone >/dev/null; then
  curl -fsSL https://rclone.org/install.sh | bash
fi
rclone version | head -n 1

if rclone listremotes | grep -qx 'erp-backup:'; then
  echo "remote erp-backup: already exists; delete it first with: rclone config delete erp-backup"
  exit 1
fi

read -rp  "R2 Access Key ID: " R2_KEY
read -rsp "R2 Secret Access Key (hidden): " R2_SECRET; echo
[[ -n "$R2_KEY" && -n "$R2_SECRET" ]] || { echo "both keys are required"; exit 1; }

rclone config create r2 s3 provider=Cloudflare \
  access_key_id="$R2_KEY" secret_access_key="$R2_SECRET" \
  endpoint="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com" acl=private no_check_bucket=true >/dev/null
unset R2_KEY R2_SECRET

CRYPT_PASSWORD="$(openssl rand -base64 33)"
CRYPT_SALT="$(openssl rand -base64 33)"
rclone config create erp-backup crypt remote="r2:${R2_BUCKET}" \
  password="$CRYPT_PASSWORD" password2="$CRYPT_SALT" --obscure >/dev/null
chmod 600 "$(rclone config file | tail -n 1)"

probe="/tmp/erp-backup-selftest-$$.txt"
echo "selftest $(date -Is)" > "$probe"
rclone copy "$probe" erp-backup:selftest/
rclone lsf erp-backup:selftest/ | grep -q "$(basename "$probe")"
rclone delete erp-backup:selftest/
rm -f "$probe"

cat <<EOF

R2 OK: wrote, listed and deleted an encrypted test file in ${R2_BUCKET}.

================ SAVE BOTH NOW, OUTSIDE THIS SERVER ================
crypt password : ${CRYPT_PASSWORD}
crypt password2: ${CRYPT_SALT}
====================================================================
Without these two lines the backups cannot be decrypted.
Then run: clear
EOF
