# Meta Ads module — reference spec (observed from demo.genie-erp.com, 2026-10-20)

Observed by browsing the reference ERP's UI. We implement our own code; this file
records screens, fields, wording and behaviour so our module matches feature-for-feature.

## Navigation (sidebar group "إعلانات Meta")
| Section | Page | Ref path |
|---|---|---|
| الحملات | مدير الإعلانات | /meta_ads/ads-manager/ |
| | الحسابات الإعلانية | /genie/318 |
| | ربط الحساب | /meta_ads/connect/ |
| | الحملات (list) | /genie/320 |
| | المجموعات الإعلانية | /genie/321 |
| | الإعلانات | /genie/322 |
| | أحداث الإعلانات | /genie/323 |
| العملاء المحتملون | نماذج العملاء المحتملين | /genie/325 |
| | العملاء المحتملون | /genie/326 |
| الجماهير والرؤى | الجماهير | /genie/328 |
| | تصاميم الإعلانات | /genie/329 |
| | إحصاءات الإعلانات | /genie/330 |
| | إحصاءات الصفحة | /genie/331 |
| الإسناد | نقرات الإعلان | /genie/333 |
| | مجموعات بيانات التحويل | /genie/334 |
| | أحداث التحويل | /genie/335 |
| المنافسون | إعلانات المنافسين | /genie/339 |
| الإعدادات | أهداف التحسين | /genie/341 |
| | أحداث الفوترة | /genie/342 |

Top bar inside module: horizontal tabs = the section names (الحملات، العملاء المحتملون، الجماهير والرؤى، الإسناد، المنافسون، الإعدادات) + "مدير الإعلانات" chip.

## Ads Manager page (/meta_ads/ads-manager/)
Header: grid icon + "مدير الإعلانات"; ad-account select "متجر جيني للجلود (act_demo_leather)" + currency "USD".
Toolbar (left side in RTL): "+ إنشاء" (green), "مزامنة" (sync icon), "القواعد التلقائية" (bolt icon), date preset select "كل الأوقات".
Level tabs with counts: الحملات (folder icon) / المجموعات الإعلانية (layers icon) / الإعلانات (ad icon).
Search "بحث بالاسم"; button "أعمدة" (columns picker).
Campaign columns: checkbox, تشغيل/إيقاف (toggle), الحملة (name + Meta id under it), العرض (delivery dot: نشط green / مسودة grey), الهدف, الميزانية ("50.00 USD / يوم"), النتائج, مدى الوصول, مرات الظهور, الإنفاق, الانتهاء ("مستمر").
Drafts show in the list with toggle "—" and status مسودة.

### Server API shape (ref): /meta_ads/api/ads-manager/
bootstrap, manager-data, drafts/{campaign,adset,ad,delete}, media/upload, search/{locations,interests,locales},
geo/geocode, estimate/reach, saved-audiences/{save,<id>,delete}, insights/{series,breakdown,sync},
rules/{,save,delete,toggle,run-now}, validate, publish, preview, duplicate, status, sync.

bootstrap returns: accounts[] {id, ad_account_id, name, currency, timezone, page_id, page_name,
instagram_user_id, instagram_username, pixel_id, application_id, min_daily_budget{high_freq,low_freq,impressions,video_views},
custom_audiences[], lead_forms[], saved_audiences[]}, optimization_goals[16], billing_events[7], cta_labels{24},
conversion_events[10], catalogs{objectives, conversion_locations, preview_formats, special_ad_categories,
bid_strategies, cta_by_objective, placement_tree, location_types, eu_countries}.

