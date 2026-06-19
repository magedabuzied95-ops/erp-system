import { useEffect } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Mail, ShieldCheck, FileText, Trash2, Sparkles, Users, MessageCircle } from "lucide-react";

const SUPPORT_EMAIL = "support@m1store-eg.com";

const sectionsClass = "grid gap-4 md:grid-cols-2";
const cardClass =
  "rounded-[1.6rem] border border-slate-200/80 bg-white/88 p-5 shadow-[0_18px_54px_rgba(15,23,42,0.08)] backdrop-blur-xl dark:border-white/10 dark:bg-[linear-gradient(180deg,rgba(7,11,22,0.96),rgba(7,11,22,0.88))] dark:shadow-[0_24px_80px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.05)]";
const badgeClass =
  "inline-flex items-center gap-2 rounded-full border border-emerald-300/20 bg-emerald-500/10 px-3 py-1 text-[11px] font-black uppercase tracking-[0.14em] text-emerald-700 dark:border-emerald-300/20 dark:text-emerald-200";

const pageMeta = {
  privacy: {
    title: "Privacy Policy - M1 ERP System / M1 Store",
    label: "Privacy Policy",
    description: "سياسة الخصوصية الخاصة بمنصة M1 ERP System / M1 Store.",
    icon: ShieldCheck,
    accent: "emerald",
    lead:
      "توضح هذه السياسة كيف يجمع M1 ERP System / M1 Store بيانات العملاء ويستخدمها لإدارة الطلبات، خدمة العملاء، الرسائل، والتحليلات، مع الحفاظ على الخصوصية وتقليل الوصول غير الضروري.",
  },
  terms: {
    title: "Terms of Service - M1 ERP System / M1 Store",
    label: "Terms of Service",
    description: "شروط استخدام منصة M1 ERP System / M1 Store.",
    icon: FileText,
    accent: "amber",
    lead:
      "باستخدام المنصة أنت توافق على هذه الشروط. المنصة مخصصة لإدارة المبيعات، العملاء، الرسائل، الطلبات، والمخزون بشكل منظم وآمن.",
  },
  "data-deletion": {
    title: "Data Deletion - M1 ERP System / M1 Store",
    label: "Data Deletion",
    description: "تعليمات حذف بيانات المستخدم الخاصة بمنصة M1 ERP System / M1 Store.",
    icon: Trash2,
    accent: "rose",
    lead:
      "يمكنك طلب حذف بياناتك المرتبطة بالنظام في أي وقت عبر البريد الإلكتروني بعد التحقق من الهوية والمعلومات المرتبطة بالحساب.",
  },
};

const accentMap = {
  emerald: {
    shell:
      "border-emerald-200/55 bg-[radial-gradient(circle_at_16%_0%,rgba(16,185,129,0.22),transparent_26%),linear-gradient(135deg,rgba(255,255,255,0.92),rgba(236,253,245,0.6))] dark:border-emerald-300/15 dark:bg-[radial-gradient(circle_at_16%_0%,rgba(16,185,129,0.16),transparent_26%),linear-gradient(135deg,rgba(255,255,255,0.06),rgba(16,185,129,0.06))]",
    hero:
      "from-emerald-500/18 via-white/65 to-white/90 dark:from-emerald-400/16 dark:via-white/6 dark:to-slate-950/84",
    pill: "border-emerald-300/25 bg-emerald-500/10 text-emerald-800 dark:text-emerald-100",
  },
  amber: {
    shell:
      "border-amber-200/55 bg-[radial-gradient(circle_at_84%_0%,rgba(245,158,11,0.22),transparent_26%),linear-gradient(135deg,rgba(255,255,255,0.92),rgba(255,251,235,0.64))] dark:border-amber-300/15 dark:bg-[radial-gradient(circle_at_84%_0%,rgba(245,158,11,0.16),transparent_26%),linear-gradient(135deg,rgba(255,255,255,0.06),rgba(245,158,11,0.06))]",
    hero:
      "from-amber-500/18 via-white/65 to-white/90 dark:from-amber-400/16 dark:via-white/6 dark:to-slate-950/84",
    pill: "border-amber-300/25 bg-amber-500/10 text-amber-800 dark:text-amber-100",
  },
  rose: {
    shell:
      "border-rose-200/55 bg-[radial-gradient(circle_at_84%_0%,rgba(244,63,94,0.18),transparent_26%),linear-gradient(135deg,rgba(255,255,255,0.92),rgba(255,241,242,0.66))] dark:border-rose-300/15 dark:bg-[radial-gradient(circle_at_84%_0%,rgba(244,63,94,0.14),transparent_26%),linear-gradient(135deg,rgba(255,255,255,0.06),rgba(244,63,94,0.06))]",
    hero:
      "from-rose-500/18 via-white/65 to-white/90 dark:from-rose-400/16 dark:via-white/6 dark:to-slate-950/84",
    pill: "border-rose-300/25 bg-rose-500/10 text-rose-800 dark:text-rose-100",
  },
};

