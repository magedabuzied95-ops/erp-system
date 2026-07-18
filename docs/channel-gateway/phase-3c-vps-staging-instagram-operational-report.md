# Phase 3C — VPS Staging Instagram Operational Report

**Date:** 2026-07-18  
**Environment:** isolated VPS staging  
**Branch:** `codex/staging/channel-gateway-instagram`  
**Validated commit before this report:** `c8e9b1d`  
**Final decision:** **Operationally Blocked**

## Executive summary

The isolated Instagram Browser Bridge pilot was deployed and exercised end to end against the existing ERP AI Inbox on VPS staging. Core inbound ingestion, outbound delivery from both the Web AI Inbox and the PWA, conversation isolation, deduplication, restart recovery, session persistence, and direct provider-side verification all passed with the dedicated test Instagram account `m.one.store.pro`.

Production was not modified, restarted, migrated, or deployed by this phase. Messenger work was not started. Media expansion and AI auto-send were not enabled.

The phase is not marked accepted because two strict acceptance checks remain unexecuted:

1. A deliberate Instagram logout/session-expiry followed by `login_required`, paused traffic, manual re-login/2FA, and automatic recovery was not performed.
2. Physical Android and iPhone validation was unavailable. Responsive PWA behavior was verified in-browser, but that is not a substitute for the required real-device checks.

## Git and release isolation

- All work was performed in the isolated worktree `ERP system-channel-staging`.
- Active branch: `codex/staging/channel-gateway-instagram`.
- The branch was pushed independently; it was not merged into `main`.
- No production deployment was performed.
- The validated implementation history includes the gateway foundation, Instagram selector diagnostics, bounded discovery, browser-operation serialization, priority outbound draining, request-folder handling, profile-card exclusion, linked-thread sweeping, direction detection, and outbound confirmation improvements.
- Latest implementation commit before this report: `c8e9b1d` (`Inspect Instagram bubble subtree for direction`).

## VPS staging topology

Staging path: `/opt/m1-erp-staging`  
Compose project: `m1-staging`  
Compose file: `docker-compose.staging.yml`

Validated services:

| Service | Container | Result |
|---|---|---|
| ERP backend | `m1-erp-backend-staging` | Healthy |
| ERP frontend | `m1-erp-frontend-staging` | Healthy |
| Channel Gateway | `m1-channel-gateway-staging` | Healthy |
| Instagram Bridge | `m1-instagram-bridge-staging` | Healthy |
| PostgreSQL | `m1-postgres-staging` | Healthy |
| Redis | `m1-redis-staging` | Healthy |

Isolation primitives:

- Internal network: `m1-staging-network`
- Controlled egress network: `m1-staging-egress`
- Staging PostgreSQL volume: `m1_staging_postgres_data`
- Staging Redis volume: `m1_staging_redis_data`
- Instagram browser profile: `m1_staging_instagram_profile`
- Instagram diagnostics: `m1_staging_instagram_diagnostics`
- Instagram bridge state: `m1_staging_instagram_state`

The Instagram browser bridge remains a separate service. Playwright/browser automation is not embedded in the ERP backend.

## Database, Redis, build, and migrations

- Staging PostgreSQL and Redis were deployed as isolated containers with isolated persistent volumes.
- Staging database schema/migrations required by the gateway/outbox work were applied without deleting existing tables or changing existing conversation/message IDs.
- The production build completed successfully on the VPS. The only notable output was the pre-existing Vite chunk-size warning.
- Redis and the database remained available through controlled service restarts.
- Observed staging database connections: 4.
- VPS disk at final audit: 193 GB total, 95 GB used, 99 GB free, 49% utilization.

## Instagram login and session persistence

- The user logged into the dedicated non-production test account `m.one.store.pro` and completed Meta security checks manually.
- No credentials, password, 2FA code, cookies, or session state were requested in chat or committed to Git.
- The login session persisted across repeated bridge and full staging-stack restarts without prompting for login again.
- Browser state is held in dedicated staging volumes, separate from production.

