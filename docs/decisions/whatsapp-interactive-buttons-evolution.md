# WhatsApp Interactive Buttons in Evolution

## Context

We tested Evolution API v2.3.7 interactive COD confirmations in production-like flows.

## Observed behavior

- `sendButtons` returns `201` and a `messageId`, but the message becomes `viewOnceMessage` / `nativeFlowMessage`.
- The message stays at `SERVER_ACK` / `PENDING` and does not reliably reach the customer.

## Tests

- Plain English `Yes/No` buttons failed.
- URL button failed.
- COD buttons failed.
- A different phone number failed.
- Legacy button shape returned `Bad Request`.
- `sendList` returned `Bad Request` or was not reliable.

## Conclusion

Interactive native flow is not reliable in the current session.

## Decision

- Confirmation links are the safe primary path.
- Buttons and list messages remain optional attempts only.
- We must not rely on buttons/list as the only production path because that can make order confirmation fail.
