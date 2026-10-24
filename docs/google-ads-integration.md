# Google Ads integration

Entry point: `/google-ads`. Permissions: `google_ads.view` and `google_ads.manage`.

## Server configuration

Set these in the server secret environment, never in frontend variables:

- `GOOGLE_ADS_CLIENT_ID`: Web OAuth client in the approved Google Cloud project.
- `GOOGLE_ADS_CLIENT_SECRET`: OAuth client secret.
- `GOOGLE_ADS_REDIRECT_URI`: exact public backend URL ending in `/api/google-ads/oauth/callback`. Register this exact URI with Google.
- `GOOGLE_ADS_FRONTEND_URL`: trusted public admin URL ending in `/google-ads`. Never derived from a request header.
- `GOOGLE_ADS_ENCRYPTION_KEY`: independent random secret of at least 32 characters and 8 distinct characters; preserve across deployments.
- `GOOGLE_ADS_API_VERSION`: defaults to `v26`.
- `GOOGLE_ADS_LOGIN_CUSTOMER_ID`: optional manager customer ID when using manager access.
- `GOOGLE_ADS_DEVELOPER_TOKEN`: optional legacy compatibility header. Google now assigns API access through the Cloud project.

Enable Google Ads API and obtain production access for the Cloud project. Configure the OAuth consent screen and authorized users as required by Google. Restart the server to create the two integration tables, then connect from the page. This is separate from linking Merchant Center to an ads account.

## Implemented

- Tenant-scoped encrypted offline authorization, expiring single-use OAuth state and local disconnect.
- Accessible direct and manager client accounts, campaigns, ad groups, keywords, ads and asset groups, with 7/30-day performance in the account currency, product and search-term reports and campaign filters.
- Campaign pause/enable, daily budget editing for non-shared budgets.
- Atomic creation of a paused Search campaign including budget, ad group, positive keywords, responsive Search ad, geographic and language criteria and campaign negatives.
- Atomic creation of a paused retail Performance Max campaign using Merchant Center product data, feed label, optional brand-only product tree, geographic and language targeting, bidding and final URL expansion controls. No custom assets are linked in this flow.
- Manual CPC (Search), maximize conversions with optional target CPA, maximize conversion value with optional target ROAS. ROAS is entered as a percent and sent as a ratio.
- Add paused Search groups/ads and retail asset groups; add group keywords; pause/enable groups, ads, keywords and asset groups, including objects with no reporting activity.
- Campaign renaming, bidding changes, geographic/language targeting additions/removal, and campaign negative keywords.
- Read conversion action configuration. This does not verify that purchase events are received.
- Purchase tracking setup creates/reuses `M1 Store - Website Purchase` (WEBPAGE/PURCHASE), stores its public AW destination per tenant, and exposes only the retail tenant's tag destination to the storefront. The existing Google tag consent initialization is reused. New eligible checkout/success events send a transaction ID, actual value and EGP, with persistent deduplication. No enhanced conversions or customer PII is sent. COD order placement is measured, not cash collection or delivery.
- The UI selects a sole ad account automatically and has explicit Reports, Create campaign, Manage campaigns and Purchase tracking sections, plus a top-level Create campaign button.
- A Google `validateOnly` step before campaign creation. New campaign and budget resources are created in one atomic mutation. Date fields use v26 account-local timestamps.
- Server permission checks on all authenticated routes. Public callback authenticates through consumed OAuth state.

## Remaining scope

This is not full Google Ads parity. Custom Performance Max image/video/text asset upload, audience signals, arbitrary multidimensional product partitions, standard Shopping campaign creation, offline/delivered-order conversion uploads, ad text editing in place, billing, change history, and scheduled automation are not implemented. Reports do not include zero-activity rows Google omits for the selected period; the settings view lists existing objects without metric filtering. Shared budgets are deliberately not edited through the campaign control. Retail product selection supports all products or one brand, with the remaining brands excluded.

Campaigns are created paused. Review destination URLs, products, targeting, creatives, bidding and budgets before enabling. Retail Performance Max requires a linked Merchant Center and conversion tracking configured at Google. No real account was authorized and no live campaign or budget was changed during implementation. Deploy and test against a Google Ads test account before enabling production management.

References: https://developers.google.com/google-ads/api/rest/common/mutate, https://developers.google.com/google-ads/api/docs/api-policy/developer-token, https://developers.google.com/google-ads/api/performance-max/retail, https://developers.google.com/google-ads/api/reference/rpc/v26/Campaign and https://developers.google.com/google-ads/api/reference/rpc/v26/AssetAutomationTypeEnum.AssetAutomationType
