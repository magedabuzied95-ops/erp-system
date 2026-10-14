#!/usr/bin/env bash
#
# One-time setup of the WHOLESALE copy of the ERP on the production VPS.
# Safe to re-run: every step checks what already exists and skips it.
#
#   bash /opt/apps/erp-system/ops/wholesale/setup-wholesale.sh
#
# What it touches (and what it never touches):
#   - creates /opt/erp-wholesale (env, uploads, backups, compose file)
#   - creates the database erp_wholesale inside the existing erp-postgres server
#     (retail's database is only READ: schema + a few reference tables)
#   - starts erp-wholesale-redis + erp-wholesale-backend (127.0.0.1:8001)
#   - installs the nginx site api-jomla.m1store-egy.com (HTTP; certbot adds HTTPS)
#   - NEVER restarts, rebuilds or writes to erp-backend, erp-redis or the retail database.
#
set -Eeuo pipefail

SRC="/opt/apps/erp-system"
HERE="$SRC/ops/wholesale"
ROOT="/opt/erp-wholesale"
RETAIL_ENV="/opt/erp/backend/.env"
ENV_FILE="$ROOT/backend.env"
COMPOSE="$ROOT/docker-compose.yml"
DB_CONTAINER="erp-postgres"
WDB="erp_wholesale"
IMAGE="erp-erp-backend:latest"
HEALTH="http://127.0.0.1:8001/health"
APP_URL="https://jomla.m1store-egy.com"
API_URL="https://api-jomla.m1store-egy.com"
NGINX_SITE="/etc/nginx/sites-available/erp-wholesale"

log() { echo "[$(date +%H:%M:%S)] $*"; }
die() { log "ABORT: $*"; exit 1; }

# psql inside the Postgres container; credentials stay inside the container.
psql_db() { # $1 = database, rest = psql args
  local db="$1"; shift
  docker exec -i "$DB_CONTAINER" sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$0" "$@"' "$db" "$@"
}
retail_db_name() { docker exec "$DB_CONTAINER" sh -c 'printf %s "$POSTGRES_DB"'; }

# ---------------------------------------------------------------------------
log "[1/7] Pre-flight"
[ -f "$RETAIL_ENV" ] || die "$RETAIL_ENV not found"
docker image inspect "$IMAGE" >/dev/null 2>&1 || die "image $IMAGE not found (run the retail deploy first)"
docker network inspect erp_default >/dev/null 2>&1 || die "docker network erp_default not found"
[ "$(docker inspect -f '{{.State.Running}}' "$DB_CONTAINER" 2>/dev/null)" = "true" ] || die "$DB_CONTAINER is not running"
RETAIL_DB="$(retail_db_name)"
[ -n "$RETAIL_DB" ] || die "could not read the retail database name"
[ "$RETAIL_DB" != "$WDB" ] || die "retail database is already named $WDB"

mkdir -p "$ROOT/uploads" "$ROOT/backups" "$ROOT/logs"
install -m 0644 "$HERE/docker-compose.wholesale.yml" "$COMPOSE"
log "      $ROOT ready"

# ---------------------------------------------------------------------------
log "[2/7] Wholesale env ($ENV_FILE)"
if [ -f "$ENV_FILE" ]; then
  log "      exists -- left as is"