Optimization goals (code | promoted_object | destination | valid objectives):
REACH|page||AWARENESS,TRAFFIC,ENGAGEMENT,SALES
IMPRESSIONS|page||AWARENESS,TRAFFIC,ENGAGEMENT,SALES
LINK_CLICKS|||TRAFFIC,ENGAGEMENT,LEADS,SALES,APP_PROMOTION
LANDING_PAGE_VIEWS|||TRAFFIC,ENGAGEMENT,SALES
POST_ENGAGEMENT|page|ON_POST|ENGAGEMENT,AWARENESS
PAGE_LIKES|page|ON_PAGE|ENGAGEMENT
VIDEO_VIEWS|page||AWARENESS,ENGAGEMENT
THRUPLAY|page||AWARENESS,ENGAGEMENT
LEAD_GENERATION|page||LEADS
OFFSITE_CONVERSIONS|pixel||ENGAGEMENT,LEADS,SALES,APP_PROMOTION
APP_INSTALLS|app||APP_PROMOTION
VALUE|pixel||SALES,APP_PROMOTION
QUALITY_CALL|page||LEADS
CONVERSATIONS|page|MESSENGER|TRAFFIC,ENGAGEMENT,LEADS,SALES
AD_RECALL_LIFT|page||AWARENESS
REPLIES|page|MESSENGER|ENGAGEMENT

CTA labels: LEARN_MORE SHOP_NOW SIGN_UP BOOK_NOW DOWNLOAD INSTALL_MOBILE_APP USE_MOBILE_APP GET_DIRECTIONS
CONTACT_US APPLY_NOW BUY_NOW GET_OFFER GET_QUOTE CALL_NOW MESSAGE_PAGE SUBSCRIBE WATCH_MORE LISTEN_MUSIC
PLAY_GAME REQUEST_TIME SEE_MENU DONATE_NOW ORDER_NOW NO_BUTTON

Objectives (label | icon | description | "يناسب" chips):
- OUTCOME_AWARENESS التوعية | Megaphone | اعرض إعلاناتك على الأشخاص الأكثر احتمالًا لتذكرها. | مدى الوصول، الوعي بالعلامة التجارية، مشاهدات الفيديو، الوعي بموقع المتجر
- OUTCOME_TRAFFIC الزيارات | MousePointerClick | أرسل الناس إلى وجهة مثل موقعك أو تطبيقك أو ملفك على إنستجرام. | نقرات الرابط، مشاهدات صفحة الوصول، زيارات الملف الشخصي على إنستجرام، المكالمات
- OUTCOME_ENGAGEMENT التفاعل | MessageCircleHeart | احصل على مزيد من الرسائل أو المشتريات عبر المراسلة أو مشاهدات الفيديو أو التفاعل مع المنشورات أو إعجابات الصفحة أو الاستجابة للفعاليات. | ماسنجر وواتساب، مشاهدات الفيديو، التفاعل مع المنشور، الاستجابة للفعاليات
- OUTCOME_LEADS العملاء المحتملون | UserPlus | اجمع عملاء محتملين لنشاطك أو علامتك التجارية. | النماذج الفورية، ماسنجر وإنستجرام، التحويلات، المكالمات
- OUTCOME_APP_PROMOTION ترويج التطبيق | TabletSmartphone | اعثر على أشخاص جدد لتثبيت تطبيقك والاستمرار في استخدامه. | تثبيتات التطبيق، أحداث التطبيق
- OUTCOME_SALES المبيعات | ShoppingCart | اعثر على الأشخاص الأكثر احتمالًا لشراء منتجك أو خدمتك. | التحويلات، مبيعات الكتالوج، ماسنجر وواتساب

## Create wizard (full-screen overlay)
Layout: top bar "✕ 📁 حملة جديدة" (right) + "✓ تم حفظ المسودة <time>" (left, autosave).
Right rail = tree: حملة جديدة / مجموعة إعلانية جديدة / إعلان جديد (status circle per node; ⚠ when invalid), links "+ إضافة إعلان", "+ إضافة مجموعة إعلانية".
Centre = cards. Left = context card (campaign step: "عن إعداد الحملة" help text; ad set step: "تحديد الجمهور" gauge محدد↔واسع + "حجم الجمهور التقديري" + disclaimer).
Footer: "إغلاق" + "⚠ N مشكلة بحاجة إلى إصلاح" (right); "رجوع" / "التالي ←" (left, blue).

