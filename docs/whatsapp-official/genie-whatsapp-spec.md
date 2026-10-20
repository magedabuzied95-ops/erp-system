# WhatsApp Business (Cloud API) — reference spec (observed from demo.genie-erp.com, 2026-10-20)

Observed by browsing the reference ERP. We write our own code; this records screens, fields and
behaviour so our module matches feature-for-feature. Customer data seen in the demo is NOT recorded.

## Navigation (Chat app → WhatsApp menu)
Accounts · Connect Account · Templates · Campaigns · Template Analytics · Usage & Cost ·
Chatbot Flows · Catalogs · Products · Orders · API Keys · API Webhooks · API Guide.
(Shared "Config" menu of the chat app: Conversations, Tags, Quick Replies, Teams, Groups.)

## Connect Account (centralised onboarding page, Embedded Signup)
Card: logo; chips "CHANNEL WhatsApp" · "CONNECTING TO <tenant>"; progress "11 of 20 connected" (plan quota bar);
title "Connect WhatsApp Business"; "Send and receive WhatsApp messages from your inbox.";
checklist: Send and receive messages from the CRM / Use message templates for marketing and notifications /
Keep using the WhatsApp Business app alongside the API (coexistence) / Requires admin access to a Meta Business portfolio;
green gradient button "Continue with Meta"; "Meta will ask you to authorise the connection."; "🔒 Secured by …".
Flow = Meta Embedded Signup (FB.login with config_id + extras {sessionInfoVersion, featureType: whatsapp_business_app_onboarding for coexistence}),
code exchange → WABA + phone number id → subscribe app to WABA → register number (PIN) → store account.

## Accounts — list
Columns: NAME · PHONE NUMBER · PHONE NUMBER ID · DISPLAY NAME · DISPLAY NAME STATUS (Approved / Not Set Up / Available Without Review / -) ·
MESSAGING LIMIT (250 / 2,000 / 10,000 …) · WHATSAPP BUSINESS ID · COEXISTENCE (bool filter "Any").

## Accounts — form
Action buttons: Test Connection · + Subscribe (subscribe app to WABA webhooks) · Change Display Name · Re-register Number · Sync Participants.
Status bar (statusbar widget): Active / Inactive / Suspended.
"General": Account Name (counter /100) · Team-Based Distribution (toggle) · User (search) · Distribution Strategy (Broadcast to All / round robin …) ·
Admins (tags) · Branch · Messaging Limit (read-only) · Conversation Mode (Single Thread / …) · Handled By AI (toggle) · Automatic Lead (toggle).
Tabs:
- **Status**: warning card explaining display-name verification + messaging limit tiers
  ("Meta has not verified the display name … customers see the phone number instead of the name." /
  "Messaging limit: 250 customers per 24 hours, shared by all the numbers of the business portfolio." /
  "To raise the limit to 2,000: verify the business, or deliver 2,000 template messages to different customers within 30 days using high-quality templates.")
  Fields: Display Name · Display Name Status · Phone Number · Quality Rating · Coexistence · Insights Enabled · Blue Tick · Disconnect Reason · Disconnected At.
- **Usage & Cost**: green card "Service messages: X of 1,000 free used this month. Paid templates: N marketing, N utility, N authentication. Spent so far: $0.00 (Meta's prices, USD)."
  + "History by month" card + "Usage alerts" toggle.
- **Chatbot Flow**: Chatbot Flow (toggle) · Chatbot Flow (select) · Session TTL (Run Once (Never repeat) / …) · Active During Campaign (toggle).
- **Auto Reply**: Auto Reply Active · Auto Reply Message (placeholder "I am currently unavailable. I will get back to you as soon as possible.") · Auto Reply Start Time · Auto Reply End Time.
- **Stickers**: file uploader "+ Add files" (sticker library used by the agent/inbox).
- **Credentials & Webhook**: API Credentials: Phone Number ID · WhatsApp ID (WABA) · Business ID · App ID · App Secret · Access Token (secrets masked);
  Webhook: Callback URL · Webhook Verify Token.
- **AI**: AI Workflow · Comment Workflow · Follow-up Workflow · Language · Image Describer · Audio Transcriber · Image Description Prompt ·
  Instructions (textarea) · Send message IDs to AI (toggle) · Send AI replies as separate bubbles (toggle).

## Templates — list
Columns: TEMPLATE NAME · WHATSAPP ACCOUNT · LANGUAGE · CATEGORY (Marketing/Utility/Authentication) · STATUS (Draft / Pending Approval / Approved / Rejected) · TEMPLATE ID.

## Templates — form (editor with live WhatsApp phone preview on the right)
Buttons: Submit (draft) · Edit · Reset To Draft · Refresh Analytics. Status bar Draft → Pending Approval → Approved / Rejected.
Fields: Template Name (display, /512) · Template Name (Meta slug, auto snake_case) · WhatsApp Account · Language (code picker) · Category ·
Applied To (which ERP record type the {{variables}} come from — e.g. Partner/Contact) · Header Format (Text / Image / Video / Document) ·
Header Content · Body Text · Footer Text.
Tabs: **Buttons** — table [TYPE, TEXT] with drag handles, "+ Add a line"; types: Quick Reply · URL · Phone Number · Copy Code · Catalog (also VOICE_CALL "Call on WhatsApp" seen on synced templates);
**Technical Settings** — Template ID · Last Synced · Rejection Reason;
**Analytics** — KPI cards (Sent, Delivered + delivery %, Read + read of delivered, Read rate, Total clicks + CTR, Unique clicks, Delivery rate, Read rate),
"Daily trend" line chart (Sent, Delivered, Read, Clicks), "Button clicks" ("No button clicks (only Marketing/Utility templates report clicks).") and "Cost"
(amount spent, cost per delivered, cost per url button click).
Preview: phone mock (header bold, body, footer, time, buttons; >3 buttons → first 2 + "See all options (n)"); under it chips (status, category, language) and
counters "Header 23/60 · Body 266/1024 · Quick replies 4/3 (red when over) · Call to action 0/2 · Buttons 5/10".

