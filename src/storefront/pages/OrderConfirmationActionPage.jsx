import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  CheckCircle2,
  ExternalLink,
  Image as ImageIcon,
  Loader2,
  MapPin,
  MessageCircleWarning,
  Package2,
  PencilLine,
  Phone,
  ShoppingBag,
  XCircle,
} from "lucide-react";

import { api } from "../../shared/api/api";

const ACTION_META = {
  confirm: {
    label: "تأكيد الطلب",
    success: "تم تأكيد الطلب",
    hint: "يؤكد الطلب ويجهزه فريقنا للشحن.",
    icon: CheckCircle2,
    className: "border-emerald-200 bg-emerald-600 text-white hover:bg-emerald-500",
  },
  edit: {
    label: "تعديل الطلب",
    success: "تم طلب تعديل الطلب",
    hint: "سيتواصل معك أحد أفراد الفريق لتعديل البيانات.",
    icon: PencilLine,
    className: "border-amber-200 bg-amber-400 text-slate-950 hover:bg-amber-300",
  },
  cancel: {
    label: "إلغاء الطلب",
    success: "تم إلغاء الطلب",
    hint: "سيتم إلغاء الطلب واستكمال الخطوات الداخلية.",
    icon: XCircle,
    className: "border-rose-200 bg-rose-600 text-white hover:bg-rose-500",
  },
};

const EXPIRED_CODES = new Set([
  "ORDER_CONFIRMATION_CODE_EXPIRED",
  "ORDER_CONFIRMATION_CODE_NOT_FOUND",
  "ORDER_CONFIRMATION_CODE_ALREADY_USED",
]);

const moneyFormatter = new Intl.NumberFormat("ar-EG", { maximumFractionDigits: 2 });

const text = (...values) => {
  for (const value of values) {
    const result = String(value ?? "").trim();
    if (result) return result;
  }
  return "";
};

const toNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeItems = (payload = {}) => {
  const order = payload?.order ?? payload?.data?.order ?? payload?.result?.order ?? payload?.data ?? payload?.result ?? payload ?? {};
  const sources = [
    order.items,
    order.order_items,
    order.orderItems,
    order.line_items,
    order.products,
    payload.items,
    payload.order_items,
    payload.orderItems,
    payload.line_items,
    payload.products,
    payload.data?.items,
    payload.data?.order_items,
    payload.data?.orderItems,
    payload.data?.line_items,
    payload.data?.products,
  ].filter(Array.isArray);

  const items = sources.find((candidate) => candidate.length > 0) || order.items || [];
  return items
    .map((item, index) => ({
      key: item?.id ?? `${index}-${text(item?.product_name, item?.name, item?.title, "item")}`,
      product_name: text(
        item?.resolved_product_name,
        item?.product_name,
        item?.name,
        item?.title,
        item?.product?.name,
        "منتج"
      ),
      variant_name: text(
        item?.resolved_variant_name,
        item?.variant_name,
        item?.variant?.name,
        [item?.color, item?.size].filter(Boolean).join(" / ")
      ),
      color: text(item?.color, item?.variant?.color),
      size: text(item?.size, item?.variant?.size),
      quantity: Math.max(1, toNumber(item?.quantity || item?.qty || 1)),
      image_url: text(
        item?.resolved_image_url,
        item?.image_url,
        item?.product_image,
        item?.variant_image,
        item?.primary_image_url,
        item?.public_image_url,
        item?.image,
        item?.photo_url,
        item?.thumbnail_url,
        item?.product?.image_url,
        item?.product?.product_image_url,
        item?.product?.public_image_url,
        item?.variant?.image_url,
        item?.variant?.primary_image_url,
        item?.variant?.variant_image_url,
        item?.variant?.product_image_url
      ),
      total_amount: toNumber(item?.total_amount || 0),
    }))
    .filter((item) => item.product_name || item.image_url);
};

const getWhatsAppUrl = (phone = "") => {
  const digits = String(phone || "").replace(/\D/g, "");
  return digits ? `https://wa.me/${digits}` : "https://wa.me/";
};

const formatMoney = (value = 0) => `${moneyFormatter.format(toNumber(value))} جنيه`;

