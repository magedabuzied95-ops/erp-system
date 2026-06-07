import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { Filter, Loader2, Package2, Search, Store, X } from "lucide-react";
import toast from "react-hot-toast";

import { getEmployeePortalProducts, requestEmployeeWarehousePick } from "../services/employeePortalProductsApi";

const text = (value = "") => String(value || "").trim();
const lower = (value = "") => text(value).toLowerCase();
const uniqueValues = (values = []) => [...new Set(values.map((value) => text(value)).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ar"));
const sizeSort = (a, b) => {
  const left = Number(a);
  const right = Number(b);
  if (Number.isFinite(left) && Number.isFinite(right)) return left - right;
  return String(a).localeCompare(String(b), "ar");
};
const stockLabel = (size = "", stock = 0) => `${Number(stock || 0)} أ— ${text(size) || "-"}`;
const formatTime = (value = new Date()) =>
  new Intl.DateTimeFormat("ar-EG", { hour: "2-digit", minute: "2-digit" }).format(value instanceof Date ? value : new Date(value));

const normalizeVariant = (variant = {}) => ({
  id: variant.variant_id ?? variant.id ?? null,
  variant_id: variant.variant_id ?? variant.id ?? null,
  product_id: variant.product_id ?? null,
  color: text(variant.color || ""),
  size: text(variant.size || ""),
  sku: text(variant.sku || ""),
  barcode: text(variant.barcode || ""),
  article_code: text(variant.article_code || ""),
  manufacturer_name: text(variant.manufacturer_name || ""),
  stock: Number(variant.stock || 0),
  price: Number(variant.price || 0),
  image_url: text(variant.image_url || variant.variant_image_url || ""),
});

const normalizeProduct = (product = {}) => {
  const variants = Array.isArray(product.variants) ? product.variants.map(normalizeVariant) : [];
  const colors = uniqueValues(variants.map((variant) => variant.color));
  const sizes = uniqueValues(variants.map((variant) => variant.size)).sort(sizeSort);
  const totalStock = variants.reduce((sum, variant) => sum + Math.max(0, Number(variant.stock || 0)), 0);
  const imageUrl =
    text(product.product_image_url) ||
    text(product.image_url) ||
    text(product.photo_url) ||
    text(product.thumbnail_url) ||
    text(product.image) ||
    text(variants.find((variant) => variant.image_url)?.image_url || "");

  return {
    ...product,
    id: product.id ?? product.product_id ?? null,
    product_id: product.product_id ?? product.id ?? null,
    name: text(product.name || product.product_name || ""),
    product_name: text(product.product_name || product.name || ""),
    article_code: text(product.article_code || ""),
    manufacturer_name: text(product.manufacturer_name || ""),
    category: text(product.category || ""),
    brand: text(product.brand || ""),
    gender: text(product.gender || ""),
    style: text(product.style || ""),
    sku: text(product.sku || ""),
    barcode: text(product.barcode || ""),
    image_url: imageUrl,
    product_image_url: imageUrl,
    total_stock: totalStock,
    stock: totalStock,
    colors,
    sizes,
    variants,
  };
};

const firstVariantForColor = (product = {}, color = "") =>
  (Array.isArray(product.variants) ? product.variants : []).find((variant) => text(variant.color) === text(color)) || null;

const findVariant = (product = {}, variantId = null, color = "", size = "") => {
  const variants = Array.isArray(product.variants) ? product.variants : [];
  if (variantId) {
    const byId = variants.find((variant) => String(variant.variant_id ?? variant.id ?? "") === String(variantId));
    if (byId) return byId;
  }
  if (color || size) {
    const byCombo = variants.find((variant) => text(variant.color) === text(color) && text(variant.size) === text(size));
    if (byCombo) return byCombo;
  }
  return variants.find((variant) => Number(variant.stock || 0) > 0) || variants[0] || null;
};

const buildListParams = ({ search, filters }) => {
  const params = { limit: 120 };
  const q = text(search);
  if (q) params.q = q;
  if (filters.category !== "all") params.category = filters.category;
  if (filters.brand !== "all") params.brand = filters.brand;
  if (filters.gender !== "all") params.gender = filters.gender;
  if (filters.style !== "all") params.style = filters.style;
  if (filters.color !== "all") params.color = filters.color;
  if (filters.size !== "all") params.size = filters.size;
  if (filters.inStockOnly) params.inStockOnly = 1;
  return params;
};

const buildLookupParams = (directLookup) => {
  const params = { limit: 20 };
  if (directLookup.productId) params.productId = directLookup.productId;
  if (directLookup.barcode) params.barcode = directLookup.barcode;
  if (directLookup.article) params.article = directLookup.article;
  return params;
};

function ProductBadge({ label, value }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-right">
      <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">{label}</div>
      <div className="mt-1 truncate text-sm font-bold text-slate-800">{value || "-"}</div>
    </div>
  );
}

function ProductCard({ product, active, onOpen }) {
  const colors = product.colors.slice(0, 3);
  const sizes = product.sizes.slice(0, 4);

  return (
    <button
      type="button"
      onClick={() => onOpen(product)}
      className={`flex w-full flex-row-reverse gap-3 rounded-3xl border bg-white p-3 text-right shadow-sm transition active:scale-[0.99] ${
        active ? "border-emerald-300 ring-2 ring-emerald-100" : "border-slate-200 hover:border-emerald-200 hover:shadow-md"
      }`}
    >
      <div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
        {product.image_url ? (
          <img
            src={product.image_url}
            alt={product.name}
            className="h-full w-full object-contain p-2"
            loading="lazy"
            onError={(event) => {
              event.currentTarget.style.display = "none";
            }}
          />
        ) : (
          <Package2 className="h-10 w-10 text-slate-300" />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-black text-slate-950">{product.name || "ظ…ظ†طھط¬"}</h3>
            <div className="mt-1 truncate text-[11px] font-semibold text-slate-500">
              {product.article_code ? `ظƒظˆط¯ ط§ظ„ط£ط±طھظƒظ„: ${product.article_code}` : "ظƒظˆط¯ ط§ظ„ط£ط±طھظƒظ„: -"}
            </div>
            <div className="mt-0.5 truncate text-[11px] font-semibold text-slate-500">
              {product.manufacturer_name ? `ط§ط³ظ… ط§ظ„ظ…طµظ†ط¹: ${product.manufacturer_name}` : "ط§ط³ظ… ط§ظ„ظ…طµظ†ط¹: -"}
            </div>
          </div>
          <div className="rounded-2xl bg-emerald-50 px-2.5 py-1 text-center">
            <div className="text-[10px] font-black uppercase tracking-[0.16em] text-emerald-700">ط§ظ„ظ…طھط§ط­</div>
            <div className="text-base font-black text-emerald-700">{Number(product.total_stock || 0)}</div>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {colors.map((color) => (
            <span key={color} className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-bold text-slate-600">
              {color}
            </span>
          ))}
          {product.colors.length > colors.length ? (
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-bold text-slate-500">
              +{product.colors.length - colors.length}
            </span>
          ) : null}
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {sizes.map((size) => {
            const stock = product.variants
              .filter((variant) => text(variant.size) === text(size))
              .reduce((sum, variant) => sum + Math.max(0, Number(variant.stock || 0)), 0);
            return (
              <span key={size} className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-black text-slate-700">
                {stockLabel(size, stock)}
              </span>
            );
          })}
          {!sizes.length ? (
            <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-bold text-slate-400">ظ„ط§ طھظˆط¬ط¯ ظ…ظ‚ط§ط³ط§طھ</span>
          ) : null}
        </div>
      </div>
    </button>
  );
}

function ProductPickerSheet({
  product,
  selectedColor,
  selectedSize,
  onSelectColor,
  onSelectSize,
  onClose,
  onCallWarehouse,
  loadingCall,
}) {
  if (!product) return null;

  const colorVariants = product.colors.length ? product.variants.filter((variant) => text(variant.color) === text(selectedColor)) : product.variants;
  const sizeOptions = (colorVariants.length ? colorVariants : product.variants)
    .reduce((acc, variant) => {
      const key = text(variant.size);
      if (!key) return acc;
      const existing = acc.find((item) => text(item.size) === key);
      if (existing) {
        existing.stock += Math.max(0, Number(variant.stock || 0));
        return acc;
      }
      acc.push({ size: key, stock: Math.max(0, Number(variant.stock || 0)) });
      return acc;
    }, [])
    .sort((a, b) => sizeSort(a.size, b.size));

  const activeVariant = findVariant(product, product.selectedVariantId, selectedColor, selectedSize);
  const activeStock = Number(activeVariant?.stock || 0);
  const canCall = Boolean(activeVariant && activeStock > 0);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 px-2 py-2 sm:items-center sm:px-4 sm:py-6">
      <div className="flex max-h-[94vh] w-full max-w-5xl flex-col overflow-hidden rounded-[1.5rem] border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div className="min-w-0">
            <div className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-600">ط§ظ„ظ…ظ†طھط¬ط§طھ</div>
            <h3 className="truncate text-base font-black text-slate-950">{product.name || "ظ…ظ†طھط¬"}</h3>
            <div className="mt-1 flex flex-wrap gap-2 text-[11px] font-semibold text-slate-500">
              <span>ظƒظˆط¯ ط§ظ„ط£ط±طھظƒظ„: {product.article_code || "-"}</span>
              <span>ط§ط³ظ… ط§ظ„ظ…طµظ†ط¹: {product.manufacturer_name || "-"}</span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid flex-1 gap-4 overflow-y-auto px-4 py-4 lg:grid-cols-[1.05fr_0.95fr]">
          <div className="rounded-[1.25rem] border border-slate-200 bg-slate-50 p-3">
            <div className="flex min-h-[16rem] items-center justify-center overflow-hidden rounded-[1rem] bg-white">
              {product.image_url ? (
                <img
                  src={product.image_url}
                  alt={product.name}
                  className="max-h-[20rem] w-full object-contain p-4"
                  loading="eager"
                  onError={(event) => {
                    event.currentTarget.style.display = "none";
                  }}
                />
              ) : (
                <Package2 className="h-20 w-20 text-slate-300" />
              )}
            </div>

            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <ProductBadge label="ط§ظ„ظ„ظˆظ†" value={selectedColor || "-"} />
              <ProductBadge label="ط§ظ„ظ…ظ‚ط§ط³" value={selectedSize ? stockLabel(selectedSize, activeStock) : "-"} />
              <ProductBadge label="ط§ظ„ط¨ط§ط¦ط¹" value={product.employeeName || "-"} />
              <ProductBadge label="ط§ظ„ظ…طھط§ط­" value={String(activeStock || 0)} />
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-[1.25rem] border border-slate-200 bg-white p-3">
              <div className="text-sm font-black text-slate-900">ط§ظ„ظ„ظˆظ†</div>
              <div className="mt-3 flex flex-wrap gap-2">
                {product.colors.length ? product.colors.map((color) => (
                  <button
                    key={color || "default"}
                    type="button"
                    onClick={() => onSelectColor(color)}
                    className={`min-h-11 rounded-full border px-4 py-2 text-sm font-black transition ${
                      text(selectedColor) === text(color)
                        ? "border-emerald-400 bg-emerald-500 text-white"
                        : "border-slate-200 bg-slate-50 text-slate-700"
                    }`}
                  >
                    {color}
                  </button>
                )) : (
                  <span className="text-sm font-semibold text-slate-500">ظ„ط§ طھظˆط¬ط¯ ط£ظ„ظˆط§ظ†</span>
                )}
              </div>
            </div>

            <div className="rounded-[1.25rem] border border-slate-200 bg-white p-3">
              <div className="text-sm font-black text-slate-900">ط§ظ„ظ…ظ‚ط§ط³</div>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {sizeOptions.length ? sizeOptions.map(({ size, stock }) => {
                  const disabled = Number(stock || 0) <= 0;
                  const active = text(selectedSize) === text(size);
                  return (
                    <button
                      key={size}
                      type="button"
                      onClick={() => onSelectSize(size)}
                      disabled={disabled}
                      className={`min-h-16 rounded-2xl border px-3 py-2 text-right transition ${
                        active
                          ? "border-emerald-400 bg-emerald-50 text-emerald-700"
                          : disabled
                            ? "cursor-not-allowed border-slate-200 bg-slate-50 text-slate-300"
                            : "border-slate-200 bg-white text-slate-800"
                      }`}
                    >
                      <div className="text-2xl font-black leading-none">{size}</div>
                      <div className="mt-1 text-[11px] font-semibold leading-none">ط§ظ„ظ…طھط§ط­: {Number(stock || 0)}</div>
                    </button>
                  );
                }) : (
                  <div className="text-sm font-semibold text-slate-500">ظ„ط§ طھظˆط¬ط¯ ظ…ظ‚ط§ط³ط§طھ</div>
                )}
              </div>
            </div>

            <div className="rounded-[1.25rem] border border-slate-200 bg-slate-50 p-3">
              <div className="grid gap-2 text-sm text-slate-700">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-black text-slate-500">ظƒظˆط¯ ط§ظ„ط£ط±طھظƒظ„</span>
                  <span className="truncate font-black text-slate-900">{product.article_code || "-"}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="font-black text-slate-500">ط§ط³ظ… ط§ظ„ظ…طµظ†ط¹</span>
                  <span className="truncate font-black text-slate-900">{product.manufacturer_name || "-"}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="font-black text-slate-500">ط§ظ„ظ„ظˆظ†</span>
                  <span className="truncate font-bold text-slate-900">{selectedColor || "-"}</span>
                </div>
              </div>

              <button
                type="button"
                onClick={onCallWarehouse}
                disabled={!canCall || loadingCall}
                className="mt-3 inline-flex min-h-12 w-full items-center justify-center rounded-2xl bg-emerald-500 px-4 py-3 text-sm font-black text-white transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loadingCall ? <Loader2 className="ml-2 h-4 w-4 animate-spin" /> : null}
                اطلب من المخزن
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function EmployeePortalProducts() {
  const { token } = useParams();
  const [searchParams] = useSearchParams();
  const queryKey = searchParams.toString();

  const directLookup = useMemo(
    () => ({
      productId: text(searchParams.get("productId") || searchParams.get("product_id") || ""),
      barcode: text(searchParams.get("barcode") || ""),
      article: text(searchParams.get("article") || searchParams.get("article_code") || searchParams.get("articleCode") || ""),
    }),
    [queryKey]
  );

  const [employee, setEmployee] = useState(null);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [filters, setFilters] = useState({
    category: "all",
    brand: "all",
    gender: "all",
    style: "all",
    color: "all",
    size: "all",
    inStockOnly: false,
  });
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [selectedColor, setSelectedColor] = useState("");
  const [selectedSize, setSelectedSize] = useState("");
  const [selectedVariantId, setSelectedVariantId] = useState(null);
  const [loadingCall, setLoadingCall] = useState(false);
  const lookupDoneRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const timeoutId = window.setTimeout(async () => {
      try {
        setLoading(true);
        setError("");
        const response = await getEmployeePortalProducts(token, buildListParams({ search: deferredSearch, filters }));
        if (cancelled) return;
        setProducts((Array.isArray(response?.products) ? response.products : []).map(normalizeProduct));
        setEmployee(response?.employee || null);
      } catch (err) {
        if (cancelled) return;
        setError(err?.responseBody?.message_ar || err?.responseBody?.message || err?.message || "طھط¹ط°ط± طھط­ظ…ظٹظ„ ط§ظ„ظ…ظ†طھط¬ط§طھ");
        setProducts([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 220);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [token, deferredSearch, filters.category, filters.brand, filters.gender, filters.style, filters.color, filters.size, filters.inStockOnly]);

  useEffect(() => {
    lookupDoneRef.current = false;
    setSelectedProduct(null);
    setSelectedVariantId(null);
    setSelectedColor("");
    setSelectedSize("");
  }, [token, queryKey]);

  useEffect(() => {
    if (lookupDoneRef.current) return;
    if (!directLookup.productId && !directLookup.barcode && !directLookup.article) return;

    let cancelled = false;
    (async () => {
      try {
        const response = await getEmployeePortalProducts(token, buildLookupParams(directLookup));
        if (cancelled) return;
        const lookupProducts = (Array.isArray(response?.products) ? response.products : []).map(normalizeProduct);
        const selection = response?.selection || {};
        const matched =
          lookupProducts.find((product) => String(product.id) === String(selection.product_id || "")) ||
          lookupProducts[0] ||
          null;

        if (matched) {
          const variant = findVariant(matched, selection.variant_id, selection.color, selection.size);
          setSelectedProduct({ ...matched, employeeName: employee?.full_name || employee?.name || "" });
          setSelectedVariantId(variant?.variant_id ?? variant?.id ?? null);
          setSelectedColor(variant?.color || matched.colors[0] || "");
          setSelectedSize(variant?.size || matched.sizes[0] || "");
        }
      } finally {
        lookupDoneRef.current = true;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token, directLookup.productId, directLookup.barcode, directLookup.article, employee?.full_name, employee?.name]);

  const normalizedProducts = useMemo(() => (Array.isArray(products) ? products : []).map(normalizeProduct), [products]);
  const filterOptions = useMemo(() => {
    const categories = uniqueValues(normalizedProducts.map((product) => product.category));
    const brands = uniqueValues(normalizedProducts.map((product) => product.brand));
    const genders = uniqueValues(normalizedProducts.map((product) => product.gender));
    const styles = uniqueValues(normalizedProducts.map((product) => product.style));
    const colors = uniqueValues(normalizedProducts.flatMap((product) => product.colors || []));
    const sizes = uniqueValues(normalizedProducts.flatMap((product) => product.sizes || [])).sort(sizeSort);
    return { categories, brands, genders, styles, colors, sizes };
  }, [normalizedProducts]);

  const activeVariant = useMemo(() => {
    if (!selectedProduct) return null;
    return findVariant(selectedProduct, selectedVariantId, selectedColor, selectedSize);
  }, [selectedProduct, selectedVariantId, selectedColor, selectedSize]);

  const openProduct = (product, variant = null) => {
    setSelectedProduct({ ...product, employeeName: employee?.full_name || employee?.name || "" });
    setSelectedVariantId(variant?.variant_id ?? variant?.id ?? null);
    setSelectedColor(variant?.color || product.colors[0] || "");
    setSelectedSize(variant?.size || product.sizes[0] || "");
  };

  const handleCallWarehouse = async () => {
    if (!selectedProduct || !activeVariant || Number(activeVariant.stock || 0) <= 0) return;
    setLoadingCall(true);
    try {
      await requestEmployeeWarehousePick(token, {
        productId: selectedProduct.id ?? selectedProduct.product_id ?? null,
        color: activeVariant.color || "",
        size: activeVariant.size || "",
        quantity: 1,
      });
      toast.success("طھظ… ط¥ط±ط³ط§ظ„ ظ†ط¯ط§ط، ط§ظ„ظ…ط®ط²ظ†");
      setSelectedProduct(null);
      setSelectedVariantId(null);
      setSelectedColor("");
      setSelectedSize("");
    } catch (err) {
      toast.error(err?.message || "طھط¹ط°ط± ط¥ط±ط³ط§ظ„ ظ†ط¯ط§ط، ط§ظ„ظ…ط®ط²ظ†");
    } finally {
      setLoadingCall(false);
    }
  };

  if (loading && !normalizedProducts.length) {
    return (
      <main dir="rtl" className="flex min-h-[100dvh] items-center justify-center bg-slate-100 px-4 text-slate-900">
        <Loader2 className="h-7 w-7 animate-spin text-emerald-600" />
      </main>
    );
  }

  if (error && !normalizedProducts.length) {
    return (
      <main dir="rtl" className="min-h-[100dvh] bg-slate-100 px-4 py-6 text-right text-slate-950">
        <section className="mx-auto max-w-xl rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2 text-amber-600">
            <Store className="h-5 w-5" />
            <h1 className="text-xl font-black">ط§ظ„ظ…ظ†طھط¬ط§طھ</h1>
          </div>
          <p className="mt-3 text-sm font-semibold leading-6 text-slate-600">{error}</p>
        </section>
      </main>
    );
  }

  return (
    <main dir="rtl" className="min-h-[100dvh] bg-slate-100 px-3 py-3 text-right text-slate-950 sm:px-4 sm:py-4">
      <div className="mx-auto max-w-7xl">
        <header className="rounded-3xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[10px] font-black uppercase tracking-[0.24em] text-emerald-600">Employee Portal</div>
              <h1 className="truncate text-lg font-black text-slate-950">ط§ظ„ظ…ظ†طھط¬ط§طھ</h1>
              <div className="mt-0.5 text-xs font-semibold text-slate-500">
                {employee?.full_name ? `ط§ظ„ظ…ظˆط¸ظپ: ${employee.full_name}` : "ط§ظ„ط¨ط­ط« ط§ظ„ط³ط±ظٹط¹ ط¹ظ† ط§ظ„ظ…ظ†طھط¬ط§طھ ظˆظ†ط¯ط§ط، ط§ظ„ظ…ط®ط²ظ†"}
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setSearch("");
                setFilters({
                  category: "all",
                  brand: "all",
                  gender: "all",
                  style: "all",
                  color: "all",
                  size: "all",
                  inStockOnly: false,
                });
              }}
              className="inline-flex min-h-10 items-center justify-center rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700"
            >
              ط¥ط¹ط§ط¯ط© ط§ظ„ط¶ط¨ط·
            </button>
          </div>
        </header>

        <section className="mt-3 rounded-3xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="grid gap-3 lg:grid-cols-[1fr_auto] lg:items-center">
            <label className="flex min-h-12 items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3">
              <Search className="h-4 w-4 text-slate-400" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="ط¨ط­ط« ط¹ظ† ظ…ظˆط¯ظٹظ„ ط£ظˆ ظƒظˆط¯"
                className="w-full bg-transparent text-sm font-semibold outline-none placeholder:text-slate-400"
              />
            </label>
            <div className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-600">
              <Filter className="h-4 w-4 text-slate-400" />
              ط§ظ„ظپظ„ط§طھط±
            </div>
          </div>

          <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
            <select value={filters.category} onChange={(event) => setFilters((current) => ({ ...current, category: event.target.value }))} className="min-h-12 rounded-2xl border border-slate-200 bg-white px-3 text-sm font-semibold outline-none">
              <option value="all">ط§ظ„ظپط¦ط©</option>
              {filterOptions.categories.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
            <select value={filters.brand} onChange={(event) => setFilters((current) => ({ ...current, brand: event.target.value }))} className="min-h-12 rounded-2xl border border-slate-200 bg-white px-3 text-sm font-semibold outline-none">
              <option value="all">ط§ظ„ط¨ط±ط§ظ†ط¯</option>
              {filterOptions.brands.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
            <select value={filters.gender} onChange={(event) => setFilters((current) => ({ ...current, gender: event.target.value }))} className="min-h-12 rounded-2xl border border-slate-200 bg-white px-3 text-sm font-semibold outline-none">
              <option value="all">ط§ظ„ط¬ظ†ط³</option>
              {filterOptions.genders.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
            <select value={filters.style} onChange={(event) => setFilters((current) => ({ ...current, style: event.target.value }))} className="min-h-12 rounded-2xl border border-slate-200 bg-white px-3 text-sm font-semibold outline-none">
              <option value="all">ط§ظ„ط³طھط§ظٹظ„</option>
              {filterOptions.styles.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
            <select value={filters.color} onChange={(event) => setFilters((current) => ({ ...current, color: event.target.value }))} className="min-h-12 rounded-2xl border border-slate-200 bg-white px-3 text-sm font-semibold outline-none">
              <option value="all">ط§ظ„ظ„ظˆظ†</option>
              {filterOptions.colors.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
            <select value={filters.size} onChange={(event) => setFilters((current) => ({ ...current, size: event.target.value }))} className="min-h-12 rounded-2xl border border-slate-200 bg-white px-3 text-sm font-semibold outline-none">
              <option value="all">ط§ظ„ظ…ظ‚ط§ط³</option>
              {filterOptions.sizes.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
            <label className="inline-flex min-h-12 items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 md:col-span-2 xl:col-span-1">
              <span>ط§ظ„ظ…طھط§ط­ ظپظ‚ط·</span>
              <input
                type="checkbox"
                checked={filters.inStockOnly}
                onChange={(event) => setFilters((current) => ({ ...current, inStockOnly: event.target.checked }))}
                className="h-5 w-5 accent-emerald-600"
              />
            </label>
          </div>
        </section>

        <section className="mt-4 grid gap-4 lg:grid-cols-[1fr_1.55fr]">
          <div className="order-2 lg:order-1">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-sm font-black text-slate-500">ط¢ط®ط± 20 ظ…ظ†طھط¬</h2>
              <div className="text-xs font-semibold text-slate-400">{normalizedProducts.length.toLocaleString("ar-EG")} ظ…ظ†طھط¬</div>
            </div>
            <div className="grid gap-3">
              {normalizedProducts.slice(0, 20).map((product) => (
                <ProductCard key={product.id} product={product} active={selectedProduct && String(selectedProduct.id) === String(product.id)} onOpen={openProduct} />
              ))}
              {!loading && normalizedProducts.length === 0 ? (
                <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm font-semibold text-slate-500">
                  ظ„ط§ طھظˆط¬ط¯ ظ…ظ†طھط¬ط§طھ ظ…ط·ط§ط¨ظ‚ط©
                </div>
              ) : null}
            </div>
          </div>

          <div className="order-1 lg:order-2">
            <div className="sticky top-3 rounded-3xl border border-slate-200 bg-white p-3 shadow-sm">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="text-sm font-black text-slate-500">ط§ظ„ظ…ظ†طھط¬ ط§ظ„ط­ط§ظ„ظٹ</h2>
                {loading ? <Loader2 className="h-4 w-4 animate-spin text-emerald-600" /> : null}
              </div>

              {selectedProduct ? (
                <button
                  type="button"
                  onClick={() => openProduct(selectedProduct, activeVariant)}
                  className="group block w-full rounded-[1.5rem] border border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-amber-50 p-4 text-right shadow-[0_16px_42px_rgba(16,185,129,0.12)] transition hover:shadow-[0_18px_48px_rgba(16,185,129,0.18)]"
                >
                  <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
                    <div className="rounded-[1.25rem] border border-slate-200 bg-white p-3">
                      <div className="flex min-h-[18rem] items-center justify-center overflow-hidden rounded-[1rem] bg-slate-50">
                        {selectedProduct.image_url ? (
                          <img
                            src={selectedProduct.image_url}
                            alt={selectedProduct.name}
                            className="max-h-[22rem] w-full object-contain p-3"
                            loading="eager"
                            onError={(event) => {
                              event.currentTarget.style.display = "none";
                            }}
                          />
                        ) : (
                          <Package2 className="h-24 w-24 text-slate-300" />
                        )}
                      </div>
                    </div>

                    <div className="space-y-3">
                      <div className="rounded-[1.25rem] border border-slate-200 bg-white p-4">
                        <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">ط§ظ„ظ„ظˆظ†</div>
                        <div className="mt-1 text-lg font-black text-slate-950">{activeVariant?.color || selectedColor || "-"}</div>
                      </div>
                      <div className="rounded-[1.25rem] border border-slate-200 bg-white p-4">
                        <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">ط§ظ„ظ…ظ‚ط§ط³</div>
                        <div className="mt-1 flex items-end gap-2">
                          <div className="text-5xl font-black leading-none text-slate-950">{activeVariant?.size || selectedSize || "-"}</div>
                          <div className="pb-1 text-sm font-bold text-slate-500">أ— {Number(activeVariant?.stock || 0)}</div>
                        </div>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <ProductBadge label="ظƒظˆط¯ ط§ظ„ط£ط±طھظƒظ„" value={selectedProduct.article_code || "-"} />
                        <ProductBadge label="ط§ط³ظ… ط§ظ„ظ…طµظ†ط¹" value={selectedProduct.manufacturer_name || "-"} />
                        <ProductBadge label="ط§ظ„ط¨ط§ط¦ط¹" value={selectedProduct.employeeName || employee?.full_name || "-"} />
                        <ProductBadge label="ط§ظ„ظˆظ‚طھ" value={formatTime()} />
                      </div>
                      <div className="rounded-[1.25rem] border border-slate-200 bg-slate-50 p-4">
                        <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">ط§ظ„ظ…ظ†طھط¬</div>
                        <div className="mt-1 text-sm font-bold text-slate-500">{selectedProduct.name || "-"}</div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {selectedProduct.colors.slice(0, 4).map((color) => (
                            <span key={color} className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-bold text-slate-600">
                              {color}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </button>
              ) : (
                <div className="rounded-[1.5rem] border border-dashed border-slate-300 bg-slate-50 p-10 text-center">
                  <Package2 className="mx-auto h-16 w-16 text-slate-300" />
                  <div className="mt-4 text-lg font-black text-slate-900">ط§ط®طھط± ظ…ظ†طھط¬ظ‹ط§ ظ„ظ„ظ…ط¹ط§ظٹظ†ط©</div>
                  <p className="mt-2 text-sm font-semibold leading-6 text-slate-500">ط§ط¶ط؛ط· ط¹ظ„ظ‰ ط£ظٹ ط¨ط·ط§ظ‚ط© ظ„ظپطھط­ ط§ظ„ط£ظ„ظˆط§ظ† ظˆط§ظ„ظ…ظ‚ط§ط³ط§طھ ط«ظ… ظ†ط¯ط§ط، ط§ظ„ظ…ط®ط²ظ†.</p>
                </div>
              )}
            </div>
          </div>
        </section>
      </div>

      {selectedProduct ? (
        <ProductPickerSheet
          product={{ ...selectedProduct, selectedVariantId, employeeName: employee?.full_name || employee?.name || "" }}
          selectedColor={selectedColor}
          selectedSize={selectedSize}
          onSelectColor={(color) => {
            const nextVariant = firstVariantForColor(selectedProduct, color);
            setSelectedColor(color);
            setSelectedVariantId(nextVariant?.variant_id ?? nextVariant?.id ?? null);
            setSelectedSize(nextVariant?.size || "");
          }}
          onSelectSize={(size) => {
            const nextVariant = findVariant(selectedProduct, null, selectedColor, size);
            setSelectedSize(size);
            setSelectedVariantId(nextVariant?.variant_id ?? nextVariant?.id ?? null);
            if (nextVariant?.color) setSelectedColor(nextVariant.color);
          }}
          onClose={() => {
            setSelectedProduct(null);
            setSelectedVariantId(null);
            setSelectedColor("");
            setSelectedSize("");
          }}
          onCallWarehouse={handleCallWarehouse}
          loadingCall={loadingCall}
        />
      ) : null}
    </main>
  );
}


