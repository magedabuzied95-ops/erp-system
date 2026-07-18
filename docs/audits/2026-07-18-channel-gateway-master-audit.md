# M1 ERP Channel Bridges — Architecture Audit

**Date:** 2026-07-18  
**Scope:** Master Prompt — Part 1  
**Decision:** Audit complete; Channel Gateway implementation has not started.

## 1. Executive decision

The ERP already contains a substantial omnichannel core: a normalized channel model, a shared AI Inbox transcript, stable conversation/message identity fields, WhatsApp Evolution support, Meta webhook processing, Human Takeover, AI drafts, customer/order/product actions, and shared Web/PWA realtime events.

The correct strategy is therefore **not** to replace AI Inbox or rewrite its business logic. The Channel Gateway should be introduced as a separate service in front of the current ERP ingestion boundary, preserving the existing IDs, endpoints, database rows, WebSocket event names, and Human Takeover workflow.

Implementation must not begin until Part 2 fixes the external envelope, queue, idempotency, dedupe, and delivery contracts. The following issues are release blockers for a production Browser Bridge:

1. The ERP job queues are currently process-memory queues. Pending and dead-letter state is lost on restart and is not safe with multiple backend replicas.
2. Redis is optional and currently used only as a cache fallback; it is not the durable message queue or distributed lock for AI Inbox.
3. AI Inbox PWA is installable and realtime, but not offline-first. It has no IndexedDB outbox, durable draft store, Background Sync, or AI Inbox push subscription.
4. The service worker caches the shell and static assets only. It does not own API caching, message outbox recovery, push navigation, or badge synchronization.
5. The outbound send endpoint can load up to 1,000 conversations to resolve a recipient. This is a direct latency/scaling risk and must be replaced internally by an indexed lookup while keeping the public API compatible.
6. Runtime schema setup performs DDL, data backfills, duplicate deletion, and index creation from application services. This must be moved to versioned, observable migrations before Gateway rollout.
7. Conversation state is distributed across `ai_support_sessions`, `ai_support_messages`, `ai_channel_conversations`, and legacy `ai_conversations`. Their ownership contract needs to be frozen before introducing bridge traffic.
8. AI Inbox authorization is mostly mapped to generic `settings.view/edit`, not dedicated least-privilege Inbox actions.
9. Media metadata is normalized and displayed, but there is no complete Gateway-owned media download, validation, persistence, expiry, and replay pipeline.
10. No Instagram or Messenger Browser Bridge exists in the repository today. No Playwright/Puppeteer runtime should be added to the ERP backend.

## 2. Audit boundary and verification

Reviewed areas:

- React/Vite frontend and AI Inbox Web.
- AI Inbox standalone PWA, manifest, service worker, responsive behavior, realtime and pagination.
- Express backend, authentication, RBAC, routing and tenant scoping.
- PostgreSQL schemas, migrations, conversation/message identity, links to customer/order/product data.
- Socket.IO authentication, rooms, reconnect behavior and AI Inbox events.
- Evolution API configuration, webhook synchronization, sending and health status.
- Meta Messenger/Instagram webhook normalization, echoes and outbound sending.
- Jobs, retries, dedupe, cache and Redis usage.
- Docker, Nginx, deployment, uploads, backups and health checks.
- Notifications and existing web-push infrastructure.
- Existing tests and production build.

Baseline verification performed without production mutation:

- `npm run build`: passed.
- Seven relevant AI Inbox/PWA test files: **37 passed, 0 failed**.
- The tests cover channel presentation, Web/PWA parity in selected flows, Meta echo mapping, stable WhatsApp display identity, unread/read behavior, exact cursor pagination, product cards and lead actions.
- The tests do **not** yet cover durable queue recovery, browser session recovery, offline send, push deep links, multi-replica Socket.IO, Redis failure, media replay, or Android/iPhone acceptance.

## 3. Current system map

