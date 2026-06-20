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
    shortLabel: "تم تأكيد الطلب",
    icon: CheckCircle2,
    className:
      "border-emerald-200/70 bg-emerald-500 text-white shadow-[0_20px_45px_rgba(16,185,129,0.25)] hover:bg-emerald-400",
    hint: "يؤكد الطلب ويجهزه فريقنا للشحن.",
  },
  edit: {
    label: "تعديل الطلب",
    shortLabel: "تم طلب تعديل الطلب",
    icon: PencilLine,
    className:
      "border-amber-200/70 bg-amber-400 text-slate-950 shadow-[0_20px_45px_rgba(245,158,11,0.24)] hover:bg-amber-300",
    hint: "سيتواصل معك أحد أفراد الفريق لتعديل البيانات.",
  },
  cancel: {
    label: "إلغاء الطلب",
    shortLabel: "تم إلغاء الطلب",
    icon: XCircle,
    className:
      "border-rose-200/70 bg-rose-600 text-white shadow-[0_20px_45px_rgba(244,63,94,0.25)] hover:bg-rose-500",
    hint: "سيتم إلغاء الطلب واستكمال الخطوات المطلوبة داخليًا.",
  },
};

const OUTDATED_LINK_CODES = new Set([
  "ORDER_CONFIRMATION_CODE_EXPIRED",
  "ORDER_CONFIRMATION_CODE_NOT_FOUND",
  "ORDER_CONFIRMATION_CODE_ALREADY_USED",
]);

const moneyFormatter = new Intl.NumberFormat("ar-EG", {
  maximumFractionDigits: 2,
});

const firstText = (...values) => {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
};

const parseItems = (items = []) =>
  (Array.isArray(items) ? items : [])
    .map((item, index) => ({
      key: item?.id ?? `${index}-${item?.product_name || "item"}`,
      product_name: firstText(item?.product_name, item?.name, item?.title, "منتج"),
      variant_name: firstText(item?.variant_name, [item?.color, item?.size].filter(Boolean).join(" / ")),
      color: firstText(item?.color),
      size: firstText(item?.size),
      quantity: Math.max(1, Number(item?.quantity || item?.qty || 1) || 1),
      image_url: firstText(
        item?.image_url,
        item?.product_image,
        item?.variant_image,
        item?.photo_url,
        item?.thumbnail_url
      ),
      total_amount: Number(item?.total_amount || 0) || 0,
    }))
    .filter((item) => item.product_name || item.image_url);

const formatMoney = (value = 0) => `${moneyFormatter.format(Number(value || 0))} جنيه`;

const getActionLabel = (action = "") => {
  if (action === "confirm") return ACTION_META.confirm.shortLabel;
  if (action === "edit") return ACTION_META.edit.shortLabel;
  if (action === "cancel") return ACTION_META.cancel.shortLabel;
  return "";
};

const getWhatsAppLink = (phone = "") => {
  const digits = String(phone || "").replace(/\D/g, "");
  return digits ? `https://wa.me/${digits}` : "https://wa.me/";
};

