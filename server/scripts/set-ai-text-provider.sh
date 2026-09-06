#!/usr/bin/env bash
# Switches the text provider the backend uses for product descriptions, SEO
# metadata and social captions, then recreates the backend so it reads the new
# env. Runs ON the VPS. From Windows PowerShell:
#
#   ssh root@13.140.141.50 "cd /opt/apps/erp-system; git pull -q origin main; bash server/scripts/set-ai-text-provider.sh groq gsk_YOUR_KEY"
#   ssh root@13.140.141.50 "bash /opt/apps/erp-system/server/scripts/set-ai-text-provider.sh ollama"
#   ssh root@13.140.141.50 "bash /opt/apps/erp-system/server/scripts/set-ai-text-provider.sh off"
#
# Usage: set-ai-text-provider.sh groq <api-key> [model]
#        set-ai-text-provider.sh openrouter <api-key> [model]
#        set-ai-text-provider.sh ollama [model]
#        set-ai-text-provider.sh openai | off
set -euo pipefail

BACKEND_ENV=/opt/erp/backend/.env
COMPOSE=/opt/erp/docker-compose.yml
PROVIDER="${1:-}"
ARG2="${2:-}"
ARG3="${3:-}"

case "$PROVIDER" in
  groq)
    [ -n "$ARG2" ] || { echo "usage: $0 groq <api-key> [model]"; exit 1; }
    LINES=("AI_TEXT_PROVIDER=compatible" "AI_TEXT_BASE_URL=https://api.groq.com/openai/v1" "AI_TEXT_API_KEY=$ARG2" "AI_TEXT_MODEL=${ARG3:-llama-3.3-70b-versatile}" "AI_TEXT_TIMEOUT_MS=60000")
    ;;
  openrouter)
    [ -n "$ARG2" ] || { echo "usage: $0 openrouter <api-key> [model]"; exit 1; }
    LINES=("AI_TEXT_PROVIDER=compatible" "AI_TEXT_BASE_URL=https://openrouter.ai/api/v1" "AI_TEXT_API_KEY=$ARG2" "AI_TEXT_MODEL=${ARG3:-meta-llama/llama-3.3-70b-instruct:free}" "AI_TEXT_TIMEOUT_MS=60000")
    ;;
  ollama)
    LINES=("AI_TEXT_PROVIDER=ollama" "AI_TEXT_BASE_URL=http://erp-ollama:11434/v1" "AI_TEXT_MODEL=${ARG2:-gemma3:4b}" "AI_TEXT_TIMEOUT_MS=85000")
    ;;
  openai)
    LINES=("AI_TEXT_PROVIDER=openai")
    ;;
  off)
    LINES=("AI_TEXT_PROVIDER=off")
    ;;
  *)
    echo "usage: $0 groq <api-key> [model] | openrouter <api-key> [model] | ollama [model] | openai | off"
    exit 1
    ;;
esac

touch "$BACKEND_ENV"
cp "$BACKEND_ENV" "$BACKEND_ENV.bak-provider-$(date +%Y%m%d-%H%M%S)"
# Drop every previous AI_TEXT_* line (and the comment the installer left), then append the new block.
grep -vE "^(AI_TEXT_[A-Z_]+=|# Open-weights text generation)" "$BACKEND_ENV" > "$BACKEND_ENV.tmp" || true
{
  cat "$BACKEND_ENV.tmp"
  echo ""
  echo "# Text provider for product copy / SEO / captions (docs/ai-text-provider.md)"
  printf '%s\n' "${LINES[@]}"
} > "$BACKEND_ENV"
rm -f "$BACKEND_ENV.tmp"
echo "== $BACKEND_ENV now has:"
grep -E "^AI_TEXT_" "$BACKEND_ENV" | sed -E 's/(AI_TEXT_API_KEY=).{6}.*/\1******/'

echo "== recreating erp-backend with the new env (no rebuild)"
docker compose -f "$COMPOSE" up -d --no-deps --no-build --force-recreate erp-backend
for _ in $(seq 1 40); do
  if curl -fsS http://127.0.0.1:8000/health >/dev/null 2>&1; then echo "backend healthy"; break; fi
  sleep 2
done

if [ "$PROVIDER" != "ollama" ] && docker ps --format '{{.Names}}' | grep -q '^erp-ollama$'; then
  echo "== ollama is no longer used; stopping it to free memory (start again with: docker start erp-ollama)"
  docker stop erp-ollama >/dev/null
fi

echo "== sample output from the new provider"
docker exec erp-backend node server/scripts/aiTextProviderSmoke.js
