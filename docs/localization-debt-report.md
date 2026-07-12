# Localization Debt Report

Generated: 2026-07-12T13:09:22.815Z

This report flags obvious hardcoded UI strings. It is intentionally conservative and may include false positives.

## inventory (3)

### src\modules\inventory\pages\InventoryCount.jsx
- 1580 [jsx-text] Products Counted
- 1584 [jsx-text] Total Quantity Counted
- 1588 [jsx-text] Variance Count

## marketing (267)

### src\modules\marketing\components\MarketingCampaignAnalyticsPanel.jsx
- 198 [jsx-text] Campaign Analytics
- 199 [jsx-text] Overview, timeline, history, and top posts.
- 214 [jsx-text] Published
- 216 [jsx-text] Number of published posts.
- 219 [jsx-text] Scheduled
- 224 [jsx-text] Drafts
- 226 [jsx-text] Draft content in progress.
- 229 [jsx-text] First Comments
- 233 [jsx-text] Published
- 237 [jsx-text] Failed
- 241 [jsx-text] Skipped
- 251 [jsx-text] Charts
- 252 [jsx-text] Last 30 days
- 285 [jsx-text] Timeline
- 286 [jsx-text] Recent publishing activity
- 324 [jsx-text] No activity yet.
- 333 [jsx-text] History Table
- 334 [jsx-text] Recent social publisher posts with caption and first comment previews.
- 339 [jsx-text] No history yet.
- 363 [jsx-text] Caption Preview
- 367 [jsx-text] Comment Preview
- 374 [jsx-text] Published
- 378 [jsx-text] Actions
- 408 [jsx-text] Platform
- 409 [jsx-text] Template
- 410 [jsx-text] Status
- 411 [jsx-text] Caption
- 412 [jsx-text] First Comment
- 413 [jsx-text] Published
- 414 [jsx-text] Actions
- 440 [jsx-text] Content template snapshot
- 511 [jsx-text] Top Posts
- 512 [jsx-text] Best performing posts from analytics
- 519 [jsx-text] Post
- 520 [jsx-text] Platform
- 521 [jsx-text] Likes
- 522 [jsx-text] Comments
- 523 [jsx-text] Shares
- 524 [jsx-text] Reach
- 525 [jsx-text] Impressions
- ... 9 more

### src\modules\marketing\components\PostEditorModal.jsx
- 688 [jsx-text] ERP Store
- 1132 [jsx-text] TikTok - Coming Soon
- 1139 [jsx-text] TikTok
- 1140 [jsx-text] Coming Soon
- 1158 [jsx-text] Tone
- 1186 [jsx-text] Regenerate Hook
- 1194 [jsx-text] Regenerate CTA
- 1202 [jsx-text] Regenerate Hashtags
- 1254 [jsx-text] Product URL
- 1263 [prop-label] Price
- 1264 [prop-label] Color
- 1265 [prop-label] Size

### src\modules\marketing\pages\AiLeadCenter.jsx
- 412 [jsx-text] Social leads in one command view
- 451 [jsx-text] Filters
- 539 [jsx-text] Loading AI leads...
- 545 [jsx-text] No leads match the current filters.
- 546 [jsx-text] Try another platform, stage, or time range.
- 569 [jsx-text] Customer
- 573 [jsx-text] Platform
- 577 [jsx-text] Source Post
- 581 [jsx-text] Interested Product
- 585 [jsx-text] Current Stage
- 589 [jsx-text] Assigned AI
- 596 [jsx-text] Confidence
- 622 [jsx-text] Lead Detail
- 623 [jsx-text] Selected lead with stage timeline
- 638 [jsx-text] Source Post
- 642 [jsx-text] Interested Product
- 649 [jsx-text] Timeline
- 684 [title] Customer 360

### src\modules\marketing\pages\AiMarketingCenter.jsx
- 768 [jsx-text] Stories and posts that stay clean
- 1039 [jsx-text] Delete Selected
- 1115 [jsx-text] Arabic Trend
- 1135 [jsx-text] Preview
- 1148 [jsx-text] Retry
- 1191 [jsx-text] Generated story asset
- 1198 [jsx-text] No generated story asset
- 1203 [jsx-text] Story Slides
- 1234 [jsx-text] Performance Brain
- 1272 [jsx-text] Cancel
- 1291 [jsx-text] Content History
- 1294 [jsx-text] Close
- 1365 [jsx-text] Technical JSON
- 1401 [jsx-text] Rendered
- 1416 [jsx-text] Close
- 1426 [jsx-text] Story publish asset debug
- 1506 [jsx-text] Admin / debug
- 1542 [jsx-text] Technical JSON
- 808 [title] Content Lanes
- 810 [title] New Arrivals
- 812 [title] AI Posts
- 817 [title] Daily Volume
- 992 [title] Best Posting Windows
- 1145 [title] Duplicate
- 1149 [title] Delete
- 1233 [title] AI Recommendations
- 1349 [title] AI post preview
- 1104 [aria-label] Select content
- 492 [toast] Engine settings saved
- 532 [toast] Queue item is missing an id. Queue updated.
- 586 [toast] This item was already removed or refreshed. Queue updated.
- 607 [toast] Queue item is missing an id.
- 749 [toast] Posting insights synced
- 800 [prop-label] Stories Generated Today
- 801 [prop-label] Posts Generated Today
- 819 [prop-label] Stories
- 820 [prop-label] Posts
- 849 [prop-label] Delete archived after days
- 1104 [prop-label] Select content
- 1419 [prop-label] Content type
- ... 23 more

### src\modules\marketing\pages\AiMarketingVideos.jsx
- 312 [jsx-text] Videos
- 358 [jsx-text] Videos per day
- 434 [jsx-text] video
- 437 [jsx-text] Instagram
- 438 [jsx-text] Facebook
- 439 [jsx-text] TikTok later
- 446 [jsx-text] Preview
- 646 [jsx-text] Variant details
- 656 [jsx-text] Price focus
- 666 [jsx-text] Limited availability
- 692 [jsx-text] Video preview
- 719 [jsx-text] Video readiness
- 332 [title] Content Lanes
- 356 [title] Daily Video Volume
- 382 [title] Video Queue
- 324 [prop-label] Video Queue
- 701 [prop-label] Status
- 702 [prop-label] Scheduled
- 703 [prop-label] Playback
- 704 [prop-label] Preset
- 705 [prop-label] Quality score
- 706 [prop-label] Aspect ratio
- 707 [prop-label] Estimated engagement
- 708 [prop-label] Motion style
- 709 [prop-label] Reel energy
- 710 [prop-label] Hook strength
- 711 [prop-label] Pacing
- 712 [prop-label] CTA strength
- 713 [prop-label] Trend fit
- 714 [prop-label] Reel type
- 715 [prop-label] Transition style

### src\modules\marketing\pages\MarketingSettings.jsx
- 927 [jsx-text] Meta OAuth readiness
- 928 [jsx-text] Use these values in Meta Developer settings. Secret values are never displayed here.
- 934 [jsx-text] Environment
- 946 [jsx-text] OAuth Redirect URI
- 968 [jsx-text] Required permissions
- 977 [jsx-text] Setup steps
- 994 [jsx-text] Post-OAuth result
- 1001 [jsx-text] Connected page
- 1009 [jsx-text] Missing permissions
- 1028 [jsx-text] Connect Meta
- 1092 [jsx-text] Verify webhook and capabilities
- 1093 [jsx-text] Runs live permission checks, token diagnostics, and webhook delivery health.
- 1113 [jsx-text] Setup checklist
- 1145 [jsx-text] Connection
- 1174 [jsx-text] Page ID is managed by the guided connection flow.
- 1179 [jsx-text] Manual Account ID entry is hidden unless advanced mode is enabled.
- 1371 [jsx-text] Live delivery health
- 644 [toast] Meta connection timed out. You can try again.
- 766 [toast] Meta setup complete

### src\modules\marketing\pages\PostTemplates.jsx
- 176 [jsx-text] Template Library
- 177 [jsx-text] Curated cards
- 207 [jsx-text] Card
- 208 [jsx-text] Library
- 222 [jsx-text] Saved templates
- 223 [jsx-text] Custom templates

