# Localization Debt Report

Generated: 2026-06-12T20:02:28.833Z

This report flags obvious hardcoded UI strings. It is intentionally conservative and may include false positives.

## marketing (118)

### src\modules\marketing\components\PostEditorModal.jsx
- 668 [jsx-text] ERP Store
- 1078 [jsx-text] Product URL
- 1087 [prop-label] Price
- 1088 [prop-label] Color
- 1089 [prop-label] Size

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
- 904 [jsx-text] Meta OAuth readiness
- 905 [jsx-text] Use these values in Meta Developer settings. Secret values are never displayed here.
- 911 [jsx-text] Environment
- 923 [jsx-text] OAuth Redirect URI
- 945 [jsx-text] Required permissions
- 954 [jsx-text] Setup steps
- 971 [jsx-text] Post-OAuth result
- 978 [jsx-text] Connected page
- 986 [jsx-text] Missing permissions
- 1005 [jsx-text] Connect Meta
- 1069 [jsx-text] Verify webhook and capabilities
- 1070 [jsx-text] Runs live permission checks, token diagnostics, and webhook delivery health.
- 1090 [jsx-text] Setup checklist
- 1122 [jsx-text] Connection
- 1151 [jsx-text] Page ID is managed by the guided connection flow.
- 1156 [jsx-text] Manual Account ID entry is hidden unless advanced mode is enabled.
- 1348 [jsx-text] Live delivery health
- 639 [toast] Meta connection timed out. You can try again.
- 744 [toast] Meta setup complete

## orders (9)

### src\modules\orders\pages\OrderDetails.jsx
- 1342 [jsx-text] Bosta

### src\modules\orders\pages\OrderReturnsPage.jsx
- 337 [jsx-text] Returns Workspace
- 404 [jsx-text] Orders module

### src\modules\orders\pages\OrdersDashboard.jsx
- 1246 [jsx-text] : proofUrl ?
- 1397 [jsx-text] : proofUrl ?
- 1414 [jsx-text] WhatsApp
- 1499 [jsx-text] WhatsApp
- 1367 [prop-label] \u0637\u0631\u064a\u0642\u0629 \u0627\u0644\u0627\u0633\u062a\u0631\u062f\u0627\u062f
- 1463 [prop-label] \u0637\u0631\u064a\u0642\u0629 \u0627\u0644\u0627\u0633\u062a\u0631\u062f\u0627\u062f

## other (109)

### src\App.jsx
- 260 [title] Employee app screen crashed
- 273 [title] Application screen crashed

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

## pages (832)

### src\modules\aiSupport\pages\AiAgentAnalytics.jsx
- 175 [jsx-text] AI Agent Analytics
- 176 [jsx-text] Performance Dashboard
- 183 [jsx-text] All branches
- 219 [title] Lead Quality
- 229 [title] Top Objections
- 233 [title] Follow-up Performance
- 248 [title] Top Products Asked About
- 257 [title] Top Products Converted
- 267 [title] High Interest, Low Conversion
- 277 [title] Products With Stock Conflicts
- 201 [prop-label] AI-assisted revenue
- 202 [prop-label] AI-created drafts
- 203 [prop-label] Confirmed AI orders
- 204 [prop-label] Conversion rate
- 205 [prop-label] Average order value
- 206 [prop-label] Abandoned / recovered
- 210 [prop-label] Total conversations
- 211 [prop-label] AI replies
- 212 [prop-label] Human takeovers
- 213 [prop-label] Avg response time
- 214 [prop-label] Waiting customers
- 215 [prop-label] Closed conversations
- 221 [prop-label] Hot leads
- 222 [prop-label] Warm leads
- 223 [prop-label] Cold leads
- 224 [prop-label] VIP customers
- 225 [prop-label] Complaints
- 235 [prop-label] Scheduled
- 236 [prop-label] Due
- 237 [prop-label] Sent
- 238 [prop-label] Manually sent
- 239 [prop-label] Snoozed
- 240 [prop-label] Cancelled
- 241 [prop-label] Recovered after follow-up
- 242 [prop-label] Stopped after rejection

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
- 231 [placeholder] Edit the internal follow-up note before sending...
- 178 [prop-label] Due follow-ups
- 179 [prop-label] Scheduled
- 180 [prop-label] Completed
- 181 [prop-label] Stopped / rejected

