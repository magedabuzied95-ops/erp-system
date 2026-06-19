import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, CheckCircle2, Loader2, MessageCircleWarning } from "lucide-react";

import { api } from "../../shared/api/api";

const getActionLabel = (action = "") => {
  if (action === "confirm") return "تم تأكيد الطلب";
  if (action === "edit") return "تم طلب تعديل الطلب وسيتواصل معك أحد أفراد الفريق";
  if (action === "cancel") return "تم إلغاء الطلب";
  return "تم تحديث الطلب";
};

export function OrderConfirmationActionPage() {
  const { token } = useParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  const resolvedToken = useMemo(() => {
    const raw = String(token || "").trim();
    if (!raw) return "";
    try {
      return decodeURIComponent(raw).trim();
    } catch {
      return raw;
    }
  }, [token]);

  useEffect(() => {
    let active = true;
    const run = async () => {
      if (!resolvedToken) {
        if (!active) return;
        setError("رابط التأكيد غير صالح");
        setLoading(false);
        return;
      }
      try {
        setLoading(true);
        setError("");
        const response = await api.post(`/public/order-confirmation/${encodeURIComponent(resolvedToken)}`);
        if (!active) return;
        const payload = response?.data || response;
        setResult(payload);
      } catch (err) {
        if (!active) return;
        setError(err?.responseBody?.message || err?.message || "تعذر تطبيق الإجراء");
      } finally {
        if (active) setLoading(false);
      }
    };
    run();
    return () => {
      active = false;
    };
  }, [resolvedToken]);

  const actionLabel = getActionLabel(result?.action);

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(124,58,237,0.18),_transparent_35%),linear-gradient(180deg,#fff8f1,white)] px-4 py-10 text-slate-900 dark:bg-[radial-gradient(circle_at_top,_rgba(124,58,237,0.22),_transparent_35%),linear-gradient(180deg,#0f172a,#020617)] dark:text-white sm:px-6 lg:px-8">
      <div className="mx-auto flex min-h-[80vh] max-w-xl items-center justify-center">
        <section className="w-full rounded-[2rem] border border-stone-200 bg-white/95 p-6 shadow-[0_24px_70px_rgba(15,23,42,0.12)] backdrop-blur dark:border-white/10 dark:bg-slate-950/85 sm:p-8">
          <div className="mb-6 flex items-center gap-3">
            <div className="grid h-12 w-12 place-items-center rounded-2xl bg-[linear-gradient(135deg,rgba(124,58,237,0.16),rgba(59,130,246,0.18))] text-[#6d28d9] dark:bg-white/5 dark:text-[#c4b5fd]">
              <CheckCircle2 className="h-6 w-6" />
            </div>
            <div>
              <p className="text-xs font-black uppercase tracking-[0.24em] text-[#6d28d9]/80 dark:text-[#c4b5fd]/80">Order confirmation</p>
              <h1 className="text-2xl font-black tracking-tight">تأكيد الطلب</h1>
            </div>
          </div>

          {loading ? (
            <div className="flex items-center gap-3 rounded-2xl border border-stone-200 bg-stone-50 px-4 py-4 text-sm font-bold text-stone-700 dark:border-white/10 dark:bg-white/[0.04] dark:text-white/80">
              <Loader2 className="h-5 w-5 animate-spin" />
              جاري تطبيق الإجراء...
            </div>
          ) : error ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-4 text-sm font-bold text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
              <div className="mb-2 flex items-center gap-2">
                <MessageCircleWarning className="h-5 w-5" />
                <span>{error}</span>
              </div>
              <Link to="/shop" className="inline-flex items-center gap-2 rounded-full bg-stone-950 px-4 py-2 text-xs font-black text-white">
                <ArrowLeft className="h-4 w-4" />
                العودة إلى المتجر
              </Link>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-base font-black text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-100">
                {actionLabel}
              </div>
              <p className="text-sm leading-7 text-stone-600 dark:text-slate-300">
                يمكنك العودة إلى المتجر أو متابعة الطلب من صفحة الحساب في أي وقت.
              </p>
              {result?.order?.public_order_number ? (
                <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm font-bold text-stone-700 dark:border-white/10 dark:bg-white/[0.04] dark:text-white/80">
                  رقم الطلب: {result.order.public_order_number}
                </div>
              ) : null}
              <div className="flex flex-wrap gap-3">
                <Link to="/shop" className="inline-flex items-center gap-2 rounded-full bg-stone-950 px-5 py-3 text-sm font-black text-white transition hover:-translate-y-0.5">
                  <ArrowLeft className="h-4 w-4" />
                  العودة إلى المتجر
                </Link>
                <Link to="/shop/track" className="inline-flex items-center gap-2 rounded-full border border-stone-200 bg-white px-5 py-3 text-sm font-black text-stone-800 transition hover:-translate-y-0.5 dark:border-white/10 dark:bg-white/[0.04] dark:text-white/80">
                  تتبع الطلب
                </Link>
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

export default OrderConfirmationActionPage;
