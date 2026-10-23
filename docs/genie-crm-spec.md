# Genie CRM — المواصفات وخطة M1 وسجل التنفيذ

## الحالة الحالية — 23 أكتوبر 2026

المستخدم اعتمد المقارنة والخطة والتنفيذ. أقسام الفحص التاريخية أدناه توثق ما كان معروفًا وقتها؛ عبارات انتظار الموافقة أو عدم بدء التنفيذ فيها لم تعد الحالة الحالية.

### تنفيذ الأساسيات

- migration محلية مطبقة ومختبرة لإضافة pipelines وstages وسجل انتقالات، وامتداد ai_lead_opportunities الموجود، مع backfill قابل لإعادة التشغيل. لم تطبق على الإنتاج.
- API للفرص والمسارات والمراحل، ربط العميل والأوردرات، scope الشركة وملكية المستخدم وخصوصية المحادثات قبل العد والتصفح، ومنع فقد تعديلات متزامنة عبر version.
- شاشة /crm بالعربية والإنجليزية: Kanban وقائمة وبحث وفلاتر وصفحات وإنشاء وتعديل ونقل بالسحب أو ThemedSelect وسجل مراحل بتوقيت القاهرة، وإعداد المسارات وأسماء وترتيب وألوان المراحل وحالات الربح والخسارة.
- مزامنة مرحلة المحادثة والفرصة في الاتجاهين؛ التسجيل القديم يعيد استخدام الفرصة المرتبطة بدل إنشاء نسخة. انتقال المرحلة وحده لا يرسل رسائل ولا يبدأ متابعة.
- المراحل المخصصة لها ID واسم مستقل في CRM وكارت المحادثة للمستخدم الذي يملك crm.view/edit. فلاتر الإنبوكس العامة ومحرك المتابعة ما زالت بالمفاتيح الستة القديمة؛ المرحلة المخصصة المفتوحة تسقط إلى negotiation، والمغلقة إلى won/lost. تحويل فلاتر الإنبوكس والقواعد إلى IDs جزء متبقٍّ قبل إعلان تكامل المراحل المخصصة بالكامل.
- الصلاحيات crm.view/create/edit/manage مسجلة. الإدارة ترى الكل، وغير الإدارة ترى المسند لها من المحادثة أو الفرصة. تفويض team وتعديل الإسناد وreports/export لم يكتمل بعد.

### التحقق وحدود الإصدار

اختبارات CRM للوحدات والتكامل المحلي ناجحة: الحفظ، فصل الشركات، الملكية، منع التعديل بإصدار قديم، التاريخ، مزامنة الإنبوكس، ثبات المسار المختار، عدم تكرار التسجيل، حالات الربح، وخصوصية المحادثة دون إخفاء الفرص اليدوية. فحص ESLint للملفات الجديدة والبناء الكامل نجحا. اختبارات قاموس الترجمة العامة بها إخفاقات لغة سابقة خارج مفاتيح CRM؛ لم تعدل في هذه المهمة.

اختبار المتصفح المحلي شمل إنشاء فرصة بقيمة 1500، التنقل بين المراحل، فتح التفاصيل وحفظ الملاحظات، والتبديل بين اللوحة والقائمة. نجح أيضًا إنشاء مسار ومرحلة مخصصة بترتيب 35 من المتصفح. لقطة المعاينة الكاملة محفوظة محليًا في output/crm/phase-a-board.jpg؛ اللقطات المحدودة بالـviewport كانت فارغة، وتم تجاوز ذلك بالتقاط الصفحة كاملة.

هذه دفعة الأساسيات؛ لا تعني اكتمال المشروع. ما زال دمج المراحل المخصصة في الإنبوكس، نطاق الفريق والإسناد، ثم Phase B للأنشطة والأوتوميشن وPhase C للتقارير، وتطبيق migrations على بيئة النشر والتحقق هناك.

## المرحلة الثانية — مقارنة M1 وخطة مقترحة تنتظر الموافقة

**الحالة:** بدأ هذا القسم بتفويض المستخدم الصريح. مراجعة كود فقط؛ لا تغيير تطبيق أو قاعدة بيانات أو نشر. نتائج M1 أدلة من الكود الحالي وليست تأكيدًا أن كل migrations منشورة أو أن جميع المسارات تعمل في الإنتاج. نتائج جيني غير المثبتة تظل غير مثبتة.

### مصادر مراجعة M1

| الجزء | الملفات التي تمت مراجعتها | النتيجة |
|---|---|---|
| الإنبوكس والمراحل | `src/modules/aiSupport/pages/AiInbox.jsx`، `server/routes/aiAgentOrders.js`، `server/modules/crmStages/autoStage.js` | lead_status بالمحادثة؛ تفاصيل CRM محفوظة في metadata؛ GET/PATCH للـlead موجودان |
| الفلاتر والتاجز | `src/modules/aiSupport/lib/inboxFilterPanel.js`، `shared/aiInboxConversationLabels.js` | Accounts/Labels/Stages/Members/Activity، والفصل صريح بين labels والمراحل |
| هوية العميل | `server/controllers/customersController.js`، `server/utils/phoneSearch.js` | customers مع مراعاة tenant؛ canonicalPhoneKey وcanonicalPhoneSql لتطبيع الهاتف |
| الأوردرات | `server/modules/orders/inboxConversationOrders.js`، GET lead في `aiAgentOrders.js` | ربط بالمحادثة أو الهاتف، مع بيانات منتجات وأوردرات ومرتجعات ومدفوعات |
| الفرص الحالية | `server/services/aiInboxLeadActionsService.js`، `server/services/salesOpportunityService.js` | ai_lead_opportunities مرتبط بملف AI ومحادثة؛ sales_opportunities تنبيهات مخزون آخر قطعة/مقاس، وليس CRM للزبائن |
| المتابعات | `server/services/messageSequencesService.js`، `src/modules/aiSupport/components/controlCenter/SequencesPanel.jsx`، `server/services/aiClaudeSalesAgentService.js` | محرك sequences وخطوات AI/text وربط مراحل وpresets واشتراكات تنفيذ موجود بالفعل |
| الصلاحيات | `src/modules/permissions/lib/rbacStore.js`، `server/middleware/permissionMiddleware.js`، `server/modules/aiInboxPrivacy/conversationPrivacy.js` | registry حالي للموديولات والأفعال؛ inbox view/reply منفصلان وطبقة خصوصية للمحادثات |
| مخطط المراحل الحالي | `server/database/migrations/2026-06-15-add-ai-inbox-lead-pipeline.sql` | lead_status نصي وفهرس tenant/status/date؛ لا catalogue مراحل ديناميكي في هذا المسار |

### استنتاج معماري أساسي

المفقود الرئيسي ليس محرك متابعات ولا سجل عميل جديدًا؛ هو واجهة CRM موحدة وإعدادات مراحل قابلة للتخصيص مع توحيد مصدر بيانات الفرصة. البيانات حاليًا موزعة بين `ai_channel_conversations.lead_status` و`metadata.crm_lead_details` و`ai_lead_opportunities`. يجب توحيد الكتابة والقراءة عبر service مشترك، دون نسخ العميل أو الأوردر أو الرسائل.

`sales_opportunities` مخصص لفرص بيع المخزون حسب الفرع والمنتج والمقاس؛ لا نعيد استخدامه كصفقات CRM ولا نحوله لهذا الغرض.

### Gap analysis

