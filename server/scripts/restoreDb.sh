#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: restoreDb.sh path/to/backup.sql.gz"
  exit 1
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is required"
  exit 1
fi

gunzip -c "$1" | psql "$DATABASE_URL"
echo "Restore completed."
