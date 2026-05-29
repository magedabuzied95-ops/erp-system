# Localization Debt Report

Generated: 2026-05-19T23:33:07.811Z

This report flags obvious hardcoded UI strings. It is intentionally conservative and may include false positives.

## Final Blocker Status - 2026-05-20

- Locale JSON parse / UTF-8 BOM check: passed for `src/locales/ar` and `src/locales/en`.
- Locale parity: passed with `missingAr=0`, `missingEn=0`, `typeMismatch=0`.
- Runtime translation-call key scan: passed with 0 missing keys without an explicit fallback.
- Arabic corruption audit: passed via `scripts/audit-arabic-locales.mjs`.
- Literal mojibake scan: passed with 0 real hits outside intentional corrupted-input matching aliases in `server/services/aiSupportContextService.js`.
- `print:invoice.*` namespace blocker: fixed by resolving print labels through `print.invoice.*`.
- Print/RTL static verification: passed for document `html[dir="rtl"]` / `html[dir="ltr"]`, numeric LTR isolation, Recharts isolation, POS/invoice print direction, `--print-dir`, and printable HTML `dir`.
- Build: `npm.cmd run build` passed.
- Lint: `npm.cmd run lint` passed with warnings only; no errors.

Resolved blockers:

- Added missing `branches` Arabic keys and full `branches.qr.*` key set in Arabic and English.
- Confirmed `purchases.suppliersDashboard.*` key set exists in Arabic and English.
- Replaced corrupted Arabic customer-facing AI support fallback text.
- Replaced corrupted Arabic marketing AI prompt seed text.
- Removed literal mojibake from sanitizer source by using Unicode escapes while preserving sanitization behavior.

## inventory (97)

### src\modules\inventory\components\InventoryShell.jsx
- 14 [jsx-text] Inventory flow

### src\modules\inventory\pages\InventoryDashboard.jsx
- 310 [jsx-text] Total stock
- 320 [jsx-text] Active sizes
- 324 [jsx-text] Min active sizes

### src\modules\inventory\pages\InventoryHistory.jsx
- 87 [jsx-text] Number(movement.quantity_change || 0)
- 146 [jsx-text] Movement type
- 152 [jsx-text] All
- 175 [jsx-text] Movement ledger
- 176 [jsx-text] Click any row to inspect quantity before and after the movement.
- 201 [jsx-text] Timestamp
- 202 [jsx-text] Product
- 203 [jsx-text] Variant
- 204 [jsx-text] Type
- 205 [jsx-text] Before
- 206 [jsx-text] Change
- 207 [jsx-text] After
- 208 [jsx-text] User
- 209 [jsx-text] Reference
- 319 [jsx-text] Stock timeline
- 135 [placeholder] Search product, variant, notes, user...
- 140 [placeholder] Product ID
- 141 [placeholder] Variant ID
- 93 [title] Inventory History
- 94 [title] Search the movement ledger by product, variant, movement type, and date. Open any row for a detailed stock timeline.
- 315 [aria-label] Close movement details
- 122 [prop-label] Movements
- 123 [prop-label] Inbound
- 124 [prop-label] Outbound
- 125 [prop-label] Total rows
- 140 [prop-label] Product
- 141 [prop-label] Variant
- 142 [prop-label] From
- 315 [prop-label] Close movement details
- 328 [prop-label] Movement type
- 329 [prop-label] Quantity before
- 330 [prop-label] Quantity change
- 331 [prop-label] Quantity after
- 332 [prop-label] Reference
- 333 [prop-label] User
- 334 [prop-label] Timestamp
- 335 [prop-label] Warehouse
- 336 [prop-label] Cost
- 337 [prop-label] Notes

### src\modules\inventory\pages\StockAdjustments.jsx
- 147 [jsx-text] Warehouse
- 159 [jsx-text] Reason
- 199 [jsx-text] Adjustment timeline
- 202 [jsx-text] No adjustments recorded locally.
- 221 [jsx-text] Warehouse selection
- 224 [jsx-text] Loading warehouses...
- 144 [placeholder] e.g. 102
- 164 [placeholder] Damage, count correction, receipt variance, manual correction...
- 113 [title] Stock Adjustments
- 114 [title] Adjust inventory quantities, record inbound/outbound changes, and keep a local audit trail when the backend lacks a movement endpoint.
- 40 [toast] Using fallback warehouses
- 59 [toast] Variant id required
- 92 [toast] Stock updated and tracked locally
- 105 [toast] Backend update-stock unavailable. Saved adjustment locally.
- 144 [prop-label] Variant ID
- 145 [prop-label] Quantity
- 175 [prop-label] Increment
- 182 [prop-label] Decrement

### src\modules\inventory\pages\StockMovements.jsx
- 53 [placeholder] Search movements...
- 26 [title] Stock Movements
- 27 [title] Inbound / outbound movement history, inventory timeline, and local adjustment records.

### src\modules\inventory\pages\StockTransfers.jsx
- 131 [jsx-text] Transfer notes
- 152 [jsx-text] Transfer history
- 155 [jsx-text] Loading warehouses...
- 157 [jsx-text] No transfers recorded locally.
- 178 [jsx-text] Warehouse transfer placeholder
- 125 [placeholder] Variant identifier
- 136 [placeholder] Packing notes, driver details, transfer reason...
- 94 [title] Warehouse Transfer Placeholder
- 95 [title] Outbound / inbound transfer workflow, stock handoff placeholder, and local transfer history.
- 39 [toast] Using fallback transfer data
- 56 [toast] Variant ID required
- 77 [toast] Transfer submitted
- 88 [toast] Transfer endpoint unavailable. Saved locally as placeholder.
- 125 [prop-label] Variant ID
- 126 [prop-label] From warehouse
- 127 [prop-label] To warehouse
- 128 [prop-label] Quantity

### src\modules\inventory\pages\WarehousesDashboard.jsx
- 315 [jsx-text] Default/protected warehouse: status cannot be changed to inactive.
- 395 [jsx-text] Delete warehouse
- 415 [jsx-text] Warehouse ID
- 419 [jsx-text] Default references
- 308 [aria-label] Close
- 391 [aria-label] Close
- 96 [toast] Warehouse deleted
- 226 [prop-label] Products
- 227 [prop-label] Stock
- 228 [prop-label] Transfers
- 308 [prop-label] Close
- 391 [prop-label] Close
- 407 [prop-label] Products
- 408 [prop-label] Stock qty
- 409 [prop-label] Transfers
- 410 [prop-label] Active

