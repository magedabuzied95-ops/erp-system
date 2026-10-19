# Photo-search evaluation

"Customer sends a shoe photo — did the right stocked shoe come back?" measured as numbers, so every
change to photo search is judged on the same set and not on one-off tries.

- `manifest.json` — the labelled cases (committed).
- `../visualSearchEval.js` — runs `recogniseProductFromImage` on every case and scores it.
- `buildSyntheticCases.js` — (re)writes the `synthetic_screenshot` cases from real stocked photos.
- `screenshotAugment.js` — the deterministic "phone screenshot of a post" recipe.
- `results/` — run outputs (git-ignored).

## Case kinds

| kind | image | expected |
|---|---|---|
| `owner_test` | `uploads:whatsapp-media/<file>` — the owner's real WhatsApp test photos, read from the server's `./uploads` | labelled by eye against the candidates' own product photos; a list when more than one product is acceptable |
| `synthetic_screenshot` | `source` (an indexed product photo URL) + `augment.seed`; rendered on the fly by `screenshotLike` — no image is stored | that product + colour |
| `product_photo_holdout` | reserved for real customer photos of stocked shoes once we have them | |

Synthetic cases carry `slice`: `exact_image` (built from photo A of the product + colour) or
`different_image` (built from a second photo B of it). **Both source photos are in the image index**
(the indexer takes every product, gallery and variant photo), so the synthetic numbers are an upper
bound; the owner tests are the real held-out signal. The screenshot recipe changes every pixel, so the
index's exact-hash match never fires on a synthetic case.

An empty `expected_product_ids` means "we do not stock it": the right answer is an honest miss or a
reply that says "closest".

## Metrics

- **hit@1** — the first card's product is expected.
- **hit@cards** — any product the reply could show is expected (the matched product, or when nothing
  was named, the brand shortlist + the stocked family the photo was read as).
- **colour 1st** — hit@1 and the first card's colour matches `expected_color`.
- **miss(stocked)** — we said "not found / can't tell" about a shoe we stock (bad).
- **miss(unstocked)** — honest miss on a shoe we do not stock (good).
- **wrong-same** — we said "same" (not "closest") and it was the wrong product.
- **ms**, **openai/case** — mean latency, requests to api.openai.com per case (counted at `fetch`).

## Known limits

- The backend container has no fonts, so the caption bar and price sticker text render as boxes.
  The bars are still there; the words are not.
- The 7 owner files are 4 distinct photos (pairs are byte-identical). Each photo is one case, and
  its twin is listed in `also_sent_as`.
- Production keeps the working OpenAI key in Settings (`ai_channels.openai_agent_api_key`, loaded at
  server start); the env key is stale (401 on 2026-10-20). The eval loads the setting the same way
  (`refreshOpenAiCredentialOverrides`) and prints only whether a key loaded.

## Running it (production data, never the live app)

Inside the backend container, on a throwaway copy:

```sh
docker exec erp-backend sh -c '
  rm -rf /tmp/evalapp && mkdir -p /tmp/evalapp &&
  cp -r /app/server /tmp/evalapp/server && cp /app/package.json /tmp/evalapp/ &&
  ln -s /app/node_modules /tmp/evalapp/node_modules &&
  ln -s /app/shared /tmp/evalapp/shared && ln -s /app/src /tmp/evalapp/src &&
  ln -s /app/uploads /tmp/evalapp/uploads'
# copy this folder + visualSearchEval.js into /tmp/evalapp/server/scripts/ (docker cp), then:
docker exec -w /tmp/evalapp erp-backend node server/scripts/visualSearchEval.js --tenant 1 --limit 3
docker exec -w /tmp/evalapp erp-backend node server/scripts/visualSearchEval.js --tenant 1 --yes --out /tmp/eval.json
docker exec erp-backend rm -rf /tmp/evalapp
```

The eval drops every INSERT/UPDATE/DELETE/ALTER/CREATE the services would issue (the visual search runs
an idempotent schema "ensure" each call) and prints how many it dropped. Each case costs about two
OpenAI calls (one vision read, one gpt-4o low-detail photo comparison); the count is printed before
the run starts. Flags: `--only owner_test`, `--limit N`, `--out file`, `--concurrency N`,
`--dump-images dir` (writes each query image, to eyeball the synthetic ones).

Regenerate the synthetic cases (read-only catalogue query):

```sh
docker exec -w /tmp/evalapp erp-backend node server/scripts/visual-eval/buildSyntheticCases.js --tenant 1 --per-model 2
```
