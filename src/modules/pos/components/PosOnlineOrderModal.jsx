import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { CheckCircle2, Loader2, MessageCircle, Truck, X } from "lucide-react";

import { api } from "../../../shared/api/api";
import {
  bostaCityPatch,
  bostaDistrictPatch,
  bostaZonePatch,
  buildBostaPickerOptions,
  normalizeShippingQuote,
} from "../../../shared/lib/shippingCheckout";
import ThemedSelect from "../../../shared/ui/ThemedSelect";
import { formatCurrency } from "../lib/posUtils";

const text = (value = "") => String(value ?? "").trim();
const EGYPT_MOBILE = /^01[0125][0-9]{8}$/;

const EMPTY_FORM = {
  full_name: "",
  primary_phone: "",
  email: "",
  governorate: "",
  governorate_id: "",
  city: "",
  city_id: "",
  city_area: "",
  area: "",
  area_id: "",
  district: "",
  district_id: "",
  zone: "",
  zone_id: "",
  shipping_city_id: "",
  shipping_zone_id: "",
  shipping_district_id: "",
  detailed_address: "",
  street_address: "",
  building_number: "",
  floor_number: "",
  apartment_number: "",
  landmark: "",
  delivery_notes: "",
  order_notes: "",
};

// Mirrors the line the website builds for the courier, so a Bosta label printed from a POS
// order reads exactly like one printed from a web order.
const composeAddressLine = (form) => [
  form.street_address || form.detailed_address,
  form.building_number ? `Building ${form.building_number}` : "",
  form.floor_number ? `Floor ${form.floor_number}` : "",
  form.apartment_number ? `Apartment ${form.apartment_number}` : "",
  form.landmark ? `Near ${form.landmark}` : "",
].filter(Boolean).join(", ");

const customerPhoneOf = (customer = {}) =>
  text(customer?.phone || customer?.mobile || customer?.whatsapp || "");

function Field({ label, value, onChange, error = "", required = false, placeholder = "", type = "text", dir, multiline = false }) {
  const className = `w-full rounded-xl border bg-[var(--surface-soft)] px-3 text-sm text-[var(--text)] outline-none transition focus:border-[var(--primary)] ${
    error ? "border-rose-400/60" : "border-[var(--border)]"
  } ${multiline ? "py-2" : "h-11"}`;
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-[11px] font-black text-[var(--muted)]">
        {label}
        {required ? <span className="text-rose-300"> *</span> : null}
      </span>
      {multiline ? (
        <textarea rows={2} dir={dir} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} className={className} />
      ) : (
        <input type={type} dir={dir} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} className={className} />
      )}
      {error ? <span className="mt-1 block text-[11px] font-bold text-rose-300">{error}</span> : null}
    </label>
  );
}

function Picker({ label, value, onChange, options, error = "", disabled = false, loading = false, placeholder }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-[11px] font-black text-[var(--muted)]">
        {label}
        <span className="text-rose-300"> *</span>
      </span>
      <div className="relative">
        <ThemedSelect
          value={value}
          disabled={disabled || loading}
          onChange={onChange}
          ariaLabel={label}
          placeholder={placeholder}
          options={options.map((option) => ({ value: option.id || option.value, label: option.label }))}
          triggerClassName={`h-11 w-full rounded-xl border bg-[var(--surface-soft)] px-3 text-sm text-[var(--text)] outline-none transition focus:border-[var(--primary)] disabled:opacity-50 ${
            error ? "border-rose-400/60" : "border-[var(--border)]"
          }`}
        />
        {loading ? <Loader2 className="pointer-events-none absolute inset-y-0 end-8 my-auto h-4 w-4 animate-spin text-[var(--muted)]" /> : null}
      </div>
      {error ? <span className="mt-1 block text-[11px] font-bold text-rose-300">{error}</span> : null}
    </label>
  );
}

/**
 * POS online-invoice checkout. The cart is the POS cart, but everything past it — the address,
 * the shipping quote, the order itself — is the website's: the modal posts to /pos/online-order,
 * which runs the same controller as the storefront checkout. That is what makes the order come
 * out as `pending_confirmation` with a WhatsApp confirmation on its way, exactly like the site.
 */