## marketing (9)

### src\modules\marketing\components\PostEditorModal.jsx
- 145 [jsx-text] erp.store
- 176 [jsx-text] erp.store
- 201 [jsx-text] erp.store
- 222 [jsx-text] ERP Store

### src\modules\marketing\components\StoryPreview.jsx
- 34 [jsx-text] 0 && sale
- 38 [jsx-text] 0 && now
- 47 [jsx-text] 0 && (!regular || saleLikePrice
- 254 [jsx-text] 1 && stock

### src\modules\marketing\pages\AiMarketingCenter.jsx
- 578 [jsx-text] Ctrl/Cmd + K

## orders (6)

### src\modules\orders\pages\OrdersDashboard.jsx
- 87 [jsx-text] 0 && paid
- 89 [jsx-text] 0 && shipping
- 837 [jsx-text] : proofUrl ?
- 976 [jsx-text] : proofUrl ?
- 953 [prop-label] Payment
- 954 [prop-label] Shipping

## other (323)

### src\App.jsx
- 208 [title] Application screen crashed

### src\components\activity\LiveActivityFeed.jsx
- 37 [jsx-text] Paused
- 116 [aria-label] Loading activity
- 116 [prop-label] Loading activity

### src\components\dashboard\ActiveVisitorsCard.jsx
- 11 [title] Storefront Live

### src\components\dashboard\AIActivityCard.jsx
- 9 [jsx-text] AI Activity
- 13 [prop-label] Escalations
- 14 [prop-label] Signals

### src\components\dashboard\CommandCenterDashboard.jsx
- 55 [jsx-text] Command Center
- 56 [jsx-text] Live operations cockpit

### src\components\dashboard\InventoryPulseCard.jsx
- 9 [jsx-text] Inventory Pulse
- 19 [jsx-text] No critical stock pressure right now.
- 22 [prop-label] Fast movers
- 23 [prop-label] Pending transfers

### src\components\dashboard\LiveSalesTicker.jsx
- 19 [jsx-text] Live Sales Ticker
- 20 [jsx-text] Recent revenue events

### src\components\dashboard\RealtimeAlertsCard.jsx
- 15 [jsx-text] Realtime Alerts
- 22 [jsx-text] No critical operational alerts right now.

### src\components\dashboard\RealtimeBranchStatusCard.jsx
- 8 [jsx-text] Branch Status
- 15 [jsx-text] Single branch mode or no branch activity yet.

### src\components\dashboard\RevenuePulseCard.jsx
- 9 [jsx-text] Revenue Pulse
- 12 [prop-label] Avg order
- 13 [prop-label] Orders
- 14 [prop-label] Peak period
- 15 [prop-label] Best branch

### src\components\dashboard\StaffActivityCard.jsx
- 8 [jsx-text] Staff Activity
- 10 [prop-label] Checked in
- 11 [prop-label] Open shifts
- 12 [prop-label] Task events
- 13 [prop-label] Urgent tasks

### src\components\dashboard\TodayTargetsCard.jsx
- 8 [jsx-text] Today Targets
- 14 [prop-label] Conversion

### src\components\dashboard\TopSellingNowCard.jsx
- 8 [jsx-text] Top Selling Now
- 15 [jsx-text] Top sellers will appear after sales activity.

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

### src\modules\attendance\components\AttendanceWorkspace.jsx
- 840 [jsx-text] HR / Attendance
- 841 [jsx-text] Attendance & Shift Management
- 898 [jsx-text] Admin tools
- 899 [jsx-text] Attendance Device Management
- 980 [jsx-text] Today's chart
- 981 [jsx-text] Branch attendance mix
- 983 [jsx-text] Present / Late / Overtime
- 1006 [jsx-text] Status
- 1007 [jsx-text] Daily summary
- 1015 [jsx-text] Total employees
- 1019 [jsx-text] Worked hours
- 1024 [jsx-text] Today
- 1026 [jsx-text] Attendance logs automatically link to POS when shifts are opened from the kiosk.
- 1034 [jsx-text] Recent logs
- 1035 [jsx-text] Attendance list
- 1044 [jsx-text] Employee
- 1045 [jsx-text] Branch
- 1046 [jsx-text] Shift
- 1047 [jsx-text] Check-in
- 1048 [jsx-text] Check-out
- 1049 [jsx-text] Status
- 1050 [jsx-text] Worked
- 1054 [jsx-text] No attendance logs for the selected day.
- 1087 [jsx-text] Employee list
- 1088 [jsx-text] Employees & shifts
- 1127 [jsx-text] Name
- 1128 [jsx-text] Code
- 1129 [jsx-text] Branch
- 1130 [jsx-text] Role
- 1131 [jsx-text] Status
- 1132 [jsx-text] Shift
- 1133 [jsx-text] Check-in
- 1134 [jsx-text] Actions
- 1138 [jsx-text] No employees found.
- 1212 [jsx-text] Employee profile
- 1266 [jsx-text] Shift assignment
- 1327 [jsx-text] Device security
- 1328 [jsx-text] Attendance device approvals
- 1357 [jsx-text] Employee
- 1358 [jsx-text] Status
- ... 99 more

### src\modules\employees\components\EmployeeAnalyticsShell.jsx
- 20 [jsx-text] Employee analytics

### src\modules\employees\components\EmployeeAnalyticsWorkspace.jsx
- 338 [jsx-text] Date filters refetch the employee analytics backend automatically.
- 404 [jsx-text] Refreshing
- 421 [jsx-text] Revenue by employee
- 422 [jsx-text] Sales and commission mix
- 445 [jsx-text] Shift analytics
- 446 [jsx-text] Shift revenue trend
- 478 [jsx-text] Employee
- 479 [jsx-text] Role
- 480 [jsx-text] Sales
- 481 [jsx-text] Orders
- 482 [jsx-text] Avg Order
- 483 [jsx-text] Commission
- 484 [jsx-text] Refunds
- 516 [jsx-text] Commission rules
- 517 [jsx-text] Configurable rules
- 532 [jsx-text] Global
- 533 [jsx-text] Product
- 534 [jsx-text] Category
- 535 [jsx-text] Employee
- 542 [jsx-text] Percentage
- 543 [jsx-text] Fixed
- 574 [jsx-text] Sale
- 575 [jsx-text] Item
- 598 [jsx-text] Value:
- 599 [jsx-text] Priority:
- 600 [jsx-text] Applies to:
- 601 [jsx-text] Scope ID:
- 609 [jsx-text] Commission transactions
- 614 [jsx-text] Employee
- 615 [jsx-text] Invoice
- 616 [jsx-text] Sale
- 617 [jsx-text] Commission
- 618 [jsx-text] Status
- 654 [jsx-text] Orders:
- 655 [jsx-text] Avg order:
- 656 [jsx-text] Commission:
- 657 [jsx-text] Shift:
- 676 [jsx-text] Sales
- 677 [jsx-text] Orders
- 678 [jsx-text] Avg order
- ... 25 more

### src\modules\employees\components\roles\CreateRoleModal.jsx
- 57 [placeholder] Role Name

### src\modules\employees\components\users\CreateUserModal.jsx
- 116 [placeholder] Name
- 124 [placeholder] Email
- 132 [placeholder] Password

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

### src\services\realtimeFeedbackService.js
- 218 [jsx-text] = start && current
- 218 [jsx-text] = start || current

## pages (874)

### src\modules\aiSupport\pages\AiAgentAnalytics.jsx
- 174 [jsx-text] AI Agent Analytics
- 175 [jsx-text] Performance Dashboard
- 176 [jsx-text] Commercial and operational performance for AI-assisted conversations, drafts, orders, follow-ups, objections, and product demand.
- 182 [jsx-text] All branches
- 218 [title] Lead Quality
- 228 [title] Top Objections
- 232 [title] Follow-up Performance
- 247 [title] Top Products Asked About
- 256 [title] Top Products Converted
- 266 [title] High Interest, Low Conversion
- 276 [title] Products With Stock Conflicts
- 200 [prop-label] AI-assisted revenue
- 201 [prop-label] AI-created drafts
- 202 [prop-label] Confirmed AI orders
- 203 [prop-label] Conversion rate
- 204 [prop-label] Average order value
- 205 [prop-label] Abandoned / recovered
- 209 [prop-label] Total conversations
- 210 [prop-label] AI replies
- 211 [prop-label] Human takeovers
- 212 [prop-label] Avg response time
- 213 [prop-label] Waiting customers
- 214 [prop-label] Closed conversations
- 220 [prop-label] Hot leads
- 221 [prop-label] Warm leads
- 222 [prop-label] Cold leads
- 223 [prop-label] VIP customers
- 224 [prop-label] Complaints
- 234 [prop-label] Scheduled
- 235 [prop-label] Due
- 236 [prop-label] Sent
- 237 [prop-label] Manually sent
- 238 [prop-label] Snoozed
- 239 [prop-label] Cancelled
- 240 [prop-label] Recovered after follow-up
- 241 [prop-label] Stopped after rejection

### src\modules\aiSupport\pages\AiAgentSettings.jsx
- 184 [jsx-text] AI Agent Control Center
- 185 [jsx-text] Sales Agent Settings
- 186 [jsx-text] Tenant-scoped controls for tone, sales rules, follow-ups, handoff triggers, and staff suggested replies.
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
- 222 [prop-label] Exchange / return policy text
- 223 [prop-label] Delivery policy text
- 227 [prop-label] Enable follow-ups
- 229 [prop-label] Cooldown hours
- 230 [prop-label] Max follow-ups per customer
- 232 [prop-label] Stop after rejection
- 233 [prop-label] Follow-up templates
- 238 [prop-label] Angry customer
- ... 9 more

### src\modules\aiSupport\pages\AiChannels.jsx
- 21 [jsx-text] AI Channels

### src\modules\aiSupport\pages\AiFollowups.jsx
- 163 [jsx-text] Follow-ups ready for staff action
- 213 [jsx-text] Closed
- 214 [jsx-text] Internal note sent
- 214 [jsx-text] Ready to send manually
- 231 [placeholder] Edit the internal follow-up note before sending...
- 178 [prop-label] Due follow-ups
- 179 [prop-label] Scheduled
- 180 [prop-label] Completed
- 181 [prop-label] Stopped / rejected

### src\modules\aiSupport\pages\AiInbox.jsx
- 205 [jsx-text] Waiting
- 206 [jsx-text] Human takeover
- 207 [jsx-text] Closed
- 209 [jsx-text] Confirmed
- 219 [jsx-text] No transcript yet.
- 286 [jsx-text] : status === "closed" ?
- 294 [jsx-text] Take over
- 295 [jsx-text] Return to AI
- 296 [jsx-text] Close
- 301 [jsx-text] Assign
- 317 [jsx-text] Conversation closed. Manual replies are disabled.
- 320 [jsx-text] AI active. Take over the conversation to send manual staff replies.
- 332 [jsx-text] Send
- 355 [jsx-text] Closed conversations cannot generate suggestions.
- 357 [jsx-text] Generate staff-only reply suggestions, then click one to edit it in the composer.
- 424 [jsx-text] Unknown
- 454 [jsx-text] No draft for this conversation.
- 486 [jsx-text] Confirm Order
- 487 [jsx-text] Edit Draft
- 488 [jsx-text] Reject / Cancel
- 489 [jsx-text] Assign to human
- 490 [jsx-text] Resume AI
- 678 [jsx-text] AI Inbox Pro
- 679 [jsx-text] Sales Command Center
- 680 [jsx-text] AI conversations, lead scoring, customer memory, visual selling context, and order drafts in one workspace.
- 709 [jsx-text] ) : !loading ?
- 725 [jsx-text] Takeover
- 726 [jsx-text] Closed
- 727 [jsx-text] Waiting customer
- 300 [placeholder] Employee/admin name
- 331 [placeholder] Write a staff reply...
- 324 [title] Manual reply
- 347 [title] AI Suggested Replies
- 381 [title] Customer profile
- 392 [title] Viewed products
- 393 [title] Abandoned products
- 394 [title] Previous orders
- 396 [title] Sentiment & memory
- 452 [title] Order draft panel
- 707 [title] Conversations list
- ... 22 more

