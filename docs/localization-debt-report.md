# Localization Debt Report

Generated: 2026-06-12T15:23:21.505Z

This report flags obvious hardcoded UI strings. It is intentionally conservative and may include false positives.

## accounting (160)

### src\modules\accounting\pages\Accounts.jsx
- 231 [jsx-text] شجرة الحسابات
- 232 [jsx-text] الحسابات الافتراضية تُنشأ مرة واحدة فقط لكل مستأجر بدون تكرار.
- 252 [jsx-text] جارٍ تحميل الحسابات...
- 254 [jsx-text] لا توجد حسابات مطابقة للبحث.
- 260 [jsx-text] الكود
- 261 [jsx-text] اسم الحساب
- 262 [jsx-text] النوع
- 263 [jsx-text] الحساب الأب
- 264 [jsx-text] الحالة
- 265 [jsx-text] تاريخ الإنشاء
- 343 [jsx-text] دفتر الأستاذ
- 349 [jsx-text] لا توجد حركات ضمن الفلاتر الحالية.
- 240 [placeholder] ابحث بالكود أو الاسم
- 156 [title] دليل الحسابات
- 157 [title] أساس محاسبي أولي مبني على Chart of Accounts مع الإبقاء على دفتر الأستاذ الحالي
- 210 [title] تعذر تحميل الحسابات
- 318 [title] جارٍ تحميل دفتر الأستاذ
- 323 [title] تعذر تحميل دفتر الأستاذ
- 222 [prop-label] إجمالي الحسابات
- 223 [prop-label] الحسابات النشطة
- 224 [prop-label] حسابات الأصول
- 225 [prop-label] حسابات المصروفات

### src\modules\accounting\pages\Expenses.jsx
- 873 [jsx-text] Cancel
- 1284 [jsx-text] No trend data
- 1355 [jsx-text] Confirm action
- 1360 [jsx-text] Cancel
- 1241 [title] Edit
- 1276 [title] Monthly expense trend
- 604 [toast] Expense title and amount are required
- 666 [toast] Action completed
- 675 [toast] Category name is required
- 678 [toast] Category created
- 683 [toast] Employee and amount are required
- 686 [toast] Employee advance created
- 697 [toast] Recurring title and amount are required
- 700 [toast] Recurring expense created

### src\modules\accounting\pages\GeneralLedger.jsx
- 192 [jsx-text] جارٍ تحميل الحركات...
- 194 [jsx-text] اختر حسابًا لعرض دفتر الأستاذ العام.
- 196 [jsx-text] لا توجد حركات ضمن الفلاتر الحالية.
- 202 [jsx-text] التاريخ
- 203 [jsx-text] القيد
- 204 [jsx-text] المرجع
- 205 [jsx-text] الوصف
- 206 [jsx-text] مدين
- 207 [jsx-text] دائن
- 208 [jsx-text] الرصيد الجاري
- 166 [placeholder] اختياري
- 113 [title] General Ledger
- 114 [title] دفتر الأستاذ العام مبني مباشرة على الحسابات والقيود اليومية وسطور القيود
- 144 [prop-label] الحساب
- 159 [prop-label] من تاريخ
- 162 [prop-label] إلى تاريخ
- 165 [prop-label] الفرع
- 179 [prop-label] الرصيد الافتتاحي
- 180 [prop-label] إجمالي المدين
- 181 [prop-label] إجمالي الدائن
- 182 [prop-label] الرصيد الختامي

### src\modules\accounting\pages\JournalEntries.jsx
- 411 [jsx-text] Manual Journal Entry
- 412 [jsx-text] القيد غير المتوازن سيرفض من الباك إند قبل الحفظ.
- 441 [jsx-text] الحساب
- 442 [jsx-text] مدين
- 443 [jsx-text] دائن
- 444 [jsx-text] ملاحظات
- 445 [jsx-text] حذف
- 453 [jsx-text] اختر الحساب
- 497 [jsx-text] Backfill Preview
- 498 [jsx-text] هذه الشاشة تعرض القيود المقترحة فقط ولا تنفذ أي posting فعلي.
- 504 [jsx-text] الكل
- 505 [jsx-text] Orders
- 506 [jsx-text] Purchases
- 507 [jsx-text] Expenses
- 539 [jsx-text] لا توجد نتائج معاينة حتى الآن.
- 545 [jsx-text] المصدر
- 546 [jsx-text] الوصف
- 547 [jsx-text] التاريخ
- 548 [jsx-text] المدين
- 549 [jsx-text] الدائن
- 550 [jsx-text] الحالة
- 551 [jsx-text] السبب
- 240 [title] قيود اليومية مع إدخال يدوي ومعاينة Backfill فقط بدون تشغيل تلقائي
- 89 [toast] فشل تحميل القيود اليومية
- 120 [toast] تعذر تحميل تفاصيل القيد
- 194 [toast] تم إنشاء القيد بنجاح
- 415 [prop-label] إجمالي المدين
- 416 [prop-label] إجمالي الدائن
- 417 [prop-label] الحالة
- 422 [prop-label] الوصف
- 425 [prop-label] التاريخ
- 428 [prop-label] الفرع
- 433 [prop-label] ملاحظات
- 502 [prop-label] المصدر
- 510 [prop-label] من تاريخ
- 513 [prop-label] إلى تاريخ
- 516 [prop-label] الحد الأقصى
- 528 [prop-label] إجمالي العناصر
- 529 [prop-label] جاهزة
- 530 [prop-label] متخطاة
- ... 1 more

### src\modules\accounting\pages\Treasury.jsx
- 174 [jsx-text] Account Balances
- 175 [jsx-text] Operational money accounts used by POS, purchases, expenses, refunds, and payroll.
- 193 [jsx-text] Recharge
- 194 [jsx-text] Opening
- 195 [jsx-text] Transfer in
- 205 [jsx-text] Transfer Money
- 211 [jsx-text] Record Transfer
- 216 [jsx-text] Manual Adjustment
- 220 [jsx-text] Money in
- 221 [jsx-text] Money out
- 225 [jsx-text] Record Adjustment
- 234 [jsx-text] Money Transactions
- 235 [jsx-text] Immutable account movements from sales, purchases, expenses, advances, refunds, transfers, and adjustments.
- 243 [jsx-text] Filter
- 254 [jsx-text] Date
- 255 [jsx-text] Account
- 256 [jsx-text] Type
- 257 [jsx-text] Reference
- 259 [jsx-text] Out
- 260 [jsx-text] Balance
- 207 [placeholder] From account
- 208 [placeholder] To account
- 209 [placeholder] Amount
- 210 [placeholder] Notes
- 218 [placeholder] Account
- 223 [placeholder] Amount
- 224 [placeholder] Audit note
- 238 [placeholder] All accounts
- 239 [placeholder] Type
- 240 [placeholder] Reference
- 241 [placeholder] Branch
- 134 [title] Treasury
- 135 [title] Real cash, bank, card, wallet, and settlement balances backed by linked money transactions.
- 85 [toast] Choose source, destination, and a positive amount
- 92 [toast] Transfer recorded
- 104 [toast] Choose an account and a positive amount
- 111 [toast] Adjustment recorded
- 145 [prop-label] Total Cash
- 146 [prop-label] Total Bank
- 147 [prop-label] Wallets
- ... 4 more

### src\modules\accounting\pages\TrialBalance.jsx
- 136 [jsx-text] يعتمد هذا التقرير فقط على `journal_entry_lines` المربوطة بقيود اليومية.
- 140 [jsx-text] جارٍ تحميل ميزان المراجعة...
- 142 [jsx-text] لا توجد أرصدة ضمن الفترة الحالية.
- 148 [jsx-text] كود الحساب
- 149 [jsx-text] اسم الحساب
- 150 [jsx-text] نوع الحساب
- 151 [jsx-text] إجمالي المدين
- 152 [jsx-text] إجمالي الدائن
- 168 [jsx-text] الإجمالي
- 113 [placeholder] اختياري
- 75 [title] Trial Balance
- 76 [title] ميزان مراجعة مبني فقط على الحسابات والقيود اليومية وسطور القيود
- 106 [prop-label] من تاريخ
- 109 [prop-label] إلى تاريخ
- 112 [prop-label] الفرع
- 126 [prop-label] إجمالي المدين
- 127 [prop-label] إجمالي الدائن
- 128 [prop-label] الحالة