S = امتداد محدود، M = امتداد متكامل API/UI، L = تغيير يمر عبر بيانات وهوية وصلاحيات ومسارات متعددة. الأحجام نسبية وليست مواعيد أو مجموعًا حسابيًا للمدة.

| الميزة عند جيني | عندنا موجودة؟ | الناقص/القرار | الحجم |
|---|---|---|---|
| catalogue مراحل بترتيب وwon/lost/fold | جزئي؛ ستة stage keys ثابتة | catalogue حسب tenant مع ربط stable keys بالموجود؛ حماية المراحل المستخدمة | M |
| تعدد pipelines | غير مثبت في جيني؛ لا catalogue مماثل مرصود في M1 | أول pipeline افتراضي يدعم التوسع؛ تعدد فعلي يؤجل حتى حاجة واضحة | M |
| نقل يدوي بين المراحل | موجود؛ endpoint ومسار داخل الإنبوكس | خدمة انتقال واحدة وواجهة Kanban؛ لا مسار كتابة منفصل | M |
| نقل تلقائي من سلوك البيع | موجود | الحفاظ على التقدم للأمام وعدم المساس بـwon/lost؛ ربط custom stages بالمفاتيح الحالية | M |
| Kanban مستقل للفرص | لم أجد شاشة CRM عامة مستقلة في المسارات المفحوصة | لوحة من قاعدة البيانات مع cursor pagination وتحديثات فورية ونقل متزامن آمن | L |
| List للفرص | قائمة محادثات وفلاتر موجودة؛ ليست قائمة CRM المالية | أعمدة الفرص والقيمة والإغلاق والمسؤول والمصدر؛ بحث وفرز على الخادم | M |
| بيانات القيمة والأولوية والإغلاق والخسارة | موجودة في crm_lead_details | عرض موحد والتحقق من القيم ونقلها/فهرستها عند الحاجة، دون نسخ متعارضة | M |
| probability وIs Opportunity | lead_score/temperature موجودان؛ معنى مختلف عن احتمال الإغلاق | فصل score عن probability وإضافة التحول إلى opportunity إذا مطلوب | M |
| فرص يدوية بلا محادثة | ai_lead_opportunities يتطلب profile_id وconversation_id افتراضي فارغ | مسار فرصة يدوي يربط customers اختياريا؛ المحادثة اختيارية دون إنشاء محادثة وهمية | L |
| أكثر من صفقة لنفس العميل | لم يُحسم من التدفقات الحالية | اختيار عميل واحد وعدة فرص بمعرف مستقل؛ لا unique على الهاتف للفرصة | L |
| العميل وربط الأوردرات | موجود | اعتماد customer_id أولًا ثم canonicalPhoneKey داخل tenant؛ عرض الروابط دون نسخ الطلب | M |
| توحيد هوية الهاتف | موجود | GET lead يستخدم آخر 10 أرقام في موضع؛ توحيده مع canonicalPhoneSql لتجنب تصادم أرقام دولية | M |
| التاجز منفصلة عن المرحلة | موجود | إعادة استخدام labels الحالية؛ تحديد إن كانت ملكيتها للفرصة أم المحادثة بوضوح | S |
| المسؤول وفريق البيع | إسناد المحادثة والمشاركون موجودون | عدم اختراع مسؤول موازٍ؛ ربطه بسياسة الخصوصية وفرق البيع عند الحاجة | M |
| فلاتر stages/labels/members/activity | موجودة | إضافة القيمة/الإغلاق/won/lost والمصدر في واجهة CRM فوق query مشترك | M |
| timeline ورسائل وملاحظات | موجود جزئيًا في المحادثة والتفاصيل | timeline انتقالات قيم ومراحل append-only، وروابط للسجل الأصلي بدل نسخ الرسائل | M |
| مكالمة/مهمة/ميعاد مرتبطة بالفرصة | staff_tasks/reminders موجودان كأجزاء؛ تكافؤ الربط غير مثبت | adapter إلى الموجود بعد مراجعة عقوده؛ نشاط CRM مربوط بالفرصة دون جدولة موازية | M |
| follow-up يبدأ حسب stage | موجود؛ trigger_type=lead_stage | تكييفه مع catalogue وإظهار القاعدة من شاشة المرحلة | M |
| خطوات بتأخير ونص/AI | موجود، حتى 8 خطوات | استخدام المحرك الحالي؛ لا نحتاج محركًا ثانيًا | S |
| الإيقاف عند الرد/الشراء والخروج من stage | موجود في المحرك | اختبارات التكامل وواجهة تشرح القواعد؛ لا نفترض تكافؤ جيني غير المثبت | M |
| انتقال حسب الرد/عدم الرد | موجود | move_to_if_replied/no_reply وfinalize_after_minutes يتكيفان مع stage IDs | M |
| WhatsApp template ضمن خطوة sequence | لا دليل تكافؤ من schema الخطوات المفحوص | مراجعة مرسل القوالب الموجود وربطه بالمحرك مع قيد نافذة واتساب | M |
| قوالب sales agent الجاهزة | موجودة | سأل ومشتراش؛ اعتراض سعر؛ أوردر مكملش؛ رجوع المخزون؛ لا تعاد كتابتها | S |
| استهداف قاعدة المتابعة بإعلان/حملة | attribution موجود في المشروع؛ rule targeting غير مثبت في sequences | شروط enrollment حسب بيانات attribution الحالية | M |
| سجل تنفيذ المتابعة | enrollments موجودة | عرض current_step/next_run/status/stopped_reason وإضافة سجل محاولات إذا غير كافٍ | M |
| Auto-assign | مؤكد كإعداد في جيني؛ عندنا إسناد محادثات | مراجعة توزيع الفرق الموجود قبل إضافة سياسة round-robin؛ ليس مطلب المرحلة الأساسية | M |
| SLA | غير مثبت في جيني | لا يبنى كتكافؤ مفترض؛ متطلب مستقل لاحق إن طلب | L |
| AI register lead/update stage | marker وautoStage وأفعال leads موجودة | إعادة استخدام الأدوات والسياسات مع API الفرصة؛ منع duplication | M |
| Schedule Task | إمكانيات أتمتة/مهام موجودة؛ تكافؤ أداة جيني غير مثبت | ربط النشاط بالـscheduler الموجود بعد مراجعة contract؛ لا cron جديد مستقل | M |
| تقارير مالية/تجميعات CRM | تقارير عامة وattribution وأداء فريق موجودة | تجميعات خاصة بالفرص حسب المرحلة والمسؤول والمصدر | M |
| conversion وforecast | غير مثبتين كمنتج جاهز في جيني؛ لا تقرير CRM مماثل مثبت عندنا | stage history أولًا؛ تعريف funnel وweighted forecast صراحة | L |
| صلاحيات مستخدم/مدير/مشرف CRM | inbox view/reply وprivacy موجودان | crm view/create/edit/assign/manage/reports/export مع scope mine/team/all؛ لا منح تلقائي | L |
| custom fields عام | غير مثبت في الطرفين بهذا النطاق | يؤجل؛ حقول ثابتة تغطي الأساسيات أولًا | L |
| import/export/bulk | جيني يعرضها؛ عندنا لا تكافؤ CRM مثبت | export بحسب الصلاحية، bulk مدقق؛ import يؤجل لما بعد ثبات الهوية | M |

### ما يجب الحفاظ عليه

