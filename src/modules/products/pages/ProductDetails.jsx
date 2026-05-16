import { useEffect, useMemo, useState } from "react";

import { Link, useNavigate, useParams } from "react-router-dom";

import {
  ArrowLeft,
  Barcode,
  Clock3,
  Copy,
  Image as ImageIcon,
  Loader2,
  Package2,
  Pencil,
  QrCode,
  RotateCcw,
} from "lucide-react";
import toast from "react-hot-toast";

import { api } from "../../../shared/api/api";
import { hasPermission } from "../../../shared/auth/authStorage";
import ProductsShell from "../components/ProductsShell";
import { createProduct, getProductsWithVariants, normalizeVariantPayload } from "../services/productsApi";
import { formatCurrency } from "../../../shared/lib/currency";
import { cleanupProductCache } from "../lib/catalog";

const isQuotaExceeded = (error) =>
  error?.name === "QuotaExceededError" ||
  error?.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
  error?.code === 22 ||
  error?.code === 1014 ||
  /quota/i.test(String(error?.message || ""));

const duplicateVariantPayload = (variant = {}, group = {}) =>
  normalizeVariantPayload({
    color: variant.color || group.color || "",
    size: variant.size || "",
    sku: "",
    barcode: "",
    stock: variant.stock,
    sale_price: variant.sale_price ?? variant.price,
    price: variant.price ?? variant.sale_price,
    cost_price: variant.cost_price,
    manufacturer_id: variant.manufacturer_id || group.manufacturer_id || null,
  });