```text
WhatsApp Cloud / Evolution     Meta Messenger / Instagram     Website Chat
             \                         |                         /
              +---- current ERP routes and channel adapters ---+
                                      |
                         normalization + mapping
                                      |
             ai_support_sessions / ai_support_messages
                   + ai_channel_conversations mappings
                                      |
                       current AI and business logic
                                      |
                     ai_inbox:message / ai_inbox:refresh
                                      |
                         AI Inbox Web + AI Inbox PWA
```

The target insertion point is:

```text
Official APIs / Browser Bridges
              |
       Channel Gateway (new service)
              |
   versioned ERP ingestion/delivery contract
              |
 current normalized AI Inbox and business logic
```

The Browser Bridge must never import ERP code, access the ERP database, or emit ERP Socket.IO events directly.

## 4. Component audit matrix

| Area | Current state | Reuse | Required change | Decision |
|---|---|---|---|---|
| AI Inbox Web | Mature unified conversation UI with messages, products, customer/order actions, assignment, Human Takeover and AI drafts | Yes | Extract shared data/domain layer from the 8k-line page; preserve UI behavior | Keep |
| AI Inbox PWA | Dedicated mobile UI using the same API and Socket.IO events | Yes | Add durable local state, push, offline outbox and capability parity tests | Extend |
| Channel normalization | `aiChannelAdapterService` provides channel constants, incoming normalization, outgoing normalization and mapping | Yes | Make the normalized envelope versioned and transport-neutral | Refactor behind compatible facade |
| WhatsApp | Evolution and Cloud paths both exist; health and webhook sync exist | Yes | Put provider access behind Gateway transport; keep current path as fallback during migration | Dual-run then switch |
| Messenger/Instagram | Official Meta webhook extraction and outbound send already exist, including page echo mapping | Yes | Browser bridges must produce the same normalized envelope; later official API replacement changes adapter only | Extend |
| Browser Bridges | Not present | No | New independent service/containers and isolated browser profiles | Create outside ERP backend |
| Conversation identity | Canonical IDs and normalization helpers are widely used | Yes, mandatory | Add alias table only; never rewrite existing IDs | Freeze contract |
| Message identity | Provider/external/client/idempotency/dedupe keys and unique indexes exist | Yes | Define a single precedence and collision policy across Gateway and ERP | Freeze and document |
| Human Takeover | Persisted states and Web/PWA actions exist | Yes, mandatory | Gateway must query/receive state before auto-send; no duplicate state machine | Keep |
| AI drafts/corrections | Persisted suggestions, approval/edit learning and correction records exist | Yes | Add offline draft separation and conflict resolution | Extend |
| Product cards | Structured cards, variants, images and send endpoints exist | Yes | Gateway capability negotiation and fallback text/media policy | Extend |
| Customer/order links | Customer profiles, lead opportunities and draft orders are integrated | Yes | Gateway carries identity only; ERP remains business-data owner | Keep in ERP |
| Labels | No complete dedicated persisted AI Inbox label domain was found | Partial UI language only | Introduce additive label tables/API without changing conversation IDs | New additive feature |
| Internal notes | Supported as an internal message flow, but naming overlaps generic reply endpoints | Yes | Give notes an explicit compatible message type/endpoint alias | Harden |
| Realtime | Authenticated Socket.IO, tenant rooms, message/refresh events and reconnect exist | Yes | Add event version/sequence and shared adapter for multi-replica deployment | Extend compatibly |
| Queue | In-memory queues, retry and dead-letter arrays; optional adapter hook exists | Design can be reused | Implement durable Redis-backed queue in Gateway; no memory fallback for accepted production messages | Replace runtime backend |
| Redis | Optional cache client with memory fallback; Evolution test stack has separate Redis | Cache code only | Dedicated production Redis with namespaces, HA/persistence policy and explicit failure modes | Add infrastructure |
| Dedupe | DB unique indexes plus UI identity merging and queue-local dedupe | Yes | Gateway atomic idempotency and inbox/outbox ledgers; define TTL and permanent provider IDs | Extend |
| Media | Attachment JSON and product images supported; uploads served from disk/cloud URLs | Partial | Gateway media processor: fetch, size/type validation, checksum, storage, signed URLs and expiry recovery | Redesign pipeline |
| Notifications | In-app realtime notifications and push infrastructure exist for employee/manager portals | Partial | Add AI Inbox push subscriptions, message policy, deep link and badge logic | Extend |
| Authentication | JWT and tenant-aware Socket.IO exist | Yes | Service-to-service auth, key rotation, bridge enrollment and scoped credentials | Extend |
| Roles/permissions | Database RBAC exists | Yes | Dedicated `ai_inbox.*` and `channel_gateway.*`; compatibility mapping from settings permissions | Migrate additively |
| Docker/Nginx | Postgres/backend/frontend compose, health checks and WebSocket proxy exist | Yes | Separate Gateway/worker/Redis services, internal networks, volumes and readiness probes | Extend |
| Observability | Console logs, event logs and health/status endpoints exist | Partial | Structured logs, correlation IDs, metrics, traces, queue lag, session health and alerting | Redesign operational layer |

