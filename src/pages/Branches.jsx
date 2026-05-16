import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";

import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  Edit3,
  Eye,
  MapPin,
  Plus,
  Search,
  Trash2,
  Warehouse,
  X,
} from "lucide-react";

import { api } from "../shared/api/api";

const emptyForm = {
  name: "",
  code: "",
  phone: "",
  address: "",
  manager: "",
  notes: "",
  default_warehouse_id: "",
  is_active: true,
};

const fallbackLabels = {
  "branches.eyebrow": "Branch network",
  "branches.title": "Branches",
  "branches.subtitle": "Manage branch identities, contact details, managers, and active status.",
  "branches.create": "+ Add Branch",
  "branches.edit": "Edit branch",
  "branches.new": "New branch",
  "branches.view": "Branch details",
  "branches.createHint": "Create a branch profile for sales, employees, and warehouse operations.",
  "branches.updateHint": "Update branch identity, contact details, notes, and status.",
  "branches.stats.total": "Total branches",
  "branches.stats.active": "Active branches",
  "branches.stats.mapped": "Warehouse mapped",
  "branches.searchPlaceholder": "Search branch, code, phone, manager, address, notes...",
  "branches.status.all": "All",
  "branches.status.active": "Active",
  "branches.status.inactive": "Inactive",
  "branches.tableHeaders.branch": "Branch",
  "branches.tableHeaders.code": "Code",
  "branches.tableHeaders.manager": "Manager",
  "branches.tableHeaders.address": "Address",
  "branches.tableHeaders.warehouse": "Warehouse",
  "branches.tableHeaders.actions": "Actions",
  "branches.empty.loading": "Loading branches...",
  "branches.empty.title": "No branches yet",
  "branches.form.name": "Branch Name",
  "branches.form.code": "Branch Code",
  "branches.form.phone": "Phone",
  "branches.form.manager": "Manager Name",
  "branches.form.address": "Address",
  "branches.form.notes": "Notes",
  "branches.form.defaultWarehouseId": "Default warehouse ID",
  "branches.form.activeStatus": "Status",
  "branches.toasts.loadFailed": "Failed to load branches",
  "branches.toasts.updated": "Branch updated",
  "branches.toasts.created": "Branch created",
  "branches.toasts.archived": "Branch deleted",
  "branches.toasts.savingFailed": "Failed to save branch",
  "branches.toasts.archivingFailed": "Failed to delete branch",
  "branches.buttons.cancel": "Cancel",
  "branches.buttons.save": "Save branch",
  "branches.buttons.update": "Update branch",
  "branches.buttons.saving": "Saving...",
  "branches.buttons.archive": "Delete branch",
  "branches.buttons.archiving": "Deleting...",
  "branches.buttons.view": "View",
  "branches.buttons.edit": "Edit",
  "branches.buttons.archiveShort": "Delete",
  "branches.confirm.title": "Delete branch",
  "branches.confirm.subtitle": "This will mark the branch inactive instead of permanently removing it. Linked employees remain preserved.",
  "branches.row.noPhone": "No phone",
  "branches.row.unassigned": "Unassigned",
  "branches.row.noAddress": "No address",
  "branches.row.noNotes": "No notes",
  "branches.row.notSet": "Not set",
};

const unwrapBranches = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.branches)) return payload.branches;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
};

