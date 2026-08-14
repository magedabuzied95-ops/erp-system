# TikTok App Review Pack — M1 Store

Prepared against the implementation at commit `aaafcfed9c04a6249a501c5d79104b4826abf8e1`
(branch `feature/tiktok-integration`, **not deployed**). Every claim below was verified
against the code. Nothing here describes functionality that does not exist.

**Not submitted.** This is preparation material only.

---

## 1. Category

`CATEGORY: <read from the portal dropdown — see note>`

The complete category list is **not documented publicly**; it only exists as a dropdown in
the Developer Portal (`Manage apps → your app → Basic information → Category`). I will not
invent a value.

**Selection criterion:** M1 Store is a private, internal business-operations tool (ERP) used
by the store's own authorized staff to publish that store's own marketing videos. It is not
a consumer app, not an entertainment or social-discovery app, and not a content-editing tool.

Pick, in this order of preference, whichever exists in your dropdown:
1. **Business** / **Business Tools**
2. **Productivity**
3. **Marketing** / **Social Media Management**

Avoid: Entertainment, Games, Education, Video Editing, Lifestyle.

---

## 2. App Description

TikTok shows this on the user-facing authorization page, so it is written for the account
owner, not for the reviewer.

### Full version (897 characters)

> M1 Store ERP is the private business management system used by M1 Store to run its retail
> operations, including product catalog, orders, inventory, and marketing.
>
> The TikTok integration lets an authorized M1 Store team member connect the store's own
> TikTok account and publish the store's marketing videos directly from the ERP, without
> leaving the system or re-uploading files by hand.
>
> After connecting, the user opens the Social Publisher, selects TikTok as the destination,
> and chooses a video. M1 Store then loads the account's current posting options from TikTok
> — who can view the video, whether comments, Duet, and Stitch are allowed, the maximum
> video length, and the commercial content disclosure — and shows them for review. Nothing is
> posted until the user explicitly confirms.
>
> The user can either publish the video directly to the TikTok profile, or send it to TikTok
> Drafts to finish and post it later inside the TikTok app.

### Short version (467 characters) — use if the portal field rejects the full one

> M1 Store ERP is the private business management system used by M1 Store to run its retail
> operations. Its TikTok integration lets an authorized team member connect the store's own
> TikTok account and publish the store's marketing videos from the Social Publisher. Posting
> options are loaded live from TikTok and shown for review, and nothing is posted without an
> explicit confirmation. Videos can be published directly or sent to TikTok Drafts.

> **On character limits:** TikTok does not publish a documented character limit for the app
> description or the review explanation. The portal enforces its own limit client-side. Both
> versions above are given so you can paste the full one and fall back without rewriting.
> Comments and AI replies are deliberately absent — they are not part of this submission.

---

## 3. App Review Explanation

Paste as-is into *App Review → Provide a detailed explanation of how each product and scope
works within your app*.

---

### Login Kit — scope `user.info.basic`

**Why we need it.** M1 Store must know which TikTok account a publish request belongs to.
Login Kit is the only official way for the store owner to grant our app access to their own
TikTok account, and `user.info.basic` is the minimum scope that identifies that account.

**Where the user starts.** Signed in to M1 Store ERP, the user opens **Channel Settings**
(`/admin/ai-channels`). A TikTok card is shown there. Before connecting it reads
"Not connected" and offers a single **Connect TikTok** button.

**What happens during OAuth.** Pressing Connect calls our backend, which generates a
single-use, expiring, cryptographically random `state` value, stores it server-side, and
builds the authorization URL for `https://www.tiktok.com/v2/auth/authorize/` with our client
key, `response_type=code`, our registered redirect URI, and the requested scopes. The browser
is sent to TikTok's own consent screen. When the user approves, TikTok redirects to
`https://api.m1store-egy.com/api/tiktok/oauth/callback`. Our backend verifies the returned
`state` matches an unconsumed, unexpired record — a replayed or unknown state is rejected —
then exchanges the authorization code for tokens **server-side only**. The client secret is
never sent to the browser and never appears in any client-side code. Tokens are encrypted
before they are stored and are never returned to the frontend in any form. If the user
declines on TikTok's screen, we consume the state, store nothing, and return them to Channel
Settings with a clear "authorization was declined" message.

