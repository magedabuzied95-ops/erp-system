import { Component, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import {
  Building2,
  CheckCircle2,
  ChevronDown,
  Loader2,
  MapPin,
  MessageCircleWarning,
  Pencil,
  Search,
  Send,
  X,
} from "lucide-react";

import { api } from "../../shared/api/api";

/*
  The customer's side of the AI-inbox address link (/addr/:code).

  Deliberately Arabic-only and dependency-free: the person opening this came
  from WhatsApp/Instagram on a phone, mid-conversation, and should finish in
  under a minute. One search box picks the whole Bosta city→zone→district
  hierarchy; the manual cascading selects stay available as a fallback.
*/

const text = (value = "") => String(value ?? "").trim();
const list = (value) => (Array.isArray(value) ? value : []);
const idOf = (item = {}) => text(item.id ?? item.city_id ?? item.zone_id ?? item.district_id);
const labelOf = (item = {}) =>
  text(item.name_ar || item.name_en || item.name || item.city_name_ar || item.zone_name_ar || item.district_name_ar);

const searchRowLabel = (row = {}) => {
  const city = text(row.city_name_ar || row.city_name_en);
  const zone = text(row.zone_name_ar || row.zone_name_en);
  const district = text(row.district_name_ar || row.district_name_en);
  return [city, zone, district && district !== zone ? district : ""].filter(Boolean).join(" — ");
};

const inputClass =
  "w-full rounded-2xl border border-white/12 bg-[#0d0d0d] px-4 py-3.5 text-[15px] font-bold text-white placeholder:text-white/32 outline-none transition focus:border-[#d4af37]/60";

class CustomerAddressPageErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error) {
    console.error("[customer-address-page]", error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="min-h-screen bg-[linear-gradient(180deg,#050505_0%,#101010_45%,#151515_100%)] px-4 py-8 text-white">
          <div className="mx-auto max-w-xl rounded-[1.5rem] border border-white/10 bg-[#101010] p-5">
            <h1 className="text-xl font-black">حدث خطأ في صفحة العنوان</h1>
            <p className="mt-2 text-sm leading-7 text-white/72">تعذر تحميل الصفحة. حاول مرة أخرى أو تواصل معنا.</p>
          </div>
        </main>
      );
    }
    return this.props.children;
  }
}

export function CustomerAddressPage() {
  return (
    <CustomerAddressPageErrorBoundary>
      <CustomerAddressPageInner />
    </CustomerAddressPageErrorBoundary>
  );
}

