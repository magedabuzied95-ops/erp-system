# Off-host backups (VPS)

Until 2026-09 every backup lived on the same disk as the database: the deploy's
`pre-deploy-db-*.sql.gz` and the image-guard mirror in `/opt/erp/backups`. Losing the
host lost all of them together.

| Script | When | What |
|---|---|---|
| `erp-backup.sh` | daily 03:00 | `pg_dump -Fc` of every database in `erp-postgres`, verified with `pg_restore --list`, checksummed, copied off the host; uploads copied off the host (copy-only); rotation; healthcheck ping |
| `erp-restore-test.sh` | the 2nd of each month, 05:00 | downloads the newest set **from the remote**, verifies checksums, restores into a throwaway container (`--network none`), compares row counts with production |

Retention: local sets 7 days; remote daily sets 35 days, first-of-month sets 400 days;
`pre-deploy-db-*` older than 14 days are rotated but the newest 10 are always kept.
Uploads are never deleted remotely.

The image guard in `../image-guard` stays as it is: it protects files on the host,
this copies them away from it.

## Install (once, as root on the VPS)

### 1. rclone and the remote

```bash
curl -fsSL https://rclone.org/install.sh | bash
```

Cloudflare R2 (the domain is already on Cloudflare; 10 GB free, no egress fee): create a
bucket `m1-erp-backups`, then an R2 API token with *Object Read & Write* on that bucket only.

```bash
rclone config create r2 s3 provider=Cloudflare \
  access_key_id=<ACCESS_KEY_ID> secret_access_key=<SECRET_ACCESS_KEY> \
  endpoint=https://<ACCOUNT_ID>.r2.cloudflarestorage.com acl=private no_check_bucket=true

# Encryption layer: the provider only ever sees ciphertext.
rclone config create erp-backup crypt remote=r2:m1-erp-backups \
  password="<LONG RANDOM PASSWORD>" password2="<SECOND LONG RANDOM PASSWORD>" --obscure
```

**Store both crypt passwords outside the server** (a password manager). Without them the
backups cannot be decrypted, and a lost server takes `/root/.config/rclone` with it.

Any other rclone backend (Backblaze B2, S3, Google Drive) works the same way; only the
first `rclone config create` changes.

### 2. Config, scripts, cron

```bash
cd /opt/apps/erp-system/server/ops/backup
install -m 600 erp-backup.env.example /etc/erp-backup.env   # then fill in the healthcheck URLs
install -m 755 erp-backup.sh erp-restore-test.sh /opt/erp/bin/
install -m 644 erp-backup.cron /etc/cron.d/erp-backup
```

### 3. First run, by hand

```bash
/opt/erp/bin/erp-backup.sh && /opt/erp/bin/erp-restore-test.sh
tail -n 40 /var/log/erp-backup.log
```

The first uploads copy is the slow one (all images); later runs only send new files.

## Docker log limits

Container logs have no size cap and once filled the disk. In `/etc/docker/daemon.json`:

```json
{ "log-driver": "json-file", "log-opts": { "max-size": "50m", "max-file": "3" } }
```

`systemctl restart docker` applies it to containers **created afterwards**; the next deploy
recreates `erp-backend`. Restarting Docker restarts every container, so do it in a quiet hour.

## Restoring for real

```bash
rclone copy erp-backup:db/daily/<SET> /tmp/restore && cd /tmp/restore && sha256sum -c SHA256SUMS
docker exec -i erp-postgres pg_restore -U erp_user -d <EMPTY_DATABASE> --no-owner --exit-on-error < erp_production.dump
```

Restore into an empty database and switch the app to it; never restore over the live one.