### src\modules\aiSupport\pages\AiSupportConsole.jsx
- 186 [jsx-text] Confidence
- 216 [jsx-text] Not returned by endpoint.
- 264 [jsx-text] no sources
- 546 [jsx-text] AI Support Console
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
- 706 [jsx-text] Detected intent
- 710 [jsx-text] Context sources
- 714 [jsx-text] Fallback reason
- 719 [jsx-text] Source preview sent to AI
- 723 [jsx-text] Full endpoint response
- 749 [jsx-text] Customer orders started by AI chat, WhatsApp, Instagram, or Facebook inbox.
- 768 [jsx-text] Loading AI order drafts...
- 785 [jsx-text] Customer:
- 786 [jsx-text] Area:
- 787 [jsx-text] Product:
- 788 [jsx-text] Variant:
- 789 [jsx-text] Total:
- 790 [jsx-text] Conversation:
- 816 [jsx-text] No AI order drafts yet.
- 828 [jsx-text] Tenant-scoped customer chat patterns, product demand signals, and handoff volume.
- 847 [jsx-text] Human handoffs
- 871 [jsx-text] Latest tenant-scoped AI support test conversations for quality and failure review.
- 879 [jsx-text] All outcomes
- 880 [jsx-text] Needs human support
- 881 [jsx-text] Answered by AI
- 919 [jsx-text] Loading history...
- 923 [jsx-text] No AI support test history yet.
- 596 [placeholder] Type a customer question...
- 850 [title] Top AI questions
- 851 [title] Top product terms
- ... 8 more

