import { Component, useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Input, MetricCard, Switch } from "../../../shared/ui";
import {
  AlertCircle,
  Bot,
  Building2,
  Check,
  ChevronDown,
  ChevronRight,
  Clock3,
  Copy,
  CreditCard,
  Database,
  Download,
  ExternalLink,
  Eye,
  Filter,
  Globe2,
  Image,
  Layers3,
  Loader2,
  Lock,
  MapPin,
  Maximize2,
  Minimize2,
  Package,
  PanelLeftClose,
  PlayCircle,
  Plus,
  Phone,
  RefreshCw,
  Save,
  Search,
  Settings2,
  ShieldCheck,
  ShoppingCart,
  SlidersHorizontal,
  Sparkles,
  Store,
  TestTube2,
  Trash2,
  Truck,
  Undo2,
  Upload,
  Warehouse,
  X,
} from "lucide-react";
import toast from "react-hot-toast";
import i18n from "../../../i18n/i18n";
import { useTranslation } from "react-i18next";

/** Module scope: resolve through i18n at CALL time, never eagerly at import. */
const tt = (key, options) => i18n.t(key, options);

import { api } from "../../../shared/api/api";
import { getCurrentTenant, getCurrentUser, setCurrentTenant } from "../../../shared/auth/authStorage";
import { resolveProductImageUrl } from "../../../shared/lib/imageUrls";
import { publicStorefrontUrl } from "../../../shared/lib/publicStorefront";
import {
  SHIPPING_HANDLING_MAX_KEY,
  SHIPPING_HANDLING_MIN_KEY,
  validateGlobalHandlingTime,
} from "../../../shared/lib/shippingHandlingSettings.js";
import { normalizeSettingsCategory, settingsCategories, settingsByCategory, settingsByKey } from "../../../../shared/settingsRegistry.js";
import { defaultEgyptShippingLocations } from "../../../../shared/egyptShippingLocations.js";
import {
  BARCODE_PRINT_DEFAULTS,
  BARCODE_PRINT_SETTING_KEYS,
  DISPLAY_REFILL_BARCODE_DEFAULTS,
  barcodePrintSettingsToValues,
  displayRefillBarcodeSettingsToValues,
} from "../../../../shared/barcodePrintSettings.js";
import { uploadProductImageValue } from "../../products/services/productsApi";
import "./SettingsCenter.m1.css";

const copy = {
  en: {
    title: "Settings Center",
    subtitle: "Manage your entire ERP from one place.",
    description: "Manage company, operations, orders, AI and security settings.",
    search: "Search settings",
    save: "Save Changes",
    saving: "Saving",
    discard: "Discard",
    preview: "Preview",
    lastSaved: "Last saved",
    neverSaved: "Not saved this session",
    unsaved: "unsaved changes",
    saved: "Settings saved",
    loadFailed: "Unable to load settings",
    saveFailed: "Unable to save settings",
    empty: "No settings match your search.",
    advanced: "Advanced / Developer Settings",
    advancedHint: "Registry audit and raw operational metadata for internal troubleshooting.",
    protected: "Protected",
    enabled: "Enabled",
    disabled: "Disabled",
    openStore: "Open Store",
    previewStore: "Preview Store",
    copyUrl: "Copy URL",
    testShipping: "Test Shipping",
    shippingRules: "View Shipping Rules",
    testAi: "Test AI",
    openInbox: "Open AI Inbox",
    modified: "Modified",
    searchResult: "Jump to",
    collectionHint: "Type a collection slug and press Enter.",
    uploadHelper: "Upload support can be connected later.",
    pasteImageUrl: "Paste image URL",
    clearImage: "Clear image",
    imageUnavailable: "Image unavailable",
    retry: "Retry",
    apiErrorTitle: "Settings could not be loaded",
    apiErrorHint: "Check your connection or backend session, then try again.",
    previewTitle: "Storefront Preview",
    close: "Close",
  },
  ar: {
    title: "مركز الإعدادات",
    subtitle: "إدارة إعدادات النظام بالكامل من شاشة واحدة.",
    description: "تحكم في إعدادات الشركة والتشغيل والطلبات والذكاء الاصطناعي والأمان.",
    search: "ابحث في الإعدادات",
    save: "حفظ التغييرات",
    saving: "جارِ الحفظ",
    discard: "تجاهل التغييرات",
    preview: "معاينة",
    lastSaved: "آخر حفظ",
    neverSaved: "لم يتم الحفظ في هذه الجلسة",
    unsaved: "تغييرات غير محفوظة",
    saved: "تم حفظ الإعدادات",
    loadFailed: "تعذر تحميل الإعدادات",
    saveFailed: "تعذر حفظ الإعدادات",
    empty: "لا توجد إعدادات مطابقة لعملية البحث.",
    advanced: "إعدادات متقدمة / المطور",
    advancedHint: "مراجعة السجل والبيانات التشغيلية الخام لأغراض الدعم الداخلي.",
    protected: "محمي",
    enabled: "مفعل",
    disabled: "معطل",
    openStore: "فتح المتجر",
    previewStore: "معاينة المتجر",
    copyUrl: "نسخ الرابط",
    testShipping: "اختبار الشحن",
    shippingRules: "عرض قواعد الشحن",
    testAi: "اختبار الذكاء الاصطناعي",
    openInbox: "فتح صندوق الذكاء الاصطناعي",
    modified: "معدل",
    searchResult: "انتقال إلى",
    collectionHint: "اكتب معرف المجموعة ثم اضغط Enter.",
    uploadHelper: "يمكن ربط ميزة الرفع لاحقاً.",
    pasteImageUrl: "ألصق رابط الصورة",
    clearImage: "مسح الصورة",
    imageUnavailable: "الصورة غير متاحة",
    retry: "إعادة المحاولة",
    apiErrorTitle: "تعذر تحميل الإعدادات",
    apiErrorHint: "تحقق من الاتصال أو جلسة الخادم ثم حاول مرة أخرى.",
    previewTitle: "معاينة واجهة المتجر",
    close: "إغلاق",
  },
};

const iconMap = {
  general: Building2,
  orders: ShoppingCart,
  storefront: Store,
  shipping: Truck,
  payments: CreditCard,
  pos: CreditCard,
  inventory: Warehouse,
  accounting: Database,
  employees: Clock3,
  ai_channels: Bot,
  notifications: Sparkles,
  security: ShieldCheck,
  barcode_printing: Package,
};

const navDescriptions = {
  general: "Company profile and locale",
  orders: "Lifecycle and fulfillment",
  storefront: "Public shop and catalog",
  shipping: "Zones, prices, proof, providers",
  payments: "COD, wallets, gateways",
  pos: "Cashier defaults",
  inventory: "Stock and warehouse rules",
  accounting: "Ledger and tax defaults",
  employees: "Payroll and attendance",
  ai_channels: "AI and marketing automation",
  notifications: "Alerts and channels",
  security: "Access and protection",
  barcode_printing: "Paper, labels, and print layout",
};

const sectionMap = {
  general: [
    ["Company Information", ["general.default_country", "general.default_city"]],
    ["Currency", ["general.default_currency", "general.currency_symbol"]],
    ["Language", ["general.default_language", "general.default_direction"]],
    ["Timezone", ["general.timezone"]],
    ["Date & Number Formats", ["general.date_format", "general.time_format", "general.number_format"]],
    ["Preferences", ["general.default_branch_id", "general.default_warehouse_id", "general.default_pos_treasury_account_id", "general.business_working_days", "general.business_hours"]],
  ],
  barcode_printing: [
    ["Barcode Printing", BARCODE_PRINT_SETTING_KEYS],
  ],
  storefront: [
    ["Store Identity", ["storefront.enabled", "storefront.store_name", "storefront.public_url", "storefront.store_logo_url", "storefront.favicon_url"]],
    ["Homepage", ["storefront.homepage_hero", "storefront.featured_collections"]],
    ["Catalog", ["storefront.product_sorting_default", "storefront.show_sold_out_products"]],
    ["Search", []],
    ["Product Cards", ["storefront.show_low_stock_badge", "storefront.show_product_views", "storefront.enable_wishlist", "storefront.enable_product_sharing", "storefront.enable_size_guide"]],
    ["SEO", ["storefront.seo_title", "storefront.seo_description", "storefront.open_graph_image_url"]],
    ["Notifications", []],
  ],
  shipping: [
    ["Shipping Overview", ["storefront.default_shipping_price"]],
    ["Shipping Locations", ["storefront.shipping_locations"]],
    ["Shipping Zones", ["storefront.shipping_zones"]],
    ["Governorates & Cities", ["storefront.shipping_zones"]],
    ["Free Shipping Rules", ["storefront.shipping_zones"]],
    ["Shipping Proof Rules", ["storefront.shipping_zones"]],
    ["Shipping Providers", ["orders.shipping_provider", "orders.bosta_api_key", "orders.bosta_webhook_secret", "orders.bosta_allow_open_package"]],
  ],
  payments: [
    ["Cash on Delivery", ["orders.allow_cod"]],
    ["Instapay", ["payments.instapay_enabled", "payments.instapay_handle"]],
    ["Vodafone Cash", ["payments.vodafone_cash_enabled", "payments.vodafone_cash_number"]],
    ["Paymob", ["payments.paymob_enabled"]],
    ["Stripe", ["payments.stripe_enabled"]],
    ["Payment Instructions", ["payments.instructions"]],
  ],
  orders: [
    ["Order numbering", ["orders.order_number_prefix", "orders.invoice_number_prefix"]],
    ["Checkout", ["orders.default_website_order_status", "orders.default_pos_order_status", "orders.auto_confirm_website_orders", "orders.allow_cod", "orders.allow_store_pickup"]],
    ["Stock reservation", ["orders.reserve_stock_on_website_order", "orders.reserve_stock_expiry_minutes", "orders.cancel_unpaid_after_minutes"]],
  ],
  pos: [
    ["Checkout", ["pos.default_branch_id", "pos.default_warehouse_id", "pos.auto_send_pos_invoice_whatsapp"]],
    ["Payments", ["pos.default_cashier_treasury_id", "pos.allow_split_payments", "pos.allow_customer_credit"]],
    ["Discounts", ["pos.allow_discount", "pos.max_discount_percent", "pos.manager_approval_discount_percent"]],
    ["Receipt", ["pos.print_receipt_automatically", "pos.receipt_template"]],
    ["Cart", ["pos.allow_returns", "pos.barcode_scanner_behavior", "pos.hold_cart_timeout_minutes"]],
  ],
  ai_channels: [
    ["OpenAI Credentials", ["ai_channels.openai_agent_api_key", "ai_channels.openai_thermal_api_key"]],
    ["AI Assistant", ["ai_channels.ai_support_enabled", "ai_channels.ai_reply_mode", "ai_channels.product_recommendation_strictness"]],
    ["AI Inbox", ["ai_channels.human_takeover_behavior", "ai_channels.auto_return_to_ai_minutes", "ai_channels.handoff_message", "ai_channels.ai_fallback_message"]],
    ["Marketing Automation", ["ai_channels.allowed_channels", "ai_channels.storefront_product_link_base"]],
    ["Meta Integrations", ["ai_channels.meta_integration_enabled", "ai_channels.webhook_url_display", "ai_channels.cloudinary_cloud_name", "ai_channels.cloudinary_api_secret"]],
  ],
};

const storefrontPaymentSettingKeys = new Set([
  "storefront.payment_methods.vodafone_cash_enabled",
  "storefront.payment_methods.vodafone_cash_display_name",
  "storefront.payment_methods.vodafone_cash_number",
  "storefront.payment_methods.vodafone_cash_logo_url",
  "storefront.payment_methods.vodafone_cash_helper_text",
  "storefront.payment_methods.instapay_enabled",
  "storefront.payment_methods.instapay_display_name",
  "storefront.payment_methods.instapay.payment_url",
  "storefront.payment_methods.instapay_handle",
  "storefront.payment_methods.instapay_logo_url",
  "storefront.payment_methods.instapay_helper_text",
  "storefront.payment_methods.shipping_confirmation_enabled",
  "storefront.payment_methods.shipping_confirmation_amount",
  "storefront.payment_methods.shipping_confirmation_label",
]);

const visualStorefrontSections = [
  "storefront",
  "identity",
  "store_identity",
  "homepage",
  "catalog",
  "product_cards",
  "seo",
  "marketing",
];

const legacyAudit = [
  ["Company, language, currency, tax number", "/settings/company, /settings/currencies", "general"],
  ["Storefront URL, logo, SEO, sale display", "/settings?category=storefront", "storefront"],
  ["AI support mode, channels, handoff messages", "/ai/settings and AI channel settings", "ai_channels"],
  ["POS defaults, discounts, receipt behavior", "POS runtime components", "pos"],
  ["Shipping zones, provider and carrier credentials", "/settings?category=shipping", "shipping"],
];

const localized = (value, language = "en") => {
  if (!value || typeof value !== "object") return String(value || "");
  return value[language] || value.en || value.ar || "";
};

const sameValue = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

const isHttpOrHttpsUrl = (value = "") => /^https?:\/\/\S+/i.test(String(value || "").trim());



const safeParseJson = (value, fallback) => {
  if (value && typeof value === "object") return value;
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
};

const stringifyValue = (setting, value) => {
  if (setting.type === "json") return value ?? setting.defaultValue ?? null;
  if (setting.type === "multiselect") return Array.isArray(value) ? value : [];
  if (setting.type === "boolean") return Boolean(value);
  return value ?? "";
};

const valueForSave = (setting, value) => {
  if (setting.type === "number") return Number(value);
  if (setting.type === "multiselect") return Array.isArray(value) ? value : [];
  if (setting.type === "boolean") return Boolean(value);
  if (setting.type === "json") return value ?? setting.defaultValue ?? null;
  return value;
};

const mapByKey = (settings = []) => new Map(settings.map((setting) => [setting.key, setting]));

const debugSettingsEnabled = () =>
  String(import.meta.env?.VITE_DEBUG_SETTINGS || "").toLowerCase() === "true";

const isDeveloperUser = (user = {}) => {
  const role = String(user?.role || user?.role_name || "")
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  return Boolean(
    user?.is_super_admin ||
    user?.is_developer ||
    user?.developer ||
    ["super_admin", "superadmin", "developer"].includes(role)
  );
};

const timeAgo = (date) => {
  if (!date) return "";
  const seconds = Math.max(1, Math.round((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return `${hours}h ago`;
};

/* ============================================================================
   SHARED SURFACE SOURCE — Global Surface Normalization
   ----------------------------------------------------------------------------
   These seven constants are the surface source for ~220 call sites in this file.
   They used to hardcode a LIGHT surface model (white/slate) with a hand-written
   `dark:` counterpart, which meant SettingsCenter painted a blue-black
   (slate-950) dark theme while the rest of the app paints neutral charcoal.

   `SettingsCenter.m1.css` was already correcting that at paint time with
   `!important` attribute-substring overrides — so the surface had TWO competing
   sources of truth and the JSX no longer described what the user actually saw.
   These constants now name the semantic token directly, which is what the shim
   was resolving them to anyway. The shim stays: ~470 legacy utility occurrences
   remain at individual call sites in this file and it is still their safety net.

   Values are theme-aware by construction (ThemeProvider swaps the variables), so
   no `dark:` variant is needed or wanted here — a `dark:` override would
   reintroduce a second surface model. */
const shellCard = "border border-border bg-surface-raised shadow-[var(--shadow-card)]";
const fieldSurface = "border border-border bg-surface";
const subtleSurface = "border border-border bg-surface-soft";
const headingText = "text-text";
const bodyText = "text-text-muted";
const mutedText = "text-[var(--text-tertiary)]";
const inputClass = "w-full rounded-2xl border border-border bg-surface px-3.5 py-3 text-sm font-semibold text-text outline-none transition placeholder:text-[var(--text-tertiary)] focus:border-primary focus:ring-4 focus:ring-[color:var(--focus-ring)]";
// Mirrors the server mask: a saved secret is never sent back, so this stands in for one
// in the field and is stripped on save. Submitting it verbatim would store the asterisks.
const SECRET_PLACEHOLDER = "********";

class SettingsCenterErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="min-h-screen bg-slate-950 p-6 text-white">
        <div className="mx-auto max-w-xl rounded-3xl border border-rose-400/20 bg-rose-500/10 p-6">
          <h1 className="m1-page-title">{tt("settings.shell.error")}</h1>
          <p className="mt-2 text-sm text-rose-100">{this.state.error?.message || "Unable to render settings."}</p>
          <button type="button" onClick={() => this.setState({ error: null })} className="mt-5 rounded-[var(--radius-control)] bg-white px-4 py-2 text-sm font-black text-slate-950">{tt("settings.shell.retry")}</button>
        </div>
      </div>
    );
  }
}

export default function SettingsCenter({ debugMode = false }) {
  return (
    <SettingsCenterErrorBoundary>
      <SettingsCenterContent debugMode={debugMode} />
    </SettingsCenterErrorBoundary>
  );
}