function Branches() {
  const { t: translate } = useTranslation();
  const [branches, setBranches] = useState([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editingBranch, setEditingBranch] = useState(null);
  const [viewBranch, setViewBranch] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  const t = (key, fallback) => {
    try {
      const value = translate?.(key);
      return value && value !== key ? value : fallback || fallbackLabels[key] || key;
    } catch {
      return fallback || fallbackLabels[key] || key;
    }
  };

  const loadBranches = async () => {
    try {
      setLoading(true);
      setError("");
      const payload = await api.get("/branches");
      setBranches(unwrapBranches(payload));
    } catch (err) {
      console.log(err);
      setError(err?.message || t("branches.toasts.loadFailed"));
      setBranches([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    queueMicrotask(() => {
      void loadBranches();
    });
  }, []);

  const safeBranches = useMemo(() => (Array.isArray(branches) ? branches.filter(Boolean) : []), [branches]);

  const filteredBranches = useMemo(() => {
    const query = search.trim().toLowerCase();
    return safeBranches.filter((branch) => {
      const matchesSearch = `${branch.name || ""} ${branch.code || ""} ${branch.phone || ""} ${branch.address || ""} ${branch.manager || ""} ${branch.notes || ""} ${branch.default_warehouse_id || ""}`
        .toLowerCase()
        .includes(query);
      const status = branch.is_active === false ? "Inactive" : "Active";
      const matchesStatus = statusFilter === "All" || status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [safeBranches, search, statusFilter]);

  const stats = useMemo(
    () => ({
      total: safeBranches.length,
      active: safeBranches.filter((branch) => branch.is_active !== false).length,
      mapped: safeBranches.filter((branch) => branch.default_warehouse_id).length,
    }),
    [safeBranches]
  );

  const openCreateModal = () => {
    setEditingBranch(null);
    setForm(emptyForm);
    setModalOpen(true);
  };

  const openEditModal = (branch) => {
    setEditingBranch(branch);
    setForm({
      name: branch.name || "",
      code: branch.code || "",
      phone: branch.phone || "",
      address: branch.address || "",
      manager: branch.manager || "",
      notes: branch.notes || "",
      default_warehouse_id: branch.default_warehouse_id || "",
      is_active: branch.is_active !== false,
    });
    setModalOpen(true);
  };

  const closeBranchModal = () => {
    if (saving) return;
    setModalOpen(false);
    setEditingBranch(null);
    setForm(emptyForm);
  };

  const saveBranch = async () => {
    if (!form.name.trim()) return;

    try {
      setSaving(true);
      setError("");
      const payload = {
        ...form,
        name: form.name.trim(),
        code: form.code.trim(),
        phone: form.phone.trim(),
        address: form.address.trim(),
        manager: form.manager.trim(),
        notes: form.notes.trim(),
        default_warehouse_id: form.default_warehouse_id || null,
      };

      if (editingBranch) {
        await api.put(`/branches/${editingBranch.id}`, payload);
        toast.success(t("branches.toasts.updated"));
      } else {
        await api.post("/branches", payload);
        toast.success(t("branches.toasts.created"));
      }

      setForm(emptyForm);
      setEditingBranch(null);
      setModalOpen(false);
      await loadBranches();
    } catch (err) {
      console.log(err);
      const message = err?.message || t("branches.toasts.savingFailed");
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const deleteBranch = async () => {
    if (!deleteTarget) return;

    try {
      setDeleting(true);
      setError("");
      await api.delete(`/branches/${deleteTarget.id}`);
      toast.success(t("branches.toasts.archived"));
      setDeleteTarget(null);
      await loadBranches();
    } catch (err) {
      console.log(err);
      const message = err?.message || t("branches.toasts.archivingFailed");
      setError(message);
      toast.error(message);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_color-mix(in_srgb,var(--primary)_10%,transparent),transparent_32%),linear-gradient(180deg,var(--bg)_0%,var(--surface)_100%)] text-[var(--text)]">
      <div className="mx-auto flex w-full max-w-[1800px] flex-col gap-5 px-4 py-4 lg:px-6">
        <section className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-2xl shadow-[var(--shadow)]">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <div className="flex items-center gap-2 text-[var(--primary)]">
                <Building2 className="h-5 w-5" />
                <span className="text-xs font-semibold uppercase tracking-[0.18em]">{t("branches.eyebrow")}</span>
              </div>
              <h1 className="mt-2 text-3xl font-black tracking-tight text-[var(--text)]">{t("branches.title")}</h1>
              <p className="mt-1 max-w-3xl text-sm text-[var(--muted)]">{t("branches.subtitle")}</p>
            </div>
            <button
              type="button"
              onClick={openCreateModal}
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-[var(--primary)] px-5 py-3 text-sm font-black text-white shadow-xl shadow-[var(--shadow)] ring-1 ring-white/10 transition hover:-translate-y-0.5 hover:brightness-110"
            >
              <Plus className="h-4 w-4" />
              {t("branches.create")}
            </button>
          </div>
        </section>

        {error ? (
          <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm font-semibold text-red-200">
            {error}
          </div>
        ) : null}

        <section className="grid gap-3 md:grid-cols-3">
          <Kpi label={t("branches.stats.total")} value={stats.total} icon={<Building2 className="h-5 w-5" />} />
          <Kpi label={t("branches.stats.active")} value={stats.active} tone="emerald" icon={<CheckCircle2 className="h-5 w-5" />} />
          <Kpi label={t("branches.stats.mapped")} value={stats.mapped} tone="cyan" icon={<Warehouse className="h-5 w-5" />} />
        </section>

        <section className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-2xl shadow-[var(--shadow)]">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted)]" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t("branches.searchPlaceholder")}
                className="w-full rounded-2xl border border-[var(--border)] bg-[var(--card)] py-3 pl-11 pr-4 text-sm text-[var(--text)] outline-none placeholder:text-[var(--muted)]"
              />
            </div>
            <div className="flex rounded-2xl border border-[var(--border)] bg-[var(--card)] p-1">
              {[
                ["All", t("branches.status.all")],
                ["Active", t("branches.status.active")],
                ["Inactive", t("branches.status.inactive")],
              ].map(([status, label]) => (
                <button
                  key={status}
                  type="button"
                  onClick={() => setStatusFilter(status)}
                  className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
                    statusFilter === status
                      ? "bg-[var(--primary)] text-white"
                      : "text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--text)]"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4 overflow-hidden rounded-3xl border border-[var(--border)]">
            <div className="hidden grid-cols-[1.1fr_0.55fr_0.9fr_1.2fr_0.8fr_1fr] bg-[var(--card)] px-4 py-3 text-xs font-black uppercase tracking-[0.16em] text-[var(--muted)] xl:grid">
              <span>{t("branches.tableHeaders.branch")}</span>
              <span>{t("branches.tableHeaders.code")}</span>
              <span>{t("branches.tableHeaders.manager")}</span>
              <span>{t("branches.tableHeaders.address")}</span>
              <span>{t("branches.tableHeaders.warehouse")}</span>
              <span>{t("branches.tableHeaders.actions")}</span>
            </div>

            <div className="divide-y divide-[var(--border)] bg-[var(--bg)]">
              {loading ? (
                <div className="p-10 text-center text-sm font-semibold text-[var(--muted)]">{t("branches.empty.loading")}</div>
              ) : filteredBranches.length === 0 ? (
                <div className="m-4 rounded-3xl border border-[var(--border)] bg-[radial-gradient(circle_at_top,_color-mix(in_srgb,var(--primary)_16%,transparent),transparent_55%),var(--surface)] p-10 text-center shadow-xl shadow-[var(--shadow)]">
                  <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl border border-[var(--border)] bg-[var(--card)] text-[var(--primary)]">
                    <Building2 className="h-8 w-8" />
                  </div>
                  <h3 className="mt-4 text-xl font-black text-[var(--text)]">{t("branches.empty.title")}</h3>
                  <button
                    type="button"
                    onClick={openCreateModal}
                    className="mt-5 inline-flex items-center justify-center gap-2 rounded-2xl bg-[var(--primary)] px-5 py-3 text-sm font-black text-white shadow-xl shadow-[var(--shadow)] transition hover:-translate-y-0.5 hover:brightness-110"
                  >
                    <Plus className="h-4 w-4" />
                    {t("branches.create")}
                  </button>
                </div>
              ) : (
                filteredBranches.map((branch) => (
                  <BranchRow
                    key={branch.id}
                    branch={branch}
                    t={t}
                    busy={saving || deleting}
                    onView={setViewBranch}
                    onEdit={openEditModal}
                    onDelete={setDeleteTarget}
                  />
                ))
              )}
            </div>
          </div>
        </section>
      </div>

      {modalOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 px-4 py-6 backdrop-blur-sm lg:items-center">
          <div className="w-full max-w-3xl rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-2xl shadow-black/50">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-xs font-black uppercase tracking-[0.18em] text-[var(--primary)]">
                  {editingBranch ? t("branches.edit") : t("branches.create")}
                </div>
                <h2 className="mt-2 text-2xl font-black text-[var(--text)]">
                  {editingBranch ? editingBranch.name : t("branches.new")}
                </h2>
                <p className="mt-1 text-sm text-[var(--muted)]">
                  {editingBranch ? t("branches.updateHint") : t("branches.createHint")}
                </p>
              </div>
              <button
                type="button"
                onClick={closeBranchModal}
                disabled={saving}
                className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-3 text-[var(--text)] transition hover:bg-[var(--bg)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-5 grid gap-3 md:grid-cols-2">
              <Field label={t("branches.form.name")} value={form.name} onChange={(value) => setForm((prev) => ({ ...prev, name: value }))} required />
              <Field label={t("branches.form.code")} value={form.code} onChange={(value) => setForm((prev) => ({ ...prev, code: value }))} />
              <Field label={t("branches.form.phone")} value={form.phone} onChange={(value) => setForm((prev) => ({ ...prev, phone: value }))} />
              <Field label={t("branches.form.manager")} value={form.manager} onChange={(value) => setForm((prev) => ({ ...prev, manager: value }))} />
              <Field label={t("branches.form.address")} value={form.address} onChange={(value) => setForm((prev) => ({ ...prev, address: value }))} />
              <Field label={t("branches.form.notes")} value={form.notes} onChange={(value) => setForm((prev) => ({ ...prev, notes: value }))} textarea className="md:col-span-2" />
              <Field
                label={t("branches.form.defaultWarehouseId")}
                type="number"
                value={form.default_warehouse_id}
                onChange={(value) => setForm((prev) => ({ ...prev, default_warehouse_id: value }))}
              />
              <label className="md:col-span-2">
                <div className="mb-2 text-[11px] font-black uppercase tracking-[0.16em] text-[var(--muted)]">{t("branches.form.activeStatus")}</div>
                <select
                  value={form.is_active ? "active" : "inactive"}
                  onChange={(event) => setForm((prev) => ({ ...prev, is_active: event.target.value === "active" }))}
                  className="w-full rounded-2xl border border-[var(--border)] bg-[var(--card)] px-4 py-3 text-sm font-semibold text-[var(--text)] outline-none"
                >
                  <option value="active">{t("branches.status.active")}</option>
                  <option value="inactive">{t("branches.status.inactive")}</option>
                </select>
              </label>
            </div>

            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={closeBranchModal}
                disabled={saving}
                className="rounded-2xl border border-[var(--border)] bg-[var(--card)] px-4 py-3 text-sm font-semibold text-[var(--text)] transition hover:bg-[var(--bg)]"
              >
                {t("branches.buttons.cancel")}
              </button>
              <button
                type="button"
                onClick={saveBranch}
                disabled={saving || !form.name.trim()}
                className="rounded-2xl bg-[var(--primary)] px-4 py-3 text-sm font-black text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving ? t("branches.buttons.saving") : editingBranch ? t("branches.buttons.update") : t("branches.buttons.save")}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {viewBranch ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 px-4 py-6 backdrop-blur-sm lg:items-center">
          <div className="w-full max-w-2xl rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-2xl shadow-black/50">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-xs font-black uppercase tracking-[0.18em] text-[var(--primary)]">{t("branches.view")}</div>
                <h2 className="mt-2 text-2xl font-black text-[var(--text)]">{viewBranch.name || t("branches.row.unassigned")}</h2>
                <StatusBadge status={viewBranch.is_active === false ? t("branches.status.inactive") : t("branches.status.active")} active={viewBranch.is_active !== false} />
              </div>
              <button
                type="button"
                onClick={() => setViewBranch(null)}
                className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-3 text-[var(--text)] transition hover:bg-[var(--bg)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <Detail label={t("branches.form.code")} value={viewBranch.code || t("branches.row.notSet")} />
              <Detail label={t("branches.form.phone")} value={viewBranch.phone || t("branches.row.noPhone")} />
              <Detail label={t("branches.form.manager")} value={viewBranch.manager || t("branches.row.unassigned")} />
              <Detail label={t("branches.form.defaultWarehouseId")} value={viewBranch.default_warehouse_id || t("branches.row.notSet")} />
              <Detail label={t("branches.form.address")} value={viewBranch.address || t("branches.row.noAddress")} className="sm:col-span-2" />
              <Detail label={t("branches.form.notes")} value={viewBranch.notes || t("branches.row.noNotes")} className="sm:col-span-2" />
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setViewBranch(null);
                  openEditModal(viewBranch);
                }}
                className="inline-flex items-center gap-2 rounded-2xl bg-[var(--primary)] px-4 py-3 text-sm font-black text-white transition hover:brightness-110"
              >
                <Edit3 className="h-4 w-4" />
                {t("branches.buttons.edit")}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {deleteTarget ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 px-4 py-6 backdrop-blur-sm lg:items-center">
          <div className="w-full max-w-lg rounded-3xl border border-red-500/20 bg-[var(--surface)] p-5 shadow-2xl shadow-black/50">
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-red-500/20 bg-red-500/10 text-red-200">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div>
                <div className="text-xs font-black uppercase tracking-[0.18em] text-red-300">{t("branches.confirm.title")}</div>
                <h2 className="mt-2 text-2xl font-black text-[var(--text)]">{deleteTarget.name}</h2>
                <p className="mt-2 text-sm text-[var(--muted)]">
                  {t("branches.confirm.subtitle")}
                </p>
              </div>
            </div>

            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
                className="rounded-2xl border border-[var(--border)] bg-[var(--card)] px-4 py-3 text-sm font-semibold text-[var(--text)] transition hover:bg-[var(--bg)] disabled:opacity-50"
              >
                {t("branches.buttons.cancel")}
              </button>
              <button
                type="button"
                onClick={deleteBranch}
                disabled={deleting}
                className="rounded-2xl bg-red-500 px-4 py-3 text-sm font-black text-white transition hover:bg-red-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {deleting ? t("branches.buttons.archiving") : t("branches.buttons.archive")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function BranchRow({ branch, t, busy, onView, onEdit, onDelete }) {
  const status = branch.is_active === false ? "Inactive" : "Active";

  return (
    <div className="grid gap-4 px-4 py-4 text-sm transition hover:bg-[var(--card)] hover:shadow-inner xl:grid-cols-[1.1fr_0.55fr_0.9fr_1.2fr_0.8fr_1fr] xl:items-center">
      <div className="flex items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-emerald-400/20 bg-emerald-400/10 text-emerald-300">
          <Building2 className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <div className="truncate font-black text-[var(--text)]">{branch.name || t("branches.row.unassigned")}</div>
          <div className="mt-1 flex items-center gap-1 text-xs text-[var(--muted)]">
            <MapPin className="h-3.5 w-3.5" />
            {branch.phone || t("branches.row.noPhone")}
          </div>
          <StatusBadge status={status === "Active" ? t("branches.status.active") : t("branches.status.inactive")} active={status === "Active"} />
        </div>
      </div>
      <div className="font-semibold text-[var(--text)]">{branch.code || "-"}</div>
      <div className="text-[var(--muted)]">{branch.manager || t("branches.row.unassigned")}</div>
      <div className="text-[var(--muted)]">{branch.address || t("branches.row.noAddress")}</div>
      <div className="inline-flex items-center gap-2 text-[var(--text)]">
        <Warehouse className="h-4 w-4 text-[var(--primary)]" />
        {branch.default_warehouse_id || t("branches.row.notSet")}
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onView(branch)}
          disabled={busy}
          className="inline-flex w-fit items-center gap-2 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs font-black text-emerald-100 transition hover:bg-emerald-500/20 disabled:opacity-50"
        >
          <Eye className="h-3.5 w-3.5" />
          {t("branches.buttons.view")}
        </button>
        <button
          type="button"
          onClick={() => onEdit(branch)}
          disabled={busy}
          className="inline-flex w-fit items-center gap-2 rounded-2xl border border-blue-500/20 bg-blue-500/10 px-3 py-2 text-xs font-black text-blue-100 transition hover:bg-blue-500/20 disabled:opacity-50"
        >
          <Edit3 className="h-3.5 w-3.5" />
          {t("branches.buttons.edit")}
        </button>
        <button
          type="button"
          onClick={() => onDelete(branch)}
          disabled={busy || branch.is_active !== true}
          className="inline-flex w-fit items-center gap-2 rounded-2xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs font-black text-red-200 transition hover:bg-red-500/20 disabled:opacity-50"
        >
          <Trash2 className="h-3.5 w-3.5" />
          {t("branches.buttons.archiveShort")}
        </button>
      </div>
    </div>
  );
}

function Kpi({ label, value, icon, tone = "zinc" }) {
  const tones = {
    emerald: "border-emerald-500/20 bg-emerald-500/10 text-emerald-300",
    cyan: "border-cyan-500/20 bg-cyan-500/10 text-cyan-300",
    zinc: "border-[var(--border)] bg-[var(--surface)] text-[var(--text)]",
  };
  return (
    <div className={`rounded-3xl border p-4 shadow-xl shadow-[var(--shadow)] ${tones[tone]}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="text-[11px] font-black uppercase tracking-[0.18em] text-[var(--muted)]">{label}</div>
        {icon}
      </div>
      <div className="mt-3 text-3xl font-black text-[var(--text)]">{value}</div>
    </div>
  );
}

function StatusBadge({ status, active }) {
  const isActive = typeof active === "boolean" ? active : status === "Active";
  return (
    <span
      className={`mt-2 inline-flex w-fit items-center rounded-full border px-2 py-0.5 text-[10px] font-black ${
        isActive
          ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-300"
          : "border-zinc-400/20 bg-zinc-400/10 text-zinc-300"
      }`}
    >
      {status}
    </span>
  );
}

function Field({ label, value, onChange, required = false, type = "text", textarea = false, className = "" }) {
  const controlClassName = "w-full rounded-2xl border border-[var(--border)] bg-[var(--card)] px-4 py-3 text-sm font-semibold text-[var(--text)] outline-none placeholder:text-[var(--muted)]";

  return (
    <label className={className}>
      <div className="mb-2 text-[11px] font-black uppercase tracking-[0.16em] text-[var(--muted)]">
        {label}
        {required ? <span className="text-[var(--primary)]"> *</span> : null}
      </div>
      {textarea ? (
        <textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          rows={3}
          className={`${controlClassName} resize-none`}
        />
      ) : (
        <input
          type={type}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={controlClassName}
        />
      )}
    </label>
  );
}

function Detail({ label, value, className = "" }) {
  return (
    <div className={`rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 ${className}`}>
      <div className="text-[11px] font-black uppercase tracking-[0.16em] text-[var(--muted)]">{label}</div>
      <div className="mt-2 whitespace-pre-wrap text-sm font-semibold text-[var(--text)]">{value}</div>
    </div>
  );
}

export default Branches;