- `advanceConversationLeadStage` يرفع المرحلة للأمام، ولا يغير won/lost، ولا يبدأ رسائل تلقائيًا. تعليق الكود يوثق قرار المستخدم بتاريخ 2026-10-21: الحركة التلقائية لا ترسل متابعة بذاتها. لا يغير المشروع الجديد هذا السلوك ضمنيًا.
- labels لا تتحول إلى stages؛ المرحلة بالمحادثة والتاجز تصنيفات مستقلة.
- canonicalPhoneKey يطبع الأرقام العربية و00 وكود مصر فقط عند شكل الهاتف المصري، ويحافظ على الأرقام الدولية. لا نستخدم آخر 10 أرقام كهوية عامة.
- Customer واحد قد يملك أكثر من conversation/فرصة/طلب. لا تدمجهم بالهاتف وحده ولا تفترض أن profile_id هو customers.id.
- customer privacy وtenant scope يطبقان على API والعدادات والتقارير وsocket والروابط، لا إخفاء عناصر UI فقط.
- محرك message_sequences وmessage_sequence_enrollments هو المصدر الوحيد للمتابعات؛ presets الحالية تظل موجودة.

### خطة التنفيذ المقترحة

#### Phase A — الأساسيات (L)

**البيانات:** migration additive لـcrm_pipelines وcrm_stages، pipeline افتراضي لكل tenant ومراحل بنفس stable keys الستة. توسيع ai_lead_opportunities ككيان الصفقة بدل جدول فرص آخر: customer_id اختياري، conversation reference موثوق، pipeline/stage، value/probability/priority/closing/loss/assignee، وversion للتزامن. الاحتفاظ بـprofile_id متى وجد؛ تعديل إلزامه مدروس للفرص اليدوية. جدول stage history جديد لأن حدث الانتقال غير محفوظ حاليًا بهذا الشكل.

**توحيد المصادر:** migration/backfill idempotent من المحادثات المعلمة كـlead والتفاصيل الحالية إلى الفرص الموجودة أو سجل واحد لكل علاقة موثوقة. لا نقل لكل المحادثات لمجرد default new. لا حذف للحقول القديمة أولًا؛ compatibility adapter للإنبوكس وخدمة CRM واحدة تحافظ على lead_status وبيانات الفرصة في transaction. كتابة مزدوجة مباشرة موزعة بين الصفحات ممنوعة؛ مرحلة لاحقة تزيل الإسقاط القديم بعد فحص القراءات. معاينة أعداد وduplicates قبل backfill وإيقافه عند علاقات ملتبسة.

**API/UI:** CRUD مراحل وفرص، بحث/فلترة/تجميع/pagination على الخادم، انتقال stage مع expected version، لوحة Kanban وقائمة وتفاصيل فرصة، إنشاء يدوي، رابط المحادثة والعميل والأوردرات. reuse panels والـidentity helpers. تسجيل صلاحيات CRM في registry وmiddleware والسياسات قبل عرض البيانات.

**معايير القبول:** تعديل المرحلة في CRM يظهر في الإنبوكس والعكس؛ لا duplicates للعملاء/الفرص؛ عدم خلط sales_opportunities الخاصة بالمخزون؛ مستخدمان يتزامنان دون ضياع نقل؛ scope mine/team/all مطبق على الاستعلامات؛ فتح أوردر العميل الصحيح؛ العربية والثيم والموبايل صالحون. السحب لا يبدأ إرسالًا ضمنيًا.

#### Phase B — الأوتوميشن والأنشطة (M–L)

تطوير messageSequencesService الحالي لربط stage IDs مع stable keys، وواجهة قواعد داخل المرحلة، reuse enrollments والـpresets والـAI writer. إضافة template targeting وسجل المحاولات فقط عند غيابها. سياسة واضحة للـdelay النسبي، الرد والشراء والخروج من المرحلة، grace period، retries، idempotency والـlocks. ربط activities بمهام/reminders الموجودة. Auto-assign اختياري ومغلق افتراضيًا؛ SLA خارج التكافؤ المؤكد.

**معايير القبول:** لا متابعة بعد رد/شراء/خروج وفق السياسة؛ webhook مكرر لا يكرر enrollment؛ عاملان لا يرسلان نفس الخطوة؛ لا إرسال خلال test-only agent خارج حسابات الاختبار؛ عدم بدء متابعة بسبب auto-stage دون تفويض واضح. صلاحية تعديل قاعدة لا تعني صلاحية إرسال غير مقيد.

#### Phase C — التقارير (M–L)

تجميعات العدد والقيمة والمصادر والمسؤول، أداء الموظفين، expected closing؛ conversion من stage history مع فترة cohort وتعريف فتح/ربح/خسارة؛ forecast مرجح باحتمال إغلاق مستقل عن lead score. تقارير scope-aware، timezone القاهرة عند حدود الأيام والأشهر، export بصلاحية منفصلة. عدم جمع قيمة الفرصة مرة لكل محادثة أو إضافة قيمة الأوردر فوقها كإيراد متوقع.

**معايير القبول:** عينات حسابية معلومة تطابق الأرقام؛ تعدد العملات لا يجمع دون تحويل معتمد؛ عدم ظهور قيمة/عدد lead محجوب؛ التواريخ على حدود منتصف الليل بالقاهرة صحيحة؛ تغيير stage لا يعيد كتابة التاريخ.

### ترتيب اعتماد وتنفيذ كل Phase

بعد موافقة المستخدم على الخطة فقط: migration + API + UI + اختبارات تكامل مناسبة + اختبار المتصفح، ثم commit وpush على main حسب تعليمات المستخدم. فحص تغييرات العمل الموجودة أولًا وعدم تضمين ملفات غير مرتبطة. ThemedSelect لكل dropdown جديد، namespace translation، timezone Africa/Cairo، تسجيل كل permission في registry، وإضافة سطر ! في .gitignore لأي ملف جديد في server/services. لا نسخ لكود/أيقونات/نصوص جيني.

خطة تراجع: migrations additive، عدم حذف metadata أو profiles أو conversation IDs، backfill قابل لإعادة التشغيل، تشغيل الواجهة عبر feature flag إن كان النمط متاحًا بالمشروع، وفصل تفعيل الرسائل عن نشر UI. يحتاج تغيير non-null أو إعادة ربط profile إلى نسخة احتياطية ومعاينة بيانات قبل التطبيق.

### نطاق هذه المرحلة والتحقق

لم تُشغّل migrations أو السيرفر أو worker، ولم تُعدّل صلاحية أو رسالة أو كود تطبيق. لا حاجة لتشغيل suite التطبيق لتغيير مستند فقط. المراجعة static؛ قبل التنفيذ يلزم فحص schema المنشور وأحجام البيانات ومسارات opportunity الفعلية وباقي مصادر الربط، ثم حسم backfill وقيود uniqueness داخل Phase A. المطلوب الآن موافقة المستخدم على الخطة أو تعديل نطاقها؛ لا تنفيذ تلقائيًا.

## تحديث أدلة لاحق — اختبارات الديمو المصرح بها

هذه النتائج تستبدل نقاط عدم التحقق المقابلة في الملخص السابق؛ باقي الفجوات تبقى كما هي.

### أسماء models مثبتة من Technical → Models

تمت تصفية App Label إلى crm، وأظهرت القائمة 14 نموذجًا:

`crm.contact`, `crm.tag`, `crm.lostreason`, `crm.stage`, `crm.lead`, `crm.salesteam`, `crm.increase`, `crm.marklost`, `crm.utmsource`, `crm.utmmedium`, `crm.utmcampaign`, `crm.followuprule`, `crm.followuprulemessage`, `crm.followupexecution`.

