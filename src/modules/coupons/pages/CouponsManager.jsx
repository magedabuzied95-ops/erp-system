import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, Download, FileText, Mail, MessageCircle, Plus, Printer, Search, Sparkles, Tag, TicketPercent, X, Loader2 } from "lucide-react";
import toast from "react-hot-toast";

import i18n from "../../../i18n/i18n";
import { api } from "../../../shared/api/api";
import { API_BASE_URL } from "../../../shared/constants/app";
import { getToken } from "../../../shared/auth/authStorage";
import { formatCurrency } from "../../../shared/lib/currency";
import { getBrands, getProductsAdminList } from "../../products/services/productsApi";

const emptyForm = {
  name: "",
  code_prefix: "MON",
  discount_type: "percentage",
  discount_value: 10,
  minimum_order_amount: 0,
  max_discount_amount: "",
  usage_limit_per_coupon: 1,
  total_coupons: 100,
  starts_at: "",
  expires_at: "",
  channel: "offline",
  is_active: true,
  applies_to_shipping: false,
  usage_limit_per_customer: "",
  stack_policy: "all",
  budget_cap: "",
  first_order_only: false,
  scope: { product_ids: [], category_ids: [], brand_ids: [], exclude_on_sale: false },
  code_mode: "unique",
  shared_code: "",
  auto_issue_on_first_order: false,
};

const normalizeScopeForForm = (scope) => {
  let raw = scope;
  if (typeof raw === "string") { try { raw = JSON.parse(raw); } catch { raw = {}; } }
  if (!raw || typeof raw !== "object") raw = {};
  return {
    product_ids: Array.isArray(raw.product_ids) ? raw.product_ids.map(Number).filter(Boolean) : [],
    category_ids: Array.isArray(raw.category_ids) ? raw.category_ids.map(Number).filter(Boolean) : [],
    brand_ids: Array.isArray(raw.brand_ids) ? raw.brand_ids.map(Number).filter(Boolean) : [],
    exclude_on_sale: Boolean(raw.exclude_on_sale),
  };
};

const number = (value) => Number(value || 0).toLocaleString("en-US");
const toCouponCode = (value) => String(value || "").trim().toUpperCase();

const fetchProtectedBlob = async (endpoint) => {
  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload?.message || i18n.t("marketing.coupons.export.exportFailed"));
  }
  return response.blob();
};

const downloadBlob = (blob, filename) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

const downloadProtected = async (endpoint, filename) => downloadBlob(await fetchProtectedBlob(endpoint), filename);

const printProtected = async (endpoint) => {
  const blob = await fetchProtectedBlob(endpoint);
  const url = URL.createObjectURL(blob);
  const frame = document.createElement("iframe");
  frame.style.position = "fixed";
  frame.style.right = "0";
  frame.style.bottom = "0";
  frame.style.width = "1px";
  frame.style.height = "1px";
  frame.style.opacity = "0";
  frame.src = url;
  frame.onload = () => window.setTimeout(() => frame.contentWindow?.print(), 350);
  document.body.appendChild(frame);
  window.setTimeout(() => {
    frame.remove();
    URL.revokeObjectURL(url);
  }, 60_000);
};

