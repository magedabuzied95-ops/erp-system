import { useEffect, useMemo, useState } from "react";
import { Download, FileText, Loader2, Plus, Search, Sparkles, TicketPercent, X } from "lucide-react";
import toast from "react-hot-toast";

import { api } from "../../../shared/api/api";
import { API_BASE_URL } from "../../../shared/constants/app";
import { getToken } from "../../../shared/auth/authStorage";
import { formatCurrency } from "../../../shared/lib/currency";

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
};

const number = (value) => Number(value || 0).toLocaleString("en-US");

const downloadProtected = async (endpoint, filename) => {
  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload?.message || "Export failed");
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

export default function CouponsManager() {
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
      toast.error(error.message || "Failed to load campaigns");
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
      toast.error(error.message || "Failed to load coupons");
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
        usage_limit_per_coupon: Number(form.usage_limit_per_coupon || 1),
        total_coupons: Number(form.total_coupons || 0),
      };
      if (editing?.id) {
        await api.put(`/coupons/campaigns/${editing.id}`, payload);
        toast.success("Campaign updated");
      } else {
        const response = await api.post("/coupons/campaigns", payload);
        setSelectedId(response.campaign?.id || null);
        toast.success("Campaign created");
      }
      setModalOpen(false);
      await loadCampaigns();
    } catch (error) {
      toast.error(error.message || "Failed to save campaign");
    }
  };

  const deleteCampaign = async (campaign) => {
    if (!window.confirm(`Delete campaign "${campaign.name}" and its coupons?`)) return;
    try {
      await api.delete(`/coupons/campaigns/${campaign.id}`);
      toast.success("Campaign deleted");
      setSelectedId(null);
      await loadCampaigns();
    } catch (error) {
      toast.error(error.message || "Failed to delete campaign");
    }
  };

  const generate = async () => {
    if (!selectedCampaign?.id) return;
    try {
      const response = await api.post(`/coupons/campaigns/${selectedCampaign.id}/generate`, {
        quantity: generateQty ? Number(generateQty) : undefined,
      });
      toast.success(`${number(response.generated)} coupons generated`);
      setGenerateQty("");
      await Promise.all([loadCampaigns(), loadCoupons()]);
    } catch (error) {
      toast.error(error.message || "Failed to generate coupons");
    }
  };

  const exportCsv = async () => {
    if (!selectedCampaign?.id) return;
    await downloadProtected(`/coupons/export/csv?campaign_id=${selectedCampaign.id}`, `coupons-${selectedCampaign.id}.csv`);
  };

  const exportPdf = async () => {
    if (!selectedCampaign?.id) return;
    await downloadProtected(`/coupons/export/pdf?campaign_id=${selectedCampaign.id}`, `coupons-${selectedCampaign.id}.pdf`);
  };

  const statCards = [
    ["Total generated", stats?.total_coupons],
    ["Used", stats?.used_coupons],
    ["Unused", stats?.unused_coupons],
    ["Expired", stats?.expired_coupons],
    ["Total discount", formatCurrency(stats?.total_discount_amount || 0)],
    ["Sales generated", formatCurrency(stats?.total_sales_amount || 0)],
    ["Conversion rate", `${Number(stats?.conversion_rate || 0).toFixed(2)}%`],
  ];

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(139,92,246,0.14),transparent_32%),linear-gradient(180deg,#050816,#09090b)] p-4 text-white md:p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-violet-300/20 bg-violet-400/10 px-3 py-1 text-xs font-black uppercase tracking-[0.2em] text-violet-100">
            <TicketPercent className="h-4 w-4" />
            Marketing / Coupons
          </div>
          <h1 className="mt-3 text-3xl font-black tracking-tight md:text-4xl">Offline Coupon Campaigns</h1>
          <p className="mt-2 max-w-2xl text-sm text-zinc-400">Generate street-distributed coupons, track redemption, and export printable sheets without mock analytics.</p>
        </div>
        <button type="button" onClick={openCreate} className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-violet-400 px-4 text-sm font-black text-black shadow-lg shadow-violet-950/30">
          <Plus className="h-4 w-4" />
          New campaign
        </button>
      </div>

      <section className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-7">
        {statCards.map(([label, value]) => (
          <div key={label} className="rounded-2xl border border-white/10 bg-white/[0.045] p-4 shadow-2xl shadow-black/10 backdrop-blur-xl">
            <div className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">{label}</div>
            <div className="mt-2 truncate text-2xl font-black text-white">{loading || couponsLoading ? "..." : value ?? 0}</div>
          </div>
        ))}
      </section>

      <div className="mt-5 grid gap-4 xl:grid-cols-[330px_minmax(0,1fr)]">
        <aside className="rounded-3xl border border-white/10 bg-zinc-950/70 p-3 shadow-2xl shadow-black/20 backdrop-blur-xl">
          <div className="mb-3 flex items-center justify-between px-1">
            <h2 className="text-sm font-black text-white">Campaigns</h2>
            {loading ? <Loader2 className="h-4 w-4 animate-spin text-violet-200" /> : null}
          </div>
          <div className="space-y-2">
            {campaigns.map((campaign) => (
              <button
                key={campaign.id}
                type="button"
                onClick={() => setSelectedId(campaign.id)}
                className={`w-full rounded-2xl border p-3 text-left transition ${String(selectedCampaign?.id) === String(campaign.id) ? "border-violet-300/40 bg-violet-400/15" : "border-white/10 bg-white/[0.035] hover:bg-white/[0.06]"}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-black text-white">{campaign.name}</div>
                    <div className="mt-1 text-xs text-zinc-500">{campaign.code_prefix} / {campaign.channel}</div>
                  </div>
                  <span className={`rounded-full px-2 py-1 text-[10px] font-black ${campaign.is_active ? "bg-emerald-400/10 text-emerald-200" : "bg-zinc-500/10 text-zinc-400"}`}>
                    {campaign.is_active ? "Active" : "Off"}
                  </span>
                </div>
                <div className="mt-3 flex gap-2 text-xs">
                  <span className="rounded-full bg-white/5 px-2 py-1">{number(campaign.generated_count)} generated</span>
                  <span className="rounded-full bg-white/5 px-2 py-1">{number(campaign.used_count)} used</span>
                </div>
              </button>
            ))}
            {!loading && !campaigns.length ? <EmptyState label="No coupon campaigns yet." /> : null}
          </div>
        </aside>

        <main className="min-w-0 rounded-3xl border border-white/10 bg-zinc-950/65 p-4 shadow-2xl shadow-black/20 backdrop-blur-xl">
          {selectedCampaign ? (
            <>
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <h2 className="text-xl font-black text-white">{selectedCampaign.name}</h2>
                  <p className="mt-1 text-sm text-zinc-400">
                    {selectedCampaign.discount_type === "percentage" ? `${Number(selectedCampaign.discount_value)}%` : formatCurrency(selectedCampaign.discount_value)} / {selectedCampaign.channel}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <input value={generateQty} onChange={(e) => setGenerateQty(e.target.value)} type="number" min="1" placeholder="Qty" className="h-10 w-24 rounded-2xl border border-white/10 bg-black/30 px-3 text-sm text-white outline-none" />
                  <button type="button" onClick={generate} className="inline-flex h-10 items-center gap-2 rounded-2xl border border-emerald-300/25 bg-emerald-400/15 px-3 text-sm font-black text-emerald-100">
                    <Sparkles className="h-4 w-4" />
                    Generate
                  </button>
                  <button type="button" onClick={() => openEdit(selectedCampaign)} className="h-10 rounded-2xl border border-white/10 bg-white/[0.04] px-3 text-sm font-bold text-white">Edit</button>
                  <button type="button" onClick={() => deleteCampaign(selectedCampaign)} className="h-10 rounded-2xl border border-rose-300/20 bg-rose-500/10 px-3 text-sm font-bold text-rose-100">Delete</button>
                  <button type="button" onClick={exportPdf} className="inline-flex h-10 items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-3 text-sm font-bold text-white"><FileText className="h-4 w-4" />PDF</button>
                  <button type="button" onClick={exportCsv} className="inline-flex h-10 items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-3 text-sm font-bold text-white"><Download className="h-4 w-4" />CSV</button>
                </div>
              </div>

              <div className="mt-4 flex flex-col gap-3 md:flex-row">
                <label className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
                  <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search coupon code" className="h-11 w-full rounded-2xl border border-white/10 bg-black/30 pl-10 pr-3 text-sm text-white outline-none" />
                </label>
                <select value={status} onChange={(e) => setStatus(e.target.value)} className="h-11 rounded-2xl border border-white/10 bg-black/30 px-3 text-sm text-white outline-none">
                  <option value="all">All statuses</option>
                  <option value="active">Active</option>
                  <option value="unused">Unused</option>
                  <option value="used">Used</option>
                  <option value="expired">Expired</option>
                </select>
              </div>

              <div className="mt-4 overflow-hidden rounded-2xl border border-white/10">
                <div className="grid grid-cols-[1.1fr_0.8fr_0.7fr_0.7fr_0.8fr] gap-3 bg-white/[0.04] px-4 py-3 text-xs font-black uppercase tracking-[0.16em] text-zinc-500">
                  <div>Code</div>
                  <div>Discount</div>
                  <div>Usage</div>
                  <div>Status</div>
                  <div>Expires</div>
                </div>
                {couponsLoading ? (
                  Array.from({ length: 5 }).map((_, index) => <div key={index} className="h-14 animate-pulse border-t border-white/5 bg-white/[0.025]" />)
                ) : coupons.length ? (
                  coupons.map((coupon) => (
                    <div key={coupon.id} className="grid grid-cols-[1.1fr_0.8fr_0.7fr_0.7fr_0.8fr] gap-3 border-t border-white/5 px-4 py-3 text-sm">
                      <div className="font-black text-white">{coupon.code}</div>
                      <div className="text-zinc-300">{coupon.discount_type === "percentage" ? `${Number(coupon.discount_value)}%` : formatCurrency(coupon.discount_value)}</div>
                      <div className="text-zinc-300">{number(coupon.usage_count)} / {number(coupon.usage_limit)}</div>
                      <div><span className={`rounded-full px-2 py-1 text-[11px] font-black ${coupon.is_active ? "bg-emerald-400/10 text-emerald-200" : "bg-zinc-500/10 text-zinc-400"}`}>{coupon.is_active ? "Active" : "Off"}</span></div>
                      <div className="text-zinc-400">{coupon.expires_at ? new Date(coupon.expires_at).toLocaleDateString() : "-"}</div>
                    </div>
                  ))
                ) : (
                  <EmptyState label="No coupons match this filter." />
                )}
              </div>
            </>
          ) : (
            <EmptyState label="Select or create a coupon campaign." />
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
    </div>
  );
}

function CampaignModal({ form, setForm, editing, onClose, onSave }) {
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-3xl rounded-3xl border border-white/10 bg-zinc-950 p-5 text-white shadow-2xl shadow-black/50">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.2em] text-violet-300">{editing ? "Edit campaign" : "New campaign"}</div>
            <h2 className="mt-1 text-2xl font-black">{editing ? editing.name : "Coupon campaign"}</h2>
          </div>
          <button type="button" onClick={onClose} className="rounded-2xl border border-white/10 bg-white/[0.04] p-2 text-zinc-300"><X className="h-4 w-4" /></button>
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-2">
          <Field label="Name" value={form.name} onChange={(value) => update("name", value)} />
          <Field label="Code prefix" value={form.code_prefix} onChange={(value) => update("code_prefix", value.toUpperCase())} />
          <Select label="Discount type" value={form.discount_type} onChange={(value) => update("discount_type", value)} options={[["percentage", "Percentage"], ["fixed", "Fixed"]]} />
          <Field label="Discount value" type="number" value={form.discount_value} onChange={(value) => update("discount_value", value)} />
          <Field label="Minimum order" type="number" value={form.minimum_order_amount} onChange={(value) => update("minimum_order_amount", value)} />
          <Field label="Max discount" type="number" value={form.max_discount_amount} onChange={(value) => update("max_discount_amount", value)} placeholder="Optional" />
          <Field label="Usage per coupon" type="number" value={form.usage_limit_per_coupon} onChange={(value) => update("usage_limit_per_coupon", value)} />
          <Field label="Target coupons" type="number" value={form.total_coupons} onChange={(value) => update("total_coupons", value)} />
          <Field label="Starts at" type="datetime-local" value={form.starts_at} onChange={(value) => update("starts_at", value)} />
          <Field label="Expires at" type="datetime-local" value={form.expires_at} onChange={(value) => update("expires_at", value)} />
          <Select label="Channel" value={form.channel} onChange={(value) => update("channel", value)} options={[["offline", "Offline"], ["website", "Website"], ["pos", "POS"], ["all", "All"]]} />
          <label className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-semibold">
            <input type="checkbox" checked={Boolean(form.is_active)} onChange={(e) => update("is_active", e.target.checked)} />
            Active campaign
          </label>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-11 rounded-2xl border border-white/10 bg-white/[0.04] px-4 text-sm font-black">Cancel</button>
          <button type="button" onClick={onSave} className="h-11 rounded-2xl bg-violet-400 px-5 text-sm font-black text-black">Save</button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, type = "text", placeholder = "" }) {
  return (
    <label className="block">
      <div className="mb-1 text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">{label}</div>
      <input type={type} value={value ?? ""} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="h-11 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-3 text-sm text-white outline-none placeholder:text-zinc-600" />
    </label>
  );
}

function Select({ label, value, onChange, options }) {
  return (
    <label className="block">
      <div className="mb-1 text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">{label}</div>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="h-11 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-3 text-sm text-white outline-none">
        {options.map(([key, labelText]) => <option key={key} value={key}>{labelText}</option>)}
      </select>
    </label>
  );
}

function EmptyState({ label }) {
  return <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.035] p-8 text-center text-sm font-semibold text-zinc-400">{label}</div>;
}