function MetaTile({ label, value, icon: Icon }) {
  return (
    <div className="rounded-[1.35rem] border border-stone-200 bg-white p-4 shadow-[0_14px_35px_rgba(15,23,42,0.05)] dark:border-white/10 dark:bg-white/[0.03]">
      <div className="flex items-start gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-[linear-gradient(135deg,rgba(249,115,22,0.16),rgba(34,197,94,0.12))] text-[#ea580c] dark:bg-white/5 dark:text-[#fdba74]">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <div className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500 dark:text-slate-300">
            {label}
          </div>
          <div className="mt-1 break-words text-sm font-black leading-6 text-slate-900 dark:text-slate-100">
            {value}
          </div>
        </div>
      </div>
    </div>
  );
}

function Pill({ children }) {
  return (
    <span className="inline-flex items-center rounded-full border border-stone-200 bg-white px-3 py-1 text-[11px] font-black text-slate-700 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-200">
      {children}
    </span>
  );
}

function SummaryRow({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-stone-200 bg-white px-4 py-3 dark:border-white/10 dark:bg-white/[0.03]">
      <span className="text-xs font-black uppercase tracking-[0.16em] text-slate-500 dark:text-slate-300">
        {label}
      </span>
      <span className="max-w-[60%] text-right text-sm font-black text-slate-900 dark:text-slate-100">
        {value}
      </span>
    </div>
  );
}

