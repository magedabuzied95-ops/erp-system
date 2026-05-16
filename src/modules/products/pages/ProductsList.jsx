import { useEffect, useMemo, useState } from "react";

import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

import {
  AlertTriangle,
  ChevronDown,
  Copy,
  Eye,
  Filter,
  MoreHorizontal,
  Package2,
  Pencil,
  Plus,
  Search,
  Barcode,
  CalendarClock,
  Megaphone,
  Trash2,
  Zap,
} from "lucide-react";

import toast from "react-hot-toast";

import { api } from "../../../shared/api/api";
import { hasPermission } from "../../permissions/lib/rbacStore";

import ProductsShell from "../components/ProductsShell";

import {
  cleanupProductCache,
  generateSku,
  mergeProductRecord,
  removeProductMeta,
  upsertProductMeta,
} from "../lib/catalog";
import {
  createProduct,
  deleteProduct,
  getProducts,
  getProductsWithVariants,
} from "../services/productsApi";

import PostEditorModal from "../../marketing/components/PostEditorModal";
import {
  createMarketingPost,
  generateProductMarketingPost,
  publishProductStoryEverywhere,
  publishMarketingPost,
  scheduleProductStoryEverywhere,
  scheduleMarketingPost,
  updateMarketingPost,
} from "../../marketing/services/marketingApi";

const pageSizeOptions = [8, 12, 24];
const REQUEST_TIMEOUT_MS = 15000;

const isQuotaExceeded = (error) =>
  error?.name === "QuotaExceededError" ||
  error?.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
  error?.code === 22 ||
  error?.code === 1014 ||
  /quota/i.test(String(error?.message || ""));

const duplicateVariantPayload = (variant = {}, index = 0) => ({
  color: variant.color || "",
  size: variant.size || "",
  sku: "",
  barcode: "",
  stock: Number(variant.stock || variant.default_purchase_qty || 0),
  sale_price: Number(variant.sale_price ?? variant.price ?? 0),
  price: Number(variant.price ?? variant.sale_price ?? 0),
  cost_price: Number(variant.cost_price ?? variant.purchase_price ?? 0),
  manufacturer_id: variant.manufacturer_id || null,
  edition_name: variant.edition_name ? `${variant.edition_name} Copy ${index + 1}` : "",
  edition_slug: "",
});

const duplicateProductPayload = (row = {}) => ({
  name: `${row.name || "Product"} Copy`,
  description: "",
  category: row.category || "Uncategorized",
  category_id: row.category_id || null,
  brand: row.brand || "Unbranded",
  brand_id: row.brand_id || null,
  gender: row.gender || "",
  product_type: row.product_type || "",
  style: row.style || "",
  grade: row.grade || "",
  variation_mode: row.variation_mode || "full_variations",
  fixed_size_label: row.fixed_size_label || "",
  unit_id: row.unit_id || null,
  sale_price: Number(row.sale_price || row.price || 0),
  cost_price: Number(row.cost_price || 0),
  wholesale_price: Number(row.wholesale_price || 0),
  price: Number(row.price || row.sale_price || 0),
  stock: Number(row.stock || 0),
  image_url: "",
  gallery: [],
  colorImages: [],
  variants:
    row.variation_mode === "simple"
      ? []
      : Array.isArray(row.variants)
        ? row.variants.map(duplicateVariantPayload)
        : [],
});

const resolveImageUrl = (value) => {
  const imageUrl = String(value || "").trim();
  if (!imageUrl) return "";
  if (imageUrl.startsWith("data:") || imageUrl.startsWith("blob:")) return imageUrl;
  if (/^https?:\/\//i.test(imageUrl)) {
    try {
      const parsed = new URL(imageUrl);
      if (/^(localhost|127\.0\.0\.1)$/i.test(parsed.hostname)) {
        return `${parsed.pathname}${parsed.search}${parsed.hash}`;
      }
    } catch {
      return imageUrl;
    }
    return imageUrl;
  }
  if (imageUrl.startsWith("/uploads/")) return imageUrl;
  if (imageUrl.startsWith("uploads/")) return `/${imageUrl}`;
  if (imageUrl.startsWith("/")) return imageUrl;
  return `/uploads/products/${imageUrl}`;
};

const getProductThumbnail = (row) =>
  resolveImageUrl(
    row?.variants?.find((variant) => String(variant?.image_url || "").trim())?.image_url ||
      row?.product_image_url ||
      row?.image_url
  );

const getErrorMessage = (error, fallback) =>
  error?.responseBody?.message ||
  error?.responseBody?.error ||
  error?.message ||
  fallback;

const getProductId = (row = {}) =>
  row?.product_id ?? row?.productId ?? row?.product?.id ?? row?.id ?? null;

