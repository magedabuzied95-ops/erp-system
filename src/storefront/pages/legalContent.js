// Legal page content for /privacy, /terms and /data-deletion, in Arabic and English.
//
// WHY THIS IS NOT IN src/locales/*.json
// -------------------------------------
// The locale bundles are UI chrome, merged into one i18next namespace and mounted
// by hand in src/i18n/i18n.js. Legal prose is different: it is versioned product
// text that must be reviewable in a diff, must not be silently overwritten by a
// bundle merge, and must never fall back to a missing-key placeholder on a page a
// platform reviewer is reading. Keeping both languages colocated here makes every
// clause diffable and testable.
//
// PRESERVATION RULE
// -----------------
// Every Arabic clause that existed before the TikTok work is reproduced verbatim.
// Nothing about Meta, Facebook, Instagram, the storefront, the ERP, or customer
// data was removed, weakened, or reworded. The TikTok and third-party sections are
// purely additive.
//
// ACCURACY RULE
// -------------
// Every statement here describes behaviour that exists in the code at the time of
// writing. In particular: nothing claims that M1 Store reads or manages TikTok
// comments, because it does not. The third-party wording is written generally
// enough to remain true if further platform permissions are granted later, without
// asserting any capability that is not implemented today.

// Support contact, unchanged from the previous implementation.
// NOTE: this domain (m1store-eg.com) differs from the site domain
// (m1store-egy.com) and from the address used by the storefront footer and by
// outbound transactional email (support@m1store-egy.com). That discrepancy predates
// this change and is deliberately NOT "fixed" here — it needs the owner's decision,
// not a guess. See docs/tiktok-app-review-pack.md.
export const SUPPORT_EMAIL = "support@m1store-eg.com";

export const LEGAL_PAGE_KEYS = Object.freeze(["privacy", "terms", "data-deletion"]);

export const legalPageMeta = {
  privacy: {
    accent: "emerald",
    ar: {
      title: "سياسة الخصوصية - M1 ERP System / M1 Store",
      label: "سياسة الخصوصية",
      description: "سياسة الخصوصية الخاصة بمنصة M1 ERP System / M1 Store.",
      lead:
        "توضح هذه السياسة كيف يجمع M1 ERP System / M1 Store بيانات العملاء ويستخدمها لإدارة الطلبات، خدمة العملاء، الرسائل، والتحليلات، مع الحفاظ على الخصوصية وتقليل الوصول غير الضروري.",
    },
    en: {
      title: "Privacy Policy - M1 ERP System / M1 Store",
      label: "Privacy Policy",
      description: "Privacy Policy for the M1 ERP System / M1 Store platform.",
      lead:
        "This policy explains how M1 ERP System / M1 Store collects and uses customer data to manage orders, customer service, messaging and analytics, while protecting privacy and limiting unnecessary access.",
    },
  },
  terms: {
    accent: "amber",
    ar: {
      title: "شروط الاستخدام - M1 ERP System / M1 Store",
      label: "شروط الاستخدام",
      description: "شروط استخدام منصة M1 ERP System / M1 Store.",
      lead:
        "باستخدام المنصة أنت توافق على هذه الشروط. المنصة مخصصة لإدارة المبيعات، العملاء، الرسائل، الطلبات، والمخزون بشكل منظم وآمن.",
    },
    en: {
      title: "Terms of Service - M1 ERP System / M1 Store",
      label: "Terms of Service",
      description: "Terms of Service for the M1 ERP System / M1 Store platform.",
      lead:
        "By using the platform you agree to these terms. The platform is intended for managing sales, customers, messaging, orders and inventory in an organised and secure way.",
    },
  },
  "data-deletion": {
    accent: "rose",
    ar: {
      title: "حذف البيانات - M1 ERP System / M1 Store",
      label: "حذف البيانات",
      description: "تعليمات حذف بيانات المستخدم الخاصة بمنصة M1 ERP System / M1 Store.",
      lead:
        "يمكنك طلب حذف بياناتك المرتبطة بالنظام في أي وقت عبر البريد الإلكتروني بعد التحقق من الهوية والمعلومات المرتبطة بالحساب.",
    },
    en: {
      title: "Data Deletion - M1 ERP System / M1 Store",
      label: "Data Deletion",
      description: "User data deletion instructions for the M1 ERP System / M1 Store platform.",
      lead:
        "You can request deletion of your data held by the system at any time by email, after we verify your identity and the information linked to the account.",
    },
  },
};

