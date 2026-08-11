import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  ReceiptText,
  Search,
  ShieldCheck,
  Trash2,
  Wallet,
  X,
} from "lucide-react";

import toast from "react-hot-toast";
import { api } from "../../../shared/api/api";
import useDismissableLayer from "../../../shared/hooks/useDismissableLayer";
import { Pagination } from "../../../shared/ui";
import FlowShell from "../components/FlowShell";
import StatusBadge from "../components/StatusBadge";
import { formatCurrency, formatDateTime, formatPurchaseCode, getLocalPurchases, normalizeSupplier, seedSuppliers } from "../lib/flowStore";

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100, 200, 500, 1000, "all"];
const SUPPLIER_ACTIONS_MENU_WIDTH = 256;
const SUPPLIER_ACTIONS_MENU_MARGIN = 12;
const SUPPLIER_ACTIONS_MENU_ESTIMATED_HEIGHT = 280;
const SUPPLIER_ACTIONS_MENU_Z_INDEX = 9999;
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
  const [pageSize, setPageSize] = useState(25);
  const [openMenuId, setOpenMenuId] = useState(null);
  const [menuPosition, setMenuPosition] = useState(null);
  const [modalSupplier, setModalSupplier] = useState(undefined);
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState("");
  const [profile, setProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const menuButtonRef = useRef(null);
  const menuRef = useRef(null);

  useDismissableLayer({
    enabled: Boolean(openMenuId),
    refs: [menuButtonRef, menuRef],
    onDismiss: () => {
      setOpenMenuId(null);
      setMenuPosition(null);
      menuButtonRef.current = null;
      menuRef.current = null;
    },
  });

  const closeActionsMenu = useCallback(() => {
    setOpenMenuId(null);
    setMenuPosition(null);
    menuButtonRef.current = null;
    menuRef.current = null;
  }, []);

  const positionActionsMenu = useCallback((button, menuHeight = SUPPLIER_ACTIONS_MENU_ESTIMATED_HEIGHT) => {
    if (typeof window === "undefined" || !button) return null;
    const rect = button.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const isRtl = typeof document !== "undefined" && document.documentElement?.dir === "rtl";
    const maxTop = Math.max(SUPPLIER_ACTIONS_MENU_MARGIN, viewportHeight - menuHeight - SUPPLIER_ACTIONS_MENU_MARGIN);
    const top = Math.min(rect.bottom + 8, maxTop);

    if (isRtl) {
      const preferredRight = Math.max(SUPPLIER_ACTIONS_MENU_MARGIN, viewportWidth - rect.right);
      const right = Math.min(
        preferredRight,
        Math.max(SUPPLIER_ACTIONS_MENU_MARGIN, viewportWidth - SUPPLIER_ACTIONS_MENU_WIDTH - SUPPLIER_ACTIONS_MENU_MARGIN)
      );
      return {
        right,
        top,
        maxHeight: Math.max(160, viewportHeight - top - SUPPLIER_ACTIONS_MENU_MARGIN),
      };
    }

    const preferredLeft = rect.left;
    const left = Math.min(
      Math.max(SUPPLIER_ACTIONS_MENU_MARGIN, preferredLeft),
      Math.max(SUPPLIER_ACTIONS_MENU_MARGIN, viewportWidth - SUPPLIER_ACTIONS_MENU_WIDTH - SUPPLIER_ACTIONS_MENU_MARGIN)
    );
    return {
      left,
      top,
      maxHeight: Math.max(160, viewportHeight - top - SUPPLIER_ACTIONS_MENU_MARGIN),
    };
  }, []);

  const openActionsMenu = useCallback((supplierId, event) => {
    event.preventDefault();
    event.stopPropagation();
    const button = event.currentTarget;
    if (openMenuId === supplierId) {
      closeActionsMenu();
      return;
    }
    menuButtonRef.current = button;
    setMenuPosition(positionActionsMenu(button, menuRef.current?.offsetHeight || SUPPLIER_ACTIONS_MENU_ESTIMATED_HEIGHT));
    setOpenMenuId(supplierId);
  }, [closeActionsMenu, openMenuId, positionActionsMenu]);

  useEffect(() => {
    if (!openMenuId) return undefined;

    const updatePosition = () => {
      if (!menuButtonRef.current) return;
      setMenuPosition(positionActionsMenu(menuButtonRef.current, menuRef.current?.offsetHeight || SUPPLIER_ACTIONS_MENU_ESTIMATED_HEIGHT));
    };

    const closeOnEscape = (event) => {
      if (event.key === "Escape") closeActionsMenu();
    };

    updatePosition();
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);
    document.addEventListener("keydown", closeOnEscape);

    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [closeActionsMenu, openMenuId, positionActionsMenu]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    console.log("[supplier-actions-menu]", { open: Boolean(openMenuId), position: menuPosition, supplierId: openMenuId });
  }, [menuPosition, openMenuId]);

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

  useEffect(() => {
    setPage(1);
    closeActionsMenu();
  }, [search, statusFilter, sort, closeActionsMenu]);

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

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const visible = sorted.slice((currentPage - 1) * pageSize, currentPage * pageSize);

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
    closeActionsMenu();
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
      setFormError(t("purchases.suppliersDashboard.supplierNameRequired"));
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
      toast.success(t(modalSupplier ? "purchases.suppliersDashboard.supplierUpdated" : "purchases.suppliersDashboard.supplierCreated"));
      setModalSupplier(undefined);
      await loadSuppliers();
    } catch (err) {
      console.error(err);
      const message = err?.responseBody?.message || err?.message || t("purchases.suppliersDashboard.supplierSaveFailed");
      setFormError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const deleteSupplier = async (supplier) => {
    closeActionsMenu();
    const ok = window.confirm(t("purchases.suppliersDashboard.confirmDeleteSupplier", { name: supplier.name }));
    if (!ok) return;
    try {
      await api.delete(`/suppliers/${supplier.id}`);
      setSuppliers((prev) => prev.filter((item) => String(item.id) !== String(supplier.id)));
      if (String(profile?.id) === String(supplier.id)) setProfile(null);
      toast.success(t("purchases.suppliersDashboard.supplierDeleted"));
    } catch (err) {
      console.error(err);
      toast.error(err?.responseBody?.message || t("purchases.suppliersDashboard.supplierDeleteFailed"));
    }
  };

  const openProfile = async (supplier) => {
    setProfile(supplier);
    closeActionsMenu();
    try {
      setProfileLoading(true);
      const response = await api.get(`/suppliers/${supplier.id}`);
      setProfile({ ...supplier, ...(response?.data || response?.supplier || {}) });
    } catch (err) {
      console.error(err);
      toast.error(t("purchases.suppliersDashboard.profileRefreshFailed"));
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
            {t("purchases.suppliersDashboard.addSupplier")}
          </button>
          <button type="button" className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10">
            <Download className="h-4 w-4" />
            {t("purchases.suppliersDashboard.importSuppliers")}
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
        <Kpi label={t("purchases.suppliersDashboard.currentBalance")} value={formatCurrency(totals.balance)} tone="amber" />
        <Kpi label={t("purchases.suppliersDashboard.totalPurchases")} value={formatCurrency(totals.spend)} tone="blue" />
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
            <Search className="pointer-events-none absolute start-4 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t("purchases.suppliersDashboard.searchPlaceholder")}
              className="w-full rounded-2xl border border-white/10 bg-white/5 py-3 pe-4 ps-11 text-sm text-white outline-none placeholder:text-zinc-500 focus:border-emerald-400/50"
            />
          </div>
          <Select value={statusFilter} onChange={setStatusFilter} options={[["all", t("purchases.suppliersDashboard.allStatus")], ["active", t("purchases.statusLabels.active")], ["inactive", t("purchases.statusLabels.inactive")]]} />
          <Select value={sort} onChange={setSort} options={[["newest", t("purchases.suppliersDashboard.newest")], ["highest_balance", t("purchases.suppliersDashboard.highestBalance")], ["name", t("purchases.suppliersDashboard.nameAz")]]} />
        </div>

        <div className="mt-4 overflow-x-auto">
          <div className="min-w-[1280px]">
            <div className="grid grid-cols-[12%_18%_12%_12%_12%_10%_10%_8%_6%] rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-xs uppercase tracking-[0.16em] text-zinc-500">
              <div>{t("purchases.suppliersDashboard.code")}</div>
              <div>{t("purchases.suppliersDashboard.supplier")}</div>
              <div>{t("purchases.suppliersDashboard.contact")}</div>
              <div>{t("purchases.suppliersDashboard.whatsapp")}</div>
              <div>{t("purchases.suppliersDashboard.totalPurchases")}</div>
              <div>{t("purchases.suppliersDashboard.balance")}</div>
              <div>{t("purchases.suppliersDashboard.status")}</div>
              <div>{t("purchases.suppliersDashboard.lastPo")}</div>
              <div></div>
            </div>

            <div className="mt-2 space-y-2 overflow-visible">
              {loading ? (
                Array.from({ length: 6 }).map((_, index) => <div key={index} className="h-16 animate-pulse rounded-2xl border border-white/10 bg-white/5" />)
              ) : visible.length === 0 ? (
                <EmptyState onCreate={openCreateModal} />
              ) : (
                visible.map((supplier) => (
                  <div
                    key={String(supplier.id)}
                    onClick={() => openProfile(supplier)}
                    className="relative grid cursor-pointer grid-cols-[12%_18%_12%_12%_12%_10%_10%_8%_6%] items-center overflow-visible rounded-2xl border border-white/10 bg-zinc-950/90 px-4 py-3 transition hover:border-emerald-400/30 hover:bg-emerald-400/5 hover:shadow-lg hover:shadow-emerald-950/20"
                  >
                    <div className="font-mono text-sm font-semibold text-emerald-200">{supplier.supplier_code}</div>
                    <div>
                      <div className="font-semibold text-white">{supplier.name}</div>
                      <div className="truncate text-xs text-zinc-500">{supplier.email || supplier.address || t("purchases.suppliersDashboard.noContactDetails")}</div>
                    </div>
                    <div className="text-sm text-zinc-300">{supplier.contact_person || supplier.phone || t("purchases.supplierDetails.notAvailable")}</div>
                    <div className="text-sm text-zinc-300">{supplier.whatsapp || supplier.phone || t("purchases.supplierDetails.notAvailable")}</div>
                    <div className="font-bold text-white">{formatCurrency(supplier.totalPurchases || 0)}</div>
                    <div className="font-bold text-white">{formatCurrency(supplier.current_balance || 0)}</div>
                    <StatusBadge value={supplierStatusLabel(supplier.status)} />
                    <div className="text-xs text-zinc-400">{supplier.lastPurchaseDate ? formatDateTime(supplier.lastPurchaseDate) : t("purchases.supplierDetails.notAvailable")}</div>
                    <div className="flex justify-end" onClick={(event) => event.stopPropagation()}>
                      <button
                        ref={(node) => {
                          if (openMenuId === supplier.id) menuButtonRef.current = node;
                        }}
                        type="button"
                        onClick={(event) => {
                          openActionsMenu(supplier.id, event);
                        }}
                        aria-expanded={openMenuId === supplier.id}
                        aria-haspopup="menu"
                        className="rounded-xl border border-white/10 bg-white/5 p-2 text-white hover:bg-white/10"
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
        <SupplierActionsMenu
          supplier={visible.find((supplier) => String(supplier.id) === String(openMenuId)) || null}
          position={menuPosition}
          menuRef={menuRef}
          zIndex={SUPPLIER_ACTIONS_MENU_Z_INDEX}
          onClose={closeActionsMenu}
          onView={openProfile}
          onEdit={openEditModal}
          onStatement={(supplier) => navigate(`/suppliers/${supplier.id}/statement`)}
          onPurchase={(supplier) => navigate(`/purchases/create?supplier_id=${supplier.id}`)}
          onDelete={deleteSupplier}
        />

        <Pagination
          className="mt-4"
          page={currentPage}
          pages={totalPages}
          total={sorted.length}
          pageSize={pageSize}
          pageSizeOptions={PAGE_SIZE_OPTIONS}
          visible={visible.length}
          onChange={setPage}
          onPageSizeChange={(value) => { setPageSize(value); setPage(1); }}
        />
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

function SupplierActionsMenu({ supplier, position, menuRef, zIndex, onClose, onView, onStatement, onEdit, onDelete, onPurchase }) {
  const { t } = useTranslation();
  if (!supplier || !position || typeof document === "undefined") return null;

  const items = [
    [Eye, t("purchases.suppliersDashboard.view"), onView],
    [Edit3, t("purchases.suppliersDashboard.edit"), onEdit],
    [ReceiptText, "كشف حساب", onStatement],
    [FilePlus2, t("purchases.suppliersDashboard.createPurchaseOrder"), onPurchase],
    [Trash2, t("purchases.suppliersDashboard.delete"), onDelete],
  ];

  const runAndClose = (action) => {
    onClose();
    action(supplier);
  };

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      className="fixed w-64 max-w-[calc(100vw-24px)] overflow-y-auto rounded-2xl border border-white/10 bg-zinc-950 p-2 shadow-2xl shadow-black"
      style={{
        left: typeof position.left === "number" ? `${position.left}px` : "auto",
        right: typeof position.right === "number" ? `${position.right}px` : "auto",
        top: `${position.top}px`,
        maxHeight: typeof position.maxHeight === "number" ? `${position.maxHeight}px` : "none",
        zIndex,
      }}
      dir="auto"
      onClick={(event) => event.stopPropagation()}
    >
      <div className="mb-1 truncate px-3 py-2 text-xs text-zinc-500">{supplier.supplier_code}</div>
      {items.map(([Icon, label, onClick]) => (
        <button
          key={label}
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            runAndClose(onClick);
          }}
          className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-start text-sm text-zinc-200 hover:bg-white/5"
        >
          <Icon className="h-4 w-4" />
          {label}
        </button>
      ))}
    </div>,
    document.body
  );
}

function EmptyState({ onCreate }) {
  const { t } = useTranslation();
  return (
    <div className="rounded-3xl border border-dashed border-white/10 bg-white/5 p-10 text-center">
      <ShieldCheck className="mx-auto h-12 w-12 text-zinc-500" />
      <h3 className="mt-4 text-xl font-black text-white">{t("purchases.suppliersDashboard.emptyTitle")}</h3>
      <p className="mt-2 text-sm text-zinc-400">{t("purchases.suppliersDashboard.emptyDescription")}</p>
      <button type="button" onClick={onCreate} className="mt-5 inline-flex items-center gap-2 rounded-2xl bg-emerald-500 px-4 py-2 text-sm font-black text-black">
        <Plus className="h-4 w-4" />
        {t("purchases.suppliersDashboard.addSupplier")}
      </button>
    </div>
  );
}

function SupplierModal({ supplier, form, setForm, error, saving, onClose, onSubmit }) {
  const { t } = useTranslation();
  const setField = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-end bg-black/70 backdrop-blur-sm sm:items-stretch" dir="auto">
      <button type="button" className="absolute inset-0 cursor-default" onClick={onClose} aria-label={t("purchases.suppliersDashboard.close")} />
      <form onSubmit={onSubmit} className="relative flex h-[92vh] w-full max-w-2xl animate-in slide-in-from-bottom-6 flex-col overflow-hidden rounded-t-3xl border border-white/10 bg-zinc-950 shadow-2xl shadow-black sm:h-full sm:rounded-none sm:rounded-l-3xl">
        <div className="border-b border-white/10 bg-white/[0.03] p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-300">{t("purchases.tabs.suppliers")}</div>
              <h2 className="mt-1 text-2xl font-black text-white">{supplier ? t("purchases.suppliersDashboard.editSupplier") : t("purchases.suppliersDashboard.addSupplier")}</h2>
            </div>
            <button type="button" onClick={onClose} className="rounded-xl border border-white/10 bg-white/5 p-2 text-white">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {error ? <div className="rounded-2xl border border-rose-500/20 bg-rose-500/10 p-3 text-sm text-rose-100">{error}</div> : null}
          <div className="grid gap-3 md:grid-cols-2">
            <Field label={t("purchases.suppliersDashboard.supplierNameRequiredLabel")} value={form.name} onChange={(value) => setField("name", value)} />
            <Field label={t("purchases.suppliersDashboard.contactPerson")} value={form.contact_person} onChange={(value) => setField("contact_person", value)} />
            <Field label={t("purchases.supplierDetails.phone")} value={form.phone} onChange={(value) => setField("phone", value)} />
            <Field label={t("purchases.suppliersDashboard.whatsapp")} value={form.whatsapp} onChange={(value) => setField("whatsapp", value)} />
            <Field label={t("purchases.supplierDetails.email")} value={form.email} onChange={(value) => setField("email", value)} />
            <Field label={t("purchases.suppliersDashboard.taxNumber")} value={form.tax_number} onChange={(value) => setField("tax_number", value)} />
            <Field label={t("purchases.supplierDetails.openingBalance")} type="number" value={form.opening_balance} onChange={(value) => setField("opening_balance", Number(value || 0))} />
            <label className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
              <span className="text-sm font-semibold text-white">{t("purchases.statusLabels.active")}</span>
              <button type="button" onClick={() => setField("status", form.status === "active" ? "inactive" : "active")} className={`h-7 w-12 rounded-full p-1 transition ${form.status === "active" ? "bg-emerald-500" : "bg-zinc-700"}`}>
                <span className={`block h-5 w-5 rounded-full bg-white transition ${form.status === "active" ? "translate-x-5" : ""}`} />
              </button>
            </label>
          </div>
          <Field label={t("purchases.supplierDetails.address")} value={form.address} onChange={(value) => setField("address", value)} />
          <label className="block">
            <div className="mb-2 text-xs font-semibold text-zinc-400">{t("purchases.supplierDetails.notes")}</div>
            <textarea value={form.notes} onChange={(event) => setField("notes", event.target.value)} rows={4} className="w-full resize-none rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none focus:border-emerald-400/50" />
          </label>
        </div>

        <div className="grid gap-3 border-t border-white/10 bg-white/[0.03] p-5 sm:grid-cols-2">
          <button type="button" onClick={onClose} className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white">
            {t("common.cancel")}
          </button>
          <button type="submit" disabled={saving} className="rounded-2xl bg-emerald-500 px-4 py-3 text-sm font-black text-black disabled:opacity-50">
            {saving ? t("purchases.details.saving") : t("purchases.suppliersDashboard.saveSupplier")}
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
  const { t } = useTranslation();
  const history = toArray(supplier.purchase_history);
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/60 backdrop-blur-sm">
      <button type="button" className="absolute inset-0 cursor-default" onClick={onClose} aria-label={t("purchases.suppliersDashboard.closeProfile")} />
      <aside className="relative flex h-full w-full max-w-xl flex-col overflow-hidden border-l border-white/10 bg-zinc-950 shadow-2xl shadow-black">
        <div className="border-b border-white/10 p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="font-mono text-sm text-emerald-300">{supplier.supplier_code}</div>
              <h2 className="mt-1 text-2xl font-black text-white">{supplier.name}</h2>
              <p className="mt-1 text-sm text-zinc-400">{supplier.address || t("purchases.supplierDetails.noAddress")}</p>
            </div>
            <button type="button" onClick={onClose} className="rounded-xl border border-white/10 bg-white/5 p-2 text-white">
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" onClick={onEdit} className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white">
              <Edit3 className="h-4 w-4" />
              {t("purchases.suppliersDashboard.edit")}
            </button>
            <button type="button" onClick={onPurchase} className="inline-flex items-center gap-2 rounded-2xl bg-emerald-500 px-4 py-2 text-sm font-black text-black">
              <FilePlus2 className="h-4 w-4" />
              {t("purchases.suppliersDashboard.purchaseOrder")}
            </button>
          </div>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {loading ? <div className="rounded-2xl border border-white/10 bg-white/5 p-3 text-sm text-zinc-300">{t("purchases.suppliersDashboard.refreshingProfile")}</div> : null}
          <div className="grid gap-3 sm:grid-cols-3">
            <MiniStat label={t("purchases.suppliersDashboard.currentBalance")} value={formatCurrency(supplier.current_balance || supplier.balance || 0)} icon={<Wallet className="h-4 w-4" />} />
            <MiniStat label={t("purchases.suppliersDashboard.totalPurchases")} value={formatCurrency(supplier.total_purchases || supplier.totalPurchases || 0)} icon={<Building2 className="h-4 w-4" />} />
            <MiniStat label={t("purchases.suppliersDashboard.orders")} value={supplier.purchase_count || supplier.purchaseCount || history.length || 0} icon={<FilePlus2 className="h-4 w-4" />} />
          </div>
          <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
            <h3 className="text-lg font-black text-white">{t("purchases.suppliersDashboard.supplierInfo")}</h3>
            <div className="mt-4 grid gap-3 text-sm text-zinc-300">
              <Info icon={<Phone className="h-4 w-4" />} label={t("purchases.supplierDetails.phone")} value={supplier.phone || t("purchases.supplierDetails.notAvailable")} />
              <Info icon={<Phone className="h-4 w-4" />} label={t("purchases.suppliersDashboard.whatsapp")} value={supplier.whatsapp || supplier.phone || t("purchases.supplierDetails.notAvailable")} />
              <Info icon={<Mail className="h-4 w-4" />} label={t("purchases.supplierDetails.email")} value={supplier.email || t("purchases.supplierDetails.notAvailable")} />
              <Info icon={<Building2 className="h-4 w-4" />} label={t("purchases.suppliersDashboard.contact")} value={supplier.contact_person || t("purchases.supplierDetails.notAvailable")} />
              <Info icon={<ShieldCheck className="h-4 w-4" />} label={t("purchases.suppliersDashboard.taxNumber")} value={supplier.tax_number || t("purchases.supplierDetails.notAvailable")} />
            </div>
          </div>
          <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
            <h3 className="text-lg font-black text-white">{t("purchases.suppliersDashboard.lastOrders")}</h3>
            <div className="mt-3 space-y-2">
              {history.length ? history.map((purchase) => (
                <div key={purchase.id} className="flex items-center justify-between rounded-2xl border border-white/10 bg-zinc-950/80 p-3">
                  <div>
                    <div className="font-semibold text-white">{purchase.purchase_number || purchase.invoice_number || formatPurchaseCode(purchase.id)}</div>
                    <div className="text-xs text-zinc-500">{formatDateTime(purchase.created_at)}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-bold text-white">{formatCurrency(purchase.total || 0)}</div>
                    <div className="text-xs text-zinc-500">{purchase.status || "draft"}</div>
                  </div>
                </div>
              )) : <div className="rounded-2xl border border-dashed border-white/10 p-5 text-center text-sm text-zinc-400">{t("purchases.suppliersDashboard.noPurchaseHistoryYet")}</div>}
            </div>
          </div>
          <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
            <h3 className="text-lg font-black text-white">{t("purchases.supplierDetails.notes")}</h3>
            <p className="mt-2 text-sm leading-6 text-zinc-300">{supplier.notes || t("purchases.suppliersDashboard.noNotesRecorded")}</p>
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

export default SuppliersDashboard;
