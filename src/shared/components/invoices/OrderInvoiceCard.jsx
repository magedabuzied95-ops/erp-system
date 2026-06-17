import { CalendarDays, CreditCard, Phone, ShoppingBag, Store, User } from "lucide-react";
import { useTranslation } from "react-i18next";

import { formatCurrency } from "../../lib/currency";
import { DEFAULT_PRODUCT_PLACEHOLDER, resolveInvoiceItemImageUrl } from "../../lib/invoiceItemImages";
import { useLocale } from "../../lib/locale";
import { normalizeOrderInvoiceData } from "../../utils/orderInvoice";
import { displayPublicOrderNumber } from "../../utils/publicOrderNumber";
import { SafeImage } from "../SafeRender";

const sourceLabels = {
  website: "Website",
  web: "Website",
  pos: "POS",
  whatsapp: "WhatsApp",
};

const safeLabel = (value, fallback) => (typeof value === "string" ? value : fallback);

const getStatusTone = (value = "") => {
  const normalized = String(value || "").toLowerCase().replace(/[_-]+/g, " ").trim();
  if (["paid", "completed", "complete", "confirmed", "approved", "shipping paid"].includes(normalized)) {
    return "emerald";
  }
  if (["cancelled", "canceled", "void", "failed", "refunded", "returned"].includes(normalized)) {
    return "red";
  }
  return "amber";
};

