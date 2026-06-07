import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { ChevronLeft, Filter, Loader2, Minus, Package2, Plus, Search, Store, X } from "lucide-react";
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

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const sortSizes = (sizes = []) => [...sizes].sort(sizeSort);

const formatQuantity = (quantity = 1) => String(Math.max(1, Number(quantity || 1)));

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
  const availableVariants = variants.filter((variant) => Number(variant.stock || 0) > 0);
  const colors = uniqueValues(availableVariants.map((variant) => variant.color));
  const sizes = sortSizes(uniqueValues(availableVariants.map((variant) => variant.size)));
  const totalStock = availableVariants.reduce((sum, variant) => sum + Math.max(0, Number(variant.stock || 0)), 0);
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
    article_code: text(product.article_code || product.product_code || product.barcode || ""),
    manufacturer_name: text(product.manufacturer_name || ""),
    category: text(product.category || ""),
    type: text(product.type || product.product_type || product.style || ""),
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
    variants: availableVariants,
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

const stockByColor = (product = {}, color = "") =>
  (Array.isArray(product.variants) ? product.variants : [])
    .filter((variant) => !color || text(variant.color) === text(color))
    .reduce((sum, variant) => sum + Math.max(0, Number(variant.stock || 0)), 0);

const firstAvailableColor = (product = {}) => product.colors.find((color) => stockByColor(product, color) > 0) || product.colors[0] || "";

const sizeOptionsForProduct = (product = {}, color = "") => {
  const variants = Array.isArray(product.variants) ? product.variants : [];
  const filtered = color ? variants.filter((variant) => text(variant.color) === text(color)) : variants;
  const bySize = new Map();

  for (const variant of filtered) {
    const size = text(variant.size);
    if (!size) continue;
    const stock = Math.max(0, Number(variant.stock || 0));
    bySize.set(size, (bySize.get(size) || 0) + stock);
  }

  return [...bySize.entries()]
    .map(([size, stock]) => ({ size, stock }))
    .filter((item) => item.stock > 0)
    .sort((a, b) => sizeSort(a.size, b.size));
};

const buildListParams = ({ search, filters }) => {
  const params = { limit: 120 };
  const q = text(search);
  if (q) params.q = q;
  if (filters.category !== "all") params.category = filters.category;
  if (filters.type !== "all") params.type = filters.type;
  if (filters.brand !== "all") params.brand = filters.brand;
  if (filters.gender !== "all") params.gender = filters.gender;
  if (filters.color !== "all") params.color = filters.color;
  if (filters.size !== "all") params.size = filters.size;
  params.inStockOnly = filters.inStockOnly ? 1 : 0;
  return params;
};

const buildLookupParams = (directLookup) => {
  const params = { limit: 20 };
  if (directLookup.productId) params.productId = directLookup.productId;
  if (directLookup.barcode) params.barcode = directLookup.barcode;
  if (directLookup.article) params.article = directLookup.article;
  params.inStockOnly = 1;
  return params;
};

