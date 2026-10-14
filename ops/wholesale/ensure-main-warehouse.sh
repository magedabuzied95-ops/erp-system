#!/usr/bin/env bash
#
# The wholesale database must have a warehouse: purchases refuse to save without one,
# and the app only creates "Main Warehouse" by itself for a non-super-admin user (the
# owner is a super admin). Creates it once, exactly as the app would; a no-op after.
#
#   bash /opt/apps/erp-system/ops/wholesale/ensure-main-warehouse.sh
#
set -Eeuo pipefail

docker exec -i erp-postgres sh -c 'psql -v ON_ERROR_STOP=1 -q -At -U "$POSTGRES_USER" -d erp_wholesale' <<'SQL'
WITH added AS (
  INSERT INTO warehouses (tenant_id, name, code, branch_name, location, qr_token, status)
  SELECT 1, 'Main Warehouse', 'MAIN',
         COALESCE((SELECT name FROM branches ORDER BY id LIMIT 1), ''),
         '', 'main-warehouse-1-' || (EXTRACT(EPOCH FROM NOW()) * 1000)::bigint, 'active'
   WHERE NOT EXISTS (SELECT 1 FROM warehouses WHERE tenant_id = 1)
  RETURNING id
) SELECT CASE WHEN COUNT(*) > 0 THEN 'main warehouse created' ELSE 'warehouse already there' END FROM added;
SQL