## 5. Backend audit

### Existing strengths

- The same router is exposed through `/api/ai-agent` and `/api/ai-inbox`, providing an existing compatibility alias.
- Incoming WhatsApp and Meta messages pass through normalization before AI and transcript persistence.
- Meta page echoes are treated as outbound/staff messages and mapped to the customer conversation.
- Message rows retain delivery status/error, provider IDs, source path, attachments, product cards, staff identity and timestamps.
- Human Takeover and Return to AI are persisted and exposed through both conversation and inbox endpoint aliases.
- Customer creation, lead/opportunity creation, assignment, order draft creation, product cards and read state remain ERP business logic.
- Socket events are tenant-scoped and both Web/PWA subscribe to `ai_inbox:message` and `ai_inbox:refresh`.

### Required backend work

1. Create one internal `ChannelIngressPort` and `ChannelDeliveryPort` contract. Existing routes become adapters to these ports.
2. Add a versioned service-to-service endpoint, for example `/internal/channel-gateway/v1/events`, without removing current webhook routes.
3. Use direct indexed conversation lookup for send/read/update operations. Do not scan the full Inbox.
4. Persist an immutable inbound envelope before invoking AI or business automations.
5. Separate provider acceptance from final delivery receipt: `accepted`, `queued`, `sending`, `provider_accepted`, `delivered`, `read`, `failed`, `dead_letter`.
6. Publish an outbox event in the same PostgreSQL transaction as message/state mutations; a worker then emits Socket.IO and Gateway jobs.
7. Move all startup DDL/data cleanup to versioned migrations with dry-run and rollback notes.
8. Introduce dedicated permissions while temporarily accepting the current `settings.view/edit` grants.

### Outbound latency finding

The current send route first loads/searches Inbox summaries and on a miss loads up to 1,000 conversations. This couples delivery latency to Inbox size and message hydration. It should become a direct query by tenant plus canonical/alias conversation identifiers. The external endpoint and response remain unchanged.

## 6. Database audit

### Existing core tables

- `ai_support_sessions`: canonical operational conversation state, AI/Human state, assignment, read state, customer data and draft metadata.
- `ai_support_messages`: transcript rows, identity fields, direction/sender, delivery state, attachments and product interaction data.
- `ai_channel_conversations`: channel/customer mapping and channel metadata.
- `ai_customer_profiles`, memories and interactions: CRM/AI context.
- `ai_lead_opportunities`, followups and reply corrections: sales/learning workflows.
- Channel event logs and inbound AI reply locks: diagnostics and duplicate protection.

### Identity fields already available

- Conversation: tenant, session ID, external conversation ID, external customer ID and channel mapping.
- Message: internal ID, provider message ID, external message ID, client request ID, message identity key, idempotency key and dedupe key.
- WhatsApp-specific: instance, remote JID, resolved reply JID and resolved phone.

### Data model risks

- Multiple conversation tables can drift because some writes update more than one table and ownership is implicit.
- Uniqueness policies differ between general, Meta and WhatsApp indexes.
- Schema setup in runtime code deletes duplicate rows before creating indexes. That is unsafe during rolling deployment and hard to audit.
- Some legacy IDs and aliases are normalized in place. Future work must use aliases rather than rewriting stable IDs.
- Timestamps are plain `TIMESTAMP` in important tables; Gateway contracts should require UTC and migrations should avoid silent timezone reinterpretation.