// `icon` names map to the lucide components resolved in LegalPages.jsx. Keeping
// them as strings here keeps this module free of JSX so it can be imported by
// tests and by any future server-side renderer.
export const legalSections = {
  privacy: [
    // --- Pre-existing sections, preserved verbatim in Arabic -----------------
    {
      icon: "users",
      ar: {
        title: "ما الذي نجمعه",
        items: [
          "الاسم، رقم الهاتف، العنوان، والبريد الإلكتروني عند توفره.",
          "المحادثات والرسائل المتعلقة بالطلبات أو الدعم أو المتابعة.",
          "بيانات الطلبات، المنتجات، المدفوعات، وحالة الشحن والتسليم.",
          "بيانات الاستخدام الأساسية مثل نشاط الجلسة، التفاعل، وسجلات الأداء.",
        ],
      },
      en: {
        title: "What we collect",
        items: [
          "Name, phone number, address, and email address where provided.",
          "Conversations and messages relating to orders, support, or follow-up.",
          "Order, product, and payment data, together with shipping and delivery status.",
          "Basic usage data such as session activity, interactions, and performance logs.",
        ],
      },
    },
    {
      icon: "message",
      ar: {
        title: "كيف نستخدم البيانات",
        items: [
          "إدارة الطلبات والعمليات التشغيلية المرتبطة بالمبيعات.",
          "خدمة العملاء والرد على الاستفسارات والمتابعة بعد البيع.",
          "تحسين التجربة، التحليلات الداخلية، والتقارير التشغيلية.",
          "ربط المحادثات عبر Meta APIs مثل Messenger وInstagram وWhatsApp عند التفعيل.",
        ],
      },
      en: {
        title: "How we use data",
        items: [
          "Managing orders and the operational processes around sales.",
          "Customer service, answering enquiries, and post-sale follow-up.",
          "Improving the experience, internal analytics, and operational reporting.",
          "Connecting conversations through Meta APIs such as Messenger, Instagram and WhatsApp when enabled.",
        ],
      },
    },
    {
      icon: "shield",
      ar: {
        title: "الخصوصية والانتشار",
        items: [
          "لا يتم بيع بيانات العملاء إلى أي طرف ثالث.",
          "قد تتم مشاركة البيانات فقط مع مزودي الخدمة الضروريين لتشغيل المنصة أو تنفيذ الطلبات.",
          "يتم التعامل مع البيانات داخل حدود الوصول المصرح به فقط.",
          `يمكنك طلب تعديل أو حذف بياناتك عبر البريد التالي: ${SUPPORT_EMAIL}`,
        ],
      },
      en: {
        title: "Privacy and disclosure",
        items: [
          "Customer data is never sold to any third party.",
          "Data may be shared only with the service providers necessary to operate the platform or fulfil orders.",
          "Data is handled strictly within authorised access boundaries.",
          `You may request correction or deletion of your data at: ${SUPPORT_EMAIL}`,
        ],
      },
    },
    {
      icon: "sparkles",
      ar: {
        title: "الاحتفاظ والحقوق",
        items: [
          "نحتفظ بالبيانات للمدة اللازمة للتشغيل، الالتزامات القانونية، ودعم العملاء.",
          "يمكنك طلب الوصول أو التعديل أو الحذف متى رغبت عبر البريد.",
          "قد نحدث هذه السياسة عند تغير الخدمات أو المتطلبات التنظيمية.",
          `يُرجى استخدام البريد: ${SUPPORT_EMAIL}`,
        ],
      },
      en: {
        title: "Retention and your rights",
        items: [
          "We retain data for as long as needed for operations, legal obligations, and customer support.",
          "You may request access, correction, or deletion at any time by email.",
          "We may update this policy when our services or regulatory requirements change.",
          `Please use: ${SUPPORT_EMAIL}`,
        ],
      },
    },

    // --- Added for third-party platform integrations -------------------------
    {
      icon: "plug",
      ar: {
        title: "التكامل مع المنصات الخارجية",
        items: [
          "قد يتكامل M1 Store مع منصات خارجية مثل TikTok وFacebook وInstagram وغيرها من الخدمات.",
          "لا يتم الوصول إلى أي حساب خارجي إلا بعد أن يربطه مستخدم مصرح له صراحةً ويمنح الصلاحيات المطلوبة.",
          "لا نصل إلى أي حساب خارجي بدون تفويض من صاحبه.",
          "يقتصر نطاق ما نستطيع الوصول إليه على الصلاحيات التي منحها المستخدم فعليًا عبر المنصة الخارجية.",
        ],
      },
      en: {
        title: "Third-party platform integrations",
        items: [
          "M1 Store may integrate with third-party platforms such as TikTok, Facebook, Instagram, and other services.",
          "No external account is accessed unless an authorised user has explicitly connected it and granted the required permissions.",
          "We do not access any external account without its owner's authorisation.",
          "What we can access is limited to the permissions the user actually granted through the external platform.",
        ],
      },
    },
    {
      icon: "key",
      ar: {
        title: "الربط والتفويض (OAuth)",
        items: [
          "يتم ربط حساب TikTok فقط عندما يختار المستخدم «Connect TikTok» داخل M1 ERP.",
          "تتم الموافقة على الصلاحيات على شاشة التفويض الخاصة بـTikTok نفسها وليس داخل نظامنا.",
          "لا يحصل M1 Store على كلمة مرور حساب TikTok الخاص بالمستخدم ولا يطلبها في أي مرحلة.",
          "إذا رفض المستخدم منح الصلاحيات، لا يتم إنشاء أي اتصال ولا حفظ أي بيانات ربط.",
        ],
      },
      en: {
        title: "Connection and authorisation (OAuth)",
        items: [
          "A TikTok account is connected only when the user chooses \"Connect TikTok\" inside M1 ERP.",
          "Permissions are approved on TikTok's own authorisation screen, not inside our system.",
          "M1 Store never receives, and never asks for, the user's TikTok password.",
          "If the user declines the permissions, no connection is created and no connection data is stored.",
        ],
      },
    },
    {
      icon: "users",
      ar: {
        title: "بيانات حساب TikTok",
        items: [
          "قد نستقبل من TikTok البيانات التي يسمح بها المستخدم والمنصة، مثل معلومات الملف الشخصي الأساسية.",
          "قد يشمل ذلك الاسم المعروض، ومعرّف الحساب أو اسم المستخدم، وصورة الملف الشخصي إذا كانت متاحة.",
          "نحتفظ كذلك بحالة الاتصال والصلاحيات الممنوحة لعرضها للمستخدم وإدارة التكامل.",
          "لا نستقبل بيانات تتجاوز الصلاحيات التي منحها المستخدم فعليًا.",
        ],
      },
      en: {
        title: "TikTok account information",
        items: [
          "We may receive from TikTok the information the user and the platform permit, such as basic profile information.",
          "This may include the display name, the account identifier or username, and the profile image where available.",
          "We also keep the connection status and the granted permissions in order to display them to the user and manage the integration.",
          "We do not receive information beyond the permissions the user actually granted.",
        ],
      },
    },
    {
      icon: "shield",
      ar: {
        title: "بيانات التفويض",
        items: [
          "قد نخزّن بيانات التفويض اللازمة لاستمرار عمل التكامل بعد الربط.",
          "تُحفظ هذه البيانات بطريقة مصممة لحماية الوصول إلى الحساب المتصل، ولا تُعرض للمستخدم ولا لأي طرف ثالث.",
          "لا تُستخدم بيانات التفويض إلا لتنفيذ الوظائف التي فعّلها المستخدم داخل النظام.",
        ],
      },
      en: {
        title: "Authorisation credentials",
        items: [
          "We may store the authorisation credentials required to keep the integration working after connection.",
          "They are stored in a way designed to protect access to the connected account, and are never displayed to the user or shared with any third party.",
          "Authorisation credentials are used solely to perform the functions the user has enabled within the system.",
        ],
      },
    },
    {
      icon: "media",
      ar: {
        title: "الوسائط التي يقدّمها المستخدم",
        items: [
          "قد يختار المستخدم فيديو أو وسائط من داخل M1 ERP لإرسالها إلى TikTok.",
          "تُحفظ هذه الوسائط لدينا لغرض تنفيذ عملية النشر والاحتفاظ بسجل بما تم نشره.",
          "اختيار الوسائط وحده لا يؤدي إلى نشرها؛ لا يتم إرسال أي شيء إلى TikTok دون إجراء صريح من المستخدم.",
        ],
      },
      en: {
        title: "User-provided media",
        items: [
          "A user may select a video or other media from within M1 ERP to send to TikTok.",
          "Such media is stored by us in order to carry out the publishing action and to keep a record of what was published.",
          "Selecting media does not publish it; nothing is sent to TikTok without an explicit action by the user.",
        ],
      },
    },
    {
      icon: "send",
      ar: {
        title: "النشر إلى TikTok",
        items: [
          "لا ينشر M1 ERP أي محتوى إلى TikTok إلا بناءً على إجراء صريح من مستخدم مصرح له. لا يوجد نشر تلقائي.",
          "«النشر المباشر» يرسل الفيديو لينشر على حساب TikTok المتصل.",
          "«الرفع إلى مسودات TikTok» إجراء منفصل يرسل الفيديو إلى مسودات الحساب دون نشره.",
          "قد نحتفظ بحالة عملية النشر ومعرّفاتها لمتابعة النتيجة وعرضها داخل النظام.",
        ],
      },
      en: {
        title: "Publishing to TikTok",
        items: [
          "M1 ERP publishes content to TikTok only on an explicit action by an authorised user. There is no automatic publishing.",
          "\"Direct Post\" submits the video to be published on the connected TikTok account.",
          "\"Upload to TikTok Draft\" is a separate action that sends the video to the account's drafts without publishing it.",
          "We may retain the status and identifiers of a publishing operation in order to track and display its outcome within the system.",
        ],
      },
    },
    {
      icon: "settings",
      ar: {
        title: "إعدادات النشر",
        items: [
          "تأتي بعض إعدادات النشر من TikTok نفسه، مثل مستوى الخصوصية وإتاحة التعليقات وDuet وStitch.",
          "تعتمد الخيارات المتاحة على إعدادات وقدرات الحساب المتصل كما تعيدها TikTok.",
          "تُرسل الإعدادات التي يختارها المستخدم إلى TikTok كجزء من طلب النشر.",
          "إذا حدّد المستخدم أن المحتوى تجاري أو ترويجي أو محتوى براندد، تُرسل هذه الاختيارات أيضًا إلى TikTok ضمن عملية النشر.",
        ],
      },
      en: {
        title: "Posting settings",
        items: [
          "Some posting settings come from TikTok itself, such as the privacy level and whether comments, Duet and Stitch are permitted.",
          "The available options depend on the settings and capabilities of the connected account as reported by TikTok.",
          "The settings chosen by the user are sent to TikTok as part of the publishing request.",
          "If the user declares the content as commercial, promotional, or branded content, those declarations are also sent to TikTok as part of the publishing operation.",
        ],
      },
    },
    {
      icon: "sparkles",
      ar: {
        title: "استخدام بيانات التكامل والاحتفاظ بها",
        items: [
          "تُستخدم البيانات المستلمة من المنصات الخارجية فقط للأغراض المرتبطة بالوظائف التي فعّلها المستخدم: ربط الحساب، عرض حالة الاتصال، النشر، متابعة حالة النشر، وإدارة التكامل.",
          "لا نستخدم هذه البيانات في الإعلانات أو في بناء ملفات تعريفية للمستخدمين.",
          "لا يتم الاحتفاظ ببيانات التكامل مدة أطول مما تقتضيه الحاجة التشغيلية أو الالتزامات القانونية.",
          "قد نضيف وظائف جديدة لهذه التكاملات مستقبلًا، ولن يتم ذلك إلا بعد الحصول على الصلاحيات اللازمة من المنصة المعنية ومن المستخدم.",
        ],
      },
      en: {
        title: "Use and retention of integration data",
        items: [
          "Data received from third-party platforms is used only for purposes tied to the functions the user has enabled: connecting the account, showing connection status, publishing, tracking publishing status, and managing the integration.",
          "We do not use this data for advertising or to build user profiles.",
          "Integration data is not retained for longer than operational need or legal obligations require.",
            "We may add further functionality to these integrations in future; that will only happen after obtaining the necessary permissions from the platform concerned and from the user.",
        ],
      },
    },
    {
      icon: "unlink",
      ar: {
        title: "فصل الحساب وإلغاء الوصول",
        items: [
          "يمكن للمستخدم فصل حساب TikTok في أي وقت من داخل M1 ERP عبر إعدادات القنوات.",
          "يمكن للمستخدم أيضًا إلغاء وصول التطبيق من إعدادات TikTok نفسها حيثما توفر TikTok ذلك.",
          "بعد الفصل يتوقف استخدام تفويض هذا الاتصال ولا يُستخدم مستقبلًا.",
          "قد تبقى بعض السجلات التشغيلية أو المحاسبية المرتبطة بعمليات سابقة عند وجود سبب قانوني أو تشغيلي مشروع للاحتفاظ بها.",
        ],
      },
      en: {
        title: "Disconnecting and revoking access",
        items: [
          "A user may disconnect a TikTok account at any time from within M1 ERP, in Channel Settings.",
          "A user may also revoke the application's access from TikTok's own settings, where TikTok offers that.",
          "After disconnection, the authorisation for that connection is no longer used and is not used again.",
          "Some operational or accounting records relating to past operations may remain where there is a legitimate legal or operational reason to retain them.",
        ],
      },
    },
    {
      icon: "trash",
      ar: {
        title: "طلب حذف البيانات",
        items: [
          `يمكن طلب حذف البيانات المرتبطة بالمستخدم أو بالتكامل عبر البريد: ${SUPPORT_EMAIL}`,
          "يُرجى ذكر ما يكفي لتحديد الحساب أو الاتصال المطلوب حذفه، ويتم التحقق من الهوية قبل التنفيذ.",
          "تتوفر تعليمات الحذف التفصيلية على صفحة «حذف البيانات».",
        ],
      },
      en: {
        title: "Requesting data deletion",
        items: [
          `Deletion of data relating to a user or to an integration can be requested at: ${SUPPORT_EMAIL}`,
          "Please include enough detail to identify the account or connection concerned; identity is verified before deletion is carried out.",
          "Detailed deletion instructions are available on the Data Deletion page.",
        ],
      },
    },
    {
      icon: "external",
      ar: {
        title: "سياسات المنصات الخارجية",
        items: [
          "استخدام TikTok من خلال M1 Store يخضع أيضًا لشروط وسياسات TikTok نفسها.",
          "ينطبق الأمر ذاته على أي منصة خارجية أخرى يربطها المستخدم.",
          "تعالج كل منصة خارجية البيانات وفق سياساتها الخاصة، وهي خارج نطاق هذه السياسة.",
        ],
      },
      en: {
        title: "Third-party platform policies",
        items: [
          "Using TikTok through M1 Store is also subject to TikTok's own terms and policies.",
          "The same applies to any other third-party platform a user connects.",
          "Each third-party platform processes data under its own policies, which are outside the scope of this policy.",
        ],
      },
    },
  ],

  terms: [
    // --- Pre-existing sections, preserved verbatim in Arabic -----------------
    {
      icon: "shield",
      ar: {
        title: "قبول الشروط",
        items: [
          "استخدام المنصة يعني موافقتك على شروط الخدمة الحالية وأي تحديثات لاحقة.",
          "إذا لم توافق على الشروط، يجب التوقف عن استخدام المنصة.",
          "قد يتم تعديل الشروط من وقت لآخر لتناسب التغييرات التشغيلية أو القانونية.",
        ],
      },
      en: {
        title: "Acceptance of terms",
        items: [
          "Using the platform means you agree to the current terms of service and any later updates.",
          "If you do not agree to the terms, you must stop using the platform.",
          "The terms may be amended from time to time to reflect operational or legal changes.",
        ],
      },
    },
    {
      icon: "users",
      ar: {
        title: "الاستخدام المسموح",
        items: [
          "المنصة مخصصة لإدارة المبيعات، العملاء، الرسائل، الطلبات، والمخزون.",
          "يمكن استخدامها ضمن إجراءات العمل المعتمدة داخل M1 Store.",
          "يجب استخدام البيانات والأدوات بما يتوافق مع السياسات الداخلية ومتطلبات Meta وTikTok وأي منصة خارجية مرتبطة.",
        ],
      },
      en: {
        title: "Permitted use",
        items: [
          "The platform is intended for managing sales, customers, messaging, orders and inventory.",
          "It may be used within the approved business processes of M1 Store.",
          "Data and tools must be used in line with internal policies and with the requirements of Meta, TikTok, and any other connected third-party platform.",
        ],
      },
    },
    {
      icon: "trash",
      ar: {
        title: "الاستخدام المحظور",
        items: [
          "ممنوع إساءة الاستخدام أو محاولة اختراق النظام أو تجاوز الصلاحيات.",
          "ممنوع إرسال رسائل مزعجة أو غير مرخصة أو مخالفة لسياسات Meta أو TikTok.",
          "ممنوع استخدام المنصة فيما يضر العملاء أو السمعة أو سلامة البيانات.",
        ],
      },
      en: {
        title: "Prohibited use",
        items: [
          "Misuse, attempting to breach the system, or exceeding granted permissions is prohibited.",
          "Sending spam, unauthorised messages, or messages that violate Meta or TikTok policies is prohibited.",
          "Using the platform in ways that harm customers, reputation, or data integrity is prohibited.",
        ],
      },
    },

    // --- Added for third-party platform integrations -------------------------
    {
      icon: "plug",
      ar: {
        title: "ربط المنصات الخارجية",
        items: [
          "يمكن للمستخدم المصرح له ربط حسابات خارجية مثل TikTok بالمنصة.",
          "المستخدم مسؤول عن امتلاكه الصلاحية القانونية والإدارية لربط الحساب الذي يربطه.",
          "يعمل التكامل فقط في حدود الصلاحيات التي يمنحها المستخدم عبر المنصة الخارجية.",
          "يتم الربط من خلال شاشة تفويض المنصة الخارجية، ولا يُطلب من المستخدم إعطاء M1 Store كلمة مرور حسابه على تلك المنصة.",
        ],
      },
      en: {
        title: "Connecting third-party platforms",
        items: [
          "An authorised user may connect third-party accounts, such as TikTok, to the platform.",
          "The user is responsible for holding the legal and administrative authority to connect the account they connect.",
          "The integration operates only within the permissions the user grants through the third-party platform.",
          "Connection happens through the third-party platform's own authorisation screen; the user is never asked to give M1 Store their password for that platform.",
        ],
      },
    },
    {
      icon: "send",
      ar: {
        title: "مسؤولية النشر",
        items: [
          "المستخدم مسؤول عن المحتوى الذي يختار نشره من خلال المنصة.",
          "يُمنع نشر محتوى غير قانوني، أو محتوى لا يملك المستخدم حقوق استخدامه، أو محتوى ينتهك حقوق الملكية الفكرية.",
          "يُمنع نشر محتوى مضلل أو محظور أو مخالف لسياسات TikTok أو أي منصة أخرى.",
          "يظل المستخدم مسؤولًا عن الالتزام بشروط وسياسات المنصة التي ينشر عليها.",
        ],
      },
      en: {
        title: "Publishing responsibility",
        items: [
          "The user is responsible for the content they choose to publish through the platform.",
          "Publishing unlawful content, content the user does not hold the rights to use, or content that infringes intellectual property rights is prohibited.",
          "Publishing misleading or prohibited content, or content that violates TikTok's policies or those of any other platform, is prohibited.",
          "The user remains responsible for complying with the terms and policies of the platform they publish to.",
        ],
      },
    },
    {
      icon: "settings",
      ar: {
        title: "النشر على TikTok",
        items: [
          "لا يتم النشر المباشر على TikTok إلا بإجراء صريح من المستخدم؛ لا يوجد نشر تلقائي.",
          "«الرفع إلى مسودات TikTok» إجراء مختلف عن النشر المباشر، ويرسل الفيديو إلى المسودات دون نشره.",
          "قد ترفض TikTok أي عملية نشر أو تؤخرها أو تقيّدها وفق سياساتها.",
          "لا يضمن M1 Store قبول TikTok لأي منشور أو بقاءه منشورًا.",
        ],
      },
      en: {
        title: "Publishing to TikTok",
        items: [
          "Direct publishing to TikTok happens only on an explicit action by the user; there is no automatic publishing.",
          "\"Upload to TikTok Draft\" is a different action from direct publishing: it sends the video to drafts without publishing it.",
          "TikTok may reject, delay, or restrict any publishing operation in line with its policies.",
          "M1 Store does not guarantee that TikTok will accept any post, or that a post will remain published.",
        ],
      },
    },
    {
      icon: "external",
      ar: {
        title: "توافر المنصات الخارجية",
        items: [
          "تعتمد بعض الوظائف على واجهات TikTok البرمجية، وعلى صلاحيات الحساب، وعلى توافر المنصة وموافقاتها وحدود الاستخدام لديها.",
          "قد تتغير هذه الوظائف أو تتوقف نتيجة تغييرات تجريها TikTok أو أي منصة خارجية أخرى.",
          "هذه التغييرات ليست تحت سيطرة M1 Store ولا يتحمل مسؤولية انقطاعها.",
        ],
      },
      en: {
        title: "Third-party platform availability",
        items: [
          "Some functionality depends on TikTok's APIs, on account permissions, and on the platform's availability, approvals and rate limits.",
          "This functionality may change or stop working as a result of changes made by TikTok or any other third-party platform.",
          "Such changes are outside M1 Store's control, and M1 Store is not responsible for the resulting interruption.",
        ],
      },
    },
    {
      icon: "unlink",
      ar: {
        title: "فصل التكامل",
        items: [
          "يمكن للمستخدم فصل أي تكامل خارجي في أي وقت من داخل المنصة.",
          "يمكن أيضًا إلغاء وصول التطبيق من إعدادات المنصة الخارجية حيثما أتاحت ذلك.",
          "بعد الفصل تتوقف الوظائف المعتمدة على ذلك الاتصال.",
        ],
      },
      en: {
        title: "Disconnecting an integration",
        items: [
          "A user may disconnect any third-party integration at any time from within the platform.",
          "Access can also be revoked from the third-party platform's own settings, where it offers that.",
          "After disconnection, functionality that depends on that connection stops working.",
        ],
      },
    },

    // --- Pre-existing contact section, preserved -----------------------------
    {
      icon: "mail",
      ar: {
        title: "التواصل",
        items: [
          "للاستفسارات أو الملاحظات المتعلقة بالشروط، تواصل مع الدعم.",
          `البريد المعتمد: ${SUPPORT_EMAIL}`,
          "قد يُستخدم نفس البريد للمتابعة على طلبات التعديل أو الشكاوى.",
        ],
      },
      en: {
        title: "Contact",
        items: [
          "For questions or comments about these terms, please contact support.",
          `Official address: ${SUPPORT_EMAIL}`,
          "The same address may be used to follow up on correction requests or complaints.",
        ],
      },
    },
  ],

  "data-deletion": [
    {
      icon: "trash",
      ar: {
        title: "تعليمات حذف بيانات المستخدم",
        items: [
          `أرسل طلب حذف البيانات إلى ${SUPPORT_EMAIL}.`,
          "اذكر رقم الهاتف أو البريد الإلكتروني أو الصفحة المرتبطة بالحساب المراد حذفه.",
          "أضف أي تفاصيل تساعدنا على تحديد السجل الصحيح بسرعة.",
        ],
      },
      en: {
        title: "User data deletion instructions",
        items: [
          `Send a data deletion request to ${SUPPORT_EMAIL}.`,
          "Include the phone number, email address, or page associated with the account to be deleted.",
          "Add any details that help us identify the correct record quickly.",
        ],
      },
    },
    {
      icon: "shield",
      ar: {
        title: "ماذا يحدث بعد الطلب",
        items: [
          "يتم مراجعة الطلب والتحقق من هوية صاحب البيانات قبل التنفيذ.",
          "بعد التحقق، يتم حذف البيانات أو تعطيلها وفق ما تسمح به المتطلبات القانونية والتشغيلية.",
          "قد تبقى بعض السجلات الفنية المحدودة عند الحاجة للامتثال أو منع الإساءة.",
        ],
      },
      en: {
        title: "What happens after a request",
        items: [
          "The request is reviewed and the data subject's identity is verified before anything is carried out.",
          "After verification, the data is deleted or deactivated to the extent permitted by legal and operational requirements.",
          "Limited technical records may remain where needed for compliance or abuse prevention.",
        ],
      },
    },
    {
      icon: "users",
      ar: {
        title: "نطاق الحذف",
        items: [
          "يشمل الطلب بيانات الاتصال، المحادثات، الطلبات، وسجلات الاستخدام المرتبطة.",
          "يشمل كذلك بيانات ربط أي منصة خارجية متصلة، مثل TikTok، وبيانات التفويض الخاصة بها.",
          "قد يُستثنى ما يجب الاحتفاظ به قانونيًا أو محاسبيًا أو تشغيليًا.",
          `للمتابعة: ${SUPPORT_EMAIL}`,
        ],
      },
      en: {
        title: "Scope of deletion",
        items: [
          "A request covers contact details, conversations, orders, and the related usage records.",
          "It also covers the connection data for any connected third-party platform, such as TikTok, and its authorisation credentials.",
          "Data that must be retained for legal, accounting, or operational reasons may be excluded.",
          `To follow up: ${SUPPORT_EMAIL}`,
        ],
      },
    },
  ],
};

