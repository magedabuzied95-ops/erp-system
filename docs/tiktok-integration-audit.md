# TikTok Integration — Phase 0–2 Audit (no code changed yet)

Date: 2026-08-14. Status: **research + design only**. No files modified, no migration run,
no deploy, no credentials stored anywhere.

---

## PHASE 0 — Baseline

| Item | Value |
| --- | --- |
| HEAD | `33631e7dfaa7d42c948899e8b6f41f6f4461fe67` (`feat(ai-inbox): add durable Telegram channel`) |
| Branch | `feature/ai-workflow-triggers` |
| `origin/main` | `1849a27eef8d000a3c95ab7a008fce891b228767` |
| Worktree | dirty — 26 modified, 25 untracked (AI Inbox / M1 / i18n work in flight) |
| Stashes | 2 (`WIP AI Inbox 200 conversations and SW bump`, `autostash`) |

No `reset`, `clean`, `checkout --`, force push, or history rewrite was performed and none is
planned. All existing modified/untracked work is untouched.

> **Worktree hazard.** This directory is shared with other concurrent sessions that switch
> branches mid-task. Any TikTok work should land on its own branch and be committed in small
> increments rather than left uncommitted.

### Gitignore trap (critical for this integration)

`.gitignore` contains `server/services/*` with an explicit `!` allowlist. **A new
`server/services/tiktok*.js` will be silently untracked and will never deploy** unless an
allowlist line is added in the same commit. Same applies to `services/` unanchored (already
patched for `src/**/services/`).

---

## PHASE 1 — Existing social architecture

### Canonical store

`ai_channel_conversations` (+ its messages table) is the real canonical model. It is
channel-tagged, not provider-tagged:

- `channel` — `'facebook_messenger' | 'instagram' | 'whatsapp' | 'telegram' | 'web_chat' | 'facebook_comment' | 'instagram_comment'`
- `external_conversation_id`, `external_customer_id`, `customer_name`, `customer_avatar_url`,
  `thread_kind`, `metadata JSONB`
- Comments are stored as **conversations with a comment `channel`**, not in a separate table.
  There is no `social_comments` table.

### Channel registry — the four places a channel is declared

| Layer | File | What to add |
| --- | --- | --- |
| Backend enum | `server/services/aiChannelAdapterService.js` (`AI_AGENT_CHANNELS`) | `TIKTOK_COMMENT: "tiktok_comment"` |
| Frontend vocabulary | `src/modules/aiSupport/services/inboxChannels.js` | filter map + window |
| Inbox UI | `src/modules/aiSupport/pages/AiInbox.jsx`, `AiInboxPwa.jsx` | tab + icon |
| Channels page | `src/modules/aiSupport/pages/AiChannels.jsx` | connection card |

The Telegram commit `33631e7` is the exact precedent: **18 files, ~877 insertions**, one
additive migration, a durable webhook-intake table, an intake worker, and a webhook route
mounted twice. This is the template to copy.

### OAuth / token precedent (Meta)

- Route shape: `GET /api/meta/oauth/start` (behind `protect` + `permit("marketing","settings")`)
  and `GET /api/meta/oauth/callback` (public), mounted at `app.use("/api/meta", metaWebhookRoutes)`.
- State table `meta_oauth_states`: `state_token TEXT UNIQUE`, `tenant_id`, `user_id`, `status`,
  `expires_at`, `error_message`. Exactly the model TikTok needs.
- Config table `meta_integration_configs`: one row per tenant, `*_encrypted` token columns,
  `token_expires_at`, `status`, `last_sync_at`, `capability_status JSONB`.

### Encryption (reuse — do not invent)

`server/services/metaIntegrationService.js:2409` — AES-256-GCM, key =
`sha256(SECRET_ENCRYPTION_KEY || JWT_SECRET)`, envelope `enc:v1:<iv>:<tag>:<ct>`, with a
`tryDecryptSecret` wrapper that logs failure without the value. TikTok tokens must use this
same envelope. It is currently private to the Meta monolith and should be lifted into a shared
`server/services/secretEnvelope.js` (behaviour-identical, Meta re-imports it) rather than
copy-pasted.

### Webhook raw-body precedent

`server/server.js:1436/1518/1546` already special-cases `POST /api/meta/webhook` to retain the
raw body for signature verification. TikTok's `TikTok-Signature` HMAC is computed over the raw
JSON, so `POST /api/webhooks/tiktok` needs the same treatment — this is a **server.js body-parser
change**, easy to miss.

### The blocker for comments: no provider abstraction

`socialCommentsCenterService.js` is 4,831 lines and models platform as a **binary**:

```js
const normalizePlatform = (v) => (lower(v) === "instagram" ? "instagram" : "facebook");
```