**Why basic profile.** We call `/v2/user/info/` with `user.info.basic` to read `open_id`,
`display_name`, `username`, and `avatar_url`. `open_id` is how we route TikTok webhook events
back to the right account. The display name, username, and avatar are shown so the user can
confirm they connected the intended TikTok account before publishing to it. We request no
profile scope beyond basic — no follower counts, no statistics, no video list.

**Where the account appears afterwards.** Back in Channel Settings, the same TikTok card now
shows the connected account's avatar, display name, and username, its connection status, when
it last synced, when the access token expires, and which capabilities were granted. From here
the user can **Disconnect** at any time, which revokes the token with TikTok and erases the
stored credentials on our side.

---

### Content Posting API — scope `video.publish` (Direct Post)

**Where the feature lives.** **Marketing → Social Publisher**
(`/marketing/social-media-publisher`). This is the same composer the store already uses for
its other channels; TikTok is one more destination inside it, not a separate screen.

**Selecting TikTok.** The composer shows the available destinations. The user selects TikTok.
If no TikTok account is connected, if the connection has expired, or if posting permission
was not granted, publishing is blocked and the composer explains exactly which of those is
the case and links back to Channel Settings. It never lets the user reach TikTok's API in a
state TikTok would reject.

**Selecting the video.** The user picks a video file in the composer. TikTok accepts video
only, so an image is refused before anything is uploaded. We also check the file format and
size, and read the video's actual duration in the browser.

**Posting options are loaded live from TikTok.** As soon as TikTok is selected on a connected
account, we call `/v2/post/publish/creator_info/query/` and render exactly what it returns
for that specific creator:

- **Privacy** — the selector is populated only from the `privacy_level_options` TikTok
  returns for this account. Nothing is preselected: the user must actively choose who can
  view the video. A level TikTok did not return is never offered.
- **Comments, Duet, Stitch** — driven by the `comment_disabled`, `duet_disabled`, and
  `stitch_disabled` flags. If TikTok says the creator has one of these switched off, the
  control is rendered disabled with an explanation instead of letting the user request
  something the account does not permit.
- **Maximum video length** — `max_video_post_duration_sec` is displayed alongside the
  selected video's real duration, and a video longer than the account's limit is refused
  before upload.

These options are re-fetched every time the panel is opened and re-validated on the server
immediately before the post is initialized, so a setting the creator changed on TikTok in the
meantime cannot be posted against.

**Commercial content disclosure.** The composer includes a disclosure switch that is **off by
default**. Turning it on reveals two choices, "Your Brand" and "Branded Content". At least one
must be selected or publishing stays blocked. Branded Content cannot be combined with the
"Only me" privacy level — that option is disabled with an explanation, and if it had already
been selected it is cleared rather than silently changed. The required consent statement is
shown above the publish action and its wording follows the selection: the Music Usage
Confirmation on its own, or the Branded Content Policy together with the Music Usage
Confirmation when Branded Content is declared.

**Explicit user consent.** Choosing a video does nothing on its own — there is no automatic
publishing anywhere in this flow. The user must press **Publish** deliberately, and that
button stays disabled until a privacy level is chosen, the disclosure requirements are
satisfied, and the video passes validation.

**Direct Post.** On confirmation, our backend re-reads creator info, re-validates every
option server-side, calls `/v2/post/publish/video/init/` with the caption, the chosen privacy
level, the interaction settings, and the disclosure flags, then uploads the video bytes with
`FILE_UPLOAD` to the upload URL TikTok returns. We do not use `PULL_FROM_URL`. Each publish
carries an idempotency key derived from the post, so a retried or double-submitted request
returns the existing job instead of creating a second TikTok video.

**Processing and final status.** A successful initialization is **not** reported as a
successful post. The composer switches to a live status tracker and polls
`/v2/post/publish/status/fetch/` until TikTok reaches a final state, showing "Uploading",
then "TikTok is processing your video", and only then "Published on TikTok" or "TikTok
publishing failed" with the reason TikTok returned. The user is never told the video is live
before TikTok says it is.