بالتالي اسم نموذج خطوة المتابعة مؤكد الآن: **crm.followuprulemessage**، وليس FollowUpStep الذي كان اسمًا وصفيًا. نموذج Technical للـlead نفسه يعرض Name/App Label/Model فقط؛ لا يكشف الأعمدة أو أنواعها أو العلاقات. لا تستنتج منه SQL schema.

### إعدادات CRM مثبتة

من `/genie/settings/?module=base`، قسم CRM يعرض أربع إعدادات:

| الإعداد | الغرض حسب الواجهة | الحالة وقت الفحص |
|---|---|---|
| Multi Teams | إسناد مندوب لأكثر من فريق بيع | غير مفعل |
| Leads | مرحلة تأهيل قبل إنشاء Opportunity | غير مفعل |
| Lead Enrichment | إثراء البيانات من مصادر خارجية | Basic؛ البدائل None/Basic/Advanced |
| Auto-assign Leads | إسناد تلقائي للمندوبين حسب قواعد مسبقة | غير مفعل |

تم فتح خيارات enrichment فقط دون اختيار قيمة جديدة. لم تُفعل auto-assign، وتفاصيل قواعد التوزيع أو round-robin غير مثبتة. وجود إعداد auto-assign أصبح مؤكدًا، فيستبدل عبارة عدم العثور على إعداد سابقًا. لم يظهر SLA ضمن الإعدادات الأربع؛ لا يثبت غيابه من كل النظام.

### اختبار الانتقال اليدوي

على الفرصة الفارغة التجريبية `id=58` التي نشأت أثناء الفحص فقط: الضغط على زر مؤهل أعطى toast `Status updated to "مؤهل"`. إعادة تحميل السجل أظهرت زر مؤهل بالـclasses الدالة على الاختيار (`text-white font-semibold border-primary`). هذا يثبت استمرار الانتقال دون ضغط Save منفصل. لم تختبر حركة السحب أو AI stage بعد.

Mark as Lost على السجل نفسه فتح dialog باسم Mark as Lost وفيه Lost Reason وLost Notes؛ لم يُحفظ الإجراء. لا يلزم وجود عمود Is Lost في الديمو حتى يظهر هذا الإجراء.

### صلاحيات CRM Admins

تم فتح الدور: الوصف إدارة CRM بالكامل. Record Rules تعرض 0 items. تبويب Inherited يثبت وراثة CRM Managers (`crm.managers`). لا يثبت ذلك وحده CRUD أو تجاوز record rules على الخادم. لم تُغير أي صلاحية.

> **آخر مراجعة: 2026-10-23، القاهرة.** الأقسام التالية ملخص موحّد ذو أولوية على الملاحظات التاريخية أسفل الملف. تم فحص المحاور الثمانية على مستوى الواجهات المتاحة، لكن الفحص الشامل المطلوب لم يكتمل: مخطط API، تفاصيل auto-assign/SLA، جميع صلاحيات CRUD، سلوك الإيقاف عند الرد، وبعض العلاقات لم تثبت. لا يعتبر المستند مواصفات نهائية معتمدة، ولا إذنًا ببدء المرحلة الثانية.

## 1. Pipelines وStages — الملخص الحالي

المؤكد هو model `crm.stage`، وست مراحل في الديمو: جديد (sequence 1)، مؤهل (2)، عرض سعر (3)، رابح (4)، مهتم (10)، GCT-0051 QUALIFIED (10). لم يظهر كيان مستقل Pipeline أو اختيار pipeline؛ لا يمكن الجزم بعدم وجوده خارج الواجهة المفحوصة. تعادل sequence لم يُختبر.

Stage fields: Sequence، Stage Name، Is Closed، Is Won، Is Lost، Folded، Description. رابح وحدها Is Won=true؛ كل Is Closed وIs Lost وFolded في القائمة الحالية false. لا يوجد عمود lost في هذه العينة، لكن Mark as Lost موجود في الفرصة وفلتر Lost Leads موجود.

الألوان المقروءة من computed styles في الثيم الفاتح: كل عناوين المراحل `rgb(30,41,59)`، حدود حاوية الرأس `rgb(226,232,240)` وخلفيتها شفافة؛ لا توجد ألوان مختلفة للعناوين الستة. لا يثبت ذلك عدم وجود تخصيص لون بمكان آخر.

وسائل الواجهة: أزرار مراحل داخل الفرصة، Mark as Won/Mark as Lost، وإجراءات Stage actions (Collapse/Rename/Select All/Delete Stage). لم تُنفذ حركة stage أو سحب بطاقة؛ سلوك النقل بالسحب والأتمتة غير مختبر. إعدادات المتابعة تثبت حقلي الانتقال عند الرد وعدم الرد، لكنها لا تثبت التنفيذ الفعلي.

## 2. Lead / Opportunity — الملخص الحالي

الحقول الرئيسية: Lead Name، Contact، Email، Phone، Assigned To، Sales Team، Expected Revenue، Success Probability (%)، priority، Expected Closing، Tags، description. نموذج جديد يختار admin مسؤولًا واحتمال 10% وأولوية 0.0 في العينة. بيانات نموذج لا تعني defaults ثابتة لكل شركة.

Contact Information: Contact Name، Company Name، Title، Job Position، Email، Phone، Mobile، Website، Street، Street 2، City، Governorate/State، ZIP Code، Country.

Campaign Tracking: UTM Source، UTM Medium، UTM Campaign، Ad Headline، Ad Body، Ad Source URL، Meta Campaign، Meta Ad Set، Meta Ad، Ad Channel، Attribution، Ad Clicks، First Ad Click، Last Ad Click، Click ID. حقلا Ad Channel وAttribution وعدد النقرات disabled في النموذج الجديد. قائمة الفرص أثبتت قيم القنوات WhatsApp/Messenger/Instagram. لم يثبت مصدر يدوي كقيمة enum.

Lost Information: Lost Reason وLost Notes. Ad Clicks تبويب مستقل وروابط عدادات؛ تفاصيل النقرات لم تُستخرج.

الإلزام: فحص DOM للحقول الحالية لم يظهر required أو aria-required، ولا يكفي ذلك لنفي validation في الخادم. لم يُحدد أي حقل كـcustom بصورة مؤكدة. أسماء UI inputs المثبتة: `name`, `email`, `phone`, `expected_revenue`, `lost_notes`؛ ليست schema كاملة.

## 3. الشاشات والبحث — الملخص الحالي

تم فتح Kanban وList وGraph وPivot وActivity وCalendar فعليًا. List يحتوي Name/Contact/Email/Phone/Priority/Created At/Sales Person/Sales Team/Expected Revenue/Stage/Tags/Meta Campaign/Meta Ad/Ad Channel، وصف فلاتر لكل عمود، Table Settings، pagination، نطاق صفوف، Navigate/Edit، وتحديد صفوف. Kanban به Navigate/Select، تحديد مجموعة، Collapse، Add Item وتحميل المزيد.

البحث المتقدم يعرض Quick Filters: My Leads، My Team's Leads، High Probability، High Priority، Recently Created، Closing Soon، High Value، Won، Lost، Missing Contact Info، Unassigned، Archived، Active، From Meta Ads، Unresolved Ad، Waiting for reply، WhatsApp 24h window closed. توجد فلاتر سريعة للموظف والفريق والتاجز.

