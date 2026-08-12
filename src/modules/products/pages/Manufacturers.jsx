import { useEffect, useMemo, useState } from "react";

import { Factory, Pencil, Search, Save, Trash2, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import toast from "react-hot-toast";

import ProductsShell from "../components/ProductsShell";
import { Pagination } from "../../../shared/ui";
import {
  createManufacturer,
  deleteManufacturer,
  getManufacturers,
  updateManufacturer,
} from "../services/productsApi";

const emptyForm = {
  name: "",
  contactPerson: "",
  phone: "",
  email: "",
  address: "",
  country: "",
  notes: "",
  isActive: true,
};

const getErrorMessage = (error, fallback) =>
  error?.responseBody?.message ||
  error?.response?.data?.message ||
  error?.data?.message ||
  error?.message ||
  fallback;

function Manufacturers() {
  const { t } = useTranslation();
  const [items, setItems] = useState([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [form, setForm] = useState(emptyForm);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const rows = await getManufacturers();
        if (!active) return;
        setItems(Array.isArray(rows) ? rows : []);
      } catch (error) {
        console.log(error);
        toast.error(getErrorMessage(error, t("products.manufacturers.toasts.loadFailed")));
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  const loadItems = async () => {
    try {
      const rows = await getManufacturers();
      setItems(Array.isArray(rows) ? rows : []);
    } catch (error) {
      console.log(error);
      toast.error(getErrorMessage(error, t("products.manufacturers.toasts.loadFailed")));
    }
  };

  const filteredItems = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return items;
    return items.filter((item) =>
      [item.name, item.contact_person, item.contactPerson, item.phone, item.email, item.address, item.country, item.notes]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query)
    );
  }, [items, search]);
  const totalPages = Math.max(1, Math.ceil(filteredItems.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const visibleItems = filteredItems.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const resetForm = () => {
    setForm(emptyForm);
    setEditingId(null);
  };

  const handleChange = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!form.name.trim()) {
      toast.error(t("products.manufacturers.toasts.nameRequired"));
      return;
    }

    try {
      setSaving(true);
      const payload = {
        name: form.name.trim(),
        contact_person: form.contactPerson.trim(),
        phone: form.phone.trim(),
        email: form.email.trim(),
        address: form.address.trim(),
        country: form.country.trim(),
        notes: form.notes.trim(),
        is_active: form.isActive,
      };

      console.log("[manufacturers] payload:", payload);

      if (editingId) {
        await updateManufacturer(editingId, payload);
        toast.success(t("products.manufacturers.toasts.updated"));
      } else {
        await createManufacturer(payload);
        toast.success(t("products.manufacturers.toasts.created"));
      }

      await loadItems();
      resetForm();
    } catch (error) {
      console.log(error);
      toast.error(getErrorMessage(error, t("products.manufacturers.toasts.saveFailed")));
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (item) => {
    setEditingId(item.id);
    setForm({
      name: item.name || "",
      contactPerson: item.contact_person || item.contactPerson || "",
      phone: item.phone || "",
      email: item.email || "",
      address: item.address || "",
      country: item.country || "",
      notes: item.notes || "",
      isActive: item.is_active ?? item.isActive ?? true,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleDelete = async (item) => {
    if (!window.confirm(t("products.manufacturers.confirmDelete", { name: item.name }))) return;

    try {
      await deleteManufacturer(item.id);
      toast.success(t("products.manufacturers.toasts.deleted"));
      if (String(editingId) === String(item.id)) {
        resetForm();
      }
      await loadItems();
    } catch (error) {
      console.log(error);
      toast.error(getErrorMessage(error, t("products.manufacturers.toasts.deleteFailed")));
    }
  };

  return (
    <ProductsShell
      title={t("products.manufacturers.title")}
      description={t("products.manufacturers.description")}
    >
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <section className="rounded-[34px] border border-white/8 bg-zinc-950/80 p-6 shadow-[0_24px_80px_rgba(0,0,0,0.22)] xl:col-span-4">
          <div className="flex items-center gap-3">
            <Factory className="text-emerald-400" />
            <div>
              <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">
                {t("products.manufacturers.editor")}
              </p>
              <h2 className="m1-section-title mt-1 text-white">
                {editingId ? t("products.manufacturers.editManufacturer") : t("products.manufacturers.addManufacturer")}
              </h2>
            </div>
          </div>

          <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
            <Field label={t("products.manufacturers.name")} value={form.name} onChange={(value) => handleChange("name", value)} placeholder={t("products.manufacturers.namePlaceholder")} />
            <Field label={t("products.manufacturers.contactPerson")} value={form.contactPerson} onChange={(value) => handleChange("contactPerson", value)} placeholder={t("products.manufacturers.contactPlaceholder")} />
            <Field label={t("products.manufacturers.phone")} value={form.phone} onChange={(value) => handleChange("phone", value)} placeholder="+20 100 000 0000" />
            <Field label={t("products.manufacturers.email")} value={form.email} onChange={(value) => handleChange("email", value)} placeholder={t("products.manufacturers.emailPlaceholder")} />
            <Field label={t("products.manufacturers.address")} value={form.address} onChange={(value) => handleChange("address", value)} placeholder={t("products.manufacturers.addressPlaceholder")} />
            <Field label={t("products.manufacturers.country")} value={form.country} onChange={(value) => handleChange("country", value)} placeholder={t("products.manufacturers.countryPlaceholder")} />
            <label className="flex items-center justify-between gap-3 rounded-[var(--radius-card)] border border-white/8 bg-white/5 px-4 py-3 text-sm font-semibold text-zinc-300">
              {t("products.statusLabels.active")}
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) => handleChange("isActive", e.target.checked)}
                className="h-4 w-4 accent-emerald-500"
              />
            </label>
            <div>
              <label className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">{t("products.manufacturers.notes")}</label>
              <textarea
                value={form.notes}
                onChange={(e) => handleChange("notes", e.target.value)}
                rows={4}
                placeholder={t("products.manufacturers.notesPlaceholder")}
                className="mt-2 w-full rounded-[var(--radius-control)] border border-white/8 bg-white/5 px-4 py-3 text-white outline-none placeholder:text-zinc-500"
              />
            </div>

            <div className="flex flex-wrap gap-3 pt-2">
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-3 font-semibold text-black transition hover:bg-primary disabled:opacity-60"
              >
                <Save size={18} />
                {saving ? t("products.shared.saving") : editingId ? t("products.manufacturers.updateManufacturer") : t("products.manufacturers.saveManufacturer")}
              </button>
              {editingId ? (
                <button
                  type="button"
                  onClick={resetForm}
                  className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-5 py-3 font-semibold text-white transition hover:bg-white/10"
                >
                  <X size={18} />
                  {t("products.shared.cancel")}
                </button>
              ) : null}
            </div>
          </form>
        </section>

        <section className="rounded-[34px] border border-white/8 bg-zinc-950/80 p-6 shadow-[0_24px_80px_rgba(0,0,0,0.22)] xl:col-span-8">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">{t("products.manufacturers.registry")}</p>
              <h2 className="m1-section-title mt-1 text-white">{t("products.manufacturers.liveManufacturers")}</h2>
              <p className="mt-2 text-sm text-zinc-400">
                {t("products.manufacturers.registryDescription")}
              </p>
            </div>

            <div className="flex items-center gap-3">
              <div className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-zinc-300">
                {t("products.manufacturers.count", { count: items.length })}
              </div>
              <div className="relative w-full min-w-[18rem] lg:w-[22rem]">
                <Search className="pointer-events-none absolute start-4 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t("products.manufacturers.searchPlaceholder")}
                  className="w-full rounded-[var(--radius-control)] border border-white/8 bg-white/5 py-3 ps-11 pe-4 text-sm text-white outline-none placeholder:text-zinc-500"
                />
              </div>
            </div>
          </div>

          <div className="mt-6 overflow-hidden rounded-[28px] border border-white/8">
            <div className="m1-table-container overflow-x-auto">
              <table className="m1-table m1-table--compact min-w-full">
                <thead className="bg-white/5">
                  <tr className="text-left text-xs uppercase tracking-[0.18em] text-zinc-500">
                    <Th>{t("products.manufacturers.name")}</Th>
                    <Th>{t("products.manufacturers.contact")}</Th>
                    <Th>{t("products.manufacturers.phone")}</Th>
                    <Th>{t("products.manufacturers.email")}</Th>
                    <Th>{t("products.manufacturers.country")}</Th>
                    <Th>{t("products.manufacturers.address")}</Th>
                    <Th>{t("products.table.status")}</Th>
                    <Th>{t("products.manufacturers.created")}</Th>
                    <Th className="text-right">{t("products.table.actions")}</Th>
                  </tr>
                </thead>
                <tbody className="bg-zinc-950/60">
                  {loading ? (
                    <tr>
                      <td colSpan={9} className="px-5 py-12 text-center text-sm text-zinc-400">
                        {t("products.manufacturers.loading")}
                      </td>
                    </tr>
                  ) : filteredItems.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="px-5 py-12 text-center text-sm text-zinc-400">
                        {search ? t("products.manufacturers.noMatches") : t("products.manufacturers.empty")}
                      </td>
                    </tr>
                  ) : (
                    visibleItems.map((item) => (
                      <tr key={item.id} className="transition hover:bg-white/[0.03]">
                        <Td>
                          <div className="font-semibold text-white">{item.name}</div>
                        </Td>
                        <Td>
                          <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold text-zinc-300">
                            {item.contact_person || item.contactPerson || t("products.records.notAvailable")}
                          </span>
                        </Td>
                        <Td>{item.phone || t("products.records.notAvailable")}</Td>
                        <Td>{item.email || t("products.records.notAvailable")}</Td>
                        <Td>{item.country || t("products.records.notAvailable")}</Td>
                        <Td className="max-w-[18rem] truncate">{item.address || t("products.records.notAvailable")}</Td>
                        <Td>
                          <span className={item.is_active === false ? "text-zinc-500" : "text-emerald-300"}>
                            {item.is_active === false ? t("products.statusLabels.inactive") : t("products.statusLabels.active")}
                          </span>
                        </Td>
                        <Td>{item.created_at ? new Date(item.created_at).toLocaleDateString() : t("products.records.notAvailable")}</Td>
                        <Td>
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => handleEdit(item)}
                              className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
                            >
                              <Pencil size={16} />
                              {t("products.actionsMenu.edit")}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDelete(item)}
                              className="inline-flex h-[var(--control-height-md)] w-10 items-center justify-center rounded-full border border-white/10 bg-white/5 text-red-300 transition hover:bg-red-500/10"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </Td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
          <Pagination
            page={currentPage}
            pages={totalPages}
            total={filteredItems.length}
            pageSize={pageSize}
            visible={visibleItems.length}
            disabled={loading}
            onChange={setPage}
            onPageSizeChange={(value) => { setPageSize(value); setPage(1); }}
          />
        </section>
      </div>
    </ProductsShell>
  );
}

function Field({ label, value, onChange, placeholder = "" }) {
  return (
    <div>
      <label className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-2 w-full rounded-[var(--radius-control)] border border-white/8 bg-white/5 px-4 py-3 text-white outline-none placeholder:text-zinc-500"
      />
    </div>
  );
}

function Th({ children, className = "" }) {
  return <th className={`px-5 py-4 font-semibold ${className}`}>{children}</th>;
}

function Td({ children, className = "" }) {
  return <td className={`px-5 py-4 text-sm text-zinc-300 ${className}`}>{children}</td>;
}

export default Manufacturers;