### src\modules\marketing\pages\SocialCommentsCenter.jsx
- 781 [jsx-text] Marketing / Social Comments
- 782 [jsx-text] Social Comments Center
- 783 [jsx-text] Open the post and the exact comment target from AI Inbox, with reply and moderation tools in one place.
- 813 [jsx-text] Social Performance
- 814 [jsx-text] Admin debug summary
- 829 [jsx-text] Fast list avg ms
- 833 [jsx-text] Fast list p95 ms
- 837 [jsx-text] Cache hit rate
- 841 [jsx-text] Slow fast-list
- 845 [jsx-text] Queue length
- 849 [jsx-text] Active jobs
- 853 [jsx-text] Job avg ms
- 857 [jsx-text] Socket emits
- 861 [jsx-text] Rendered rows
- 865 [jsx-text] Socket patches
- 869 [jsx-text] Cache hits
- 873 [jsx-text] Cache misses
- 922 [title] Customer 360

### src\modules\marketing\pages\SocialMediaPublisher.jsx
- 1683 [jsx-text] Media preview will show here
- 1703 [jsx-text] 84 comments
- 1704 [jsx-text] 21 shares
- 1747 [jsx-text] Create Post From
- 1748 [jsx-text] Choose how you want to start this post.
- 1763 [jsx-text] Upload From Device
- 1764 [jsx-text] Active now
- 1772 [jsx-text] Product Catalog
- 1773 [jsx-text] Select from ERP products
- 1781 [jsx-text] AI Marketing
- 1782 [jsx-text] Coming Soon
- 1968 [jsx-text] Suggested First Comment
- 2138 [jsx-text] Publishing Account
- 2139 [jsx-text] Choose the connected Facebook page and Instagram account.
- 2152 [jsx-text] Facebook
- 2181 [jsx-text] Instagram
- 2259 [jsx-text] TikTok
- 2353 [jsx-text] Publishing Account
- 2356 [jsx-text] Facebook
- 2360 [jsx-text] Instagram
- 2366 [jsx-text] Post Details
- 2369 [jsx-text] Media
- 2373 [jsx-text] Platforms
- 2377 [jsx-text] Status
- 2378 [jsx-text] Draft
- 2452 [jsx-text] Templates
- 2466 [jsx-text] Available templates
- 2476 [jsx-text] New Collection
- 2485 [jsx-text] Preview
- 2562 [jsx-text] Select Product
- 2563 [jsx-text] Choose a product from ERP and autofill the post draft.
- 1949 [placeholder] Write your post caption...
- 2581 [placeholder] Search products...
- 1722 [title] Campaign Studio
- 2332 [aria-label] Preview post
- 2446 [aria-label] Templates
- 2556 [aria-label] Select Product
- 1205 [toast] Select a product first
- 1343 [toast] First comment saved to draft.
- 1350 [toast] Copied successfully.
- ... 11 more

## orders (9)

### src\modules\orders\pages\OrderDetails.jsx
- 1342 [jsx-text] Bosta

### src\modules\orders\pages\OrderReturnsPage.jsx
- 337 [jsx-text] Returns Workspace
- 404 [jsx-text] Orders module

### src\modules\orders\pages\OrdersDashboard.jsx
- 1297 [jsx-text] : proofUrl ?
- 1448 [jsx-text] : proofUrl ?
- 1465 [jsx-text] WhatsApp
- 1550 [jsx-text] WhatsApp
- 1418 [prop-label] \u0637\u0631\u064a\u0642\u0629 \u0627\u0644\u0627\u0633\u062a\u0631\u062f\u0627\u062f
- 1514 [prop-label] \u0637\u0631\u064a\u0642\u0629 \u0627\u0644\u0627\u0633\u062a\u0631\u062f\u0627\u062f

## other (251)

### src\App.jsx
- 337 [title] Employee app screen crashed
- 350 [title] Application screen crashed

### src\components\activity\LiveActivityFeed.jsx
- 37 [jsx-text] Paused
- 116 [aria-label] Loading activity
- 116 [prop-label] Loading activity

### src\components\ai\AILiveLogs.jsx
- 74 [jsx-text] Live AI Logs
- 75 [jsx-text] Operational event stream, kept in memory only.

### src\components\dashboard\CommandCenterDashboard.jsx
- 55 [jsx-text] Command Center
- 56 [jsx-text] Live operations cockpit

### src\components\ProductCard.jsx
- 10 [jsx-text] Nike Air Max
- 12 [jsx-text] Running Shoes

### src\components\ProductColors.jsx
- 633 [placeholder] Choose sizes...
- 234 [toast] Image removed

### src\components\ProductSizes.jsx
- 120 [placeholder] Choose sizes...

### src\components\ProductVariants.jsx
- 299 [placeholder] Black

### src\components\Table.jsx
- 12 [jsx-text] Name
- 19 [jsx-text] Product

### src\modules\aiSupport\components\Customer360Drawer.jsx
- 297 [jsx-text] Summary
- 303 [jsx-text] Quick Actions
- 336 [jsx-text] No current activity yet.
- 354 [jsx-text] Timeline will appear when there is source data.
- 376 [jsx-text] No order history yet.
- 404 [jsx-text] No products in this section.
- 414 [jsx-text] AI Insights
- 417 [jsx-text] Customer usually buys
- 421 [jsx-text] Typical budget
- 425 [jsx-text] Preferred colors
- 429 [jsx-text] Preferred sizes
- 433 [jsx-text] Last interaction
- 437 [jsx-text] Suggested reply style
- 441 [jsx-text] Confidence
- 237 [aria-label] Close customer drawer
- 237 [prop-label] Close customer drawer

### src\modules\aiSupport\components\ProductCardPicker.jsx
- 662 [jsx-text] AI INBOX
- 677 [jsx-text] Sizes
- 707 [jsx-text] Gender
- 713 [jsx-text] Type
- 720 [jsx-text] Brand
- 728 [jsx-text] Min
- 732 [jsx-text] Max
- 739 [jsx-text] Preview
- 784 [jsx-text] AI INBOX
- 800 [jsx-text] Size filter
- 837 [jsx-text] Brand
- 846 [jsx-text] Category
- 985 [jsx-text] Size mode
- 1042 [jsx-text] Selected product

### src\modules\aiSupport\components\socialAutomation\AutomationMessageTemplates.jsx
- 4 [jsx-text] Message Templates
- 5 [jsx-text] Editable replies and AI opening prompt
- 9 [jsx-text] publicReplyTemplate
- 20 [jsx-text] privateReplyTemplate
- 31 [jsx-text] aiOpeningPrompt

### src\modules\aiSupport\components\socialAutomation\AutomationSettingsPanel.jsx
- 13 [jsx-text] Automation Settings
- 14 [jsx-text] Rules and execution toggles

### src\modules\aiSupport\components\socialAutomation\AutomationTemplatePicker.jsx
- 8 [jsx-text] Automation Templates
- 9 [jsx-text] Choose a workflow preset

### src\modules\aiSupport\components\socialAutomation\AutomationWorkflowTimeline.jsx
- 19 [jsx-text] Workflow Timeline
- 20 [jsx-text] ManyChat-style flow preview

### src\modules\aiSupport\components\socialAutomation\PostProductLinksDrawer.jsx
- 624 [jsx-text] Link Products
- 653 [jsx-text] Search ERP Products
- 654 [jsx-text] Infinite search
- 691 [jsx-text] No products yet
- 692 [jsx-text] Type to search ERP products and add them to this post.
- 725 [jsx-text] Add
- 756 [jsx-text] Selected Products
- 757 [jsx-text] Drag to reorder, choose primary
- 772 [jsx-text] No linked products
- 773 [jsx-text] Add one or more ERP products from the search panel.
- 830 [jsx-text] Primary
- 671 [placeholder] Search by name, brand, SKU...
- 619 [aria-label] Close product links drawer
- 567 [confirm] Remove all linked products from this post?
- 619 [prop-label] Close product links drawer

### src\modules\aiSupport\components\socialAutomation\SocialAutomationDrawer.jsx
- 197 [jsx-text] Saved Config
- 199 [jsx-text] config_id:
- 200 [jsx-text] post_id:
- 201 [jsx-text] enabled:
- 202 [jsx-text] template_key:
- 228 [jsx-text] Recent Runs
- 229 [jsx-text] Latest automation outcomes
- 246 [jsx-text] Test Result
- 289 [jsx-text] Loading recent runs...
- 378 [jsx-text] Automation Config
- 385 [jsx-text] Matched Key
- 389 [jsx-text] Resolved Product
- 393 [jsx-text] Skipped Reason
- 398 [jsx-text] Executed Steps
- 402 [jsx-text] Skipped Steps
- 432 [jsx-text] Saved per post.
- 134 [aria-label] Close automation drawer
- 134 [prop-label] Close automation drawer