### src\modules\aiSupport\pages\AiSupportKnowledgeBase.jsx
- 148 [jsx-text] قاعدة معرفة الدعم الذكي
- 227 [jsx-text] التحقق
- 96 [toast] راجع صيغة الهاتف أو واتساب
- 110 [toast] تم حفظ قاعدة معرفة AI Support
- 130 [toast] تم تصفير قاعدة المعرفة
- 120 [confirm] Reset AI Support knowledge base for this tenant?

### src\modules\analytics\pages\AnalyticsDashboard.jsx
- 976 [jsx-text] Product
- 977 [jsx-text] Variant
- 978 [jsx-text] Stock
- 979 [jsx-text] Avg daily sales
- 980 [jsx-text] Days remaining
- 981 [jsx-text] Reorder qty
- 982 [jsx-text] Risk
- 1038 [jsx-text] Product
- 1039 [jsx-text] Variant
- 1040 [jsx-text] Stock
- 1041 [jsx-text] Last sold
- 1042 [jsx-text] Days without sales
- 1043 [jsx-text] Blocked capital
- 1044 [jsx-text] Risk
- 1045 [jsx-text] Recommendation
- 718 [title] Sales trend
- 718 [title] Order movement and sales velocity using backend chart data.
- 742 [title] Channel mix
- 742 [title] Sales distribution across commerce channels.
- 831 [title] AI insights
- 831 [title] Narrative intelligence generated from the latest ERP signals.
- 851 [title] Predicted sales
- 851 [title] Forecasted demand with confidence scoring.
- 1015 [title] AI Dead Stock Intelligence
- 1015 [title] Identify slow-moving inventory with blocked capital and clear action recommendations.
- 1081 [title] Dead stock detection
- 1081 [title] Items that are moving slowly and are tying up working capital.
- 1112 [title] Inventory risk snapshot
- 1112 [title] System-wide risk signals for proactive replenishment.
- 1133 [title] Cash efficiency
- 1143 [title] Order velocity
- 1144 [title] AI score
- 1145 [title] Dead stock ratio
- 1146 [title] Smart alerts
- 769 [prop-label] No sales channel data available.
- 1019 [prop-label] Items flagged
- 1021 [prop-label] Blocked capital
- 1025 [prop-label] Critical risks
- 1029 [prop-label] Clearance targets
- 1097 [prop-label] Color
- ... 3 more

### src\modules\attendance\pages\AttendanceDashboard.jsx
- 109 [jsx-text] Today&apos;s attendance overview
- 142 [jsx-text] Attendance log
- 152 [jsx-text] Employee
- 153 [jsx-text] Branch
- 154 [jsx-text] Check in
- 155 [jsx-text] Check out
- 156 [jsx-text] Worked
- 157 [jsx-text] Status
- 132 [prop-label] Present now
- 133 [prop-label] Checked out
- 134 [prop-label] Missing checkout
- 135 [prop-label] Late employees
- 136 [prop-label] Total employees

### src\modules\attendance\pages\AttendanceReports.jsx
- 119 [jsx-text] Export-ready attendance reports
- 152 [jsx-text] From
- 170 [jsx-text] Employee ID
- 195 [jsx-text] Monthly totals
- 196 [jsx-text] Grouped by month for the active filter range.
- 201 [jsx-text] Loading monthly totals...
- 203 [jsx-text] No totals available for this range.
- 220 [jsx-text] Attendance table
- 221 [jsx-text] Employee, branch, worked hours, and checkout status.
- 230 [jsx-text] Employee
- 231 [jsx-text] Branch
- 232 [jsx-text] Date
- 233 [jsx-text] Check in
- 234 [jsx-text] Check out
- 235 [jsx-text] Worked
- 236 [jsx-text] Status
- 175 [placeholder] All employees
- 185 [prop-label] Present
- 186 [prop-label] Checked out
- 187 [prop-label] Missing checkout
- 188 [prop-label] Late
- 189 [prop-label] Worked hours

### src\modules\attendance\pages\PublicBranchAttendance.jsx
- 213 [jsx-text] Attendance
- 239 [jsx-text] Location
- 273 [jsx-text] Phone or employee code
- 298 [jsx-text] Employee identified
- 225 [title] Branch map preview

### src\modules\attendance\pages\StaffQrAttendance.jsx
- 157 [jsx-text] Scan branch QR, then confirm GPS
- 200 [jsx-text] Processing QR and GPS location...
- 213 [jsx-text] Result
- 219 [prop-label] Employee
- 220 [prop-label] Branch
- 221 [prop-label] Time
- 222 [prop-label] Distance
- 223 [prop-label] Allowed radius