### Step 1 — Campaign
- "اختر هدف الحملة" / "يحدد هدفك كيفية تحسين إعلاناتك وأين تظهر النتائج." — 2-col radio cards with icon; selected card expands a grey box "يناسب:" + chips.
- "اسم الحملة" placeholder "Advantage+ — مثال: تخفيضات الصيف — مبيعات".
- "فئات الإعلانات الخاصة" — "أقرّ بما إذا كانت إعلاناتك تتعلق بمنتجات مالية أو وظائف أو إسكان أو قضايا اجتماعية أو انتخابات أو سياسة." select "حدّد فئة الإقرار...": المنتجات والخدمات المالية / الوظائف / الإسكان / قضايا اجتماعية أو انتخابات أو سياسة / المقامرة والألعاب أونلاين.
- Toggle card "اختبار A/B" — "قارن نسخًا من إعلاناتك لمعرفة الأفضل أداءً. يمكنك إعداد الاختبار في Meta بعد النشر."
- Toggle card "ميزانية الحملة Advantage" — "وزّع ميزانيتك على المجموعات الإعلانية تلقائيًا للحصول على نتائج أكثر."
- Help card "عن إعداد الحملة": "اختر الهدف الذي يناسب ما تريد تحقيقه. ستحدد الجمهور والمواضع وتفاصيل الميزانية في الخطوات التالية، ثم تنشئ التصميم الإعلاني."

### Step 2 — Ad set
- "اسم المجموعة الإعلانية" placeholder "Advantage+ مثال: مصر — 21-45 — جمهور".
- Card "التحويل" / "أين تريد تحقيق النتائج؟" / "مكان التحويل" radio cards (engagement):
  على إعلانك (احصل على مزيد من التفاعل مع المنشور أو مشاهدات الفيديو.) / صفحة فيسبوك (نمِّ إعجابات الصفحة والتفاعل.) /
  ماسنجر (ابدأ محادثات في ماسنجر.) / WhatsApp (ابدأ محادثات في واتساب.) / إنستجرام (ابدأ محادثات في إنستجرام دايركت.) /
  Messenger, Instagram & WhatsApp (Start conversations in whichever app people prefer.) / الموقع الإلكتروني (احصل على زوار متفاعلين على موقعك.)
  "هدف الأداء" select (goal labels in English, filtered by objective) + link "عرض المزيد من الخيارات ⌄".
- Card "الميزانية والجدولة": segmented الميزانية اليومية | ميزانية مدى الحياة, amount input with currency suffix "USD", placeholder 0.00;
  تاريخ البدء / تاريخ الانتهاء (datetime-local); hint "اختياري مع الميزانيات اليومية."
- Card "الجمهور" / "حدّد من تريد أن يرى إعلاناتك." + button "حفظ الجمهور".
  المواقع: Leaflet/OSM map with "وضع دبوس" button and zoom, link "إخفاء الخريطة", search "بحث عن دول أو مناطق أو مدن...",
  location type select (الأشخاص المقيمون في هذا الموقع أو كانوا فيه مؤخرًا / الأشخاص المقيمون في هذا الموقع / الأشخاص الذين كانوا في هذا الموقع مؤخرًا), link "+ إضافة مواقع دفعة واحدة".
  Toggle card "جمهور Advantage+" (sparkle icon) — "اسمح لـ Meta بالعثور على جمهورك تلقائيًا، مع اعتبار الإعدادات أدناه اقتراحات. موصى به."
  note: "العمر والجنس والاستهداف التفصيلي أدناه تُعامَل كاقتراحات — قد تتجاوزها Meta (يُحترم الموقع والحد الأدنى للعمر دائمًا)."
  العمر: two selects 13..65 / 13..65+ (default 18 — 65+); الجنس segmented الكل | رجال | نساء.
  "الاستهداف التفصيلي (اقتراحات)" search "أضف اهتمامات (مثل السفر، التسوق عبر الإنترنت)..." + link "+ استبعاد".
  اللغات search "كل اللغات" — "اتركه فارغًا للوصول إلى الأشخاص بجميع اللغات."
