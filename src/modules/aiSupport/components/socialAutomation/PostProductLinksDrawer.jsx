import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, GripVertical, Loader2, Plus, RefreshCw, Search, SlidersHorizontal, Star, Trash2, X } from "lucide-react";
import toast from "react-hot-toast";

import {
  getPostProductLinks,
  getStorefrontBrandOptions,
  removePostProductLink,
  savePostProductLinks,
  searchStorefrontProducts,
} from "../../services/postProductMappingApi.js";
import { resolveProductImageUrl } from "../../../../shared/lib/imageUrls.js";

const clean = (value = "") => String(value ?? "").trim();
const PRODUCT_TYPE_OPTIONS = [
  { value: "sneakers", label: "Sneakers" },
  { value: "shoes", label: "Shoes" },
  { value: "running", label: "Running" },
  { value: "casualshoes", label: "Casual shoes" },
  { value: "crocs", label: "Crocs" },
  { value: "slippers", label: "Slippers" },
  { value: "bags", label: "Bags" },
];
const SIZE_OPTIONS = ["37", "38", "39", "40", "41", "42", "43", "44", "45"];

const FilterSelect = ({ label, value, options = [], onChange }) => (
  <label className="relative min-w-0">
    <span className="sr-only">{label}</span>
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={`h-11 w-full appearance-none rounded-xl border px-3 pr-9 text-xs font-bold outline-none transition ${value ? "border-emerald-300/30 bg-emerald-400/10 text-emerald-100" : "border-white/10 bg-white/[0.04] text-slate-300"}`}
    >
      <option value="">All {label.toLowerCase()}</option>
      {options.map((option) => {
        const safeOption = typeof option === "string" ? { value: option, label: option } : option;
        return <option key={safeOption.value} value={safeOption.value}>{safeOption.label}</option>;
      })}
    </select>
    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
  </label>
);
const isSocialDebugEnabled = () => import.meta.env.DEV && window.localStorage.getItem("social_debug") === "1";
const socialDebugLog = (...args) => {
  if (isSocialDebugEnabled()) console.log(...args);
};

const enabledFlag = (value) =>
  value === true || value === 1 || ["true", "1", "yes", "on"].includes(clean(value).toLowerCase());

const productDisplayPrice = (raw = {}) => {
  const sellingPrice = Number(raw.selling_price ?? raw.price ?? raw.regular_price ?? raw.final_price ?? 0) || 0;
  const salePrice = Number(raw.sale_price ?? 0) || 0;
  const saleModeOn = enabledFlag(raw.sale_mode_enabled) || enabledFlag(raw.global_sale_enabled) || enabledFlag(raw.sale_prices_enabled);
  const saleApplied = saleModeOn && enabledFlag(raw.sale_mode_applied) && salePrice > 0 && (sellingPrice <= 0 || salePrice < sellingPrice);
  return saleApplied ? salePrice : sellingPrice;
};

const normalizeProduct = (raw = {}) => {
  // The API returns "/uploads/products/..." relative. On the frontend origin that path
  // hits the SPA fallback, which answers HTTP 200 with index.html, so the browser gets
  // text/html where an image belongs. resolveProductImageUrl rebases it on the API origin.
  const image = resolveProductImageUrl(
    clean(raw.image_url || raw.product_image_url || raw.cover_image_url || raw.primary_media_url || raw.thumbnail_url || raw.thumbnailUrl || raw.image || raw.main_image || raw.variant_image_url || "")
  );
  const variantSources = [];
  if (Array.isArray(raw.variants)) variantSources.push(...raw.variants);
  if (Array.isArray(raw.product_variants)) variantSources.push(...raw.product_variants);
  if (Array.isArray(raw.variant_stock)) variantSources.push(...raw.variant_stock);
  if (Array.isArray(raw.colors)) variantSources.push(...raw.colors.flatMap((color) => Array.isArray(color?.sizes) ? color.sizes : []));
  const variantStock = variantSources.reduce((sum, variant) => {
    const value = Number(
      variant?.current_stock ??
        variant?.stock_quantity ??
        variant?.stock ??
        variant?.quantity ??
        variant?.available_stock ??
        variant?.available_quantity ??
        variant?.qty ??
        variant?.available_qty ??
        0
    );
    return sum + (Number.isFinite(value) && value > 0 ? value : 0);
  }, 0);
  const currentStock = Number(
    raw.current_stock ??
      raw.total_stock ??
      raw.variant_total_stock ??
      raw.available_stock ??
      raw.available_quantity ??
      raw.stock_quantity ??
      raw.quantity ??
      raw.stock ??
      variantStock ??
      0
  ) || 0;
  const inStock = currentStock > 0;
  const stockLabel = inStock ? "IN STOCK" : "OUT OF STOCK";
  const displayPrice = productDisplayPrice(raw);
  return {
    id: Number(raw.id ?? raw.product_id ?? 0) || 0,
    name: clean(raw.name || raw.title || raw.product_name || "Product"),
    title: clean(raw.title || raw.name || raw.product_name || "Product"),
    brand: clean(raw.brand_name || raw.brand || raw.manufacturer_name || raw.manufacturer || ""),
    image_url: image,
    price: displayPrice,
    sale_price: Number(raw.sale_price ?? 0) || 0,
    final_price: displayPrice,
    selling_price: Number(raw.selling_price ?? raw.price ?? raw.regular_price ?? raw.final_price ?? 0) || 0,
    regular_price: Number(raw.regular_price ?? raw.price ?? raw.final_price ?? raw.sale_price ?? 0) || 0,
    stock: currentStock,
    current_stock: currentStock,
    total_stock: currentStock,
    available_stock: currentStock,
    in_stock: inStock,
    stock_label: stockLabel,
    stock_status: stockLabel,
    availability: stockLabel,
    slug: clean(raw.slug || raw.canonical_slug || ""),
    sku: clean(raw.sku || raw.article_code || raw.sku_code || ""),
    product_url: clean(raw.product_url || raw.storefront_url || raw.storefrontUrl || raw.url || ""),
    storefront_url: clean(raw.storefront_url || raw.storefrontUrl || raw.product_url || raw.url || ""),
  };
};