### src\modules\coupons\pages\CouponsManager.jsx
- 208 [jsx-text] Offline Coupon Campaigns
- 209 [jsx-text] Generate street-distributed coupons, track redemption, and export printable sheets without mock analytics.
- 229 [jsx-text] Campaigns
- 275 [jsx-text] Edit
- 276 [jsx-text] Delete
- 288 [jsx-text] All statuses
- 289 [jsx-text] Active
- 290 [jsx-text] Unused
- 291 [jsx-text] Used
- 292 [jsx-text] Expired
- 298 [jsx-text] Code
- 299 [jsx-text] Discount
- 300 [jsx-text] Usage
- 301 [jsx-text] Status
- 302 [jsx-text] Expires
- 370 [jsx-text] Cancel
- 371 [jsx-text] Save
- 270 [placeholder] Qty
- 285 [placeholder] Search coupon code
- 358 [placeholder] Optional
- 141 [toast] Campaign updated
- 145 [toast] Campaign created
- 158 [toast] Campaign deleted
- 255 [prop-label] No coupon campaigns yet.
- 317 [prop-label] No coupons match this filter.
- 322 [prop-label] Select or create a coupon campaign.
- 353 [prop-label] Name
- 354 [prop-label] Code prefix
- 355 [prop-label] Discount type
- 356 [prop-label] Discount value
- 357 [prop-label] Minimum order
- 358 [prop-label] Max discount
- 359 [prop-label] Usage per coupon
- 360 [prop-label] Target coupons
- 361 [prop-label] Starts at
- 362 [prop-label] Expires at
- 363 [prop-label] Channel

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

### src\modules\employees\pages\EmployeePortal.jsx
- 103 [jsx-text] ثبّت بوابة الموظف على الموبايل
- 104 [jsx-text] افتح التاسكات بسرعة واستقبل التنبيهات أثناء الشيفت.
- 152 [jsx-text] تفعيل تنبيهات التاسكات
- 184 [jsx-text] تصعيد
- 471 [jsx-text] بوابة الموظف غير متاحة
- 486 [jsx-text] بوابة الموظف
- 492 [jsx-text] مهام اليوم
- 496 [jsx-text] قيد التنفيذ
- 500 [jsx-text] مكتملة
- 528 [jsx-text] المهام المطلوبة
- 535 [jsx-text] لا توجد مهام مطلوبة الآن.
- 541 [jsx-text] المهام المكتملة
- 546 [jsx-text] لم يتم إكمال أي مهمة بعد.

### src\modules\employees\pages\StaffTasks.jsx
- 154 [jsx-text] Completed
- 157 [jsx-text] Escalated
- 391 [jsx-text] Employee Tasks
- 392 [jsx-text] Attendance-aware task assignment, redistribution, inventory counts, and performance tracking.
- 449 [jsx-text] Admin-controlled assignment, due time, proof rules, and recurring metadata.
- 458 [jsx-text] Auto assign employee
- 462 [jsx-text] Any branch
- 472 [jsx-text] Photo proof
- 473 [jsx-text] QR verification
- 474 [jsx-text] GPS validation
- 493 [jsx-text] Employee portal settings
- 494 [jsx-text] Controls QR check-in redirect and task visibility enforcement.
- 559 [jsx-text] Task queue
- 564 [jsx-text] All statuses
- 568 [jsx-text] All employees
- 572 [jsx-text] All branches
- 576 [jsx-text] All priorities
- 608 [jsx-text] Performance
- 629 [jsx-text] Audit trail
- 639 [jsx-text] No task history yet.
- 456 [placeholder] Task title
- 475 [placeholder] Task details
- 476 [placeholder] Checklist items, one per line
- 365 [toast] Task updated
- 368 [toast] Task created
- 377 [toast] Task deleted

### src\modules\loyalty\pages\CustomerLoyaltyProfile.jsx
- 95 [jsx-text] Customer loyalty profile
- 136 [jsx-text] Transaction history
- 143 [jsx-text] Type
- 144 [jsx-text] Points
- 145 [jsx-text] Value
- 146 [jsx-text] Date
- 164 [jsx-text] Redeem points
- 165 [jsx-text] Convert points to value when the customer checks out.
- 168 [jsx-text] Points to redeem
- 45 [toast] Using loyalty customer fallback
- 63 [toast] Enter valid points
- 78 [toast] Points redeemed

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
- 180 [jsx-text] Inactive rules do not apply to new orders
- 49 [toast] Using loyalty rules fallback
- 86 [toast] Loyalty rule updated
- 90 [toast] Loyalty rule created

### src\modules\notifications\pages\NotificationsCenter.jsx
- 62 [jsx-text] Notifications Center
- 67 [jsx-text] الإشعارات
- 74 [jsx-text] مركز متابعة أحداث ERP والويب سايت في الوقت الحقيقي.
- 134 [jsx-text] لا توجد إشعارات
- 135 [jsx-text] لا توجد نتائج مطابقة للفلاتر الحالية. غيّر الفلاتر أو جرّب التحديث لاحقا.
- 103 [placeholder] بحث

### src\modules\permissions\pages\Permissions.jsx
- 137 [jsx-text] Roles
- 138 [jsx-text] Choose a role to edit its permission set.
- 186 [jsx-text] Export permissions snapshot
- 187 [jsx-text] Placeholder for CSV/PDF export once the backend exporter is available.
- 110 [title] Permission Matrix
- 59 [toast] Using local permissions fallback
- 92 [toast] Permissions saved
- 99 [toast] Backend unavailable. Saved locally.
- 149 [prop-label] No roles available.

### src\modules\permissions\pages\Roles.jsx
- 147 [jsx-text] Create role
- 148 [jsx-text] Built-in roles are seeded; custom roles can be added locally even if the backend is offline.
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
- 172 [placeholder] user@company.com
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
- 350 [jsx-text] window.print()
- 366 [jsx-text] Enterprise Reports Center
- 569 [jsx-text] Business Intelligence & Smart Recommendations
- 676 [jsx-text] No items for the selected filters.
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
- 102 [jsx-text] Company profile
- 110 [jsx-text] Password
- 147 [jsx-text] Owner and staff accounts
- 104 [placeholder] Acme Retail
- 105 [placeholder] Owner full name
- 106 [placeholder] owner@company.com
- 107 [placeholder] acme-retail
- 116 [placeholder] Owner password
- 87 [title] Register Company
- 149 [title] Owner account
- 150 [title] Staff accounts
- 151 [title] Workspace persistence
- 24 [toast] Company, owner email, and password are required
- 79 [toast] Company workspace created
- 104 [prop-label] Company name
- 105 [prop-label] Owner name
- 106 [prop-label] Owner email
- 107 [prop-label] Workspace slug

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
- 379 [jsx-text] رصيد المحفظة
- 526 [jsx-text] Customer Wallet Audit
- 565 [jsx-text] النوع
- 583 [jsx-text] إضافة يدوية
- 584 [jsx-text] خصم يدوي
- 588 [jsx-text] حفظ
- 593 [jsx-text] Wallet audit timeline
- 596 [jsx-text] Loading...
- 600 [jsx-text] لا توجد حركات مطابقة للفلاتر.
- 586 [placeholder] المبلغ
- 587 [placeholder] سبب/ملاحظات التعديل
- 549 [aria-label] Close
- 140 [confirm] يجب إدخال سبب/ملاحظات للتعديل اليدوي.
- 549 [prop-label] Close
- 562 [prop-label] من تاريخ
- 563 [prop-label] إلى تاريخ
- 570 [prop-label] رقم الفاتورة
- 571 [prop-label] أقل مبلغ
- 572 [prop-label] أكبر مبلغ