const luxuryStatusClasses = {
  emerald: "border-emerald-200 bg-emerald-50 text-emerald-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.75)] print:shadow-none",
  amber: "border-amber-200 bg-amber-50 text-amber-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.75)] print:shadow-none",
  red: "border-red-200 bg-red-50 text-red-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.75)] print:shadow-none",
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

export default function OrderInvoiceCard({ order, items, invoice, className = "", compact = false, luxury = false }) {
  const { t } = useTranslation();
  const { dir, isRtl, formatDate } = useLocale();
  const data = invoice || normalizeOrderInvoiceData(order, items, { source: "Website" }) || {};
  const invoiceItems = Array.isArray(data?.items) ? data.items.filter(Boolean) : [];
  const totals = data?.totals || {};
  const source = String(data?.source || "Website").toLowerCase();
  const paymentMethod = String(data?.paymentMethod || "").toLowerCase();
  const publicNumber = displayPublicOrderNumber(invoice || order || data) || data?.invoiceNumber || "-";
  const unavailable = t("storefront.invoice.unavailable");
  const shippingLabel = safeLabel(t("orders.drawer.shipping", { defaultValue: isRtl ? "الشحن" : "Shipping" }), isRtl ? "الشحن" : "Shipping");
  const textAlignClass = isRtl ? "text-right" : "text-left";
  const amountAlignClass = isRtl ? "text-left" : "text-right";
  const articleClass = luxury
    ? "overflow-hidden rounded-[2rem] border border-slate-200/80 bg-[#FAFAF9] text-slate-950 shadow-[0_34px_100px_rgba(0,0,0,0.36),0_2px_0_rgba(255,255,255,0.85)_inset] print:rounded-none print:border-slate-200 print:bg-white print:text-slate-950 print:shadow-none"
    : "overflow-hidden rounded-[1.75rem] border border-stone-200 bg-white text-stone-950 shadow-[0_18px_50px_rgba(39,20,75,0.07)]";

  return (
    <article dir={dir} className={`${articleClass} ${textAlignClass} ${className}`}>
      <div className={`${luxury ? "border-b border-slate-200/75 bg-[linear-gradient(135deg,#ffffff_0%,#f8fafc_54%,#f1f5f9_100%)] p-5 print:border-slate-200 print:bg-white sm:p-6" : "border-b border-stone-200 bg-stone-50/80 p-5"}`}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <div className={`grid h-16 w-16 shrink-0 place-items-center overflow-hidden border bg-white ${luxury ? "rounded-[1.35rem] border-slate-200 shadow-[0_14px_34px_rgba(15,23,42,0.08)] print:shadow-none" : "rounded-2xl border-stone-200"}`}>
              {data.store?.logoUrl ? (
                <SafeImage
                  src={data.store?.logoUrl}
                  alt={data.store?.name || "Store"}
                  className="h-full w-full object-contain p-2"
                  fallback={<Store className="h-7 w-7 text-stone-700" />}
                />
              ) : (
                <Store className="h-7 w-7 text-stone-700" />
              )}
            </div>
            <div>
              <div className={`${luxury ? "text-2xl font-black tracking-tight text-slate-950 sm:text-[1.7rem]" : "text-2xl font-black"}`}>{data?.store?.name || "MONE"}</div>
              <div className={`mt-1.5 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-black ${luxury ? "border-violet-200 bg-violet-50 text-violet-800" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>
                <ShoppingBag className="h-3.5 w-3.5" />
                {t("storefront.invoice.source")}: {sourceLabels[source] || data?.source || "Website"}
              </div>
            </div>
          </div>
          <div className={`${amountAlignClass} sm:min-w-52`}>
            <div className={`${luxury ? "text-[0.7rem] font-black uppercase tracking-[0.22em] text-slate-400 print:text-slate-500" : "text-sm font-black text-stone-500"}`}>{t("storefront.invoice.orderNumber")}</div>
            <div className={`mt-2 inline-flex items-center rounded-full border px-3 py-1 text-xs font-black tracking-wide ${luxury ? "border-violet-200 bg-violet-50 text-violet-900" : "border-[#7c3aed]/20 bg-[#7c3aed]/10 text-[#5b21b6]"}`} dir="ltr">
              Order {publicNumber}
            </div>
            <div className={`mt-2 flex items-center gap-1 text-sm font-bold ${luxury ? "text-slate-500" : "text-stone-500"} ${isRtl ? "justify-end" : "justify-start"}`}>
              <CalendarDays className="h-4 w-4" />
              {formatDate(data?.createdAt)}
            </div>
          </div>
        </div>
      </div>

      <div className={`${luxury ? "grid gap-3 p-5 sm:grid-cols-2 sm:p-6 lg:grid-cols-4" : "grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-4"}`}>
        <Meta luxury={luxury} icon={User} label={t("storefront.invoice.customer")} value={data?.customer?.name || t("storefront.invoice.walkInCustomer")} unavailable={unavailable} />
        <Meta luxury={luxury} icon={Phone} label={t("storefront.invoice.phone")} value={data?.customer?.phone || unavailable} unavailable={unavailable} />
        <Meta luxury={luxury} label={t("storefront.invoice.status")} value={data.status || "pending"} unavailable={unavailable} badge />
        <Meta luxury={luxury} icon={CreditCard} label={t("storefront.invoice.payment")} value={t(`storefront.invoice.paymentMethods.${paymentMethod}`, { defaultValue: data?.paymentMethod || unavailable })} unavailable={unavailable} />
      </div>

      <div className={`${luxury ? "px-5 pb-6 sm:px-6" : "px-5 pb-5"}`}>
        <div className={`overflow-hidden rounded-2xl border ${luxury ? "border-slate-200/90 bg-white/72 shadow-[0_18px_55px_rgba(15,23,42,0.08)] print:border-slate-200 print:bg-white print:shadow-none" : "border-stone-200"}`}>
          <div className={`grid grid-cols-[minmax(0,1.7fr)_0.7fr_0.75fr_0.8fr] px-4 py-3 text-xs font-black sm:grid-cols-[minmax(0,1.8fr)_0.8fr_0.75fr_0.8fr_0.9fr] ${luxury ? "bg-slate-100/80 uppercase tracking-[0.16em] text-slate-500 print:bg-slate-50" : "bg-stone-50 text-stone-500"}`}>
            <div>{t("storefront.invoice.product")}</div>
            <div className="hidden sm:block">{t("storefront.invoice.variant")}</div>
            <div className="text-center">{t("storefront.invoice.quantity")}</div>
            <div className={amountAlignClass}>{t("storefront.invoice.price")}</div>
            <div className={amountAlignClass}>{t("storefront.invoice.total")}</div>
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
                      <div className={`mt-1 truncate text-xs font-bold sm:hidden ${luxury ? "text-slate-500" : "text-stone-500"}`}>{[item?.color, item?.size].filter(Boolean).join(" / ") || t("storefront.invoice.notSpecified")}</div>
                      {item?.sku ? <div className={`mt-1 truncate text-[11px] font-bold ${luxury ? "text-slate-400" : "text-stone-400"}`}>SKU {item?.sku}</div> : null}
                    </div>
                  </div>
                  <div className={`hidden text-sm font-bold sm:block ${luxury ? "text-slate-500" : "text-stone-500"}`}>{[item?.color, item?.size].filter(Boolean).join(" / ") || t("storefront.invoice.notSpecified")}</div>
                  <div className="text-center font-black text-slate-900">{item?.quantity ?? 0}</div>
                  <div className={`${amountAlignClass} font-bold ${luxury ? "text-slate-700" : ""}`}>{formatCurrency(item?.unitPrice)}</div>
                  <div className={`${amountAlignClass} font-black text-emerald-700`}>{formatCurrency(item?.lineTotal)}</div>
                </div>
              );
            }) : (
              <div className={`px-4 py-8 text-center text-sm font-bold ${luxury ? "text-slate-500" : "text-stone-500"}`}>{t("storefront.invoice.empty")}</div>
            )}
          </div>
        </div>

        <div className={`mt-5 w-full max-w-sm rounded-2xl border p-4 ${luxury ? "border-slate-200/90 bg-slate-50/90 shadow-[0_16px_45px_rgba(15,23,42,0.08)] print:border-slate-200 print:bg-slate-50 print:shadow-none" : "border-stone-200 bg-stone-50"} ${isRtl ? "mr-auto" : "ml-auto"}`}>
          <Summary luxury={luxury} label={t("common.subtotal")} value={formatCurrency(totals?.subtotal)} />
          <Summary luxury={luxury} label={t("common.discount")} value={`- ${formatCurrency(totals?.discount)}`} />
          <Summary luxury={luxury} label={shippingLabel} value={formatCurrency(totals?.shipping)} />
          {totals?.exchangeMode ? (
            <>
              <Summary luxury={luxury} label="New items total" value={formatCurrency(totals?.newItemsTotal || totals?.grandTotal)} />
              <Summary luxury={luxury} label={`Exchange credit from invoice ${totals?.exchangeInvoiceNumber || ""}`} value={`- ${formatCurrency(totals?.exchangeCredit)}`} />
              <Summary luxury={luxury} label="Amount paid now" value={formatCurrency(totals?.amountPaidNow)} />
              {Number(totals?.remainingCustomerCredit || 0) > 0 ? <Summary luxury={luxury} label="Remaining customer credit / wallet balance" value={formatCurrency(totals?.remainingCustomerCredit)} /> : null}
            </>
          ) : null}
          <div className={`mt-3 flex items-center justify-between border-t pt-3 text-lg font-black ${luxury ? "border-slate-200 text-slate-950" : "border-stone-200"}`}>
            <span>{t("common.total")}</span>
            <span className={`${luxury ? "text-xl text-emerald-700" : "text-emerald-700"}`}>{formatCurrency(totals?.grandTotal)}</span>
          </div>
        </div>
      </div>
    </article>
  );
}

function Meta({ icon: Icon, label, value, unavailable, luxury = false, badge = false }) {
  const tone = getStatusTone(value);
  return (
    <div className={`rounded-2xl border px-4 py-3 ${luxury ? "border-slate-200/90 bg-white/70 shadow-[0_12px_32px_rgba(15,23,42,0.05)] print:bg-slate-50 print:shadow-none" : "border-stone-200 bg-stone-50"}`}>
      <div className={`flex items-center gap-2 text-xs font-black ${luxury ? "uppercase tracking-[0.14em] text-slate-400" : "text-stone-500"}`}>
        {Icon ? <Icon className="h-4 w-4" /> : null}
        {label}
      </div>
      {badge ? (
        <div className={`mt-2 inline-flex max-w-full items-center rounded-full border px-3 py-1 text-xs font-black ${luxury ? luxuryStatusClasses[tone] : "border-stone-200 bg-white text-stone-950"}`}>
          <span className="truncate">{value || unavailable}</span>
        </div>
      ) : (
        <div className={`mt-1 truncate font-black ${luxury ? "text-slate-950" : "text-stone-950"}`}>{value || unavailable}</div>
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
