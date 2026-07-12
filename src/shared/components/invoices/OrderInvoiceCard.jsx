import { CalendarDays, CreditCard, Phone, ShoppingBag, User } from "lucide-react";
import { useTranslation } from "react-i18next";

import { formatCurrency } from "../../lib/currency";
import { DEFAULT_PRODUCT_PLACEHOLDER, resolveInvoiceItemImageUrl } from "../../lib/invoiceItemImages";
import { useLocale } from "../../lib/locale";
import { getCurrentTenant } from "../../auth/authStorage";
import { normalizeOrderInvoiceData } from "../../utils/orderInvoice";
import { displayPublicOrderNumber } from "../../utils/publicOrderNumber";

const AR_INVOICE_COPY = {
  orderInvoice: "فاتورة طلب",
  orderNumber: "رقم الطلب",
  orderDate: "تاريخ الطلب",
  customer: "العميل",
  phone: "رقم الهاتف",
  status: "الحالة",
  paymentMethod: "طريقة الدفع",
  product: "المنتج",
  quantity: "الكمية",
  price: "السعر",
  total: "الإجمالي",
  subtotal: "الإجمالي الفرعي",
  discount: "الخصم",
  shipping: "الشحن",
  grandTotal: "الإجمالي الكلي",
  size: "المقاس",
  color: "اللون",
  notSpecified: "غير محدد",
  walkInCustomer: "عميلنا العزيز",
  empty: "لا توجد منتجات في هذه الفاتورة",
  confirmed: "مؤكد",
  pending: "قيد المراجعة",
  cancelled: "ملغي",
  returned: "مسترجع",
  rejected: "مرفوض",
  cash: "نقدًا",
  cod: "الدفع عند الاستلام",
  card: "بطاقة",
  wallet: "محفظة",
  split: "دفع متعدد",
  transfer: "تحويل",
  bankTransfer: "تحويل بنكي",
  newItemsTotal: "إجمالي المنتجات الجديدة",
  exchangeCredit: "رصيد الاستبدال من الفاتورة {{invoice}}",
  amountPaidNow: "المبلغ المدفوع الآن",
  remainingCredit: "الرصيد المتبقي للعميل",
};

const EN_INVOICE_COPY = {
  orderInvoice: "Order invoice",
  orderNumber: "Order number",
  orderDate: "Order date",
  customer: "Customer",
  phone: "Phone number",
  status: "Status",
  paymentMethod: "Payment method",
  product: "Product",
  quantity: "Quantity",
  price: "Price",
  total: "Total",
  subtotal: "Subtotal",
  discount: "Discount",
  shipping: "Shipping",
  grandTotal: "Grand total",
  size: "Size",
  color: "Color",
  notSpecified: "Not specified",
  walkInCustomer: "Walk-in customer",
  empty: "There are no products in this invoice",
  confirmed: "Confirmed",
  pending: "Under review",
  cancelled: "Cancelled",
  returned: "Returned",
  rejected: "Rejected",
  cash: "Cash",
  cod: "Cash on delivery",
  card: "Card",
  wallet: "Wallet",
  split: "Split payment",
  transfer: "Transfer",
  bankTransfer: "Bank transfer",
  newItemsTotal: "New items total",
  exchangeCredit: "Exchange credit from invoice {{invoice}}",
  amountPaidNow: "Amount paid now",
  remainingCredit: "Remaining customer credit",
};

const safeLabel = (value, fallback) => (typeof value === "string" ? value : fallback);

const getStoreInitials = (value = "") => {
  void value;
  return "M1";
};

const getStoreBranding = () => {
  const tenant = getCurrentTenant() || {};
  const settings = tenant.settings || {};
  return {
    name: String(
      settings["general.company_name"] ||
        settings["storefront.store_name"] ||
        "M1 Store"
    ).trim(),
    logoUrl: String(
      settings["general.company_logo_url"] ||
        settings["storefront.store_logo_url"] ||
        ""
    ).trim(),
  };
};