### Additive migration set proposed for Part 2

Names are provisional until the Part 2 envelope is accepted:

1. `channel_accounts` — tenant/channel/provider account and capability state; secrets remain in a secret store, not plaintext columns.
2. `channel_sessions` — bridge session lifecycle and health, separate from customer conversations.
3. `channel_message_inbox` — immutable raw/normalized inbound ledger.
4. `channel_message_outbox` — durable outbound command and delivery state.
5. `channel_message_attempts` — every provider attempt and error classification.
6. `channel_message_receipts` — sent/delivered/read/provider updates.
7. `channel_conversation_aliases` — maps provider/bridge aliases to existing conversation IDs without changing them.
8. `channel_media_objects` — checksums, MIME, size, source, storage and expiry.
9. `channel_gateway_events` — append-only operational/audit event stream.
10. `ai_inbox_labels` and `ai_inbox_conversation_labels` only if labels are confirmed as required domain data.
11. `ai_inbox_push_subscriptions` for AI Inbox devices, isolated from employee/manager portal subscriptions.

No existing table is deleted or renamed. New foreign keys point to current tenants/users/customers where safe, while conversation references initially remain textual to preserve current IDs.

## 7. Redis, queue, retry and idempotency audit

### Current state

- `cacheService` optionally uses Redis but falls back to local memory.
- The main compose file has no Redis service.
- The Evolution test compose has its own Redis, which is not the ERP/Gateway queue.
- `jobQueueService` and `socialCommentJobQueue` are memory arrays with timers, retry counters and in-memory dead letters.
- A persistent adapter hook exists but no production persistent adapter is registered in the reviewed startup path.

### Consequences

- Restart can lose accepted pending work, retry state, dedupe locks and dead letters.
- Multiple backend replicas can process the same event independently.
- A worker crash between provider send and transcript write can create an ambiguous outcome.
- Queue health cannot be reconstructed after process loss.

### Required rule

For Gateway production traffic, if durable queue persistence is unavailable, the Gateway must not return an accepted status. A local-memory fallback may be allowed only in development and must be visible as degraded health.

Part 2 must define:

- Redis key namespaces per environment and tenant.
- Queue names and priorities.
- Atomic idempotency reservation.
- Retryable versus terminal error classes.
- Backoff, jitter and maximum age.
- Dead-letter inspection and replay authorization.
- Provider timeout ambiguity handling.
- Ordering key per channel conversation.
- Retention and cleanup.

## 8. WebSocket and realtime audit

### Existing

- Socket.IO uses the backend HTTP server and JWT authentication.
- Clients join tenant, user, role and branch rooms.
- AI Inbox Web and PWA share the same socket client/store.
- Reconnect uses infinite attempts with exponential delay capped at eight seconds.
- PWA falls back to 24-second polling only while visible and socket-unhealthy.
- Client message merge uses multiple identity keys to suppress many duplicates.

### Gaps

- No external Socket.IO adapter is configured for multiple backend replicas.
- Infinite reconnect is acceptable only with bounded jitter and offline awareness; there is no explicit network/offline gate.
- Events have no formal version and monotonic conversation sequence.
- `ai_inbox:refresh` can trigger full summary reloads; high bridge volume can create refresh amplification.
- Typing parity for all channel conversations is not established end-to-end.

### Compatible target

- Keep `ai_inbox:message` and `ai_inbox:refresh` unchanged.
- Add optional fields: `event_id`, `event_version`, `conversation_sequence`, `message_identity_key` and `occurred_at`.
- Add new events only; do not rename old ones.
- Use Redis/Postgres-backed cross-instance event distribution.
- Treat Socket.IO as notification/invalidation, never as the durable source of truth.

## 9. AI Inbox Web audit

### Available today