- Card "المواضع" / "اختر أين يظهر إعلانك عبر تقنيات Meta.":
  radio "مواضع Advantage+ (مُوصى بها)" (sparkle) — "تُوزَّع ميزانيتك على كل المواضع التي يُرجَّح أن تحقق فيها أفضل أداء."
  radio "مواضع يدوية" — "اختر المنصات وأماكن الظهور بنفسك. قد يحد ذلك من العرض."
  Manual → "الأجهزة" select (كل الأجهزة / الجوال فقط / كمبيوتر فقط); "المنصات" = one bordered box per platform with checkbox + "كل المواضع" hint, positions grouped in 2 columns:
   Facebook: الموجز[آخر أخبار فيسبوك, موجز الملف الشخصي على فيسبوك, فيسبوك ماركت بليس, موجز فيديوهات فيسبوك, العمود الأيمن في فيسبوك] القصص والريلز[قصص فيسبوك, ريلز فيسبوك] إعلانات أثناء العرض[فيديوهات فيسبوك أثناء العرض] نتائج البحث[نتائج بحث فيسبوك]
   إنستجرام: الموجز[موجز إنستجرام, موجز الملف الشخصي على إنستجرام, استكشاف إنستجرام, الصفحة الرئيسية لاستكشاف إنستجرام] القصص والريلز[قصص إنستجرام, ريلز إنستجرام] نتائج البحث[نتائج بحث إنستجرام]
   Audience Network: التطبيقات والمواقع[Audience Network أصلي وبانر وبيني, فيديوهات المكافآت في Audience Network]
   ماسنجر: الرسائل[صندوق وارد ماسنجر] القصص والريلز[قصص ماسنجر]
  hint "اترك المواضع دون تحديد للعرض في جميع مواضع المنصات المختارة."
- "عرض المزيد من الخيارات" under هدف الأداء reveals: "استراتيجية المزايدة" select (أعلى حجم=LOWEST_COST_WITHOUT_CAP / هدف التكلفة لكل نتيجة=COST_CAP / حد المزايدة=LOWEST_COST_WITH_BID_CAP)
  and "متى يتم محاسبتك" select (billing events: IMPRESSIONS, LINK_CLICKS, VIDEO_VIEWS, THRUPLAY, POST_ENGAGEMENT, PAGE_LIKES, APP_INSTALLS).
- Engagement goals offered: Reach, Impressions, Link Clicks, Landing Page Views, Post Engagement, Page Likes, Video Views, ThruPlay, Conversions(OFFSITE_CONVERSIONS), Conversations, Replies.

### Step 3 — Ad (footer primary button becomes green "✓ نشر")
- "اسم الإعلان" placeholder "مثال: تخفيضات الصيف — فيديو أ".
- Card "الهوية" / "اختر كيف يظهر نشاطك التجاري في الإعلان.": صفحة فيسبوك (fb icon box; "لا توجد صفحة مرتبطة" when none), حساب Instagram (ig icon, "استخدام صفحة Facebook" + checkbox "استخدام").
- Card "إعداد الإعلان" → "التنسيق": radio cards "صورة واحدة أو فيديو" (صورة واحدة أو فيديو واحد في إعلانك.) / "عرض دائري" (صورتان أو أكثر أو مقاطع فيديو قابلة للتمرير.).
- Card "تصميم الإعلان" / "أضف الوسائط والنصوص لإعلانك.":
  single: "الوسائط" two dashed tiles "إضافة صورة" / "إضافة فيديو"; hint "الموصى به: 1080×1080 (الفيد) أو 1080×1920 (Stories/Reels). JPG أو PNG، حتى 30MB."
  carousel: "بطاقات العرض الدائري" — 2 cards by default, each = dashed image tile + "العنوان الرئيسي" + "رابط الموقع (اختياري، يستخدم رابط الإعلان)"; link "+ إضافة بطاقة".
  "النص الأساسي" textarea placeholder "أخبر الناس عن موضوع إعلانك..." counter 0/125; link "+ إضافة خيار نص"; hint "يُنشر النص الأول مع الإعلان، وتُحفظ الخيارات الإضافية لصيغ لاحقة."
  "العنوان الرئيسي" (placeholder "عنوان قصير", 0/40) | "الوصف" (placeholder "وصف اختياري", 0/27)
  "الحث على اتخاذ إجراء" select (filtered by objective; engagement: معرفة المزيد، إرسال الرسالة، شاهد المزيد، يشترك، انظر القائمة، تواصل معنا، احصل على العرض، لا زر) | "رابط الموقع الإلكتروني" placeholder https://example.com/landing
  "عرض المزيد من الخيارات" → "الرابط المعروض" (placeholder "الرابط الذي يراه الناس، مثل: example.com/offer"), "معاملات URL" (placeholder utm_source=facebook&utm_medium=paid&utm_campaign={{campaign.name}}; hint "تُضاف إلى رابط موقعك للتتبع. مثال: utm_source=facebook&utm_medium=paid").