const getStatusLabel = (value = "", copy = EN_INVOICE_COPY) => {
  const normalized = String(value || "").trim().toLowerCase().replace(/[_-]+/g, " ");
  if (["confirmed", "approved", "completed", "complete", "paid", "shipping paid"].includes(normalized)) return copy.confirmed;
  if (["pending", "review", "under review", "pending confirmation", "awaiting verification"].includes(normalized)) return copy.pending;
  if (["cancelled", "canceled", "void"].includes(normalized)) return copy.cancelled;
  if (["returned", "refunded"].includes(normalized)) return copy.returned;
  if (["rejected", "failed"].includes(normalized)) return copy.rejected;
  return value || copy.pending;
};

const getStatusTone = (value = "") => {
  const normalized = String(value || "").toLowerCase().replace(/[_-]+/g, " ").trim();
  if (["paid", "completed", "complete", "confirmed", "approved", "shipping paid", "مؤكد", "مدفوع"].includes(normalized)) {
    return "emerald";
  }
  if (["cancelled", "canceled", "void", "failed", "refunded", "returned", "ملغي", "مرفوض", "مسترجع"].includes(normalized)) {
    return "red";
  }
  if (["pending", "review", "under review", "pending confirmation", "awaiting verification", "قيد المراجعة"].includes(normalized)) {
    return "amber";
  }
  return "amber";
};

const luxuryStatusClasses = {
  emerald: "border-emerald-200 bg-emerald-50 text-emerald-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.75)] print:shadow-none",
  amber: "border-amber-200 bg-amber-50 text-amber-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.75)] print:shadow-none",
  red: "border-red-200 bg-red-50 text-red-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.75)] print:shadow-none",
};

const getPaymentMethodLabel = (value = "", copy = EN_INVOICE_COPY) => {
  const normalized = String(value || "").toLowerCase().trim();
  const labels = {
    cash: copy.cash,
    cod: copy.cod,
    card: copy.card,
    visa: copy.card,
    wallet: copy.wallet,
    split: copy.split,
    transfer: copy.transfer,
    bank_transfer: copy.bankTransfer,
  };
  return labels[normalized] || (value || copy.notSpecified);
};

const formatVariantDetails = (item = {}, copy = EN_INVOICE_COPY) => {
  const parts = [];
  if (item?.color) parts.push(`${copy.color}: ${item.color}`);
  if (item?.size) parts.push(`${copy.size}: ${item.size}`);
  return parts.join(" • ") || copy.notSpecified;
};

function InvoiceImage({ src, alt }) {
  const imageUrl = src || DEFAULT_PRODUCT_PLACEHOLDER;
  return (
    <img
      src={imageUrl}
      alt={alt}
      className="h-full w-full object-cover"
      loading="lazy"
      onError={(e) => {
        if (e.currentTarget.src === DEFAULT_PRODUCT_PLACEHOLDER) return;
        e.currentTarget.src = DEFAULT_PRODUCT_PLACEHOLDER;
      }}
    />
  );
}

const logInvoiceRowImageDebug = (item, index, resolvedImageUrl) => {
  if (!import.meta.env.DEV) return;
  const rawItem = item?.rawItem || item || {};
  console.debug("[invoice row image debug]", {
    index,
    rawItem,
    product_id: rawItem.product_id ?? item?.product_id ?? item?.productId ?? null,
    variant_id: rawItem.variant_id ?? item?.variant_id ?? item?.variantId ?? null,
    image_url: rawItem.image_url ?? item?.image_url ?? item?.imageUrl ?? null,
    product_image: rawItem.product_image ?? item?.product_image ?? null,
    variant_image: rawItem.variant_image ?? item?.variant_image ?? null,
    product_image_url: rawItem.product?.image_url ?? item?.product?.image_url ?? null,
    variant_image_url: rawItem.variant?.image_url ?? item?.variant?.image_url ?? null,
    resolved_image_url: resolvedImageUrl || null,
  });
};

