import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  CheckCircle2,
  Image as ImageIcon,
  Loader2,
  MapPin,
  MessageCircleWarning,
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
    hint: "سيتم تجهيز الطلب وإرساله للفريق.",
    icon: CheckCircle2,
    className: "border-emerald-200 bg-emerald-600 text-white hover:bg-emerald-500",
  },
  edit: {
    label: "تعديل الطلب",
    success: "تم طلب تعديل الطلب",
    hint: "سيتواصل معك أحد أفراد الفريق للتعديل.",
    icon: PencilLine,
    className: "border-amber-200 bg-amber-400 text-slate-950 hover:bg-amber-300",
  },
  cancel: {
    label: "إلغاء الطلب",
    success: "تم إلغاء الطلب",
    hint: "تم تسجيل الإلغاء وسيتم إيقاف التجهيز.",
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

const formatMoney = (value = 0) => `${moneyFormatter.format(toNumber(value))} جنيه`;

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

  const items = sources.find((candidate) => candidate.length > 0) || [];
  return items
    .map((item, index) => ({
      key: item?.id ?? `${index}-${text(item?.product_name, item?.name, item?.title, "item")}`,
      product_name: text(item?.resolved_product_name, item?.product_name, item?.name, item?.title, item?.product?.name, "منتج"),
      variant_name: text(item?.resolved_variant_name, item?.variant_name, item?.variant?.name, [item?.color, item?.size].filter(Boolean).join(" / ")),
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
    }))
    .filter((item) => item.product_name || item.image_url);
};

const getWhatsAppUrl = (phone = "") => {
  const digits = String(phone || "").replace(/\D/g, "");
  return digits ? `https://wa.me/${digits}` : "https://wa.me/";
};

