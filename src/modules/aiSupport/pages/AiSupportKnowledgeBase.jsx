import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { Bot, Loader2, RefreshCw, Save, ShieldCheck } from "lucide-react";

import { api } from "../../../shared/api/api";
import { getCurrentTenant, getCurrentUser } from "../../../shared/auth/authStorage";

const defaultForm = {
  store_name: "",
  phone: "",
  whatsapp: "",
  branch_working_hours: "",
  payment_methods: "",
  shipping_policy: "",
  return_exchange_policy: "",
  delivery_notes: "",
  warranty_notes: "",
  human_support_message: "",
  brand_tone_instructions: "",
};

const fields = [
  { key: "store_name", label: "اسم المتجر الظاهر", type: "input", placeholder: "مثال: المتجر التجريبي" },
  { key: "phone", label: "رقم الهاتف العام", type: "input", inputMode: "tel", placeholder: "+201000000000" },
  { key: "whatsapp", label: "رقم واتساب", type: "input", inputMode: "tel", placeholder: "+201000000000" },
  { key: "branch_working_hours", label: "مواعيد عمل الفروع", rows: 4, placeholder: "مثال: السبت - الخميس من 12 ظهرًا إلى 11 مساءً" },
  { key: "payment_methods", label: "طرق الدفع", rows: 4, placeholder: "كاش عند الاستلام، فودافون كاش، إنستاباي..." },
  { key: "shipping_policy", label: "سياسة الشحن", rows: 5, placeholder: "مناطق الشحن، المدة المتوقعة، التكلفة..." },
  { key: "return_exchange_policy", label: "سياسة الاستبدال والاسترجاع", rows: 5, placeholder: "شروط الاستبدال، المدة، حالة المنتج..." },
  { key: "delivery_notes", label: "ملاحظات التوصيل", rows: 4, placeholder: "أي تعليمات عامة للعميل قبل التوصيل" },
  { key: "warranty_notes", label: "ملاحظات الضمان", rows: 4, placeholder: "سياسة الضمان أو عدم وجود ضمان" },
  { key: "human_support_message", label: "رسالة التحويل للدعم البشري", rows: 3, placeholder: "مثال: ابعتلنا على واتساب وسنرد عليك في أقرب وقت" },
  { key: "brand_tone_instructions", label: "نبرة البراند في الردود", rows: 4, placeholder: "مثال: ردود عربية ودودة، مختصرة، بدون وعود غير مؤكدة" },
];

const resolveTenantId = () => {
  const user = getCurrentUser();
  const tenant = getCurrentTenant();
  return String(user?.tenant_id || user?.tenantId || tenant?.id || tenant?.tenant_id || "").trim();
};

const normalizePhone = (value = "") => String(value || "").replace(/[\s().-]/g, "");

const validatePhone = (value = "") => {
  const normalized = normalizePhone(value);
  return !normalized || /^\+?[0-9]{7,15}$/.test(normalized);
};