export function OrderConfirmationActionPage() {
  const { code } = useParams();
  const [isLoading, setIsLoading] = useState(true);
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

  const order = result?.order || null;
  const items = useMemo(() => parseItems(order?.items), [order]);
  const primaryItem = items[0] || null;
  const totalQuantity = useMemo(
    () => items.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
    [items]
  );
  const orderNumber = firstText(
    order?.public_order_number,
    order?.display_order_number,
    order?.invoice_number,
    order?.order_number,
    order?.id
  );
  const customerPhone = firstText(order?.customer_phone, order?.phone, order?.whatsapp, order?.mobile);
  const customerAddress = firstText(
    order?.customer_address,
    order?.shipping_address_line,
    order?.street_address,
    order?.address
  );
  const isOutdatedLink =
    linkState === "expired" ||
    linkState === "used" ||
    OUTDATED_LINK_CODES.has(String(error || "").trim()) ||
    OUTDATED_LINK_CODES.has(String(result?.code || "").trim());

  const loadCode = async () => {
    if (!resolvedCode) {
      setError("كود التأكيد غير صالح.");
      setLinkState("error");
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      setError("");
      setLinkState("loading");
      const response = await api.get(`/public/order-confirmation/${encodeURIComponent(resolvedCode)}`);
      setResult(response?.data || response);
      setLinkState("ready");
    } catch (err) {
      const status = Number(err?.status || err?.response?.status || 0);
      const responseCode = String(err?.responseBody?.code || err?.responseBody?.error || err?.code || "");
      const message = err?.responseBody?.message || err?.message || "تعذر التحقق من رابط التأكيد";
      setError(message);
      if (status === 410 || responseCode === "ORDER_CONFIRMATION_CODE_EXPIRED") {
        setLinkState("expired");
      } else if (status === 404 || responseCode === "ORDER_CONFIRMATION_CODE_NOT_FOUND") {
        setLinkState("used");
      } else {
        setLinkState("error");
      }
    } finally {
      setIsLoading(false);
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
  const actionLabel = getActionLabel(resultAction);
  const resultMessage = resultAction ? actionLabel : "طلبك جاهز للتأكيد";
  const waLink = getWhatsAppLink(customerPhone);

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(249,115,22,0.2),_transparent_34%),linear-gradient(180deg,#fffaf5,#ffffff)] px-4 py-5 text-slate-900 dark:bg-[radial-gradient(circle_at_top,_rgba(249,115,22,0.18),_transparent_34%),linear-gradient(180deg,#111827,#020617)] dark:text-white sm:px-6 lg:px-8">
      <div className="mx-auto flex min-h-[100svh] max-w-3xl items-center justify-center py-3">
        <section className="w-full overflow-hidden rounded-[2rem] border border-white/70 bg-white/90 shadow-[0_30px_90px_rgba(15,23,42,0.16)] backdrop-blur dark:border-white/10 dark:bg-slate-950/90">
          <div className="relative px-4 pb-5 pt-5 sm:px-6 sm:pb-6 sm:pt-6">
            <div className="absolute inset-x-0 top-0 h-1 bg-[linear-gradient(90deg,#f97316,#f59e0b,#22c55e)]" />

            <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
              <div className="rounded-[1.75rem] border border-stone-200/80 bg-[linear-gradient(180deg,rgba(255,247,237,0.96),rgba(255,255,255,0.96))] p-4 shadow-[0_18px_45px_rgba(15,23,42,0.08)] dark:border-white/10 dark:bg-white/[0.03] sm:p-5">
                <div className="mb-4 flex items-start gap-3">
                  <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-[linear-gradient(135deg,rgba(249,115,22,0.16),rgba(34,197,94,0.14))] text-[#ea580c] dark:bg-white/5 dark:text-[#fdba74]">
                    <CheckCircle2 className="h-7 w-7" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[11px] font-black uppercase tracking-[0.28em] text-[#b45309] dark:text-[#fdba74]/80">
                      COD confirmation
                    </p>
                    <h1 className="mt-1 text-2xl font-black leading-tight tracking-tight sm:text-3xl">
                      طلبك جاهز للتأكيد
                    </h1>
                    <p className="mt-2 text-sm leading-6 text-stone-600 dark:text-slate-300">
                      راجع تفاصيل الطلب ثم اختر الإجراء المناسب. إذا انتهى الرابط أو تم استخدامه، ستظهر لك طريقة تواصل سريعة.
                    </p>
                  </div>
                </div>

                {isLoading ? (
                  <div className="rounded-[1.5rem] border border-stone-200 bg-white px-4 py-5 text-sm font-bold text-stone-700 dark:border-white/10 dark:bg-white/[0.03] dark:text-white/80">
                    <div className="flex items-center gap-3">
                      <Loader2 className="h-5 w-5 animate-spin text-[#f97316]" />
                      جاري تحميل تفاصيل الطلب...
                    </div>
                  </div>
                ) : error && isOutdatedLink ? (
                  <div className="space-y-4 rounded-[1.5rem] border border-amber-200 bg-amber-50 p-4 text-amber-900 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-100">
                    <div className="flex items-start gap-3">
                      <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-amber-200/70 text-amber-900 dark:bg-amber-400/20 dark:text-amber-100">
                        <MessageCircleWarning className="h-5 w-5" />
                      </div>
                      <div>
                        <h2 className="text-lg font-black">الرابط انتهت صلاحيته أو تم استخدامه</h2>
                        <p className="mt-1 text-sm leading-7 text-amber-900/80 dark:text-amber-50/90">
                          لا يمكن تنفيذ الإجراء من هذا الرابط الآن. يمكنك التواصل مع فريق الدعم عبر واتساب لإعادة إرسال رابط جديد أو استكمال الطلب يدويًا.
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-col gap-3 sm:flex-row">
                      <a
                        href={waLink}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center justify-center gap-2 rounded-2xl bg-[#16a34a] px-4 py-3 text-sm font-black text-white transition hover:-translate-y-0.5"
                      >
                        <Phone className="h-4 w-4" />
                        تواصل عبر واتساب
                      </a>
                      <Link
                        to="/shop"
                        className="inline-flex items-center justify-center gap-2 rounded-2xl border border-stone-200 bg-white px-4 py-3 text-sm font-black text-stone-800 transition hover:-translate-y-0.5 dark:border-white/10 dark:bg-white/[0.04] dark:text-white/90"
                      >
                        <ShoppingBag className="h-4 w-4" />
                        العودة للمتجر
                      </Link>
                    </div>
                  </div>
                ) : error ? (
                  <div className="space-y-4 rounded-[1.5rem] border border-rose-200 bg-rose-50 p-4 text-rose-900 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-100">
                    <div className="flex items-start gap-3">
                      <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-rose-200/70 text-rose-900 dark:bg-rose-400/20 dark:text-rose-100">
                        <MessageCircleWarning className="h-5 w-5" />
                      </div>
                      <div>
                        <h2 className="text-lg font-black">تعذر التحقق من الرابط</h2>
                        <p className="mt-1 text-sm leading-7 text-rose-900/80 dark:text-rose-50/90">
                          {error}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-col gap-3 sm:flex-row">
                      <a
                        href={waLink}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center justify-center gap-2 rounded-2xl bg-[#16a34a] px-4 py-3 text-sm font-black text-white transition hover:-translate-y-0.5"
                      >
                        <Phone className="h-4 w-4" />
                        تواصل عبر واتساب
                      </a>
                      <Link
                        to="/shop"
                        className="inline-flex items-center justify-center gap-2 rounded-2xl border border-stone-200 bg-white px-4 py-3 text-sm font-black text-stone-800 transition hover:-translate-y-0.5 dark:border-white/10 dark:bg-white/[0.04] dark:text-white/90"
                      >
                        <ShoppingBag className="h-4 w-4" />
                        العودة للمتجر
                      </Link>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="rounded-[1.5rem] border border-emerald-200 bg-emerald-50 p-4 text-emerald-900 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-100">
                      <div className="flex items-start gap-3">
                        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-emerald-200/80 text-emerald-900 dark:bg-emerald-400/20 dark:text-emerald-100">
                          <CheckCircle2 className="h-5 w-5" />
                        </div>
                        <div>
                          <h2 className="text-lg font-black">{resultMessage}</h2>
                          <p className="mt-1 text-sm leading-7 text-emerald-900/80 dark:text-emerald-50/90">
                            اختر أحد الأزرار بالأسفل لإكمال العملية. كل زر يتنفذ مرة واحدة فقط، ولو تم الإجراء ستظهر لك نتيجة واضحة هنا.
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <InfoTile label="رقم الطلب" value={orderNumber || "—"} icon={HashTileIcon} />
                      <InfoTile label="اسم العميل" value={firstText(order?.customer_name, "—")} icon={UserTileIcon} />
                      <InfoTile label="رقم الهاتف" value={customerPhone || "—"} icon={PhoneTileIcon} />
                      <InfoTile label="الإجمالي" value={formatMoney(order?.total_amount ?? order?.total_price ?? order?.total ?? 0)} icon={MoneyTileIcon} />
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
                            <div className="flex h-full items-center justify-center text-stone-400 dark:text-white/30">
                              <ImageIcon className="h-12 w-12" />
                            </div>
                          )}
                        </div>
                        <div className="space-y-2 p-4">
                          <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.2em] text-stone-500 dark:text-white/45">
                            <Package2 className="h-4 w-4" />
                            أول منتج في الطلب
                          </div>
                          <h3 className="text-lg font-black leading-snug text-slate-900 dark:text-white">
                            {primaryItem?.product_name || "لا توجد منتجات ظاهرة"}
                          </h3>
                          <div className="flex flex-wrap gap-2 text-xs font-bold text-stone-600 dark:text-white/70">
                            {primaryItem?.size ? <TagPill>{`المقاس: ${primaryItem.size}`}</TagPill> : null}
                            {primaryItem?.color ? <TagPill>{`اللون: ${primaryItem.color}`}</TagPill> : null}
                            <TagPill>{`الكمية: ${primaryItem?.quantity || 1}`}</TagPill>
                          </div>
                          {primaryItem?.variant_name ? (
                            <p className="text-sm leading-6 text-stone-600 dark:text-slate-300">{primaryItem.variant_name}</p>
                          ) : null}
                        </div>
                      </div>

                      <div className="space-y-4">
                        <div className="rounded-[1.5rem] border border-stone-200 bg-stone-50 p-4 dark:border-white/10 dark:bg-white/[0.03]">
                          <div className="mb-3 flex items-center gap-2 text-sm font-black text-slate-900 dark:text-white">
                            <ShoppingBag className="h-4 w-4 text-[#f97316]" />
                            تفاصيل الطلب
                          </div>
                          <div className="space-y-3">
                            {items.length ? (
                              items.map((item) => (
                                <div
                                  key={item.key}
                                  className="rounded-2xl border border-white/70 bg-white p-3 shadow-sm dark:border-white/10 dark:bg-slate-950/40"
                                >
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                      <div className="text-sm font-black text-slate-900 dark:text-white">
                                        {item.product_name}
                                      </div>
                                      {item.variant_name ? (
                                        <div className="mt-1 text-xs font-bold text-stone-500 dark:text-white/60">
                                          {item.variant_name}
                                        </div>
                                      ) : null}
                                    </div>
                                    <div className="rounded-full bg-slate-900 px-3 py-1 text-xs font-black text-white dark:bg-white dark:text-slate-950">
                                      ×{item.quantity}
                                    </div>
                                  </div>
                                  <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-black uppercase tracking-[0.16em] text-stone-500 dark:text-white/50">
                                    {item.size ? <TagPill>{`Size: ${item.size}`}</TagPill> : null}
                                    {item.color ? <TagPill>{`Color: ${item.color}`}</TagPill> : null}
                                  </div>
                                </div>
                              ))
                            ) : (
                              <div className="rounded-2xl border border-dashed border-stone-300 bg-white px-4 py-5 text-sm text-stone-500 dark:border-white/10 dark:bg-white/[0.03] dark:text-white/65">
                                لم يتم العثور على تفاصيل المنتجات لهذا الطلب.
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2">
                          <InfoTile label="عدد القطع" value={String(totalQuantity || items.length || 0)} icon={PackageTileIcon} />
                          <InfoTile label="المحافظة / المنطقة" value={firstText(order?.governorate, order?.city_area, "—")} icon={MapTileIcon} />
                        </div>

                        <div className="rounded-[1.5rem] border border-stone-200 bg-white p-4 shadow-[0_18px_45px_rgba(15,23,42,0.06)] dark:border-white/10 dark:bg-white/[0.03]">
                          <div className="mb-3 flex items-center gap-2 text-sm font-black text-slate-900 dark:text-white">
                            <MapPin className="h-4 w-4 text-[#f97316]" />
                            العنوان
                          </div>
                          <p className="text-sm leading-7 text-stone-700 dark:text-slate-300">
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
                            const isPending = pendingAction === action;
                            const isDisabled = Boolean(pendingAction);
                            return (
                              <button
                                key={action}
                                type="button"
                                onClick={() => applyAction(action)}
                                disabled={isDisabled}
                                className={[
                                  "group relative overflow-hidden rounded-[1.35rem] border px-4 py-4 text-right transition",
                                  "flex min-h-[88px] items-center gap-3",
                                  "hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60",
                                  meta.className,
                                ].join(" ")}
                              >
                                <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-white/15 text-current">
                                  {isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Icon className="h-5 w-5" />}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="text-base font-black leading-tight">{meta.label}</div>
                                  <div className="mt-1 text-xs font-semibold leading-5 opacity-90">{meta.hint}</div>
                                </div>
                              </button>
                            );
                          })}
                        </div>

                        {pendingAction ? (
                          <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm font-bold text-stone-700 dark:border-white/10 dark:bg-white/[0.03] dark:text-white/75">
                            جاري تنفيذ: {ACTION_META[pendingAction]?.label || "الإجراء"}...
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <div className="rounded-[1.5rem] border border-emerald-200 bg-emerald-50 p-4 text-emerald-900 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-100">
                        <div className="flex items-start gap-3">
                          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-emerald-200/80 text-emerald-900 dark:bg-emerald-400/20 dark:text-emerald-100">
                            <CheckCircle2 className="h-5 w-5" />
                          </div>
                          <div>
                            <h2 className="text-lg font-black">{actionLabel}</h2>
                            <p className="mt-1 text-sm leading-7 text-emerald-900/80 dark:text-emerald-50/90">
                              {ACTION_META[resultAction]?.hint || "تم تنفيذ الإجراء بنجاح."}
                            </p>
                            {result?.already_applied ? (
                              <p className="mt-2 text-xs font-bold text-emerald-900/75 dark:text-emerald-50/80">
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

              <div className="rounded-[1.75rem] border border-stone-200/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(255,251,247,0.96))] p-4 shadow-[0_18px_45px_rgba(15,23,42,0.06)] dark:border-white/10 dark:bg-white/[0.03] sm:p-5">
                <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.24em] text-stone-500 dark:text-white/40">
                  <Package2 className="h-4 w-4 text-[#f97316]" />
                  ملخص سريع
                </div>

                <div className="mt-4 space-y-3">
                  <MiniSummaryRow label="رقم الطلب" value={orderNumber || "—"} />
                  <MiniSummaryRow label="اسم العميل" value={firstText(order?.customer_name, "—")} />
                  <MiniSummaryRow label="الهاتف" value={customerPhone || "—"} />
                  <MiniSummaryRow label="الإجمالي" value={formatMoney(order?.total_amount ?? order?.total_price ?? order?.total ?? 0)} />
                  <MiniSummaryRow label="عدد المنتجات" value={String(items.length || 0)} />
                  <MiniSummaryRow label="الحالة الحالية" value={firstText(result?.target_status, order?.status, "—")} />
                </div>

                <div className="mt-5 rounded-[1.4rem] border border-stone-200 bg-white p-4 dark:border-white/10 dark:bg-slate-950/40">
                  <div className="text-sm font-black text-slate-900 dark:text-white">ملاحظات</div>
                  <ul className="mt-3 space-y-2 text-sm leading-7 text-stone-600 dark:text-slate-300">
                    <li>• الأزرار الكبيرة تعطيك تنفيذًا مباشرًا وسريعًا من الهاتف.</li>
                    <li>• بعد الضغط يظهر التحميل داخل الزر نفسه فقط.</li>
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
                    href={waLink}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center justify-center gap-2 rounded-2xl border border-stone-200 bg-white px-4 py-3 text-sm font-black text-stone-800 transition hover:-translate-y-0.5 dark:border-white/10 dark:bg-white/[0.04] dark:text-white/90"
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

function InfoTile({ label, value, icon: Icon }) {
  return (
    <div className="rounded-[1.35rem] border border-stone-200 bg-white p-4 shadow-[0_14px_35px_rgba(15,23,42,0.05)] dark:border-white/10 dark:bg-white/[0.03]">
      <div className="flex items-start gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-[linear-gradient(135deg,rgba(249,115,22,0.16),rgba(34,197,94,0.12))] text-[#ea580c] dark:bg-white/5 dark:text-[#fdba74]">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <div className="text-[11px] font-black uppercase tracking-[0.18em] text-stone-500 dark:text-white/45">
            {label}
          </div>
          <div className="mt-1 break-words text-sm font-black leading-6 text-slate-900 dark:text-white">
            {value}
          </div>
        </div>
      </div>
    </div>
  );
}

function TagPill({ children }) {
  return (
    <span className="inline-flex items-center rounded-full border border-stone-200 bg-white px-3 py-1 text-[11px] font-black text-stone-600 dark:border-white/10 dark:bg-white/[0.04] dark:text-white/75">
      {children}
    </span>
  );
}

function MiniSummaryRow({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-stone-200 bg-white px-4 py-3 dark:border-white/10 dark:bg-white/[0.03]">
      <span className="text-xs font-black uppercase tracking-[0.16em] text-stone-500 dark:text-white/45">{label}</span>
      <span className="max-w-[60%] text-right text-sm font-black text-slate-900 dark:text-white">{value}</span>
    </div>
  );
}

const HashTileIcon = ({ className = "" }) => <span className={className}>#</span>;
const UserTileIcon = ({ className = "" }) => <span className={className}>👤</span>;
const PhoneTileIcon = ({ className = "" }) => <span className={className}>☎</span>;
const MoneyTileIcon = ({ className = "" }) => <span className={className}>₪</span>;
const PackageTileIcon = ({ className = "" }) => <span className={className}>◫</span>;
const MapTileIcon = ({ className = "" }) => <span className={className}>⌂</span>;

export default OrderConfirmationActionPage;