### src\modules\aiSupport\pages\AiInbox.jsx
- 752 [jsx-text] No transcript yet.
- 824 [jsx-text] Staff
- 943 [jsx-text] Live send ready
- 943 [jsx-text] Live channel unavailable
- 945 [jsx-text] Sending a staff reply will take over this conversation and pause AI automation.
- 981 [jsx-text] Save draft
- 982 [jsx-text] Approve AI reply
- 1004 [jsx-text] 2-3 short Egyptian Arabic options that you can copy, edit, or send live.
- 1013 [jsx-text] Channel setup needed
- 1016 [jsx-text] Closed conversations cannot generate suggestions.
- 1019 [jsx-text] Generate a staff-only suggested reply. It stays separate from sent replies until you approve or edit it.
- 1026 [jsx-text] Short reply
- 1033 [jsx-text] Edit before send
- 1034 [jsx-text] Send now
- 1035 [jsx-text] Regenerate
- 1107 [jsx-text] Quick send
- 1108 [jsx-text] Send images
- 1109 [jsx-text] Draft order
- 1110 [jsx-text] Open product
- 1116 [jsx-text] No matched products yet. Refresh after the customer sends a model, color, size, or category.
- 1164 [jsx-text] Recommended next step
- 1170 [jsx-text] Confidence
- 1174 [jsx-text] Reason
- 1178 [jsx-text] Suggested action
- 1190 [jsx-text] Purchase intent:
- 1221 [jsx-text] Quick send card
- 1394 [jsx-text] AI Debug
- 1395 [jsx-text] Intent, route, memory, and recent decisions
- 1579 [jsx-text] Close
- 1596 [jsx-text] Trace error
- 1686 [jsx-text] Channel
- 1690 [jsx-text] Phone
- 1743 [jsx-text] Not set yet
- 1805 [jsx-text] Confirm Order
- 1806 [jsx-text] Edit Draft
- 1807 [jsx-text] Reject / Cancel
- 1808 [jsx-text] Assign to human
- 1809 [jsx-text] Resume AI
- 1858 [jsx-text] Conversion probability
- 1865 [jsx-text] Risk flags
- ... 97 more

### src\modules\aiSupport\pages\AiSettings.jsx
- 170 [jsx-text] AI Brain
- 171 [jsx-text] AI Settings
- 208 [jsx-text] Facebook Messenger
- 209 [jsx-text] Instagram DM
- 210 [jsx-text] WhatsApp
- 211 [jsx-text] Web chat
- 215 [jsx-text] Platform
- 219 [jsx-text] Optional Product ID
- 238 [jsx-text] Intent
- 239 [jsx-text] Effective mode
- 240 [jsx-text] Effective tone
- 241 [jsx-text] Would auto-send
- 242 [jsx-text] Safety guard reason
- 246 [jsx-text] Product context
- 256 [jsx-text] No product context found.
- 259 [jsx-text] Memory fallback
- 262 [jsx-text] Last product:
- 266 [jsx-text] No memory fallback used.
- 270 [jsx-text] Final reply preview
- 220 [placeholder] Example: 123
- 186 [title] Auto Reply Mode
- 186 [title] Global behavior. Fully automatic only sends when the channel setting also allows it.
- 188 [title] Off
- 189 [title] Suggest only
- 190 [title] Fully automatic
- 194 [title] Tone
- 194 [title] Lightweight instruction used by the AI reply layer.
- 196 [title] Casual Egyptian
- 197 [title] Professional
- 198 [title] Luxury seller
- 202 [title] AI Test Playground
- 202 [title] Simulate an AI reply without sending anything to Meta or changing memory.
- 278 [title] Safety
- 278 [title] Defaults stay on to prevent bad commerce claims.
- 286 [title] Debug Options
- 253 [prop-label] Product URL
- 254 [prop-label] Image URL
- 282 [prop-label] Escalate angry customers
- 288 [prop-label] Show live AI logs
- 289 [prop-label] Show conversation memory debug

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
- 2740 [jsx-text] Sales Opportunities
- 2745 [jsx-text] Today