export function OrderConfirmationActionPage() {
  const { code } = useParams();
  const [loading, setLoading] = useState(true);
  const [pendingAction, setPendingAction] = useState("");
  const [error, setError] = useState("");
  const [linkState, setLinkState] = useState("loading");
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

  const order = useMemo(() => result?.order || result?.data?.order || result?.data || null, [result]);
  const items = useMemo(() => normalizeItems(result || {}), [result]);
  const primaryItem = items[0] || null;

  const orderNumber = text(
    order?.public_order_number,
    order?.display_order_number,
    order?.invoice_number,
    order?.order_number,
    order?.id
  );
  const customerName = text(order?.customer_name, "عميلنا");
  const customerPhone = text(order?.customer_phone, order?.phone, order?.whatsapp, order?.mobile);
  const customerAddress = text(order?.customer_address, order?.shipping_address_line, order?.street_address, order?.address);
  const totalAmount = toNumber(order?.total_amount ?? order?.total_price ?? order?.total ?? 0);
  const governorate = text(order?.governorate, order?.city_area);
  const itemsCount = items.length;
  const totalQuantity = items.reduce((sum, item) => sum + toNumber(item.quantity), 0);
  const waUrl = getWhatsAppUrl(customerPhone);

  const isExpiredState =
    linkState === "expired" ||
    linkState === "used" ||
    EXPIRED_CODES.has(String(error || "").trim()) ||
    EXPIRED_CODES.has(String(result?.code || "").trim());

  useEffect(() => {
    if (!result) return;
    const root = result?.order ?? result?.data?.order ?? result?.data ?? result?.result?.order ?? result?.result ?? result ?? {};
    const itemSource = normalizeItems(result || {});
    console.info("[order-confirmation-api-shape]", {
      code: resolvedCode,
      root_keys: Object.keys(result || {}),
      order_keys: root && typeof root === "object" ? Object.keys(root) : [],
      items_count: itemSource.length,
      item_keys: itemSource[0] ? Object.keys(itemSource[0]) : [],
      has_primary_image: Boolean(primaryItem?.image_url || text(order?.primary_image_url, order?.image_url, order?.product_image_url, order?.public_image_url)),
      has_hostname_text: false,
    });
  }, [result, resolvedCode, order, primaryItem]);

  const loadCode = async () => {
    if (!resolvedCode) {
      setError("كود التأكيد غير صالح.");
      setLinkState("error");
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError("");
      setLinkState("loading");
      const response = await api.get(`/public/order-confirmation/${encodeURIComponent(resolvedCode)}`);
      setResult(response?.data || response);
      setLinkState("ready");
    } catch (err) {
      const status = Number(err?.status || err?.response?.status || 0);
      const responseCode = String(err?.responseBody?.code || err?.responseBody?.error || err?.code || "");
      setError(err?.responseBody?.message || err?.message || "تعذر التحقق من رابط التأكيد");
      if (status === 410 || responseCode === "ORDER_CONFIRMATION_CODE_EXPIRED") setLinkState("expired");
      else if (status === 404 || responseCode === "ORDER_CONFIRMATION_CODE_NOT_FOUND") setLinkState("used");
      else setLinkState("error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCode();
  }, [resolvedCode]);

  const applyAction = async (action) => {
    if (!resolvedCode || !action || pendingAction) return;
    try {
      setPendingAction(action);
      setError("");
      const response = await api.post(`/public/order-confirmation/${encodeURIComponent(resolvedCode)}`, { action });
      setResult(response?.data || response);
      setLinkState("ready");
    } catch (err) {
      setError(err?.responseBody?.message || err?.message || "تعذر تنفيذ الإجراء");
    } finally {
      setPendingAction("");
    }
  };

  const resultAction = String(result?.action || "").trim();
  const actionMeta = ACTION_META[resultAction];
  const resultMessage = actionMeta ? actionMeta.success : "طلبك جاهز للتأكيد";

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(249,115,22,0.18),_transparent_34%),linear-gradient(180deg,#fffaf5,#ffffff)] px-4 py-5 text-slate-900 dark:bg-[radial-gradient(circle_at_top,_rgba(249,115,22,0.18),_transparent_34%),linear-gradient(180deg,#111827,#020617)] dark:text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto flex min-h-[100svh] max-w-3xl items-center justify-center py-3">
        <section className="w-full overflow-hidden rounded-[2rem] border border-stone-200 bg-white/96 shadow-[0_30px_90px_rgba(15,23,42,0.16)] backdrop-blur dark:border-white/10 dark:bg-slate-950/90">
          <div className="relative px-4 pb-5 pt-5 sm:px-6 sm:pb-6 sm:pt-6">
            <div className="absolute inset-x-0 top-0 h-1 bg-[linear-gradient(90deg,#f97316,#f59e0b,#22c55e)]" />

            <div className="grid gap-4 lg:grid-cols-[1.12fr_0.88fr]">
              <div className="rounded-[1.75rem] border border-stone-200 bg-[linear-gradient(180deg,rgba(255,250,245,0.98),rgba(255,255,255,0.98))] p-4 shadow-[0_18px_45px_rgba(15,23,42,0.08)] dark:border-white/10 dark:bg-white/[0.03] sm:p-5">
                <div className="mb-4 flex items-start gap-3">
                  <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-[linear-gradient(135deg,rgba(249,115,22,0.16),rgba(34,197,94,0.14))] text-[#ea580c] dark:bg-white/5 dark:text-[#fdba74]">
                    <CheckCircle2 className="h-7 w-7" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[11px] font-black uppercase tracking-[0.28em] text-[#b45309] dark:text-[#fdba74]/80">
                      COD confirmation
                    </p>
                    <h1 className="mt-1 text-2xl font-black leading-tight tracking-tight sm:text-3xl text-slate-900 dark:text-slate-100">
                      طلبك جاهز للتأكيد
                    </h1>
                    <p className="mt-2 text-sm leading-6 text-slate-700 dark:text-slate-300">
                      راجع تفاصيل الطلب ثم اختر الإجراء المناسب. إذا انتهى الرابط أو تم استخدامه، ستظهر لك طريقة تواصل سريعة.
                    </p>
                  </div>
                </div>

                {loading ? (
                  <div className="rounded-[1.5rem] border border-stone-200 bg-white px-4 py-5 text-sm font-bold text-slate-700 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-100">
                    <div className="flex items-center gap-3">
                      <Loader2 className="h-5 w-5 animate-spin text-[#f97316]" />
                      جاري تحميل تفاصيل الطلب...
                    </div>
                  </div>
                ) : error && isExpiredState ? (
                  <div className="space-y-4 rounded-[1.5rem] border border-amber-200 bg-amber-50 p-4 text-slate-900 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-slate-100">
                    <div className="flex items-start gap-3">
                      <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-amber-200/70 text-slate-900 dark:bg-amber-400/20 dark:text-amber-100">
                        <MessageCircleWarning className="h-5 w-5" />
                      </div>
                      <div>
                        <h2 className="text-lg font-black">الرابط انتهت صلاحيته أو تم استخدامه</h2>
                        <p className="mt-1 text-sm leading-7 text-slate-700 dark:text-slate-300">
                          لا يمكن تنفيذ الإجراء من هذا الرابط الآن. يمكنك التواصل مع فريق الدعم عبر واتساب لإعادة إرسال رابط جديد أو استكمال الطلب يدويًا.
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-col gap-3 sm:flex-row">
                      <a
                        href={waUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center justify-center gap-2 rounded-2xl bg-[#16a34a] px-4 py-3 text-sm font-black text-white transition hover:-translate-y-0.5"
                      >
                        <Phone className="h-4 w-4" />
                        تواصل عبر واتساب
                      </a>
                      <Link
                        to="/shop"
                        className="inline-flex items-center justify-center gap-2 rounded-2xl border border-stone-200 bg-white px-4 py-3 text-sm font-black text-slate-800 transition hover:-translate-y-0.5 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-100"
                      >
                        <ShoppingBag className="h-4 w-4" />
                        العودة للمتجر
                      </Link>
                    </div>
                  </div>
                ) : error ? (
                  <div className="space-y-4 rounded-[1.5rem] border border-rose-200 bg-rose-50 p-4 text-slate-900 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-slate-100">
                    <div className="flex items-start gap-3">
                      <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-rose-200/70 text-slate-900 dark:bg-rose-400/20 dark:text-rose-100">
                        <MessageCircleWarning className="h-5 w-5" />
                      </div>
                      <div>
                        <h2 className="text-lg font-black">تعذر التحقق من الرابط</h2>
                        <p className="mt-1 text-sm leading-7 text-slate-700 dark:text-slate-300">
                          {error}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-col gap-3 sm:flex-row">
                      <a
                        href={waUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center justify-center gap-2 rounded-2xl bg-[#16a34a] px-4 py-3 text-sm font-black text-white transition hover:-translate-y-0.5"
                      >
                        <Phone className="h-4 w-4" />
                        تواصل عبر واتساب
                      </a>
                      <Link
                        to="/shop"
                        className="inline-flex items-center justify-center gap-2 rounded-2xl border border-stone-200 bg-white px-4 py-3 text-sm font-black text-slate-800 transition hover:-translate-y-0.5 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-100"
                      >
                        <ShoppingBag className="h-4 w-4" />
                        العودة للمتجر
                      </Link>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="rounded-[1.5rem] border border-emerald-200 bg-emerald-50 p-4 text-slate-900 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-slate-100">
                      <div className="flex items-start gap-3">
                        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-emerald-200/80 text-slate-900 dark:bg-emerald-400/20 dark:text-emerald-100">
                          <CheckCircle2 className="h-5 w-5" />
                        </div>
                        <div>
                          <h2 className="text-lg font-black">{resultMessage}</h2>
                          <p className="mt-1 text-sm leading-7 text-slate-700 dark:text-slate-300">
                            اختر أحد الأزرار بالأسفل لإكمال العملية. كل زر يتنفذ مرة واحدة فقط.
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <MetaTile label="رقم الطلب" value={orderNumber || "—"} icon={({ className }) => <span className={className}>#</span>} />
                      <MetaTile label="اسم العميل" value={customerName || "—"} icon={({ className }) => <span className={className}>👤</span>} />
                      <MetaTile label="رقم الهاتف" value={customerPhone || "—"} icon={({ className }) => <span className={className}>☎</span>} />
                      <MetaTile label="الإجمالي" value={formatMoney(totalAmount)} icon={({ className }) => <span className={className}>₪</span>} />
                    </div>

                    <div className="grid gap-4 lg:grid-cols-[0.95fr_1.05fr]">
                      <div className="overflow-hidden rounded-[1.5rem] border border-stone-200 bg-white shadow-[0_18px_45px_rgba(15,23,42,0.06)] dark:border-white/10 dark:bg-white/[0.03]">
                        <div className="aspect-[4/3] bg-[linear-gradient(135deg,rgba(249,115,22,0.12),rgba(59,130,246,0.10))]">
                          {primaryItem?.image_url ? (
                            <img
                              src={primaryItem.image_url}
                              alt={primaryItem.product_name}
                              className="h-full w-full object-cover"
                              loading="lazy"
                            />
                          ) : (
                            <div className="flex h-full items-center justify-center text-stone-400 dark:text-slate-200/40">
                              <ImageIcon className="h-12 w-12" />
                            </div>
                          )}
                        </div>

                        <div className="space-y-2 p-4">
                          <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.2em] text-slate-500 dark:text-slate-300">
                            <Package2 className="h-4 w-4 text-[#f97316]" />
                            أول منتج في الطلب
                          </div>
                          <h3 className="text-lg font-black leading-snug text-slate-900 dark:text-slate-100">
                            {primaryItem?.product_name || "منتج"}
                          </h3>
                          <div className="flex flex-wrap gap-2 text-xs font-bold text-slate-700 dark:text-slate-300">
                            {primaryItem?.size ? <Pill>{`المقاس: ${primaryItem.size}`}</Pill> : null}
                            {primaryItem?.color ? <Pill>{`اللون: ${primaryItem.color}`}</Pill> : null}
                            <Pill>{`الكمية: ${primaryItem?.quantity || 1}`}</Pill>
                          </div>
                          {primaryItem?.variant_name ? (
                            <p className="text-sm leading-6 text-slate-700 dark:text-slate-300">{primaryItem.variant_name}</p>
                          ) : null}
                        </div>
                      </div>

                      <div className="space-y-4">
                        <div className="rounded-[1.5rem] border border-stone-200 bg-stone-50 p-4 dark:border-white/10 dark:bg-white/[0.03]">
                          <div className="mb-3 flex items-center gap-2 text-sm font-black text-slate-900 dark:text-slate-100">
                            <ShoppingBag className="h-4 w-4 text-[#f97316]" />
                            تفاصيل الطلب
                          </div>
                          <div className="space-y-3">
                            {items.length ? (
                              items.map((item) => (
                                <div
                                  key={item.key}
                                  className="rounded-2xl border border-stone-200 bg-white p-3 shadow-sm dark:border-white/10 dark:bg-slate-950/40"
                                >
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                      <div className="text-sm font-black text-slate-900 dark:text-slate-100">
                                        {item.product_name}
                                      </div>
                                      {item.variant_name ? (
                                        <div className="mt-1 text-xs font-bold text-slate-500 dark:text-slate-300">
                                          {item.variant_name}
                                        </div>
                                      ) : null}
                                    </div>
                                    <div className="rounded-full bg-slate-900 px-3 py-1 text-xs font-black text-white dark:bg-slate-100 dark:text-slate-950">
                                      ×{item.quantity}
                                    </div>
                                  </div>
                                  <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-black uppercase tracking-[0.16em] text-slate-500 dark:text-slate-300">
                                    {item.size ? <Pill>{`Size: ${item.size}`}</Pill> : null}
                                    {item.color ? <Pill>{`Color: ${item.color}`}</Pill> : null}
                                  </div>
                                </div>
                              ))
                            ) : (
                              <div className="rounded-2xl border border-dashed border-stone-300 bg-white px-4 py-5 text-sm text-slate-600 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-300">
                                لا توجد منتجات ظاهرة لهذا الطلب بعد.
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2">
                          <MetaTile label="عدد القطع" value={String(totalQuantity || itemsCount || 0)} icon={({ className }) => <span className={className}>◫</span>} />
                          <MetaTile label="المحافظة / المنطقة" value={governorate || "—"} icon={({ className }) => <span className={className}>⌂</span>} />
                        </div>

                        <div className="rounded-[1.5rem] border border-stone-200 bg-white p-4 shadow-[0_18px_45px_rgba(15,23,42,0.06)] dark:border-white/10 dark:bg-white/[0.03]">
                          <div className="mb-3 flex items-center gap-2 text-sm font-black text-slate-900 dark:text-slate-100">
                            <MapPin className="h-4 w-4 text-[#f97316]" />
                            العنوان
                          </div>
                          <p className="text-sm leading-7 text-slate-700 dark:text-slate-300">
                            {customerAddress || "لا يوجد عنوان ظاهر لهذا الطلب"}
                          </p>
                        </div>
                      </div>
                    </div>

                    {!resultAction ? (
                      <div className="space-y-3 pt-1">
                        <div className="grid gap-3 sm:grid-cols-3">
                          {Object.entries(ACTION_META).map(([action, meta]) => {
                            const Icon = meta.icon;
                            const isBusy = pendingAction === action;
                            const disabled = Boolean(pendingAction);
                            return (
                              <button
                                key={action}
                                type="button"
                                onClick={() => applyAction(action)}
                                disabled={disabled}
                                className={[
                                  "flex min-h-[88px] items-center gap-3 rounded-[1.35rem] border px-4 py-4 text-right transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60",
                                  meta.className,
                                ].join(" ")}
                              >
                                <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-white/15 text-current">
                                  {isBusy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Icon className="h-5 w-5" />}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="text-base font-black leading-tight text-current">{meta.label}</div>
                                  <div className="mt-1 text-xs font-semibold leading-5 text-current opacity-90">{meta.hint}</div>
                                </div>
                              </button>
                            );
                          })}
                        </div>

                        {pendingAction ? (
                          <div className="rounded-2xl border border-stone-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-100">
                            جاري تنفيذ: {ACTION_META[pendingAction]?.label || "الإجراء"}...
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <div className="rounded-[1.5rem] border border-emerald-200 bg-emerald-50 p-4 text-slate-900 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-slate-100">
                        <div className="flex items-start gap-3">
                          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-emerald-200/80 text-slate-900 dark:bg-emerald-400/20 dark:text-emerald-100">
                            <CheckCircle2 className="h-5 w-5" />
                          </div>
                          <div>
                            <h2 className="text-lg font-black">{actionMeta?.success || "تم تحديث الطلب"}</h2>
                            <p className="mt-1 text-sm leading-7 text-slate-700 dark:text-slate-300">
                              {actionMeta?.hint || "تم تنفيذ الإجراء بنجاح."}
                            </p>
                            {result?.already_applied ? (
                              <p className="mt-2 text-xs font-bold text-slate-700 dark:text-slate-300">
                                تم تطبيق هذا الإجراء سابقًا بالفعل.
                              </p>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="rounded-[1.75rem] border border-stone-200 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(255,251,247,0.98))] p-4 shadow-[0_18px_45px_rgba(15,23,42,0.06)] dark:border-white/10 dark:bg-white/[0.03] sm:p-5">
                <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.24em] text-slate-500 dark:text-slate-300">
                  <Package2 className="h-4 w-4 text-[#f97316]" />
                  ملخص سريع
                </div>

                <div className="mt-4 space-y-3">
                  <SummaryRow label="رقم الطلب" value={orderNumber || "—"} />
                  <SummaryRow label="اسم العميل" value={customerName || "—"} />
                  <SummaryRow label="الهاتف" value={customerPhone || "—"} />
                  <SummaryRow label="الإجمالي" value={formatMoney(totalAmount)} />
                  <SummaryRow label="عدد المنتجات" value={String(itemsCount)} />
                  <SummaryRow label="الحالة الحالية" value={text(result?.target_status, order?.status, "—")} />
                </div>

                <div className="mt-5 rounded-[1.4rem] border border-stone-200 bg-white p-4 dark:border-white/10 dark:bg-slate-950/40">
                  <div className="text-sm font-black text-slate-900 dark:text-slate-100">ملاحظات</div>
                  <ul className="mt-3 space-y-2 text-sm leading-7 text-slate-700 dark:text-slate-300">
                    <li>• الأزرار الكبيرة تناسب الهاتف واللمس المباشر.</li>
                    <li>• التحميل يظهر داخل الزر نفسه فقط لتقليل الالتباس.</li>
                    <li>• لو الرابط غير صالح ستجد زر واتساب للتواصل فورًا.</li>
                  </ul>
                </div>

                <div className="mt-5 flex flex-col gap-3">
                  <Link
                    to="/shop"
                    className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-950 px-4 py-3 text-sm font-black text-white transition hover:-translate-y-0.5 dark:bg-white dark:text-slate-950"
                  >
                    <ArrowLeft className="h-4 w-4" />
                    العودة إلى المتجر
                  </Link>
                  <a
                    href={waUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center justify-center gap-2 rounded-2xl border border-stone-200 bg-white px-4 py-3 text-sm font-black text-slate-800 transition hover:-translate-y-0.5 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-100"
                  >
                    <ExternalLink className="h-4 w-4" />
                    تواصل عبر واتساب
                  </a>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

export default OrderConfirmationActionPage;