else
  OVR="$(mktemp)"; trap 'rm -f "$OVR"' EXIT
  chmod 600 "$OVR"
  rnd() { openssl rand -hex 32; }
  VAPID="$(docker run --rm "$IMAGE" node -e 'const k=require("web-push").generateVAPIDKeys();process.stdout.write(k.publicKey+" "+k.privateKey)')"
  VAPID_PUB="${VAPID%% *}"; VAPID_PRIV="${VAPID##* }"
  [ -n "$VAPID_PUB" ] && [ -n "$VAPID_PRIV" ] || die "VAPID key generation failed"

  # DATABASE_URL: same server and credentials as retail, database name swapped.
  RETAIL_DB_URL="$(grep -E '^DATABASE_URL=' "$RETAIL_ENV" | head -n1 | cut -d= -f2-)"
  [ -n "$RETAIL_DB_URL" ] || die "DATABASE_URL missing in retail env"
  RETAIL_DB_URL="${RETAIL_DB_URL%\"}"; RETAIL_DB_URL="${RETAIL_DB_URL#\"}"
  RETAIL_DB_URL="${RETAIL_DB_URL%\'}"; RETAIL_DB_URL="${RETAIL_DB_URL#\'}"
  WHOLESALE_DB_URL="$(printf '%s' "$RETAIL_DB_URL" | sed -E "s#/[^/?]+(\\?|\$)#/$WDB\\1#")"
  case "$WHOLESALE_DB_URL" in *"/$WDB"*) ;; *) die "could not derive the wholesale DATABASE_URL" ;; esac

  {
    echo "DATABASE_URL=$WHOLESALE_DB_URL"
    echo "REDIS_URL=redis://erp-wholesale-redis:6379"
    # Own hosts.
    echo "FRONTEND_URL=$APP_URL"
    echo "PUBLIC_APP_URL=$APP_URL"
    echo "PUBLIC_STOREFRONT_URL=$APP_URL"
    echo "STORE_FRONT_URL=$APP_URL"
    echo "PUBLIC_BACKEND_URL=$API_URL"
    echo "WEBHOOK_PUBLIC_URL=$API_URL"
    echo "CORS_ALLOWED_ORIGINS=$APP_URL"
    echo "META_REDIRECT_URI=$API_URL/api/meta/oauth/callback"
    # Own secrets: a retail login token must never open the wholesale copy.
    echo "JWT_SECRET=$(rnd)"
    echo "TELEGRAM_WEBHOOK_SECRET=$(rnd)"
    echo "AI_REGRESSION_TEST_KEY=$(rnd)"
    echo "ADMIN_REPAIR_MESSENGER_NAME_SECRET=$(rnd)"
    echo "VAPID_PUBLIC_KEY=$VAPID_PUB"
    echo "VAPID_PRIVATE_KEY=$VAPID_PRIV"
    echo "WEB_PUSH_PUBLIC_KEY=$VAPID_PUB"
    echo "WEB_PUSH_PRIVATE_KEY=$VAPID_PRIV"
    # Second WhatsApp number: its own Evolution instance, linked later from the UI.
    echo "EVOLUTION_INSTANCE_NAME=m1-jomla"
    echo "WHATSAPP_INSTANCE_NAME=m1-jomla"
    echo "EVOLUTION_INSTANCE_TOKEN="
    echo "WHATSAPP_NUMBER="
    echo "WHATSAPP_SEND_ENABLED=false"
    echo "WHATSAPP_AI_AUTO_REPLY=false"
    echo "WHATSAPP_ACCESS_TOKEN="
    echo "WHATSAPP_PHONE_NUMBER_ID="
    echo "WHATSAPP_BUSINESS_ACCOUNT_ID="
    # Off until the wholesale accounts exist (own bot, own page).
    echo "TELEGRAM_ENABLED=false"
    echo "TELEGRAM_BOT_TOKEN="
    echo "TIKTOK_ENABLED=false"
    echo "TIKTOK_BUSINESS_ENABLED=false"
    echo "TIKTOK_WEBHOOK_ENABLED=false"
    echo "TIKTOK_BUSINESS_COMMENTS_ENABLED=false"
    echo "PAYMOB_ENABLED=false"
    echo "META_COMMENTS_POLL_ENABLED=false"
    echo "MARKETING_PERFORMANCE_SYNC_ENABLED=false"
    echo "JT_SANDBOX_ENABLED=false"
    # The wholesale backend never forwards Meta events onwards.
    echo "META_WEBHOOK_FORWARD_IDS="
    echo "META_WEBHOOK_FORWARD_URL="
  } > "$OVR"

  # Retail-only keys that must not be inherited at all.
  DROP_RE='^(AMAZON_SPAPI_|META_REVIEWER_|METABASE_|JT_SANDBOX_(API|CUSTOMER|PRIVATE)|PAYMOB_(API_KEY|TERMINAL_ID)|TIKTOK_(CLIENT|BUSINESS_APP|ENCRYPTION|BUSINESS_ENCRYPTION))'

  umask 077
  awk -v drop="$DROP_RE" '
    FNR == NR { i = index($0, "="); if (i) { k = substr($0, 1, i - 1); ovr[k] = $0; order[++n] = k }; next }
    {
      i = index($0, "=")
      if (i && $0 !~ /^[[:space:]]*#/) {
        k = substr($0, 1, i - 1)
        if (k ~ drop) next
        if (k in ovr) { if (!(k in done)) { print ovr[k]; done[k] = 1 }; next }
      }
      print
    }
    END { for (j = 1; j <= n; j++) if (!(order[j] in done)) print ovr[order[j]] }
  ' "$OVR" "$RETAIL_ENV" > "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  log "      written (values not printed)"
