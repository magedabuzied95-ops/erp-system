# TikTok API for Business — Comments + Business Messaging

Date: 2026-08-15. Status: **audit + architecture + dormant implementation**.
Not deployed. No migration executed. No credential stored. No live TikTok call made.

Companion to [`tiktok-integration-audit.md`](tiktok-integration-audit.md), which covers the
*other* TikTok app (Login Kit / Content Posting) that is already live in production.

---

## Status matrix

| Item | Status |
| --- | --- |
| Developer App `M1 Store ERP` (business-api.tiktok.com) | `PENDING` |
| Business Messaging | `WAITING_FOR_TIKTOK_BUSINESS_MESSAGING_PERMISSION` |
| Comments | `WAITING_FOR_TIKTOK_BUSINESS_APP_APPROVAL` |
| Catalog | `NOT_IMPLEMENTED` (audit only, this round) |
| TikTok Content Posting (`M1 Store`) | `EXISTING / SEPARATE / NOT MODIFIED` |
| Production | `NOT DEPLOYED` |

---

## 1. The two TikTok integrations are not one integration

This is the single most important fact in this document, and the thing most likely to be
got wrong by a future change.

| | TikTok for Developers | TikTok API for Business |
| --- | --- | --- |
| App | `M1 Store` | `M1 Store ERP` |
| Portal | developers.tiktok.com | business-api.tiktok.com |
| Host | `open.tiktokapis.com` | `business-api.tiktok.com` |
| Credentials | `client_key` / `client_secret` | `app_id` / `app_secret` |
| Key identifier | `open_id` | `business_id` (organic) / `advertiser_id` (ads) |
| Env prefix | `TIKTOK_*` | `TIKTOK_BUSINESS_*` |
| Token envelope | `tk:v1` | `tkb:v1` |
| Tables | `tiktok_integration_configs`, … | `tiktok_business_connections`, … |
| Status route | `GET /api/tiktok/status` | `GET /api/tiktok-business/status` |
| State | **live in production** | **dormant, pending** |
| Capabilities | video publish/draft, status, webhooks | comments, business messaging (both blocked) |

There is no documented path by which a Content Posting access token is valid against
business-api.tiktok.com. Nothing in the Business layer reads `TIKTOK_CLIENT_KEY` or
`TIKTOK_CLIENT_SECRET`, and a test asserts it.

Cross-use is prevented cryptographically, not just by convention: the two encryption
services use different envelope prefixes **and** mix that prefix into the derived key. A
`tk:v1` token handed to the Business decryptor is rejected, and vice versa — even when both
fall back to the same `SECRET_ENCRYPTION_KEY`. Four tests cover this.

---

## 2. What official documentation actually confirmed

Research was restricted to TikTok's own published surfaces.

**Confirmed:**

- Two distinct comment API families exist, and conflating them would be a serious bug:
  - `/open_api/v1.3/comment/*`, keyed by `advertiser_id` — **ads** comments (Spark Ads).
    Verified against TikTok's own published SDK (`tiktok/tiktok-business-api-sdk`,
    `python_sdk/docs/CommentsApi.md`), which documents `comment/list`, `comment/post`,
    `comment/delete`, `comment/reference`, `comment/status/update` and the `blockedword/*`
    family. **This is not what Social Comments Center needs.**
  - `business/comment/*`, keyed by `business_id` — **organic** comments on an owned video.
    TikTok's official Postman collection for Business API v1.3 contains requests named
    "Business comment list", "Business comment reply", and "Business comment reply create",
    which confirms the family exists and roughly what it covers.
- A Business Messaging API exists under Business API v1.3.
- Business Messaging is **region-restricted**: unavailable for accounts registered in the
  EEA, Switzerland, or the UK. Our account is Egypt-registered, so this does not block us,
  but it must be re-checked at onboarding.
- Access requires an approved app plus a manual review; TikTok asks for business
  registration documents, a privacy policy URL, and data-handling details.

**Not confirmed, and deliberately not guessed:**

- exact endpoint paths, path segments, and version prefixes
- request/response parameter names
- literal permission/scope names for organic comment access
- webhook event names and the webhook signature algorithm
- whether hide/unhide, like/unlike, and pin/unpin exist at all for organic comments

