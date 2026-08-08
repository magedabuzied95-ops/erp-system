import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowUpRight,
  Bot,
  Clock3,
  Copy,
  ExternalLink,
  Filter,
  Handshake,
  Loader2,
  MessageCircle,
  MessageSquareText,
  ShoppingBag,
  Sparkles,
  User,
  Users2,
  X,
} from "lucide-react";

import { api } from "../../../shared/api/api";
import "./Customer360Drawer.css";

const clean = (value = "") => String(value ?? "").trim();

const safeArray = (value) => (Array.isArray(value) ? value : []);

const CUSTOMER_TABS = [
  { key: "summary", label: "Summary" },
  { key: "activity", label: "Activity" },
  { key: "timeline", label: "Timeline" },
  { key: "orders", label: "Orders" },
  { key: "products", label: "Products" },
  { key: "insights", label: "AI Insights" },
];

const formatDateTime = (value = "") => {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
};

const relativeTime = (value = "") => {
  if (!value) return "وقت غير معروف";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "وقت غير معروف";
  const diff = Date.now() - date.getTime();
  const minutes = Math.max(0, Math.floor(diff / 60000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return `${days} d ago`;
};

const badgeClassByPlatform = (platform = "") => {
  const key = clean(platform).toLowerCase();
  if (key.includes("instagram")) return "border-[#FBCFE8] bg-[#FFF1F2] text-[#E1306C]";
  if (key.includes("whatsapp")) return "border-[#BBF7D0] bg-[#ECFDF5] text-[#16A34A]";
  if (key.includes("tiktok")) return "border-slate-200 bg-slate-100 text-slate-700";
  if (key.includes("web")) return "border-slate-200 bg-slate-100 text-slate-700";
  return "border-[#BFDBFE] bg-[#EAF2FF] text-[#1877F2]";
};

const sourceLabelByPlatform = (platform = "") => {
  const key = clean(platform).toLowerCase();
  if (key.includes("instagram")) return "Instagram";
  if (key.includes("whatsapp")) return "WhatsApp";
  if (key.includes("messenger") || key.includes("facebook")) return "Messenger";
  if (key.includes("tiktok")) return "TikTok";
  if (key.includes("web")) return "Web";
  return "Customer";
};

const statusTone = (value = "") => {
  const key = clean(value).toLowerCase().replace(/\s+/g, "_");
  if (["vip", "premium", "preferred"].includes(key)) return "border-[#BBF7D0] bg-[#ECFDF5] text-[#059669]";
  if (["blocked", "blacklisted", "banned"].includes(key)) return "border-[#FECACA] bg-[#FEF2F2] text-[#DC2626]";
  if (["human_takeover", "human", "manual"].includes(key)) return "border-[#FED7AA] bg-[#FFF7ED] text-[#C2410C]";
  if (["ai_handling", "ai", "automated"].includes(key)) return "border-[#BFDBFE] bg-[#EAF2FF] text-[#1877F2]";
  return "border-slate-200 bg-slate-100 text-slate-600";
};

const metricCard = (label, value) => (
  <div className="rounded-2xl border border-[#E2E8F0] bg-white p-3 shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
    <div className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">{label}</div>
    <div className="mt-1 text-sm font-black text-slate-900">{value === null || value === undefined || value === "" ? "—" : value}</div>
  </div>
);

const TabButton = ({ active, children, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className={`rounded-full border px-3 py-1.5 text-[11px] font-black transition ${
      active ? "bg-slate-900 text-white border-slate-900" : "border-[#E2E8F0] bg-white text-slate-700 hover:border-slate-300"
    }`}
  >
    {children}
  </button>
);

const fallbackCustomerProfile = (customer = {}, context = {}) => {
  const profile = customer?.customer_profile || customer?.profile || {};
  return {
    id: customer.customer_id || customer.id || context.customerId || profile.id || customer.customer_profile_id || customer.profile_id || "",
    name:
      customer.erp_customer_name ||
      customer.name ||
      customer.customer_name ||
      profile.name ||
      profile.display_name ||
      profile.facebook_name ||
      profile.messenger_name ||
      customer.commenter_name ||
      customer.author_name ||
      customer.from_name ||
      "Customer",
    avatar_url:
      customer.customer_avatar_url ||
      profile.avatar_url ||
      profile.profile_pic_url ||
      profile.profile_pic ||
      customer.commenter_profile_picture_url ||
      customer.profile_pic_url ||
      "",
    platform: clean(customer.platform || profile.source_channel || context.platform || "facebook").toLowerCase(),
    phone: clean(customer.phone || customer.phone_number || profile.phone || profile.phone_number || context.phone || ""),
    email: clean(customer.email || profile.email || context.email || ""),
    city: clean(customer.city || profile.city || profile.address?.city || context.city || ""),
    tier: clean(customer.customer_tier || profile.customer_tier || profile.tier || context.customerTier || "Standard"),
    status: clean(customer.customer_status || profile.customer_status || context.status || ""),
    last_active_at:
      customer.last_activity_at ||
      customer.updated_at ||
      profile.last_seen_at ||
      profile.updated_at ||
      context.lastActiveAt ||
      "",
    customer_since: profile.created_at || customer.created_at || context.customerSince || "",
    summary:
      profile.conversation_summary ||
      customer.summary ||
      customer.latest_message_preview ||
      context.summary ||
      "",
    metrics: context.metrics || {},
    orders: safeArray(profile.previous_orders || context.orders),
    products: {
      viewed: safeArray(profile.viewed_products || context.viewedProducts),
      purchased: safeArray(profile.purchased_products || context.purchasedProducts),
      wishlist: safeArray(profile.wishlist_products || context.wishlistProducts),
    },
    insights: context.insights || {},
    purchasePreferences: profile.purchase_preferences || customer.purchase_preferences || context.purchasePreferences || {},
    timeline: safeArray(context.timeline),
    currentActivity: safeArray(context.currentActivity),
  };
};

export default function Customer360Drawer({
  open = false,
  onClose,
  customer = null,
  customerId = "",
  customerProfile = null,
  context = {},
  title = "Customer 360",
  initialTab = "summary",
  aiAnalysis = null,
}) {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState(initialTab);
  const [loading, setLoading] = useState(false);
  const [loadingTab, setLoadingTab] = useState("");
  const [profileData, setProfileData] = useState(() => fallbackCustomerProfile(customerProfile || customer || {}, { ...context, customerId }));

  useEffect(() => {
    if (!open) return;
    setActiveTab(initialTab);
  }, [initialTab, open]);

  useEffect(() => {
    if (!open) return;
    setProfileData(fallbackCustomerProfile(customerProfile || customer || {}, { ...context, customerId }));
  }, [context, customer, customerId, customerProfile, open]);

  useEffect(() => {
    if (!open) return undefined;
    const id = clean(customerId || customerProfile?.id || customer?.customer_profile_id || customer?.profile_id || "");
    if (!id) return undefined;

    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const payload = await api.get(`/customers/${encodeURIComponent(id)}/profile`, { perfComponent: "Customer360.profile" });
        if (cancelled) return;
        const data = payload?.data || payload || {};
        setProfileData((current) => ({
          ...current,
          ...fallbackCustomerProfile(data.customer || customerProfile || customer || {}, { ...context, customerId: id }),
          metrics: data.metrics || current.metrics,
          orders: safeArray(data.orders || current.orders),
          products: {
            viewed: safeArray(data.favorites?.viewed_products || current.products?.viewed),
            purchased: safeArray(data.favorites?.purchased_products || current.products?.purchased),
            wishlist: safeArray(data.favorites?.wishlist_products || current.products?.wishlist),
          },
          insights: {
            ...current.insights,
            favoriteCategory: data.favorites?.topCategory || current.insights?.favoriteCategory || "",
            totalSpend: data.metrics?.totalSpend || current.metrics?.totalSpend || 0,
          },
          purchasePreferences: data.favorites || data.customer?.purchase_preferences || current.purchasePreferences || {},
          notes: safeArray(data.notes),
        }));
      } catch {
        // Silent fallback to the already supplied data.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [context, customer, customerId, customerProfile, open]);

  const tabs = CUSTOMER_TABS;

  const metrics = profileData.metrics || {};
  const currentActivity = profileData.currentActivity || [];
  const timeline = profileData.timeline || [];
  const orders = profileData.orders || [];
  const viewedProducts = profileData.products?.viewed || [];
  const purchasedProducts = profileData.products?.purchased || [];
  const wishlistProducts = profileData.products?.wishlist || [];
  const purchasePreferences = profileData.purchasePreferences || {};
  const preferredDepartments = safeArray(purchasePreferences.departments);
  const preferredCategories = safeArray(purchasePreferences.categories);
  const preferredSizes = safeArray(purchasePreferences.sizeBreakdown).length
    ? safeArray(purchasePreferences.sizeBreakdown)
    : safeArray(purchasePreferences.sizes).map((value) => ({ value, count: 0 }));
  const status = clean(profileData.status || context.status || "");
  const resolvedCustomerId = clean(profileData.id || customerId || customer?.customer_profile_id || customer?.profile_id || "");
  const resolvedConversationId = clean(customer?.session_id || customer?.conversation_id || customer?.conversation_key || context.conversationId || "");
  const crmIntelligence = aiAnalysis?.crm || null;
  const lifetimeSpend = crmIntelligence?.metrics?.lifetimeSpend ?? metrics.totalSpend ?? context.totalSpend;
  const returnToConversation = (mode = "chat") => {
    onClose?.();
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent("m1:ai-inbox-customer-action", { detail: { mode } }));
    }, 60);
  };
  const openSystemPath = (path = "") => {
    if (!path) return;
    onClose?.();
    navigate(path);
  };
  const orderPath = (order = {}) => clean(order.id || order.order_id) ? `/orders/${encodeURIComponent(clean(order.id || order.order_id))}` : "/orders";
  const productPath = (product = {}) => clean(product.id || product.product_id) ? `/products/${encodeURIComponent(clean(product.id || product.product_id))}` : "/products";
  const communicationActions = [
    { label: "Open Chat", Icon: MessageCircle, action: () => returnToConversation("chat") },
    { label: "Reply", Icon: MessageSquareText, action: () => returnToConversation("reply") },
    { label: "Private Reply", Icon: Bot, action: () => returnToConversation("private_reply") },
    { label: "Create Lead", Icon: Users2, action: () => openSystemPath(`/marketing/ai-center/leads${resolvedCustomerId ? `?customer_id=${encodeURIComponent(resolvedCustomerId)}` : ""}`) },
  ];
  const workflowActions = [
    { label: "Create Order", Icon: ShoppingBag, action: () => openSystemPath(`/create-order${resolvedCustomerId ? `?customer_id=${encodeURIComponent(resolvedCustomerId)}` : ""}`) },
    { label: "Assign Agent", Icon: Handshake, action: () => openSystemPath(`/admin/ai-inbox${resolvedConversationId ? `?conversation_id=${encodeURIComponent(resolvedConversationId)}&action=assign` : ""}`) },
    { label: "Open Customer Profile", Icon: ExternalLink, action: () => openSystemPath(`/customers${resolvedCustomerId ? `?customer_id=${encodeURIComponent(resolvedCustomerId)}` : ""}`) },
  ];
  const quickActions = [...communicationActions, ...workflowActions];

  if (!open) return null;

  return (
    <div className="m1-customer-360 fixed inset-0 z-[80]">
      <button type="button" aria-label="Close customer drawer" onClick={onClose} className="absolute inset-0 bg-slate-950/35 backdrop-blur-[1px]" />
      <aside className="absolute inset-y-0 right-0 flex h-full w-full flex-col bg-[#F8FAFC] shadow-[0_24px_80px_rgba(15,23,42,0.24)] sm:w-[460px] lg:w-[520px]">
        <div className="sticky top-0 z-10 border-b border-[#E2E8F0] bg-white/95 px-4 py-4 backdrop-blur">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-3">
              {profileData.avatar_url ? (
                <img src={profileData.avatar_url} alt="" className="h-12 w-12 shrink-0 rounded-2xl object-cover ring-1 ring-slate-200" loading="lazy" />
              ) : (
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-[#E2E8F0] bg-slate-50 text-slate-500">
                  <User className="h-5 w-5" />
                </span>
              )}
              <div className="min-w-0">
                <div className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">{title}</div>
                <div className="mt-1 truncate text-lg font-black text-slate-900">{profileData.name || "Customer"}</div>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs font-semibold text-slate-600">
                  {profileData.phone ? <span>{profileData.phone}</span> : null}
                  {profileData.email ? <span>{profileData.email}</span> : null}
                  {profileData.city ? <span>{profileData.city}</span> : null}
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <span className={`rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.08em] ${badgeClassByPlatform(profileData.platform)}`}>{sourceLabelByPlatform(profileData.platform)}</span>
                  <span className={`rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.08em] ${statusTone(status || context.aiStatus || "new")}`}>{status || context.aiStatus || "New"}</span>
                  <span className="rounded-full border border-[#E2E8F0] bg-white px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.08em] text-slate-600">{profileData.tier}</span>
                  <span className={`rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.08em] ${statusTone(context.handlingMode || "human")}`}>{clean(context.handlingMode || "Human Takeover")}</span>
                  <span className="rounded-full border border-[#E2E8F0] bg-white px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.08em] text-slate-600">{relativeTime(profileData.last_active_at)}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
                  <span><strong className="text-slate-700">Lifetime spend:</strong> {lifetimeSpend ? `${lifetimeSpend} EGP` : "—"}</span>
                  <span><strong className="text-slate-700">Orders:</strong> {crmIntelligence?.metrics?.totalOrders ?? metrics.totalOrders ?? orders.length}</span>
                  <span><strong className="text-slate-700">Since:</strong> {formatDateTime(profileData.customer_since)}</span>
                  <span><strong className="text-slate-700">Channel:</strong> {sourceLabelByPlatform(profileData.platform)}</span>
                </div>
              </div>
            </div>
            <button type="button" onClick={onClose} className="rounded-full border border-[#E2E8F0] bg-white p-2 text-slate-700 shadow-sm">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
            {tabs.map((tab) => (
              <TabButton key={tab.key} active={activeTab === tab.key} onClick={() => setActiveTab(tab.key)}>
                {tab.label}
              </TabButton>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {loading && !profileData.name ? (
            <div className="space-y-3">
              <div className="h-24 rounded-3xl border border-[#E2E8F0] bg-white animate-pulse" />
              <div className="grid grid-cols-2 gap-3">
                <div className="h-20 rounded-2xl border border-[#E2E8F0] bg-white animate-pulse" />
                <div className="h-20 rounded-2xl border border-[#E2E8F0] bg-white animate-pulse" />
              </div>
            </div>
          ) : null}

          {activeTab === "summary" ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                {metricCard("Total Orders", metrics.totalOrders ?? context.totalOrders ?? 0)}
                {metricCard("Completed Orders", metrics.completedOrders ?? context.completedOrders ?? 0)}
                {metricCard("Cancelled Orders", metrics.cancelledOrders ?? context.cancelledOrders ?? 0)}
                {metricCard("Total Spend", metrics.totalSpend ? `${metrics.totalSpend} EGP` : context.totalSpend ? `${context.totalSpend} EGP` : "—")}
                {metricCard("Average Order", metrics.averageOrder ? `${metrics.averageOrder} EGP` : context.averageOrder ? `${context.averageOrder} EGP` : "—")}
                {metricCard("Last Order Date", formatDateTime(metrics.lastOrderAt || context.lastOrderAt || ""))}
                {metricCard("Loyalty Points", metrics.loyaltyPoints ?? context.loyaltyPoints ?? 0)}
                {metricCard("Customer Since", formatDateTime(profileData.customer_since || context.customerSince || ""))}
              </div>
              {(preferredDepartments.length || preferredCategories.length || preferredSizes.length) ? (
                <div className="rounded-3xl border border-[#E2E8F0] bg-white p-4 shadow-[0_8px_24px_rgba(15,23,42,0.04)]" dir="rtl">
                  <div className="flex items-center gap-2 text-sm font-black text-slate-900">
                    <ShoppingBag className="h-4 w-4 text-emerald-600" />
                    تفضيلات الشراء المسجلة تلقائيًا
                  </div>
                  <p className="mt-1 text-xs leading-5 text-slate-500">مستخرجة من مشتريات العميل الفعلية لاستخدامها في العروض الموجهة.</p>
                  <div className="mt-3 space-y-3">
                    {preferredDepartments.length ? (
                      <div>
                        <div className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-500">القسم</div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {preferredDepartments.map((item) => <span key={item.value} className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-black text-emerald-800">{item.value}{item.count ? ` · ${item.count}` : ""}</span>)}
                        </div>
                      </div>
                    ) : null}
                    {preferredCategories.length ? (
                      <div>
                        <div className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-500">التصنيف</div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {preferredCategories.map((item) => <span key={item.value} className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-black text-sky-800">{item.value}{item.count ? ` · ${item.count}` : ""}</span>)}
                        </div>
                      </div>
                    ) : null}
                    {preferredSizes.length ? (
                      <div>
                        <div className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-500">المقاسات</div>
                        <div className="mt-2 flex flex-wrap gap-2" dir="ltr">
                          {preferredSizes.map((item) => <span key={item.value} className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-black text-amber-900">{item.value}{item.count ? ` · ${item.count}` : ""}</span>)}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}
              {crmIntelligence ? <div className="rounded-3xl border border-[#E2E8F0] bg-white p-4 shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
                <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.16em] text-slate-500"><Sparkles className="h-4 w-4" />AI Summary</div>
                <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-700">
                  {crmIntelligence.summary.map((item) => <li key={item} className="flex gap-2"><span aria-hidden="true">•</span><span>{item}</span></li>)}
                </ul>
              </div> : null}
              <div className="rounded-3xl border border-[#E2E8F0] bg-white p-4 shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
                <div className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">Quick Actions</div>
                <div className="mt-3 hidden grid-cols-2 gap-2 sm:grid" role="group" aria-label="Customer communication and workflow actions">
                  {quickActions.map(({ label, Icon, action }) => (
                    <button
                      key={label}
                      type="button"
                      onClick={action}
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-[#E2E8F0] bg-white px-3 text-xs font-black text-slate-700 shadow-sm"
                    >
                      <Icon className="h-4 w-4" />
                      {label}
                    </button>
                  ))}
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 sm:hidden" role="group" aria-label="Additional customer workflow actions">
                  {workflowActions.map(({ label, Icon, action }, index) => (
                    <button
                      key={label}
                      type="button"
                      onClick={action}
                      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[#E2E8F0] bg-white px-3 text-xs font-black text-slate-700 shadow-sm ${index === workflowActions.length - 1 ? "col-span-2" : ""}`}
                    >
                      <Icon className="h-4 w-4" />
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              {crmIntelligence ? <div className="rounded-3xl border border-[#E2E8F0] bg-white p-4 shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
                <div className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">Customer Preferences</div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {[
                    ["Preferred Categories", crmIntelligence.preferences.favoriteCategory],
                    ["Favorite Brands", crmIntelligence.preferences.favoriteBrand],
                    ["Sizes", crmIntelligence.preferences.favoriteSize],
                    ["Colors", crmIntelligence.preferences.favoriteColor],
                    ["Budget", crmIntelligence.preferences.budgetRange],
                    ["Reply Style", crmIntelligence.preferences.replyStyle],
                    ...(crmIntelligence.preferences.preferredChannel ? [["Preferred Channel", crmIntelligence.preferences.preferredChannel]] : []),
                    ...(crmIntelligence.preferences.preferredPurchaseTime ? [["Purchase Time", crmIntelligence.preferences.preferredPurchaseTime]] : []),
                    ...(crmIntelligence.preferences.favoritePaymentMethod ? [["Payment Method", crmIntelligence.preferences.favoritePaymentMethod]] : []),
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-2xl border border-[#E2E8F0] bg-[#F8FAFC] p-3">
                      <div className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">{label}</div>
                      <div className="mt-1 truncate text-sm font-black text-slate-900" title={value}>{value}</div>
                    </div>
                  ))}
                </div>
              </div> : null}
            </div>
          ) : null}

          {activeTab === "activity" ? (
            <div className="space-y-2">
              {currentActivity.length ? currentActivity.map((item, index) => (
                <div key={item.id || `${item.type || "activity"}-${index}`} className="rounded-2xl border border-[#E2E8F0] bg-white p-3 shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
                  <div className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">{clean(item.type || item.channel || "Activity")}</div>
                  <div className="mt-1 text-sm font-black text-slate-900">{clean(item.label || item.title || item.source || "Latest activity")}</div>
                  <div className="mt-1 text-xs text-slate-500">{clean(item.time || item.created_at || "") ? formatDateTime(item.time || item.created_at) : "Unknown"}</div>
                </div>
              )) : <div className="rounded-2xl border border-dashed border-[#E2E8F0] bg-white p-6 text-center text-sm text-slate-500">No current activity yet.</div>}
            </div>
          ) : null}

          {activeTab === "timeline" ? (
            <div className="space-y-2">
              {timeline.length ? timeline.map((item, index) => (
                <div key={item.id || `${item.key || item.label}-${index}`} className="rounded-2xl border border-[#E2E8F0] bg-white p-3 shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full border border-[#E2E8F0] bg-slate-50 text-slate-700">
                      <Clock3 className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-black text-slate-900">{clean(item.label || "Event")}</div>
                      <div className="mt-1 text-xs text-slate-500">{formatDateTime(item.time || item.created_at || "")}</div>
                    </div>
                  </div>
                </div>
              )) : <div className="rounded-2xl border border-dashed border-[#E2E8F0] bg-white p-6 text-center text-sm text-slate-500">Timeline will appear when there is source data.</div>}
            </div>
          ) : null}

          {activeTab === "orders" ? (
            <div className="space-y-2">
              {orders.length ? orders.map((order, index) => (
                <div key={order.id || order.order_id || index} className="rounded-2xl border border-[#E2E8F0] bg-white p-3 shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-sm font-black text-slate-900">Order #{clean(order.order_number || order.invoice_number || order.id || `#${index + 1}`)}</div>
                      <div className="mt-1 text-xs text-slate-500">{formatDateTime(order.created_at || order.order_date || "")}</div>
                    </div>
                    <span className="rounded-full border border-[#E2E8F0] bg-slate-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.08em] text-slate-600">{clean(order.status || "Open")}</span>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-sm text-slate-700">
                    <span>{clean(order.amount || order.total_amount || order.total || "—")} EGP</span>
                    <button type="button" onClick={() => openSystemPath(orderPath(order))} className="inline-flex items-center gap-1 rounded-xl border border-[#E2E8F0] bg-white px-3 py-1.5 text-[11px] font-black text-slate-700">
                      Open Order <ArrowUpRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              )) : <div className="rounded-2xl border border-dashed border-[#E2E8F0] bg-white p-6 text-center text-sm text-slate-500">No order history yet.</div>}
            </div>
          ) : null}

          {activeTab === "products" ? (
            <div className="space-y-3">
              {[
                ["Viewed", viewedProducts],
                ["Purchased", purchasedProducts],
                ["Wishlist", wishlistProducts],
              ].map(([label, list]) => (
                <div key={label} className="rounded-3xl border border-[#E2E8F0] bg-white p-4 shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
                  <div className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">{label}</div>
                  <div className="mt-3 space-y-2">
                    {list.length ? list.slice(0, 3).map((product, index) => (
                      <div key={product.id || product.product_id || index} className="flex items-center gap-3 rounded-2xl border border-[#E2E8F0] bg-[#F8FAFC] p-2.5">
                        <div className="h-14 w-14 shrink-0 overflow-hidden rounded-2xl border border-[#E2E8F0] bg-white">
                          {product.image_url ? <img src={product.image_url} alt="" className="h-full w-full object-cover" loading="lazy" /> : null}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-black text-slate-900">{clean(product.name || product.title || product.product_name || "Product")}</div>
                          <div className="mt-1 text-xs text-slate-500">{clean(product.price || product.final_price || product.sale_price || "") ? `${clean(product.price || product.final_price || product.sale_price)} EGP` : "Price unavailable"}</div>
                          <div className="mt-1 text-xs text-slate-500">{clean(product.stock || product.stock_status || "—")}</div>
                        </div>
                        <button type="button" onClick={() => openSystemPath(productPath(product))} className="inline-flex items-center gap-1 rounded-xl border border-[#E2E8F0] bg-white px-3 py-1.5 text-[11px] font-black text-slate-700">
                          Open Product <ExternalLink className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )) : <div className="rounded-2xl border border-dashed border-[#E2E8F0] bg-white p-4 text-sm text-slate-500">No products in this section.</div>}
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {activeTab === "insights" && crmIntelligence ? (
            <div className="space-y-3">
              <div className="rounded-3xl border border-[#E2E8F0] bg-white p-4 shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
                <div className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">AI Insights</div>
                <div className="mt-3 grid gap-2">
                  <div className="rounded-2xl border border-[#E2E8F0] bg-[#F8FAFC] p-3">
                    <div className="flex items-end justify-between gap-3">
                      <div>
                        <div className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">Customer Health</div>
                        <span className={`mt-2 inline-flex rounded-full border px-2.5 py-1 text-xs font-black ${crmIntelligence.health.color}`}>{crmIntelligence.health.badge}</span>
                      </div>
                      <div className="text-right">
                        <div className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">Customer Score</div>
                        <div className="mt-1 text-lg font-black text-slate-900">{crmIntelligence.score.score} / 100</div>
                        <div className="text-[11px] font-black text-slate-500">Grade {crmIntelligence.score.grade}</div>
                      </div>
                    </div>
                  </div>
                  <div className="rounded-2xl border border-[#E2E8F0] bg-[#F8FAFC] p-3">
                    <div className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">Purchase Probability</div>
                    <div className="mt-1 text-lg font-black text-slate-900">{crmIntelligence.purchase.probability}%</div>
                    <div className="text-[11px] text-slate-500">{crmIntelligence.purchase.confidence} confidence</div>
                    <ul className="mt-2 space-y-1 text-xs text-slate-700">
                      {crmIntelligence.purchase.reasons.map((reason) => <li key={reason}>✓ {reason}</li>)}
                    </ul>
                  </div>
                  <div className="rounded-2xl border border-[#E2E8F0] bg-[#F8FAFC] p-3">
                    <div className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">Recommended Action</div>
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <div className="text-sm font-black text-slate-900">{crmIntelligence.nextAction.title}</div>
                      <span className="rounded-full border border-[#E2E8F0] bg-white px-2 py-1 text-[10px] font-black uppercase text-slate-600">{crmIntelligence.nextAction.priority}</span>
                    </div>
                    <div className="mt-1 text-xs text-slate-500">{crmIntelligence.nextAction.reason}</div>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </div>

        <div className="sticky bottom-0 border-t border-[#E2E8F0] bg-white/95 px-4 py-3 backdrop-blur">
          <div className="grid grid-cols-4 gap-1.5 sm:flex sm:gap-2 sm:overflow-x-auto">
            <button type="button" onClick={() => returnToConversation("chat")} className="inline-flex h-12 min-w-0 flex-col items-center justify-center gap-0.5 rounded-xl bg-slate-900 px-1 text-[10px] font-black text-white sm:h-11 sm:flex-row sm:gap-2 sm:px-4 sm:text-sm">
              <MessageCircle className="h-4 w-4" />
              Open Chat
            </button>
            <button type="button" onClick={() => returnToConversation("reply")} className="inline-flex h-12 min-w-0 flex-col items-center justify-center gap-0.5 rounded-xl border border-[#E2E8F0] bg-white px-1 text-[10px] font-black text-slate-700 shadow-sm sm:h-11 sm:flex-row sm:gap-2 sm:px-4 sm:text-sm">
              <MessageSquareText className="h-4 w-4" />
              Reply
            </button>
            <button type="button" onClick={() => returnToConversation("private_reply")} className="inline-flex h-12 min-w-0 flex-col items-center justify-center gap-0.5 rounded-xl border border-[#E2E8F0] bg-white px-1 text-center text-[10px] font-black leading-3 text-slate-700 shadow-sm sm:h-11 sm:flex-row sm:gap-2 sm:px-4 sm:text-sm">
              <Bot className="h-4 w-4" />
              Private Reply
            </button>
            <button type="button" onClick={() => openSystemPath(`/marketing/ai-center/leads${resolvedCustomerId ? `?customer_id=${encodeURIComponent(resolvedCustomerId)}` : ""}`)} className="inline-flex h-12 min-w-0 flex-col items-center justify-center gap-0.5 rounded-xl border border-[#E2E8F0] bg-white px-1 text-center text-[10px] font-black leading-3 text-slate-700 shadow-sm sm:h-11 sm:flex-row sm:gap-2 sm:px-4 sm:text-sm">
              <Users2 className="h-4 w-4" />
              Create Lead
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}