const normalizeVariantRows = (rows = []) =>
  rows.flatMap((row) => {
    const productId = getProductId(row);

    if (Array.isArray(row?.variants) && row.variants.length > 0) {
      return row.variants.map((variant) => ({
        ...variant,
        product_id: productId,
        product: row.product || row,
      }));
    }

    if (row?.variant_id || row?.variantId || row?.size || row?.color) {
      return [
        {
          ...row,
          product_id: productId,
        },
      ];
    }

    return [];
  });

const getProductTotalStock = (product) => {
  const variants = Array.isArray(product?.variants) ? product.variants : [];

  if (
    product?.variation_mode === "full_variations" ||
    product?.variation_mode === "simple_variations" ||
    variants.length > 0
  ) {
    return variants.reduce((sum, variant) => {
      return (
        sum +
        Number(
          variant.stock_quantity ??
            variant.stock ??
            variant.quantity ??
            variant.qty ??
            variant.available_quantity ??
            variant.inventory_quantity ??
            variant.current_stock ??
            0
        )
      );
    }, 0);
  }

  return Number(
    product?.stock ??
      product?.quantity ??
      product?.qty ??
      product?.available_quantity ??
      product?.inventory_quantity ??
      product?.current_stock ??
      0
  );
};

const getProductStockState = (product) => {
  const totalStock = getProductTotalStock(product);
  const lowStockAlert = Number(product?.low_stock_alert ?? product?.low_stock_threshold ?? 0);

  return {
    totalStock,
    lowStockAlert,
    isOutOfStock: totalStock <= 0,
    isLowStock: totalStock > 0 && lowStockAlert > 0 && totalStock <= lowStockAlert,
  };
};

const formatCardPrice = (value) => {
  const amount = Number(value || 0);
  return `EGP ${new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(amount) ? amount : 0)}`;
};