const priceText = (product = {}) => {
  const price = Number(product.final_price || product.price || product.selling_price || product.regular_price || 0);
  if (!Number.isFinite(price) || price <= 0) return "—";
  return price.toLocaleString("en-US");
};

const platformLabel = (value = "") => {
  const key = clean(value).toLowerCase();
  if (key.includes("instagram")) return "Instagram";
  if (key.includes("whatsapp")) return "WhatsApp";
  if (key.includes("web")) return "Web";
  return "Facebook";
};

const postTypeLabel = (post = {}) => {
  const rawType = clean(post?.raw?.post_type || post?.raw?.type || post?.raw?.story_type || post?.raw?.content_type || post?.postType || post?.post_type || "");
  if (!rawType) return "";
  const key = rawType.toLowerCase();
  if (key.includes("reel")) return "Reel";
  if (key.includes("story")) return "Story";
  if (key.includes("video")) return "Video";
  return "Post";
};

const postImage = (post = {}) =>
  clean(post?.thumbnailUrl || post?.thumbnail_url || post?.postThumbnail || post?.post_thumbnail || post?.product_image_url || post?.image_url || post?.image || "");

const buildPostIdentityPayload = (post = {}) => ({
  post_link_key: clean(post?.post_link_key || post?.postLinkKey || post?.product_link_identity?.post_link_key || post?.post_identity?.post_link_key || ""),
  platform_post_id: clean(post?.platformPostId || post?.platform_post_id || ""),
  source_post_id: clean(post?.sourcePostId || post?.source_post_id || post?.postId || post?.post_id || ""),
  permalink_post_id: clean(post?.permalink_post_id || ""),
  canonical_post_id: clean(post?.canonicalPostId || post?.canonical_post_id || ""),
  post_id: clean(post?.sourcePostId || post?.postId || post?.post_id || ""),
  object_id: clean(post?.object_id || post?.permalink_post_id || ""),
});

const buildHydrationIdentity = (post = {}) => ({
  product_link_key: clean(post?.post_link_key || post?.postLinkKey || post?.product_link_identity?.product_link_key || post?.post_identity?.product_link_key || post?.product_link_key || ""),
  platform_post_id: clean(post?.platform_post_id || post?.platformPostId || ""),
  source_post_id: clean(post?.source_post_id || post?.sourcePostId || post?.post_id || post?.postId || ""),
  permalink_post_id: clean(post?.permalink_post_id || post?.permalinkPostId || ""),
  canonical_post_id: clean(post?.canonical_post_id || post?.canonicalPostId || post?.post_id || post?.postId || ""),
  post_id: clean(post?.post_id || post?.postId || post?.id || ""),
  object_id: clean(post?.object_id || post?.permalink_post_id || post?.permalinkPostId || ""),
});

const uniqueProductsById = (items = []) => {
  const seen = new Set();
  return (Array.isArray(items) ? items : []).filter((item) => {
    const safeId = Number(item?.id || item?.product_id || 0);
    if (!safeId || seen.has(safeId)) return false;
    seen.add(safeId);
    return true;
  });
};

const logHydrationTrace = ({
  phase = "",
  postId = "",
  canonicalPostId = "",
  exactIdentity = "",
  source = "",
  productIds = [],
  accepted = false,
  rejectedReason = "",
}) => {
  console.info("SOCIAL_PRODUCT_HYDRATION_SOURCE_TRACE", {
    phase: clean(phase),
    post_id: clean(postId),
    canonical_post_id: clean(canonicalPostId),
    exact_identity: exactIdentity,
    source: clean(source),
    product_ids: Array.from(new Set((Array.isArray(productIds) ? productIds : []).map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0))),
    accepted: Boolean(accepted),
    rejected_reason: clean(rejectedReason),
  });
};