function CustomerAddressPageInner() {
  const { code } = useParams();
  const resolvedCode = useMemo(() => {
    try {
      return decodeURIComponent(text(code));
    } catch {
      return text(code);
    }
  }, [code]);

  const [linkState, setLinkState] = useState("loading"); // loading | ready | submitted | expired | error
  const [request, setRequest] = useState(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [customerName, setCustomerName] = useState("");
  const [phoneOverride, setPhoneOverride] = useState("");
  const [editingPhone, setEditingPhone] = useState(false);

  // One selected Bosta location = the whole hierarchy at once.
  const [location, setLocation] = useState(null); // { city_id, zone_id, district_id, label }
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [manualMode, setManualMode] = useState(false);
  const [manual, setManual] = useState({ cities: [], zones: [], districts: [], cityId: "", zoneId: "", districtId: "" });

  const [streetAddress, setStreetAddress] = useState("");
  const [buildingNumber, setBuildingNumber] = useState("");
  const [extrasOpen, setExtrasOpen] = useState(false);
  const [floorNumber, setFloorNumber] = useState("");
  const [apartmentNumber, setApartmentNumber] = useState("");
  const [landmark, setLandmark] = useState("");
  const [fieldError, setFieldError] = useState("");
  const searchBoxRef = useRef(null);

  useEffect(() => {
    let active = true;
    if (!resolvedCode) {
      setLinkState("error");
      setError("رابط العنوان غير صالح.");
      return undefined;
    }
    api.get(`/public/address-request/${encodeURIComponent(resolvedCode)}`)
      .then((payload) => {
        if (!active) return;
        const loaded = payload?.request || payload?.data?.request || null;
        setRequest(loaded);
        setCustomerName(text(loaded?.customer_name));
        setLinkState(loaded?.status === "submitted" ? "submitted" : "ready");
      })
      .catch((err) => {
        if (!active) return;
        const status = Number(err?.status || err?.response?.status || 0);
        setError(err?.responseBody?.message || err?.message || "تعذر تحميل رابط العنوان.");
        setLinkState(status === 410 ? "expired" : "error");
      });
    return () => {
      active = false;
    };
  }, [resolvedCode]);

  // Search-as-you-type over the full city/zone/district tree. Debounced; only
  // dropoff-capable districts are offered, because Bosta will refuse the rest.
  useEffect(() => {
    const term = text(searchTerm);
    if (location || manualMode || term.length < 2) {
      setSearchResults([]);
      setSearching(false);
      return undefined;
    }
    let active = true;
    setSearching(true);
    const timer = window.setTimeout(() => {
      api.get(`/shipping/locations/search?provider=bosta&q=${encodeURIComponent(term)}&limit=60`)
        .then((payload) => {
          if (!active) return;
          const rows = list(payload?.locations).filter(
            (row) => row.city_dropoff_available !== false && row.district_dropoff_available !== false
          );
          setSearchResults(rows.slice(0, 30));
        })
        .catch(() => active && setSearchResults([]))
        .finally(() => active && setSearching(false));
    }, 280);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [location, manualMode, searchTerm]);

  // Manual fallback: the classic three cascading lists.
  useEffect(() => {
    if (!manualMode) return undefined;
    let active = true;
    api.get("/shipping/cities?provider=bosta&dropoff=1")
      .then((payload) => active && setManual((current) => ({ ...current, cities: list(payload?.cities) })))
      .catch(() => active && setManual((current) => ({ ...current, cities: [] })));
    return () => {
      active = false;
    };
  }, [manualMode]);

  useEffect(() => {
    if (!manualMode || !manual.cityId) return undefined;
    let active = true;
    api.get(`/shipping/zones?provider=bosta&dropoff=1&cityId=${encodeURIComponent(manual.cityId)}`)
      .then((payload) => active && setManual((current) => ({ ...current, zones: list(payload?.zones) })))
      .catch(() => active && setManual((current) => ({ ...current, zones: [] })));
    return () => {
      active = false;
    };
  }, [manual.cityId, manualMode]);

  useEffect(() => {
    if (!manualMode || !manual.zoneId) return undefined;
    let active = true;
    api.get(`/shipping/districts?provider=bosta&dropoff=1&zoneId=${encodeURIComponent(manual.zoneId)}`)
      .then((payload) => active && setManual((current) => ({ ...current, districts: list(payload?.districts) })))
      .catch(() => active && setManual((current) => ({ ...current, districts: [] })));
    return () => {
      active = false;
    };
  }, [manual.zoneId, manualMode]);

  const manualComplete = manualMode && manual.cityId && manual.zoneId && manual.districtId;
  const selectedIds = location
    ? { city: location.city_id, zone: location.zone_id, district: location.district_id }
    : manualComplete
      ? { city: manual.cityId, zone: manual.zoneId, district: manual.districtId }
      : null;

  const canSubmit = Boolean(selectedIds && text(streetAddress) && text(buildingNumber) && text(customerName)) && !submitting;

  const submit = async () => {
    if (!canSubmit) {
      setFieldError("من فضلك اختر منطقتك واكتب اسم الشارع ورقم المبنى.");
      return;
    }
    setFieldError("");
    setSubmitting(true);
    try {
      const payload = await api.post(`/public/address-request/${encodeURIComponent(resolvedCode)}/submit`, {
        customer_name: text(customerName),
        customer_phone: text(phoneOverride),
        shipping_city_id: selectedIds.city,
        shipping_zone_id: selectedIds.zone,
        shipping_district_id: selectedIds.district,
        street_address: text(streetAddress),
        building_number: text(buildingNumber),
        floor_number: text(floorNumber),
        apartment_number: text(apartmentNumber),
        landmark: text(landmark),
      });
      setRequest((current) => ({ ...(current || {}), ...(payload?.request || {}), status: "submitted", address: payload?.address || payload?.request?.address || {
        governorate: "",
        city_area: location?.label || "",
        street_address: text(streetAddress),
        building_number: text(buildingNumber),
      } }));
      setLinkState("submitted");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      const status = Number(err?.status || err?.response?.status || 0);
      const message = err?.responseBody?.message || err?.message || "تعذر إرسال العنوان، حاول مرة أخرى.";
      if (status === 410) {
        setLinkState("expired");
        setError(message);
      } else {
        setFieldError(message);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const submittedAddress = request?.address || {};

  return (
    <main dir="rtl" className="min-h-screen bg-[linear-gradient(180deg,#050505_0%,#101010_45%,#151515_100%)] px-4 py-6 text-white sm:px-6">
      <div className="mx-auto flex min-h-[92svh] max-w-xl flex-col justify-center py-3">
        <section className="w-full overflow-hidden rounded-[2rem] border border-white/10 bg-[linear-gradient(180deg,#050505_0%,#101010_45%,#151515_100%)] shadow-[0_30px_90px_rgba(0,0,0,0.38),inset_0_1px_0_rgba(255,255,255,0.04)]">
          <div className="px-4 pb-6 pt-5 sm:px-6">
            <div className="h-1 w-full rounded-full bg-[linear-gradient(90deg,#d4af37,#e5c158)]" />

            <header className="mt-5 flex items-start gap-3">
              <div className="grid h-13 w-13 shrink-0 place-items-center rounded-2xl border border-[#d4af37]/20 bg-[rgba(212,175,55,0.12)] p-3 text-[#d4af37]">
                <MapPin className="h-6 w-6" />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-black uppercase tracking-[0.26em] text-[#d4af37]">بيانات التوصيل</p>
                <h1 className="mt-1 text-2xl font-black leading-tight">
                  {linkState === "submitted" ? "وصلنا عنوانك 🎉" : `أهلاً ${text(customerName).split(" ")[0] || "بيك"} 👋`}
                </h1>
                <p className="mt-1.5 text-sm leading-6 text-white/64">
                  {linkState === "submitted"
                    ? "فريقنا هيراجع الطلب ويأكد معاك قبل الشحن."
                    : "اكتب عنوانك مرة واحدة وإحنا نجهز الأوردر — دقيقة واحدة بس."}
                </p>
              </div>
            </header>

            {linkState === "loading" ? (
              <div className="mt-6 flex items-center gap-3 rounded-[1.35rem] border border-white/10 bg-[#101010] px-4 py-5 text-sm font-bold text-white/72">
                <Loader2 className="h-5 w-5 animate-spin text-[#d4af37]" />
                جاري تحميل البيانات...
              </div>
            ) : null}

            {linkState === "expired" || linkState === "error" ? (
              <div className="mt-6 space-y-3 rounded-[1.35rem] border border-amber-200/30 bg-[#101010] p-4">
                <div className="flex items-start gap-3">
                  <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-amber-200/30 bg-[rgba(212,175,55,0.12)] text-[#d4af37]">
                    <MessageCircleWarning className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="text-lg font-black">{linkState === "expired" ? "الرابط انتهت صلاحيته" : "تعذر فتح الرابط"}</h2>
                    <p className="mt-1 text-sm leading-7 text-white/72">
                      {error || "اطلب من فريق المتجر إرسال رابط جديد في المحادثة."}
                    </p>
                  </div>
                </div>
              </div>
            ) : null}

            {linkState === "submitted" ? (
              <div className="mt-6 space-y-4">
                <div className="rounded-[1.35rem] border border-emerald-300/25 bg-[rgba(16,185,129,0.08)] p-4">
                  <div className="flex items-start gap-3">
                    <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-emerald-400/15 text-emerald-300">
                      <CheckCircle2 className="h-5 w-5" />
                    </div>
                    <div>
                      <h2 className="text-lg font-black text-emerald-200">تم استلام العنوان</h2>
                      <p className="mt-1 text-sm leading-7 text-white/72">مفيش حاجة تانية مطلوبة منك — هنتواصل معاك لتأكيد الطلب.</p>
                    </div>
                  </div>
                </div>
                {[submittedAddress.governorate, submittedAddress.city_area, submittedAddress.street_address].some(Boolean) ? (
                  <div className="rounded-[1.35rem] border border-white/10 bg-[#101010] p-4">
                    <div className="mb-2 flex items-center gap-2 text-sm font-black">
                      <MapPin className="h-4 w-4 text-[#d4af37]" />
                      العنوان اللي وصلنا
                    </div>
                    <p className="text-sm leading-7 text-white/80">
                      {[
                        submittedAddress.governorate,
                        submittedAddress.city_area,
                        submittedAddress.street_address,
                        submittedAddress.building_number ? `مبنى ${submittedAddress.building_number}` : "",
                        submittedAddress.floor_number ? `الدور ${submittedAddress.floor_number}` : "",
                        submittedAddress.apartment_number ? `شقة ${submittedAddress.apartment_number}` : "",
                      ]
                        .filter(Boolean)
                        .join(" — ")}
                    </p>
                  </div>
                ) : null}
              </div>
            ) : null}

            {linkState === "ready" ? (
              <div className="mt-6 space-y-4">
                {/* Who */}
                <div className="rounded-[1.35rem] border border-white/10 bg-[#101010] p-4">
                  <div className="mb-3 text-sm font-black text-white/88">بياناتك</div>
                  <div className="space-y-2.5">
                    <input
                      value={customerName}
                      onChange={(event) => setCustomerName(event.target.value)}
                      placeholder="الاسم بالكامل *"
                      className={inputClass}
                    />
                    {request?.has_phone && !editingPhone ? (
                      <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/12 bg-[#0d0d0d] px-4 py-3.5">
                        <span dir="ltr" className="text-[15px] font-black tracking-wide text-white/80">{request.customer_phone_masked}</span>
                        <button
                          type="button"
                          onClick={() => setEditingPhone(true)}
                          className="inline-flex items-center gap-1.5 rounded-full bg-white/8 px-3 py-1.5 text-xs font-black text-[#d4af37]"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          تغيير الرقم
                        </button>
                      </div>
                    ) : (
                      <input
                        value={phoneOverride}
                        onChange={(event) => setPhoneOverride(event.target.value)}
                        placeholder={request?.has_phone ? "رقم الموبايل الجديد" : "رقم الموبايل *"}
                        inputMode="tel"
                        dir="ltr"
                        className={`${inputClass} text-right`}
                      />
                    )}
                  </div>
                </div>

                {/* Where */}
                <div className="rounded-[1.35rem] border border-white/10 bg-[#101010] p-4">
                  <div className="mb-1 flex items-center gap-2 text-sm font-black text-white/88">
                    <MapPin className="h-4 w-4 text-[#d4af37]" />
                    منطقتك
                  </div>
                  <p className="mb-3 text-xs leading-5 text-white/48">اكتب اسم مدينتك أو منطقتك واختار من القائمة.</p>

                  {location ? (
                    <div className="flex items-center justify-between gap-3 rounded-2xl border border-[#d4af37]/35 bg-[rgba(212,175,55,0.10)] px-4 py-3.5">
                      <span className="min-w-0 flex-1 truncate text-sm font-black text-[#e5c158]">{location.label}</span>
                      <button
                        type="button"
                        onClick={() => {
                          setLocation(null);
                          setSearchTerm("");
                          window.setTimeout(() => searchBoxRef.current?.focus(), 50);
                        }}
                        aria-label="تغيير المنطقة"
                        className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/10 text-white/72"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ) : manualMode ? (
                    <div className="space-y-2.5">
                      <select
                        value={manual.cityId}
                        onChange={(event) => setManual((current) => ({ ...current, cityId: event.target.value, zoneId: "", districtId: "", zones: [], districts: [] }))}
                        className={inputClass}
                      >
                        <option value="">المدينة *</option>
                        {manual.cities.map((item) => (
                          <option key={idOf(item)} value={idOf(item)}>{labelOf(item)}</option>
                        ))}
                      </select>
                      <select
                        value={manual.zoneId}
                        onChange={(event) => setManual((current) => ({ ...current, zoneId: event.target.value, districtId: "", districts: [] }))}
                        disabled={!manual.cityId}
                        className={inputClass}
                      >
                        <option value="">المنطقة *</option>
                        {manual.zones.map((item) => (
                          <option key={idOf(item)} value={idOf(item)}>{labelOf(item)}</option>
                        ))}
                      </select>
                      <select
                        value={manual.districtId}
                        onChange={(event) => setManual((current) => ({ ...current, districtId: event.target.value }))}
                        disabled={!manual.zoneId}
                        className={inputClass}
                      >
                        <option value="">الحي *</option>
                        {manual.districts.map((item) => (
                          <option key={idOf(item)} value={idOf(item)}>{labelOf(item)}</option>
                        ))}
                      </select>
                      <button type="button" onClick={() => setManualMode(false)} className="text-xs font-black text-[#d4af37]">
                        الرجوع للبحث السريع
                      </button>
                    </div>
                  ) : (
                    <div>
                      <div className="relative">
                        <Search className="pointer-events-none absolute right-4 top-1/2 h-4.5 w-4.5 -translate-y-1/2 text-white/36" />
                        <input
                          ref={searchBoxRef}
                          value={searchTerm}
                          onChange={(event) => setSearchTerm(event.target.value)}
                          placeholder="مثال: المعادي، طنطا، مدينة نصر..."
                          className={`${inputClass} pr-11`}
                        />
                      </div>
                      {searching ? (
                        <div className="mt-2 flex items-center gap-2 px-1 text-xs font-bold text-white/48">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          جاري البحث...
                        </div>
                      ) : null}
                      {!searching && searchResults.length ? (
                        <div className="mt-2 max-h-64 overflow-y-auto rounded-2xl border border-white/10 bg-[#0d0d0d]">
                          {searchResults.map((row) => (
                            <button
                              key={`${row.city_id}-${row.zone_id}-${row.district_id}`}
                              type="button"
                              onClick={() => {
                                setLocation({
                                  city_id: text(row.city_id),
                                  zone_id: text(row.zone_id),
                                  district_id: text(row.district_id),
                                  label: searchRowLabel(row),
                                });
                                setSearchResults([]);
                              }}
                              className="block w-full border-b border-white/6 px-4 py-3 text-right text-sm font-bold text-white/84 transition last:border-b-0 hover:bg-white/5"
                            >
                              {searchRowLabel(row)}
                            </button>
                          ))}
                        </div>
                      ) : null}
                      {!searching && text(searchTerm).length >= 2 && !searchResults.length ? (
                        <p className="mt-2 px-1 text-xs font-bold text-white/48">مفيش نتائج — جرب اسم تاني أو الاختيار اليدوي.</p>
                      ) : null}
                      <button type="button" onClick={() => setManualMode(true)} className="mt-3 text-xs font-black text-[#d4af37]">
                        الاختيار اليدوي من القوائم
                      </button>
                    </div>
                  )}
                </div>

                {/* Street-level detail */}
                <div className="rounded-[1.35rem] border border-white/10 bg-[#101010] p-4">
                  <div className="mb-3 flex items-center gap-2 text-sm font-black text-white/88">
                    <Building2 className="h-4 w-4 text-[#d4af37]" />
                    العنوان بالتفصيل
                  </div>
                  <div className="space-y-2.5">
                    <textarea
                      value={streetAddress}
                      onChange={(event) => setStreetAddress(event.target.value)}
                      placeholder="اسم الشارع والعنوان بالتفصيل *"
                      rows={3}
                      className={`${inputClass} min-h-[88px] resize-none leading-6`}
                    />
                    <input
                      value={buildingNumber}
                      onChange={(event) => setBuildingNumber(event.target.value)}
                      placeholder="رقم المبنى / العمارة *"
                      className={inputClass}
                    />
                    <button
                      type="button"
                      onClick={() => setExtrasOpen((current) => !current)}
                      className="flex items-center gap-1.5 text-xs font-black text-[#d4af37]"
                    >
                      <ChevronDown className={`h-4 w-4 transition-transform ${extrasOpen ? "rotate-180" : ""}`} />
                      تفاصيل إضافية (الدور، الشقة، علامة مميزة)
                    </button>
                    {extrasOpen ? (
                      <div className="grid grid-cols-2 gap-2.5">
                        <input value={floorNumber} onChange={(event) => setFloorNumber(event.target.value)} placeholder="الدور" className={inputClass} />
                        <input value={apartmentNumber} onChange={(event) => setApartmentNumber(event.target.value)} placeholder="رقم الشقة" className={inputClass} />
                        <input value={landmark} onChange={(event) => setLandmark(event.target.value)} placeholder="علامة مميزة" className={`${inputClass} col-span-2`} />
                      </div>
                    ) : null}
                  </div>
                </div>

                {fieldError ? (
                  <div className="rounded-2xl border border-rose-300/25 bg-[rgba(244,63,94,0.10)] px-4 py-3 text-sm font-bold text-rose-200">
                    {fieldError}
                  </div>
                ) : null}

                <button
                  type="button"
                  onClick={submit}
                  disabled={!canSubmit}
                  className="inline-flex h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-[linear-gradient(90deg,#d4af37,#e5c158)] text-[15px] font-black text-[#151515] transition disabled:opacity-40"
                >
                  {submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
                  إرسال العنوان
                </button>
                <p className="text-center text-[11px] leading-5 text-white/40">
                  الرابط ده خاص بيك وبطلبك الحالي فقط — بياناتك تُستخدم لتوصيل الأوردر لا غير.
                </p>
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </main>
  );
}

export default CustomerAddressPage;