### src\modules\sales\pages\InvoicesLegacy.jsx
- 353 [placeholder] Search invoices...
- 413 [placeholder] Product
- 437 [placeholder] Customer
- 461 [placeholder] Quantity
- 485 [placeholder] Price
- 52 [confirm] Fill all fields
- 99 [confirm] Delete Invoice?

### src\modules\sales\pages\SalesEmployees.jsx
- 132 [jsx-text] Sales Staff
- 133 [jsx-text] Sales Staff + Commissions
- 134 [jsx-text] POS assignment, item-level commission exclusions, reports, and payroll previews.
- 156 [jsx-text] Commission type
- 158 [jsx-text] Percent
- 159 [jsx-text] Fixed
- 203 [jsx-text] POS commission settings
- 204 [jsx-text] Controls checkout blocking and fixed commission behavior.
- 206 [jsx-text] Save settings
- 214 [jsx-text] Fixed mode
- 216 [jsx-text] Fixed per invoice
- 217 [jsx-text] Fixed per item
- 224 [jsx-text] Employees
- 247 [jsx-text] Commission report
- 248 [jsx-text] Item-level net sales with returns and exclusions applied.
- 250 [jsx-text] Apply filters
- 270 [jsx-text] Employee
- 271 [jsx-text] Sales
- 272 [jsx-text] Invoices
- 273 [jsx-text] Items
- 274 [jsx-text] Returns
- 275 [jsx-text] Net
- 276 [jsx-text] Commission
- 299 [jsx-text] Payroll breakdown preview
- 324 [jsx-text] Loading sales staff...
- 172 [placeholder] Search products to exclude
- 93 [toast] Sales employee saved
- 106 [toast] Sales settings saved
- 111 [toast] Select an employee for payroll preview
- 149 [prop-label] Name
- 151 [prop-label] Code
- 152 [prop-label] Phone
- 162 [prop-label] Value
- 253 [prop-label] Start
- 254 [prop-label] End
- 255 [prop-label] Employee
- 256 [prop-label] Branch ID
- 259 [prop-label] Sales
- 260 [prop-label] Invoices
- 261 [prop-label] Items
- ... 12 more

### src\modules\settings\pages\AppearanceSettings.jsx
- 202 [jsx-text] Realtime feedback
- 225 [jsx-text] Volume
- 240 [jsx-text] Sound theme
- 268 [title] Enable sounds
- 274 [title] Critical only
- 280 [title] Mute AI
- 286 [title] POS mode
- 292 [title] Silent hours
- 298 [title] Browser alerts
- 254 [prop-label] Silent start
- 259 [prop-label] Silent end

### src\modules\settings\pages\Currencies.jsx
- 55 [jsx-text] Currency settings
- 57 [jsx-text] ERP Currency
- 64 [jsx-text] Preview
- 75 [jsx-text] Currency profile
- 76 [jsx-text] Choose a supported currency or edit the fields directly.
- 82 [jsx-text] Preset
- 88 [jsx-text] Custom
- 98 [jsx-text] Currency code
- 108 [jsx-text] Currency symbol
- 118 [jsx-text] Locale
- 131 [jsx-text] Stored value
- 137 [jsx-text] Supported currencies
- 122 [placeholder] ar-EG
- 34 [toast] Currency code, symbol, and locale are required
- 39 [toast] Currency settings saved
- 45 [toast] Currency reset to default

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
- 110 [jsx-text] Website Settings
- 134 [jsx-text] Storefront Pricing Settings
- 153 [jsx-text] Enable fake compare price
- 154 [jsx-text] Show generated old prices on storefront cards and product pages.
- 165 [jsx-text] Fake compare percent
- 177 [jsx-text] Rounding mode
- 183 [jsx-text] none
- 184 [jsx-text] nearest_10
- 185 [jsx-text] nearest_50
- 186 [jsx-text] nearest_100
- 195 [jsx-text] Existing Sale Prices
- 221 [jsx-text] Sale label
- 230 [jsx-text] Active indicator
- 258 [jsx-text] Minimum price protection
- 259 [jsx-text] Prevent global sale prices from going below cost plus margin.
- 269 [jsx-text] Minimum margin percent
- 283 [jsx-text] Next configuration fields
- 225 [placeholder] Summer Sale
- 248 [placeholder] Comma separated
- 290 [placeholder] Coming soon
- 71 [toast] Failed to load website settings
- 93 [toast] Storefront pricing settings saved

### src\pages\ActivityLogs.jsx
- 237 [placeholder] Search logs...