- Toggle card "تصميم Advantage+" — "اسمح لـ Meta بتحسين الوسائط والنص تلقائيًا عندما يُرجَّح أن يحسّن ذلك الأداء (تحسينات قياسية)."
- Card "التتبع" / "تتبّع التحويلات المهمة لنشاطك التجاري." → "أحداث الموقع الإلكتروني" ("لا يوجد Pixel مُعدّ على هذا الحساب الإعلاني." when none).
- Left: "معاينة الإعلان" — Facebook feed mock: avatar, "صفحتك" "ممول · 🌐", ⋯; media area ("أضف وسائط لمعاينة إعلانك"); link bar "EXAMPLE.COM" + CTA button; إعجاب / تعليق / مشاركة. Carousel preview = horizontal scroll cards.
- Wizard autosaves drafts on every change; drafts appear in Ads Manager lists (status مسودة, toggle "—", row actions تعديل / تكرار / حذف المسودة).
- Footer issue counter "⚠ N مشكلة بحاجة إلى إصلاح"; tree nodes show ⚠ when their step has issues.

## Ads Manager — more
- Row hover actions (left end): edit ✎, duplicate ⧉, delete 🗑 (drafts); live rows: charts 📊, edit, duplicate.
- Date preset select: كل الأوقات / آخر 7 أيام / آخر 30 أيام / آخر 90 أيام.
- Column presets menu: الأداء (all) / العرض (delivery, objective, budget, end) / التفاعل (delivery, results, reach, impressions); then "تخصيص الأعمدة" checklist: العرض، الهدف، الميزانية، النتائج، مدى الوصول، مرات الظهور، الإنفاق، الانتهاء.
- Ad sets tab columns: تشغيل/إيقاف، المجموعة الإعلانية (name + parent campaign under it)، العرض، هدف الأداء، الميزانية ("ميزانية الحملة" when CBO)، النتائج، مدى الوصول، مرات الظهور، الإنفاق، الانتهاء.
- Ads tab columns: تشغيل/إيقاف، الإعلان (thumb + name + ad set under)، العرض، التصميم، النتائج، مدى الوصول، مرات الظهور، الإنفاق. Numbers compact ("29.7 ألف"), money "342.95 USD".
- Charts drawer (left side panel ~575px): "عرض الرسوم البيانية" + entity name; "الأداء اليومي" dual-axis line chart (النتائج green left axis, الإنفاق blue right axis, x = MM-DD);
  "التقسيم" select (العمر / الجنس / المنصة / البلد) + breakdown chart; empty "لا توجد بيانات لهذه الفترة بعد. قم بالمزامنة لعرض الرسوم البيانية."