export default function OrderInvoiceCard({ order, items, invoice, className = "", compact = false, luxury = false, publicView = false }) {
  const { t } = useTranslation();
  const { dir, isRtl, formatDate } = useLocale();
  const copy = isRtl ? AR_INVOICE_COPY : EN_INVOICE_COPY;
  const storeBranding = getStoreBranding();
  const normalizedData = normalizeOrderInvoiceData(order || invoice || {}, items, {
    storeName: storeBranding.name,
    logoUrl: storeBranding.logoUrl,
  }) || {};
  const data = invoice
    ? {
        ...normalizedData,
        ...invoice,
        store: {
          ...normalizedData.store,
          ...(invoice.store || {}),
          name: String(invoice.store?.name || normalizedData.store?.name || storeBranding.name || "M1 Store").trim(),
          logoUrl: String(invoice.store?.logoUrl || normalizedData.store?.logoUrl || storeBranding.logoUrl || "").trim(),
        },
        status: invoice.status ?? normalizedData.status,
      }
    : normalizedData;
  const invoiceItems = Array.isArray(data?.items) ? data.items.filter(Boolean) : [];
  const totals = data?.totals || {};
  const paymentMethod = String(data?.paymentMethod || "").toLowerCase();
  const publicNumber = displayPublicOrderNumber(invoice || order || data) || data?.invoiceNumber || "-";
  const unavailable = safeLabel(t("storefront.invoice.unavailable", { defaultValue: copy.notSpecified }), copy.notSpecified);
  const shippingLabel = copy.shipping;
  const textAlignClass = isRtl ? "text-right" : "text-left";
  const amountAlignClass = isRtl ? "text-left" : "text-right";
  const articleClass = luxury
    ? "overflow-hidden rounded-[2rem] border border-amber-200/70 bg-[#fffdf8] text-slate-950 shadow-[0_34px_100px_rgba(0,0,0,0.36),0_2px_0_rgba(255,255,255,0.9)_inset] print:rounded-none print:border-slate-200 print:bg-white print:text-slate-950 print:shadow-none"
    : "overflow-hidden rounded-[1.75rem] border border-stone-200 bg-white text-stone-950 shadow-[0_18px_50px_rgba(39,20,75,0.07)]";
  const resolvedPaymentMethod = getPaymentMethodLabel(paymentMethod || data?.paymentMethod, copy);

  return (
    <article dir={dir} className={`${articleClass} ${textAlignClass} ${className}`}>
      <div className={`${luxury ? "border-b border-amber-200/75 bg-[linear-gradient(135deg,#fffdf7_0%,#ffffff_48%,#f8f1df_100%)] p-5 print:border-slate-200 print:bg-white sm:p-7" : "border-b border-stone-200 bg-stone-50/80 p-5"}`}>
        <div className={`flex flex-col gap-4 ${publicView ? "" : "sm:flex-row sm:items-start sm:justify-between"}`}>
          {publicView ? (
            <>
              <div className="flex flex-col items-center text-center sm:flex-row sm:items-center sm:gap-5 sm:text-start">
                {data.store?.logoUrl ? (
                  <div className={`grid h-20 w-20 place-items-center overflow-hidden border bg-white ${luxury ? "rounded-[1.5rem] border-slate-200 shadow-[0_14px_34px_rgba(15,23,42,0.08)] print:shadow-none" : "rounded-2xl border-stone-200"}`}>
                    <img
                      src={data.store?.logoUrl}
                      alt={data.store?.name || "M1 Store"}
                      className="h-full w-full object-contain p-2"
                      onError={(event) => {
                        event.currentTarget.style.display = "none";
                      }}
                    />
                  </div>
                ) : null}
                <div>
                  <div className={`mt-3 sm:mt-0 ${luxury ? "text-2xl font-black tracking-tight text-slate-950 sm:text-[1.8rem]" : "text-2xl font-black"}`}>{data?.store?.name || storeBranding.name || "M1 Store"}</div>
                  <div className={`mt-1.5 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-black ${luxury ? "border-amber-300/70 bg-amber-100/70 text-amber-900" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>
                    <ShoppingBag className="h-3.5 w-3.5" />
                    {copy.orderInvoice}
                  </div>
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <div className={`flex flex-wrap items-center justify-between gap-3 ${luxury ? "text-slate-500" : "text-stone-500"}`}>
                  <div className="text-sm font-bold">
                    {copy.orderDate}: {formatDate(data?.createdAt)}
                  </div>
                  <div className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-black tracking-wide ${luxury ? "border-slate-300 bg-slate-900 text-white" : "border-[#7c3aed]/20 bg-[#7c3aed]/10 text-[#5b21b6]"}`} dir="ltr">
                    {publicNumber}
                  </div>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="flex items-start gap-3">
                {data.store?.logoUrl ? (
                  <div className={`grid h-16 w-16 shrink-0 place-items-center overflow-hidden border bg-white ${luxury ? "rounded-[1.35rem] border-slate-200 shadow-[0_14px_34px_rgba(15,23,42,0.08)] print:shadow-none" : "rounded-2xl border-stone-200"}`}>
                    <img
                      src={data.store?.logoUrl}
                      alt={data.store?.name || "M1 Store"}
                      className="h-full w-full object-contain p-2"
                      onError={(event) => {
                        event.currentTarget.style.display = "none";
                      }}
                    />
                  </div>
                ) : null}
                <div>
                  <div className={`${luxury ? "text-2xl font-black tracking-tight text-slate-950 sm:text-[1.7rem]" : "text-2xl font-black"}`}>{data?.store?.name || storeBranding.name || "M1 Store"}</div>
                  <div className={`mt-1.5 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-black ${luxury ? "border-violet-200 bg-violet-50 text-violet-800" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>
                    <ShoppingBag className="h-3.5 w-3.5" />
                    {copy.orderInvoice}
                  </div>
                </div>
              </div>
              <div className={`${amountAlignClass} sm:min-w-52`}>
                <div className={`${luxury ? "text-[0.7rem] font-black tracking-[0.22em] text-slate-400 print:text-slate-500" : "text-sm font-black text-stone-500"}`}>{copy.orderNumber}</div>
                <div className={`mt-2 inline-flex items-center rounded-full border px-3 py-1 text-xs font-black tracking-wide ${luxury ? "border-violet-200 bg-violet-50 text-violet-900" : "border-[#7c3aed]/20 bg-[#7c3aed]/10 text-[#5b21b6]"}`} dir="ltr">
                  {publicNumber}
                </div>
                <div className={`mt-2 flex items-center gap-1 text-sm font-bold ${luxury ? "text-slate-500" : "text-stone-500"} ${isRtl ? "justify-end" : "justify-start"}`}>
                  <CalendarDays className="h-4 w-4" />
                  {copy.orderDate}: {formatDate(data?.createdAt)}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <div className={`${luxury ? `grid gap-3 p-5 sm:p-6 ${publicView ? "sm:grid-cols-2 lg:grid-cols-2" : "sm:grid-cols-2 lg:grid-cols-4"}` : `grid gap-3 p-5 ${publicView ? "sm:grid-cols-2 lg:grid-cols-2" : "sm:grid-cols-2 lg:grid-cols-4"}`}`}>
        <Meta luxury={luxury} icon={User} label={copy.customer} value={data?.customer?.name || copy.walkInCustomer} unavailable={unavailable} inline={publicView} />
        <Meta luxury={luxury} icon={Phone} label={copy.phone} value={data?.customer?.phone || unavailable} unavailable={unavailable} inline={publicView} />
        {!publicView ? <Meta luxury={luxury} label={copy.status} value={getStatusLabel(data.status || "pending", copy)} unavailable={unavailable} badge /> : null}
        {!publicView ? <Meta luxury={luxury} icon={CreditCard} label={copy.paymentMethod} value={resolvedPaymentMethod} unavailable={unavailable} /> : null}
      </div>

      <div className={`${luxury ? "px-5 pb-6 sm:px-6" : "px-5 pb-5"}`}>
        <div className={`overflow-hidden rounded-2xl border ${luxury ? "border-slate-200/90 bg-white/72 shadow-[0_18px_55px_rgba(15,23,42,0.08)] print:border-slate-200 print:bg-white print:shadow-none" : "border-stone-200"}`}>
          <div className={`grid grid-cols-[minmax(0,1.7fr)_0.7fr_0.75fr_0.8fr] px-4 py-3 text-xs font-black sm:grid-cols-[minmax(0,1.8fr)_0.8fr_0.75fr_0.8fr_0.9fr] ${luxury ? "bg-slate-100/80 tracking-[0.08em] text-slate-500 print:bg-slate-50" : "bg-stone-50 text-stone-500"}`}>
            <div>{copy.product}</div>
            <div className="hidden sm:block">{`${copy.color} / ${copy.size}`}</div>
            <div className="text-center">{copy.quantity}</div>
            <div className={amountAlignClass}>{copy.price}</div>
            <div className={amountAlignClass}>{copy.total}</div>
          </div>
          <div className={`${luxury ? "divide-y divide-slate-200/80" : "divide-y divide-stone-200"}`}>
            {invoiceItems.length ? invoiceItems.map((item, index) => {
              const rawItem = item?.rawItem || item;
              const resolvedImageUrl = resolveInvoiceItemImageUrl(rawItem, "") || resolveInvoiceItemImageUrl(item, "");
              logInvoiceRowImageDebug(item, index, resolvedImageUrl);
              return (
                <div key={String(item?.id ?? index)} className={`grid grid-cols-[minmax(0,1.7fr)_0.7fr_0.75fr_0.8fr] items-center gap-2 px-4 text-sm sm:grid-cols-[minmax(0,1.8fr)_0.8fr_0.75fr_0.8fr_0.9fr] ${luxury ? "bg-white/55 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] print:bg-white print:shadow-none" : "py-3"}`}>
                  <div className="flex min-w-0 items-center gap-3">
                    {!compact ? (
                      <div className={`grid shrink-0 place-items-center overflow-hidden border ${luxury ? "h-16 w-16 rounded-xl border-slate-200 bg-slate-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] print:shadow-none" : "h-14 w-14 rounded-xl border-stone-200 bg-stone-100"}`}>
                        <InvoiceImage src={resolvedImageUrl} alt={item?.name || ""} />
                      </div>
                    ) : null}
                    <div className="min-w-0">
                      <div className={`truncate ${luxury ? "font-black tracking-tight text-slate-950" : "font-black"}`}>{item?.name || "-"}</div>
                      <div className={`mt-1 truncate text-xs font-bold sm:hidden ${luxury ? "text-slate-500" : "text-stone-500"}`}>{formatVariantDetails(item, copy)}</div>
                      {item?.sku ? <div className={`mt-1 truncate text-[11px] font-bold ${luxury ? "text-slate-400" : "text-stone-400"}`}>SKU {item?.sku}</div> : null}
                    </div>
                  </div>
                  <div className={`hidden text-sm font-bold sm:block ${luxury ? "text-slate-500" : "text-stone-500"}`}>{formatVariantDetails(item, copy)}</div>
                  <div className="text-center font-black text-slate-900">{item?.quantity ?? 0}</div>
                  <div className={`${amountAlignClass} font-bold ${luxury ? "text-slate-700" : ""}`}>{formatCurrency(item?.unitPrice)}</div>
                  <div className={`${amountAlignClass} font-black text-emerald-700`}>{formatCurrency(item?.lineTotal)}</div>
                </div>
              );
            }) : (
              <div className={`px-4 py-8 text-center text-sm font-bold ${luxury ? "text-slate-500" : "text-stone-500"}`}>{copy.empty}</div>
            )}
          </div>
        </div>

        <div className={`mt-5 w-full max-w-sm rounded-2xl border p-4 ${luxury ? "border-slate-200/90 bg-slate-50/90 shadow-[0_16px_45px_rgba(15,23,42,0.08)] print:border-slate-200 print:bg-slate-50 print:shadow-none" : "border-stone-200 bg-stone-50"} ${isRtl ? "mr-auto" : "ml-auto"}`}>
          <Summary luxury={luxury} label={copy.subtotal} value={formatCurrency(totals?.subtotal)} />
          <Summary luxury={luxury} label={copy.discount} value={`- ${formatCurrency(totals?.discount)}`} />
          <Summary luxury={luxury} label={shippingLabel} value={formatCurrency(totals?.shipping)} />
          {totals?.exchangeMode ? (
            <>
              <Summary luxury={luxury} label={copy.newItemsTotal} value={formatCurrency(totals?.newItemsTotal || totals?.grandTotal)} />
              <Summary luxury={luxury} label={copy.exchangeCredit.replace("{{invoice}}", totals?.exchangeInvoiceNumber || "").trim()} value={`- ${formatCurrency(totals?.exchangeCredit)}`} />
              <Summary luxury={luxury} label={copy.amountPaidNow} value={formatCurrency(totals?.amountPaidNow)} />
              {Number(totals?.remainingCustomerCredit || 0) > 0 ? <Summary luxury={luxury} label={copy.remainingCredit} value={formatCurrency(totals?.remainingCustomerCredit)} /> : null}
            </>
          ) : null}
          <div className={`mt-3 flex items-center justify-between border-t pt-3 text-lg font-black ${luxury ? "border-slate-200 text-slate-950" : "border-stone-200"}`}>
            <span>{copy.grandTotal}</span>
            <span className={`${luxury ? "text-xl text-emerald-700" : "text-emerald-700"}`}>{formatCurrency(totals?.grandTotal)}</span>
          </div>
          {publicView ? (
            <div className={`mt-3 border-t pt-3 text-sm font-black ${luxury ? "border-slate-200 text-slate-950" : "border-stone-200"}`}>
              {copy.paymentMethod}: {resolvedPaymentMethod || unavailable}
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function Meta({ icon: Icon, label, value, unavailable, luxury = false, badge = false, inline = false }) {
  const tone = getStatusTone(value);
  return (
    <div className={`rounded-2xl border px-4 py-3 ${luxury ? "border-slate-200/90 bg-white/70 shadow-[0_12px_32px_rgba(15,23,42,0.05)] print:bg-slate-50 print:shadow-none" : "border-stone-200 bg-stone-50"}`}>
      {!inline ? (
        <div className={`flex items-center gap-2 text-xs font-black ${luxury ? "uppercase tracking-[0.14em] text-slate-400" : "text-stone-500"}`}>
          {Icon ? <Icon className="h-4 w-4" /> : null}
          {label}
        </div>
      ) : null}
      {badge ? (
        <div className={`mt-2 inline-flex max-w-full items-center rounded-full border px-3 py-1 text-xs font-black ${luxury ? luxuryStatusClasses[tone] : "border-stone-200 bg-white text-stone-950"}`}>
          <span className="truncate">{value || unavailable}</span>
        </div>
      ) : (
        <div className={`${inline ? "truncate" : "mt-1 truncate"} font-black ${luxury ? "text-slate-950" : "text-stone-950"}`}>
          {inline ? `${label}: ${value || unavailable}` : (value || unavailable)}
        </div>
      )}
    </div>
  );
}

function Summary({ label, value, luxury = false }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1 text-sm font-bold">
      <span className={luxury ? "text-slate-500" : "text-stone-500"}>{label}</span>
      <span className={luxury ? "text-slate-900" : ""}>{value}</span>
    </div>
  );
}