const placeholderImage = (label = "Product image") =>
  `data:image/svg+xml;utf8,${encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 360" role="img" aria-label="${label}">
      <rect width="480" height="360" rx="28" fill="#0f172a"/>
      <rect x="20" y="20" width="440" height="320" rx="22" fill="#111827" stroke="#334155"/>
      <g fill="none" stroke="#64748b" stroke-width="10" stroke-linecap="round" stroke-linejoin="round">
        <path d="M128 242c22-8 42-18 64-38 29-27 57-61 95-81 12-6 27-7 39-2 17 6 35 20 55 44 19 23 39 41 60 50 21 10 40 20 50 37 6 10 4 22-4 30-8 7-19 11-31 11H180c-20 0-42-7-55-17-11-8-14-24 3-34z"/>
        <path d="M150 240c22 12 41 18 60 18h196"/>
        <path d="M192 202h108"/>
        <path d="M218 172h104"/>
        <path d="M244 142h88"/>
      </g>
      <text x="240" y="308" text-anchor="middle" fill="#94a3b8" font-family="Arial, sans-serif" font-size="24" font-weight="700">${label}</text>
    </svg>
  `)}`;

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

const normalizeGallery = (value) => {
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string") return item.trim();
        if (item && typeof item === "object") {
          return String(item.url || item.image_url || item.image || item.path || "").trim();
        }
        return String(item || "").trim();
      })
      .filter(Boolean);
  }
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? normalizeGallery(parsed) : [value.trim()];
    } catch {
      return [value.trim()];
    }
  }
  return [];
};

const normalizeRowVariant = (row = {}) => {
  const source = row.variant || row;
  return {
    id: source.id ?? source.variant_id ?? source.variantId ?? null,
    variant_id: source.variant_id ?? source.variantId ?? source.id ?? null,
    color: String(source.color || source.color_name || source.colorName || "").trim(),
    size: String(source.size || source.size_name || source.sizeName || "").trim(),
    sku: String(source.sku || source.variant_sku || "").trim(),
    barcode: String(source.barcode || source.variant_barcode || "").trim(),
    stock: Number(source.stock ?? source.variant_stock ?? source.quantity ?? source.qty ?? 0),
    price: Number(source.price ?? source.sale_price ?? source.salePrice ?? source.variant_sale_price ?? 0),
    sale_price: Number(source.sale_price ?? source.price ?? source.salePrice ?? source.variant_sale_price ?? 0),
    cost_price: Number(source.cost_price ?? source.purchase_price ?? source.variant_cost_price ?? 0),
    manufacturer_id: source.manufacturer_id ?? source.manufacturerId ?? source.variant_manufacturer_id ?? null,
    manufacturer_name: source.manufacturer_name || source.manufacturerName || source.manufacturer || "",
    images: Array.isArray(source.images) ? source.images : Array.isArray(source.color_images) ? source.color_images : [],
    image_url: resolveImageUrl(
      source.variant_image_url ||
        source.color_image_url ||
        source.image_url ||
        source.image ||
        source.photo_url ||
        source.thumbnail_url ||
        row.variant_image_url ||
        row.color_image_url ||
        row.image_url ||
        row.product_image_url
    ),
    product_image_url: resolveImageUrl(source.product_image_url || row.product_image_url || row.image_url),
  };
};

const normalizeProductRow = (row = {}) => {
  const productSource = row.product || row;
  return {
    ...productSource,
    id: productSource.id ?? row.product_id ?? row.id ?? null,
    product_id: row.product_id ?? productSource.id ?? row.id ?? null,
    name: productSource.name || row.product_name || "Unnamed product",
    description: productSource.description || "",
    status: productSource.status || row.status || "active",
    category: productSource.category || row.category || "Uncategorized",
    brand: productSource.brand || row.brand || "Unbranded",
    gender: productSource.gender || row.gender || "",
    product_type: productSource.product_type || row.product_type || "",
    style: productSource.style || row.style || "",
    grade: productSource.grade || row.grade || "",
    variation_mode: productSource.variation_mode || row.variation_mode || "full_variations",
    fixed_size_label: productSource.fixed_size_label || row.fixed_size_label || "",
    category_id: productSource.category_id ?? row.category_id ?? "",
    brand_id: productSource.brand_id ?? row.brand_id ?? "",
    unit_id: productSource.unit_id ?? row.unit_id ?? "",
    sale_price: Number(productSource.sale_price ?? row.sale_price ?? row.product_sale_price ?? row.price ?? 0),
    cost_price: Number(productSource.cost_price ?? row.cost_price ?? row.product_cost_price ?? 0),
    wholesale_price: Number(productSource.wholesale_price ?? row.wholesale_price ?? row.product_wholesale_price ?? 0),
    stock: Number(productSource.stock ?? row.stock ?? row.product_stock ?? 0),
    image_url: resolveImageUrl(
      productSource.image_url ||
        productSource.product_image_url ||
        row.product_image_url ||
        row.image_url ||
        row.image ||
        row.photo_url ||
        row.thumbnail_url
    ),
    gallery_images: normalizeGallery(productSource.gallery_images ?? row.gallery_images),
    qr_token: productSource.qr_token || row.qr_token || "",
  };
};

const getVariantKey = (variant, index) =>
  [
    variant.variant_id || variant.id || "variant",
    variant.color || "color",
    variant.size || "size",
    variant.sku || "sku",
    index,
  ].join("-");

const groupVariantsByColor = (variants = []) => {
  const groups = variants.reduce((acc, variant, index) => {
    const color = String(variant.color || "Default").trim() || "Default";
    const key = color.toLowerCase();
    if (!acc[key]) {
      const primaryImage = Array.isArray(variant.images) && variant.images.length
        ? variant.images.find((image) => image.is_primary) || variant.images[0]
        : null;
      acc[key] = {
        color,
        image_url: primaryImage?.image_url || variant.image_url || variant.product_image_url || "",
        images: Array.isArray(variant.images) ? variant.images : [],
        manufacturer_id: variant.manufacturer_id || "",
        manufacturer_name: variant.manufacturer_name || "",
        rows: [],
      };
    }

    if (Array.isArray(variant.images) && variant.images.length > 0) {
      const merged = [...acc[key].images, ...variant.images];
      acc[key].images = merged.filter((item, itemIndex, array) => array.findIndex((candidate) => String(candidate.image_url || candidate.preview || "") === String(item.image_url || item.preview || "")) === itemIndex);
      const primary = acc[key].images.find((image) => image.is_primary) || acc[key].images[0];
      if (primary?.image_url) {
        acc[key].image_url = primary.image_url;
      }
    }

    if (!acc[key].image_url && (variant.image_url || variant.product_image_url)) {
      acc[key].image_url = variant.image_url || variant.product_image_url || "";
    }
    if (!acc[key].manufacturer_name && variant.manufacturer_name) {
      acc[key].manufacturer_name = variant.manufacturer_name;
    }
    if (!acc[key].manufacturer_id && variant.manufacturer_id !== null && variant.manufacturer_id !== undefined && variant.manufacturer_id !== "") {
      acc[key].manufacturer_id = variant.manufacturer_id;
    }

    acc[key].rows.push({
      ...variant,
      _key: getVariantKey(variant, index),
    });
    return acc;
  }, {});

  return Object.values(groups);
};

const variantPrimaryImage = (variant = {}) => {
  const images = Array.isArray(variant.images) ? variant.images : [];
  const primary = images.find((image) => image.is_primary) || images[0] || null;
  return primary?.image_url || variant.image_url || variant.variant_image_url || variant.color_image_url || "";
};

const UNDOABLE_STOCK_MOVEMENT_TYPES = new Set(["product_stock_edit", "manual_adjustment"]);

const formatDateTime = (value) => {
  if (!value) return "n/a";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString();
};

function ProductDetails() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [product, setProduct] = useState(null);
  const [stockMovements, setStockMovements] = useState([]);
  const [stockMovementsLoading, setStockMovementsLoading] = useState(false);
  const [undoingMovementId, setUndoingMovementId] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        setLoading(true);
        setError("");

        const routeProductId = Number(id);
        console.log("[product-details] route productId", routeProductId);

        const rows = await getProductsWithVariants();
        const safeRows = Array.isArray(rows) ? rows : [];

        const matchedRow =
          safeRows.find((row) => Number(row.product_id ?? row.id ?? row.product?.id) === routeProductId) ||
          safeRows.find((row) => Number(row.id ?? row.product?.id) === routeProductId);

        console.log("[product-details] matched product", matchedRow || null);

        if (!active) return;

        if (!matchedRow) {
          setProduct(null);
          setError("Product not found");
          return;
        }

        const productBase = normalizeProductRow(matchedRow);
        const nestedVariants = Array.isArray(matchedRow.product?.variants)
          ? matchedRow.product.variants
          : Array.isArray(matchedRow.variants)
            ? matchedRow.variants
            : [];

        const flatVariants = safeRows.filter((row) => Number(row.product_id ?? row.id ?? row.product?.id) === routeProductId && (row.variant_id || Number(row.id) !== routeProductId));
        const rawVariants = nestedVariants.length > 0 ? nestedVariants : flatVariants;
        const normalizedVariants = rawVariants
          .map((variant) => normalizeRowVariant({ ...matchedRow, ...variant }))
          .filter((variant) => variant.variant_id || variant.color || variant.size || variant.sku || variant.barcode);

        if (productBase.variation_mode === "simple") {
          setProduct({
            ...productBase,
            variants: [],
            groupedVariants: [],
          });
          return;
        }

        console.log("[product-details] matched variants count", normalizedVariants.length);

        const groupedVariants = groupVariantsByColor(normalizedVariants);
        console.log("[product-details] grouped variants", groupedVariants);
        const fallbackImage =
          groupedVariants.find((group) => group.image_url)?.image_url ||
          normalizedVariants.find((variant) => variantPrimaryImage(variant))?.image_url ||
          productBase.image_url ||
          productBase.public_image_url ||
          "";

        setProduct({
          ...productBase,
          image_url: fallbackImage || productBase.image_url || "",
          public_image_url: fallbackImage || productBase.public_image_url || "",
          variants: normalizedVariants,
          groupedVariants,
        });
      } catch (err) {
        console.log(err);
        if (!active) return;
        setError(err?.message || "Failed to load product details");
        toast.error(err?.message || "Failed to load product details");
      } finally {
        if (active) setLoading(false);
      }
    };

    load();

    return () => {
      active = false;
    };
  }, [id, refreshKey]);

  useEffect(() => {
    let active = true;

    const loadStockMovements = async () => {
      try {
        setStockMovementsLoading(true);
        const params = new URLSearchParams({
          product_id: String(id || ""),
          limit: "25",
          page: "1",
        });
        const response = await api.get(`/inventory/movements?${params.toString()}`);
        if (!active) return;
        setStockMovements(Array.isArray(response?.movements) ? response.movements : []);
      } catch (err) {
        console.log(err);
        if (!active) return;
        setStockMovements([]);
      } finally {
        if (active) setStockMovementsLoading(false);
      }
    };

    if (id) {
      loadStockMovements();
    }

    return () => {
      active = false;
    };
  }, [id, refreshKey]);

  const totalStock = useMemo(
    () => Number(product?.variants?.reduce((sum, variant) => sum + Number(variant.stock || 0), 0) || product?.stock || 0),
    [product]
  );

  const productGallery = useMemo(() => product?.gallery_images || [], [product]);
  const latestMovementIdByVariant = useMemo(() => {
    const latest = new Map();
    for (const movement of stockMovements) {
      const variantId = movement.variant_id;
      if (variantId === null || variantId === undefined || latest.has(String(variantId))) continue;
      latest.set(String(variantId), movement.id);
    }
    return latest;
  }, [stockMovements]);

  const handleDuplicate = async () => {
    if (!product) return;

    try {
      const payload = {
        name: `${product.name} Copy`,
        description: product.description || "",
        category: product.category || "Uncategorized",
        category_id: product.category_id || null,
        brand: product.brand || "Unbranded",
        brand_id: product.brand_id || null,
        gender: product.gender || "",
        product_type: product.product_type || "",
        style: product.style || "",
        grade: product.grade || "",
        variation_mode: product.variation_mode || "full_variations",
        fixed_size_label: product.fixed_size_label || "",
        unit_id: product.unit_id || null,
        sale_price: Number(product.sale_price || 0),
        cost_price: Number(product.cost_price || 0),
        wholesale_price: Number(product.wholesale_price || 0),
        price: Number(product.sale_price || 0),
        stock: Number(product.stock || 0),
        image_url: "",
        gallery: [],
        colorImages: [],
        variants:
          product.variation_mode === "simple"
            ? []
            : (product.groupedVariants || []).flatMap((group) =>
                (group.rows || []).map((variant) =>
                  duplicateVariantPayload(variant, group)
                )
              ),
      };

      const created = await createProduct(payload);
      toast.success("تم نسخ المنتج بنجاح");
      navigate(`/products/${created?.id || created?.product?.id || ""}/edit`);
    } catch (err) {
      console.log(err);
      if (isQuotaExceeded(err)) {
        cleanupProductCache();
        toast.error("تعذر نسخ المنتج بسبب مساحة التخزين المؤقتة، تم تنظيف الكاش حاول مرة أخرى");
      } else {
        toast.error(err?.message || "Failed to duplicate product");
      }
    }
  };

  const handleUndoMovement = async (movement) => {
    if (!movement?.id || undoingMovementId) return;

    const confirmed = window.confirm("Undo this stock adjustment? This will reverse the stock change and record an undo movement.");
    if (!confirmed) return;

    try {
      setUndoingMovementId(movement.id);
      await api.post(`/inventory/movements/${movement.id}/undo`, {});
      toast.success("Stock adjustment undone");
      setRefreshKey((value) => value + 1);
      window.dispatchEvent(new CustomEvent("inventory:stock-updated", { detail: { productId: product?.id, movementId: movement.id } }));
    } catch (err) {
      console.log(err);
      toast.error(err?.message || "Failed to undo stock adjustment");
    } finally {
      setUndoingMovementId(null);
    }
  };

  return (
    <ProductsShell
      title="Product Details"
      description="Complete product view with grouped variants, stock, pricing, gallery media, and quick actions."
      actions={
        <Link
          to="/products"
          className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-5 py-3 font-semibold text-white transition hover:bg-white/10"
        >
          <ArrowLeft size={18} />
          Back to products
        </Link>
      }
    >
      {loading ? (
        <div className="rounded-[34px] border border-white/8 bg-zinc-950/80 p-10 text-center text-zinc-400">
          <Loader2 className="mx-auto h-10 w-10 animate-spin text-emerald-400" />
          <p className="mt-4 text-sm font-semibold text-white">Loading product details...</p>
        </div>
      ) : error ? (
        <div className="rounded-[34px] border border-red-500/20 bg-red-500/10 p-8 text-red-100">
          <p className="text-lg font-black text-white">{error}</p>
          <button
            type="button"
            onClick={() => navigate("/products")}
            className="mt-4 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white"
          >
            <ArrowLeft size={16} />
            Back
          </button>
        </div>
      ) : product ? (
        <div className="space-y-6">
          <section className="rounded-[34px] border border-white/8 bg-zinc-950/80 p-6 shadow-[0_24px_80px_rgba(0,0,0,0.22)]">
            <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
              <div className="space-y-3">
                <div className="overflow-hidden rounded-[28px] border border-white/10 bg-white/5">
                  <img
                    src={product.image_url || product.public_image_url || placeholderImage(product.name)}
                    alt={product.name}
                    className="h-[320px] w-full object-contain p-4"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <ActionButton icon={Pencil} label="Edit product" onClick={() => navigate(`/products/${product.id}/edit`)} />
                  <ActionButton icon={Barcode} label="Print barcode" onClick={() => navigate(`/products/barcode-labels?productId=${encodeURIComponent(product.id)}&availableOnly=true`)} />
                  <ActionButton icon={QrCode} label="Barcode shop QR" onClick={() => navigate(`/products/labels?mode=barcode-shop&productId=${encodeURIComponent(product.id)}`)} />
                  <ActionButton icon={Copy} label="Duplicate" onClick={handleDuplicate} />
                </div>
              </div>

              <div className="space-y-5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-300">
                    {String(product.status || "active")}
                  </span>
                  <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-zinc-300">
                    {product.category || "Uncategorized"}
                  </span>
                  <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-zinc-300">
                    {product.brand || "Unbranded"}
                  </span>
                </div>

                <div>
                  <h1 className="text-4xl font-black tracking-tight text-white">{product.name}</h1>
                  <p className="mt-3 max-w-4xl text-sm leading-7 text-zinc-400">
                    {product.description || "No description available."}
                  </p>
                </div>

                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  <InfoCard label="Sale price" value={formatCurrency(product.sale_price)} />
                  <InfoCard label="Cost price" value={formatCurrency(product.cost_price)} />
                  <InfoCard label="Wholesale price" value={formatCurrency(product.wholesale_price)} />
                  <InfoCard label="Total stock" value={Number(totalStock || 0).toLocaleString()} />
                </div>

                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <DetailCard label="Category ID" value={product.category_id || "n/a"} />
                  <DetailCard label="Brand ID" value={product.brand_id || "n/a"} />
                  <DetailCard label="Unit ID" value={product.unit_id || "n/a"} />
                  <DetailCard label="QR token" value={product.qr_token || "n/a"} />
                </div>
              </div>
            </div>
          </section>

          <section className="rounded-[34px] border border-white/8 bg-zinc-950/80 p-6 shadow-[0_24px_80px_rgba(0,0,0,0.22)]">
            <div className="flex items-center gap-3">
              <Package2 className="text-emerald-400" />
              <div>
                <h2 className="text-2xl font-black text-white">Variant groups</h2>
                <p className="mt-1 text-sm text-zinc-400">Grouped by color with size-level stock, SKU, barcode, and price details.</p>
              </div>
            </div>

            {(product.groupedVariants || []).length > 0 ? (
              <div className="mt-5 space-y-4">
                {product.groupedVariants.map((group) => (
                  <div key={group.color.toLowerCase()} className="rounded-[28px] border border-white/10 bg-white/5 p-4">
                    <div className="grid gap-4 xl:grid-cols-[180px_minmax(0,1fr)]">
                      <div className="overflow-hidden rounded-[24px] border border-white/10 bg-zinc-950/70">
                        <img
                          src={group.image_url || group.images?.find((image) => image.is_primary)?.image_url || product.image_url || placeholderImage(group.color)}
                          alt={`${product.name} ${group.color}`}
                          className="h-[180px] w-full object-contain p-3"
                        />
                      </div>

                      <div className="space-y-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <h3 className="text-xl font-black text-white">{group.color}</h3>
                            <p className="mt-1 text-sm text-zinc-400">
                              Manufacturer: {group.manufacturer_name || (group.manufacturer_id ? `#${group.manufacturer_id}` : "n/a")}
                            </p>
                          </div>
                          <div className="text-sm text-zinc-400">
                            {group.rows.length} size{group.rows.length === 1 ? "" : "s"}
                          </div>
                        </div>

                        {Array.isArray(group.images) && group.images.length > 1 ? (
                          <div className="flex flex-wrap gap-2">
                            {group.images.slice(0, 6).map((image, imageIndex) => (
                              <div
                                key={image.id || `${group.color}-${imageIndex}`}
                                className={`h-14 w-14 overflow-hidden rounded-2xl border ${
                                  image.is_primary ? "border-emerald-400/60" : "border-white/10"
                                } bg-zinc-950/70`}
                              >
                                <img src={image.image_url || image.preview} alt={image.name || group.color} className="h-full w-full object-cover" />
                              </div>
                            ))}
                          </div>
                        ) : null}

                        <div className="overflow-x-auto rounded-3xl border border-white/10">
                          <table className="min-w-full border-separate border-spacing-0 text-sm">
                            <thead className="bg-white/5 text-zinc-400">
                              <tr>
                                <th className="px-4 py-3 text-left">Size</th>
                                <th className="px-4 py-3 text-left">Stock</th>
                                <th className="px-4 py-3 text-left">SKU</th>
                                <th className="px-4 py-3 text-left">Barcode</th>
                                <th className="px-4 py-3 text-left">Price</th>
                                <th className="px-4 py-3 text-left">History</th>
                              </tr>
                            </thead>
                            <tbody>
                              {group.rows.map((variant) => (
                                <tr key={variant._key} className="border-t border-white/10">
                                  <td className="px-4 py-3 font-semibold text-white">{variant.size || "One size"}</td>
                                  <td className="px-4 py-3 text-zinc-300 tabular-nums">{Number(variant.stock || 0)}</td>
                                  <td className="px-4 py-3 text-zinc-300">{variant.sku || "n/a"}</td>
                                  <td className="px-4 py-3 text-zinc-300">{variant.barcode || "n/a"}</td>
                                  <td className="px-4 py-3 font-semibold text-emerald-300">{formatCurrency(variant.price || variant.sale_price)}</td>
                                  <td className="px-4 py-3">
                                    <Link
                                      to={`/inventory/variant/${variant.variant_id || variant.id}/history?productId=${product.id}`}
                                      className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
                                    >
                                      <Clock3 className="h-4 w-4" />
                                      History
                                    </Link>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-5 rounded-[28px] border border-dashed border-white/10 bg-white/5 p-8 text-center">
                <p className="text-lg font-black text-white">No variants found. Add variants from Edit Product.</p>
                <button
                  type="button"
                  onClick={() => navigate(`/products/${product.id}/edit`)}
                  className="mt-4 inline-flex items-center gap-2 rounded-2xl bg-emerald-500 px-4 py-2 text-sm font-black text-black transition hover:bg-emerald-400"
                >
                  <Pencil className="h-4 w-4" />
                  Edit product
                </button>
              </div>
            )}
          </section>

          <section className="rounded-[34px] border border-white/8 bg-zinc-950/80 p-6 shadow-[0_24px_80px_rgba(0,0,0,0.22)]">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <Clock3 className="text-cyan-400" />
                <div>
                  <h2 className="text-2xl font-black text-white">Stock History</h2>
                  <p className="mt-1 text-sm text-zinc-400">Recent inventory movements recorded for this product.</p>
                </div>
              </div>
              <Link
                to={`/inventory/history?productId=${encodeURIComponent(product.id)}`}
                className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
              >
                Full history
              </Link>
            </div>

            <div className="mt-5 overflow-x-auto rounded-3xl border border-white/10">
              <table className="min-w-full border-separate border-spacing-0 text-sm">
                <thead className="bg-white/5 text-zinc-400">
                  <tr>
                    <th className="px-4 py-3 text-left">Date</th>
                    <th className="px-4 py-3 text-left">Product</th>
                    <th className="px-4 py-3 text-left">Color</th>
                    <th className="px-4 py-3 text-left">Size</th>
                    <th className="px-4 py-3 text-left">Before</th>
                    <th className="px-4 py-3 text-left">Change</th>
                    <th className="px-4 py-3 text-left">After</th>
                    <th className="px-4 py-3 text-left">Reason</th>
                    <th className="px-4 py-3 text-left">User</th>
                    <th className="px-4 py-3 text-left">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {stockMovementsLoading ? (
                    <tr>
                      <td colSpan={10} className="px-4 py-8 text-center text-zinc-400">
                        <Loader2 className="mr-2 inline h-4 w-4 animate-spin text-emerald-400" />
                        Loading stock history...
                      </td>
                    </tr>
                  ) : stockMovements.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="px-4 py-8 text-center text-zinc-400">
                        No stock movements recorded yet.
                      </td>
                    </tr>
                  ) : (
                    stockMovements.map((movement) => {
                      const change = Number(movement.quantity_change || movement.quantity || 0);
                      const undoAllowed =
                        hasPermission("inventory.movements:undo") &&
                        UNDOABLE_STOCK_MOVEMENT_TYPES.has(String(movement.movement_type || "")) &&
                        !movement.undone_at &&
                        latestMovementIdByVariant.get(String(movement.variant_id)) === movement.id;
                      return (
                        <tr key={movement.id} className="border-t border-white/10">
                          <td className="px-4 py-3 text-zinc-300">{formatDateTime(movement.created_at)}</td>
                          <td className="px-4 py-3 font-semibold text-white">{movement.product_name || product.name}</td>
                          <td className="px-4 py-3 text-zinc-300">{movement.variant_color || "Default"}</td>
                          <td className="px-4 py-3 text-zinc-300">{movement.variant_size || "n/a"}</td>
                          <td className="px-4 py-3 text-zinc-300">{Number(movement.quantity_before || 0)}</td>
                          <td className={`px-4 py-3 font-semibold ${change >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
                            {change >= 0 ? "+" : ""}
                            {change}
                          </td>
                          <td className="px-4 py-3 text-zinc-300">{Number(movement.quantity_after || 0)}</td>
                          <td className="px-4 py-3 text-zinc-300">{movement.reason || movement.notes || "n/a"}</td>
                          <td className="px-4 py-3 text-zinc-300">{movement.created_by_name || "n/a"}</td>
                          <td className="px-4 py-3">
                            {movement.undone_at ? (
                              <span className="inline-flex items-center rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-zinc-400">
                                Undone
                              </span>
                            ) : undoAllowed ? (
                              <button
                                type="button"
                                onClick={() => handleUndoMovement(movement)}
                                disabled={undoingMovementId === movement.id}
                                className="inline-flex items-center gap-2 rounded-2xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-sm font-semibold text-amber-200 transition hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                {undoingMovementId === movement.id ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <RotateCcw className="h-4 w-4" />
                                )}
                                Undo
                              </button>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-[34px] border border-white/8 bg-zinc-950/80 p-6 shadow-[0_24px_80px_rgba(0,0,0,0.22)]">
            <div className="flex items-center gap-3">
              <ImageIcon className="text-cyan-400" />
              <div>
                <h2 className="text-2xl font-black text-white">Gallery</h2>
                <p className="mt-1 text-sm text-zinc-400">Product gallery images available on the product record.</p>
              </div>
            </div>

            {(productGallery || []).length > 0 ? (
              <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {productGallery.map((image, index) => (
                  <div key={`${image}-${index}`} className="overflow-hidden rounded-[24px] border border-white/10 bg-white/5">
                    <img src={resolveImageUrl(image)} alt={`${product.name} gallery ${index + 1}`} className="h-48 w-full object-contain p-3" />
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-5 rounded-[28px] border border-dashed border-white/10 bg-white/5 p-8 text-sm text-zinc-400">
                No gallery images available.
              </div>
            )}
          </section>
        </div>
      ) : null}
    </ProductsShell>
  );
}

function ActionButton({ icon: Icon, label, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}

function InfoCard({ label, value }) {
  return (
    <div className="rounded-2xl border border-white/8 bg-white/5 p-4">
      <p className="text-xs uppercase tracking-[0.28em] text-zinc-500">{label}</p>
      <p className="mt-2 text-lg font-semibold text-white">{value}</p>
    </div>
  );
}

function DetailCard({ label, value }) {
  return (
    <div className="rounded-2xl border border-white/8 bg-white/5 p-4">
      <p className="text-[10px] uppercase tracking-[0.24em] text-zinc-500">{label}</p>
      <p className="mt-2 break-all text-sm font-semibold text-white">{value}</p>
    </div>
  );
}

export default ProductDetails;
