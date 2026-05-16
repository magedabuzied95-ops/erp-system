#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-./backups}"
mkdir -p "$BACKUP_DIR"

STAMP="$(date +%F_%H-%M-%S)"
FILE="$BACKUP_DIR/erp_${STAMP}.sql.gz"

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is required"
  exit 1
fi

pg_dump "$DATABASE_URL" | gzip > "$FILE"
echo "Backup written to $FILE"
