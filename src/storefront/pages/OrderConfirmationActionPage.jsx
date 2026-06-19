import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, CheckCircle2, Loader2, MessageCircleWarning, PencilLine, XCircle } from "lucide-react";

import { api } from "../../shared/api/api";

const getActionLabel = (action = "") => {
  if (action === "confirm") return "تم تأكيد الطلب";
  if (action === "edit") return "تم طلب تعديل الطلب وسيتواصل معك أحد أفراد الفريق";
  if (action === "cancel") return "تم إلغاء الطلب";
  return "تم تحديث الطلب";
};

const actionButtons = [
  { action: "confirm", label: "تأكيد الطلب", icon: CheckCircle2, className: "bg-emerald-600 text-white" },
  { action: "edit", label: "تعديل الطلب", icon: PencilLine, className: "bg-amber-500 text-slate-950" },
  { action: "cancel", label: "إلغاء الطلب", icon: XCircle, className: "bg-rose-600 text-white" },
];

export function OrderConfirmationActionPage() {
  const { code } = useParams();
  const [loading, setLoading] = useState(true);
  const [submittingAction, setSubmittingAction] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  const resolvedCode = useMemo(() => {
    const raw = String(code || "").trim();
    if (!raw) return "";
    try {
      return decodeURIComponent(raw).trim();
    } catch {
      return raw;
    }
  }, [code]);

  const loadCode = async () => {
    if (!resolvedCode) {
      setError("كود التأكيد غير صالح");
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setError("");
      const response = await api.get(`/public/order-confirmation/${encodeURIComponent(resolvedCode)}`);
      setResult(response?.data || response);
    } catch (err) {
      setError(err?.responseBody?.message || err?.message || "تعذر التحقق من الكود");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCode();
  }, [resolvedCode]);

  const applyAction = async (action) => {
    if (!resolvedCode || !action) return;
    try {
      setSubmittingAction(action);
      setError("");
      const response = await api.post(`/public/order-confirmation/${encodeURIComponent(resolvedCode)}`, { action });
      setResult(response?.data || response);
    } catch (err) {
      setError(err?.responseBody?.message || err?.message || "تعذر تنفيذ الإجراء");
    } finally {
      setSubmittingAction("");
    }
  };

  const actionLabel = getActionLabel(result?.action);
  const codeValid = Boolean(result?.success || result?.order);
  const bannerText = result?.action ? actionLabel : "الكود صالح - اختر الإجراء المناسب";

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(124,58,237,0.18),_transparent_35%),linear-gradient(180deg,#fff8f1,white)] px-4 py-10 text-slate-900 dark:bg-[radial-gradient(circle_at_top,_rgba(124,58,237,0.22),_transparent_35%),linear-gradient(180deg,#0f172a,#020617)] dark:text-white sm:px-6 lg:px-8">
      <div className="mx-auto flex min-h-[80vh] max-w-xl items-center justify-center">
        <section className="w-full rounded-[2rem] border border-stone-200 bg-white/95 p-6 shadow-[0_24px_70px_rgba(15,23,42,0.12)] backdrop-blur dark:border-white/10 dark:bg-slate-950/85 sm:p-8">
          <div className="mb-6 flex items-center gap-3">
            <div className="grid h-12 w-12 place-items-center rounded-2xl bg-[linear-gradient(135deg,rgba(124,58,237,0.16),rgba(59,130,246,0.18))] text-[#6d28d9] dark:bg-white/5 dark:text-[#c4b5fd]">
              <CheckCircle2 className="h-6 w-6" />
            </div>
            <div>
              <p className="text-xs font-black uppercase tracking-[0.24em] text-[#6d28d9]/80 dark:text-[#c4b5fd]/80">COD confirmation</p>
              <h1 className="text-2xl font-black tracking-tight">تأكيد الطلب</h1>
            </div>
          </div>

          {loading ? (
            <div className="flex items-center gap-3 rounded-2xl border border-stone-200 bg-stone-50 px-4 py-4 text-sm font-bold text-stone-700 dark:border-white/10 dark:bg-white/[0.04] dark:text-white/80">
              <Loader2 className="h-5 w-5 animate-spin" />
              جاري التحقق من الكود...
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
                {bannerText}
              </div>
              <p className="text-sm leading-7 text-stone-600 dark:text-slate-300">
                يمكنك تأكيد الطلب أو طلب تعديل أو إلغائه من هنا.
              </p>
              {result?.order?.public_order_number ? (
                <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm font-bold text-stone-700 dark:border-white/10 dark:bg-white/[0.04] dark:text-white/80">
                  رقم الطلب: {result.order.public_order_number}
                </div>
              ) : null}
              {codeValid ? (
                <div className="grid gap-3 sm:grid-cols-3">
                  {actionButtons.map(({ action, label, icon: Icon, className }) => (
                    <button
                      key={action}
                      type="button"
                      onClick={() => applyAction(action)}
                      disabled={Boolean(submittingAction)}
                      className={`inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-black transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
                    >
                      {submittingAction === action ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
                      {label}
                    </button>
                  ))}
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
