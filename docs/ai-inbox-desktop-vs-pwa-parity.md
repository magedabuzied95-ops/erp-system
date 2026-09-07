# AI Inbox — مقارنة الديسكتوب (`/admin/ai-inbox`) مقابل الـ PWA (`/inbox`)

مرجع الملفات:

- ديسكتوب: `src/modules/aiSupport/pages/AiInbox.jsx` (11,313 سطر)
- PWA: `src/modules/aiSupport/pages/AiInboxPwa.jsx` (7,162 سطر)

> **مهم:** جزء كبير من ملف الديسكتوب **كود ميت**. الـ `return` الحيّ يبدأ عند
> السطر 10078 وينتهي عند 10720؛ الـ `return` الثاني (10721 → آخر الملف) غير قابل
> للوصول، و`RightToolsTabsPanel` كله محجوب خلف `showLegacyProfileOverlay = false`
> (سطر 5535). المقارنة أدناه تفرّق بين **حيّ** و**ميت** حتى لا نهاجر ميزات لا
> تعمل أصلًا على الديسكتوب.

---

## 1) ما هو حيّ على الديسكتوب وناقص في الـ PWA

| # | الميزة | مكانها في الديسكتوب | الحالة في الـ PWA |
|---|--------|--------------------|-------------------|
| 1 | **شريط القنوات الجانبي** (`InboxChannelSidebar`) مع عدّاد غير المقروء لكل قناة | 10241 | ✗ لا يوجد — الـ PWA يفلتر بـ chips نصية فقط |
| 2 | **فلتر الحساب** (رقم واتساب / صفحة بعينها داخل القناة) | `accountFilter` 6344 | ✗ |
| 3 | **المفضلة**: نجمة على الكارت + فلتر "المفضلة فقط" | `toggleConversationFavorite` 7143 | ✗ |
| 4 | **مقروء/غير مقروء**: فلتر ثلاثي + تبديل يدوي على الكارت | `toggleConversationRead` 7179 | ✗ (يعرض العدّاد فقط) |
| 5 | **تعليم الكل كمقروء** (بنطاق القناة المختارة + تأكيد) | `markAllConversationsRead` 7237 | ✗ |
| 6 | **تحميل المزيد** (ترقيم صفحات المحادثات بـ cursor) | `loadMoreConversations` 8734 | ✗ — الـ PWA يجلب 200 صف ويقف |
| 7 | **لِيبلات المحادثة** (تعديل + مودال) | `updateConversationLabels` 8302 | ✗ |
| 8 | **Sync Meta** — سحب محادثات ماسنجر/إنستجرام القديمة | `syncMetaConversations` 7351 | ✗ |
| 9 | **إعدادات التعليقات** (`CommentsSettings`) | `renderCommentsSettingsModal` | ✗ |
| 10 | **محرّر صيغ رسائل الفاتورة/الإيصال على واتساب** | `renderInvoiceMessagesModal` | ✗ |
| 11 | **مركز التكاملات** (`IntegrationsCenter`, lazy) | `renderIntegrationsCenter` | ✗ |
| 12 | **مودال تصحيح رد الذكاء الاصطناعي** من رسالة في الـ transcript | `ReplyCorrectionModal` 10128 | جزئي — الـ PWA يحفظ التصحيح عند تعديل المسودة فقط، بدون مودال |
| 13 | **منشئ الأوردر الكامل**: سلة متعددة الأسطر، خصم (مبلغ/نسبة)، طريقة الدفع، تسعيرة الشحن + تعديل يدوي، العناوين المحفوظة | `InboxOrderComposer` 3784 | ناقص — `PwaOrderComposer` منتج واحد فقط، بدون خصم/دفع/تسعيرة/عناوين محفوظة |
| 14 | **ProductCardPicker** بأوضاع `orderMode` و`restockMode` | 10112 | جزئي — الـ PWA يستخدمه لـ `availableBySize` فقط |
| 15 | **اقتراح AI متقدّم**: اختيار كارت منتج، اختيار اللون، ترشيحات متعددة، إزالة/تغيير المنتج، صيغة التسليم | `ManualReplyComposer` | جزئي — الـ PWA عنده تعديل/موافقة/تجاهل فقط |
| 16 | **Customer360 + اختيار منتج لطلب التوفير (restock)** | `restockPick` | ✗ (الدرج موجود بدون restock) |
| 17 | **SocialCommentsWorkspace الكامل**: إعدادات ردّ عامة، تمبلت لكل بوست، إرسال رد آلي، فلتر منصّة للبوستات والتعليقات | 10380 | جزئي — الـ PWA يستخدم `SocialCommentsPanel` + fast-list |
| 18 | **إنشاء عميل من المحادثة** (زر في شريط التجارة) | `createLeadCustomer` | الدالة موجودة في الـ PWA (5681) لكن **غير موصولة بأي زر** |
| 19 | **نسخ/تحميل مسودة الرد + مسودة رد التعليق** | `onCopyDraft` / `onLoadDraft` | ✗ |
| 20 | **Deep link** `?conversation=&channel=` عبر `inboxDeepLink` | 5537 | مختلف — الـ PWA يستخدم `/inbox/:id?tab=` |

---

## 2) ميت على الديسكتوب (لا يُهاجَر)

كلها داخل `showLegacyProfileOverlay=false` أو بعد الـ `return` غير القابل للوصول:

