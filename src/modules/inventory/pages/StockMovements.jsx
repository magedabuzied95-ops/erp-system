import { useEffect, useMemo, useState } from "react";
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

const ROW_COUNT_OPTIONS = [50, 100, 200, 500];

const movementTypeLabel = (value = "") => String(value || "movement").replace(/_/g, " ").toUpperCase();

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

  if (!locations.length) return "n/a";
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
  const [activeVariant, setActiveVariant] = useState(null);
  const [variantHistoryLoading, setVariantHistoryLoading] = useState(false);
  const [variantHistoryError, setVariantHistoryError] = useState("");
  const [variantHistoryMovements, setVariantHistoryMovements] = useState([]);

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
        setError(err?.message || "Failed to load inventory movements");
        toast.error(err?.message || "Failed to load inventory movements");
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
      setVariantHistoryError(err?.message || "Failed to load variant history");
      toast.error(err?.message || "Failed to load variant history");
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
      title="Stock Movements"
      subtitle="Grouped by product so size and color variants stay readable, searchable, and easy to inspect."
      actions={
        <div className="flex flex-wrap gap-2">
          <Link to="/inventory/history" className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white">
            <Clock3 className="mr-2 inline h-4 w-4" />
            Variant history
          </Link>
        </div>
      }
      tabs={[
        { to: "/inventory", label: "Inventory", end: true },
        { to: "/inventory/movements", label: "Movements", end: true },
        { to: "/inventory/adjustments", label: "Adjustments" },
        { to: "/inventory/count", label: "Count" },
        { to: "/stock-transfers", label: "Transfers" },
        { to: "/warehouses", label: "Warehouses" },
      ]}
    >
      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-4">
        <Metric label="Product groups" value={summary.productGroups} tone="emerald" />
        <Metric label="Movement rows" value={summary.movementRows} tone="blue" />
        <Metric label="Net quantity" value={formatSignedQuantity(summary.netQuantity)} tone="violet" />
        <Metric label="Row limit" value={rowCount} tone="amber" />
      </div>

      <div className="rounded-3xl border border-white/10 bg-zinc-950/90 p-4 shadow-2xl shadow-black/10">
        <div className="grid gap-3 xl:grid-cols-[minmax(0,1.4fr)_180px_180px_180px_180px_auto]">
          <label className="relative block xl:col-span-1">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search product, SKU, barcode, color, size, reason, user..."
              className="w-full rounded-2xl border border-white/10 bg-white/5 py-3 pl-11 pr-4 text-sm text-white outline-none placeholder:text-zinc-500"
            />
          </label>

          <label className="block">
            <div className="mb-2 flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-zinc-500">
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Movement type
            </div>
            <select
              value={movementType}
              onChange={(e) => setMovementType(e.target.value)}
              className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none"
            >
              <option value="">All types</option>
              {movementTypes.map((type) => (
                <option key={type} value={type} className="bg-zinc-950 text-white">
                  {movementTypeLabel(type)}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-zinc-500">Grade</div>
            <select
              value={grade}
              onChange={(e) => setGrade(e.target.value)}
              className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none"
            >
              <option value="">All grades</option>
              {grades.map((value) => (
                <option key={value} value={value} className="bg-zinc-950 text-white">
                  {value}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-zinc-500">Category</div>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none"
            >
              <option value="">All categories</option>
              {categories.map((value) => (
                <option key={value} value={value} className="bg-zinc-950 text-white">
                  {value}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-zinc-500">Row count</div>
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
            Reset
          </button>
        </div>
      </div>

      <div className="rounded-3xl border border-white/10 bg-zinc-950/90 shadow-2xl shadow-black/10">
        <div className="flex flex-col gap-2 border-b border-white/10 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-xl font-black text-white">Movement ledger</h3>
            <p className="mt-1 text-sm text-zinc-400">Grouped by product. Expand a product to inspect every variant movement underneath.</p>
          </div>
          <div className="text-sm text-zinc-400">
            {groupedMovements.length} grouped products · {movements.length} rows
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16 text-zinc-400">
            <Loader2 className="mr-2 h-5 w-5 animate-spin text-emerald-400" />
            Loading inventory movements...
          </div>
        ) : error ? (
          <div className="p-5 text-sm text-red-100">
            <div className="rounded-3xl border border-red-500/20 bg-red-500/10 p-5">{error}</div>
          </div>
        ) : groupedMovements.length === 0 ? (
          <div className="p-8 text-center text-zinc-400">
            <div className="rounded-3xl border border-dashed border-white/10 bg-white/5 p-10">
              No movements found.
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
                        {group.product_code ? <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1">Code: {group.product_code}</span> : null}
                        {group.manufacturer_name ? <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1">{group.manufacturer_name}</span> : null}
                        <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1">{summarizeLocations(group.movements)}</span>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 md:min-w-[420px] md:justify-self-end">
                      <Stat label="Movements" value={group.movementCount} />
                      <Stat
                        label="Net change"
                        value={formatSignedQuantity(group.totalDelta)}
                        tone={group.totalDelta >= 0 ? "emerald" : "rose"}
                      />
                      <Stat label="Last date" value={group.lastMovementAt ? formatDateTime(group.lastMovementAt) : "n/a"} />
                      <div className="flex items-center justify-end md:justify-center">
                        <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs font-black uppercase tracking-[0.14em] text-zinc-300">
                          {expanded ? "Collapse" : "Expand"}
                          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        </span>
                      </div>
                    </div>
                  </button>

                  {expanded ? (
                    <div className="border-t border-white/10 bg-black/10 px-4 py-4 md:px-5">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <div>
                          <div className="text-xs uppercase tracking-[0.18em] text-zinc-500">Variant movements</div>
                          <div className="mt-1 text-sm text-zinc-400">Click a variant row to open its full history timeline.</div>
                        </div>
                        <div className="text-xs font-semibold text-zinc-500">{group.movements.length} rows</div>
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
                                    {movement.color || "No color"}
                                  </span>
                                  <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-black text-zinc-300">
                                    {movement.size || "No size"}
                                  </span>
                                  {movement.variant_article_code ? (
                                    <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-black text-zinc-300">
                                      {movement.variant_article_code}
                                    </span>
                                  ) : null}
                                </div>

                                <div className="mt-2 grid gap-1 text-xs text-zinc-400 md:grid-cols-2">
                                  <div>
                                    <span className="font-black text-zinc-200">Reason:</span> {movement.reason || movement.notes || "n/a"}
                                  </div>
                                  <div>
                                    <span className="font-black text-zinc-200">Reference:</span>{" "}
                                    {movement.reference_type || "n/a"} #{movement.reference_id || "n/a"}
                                  </div>
                                  <div>
                                    <span className="font-black text-zinc-200">User:</span> {movement.created_by_name || "n/a"}
                                  </div>
                                  <div>
                                    <span className="font-black text-zinc-200">Date/time:</span> {formatDateTime(movement.created_at)}
                                  </div>
                                  <div>
                                    <span className="font-black text-zinc-200">Warehouse/branch:</span>{" "}
                                    {[movement.warehouse_name, movement.branch_name].filter(Boolean).join(" · ") || "n/a"}
                                  </div>
                                  <div>
                                    <span className="font-black text-zinc-200">SKU/barcode:</span>{" "}
                                    {[movement.sku || "n/a", movement.barcode || "n/a"].join(" / ")}
                                  </div>
                                </div>
                              </div>

                              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 md:min-w-[350px]">
                                <Stat label="Qty" value={formatSignedQuantity(delta)} tone={delta >= 0 ? "emerald" : "rose"} />
                                <Stat label="Before" value={Number(movement.quantity_before ?? movement.before_qty ?? 0)} />
                                <Stat label="After" value={Number(movement.quantity_after ?? movement.after_qty ?? 0)} />
                                <Stat label="History" value="Open" tone="violet" />
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
      {value}
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
      <button type="button" className="absolute inset-0" onClick={onClose} aria-label="Close variant history" />
      <div className="relative flex h-[92dvh] w-full max-w-5xl flex-col overflow-hidden rounded-t-3xl border border-white/10 bg-zinc-950 shadow-2xl shadow-black sm:rounded-3xl">
        <div className="flex items-start justify-between gap-3 border-b border-white/10 px-5 py-4">
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">Variant History</div>
            <h3 className="mt-1 truncate text-xl font-black text-white">{group.product_name || movement.product_name || "Variant history"}</h3>
            <div className="mt-1 flex flex-wrap gap-2 text-xs font-semibold text-zinc-400">
              {movement.color ? <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1">{movement.color}</span> : null}
              {movement.size ? <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1">{movement.size}</span> : null}
              {movement.sku ? <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1">SKU: {movement.sku}</span> : null}
              {movement.barcode ? <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1">Barcode: {movement.barcode}</span> : null}
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold text-white">
            Close
          </button>
        </div>

        <div className="grid flex-1 gap-4 overflow-hidden p-5 lg:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="rounded-3xl border border-white/10 bg-white/[0.03] p-4">
            <div className="flex items-start gap-3">
              <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-white/5 text-zinc-500">
                {imageUrl ? <img src={imageUrl} alt={group.product_name || movement.product_name || "Product image"} className="h-full w-full object-cover" /> : <ImageIcon className="h-6 w-6" />}
              </div>
              <div className="min-w-0 flex-1">
                <MovementBadge type={movement.movement_type} />
                <div className="mt-2 text-sm font-black text-white">{movementTypeLabel(movement.movement_type)}</div>
                <div className="mt-1 text-xs leading-5 text-zinc-400">{movement.reason || movement.notes || "No reason provided."}</div>
              </div>
            </div>

            <div className="mt-4 grid gap-2 text-sm">
              <Detail label="Quantity before" value={Number(movement.quantity_before ?? movement.before_qty ?? 0)} />
              <Detail label="Quantity change" value={formatSignedQuantity(movement.quantity_change ?? movement.quantity_delta ?? movement.quantity ?? 0)} />
              <Detail label="Quantity after" value={Number(movement.quantity_after ?? movement.after_qty ?? 0)} />
              <Detail label="Reference" value={`${movement.reference_type || "n/a"} #${movement.reference_id || "n/a"}`} />
              <Detail label="User" value={movement.created_by_name || "n/a"} />
              <Detail label="Warehouse / branch" value={[movement.warehouse_name, movement.branch_name].filter(Boolean).join(" · ") || "n/a"} />
              <Detail label="Date/time" value={formatDateTime(movement.created_at)} />
            </div>
          </aside>

          <section className="flex min-h-0 flex-col rounded-3xl border border-white/10 bg-black/10">
            <div className="border-b border-white/10 px-4 py-3">
              <div className="text-xs uppercase tracking-[0.18em] text-zinc-500">Complete variant timeline</div>
              <div className="mt-1 text-sm text-zinc-400">Purchases, sales, returns, transfers, counts, and adjustments for this exact variant.</div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {loading ? (
                <div className="flex h-full items-center justify-center py-16 text-zinc-400">
                  <Loader2 className="mr-2 h-5 w-5 animate-spin text-emerald-400" />
                  Loading variant history...
                </div>
              ) : error ? (
                <div className="rounded-3xl border border-red-500/20 bg-red-500/10 p-5 text-sm text-red-100">{error}</div>
              ) : movements.length === 0 ? (
                <div className="rounded-3xl border border-dashed border-white/10 bg-white/5 p-10 text-center text-zinc-400">
                  No movement history found for this variant.
                </div>
              ) : (
                <div className="grid gap-2">
                  {movements.map((item) => {
                    const delta = toNumber(item.quantity_change ?? item.quantity_delta ?? item.quantity ?? 0, 0);
                    const itemImage = resolveProductImageUrl(item.color_image_url || item.variant_image_url || item.product_image_url || item.image_url || "");
                    return (
                      <div key={String(item.id)} className="grid gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-4 md:grid-cols-[48px_minmax(0,1.4fr)_auto]">
                        <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-white/5 text-zinc-500">
                          {itemImage ? <img src={itemImage} alt={item.product_name || "Variant"} className="h-full w-full object-cover" /> : <ImageIcon className="h-5 w-5" />}
                        </div>

                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <MovementBadge type={item.movement_type} />
                            {item.color ? <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-black text-zinc-300">{item.color}</span> : null}
                            {item.size ? <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-black text-zinc-300">{item.size}</span> : null}
                          </div>
                          <div className="mt-2 grid gap-1 text-xs text-zinc-400 md:grid-cols-2">
                            <div>
                              <span className="font-black text-zinc-200">Reason:</span> {item.reason || item.notes || "n/a"}
                            </div>
                            <div>
                              <span className="font-black text-zinc-200">Reference:</span> {item.reference_type || "n/a"} #{item.reference_id || "n/a"}
                            </div>
                            <div>
                              <span className="font-black text-zinc-200">User:</span> {item.created_by_name || "n/a"}
                            </div>
                            <div>
                              <span className="font-black text-zinc-200">Date/time:</span> {formatDateTime(item.created_at)}
                            </div>
                            <div>
                              <span className="font-black text-zinc-200">Warehouse/branch:</span>{" "}
                              {[item.warehouse_name, item.branch_name].filter(Boolean).join(" · ") || "n/a"}
                            </div>
                            <div>
                              <span className="font-black text-zinc-200">Before / After:</span>{" "}
                              {Number(item.quantity_before ?? item.before_qty ?? 0)} / {Number(item.quantity_after ?? item.after_qty ?? 0)}
                            </div>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 md:min-w-[290px]">
                          <Stat label="Qty" value={formatSignedQuantity(delta)} tone={delta >= 0 ? "emerald" : "rose"} />
                          <Stat label="Before" value={Number(item.quantity_before ?? item.before_qty ?? 0)} />
                          <Stat label="After" value={Number(item.quantity_after ?? item.after_qty ?? 0)} />
                          <Stat label="Type" value={movementTypeLabel(item.movement_type)} tone="violet" />
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
