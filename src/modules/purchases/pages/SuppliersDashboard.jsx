import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

import {
  AlertTriangle,
  Building2,
  Download,
  Edit3,
  Eye,
  FilePlus2,
  Mail,
  MoreHorizontal,
  Phone,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  Wallet,
  X,
} from "lucide-react";

import toast from "react-hot-toast";
import { api } from "../../../shared/api/api";
import FlowShell from "../components/FlowShell";
import StatusBadge from "../components/StatusBadge";
import { formatCurrency, formatDateTime, getLocalPurchases, normalizeSupplier, seedSuppliers } from "../lib/flowStore";

const PAGE_SIZE = 10;
const emptyForm = {
  name: "",
  phone: "",
  whatsapp: "",
  email: "",
  contact_person: "",
  tax_number: "",
  address: "",
  opening_balance: 0,
  notes: "",
  status: "active",
};

const toArray = (value) => (Array.isArray(value) ? value : []);
const supplierStatusLabel = (status) => (String(status).toLowerCase() === "inactive" ? "Inactive" : "Active");
const backendSupplier = (supplier) => ({
  name: supplier.name,
  phone: supplier.phone,
  whatsapp: supplier.whatsapp,
  email: supplier.email,
  contact_person: supplier.contact_person,
  tax_number: supplier.tax_number,
  address: supplier.address,
  opening_balance: Number(supplier.opening_balance || 0),
  current_balance: Number(supplier.current_balance ?? supplier.opening_balance ?? 0),
  notes: supplier.notes,
  status: supplier.status,
});

