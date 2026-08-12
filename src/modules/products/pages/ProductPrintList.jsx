import { useMemo, useState } from "react";
import { Combine, Download, PackageOpen, Printer, Trash2 } from "lucide-react";
import toast from "react-hot-toast";

import ProductsShell from "../components/ProductsShell";
import { resolveProductImageUrl } from "../../../shared/lib/imageUrls";
import { buildProductLabelPrintPlan, groupProductLabelPdfJobs } from "../../../../shared/productLabelPrintPlan.js";
import { generateProductLabelJobPdf } from "../lib/productLabelJobsPdf";
import { generateBarcodeLabelsPdf } from "../lib/barcodePdfGenerator";
import {
  clearProductPrintList,
  productPrintAudiences,
  printListSection,
  readProductPrintList,
  removeProductFromPrintList,
} from "../lib/productPrintList";

const SECTIONS = [
  { key: "sneakers", label: "كوتشي" },
  { key: "bags", label: "شنط" },
  { key: "crocs", label: "كروكس" },
  { key: "slippers", label: "سليبر" },
];

const AUDIENCES = [
  { key: "all", label: "الكل" },
  { key: "men", label: "رجالي" },
  { key: "women", label: "حريمي" },
  { key: "kids", label: "أطفال" },
];

const stockCount = (product) =>
  (Array.isArray(product?.variants) ? product.variants : []).reduce(
    (sum, variant) => sum + Math.max(0, Number(variant.stock ?? variant.quantity ?? 0) || 0),
    0
  );

const imageFor = (product) =>
  product?.image_url ||
  product?.product_image_url ||
  product?.variants?.find((variant) => variant.image_url || variant.color_image_url)?.image_url ||
  product?.variants?.find((variant) => variant.color_image_url)?.color_image_url ||
  "";

const articleFor = (product) =>
  product?.variants?.find((variant) => variant.color_article_code || variant.article_code)?.color_article_code ||
  product?.variants?.find((variant) => variant.article_code)?.article_code ||
  "—";

const generatePrintJobPdf = (job) =>
  job.key === "box"
    ? generateBarcodeLabelsPdf(job.labels, { title: "Shoe Box Labels 100x50" })
    : generateProductLabelJobPdf(job);