### src\modules\employees\pages\EmployeePortalInventory.jsx
- 337 [jsx-text] Inventory

### src\modules\employees\pages\EmployeePortalProducts.jsx
- 471 [jsx-text] Stock
- 501 [jsx-text] No sizes
- 539 [jsx-text] Variant selection
- 577 [jsx-text] Colors
- 598 [jsx-text] No colors
- 605 [jsx-text] Sizes
- 606 [jsx-text] Only available sizes appear
- 683 [jsx-text] EMPLOYEE SCANNER
- 715 [jsx-text] Scanner Debug
- 720 [jsx-text] Last raw value
- 724 [jsx-text] Detected format
- 728 [jsx-text] Resolver called
- 732 [jsx-text] Resolver result
- 736 [jsx-text] Source
- 742 [jsx-text] Manual fallback
- 1520 [jsx-text] Employee Portal Products
- 1536 [jsx-text] Employee Portal
- 753 [placeholder] Enter barcode manually

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
- 2693 [jsx-text] Customer-linked orders
- 2698 [jsx-text] Online orders
- 2703 [jsx-text] AI chat conversions
- 2314 [title] Create task
- 2536 [title] No seller data
- 2689 [title] Conversion indicators
- 2689 [title] Shown only when data exists
- 2711 [title] No conversion data
- 2715 [title] Top products
- 2723 [title] Hourly trend
- 1823 [aria-label] Open notifications
- 1873 [aria-label] Close notifications
- 1823 [prop-label] Open notifications
- 1873 [prop-label] Close notifications

### src\modules\notifications\pages\NotificationsCenter.jsx
- 62 [jsx-text] Notifications Center

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
- 169 [jsx-text] Create user
- 204 [jsx-text] Users
- 205 [jsx-text] Assign roles from the matrix and preserve compatibility with legacy pages.
- 227 [jsx-text] Role
- 171 [placeholder] Full name
- 173 [placeholder] Initial password
- 189 [placeholder] Search users...
- 143 [title] User-Role Assignment
- 144 [title] Create users, assign roles, and keep permission inheritance aligned with the role catalog and backend fallback records.
- 59 [toast] Using local users fallback
- 78 [toast] Name and email are required
- 98 [toast] User created
- 103 [toast] Backend users endpoint unavailable. Saved locally.
- 130 [toast] Role updated
- 135 [toast] Backend role update unavailable. Saved locally.
- 171 [prop-label] Name
- 172 [prop-label] Email
- 173 [prop-label] Password
- 174 [prop-label] Role
- 195 [prop-label] Total users
- 196 [prop-label] Active
- 216 [prop-label] No users match the search query.

### src\modules\reports\pages\Reports.jsx
- 345 [jsx-text] Analytics & Reports
- 347 [jsx-text] Analytics & Reports
- 366 [jsx-text] Enterprise Reports Center
- 569 [jsx-text] Business Intelligence & Smart Recommendations
- 782 [jsx-text] No report rows match the current filters.
- 455 [placeholder] Search report rows
- 413 [title] Daily Sales
- 416 [title] Monthly Revenue / Profit
- 419 [title] Orders by Hour
- 422 [title] Payment Methods
- 425 [title] Sales by Branch
- 428 [title] Attendance Trend
- 600 [title] Smart Recommendations
- 611 [title] Restock Predictions
- 624 [title] People & Customers
- 290 [toast] Report preset saved
- 285 [confirm] Preset name
- 372 [prop-label] Refresh
- 373 [prop-label] Save preset
- 375 [prop-label] Excel
- 377 [prop-label] Print
- 505 [prop-label] Range
- 506 [prop-label] Start
- 507 [prop-label] End
- 508 [prop-label] Warehouse ID
- 509 [prop-label] Employee ID
- 510 [prop-label] Product ID
- 511 [prop-label] Category ID
- 512 [prop-label] Payment Method
- 513 [prop-label] Customer ID
- 514 [prop-label] Shift ID
- 515 [prop-label] Salesperson ID

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
- 959 [jsx-text] Per page
- 1431 [aria-label] Close
- 1613 [aria-label] Close
- 1431 [prop-label] Close
- 1613 [prop-label] Close