Both `business-api.tiktok.com/portal/docs` and the Postman web viewer render client-side,
so neither could be read programmatically. They must be confirmed against the portal once
the app is approved.

Every unconfirmed detail is quarantined in exactly one constant per module —
`TIKTOK_BUSINESS_MESSAGING_WIRE`, `TIKTOK_BUSINESS_COMMENTS_WIRE`,
`TIKTOK_BUSINESS_WEBHOOK_CONTRACT` — each flagged `verified: false`. A test asserts all
three are false. No guessed path is presented as fact, and the live gates refuse to build a
request while the flag is false.

### Permission gap worth flagging

The pending application requests **Ad Account Management, Measurement, CTX Events
Management, TikTok Accounts**.

- **None of these is the Business Messaging grant.** Business Messaging is a separate
  application on top of an already approved app plus a Data Security & Privacy review.
- Organic comment access is *not obviously* covered either. "TikTok Accounts" is the
  plausible home for organic account/video/comment reads, but this is **unverified**.

This is recorded in code as `TIKTOK_BUSINESS_PERMISSION_GAPS` and surfaced in the status
endpoint, so the gap is visible rather than discovered after approval.

---

## 3. Existing architecture (audit)

### AI Inbox

The canonical store is `ai_channel_conversations` + its messages table, tagged by `channel`,
not by provider: `facebook_messenger | instagram | whatsapp | telegram | web_chat |
facebook_comment | instagram_comment`. Comments are stored as conversations with a comment
channel; there is no separate `social_comments` table.

A channel is declared in four places:

| Layer | File |
| --- | --- |
| Backend enum | `server/services/aiChannelAdapterService.js` (`AI_AGENT_CHANNELS`) |
| Frontend vocabulary | `src/modules/aiSupport/services/inboxChannels.js` |
| Inbox UI | `AiInbox.jsx`, `AiInboxPwa.jsx` |
| Channels page | `AiChannels.jsx` |

**TikTok has been added to none of them, on purpose.** Registering the channel would make it
selectable, and a selectable channel that cannot load produces either an error or an empty
list — and an empty list reads as "this customer has no messages", which is false.
`AI_INBOX_MESSAGE_CHANNELS` is unchanged, so the "All" fan-out is unchanged.

What a TikTok provider must supply to become a first-class channel: conversation + message
identity mapped onto the canonical store, an idempotency key for at-least-once intake,
inbound normalization, a send path with per-conversation capability checks (TikTok is
expected to impose a reply window — do **not** assume every conversation is replyable),
media upload/download, and unread/lead state driven by the same canonical rows so AI modes,
automation rules, and Customer 360 work unchanged.

### Social Comments Center

`socialCommentsCenterService.js` is 4,948 lines and **was still a Facebook/Instagram binary**
— the earlier audit's finding is still accurate:

```js
const normalizePlatform = (v) => (lower(v) === "instagram" ? "instagram" : "facebook");
```

with 22 `instagram_comment` sites embedded in raw SQL `CASE` expressions. See §5 for what
was done about it.

---

## 4. What was built this round

All of it dormant. Nothing user-visible changes except one new read-only settings card.

### Configuration (`tiktokBusinessConfigService.js`)

`TIKTOK_BUSINESS_ENABLED`, `TIKTOK_BUSINESS_APP_ID`, `TIKTOK_BUSINESS_APP_SECRET`,
`TIKTOK_BUSINESS_REDIRECT_URI`, `TIKTOK_BUSINESS_COMMENTS_ENABLED`,
`TIKTOK_BUSINESS_MESSAGING_ENABLED`, `TIKTOK_BUSINESS_WEBHOOK_ENABLED`,
`TIKTOK_BUSINESS_ENCRYPTION_KEY`. Names only in `.env.example`, all values empty, all flags
`false`.

Fails closed: `assertTikTokBusinessReady()` throws `TIKTOK_BUSINESS_DISABLED` when the flag
is off and `TIKTOK_BUSINESS_CONFIG_INVALID` when the flag is on without credentials. It
never degrades into a half-working integration. Validation reports every problem at once.

### Security (`tiktokBusinessCryptoService.js`)