Not executed: deliberate logout/session expiry and subsequent re-login recovery. This is a blocking acceptance item, not an assumed pass.

## Selector calibration and diagnostics

Instagram UI discovery was calibrated using bounded, logged diagnostics rather than fixed blind delays. The implementation now:

- sweeps known threads in round-robin order;
- bounds live discovery latency;
- serializes outbound browser operations with scans;
- allows priority outbound jobs to interrupt bounded scans;
- handles message-request controls;
- excludes linked profile cards from message ingestion;
- identifies outgoing direction using message alignment and bubble-subtree evidence;
- records direction and fingerprint diagnostics without storing secrets.

## Inbound validation

The following provider test messages were ingested into the existing AI Inbox:

- `IG-A-001-20260718-215940`
- `IG-A-PARALLEL-20260718-215940`
- `IG-B-PARALLEL-20260718-215940`

Results:

- Each token exists exactly once after ingestion and after repeated controlled restarts.
- Account A was isolated to `instagram:1:113208023405199`.
- Account B was isolated to `instagram:1:17850028616939165`.
- No cross-conversation contamination was observed.
- Existing AI Inbox business logic and conversation IDs were reused; no replacement inbox was created.

## Outbound validation — Web AI Inbox

Test token: `ERP-WEB-TO-A-001-20260718-230800`

- Sent from the Web AI Inbox through the Channel Gateway.
- AI support message ID: `28`.
- Idempotency/job key: `72116f5e-31ae-5025-8ad0-f92d7795d842`.
- Direct Instagram inspection found the token exactly once and confirmed it was outgoing.
- Provider fingerprint: `ig-fp:a41569a15bd592fce534c920e62f05d3cb5447fcab7067c7b011814037c3b9eb`.
- Final AI Inbox status: `confirmed`.

Automatic confirmation did not complete inside the five-minute reconciliation window while direction detection was being debugged. After exact provider-side verification, the staging row was manually reconciled to `confirmed` and a confirmation outbox event was published. This was an audited test reconciliation, not an unverified success override.

## Outbound validation — AI Inbox PWA

Test token: `ERP-PWA-TO-B-001-20260718-235000`

- Sent from the PWA through the same API and Channel Gateway path.
- AI support message ID: `40`.
- Idempotency/job key: `6400ca8e-83f1-5412-a149-00e966ebcf8c`.
- Direct Instagram inspection found the token exactly once and confirmed it was outgoing.
- Provider fingerprint: `ig-fp:bc299b309ada8e9e58d3eeb672ca533b44858a75f78a1bbe1ae0cc305d2addea`.
- Final AI Inbox status: `confirmed`.

As with the Web test, the original automatic confirmation window elapsed during debugging. Exact provider evidence was used for the documented manual reconciliation and confirmation event.

## Web/PWA synchronization

- Web AI Inbox and PWA used the same backend API, conversation IDs, message IDs, and realtime data.
- Both inbound test messages and outbound delivery states remained visible after reloads and restarts.
- Final browser reload showed the Web outbound token once and the PWA outbound token in its correct conversation without duplication.
- Responsive PWA behavior was verified in the browser.
- Physical Android and iPhone tests were not available and remain a blocking acceptance gap.

## Dedupe, identity, and recovery

- All named inbound and outbound test tokens remained exactly once after full-stack restart.
- Full controlled staging restart covered PostgreSQL, Redis, backend, gateway, Instagram bridge, and frontend.
- Pending bridge reconciliations were removed only after direct provider confirmation and audit recording.
- Synthetic calibration rows were reconciled without touching legitimate data:
  - duplicate inbound event marked `duplicate_reconciled` and its duplicate AI row removed;
  - profile-card event marked `ignored_profile_card` and its AI row removed;
  - outgoing message misclassified as inbound marked `ignored_outgoing_reconciled` / `OUTGOING_DIRECTION_RECONCILED` and its incorrect AI row removed.
- Canonical test messages remained intact.
- Identity stayed scoped by channel account and external conversation ID. No conversation ID or message ID rewrite was introduced.

## Uncertain-send behavior