const sectionsByPage = {
  privacy: [
    {
      title: "ما الذي نجمعه",
      icon: Users,
      items: [
        "الاسم، رقم الهاتف، العنوان، والبريد الإلكتروني عند توفره.",
        "المحادثات والرسائل المتعلقة بالطلبات أو الدعم أو المتابعة.",
        "بيانات الطلبات، المنتجات، المدفوعات، وحالة الشحن والتسليم.",
        "بيانات الاستخدام الأساسية مثل نشاط الجلسة، التفاعل، وسجلات الأداء.",
      ],
    },
    {
      title: "كيف نستخدم البيانات",
      icon: MessageCircle,
      items: [
        "إدارة الطلبات والعمليات التشغيلية المرتبطة بالمبيعات.",
        "خدمة العملاء والرد على الاستفسارات والمتابعة بعد البيع.",
        "تحسين التجربة، التحليلات الداخلية، والتقارير التشغيلية.",
        "ربط المحادثات عبر Meta APIs مثل Messenger وInstagram وWhatsApp عند التفعيل.",
      ],
    },
    {
      title: "الخصوصية والانتشار",
      icon: ShieldCheck,
      items: [
        "لا يتم بيع بيانات العملاء إلى أي طرف ثالث.",
        "قد تتم مشاركة البيانات فقط مع مزودي الخدمة الضروريين لتشغيل المنصة أو تنفيذ الطلبات.",
        "يتم التعامل مع البيانات داخل حدود الوصول المصرح به فقط.",
        "يمكنك طلب تعديل أو حذف بياناتك عبر البريد التالي: support@m1store-eg.com",
      ],
    },
    {
      title: "الاحتفاظ والحقوق",
      icon: Sparkles,
      items: [
        "نحتفظ بالبيانات للمدة اللازمة للتشغيل، الالتزامات القانونية، ودعم العملاء.",
        "يمكنك طلب الوصول أو التعديل أو الحذف متى رغبت عبر البريد.",
        "قد نحدث هذه السياسة عند تغير الخدمات أو المتطلبات التنظيمية.",
        "يُرجى استخدام البريد: support@m1store-eg.com",
      ],
    },
  ],
  terms: [
    {
      title: "قبول الشروط",
      icon: ShieldCheck,
      items: [
        "استخدام المنصة يعني موافقتك على شروط الخدمة الحالية وأي تحديثات لاحقة.",
        "إذا لم توافق على الشروط، يجب التوقف عن استخدام المنصة.",
        "قد يتم تعديل الشروط من وقت لآخر لتناسب التغييرات التشغيلية أو القانونية.",
      ],
    },
    {
      title: "الاستخدام المسموح",
      icon: Users,
      items: [
        "المنصة مخصصة لإدارة المبيعات، العملاء، الرسائل، الطلبات، والمخزون.",
        "يمكن استخدامها ضمن إجراءات العمل المعتمدة داخل M1 Store.",
        "يجب استخدام البيانات والأدوات بما يتوافق مع السياسات الداخلية ومتطلبات Meta.",
      ],
    },
    {
      title: "الاستخدام المحظور",
      icon: Trash2,
      items: [
        "ممنوع إساءة الاستخدام أو محاولة اختراق النظام أو تجاوز الصلاحيات.",
        "ممنوع إرسال رسائل مزعجة أو غير مرخصة أو مخالفة لسياسات Meta.",
        "ممنوع استخدام المنصة فيما يضر العملاء أو السمعة أو سلامة البيانات.",
      ],
    },
    {
      title: "التواصل",
      icon: Mail,
      items: [
        "للاستفسارات أو الملاحظات المتعلقة بالشروط، تواصل مع الدعم.",
        "البريد المعتمد: support@m1store-eg.com",
        "قد يُستخدم نفس البريد للمتابعة على طلبات التعديل أو الشكاوى.",
      ],
    },
  ],
  "data-deletion": [
    {
      title: "User Data Deletion Instructions",
      icon: Trash2,
      items: [
        "أرسل طلب حذف البيانات إلى support@m1store-eg.com.",
        "اذكر رقم الهاتف أو البريد الإلكتروني أو الصفحة المرتبطة بالحساب المراد حذفه.",
        "أضف أي تفاصيل تساعدنا على تحديد السجل الصحيح بسرعة.",
      ],
    },
    {
      title: "ماذا يحدث بعد الطلب",
      icon: ShieldCheck,
      items: [
        "يتم مراجعة الطلب والتحقق من هوية صاحب البيانات قبل التنفيذ.",
        "بعد التحقق، يتم حذف البيانات أو تعطيلها وفق ما تسمح به المتطلبات القانونية والتشغيلية.",
        "قد تبقى بعض السجلات الفنية المحدودة عند الحاجة للامتثال أو منع الإساءة.",
      ],
    },
    {
      title: "نطاق الحذف",
      icon: Users,
      items: [
        "يشمل الطلب بيانات الاتصال، المحادثات، الطلبات، وسجلات الاستخدام المرتبطة.",
        "قد يُستثنى ما يجب الاحتفاظ به قانونيًا أو محاسبيًا أو تشغيليًا.",
        "للمتابعة: support@m1store-eg.com",
      ],
    },
  ],
};