### src\modules\sales\pages\InvoicesLegacy.jsx
- 52 [confirm] Fill all fields

### src\modules\sales\pages\SalesEmployees.jsx
- 789 [toast] Select an employee before saving sales settings
- 798 [toast] POS Alias should be 2 to 10 characters
- 813 [toast] Sales settings saved
- 827 [toast] Sales settings saved

### src\modules\settings\pages\SettingsCenter.jsx
- 359 [jsx-text] Settings Center error
- 361 [jsx-text] Retry
- 737 [jsx-text] Settings debug is unavailable
- 738 [jsx-text] Developer settings are only available to super admin or developer users, or when debug settings are explicitly enabled.
- 937 [jsx-text] Live homepage preview
- 957 [jsx-text] Featured collections
- 1005 [jsx-text] InstaPay
- 1236 [jsx-text] Default shipping provider
- 1237 [jsx-text] Select the fallback carrier used when a zone has no specific provider.
- 1354 [jsx-text] Base URL
- 1358 [jsx-text] API key
- 1442 [jsx-text] Dropoff
- 1443 [jsx-text] Pickup
- 2235 [jsx-text] All governorates
- 2239 [jsx-text] All providers
- 2243 [jsx-text] Import Egypt locations
- 2244 [jsx-text] Export
- 2262 [jsx-text] Add location
- 2289 [jsx-text] No locations match the current filters.
- 2553 [jsx-text] Governorate
- 2554 [jsx-text] City
- 2626 [jsx-text] Governorate
- 2630 [jsx-text] City / Markaz
- 2634 [jsx-text] District
- 2638 [jsx-text] Zone
- 2699 [jsx-text] Shipping Zones - Fullscreen
- 2720 [jsx-text] Add Rule
- 2860 [jsx-text] Provider mapping IDs
- 3101 [jsx-text] Homepage
- 3157 [jsx-text] Registry audit
- 3170 [jsx-text] Runtime metadata
- 3174 [jsx-text] Debug source: /settings/debug
- 1359 [placeholder] Bosta API key
- 1424 [placeholder] Search Bosta locations
- 2232 [placeholder] Search governorate, city, area
- 2279 [placeholder] provider city id
- 2280 [placeholder] provider district id
- 2281 [placeholder] provider zone id
- 2641 [placeholder] Price
- 2854 [placeholder] Free over
- ... 36 more

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
- 608 [jsx-text] Enable fake compare price
- 609 [jsx-text] Show generated old prices on storefront cards and product pages.
- 615 [jsx-text] Rounding mode
- 617 [jsx-text] none
- 618 [jsx-text] nearest_10
- 619 [jsx-text] nearest_50
- 620 [jsx-text] nearest_100
- 627 [jsx-text] Existing Sale Prices
- 613 [prop-label] Fake compare percent

### src\pages\ActivityLogs.jsx
- 237 [placeholder] Search logs...

### src\pages\Branches.jsx
- 514 [jsx-text] Branch attendance
- 519 [jsx-text] 1. Scan QR
- 520 [jsx-text] 2. Enter code/phone
- 521 [jsx-text] 3. Check in/out
- 792 [title] Branch map preview
- 450 [toast] Short link copied
- 453 [toast] Failed to copy short link

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
- 952 [title] No activity in this range
- 822 [aria-label] Trend sparkline
- 822 [prop-label] Trend sparkline

