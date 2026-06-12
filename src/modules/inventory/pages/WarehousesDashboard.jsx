import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { AlertTriangle, ArrowRightLeft, Clock3, Pencil, Search, Trash2, Warehouse, X } from "lucide-react";
import toast from "react-hot-toast";

import { api } from "../../../shared/api/api";
import InventoryShell from "../components/InventoryShell";
import StatusBadge from "../../purchases/components/StatusBadge";
import { formatCurrency, normalizeWarehouse, seedWarehouses } from "../../purchases/lib/flowStore";

function WarehousesDashboard() {
  const { t, i18n } = useTranslation();
  const [warehouses, setWarehouses] = useState(seedWarehouses());
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteError, setDeleteError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [editForm, setEditForm] = useState({ name: "", location: "", branch: "", status: "active" });
  const [editError, setEditError] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const isArabic = true;
  const labels = {
    edit: isArabic ? "تعديل" : "Edit",
    editWarehouse: isArabic ? "تعديل المخزن" : "Edit warehouse",
    name: isArabic ? "اسم المخزن" : "Warehouse name",
    location: isArabic ? "الموقع" : "Location",
    branch: isArabic ? "الفرع" : "Branch",
    status: isArabic ? "الحالة" : "Status",
    active: isArabic ? "نشط" : "Active",
    inactive: isArabic ? "غير نشط" : "Inactive",
    cancel: isArabic ? "إلغاء" : "Cancel",
    save: isArabic ? "حفظ التعديل" : "Save changes",
    saving: isArabic ? "جارٍ الحفظ..." : "Saving...",
    success: isArabic ? "تم تعديل المخزن" : "Warehouse updated",
    nameRequired: isArabic ? "اسم المخزن مطلوب" : "Warehouse name required",
  };
  const formatWarehouseStatus = (value) => {
    const normalized = String(value || "").trim().toLowerCase();
    if (normalized === "active" || normalized === "نشط") return labels.active;
    if (normalized === "inactive" || normalized === "غير نشط") return labels.inactive;
    return value || labels.active;
  };

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        setError("");
        const data = await api.get("/warehouses");
        const rows = Array.isArray(data) ? data : data?.warehouses || [];
        setWarehouses(rows.length ? rows.map(normalizeWarehouse) : seedWarehouses());
      } catch (err) {
        console.log(err);
        setWarehouses(seedWarehouses());
        setError(t("warehouses.fallbackError"));
        toast.error(t("warehouses.fallbackToast"));
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const filtered = useMemo(
    () => warehouses.filter((warehouse) => `${warehouse.name} ${warehouse.location} ${warehouse.branch}`.toLowerCase().includes(search.trim().toLowerCase())),
    [warehouses, search]
  );

  const stats = useMemo(
    () => ({
      warehouses: warehouses.length,
      active: warehouses.filter((warehouse) => String(warehouse.status || "").toLowerCase() === "active").length,
      branch: warehouses.filter((warehouse) => warehouse.branch !== "Main").length,
      value: warehouses.length * 100000,
    }),
    [warehouses]
  );

  const openDelete = (warehouse) => {
    setDeleteTarget(warehouse);
    setDeleteError("");
  };

  const closeDelete = () => {
    if (deleting) return;
    setDeleteTarget(null);
    setDeleteError("");
  };

  const deleteWarehouse = async () => {
    if (!deleteTarget) return;
    try {
      setDeleting(true);
      setDeleteError("");
      await api.delete(`/warehouses/${deleteTarget.id}`);
      setWarehouses((current) => current.filter((warehouse) => String(warehouse.id) !== String(deleteTarget.id)));
      toast.success(isArabic ? "تم حذف المخزن" : "Warehouse deleted");
      setDeleteTarget(null);
    } catch (err) {
      const message = err?.responseBody?.message || err?.message || (isArabic ? "تعذر حذف المخزن" : "Warehouse could not be deleted");
      setDeleteError(message);
      toast.error(message);
    } finally {
      setDeleting(false);
    }
  };

  const openEdit = (warehouse) => {
    setEditTarget(warehouse);
    setEditForm({
      name: warehouse.name || "",
      location: warehouse.location || "",
      branch: warehouse.branch || warehouse.branch_name || "",
      status: String(warehouse.status || "active").toLowerCase() === "inactive" ? "inactive" : "active",
    });
    setEditError("");
  };

  const closeEdit = () => {
    if (savingEdit) return;
    setEditTarget(null);
    setEditError("");
  };

  const saveWarehouseEdit = async () => {
    if (!editTarget) return;
    const name = String(editForm.name || "").trim();
    if (!name) {
      setEditError(labels.nameRequired);
      return;
    }
    try {
      setSavingEdit(true);
      setEditError("");
      const payload = {
        name,
        location: editForm.location,
        branch: editForm.branch,
        branch_name: editForm.branch,
        status: editForm.status,
      };
      const response = await api.patch(`/warehouses/${editTarget.id}`, payload);
      const updated = normalizeWarehouse(response?.warehouse || response?.data || { ...editTarget, ...payload });
      setWarehouses((current) => current.map((warehouse) => (String(warehouse.id) === String(editTarget.id) ? updated : warehouse)));
      toast.success(labels.success);
      setEditTarget(null);
    } catch (err) {
      const message = err?.responseBody?.message || err?.message || (isArabic ? "تعذر تحديث المخزن" : "Warehouse could not be updated");
      setEditError(message);
      toast.error(message);
    } finally {
      setSavingEdit(false);
    }
  };

  return (
    <InventoryShell
      title={t("warehouses.title")}
      subtitle={t("warehouses.subtitle")}
      actions={
        <div className="flex flex-wrap gap-2">
          <Link to="/inventory/history" className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10">
            <Clock3 className="h-4 w-4" />
            {t("warehouses.history")}
          </Link>
          <Link to="/stock-transfers" className="inline-flex items-center gap-2 rounded-2xl bg-blue-500 px-4 py-2 text-sm font-black text-black transition hover:bg-blue-400">
            <ArrowRightLeft className="h-4 w-4" />
            {t("warehouses.transferStock")}
          </Link>
        </div>
      }
      tabs={[
        { to: "/inventory", label: t("warehouses.tabs.inventory"), end: true },
        { to: "/inventory/movements", label: t("warehouses.tabs.movements") },
        { to: "/inventory/adjustments", label: t("warehouses.tabs.adjustments") },
        { to: "/inventory/count", label: "الجرد" },
        { to: "/stock-transfers", label: t("warehouses.tabs.transfers") },
        { to: "/warehouses", label: t("warehouses.tabs.warehouses"), end: true },
      ]}
    >
      {error ? (
        <div className="rounded-3xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-100">
          <AlertTriangle className="mr-2 inline h-4 w-4" />
          {error}
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Kpi label={t("warehouses.kpis.warehouses")} value={stats.warehouses} />
        <Kpi label={t("warehouses.kpis.active")} value={stats.active} tone="emerald" />
        <Kpi label={t("warehouses.kpis.branches")} value={stats.branch} tone="blue" />
        <Kpi label={t("warehouses.kpis.valuation")} value={formatCurrency(stats.value)} tone="violet" />
      </div>

      <div className="rounded-3xl border border-white/10 bg-zinc-950/90 p-4 shadow-2xl shadow-black/10">
        <div className="relative">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("warehouses.searchPlaceholder")}
            className="w-full rounded-2xl border border-white/10 bg-white/5 py-3 pl-11 pr-4 text-sm text-white outline-none placeholder:text-zinc-500"
          />
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {loading ? (
            Array.from({ length: 6 }).map((_, index) => <div key={index} className="h-40 animate-pulse rounded-3xl border border-white/10 bg-white/5" />)
          ) : filtered.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-white/10 bg-white/5 p-10 text-center">
              <Warehouse className="mx-auto h-12 w-12 text-zinc-500" />
              <h3 className="mt-4 text-xl font-black text-white">{t("warehouses.empty.title")}</h3>
              <p className="mt-2 text-sm text-zinc-400">{t("warehouses.empty.subtitle")}</p>
            </div>
          ) : (
            filtered.map((warehouse) => (
              <div key={String(warehouse.id)} className="rounded-3xl border border-white/10 bg-white/5 p-5 shadow-xl shadow-black/10">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-semibold text-white">{warehouse.name}</div>
                    <div className="mt-1 text-xs text-zinc-500">{warehouse.location || (isArabic ? "غير متاح" : "n/a")}</div>
                  </div>
                  <StatusBadge value={formatWarehouseStatus(warehouse.status)} />
                </div>
                <div className="mt-4 space-y-2 text-sm text-zinc-300">
                  <div>{t("warehouses.row.branch")}: {warehouse.branch || (isArabic ? "غير متاح" : "n/a")}</div>
                  <div className="grid grid-cols-3 gap-2">
                    <MiniStat label={isArabic ? "المنتجات" : "Products"} value={warehouse.products_count || 0} />
                    <MiniStat label={isArabic ? "الرصيد" : "Stock"} value={warehouse.stock_qty ?? warehouse.stock_quantity ?? 0} />
                    <MiniStat label={isArabic ? "التحويلات" : "Transfers"} value={warehouse.transfers_count ?? warehouse.transfer_references ?? 0} />
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs text-zinc-500">{t("warehouses.row.id")} {warehouse.id}</span>
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => openEdit(warehouse)} className="inline-flex items-center gap-2 rounded-2xl border border-emerald-400/20 bg-emerald-500/10 px-3 py-2 text-sm font-semibold text-emerald-100 transition hover:border-emerald-300/50 hover:bg-emerald-500/20">
                      <Pencil className="h-4 w-4" />
                      {labels.edit}
                    </button>
                    <button type="button" onClick={() => openDelete(warehouse)} className="inline-flex items-center gap-2 rounded-2xl border border-rose-400/20 bg-rose-500/10 px-3 py-2 text-sm font-semibold text-rose-100 transition hover:border-rose-300/50 hover:bg-rose-500/20">
                      <Trash2 className="h-4 w-4" />
                      {isArabic ? "حذف" : "Delete"}
                    </button>
                    <Link to="/stock-transfers" className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold text-white transition hover:bg-white/10">
                      <ArrowRightLeft className="h-4 w-4" />
                      {t("warehouses.buttons.transfer")}
                    </Link>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
      {deleteTarget ? (
        <DeleteWarehouseModal
          warehouse={deleteTarget}
          error={deleteError}
          deleting={deleting}
          onClose={closeDelete}
          onConfirm={deleteWarehouse}
        />
      ) : null}
      {editTarget ? (
        <EditWarehouseModal
          warehouse={editTarget}
          form={editForm}
          labels={labels}
          error={editError}
          saving={savingEdit}
          onChange={setEditForm}
          onClose={closeEdit}
          onSave={saveWarehouseEdit}
        />
      ) : null}
    </InventoryShell>
  );
}

function Kpi({ label, value, tone = "zinc" }) {
  const classes = {
    emerald: "border-emerald-500/20 bg-emerald-500/10 text-emerald-300",
    blue: "border-blue-500/20 bg-blue-500/10 text-blue-300",
    violet: "border-violet-500/20 bg-violet-500/10 text-violet-300",
    zinc: "border-white/10 bg-white/5 text-white",
  };
  return (
    <div className={`rounded-3xl border p-4 shadow-xl ${classes[tone]}`}>
      <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">{label}</div>
      <div className="mt-2 text-2xl font-black text-white">{value}</div>
    </div>
  );
}

function MiniStat({ label, value }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 p-2">
      <div className="text-[10px] uppercase tracking-[0.12em] text-zinc-500">{label}</div>
      <div className="mt-1 text-sm font-black text-white">{value}</div>
    </div>
  );
}

function EditWarehouseModal({ warehouse, form, labels, error, saving, onChange, onClose, onSave }) {
  const { i18n } = useTranslation();
  const isArabic = String(i18n.language || "").toLowerCase().startsWith("ar");
  const isProtected = Boolean(warehouse.is_protected || warehouse.default_references);
  const setField = (field, value) => onChange((current) => ({ ...current, [field]: value }));

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-4">
      <button type="button" className="absolute inset-0 cursor-default" onClick={onClose} aria-label={isArabic ? "إغلاق" : "Close"} />
      <div className="relative w-full max-w-xl rounded-t-3xl border border-white/10 bg-zinc-950 p-5 shadow-2xl shadow-black sm:rounded-3xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-300">{labels.edit}</div>
            <h3 className="mt-1 text-xl font-black text-white">{labels.editWarehouse}</h3>
            {isProtected ? (
              <p className="mt-2 text-sm leading-6 text-amber-100">{isArabic ? "هذا مخزن افتراضي أو محمي، ولا يمكن تحويل حالته إلى غير نشط." : "Default/protected warehouse: status cannot be changed to inactive."}</p>
            ) : null}
          </div>
          <button type="button" onClick={onClose} className="rounded-xl border border-white/10 bg-white/5 p-2 text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-5 grid gap-4">
          <EditField label={labels.name} value={form.name} onChange={(value) => setField("name", value)} required />
          <EditField label={labels.location} value={form.location} onChange={(value) => setField("location", value)} />
          <EditField label={labels.branch} value={form.branch} onChange={(value) => setField("branch", value)} />
          <label className="block">
            <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-zinc-500">{labels.status}</div>
            <select
              value={form.status}
              onChange={(event) => setField("status", event.target.value)}
              className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none"
            >
              <option value="active" className="bg-zinc-950 text-white">{labels.active}</option>
              <option value="inactive" className="bg-zinc-950 text-white">{labels.inactive}</option>
            </select>
          </label>
        </div>

        {error ? <div className="mt-4 rounded-2xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">{error}</div> : null}

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <button type="button" onClick={onClose} disabled={saving} className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10 disabled:opacity-50">
            {labels.cancel}
          </button>
          <button type="button" onClick={onSave} disabled={saving} className="rounded-2xl bg-emerald-500 px-4 py-3 text-sm font-black text-black transition hover:bg-emerald-400 disabled:opacity-50">
            {saving ? labels.saving : labels.save}
          </button>
        </div>
      </div>
    </div>
  );
}

function EditField({ label, value, onChange, required = false }) {
  return (
    <label className="block">
      <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-zinc-500">{label}</div>
      <input
        value={value}
        required={required}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none placeholder:text-zinc-500"
      />
    </label>
  );
}

function DeleteWarehouseModal({ warehouse, error, deleting, onClose, onConfirm }) {
  const { i18n } = useTranslation();
  const isArabic = String(i18n.language || "").toLowerCase().startsWith("ar");
  const stockQuantity = Number(warehouse.stock_qty ?? warehouse.stock_quantity ?? 0);
  const productsCount = Number(warehouse.products_count || 0);
  const transferReferences = Number(warehouse.transfers_count ?? warehouse.transfer_references ?? 0);
  const activeTransferReferences = Number(warehouse.active_transfers_count ?? warehouse.active_transfer_references ?? 0);
  const isProtected = Boolean(warehouse.is_protected || warehouse.default_references);
  const hasServerId = Number.isFinite(Number(warehouse.id));
  const hasInventory = stockQuantity > 0 || productsCount > 0;
  const usedInTransfers = transferReferences > 0 || activeTransferReferences > 0;
  const canDelete = hasServerId && !isProtected && !hasInventory && !usedInTransfers;
  const blockMessage = !hasServerId
    ? (isArabic ? "مطلوب معرّف مخزن صالح من الخادم" : "Backend warehouse id required")
    : isProtected
    ? (isArabic ? "لا يمكن حذف المخزن الافتراضي" : "Default warehouse cannot be deleted")
    : hasInventory
      ? (isArabic ? "لا يزال المخزن يحتوي على مخزون" : "Warehouse still contains inventory")
      : usedInTransfers
        ? (isArabic ? "المخزن مستخدم في تحويلات نشطة" : "Warehouse is used in active transfers")
        : "";

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-4">
      <button type="button" className="absolute inset-0 cursor-default" onClick={onClose} aria-label={isArabic ? "إغلاق" : "Close"} />
      <div className="relative w-full max-w-xl rounded-t-3xl border border-white/10 bg-zinc-950 p-5 shadow-2xl shadow-black sm:rounded-3xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-rose-300">{isArabic ? "حذف المخزن" : "Delete warehouse"}</div>
            <h3 className="mt-1 text-xl font-black text-white">{warehouse.name}</h3>
            <p className="mt-2 text-sm leading-6 text-zinc-400">
              {isArabic ? "راجع استخدام المخزن قبل الحذف. يمكن حذف المخازن المكررة الفارغة بأمان." : "Review usage before deleting. Empty duplicate warehouses can be removed safely."}
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-xl border border-white/10 bg-white/5 p-2 text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <MiniStat label={isArabic ? "المنتجات" : "Products"} value={productsCount} />
          <MiniStat label={isArabic ? "كمية المخزون" : "Stock qty"} value={stockQuantity} />
          <MiniStat label={isArabic ? "التحويلات" : "Transfers"} value={transferReferences} />
          <MiniStat label={isArabic ? "النشطة" : "Active"} value={activeTransferReferences} />
        </div>

        <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-sm text-zinc-300">
          <div className="flex items-center justify-between gap-3">
            <span>{isArabic ? "معرّف المخزن" : "Warehouse ID"}</span>
            <span className="font-black text-white">{warehouse.id}</span>
          </div>
          <div className="mt-2 flex items-center justify-between gap-3">
            <span>{isArabic ? "المرجعيات الافتراضية" : "Default references"}</span>
            <span className={isProtected ? "font-black text-amber-200" : "font-black text-emerald-200"}>{warehouse.default_references || 0}</span>
          </div>
        </div>

        {blockMessage ? (
          <div className="mt-4 rounded-2xl border border-amber-400/25 bg-amber-500/10 px-4 py-3 text-sm font-semibold text-amber-100">
            {blockMessage}
          </div>
        ) : (
          <div className="mt-4 rounded-2xl border border-emerald-400/25 bg-emerald-500/10 px-4 py-3 text-sm font-semibold text-emerald-100">
            {isArabic ? "هذا المخزن فارغ ويمكن حذفه." : "This warehouse is empty and can be deleted."}
          </div>
        )}

        {error ? (
          <div className="mt-3 rounded-2xl border border-rose-400/25 bg-rose-500/10 px-4 py-3 text-sm font-semibold text-rose-100">
            {error}
          </div>
        ) : null}

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <button type="button" onClick={onClose} disabled={deleting} className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10 disabled:opacity-50">
            {isArabic ? "إلغاء" : "Cancel"}
          </button>
          <button type="button" onClick={onConfirm} disabled={!canDelete || deleting} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-rose-500 px-4 py-3 text-sm font-black text-white transition hover:bg-rose-400 disabled:cursor-not-allowed disabled:opacity-40">
            <Trash2 className="h-4 w-4" />
            {deleting ? (isArabic ? "جارٍ الحذف..." : "Deleting...") : (isArabic ? "حذف المخزن" : "Delete warehouse")}
          </button>
        </div>
      </div>
    </div>
  );
}

export default WarehousesDashboard;
