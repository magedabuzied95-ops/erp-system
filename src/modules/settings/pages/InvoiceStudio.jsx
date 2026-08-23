// Invoice Studio — the one place the customer-facing invoice is edited.
//
// Everything here writes to invoice_templates.config; nothing about the invoice is
// hardcoded in a renderer any more. The preview on the right is not a lookalike: the
// card tab mounts the same OrderInvoiceCard the customer's link renders, and the print
// and thermal tabs build the same HTML the print path opens, both fed the unsaved draft.
// What you see is what the customer gets.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import {
  BadgeCheck,
  Copy,
  FileText,
  Loader2,
  MessageSquare,
  Plus,
  Printer,
  Receipt,
  LayoutList,
  Save,
  Share2,
  ShieldCheck,
  Store,
  Trash2,
} from "lucide-react";

import OrderInvoiceCard from "../../../shared/components/invoices/OrderInvoiceCard";
import InvoiceLayoutEditor from "../components/InvoiceLayoutEditor";
import { buildOrderInvoiceWhatsappText, normalizeOrderInvoiceData } from "../../../shared/utils/orderInvoice";
import { buildInvoicePreviewHtml } from "../../../shared/utils/invoicePdf";
import {
  createInvoiceTemplate,
  deleteInvoiceTemplate,
  duplicateInvoiceTemplate,
  listInvoiceTemplates,
  updateInvoiceTemplate,
} from "../../../shared/api/invoiceTemplates";
import { resetInvoiceTemplateCache } from "../../../shared/hooks/useInvoiceTemplate";
import { hasPermission } from "../../../shared/auth/authStorage";
import {
  INVOICE_TEMPLATE_CHANNELS,
  mergeInvoiceTemplateConfig,
  normalizeInvoiceTemplateConfig,
} from "../../../../shared/invoiceTemplate.js";

// A stand-in order with one of everything the invoice can show — two lines, a discount,
// shipping, an outstanding balance — so toggling a field always has something to hide.
const SAMPLE_ORDER = {
  source: "website",
  invoice_number: "INV-1042",
  created_at: "2026-08-18T14:20:00.000Z",
  status: "confirmed",
  payment_method: "cod",
  payment_status: "partial",
  customer_name: "ماجد أبوزيد",
  customer_phone: "01024960585",
  street_address: "12 شارع النصر",
  city_area: "سموحة",
  governorate: "الإسكندرية",
  subtotal: 3150,
  discount_amount: 150,
  shipping_cost: 60,
  total_amount: 3060,
  paid_amount: 1000,
  remaining_amount: 2060,
  seller_name: "أحمد",
  public_invoice_url: "https://erp.m1store-egy.com/invoice/sample",
  items: [
    { id: 1, product_name: "Adidas Terrex Goretex", color: "أسود", size: "43", quantity: 1, unit_price: 1850, total_amount: 1850, sku: "ART-4410" },
    { id: 2, product_name: "Nike Air Zoom", color: "أبيض", size: "42", quantity: 2, unit_price: 650, total_amount: 1300, sku: "ART-2287" },
  ],
};

// The studio previews both customers, because they do not receive the same invoice:
// the counter sale has no shipping line, no delivery address, and its own policy.
// Editing the in-store wording without being able to look at it is how the four
// copies of the policy drifted apart in the first place.
const SAMPLE_POS_ORDER = {
  ...SAMPLE_ORDER,
  source: "pos",
  channel: "pos",
  payment_method: "cash",
  street_address: "",
  city_area: "",
  governorate: "",
  shipping_cost: 0,
  total_amount: 3000,
  remaining_amount: 2000,
};

const PREVIEW_CHANNELS = [
  { key: "website", fallback: "طلب أونلاين" },
  { key: "pos", fallback: "بيع من الفرع" },
];

const OUTPUTS = [
  { key: "card", icon: Receipt },
  { key: "print", icon: FileText },
  { key: "thermal", icon: Printer },
  { key: "whatsapp", icon: MessageSquare },
];

function Section({ icon: Icon, title, subtitle, children }) {
  return (
    <section className="rounded-[var(--radius-card)] border border-white/10 bg-white/[0.055] p-4 shadow-[0_18px_60px_rgba(0,0,0,0.22)]">
      <div className="mb-4 flex items-start gap-3">
        <div className="rounded-xl border border-primary/15 bg-primary/10 p-2 text-primary"><Icon className="h-5 w-5" /></div>
        <div>
          <h2 className="m1-section-title text-white">{title}</h2>
          {subtitle ? <p className="mt-1 text-sm leading-6 text-slate-400">{subtitle}</p> : null}
        </div>
      </div>
      {children}
    </section>
  );
}

