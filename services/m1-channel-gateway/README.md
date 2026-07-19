# M1 Channel Gateway

Independent transport boundary for current and future M1 ERP messaging channels. This service owns channel normalization, durable delivery jobs, retry/recovery, deduplication, idempotency, encrypted connection configuration, health data, and adapter lifecycle. It does not contain ERP business logic and it does not run browser automation in the ERP backend.

## Safety defaults

- No adapter or browser bridge is registered in this foundation release.
- `CHANNEL_GATEWAY_WORKER_ENABLED=false` by default.
- Database migrations never run at service startup.
- PostgreSQL is the source of truth. Redis loss cannot delete accepted messages or jobs.
- `/health/ready` fails when a migration is pending or an applied migration checksum changed.
- Every `/v1` request requires an HMAC signature and a one-time nonce.
- Shadow mode rejects the inbound and outbound transport endpoints even when the API is running.

## Explicit setup

1. Copy `.env.example` to `.env` and replace every secret.
2. Apply the service-owned migrations explicitly with `npm run migrate`.
3. Start the API with the worker disabled and verify `/health/live` and `/health/ready`.
4. Register and test a channel adapter in a later phase.
5. Enable the worker only after the ERP transactional-outbox consumer is approved.

## Shadow mode

The safe test configuration is:

```text
CHANNEL_GATEWAY_ENABLED=false
CHANNEL_GATEWAY_SHADOW_MODE=true
CHANNEL_GATEWAY_OUTBOUND_ENABLED=false
CHANNEL_GATEWAY_INBOUND_ENABLED=false
CHANNEL_GATEWAY_COMPARE_ENABLED=true
CHANNEL_GATEWAY_WORKER_ENABLED=false
```

For an approved local shadow test only, set `CHANNEL_GATEWAY_ENABLED=true` while keeping inbound, outbound, and the external worker disabled. The shadow consumer then reads `erp_channel_outbox_events`, validates and compares each event, and writes `channel_shadow_comparison_results`. It never writes an AI Inbox message and never emits a WebSocket event.

## Phase 3 Instagram pilot

The independent `m1-instagram-bridge` service is an opt-in test-account-only Playwright adapter. It is disabled by default and runs only through the `instagram-pilot` Compose profile. The Gateway owns durable inbound/outbound queues, mapping, dedupe, reconciliation, and ERP delivery; the bridge owns only Instagram browser interaction.

Pilot limits are enforced in code: text only, manual employee outbound only, AI `draft_only`, no media, no reactions, no broadcast, no Messenger, and no production M1 Store account. An uncertain send is stored as `sent_unconfirmed` and reconciled before any retry.

Poison events retry on the standard schedule and move to `dead_letter`. The protected manual retry endpoint is `POST /v1/shadow/events/:eventId/retry`.

No migration, deployment, bridge login, or worker cutover is performed automatically.

## Adapter contract

Every channel adapter must implement:

```text
connect
disconnect
getHealth
syncConversations
syncMessages
sendText
sendMedia
markAsRead
restart
```

An adapter receives normalized transport data only and must not import or call ERP business services.

## HMAC request contract

Protected requests contain:

```text
X-M1-Timestamp: unix epoch in milliseconds
X-M1-Nonce: unique random value
X-M1-Signature: hex HMAC-SHA256
```

The signed value is:

```text
timestamp.nonce.METHOD.originalPath.sha256(exactRawBody)
```

Accepted nonces are reserved durably in PostgreSQL to prevent replay even when Redis is unavailable.

## Durable queue behavior

- Idempotent enqueue returns the original job when the same tenant/key is repeated.
- PostgreSQL lane locks allow only one active job per external conversation.
- Different conversations can be processed concurrently.
- Retry intervals are 30 seconds, 1 minute, 2 minutes, 5 minutes, 10 minutes, and 30 minutes.
- The next failure is moved to `needs_manual_review`.
- Expired processing locks are recovered after a worker restart.

## Tests

Unit tests run without infrastructure:

```text
npm test
```

PostgreSQL integration tests run when `GATEWAY_TEST_DATABASE_URL` is set. They create a uniquely named temporary schema and remove it after the run; they do not use or change ERP tables.