- Unified channel filters and channel icons.
- Conversation list, transcript and older-message cursor pagination.
- Customer drawer and customer profile linking.
- Lead status, opportunity and assignment actions.
- Product cards, variants, available-by-size and draft order actions.
- Human Takeover, Return to AI and AI enable/disable.
- AI drafts, approval/edit correction and validation warnings.
- Internal notes, read/unread state and failed message display.
- Realtime insert/merge and full refresh handling.

### Structural risk

The Web page contains roughly 8,000 lines and duplicates several normalization, transcript, product and identity helpers with the PWA. This makes Web/PWA drift likely. Before adding new Gateway-specific statuses, extract shared hooks/domain utilities while preserving rendered behavior and routes.

### Missing or incomplete against requested acceptance

- Dedicated persisted labels were not found.
- Durable queued/retry controls are not available because the backend has no durable message outbox yet.
- Delivery receipt progression is incomplete.
- Channel health is exposed, but bridge session/recovery status does not exist.

## 10. AI Inbox PWA audit

### Available today

- Separate installable route at `/inbox` and standalone manifest.
- Same backend endpoints, conversation IDs, message IDs and Socket.IO events as Web.
- Responsive conversation list/detail, product cards, customer drawer, Human Takeover, AI drafts, read state, failed state and older-message pagination.
- Socket health tracking and visible-page polling fallback.
- Install prompt handling.

### Service worker behavior today

- Pre-caches `/inbox`, the manifest, favicon and icons.
- Network-first navigation with cached `/inbox` fallback.
- Cache-first static assets/icons.
- Deletes older AI Inbox cache versions on activation.

It does **not** currently implement:

- IndexedDB message or conversation cache.
- Durable composer drafts.
- Offline outbox.
- Background Sync.
- Push event handling.
- Notification click/deep-link handling.
- App badge update.
- API response caching or reconciliation.
- Media cache policy.

### Required PWA design

Use IndexedDB stores for:

- `conversations` — bounded summaries and sync cursors.
- `messages` — normalized messages keyed by tenant/conversation/message identity.
- `drafts` — per-user/per-conversation draft and revision.
- `outbox` — immutable client request ID, payload, state and attempt metadata.
- `sync_state` — last server sequence/cursor and device state.
- `media_cache_index` — metadata only; use Cache Storage for approved blobs.

Required send behavior:

1. Generate a stable `client_request_id` before network I/O.
2. Persist the outbox row and draft change atomically in IndexedDB.
3. Render `offline` or `queued`; never render `sent` optimistically.
4. On connectivity recovery, foreground sync and Background Sync use the same single-flight worker.
5. Server idempotency returns the original message for repeated client request IDs.
6. Reconcile by message identity and server sequence.
7. Keep failed messages until explicit retry/cancel; never silently delete.

### Push target

Reuse the existing `web-push` foundation, but create AI Inbox-specific subscriptions and policy. Payload should contain only safe identifiers and preview policy data. Notification click opens `/inbox?conversation=<existing-id>&message=<existing-id>`, focuses an existing client if possible, loads the authoritative transcript, scrolls to the message, and then calls the existing read endpoint.

iPhone acceptance requires installed PWA push support, user-granted permission, and real-device validation. Background Sync support varies; foreground recovery must remain the reliable fallback.

## 11. Media and uploads audit

### Existing

- Normalizers recognize image/audio/video/document/sticker metadata.
- Message rows store visual attachments as JSON.
- Web/PWA render product/visual attachments.
- Product media commonly uses cloud URLs; local uploads are exposed from persistent paths.

### Gaps

- Provider media IDs may need authenticated retrieval and can expire.
- No centralized checksum, malware/content validation, size policy or storage lifecycle exists for channel media.
- Outbound attachment capability/fallback differs by provider and is not expressed in a formal capability matrix.
- The current Nginx security policy example disables microphone/camera globally, which should be reviewed if future Inbox capture/upload is required.

### Ownership

The Gateway Media Processor should fetch and validate provider media, then store it in the approved object store and pass stable media references to ERP. ERP retains product/upload business ownership; Gateway retains provider-fetch audit metadata.