fi

# ---------------------------------------------------------------------------
log "[3/7] Database $WDB"
if [ "$(psql_db "$RETAIL_DB" -tAc "SELECT 1 FROM pg_database WHERE datname = '$WDB'")" = "1" ]; then
  log "      exists"
else
  psql_db "$RETAIL_DB" -c "CREATE DATABASE $WDB" >/dev/null
  log "      created"
fi

TABLES="$(psql_db "$WDB" -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'")"
if [ "${TABLES:-0}" != "0" ]; then
  log "[4/7] Schema: $TABLES tables already present -- skipped"
else
  log "[4/7] Schema: cloning retail's schema (structure only, no rows)"
  docker exec "$DB_CONTAINER" sh -c 'pg_dump --schema-only --no-owner --no-privileges -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
    | psql_db "$WDB" -q >/dev/null
  log "      $(psql_db "$WDB" -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'") tables"
fi

  log "[5/7] Reference data: tenant, roles/permissions, classifications, owner login"
  # table|filter. FK triggers are off for the copy (session_replication_role=replica),
  # so order does not matter; the owner's links to retail-only rows are cleared below.
  # A table that already has rows is left alone, so a re-run never duplicates or undoes.
  COPY_SPEC='
tenants|id = 1
company_profiles|tenant_id = 1
subscriptions|tenant_id = 1
permissions|TRUE
roles|tenant_id = 1 OR tenant_id IS NULL
role_permissions|role_id IN (SELECT id FROM roles WHERE tenant_id = 1 OR tenant_id IS NULL)
product_classification_groups|TRUE
product_classification_options|TRUE
units|tenant_id = 1
categories|tenant_id = 1
brands|tenant_id = 1
users|is_super_admin = TRUE
'
  # The list is read on fd 3: every docker exec -i in the body would otherwise swallow
  # the rest of it from stdin (the first run copied tenants and silently stopped).
  COPIED=""
  while IFS='|' read -r table filter <&3; do
    [ -n "$table" ] || continue
    if [ -z "$(psql_db "$RETAIL_DB" -tAc "SELECT to_regclass('public.$table')" </dev/null)" ]; then
      log "      $table: not in retail -- skipped"; continue
    fi
    existing="$(psql_db "$WDB" -tAc "SELECT count(*) FROM public.$table" </dev/null)"
    if [ "${existing:-0}" != "0" ]; then
      log "      $table: already has $existing rows -- left as is"; continue
    fi
    docker exec "$DB_CONTAINER" sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "$0"' \
      "COPY (SELECT * FROM public.$table WHERE $filter) TO STDOUT" \
    | docker exec -i -e PGOPTIONS='-c session_replication_role=replica' "$DB_CONTAINER" \
        sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$0" -c "$1"' "$WDB" "COPY public.$table FROM STDIN"
    log "      $table: $(psql_db "$WDB" -tAc "SELECT count(*) FROM public.$table" </dev/null) rows"
    COPIED="$COPIED $table"
  done 3<<< "$COPY_SPEC"

