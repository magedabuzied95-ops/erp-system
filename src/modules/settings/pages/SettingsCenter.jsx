import { Component, useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  AlertCircle,
  Bot,
  Building2,
  Check,
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
  Package,
  PlayCircle,
  Plus,
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
  WalletCards,
  Warehouse,
  X,
} from "lucide-react";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";

import { api } from "../../../shared/api/api";
import { getCurrentUser } from "../../../shared/auth/authStorage";
import { normalizeSettingsCategory, settingsCategories, settingsByCategory } from "../../../../shared/settingsRegistry.js";

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
};

const navDescriptions = {
  general: "Company profile and locale",
  orders: "Lifecycle and fulfillment",
  storefront: "Public shop and catalog",
  shipping: "Zones, COD, proof, providers",
  payments: "COD, wallets, gateways",
  pos: "Cashier defaults",
  inventory: "Stock and warehouse rules",
  accounting: "Ledger and tax defaults",
  employees: "Payroll and attendance",
  ai_channels: "AI and marketing automation",
  notifications: "Alerts and channels",
  security: "Access and protection",
};

const sectionMap = {
  general: [
    ["Company Information", ["general.company_name", "general.default_country", "general.default_city"]],
    ["Logo & Branding", ["general.company_logo_url"]],
    ["Currency", ["general.default_currency", "general.currency_symbol"]],
    ["Language", ["general.default_language", "general.default_direction"]],
    ["Timezone", ["general.timezone"]],
    ["Date & Number Formats", ["general.date_format", "general.time_format", "general.number_format"]],
    ["Preferences", ["general.default_branch_id", "general.default_warehouse_id", "general.default_pos_treasury_account_id", "general.business_working_days", "general.business_hours"]],
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
    ["Shipping Zones", ["storefront.shipping_zones"]],
    ["Governorates & Cities", ["storefront.shipping_zones"]],
    ["Free Shipping Rules", ["storefront.shipping_zones"]],
    ["COD Rules", ["storefront.shipping_zones"]],
    ["Shipping Proof Rules", ["storefront.shipping_zones"]],
    ["Shipping Providers", ["orders.shipping_provider", "orders.shipping_rule_engine_enabled", "orders.shipping_auto_create_ready_to_ship", "orders.bosta_api_key", "orders.mylerz_api_key", "orders.shipblu_api_key"]],
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
  ai_channels: [
    ["AI Assistant", ["ai_channels.ai_support_enabled", "ai_channels.ai_reply_mode", "ai_channels.product_recommendation_strictness"]],
    ["AI Inbox", ["ai_channels.human_takeover_behavior", "ai_channels.auto_return_to_ai_minutes", "ai_channels.handoff_message", "ai_channels.ai_fallback_message"]],
    ["Marketing Automation", ["ai_channels.allowed_channels", "ai_channels.storefront_product_link_base"]],
    ["Meta Integrations", ["ai_channels.meta_integration_enabled", "ai_channels.webhook_url_display", "ai_channels.cloudinary_cloud_name", "ai_channels.cloudinary_api_secret"]],
  ],
};

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

const shellCard = "border border-white/70 bg-white/90 shadow-sm dark:border-white/10 dark:bg-slate-950/82 dark:shadow-[0_22px_70px_rgba(0,0,0,0.35)]";
const fieldSurface = "border border-slate-200 bg-white dark:border-white/10 dark:bg-slate-900/82";
const subtleSurface = "border border-slate-200 bg-slate-50 dark:border-white/10 dark:bg-slate-950";
const headingText = "text-slate-950 dark:text-white";
const bodyText = "text-slate-500 dark:text-slate-400";
const mutedText = "text-slate-400 dark:text-slate-500";
const inputClass = "w-full rounded-2xl border border-slate-200 bg-white px-3.5 py-3 text-sm font-semibold text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-sky-400 focus:ring-4 focus:ring-sky-100 dark:border-white/10 dark:bg-slate-950 dark:text-white dark:placeholder:text-slate-500 dark:focus:border-blue-400 dark:focus:ring-blue-500/15";

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
          <h1 className="text-xl font-black">Settings Center error</h1>
          <p className="mt-2 text-sm text-rose-100">{this.state.error?.message || "Unable to render settings."}</p>
          <button type="button" onClick={() => this.setState({ error: null })} className="mt-5 rounded-xl bg-white px-4 py-2 text-sm font-black text-slate-950">Retry</button>
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
  const { i18n } = useTranslation();
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
  const canViewDebugSettings = useMemo(() => debugSettingsEnabled() || isDeveloperUser(getCurrentUser()), []);
  const activeSection = activeCategory === "storefront"
    ? String(params.get("section") || "storefront").trim().toLowerCase().replace(/[\s-]+/g, "_")
    : activeCategory;
  const shouldShowPreviewPanel = activeCategory === "storefront" && visualStorefrontSections.includes(activeSection);
  const settingsGridColumns = shouldShowPreviewPanel
    ? "lg:grid-cols-[20rem_minmax(0,1fr)] xl:grid-cols-[20rem_minmax(0,1fr)_22rem]"
    : "lg:grid-cols-[20rem_minmax(0,1fr)]";

  const definitions = useMemo(() => settingsByCategory[activeCategory] || [], [activeCategory]);
  const recordMap = useMemo(() => mapByKey(records), [records]);
  const definitionMap = useMemo(() => mapByKey(definitions), [definitions]);

  const dirtyKeys = useMemo(() => definitions
    .filter((setting) => {
      if (setting.isSecret && !values[setting.key]) return false;
      return !sameValue(values[setting.key], originalValues[setting.key]);
    })
    .map((setting) => setting.key), [definitions, originalValues, values]);
  const isDirty = dirtyKeys.length > 0;

  const applyPayload = useCallback((payload, category = activeCategory) => {
    const incoming = Array.isArray(payload?.settings) ? payload.settings : [];
    setRecords(incoming);
    const next = {};
    incoming.forEach((setting) => {
      next[setting.key] = stringifyValue(setting, setting.isSecret ? "" : setting.value);
    });
    (settingsByCategory[category] || []).forEach((definition) => {
      if (!(definition.key in next)) next[definition.key] = stringifyValue(definition, definition.defaultValue);
    });
    setValues(next);
    setOriginalValues(next);
  }, [activeCategory]);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const payload = await api.get(`/settings/${activeCategory}`, { perfComponent: "SettingsCenterV2.load" });
      applyPayload(payload, activeCategory);
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

  useEffect(() => {
    if (!shouldShowPreviewPanel) setPreviewOpen(false);
  }, [shouldShowPreviewPanel]);

  useEffect(() => {
    const handler = (event) => {
      if (!isDirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  const switchCategory = (category) => {
    const next = normalizeSettingsCategory(category);
    if (!next) return;
    if (isDirty) {
      toast.error(`${dirtyKeys.length} ${ui.unsaved}`);
      return;
    }
    setActiveCategory(next);
    setSearch("");
    navigate(`/settings?category=${next}`, { replace: true });
  };

  const updateValue = (key, value) => setValues((current) => ({ ...current, [key]: value }));
  const updateHero = (patch) => {
    const current = safeParseJson(values["storefront.homepage_hero"], {});
    updateValue("storefront.homepage_hero", { ...current, ...patch });
  };

  const discard = () => {
    setValues({ ...originalValues });
    toast.success("Discarded");
  };

  const save = async () => {
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
  }), [activeCategoryMeta?.label, definitions, normalizedSearch]);

  const sections = useMemo(() => {
    if (activeCategory === "storefront" || activeCategory === "shipping") return [];
    const configured = sectionMap[activeCategory] || [];
    const configuredKeys = new Set(configured.flatMap(([, keys]) => keys));
    const built = configured.map(([title, keys]) => ({
      title,
      settings: keys.map((key) => recordMap.get(key) || definitionMap.get(key)).filter(Boolean),
    })).filter((section) => section.settings.length);
    const remaining = definitions.filter((setting) => !configuredKeys.has(setting.key));
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
  const storeUrl = value("storefront.public_url") || "";
  const storeName = value("storefront.store_name") || "";
  const logoUrl = value("storefront.store_logo_url");

  const quickActions = {
    storefront: [
      [ui.openStore, ExternalLink, () => window.open(storeUrl || "/shop", "_blank", "noopener,noreferrer")],
      [ui.previewStore, Eye, () => window.open("/shop", "_blank", "noopener,noreferrer")],
      [ui.copyUrl, Copy, async () => { await navigator.clipboard?.writeText(storeUrl); toast.success("Copied"); }],
    ],
    orders: [
      [ui.testShipping, TestTube2, () => toast.success("Shipping settings ready")],
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
          className={`inline-flex h-11 items-center gap-3 rounded-full border px-3 text-sm font-black transition ${current ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/25 dark:bg-emerald-500/12 dark:text-emerald-200" : "border-slate-200 bg-slate-50 text-slate-600 dark:border-white/10 dark:bg-slate-950 dark:text-slate-300"}`}
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
              className={`rounded-full border px-3 py-2 text-xs font-black ${selected.has(option.value) ? "border-sky-200 bg-sky-50 text-sky-800 dark:border-blue-400/30 dark:bg-blue-500/15 dark:text-blue-100" : "border-slate-200 bg-white text-slate-600 dark:border-white/10 dark:bg-slate-950 dark:text-slate-300"}`}
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
        value={current}
        onChange={(event) => updateValue(item.key, event.target.value)}
        placeholder={item.isSecret ? "Leave blank to keep current value" : ""}
      />
    );
  };

  const renderField = (item, compact = false) => {
    const dirty = dirtyKeys.includes(item.key);
    const matched = normalizedSearch && searchMatches.some((match) => match.key === item.key);
    return (
      <article id={`setting-${item.key}`} key={item.key} className={`rounded-2xl border p-4 transition ${dirty ? "border-amber-200 bg-amber-50/70 dark:border-amber-400/30 dark:bg-amber-500/10" : matched ? "border-sky-200 bg-sky-50/70 dark:border-blue-400/30 dark:bg-blue-500/10" : "border-slate-200 bg-white dark:border-white/10 dark:bg-slate-900/82"} ${compact ? "" : "shadow-sm dark:shadow-none"}`}>
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className={`text-sm font-black ${headingText}`}>{localized(item.label, language)}</h3>
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
                <h1 className={`text-xl font-black ${headingText}`}>Settings debug is unavailable</h1>
                <p className={`mt-2 text-sm leading-6 ${bodyText}`}>Developer settings are only available to super admin or developer users, or when debug settings are explicitly enabled.</p>
              </div>
            </div>
          </section>
        </div>
      );
    }
    return <SettingsDebugPage ui={ui} records={records} values={values} loading={loading} error={error} onRetry={loadSettings} />;
  }

  return (
    <div dir={direction} className="min-h-screen w-full max-w-[calc(100vw-1.5rem)] overflow-x-hidden bg-[#f6f8fb] text-slate-950 dark:bg-[#050816] dark:text-white lg:max-w-none">
      <div className="mx-auto w-full max-w-[calc(100vw-3rem)] px-0 py-4 sm:max-w-[96rem] sm:px-5 lg:px-8">
        <header className="sticky top-0 z-20 border-b border-slate-200/70 bg-[#f6f8fb]/90 px-0 py-3 backdrop-blur-xl dark:border-white/10 dark:bg-[#050816]/90 lg:-mx-8 lg:px-8">
          <div className="flex w-full min-w-0 max-w-full flex-col gap-4 rounded-[1.75rem] border border-white/70 bg-white/85 p-4 shadow-[0_18px_60px_rgba(15,23,42,0.08)] dark:border-white/10 dark:bg-slate-950/80 dark:shadow-[0_22px_70px_rgba(0,0,0,0.45)] lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-3 py-1 text-xs font-black uppercase tracking-[0.14em] text-white dark:bg-gradient-to-r dark:from-blue-500 dark:to-violet-500">
                  <Settings2 className="h-4 w-4" />
                  {ui.title}
                </span>
                <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-bold text-slate-500 dark:border-white/10 dark:bg-white/5 dark:text-slate-300">{ui.lastSaved} {lastSaved ? timeAgo(lastSaved) : ui.neverSaved}</span>
                {isDirty ? <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-black text-amber-800 dark:bg-amber-400/15 dark:text-amber-200">{dirtyKeys.length} {ui.unsaved}</span> : null}
              </div>
              <h1 className={`mt-3 max-w-full break-words text-2xl font-black tracking-tight sm:text-3xl ${headingText}`}>{ui.subtitle}</h1>
              <p className={`mt-1 text-sm font-medium ${bodyText}`}>{ui.description}</p>
            </div>
            <div className="flex min-w-0 max-w-full flex-col gap-2 sm:flex-row sm:items-center">
              <label className="relative min-w-0 max-w-full sm:w-80">
                <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={ui.search} className="h-11 w-full rounded-2xl border border-slate-200 bg-white pe-3 ps-10 text-sm font-semibold text-slate-950 outline-none focus:border-sky-400 focus:ring-4 focus:ring-sky-100 dark:border-white/10 dark:bg-slate-950 dark:text-white dark:placeholder:text-slate-500 dark:focus:border-blue-400 dark:focus:ring-blue-500/15" />
              </label>
              {shouldShowPreviewPanel ? (
                <button type="button" onClick={() => setPreviewOpen(true)} className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-black text-slate-700 dark:border-white/10 dark:bg-white/5 dark:text-slate-200 dark:hover:bg-white/10"><Eye className="h-4 w-4" />{ui.preview}</button>
              ) : null}
              <button type="button" disabled={!isDirty || saving} onClick={save} className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-slate-950 px-4 text-sm font-black text-white disabled:opacity-45 dark:bg-gradient-to-r dark:from-blue-500 dark:to-violet-500 dark:text-white">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{saving ? ui.saving : ui.save}</button>
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
                  <button key={category.key} type="button" onClick={() => switchCategory(category.key)} className={`group flex items-center gap-3 rounded-2xl border p-3 text-start transition ${active ? "border-slate-950 bg-slate-950 text-white shadow-lg shadow-slate-950/10 dark:border-blue-400/35 dark:bg-gradient-to-br dark:from-blue-500/22 dark:to-violet-500/20 dark:text-white dark:shadow-[0_18px_44px_rgba(59,130,246,0.16)]" : "border-transparent text-slate-600 hover:border-slate-200 hover:bg-slate-50 dark:text-slate-300 dark:hover:border-white/10 dark:hover:bg-white/5"}`}>
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
                    <h2 className={`text-2xl font-black ${headingText}`}>{localized(activeCategoryMeta?.label, language)}</h2>
                    <p className={`mt-1 max-w-2xl text-sm leading-6 ${bodyText}`}>{localized(activeCategoryMeta?.description, language)}</p>
                  </div>
                </div>
                {quickActions.length ? (
                  <div className="flex flex-wrap gap-2">
                    {quickActions.map(([label, Icon, action]) => (
                      <button key={label} type="button" onClick={action} className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-black text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 dark:border-white/10 dark:bg-white/5 dark:text-slate-200 dark:hover:bg-white/10">
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
            ) : loading ? <SkeletonGrid /> : activeCategory === "storefront" ? (
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
                    <h2 className={`text-lg font-black ${headingText}`}>{section.title}</h2>
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
          <div className="mx-auto flex max-w-[96rem] flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2 text-sm font-black text-slate-800 dark:text-white"><AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-300" />{dirtyKeys.length} {ui.unsaved}</div>
            <div className="grid grid-cols-2 gap-2 sm:flex">
              <button type="button" onClick={discard} disabled={saving} className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-black text-slate-700 dark:border-white/10 dark:bg-white/5 dark:text-slate-200"><Undo2 className="h-4 w-4" />{ui.discard}</button>
              <button type="button" onClick={save} disabled={saving} className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-slate-950 px-4 text-sm font-black text-white dark:bg-gradient-to-r dark:from-blue-500 dark:to-violet-500">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{saving ? ui.saving : ui.save}</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function StorefrontSettings(props) {
  const { ui, setting, value, hero, featuredCollections, collectionDraft, setCollectionDraft, updateValue, updateHero, renderInput, renderField } = props;
  const publicUrl = value("storefront.public_url");
  const hasHeroPreview = Boolean(hero.imageUrl || hero.title || hero.subtitle || hero.buttonText);
  const hasSeoPreview = Boolean(publicUrl || value("storefront.seo_title") || value("storefront.store_name") || value("storefront.seo_description"));
  return (
    <div className="grid gap-5">
      <VisualSection icon={Store} title="Store Identity" description="Name, URL, logo, and browser identity for the public store.">
        <div className="grid gap-4 xl:grid-cols-2">
          {renderField(setting("storefront.enabled"), true)}
          {renderField(setting("storefront.store_name"), true)}
          {renderField(setting("storefront.public_url"), true)}
          <VisualUpload title="Logo Upload" value={value("storefront.store_logo_url")} onChange={(next) => updateValue("storefront.store_logo_url", next)} helper={ui.uploadHelper} placeholder={ui.pasteImageUrl} clearLabel={ui.clearImage} fallbackLabel={ui.imageUnavailable} />
          <VisualUpload title="Favicon Upload" value={value("storefront.favicon_url")} onChange={(next) => updateValue("storefront.favicon_url", next)} helper={ui.uploadHelper} placeholder={ui.pasteImageUrl} clearLabel={ui.clearImage} fallbackLabel={ui.imageUnavailable} />
        </div>
      </VisualSection>

      <VisualSection icon={Image} title="Homepage" description="Shape the first impression customers see when they land on your store.">
        <div className="grid gap-4 xl:grid-cols-2">
          <PremiumInput label="Hero Title" value={hero.title || ""} onChange={(next) => updateHero({ title: next })} />
          <PremiumInput label="Hero Subtitle" value={hero.subtitle || ""} onChange={(next) => updateHero({ subtitle: next })} />
          <PremiumInput label="Hero Button Text" value={hero.buttonText || ""} onChange={(next) => updateHero({ buttonText: next })} />
          <PremiumInput label="Hero Button URL" value={hero.buttonUrl || ""} onChange={(next) => updateHero({ buttonUrl: next })} />
          <VisualUpload title="Hero Image Upload" value={hero.imageUrl || ""} onChange={(next) => updateHero({ imageUrl: next })} helper={ui.uploadHelper} placeholder={ui.pasteImageUrl} clearLabel={ui.clearImage} fallbackLabel={ui.imageUnavailable} wide />
        </div>
        {hasHeroPreview ? (
          <div className="mt-4 overflow-hidden rounded-3xl border border-slate-200 bg-slate-950 text-white dark:border-white/10">
            <HeroBackdrop imageUrl={hero.imageUrl} className="min-h-56 p-6">
              <div>
                <div className="text-xs font-black uppercase tracking-[0.18em] text-white/50">Live homepage preview</div>
                {hero.title ? <h3 className="mt-2 text-3xl font-black">{hero.title}</h3> : null}
                {hero.subtitle ? <p className="mt-2 max-w-xl text-sm text-white/70">{hero.subtitle}</p> : null}
                {hero.buttonText ? <button type="button" className="mt-4 rounded-full bg-white px-4 py-2 text-sm font-black text-slate-950">{hero.buttonText}</button> : null}
              </div>
            </HeroBackdrop>
          </div>
        ) : null}
      </VisualSection>

      <VisualSection icon={Package} title="Catalog" description="Control how customers browse and interact with products.">
        <div className="grid gap-4 xl:grid-cols-2">
          {renderField(setting("storefront.product_sorting_default"), true)}
          {renderField(setting("storefront.show_sold_out_products"), true)}
          {renderField(setting("storefront.show_low_stock_badge"), true)}
          {renderField(setting("storefront.show_product_views"), true)}
          {renderField(setting("storefront.enable_wishlist"), true)}
          {renderField(setting("storefront.enable_product_sharing"), true)}
          {renderField(setting("storefront.enable_size_guide"), true)}
          <article id="setting-storefront.featured_collections" className={`rounded-2xl p-4 xl:col-span-2 ${fieldSurface}`}>
            <h3 className={`text-sm font-black ${headingText}`}>Featured collections</h3>
            <p className={`mt-1 text-xs ${bodyText}`}>Searchable collection selector replacement for the old JSON list.</p>
            <div className="mt-3">
              <CollectionSelector collections={featuredCollections} draft={collectionDraft} setDraft={setCollectionDraft} onChange={(next) => updateValue("storefront.featured_collections", next)} hint={ui.collectionHint} />
            </div>
          </article>
        </div>
      </VisualSection>

      <VisualSection icon={Globe2} title="SEO" description="Improve how your store appears in search and link previews.">
        <div className="grid gap-4 xl:grid-cols-2">
          {renderField(setting("storefront.seo_title"), true)}
          {renderField(setting("storefront.seo_description"), true)}
          <VisualUpload title="Open Graph Image Upload" value={value("storefront.open_graph_image_url")} onChange={(next) => updateValue("storefront.open_graph_image_url", next)} helper={ui.uploadHelper} placeholder={ui.pasteImageUrl} clearLabel={ui.clearImage} fallbackLabel={ui.imageUnavailable} wide />
        </div>
        {hasSeoPreview ? (
          <div className={`mt-4 rounded-2xl p-4 ${fieldSurface}`}>
            {publicUrl ? <div className="text-xs text-emerald-700">{publicUrl}</div> : null}
            {value("storefront.seo_title") || value("storefront.store_name") ? <div className="mt-1 text-lg font-medium text-blue-700">{value("storefront.seo_title") || value("storefront.store_name")}</div> : null}
            {value("storefront.seo_description") ? <p className={`mt-1 max-w-2xl text-sm ${bodyText}`}>{value("storefront.seo_description")}</p> : null}
          </div>
        ) : null}
      </VisualSection>

      <VisualSection icon={Layers3} title="Marketing" description="Tracking IDs used by campaigns and catalog integrations.">
        <div className="grid gap-4 xl:grid-cols-2">
          {renderField(setting("storefront.meta_pixel_id"), true)}
          {renderField(setting("storefront.facebook_catalog_id"), true)}
          <PremiumInput label="TikTok Pixel" value={value("storefront.tiktok_pixel_id")} onChange={(next) => updateValue("storefront.tiktok_pixel_id", next)} />
          <PremiumInput label="Google Analytics" value={value("storefront.google_analytics_id")} onChange={(next) => updateValue("storefront.google_analytics_id", next)} />
        </div>
      </VisualSection>
    </div>
  );
}

function ShippingSettings({ setting, value, language, updateValue, renderField }) {
  const zones = useMemo(() => (Array.isArray(value("storefront.shipping_zones")) ? value("storefront.shipping_zones") : []).map(normalizeShippingZoneRow), [value]);
  const defaultPrice = Number(value("storefront.default_shipping_price") || 0);
  const activeZones = zones.filter((zone) => zone.active).length;
  const codZones = zones.filter((zone) => zone.cod_allowed).length;
  const proofZones = zones.filter((zone) => zone.requires_shipping_proof).length;
  const freeShippingRules = zones.filter((zone) => Number(zone.free_shipping_threshold || 0) > 0).length;
  const copy = shippingUi[language] || shippingUi.en;

  return (
    <div className="grid gap-6">
      <div className="grid gap-3 lg:grid-cols-5">
        <SummaryTile icon={Truck} label={copy.defaultPrice} value={`${defaultPrice.toLocaleString()} EGP`} />
        <SummaryTile icon={Check} label={copy.activeZones} value={activeZones} />
        <SummaryTile icon={WalletCards} label={copy.codZones} value={codZones} />
        <SummaryTile icon={ShieldCheck} label={copy.proofZones} value={proofZones} />
        <SummaryTile icon={Package} label={copy.freeRules} value={freeShippingRules} />
      </div>

      <VisualSection icon={Truck} title={copy.overviewTitle} description={copy.overviewDescription}>
        <div className="grid gap-4 xl:grid-cols-2">
          {renderField(setting("storefront.default_shipping_price"), true)}
          {renderField(setting("orders.shipping_rule_engine_enabled"), true)}
        </div>
      </VisualSection>

      <VisualSection icon={Layers3} title={copy.zonesTitle} description={copy.zonesDescription}>
        <ShippingZonesEditor value={zones} language={language} defaultPrice={defaultPrice} onChange={(next) => updateValue("storefront.shipping_zones", next)} />
      </VisualSection>

      <div className="grid gap-4 xl:grid-cols-2">
        <VisualSection icon={WalletCards} title={copy.codTitle} description={copy.codDescription}>
          <p className={`text-sm leading-6 ${bodyText}`}>{copy.codBody}</p>
        </VisualSection>
        <VisualSection icon={ShieldCheck} title={copy.proofTitle} description={copy.proofDescription}>
          <p className={`text-sm leading-6 ${bodyText}`}>{copy.proofBody}</p>
        </VisualSection>
      </div>

      <VisualSection icon={Package} title={copy.providersTitle} description={copy.providersDescription}>
        <div className="grid gap-4 xl:grid-cols-2">
          {renderField(setting("orders.shipping_provider"), true)}
          {renderField(setting("orders.shipping_auto_create_ready_to_ship"), true)}
          {renderField(setting("orders.bosta_api_key"), true)}
          {renderField(setting("orders.mylerz_api_key"), true)}
          {renderField(setting("orders.shipblu_api_key"), true)}
        </div>
      </VisualSection>
    </div>
  );
}

function SummaryTile({ icon: Icon, label, value }) {
  return (
    <article className={`flex min-h-[7rem] rounded-2xl p-4 ${shellCard}`}>
      <div className="flex w-full items-center justify-between gap-3">
        <div className="min-w-0">
          <div className={`line-clamp-2 text-[11px] font-black uppercase leading-4 tracking-[0.12em] ${mutedText}`}>{label}</div>
          <div className={`mt-2 truncate text-2xl font-black ${headingText}`}>{value}</div>
        </div>
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-slate-100 text-slate-700 ring-1 ring-slate-200/70 dark:bg-white/[0.06] dark:text-slate-200 dark:ring-white/10">
          <Icon className="h-5 w-5" />
        </span>
      </div>
    </article>
  );
}

const shippingUi = {
  en: {
    defaultPrice: "Default shipping price",
    activeZones: "Active zones",
    codZones: "COD zones",
    proofZones: "Proof required",
    freeRules: "Free shipping rules",
    overviewTitle: "Shipping Overview",
    overviewDescription: "Default fallback and operational rules used by storefront checkout.",
    zonesTitle: "Shipping Zones",
    zonesDescription: "Exact area rows win first, then city/markaz rows, then governorate rows, then the default price.",
    codTitle: "COD Rules",
    codDescription: "Global COD availability plus per-zone COD controls in the zone matrix.",
    codBody: "Global cash-on-delivery is configured in Payments. Zone-level COD exceptions are controlled directly inside Shipping Zones.",
    proofTitle: "Shipping Proof Rules",
    proofDescription: "Use the per-zone proof toggle to require or skip shipping payment proof for each area.",
    proofBody: "Proof rules are controlled directly inside Shipping Zones so Damietta, city, and district exceptions stay visible beside their prices.",
    providersTitle: "Shipping Providers",
    providersDescription: "Default provider and carrier credentials for future automatic shipment creation.",
    search: "Search governorate, city, area, provider",
    allGovernorates: "Add all Egypt governorates",
    addZone: "Add zone",
    import: "Import",
    export: "Export",
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
    enableCod: "Enable COD",
    disableCod: "Disable COD",
    requireProof: "Require proof",
    skipProof: "Proof not required",
    deleteSelected: "Delete selected",
    empty: "No shipping zones match the current filters.",
    seeded: "Egypt governorates added",
    headers: ["Governorate", "City / Markaz", "Area / District", "Price", "COD", "Proof", "ETA", "Provider", "Free over", "Min COD", "Active", ""],
  },
  ar: {
    defaultPrice: "سعر الشحن الافتراضي",
    activeZones: "المناطق المفعلة",
    codZones: "الدفع عند الاستلام",
    proofZones: "مطلوب إثبات",
    freeRules: "قواعد الشحن المجاني",
    overviewTitle: "ملخص الشحن",
    overviewDescription: "سعر احتياطي وقواعد تشغيل يستخدمها الدفع في المتجر.",
    zonesTitle: "مناطق الشحن",
    zonesDescription: "تطابق المنطقة أولا، ثم المدينة/المركز، ثم المحافظة، ثم السعر الافتراضي.",
    codTitle: "قواعد الدفع عند الاستلام",
    codDescription: "إعداد عام للدفع عند الاستلام مع استثناءات لكل منطقة.",
    codBody: "الإعداد العام موجود في المدفوعات. الاستثناءات حسب المنطقة تظهر مباشرة داخل جدول الشحن.",
    proofTitle: "قواعد إثبات دفع الشحن",
    proofDescription: "استخدم مفتاح الإثبات لكل منطقة لتحديد هل مطلوب صورة تحويل أم لا.",
    proofBody: "قواعد الإثبات داخل مناطق الشحن لتبقى استثناءات دمياط والمدن والمناطق واضحة بجانب السعر.",
    providersTitle: "شركات الشحن",
    providersDescription: "شركة الشحن الافتراضية وبيانات التكامل لإنشاء الشحنات لاحقا.",
    search: "بحث بالمحافظة أو المدينة أو المنطقة أو الشركة",
    allGovernorates: "إضافة كل محافظات مصر",
    addZone: "إضافة منطقة",
    import: "استيراد",
    export: "تصدير",
    bulk: "تحديث جماعي",
    governorateFilter: "المحافظة",
    all: "الكل",
    selected: "محدد",
    quickTitle: "إضافة سريعة",
    createGovernorate: "محافظة فقط",
    createCity: "محافظة + مدينة",
    createArea: "محافظة + مدينة + منطقة",
    bulkPrice: "تحديد سعر المختار",
    bulkEstimate: "تحديد مدة التوصيل",
    enableCod: "تفعيل COD",
    disableCod: "إيقاف COD",
    requireProof: "طلب إثبات",
    skipProof: "بدون إثبات",
    deleteSelected: "حذف المختار",
    empty: "لا توجد مناطق شحن مطابقة للفلاتر الحالية.",
    seeded: "تمت إضافة محافظات مصر",
    headers: ["المحافظة", "المدينة / المركز", "المنطقة / الحي", "السعر", "COD", "إثبات", "المدة", "الشركة", "مجاني بعد", "حد COD", "مفعل", ""],
  },
};

const egyptGovernorates = [
  ["cairo", "Cairo", "القاهرة", 70, false, true, "2-4 business days"],
  ["giza", "Giza", "الجيزة", 70, false, true, "2-4 business days"],
  ["alexandria", "Alexandria", "الإسكندرية", 75, false, true, "2-5 business days"],
  ["dakahlia", "Dakahlia", "الدقهلية", 75, false, true, "2-5 business days"],
  ["red-sea", "Red Sea", "البحر الأحمر", 90, false, true, "3-6 business days"],
  ["beheira", "Beheira", "البحيرة", 75, false, true, "2-5 business days"],
  ["fayoum", "Fayoum", "الفيوم", 80, false, true, "2-5 business days"],
  ["gharbia", "Gharbia", "الغربية", 75, false, true, "2-5 business days"],
  ["ismailia", "Ismailia", "الإسماعيلية", 75, false, true, "2-5 business days"],
  ["menofia", "Menofia", "المنوفية", 75, false, true, "2-5 business days"],
  ["minya", "Minya", "المنيا", 85, false, true, "3-6 business days"],
  ["qalyubia", "Qalyubia", "القليوبية", 70, false, true, "2-4 business days"],
  ["new-valley", "New Valley", "الوادي الجديد", 95, false, true, "4-7 business days"],
  ["suez", "Suez", "السويس", 75, false, true, "2-5 business days"],
  ["aswan", "Aswan", "أسوان", 90, false, true, "3-6 business days"],
  ["assiut", "Assiut", "أسيوط", 85, false, true, "3-6 business days"],
  ["beni-suef", "Beni Suef", "بني سويف", 80, false, true, "2-5 business days"],
  ["port-said", "Port Said", "بورسعيد", 75, false, true, "2-5 business days"],
  ["damietta", "Damietta", "دمياط", 45, true, false, "1-2 business days"],
  ["sharqia", "Sharqia", "الشرقية", 75, false, true, "2-5 business days"],
  ["south-sinai", "South Sinai", "جنوب سيناء", 95, false, true, "4-7 business days"],
  ["kafr-el-sheikh", "Kafr El Sheikh", "كفر الشيخ", 75, false, true, "2-5 business days"],
  ["matrouh", "Matrouh", "مطروح", 90, false, true, "3-6 business days"],
  ["luxor", "Luxor", "الأقصر", 90, false, true, "3-6 business days"],
  ["qena", "Qena", "قنا", 90, false, true, "3-6 business days"],
  ["north-sinai", "North Sinai", "شمال سيناء", 95, false, true, "4-7 business days"],
  ["sohag", "Sohag", "سوهاج", 90, false, true, "3-6 business days"],
];

const shippingZonePresets = [
  ...egyptGovernorates.map(([id, governorate, arabic_alias, price, cod_allowed, requires_shipping_proof, estimated_delivery_text]) => ({
    id,
    governorate,
    arabic_alias,
    city: "",
    area: "",
    price,
    cod_allowed,
    requires_shipping_proof,
    estimated_delivery_text,
    provider: "in_store_delivery",
    provider_id: "in_store_delivery",
    free_shipping_threshold: 0,
    minimum_order_for_cod: 0,
    active: true,
  })),
  { id: "new-damietta", governorate: "Damietta", arabic_alias: "دمياط الجديدة", city: "New Damietta", area: "", price: 40, cod_allowed: true, requires_shipping_proof: false, estimated_delivery_text: "1-2 business days", provider: "in_store_delivery", provider_id: "in_store_delivery", free_shipping_threshold: 0, minimum_order_for_cod: 0, active: true },
];

const normalizeZoneKey = (value = "") => String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
const shippingProviderOptions = [
  { id: "bosta", label: "Bosta" },
  { id: "mylerz", label: "Mylerz" },
  { id: "shipblu", label: "ShipBlu" },
  { id: "in_store_delivery", label: "In Store Delivery" },
];
const normalizeProviderKey = (value = "") => {
  const key = String(value || "in_store_delivery").trim().toLowerCase();
  if (key === "manual" || key === "store_pickup" || key === "in-store-delivery") return "in_store_delivery";
  return shippingProviderOptions.some((provider) => provider.id === key) ? key : "in_store_delivery";
};

const normalizeShippingZoneRow = (zone = {}, index = 0) => ({
  id: String(zone.id || `zone-${Date.now()}-${index}`).trim(),
  governorate: String(zone.governorate || "").trim(),
  arabic_alias: String(zone.arabic_alias || zone.arabicAlias || "").trim(),
  city: String(zone.city || zone.markaz || "").trim(),
  area: String(zone.area || zone.district || "").trim(),
  price: Number.isFinite(Number(zone.price ?? zone.shipping_price)) ? Number(zone.price ?? zone.shipping_price) : 0,
  cod_allowed: zone.cod_allowed !== false,
  requires_shipping_proof: zone.requires_shipping_proof !== false,
  estimated_delivery_text: String(zone.estimated_delivery_text || zone.estimatedDeliveryText || "").trim(),
  provider: normalizeProviderKey(zone.provider || zone.shipping_provider || zone.provider_id || zone.shipping_provider_id),
  provider_id: normalizeProviderKey(zone.provider_id || zone.shipping_provider_id || zone.provider || zone.shipping_provider),
  free_shipping_threshold: Number.isFinite(Number(zone.free_shipping_threshold ?? zone.freeShippingThreshold)) ? Number(zone.free_shipping_threshold ?? zone.freeShippingThreshold) : 0,
  minimum_order_for_cod: Number.isFinite(Number(zone.minimum_order_for_cod ?? zone.minimumOrderForCod)) ? Number(zone.minimum_order_for_cod ?? zone.minimumOrderForCod) : 0,
  active: zone.active !== false,
});

function ShippingZonesEditor({ value, language, defaultPrice, onChange }) {
  const copy = shippingUi[language] || shippingUi.en;
  const [query, setQuery] = useState("");
  const [governorateFilter, setGovernorateFilter] = useState("");
  const [selected, setSelected] = useState([]);
  const [bulkPrice, setBulkPrice] = useState("");
  const [bulkEstimate, setBulkEstimate] = useState("");
  const [draft, setDraft] = useState({ governorate: "Cairo", city: "", area: "", price: defaultPrice || 0 });
  const zones = useMemo(() => (Array.isArray(value) ? value : []).map(normalizeShippingZoneRow), [value]);
  const normalizedQuery = query.trim().toLowerCase();
  const governorateOptions = useMemo(() => Array.from(new Set([...egyptGovernorates.map(([, name]) => name), ...zones.map((zone) => zone.governorate).filter(Boolean)])).sort(), [zones]);
  const visibleZones = zones.filter((zone) => {
    const matchesQuery = !normalizedQuery || [zone.governorate, zone.arabic_alias, zone.city, zone.area, zone.provider, zone.estimated_delivery_text].join(" ").toLowerCase().includes(normalizedQuery);
    const matchesGovernorate = !governorateFilter || normalizeZoneKey(zone.governorate) === normalizeZoneKey(governorateFilter);
    return matchesQuery && matchesGovernorate;
  });
  const selectedSet = new Set(selected);
  const selectedCount = selected.filter((id) => zones.some((zone) => zone.id === id)).length;

  const updateRows = (next) => onChange(next.map(normalizeShippingZoneRow));
  const patchRow = (id, patch) => updateRows(zones.map((zone) => (zone.id === id ? { ...zone, ...patch } : zone)));
  const addRow = (scope = "governorate") => {
    const selectedGovernorate = egyptGovernorates.find(([, name]) => name === draft.governorate);
    const [, governorate = draft.governorate, arabic_alias = ""] = selectedGovernorate || [];
    const row = normalizeShippingZoneRow({
      id: `zone-${Date.now()}-${zones.length}`,
      governorate,
      arabic_alias,
      city: scope === "city" || scope === "area" ? draft.city : "",
      area: scope === "area" ? draft.area : "",
      price: Number.isFinite(Number(draft.price)) ? Number(draft.price) : defaultPrice || 0,
      cod_allowed: governorate === "Damietta",
      requires_shipping_proof: governorate !== "Damietta",
      estimated_delivery_text: governorate === "Damietta" ? "1-2 business days" : "2-5 business days",
      provider: "in_store_delivery",
      provider_id: "in_store_delivery",
      active: true,
    }, zones.length);
    updateRows([...zones, row]);
    setDraft((current) => ({ ...current, city: "", area: "" }));
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
          governorate: row.governorate,
          city: row.city || row.markaz,
          area: row.area || row.district,
          price: row.price || row.shipping_price,
          cod_allowed: !["false", "0", "no"].includes(String(row.cod_allowed || "").toLowerCase()),
          requires_shipping_proof: !["false", "0", "no"].includes(String(row.requires_shipping_proof || "").toLowerCase()),
          estimated_delivery_text: row.estimated_delivery_text || row.eta,
          arabic_alias: row.arabic_alias || row.alias_ar,
          provider: normalizeProviderKey(row.provider || row.shipping_provider),
          provider_id: normalizeProviderKey(row.provider_id || row.shipping_provider_id || row.provider || row.shipping_provider),
          free_shipping_threshold: row.free_shipping_threshold,
          minimum_order_for_cod: row.minimum_order_for_cod,
          active: !["false", "0", "no"].includes(String(row.active || "").toLowerCase()),
        });
      });
      updateRows(rows);
    }
  };
  const toggleVisibleSelection = (checked) => setSelected(checked ? Array.from(new Set([...selected, ...visibleZones.map((zone) => zone.id)])) : selected.filter((id) => !visibleZones.some((zone) => zone.id === id)));

  return (
    <article className="grid gap-4">
      <div className={`rounded-2xl p-3.5 ${fieldSurface}`}>
        <div className="grid gap-3 xl:grid-cols-[minmax(24rem,1fr)_minmax(14rem,0.35fr)_auto] xl:items-center">
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
          <div className="flex flex-wrap justify-start gap-2 xl:justify-end">
            <button type="button" onClick={addAllGovernorates} className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-black text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-200 dark:hover:bg-white/[0.08]"><Plus className="h-4 w-4" />{copy.allGovernorates}</button>
            <button type="button" onClick={exportZones} className="inline-flex h-9 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-black text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 dark:border-white/10 dark:bg-white/[0.035] dark:text-slate-300 dark:hover:bg-white/[0.08]"><Download className="h-3.5 w-3.5" />{copy.export}</button>
            <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-black text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 dark:border-white/10 dark:bg-white/[0.035] dark:text-slate-300 dark:hover:bg-white/[0.08]">
              <Upload className="h-3.5 w-3.5" />
              {copy.import}
              <input type="file" accept=".json,.csv,application/json,text/csv" className="sr-only" onChange={(event) => importZones(event.target.files?.[0])} />
            </label>
          </div>
        </div>
      </div>

      <div className={`rounded-2xl p-4 ${fieldSurface}`}>
        <div className="mb-3 flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-xl bg-slate-950 text-white dark:bg-white dark:text-slate-950"><Plus className="h-4 w-4" /></span>
          <h3 className={`text-sm font-black ${headingText}`}>{copy.quickTitle}</h3>
        </div>
        <div className="grid gap-3 lg:grid-cols-[minmax(12rem,1fr)_minmax(11rem,1fr)_minmax(11rem,1fr)_7rem_auto] lg:items-center">
          <select value={draft.governorate} onChange={(event) => setDraft((current) => ({ ...current, governorate: event.target.value }))} className={inputClass}>
            {egyptGovernorates.map(([, name, ar]) => <option key={name} value={name}>{name} / {ar}</option>)}
          </select>
          <input value={draft.city} onChange={(event) => setDraft((current) => ({ ...current, city: event.target.value }))} placeholder="City / Markaz" className={inputClass} />
          <input value={draft.area} onChange={(event) => setDraft((current) => ({ ...current, area: event.target.value }))} placeholder="Area / District" className={inputClass} />
          <input type="number" min="0" value={draft.price} onChange={(event) => setDraft((current) => ({ ...current, price: event.target.value }))} placeholder="Price" className={inputClass} />
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => addRow("governorate")} className="h-11 rounded-xl bg-slate-950 px-4 text-xs font-black text-white shadow-sm transition hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200">{copy.addZone}</button>
            <button type="button" onClick={() => addRow("city")} className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-xs font-black text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-200 dark:hover:bg-white/[0.08]">{copy.createCity}</button>
            <button type="button" onClick={() => addRow("area")} className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-xs font-black text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-200 dark:hover:bg-white/[0.08]">{copy.createArea}</button>
          </div>
        </div>
      </div>

      <div className={`rounded-2xl p-4 ${fieldSurface}`}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex items-center gap-2 rounded-xl bg-slate-100 px-3 py-2 text-xs font-black text-slate-600 dark:bg-white/[0.055] dark:text-slate-300">
            <SlidersHorizontal className="h-4 w-4" />
            {copy.bulk}: {selectedCount} {copy.selected}
          </div>
          <button type="button" onClick={deleteSelected} disabled={!selectedCount} className="inline-flex h-10 items-center gap-2 rounded-xl border border-rose-200 bg-white px-3 text-xs font-black text-rose-600 transition hover:bg-rose-50 disabled:opacity-40 dark:border-rose-400/25 dark:bg-white/[0.04] dark:text-rose-200 dark:hover:bg-rose-500/10"><Trash2 className="h-4 w-4" />{copy.deleteSelected}</button>
        </div>
        <div className="grid gap-3 xl:grid-cols-[minmax(14rem,0.8fr)_minmax(18rem,1.1fr)_auto]">
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
            <input type="number" min="0" value={bulkPrice} onChange={(event) => setBulkPrice(event.target.value)} placeholder={copy.bulkPrice} className={inputClass} />
            <button type="button" onClick={applyBulkPrice} disabled={!selectedCount} className="h-12 rounded-xl bg-slate-950 px-4 text-xs font-black text-white disabled:opacity-45 dark:bg-white dark:text-slate-950">{copy.bulkPrice}</button>
          </div>
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
            <input value={bulkEstimate} onChange={(event) => setBulkEstimate(event.target.value)} placeholder={copy.bulkEstimate} className={inputClass} />
            <button type="button" onClick={applyBulkEstimate} disabled={!selectedCount} className="h-12 rounded-xl bg-slate-950 px-4 text-xs font-black text-white disabled:opacity-45 dark:bg-white dark:text-slate-950">{copy.bulkEstimate}</button>
          </div>
          <div className="flex flex-wrap gap-2 xl:justify-end">
            <button type="button" onClick={() => applyToSelected({ cod_allowed: true })} disabled={!selectedCount} className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-xs font-black text-slate-700 disabled:opacity-40 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-200">{copy.enableCod}</button>
            <button type="button" onClick={() => applyToSelected({ cod_allowed: false })} disabled={!selectedCount} className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-xs font-black text-slate-700 disabled:opacity-40 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-200">{copy.disableCod}</button>
            <button type="button" onClick={() => applyToSelected({ requires_shipping_proof: true })} disabled={!selectedCount} className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-xs font-black text-slate-700 disabled:opacity-40 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-200">{copy.requireProof}</button>
            <button type="button" onClick={() => applyToSelected({ requires_shipping_proof: false })} disabled={!selectedCount} className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-xs font-black text-slate-700 disabled:opacity-40 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-200">{copy.skipProof}</button>
          </div>
        </div>
      </div>

      <div className="max-h-[36rem] overflow-auto rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-white/10 dark:bg-slate-950/60 dark:shadow-none">
        <table className="w-full min-w-[1360px] border-separate border-spacing-0 text-start text-sm">
          <thead className="sticky top-0 z-10 bg-slate-50 text-xs font-black uppercase text-slate-500 shadow-[0_1px_0_rgba(148,163,184,0.28)] dark:bg-slate-900 dark:text-slate-400 dark:shadow-[0_1px_0_rgba(255,255,255,0.08)]">
            <tr>
              <th className="w-12 px-4 py-3 text-center"><input type="checkbox" className="h-4 w-4 align-middle" checked={visibleZones.length > 0 && visibleZones.every((zone) => selectedSet.has(zone.id))} onChange={(event) => toggleVisibleSelection(event.target.checked)} /></th>
              {copy.headers.map((header) => <th key={header} className="whitespace-nowrap px-4 py-3">{header}</th>)}
            </tr>
          </thead>
          <tbody>
            {visibleZones.map((zone) => (
              <tr key={zone.id} className="bg-white transition hover:bg-slate-50 dark:bg-transparent dark:hover:bg-white/[0.035]">
                <td className="border-b border-slate-100 px-4 py-3 text-center align-middle dark:border-white/10">
                  <input type="checkbox" className="h-4 w-4 align-middle" checked={selectedSet.has(zone.id)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, zone.id] : current.filter((item) => item !== zone.id))} />
                </td>
                <td className="border-b border-slate-100 px-4 py-3 align-middle dark:border-white/10"><input value={zone.governorate} onChange={(event) => patchRow(zone.id, { governorate: event.target.value })} className={`${inputClass} h-10 min-w-40 rounded-xl`} /></td>
                <td className="border-b border-slate-100 px-4 py-3 align-middle dark:border-white/10"><input value={zone.city} onChange={(event) => patchRow(zone.id, { city: event.target.value })} className={`${inputClass} h-10 min-w-40 rounded-xl`} /></td>
                <td className="border-b border-slate-100 px-4 py-3 align-middle dark:border-white/10"><input value={zone.area} onChange={(event) => patchRow(zone.id, { area: event.target.value })} className={`${inputClass} h-10 min-w-40 rounded-xl`} /></td>
                <td className="border-b border-slate-100 px-4 py-3 align-middle dark:border-white/10"><input type="number" min="0" value={zone.price} onChange={(event) => patchRow(zone.id, { price: Number(event.target.value) })} className={`${inputClass} h-10 w-24 rounded-xl text-center`} /></td>
                {["cod_allowed", "requires_shipping_proof"].map((key) => (
                  <td key={key} className="border-b border-slate-100 px-4 py-3 text-center align-middle dark:border-white/10">
                    <input type="checkbox" className="h-4 w-4 align-middle" checked={Boolean(zone[key])} onChange={(event) => patchRow(zone.id, { [key]: event.target.checked })} />
                  </td>
                ))}
                <td className="border-b border-slate-100 px-4 py-3 align-middle dark:border-white/10"><input value={zone.estimated_delivery_text} onChange={(event) => patchRow(zone.id, { estimated_delivery_text: event.target.value })} className={`${inputClass} h-10 min-w-56 rounded-xl`} /></td>
                <td className="border-b border-slate-100 px-4 py-3 align-middle dark:border-white/10">
                  <select value={zone.provider_id || zone.provider} onChange={(event) => patchRow(zone.id, { provider: event.target.value, provider_id: event.target.value })} className="h-10 w-44 rounded-full border border-slate-200 bg-slate-50 px-3 text-xs font-black text-slate-700 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100 dark:border-white/10 dark:bg-white/[0.055] dark:text-slate-100 dark:focus:border-blue-400 dark:focus:ring-blue-500/15">
                    {shippingProviderOptions.map((provider) => <option key={provider.id} value={provider.id}>{provider.label}</option>)}
                  </select>
                </td>
                <td className="border-b border-slate-100 px-4 py-3 align-middle dark:border-white/10"><input type="number" min="0" value={zone.free_shipping_threshold} onChange={(event) => patchRow(zone.id, { free_shipping_threshold: Number(event.target.value) })} className={`${inputClass} h-10 w-24 rounded-xl text-center`} /></td>
                <td className="border-b border-slate-100 px-4 py-3 align-middle dark:border-white/10"><input type="number" min="0" value={zone.minimum_order_for_cod} onChange={(event) => patchRow(zone.id, { minimum_order_for_cod: Number(event.target.value) })} className={`${inputClass} h-10 w-24 rounded-xl text-center`} /></td>
                <td className="border-b border-slate-100 px-4 py-3 text-center align-middle dark:border-white/10">
                  <input type="checkbox" className="h-4 w-4 align-middle" checked={Boolean(zone.active)} onChange={(event) => patchRow(zone.id, { active: event.target.checked })} />
                </td>
                <td className="border-b border-slate-100 px-4 py-3 align-middle dark:border-white/10">
                  <button type="button" onClick={() => deleteRow(zone.id)} className="grid h-9 w-9 place-items-center rounded-xl border border-rose-200 text-rose-600 transition hover:bg-rose-50 dark:border-rose-400/25 dark:text-rose-200 dark:hover:bg-rose-500/10" aria-label="Delete zone"><Trash2 className="h-4 w-4" /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!visibleZones.length ? <div className={`p-8 text-center text-sm font-bold ${bodyText}`}>{copy.empty}</div> : null}
      </div>
    </article>
  );
}

function VisualSection({ icon: Icon, title, description, children }) {
  return (
    <section className={`rounded-[1.75rem] p-5 ${shellCard}`}>
      <div className="mb-5 flex items-start gap-3">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-slate-100 text-slate-700 dark:bg-white/8 dark:text-slate-200"><Icon className="h-6 w-6" /></span>
        <div>
          <h2 className={`text-xl font-black ${headingText}`}>{title}</h2>
          <p className={`mt-1 text-sm leading-6 ${bodyText}`}>{description}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

function PremiumInput({ label, value, onChange }) {
  return (
    <label className={`block rounded-2xl p-4 ${fieldSurface}`}>
      <span className={`mb-2 block text-sm font-black ${headingText}`}>{label}</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} className="h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-950 outline-none focus:border-sky-400 focus:ring-4 focus:ring-sky-100 dark:border-white/10 dark:bg-slate-950 dark:text-white dark:focus:border-blue-400 dark:focus:ring-blue-500/15" />
    </label>
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
          <h3 className={`text-sm font-black ${headingText}`}>{title}</h3>
          <p className={`mt-1 text-xs leading-5 ${bodyText}`}>{helper}</p>
        </div>
        {hasValue ? (
          <button type="button" onClick={() => onChange("")} className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-black text-slate-600 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700 dark:border-white/10 dark:bg-white/5 dark:text-slate-300 dark:hover:border-rose-400/30 dark:hover:bg-rose-500/10 dark:hover:text-rose-200">
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
          <input value={value || ""} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-950 outline-none focus:border-sky-400 focus:ring-4 focus:ring-sky-100 dark:border-white/10 dark:bg-slate-950 dark:text-white dark:placeholder:text-slate-500 dark:focus:border-blue-400 dark:focus:ring-blue-500/15" />
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
      <input value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); add(); } }} placeholder={hint} className="mt-3 h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-950 outline-none focus:border-sky-400 focus:ring-4 focus:ring-sky-100 dark:border-white/10 dark:bg-slate-950 dark:text-white dark:placeholder:text-slate-500 dark:focus:border-blue-400 dark:focus:ring-blue-500/15" />
    </div>
  );
}

function initialsFor(value = "") {
  const words = String(value || "Store").trim().split(/\s+/).filter(Boolean);
  return words.slice(0, 2).map((word) => word[0]?.toUpperCase()).join("") || "S";
}

function LogoAvatar({ src, name, size = "h-12 w-12" }) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (src && !failed) {
    return (
      <div className={`grid ${size} place-items-center overflow-hidden rounded-2xl bg-slate-100 dark:bg-slate-900`}>
        <img src={src} alt="" onError={() => setFailed(true)} className="h-full w-full object-cover" />
      </div>
    );
  }

  return (
    <div className={`grid ${size} place-items-center rounded-2xl bg-gradient-to-br from-slate-900 to-slate-600 text-sm font-black text-white dark:from-blue-500 dark:to-violet-500`}>
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
            <h2 className={`mt-1 text-xl font-black ${headingText}`}>{ui.previewTitle}</h2>
          </div>
          <button type="button" onClick={onClose} className="grid h-11 w-11 place-items-center rounded-2xl border border-slate-200 bg-white text-slate-700 transition hover:bg-slate-50 dark:border-white/10 dark:bg-white/5 dark:text-slate-200 dark:hover:bg-white/10">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">{children}</div>
      </aside>
    </div>
  );
}

function PreviewPanel({ storeName, storeUrl, logoUrl, hero }) {
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
                <div className="text-[10px] font-black uppercase tracking-[0.16em] text-white/45">Homepage</div>
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
            <h2 className={`text-lg font-black ${headingText}`}>{ui.apiErrorTitle}</h2>
            <p className={`mt-1 text-sm leading-6 ${bodyText}`}>{ui.apiErrorHint}</p>
            <p className="mt-3 rounded-2xl bg-rose-50 px-3 py-2 text-sm font-bold text-rose-700 dark:bg-rose-500/10 dark:text-rose-200">{error}</p>
          </div>
        </div>
        <button type="button" onClick={onRetry} className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-rose-600 px-4 text-sm font-black text-white">
          <RefreshCw className="h-4 w-4" />
          {ui.retry}
        </button>
      </div>
    </section>
  );
}

function SettingsDebugPage({ ui, records, values, loading, error, onRetry }) {
  return (
    <div className="min-h-screen bg-[#f6f8fb] p-4 text-slate-950 dark:bg-[#050816] dark:text-white sm:p-6">
      <main className="mx-auto max-w-6xl space-y-5">
        <section className={`rounded-[1.75rem] p-5 ${shellCard}`}>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h1 className={`text-2xl font-black ${headingText}`}>{ui.advanced}</h1>
              <p className={`mt-1 text-sm leading-6 ${bodyText}`}>{ui.advancedHint}</p>
            </div>
            <button type="button" onClick={onRetry} className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-black text-slate-700 dark:border-white/10 dark:bg-white/5 dark:text-slate-200">
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              {ui.retry}
            </button>
          </div>
          {error ? (
            <p className="mt-4 rounded-2xl bg-rose-50 px-3 py-2 text-sm font-bold text-rose-700 dark:bg-rose-500/10 dark:text-rose-200">{error}</p>
          ) : null}
        </section>

        <section className={`rounded-[1.75rem] p-5 ${shellCard}`}>
          <h2 className={`text-lg font-black ${headingText}`}>Registry audit</h2>
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
          <h2 className={`text-lg font-black ${headingText}`}>Runtime metadata</h2>
          <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-950 p-4 text-xs text-slate-300 dark:border-white/10 dark:bg-black/30">
            <div>Loaded settings: {records.length}</div>
            <div>Edited local values: {Object.keys(values).length}</div>
            <div>Debug source: /settings/debug</div>
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