Group By: Stage، Priority، Assigned To، Sales Team، Branch، UTM Source/Medium/Campaign، Created By، Partner، Lost Reason، Meta Campaign/Ad Set/Ad، Ad Channel. لا يُثبت ذلك وجود pipeline entity مستقل.

More actions: Bulk edit (disabled بدون تحديد)، Import، Export، Refresh. لم يُنفذ import/export أو bulk edit. لم تُستخرج كل خيارات الفرز أو Table Settings.

Calendar: Today/Previous/Next، Day/Week/Month/Year/Agenda؛ أكتوبر 2026 يعرض 0 events، فلا يمكن إثبات أي تاريخ يشغّل الأحداث من هذه العينة.

## 4. صفحة الفرصة والأنشطة — الملخص الحالي

تبويبات Notes/Contact Information/Campaign Tracking/Lost Information/Ad Clicks. Links/counters لعروض الأسعار والأوردرات والنقرات والحجوزات، Contact، Previous/Next record، Assign to Me، Mark Won/Lost، Booking، إرسال قالب.

Timeline: All/Messages/Notes/Changes/Files/Starred، بحث رسائل، إنشاء lead كحدث System، Follow/Unfollow وfollowers، Send message/Log note/Send Template. Notes محرر غني. لم يتم إرسال رسالة أو ملاحظة. زر WhatsApp ظاهر على بطاقات بعض الفرص؛ الربط الدقيق بمعرف conversation في الخادم غير مستخرج.

نموذج Schedule Activity: Activity Type، Assign To، WhatsApp Template، Deadline، Summary (حد ظاهر 256)، Follow-up Message. عرض Activity يضم Email/Call/Meeting/To Do/Upload Document/Follow Up/Reminder/Review، وفلاتر Overdue/Today/Planned، بلا أنشطة معلقة في العينة.

**أثر جانبي رُصد:** الضغط على Schedule activity من نموذج Lead جديد حفظ تلقائيًا lead فارغًا، URL أصبح `id=58` وظهر حدث إنشاء باسم فارغ. لم يُضغط Save ولم تُحفظ activity، وأُغلقت نافذة النشاط. ترك السجل دون حذف لتجنب تغيير إضافي. كان ذلك بعد تفويض المستخدم الكامل بحساب الديمو. التصريح السابق بعدم وجود أي إنشاء لم يعد دقيقًا بعد هذه الخطوة.

## 5. الأوتوميشن — الملخص الحالي

`crm.followuprule`: Name، Active، Trigger Stage، قنوات WhatsApp/Messenger/Instagram/TikTok، Move To If Replied، Move To If Not Replied. Messages مجموعة خطوات بحد أدنى خطوة واحدة؛ Ad Targeting يضم Campaigns/Ad Sets/Ads.

الخطوة: Send After (Days/Hours/Minutes، افتراضي 1/0/0)، عنصر +/- غير مختبر، WhatsApp Template، Text/Caption، Attachments. لا خيار AI صريح في النموذج المقروء. مرجعية التأخير (من بداية القاعدة أم الخطوة السابقة) والإيقاف عند الرد أو تغيير المرحلة وإعادة المحاولة ومنع التكرار غير مثبتة. لم تُحفظ أو تُفعّل قاعدة.

`crm.followupexecution`: Rule، Lead، Step، Status، Last Sent، Next Run، Started، Ended؛ القائمة فارغة، فلم تُستخرج حالات status أو transition traces.

auto-assign وSLA: لم يظهر إعداد مثبت؛ اختيار admin تلقائيًا في نموذج يدوي ليس دليلًا على round-robin أو قواعد فريق. لا يُكتب أنهما غير موجودين في المنتج.

## 6. أدوات AI — الملخص الحالي

تمت قراءة دليل `/aistudio/tools`، دون تشغيل أدوات كتابة:

- Register Lead: الوصف يشترط جمع اهتمام العميل وملخص إجاباته التأهيلية، يسجل فرصة ويعيد ID، والاستدعاء المتكرر لنفس احتياج العميل يحدّث نفس الفرصة حسب الوصف. الاسم التقني `crm_register_lead` لم يظهر في البطاقة، فلا يُعد مؤكدًا من الواجهة.
- Schedule Task: مهمة مستقبلية لمستخدم مرة واحدة بـrun_at أو دورية بـcron، prompt مستقل عن سياق المحادثة، watch اختياري يستند إلى استعلام. لا يساوي Activity أو follow-up message.
- Schedule a Follow-up Message: رسالة مؤجلة في المحادثة الحالية، text وoffset_days/offset_hours/offset_minutes أو scheduled_at ISO؛ المستقبل فقط حسب وصف الأداة.
- Create Contact متاحة ضمن CRM. تغيير stage من المحادثة لم يُثبت كأداة محددة أو schema.
- Describe Model أداة metadata معلنة؛ تم اختبارها فقط بـ`{"model":"crm.lead"}`، فأرجعت `describe_model() missing 1 required positional argument: 'context'`. لم تُنتج schema؛ لا يوجد تبرير لاختلاق الحقول أو إعادة تجربة أدوات كتابة.

## 7. التقارير — الملخص الحالي

Graph: Dashboard/Bar/Line/Pie، فترات Day/Week/Month/Quarter/Year؛ مقاييس Count وExpected Revenue وSuccess Probability. الأبعاد: Pipeline Stage، UTM Source/Medium/Campaign، Assigned To، Is Opportunity، Priority، Lost Reason، Created Date، Expected Closing، Closed Date. Dashboard فيه Data Trends وDistribution وData Overview، مع خيارات stacked/donut واتجاه الرسم.

Pivot: Expected Revenue ظاهر كمقياس افتراضي، صفوف أشهر وأعمدة مراحل وإجمالي، Flip axes/Add grouping/Add column subgroup/Expand/Collapse. الديمو عرض إجمالي 21,350 وقت القراءة؛ ليس رقمًا لاختبار نظام M1.

يمكن التحليل حسب المسؤول والمصدر والمرحلة، لكن **تقرير conversion انتقال-لانتقال وforecast موزون بالإيراد×الاحتمال لم يثبتا**. لا ينبغي مساواة رسم توزيع الفرص بتحليل conversion أو forecasting.

## 8. الصلاحيات — الملخص الحالي

Groups (`auth.group`) تعرض CRM Users (`crm.users`)، CRM Managers (`crm.managers`)، CRM Admins (`crm.admins`). خصائص المجموعة تشمل الاسم التقني والفئة وParent Group وGenie Agent Mode Limit، وتبويبات Users/Inherited/Menus/Views/Access Rights/Record Rules.

- CRM Users: وصفه وصوله إلى CRM الخاص به. Record Rules فيها قاعدتان بنفس الاسم my leads only على `crm.lead`، Global غير مفعل، وأعلام Read/Create/Write/Delete مفعلة في القاعدتين. تعبير domain الفعلي غير مستخرج؛ أسماء القواعد لا تثبت منطقها التنفيذي وحدها.
- Access Rights لهذا الدور يسرد Increase/Mark Lost/activity type/contact/lead/lost reason/sales team/stage/tag؛ قيم CRUD في خلايا هذا الجدول لم تعرضها شجرة DOM بوضوح، فلا تُنسب له صلاحيات كاملة اعتمادًا على وجود الصف.
- CRM Managers: وصفه الوصول إلى CRM الآخرين، Record Rules صفر وAccess Rights صفر في القراءة؛ لا يعني ذلك غياب الصلاحيات النهائية بسبب الوراثة/المجموعات الأخرى. لم يُختبر بحساب محدود.
- CRM Admins: وجود الدور مؤكد؛ تفاصيله النهائية غير مستخرجة.
- لم تُغيّر مجموعة أو صلاحية أو مستخدم، ولم تُجرَ اختبارات تجاوز وصول.

