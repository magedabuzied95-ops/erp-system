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

# ON_ERROR_STOP + one transaction: psql used to carry on past every error and this script
# printed "Restore completed." regardless. Now the first error aborts and rolls the whole
# restore back, and the exit code says so.
gunzip -c "$1" | psql "$DATABASE_URL" -v ON_ERROR_STOP=1 --single-transaction
echo "Restore completed."