### src\pages\Branches.jsx
- 479 [jsx-text] Branch attendance
- 484 [jsx-text] 1. Scan QR
- 485 [jsx-text] 2. Enter code/phone
- 486 [jsx-text] 3. Check in/out
- 743 [title] Branch map preview

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
- 253 [jsx-text] 0 && resolved.final_price
- 410 [jsx-text] ERP Control Center
- 418 [jsx-text] Today
- 419 [jsx-text] Yesterday
- 420 [jsx-text] Last 7 days
- 421 [jsx-text] This month
- 422 [jsx-text] Custom range
- 432 [jsx-text] All branches
- 466 [jsx-text] Existing Sale Prices Active
- 587 [jsx-text] Getting started today
- 588 [jsx-text] No sales activity exists for this filter yet. Start from one of the operational shortcuts below.
- 824 [jsx-text] Payment methods
- 725 [title] Revenue vs Orders
- 739 [title] No sales in this range
- 741 [title] Hourly Sales
- 751 [title] No hourly activity
- 777 [title] No activity in this range
- 805 [title] Low stock products
- 806 [title] Fast moving products
- 807 [title] Top sizes sold
- 808 [title] Top colors sold
- 832 [title] No payments yet
- 847 [title] Insights will appear after sales activity
- 854 [title] No branch sales yet
- 872 [title] No marketing attribution yet
- 891 [title] Best selling products
- 905 [title] No records yet
- 923 [title] Notifications
- 928 [title] Low stock alerts
- 930 [title] Stock is healthy
- 932 [title] Recent invoices
- 934 [title] No invoices yet
- 936 [title] POS sessions
- 938 [title] No open POS sessions
- 940 [title] Live stream
- 651 [aria-label] Trend sparkline
- 436 [prop-label] Socket
- 438 [prop-label] Online
- 449 [prop-label] Open POS
- 450 [prop-label] Add Product
- ... 17 more

### src\pages\Login.jsx
- 147 [placeholder] Email
- 157 [placeholder] Password
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

## pos (120)

### src\modules\pos\components\CartSidebar.jsx
- 338 [jsx-text] Cart
- 355 [jsx-text] Cart is empty
- 356 [jsx-text] Search products or scan a barcode to start selling.
- 559 [jsx-text] رصيد المحفظة
- 731 [jsx-text] Facebook
- 732 [jsx-text] Instagram
- 733 [jsx-text] Story
- 734 [jsx-text] TikTok
- 735 [jsx-text] WhatsApp
- 833 [jsx-text] Thermal / A4
- 949 [jsx-text] فاتورة بيع
- 969 [jsx-text] المنتج
- 970 [jsx-text] المقاس / اللون
- 971 [jsx-text] الكمية
- 972 [jsx-text] السعر
- 973 [jsx-text] الإجمالي
- 976 [jsx-text] لا توجد منتجات
- 1011 [jsx-text] الإجمالي النهائي
- 1230 [jsx-text] خدمة العملاء
- 1233 [jsx-text] خدمة العملاء
- 1007 [prop-label] المجموع الفرعي
- 1008 [prop-label] الخصم
- 1009 [prop-label] الخدمة
- 1016 [prop-label] عدد المنتجات
- 1017 [prop-label] إجمالي الكمية
- 1023 [prop-label] المدفوع من المحفظة
- 1024 [prop-label] المتبقي نقدي/بطاقة
- 1025 [prop-label] رصيد المحفظة بعد العملية
- 1205 [prop-label] Coupon Discount

### src\modules\pos\components\ProductAvailabilityModal.jsx
- 125 [jsx-text] Barcode Shop
- 170 [jsx-text] Colors
- 200 [jsx-text] Sizes
- 240 [jsx-text] Selected variant
- 163 [prop-label] Brand
- 164 [prop-label] Category
- 242 [prop-label] Color
- 243 [prop-label] Size
- 245 [prop-label] Barcode
- 246 [prop-label] Stock
- 247 [prop-label] Price

### src\modules\pos\components\ProductGrid.jsx
- 57 [jsx-text] 0) || min

### src\modules\pos\components\RecentOperationsDrawer.jsx
- 411 [jsx-text] العمليات الأخيرة
- 412 [jsx-text] عرض، إعادة طباعة، تعديل، إلغاء، أو مرتجع الفواتير الأخيرة.
- 632 [jsx-text] مرتجع POS
- 633 [jsx-text] إنشاء مرتجع / استبدال
- 636 [jsx-text] إغلاق
- 656 [jsx-text] سبب المرتجع
- 682 [jsx-text] طريقة رد المبلغ
- 705 [jsx-text] اختيار المنتجات المراد إرجاعها
- 722 [jsx-text] الكمية المرتجعة
- 790 [jsx-text] تفاصيل الفاتورة
- 793 [jsx-text] إغلاق
- 798 [jsx-text] المنتج
- 799 [jsx-text] الكمية
- 800 [jsx-text] السعر
- 801 [jsx-text] الإجمالي الفرعي
- 818 [jsx-text] لا توجد منتجات في هذه الفاتورة
- 823 [jsx-text] الإجمالي
- 828 [jsx-text] سجل الفاتورة
- 844 [jsx-text] لا يوجد سجل متاح لهذه الفاتورة
- 424 [placeholder] بحث برقم الفاتورة أو العميل أو الهاتف
- 675 [placeholder] اكتب السبب
- 428 [title] تحديث
- 442 [title] حدث خطأ
- 444 [title] لا توجد عمليات
- 405 [aria-label] إغلاق
- 295 [toast] تم تجهيز الفاتورة للطباعة مرة أخرى
- 335 [toast] لا يمكن إلغاء فاتورة ملغاة أو مستردة
- 339 [toast] إلغاء الفواتير متاح للأدمن فقط
- 346 [toast] تم إلغاء الفاتورة وإرجاع المخزون
- 357 [toast] لا يمكن عمل مرتجع لهذه الفاتورة
- 596 [toast] اختر المنتجات المراد إرجاعها
- 405 [prop-label] إغلاق
- 513 [prop-label] الدفع
- 514 [prop-label] الحالة
- 515 [prop-label] الكاشير
- 516 [prop-label] التاريخ
- 526 [prop-label] طباعة مرة أخرى
- 527 [prop-label] عرض التفاصيل
- 528 [prop-label] إعادة بيع
- 529 [prop-label] تعديل الفاتورة
- ... 3 more