function FilterSelect({ value, onChange, label, options }) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="min-h-12 rounded-2xl border border-slate-200 bg-white px-3 text-sm font-semibold outline-none"
    >
      <option value="all">{label}</option>
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
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
            <h3 className="truncate text-sm font-black text-slate-950">{product.name || "منتج"}</h3>
            <div className="mt-1 truncate text-[11px] font-semibold text-slate-500">
              {product.article_code ? `كود الأرتكل: ${product.article_code}` : "كود الأرتكل: -"}
            </div>
            <div className="mt-0.5 truncate text-[11px] font-semibold text-slate-500">
              {product.manufacturer_name ? `اسم المصنع: ${product.manufacturer_name}` : "اسم المصنع: -"}
            </div>
          </div>
          <div className="rounded-2xl bg-emerald-50 px-2.5 py-1 text-center">
            <div className="text-[10px] font-black uppercase tracking-[0.16em] text-emerald-700">المتاح</div>
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
                {Number(stock || 0)} × {size}
              </span>
            );
          })}
          {!sizes.length ? (
            <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-bold text-slate-400">لا توجد مقاسات</span>
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
  quantity,
  onClose,
  onSelectColor,
  onSelectSize,
  onChangeQuantity,
  onSubmit,
  loadingSubmit,
}) {
  if (!product) return null;

  const sizeOptions = sizeOptionsForProduct(product, selectedColor);
  const activeVariant = findVariant(product, null, selectedColor, selectedSize);
  const activeStock = Number(activeVariant?.stock || 0);
  const canSubmit = Boolean(activeVariant && activeStock > 0 && quantity > 0);

  const handleQuantityDelta = (delta) => {
    if (!activeStock) return;
    onChangeQuantity(clamp(Number(quantity || 1) + delta, 1, activeStock));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 px-2 py-2 sm:items-center sm:px-4 sm:py-6">
      <div className="flex max-h-[94vh] w-full max-w-5xl flex-col overflow-hidden rounded-[1.5rem] border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div className="min-w-0">
            <div className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-600">اختيار المنتج</div>
            <h3 className="truncate text-base font-black text-slate-950">{product.name || "منتج"}</h3>
            <div className="mt-1 flex flex-wrap gap-2 text-[11px] font-semibold text-slate-500">
              <span>كود الأرتكل: {product.article_code || "-"}</span>
              <span>اسم المصنع: {product.manufacturer_name || "-"}</span>
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
              <div className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-right">
                <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">اللون</div>
                <div className="mt-1 truncate text-sm font-bold text-slate-800">{selectedColor || "-"}</div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-right">
                <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">المقاس</div>
                <div className="mt-1 truncate text-sm font-bold text-slate-800">
                  {selectedSize ? `${selectedSize} × ${activeStock}` : "-"}
                </div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-right">
                <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">المتاح</div>
                <div className="mt-1 truncate text-sm font-bold text-slate-800">{Number(activeStock || 0)}</div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-right">
                <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">الكمية</div>
                <div className="mt-1 truncate text-sm font-bold text-slate-800">{formatQuantity(quantity)}</div>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-[1.25rem] border border-slate-200 bg-white p-3">
              <div className="text-sm font-black text-slate-900">اللون</div>
              <div className="mt-3 flex flex-wrap gap-2">
                {product.colors.length ? (
                  product.colors.map((color) => {
                    const colorStock = stockByColor(product, color);
                    const active = text(selectedColor) === text(color);
                    return (
                      <button
                        key={color || "default"}
                        type="button"
                        onClick={() => onSelectColor(color)}
                        className={`min-h-11 rounded-full border px-4 py-2 text-sm font-black transition ${
                          active ? "border-emerald-400 bg-emerald-500 text-white" : "border-slate-200 bg-slate-50 text-slate-700"
                        }`}
                      >
                        {color}
                        <span className={`mr-2 text-[11px] font-bold ${active ? "text-emerald-50" : "text-slate-500"}`}>({colorStock})</span>
                      </button>
                    );
                  })
                ) : (
                  <span className="text-sm font-semibold text-slate-500">لا توجد ألوان</span>
                )}
              </div>
            </div>

            <div className="rounded-[1.25rem] border border-slate-200 bg-white p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-black text-slate-900">المقاس</div>
                <div className="text-[11px] font-bold text-slate-400">المتاح فقط يظهر بالأسفل</div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {sizeOptions.length ? (
                  sizeOptions.map(({ size, stock }) => {
                    const active = text(selectedSize) === text(size);
                    return (
                      <button
                        key={size}
                        type="button"
                        onClick={() => onSelectSize(size)}
                        className={`min-h-16 rounded-2xl border px-3 py-2 text-right transition ${
                          active
                            ? "border-emerald-400 bg-emerald-50 text-emerald-700"
                            : "border-slate-200 bg-white text-slate-800"
                        }`}
                      >
                        <div className="text-2xl font-black leading-none">{size}</div>
                        <div className="mt-1 text-[11px] font-semibold leading-none">المتاح: {Number(stock || 0)}</div>
                      </button>
                    );
                  })
                ) : (
                  <div className="col-span-full text-sm font-semibold text-slate-500">لا توجد مقاسات متاحة لهذا اللون</div>
                )}
              </div>
            </div>

            <div className="rounded-[1.25rem] border border-slate-200 bg-slate-50 p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-black text-slate-900">الكمية</div>
                <div className="text-[11px] font-bold text-slate-500">الحد الأعلى = المتاح في المقاس</div>
              </div>
              <div className="mt-3 flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-2">
                <button
                  type="button"
                  onClick={() => handleQuantityDelta(-1)}
                  disabled={!activeStock || Number(quantity || 1) <= 1}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Minus className="h-4 w-4" />
                </button>
                <div className="min-w-16 text-center text-2xl font-black text-slate-950">{formatQuantity(quantity)}</div>
                <button
                  type="button"
                  onClick={() => handleQuantityDelta(1)}
                  disabled={!activeStock || Number(quantity || 1) >= activeStock}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>

              <button
                type="button"
                onClick={onSubmit}
                disabled={!canSubmit || loadingSubmit}
                className="mt-3 inline-flex min-h-12 w-full items-center justify-center rounded-2xl bg-emerald-500 px-4 py-3 text-sm font-black text-white transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loadingSubmit ? <Loader2 className="ml-2 h-4 w-4 animate-spin" /> : null}
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
    type: "all",
    brand: "all",
    gender: "all",
    color: "all",
    size: "all",
    inStockOnly: true,
  });
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [selectedColor, setSelectedColor] = useState("");
  const [selectedSize, setSelectedSize] = useState("");
  const [selectedQuantity, setSelectedQuantity] = useState(1);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [loadingSubmit, setLoadingSubmit] = useState(false);
  const lookupDoneRef = useRef(false);

  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    document.title = "طلب مقاس من المخزن";
    return undefined;
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return undefined;

    const prevHtmlOverflowX = document.documentElement.style.overflowX;
    const prevBodyOverflowX = document.body.style.overflowX;
    document.documentElement.style.overflowX = "hidden";
    document.body.style.overflowX = "hidden";

    return () => {
      document.documentElement.style.overflowX = prevHtmlOverflowX;
      document.body.style.overflowX = prevBodyOverflowX;
    };
  }, []);

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
        setError(err?.responseBody?.message_ar || err?.responseBody?.message || err?.message || "تعذر تحميل المنتجات");
        setProducts([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 220);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [token, deferredSearch, filters.category, filters.type, filters.brand, filters.gender, filters.color, filters.size, filters.inStockOnly]);

  useEffect(() => {
    lookupDoneRef.current = false;
    setSelectedProduct(null);
    setSelectedColor("");
    setSelectedSize("");
    setSelectedQuantity(1);
    setSheetOpen(false);
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
        if (!lookupProducts.length) return;

        const selection = response?.selection || {};
        const matched =
          lookupProducts.find((product) => String(product.id) === String(selection.product_id || "")) ||
          lookupProducts[0] ||
          null;

        if (matched) {
          const variant = findVariant(matched, selection.variant_id, selection.color, selection.size);
          const nextColor = variant?.color || matched.colors[0] || "";
          const nextSize = variant?.size || matched.sizes[0] || "";
          setProducts(lookupProducts);
          setSelectedProduct(matched);
          setSelectedColor(nextColor);
          setSelectedSize(nextSize);
          setSelectedQuantity(1);
          setSheetOpen(true);
        }
      } finally {
        lookupDoneRef.current = true;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token, directLookup.productId, directLookup.barcode, directLookup.article]);

  const normalizedProducts = useMemo(() => (Array.isArray(products) ? products : []).map(normalizeProduct), [products]);

  const filterOptions = useMemo(() => {
    const categories = uniqueValues(normalizedProducts.map((product) => product.category));
    const types = uniqueValues(normalizedProducts.map((product) => product.type));
    const brands = uniqueValues(normalizedProducts.map((product) => product.brand));
    const genders = uniqueValues(normalizedProducts.map((product) => product.gender));
    const colors = uniqueValues(normalizedProducts.flatMap((product) => product.colors || []));
    const sizes = sortSizes(uniqueValues(normalizedProducts.flatMap((product) => product.sizes || [])));
    return { categories, types, brands, genders, colors, sizes };
  }, [normalizedProducts]);

  const activeVariant = useMemo(() => {
    if (!selectedProduct) return null;
    return findVariant(selectedProduct, null, selectedColor, selectedSize);
  }, [selectedProduct, selectedColor, selectedSize]);

  const openProduct = (product, variant = null) => {
    const nextColor = variant?.color || firstAvailableColor(product);
    const nextSize = variant?.size || (nextColor ? sizeOptionsForProduct(product, nextColor)[0]?.size || "" : product.sizes[0] || "");
    setSelectedProduct(product);
    setSelectedColor(nextColor);
    setSelectedSize(nextSize);
    setSelectedQuantity(1);
    setSheetOpen(true);
  };

  const handleSelectColor = (color) => {
    const nextVariant = firstVariantForColor(selectedProduct, color);
    const nextSize = sizeOptionsForProduct(selectedProduct, color)[0]?.size || nextVariant?.size || "";
    setSelectedColor(color);
    setSelectedSize(nextSize);
    setSelectedQuantity(1);
  };

  const handleSelectSize = (size) => {
    const nextVariant = findVariant(selectedProduct, null, selectedColor, size);
    setSelectedSize(size);
    if (nextVariant?.color) setSelectedColor(nextVariant.color);
    setSelectedQuantity((current) => clamp(Number(current || 1), 1, Number(nextVariant?.stock || 1)));
  };

  const closeSheet = () => {
    setSheetOpen(false);
  };

  const handleSubmit = async () => {
    if (!selectedProduct || !activeVariant || Number(activeVariant.stock || 0) <= 0) return;
    setLoadingSubmit(true);
    try {
      await requestEmployeeWarehousePick(token, {
        productId: selectedProduct.id ?? selectedProduct.product_id ?? null,
        variantId: activeVariant.variant_id ?? activeVariant.id ?? null,
        color: activeVariant.color || selectedColor || "",
        size: activeVariant.size || selectedSize || "",
        quantity: clamp(Number(selectedQuantity || 1), 1, Math.max(1, Number(activeVariant.stock || 1))),
      });

      toast.success("تم إرسال الطلب إلى المخزن");
      setSheetOpen(false);
      setSelectedQuantity(1);
    } catch (err) {
      toast.error(err?.message || "تعذر إرسال الطلب إلى المخزن");
    } finally {
      setLoadingSubmit(false);
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
            <h1 className="text-xl font-black">طلب مقاس من المخزن</h1>
          </div>
          <p className="mt-3 text-sm font-semibold leading-6 text-slate-600">{error}</p>
        </section>
      </main>
    );
  }

  return (
    <main dir="rtl" className="min-h-[100dvh] overflow-x-hidden bg-slate-100 px-3 py-3 text-right text-slate-950 sm:px-4 sm:py-4">
      <div className="mx-auto max-w-7xl">
        <header className="rounded-3xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="text-[10px] font-black uppercase tracking-[0.24em] text-emerald-600">Employee Portal</div>
              <h1 className="truncate text-lg font-black text-slate-950">طلب مقاس من المخزن</h1>
              <div className="mt-0.5 text-xs font-semibold text-slate-500">
                {employee?.full_name ? `الموظف: ${employee.full_name}` : "ابحث عن المنتج ثم اختر اللون والمقاس لإرسال الطلب للمخزن"}
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setSearch("");
                setFilters({
                  category: "all",
                  type: "all",
                  brand: "all",
                  gender: "all",
                  color: "all",
                  size: "all",
                  inStockOnly: true,
                });
                setSelectedProduct(null);
                setSelectedColor("");
                setSelectedSize("");
                setSelectedQuantity(1);
                setSheetOpen(false);
              }}
              className="inline-flex min-h-10 items-center justify-center rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 self-start sm:self-auto"
            >
              إعادة الضبط
            </button>
          </div>
        </header>

        <section className="mt-3 rounded-3xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="flex flex-col gap-3">
            <label className="flex min-h-12 items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3">
              <Search className="h-4 w-4 text-slate-400" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="ابحث بالموديل أو الاسم أو الباركود أو الكود"
                className="w-full bg-transparent text-sm font-semibold outline-none placeholder:text-slate-400"
              />
            </label>
            <div className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-600">
              <Filter className="h-4 w-4 text-slate-400" />
              الفلاتر
            </div>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <FilterSelect value={filters.category} onChange={(value) => setFilters((current) => ({ ...current, category: value }))} label="الفئة" options={filterOptions.categories} />
            <FilterSelect value={filters.type} onChange={(value) => setFilters((current) => ({ ...current, type: value }))} label="النوع" options={filterOptions.types} />
            <FilterSelect value={filters.brand} onChange={(value) => setFilters((current) => ({ ...current, brand: value }))} label="البراند" options={filterOptions.brands} />
            <FilterSelect value={filters.gender} onChange={(value) => setFilters((current) => ({ ...current, gender: value }))} label="الجنس" options={filterOptions.genders} />
            <FilterSelect value={filters.color} onChange={(value) => setFilters((current) => ({ ...current, color: value }))} label="اللون" options={filterOptions.colors} />
            <FilterSelect value={filters.size} onChange={(value) => setFilters((current) => ({ ...current, size: value }))} label="المقاس" options={filterOptions.sizes} />
            <label className="inline-flex min-h-12 items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 md:col-span-2 xl:col-span-1">
              <span>المتاح فقط</span>
              <input
                type="checkbox"
                checked={filters.inStockOnly}
                onChange={(event) => setFilters((current) => ({ ...current, inStockOnly: event.target.checked }))}
                className="h-5 w-5 accent-emerald-600"
              />
            </label>
          </div>
        </section>

        <section className="mt-4 grid gap-4 lg:grid-cols-[1fr_0.95fr]">
          <div>
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-sm font-black text-slate-500">النتائج</h2>
              <div className="text-xs font-semibold text-slate-400">{normalizedProducts.length.toLocaleString("ar-EG")} منتج</div>
            </div>
            <div className="grid grid-cols-1 gap-3">
              {normalizedProducts.map((product) => (
                <ProductCard key={product.id} product={product} active={selectedProduct && String(selectedProduct.id) === String(product.id)} onOpen={openProduct} />
              ))}
              {!loading && normalizedProducts.length === 0 ? (
                <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm font-semibold text-slate-500">
                  لا توجد منتجات مطابقة
                </div>
              ) : null}
            </div>
          </div>

          <div className="hidden lg:block">
            <div className="sticky top-4 rounded-3xl border border-slate-200 bg-white p-3 shadow-sm">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="text-sm font-black text-slate-500">المنتج المحدد</h2>
                {loading ? <Loader2 className="h-4 w-4 animate-spin text-emerald-600" /> : null}
              </div>

              {selectedProduct ? (
                <div className="rounded-[1.5rem] border border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-amber-50 p-4 text-right shadow-[0_16px_42px_rgba(16,185,129,0.12)]">
                  <div className="grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
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
                        <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">اللون</div>
                        <div className="mt-1 text-lg font-black text-slate-950">{selectedColor || "-"}</div>
                      </div>
                      <div className="rounded-[1.25rem] border border-slate-200 bg-white p-4">
                        <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">المقاس</div>
                        <div className="mt-1 flex items-end gap-2">
                          <div className="text-5xl font-black leading-none text-slate-950">{selectedSize || "-"}</div>
                          <div className="pb-1 text-sm font-bold text-slate-500">× {Number(activeVariant?.stock || 0)}</div>
                        </div>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <div className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-right">
                          <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">كود الأرتكل</div>
                          <div className="mt-1 truncate text-sm font-bold text-slate-800">{selectedProduct.article_code || "-"}</div>
                        </div>
                        <div className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-right">
                          <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">اسم المصنع</div>
                          <div className="mt-1 truncate text-sm font-bold text-slate-800">{selectedProduct.manufacturer_name || "-"}</div>
                        </div>
                        <div className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-right">
                          <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">الكمية</div>
                          <div className="mt-1 truncate text-sm font-bold text-slate-800">{formatQuantity(selectedQuantity)}</div>
                        </div>
                        <div className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-right">
                          <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">المتاح</div>
                          <div className="mt-1 truncate text-sm font-bold text-slate-800">{Number(activeVariant?.stock || 0)}</div>
                        </div>
                      </div>
                      <div className="rounded-[1.25rem] border border-slate-200 bg-slate-50 p-4">
                        <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">المنتج</div>
                        <div className="mt-1 text-sm font-bold text-slate-500">{selectedProduct.name || "-"}</div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {selectedProduct.colors.slice(0, 4).map((color) => (
                            <span key={color} className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-bold text-slate-600">
                              {color}
                            </span>
                          ))}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSheetOpen(true)}
                        className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-600 px-4 text-sm font-black text-white"
                      >
                        افتح الاختيار
                        <ChevronLeft className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="rounded-[1.5rem] border border-dashed border-slate-300 bg-slate-50 p-10 text-center">
                  <Package2 className="mx-auto h-16 w-16 text-slate-300" />
                  <div className="mt-4 text-lg font-black text-slate-900">اختار منتج ثم اللون والمقاس لإرسال طلب للمخزن</div>
                  <p className="mt-2 text-sm font-semibold leading-6 text-slate-500">اضغط على أي بطاقة لفتح منتقي المقاسات والألوان.</p>
                </div>
              )}
            </div>
          </div>
        </section>

        {!selectedProduct ? (
          <div className="mt-4 rounded-[1.5rem] border border-dashed border-slate-300 bg-white p-6 text-center text-sm font-semibold text-slate-500 lg:hidden">
            اختار منتج ثم اللون والمقاس لإرسال طلب للمخزن
          </div>
        ) : null}

        {sheetOpen && selectedProduct ? (
          <ProductPickerSheet
            product={selectedProduct}
            selectedColor={selectedColor}
            selectedSize={selectedSize}
            quantity={selectedQuantity}
            onSelectColor={handleSelectColor}
            onSelectSize={handleSelectSize}
            onChangeQuantity={setSelectedQuantity}
            onClose={closeSheet}
            onSubmit={handleSubmit}
            loadingSubmit={loadingSubmit}
          />
        ) : null}
      </div>
    </main>
  );
}
