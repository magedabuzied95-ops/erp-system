# Meta App Review — Meta Ads module (M1 ERP System, App ID 1749442059552295)

Everything below is ready to paste into the App Review form. Each permission gets its own
"How will your app use this permission?" text and a screencast. One screencast can cover
several permissions — the script at the end records them all in one take (about 5–6 min).

Reviewer test access: use the existing review account (role `meta_reviewer` or an admin test
user) on https://erp.m1store-egy.com — give it the **meta_ads.view** and **meta_ads.manage**
permissions from الإعدادات ← الأدوار before submitting.

---

## 1. ads_management

**How will your app use ads_management?**

M1 ERP System is the business-management system our store uses for inventory, orders, customer
chats and marketing. Its "Meta Ads" module (Ads Manager) lets the business owner create and run
Facebook and Instagram ad campaigns without leaving the ERP. We use ads_management to:

1. Create campaigns, ad sets, ad creatives and ads in the ad account the user connected
   (POST /act_{id}/campaigns, /adsets, /adcreatives, /ads), from a 3-step wizard
   (campaign objective → audience, budget and placements → ad creative).
2. Upload ad images and videos to the ad account (/act_{id}/adimages, /advideos).
3. Pause / activate campaigns, ad sets and ads from the Ads Manager table, edit budgets and
   names, duplicate and delete them.
4. Run the user's own "automated rules" (e.g. pause an ad set when spend exceeds X) on the
   objects of their ad account.
5. Use targeting search (locations, interests, languages) and the delivery estimate while
   building an ad set.

Every action is started by the signed-in business user on their own ad account; nothing is done
on accounts the user did not select during Facebook Login for Business.

## 2. ads_read

**How will your app use ads_read?**

The Ads Manager screen shows, for every campaign, ad set and ad of the connected ad account:
delivery status, results, reach, impressions, spend, CTR, CPC and CPM. We read these with the
Insights API (/act_{id}/insights at campaign, ad set and ad level, daily, plus breakdowns by
age, gender, platform and country) and show them in the table and in the "عرض الرسوم البيانية"
(charts) drawer. The same numbers feed the user's automated rules. Data is only shown to users
of the same business inside the ERP.

## 3. business_management

**How will your app use business_management?**

Most of our customers' ad accounts are owned by a Business portfolio. During connection we list
the ad accounts the user can access (/me/adaccounts with their business) so the user picks which
ones to connect, and on the ad-account record we read the account's business and assigned users
(/act_{id}/assigned_users) to show who administers the account. We do not create or modify
anything in Business Manager.

## 4. leads_retrieval

**How will your app use leads_retrieval?**

Businesses run Lead Ads with Instant Forms. When a person submits a form, the Page's `leadgen`
webhook notifies our app and we fetch that lead (/{leadgen_id}) to create the lead and the
customer record in the ERP so the sales team can follow up. The "نماذج العملاء المحتملين" page
lists the Page's lead forms (/{page_id}/leadgen_forms) and the "العملاء المحتملون" page lists
the received leads with name, phone, email, form, ad and campaign. Leads are only visible to the
business that owns the Page.

## 5. pages_manage_ads

**How will your app use pages_manage_ads?**

Ads created in our wizard run on behalf of the business's Facebook Page (object_story_spec.page_id)
— the "الهوية" (Identity) step lets the user choose the Page and its Instagram account. We need
pages_manage_ads to create ads for that Page, including click-to-WhatsApp/Messenger ads and
Lead Ads that use the Page's Instant Forms.

## 6. pages_read_engagement

**How will your app use pages_read_engagement?**

The ad wizard shows the Page's name and picture in the ad preview and lets the user pick the
Page as the ad identity; the "إحصاءات الصفحة" (Page Insights) screen shows the Page's daily
impressions, reach, engagements and new followers next to the ad results, so the business can
compare paid and organic performance.

## 7. pages_show_list

**How will your app use pages_show_list?**

During Facebook Login for Business we list the Pages the user manages (/me/accounts) so they can
link each ad account to the Page its ads run from. That link is required to create ads, receive
lead-form submissions and read Page insights.

## 8. pages_manage_metadata

**How will your app use pages_manage_metadata?**

After the user connects, we subscribe our app to the Page's `leadgen` webhook
(POST /{page_id}/subscribed_apps) so new lead-form submissions reach the ERP in real time. We
keep the Page's existing subscriptions (messages etc.) and only add `leadgen`.

---

## Screencast script (one recording, English UI captions, about 5–6 minutes)

Record the screen at 1080p. Before recording: browser in English or Arabic is fine, but add a
caption/voice-over in English for every step. Use the M One Store ad account.

1. **Login** — open https://erp.m1store-egy.com, sign in, open "إعلانات Meta" in the sidebar.
2. **Connect (pages_show_list, business_management)** — الحملات ← ربط الحساب ← "Continue with
   Facebook". Show the Facebook Login for Business dialog listing the permissions, approve,
   then show our picker listing the ad accounts and Pages; select M One Store + M1 Store Page;
   click ربط. Show "الحسابات الإعلانية المربوطة" with the account.
3. **Read performance (ads_read)** — مدير الإعلانات: show campaigns with results / reach /
   impressions / spend; switch to ad sets and ads tabs; open the charts drawer on the active
   campaign (daily chart + breakdown by age).
4. **Create a campaign (ads_management, pages_manage_ads, pages_read_engagement)** — click
   "+ إنشاء": choose objective Engagement or Sales; name it "App Review Test"; ad set: choose
   WhatsApp as conversion location, daily budget, location Egypt on the map, age 18–45;
   ad: choose the M1 Store Page as identity (preview shows Page name/picture), upload an image,
   primary text, headline; click "نشر". Show the success state, then the new campaign in the
   list and in Facebook Ads Manager (business.facebook.com/adsmanager) to prove it was created.
5. **Manage (ads_management)** — toggle the new campaign off (paused) and back on; open
   "القواعد التلقائية", create a rule "pause when spend > 500", run it now.
6. **Leads (leads_retrieval, pages_manage_metadata)** — open the Lead Ads Testing Tool
   (developers.facebook.com/tools/lead-ads-testing), create a test lead on the M1 Store Page
   form; go back to العملاء المحتملون ← العملاء المحتملون and show the lead arriving with its
   name/phone; open it to show the linked customer.
7. **Page insights (pages_read_engagement)** — الجماهير والرؤى ← إحصاءات الصفحة: show the rows.
8. **Clean up** — pause/delete the "App Review Test" campaign so no money is spent.

## Before you press Submit (owner)
- Business verification on the Business portfolio is complete.
- App Settings → Basic: privacy policy URL, terms URL, data-deletion instructions URL, app icon,
  category — all filled.
- The reviewer account can sign in and has meta_ads permissions; put its login in
  "Reviewer instructions" (never in this file).
- Also request the "Ads Management Standard Access" feature (Marketing API use case → Actions).