## 12. Authentication, roles and permissions audit

### Existing

- JWT authentication reloads the user/role from PostgreSQL and attaches tenant scope.
- Socket.IO uses equivalent authentication and joins tenant/user/role rooms.
- Super-admin tenant override is explicit; ordinary users resolve tenant from authenticated scope.
- Database RBAC has module/action permissions and wildcard/admin handling.

### Risks

- Most AI Inbox read/write actions use `settings.view` and `settings.edit`, which is broader and semantically incorrect.
- Permission seeding/mutation also runs through middleware setup code, another runtime migration concern.
- Browser bridge credentials and browser profiles require a separate service identity and secret boundary.
- Gateway internal endpoints need replay protection, timestamp/nonce validation and rotation—not user JWTs.

### Additive permissions

- `ai_inbox.view`
- `ai_inbox.reply`
- `ai_inbox.note`
- `ai_inbox.assign`
- `ai_inbox.takeover`
- `ai_inbox.labels`
- `ai_inbox.retry`
- `ai_inbox.customer_link`
- `ai_inbox.order_link`
- `channel_gateway.view_health`
- `channel_gateway.manage_sessions`
- `channel_gateway.replay_dead_letter`

During migration, current valid `settings.view/edit` holders receive mapped compatibility grants. No current user loses access during rollout.

## 13. Docker, deployment and operations audit

### Existing

- Main compose defines PostgreSQL 16, backend and Nginx frontend.
- PostgreSQL and production override health checks exist.
- Nginx proxies `/api` and `/socket.io` correctly and caches immutable assets.
- Upload and PostgreSQL volumes are documented.
- Backup and restore scripts/documentation exist.
- Current deployment documentation covers both Docker VPS and PM2 fallback.

### Risks

- Main compose does not declare Redis or Gateway services.
- Backend container builds the frontend even though the frontend is built again in its own image, increasing build time/image scope.
- Backend startup runs schema setup and seed before every start.
- Secrets are environment variables with no documented rotation/secret-store process.
- Browser profiles need encrypted persistent volumes and one active owner; shared profile volumes across concurrent browser replicas are unsafe.
- A single backend process currently owns Socket.IO and in-process schedules, which limits horizontal scaling.
- The old regression report references a Render URL, while the declared production target is VPS; environment-specific test artifacts must not be treated as deployment truth.

### Target service separation

```text
frontend
erp-backend
erp-realtime (optional later)
postgres
redis
channel-gateway-api
channel-gateway-worker
bridge-instagram
bridge-messenger
evolution-api (existing external/current deployment)
object-storage adapter
```

Gateway/bridge services must live on an internal network. Only the Gateway health/control surface and ERP public API are exposed through controlled routes. Browser debugging ports are never public.

## 14. Compatibility contract that must be frozen

### IDs

- Existing `conversation_id`/`session_id` values are immutable.
- Existing internal message IDs are immutable.
- Provider IDs are stored, not substituted for existing internal IDs.
- New provider identities are linked through aliases.

### APIs

- Keep current `/api/ai-inbox` and `/api/ai-agent` routes.
- Add fields; do not remove or change the meaning/type of current fields.
- New delivery states must map safely to existing `sent`, `failed` and `stored_only` clients.
- Add new internal Gateway endpoints; do not repurpose public webhooks silently.

### WebSocket

- Keep `ai_inbox:message` and `ai_inbox:refresh`.
- Add metadata fields and new events only.
- Old clients must continue working without sequence support.

### Business state

- ERP remains authority for AI/Human Takeover, assignment, labels, customer/order/product links and read state.
- Gateway remains authority for provider session, transport attempts and provider delivery receipts.
- Browser Bridge has no business authority.

## 15. Principal risks and mitigations