export default function PosOnlineOrderModal({
  open = false,
  onClose = null,
  items = [],
  posSubtotal = 0,
  customer = null,
  branchId = null,
  sellerUserId = null,
  salesEmployeeId = null,
  sellerName = "",
  onCreated = null,
}) {
  const { t, i18n } = useTranslation();
  const [form, setForm] = useState(EMPTY_FORM);
  const [errors, setErrors] = useState({});
  const [bosta, setBosta] = useState({ cities: [], zones: [], districts: [], loadingCities: false, loadingZones: false, loadingDistricts: false });
  const [quote, setQuote] = useState(normalizeShippingQuote());
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [created, setCreated] = useState(null);
  const submittingRef = useRef(false);

  const posLabel = useCallback((key, fallback) => {
    const value = t(`pos.onlineOrder.${key}`);
    return value === `pos.onlineOrder.${key}` ? fallback : value;
  }, [t]);

  const setField = useCallback((name, value) => {
    setForm((prev) => ({ ...prev, [name]: value }));
    setErrors((prev) => (prev[name] ? { ...prev, [name]: "" } : prev));
  }, []);

  // Re-seed from the POS customer selection every time the modal opens; a stale draft from a
  // previous sale must never ride along into the next customer's order.
  useEffect(() => {
    if (!open) return;
    setForm({
      ...EMPTY_FORM,
      full_name: text(customer?.name || customer?.customer_name || ""),
      primary_phone: customerPhoneOf(customer).replace(/\s/g, ""),
      email: text(customer?.email || ""),
    });
    setErrors({});
    setQuote(normalizeShippingQuote());
    setSubmitError("");
    setCreated(null);
    setSubmitting(false);
    submittingRef.current = false;
  }, [open, customer]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === "Escape" && !submittingRef.current) onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    setBosta((prev) => ({ ...prev, loadingCities: true }));
    api
      .get("/shipping/cities?provider=bosta&dropoff=1", { suppressErrorStatuses: [404, 500] })
      .then((data) => {
        if (cancelled) return;
        setBosta((prev) => ({ ...prev, cities: Array.isArray(data?.cities) ? data.cities : [], loadingCities: false }));
      })
      .catch(() => {
        if (!cancelled) setBosta((prev) => ({ ...prev, cities: [], loadingCities: false }));
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open || !form.shipping_city_id) {
      setBosta((prev) => ({ ...prev, zones: [], districts: [], loadingZones: false, loadingDistricts: false }));
      return undefined;
    }
    let cancelled = false;
    setBosta((prev) => ({ ...prev, zones: [], districts: [], loadingZones: true, loadingDistricts: false }));
    api
      .get(`/shipping/zones?provider=bosta&dropoff=1&cityId=${encodeURIComponent(form.shipping_city_id)}`, { suppressErrorStatuses: [404, 500] })
      .then((data) => {
        if (cancelled) return;
        setBosta((prev) => ({ ...prev, zones: Array.isArray(data?.zones) ? data.zones : [], districts: [], loadingZones: false }));
      })
      .catch(() => {
        if (!cancelled) setBosta((prev) => ({ ...prev, zones: [], districts: [], loadingZones: false }));
      });
    return () => {
      cancelled = true;
    };
  }, [open, form.shipping_city_id]);

  useEffect(() => {
    if (!open || !form.shipping_zone_id) {
      setBosta((prev) => ({ ...prev, districts: [], loadingDistricts: false }));
      return undefined;
    }
    let cancelled = false;
    setBosta((prev) => ({ ...prev, districts: [], loadingDistricts: true }));
    api
      .get(`/shipping/districts?provider=bosta&dropoff=1&zoneId=${encodeURIComponent(form.shipping_zone_id)}`, { suppressErrorStatuses: [404, 500] })
      .then((data) => {
        if (cancelled) return;
        setBosta((prev) => ({ ...prev, districts: Array.isArray(data?.districts) ? data.districts : [], loadingDistricts: false }));
      })
      .catch(() => {
        if (!cancelled) setBosta((prev) => ({ ...prev, districts: [], loadingDistricts: false }));
      });
    return () => {
      cancelled = true;
    };
  }, [open, form.shipping_zone_id]);

  const bostaMode = bosta.loadingCities || bosta.cities.length > 0;
  const cityOptions = useMemo(() => buildBostaPickerOptions(bosta.cities, "city", i18n.language), [bosta.cities, i18n.language]);
  const zoneOptions = useMemo(() => buildBostaPickerOptions(bosta.zones, "zone", i18n.language), [bosta.zones, i18n.language]);
  const districtOptions = useMemo(() => buildBostaPickerOptions(bosta.districts, "district", i18n.language), [bosta.districts, i18n.language]);

  // The shipping price is only ever advisory here — the server recomputes it from the same
  // quote endpoint at checkout — but the cashier has to be able to read it to the customer.
  useEffect(() => {
    if (!open || created) return undefined;
    if (!text(form.governorate) && !text(form.city_area)) {
      setQuote(normalizeShippingQuote());
      return undefined;
    }
    let cancelled = false;
    setQuote((prev) => ({ ...prev, loading: true }));
    const params = new URLSearchParams({
      governorate: form.governorate,
      city: form.city || form.city_area || "",
      area: form.area || form.city_area || "",
      governorate_id: form.governorate_id || "",
      city_id: form.city_id || "",
      area_id: form.area_id || "",
      district_id: form.district_id || "",
      zone_id: form.zone_id || "",
      subtotal: String(posSubtotal || 0),
    });
    api
      .get(`/storefront/shipping/quote?${params.toString()}`, { suppressErrorStatuses: [404, 500] })
      .then((data) => {
        if (!cancelled) setQuote(normalizeShippingQuote(data?.quote || data));
      })
      .catch(() => {
        if (!cancelled) setQuote((prev) => ({ ...prev, loading: false }));
      });
    return () => {
      cancelled = true;
    };
  }, [open, created, form.governorate, form.city, form.city_area, form.area, form.governorate_id, form.city_id, form.area_id, form.district_id, form.zone_id, posSubtotal]);

  const validate = useCallback(() => {
    const next = {};
    const phone = form.primary_phone.replace(/\s/g, "");
    if (!text(form.full_name)) next.full_name = posLabel("errors.nameRequired", "اسم العميل مطلوب");
    if (!phone) next.primary_phone = posLabel("errors.phoneRequired", "رقم الموبايل مطلوب");
    // The WhatsApp confirmation is the whole point of this mode, and it can only reach an
    // Egyptian mobile — so a number that cannot receive it is refused here, not silently sent.
    else if (!EGYPT_MOBILE.test(phone)) next.primary_phone = posLabel("errors.phoneInvalid", "رقم موبايل مصري غير صحيح");
    if (bostaMode) {
      if (!form.shipping_city_id) next.shipping_city_id = posLabel("errors.cityRequired", "اختر المدينة");
      if (!form.shipping_zone_id) next.shipping_zone_id = posLabel("errors.zoneRequired", "اختر المنطقة");
      if (!form.shipping_district_id) next.shipping_district_id = posLabel("errors.districtRequired", "اختر الحي");
      if (!text(form.street_address)) next.street_address = posLabel("errors.streetRequired", "اسم الشارع مطلوب");
      if (!text(form.building_number)) next.building_number = posLabel("errors.buildingRequired", "رقم العقار مطلوب");
    } else {
      if (!text(form.governorate)) next.governorate = posLabel("errors.governorateRequired", "المحافظة مطلوبة");
      if (!text(form.city_area)) next.city_area = posLabel("errors.cityRequired", "اختر المدينة");
    }
    if (!text(form.detailed_address)) next.detailed_address = posLabel("errors.addressRequired", "العنوان بالتفصيل مطلوب");
    else if (bostaMode && composeAddressLine(form).trim().length < 12) next.detailed_address = posLabel("errors.addressTooShort", "العنوان مختصر جدًا للشحن");
    setErrors(next);
    return Object.keys(next).length === 0;
  }, [bostaMode, form, posLabel]);

  const handleSubmit = useCallback(async () => {
    if (submittingRef.current) return;
    if (!items.length) {
      setSubmitError(posLabel("errors.emptyCart", "السلة فارغة"));
      return;
    }
    if (!validate()) return;
    submittingRef.current = true;
    setSubmitting(true);
    setSubmitError("");
    try {
      const phone = form.primary_phone.replace(/\s/g, "");
      const provider = bostaMode && form.shipping_city_id ? "bosta" : (quote.provider_id || quote.provider || "in_store_delivery");
      const shippingAddress = {
        country: "EG",
        country_code: "EG",
        governorate_id: form.governorate_id,
        governorate: form.governorate,
        city_id: form.city_id,
        city: form.city || form.city_area,
        area_id: form.area_id,
        district_id: form.district_id || quote.district_id || "",
        zone_id: form.zone_id || quote.zone_id || "",
        shipping_city_id: form.shipping_city_id,
        shipping_zone_id: form.shipping_zone_id,
        shipping_district_id: form.shipping_district_id,
        area: form.area || form.city_area,
        street_address: form.street_address || form.detailed_address,
        building_number: form.building_number,
        floor_number: form.floor_number,
        apartment_number: form.apartment_number,
        landmark: form.landmark,
        notes: form.delivery_notes,
      };
      const checkout = {
        ...form,
        primary_phone: phone,
        // Phase 1 is cash on delivery only. It is also what opens the WhatsApp confirmation
        // gate on the server, so changing it here silently turns the message off.
        payment_method: "cod",
        payment_type: "cod",
        paid_amount: 0,
        shipping_provider: provider,
        shipping_provider_id: provider,
        shipping_address: shippingAddress,
        shipping_provider_address: shippingAddress,
        customer_id: customer?.id || customer?.customer_id || null,
        branch_id: branchId || null,
        seller_user_id: sellerUserId || null,
        sales_employee_id: salesEmployeeId || null,
        seller_name: sellerName || "",
      };
      const data = await api.post(
        "/pos/online-order",
        { checkout, items, delivery_fee: quote.price, discount: 0 },
        { timeoutMs: 45000 }
      );
      const order = data?.order || {};
      setCreated({
        order,
        orderNumber: text(order.public_order_number || order.display_order_number || order.invoice_number || order.id),
        total: Number(order.total_amount ?? order.total ?? 0),
        deliveryFee: Number(order.delivery_fee ?? order.shipping_fee ?? quote.price ?? 0),
        // Snapshot, not a live read: the POS clears the cart the moment the order lands, which
        // would otherwise drop the estimate to zero and make every order look repriced.
        estimated: Number(posSubtotal || 0) + Number(quote.price || 0),
        phone,
      });
      onCreated?.({ order, items });
    } catch (error) {
      const body = error?.responseBody || {};
      setSubmitError(text(body.message) || text(error?.message) || posLabel("errors.failed", "تعذر إنشاء الأوردر"));
      if (body.field) setErrors((prev) => ({ ...prev, [body.field]: text(body.message) }));
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }, [bostaMode, branchId, customer, form, items, onCreated, posLabel, posSubtotal, quote, salesEmployeeId, sellerName, sellerUserId, validate]);

  if (!open || typeof document === "undefined") return null;

  const estimatedTotal = Number(posSubtotal || 0) + Number(quote.price || 0);
  // The POS is often run fullscreen; a body-mounted portal would render behind the fullscreen
  // element and simply not be visible.
  const portalTarget = document.fullscreenElement || document.body;

  return createPortal(
    <div
      className="fixed inset-0 z-[95] flex items-center justify-center bg-black/65 p-3 backdrop-blur-[2px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !submitting) onClose?.();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={posLabel("title", "أوردر أونلاين")}
        dir="rtl"
        className="flex max-h-[94vh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-[var(--border)] bg-[var(--surface-soft)] text-[var(--text)] shadow-[0_30px_80px_rgba(0,0,0,0.5)]"
      >
        <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="grid h-9 w-9 place-items-center rounded-xl border border-sky-400/40 bg-sky-400/10 text-sky-300">
              <Truck className="h-4 w-4" />
            </span>
            <div>
              <div className="text-sm font-black">{posLabel("title", "أوردر أونلاين")}</div>
              <div className="text-[10px] text-[var(--muted)]">{posLabel("subtitle", "نفس مسار الموقع: عنوان كامل + شحن + رسالة تأكيد واتساب")}</div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onClose?.()}
            disabled={submitting}
            aria-label={posLabel("close", "إغلاق")}
            className="grid h-8 w-8 place-items-center rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)] disabled:opacity-40"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {created ? (
          <div className="min-h-0 flex-1 overflow-y-auto p-6">
            <div className="mx-auto max-w-md text-center">
              <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl border border-emerald-400/40 bg-emerald-400/10 text-emerald-300">
                <CheckCircle2 className="h-7 w-7" />
              </span>
              <div className="mt-3 text-lg font-black">{posLabel("success.title", "تم إنشاء الأوردر")}</div>
              <div className="mt-1 text-2xl font-black tracking-wide text-emerald-300" dir="ltr">{created.orderNumber}</div>

              <div className="mt-4 space-y-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3 text-start text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[var(--muted)]">{posLabel("success.shipping", "الشحن")}</span>
                  <strong>{formatCurrency(created.deliveryFee)}</strong>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[var(--muted)]">{posLabel("success.total", "الإجمالي المستحق عند الاستلام")}</span>
                  <strong className="text-emerald-300">{formatCurrency(created.total)}</strong>
                </div>
                {Math.abs(created.total - created.estimated) > 0.5 ? (
                  <div className="rounded-xl border border-amber-300/30 bg-amber-400/10 p-2 text-[11px] font-bold text-amber-100">
                    {posLabel("success.repriced", "الإجمالي اتحسب بأسعار الموقع، فمختلف عن تقدير الكاشير")} ({formatCurrency(created.estimated)})
                  </div>
                ) : null}
              </div>

              <div className="mt-3 flex items-center justify-center gap-2 rounded-2xl border border-emerald-400/25 bg-emerald-400/10 p-3 text-xs font-bold text-emerald-100">
                <MessageCircle className="h-4 w-4 shrink-0" />
                <span>{posLabel("success.whatsapp", "رسالة تأكيد الطلب في طريقها للعميل على واتساب")} <span dir="ltr">{created.phone}</span></span>
              </div>

              <button
                type="button"
                onClick={() => onClose?.()}
                className="mt-5 h-11 w-full rounded-xl bg-emerald-500 text-sm font-black text-black transition hover:bg-emerald-400"
              >
                {posLabel("success.done", "تمام")}
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
              <div className="rounded-2xl border border-sky-400/25 bg-sky-400/[0.07] px-3 py-2 text-[11px] font-bold text-sky-100">
                {posLabel("codNotice", "الدفع عند الاستلام. مفيش أي مبلغ بيتحصّل في الفرع، والأوردر مش بيدخل حساب الوردية.")}
              </div>

              <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3">
                <div className="mb-2 text-[11px] font-black uppercase tracking-[0.14em] text-[var(--muted)]">{posLabel("sections.customer", "بيانات العميل")}</div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label={posLabel("fields.fullName", "الاسم بالكامل")} required value={form.full_name} onChange={(value) => setField("full_name", value)} error={errors.full_name} />
                  <Field label={posLabel("fields.phone", "رقم الموبايل")} required dir="ltr" value={form.primary_phone} onChange={(value) => setField("primary_phone", value)} error={errors.primary_phone} placeholder="01xxxxxxxxx" />
                  <Field label={posLabel("fields.email", "البريد الإلكتروني")} type="email" dir="ltr" value={form.email} onChange={(value) => setField("email", value)} error={errors.email} />
                </div>
              </section>

              <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3">
                <div className="mb-2 text-[11px] font-black uppercase tracking-[0.14em] text-[var(--muted)]">{posLabel("sections.address", "عنوان الشحن")}</div>
                {bostaMode ? (
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Picker
                      label={posLabel("fields.city", "المدينة")}
                      placeholder={posLabel("fields.cityPlaceholder", "اختر المدينة")}
                      value={form.shipping_city_id}
                      loading={bosta.loadingCities}
                      options={cityOptions}
                      error={errors.shipping_city_id}
                      onChange={(value) => {
                        setForm((prev) => ({ ...prev, ...bostaCityPatch(bosta.cities, value) }));
                        setErrors((prev) => ({ ...prev, shipping_city_id: "", shipping_zone_id: "", shipping_district_id: "" }));
                      }}
                    />
                    <Picker
                      label={posLabel("fields.zone", "المنطقة")}
                      placeholder={posLabel("fields.zonePlaceholder", "اختر المنطقة")}
                      value={form.shipping_zone_id}
                      disabled={!form.shipping_city_id}
                      loading={bosta.loadingZones}
                      options={zoneOptions}
                      error={errors.shipping_zone_id}
                      onChange={(value) => {
                        setForm((prev) => ({ ...prev, ...bostaZonePatch(bosta.zones, value) }));
                        setErrors((prev) => ({ ...prev, shipping_zone_id: "", shipping_district_id: "" }));
                      }}
                    />
                    <Picker
                      label={posLabel("fields.district", "الحي")}
                      placeholder={posLabel("fields.districtPlaceholder", "اختر الحي")}
                      value={form.shipping_district_id}
                      disabled={!form.shipping_zone_id}
                      loading={bosta.loadingDistricts}
                      options={districtOptions}
                      error={errors.shipping_district_id}
                      onChange={(value) => {
                        setForm((prev) => ({ ...prev, ...bostaDistrictPatch(districtOptions, value, prev.city_area) }));
                        setErrors((prev) => ({ ...prev, shipping_district_id: "" }));
                      }}
                    />
                  </div>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label={posLabel("fields.governorate", "المحافظة")} required value={form.governorate} onChange={(value) => setField("governorate", value)} error={errors.governorate} />
                    <Field label={posLabel("fields.cityArea", "المدينة / المنطقة")} required value={form.city_area} onChange={(value) => setField("city_area", value)} error={errors.city_area} />
                  </div>
                )}

                <div className="mt-3 grid gap-3 sm:grid-cols-4">
                  <Field label={posLabel("fields.street", "الشارع")} required={bostaMode} value={form.street_address} onChange={(value) => setField("street_address", value)} error={errors.street_address} />
                  <Field label={posLabel("fields.building", "رقم العقار")} required={bostaMode} value={form.building_number} onChange={(value) => setField("building_number", value)} error={errors.building_number} />
                  <Field label={posLabel("fields.floor", "الدور")} value={form.floor_number} onChange={(value) => setField("floor_number", value)} />
                  <Field label={posLabel("fields.apartment", "الشقة")} value={form.apartment_number} onChange={(value) => setField("apartment_number", value)} />
                </div>

                <div className="mt-3 grid gap-3">
                  <Field label={posLabel("fields.detailedAddress", "العنوان بالتفصيل")} required multiline value={form.detailed_address} onChange={(value) => setField("detailed_address", value)} error={errors.detailed_address} />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label={posLabel("fields.landmark", "علامة مميزة")} value={form.landmark} onChange={(value) => setField("landmark", value)} />
                    <Field label={posLabel("fields.deliveryNotes", "ملاحظات للمندوب")} value={form.delivery_notes} onChange={(value) => setField("delivery_notes", value)} />
                  </div>
                </div>
              </section>

              <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3">
                <div className="mb-2 text-[11px] font-black uppercase tracking-[0.14em] text-[var(--muted)]">{posLabel("sections.summary", "الملخص")}</div>
                <div className="space-y-1.5 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[var(--muted)]">{posLabel("summary.items", "Items")} ({items.length})</span>
                    <strong>{formatCurrency(posSubtotal)}</strong>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[var(--muted)]">{posLabel("summary.shipping", "الشحن")}</span>
                    <strong>
                      {quote.loading ? <Loader2 className="inline h-3.5 w-3.5 animate-spin" /> : formatCurrency(quote.price)}
                    </strong>
                  </div>
                  <div className="flex items-center justify-between gap-2 border-t border-[var(--border)] pt-1.5">
                    <span className="font-black">{posLabel("summary.estimated", "الإجمالي التقديري")}</span>
                    <strong className="text-emerald-300">{formatCurrency(estimatedTotal)}</strong>
                  </div>
                </div>
                {/* The server prices the order from the website's canonical prices, not from the
                    POS cart, so the cashier is told up front that this figure can move. */}
                <div className="mt-2 rounded-xl border border-amber-300/25 bg-amber-400/[0.08] p-2 text-[11px] font-bold text-amber-100">
                  {posLabel("summary.repriceNotice", "الأسعار النهائية بتتحسب من أسعار الموقع وقت الحفظ.")}
                </div>
              </section>

              {submitError ? (
                <div className="rounded-2xl border border-rose-400/35 bg-rose-500/10 p-3 text-xs font-bold text-rose-100">{submitError}</div>
              ) : null}
            </div>

            <div className="sticky bottom-0 flex items-center justify-between gap-2 border-t border-[var(--border)] bg-[var(--surface-soft)] p-3">
              <button
                type="button"
                onClick={() => onClose?.()}
                disabled={submitting}
                className="h-11 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 text-sm font-black text-[var(--text)] disabled:opacity-40"
              >
                {posLabel("cancel", "إلغاء")}
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={submitting || !items.length}
                className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 text-sm font-black text-black transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Truck className="h-4 w-4" />}
                {submitting ? posLabel("submitting", "جاري إنشاء الأوردر...") : posLabel("submit", "إنشاء الأوردر وإرسال التأكيد")}
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    portalTarget
  );
}