`RightToolsTabsPanel` (تبويبات customer/ai/orders/notes) · `CustomerProfilePanel` ·
`ConversationActions` · `AutoReplyModePanel` · `RecommendationsPanel` ·
`SalesCloserPanel` · `SalesIntelligencePanel` · `OrderDraftPanel` / `DraftCard` ·
`AiTraceModal` (لا يوجد زر يفتحه) · `AILiveLogs` / dev console (زر الفتح في الفرع الميت) ·
`AiDebugPanel` · KPI metrics · لوحة lead pipeline · قسم الفلاتر القديم ·
`/ai-agent/analytics` · `/ai-agent/orders/*` · `/employees`.

---

## 3) موجود في الـ PWA وناقص على الديسكتوب

| الميزة | الملاحظة |
|--------|----------|
| مبدّل الثيم (فاتح/داكن) | `useTheme` + زر في الهيدر |
| تثبيت التطبيق (PWA install prompt) + service worker | `installPrompt`, `inbox-sw.js` |
| كاش IndexedDB للمحادثات | `inboxCache` (موجود بالاسم في الديسكتوب لكن بمسار مختلف) |
| فلاتر المنتجات الذكية داخل شيت المنتجات | `SmartPosFilters` + `useProductClassifications` |
| `PostProductLinksDrawer` — ربط منتجات بالبوست | ✗ على الديسكتوب |
| `social-comments/fast-list` + ترقيم بـ cursor | الديسكتوب يجلب `posts?limit=200` |
| قائمة الـ Leads بأدلوات funnel | `LeadsView` |
| كارت حالة الـ Lead + قائمة تغييرها في هيدر المحادثة | ✗ على الديسكتوب |
| قائمة overflow في الهيدر (تشغيل/إيقاف AI عام + لكل محادثة) | الديسكتوب عنده toggle المحادثة فقط |
| عنوان الصفحة `buildPageTitle` | — |

---

## 4) حالة التنفيذ — المراحل الستة اتنفذت

| المرحلة | الحالة | كيف |
|---------|--------|-----|
| 1. تحكّم القائمة | ✅ | جلب عادل لكل قناة (`channelsForFilter`/`channelWindow`/`mergeConversationPages`)، cursor لكل قناة + "تحميل المزيد"، مفضلة، مقروء/غير مقروء، تعليم الكل، فلتر الحساب، عدّادات على chips المنصّات، Sync Meta |
| 2. الأوردر | ✅ | `components/InboxOrderComposer.jsx` — **مكوّن واحد** للسطحين؛ `PwaOrderComposer` اتشال |
| 3. الاقتراح الذكي | ✅ | `components/AiSuggestionCard.jsx` مشترك (كروت/ألوان/ترشيحات/إزالة/تغيير) + `components/ReplyCorrectionModal.jsx` مشترك موصول بالـ transcript |
| 4. الإعدادات | ✅ | تبويب Config بقى Settings sheet: الردود السريعة، إعدادات التعليقات، صيغ رسائل الفاتورة، مركز التكاملات (lazy) |
| 5. التعليقات | ✅ | فلتر منصّة للبوستات وللتعليقات جوه الثريد |
| 6. متفرقات | ✅ | `components/ConversationLabelsModal.jsx` مشترك + شرائح اللِيبل في هيدر المحادثة، زر إنشاء العميل، restock في Customer 360 |

المبدأ اللي اتّبع: بدل نسخ الكود من صفحة للتانية، الميزة بتطلع لمكوّن مشترك
والسطحين يستوردوه — عشان أي إصلاح جاي ينزل على الاتنين مرة واحدة.

## 5) خطة الترحيل الأصلية (للمرجع)

1. **تحكّم القائمة** — شريط القنوات، فلتر الحساب، المفضلة، مقروء/غير مقروء،
   تعليم الكل، تحميل المزيد، Sync Meta. *(أعلى قيمة تشغيلية، إضافات صرفة)*
2. **الأوردر** — ترقية `PwaOrderComposer` لمستوى `InboxOrderComposer`
   (سلة متعددة، خصم، دفع، تسعيرة شحن + override، عناوين محفوظة).
3. **الاقتراح الذكي** — كروت/ألوان/ترشيحات + مودال التصحيح + نسخ/تحميل المسودة.
4. **الإعدادات** — إعدادات التعليقات، صيغ رسائل الفاتورة، مركز التكاملات
   (كلها lazy حتى لا تثقل الـ bundle).
5. **التعليقات** — إعدادات الرد العامة، تمبلت البوست، الرد الآلي، فلاتر المنصّة.
6. **متفرقات** — اللِيبلات، زر إنشاء العميل، restock في Customer360.

### قيود واجبة أثناء الترحيل

- الهيلبرز المشتركة تروح `src/modules/aiSupport/lib/conversationHelpers.js`
  وإلا يفشل `tests/ai-inbox-shared-helpers.test.js` (سقف 45 تكرار).
- `firstNonEmpty` **ليست** متطابقة بين الملفين — لا تفترض التطابق من الشكل.
- كل نص جديد يمرّ على `t()` في namespace `translation` الوحيد.
- عند أي تغيير في الـ shell: ارفع `VERSION` في `public/inbox-sw.js` و`?v=` في
  تسجيل الـ service worker، وإلا يفضل العميل على bundle قديم.
