import { useEffect, useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Footprints, ArrowUpRight } from "lucide-react";

import { sfText } from "../Storefront";
import { SIZE_GUIDE_TABS, buildSizeGuidePath, getSizeGuideConfig, normalizeSizeGuideType } from "../lib/sizeGuide";

const sizeGuidePhoto = "https://cdn.shopify.com/s/files/1/0592/5807/7362/files/measure-foot-at-home-guide.png?v=1759953450";

function StorefrontSizeGuidePage() {
  const [searchParams] = useSearchParams();
  const requestedType = searchParams.get("type") || "";
  const activeType = useMemo(() => normalizeSizeGuideType(requestedType) || "men", [requestedType]);
  const guide = useMemo(() => getSizeGuideConfig(activeType), [activeType]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.title = `${guide.title} | M1 Store`;
  }, [guide.title]);

  const measureSteps = [
    ["1", sfText("storefront.sizeGuide.steps.paper.title", "ضع ورقة"), sfText("storefront.sizeGuide.steps.paper.text", "ضع ورقة تحت القدم بحيث تستند بشكل مستقيم على الأرض.")],
    ["2", sfText("storefront.sizeGuide.steps.mark.title", "علّم الطول"), sfText("storefront.sizeGuide.steps.mark.text", "حدد بداية الكعب ونهاية أطول إصبع على الورقة.")],
    ["3", sfText("storefront.sizeGuide.steps.measure.title", "قِس بالسنتيمتر"), sfText("storefront.sizeGuide.steps.measure.text", "استخدم مسطرة لقياس المسافة بين العلامتين بالسنتيمتر.")],
    ["4", sfText("storefront.sizeGuide.steps.larger.title", "اختر الأكبر عند التردد"), sfText("storefront.sizeGuide.steps.larger.text", "إذا كنت بين مقاسين، اختر المقاس الأكبر لراحة أفضل.")],
  ];

  return (
    <section className="sf-size-guide-page mx-auto max-w-6xl px-4 py-8 md:py-12 text-white" dir="rtl">
      <div className="mb-6 flex flex-col gap-3 md:mb-8 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-black text-[#f3d77a]">{sfText("storefront.sizeGuide.eyebrow", "دليل المقاسات")}</p>
          <h1 className="mt-1 text-3xl font-black tracking-normal md:text-5xl">{guide.title}</h1>
          <p className="mt-3 max-w-2xl text-sm font-bold leading-7 text-slate-300 md:text-base">
            {sfText("storefront.sizeGuide.subtitle", "اختر المقاس المناسب من خلال جدول واضح وطريقة قياس بسيطة قبل الشراء.")}
          </p>
        </div>
        <div className="inline-flex w-fit items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-4 py-2 text-xs font-black text-slate-200 shadow-sm">
          <Footprints className="h-4 w-4 text-[#f3d77a]" />
          {sfText("storefront.sizeGuide.centimeterMeasurement", "قياسات بالسنتيمتر")}
        </div>
      </div>

      <div className="mb-5 flex flex-wrap gap-2">
        {SIZE_GUIDE_TABS.map((type) => {
          const config = getSizeGuideConfig(type);
          const active = type === activeType;
          return (
            <Link
              key={type}
              to={buildSizeGuidePath(type)}
              className={`inline-flex min-h-10 items-center justify-center rounded-full border px-4 py-2 text-sm font-black transition ${
                active
                  ? "border-[#d4af37]/60 bg-[rgba(212,175,55,0.14)] text-[#f3d77a] shadow-[0_12px_28px_rgba(212,175,55,0.22)]"
                  : "border-white/10 bg-white/[0.04] text-slate-200 hover:border-[#d4af37]/30 hover:bg-white/[0.08] hover:text-white"
              }`}
            >
              {config.label}
            </Link>
          );
        })}
      </div>

      <div className="overflow-hidden rounded-[1.75rem] border border-white/10 bg-[linear-gradient(145deg,rgba(5,5,5,0.98),rgba(16,16,16,0.95)_45%,rgba(21,21,21,0.96))] shadow-[0_24px_80px_rgba(0,0,0,0.42),inset_0_1px_0_rgba(255,255,255,0.06)]">
        <div className="border-b border-white/10 px-4 py-4 sm:px-6">
          <h2 className="text-xl font-black text-white">{sfText("storefront.sizeGuide.tableTitle", "جدول المقاسات")}</h2>
          <p className="mt-1 text-sm font-bold text-slate-400">{sfText("storefront.sizeGuide.mobileScrollHint", "مرّر أفقياً على الهاتف إذا لزم الأمر.")}</p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-right text-sm font-bold">
            <thead>
              <tr className="border-b border-white/10 bg-white/[0.045] text-xs font-black uppercase tracking-[0.12em] text-slate-300">
                {guide.columns.map((column) => (
                  <th key={column} className="whitespace-nowrap px-5 py-4">{column}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {guide.rows.map((row) => (
                <tr key={row[0]} className="text-slate-200 transition hover:bg-white/[0.06]">
                  {row.map((cell, index) => (
                    <td key={`${row[0]}-${index}`} className={`whitespace-nowrap px-5 py-4 ${index === 0 ? "text-lg font-black text-white" : "text-slate-100"}`}>
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-5 rounded-[1.75rem] border border-white/10 bg-[linear-gradient(145deg,rgba(5,5,5,0.94),rgba(16,16,16,0.90))] p-5 shadow-[0_20px_70px_rgba(0,0,0,0.34),inset_0_1px_0_rgba(255,255,255,0.05)] sm:p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <h2 className="text-2xl font-black text-white">{sfText("storefront.sizeGuide.measurementMethod", "طريقة قياس القدم")}</h2>
            <p className="mt-2 max-w-2xl text-sm font-bold leading-7 text-slate-300">
              {sfText("storefront.sizeGuide.measurementIntro", "استخدم ورقة ومستطيل قياس بسيط لتحديد الطول الحقيقي للقدم قبل اختيار المقاس.")}
            </p>
          </div>
          <a
            href="https://wa.me/"
            className="inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-full border border-emerald-300/25 bg-emerald-500/95 px-5 py-3 text-sm font-black text-white shadow-[0_14px_34px_rgba(16,185,129,0.28)] transition hover:-translate-y-0.5 hover:bg-emerald-400"
          >
            <ArrowUpRight className="h-4 w-4" />
            {sfText("storefront.support.whatsappHelp", "تواصل معنا")}
          </a>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {measureSteps.map(([number, title, text]) => (
            <div key={number} className="rounded-2xl border border-white/10 bg-white/[0.045] p-4">
              <span className="grid h-9 w-9 place-items-center rounded-full border border-[#d4af37]/20 bg-[#d4af37]/10 text-sm font-black text-[#f3d77a]">
                {number}
              </span>
              <h3 className="mt-3 font-black text-white">{title}</h3>
              <p className="mt-2 text-sm font-bold leading-6 text-slate-300">{text}</p>
            </div>
          ))}
        </div>

        <div className="mt-6 overflow-hidden rounded-[1.5rem] border border-white/10 bg-[linear-gradient(180deg,#050505_0%,#101010_100%)] p-4 shadow-[0_20px_70px_rgba(0,0,0,0.36),inset_0_1px_0_rgba(255,255,255,0.05)] sm:p-6">
          <div className="mx-auto w-full max-w-3xl">
            <div className="overflow-hidden rounded-[1.5rem] border border-white/10 bg-[#101010]">
              <img
                src={sizeGuidePhoto}
                alt={sfText("storefront.sizeGuide.illustrationAria", "طريقة قياس القدم")}
                className="h-auto w-full object-cover"
                loading="lazy"
              />
            </div>
          </div>
          <p className="mx-auto mt-3 max-w-2xl text-center text-sm font-black leading-7 text-slate-300">
            {sfText("storefront.sizeGuide.measurementCaption", "إذا كنت بين مقاسين، ننصح باختيار المقاس الأكبر.")}
          </p>
        </div>
      </div>
    </section>
  );
}

export default StorefrontSizeGuidePage;