### src\modules\aiSupport\components\SocialCommentsPanel.jsx
- 178 [jsx-text] Needs reply

### src\modules\aiSupport\components\SocialCommentsWorkspace.jsx
- 2788 [jsx-text] Social Comments
- 2789 [jsx-text] Posts
- 2937 [jsx-text] ⚠ No Product Linked
- 2940 [jsx-text] Needs reply
- 3095 [jsx-text] ⚠ No Product Linked
- 3098 [jsx-text] Needs reply
- 3166 [jsx-text] : activePostType ?
- 3267 [jsx-text] Selected Post ID
- 3272 [jsx-text] Latest Comment Post ID
- 3277 [jsx-text] Selected Permalink
- 3281 [jsx-text] Latest Comment Permalink
- 3371 [jsx-text] ERP Product Card
- 3430 [jsx-text] Comments Timeline
- 3432 [jsx-text] Showing the latest social thread activity
- 3525 [jsx-text] Reply Composer
- 3526 [jsx-text] Draft a reply
- 3606 [jsx-text] Automation Status
- 3607 [jsx-text] Config and runtime summary
- 3629 [jsx-text] Generated Public Reply
- 3635 [jsx-text] Generated Private Reply
- 3643 [jsx-text] Last Steps
- 3663 [jsx-text] AI Assistant
- 3664 [jsx-text] Insight dashboard
- 3666 [jsx-text] Live
- 3690 [jsx-text] Global Template
- 3691 [jsx-text] Generic reply template
- 3727 [jsx-text] Off
- 3728 [jsx-text] Draft only
- 3729 [jsx-text] Manual Approval
- 3730 [jsx-text] Full Auto
- 3740 [jsx-text] OFF by default. Full Auto requires explicit admin enablement.
- 3746 [jsx-text] Post Template
- 3747 [jsx-text] Template specific to this post
- 3803 [jsx-text] Off
- 3804 [jsx-text] Draft only
- 3805 [jsx-text] Manual Approval
- 3806 [jsx-text] Full Auto
- 3824 [jsx-text] Preview
- 3840 [jsx-text] Quick Actions
- 3556 [placeholder] Reply draft
- ... 23 more

### src\modules\aiSupport\components\socialCommentTimeline.jsx
- 521 [jsx-text] Generated Public Reply
- 525 [jsx-text] Generated Private Reply

### src\modules\aiSupport\components\TranscriptMessage.jsx
- 254 [jsx-text] Draft reply
- 300 [jsx-text] Staff

### src\modules\analytics\components\AiInsightCard.jsx
- 17 [jsx-text] AI insight

### src\modules\analytics\components\AnalyticsCharts.jsx
- 57 [title] Sales trend
- 57 [title] Order movement and sales velocity using backend chart data.
- 77 [title] Channel mix
- 77 [title] Sales distribution across commerce channels.
- 90 [prop-label] No sales channel data available.