export default function CouponsManager() {
  const { t } = useTranslation();
  const cText = (key, fallback, options = {}) => t(`marketing.coupons.${key}`, { defaultValue: fallback, ...options });
  const [campaigns, setCampaigns] = useState([]);
  const [coupons, setCoupons] = useState([]);
  const [stats, setStats] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [couponsLoading, setCouponsLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [generateQty, setGenerateQty] = useState("");
  const [printMenuOpen, setPrintMenuOpen] = useState(false);
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  const [emailAddress, setEmailAddress] = useState("");
  const [exportBusy, setExportBusy] = useState("");
  const [logCouponId, setLogCouponId] = useState(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignResult, setAssignResult] = useState(null);
  const [redemptions, setRedemptions] = useState([]);
  const [redemptionsLoading, setRedemptionsLoading] = useState(false);

  const selectedCampaign = useMemo(
    () => campaigns.find((campaign) => String(campaign.id) === String(selectedId)) || campaigns[0] || null,
    [campaigns, selectedId]
  );

  const loadCampaigns = async () => {
    setLoading(true);
    try {
      const response = await api.get("/coupons/campaigns");
      const rows = response.campaigns || [];
      setCampaigns(rows);
      setSelectedId((current) => current || rows[0]?.id || null);
    } catch (error) {
      toast.error(error.message || cText("loadFailed", "تعذر تحميل حملات الكوبونات"));
    } finally {
      setLoading(false);
    }
  };

  const loadCoupons = async () => {
    if (!selectedCampaign?.id) {
      setCoupons([]);
      setStats(null);
      return;
    }
    setCouponsLoading(true);
    try {
      const query = new URLSearchParams();
      if (search) query.set("search", search);
      if (status !== "all") query.set("status", status);
      const [couponResponse, statsResponse] = await Promise.all([
        api.get(`/coupons/campaigns/${selectedCampaign.id}/coupons?${query.toString()}`),
        api.get(`/coupons/campaigns/${selectedCampaign.id}/stats`),
      ]);
      setCoupons(couponResponse.coupons || []);
      setStats(statsResponse.stats || null);
    } catch (error) {
      toast.error(error.message || cText("loadFailed", "تعذر تحميل حملات الكوبونات"));
    } finally {
      setCouponsLoading(false);
    }
  };

  useEffect(() => {
    loadCampaigns();
  }, []);

  useEffect(() => {
    loadCoupons();
  }, [selectedCampaign?.id, search, status]);

  useEffect(() => {
    setLogCouponId(null);
  }, [selectedCampaign?.id]);

  useEffect(() => {
    let active = true;
    if (!selectedCampaign?.id) { setRedemptions([]); return undefined; }
    setRedemptionsLoading(true);
    const query = new URLSearchParams();
    if (logCouponId) query.set("coupon_id", String(logCouponId));
    api.get(`/coupons/campaigns/${selectedCampaign.id}/redemptions?${query.toString()}`)
      .then((response) => { if (active) setRedemptions(response.redemptions || []); })
      .catch(() => { if (active) setRedemptions([]); })
      .finally(() => { if (active) setRedemptionsLoading(false); });
    return () => { active = false; };
  }, [selectedCampaign?.id, logCouponId, stats?.total_redemptions]);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setModalOpen(true);
  };

  const openEdit = (campaign) => {
    setEditing(campaign);
    setForm({
      ...emptyForm,
      ...campaign,
      starts_at: campaign.starts_at ? String(campaign.starts_at).slice(0, 16) : "",
      expires_at: campaign.expires_at ? String(campaign.expires_at).slice(0, 16) : "",
      max_discount_amount: campaign.max_discount_amount ?? "",
      usage_limit_per_customer: campaign.usage_limit_per_customer ?? "",
      budget_cap: campaign.budget_cap ?? "",
      stack_policy: campaign.stack_policy || "all",
      first_order_only: Boolean(campaign.first_order_only),
      scope: normalizeScopeForForm(campaign.scope),
      code_mode: campaign.code_mode === "shared" ? "shared" : "unique",
      shared_code: campaign.shared_code || "",
      auto_issue_on_first_order: Boolean(campaign.auto_issue_on_first_order),
    });
    setModalOpen(true);
  };

  const saveCampaign = async () => {
    try {
      const payload = {
        ...form,
        discount_value: Number(form.discount_value || 0),
        minimum_order_amount: Number(form.minimum_order_amount || 0),
        max_discount_amount: form.max_discount_amount === "" ? null : Number(form.max_discount_amount || 0),
        usage_limit_per_coupon: form.code_mode === "shared" ? Number(form.usage_limit_per_coupon || 0) : Number(form.usage_limit_per_coupon || 1),
        total_coupons: form.code_mode === "shared" ? 1 : Number(form.total_coupons || 0),
        usage_limit_per_customer: form.usage_limit_per_customer === "" ? null : Number(form.usage_limit_per_customer || 0),
        budget_cap: form.budget_cap === "" ? null : Number(form.budget_cap || 0),
        scope: normalizeScopeForForm(form.scope),
      };
      if (editing?.id) {
        await api.put(`/coupons/campaigns/${editing.id}`, payload);
        toast.success(cText("saved", "تم حفظ الحملة"));
      } else {
        const response = await api.post("/coupons/campaigns", payload);
        setSelectedId(response.campaign?.id || null);
        toast.success(cText("saved", "تم حفظ الحملة"));
      }
      setModalOpen(false);
      await loadCampaigns();
    } catch (error) {
      toast.error(error.message || cText("saveFailed", "تعذر حفظ الحملة"));
    }
  };

  const deleteCampaign = async (campaign) => {
    if (!window.confirm(cText("deleteConfirm", `هل تريد حذف الحملة "${campaign.name}" وأكوادها؟`, { name: campaign.name }))) return;
    try {
      await api.delete(`/coupons/campaigns/${campaign.id}`);
      toast.success(cText("deleted", "تم حذف الحملة"));
      setSelectedId(null);
      await loadCampaigns();
    } catch (error) {
      toast.error(error.message || cText("deleteFailed", "تعذر حذف الحملة"));
    }
  };

  const generate = async () => {
    if (!selectedCampaign?.id) return;
    try {
      const response = await api.post(`/coupons/campaigns/${selectedCampaign.id}/generate`, {
        quantity: generateQty ? Number(generateQty) : undefined,
      });
      toast.success(cText("generated", "تم إنشاء {{count}} كوبون", { count: number(response.generated) }));
      setGenerateQty("");
      await Promise.all([loadCampaigns(), loadCoupons()]);
    } catch (error) {
      toast.error(error.message || cText("generateFailed", "تعذر إنشاء الكوبونات"));
    }
  };

  const exportCsv = async () => {
    if (!selectedCampaign?.id) return;
    await downloadProtected(`/coupons/export/csv?campaign_id=${selectedCampaign.id}`, `coupons-${selectedCampaign.id}.csv`);
  };

  const pdfEndpoint = (layout = "a4", couponId = null) => {
    const params = new URLSearchParams({ campaign_id: String(selectedCampaign?.id || ""), layout });
    if (couponId) params.set("coupon_id", String(couponId));
    return `/coupons/export/pdf?${params.toString()}`;
  };

  const runPdfAction = async (key, action) => {
    if (!selectedCampaign?.id || exportBusy) return;
    setExportBusy(key);
    try {
      await action();
    } catch (error) {
      toast.error(error.message || cText("export.prepareFailed", "Unable to prepare the coupon file"));
    } finally {
      setExportBusy("");
      setPrintMenuOpen(false);
    }
  };

  const exportPdf = (layout = "a4") => runPdfAction(`download-${layout}`, () =>
    downloadProtected(pdfEndpoint(layout), `coupons-${selectedCampaign.id}-${layout}.pdf`)
  );

  const printPdf = (layout = "a4", couponId = null) => runPdfAction(`print-${layout}-${couponId || "all"}`, () =>
    printProtected(pdfEndpoint(layout, couponId))
  );

  const sharePdf = () => runPdfAction("whatsapp", async () => {
    const blob = await fetchProtectedBlob(pdfEndpoint("a4"));
    const file = new File([blob], `coupons-${selectedCampaign.id}.pdf`, { type: "application/pdf" });
    if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
      await navigator.share({ title: selectedCampaign.name, text: cText("export.shareTitle", "Discount coupons"), files: [file] });
      return;
    }
    downloadBlob(blob, file.name);
    window.open(`https://wa.me/?text=${encodeURIComponent(cText("export.shareText", "The discount coupon file has been downloaded and can be attached to the chat."))}`, "_blank", "noopener,noreferrer");
  });

  const sendPdfByEmail = async () => {
    if (!emailAddress.trim() || exportBusy) return;
    setExportBusy("email");
    try {
      await api.post("/coupons/export/pdf/email", {
        campaign_id: selectedCampaign.id,
        layout: "a4",
        email: emailAddress.trim(),
      });
      toast.success(cText("export.emailSent", "The coupon file was emailed"));
      setEmailDialogOpen(false);
      setEmailAddress("");
    } catch (error) {
      toast.error(error.message || cText("export.emailFailed", "Unable to email the coupon file"));
    } finally {
      setExportBusy("");
    }
  };

  const statCards = [
    [cText("headers.totalGenerated", "إجمالي الكوبونات المولدة"), stats?.total_coupons],
    [cText("headers.used", "مستخدمة"), stats?.used_coupons],
    [cText("headers.unused", "غير مستخدمة"), stats?.unused_coupons],
    [cText("headers.expired", "منتهية"), stats?.expired_coupons],
    [cText("headers.totalDiscount", "إجمالي الخصم"), formatCurrency(stats?.total_discount_amount || 0)],
    [cText("headers.salesGenerated", "المبيعات المحققة"), formatCurrency(stats?.total_sales_amount || 0)],
    [cText("headers.netSales", "صافي بعد الخصم"), formatCurrency(stats?.net_sales_amount || 0)],
    [
      stats?.conversion_basis === "assigned" ? cText("headers.conversionAssigned", "التحويل (من المُرسَل)") : cText("headers.conversionRate", "معدل التحويل"),
      `${Number(stats?.conversion_rate || 0).toFixed(2)}%`,
    ],
    [
      cText("headers.avgOrder", "متوسط الطلب مع / بدون"),
      `${formatCurrency(stats?.average_order_total || 0)} / ${formatCurrency(stats?.average_order_without_coupon || 0)}`,
    ],
  ];

  const sendCouponToCustomer = async (customer, message) => {
    if (!selectedCampaign?.id || !customer?.id) return null;
    const response = await api.post(`/coupons/campaigns/${selectedCampaign.id}/send`, {
      customer_id: customer.id,
      message: message || "",
    });
    setAssignResult((current) => ({ ...(current || {}), ...response }));
    loadCoupons();
    return response;
  };

  const [rowSendingId, setRowSendingId] = useState(null);
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);
  const [bulkSending, setBulkSending] = useState(false);

  const sendPendingCoupons = async () => {
    if (!selectedCampaign?.id || bulkSending) return;
    setBulkSending(true);
    try {
      const response = await api.post(`/coupons/campaigns/${selectedCampaign.id}/send-pending`, {});
      const sent = Number(response?.sent || 0);
      const failed = Number(response?.failed || 0);
      if (sent) toast.success(cText("bulk.done", "اتبعت {{count}} كوبون", { count: sent }));
      if (failed) toast.error(cText("bulk.someFailed", "فشل إرسال {{count}}", { count: failed }));
      if (!sent && !failed) toast(cText("bulk.nothing", "مفيش كوبونات بانتظار الإرسال"));
      setBulkConfirmOpen(false);
      loadCoupons();
    } catch (error) {
      toast.error(error?.responseBody?.message || error.message || cText("bulk.failed", "تعذر الإرسال الجماعي"));
    } finally {
      setBulkSending(false);
    }
  };
  const sendCouponRow = async (coupon) => {
    if (!selectedCampaign?.id || !coupon?.assigned_customer_id || rowSendingId) return;
    setRowSendingId(coupon.id);
    try {
      await api.post(`/coupons/campaigns/${selectedCampaign.id}/send`, { customer_id: coupon.assigned_customer_id });
      toast.success(cText("assign.sent", "تم إرسال الكوبون"));
      loadCoupons();
    } catch (error) {
      toast.error(error?.responseBody?.message || error.message || cText("assign.sendFailed", "تعذر الإرسال"));
    } finally {
      setRowSendingId(null);
    }
  };

  const assignCoupon = async (customer) => {
    if (!selectedCampaign?.id || !customer?.id) return;
    try {
      const response = await api.post(`/coupons/campaigns/${selectedCampaign.id}/assign`, { customer_id: customer.id });
      setAssignResult(response);
      toast.success(cText("assign.done", "تم تخصيص الكوبون"));
      loadCoupons();
    } catch (error) {
      toast.error(error?.responseBody?.message || error.message || cText("assign.failed", "تعذر تخصيص الكوبون"));
    }
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(139,92,246,0.14),transparent_32%),linear-gradient(180deg,#050816,#09090b)] p-4 text-white md:p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-violet-300/20 bg-violet-400/10 px-3 py-1 text-xs font-black uppercase tracking-[0.2em] text-violet-100">
            <TicketPercent className="h-4 w-4" />
            {cText("eyebrow", "الكوبونات")}
          </div>
          <h1 className="m1-display mt-3">{cText("title", "حملات الكوبونات")}</h1>
          <p className="mt-2 max-w-2xl text-sm text-zinc-400">{cText("subtitle", "أنشئ أكواد الكوبونات وولّدها وتابعها وصدّرها من داخل النظام.")}</p>
        </div>
        <button type="button" onClick={openCreate} className="inline-flex h-[var(--control-height-lg)] items-center justify-center gap-2 rounded-[var(--radius-control)] bg-violet-400 px-4 text-sm font-black text-black shadow-lg shadow-violet-950/30">
          <Plus className="h-4 w-4" />
          {cText("new", "حملة جديدة")}
        </button>
      </div>

      <section className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-7">
        {statCards.map(([label, value]) => (
          <div key={label} className="rounded-[var(--radius-card)] border border-white/10 bg-white/[0.045] p-4 shadow-2xl shadow-black/10 backdrop-blur-xl">
            <div className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">{label}</div>
            <div className="mt-2 truncate text-2xl font-black text-white">{loading || couponsLoading ? "..." : value ?? 0}</div>
          </div>
        ))}
      </section>

      <div className="mt-5 grid gap-4 xl:grid-cols-[330px_minmax(0,1fr)]">
        <aside className="rounded-3xl border border-white/10 bg-zinc-950/70 p-3 shadow-2xl shadow-black/20 backdrop-blur-xl">
          <div className="mb-3 flex items-center justify-between px-1">
            <h2 className="m1-section-title text-white">{cText("campaignLabel", "الحملات")}</h2>
            {loading ? <Loader2 className="h-4 w-4 animate-spin text-violet-200" /> : null}
          </div>
          <div className="space-y-2">
            {campaigns.map((campaign) => (
              <button
                key={campaign.id}
                type="button"
                onClick={() => setSelectedId(campaign.id)}
                className={`w-full rounded-[var(--radius-control)] border p-3 text-left transition ${String(selectedCampaign?.id) === String(campaign.id) ? "border-violet-300/40 bg-violet-400/15" : "border-white/10 bg-white/[0.035] hover:bg-white/[0.06]"}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-black text-white">{campaign.name}</div>
                    <div className="mt-1 text-xs text-zinc-500">{campaign.code_prefix} / {campaign.channel}</div>
                  </div>
                  <span className={`rounded-full px-2 py-1 text-[10px] font-black ${campaign.is_active ? "bg-emerald-400/10 text-emerald-200" : "bg-zinc-500/10 text-zinc-400"}`}>
                    {campaign.is_active ? cText("active", "نشط") : cText("inactive", "متوقف")}
                  </span>
                </div>
                <div className="mt-3 flex gap-2 text-xs">
                  <span className="rounded-full bg-white/5 px-2 py-1">{number(campaign.generated_count)} {cText("generatedSuffix", "مولدة")}</span>
                  <span className="rounded-full bg-white/5 px-2 py-1">{number(campaign.used_count)} {cText("usedSuffix", "مستخدمة")}</span>
                </div>
              </button>
            ))}
            {!loading && !campaigns.length ? <EmptyState label={cText("empty", "لا توجد حملات كوبونات بعد.")} /> : null}
          </div>
        </aside>

        <main className="min-w-0 rounded-3xl border border-white/10 bg-zinc-950/65 p-4 shadow-2xl shadow-black/20 backdrop-blur-xl">
          {selectedCampaign ? (
            <>
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <h2 className="m1-section-title text-white">{selectedCampaign.name}</h2>
                  <p className="mt-1 text-sm text-zinc-400">
                    {selectedCampaign.discount_type === "percentage" ? `${Number(selectedCampaign.discount_value)}%` : formatCurrency(selectedCampaign.discount_value)} / {selectedCampaign.channel}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {selectedCampaign.code_mode === "shared" ? (
                    <span className="inline-flex h-[var(--control-height-md)] items-center rounded-[var(--radius-control)] border border-violet-300/25 bg-violet-400/15 px-3 font-mono text-sm font-black tracking-widest text-violet-100">{selectedCampaign.shared_code}</span>
                  ) : (
                    <>
                      <input value={generateQty} onChange={(e) => setGenerateQty(e.target.value)} type="number" min="1" placeholder={cText("targetQty", "الكمية")} className="h-[var(--control-height-md)] w-24 rounded-[var(--radius-control)] border border-white/10 bg-black/30 px-3 text-sm text-white outline-none" />
                      <button type="button" onClick={generate} className="inline-flex h-[var(--control-height-md)] items-center gap-2 rounded-[var(--radius-control)] border border-emerald-300/25 bg-emerald-400/15 px-3 text-sm font-black text-emerald-100">
                        <Sparkles className="h-4 w-4" />
                        {cText("actions.generate", "إنشاء")}
                      </button>
                    </>
                  )}
                  <button type="button" onClick={() => { setAssignResult(null); setAssignOpen(true); }} className="inline-flex h-[var(--control-height-md)] items-center gap-2 rounded-[var(--radius-control)] border border-sky-300/25 bg-sky-400/15 px-3 text-sm font-black text-sky-100">
                    <MessageCircle className="h-4 w-4" />
                    {cText("assign.button", "تخصيص لعميل")}
                  </button>
                  <button type="button" onClick={() => openEdit(selectedCampaign)} className="h-[var(--control-height-md)] rounded-[var(--radius-control)] border border-white/10 bg-white/[0.04] px-3 text-sm font-bold text-white">{cText("actions.edit", "تعديل")}</button>
                  <button type="button" onClick={() => deleteCampaign(selectedCampaign)} className="h-[var(--control-height-md)] rounded-[var(--radius-control)] border border-rose-300/20 bg-rose-500/10 px-3 text-sm font-bold text-rose-100">{cText("actions.delete", "حذف")}</button>
                  <div className="relative">
                    <button type="button" onClick={() => setPrintMenuOpen((current) => !current)} className="inline-flex h-[var(--control-height-md)] items-center gap-2 rounded-[var(--radius-control)] border border-amber-300/25 bg-amber-400/10 px-3 text-sm font-bold text-amber-100">
                      {exportBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
                      {cText("export.menu", "Print and share")}
                      <ChevronDown className="h-4 w-4" />
                    </button>
                    {printMenuOpen ? (
                      <div className="absolute right-0 top-12 z-30 w-64 overflow-hidden rounded-2xl border border-white/10 bg-zinc-950 p-2 shadow-2xl shadow-black/60">
                        <ExportMenuButton icon={Printer} label={cText("export.printA4", "Print A4 — 6 coupons")} onClick={() => printPdf("a4")} />
                        <ExportMenuButton icon={Printer} label={cText("export.printA5", "Print A5 — 2 coupons")} onClick={() => printPdf("a5")} />
                        <ExportMenuButton icon={Tag} label={cText("export.printSingle", "Print one coupon")} onClick={() => coupons[0] && printPdf("single", coupons[0].id)} disabled={!coupons.length} />
                        <div className="my-1 border-t border-white/10" />
                        <ExportMenuButton icon={FileText} label={cText("export.exportPdf", "Export PDF")} onClick={() => exportPdf("a4")} />
                        <ExportMenuButton icon={Mail} label={cText("export.emailPdf", "Email the PDF")} onClick={() => { setPrintMenuOpen(false); setEmailDialogOpen(true); }} />
                        <ExportMenuButton icon={MessageCircle} label={cText("export.shareWhatsapp", "Share on WhatsApp")} onClick={sharePdf} />
                      </div>
                    ) : null}
                  </div>
                  <button type="button" onClick={exportCsv} className="inline-flex h-[var(--control-height-md)] items-center gap-2 rounded-[var(--radius-control)] border border-white/10 bg-white/[0.04] px-3 text-sm font-bold text-white"><Download className="h-4 w-4" />{cText("actions.exportCsv", "CSV")}</button>
                </div>
              </div>

              <div className="mt-4 flex flex-col gap-3 md:flex-row">
                <label className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
                  <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={cText("searchPlaceholder", "ابحث عن الكود")} className="h-[var(--control-height-lg)] w-full rounded-[var(--radius-control)] border border-white/10 bg-black/30 pl-10 pr-3 text-sm text-white outline-none" />
                </label>
                <select value={status} onChange={(e) => setStatus(e.target.value)} className="h-[var(--control-height-lg)] rounded-[var(--radius-control)] border border-white/10 bg-black/30 px-3 text-sm text-white outline-none">
                  <option value="all">{cText("filters.allStatuses", "كل الحالات")}</option>
                  <option value="active">{cText("active", "نشط")}</option>
                  <option value="unused">{cText("headers.unused", "غير مستخدم")}</option>
                  <option value="used">{cText("headers.used", "مستخدم")}</option>
                  <option value="pending_send">{cText("filters.pendingSend", "بانتظار الإرسال")}</option>
                  <option value="expired">{cText("headers.expired", "منتهي")}</option>
                </select>
              </div>

              {Number(stats?.pending_send_coupons || 0) > 0 && status !== "pending_send" ? (
                  <button
                    type="button"
                    onClick={() => setStatus("pending_send")}
                    className="mb-3 flex w-full items-center justify-between gap-3 rounded-[var(--radius-card)] border border-amber-300/30 bg-amber-400/10 px-4 py-3 text-start"
                  >
                    <span className="text-sm font-black text-amber-100">
                      {cText("pendingSend.banner", "{{count}} كوبون متخصّص لعملاء ولسه ما اتبعتش", { count: Number(stats.pending_send_coupons) })}
                    </span>
                    <span className="shrink-0 text-xs font-black text-amber-200/80">{cText("pendingSend.review", "استعراض")}</span>
                  </button>
                ) : null}
                {Number(stats?.pending_send_coupons || 0) > 0 ? (
                  <button
                    type="button"
                    onClick={() => setBulkConfirmOpen(true)}
                    className="mb-3 inline-flex h-[var(--control-height-md)] items-center gap-2 rounded-[var(--radius-control)] border border-emerald-300/25 bg-emerald-400/15 px-3 text-sm font-black text-emerald-100"
                  >
                    <MessageCircle className="h-4 w-4" />
                    {cText("bulk.sendAll", "ابعت الكل ({{count}})", { count: Number(stats.pending_send_coupons) })}
                  </button>
                ) : null}
              <div className="mt-4 overflow-hidden rounded-2xl border border-white/10">
                <div className="grid grid-cols-[1.1fr_0.8fr_0.7fr_0.7fr_0.8fr_44px] gap-3 bg-white/[0.04] px-4 py-3 text-xs font-black uppercase tracking-[0.16em] text-zinc-500">
                  <div>{cText("headers.code", "الكود")}</div>
                  <div>{cText("headers.discount", "الخصم")}</div>
                  <div>{cText("headers.usage", "الاستخدام")}</div>
                  <div>{cText("headers.status", "الحالة")}</div>
                  <div>{cText("headers.expires", "ينتهي")}</div>
                  <div />
                </div>
                {couponsLoading ? (
                  Array.from({ length: 5 }).map((_, index) => <div key={index} className="h-14 animate-pulse border-t border-white/5 bg-white/[0.025]" />)
                ) : coupons.length ? (
                  coupons.map((coupon) => (
                    <div key={coupon.id} className={`grid grid-cols-[1.1fr_0.8fr_0.7fr_0.7fr_0.8fr_44px] items-center gap-3 border-t border-white/5 px-4 py-3 text-sm ${String(logCouponId) === String(coupon.id) ? "bg-violet-400/10" : ""}`}>
                      <div className="min-w-0">
                        <button type="button" onClick={() => setLogCouponId((current) => (String(current) === String(coupon.id) ? null : coupon.id))} title={cText("log.showForCoupon", "عرض سجل استخدام هذا الكوبون")} className="block truncate text-start font-black text-white hover:text-violet-200">{coupon.code}</button>
                        {coupon.assigned_customer_id ? (
                          <span className="block truncate text-[11px] font-semibold text-zinc-500">{coupon.assigned_customer_name || `#${coupon.assigned_customer_id}`}</span>
                        ) : null}
                      </div>
                      <div className="text-zinc-300">{coupon.discount_type === "percentage" ? `${Number(coupon.discount_value)}%` : coupon.discount_type === "free_shipping" ? cText("types.freeShipping", "شحن مجاني") : formatCurrency(coupon.discount_value)}</div>
                      <div className="text-zinc-300">{number(coupon.usage_count)} / {number(coupon.usage_limit)}</div>
                      <div>
                        {Number(coupon.usage_count || 0) >= Number(coupon.usage_limit || 1) ? (
                          // A spent coupon is spent: is_active stays TRUE after the last use, so reading
                          // it here used to label an exhausted code "مفعلة".
                          <span className="rounded-full bg-violet-400/10 px-2 py-1 text-[11px] font-black text-violet-200">{cText("headers.used", "مستخدم")}</span>
                        ) : coupon.expires_at && new Date(coupon.expires_at).getTime() < Date.now() ? (
                          <span className="rounded-full bg-zinc-500/10 px-2 py-1 text-[11px] font-black text-zinc-400">{cText("headers.expired", "منتهي")}</span>
                        ) : coupon.assigned_customer_id && !coupon.sent_at && !coupon.usage_count ? (
                          <button
                            type="button"
                            onClick={() => sendCouponRow(coupon)}
                            disabled={rowSendingId === coupon.id}
                            className="inline-flex h-[var(--control-height-md)] items-center gap-1.5 rounded-[var(--radius-control)] border border-amber-300/30 bg-amber-400/15 px-2.5 text-[11px] font-black text-amber-100 disabled:opacity-50"
                          >
                            {rowSendingId === coupon.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MessageCircle className="h-3.5 w-3.5" />}
                            {cText("assign.send", "ابعت")}
                          </button>
                        ) : coupon.sent_at && !coupon.usage_count ? (
                          <span className="rounded-full bg-sky-400/10 px-2 py-1 text-[11px] font-black text-sky-200">{cText("pendingSend.sent", "اتبعت")}</span>
                        ) : (
                          <span className={`rounded-full px-2 py-1 text-[11px] font-black ${coupon.is_active ? "bg-emerald-400/10 text-emerald-200" : "bg-zinc-500/10 text-zinc-400"}`}>{coupon.is_active ? cText("active", "نشط") : cText("inactive", "متوقف")}</span>
                        )}
                      </div>
                      <div className="text-zinc-400">{coupon.expires_at ? new Date(coupon.expires_at).toLocaleDateString() : "-"}</div>
                      <button type="button" title={cText("export.printThis", "Print this coupon")} onClick={() => printPdf("single", coupon.id)} className="inline-flex h-[var(--control-height-md)] w-9 items-center justify-center rounded-[var(--radius-control)] border border-amber-300/20 bg-amber-400/10 text-amber-100 hover:bg-amber-400/20">
                        {exportBusy === `print-single-${coupon.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
                      </button>
                    </div>
                  ))
                ) : (
                  <EmptyState label={cText("emptyFiltered", "لا توجد كوبونات تطابق هذا المرشح.")} />
                )}
              </div>

              <div className="mt-5 rounded-[var(--radius-card)] border border-white/10 bg-white/[0.03]">
                <div className="flex items-center justify-between gap-3 px-4 py-3">
                  <div>
                    <div className="text-xs font-black uppercase tracking-[0.2em] text-violet-300">{cText("log.title", "سجل الاستخدام")}</div>
                    <div className="mt-0.5 text-[11px] text-zinc-500">
                      {logCouponId
                        ? cText("log.filteredByCoupon", "مرشّح على كوبون واحد — اضغط الكود مرة أخرى لعرض الحملة كلها")
                        : cText("log.allCampaign", "كل عمليات الاستخدام في هذه الحملة، بما فيها الملغاة")}
                    </div>
                  </div>
                  {logCouponId ? (
                    <button type="button" onClick={() => setLogCouponId(null)} className="rounded-[var(--radius-control)] border border-white/10 bg-white/[0.04] px-3 py-1 text-xs font-black text-zinc-200">{cText("log.clearFilter", "إلغاء الترشيح")}</button>
                  ) : null}
                </div>
                <div className="grid grid-cols-[1fr_1fr_1fr_0.8fr_0.8fr_0.9fr] gap-3 border-t border-white/10 bg-white/[0.02] px-4 py-2 text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">
                  <div>{cText("log.headers.coupon", "الكود")}</div>
                  <div>{cText("log.headers.customer", "العميل")}</div>
                  <div>{cText("log.headers.order", "الطلب")}</div>
                  <div>{cText("log.headers.source", "القناة")}</div>
                  <div>{cText("log.headers.discount", "الخصم")}</div>
                  <div>{cText("log.headers.when", "التاريخ")}</div>
                </div>
                {redemptionsLoading ? (
                  <div className="h-12 animate-pulse bg-white/[0.025]" />
                ) : redemptions.length ? (
                  redemptions.map((row) => (
                    <div key={row.id} className={`grid grid-cols-[1fr_1fr_1fr_0.8fr_0.8fr_0.9fr] items-center gap-3 border-t border-white/5 px-4 py-2.5 text-xs ${row.reversed_at ? "text-zinc-500 line-through decoration-rose-400/50" : "text-zinc-200"}`}>
                      <div className="font-black">{row.coupon_code}</div>
                      <div>{row.customer_name || "-"}{row.customer_phone ? <span className="block text-[10px] text-zinc-500 no-underline">{row.customer_phone}</span> : null}</div>
                      <div>{row.invoice_number || row.public_order_number || (row.order_id ? `#${row.order_id}` : "-")}{row.reversed_at ? <span className="ms-2 rounded-full bg-rose-500/15 px-2 py-0.5 text-[10px] font-black text-rose-200 no-underline">{cText(`log.reversal.${row.reversal_reason || "reversed"}`, cText("log.reversed", "مُلغى"))}</span> : null}</div>
                      <div>{cText(`sources.${row.source}`, row.source)}</div>
                      <div>{formatCurrency(row.discount_amount)}<span className="block text-[10px] text-zinc-500">{cText("log.of", "من")} {formatCurrency(row.order_total)}</span></div>
                      <div className="text-zinc-400">{row.used_at ? new Date(row.used_at).toLocaleString() : "-"}</div>
                    </div>
                  ))
                ) : (
                  <div className="px-4 py-6 text-center text-xs font-semibold text-zinc-500">{cText("log.empty", "لم يُستخدم أي كوبون بعد.")}</div>
                )}
              </div>
            </>
          ) : (
            <EmptyState label={cText("emptySelection", "اختر حملة كوبونات أو أنشئ واحدة جديدة.")} />
          )}
        </main>
      </div>

      {modalOpen ? (
        <CampaignModal
          form={form}
          setForm={setForm}
          editing={editing}
          onClose={() => setModalOpen(false)}
          onSave={saveCampaign}
        />
      ) : null}
      {bulkConfirmOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onMouseDown={() => (bulkSending ? null : setBulkConfirmOpen(false))}>
          <div className="w-full max-w-md rounded-3xl border border-white/10 bg-zinc-950 p-5 text-white shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
            <div className="text-xs font-black uppercase tracking-[0.2em] text-emerald-300">{cText("bulk.title", "إرسال جماعي")}</div>
            <h2 className="m1-section-title mt-1">{selectedCampaign?.name}</h2>
            <p className="mt-3 text-sm font-semibold text-zinc-300">
              {cText("bulk.confirm", "هيتبعت {{count}} كوبون على واتساب للعملاء المخصّص لهم. الرسائل بتتبعت واحدة ورا التانية.", { count: Number(stats?.pending_send_coupons || 0) })}
            </p>
            <p className="mt-2 text-xs font-semibold text-amber-200/80">{cText("bulk.capNote", "الحد الأقصى 50 رسالة في المرة، والباقي بضغطة تانية.")}</p>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" disabled={bulkSending} onClick={() => setBulkConfirmOpen(false)} className="h-[var(--control-height-lg)] rounded-[var(--radius-control)] border border-white/10 bg-white/[0.04] px-4 text-sm font-black disabled:opacity-50">
                {cText("actions.cancel", "إلغاء")}
              </button>
              <button type="button" disabled={bulkSending} onClick={sendPendingCoupons} className="inline-flex h-[var(--control-height-lg)] items-center gap-2 rounded-[var(--radius-control)] bg-emerald-400 px-5 text-sm font-black text-black disabled:opacity-50">
                {bulkSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageCircle className="h-4 w-4" />}
                {bulkSending ? cText("bulk.sending", "بيتبعت...") : cText("bulk.go", "ابعت")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {assignOpen ? (
        <AssignCouponDialog
          campaign={selectedCampaign}
          result={assignResult}
          onAssign={assignCoupon}
          onSend={sendCouponToCustomer}
          onClose={() => { setAssignOpen(false); setAssignResult(null); }}
          cText={cText}
        />
      ) : null}
      {emailDialogOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4" onMouseDown={() => setEmailDialogOpen(false)}>
          <div className="w-full max-w-md rounded-3xl border border-amber-300/20 bg-zinc-950 p-5 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs font-black uppercase tracking-[0.18em] text-amber-300">{cText("export.dialog.eyebrow", "PDF by email")}</div>
                <h2 className="m1-section-title mt-1 text-white">{cText("export.dialog.title", "Send discount coupons")}</h2>
                <p className="mt-1 text-sm text-zinc-400">{cText("export.dialog.subtitle", "A print-ready A4 file will be sent as an attachment.")}</p>
              </div>
              <button type="button" onClick={() => setEmailDialogOpen(false)} className="rounded-[var(--radius-control)] border border-white/10 p-2 text-zinc-300"><X className="h-4 w-4" /></button>
            </div>
            <label className="mt-5 block">
              <span className="mb-2 block text-xs font-bold text-zinc-400">{cText("export.dialog.email", "Email address")}</span>
              <input autoFocus type="email" value={emailAddress} onChange={(event) => setEmailAddress(event.target.value)} onKeyDown={(event) => event.key === "Enter" && sendPdfByEmail()} placeholder="name@example.com" className="h-[var(--control-height-lg)] w-full rounded-[var(--radius-control)] border border-white/10 bg-white/[0.05] px-4 text-left text-white outline-none focus:border-amber-300/40" dir="ltr" />
            </label>
            <button type="button" disabled={!emailAddress.trim() || exportBusy === "email"} onClick={sendPdfByEmail} className="mt-4 inline-flex h-[var(--control-height-lg)] w-full items-center justify-center gap-2 rounded-[var(--radius-control)] bg-amber-400 font-black text-black disabled:cursor-not-allowed disabled:opacity-50">
              {exportBusy === "email" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
              {cText("export.dialog.send", "Send PDF")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ExportMenuButton({ icon: Icon, label, onClick, disabled = false }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} className="flex w-full items-center gap-3 rounded-[var(--radius-control)] px-3 py-2.5 text-right text-sm font-bold text-zinc-200 transition hover:bg-white/[0.07] disabled:cursor-not-allowed disabled:opacity-40">
      <Icon className="h-4 w-4 text-amber-300" />
      <span>{label}</span>
    </button>
  );
}

function CampaignModal({ form, setForm, editing, onClose, onSave }) {
  const { t } = useTranslation();
  const cText = (key, fallback, options = {}) => t(`marketing.coupons.${key}`, { defaultValue: fallback, ...options });
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-3xl rounded-3xl border border-white/10 bg-zinc-950 p-5 text-white shadow-2xl shadow-black/50">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.2em] text-violet-300">{editing ? cText("modal.edit", "تعديل الحملة") : cText("modal.create", "حملة جديدة")}</div>
            <h2 className="m1-section-title mt-1">{editing ? editing.name : cText("modal.title", "حملة كوبونات")}</h2>
          </div>
          <button type="button" onClick={onClose} className="rounded-[var(--radius-control)] border border-white/10 bg-white/[0.04] p-2 text-zinc-300"><X className="h-4 w-4" /></button>
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-2">
          <Field label={cText("fields.name", "الاسم")} value={form.name} onChange={(value) => update("name", value)} />
          <Select label={cText("fields.codeMode", "نوع الأكواد")} value={form.code_mode} onChange={(value) => update("code_mode", value)} options={[["unique", cText("codeModes.unique", "أكواد فريدة (كوبون لكل عميل)")], ["shared", cText("codeModes.shared", "كود مشترك واحد (للإعلانات والسوشيال)")]]} />
          {form.code_mode === "shared" ? (
            <Field label={cText("fields.sharedCode", "الكود المشترك")} value={form.shared_code} onChange={(value) => update("shared_code", String(value).toUpperCase().replace(/\s+/g, "-").replace(/[^A-Z0-9-]+/g, ""))} placeholder="SUMMER20" />
          ) : (
            <Field label={cText("fields.codePrefix", "بادئة الكود")} value={form.code_prefix} onChange={(value) => update("code_prefix", toCouponCode(value))} />
          )}
          <Select label={cText("fields.discountType", "نوع الخصم")} value={form.discount_type} onChange={(value) => update("discount_type", value)} options={[["percentage", cText("types.percentage", "نسبة")], ["fixed", cText("types.fixed", "قيمة ثابتة")], ["free_shipping", cText("types.freeShipping", "شحن مجاني")]]} />
          {form.discount_type === "free_shipping" ? (
            <div className="flex items-end text-xs text-zinc-400">{cText("fields.freeShippingHint", "الخصم = قيمة الشحن / رسوم الخدمة بالكامل (أقصى خصم يحدّه لو اتحدد)")}</div>
          ) : (
            <Field label={cText("fields.discountValue", "قيمة الخصم")} type="number" value={form.discount_value} onChange={(value) => update("discount_value", value)} />
          )}
          <Field label={cText("fields.minimumOrder", "الحد الأدنى للطلب")} type="number" value={form.minimum_order_amount} onChange={(value) => update("minimum_order_amount", value)} />
          <Field label={cText("fields.maxDiscount", "أقصى خصم")} type="number" value={form.max_discount_amount} onChange={(value) => update("max_discount_amount", value)} placeholder={cText("optional", "اختياري")} />
          <Field label={form.code_mode === "shared" ? cText("fields.sharedUsageLimit", "إجمالي الاستخدامات (0 = بلا حد)") : cText("fields.usagePerCoupon", "حد الاستخدام لكل كوبون")} type="number" value={form.usage_limit_per_coupon} onChange={(value) => update("usage_limit_per_coupon", value)} />
          {form.code_mode === "shared" ? null : (
            <Field label={cText("fields.targetCoupons", "عدد الكوبونات المستهدفة")} type="number" value={form.total_coupons} onChange={(value) => update("total_coupons", value)} />
          )}
          <Field label={cText("fields.startsAt", "يبدأ في")} type="datetime-local" value={form.starts_at} onChange={(value) => update("starts_at", value)} />
          <Field label={cText("fields.expiresAt", "ينتهي في")} type="datetime-local" value={form.expires_at} onChange={(value) => update("expires_at", value)} />
          <Select label={cText("fields.channel", "القناة")} value={form.channel} onChange={(value) => update("channel", value)} options={[["offline", cText("channels.offline", "غير متصل")], ["website", cText("channels.website", "الموقع")], ["pos", cText("channels.pos", "نقاط البيع")], ["all", cText("channels.all", "الكل")]]} />
          <label className="flex items-center gap-3 rounded-[var(--radius-card)] border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-semibold">
            <input type="checkbox" checked={Boolean(form.is_active)} onChange={(e) => update("is_active", e.target.checked)} />
            {cText("fields.activeCampaign", "الحملة نشطة")}
          </label>
          <label className="flex items-center gap-3 rounded-[var(--radius-card)] border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-semibold">
            <input type="checkbox" checked={Boolean(form.applies_to_shipping)} onChange={(e) => update("applies_to_shipping", e.target.checked)} />
            <span>
              {cText("fields.appliesToShipping", "الخصم يشمل الشحن / رسوم الخدمة")}
              <span className="block text-[11px] font-normal text-white/50">{cText("fields.appliesToShippingHint", "افتراضياً الخصم يُحسب على المنتجات فقط")}</span>
            </span>
          </label>
        </div>

        <div className="mt-5 border-t border-white/10 pt-4">
          <div className="text-xs font-black uppercase tracking-[0.2em] text-violet-300">{cText("rules.title", "قواعد الاستخدام")}</div>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <Field label={cText("rules.perCustomer", "حد الاستخدام لكل عميل (عبر الحملة)")} type="number" value={form.usage_limit_per_customer} onChange={(value) => update("usage_limit_per_customer", value)} placeholder={cText("rules.unlimited", "بلا حد")} />
            <Field label={cText("rules.budgetCap", "ميزانية الحملة (سقف إجمالي الخصم)")} type="number" value={form.budget_cap} onChange={(value) => update("budget_cap", value)} placeholder={cText("rules.unlimited", "بلا حد")} />
            <Select label={cText("rules.stackPolicy", "التراكب مع خصومات أخرى")} value={form.stack_policy} onChange={(value) => update("stack_policy", value)} options={[["all", cText("rules.stack.all", "يتراكب مع الكل")], ["none", cText("rules.stack.none", "لا يتراكب مع أي خصم")], ["with_loyalty", cText("rules.stack.withLoyalty", "مع نقاط الولاء فقط")], ["with_invoice_discount", cText("rules.stack.withInvoice", "مع خصم الفاتورة فقط")]]} />
            <label className="flex items-center gap-3 rounded-[var(--radius-card)] border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-semibold">
              <input type="checkbox" checked={Boolean(form.first_order_only)} onChange={(e) => update("first_order_only", e.target.checked)} />
              {cText("rules.firstOrderOnly", "أول طلب للعميل فقط")}
            </label>
            <label className="flex items-center gap-3 rounded-[var(--radius-card)] border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-semibold">
              <input type="checkbox" checked={Boolean(form.auto_issue_on_first_order)} onChange={(e) => update("auto_issue_on_first_order", e.target.checked)} />
              <span>
                {cText("rules.autoIssue", "إصدار تلقائي بعد أول طلب")}
                <span className="block text-[11px] font-normal text-white/50">{cText("rules.autoIssueHint", "يُخصَّص الكوبون للعميل تلقائياً — الإرسال يدوي من زر تخصيص لعميل")}</span>
              </span>
            </label>
          </div>
          <ScopeEditor scope={form.scope} onChange={(scope) => update("scope", scope)} cText={cText} />
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-[var(--control-height-lg)] rounded-[var(--radius-control)] border border-white/10 bg-white/[0.04] px-4 text-sm font-black">{cText("actions.cancel", "إلغاء")}</button>
          <button type="button" onClick={onSave} className="h-[var(--control-height-lg)] rounded-[var(--radius-control)] bg-violet-400 px-5 text-sm font-black text-black">{cText("actions.save", "حفظ")}</button>
        </div>
      </div>
    </div>
  );
}

function AssignCouponDialog({ campaign, result, onAssign, onSend, onClose, cText }) {
  const [term, setTerm] = useState("");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendFailed, setSendFailed] = useState(false);
  const sent = Boolean(result?.sent);
  useEffect(() => {
    // Follow the server's message only until the manager starts editing it.
    if (result?.message) setDraft((current) => (current ? current : result.message));
  }, [result?.message]);
  const send = async () => {
    if (!result?.customer || sending) return;
    setSending(true);
    setSendFailed(false);
    try {
      await onSend?.(result.customer, draft);
      toast.success(cText("assign.sent", "تم إرسال الكوبون"));
    } catch (error) {
      setSendFailed(true);
      toast.error(error?.responseBody?.message || error.message || cText("assign.sendFailed", "تعذر الإرسال"));
    } finally {
      setSending(false);
    }
  };
  useEffect(() => {
    const q = term.trim();
    if (q.length < 2) { setRows([]); return undefined; }
    let active = true;
    const timer = setTimeout(async () => {
      try {
        setLoading(true);
        const data = await api.get("/customers", { params: { limit: 12, page: 1, search: q } });
        const payload = data?.data ?? data;
        const list = Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.customers) ? payload.customers : [];
        if (active) setRows(list);
      } catch { if (active) setRows([]); }
      finally { if (active) setLoading(false); }
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [term]);
  const pick = async (customer) => {
    setBusy(true);
    try { await onAssign(customer); } finally { setBusy(false); }
  };
  const copy = async (text) => {
    try { await navigator.clipboard.writeText(text); toast.success(cText("assign.copied", "تم النسخ")); } catch { toast.error(cText("assign.copyFailed", "تعذر النسخ")); }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onMouseDown={onClose}>
      <div className="w-full max-w-lg rounded-3xl border border-white/10 bg-zinc-950 p-5 text-white shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.2em] text-sky-300">{cText("assign.title", "تخصيص كوبون لعميل")}</div>
            <h2 className="m1-section-title mt-1">{campaign?.name}</h2>
          </div>
          <button type="button" onClick={onClose} className="rounded-[var(--radius-control)] border border-white/10 bg-white/[0.04] p-2 text-zinc-300"><X className="h-4 w-4" /></button>
        </div>
        {result ? (
          <div className="mt-4 space-y-3">
            <div className="rounded-[var(--radius-card)] border border-emerald-300/20 bg-emerald-400/10 p-4">
              <div className="text-[10px] font-black uppercase tracking-[0.18em] text-emerald-200/80">{result.customer?.name} · {result.customer?.phone || "-"}</div>
              <div className="mt-2 font-mono text-2xl font-black tracking-widest text-white">{result.coupon?.code}</div>
            </div>
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              readOnly={sent}
              rows={5}
              className="w-full rounded-[var(--radius-card)] border border-white/10 bg-white/[0.04] p-3 text-sm text-zinc-200 outline-none"
            />
            {sent ? (
              <div className="rounded-[var(--radius-card)] border border-emerald-300/25 bg-emerald-400/10 px-4 py-2 text-xs font-black text-emerald-100">
                {cText("assign.sentToInbox", "اتبعت وظهر في صندوق الذكاء")}
              </div>
            ) : null}
            <div className="flex flex-wrap items-center justify-end gap-2">
              <button type="button" onClick={() => copy(result.coupon?.code || "")} className="h-[var(--control-height-md)] rounded-[var(--radius-control)] border border-white/10 bg-white/[0.04] px-3 text-sm font-bold">{cText("assign.copyCode", "نسخ الكود")}</button>
              <button type="button" onClick={() => copy(draft)} className="h-[var(--control-height-md)] rounded-[var(--radius-control)] border border-white/10 bg-white/[0.04] px-3 text-sm font-bold">{cText("assign.copyMessage", "نسخ الرسالة")}</button>
              {sendFailed && result.whatsapp_url ? (
                <a href={result.whatsapp_url} target="_blank" rel="noreferrer" className="inline-flex h-[var(--control-height-md)] items-center gap-2 rounded-[var(--radius-control)] border border-white/10 bg-white/[0.04] px-3 text-sm font-bold text-zinc-200">
                  <MessageCircle className="h-4 w-4" />
                  {cText("assign.openWhatsApp", "فتح في واتساب")}
                </a>
              ) : null}
              {sent ? null : (
                <button
                  type="button"
                  onClick={send}
                  disabled={sending || !draft.trim()}
                  className="inline-flex h-[var(--control-height-md)] items-center gap-2 rounded-[var(--radius-control)] border border-emerald-300/25 bg-emerald-400/20 px-4 text-sm font-black text-emerald-50 disabled:opacity-50"
                >
                  {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageCircle className="h-4 w-4" />}
                  {sending ? cText("assign.sending", "جارٍ الإرسال...") : cText("assign.send", "ابعت")}
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="mt-4">
            <input autoFocus value={term} onChange={(e) => setTerm(e.target.value)} placeholder={cText("assign.searchCustomer", "ابحث بالاسم أو رقم الهاتف")} className="h-[var(--control-height-lg)] w-full rounded-[var(--radius-control)] border border-white/10 bg-white/[0.04] px-3 text-sm text-white outline-none placeholder:text-zinc-600" />
            <div className="mt-2 max-h-72 overflow-auto rounded-[var(--radius-card)] border border-white/10">
              {loading ? <div className="p-4 text-center text-xs text-zinc-500">...</div> : rows.length ? rows.map((customer) => (
                <button key={customer.id} type="button" disabled={busy} onClick={() => pick(customer)} className="flex w-full items-center justify-between gap-3 border-b border-white/5 px-4 py-3 text-start text-sm hover:bg-white/[0.05] disabled:opacity-50">
                  <span className="font-bold text-white">{customer.name || customer.customer_name || `#${customer.id}`}</span>
                  <span className="text-xs text-zinc-400" dir="ltr">{customer.phone || customer.customer_phone || ""}</span>
                </button>
              )) : <div className="p-4 text-center text-xs text-zinc-500">{term.trim().length < 2 ? cText("assign.typeToSearch", "اكتب حرفين على الأقل") : cText("assign.noResults", "لا نتائج")}</div>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ScopeEditor({ scope, onChange, cText }) {
  const safeScope = scope && typeof scope === "object" ? scope : { product_ids: [], category_ids: [], brand_ids: [], exclude_on_sale: false };
  const [brands, setBrands] = useState([]);
  const [productQuery, setProductQuery] = useState("");
  const [productResults, setProductResults] = useState([]);
  const [productLabels, setProductLabels] = useState({});
  const [searching, setSearching] = useState(false);
  const set = (key, value) => onChange({ ...safeScope, [key]: value });

  useEffect(() => {
    let active = true;
    getBrands().then((rows) => { if (active) setBrands(Array.isArray(rows) ? rows : []); }).catch(() => {});
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const q = productQuery.trim();
    if (q.length < 2) { setProductResults([]); return undefined; }
    let active = true;
    const timer = setTimeout(async () => {
      try {
        setSearching(true);
        const { products } = await getProductsAdminList({ params: { search: q, limit: 8 } });
        if (!active) return;
        setProductResults(Array.isArray(products) ? products : []);
      } catch { if (active) setProductResults([]); }
      finally { if (active) setSearching(false); }
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [productQuery]);

  const toggleBrand = (id) => {
    const ids = new Set(safeScope.brand_ids || []);
    if (ids.has(id)) ids.delete(id); else ids.add(id);
    set("brand_ids", [...ids]);
  };
  const addProduct = (product) => {
    const id = Number(product.id);
    if (!id || (safeScope.product_ids || []).includes(id)) return;
    setProductLabels((prev) => ({ ...prev, [id]: product.name || product.title || `#${id}` }));
    set("product_ids", [...(safeScope.product_ids || []), id]);
    setProductQuery("");
    setProductResults([]);
  };
  const removeProduct = (id) => set("product_ids", (safeScope.product_ids || []).filter((value) => value !== id));

  return (
    <div className="mt-3 rounded-[var(--radius-card)] border border-white/10 bg-white/[0.03] p-4">
      <div className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">{cText("rules.scope.title", "نطاق المنتجات")}</div>
      <div className="mt-1 text-[11px] text-zinc-500">{cText("rules.scope.hint", "اتركه فارغاً ليشمل كل المنتجات. لو اخترت براندات أو منتجات، الخصم يُحسب على البنود المطابقة فقط.")}</div>

      {brands.length ? (
        <div className="mt-3">
          <div className="mb-1 text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">{cText("rules.scope.brands", "البراندات")}</div>
          <div className="flex flex-wrap gap-2">
            {brands.map((brand) => {
              const id = Number(brand.id);
              const selected = (safeScope.brand_ids || []).includes(id);
              return (
                <button key={id} type="button" onClick={() => toggleBrand(id)} className={`rounded-full border px-3 py-1 text-xs font-bold ${selected ? "border-violet-300/50 bg-violet-400/20 text-violet-100" : "border-white/10 bg-white/[0.04] text-zinc-300"}`}>
                  {brand.name}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="mt-3">
        <div className="mb-1 text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">{cText("rules.scope.products", "منتجات محددة")}</div>
        <div className="relative">
          <input value={productQuery} onChange={(e) => setProductQuery(e.target.value)} placeholder={cText("rules.scope.searchProducts", "ابحث باسم المنتج أو الكود")} className="h-[var(--control-height-lg)] w-full rounded-[var(--radius-control)] border border-white/10 bg-white/[0.04] px-3 text-sm text-white outline-none placeholder:text-zinc-600" />
          {productResults.length ? (
            <div className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-[var(--radius-card)] border border-white/10 bg-zinc-900 shadow-xl">
              {productResults.map((product) => (
                <button key={product.id} type="button" onClick={() => addProduct(product)} className="block w-full px-3 py-2 text-start text-sm text-zinc-200 hover:bg-white/[0.06]">
                  {product.name || product.title} <span className="text-xs text-zinc-500">#{product.id}</span>
                </button>
              ))}
            </div>
          ) : searching ? <div className="mt-1 text-[11px] text-zinc-500">...</div> : null}
        </div>
        {(safeScope.product_ids || []).length ? (
          <div className="mt-2 flex flex-wrap gap-2">
            {safeScope.product_ids.map((id) => (
              <span key={id} className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-3 py-1 text-xs font-bold text-zinc-200">
                {productLabels[id] || `#${id}`}
                <button type="button" onClick={() => removeProduct(id)} className="text-rose-300"><X className="h-3 w-3" /></button>
              </span>
            ))}
          </div>
        ) : null}
      </div>

      <label className="mt-3 flex items-center gap-3 text-sm font-semibold">
        <input type="checkbox" checked={Boolean(safeScope.exclude_on_sale)} onChange={(e) => set("exclude_on_sale", e.target.checked)} />
        {cText("rules.scope.excludeOnSale", "استثناء المنتجات المخفّضة (سعرها أقل من سعر البيع الأساسي)")}
      </label>
    </div>
  );
}

function Field({ label, value, onChange, type = "text", placeholder = "" }) {
  return (
    <label className="block">
      <div className="mb-1 text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">{label}</div>
      <input type={type} value={value ?? ""} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="h-[var(--control-height-lg)] w-full rounded-[var(--radius-control)] border border-white/10 bg-white/[0.04] px-3 text-sm text-white outline-none placeholder:text-zinc-600" />
    </label>
  );
}

function Select({ label, value, onChange, options }) {
  return (
    <label className="block">
      <div className="mb-1 text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">{label}</div>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="h-[var(--control-height-lg)] w-full rounded-[var(--radius-control)] border border-white/10 bg-white/[0.04] px-3 text-sm text-white outline-none">
        {options.map(([key, labelText]) => <option key={key} value={key}>{labelText}</option>)}
      </select>
    </label>
  );
}

function EmptyState({ label }) {
  return <div className="rounded-[var(--radius-card)] border border-dashed border-white/10 bg-white/[0.035] p-8 text-center text-sm font-semibold text-zinc-400">{label}</div>;
}