AES-256-GCM, random 96-bit IV, authenticated tag, `tkb:v1` envelope. `JWT_SECRET`, Meta
encryption behaviour, and `tiktokCryptoService.js` are **unmodified**.

`TIKTOK_BUSINESS_ENCRYPTION_KEY` is the **only** key material this module reads. There is no
fallback to `SECRET_ENCRYPTION_KEY`, `JWT_SECRET`, or `TIKTOK_ENCRYPTION_KEY`, and a test
asserts the file references exactly one environment variable.

A fallback would widen the blast radius of every other platform secret: a `JWT_SECRET` leak
would also expose stored Business access tokens, and rotating `JWT_SECRET` would silently
invalidate every stored Business token with no error until the next decrypt. It would also
remove the ability to rotate Business credentials independently, which is the point of
keeping this app's secrets separate.

Behaviour is split by the enable flag:

| `TIKTOK_BUSINESS_ENABLED` | Key state | Result |
| --- | --- | --- |
| false / unset | absent | dormant and silent — **never a boot failure** |
| true | absent | fail closed, `TIKTOK_BUSINESS_ENCRYPTION_KEY_MISSING` |
| true | too weak | fail closed, `TIKTOK_BUSINESS_ENCRYPTION_KEY_WEAK` |
| true | valid | operational |

Nothing reads key material at import time, so a cold boot with no key set cannot throw. The
strength gate requires ≥32 characters, ≥8 distinct characters, and rejects placeholder values.
Diagnostics return a code only — never the key, never its length. Domain separation still
holds on top of all this: the envelope prefix is mixed into the derived key, so even setting
this variable to the same string as another secret yields a different AES key.

No key was generated, no production environment was changed, and `.env.example` carries the
name with an empty value.

No plaintext tokens, no token/secret logging (failures log tenant + field + code only), no
credentials in the frontend, no secrets in git.

### Providers

`tiktokBusinessMessagingProvider.js` and `tiktokBusinessCommentsProvider.js` expose real
contracts. Every network-facing method throws a typed `501` error carrying the status code —
**never `return []`**. Capabilities are `false` (confirmed unavailable) or `null` (existence
unconfirmed), never `true`; `null` must render as a disabled control, never as "off".

The pure helpers *are* implemented and unit-tested, because they need no credentials and
having them now makes the post-approval work "correct the field map" rather than "write a
mapper": conversation/message/comment normalizers, `parsePageInfo` (a cursor without
`has_more` is never followed — that is how poll loops become infinite), and idempotency key
builders. Normalizers return `null` for an id-less payload rather than inventing identity.

### Database

`server/database/migrations/2026-08-15-add-tiktok-business-integration.sql` — additive only,
every statement `IF NOT EXISTS`, no drop, no rewrite, **not executed and not wired to any
`ensure*Schema()` bootstrap**.

`tiktok_business_connections`, `tiktok_business_oauth_states`,
`tiktok_business_webhook_events`, `tiktok_business_message_map`,
`tiktok_business_comment_map`, `tiktok_business_sync_cursors`.

Messaging and comments reuse the **canonical** stores; these are mapping tables holding only
the TikTok-side identifiers, dedupe keys, and cursors that the canonical model has nowhere to
put. A parallel inbox would fork unread state, AI modes, automation rules, and identity.

`business_id` and `advertiser_id` are separate columns specifically so the organic and ads
keys can never be confused.

### Routes

- `GET /api/tiktok-business/status` — mounted, RBAC `permit("marketing","settings")`,
  reports the pending state, the requested permissions, the precise blockers, and an explicit
  pointer that publishing is a different integration.
- `server/routes/tiktokBusinessWebhook.js` — written but **not mounted**. Mounting it would
  expose a new unauthenticated public endpoint that TikTok has never been given, so the only
  traffic it could receive today is unsolicited. Returns `503`, never `200` — a `200` would
  tell TikTok the event was accepted and stop its retries.

No OAuth route: the Business authorization flow needs an App ID that does not exist yet, and
its contract differs from Login Kit's and has not been read.

### UI