### src\modules\analytics\lib\analyticsExport.js
- 222 [jsx-text] Selected filters
- 224 [jsx-text] `).join("") : '
- 224 [jsx-text] No filters selected
- 229 [jsx-text] KPI summary
- 245 [jsx-text] Revenue / profit trend
- 247 [jsx-text] Period
- 247 [jsx-text] Revenue
- 247 [jsx-text] Profit
- 247 [jsx-text] Orders
- 255 [jsx-text] Sales trend
- 257 [jsx-text] Period
- 257 [jsx-text] Revenue
- 257 [jsx-text] Orders
- 266 [jsx-text] Inventory risks
- 268 [jsx-text] Item
- 268 [jsx-text] Variant
- 268 [jsx-text] Stock
- 268 [jsx-text] Reason
- 274 [jsx-text] Low stock item
- 274 [jsx-text] Stock
- 274 [jsx-text] Threshold
- 280 [jsx-text] AI reorder suggestions
- 282 [jsx-text] Product
- 282 [jsx-text] Variant
- 282 [jsx-text] Stock
- 282 [jsx-text] Avg daily
- 282 [jsx-text] Days remaining
- 282 [jsx-text] Reorder qty
- 282 [jsx-text] Risk
- 296 [jsx-text] AI dead stock intelligence
- 298 [jsx-text] Product
- 298 [jsx-text] Variant
- 298 [jsx-text] Stock
- 298 [jsx-text] Last sold
- 298 [jsx-text] Days idle
- 298 [jsx-text] Blocked capital
- 298 [jsx-text] Risk
- 298 [jsx-text] Recommendation
- 314 [jsx-text] Customer insights
- 323 [jsx-text] AI customer intelligence
- ... 7 more

### src\modules\attendance\components\AttendanceCenter.jsx
- 453 [jsx-text] QR Branch
- 453 [jsx-text] Manual
- 453 [jsx-text] Imported
- 477 [title] Attendance trend
- 478 [title] Late arrivals trend
- 479 [title] Branch attendance comparison
- 480 [title] Employee attendance ranking

### src\modules\employees\components\ChatImageAttachment.jsx
- 64 [jsx-text] Image unavailable
- 73 [jsx-text] Open image

### src\modules\employees\components\roles\CreateRoleModal.jsx
- 57 [placeholder] Role Name

### src\modules\employees\components\users\CreateUserModal.jsx
- 116 [placeholder] Name
- 124 [placeholder] Email
- 132 [placeholder] Password

### src\modules\employees\components\WhatsAppRecordingBar.jsx
- 73 [aria-label] Delete recording
- 108 [aria-label] Send recording
- 73 [prop-label] Delete recording
- 108 [prop-label] Send recording

### src\modules\employees\lib\employeeAnalyticsExport.js
- 136 [jsx-text] Employee Analytics Report
- 145 [jsx-text] Employee Analytics Report
- 149 [jsx-text] Sales performance
- 151 [jsx-text] Employee
- 151 [jsx-text] Sales
- 151 [jsx-text] Orders
- 151 [jsx-text] Average Order
- 151 [jsx-text] Commission
- 171 [jsx-text] Employee Analytics Report
- 182 [jsx-text] Employee Analytics Report
- 184 [jsx-text] Best cashier
- 185 [jsx-text] Total sales
- 186 [jsx-text] Total orders
- 187 [jsx-text] Commission
- 189 [jsx-text] Top performers
- 191 [jsx-text] Employee
- 191 [jsx-text] Sales
- 191 [jsx-text] Orders
- 191 [jsx-text] Average Order

### src\modules\permissions\components\PermissionMatrix.jsx
- 82 [jsx-text] Module

### src\modules\permissions\components\PermissionsShell.jsx
- 8 [jsx-text] RBAC & Permissions

### src\modules\saas\components\SaaSShell.jsx
- 8 [jsx-text] SaaS Multi-Tenant

## pages (1039)

### src\modules\aiSupport\pages\AiAgentAnalytics.jsx
- 249 [jsx-text] AI Agent Analytics
- 250 [jsx-text] Performance Dashboard
- 257 [jsx-text] All branches
- 374 [jsx-text] Pilot Readiness
- 381 [jsx-text] Weekly readiness score
- 414 [jsx-text] Latest 5 events
- 293 [title] Lead Quality
- 303 [title] Top Objections
- 307 [title] Follow-up Performance
- 322 [title] Top Products Asked About
- 331 [title] Top Products Converted
- 341 [title] High Interest, Low Conversion
- 351 [title] Products With Stock Conflicts
- 363 [title] Shadow Analytics
- 395 [title] AI Safety Monitor
- 421 [title] Top Blockers
- 424 [title] Top Intents
- 427 [title] Safety Intent Distribution
- 430 [title] Confidence Distribution
- 433 [title] Channels Breakdown
- 275 [prop-label] AI-assisted revenue
- 276 [prop-label] AI-created drafts
- 277 [prop-label] Confirmed AI orders
- 278 [prop-label] Conversion rate
- 279 [prop-label] Average order value
- 280 [prop-label] Abandoned / recovered
- 284 [prop-label] Total conversations
- 285 [prop-label] AI replies
- 286 [prop-label] Human takeovers
- 287 [prop-label] Avg response time
- 288 [prop-label] Waiting customers
- 289 [prop-label] Closed conversations
- 295 [prop-label] Hot leads
- 296 [prop-label] Warm leads
- 297 [prop-label] Cold leads
- 298 [prop-label] VIP customers
- 299 [prop-label] Complaints
- 309 [prop-label] Scheduled
- 310 [prop-label] Due
- 311 [prop-label] Sent
- ... 16 more

### src\modules\aiSupport\pages\AiAgentSettings.jsx
- 184 [jsx-text] AI Agent Control Center
- 185 [jsx-text] Sales Agent Settings
- 209 [jsx-text] Short
- 209 [jsx-text] Balanced
- 209 [jsx-text] Detailed
- 210 [jsx-text] Low
- 210 [jsx-text] Medium
- 210 [jsx-text] High
- 250 [jsx-text] AI settings
- 256 [jsx-text] Discount promises:
- 257 [jsx-text] Order drafts:
- 258 [jsx-text] Confirmations:
- 259 [jsx-text] Suggested replies:
- 204 [title] Personality & Tone
- 216 [title] Sales Rules
- 226 [title] Follow-up Rules
- 236 [title] Handoff Rules
- 247 [title] Suggested Replies Rules
- 254 [title] Active Policy Snapshot
- 205 [prop-label] Agent name
- 207 [prop-label] Egyptian tone level
- 208 [prop-label] Emoji level
- 209 [prop-label] Reply length
- 210 [prop-label] Sales pressure
- 212 [prop-label] Forbidden phrases
- 213 [prop-label] Preferred phrases
- 217 [prop-label] Allow auto draft creation
- 218 [prop-label] Require human approval before confirm
- 219 [prop-label] Allow discount promises
- 220 [prop-label] Max discount percent
- 221 [prop-label] COD availability text
- 223 [prop-label] Delivery policy text
- 227 [prop-label] Enable follow-ups
- 229 [prop-label] Cooldown hours
- 230 [prop-label] Max follow-ups per customer
- 232 [prop-label] Stop after rejection
- 233 [prop-label] Follow-up templates
- 238 [prop-label] Angry customer
- 239 [prop-label] Low confidence
- 240 [prop-label] Discount request
- ... 7 more

### src\modules\aiSupport\pages\AiChannels.jsx
- 585 [jsx-text] WhatsApp Gateway / Evolution API
- 603 [jsx-text] Gateway connection settings
- 606 [jsx-text] Provider
- 614 [jsx-text] Connection status
- 622 [jsx-text] API URL
- 631 [jsx-text] API Key
- 640 [jsx-text] Instance Name
- 652 [jsx-text] Send manual test message
- 655 [jsx-text] Egyptian phone
- 665 [jsx-text] Message
- 720 [jsx-text] Off
- 721 [jsx-text] Suggest only
- 722 [jsx-text] Fully automatic
- 733 [jsx-text] Inherit global
- 734 [jsx-text] Casual Egyptian
- 735 [jsx-text] Professional
- 736 [jsx-text] Luxury seller
- 626 [placeholder] EVOLUTION_API_URL is not configured
- 635 [placeholder] EVOLUTION_API_KEY is missing
- 644 [placeholder] EVOLUTION_INSTANCE_NAME is not configured

### src\modules\aiSupport\pages\AiFollowups.jsx
- 200 [jsx-text] AI confidence
- 205 [jsx-text] AI confidence
- 206 [jsx-text] Not available
- 211 [jsx-text] Expected revenue
- 216 [jsx-text] Expected revenue
- 217 [jsx-text] Not available
- 221 [jsx-text] Conversation
- 263 [jsx-text] View details
- 534 [prop-label] All
- 535 [prop-label] Needs Reply
- 536 [prop-label] Needs Follow-up
- 537 [prop-label] Needs Manager
- 538 [prop-label] Resolved

### src\modules\aiSupport\pages\AiInbox.jsx
- 1626 [jsx-text] Needs Human
- 1858 [jsx-text] Needs Human
- 2006 [jsx-text] Lead Status
- 2078 [jsx-text] No transcript yet.
- 2357 [jsx-text] Editing
- 2448 [jsx-text] Sending a staff reply will take over this conversation and pause AI automation.
- 2452 [jsx-text] AI draft validation
- 2466 [jsx-text] Confidence engine
- 2477 [jsx-text] High risk: manual review recommended before sending.
- 2534 [jsx-text] Save draft
- 2535 [jsx-text] Approve AI reply
- 2559 [jsx-text] Save draft
- 2560 [jsx-text] Approve AI reply
- 2576 [jsx-text] AI correction memory
- 2739 [jsx-text] Quick send
- 2740 [jsx-text] Send images
- 2741 [jsx-text] Draft order
- 2742 [jsx-text] Open product
- 2748 [jsx-text] No matched products yet. Refresh after the customer sends a model, color, size, or category.
- 2797 [jsx-text] Recommended next step
- 2803 [jsx-text] Confidence
- 2807 [jsx-text] Reason
- 2811 [jsx-text] Suggested action
- 2823 [jsx-text] Purchase intent:
- 2854 [jsx-text] Quick send card
- 2971 [jsx-text] Order confirmation
- 3063 [jsx-text] AI Debug
- 3064 [jsx-text] Intent, route, memory, and recent decisions
- 3248 [jsx-text] Close
- 3265 [jsx-text] Trace error
- 3346 [jsx-text] Location
- 3356 [jsx-text] Order confirmation
- 3413 [jsx-text] Not set yet
- 3475 [jsx-text] Confirm Order
- 3476 [jsx-text] Edit Draft
- 3477 [jsx-text] Reject / Cancel
- 3478 [jsx-text] Assign to human
- 3479 [jsx-text] Resume AI
- 3533 [jsx-text] Conversion probability
- 3540 [jsx-text] Risk flags
- ... 152 more

### src\modules\aiSupport\pages\AiInboxPwa.jsx
- 1679 [jsx-text] Post
- 1878 [jsx-text] Send Product
- 1993 [jsx-text] Color
- 2015 [jsx-text] No color data available.
- 2021 [jsx-text] Size
- 2040 [jsx-text] No size data available.
- 2060 [jsx-text] Open a conversation first to send a product card.
- 2164 [jsx-text] Standalone PWA Shell
- 2176 [jsx-text] Install App
- 2177 [jsx-text] Add AI Inbox to the home screen.
- 2183 [jsx-text] Open Admin Inbox
- 2184 [jsx-text] Go back to the full ERP console when needed.
- 4670 [jsx-text] AI Social Media Center PWA
- 4671 [jsx-text] Social Comments
- 4685 [jsx-text] Facebook
- 4689 [jsx-text] Instagram
- 4693 [jsx-text] New comments
- 4697 [jsx-text] Needs reply
- 4706 [jsx-text] Global Auto Reply System
- 4734 [jsx-text] off
- 4735 [jsx-text] draft
- 4736 [jsx-text] manual_approval
- 4737 [jsx-text] full_auto
- 4812 [jsx-text] Post Preview
- 4816 [jsx-text] Comment
- 4828 [jsx-text] Developer Info
- 4861 [jsx-text] Linked Product
- 4879 [jsx-text] Name
- 4883 [jsx-text] Price
- 4887 [jsx-text] Sale price
- 4891 [jsx-text] Sizes
- 4895 [jsx-text] Colors
- 4899 [jsx-text] Stock
- 4909 [jsx-text] Post Auto Reply Template
- 4959 [jsx-text] off
- 4960 [jsx-text] draft
- 4961 [jsx-text] manual_approval
- 4962 [jsx-text] full_auto
- 4973 [jsx-text] Preview
- 4983 [jsx-text] Comments Timeline
- ... 29 more

### src\modules\aiSupport\pages\AiSettings.jsx
- 171 [jsx-text] AI Brain
- 172 [jsx-text] AI Settings
- 222 [jsx-text] Facebook Messenger
- 223 [jsx-text] Instagram DM
- 224 [jsx-text] WhatsApp
- 225 [jsx-text] Web chat
- 229 [jsx-text] Platform
- 233 [jsx-text] Optional Product ID
- 252 [jsx-text] Intent
- 253 [jsx-text] Effective mode
- 254 [jsx-text] Effective tone
- 255 [jsx-text] Would auto-send
- 256 [jsx-text] Safety guard reason
- 260 [jsx-text] Product context
- 270 [jsx-text] No product context found.
- 273 [jsx-text] Memory fallback
- 276 [jsx-text] Last product:
- 280 [jsx-text] No memory fallback used.
- 284 [jsx-text] Final reply preview
- 234 [placeholder] Example: 123
- 187 [title] Auto Reply Mode
- 187 [title] Global behavior. Fully automatic only sends when the channel setting also allows it.
- 189 [title] Off
- 190 [title] Suggest only
- 191 [title] Fully automatic
- 195 [title] Tone
- 195 [title] Lightweight instruction used by the AI reply layer.
- 197 [title] Casual Egyptian
- 198 [title] Professional
- 199 [title] Luxury seller
- 203 [title] AI Shoe Cover Generation
- 216 [title] AI Test Playground
- 216 [title] Simulate an AI reply without sending anything to Meta or changing memory.
- 292 [title] Safety
- 292 [title] Defaults stay on to prevent bad commerce claims.
- 300 [title] Debug Options
- 206 [prop-label] AI Shoe Cover Generation
- 267 [prop-label] Product URL
- 268 [prop-label] Image URL
- 296 [prop-label] Escalate angry customers
- ... 2 more

### src\modules\aiSupport\pages\AiSupportConsole.jsx
- 264 [jsx-text] no sources
- 567 [jsx-text] Resolved tenant id
- 571 [jsx-text] Auth source used
- 575 [jsx-text] Auth user source
- 580 [jsx-text] Current auth user snapshot
- 663 [jsx-text] Sources used
- 665 [jsx-text] none
- 669 [jsx-text] Suggested actions
- 671 [jsx-text] none
- 679 [jsx-text] No test run yet
- 680 [jsx-text] Run a quick test or type a custom question.
- 694 [jsx-text] No products returned.
- 710 [jsx-text] Context sources
- 714 [jsx-text] Fallback reason
- 719 [jsx-text] Source preview sent to AI
- 723 [jsx-text] Full endpoint response
- 768 [jsx-text] Loading AI order drafts...
- 786 [jsx-text] Area:
- 788 [jsx-text] Variant:
- 789 [jsx-text] Total:
- 790 [jsx-text] Conversation:
- 816 [jsx-text] No AI order drafts yet.
- 828 [jsx-text] Tenant-scoped customer chat patterns, product demand signals, and handoff volume.
- 847 [jsx-text] Human handoffs
- 919 [jsx-text] Loading history...
- 923 [jsx-text] No AI support test history yet.
- 596 [placeholder] Type a customer question...
- 850 [title] Top AI questions
- 851 [title] Top product terms
- 852 [title] Top requested sizes
- 853 [title] Top requested colors
- 854 [title] Most suggested products
- 855 [title] Most clicked AI products
- 856 [title] Pending aliases
- 860 [title] Fallback / no-answer questions
- 860 [prop-label] No fallback questions logged.

### src\modules\analytics\pages\AnalyticsDashboard.jsx
- 893 [jsx-text] Product
- 894 [jsx-text] Variant
- 895 [jsx-text] Stock
- 896 [jsx-text] Avg daily sales
- 897 [jsx-text] Days remaining
- 898 [jsx-text] Reorder qty
- 899 [jsx-text] Risk
- 955 [jsx-text] Product
- 956 [jsx-text] Variant
- 957 [jsx-text] Stock
- 958 [jsx-text] Last sold
- 959 [jsx-text] Days without sales
- 960 [jsx-text] Blocked capital
- 961 [jsx-text] Risk
- 962 [jsx-text] Recommendation
- 748 [title] AI insights
- 748 [title] Narrative intelligence generated from the latest ERP signals.
- 768 [title] Predicted sales
- 768 [title] Forecasted demand with confidence scoring.
- 932 [title] AI Dead Stock Intelligence
- 932 [title] Identify slow-moving inventory with blocked capital and clear action recommendations.
- 998 [title] Dead stock detection
- 998 [title] Items that are moving slowly and are tying up working capital.
- 1029 [title] Inventory risk snapshot
- 1050 [title] Cash efficiency
- 1060 [title] Order velocity
- 1061 [title] AI score
- 1062 [title] Dead stock ratio
- 1063 [title] Smart alerts
- 936 [prop-label] Items flagged
- 938 [prop-label] Blocked capital
- 942 [prop-label] Critical risks
- 946 [prop-label] Clearance targets
- 1014 [prop-label] Color
- 1015 [prop-label] Size
- 1016 [prop-label] Stock
- 1017 [prop-label] Reason

### src\modules\attendance\pages\AttendanceReports.jsx
- 128 [jsx-text] Export-ready attendance reports
- 161 [jsx-text] From
- 179 [jsx-text] Employee ID
- 204 [jsx-text] Monthly totals
- 210 [jsx-text] Loading monthly totals...
- 229 [jsx-text] Attendance table
- 230 [jsx-text] Employee, branch, worked hours, and checkout status.
- 239 [jsx-text] Employee
- 240 [jsx-text] Branch
- 241 [jsx-text] Date
- 242 [jsx-text] Check in
- 243 [jsx-text] Check out
- 244 [jsx-text] Worked
- 245 [jsx-text] Status
- 184 [placeholder] All employees
- 194 [prop-label] Present
- 195 [prop-label] Checked out
- 196 [prop-label] Missing checkout
- 197 [prop-label] Late
- 198 [prop-label] Worked hours

### src\modules\attendance\pages\PublicBranchAttendance.jsx
- 223 [jsx-text] Attendance
- 249 [jsx-text] Location
- 283 [jsx-text] Phone or employee code
- 308 [jsx-text] Employee identified
- 235 [title] Branch map preview

### src\modules\attendance\pages\StaffQrAttendance.jsx
- 162 [jsx-text] Scan branch QR, then confirm GPS
- 205 [jsx-text] Processing QR and GPS location...
- 218 [jsx-text] Result
- 224 [prop-label] Employee
- 225 [prop-label] Branch
- 226 [prop-label] Time
- 227 [prop-label] Distance
- 228 [prop-label] Allowed radius

### src\modules\employees\pages\ActivityLogs.jsx
- 237 [placeholder] Search logs...

### src\modules\employees\pages\Branches.jsx
- 158 [jsx-text] Create New Branch
- 201 [jsx-text] Branch
- 202 [jsx-text] Code
- 203 [jsx-text] Manager
- 204 [jsx-text] Phone
- 205 [jsx-text] Address
- 206 [jsx-text] Default Warehouse
- 207 [jsx-text] GPS Radius
- 208 [jsx-text] Actions
- 149 [placeholder] Search branch / code / manager / phone / address
- 76 [confirm] Branch name is required
- 103 [confirm] Delete this branch?
- 141 [prop-label] Total Branches
- 142 [prop-label] With Managers
- 143 [prop-label] Warehouse Mapped
- 165 [prop-label] Branch Name
- 166 [prop-label] Code
- 167 [prop-label] Phone
- 168 [prop-label] Manager
- 169 [prop-label] Address
- 171 [prop-label] Default Warehouse ID
- 176 [prop-label] Latitude
- 177 [prop-label] Longitude
- 179 [prop-label] Attendance Radius (meters)

### src\modules\employees\pages\EmployeePayrollPortal.jsx
- 3044 [jsx-text] Sales Opportunities
- 3049 [jsx-text] Today

### src\modules\employees\pages\EmployeePortalInventory.jsx
- 421 [jsx-text] Inventory

### src\modules\employees\pages\EmployeePortalProducts.jsx
- 473 [jsx-text] Stock
- 503 [jsx-text] No sizes
- 541 [jsx-text] Variant selection
- 580 [jsx-text] Colors
- 601 [jsx-text] No colors
- 608 [jsx-text] Sizes
- 609 [jsx-text] Only available sizes appear
- 698 [jsx-text] EMPLOYEE SCANNER
- 732 [jsx-text] Scanner Debug
- 737 [jsx-text] Last raw value
- 741 [jsx-text] Detected format
- 745 [jsx-text] Resolver called
- 749 [jsx-text] Resolver result
- 753 [jsx-text] Source
- 1539 [jsx-text] Employee Portal Products
- 1555 [jsx-text] Employee Portal

### src\modules\loyalty\pages\LoyaltyDashboard.jsx
- 98 [jsx-text] Loyalty
- 99 [jsx-text] Customer Loyalty Intelligence
- 128 [jsx-text] Top Loyalty Customers
- 129 [jsx-text] Highest value and point balance customers
- 160 [jsx-text] Tier Distribution
- 179 [jsx-text] Transaction History
- 184 [jsx-text] Type
- 185 [jsx-text] Customer
- 186 [jsx-text] Points
- 187 [jsx-text] Value
- 188 [jsx-text] Date
- 207 [jsx-text] Rules Snapshot
- 118 [prop-label] Total loyalty customers
- 119 [prop-label] Total points issued
- 120 [prop-label] Total points redeemed
- 121 [prop-label] Active rules

### src\modules\loyalty\pages\LoyaltyRules.jsx
- 110 [jsx-text] Loyalty Rules
- 111 [jsx-text] Reward policy and tier management
- 121 [jsx-text] Existing rules
- 144 [jsx-text] No rules found.
- 151 [jsx-text] Rule editor
- 179 [jsx-text] Active
- 49 [toast] Using loyalty rules fallback
- 86 [toast] Loyalty rule updated
- 90 [toast] Loyalty rule created

### src\modules\managerPortal\pages\ManagerPortal.jsx
- 2709 [jsx-text] Customer-linked orders
- 2714 [jsx-text] Online orders
- 2719 [jsx-text] AI chat conversions
- 2330 [title] Create task
- 2552 [title] No seller data
- 2705 [title] Conversion indicators
- 2705 [title] Shown only when data exists
- 2727 [title] No conversion data
- 2731 [title] Top products
- 2739 [title] Hourly trend
- 1839 [aria-label] Open notifications
- 1889 [aria-label] Close notifications
- 1839 [prop-label] Open notifications
- 1889 [prop-label] Close notifications

### src\modules\notifications\pages\NotificationsCenter.jsx
- 101 [jsx-text] Notifications Center

### src\modules\permissions\pages\Permissions.jsx
- 137 [jsx-text] Roles
- 138 [jsx-text] Choose a role to edit its permission set.
- 186 [jsx-text] Export permissions snapshot
- 110 [title] Permission Matrix
- 59 [toast] Using local permissions fallback
- 92 [toast] Permissions saved
- 99 [toast] Backend unavailable. Saved locally.
- 149 [prop-label] No roles available.

### src\modules\permissions\pages\Roles.jsx
- 147 [jsx-text] Create role
- 202 [jsx-text] Built in
- 244 [jsx-text] Assigned permissions
- 259 [jsx-text] Preset roles
- 150 [placeholder] Custom role name
- 151 [placeholder] Role description
- 166 [placeholder] Search roles...
- 121 [title] Role Management
- 51 [toast] Using local roles fallback
- 70 [toast] Role name is required
- 87 [toast] Role created
- 93 [toast] Backend roles endpoint unavailable. Saved locally.
- 103 [toast] Built-in roles cannot be deleted
- 115 [toast] Role removed
- 150 [prop-label] Role name
- 151 [prop-label] Description
- 175 [prop-label] No roles match the current search.
- 238 [prop-label] Role ID
- 239 [prop-label] Permissions
- 240 [prop-label] Type
- 247 [prop-label] No permissions assigned yet.
- 270 [prop-label] Select a role to view its summary.

### src\modules\permissions\pages\Users.jsx
- 445 [jsx-text] Create user
- 485 [jsx-text] Users
- 486 [jsx-text] Assign roles from the matrix and preserve compatibility with legacy pages.
- 508 [jsx-text] Role
- 447 [placeholder] Full name
- 449 [placeholder] Initial password
- 470 [placeholder] Search users...
- 570 [placeholder] Full name
- 593 [placeholder] New password
- 594 [placeholder] Confirm password
- 419 [title] User-Role Assignment
- 420 [title] Create users, assign roles, and keep permission inheritance aligned with the role catalog and backend fallback records.
- 568 [title] Edit user
- 591 [title] Change password
- 627 [aria-label] Close modal
- 171 [toast] Users endpoint unavailable.
- 221 [toast] Name and email are required
- 225 [toast] Please select a valid role
- 256 [toast] User updated
- 259 [toast] Backend users update unavailable.
- 280 [toast] Password fields are required
- 284 [toast] Passwords do not match
- 292 [toast] Password updated
- 295 [toast] Backend password update unavailable.
- 310 [toast] User deleted
- 313 [toast] Backend delete unavailable.
- 321 [toast] Name and email are required
- 333 [toast] Please select a valid role
- 358 [toast] User created
- 361 [toast] Backend users endpoint unavailable.
- 382 [toast] Please select a valid role
- 408 [toast] Role updated
- 411 [toast] Backend role update unavailable.
- 447 [prop-label] Name
- 448 [prop-label] Email
- 449 [prop-label] Password
- 450 [prop-label] Role
- 476 [prop-label] Total users
- 477 [prop-label] Active
- 497 [prop-label] No users match the search query.
- ... 6 more

### src\modules\reports\pages\Reports.jsx
- 352 [jsx-text] Analytics & Reports
- 354 [jsx-text] Analytics & Reports
- 576 [jsx-text] Business Intelligence & Smart Recommendations
- 789 [jsx-text] No report rows match the current filters.
- 462 [placeholder] Search report rows
- 607 [title] Smart Recommendations
- 618 [title] Restock Predictions
- 631 [title] People & Customers
- 297 [toast] Report preset saved
- 292 [confirm] Preset name
- 379 [prop-label] Refresh
- 380 [prop-label] Save preset
- 382 [prop-label] Excel
- 384 [prop-label] Print
- 512 [prop-label] Range
- 513 [prop-label] Start
- 514 [prop-label] End
- 515 [prop-label] Warehouse ID
- 516 [prop-label] Employee ID
- 517 [prop-label] Product ID
- 518 [prop-label] Category ID
- 519 [prop-label] Payment Method
- 520 [prop-label] Customer ID
- 521 [prop-label] Shift ID
- 522 [prop-label] Salesperson ID

### src\modules\saas\pages\AdminTenants.jsx
- 53 [jsx-text] Companies list
- 54 [jsx-text] Suspend or activate tenants without affecting the existing ERP modules.
- 28 [title] Super Admin Tenants
- 29 [title] Monitor companies, active subscriptions, revenue placeholders, and tenant status management from one panel.
- 44 [prop-label] Tenants
- 45 [prop-label] Active
- 46 [prop-label] Suspended
- 47 [prop-label] Revenue placeholder
- 60 [prop-label] No tenants found.

### src\modules\saas\pages\Billing.jsx
- 45 [jsx-text] Current subscription
- 47 [jsx-text] Subscription
- 64 [jsx-text] Upgrade page
- 21 [title] Billing
- 22 [title] Subscription status, expiration date, billing placeholders, and an upgrade flow that works even before the backend billing service exists.
- 37 [prop-label] Plan
- 38 [prop-label] Status
- 39 [prop-label] Expires
- 40 [prop-label] Currency

### src\modules\saas\pages\CompanySettings.jsx
- 62 [jsx-text] Profile settings
- 74 [jsx-text] Invoice footer
- 87 [jsx-text] Company logo placeholder
- 84 [placeholder] Main, North, Warehouse...
- 85 [placeholder] Receipt footer / POS note
- 45 [title] Company Settings
- 46 [title] Company profile, currency, language placeholder, invoice settings, branch settings, and POS settings.
- 84 [title] Branch settings
- 85 [title] POS settings
- 23 [toast] Select or create a workspace first
- 40 [toast] Company settings saved locally
- 64 [prop-label] Company name
- 65 [prop-label] Currency
- 66 [prop-label] Language placeholder
- 70 [prop-label] Invoice prefix
- 71 [prop-label] POS receipt note

### src\modules\saas\pages\RegisterCompany.jsx
- 147 [jsx-text] Owner and staff accounts
- 104 [placeholder] Acme Retail
- 107 [placeholder] acme-retail
- 149 [title] Owner account
- 150 [title] Staff accounts
- 151 [title] Workspace persistence

### src\modules\saas\pages\Workspace.jsx
- 54 [jsx-text] Current workspace
- 55 [jsx-text] Tenant-aware session persisted in local storage.
- 66 [jsx-text] Workspace
- 82 [jsx-text] Recent workspaces
- 107 [jsx-text] Supported plans
- 21 [title] Workspace
- 22 [title] Switch tenants, inspect the active subscription, and keep the authenticated session aligned with the current workspace.
- 43 [prop-label] Tenants
- 44 [prop-label] Active
- 45 [prop-label] Suspended
- 46 [prop-label] Trial
- 47 [prop-label] Revenue placeholder
- 73 [prop-label] Subscription
- 74 [prop-label] Plan
- 75 [prop-label] Expires
- 76 [prop-label] Currency
- 85 [prop-label] No workspace history yet.

### src\modules\sales\pages\CreateOrder.jsx
- 330 [placeholder] Customer Name
- 77 [toast] Failed to load products
- 91 [toast] Select product first
- 115 [toast] Not enough stock
- 152 [toast] Cart updated
- 184 [toast] Added to cart
- 212 [toast] Removed from cart
- 245 [toast] Cart is empty
- 287 [toast] Failed to create order

### src\modules\sales\pages\Customers.jsx
- 960 [jsx-text] Per page
- 1432 [aria-label] Close
- 1614 [aria-label] Close
- 1432 [prop-label] Close
- 1614 [prop-label] Close

### src\modules\sales\pages\InvoicesLegacy.jsx
- 52 [confirm] Fill all fields

### src\modules\sales\pages\SalesEmployees.jsx
- 793 [toast] Select an employee before saving sales settings
- 802 [toast] POS Alias should be 2 to 10 characters
- 817 [toast] Sales settings saved
- 831 [toast] Sales settings saved

### src\modules\settings\pages\SettingsCenter.jsx
- 393 [jsx-text] Settings Center error
- 395 [jsx-text] Retry
- 948 [jsx-text] Settings debug is unavailable
- 949 [jsx-text] Developer settings are only available to super admin or developer users, or when debug settings are explicitly enabled.
- 1330 [jsx-text] Site Settings
- 1331 [jsx-text] Company identity used by sidebar, login, invoices, and storefront fallbacks.
- 1349 [jsx-text] Live preview
- 1356 [jsx-text] Company name
- 1383 [jsx-text] Fallbacks
- 1386 [jsx-text] Name fallback
- 1390 [jsx-text] Logo fallback
- 1391 [jsx-text] Initials placeholder
- 1394 [jsx-text] Safety
- 1395 [jsx-text] Only PNG, JPG, and WEBP files are accepted through the existing upload endpoint. Empty values keep the current fallback.
- 1449 [jsx-text] Live homepage preview
- 1469 [jsx-text] Featured collections
- 1517 [jsx-text] InstaPay
- 1748 [jsx-text] Default shipping provider
- 1749 [jsx-text] Select the fallback carrier used when a zone has no specific provider.
- 1866 [jsx-text] Base URL
- 1870 [jsx-text] API key
- 1954 [jsx-text] Dropoff
- 1955 [jsx-text] Pickup
- 2747 [jsx-text] All governorates
- 2751 [jsx-text] All providers
- 2755 [jsx-text] Import Egypt locations
- 2756 [jsx-text] Export
- 2774 [jsx-text] Add location
- 2801 [jsx-text] No locations match the current filters.
- 3065 [jsx-text] Governorate
- 3066 [jsx-text] City
- 3138 [jsx-text] Governorate
- 3142 [jsx-text] City / Markaz
- 3146 [jsx-text] District
- 3150 [jsx-text] Zone
- 3211 [jsx-text] Shipping Zones - Fullscreen
- 3232 [jsx-text] Add Rule
- 3372 [jsx-text] Provider mapping IDs
- 3613 [jsx-text] Homepage
- 3669 [jsx-text] Registry audit
- ... 51 more

### src\modules\shipping\pages\ShippingCenter.jsx
- 94 [jsx-text] Shipment Drawer
- 122 [jsx-text] Address
- 125 [jsx-text] Print Label
- 129 [jsx-text] Shipping Timeline
- 136 [jsx-text] No timeline events yet.
- 140 [jsx-text] Webhook Events
- 147 [jsx-text] No webhook events received.
- 256 [jsx-text] Operations
- 257 [jsx-text] Shipping Center
- 261 [jsx-text] Table View
- 262 [jsx-text] Board View
- 263 [jsx-text] Refresh
- 272 [jsx-text] Delivery Success Rate
- 273 [jsx-text] Return Rate
- 274 [jsx-text] Average Delivery Time
- 275 [jsx-text] Orders Per Provider
- 276 [jsx-text] Orders Per City
- 286 [jsx-text] All providers
- 287 [jsx-text] All branches
- 288 [jsx-text] All shipping statuses
- 289 [jsx-text] All payment statuses
- 290 [jsx-text] COD / Prepaid
- 290 [jsx-text] Prepaid
- 295 [jsx-text] Create Shipments
- 296 [jsx-text] Refresh Status
- 297 [jsx-text] Print Labels
- 298 [jsx-text] Mark Ready
- 299 [jsx-text] Export CSV
- 334 [jsx-text] No shipments match the current filters.
- 284 [placeholder] Search order, customer, phone, tracking...
- 211 [toast] Select shipments first

### src\modules\smartWarehouse\pages\SmartWarehouse.jsx
- 319 [jsx-text] Active section
- 333 [jsx-text] Model-level count
- 353 [jsx-text] Color
- 354 [jsx-text] Size
- 355 [jsx-text] Expected
- 356 [jsx-text] Actual
- 357 [jsx-text] Diff
- 447 [jsx-text] Master QR value
- 449 [jsx-text] Model-level, not variant-level. Scanning this opens the full variant stock matrix.
- 494 [jsx-text] Warehouse Heatmap
- 395 [placeholder] Men Shoes Size 41
- 397 [placeholder] Aisle, shelf, or season notes
- 433 [placeholder] Product database id
- 206 [title] Smart Warehouse
- 207 [title] Model QR counting, section organization, cycle count tasks, movement-ready adjustments, and AI-ready inventory analytics.
- 328 [title] Scan a master model QR
- 440 [title] No QR generated yet
- 461 [title] Smart Daily Cycle Tasks
- 472 [title] Recent Counts
- 489 [title] Discrepancies
- 490 [title] Dead Stock
- 491 [title] Smart Alerts
- 492 [title] Transfer Recommendations
- 527 [title] No records
- 113 [toast] Section loaded
- 129 [toast] Model loaded
- 144 [toast] Select warehouse and scan a model first
- 163 [toast] Count saved and movements created
- 176 [toast] Warehouse and section code are required
- 187 [toast] Section saved
- 198 [toast] Master QR ready
- 298 [prop-label] Branch
- 299 [prop-label] Warehouse
- 300 [prop-label] Section
- 303 [prop-label] Scan section QR
- 310 [prop-label] Scan model QR
- 369 [prop-label] Decrease
- 371 [prop-label] Increase
- 390 [prop-label] Branch
- 392 [prop-label] Warehouse
- ... 5 more

### src\modules\website\pages\WebsiteSettings.jsx
- 630 [jsx-text] Enable fake compare price
- 631 [jsx-text] Show generated old prices on storefront cards and product pages.
- 637 [jsx-text] Rounding mode
- 639 [jsx-text] none
- 640 [jsx-text] nearest_10
- 641 [jsx-text] nearest_50
- 642 [jsx-text] nearest_100
- 649 [jsx-text] Existing Sale Prices
- 635 [prop-label] Fake compare percent

### src\pages\ActivityLogs.jsx
- 237 [placeholder] Search logs...

### src\pages\AppShellPreview.jsx
- 31 [jsx-text] M1 Store
- 31 [jsx-text] Workspace
- 32 [jsx-text] ⌘ K

### src\pages\Branches.jsx
- 514 [jsx-text] Branch attendance
- 519 [jsx-text] 1. Scan QR
- 520 [jsx-text] 2. Enter code/phone
- 521 [jsx-text] 3. Check in/out
- 792 [title] Branch map preview
- 450 [toast] Short link copied
- 453 [toast] Failed to copy short link

### src\pages\ComponentsPreview.jsx
- 13 [jsx-text] , processing:
- 13 [jsx-text] , pending:
- 25 [jsx-text] M1 UI

### src\pages\CreateOrder.jsx
- 329 [placeholder] Customer Name
- 76 [toast] Failed to load products
- 90 [toast] Select product first
- 114 [toast] Not enough stock
- 151 [toast] Cart updated
- 183 [toast] Added to cart
- 211 [toast] Removed from cart
- 244 [toast] Cart is empty
- 286 [toast] Failed to create order

### src\pages\Dashboard.jsx
- 962 [title] No activity in this range
- 832 [aria-label] Trend sparkline
- 832 [prop-label] Trend sparkline

### src\pages\DashboardPrototype.jsx
- 48 [jsx-text] M1 Store
- 49 [jsx-text] ⌘ K

### src\pages\Login.jsx
- 167 [placeholder] Email
- 183 [placeholder] Workspace / company slug

### src\pages\PublicProduct.jsx
- 247 [jsx-text] No image available
- 255 [jsx-text] Variants
- 258 [jsx-text] No variants available.

### src\pages\Sales.jsx
- 353 [placeholder] Search invoices...
- 413 [placeholder] Product
- 437 [placeholder] Customer
- 461 [placeholder] Quantity
- 485 [placeholder] Price
- 52 [confirm] Fill all fields
- 99 [confirm] Delete Invoice?

### src\pages\ThemeFoundation.jsx
- 28 [jsx-text] M1 ERP Design Foundation
- 28 [jsx-text] Phase 1 · Tokens & themes
- 38 [jsx-text] M1 ERP · Design system
- 42 [jsx-text] Color tokens
- 42 [jsx-text] Semantic colors—not page-specific hex values.
- 44 [jsx-text] Typography & density
- 44 [jsx-text] Page title · 28/700
- 44 [jsx-text] Run operations with clarity
- 46 [jsx-text] Controls & states
- 46 [jsx-text] Actions
- 46 [jsx-text] Fields
- 46 [jsx-text] Status
- 48 [jsx-text] Dense data table
- 48 [jsx-text] Compact, legible, RTL/LTR-safe rows.

### src\pages\UploadTest.jsx
- 51 [confirm] Select Image First
- 76 [confirm] Image Uploaded Successfully ✅
- 84 [confirm] Upload Failed ❌

## pos (119)

### src\modules\pos\components\CartSidebar.jsx
- 1501 [jsx-text] GREEN_THERMAL_RECEIPT_V2
- 1875 [jsx-text] M1 Store
- 1877 [jsx-text] M1-Store
- 3211 [jsx-text] Treasury adjustment
- 3231 [placeholder] Recharge amount
- 3237 [placeholder] Audit note
- 3179 [title] Recharge / adjustment
- 3066 [aria-label] Clear payment amount
- 3178 [aria-label] Recharge treasury account
- 3218 [aria-label] Close
- 3138 [toast] Enter a positive recharge amount
- 3149 [toast] Treasury adjustment recorded
- 2764 [prop-label] Vodafone Cash
- 2771 [prop-label] InstaPay
- 3066 [prop-label] Clear payment amount
- 3178 [prop-label] Recharge treasury account
- 3218 [prop-label] Close

### src\modules\pos\pages\POSPro.jsx
- 5653 [jsx-text] Sales Receipt
- 6309 [jsx-text] Shift report
- 6325 [jsx-text] Print
- 6331 [jsx-text] Payment breakdown
- 6331 [jsx-text] Method
- 6331 [jsx-text] Count
- 6331 [jsx-text] Total
- 6331 [jsx-text] No payments
- 6332 [jsx-text] Seller performance
- 6332 [jsx-text] Seller
- 6332 [jsx-text] Invoices
- 6332 [jsx-text] Sales
- 6332 [jsx-text] No seller data
- 6333 [jsx-text] Top products
- 6333 [jsx-text] Product
- 6333 [jsx-text] Qty
- 6333 [jsx-text] Share
- 6333 [jsx-text] Total
- 6333 [jsx-text] No products
- 6334 [jsx-text] Audit timeline
- 6334 [jsx-text] Time
- 6334 [jsx-text] Action
- 6334 [jsx-text] Reference
- 6334 [jsx-text] Amount
- 6334 [jsx-text] No events
- 6335 [jsx-text] Cashier signature
- 6335 [jsx-text] Manager signature
- 6431 [jsx-text] Restoring shift session
- 6432 [jsx-text] Checking the cached active shift before showing the open shift screen.
- 6541 [jsx-text] Sale Prices
- 6605 [jsx-text] Quick customer creation
- 6618 [jsx-text] Customer name
- 6628 [jsx-text] Phone number
- 6645 [jsx-text] Customer came from
- 6651 [jsx-text] Select source
- 6652 [jsx-text] Other
- 6653 [jsx-text] Facebook
- 6654 [jsx-text] Instagram
- 6655 [jsx-text] Story
- 6656 [jsx-text] TikTok
- ... 62 more

## products (14)

### src\modules\products\components\MultiVersionGenerator.jsx
- 182 [jsx-text] Arabic
- 188 [jsx-text] English

### src\modules\products\lib\barcodeLabels.js
- 1051 [jsx-text] measure(fontSize, line)
- 1718 [jsx-text] ARTICLE CODE

### src\modules\products\pages\CreateProduct.jsx
- 2614 [jsx-text] Original / AI Thermal
- 2621 [jsx-text] Original
- 2630 [jsx-text] AI Thermal

### src\modules\products\pages\ProductEdit.jsx
- 3664 [jsx-text] Original / AI Thermal
- 3671 [jsx-text] Original
- 3680 [jsx-text] AI Thermal
- 1039 [toast] Select a color target before regenerating the AI cover.
- 1094 [toast] AI cover regeneration queued.
- 2367 [toast] Save the product first to generate AI Thermal Artwork per color
- 2382 [toast] AI Thermal Artwork requires a color image

## shared (8)

### src\shared\components\mobile\ResponsiveMobile.jsx
- 26 [aria-label] Close
- 26 [prop-label] Close

### src\shared\components\Sidebar.jsx
- 28 [jsx-text] ERP PRO

### src\shared\components\Table.jsx
- 9 [jsx-text] Name
- 16 [jsx-text] Product

### src\shared\utils\colorNameFromImage.js
- 64 [jsx-text] rgbToHsl(rgb).s
- 114 [jsx-text] alpha
- 713 [jsx-text] brightnessOf(sample)

## storefront (47)

### src\storefront\components\StorefrontProductGallery.jsx
- 42 [aria-label] Previous image
- 67 [aria-label] Next image
- 42 [prop-label] Previous image
- 67 [prop-label] Next image

### src\storefront\pages\LegalPages.jsx
- 264 [jsx-text] M1 ERP System / M1 Store
- 273 [jsx-text] Privacy Policy
- 274 [jsx-text] Terms of Service
- 275 [jsx-text] Data Deletion

### src\storefront\pages\OrderConfirmationActionPage.jsx
- 470 [jsx-text] COD confirmation

### src\storefront\pages\StorefrontAsyncPages.jsx
- 384 [jsx-text] Cart Totals

### src\storefront\pages\StorefrontProductDetailPage.jsx
- 221 [jsx-text] Reviews
- 688 [jsx-text] selectedSellingPrice ?
- 843 [jsx-text] Why You'll Love It

### src\storefront\Storefront.jsx
- 4308 [jsx-text] M1 Store
- 6605 [jsx-text] (current
- 6811 [jsx-text] Search results
- 6812 [jsx-text] Searching...
- 9566 [jsx-text] M1 Store
- 9788 [jsx-text] M1 Store
- 10142 [jsx-text] index
- 10720 [jsx-text] Cart
- 6833 [title] Trending searches
- 6834 [title] Popular searches
- 6836 [title] Categories
- 6837 [title] Brands
- 6838 [title] Styles
- 10726 [title] Your cart is empty
- 2836 [aria-label] Next slide
- 6635 [aria-label] Search storefront
- 6640 [aria-label] Voice search
- 6643 [aria-label] Image search
- 6704 [aria-label] Close search
- 10772 [aria-label] Remove item
- 10805 [aria-label] WhatsApp
- 10806 [aria-label] Instagram
- 10807 [aria-label] Facebook
- 12057 [aria-label] WhatsApp
- 2836 [prop-label] Next slide
- 6635 [prop-label] Search storefront
- 6640 [prop-label] Voice search
- 6643 [prop-label] Image search
- 6704 [prop-label] Close search
- 10772 [prop-label] Remove item
- 10805 [prop-label] WhatsApp
- 10806 [prop-label] Instagram
- 10807 [prop-label] Facebook
- 12057 [prop-label] WhatsApp

