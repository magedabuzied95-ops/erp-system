# Text generation without an OpenAI subscription

Product descriptions, SEO metadata and social captions are written by whatever
text provider `server/services/openaiProductDescriptionService.js` resolves from
env. Nothing else in the editor changes: the buttons, the fallback templates and
the `source` field stay the same, only the model behind them moves.

## Option A — Ollama on the VPS (recommended, fully open source)

The production box has 6 cores, 12 GB RAM and ~40 GB free disk. A 4B model
answers a description in roughly 20–60 s on CPU; the editor waits up to 150 s.

1. Add the `ollama` service and the four `AI_TEXT_*` backend variables from
   `docker-compose.yml` to `/opt/erp/docker-compose.yml` (same shape, same
   network as `erp-backend`).
2. Start it and pull a model once (the weights persist in the `ollama_models`
   volume):

   ```bash
   cd /opt/erp && docker compose up -d ollama
   docker exec erp-ollama ollama pull gemma3:4b
   ```

3. Redeploy the backend so it reads the new env (`bash /opt/erp/deploy-production.sh`).
4. Judge the output before merchants see it:

   ```bash
   docker exec erp-backend node server/scripts/aiTextProviderSmoke.js "Puma Sneakers" Puma women
   ```

Models worth trying, all open weights and free:

| Model | Pull | RAM | Notes |
| --- | --- | --- | --- |
| Gemma 3 4B | `gemma3:4b` | ~3.5 GB | Default. Good Arabic, fast enough on CPU. |
| Qwen2.5 7B | `qwen2.5:7b` | ~5 GB | Better Arabic phrasing, ~2× slower; needs `OLLAMA_MEM_LIMIT=7g`. |
| Qwen2.5 3B | `qwen2.5:3b` | ~2.2 GB | Fastest; noticeably weaker Egyptian dialect. |

Switch with `AI_TEXT_MODEL=qwen2.5:7b` and a backend restart.

## Option B — a free OpenAI-compatible host of open models

If the box is too busy (the artwork service already draws on CPU), point the
same code at a hosted open model. Groq and OpenRouter both serve Llama 3.3 70B
and Qwen with a free tier and an OpenAI-compatible endpoint:

```
AI_TEXT_PROVIDER=compatible
AI_TEXT_BASE_URL=https://api.groq.com/openai/v1
AI_TEXT_API_KEY=gsk_...
AI_TEXT_MODEL=llama-3.3-70b-versatile
```

Free tiers are rate limited (Groq: ~30 requests/min, 14k requests/day at the
time of writing) which is far above what the product editor generates.

## Option C — back to OpenAI, or templates only

`AI_TEXT_PROVIDER=openai` (needs a valid `OPENAI_API_KEY`) restores the previous
behaviour. `AI_TEXT_PROVIDER=off` never calls a model; every button applies the
local Arabic-first templates.

## How the provider is chosen

| Env | Result |
| --- | --- |
| `AI_TEXT_PROVIDER=ollama` | Ollama at `AI_TEXT_BASE_URL` (default `http://127.0.0.1:11434/v1`) |
| `AI_TEXT_PROVIDER=compatible` or any `AI_TEXT_BASE_URL` | that OpenAI-compatible server |
| `AI_TEXT_PROVIDER=openai` | OpenAI Responses API |
| `AI_TEXT_PROVIDER=off` | local templates only |
| nothing set | OpenAI if `OPENAI_API_KEY` exists, otherwise templates |

Compatible servers get Chat Completions with `response_format: json_schema`
first (Ollama ≥ 0.5, vLLM, Groq), then `json_object`, then a plain request whose
answer is parsed leniently (code fences and prose stripped). Any failure ends in
the local template, never in an error for the merchant; `source` tells the UI
which happened (`OLLAMA`, `LLM`, `OPENAI` or `LOCAL_FALLBACK`).

Image analysis (`/products/generate-ai-data`) still uses OpenAI vision; Gemma 3
is multimodal, so the same Ollama service can take that over as a follow-up.