---

### Content Posting API — scope `video.upload` (Upload to Drafts)

This is a **separate action with a separate button**, labelled **Upload to TikTok Draft**, and
it is never presented as, or merged with, Direct Post.

When the user chooses it, we call `/v2/post/publish/inbox/video/init/` and upload the video
with `FILE_UPLOAD`. No caption, no privacy level, and no disclosure flags are sent, because
the video is not being posted anywhere — it lands in the creator's TikTok Drafts so they can
finish it and decide whether to publish inside the TikTok app. The final state we report for
this action is "Ready in your TikTok drafts", which is deliberately distinct from "Published
on TikTok". A draft is never described to the user as a published post.

We offer both flows because a store marketer often wants to hand a prepared video to whoever
manages the TikTok account rather than post it immediately.

---

### Webhooks

Our webhook endpoint is `https://api.m1store-egy.com/api/webhooks/tiktok`. Every request is
verified before it is accepted: we compute HMAC-SHA256 over the timestamp and the raw request
body using our client secret, compare it against the `TikTok-Signature` header in constant
time, and reject any request whose signature does not match or whose timestamp is outside a
tolerance window. Unverifiable requests are rejected, never acknowledged as valid. Verified
events are stored and acknowledged with an immediate `200`, then processed asynchronously.
Because delivery is at-least-once, each event is de-duplicated on a content hash so a retry
is never processed twice.

We act on exactly three events:

- **`authorization.removed`** — the user disconnected our app, deleted or changed their
  account, or their account was restricted. We immediately erase the stored tokens for that
  `open_id` and mark the connection as needing reconnection, so the ERP stops treating the
  account as connected and never attempts to post with a revoked authorization.
- **`video.publish.completed`** — a Direct Post finished publishing. We mark the matching
  publish job as published so the ERP reflects the real outcome.
- **`video.upload.failed`** — an upload failed. We mark the matching job as failed so the user
  sees the failure instead of a job stuck in "processing".

`portability.download.ready` is recorded if received but not acted on, because we do not use
the Data Portability API. Any event type we do not recognize is stored and acknowledged
without action rather than repeatedly retried.

We do not claim or rely on any comment-related webhook. TikTok does not provide one, and this
app has no comment functionality.

---

## 4. Terms of Service

`TERMS URL: https://m1store-egy.com/terms`

**Status: usable, with one recommended addition (not blocking).**

Verified: the route is registered in the application (`src/App.jsx`), served over HTTPS, and
is publicly reachable with no login — it is a storefront route outside the authenticated ERP.
It covers acceptance of terms, permitted use, prohibited use, and a support contact.

Two things worth fixing before submission:

1. **It names Meta but not TikTok.** The permitted/prohibited-use sections say usage must
   comply with "Meta policies". Nothing there conflicts with TikTok, but a reviewer reading it
   will notice the platform they are reviewing is absent. Add TikTok alongside Meta in the
   permitted-use and prohibited-use sections.
2. **The page is Arabic-only** (`dir="rtl"`, all body copy in Arabic). TikTok's reviewers read
   English. Provide an English version or a bilingual page, otherwise the reviewer cannot
   assess it.

~~The support address on the page is `support@m1store-eg.com` while the site is
`m1store-egy.com`.~~ **Resolved:** the legal pages were the only place using the `-eg` domain;
the storefront footer, the transactional email footer, and the order email service default all
use `support@m1store-egy.com`. The legal pages now use that address too.

No page was created or modified in this round.

---

## 5. Privacy Policy

`PRIVACY UPDATE REQUIRED`

Current page: `https://m1store-egy.com/privacy` (public, HTTPS, no login — the URL itself is
fine and can stay). The content is not sufficient for this submission.

Assessed against each required item:

| Required | Present? | Notes |
| --- | --- | --- |
| Third-party platform integrations | ⚠️ partial | Names Meta only — "Messenger, Instagram, WhatsApp". TikTok is absent. |
| OAuth / authorization flow | ❌ | Not mentioned at all. |
| TikTok account information | ❌ | Not mentioned. |
| Tokens / authorization credentials | ❌ | Not mentioned. |
| User-generated / uploaded media | ❌ | Covers contact details, conversations, orders and usage data — not uploaded video. |
| Publishing to third-party platforms | ❌ | The policy is written entirely around collecting customer data. It never says the platform publishes content on the user's behalf. |
| Data retention | ✅ | "We retain data for the period required for operations, legal obligations, and customer support." |
| Revoking access / disconnecting | ❌ | Not mentioned. |
| Data deletion / contact | ✅ | Support email plus a dedicated `/data-deletion` page. |

**The page is also Arabic-only**, same issue as Terms.

### Exact clauses to add

Add a TikTok/third-party integration section containing all of the following:

1. **What we connect to.** "When an authorized user connects a TikTok account, M1 Store
   accesses that account through TikTok's official APIs under the permissions the user grants
   during authorization."
2. **Account information we receive.** "From TikTok we receive the account's identifier,
   display name, username, and profile picture. We use them only to identify the connected
   account and to display it inside the system. We do not receive or store the TikTok
   password."
3. **Authorization credentials.** "Authorization credentials issued by TikTok are stored in
   encrypted form, are accessible only to the system's backend services, and are never
   exposed to the browser or to any third party." *(Keep it at this level — do not describe
   algorithms, key handling, or storage internals.)*
4. **Uploaded media.** "Videos and images that a user uploads for publishing are stored on our
   servers for the purpose of publishing them and keeping a record of what was published."
5. **Publishing on the user's behalf.** "M1 Store publishes content to a connected third-party
   platform only when an authorized user explicitly confirms the action. No content is
   published automatically."
6. **Retention of integration data.** "Connection records and publishing history are retained
   for as long as the account remains connected and for the period required by our operational
   and legal obligations."
7. **Revoking access.** "A user may disconnect a connected TikTok account at any time from
   Channel Settings inside M1 Store, which revokes the authorization with TikTok and deletes
   the stored credentials. Access can also be revoked directly from the TikTok app, in which
   case M1 Store stops using the account immediately."
8. **Deletion and contact.** Keep the existing support email and link the existing
   `/data-deletion` page from this section too.

Do **not** describe encryption algorithms, key derivation, token lifetimes, or any other
security internals — general language is what is required, and specifics create risk.

No page was created or modified in this round.

---

## 6. Demo Video Script — shot by shot

**Before you start recording**

- Sign in to the ERP as an admin (Channel Settings is admin-only) with `marketing.publish`
  permission.
- Have the TikTok account already **disconnected**, so the reviewer sees the full connect flow.
- Prepare one short test video that satisfies the account's limits: MP4, well under the
  account's maximum duration, and safe to publish publicly.
- Full-screen browser, no bookmarks bar, no other tabs visible.
- Do not narrate with audio unless you are comfortable in English — on-screen actions plus the
  visible UI are enough. If you do narrate, keep to the lines below.
- Record at a readable resolution and move slowly. Pause ~2 seconds on every screen the
  reviewer needs to read.

---

**Shot 1 — Open the ERP (0:00–0:08)**
Open `https://m1store-egy.com`. Show the login screen. Sign in.
*Say:* "This is M1 Store ERP, the internal business system for our store."

**Shot 2 — Open Channel Settings (0:08–0:18)**
Navigate to `/admin/ai-channels`. Let the page load fully. Scroll so the **TikTok** card is
centred and clearly visible.
*Say:* "Channel Settings, where we connect the platforms we publish to."

**Shot 3 — Show Not Connected (0:18–0:25)**
Hold on the TikTok card. The status badge reads **Not connected** and a single **Connect
TikTok** button is shown. Pause 3 seconds so the reviewer can read the status.
*Say:* "No TikTok account is connected yet."

**Shot 4 — Press Connect TikTok (0:25–0:30)**
Move the cursor visibly to **Connect TikTok** and click.

**Shot 5 — TikTok authorization screen (0:30–0:45)**
The browser navigates to TikTok's own consent page. **Stay here for at least 6 seconds** and
make sure the requested permissions are legible — this is the shot the reviewer checks most
closely. Scroll the consent list if it is cut off.
*Say:* "TikTok's own authorization screen, showing exactly what we request."