export const legalUiStrings = {
  ar: {
    backToShop: "العودة إلى المتجر",
    officialContact: "التواصل الرسمي",
    officialContactLead: "لجميع طلبات الدعم أو الخصوصية أو حذف البيانات.",
    entity: "M1 ERP System / M1 Store",
    approvedEmail: "البريد المعتمد:",
    contactNote: "يمكنك استخدام نفس البريد لطلبات التعديل، الحذف، أو أي استفسار متعلق بسياسات المنصة.",
    quickLinks: "روابط سريعة",
    privacy: "سياسة الخصوصية",
    terms: "شروط الاستخدام",
    dataDeletion: "حذف البيانات",
    languageSwitchLabel: "English",
    lastUpdatedLabel: "آخر تحديث:",
  },
  en: {
    backToShop: "Back to the store",
    officialContact: "Official contact",
    officialContactLead: "For all support, privacy, or data deletion requests.",
    entity: "M1 ERP System / M1 Store",
    approvedEmail: "Official address:",
    contactNote: "You can use the same address for correction requests, deletion requests, or any question about the platform's policies.",
    quickLinks: "Quick links",
    privacy: "Privacy Policy",
    terms: "Terms of Service",
    dataDeletion: "Data Deletion",
    languageSwitchLabel: "العربية",
    lastUpdatedLabel: "Last updated:",
  },
};

// Bumped whenever the substance of a policy changes, so a reviewer (and a user)
// can see the page is current rather than guessing.
export const LEGAL_LAST_UPDATED = "2026-08-14";

export const legalMetaFor = (pageKey, language) => {
  const meta = legalPageMeta[pageKey];
  if (!meta) return null;
  return { accent: meta.accent, ...(meta[language] || meta.ar) };
};

export const legalSectionsFor = (pageKey, language) =>
  (legalSections[pageKey] || []).map((section) => ({
    icon: section.icon,
    ...(section[language] || section.ar),
  }));