| Risk | Severity | Mitigation |
|---|---:|---|
| Browser session ban/challenge/logout | Critical | Isolated profiles, session state machine, alerting, manual recovery, official API migration path |
| Lost accepted messages on restart | Critical | Durable inbox/outbox before acknowledgement; no production memory fallback |
| Duplicate outbound after timeout | Critical | Stable idempotency key, provider attempt ledger, ambiguous state and reconciliation before retry |
| Conversation ID drift | Critical | Freeze canonical IDs and use alias mapping only |
| Runtime duplicate deletion/migration | Critical | Versioned migrations, backup, dry-run counts, maintenance/online index strategy |
| Web/PWA behavior drift | High | Shared domain hooks and contract tests; every feature gated on both surfaces |
| Offline message shown as sent | High | IndexedDB outbox and authoritative server acknowledgement |
| WebSocket refresh storm | High | Event sequence, targeted patches, coalescing and polling only on degraded connection |
| Multi-replica duplicate processing | High | Distributed queue/locks and Socket.IO adapter |
| Media expiry or malicious payload | High | Gateway media processor, checksums, limits, validation and stable storage |
| Over-broad Inbox permissions | High | Additive dedicated RBAC with compatibility grants |
| Secret leakage in logs/browser profiles | High | Redaction, encrypted volumes, secret store and rotation |
| 24-hour Meta policy failure | Medium/High | Policy-aware error classification, templates/allowed tags where official, no blind retry |
| Large transcript UI slowdown | Medium/High | Cursor pagination, virtualization, bounded cache and memoized message rendering |
| iOS background limitations | Medium | Foreground recovery as required path; Background Sync as enhancement |

## 16. Recommended phased delivery

No phase begins until Part 2 defines the detailed Gateway envelope and queue semantics.

### Phase 0 — Contract freeze and safety baseline

- Snapshot schema/indexes/counts and production configuration names.
- Document existing conversation/message ID examples per channel.
- Add compatibility contract tests around current endpoints/events.
- Move dangerous runtime schema cleanup into controlled migrations.
- Add direct indexed conversation lookup without changing endpoint output.

**Tests:** current 37 tests, build, schema dry-run, endpoint snapshots, send lookup performance.  
**Rollback:** application rollback only; additive indexes may remain.  
**Gate:** zero ID/API/event change.

### Phase 1 — Gateway skeleton, no live traffic

- Independent service, service authentication, health/readiness, structured logs and correlation IDs.
- Redis durable queue, inbox/outbox ledgers, retry/DLQ and media interface.
- ERP internal ingress adapter writes through current transcript/business services.

**Tests:** contract, idempotency race, restart recovery, Redis outage, poison message, tenant isolation.  
**Rollback:** stop Gateway; current direct channels remain active.  
**Gate:** shadow events produce no transcript mutation initially.

### Phase 2 — WhatsApp Evolution shadow then cutover

- Mirror inbound metadata in shadow mode.
- Compare normalized envelopes and identity decisions.
- Enable Gateway ingestion, then Gateway delivery with current path as feature-flag fallback.

**Tests:** text/media/status, duplicate webhook, restart, ordering, takeover, product cards, provider timeout.  
**Rollback:** disable per-tenant/channel feature flag and resume direct Evolution path.  
**Gate:** no duplicate/lost messages during a measured observation window.

### Phase 3 — Instagram Browser Bridge pilot

- Isolated external bridge, session health/reconnect/recovery and capability reporting.
- Same Gateway contract as WhatsApp; AI Inbox remains unchanged.
- Pilot tenant/account only.

**Tests:** login/challenge/logout, inbound/outbound/echo/media, stale DOM selector, session recovery, rate limits.  
**Rollback:** disable bridge account; transcript remains intact.  
**Gate:** recovery runbook proven.

### Phase 4 — Messenger Browser Bridge pilot

- Same architecture and gates as Instagram.
- Confirm browser echoes merge with the existing customer conversation.

**Tests:** echo dedupe, customer identity, attachments, policy errors, takeover and manual Messenger reply import.  
**Rollback:** per-account bridge disable.  
**Gate:** parity with official webhook transcript rules.

### Phase 5 — AI Inbox PWA offline and push

- IndexedDB outbox/drafts/message cache, foreground sync, optional Background Sync, push and deep links.
- Shared Web/PWA status and retry components.