## inventory (302)

### src\modules\inventory\pages\InventoryCount.jsx
- 324 [jsx-text] 0 && (currentRank === 0 || candidateRank
- 382 [jsx-text] 0 && (currentRank === 0 || candidateRank
- 1115 [jsx-text] toNumber(item.difference_quantity, 0)
- 1270 [jsx-text] البحث ومسح الباركود
- 1271 [jsx-text] ابحث بالباركود أو رمز الصنف، وإذا كان التطابق مباشرًا ستُضاف القطعة تلقائيًا.
- 1313 [jsx-text] الموديل المحدد
- 1353 [jsx-text] جاري تحميل جلسة الجرد...
- 1358 [jsx-text] لا توجد أصناف بعد
- 1359 [jsx-text] ابدأ بالمسح أو البحث ثم أضف اللون إلى الجرد.
- 1388 [jsx-text] بيانات الجلسة
- 1404 [jsx-text] ملاحظات الجلسة
- 1416 [jsx-text] عدد المجموعات
- 1420 [jsx-text] إجمالي الفروق
- 1427 [jsx-text] إرشادات
- 1429 [jsx-text] • استخدم الماسح أو البحث السريع لإضافة قطعة مباشرة عند التطابق الدقيق.
- 1430 [jsx-text] • البحث باسم المنتج يعرض كروت مجمعة حسب المنتج واللون فقط.
- 1431 [jsx-text] • زر إضافة اللون للجرد يضيف كل المقاسات مرة واحدة بقيم فعلية صفرية.
- 1432 [jsx-text] • مطابقة السيستم وتصفير اللون يعملان على كل المقاسات داخل اللون.
- 1433 [jsx-text] • حذف اللون يتركه مطابقًا للسيستم حتى لا ينتج عنه فرق عند الاعتماد.
- 1452 [jsx-text] جلسات الجرد
- 1453 [jsx-text] راجع الجلسات الحالية وافتح أي جلسة لمتابعة الأصناف أو اعتماد الفروقات.
- 1516 [jsx-text] جاري تحميل جلسات الجرد...
- 1521 [jsx-text] لا توجد جلسات جرد بعد
- 1522 [jsx-text] ابدأ جردًا جديدًا ثم افتحه للمسح أو الاعتماد.
- 1752 [jsx-text] مطابقة السيستم
- 1753 [jsx-text] تصفير
- 1754 [jsx-text] حذف اللون
- 1774 [jsx-text] 0 ? "text-emerald-300" : diff
- 1782 [jsx-text] السيستم
- 1783 [jsx-text] الفعلي
- 1784 [jsx-text] الفرق
- 1785 [jsx-text] السبب
- 1786 [jsx-text] ملاحظات
- 1812 [jsx-text] 0 ? "text-rose-300" : group.difference_total
- 1817 [jsx-text] مطابقة
- 1817 [jsx-text] تصفير
- 1817 [jsx-text] حذف اللون
- 1826 [jsx-text] 0 ? "text-rose-300" : diff
- 1847 [jsx-text] مقاس
- 1847 [jsx-text] المتوقع
- ... 71 more

### src\modules\inventory\pages\InventoryDashboard.jsx
- 69 [jsx-text] (Number(stock || 0)
- 828 [jsx-text] إجمالي المخزون
- 832 [jsx-text] إجمالي القيمة
- 836 [jsx-text] الحالة
- 854 [jsx-text] المقاس
- 856 [jsx-text] المخزون
- 857 [jsx-text] القيمة
- 858 [jsx-text] الحالة
- 946 [jsx-text] إجمالي المخزون
- 956 [jsx-text] المقاسات النشطة
- 960 [jsx-text] الحد الأدنى للمقاسات النشطة

### src\modules\inventory\pages\InventoryHistory.jsx
- 107 [jsx-text] Number(movement.quantity_change || 0)
- 167 [jsx-text] نوع الحركة
- 173 [jsx-text] الكل
- 196 [jsx-text] سجل الحركات
- 197 [jsx-text] اضغط أي صف لعرض الكمية قبل الحركة وبعدها.
- 213 [jsx-text] لا توجد حركات مسجلة.
- 220 [jsx-text] الوقت
- 221 [jsx-text] المنتج
- 222 [jsx-text] الاختيار
- 223 [jsx-text] النوع
- 224 [jsx-text] قبل
- 225 [jsx-text] التغيير
- 226 [jsx-text] بعد
- 227 [jsx-text] المستخدم
- 228 [jsx-text] المرجع
- 338 [jsx-text] الخط الزمني للمخزون
- 156 [placeholder] ابحث عن منتج أو اختيار أو ملاحظات أو مستخدم...
- 161 [placeholder] معرّف المنتج
- 162 [placeholder] معرّف الاختيار
- 113 [title] سجل المخزون
- 114 [title] ابحث في سجل الحركات حسب المنتج أو الاختيار أو نوع الحركة أو التاريخ، ثم افتح أي صف لعرض خط زمني تفصيلي للمخزون.
- 334 [aria-label] إغلاق تفاصيل الحركة
- 143 [prop-label] الحركات
- 144 [prop-label] واردة
- 145 [prop-label] صادرة
- 146 [prop-label] إجمالي الصفوف
- 161 [prop-label] المنتج
- 162 [prop-label] الاختيار
- 164 [prop-label] إلى
- 334 [prop-label] إغلاق تفاصيل الحركة
- 347 [prop-label] نوع الحركة
- 348 [prop-label] الكمية قبل
- 349 [prop-label] التغيير في الكمية
- 350 [prop-label] الكمية بعد
- 351 [prop-label] المرجع
- 352 [prop-label] المستخدم
- 353 [prop-label] الوقت
- 354 [prop-label] المخزن
- 355 [prop-label] التكلفة
- 356 [prop-label] ملاحظات

### src\modules\inventory\pages\StockAdjustments.jsx
- 662 [jsx-text] حد الاعتماد القابل للتعديل
- 673 [jsx-text] جارٍ تحميل المخازن...
- 679 [jsx-text] نتائج البحث عن المنتجات
- 680 [jsx-text] ابحث بالاسم أو SKU أو الباركود. اضغط أي اختيار لتحميل الرصيد والمخزن الخاص به.
- 741 [jsx-text] المنتج المحدد
- 742 [jsx-text] يتم عرض الرصيد الحالي قبل تطبيق أي تسوية.
- 794 [jsx-text] نموذج التسوية
- 795 [jsx-text] حدد طريقة حركة المخزون ثم أكد التغيير بعد مراجعة الرصيد المستهدف.
- 801 [jsx-text] نوع التسوية
- 826 [jsx-text] الكمية
- 855 [jsx-text] السبب
- 870 [jsx-text] ملاحظات اختيارية
- 910 [jsx-text] آخر التسويات
- 911 [jsx-text] أحدث سجلات التسوية المحلية مع سياق المنتج.
- 1085 [jsx-text] ماسح الباركود
- 1086 [jsx-text] امسح باركود المنتج
- 1152 [jsx-text] تأكيد التسوية
- 1175 [jsx-text] نوع التسوية
- 1181 [jsx-text] التغيير في الكمية
- 1203 [jsx-text] اسم المعتمد
- 1212 [jsx-text] ملاحظات الاعتماد
- 1268 [jsx-text] سجل المنتج
- 626 [placeholder] ابحث بالاسم أو SKU أو الباركود
- 875 [placeholder] أضف ملاحظة قصيرة لسجل حركة المخزون
- 1207 [placeholder] اسم المدير
- 1217 [placeholder] ملاحظة اعتماد اختيارية
- 568 [title] تسويات المخزون
- 569 [title] ابحث عن المنتجات بالاسم أو SKU أو الباركود، وراجع الرصيد الحالي قبل التعديل، واحفظ كل تغيير داخل سجل حركات المخزون.
- 1080 [aria-label] إغلاق الماسح
- 1147 [aria-label] إغلاق تأكيد التسوية
- 1264 [aria-label] إغلاق سجل المنتج
- 271 [toast] جارٍ استخدام مخازن احتياطية
- 389 [toast] تمت مطابقة الباركود مع أحد الاختيارات
- 399 [toast] ليس لديك صلاحية تنفيذ تسويات المخزون
- 403 [toast] اختر اختيارًا للمنتج أولًا
- 407 [toast] يجب أن تكون الكمية 1 على الأقل
- 411 [toast] لا يمكن أن ينخفض المخزون إلى أقل من صفر
- 415 [toast] هذه التسوية تحتاج إلى اعتماد المدير
- 484 [toast] تم تحديث المخزون وتسجيل الحركة
- 502 [toast] ليس لديك صلاحية تنفيذ تسويات المخزون
- ... 23 more

### src\modules\inventory\pages\StockMovements.jsx
- 468 [jsx-text] كل الأنواع
- 478 [jsx-text] الدرجة
- 484 [jsx-text] كل الدرجات
- 494 [jsx-text] الفئة
- 500 [jsx-text] كل الفئات
- 510 [jsx-text] عدد الصفوف
- 543 [jsx-text] سجل الحركات
- 544 [jsx-text] مجمعة حسب المنتج. افتح أي منتج لفحص كل حركة تخص الاختيارات تحته.
- 627 [jsx-text] حركات الاختيار
- 628 [jsx-text] اضغط صف الاختيار لفتح خطه الزمني الكامل.
- 672 [jsx-text] السبب:
- 675 [jsx-text] المرجع:
- 679 [jsx-text] المستخدم:
- 682 [jsx-text] التاريخ/الوقت:
- 685 [jsx-text] المخزن/الفرع:
- 689 [jsx-text] SKU/الباركود:
- 736 [jsx-text] ملخص الرصيد الحالي
- 737 [jsx-text] الرصيد الحالي للاختيارات مجمّع حسب اللون والمقاس.
- 779 [jsx-text] اللون
- 780 [jsx-text] المقاس
- 781 [jsx-text] الرصيد الحالي
- 886 [jsx-text] سجل الاختيار
- 926 [jsx-text] التسلسل الزمني الكامل للاختيار
- 927 [jsx-text] المشتريات والمبيعات والمرتجعات والتحويلات والجرد والتسويات لهذا الاختيار تحديدًا.
- 961 [jsx-text] السبب:
- 964 [jsx-text] المرجع:
- 967 [jsx-text] المستخدم:
- 970 [jsx-text] التاريخ/الوقت:
- 973 [jsx-text] المخزن/الفرع:
- 977 [jsx-text] قبل / بعد:
- 453 [placeholder] ابحث عن منتج أو SKU أو باركود أو لون أو مقاس أو سبب أو مستخدم...
- 420 [title] حركات المخزون
- 421 [title] تُجمَّع حسب المنتج حتى تبقى الاختيارات بحسب المقاس واللون واضحة وسهلة البحث والفحص.
- 882 [aria-label] إغلاق سجل الاختيار
- 440 [prop-label] مجموعات المنتجات
- 441 [prop-label] صفوف الحركات
- 442 [prop-label] صافي الكمية
- 443 [prop-label] حد الصفوف
- 601 [prop-label] عدد الحركات
- 603 [prop-label] صافي التغيير
- ... 20 more

### src\modules\inventory\pages\StockTransfers.jsx
- 132 [jsx-text] ملاحظات التحويل
- 153 [jsx-text] سجل التحويلات
- 156 [jsx-text] جارٍ تحميل المخازن...
- 158 [jsx-text] لا توجد تحويلات محفوظة محليًا.
- 179 [jsx-text] تحويل المخزون بين المخازن
- 126 [placeholder] أدخل معرّف الاختيار
- 137 [placeholder] ملاحظات التعبئة، تفاصيل السائق، سبب التحويل...
- 94 [title] تحويل المخزون بين المخازن
- 95 [title] إدارة تحويلات المخزون بين المخازن، ومراجعة السجل المحلي، وحفظ تفاصيل التحويل عندما تكون واجهة الخلفية غير مكتملة.
- 39 [toast] جارٍ استخدام بيانات تحويل احتياطية
- 56 [toast] معرّف الاختيار مطلوب
- 77 [toast] تم إرسال التحويل
- 88 [toast] مسار التحويل غير متاح. تم الحفظ محليًا.
- 126 [prop-label] معرّف الاختيار
- 127 [prop-label] من مخزن
- 128 [prop-label] إلى مخزن
- 129 [prop-label] الكمية

## marketing (192)

### src\modules\marketing\components\PostEditorModal.jsx
- 582 [jsx-text] erp.store
- 613 [jsx-text] erp.store
- 647 [jsx-text] erp.store
- 668 [jsx-text] ERP Store
- 741 [jsx-text] erp.store
- 742 [jsx-text] Story preview
- 1078 [jsx-text] Product URL
- 628 [title] Story slides
- 1087 [prop-label] Price
- 1088 [prop-label] Color
- 1089 [prop-label] Size

### src\modules\marketing\components\StoryPreview.jsx
- 46 [jsx-text] 0 && sale
- 50 [jsx-text] 0 && now
- 59 [jsx-text] 0 && (!regular || saleLikePrice
- 260 [jsx-text] 1 && stock

### src\modules\marketing\pages\AiMarketingCenter.jsx
- 768 [jsx-text] Stories and posts that stay clean
- 1038 [jsx-text] Archive Selected
- 1039 [jsx-text] Delete Selected
- 1040 [jsx-text] Publish Selected
- 1115 [jsx-text] Arabic Trend
- 1117 [jsx-text] Facebook
- 1118 [jsx-text] Instagram
- 1135 [jsx-text] Preview
- 1140 [jsx-text] View Post
- 1141 [jsx-text] Restore
- 1142 [jsx-text] Approve
- 1144 [jsx-text] Archive
- 1148 [jsx-text] Retry
- 1191 [jsx-text] Generated story asset
- 1198 [jsx-text] No generated story asset
- 1203 [jsx-text] Story Slides
- 1234 [jsx-text] Performance Brain
- 1263 [jsx-text] Delete Published Content
- 1272 [jsx-text] Cancel
- 1291 [jsx-text] Content History
- 1294 [jsx-text] Close
- 1352 [jsx-text] Published
- 1353 [jsx-text] View Post
- 1365 [jsx-text] Technical JSON
- 1400 [jsx-text] Story asset
- 1401 [jsx-text] Rendered
- 1413 [jsx-text] Story preview
- 1414 [jsx-text] 9:16 story creative. CTA is a visual sticker here; the product link stays stored for publishing.
- 1416 [jsx-text] Close
- 1426 [jsx-text] Story publish asset debug
- 1467 [jsx-text] Published
- 1468 [jsx-text] View Post
- 1506 [jsx-text] Admin / debug
- 1530 [jsx-text] Published image asset URLs
- 1542 [jsx-text] Technical JSON
- 808 [title] Content Lanes
- 810 [title] New Arrivals
- 811 [title] Last Size / Last Piece
- 812 [title] AI Posts
- 817 [title] Daily Volume
- ... 51 more

### src\modules\marketing\pages\AiMarketingVideos.jsx
- 312 [jsx-text] Videos
- 358 [jsx-text] Videos per day
- 434 [jsx-text] video
- 437 [jsx-text] Instagram
- 438 [jsx-text] Facebook
- 439 [jsx-text] TikTok later
- 446 [jsx-text] Preview
- 447 [jsx-text] View Post
- 448 [jsx-text] Approve
- 449 [jsx-text] Publish
- 555 [jsx-text] = start && sceneTimelinePosition
- 646 [jsx-text] Variant details
- 656 [jsx-text] Price focus
- 666 [jsx-text] Limited availability
- 692 [jsx-text] Video preview
- 693 [jsx-text] Preview-ready video queue item. MP4 generation and Reels publishing will be added later.
- 719 [jsx-text] Video readiness
- 742 [jsx-text] CapCut-style timeline
- 779 [jsx-text] Scene timeline
- 815 [jsx-text] AI script / captions timeline
- 863 [jsx-text] Generated script / caption
- 867 [jsx-text] Technical debug
- 871 [jsx-text] Published
- 872 [jsx-text] View Post
- 332 [title] Content Lanes
- 344 [title] Video Templates
- 356 [title] Daily Video Volume
- 382 [title] Video Queue
- 324 [prop-label] Video Queue
- 325 [prop-label] Ready / Approved
- 326 [prop-label] Failed
- 701 [prop-label] Status
- 702 [prop-label] Scheduled
- 703 [prop-label] Playback
- 704 [prop-label] Preset
- 705 [prop-label] Quality score
- 706 [prop-label] Aspect ratio
- 707 [prop-label] Estimated engagement
- 708 [prop-label] Motion style
- 709 [prop-label] Reel energy
- ... 6 more

### src\modules\marketing\pages\MarketingSettings.jsx
- 848 [jsx-text] 0 && completedSteps
- 904 [jsx-text] Meta OAuth readiness
- 905 [jsx-text] Use these values in Meta Developer settings. Secret values are never displayed here.
- 911 [jsx-text] Environment
- 923 [jsx-text] OAuth Redirect URI
- 930 [jsx-text] Webhook Callback URL
- 945 [jsx-text] Required permissions
- 951 [jsx-text] App review reminder: production messaging and publishing require Meta review approval for the requested permissions.
- 954 [jsx-text] Setup steps
- 971 [jsx-text] Post-OAuth result
- 978 [jsx-text] Connected page
- 982 [jsx-text] Connected Instagram account
- 986 [jsx-text] Missing permissions
- 990 [jsx-text] Next required action
- 1005 [jsx-text] Connect Meta
- 1028 [jsx-text] Login with Facebook
- 1029 [jsx-text] Start the official Meta OAuth flow, grant permissions, then choose the Facebook Page and linked Instagram Business Account.
- 1051 [jsx-text] Choose Facebook Page and Instagram Business Account
- 1069 [jsx-text] Verify webhook and capabilities
- 1070 [jsx-text] Runs live permission checks, token diagnostics, and webhook delivery health.
- 1090 [jsx-text] Setup checklist
- 1122 [jsx-text] Connection
- 1123 [jsx-text] Facebook Page and Instagram account
- 1149 [jsx-text] Facebook Page
- 1151 [jsx-text] Page ID is managed by the guided connection flow.
- 1154 [jsx-text] Instagram Business Account
- 1156 [jsx-text] Manual Account ID entry is hidden unless advanced mode is enabled.
- 1348 [jsx-text] Live delivery health
- 1443 [jsx-text] Comment-to-DM performance
- 1502 [jsx-text] Template
- 1510 [jsx-text] Fallback reply
- 1527 [jsx-text] Preview simulator
- 558 [toast] Choose a Facebook Page to complete Meta setup
- 639 [toast] Meta connection timed out. You can try again.
- 690 [toast] Publishing permissions verified
- 707 [toast] Webhook subscription verified
- 744 [toast] Meta setup complete
- 926 [prop-label] Copy redirect URI
- 933 [prop-label] Copy webhook URL
- 934 [prop-label] Copy verify status

## orders (97)

### src\modules\orders\pages\OrderDetails.jsx
- 1342 [jsx-text] Bosta
- 1350 [jsx-text] إنشاء شحنة Bosta
- 1351 [jsx-text] تحديث الحالة
- 1352 [jsx-text] إلغاء
- 1374 [jsx-text] طباعة الملصق
- 1356 [prop-label] المزود
- 1357 [prop-label] المدينة
- 1358 [prop-label] المنطقة
- 1359 [prop-label] الحي
- 1362 [prop-label] الشارع
- 1363 [prop-label] المبنى
- 1364 [prop-label] الطابق
- 1365 [prop-label] الشقة
- 1368 [prop-label] علامة مميزة
- 1369 [prop-label] رقم التسليم
- 1371 [prop-label] رابط الملصق

### src\modules\orders\pages\OrderReturnsPage.jsx
- 337 [jsx-text] Returns Workspace
- 338 [jsx-text] لوحة تشغيل المرتجعات
- 404 [jsx-text] Orders module
- 405 [jsx-text] مرتجعات الطلبات
- 406 [jsx-text] إدارة المرتجعات والاسترداد وإعادة المخزون من نفس تجربة تشغيل الطلبات بشكل أسرع وأكثر وضوحاً.
- 477 [jsx-text] البحث
- 493 [jsx-text] التاريخ
- 535 [jsx-text] لا توجد مرتجعات مطابقة
- 536 [jsx-text] جرّب تعديل البحث أو الفلاتر الحالية.
- 546 [jsx-text] الإجراء
- 547 [jsx-text] رقم المرتجع / رقم الطلب
- 548 [jsx-text] العميل
- 549 [jsx-text] المنتجات المرتجعة
- 550 [jsx-text] قيمة المرتجع
- 551 [jsx-text] حالة المرتجع
- 552 [jsx-text] حالة الاسترداد
- 553 [jsx-text] إعادة للمخزون
- 554 [jsx-text] التاريخ
- 664 [jsx-text] نفس تدفق الإنشاء الحالي داخل drawer بدل الواجهة المنفصلة.
- 858 [jsx-text] تمت الإعادة للمخزون
- 483 [placeholder] ابحث برقم الفاتورة أو العميل أو الهاتف أو رقم التتبع
- 867 [title] ملخص المرتجع
- 878 [title] بيانات الطلب الأصلي
- 889 [title] بيانات العميل
- 898 [title] المنتجات المرتجعة
- 918 [title] حركة المخزون
- 927 [title] الاسترداد / الدفع
- 937 [title] الملاحظات / السبب
- 943 [title] الخط الزمني
- 658 [aria-label] إغلاق
- 849 [aria-label] إغلاق
- 211 [toast] يمكن تعديل المرتجعات المحلية فقط حالياً.
- 256 [toast] اختر منتجاً مرتجعاً واحداً على الأقل.
- 282 [toast] تم تحديث المرتجع.
- 302 [toast] لا يمكن حذف هذا المرتجع من هذه الواجهة.
- 308 [toast] تم حذف المرتجع.
- 328 [prop-label] إجمالي المرتجعات
- 329 [prop-label] مرتجعات اليوم
- 330 [prop-label] قيمة المرتجعات
- 331 [prop-label] تمت إعادتها للمخزون
- ... 19 more

### src\modules\orders\pages\OrdersDashboard.jsx
- 214 [jsx-text] 0 && paid
- 216 [jsx-text] 0 && shipping
- 235 [jsx-text] = 0 && paid
- 394 [jsx-text] 0 && paid
- 1028 [jsx-text] البحث
- 1042 [jsx-text] التاريخ
- 1246 [jsx-text] : proofUrl ?
- 1397 [jsx-text] : proofUrl ?
- 1414 [jsx-text] WhatsApp
- 1499 [jsx-text] WhatsApp
- 1620 [jsx-text] 0 && paid
- 1039 [prop-label] حالة الدفع
- 1040 [prop-label] المصدر
- 1365 [prop-label] البائع
- 1366 [prop-label] الدفع
- 1367 [prop-label] \u0637\u0631\u064a\u0642\u0629 \u0627\u0644\u0627\u0633\u062a\u0631\u062f\u0627\u062f
- 1368 [prop-label] الشحن
- 1370 [prop-label] دفع تعديل الفاتورة
- 1461 [prop-label] البائع
- 1462 [prop-label] الدفع
- 1463 [prop-label] \u0637\u0631\u064a\u0642\u0629 \u0627\u0644\u0627\u0633\u062a\u0631\u062f\u0627\u062f
- 1465 [prop-label] دفع تعديل الفاتورة

## other (113)

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
- 105 [jsx-text] Waiting for AI events...

### src\components\ai\AISuggestedReplies.jsx
- 98 [jsx-text] المحادثة دي محتاجة تدخل بشري. اقتراحات الذكاء الاصطناعي للمراجعة فقط.

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

### src\services\realtimeFeedbackService.js
- 218 [jsx-text] = start && current
- 218 [jsx-text] = start || current

## pages (1469)

### src\modules\aiSupport\pages\AiAgentAnalytics.jsx
- 175 [jsx-text] AI Agent Analytics
- 176 [jsx-text] Performance Dashboard
- 177 [jsx-text] Commercial and operational performance for AI-assisted conversations, drafts, orders, follow-ups, objections, and product demand.
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
- 706 [jsx-text] : status === "human_takeover" ?
- 751 [jsx-text] No transcript yet.
- 791 [jsx-text] Customer
- 823 [jsx-text] Staff
- 861 [jsx-text] : status === "closed" ?
- 872 [jsx-text] WhatsApp AI active
- 932 [jsx-text] Conversation closed. Manual replies are disabled.
- 942 [jsx-text] Live send ready
- 942 [jsx-text] Live channel unavailable
- 944 [jsx-text] Sending a staff reply will take over this conversation and pause AI automation.
- 980 [jsx-text] Save draft
- 981 [jsx-text] Approve AI reply
- 1003 [jsx-text] 2-3 short Egyptian Arabic options that you can copy, edit, or send live.
- 1012 [jsx-text] Channel setup needed
- 1015 [jsx-text] Closed conversations cannot generate suggestions.
- 1016 [jsx-text] No channel settings row was found for this channel. Open AI Channels to finish setup before enabling live sends.
- 1018 [jsx-text] Generate a staff-only suggested reply. It stays separate from sent replies until you approve or edit it.
- 1025 [jsx-text] Short reply
- 1032 [jsx-text] Edit before send
- 1033 [jsx-text] Send now
- 1034 [jsx-text] Regenerate
- 1098 [jsx-text] Quick send
- 1099 [jsx-text] Send images
- 1100 [jsx-text] Draft order
- 1101 [jsx-text] Open product
- 1107 [jsx-text] No matched products yet. Refresh after the customer sends a model, color, size, or category.
- 1155 [jsx-text] Recommended next step
- 1161 [jsx-text] Confidence
- 1165 [jsx-text] Reason
- 1169 [jsx-text] Suggested action
- 1181 [jsx-text] Purchase intent:
- 1183 [jsx-text] Waiting for product, size, color, or buying signal.
- 1212 [jsx-text] Quick send card
- 1216 [jsx-text] No product match yet. Ask for model, category, size, color, or budget.
- 1229 [jsx-text] Memory
- 1234 [jsx-text] Memory will improve as the conversation continues.
- 1283 [jsx-text] Customer context
- 1385 [jsx-text] AI Debug
- 1386 [jsx-text] Intent, route, memory, and recent decisions
- 1500 [jsx-text] Skipped
- ... 178 more

### src\modules\aiSupport\pages\AiSettings.jsx
- 170 [jsx-text] AI Brain
- 171 [jsx-text] AI Settings
- 172 [jsx-text] Control automatic replies, tone, safety defaults, and debugging visibility for the Meta AI Inbox.
- 206 [jsx-text] Channel
- 208 [jsx-text] Facebook Messenger
- 209 [jsx-text] Instagram DM
- 210 [jsx-text] WhatsApp
- 211 [jsx-text] Web chat
- 215 [jsx-text] Platform
- 219 [jsx-text] Optional Product ID
- 225 [jsx-text] Customer message
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
- 286 [title] Visibility tools for the live AI Inbox console.
- 253 [prop-label] Product URL
- ... 6 more

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
- 1029 [title] System-wide risk signals for proactive replenishment.
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

### src\modules\attendance\pages\AttendanceDashboard.jsx
- 119 [jsx-text] Today&apos;s attendance overview
- 152 [jsx-text] Live employee table
- 162 [jsx-text] Employee
- 163 [jsx-text] Branch
- 164 [jsx-text] Check in
- 165 [jsx-text] Check out
- 166 [jsx-text] Status
- 167 [jsx-text] Late Minutes
- 168 [jsx-text] Early Leave Minutes
- 142 [prop-label] Present Today
- 143 [prop-label] Late Today
- 144 [prop-label] Absent Today
- 145 [prop-label] Early Checkout Today
- 146 [prop-label] Outside GPS Today

### src\modules\attendance\pages\AttendanceReports.jsx
- 128 [jsx-text] Export-ready attendance reports
- 161 [jsx-text] From
- 179 [jsx-text] Employee ID
- 204 [jsx-text] Monthly totals
- 205 [jsx-text] Grouped by month for the active filter range.
- 210 [jsx-text] Loading monthly totals...
- 212 [jsx-text] No totals available for this range.
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

### src\modules\employees\pages\EmployeeChatInbox.jsx
- 814 [jsx-text] الموظفون / المحادثات
- 815 [jsx-text] محادثات الموظفين
- 872 [jsx-text] لا يوجد موظفون أو محادثات حتى الآن.
- 902 [jsx-text] اليوم
- 903 [jsx-text] هذه المحادثة خاصة بين الموظف والإدارة
- 917 [jsx-text] رسائل غير مقروءة
- 1014 [placeholder] اكتب رد الإدارة...
- 1003 [aria-label] إرفاق ملف
- 1007 [aria-label] تسجيل صوتي
- 158 [prop-label] رسالة صوتية
- 1003 [prop-label] إرفاق ملف
- 1007 [prop-label] تسجيل صوتي

### src\modules\employees\pages\EmployeeHub.jsx
- 62 [jsx-text] Workspace unavailable.
- 143 [jsx-text] Payroll workspace failed to render. Please refresh.

### src\modules\employees\pages\EmployeePayrollPortal.jsx
- 2690 [jsx-text] طلب من المخزن
- 2699 [jsx-text] الجرد
- 2737 [jsx-text] Sales Opportunities
- 2738 [jsx-text] فرص البيع اليوم
- 2739 [jsx-text] بطاقات سريعة تكشف آخر قطعة، آخر قطعتين، أو آخر مقاس في فرعك.
- 2742 [jsx-text] Today
- 2836 [jsx-text] بوابة الموظف كتطبيق
- 2875 [jsx-text] إعادة ضبط الإشعارات
- 2926 [jsx-text] نواقص العرض
- 2927 [jsx-text] المقاسات المطلوبة للعرض الحالي وتاريخ التنفيذ.
- 2936 [jsx-text] قيد التنفيذ
- 2952 [jsx-text] قيد العرض
- 3002 [jsx-text] تم التنفيذ
- 3017 [jsx-text] تم العرض
- 3566 [jsx-text] متصل الآن

### src\modules\employees\pages\EmployeePortal.jsx
- 97 [jsx-text] ط«ط¨ظ‘طھ ط¨ظˆط§ط¨ط© ط§ظ„ظ…ظˆط¸ظپ ط¹ظ„ظ‰ ط§ظ„ظ…ظˆط¨ط§ظٹظ„
- 98 [jsx-text] ط§ظپطھط­ ط§ظ„طھط§ط³ظƒط§طھ ط¨ط³ط±ط¹ط© ظˆط§ط³طھظ‚ط¨ظ„ ط§ظ„طھظ†ط¨ظٹظ‡ط§طھ ط£ط«ظ†ط§ط، ط§ظ„ط´ظٹظپطھ.
- 157 [jsx-text] طھطµط¹ظٹط¯
- 418 [jsx-text] بوابة الموظف
- 456 [jsx-text] ط¨ظˆط§ط¨ط© ط§ظ„ظ…ظˆط¸ظپ ط؛ظٹط± ظ…طھط§ط­ط©
- 471 [jsx-text] ط¨ظˆط§ط¨ط© ط§ظ„ظ…ظˆط¸ظپ
- 477 [jsx-text] ظ…ظ‡ط§ظ… ط§ظ„ظٹظˆظ…
- 481 [jsx-text] ظ‚ظٹط¯ ط§ظ„طھظ†ظپظٹط°
- 485 [jsx-text] ظ…ظƒطھظ…ظ„ط©
- 521 [jsx-text] ط§ظ„ظ…ظ†طھط¬ط§طھ
- 522 [jsx-text] ط§ظپطھط­ ط´ط§ط´ط© ط§ظ„ظ…ظ†طھط¬ط§طھ ط§ظ„ط³ط±ظٹط¹ط© ظˆظ†ط¯ط§ط، ط§ظ„ظ…ط®ط²ظ†
- 524 [jsx-text] ظ†ط¯ط§ط، ط§ظ„ظ…ط®ط²ظ†
- 529 [jsx-text] ط§ظ„ظ…ظ‡ط§ظ… ط§ظ„ظ…ط·ظ„ظˆط¨ط©
- 536 [jsx-text] ظ„ط§ طھظˆط¬ط¯ ظ…ظ‡ط§ظ… ظ…ط·ظ„ظˆط¨ط© ط§ظ„ط¢ظ†.
- 542 [jsx-text] ط§ظ„ظ…ظ‡ط§ظ… ط§ظ„ظ…ظƒطھظ…ظ„ط©
- 547 [jsx-text] ظ„ظ… ظٹطھظ… ط¥ظƒظ…ط§ظ„ ط£ظٹ ظ…ظ‡ظ…ط© ط¨ط¹ط¯.

### src\modules\employees\pages\EmployeePortalInventory.jsx
- 337 [jsx-text] Inventory
- 338 [jsx-text] امسح الباركود
- 908 [jsx-text] Employee Portal
- 910 [jsx-text] الجرد
- 967 [jsx-text] جردات الفرع
- 968 [jsx-text] المسودة، قيد التنفيذ، المراجعة والمرفوضة.
- 987 [jsx-text] جاري التحميل...
- 1034 [jsx-text] اختر جردًا أو أنشئ جردًا جديدًا
- 1094 [jsx-text] سبب الرفض
- 1110 [jsx-text] اسم الجرد
- 1119 [jsx-text] ملاحظات
- 1132 [jsx-text] البحث والباركود
- 1133 [jsx-text] ابحث عن المنتج أو امسح الباركود لإضافة الكمية.
- 1194 [jsx-text] عناصر الجرد
- 1231 [jsx-text] حذف اللون
- 1368 [jsx-text] Employee Portal
- 1369 [jsx-text] جردات الفرع
- 1423 [jsx-text] القائمة
- 1429 [jsx-text] جارِ التحميل...
- 980 [placeholder] ابحث باسم الجرد أو الفرع
- 1151 [placeholder] ابحث بالاسم أو الباركود
- 1417 [placeholder] ابحث باسم الجرد أو الفرع
- 332 [aria-label] ماسح الباركود
- 920 [aria-label] جردات الفرع
- 1228 [aria-label] حذف اللون
- 1268 [aria-label] إنقاص الكمية
- 1284 [aria-label] زيادة الكمية
- 1375 [aria-label] إغلاق
- 528 [toast] تم إنشاء الجرد
- 549 [toast] تم حفظ الجرد
- 564 [toast] تم بدء الجرد
- 579 [toast] تم إرسال الجرد للمراجعة
- 594 [toast] تم إعادة فتح الجرد للتعديل
- 706 [toast] تمت إضافة اللون للجرد
- 788 [toast] تعذر تحديد اللون للحذف
- 806 [toast] تم حذف اللون من الجرد
- 791 [confirm] هل تريد حذف هذا اللون من الجرد؟
- 332 [prop-label] ماسح الباركود
- 920 [prop-label] جردات الفرع
- 1228 [prop-label] حذف اللون
- ... 3 more

### src\modules\employees\pages\EmployeePortalProducts.jsx
- 426 [jsx-text] Stock
- 456 [jsx-text] No sizes
- 494 [jsx-text] Variant selection
- 532 [jsx-text] Colors
- 553 [jsx-text] No colors
- 560 [jsx-text] Sizes
- 561 [jsx-text] Only available sizes appear
- 587 [jsx-text] No available sizes for this color
- 628 [jsx-text] EMPLOYEE SCANNER
- 629 [jsx-text] امسح الباركود أو QR بالكاميرا
- 630 [jsx-text] وجّه الكاميرا نحو الكود وسيتم البحث مباشرة.
- 1170 [jsx-text] Employee Portal Products
- 1186 [jsx-text] Employee Portal
- 1187 [jsx-text] كتالوج المنتجات
- 1259 [jsx-text] الفلاتر
- 1266 [jsx-text] النتائج
- 1235 [placeholder] ابحث بالاسم أو الموديل أو الباركود أو الكود
- 1225 [title] فتح ماسح الكاميرا
- 1249 [title] الفلاتر
- 636 [aria-label] إغلاق ماسح الكاميرا
- 1224 [aria-label] فتح ماسح الكاميرا
- 1248 [aria-label] الفلاتر
- 1078 [toast] تم إرسال الطلب للمخزن
- 636 [prop-label] إغلاق ماسح الكاميرا
- 1224 [prop-label] فتح ماسح الكاميرا
- 1248 [prop-label] الفلاتر

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

### src\modules\managerPortal\pages\InventoryApprovals.jsx
- 201 [jsx-text] اعتمادات الجرد
- 202 [jsx-text] لا يوجد رمز بوابة صالح. افتح بوابة المدير ثم أعد المحاولة.
- 224 [jsx-text] مركز اعتماد الجرد
- 225 [jsx-text] اعتمادات الجرد
- 261 [jsx-text] بحث
- 276 [jsx-text] الجلسات المعروضة
- 284 [jsx-text] جاري تحميل الجردات...
- 323 [jsx-text] لا توجد جلسات قيد المراجعة الآن
- 324 [jsx-text] ستظهر هنا الجردات التي أرسلها أمين المخزن للمراجعة.
- 334 [jsx-text] جاري تحميل تفاصيل الجرد...
- 340 [jsx-text] تفاصيل الجلسة
- 356 [jsx-text] سبب الرفض
- 373 [jsx-text] المنتج
- 374 [jsx-text] اللون
- 375 [jsx-text] المقاس
- 376 [jsx-text] كمية السيستم
- 377 [jsx-text] الكمية الفعلية
- 378 [jsx-text] الفرق
- 379 [jsx-text] السبب
- 380 [jsx-text] الملاحظات
- 395 [jsx-text] 0 ? "text-emerald-300" : diff
- 402 [jsx-text] لا توجد أصناف داخل الجرد.
- 443 [jsx-text] اختر جلسة من القائمة
- 444 [jsx-text] سيظهر ملخص الأصناف والفروقات هنا.
- 457 [jsx-text] رفض الجرد
- 458 [jsx-text] أدخل سبب الرفض
- 459 [jsx-text] السبب إلزامي وسيصل إلى أمين المخزن مع إشعار الرفض.
- 266 [placeholder] ابحث باسم الجرد أو الفرع أو المخزن
- 468 [placeholder] مثال: توجد فروقات غير مبررة أو تحتاج مراجعة ميدانية
- 252 [title] جردات بانتظار المراجعة
- 253 [title] جردات مرفوضة
- 254 [title] جردات مكتملة اليوم
- 255 [title] إجمالي فروقات اليوم
- 362 [title] عدد الأصناف
- 363 [title] إجمالي الزيادة
- 364 [title] إجمالي العجز
- 365 [title] إجمالي الفروقات
- 158 [toast] تم اعتماد الجرد
- 176 [toast] سبب الرفض مطلوب
- 182 [toast] تم رفض الجرد

### src\modules\managerPortal\pages\ManagerPortal.jsx
- 302 [jsx-text] الأكثر مبيعاً:
- 307 [jsx-text] مطلوب إعادة طلب:
- 311 [jsx-text] هو الأعلى مبيعاً.
- 315 [jsx-text] أكثر ساعة مبيعاً حالياً:
- 1590 [jsx-text] الإنشاء
- 1594 [jsx-text] الاستحقاق
- 1598 [jsx-text] المرفقات
- 1602 [jsx-text] البدء/الإنهاء
- 1705 [jsx-text] مركز قيادة المدير
- 1711 [jsx-text] اليوم
- 1716 [jsx-text] تحديث مباشر
- 1744 [jsx-text] تعذر تحميل بعض البيانات
- 1776 [jsx-text] بوابة المدير
- 1798 [jsx-text] بوابة المدير
- 1806 [jsx-text] مباشر
- 1814 [jsx-text] جردات بانتظار الاعتماد
- 1852 [jsx-text] بوابة المدير كتطبيق
- 1910 [jsx-text] غير مقروء
- 1914 [jsx-text] الإجمالي
- 1924 [jsx-text] تحديد الكل كمقروء
- 1932 [jsx-text] تحديث
- 2040 [jsx-text] لا توجد إشعارات
- 2086 [jsx-text] الإشعارات المباشرة
- 2087 [jsx-text] تنبيهات
- 2099 [jsx-text] تنبيهات المخزون
- 2100 [jsx-text] عرض
- 2151 [jsx-text] إعادة عرض منتج:
- 2167 [jsx-text] مطلوب إعادة طلب:
- 2265 [jsx-text] مبيعات اليوم
- 2274 [jsx-text] الفواتير
- 2278 [jsx-text] الوردية
- 2282 [jsx-text] آخر نشاط
- 2318 [jsx-text] إسناد اختياري
- 2322 [jsx-text] منخفضة
- 2323 [jsx-text] متوسطة
- 2324 [jsx-text] عالية
- 2325 [jsx-text] حرجة
- 2348 [jsx-text] كل الحالات
- 2349 [jsx-text] المهام المفتوحة
- 2350 [jsx-text] المهام المكتملة
- ... 185 more

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
- 84 [jsx-text] = 1 && value
- 249 [jsx-text] كشف حساب عميل
- 250 [jsx-text] كشف حساب العميل
- 252 [jsx-text] العميل:
- 253 [jsx-text] الهاتف:
- 254 [jsx-text] الرصيد الحالي:
- 255 [jsx-text] نقاط الولاء:
- 259 [jsx-text] آخر تحديث
- 262 [jsx-text] الرصيد الافتتاحي
- 263 [jsx-text] الرصيد النهائي
- 269 [jsx-text] الحركات
- 273 [jsx-text] التاريخ
- 274 [jsx-text] البيان
- 275 [jsx-text] رقم الفاتورة/الطلب
- 276 [jsx-text] مدين
- 277 [jsx-text] دائن
- 278 [jsx-text] الرصيد بعد الحركة
- 298 [jsx-text] لا توجد حركات مطابقة
- 305 [jsx-text] إجمالي المدين
- 306 [jsx-text] إجمالي الدائن
- 307 [jsx-text] الرصيد النهائي
- 925 [jsx-text] السماح بالعمليات الشخصية
- 959 [jsx-text] Per page
- 991 [jsx-text] نقاط الولاء
- 992 [jsx-text] رصيد المحفظة
- 1228 [jsx-text] استيراد من النظام القديم
- 1229 [jsx-text] استيراد العملاء ونقاط الولاء
- 1246 [jsx-text] CSV, XLS, XLSX حتى 8MB
- 1256 [jsx-text] الأعمدة المطلوبة أو المعروفة
- 1272 [jsx-text] استبدال النقاط القديمة
- 1273 [jsx-text] إضافة على النقاط الحالية
- 1329 [jsx-text] معاينة الاستيراد
- 1330 [jsx-text] ملخص الملف
- 1332 [jsx-text] تم التنفيذ
- 1408 [jsx-text] تدقيق محفظة العميل
- 1477 [jsx-text] إضافة يدوية
- 1478 [jsx-text] خصم يدوي
- 1482 [jsx-text] حفظ
- 1487 [jsx-text] سجل تدقيق المحفظة
- 1490 [jsx-text] جاري التحميل...
- ... 46 more

### src\modules\sales\pages\InvoicesLegacy.jsx
- 353 [placeholder] ابحث في الفواتير...
- 413 [placeholder] المنتج
- 437 [placeholder] العميل
- 461 [placeholder] الكمية
- 485 [placeholder] السعر
- 52 [confirm] Fill all fields
- 99 [confirm] حذف الفاتورة؟

### src\modules\sales\pages\SalesEmployees.jsx
- 250 [jsx-text] 0 && row.earned_commissions
- 1543 [jsx-text] node server/scripts/employeeWalletSmokeTest.js
- 789 [toast] Select an employee before saving sales settings
- 793 [toast] Select a branch for this employee
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
- 958 [jsx-text] Searchable collection selector replacement for the old JSON list.
- 986 [jsx-text] محفظة Vodafone Cash
- 987 [jsx-text] تحكم في الاسم الظاهر، الرقم، الشعار، والنص المساعد الذي يظهر للعميل.
- 995 [jsx-text] نص مساعد
- 1005 [jsx-text] InstaPay
- 1006 [jsx-text] أدخل رابط الدفع المباشر وخصص الاسم الظاهر والنص المساعد والشعار.
- 1013 [jsx-text] رابط الدفع InstaPay
- 1014 [jsx-text] ضع رابط الدفع المباشر من تطبيق InstaPay
- 1047 [jsx-text] إعدادات التوافق القديمة
- 1048 [jsx-text] يُستخدم فقط إذا لم يتم إدخال رابط دفع مباشر.
- 1056 [jsx-text] نص مساعد
- 1066 [jsx-text] رسوم تأكيد الشحن
- 1067 [jsx-text] اضبط الرسوم الظاهرة في خطوة الدفع داخل صفحة إتمام الطلب.
- 1073 [jsx-text] نص الرسوم
- 1077 [jsx-text] قيمة الرسوم
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
- ... 63 more

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
- 258 [jsx-text] Centralized shipment operations for Bosta and future providers with status monitoring, bulk actions, webhook timelines, and analytics.
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

### src\modules\warehouse\pages\WarehouseLivePicks.jsx
- 354 [jsx-text] alertKey(item) === alertKey(incoming) && alertAgeMs(item, now)
- 434 [jsx-text] التقاط المخزن المباشر
- 560 [jsx-text] بانتظار أول سحب من الـ POS
- 561 [jsx-text] التنبيه سيظهر مباشرة بعد "إضافة للفاتورة" بدون أي إجراءات يدوية.
- 538 [prop-label] اللون
- 539 [prop-label] كود الأرتكل
- 540 [prop-label] اسم المصنع
- 544 [prop-label] البائع
- 545 [prop-label] الوقت

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
- 381 [jsx-text] 0 && resolved.final_price
- 952 [title] No activity in this range
- 822 [aria-label] Trend sparkline
- 822 [prop-label] Trend sparkline

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

## pos (231)

### src\modules\pos\components\CartSidebar.jsx
- 884 [jsx-text] عملية شخصية
- 889 [jsx-text] نوع العملية الشخصية
- 895 [jsx-text] اختر النوع
- 896 [jsx-text] هدية / مصروف
- 897 [jsx-text] سلفة موظف
- 898 [jsx-text] استخدام شخصي للمالك
- 902 [jsx-text] ملاحظة
- 980 [jsx-text] بيع آجل للعميل
- 1421 [jsx-text] السعر
- 2662 [jsx-text] 0 && balance
- 2767 [jsx-text] مسموح بالسالب لهذا الحساب.
- 2777 [jsx-text] Treasury adjustment
- 908 [placeholder] اختياري
- 2797 [placeholder] Recharge amount
- 2803 [placeholder] Audit note
- 2745 [title] Recharge / adjustment
- 2632 [aria-label] Clear payment amount
- 2744 [aria-label] Recharge treasury account
- 2784 [aria-label] Close
- 2704 [toast] Enter a positive recharge amount
- 2715 [toast] Treasury adjustment recorded
- 1457 [prop-label] الخصم
- 1465 [prop-label] إجمالي الأصناف الجديدة
- 1467 [prop-label] المبلغ المدفوع الآن
- 1468 [prop-label] رصيد العميل المتبقي / المحفظة
- 1473 [prop-label] عدد المنتجات
- 1664 [prop-label] خصم الكوبون
- 2323 [prop-label] نقدي
- 2330 [prop-label] Vodafone Cash
- 2337 [prop-label] InstaPay
- 2632 [prop-label] Clear payment amount
- 2744 [prop-label] Recharge treasury account
- 2784 [prop-label] Close

### src\modules\pos\components\ProductGrid.jsx
- 70 [jsx-text] 0) || min

### src\modules\pos\components\RecentOperationsDrawer.jsx
- 499 [jsx-text] طباعة
- 505 [jsx-text] الصنف
- 505 [jsx-text] الكمية
- 505 [jsx-text] الإجمالي
- 506 [jsx-text] لا توجد أصناف
- 646 [jsx-text] العمليات الأخيرة
- 647 [jsx-text] عرض، إعادة طباعة، تعديل، أو مرتجع الفواتير الأخيرة.
- 812 [jsx-text] حذف نهائي
- 813 [jsx-text] سيتم حذف الفاتورة نهائيًا ولا يمكن التراجع عن هذه العملية.
- 814 [jsx-text] سيتم حذف السجلات المرتبطة واسترجاع المخزون إذا لم يكن مسترجعًا مسبقًا.
- 822 [jsx-text] اكتب DELETE أو حذف للتأكيد
- 832 [jsx-text] إلغاء
- 942 [jsx-text] مرتجع POS
- 943 [jsx-text] إنشاء مرتجع / استبدال
- 946 [jsx-text] إغلاق
- 966 [jsx-text] سبب المرتجع
- 992 [jsx-text] طريقة رد المبلغ
- 1010 [jsx-text] اختيار المنتجات المراد إرجاعها
- 1034 [jsx-text] الكمية المرتجعة
- 1109 [jsx-text] تفاصيل الفاتورة
- 1112 [jsx-text] إغلاق
- 1123 [jsx-text] المنتج
- 1124 [jsx-text] الكمية
- 1125 [jsx-text] السعر
- 1126 [jsx-text] الإجمالي الفرعي
- 1149 [jsx-text] لا توجد منتجات في هذه الفاتورة
- 1154 [jsx-text] الإجمالي
- 1159 [jsx-text] سجل الفاتورة
- 1175 [jsx-text] لا يوجد سجل متاح لهذه الفاتورة
- 659 [placeholder] بحث برقم الفاتورة أو العميل أو الهاتف
- 985 [placeholder] اكتب السبب
- 663 [title] تحديث
- 677 [title] حدث خطأ
- 679 [title] لا توجد عمليات
- 640 [aria-label] إغلاق
- 470 [toast] تعذر فتح نافذة الطباعة
- 515 [toast] تم تجهيز الفاتورة للطباعة مرة أخرى
- 574 [toast] لا يمكن عمل مرتجع لهذه الفاتورة
- 595 [toast] اكتب DELETE أو حذف للتأكيد
- 606 [toast] تم حذف الفاتورة نهائيًا
- ... 10 more

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
- 5862 [jsx-text] السماح بالعمليات الشخصية
- ... 107 more

## products (9)

### src\modules\products\lib\barcodeLabels.js
- 378 [jsx-text] = 32 && charCode
- 413 [aria-label] ${text}
- 413 [prop-label] ${text}

### src\modules\products\lib\variantBulkSizes.js
- 34 [jsx-text] 0 ? size

### src\modules\products\pages\BarcodeLabels.jsx
- 975 [jsx-text] طباعة QR ذكي للمنتج

### src\modules\products\pages\ProductDetails.jsx
- 393 [jsx-text] 0 && storedSalePrice
- 54 [aria-label] ${label}
- 54 [prop-label] ${label}

### src\modules\products\pages\ProductsList.jsx
- 436 [jsx-text] 0 && totalStock

## purchases (32)

### src\modules\purchases\lib\flowStore.js
- 507 [jsx-text] Number(variant.stock || 0)

### src\modules\purchases\pages\PurchaseOrder.jsx
- 1093 [jsx-text] 0 && salePrice
- 1509 [jsx-text] !item.unit_cost || item.unit_cost
- 2468 [jsx-text] 0 && salePrice
- 2854 [jsx-text] تحديد سعر البيع وسعر الخصم وسعر الجملة حسب المنتج أو النموذج.
- 2871 [jsx-text] الألوان
- 2875 [jsx-text] المقاسات
- 2879 [jsx-text] الخيارات
- 2899 [jsx-text] المنتجات:
- 2900 [jsx-text] الخيارات:
- 2901 [jsx-text] تمت:
- 2970 [jsx-text] 0 && salePrice
- 1946 [title] طي لوحة المنتج
- 1988 [title] إغلاق لوحة المنتج
- 2851 [title] أسعار نموذج المنتج
- 1925 [aria-label] إغلاق لوحة المنتج
- 1945 [aria-label] طي لوحة المنتج
- 1987 [aria-label] إغلاق لوحة المنتج
- 1925 [prop-label] إغلاق لوحة المنتج
- 1945 [prop-label] طي لوحة المنتج
- 1987 [prop-label] إغلاق لوحة المنتج
- 2885 [prop-label] سعر البيع
- 2886 [prop-label] سعر الخصم
- 2887 [prop-label] سعر الجملة

### src\modules\purchases\pages\ReorderSuggestions.jsx
- 121 [jsx-text] = 6 && packQty

### src\modules\purchases\pages\SupplierStatement.jsx
- 80 [jsx-text] جاري تحميل كشف الحساب...
- 145 [jsx-text] حركات الحساب
- 66 [title] كشف حساب المورد
- 127 [prop-label] إجمالي المشتريات
- 128 [prop-label] إجمالي المدفوع
- 129 [prop-label] الرصيد الافتتاحي
- 130 [prop-label] الرصيد المستحق

## shared (64)

### src\shared\chat\SharedPortalChat.jsx
- 428 [jsx-text] 42 && deltaY
- 608 [jsx-text] لا توجد محادثات حتى الآن.

### src\shared\components\DebugErrorBoundary.jsx
- 12 [jsx-text] تم تحديث الموقع، برجاء إعادة تحميل الصفحة

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

### src\shared\layouts\MainLayout.jsx
- 200 [jsx-text] Math.max(query.length, token.length)
- 547 [jsx-text] مساحة العمل
- 565 [jsx-text] لوحة المؤسسة
- 728 [jsx-text] لوحة المؤسسة
- 749 [jsx-text] المتجر
- 585 [placeholder] ابحث في الوحدات...
- 738 [title] المتجر
- 352 [aria-label] الإشعارات
- 739 [aria-label] فتح المتجر
- 785 [aria-label] تسجيل الخروج
- 352 [prop-label] الإشعارات
- 739 [prop-label] فتح المتجر
- 785 [prop-label] تسجيل الخروج

### src\shared\lib\saleMode.js
- 57 [jsx-text] 0 && sale
- 134 [jsx-text] 0 && discounted

### src\shared\notifications\NotificationBell.jsx
- 338 [jsx-text] تعذر تحميل الإشعارات
- 375 [jsx-text] لا توجد إشعارات
- 158 [title] غير مقروء
- 263 [aria-label] فتح الإشعارات
- 276 [aria-label] إغلاق الإشعارات
- 307 [aria-label] إغلاق الإشعارات
- 263 [prop-label] فتح الإشعارات
- 276 [prop-label] إغلاق الإشعارات
- 307 [prop-label] إغلاق الإشعارات

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

## storefront (36)

### src\storefront\pages\StorefrontProductDetailPage.jsx
- 430 [jsx-text] selectedSellingPrice ?
- 432 [jsx-text] 0 && Number(activeVariant.stock || 0)
- 495 [jsx-text] 0 && Number(activeVariant.stock || 0)

### src\storefront\Storefront.jsx
- 1049 [jsx-text] 0 && purchaseSalePrice
- 1807 [jsx-text] 0 && sale
- 1833 [jsx-text] = 1 && stock
- 1837 [jsx-text] 0 && totalStock
- 2199 [jsx-text] 0 && salePrice
- 2200 [jsx-text] 0 && salePrice
- 3701 [jsx-text] (current
- 3984 [jsx-text] 0 && productStock(product)
- 4943 [jsx-text] العلامات التجارية
- 5340 [jsx-text] LAST PIECE FINDER
- 8207 [jsx-text] US Men
- 8208 [jsx-text] US Women
- 8374 [jsx-text] index
- 9235 [jsx-text] item.price ?
- 3139 [placeholder] 01xxxxxxxxx
- 6402 [title] إغلاق
- 4196 [aria-label] Previous slide
- 4199 [aria-label] Next slide
- 6403 [aria-label] إغلاق اختيار المقاس
- 8958 [aria-label] WhatsApp
- 8959 [aria-label] Instagram
- 8960 [aria-label] Facebook
- 4196 [prop-label] Previous slide
- 4199 [prop-label] Next slide
- 5114 [prop-label] This week
- 5116 [prop-label] Nike edit
- 5119 [prop-label] Jordan edit
- 5122 [prop-label] Adidas edit
- 6403 [prop-label] إغلاق اختيار المقاس
- 7944 [prop-label] تم الدفع وإرفاق الإيصال
- 8958 [prop-label] WhatsApp
- 8959 [prop-label] Instagram
- 8960 [prop-label] Facebook

