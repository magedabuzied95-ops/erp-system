import { useMemo, useState } from "react";

import { Layers3, Plus, Search, Trash2, Upload } from "lucide-react";
import { useTranslation } from "react-i18next";

import ProductsShell from "../components/ProductsShell";

import {
  saveCategories,
  seedCategories,
  slugify,
} from "../lib/catalog";

const readFileAsDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

function CategoryNode({ item, level = 0, onDelete, items = [], t }) {
  const parent = items.find((entry) => String(entry.id) === String(item.parentId)) || null;
  const grandparent = parent?.parentId ? items.find((entry) => String(entry.id) === String(parent.parentId)) : null;
  const levelLabel = grandparent
    ? t("products.categories.childCategory")
    : parent
      ? t("products.categories.subCategory")
      : t("products.categories.mainCategory");

  return (
    <div
      className="rounded-3xl border border-white/8 bg-white/5 p-5"
      style={{ marginInlineStart: level * 18 }}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="h-14 w-14 overflow-hidden rounded-2xl border border-white/8 bg-zinc-950">
            {item.image ? <img src={item.image} alt={item.name} className="h-full w-full object-cover" /> : null}
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">
              {levelLabel}
            </p>
            <h3 className="mt-1 text-xl font-black text-white">{item.name}</h3>
            <p className="mt-2 text-sm text-zinc-400">{item.status}</p>
          </div>
        </div>

        <button
          onClick={() => onDelete(item.id)}
          className="inline-flex h-[var(--control-height-md)] w-10 items-center justify-center rounded-full border border-white/8 bg-white/5 text-red-300"
        >
          <Trash2 size={16} />
        </button>
      </div>

    </div>
  );
}

function Categories() {
  const { t } = useTranslation();
  const [items, setItems] = useState(() => seedCategories());
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState("");
  const [status, setStatus] = useState("active");
  const [image, setImage] = useState("");
  const [search, setSearch] = useState("");

  const filteredItems = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return items;
    return items.filter((item) => item.name.toLowerCase().includes(query));
  }, [items, search]);

  const handleUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setImage(await readFileAsDataUrl(file));
  };

  const handleCreate = () => {
    if (!name.trim()) return;
    const next = [
      ...items,
      {
        id: `cat-${slugify(name)}-${Date.now()}`,
        name: name.trim(),
        parentId: parentId || null,
        image,
        status,
      },
    ];
    setItems(next);
    saveCategories(next);
    setName("");
    setParentId("");
    setImage("");
    setStatus("active");
  };

  const handleDelete = (id) => {
    const next = items.filter((item) => item.id !== id && item.parentId !== id);
    setItems(next);
    saveCategories(next);
  };

  const renderTree = (parentId = null, level = 0) =>
    filteredItems
      .filter((item) => String(item.parentId || "") === String(parentId || ""))
      .map((item) => (
        <div key={item.id} className="space-y-3">
          <CategoryNode item={item} level={level} onDelete={handleDelete} items={items} t={t} />
          {renderTree(item.id, level + 1)}
        </div>
      ));

  return (
    <ProductsShell
      title={t("products.categories.title")}
      description={t("products.categories.description")}
    >
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <section className="rounded-[34px] border border-white/8 bg-zinc-950/80 p-6 xl:col-span-4">
          <div className="flex items-center gap-3">
            <Layers3 className="text-emerald-400" />
            <h2 className="text-2xl font-black text-white">{t("products.categories.editor")}</h2>
          </div>

          <div className="mt-5 space-y-4">
            <div className="relative">
              <Search className="pointer-events-none absolute start-4 top-1/2 -translate-y-1/2 text-zinc-500" size={18} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("products.categories.searchPlaceholder")}
                className="w-full rounded-2xl border border-white/8 bg-white/5 py-3 ps-11 pe-4 text-white outline-none placeholder:text-zinc-500"
              />
            </div>

            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("products.categories.namePlaceholder")}
              className="w-full rounded-2xl border border-white/8 bg-white/5 px-4 py-3 text-white outline-none placeholder:text-zinc-500"
            />

            <select
              value={parentId}
              onChange={(e) => setParentId(e.target.value)}
              className="w-full rounded-2xl border border-white/8 bg-white/5 px-4 py-3 text-white outline-none"
            >
              <option value="">{t("products.categories.mainCategory")}</option>
              {items.map((item) => (
                <option key={item.id} value={item.id}>
                  {t("products.categories.childOf", { name: item.name })}
                </option>
              ))}
            </select>

            <div className="flex items-center gap-3">
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="w-full rounded-2xl border border-white/8 bg-white/5 px-4 py-3 text-white outline-none"
              >
                <option value="active">{t("products.statusLabels.active")}</option>
                <option value="inactive">{t("products.statusLabels.inactive")}</option>
              </select>

              <label className="inline-flex cursor-pointer items-center justify-center rounded-2xl border border-white/8 bg-white/5 px-4 py-3 text-white">
                <Upload size={18} />
                <input type="file" hidden accept="image/*" onChange={handleUpload} />
              </label>
            </div>

            {image ? <img src={image} alt={t("products.categories.previewAlt")} className="h-44 w-full rounded-[28px] object-cover" /> : null}

            <button
              onClick={handleCreate}
              className="inline-flex items-center gap-2 rounded-full bg-emerald-500 px-5 py-3 font-semibold text-white"
            >
              <Plus size={18} />
              {t("products.categories.saveCategory")}
            </button>
          </div>
        </section>

        <section className="rounded-[34px] border border-white/8 bg-zinc-950/80 p-6 xl:col-span-8">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-2xl font-black text-white">{t("products.categories.nestedCatalog")}</h2>
              <p className="mt-1 text-sm text-zinc-500">
                {t("products.categories.nestedCatalogDescription")}
              </p>
            </div>
            <div className="rounded-full border border-white/8 bg-white/5 px-4 py-2 text-sm font-semibold text-zinc-300">
              {t("products.categories.count", { count: items.length })}
            </div>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-4">
            {renderTree()}
          </div>
        </section>
      </div>
    </ProductsShell>
  );
}

export default Categories;
