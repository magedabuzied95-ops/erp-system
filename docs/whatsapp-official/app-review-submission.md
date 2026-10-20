# Meta App Review — WhatsApp Business Platform (M1 ERP System, App ID 1749442059552295)

Requested permissions (already in the draft request): **whatsapp_business_messaging**,
**whatsapp_business_management**. Paste each text into "How will your app use this permission?"
and attach the screencast below (one recording covers both).

Before recording:
- Connect a WhatsApp number from الصندوق ← واتساب ← **ربط الحساب** (Connect Account) with
  "Continue with Meta" — a test number from Meta, or a number not used in the WhatsApp app.
  The review needs a CONNECTED official number; M1 Store's number is currently disconnected.
- Have a second phone (your personal WhatsApp) to play the customer.
- Have at least one APPROVED template (create it in the video, or have one ready in case review
  takes long — Meta usually approves utility templates in minutes).

---

## 1. whatsapp_business_management

**How will your app use whatsapp_business_management?**

M1 ERP System is the business-management system (inventory, orders, customer chats) our store and
our business customers use. Businesses connect their WhatsApp Business Account to the ERP through
Embedded Signup ("Connect Account"). We use whatsapp_business_management to:

1. Complete onboarding: read the WhatsApp Business Account and phone numbers the business shared,
   subscribe our app to the WABA's webhooks (POST /{waba-id}/subscribed_apps) and register the
   phone number (POST /{phone-number-id}/register), or sync contacts and history for numbers that
   keep using the WhatsApp Business app (coexistence).
2. Show the number's status on the "Accounts" page: display name and its review status, quality
   rating, messaging limit tier, business profile; let the business request a new display name.
3. Manage message templates: create templates with header, body, footer and buttons, submit them
   for review (POST /{waba-id}/message_templates), sync their status, edit and delete them, and
   react to template status/quality/category webhooks.
4. Show template and account analytics (template_analytics, pricing_analytics) and usage cost per
   month so the business can track spend.

All actions are started by the business's own administrators inside the ERP, on the WhatsApp
Business Accounts they connected.

## 2. whatsapp_business_messaging

**How will your app use whatsapp_business_messaging?**

The ERP's unified inbox lets the business's staff and its AI assistant talk to customers on the
business's WhatsApp number:

1. Receive customer messages (text, images, voice notes, documents, button/list replies, orders)
   through the messages webhook and show them in the inbox.
2. Reply inside the 24-hour customer-service window with text, media, interactive buttons and lists
   (POST /{phone-number-id}/messages), and send delivery/read receipts.
3. Send approved template messages outside the window — order confirmations, shipping updates and
   opted-in marketing campaigns to customer groups, with scheduling and per-recipient results.
4. Run the business's chatbot flows (buttons, lists, product cards) and an away auto-reply outside
   working hours on that number.
5. Let the business's own systems send messages through our public API with API keys.

Messages are only sent to customers who contacted the business or opted in; marketing campaigns
exclude customers who opted out.

---

## Screencast script (one recording, ~5–6 minutes, captions/voice-over in English)

1. **Login** — open https://erp.m1store-egy.com, sign in, open the inbox
   (المحادثات / AI Inbox).
2. **Connect (whatsapp_business_management)** — top bar **واتساب ← ربط الحساب**. Click
   "رقم جديد (Cloud API)" then **كمّل مع Meta**; show the Meta Embedded Signup popup (business
   portfolio, WABA, phone number, permissions) and finish; enter the 6-digit PIN; show the number
   in "الأرقام المربوطة" as connected.
3. **Account status (management)** — **واتساب ← الحسابات**: open the number; show display name,
   name status, quality, messaging limit (Status tab); click **Test Connection** and **Sync
   Participants** (business profile).
4. **Template (management)** — **واتساب ← القوالب (Templates)**: create a UTILITY template, e.g.
   `order_update`: header "Order update", body "Hi {{1}}, your order {{2}} is on its way.",
   a quick-reply button; show the live phone preview; **Submit**; show status Pending → after
   approval refresh to show **Approved** (cut the wait).
5. **Receive + reply (messaging)** — from the second phone send "Hello" to the business number;
   show it arriving in the inbox; reply with text and an image from the inbox; show both arriving
   on the phone, with delivered/read ticks updating in the inbox.
6. **Template send (messaging)** — **واتساب ← الحملات**: create a campaign with the approved
   template, a group containing only the test phone, map {{1}}=name {{2}}=fixed "1234", **Send
   now**; show the template arriving on the phone and the campaign's sent count.
7. **Chatbot (messaging)** — **واتساب ← مسارات الشات بوت**: open a small flow (welcome + 2 reply
   buttons), Publish, Activate; enable it on the number (Accounts → Chatbot Flow tab); send "hi"
   from the phone and tap a button; show the flow's answers.
8. **Analytics (management)** — **واتساب ← تحليلات القوالب**: click "حدّث دلوقتي" and show the
   template's sent/delivered/read numbers.
9. **Clean up** — deactivate the test flow.

## Reviewer instructions (fill in the form; never commit credentials to the repo)
- URL: https://erp.m1store-egy.com — give the reviewer account a login with the inbox and
  WhatsApp settings permissions.
- Tell the reviewer which phone number to message, and that replies come from the connected
  number.