## Data model الموحّد: دليل مقابل استنتاج

| كيان/معرف model المرصود | حقول/علاقات من الواجهة | مستوى الإثبات |
|---|---|---|
| crm.lead | بيانات الفرصة، Contact/User/Sales Team/Stage/Tags، UTM وMeta attribution، Lost Reason، رسائل وأنشطة وروابط أوردرات | model مؤكد؛ أسماء FK والتعددية والجداول غير مؤكدة |
| crm.stage | sequence/name، Is Closed/Is Won/Is Lost/Folded/description | labels وقيم مرصودة؛ أسماء الأعمدة التقنية غير مثبتة |
| crm.tag / crm.lostreason | تصنيفات وأسباب خسارة | معرفات models مؤكدة |
| crm.utmsource / crm.utmmedium / crm.utmcampaign | مصدر/وسيط/حملة | معرفات models مؤكدة |
| crm.followuprule | trigger stage، وجهتا انتقال، flags قنوات، targeting ومجموعة خطوات | شكل منطقي مؤكد من النموذج؛ schema التقنية غير متاحة |
| FollowUpStep (اسم وصفي فقط) | delay/template/text/attachments، تابع لقاعدة | استنتاج منطقي وليس model تقنيًا مؤكدًا |
| crm.followupexecution | rule/lead/step/status/timestamps | labels مؤكدة، enum غير معروف |
| notifications.activitytype | أنواع الأنشطة | model من الرابط |
| Activity/Timeline (أسماء وصفية) | owner/deadline/summary/message، record link | شكل واجهة؛ models/relations الدقيقة غير متاحة |
| base.partner / base.user / auth.group | contact/assignee/security | معرفات من روابط الواجهة العامة |
| account.move | Orders & Billing ضمن crm_sales | لا يعني أن كل orders مخزنة فيه؛ الرابط فقط مثبت |

لا توجد أسماء SQL tables مثبتة، ولا مخطط API أو migrations مأخوذة من جيني. `read_network_requests` غير متاح، واختبار metadata الداخلي فشل كما سبق. لا يصلح هذا الجدول كـDB schema نهائي.

## ما يمنع اعتماد الفحص الشامل

يلزم لاستيفاء طلب الفحص بالكامل: Network/schema، سياسة تأخير وإيقاف وتنفيذ follow-up، auto-assign/SLA، تفاصيل CRM Admins وCRUD/record domains، تخصيص الحقول، سلوك السحب والـAI stage، واستخراج screenshots إلى ملفات مستقلة. Screenshots ظهرت بالمحادثة لشاشات خطوة المتابعة وجدولة النشاط وصلاحيات المدير؛ لم تُحفظ محليًا حتى الآن. لم تبدأ المقارنة بكود M1 ولا gap analysis ولا خطة ولا تنفيذ أو commit/push.

## فحص نموذج المتابعة بعد التفويض الكامل بحساب الديمو

أذن المستخدم بفتح النماذج والإعدادات في حساب تجريبي. تم فتح Create new لقاعدة متابعة، ثم Add a line لقراءة نموذج الخطوة وإغلاقه دون حفظ. لم تُنشأ قاعدة محفوظة ولم تُرسل رسالة أو تُفعل متابعة.

### Rule

- Rule Name؛ عنصر الإدخال `field-name`.
- Trigger Stage.
- Active؛ `field-is_active`، افتراضي checked.
- Channels: WhatsApp (`field-apply_whatsapp`)، Messenger (`field-apply_messenger`)، Instagram (`field-apply_instagram`)، TikTok (`field-apply_tiktok`)؛ الأربعة checked في النموذج الجديد.
- Stage Transitions: Move To If Replied وMove To If Not Replied.
- تبويب Messages به مجموعة خطوات؛ قائمة فارغة تظهر minimum 1 required. الأعمدة Send After وFallback Text وWhatsApp Template.
- تبويب Ad Targeting: Campaigns وAd Sets وAds. لم يتم اختيار قيم أو التحقق من قواعد الجمع بينها.

### نموذج خطوة المتابعة

- Send After: Days افتراضي 1، Hours افتراضي 0، Minutes افتراضي 0، مع عنصر +/- ظاهر. لم تُغير القيم، ولم يُختبر معنى الإشارة.
- WhatsApp Template.
- Text / Caption، مربع نص.
- Attachments، Add files، Paste from clipboard.
- تم التقاط screenshot ظاهر بالمحادثة لهذه الشاشة بنجاح باستخدام المتصفح الداخلي؛ لم يُحفظ بعد كملف محلي مستقل.
- لا يوجد في النموذج المقروء خيار AI صريح. لا يمكن الجزم هل يستخدم fallback text كما هو أو يعيد توليده.
- لم يُثبت هل تأخير الخطوة نسبي من بداية القاعدة أم من الخطوة السابقة، ولا توقيت انتقال عدم الرد، ولا الإلغاء عند الرد أو تغيير stage، ولا سياسة إعادة المحاولة أو منع التكرار.

### استنتاج علاقات إضافي

FollowUpRule يرتبط منطقيًا بمرحلة trigger ومرحلة replied ومرحلة not-replied، وله flags للقنوات ومجموعة FollowUpSteps (حد أدنى خطوة واحدة في الواجهة) وقيود استهداف Campaign/AdSet/Ad. Step يحتوي تأخيرًا وقالبًا ونصًا ومرفقات. أسماء جداول وأعمدة API غير مؤكدة؛ أسماء flags أعلاه من DOM IDs فقط.

## أحدث نتائج استكمال المرحلة الأولى

### إعدادات CRM المرصودة

القائمة Configuration تضم Tags (`crm.tag`)، Lost Reasons (`crm.lostreason`)، Activity Types (`notifications.activitytype`)، Stages (`crm.stage`)، UTM Campaigns (`crm.utmcampaign`)، UTM Mediums (`crm.utmmedium`)، UTM Sources (`crm.utmsource`)، Follow-up Rules (`crm.followuprule`)، Follow-up Executions (`crm.followupexecution`). هذه معرفات model من روابط الواجهة وليست أسماء جداول DB مؤكدة.

### المراحل: قيم مؤكدة من قائمة الإعدادات

أعمدة Stages: Sequence، Stage Name، Is Closed، Is Won، Is Lost، Folded، Description.

| Sequence | Stage | Is Closed | Is Won | Is Lost | Folded |
|---|---|---|---|---|---|
| 1 | جديد | false | false | false | false |
| 2 | مؤهل | false | false | false | false |
| 3 | عرض سعر | false | false | false | false |
| 4 | رابح | false | true | false | false |
| 10 | مهتم | false | false | false | false |
| 10 | GCT-0051 QUALIFIED | false | false | false | false |

لم توجد مرحلة Is Lost=true ضمن الستة المعروضة؛ لا يُستنتج من ذلك غياب Mark as Lost كسلوك مستقل. الفرق بين Is Closed وIs Won ظاهر في البيانات نفسها ولا ينبغي دمجهما افتراضيًا. يوجد تعادل في Sequence=10؛ معيار فض التعادل غير معروف. الألوان غير مؤكدة.

### Follow-up Rules