function InfoCard({ title, icon: Icon, children }) {
  return (
    <div className="rounded-[1.35rem] border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2 text-sm font-black text-slate-950">
        <Icon className="h-4 w-4 text-[#f97316]" />
        {title}
      </div>
      {children}
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

  const orderNumber = text(order?.public_order_number, order?.display_order_number, order?.invoice_number, order?.order_number, order?.id);
  const customerName = text(order?.customer_name, "العميل");
  const customerPhone = text(order?.customer_phone, order?.phone, order?.whatsapp, order?.mobile);
  const customerAddress = text(order?.customer_address, order?.shipping_address_line, order?.street_address, order?.address);
  const totalAmount = toNumber(order?.total_amount ?? order?.total_price ?? order?.total ?? 0);
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
    <main className="min-h-screen bg-[#070b1a] px-4 py-5 text-slate-950 sm:px-6 lg:px-8">
      <div className="mx-auto flex min-h-[100svh] max-w-3xl items-center justify-center py-3">
        <section className="w-full overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-[0_30px_90px_rgba(15,23,42,0.14)]">
          <div className="px-4 pb-5 pt-5 sm:px-6 sm:pb-6 sm:pt-6">
            <div className="h-1 w-full rounded-full bg-slate-900" />

            <div className="mt-4 space-y-4">
              <div className="rounded-[1.5rem] border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                <div className="mb-3 flex items-start gap-3">
                  <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-slate-100 text-[#ea580c]">
                    <CheckCircle2 className="h-7 w-7" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[11px] font-black uppercase tracking-[0.28em] text-[#b45309]">COD confirmation</p>
                    <h1 className="mt-1 text-2xl font-black leading-tight tracking-tight text-slate-950 sm:text-3xl">طلبك جاهز للتأكيد</h1>
                    <p className="mt-2 text-sm leading-6 text-slate-700">رقم الطلب: {orderNumber || "—"}</p>
                  </div>
                </div>

                {loading ? (
                  <div className="rounded-[1.35rem] border border-slate-200 bg-slate-50 px-4 py-5 text-sm font-bold text-slate-700 shadow-sm">
                    <div className="flex items-center gap-3">
                      <Loader2 className="h-5 w-5 animate-spin text-[#f97316]" />
                      جاري تحميل تفاصيل الطلب...
                    </div>
                  </div>
                ) : error && isExpiredState ? (
                  <div className="space-y-4 rounded-[1.35rem] border border-amber-200 bg-amber-50 p-4 text-slate-950 shadow-sm">
                    <div className="flex items-start gap-3">
                      <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-amber-200/80 text-slate-950">
                        <MessageCircleWarning className="h-5 w-5" />
                      </div>
                      <div>
                        <h2 className="text-lg font-black">الرابط انتهت صلاحيته أو تم استخدامه</h2>
                        <p className="mt-1 text-sm leading-7 text-slate-700">لا يمكن تنفيذ الإجراء من هذا الرابط الآن.</p>
                      </div>
                    </div>
                    <div className="flex flex-col gap-3 sm:flex-row">
                      <a href={waUrl} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center gap-2 rounded-2xl bg-[#16a34a] px-4 py-3 text-sm font-black text-white transition hover:-translate-y-0.5">
                        <Phone className="h-4 w-4" />
                        تواصل عبر واتساب
                      </a>
                    </div>
                  </div>
                ) : error ? (
                  <div className="space-y-4 rounded-[1.35rem] border border-rose-200 bg-rose-50 p-4 text-slate-950 shadow-sm">
                    <div className="flex items-start gap-3">
                      <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-rose-200/80 text-slate-950">
                        <MessageCircleWarning className="h-5 w-5" />
                      </div>
                      <div>
                        <h2 className="text-lg font-black">تعذر التحقق من الرابط</h2>
                        <p className="mt-1 text-sm leading-7 text-slate-700">{error}</p>
                      </div>
                    </div>
                    <div className="flex flex-col gap-3 sm:flex-row">
                      <a href={waUrl} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center gap-2 rounded-2xl bg-[#16a34a] px-4 py-3 text-sm font-black text-white transition hover:-translate-y-0.5">
                        <Phone className="h-4 w-4" />
                        تواصل عبر واتساب
                      </a>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="rounded-[1.35rem] border border-slate-200 bg-white p-4 shadow-sm">
                      <div className="overflow-hidden rounded-[1.25rem] border border-slate-200 bg-slate-50">
                        <div className="aspect-[4/3] bg-slate-50">
                          {primaryItem?.image_url ? (
                            <img src={primaryItem.image_url} alt={primaryItem.product_name} className="h-full w-full object-cover" loading="lazy" />
                          ) : (
                            <div className="flex h-full items-center justify-center text-slate-300">
                              <ImageIcon className="h-12 w-12" />
                            </div>
                          )}
                        </div>
                        <div className="space-y-3 p-4">
                          <h3 className="text-lg font-black leading-snug text-slate-950">{primaryItem?.product_name || "منتج"}</h3>
                          <div className="flex flex-wrap gap-2 text-xs font-bold text-slate-700">
                            {primaryItem?.color ? <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-3 py-1">اللون: {primaryItem.color}</span> : null}
                            {primaryItem?.size ? <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-3 py-1">المقاس: {primaryItem.size}</span> : null}
                            <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-3 py-1">الكمية: {primaryItem?.quantity || 1}</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                      <InfoCard title="العميل" icon={ShoppingBag}>
                        <div className="space-y-2">
                          <div className="text-sm font-black text-slate-950">{customerName || "—"}</div>
                          <div className="text-sm font-bold text-slate-700">{customerPhone || "—"}</div>
                        </div>
                      </InfoCard>

                      <InfoCard title="الطلب" icon={MapPin}>
                        <div className="space-y-2">
                          <div className="text-sm font-black text-slate-950">{formatMoney(totalAmount)}</div>
                          <div className="text-sm leading-7 text-slate-700">{customerAddress || "لا يوجد عنوان ظاهر لهذا الطلب"}</div>
                        </div>
                      </InfoCard>
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
                                className={["flex min-h-[88px] items-center gap-3 rounded-[1.35rem] border px-4 py-4 text-right transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60", meta.className].join(" ")}
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
                          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 shadow-sm">
                            جاري تنفيذ: {ACTION_META[pendingAction]?.label || "الإجراء"}...
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <div className="rounded-[1.35rem] border border-emerald-200 bg-emerald-50 p-4 text-slate-950 shadow-sm">
                        <div className="flex items-start gap-3">
                          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-emerald-200/80 text-slate-950">
                            <CheckCircle2 className="h-5 w-5" />
                          </div>
                          <div>
                            <h2 className="text-lg font-black">{actionMeta?.success || "تم تحديث الطلب"}</h2>
                            <p className="mt-1 text-sm leading-7 text-slate-700">{actionMeta?.hint || "تم تنفيذ الإجراء بنجاح."}</p>
                            {result?.already_applied ? <p className="mt-2 text-xs font-bold text-slate-700">تم تطبيق هذا الإجراء سابقًا بالفعل.</p> : null}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

export default OrderConfirmationActionPage;
