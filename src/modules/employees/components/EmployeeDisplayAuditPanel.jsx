import { Check, Loader2, PackageCheck, RefreshCw } from "lucide-react";

const safeArray = (value) => Array.isArray(value) ? value : [];

export default function EmployeeDisplayAuditPanel({ data = {}, loading = false, savingId = "", error = "", onRefresh, onMarkDisplayed }) {
  const sections = safeArray(data.sections);
  return (
    <div className="grid gap-3" dir="rtl">
      <section className="overflow-hidden rounded-3xl border border-emerald-200 bg-gradient-to-br from-emerald-950 to-slate-950 p-4 text-white shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-xs font-black text-emerald-300"><PackageCheck className="h-4 w-4" />إدارة العرض المستقلة</div>
            <h2 className="mt-2 text-xl font-black">تمم على العرض</h2>
            <p className="mt-1 text-xs font-semibold leading-5 text-slate-300">الموديلات الموجودة بالمخزن ولم يتم تأكيد عرضها على الستاند.</p>
          </div>
          <button type="button" onClick={onRefresh} disabled={loading} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/10 text-white disabled:opacity-50" aria-label="تحديث">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </button>
        </div>
        <div className="mt-4 flex items-end justify-between rounded-2xl border border-white/10 bg-white/10 px-4 py-3">
          <span className="text-xs font-bold text-slate-300">إجمالي الموديلات غير المعروضة</span>
          <strong className="text-3xl font-black tabular-nums text-emerald-300" dir="ltr">{Number(data.total || 0)}</strong>
        </div>
      </section>

      {error ? <div className="rounded-2xl border border-red-200 bg-red-50 px-3 py-3 text-sm font-bold text-red-800">{error}</div> : null}
      {loading && !sections.length ? <div className="flex min-h-40 items-center justify-center rounded-3xl border border-slate-200 bg-white"><Loader2 className="h-6 w-6 animate-spin text-emerald-600" /></div> : null}

      {!loading && !sections.length ? (
        <div className="rounded-3xl border border-emerald-200 bg-emerald-50 px-4 py-10 text-center">
          <Check className="mx-auto h-9 w-9 text-emerald-600" />
          <div className="mt-2 text-base font-black text-emerald-950">كل الموديلات الموجودة بالمخزن معروضة</div>
        </div>
      ) : null}

      {sections.map((section) => (
        <section key={section.key} className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <header className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-4 py-3">
            <h3 className="text-base font-black text-slate-950">{section.label}</h3>
            <span className="rounded-full bg-slate-950 px-2.5 py-1 text-xs font-black text-white" dir="ltr">{section.count}</span>
          </header>
          <div className="grid gap-4 p-3">
            {safeArray(section.audiences).map((audience) => (
              <div key={audience.key}>
                <div className="mb-2 flex items-center gap-2">
                  <h4 className="text-sm font-black text-slate-800">{audience.label}</h4>
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-black text-emerald-800" dir="ltr">{audience.count}</span>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {safeArray(audience.products).map((product) => {
                    const saving = String(savingId) === String(product.product_id);
                    return (
                      <article key={product.product_id} className="grid grid-cols-[74px_minmax(0,1fr)] gap-3 rounded-2xl border border-slate-200 bg-white p-2.5 shadow-sm">
                        <div className="h-[74px] w-[74px] overflow-hidden rounded-xl bg-slate-100">
                          {product.image_url ? <img src={product.image_url} alt={product.name} loading="lazy" className="h-full w-full object-cover" /> : <PackageCheck className="m-5 h-8 w-8 text-slate-300" />}
                        </div>
                        <div className="min-w-0">
                          <h5 className="line-clamp-2 text-sm font-black leading-5 text-slate-950" dir="auto">{product.name}</h5>
                          <div className="mt-1 flex flex-wrap gap-1 text-[11px] font-bold">
                            <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-700">اللون: {product.color || "-"}</span>
                            <span className="rounded-full bg-blue-50 px-2 py-1 text-blue-800">أصغر مقاس: {product.size || "-"}</span>
                            <span className="rounded-full bg-amber-50 px-2 py-1 text-amber-800">الكمية: {product.stock || 0}</span>
                          </div>
                          <button type="button" onClick={() => onMarkDisplayed?.(product)} disabled={saving} className="mt-2 inline-flex min-h-9 w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-3 text-xs font-black text-white transition hover:bg-emerald-700 disabled:opacity-60">
                            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}معروض
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
