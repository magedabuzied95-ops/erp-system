# AI Agent Channel Adapter Architecture

The AI Agent now has a channel adapter boundary in `server/services/aiChannelAdapterService.js`.

## Unified inbound message

All channel adapters normalize inbound events to:

```json
{
  "tenant_id": 1,
  "channel": "web_chat",
  "external_conversation_id": "session-or-thread-id",
  "external_customer_id": "customer-or-platform-id",
  "customer_name": "Customer name",
  "message_text": "Customer message",
  "attachments": [],
  "timestamp": "2026-05-18T12:00:00.000Z"
}
```

`web_chat` is wired into the existing `/api/ai-support/chat` route. The route converts the normalized payload back into the current AI support request shape, so the sales logic, memory, order draft handling, follow-ups, and inbox logging continue through the existing flow.

## Unified outbound reply

Every web chat response now also includes `channel_reply`:

```json
{
  "channel": "web_chat",
  "text": "Reply text",
  "visual_attachments": [],
  "product_cards": [],
  "suggested_quick_replies": []
}
```

The original response fields are still returned for web chat compatibility.

## WhatsApp Cloud API

WhatsApp is connected through:

```text
GET  /api/ai-agent/channels/whatsapp/webhook
POST /api/ai-agent/channels/whatsapp/webhook
```

Use the public backend URL for Meta webhook setup:

```text
https://your-backend.example.com/api/ai-agent/channels/whatsapp/webhook
```

Required environment variables:

```text
META_VERIFY_TOKEN=your-webhook-verify-token
WHATSAPP_ENABLED=true
WHATSAPP_ACCESS_TOKEN=EAAG...
WHATSAPP_PHONE_NUMBER_ID=123456789
WHATSAPP_APP_SECRET=optional-app-secret-for-X-Hub-Signature-256
WHATSAPP_TENANT_ID=1
META_GRAPH_VERSION=v20.0
```

`META_WEBHOOK_VERIFY_TOKEN` and `META_APP_SECRET` are also accepted as compatibility fallbacks for verify token and signature secret.

Meta app settings:

1. Add the WhatsApp product to the Meta app.
2. Configure the callback URL above.
3. Set the verify token to `META_VERIFY_TOKEN`.
4. Subscribe to WhatsApp `messages` webhook events.
5. Generate a permanent or system-user access token with WhatsApp send permissions.
6. Put the Cloud API phone number id in `WHATSAPP_PHONE_NUMBER_ID`.
7. Set `WHATSAPP_ENABLED=true` only after credentials are present.

Testing steps:

1. Start the backend with the env vars loaded.
2. In Meta Webhooks, click verify. The GET route should echo `hub.challenge`.
3. Send a WhatsApp test message to the Cloud API phone number.
4. Confirm the POST route logs no signature errors.
5. Confirm the customer appears in AI Inbox with `channel=whatsapp`.
6. Confirm auto replies stop when the conversation is `human_takeover` or `closed`.
7. Confirm visual attachments with public image URLs are sent as WhatsApp images; if image sending fails, the text reply should still be attempted and the failure logged.

The current tenant resolution supports stored mappings, `tenant_id` query/body for testing, and `WHATSAPP_TENANT_ID` for single-tenant deployments. Multi-tenant production should replace this with a phone-number-id to tenant mapping.

## Instagram DM and Facebook Messenger

Instagram DM and Facebook Messenger share Meta webhook infrastructure:

```text
GET  /api/ai-agent/channels/meta/webhook
POST /api/ai-agent/channels/meta/webhook
```

Use this callback URL in the Meta app:

```text
https://your-backend.example.com/api/ai-agent/channels/meta/webhook
```

Required environment variables:

```text
META_VERIFY_TOKEN=your-webhook-verify-token
META_APP_SECRET=optional-app-secret-for-X-Hub-Signature-256
META_PAGE_ACCESS_TOKEN=EAAG...
META_PAGE_ID=page-id
INSTAGRAM_BUSINESS_ACCOUNT_ID=ig-business-account-id
INSTAGRAM_ENABLED=false
FACEBOOK_MESSENGER_ENABLED=false
META_TENANT_ID=1
META_GRAPH_VERSION=v20.0
```

Permissions and setup notes:

1. Add Messenger and Instagram products to the Meta app.
2. Connect the Facebook Page in the app dashboard.
3. Connect the Instagram professional account to that Page.
4. Request/configure permissions needed for messaging, such as `pages_messaging`, `pages_manage_metadata`, `instagram_manage_messages`, and related page/Instagram basic access permissions required by the current Meta app review flow.
5. Subscribe the webhook to message events for the Page and Instagram account.
6. Use `META_VERIFY_TOKEN` for webhook verification.
7. Use a Page access token in `META_PAGE_ACCESS_TOKEN`.
8. Keep `INSTAGRAM_ENABLED=false` and `FACEBOOK_MESSENGER_ENABLED=false` until manual channel testing starts.

Sender behavior:

- Text replies are sent through Meta `/me/messages`.
- Image sends are best effort after the text reply.
- If sender credentials are missing or the channel is disabled, the API returns a clear config/disabled error and logs the failed outbound event.
- The AI reply is not sent when the conversation is in human takeover or closed.

## Admin Setup Flow

Admins can use:

```text
/admin/ai-channels
```

The page shows masked WhatsApp, Instagram, and Facebook Messenger configuration status, webhook URLs, latest webhook/send state, and recent inbound/outbound channel events. It never displays full access tokens.

Setup flow:

1. Add the channel env vars and restart the backend.
2. Open `/admin/ai-channels`.
3. Confirm required ids, access tokens, verify token, and optional app secret are marked configured.
4. Copy the relevant webhook URL into the Meta app webhook settings.
5. Verify the webhook from Meta.
6. Use the test-send panel with a WhatsApp phone, Messenger PSID, or Instagram scoped user id.
7. Enable channel AI replies only after test send succeeds.
8. Watch recent events to confirm inbound and outbound status.

`WHATSAPP_ENABLED=false`, `INSTAGRAM_ENABLED=false`, and `FACEBOOK_MESSENGER_ENABLED=false` are channel kill switches. When disabled, the admin page can still show configuration and logs, but test sends and AI replies will not send externally.

## Later Testing Checklist

Perform these later, step by step, with real Meta test users:

1. Verify both webhook URLs from Meta.
2. Send one inbound text message per channel.
3. Confirm event logs show inbound rows.
4. Enable one channel at a time in `/admin/ai-channels`.
5. Send one admin test message per channel.
6. Confirm outbound events show either `test_sent` or a clear config error.
7. Test human takeover and closed conversation suppression.
8. Test one image/visual response and confirm text fallback if image send fails.
9. Confirm no duplicate replies occur on webhook retries.
