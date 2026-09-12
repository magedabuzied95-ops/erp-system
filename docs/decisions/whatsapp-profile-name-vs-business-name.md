# WhatsApp: profile name vs verified business name

## Status: profile name is now settable from the ERP (2026-09-12). The verified name is NOT.

## What the transport actually is

The live WhatsApp line runs on **Evolution API 2.4.0** (`evoapicloud/evolution-api:2.4.0-rc2`,
instance `m1_business_v237`), whose transport is **Baileys / WhatsApp Web multi-device** —
confirmed by the gateway root answering with `whatsappWebVersion: 2.3000.1047353350`. It is a
linked device on a real phone account, not a Meta WhatsApp Business Account on the Cloud API.
The separate Cloud number is a second, independent line — see the two-lines decision.

That single fact decides everything below: Baileys can edit what the *account* stores about
itself, and nothing that Meta *asserts* about it.

## The four names, and who grants each

| Name | Where it lives | Who grants it | Reachable from Evolution |
|---|---|---|---|
| **Profile name** (push name) | the WhatsApp account itself | the account owner | **yes** — `POST /chat/updateProfileName` |
| **Business display name** | WhatsApp Business profile on a WABA | Meta review | no |
| **Official Business Account** (green badge) | Meta's record of the WABA | Meta, by application | no |
| **Meta Verified** | Meta Verified subscription on the WABA | Meta, paid + reviewed | no |

A fifth, the **WhatsApp username**, is a Meta-side handle rolling out separately; it replaces the
number as an identifier, not as the display name, and is likewise not an Evolution property.

## Why the profile name does not replace the number for a stranger

For a chat with a **personal or unverified business** account, WhatsApp shows the *number* at the
top of the thread to anyone who has not saved the contact. The profile name is shown in a weaker
position — under the number, and in the notification — and WhatsApp deliberately does not promote
it, because an unverified account could otherwise impersonate anyone by typing a name.

Only a **verified business display name** on a WABA replaces the number in the chat header. That
is a Meta-granted property; no gateway, Evolution included, can set it. Changing the profile name
is still worth doing — it is what the customer sees in notifications and in the contact card —
but it is not the same thing, and shipping it must not be reported as if it were.

## The endpoint

`POST /chat/updateProfileName/{instance}` with `{"name": "..."}`. Verified present on the live
2.4.0 gateway by an unauthenticated probe: the route answers `401` (exists, guarded) while a
nonsense sibling path answers `404`.

It is a single profile update over the already-open socket. It does **not** log the device out,
restart the instance, touch the webhook registration, the outbound queue, or Status/Story
publishing. It cannot run on a dead session, which is why `updateWhatsappProfileName` checks
`getStatus` first and answers `WHATSAPP_NOT_CONNECTED` rather than letting Baileys surface
"Connection Closed".

WhatsApp truncates a push name past 25 characters, so the service rejects a longer one instead
of letting it be silently cut on the customer's screen.

## Wiring

- `getWhatsappProfile` / `updateWhatsappProfileName` in `server/services/whatsappGatewayService.js`.
- `GET /api/whatsapp/profile` (settings:view) and `POST /api/whatsapp/profile/name` (settings:edit)
  in `server/routes/whatsappGateway.js`.

Gated on settings the same way instance pairing is, and for the same reason: this is the shop's
public identity on WhatsApp, and the Evolution API key stays server-side.

Both refuse a `cloud:<phone_number_id>` instance with `WHATSAPP_PROFILE_CLOUD_UNSUPPORTED` — a
Cloud number's display name is changed in the Meta WhatsApp Manager and reviewed by Meta, and
silently editing the wrong line would be worse than refusing.