with ~30 sites of `channel = 'instagram_comment' ? 'instagram' : 'facebook'` embedded in raw
SQL `CASE` expressions. There is **no provider/adapter interface for comments**. The
`aiChannelAdapters/*.js` files are 12–15-line send-only shims, not a real abstraction.

**Consequence:** "add a TikTok provider to the existing abstraction" is not possible for
comments today, because the abstraction does not exist. It has to be introduced first
(`normalizePlatform` → registry, SQL `CASE` → a generated channel↔platform map) as a
behaviour-preserving refactor, before TikTok can be a third platform. Publishing
(`socialPublisherService.js`, 745 lines) is far smaller and is a reasonable place to add a
provider seam directly.

---

## PHASE 2 — TikTok capability matrix (official docs only)

Verified against `developers.tiktok.com` (Aug 2026). No scraping, no unofficial endpoints.

| Function | Official API | Product | Scope / permission | Needs review? | Doable now? |
| --- | --- | --- | --- | --- | --- |
| Login (OAuth v2) | `GET https://www.tiktok.com/v2/auth/authorize/` → `POST https://open.tiktokapis.com/v2/oauth/token/` | Login Kit | `user.info.basic` | Yes (all scopes) | ✅ build now |
| Profile (name/avatar) | `GET /v2/user/info/` | Login Kit | `user.info.basic` (+`user.info.profile`, `user.info.stats` optional) | Yes | ✅ build now |
| Token refresh | `POST /v2/oauth/token/` `grant_type=refresh_token` | Login Kit | — | — | ✅ build now |
| Revoke | `POST /v2/oauth/revoke/` | Login Kit | — | — | ✅ build now |
| Creator info (required pre-post) | `POST /v2/post/publish/creator_info/query/` | Content Posting | `video.publish` | Yes | ✅ build now |
| Direct Post (video) | `POST /v2/post/publish/video/init/` | Content Posting → Direct Post | `video.publish` | Yes | ✅ build now |
| Upload to Draft (video) | `POST /v2/post/publish/inbox/video/init/` | Content Posting | `video.upload` | Yes | ✅ build now |
| Photo post | `POST /v2/post/publish/content/init/` (`media_type: PHOTO`, `post_mode: DIRECT_POST`) | Content Posting | `video.publish` | Yes | optional |
| Publish status | `POST /v2/post/publish/status/fetch/` | Content Posting | same as init | — | ✅ build now |
| Webhooks | your HTTPS endpoint | Webhooks | — | — | ✅ build now |
| **Read comments** | `/open_api/v1.3/business/comment/list/` | **TikTok API for Business** | Business Account authorization (`business_id`), **not** Login Kit | Separate access request | ❌ **blocked** |
| **Reply to comment** | `/open_api/v1.3/business/comment/reply/create/` | TikTok API for Business | same | Separate | ❌ blocked |
| **Like comment** | Business Account API | TikTok API for Business | same | Separate | ❌ blocked |
| **Hide / unhide comment** | Business Account API (comment status) | TikTok API for Business | same | Separate | ❌ blocked |
| **Delete own reply** | Business Account API | TikTok API for Business | same | Separate | ❌ blocked |

### The finding that changes the plan

**Login Kit does not grant comment access.** They are two different developer surfaces:

1. **TikTok for Developers app** (what we have — `M1 Store`, `client_key`/`client_secret`,
   Login Kit + Content Posting + Webhooks). This surface has **no comment API at all**.
2. **TikTok API for Business** — a separate portal (`business-api.tiktok.com`), a separate app
   with `app_id`/`secret`, and a separate authorization producing a `business_id` +
   advertiser/business access token. Comment management (list / reply / like / hide / delete on
   an owned video) lives **only** here, and Business Account (organic) API access is granted by
   application/allowlist, not by ordinary App Review.

There is also a `/open_api/v1.3/comment/*` family that takes `advertiser_id` — those are **ads
comments** (Spark Ads), a different thing from organic video comments. Do not conflate them.

Exact `business/comment/*` paths and the organic scope names could not be confirmed from the
portal (it renders client-side and is not machine-readable). They must be confirmed against the
portal once Business Account access is granted — **the adapter must not hardcode unverified
paths as if verified.**

**Therefore Phase 11 lands as architecture + a declared state, not an implementation:**
`WAITING_FOR_TIKTOK_BUSINESS_PERMISSION`. No fake comment implementation.

### Webhooks — verified specifics