function TextField({ label, hint, value, onChange, disabled, placeholder, type = "text" }) {
  return (
    <label className="block">
      <span className="block text-xs font-black text-slate-300">{label}</span>
      <input
        type={type}
        value={value ?? ""}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1.5 h-[var(--control-height-md)] w-full rounded-[var(--radius-control)] border border-white/10 bg-slate-950/55 px-3 text-sm font-bold text-white outline-none transition focus:border-primary/40 disabled:opacity-50"
      />
      {hint ? <span className="mt-1 block text-[11px] leading-4 text-slate-500">{hint}</span> : null}
    </label>
  );
}

function AreaField({ label, hint, value, onChange, disabled, rows = 5 }) {
  return (
    <label className="block">
      <span className="block text-xs font-black text-slate-300">{label}</span>
      <textarea
        rows={rows}
        value={value ?? ""}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1.5 w-full rounded-[var(--radius-control)] border border-white/10 bg-slate-950/55 p-3 text-sm font-bold leading-6 text-white outline-none transition focus:border-primary/40 disabled:opacity-50"
      />
      {hint ? <span className="mt-1 block text-[11px] leading-4 text-slate-500">{hint}</span> : null}
    </label>
  );
}

function Toggle({ label, checked, onChange, disabled }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`flex items-center justify-between gap-3 rounded-[var(--radius-control)] border px-3 py-2.5 text-start transition disabled:opacity-50 ${checked ? "border-primary/40 bg-primary/12" : "border-white/10 bg-slate-950/55 hover:border-white/20"}`}
    >
      <span className="text-xs font-black text-white">{label}</span>
      <span className={`relative h-5 w-9 shrink-0 rounded-full transition ${checked ? "bg-primary" : "bg-white/15"}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${checked ? "start-[1.125rem]" : "start-0.5"}`} />
      </span>
    </button>
  );
}