New read-only card `TikTokBusinessCard.jsx` on Channel Settings, directly beneath the
publishing card. The existing card is retitled **"TikTok Publishing"** and its subtitle now
says it excludes DMs and comments. The new card is titled **"TikTok Business Messaging &
Comments"** with a pending badge, and states in one sentence that connecting an account for
posting does not grant messaging or comments.

There is no Connect button — the app is pending, so no flow can start; a disabled button
would imply it merely needs a click. AR + EN strings added for every new key.

**No TikTok tab was added to the AI Inbox.** No fake conversations, unread counts, health, or
connected state anywhere.

---

## 5. Social Comments Center — the conservative seam

The binary was real and still present. A full conversion of ~30 raw-SQL `CASE` sites across a
4,948-line file carries real regression risk to two live Meta channels and buys nothing until
TikTok comments actually work.

What was done instead — `server/services/socialCommentPlatforms.js`:

- A registry of `facebook | instagram | tiktok` with channel names and capability flags.
- `normalizePlatform` moved into it **byte-for-byte unchanged**. A regression test runs 19
  inputs (including `null`, `undefined`, numbers, `"instagram_comment"`, and `"tiktok"`)
  through both the old inline implementation and the new one and asserts equality.
- `tiktok` is registered but marked `normalizable: false`, so it is **not reachable** through
  `normalizePlatform` and cannot leak into the Meta SQL sites.
- `assertMetaPlatform()` is the new safety property: a non-Meta platform reaching a Meta
  query path throws `NON_META_COMMENT_PLATFORM` instead of being silently treated as
  Facebook. Nothing can trip it today — which is exactly why it is safe to add now.

`socialCommentsCenterService.js` changed by one import line plus a comment. Facebook and
Instagram SQL semantics, pagination, counts, and reply/hide/like behaviour are untouched.

Converting the ~30 SQL sites and flipping `normalizable: true` remains outstanding, and is
the correct first task once TikTok grants access.

---

## 6. Plans (post-approval)

**OAuth.** Read the Business authorization docs first — do not assume Login Kit parity.
Registered redirects: `https://api.m1store-egy.com/api/tiktok-business/oauth/callback`
(advertiser) and `https://erp.m1store-egy.com/admin/ai-channels` (TikTok account holder);
`redirect_kind` on `tiktok_business_oauth_states` records which one a flow started from so the
callback validates against the right one. Single-use state token, single-flight refresh lock
(the Content Posting refresh token rotates; assume the Business one does too until proven
otherwise).

**Webhook.** Read the Business webhook docs. Do **not** copy the Content Posting contract
(`TikTok-Signature: t=…,s=…`, `HMAC-SHA256(client_secret, "<t>.<raw body>")`) — different app,
different host, different credential. A guessed signature check either rejects genuine events
or accepts forged ones. Then: raw-body carve-out in `server.js`, durable event table, async
worker, replay window, dedupe on `event_key`.

**Comments.** Confirm paths/params/permission names. Convert the binary SQL sites, flip
`normalizable: true`, implement the provider against the confirmed contract. Ingestion is
**poll-only** — there is no comment webhook on either TikTok surface. Any capability TikTok
does not support stays visibly disabled; no fake success.

**Messaging.** Confirm the contract, register the channel in all four layers, wire intake
through the existing canonical path. Check per-conversation capabilities before every send.

**Catalog.** Audit only, as scoped. ERP products would map to a TikTok catalog feed along the
lines of the existing `metaCatalogFeedService.js` / `googleMerchantFeed.js` pattern —
product identity, variant/size mapping, price and availability sync. Priority order remains
Comments → Messaging → Catalog. Nothing implemented.

---

## 7. Remaining blockers

1. **TikTok approves `M1 Store ERP`.** Everything else is downstream. `PENDING`.
2. **Business App ID issued.** No OAuth can be written or tested without it.
3. **Data Security & Privacy review** completed.
4. **Business Messaging permission** granted — a separate application, and *not* among the
   four permissions on the pending app.
5. **Organic comment permission confirmed** — possibly "TikTok Accounts", unverified.
6. **Endpoint paths, parameters, scope names, webhook signature contract** read from the
   portal. Not machine-readable today.
7. **Region eligibility re-checked** at onboarding (EEA/CH/UK are excluded; Egypt is not).

Nothing in this list can be worked around from our side, and none of it was faked.