export default function PostProductLinksDrawer({
  open = false,
  post = null,
  tenantId = "",
  onClose,
  onSaved,
}) {
  const productLinkIdentity = post?.product_link_identity && typeof post.product_link_identity === "object" && !Array.isArray(post.product_link_identity)
    ? post.product_link_identity
    : post?.post_identity && typeof post.post_identity === "object" && !Array.isArray(post.post_identity)
      ? post.post_identity
      : {};
  const safePostId = clean(
    post?.post_link_key ||
      post?.postLinkKey ||
      productLinkIdentity.product_link_key ||
      productLinkIdentity.post_id ||
      productLinkIdentity.canonical_post_id ||
      post?.canonicalPostId ||
      post?.canonical_post_id ||
      post?.postId ||
      post?.post_id ||
      post?.id ||
      post?.conversationId ||
      post?.conversation_id ||
      ""
  );
  const safePlatform = clean(post?.platform || "facebook").toLowerCase() || "facebook";
  const postIdentityPayload = useMemo(() => buildPostIdentityPayload(post || {}), [post]);
  const [initialLoading, setInitialLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [searchError, setSearchError] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [searchPage, setSearchPage] = useState(0);
  const [searchHasMore, setSearchHasMore] = useState(true);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchItems, setSearchItems] = useState([]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [searchFilters, setSearchFilters] = useState({ gender: "", productType: "", brand: "", size: "", inStock: false });
  const [brandOptions, setBrandOptions] = useState([]);
  const [selectedProducts, setSelectedProducts] = useState([]);
  const [primaryProductId, setPrimaryProductId] = useState(null);
  const [draggedId, setDraggedId] = useState(null);
  const scrollRef = useRef(null);
  const searchTimerRef = useRef(null);
  const loadVersionRef = useRef(0);
  const dirtyRef = useRef(false);
  const initialProductIdsRef = useRef([]);

  const selectedIdSet = useMemo(() => new Set(selectedProducts.map((item) => Number(item.id)).filter(Boolean)), [selectedProducts]);
  const selectedCount = selectedProducts.length;
  const activeFilterCount = useMemo(
    () => [searchFilters.gender, searchFilters.productType, searchFilters.brand, searchFilters.size, searchFilters.inStock ? "stock" : ""].filter(Boolean).length,
    [searchFilters]
  );
  const primaryProduct = useMemo(
    () => selectedProducts.find((item) => Number(item.id) === Number(primaryProductId)) || selectedProducts[0] || null,
    [primaryProductId, selectedProducts]
  );
  const drawerPostIdentity = useMemo(() => buildHydrationIdentity(post || {}), [post]);

  const notify = (tone, message) => {
    const text = clean(message);
    if (!text) return;
    if (tone === "rose") return toast.error(text);
    if (tone === "amber") return toast(text, { icon: "⚠️" });
    if (tone === "emerald") return toast.success(text);
    return toast(text);
  };

  const resetSearch = () => {
    setSearchItems([]);
    setSearchPage(0);
    setSearchHasMore(true);
    setSearchError("");
  };

  const applySelectionResponse = (payload = {}, { phase = "", source = "" } = {}) => {
    const mapped = uniqueProductsById(
      Array.isArray(payload?.linked_products)
        ? payload.linked_products.map((item) => normalizeProduct(item)).filter((item) => item.id)
        : []
    );
    setSelectedProducts(mapped);
    const primaryId = Number(payload?.primary_product?.id || payload?.primary_product?.product_id || mapped[0]?.id || 0) || null;
    setPrimaryProductId(primaryId);
    initialProductIdsRef.current = mapped.map((item) => Number(item.id)).filter((value) => Number.isFinite(value) && value > 0);
    dirtyRef.current = false;
    logHydrationTrace({
      phase,
      postId: safePostId,
      canonicalPostId: clean(payload?.canonical_post_id || safePostId),
      exactIdentity: JSON.stringify(payload?.post_identity || drawerPostIdentity || {}),
      source,
      productIds: mapped.map((item) => item.id),
      accepted: true,
      rejectedReason: clean(payload?.linked_products_source === "none" ? "empty_selection" : ""),
    });
    return mapped;
  };

  const loadSearch = async ({ reset = false } = {}) => {
    if (!open || !safePostId) return;
    if (searchLoading) return;
    const nextPage = reset ? 0 : searchPage;
    setSearchLoading(true);
    setSearchError("");
    try {
      const payload = await searchStorefrontProducts({
        query: searchTerm,
        offset: nextPage * 20,
        limit: 20,
        gender: searchFilters.gender,
        productType: searchFilters.productType,
        brand: searchFilters.brand,
        size: searchFilters.size,
        inStock: searchFilters.inStock,
      });
      const items = Array.isArray(payload?.items) ? payload.items : Array.isArray(payload?.products) ? payload.products : [];
      const normalized = items.map(normalizeProduct).filter((item) => item.id);
      setSearchItems((current) => (reset ? normalized : [...current, ...normalized]));
      setSearchPage((current) => (reset ? 1 : current + 1));
      setSearchHasMore(normalized.length >= 20);
    } catch (error) {
      setSearchError(error?.message || "تعذر تحميل المنتجات");
      setSearchHasMore(false);
    } finally {
      setSearchLoading(false);
    }
  };

  const loadMappings = async () => {
    if (!open || !safePostId) return;
    const requestId = loadVersionRef.current + 1;
    loadVersionRef.current = requestId;
    setInitialLoading(true);
    setLoadError("");
    dirtyRef.current = false;
    try {
      const payload = await getPostProductLinks({
        postId: safePostId,
        platform: safePlatform,
        tenantId,
        postIdentity: postIdentityPayload,
      });
      socialDebugLog("SOCIAL_PRODUCT_LINK_DRAWER_READBACK_TRACE", {
        post_id: safePostId,
        post_identity: postIdentityPayload,
        returned_product_ids: Array.isArray(payload?.product_ids) ? payload.product_ids : [],
        returned_product_names: Array.isArray(payload?.linked_products) ? payload.linked_products.map((item) => clean(item?.name || item?.title || item?.product_name || "")) : [],
      });
      if (loadVersionRef.current !== requestId || dirtyRef.current) {
        logHydrationTrace({
          phase: "drawer_get",
          postId: safePostId,
          canonicalPostId: clean(payload?.canonical_post_id || safePostId),
          exactIdentity: JSON.stringify(payload?.post_identity || drawerPostIdentity || {}),
          source: "frontend_props_hydration",
          productIds: Array.isArray(payload?.product_ids) ? payload.product_ids : [],
          accepted: false,
          rejectedReason: dirtyRef.current ? "dirty_local_state_active" : "stale_request",
        });
        return;
      }
      applySelectionResponse(payload, { phase: "drawer_get", source: payload?.linked_products_source || "drawer_get_response" });
    } catch (error) {
      setLoadError(error?.message || "تعذر تحميل روابط المنتجات");
      setSelectedProducts([]);
      setPrimaryProductId(null);
    } finally {
      setInitialLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    logHydrationTrace({
      phase: "drawer_open",
      postId: safePostId,
      canonicalPostId: clean(post?.canonical_post_id || post?.canonicalPostId || safePostId),
      exactIdentity: JSON.stringify(drawerPostIdentity || {}),
      source: "frontend_props_hydration",
      productIds: uniqueProductsById(Array.isArray(post?.linked_products) ? post.linked_products : []).map((item) => item.id),
      accepted: false,
      rejectedReason: "editor_uses_get_response_only",
    });
    logHydrationTrace({
      phase: "drawer_open",
      postId: safePostId,
      canonicalPostId: clean(post?.canonical_post_id || post?.canonicalPostId || safePostId),
      exactIdentity: JSON.stringify(drawerPostIdentity || {}),
      source: "canonical_fallback",
      productIds: uniqueProductsById(Array.isArray(post?.mapping_summary?.linked_products) ? post.mapping_summary.linked_products : []).map((item) => item.id),
      accepted: false,
      rejectedReason: "disabled_in_drawer",
    });
    logHydrationTrace({
      phase: "drawer_open",
      postId: safePostId,
      canonicalPostId: clean(post?.canonical_post_id || post?.canonicalPostId || safePostId),
      exactIdentity: JSON.stringify(drawerPostIdentity || {}),
      source: "automation_config_product_ids",
      productIds: Array.from(new Set([
        ...(Array.isArray(post?.automation_config?.product_ids) ? post.automation_config.product_ids : []),
        post?.automation_config?.product_id,
        post?.automation_config?.productId,
      ].map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0))),
      accepted: false,
      rejectedReason: "disabled_in_drawer",
    });
    logHydrationTrace({
      phase: "drawer_open",
      postId: safePostId,
      canonicalPostId: clean(post?.canonical_post_id || post?.canonicalPostId || safePostId),
      exactIdentity: JSON.stringify(drawerPostIdentity || {}),
      source: "sibling_auto_mapping",
      productIds: Array.from(new Set([
        ...(Array.isArray(post?.sibling_product_ids) ? post.sibling_product_ids : []),
        ...(Array.isArray(post?.sibling_product_ids_count) ? post.sibling_product_ids_count : []),
      ].map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0))),
      accepted: false,
      rejectedReason: "disabled_in_drawer",
    });
    setSearchTerm("");
    resetSearch();
    dirtyRef.current = false;
    initialProductIdsRef.current = [];
    setSelectedProducts([]);
    setPrimaryProductId(null);
    void loadMappings();
    void loadSearch({ reset: true });
    void getStorefrontBrandOptions()
      .then((options) => setBrandOptions(Array.isArray(options) ? options : []))
      .catch(() => setBrandOptions([]));
    return () => {
      if (searchTimerRef.current) window.clearTimeout(searchTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, safePostId, safePlatform, tenantId]);

  useEffect(() => {
    if (!open) return undefined;
    if (searchTimerRef.current) window.clearTimeout(searchTimerRef.current);
    searchTimerRef.current = window.setTimeout(() => {
      resetSearch();
      void loadSearch({ reset: true });
    }, 250);
    return () => {
      if (searchTimerRef.current) window.clearTimeout(searchTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchTerm, searchFilters.gender, searchFilters.productType, searchFilters.brand, searchFilters.size, searchFilters.inStock]);

  const handleToggleProduct = (product = {}) => {
    const safeId = Number(product.id || 0);
    if (!safeId) return;
    setSelectedProducts((current) => {
      const exists = current.some((item) => Number(item.id) === safeId);
      dirtyRef.current = true;
      if (exists) {
        const next = current.filter((item) => Number(item.id) !== safeId);
        if (Number(primaryProductId) === safeId) {
          setPrimaryProductId(next[0]?.id || null);
        }
        logHydrationTrace({
          phase: "local_remove",
          postId: safePostId,
          canonicalPostId: safePostId,
          exactIdentity: JSON.stringify(drawerPostIdentity || {}),
          source: "frontend_local_state",
          productIds: next.map((item) => Number(item.id)).filter(Boolean),
          accepted: true,
          rejectedReason: "",
        });
        return next;
      }
      const next = [...current, product];
      if (!primaryProductId) setPrimaryProductId(safeId);
      logHydrationTrace({
        phase: "local_add",
        postId: safePostId,
        canonicalPostId: safePostId,
        exactIdentity: JSON.stringify(drawerPostIdentity || {}),
        source: "frontend_local_state",
        productIds: next.map((item) => Number(item.id)).filter(Boolean),
        accepted: true,
        rejectedReason: "",
      });
      return next;
    });
  };

  const handleRemoveSelected = (productId = null) => {
    const safeId = Number(productId || 0);
    if (!safeId) return;
    setSelectedProducts((current) => {
      const next = current.filter((item) => Number(item.id) !== safeId);
      dirtyRef.current = true;
      if (Number(primaryProductId) === safeId) {
        setPrimaryProductId(next[0]?.id || null);
      }
      logHydrationTrace({
        phase: "local_remove",
        postId: safePostId,
        canonicalPostId: safePostId,
        exactIdentity: JSON.stringify(drawerPostIdentity || {}),
        source: "frontend_local_state",
        productIds: next.map((item) => Number(item.id)).filter(Boolean),
        accepted: true,
        rejectedReason: "",
      });
      return next;
    });
  };

  const reorderSelected = (fromId, toId) => {
    const fromIndex = selectedProducts.findIndex((item) => Number(item.id) === Number(fromId));
    const toIndex = selectedProducts.findIndex((item) => Number(item.id) === Number(toId));
    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return;
    const next = [...selectedProducts];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    dirtyRef.current = true;
    setSelectedProducts(next);
    logHydrationTrace({
      phase: "local_reorder",
      postId: safePostId,
      canonicalPostId: safePostId,
      exactIdentity: JSON.stringify(drawerPostIdentity || {}),
      source: "frontend_local_state",
      productIds: next.map((item) => Number(item.id)).filter(Boolean),
      accepted: true,
      rejectedReason: "",
    });
  };

  const handleSave = async () => {
    if (!safePostId) return;
    const selectedProductIds = selectedProducts
      .map((item) => Number(item?.id ?? item?.product_id ?? 0))
      .filter((value) => Number.isFinite(value) && value > 0);
    const safePrimaryProductId = Number(primaryProductId || selectedProductIds[0] || 0) || null;
    const isClearOperation = !selectedProductIds.length;
    const propLinkedProductIds = uniqueProductsById(
      Array.isArray(post?.linked_products)
        ? post.linked_products
        : Array.isArray(post?.mapping_summary?.linked_products)
          ? post.mapping_summary.linked_products
          : []
    ).map((item) => Number(item.id)).filter((value) => Number.isFinite(value) && value > 0);
    const initialProductIds = Array.isArray(initialProductIdsRef.current)
      ? Array.from(new Set(initialProductIdsRef.current.map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0)))
      : [];
    const outgoingProductIds = Array.from(new Set(selectedProductIds));
    const ignoredExternalHydration = Boolean(dirtyRef.current);
    console.info("SOCIAL_PRODUCT_DRAWER_SAVE_PAYLOAD_TRACE", {
      selectedProductsLocalIds: selectedProductIds,
      propLinkedProductIds,
      initialProductIds,
      outgoingProductIds,
      dirty: Boolean(dirtyRef.current),
      ignoredExternalHydration,
    });
    console.info("PRODUCT_LINKS_FRONTEND_SAVE_CLICK", {
      postId: safePostId,
      platform: safePlatform,
      selectedProductIds: outgoingProductIds,
      primaryProductId: safePrimaryProductId,
      isClearOperation,
    });
    if (isClearOperation) {
      setSaving(true);
      try {
        const payload = await savePostProductLinks({
          postId: safePostId,
          platform: safePlatform,
          tenantId,
          productIds: [],
          primaryProductId: null,
          postIdentity: postIdentityPayload,
        });
        applySelectionResponse(payload, { phase: "drawer_save_clear", source: payload?.linked_products_source || "drawer_save_response" });
        notify("emerald", "طھظ…طھ ط¥ط²ط§ظ„ط© ط±ظˆط§ط¨ط· ط§ظ„ظ…ظ†طھط¬ط§طھ");
        await Promise.resolve(onSaved?.(payload));
      } catch (error) {
        notify("rose", error?.message || "طھط¹ط°ط± ط¥ط²ط§ظ„ط© ط±ظˆط§ط¨ط· ط§ظ„ظ…ظ†طھط¬ط§طھ");
      } finally {
        setSaving(false);
      }
      return;
    }
    if (!selectedProductIds.length) {
      notify("amber", "اختر منتجًا واحدًا على الأقل قبل الحفظ");
      return;
    }
    setSaving(true);
    try {
      const payload = await savePostProductLinks({
        postId: safePostId,
        platform: safePlatform,
        tenantId,
        productIds: selectedProductIds,
        primaryProductId: safePrimaryProductId,
        postIdentity: postIdentityPayload,
      });
      socialDebugLog("SOCIAL_PRODUCT_LINK_UPSERT_TRACE", {
        post_id: safePostId,
        post_identity: postIdentityPayload,
        saved_product_ids: selectedProductIds,
        returned_product_ids: Array.isArray(payload?.product_ids) ? payload.product_ids : [],
        primary_product_id: Number(payload?.primary_product?.id || payload?.primary_product?.product_id || 0) || null,
      });
      applySelectionResponse(payload, { phase: "drawer_save", source: payload?.linked_products_source || "drawer_save_response" });
      notify("emerald", "تم حفظ ربط المنتجات");
      await Promise.resolve(onSaved?.(payload));
    } catch (error) {
      notify("rose", error?.message || "تعذر حفظ ربط المنتجات");
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveAll = async () => {
    if (!safePostId) return;
    const confirmed = window.confirm("Remove all linked products from this post?");
    if (!confirmed) return;
    return handleSave();
    setSaving(true);
    try {
      const payload = await savePostProductLinks({
        postId: safePostId,
        platform: safePlatform,
        tenantId,
        productIds: [],
        primaryProductId: null,
        postIdentity: postIdentityPayload,
      });
      applySelectionResponse(payload, { phase: "drawer_save_clear", source: payload?.linked_products_source || "drawer_save_response" });
      notify("emerald", "طھظ…طھ ط¥ط²ط§ظ„ط© ط±ظˆط§ط¨ط· ط§ظ„ظ…ظ†طھط¬ط§طھ");
      await Promise.resolve(onSaved?.(payload));
      return;
      await removePostProductLink({
        postId: safePostId,
        platform: safePlatform,
        tenantId,
        postIdentity: postIdentityPayload,
      });
      setSelectedProducts([]);
      setPrimaryProductId(null);
      notify("emerald", "تمت إزالة روابط المنتجات");
      const reloadedPayload = await getPostProductLinks({
        postId: safePostId,
        platform: safePlatform,
        tenantId,
        postIdentity: postIdentityPayload,
      });
      await Promise.resolve(onSaved?.(reloadedPayload));
    } catch (error) {
      notify("rose", error?.message || "تعذر إزالة روابط المنتجات");
    } finally {
      setSaving(false);
    }
  };

  const handleScrollSearch = (event) => {
    const node = event.currentTarget;
    if (!node || searchLoading || !searchHasMore) return;
    const remaining = node.scrollHeight - node.scrollTop - node.clientHeight;
    if (remaining > 240) return;
    void loadSearch();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80]">
      <button type="button" aria-label="Close product links drawer" onClick={onClose} className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm" />

      <aside className="absolute right-0 top-0 flex h-full w-full max-w-[58rem] flex-col overflow-hidden border-l border-white/10 bg-slate-950 shadow-[0_24px_80px_rgba(0,0,0,0.32)] max-[768px]:left-0 max-[768px]:top-auto max-[768px]:h-[92vh] max-[768px]:max-w-none max-[768px]:rounded-t-[28px]">
        <div className="flex items-center justify-end border-b border-white/10 px-4 py-3">
          <div className="hidden" aria-hidden="true">
            <div className="text-[10px] font-black uppercase tracking-[0.24em] text-cyan-100">Link Products</div>
            <div className="mt-1 text-lg font-black text-white">{clean(post?.caption || post?.title || "Social post")}</div>
            <div className="mt-2 flex flex-wrap gap-2">
              <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.08em] text-slate-200">
                {platformLabel(safePlatform)}
              </span>
              <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.08em] text-slate-200">
                {postTypeLabel(post) || "Post"}
              </span>
              <span className={`rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.08em] ${selectedCount > 0 ? "border-emerald-300/20 bg-emerald-400/10 text-emerald-100" : "border-amber-300/20 bg-amber-400/10 text-amber-100"}`}>
                {selectedCount > 0 ? "✓ Linked Products" : "⚠ No Product Linked"}
              </span>
            </div>
          </div>

          <button type="button" onClick={onClose} className="inline-flex h-9 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-xs font-black text-slate-200">
            <X className="h-4 w-4" />
            Close
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden p-4">
          {loadError ? <div className="rounded-2xl border border-rose-300/20 bg-rose-400/10 p-3 text-sm text-rose-100">{loadError}</div> : null}

          <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[minmax(0,1.08fr)_minmax(0,0.92fr)]">
            <section className="flex min-h-0 flex-col overflow-hidden rounded-[24px] border border-white/10 bg-white/[0.03]">
              <div className="border-b border-white/10 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Search ERP Products</div>
                    <div className="mt-1 text-sm font-black text-white">Infinite search</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void loadSearch({ reset: true })}
                    className="inline-flex h-8 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-[11px] font-black text-slate-200"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${searchLoading ? "animate-spin" : ""}`} />
                    Refresh
                  </button>
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <div className="flex min-w-0 flex-1 items-center gap-2 rounded-2xl border border-white/10 bg-slate-950/60 px-3 py-2">
                    <Search className="h-4 w-4 shrink-0 text-slate-400" />
                    <input
                      type="text"
                      value={searchTerm}
                      onChange={(event) => setSearchTerm(event.target.value)}
                      placeholder="Search by model, name, brand, SKU..."
                      className="w-full min-w-0 bg-transparent text-sm text-white outline-none placeholder:text-slate-500"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setFiltersOpen((current) => !current)}
                    className={`relative inline-flex h-10 shrink-0 items-center gap-2 rounded-2xl border px-3 text-xs font-black transition ${filtersOpen || activeFilterCount ? "border-emerald-300/30 bg-emerald-400/10 text-emerald-100" : "border-white/10 bg-white/[0.04] text-slate-200"}`}
                  >
                    <SlidersHorizontal className="h-4 w-4" />
                    Filters
                    {activeFilterCount ? <span className="grid h-5 min-w-5 place-items-center rounded-full bg-emerald-300 px-1 text-[10px] text-emerald-950">{activeFilterCount}</span> : null}
                  </button>
                </div>
                {filtersOpen ? (
                  <div className="mt-3 grid gap-3 rounded-2xl border border-white/10 bg-black/30 p-3">
                    <div>
                      <div className="mb-2 text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Section</div>
                      <div className="flex flex-wrap gap-2">
                        {[["", "All"], ["men", "Men"], ["women", "Women"], ["kids", "Kids"]].map(([value, label]) => (
                          <button
                            key={label}
                            type="button"
                            onClick={() => setSearchFilters((current) => ({ ...current, gender: value }))}
                            className={`h-8 rounded-full border px-3 text-[11px] font-black ${searchFilters.gender === value ? "border-emerald-300/30 bg-emerald-400/15 text-emerald-100" : "border-white/10 bg-white/[0.04] text-slate-300"}`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <FilterSelect
                        label="Product types"
                        value={searchFilters.productType}
                        options={PRODUCT_TYPE_OPTIONS}
                        onChange={(value) => setSearchFilters((current) => ({ ...current, productType: value }))}
                      />
                      <FilterSelect
                        label="Brands"
                        value={searchFilters.brand}
                        options={brandOptions}
                        onChange={(value) => setSearchFilters((current) => ({ ...current, brand: value }))}
                      />
                      <FilterSelect
                        label="Sizes"
                        value={searchFilters.size}
                        options={SIZE_OPTIONS}
                        onChange={(value) => setSearchFilters((current) => ({ ...current, size: value }))}
                      />
                      <button
                        type="button"
                        onClick={() => setSearchFilters((current) => ({ ...current, inStock: !current.inStock }))}
                        className={`inline-flex h-11 items-center justify-center gap-2 rounded-xl border px-3 text-xs font-black ${searchFilters.inStock ? "border-emerald-300/30 bg-emerald-400/15 text-emerald-100" : "border-white/10 bg-white/[0.04] text-slate-300"}`}
                      >
                        <span className={`grid h-4 w-4 place-items-center rounded border ${searchFilters.inStock ? "border-emerald-300 bg-emerald-300 text-emerald-950" : "border-white/20"}`}>
                          {searchFilters.inStock ? <Check className="h-3 w-3" /> : null}
                        </span>
                        In stock only
                      </button>
                    </div>
                    {activeFilterCount ? (
                      <button
                        type="button"
                        onClick={() => setSearchFilters({ gender: "", productType: "", brand: "", size: "", inStock: false })}
                        className="h-9 rounded-xl border border-amber-300/20 bg-amber-400/10 px-3 text-xs font-black text-amber-100"
                      >
                        Clear filters
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>

              <div ref={scrollRef} onScroll={handleScrollSearch} className="min-h-0 flex-1 overflow-y-auto p-3">
                {searchError ? <div className="mb-3 rounded-2xl border border-rose-300/20 bg-rose-400/10 p-3 text-sm text-rose-100">{searchError}</div> : null}
                {searchLoading && !searchItems.length ? (
                  <div className="grid min-h-[14rem] place-items-center rounded-[22px] border border-dashed border-white/10 bg-white/[0.02] text-slate-400">
                    <div className="flex items-center gap-2 text-sm font-black">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading products...
                    </div>
                  </div>
                ) : null}

                {!searchLoading && !searchItems.length ? (
                  <div className="grid min-h-[14rem] place-items-center rounded-[22px] border border-dashed border-white/10 bg-white/[0.02] px-6 text-center text-slate-400">
                    <div>
                      <div className="text-sm font-black text-white">No products yet</div>
                      <div className="mt-1 text-xs text-slate-500">Type to search ERP products and add them to this post.</div>
                    </div>
                  </div>
                ) : null}

                <div className="grid gap-2">
                  {searchItems.map((item) => {
                    const active = selectedIdSet.has(Number(item.id));
                    return (
                      <article key={item.id} className="rounded-[22px] border border-white/10 bg-slate-950/70 p-3">
                        <div className="flex gap-3">
                          <div className="h-16 w-16 shrink-0 overflow-hidden rounded-2xl border border-white/10 bg-slate-900">
                            {item.image_url ? (
                              <img src={item.image_url} alt="" className="h-full w-full object-cover" loading="lazy" />
                            ) : (
                              <div className="grid h-full w-full place-items-center text-slate-500">—</div>
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="line-clamp-2 text-sm font-black leading-6 text-white">{item.name}</div>
                                <div className="mt-1 text-[11px] text-slate-400">{item.brand || "ERP Product"}</div>
                              </div>
                              <button
                                type="button"
                                onClick={() => handleToggleProduct(item)}
                                className={`inline-flex h-8 items-center gap-2 rounded-xl px-3 text-[11px] font-black ${
                                  active
                                    ? "border border-emerald-300/20 bg-emerald-400/10 text-emerald-100"
                                    : "border border-cyan-300/20 bg-cyan-400/10 text-cyan-100"
                                }`}
                              >
                                {active ? "Added" : <><Plus className="h-3.5 w-3.5" /> Add</>}
                              </button>
                            </div>
                            <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] font-black uppercase tracking-[0.08em] text-slate-300">
                              <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1">Price {priceText(item)}</span>
                              <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1">{item.stock_status}</span>
                              {item.slug ? <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1">{item.slug}</span> : null}
                            </div>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>

                {searchHasMore ? (
                  <button
                    type="button"
                    onClick={() => void loadSearch()}
                    disabled={searchLoading}
                    className="mt-3 inline-flex h-9 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-xs font-black text-slate-200 disabled:opacity-50"
                  >
                    {searchLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                    Load more
                  </button>
                ) : null}
              </div>
            </section>

            <section className="flex min-h-0 flex-col overflow-hidden rounded-[24px] border border-white/10 bg-white/[0.03]">
              <div className="border-b border-white/10 p-3">
                <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Selected Products</div>
                <div className="mt-1 text-sm font-black text-white">Drag to reorder, choose primary</div>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-3">
                {initialLoading ? (
                  <div className="grid min-h-[14rem] place-items-center rounded-[22px] border border-dashed border-white/10 bg-white/[0.02] text-slate-400">
                    <div className="flex items-center gap-2 text-sm font-black">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading current links...
                    </div>
                  </div>
                ) : null}

                {!initialLoading && !selectedProducts.length ? (
                  <div className="grid min-h-[14rem] place-items-center rounded-[22px] border border-dashed border-white/10 bg-white/[0.02] px-6 text-center text-slate-400">
                    <div>
                      <div className="text-sm font-black text-white">No linked products</div>
                      <div className="mt-1 text-xs text-slate-500">Add one or more ERP products from the search panel.</div>
                    </div>
                  </div>
                ) : null}

                <div className="grid gap-2">
                  {selectedProducts.map((item, index) => {
                    const isPrimary = Number(item.id) === Number(primaryProductId || primaryProduct?.id || 0);
                    return (
                      <div
                        key={item.id}
                        draggable
                        onDragStart={() => setDraggedId(item.id)}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={() => {
                          if (draggedId && draggedId !== item.id) reorderSelected(draggedId, item.id);
                          setDraggedId(null);
                        }}
                        className="rounded-[22px] border border-white/10 bg-slate-950/70 p-3"
                      >
                        <div className="flex items-start gap-3">
                          <div className="mt-1 text-slate-500">
                            <GripVertical className="h-4 w-4" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="line-clamp-2 text-sm font-black leading-6 text-white">{item.name}</div>
                                <div className="mt-1 text-[11px] text-slate-400">{item.brand || "ERP Product"}</div>
                              </div>
                              <button
                                type="button"
                                onClick={() => handleRemoveSelected(item.id)}
                                className="inline-flex h-8 items-center gap-2 rounded-xl border border-rose-300/20 bg-rose-400/10 px-3 text-[11px] font-black text-rose-100"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                                Remove
                              </button>
                            </div>
                            <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] font-black uppercase tracking-[0.08em] text-slate-300">
                              <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1">Price {priceText(item)}</span>
                              <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1">{item.stock_status}</span>
                              <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1"># {index + 1}</span>
                            </div>
                            <div className="mt-3 flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                onClick={() => setPrimaryProductId(item.id)}
                                className={`inline-flex h-8 items-center gap-2 rounded-xl px-3 text-[11px] font-black ${
                                  isPrimary
                                    ? "border border-emerald-300/20 bg-emerald-400/10 text-emerald-100"
                                    : "border border-white/10 bg-white/[0.04] text-slate-200"
                                }`}
                              >
                                <Star className="h-3.5 w-3.5" />
                                {isPrimary ? "Primary" : "Set Primary"}
                              </button>
                              {isPrimary ? <span className="rounded-full border border-emerald-300/20 bg-emerald-400/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.08em] text-emerald-100">Primary</span> : null}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="border-t border-white/10 p-3">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void handleSave()}
                    disabled={saving || !safePostId}
                    className="inline-flex h-10 items-center gap-2 rounded-xl bg-cyan-300 px-4 text-xs font-black text-slate-950 disabled:opacity-50"
                  >
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Star className="h-4 w-4" />}
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleRemoveAll()}
                    disabled={saving || !selectedProducts.length}
                    className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 text-xs font-black text-slate-200 disabled:opacity-50"
                  >
                    <Trash2 className="h-4 w-4" />
                    Remove
                  </button>
                </div>
                <div className="text-xs text-slate-400">
                  {primaryProduct ? `Primary product: ${primaryProduct.name}` : "Primary product will default to the first selected item."}
                </div>
              </div>
            </section>
          </div>
        </div>
      </aside>
    </div>
  );
}