تم فتح القائمة فعليًا: صفر سجلات، No data available. الأعمدة المؤكدة: Name، Active، Trigger Stage، If Replied، If Not Replied. الثلاثة الأخيرة حقول علاقات لها فلاتر بحث. ذلك يدعم علاقة قاعدة المتابعة بمرحلة بدء ووجهتي انتقال، لكنه لا يثبت شروط التنفيذ أو التأخير أو إرسال AI/templates أو التوقف على الرد.

تم سؤال المستخدم عبر طلب توضيح مستقل عن السماح بفتح Create new لمشاهدة النموذج فقط، لأن الزر قد يبدأ مسودة. لم يُضغط ولم يُكتب أو يُحفظ أي شيء، ولا تزال الإجابة مطلوبة قبل هذه الخطوة.

## حالة الوصول الأحدث

نجح تسجيل الدخول إلى المتصفح الداخلي بتفويض المستخدم، ونجح فتح CRM والتبديل فعليًا إلى List. لا تُحفظ بيانات الدخول في هذا المستند. أعطال التحكم السابقة تخص جلسة Chrome الخارجية؛ الوصول الداخلي أصبح صالحًا لاستكمال الفحص. المرحلة الأولى ما زالت غير مكتملة.

### أدلة إضافية من المتصفح الداخلي

- قائمة Stage actions تضم Collapse وRename وSelect All وDelete Stage؛ تمت قراءة القائمة وإغلاقها فقط، دون تنفيذ أي إجراء.
- List تأكد عرضه فعليًا بالرابط `view_type=list`؛ الأعمدة: Name، Contact، Email، Phone، Priority، Created At، Sales Person، Sales Team، Expected Revenue، Stage، Tags، Meta Campaign، Meta Ad، Ad Channel.
- صف فلاتر مستقل للأعمدة: Contains للنصوص، Is للعلاقات، Equals للأولوية، Between لتاريخ الإنشاء كما ظهر. خيارات تغيير شروط الفلاتر لم تُفحص بعد.
- Ad Channel في سجلات مقروءة يحتوي فعليًا WhatsApp وMessenger وInstagram؛ هذا دليل أقوى من أسماء الفرص المذكورة في الفحص السابق، لكنه لا يثبت وجود حقل مصدر عام أو مصدر يدوي.
- القائمة تحتوي pagination ونطاق 1–50 / 50 وإعدادات pagination، Table Settings، More actions، checkbox لكل سجل وSelect all.
- Row interaction mode في List يتيح Navigate أو Edit؛ ظل الوضع Navigate ولم تُحرر خلية.
- Kanban يعرض فلتر Stages جانبيًا مع All وعدد كل مرحلة. الأعداد تغيرت عن القراءة السابقة (رابح 7، المرحلة التجريبية 0)، ولا يُنسب التغيير لأي إجراء أجراه هذا الفحص؛ لم يتم نقل أو تعديل سجل.

تاريخ الفحص: 2026-10-23 بتوقيت القاهرة.

**الحالة: غير مكتمل بسبب تعطل أدوات الوصول للمتصفح. لا يصلح هذا المستند كمواصفات تنفيذ نهائية.**

## نطاق الفحص والأدلة

- جلسة Chrome المسجلة بالفعل، نافذة `Genie ERP: 1`.
- تمت قراءة قائمة التنقل من الصفحة المفتوحة فقط. لم يتم حفظ أو حذف أو إرسال أو نشر أو تغيير lead أو stage.
- Claude in Chrome و`read_network_requests` غير متاحين ضمن أدوات هذه الجلسة. استخدمت أداة Computer Use لقراءة Chrome.
- رابط CRM الظاهر في الواجهة: `https://demo.genie-erp.com/genie/99/?model=crm.lead&module=crm&view_type=kanban`.
- محاولة فتح الرابط فشلت برسالة `coordinate input geometry is unavailable`.
- محاولتا التقاط الشاشة فشلتا برسالتي `FrameArrived timed out` و`window capture timed out`. لا توجد screenshots محفوظة؛ لا يوجد دليل بصري على محتويات CRM الداخلية.

## 1. Pipelines وStages

لم تُفحص. الأسماء والترتيب والألوان وwon/lost وآليات النقل اليدوي أو التلقائي أو بالذكاء الاصطناعي غير مؤكدة. لم يتم سحب أي بطاقة.

## 2. Lead / Opportunity

المؤكد فقط: رابط الواجهة يستخدم معرف model باسم `crm.lead`؛ هذا ليس إثباتًا لاسم جدول قاعدة البيانات.

لم تُفحص الحقول أو الإلزام أو الحقول المخصصة أو المصدر أو القيمة أو المسؤول أو التاجز أو الأولوية. وجود قنوات WhatsApp وMessenger وInstagram في قائمة Chat لا يثبت تسجيلها كمصادر leads.

## 3. الشاشات

رابط CRM الافتراضي يطلب `view_type=kanban`. لم يتم التحقق من عرض اللوحة فعليًا أو من List أو Calendar أو الفلاتر أو البحث أو الترتيب أو bulk actions.

## 4. صفحة Lead الداخلية

لم تُفتح. Timeline وactivities والمكالمات والمهام والملاحظات والمواعيد والربط بالإنبوكس والعميل والأوردرات غير مؤكدة.

## 5. الأوتوميشن

لم تُفحص قواعد متابعة stages أو التأخير أو AI/templates أو التوقف عند الرد أو الانتقالات حسب الرد أو auto-assign أو SLA. لا يُستنتج وجودها من طلب المستخدم وحده.

## 6. أدوات AI التي تمس CRM

لم يتم التحقق من `crm_register_lead` أو `schedule_task` أو تغيير stage من المحادثة.

في صفحة بوت WhatsApp المفتوحة لوحظت تسميات Update Customer وNotify user على بعض العقد، لكنها لا تثبت وجود الأدوات المذكورة أو سلوكها في CRM.

## 7. التقارير

لم تُفحص conversion حسب stage أو أداء الموظفين أو المصادر أو forecasting.

## 8. الصلاحيات

الجلسة الحالية تعرض المستخدم admin؛ لا يكفي ذلك لمعرفة قواعد الرؤية والتعديل. لم يتم تغيير مستخدم أو صلاحية أو إعداد أمان.

## Data model المستنتج وحدود الثقة

| العنصر | الدليل | الثقة |
|---|---|---|
| `crm.lead` | قيمة model في رابط CRM الظاهر | مؤكد كمعرف model في الواجهة فقط |
| Kanban كنوع عرض مطلوب | `view_type=kanban` في الرابط | مؤكد كمعامل رابط فقط |
| جداول وحقول وعلاقات CRM | لا توجد استجابات Network أو نماذج داخلية مقروءة | غير معلوم |

لا يمكن تقديم أسماء جداول أو أعمدة أو علاقات دقيقة من هذا الدليل، ولم يُختلق schema بديل.

## استكمال المرحلة الأولى

يلزم استعادة وسيلة قراءة موثوقة لجلسة Chrome ثم فحص الأقسام الثمانية وتسجيل أدلة كل شاشة. إذا توفر read_network_requests، تُقرأ الطلبات الناتجة عن التنقل المصرح به فقط دون إعادة تشغيل طلبات كتابة. أي إجراء يغير بيانات أو ينفذ automation يستلزم سؤال المستخدم قبل تنفيذه.

## بوابات الموافقة