const productForAudience = (product, section, audience) => {
  if (section !== "sneakers" || audience === "all") return product;
  const variants = (Array.isArray(product?.variants) ? product.variants : []).filter((variant) => {
    const values = String(variant.audience || variant.gender || product.gender || "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);
    return values.includes(audience) || (!values.length && productPrintAudiences(product).includes(audience));
  });
  return { ...product, variants };
};

export default function ProductPrintList() {
  const [products, setProducts] = useState(readProductPrintList);
  const [section, setSection] = useState("sneakers");
  const [audience, setAudience] = useState("all");
  const [busyKey, setBusyKey] = useState("");

  const visibleProducts = useMemo(
    () => products.filter((product) =>
      printListSection(product) === section &&
      (section !== "sneakers" || audience === "all" || productPrintAudiences(product).includes(audience))
    ),
    [audience, products, section]
  );

  const mergedPrintPlan = useMemo(
    () => buildProductLabelPrintPlan(
      visibleProducts.map((product) => productForAudience(product, section, audience))
    ),
    [audience, section, visibleProducts]
  );
  const mergedJobs = useMemo(
    () => groupProductLabelPdfJobs(mergedPrintPlan),
    [mergedPrintPlan]
  );

  const remove = (productId) => setProducts(removeProductFromPrintList(productId));
  const clear = () => setProducts(clearProductPrintList());

  const downloadJob = async (product, job) => {
    const key = `${product.id}:${job.key}`;
    try {
      setBusyKey(key);
      const result = await generatePrintJobPdf(job);
      const url = URL.createObjectURL(result.blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${product.name || "product"}-${job.filename}`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (error) {
      toast.error(error?.message || "تعذر إنشاء ملف الطباعة");
    } finally {
      setBusyKey("");
    }
  };

  const downloadMergedJob = async (job) => {
    const key = `merged:${section}:${audience}:${job.key}`;
    try {
      setBusyKey(key);
      const result = await generatePrintJobPdf(job);
      const url = URL.createObjectURL(result.blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${section}-${audience}-${job.filename}`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
      toast.success(`تم دمج ${job.labels.length} ملصق في ملف واحد`);
    } catch (error) {
      toast.error(error?.message || "تعذر دمج ملف الطباعة");
    } finally {
      setBusyKey("");
    }
  };

  return (
    <ProductsShell
      title="قائمة الطباعة"
      description="اجمع المنتجات من صفحة المنتجات واطبع كمياتها المتاحة بإعدادات كل قسم."
      actions={products.length ? (
        <button type="button" onClick={clear} className="inline-flex items-center gap-2 rounded-full border border-rose-400/20 bg-rose-500/10 px-4 py-2 text-sm font-bold text-rose-200">
          <Trash2 size={16} /> مسح القائمة
        </button>
      ) : null}
    >
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {SECTIONS.map((item) => {
          const count = products.filter((product) => printListSection(product) === item.key).length;
          return (
            <button key={item.key} type="button" onClick={() => setSection(item.key)} className={`rounded-[28px] border p-5 text-right transition ${section === item.key ? "border-emerald-300/40 bg-emerald-400/15 text-white" : "border-white/10 bg-zinc-950/80 text-zinc-300 hover:bg-white/5"}`}>
              <div className="text-2xl font-black">{item.label}</div>
              <div className="mt-2 text-sm text-zinc-400">{count} منتج</div>
            </button>
          );
        })}
      </div>

      {section === "sneakers" ? (
        <div className="mt-4 flex flex-wrap gap-2 rounded-2xl border border-white/10 bg-zinc-950/70 p-3">
          {AUDIENCES.map((item) => (
            <button key={item.key} type="button" onClick={() => setAudience(item.key)} className={`rounded-full px-4 py-2 text-sm font-bold ${audience === item.key ? "bg-primary text-black" : "border border-white/10 bg-white/5 text-[var(--primary-contrast)]"}`}>
              {item.label}
            </button>
          ))}
        </div>
      ) : null}

      {!products.length ? (
        <div className="mt-6 rounded-[30px] border border-dashed border-white/10 bg-zinc-950/70 p-12 text-center">
          <PackageOpen className="mx-auto text-zinc-500" size={42} />
          <h2 className="m1-section-title mt-4 text-white">قائمة الطباعة فارغة</h2>
          <p className="mt-2 text-sm text-zinc-400">حدد منتجًا أو أكثر من صفحة المنتجات ثم اضغط «إضافة إلى قائمة الطباعة».</p>
        </div>
      ) : visibleProducts.length === 0 ? (
        <div className="mt-6 rounded-[26px] border border-white/10 bg-zinc-950/70 p-8 text-center text-zinc-400">لا توجد منتجات في هذا القسم.</div>
      ) : (
        <div className="mt-6 grid gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-[26px] border border-emerald-300/20 bg-emerald-400/10 p-4">
            <div>
              <h2 className="m1-section-title flex items-center gap-2 text-white">
                <Combine size={20} className="text-emerald-300" />
                دمج منتجات القسم
              </h2>
              <p className="mt-1 text-sm text-emerald-100/70">
                يجمع {visibleProducts.length} منتج و{mergedPrintPlan.counts.total} ملصق حسب الكميات المتاحة.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {mergedJobs.map((job) => {
                const key = `merged:${section}:${audience}:${job.key}`;
                return (
                  <button
                    key={job.key}
                    type="button"
                    disabled={busyKey === key}
                    onClick={() => downloadMergedJob(job)}
                    className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-black text-black disabled:opacity-50"
                  >
                    <Combine size={16} />
                    {job.key === "box"
                      ? `دمج Box PDF (${job.labels.length})`
                      : job.key === "display"
                        ? `دمج Display PDF (${job.labels.length})`
                        : job.key === "bag"
                          ? `دمج Bags PDF 40×55 (${job.labels.length})`
                        : `دمج Crocs PDF (${job.labels.length})`}
                  </button>
                );
              })}
            </div>
          </div>
          {visibleProducts.map((product) => {
            const printableProduct = productForAudience(product, section, audience);
            const plan = buildProductLabelPrintPlan([printableProduct]);
            const jobs = groupProductLabelPdfJobs(plan);
            return (
              <article key={product.id} className="rounded-[30px] border border-white/10 bg-zinc-950/80 p-4 sm:p-5">
                <div className="grid gap-4 lg:grid-cols-[120px_minmax(0,1fr)_auto] lg:items-center">
                  <div className="h-28 overflow-hidden rounded-[var(--radius-card)] border border-white/10 bg-white">
                    {imageFor(product) ? <img src={resolveProductImageUrl(imageFor(product))} alt={product.name || ""} className="h-full w-full object-contain" /> : null}
                  </div>
                  <div className="min-w-0">
                    <h3 className="m1-section-title text-white">{product.name}</h3>
                    <div className="mt-2 flex flex-wrap gap-2 text-sm text-zinc-300">
                      <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">ART: {articleFor(product)}</span>
                      <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">المخزون: {stockCount(printableProduct)}</span>
                      <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">الملصقات: {plan.counts.total}</span>
                    </div>
                    {plan.warnings.length ? <p className="mt-2 text-xs text-amber-200">{plan.warnings[0]}</p> : null}
                  </div>
                  <div className="flex flex-wrap gap-2 lg:max-w-[360px] lg:justify-end">
                    {jobs.map((job) => (
                      <button key={job.key} type="button" disabled={busyKey === `${product.id}:${job.key}`} onClick={() => downloadJob(product, job)} className="inline-flex items-center gap-2 rounded-full bg-amber-400 px-4 py-2.5 text-sm font-black text-black disabled:opacity-50">
                        {job.key === "box" ? <Printer size={16} /> : <Download size={16} />}
                        {job.key === "box" ? "Box PDF 100×50" : job.key === "display" ? "Display PDF 55×40" : job.key === "bag" ? "Bags PDF 40×55" : "Crocs PDF 25×35"}
                      </button>
                    ))}
                    <button type="button" onClick={() => remove(product.id)} className="inline-flex items-center gap-2 rounded-full border border-rose-400/20 bg-rose-500/10 px-4 py-2.5 text-sm font-bold text-rose-200">
                      <Trash2 size={15} /> حذف
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </ProductsShell>
  );
}
