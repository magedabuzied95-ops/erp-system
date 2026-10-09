# Telegram catalog channels

The storefront catalogue, mirrored into one Telegram channel per audience — men,
women, kids — with **one post per product colour** and the available sizes kept
current inside each post's caption. A shopper orders from the post.

Control surface: **AI Studio → Telegram channels** (`/marketing/telegram-channels`).

---

## What a post is

One post = one product **colour**, the same unit the storefront card, the AI
Inbox product card and the Meta catalogue feed all use
(`card_id = <product id>:<colour key>`). A post is created once with `sendPhoto`
and after that it is **only ever edited**:

| In the catalogue | Post exists | What happens |
| --- | --- | --- |
| yes | no | `sendPhoto` — a new post |
| yes | yes, caption changed | `editMessageCaption` |
| yes | yes, caption unchanged | **nothing** |
| yes, new photo | yes | `editMessageMedia` |
| no (sold out / hidden) | yes | `editMessageCaption`, carrying the sold-out line |

Nothing is ever deleted by the sweep. A sold-out colour keeps its post, its
link, its views and its forwards, and **the same post** comes back to life when
the colour is restocked.

### Why the caption is hashed

A real catalogue is thousands of colours and Telegram starts refusing around
**20 messages a minute to one channel**. So the sweep renders the caption, hashes
it with the buttons and the photo URL, and compares that against
`telegram_catalog_posts.caption_hash`. An unchanged colour costs zero Telegram
calls. This is the whole reason the feature fits inside the rate limit — the
sizes are even sorted into a stable order so the same set never looks like a
change.

---

## What the catalogue is read from

`buildStorefrontColorCardsForAudience()` in
[storefrontController.js](../server/controllers/storefrontController.js) — the
**listing page's own builder**, not a second query. Same product-level and
size-level visibility, same colour expansion, same canonical price. A colour the
storefront hides is a colour the channel never offers.

---

## Turning it on

1. **Create the channels in Telegram** (public, one per audience) and **add the
   bot as an administrator with permission to post**. Without admin rights every
   post comes back `chat not found` or `not enough rights`.
2. **Get each channel's id.** Either the `@username`, or the numeric id
   (`-100…`) — forward a channel message to `@userinfobot`, or read it from the
   `channel_post` payload in `telegram_webhook_updates`.
3. **Server environment** — already required by the AI Inbox Telegram channel:
   - `TELEGRAM_BOT_TOKEN`
   - `PUBLIC_BACKEND_URL` — the photo URL Telegram downloads. An upload served
     from the SPA origin answers `200` with HTML and Telegram refuses it.
   - `STORE_FRONT_URL` — the storefront origin the buttons point at.
4. **Settings** (`ai_channels` category):
   - `telegram.catalog_enabled` → on. **Off by default**: switching it on posts
     the whole catalogue into public channels.
   - `telegram.catalog_bot_username` → the shop bot, without the `@`.
   - `telegram.catalog_order_mode` → `mini_app` / `bot` / `both`.
   - `telegram.catalog_posts_per_minute` → 12 by default, 20 is Telegram's wall.
   - `telegram.catalog_caption_template`, `telegram.catalog_sold_out_label`.
5. **Paste the chat ids** into the control page and switch each channel on.
6. **Sweep.** The first sweep queues one `create` per colour and the queue drains
   at the configured rate — a 2,000-colour catalogue takes a few hours by
   design. Watch the queue counters on the page.
7. **Verify the schema** after a deploy:
   ```
   node server/scripts/verifyTelegramCatalogSchema.js
   ```

---

## How an order happens

A channel post **cannot** carry a mini-app button: Telegram allows `web_app`
buttons only inside a private chat with the bot. Getting that wrong is a `400`
on every post, so the post's buttons are plain URLs:

```
channel post
  ├── 🛒 اطلب الآن   → https://t.me/<bot>?start=<token>   (a private chat)
  └── 🔗 على الموقع  → https://<storefront>/product/<slug>?color=<key>
```

The bot answers `/start <token>` with **that exact colour** — same photo, same
caption — and a `web_app` button that opens the storefront's existing one-page
checkout inside Telegram. The money path is unchanged: the server stays the
single authority on price, stock and shipping, and Telegram adds no second way
to pay for anything.

The `<token>` is `c` + 12 hex characters derived from the card id, stored on the
post row. A Telegram start payload allows only `[A-Za-z0-9_-]` and 64
characters, which an Arabic colour key would blow straight through.

Inside the webview, [telegramWebApp.js](../src/storefront/lib/telegramWebApp.js)
loads Telegram's bridge **only** when the URL fragment says we are in a mini app
(`#tgWebAppPlatform=…`) and calls `expand()` — Telegram otherwise opens the view
at about half the screen height, and a checkout in half a phone screen is a
checkout nobody finishes.

---

## Moving parts

| File | Job |
| --- | --- |
| [shared/telegramCatalogDefaults.js](../shared/telegramCatalogDefaults.js) | caption template, size order, price format |
| [telegramCatalogService.js](../server/services/telegramCatalogService.js) | schema, settings, channels, posts, queue |
| [telegramCatalogPublisherService.js](../server/services/telegramCatalogPublisherService.js) | what should change (the diff) |
| [telegramCatalogWorkerService.js](../server/services/telegramCatalogWorkerService.js) | the paced drain + the sweep |
| [telegramShopBotService.js](../server/services/telegramShopBotService.js) | `/start <token>` → the colour + checkout |
| [telegramBotService.js](../server/services/telegramBotService.js) | Telegram API primitives, deep links |
| [routes/telegramCatalog.js](../server/routes/telegramCatalog.js) | `/api/telegram/catalog/*` |
| [TelegramChannels.jsx](../src/modules/marketing/pages/TelegramChannels.jsx) | the control page |

Tables: `telegram_channels`, `telegram_catalog_posts`, `telegram_catalog_jobs`
(migration `2026-10-09-telegram-catalog-channels.sql`, also applied by
`ensureTelegramCatalogSchema()` at boot).

### When the sweep runs

Every `telegram.catalog_sync_minutes` (15 by default), **and** immediately —
debounced 30s — on the same cache-invalidation signal the storefront's own
section cache follows (`invalidateCachePattern("storefront…")`), which every
product save and live stock movement already goes through. The interval is the
safety net, not the trigger.

---

## Known limits

- **A timed-out `sendPhoto` can post twice.** Telegram downloads the photo
  before it answers, so the media calls get a 30s timeout
  (`TELEGRAM_MEDIA_TIMEOUT_MS`). If that aborts *after* Telegram accepted the
  post, the message id is never recorded and the retry posts the colour again.
  Telegram offers no idempotency key for `sendPhoto`; the timeout is the
  mitigation.
- **Removing a channel from the control page does not remove its posts from
  Telegram.** Nothing can, without deleting a shopper's view of the shop from a
  settings screen. The rows go, the posts stay as orphans.
- **A colour with no usable photo is skipped**, not posted as text.
- **A live post whose stored facts are missing is left alone** rather than
  overwritten with a nameless sold-out caption.
- **Telegram has no discovery.** Unlike a Meta catalogue, a channel brings no
  audience of its own: it has to be advertised from Instagram, WhatsApp and the
  invoices.