- المرحلة الأولى لم تكتمل بعد.
- لم تبدأ المرحلة الثانية: لا gap analysis ولا خطة تنفيذ ولا قراءة موجهة لكود M1 لهذا الغرض.
- يلزم اعتماد المرحلة الأولى قبل المرحلة الثانية، ثم اعتماد الخطة قبل التنفيذ.
- لم يتم إجراء commit أو push أو تعديل كود التطبيق.

## تحديث الفحص بعد فتح المستخدم شاشة CRM

هذا التحديث يستبدل حالات «لم تُفحص» أعلاه فقط في البنود التي يسردها صراحة. بقية الفجوات ما زالت مفتوحة؛ المرحلة الأولى غير مكتملة.

### 1. المراحل المؤكدة

قراءة لوحة My Sales أظهرت الأعمدة بالترتيب التالي في شجرة الواجهة (الترتيب البصري والألوان لم يُتحقق منهما بسبب فشل التصوير):

| الترتيب | الاسم كما ظهر | العدد وقت القراءة |
|---|---|---|
| 1 | جديد | 5 |
| 2 | مؤهل | 4 |
| 3 | عرض سعر | 4 |
| 4 | رابح | 6 |
| 5 | مهتم | 30؛ تحميل تدريجي 20 من 30 وزر Load more (10) |
| 6 | GCT-0051 QUALIFIED | 1 |

هذه إعدادات نسخة الديمو، وليست بالضرورة مراحل افتراضية ثابتة للمنتج. لا يوجد دليل بعد على تعدد pipelines. كل عمود يعرض Collapse وSelect all in group وAdd Item وStage actions؛ عنوانه يحمل وصف Click to rename. لم تُستخدم إجراءات الإضافة أو إعادة التسمية أو النقل. صفحة الفرصة تعرض أزرار مراحل بالأسماء الستة نفسها، وMark as Won وMark as Lost. لم يُضغط أي منها؛ lost ليس عمودًا ظاهرًا في القراءة الحالية. السحب والأوتوميشن والـAI غير مختبرين.

### 2. حقول الفرصة المؤكدة

تمت قراءة فرصة موجودة فتحها المستخدم أثناء الفحص، رابطها يستخدم `view_type=form&id=31`، دون تعديلها. لم تُنسخ بيانات الاتصال الشخصية إلى هذا المستند.

| الحقل الظاهر | الدليل التقني المتاح | ملاحظات |
|---|---|---|
| Lead Name | عنصر إدخال ID=`field-name` | الإلزام غير مؤكد |
| Contact | علاقة ظاهرة مع زر Edit record | نوع العلاقة الدقيق غير مؤكد |
| Email | ID=`field-email` | فارغ في السجل المقروء |
| Phone | ID=`field-phone` | موجود في السجل المقروء |
| Assigned To | زر Select a user | لا تثبت هذه القراءة auto-assign |
| Sales Team | حقل علاقة ظاهر | الاختيارات غير مقروءة |
| Expected Revenue | إدخال رقمي ID=`field-expected_revenue` | صفر في العينة؛ لا دليل على العملة هنا |
| Success Probability (%) | قيمة ظاهرة 77% في العينة | طريقة حسابها غير معروفة |
| priority | عناصر رسومية وقيمة 5 في العينة | بعض بطاقات اللوحة تعرض 5/5؛ معنى المستويات غير مؤكد |
| Expected Closing | تاريخ بصيغة YYYY-MM-DD | فارغ في العينة |
| Tags | حقل ظاهر | الخيارات غير مقروءة |
| description | محرر Notes | اسم العنصر كما ظهر، وليس تأكيدًا لعمود DB |

لم يظهر دليل كافٍ لتحديد required/custom fields. أسماء فرص تحتوي WhatsApp أو Messenger أو Instagram لا تكفي لإثبات قيم حقل source.

### 3. العروض وأدوات اللوحة المؤكدة

- أزرار تبديل: Kanban، List، Graph، Pivot، Activity، Calendar. وجود الأزرار مؤكد؛ محتوى العروض الأخرى لم يُفتح بعد.
- Search مع Expand، وفلاتر سريعة Sales Person وSales Team وTags.
- Card interaction mode: Navigate أو Select، وقائمة More actions. لم تُفتح القائمة ولم تُنفذ bulk actions.
- بطاقة الفرصة يمكن أن تعرض العنوان والإيميل والهاتف والمبلغ وContact وCampaign والمسؤول واحتمال النجاح ومقياس priority. بعض البطاقات بها زر WhatsApp.
- علاقات البطاقة فيها View وزر Only cards with لتصفية البطاقات بالعلاقة المختارة.
- قوائم CRM العليا: Sales؛ Orders & Billing (الرابط يستخدم model=`account.move` وmodule=`crm_sales`)؛ Configuration (model=`crm.tag`). لا يثبت ذلك أسماء جداول فعلية.

### 4. صفحة الفرصة المؤكدة

- روابط عدادات: Quotations & Orders، Ad Clicks، Bookings؛ القيم صفر في العينة، ولم تُفتح الروابط.
- Previous record وNext record مع موضع السجل في المجموعة.
- Assign to Me وMark as Won وMark as Lost وBooking: إجراءات ظاهرة لم تُنفذ.
- تبويبات: Notes، Contact Information، Campaign Tracking، Lost Information، Ad Clicks. تمت قراءة Notes فقط؛ محاولة فتح Campaign Tracking فشلت لأن الأداة رفضت العنصر كغير متاح في حالتها المخبأة.
- Notes محرر نص منسق يدعم تنسيق النص والروابط والصور والصوت والمرفقات والجداول؛ لم يُكتب فيه شيء.
- منطقة السجل تحتوي Schedule activity، Send message، Log note، Follow، Open followers، Send Template، WhatsApp. لم تُضغط هذه الأزرار تجنبًا لأي أثر غير مؤكد.
- فلاتر السجل: All، Messages، Notes، Changes، Files، Starred؛ مع Search messages.
- حدث System ظاهر يسجل إنشاء lead مع تاريخ. هذا يثبت وجود سجل إنشاء، ولا يثبت تسجيل كل تغيير تلقائيًا.
- محتوى Notes في العينة يتضمن مرجع CTWA وإعلانًا ووقت نقرة وPost ID ورابط إعلان؛ هذه ملاحظة عن العينة، وليست مخطط attribution مؤكدًا.

### Data model: استنتاج محدث، غير معتمد من Network

يمكن استنتاج كيان Lead له عنوان وبيانات اتصال وإيراد متوقع واحتمال نجاح وأولوية وتاريخ إغلاق ووصف، ويرتبط منطقيًا بـContact وUser وSales Team وTags وStage. يوجد سجل نشاط/رسائل وعلاقات واجهة بعروض الأسعار والأوردرات والنقرات والحجوزات. Cardinality وأسماء foreign keys والجداول والـAPI payloads غير معروفة. أسماء `name` و`email` و`phone` و`expected_revenue` مستمدة من IDs عناصر الإدخال فقط.

### حدود الوصول الحالية

نجحت قراءة شجرة الواجهة، لكن التقاط screenshot فشل مجددًا بـFrameArrived timeout، والتنقل بالعناصر ما زال يفشل بـelement not available in cached app state. لم يُحفظ screenshot. لا تزال تفاصيل الأوتوميشن وأدوات AI والتقارير والصلاحيات والألوان والحقول الفرعية بحاجة لفحص فعلي؛ لا موافقة مطلوبة على المرحلة الثانية قبل اكتمال ذلك.
