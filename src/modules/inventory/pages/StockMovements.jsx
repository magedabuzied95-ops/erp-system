import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";

import {
  ChevronDown,
  ChevronUp,
  Clock3,
  Image as ImageIcon,
  Loader2,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import toast from "react-hot-toast";

import { api } from "../../../shared/api/api";
import { resolveProductImageUrl } from "../../../shared/lib/imageUrls";
import InventoryShell from "../components/InventoryShell";
import { formatDateTime } from "../../purchases/lib/flowStore";
import { getProductsWithVariants } from "../../products/services/productsApi";

const ROW_COUNT_OPTIONS = [50, 100, 200, 500];

const MOVEMENT_TYPE_LABELS = {
  purchase_in: "شراء وارد",
  sale_out: "بيع صادر",
  return_in: "مرتجع وارد",
  adjustment: "تسوية",
  transfer_in: "تحويل وارد",
  transfer_out: "تحويل صادر",
  count_adjustment: "تسوية جرد",
  order_cancel_restore: "استرجاع إلغاء الطلب",
  opening_balance: "رصيد افتتاحي",
  inventory_count: "جرد مخزون",
  manual_adjustment: "تعديل يدوي",
};

const movementTypeLabel = (value = "") => MOVEMENT_TYPE_LABELS[String(value || "").toLowerCase()] || "حركة مخزون";

const normalizeText = (value = "") => String(value || "").trim();

const normalizeKey = (value = "") => normalizeText(value).toLowerCase();

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const formatSignedQuantity = (value) => {
  const amount = toNumber(value, 0);
  return `${amount >= 0 ? "+" : ""}${amount}`;
};

const uniqueSorted = (values = []) =>
  Array.from(
    new Set(
      values
        .map((value) => normalizeText(value))
        .filter(Boolean)
    )
  ).sort((left, right) => left.localeCompare(right));

const summarizeLocations = (movements = []) => {
  const locations = uniqueSorted(
    movements.flatMap((movement) => [
      movement.warehouse_name || "",
      movement.branch_name || "",
    ])
  );

  if (!locations.length) return "غير محدد";
  if (locations.length <= 2) return locations.join(" · ");
  return `${locations.slice(0, 2).join(" · ")} +${locations.length - 2}`;
};

const getGroupKey = (movement = {}) => {
  const productId = movement.product_id ?? movement.productId ?? null;
  if (productId !== null && productId !== undefined && String(productId).trim()) return `product:${productId}`;
  const productName = normalizeText(movement.product_name || movement.productName);
  if (productName) return `name:${normalizeKey(productName)}`;
  return `movement:${movement.id ?? Math.random().toString(36).slice(2)}`;
};

const getMovementImageUrl = (movement = {}) => {
  const direct = [
    movement.product_image_url,
    movement.product_image,
    movement.variant_image_url,
    movement.color_image_url,
    movement.image_url,
    movement.variant?.image_url,
    movement.product?.image_url,
  ].find((value) => normalizeText(value));

  return resolveProductImageUrl(direct || "");
};

const buildMovementSearchText = (movement = {}) =>
  [
    movement.product_name,
    movement.product_code,
    movement.product_grade,
    movement.category_name,
    movement.manufacturer_name,
    movement.color,
    movement.size,
    movement.sku,
    movement.barcode,
    movement.variant_article_code,
    movement.movement_type,
    movement.reference_type,
    movement.reason,
    movement.notes,
    movement.created_by_name,
    movement.warehouse_name,
    movement.branch_name,
  ]
    .map((value) => normalizeText(value).toLowerCase())
    .join(" ");

const getVariantStock = (variant = {}) =>
  Math.max(
    0,
    Number(
      variant.stock ??
        variant.stock_quantity ??
        variant.stockQty ??
        variant.available_stock ??
        variant.available_quantity ??
        variant.inventory_quantity ??
        variant.current_stock ??
        variant.quantity ??
        0
    ) || 0
  );

const normalizeVariantText = (value = "") => normalizeText(value);

const buildProductStockRows = (product = {}, sourceRows = []) => {
  const nestedVariants = Array.isArray(product?.product?.variants)
    ? product.product.variants
    : Array.isArray(product?.variants)
      ? product.variants
      : Array.isArray(product?.product_variants)
        ? product.product_variants
        : [];

  const productId = product?.product_id ?? product?.id ?? product?.product?.id ?? null;
  const fallbackVariants = !nestedVariants.length && Array.isArray(sourceRows)
    ? sourceRows.filter((row) => String(row.product_id ?? row.id ?? row.product?.id ?? "") === String(productId || "") && String(row.variant_id ?? row.id ?? "") !== String(productId || ""))
    : [];

  const flattenedVariants = [...nestedVariants, ...fallbackVariants]
    .map((variant) => {
      const resolved = variant?.variant || variant || {};
      const color = normalizeVariantText(resolved.color || resolved.color_name || resolved.variant_color || "");
      const size = normalizeVariantText(resolved.size || resolved.size_name || resolved.variant_size || "");
      const stock = getVariantStock(resolved);

      if (!color && !size && stock === 0) return null;

      return {
        color,
        size,
        stock,
        key: `${color || "color"}::${size || "size"}`,
      };
    })
    .filter(Boolean);

  const groups = new Map();
  for (const row of flattenedVariants) {
    const current = groups.get(row.key);
    if (!current) {
      groups.set(row.key, { ...row });
      continue;
    }
    current.stock += row.stock;
  }

  const rows = Array.from(groups.values()).sort((left, right) => {
    const colorCompare = left.color.localeCompare(right.color);
    if (colorCompare !== 0) return colorCompare;
    return left.size.localeCompare(right.size);
  });

  return rows;
};

function StockMovements() {
  const [search, setSearch] = useState("");
  const [movementType, setMovementType] = useState("");
  const [grade, setGrade] = useState("");
  const [category, setCategory] = useState("");
  const [rowCount, setRowCount] = useState(200);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [movements, setMovements] = useState([]);
  const [expandedGroups, setExpandedGroups] = useState([]);
  const [productSnapshots, setProductSnapshots] = useState({});
  const [activeVariant, setActiveVariant] = useState(null);
  const [variantHistoryLoading, setVariantHistoryLoading] = useState(false);
  const [variantHistoryError, setVariantHistoryError] = useState("");
  const [variantHistoryMovements, setVariantHistoryMovements] = useState([]);
  const snapshotCacheRef = useRef(new Map());

  useEffect(() => {
    let alive = true;
    const timer = window.setTimeout(async () => {
      try {
        setLoading(true);
        setError("");

        const params = new URLSearchParams();
        if (search.trim()) params.set("search", search.trim());
        if (movementType.trim()) params.set("movement_type", movementType.trim());
        if (grade.trim()) params.set("grade", grade.trim());
        if (category.trim()) params.set("category", category.trim());
        params.set("limit", String(rowCount));
        params.set("page", "1");

        const response = await api.get(`/inventory/movements?${params.toString()}`);
        if (!alive) return;

        const rows = Array.isArray(response?.movements) ? response.movements : [];
        setMovements(rows);
        setExpandedGroups((current) => current.filter((key) => rows.some((movement) => getGroupKey(movement) === key)));
      } catch (err) {
        if (!alive) return;
        setMovements([]);
        setError(err?.message || "تعذر تحميل حركات المخزون");
        toast.error(err?.message || "تعذر تحميل حركات المخزون");
      } finally {
        if (alive) setLoading(false);
      }
    }, 250);

    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [category, grade, movementType, rowCount, search]);

  const groupedMovements = useMemo(() => {
    const groups = new Map();

    for (const movement of movements) {
      const key = getGroupKey(movement);
      const current = groups.get(key);
      const delta = toNumber(movement.quantity_delta ?? movement.quantity_change ?? movement.quantity ?? 0, 0);
      const createdAt = movement.created_at || "";

      if (!current) {
        groups.set(key, {
          key,
          product_id: movement.product_id ?? movement.productId ?? null,
          product_name: normalizeText(movement.product_name || "Unknown product"),
          product_code: normalizeText(movement.product_code || movement.product_sku || movement.sku || movement.variant_article_code || ""),
          product_grade: normalizeText(movement.product_grade || ""),
          category_name: normalizeText(movement.category_name || ""),
          manufacturer_name: normalizeText(movement.manufacturer_name || ""),
          product_image_url: getMovementImageUrl(movement),
          movements: [movement],
          movementCount: 1,
          totalDelta: delta,
          lastMovementAt: createdAt,
          locations: new Set([normalizeText(movement.warehouse_name || ""), normalizeText(movement.branch_name || "")].filter(Boolean)),
        });
        continue;
      }

      current.movements.push(movement);
      current.movementCount += 1;
      current.totalDelta += delta;
      if (!current.product_code) current.product_code = normalizeText(movement.product_code || movement.product_sku || movement.sku || movement.variant_article_code || "");
      if (!current.product_grade) current.product_grade = normalizeText(movement.product_grade || "");
      if (!current.category_name) current.category_name = normalizeText(movement.category_name || "");
      if (!current.manufacturer_name) current.manufacturer_name = normalizeText(movement.manufacturer_name || "");
      if (!current.product_image_url) current.product_image_url = getMovementImageUrl(movement);
      current.lastMovementAt = !current.lastMovementAt || Date.parse(createdAt) > Date.parse(current.lastMovementAt) ? createdAt : current.lastMovementAt;
      const warehouseName = normalizeText(movement.warehouse_name || "");
      const branchName = normalizeText(movement.branch_name || "");
      if (warehouseName) current.locations.add(warehouseName);
      if (branchName) current.locations.add(branchName);
    }

    return Array.from(groups.values())
      .map((group) => ({
        ...group,
        movements: group.movements.slice().sort((left, right) => Date.parse(right.created_at || 0) - Date.parse(left.created_at || 0)),
        locations: Array.from(group.locations).filter(Boolean),
      }))
      .sort((left, right) => Date.parse(right.lastMovementAt || 0) - Date.parse(left.lastMovementAt || 0));
  }, [movements]);

  const movementTypes = useMemo(() => uniqueSorted(movements.map((movement) => movement.movement_type)), [movements]);
  const grades = useMemo(() => uniqueSorted(movements.map((movement) => movement.product_grade)), [movements]);
  const categories = useMemo(() => uniqueSorted(movements.map((movement) => movement.category_name)), [movements]);

  const summary = useMemo(() => {
    const netQuantity = movements.reduce((sum, movement) => sum + toNumber(movement.quantity_delta ?? movement.quantity_change ?? movement.quantity ?? 0, 0), 0);
    return {
      productGroups: groupedMovements.length,
      movementRows: movements.length,
      netQuantity,
    };
  }, [groupedMovements.length, movements]);

  useEffect(() => {
    let alive = true;

    const loadSnapshots = async () => {
      const pendingGroups = groupedMovements.filter((group) => expandedGroups.includes(group.key) && group.product_id);
      const missingGroups = pendingGroups.filter((group) => !snapshotCacheRef.current.has(String(group.product_id)));
      if (!missingGroups.length) return;

      await Promise.all(
        missingGroups.map(async (group) => {
          const cacheKey = String(group.product_id);
          snapshotCacheRef.current.set(cacheKey, { loading: true, rows: [], error: "" });
          setProductSnapshots((current) => ({
            ...current,
            [cacheKey]: { loading: true, rows: [], error: "" },
          }));

          try {
            const response = await getProductsWithVariants({
              params: {
                productId: String(group.product_id),
                refresh: Date.now(),
              },
            });

            if (!alive) return;

            const rows = Array.isArray(response) ? response : [];
            const matchedRow =
              rows.find((row) => String(row.product_id ?? row.id ?? row.product?.id) === cacheKey) ||
              rows.find((row) => String(row.id ?? row.product?.id) === cacheKey) ||
              null;
            const stockRows = buildProductStockRows(matchedRow || group, rows);
            const snapshot = {
              loading: false,
              error: "",
              rows: stockRows,
            };
            snapshotCacheRef.current.set(cacheKey, snapshot);
            setProductSnapshots((current) => ({
              ...current,
              [cacheKey]: snapshot,
            }));
          } catch (error) {
            if (!alive) return;
            const snapshot = {
              loading: false,
              error: error?.message || "تعذر تحميل لقطة الرصيد الحالية",
              rows: buildProductStockRows(group),
            };
            snapshotCacheRef.current.set(cacheKey, snapshot);
            setProductSnapshots((current) => ({
              ...current,
              [cacheKey]: snapshot,
            }));
          }
        })
      );
    };

    if (groupedMovements.length && expandedGroups.length) {
      loadSnapshots();
    }

    return () => {
      alive = false;
    };
  }, [expandedGroups, groupedMovements]);

  const toggleGroup = (key) => {
    setExpandedGroups((current) =>
      current.includes(key)
        ? current.filter((value) => value !== key)
        : [...current, key]
    );
  };

  const openVariantHistory = async (movement, group) => {
    const variantId = movement.variant_id ?? movement.variantId;
    if (!variantId) return;

    setActiveVariant({ movement, group });
    setVariantHistoryError("");
    setVariantHistoryMovements([]);
    setVariantHistoryLoading(true);

    try {
      const params = new URLSearchParams();
      params.set("limit", "500");
      params.set("page", "1");
      if (group?.product_id) params.set("productId", String(group.product_id));

      const response = await api.get(`/inventory/variant/${encodeURIComponent(String(variantId))}/history?${params.toString()}`);
      setVariantHistoryMovements(Array.isArray(response?.movements) ? response.movements : []);
    } catch (err) {
      setVariantHistoryError(err?.message || "تعذر تحميل سجل الاختيار");
      toast.error(err?.message || "تعذر تحميل سجل الاختيار");
    } finally {
      setVariantHistoryLoading(false);
    }
  };

  const closeVariantHistory = () => {
    setActiveVariant(null);
    setVariantHistoryMovements([]);
    setVariantHistoryError("");
    setVariantHistoryLoading(false);
  };

  return (
    <InventoryShell
      title="حركات المخزون"
      subtitle="تُجمَّع حسب المنتج حتى تبقى الاختيارات بحسب المقاس واللون واضحة وسهلة البحث والفحص."
      actions={
        <div className="flex flex-wrap gap-2">
          <Link to="/inventory/history" className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white">
            <Clock3 className="mr-2 inline h-4 w-4" />
            سجل الاختيارات
          </Link>
        </div>
      }
      tabs={[
        { to: "/inventory", label: "المخزون", end: true },
        { to: "/inventory/movements", label: "الحركات", end: true },
        { to: "/inventory/adjustments", label: "التسويات" },
        { to: "/inventory/count", label: "الجرد" },
        { to: "/stock-transfers", label: "التحويلات" },
        { to: "/warehouses", label: "المخازن" },
      ]}
    >
      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-4">
        <Metric label="مجموعات المنتجات" value={summary.productGroups} tone="emerald" />
        <Metric label="صفوف الحركات" value={summary.movementRows} tone="blue" />
        <Metric label="صافي الكمية" value={formatSignedQuantity(summary.netQuantity)} tone="violet" />
        <Metric label="حد الصفوف" value={rowCount} tone="amber" />
      </div>

      <div className="rounded-3xl border border-white/10 bg-zinc-950/90 p-4 shadow-2xl shadow-black/10">
        <div className="grid gap-3 xl:grid-cols-[minmax(0,1.4fr)_180px_180px_180px_180px_auto]">
          <label className="relative block xl:col-span-1">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ابحث عن منتج أو SKU أو باركود أو لون أو مقاس أو سبب أو مستخدم..."
              className="w-full rounded-2xl border border-white/10 bg-white/5 py-3 pl-11 pr-4 text-sm text-white outline-none placeholder:text-zinc-500"
            />
          </label>

          <label className="block">
            <div className="mb-2 flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-zinc-500">
              <SlidersHorizontal className="h-3.5 w-3.5" />
              نوع الحركة
            </div>
            <select
              value={movementType}
              onChange={(e) => setMovementType(e.target.value)}
              className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none"
            >
              <option value="">كل الأنواع</option>
              {movementTypes.map((type) => (
                <option key={type} value={type} className="bg-zinc-950 text-white">
                  {movementTypeLabel(type)}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-zinc-500">الدرجة</div>
            <select
              value={grade}
              onChange={(e) => setGrade(e.target.value)}
              className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none"
            >
              <option value="">كل الدرجات</option>
              {grades.map((value) => (
                <option key={value} value={value} className="bg-zinc-950 text-white">
                  {value}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-zinc-500">الفئة</div>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none"
            >
              <option value="">كل الفئات</option>
              {categories.map((value) => (
                <option key={value} value={value} className="bg-zinc-950 text-white">
                  {value}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-zinc-500">عدد الصفوف</div>
            <select
              value={String(rowCount)}
              onChange={(e) => setRowCount(Number(e.target.value))}
              className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none"
            >
              {ROW_COUNT_OPTIONS.map((value) => (
                <option key={value} value={String(value)} className="bg-zinc-950 text-white">
                  {value}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            onClick={() => {
              setSearch("");
              setMovementType("");
              setGrade("");
              setCategory("");
              setRowCount(200);
            }}
            className="self-end rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
          >
            إعادة ضبط
          </button>
        </div>
      </div>

      <div className="rounded-3xl border border-white/10 bg-zinc-950/90 shadow-2xl shadow-black/10">
        <div className="flex flex-col gap-2 border-b border-white/10 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-xl font-black text-white">سجل الحركات</h3>
            <p className="mt-1 text-sm text-zinc-400">مجمعة حسب المنتج. افتح أي منتج لفحص كل حركة تخص الاختيارات تحته.</p>
          </div>
          <div className="text-sm text-zinc-400">
            {groupedMovements.length} منتج مجمّع · {movements.length} صف
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16 text-zinc-400">
            <Loader2 className="mr-2 h-5 w-5 animate-spin text-emerald-400" />
            جارٍ تحميل حركات المخزون...
          </div>
        ) : error ? (
          <div className="p-5 text-sm text-red-100">
            <div className="rounded-3xl border border-red-500/20 bg-red-500/10 p-5">{error}</div>
          </div>
        ) : groupedMovements.length === 0 ? (
          <div className="p-8 text-center text-zinc-400">
            <div className="rounded-3xl border border-dashed border-white/10 bg-white/5 p-10">
              لا توجد حركات.
            </div>
          </div>
        ) : (
          <div className="space-y-3 p-3">
            {groupedMovements.map((group) => {
              const expanded = expandedGroups.includes(group.key);
              const imageUrl = resolveProductImageUrl(group.product_image_url || "");
              return (
                <article key={group.key} className="overflow-hidden rounded-[28px] border border-white/10 bg-white/[0.03] shadow-[0_20px_60px_rgba(0,0,0,0.18)]">
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.key)}
                    className="grid w-full gap-3 px-4 py-4 text-left transition hover:bg-white/[0.04] md:grid-cols-[76px_minmax(0,1.8fr)_auto] md:items-center md:px-5"
                    aria-expanded={expanded}
                  >
                    <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-white/5 text-zinc-500">
                      {imageUrl ? (
                        <img src={imageUrl} alt={group.product_name} className="h-full w-full object-cover" loading="lazy" />
                      ) : (
                        <ImageIcon className="h-6 w-6" />
                      )}
                    </div>

                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="truncate text-lg font-black text-white">{group.product_name}</h4>
                        {group.product_grade ? <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-black text-zinc-300">{group.product_grade}</span> : null}
                        {group.category_name ? <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-black text-zinc-300">{group.category_name}</span> : null}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-semibold text-zinc-400">
                        {group.product_code ? <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1">كود المنتج: {group.product_code}</span> : null}
                        {group.manufacturer_name ? <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1">{group.manufacturer_name}</span> : null}
                        <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1">{summarizeLocations(group.movements)}</span>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 md:min-w-[420px] md:justify-self-end">
                      <Stat label="عدد الحركات" value={group.movementCount} />
                      <Stat
                        label="صافي التغيير"
                        value={formatSignedQuantity(group.totalDelta)}
                        tone={group.totalDelta >= 0 ? "emerald" : "rose"}
                      />
                      <Stat label="آخر تاريخ" value={group.lastMovementAt ? formatDateTime(group.lastMovementAt) : "غير متاح"} />
                      <div className="flex items-center justify-end md:justify-center">
                        <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs font-black uppercase tracking-[0.14em] text-zinc-300">
                          {expanded ? "طي" : "توسيع"}
                          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        </span>
                      </div>
                    </div>
                  </button>

                  {expanded ? (
                    <div className="border-t border-white/10 bg-black/10 px-4 py-4 md:px-5">
                      <CurrentStockSummary
                        loading={Boolean(productSnapshots[String(group.product_id ?? "")]?.loading)}
                        error={productSnapshots[String(group.product_id ?? "")]?.error || ""}
                        rows={productSnapshots[String(group.product_id ?? "")]?.rows || []}
                      />

                      <div className="mb-3 flex items-center justify-between gap-3">
                        <div>
                          <div className="text-xs uppercase tracking-[0.18em] text-zinc-500">حركات الاختيار</div>
                          <div className="mt-1 text-sm text-zinc-400">اضغط صف الاختيار لفتح خطه الزمني الكامل.</div>
                        </div>
                        <div className="text-xs font-semibold text-zinc-500">{group.movements.length} صف</div>
                      </div>

                      <div className="grid gap-2">
                        {group.movements.map((movement) => {
                          const delta = toNumber(movement.quantity_delta ?? movement.quantity_change ?? movement.quantity ?? 0, 0);
                          const variantImage = resolveProductImageUrl(
                            movement.color_image_url || movement.variant_image_url || movement.product_image_url || movement.image_url || ""
                          );
                          return (
                            <button
                              key={String(movement.id)}
                              type="button"
                              onClick={() => openVariantHistory(movement, group)}
                              className="grid gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-4 text-left transition hover:border-emerald-400/30 hover:bg-white/[0.06] md:grid-cols-[56px_minmax(0,1.35fr)_auto]"
                            >
                              <div className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-white/5 text-zinc-500">
                                {variantImage ? (
                                  <img src={variantImage} alt={group.product_name} className="h-full w-full object-cover" loading="lazy" />
                                ) : (
                                  <ImageIcon className="h-5 w-5" />
                                )}
                              </div>

                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-black text-zinc-300">{movementTypeLabel(movement.movement_type)}</span>
                                  <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-black text-zinc-300">
                                    {movement.color || "لا يوجد لون"}
                                  </span>
                                  <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-black text-zinc-300">
                                    {movement.size || "لا يوجد مقاس"}
                                  </span>
                                  {movement.variant_article_code ? (
                                    <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-black text-zinc-300">
                                      {movement.variant_article_code}
                                    </span>
                                  ) : null}
                                </div>

                                <div className="mt-2 grid gap-1 text-xs text-zinc-400 md:grid-cols-2">
                                  <div>
                                    <span className="font-black text-zinc-200">السبب:</span> {movement.reason || movement.notes || "غير متاح"}
                                  </div>
                                  <div>
                                    <span className="font-black text-zinc-200">المرجع:</span>{" "}
                                    {movement.reference_type || "غير متاح"} #{movement.reference_id || "غير متاح"}
                                  </div>
                                  <div>
                                    <span className="font-black text-zinc-200">المستخدم:</span> {movement.created_by_name || "غير متاح"}
                                  </div>
                                  <div>
                                    <span className="font-black text-zinc-200">التاريخ/الوقت:</span> {formatDateTime(movement.created_at)}
                                  </div>
                                  <div>
                                    <span className="font-black text-zinc-200">المخزن/الفرع:</span>{" "}
                                    {[movement.warehouse_name, movement.branch_name].filter(Boolean).join(" · ") || "غير متاح"}
                                  </div>
                                  <div>
                                    <span className="font-black text-zinc-200">SKU/الباركود:</span>{" "}
                                    {[movement.sku || "غير متاح", movement.barcode || "غير متاح"].join(" / ")}
                                  </div>
                                </div>
                              </div>

                              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 md:min-w-[350px]">
                                <Stat label="الكمية" value={formatSignedQuantity(delta)} tone={delta >= 0 ? "emerald" : "rose"} />
                                <Stat label="قبل" value={Number(movement.quantity_before ?? movement.before_qty ?? 0)} />
                                <Stat label="بعد" value={Number(movement.quantity_after ?? movement.after_qty ?? 0)} />
                                <Stat label="السجل" value="فتح" tone="violet" />
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </div>

      {activeVariant ? (
        <VariantHistoryDrawer
          activeVariant={activeVariant}
          loading={variantHistoryLoading}
          error={variantHistoryError}
          movements={variantHistoryMovements}
          onClose={closeVariantHistory}
        />
      ) : null}
    </InventoryShell>
  );
}

function CurrentStockSummary({ loading, error, rows }) {
  const totalStock = useMemo(() => rows.reduce((sum, row) => sum + toNumber(row.stock ?? 0, 0), 0), [rows]);
  const numberOfColors = useMemo(() => new Set(rows.map((row) => normalizeText(row.color)).filter(Boolean)).size, [rows]);
  const numberOfActiveSizes = useMemo(() => new Set(rows.filter((row) => toNumber(row.stock ?? 0, 0) > 0).map((row) => normalizeText(row.size)).filter(Boolean)).size, [rows]);

  return (
    <div className="mb-4 rounded-[24px] border border-white/10 bg-white/[0.04] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.18em] text-zinc-500">ملخص الرصيد الحالي</div>
          <div className="mt-1 text-sm text-zinc-400">الرصيد الحالي للاختيارات مجمّع حسب اللون والمقاس.</div>
        </div>
        {loading ? <Loader2 className="h-4 w-4 animate-spin text-emerald-400" /> : null}
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <Metric label="إجمالي الرصيد الحالي" value={totalStock} tone="emerald" />
        <Metric label="عدد الألوان" value={numberOfColors} tone="blue" />
        <Metric label="عدد المقاسات النشطة" value={numberOfActiveSizes} tone="violet" />
      </div>

      {error ? <div className="mt-3 rounded-2xl border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{error}</div> : null}

      <div className="mt-4 lg:hidden">
        {rows.length ? (
          <div className="space-y-2">
            {rows.map((row) => (
              <div key={`${row.color}::${row.size}`} className="rounded-2xl border border-white/10 bg-black/20 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-black text-white">{row.color || "غير محدد"}</div>
                    <div className="mt-1 text-xs text-zinc-400">{row.size || "غير محدد"}</div>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-black text-white tabular-nums">
                    {row.stock}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-white/10 bg-white/5 px-3 py-4 text-sm text-zinc-400">
            لا توجد لقطة رصيد مباشرة متاحة.
          </div>
        )}
      </div>

      <div className="mt-4 hidden lg:block">
        <div className="overflow-hidden rounded-2xl border border-white/10 bg-black/20">
          <table className="min-w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-white/10 text-xs uppercase tracking-[0.18em] text-zinc-500">
                <th className="px-4 py-3 font-semibold">اللون</th>
                <th className="px-4 py-3 font-semibold">المقاس</th>
                <th className="px-4 py-3 font-semibold">الرصيد الحالي</th>
              </tr>
            </thead>
            <tbody>
              {rows.length ? (
                rows.map((row) => (
                  <tr key={`${row.color}::${row.size}`} className="border-b border-white/5 last:border-b-0">
                    <td className="px-4 py-3 font-semibold text-white">{row.color || "غير محدد"}</td>
                    <td className="px-4 py-3 text-zinc-300">{row.size || "غير محدد"}</td>
                    <td className="px-4 py-3 font-black text-emerald-300 tabular-nums">{row.stock}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={3} className="px-4 py-6 text-center text-zinc-400">
                    لا توجد لقطة رصيد مباشرة متاحة.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value, tone = "neutral" }) {
  const classes = {
    emerald: "border-emerald-500/20 bg-emerald-500/10 text-emerald-200",
    blue: "border-sky-500/20 bg-sky-500/10 text-sky-200",
    violet: "border-violet-500/20 bg-violet-500/10 text-violet-200",
    rose: "border-rose-500/20 bg-rose-500/10 text-rose-200",
    amber: "border-amber-500/20 bg-amber-500/10 text-amber-200",
    neutral: "border-white/10 bg-white/5 text-white",
  };

  return (
    <div className={`rounded-3xl border p-4 shadow-xl ${classes[tone]}`}>
      <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">{label}</div>
      <div className="mt-2 break-words text-2xl font-black text-white">{value}</div>
    </div>
  );
}

function Stat({ label, value, tone = "neutral" }) {
  const classes = {
    emerald: "text-emerald-300",
    rose: "text-rose-300",
    violet: "text-violet-300",
    neutral: "text-white",
    amber: "text-amber-300",
  };

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2">
      <div className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">{label}</div>
      <div className={`mt-1 break-words text-sm font-black ${classes[tone]}`}>{value}</div>
    </div>
  );
}

function MovementBadge({ type }) {
  const value = String(type || "movement").toUpperCase();
  const palette = {
    PURCHASE_IN: "border-emerald-500/20 bg-emerald-500/10 text-emerald-300",
    SALE_OUT: "border-rose-500/20 bg-rose-500/10 text-rose-300",
    RETURN_IN: "border-blue-500/20 bg-blue-500/10 text-blue-300",
    ADJUSTMENT: "border-white/10 bg-white/5 text-white",
    TRANSFER_IN: "border-sky-500/20 bg-sky-500/10 text-sky-300",
    TRANSFER_OUT: "border-sky-500/20 bg-sky-500/10 text-sky-300",
    COUNT_ADJUSTMENT: "border-violet-500/20 bg-violet-500/10 text-violet-300",
    ORDER_CANCEL_RESTORE: "border-amber-500/20 bg-amber-500/10 text-amber-300",
    OPENING_BALANCE: "border-cyan-500/20 bg-cyan-500/10 text-cyan-300",
  };

  return (
    <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] ${palette[value] || "border-white/10 bg-white/5 text-white"}`}>
      {movementTypeLabel(type)}
    </span>
  );
}

function VariantHistoryDrawer({ activeVariant, loading, error, movements, onClose }) {
  const movement = activeVariant?.movement || {};
  const group = activeVariant?.group || {};
  const imageUrl = resolveProductImageUrl(
    movement.color_image_url || movement.variant_image_url || movement.product_image_url || group.product_image_url || movement.image_url || ""
  );

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/80 p-0 backdrop-blur-sm sm:items-center sm:p-4">
      <button type="button" className="absolute inset-0" onClick={onClose} aria-label="إغلاق سجل الاختيار" />
      <div className="relative flex h-[92dvh] w-full max-w-5xl flex-col overflow-hidden rounded-t-3xl border border-white/10 bg-zinc-950 shadow-2xl shadow-black sm:rounded-3xl">
        <div className="flex items-start justify-between gap-3 border-b border-white/10 px-5 py-4">
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">سجل الاختيار</div>
            <h3 className="mt-1 truncate text-xl font-black text-white">{group.product_name || movement.product_name || "سجل الاختيار"}</h3>
            <div className="mt-1 flex flex-wrap gap-2 text-xs font-semibold text-zinc-400">
              {movement.color ? <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1">{movement.color}</span> : null}
              {movement.size ? <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1">{movement.size}</span> : null}
              {movement.sku ? <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1">رمز الصنف: {movement.sku}</span> : null}
              {movement.barcode ? <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1">الباركود: {movement.barcode}</span> : null}
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold text-white">
            إغلاق
          </button>
        </div>

        <div className="grid flex-1 gap-4 overflow-hidden p-5 lg:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="rounded-3xl border border-white/10 bg-white/[0.03] p-4">
            <div className="flex items-start gap-3">
              <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-white/5 text-zinc-500">
                {imageUrl ? <img src={imageUrl} alt={group.product_name || movement.product_name || "صورة المنتج"} className="h-full w-full object-cover" /> : <ImageIcon className="h-6 w-6" />}
              </div>
              <div className="min-w-0 flex-1">
                <MovementBadge type={movement.movement_type} />
                <div className="mt-2 text-sm font-black text-white">{movementTypeLabel(movement.movement_type)}</div>
                <div className="mt-1 text-xs leading-5 text-zinc-400">{movement.reason || movement.notes || "لم يتم توفير سبب."}</div>
              </div>
            </div>

            <div className="mt-4 grid gap-2 text-sm">
              <Detail label="الكمية قبل" value={Number(movement.quantity_before ?? movement.before_qty ?? 0)} />
              <Detail label="التغيير في الكمية" value={formatSignedQuantity(movement.quantity_change ?? movement.quantity_delta ?? movement.quantity ?? 0)} />
              <Detail label="الكمية بعد" value={Number(movement.quantity_after ?? movement.after_qty ?? 0)} />
              <Detail label="المرجع" value={`${movement.reference_type || "غير متاح"} #${movement.reference_id || "غير متاح"}`} />
              <Detail label="المستخدم" value={movement.created_by_name || "غير متاح"} />
              <Detail label="المخزن / الفرع" value={[movement.warehouse_name, movement.branch_name].filter(Boolean).join(" • ") || "غير متاح"} />
              <Detail label="التاريخ/الوقت" value={formatDateTime(movement.created_at)} />
            </div>
          </aside>

          <section className="flex min-h-0 flex-col rounded-3xl border border-white/10 bg-black/10">
            <div className="border-b border-white/10 px-4 py-3">
              <div className="text-xs uppercase tracking-[0.18em] text-zinc-500">التسلسل الزمني الكامل للاختيار</div>
              <div className="mt-1 text-sm text-zinc-400">المشتريات والمبيعات والمرتجعات والتحويلات والجرد والتسويات لهذا الاختيار تحديدًا.</div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {loading ? (
                <div className="flex h-full items-center justify-center py-16 text-zinc-400">
                  <Loader2 className="mr-2 h-5 w-5 animate-spin text-emerald-400" />
                  جارٍ تحميل سجل الاختيار...
                </div>
              ) : error ? (
                <div className="rounded-3xl border border-red-500/20 bg-red-500/10 p-5 text-sm text-red-100">{error}</div>
              ) : movements.length === 0 ? (
                <div className="rounded-3xl border border-dashed border-white/10 bg-white/5 p-10 text-center text-zinc-400">
                  لا يوجد سجل حركات لهذا الاختيار.
                </div>
              ) : (
                <div className="grid gap-2">
                  {movements.map((item) => {
                    const delta = toNumber(item.quantity_change ?? item.quantity_delta ?? item.quantity ?? 0, 0);
                    const itemImage = resolveProductImageUrl(item.color_image_url || item.variant_image_url || item.product_image_url || item.image_url || "");
                    return (
                      <div key={String(item.id)} className="grid gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-4 md:grid-cols-[48px_minmax(0,1.4fr)_auto]">
                        <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-white/5 text-zinc-500">
                          {itemImage ? <img src={itemImage} alt={item.product_name || "الاختيار"} className="h-full w-full object-cover" /> : <ImageIcon className="h-5 w-5" />}
                        </div>

                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <MovementBadge type={item.movement_type} />
                            {item.color ? <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-black text-zinc-300">{item.color}</span> : null}
                            {item.size ? <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-black text-zinc-300">{item.size}</span> : null}
                          </div>
                          <div className="mt-2 grid gap-1 text-xs text-zinc-400 md:grid-cols-2">
                            <div>
                              <span className="font-black text-zinc-200">السبب:</span> {item.reason || item.notes || "غير متاح"}
                            </div>
                            <div>
                              <span className="font-black text-zinc-200">المرجع:</span> {item.reference_type || "غير متاح"} #{item.reference_id || "غير متاح"}
                            </div>
                            <div>
                              <span className="font-black text-zinc-200">المستخدم:</span> {item.created_by_name || "غير متاح"}
                            </div>
                            <div>
                              <span className="font-black text-zinc-200">التاريخ/الوقت:</span> {formatDateTime(item.created_at)}
                            </div>
                            <div>
                              <span className="font-black text-zinc-200">المخزن/الفرع:</span>{" "}
                              {[item.warehouse_name, item.branch_name].filter(Boolean).join(" · ") || "غير متاح"}
                            </div>
                            <div>
                              <span className="font-black text-zinc-200">قبل / بعد:</span>{" "}
                              {Number(item.quantity_before ?? item.before_qty ?? 0)} / {Number(item.quantity_after ?? item.after_qty ?? 0)}
                            </div>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 md:min-w-[290px]">
                          <Stat label="الكمية" value={formatSignedQuantity(delta)} tone={delta >= 0 ? "emerald" : "rose"} />
                          <Stat label="قبل" value={Number(item.quantity_before ?? item.before_qty ?? 0)} />
                          <Stat label="بعد" value={Number(item.quantity_after ?? item.after_qty ?? 0)} />
                          <Stat label="النوع" value={movementTypeLabel(item.movement_type)} tone="violet" />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function Detail({ label, value }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-3">
      <div className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">{label}</div>
      <div className="mt-1 break-words text-sm font-black text-white">{value}</div>
    </div>
  );
}

export default StockMovements;
