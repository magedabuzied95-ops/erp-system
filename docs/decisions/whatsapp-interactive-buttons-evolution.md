# WhatsApp Interactive Buttons in Evolution

## Status: WORKING as of 2026-08-25 (Evolution 2.4.0-rc2)

## History

On Evolution v2.3.7 interactive buttons did NOT work: `sendButtons` returned 201 but the
message was wrapped in `viewOnceMessage`/`nativeFlowMessage`, delivered (DELIVERY_ACK) yet
never rendered on the recipient's WhatsApp. `sendList` was broken (`this.isZero` Bad Request),
`sendTemplate` is Business-API-only. Polls rendered and votes came back, but encrypted and
undecrypted. Confirmation links were therefore the only production path (and remain the fallback).

## What changed (2026-08-25)

- Upgraded `/opt/m1store/evolution` to `evoapicloud/evolution-api:2.4.0-rc2`.
- 2.4.0 removed the `viewOnceMessage` wrapper — buttons now render as real quick-reply
  buttons (Bosta-style) on the customer's phone.
- 2.4.0 requires a FREE Evolution Foundation license. Activated for magedabuzied95@gmail.com
  (customer_id 14632, tier evolution-api). The licensing api_key lives in the Evolution
  Postgres `RuntimeConfig` table (keys: `api_key`, `tier`, `customer_id`, `instance_id`) —
  NOT in env; `AUTHENTICATION_API_KEY` (used by the ERP backend) is unchanged.

## Live proof (owner number 201024960585, 2026-08-24 ~21:08–21:12 UTC)

1. `POST /message/sendButtons/m1_business_v237` → sent as bare `interactiveMessage`.
2. Status reached `DELIVERY_ACK`; buttons rendered on the phone.
3. Tap returned `buttonsResponseMessage` with `selectedButtonId: "confirm_order_livetest"`,
   `selectedDisplayText: "✅ تأكيد الطلب"`.

## Known gap before wiring production COD to buttons

The inbound webhook stored the button reply in `ai_support_messages` with the QUOTED
(original prompt) text as the body, not the selected button. The reply parser
(`whatsappButtonSignalValues` in whatsappOrderConfirmationService.js) reads
`selectedButtonId`-style fields — verify the webhook normalizer passes them through
before switching the COD confirmation to buttons-first.

## Rollback assets (on the server, /opt/m1store/evolution)

- `backup-evolution-20260824-223009.sql` (full pg_dump, pre-upgrade)
- `docker-compose.yml.bak-20260824-223009` (v2.3.7 compose)
- Rollback = restore compose + `docker compose up -d evolution-api` (proven, ~1 min;
  v2.3.7 boots fine on the migrated DB).

## Decision

- Buttons are now viable for COD confirmation; keep the secure link as automatic fallback
  (the not-delivered fallback timer in whatsappGatewayService already exists).
- 2.4.0-rc2 is a release candidate: watch for a stable 2.4.x and pin it when released.
