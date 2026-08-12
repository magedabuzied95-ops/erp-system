import { useEffect, useMemo, useState } from "react";

import {
  CheckCircle2,
  Layers3,
  Plus,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import toast from "react-hot-toast";

import ProductsShell from "../components/ProductsShell";

import { generateBarcode, generateSku, slugify } from "../lib/catalog";
import { api } from "../../../shared/api/api";
import { createVariant, normalizeVariantPayload } from "../services/productsApi";

const readFileAsDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

const ChipEditor = ({ label, placeholder, value, onChange, addLabel }) => {
  const [text, setText] = useState("");

  return (
    <div className="rounded-3xl border border-white/8 bg-white/5 p-5">
      <p className="text-xs uppercase tracking-[0.28em] text-zinc-500">{label}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        {value.map((item) => (
          <span key={item} className="rounded-full border border-white/10 bg-zinc-950 px-3 py-2 text-sm font-semibold text-white">
            {item}
          </span>
        ))}
      </div>
      <div className="mt-4 flex gap-3">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={placeholder}
          className="min-w-0 flex-1 rounded-2xl border border-white/8 bg-zinc-950 px-4 py-3 text-white outline-none placeholder:text-zinc-500"
        />
        <button
          type="button"
          onClick={() => {
            const next = text
              .split(",")
              .map((item) => item.trim())
              .filter(Boolean);
            onChange(Array.from(new Set([...value, ...next])));
            setText("");
          }}
          className="rounded-2xl bg-emerald-500 px-4 py-3 font-semibold text-white"
        >
          {addLabel}
        </button>
      </div>
    </div>
  );
};

function Variants() {
  const { t } = useTranslation();
  const [products, setProducts] = useState([]);
  const [variants, setVariants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedProduct, setSelectedProduct] = useState("");
  const [colors, setColors] = useState([]);
  const [sizes, setSizes] = useState([]);
  const [baseStock, setBaseStock] = useState("0");
  const [basePrice, setBasePrice] = useState("0");
  const [matrix, setMatrix] = useState([]);
  const [saving, setSaving] = useState(false);

  const loadData = async () => {
    try {
      setLoading(true);
      const [productsRes, variantsRes] = await Promise.all([
        api.get("/products"),
        api.get("/variants?limit=100&page=1"),
      ]);

      setProducts(Array.isArray(productsRes.products) ? productsRes.products : []);
      setVariants(Array.isArray(variantsRes.variants) ? variantsRes.variants : []);
    } catch (err) {
      console.log(err);
      toast.error(t("products.variantMessages.loadFailed"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const selectedProductName = useMemo(
    () => products.find((product) => String(product.id) === String(selectedProduct))?.name || "",
    [products, selectedProduct]
  );

  const buildMatrix = () => {
    if (!selectedProduct || !colors.length || !sizes.length) {
      toast.error(t("products.variantMessages.selectInputs"));
      return;
    }

    const next = colors.flatMap((color, colorIndex) =>
      sizes.map((size, sizeIndex) => ({
        key: `${selectedProduct}-${color}-${size}-${colorIndex}-${sizeIndex}`,
        color,
        size,
        sku: `${generateSku(selectedProductName || "PRD", selectedProduct)}-${slugify(color)}-${size}`,
        barcode: generateBarcode(),
        stock: Number(baseStock || 0),
        price: Number(basePrice || 0),
        image_url: "",
      }))
    );

    setMatrix(next);
  };

  const updateMatrixItem = (key, field, value) => {
    setMatrix((prev) => prev.map((item) => (item.key === key ? { ...item, [field]: value } : item)));
  };

  const saveMatrix = async () => {
    if (!selectedProduct || matrix.length === 0) {
      toast.error(t("products.variantMessages.generateFirst"));
      return;
    }

    try {
      setSaving(true);
      const results = await Promise.allSettled(
        matrix.map((item) =>
          createVariant(
            selectedProduct,
            normalizeVariantPayload({
              color: item.color,
              size: item.size,
              stock: item.stock,
              price: item.price,
              sku: item.sku,
              image_url: item.image_url || "",
            })
          )
        )
      );

      const failed = results.filter((item) => item.status === "rejected");
      if (failed.length > 0) {
        console.warn(
          "[products:variants] matrix save warnings:",
          failed.map((item) => item.reason?.message || item.reason)
        );
        toast.error(t("products.variantMessages.partialSave", { count: failed.length }));
      } else {
        toast.success(t("products.variantMessages.matrixSaved"));
      }
      setMatrix([]);
      await loadData();
    } catch (err) {
      console.log(err);
      toast.error(t("products.variantMessages.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const removeVariant = async (id) => {
    if (!window.confirm(t("products.variantMessages.confirmDelete"))) return;

    try {
      await api.delete(`/products/variants/${id}`);
      toast.success(t("products.variantMessages.deleted"));
      await loadData();
    } catch (err) {
      console.log(err);
      toast.error(t("products.variantMessages.deleteFailed"));
    }
  };

  const filteredVariants = variants.filter((variant) =>
    `${variant.product_name || ""} ${variant.color || ""} ${variant.size || ""} ${variant.sku || ""}`
      .toLowerCase()
      .includes(search.trim().toLowerCase())
  );

  return (
    <ProductsShell
      title={t("products.variantPage.title")}
      description={t("products.variantPage.description")}
    >
      <div className="grid min-w-0 grid-cols-1 gap-6 xl:grid-cols-12">
        <section className="min-w-0 rounded-[34px] border border-white/8 bg-zinc-950/80 p-6 xl:col-span-4">
          <div className="flex items-center gap-3">
            <Layers3 className="text-emerald-400" />
            <h2 className="m1-section-title text-white">{t("products.variantPage.matrixBuilder")}</h2>
          </div>

          <div className="mt-5 space-y-4">
            <select
              value={selectedProduct}
              onChange={(e) => setSelectedProduct(e.target.value)}
              className="w-full rounded-2xl border border-white/8 bg-white/5 px-4 py-3 text-white outline-none"
            >
              <option value="">{t("products.variantPage.selectProduct")}</option>
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name}
                </option>
              ))}
            </select>

            <ChipEditor
              label={t("products.variantPage.colors")}
              placeholder={t("products.variantPage.colorsPlaceholder")}
              value={colors}
              onChange={setColors}
              addLabel={t("products.variantPage.addChip")}
            />
            <ChipEditor
              label={t("products.variantPage.sizes")}
              placeholder={t("products.variantPage.sizesPlaceholder")}
              value={sizes}
              onChange={setSizes}
              addLabel={t("products.variantPage.addChip")}
            />

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-semibold text-zinc-300">{t("products.variantPage.baseStock")}</label>
                <input
                  type="number"
                  value={baseStock}
                  onChange={(e) => setBaseStock(e.target.value)}
                  className="mt-2 w-full rounded-2xl border border-white/8 bg-white/5 px-4 py-3 text-white outline-none"
                />
              </div>
              <div>
                <label className="text-sm font-semibold text-zinc-300">{t("products.variantPage.basePrice")}</label>
                <input
                  type="number"
                  value={basePrice}
                  onChange={(e) => setBasePrice(e.target.value)}
                  className="mt-2 w-full rounded-2xl border border-white/8 bg-white/5 px-4 py-3 text-white outline-none"
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={buildMatrix}
                className="inline-flex items-center gap-2 rounded-full bg-emerald-500 px-5 py-3 font-semibold text-white"
              >
                <Plus size={18} />
                {t("products.variantPage.buildMatrix")}
              </button>
              <button
                type="button"
                onClick={saveMatrix}
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-5 py-3 font-semibold text-white disabled:opacity-50"
              >
                <CheckCircle2 size={18} />
                {saving ? t("products.shared.saving") : t("products.variantPage.saveVariants")}
              </button>
            </div>
          </div>

          <div className="mt-6 rounded-3xl border border-white/8 bg-white/5 p-5">
            <p className="text-xs uppercase tracking-[0.28em] text-zinc-500">{t("products.variantPage.matrixRows")}</p>
            <p className="mt-2 text-3xl font-black text-white">{matrix.length}</p>
          </div>
        </section>

        <section className="min-w-0 rounded-[34px] border border-white/8 bg-zinc-950/80 p-6 xl:col-span-8">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="m1-section-title text-white">{t("products.variantPage.variantGrid")}</h2>
              <p className="mt-1 text-sm text-zinc-500">{t("products.variantPage.variantGridHelp")}</p>
            </div>
            <div className="relative min-w-0 max-w-sm flex-1">
              <Search className="pointer-events-none absolute start-4 top-1/2 -translate-y-1/2 text-zinc-500" size={18} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("products.variantPage.searchExisting")}
                className="w-full rounded-2xl border border-white/8 bg-white/5 py-3 ps-11 pe-4 text-white outline-none placeholder:text-zinc-500"
              />
            </div>
          </div>

          {matrix.length > 0 ? (
            <div className="m1-table-container mt-6 max-w-full overflow-x-auto">
              <table className="m1-table m1-table--compact m1-table--separate min-w-full border-separate">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-[0.22em] text-zinc-500">
                    <th className="px-4 py-2">{t("products.variantPage.color")}</th>
                    <th className="px-4 py-2">{t("products.variantPage.size")}</th>
                    <th className="px-4 py-2">{t("products.variantPage.sku")}</th>
                    <th className="px-4 py-2">{t("products.variantPage.barcode")}</th>
                    <th className="px-4 py-2">{t("products.variantPage.stock")}</th>
                    <th className="px-4 py-2">{t("products.variantPage.price")}</th>
                    <th className="px-4 py-2">{t("products.variantPage.image")}</th>
                  </tr>
                </thead>
                <tbody>
                  {matrix.map((item, index) => (
                    <tr key={`${item.key}-${index}`} className="rounded-3xl border border-white/8 bg-white/5">
                      <td className="px-4 py-4 font-semibold text-white">{item.color}</td>
                      <td className="px-4 py-4 font-semibold text-white">{item.size}</td>
                      <td className="px-4 py-4">
                        <input
                          value={item.sku}
                          onChange={(e) => updateMatrixItem(item.key, "sku", e.target.value)}
                          className="w-full rounded-2xl border border-white/8 bg-zinc-950 px-4 py-2 text-white outline-none"
                        />
                      </td>
                      <td className="px-4 py-4">
                        <input
                          value={item.barcode}
                          onChange={(e) => updateMatrixItem(item.key, "barcode", e.target.value)}
                          className="w-full rounded-2xl border border-white/8 bg-zinc-950 px-4 py-2 text-white outline-none"
                        />
                      </td>
                      <td className="px-4 py-4">
                        <input
                          type="number"
                          value={item.stock}
                          onChange={(e) => updateMatrixItem(item.key, "stock", e.target.value)}
                          className="w-24 rounded-2xl border border-white/8 bg-zinc-950 px-4 py-2 text-white outline-none"
                        />
                      </td>
                      <td className="px-4 py-4">
                        <input
                          type="number"
                          value={item.price}
                          onChange={(e) => updateMatrixItem(item.key, "price", e.target.value)}
                          className="w-28 rounded-2xl border border-white/8 bg-zinc-950 px-4 py-2 text-white outline-none"
                        />
                      </td>
                      <td className="px-4 py-4">
                        <label className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-white/8 bg-white/5 px-4 py-2 text-sm text-white">
                          <Upload size={16} />
                          {t("products.variantPage.upload")}
                          <input
                            type="file"
                            hidden
                            accept="image/*"
                            onChange={async (event) => {
                              const file = event.target.files?.[0];
                              if (!file) return;
                              updateMatrixItem(item.key, "image_url", await readFileAsDataUrl(file));
                            }}
                          />
                        </label>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
              <div className="mt-6 rounded-3xl border border-white/8 bg-white/5 p-8 text-center text-zinc-400">
              {t("products.variantPage.empty")}
            </div>
          )}

          <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
            {filteredVariants.map((variant, index) => (
              <div
                key={`${variant.product_id || "product"}-${variant.id || variant.variant_id || "variant"}-${variant.color || "default"}-${variant.size || "size"}-${index}`}
                className="rounded-[30px] border border-white/8 bg-white/5 p-5"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">
                      {variant.product_name}
                    </p>
                    <h3 className="m1-section-title mt-1 text-white">
                      {variant.color} / {variant.size}
                    </h3>
                    <p className="mt-2 font-mono text-sm text-zinc-500">{variant.sku}</p>
                  </div>
                  <button
                    onClick={() => removeVariant(variant.id)}
                    className="inline-flex h-[var(--control-height-md)] w-10 items-center justify-center rounded-full border border-white/8 bg-white/5 text-red-300"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>

                <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
                  <div className="rounded-2xl border border-white/8 bg-zinc-950 px-3 py-3">
                      <p className="text-zinc-500">{t("products.variantPage.stock")}</p>
                    <p className="mt-1 font-semibold text-white">{variant.stock}</p>
                  </div>
                  <div className="rounded-2xl border border-white/8 bg-zinc-950 px-3 py-3">
                      <p className="text-zinc-500">{t("products.variantPage.price")}</p>
                    <p className="mt-1 font-semibold text-white">{variant.price}</p>
                  </div>
                  <div className="rounded-2xl border border-white/8 bg-zinc-950 px-3 py-3">
                      <p className="text-zinc-500">{t("products.variantPage.barcode")}</p>
                    <p className="mt-1 font-semibold text-white">{variant.barcode || "N/A"}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </ProductsShell>
  );
}

export default Variants;
