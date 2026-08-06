import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, MapPin, PackageSearch, ShoppingBag, ShoppingCart, X } from "lucide-react";
import { api } from "../../../shared/api/api";
import { formatCurrency } from "../../../shared/lib/currency";
import ProductCardPicker from "./ProductCardPicker";

const list = (value) => Array.isArray(value) ? value : [];
const text = (value = "") => String(value || "").trim();
const idOf = (item = {}) => text(item.id || item.provider_city_id || item.provider_zone_id || item.provider_district_id);
const labelOf = (item = {}) => text(item.name_ar || item.name_en || item.name || item.city_name_ar || item.zone_name_ar || item.district_name_ar);
const imageOf = (item = {}) => text(item.image_url || item.image || item.thumbnail_url || item.product_image_url);

export default function PwaOrderComposer({ open, conversation = {}, busy = false, headers = {}, onClose, onSubmit }) {
  const profile = conversation.customer_profile || {};
  const [pickerOpen, setPickerOpen] = useState(false);
  const [product, setProduct] = useState(null);
  const [quantity, setQuantity] = useState(1);
  const [form, setForm] = useState({});
  const [locations, setLocations] = useState({ cities: [], zones: [], districts: [], loading: false });
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  useEffect(() => {
    if (!open) return;
    setProduct(null); setQuantity(1);
    setForm({
      customer_name: text(conversation.customer_name || profile.name || profile.display_name),
      customer_phone: text(profile.phone || conversation.customer_phone || conversation.channel_metadata?.resolved_phone),
      shipping_city_id: text(profile.shipping_city_id), shipping_zone_id: text(profile.shipping_zone_id),
      shipping_district_id: text(profile.shipping_district_id || profile.district_id),
      street_address: text(profile.street_address || profile.address || conversation.customer_address),
      building_number: text(profile.building_number), floor_number: text(profile.floor_number),
      apartment_number: text(profile.apartment_number), landmark: text(profile.landmark), notes: "",
    });
  }, [conversation.session_id, open]);

  useEffect(() => {
    if (!open) return;
    let active = true; setLocations((x) => ({ ...x, loading: true }));
    api.get("/shipping/cities?provider=bosta&dropoff=1", { headers, suppressErrorStatuses: [404, 500] })
      .then((data) => active && setLocations((x) => ({ ...x, cities: list(data?.cities) })))
      .catch(() => active && setLocations((x) => ({ ...x, cities: [] })))
      .finally(() => active && setLocations((x) => ({ ...x, loading: false })));
    return () => { active = false; };
  }, [headers, open]);

  useEffect(() => {
    if (!open || !form.shipping_city_id) { setLocations((x) => ({ ...x, zones: [], districts: [] })); return; }
    let active = true;
    api.get(`/shipping/zones?provider=bosta&dropoff=1&cityId=${encodeURIComponent(form.shipping_city_id)}`, { headers, suppressErrorStatuses: [404, 500] })
      .then((data) => active && setLocations((x) => ({ ...x, zones: list(data?.zones), districts: [] }))).catch(() => active && setLocations((x) => ({ ...x, zones: [], districts: [] })));
    return () => { active = false; };
  }, [form.shipping_city_id, headers, open]);

  useEffect(() => {
    if (!open || !form.shipping_zone_id) { setLocations((x) => ({ ...x, districts: [] })); return; }
    let active = true;
    api.get(`/shipping/districts?provider=bosta&dropoff=1&zoneId=${encodeURIComponent(form.shipping_zone_id)}`, { headers, suppressErrorStatuses: [404, 500] })
      .then((data) => active && setLocations((x) => ({ ...x, districts: list(data?.districts) }))).catch(() => active && setLocations((x) => ({ ...x, districts: [] })));
    return () => { active = false; };
  }, [form.shipping_zone_id, headers, open]);

  const city = useMemo(() => locations.cities.find((x) => idOf(x) === form.shipping_city_id), [form.shipping_city_id, locations.cities]);
  const zone = useMemo(() => locations.zones.find((x) => idOf(x) === form.shipping_zone_id), [form.shipping_zone_id, locations.zones]);
  const district = useMemo(() => locations.districts.find((x) => idOf(x) === form.shipping_district_id), [form.shipping_district_id, locations.districts]);
  const qty = Math.max(1, Number(quantity) || 1);
  const price = Number(product?.price || product?.final_price || 0) || 0;
  const ready = product && form.customer_name && form.customer_phone && form.shipping_city_id && form.shipping_zone_id && form.shipping_district_id && form.street_address && form.building_number && !busy;
  const input = "h-11 min-w-0 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none";
  if (!open || typeof document === "undefined") return null;

  return createPortal(<>
    <div className="ai-pwa-order-composer fixed inset-0 z-[200] flex items-end bg-slate-950/70 backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <section dir="rtl" className="ai-pwa-order-composer__panel max-h-[96dvh] w-full overflow-y-auto rounded-t-[30px] px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 shadow-2xl">
        <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-slate-200" />
        <header className="flex items-start justify-between gap-3 border-b border-slate-200 pb-4"><div><div className="text-[10px] font-black uppercase tracking-[.18em] text-emerald-600">AI Inbox Order</div><h2 className="mt-1 text-xl font-black text-slate-950">إنشاء طلب من المحادثة</h2><p className="mt-1 text-xs text-slate-500">اختَر المنتج وأكمل عنوان Bosta قبل حفظ المسودة.</p></div><button type="button" onClick={onClose} className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-slate-100" aria-label="إغلاق"><X className="h-5 w-5" /></button></header>
        <div className="mt-4 space-y-4">
          <section className="rounded-2xl border border-slate-200 bg-slate-50 p-3"><div className="mb-3 flex items-center gap-2 text-sm font-black text-slate-900"><ShoppingBag className="h-4 w-4 text-emerald-600" />المنتج والمخزون</div><button type="button" onClick={() => setPickerOpen(true)} className="flex min-h-20 w-full items-center gap-3 rounded-2xl border border-dashed border-slate-300 bg-white p-3 text-right">{product ? (imageOf(product) ? <img src={imageOf(product)} alt="" className="h-16 w-16 rounded-xl object-cover" /> : <span className="grid h-16 w-16 place-items-center rounded-xl bg-slate-100"><ShoppingBag /></span>) : <span className="grid h-16 w-16 place-items-center rounded-xl bg-slate-100"><PackageSearch /></span>}<span className="min-w-0 flex-1"><strong className="block truncate text-sm text-slate-900">{product?.product_name || product?.name || "ابحث واختر منتجًا"}</strong><span className="mt-1 block text-xs text-slate-500">{product ? [product.color, product.size, formatCurrency(price)].filter(Boolean).join(" • ") : "بالاسم أو SKU أو الباركود مع فلاتر الكتالوج"}</span></span><span className="rounded-full bg-emerald-100 px-3 py-2 text-xs font-black text-emerald-800">{product ? "تغيير" : "اختيار"}</span></button>{product ? <div className="mt-3 grid grid-cols-[1fr_auto] gap-2"><div className="rounded-xl bg-emerald-50 p-3 text-xs font-black text-emerald-800">الإجمالي: {formatCurrency(price * qty)}</div><input aria-label="الكمية" type="number" min="1" value={quantity} onChange={(e) => setQuantity(Math.max(1, Number(e.target.value) || 1))} className={`${input} w-20 text-center font-black`} /></div> : null}</section>
          <section className="rounded-2xl border border-slate-200 bg-slate-50 p-3"><div className="mb-3 text-sm font-black text-slate-900">بيانات العميل</div><div className="grid grid-cols-2 gap-2"><input value={form.customer_name || ""} onChange={(e) => set("customer_name", e.target.value)} placeholder="اسم العميل *" className={input} /><input value={form.customer_phone || ""} onChange={(e) => set("customer_phone", e.target.value)} placeholder="رقم الهاتف *" inputMode="tel" className={input} /></div></section>
          <section className="rounded-2xl border border-slate-200 bg-slate-50 p-3"><div className="mb-1 flex items-center gap-2 text-sm font-black text-slate-900"><MapPin className="h-4 w-4 text-rose-500" />عنوان شحن Bosta</div><p className="mb-3 text-[11px] text-slate-500">المدينة والمنطقة والحي من دليل Bosta لضمان قبول الشحنة.</p><div className="grid grid-cols-2 gap-2">
            <select value={form.shipping_city_id || ""} onChange={(e) => setForm((x) => ({ ...x, shipping_city_id: e.target.value, shipping_zone_id: "", shipping_district_id: "" }))} disabled={locations.loading} className={input}><option value="">{locations.loading ? "تحميل المدن..." : "مدينة Bosta *"}</option>{locations.cities.map((x) => <option key={idOf(x)} value={idOf(x)}>{labelOf(x)}</option>)}</select>
            <select value={form.shipping_zone_id || ""} onChange={(e) => setForm((x) => ({ ...x, shipping_zone_id: e.target.value, shipping_district_id: "" }))} disabled={!form.shipping_city_id} className={input}><option value="">المنطقة *</option>{locations.zones.map((x) => <option key={idOf(x)} value={idOf(x)}>{labelOf(x)}</option>)}</select>
            <select value={form.shipping_district_id || ""} onChange={(e) => set("shipping_district_id", e.target.value)} disabled={!form.shipping_zone_id} className={`${input} col-span-2`}><option value="">الحي *</option>{locations.districts.map((x) => <option key={idOf(x)} value={idOf(x)}>{labelOf(x)}</option>)}</select>
            <input value={form.street_address || ""} onChange={(e) => set("street_address", e.target.value)} placeholder="اسم الشارع والعنوان بالتفصيل *" className={`${input} col-span-2`} /><input value={form.building_number || ""} onChange={(e) => set("building_number", e.target.value)} placeholder="رقم المبنى *" className={input} /><input value={form.floor_number || ""} onChange={(e) => set("floor_number", e.target.value)} placeholder="الدور" className={input} /><input value={form.apartment_number || ""} onChange={(e) => set("apartment_number", e.target.value)} placeholder="الشقة" className={input} /><input value={form.landmark || ""} onChange={(e) => set("landmark", e.target.value)} placeholder="علامة مميزة" className={input} />
          </div></section>
          <textarea value={form.notes || ""} onChange={(e) => set("notes", e.target.value)} placeholder="ملاحظات الطلب أو التوصيل" className="min-h-20 w-full rounded-2xl border border-slate-200 bg-white p-3 text-sm" />
          <button type="button" disabled={!ready} onClick={() => onSubmit?.(product, { ...form, quantity: qty, size: product?.size || "", color: product?.color || "", variant_id: product?.variant_id || "", governorate: labelOf(city), city_area: labelOf(district) || labelOf(zone), district_id: form.shipping_district_id, customer_address: form.street_address, shipping_provider: "bosta" })} className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 text-sm font-black text-white disabled:opacity-40">{busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <ShoppingCart className="h-5 w-5" />}إنشاء مسودة الطلب</button>
        </div>
      </section>
    </div>
    <ProductCardPicker open={pickerOpen} mode="pos" onClose={() => setPickerOpen(false)} onSubmit={async (cards) => { setProduct(list(cards)[0] || null); setPickerOpen(false); }} />
  </>, document.body);
}