export default function AiSupportKnowledgeBase() {
  const tenantId = useMemo(resolveTenantId, []);
  const [form, setForm] = useState(defaultForm);
  const [initialForm, setInitialForm] = useState(defaultForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const isDirty = JSON.stringify(form) !== JSON.stringify(initialForm);
  const phoneValid = validatePhone(form.phone);
  const whatsappValid = validatePhone(form.whatsapp);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!tenantId) {
        setError("لم يتم تحديد Tenant لهذا المستخدم.");
        setLoading(false);
        return;
      }
      setLoading(true);
      setError("");
      try {
        const payload = await api.get("/ai-support/knowledge-base", {
          headers: { "x-tenant-id": tenantId },
        });
        const next = { ...defaultForm, ...(payload?.knowledge_base || {}) };
        if (!cancelled) {
          setForm(next);
          setInitialForm(next);
        }
      } catch (err) {
        if (!cancelled) setError(err?.message || "تعذر تحميل إعدادات قاعدة المعرفة");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  const updateField = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  const save = async () => {
    if (!phoneValid || !whatsappValid) {
      toast.error("راجع صيغة الهاتف أو واتساب");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const payload = await api.put(
        "/ai-support/knowledge-base",
        { knowledge_base: form },
        { headers: { "x-tenant-id": tenantId } }
      );
      const next = { ...defaultForm, ...(payload?.knowledge_base || form) };
      setForm(next);
      setInitialForm(next);
      toast.success("تم حفظ قاعدة معرفة الدعم الذكي");
    } catch (err) {
      setError(err?.message || "تعذر حفظ الإعدادات");
      toast.error(err?.message || "تعذر حفظ الإعدادات");
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    if (!window.confirm("هل تريد إعادة ضبط قاعدة معرفة الدعم الذكي لهذا المستأجر؟")) return;
    setSaving(true);
    setError("");
    try {
      const payload = await api.delete("/ai-support/knowledge-base", {
        headers: { "x-tenant-id": tenantId },
      });
      const next = { ...defaultForm, ...(payload?.knowledge_base || {}) };
      setForm(next);
      setInitialForm(next);
      toast.success("تم تصفير قاعدة المعرفة");
    } catch (err) {
      setError(err?.message || "تعذر تصفير الإعدادات");
      toast.error(err?.message || "تعذر تصفير الإعدادات");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6" dir="rtl">
      <section className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-2xl shadow-[var(--shadow)]">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--card)] px-3 py-1 text-xs font-black uppercase tracking-[0.16em] text-[var(--muted)]">
              <Bot className="h-4 w-4" />
              الدعم الذكي
            </div>
            <h1 className="m1-page-title mt-4 text-[var(--text)]">قاعدة معرفة الدعم الذكي</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted)]">
              هذه المعلومات عامة ومسموح استخدامها في ردود الدعم الذكي. لا تضف بيانات داخلية أو أسعار غير مؤكدة هنا.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={reset}
              disabled={saving || loading}
              className="inline-flex h-[var(--control-height-lg)] items-center justify-center gap-2 rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--card)] px-4 text-sm font-black text-[var(--text)] transition hover:-translate-y-0.5 disabled:opacity-50"
            >
              <RefreshCw className="h-4 w-4" />
              تصفير
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving || loading || !isDirty || !phoneValid || !whatsappValid}
              className="inline-flex h-[var(--control-height-lg)] items-center justify-center gap-2 rounded-[var(--radius-control)] bg-[var(--primary)] px-5 text-sm font-black text-white shadow-lg transition hover:-translate-y-0.5 disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              حفظ
            </button>
          </div>
        </div>
      </section>

      {error ? <div className="rounded-2xl border border-rose-500/20 bg-rose-500/10 p-4 text-sm font-bold text-rose-300">{error}</div> : null}

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-xl shadow-[var(--shadow)]">
          {loading ? (
            <div className="grid min-h-80 place-items-center text-[var(--muted)]">
              <Loader2 className="h-8 w-8 animate-spin" />
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {fields.map((field) => (
                <label key={field.key} className={field.type === "input" ? "block" : "block md:col-span-2"}>
                  <span className="mb-2 block text-sm font-black text-[var(--text)]">{field.label}</span>
                  {field.type === "input" ? (
                    <input
                      value={form[field.key] || ""}
                      inputMode={field.inputMode}
                      onChange={(event) => updateField(field.key, event.target.value)}
                      placeholder={field.placeholder}
                      className={`h-[var(--control-height-lg)] w-full rounded-[var(--radius-control)] border bg-[var(--card)] px-4 text-right text-sm font-semibold text-[var(--text)] outline-none transition focus:ring-4 ${ (field.key === "phone" && !phoneValid) || (field.key === "whatsapp" && !whatsappValid) ? "border-rose-400/70 focus:ring-rose-400/10" : "border-[var(--border)] focus:border-[var(--primary)] focus:ring-[var(--primary)]/10" }`}
                    />
                  ) : (
                    <textarea
                      value={form[field.key] || ""}
                      rows={field.rows}
                      onChange={(event) => updateField(field.key, event.target.value)}
                      placeholder={field.placeholder}
                      className="w-full resize-y rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--card)] px-4 py-3 text-right text-sm font-semibold leading-7 text-[var(--text)] outline-none transition focus:border-[var(--primary)] focus:ring-4 focus:ring-[var(--primary)]/10"
                    />
                  )}
                </label>
              ))}
            </div>
          )}
        </div>

        <aside className="space-y-4">
          <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-xl shadow-[var(--shadow)]">
            <div className="flex items-center gap-2 text-sm font-black text-[var(--text)]">
              <ShieldCheck className="h-4 w-4 text-emerald-400" />
              نطاق الاستخدام
            </div>
            <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
              تحفظ هذه البيانات داخل `website_settings.settings` لهذا المستأجر فقط، وتظهر في `source_previews` داخل وحدة دعم الذكاء الاصطناعي.
            </p>
          </div>
          <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-xl shadow-[var(--shadow)]">
            <div className="text-sm font-black text-[var(--text)]">التحقق</div>
            <div className="mt-3 grid gap-2 text-sm font-bold text-[var(--muted)]">
              <div>الهاتف: {phoneValid ? "صحيح" : "غير صحيح"}</div>
              <div>واتساب: {whatsappValid ? "صحيح" : "غير صحيح"}</div>
              <div>الحالة: {isDirty ? "توجد تغييرات غير محفوظة" : "محفوظ"}</div>
            </div>
          </div>
        </aside>
      </section>
    </div>
  );
}
