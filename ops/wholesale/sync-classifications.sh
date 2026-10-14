#!/usr/bin/env bash
#
# Copy retail's product classification groups (gender, style, product type, grade,
# bag type) and their options into the wholesale database. Adds only what is missing,
# by group key and option value -- nothing in wholesale is changed or removed, and the
# retail database is only read.
#
#   bash /opt/apps/erp-system/ops/wholesale/sync-classifications.sh
#
set -Eeuo pipefail

DB_CONTAINER="erp-postgres"
WDB="erp_wholesale"
log() { echo "[$(date +%H:%M:%S)] $*"; }

retail_copy() { # $1 = SELECT
  docker exec "$DB_CONTAINER" sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "$0"' "COPY ($1) TO STDOUT"
}

{
  cat <<'SQL'
CREATE TEMP TABLE src_groups (key text, name_ar text, name_en text, sort_order int, is_active boolean);
CREATE TEMP TABLE src_options (group_key text, value text, label_ar text, label_en text, icon text, color text, sort_order int, is_active boolean);
COPY src_groups FROM STDIN;
SQL
  retail_copy "SELECT key, name_ar, name_en, sort_order, is_active FROM product_classification_groups"
  printf '\\.\n'
  echo "COPY src_options FROM STDIN;"
  retail_copy "SELECT g.key, o.value, o.label_ar, o.label_en, o.icon, o.color, o.sort_order, o.is_active FROM product_classification_options o JOIN product_classification_groups g ON g.id = o.group_id"
  printf '\\.\n'
  cat <<'SQL'
WITH added AS (
  INSERT INTO product_classification_groups (key, name_ar, name_en, sort_order, is_active)
  SELECT s.key, s.name_ar, s.name_en, s.sort_order, s.is_active
    FROM src_groups s
   WHERE NOT EXISTS (SELECT 1 FROM product_classification_groups g WHERE g.key = s.key)
  RETURNING key
) SELECT 'groups added: ' || COALESCE(string_agg(key, ', '), 'none') FROM added;

WITH added AS (
  INSERT INTO product_classification_options (group_id, value, label_ar, label_en, icon, color, sort_order, is_active)
  SELECT g.id, s.value, s.label_ar, s.label_en, s.icon, s.color, s.sort_order, s.is_active
    FROM src_options s
    JOIN product_classification_groups g ON g.key = s.group_key
   WHERE NOT EXISTS (SELECT 1 FROM product_classification_options o WHERE o.group_id = g.id AND o.value = s.value)
  RETURNING group_id
) SELECT 'options added: ' || COUNT(*) FROM added;
SQL
} | docker exec -i "$DB_CONTAINER" sh -c 'psql -v ON_ERROR_STOP=1 -q -At -U "$POSTGRES_USER" -d "$0"' "$WDB"

log "wholesale classification groups now:"
docker exec "$DB_CONTAINER" sh -c 'psql -At -F " | " -U "$POSTGRES_USER" -d "$0" -c "$1"' "$WDB" \
  "SELECT g.key, g.name_ar, COUNT(o.id) FROM product_classification_groups g LEFT JOIN product_classification_options o ON o.group_id = g.id GROUP BY g.id ORDER BY g.sort_order, g.id"