function SettingsCenterContent({ debugMode = false }) {
  const { t, i18n } = useTranslation();
  const language = i18n.language?.startsWith("ar") ? "ar" : "en";
  const ui = copy[language];
  const direction = language === "ar" ? "rtl" : "ltr";
  const location = useLocation();
  const navigate = useNavigate();
  const params = new URLSearchParams(location.search);
  const categoryFromPath = {
    "/settings/company": "general",
    "/settings/currencies": "general",
    "/settings/appearance": "general",
    "/settings/storefront": "storefront",
    "/settings/shipping": "shipping",
    "/settings/payments": "payments",
    "/ai/settings": "ai_channels",
  };
  const initialCategory = normalizeSettingsCategory(params.get("category") || categoryFromPath[location.pathname]) || "general";

  const [activeCategory, setActiveCategory] = useState(settingsByCategory[initialCategory] ? initialCategory : "general");
  const [records, setRecords] = useState([]);
  const [values, setValues] = useState({});
  const [originalValues, setOriginalValues] = useState({});
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [lastSaved, setLastSaved] = useState(null);
  const [collectionDraft, setCollectionDraft] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [siteSettings, setSiteSettings] = useState({
    company_name: "",
    company_logo_url: "",
    favicon_url: "",
  });
  const [originalSiteSettings, setOriginalSiteSettings] = useState({
    company_name: "",
    company_logo_url: "",
    favicon_url: "",
  });
  const [siteSettingsLoading, setSiteSettingsLoading] = useState(false);
  const [siteSettingsSaving, setSiteSettingsSaving] = useState(false);
  const [siteSettingsError, setSiteSettingsError] = useState("");
  const canViewDebugSettings = useMemo(() => debugSettingsEnabled() || isDeveloperUser(getCurrentUser()), []);
  const activeSection = activeCategory === "storefront"
    ? String(params.get("section") || "storefront").trim().toLowerCase().replace(/[\s-]+/g, "_")
    : activeCategory;
  const shouldShowPreviewPanel = activeCategory === "storefront" && visualStorefrontSections.includes(activeSection);
  const settingsGridColumns = shouldShowPreviewPanel
    ? "lg:grid-cols-[20rem_minmax(0,1fr)] xl:grid-cols-[20rem_minmax(0,1fr)_22rem]"
    : "lg:grid-cols-[20rem_minmax(0,1fr)]";

  const definitions = useMemo(() => settingsByCategory[activeCategory] || [], [activeCategory]);
  const siteSettingKeys = useMemo(() => new Set(["general.company_name", "general.company_logo_url", "general.favicon_url"]), []);
  const recordMap = useMemo(() => mapByKey(records), [records]);
  const definitionMap = useMemo(() => mapByKey(definitions), [definitions]);

  const dirtyKeys = useMemo(() => definitions
    .filter((setting) => {
      if (setting.isSecret && !values[setting.key]) return false;
      return !sameValue(values[setting.key], originalValues[setting.key]);
    })
    .map((setting) => setting.key), [definitions, originalValues, values]);
  const isDirty = dirtyKeys.length > 0;
  const normalizedSiteSettings = useMemo(() => ({
    company_name: String(siteSettings.company_name || "").trim(),
    company_logo_url: String(siteSettings.company_logo_url || "").trim(),
    favicon_url: String(siteSettings.favicon_url || "").trim(),
  }), [siteSettings.company_name, siteSettings.company_logo_url, siteSettings.favicon_url]);
  const normalizedOriginalSiteSettings = useMemo(() => ({
    company_name: String(originalSiteSettings.company_name || "").trim(),
    company_logo_url: String(originalSiteSettings.company_logo_url || "").trim(),
    favicon_url: String(originalSiteSettings.favicon_url || "").trim(),
  }), [originalSiteSettings.company_name, originalSiteSettings.company_logo_url, originalSiteSettings.favicon_url]);
  const siteSettingsDirty = useMemo(
    () => !sameValue(normalizedSiteSettings, normalizedOriginalSiteSettings),
    [normalizedOriginalSiteSettings, normalizedSiteSettings]
  );
  const dirtyCount = dirtyKeys.length + (siteSettingsDirty ? 1 : 0);
  const siteBrandName = normalizedSiteSettings.company_name || "MONE";

  const applyPayload = useCallback((payload, category = activeCategory, extraValues = {}) => {
    const incoming = Array.isArray(payload?.settings) ? payload.settings : [];
    setRecords(incoming);
    const next = {};
    incoming.forEach((setting) => {
      next[setting.key] = stringifyValue(setting, setting.isSecret ? "" : setting.value);
    });
    Object.entries(extraValues || {}).forEach(([key, value]) => {
      if (key in next) return;
      const definition = settingsByKey[key] || definitionMap.get(key);
      if (!definition) return;
      next[key] = stringifyValue(definition, value);
    });
    (settingsByCategory[category] || []).forEach((definition) => {
      if (!(definition.key in next)) next[definition.key] = stringifyValue(definition, definition.defaultValue);
    });
    setValues(next);
    setOriginalValues(next);
  }, [activeCategory, definitionMap]);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const payload = await api.get(`/settings/${activeCategory}`, { perfComponent: "SettingsCenterV2.load" });
      const extraValues = {};
      if (activeCategory === "storefront") {
        try {
          const paymentsPayload = await api.get("/settings/payments", { perfComponent: "SettingsCenterV2.loadPayments" });
          (paymentsPayload.settings || []).forEach((setting) => {
            const mappedKey =
              setting.key === "payments.instapay_enabled" ? "storefront.payment_methods.instapay_enabled" :
              setting.key === "payments.instapay_payment_url" ? "storefront.payment_methods.instapay.payment_url" :
              setting.key === "payments.instapay_url" ? "storefront.payment_methods.instapay.payment_url" :
              setting.key === "payments.instapay_handle" ? "storefront.payment_methods.instapay_handle" :
              setting.key === "payments.vodafone_cash_enabled" ? "storefront.payment_methods.vodafone_cash_enabled" :
              setting.key === "payments.vodafone_cash_number" ? "storefront.payment_methods.vodafone_cash_number" :
              "";
            if (mappedKey && !(mappedKey in extraValues)) extraValues[mappedKey] = setting.value;
          });
        } catch {
          // Ignore legacy payment settings fallback failures.
        }
      }
      applyPayload(payload, activeCategory, extraValues);
    } catch (loadError) {
      const message = loadError?.responseBody?.message || loadError?.message || ui.loadFailed;
      setError(message === "Request Failed" ? ui.loadFailed : message);
    } finally {
      setLoading(false);
    }
  }, [activeCategory, applyPayload, ui.loadFailed]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const loadSiteSettings = useCallback(async () => {
    if (activeCategory !== "general") return;
    setSiteSettingsLoading(true);
    setSiteSettingsError("");
    try {
      const payload = await api.get("/settings/site", { perfComponent: "SettingsCenterV2.loadSiteSettings" });
      const site = payload?.site || payload?.settings || payload?.company || {};
      const next = {
        company_name: String(site.company_name || site.companyName || "").trim(),
        company_logo_url: String(site.company_logo_url || site.companyLogoUrl || site.logo_url || site.logoUrl || "").trim(),
        favicon_url: String(site.favicon_url || site.faviconUrl || "").trim(),
      };
      setSiteSettings(next);
      setOriginalSiteSettings(next);
      if (next.company_name || next.company_logo_url || next.favicon_url) {
        const currentTenant = getCurrentTenant() || {};
        setCurrentTenant({
          ...currentTenant,
          id: currentTenant.id || String(site.tenant_id || currentTenant.id || ""),
          companyName: next.company_name || currentTenant.companyName || currentTenant.name || "MONE",
          name: next.company_name || currentTenant.name || "MONE",
          company_logo_url: next.company_logo_url || currentTenant.company_logo_url || "",
          companyLogoUrl: next.company_logo_url || currentTenant.companyLogoUrl || currentTenant.logoUrl || "",
          favicon_url: next.favicon_url || currentTenant.favicon_url || "",
          faviconUrl: next.favicon_url || currentTenant.faviconUrl || "",
        });
      }
    } catch (loadError) {
      const message = loadError?.responseBody?.message || loadError?.message || ui.loadFailed;
      setSiteSettingsError(message === "Request Failed" ? ui.loadFailed : message);
    } finally {
      setSiteSettingsLoading(false);
    }
  }, [activeCategory, ui.loadFailed]);

  useEffect(() => {
    void loadSiteSettings();
  }, [loadSiteSettings]);


  useEffect(() => {
    if (!shouldShowPreviewPanel) setPreviewOpen(false);
  }, [shouldShowPreviewPanel]);

  useEffect(() => {
    const handler = (event) => {
      if (!isDirty && !siteSettingsDirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty, siteSettingsDirty]);

  const switchCategory = (category) => {
    const next = normalizeSettingsCategory(category);
    if (!next) return;
    if (isDirty || siteSettingsDirty) {
      toast.error(`${dirtyCount} ${ui.unsaved}`);
      return;
    }
    setActiveCategory(next);
    setSearch("");
    navigate(`/settings?category=${next}`, { replace: true });
  };

  const updateSettingsSearch = (nextValue) => {
    const next = String(nextValue || "");
    const looksLikeBrowserIdentityAutofill = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next.trim());
    setSearch(looksLikeBrowserIdentityAutofill ? "" : next);
  };

  const updateValue = (key, value) => setValues((current) => ({ ...current, [key]: value }));
  const resetBarcodePrintDefaults = () => {
    const nextDefaults = {
      ...barcodePrintSettingsToValues(BARCODE_PRINT_DEFAULTS),
      ...displayRefillBarcodeSettingsToValues(DISPLAY_REFILL_BARCODE_DEFAULTS),
    };
    setValues((current) => ({ ...current, ...nextDefaults }));
    toast.success(language === "ar" ? "تمت إعادة إعدادات طباعة الباركود إلى الوضع الافتراضي" : "Barcode print settings reset to defaults");
  };
  const updateHero = (patch) => {
    const current = safeParseJson(values["storefront.homepage_hero"], {});
    updateValue("storefront.homepage_hero", { ...current, ...patch });
  };

  const updateSiteSetting = (key, value) => {
    setSiteSettings((current) => ({ ...current, [key]: value }));
    setSiteSettingsError("");
  };

  const saveSiteSettings = async () => {
    if (!siteSettingsDirty) return;
    setSiteSettingsSaving(true);
    setSiteSettingsError("");
    try {
      const response = await api.patch("/settings/site", {
        site: {
          company_name: normalizedSiteSettings.company_name,
          company_logo_url: normalizedSiteSettings.company_logo_url,
          favicon_url: normalizedSiteSettings.favicon_url,
        },
      }, { perfComponent: "SettingsCenterV2.saveSiteSettings" });
      const next = {
        company_name: String(response?.site?.company_name || response?.company?.company_name || normalizedSiteSettings.company_name || "MONE").trim(),
        company_logo_url: String(response?.site?.company_logo_url || response?.company?.company_logo_url || normalizedSiteSettings.company_logo_url || "").trim(),
        favicon_url: String(response?.site?.favicon_url || response?.company?.favicon_url || normalizedSiteSettings.favicon_url || "").trim(),
      };
      setSiteSettings(next);
      setOriginalSiteSettings(next);
      const currentTenant = getCurrentTenant() || {};
      setCurrentTenant({
        ...currentTenant,
        companyName: next.company_name || currentTenant.companyName || currentTenant.name || "MONE",
        name: next.company_name || currentTenant.name || "MONE",
        company_logo_url: next.company_logo_url || currentTenant.company_logo_url || "",
        companyLogoUrl: next.company_logo_url || currentTenant.companyLogoUrl || currentTenant.logoUrl || "",
        favicon_url: next.favicon_url || currentTenant.favicon_url || "",
        faviconUrl: next.favicon_url || currentTenant.faviconUrl || "",
      });
      toast.success(language === "ar" ? "تم حفظ إعدادات الهوية" : "Site identity saved");
    } catch (saveError) {
      const message = saveError?.responseBody?.message || saveError?.message || ui.saveFailed;
      setSiteSettingsError(message === "Request Failed" ? ui.saveFailed : message);
      toast.error(message === "Request Failed" ? ui.saveFailed : message);
    } finally {
      setSiteSettingsSaving(false);
    }
  };

  const discard = () => {
    setValues({ ...originalValues });
    setSiteSettings({ ...originalSiteSettings });
    toast.success(language === "ar" ? "تم تجاهل التغييرات" : "Changes discarded");
  };

  const save = async () => {
    if (activeCategory === "shipping") {
      const handlingError = validateGlobalHandlingTime(
        values[SHIPPING_HANDLING_MIN_KEY],
        values[SHIPPING_HANDLING_MAX_KEY],
        language
      );
      if (handlingError) {
        toast.error(handlingError);
        return;
      }
    }
    if (activeCategory === "storefront") {
      const paymentUrlValue = String(values["storefront.payment_methods.instapay.payment_url"] || "").trim();
      const legacyHandleValue = String(values["storefront.payment_methods.instapay_handle"] || "").trim();
      const paymentUrlValid = paymentUrlValue ? isHttpOrHttpsUrl(paymentUrlValue) : Boolean(legacyHandleValue);
      if (!paymentUrlValid) {
        toast.error(t("settings.toasts.instapayInvalidLink"));
        return;
      }
    }
    const payload = {};
    for (const setting of definitions) {
      if (!dirtyKeys.includes(setting.key)) continue;
      if (setting.isSecret && !values[setting.key]) continue;
      payload[setting.key] = valueForSave(setting, values[setting.key]);
    }
    if (!Object.keys(payload).length) return;
    setSaving(true);
    try {
      const response = await api.put(`/settings/${activeCategory}`, { settings: payload }, { perfComponent: "SettingsCenterV2.save" });
      if (activeCategory === "storefront") {
        const paymentKeys = Object.keys(payload).filter((key) => storefrontPaymentSettingKeys.has(key));
        if (paymentKeys.length) {
          console.debug("[payment-settings:saved]", { category: activeCategory, keys: paymentKeys });
        }
      }
      const merged = mapByKey(records);
      (response.settings || []).forEach((setting) => merged.set(setting.key, setting));
      const nextRecords = Array.from(merged.values());
      const nextValues = { ...values };
      (response.settings || []).forEach((setting) => {
        nextValues[setting.key] = stringifyValue(setting, setting.isSecret ? "" : setting.value);
      });
      setRecords(nextRecords);
      setValues(nextValues);
      setOriginalValues(nextValues);
      setLastSaved(new Date());
      toast.success(ui.saved);
    } catch (saveError) {
      toast.error(saveError?.responseBody?.message || saveError?.message || ui.saveFailed);
    } finally {
      setSaving(false);
    }
  };


  const activeCategoryMeta = settingsCategories.find((category) => category.key === activeCategory) || settingsCategories[0];
  const ActiveIcon = iconMap[activeCategory] || Settings2;
  const normalizedSearch = search.trim().toLowerCase();

  const searchMatches = useMemo(() => definitions.filter((setting) => {
    if (siteSettingKeys.has(setting.key)) return false;
    if (!normalizedSearch) return false;
    return [
      setting.key,
      localized(setting.label, "en"),
      localized(setting.label, "ar"),
      localized(setting.description, "en"),
      localized(setting.description, "ar"),
      localized(activeCategoryMeta?.label, "en"),
      localized(activeCategoryMeta?.label, "ar"),
    ].join(" ").toLowerCase().includes(normalizedSearch);
  }), [activeCategoryMeta?.label, definitions, normalizedSearch, siteSettingKeys]);

  const sections = useMemo(() => {
    if (activeCategory === "storefront" || activeCategory === "shipping") return [];
    const configured = sectionMap[activeCategory] || [];
    const configuredKeys = new Set(configured.flatMap(([, keys]) => keys));
    const built = configured.map(([title, keys]) => ({
      title,
      settings: keys.map((key) => recordMap.get(key) || definitionMap.get(key)).filter(Boolean),
    })).filter((section) => section.settings.length);
    const remaining = definitions.filter((setting) => !configuredKeys.has(setting.key) && !siteSettingKeys.has(setting.key));
    if (remaining.length) built.push({ title: localized(activeCategoryMeta.label, language), settings: remaining });
    return built.map((section) => ({
      ...section,
      settings: normalizedSearch ? section.settings.filter((setting) => searchMatches.some((match) => match.key === setting.key)) : section.settings,
    })).filter((section) => section.settings.length);
  }, [activeCategory, activeCategoryMeta.label, definitionMap, definitions, language, normalizedSearch, recordMap, searchMatches]);

  const setting = (key) => recordMap.get(key) || definitionMap.get(key) || { key, label: { en: key }, type: "text" };
  const value = (key, fallback = "") => values[key] ?? fallback;
  const hero = safeParseJson(value("storefront.homepage_hero"), {});
  const featuredCollections = Array.isArray(value("storefront.featured_collections")) ? value("storefront.featured_collections") : [];
  const publicStoreUrl = publicStorefrontUrl(value("storefront.public_url") || "/");
  const storeUrl = value("storefront.public_url") || publicStoreUrl;
  const storeName = value("storefront.store_name") || "";
  const logoUrl = value("storefront.store_logo_url");

  const quickActions = {
    storefront: [
      [ui.openStore, ExternalLink, () => window.open(publicStoreUrl, "_blank", "noopener,noreferrer")],
      [ui.previewStore, Eye, () => window.open(publicStoreUrl, "_blank", "noopener,noreferrer")],
      [ui.copyUrl, Copy, async () => { await navigator.clipboard?.writeText(publicStoreUrl); toast.success(t("settings.toasts.copied")); }],
    ],
    orders: [
      [ui.testShipping, TestTube2, () => toast.success(t("settings.toasts.shippingReady"))],
      [ui.shippingRules, Truck, () => switchCategory("orders")],
    ],
    ai_channels: [
      [ui.testAi, PlayCircle, () => navigate("/ai/settings")],
      [ui.openInbox, Bot, () => navigate("/admin/ai-inbox")],
    ],
  }[activeCategory] || [];

  const renderInput = (item) => {
    const current = value(item.key);
    const fieldClass = inputClass;
    if (item.type === "boolean") {
      return (
        <button
          type="button"
          onClick={() => updateValue(item.key, !current)}
          className={`inline-flex h-[var(--control-height-lg)] items-center gap-3 rounded-full border px-3 text-sm font-black transition ${current ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/25 dark:bg-emerald-500/12 dark:text-emerald-200" : "border-slate-200 bg-slate-50 text-slate-600 dark:border-white/10 dark:bg-primary dark:text-slate-300"}`}
        >
          <span className={`h-6 w-11 rounded-full p-1 transition ${current ? "bg-emerald-500" : "bg-slate-300 dark:bg-slate-700"}`}>
            <span className={`block h-4 w-4 rounded-full bg-white transition ${current ? (direction === "rtl" ? "-translate-x-5" : "translate-x-5") : ""}`} />
          </span>
          {current ? ui.enabled : ui.disabled}
        </button>
      );
    }
    if (item.type === "select") {
      return (
        <select className={fieldClass} value={current} onChange={(event) => updateValue(item.key, event.target.value)}>
          {(item.options || []).map((option) => <option key={option.value} value={option.value}>{localized(option.label, language)}</option>)}
        </select>
      );
    }
    if (item.type === "multiselect") {
      const selected = new Set(Array.isArray(current) ? current : []);
      return (
        <div className="flex flex-wrap gap-2">
          {(item.options || []).map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => {
                const next = new Set(selected);
                if (next.has(option.value)) next.delete(option.value);
                else next.add(option.value);
                updateValue(item.key, Array.from(next));
              }}
              className={`rounded-full border px-3 py-2 text-xs font-black ${selected.has(option.value) ? "border-sky-200 bg-sky-50 text-sky-800 dark:border-blue-400/30 dark:bg-blue-500/15 dark:text-blue-100" : "border-slate-200 bg-white text-slate-600 dark:border-white/10 dark:bg-primary dark:text-slate-300"}`}
            >
              {localized(option.label, language)}
            </button>
          ))}
        </div>
      );
    }
    if (item.type === "json") {
      const jsonValue = safeParseJson(current, item.defaultValue || {});
      if (jsonValue && !Array.isArray(jsonValue) && typeof jsonValue === "object") {
        return (
          <div className="grid gap-2 sm:grid-cols-2">
            {Object.entries(jsonValue).map(([key, val]) => (
              <label key={key} className="block">
                <span className="mb-1 block text-xs font-black uppercase text-slate-400">{key}</span>
                <input className={fieldClass} value={String(val ?? "")} onChange={(event) => updateValue(item.key, { ...jsonValue, [key]: event.target.value })} />
              </label>
            ))}
          </div>
        );
      }
      return <CollectionSelector collections={Array.isArray(current) ? current : []} draft={collectionDraft} setDraft={setCollectionDraft} onChange={(next) => updateValue(item.key, next)} hint={ui.collectionHint} />;
    }
    if (item.type === "textarea") {
      return <textarea rows={4} className={fieldClass} value={current} onChange={(event) => updateValue(item.key, event.target.value)} />;
    }
    return (
      <input
        className={fieldClass}
        type={item.type === "number" ? "number" : item.type === "url" ? "url" : item.type === "secret" ? "password" : "text"}
        name={item.isSecret ? `m1-system-secret-${item.key.replaceAll(".", "-")}` : undefined}
        autoComplete={item.isSecret ? "new-password" : undefined}
        data-1p-ignore={item.isSecret ? "true" : undefined}
        data-lpignore={item.isSecret ? "true" : undefined}
        value={current}
        onChange={(event) => updateValue(item.key, event.target.value)}
        placeholder={item.isSecret
          ? item.maskedValue
            ? `${language === "ar" ? "محفوظ" : "Saved"}: ${item.maskedValue} — ${language === "ar" ? "اتركه فارغًا للاحتفاظ به" : "leave blank to keep it"}`
            : language === "ar" ? "أدخل المفتاح السري" : "Enter secret key"
          : ""}
      />
    );
  };

  const renderField = (item, compact = false) => {
    const dirty = dirtyKeys.includes(item.key);
    const matched = normalizedSearch && searchMatches.some((match) => match.key === item.key);
    return (
      <article id={`setting-${item.key}`} key={item.key} className={`rounded-[var(--radius-card)] border p-4 transition ${dirty ? "border-amber-200 bg-amber-50/70 dark:border-amber-400/30 dark:bg-amber-500/10" : matched ? "border-sky-200 bg-sky-50/70 dark:border-blue-400/30 dark:bg-blue-500/10" : "border-slate-200 bg-white dark:border-white/10 dark:bg-slate-900/82"} ${compact ? "" : "shadow-sm dark:shadow-none"}`}>
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className={`m1-section-title ${headingText}`}>{localized(item.label, language)}</h3>
              {dirty ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-black text-amber-800 dark:bg-amber-400/15 dark:text-amber-200">{ui.modified}</span> : null}
              {item.isSecret ? <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-black text-slate-600 dark:bg-white/10 dark:text-slate-300"><Lock className="h-3 w-3" />{ui.protected}</span> : null}
            </div>
            <p className={`mt-1 text-xs leading-5 ${bodyText}`}>{localized(item.description, language)}</p>
          </div>
        </div>
        {renderInput(item)}
      </article>
    );
  };

  if (debugMode) {
    if (!canViewDebugSettings) {
      return (
        <div dir={direction} className="min-h-screen bg-[#f6f8fb] p-4 text-slate-950 dark:bg-[#050816] dark:text-white sm:p-6">
          <section className={`mx-auto max-w-2xl rounded-[1.75rem] p-6 ${shellCard}`}>
            <div className="flex gap-3">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-200">
                <Lock className="h-6 w-6" />
              </span>
              <div>
                <h1 className={`m1-page-title ${headingText}`}>{t("settings.debug.unavailable")}</h1>
                <p className={`mt-2 text-sm leading-6 ${bodyText}`}>{t("settings.debug.superAdminOnly")}</p>
              </div>
            </div>
          </section>
        </div>
      );
    }
    return <SettingsDebugPage ui={ui} records={records} values={values} loading={loading} error={error} onRetry={loadSettings} />;
  }

  return (
    <div dir={direction} className="m1-settings-center min-h-screen w-full max-w-[calc(100vw-1.5rem)] overflow-x-hidden bg-[#f6f8fb] text-slate-950 dark:bg-[#050816] dark:text-white lg:max-w-none">
      <div className="mx-auto w-full max-w-[calc(100vw-3rem)] px-0 py-4 sm:max-w-none sm:px-5 lg:px-8">
        <header className="sticky top-0 z-20 border-b border-slate-200/70 bg-[#f6f8fb]/90 px-0 py-3 backdrop-blur-xl dark:border-white/10 dark:bg-[#050816]/90 lg:-mx-8 lg:px-8">
          <div className="flex w-full min-w-0 max-w-full flex-col gap-4 rounded-[1.75rem] border border-white/70 bg-white/85 p-4 shadow-[0_18px_60px_rgba(15,23,42,0.08)] dark:border-white/10 dark:bg-slate-950/80 dark:shadow-[0_22px_70px_rgba(0,0,0,0.45)] lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-3 py-1 text-xs font-black uppercase tracking-[0.14em] text-white dark:bg-gradient-to-r dark:from-blue-500 dark:to-violet-500">
                  <Settings2 className="h-4 w-4" />
                  {ui.title}
                </span>
                <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-bold text-slate-500 dark:border-white/10 dark:bg-white/5 dark:text-slate-300">{ui.lastSaved} {lastSaved ? timeAgo(lastSaved) : ui.neverSaved}</span>
                {isDirty || siteSettingsDirty ? <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-black text-amber-800 dark:bg-amber-400/15 dark:text-amber-200">{dirtyCount} {ui.unsaved}</span> : null}
              </div>
              <h1 className={`m1-page-title mt-3 max-w-full break-words ${headingText}`}>{ui.subtitle}</h1>
              <p className={`mt-1 text-sm font-medium ${bodyText}`}>{ui.description}</p>
            </div>
            <div className="flex min-w-0 max-w-full flex-col gap-2 sm:flex-row sm:items-center">
              <label className="relative min-w-0 max-w-full sm:w-80">
                <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
                <input
                  type="search"
                  name="m1-settings-filter-query"
                  autoComplete="off"
                  data-1p-ignore="true"
                  data-lpignore="true"
                  value={search}
                  onChange={(event) => updateSettingsSearch(event.target.value)}
                  placeholder={ui.search}
                  className="h-[var(--control-height-lg)] w-full rounded-[var(--radius-control)] border border-slate-200 bg-white pe-3 ps-10 text-sm font-semibold text-slate-950 outline-none focus:border-sky-400 focus:ring-4 focus:ring-sky-100 dark:border-white/10 dark:bg-slate-950 dark:text-white dark:placeholder:text-slate-500 dark:focus:border-blue-400 dark:focus:ring-blue-500/15"
                />
              </label>
              {shouldShowPreviewPanel ? (
                <button type="button" onClick={() => setPreviewOpen(true)} className="inline-flex h-[var(--control-height-lg)] items-center justify-center gap-2 rounded-[var(--radius-control)] border border-slate-200 bg-white px-4 text-sm font-black text-slate-700 dark:border-white/10 dark:bg-white/5 dark:text-slate-200 dark:hover:bg-white/10"><Eye className="h-4 w-4" />{ui.preview}</button>
              ) : null}
              <button type="button" disabled={!isDirty || saving} onClick={save} className="inline-flex h-[var(--control-height-lg)] items-center justify-center gap-2 rounded-[var(--radius-control)] bg-primary px-4 text-sm font-black text-[var(--primary-contrast)] disabled:opacity-45 dark:bg-gradient-to-r dark:from-blue-500 dark:to-violet-500 dark:text-[var(--primary-contrast)]">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{saving ? ui.saving : (language === "ar" && activeCategory === "storefront" ? "??? ??????? ??????" : ui.save)}</button>
            </div>
          </div>
        </header>

        <div className={`mt-5 grid min-w-0 max-w-full gap-5 ${settingsGridColumns}`}>
          <aside className="lg:sticky lg:top-32 lg:self-start">
            <nav className={`grid gap-2 rounded-[1.75rem] p-2 sm:grid-cols-2 lg:grid-cols-1 ${shellCard}`}>
              {settingsCategories.map((category) => {
                const Icon = iconMap[category.key] || Settings2;
                const active = category.key === activeCategory;
                return (
                  <button key={category.key} type="button" onClick={() => switchCategory(category.key)} className={`group flex items-center gap-3 rounded-[var(--radius-control)] border p-3 text-start transition ${active ? "border-slate-950 bg-primary text-[var(--primary-contrast)] shadow-lg shadow-slate-950/10 dark:border-blue-400/35 dark:bg-gradient-to-br dark:from-blue-500/22 dark:to-violet-500/20 dark:text-[var(--primary-contrast)] dark:shadow-[0_18px_44px_rgba(59,130,246,0.16)]" : "border-transparent text-slate-600 hover:border-slate-200 hover:bg-slate-50 dark:text-slate-300 dark:hover:border-white/10 dark:hover:bg-white/5"}`}>
                    <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl transition ${active ? "bg-white text-slate-950 dark:bg-white/12 dark:text-white" : "bg-slate-100 text-slate-500 group-hover:bg-white dark:bg-slate-900 dark:text-slate-400 dark:group-hover:bg-white/10 dark:group-hover:text-slate-200"}`}><Icon className="h-5 w-5" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-black">{localized(category.label, language)}</span>
                      <span className={`mt-0.5 block truncate text-xs ${active ? "text-white/62" : "text-slate-400 dark:text-slate-500"}`}>{navDescriptions[category.key] || localized(category.description, language)}</span>
                    </span>
                    <span className={`rounded-full px-2 py-1 text-xs font-black ${active ? "bg-white/10 text-white" : "bg-slate-100 text-slate-500 dark:bg-white/5 dark:text-slate-400"}`}>{(settingsByCategory[category.key] || []).length}</span>
                  </button>
                );
              })}
            </nav>
          </aside>

          <main className="min-w-0 max-w-full space-y-5 pb-28">
            <section className={`rounded-[1.75rem] p-5 ${shellCard}`}>
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div className="flex items-start gap-3">
                  <span className="grid h-14 w-14 place-items-center rounded-3xl bg-slate-950 text-white dark:bg-gradient-to-br dark:from-blue-500 dark:to-violet-500"><ActiveIcon className="h-6 w-6" /></span>
                  <div>
                    <h2 className={`m1-section-title ${headingText}`}>{localized(activeCategoryMeta?.label, language)}</h2>
                    <p className={`mt-1 max-w-2xl text-sm leading-6 ${bodyText}`}>{localized(activeCategoryMeta?.description, language)}</p>
                  </div>
                </div>
                {quickActions.length ? (
                  <div className="flex flex-wrap gap-2">
                    {quickActions.map(([label, Icon, action]) => (
                      <button key={label} type="button" onClick={action} className="inline-flex h-[var(--control-height-md)] items-center gap-2 rounded-[var(--radius-control)] border border-slate-200 bg-white px-3 text-xs font-black text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 dark:border-white/10 dark:bg-white/5 dark:text-slate-200 dark:hover:bg-white/10">
                        <Icon className="h-4 w-4" />
                        {label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              {normalizedSearch && searchMatches.length ? (
                <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
                  {searchMatches.slice(0, 10).map((match) => (
                    <a key={match.key} href={`#setting-${match.key}`} className="shrink-0 rounded-full border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-black text-sky-800 dark:border-blue-400/30 dark:bg-blue-500/15 dark:text-blue-100">{ui.searchResult}: {localized(match.label, language)}</a>
                  ))}
                </div>
              ) : null}
            </section>

            {error ? (
              <RetryCard ui={ui} error={error} onRetry={loadSettings} />
            ) : loading ? <SkeletonGrid /> : activeCategory === "general" ? (
              <div className="grid gap-5">
                <SiteSettingsCard
                  ui={ui}
                  companyName={normalizedSiteSettings.company_name}
                  companyLogoUrl={normalizedSiteSettings.company_logo_url}
                  faviconUrl={normalizedSiteSettings.favicon_url}
                  companyNameFallback={siteBrandName}
                  loading={siteSettingsLoading}
                  saving={siteSettingsSaving}
                  error={siteSettingsError}
                  dirty={siteSettingsDirty}
                  onChange={updateSiteSetting}
                  onSave={saveSiteSettings}
                />
                {sections.length ? (
                  <div className="grid gap-5">
                    {sections.map((section) => (
                      <section key={section.title} className={`rounded-[1.75rem] p-5 ${shellCard}`}>
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <h2 className={`m1-section-title ${headingText}`}>{section.title}</h2>
                        </div>
                        <div className="mt-4 grid gap-4 2xl:grid-cols-2">{section.settings.map((item) => renderField(item))}</div>
                      </section>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : activeCategory === "storefront" ? (
              <StorefrontSettings
                ui={ui}
                setting={setting}
                value={value}
                hero={hero}
                featuredCollections={featuredCollections}
                collectionDraft={collectionDraft}
                setCollectionDraft={setCollectionDraft}
                updateValue={updateValue}
                updateHero={updateHero}
                renderInput={renderInput}
                renderField={renderField}
              />
            ) : activeCategory === "shipping" ? (
              <ShippingSettings
                setting={setting}
                value={value}
                language={language}
                updateValue={updateValue}
                renderField={renderField}
              />
            ) : sections.length ? (
              <div className="grid gap-5">
                {sections.map((section) => (
                  <section key={section.title} className={`rounded-[1.75rem] p-5 ${shellCard}`}>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <h2 className={`m1-section-title ${headingText}`}>{section.title}</h2>
                      {activeCategory === "barcode_printing" && section.settings.some((item) => BARCODE_PRINT_SETTING_KEYS.includes(item.key)) ? (
                        <button
                          type="button"
                          onClick={resetBarcodePrintDefaults}
                          className="inline-flex h-[var(--control-height-md)] items-center justify-center gap-2 rounded-[var(--radius-control)] border border-slate-200 bg-white px-4 text-sm font-black text-slate-700 transition hover:bg-slate-50 dark:border-white/10 dark:bg-white/5 dark:text-slate-200 dark:hover:bg-white/10"
                        >
                          <RefreshCw className="h-4 w-4" />
                          {language === "ar" ? "إعادة الافتراضي" : "Reset defaults"}
                        </button>
                      ) : null}
                    </div>
                    <div className="mt-4 grid gap-4 2xl:grid-cols-2">{section.settings.map((item) => renderField(item))}</div>
                  </section>
                ))}
              </div>
            ) : (
              <div className={`rounded-[1.75rem] p-10 text-center text-sm font-black ${shellCard} ${bodyText}`}>{ui.empty}</div>
            )}

          </main>

          {shouldShowPreviewPanel ? (
            <aside className="hidden xl:block xl:sticky xl:top-32 xl:self-start">
              <PreviewPanel storeName={storeName} storeUrl={storeUrl} logoUrl={logoUrl} hero={hero} />
            </aside>
          ) : null}
        </div>
      </div>

      {shouldShowPreviewPanel && previewOpen ? (
        <PreviewDrawer ui={ui} onClose={() => setPreviewOpen(false)}>
          <PreviewPanel storeName={storeName} storeUrl={storeUrl} logoUrl={logoUrl} hero={hero} />
        </PreviewDrawer>
      ) : null}

      {isDirty ? (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 px-3 py-3 shadow-[0_-18px_48px_rgba(15,23,42,0.16)] backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/95 dark:shadow-[0_-18px_48px_rgba(0,0,0,0.45)]">
          <div className="mx-auto flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2 text-sm font-black text-slate-800 dark:text-white"><AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-300" />{dirtyCount} {ui.unsaved}</div>
            <div className="grid grid-cols-2 gap-2 sm:flex">
              <button type="button" onClick={discard} disabled={saving} className="inline-flex h-[var(--control-height-lg)] items-center justify-center gap-2 rounded-[var(--radius-control)] border border-slate-200 bg-white px-4 text-sm font-black text-slate-700 dark:border-white/10 dark:bg-white/5 dark:text-slate-200"><Undo2 className="h-4 w-4" />{ui.discard}</button>
              <button type="button" onClick={save} disabled={saving} className="inline-flex h-[var(--control-height-lg)] items-center justify-center gap-2 rounded-[var(--radius-control)] bg-primary px-4 text-sm font-black text-[var(--primary-contrast)] dark:bg-gradient-to-r dark:from-blue-500 dark:to-violet-500">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{saving ? ui.saving : (language === "ar" && activeCategory === "storefront" ? "??? ??????? ??????" : ui.save)}</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const MAX_BRANDING_IMAGE_BYTES = 5 * 1024 * 1024;

function BrandingUploadField({ title, value, onChange, helper, clearLabel, accept = "image/png,image/jpeg,image/webp" }) {
  const { t } = useTranslation();
  const [failed, setFailed] = useState(false);
  const [uploading, setUploading] = useState(false);
  const safeValue = String(value || "").trim();
  const previewUrl = resolveProductImageUrl(safeValue);

  useEffect(() => {
    setFailed(false);
  }, [safeValue]);

  const handleFileUpload = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/i.test(file.type || "")) {
      toast.error(t("settings.toasts.imageTypeOnly"));
      return;
    }
    if (file.size > MAX_BRANDING_IMAGE_BYTES) {
      toast.error(t("settings.toasts.imageTooLarge"));
      return;
    }
    setUploading(true);
    try {
      const uploadedUrl = await uploadProductImageValue(file, { filename: file.name || `${title}.png` });
      onChange(uploadedUrl || "");
    } catch (error) {
      toast.error(error?.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  return (
    <label className={`block rounded-2xl p-4 ${fieldSurface}`}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className={`block text-sm font-black ${headingText}`}>{title}</span>
          <p className={`mt-1 text-xs leading-5 ${bodyText}`}>{helper}</p>
        </div>
        {safeValue ? (
          <button
            type="button"
            onClick={() => onChange("")}
            className="inline-flex h-[var(--control-height-md)] shrink-0 items-center gap-1.5 rounded-[var(--radius-control)] border border-slate-200 bg-white px-3 text-xs font-black text-slate-600 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700 dark:border-white/10 dark:bg-white/5 dark:text-slate-300 dark:hover:border-rose-400/30 dark:hover:bg-rose-500/10 dark:hover:text-rose-200"
          >
            <X className="h-3.5 w-3.5" />
            {clearLabel}
          </button>
        ) : null}
      </div>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,5.5rem)_minmax(0,1fr)]">
        <div className="grid aspect-square place-items-center overflow-hidden rounded-2xl border border-dashed border-slate-300 bg-slate-50 dark:border-white/15 dark:bg-slate-950">
          {previewUrl && !failed ? (
            <img src={previewUrl} alt="" onError={() => setFailed(true)} className="h-full w-full object-cover" />
          ) : (
            <div className="grid h-full w-full place-items-center p-3 text-center">
              <div>
                <Image className="mx-auto h-6 w-6 text-slate-300 dark:text-slate-600" />
                <div className={`mt-2 text-[11px] font-black ${mutedText}`}>{safeValue ? clearLabel : "Preview"}</div>
              </div>
            </div>
          )}
        </div>
        <div className="min-w-0 space-y-2">
          <input
            value={safeValue}
            onChange={(event) => onChange(event.target.value)}
            placeholder="https://..."
            className="h-[var(--control-height-lg)] w-full rounded-[var(--radius-control)] border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-950 outline-none focus:border-sky-400 focus:ring-4 focus:ring-sky-100 dark:border-white/10 dark:bg-slate-950 dark:text-white dark:placeholder:text-slate-500 dark:focus:border-blue-400 dark:focus:ring-blue-500/15"
          />
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-[var(--radius-card)] border border-slate-200 bg-white px-3 text-xs font-black text-slate-700 transition hover:bg-slate-50 dark:border-white/10 dark:bg-white/5 dark:text-slate-200 dark:hover:bg-white/10">
              <Upload className="h-3.5 w-3.5" />
              {uploading ? "Uploading..." : "Upload image"}
              <input type="file" accept={accept} className="hidden" onChange={handleFileUpload} />
            </label>
            {/* The stored path is one unbreakable token; it must be allowed to shrink and clip. */}
            <span className={`min-w-0 truncate text-xs ${mutedText}`}>{safeValue || "Paste image URL or upload a file"}</span>
          </div>
        </div>
      </div>
    </label>
  );
}

function SiteSettingsCard({ ui, companyName, companyLogoUrl, faviconUrl, companyNameFallback, loading, saving, error, dirty, onChange, onSave }) {
  const { t } = useTranslation();
  const displayName = String(companyName || "").trim() || companyNameFallback || "MONE";
  return (
    <section className={`rounded-[1.75rem] p-5 ${shellCard}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className={`m1-section-title ${headingText}`}>{t("settings.site.title")}</h2>
          <p className={`mt-1 text-sm leading-6 ${bodyText}`}>{t("settings.site.subtitle")}</p>
        </div>
        <button
          type="button"
          onClick={onSave}
          disabled={!dirty || saving || loading}
          className="inline-flex h-[var(--control-height-lg)] items-center gap-2 rounded-[var(--radius-control)] bg-primary px-4 text-sm font-black text-[var(--primary-contrast)] disabled:opacity-45 dark:bg-gradient-to-r dark:from-blue-500 dark:to-violet-500"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {saving ? ui.saving : ui.save}
        </button>
      </div>
      {error ? <div className="mt-4 rounded-2xl border border-rose-300/20 bg-rose-400/10 p-3 text-sm font-bold text-rose-100">{error}</div> : null}
      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <div className={`rounded-2xl p-4 ${fieldSurface}`}>
          <div className="flex items-start gap-3">
            <LogoAvatar src={companyLogoUrl} name={displayName} size="h-16 w-16" />
            <div className="min-w-0">
              <div className={`text-[11px] font-black uppercase tracking-[0.16em] ${mutedText}`}>{t("settings.site.livePreview")}</div>
              <h3 className={`m1-section-title mt-1 truncate ${headingText}`}>{displayName}</h3>
              <p className={`mt-1 text-sm ${bodyText}`}>{companyLogoUrl || faviconUrl ? "Branding assets are active." : "Fallback initials will be used until you upload a logo."}</p>
            </div>
          </div>
          <div className="mt-4 grid gap-4">
            <label className={`block rounded-2xl p-4 ${fieldSurface}`}>
              <span className={`mb-2 block text-sm font-black ${headingText}`}>{t("settings.site.companyName")}</span>
              <input
                value={companyName}
                onChange={(event) => onChange("company_name", event.target.value)}
                placeholder="MONE"
                className="h-[var(--control-height-lg)] w-full rounded-[var(--radius-control)] border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-950 outline-none focus:border-sky-400 focus:ring-4 focus:ring-sky-100 dark:border-white/10 dark:bg-slate-950 dark:text-white dark:placeholder:text-slate-500 dark:focus:border-blue-400 dark:focus:ring-blue-500/15"
              />
            </label>
            <div className="grid gap-4 md:grid-cols-2">
              <BrandingUploadField
                title={t("settings.site.companyLogo")}
                value={companyLogoUrl}
                onChange={(next) => onChange("company_logo_url", next)}
                helper="PNG, JPG, or WEBP. Uses the existing upload flow."
                clearLabel="Clear image"
              />
              <BrandingUploadField
                title={t("settings.site.favicon")}
                value={faviconUrl}
                onChange={(next) => onChange("favicon_url", next)}
                helper="Optional browser favicon. Keep it square."
                clearLabel="Clear image"
              />
            </div>
          </div>
        </div>
        <div className={`rounded-2xl p-4 ${fieldSurface}`}>
          <div className={`text-[11px] font-black uppercase tracking-[0.16em] ${mutedText}`}>{t("settings.site.fallbacks")}</div>
          <div className="mt-3 space-y-3 text-sm leading-6">
            <div className="rounded-[var(--radius-card)] border border-slate-200 bg-white p-3 dark:border-white/10 dark:bg-slate-950">
              <div className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">{t("settings.site.nameFallback")}</div>
              <div className="mt-1 font-bold text-slate-950 dark:text-white">MONE</div>
            </div>
            <div className="rounded-[var(--radius-card)] border border-slate-200 bg-white p-3 dark:border-white/10 dark:bg-slate-950">
              <div className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">{t("settings.site.logoFallback")}</div>
              <div className="mt-1 font-bold text-slate-950 dark:text-white">{t("settings.site.initialsPlaceholder")}</div>
            </div>
            <div className="rounded-[var(--radius-card)] border border-slate-200 bg-white p-3 dark:border-white/10 dark:bg-slate-950">
              <div className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">{t("settings.site.safety")}</div>
              <div className="mt-1 text-slate-600 dark:text-slate-300">{t("settings.site.safetyHint")}</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function StorefrontSettings(props) {
  const { t } = useTranslation();
  const { ui, setting, value, hero, featuredCollections, collectionDraft, setCollectionDraft, updateValue, updateHero, renderInput, renderField } = props;
  const publicUrl = value("storefront.public_url");
  const hasHeroPreview = Boolean(hero.imageUrl || hero.title || hero.subtitle || hero.buttonText);
  const hasSeoPreview = Boolean(publicUrl || value("storefront.seo_title") || value("storefront.store_name") || value("storefront.seo_description"));
  return (
    <div className="grid gap-5">
      <VisualSection icon={Store} title={t("settings.storefront.storeIdentity")} description="Name, URL, logo, and browser identity for the public store.">
        <div className="grid gap-4 xl:grid-cols-2">
          {renderField(setting("storefront.enabled"), true)}
          {renderField(setting("storefront.store_name"), true)}
          {renderField(setting("storefront.store_tagline"), true)}
          {renderField(setting("storefront.public_url"), true)}
          <VisualUpload title={t("settings.storefront.logoUpload")} value={value("storefront.store_logo_url")} onChange={(next) => updateValue("storefront.store_logo_url", next)} helper={ui.uploadHelper} placeholder={ui.pasteImageUrl} clearLabel={ui.clearImage} fallbackLabel={ui.imageUnavailable} />
          <VisualUpload title={t("settings.storefront.faviconUpload")} value={value("storefront.favicon_url")} onChange={(next) => updateValue("storefront.favicon_url", next)} helper={ui.uploadHelper} placeholder={ui.pasteImageUrl} clearLabel={ui.clearImage} fallbackLabel={ui.imageUnavailable} />
        </div>
      </VisualSection>

      <VisualSection icon={Phone} title={t("settings.storefront.contactSocial")} description={t("settings.storefront.contactSocialHint")}>
        <div className="grid gap-4 xl:grid-cols-2">
          {renderField(setting("storefront.contact_phone"), true)}
          {renderField(setting("storefront.whatsapp_phone"), true)}
          {renderField(setting("storefront.whatsapp_url"), true)}
          {renderField(setting("storefront.instagram_username"), true)}
          {renderField(setting("storefront.instagram_url"), true)}
          {renderField(setting("storefront.facebook_page_name"), true)}
          {renderField(setting("storefront.facebook_url"), true)}
          {renderField(setting("storefront.map_url"), true)}
          {renderField(setting("storefront.address"), true)}
          {renderField(setting("storefront.working_hours"), true)}
        </div>
      </VisualSection>

      <VisualSection icon={Image} title={t("settings.storefront.homepage")} description={t("settings.storefront.homepageHint")}>
        <div className="grid gap-4 xl:grid-cols-2">
          <PremiumInput label={t("settings.storefront.heroTitle")} value={hero.title || ""} onChange={(next) => updateHero({ title: next })} />
          <PremiumInput label={t("settings.storefront.heroSubtitle")} value={hero.subtitle || ""} onChange={(next) => updateHero({ subtitle: next })} />
          <PremiumInput label={t("settings.storefront.heroButtonText")} value={hero.buttonText || ""} onChange={(next) => updateHero({ buttonText: next })} />
          <PremiumInput label={t("settings.storefront.heroButtonUrl")} value={hero.buttonUrl || ""} onChange={(next) => updateHero({ buttonUrl: next })} />
          <VisualUpload title={t("settings.storefront.heroImageUpload")} value={hero.imageUrl || ""} onChange={(next) => updateHero({ imageUrl: next })} helper={ui.uploadHelper} placeholder={ui.pasteImageUrl} clearLabel={ui.clearImage} fallbackLabel={ui.imageUnavailable} wide />
        </div>
        {hasHeroPreview ? (
          <div className="mt-4 overflow-hidden rounded-3xl border border-slate-200 bg-slate-950 text-white dark:border-white/10">
            <HeroBackdrop imageUrl={hero.imageUrl} className="min-h-56 p-6">
              <div>
                <div className="text-xs font-black uppercase tracking-[0.18em] text-white/50">{t("settings.storefront.livePreviewHome")}</div>
                {hero.title ? <h3 className="m1-section-title mt-2">{hero.title}</h3> : null}
                {hero.subtitle ? <p className="mt-2 max-w-xl text-sm text-white/70">{hero.subtitle}</p> : null}
                {hero.buttonText ? <button type="button" className="mt-4 rounded-full bg-white px-4 py-2 text-sm font-black text-slate-950">{hero.buttonText}</button> : null}
              </div>
            </HeroBackdrop>
          </div>
        ) : null}
      </VisualSection>

      <VisualSection icon={Package} title={t("settings.storefront.catalog")} description={t("settings.storefront.catalogHint")}>
        <div className="grid gap-4 xl:grid-cols-2">
          {renderField(setting("storefront.product_sorting_default"), true)}
          {renderField(setting("storefront.show_sold_out_products"), true)}
          {renderField(setting("storefront.show_low_stock_badge"), true)}
          {renderField(setting("storefront.show_product_views"), true)}
          {renderField(setting("storefront.enable_wishlist"), true)}
          {renderField(setting("storefront.enable_product_sharing"), true)}
          {renderField(setting("storefront.enable_size_guide"), true)}
          <article id="setting-storefront.featured_collections" className={`rounded-2xl p-4 xl:col-span-2 ${fieldSurface}`}>
            <h3 className={`m1-section-title ${headingText}`}>{t("settings.storefront.featuredCollections")}</h3>
            <p className={`mt-1 text-xs ${bodyText}`}>Searchable collection selector replacement for the old JSON list.</p>
            <div className="mt-3">
              <CollectionSelector collections={featuredCollections} draft={collectionDraft} setDraft={setCollectionDraft} onChange={(next) => updateValue("storefront.featured_collections", next)} hint={ui.collectionHint} />
            </div>
          </article>
        </div>
      </VisualSection>

      <VisualSection icon={Globe2} title="SEO" description={t("settings.storefront.seoHint")}>
        <div className="grid gap-4 xl:grid-cols-2">
          {renderField(setting("storefront.seo_title"), true)}
          {renderField(setting("storefront.seo_description"), true)}
          <VisualUpload title={t("settings.storefront.ogImageUpload")} value={value("storefront.open_graph_image_url")} onChange={(next) => updateValue("storefront.open_graph_image_url", next)} helper={ui.uploadHelper} placeholder={ui.pasteImageUrl} clearLabel={ui.clearImage} fallbackLabel={ui.imageUnavailable} wide />
        </div>
        {hasSeoPreview ? (
          <div className={`mt-4 rounded-2xl p-4 ${fieldSurface}`}>
            {publicUrl ? <div className="text-xs text-emerald-700">{publicUrl}</div> : null}
            {value("storefront.seo_title") || value("storefront.store_name") ? <div className="mt-1 text-lg font-medium text-blue-700">{value("storefront.seo_title") || value("storefront.store_name")}</div> : null}
            {value("storefront.seo_description") ? <p className={`mt-1 max-w-2xl text-sm ${bodyText}`}>{value("storefront.seo_description")}</p> : null}
          </div>
        ) : null}
      </VisualSection>

      <VisualSection icon={CreditCard} title={t("settings.payments.title")} description={t("settings.payments.subtitle")}>
        <div className="grid gap-4 xl:grid-cols-2">
          <article className={`rounded-2xl p-4 ${fieldSurface}`}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className={`m1-section-title ${headingText}`}>{t("settings.payments.vodafoneWallet")}</h3>
                <p className={`mt-1 text-xs leading-5 ${bodyText}`}>{t("settings.payments.vodafoneHint")}</p>
              </div>
              <TogglePill label={t("settings.payments.enabled")} checked={Boolean(value("storefront.payment_methods.vodafone_cash_enabled"))} onChange={(checked) => updateValue("storefront.payment_methods.vodafone_cash_enabled", checked)} />
            </div>
            <div className="mt-4 grid gap-3">
              <PremiumInput label={t("settings.payments.methodName")} value={value("storefront.payment_methods.vodafone_cash_display_name")} onChange={(next) => updateValue("storefront.payment_methods.vodafone_cash_display_name", next)} />
              <PremiumInput label={t("settings.payments.walletNumber")} value={value("storefront.payment_methods.vodafone_cash_number")} onChange={(next) => updateValue("storefront.payment_methods.vodafone_cash_number", next)} />
              <label className={`block rounded-2xl p-4 ${fieldSurface}`}>
                <span className={`mb-2 block text-sm font-black ${headingText}`}>{t("settings.payments.helperText")}</span>
                <textarea rows={3} value={value("storefront.payment_methods.vodafone_cash_helper_text")} onChange={(event) => updateValue("storefront.payment_methods.vodafone_cash_helper_text", event.target.value)} className="w-full rounded-[var(--radius-control)] border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-950 outline-none focus:border-sky-400 focus:ring-4 focus:ring-sky-100 dark:border-white/10 dark:bg-slate-950 dark:text-white dark:placeholder:text-slate-500 dark:focus:border-blue-400 dark:focus:ring-blue-500/15" placeholder={t("settings.payments.helperPlaceholder")} />
              </label>
              <VisualUpload title={t("settings.payments.logoUrl")} value={value("storefront.payment_methods.vodafone_cash_logo_url")} onChange={(next) => updateValue("storefront.payment_methods.vodafone_cash_logo_url", next)} helper={ui.uploadHelper} placeholder={ui.pasteImageUrl} clearLabel={ui.clearImage} fallbackLabel={ui.imageUnavailable} />
            </div>
          </article>

                    <article className={`rounded-2xl p-4 ${fieldSurface}`}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className={`m1-section-title ${headingText}`}>InstaPay</h3>
                <p className={`mt-1 text-xs leading-5 ${bodyText}`}>{t("settings.payments.instapayHint")}</p>
              </div>
              <TogglePill label={t("settings.payments.enabled")} checked={Boolean(value("storefront.payment_methods.instapay_enabled"))} onChange={(checked) => updateValue("storefront.payment_methods.instapay_enabled", checked)} />
            </div>
            <div className={`mt-4 rounded-2xl border p-4 ${fieldSurface}`}>
              <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                <div className="min-w-0">
                  <label className={`block text-sm font-black ${headingText}`}>{t("settings.payments.instapayLink")}</label>
                  <p className={`mt-1 text-xs leading-5 ${bodyText}`}>{t("settings.payments.instapayLinkHint")}</p>
                </div>
                <button
                  type="button"
                  disabled={!(String(value("storefront.payment_methods.instapay.payment_url") || "").trim()) || !isHttpOrHttpsUrl(String(value("storefront.payment_methods.instapay.payment_url") || "").trim())}
                  onClick={() => {
                    const paymentUrl = String(value("storefront.payment_methods.instapay.payment_url") || "").trim();
                    if (!paymentUrl || !isHttpOrHttpsUrl(paymentUrl)) return;
                    window.open(paymentUrl, "_blank", "noopener,noreferrer");
                  }}
                  className="inline-flex h-[var(--control-height-md)] shrink-0 items-center gap-2 rounded-full border border-[#a78bfa]/18 bg-[#7c3aed] px-4 text-xs font-black text-white transition hover:-translate-y-0.5 hover:bg-[#6d28d9] disabled:cursor-not-allowed disabled:translate-y-0 disabled:border-slate-300/40 disabled:bg-slate-300 disabled:text-slate-500 dark:disabled:border-white/10 dark:disabled:bg-white/10 dark:disabled:text-white/35"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  فتح رابط الدفع
                </button>
              </div>
              <div className="mt-3">
                <input
                  value={String(value("storefront.payment_methods.instapay.payment_url") || "").trim()}
                  onChange={(event) => updateValue("storefront.payment_methods.instapay.payment_url", event.target.value)}
                  placeholder="https://ipn.eg/S/yourname/instapay/xxxxx"
                  className="h-[var(--control-height-lg)] w-full rounded-[var(--radius-control)] border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-sky-400 focus:ring-4 focus:ring-sky-100 dark:border-white/10 dark:bg-slate-950 dark:text-white dark:placeholder:text-slate-500 dark:focus:border-blue-400 dark:focus:ring-blue-500/15"
                />
                <div className={`mt-2 text-xs font-medium ${isHttpOrHttpsUrl(String(value("storefront.payment_methods.instapay.payment_url") || "").trim()) || !String(value("storefront.payment_methods.instapay.payment_url") || "").trim() ? bodyText : "text-rose-600 dark:text-rose-300"}`}>
                  {isHttpOrHttpsUrl(String(value("storefront.payment_methods.instapay.payment_url") || "").trim()) || !String(value("storefront.payment_methods.instapay.payment_url") || "").trim()
                    ? (!String(value("storefront.payment_methods.instapay.payment_url") || "").trim() && String(value("storefront.payment_methods.instapay_handle") || "").trim()
                      ? "يستخدم الحساب القديم كبديل عند الحاجة."
                      : "اضغط على الزر للتحويل مباشرة، ثم ارفع إيصال التحويل لتأكيد الطلب.")
                    : "رابط InstaPay غير صحيح. يجب أن يبدأ بـ https:// أو http://"}
                </div>
              </div>
            </div>
            <details className="mt-3 rounded-2xl border border-dashed border-slate-200 p-4 dark:border-white/10">
              <summary className={`cursor-pointer select-none text-sm font-black ${headingText}`}>{t("settings.payments.legacyTitle")}</summary>
              <p className={`mt-1 text-xs leading-5 ${bodyText}`}>{t("settings.payments.legacyHint")}</p>
              <div className="mt-3">
                <PremiumInput label={t("settings.payments.legacyHandle")} value={String(value("storefront.payment_methods.instapay_handle") || "").trim()} onChange={(next) => updateValue("storefront.payment_methods.instapay_handle", next)} />
              </div>
            </details>
            <div className="mt-3 grid gap-3">
              <PremiumInput label={t("settings.payments.methodName")} value={value("storefront.payment_methods.instapay_display_name")} onChange={(next) => updateValue("storefront.payment_methods.instapay_display_name", next)} />
              <label className={`block rounded-2xl p-4 ${fieldSurface}`}>
                <span className={`mb-2 block text-sm font-black ${headingText}`}>{t("settings.payments.helperText")}</span>
                <textarea rows={3} value={value("storefront.payment_methods.instapay_helper_text")} onChange={(event) => updateValue("storefront.payment_methods.instapay_helper_text", event.target.value)} className="w-full rounded-[var(--radius-control)] border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-950 outline-none focus:border-sky-400 focus:ring-4 focus:ring-sky-100 dark:border-white/10 dark:bg-slate-950 dark:text-white dark:placeholder:text-slate-500 dark:focus:border-blue-400 dark:focus:ring-blue-500/15" placeholder={t("settings.payments.helperPlaceholder")} />
              </label>
              <VisualUpload title={t("settings.payments.logoUrl")} value={value("storefront.payment_methods.instapay_logo_url")} onChange={(next) => updateValue("storefront.payment_methods.instapay_logo_url", next)} helper={ui.uploadHelper} placeholder={ui.pasteImageUrl} clearLabel={ui.clearImage} fallbackLabel={ui.imageUnavailable} />
            </div>
          </article>

          <article className={`rounded-2xl p-4 xl:col-span-2 ${fieldSurface}`}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className={`m1-section-title ${headingText}`}>{t("settings.payments.shippingFeeTitle")}</h3>
                <p className={`mt-1 text-xs leading-5 ${bodyText}`}>{t("settings.payments.shippingFeeHint")}</p>
              </div>
              <TogglePill label={t("settings.payments.enableShippingFee")} checked={Boolean(value("storefront.payment_methods.shipping_confirmation_enabled"))} onChange={(checked) => updateValue("storefront.payment_methods.shipping_confirmation_enabled", checked)} />
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <label className={`block rounded-2xl p-4 ${fieldSurface}`}>
                <span className={`mb-2 block text-sm font-black ${headingText}`}>{t("settings.payments.feeText")}</span>
                <input value={value("storefront.payment_methods.shipping_confirmation_label")} onChange={(event) => updateValue("storefront.payment_methods.shipping_confirmation_label", event.target.value)} className="h-[var(--control-height-lg)] w-full rounded-[var(--radius-control)] border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-950 outline-none focus:border-sky-400 focus:ring-4 focus:ring-sky-100 dark:border-white/10 dark:bg-slate-950 dark:text-white dark:focus:border-blue-400 dark:focus:ring-blue-500/15" />
              </label>
              <label className={`block rounded-2xl p-4 ${fieldSurface}`}>
                <span className={`mb-2 block text-sm font-black ${headingText}`}>{t("settings.payments.feeValue")}</span>
                <input type="number" min="0" value={Number(value("storefront.payment_methods.shipping_confirmation_amount") || 0)} onChange={(event) => updateValue("storefront.payment_methods.shipping_confirmation_amount", Number(event.target.value))} className="h-[var(--control-height-lg)] w-full rounded-[var(--radius-control)] border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-950 outline-none focus:border-sky-400 focus:ring-4 focus:ring-sky-100 dark:border-white/10 dark:bg-slate-950 dark:text-white dark:focus:border-blue-400 dark:focus:ring-blue-500/15" />
              </label>
            </div>
          </article>
        </div>
      </VisualSection>

      <VisualSection icon={Layers3} title={t("settings.marketing.title")} description={t("settings.marketing.subtitle")}>
        <div className="grid gap-4 xl:grid-cols-2">
          {renderField(setting("storefront.meta_pixel_id"), true)}
          {renderField(setting("storefront.facebook_catalog_id"), true)}
          <PremiumInput label={t("settings.marketing.tiktokPixel")} value={value("storefront.tiktok_pixel_id")} onChange={(next) => updateValue("storefront.tiktok_pixel_id", next)} />
          <PremiumInput label={t("settings.marketing.googleAnalytics")} value={value("storefront.google_analytics_id")} onChange={(next) => updateValue("storefront.google_analytics_id", next)} />
        </div>
      </VisualSection>
    </div>
  );
}

function ShippingSettings({ setting, value, language, updateValue, renderField }) {
  const zones = useMemo(() => (Array.isArray(value("storefront.shipping_zones")) ? value("storefront.shipping_zones") : []).map(normalizeShippingZoneRow), [value]);
  const locations = useMemo(() => normalizeShippingLocations(value("storefront.shipping_locations")), [value]);
  const defaultPrice = Number(value("storefront.default_shipping_price") || 0);
  const defaultProvider = normalizeProviderKey(value("orders.shipping_provider"));
  const [activeTab, setActiveTab] = useState("overview");
  const activeZones = zones.filter((zone) => zone.active).length;
  const proofZones = zones.filter((zone) => zone.requires_shipping_proof).length;
  const freeShippingRules = zones.filter((zone) => Number(zone.free_shipping_threshold || 0) > 0).length;
  const copy = { ...shippingUi.en, ...(shippingUi[language] || {}) };
  const handlingMinDays = value(SHIPPING_HANDLING_MIN_KEY);
  const handlingMaxDays = value(SHIPPING_HANDLING_MAX_KEY);
  const handlingError = validateGlobalHandlingTime(handlingMinDays, handlingMaxDays, language);
  const tabs = [
    ["overview", copy.tabOverview, Truck],
    ["locations", copy.tabLocations, MapPin],
    ["zones", copy.tabZones, Layers3],
    ["free", copy.tabFree, Package],
    ["providers", copy.tabProviders, ShieldCheck],
    ["advanced", copy.tabAdvanced, SlidersHorizontal],
  ];

  return (
    <div className="grid gap-6">
      <div className="grid gap-3 lg:grid-cols-4">
        <SummaryTile icon={Truck} label={copy.defaultPrice} value={`${defaultPrice.toLocaleString()} EGP`} />
        <SummaryTile icon={Check} label={copy.activeZones} value={activeZones} />
        <SummaryTile icon={ShieldCheck} label={copy.proofZones} value={proofZones} />
        <SummaryTile icon={Package} label={copy.freeRules} value={freeShippingRules} />
      </div>

      <div className={`flex gap-2 overflow-x-auto rounded-[1.75rem] p-2 ${shellCard}`}>
        {tabs.map(([id, label, Icon]) => (
          <button
            key={id}
            type="button"
            onClick={() => setActiveTab(id)}
            className={`inline-flex h-[var(--control-height-lg)] shrink-0 items-center gap-2 rounded-[var(--radius-control)] px-4 text-sm font-black transition ${activeTab === id ? "bg-primary text-[var(--primary-contrast)] dark:bg-white dark:text-[var(--primary-contrast)]" : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/8"}`}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {activeTab === "overview" ? (
        <div className="grid gap-5">
          <section
            data-testid="shipping-handling-settings"
            className={`rounded-[1.75rem] border border-amber-300/40 bg-gradient-to-br from-amber-50 to-white p-5 shadow-sm dark:border-amber-300/20 dark:from-amber-400/10 dark:to-slate-950 sm:p-6`}
          >
            <div className="flex items-start gap-3">
              <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-amber-400/20 text-amber-700 dark:text-amber-300">
                <Clock3 className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <h2 className={`m1-section-title ${headingText}`}>
                  {language === "ar" ? "مدة تجهيز الطلب قبل التسليم لشركة الشحن" : "Order handling time before carrier handoff"}
                </h2>
                <p className={`mt-1 text-sm font-bold leading-6 ${bodyText}`}>
                  {language === "ar"
                    ? "المدة من تسجيل الطلب حتى تسليمه لشركة الشحن، ولا تشمل مدة النقل للعميل."
                    : "The time from order registration until handoff to the shipping company; it does not include transit time to the customer."}
                </p>
              </div>
            </div>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className={`grid gap-2 rounded-2xl p-4 ${fieldSurface}`}>
                <span className={`text-sm font-black ${headingText}`}>
                  {language === "ar" ? "الحد الأدنى لمدة التجهيز بالأيام" : "Minimum handling days"}
                </span>
                <input
                  data-testid="shipping-handling-min-days"
                  type="number"
                  min="0"
                  step="1"
                  inputMode="numeric"
                  value={handlingMinDays}
                  onChange={(event) => updateValue(SHIPPING_HANDLING_MIN_KEY, event.target.value)}
                  className={`${inputClass} h-[var(--control-height-lg)] rounded-[var(--radius-control)] text-center text-base font-black`}
                />
              </label>
              <label className={`grid gap-2 rounded-2xl p-4 ${fieldSurface}`}>
                <span className={`text-sm font-black ${headingText}`}>
                  {language === "ar" ? "الحد الأقصى لمدة التجهيز بالأيام" : "Maximum handling days"}
                </span>
                <input
                  data-testid="shipping-handling-max-days"
                  type="number"
                  min="0"
                  step="1"
                  inputMode="numeric"
                  value={handlingMaxDays}
                  onChange={(event) => updateValue(SHIPPING_HANDLING_MAX_KEY, event.target.value)}
                  className={`${inputClass} h-[var(--control-height-lg)] rounded-[var(--radius-control)] text-center text-base font-black`}
                />
              </label>
            </div>
            {handlingError ? (
              <p role="alert" className="mt-3 rounded-2xl border border-rose-300/50 bg-rose-50 px-4 py-3 text-sm font-black text-rose-700 dark:border-rose-300/20 dark:bg-rose-400/10 dark:text-rose-200">
                {handlingError}
              </p>
            ) : (
              <p className="mt-3 text-xs font-bold text-emerald-700 dark:text-emerald-300">
                {language === "ar" ? "تُطبّق هذه القيمة تلقائيًا على كل مناطق الشحن الفعالة ما لم يتم تفعيل مدة خاصة لمنطقة محددة." : "Applied automatically to every active shipping zone unless a zone override is enabled."}
              </p>
            )}
          </section>
          <VisualSection icon={Truck} title={copy.overviewTitle} description={copy.overviewDescription}>
            <div className="grid gap-4 xl:grid-cols-2">
              {renderField(setting("storefront.default_shipping_price"), true)}
            </div>
          </VisualSection>
          <ShippingQuickSetup zones={zones} defaultPrice={defaultPrice} copy={copy} onChange={(next) => updateValue("storefront.shipping_zones", next)} />
          <ShippingTemplates zones={zones} defaultPrice={defaultPrice} copy={copy} onChange={(next) => updateValue("storefront.shipping_zones", next)} />
          <ShippingRuleTester zones={zones} defaultPrice={defaultPrice} defaultProvider={defaultProvider} copy={copy} />
        </div>
      ) : null}

      {activeTab === "locations" ? (
        <VisualSection icon={MapPin} title={copy.locationsTitle} description={copy.locationsDescription}>
          <ShippingLocationsCatalog value={locations} language={language} onChange={(next) => updateValue("storefront.shipping_locations", next)} />
        </VisualSection>
      ) : null}

      {activeTab === "zones" ? (
        <VisualSection icon={Layers3} title={copy.zonesTitle} description={copy.zonesDescription}>
          <ShippingZonesEditor value={zones} locations={locations} language={language} defaultPrice={defaultPrice} onChange={(next) => updateValue("storefront.shipping_zones", next)} />
        </VisualSection>
      ) : null}

      {activeTab === "free" ? (
        <VisualSection icon={Package} title={copy.freeTitle} description={copy.freeDescription}>
          <ZonePolicyList zones={zones.filter((zone) => Number(zone.free_shipping_threshold || 0) > 0)} empty={copy.emptyFree} onChange={(next) => updateValue("storefront.shipping_zones", next)} allZones={zones} />
        </VisualSection>
      ) : null}

      {activeTab === "providers" ? (
        <div className="grid gap-5">
          <ShippingProvidersCenter
            copy={copy}
            defaultProvider={defaultProvider}
            onDefaultProviderChange={(next) => updateValue("orders.shipping_provider", next)}
          />
          <VisualSection icon={Package} title={copy.providerPolicyTitle} description={copy.providerPolicyDescription}>
            <div className="grid gap-4 xl:grid-cols-2">
              {renderField(setting("orders.bosta_allow_open_package"), true)}
            </div>
          </VisualSection>
        </div>
      ) : null}

      {activeTab === "advanced" ? (
        <VisualSection icon={SlidersHorizontal} title={copy.advancedTitle} description={copy.advancedDescription}>
          <div className="grid gap-4 xl:grid-cols-2">
            {renderField(setting("orders.shipping_provider"), true)}
            {renderField(setting("storefront.shipping_locations"), true)}
            {renderField(setting("storefront.shipping_zones"), true)}
          </div>
        </VisualSection>
      ) : null}
    </div>
  );
}

function SummaryTile({ icon: Icon, label, value }) {
  return (
    <MetricCard icon={Icon} label={label} value={value} />
  );
}

// `carriers` comes from the server catalogue so the picker can never offer a carrier the
// backend does not know, or miss one it does. The static list is the pre-fetch fallback
// and supplies the two non-carrier options the catalogue has no row for.
function ProviderBadgePicker({ value, onChange, carriers = [] }) {
  const { t } = useTranslation();
  const activeProvider = normalizeProviderKey(value);
  const localOptions = shippingProviderOptions.filter((provider) => ["manual", "in_store_delivery"].includes(provider.id));
  const options = carriers.length
    ? [...carriers.map((carrier) => ({ id: carrier.code, label: carrier.name })), ...localOptions]
    : shippingProviderOptions;
  return (
    <article className={`rounded-2xl p-4 ${fieldSurface}`}>
      <h3 className={`m1-section-title ${headingText}`}>{t("settings.shipping.defaultProvider")}</h3>
      <p className={`mt-1 text-xs leading-5 ${bodyText}`}>{t("settings.shipping.defaultProviderHint")}</p>
      <select value={activeProvider} onChange={(event) => onChange(event.target.value)} className={`${inputClass} mt-4 max-w-sm`}>
        {options.map((provider) => (
          <option key={provider.id} value={provider.id}>{provider.label}</option>
        ))}
      </select>
    </article>
  );
}

function ProviderCredentialsCard({ provider, draft, onChange, onSave, saving, copy, t }) {
  // Per-carrier, because one shared placeholder read "Bosta API key" on every card.
  const secretPlaceholder = t("settings.shipping.apiKeyPlaceholderFor", { carrier: provider.name });
  return (
    <article className={`rounded-2xl p-4 ${fieldSurface}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className={`m1-section-title ${headingText}`}>{provider.name}</h3>
          <p className={`mt-1 text-xs leading-5 ${bodyText}`}>
            {provider.integrated
              ? copy.providerIntegrated
              : copy.providerNotWired}
          </p>
        </div>
        <button
          type="button"
          onClick={() => onChange({ enabled: !draft.enabled })}
          className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-black ${draft.enabled ? "bg-primary text-[var(--primary-contrast)]" : "bg-slate-200 text-slate-700 dark:bg-white/10 dark:text-slate-200"}`}
        >
          {draft.enabled ? copy.enabled : copy.disabled}
        </button>
      </div>

      {provider.integrated ? null : (
        <p className="mt-3 rounded-xl border border-amber-300/40 bg-amber-50 px-3 py-2 text-[11px] font-black leading-5 text-amber-800 dark:border-amber-300/20 dark:bg-amber-400/10 dark:text-amber-200">
          {copy.providerPlaceholderWarning}
        </p>
      )}

      <div className="mt-4 grid gap-3">
        <label>
          <span className={`mb-2 block text-xs font-black uppercase ${mutedText}`}>{t("settings.shipping.baseUrl")}</span>
          <input value={draft.api_base_url} onChange={(event) => onChange({ api_base_url: event.target.value })} className={inputClass} />
        </label>
        <label>
          <span className={`mb-2 block text-xs font-black uppercase ${mutedText}`}>{t("settings.shipping.apiKey")}</span>
          <input type="password" value={draft.api_key} onChange={(event) => onChange({ api_key: event.target.value })} className={inputClass} placeholder={secretPlaceholder} />
        </label>
        {provider.supports_webhook ? (
          <label>
            <span className={`mb-2 block text-xs font-black uppercase ${mutedText}`}>{copy.webhookSecret}</span>
            <input type="password" value={draft.webhook_secret} onChange={(event) => onChange({ webhook_secret: event.target.value })} className={inputClass} placeholder={secretPlaceholder} />
            <span className={`mt-2 block text-[11px] leading-5 ${bodyText}`}>{copy.webhookSecretHint}</span>
          </label>
        ) : null}
        <button
          type="button"
          disabled={saving}
          onClick={onSave}
          className="inline-flex h-[var(--control-height-lg)] w-fit items-center gap-2 rounded-[var(--radius-control)] bg-primary px-4 text-sm font-black text-[var(--primary-contrast)] disabled:opacity-60 dark:bg-white dark:text-[var(--primary-contrast)]"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {copy.saveProvider}
        </button>
      </div>
    </article>
  );
}

// One place for every carrier: the credentials each one stores, plus Bosta's operational
// panels. Splitting these across two tabs is what let the same key be typed in two fields
// with different precedence, so the tab that lost is the one that was silently ignored.
function ShippingProvidersCenter({ copy, defaultProvider, onDefaultProviderChange }) {
  const { t } = useTranslation();
  const [providers, setProviders] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [savingCode, setSavingCode] = useState("");
  const [status, setStatus] = useState(null);
  const [syncState, setSyncState] = useState({ loading: false, counts: null, error: "" });
  const [locations, setLocations] = useState([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);

  const loadProviders = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.get("/shipping/providers");
      const list = Array.isArray(data.providers) ? data.providers : [];
      setProviders(list);
      setDrafts(list.reduce((acc, provider) => {
        acc[provider.code] = {
          enabled: Boolean(provider.enabled),
          api_base_url: provider.api_base_url || "",
          // A stored secret never comes back from the API, so the mask stands in for it
          // and is stripped on save -- typing nothing must not wipe a working key.
          api_key: provider.has_api_key ? SECRET_PLACEHOLDER : "",
          webhook_secret: provider.has_webhook_secret ? SECRET_PLACEHOLDER : "",
        };
        return acc;
      }, {}));
    } catch (error) {
      toast.error(error.message || "Failed to load shipping providers");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadStatus = useCallback(async () => {
    try {
      const data = await api.get("/shipping/providers/bosta/status");
      setStatus(data.status || null);
    } catch {
      setStatus(null);
    }
  }, []);

  const loadLocations = useCallback(async (search = "") => {
    try {
      const data = await api.get(`/shipping/locations/search?provider=bosta&q=${encodeURIComponent(search)}&limit=30`);
      setLocations(Array.isArray(data.locations) ? data.locations : []);
    } catch {
      setLocations([]);
    }
  }, []);

  useEffect(() => {
    loadProviders();
    loadStatus();
    loadLocations("");
  }, [loadProviders, loadStatus, loadLocations]);

  useEffect(() => {
    const timer = window.setTimeout(() => loadLocations(query), 250);
    return () => window.clearTimeout(timer);
  }, [query, loadLocations]);

  const patchDraft = (code, patch) => setDrafts((current) => ({ ...current, [code]: { ...current[code], ...patch } }));

  const saveProvider = async (code) => {
    const draft = drafts[code];
    if (!draft) return;
    try {
      setSavingCode(code);
      await api.put(`/shipping/providers/${code}/settings`, {
        enabled: draft.enabled,
        api_base_url: draft.api_base_url,
        api_key: draft.api_key === SECRET_PLACEHOLDER ? undefined : draft.api_key,
        webhook_secret: draft.webhook_secret === SECRET_PLACEHOLDER ? undefined : draft.webhook_secret,
      });
      toast.success(copy.providerSaved);
      await loadProviders();
      if (code === "bosta") loadStatus();
    } catch (error) {
      toast.error(error.message || "Failed to save shipping provider");
    } finally {
      setSavingCode("");
    }
  };

  const sync = async () => {
    try {
      setSyncState({ loading: true, counts: null, error: "" });
      const data = await api.post("/shipping/bosta/sync-locations", {});
      setSyncState({ loading: false, counts: data.counts || null, error: "" });
      toast.success(copy.bostaSynced);
      loadProviders();
      loadStatus();
      loadLocations(query);
    } catch (error) {
      setSyncState({ loading: false, counts: null, error: error.message || "Sync failed" });
      toast.error(error.message || "Bosta sync failed");
    }
  };

  const bosta = providers.find((provider) => provider.code === "bosta") || null;
  const counts = syncState.counts || bosta?.last_locations_sync_counts || {};
  const statusItems = [
    ["API Connected", status?.api_connected],
    ["Locations Synced", status?.locations_synced],
    ["Webhook Secret", status?.webhook_secret_configured],
    ["Last Webhook Received", Boolean(status?.last_webhook_received_at), status?.last_webhook_received_at ? new Date(status.last_webhook_received_at).toLocaleString() : "No events yet"],
    // Bosta states the ERP does not track are recorded rather than rejected, so this
    // row is the evidence list to map from. Green means nothing unknown has arrived.
    ["Unmapped Bosta Statuses", !(status?.webhook_untracked_statuses || []).length, (status?.webhook_untracked_statuses || []).join(", ") || "None"],
    ["Last Sync Date", Boolean(status?.last_locations_sync_at || bosta?.last_locations_sync_at), status?.last_locations_sync_at || bosta?.last_locations_sync_at ? new Date(status?.last_locations_sync_at || bosta?.last_locations_sync_at).toLocaleString() : "Not synced"],
  ];

  return (
    <div className="grid gap-5">
      <ProviderBadgePicker value={defaultProvider} onChange={onDefaultProviderChange} carriers={providers} />

      <VisualSection icon={ShieldCheck} title={copy.providersTitle} description={copy.providersDescription}>
        {loading && !providers.length ? (
          <div className={`rounded-2xl p-6 text-sm font-bold ${fieldSurface} ${bodyText}`}>
            <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
            {copy.loadingProviders}
          </div>
        ) : (
          <div className="grid gap-4 xl:grid-cols-2">
            {providers.map((provider) => (
              <ProviderCredentialsCard
                key={provider.code}
                provider={provider}
                draft={drafts[provider.code] || { enabled: false, api_base_url: "", api_key: "", webhook_secret: "" }}
                onChange={(patch) => patchDraft(provider.code, patch)}
                onSave={() => saveProvider(provider.code)}
                saving={savingCode === provider.code}
                copy={copy}
                t={t}
              />
            ))}
          </div>
        )}
      </VisualSection>

      <VisualSection icon={Database} title={copy.bostaTitle} description={copy.bostaDescription}>
        <div className={`rounded-2xl p-4 ${fieldSurface}`}>
          <h3 className={`m1-section-title ${headingText}`}>{copy.bostaSync}</h3>
          <p className={`mt-1 text-xs leading-5 ${bodyText}`}>{copy.bostaSyncHint}</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <TesterMetric label={t("settings.shipping.cities")} value={counts.citiesSynced ?? counts.cities ?? 0} />
            <TesterMetric label={t("settings.shipping.zones")} value={counts.zonesSynced ?? counts.zones ?? 0} />
            <TesterMetric label={t("settings.shipping.districts")} value={counts.districtsSynced ?? counts.districts ?? 0} />
          </div>
          {bosta?.last_locations_sync_at ? <p className={`mt-3 text-xs font-bold ${mutedText}`}>{t("settings.shipping.lastSync")} {new Date(bosta.last_locations_sync_at).toLocaleString()}</p> : null}
          {syncState.error ? <p className="mt-3 rounded-2xl border border-rose-300/30 bg-rose-500/10 px-3 py-2 text-xs font-black text-rose-200">{syncState.error}</p> : null}
          <button type="button" disabled={syncState.loading} onClick={sync} className="mt-4 inline-flex h-[var(--control-height-lg)] items-center gap-2 rounded-[var(--radius-control)] border border-slate-200 bg-white px-4 text-sm font-black text-slate-900 disabled:opacity-60 dark:border-white/10 dark:bg-white/10 dark:text-white">
            {syncState.loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {copy.syncNow}
          </button>
        </div>

        <article className={`mt-4 rounded-2xl p-4 ${fieldSurface}`}>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h3 className={`m1-section-title ${headingText}`}>{copy.bostaStatus}</h3>
              <p className={`mt-1 text-xs leading-5 ${bodyText}`}>{copy.bostaStatusHint}</p>
            </div>
            <code className="max-w-full break-all rounded-2xl bg-slate-950 px-3 py-2 text-xs font-bold text-cyan-100 dark:bg-black/40">
              {status?.webhook_url || "/api/shipping/bosta/webhook"}
            </code>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {statusItems.map(([label, ok, detail]) => (
              <div key={label} className="rounded-[var(--radius-card)] border border-slate-200 bg-white p-3 dark:border-white/10 dark:bg-white/[0.04]">
                <div className="flex items-center gap-2">
                  <span className={`grid h-7 w-7 place-items-center rounded-full ${ok ? "bg-emerald-500/12 text-emerald-600 dark:text-emerald-300" : "bg-amber-500/12 text-amber-600 dark:text-amber-300"}`}>
                    {ok ? <Check className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
                  </span>
                  <span className={`text-xs font-black uppercase ${mutedText}`}>{label}</span>
                </div>
                <div className={`mt-2 text-sm font-black ${ok ? "text-emerald-700 dark:text-emerald-200" : "text-amber-700 dark:text-amber-200"}`}>
                  {ok ? "Ready" : "Needs setup"}
                </div>
                {detail ? <div className={`mt-1 text-[11px] font-bold ${bodyText}`}>{detail}</div> : null}
              </div>
            ))}
          </div>
          {status?.last_webhook_status ? (
            <div className={`mt-3 flex flex-wrap items-center gap-2 text-xs font-bold ${bodyText}`}>
              <Clock3 className="h-4 w-4" />
              <span>{t("settings.shipping.lastWebhookStatus")} {status.last_webhook_status}</span>
              {status.last_webhook_order_id ? <span>{t("settings.shipping.order")}{status.last_webhook_order_id}</span> : null}
            </div>
          ) : null}
        </article>
      </VisualSection>

      <VisualSection icon={MapPin} title={copy.bostaLocations} description={copy.bostaLocationsHint}>
        <div className="mb-3 max-w-lg">
          <div className="relative">
            <Search className={`absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 ${mutedText}`} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("settings.shipping.searchLocations")} className={`${inputClass} pl-9`} />
          </div>
        </div>
        <div className="max-h-[28rem] overflow-auto rounded-2xl border border-slate-200 dark:border-white/10">
          <table className="m1-table m1-table--compact min-w-full text-sm">
            <thead className="sticky top-0 bg-slate-100 text-xs font-black uppercase text-slate-500 dark:bg-slate-950 dark:text-slate-400">
              <tr>
                {["City", "Zone", "District", "Availability"].map((header) => <th key={header} className="px-4 py-3 text-start">{header}</th>)}
              </tr>
            </thead>
            <tbody className="dark:divide-white/10">
              {locations.map((location) => (
                <tr key={`${location.city_id}-${location.zone_id}-${location.district_id}`} className="bg-white dark:bg-slate-950/40">
                  <td className="px-4 py-3 font-bold text-slate-900 dark:text-white"><div className="table-cell-stack"><div>{location.city_name_en}</div><div className="text-xs text-slate-500">{location.city_name_ar}</div></div></td>
                  <td className="px-4 py-3 font-bold text-slate-700 dark:text-slate-200"><div className="table-cell-stack"><div>{location.zone_name_en}</div><div className="text-xs text-slate-500">{location.zone_name_ar}</div></div></td>
                  <td className="px-4 py-3 font-bold text-slate-700 dark:text-slate-200"><div className="table-cell-stack"><div>{location.district_name_en}</div><div className="text-xs text-slate-500">{location.district_name_ar}</div></div></td>
                  <td className="px-4 py-3">
                    <div className="table-cell-stack">
                      <span className="rounded-full bg-emerald-500/10 px-2 py-1 text-[11px] font-black text-emerald-600 dark:text-emerald-300">{t("settings.shipping.dropoff")}</span>
                      {location.district_pickup_available ? <span className="rounded-full bg-blue-500/10 px-2 py-1 text-[11px] font-black text-blue-600 dark:text-blue-300">{t("settings.shipping.pickup")}</span> : null}
                    </div>
                  </td>
                </tr>
              ))}
              {!locations.length ? (
                <tr><td colSpan={4} className={`px-4 py-8 text-center text-sm font-bold ${bodyText}`}>{copy.emptyBostaLocations}</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </VisualSection>
    </div>
  );
}

function ProviderBadge({ provider, active = false, onClick }) {
  const meta = providerMeta(provider);
  const className = `inline-flex h-10 items-center gap-2 rounded-full border px-3 text-xs font-black transition ${active ? meta.activeClass : meta.className}`;
  const content = (
    <>
      <span className={`h-2.5 w-2.5 rounded-full ${meta.dotClass}`} />
      {meta.label}
    </>
  );
  if (!onClick) return <span className={className}>{content}</span>;
  return <button type="button" onClick={onClick} className={className}>{content}</button>;
}

function ShippingQuickSetup({ zones, defaultPrice, copy, onChange }) {
  const [prices, setPrices] = useState({
    damietta: 45,
    cairoGiza: 70,
    alexandria: 75,
    rest: defaultPrice || 80,
  });
  const updatePrice = (key, value) => setPrices((current) => ({ ...current, [key]: value }));
  const priceNumber = (value, fallback) => {
    const next = Number(value);
    return Number.isFinite(next) && next >= 0 ? next : fallback;
  };
  const applyTemplate = () => {
    const next = applyEgyptStandardTemplate(zones, {
      damietta: priceNumber(prices.damietta, 45),
      cairoGiza: priceNumber(prices.cairoGiza, 70),
      alexandria: priceNumber(prices.alexandria, 75),
      rest: priceNumber(prices.rest, defaultPrice || 80),
    });
    onChange(next);
    toast.success(copy.quickApplied);
  };
  return (
    <VisualSection icon={Sparkles} title={copy.quickSetupTitle} description={copy.quickSetupDescription}>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[repeat(4,minmax(0,1fr))_auto] xl:items-end">
        {[
          ["damietta", copy.damiettaPrice],
          ["cairoGiza", copy.cairoGizaPrice],
          ["alexandria", copy.alexandriaPrice],
          ["rest", copy.restPrice],
        ].map(([key, label]) => (
          <label key={key} className={`rounded-2xl p-3 ${fieldSurface}`}>
            <span className={`mb-2 block text-xs font-black uppercase ${mutedText}`}>{label}</span>
            <input type="number" min="0" value={prices[key]} onChange={(event) => updatePrice(key, event.target.value)} className={inputClass} />
          </label>
        ))}
        <button type="button" onClick={applyTemplate} className="inline-flex h-[var(--control-height-lg)] items-center justify-center gap-2 rounded-[var(--radius-control)] bg-primary px-4 text-sm font-black text-[var(--primary-contrast)] dark:bg-white dark:text-[var(--primary-contrast)]">
          <Check className="h-4 w-4" />
          {copy.applyTemplate}
        </button>
      </div>
    </VisualSection>
  );
}

function ShippingTemplates({ zones, defaultPrice, copy, onChange }) {
  const templates = [
    ["egypt_standard", copy.templateEgypt, "Balanced nationwide prices with a local Damietta rate.", () => applyEgyptStandardTemplate(zones, { damietta: 45, cairoGiza: 70, alexandria: 75, rest: defaultPrice || 80 })],
    ["local_store", copy.templateLocal, "Prioritizes Damietta and in-store delivery while keeping Egypt fallback zones.", () => applyNamedShippingTemplate("local_store", zones, defaultPrice)],
    ["fast_delivery", copy.templateFast, "Shorter ETA copy and carrier-ready defaults.", () => applyNamedShippingTemplate("fast_delivery", zones, defaultPrice)],
    ["free_campaign", copy.templateFree, "Adds free shipping thresholds for campaign periods.", () => applyNamedShippingTemplate("free_campaign", zones, defaultPrice)],
  ];
  return (
    <VisualSection icon={Package} title={copy.templatesTitle} description={copy.templatesDescription}>
      <div className="grid gap-3 lg:grid-cols-4">
        {templates.map(([id, title, description, build]) => (
          <button key={id} type="button" onClick={() => { onChange(build()); toast.success(copy.templateApplied); }} className={`min-h-36 rounded-[var(--radius-control)] p-4 text-start transition hover:-translate-y-0.5 hover:border-slate-300 ${fieldSurface}`}>
            <span className="grid h-10 w-10 place-items-center rounded-2xl bg-slate-950 text-white dark:bg-white dark:text-slate-950"><Truck className="h-5 w-5" /></span>
            <h3 className={`m1-section-title mt-3 ${headingText}`}>{title}</h3>
            <p className={`mt-2 text-xs leading-5 ${bodyText}`}>{description}</p>
          </button>
        ))}
      </div>
    </VisualSection>
  );
}

function ShippingRuleTester({ zones, defaultPrice, defaultProvider, copy }) {
  const governorateOptions = useMemo(() => Array.from(new Set(zones.map((zone) => zone.governorate).filter(Boolean))).sort(), [zones]);
  const [tester, setTester] = useState({ governorate: governorateOptions[0] || "Damietta", city: "", area: "", subtotal: 0 });
  useEffect(() => {
    if (!tester.governorate && governorateOptions[0]) setTester((current) => ({ ...current, governorate: governorateOptions[0] }));
  }, [governorateOptions, tester.governorate]);
  const result = useMemo(() => resolveShippingPreview(zones, { ...tester, defaultPrice, defaultProvider }), [zones, tester, defaultPrice, defaultProvider]);
  const cityOptions = useMemo(() => Array.from(new Set(zones.filter((zone) => normalizeZoneKey(zone.governorate) === normalizeZoneKey(tester.governorate)).map((zone) => zone.city).filter(Boolean))).sort(), [zones, tester.governorate]);
  const areaOptions = useMemo(() => Array.from(new Set(zones.filter((zone) => normalizeZoneKey(zone.governorate) === normalizeZoneKey(tester.governorate) && (!tester.city || normalizeZoneKey(zone.city) === normalizeZoneKey(tester.city))).map((zone) => zone.area).filter(Boolean))).sort(), [zones, tester.governorate, tester.city]);
  const setField = (key, next) => setTester((current) => ({ ...current, [key]: next }));
  return (
    <VisualSection icon={TestTube2} title={copy.testerTitle} description={copy.testerDescription}>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(20rem,0.9fr)]">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={`rounded-2xl p-3 ${fieldSurface}`}>
            <span className={`mb-2 block text-xs font-black uppercase ${mutedText}`}>{copy.governorate}</span>
            <select value={tester.governorate} onChange={(event) => setField("governorate", event.target.value)} className={inputClass}>
              {governorateOptions.map((governorate) => <option key={governorate} value={governorate}>{governorate}</option>)}
            </select>
          </label>
          <TesterInput label={copy.city} value={tester.city} onChange={(next) => setField("city", next)} options={cityOptions} />
          <TesterInput label={copy.area} value={tester.area} onChange={(next) => setField("area", next)} options={areaOptions} />
          <label className={`rounded-2xl p-3 ${fieldSurface}`}>
            <span className={`mb-2 block text-xs font-black uppercase ${mutedText}`}>{copy.orderSubtotal}</span>
            <input type="number" min="0" value={tester.subtotal} onChange={(event) => setField("subtotal", event.target.value)} className={inputClass} />
          </label>
        </div>
        <div className={`rounded-2xl p-4 ${subtleSurface}`}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className={`text-xs font-black uppercase ${mutedText}`}>{copy.matchedZone}</div>
              <div className={`mt-1 text-lg font-black ${headingText}`}>{result.matchedZone}</div>
            </div>
            <ProviderBadge provider={result.provider_id || result.provider} active />
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <TesterMetric label={copy.shippingCost} value={`${Number(result.price || 0).toLocaleString()} EGP`} />
            <TesterMetric label={copy.proofRequired} value={result.requires_shipping_proof ? copy.yes : copy.no} />
            <TesterMetric label={copy.eta} value={result.estimated_delivery_text || copy.noEta} />
          </div>
        </div>
      </div>
    </VisualSection>
  );
}

function TesterInput({ label, value, onChange, options }) {
  const listId = `tester-${String(label).toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <div className={`rounded-2xl p-3 ${fieldSurface}`}>
      {/* Kept separate from PremiumInput: this is a datalist-backed autocomplete,
          a genuinely different contract. Adapter preserves the string callback. */}
      <Input label={label} list={listId} value={value} onChange={(event) => onChange(event.target.value)} />
      <datalist id={listId}>
        {options.map((option) => <option key={option} value={option} />)}
      </datalist>
    </div>
  );
}

function TesterMetric({ label, value }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-slate-200 bg-white p-3 dark:border-white/10 dark:bg-slate-950">
      <div className={`text-[11px] font-black uppercase ${mutedText}`}>{label}</div>
      <div className={`mt-1 text-sm font-black ${headingText}`}>{value}</div>
    </div>
  );
}

function ZonePolicyList({ zones, allZones, empty, onChange }) {
  const patchRow = (id, patch) => onChange(allZones.map((zone) => (zone.id === id ? normalizeShippingZoneRow({ ...zone, ...patch }) : zone)));
  if (!zones.length) return <div className={`rounded-2xl p-4 text-sm font-bold ${fieldSurface} ${bodyText}`}>{empty}</div>;
  return (
    <div className="grid gap-2">
      {zones.slice(0, 10).map((zone) => (
        <div key={zone.id} className={`grid gap-3 rounded-2xl p-3 sm:grid-cols-[minmax(0,1fr)_9rem] sm:items-center ${fieldSurface}`}>
          <div className="min-w-0">
            <div className={`truncate text-sm font-black ${headingText}`}>{zoneLabel(zone)}</div>
            <div className={`mt-1 text-xs ${bodyText}`}>{`Free over ${Number(zone.free_shipping_threshold || 0).toLocaleString()} EGP`}</div>
          </div>
          <input type="number" min="0" value={zone.free_shipping_threshold} onChange={(event) => patchRow(zone.id, { free_shipping_threshold: Number(event.target.value) })} className={`${inputClass} h-[var(--control-height-md)] rounded-[var(--radius-control)] text-center`} />
        </div>
      ))}
    </div>
  );
}

const shippingUi = {
  en: {
    defaultPrice: "Default shipping price",
    activeZones: "Active zones",
    proofZones: "Proof required",
    freeRules: "Free shipping rules",
    tabOverview: "Overview",
    tabLocations: "Locations",
    tabZones: "Zones",
    tabFree: "Free Shipping",
    tabProviders: "Providers",
    tabAdvanced: "Advanced",
    overviewTitle: "Shipping Overview",
    overviewDescription: "Default fallback and operational rules used by storefront checkout.",
    quickSetupTitle: "Quick Setup",
    quickSetupDescription: "Set the core Egypt pricing model in one pass without editing every row.",
    damiettaPrice: "Damietta price",
    cairoGizaPrice: "Cairo / Giza price",
    alexandriaPrice: "Alexandria price",
    restPrice: "Rest of Egypt price",
    applyTemplate: "Apply template",
    quickApplied: "Shipping template applied",
    templatesTitle: "Shipping Templates",
    templatesDescription: "Start from a working logistics pattern, then tune individual zones.",
    templateEgypt: "Egypt Standard",
    templateLocal: "Local Store",
    templateFast: "Fast Delivery",
    templateFree: "Free Shipping Campaign",
    templateApplied: "Template applied",
    testerTitle: "Shipping Rule Tester",
    testerDescription: "Preview the checkout result using the same area, city, governorate, default priority.",
    governorate: "Governorate",
    city: "City / Markaz",
    area: "Area / District",
    orderSubtotal: "Order subtotal",
    matchedZone: "Matched zone",
    shippingCost: "Shipping cost",
    proofRequired: "Proof required",
    eta: "ETA",
    yes: "Yes",
    no: "No",
    noEta: "No ETA",
    locationsTitle: "Shipping Locations",
    locationsDescription: "Structured Egypt governorate, city/markaz, and area catalog for zones and checkout.",
    zonesTitle: "Shipping Zones",
    zonesDescription: "Exact area rows win first, then city/markaz rows, then governorate rows, then the default price.",
    freeTitle: "Free Shipping",
    freeDescription: "Campaign thresholds by governorate, city, or district.",
    emptyFree: "No free shipping thresholds yet. Add thresholds from Zones or apply a campaign template.",
    proofTitle: "Shipping Proof Rules",
    proofDescription: "Use the per-zone proof toggle to require or skip shipping payment proof for each area.",
    proofBody: "Proof rules are controlled directly inside Shipping Zones so Damietta, city, and district exceptions stay visible beside their prices.",
    enabled: "Enabled",
    disabled: "Disabled",
    saveProvider: "Save settings",
    providerSaved: "Shipping provider saved",
    webhookSecret: "Webhook secret",
    webhookSecretHint: "Paste the same value into the carrier dashboard webhook. Without it every status callback is rejected.",
    bostaTitle: "Bosta operations",
    bostaDescription: "Sync Bosta cities, zones, and districts, then create deliveries from ERP orders.",
    bostaSync: "Sync locations",
    bostaSyncHint: "Imports Bosta City to Zone to District master locations. Checkout only shows dropoff-available rows.",
    syncNow: "Sync now",
    bostaSynced: "Bosta locations synced",
    bostaStatus: "Bosta status",
    bostaStatusHint: "Operational checklist for API, location sync, and webhook readiness.",
    bostaLocations: "Locations preview",
    bostaLocationsHint: "Search synced cities, zones, and districts in English and Arabic.",
    emptyBostaLocations: "No Bosta locations synced yet.",
    providersTitle: "Shipping Providers",
    providersDescription: "Every carrier the ERP knows, its credentials, and whether it can actually book a shipment.",
    providerIntegrated: "Live integration: creates shipments, labels, and status updates.",
    providerNotWired: "Credentials are stored, but no shipments are booked yet - the API is not wired.",
    providerPlaceholderWarning: "No API client exists for this carrier yet. Enabling it will not create shipments.",
    loadingProviders: "Loading providers...",
    providerPolicyTitle: "Delivery policy",
    providerPolicyDescription: "Rules the carrier applies to the parcel itself.",
    advancedTitle: "Advanced",
    advancedDescription: "Raw registry fields for compatibility and troubleshooting.",
    search: "Search governorate, city, area, provider",
    allGovernorates: "Add all Egypt governorates",
    addZone: "Add zone",
    import: "Import",
    export: "Export",
    fullScreen: "Full Screen",
    exitFullScreen: "Exit Full Screen",
    density: "Density",
    comfortable: "Comfortable",
    compact: "Compact",
    ultraCompact: "Ultra Compact",
    freezeColumns: "Freeze governorate + city",
    shortcutHint: "Press F",
    bulk: "Bulk update",
    governorateFilter: "Governorate",
    all: "All",
    selected: "selected",
    quickTitle: "Quick zone creation",
    createGovernorate: "Governorate only",
    createCity: "Governorate + city",
    createArea: "Governorate + city + area",
    bulkPrice: "Set selected price",
    bulkEstimate: "Set delivery estimate",
    requireProof: "Require proof",
    skipProof: "Proof not required",
    deleteSelected: "Delete selected",
    priority: "Priority",
    testRule: "Test rule",
    testResult: "Test result",
    winningRule: "Winning rule for this address",
    overriddenBy: "Overridden by",
    duplicateRule: "Duplicate identical rule",
    duplicatePrevented: "Duplicate identical shipping rule was not added.",
    empty: "No shipping zones match the current filters.",
    seeded: "Egypt governorates added",
    headers: ["Governorate", "City / Markaz", "Area / District", "Price", "Proof", "ETA", "Provider", "Free over", "Active", ""],
  },
  ar: {
    defaultPrice: "سعر الشحن الافتراضي",
    activeZones: "المناطق النشطة",
    proofZones: "مناطق إثبات الدفع",
    freeRules: "قواعد الشحن المجاني",
    overviewTitle: "ملخص الشحن",
    overviewDescription: "سعر افتراضي وقواعد تشغيل يستخدمها المتجر في خطوة الدفع.",
    zonesTitle: "مناطق الشحن",
    zonesDescription: "يتم التطابق حسب المنطقة أولاً، ثم المدينة/المركز، ثم المحافظة، ثم السعر الافتراضي.",
    proofTitle: "قواعد إثبات دفع الشحن",
    proofDescription: "استخدم هذا المفتاح لتحديد ما إذا كانت صورة التحويل مطلوبة لكل منطقة.",
    proofBody: "تظهر قواعد إثبات الدفع داخل مناطق الشحن حتى تبقى الاستثناءات واضحة بجانب السعر.",
    enabled: "مفعّل",
    disabled: "معطّل",
    saveProvider: "حفظ الإعدادات",
    providerSaved: "تم حفظ إعدادات الشركة",
    webhookSecret: "مفتاح الويبهوك",
    webhookSecretHint: "الصق نفس القيمة في إعدادات الويبهوك على لوحة الشركة. من غيرها كل تحديث حالة بيتم رفضه.",
    bostaTitle: "تشغيل بوسطة",
    bostaDescription: "زامن مدن ومناطق وأحياء بوسطة، وبعدها تقدر تنشئ الشحنات من طلبات النظام.",
    bostaSync: "مزامنة المناطق",
    bostaSyncHint: "بيستورد شجرة المدينة ثم المنطقة ثم الحي من بوسطة. صفحة الدفع بتعرض المتاح للتسليم فقط.",
    syncNow: "زامن الآن",
    bostaSynced: "تمت مزامنة مناطق بوسطة",
    bostaStatus: "حالة بوسطة",
    bostaStatusHint: "قائمة تشغيلية للتحقق من الـ API والمزامنة وجاهزية الويبهوك.",
    bostaLocations: "معاينة المناطق",
    bostaLocationsHint: "ابحث في المدن والمناطق والأحياء المتزامنة بالعربي والإنجليزي.",
    emptyBostaLocations: "لسه مفيش مناطق متزامنة من بوسطة.",
    providersTitle: "شركات الشحن",
    providersDescription: "كل شركة شحن يعرفها النظام، وبيانات ربطها، وهل تقدر تنشئ شحنة فعلاً.",
    providerIntegrated: "تكامل شغّال: ينشئ الشحنات والملصقات ويتابع الحالة.",
    providerNotWired: "البيانات بتتحفظ، لكن مفيش شحنات بتتعمل — الـ API مش مربوط.",
    providerPlaceholderWarning: "مفيش ربط برمجي للشركة دي لسه. تفعيلها مش هينشئ شحنات.",
    loadingProviders: "جارٍ تحميل الشركات...",
    providerPolicyTitle: "سياسة التسليم",
    providerPolicyDescription: "قواعد بتطبقها شركة الشحن على الطرد نفسه.",
    search: "ابحث بالمحافظة أو المدينة أو المنطقة أو شركة الشحن",
    allGovernorates: "إضافة كل محافظات مصر",
    addZone: "إضافة منطقة",
    import: "استيراد",
    export: "تصدير",
    bulk: "تحديث جماعي",
    governorateFilter: "المحافظة",
    all: "الكل",
    selected: "المحدد",
    quickTitle: "إضافة سريعة",
    createGovernorate: "محافظة فقط",
    createCity: "محافظة + مدينة",
    createArea: "محافظة + مدينة + منطقة",
    bulkPrice: "تحديث السعر للمحدد",
    bulkEstimate: "تحديث مدة التوصيل",
    requireProof: "إلزام بإثبات",
    skipProof: "بدون إثبات",
    deleteSelected: "حذف المحدد",
    empty: "لا توجد مناطق شحن مطابقة للفلاتر الحالية.",
    seeded: "تمت إضافة محافظات مصر",
    headers: ["المحافظة", "المدينة / المركز", "المنطقة / الحي", "السعر", "إثبات", "المدة", "الشركة", "مجاني بعد", "مفعل", ""],
  },
};

const egyptGovernorates = [
  ["cairo", "Cairo", "القاهرة", 70, true, "2-4 business days"],
  ["giza", "Giza", "الجيزة", 70, true, "2-4 business days"],
  ["alexandria", "Alexandria", "الإسكندرية", 75, true, "2-5 business days"],
  ["dakahlia", "Dakahlia", "الدقهلية", 75, true, "2-5 business days"],
  ["red-sea", "Red Sea", "البحر الأحمر", 90, true, "3-6 business days"],
  ["beheira", "Beheira", "البحيرة", 75, true, "2-5 business days"],
  ["fayoum", "Fayoum", "الفيوم", 80, true, "2-5 business days"],
  ["gharbia", "Gharbia", "الغربية", 75, true, "2-5 business days"],
  ["ismailia", "Ismailia", "الإسماعيلية", 75, true, "2-5 business days"],
  ["menofia", "Menofia", "المنوفية", 75, true, "2-5 business days"],
  ["minya", "Minya", "المنيا", 85, true, "3-6 business days"],
  ["qalyubia", "Qalyubia", "القليوبية", 70, true, "2-4 business days"],
  ["new-valley", "New Valley", "الوادي الجديد", 95, true, "4-7 business days"],
  ["suez", "Suez", "السويس", 75, true, "2-5 business days"],
  ["aswan", "Aswan", "أسوان", 90, true, "3-6 business days"],
  ["assiut", "Assiut", "أسيوط", 85, true, "3-6 business days"],
  ["beni-suef", "Beni Suef", "بني سويف", 80, true, "2-5 business days"],
  ["port-said", "Port Said", "بورسعيد", 75, true, "2-5 business days"],
  ["damietta", "Damietta", "دمياط", 45, false, "1-2 business days"],
  ["sharqia", "Sharqia", "الشرقية", 75, true, "2-5 business days"],
  ["south-sinai", "South Sinai", "جنوب سيناء", 95, true, "4-7 business days"],
  ["kafr-el-sheikh", "Kafr El Sheikh", "كفر الشيخ", 75, true, "2-5 business days"],
  ["matrouh", "Matrouh", "مطروح", 90, true, "3-6 business days"],
  ["luxor", "Luxor", "الأقصر", 90, true, "3-6 business days"],
  ["qena", "Qena", "قنا", 90, true, "3-6 business days"],
  ["north-sinai", "North Sinai", "شمال سيناء", 95, true, "4-7 business days"],
  ["sohag", "Sohag", "سوهاج", 90, true, "3-6 business days"],
];

const shippingZonePresets = [
  ...egyptGovernorates.map(([id, governorate, arabic_alias, price, requires_shipping_proof, estimated_delivery_text]) => ({
    id,
    governorate,
    arabic_alias,
    city: "",
    area: "",
    price,
    requires_shipping_proof,
    estimated_delivery_text,
    provider: "in_store_delivery",
    provider_id: "in_store_delivery",
    free_shipping_threshold: 0,
    active: true,
  })),
  { id: "new-damietta", governorate: "Damietta", arabic_alias: "دمياط الجديدة", city: "New Damietta", area: "", price: 40, requires_shipping_proof: false, estimated_delivery_text: "1-2 business days", provider: "in_store_delivery", provider_id: "in_store_delivery", free_shipping_threshold: 0, active: true },
];

const normalizeZoneKey = (value = "") => String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
const shippingProviderOptions = [
  { id: "bosta", label: "Bosta" },
  { id: "mylerz", label: "Mylerz" },
  { id: "shipblu", label: "ShipBlu" },
  // getters: module scope, so resolve on ACCESS, never eagerly at import
  { id: "manual", get label() { return tt("settings.shipping.manual"); } },
  { id: "in_store_delivery", get label() { return tt("settings.shipping.inStoreDelivery"); } },
];
// Every carrier code the UI must round-trip. Names are the server catalogue's job; this
// list only has to RECOGNISE a saved value, because anything it does not know is rewritten
// to in_store_delivery on the next render -- silently losing the carrier that was picked.
const SHIPPING_PROVIDER_CODES = ["bosta", "mylerz", "aramex", "shipblu", "manual", "in_store_delivery"];

const titleCaseCode = (code = "") => code.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

const normalizeProviderKey = (value = "") => {
  const key = String(value || "in_store_delivery").trim().toLowerCase();
  if (key === "store_pickup" || key === "in-store-delivery") return "in_store_delivery";
  return SHIPPING_PROVIDER_CODES.includes(key) ? key : "in_store_delivery";
};
const providerMeta = (value = "") => {
  const key = normalizeProviderKey(value);
  const provider = shippingProviderOptions.find((item) => item.id === key) || { id: key, label: titleCaseCode(key) };
  const styles = {
    bosta: ["border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-400/25 dark:bg-rose-500/12 dark:text-rose-100", "border-rose-500 bg-rose-600 text-white shadow-sm dark:border-rose-300 dark:bg-rose-500", "bg-rose-500"],
    mylerz: ["border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-400/25 dark:bg-indigo-500/12 dark:text-indigo-100", "border-indigo-500 bg-indigo-600 text-white shadow-sm dark:border-indigo-300 dark:bg-indigo-500", "bg-indigo-500"],
    shipblu: ["border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-400/25 dark:bg-sky-500/12 dark:text-sky-100", "border-sky-500 bg-sky-600 text-white shadow-sm dark:border-sky-300 dark:bg-sky-500", "bg-sky-500"],
    in_store_delivery: ["border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/25 dark:bg-emerald-500/12 dark:text-emerald-100", "border-emerald-500 bg-emerald-600 text-white shadow-sm dark:border-emerald-300 dark:bg-emerald-500", "bg-emerald-500"],
  };
  const [className, activeClass, dotClass] = styles[provider.id] || styles.in_store_delivery;
  return { ...provider, className, activeClass, dotClass };
};

const zoneLabel = (zone = {}) => [zone.governorate, zone.city, zone.area].filter(Boolean).join(" / ") || "Default";

const ruleIdentity = (zone = {}) =>
  [zone.governorate, zone.city, zone.area].map((value) => normalizeZoneKey(value)).join("|");

const ruleType = (zone = {}) => zone.area ? "Area Rule" : zone.city ? "City Rule" : "Governorate Rule";

const rulePriority = (zone = {}) => zone.area ? 1 : zone.city ? 2 : zone.governorate ? 3 : 4;

const rulePriorityLabel = (zone = {}) => `${zone.area ? "1" : zone.city ? "2" : "3"} / Area > City > Governorate > Default`;

const ruleSummary = (zone = {}) => {
  const provider = providerMeta(zone.provider_id || zone.provider).label;
  const proof = zone.requires_shipping_proof ? "Proof Required" : "No Proof";
  const eta = zone.estimated_delivery_text || "No ETA";
  return `${zoneLabel(zone).replaceAll(" / ", " -> ")} -> Shipping ${Number(zone.price || 0).toLocaleString()} EGP -> ${provider} -> ${proof} -> ETA ${eta}`;
};

const resolveRuleWinner = (zones = [], zone = {}, defaultPrice = 0) => {
  const preview = resolveShippingPreview(zones, {
    governorate: zone.governorate,
    city: zone.city,
    area: zone.area,
    subtotal: 0,
    defaultPrice,
  });
  return preview.match || null;
};

const ensureTemplateRow = (rows, row) => {
  const normalized = normalizeShippingZoneRow(row);
  const existingIndex = rows.findIndex((zone) =>
    normalizeZoneKey(zone.governorate) === normalizeZoneKey(normalized.governorate) &&
    normalizeZoneKey(zone.city) === normalizeZoneKey(normalized.city) &&
    normalizeZoneKey(zone.area) === normalizeZoneKey(normalized.area)
  );
  if (existingIndex >= 0) {
    const next = [...rows];
    next[existingIndex] = normalizeShippingZoneRow({ ...next[existingIndex], ...normalized, id: next[existingIndex].id });
    return next;
  }
  return [...rows, normalized];
};

const applyEgyptStandardTemplate = (zones, prices) => {
  const rows = (Array.isArray(zones) ? zones : []).map(normalizeShippingZoneRow);
  return egyptGovernorates.reduce((nextRows, [id, governorate, arabic_alias, basePrice, requires_shipping_proof, estimated_delivery_text]) => {
    const price = governorate === "Damietta"
      ? prices.damietta
      : ["Cairo", "Giza"].includes(governorate)
        ? prices.cairoGiza
        : governorate === "Alexandria"
          ? prices.alexandria
          : prices.rest ?? basePrice;
    return ensureTemplateRow(nextRows, {
      id,
      governorate,
      arabic_alias,
      city: "",
      area: "",
      price,
        requires_shipping_proof,
      estimated_delivery_text,
      provider: "in_store_delivery",
      provider_id: "in_store_delivery",
      active: true,
    });
  }, rows);
};

const applyNamedShippingTemplate = (name, zones, defaultPrice) => {
  let rows = applyEgyptStandardTemplate(zones, { damietta: 45, cairoGiza: 70, alexandria: 75, rest: defaultPrice || 80 });
  if (name === "local_store") {
    rows = rows.map((zone) => normalizeShippingZoneRow({
      ...zone,
      provider: "in_store_delivery",
      provider_id: "in_store_delivery",
      requires_shipping_proof: normalizeZoneKey(zone.governorate) === "damietta" ? false : zone.requires_shipping_proof,
    }));
    rows = ensureTemplateRow(rows, { id: "new-damietta", governorate: "Damietta", city: "New Damietta", area: "", price: 40, requires_shipping_proof: false, estimated_delivery_text: "1-2 business days", provider: "in_store_delivery", provider_id: "in_store_delivery", active: true });
  }
  if (name === "fast_delivery") {
    rows = rows.map((zone) => normalizeShippingZoneRow({
      ...zone,
      provider: ["Cairo", "Giza", "Alexandria"].includes(zone.governorate) ? "bosta" : "shipblu",
      provider_id: ["Cairo", "Giza", "Alexandria"].includes(zone.governorate) ? "bosta" : "shipblu",
      estimated_delivery_text: zone.governorate === "Damietta" ? "Same day - 1 business day" : "1-3 business days",
    }));
  }
  if (name === "free_campaign") {
    rows = rows.map((zone) => normalizeShippingZoneRow({
      ...zone,
      free_shipping_threshold: ["Damietta", "Cairo", "Giza", "Alexandria"].includes(zone.governorate) ? 1500 : 2500,
    }));
  }
  return rows;
};

const resolveShippingPreview = (zones, { governorate = "", city = "", area = "", governorate_id = "", city_id = "", area_id = "", district_id = "", zone_id = "", subtotal = 0, defaultPrice = 0, defaultProvider = "in_store_delivery" } = {}) => {
  const activeZones = (Array.isArray(zones) ? zones : []).map(normalizeShippingZoneRow).filter((zone) => zone.governorate && zone.active);
  const target = { governorate: normalizeZoneKey(governorate), city: normalizeZoneKey(city), area: normalizeZoneKey(area) };
  const zoneCity = (zone) => normalizeZoneKey(zone.city);
  const zoneArea = (zone) => normalizeZoneKey(zone.area);
  const zoneDistrict = (zone) => normalizeZoneKey(zone.district || zone.area);
  const zoneZone = (zone) => normalizeZoneKey(zone.zone || zone.area);
  const targetIds = { governorate_id: String(governorate_id || ""), city_id: String(city_id || ""), area_id: String(area_id || district_id || ""), district_id: String(district_id || area_id || ""), zone_id: String(zone_id || "") };
  const matchesZoneId = (zone) => targetIds.zone_id && zone.zone_id === targetIds.zone_id;
  const matchesDistrictId = (zone) => targetIds.district_id && zone.district_id === targetIds.district_id;
  const matchesAreaId = (zone) => targetIds.area_id && zone.area_id === targetIds.area_id;
  const matchesCityId = (zone) => targetIds.city_id && zone.city_id === targetIds.city_id;
  const matchesGovernorateId = (zone) => targetIds.governorate_id && zone.governorate_id === targetIds.governorate_id;
  const matchesGovernorate = (zone) => normalizeZoneKey(zone.governorate) === target.governorate;
  const matchesCity = (zone) => matchesGovernorate(zone) && zoneCity(zone) && zoneCity(zone) === target.city;
  const matchesArea = (zone) => matchesGovernorate(zone) && zoneArea(zone) && zoneArea(zone) === target.area && (!zoneCity(zone) || !target.city || zoneCity(zone) === target.city);
  const match =
    activeZones.find(matchesZoneId) ||
    activeZones.find((zone) => matchesDistrictId(zone) && !zone.zone_id && !zoneZone(zone)) ||
    activeZones.find(matchesAreaId) ||
    activeZones.find((zone) => matchesCityId(zone) && !zone.district_id && !zone.zone_id && !zone.area_id && !zoneDistrict(zone) && !zoneArea(zone)) ||
    activeZones.find((zone) => matchesGovernorateId(zone) && !zone.city_id && !zone.district_id && !zone.zone_id && !zone.area_id && !zoneCity(zone) && !zoneDistrict(zone) && !zoneArea(zone)) ||
    activeZones.find(matchesArea) ||
    activeZones.find((zone) => matchesCity(zone) && !zoneArea(zone)) ||
    activeZones.find((zone) => matchesGovernorate(zone) && !zoneCity(zone) && !zoneArea(zone));
  const threshold = match ? Number(match.free_shipping_threshold || 0) : 0;
  const matchedPrice = match ? Number(match.price || defaultPrice || 0) : Number(defaultPrice || 0);
  const orderSubtotal = Number(subtotal || 0);
  return {
    price: threshold > 0 && orderSubtotal >= threshold ? 0 : matchedPrice,
    requires_shipping_proof: match ? Boolean(match.requires_shipping_proof) : true,
    estimated_delivery_text: match?.estimated_delivery_text || "",
    provider: match?.provider || defaultProvider,
    provider_id: match?.provider_id || match?.provider || defaultProvider,
    match,
    matchedZone: match ? `${zoneLabel(match)} (${zoneArea(match) ? "area" : zoneCity(match) ? "city" : "governorate"})` : "Default shipping price",
  };
};

const normalizeShippingZoneRow = (zone = {}, index = 0) => ({
  id: String(zone.id || `zone-${Date.now()}-${index}`).trim(),
  governorate_id: String(zone.governorate_id || zone.governorateId || "").trim(),
  governorate: String(zone.governorate || "").trim(),
  arabic_alias: String(zone.arabic_alias || zone.arabicAlias || "").trim(),
  city_id: String(zone.city_id || zone.cityId || "").trim(),
  city: String(zone.city || zone.markaz || "").trim(),
  area_id: String(zone.area_id || zone.areaId || zone.location_id || zone.locationId || zone.district_id || zone.districtId || "").trim(),
  district_id: String(zone.district_id || zone.districtId || zone.area_id || zone.areaId || zone.location_id || zone.locationId || "").trim(),
  zone_id: String(zone.zone_id || zone.zoneId || "").trim(),
  area: String(zone.area || zone.district || zone.zone || "").trim(),
  district: String(zone.district || zone.area || "").trim(),
  zone: String(zone.zone || zone.area || "").trim(),
  provider_location_code: String(zone.provider_location_code || zone.zone_code || zone.providerLocationCode || "").trim(),
  provider_city_id: String(zone.provider_city_id || zone.providerCityId || "").trim(),
  provider_district_id: String(zone.provider_district_id || zone.providerDistrictId || "").trim(),
  provider_zone_id: String(zone.provider_zone_id || zone.providerZoneId || "").trim(),
  price: Number.isFinite(Number(zone.price ?? zone.shipping_price)) ? Number(zone.price ?? zone.shipping_price) : 0,
  requires_shipping_proof: zone.requires_shipping_proof !== false,
  estimated_delivery_text: String(zone.estimated_delivery_text || zone.estimatedDeliveryText || "").trim(),
  delivery_min_days: zone.delivery_min_days === "" || zone.delivery_min_days === null || zone.delivery_min_days === undefined ? "" : Number(zone.delivery_min_days),
  delivery_max_days: zone.delivery_max_days === "" || zone.delivery_max_days === null || zone.delivery_max_days === undefined ? "" : Number(zone.delivery_max_days),
  handling_min_days: zone.handling_min_days === "" || zone.handling_min_days === null || zone.handling_min_days === undefined ? "" : Number(zone.handling_min_days),
  handling_max_days: zone.handling_max_days === "" || zone.handling_max_days === null || zone.handling_max_days === undefined ? "" : Number(zone.handling_max_days),
  handling_time_override_enabled: zone.handling_time_override_enabled === true || zone.handlingTimeOverrideEnabled === true,
  transit_min_days: zone.transit_min_days === "" || zone.transit_min_days === null || zone.transit_min_days === undefined ? "" : Number(zone.transit_min_days),
  transit_max_days: zone.transit_max_days === "" || zone.transit_max_days === null || zone.transit_max_days === undefined ? "" : Number(zone.transit_max_days),
  provider: normalizeProviderKey(zone.provider || zone.shipping_provider || zone.provider_id || zone.shipping_provider_id),
  provider_id: normalizeProviderKey(zone.provider_id || zone.shipping_provider_id || zone.provider || zone.shipping_provider),
  free_shipping_threshold: Number.isFinite(Number(zone.free_shipping_threshold ?? zone.freeShippingThreshold)) ? Number(zone.free_shipping_threshold ?? zone.freeShippingThreshold) : 0,
  active: zone.active !== false,
});

const locationName = (location = {}, language = "en", scope = "area") => {
  const prefix = scope === "governorate" ? "governorate" : scope === "city" ? "city" : scope === "district" ? "district" : scope === "zone" ? "zone" : "area";
  return language === "ar"
    ? location[`${prefix}_name_ar`] || location[`${prefix}_name_en`] || ""
    : location[`${prefix}_name_en`] || location[`${prefix}_name_ar`] || "";
};

const normalizeShippingLocation = (location = {}, index = 0) => {
  const governorateId = String(location.governorate_id || location.governorateId || location.governorate_code || location.governorate || "").trim();
  const cityId = String(location.city_id || location.cityId || location.city_code || location.city || location.markaz || "").trim();
  const districtId = String(location.district_id || location.districtId || location.area_id || location.areaId || location.location_id || location.locationId || location.district || location.area || "").trim();
  const zoneId = String(location.zone_id || location.zoneId || location.provider_zone_id || location.providerZoneId || location.provider_location_code || location.zone_code || location.zone || "").trim();
  const areaId = String(location.area_id || location.areaId || districtId || location.location_id || location.locationId || location.provider_location_code || location.zone_code || location.area || location.district || "").trim();
  return {
    id: String(location.id || zoneId || areaId || `location-${index + 1}`).trim(),
    governorate_id: governorateId,
    governorate_name_en: String(location.governorate_name_en || location.governorateEn || location.governorate || location.province || "").trim(),
    governorate_name_ar: String(location.governorate_name_ar || location.governorateAr || location.governorate_ar || "").trim(),
    city_id: cityId,
    city_name_en: String(location.city_name_en || location.cityEn || location.city || location.markaz || "").trim(),
    city_name_ar: String(location.city_name_ar || location.cityAr || location.city_ar || "").trim(),
    district_id: districtId,
    district_name_en: String(location.district_name_en || location.districtEn || location.district || location.area_name_en || location.area || "").trim(),
    district_name_ar: String(location.district_name_ar || location.districtAr || location.district_ar || location.area_name_ar || "").trim(),
    zone_id: zoneId,
    zone_name_en: String(location.zone_name_en || location.zoneEn || location.zone || location.area_name_en || location.area || location.district || "").trim(),
    zone_name_ar: String(location.zone_name_ar || location.zoneAr || location.zone_ar || location.area_name_ar || location.district_ar || "").trim(),
    area_id: areaId,
    area_name_en: String(location.area_name_en || location.areaEn || location.area || location.district_name_en || location.district || location.zone || "").trim(),
    area_name_ar: String(location.area_name_ar || location.areaAr || location.area_ar || location.district_name_ar || location.district_ar || "").trim(),
    provider_location_code: String(location.provider_location_code || location.zone_code || location.providerLocationCode || location.code || "").trim(),
    provider_city_id: String(location.provider_city_id || location.providerCityId || "").trim(),
    provider_district_id: String(location.provider_district_id || location.providerDistrictId || "").trim(),
    provider_zone_id: String(location.provider_zone_id || location.providerZoneId || location.bosta_zone_id || location.bostaZoneId || "").trim(),
    provider: normalizeProviderKey(location.provider || "manual"),
    active: location.active !== false,
  };
};

const normalizeShippingLocations = (locations = []) => {
  const source = Array.isArray(locations) && locations.length ? locations : defaultEgyptShippingLocations;
  return source.map(normalizeShippingLocation).filter((location) => location.governorate_name_en || location.governorate_name_ar);
};

const locationSearchText = (location = {}) =>
  [
    location.governorate_name_en,
    location.governorate_name_ar,
    location.city_name_en,
    location.city_name_ar,
    location.district_name_en,
    location.district_name_ar,
    location.zone_name_en,
    location.zone_name_ar,
    location.area_name_en,
    location.area_name_ar,
    location.provider,
    location.provider_location_code,
    location.provider_city_id,
    location.provider_district_id,
    location.provider_zone_id,
  ].join(" ").toLowerCase();

const uniqueLocationsBy = (locations, key, extraFilter = () => true) => {
  const seen = new Set();
  return locations.filter((location) => {
    if (!extraFilter(location)) return false;
    const value = location[key];
    if (!value || seen.has(value)) return false;
    seen.add(value);
    return true;
  });
};

const slugifyLocation = (value = "") =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[^a-z0-9\u0600-\u06FF]+/gi, "-")
    .replace(/^-+|-+$/g, "") || `location-${Date.now()}`;

const parseCsvLine = (line = "") => {
  const cells = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && line[index + 1] === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
};

const parseLocationImport = (text = "") => {
  try {
    const parsed = JSON.parse(text);
    const rows = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.locations) ? parsed.locations : [];
    return rows.map(normalizeShippingLocation);
  } catch {
    const [headerLine, ...lines] = String(text || "").split(/\r?\n/).filter((line) => line.trim());
    const headers = parseCsvLine(headerLine).map((header) => header.trim().toLowerCase());
    return lines.map((line, index) => {
      const cells = parseCsvLine(line);
      const row = Object.fromEntries(headers.map((header, cellIndex) => [header, cells[cellIndex] || ""]));
      return normalizeShippingLocation({
        id: row.id || row.zone_id || row.area_id || row.district_id || row.location_id || row.zone_code || `import-${Date.now()}-${index}`,
        governorate_id: row.governorate_id || row.governorate_code || slugifyLocation(row.governorate_name_en || row.governorate || row.province),
        governorate_name_en: row.governorate_name_en || row.governorate_en || row.governorate || row.province,
        governorate_name_ar: row.governorate_name_ar || row.governorate_ar,
        city_id: row.city_id || row.city_code || slugifyLocation(`${row.governorate || row.governorate_name_en}-${row.city_name_en || row.city || row.markaz}`),
        city_name_en: row.city_name_en || row.city_en || row.city || row.markaz,
        city_name_ar: row.city_name_ar || row.city_ar,
        district_id: row.district_id || row.area_id || row.location_id || slugifyLocation(`${row.city || row.city_name_en}-${row.district_name_en || row.area_name_en || row.area || row.district || row.zone}`),
        district_name_en: row.district_name_en || row.district_en || row.area_name_en || row.area_en || row.area || row.district,
        district_name_ar: row.district_name_ar || row.district_ar || row.area_name_ar || row.area_ar,
        zone_id: row.zone_id || row.provider_zone_id || row.zone_code || slugifyLocation(`${row.city || row.city_name_en}-${row.zone_name_en || row.zone || row.area_name_en || row.area || row.district}`),
        zone_name_en: row.zone_name_en || row.zone_en || row.zone || row.area_name_en || row.area || row.district,
        zone_name_ar: row.zone_name_ar || row.zone_ar || row.area_name_ar || row.area_ar || row.district_ar,
        area_id: row.area_id || row.district_id || row.location_id || row.zone_code || slugifyLocation(`${row.city || row.city_name_en}-${row.area_name_en || row.area || row.district || row.zone}`),
        area_name_en: row.area_name_en || row.area_en || row.area || row.district || row.zone,
        area_name_ar: row.area_name_ar || row.area_ar || row.district_ar,
        provider_location_code: row.provider_location_code || row.zone_code || row.code || row.bosta_code,
        provider_city_id: row.provider_city_id || row.bosta_city_id || row.cityid || row.city_id_provider,
        provider_district_id: row.provider_district_id || row.bosta_district_id || row.districtid || row.district_id_provider,
        provider_zone_id: row.provider_zone_id || row.bosta_zone_id || row.zoneid || row.zone_id_provider,
        provider: row.provider || (row.bosta_code || row.zone_code ? "bosta" : "manual"),
        active: !["false", "0", "no"].includes(String(row.active || "").toLowerCase()),
      });
    });
  }
};

function ShippingLocationsCatalog({ value, language, onChange }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [governorateFilter, setGovernorateFilter] = useState("");
  const [providerFilter, setProviderFilter] = useState("");
  const [draft, setDraft] = useState({
    governorate_name_en: "",
    governorate_name_ar: "",
    city_name_en: "",
    city_name_ar: "",
    district_name_en: "",
    district_name_ar: "",
    zone_name_en: "",
    zone_name_ar: "",
    area_name_en: "",
    area_name_ar: "",
    provider_location_code: "",
    provider_city_id: "",
    provider_district_id: "",
    provider_zone_id: "",
    provider: "manual",
    active: true,
  });
  const locations = useMemo(() => normalizeShippingLocations(value), [value]);
  const normalizedQuery = query.trim().toLowerCase();
  const governorates = useMemo(() => uniqueLocationsBy(locations, "governorate_id"), [locations]);
  const visible = locations.filter((location) => {
    const matchesQuery = !normalizedQuery || locationSearchText(location).includes(normalizedQuery);
    const matchesGovernorate = !governorateFilter || location.governorate_id === governorateFilter;
    const matchesProvider = !providerFilter || location.provider === providerFilter;
    return matchesQuery && matchesGovernorate && matchesProvider;
  });
  const updateRows = (next) => onChange(normalizeShippingLocations(next));
  const patchLocation = (id, patch) => updateRows(locations.map((location) => (location.id === id ? normalizeShippingLocation({ ...location, ...patch }) : location)));
  const deleteLocation = (id) => updateRows(locations.filter((location) => location.id !== id));
  const addLocation = () => {
    const row = normalizeShippingLocation({
      ...draft,
      id: `manual-${Date.now()}`,
      governorate_id: draft.governorate_id || slugifyLocation(draft.governorate_name_en || draft.governorate_name_ar),
      city_id: draft.city_id || slugifyLocation(`${draft.governorate_name_en}-${draft.city_name_en || draft.city_name_ar}`),
      district_id: draft.district_id || draft.area_id || slugifyLocation(`${draft.city_name_en}-${draft.district_name_en || draft.area_name_en || draft.area_name_ar}`),
      zone_id: draft.zone_id || slugifyLocation(`${draft.city_name_en}-${draft.zone_name_en || draft.area_name_en || draft.area_name_ar}`),
      area_id: draft.area_id || draft.district_id || slugifyLocation(`${draft.city_name_en}-${draft.area_name_en || draft.area_name_ar || draft.district_name_en}`),
    });
    if (!row.governorate_name_en && !row.governorate_name_ar) return;
    updateRows([...locations, row]);
    setDraft((current) => ({ ...current, city_name_en: "", city_name_ar: "", district_name_en: "", district_name_ar: "", zone_name_en: "", zone_name_ar: "", area_name_en: "", area_name_ar: "", provider_location_code: "", provider_city_id: "", provider_district_id: "", provider_zone_id: "" }));
  };
  const importLocations = async (file) => {
    if (!file) return;
    const text = await file.text();
    updateRows(parseLocationImport(text));
    toast.success(t("settings.toasts.locationsImported"));
  };
  const exportLocations = () => {
    const blob = new Blob([JSON.stringify(locations, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "egypt-shipping-locations.json";
    anchor.click();
    URL.revokeObjectURL(url);
  };
  const importEgypt = () => {
    updateRows(defaultEgyptShippingLocations);
    toast.success(t("settings.toasts.egyptLocationsImported"));
  };
  return (
    <div className="grid gap-4">
      <div className={`rounded-2xl p-3.5 ${fieldSurface}`}>
        <div className="grid gap-3 xl:grid-cols-[minmax(18rem,1fr)_minmax(12rem,0.35fr)_minmax(12rem,0.3fr)_auto] xl:items-center">
          <label className="relative min-w-0">
            <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("settings.locations.searchPlaceholder")} className={`${inputClass} ps-10`} />
          </label>
          <select value={governorateFilter} onChange={(event) => setGovernorateFilter(event.target.value)} className={inputClass}>
            <option value="">{t("settings.locations.allGovernorates")}</option>
            {governorates.map((location) => <option key={location.governorate_id} value={location.governorate_id}>{locationName(location, language, "governorate")}</option>)}
          </select>
          <select value={providerFilter} onChange={(event) => setProviderFilter(event.target.value)} className={inputClass}>
            <option value="">{t("settings.locations.allProviders")}</option>
            {shippingProviderOptions.map((provider) => <option key={provider.id} value={provider.id}>{provider.label}</option>)}
          </select>
          <div className="flex flex-wrap gap-2 xl:justify-end">
            <button type="button" onClick={importEgypt} className="inline-flex h-[var(--control-height-md)] items-center gap-2 rounded-[var(--radius-control)] bg-primary px-3 text-xs font-black text-[var(--primary-contrast)] dark:bg-white dark:text-[var(--primary-contrast)]"><MapPin className="h-4 w-4" />{t("settings.locations.importEgypt")}</button>
            <button type="button" onClick={exportLocations} className="inline-flex h-[var(--control-height-md)] items-center gap-2 rounded-[var(--radius-control)] border border-slate-200 bg-white px-3 text-xs font-black text-slate-700 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-200"><Download className="h-4 w-4" />{t("settings.locations.export")}</button>
            <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-[var(--radius-card)] border border-slate-200 bg-white px-3 text-xs font-black text-slate-700 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-200">
              <Upload className="h-4 w-4" />Import Bosta locations CSV
              <input type="file" accept=".json,.csv,application/json,text/csv" className="sr-only" onChange={(event) => importLocations(event.target.files?.[0])} />
            </label>
          </div>
        </div>
      </div>

      <div className={`rounded-2xl p-4 ${fieldSurface}`}>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {["governorate_name_en", "governorate_name_ar", "city_name_en", "city_name_ar", "district_name_en", "district_name_ar", "zone_name_en", "zone_name_ar", "provider_city_id", "provider_district_id", "provider_zone_id"].map((key) => (
            <input key={key} value={draft[key] || ""} onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.value }))} placeholder={key.replaceAll("_", " ")} className={inputClass} />
          ))}
          <select value={draft.provider} onChange={(event) => setDraft((current) => ({ ...current, provider: event.target.value }))} className={inputClass}>
            {shippingProviderOptions.map((provider) => <option key={provider.id} value={provider.id}>{provider.label}</option>)}
          </select>
        </div>
        <button type="button" onClick={addLocation} className="mt-3 inline-flex h-[var(--control-height-lg)] items-center gap-2 rounded-[var(--radius-control)] bg-primary px-4 text-xs font-black text-[var(--primary-contrast)] dark:bg-white dark:text-[var(--primary-contrast)]"><Plus className="h-4 w-4" />{t("settings.locations.addLocation")}</button>
      </div>

      <div className="overflow-auto rounded-[var(--radius-card)] border border-slate-200 bg-white dark:border-white/10 dark:bg-slate-950/70">
        <table className="m1-table m1-table--compact min-w-[1320px] w-full text-sm">
          <thead className="sticky top-0 bg-slate-50 text-[11px] font-black uppercase text-slate-500 dark:bg-slate-900 dark:text-slate-400">
            <tr>{["Governorate", "City / Markaz", "District", "Zone", "Provider", "Provider IDs", "Active", ""].map((header) => <th key={header} className="px-3 py-3 text-start">{header}</th>)}</tr>
          </thead>
          <tbody>
            {visible.map((location) => (
              <tr key={location.id} className="border-b border-slate-100 dark:border-white/10">
                <td className="border-b border-slate-100 p-2 dark:border-white/10"><input value={location.governorate_name_en} onChange={(event) => patchLocation(location.id, { governorate_name_en: event.target.value })} className={`${inputClass} h-[var(--control-height-md)] rounded-[var(--radius-control)] text-xs`} /><input value={location.governorate_name_ar} onChange={(event) => patchLocation(location.id, { governorate_name_ar: event.target.value })} className={`${inputClass} mt-1 h-[var(--control-height-md)] rounded-[var(--radius-control)] text-xs`} /></td>
                <td className="border-b border-slate-100 p-2 dark:border-white/10"><input value={location.city_name_en} onChange={(event) => patchLocation(location.id, { city_name_en: event.target.value })} className={`${inputClass} h-[var(--control-height-md)] rounded-[var(--radius-control)] text-xs`} /><input value={location.city_name_ar} onChange={(event) => patchLocation(location.id, { city_name_ar: event.target.value })} className={`${inputClass} mt-1 h-[var(--control-height-md)] rounded-[var(--radius-control)] text-xs`} /></td>
                <td className="border-b border-slate-100 p-2 dark:border-white/10"><input value={location.district_name_en} onChange={(event) => patchLocation(location.id, { district_name_en: event.target.value, area_name_en: event.target.value })} className={`${inputClass} h-[var(--control-height-md)] rounded-[var(--radius-control)] text-xs`} /><input value={location.district_name_ar} onChange={(event) => patchLocation(location.id, { district_name_ar: event.target.value, area_name_ar: event.target.value })} className={`${inputClass} mt-1 h-[var(--control-height-md)] rounded-[var(--radius-control)] text-xs`} /></td>
                <td className="border-b border-slate-100 p-2 dark:border-white/10"><input value={location.zone_name_en} onChange={(event) => patchLocation(location.id, { zone_name_en: event.target.value })} className={`${inputClass} h-[var(--control-height-md)] rounded-[var(--radius-control)] text-xs`} /><input value={location.zone_name_ar} onChange={(event) => patchLocation(location.id, { zone_name_ar: event.target.value })} className={`${inputClass} mt-1 h-[var(--control-height-md)] rounded-[var(--radius-control)] text-xs`} /></td>
                <td className="border-b border-slate-100 p-2 dark:border-white/10"><select value={location.provider} onChange={(event) => patchLocation(location.id, { provider: event.target.value })} className={`${inputClass} h-[var(--control-height-md)] rounded-[var(--radius-control)] text-xs`}>{shippingProviderOptions.map((provider) => <option key={provider.id} value={provider.id}>{provider.label}</option>)}</select></td>
                <td className="border-b border-slate-100 p-2 dark:border-white/10">
                  <input value={location.provider_city_id} onChange={(event) => patchLocation(location.id, { provider_city_id: event.target.value })} className={`${inputClass} h-[var(--control-height-md)] rounded-[var(--radius-control)] text-xs`} placeholder={t("settings.locations.providerCityId")} />
                  <input value={location.provider_district_id} onChange={(event) => patchLocation(location.id, { provider_district_id: event.target.value })} className={`${inputClass} mt-1 h-[var(--control-height-md)] rounded-[var(--radius-control)] text-xs`} placeholder={t("settings.locations.providerDistrictId")} />
                  <input value={location.provider_zone_id} onChange={(event) => patchLocation(location.id, { provider_zone_id: event.target.value, provider_location_code: event.target.value })} className={`${inputClass} mt-1 h-[var(--control-height-md)] rounded-[var(--radius-control)] text-xs`} placeholder={t("settings.locations.providerZoneId")} />
                </td>
                <td className="border-b border-slate-100 p-2 dark:border-white/10"><TogglePill compact label={t("settings.locations.active")} checked={location.active} onChange={(active) => patchLocation(location.id, { active })} /></td>
                <td className="border-b border-slate-100 p-2 text-end dark:border-white/10"><button type="button" onClick={() => deleteLocation(location.id)} className="grid h-[var(--control-height-md)] w-9 place-items-center rounded-[var(--radius-control)] border border-rose-200 text-rose-600 hover:bg-rose-50 dark:border-rose-400/25 dark:text-rose-200"><Trash2 className="h-4 w-4" /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {!visible.length ? <div className={`p-8 text-center text-sm font-bold ${bodyText}`}>{t("settings.locations.noMatch")}</div> : null}
      </div>
    </div>
  );
}

function ShippingZonesEditor({ value, locations = [], language, defaultPrice, onChange }) {
  const { t } = useTranslation();
  const copy = { ...shippingUi.en, ...(shippingUi[language] || {}) };
  const [query, setQuery] = useState("");
  const [governorateFilter, setGovernorateFilter] = useState("");
  const [providerFilter, setProviderFilter] = useState("");
  const [selected, setSelected] = useState([]);
  const [expandedRules, setExpandedRules] = useState({});
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [freezeColumns, setFreezeColumns] = useState(false);
  const [density, setDensity] = useState(() => {
    if (typeof window === "undefined") return "comfortable";
    return ["comfortable", "compact", "ultra"].includes(window.localStorage.getItem("shippingZonesDensity"))
      ? window.localStorage.getItem("shippingZonesDensity")
      : "comfortable";
  });
  const [bulkPrice, setBulkPrice] = useState("");
  const [bulkEstimate, setBulkEstimate] = useState("");
  const [draft, setDraft] = useState({ governorate: "Cairo", city: "", area: "", price: defaultPrice || 0 });
  const zones = useMemo(() => (Array.isArray(value) ? value : []).map(normalizeShippingZoneRow), [value]);
  const duplicateCounts = useMemo(() => zones.reduce((map, zone) => {
    const key = ruleIdentity(zone);
    map.set(key, (map.get(key) || 0) + 1);
    return map;
  }, new Map()), [zones]);
  const normalizedQuery = query.trim().toLowerCase();
  const governorateOptions = useMemo(() => Array.from(new Set([...egyptGovernorates.map(([, name]) => name), ...zones.map((zone) => zone.governorate).filter(Boolean)])).sort(), [zones]);
  const activeLocations = useMemo(() => normalizeShippingLocations(locations).filter((location) => location.active), [locations]);
  const catalogGovernorates = useMemo(() => uniqueLocationsBy(activeLocations, "governorate_id"), [activeLocations]);
  const catalogCities = useMemo(() => uniqueLocationsBy(activeLocations, "city_id", (location) => !draft.governorate_id || location.governorate_id === draft.governorate_id), [activeLocations, draft.governorate_id]);
  const catalogDistricts = useMemo(() => uniqueLocationsBy(activeLocations, "district_id", (location) => !draft.city_id || location.city_id === draft.city_id), [activeLocations, draft.city_id]);
  const catalogZones = useMemo(() => uniqueLocationsBy(activeLocations, "zone_id", (location) => !draft.district_id || location.district_id === draft.district_id), [activeLocations, draft.district_id]);
  const visibleZones = zones.filter((zone) => {
    const matchesQuery = !normalizedQuery || [zone.governorate, zone.arabic_alias, zone.city, zone.district, zone.area, zone.zone, zone.provider, zone.provider_location_code, zone.provider_city_id, zone.provider_district_id, zone.provider_zone_id, zone.estimated_delivery_text].join(" ").toLowerCase().includes(normalizedQuery);
    const matchesGovernorate = !governorateFilter || normalizeZoneKey(zone.governorate) === normalizeZoneKey(governorateFilter);
    const matchesProvider = !providerFilter || normalizeProviderKey(zone.provider_id || zone.provider) === providerFilter;
    return matchesQuery && matchesGovernorate && matchesProvider;
  });
  const selectedSet = new Set(selected);
  const selectedCount = selected.filter((id) => zones.some((zone) => zone.id === id)).length;
  const toggleRuleExpanded = (id) => setExpandedRules((current) => ({ ...current, [id]: !current[id] }));
  const toggleFullScreen = useCallback(() => {
    if (typeof window !== "undefined" && window.innerWidth < 768) return;
    setIsFullScreen((current) => !current);
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") window.localStorage.setItem("shippingZonesDensity", density);
  }, [density]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === "Escape" && isFullScreen) {
        event.preventDefault();
        setIsFullScreen(false);
        return;
      }
      if (event.key?.toLowerCase() !== "f" || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target;
      const tagName = target?.tagName?.toLowerCase();
      if (target?.isContentEditable || ["input", "textarea", "select", "button"].includes(tagName)) return;
      event.preventDefault();
      toggleFullScreen();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isFullScreen, toggleFullScreen]);

  useEffect(() => {
    if (!isFullScreen || typeof document === "undefined") return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isFullScreen]);

  const updateRows = (next) => {
    const seen = new Set();
    let skipped = 0;
    const normalized = next.map(normalizeShippingZoneRow).filter((zone) => {
      const key = ruleIdentity(zone);
      if (!zone.governorate || seen.has(key)) {
        skipped += seen.has(key) ? 1 : 0;
        return Boolean(zone.governorate) && !seen.has(key);
      }
      seen.add(key);
      return true;
    });
    if (skipped) toast.error(copy.duplicatePrevented);
    onChange(normalized);
  };
  const patchRow = (id, patch) => {
    const target = zones.find((zone) => zone.id === id);
    if (!target) return;
    const nextTarget = normalizeShippingZoneRow({ ...target, ...patch });
    const nextKey = ruleIdentity(nextTarget);
    const duplicate = zones.some((zone) => zone.id !== id && ruleIdentity(zone) === nextKey);
    if (duplicate) {
      toast.error(copy.duplicatePrevented);
      return;
    }
    updateRows(zones.map((zone) => (zone.id === id ? nextTarget : zone)));
  };
  const addRow = (scope = "governorate") => {
    const selectedGovernorate = egyptGovernorates.find(([, name]) => name === draft.governorate);
    const [, governorate = draft.governorate, arabic_alias = ""] = selectedGovernorate || [];
    const row = normalizeShippingZoneRow({
      id: `zone-${Date.now()}-${zones.length}`,
      governorate_id: draft.governorate_id || "",
      governorate,
      arabic_alias,
      city_id: scope !== "governorate" ? draft.city_id || "" : "",
      city: scope !== "governorate" ? draft.city : "",
      district_id: scope === "area" ? draft.district_id || draft.area_id || "" : "",
      zone_id: scope === "area" ? draft.zone_id || "" : "",
      area_id: scope === "area" ? draft.area_id || draft.district_id || "" : "",
      district: scope === "area" ? draft.district || draft.area : "",
      area: scope === "area" ? draft.area : "",
      zone: scope === "area" ? draft.zone || draft.area : "",
      provider_location_code: scope === "area" ? draft.provider_location_code || draft.provider_zone_id || "" : "",
      provider_city_id: draft.provider_city_id || "",
      provider_district_id: scope === "area" ? draft.provider_district_id || "" : "",
      provider_zone_id: scope === "area" ? draft.provider_zone_id || "" : "",
      price: Number.isFinite(Number(draft.price)) ? Number(draft.price) : defaultPrice || 0,
      requires_shipping_proof: governorate !== "Damietta",
      estimated_delivery_text: governorate === "Damietta" ? "1-2 business days" : "2-5 business days",
      provider: draft.provider || "in_store_delivery",
      provider_id: draft.provider || "in_store_delivery",
      active: true,
    }, zones.length);
    if (zones.some((zone) => ruleIdentity(zone) === ruleIdentity(row))) {
      toast.error(copy.duplicatePrevented);
      return;
    }
    updateRows([...zones, row]);
    setDraft((current) => ({ ...current, city: "", area: "", district: "", zone: "", city_id: "", area_id: "", district_id: "", zone_id: "", provider_city_id: "", provider_district_id: "", provider_zone_id: "", provider_location_code: "" }));
  };
  const applyDraftLocation = (scope, id) => {
    const location = activeLocations.find((item) => item[`${scope}_id`] === id);
    if (!location) return;
    setDraft((current) => ({
      ...current,
      governorate_id: location.governorate_id,
      governorate: location.governorate_name_en || location.governorate_name_ar,
      city_id: scope === "governorate" ? "" : location.city_id,
      city: scope === "governorate" ? "" : location.city_name_en || location.city_name_ar,
      district_id: scope === "area" || scope === "district" ? location.district_id : "",
      zone_id: scope === "area" ? location.zone_id : "",
      area_id: scope === "area" ? location.area_id || location.district_id : "",
      district: scope === "area" || scope === "district" ? location.district_name_en || location.district_name_ar || location.area_name_en || location.area_name_ar : "",
      area: scope === "area" ? location.area_name_en || location.area_name_ar || location.district_name_en || location.district_name_ar : "",
      zone: scope === "area" ? location.zone_name_en || location.zone_name_ar || location.area_name_en || location.area_name_ar : "",
      provider_location_code: scope === "area" ? location.provider_location_code || location.provider_zone_id : "",
      provider_city_id: scope === "governorate" ? "" : location.provider_city_id || "",
      provider_district_id: scope === "area" || scope === "district" ? location.provider_district_id || "" : "",
      provider_zone_id: scope === "area" ? location.provider_zone_id || "" : "",
      provider: location.provider || current.provider,
    }));
  };
  const deleteRow = (id) => {
    updateRows(zones.filter((zone) => zone.id !== id));
    setSelected((current) => current.filter((item) => item !== id));
  };
  const addAllGovernorates = () => {
    const existing = new Set(zones.filter((zone) => !zone.city && !zone.area).map((zone) => normalizeZoneKey(zone.governorate)));
    const missing = shippingZonePresets.filter((zone) => !zone.city && !existing.has(normalizeZoneKey(zone.governorate)));
    updateRows([...zones, ...missing]);
    toast.success(copy.seeded);
  };
  const applyToSelected = (patch) => {
    if (!selectedCount) return;
    updateRows(zones.map((zone) => (selectedSet.has(zone.id) ? { ...zone, ...patch } : zone)));
  };
  const applyBulkPrice = () => {
    const price = Number(bulkPrice);
    if (!Number.isFinite(price) || price < 0 || !selectedCount) return;
    applyToSelected({ price });
  };
  const applyBulkEstimate = () => {
    const estimated_delivery_text = bulkEstimate.trim();
    if (!estimated_delivery_text || !selectedCount) return;
    applyToSelected({ estimated_delivery_text });
  };
  const deleteSelected = () => {
    if (!selectedCount) return;
    updateRows(zones.filter((zone) => !selectedSet.has(zone.id)));
    setSelected([]);
  };
  const exportZones = () => {
    const blob = new Blob([JSON.stringify(zones, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "storefront-shipping-zones.json";
    anchor.click();
    URL.revokeObjectURL(url);
  };
  const importZones = async (file) => {
    if (!file) return;
    const text = await file.text();
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) updateRows(parsed);
    } catch {
      const [headerLine, ...lines] = text.split(/\r?\n/).filter(Boolean);
      const headers = headerLine.split(",").map((item) => item.trim().toLowerCase());
      const rows = lines.map((line, index) => {
        const cells = line.split(",").map((item) => item.trim());
        const row = Object.fromEntries(headers.map((header, cellIndex) => [header, cells[cellIndex] || ""]));
        return normalizeShippingZoneRow({
          id: row.id || `import-${Date.now()}-${index}`,
          governorate_id: row.governorate_id,
          governorate: row.governorate,
          city_id: row.city_id,
          city: row.city || row.markaz,
          district_id: row.district_id || row.area_id || row.location_id,
          zone_id: row.zone_id || row.provider_zone_id || row.zone_code,
          area_id: row.area_id || row.district_id || row.location_id,
          district: row.district || row.area,
          area: row.area || row.district || row.zone,
          zone: row.zone || row.area || row.district,
          provider_location_code: row.provider_location_code || row.provider_zone_id || row.zone_code,
          provider_city_id: row.provider_city_id || row.bosta_city_id,
          provider_district_id: row.provider_district_id || row.bosta_district_id,
          provider_zone_id: row.provider_zone_id || row.bosta_zone_id || row.zone_code,
          price: row.price || row.shipping_price,
          requires_shipping_proof: !["false", "0", "no"].includes(String(row.requires_shipping_proof || "").toLowerCase()),
          estimated_delivery_text: row.estimated_delivery_text || row.eta,
          arabic_alias: row.arabic_alias || row.alias_ar,
          provider: normalizeProviderKey(row.provider || row.shipping_provider),
          provider_id: normalizeProviderKey(row.provider_id || row.shipping_provider_id || row.provider || row.shipping_provider),
          free_shipping_threshold: row.free_shipping_threshold,
          active: !["false", "0", "no"].includes(String(row.active || "").toLowerCase()),
        });
      });
      updateRows(rows);
    }
  };
  const toggleVisibleSelection = (checked) => setSelected(checked ? Array.from(new Set([...selected, ...visibleZones.map((zone) => zone.id)])) : selected.filter((id) => !visibleZones.some((zone) => zone.id === id)));
  const densityOptions = [
    ["comfortable", copy.comfortable],
    ["compact", copy.compact],
    ["ultra", copy.ultraCompact],
  ];
  const renderZonesTable = ({ fullScreenMode = false } = {}) => {
    const tableDensity = fullScreenMode ? density : "comfortable";
    const frozen = fullScreenMode && freezeColumns;
    const tableMinWidth = tableDensity === "ultra" ? "min-w-[1040px]" : tableDensity === "compact" ? "min-w-[1120px]" : "min-w-[1180px]";
    const tableHeight = fullScreenMode ? "h-[calc(100vh-9.5rem)]" : "max-h-[42rem]";
    return (
      <div className={`${tableHeight} overflow-auto rounded-[var(--radius-card)] border ${fullScreenMode ? "border-white/10 bg-slate-950" : "border-slate-200 bg-white dark:border-white/10 dark:bg-slate-950/70"}`}>
        <table className={`m1-table m1-table--compact ${tableMinWidth} w-full ${tableDensity === "ultra" ? "text-xs" : "text-sm"}`}>
          <thead className={`sticky top-0 z-10 text-[11px] font-black uppercase ${fullScreenMode ? "bg-slate-900 text-slate-300" : "bg-slate-50 text-slate-500 dark:bg-slate-900 dark:text-slate-400"}`}>
            <tr>
              <th className={`${frozen ? "sticky left-0 z-20 bg-inherit" : ""} w-10 px-3 py-3 text-start`}></th>
              <th className={`${frozen ? "sticky left-10 z-20 bg-inherit" : ""} w-36 px-3 py-3 text-start`}>{t("settings.locations.governorate")}</th>
              <th className={`${frozen ? "sticky left-[11.5rem] z-20 bg-inherit" : ""} w-36 px-3 py-3 text-start`}>{t("settings.locations.city")}</th>
              {["Area", "Provider", "Shipping Cost", "Proof", "ETA", "Active", ""].map((header) => (
                <th key={header} className="px-3 py-3 text-start">{header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleZones.map((zone) => (
              <ZoneRuleTableRow
                key={zone.id}
                zone={zone}
                zones={zones}
                locations={activeLocations}
                language={language}
                copy={copy}
                defaultPrice={defaultPrice}
                selected={selectedSet.has(zone.id)}
                expanded={Boolean(expandedRules[zone.id])}
                duplicate={duplicateCounts.get(ruleIdentity(zone)) > 1}
                density={tableDensity}
                freezeColumns={frozen}
                onSelect={(checked) => setSelected((current) => checked ? [...current, zone.id] : current.filter((item) => item !== zone.id))}
                onPatch={(patch) => patchRow(zone.id, patch)}
                onDelete={() => deleteRow(zone.id)}
                onExpand={() => toggleRuleExpanded(zone.id)}
              />
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <article className="grid gap-4">
      <div className={`rounded-2xl p-3.5 ${fieldSurface}`}>
        <div className="grid gap-3 xl:grid-cols-[minmax(20rem,1fr)_minmax(12rem,0.3fr)_minmax(12rem,0.3fr)_auto] xl:items-center">
          <label className="relative min-w-0">
            <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={copy.search} className={`${inputClass} ps-10`} />
          </label>
          <label className="relative min-w-0">
            <Filter className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <select value={governorateFilter} onChange={(event) => setGovernorateFilter(event.target.value)} className={`${inputClass} ps-10`}>
              <option value="">{copy.governorateFilter}: {copy.all}</option>
              {governorateOptions.map((governorate) => <option key={governorate} value={governorate}>{governorate}</option>)}
            </select>
          </label>
          <select value={providerFilter} onChange={(event) => setProviderFilter(event.target.value)} className={inputClass}>
            <option value="">Provider: {copy.all}</option>
            {shippingProviderOptions.map((provider) => <option key={provider.id} value={provider.id}>{provider.label}</option>)}
          </select>
          <div className="flex flex-wrap justify-start gap-2 xl:justify-end">
            <button type="button" onClick={addAllGovernorates} className="inline-flex h-[var(--control-height-md)] items-center gap-2 rounded-[var(--radius-control)] border border-slate-200 bg-white px-3 text-xs font-black text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-200 dark:hover:bg-white/[0.08]"><Plus className="h-4 w-4" />{copy.allGovernorates}</button>
            <button type="button" onClick={exportZones} className="inline-flex h-[var(--control-height-md)] items-center gap-2 rounded-[var(--radius-control)] border border-slate-200 bg-white px-3 text-xs font-black text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 dark:border-white/10 dark:bg-white/[0.035] dark:text-slate-300 dark:hover:bg-white/[0.08]"><Download className="h-3.5 w-3.5" />{copy.export}</button>
            <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-[var(--radius-card)] border border-slate-200 bg-white px-3 text-xs font-black text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 dark:border-white/10 dark:bg-white/[0.035] dark:text-slate-300 dark:hover:bg-white/[0.08]">
              <Upload className="h-3.5 w-3.5" />
              {copy.import}
              <input type="file" accept=".json,.csv,application/json,text/csv" className="sr-only" onChange={(event) => importZones(event.target.files?.[0])} />
            </label>
            <button type="button" onClick={toggleFullScreen} className="hidden h-[var(--control-height-md)] w-9 place-items-center rounded-[var(--radius-control)] border border-slate-200 bg-white text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 dark:border-white/10 dark:bg-white/[0.035] dark:text-slate-300 dark:hover:bg-white/[0.08] md:grid" aria-label={copy.fullScreen} title={`${copy.fullScreen} (${copy.shortcutHint})`}><Maximize2 className="h-4 w-4" /></button>
          </div>
        </div>
      </div>

      <div className={`rounded-2xl p-4 ${fieldSurface}`}>
        <div className="mb-3 flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-xl bg-slate-950 text-white dark:bg-white dark:text-slate-950"><Plus className="h-4 w-4" /></span>
          <h3 className={`m1-section-title ${headingText}`}>{copy.quickTitle}</h3>
        </div>
        <div className="grid gap-3 lg:grid-cols-[minmax(10rem,1fr)_minmax(10rem,1fr)_minmax(10rem,1fr)_minmax(10rem,1fr)_7rem_auto] lg:items-center">
          <select value={draft.governorate_id || ""} onChange={(event) => applyDraftLocation("governorate", event.target.value)} className={inputClass}>
            <option value="">{t("settings.locations.governorate")}</option>
            {catalogGovernorates.map((location) => <option key={location.governorate_id} value={location.governorate_id}>{locationName(location, language, "governorate")}</option>)}
          </select>
          <select value={draft.city_id || ""} onChange={(event) => applyDraftLocation("city", event.target.value)} className={inputClass} disabled={!draft.governorate_id}>
            <option value="">{t("settings.locations.cityMarkaz")}</option>
            {catalogCities.map((location) => <option key={location.city_id} value={location.city_id}>{locationName(location, language, "city")}</option>)}
          </select>
          <select value={draft.district_id || ""} onChange={(event) => applyDraftLocation("district", event.target.value)} className={inputClass} disabled={!draft.city_id}>
            <option value="">{t("settings.locations.district")}</option>
            {catalogDistricts.map((location) => <option key={location.district_id} value={location.district_id}>{locationName(location, language, "district")}</option>)}
          </select>
          <select value={draft.zone_id || ""} onChange={(event) => applyDraftLocation("area", event.target.value)} className={inputClass} disabled={!draft.district_id}>
            <option value="">{t("settings.locations.zone")}</option>
            {catalogZones.map((location) => <option key={location.zone_id} value={location.zone_id}>{locationName(location, language, "zone")}</option>)}
          </select>
          <input type="number" min="0" value={draft.price} onChange={(event) => setDraft((current) => ({ ...current, price: event.target.value }))} placeholder={t("settings.locations.price")} className={inputClass} />
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => addRow("governorate")} className="h-[var(--control-height-lg)] rounded-[var(--radius-control)] bg-primary px-4 text-xs font-black text-[var(--primary-contrast)] shadow-sm transition hover:bg-[var(--primary-hover)] dark:bg-white dark:text-[var(--primary-contrast)] dark:hover:bg-slate-200">{copy.addZone}</button>
            <button type="button" onClick={() => addRow("city")} className="h-[var(--control-height-lg)] rounded-[var(--radius-control)] border border-slate-200 bg-white px-3 text-xs font-black text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-200 dark:hover:bg-white/[0.08]">{copy.createCity}</button>
            <button type="button" onClick={() => addRow("area")} className="h-[var(--control-height-lg)] rounded-[var(--radius-control)] border border-slate-200 bg-white px-3 text-xs font-black text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-200 dark:hover:bg-white/[0.08]">{copy.createArea}</button>
          </div>
        </div>
      </div>

      <div className={`rounded-2xl p-4 ${fieldSurface}`}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex items-center gap-2 rounded-xl bg-slate-100 px-3 py-2 text-xs font-black text-slate-600 dark:bg-white/[0.055] dark:text-slate-300">
            <SlidersHorizontal className="h-4 w-4" />
            {copy.bulk}: {selectedCount} {copy.selected}
          </div>
          <button type="button" onClick={deleteSelected} disabled={!selectedCount} className="inline-flex h-[var(--control-height-md)] items-center gap-2 rounded-[var(--radius-control)] border border-rose-200 bg-white px-3 text-xs font-black text-rose-600 transition hover:bg-rose-50 disabled:opacity-40 dark:border-rose-400/25 dark:bg-white/[0.04] dark:text-rose-200 dark:hover:bg-rose-500/10"><Trash2 className="h-4 w-4" />{copy.deleteSelected}</button>
        </div>
        <div className="grid gap-3 xl:grid-cols-[minmax(14rem,0.8fr)_minmax(18rem,1.1fr)_auto]">
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
            <input type="number" min="0" value={bulkPrice} onChange={(event) => setBulkPrice(event.target.value)} placeholder={copy.bulkPrice} className={inputClass} />
            <button type="button" onClick={applyBulkPrice} disabled={!selectedCount} className="h-[var(--control-height-lg)] rounded-[var(--radius-control)] bg-primary px-4 text-xs font-black text-[var(--primary-contrast)] disabled:opacity-45 dark:bg-white dark:text-[var(--primary-contrast)]">{copy.bulkPrice}</button>
          </div>
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
            <input value={bulkEstimate} onChange={(event) => setBulkEstimate(event.target.value)} placeholder={copy.bulkEstimate} className={inputClass} />
            <button type="button" onClick={applyBulkEstimate} disabled={!selectedCount} className="h-[var(--control-height-lg)] rounded-[var(--radius-control)] bg-primary px-4 text-xs font-black text-[var(--primary-contrast)] disabled:opacity-45 dark:bg-white dark:text-[var(--primary-contrast)]">{copy.bulkEstimate}</button>
          </div>
          <div className="flex flex-wrap gap-2 xl:justify-end">
            <button type="button" onClick={() => applyToSelected({ requires_shipping_proof: true })} disabled={!selectedCount} className="h-[var(--control-height-md)] rounded-[var(--radius-control)] border border-slate-200 bg-white px-3 text-xs font-black text-slate-700 disabled:opacity-40 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-200">{copy.requireProof}</button>
            <button type="button" onClick={() => applyToSelected({ requires_shipping_proof: false })} disabled={!selectedCount} className="h-[var(--control-height-md)] rounded-[var(--radius-control)] border border-slate-200 bg-white px-3 text-xs font-black text-slate-700 disabled:opacity-40 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-200">{copy.skipProof}</button>
          </div>
        </div>
      </div>

      <div className={`rounded-2xl p-3 ${fieldSurface}`}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className={`inline-flex items-center gap-2 text-xs font-black uppercase ${mutedText}`}>
            <MapPin className="h-4 w-4" />
            Governorate / City-Markaz / Area-District
          </div>
          <div className="flex items-center gap-2">
            <label className="inline-flex items-center gap-2 text-xs font-black text-slate-500 dark:text-slate-300">
              <input type="checkbox" className="h-4 w-4" checked={visibleZones.length > 0 && visibleZones.every((zone) => selectedSet.has(zone.id))} onChange={(event) => toggleVisibleSelection(event.target.checked)} />
              Select visible
            </label>
            <button type="button" onClick={toggleFullScreen} className="hidden h-[var(--control-height-md)] w-9 place-items-center rounded-[var(--radius-control)] border border-slate-200 bg-white text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-300 dark:hover:bg-white/[0.08] md:grid" aria-label={copy.fullScreen} title={`${copy.fullScreen} (${copy.shortcutHint})`}><Maximize2 className="h-4 w-4" /></button>
          </div>
        </div>
        {renderZonesTable()}
        {!visibleZones.length ? <div className={`p-8 text-center text-sm font-bold ${bodyText}`}>{copy.empty}</div> : null}
      </div>
      {isFullScreen ? (
        <div className="fixed inset-0 z-[9999] flex flex-col bg-slate-950 p-3 text-white md:p-4" role="dialog" aria-modal="true" aria-label={t("settings.zones.fullscreenAria")}>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-card)] border border-white/10 bg-white/[0.06] px-4 py-3 shadow-2xl backdrop-blur">
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-400 text-slate-950"><PanelLeftClose className="h-5 w-5" /></span>
              <div>
                <h2 className="m1-section-title">{t("settings.zones.fullscreenTitle")}</h2>
                <p className="text-xs font-bold text-slate-400">{visibleZones.length} rules / {copy.shortcutHint} / ESC</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <div className="inline-flex flex-wrap items-center gap-1 rounded-xl bg-slate-900 p-1 ring-1 ring-white/10">
                <span className="px-2 text-[11px] font-black uppercase text-slate-400">{copy.density}</span>
                {densityOptions.map(([id, label]) => (
                  <button key={id} type="button" onClick={() => setDensity(id)} className={`h-[var(--control-height-sm)] rounded-[var(--radius-control)] px-2.5 text-[11px] font-black transition ${density === id ? "bg-white text-slate-950" : "text-slate-300 hover:bg-white/10"}`}>{label}</button>
                ))}
              </div>
              <label className="inline-flex h-9 items-center gap-2 rounded-xl border border-white/10 bg-slate-900 px-3 text-xs font-black text-slate-200">
                <input type="checkbox" className="h-4 w-4" checked={freezeColumns} onChange={(event) => setFreezeColumns(event.target.checked)} />
                {copy.freezeColumns}
              </label>
              <button type="button" onClick={exportZones} className="inline-flex h-[var(--control-height-md)] items-center gap-2 rounded-[var(--radius-control)] border border-white/10 bg-primary px-3 text-xs font-black text-slate-200 transition hover:bg-white/10"><Download className="h-3.5 w-3.5" />{copy.export}</button>
              <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-[var(--radius-card)] border border-white/10 bg-slate-900 px-3 text-xs font-black text-slate-200 transition hover:bg-white/10">
                <Upload className="h-3.5 w-3.5" />
                {copy.import}
                <input type="file" accept=".json,.csv,application/json,text/csv" className="sr-only" onChange={(event) => importZones(event.target.files?.[0])} />
              </label>
              <button type="button" onClick={() => addRow("governorate")} className="inline-flex h-[var(--control-height-md)] items-center gap-2 rounded-[var(--radius-control)] bg-primary px-3 text-xs font-black text-[var(--primary-contrast)] transition hover:bg-[var(--primary-hover)]"><Plus className="h-3.5 w-3.5" />{t("settings.zones.addRule")}</button>
              <button type="button" onClick={toggleFullScreen} className="inline-flex h-[var(--control-height-md)] items-center gap-2 rounded-[var(--radius-control)] border border-white/10 bg-white px-3 text-xs font-black text-slate-950 transition hover:bg-slate-200"><Minimize2 className="h-3.5 w-3.5" />{copy.exitFullScreen}</button>
            </div>
          </div>
          <div className="min-h-0 flex-1">
            {renderZonesTable({ fullScreenMode: true })}
          </div>
        </div>
      ) : null}
    </article>
  );
}

function ZoneRuleTableRow({ zone, zones, locations = [], language = "en", copy, defaultPrice, selected, expanded, duplicate, density, freezeColumns, onSelect, onPatch, onDelete, onExpand }) {
  const { t } = useTranslation();
  const provider = normalizeProviderKey(zone.provider_id || zone.provider);
  const isUltra = density === "ultra";
  const isCompact = density === "compact" || isUltra;
  const cellPadding = isUltra ? "px-2 py-1" : isCompact ? "px-2.5 py-1.5" : "px-3 py-2";
  const inputHeight = isUltra ? "h-7" : isCompact ? "h-8" : "h-9";
  const inputText = isUltra ? "text-[11px]" : "text-xs";
  const pillCompact = isCompact;
  const stickyCell = freezeColumns ? "sticky z-10 shadow-[1px_0_0_rgba(148,163,184,0.18)]" : "";
  const winner = resolveRuleWinner(zones, zone, defaultPrice);
  const isWinner = winner?.id === zone.id;
  const overlaps = zones.some((candidate) =>
    candidate.id !== zone.id &&
    normalizeZoneKey(candidate.governorate) === normalizeZoneKey(zone.governorate) &&
    (
      !candidate.city ||
      !zone.city ||
      normalizeZoneKey(candidate.city) === normalizeZoneKey(zone.city)
    )
  );
  const providerSelect = (
    <select value={provider} onChange={(event) => onPatch({ provider: event.target.value, provider_id: event.target.value })} className={`${inputClass} ${inputHeight} rounded-[var(--radius-control)] ${inputText}`}>
      {shippingProviderOptions.map((providerOption) => (
        <option key={providerOption.id} value={providerOption.id}>{providerOption.label}</option>
      ))}
    </select>
  );
  const governorateLocations = uniqueLocationsBy(locations, "governorate_id");
  const cityLocations = uniqueLocationsBy(locations, "city_id", (location) => !zone.governorate_id || location.governorate_id === zone.governorate_id);
  const districtLocations = uniqueLocationsBy(locations, "district_id", (location) => !zone.city_id || location.city_id === zone.city_id);
  const zoneLocations = uniqueLocationsBy(locations, "zone_id", (location) => !zone.district_id || location.district_id === zone.district_id);
  const applyLocationPatch = (scope, id) => {
    const location = locations.find((item) => item[`${scope}_id`] === id);
    if (!location) return;
    if (scope === "governorate") {
      onPatch({
        governorate_id: location.governorate_id,
        governorate: location.governorate_name_en || location.governorate_name_ar,
        city_id: "",
        city: "",
        district_id: "",
        district: "",
        zone_id: "",
        zone: "",
        area_id: "",
        area: "",
        provider_location_code: "",
        provider_city_id: "",
        provider_district_id: "",
        provider_zone_id: "",
      });
    } else if (scope === "city") {
      onPatch({
        governorate_id: location.governorate_id,
        governorate: location.governorate_name_en || location.governorate_name_ar,
        city_id: location.city_id,
        city: location.city_name_en || location.city_name_ar,
        district_id: "",
        district: "",
        zone_id: "",
        zone: "",
        area_id: "",
        area: "",
        provider_location_code: "",
        provider_city_id: location.provider_city_id || "",
        provider_district_id: "",
        provider_zone_id: "",
      });
    } else if (scope === "district") {
      onPatch({
        governorate_id: location.governorate_id,
        governorate: location.governorate_name_en || location.governorate_name_ar,
        city_id: location.city_id,
        city: location.city_name_en || location.city_name_ar,
        district_id: location.district_id,
        district: location.district_name_en || location.district_name_ar || location.area_name_en || location.area_name_ar,
        zone_id: "",
        zone: "",
        area_id: "",
        area: "",
        provider_location_code: "",
        provider_city_id: location.provider_city_id || "",
        provider_district_id: location.provider_district_id || "",
        provider_zone_id: "",
      });
    } else {
      onPatch({
        governorate_id: location.governorate_id,
        governorate: location.governorate_name_en || location.governorate_name_ar,
        city_id: location.city_id,
        city: location.city_name_en || location.city_name_ar,
        district_id: location.district_id,
        district: location.district_name_en || location.district_name_ar || location.area_name_en || location.area_name_ar,
        zone_id: location.zone_id,
        zone: location.zone_name_en || location.zone_name_ar || location.area_name_en || location.area_name_ar,
        area_id: location.area_id || location.district_id,
        area: location.area_name_en || location.area_name_ar || location.district_name_en || location.district_name_ar,
        provider_location_code: location.provider_location_code || location.provider_zone_id,
        provider_city_id: location.provider_city_id || "",
        provider_district_id: location.provider_district_id || "",
        provider_zone_id: location.provider_zone_id || "",
        provider: location.provider || zone.provider,
        provider_id: location.provider || zone.provider_id,
      });
    }
  };
  const advancedPanel = expanded ? (
    <div className="grid gap-3 border-t border-slate-100 p-3 dark:border-white/10 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
      <div className="grid gap-2">
        <div className="flex flex-wrap gap-2">
          <span className="inline-flex w-fit items-center rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-black text-slate-600 dark:border-white/10 dark:bg-white/[0.05] dark:text-slate-300">{ruleType(zone)}</span>
          <span className="inline-flex w-fit items-center rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] font-black text-blue-700 dark:border-blue-400/25 dark:bg-blue-500/10 dark:text-blue-100">{copy.priority}: {rulePriorityLabel(zone)}</span>
          {duplicate ? <span className="inline-flex w-fit items-center rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-black text-amber-800 dark:border-amber-400/25 dark:bg-amber-500/10 dark:text-amber-100">{copy.duplicateRule}</span> : null}
          {overlaps ? <span className={`inline-flex w-fit items-center rounded-full border px-2.5 py-1 text-[11px] font-black ${isWinner ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-400/25 dark:bg-emerald-500/10 dark:text-emerald-100" : "border-slate-200 bg-slate-50 text-slate-600 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-300"}`}>{isWinner ? copy.winningRule : `${copy.overriddenBy}: ${winner ? zoneLabel(winner) : "Default"}`}</span> : null}
        </div>
        <p className={`text-xs font-bold leading-5 ${bodyText}`}>{ruleSummary(zone)}</p>
        <div className="rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-xs font-black text-violet-800 dark:border-violet-400/25 dark:bg-violet-500/10 dark:text-violet-100">
          {copy.testResult}: {winner ? ruleSummary(winner) : `Default -> ${Number(defaultPrice || 0).toLocaleString()} EGP`}
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <input type="number" min="0" value={zone.free_shipping_threshold} onChange={(event) => onPatch({ free_shipping_threshold: Number(event.target.value) })} className={`${inputClass} h-[var(--control-height-md)] rounded-[var(--radius-control)] text-center`} placeholder={t("settings.zones.freeOver")} />
        <input type="number" min="0" value={zone.delivery_min_days} onChange={(event) => onPatch({ delivery_min_days: event.target.value === "" ? "" : Number(event.target.value) })} className={`${inputClass} h-[var(--control-height-md)] rounded-[var(--radius-control)] text-center`} placeholder={t("settings.zones.deliveryMinDays")} />
        <input type="number" min="0" value={zone.delivery_max_days} onChange={(event) => onPatch({ delivery_max_days: event.target.value === "" ? "" : Number(event.target.value) })} className={`${inputClass} h-[var(--control-height-md)] rounded-[var(--radius-control)] text-center`} placeholder={t("settings.zones.deliveryMaxDays")} />
        <label className={`sm:col-span-2 flex items-center justify-between gap-3 rounded-xl border border-slate-200 px-3 py-2 text-xs font-black dark:border-white/10 ${bodyText}`}>
          <span>{language === "ar" ? "استخدام مدة تجهيز خاصة لهذه المنطقة" : "Use a custom handling time for this zone"}</span>
          <input
            type="checkbox"
            checked={zone.handling_time_override_enabled}
            onChange={(event) => onPatch({ handling_time_override_enabled: event.target.checked })}
            className="h-5 w-5 accent-amber-500"
          />
        </label>
        {zone.handling_time_override_enabled ? (
          <>
            <input type="number" min="0" step="1" value={zone.handling_min_days} onChange={(event) => onPatch({ handling_min_days: event.target.value === "" ? "" : Number(event.target.value) })} className={`${inputClass} h-[var(--control-height-md)] rounded-[var(--radius-control)] text-center`} placeholder={language === "ar" ? "أقل مدة تجهيز" : "Handling min days"} />
            <input type="number" min="0" step="1" value={zone.handling_max_days} onChange={(event) => onPatch({ handling_max_days: event.target.value === "" ? "" : Number(event.target.value) })} className={`${inputClass} h-[var(--control-height-md)] rounded-[var(--radius-control)] text-center`} placeholder={language === "ar" ? "أقصى مدة تجهيز" : "Handling max days"} />
          </>
        ) : null}
        <input type="number" min="0" value={zone.transit_min_days} onChange={(event) => onPatch({ transit_min_days: event.target.value === "" ? "" : Number(event.target.value) })} className={`${inputClass} h-[var(--control-height-md)] rounded-[var(--radius-control)] text-center`} placeholder={t("settings.zones.transitMinDays")} />
        <input type="number" min="0" value={zone.transit_max_days} onChange={(event) => onPatch({ transit_max_days: event.target.value === "" ? "" : Number(event.target.value) })} className={`${inputClass} h-[var(--control-height-md)] rounded-[var(--radius-control)] text-center`} placeholder={t("settings.zones.transitMaxDays")} />
        <input type="hidden" value={zone.provider_city_id || ""} readOnly />
        <input type="hidden" value={zone.provider_district_id || ""} readOnly />
        <input type="hidden" value={zone.provider_zone_id || ""} readOnly />
        <details className="sm:col-span-2 rounded-[var(--radius-card)] border border-slate-200 bg-white p-3 dark:border-white/10 dark:bg-slate-950">
          <summary className={`cursor-pointer text-xs font-black uppercase ${mutedText}`}>{t("settings.zones.providerMappingIds")}</summary>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <input value={zone.provider_city_id || ""} onChange={(event) => onPatch({ provider_city_id: event.target.value })} className={`${inputClass} h-[var(--control-height-md)] rounded-[var(--radius-control)] text-xs`} placeholder="provider_city_id" />
            <input value={zone.provider_district_id || ""} onChange={(event) => onPatch({ provider_district_id: event.target.value })} className={`${inputClass} h-[var(--control-height-md)] rounded-[var(--radius-control)] text-xs`} placeholder="provider_district_id" />
            <input value={zone.provider_zone_id || ""} onChange={(event) => onPatch({ provider_zone_id: event.target.value, provider_location_code: event.target.value })} className={`${inputClass} h-[var(--control-height-md)] rounded-[var(--radius-control)] text-xs`} placeholder="provider_zone_id" />
          </div>
        </details>
      </div>
    </div>
  ) : null;

  return (
    <>
      <tr className={`${isWinner && overlaps ? "bg-emerald-50/60 dark:bg-emerald-500/8" : duplicate ? "bg-amber-50/70 dark:bg-amber-500/8" : "bg-white dark:bg-slate-950/70"} border-b border-slate-100 dark:border-white/10`}>
        <td className={`${cellPadding} ${stickyCell} left-0 border-b border-slate-100 bg-inherit dark:border-white/10`}>
          <input type="checkbox" className="h-4 w-4" checked={selected} onChange={(event) => onSelect(event.target.checked)} />
        </td>
        <td className={`${cellPadding} ${stickyCell} left-10 w-36 border-b border-slate-100 bg-inherit dark:border-white/10`}><select value={zone.governorate_id || ""} onChange={(event) => applyLocationPatch("governorate", event.target.value)} className={`${inputClass} ${inputHeight} rounded-[var(--radius-control)] ${inputText}`}><option value="">{zone.governorate || "Governorate"}</option>{governorateLocations.map((location) => <option key={location.governorate_id} value={location.governorate_id}>{locationName(location, language, "governorate")}</option>)}</select></td>
        <td className={`${cellPadding} ${stickyCell} left-[11.5rem] w-36 border-b border-slate-100 bg-inherit dark:border-white/10`}><select value={zone.city_id || ""} onChange={(event) => applyLocationPatch("city", event.target.value)} className={`${inputClass} ${inputHeight} rounded-[var(--radius-control)] ${inputText}`}><option value="">{zone.city || "City / Markaz"}</option>{cityLocations.map((location) => <option key={location.city_id} value={location.city_id}>{locationName(location, language, "city")}</option>)}</select></td>
        <td className={`${cellPadding} border-b border-slate-100 dark:border-white/10`}>
          <div className="grid gap-1">
            <select value={zone.district_id || ""} onChange={(event) => applyLocationPatch("district", event.target.value)} className={`${inputClass} ${inputHeight} rounded-[var(--radius-control)] ${inputText}`}>
              <option value="">{zone.district || zone.area || "District"}</option>
              {districtLocations.map((location) => <option key={location.district_id} value={location.district_id}>{locationName(location, language, "district")}</option>)}
            </select>
            <select value={zone.zone_id || ""} onChange={(event) => applyLocationPatch("area", event.target.value)} className={`${inputClass} ${inputHeight} rounded-[var(--radius-control)] ${inputText}`}>
              <option value="">{zone.zone || zone.area || "Zone"}</option>
              {zoneLocations.map((location) => <option key={location.zone_id} value={location.zone_id}>{locationName(location, language, "zone")}</option>)}
            </select>
          </div>
        </td>
        <td className={`${cellPadding} border-b border-slate-100 dark:border-white/10`}>{providerSelect}</td>
        <td className={`${cellPadding} border-b border-slate-100 dark:border-white/10`}><input type="number" min="0" value={zone.price} onChange={(event) => onPatch({ price: Number(event.target.value) })} className={`${inputClass} ${inputHeight} w-20 rounded-[var(--radius-control)] text-center ${inputText}`} /></td>
        <td className={`${cellPadding} border-b border-slate-100 dark:border-white/10`}><TogglePill compact={pillCompact} label={t("settings.zones.proof")} checked={Boolean(zone.requires_shipping_proof)} onChange={(checked) => onPatch({ requires_shipping_proof: checked })} /></td>
        <td className={`${cellPadding} border-b border-slate-100 dark:border-white/10`}><input value={zone.estimated_delivery_text} onChange={(event) => onPatch({ estimated_delivery_text: event.target.value })} className={`${inputClass} ${inputHeight} min-w-36 rounded-[var(--radius-control)] ${inputText}`} placeholder="ETA" /></td>
        <td className={`${cellPadding} border-b border-slate-100 dark:border-white/10`}><TogglePill compact={pillCompact} label={t("settings.zones.active")} checked={Boolean(zone.active)} onChange={(checked) => onPatch({ active: checked })} /></td>
        <td className={`${cellPadding} border-b border-slate-100 dark:border-white/10`}>
          <div className="flex justify-end gap-1">
            <button type="button" onClick={onExpand} className={`grid ${inputHeight} aspect-square place-items-center rounded-[var(--radius-control)] border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-200`} aria-label={t("settings.zones.editRule")}><Settings2 className="h-4 w-4" /></button>
            <button type="button" onClick={onExpand} className={`grid ${inputHeight} aspect-square place-items-center rounded-[var(--radius-control)] border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-200`} aria-label={t("settings.zones.expandRule")}>{expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</button>
            <button type="button" onClick={onDelete} className={`grid ${inputHeight} aspect-square place-items-center rounded-[var(--radius-control)] border border-rose-200 text-rose-600 transition hover:bg-rose-50 dark:border-rose-400/25 dark:text-rose-200 dark:hover:bg-rose-500/10`} aria-label={t("settings.zones.deleteZone")}><Trash2 className="h-4 w-4" /></button>
          </div>
        </td>
      </tr>
      {expanded ? (
        <tr className="bg-slate-50/80 dark:bg-white/[0.025]">
          <td colSpan={11} className="border-b border-slate-100 p-0 dark:border-white/10">{advancedPanel}</td>
        </tr>
      ) : null}
    </>
  );
}

function TogglePill({ label, checked, onChange, compact = false }) {
  // Adapter: M1UI Switch emits a DOM event, but every existing caller expects a
  // boolean, so the conversion stays here and no call site changes.
  void compact; // still accepted; density now comes from the theme
  return (
    <Switch label={label} checked={checked} onChange={(event) => onChange(event.target.checked)} />
  );
}

function VisualSection({ icon: Icon, title, description, children }) {
  return (
    <section className={`rounded-[1.75rem] p-5 ${shellCard}`}>
      <div className="mb-5 flex items-start gap-3">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-slate-100 text-slate-700 dark:bg-white/8 dark:text-slate-200"><Icon className="h-6 w-6" /></span>
        <div>
          <h2 className={`m1-section-title ${headingText}`}>{title}</h2>
          <p className={`mt-1 text-sm leading-6 ${bodyText}`}>{description}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

function PremiumInput({ label, value, onChange }) {
  return (
    <div className={`rounded-2xl p-4 ${fieldSurface}`}>
      {/* Adapter: callers still receive a string, not the DOM event. */}
      <Input label={label} value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}

function VisualUpload({ title, value, onChange, helper, placeholder, clearLabel, fallbackLabel, wide = false }) {
  const [failed, setFailed] = useState(false);
  const hasValue = Boolean(String(value || "").trim());
  const showImage = hasValue && !failed;

  useEffect(() => {
    setFailed(false);
  }, [value]);

  return (
    <article className={`rounded-2xl p-4 ${fieldSurface} ${wide ? "xl:col-span-2" : ""}`}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className={`m1-section-title ${headingText}`}>{title}</h3>
          <p className={`mt-1 text-xs leading-5 ${bodyText}`}>{helper}</p>
        </div>
        {hasValue ? (
          <button type="button" onClick={() => onChange("")} className="inline-flex h-[var(--control-height-md)] shrink-0 items-center gap-1.5 rounded-[var(--radius-control)] border border-slate-200 bg-white px-3 text-xs font-black text-slate-600 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700 dark:border-white/10 dark:bg-white/5 dark:text-slate-300 dark:hover:border-rose-400/30 dark:hover:bg-rose-500/10 dark:hover:text-rose-200">
            <X className="h-3.5 w-3.5" />
            {clearLabel}
          </button>
        ) : null}
      </div>
      <div className="grid gap-3 sm:grid-cols-[6rem_minmax(0,1fr)]">
        <div className="grid aspect-square place-items-center overflow-hidden rounded-2xl border border-dashed border-slate-300 bg-slate-50 dark:border-white/15 dark:bg-slate-950">
          {showImage ? (
            <img src={value} alt="" onError={() => setFailed(true)} className="h-full w-full object-cover" />
          ) : (
            <div className="grid h-full w-full place-items-center p-3 text-center">
              <div>
                <Image className="mx-auto h-6 w-6 text-slate-300 dark:text-slate-600" />
                <div className={`mt-2 text-[11px] font-black ${mutedText}`}>{hasValue ? fallbackLabel : "Preview"}</div>
              </div>
            </div>
          )}
        </div>
        <div className="min-w-0">
          <input value={value || ""} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="h-[var(--control-height-lg)] w-full rounded-[var(--radius-control)] border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-950 outline-none focus:border-sky-400 focus:ring-4 focus:ring-sky-100 dark:border-white/10 dark:bg-slate-950 dark:text-white dark:placeholder:text-slate-500 dark:focus:border-blue-400 dark:focus:ring-blue-500/15" />
          <div className={`mt-2 truncate text-xs font-medium ${mutedText}`}>{hasValue ? value : placeholder}</div>
        </div>
      </div>
    </article>
  );
}

function CollectionSelector({ collections, draft, setDraft, onChange, hint }) {
  const add = () => {
    const next = String(draft || "").trim();
    if (!next) return;
    if (!collections.includes(next)) onChange([...collections, next]);
    setDraft("");
  };
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {collections.map((collection) => (
          <button key={collection} type="button" onClick={() => onChange(collections.filter((item) => item !== collection))} className="rounded-full border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-black text-slate-700 dark:border-white/10 dark:bg-white/5 dark:text-slate-200">
            {collection} x
          </button>
        ))}
      </div>
      <input value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); add(); } }} placeholder={hint} className="mt-3 h-[var(--control-height-lg)] w-full rounded-[var(--radius-control)] border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-950 outline-none focus:border-sky-400 focus:ring-4 focus:ring-sky-100 dark:border-white/10 dark:bg-slate-950 dark:text-white dark:placeholder:text-slate-500 dark:focus:border-blue-400 dark:focus:ring-blue-500/15" />
    </div>
  );
}

function initialsFor(value = "") {
  const words = String(value || "Store").trim().split(/\s+/).filter(Boolean);
  return words.slice(0, 2).map((word) => word[0]?.toUpperCase()).join("") || "S";
}

function LogoAvatar({ src, name, size = "h-12 w-12" }) {
  const [failed, setFailed] = useState(false);
  const resolvedSrc = resolveProductImageUrl(src);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (resolvedSrc && !failed) {
    return (
      <div className={`grid ${size} place-items-center overflow-hidden rounded-2xl bg-slate-100 dark:bg-slate-900`}>
        <img src={resolvedSrc} alt="" onError={() => setFailed(true)} className="h-full w-full object-cover" />
      </div>
    );
  }

  return (
    <div className={`grid ${size} place-items-center rounded-2xl bg-gradient-to-br from-slate-900 to-slate-600 text-sm font-black text-white dark:from-primary dark:to-primary-hover dark:text-primary-foreground`}>
      {initialsFor(name)}
    </div>
  );
}

function HeroBackdrop({ imageUrl, className = "", children }) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [imageUrl]);

  return (
    <div className={`relative grid items-end overflow-hidden bg-gradient-to-br from-slate-950 via-slate-800 to-slate-700 ${className}`}>
      {imageUrl && !failed ? (
        <img src={imageUrl} alt="" onError={() => setFailed(true)} className="absolute inset-0 h-full w-full object-cover" />
      ) : null}
      <div className="absolute inset-0 bg-gradient-to-b from-slate-950/20 to-slate-950/85" />
      <div className="relative z-10">{children}</div>
    </div>
  );
}

function PreviewDrawer({ ui, onClose, children }) {
  return (
    <div className="fixed inset-0 z-40">
      <button type="button" aria-label={ui.close} onClick={onClose} className="absolute inset-0 h-full w-full bg-slate-950/45 backdrop-blur-sm" />
      <aside className="absolute inset-y-0 end-0 flex w-full max-w-xl flex-col border-slate-200 bg-[#f6f8fb] shadow-[-24px_0_80px_rgba(15,23,42,0.22)] dark:border-white/10 dark:bg-[#050816] dark:shadow-[-24px_0_80px_rgba(0,0,0,0.5)] sm:border-s">
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-white/10">
          <div>
            <div className={`text-xs font-black uppercase tracking-[0.16em] ${mutedText}`}>{ui.preview}</div>
            <h2 className={`m1-section-title mt-1 ${headingText}`}>{ui.previewTitle}</h2>
          </div>
          <button type="button" onClick={onClose} className="grid h-[var(--control-height-lg)] w-11 place-items-center rounded-[var(--radius-control)] border border-slate-200 bg-white text-slate-700 transition hover:bg-slate-50 dark:border-white/10 dark:bg-white/5 dark:text-slate-200 dark:hover:bg-white/10">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">{children}</div>
      </aside>
    </div>
  );
}

function PreviewPanel({ storeName, storeUrl, logoUrl, hero }) {
  const { t } = useTranslation();
  const hasHeroContent = Boolean(hero.imageUrl || hero.title || hero.subtitle);
  const hasIdentityContent = Boolean(storeName || storeUrl || logoUrl);
  if (!hasIdentityContent && !hasHeroContent) return null;

  return (
    <div className={`overflow-hidden rounded-[1.75rem] ${shellCard}`}>
      {hasIdentityContent ? (
        <div className="border-b border-slate-100 p-4 dark:border-white/10">
          <div className="mt-3 flex items-center gap-3">
            {logoUrl || storeName ? <LogoAvatar src={logoUrl} name={storeName} /> : null}
            <div className="min-w-0">
              {storeName ? <div className={`truncate text-sm font-black ${headingText}`}>{storeName}</div> : null}
              {storeUrl ? <div className={`truncate text-xs ${mutedText}`}>{storeUrl}</div> : null}
            </div>
          </div>
        </div>
      ) : null}
      {hasHeroContent ? (
        <div className="p-4">
          <div className="overflow-hidden rounded-3xl bg-slate-950 text-white">
            <HeroBackdrop imageUrl={hero.imageUrl} className="min-h-44 p-4">
              <div>
                <div className="text-[10px] font-black uppercase tracking-[0.16em] text-white/45">{t("settings.preview.homepage")}</div>
                {hero.title ? <div className="mt-1 text-lg font-black">{hero.title}</div> : null}
                {hero.subtitle ? <p className="mt-1 line-clamp-2 text-xs text-white/65">{hero.subtitle}</p> : null}
              </div>
            </HeroBackdrop>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function RetryCard({ ui, error, onRetry }) {
  return (
    <section className="rounded-[1.75rem] border border-rose-200 bg-white p-6 shadow-sm dark:border-rose-400/25 dark:bg-slate-950/82 dark:shadow-[0_22px_70px_rgba(0,0,0,0.35)]">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex gap-3">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-rose-50 text-rose-600 dark:bg-rose-500/12 dark:text-rose-200">
            <AlertCircle className="h-6 w-6" />
          </span>
          <div>
            <h2 className={`m1-section-title ${headingText}`}>{ui.apiErrorTitle}</h2>
            <p className={`mt-1 text-sm leading-6 ${bodyText}`}>{ui.apiErrorHint}</p>
            <p className="mt-3 rounded-2xl bg-rose-50 px-3 py-2 text-sm font-bold text-rose-700 dark:bg-rose-500/10 dark:text-rose-200">{error}</p>
          </div>
        </div>
        <button type="button" onClick={onRetry} className="inline-flex h-[var(--control-height-lg)] items-center justify-center gap-2 rounded-[var(--radius-control)] bg-rose-600 px-4 text-sm font-black text-white">
          <RefreshCw className="h-4 w-4" />
          {ui.retry}
        </button>
      </div>
    </section>
  );
}

function SettingsDebugPage({ ui, records, values, loading, error, onRetry }) {
  const { t } = useTranslation();
  return (
    <div className="min-h-screen bg-[#f6f8fb] p-4 text-slate-950 dark:bg-[#050816] dark:text-white sm:p-6">
      <main className="mx-auto max-w-6xl space-y-5">
        <section className={`rounded-[1.75rem] p-5 ${shellCard}`}>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h1 className={`m1-page-title ${headingText}`}>{ui.advanced}</h1>
              <p className={`mt-1 text-sm leading-6 ${bodyText}`}>{ui.advancedHint}</p>
            </div>
            <button type="button" onClick={onRetry} className="inline-flex h-[var(--control-height-lg)] items-center justify-center gap-2 rounded-[var(--radius-control)] border border-slate-200 bg-white px-4 text-sm font-black text-slate-700 dark:border-white/10 dark:bg-white/5 dark:text-slate-200">
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              {ui.retry}
            </button>
          </div>
          {error ? (
            <p className="mt-4 rounded-2xl bg-rose-50 px-3 py-2 text-sm font-bold text-rose-700 dark:bg-rose-500/10 dark:text-rose-200">{error}</p>
          ) : null}
        </section>

        <section className={`rounded-[1.75rem] p-5 ${shellCard}`}>
          <h2 className={`m1-section-title ${headingText}`}>{t("settings.debug.registryAudit")}</h2>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            {legacyAudit.map(([setting, location, owner]) => (
              <div key={setting} className={`rounded-2xl p-3 ${subtleSurface}`}>
                <div className={`text-xs font-black ${headingText}`}>{setting}</div>
                <div className={`mt-1 text-xs ${bodyText}`}>{location}</div>
                <div className="mt-2 rounded-full bg-white px-2 py-1 text-[11px] font-black text-slate-500 dark:bg-white/8 dark:text-slate-300">{owner}</div>
              </div>
            ))}
          </div>
        </section>

        <section className={`rounded-[1.75rem] p-5 ${shellCard}`}>
          <h2 className={`m1-section-title ${headingText}`}>{t("settings.debug.runtimeMetadata")}</h2>
          <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-950 p-4 text-xs text-slate-300 dark:border-white/10 dark:bg-black/30">
            <div>{t("settings.debug.loadedSettings")} {records.length}</div>
            <div>{t("settings.debug.editedLocalValues")} {Object.keys(values).length}</div>
            <div>{t("settings.debug.source")} /settings/debug</div>
          </div>
        </section>
      </main>
    </div>
  );
}

function SkeletonGrid() {
  return (
    <div className="grid gap-5">
      {Array.from({ length: 4 }).map((_, index) => (
        <div key={index} className="h-64 animate-pulse rounded-[1.75rem] border border-white/70 bg-white/90 dark:border-white/10 dark:bg-slate-950/82" />
      ))}
    </div>
  );
}
