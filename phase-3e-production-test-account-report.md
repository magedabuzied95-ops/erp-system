# Phase 3E - Production Infrastructure + Test Instagram Account Report

Date: 2026-07-19
Branch: codex/phase3e-production-test-account
Production account under test: m.one.store.pro
Account label: TEST ACCOUNT

## Decision

Operationally Blocked for final acceptance.

Reason: production infrastructure, database, queues, kill switch, recovery, restart, Web/PWA asset smoke tests, and regression tests passed against the Instagram Business Test Account. However, Android PWA, iPhone PWA, and simultaneous Web + Android + iPhone multi-device validation still require real physical device execution. These checks were not completed from this environment, so the final Phase 3E acceptance phrase cannot be issued yet.

Infrastructure status: Production Instagram Bridge infrastructure is running on the test account only.

Current Connected Account = Instagram Business Test Account (m.one.store.pro), not the M1 Store production account.

## Scope Controls

- Messenger was not started.
- Media was not enabled.
- Comments integration was not started.
- Broadcast was not enabled.
- AI auto-send stayed disabled.
- WhatsApp was not changed.
- Production M1 Store Instagram account was not connected.

## Backup

Backup completed before production deploy.

- Backup location: /opt/backups/phase3e-20260719T113333Z
- Backup directory permissions: 700
- Included PostgreSQL production backup, docker-compose, environment/config files, channel volumes, source snapshot, status, and checksums.
- Secrets were not printed in the report or command outputs.

## Deploy

Production deployment completed using the release path:

`/opt/apps/erp-system-phase3e-release-e6ddc60`

Important deployment note: production compose must be run with:

`ERP_RELEASE_PATH=/opt/apps/erp-system-phase3e-release-e6ddc60`

Without this variable, compose resolves to the older source path.

Running production services:

- erp-backend
- m1-channel-gateway-production
- m1-instagram-bridge-production-test
- erp-postgres
- erp-redis

Main branch was not merged during this closure step. The production test branch was deployed to the VPS to keep rollback and review boundaries clear.

## Database

Migration validation completed.

- Migration success: passed
- Isolated rollback check: passed
- New channel gateway tables present: passed
- Queue and outbox tables present: passed
- Existing production data deletion: none

Rollback clone result:

- MIGRATION_TEST_TABLES=4
- ROLLBACK_REMAINING_TABLES=0
- CORE_TABLES_AFTER_ROLLBACK=4

## Feature Flags

Production channel gateway flags verified:

- INSTAGRAM_BRIDGE_ENABLED=true
- INSTAGRAM_BRIDGE_INBOUND_ENABLED=true
- INSTAGRAM_BRIDGE_OUTBOUND_ENABLED=true
- INSTAGRAM_BRIDGE_MEDIA_ENABLED=false
- INSTAGRAM_BRIDGE_AI_AUTO_SEND_ENABLED=false
- INSTAGRAM_BRIDGE_RECOVERY_SYNC_ENABLED=true
- INSTAGRAM_AI_MODE=draft_only

## Channel Account Guard

Verified current connected account:

- Current account: m.one.store.pro
- Expected test account: m.one.store.pro
- Account verification: passed
- Visible label: TEST ACCOUNT
- Production M1 Store account guard: fail-closed behavior implemented and tested

## Web Tests

Production Web checks completed:

- HTTPS root: 200
- manifest.webmanifest: 200
- sw.js: 200
- inbox-sw.js: 200
- AI Inbox shared Web/PWA event contract test: passed
- Inbound Instagram import into existing AI Inbox: passed
- Manual outbound queue and confirmation: passed
- Conversation mapping: passed
- Dedupe: passed
- Human takeover and existing AI Inbox workflow compatibility covered by regression tests

## Android PWA Results

Not completed from this environment.

Required remaining physical-device checks:

- WebSocket
- Draft
- Keyboard
- Background and foreground behavior
- Notifications, if enabled
- Reconnect
- Status updates
- Queue status
- Human takeover
- AI draft
- Channel icon
- Conversation isolation
- No duplicate messages
- No lost draft

## iPhone PWA Results

Not completed from this environment.

Required remaining physical-device checks:

- Safari PWA install/open
- Draft persistence
- Reconnect
- Background and foreground behavior
- Keyboard behavior
- Status updates
- Human takeover
- No duplicate messages
- No lost draft

## Multi Device Results

Not completed with all required real devices at the same time.

Required remaining check:

- Web + Android PWA + iPhone PWA open simultaneously
- User A and User B test messages
- Same conversation ID and message ID
- Same status, assignment, labels, and draft behavior
- No duplicate messages
- No race condition
- No wrong conversation mapping
- No re-render loop

## Restart Results

Restart validation completed for:

- Instagram Bridge
- Channel Gateway
- Backend

Results:

- Instagram session remained authenticated after bridge restart.
- Gateway returned ready after restart.
- Backend health returned ok after restart.
- No login was required after restart.
- Recovery processed stale outbound work after gateway cycle.
- Final outbound jobs all confirmed.

## Recovery And Queue Results

Final production queue snapshot:

