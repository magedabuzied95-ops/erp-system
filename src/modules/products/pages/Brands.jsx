import { useEffect, useMemo, useRef, useState } from "react";

import { BadgeCheck, ImageIcon, Pencil, Plus, Save, Search, Trash2, Upload, X } from "lucide-react";

import toast from "react-hot-toast";

import ProductsShell from "../components/ProductsShell";
import {
  createBrand,
  deleteBrand,
  getBrands,
  updateBrand,
  uploadProductImage,
} from "../services/productsApi";
import { resolveProductImageUrl } from "../../../shared/lib/imageUrls";

const emptyForm = {
  name: "",
  status: "active",
  logo_url: "",
};

const getBrandLogo = (brand = {}) => brand.logo_url || brand.image_url || brand.logo || brand.brand_logo || "";

const getErrorMessage = (error, fallback) =>
  error?.responseBody?.message ||
  error?.response?.data?.message ||
  error?.data?.message ||
  error?.message ||
  fallback;

function Brands() {
  const [items, setItems] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [logoPreviewUrl, setLogoPreviewUrl] = useState("");
  const fileInputRef = useRef(null);

  const loadItems = async () => {
    try {
      const rows = await getBrands();
      setItems(Array.isArray(rows) ? rows : []);
    } catch (error) {
      console.log(error);
      toast.error(getErrorMessage(error, "Failed to load brands"));
    }
  };

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const rows = await getBrands();
        if (!active) return;
        setItems(Array.isArray(rows) ? rows : []);
      } catch (error) {
        console.log(error);
        toast.error(getErrorMessage(error, "Failed to load brands"));
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return items;
    return items.filter((item) =>
      [item.name, item.status, item.id]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query)
    );
  }, [items, search]);

  const resetForm = () => {
    setForm(emptyForm);
    setEditingId(null);
    setLogoPreviewUrl("");
  };

  const handleEdit = (item) => {
    setEditingId(item.id);
    setForm({
      name: item.name || "",
      status: item.status === "inactive" ? "inactive" : "active",
      logo_url: getBrandLogo(item),
    });
    setLogoPreviewUrl("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleUpload = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    const allowedTypes = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);
    if (!allowedTypes.has(file.type)) {
      toast.error("Please upload a JPG, PNG, or WEBP logo");
      return;
    }

    const localPreview = URL.createObjectURL(file);
    setLogoPreviewUrl(localPreview);

    try {
      setUploading(true);
      const uploaded = await uploadProductImage(file);
      const uploadedUrl =
        uploaded?.url ||
        uploaded?.imageUrl ||
        uploaded?.data?.url ||
        uploaded?.data?.imageUrl ||
        "";

      if (!uploadedUrl) {
        throw new Error("Upload did not return an image URL");
      }

      setForm((prev) => ({ ...prev, logo_url: uploadedUrl }));
      setLogoPreviewUrl("");
      toast.success("Logo uploaded");
    } catch (error) {
      console.log(error);
      setLogoPreviewUrl("");
      toast.error(getErrorMessage(error, "Failed to upload logo"));
    } finally {
      setUploading(false);
      URL.revokeObjectURL(localPreview);
    }
  };

  const openLogoPicker = () => {
    if (uploading) return;
    fileInputRef.current?.click();
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!form.name.trim()) {
      toast.error("Brand name is required");
      return;
    }

    try {
      setSaving(true);
      const payload = {
        name: form.name.trim(),
        status: form.status,
        logo_url: form.logo_url,
      };

      if (editingId) {
        await updateBrand(editingId, payload);
        toast.success("Brand updated");
      } else {
        await createBrand(payload);
        toast.success("Brand created");
      }

      await loadItems();
      resetForm();
    } catch (error) {
      console.log(error);
      toast.error(getErrorMessage(error, "Failed to save brand"));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (event, item) => {
    event.stopPropagation();
    if (!window.confirm(`Delete brand "${item.name}"?`)) return;

    try {
      await deleteBrand(item.id);
      toast.success("Brand deleted");
      if (String(editingId) === String(item.id)) resetForm();
      await loadItems();
    } catch (error) {
      console.log(error);
      toast.error(getErrorMessage(error, "Failed to delete brand"));
    }
  };

  return (
    <ProductsShell
      title="Brands"
      description="Manage the brand registry with logos, status tracking, and fast lookup across the catalog."
    >
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <section className="rounded-[34px] border border-white/8 bg-zinc-950/80 p-6 xl:col-span-4">
          <div className="flex items-center gap-3">
            <BadgeCheck className="text-blue-400" />
            <div>
              <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Brand editor</p>
              <h2 className="mt-1 text-2xl font-black text-white">{editingId ? "Edit brand" : "Add brand"}</h2>
            </div>
          </div>

          <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
            <div className="relative">
              <Search className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500" size={18} />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search brands..."
                className="w-full rounded-2xl border border-white/8 bg-white/5 py-3 pl-11 pr-4 text-white outline-none placeholder:text-zinc-500"
              />
            </div>

            <input
              value={form.name}
              onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
              placeholder="Brand name"
              className="w-full rounded-2xl border border-white/8 bg-white/5 px-4 py-3 text-white outline-none placeholder:text-zinc-500"
            />

            <div className="flex items-center gap-3">
              <select
                value={form.status}
                onChange={(event) => setForm((prev) => ({ ...prev, status: event.target.value }))}
                className="w-full rounded-2xl border border-white/8 bg-white/5 px-4 py-3 text-white outline-none"
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>

              <button
                type="button"
                onClick={openLogoPicker}
                disabled={uploading}
                className="inline-flex cursor-pointer items-center justify-center rounded-2xl border border-white/8 bg-white/5 px-4 py-3 text-white transition hover:bg-white/10 disabled:opacity-60"
                title="Upload Logo"
              >
                <Upload size={18} />
              </button>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              hidden
              accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
              onChange={handleUpload}
            />

            <button
              type="button"
              onClick={openLogoPicker}
              disabled={uploading}
              className="flex min-h-44 w-full cursor-pointer flex-col items-center justify-center gap-3 overflow-hidden rounded-[28px] border border-dashed border-white/12 bg-white/5 p-4 text-center transition hover:border-emerald-400/50 hover:bg-white/8 disabled:cursor-wait disabled:opacity-70"
            >
              {logoPreviewUrl || form.logo_url ? (
                <img
                  src={logoPreviewUrl || resolveProductImageUrl(form.logo_url)}
                  alt="Brand logo preview"
                  className="max-h-28 max-w-full object-contain"
                />
              ) : (
                <div className="flex flex-col items-center gap-2 text-zinc-500">
                  <ImageIcon size={28} />
                  <span className="text-sm font-semibold">No logo selected</span>
                </div>
              )}
              <span className="inline-flex items-center gap-2 rounded-full border border-white/8 bg-zinc-950/80 px-4 py-2 text-sm font-semibold text-white">
                <Upload size={16} />
                {uploading ? "Uploading..." : "Upload Logo"}
              </span>
              <span className="text-xs text-zinc-500">JPG, PNG, or WEBP</span>
            </button>

            <div className="flex flex-wrap gap-3">
              <button
                type="submit"
                disabled={saving || uploading}
                className="inline-flex items-center gap-2 rounded-full bg-emerald-500 px-5 py-3 font-semibold text-black transition hover:bg-emerald-400 disabled:opacity-60"
              >
                {editingId ? <Save size={18} /> : <Plus size={18} />}
                {saving ? "Saving..." : editingId ? "Update brand" : "Save brand"}
              </button>
              {editingId ? (
                <button
                  type="button"
                  onClick={resetForm}
                  className="inline-flex items-center gap-2 rounded-full border border-white/8 bg-white/5 px-5 py-3 font-semibold text-zinc-300 transition hover:bg-white/10"
                >
                  <X size={18} />
                  Cancel edit
                </button>
              ) : null}
            </div>
          </form>
        </section>

        <section className="rounded-[34px] border border-white/8 bg-zinc-950/80 p-6 xl:col-span-8">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-2xl font-black text-white">Brand registry</h2>
              <p className="mt-1 text-sm text-zinc-500">Logos and active statuses for each brand.</p>
            </div>
            <div className="rounded-full border border-white/8 bg-white/5 px-4 py-2 text-sm font-semibold text-zinc-300">
              {loading ? "Loading..." : `${items.length} brands`}
            </div>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {filtered.map((item) => {
              const logoUrl = getBrandLogo(item);
              const isEditing = String(editingId) === String(item.id);
              return (
                <div
                  key={item.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleEdit(item)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") handleEdit(item);
                  }}
                  className={`rounded-[30px] border p-5 text-left transition hover:bg-white/8 ${
                    isEditing ? "border-emerald-400/60 bg-emerald-500/10" : "border-white/8 bg-white/5"
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex min-w-0 items-center gap-4">
                      <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-white/8 bg-zinc-950">
                        {logoUrl ? (
                          <img src={resolveProductImageUrl(logoUrl)} alt={item.name} className="h-full w-full object-contain p-1.5" />
                        ) : (
                          <ImageIcon className="text-zinc-600" size={24} />
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Brand</p>
                        <h3 className="mt-1 truncate text-xl font-black text-white">{item.name}</h3>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <span className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/8 bg-white/5 text-zinc-300">
                        <Pencil size={16} />
                      </span>
                      <button
                        type="button"
                        onClick={(event) => handleDelete(event, item)}
                        className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/8 bg-white/5 text-red-300"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>

                  <div className="mt-4 flex items-center justify-between">
                    <span
                      className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${
                        item.status === "active" ? "bg-emerald-500/15 text-emerald-300" : "bg-zinc-500/15 text-zinc-300"
                      }`}
                    >
                      {item.status}
                    </span>
                    <span className="text-sm text-zinc-500">ID {item.id}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </ProductsShell>
  );
}

export default Brands;
