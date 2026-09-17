# J&T Express Egypt Sandbox in M1

This integration is limited to the J&T Egypt demo host. It does not read or
update M1 orders, alter Bosta/Amazon/WhatsApp configuration, or expose a staff
button. The API requires M1 authentication and the `settings` permission.

Set these four values in the backend's private environment file, along with
`JT_SANDBOX_ENABLED=1`:

- `JT_SANDBOX_API_ACCOUNT`
- `JT_SANDBOX_PRIVATE_KEY`
- `JT_SANDBOX_CUSTOMER_CODE`
- `JT_SANDBOX_CUSTOMER_PASSWORD`

No credentials are stored in source control. Removing the enable flag disables
all J&T calls. The host is fixed in code to
`https://demoopenapi.jtjms-eg.com`; production cannot be selected by request.

Authenticated routes under `/api/shipping/jt/sandbox`:

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/status` | Verify Sandbox configuration |
| POST | `/orders` | Create one test order with documentation sample addresses |
| POST | `/orders/query` | Query with `{ "txlogisticId": "..." }` |
| POST | `/orders/cancel` | Cancel an M1 Sandbox test ID |
| POST | `/trace` | Track with `{ "billCode": "..." }` |
| POST | `/label` | Return a Sandbox label PDF for `{ "billCode": "..." }` |

The current Egypt Introduction signs the exact JSON `bizContent` string plus
`privateKey`, then base64 encodes the raw MD5 bytes. `timestamp` is a separate
millisecond header. The business digest first hashes the password plus
`jadada236t2`, uppercases its hexadecimal MD5 value, then signs customer code,
that value, and the private key. Both were checked against the documentation
and a successful direct demo API call from the VPS.

There is no automatic callback registration. A public callback URL and J&T
push configuration are needed before a webhook can receive live events. M1
order mapping also needs a real sender profile and confirmed J&T region names.
