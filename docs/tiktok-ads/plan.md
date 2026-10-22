# TikTok Ads module — status and plan

Module: `/tiktok-ads` (frontend `src/modules/tiktokAds`, server `server/modules/tiktokAds`,
tables `tiktok_ads_*`, perms `tiktok_ads.view/manage`, tests `tests/tiktok-ads/`).
Endpoint reference (every path/field with its TikTok doc id): see the comments in
`server/modules/tiktokAds/tiktokAdsApi.js`.

## Accounts and app

- Business Center "M1 Store_bc_8wjbzx" (7697374213300551700), advertiser "M1 Store_adv" (7697374127748923413).
- Developer app "M1 Store ERP" (app id 7678378836345487380) on business-api.tiktok.com. Same app as the
  TikTok Business comments integration; advertiser login is a different authorization (auth_code ->
  `/oauth2/access_token/`, token never expires, dies only on revoke).
- Advertiser redirect URL registered in the app: `https://api.m1store-egy.com/api/tiktok-business/oauth/callback`.
  The TikTok Business callback hands any `state` starting with `tta_` to `tiktokAdsOAuthCallback`.
- Permissions: on 2026-10-22 the app held Ad account management, Measurement, TikTok accounts and CTM event
  management only. Ads management, Reporting, Creative management, Pixel management and DPA catalog management
  were submitted for review the same day (portal: "Your scope of permission changes are currently under review").
  After approval the advertiser must connect again: a token carries the scopes granted at login.

## Phase 1 — connect (done)

OAuth start -> TikTok -> callback -> token (tkb:v1) -> `/advertiser/info/` (name, currency, timezone,
balance, status). Connect page shows the account, balance and granted permissions.

## Phase 2 — read (done; live once Ads management + Reporting are approved)

- `/campaign/get/`, `/adgroup/get/`, `/ad/get/` (page_size 1000) into `tiktok_ads_campaigns/adgroups/ads`.
- `/report/integrated/get/` BASIC, one id dimension + `stat_time_day` per level, chunks of 30 days
  (the day-dimension cap), into `tiktok_ads_insights`. Website purchases = `complete_payment`,
  purchase value = `total_complete_payment_rate` (sic; `total_purchase_value` is the app metric).
- Jobs: every hour the last 3 days, every day the last 30. `TIKTOK_ADS_JOBS_ENABLED=false` stops both.
- Without the scopes the sync records `structure_state/report_state = missing_permission` and the screens
  say "waiting for TikTok" instead of an empty list.

## Phase 3 — manage (planned)

1. Pause / resume: `POST /campaign|adgroup|ad/status/update/` with `operation_status` ENABLE / DISABLE
   (max 20 ids per call). Optimistic row update, re-read the object after.
2. Budget: campaign `POST /campaign/update/` (`budget`); ad group `POST /adgroup/budget/update/`
   (`budget[]` for lifetime = immediate; `scheduled_budget[]` for daily = from 00:00 next day in the
   account time zone — the screen must say so). Never `/adgroup/update/` for this: it is a full replacement.
   Ad-group budget is refused under campaign budget optimisation; hide the control there.
3. Create: **TikTok retires the legacy create endpoints for Sales campaigns on 2027-01-01** (portal notice:
   `/campaign/create/`, `/adgroup/create/`, `/ad/create/` stop creating non-Search Legacy Manual Flow
   campaigns for Sales, App Promotion and Lead Generation). So the wizard targets the **Upgraded Smart+ APIs**
   from the start — read their docs (doc ids to be resolved the same way as phase 1/2) before writing it.
   Everything is created paused, like Meta Ads.
4. Catalog ads on catalog 7697676883848120085 (BC 7697374213300551700): `GET /catalog/get/` and
   `/catalog/set/get/` (need `bc_id`; DPA catalog management) to sync product sets; Sales objective with
   catalog product source, website destination, pixel from `/pixel/list/` (Pixel management), product set
   per ad group/ad. `PRODUCT_SALES` was documented as allowlist-only while the catalog guide says web
   advertisers get it automatically — expect a refusal and show TikTok's message.
5. Creative: video/image upload `/file/video/ad/upload/`, `/file/image/ad/upload/`; identity `/identity/get/`
   (Creative management).
6. Rate limits: default tier 10 QPS / 600 QPM per endpoint; `/ad/create/` 5 QPS. Code 40100 = wait 5 minutes.

## Phase 4 — review status (planned)

- Delivery column already shows `AD_STATUS_AUDIT_DENY` / `*_AUDIT` as rejected / in review.
- Reasons: `GET /ad/review_info/` (up to 100 ad ids) -> `reject_info[].reasons` + `suggestion`, stored per ad
  and shown in a drawer; `GET /adgroup/review_info/` for ad-group level verdicts.
- Appeal: only per ad group, `POST /adgroup/appeal/` (`adgroup_id`, optional `ad_id`, `appeal_reason`,
  `attachment_list`). There is no `/ad/appeal/`.