### src\pages\Login.jsx
- 147 [placeholder] Email
- 167 [placeholder] Workspace / company slug

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

### src\pages\UploadTest.jsx
- 51 [confirm] Select Image First
- 76 [confirm] Image Uploaded Successfully ✅
- 84 [confirm] Upload Failed ❌

## pos (114)

### src\modules\pos\components\CartSidebar.jsx
- 2777 [jsx-text] Treasury adjustment
- 2797 [placeholder] Recharge amount
- 2803 [placeholder] Audit note
- 2745 [title] Recharge / adjustment
- 2632 [aria-label] Clear payment amount
- 2744 [aria-label] Recharge treasury account
- 2784 [aria-label] Close
- 2704 [toast] Enter a positive recharge amount
- 2715 [toast] Treasury adjustment recorded
- 2330 [prop-label] Vodafone Cash
- 2337 [prop-label] InstaPay
- 2632 [prop-label] Clear payment amount
- 2744 [prop-label] Recharge treasury account
- 2784 [prop-label] Close

### src\modules\pos\pages\POSPro.jsx
- 4886 [jsx-text] Sales Receipt
- 5540 [jsx-text] Shift report
- 5556 [jsx-text] Print
- 5562 [jsx-text] Payment breakdown
- 5562 [jsx-text] Method
- 5562 [jsx-text] Count
- 5562 [jsx-text] Total
- 5562 [jsx-text] No payments
- 5563 [jsx-text] Seller performance
- 5563 [jsx-text] Seller
- 5563 [jsx-text] Invoices
- 5563 [jsx-text] Sales
- 5563 [jsx-text] No seller data
- 5564 [jsx-text] Top products
- 5564 [jsx-text] Product
- 5564 [jsx-text] Qty
- 5564 [jsx-text] Share
- 5564 [jsx-text] Total
- 5564 [jsx-text] No products
- 5565 [jsx-text] Audit timeline
- 5565 [jsx-text] Time
- 5565 [jsx-text] Action
- 5565 [jsx-text] Reference
- 5565 [jsx-text] Amount
- 5565 [jsx-text] No events
- 5566 [jsx-text] Cashier signature
- 5566 [jsx-text] Manager signature
- 5734 [jsx-text] Sale Prices
- 5798 [jsx-text] Quick customer creation
- 5811 [jsx-text] Customer name
- 5821 [jsx-text] Phone number
- 5838 [jsx-text] Customer came from
- 5844 [jsx-text] Select source
- 5845 [jsx-text] Other
- 5846 [jsx-text] Facebook
- 5847 [jsx-text] Instagram
- 5848 [jsx-text] Story
- 5849 [jsx-text] TikTok
- 5850 [jsx-text] WhatsApp
- 6828 [jsx-text] : isFailed ?
- ... 60 more

## shared (11)

### src\shared\components\invoices\OrderInvoiceCard.jsx
- 178 [prop-label] New items total
- 180 [prop-label] Amount paid now
- 181 [prop-label] Remaining customer credit / wallet balance

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

## storefront (19)

### src\storefront\pages\StorefrontProductDetailPage.jsx
- 430 [jsx-text] selectedSellingPrice ?

### src\storefront\Storefront.jsx
- 3701 [jsx-text] (current
- 5340 [jsx-text] LAST PIECE FINDER
- 8207 [jsx-text] US Men
- 8208 [jsx-text] US Women
- 8374 [jsx-text] index
- 3139 [placeholder] 01xxxxxxxxx
- 4196 [aria-label] Previous slide
- 4199 [aria-label] Next slide
- 8959 [aria-label] Instagram
- 8960 [aria-label] Facebook
- 4196 [prop-label] Previous slide
- 4199 [prop-label] Next slide
- 5114 [prop-label] This week
- 5116 [prop-label] Nike edit
- 5119 [prop-label] Jordan edit
- 5122 [prop-label] Adidas edit
- 8959 [prop-label] Instagram
- 8960 [prop-label] Facebook

