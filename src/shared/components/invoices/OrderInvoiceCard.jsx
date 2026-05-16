import { CalendarDays, CreditCard, Package, Phone, ShoppingBag, Store, User } from "lucide-react";

import { formatCurrency } from "../../lib/currency";
import { resolveProductImageUrl } from "../../lib/imageUrls";
import { normalizeOrderInvoiceData } from "../../utils/orderInvoice";
import { SafeImage } from "../SafeRender";

const paymentLabels = {
  cod: "الدفع عند الاستلام",
  cash: "كاش",
  shipping_confirmation: "تأكيد الشحن",
  instapay: "Instapay",
  vodafone_cash: "Vodafone Cash",
};

const sourceLabels = {
  website: "Website",
  web: "Website",
  pos: "POS",
  whatsapp: "WhatsApp",
};

const formatDateTime = (value) => {
  if (!value) return "غير متاح";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("ar-EG", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
};

function InvoiceImage({ src, alt }) {
  const imageUrl = resolveProductImageUrl(src);
  if (!imageUrl) return <Package className="h-5 w-5 text-stone-400" />;
  return (
    <SafeImage
      src={imageUrl}
      alt={alt}
      className="h-full w-full object-contain p-1.5"
      loading="lazy"
      fallback={<Package className="h-5 w-5 text-stone-400" />}
    />
  );
}

export default function OrderInvoiceCard({ order, items, invoice, className = "", compact = false }) {
  const data = invoice || normalizeOrderInvoiceData(order, items, { source: "Website" }) || {};
  const invoiceItems = Array.isArray(data?.items) ? data.items.filter(Boolean) : [];
  const totals = data?.totals || {};
  const source = String(data?.source || "Website").toLowerCase();
  const paymentMethod = String(data?.paymentMethod || "").toLowerCase();

  return (
    <article dir="rtl" className={`overflow-hidden rounded-[1.75rem] border border-stone-200 bg-white text-right text-stone-950 shadow-[0_18px_50px_rgba(39,20,75,0.07)] ${className}`}>
      <div className="border-b border-stone-200 bg-stone-50/80 p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-2xl border border-stone-200 bg-white">
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
              <div className="text-2xl font-black">{data?.store?.name || "Tiger Store"}</div>
              <div className="mt-1 inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-700">
                <ShoppingBag className="h-3.5 w-3.5" />
                المصدر: {sourceLabels[source] || data?.source || "Website"}
              </div>
            </div>
          </div>
          <div className="text-left sm:min-w-52">
            <div className="text-sm font-black text-stone-500">رقم الفاتورة</div>
            <div className="mt-1 text-2xl font-black text-stone-950">{data?.invoiceNumber || "-"}</div>
            <div className="mt-2 flex items-center justify-end gap-1 text-sm font-bold text-stone-500">
              <CalendarDays className="h-4 w-4" />
              {formatDateTime(data?.createdAt)}
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-4">
        <Meta icon={User} label="العميل" value={data?.customer?.name} />
        <Meta icon={Phone} label="الموبايل" value={data?.customer?.phone || "غير متاح"} />
        <Meta label="الحالة" value={data.status || "pending"} />
        <Meta icon={CreditCard} label="الدفع" value={paymentLabels[paymentMethod] || data?.paymentMethod || "غير متاح"} />
      </div>

      <div className="px-5 pb-5">
        <div className="overflow-hidden rounded-2xl border border-stone-200">
          <div className="grid grid-cols-[minmax(0,1.7fr)_0.7fr_0.75fr_0.8fr] bg-stone-50 px-4 py-3 text-xs font-black text-stone-500 sm:grid-cols-[minmax(0,1.8fr)_0.8fr_0.75fr_0.8fr_0.9fr]">
            <div>المنتج</div>
            <div className="hidden sm:block">المقاس / اللون</div>
            <div className="text-center">الكمية</div>
            <div className="text-left">السعر</div>
            <div className="text-left">الإجمالي</div>
          </div>
          <div className="divide-y divide-stone-200">
            {invoiceItems.length ? invoiceItems.map((item, index) => (
              <div key={String(item?.id ?? index)} className="grid grid-cols-[minmax(0,1.7fr)_0.7fr_0.75fr_0.8fr] items-center gap-2 px-4 py-3 text-sm sm:grid-cols-[minmax(0,1.8fr)_0.8fr_0.75fr_0.8fr_0.9fr]">
                <div className="flex min-w-0 items-center gap-3">
                  {!compact ? (
                    <div className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-xl border border-stone-200 bg-white">
                      <InvoiceImage src={item?.imageUrl} alt={item?.name || ""} />
                    </div>
                  ) : null}
                  <div className="min-w-0">
                    <div className="truncate font-black">{item?.name || "-"}</div>
                    <div className="mt-1 truncate text-xs font-bold text-stone-500 sm:hidden">{[item?.color, item?.size].filter(Boolean).join(" / ") || "غير محدد"}</div>
                    {item?.sku ? <div className="mt-1 truncate text-[11px] font-bold text-stone-400">SKU {item?.sku}</div> : null}
                  </div>
                </div>
                <div className="hidden text-sm font-bold text-stone-500 sm:block">{[item?.color, item?.size].filter(Boolean).join(" / ") || "غير محدد"}</div>
                <div className="text-center font-black">{item?.quantity ?? 0}</div>
                <div className="text-left font-bold">{formatCurrency(item?.unitPrice)}</div>
                <div className="text-left font-black text-emerald-700">{formatCurrency(item?.lineTotal)}</div>
              </div>
            )) : (
              <div className="px-4 py-8 text-center text-sm font-bold text-stone-500">لا توجد منتجات في الفاتورة</div>
            )}
          </div>
        </div>

        <div className="mt-4 mr-auto w-full max-w-sm rounded-2xl border border-stone-200 bg-stone-50 p-4">
          <Summary label="المجموع الفرعي" value={formatCurrency(totals?.subtotal)} />
          <Summary label="الخصم" value={`- ${formatCurrency(totals?.discount)}`} />
          <Summary label="الشحن" value={formatCurrency(totals?.shipping)} />
          <div className="mt-3 flex items-center justify-between border-t border-stone-200 pt-3 text-lg font-black">
            <span>الإجمالي النهائي</span>
            <span className="text-emerald-700">{formatCurrency(totals?.grandTotal)}</span>
          </div>
        </div>
      </div>
    </article>
  );
}

function Meta({ icon: Icon, label, value }) {
  return (
    <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3">
      <div className="flex items-center gap-2 text-xs font-black text-stone-500">
        {Icon ? <Icon className="h-4 w-4" /> : null}
        {label}
      </div>
      <div className="mt-1 truncate font-black text-stone-950">{value || "غير متاح"}</div>
    </div>
  );
}

function Summary({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1 text-sm font-bold">
      <span className="text-stone-500">{label}</span>
      <span>{value}</span>
    </div>
  );
}