**Shot 6 — Approve (0:45–0:52)**
Click TikTok's Authorize / Continue button.

**Shot 7 — Automatic return to the ERP (0:52–1:00)**
Do not touch anything. Let the redirect land back on `/admin/ai-channels` on its own. Let the
success notification appear.
*Say:* "We are returned to the ERP automatically."

**Shot 8 — Show Connected (1:00–1:12)**
Hold on the TikTok card, now showing the account avatar, display name, username, **Connected**
status, last sync, token expiry, and the granted capabilities. Pause 4 seconds.
*Say:* "The account is connected, and the ERP shows which account and what it can do."

**Shot 9 — Open the Social Publisher (1:12–1:22)**
Navigate to **Marketing → Social Publisher** (`/marketing/social-media-publisher`).
*Say:* "This is the Social Publisher, where we compose posts."

**Shot 10 — Select TikTok (1:22–1:30)**
Click the **TikTok** destination so it becomes selected. Do not select Facebook or Instagram.

**Shot 11 — Choose the test video (1:30–1:42)**
Click the media selector and choose the prepared MP4. Wait for the preview to appear.
*Say:* "We select the video we want to post."

**Shot 12 — Dynamic posting options appear (1:42–2:00)**
The TikTok options panel loads. **Pause here for at least 8 seconds.** The reviewer must see
that these came from TikTok, not from us.
*Say:* "These posting options are loaded from TikTok for this specific account — we do not
hardcode them."

**Shot 13 — Open the privacy selector (2:00–2:12)**
Click the privacy dropdown so the list expands, and hold for 3 seconds so the reviewer sees
that the options match the account. Then select a level, for example "Everyone".
*Say:* "Nothing is preselected — the user must choose who can view the video."

**Shot 14 — Show Comments / Duet / Stitch (2:12–2:26)**
Point at the three interaction toggles. If any is greyed out, hover it so the "Disabled on
this TikTok account" note is visible and hold for 3 seconds.
*Say:* "Comments, Duet and Stitch follow the creator's own settings. Anything TikTok reports
as disabled is disabled here too."

**Shot 15 — Show the maximum duration (2:26–2:34)**
Point at the line showing the account's maximum video length next to the current video's
duration.

**Shot 16 — Commercial content disclosure (2:34–2:56)**
Show the disclosure switch in its default **off** state, then turn it on. Both "Your Brand"
and "Branded Content" appear. Turn it back off, or select one and show the resulting label
text and the consent statement changing. Hold 4 seconds on the consent statement.
*Say:* "The commercial content disclosure is off by default, and if it is turned on the user
must say whether the content promotes themselves or a third party."

**Shot 17 — Prove nothing has published yet (2:56–3:08)**
Move the cursor away from every button. Sit still for 4 full seconds on the composed post.
*Say:* "Selecting a video and setting options does not publish anything. Nothing has been
posted so far."

**Shot 18 — Press Publish (3:08–3:15)**
Move the cursor deliberately to **Publish** and click it once.
*Say:* "Publishing only happens when the user explicitly confirms."

**Shot 19 — Show Processing (3:15–3:35)**
The status tracker appears. Let it show "Uploading" and then "TikTok is processing your
video". **Do not cut this shot short** — the reviewer needs to see we do not claim success
early.
*Say:* "The ERP tracks the real status from TikTok rather than assuming success."

**Shot 20 — Show the final status (3:35–3:50)**
Wait for the tracker to reach **Published on TikTok**. Hold 4 seconds.

**Shot 21 — Show the post on TikTok (3:50–4:10)**
Open the TikTok app or the account's profile in a new tab and show the video now live on the
profile. This is worth including — it is the strongest proof the integration works end to end.

**Shot 22 — Return to the ERP (4:10–4:18)**
Go back to the Social Publisher tab.