## Campaigns (template broadcasts)
List: NAME · STATUS · GROUP · TEMPLATE · SCHEDULED AT · LAST RUN.
Form: button "Activate"; status bar Draft / Scheduled / Running / Done / Failed; Name · Group (contact group) · Template · Scheduled At ·
Chatbot Flow (flow to run on replies) · AI Workflow · Auto Lead Generation (toggle, default on);
cost estimate card "Choose the group and the template to see what this campaign will cost."; Skipped Contacts (text area: who was skipped and why).

## Template Analytics page
Title "WhatsApp Template Analytics" / "Sent, delivered, read, clicks and cost per template (from Meta)."
Filters: Account (All accounts / each), Campaigns (multi), From, To; buttons "Sync now", "Export".
Error banner when Meta fetch fails ("Couldn't update statistics … Technical details").
"Account activity" (whole number, per day; inbound service excluded): cards Sent, Delivered, Marketing, Utility, Authentication + daily table.
Then the per-template KPI cards + Daily trend + Button clicks + Cost (same as template Analytics tab) and "Per-template comparison" table
[TEMPLATE, SENT, DELIVERED, READ, DELIVERY %, READ %, CLICKS, CTR].

## Usage & Cost (monthly ledger per account)
Default filter "This month". Columns: MONTH · WHATSAPP ACCOUNT · SERVICE MESSAGES · FREE USED · PASSED FREE LIMIT AT · PAID SERVICE M… ·
MARKETING TEMPLATES · UTILITY TEMPLATES · TOTAL COST (USD) · CLOSED (bool).

## Chatbot Flows
List: BUILD (button "Build") · NAME · STATUS (Draft / Active / Inactive).
Builder (React-Flow canvas, /chatbot-flow-builder/<id>): header with flow name + status pill, buttons Save · Publish · Activate; minimap, zoom, fit, lock.
Left palette "Search nodes…":
INTERACTIVE — Interactive Button (Reply buttons, up to 3) · Interactive List (List menu, up to 10 rows, with sections) · CTA URL Button (Button that opens a URL) ·
Carousel (Scrollable image cards, quick-reply buttons per card) · Template Message (WhatsApp template with buttons);
MESSAGES — Text Message · Image Message (caption) · Video Message · Audio Message · Document Message.
Nodes support {{name}} variables; each button/row has its own output handle wired to the next node; node footers show limits ("3 buttons only", "10 rows max");
terminal actions on a node: "Notify team", "End the session".

## Catalogs / Products / Orders (WhatsApp Commerce)
Catalogs: NAME · ACCOUNT · CATALOG ID · STATUS · PRODUCTS · LAST SYNCED.
Products: NAME · PRICE · SALE PRICE · CURRENCY · AVAILABILITY · SYNCED.
Orders (from WhatsApp cart "order" messages): CUSTOMER · CATALOG · STATUS · TOTAL · CURRENCY · DATE.

## Public API (API Keys / API Webhooks / API Guide)
API Keys: NAME · API KEY · USER · WHATSAPP ACCOUNT · ACTIVE · LAST USED · CREATED (Regenerate Key action).
API Webhooks: CALLBACK URL · WHATSAPP ACCOUNT · ACTIVE · FAILURES · LAST SUCCESS · LAST ERROR.
Guide (/whatsapp/v1/guide) — REST API, base /api/whatsapp/v1, auth "Authorization: Bearer sk_…" or "X-Api-Key":
- GET /accounts → {accounts:[{id,name,phone_number,verified_name,status}]}; whatsapp_account_id optional when the key reaches one account, else 400 account_ambiguous.
- GET /templates?whatsapp_account_id=&status=all → templates with name, language, status, category, header{format,text}, body, variables (named),
  buttons_variables, footer, buttons[{type,text,url,phone_number,is_dynamic_url,variable}].
- POST /messages/template {to, template (name|id), variables{}, buttons_variables{}, whatsapp_account_id, language, header{url}} → 201
  {message_id (wamid), chat_message_id, conversation_id, status:"accepted"}; multi-language → template_ambiguous; positional {{1}} for synced templates.
- POST /messages {to, type text|image|video|audio|document, text, url, caption, filename} → same; 422 outside_24h_window outside the service window.
- GET /messages/{wamid} → {id, message_id, direction, type, status queued|sent|delivered|failed, failure_reason, timestamp}.
- Webhooks: POST /webhooks {callback_url (https), events [message.received, message.status, template.status], whatsapp_account_id} → secret whsec_… once;
  POST /webhooks/{id}/rotate-secret; PATCH {active}; ≤5 per account. Delivery headers: X-Event-Type, X-Delivery-Id, X-Signature-256: sha256=<HMAC of raw body>.
  Body {event, timestamp, delivery_id, account{id,phone_number}, data{…}}. 2xx within 10 s; 5 retries exponential 30 s→8 m; auto-disable after 20 consecutive failures.
- Error envelope {error:{code,message,details}}: validation_error, account_ambiguous, invalid_phone, template_ambiguous, invalid_api_key, account_not_found,
  template_not_found, message_not_found, webhook_not_found, template_not_approved, missing_variables (details.missing / expected_buttons_variables),
  invalid_variables, outside_24h_window, webhook_limit_reached, quota_exceeded (daily template quota), rate_limited (Retry-After), provider_error, internal_error.
- Rate limits: 120 req/min per key overall, 30/min on send endpoints.