The outbound path is queued and idempotent. Browser operations are serialized, bounded, and recoverable. The provider fingerprint plus deterministic job key prevent an uncertain browser result from being blindly resent as a new logical message.

The two live sends were found exactly once at Instagram after debugging and restarts. However, because their automatic confirmation windows elapsed during diagnosis, the final state used documented manual reconciliation. A future staging run should repeat this test without diagnostic interruption to prove fully automatic confirmation inside the configured window.

## Frontend operational finding

After the staging backend container was recreated, the staging Nginx frontend retained the old backend container IP and returned HTTP 502 until `frontend-staging` was restarted. Restarting only the isolated staging frontend restored the PWA send path immediately.

Recommended follow-up: make Nginx resolve the Docker service name dynamically or include the frontend in coordinated backend recreation so a stale upstream address cannot persist.

## Tests

| Test suite | Result |
|---|---|
| Instagram bridge tests | 30 passed |
| Instagram pilot tests | 7 passed |
| Gateway shadow realtime + Instagram pilot | 12 passed |
| Channel Gateway tests | 16 passed, 0 failed, 9 skipped |
| VPS production build | Passed |

The nine gateway skips are integration tests requiring a dedicated local test database environment, which was not supplied to that local invocation. The repository root has no generic `npm test` script; the initial root invocation reported `Missing script: test`, after which the correct service-specific suites were run successfully.

## Resource observations

Representative final readings after recovery:

| Service | CPU | Memory |
|---|---:|---:|
| Backend | 0.27% | 83.38 MiB |
| Frontend | 0.00% | 5.94 MiB |
| Channel Gateway | 2.12% | 37.54 MiB |
| Instagram Bridge | 29.38% | 406.7 MiB / 1 GiB |
| PostgreSQL | 6.41% | 41.17 MiB |
| Redis | 11.10% | 4.48 MiB |

The bridge showed elevated CPU during active browser scans but remained inside its 1 GiB memory limit. Continued monitoring and scan-rate tuning are recommended before expanding account count.

## Security review

- No Instagram password or 2FA code was collected by the implementation.
- Browser profile and storage state remain in named staging volumes, not source control.
- Tracked-file checks found only safe example environment files and application source; no tracked session/cookie/profile artifact was found.
- Gateway-to-ERP communication uses the staging-only configuration and does not expose Playwright directly to the ERP backend.
- Production secrets, databases, Redis, and browser sessions were not reused.

## Rollback

Rollback remains isolated and reversible:

1. Stop the `m1-staging` compose project.
2. Preserve diagnostics if required for audit.
3. Remove only the staging Instagram bridge/gateway containers and, if explicitly approved, their named staging volumes.
4. Revert the staging branch commits or reset the staging deployment to its previous branch revision.
5. No production rollback is required because production was not deployed or modified by this phase.

Do not delete the browser-profile volume unless a fresh login is intended; it contains the test account's staging session.

## Risks and required follow-up

1. Execute a controlled test-account logout/session expiry and verify:
   - bridge health becomes `login_required`;
   - inbound and outbound processing pause without loss or false `sent` state;
   - manual re-login/2FA restores the same session mapping;
   - queued work resumes without duplicate delivery.
2. Validate Web/PWA parity on physical Android and iPhone, including reconnect, backgrounding, notification navigation, drafts, unread count, and duplicate prevention.
3. Repeat uncertain-send confirmation without diagnostic interruption and require automatic confirmation within the configured window.
4. Address Nginx stale Docker upstream resolution before routine backend container recreation.
5. Monitor bridge CPU/memory over a longer soak before adding another Instagram account or starting Messenger.

## Final decision

**Operationally Blocked**

Core Phase 3C functionality is operational on isolated VPS staging, including real provider inbound and outbound tests from Web and PWA, dedupe, conversation isolation, and restart recovery. Formal acceptance is blocked only until the deliberate session-expiry/re-login recovery test and physical Android/iPhone validation are completed. Production remains untouched, and Messenger must not begin before these gates are resolved and Phase 3C is explicitly accepted.