**Shot 23 — Demonstrate Draft upload (4:18–4:50)**
Because `video.upload` is in the same review request, show it. Compose a new post, select
TikTok only, choose a second test video, and click **Upload to TikTok Draft** — the separate
button, not Publish. Show the status reaching **Ready in your TikTok drafts**. Then open the
TikTok app and show the video sitting in Drafts, not on the profile.
*Say:* "Uploading to drafts is a separate action. The video goes to the creator's TikTok
drafts and is not published."

**Total runtime: roughly 4–5 minutes.**

### Must NOT appear anywhere in the video

- The client key or client secret
- Any access token or refresh token
- Any server `.env` file, terminal, or deployment console
- Browser DevTools — network, console, storage, or cookies
- Any database view or admin console showing stored credentials
- Customer names, phone numbers, addresses, or order details — if the ERP navigation exposes
  customer data in passing, navigate by URL rather than clicking through those screens
- Any other tenant's or employee's personal data

If you must show an error state, make sure the message on screen is the user-facing one and
not a raw API response.

---

## 7. Reviewer Navigation

Paste these into the review notes.

**Connect a TikTok account**
`Sign in → Channel Settings (/admin/ai-channels) → TikTok card → Connect TikTok`
*Requires an admin account.*

**Publish a video to TikTok (Direct Post)**
`Sign in → Marketing → Social Publisher (/marketing/social-media-publisher) → select TikTok → choose a video → set posting options → Publish`
*Requires the `marketing.publish` permission.*

**Upload a video to TikTok Drafts**
`Sign in → Marketing → Social Publisher (/marketing/social-media-publisher) → select TikTok → choose a video → Upload to TikTok Draft`

**Disconnect the account**
`Sign in → Channel Settings (/admin/ai-channels) → TikTok card → Disconnect`

---

## 8. Final Portal Checklist

| Field | Value | Source |
| --- | --- | --- |
| **App Name** | `M1 Store` | already created in the portal |
| **Category** | *read from the portal dropdown* — prefer Business / Business Tools, else Productivity | not documented publicly |
| **Description** | section 2 above (full, with a short fallback) | written for this submission |
| **Terms URL** | `https://m1store-egy.com/terms` | verified route, public, HTTPS |
| **Privacy URL** | `https://m1store-egy.com/privacy` | **update the content first** — see section 5 |
| **Platform** | `Web` | ERP is a browser app; callback is server-side; no PKCE needed |
| **Redirect URI** | `https://api.m1store-egy.com/api/tiktok/oauth/callback` | `server/server.js`, `TIKTOK_REDIRECT_URI` |
| **Webhook Callback URL** | `https://api.m1store-egy.com/api/webhooks/tiktok` | `server/server.js` mount |
| **Products** | Login Kit · Content Posting API · Webhooks | matches implementation |
| **Scopes** | `user.info.basic` · `video.upload` · `video.publish` | `tiktokConfigService.js` |
| **Direct Post enabled?** | **Yes** — required | `video.publish` flow is implemented |
| **Domain Verification required?** | **No** | `FILE_UPLOAD` only; `PULL_FROM_URL` not implemented |
| **Review Explanation ready?** | **Yes** — section 3 | verified against the code |
| **Demo Video ready to record?** | **Yes** — section 6 | every step exists in the UI |

### Blocking before submission

1. **Privacy Policy content must be updated** (section 5). This is the only hard blocker.
2. **English versions of Terms and Privacy** — both pages are currently Arabic-only.
3. **Deploy the integration.** Everything above describes code on an unpushed branch. The
   reviewer cannot test, and the demo cannot be recorded, until it is running in production
   with the TikTok environment variables set and the webhook URL registered.
4. **Add TikTok to the Terms** permitted/prohibited-use sections (recommended, not blocking).
5. ~~Confirm the support-address domain mismatch.~~ **Done** — the legal pages now use
   `support@m1store-egy.com`, matching the rest of the system.

---

## 9. Internal note — not for the portal

`TikTok Comments: WAITING_FOR_TIKTOK_BUSINESS_PERMISSION`

No comment-related scope, product, or permission is requested in this submission, and the
review explanation makes no claim about comments. Comment management requires TikTok API for
Business — a separate application, a separate authorization, and a separate access grant that
approving this Login Kit app does not provide. It stays out of this review entirely.
