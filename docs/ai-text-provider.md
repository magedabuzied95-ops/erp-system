# Text generation without an OpenAI subscription

Product descriptions, SEO metadata and social captions are written by whatever
text provider `server/services/openaiProductDescriptionService.js` resolves from
env. Nothing else in the editor changes: the buttons, the fallback templates and
the `source` field stay the same, only the model behind them moves.

## What was measured on the production box (2026-09-06)

`gemma3:4b` through Ollama on the VPS (6 cores, 12 GB RAM, CPU only, 4
threads), first run with the long English prompts:

| Task | Time | Verdict |
| --- | --- | --- |
| Description (AR + EN) | 91 s | Usable English; Arabic had an invented word and a stiff phrase |
| SEO metadata | 67 s | Wrong: called women's sneakers "شنطة ... رجالي", numeric keywords |
| Social caption | 62 s | Acceptable, short |

Two things were changed because of that run:

- Open models now get a **compact Arabic prompt** (about a quarter of the
  tokens) with the product type, audience and colours already in Arabic, and
  are told to copy those words verbatim. Less prompt = faster on CPU.
- Model output is **merged with the deterministic template field by field**:
  a title, description, keyword or slug survives only when it is well formed
  and agrees with the facts (audience, product type). A weak model can make
  the metadata better, never wrong — the same guard drops an Arabic
  description that names the wrong audience.

Expect 30–60 s per request on this CPU. The editor waits up to 150 s, and the
multi-version generator asks for its four versions one after another so they
never queue behind each other. If that is too slow for daily use, Option B
answers in 1–3 s with a much stronger open model.

## Option A — Ollama on the VPS (fully open source, fully private)

Install with one command from PowerShell (idempotent; it also repairs a
half-applied run):

```
ssh root@13.140.141.50 "cd /opt/apps/erp-system; git pull -q origin main; bash server/scripts/install-ollama-on-vps.sh"
```

Or by hand:

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