**Tests:** airplane mode, kill/reopen, expired auth, duplicate tap, two-device sync, Android/iPhone real devices, cache upgrade.  
**Rollback:** feature flags disable offline send/push while retaining current PWA shell.  
**Gate:** queued messages never appear sent before server acknowledgement.

### Phase 6 — Additional channels and official API replacement

- Telegram/Website/TikTok adapters implement the same Gateway contract.
- Browser provider is replaced by official API by changing account transport only.

**Tests:** shared channel conformance suite plus provider-specific cases.  
**Rollback:** per-account transport selection.  
**Gate:** no AI Inbox code change required to switch transport.

## 17. Acceptance test matrix

Every functional phase must pass:

### Identity and dedupe

- Same provider event delivered 1, 2 and 20 times creates one ERP message.
- Same client request retried from Web and PWA creates one outbound command/message.
- Provider echo merges into the existing outbound message or records a linked receipt, not a duplicate bubble.
- Existing Conversation IDs and Message IDs remain unchanged.

### Durability

- Kill Gateway after queue acceptance and before send; message resumes.
- Kill worker after provider acceptance and before ERP update; reconciliation prevents blind duplicate send.
- Redis unavailable means degraded/not accepted, not false success.
- Dead-letter survives restart and can be replayed with permission/audit.

### AI/Human/business parity

- Human Takeover blocks AI sending across every adapter.
- Return to AI resumes only according to current workflow.
- Assignment, customer, order, product card, notes and labels are identical on Web/PWA.
- Channel transport never changes ERP business state directly.

### Web/PWA realtime

- Open Web and PWA simultaneously; one message appears once on both.
- Assignment/label/read/delivery changes converge.
- Socket disconnect/reconnect does not loop or duplicate.
- Polling does not run while a healthy socket is active.

### PWA offline

- Draft survives refresh, process kill and device restart.
- Offline send is `offline/queued`, never `sent`.
- Recovery sends once with the original client request ID.
- Cache version upgrade preserves outbox/drafts.
- Push click opens the exact existing conversation/message and marks read only after load.

### Platform/device

- Desktop Web current browsers.
- Android installed PWA.
- iPhone installed PWA.
- Slow network, intermittent network and background/foreground cycles.

## 18. Rollback and release policy

- All channel cutovers are per tenant + channel + account feature flags.
- Current direct WhatsApp/Meta paths remain available through the stabilization window.
- Database changes are additive until the final deprecation release; no table/column/ID removal.
- Dual-write is allowed only with one authoritative path and reconciliation metrics.
- Every rollout records before/after message counts, duplicate rate, queue lag, send latency and failure rate.
- Rollback disables new routing first, drains or quarantines queued work, then rolls back application code.
- Never roll back by deleting Gateway-created ERP transcript rows. Reconcile/audit them.
- A database backup and tested restore procedure are mandatory before identity/index migrations.

## 19. Required inputs from Master Prompt Part 2

Before coding, Part 2 must settle:

1. Canonical event envelope and schema versioning.
2. Exact conversation and message identity precedence.
3. Queue topology and per-conversation ordering.
4. Redis durability/HA/retention and failure policy.
5. Idempotency reservation, TTL and ambiguous-provider outcomes.
6. Inbound acknowledgement boundary.
7. Outbound delivery state machine and receipt mapping.
8. Media ownership/storage/expiry/security.
9. Gateway-to-ERP authentication and replay prevention.
10. Browser account/session lifecycle and operational ownership.
11. Feature flags and tenant/account rollout model.
12. Observability SLOs and alert thresholds.

## 20. Final audit conclusion

The existing AI Inbox should remain the single business Inbox. Its identity, Human Takeover, AI, customer, order and product workflows are valuable and reusable. The new work belongs in a transport-focused Channel Gateway plus a durable queue/outbox layer and a true offline PWA data layer.

The project is ready to proceed to **Part 2 design review**, but it is **not ready to run Browser Bridges in production** until the queue, migration, media, security and PWA blockers above are designed and tested. No Channel Gateway implementation was made during this audit.