### src\modules\pos\pages\POSPro.jsx
- 2837 [jsx-text] POS Receipt
- 3230 [jsx-text] SMART POS FILTERS
- 3234 [jsx-text] اختار من التصنيفات النشطة فقط.
- 3290 [jsx-text] Brand
- 3296 [jsx-text] All brands
- 3306 [jsx-text] Manufacturer
- 3312 [jsx-text] All manufacturers
- 3369 [jsx-text] ADD CUSTOMER
- 3370 [jsx-text] Quick customer creation
- 3383 [jsx-text] Customer Name
- 3393 [jsx-text] Phone Number
- 3462 [jsx-text] Product browser
- 3463 [jsx-text] Fast add-to-cart grid
- 3388 [placeholder] Enter customer name
- 3398 [placeholder] Enter phone number
- 3241 [title] Close filters
- 3240 [aria-label] Close filters
- 1283 [toast] Some cart items are no longer available and were removed.
- 1285 [toast] Cart quantities were adjusted to live stock.
- 1383 [toast] This customer cannot be selected because its ID is missing.
- 2281 [toast] لا توجد منتجات صالحة لإعادة البيع
- 2953 [toast] PDF preview blocked
- 2966 [toast] PDF generated
- 2968 [toast] PDF export failed
- 3005 [toast] تعذر إنشاء رابط الفاتورة
- 3043 [toast] No invoice link available
- 3049 [toast] Invoice link copied
- 3051 [toast] Unable to copy invoice link
- 3057 [toast] No invoice link available
- 3078 [toast] Cart cleared
- 3240 [prop-label] Close filters
- 3251 [prop-label] الجنس
- 3260 [prop-label] نوع المنتج
- 3269 [prop-label] الستايل
- 3278 [prop-label] الفئة
- 4152 [prop-label] Invoices

## products (6)

### src\modules\products\lib\barcodeLabels.js
- 361 [aria-label] ${text}
- 361 [prop-label] ${text}

### src\modules\products\lib\variantBulkSizes.js
- 34 [jsx-text] 0 ? size

### src\modules\products\pages\ProductDetails.jsx
- 54 [aria-label] ${label}
- 54 [prop-label] ${label}

### src\modules\products\pages\ProductsList.jsx
- 266 [jsx-text] 0 && totalStock

## purchases (6)

### src\modules\purchases\lib\flowStore.js
- 485 [jsx-text] Number(variant.stock || 0)

### src\modules\purchases\pages\PurchaseOrder.jsx
- 619 [jsx-text] 0 && salePrice
- 934 [jsx-text] !item.unit_cost || item.unit_cost
- 1595 [jsx-text] 0 && salePrice
- 1925 [jsx-text] 0 && salePrice

### src\modules\purchases\pages\ReorderSuggestions.jsx
- 121 [jsx-text] = 6 && packQty

## shared (59)

### src\shared\components\Sidebar.jsx
- 28 [jsx-text] ERP PRO

### src\shared\components\Table.jsx
- 9 [jsx-text] Name
- 16 [jsx-text] Product

### src\shared\layouts\MainLayout.jsx
- 163 [jsx-text] Workspace
- 178 [jsx-text] ERP PRO
- 300 [jsx-text] Store
- 289 [title] Store
- 25 [aria-label] Notifications unavailable
- 145 [aria-label] Close sidebar
- 170 [aria-label] Close sidebar
- 268 [aria-label] Open menu
- 290 [aria-label] Open Store
- 329 [aria-label] Logout
- 25 [prop-label] Notifications unavailable
- 145 [prop-label] Close sidebar
- 170 [prop-label] Close sidebar
- 268 [prop-label] Open menu
- 290 [prop-label] Open Store
- 329 [prop-label] Logout

### src\shared\lib\saleMode.js
- 57 [jsx-text] 0 && sale
- 134 [jsx-text] 0 && discounted

### src\shared\notifications\NotificationBell.jsx
- 345 [jsx-text] Could not load notifications
- 382 [jsx-text] No notifications
- 153 [title] Unread
- 270 [aria-label] Open notifications
- 283 [aria-label] Close notifications
- 314 [aria-label] Close notifications
- 270 [prop-label] Open notifications
- 283 [prop-label] Close notifications
- 314 [prop-label] Close notifications

### src\shared\utils\colorNameFromImage.js
- 64 [jsx-text] rgbToHsl(rgb).s
- 96 [jsx-text] = 200 && hsl.h
- 112 [jsx-text] 214 && Math.max(r, g, b) - Math.min(r, g, b)
- 114 [jsx-text] alpha
- 234 [jsx-text] = edgeDepth && x
- 234 [jsx-text] = edgeDepth && y
- 283 [jsx-text] = 215 && hsl.s
- 319 [jsx-text] = 0.18 && position
- 390 [jsx-text] = 188 && rgbToHsl(pixel).s
- 479 [jsx-text] = 0.62 && component.borderRatio
- 706 [jsx-text] = 215 && rgbToHsl(sample).s
- 710 [jsx-text] = 80 && brightness
- 712 [jsx-text] isNearBlack(sample) || brightnessOf(sample)
- 713 [jsx-text] brightnessOf(sample)
- 715 [jsx-text] = 232 && rgbToHsl(sample).s
- 718 [jsx-text] = 70 && brightness
- 741 [jsx-text] = 215 && hsl.s
- 742 [jsx-text] = 195 && hsl.s
- 743 [jsx-text] = 145 && brightness
- 747 [jsx-text] 205 && hsl.s
- 769 [jsx-text] DARK_PRIORITY_NAMES.has(cluster.name) || brightnessOf(cluster.rgb)
- 791 [jsx-text] 0.32 && secondary.share
- 792 [jsx-text] 0.32 && secondaryToPrimary
- 793 [jsx-text] stats.whiteRatio * 0.75 && secondary.share
- 862 [jsx-text] = 215 && rgbToHsl(sample).s
- 865 [jsx-text] 0.18 || brightnessOf(rgb)
- 893 [jsx-text] = 215 && rgbToHsl(sample).s
- 905 [jsx-text] candidate.brightness
- 930 [jsx-text] cluster && (brightnessOf(cluster.rgb)

## storefront (20)

### src\storefront\Storefront.jsx
- 566 [jsx-text] 0 && sale
- 570 [jsx-text] 0 && now
- 1022 [jsx-text] = 1 && stock
- 1026 [jsx-text] 0 && totalStock
- 2617 [jsx-text] MONÉ
- 2800 [jsx-text] (current
- 3461 [jsx-text] featured
- 3770 [jsx-text] LAST PIECE FINDER
- 5171 [jsx-text] 0 && Number(variant.stock || 0)
- 6610 [jsx-text] US Men
- 6611 [jsx-text] US Women
- 6777 [jsx-text] index
- 7374 [jsx-text] item.price ?
- 2263 [placeholder] 01xxxxxxxxx
- 7114 [aria-label] WhatsApp
- 7115 [aria-label] Instagram
- 7116 [aria-label] Facebook
- 7114 [prop-label] WhatsApp
- 7115 [prop-label] Instagram
- 7116 [prop-label] Facebook