function SuppliersDashboard() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [suppliers, setSuppliers] = useState([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sort, setSort] = useState("newest");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [openMenuId, setOpenMenuId] = useState(null);
  const [modalSupplier, setModalSupplier] = useState(undefined);
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState("");
  const [profile, setProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(false);

  const loadSuppliers = async () => {
    try {
      setLoading(true);
      setError("");
      const params = new URLSearchParams({
        limit: "200",
        page: "1",
        search,
        status: statusFilter,
        sort,
      });
      const data = await api.get(`/suppliers?${params.toString()}`);
      const rows = toArray(data?.data).length ? data.data : toArray(data?.suppliers);
      setSuppliers(rows.map((item) => normalizeSupplier({ ...item, status: supplierStatusLabel(item.status) })));
    } catch (err) {
      console.error(err);
      setSuppliers(seedSuppliers());
      setError(t("suppliers.fallbackError"));
      toast.error(t("suppliers.fallbackToast"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(loadSuppliers, 250);
    return () => window.clearTimeout(timer);
  }, [search, statusFilter, sort]);

  useEffect(() => setPage(1), [search, statusFilter, sort]);

  const enriched = useMemo(() => {
    const purchases = getLocalPurchases();
    return suppliers.map((supplier) => {
      const relatedPurchases = purchases.filter((purchase) => String(purchase.supplier_name || "").toLowerCase() === String(supplier.name || "").toLowerCase());
      const localSpent = relatedPurchases.reduce((sum, purchase) => sum + Number(purchase.total || 0), 0);
      const lastLocalPurchase = relatedPurchases[0] || null;
      return {
        ...supplier,
        supplier_code: supplier.supplier_code || `SUP-${String(supplier.id || 0).padStart(4, "0")}`,
        purchaseCount: Number(supplier.purchase_count ?? supplier.purchaseCount ?? relatedPurchases.length),
        totalPurchases: Number(supplier.total_purchases ?? supplier.totalPurchases ?? localSpent),
        lastPurchaseDate: supplier.last_purchase_date || supplier.lastPurchaseDate || lastLocalPurchase?.created_at || null,
        current_balance: Number(supplier.current_balance ?? supplier.balance ?? 0),
      };
    });
  }, [suppliers]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return enriched.filter((supplier) => {
      const matchesQuery = `${supplier.name} ${supplier.phone} ${supplier.whatsapp} ${supplier.email} ${supplier.address} ${supplier.supplier_code}`.toLowerCase().includes(query);
      const matchesStatus = statusFilter === "all" || String(supplier.status).toLowerCase() === statusFilter;
      return matchesQuery && matchesStatus;
    });
  }, [enriched, search, statusFilter]);

  const sorted = useMemo(() => {
    const copy = [...filtered];
    if (sort === "highest_balance") return copy.sort((a, b) => Number(b.current_balance || 0) - Number(a.current_balance || 0));
    if (sort === "name") return copy.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
    return copy.sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
  }, [filtered, sort]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const visible = sorted.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const totals = useMemo(
    () => ({
      suppliers: enriched.length,
      active: enriched.filter((supplier) => String(supplier.status).toLowerCase() === "active").length,
      balance: enriched.reduce((sum, supplier) => sum + Number(supplier.current_balance || supplier.balance || 0), 0),
      spend: enriched.reduce((sum, supplier) => sum + Number(supplier.totalPurchases || 0), 0),
    }),
    [enriched]
  );

  const openCreateModal = () => {
    setModalSupplier(null);
    setForm(emptyForm);
    setFormError("");
  };

  const openEditModal = (supplier) => {
    setModalSupplier(supplier);
    setForm({
      name: supplier.name || "",
      phone: supplier.phone || "",
      whatsapp: supplier.whatsapp || "",
      email: supplier.email || "",
      contact_person: supplier.contact_person || "",
      tax_number: supplier.tax_number || "",
      address: supplier.address || "",
      opening_balance: Number(supplier.opening_balance || 0),
      notes: supplier.notes || "",
      status: String(supplier.status || "active").toLowerCase() === "inactive" ? "inactive" : "active",
    });
    setFormError("");
    setOpenMenuId(null);
  };

  const closeModal = () => {
    if (saving) return;
    setModalSupplier(undefined);
    setFormError("");
  };

  const submitSupplier = async (event) => {
    event.preventDefault();
    const cleanName = String(form.name || "").trim();
    if (!cleanName) {
      setFormError("اسم المورد مطلوب / Supplier name is required");
      return;
    }

    try {
      setSaving(true);
      setFormError("");
      const payload = backendSupplier({ ...form, name: cleanName });
      const response = modalSupplier
        ? await api.put(`/suppliers/${modalSupplier.id}`, payload)
        : await api.post("/suppliers", payload);
      const saved = response?.data || response?.supplier;
      if (saved) {
        setSuppliers((prev) => {
          const normalized = normalizeSupplier({ ...saved, status: supplierStatusLabel(saved.status) });
          if (modalSupplier) return prev.map((item) => (String(item.id) === String(saved.id) ? normalized : item));
          return [normalized, ...prev];
        });
      }
      toast.success(modalSupplier ? "Supplier updated" : "Supplier created");
      setModalSupplier(undefined);
      await loadSuppliers();
    } catch (err) {
      console.error(err);
      const message = err?.responseBody?.message || err?.message || "Supplier could not be saved";
      setFormError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const deleteSupplier = async (supplier) => {
    setOpenMenuId(null);
    const ok = window.confirm(`Delete supplier ${supplier.name}?`);
    if (!ok) return;
    try {
      await api.delete(`/suppliers/${supplier.id}`);
      setSuppliers((prev) => prev.filter((item) => String(item.id) !== String(supplier.id)));
      if (String(profile?.id) === String(supplier.id)) setProfile(null);
      toast.success("Supplier deleted");
    } catch (err) {
      console.error(err);
      toast.error(err?.responseBody?.message || "Supplier could not be deleted");
    }
  };

  const openProfile = async (supplier) => {
    setProfile(supplier);
    setOpenMenuId(null);
    try {
      setProfileLoading(true);
      const response = await api.get(`/suppliers/${supplier.id}`);
      setProfile({ ...supplier, ...(response?.data || response?.supplier || {}) });
    } catch (err) {
      console.error(err);
      toast.error("Supplier profile could not be refreshed");
    } finally {
      setProfileLoading(false);
    }
  };

  return (
    <FlowShell
      title={t("suppliers.title")}
      subtitle={t("suppliers.subtitle")}
      actions={
        <>
          <Link to="/purchases/create" className="inline-flex items-center gap-2 rounded-2xl bg-emerald-500 px-4 py-2 text-sm font-black text-black transition hover:bg-emerald-400">
            <Plus className="h-4 w-4" />
            {t("suppliers.newPurchaseOrder")}
          </Link>
          <button type="button" onClick={openCreateModal} className="inline-flex items-center gap-2 rounded-2xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-2 text-sm font-black text-emerald-200 transition hover:border-emerald-300/60 hover:bg-emerald-400/20">
            <Plus className="h-4 w-4" />
            Add Supplier
          </button>
          <button type="button" className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10">
            <Download className="h-4 w-4" />
            Import Suppliers
          </button>
        </>
      }
      tabs={[
        { to: "/purchases", label: t("suppliers.tabs.purchases"), end: true },
        { to: "/purchases/create", label: t("suppliers.tabs.createPO") },
        { to: "/suppliers", label: t("suppliers.tabs.suppliers"), end: true },
        { to: "/inventory", label: t("suppliers.tabs.inventory") },
        { to: "/warehouses", label: t("suppliers.tabs.warehouses") },
      ]}
    >
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Kpi label={t("suppliers.kpis.suppliers")} value={totals.suppliers} />
        <Kpi label={t("suppliers.kpis.active")} value={totals.active} tone="emerald" />
        <Kpi label="Current Balance" value={formatCurrency(totals.balance)} tone="amber" />
        <Kpi label="Total Purchases" value={formatCurrency(totals.spend)} tone="blue" />
      </div>

      {error ? (
        <div className="rounded-3xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-100">
          <AlertTriangle className="mr-2 inline h-4 w-4" />
          {error}
        </div>
      ) : null}

      <div className="rounded-3xl border border-white/10 bg-zinc-950/90 p-4 shadow-2xl shadow-black/10">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_180px_220px]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="ابحث بالاسم / الهاتف / الكود"
              className="w-full rounded-2xl border border-white/10 bg-white/5 py-3 pl-11 pr-4 text-sm text-white outline-none placeholder:text-zinc-500 focus:border-emerald-400/50"
            />
          </div>
          <Select value={statusFilter} onChange={setStatusFilter} options={[["all", "All status"], ["active", "Active"], ["inactive", "Inactive"]]} />
          <Select value={sort} onChange={setSort} options={[["newest", "Newest"], ["highest_balance", "Highest balance"], ["name", "Name A-Z"]]} />
        </div>

        <div className="mt-4 overflow-x-auto">
          <div className="min-w-[1280px]">
            <div className="grid grid-cols-[12%_18%_12%_12%_12%_10%_10%_8%_6%] rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-xs uppercase tracking-[0.16em] text-zinc-500">
              <div>Code</div>
              <div>Supplier</div>
              <div>Contact</div>
              <div>WhatsApp</div>
              <div>Total Purchases</div>
              <div>Balance</div>
              <div>Status</div>
              <div>Last PO</div>
              <div></div>
            </div>

            <div className="mt-2 space-y-2">
              {loading ? (
                Array.from({ length: 6 }).map((_, index) => <div key={index} className="h-16 animate-pulse rounded-2xl border border-white/10 bg-white/5" />)
              ) : visible.length === 0 ? (
                <EmptyState onCreate={openCreateModal} />
              ) : (
                visible.map((supplier) => (
                  <div
                    key={String(supplier.id)}
                    onClick={() => openProfile(supplier)}
                    className="grid cursor-pointer grid-cols-[12%_18%_12%_12%_12%_10%_10%_8%_6%] items-center rounded-2xl border border-white/10 bg-zinc-950/90 px-4 py-3 transition hover:border-emerald-400/30 hover:bg-emerald-400/5 hover:shadow-lg hover:shadow-emerald-950/20"
                  >
                    <div className="font-mono text-sm font-semibold text-emerald-200">{supplier.supplier_code}</div>
                    <div>
                      <div className="font-semibold text-white">{supplier.name}</div>
                      <div className="truncate text-xs text-zinc-500">{supplier.email || supplier.address || "No contact details"}</div>
                    </div>
                    <div className="text-sm text-zinc-300">{supplier.contact_person || supplier.phone || "n/a"}</div>
                    <div className="text-sm text-zinc-300">{supplier.whatsapp || supplier.phone || "n/a"}</div>
                    <div className="font-bold text-white">{formatCurrency(supplier.totalPurchases || 0)}</div>
                    <div className="font-bold text-white">{formatCurrency(supplier.current_balance || 0)}</div>
                    <StatusBadge value={supplierStatusLabel(supplier.status)} />
                    <div className="text-xs text-zinc-400">{supplier.lastPurchaseDate ? formatDateTime(supplier.lastPurchaseDate) : "n/a"}</div>
                    <div className="relative flex justify-end" onClick={(event) => event.stopPropagation()}>
                      <button type="button" onClick={() => setOpenMenuId(openMenuId === supplier.id ? null : supplier.id)} className="rounded-xl border border-white/10 bg-white/5 p-2 text-white hover:bg-white/10">
                        <MoreHorizontal className="h-4 w-4" />
                      </button>
                      {openMenuId === supplier.id ? (
                        <ActionMenu
                          supplier={supplier}
                          onView={() => openProfile(supplier)}
                          onEdit={() => openEditModal(supplier)}
                          onDelete={() => deleteSupplier(supplier)}
                          onPurchase={() => navigate(`/purchases/create?supplier_id=${supplier.id}`)}
                        />
                      ) : null}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm text-zinc-400">
            Showing {visible.length} of {sorted.length} suppliers
          </div>
          <div className="flex items-center gap-2">
            <PagerButton onClick={() => setPage((prev) => Math.max(1, prev - 1))} disabled={currentPage === 1} label="Prev" />
            <span className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-zinc-300">
              Page {currentPage} / {totalPages}
            </span>
            <PagerButton onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))} disabled={currentPage === totalPages} label="Next" />
          </div>
        </div>
      </div>

      {modalSupplier !== undefined ? (
        <SupplierModal
          supplier={modalSupplier}
          form={form}
          setForm={setForm}
          error={formError}
          saving={saving}
          onClose={closeModal}
          onSubmit={submitSupplier}
        />
      ) : null}

      {profile ? (
        <ProfileDrawer
          supplier={profile}
          loading={profileLoading}
          onClose={() => setProfile(null)}
          onEdit={() => openEditModal(profile)}
          onPurchase={() => navigate(`/purchases/create?supplier_id=${profile.id}`)}
        />
      ) : null}
    </FlowShell>
  );
}

function Kpi({ label, value, tone = "zinc" }) {
  const classes = {
    emerald: "border-emerald-500/20 bg-emerald-500/10 text-emerald-300",
    amber: "border-amber-500/20 bg-amber-500/10 text-amber-300",
    blue: "border-blue-500/20 bg-blue-500/10 text-blue-300",
    zinc: "border-white/10 bg-white/5 text-white",
  };
  return (
    <div className={`rounded-3xl border p-4 shadow-xl ${classes[tone]}`}>
      <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">{label}</div>
      <div className="mt-2 text-2xl font-black text-white">{value}</div>
    </div>
  );
}

function Select({ value, onChange, options }) {
  return (
    <select value={value} onChange={(event) => onChange(event.target.value)} className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none focus:border-emerald-400/50">
      {options.map(([optionValue, label]) => (
        <option key={optionValue} value={optionValue} className="bg-zinc-950 text-white">
          {label}
        </option>
      ))}
    </select>
  );
}

function ActionMenu({ supplier, onView, onEdit, onDelete, onPurchase }) {
  const items = [
    [Eye, "View", onView],
    [Edit3, "Edit", onEdit],
    [Trash2, "Delete", onDelete],
    [FilePlus2, "Create Purchase Order", onPurchase],
  ];
  return (
    <div className="absolute right-0 top-11 z-20 w-56 rounded-2xl border border-white/10 bg-zinc-950 p-2 shadow-2xl shadow-black">
      <div className="mb-1 truncate px-3 py-2 text-xs text-zinc-500">{supplier.supplier_code}</div>
      {items.map(([Icon, label, onClick]) => (
        <button key={label} type="button" onClick={onClick} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-zinc-200 hover:bg-white/5">
          <Icon className="h-4 w-4" />
          {label}
        </button>
      ))}
    </div>
  );
}

function EmptyState({ onCreate }) {
  return (
    <div className="rounded-3xl border border-dashed border-white/10 bg-white/5 p-10 text-center">
      <ShieldCheck className="mx-auto h-12 w-12 text-zinc-500" />
      <h3 className="mt-4 text-xl font-black text-white">No suppliers found</h3>
      <p className="mt-2 text-sm text-zinc-400">Create your first supplier or adjust the active filters.</p>
      <button type="button" onClick={onCreate} className="mt-5 inline-flex items-center gap-2 rounded-2xl bg-emerald-500 px-4 py-2 text-sm font-black text-black">
        <Plus className="h-4 w-4" />
        Add Supplier
      </button>
    </div>
  );
}

function SupplierModal({ supplier, form, setForm, error, saving, onClose, onSubmit }) {
  const setField = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-end bg-black/70 backdrop-blur-sm sm:items-stretch" dir="auto">
      <button type="button" className="absolute inset-0 cursor-default" onClick={onClose} aria-label="Close" />
      <form onSubmit={onSubmit} className="relative flex h-[92vh] w-full max-w-2xl animate-in slide-in-from-bottom-6 flex-col overflow-hidden rounded-t-3xl border border-white/10 bg-zinc-950 shadow-2xl shadow-black sm:h-full sm:rounded-none sm:rounded-l-3xl">
        <div className="border-b border-white/10 bg-white/[0.03] p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-300">Suppliers</div>
              <h2 className="mt-1 text-2xl font-black text-white">{supplier ? "تعديل مورد / Edit Supplier" : "إضافة مورد / Add Supplier"}</h2>
            </div>
            <button type="button" onClick={onClose} className="rounded-xl border border-white/10 bg-white/5 p-2 text-white">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {error ? <div className="rounded-2xl border border-rose-500/20 bg-rose-500/10 p-3 text-sm text-rose-100">{error}</div> : null}
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="اسم المورد / Supplier Name *" value={form.name} onChange={(value) => setField("name", value)} />
            <Field label="الشخص المسؤول / Contact Person" value={form.contact_person} onChange={(value) => setField("contact_person", value)} />
            <Field label="الهاتف / Phone" value={form.phone} onChange={(value) => setField("phone", value)} />
            <Field label="واتساب / WhatsApp" value={form.whatsapp} onChange={(value) => setField("whatsapp", value)} />
            <Field label="البريد / Email" value={form.email} onChange={(value) => setField("email", value)} />
            <Field label="الرقم الضريبي / Tax Number" value={form.tax_number} onChange={(value) => setField("tax_number", value)} />
            <Field label="الرصيد الافتتاحي / Opening Balance" type="number" value={form.opening_balance} onChange={(value) => setField("opening_balance", Number(value || 0))} />
            <label className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
              <span className="text-sm font-semibold text-white">نشط / Active</span>
              <button type="button" onClick={() => setField("status", form.status === "active" ? "inactive" : "active")} className={`h-7 w-12 rounded-full p-1 transition ${form.status === "active" ? "bg-emerald-500" : "bg-zinc-700"}`}>
                <span className={`block h-5 w-5 rounded-full bg-white transition ${form.status === "active" ? "translate-x-5" : ""}`} />
              </button>
            </label>
          </div>
          <Field label="العنوان / Address" value={form.address} onChange={(value) => setField("address", value)} />
          <label className="block">
            <div className="mb-2 text-xs font-semibold text-zinc-400">ملاحظات / Notes</div>
            <textarea value={form.notes} onChange={(event) => setField("notes", event.target.value)} rows={4} className="w-full resize-none rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none focus:border-emerald-400/50" />
          </label>
        </div>

        <div className="grid gap-3 border-t border-white/10 bg-white/[0.03] p-5 sm:grid-cols-2">
          <button type="button" onClick={onClose} className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white">
            Cancel
          </button>
          <button type="submit" disabled={saving} className="rounded-2xl bg-emerald-500 px-4 py-3 text-sm font-black text-black disabled:opacity-50">
            {saving ? "Saving..." : "Save Supplier"}
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, value, onChange, type = "text" }) {
  return (
    <label className="block">
      <div className="mb-2 text-xs font-semibold text-zinc-400">{label}</div>
      <input type={type} value={value ?? ""} onChange={(event) => onChange(event.target.value)} className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none focus:border-emerald-400/50" />
    </label>
  );
}

function ProfileDrawer({ supplier, loading, onClose, onEdit, onPurchase }) {
  const history = toArray(supplier.purchase_history);
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/60 backdrop-blur-sm">
      <button type="button" className="absolute inset-0 cursor-default" onClick={onClose} aria-label="Close profile" />
      <aside className="relative flex h-full w-full max-w-xl flex-col overflow-hidden border-l border-white/10 bg-zinc-950 shadow-2xl shadow-black">
        <div className="border-b border-white/10 p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="font-mono text-sm text-emerald-300">{supplier.supplier_code}</div>
              <h2 className="mt-1 text-2xl font-black text-white">{supplier.name}</h2>
              <p className="mt-1 text-sm text-zinc-400">{supplier.address || "No address"}</p>
            </div>
            <button type="button" onClick={onClose} className="rounded-xl border border-white/10 bg-white/5 p-2 text-white">
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" onClick={onEdit} className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white">
              <Edit3 className="h-4 w-4" />
              Edit
            </button>
            <button type="button" onClick={onPurchase} className="inline-flex items-center gap-2 rounded-2xl bg-emerald-500 px-4 py-2 text-sm font-black text-black">
              <FilePlus2 className="h-4 w-4" />
              Purchase Order
            </button>
          </div>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {loading ? <div className="rounded-2xl border border-white/10 bg-white/5 p-3 text-sm text-zinc-300">Refreshing supplier profile...</div> : null}
          <div className="grid gap-3 sm:grid-cols-3">
            <MiniStat label="Current Balance" value={formatCurrency(supplier.current_balance || supplier.balance || 0)} icon={<Wallet className="h-4 w-4" />} />
            <MiniStat label="Total Purchases" value={formatCurrency(supplier.total_purchases || supplier.totalPurchases || 0)} icon={<Building2 className="h-4 w-4" />} />
            <MiniStat label="Orders" value={supplier.purchase_count || supplier.purchaseCount || history.length || 0} icon={<FilePlus2 className="h-4 w-4" />} />
          </div>
          <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
            <h3 className="text-lg font-black text-white">Supplier Info</h3>
            <div className="mt-4 grid gap-3 text-sm text-zinc-300">
              <Info icon={<Phone className="h-4 w-4" />} label="Phone" value={supplier.phone || "n/a"} />
              <Info icon={<Phone className="h-4 w-4" />} label="WhatsApp" value={supplier.whatsapp || supplier.phone || "n/a"} />
              <Info icon={<Mail className="h-4 w-4" />} label="Email" value={supplier.email || "n/a"} />
              <Info icon={<Building2 className="h-4 w-4" />} label="Contact" value={supplier.contact_person || "n/a"} />
              <Info icon={<ShieldCheck className="h-4 w-4" />} label="Tax Number" value={supplier.tax_number || "n/a"} />
            </div>
          </div>
          <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
            <h3 className="text-lg font-black text-white">Last Orders</h3>
            <div className="mt-3 space-y-2">
              {history.length ? history.map((purchase) => (
                <div key={purchase.id} className="flex items-center justify-between rounded-2xl border border-white/10 bg-zinc-950/80 p-3">
                  <div>
                    <div className="font-semibold text-white">{purchase.purchase_number || `PUR-${purchase.id}`}</div>
                    <div className="text-xs text-zinc-500">{formatDateTime(purchase.created_at)}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-bold text-white">{formatCurrency(purchase.total || 0)}</div>
                    <div className="text-xs text-zinc-500">{purchase.status || "draft"}</div>
                  </div>
                </div>
              )) : <div className="rounded-2xl border border-dashed border-white/10 p-5 text-center text-sm text-zinc-400">No purchase history yet.</div>}
            </div>
          </div>
          <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
            <h3 className="text-lg font-black text-white">Notes</h3>
            <p className="mt-2 text-sm leading-6 text-zinc-300">{supplier.notes || "No notes recorded for this supplier."}</p>
          </div>
        </div>
      </aside>
    </div>
  );
}

function MiniStat({ label, value, icon }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
      <div className="flex items-center gap-2 text-xs text-zinc-500">{icon}{label}</div>
      <div className="mt-2 text-lg font-black text-white">{value}</div>
    </div>
  );
}

function Info({ icon, label, value }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-zinc-950/80 p-3">
      <div className="flex items-center gap-2 text-zinc-500">{icon}<span>{label}</span></div>
      <span className="text-right text-white">{value}</span>
    </div>
  );
}

function PagerButton({ onClick, disabled, label }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
      {label}
    </button>
  );
}

export default SuppliersDashboard;