function LegalShell({ pageKey }) {
  const meta = pageMeta[pageKey];
  const accent = accentMap[meta.accent];
  const Icon = meta.icon;

  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const previousTitle = document.title;
    document.title = meta.title;
    return () => {
      document.title = previousTitle;
    };
  }, [meta.title]);

  return (
    <main dir="rtl" className="min-h-screen overflow-hidden bg-[linear-gradient(180deg,#f7f4ee_0%,#ffffff_38%,#f2f7f5_100%)] text-slate-950 dark:bg-[radial-gradient(circle_at_top,rgba(7,11,22,1),rgba(2,6,23,1)_60%,rgba(3,7,18,1)_100%)] dark:text-white">
      <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_12%_18%,rgba(16,185,129,0.12),transparent_24%),radial-gradient(circle_at_88%_12%,rgba(245,158,11,0.12),transparent_22%),radial-gradient(circle_at_50%_100%,rgba(124,58,237,0.08),transparent_28%)] dark:bg-[radial-gradient(circle_at_12%_18%,rgba(16,185,129,0.10),transparent_24%),radial-gradient(circle_at_88%_12%,rgba(245,158,11,0.08),transparent_22%),radial-gradient(circle_at_50%_100%,rgba(124,58,237,0.10),transparent_28%)]" />
      <section className="relative mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 py-5 sm:px-6 lg:px-8 lg:py-8">
        <header className={`overflow-hidden rounded-[2rem] border px-5 py-6 shadow-[0_24px_70px_rgba(15,23,42,0.10)] backdrop-blur-2xl ${accent.shell}`}>
          <div className={`rounded-[1.6rem] border border-white/70 bg-[linear-gradient(135deg,rgba(255,255,255,0.92),rgba(255,255,255,0.68))] p-5 dark:border-white/10 dark:bg-[linear-gradient(135deg,rgba(255,255,255,0.06),rgba(255,255,255,0.02))]`}>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="max-w-2xl">
                <span className={badgeClass}>{meta.label}</span>
                <h1 className="mt-4 text-3xl font-black tracking-tight sm:text-4xl">{meta.title}</h1>
                <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600 dark:text-slate-300 sm:text-base">{meta.lead}</p>
              </div>
              <div className={`grid h-16 w-16 place-items-center rounded-[1.5rem] border border-white/70 bg-white text-slate-950 shadow-[0_18px_40px_rgba(15,23,42,0.10)] dark:border-white/10 dark:bg-white/5 dark:text-white ${accent.pill}`}>
                <Icon className="h-8 w-8" />
              </div>
            </div>
            <div className="mt-5 flex flex-wrap items-center gap-2">
              <Link
                to="/shop"
                className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-800 transition hover:-translate-y-0.5 hover:border-slate-300 hover:text-slate-950 dark:border-white/10 dark:bg-white/[0.06] dark:text-slate-100 dark:hover:border-white/20"
              >
                <ArrowLeft className="h-4 w-4" />
                العودة إلى المتجر
              </Link>
              <a
                href={`mailto:${SUPPORT_EMAIL}`}
                className="inline-flex items-center gap-2 rounded-full border border-emerald-300/25 bg-emerald-500/10 px-4 py-2 text-sm font-black text-emerald-800 transition hover:-translate-y-0.5 hover:bg-emerald-500/15 dark:text-emerald-100"
              >
                <Mail className="h-4 w-4" />
                {SUPPORT_EMAIL}
              </a>
            </div>
          </div>
        </header>

        <section className="mt-5 grid gap-4 lg:grid-cols-2">
          {sectionsByPage[pageKey].map((section) => {
            const SectionIcon = section.icon;
            return (
              <article key={section.title} className={cardClass}>
                <div className="flex items-center gap-3">
                  <div className="grid h-11 w-11 place-items-center rounded-2xl border border-slate-200 bg-slate-50 text-slate-700 dark:border-white/10 dark:bg-white/5 dark:text-slate-100">
                    <SectionIcon className="h-5 w-5" />
                  </div>
                  <h2 className="text-lg font-black tracking-tight">{section.title}</h2>
                </div>
                <ul className="mt-4 space-y-3 text-sm leading-7 text-slate-700 dark:text-slate-300">
                  {section.items.map((item) => (
                    <li key={item} className="flex gap-3">
                      <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-emerald-500 dark:bg-emerald-300" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </article>
            );
          })}
        </section>

        <section className="mt-5 grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <article className={`${cardClass} ${accent.hero}`}>
            <div className="flex items-center gap-3">
              <div className="grid h-11 w-11 place-items-center rounded-2xl border border-white/60 bg-white text-slate-950 shadow-sm dark:border-white/10 dark:bg-white/5 dark:text-white">
                <Mail className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-black tracking-tight">التواصل الرسمي</h2>
                <p className="text-sm font-bold text-slate-600 dark:text-slate-300">لجميع طلبات الدعم أو الخصوصية أو حذف البيانات.</p>
              </div>
            </div>
            <div className="mt-4 rounded-[1.3rem] border border-slate-200 bg-white/90 p-4 text-sm leading-7 text-slate-700 dark:border-white/10 dark:bg-white/[0.045] dark:text-slate-200">
              <p className="font-bold">M1 ERP System / M1 Store</p>
              <p className="mt-2">البريد المعتمد: <a className="font-black text-emerald-700 underline decoration-emerald-300 decoration-2 underline-offset-4 dark:text-emerald-200" href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a></p>
              <p className="mt-2">يمكنك استخدام نفس البريد لطلبات التعديل، الحذف، أو أي استفسار متعلق بسياسات المنصة.</p>
            </div>
          </article>

          <article className={cardClass}>
            <h2 className="text-lg font-black tracking-tight">روابط سريعة</h2>
            <div className="mt-4 grid gap-3">
              <Link to="/privacy" className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-black text-slate-800 transition hover:-translate-y-0.5 hover:border-emerald-300/50 hover:text-emerald-800 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-100 dark:hover:text-emerald-200">Privacy Policy</Link>
              <Link to="/terms" className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-black text-slate-800 transition hover:-translate-y-0.5 hover:border-amber-300/50 hover:text-amber-800 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-100 dark:hover:text-amber-200">Terms of Service</Link>
              <Link to="/data-deletion" className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-black text-slate-800 transition hover:-translate-y-0.5 hover:border-rose-300/50 hover:text-rose-800 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-100 dark:hover:text-rose-200">Data Deletion</Link>
            </div>
          </article>
        </section>
      </section>
    </main>
  );
}

export function PrivacyPage() {
  return <LegalShell pageKey="privacy" />;
}

export function TermsPage() {
  return <LegalShell pageKey="terms" />;
}

export function DataDeletionPage() {
  return <LegalShell pageKey="data-deletion" />;
}