- Signature header: `TikTok-Signature: t=<unix>,s=<hex>`
- Algorithm: `HMAC-SHA256(client_secret, "<t>" + "." + <raw body>)` — **raw body required**
- Must return `200` immediately; process async
- **At-least-once** delivery → idempotency mandatory
- Retries with exponential backoff for up to 72 hours, then dropped
- Event types (complete list): `authorization.removed` (field `reason` 0–5),
  `video.upload.failed` (`share_id`), `video.publish.completed` (`share_id`),
  `portability.download.ready` (`request_id`). Base fields on every event: `client_key`,
  `event`, `create_time`, `user_openid`, `content` (serialized JSON string).
- **There is no comment webhook.** Comment ingestion, if ever unblocked, must be polled.

### Token lifetimes

- `access_token`: **86,400 s (24 h)** — much shorter than Meta's 60 days. Refresh-before-use is
  mandatory, not a background nicety.
- `refresh_token`: **31,536,000 s (365 days)**, and it **rotates** on each refresh — the new
  `refresh_token` in the response must be persisted or the connection dies.

---

## PHASE 18/19/20 — Portal values (derived from the audit, not guessed)

### Redirect URI
```
https://api.m1store-egy.com/api/tiktok/oauth/callback
```
Mirrors `META_REDIRECT_URI=https://api.m1store-egy.com/api/meta/oauth/callback`. TikTok requires
HTTPS, no query string, no fragment — this satisfies both.

### Webhook Callback URL
```
https://api.m1store-egy.com/api/webhooks/tiktok
```
Mirrors the Telegram mount `app.use("/api/webhooks/telegram", …)`.

### Platform
**Web** — correct. The ERP is a browser app; the OAuth callback is a server-side HTTPS endpoint.
Web means **no PKCE** (`code_verifier` is mobile/desktop-only) and the `client_secret` stays
server-side, which is what we want.

### Products
- Login Kit
- Content Posting API (with **Direct Post** enabled)
- Webhooks

Not TikTok API for Business — that is a separate portal and a separate request, deferred.

### Scopes (literal names)
- **Login / Profile:** `user.info.basic` — required. `user.info.profile`, `user.info.stats` only
  if the UI actually shows bio/verification/follower counts; do not request unused scopes.
- **Upload (draft):** `video.upload`
- **Direct Post:** `video.publish`
- **Webhooks:** *no scope* — webhooks are enabled per-app, not per-scope.
- **Business / Comments:** *none available on this app type.* Deferred to a TikTok API for
  Business application.

### Domain verification — **not needed now**
Required only for `PULL_FROM_URL`. We will use `FILE_UPLOAD` (`source: FILE_UPLOAD`, chunked PUT
to the returned `upload_url`), so no domain verification is required. If we later switch to
`PULL_FROM_URL` to avoid proxying video bytes through the backend, verification of
`api.m1store-egy.com` becomes mandatory at that point.

### Environment variable names (names only — no values)
Following the existing `META_*` / `TELEGRAM_*` convention:
```
TIKTOK_ENABLED
TIKTOK_CLIENT_KEY
TIKTOK_CLIENT_SECRET
TIKTOK_REDIRECT_URI
TIKTOK_WEBHOOK_ENABLED
TIKTOK_INTAKE_POLL_INTERVAL_MS
```
No `TIKTOK_WEBHOOK_SECRET` — TikTok signs with `client_secret`, so a separate secret would be
dead configuration. Token encryption reuses the existing `SECRET_ENCRYPTION_KEY`.

---

## Proposed build order (each step independently shippable)

| Step | Scope | Risk |
| --- | --- | --- |
| A | Extract `secretEnvelope.js` from the Meta monolith (behaviour-identical) | low, touches Meta |
| B | Migration: `tiktok_integration_configs`, `tiktok_oauth_states`, `tiktok_webhook_events` (additive) + gitignore allowlist | low |
| C | `tiktokApiClient.js` + `tiktokOAuthService.js`: authorize URL, callback, token exchange, refresh-with-rotation, single-flight refresh lock, revoke | medium |
| D | Routes `/api/tiktok/oauth/{start,callback,status,disconnect}` under existing RBAC | low |
| E | `AiChannels.jsx` TikTok card: 6 states, connect/reconnect/disconnect, no secrets rendered | low |
| F | Webhook `POST /api/webhooks/tiktok` + raw-body carve-out + durable event table + async worker (Telegram intake pattern) | medium |
| G | Publisher: provider seam in `socialPublisherService.js`, creator-info gate, Direct Post vs Draft as distinct user choices, FILE_UPLOAD, status polling | high |
| H | Tests: OAuth, tokens, webhooks, posting, plus Meta/Telegram regression | medium |
| I | Comments: refactor `normalizePlatform` binary → registry (behaviour-preserving), then TikTok stub at `WAITING_FOR_TIKTOK_BUSINESS_PERMISSION` | high, no user-visible feature |

Steps A–H deliver everything the App Review demo needs. Step I is architecture only until
TikTok grants Business Account access.