function ProductThumbnail({ row }) {
  const src = getProductThumbnail(row);

  if (!src) {
    return (
      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-zinc-500">
        <Package2 size={20} />
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={row?.name || "Product"}
      loading="lazy"
      className="h-14 w-14 shrink-0 rounded-2xl border border-white/10 bg-white/5 object-cover"
    />
  );
}

function ProductsList() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [products, setProducts] = useState([]);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [brandFilter, setBrandFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(8);
  const [selectedIds, setSelectedIds] = useState([]);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [openActionId, setOpenActionId] = useState(null);
  const [marketingEditorOpen, setMarketingEditorOpen] = useState(false);
  const [marketingEditorPost, setMarketingEditorPost] = useState(null);
  const [marketingSaving, setMarketingSaving] = useState(false);
  const canCreateMarketingPost = hasPermission("marketing.create");
  const canUpdateMarketingPost = hasPermission("marketing.update");
  const canPublishMarketingPost = hasPermission("marketing.publish");

  const loadProducts = async () => {
    let baseProducts;
    let variantRows = [];

    try {
      setLoading(true);
      setError("");

      try {
        await api.get("/health", { timeoutMs: REQUEST_TIMEOUT_MS });
      } catch (healthError) {
        const message = t("common.noData");
        console.error("[products:list] backend health check failed", {
          url: healthError?.url || "/api/health",
          method: "GET",
          message: healthError?.message,
        });
        setError(message);
        toast.error(message);
        return;
      }

      const [productsResult, variantsResult] = await Promise.allSettled([
        getProducts({ timeoutMs: REQUEST_TIMEOUT_MS }),
        getProductsWithVariants({ timeoutMs: REQUEST_TIMEOUT_MS }),
      ]);

      if (productsResult.status === "rejected") {
        if (Number(productsResult.reason?.status || productsResult.reason?.responseBody?.status) === 401) {
          throw new Error("Session expired. Please login again.");
        }
        throw productsResult.reason;
      }

      baseProducts = Array.isArray(productsResult.value) ? productsResult.value : [];
      console.log("[products:list] products response", baseProducts);

      if (variantsResult.status === "rejected") {
        if (Number(variantsResult.reason?.status || variantsResult.reason?.responseBody?.status) === 401) {
          throw new Error("Session expired. Please login again.");
        }
        console.warn("[products:list] with variants response failed", variantsResult.reason);
        toast("Variants failed to load. Showing products only.");
      } else {
        variantRows = Array.isArray(variantsResult.value) ? variantsResult.value : [];
        console.log("[products:list] with variants response", variantRows);
      }

      const flattenedVariants = normalizeVariantRows(variantRows);
      const groupedVariants = flattenedVariants.reduce((acc, item) => {
        const productId = String(getProductId(item));
        if (!productId || productId === "null" || productId === "undefined") return acc;
        if (!acc[productId]) acc[productId] = [];
        acc[productId].push(item);
        return acc;
      }, {});

      const merged = baseProducts.map((product) => {
        const variants = groupedVariants[String(product.id)] || [];
        const isSimpleProduct = String(product.variation_mode || "").trim().toLowerCase() === "simple";
        return {
          ...mergeProductRecord(product, isSimpleProduct ? null : variants[0] || null),
          product_image_url: product.image_url || "",
          variants: isSimpleProduct ? [] : variants,
        };
      });

      setProducts(baseProducts);
      setRows(merged);
    } catch (err) {
      console.error("[products:list] load error", err);
      const message =
        String(err?.message || "").toLowerCase().includes("session expired")
          ? "Session expired. Please login again."
          : Number(err?.status || err?.responseBody?.status) === 401
            ? "Session expired. Please login again."
            : getErrorMessage(err, "Failed to load products");
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      loadProducts();
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const categories = useMemo(() => {
    const unique = new Set(rows.map((row) => row.category).filter(Boolean));
    return ["all", ...unique];
  }, [rows]);

  const brands = useMemo(() => {
    const unique = new Set(rows.map((row) => row.brand).filter(Boolean));
    return ["all", ...unique];
  }, [rows]);

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return rows.filter((row) => {
      const dbStatus = String(row.status || "").toLowerCase();
      const { isLowStock, isOutOfStock } = getProductStockState(row);
      const effectiveStatus =
        row.active === false || dbStatus === "inactive" || dbStatus === "archived"
          ? "inactive"
          : isOutOfStock || isLowStock
            ? "low"
            : "active";
      const matchesSearch =
        !query ||
        [
          row.name,
          row.sku,
          row.barcode,
          row.category,
          row.brand,
        ]
          .join(" ")
          .toLowerCase()
          .includes(query);
      const matchesStatus = statusFilter === "all" || effectiveStatus === statusFilter;
      const matchesCategory = categoryFilter === "all" || row.category === categoryFilter;
      const matchesBrand = brandFilter === "all" || row.brand === brandFilter;
      return matchesSearch && matchesStatus && matchesCategory && matchesBrand;
    });
  }, [rows, search, statusFilter, categoryFilter, brandFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const start = (currentPage - 1) * pageSize;
  const visibleRows = filteredRows.slice(start, start + pageSize);

  useEffect(() => {
    if (currentPage !== page) {
      const timer = window.setTimeout(() => {
        setPage(currentPage);
      }, 0);
      return () => window.clearTimeout(timer);
    }
  }, [currentPage, page]);

  const selectedCount = selectedIds.length;

  const toggleSelected = (id) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const toggleAll = () => {
    const visibleIds = visibleRows.map((row) => row.id);
    const allSelected = visibleIds.every((id) => selectedIds.includes(id));
    setSelectedIds((prev) =>
      allSelected
        ? prev.filter((id) => !visibleIds.includes(id))
        : Array.from(new Set([...prev, ...visibleIds]))
    );
  };

  const updateLocalStatus = (id, active) => {
    const item = rows.find((row) => row.id === id);
    if (!item) return;
    const status = active ? "active" : "inactive";
    upsertProductMeta({ ...item, active, status });
    setRows((prev) => prev.map((row) => (row.id === id ? { ...row, active, status } : row)));
    setSelectedProduct((prev) => (prev?.id === id ? { ...prev, active, status } : prev));
  };

  const handleDuplicate = async (row) => {
    setOpenActionId(null);
    try {
      const product = await createProduct(duplicateProductPayload(row));

      if (product?.id) {
        upsertProductMeta({
          id: product.id,
          name: product.name || `${row.name} Copy`,
          slug: product.slug || "",
          sku: generateSku(`${row.name} Copy`, product.id),
          category_id: row.category_id || "",
          brand_id: row.brand_id || "",
          main_image_url: "",
          updated_at: new Date().toISOString(),
          active: row.active,
          status: row.status,
        });
      }

      toast.success("تم نسخ المنتج بنجاح");
      await loadProducts();
    } catch (err) {
      console.log(err);
      if (isQuotaExceeded(err)) {
        cleanupProductCache();
        toast.error("تعذر نسخ المنتج بسبب مساحة التخزين المؤقتة، تم تنظيف الكاش حاول مرة أخرى");
      } else {
        toast.error(err?.message || t("common.noData"));
      }
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm(t("products.actions.confirmDelete"))) return;

    try {
      await deleteProduct(id);
      removeProductMeta(id);
      toast.success(t("products.actionsMenu.delete"));
      setSelectedIds((prev) => prev.filter((item) => item !== id));
      setSelectedProduct((prev) => (prev?.id === id ? null : prev));
      await loadProducts();
    } catch (err) {
      console.log(err);
      toast.error(t("common.noData"));
    }
  };

  const handleGenerateMarketingPost = async (product) => {
    if (!canCreateMarketingPost) {
      toast.error("You do not have permission to create marketing posts.");
      return;
    }

    try {
      setMarketingSaving(true);
      const generated = await generateProductMarketingPost(product.id);
      setMarketingEditorPost(generated);
      setMarketingEditorOpen(true);
      toast.success(t("products.actionsMenu.generateMarketingPost"));
    } catch (err) {
      console.error(err);
      const message = Number(err?.status || err?.responseBody?.status) === 403
        ? "You do not have permission to create marketing posts."
        : err?.message || t("common.noData");
      toast.error(message);
    } finally {
      setMarketingSaving(false);
    }
  };

  const handlePublishProductStory = async (product) => {
    if (!canPublishMarketingPost) {
      toast.error("You do not have permission to publish marketing posts.");
      return;
    }
    try {
      setMarketingSaving(true);
      const result = await publishProductStoryEverywhere(product.id);
      if (result?.story_status === "failed") toast.error(result.story_error_message || "Story publish failed");
      else toast.success("Story publish completed");
      await loadProducts();
    } catch (err) {
      toast.error(err?.message || t("common.noData"));
    } finally {
      setMarketingSaving(false);
    }
  };

  const handleScheduleProductStory = async (product) => {
    if (!canUpdateMarketingPost) {
      toast.error("You do not have permission to update marketing posts.");
      return;
    }
    const scheduledAt = window.prompt("Schedule story date/time (YYYY-MM-DDTHH:mm)", new Date(Date.now() + 2 * 60 * 1000).toISOString().slice(0, 16));
    if (!scheduledAt) return;
    try {
      setMarketingSaving(true);
      await scheduleProductStoryEverywhere(product.id, { scheduled_at: scheduledAt });
      toast.success("Story scheduled");
      await loadProducts();
    } catch (err) {
      toast.error(err?.message || t("common.noData"));
    } finally {
      setMarketingSaving(false);
    }
  };

  const handleSaveMarketingDraft = async (payload) => {
    if (marketingEditorPost?.id ? !canUpdateMarketingPost : !canCreateMarketingPost) {
      toast.error("You do not have permission to create marketing posts.");
      return;
    }

    try {
      setMarketingSaving(true);
      if (marketingEditorPost?.id) {
        await updateMarketingPost(marketingEditorPost.id, payload);
      } else {
        await createMarketingPost({ ...payload, status: "draft" });
      }
      toast.success(t("common.update"));
      setMarketingEditorOpen(false);
      await loadProducts();
    } catch (err) {
      toast.error(err?.message || t("common.noData"));
    } finally {
      setMarketingSaving(false);
    }
  };

  const handlePublishMarketingPost = async (payload) => {
    if (!canPublishMarketingPost) {
      toast.error("You do not have permission to publish marketing posts.");
      return;
    }

    try {
      setMarketingSaving(true);
      const saved = marketingEditorPost?.id
        ? await updateMarketingPost(marketingEditorPost.id, payload)
        : await createMarketingPost({ ...payload, status: "draft" });
      const published = await publishMarketingPost(saved.id);
      if (published?.status === "failed") {
        toast.error(published.error_message || "Meta account is not connected yet.");
        return;
      }
      toast.success(t("common.update"));
      setMarketingEditorOpen(false);
      await loadProducts();
    } catch (err) {
      toast.error(err?.message || t("common.noData"));
    } finally {
      setMarketingSaving(false);
    }
  };

  const handleScheduleMarketingPost = async (payload, scheduledAt) => {
    if (!canUpdateMarketingPost) {
      toast.error("You do not have permission to update marketing posts.");
      return;
    }

    try {
      setMarketingSaving(true);
      const saved = marketingEditorPost?.id
        ? await updateMarketingPost(marketingEditorPost.id, payload)
        : await createMarketingPost({ ...payload, status: "draft" });
      await scheduleMarketingPost(saved.id, { scheduled_at: scheduledAt });
      toast.success(t("common.update"));
      setMarketingEditorOpen(false);
      await loadProducts();
    } catch (err) {
      toast.error(err?.message || t("common.noData"));
    } finally {
      setMarketingSaving(false);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.length === 0) return;
    if (!window.confirm(t("products.actions.confirmDeleteMultiple"))) return;

    try {
      await Promise.all(selectedIds.map((id) => deleteProduct(id)));
      selectedIds.forEach((id) => removeProductMeta(id));
      toast.success(t("products.actionsMenu.delete"));
      setSelectedIds([]);
      await loadProducts();
    } catch (err) {
      console.log(err);
      toast.error(t("common.noData"));
    }
  };

  const handleBulkStatus = (active) => {
    selectedIds.forEach((id) => updateLocalStatus(id, active));
    toast.success(active ? t("products.filters.active") : t("products.filters.inactive"));
  };

  const stats = {
    total: rows.length,
    active: rows.filter((row) => row.active !== false).length,
    lowStock: rows.filter((row) => {
      const { isLowStock, isOutOfStock } = getProductStockState(row);
      return isLowStock || isOutOfStock;
    }).length,
    variants: rows.reduce((sum, row) => sum + (Array.isArray(row.variants) ? row.variants.length : row.variant_id ? 1 : 0), 0),
  };

  return (
    <ProductsShell
      title={t("products.title")}
      description={t("products.description")}
      actions={
        <>
          <button
            onClick={() => navigate("/products/add")}
            className="inline-flex items-center gap-2 rounded-full bg-emerald-500 px-5 py-3 font-semibold text-white transition hover:bg-emerald-400"
          >
            <Plus size={18} />
            {t("products.newProduct")}
          </button>
          <button
            onClick={loadProducts}
            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-5 py-3 font-semibold text-white transition hover:bg-white/10"
          >
            <Filter size={18} />
            {t("products.refresh")}
          </button>
        </>
      }
    >
      <div className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          [t("products.stats.totalProducts"), stats.total],
          [t("products.stats.active"), stats.active],
          [t("products.stats.lowStock"), stats.lowStock],
          [t("products.stats.variants"), stats.variants],
        ].map(([label, value]) => (
          <div
            key={label}
            className="rounded-[28px] border border-white/8 bg-zinc-950/80 p-5"
          >
            <p className="text-xs uppercase tracking-[0.28em] text-zinc-500">
              {label}
            </p>
            <h3 className="mt-3 text-3xl font-black text-white">{value}</h3>
          </div>
        ))}
      </div>

      <div className="min-w-0 rounded-[34px] border border-white/8 bg-zinc-950/80 p-5 xl:p-6">
        <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.8fr)_repeat(3,minmax(0,1fr))]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500" size={18} />
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder={t("products.searchPlaceholder")}
              className="w-full rounded-2xl border border-white/8 bg-white/5 py-3 pl-11 pr-4 text-white outline-none placeholder:text-zinc-500"
            />
          </div>

          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(1);
            }}
            className="rounded-2xl border border-white/8 bg-white/5 px-4 py-3 text-white outline-none"
          >
            <option value="all">{t("products.filters.allStatus")}</option>
            <option value="active">{t("products.filters.active")}</option>
            <option value="low">{t("products.filters.lowStock")}</option>
            <option value="inactive">{t("products.filters.inactive")}</option>
          </select>

          <select
            value={categoryFilter}
            onChange={(e) => {
              setCategoryFilter(e.target.value);
              setPage(1);
            }}
            className="rounded-2xl border border-white/8 bg-white/5 px-4 py-3 text-white outline-none"
          >
            {categories.map((category) => (
              <option key={category} value={category}>
                {category === "all" ? t("products.filters.allCategories") : category}
              </option>
            ))}
          </select>

          <select
            value={brandFilter}
            onChange={(e) => {
              setBrandFilter(e.target.value);
              setPage(1);
            }}
            className="rounded-2xl border border-white/8 bg-white/5 px-4 py-3 text-white outline-none"
          >
            {brands.map((brand) => (
              <option key={brand} value={brand}>
                {brand === "all" ? t("products.filters.allBrands") : brand}
              </option>
            ))}
          </select>
        </div>

        {selectedCount > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl border border-emerald-500/15 bg-emerald-500/8 px-4 py-3">
            <span className="text-sm font-semibold text-emerald-300">
              {selectedCount} {t("products.bulk.selected")}
            </span>
            <button
              onClick={handleBulkDelete}
              className="inline-flex items-center gap-2 rounded-full border border-red-500/20 bg-red-500/10 px-4 py-2 text-sm font-semibold text-red-300"
            >
              <Trash2 size={16} />
              {t("products.bulk.delete")}
            </button>
            <button
              onClick={() => handleBulkStatus(true)}
              className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white"
            >
              {t("products.bulk.markActive")}
            </button>
            <button
              onClick={() => handleBulkStatus(false)}
              className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white"
            >
              {t("products.bulk.markInactive")}
            </button>
          </div>
        )}

        {error ? (
          <div className="mt-6 rounded-2xl border border-red-500/20 bg-red-500/10 p-5 text-red-200">
            {error}
          </div>
        ) : null}

        <div className="relative mt-6 max-w-full overflow-visible">
          <div className="overflow-x-auto overflow-visible">
            <table className="min-w-full border-separate border-spacing-y-3">
              <thead>
                <tr className="text-left text-xs uppercase tracking-[0.22em] text-zinc-500">
                  <th className="px-4 py-2">
                    <input
                      type="checkbox"
                      checked={visibleRows.length > 0 && visibleRows.every((row) => selectedIds.includes(row.id))}
                      onChange={toggleAll}
                    />
                  </th>
                  <th className="px-4 py-2">{t("products.table.product")}</th>
                  <th className="px-4 py-2">{t("products.table.skuBarcode")}</th>
                  <th className="px-4 py-2">{t("products.table.categoryBrand")}</th>
                  <th className="px-4 py-2">{t("products.table.stock")}</th>
                  <th className="px-4 py-2">{t("products.table.costSale")}</th>
                  <th className="px-4 py-2">{t("products.table.status")}</th>
                  <th className="px-4 py-2 text-right">{t("products.table.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan="8" className="px-4 py-12 text-center text-zinc-400">
                      {t("products.loading")}
                    </td>
                  </tr>
                ) : visibleRows.length === 0 ? (
                  <tr>
                    <td colSpan="8" className="px-4 py-12 text-center">
                      <div className="mx-auto max-w-sm rounded-3xl border border-white/8 bg-white/5 p-8">
                        <Package2 className="mx-auto text-zinc-500" size={42} />
                        <h3 className="mt-4 text-xl font-black text-white">{t("products.empty.title")}</h3>
                        <p className="mt-2 text-sm text-zinc-400">
                          {t("products.empty.description")}
                        </p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  visibleRows.map((row) => {
                    const { totalStock, lowStockAlert, isLowStock, isOutOfStock } = getProductStockState(row);
                    const statusKey =
                      row.active === false || String(row.status || "").toLowerCase() === "inactive"
                        ? "inactive"
                        : isOutOfStock
                          ? "out"
                          : isLowStock
                            ? "low"
                            : "active";
                    const status =
                      statusKey === "inactive"
                        ? t("products.filters.inactive")
                        : statusKey === "out"
                          ? "Out of stock"
                          : statusKey === "low"
                            ? t("products.filters.lowStock")
                            : t("products.filters.active");
                    return (
                      <tr
                        key={row.id}
                        className={`relative rounded-3xl border border-white/8 bg-white/5 ${openActionId === row.id ? "z-[100]" : "z-0"}`}
                      >
                        <td className="px-4 py-4 align-middle">
                          <input
                            type="checkbox"
                            checked={selectedIds.includes(row.id)}
                            onChange={() => toggleSelected(row.id)}
                          />
                        </td>
                        <td className="px-4 py-4 align-middle">
                          <button
                            type="button"
                            onClick={() => setSelectedProduct(row)}
                            className="flex items-center gap-3 text-left"
                          >
                            <ProductThumbnail row={row} />
                            <div className="min-w-0">
                              <p className="truncate font-semibold text-white">{row.name}</p>
                              <p className="truncate text-sm text-zinc-400">{row.description || t("products.empty.noDescription")}</p>
                            </div>
                          </button>
                        </td>
                        <td className="px-4 py-4 align-middle">
                          <p className="font-semibold text-white">{row.sku || generateSku(row.name, row.id)}</p>
                          <p className="text-sm text-zinc-400">{row.barcode || t("products.records.notGenerated")}</p>
                        </td>
                        <td className="px-4 py-4 align-middle">
                          <p className="font-semibold text-white">{row.category || t("products.selected.category")}</p>
                          <p className="text-sm text-zinc-400">{row.brand || t("products.selected.brand")}</p>
                          <div className="mt-2">
                            <span
                              className={`inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${
                                row.variation_mode === "simple"
                                  ? "bg-sky-500/15 text-sky-300"
                                  : row.variation_mode === "color_only"
                                    ? "bg-cyan-500/15 text-cyan-300"
                                    : "bg-emerald-500/15 text-emerald-300"
                              }`}
                            >
                              {row.variation_mode === "simple"
                                ? t("products.variantMode.simple")
                                : row.variation_mode === "color_only"
                                  ? t("products.variantMode.colorOnly")
                                  : t("products.variantMode.fullVariations")}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-4 align-middle">
                          <p className="font-semibold text-white">{totalStock}</p>
                          <p className="text-sm text-zinc-400">{t("products.stock.lowAlert")} {lowStockAlert}</p>
                        </td>
                        <td className="px-4 py-4 align-middle">
                          <p className="font-semibold text-white">{formatCardPrice(row.cost_price)}</p>
                          <p className="text-sm text-emerald-300">{formatCardPrice(row.sale_price)}</p>
                        </td>
                        <td className="px-4 py-4 align-middle">
                          <span
                            className={`
                              inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold
                              ${
                                statusKey === "active"
                                  ? "bg-emerald-500/15 text-emerald-300"
                                  : statusKey === "low"
                                    ? "bg-amber-500/15 text-amber-300"
                                    : statusKey === "out"
                                      ? "bg-red-500/15 text-red-300"
                                      : "bg-zinc-500/15 text-zinc-300"
                              }
                            `}
                          >
                            {status}
                          </span>
                        </td>
                        <td className="px-4 py-4 align-middle">
                          <div className={`relative flex justify-end ${openActionId === row.id ? "z-[100]" : "z-0"}`}>
                            <button
                              type="button"
                              onClick={() =>
                                setOpenActionId((current) => {
                                  const next = current === row.id ? null : row.id;
                                  console.log("[products:list] toggle action menu", { productId: row.id, nextOpenId: next });
                                  return next;
                                })
                              }
                              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/8 bg-white/5 text-white"
                            >
                              <MoreHorizontal size={18} />
                            </button>

                            {openActionId === row.id ? (
                              <div
                                className="absolute right-0 top-full z-[9999] mt-2 w-48 overflow-hidden rounded-2xl border border-white/8 bg-zinc-950 shadow-2xl"
                                onClick={(event) => event.stopPropagation()}
                              >
                                <button
                                  type="button"
                                  onClick={() => {
                                    console.log("[products:list] action click", { action: "view", productId: row.id });
                                    navigate(`/products/${row.id}`);
                                    setOpenActionId(null);
                                  }}
                                  className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm text-white hover:bg-white/5"
                                >
                                  <Eye size={16} />
                                  {t("products.actionsMenu.view")}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    console.log("[products:list] action click", { action: "edit", productId: row.id });
                                    navigate(`/products/${row.id}/edit`);
                                    setOpenActionId(null);
                                  }}
                                  className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm text-white hover:bg-white/5"
                                >
                                  <Pencil size={16} />
                                  {t("products.actionsMenu.edit")}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    console.log("[products:list] action click", { action: "duplicate", productId: row.id });
                                    handleDuplicate(row);
                                    setOpenActionId(null);
                                  }}
                                  className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm text-white hover:bg-white/5"
                                >
                                  <Copy size={16} />
                                  {t("products.actionsMenu.duplicate")}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    console.log("[products:list] action click", { action: "toggle-status", productId: row.id, active: row.active });
                                    updateLocalStatus(row.id, !(row.active !== false));
                                    setOpenActionId(null);
                                  }}
                                  className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm text-white hover:bg-white/5"
                                >
                                  <ChevronDown size={16} />
                                  {t("products.actionsMenu.toggleStatus")}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    console.log("[products:list] action click", { action: "print-barcode", productId: row.id });
                                    navigate(`/products/barcode-labels?productId=${encodeURIComponent(row.id)}&availableOnly=true`);
                                    setOpenActionId(null);
                                  }}
                                  className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm text-white hover:bg-white/5"
                                >
                                  <Barcode size={16} />
                                  {t("products.actionsMenu.printBarcode")}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    console.log("[products:list] action click", { action: "barcode-shop", productId: row.id });
                                    navigate(`/products/labels?mode=barcode-shop&productId=${encodeURIComponent(row.id)}`);
                                    setOpenActionId(null);
                                  }}
                                  className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm text-white hover:bg-white/5"
                                >
                                  <Barcode size={16} />
                                  {t("products.actionsMenu.barcodeShop")}
                                </button>
                                {canCreateMarketingPost ? (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      console.log("[products:list] action click", { action: "generate-marketing-post", productId: row.id });
                                      handleGenerateMarketingPost(row);
                                      setOpenActionId(null);
                                    }}
                                    className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm text-white hover:bg-white/5"
                                  >
                                    <Megaphone size={16} />
                                    {t("products.actionsMenu.generateMarketingPost")}
                                  </button>
                                ) : null}
                                {canPublishMarketingPost ? (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      console.log("[products:list] action click", { action: "generate-fast-story", productId: row.id });
                                      handlePublishProductStory(row);
                                      setOpenActionId(null);
                                    }}
                                    className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm text-white hover:bg-white/5"
                                  >
                                    <Zap size={16} />
                                    Generate Fast Story
                                  </button>
                                ) : null}
                                {canUpdateMarketingPost ? (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      console.log("[products:list] action click", { action: "schedule-story", productId: row.id });
                                      handleScheduleProductStory(row);
                                      setOpenActionId(null);
                                    }}
                                    className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm text-white hover:bg-white/5"
                                  >
                                    <CalendarClock size={16} />
                                    Schedule Story
                                  </button>
                                ) : null}
                                <button
                                  type="button"
                                  onClick={() => {
                                    console.log("[products:list] action click", { action: "delete", productId: row.id });
                                    handleDelete(row.id);
                                    setOpenActionId(null);
                                  }}
                                  className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm text-red-300 hover:bg-red-500/10"
                                >
                                  <Trash2 size={16} />
                                  {t("products.actionsMenu.delete")}
                                </button>
                              </div>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-6 flex flex-col gap-4 border-t border-white/8 pt-5 lg:flex-row lg:items-center lg:justify-between">
          <p className="text-sm text-zinc-400">
            Showing {visibleRows.length ? start + 1 : 0}-{Math.min(start + pageSize, filteredRows.length)} of {filteredRows.length}
          </p>

          <div className="flex flex-wrap items-center gap-3">
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
              className="rounded-2xl border border-white/8 bg-white/5 px-4 py-2 text-white outline-none"
            >
              {pageSizeOptions.map((option) => (
                <option key={option} value={option}>
                  {option} {t("products.page.perPage")}
                </option>
              ))}
            </select>

            <button
              disabled={currentPage <= 1}
              onClick={() => setPage((prev) => Math.max(1, prev - 1))}
              className="rounded-2xl border border-white/8 bg-white/5 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
            >
              {t("products.page.previous")}
            </button>
            <span className="text-sm text-zinc-400">
              {t("products.page.showing")} {currentPage} {t("products.page.of")} {totalPages}
            </span>
            <button
              disabled={currentPage >= totalPages}
              onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
              className="rounded-2xl border border-white/8 bg-white/5 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
            >
              {t("products.page.next")}
            </button>
          </div>
        </div>
      </div>

      {selectedProduct ? (
        <div className="rounded-[34px] border border-white/8 bg-zinc-950/80 p-6">
          <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
            <div className="max-w-3xl">
              <p className="text-xs uppercase tracking-[0.28em] text-zinc-500">{t("products.selected.title")}</p>
              <h2 className="mt-3 text-3xl font-black text-white">{selectedProduct.name}</h2>
              <p className="mt-3 text-zinc-400">{selectedProduct.description || t("products.empty.firstDescription")}</p>
            </div>
            <Link
              to="/products/add"
              className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-5 py-3 font-semibold text-white"
            >
              <Plus size={18} />
              {t("products.selected.createSimilar")}
            </Link>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            {[
              [t("products.selected.sku"), selectedProduct.sku || generateSku(selectedProduct.name, selectedProduct.id)],
              [t("products.selected.barcode"), selectedProduct.barcode || t("products.records.notGenerated")],
              [t("products.selected.brand"), selectedProduct.brand || t("products.records.unbranded")],
              [t("products.selected.category"), selectedProduct.category || t("products.records.uncategorized")],
            ].map(([label, value]) => (
              <div key={label} className="rounded-2xl border border-white/8 bg-white/5 p-4">
                <p className="text-xs uppercase tracking-[0.28em] text-zinc-500">{label}</p>
                <p className="mt-2 text-lg font-semibold text-white">{value}</p>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {!loading && !error && products.length === 0 ? (
        <div className="rounded-[34px] border border-white/8 bg-zinc-950/80 p-12 text-center">
          <AlertTriangle className="mx-auto text-amber-400" size={40} />
          <h3 className="mt-4 text-2xl font-black text-white">{t("products.empty.catalogTitle")}</h3>
          <p className="mt-2 text-zinc-400">{t("products.empty.catalogDescription")}</p>
          <button
            onClick={() => navigate("/products/add")}
            className="mt-6 inline-flex items-center gap-2 rounded-full bg-emerald-500 px-5 py-3 font-semibold text-white"
          >
            <Plus size={18} />
            {t("products.newProduct")}
          </button>
        </div>
      ) : null}

      {marketingEditorOpen ? (
        <PostEditorModal
          open={marketingEditorOpen}
          post={marketingEditorPost}
          onClose={() => setMarketingEditorOpen(false)}
          onSaveDraft={(marketingEditorPost?.id ? canUpdateMarketingPost : canCreateMarketingPost) ? handleSaveMarketingDraft : null}
          onPublish={canPublishMarketingPost ? handlePublishMarketingPost : null}
          onSchedule={canUpdateMarketingPost ? handleScheduleMarketingPost : null}
          saving={marketingSaving}
          title={t("products.actionsMenu.generateMarketingPost")}
        />
      ) : null}
    </ProductsShell>
  );
}

export default ProductsList;