- Automated rules modal "⚡ القواعد التلقائية": empty "لا توجد قواعد تلقائية بعد. أنشئ قاعدة لإيقاف الإعلانات أو تعديلها تلقائيًا." + "+ إنشاء قاعدة".
  Form: اسم القاعدة; تطبيق على (الحملات/المجموعات الإعلانية/الإعلانات); الفترة الزمنية (آخر 1 أيام/آخر 7 أيام/آخر 30 أيام/كل الأوقات);
  الشرط: metric (المبلغ المُنفَق spend / النقرات / مرات الظهور / مدى الوصول / تكلفة النقرة / CTR %) + (أكبر من/أقل من) + value;
  عندئذ: (إيقافه مؤقتًا / تفعيله / الإشعار فقط); hint "يتم الفحص تلقائيًا كل 15 دقيقة"; buttons إلغاء / حفظ القاعدة. Rows: toggle, run-now, delete.

## Connect page — centralized onboarding
Card: logo; chips "CHANNEL Meta Ads" ··· "CONNECTING TO <tenant domain>"; "Connect Meta Ads"; "Manage campaigns, leads and audiences from your CRM.";
checklist: Read campaign and audience performance / Bring lead-form submissions in as contacts / Connect every ad account in one step / Requires admin access to the ad account;
gradient button "Continue with Facebook"; "Facebook will ask which ad accounts to share."; footer "🔒 Secured by …". (Ref redirects to a central app domain — one Meta app for all tenants.)

## Record pages (list grid + detail form: action buttons + smart count buttons)
- Ad accounts: list [اسم الحساب, معرّف الحساب الإعلاني, العملة, الحالة, المنطقة الزمنية].
  Smart: الرؤى, الحملات, نماذج العملاء المحتملين, الجماهير. Actions: Sync Campaigns, Sync Insights, Sync Page Insights, Subscribe Webhook, Subscribe Ads Webhooks, Sync Info.
  Fields: اسم الحساب, معرّف الحساب الإعلاني, رمز وصول المستخدم (secret), معرّف التطبيق, سر التطبيق (secret), معرّف النشاط التجاري, رمز التحقق من Webhook,
  حقول الويب هوك المشترك بها (JSON), تاريخ الاشتراك في الويب هوك, الحالة, العملة, المنطقة الزمنية, معرّف البكسل الافتراضي, معرّف التطبيق الافتراضي, رابط متجر التطبيقات, المشرفين, المستخدمون;
  "Linked Page / Instagram": الصفحة, معرّف الصفحة, اسم مستخدم إنستجرام, معرّف مستخدم انستجرام.
- Campaigns: list [اسم الحملة, الهدف, الحالة, الحالة الفعالة, الميزانية اليومية, حساب إعلاني]. Smart: الرؤى, المجموعات الإعلانية, CRM Leads.
  Actions: Push to Meta, Update on Meta, Delete on Meta, إنشاء مجموعة إعلانية, Sync Ad Sets, إيقاف مؤقت, تفعيل.
  Fields: اسم الحملة, معرّف الحملة, حساب إعلاني, الهدف, الحالة, الحالة الفعالة, Chat Team, الميزانية اليومية, الميزانية الإجمالية, استراتيجية المزايدة, وقت البداية, وقت الانتهاء, تاريخ الإنشاء/التحديث في Meta.
  Tab "AI Instructions": rows [الرسالة, تاريخ الانتهاء] + إضافة صف (extra instructions for the AI agent when a chat comes from this campaign).
- Ad sets: list [AD SET NAME, الحالة, الحالة الفعالة, الميزانية اليومية, هدف التحسين, الحملة]. Smart: الرؤى, الإعلانات, CRM Leads.
  Actions: Push to Meta, Update on Meta, إنشاء إعلان, إنشاء تصميم, Sync Ads, إيقاف مؤقت, تفعيل. Fields: name, id, campaign, status, effective, Chat Team, هدف التحسين, حدث الفوترة, start/end, meta dates. Tabs: Targeting & Placements (JSON), AI Instructions.
- Ads: list [AD NAME, الحالة, الحالة الفعالة, المجموعة الإعلانية, معرّف التصميم]. Smart: الرؤى, التصميم, CRM Leads, نقرات الإعلان.
  Actions: إنشاء تصميم, Push to Meta, Update on Meta, إيقاف مؤقت, تفعيل. Fields: name, id, ad set, status, effective, Chat Team, التصميم, معرّف التصميم, meta dates. Tabs: بيانات التصميم (JSON), AI Instructions.