- channel_inbound_events: 7
- channel_message_map: 9
- conversation_maps_with_internal: 1
- duplicate_inbound_event_keys: 0
- ai_support_instagram_messages: 17
- erp_channel_outbox_events: processed=1
- outbound_message_jobs: confirmed=2

Bug fixed during validation:

- One outbound job remained in processing state while locked by an old gateway worker. Existing stale recovery recovered it after gateway restart and it was confirmed. No code change was required for this item because recovery behavior already existed and worked on restart.

## Kill Switch

Admin kill switch validated.

- Disable stopped inbound, outbound, recovery, and live watch without ERP restart.
- Outbound while paused returned 409 BRIDGE_PAUSED.
- Re-enable used a bounded browser startup timeout and restored healthy status.
- Account guard still verified TEST ACCOUNT after resume.

## AI Mode

AI mode verified:

- Draft only: enabled
- Auto send: disabled
- Non-manual / AI auto-send outbound attempts are rejected before reaching the bridge.

An existing global AI draft pause caused draft generation to be skipped in one environment path, but inbound messages remained accepted and visible in AI Inbox. This was fixed so optional draft errors do not block message ingestion.

## Monitoring

Final health:

- Gateway: ready
- PostgreSQL: connected
- Redis: connected
- Bridge: healthy
- Session: authenticated
- Inbox loaded: true
- Live watch: running
- Recovery sync: running
- Connected account: m.one.store.pro
- TEST ACCOUNT verification: true
- Selector version: instagram-web-2026.07-pilot.3
- Media enabled: false
- AI mode: draft_only

Resource snapshot after restart:

- erp-backend: 113.6 MiB, CPU 27.76 percent at sample time
- m1-channel-gateway-production: 27.12 MiB, CPU 10.74 percent at sample time
- m1-instagram-bridge-production-test: 406.2 MiB / 1 GiB, CPU 146.26 percent at sample time
- erp-postgres: 179.6 MiB, CPU 10.07 percent at sample time
- erp-redis: 5.973 MiB, CPU 1.98 percent at sample time

Remaining monitoring risk:

- The Instagram browser bridge can spike CPU during live watch/recovery. It is acceptable for the pilot/test account but should keep monitoring before switching to the real account.

## Security Validation

Completed checks:

- /opt/erp/channel-gateway.env permissions: 600
- /opt/erp/backend/.env permissions: 600
- Backup directory permissions: 700
- Recent production logs did not expose password/token/secret/cookie/session markers.
- No tracked private key or live env file name matches found.
- Tracked secret-looking assignments were only in example/docs files:
  - .env.channels.production.example
  - .env.example
  - .env.staging.example
  - docs/ai-agent-channel-adapters.md

npm audit result:

- 14 existing vulnerabilities reported
- 3 low, 6 moderate, 5 high
- Includes existing dependency advisories for dompurify, form-data, multer, react-router, vite, ws, xlsx, and related packages
- xlsx has no fix available according to npm audit

These audit findings were not introduced as part of Phase 3E, but they remain a production security risk to schedule separately.

## Regression Tests

Passed:

- `node --test tests/instagram-bridge-pilot.test.js tests/phase-3e-production-guard.test.js`
  - 16 passed, 0 failed
- `npm --prefix services/m1-instagram-bridge test`
  - 38 passed, 0 failed
- `npm --prefix services/m1-channel-gateway test`
  - 17 passed, 0 failed, 9 skipped integration tests
- `npm run build`
  - passed

Known build warnings:

- Large Vite chunks remain.
- Node deprecation warning for module.register remains.

## Files Modified In This Phase Set

The Phase 3 production test branch includes changes across:

- Channel Gateway service
- Instagram Bridge service
- ERP backend channel gateway routes and services
- AI Inbox / AI Channels admin surface
- Docker compose production/staging channel definitions
- Channel gateway migrations and rollback scripts
- Production/staging environment examples
- Regression tests
- Prior phase reports and audit documentation

Most recent fixes before this report:

- Accept Instagram inbound when AI draft generation is paused.
- Return 409 for paused bridge outbound attempts.
- Allow bounded Instagram resume startup.
- Preserve mapped conversation for outbound status.
- Persist ERP conversation mapping after inbound publish.

## Rollback Plan

Recommended rollback order:

1. Use the Admin kill switch: Disable Instagram Bridge.
2. Stop m1-instagram-bridge-production-test.
3. Stop m1-channel-gateway-production if needed.
4. Restore docker-compose/env/channel config from `/opt/backups/phase3e-20260719T113333Z`.
5. Restore PostgreSQL backup from the same backup directory only if a database rollback is required.
6. Revert to the pre-Phase3E backend image/tag if application rollback is required.
7. Keep WhatsApp services running unchanged unless a separate incident requires action.

## Remaining Risks

- Android PWA real-device validation is pending.
- iPhone PWA real-device validation is pending.
- Web + Android + iPhone simultaneous sync validation is pending.
- Instagram Browser Bridge remains dependent on Instagram Web UI selectors and provider anti-automation behavior.
- Bridge CPU can spike during live watch/recovery and should be watched.
- Existing npm audit vulnerabilities need a separate dependency-hardening task.

## Final Status

Operationally Blocked

Blocked only by missing physical-device acceptance tests. Production infrastructure is deployed and working on the Instagram Business Test Account only.