export default function InvoiceStudio() {
  const { t, i18n } = useTranslation();
  const tr = useCallback((key, fallback, options) => t(`settings.invoiceStudio.${key}`, { defaultValue: fallback, ...(options || {}) }), [t]);
  const canEdit = hasPermission("settings.edit");

  const [templates, setTemplates] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [meta, setMeta] = useState({ name: "", scope_channel: "all", is_default: false });
  const [draft, setDraft] = useState(() => normalizeInvoiceTemplateConfig({}));
  const [output, setOutput] = useState("card");
  const [previewChannel, setPreviewChannel] = useState("website");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  // A template with no row of its own is the implicit default every renderer already
  // falls back to; the studio shows it so the operator can see what they are starting
  // from before creating anything.
  const hasRows = templates.length > 0;
  const loadedRef = useRef(false);

  const applyTemplate = useCallback((template) => {
    if (!template) {
      setActiveId(null);
      setMeta({ name: "", scope_channel: "all", is_default: false });
      setDraft(normalizeInvoiceTemplateConfig({}));
      setDirty(false);
      return;
    }
    setActiveId(template.id);
    setMeta({ name: template.name, scope_channel: template.scope_channel, is_default: template.is_default });
    setDraft(normalizeInvoiceTemplateConfig(template.config));
    setDirty(false);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const rows = await listInvoiceTemplates();
      setTemplates(rows);
      const preferred = rows.find((row) => String(row.id) === String(activeId)) || rows.find((row) => row.is_default) || rows[0] || null;
      applyTemplate(preferred);
    } catch (err) {
      setTemplates([]);
      applyTemplate(null);
      setError(err?.responseBody?.message || err?.message || tr("loadFailed", "تعذر تحميل قوالب الفاتورة."));
    } finally {
      setLoading(false);
      loadedRef.current = true;
    }
  }, [activeId, applyTemplate, tr]);

  useEffect(() => {
    if (loadedRef.current) return;
    load();
  }, [load]);

  const patch = useCallback((partial) => {
    setDraft((current) => mergeInvoiceTemplateConfig(current, partial));
    setDirty(true);
  }, []);

  const previewOrder = previewChannel === "pos" ? SAMPLE_POS_ORDER : SAMPLE_ORDER;

  const previewInvoice = useMemo(
    () => normalizeOrderInvoiceData(previewOrder, null, { template: draft }),
    [draft, previewOrder]
  );

  const previewHtml = useMemo(() => {
    if (output !== "print" && output !== "thermal") return "";
    return buildInvoicePreviewHtml(
      {
        source: previewOrder.source,
        shipping_cost: previewOrder.shipping_cost,
        invoiceNumber: previewOrder.invoice_number,
        customerName: previewOrder.customer_name,
        customerPhone: previewOrder.customer_phone,
        seller_name: previewOrder.seller_name,
        createdAt: previewOrder.created_at,
        payment_method: previewOrder.payment_method,
        items: previewOrder.items,
        totals: {
          subtotal: previewOrder.subtotal,
          discount: previewOrder.discount_amount,
          shipping: previewOrder.shipping_cost,
          total: previewOrder.total_amount,
          paidAmount: previewOrder.paid_amount,
          remainingAmount: previewOrder.remaining_amount,
        },
      },
      output === "thermal" ? "thermal" : "a4",
      i18n.language,
      draft
    );
  }, [draft, output, previewOrder, i18n.language]);

  const previewText = useMemo(
    () => (output === "whatsapp" ? buildOrderInvoiceWhatsappText(previewOrder, null, { template: draft }) : ""),
    [draft, output, previewOrder]
  );

  const runAction = async (action, successMessage) => {
    setSaving(true);
    setError("");
    try {
      await action();
      // Every renderer caches the resolved config; a save has to reach them or the
      // operator sees their change here and nowhere else.
      resetInvoiceTemplateCache();
      if (successMessage) toast.success(successMessage);
    } catch (err) {
      const message = err?.responseBody?.message || err?.message || tr("saveFailed", "تعذر حفظ القالب.");
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const save = () =>
    runAction(async () => {
      if (activeId) {
        const updated = await updateInvoiceTemplate(activeId, { ...meta, config: draft });
        setTemplates((rows) => rows.map((row) => (String(row.id) === String(activeId) ? updated : { ...row, is_default: updated.is_default ? false : row.is_default })));
        applyTemplate(updated);
      } else {
        const created = await createInvoiceTemplate({
          name: meta.name || tr("defaultName", "قالب الفاتورة"),
          scope_channel: meta.scope_channel,
          is_default: true,
          config: draft,
        });
        setTemplates((rows) => [...rows, created]);
        applyTemplate(created);
      }
    }, tr("saved", "تم حفظ القالب."));

  const addTemplate = () =>
    runAction(async () => {
      const created = await createInvoiceTemplate({ name: tr("newName", "قالب جديد"), scope_channel: "all" });
      setTemplates((rows) => [...rows, created]);
      applyTemplate(created);
    }, tr("created", "تم إنشاء القالب."));

  const duplicate = () =>
    runAction(async () => {
      const copy = await duplicateInvoiceTemplate(activeId);
      setTemplates((rows) => [...rows, copy]);
      applyTemplate(copy);
    }, tr("duplicated", "تم نسخ القالب."));

  const remove = () =>
    runAction(async () => {
      await deleteInvoiceTemplate(activeId);
      const rest = templates.filter((row) => String(row.id) !== String(activeId));
      setTemplates(rest);
      applyTemplate(rest.find((row) => row.is_default) || rest[0] || null);
    }, tr("deleted", "تم حذف القالب."));

  const identity = draft.identity;
  const fields = draft.fields;
  const totals = draft.totals;
  const footer = draft.footer;
  const social = draft.social;
  const outputs = draft.outputs;
  const disabled = !canEdit || saving;

  return (
    <div className="m1-ai-scope min-h-full p-3 text-white md:p-6">
      <div className="mx-auto flex w-full flex-col gap-5">
        <section className="rounded-[var(--radius-card)] border border-white/10 bg-white/[0.055] p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 text-sm font-black uppercase tracking-[0.16em] text-primary">
                <Receipt className="h-4 w-4" />
                {tr("eyebrow", "الفاتورة")}
              </div>
              <h1 className="m1-page-title mt-3">{tr("title", "استوديو الفاتورة")}</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
                {tr("subtitle", "كل ما يظهر للعميل في الفاتورة — المطبوعة، إيصال الكاشير، الرابط العام، ورسالة واتساب — من مكان واحد.")}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={addTemplate} disabled={disabled} className="inline-flex h-[var(--control-height-lg)] items-center gap-2 rounded-[var(--radius-control)] border border-white/10 bg-slate-950/55 px-4 text-sm font-black text-white disabled:opacity-50">
                <Plus className="h-4 w-4" />{tr("new", "قالب جديد")}
              </button>
              {activeId ? (
                <button type="button" onClick={duplicate} disabled={disabled} className="inline-flex h-[var(--control-height-lg)] items-center gap-2 rounded-[var(--radius-control)] border border-white/10 bg-slate-950/55 px-4 text-sm font-black text-white disabled:opacity-50">
                  <Copy className="h-4 w-4" />{tr("duplicate", "نسخ")}
                </button>
              ) : null}
              {activeId && !meta.is_default ? (
                <button type="button" onClick={remove} disabled={disabled} className="inline-flex h-[var(--control-height-lg)] items-center gap-2 rounded-[var(--radius-control)] border border-rose-300/25 bg-rose-400/10 px-4 text-sm font-black text-rose-100 disabled:opacity-50">
                  <Trash2 className="h-4 w-4" />{tr("delete", "حذف")}
                </button>
              ) : null}
              <button type="button" onClick={save} disabled={disabled || (!dirty && Boolean(activeId))} className="inline-flex h-[var(--control-height-lg)] items-center gap-2 rounded-[var(--radius-control)] bg-primary px-4 text-sm font-black text-slate-950 disabled:opacity-50">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {activeId ? tr("save", "حفظ") : tr("saveNew", "حفظ كقالب")}
              </button>
            </div>
          </div>

          {!hasRows && !loading ? (
            <p className="mt-4 rounded-xl border border-primary/15 bg-primary/10 px-3 py-2 text-xs font-bold leading-5 text-primary">
              {tr("noTemplatesNote", "لا يوجد قالب محفوظ بعد. ما تراه الآن هو الشكل الافتراضي الذي تخرج به كل فاتورة اليوم — عدّل ثم احفظ لتثبيته.")}
            </p>
          ) : null}
          {!canEdit ? (
            <p className="mt-4 rounded-xl border border-amber-300/20 bg-amber-400/10 px-3 py-2 text-xs font-bold leading-5 text-amber-100">
              {tr("readOnly", "لديك صلاحية العرض فقط، لذلك الحقول معطّلة.")}
            </p>
          ) : null}
          {error ? <p className="mt-4 rounded-xl border border-rose-300/20 bg-rose-400/10 p-3 text-sm font-bold text-rose-100">{error}</p> : null}

          {hasRows ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {templates.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  onClick={() => applyTemplate(row)}
                  className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-black transition ${String(row.id) === String(activeId) ? "border-primary/45 bg-primary/15 text-white" : "border-white/10 bg-slate-950/55 text-slate-300 hover:border-white/20"}`}
                >
                  {row.is_default ? <BadgeCheck className="h-3.5 w-3.5 text-primary" /> : null}
                  {row.name}
                  <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{row.scope_channel}</span>
                </button>
              ))}
            </div>
          ) : null}
        </section>

        {loading ? (
          <div className="flex items-center gap-2 rounded-[var(--radius-card)] border border-white/10 bg-white/[0.055] p-6 text-sm font-bold text-slate-300">
            <Loader2 className="h-4 w-4 animate-spin" />
            {tr("loading", "جاري التحميل...")}
          </div>
        ) : (
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
            <div className="flex flex-col gap-5">
              <Section icon={LayoutList} title={tr("layout.title", "ترتيب الفاتورة")} subtitle={tr("layout.subtitle", "اسحب العناصر لترتيبها، وأضف ما تريد بينها.")}>
                <InvoiceLayoutEditor blocks={draft.blocks} disabled={disabled} onChange={(blocks) => patch({ blocks })} />
              </Section>

              <Section icon={Store} title={tr("identity.title", "هوية المحل")} subtitle={tr("identity.subtitle", "اتركه فارغًا ليأخذ القيمة من إعدادات الشركة.")}>
                <div className="grid gap-3 md:grid-cols-2">
                  <TextField label={tr("identity.storeName", "اسم المحل")} value={identity.store_name} disabled={disabled} onChange={(value) => patch({ identity: { store_name: value } })} placeholder={tr("identity.inherit", "من إعدادات الشركة")} />
                  <TextField label={tr("identity.logoUrl", "رابط الشعار")} value={identity.logo_url} disabled={disabled} onChange={(value) => patch({ identity: { logo_url: value } })} placeholder={tr("identity.inherit", "من إعدادات الشركة")} />
                  <TextField label={tr("identity.phone", "تليفون خدمة العملاء")} value={identity.phone} disabled={disabled} onChange={(value) => patch({ identity: { phone: value } })} />
                  <TextField label={tr("identity.websiteText", "الموقع (النص الظاهر)")} value={identity.website_text} disabled={disabled} onChange={(value) => patch({ identity: { website_text: value } })} />
                  <TextField label={tr("identity.websiteUrl", "رابط الموقع")} value={identity.website_url} disabled={disabled} onChange={(value) => patch({ identity: { website_url: value } })} hint={tr("identity.urlHint", "لا يُقبل إلا رابط http/https.")} />
                  <TextField label={tr("identity.address", "العنوان")} value={identity.address} disabled={disabled} onChange={(value) => patch({ identity: { address: value } })} />
                  <TextField label={tr("identity.taxNumber", "الرقم الضريبي")} value={identity.tax_number} disabled={disabled} onChange={(value) => patch({ identity: { tax_number: value } })} />
                  <TextField label={tr("identity.commercialRegister", "السجل التجاري")} value={identity.commercial_register} disabled={disabled} onChange={(value) => patch({ identity: { commercial_register: value } })} />
                </div>
                <div className="mt-3">
                  <Toggle label={tr("identity.showLogo", "إظهار الشعار")} checked={identity.show_logo} disabled={disabled} onChange={(value) => patch({ identity: { show_logo: value } })} />
                </div>
              </Section>

              <Section icon={FileText} title={tr("fields.title", "الحقول")} subtitle={tr("fields.subtitle", "ما يظهر في رأس الفاتورة وفي سطور المنتجات.")}>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Toggle label={tr("fields.orderDate", "تاريخ الطلب")} checked={fields.show_order_date} disabled={disabled} onChange={(v) => patch({ fields: { show_order_date: v } })} />
                  <Toggle label={tr("fields.customerName", "اسم العميل")} checked={fields.show_customer_name} disabled={disabled} onChange={(v) => patch({ fields: { show_customer_name: v } })} />
                  <Toggle label={tr("fields.customerPhone", "تليفون العميل")} checked={fields.show_customer_phone} disabled={disabled} onChange={(v) => patch({ fields: { show_customer_phone: v } })} />
                  <Toggle label={tr("fields.customerAddress", "عنوان العميل")} checked={fields.show_customer_address} disabled={disabled} onChange={(v) => patch({ fields: { show_customer_address: v } })} />
                  <Toggle label={tr("fields.orderStatus", "حالة الطلب")} checked={fields.show_order_status} disabled={disabled} onChange={(v) => patch({ fields: { show_order_status: v } })} />
                  <Toggle label={tr("fields.paymentMethod", "طريقة الدفع")} checked={fields.show_payment_method} disabled={disabled} onChange={(v) => patch({ fields: { show_payment_method: v } })} />
                  <Toggle label={tr("fields.productImage", "صورة المنتج")} checked={fields.show_product_image} disabled={disabled} onChange={(v) => patch({ fields: { show_product_image: v } })} />
                  <Toggle label={tr("fields.productVariant", "اللون والمقاس")} checked={fields.show_product_variant} disabled={disabled} onChange={(v) => patch({ fields: { show_product_variant: v } })} />
                  <Toggle label={tr("fields.sku", "كود الصنف SKU")} checked={fields.show_sku} disabled={disabled} onChange={(v) => patch({ fields: { show_sku: v } })} />
                  <Toggle label={tr("fields.unitPrice", "سعر الوحدة")} checked={fields.show_unit_price} disabled={disabled} onChange={(v) => patch({ fields: { show_unit_price: v } })} />
                  <Toggle label={tr("fields.lineTotal", "إجمالي السطر")} checked={fields.show_line_total} disabled={disabled} onChange={(v) => patch({ fields: { show_line_total: v } })} />
                  <Toggle label={tr("fields.sellerName", "اسم البائع")} checked={fields.show_seller_name} disabled={disabled} onChange={(v) => patch({ fields: { show_seller_name: v } })} />
                  <Toggle label={tr("fields.cashierName", "اسم الكاشير")} checked={fields.show_cashier_name} disabled={disabled} onChange={(v) => patch({ fields: { show_cashier_name: v } })} />
                </div>
              </Section>

              <Section icon={Receipt} title={tr("totals.title", "الإجماليات")} subtitle={tr("totals.subtitle", "سطور صندوق الحساب أسفل الفاتورة.")}>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Toggle label={tr("totals.subtotal", "الإجمالي الفرعي")} checked={totals.show_subtotal} disabled={disabled} onChange={(v) => patch({ totals: { show_subtotal: v } })} />
                  <Toggle label={tr("totals.discount", "الخصم")} checked={totals.show_discount} disabled={disabled} onChange={(v) => patch({ totals: { show_discount: v } })} />
                  <Toggle label={tr("totals.shipping", "الشحن")} checked={totals.show_shipping} disabled={disabled} onChange={(v) => patch({ totals: { show_shipping: v } })} />
                  <Toggle label={tr("totals.tax", "الضريبة")} checked={totals.show_tax} disabled={disabled} onChange={(v) => patch({ totals: { show_tax: v } })} />
                  <Toggle label={tr("totals.grandTotal", "الإجمالي الكلي")} checked={totals.show_grand_total} disabled={disabled} onChange={(v) => patch({ totals: { show_grand_total: v } })} />
                  <Toggle label={tr("totals.paid", "المدفوع")} checked={totals.show_paid} disabled={disabled} onChange={(v) => patch({ totals: { show_paid: v } })} />
                  <Toggle label={tr("totals.remaining", "المتبقي")} checked={totals.show_remaining} disabled={disabled} onChange={(v) => patch({ totals: { show_remaining: v } })} />
                  <Toggle label={tr("totals.paymentBreakdown", "تفاصيل الدفع")} checked={totals.show_payment_breakdown} disabled={disabled} onChange={(v) => patch({ totals: { show_payment_breakdown: v } })} />
                </div>
              </Section>

              <Section icon={ShieldCheck} title={tr("footer.title", "التذييل والسياسة")} subtitle={tr("footer.subtitle", "كل سطر في صندوق السياسة يبدأ من سطر جديد.")}>
                <div className="grid gap-3">
                  <Toggle label={tr("footer.policyEnabled", "إظهار سياسة الاستبدال والاسترجاع")} checked={footer.return_policy_enabled} disabled={disabled} onChange={(v) => patch({ footer: { return_policy_enabled: v } })} />
                  <AreaField label={tr("footer.policyAr", "السياسة (عربي)")} value={footer.return_policy_ar} disabled={disabled || !footer.return_policy_enabled} onChange={(v) => patch({ footer: { return_policy_ar: v } })} />
                  <AreaField label={tr("footer.policyEn", "السياسة (إنجليزي)")} hint={tr("footer.policyEnHint", "يُستخدم عند طباعة الفاتورة بالإنجليزية. اتركه فارغًا ليستخدم النص العربي.")} value={footer.return_policy_en} disabled={disabled || !footer.return_policy_enabled} onChange={(v) => patch({ footer: { return_policy_en: v } })} rows={4} />
                  <AreaField label={tr("footer.policyInStoreAr", "سياسة البيع من الفرع (عربي)")} hint={tr("footer.policyInStoreHint", "تظهر لعميل اشترى من الفرع ولم يُشحن له شيء. اتركه فارغًا ليستخدم نص الأونلاين.")} value={footer.return_policy_in_store_ar} disabled={disabled || !footer.return_policy_enabled} onChange={(v) => patch({ footer: { return_policy_in_store_ar: v } })} rows={4} />
                  <AreaField label={tr("footer.policyInStoreEn", "سياسة البيع من الفرع (إنجليزي)")} value={footer.return_policy_in_store_en} disabled={disabled || !footer.return_policy_enabled} onChange={(v) => patch({ footer: { return_policy_in_store_en: v } })} rows={3} />
                  <div className="grid gap-3 md:grid-cols-2">
                    <TextField label={tr("footer.thankYouAr", "رسالة شكر (عربي)")} value={footer.thank_you_ar} disabled={disabled} onChange={(v) => patch({ footer: { thank_you_ar: v } })} />
                    <TextField label={tr("footer.thankYouEn", "رسالة شكر (إنجليزي)")} value={footer.thank_you_en} disabled={disabled} onChange={(v) => patch({ footer: { thank_you_en: v } })} />
                  </div>
                  <AreaField label={tr("footer.termsAr", "شروط إضافية (عربي)")} value={footer.terms_ar} disabled={disabled} onChange={(v) => patch({ footer: { terms_ar: v } })} rows={3} />
                </div>
              </Section>

              <Section icon={Share2} title={tr("social.title", "التقييم والتواصل")} subtitle={tr("social.subtitle", "الأزرار أسفل الفاتورة التي يفتحها العميل.")}>
                <div className="grid gap-3">
                  <Toggle label={tr("social.enabled", "إظهار أزرار التقييم والمتابعة")} checked={social.enabled} disabled={disabled} onChange={(v) => patch({ social: { enabled: v } })} />
                  <TextField label={tr("social.google", "رابط تقييم Google")} value={social.google_review_url} disabled={disabled || !social.enabled} onChange={(v) => patch({ social: { google_review_url: v } })} />
                  <TextField label={tr("social.facebook", "رابط Facebook")} value={social.facebook_review_url} disabled={disabled || !social.enabled} onChange={(v) => patch({ social: { facebook_review_url: v } })} />
                  <TextField label={tr("social.instagram", "رابط Instagram")} value={social.instagram_url} disabled={disabled || !social.enabled} onChange={(v) => patch({ social: { instagram_url: v } })} />
                  <TextField label={tr("social.whatsapp", "رقم واتساب")} hint={tr("social.whatsappHint", "اتركه فارغًا ليستخدم تليفون خدمة العملاء.")} value={social.whatsapp_number} disabled={disabled || !social.enabled} onChange={(v) => patch({ social: { whatsapp_number: v } })} />
                </div>
              </Section>

              <Section icon={Printer} title={tr("outputs.title", "إعدادات كل مخرج")} subtitle={tr("outputs.subtitle", "الاختلافات التي تخص ورقة أو قناة بعينها.")}>
                <div className="grid gap-4">
                  <div>
                    <span className="text-xs font-black uppercase tracking-wide text-slate-400">{tr("outputs.print", "المطبوعة A4")}</span>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      <Toggle label={tr("outputs.printSku", "طباعة كود الصنف")} checked={outputs.print.show_sku} disabled={disabled} onChange={(v) => patch({ outputs: { print: { show_sku: v } } })} />
                    </div>
                  </div>
                  <div>
                    <span className="text-xs font-black uppercase tracking-wide text-slate-400">{tr("outputs.thermal", "الإيصال الحراري")}</span>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      <TextField label={tr("outputs.paperWidth", "عرض الورق (مم)")} type="number" value={outputs.thermal.paper_width_mm} disabled={disabled} onChange={(v) => patch({ outputs: { thermal: { paper_width_mm: v } } })} />
                      <Toggle label={tr("outputs.thermalImage", "صورة المنتج")} checked={outputs.thermal.show_product_image} disabled={disabled} onChange={(v) => patch({ outputs: { thermal: { show_product_image: v } } })} />
                      <Toggle label={tr("outputs.thermalPrice", "سعر الوحدة")} checked={outputs.thermal.show_unit_price} disabled={disabled} onChange={(v) => patch({ outputs: { thermal: { show_unit_price: v } } })} />
                    </div>
                  </div>
                  <div>
                    <span className="text-xs font-black uppercase tracking-wide text-slate-400">{tr("outputs.whatsapp", "رسالة واتساب")}</span>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      <Toggle label={tr("outputs.waItems", "قائمة المنتجات")} checked={outputs.whatsapp.include_items} disabled={disabled} onChange={(v) => patch({ outputs: { whatsapp: { include_items: v } } })} />
                      <Toggle label={tr("outputs.waTotals", "الإجماليات")} checked={outputs.whatsapp.include_totals} disabled={disabled} onChange={(v) => patch({ outputs: { whatsapp: { include_totals: v } } })} />
                      <Toggle label={tr("outputs.waLink", "رابط الفاتورة")} checked={outputs.whatsapp.include_public_link} disabled={disabled} onChange={(v) => patch({ outputs: { whatsapp: { include_public_link: v } } })} />
                    </div>
                  </div>
                </div>
              </Section>

              <Section icon={BadgeCheck} title={tr("scope.title", "نطاق القالب")} subtitle={tr("scope.subtitle", "أي فواتير يسري عليها هذا القالب.")}>
                <div className="grid gap-3 md:grid-cols-2">
                  <TextField label={tr("scope.name", "اسم القالب")} value={meta.name} disabled={disabled} onChange={(value) => { setMeta((current) => ({ ...current, name: value })); setDirty(true); }} />
                  <label className="block">
                    <span className="block text-xs font-black text-slate-300">{tr("scope.channel", "القناة")}</span>
                    <select
                      value={meta.scope_channel}
                      disabled={disabled}
                      onChange={(event) => { setMeta((current) => ({ ...current, scope_channel: event.target.value })); setDirty(true); }}
                      className="mt-1.5 h-[var(--control-height-md)] w-full rounded-[var(--radius-control)] border border-white/10 bg-slate-950/55 px-3 text-sm font-bold text-white outline-none focus:border-primary/40 disabled:opacity-50"
                    >
                      {INVOICE_TEMPLATE_CHANNELS.map((channel) => (
                        <option key={channel} value={channel} className="bg-slate-950">{tr(`scope.channels.${channel}`, channel)}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="mt-3">
                  <Toggle
                    label={tr("scope.isDefault", "القالب الافتراضي")}
                    checked={meta.is_default}
                    disabled={disabled || meta.is_default}
                    onChange={(value) => { setMeta((current) => ({ ...current, is_default: value })); setDirty(true); }}
                  />
                  <p className="mt-2 text-[11px] leading-4 text-slate-500">{tr("scope.defaultHint", "لا يمكن إلغاء الافتراضي مباشرة — عيّن قالبًا آخر افتراضيًا بدلًا منه.")}</p>
                </div>
              </Section>
            </div>

            <div className="xl:sticky xl:top-4 xl:self-start">
              <div className="rounded-[var(--radius-card)] border border-white/10 bg-white/[0.055] p-4">
                <div className="mb-3 flex flex-wrap gap-2">
                  {OUTPUTS.map(({ key, icon: Icon }) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setOutput(key)}
                      className={`inline-flex items-center gap-2 rounded-[var(--radius-control)] border px-3 py-2 text-xs font-black transition ${output === key ? "border-primary/45 bg-primary/15 text-white" : "border-white/10 bg-slate-950/55 text-slate-300 hover:border-white/20"}`}
                    >
                      <Icon className="h-4 w-4" />
                      {tr(`preview.${key}`, key)}
                    </button>
                  ))}
                </div>
                {/* The two customers do not receive the same invoice, so the preview
                    has to be able to be either of them — otherwise the in-store policy
                    is edited blind, which is how these texts drifted apart before. */}
                <div className="mb-3 flex flex-wrap gap-2">
                  {PREVIEW_CHANNELS.map(({ key, fallback }) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setPreviewChannel(key)}
                      className={`rounded-full border px-3 py-1.5 text-[11px] font-black transition ${previewChannel === key ? "border-emerald-400/50 bg-emerald-400/15 text-emerald-200" : "border-white/10 bg-slate-950/55 text-slate-400 hover:border-white/20"}`}
                    >
                      {tr(`preview.channels.${key}`, fallback)}
                    </button>
                  ))}
                </div>
                <p className="mb-3 text-[11px] leading-4 text-slate-500">{tr("preview.note", "معاينة على طلب تجريبي، بنفس المكوّنات التي تصل للعميل فعليًا.")}</p>

                <div className="max-h-[70vh] overflow-auto rounded-[var(--radius-card)] bg-slate-950/50 p-3">
                  {output === "card" ? (
                    <OrderInvoiceCard invoice={previewInvoice} template={draft} output="public" luxury publicView />
                  ) : null}
                  {output === "print" || output === "thermal" ? (
                    <iframe
                      title={tr(`preview.${output}`, output)}
                      srcDoc={previewHtml}
                      className="h-[68vh] w-full rounded-[var(--radius-card)] border-0 bg-white"
                    />
                  ) : null}
                  {output === "whatsapp" ? (
                    <pre dir="rtl" className="whitespace-pre-wrap break-words rounded-[var(--radius-card)] bg-[#0b141a] p-4 text-sm font-bold leading-6 text-[#e9edef]">{previewText}</pre>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
