import { useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import {
  Download,
  FileUp,
  Globe,
  Layers3,
  PackagePlus,
  Palette,
  Plus,
  Save,
  Search,
  Settings,
  ShieldCheck,
  Trash2,
  Truck,
  Upload,
  WalletCards,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { api } from "../../../shared/api/api";
import { publicStorefrontUrl } from "../../../shared/lib/publicStorefront";
import { SALE_MODE_DEFAULTS, normalizeSaleModeSettings, saleModePreviewText } from "../../../shared/lib/saleMode";

const PRICING_DEFAULTS = {
  enable_fake_compare_price: true,
  fake_compare_percent: 20,
  fake_compare_rounding_mode: "none",
  ...SALE_MODE_DEFAULTS,
};

const EGYPT_GOVERNORATES = [
  ["Cairo", "القاهرة"],
  ["Giza", "الجيزة"],
  ["Alexandria", "الإسكندرية"],
  ["Dakahlia", "الدقهلية"],
  ["Red Sea", "البحر الأحمر"],
  ["Beheira", "البحيرة"],
  ["Fayoum", "الفيوم"],
  ["Gharbia", "الغربية"],
  ["Ismailia", "الإسماعيلية"],
  ["Menofia", "المنوفية"],
  ["Minya", "المنيا"],
  ["Qalyubia", "القليوبية"],
  ["New Valley", "الوادي الجديد"],
  ["Suez", "السويس"],
  ["Aswan", "أسوان"],
  ["Assiut", "أسيوط"],
  ["Beni Suef", "بني سويف"],
  ["Port Said", "بورسعيد"],
  ["Damietta", "دمياط"],
  ["Sharqia", "الشرقية"],
  ["South Sinai", "جنوب سيناء"],
  ["Kafr El Sheikh", "كفر الشيخ"],
  ["Matrouh", "مطروح"],
  ["Luxor", "الأقصر"],
  ["Qena", "قنا"],
  ["North Sinai", "شمال سيناء"],
  ["Sohag", "سوهاج"],
];

const QUICK_PRESETS = [
  { governorate: "Damietta", city: "", price: 45, cod_allowed: true, requires_shipping_proof: false, estimated_delivery_text: "1-2 business days" },
  { governorate: "Damietta", city: "New Damietta", price: 40, cod_allowed: true, requires_shipping_proof: false, estimated_delivery_text: "1-2 business days" },
  { governorate: "Cairo", city: "", price: 70, cod_allowed: false, requires_shipping_proof: true, estimated_delivery_text: "2-4 business days" },
  { governorate: "Giza", city: "", price: 70, cod_allowed: false, requires_shipping_proof: true, estimated_delivery_text: "2-4 business days" },
  { governorate: "Alexandria", city: "", price: 75, cod_allowed: false, requires_shipping_proof: true, estimated_delivery_text: "2-5 business days" },
];

const SHIPPING_ZONE_DEFAULTS = {
  governorate: "",
  city: "",
  area: "",
  price: 60,
  cod_allowed: true,
  requires_shipping_proof: true,
  estimated_delivery_text: "2-5 business days",
  provider: "manual",
  free_shipping_threshold: 0,
  minimum_order_for_cod: 0,
  active: true,
};

const shippingCopy = {
  en: {
    website: "Website",
    title: "Website Settings",
    subtitle: "Control storefront pricing, checkout shipping rules, and public commerce behavior from one admin module.",
    openStorefront: "Open Storefront",
    overview: "Overview",
    shipping: "Shipping",
    pricingTitle: "Storefront Pricing Settings",
    pricingText: "Marketing compare prices are storefront-only. They do not affect POS, invoices, cost, valuation, or profit reports.",
    save: "Save",
    saving: "Saving...",
    saveAll: "Save website settings",
    unsaved: "Unsaved changes",
    saved: "Settings saved",
    loadError: "Failed to load website settings",
    saveError: "Failed to save settings",
    defaultPrice: "Default price",
    activeZones: "Active zones",
    codZones: "COD zones",
    proofZones: "Proof-required zones",
    shippingTitle: "Shipping zones",
    shippingText: "Match checkout addresses by exact area first, then city/markaz, then governorate, with a default fallback.",
    search: "Search governorate, city, area, provider",
    allGovs: "All governorates",
    addZone: "Add zone",
    addGovernorates: "Add all Egypt governorates",
    import: "Import",
    export: "Export",
    selected: "selected",
    bulkPrice: "Set selected price",
    bulkCodOn: "Enable COD",
    bulkCodOff: "Disable COD",
    bulkProofOn: "Require proof",
    bulkProofOff: "No proof",
    bulkEta: "Set delivery estimate",
    deleteSelected: "Delete selected",
    governorate: "Governorate",
    city: "City / Markaz",
    area: "Area / District",
    price: "Price",
    cod: "COD",
    proof: "Proof",
    eta: "Estimated delivery",
    provider: "Provider",
    freeThreshold: "Free shipping over",
    minCod: "Min COD order",
    active: "Active",
    actions: "Actions",
    noZones: "No shipping zones match your filters.",
    loading: "Loading website settings...",
    importFailed: "Import file must contain a JSON array of zones.",
    seeded: "Egypt governorates added",
    noMissing: "All Egypt governorates already exist",
    quickCreate: "Quick zone creation",
    governorateOnly: "Governorate only",
    cityLevel: "Governorate + city/markaz",
    areaLevel: "Governorate + city + area/district",
  },
  ar: {
    website: "الموقع",
    title: "إعدادات الموقع",
    subtitle: "تحكم في أسعار المتجر والشحن والدفع من وحدة إدارة واحدة.",
    openStorefront: "فتح المتجر",
    overview: "نظرة عامة",
    shipping: "الشحن",
    pricingTitle: "إعدادات أسعار المتجر",
    pricingText: "أسعار المقارنة تظهر في المتجر فقط ولا تؤثر على الكاشير أو الفواتير أو التقارير.",
    save: "حفظ",
    saving: "جار الحفظ...",
    saveAll: "حفظ إعدادات الموقع",
    unsaved: "تغييرات غير محفوظة",
    saved: "تم حفظ الإعدادات",
    loadError: "تعذر تحميل إعدادات الموقع",
    saveError: "تعذر حفظ الإعدادات",
    defaultPrice: "السعر الافتراضي",
    activeZones: "المناطق النشطة",
    codZones: "مناطق الدفع عند الاستلام",
    proofZones: "مناطق إثبات الدفع",
    shippingTitle: "مناطق الشحن",
    shippingText: "يتم حساب الشحن حسب المنطقة أولاً ثم المدينة/المركز ثم المحافظة ثم السعر الافتراضي.",
    search: "ابحث بالمحافظة أو المدينة أو المنطقة أو الشركة",
    allGovs: "كل المحافظات",
    addZone: "إضافة منطقة",
    addGovernorates: "إضافة كل محافظات مصر",
    import: "استيراد",
    export: "تصدير",
    selected: "محدد",
    bulkPrice: "تعديل سعر المحدد",
    bulkCodOn: "تفعيل الدفع عند الاستلام",
    bulkCodOff: "إيقاف الدفع عند الاستلام",
    bulkProofOn: "يتطلب إثبات دفع",
    bulkProofOff: "لا يتطلب إثبات دفع",
    bulkEta: "تعديل مدة التوصيل",
    deleteSelected: "حذف المحدد",
    governorate: "المحافظة",
    city: "المدينة / المركز",
    area: "المنطقة / الحي",
    price: "السعر",
    cod: "الدفع عند الاستلام",
    proof: "إثبات الدفع",
    eta: "مدة التوصيل",
    provider: "شركة الشحن",
    freeThreshold: "شحن مجاني فوق",
    minCod: "حد أدنى للدفع عند الاستلام",
    active: "نشط",
    actions: "إجراءات",
    noZones: "لا توجد مناطق شحن مطابقة للفلاتر.",
    loading: "جار تحميل إعدادات الموقع...",
    importFailed: "ملف الاستيراد يجب أن يحتوي على قائمة JSON للمناطق.",
    seeded: "تمت إضافة محافظات مصر",
    noMissing: "كل محافظات مصر موجودة بالفعل",
    quickCreate: "إضافة سريعة",
    governorateOnly: "محافظة فقط",
    cityLevel: "محافظة + مدينة/مركز",
    areaLevel: "محافظة + مدينة + منطقة/حي",
  },
};

const normalizeText = (value = "") =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\u0625\u0623\u0622\u0627]/g, "\u0627")
    .replace(/[\u0629]/g, "\u0647")
    .replace(/[\u0649]/g, "\u064a")
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const zoneKey = (zone = {}) => [zone.governorate, zone.city, zone.area].map(normalizeText).join("|");
const money = (value) => `${Number(value || 0).toLocaleString()} EGP`;
const newId = () => `zone-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const normalizeZone = (zone = {}, index = 0) => ({
  ...SHIPPING_ZONE_DEFAULTS,
  ...zone,
  id: String(zone.id || newId() || `zone-${index + 1}`),
  governorate: String(zone.governorate || ""),
  city: String(zone.city || zone.markaz || ""),
  area: String(zone.area || zone.district || ""),
  price: Number(zone.price ?? zone.shipping_price ?? SHIPPING_ZONE_DEFAULTS.price) || 0,
  cod_allowed: zone.cod_allowed !== false,
  requires_shipping_proof: zone.requires_shipping_proof !== false,
  estimated_delivery_text: String(zone.estimated_delivery_text || zone.eta || SHIPPING_ZONE_DEFAULTS.estimated_delivery_text),
  provider: String(zone.provider || "manual"),
  free_shipping_threshold: Number(zone.free_shipping_threshold ?? 0) || 0,
  minimum_order_for_cod: Number(zone.minimum_order_for_cod ?? 0) || 0,
  active: zone.active !== false,
});

function WebsiteSettings() {
  const { i18n } = useTranslation();
  const isArabic = String(i18n.language || "").startsWith("ar");
  const copy = isArabic ? shippingCopy.ar : shippingCopy.en;
  const [activeTab, setActiveTab] = useState("shipping");
  const [pricing, setPricing] = useState(PRICING_DEFAULTS);
  const [defaultShippingPrice, setDefaultShippingPrice] = useState(60);
  const [zones, setZones] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [search, setSearch] = useState("");
  const [governorateFilter, setGovernorateFilter] = useState("");
  const [bulkPrice, setBulkPrice] = useState("");
  const [bulkEta, setBulkEta] = useState("");
  const [quickMode, setQuickMode] = useState("governorate");
  const [quickZone, setQuickZone] = useState({ ...SHIPPING_ZONE_DEFAULTS });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  const importInputRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.get("/website/settings", { cache: "no-store", headers: { "Cache-Control": "no-cache", Pragma: "no-cache" } })
      .then((response) => {
        if (cancelled) return;
        const settings = response.settings || {};
        console.debug("[website-settings:loaded]", {
          sale_mode_enabled: settings.sale_mode_enabled,
        });
        const normalizedSaleMode = normalizeSaleModeSettings(settings);
        setPricing({
          ...PRICING_DEFAULTS,
          ...normalizedSaleMode,
          ...settings,
          sale_mode_enabled: settings.sale_mode_enabled ?? normalizedSaleMode.sale_mode_enabled,
        });
        setDefaultShippingPrice(Number(settings.default_shipping_price ?? 60) || 0);
        setZones((Array.isArray(settings.shipping_zones) ? settings.shipping_zones : []).map(normalizeZone));
        setError("");
      })
      .catch((err) => {
        setError(err.message || copy.loadError);
        toast.error(copy.loadError);
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
          setDirty(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [copy.loadError]);

  const markPricing = (patch) => {
    setPricing((current) => ({ ...current, ...patch }));
    setDirty(true);
  };

  const setZoneValue = (id, key, value) => {
    setZones((current) => current.map((zone) => (zone.id === id ? normalizeZone({ ...zone, [key]: value }) : zone)));
    setDirty(true);
  };

  const addZone = (patch = {}) => {
    setZones((current) => [normalizeZone({ ...SHIPPING_ZONE_DEFAULTS, id: newId(), price: defaultShippingPrice, ...patch }), ...current]);
    setDirty(true);
  };

  const seedEgyptGovernorates = () => {
    const existing = new Set(zones.filter((zone) => !zone.city && !zone.area).map((zone) => normalizeText(zone.governorate)));
    const additions = EGYPT_GOVERNORATES.filter(([governorate, arabic]) => !existing.has(normalizeText(governorate)) && !existing.has(normalizeText(arabic))).map(([governorate]) =>
      normalizeZone({
        ...SHIPPING_ZONE_DEFAULTS,
        id: normalizeText(governorate).replace(/\s+/g, "-"),
        governorate,
        price: defaultShippingPrice,
      })
    );
    if (!additions.length) {
      toast(copy.noMissing);
      return;
    }
    setZones((current) => [...additions, ...current]);
    setDirty(true);
    toast.success(`${copy.seeded}: ${additions.length}`);
  };

  const saveAll = async () => {
    setSaving(true);
    try {
      const payload = {
        enable_fake_compare_price: Boolean(pricing.enable_fake_compare_price),
        fake_compare_percent: Math.max(0, Number(pricing.fake_compare_percent || 0)),
        fake_compare_rounding_mode: pricing.fake_compare_rounding_mode || "none",
        ...normalizeSaleModeSettings(pricing),
        sale_mode_type: "use_existing_sale_prices_only",
        sale_mode_value: 0,
        default_shipping_price: Math.max(0, Number(defaultShippingPrice || 0)),
        shipping_zones: zones.map(normalizeZone),
      };
      console.debug("[website-settings:save-payload]", {
        sale_mode_enabled: payload.sale_mode_enabled,
      });
      const response = await api.put("/website/settings", payload);
      const settings = response.settings || payload;
      console.debug("[website-settings:save-response]", {
        sale_mode_enabled: settings.sale_mode_enabled,
      });
      const normalizedSaleMode = normalizeSaleModeSettings(settings);
      setPricing({
        ...PRICING_DEFAULTS,
        ...normalizedSaleMode,
        ...settings,
        sale_mode_enabled: settings.sale_mode_enabled ?? normalizedSaleMode.sale_mode_enabled,
      });
      setDefaultShippingPrice(Number(settings.default_shipping_price ?? payload.default_shipping_price) || 0);
      setZones((Array.isArray(settings.shipping_zones) ? settings.shipping_zones : payload.shipping_zones).map(normalizeZone));
      setDirty(false);
      toast.success(copy.saved);
    } catch (err) {
      toast.error(err.message || copy.saveError);
    } finally {
      setSaving(false);
    }
  };

  const summary = useMemo(() => ({
    active: zones.filter((zone) => zone.active).length,
    cod: zones.filter((zone) => zone.cod_allowed).length,
    proof: zones.filter((zone) => zone.requires_shipping_proof).length,
  }), [zones]);

  const governorates = useMemo(() => Array.from(new Set([...EGYPT_GOVERNORATES.map(([name]) => name), ...zones.map((zone) => zone.governorate).filter(Boolean)])).sort(), [zones]);

  const filteredZones = useMemo(() => {
    const query = normalizeText(search);
    return zones.filter((zone) => {
      const matchesGov = !governorateFilter || normalizeText(zone.governorate) === normalizeText(governorateFilter);
      const haystack = normalizeText([zone.governorate, zone.city, zone.area, zone.provider, zone.estimated_delivery_text].join(" "));
      return matchesGov && (!query || haystack.includes(query));
    });
  }, [zones, search, governorateFilter]);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedCount = selectedIds.length;

  const applyBulk = (patch) => {
    if (!selectedCount) return;
    setZones((current) => current.map((zone) => (selectedSet.has(zone.id) ? normalizeZone({ ...zone, ...patch }) : zone)));
    setDirty(true);
  };

  const deleteSelected = () => {
    setZones((current) => current.filter((zone) => !selectedSet.has(zone.id)));
    setSelectedIds([]);
    setDirty(true);
  };

  const exportZones = () => {
    const blob = new Blob([JSON.stringify(zones.map(normalizeZone), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "storefront-shipping-zones.json";
    link.click();
    URL.revokeObjectURL(url);
  };

  const importZones = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (!Array.isArray(parsed)) throw new Error(copy.importFailed);
      const next = parsed.map(normalizeZone);
      setZones((current) => {
        const byKey = new Map(current.map((zone) => [zoneKey(zone), zone]));
        next.forEach((zone) => byKey.set(zoneKey(zone), zone));
        return Array.from(byKey.values());
      });
      setDirty(true);
    } catch (err) {
      toast.error(err.message || copy.importFailed);
    }
  };

  const addQuickZone = () => {
    addZone({
      ...quickZone,
      city: quickMode === "governorate" ? "" : quickZone.city,
      area: quickMode === "area" ? quickZone.area : "",
    });
  };

  return (
    <div className="space-y-5 pb-24" dir={isArabic ? "rtl" : "ltr"}>
      <header className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-xl shadow-[var(--shadow)]">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--card)] px-3 py-1 text-xs font-black uppercase tracking-[0.16em] text-[var(--muted)]">
              <Settings className="h-4 w-4" />
              {copy.website}
            </div>
            <h1 className="mt-3 text-3xl font-black tracking-normal text-[var(--text)]">{copy.title}</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted)]">{copy.subtitle}</p>
          </div>
          <a href={publicStorefrontUrl("/")} target="_blank" rel="noreferrer" className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[var(--primary)] px-4 text-sm font-black text-white shadow-lg">
            <Globe className="h-4 w-4" />
            {copy.openStorefront}
          </a>
        </div>
        <div className="mt-5 inline-flex rounded-xl border border-[var(--border)] bg-[var(--card)] p-1">
          {[
            ["shipping", copy.shipping],
            ["overview", copy.overview],
          ].map(([key, label]) => (
            <button key={key} type="button" onClick={() => setActiveTab(key)} className={`h-10 rounded-lg px-4 text-sm font-black transition ${activeTab === key ? "bg-[var(--primary)] text-white shadow" : "text-[var(--muted)] hover:text-[var(--text)]"}`}>
              {label}
            </button>
          ))}
        </div>
      </header>

      {loading ? <StateCard text={copy.loading} /> : null}
      {error ? <StateCard text={error} tone="error" /> : null}

      {!loading && activeTab === "shipping" ? (
        <section className="space-y-5">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <SummaryCard icon={WalletCards} label={copy.defaultPrice} value={money(defaultShippingPrice)} />
            <SummaryCard icon={Truck} label={copy.activeZones} value={summary.active} />
            <SummaryCard icon={PackagePlus} label={copy.codZones} value={summary.cod} />
            <SummaryCard icon={ShieldCheck} label={copy.proofZones} value={summary.proof} />
          </div>

          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-xl shadow-[var(--shadow)]">
            <div className="border-b border-[var(--border)] p-5">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                <div>
                  <h2 className="text-xl font-black text-[var(--text)]">{copy.shippingTitle}</h2>
                  <p className="mt-1 max-w-3xl text-sm leading-6 text-[var(--muted)]">{copy.shippingText}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={seedEgyptGovernorates} className="inline-flex h-10 items-center gap-2 rounded-xl bg-emerald-500 px-3 text-xs font-black text-white">
                    <Layers3 className="h-4 w-4" />
                    {copy.addGovernorates}
                  </button>
                  <button type="button" onClick={() => addZone()} className="inline-flex h-10 items-center gap-2 rounded-xl bg-[var(--primary)] px-3 text-xs font-black text-white">
                    <Plus className="h-4 w-4" />
                    {copy.addZone}
                  </button>
                  <button type="button" onClick={() => importInputRef.current?.click()} className="inline-flex h-10 items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 text-xs font-black text-[var(--text)]">
                    <FileUp className="h-4 w-4" />
                    {copy.import}
                  </button>
                  <button type="button" onClick={exportZones} className="inline-flex h-10 items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 text-xs font-black text-[var(--text)]">
                    <Download className="h-4 w-4" />
                    {copy.export}
                  </button>
                  <input ref={importInputRef} type="file" accept="application/json,.json" onChange={importZones} className="hidden" />
                </div>
              </div>

              <div className="mt-5 grid gap-3 xl:grid-cols-[1fr_220px_180px]">
                <label className="relative block">
                  <Search className="pointer-events-none absolute top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted)] ltr:left-3 rtl:right-3" />
                  <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={copy.search} className="h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--card)] px-10 text-sm font-semibold text-[var(--text)] outline-none" />
                </label>
                <select value={governorateFilter} onChange={(event) => setGovernorateFilter(event.target.value)} className="h-11 rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 text-sm font-bold text-[var(--text)] outline-none">
                  <option value="">{copy.allGovs}</option>
                  {governorates.map((governorate) => <option key={governorate} value={governorate}>{governorate}</option>)}
                </select>
                <label className="flex h-11 items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] px-3">
                  <span className="text-xs font-black text-[var(--muted)]">{copy.defaultPrice}</span>
                  <input type="number" min="0" value={defaultShippingPrice} onChange={(event) => { setDefaultShippingPrice(event.target.value); setDirty(true); }} className="min-w-0 flex-1 bg-transparent text-sm font-black text-[var(--text)] outline-none" />
                </label>
              </div>

              <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--card)] p-3">
                <div className="mb-3 text-xs font-black uppercase tracking-[0.14em] text-[var(--muted)]">{copy.quickCreate}</div>
                <div className="grid gap-2 lg:grid-cols-[210px_1fr_1fr_1fr_110px_110px]">
                  <select value={quickMode} onChange={(event) => setQuickMode(event.target.value)} className="h-10 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 text-xs font-bold text-[var(--text)]">
                    <option value="governorate">{copy.governorateOnly}</option>
                    <option value="city">{copy.cityLevel}</option>
                    <option value="area">{copy.areaLevel}</option>
                  </select>
                  <input value={quickZone.governorate} onChange={(event) => setQuickZone((current) => ({ ...current, governorate: event.target.value }))} placeholder={copy.governorate} className="h-10 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 text-xs font-bold text-[var(--text)]" />
                  <input disabled={quickMode === "governorate"} value={quickZone.city} onChange={(event) => setQuickZone((current) => ({ ...current, city: event.target.value }))} placeholder={copy.city} className="h-10 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 text-xs font-bold text-[var(--text)] disabled:opacity-40" />
                  <input disabled={quickMode !== "area"} value={quickZone.area} onChange={(event) => setQuickZone((current) => ({ ...current, area: event.target.value }))} placeholder={copy.area} className="h-10 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 text-xs font-bold text-[var(--text)] disabled:opacity-40" />
                  <input type="number" min="0" value={quickZone.price} onChange={(event) => setQuickZone((current) => ({ ...current, price: event.target.value }))} placeholder={copy.price} className="h-10 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 text-xs font-bold text-[var(--text)]" />
                  <button type="button" onClick={addQuickZone} className="h-10 rounded-lg bg-[var(--primary)] px-3 text-xs font-black text-white">{copy.addZone}</button>
                </div>
              </div>

              {selectedCount ? (
                <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-primary/20 bg-primary/10 p-3">
                  <span className="text-sm font-black text-[var(--text)]">{selectedCount} {copy.selected}</span>
                  <input type="number" min="0" value={bulkPrice} onChange={(event) => setBulkPrice(event.target.value)} placeholder={copy.price} className="h-9 w-28 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 text-xs font-bold text-[var(--text)]" />
                  <button type="button" onClick={() => bulkPrice !== "" && applyBulk({ price: Number(bulkPrice) })} className="h-9 rounded-lg bg-[var(--primary)] px-3 text-xs font-black text-white">{copy.bulkPrice}</button>
                  <button type="button" onClick={() => applyBulk({ cod_allowed: true })} className="h-9 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 text-xs font-black text-[var(--text)]">{copy.bulkCodOn}</button>
                  <button type="button" onClick={() => applyBulk({ cod_allowed: false })} className="h-9 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 text-xs font-black text-[var(--text)]">{copy.bulkCodOff}</button>
                  <button type="button" onClick={() => applyBulk({ requires_shipping_proof: true })} className="h-9 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 text-xs font-black text-[var(--text)]">{copy.bulkProofOn}</button>
                  <button type="button" onClick={() => applyBulk({ requires_shipping_proof: false })} className="h-9 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 text-xs font-black text-[var(--text)]">{copy.bulkProofOff}</button>
                  <input value={bulkEta} onChange={(event) => setBulkEta(event.target.value)} placeholder={copy.eta} className="h-9 w-44 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 text-xs font-bold text-[var(--text)]" />
                  <button type="button" onClick={() => bulkEta && applyBulk({ estimated_delivery_text: bulkEta })} className="h-9 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 text-xs font-black text-[var(--text)]">{copy.bulkEta}</button>
                  <button type="button" onClick={deleteSelected} className="h-9 rounded-lg bg-rose-600 px-3 text-xs font-black text-white">{copy.deleteSelected}</button>
                </div>
              ) : null}
            </div>

            <div className="m1-table-container overflow-x-auto">
              <table className="m1-table m1-table--compact min-w-[1280px] w-full text-sm">
                <thead className="bg-[var(--card)] text-xs font-black uppercase tracking-[0.12em] text-[var(--muted)]">
                  <tr>
                    <th className="w-12 px-4 py-4 text-start"><input type="checkbox" checked={filteredZones.length > 0 && filteredZones.every((zone) => selectedSet.has(zone.id))} onChange={(event) => setSelectedIds(event.target.checked ? filteredZones.map((zone) => zone.id) : [])} /></th>
                    {[copy.governorate, copy.city, copy.area, copy.price, copy.cod, copy.proof, copy.eta, copy.provider, copy.freeThreshold, copy.minCod, copy.active, copy.actions].map((header) => (
                      <th key={header} className="px-3 py-4 text-start">{header}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredZones.map((zone) => (
                    <tr key={zone.id} className="border-t border-[var(--border)]">
                      <td className="px-4 py-3"><input type="checkbox" checked={selectedSet.has(zone.id)} onChange={(event) => setSelectedIds((current) => event.target.checked ? [...current, zone.id] : current.filter((id) => id !== zone.id))} /></td>
                      <EditableCell value={zone.governorate} onChange={(value) => setZoneValue(zone.id, "governorate", value)} />
                      <EditableCell value={zone.city} onChange={(value) => setZoneValue(zone.id, "city", value)} />
                      <EditableCell value={zone.area} onChange={(value) => setZoneValue(zone.id, "area", value)} />
                      <EditableCell type="number" value={zone.price} onChange={(value) => setZoneValue(zone.id, "price", value)} compact />
                      <ToggleCell checked={zone.cod_allowed} onChange={(value) => setZoneValue(zone.id, "cod_allowed", value)} />
                      <ToggleCell checked={zone.requires_shipping_proof} onChange={(value) => setZoneValue(zone.id, "requires_shipping_proof", value)} />
                      <EditableCell value={zone.estimated_delivery_text} onChange={(value) => setZoneValue(zone.id, "estimated_delivery_text", value)} wide />
                      <EditableCell value={zone.provider} onChange={(value) => setZoneValue(zone.id, "provider", value)} compact />
                      <EditableCell type="number" value={zone.free_shipping_threshold} onChange={(value) => setZoneValue(zone.id, "free_shipping_threshold", value)} compact />
                      <EditableCell type="number" value={zone.minimum_order_for_cod} onChange={(value) => setZoneValue(zone.id, "minimum_order_for_cod", value)} compact />
                      <ToggleCell checked={zone.active} onChange={(value) => setZoneValue(zone.id, "active", value)} />
                      <td className="px-3 py-3">
                        <button type="button" onClick={() => { setZones((current) => current.filter((item) => item.id !== zone.id)); setDirty(true); }} className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-rose-400/20 bg-rose-500/10 text-rose-300">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!filteredZones.length ? (
                    <tr>
                      <td colSpan={13} className="px-6 py-14 text-center text-sm font-bold text-[var(--muted)]">{copy.noZones}</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      ) : null}

      {!loading && activeTab === "overview" ? (
        <OverviewTab copy={copy} pricing={pricing} markPricing={markPricing} />
      ) : null}

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--border)] bg-[var(--surface)]/95 px-4 py-3 shadow-2xl shadow-black/20 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
          <span className={`text-sm font-black ${dirty ? "text-amber-400" : "text-[var(--muted)]"}`}>{dirty ? copy.unsaved : copy.saved}</span>
          <button type="button" onClick={saveAll} disabled={loading || saving} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[var(--primary)] px-5 text-sm font-black text-white shadow-lg disabled:cursor-not-allowed disabled:opacity-60">
            <Save className="h-4 w-4" />
            {saving ? copy.saving : copy.saveAll}
          </button>
        </div>
      </div>
    </div>
  );
}

function OverviewTab({ copy, pricing, markPricing }) {
  const cards = [
    { title: "Website status", value: "Online", description: `Public storefront is available at ${publicStorefrontUrl("/")}.`, icon: ShieldCheck, tone: "emerald" },
    { title: "Domain", value: "Not connected", description: "Connect a custom domain for the customer storefront.", icon: Globe, tone: "blue" },
    { title: "Theme", value: "Premium minimal", description: "Control storefront logo, colors, typography, and homepage assets.", icon: Palette, tone: "violet" },
    { title: "Shipping provider", value: "Manual ready", description: "Bosta, Mylerz, Aramex, manual delivery, and pickup structure is ready.", icon: Truck, tone: "amber" },
  ];
  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => <SettingCard key={card.title} {...card} />)}
      </div>
      <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-xl shadow-[var(--shadow)]">
        <h2 className="text-xl font-black text-[var(--text)]">{copy.pricingTitle}</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">{copy.pricingText}</p>
        <div className="mt-5 grid gap-4 md:grid-cols-3">
          <label className="flex min-h-24 items-center justify-between gap-4 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
            <span>
              <span className="block text-sm font-black text-[var(--text)]">Enable fake compare price</span>
              <span className="mt-1 block text-xs leading-5 text-[var(--muted)]">Show generated old prices on storefront cards and product pages.</span>
            </span>
            <input type="checkbox" checked={Boolean(pricing.enable_fake_compare_price)} onChange={(event) => markPricing({ enable_fake_compare_price: event.target.checked })} className="h-5 w-5 accent-[var(--primary)]" />
          </label>
          <Field label="Fake compare percent" type="number" value={pricing.fake_compare_percent} onChange={(value) => markPricing({ fake_compare_percent: value })} />
          <label className="block rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
            <span className="block text-sm font-black text-[var(--text)]">Rounding mode</span>
            <select value={pricing.fake_compare_rounding_mode} onChange={(event) => markPricing({ fake_compare_rounding_mode: event.target.value })} className="mt-3 h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm font-bold text-[var(--text)] outline-none">
              <option value="none">none</option>
              <option value="nearest_10">nearest_10</option>
              <option value="nearest_50">nearest_50</option>
              <option value="nearest_100">nearest_100</option>
            </select>
          </label>
        </div>
        <div className="mt-5 rounded-xl border border-amber-400/20 bg-amber-400/10 p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h3 className="text-lg font-black text-[var(--text)]">Existing Sale Prices</h3>
              <p className="mt-1 text-sm font-bold text-[var(--muted)]">{saleModePreviewText(pricing)}</p>
            </div>
            <button type="button" onClick={() => markPricing({ sale_mode_enabled: !pricing.sale_mode_enabled, sale_mode_type: "use_existing_sale_prices_only", sale_mode_value: 0 })} className={`h-11 rounded-xl px-4 text-sm font-black ${pricing.sale_mode_enabled ? "bg-amber-300 text-zinc-950" : "border border-amber-300/30 text-amber-100"}`}>
              {pricing.sale_mode_enabled ? "Disable Existing Sale Prices" : "Enable Existing Sale Prices"}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

function Field({ label, value, onChange, type = "text" }) {
  return (
    <label className="block rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
      <span className="block text-sm font-black text-[var(--text)]">{label}</span>
      <input type={type} value={value || ""} onChange={(event) => onChange(event.target.value)} className="mt-3 h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm font-bold text-[var(--text)] outline-none" />
    </label>
  );
}

function SummaryCard({ icon: Icon, label, value }) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-xl shadow-[var(--shadow)]">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs font-black uppercase tracking-[0.14em] text-[var(--muted)]">{label}</div>
          <div className="mt-2 text-2xl font-black text-[var(--text)]">{value}</div>
        </div>
        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-3 text-[var(--primary)]">
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  );
}

function EditableCell({ value, onChange, type = "text", compact = false, wide = false }) {
  return (
    <td className="border-t border-[var(--border)] px-3 py-3">
      <input type={type} value={value ?? ""} onChange={(event) => onChange(event.target.value)} className={`h-10 rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 text-sm font-semibold text-[var(--text)] outline-none ${compact ? "w-24" : wide ? "w-48" : "w-36"}`} />
    </td>
  );
}

function ToggleCell({ checked, onChange }) {
  return (
    <td className="border-t border-[var(--border)] px-3 py-3">
      <button type="button" onClick={() => onChange(!checked)} className={`h-8 w-14 rounded-full p-1 transition ${checked ? "bg-emerald-500" : "bg-zinc-500/40"}`} aria-pressed={checked}>
        <span className={`block h-6 w-6 rounded-full bg-white transition ${checked ? "ltr:translate-x-6 rtl:-translate-x-6" : ""}`} />
      </button>
    </td>
  );
}

function SettingCard({ title, value, description, icon: Icon, tone }) {
  const tones = {
    emerald: "border-emerald-500/20 bg-emerald-500/10 text-emerald-300",
    blue: "border-primary/20 bg-primary/10 text-primary",
    violet: "border-violet-500/20 bg-violet-500/10 text-violet-300",
    amber: "border-amber-500/20 bg-amber-500/10 text-amber-300",
  };
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-xl shadow-[var(--shadow)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-[11px] font-black uppercase tracking-[0.18em] text-[var(--muted)]">{title}</div>
          <div className="mt-2 text-xl font-black text-[var(--text)]">{value}</div>
        </div>
        <div className={`rounded-xl border p-3 ${tones[tone] || tones.blue}`}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
      <p className="mt-4 text-sm leading-6 text-[var(--muted)]">{description}</p>
    </div>
  );
}

function StateCard({ text, tone = "muted" }) {
  return (
    <div className={`rounded-2xl border p-6 text-center text-sm font-black ${tone === "error" ? "border-rose-400/20 bg-rose-500/10 text-rose-200" : "border-[var(--border)] bg-[var(--surface)] text-[var(--muted)]"}`}>
      {tone === "error" ? <Upload className="mx-auto mb-2 h-5 w-5" /> : null}
      {text}
    </div>
  );
}

export default WebsiteSettings;