if [ -n "$COPIED" ]; then
  psql_db "$WDB" -q <<'SQL'
-- Sequences follow the copied ids.
DO $$
DECLARE r record; seq text;
BEGIN
  FOR r IN SELECT c.table_name FROM information_schema.columns c
           JOIN information_schema.tables t ON t.table_name = c.table_name AND t.table_schema = 'public'
           WHERE c.table_schema = 'public' AND c.column_name = 'id' AND t.table_type = 'BASE TABLE'
  LOOP
    seq := pg_get_serial_sequence(format('public.%I', r.table_name), 'id');
    IF seq IS NOT NULL THEN
      EXECUTE format('SELECT setval(%L, GREATEST((SELECT COALESCE(MAX(id), 0) FROM public.%I), 1))', seq, r.table_name);
    END IF;
  END LOOP;
END $$;

SQL
  log "      sequences aligned"
fi

case " $COPIED " in *" users "*)
  psql_db "$WDB" -q <<'SQL'
-- The owner's row may point at retail-only rows (branch, employee, ...). Clear every
-- such link except tenant and role, which were copied.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT kcu.column_name
           FROM information_schema.table_constraints tc
           JOIN information_schema.key_column_usage kcu
             ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
           WHERE tc.table_schema = 'public' AND tc.table_name = 'users' AND tc.constraint_type = 'FOREIGN KEY'
             AND kcu.column_name NOT IN ('tenant_id', 'role_id')
  LOOP
    BEGIN
      EXECUTE format('UPDATE public.users SET %I = NULL WHERE %I IS NOT NULL', r.column_name, r.column_name);
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'users.% left as is: %', r.column_name, SQLERRM;
    END;
  END LOOP;
END $$;

SQL
  log "      owner login copied, links to retail-only rows cleared" ;;
esac

case " $COPIED " in *" tenants "*|*" company_profiles "*)
  psql_db "$WDB" -q <<'SQL'
UPDATE public.tenants SET name = 'M1 Wholesale', company_name = 'M1 Wholesale' WHERE id = 1;
UPDATE public.company_profiles SET company_name = 'M1 Wholesale' WHERE tenant_id = 1;
SQL
  log "      tenant named M1 Wholesale" ;;
esac

# ---------------------------------------------------------------------------
log "[6/7] Start erp-wholesale-redis + erp-wholesale-backend"
GIT_COMMIT="$(git -C "$SRC" rev-parse --short HEAD)" docker compose -f "$COMPOSE" up -d
ok=0
for i in $(seq 1 45); do
  if [ "$(curl -sS -o /dev/null -w '%{http_code}' "$HEALTH" 2>/dev/null || true)" = "200" ]; then ok=1; break; fi
  sleep 2
done
if [ "$ok" != "1" ]; then
  log "      health check FAILED -- last 60 log lines:"
  docker logs --tail 60 erp-wholesale-backend 2>&1 | sed -E 's#(postgres(ql)?://[^:@/]+:)[^@]*@#\1***@#Ig'
  die "wholesale backend is not healthy (retail untouched)"
fi
log "      $HEALTH -> 200"

# ---------------------------------------------------------------------------
log "[7/7] nginx site api-jomla.m1store-egy.com"
if [ -f "$NGINX_SITE" ]; then
  log "      exists -- left as is"
else
  install -m 0644 "$HERE/nginx-api-jomla.conf" "$NGINX_SITE"
  ln -sf "$NGINX_SITE" /etc/nginx/sites-enabled/erp-wholesale
  if nginx -t; then
    systemctl reload nginx
    log "      installed and nginx reloaded"
  else
    rm -f /etc/nginx/sites-enabled/erp-wholesale "$NGINX_SITE"
    die "nginx -t failed -- site removed again, nginx not reloaded"
  fi
fi

log "======================================================================"
log "WHOLESALE BACKEND UP on 127.0.0.1:8001"
log "Next (once the DNS record api-jomla exists):"
log "  certbot --nginx -d api-jomla.m1store-egy.com"
log "======================================================================"