- Ad events (webhook log): [وقت الحدث, الخطورة, WEBHOOK, الملخص, حساب إعلاني, نوع الكائن, الحملة, الإعلان, معرّف الكائن, تم الإشعار, تمت المعالجة].
- Lead forms: [FORM NAME, الحالة, العملاء المحتملون, WEBHOOK, حساب إعلاني] — synced from Meta (no manual create).
- Leads: [الاسم, البريد, الهاتف, الحالة, عميل محتمل CRM, تم الإنشاء].
- Audiences: [AUDIENCE NAME, النوع الفرعي, APPROX. COUNT, الحالة, حساب إعلاني].
- Creatives: [CREATIVE NAME, النوع, معرّف التصميم, معرّف الصفحة, حساب إعلاني]. Action Push to Meta; fields: Creative Name, معرّف التصميم, حساب إعلاني, النوع الإبداعي,
  معرّف الصفحة, معرّف مستخدم انستجرام, Primary Text, Destination URL, دعوة إلى التصرف, بصمة الصورة, معرّف الفيديو; tabs صورة / فيديو / بطاقات دائري / Raw Response.
- Ad insights: [المستوى, معرّف الكائن, حساب إعلاني, مرات الظهور, مدى الوصول, النقرات, الإنفاق, نسبة النقر, CPC, CPM, تكرار, تاريخ البدء, تاريخ الانتهاء, تمت المزامنة] — one row per object per day.
- Page insights: [الصفحة, معرّف الصفحة, المقياس, الفترة, القيمة, تاريخ البدء, تاريخ الانتهاء, حساب إعلاني, تمت المزامنة].
- Ad clicks (click-to-message attribution): [تاريخ النقر, قناة, عميل محتمل, تواصل معنا, عنوان الإعلان, الحملة, المجموعة الإعلانية, الإعلان, الإسناد (تم حلها / الإعلان غير معروف), معرّف الإعلان, أول تفاعل, VIEW AD].
  Form: عنوان الإعلان; "Ad Click / الإسناد": عميل محتمل, تواصل معنا, قناة, تاريخ النقر, الحملة, المجموعة الإعلانية, الإعلان, حساب إعلاني, الإسناد;
  "Ad Content": النص الأساسي, معرّف الإعلان, معرّف المشاركة, نوع المصدر, View Ad, الوسائط, مرجع مخصص, معرّف النقرة (ctwa_clid).
- Conversion datasets: [قناة, البيان, معرّف كائن الأعمال, معرّف مجموعة البيانات, مفعّل, الصلاحية, الصلاحية المطلوبة, LAST EVENT, حالات الفشل].
- Conversion events (CAPI log): [وقت الحدث, الحدث, الحالة, قناة, عميل محتمل, مجموعة البيانات, المحاولات, خطأ, وقت الإرسال].
- Competitors: [منافس, معرّف الصفحة, إنستجرام, البلد, ADS TRACKED, نشط, LAST SCANNED].
- Competitor ads: [منافس, العنوان الرئيسي, التنسيق, CTA, الذكاء الاصطناعي: الزاوية, لا يزال يعمل, أيام التشغيل, بدأ, آخر ظهور].
  Form: العنوان الرئيسي; الإعلان: منافس, معرّف أرشيف الإعلان, اسم الصفحة, نص الرسالة, دعوة إلى التصرف, عنوان الرابط, صيغة العرض, المنصات, عناوين URL للوسائط;
  "Tracking & AI Analysis": لا يزال يعمل, بدأ الإعلان, انتهى الإعلان, أيام التشغيل, أول ظهور, آخر ظهور, الذكاء الاصطناعي: الزاوية / العرض / الجملة الجاذبة / الملخص.
- Optimization goals: [الاسم, الرمز, الأهداف المسموح بها] (16 rows). Billing events: [الاسم, الرمز, أهداف التحسين] (7 rows).
