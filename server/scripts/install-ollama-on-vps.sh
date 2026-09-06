#!/usr/bin/env bash
# Adds the open-weights text model (Ollama) to the production compose on the
# VPS, points the backend at it, starts it and pulls the model. Idempotent:
# running it twice changes nothing. Run it FROM Windows PowerShell like this:
#
#   Get-Content "server\scripts\install-ollama-on-vps.sh" | ssh root@13.140.141.50 bash -s
#
# Then redeploy the backend so it reads the new env:
#
#   ssh root@13.140.141.50 "bash /opt/erp/deploy-production.sh"
set -euo pipefail

COMPOSE=/opt/erp/docker-compose.yml
BACKEND_ENV=/opt/erp/backend/.env
MODEL="${AI_TEXT_MODEL:-gemma3:4b}"
STAMP="$(date +%Y%m%d-%H%M%S)"

echo "== 1/4 compose service"
if grep -q "container_name: erp-ollama" "$COMPOSE"; then
  echo "erp-ollama already in $COMPOSE"
else
  cp "$COMPOSE" "$COMPOSE.bak-ollama-$STAMP"
  python3 - "$COMPOSE" <<'PY'
import sys
path = sys.argv[1]
text = open(path, encoding="utf-8").read()
service = """  # Open-weights text model for product descriptions, SEO metadata and social
  # captions (no OpenAI subscription). One request at a time on the CPU; the
  # model stays loaded for 30 min between edits.
  erp-ollama:
    image: ollama/ollama:latest
    container_name: erp-ollama
    restart: unless-stopped
    environment:
      OLLAMA_KEEP_ALIVE: 30m
      OLLAMA_NUM_PARALLEL: 1
      OLLAMA_MAX_LOADED_MODELS: 1
      OLLAMA_NUM_THREADS: "4"
    volumes:
      - erp_ollama_models:/root/.ollama
    mem_limit: 5g

"""
marker = "\nvolumes:\n"
index = text.rfind(marker)
if index < 0:
    raise SystemExit("top-level volumes: block not found in " + path)
text = text[:index + 1] + service + text[index + 1:]
if "erp_ollama_models:" not in text:
    text = text.rstrip("\n") + "\n  erp_ollama_models:\n"
open(path, "w", encoding="utf-8").write(text)
print("erp-ollama service added")
PY
fi
docker compose -f "$COMPOSE" config >/dev/null && echo "compose file is valid"

echo "== 2/4 backend env"
touch "$BACKEND_ENV"
if grep -q "^AI_TEXT_PROVIDER=" "$BACKEND_ENV"; then
  echo "AI_TEXT_* already present in $BACKEND_ENV"
else
  cp "$BACKEND_ENV" "$BACKEND_ENV.bak-ollama-$STAMP"
  {
    echo ""
    echo "# Open-weights text generation via the erp-ollama service (see docs/ai-text-provider.md)"
    echo "AI_TEXT_PROVIDER=ollama"
    echo "AI_TEXT_BASE_URL=http://erp-ollama:11434/v1"
    echo "AI_TEXT_MODEL=$MODEL"
    echo "AI_TEXT_TIMEOUT_MS=120000"
  } >> "$BACKEND_ENV"
  echo "AI_TEXT_* appended to $BACKEND_ENV"
fi

echo "== 3/4 start ollama"
docker compose -f "$COMPOSE" up -d --no-deps erp-ollama
for _ in $(seq 1 30); do
  if docker exec erp-ollama ollama list >/dev/null 2>&1; then break; fi
  sleep 2
done

echo "== 4/4 pull $MODEL (a few GB, once)"
docker exec erp-ollama ollama pull "$MODEL"
docker exec erp-ollama ollama list

cat <<EOF

Done. Next, from PowerShell:
  ssh root@13.140.141.50 "bash /opt/erp/deploy-production.sh"
then judge the model:
  ssh root@13.140.141.50 "docker exec erp-backend node server/scripts/aiTextProviderSmoke.js"
EOF
