# AI Inbox top bar — parity with Genie ERP

Source: Genie ERP demo (`/chat`), walked 2026-10-20. Structure only — no data copied.
Rule from the owner: anything M1 already has elsewhere is **moved/linked**, not rebuilt.

## Genie top bar (inside the chat app)

| Menu | Pages |
|---|---|
| Chats | the inbox itself |
| WhatsApp (official Cloud API) | Accounts · Templates · Campaigns · Usage & Cost · Chatbot Flows · Catalogs · Products · Orders · API Keys · API Webhooks |
| Messenger | Accounts · Connect Page · Posts · Comments · Stories · Auto Replies · Chatbot Flows |
| Instagram | Accounts · Connect · Comments · Posts · Stories · Auto Replies · Chatbot Flows |
| Vodafone IVR | Connect · Call Records · Agents · Reports |
| Config | Conversations · Tags · Quick Replies · Teams · Groups · Shifts · Presence Log · Chat Backups |

### Key Genie screens

- **WA Accounts list**: name, phone, phone_number_id, display name, display-name status, messaging limit, WABA id, coexistence.
  Form actions: Test Connection · Subscribe · Enable Insights · Change Display Name · Re-register Number; state Active/Inactive/Suspended.
  General: account name, team-based distribution, user, distribution strategy (broadcast to all…), admins, branch, messaging limit, conversation mode (single thread), handled by AI, automatic lead.
  Tabs: Status (display-name verification + messaging-limit tier explainer; display name, name status, phone, quality rating, coexistence, insights, blue tick, disconnect reason/at) · Usage & Cost (monthly history + usage alerts) · Chatbot Flow (flow, session TTL, active during campaign) · Auto Reply (active, message, start/end time) · Stickers · Credentials & Webhook (phone number id, WABA id, business id, app id, app secret, access token, webhook callback URL, verify token) · AI (workflow, comment workflow, follow-up workflow, language, image describer, audio transcriber, prompts, history size, summarize-after).
- **WA Templates**: list = name, account, language, category, status, template id. Form = name, account, language, category (Marketing/Utility/Authentication), applied-to (contact model for variables), header format (Text/Image/Video/Document) + content, body (≤1024), footer, buttons (type/text lines). Status bar Draft → Pending Approval → Approved / Rejected, **Submit** button, Technical tab (template id, last synced, rejection reason), Analytics tab. **Live WhatsApp phone preview** beside the form.
- **Campaigns**: name, status, group, template, scheduled at, last run.
- **Usage & Cost**: month, account, service messages, free used, passed-free-limit at, paid service, marketing templates, utility templates, total cost USD, closed.
- **Catalogs**: name, account, catalog id, status, products, last synced. **Orders**: customer, catalog, status, total, currency, date.
- **API Keys**: name, key, user, account, active, last used, created. **API Webhooks**: callback URL, account, active, failures, last success, last error.
- **Messenger/IG**: Accounts (page name, id, status, username, category) · Connect (Facebook Login, multi-page) · Posts (type, content, status, scheduled, published, likes, comments, shares) · Comments (sender, comment, post, partner, status, likes) · Stories (type, status, scheduled, published, expires, views) · Auto Replies (page, post, trigger keywords, active, public reply, private DM).
- **Config**: Conversations (customer, members, channel, last message, started, done, AI, unassigned; "Backup all") · Tags (name, description, color, created by) · Quick Replies (name, message, active) · Teams (name, distribution) · Groups (name, customers) · Shifts (name, all accounts, active) · Presence Log (user, online from, offline at, duration, currently online, busy) · Chat Backups (download, requested at, status, by, conversations, messages, files, missing, size, available until).

## M1 today → where each lands

| Genie | M1 has | Action |
|---|---|---|
| WA Accounts (Cloud) | `integrations/WhatsAppIntegrationPanel.jsx` Cloud card + `WhatsAppEmbeddedSignupCard.jsx` | link from top bar |
| WhatsApp Web (Evolution) | Evolution card in the same panel, queue, automations | own top-bar menu "WhatsApp Web", unchanged behaviour |
| Templates | backend only (`whatsappCloudProvider.listTemplates/submitTemplate`) | **build** routes + page with phone preview |
| Campaigns | `BroadcastsPanel` (plain text, not templates) | link; later: template-based sends |
| Usage & Cost | none | **build** |
| Chatbot Flows | `/ai-studio/workflows` | link |
| Catalogs / Products | Meta catalog feed + `facebook_catalog_id` setting | link; later catalog page |
| Orders | ERP orders from chat | link |
| API Keys / Webhooks | none | **build** |
| Messenger/IG Accounts & Connect | `MetaIntegrationPanel` | link |
| Posts | `/marketing/posts`, publisher, calendar | link |
| Comments | inbox social-comments section | link |
| Stories | `/marketing/ai-center` story autopilot | link |
| Auto Replies | CC `comments` | link |
| Vodafone IVR | none | needs a Vodafone IVR API account — blocked on the owner |
| Config: Quick Replies | CC `quick_replies` | link |
| Config: Tags | per-conversation labels, no admin page | **build** admin page |
| Config: Teams / Groups / Shifts | assignment + performance only | **build** |
| Config: Presence Log | live presence only, not persisted | **build** persistence + log |
| Config: Chat Backups | none | **build** |
