import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

import {
  AlertTriangle,
  Ban,
  Copy,
  Download,
  Edit3,
  Eye,
  MoreHorizontal,
  PackageSearch,
  Plus,
  Search,
  Trash2,
  Truck,
} from "lucide-react";

import toast from "react-hot-toast";
import { api } from "../../../shared/api/api";
import useDismissableLayer from "../../../shared/hooks/useDismissableLayer";
import { Pagination } from "../../../shared/ui";
import FlowShell from "../components/FlowShell";
import {
  buildSearchText,
  formatCurrency,
  formatDateTime,
  normalizePurchase,
  normalizeSupplier,
  normalizeWarehouse,
  purchasePaidAmount,
  seedSuppliers,
  seedWarehouses,
} from "../lib/flowStore";
import { getPrintDirection, normalizePrintLanguage, openPrintHtml, tPrint, wrapPrintableHtml } from "../../../shared/utils/printLocalization";

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100, 200, 500, 1000, "all"];
const purchaseTableColumns = "grid-cols-[3.5rem_8.5rem_minmax(9rem,1fr)_minmax(12rem,1.3fr)_minmax(9rem,0.9fr)_7.5rem_4.5rem_9rem]";
const ACTIONS_MENU_WIDTH = 224;
const ACTIONS_MENU_MARGIN = 8;
const ACTIONS_MENU_Z_INDEX = 9999;
const uniqueValues = (items) => Array.from(new Set(items.filter(Boolean)));
const normalizeStatusValue = (value) => String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
const purchaseDateKey = (value) => String(value || "").slice(0, 10);
const purchaseReceivedDateKey = (purchase) =>
  purchaseDateKey(purchase.received_at || purchase.stock_applied_at || purchase.updated_at || purchase.created_at);
const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
const formatPurchaseDateParts = (value) => {
  if (!value) return { date: "-", time: "" };
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    const [datePart = "-", timePart = ""] = String(value).split(/[T ]/);
    return { date: datePart || "-", time: timePart ? timePart.slice(0, 5) : "" };
  }
  return {
    date: date.toLocaleDateString(),
    time: date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
  };
};

const notifyProductsChanged = (source = "purchase-price-sync") => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("products:refetch", { detail: { source } }));
};

function PurchasesDashboard() {
  const { t, i18n } = useTranslation();
  const [purchases, setPurchases] = useState([]);
  const [suppliers, setSuppliers] = useState(seedSuppliers());
  const [, setWarehouses] = useState(seedWarehouses());
  const [branches, setBranches] = useState([]);
  const [search, setSearch] = useState("");
  const [supplierFilter, setSupplierFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [warehouseFilter, setWarehouseFilter] = useState("all");
  const [branchFilter, setBranchFilter] = useState("all");
  const [paymentFilter, setPaymentFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState("");
  const [dateFromFilter, setDateFromFilter] = useState("");
  const [dateToFilter, setDateToFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [openMenuId, setOpenMenuId] = useState(null);
  const [menuPosition, setMenuPosition] = useState(null);
  const menuAnchorRef = useRef(null);

  const positionActionsMenu = useCallback((button) => {
    if (typeof window === "undefined" || !button) return null;

    const rect = button.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const estimatedHeight = 336;
    const preferRight = rect.right + ACTIONS_MENU_MARGIN;
    const left =
      preferRight + ACTIONS_MENU_WIDTH <= viewportWidth - ACTIONS_MENU_MARGIN
        ? preferRight
        : Math.max(ACTIONS_MENU_MARGIN, rect.left - ACTIONS_MENU_WIDTH - ACTIONS_MENU_MARGIN);
    const top = Math.min(
      Math.max(ACTIONS_MENU_MARGIN, rect.top),
      Math.max(ACTIONS_MENU_MARGIN, viewportHeight - estimatedHeight - ACTIONS_MENU_MARGIN)
    );

    return { left, top };
  }, []);

  const closeActionsMenu = useCallback(() => {
    setOpenMenuId(null);
    setMenuPosition(null);
    menuAnchorRef.current = null;
  }, []);

  const openActionsMenu = (purchaseId, button) => {
    if (openMenuId === purchaseId) {
      closeActionsMenu();
      return;
    }

    menuAnchorRef.current = button;
    setMenuPosition(positionActionsMenu(button));
    setOpenMenuId(purchaseId);
  };

  useEffect(() => {
    if (!openMenuId) return undefined;

    const updatePosition = () => {
      const button = menuAnchorRef.current;
      if (!button || !document.body.contains(button)) {
        closeActionsMenu();
        return;
      }
      setMenuPosition(positionActionsMenu(button));
    };

    const closeOnEscape = (event) => {
      if (event.key === "Escape") closeActionsMenu();
    };

    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    document.addEventListener("keydown", closeOnEscape);

    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [closeActionsMenu, openMenuId, positionActionsMenu]);

  const loadData = async () => {
    try {
      setLoading(true);
      setError("");

      const [suppliersRes, warehousesRes, branchesRes] = await Promise.allSettled([
        api.get("/suppliers?limit=200&page=1"),
        api.get("/warehouses"),
        api.get("/branches"),
      ]);

      if (suppliersRes.status === "fulfilled") {
        const rows = Array.isArray(suppliersRes.value.suppliers)
          ? suppliersRes.value.suppliers
          : [];
        setSuppliers(rows.length ? rows.map(normalizeSupplier) : seedSuppliers());
      } else {
        setSuppliers(seedSuppliers());
      }

      if (warehousesRes.status === "fulfilled") {
        const rows = Array.isArray(warehousesRes.value) ? warehousesRes.value : warehousesRes.value?.warehouses || [];
        setWarehouses(rows.length ? rows.map(normalizeWarehouse) : seedWarehouses());
      } else {
        setWarehouses(seedWarehouses());
      }

      if (branchesRes.status === "fulfilled") {
        const rows = Array.isArray(branchesRes.value) ? branchesRes.value : branchesRes.value?.branches || branchesRes.value?.data || [];
        setBranches(Array.isArray(rows) ? rows : []);
      } else {
        setBranches([]);
      }

      const purchasesRes = await api.get("/purchases");
      const purchaseRows = Array.isArray(purchasesRes?.purchases)
        ? purchasesRes.purchases
        : Array.isArray(purchasesRes?.data)
          ? purchasesRes.data
          : [];
      setPurchases(purchaseRows.map(normalizePurchase));
    } catch (err) {
      console.log(err);
      setPurchases([]);
      setSuppliers(seedSuppliers());
      setWarehouses(seedWarehouses());
      setError(t("common.noData"));
      toast.error(t("common.noData"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const filteredPurchases = useMemo(() => {
    const query = search.trim().toLowerCase();
    return purchases.filter((purchase) => {
      const matchesSearch = !query || buildSearchText(purchase).includes(query);
      const matchesSupplier =
        supplierFilter === "all" || purchase.supplier_name === supplierFilter || String(purchase.supplier_id) === supplierFilter;
      const matchesStatus = statusFilter === "all" || purchase.status === statusFilter;
      const matchesWarehouse = warehouseFilter === "all" || purchase.warehouse_name === warehouseFilter;
      const matchesBranch =
        branchFilter === "all" ||
        String(purchase.branch_id || "") === String(branchFilter) ||
        purchase.branch_name === branches.find((branch) => String(branch.id) === String(branchFilter))?.name;
      const matchesPayment = paymentFilter === "all" || purchase.payment_status === paymentFilter;
      const matchesDate = !dateFilter || String(purchase.created_at || "").slice(0, 10) === dateFilter;
      const date = String(purchase.created_at || "").slice(0, 10);
      const matchesDateFrom = !dateFromFilter || date >= dateFromFilter;
      const matchesDateTo = !dateToFilter || date <= dateToFilter;
      return matchesSearch && matchesSupplier && matchesStatus && matchesWarehouse && matchesBranch && matchesPayment && matchesDate && matchesDateFrom && matchesDateTo;
    });
  }, [purchases, search, supplierFilter, statusFilter, warehouseFilter, branchFilter, paymentFilter, dateFilter, dateFromFilter, dateToFilter, branches]);

  useEffect(() => {
    setPage(1);
    closeActionsMenu();
  }, [search, supplierFilter, statusFilter, warehouseFilter, branchFilter, paymentFilter, dateFilter, dateFromFilter, dateToFilter, closeActionsMenu]);

  const totalPages = Math.max(1, Math.ceil(filteredPurchases.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const visiblePurchases = filteredPurchases.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const purchaseKpis = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return filteredPurchases.reduce(
      (summary, purchase) => {
        const status = normalizeStatusValue(purchase.status);
        const paymentStatus = normalizeStatusValue(purchase.payment_status);
        const total = Number(purchase.total || 0);
        const paid = purchasePaidAmount(purchase);
        const remaining = Number(
          purchase.remaining_amount ?? (paymentStatus === "paid" ? 0 : Math.max(0, total - paid))
        ) || 0;

        summary.totalPurchases += 1;
        summary.totalSpend += total;
        summary.supplierBalances += Math.max(0, remaining);
        if (status.includes("pending") || status.includes("ordered") || status.includes("partial")) summary.pendingOrders += 1;
        if (status.includes("received") && purchaseReceivedDateKey(purchase) === today) summary.receivedToday += 1;
        return summary;
      },
      {
        totalPurchases: 0,
        totalSpend: 0,
        pendingOrders: 0,
        receivedToday: 0,
        supplierBalances: 0,
      }
    );
  }, [filteredPurchases]);
  const bottomKpiCards = [
    { label: t("purchases.kpis.totalPurchases"), value: purchaseKpis.totalPurchases.toLocaleString(), accent: "text-emerald-200" },
    { label: `${t("purchases.kpis.monthlySpend")} / ${t("purchases.kpis.totalSpent")}`, value: formatCurrency(purchaseKpis.totalSpend), accent: "text-primary" },
    { label: t("purchases.kpis.pendingOrders"), value: purchaseKpis.pendingOrders.toLocaleString(), accent: "text-amber-200" },
    { label: t("purchases.kpis.receivedToday"), value: purchaseKpis.receivedToday.toLocaleString(), accent: "text-lime-200" },
    { label: t("purchases.kpis.supplierBalances"), value: formatCurrency(purchaseKpis.supplierBalances), accent: "text-rose-100" },
  ];

  const supplierOptions = ["all", ...uniqueValues(purchases.map((purchase) => purchase.supplier_name))];
  const statusOptions = ["all", ...uniqueValues(purchases.map((purchase) => purchase.status))];
  const warehouseOptions = ["all", ...uniqueValues(purchases.map((purchase) => purchase.warehouse_name))];
  const branchOptions = ["all", ...branches.map((branch) => ({ value: branch.id, label: branch.name || branch.code || `Branch ${branch.id}` }))];
  const paymentOptions = ["all", ...uniqueValues(purchases.map((purchase) => purchase.payment_status))];
  const refreshPurchases = async () => {
    const response = await api.get("/purchases");
    const rows = Array.isArray(response?.purchases) ? response.purchases : Array.isArray(response?.data) ? response.data : [];
    setPurchases(rows.map(normalizePurchase));
  };
  const runPurchaseAction = async (action) => {
    try {
      await action();
    } catch (error) {
      toast.error(error.responseBody?.message || error.responseBody?.error || error.message || t("purchases.toasts.actionFailed"));
    }
  };
  const duplicatePurchase = async (purchase) => {
    await runPurchaseAction(async () => {
      const response = await api.post(`/purchases/${purchase.id}/duplicate`, {});
      await refreshPurchases();
      toast.success(t("purchases.toasts.duplicatedDraft"));
      const draftId = response?.purchase?.id || response?.data?.id;
      if (draftId) window.location.assign(`/purchases/${draftId}`);
    });
  };
  const receivePurchase = async (purchase) => {
    await runPurchaseAction(async () => {
      await api.post(`/purchases/${purchase.id}/receive`, {});
      await refreshPurchases();
      notifyProductsChanged("purchase-receive-price-sync");
      toast.success(t("purchases.toasts.stockReceived"));
    });
  };
  const cancelPurchase = async (purchase) => {
    const reason = window.prompt(t("purchases.confirm.cancelReason"), t("purchases.confirm.cancelReasonDefault"));
    if (reason === null) return;
    await runPurchaseAction(async () => {
      const response = await api.post(`/purchases/${purchase.id}/cancel`, { reason });
      await refreshPurchases();
      toast.success(response?.message || t("purchases.toasts.cancelled"));
    });
  };
  const removePurchase = async (purchase) => {
    const confirmed = window.confirm(t("purchases.confirm.deleteReverse"));
    if (!confirmed) return;
    await runPurchaseAction(async () => {
      const response = await api.delete(`/purchases/${purchase.id}`, { body: { reason: "Purchase deleted and stock reversed from dashboard" } });
      await refreshPurchases();
      toast.success(response?.message || t("purchases.toasts.deletedReversed"));
    });
  };
  const exportPurchase = (purchase) => {
    const printLanguage = normalizePrintLanguage(i18n.language);
    const printDir = getPrintDirection(printLanguage);
    const purchasePrintLabel = (key, fallback, options) => tPrint(`print.purchase.${key}`, fallback, options);
    const rows = (purchase.items || [])
      .map((item) => {
        const variant = [item.color, item.size, item.sku].filter(Boolean).join(" / ");
        const qty = Number(item.quantity || item.qty || 0);
        const cost = Number(item.cost_price ?? item.unit_cost ?? item.purchase_price ?? 0);
        const subtotal = Number(item.subtotal ?? qty * cost);
        return `<tr><td>${escapeHtml(item.product_name || item.name || purchasePrintLabel("item", "الصنف"))}</td><td>${escapeHtml(variant)}</td><td class="number">${qty}</td><td class="amount">${formatCurrency(cost)}</td><td class="amount">${formatCurrency(subtotal)}</td></tr>`;
      })
      .join("");
    const html = wrapPrintableHtml({
      title: purchase.invoice_number || purchasePrintLabel("purchaseInvoice", "فاتورة شراء"),
      language: printLanguage,
      body: `
        <main class="print-sheet" dir="${printDir}">
          <button onclick="window.print()">${escapeHtml(purchasePrintLabel("printSavePdf", "طباعة / حفظ PDF"))}</button>
          <header class="print-header">
            <div>
              <h1 class="print-title">${escapeHtml(purchasePrintLabel("purchaseInvoice", "فاتورة شراء"))}</h1>
              <div class="muted number">${escapeHtml(purchase.invoice_number)}</div>
            </div>
            <div>
              <strong>${escapeHtml(purchase.supplier_name)}</strong>
              <div class="muted">${escapeHtml(purchase.warehouse_name)}</div>
              <div class="muted number">${escapeHtml(formatDateTime(purchase.created_at))}</div>
            </div>
          </header>
          <section class="print-card">
            <table>
              <thead><tr><th>${escapeHtml(purchasePrintLabel("product", "الصنف"))}</th><th>${escapeHtml(purchasePrintLabel("variant", "المتغير"))}</th><th>${escapeHtml(purchasePrintLabel("quantity", "الكمية"))}</th><th>${escapeHtml(purchasePrintLabel("cost", "التكلفة"))}</th><th>${escapeHtml(purchasePrintLabel("subtotal", "الإجمالي الفرعي"))}</th></tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </section>
          <div class="total">${escapeHtml(purchasePrintLabel("total", "الإجمالي"))}: <span class="amount">${formatCurrency(purchase.total)}</span></div>
        </main>
      `,
    });
    if (!openPrintHtml(html)) {
      toast.error(purchasePrintLabel("allowPopups", "اسمح بالنوافذ المنبثقة لتصدير الفاتورة."));
    }
  };

  return (
    <FlowShell
      title={t("purchases.title")}
      subtitle={t("purchases.subtitle")}
      actions={
        <Link
          to="/purchases/create"
          className="inline-flex items-center gap-2 rounded-2xl bg-emerald-500 px-4 py-2 text-sm font-black text-black transition hover:bg-emerald-400"
        >
          <Plus className="h-4 w-4" />
          {t("purchases.actions.newPurchaseOrder")}
        </Link>
      }
      tabs={[
        { to: "/purchases", label: t("purchases.tabs.purchases"), end: true },
        { to: "/purchases/create", label: t("purchases.tabs.createPo") },
        { to: "/purchases/reorder-suggestions", label: t("purchases.tabs.smartReorder") },
        { to: "/suppliers", label: t("purchases.tabs.suppliers") },
        { to: "/inventory", label: t("purchases.tabs.inventory") },
        { to: "/warehouses", label: t("purchases.tabs.warehouses") },
      ]}
    >
      {error ? (
        <div className="rounded-3xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-100">
          <AlertTriangle className="mr-2 inline h-4 w-4" />
          {error}
        </div>
      ) : null}

      <div className="rounded-3xl border border-white/10 bg-zinc-950/90 p-3 shadow-2xl shadow-black/10 sm:p-4">
        <div className="rounded-2xl border border-white/10 bg-black/20 p-2.5">
          <div className="grid items-end gap-2 md:grid-cols-2 xl:grid-cols-12">
            <label className="block md:col-span-2 xl:col-span-4">
              <div className="mb-1.5 text-[10px] font-black uppercase tracking-[0.16em] text-emerald-300">{t("purchases.searchPlaceholder")}</div>
              <div className="relative">
                <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t("purchases.searchPlaceholder")}
                  className="h-[var(--control-height-md)] w-full rounded-xl border border-emerald-400/20 bg-zinc-950/80 py-2 pe-3 ps-9 text-sm font-semibold text-white outline-none transition placeholder:text-zinc-600 focus:border-emerald-400/50 focus:shadow-[0_0_0_3px_rgba(16,185,129,0.12)]"
                />
              </div>
            </label>
            <Select value={supplierFilter} onChange={setSupplierFilter} options={supplierOptions} label={t("purchases.filters.supplier")} allLabel={t("purchases.filters.all")} className="xl:col-span-2" />
            <Select value={statusFilter} onChange={setStatusFilter} options={statusOptions} label={t("purchases.filters.status")} allLabel={t("purchases.filters.all")} className="xl:col-span-1" />
            <Select value={warehouseFilter} onChange={setWarehouseFilter} options={warehouseOptions} label={t("purchases.filters.warehouse")} allLabel={t("purchases.filters.all")} className="xl:col-span-2" />
            <Select value={paymentFilter} onChange={setPaymentFilter} options={paymentOptions} label={t("purchases.filters.payment")} allLabel={t("purchases.filters.all")} className="xl:col-span-1" />
            <DateField label={t("purchases.filters.dateFrom")} value={dateFromFilter || dateFilter} onChange={(value) => { setDateFromFilter(value); setDateFilter(""); }} className="xl:col-span-1" />
            <DateField label={t("purchases.filters.dateTo")} value={dateToFilter} onChange={setDateToFilter} className="xl:col-span-1" />
            {branches.length > 1 ? <Select value={branchFilter} onChange={setBranchFilter} options={branchOptions} label={t("purchases.filters.branch")} allLabel={t("purchases.filters.all")} className="md:col-span-2 xl:col-span-2" /> : null}
          </div>
        </div>

        <div className="mt-3 overflow-x-auto">
          <div className="min-w-[1080px]">
            <div className={`sticky top-0 z-10 grid ${purchaseTableColumns} items-center gap-2 rounded-2xl border border-white/10 bg-zinc-950/90 px-3 py-2.5 text-[10px] font-black uppercase tracking-[0.16em] text-zinc-400 shadow-[0_12px_30px_rgba(0,0,0,0.22)] backdrop-blur-xl`}>
              <div></div>
              <div>{t("purchases.table.date")}</div>
              <div>{t("purchases.table.invoice")}</div>
              <div>{t("purchases.table.supplier")}</div>
              <div>{t("purchases.table.warehouse")}</div>
              <div>{t("purchases.table.payment")}</div>
              <div>{t("purchases.table.items")}</div>
              <div>{t("purchases.table.total")}</div>
            </div>

            <div className="mt-1.5 space-y-1.5">
              {loading ? (
                <TableSkeleton />
              ) : visiblePurchases.length === 0 ? (
                <div className="rounded-3xl border border-dashed border-white/10 bg-white/5 p-10 text-center">
                  <PackageSearch className="mx-auto h-12 w-12 text-zinc-500" />
                  <h3 className="m1-section-title mt-4 text-white">{t("purchases.empty.title")}</h3>
                  <p className="mt-2 text-sm text-zinc-400">{t("purchases.empty.description")}</p>
                </div>
              ) : (
                visiblePurchases.map((purchase) => {
                  const dateParts = formatPurchaseDateParts(purchase.created_at);
                  return (
                  <div
                    key={String(purchase.id)}
                    className={`group relative grid ${purchaseTableColumns} items-center gap-2 rounded-2xl border border-white/10 bg-zinc-950/88 px-3 py-2.5 shadow-[0_8px_24px_rgba(0,0,0,0.10)] transition duration-150 ease-out hover:-translate-y-0.5 hover:border-emerald-300/20 hover:bg-emerald-400/[0.035] hover:shadow-[0_12px_30px_rgba(16,185,129,0.08)]`}
                  >
                    <div className="absolute left-0 top-2 bottom-2 w-px rounded-full bg-emerald-300/20 opacity-60 transition group-hover:bg-emerald-300/45" />
                    <div className="relative flex justify-center">
                      <button
                        type="button"
                        onClick={(event) => openActionsMenu(purchase.id, event.currentTarget)}
                        className="inline-flex h-[var(--control-height-sm)] w-8 items-center justify-center rounded-lg border border-white/10 bg-white/[0.035] text-zinc-400 transition hover:border-white/20 hover:bg-white/[0.07] hover:text-white"
                        aria-label={t("purchases.actionsMenu.viewInvoice")}
                        aria-expanded={openMenuId === purchase.id}
                        aria-haspopup="menu"
                        data-purchase-actions-trigger="true"
                      >
                        <MoreHorizontal className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <div className="table-cell-stack min-w-0">
                      <div className="truncate text-[0.92rem] font-black leading-5 text-white">{dateParts.date}</div>
                      <div className="truncate text-[11px] font-semibold leading-4 text-zinc-500">{dateParts.time}</div>
                    </div>
                    <div className="table-cell-stack min-w-0">
                      <div className="truncate text-sm font-black text-emerald-50">{purchase.invoice_number}</div>
                      <div className="truncate text-xs text-zinc-500">#{purchase.id}</div>
                    </div>
                    <div className="table-cell-stack min-w-0">
                      <div className="truncate font-semibold text-white">{purchase.supplier_name}</div>
                      <div className="truncate text-xs text-zinc-500">{purchase.payment_status}</div>
                    </div>
                    <div className="min-w-0 truncate text-sm text-zinc-300">{purchase.warehouse_name}</div>
                    <PaymentStatusPill value={purchase.payment_status} />
                    <div className="text-center text-sm font-semibold tabular-nums text-zinc-300">{purchase.items?.length || purchase.item_count || 0}</div>
                    <div className="truncate text-right font-mono text-sm font-bold tabular-nums text-white">{formatCurrency(purchase.total)}</div>
                  </div>
                  );
                })
              )}
              <PurchaseActionsMenu
                purchase={visiblePurchases.find((purchase) => purchase.id === openMenuId)}
                position={menuPosition}
                zIndex={ACTIONS_MENU_Z_INDEX}
                onClose={closeActionsMenu}
                onReceive={receivePurchase}
                onDuplicate={duplicatePurchase}
                onExport={exportPurchase}
                onCancel={cancelPurchase}
                onRemove={removePurchase}
              />
            </div>
          </div>
        </div>

        <Pagination
          className="mt-4"
          page={currentPage}
          pages={totalPages}
          total={filteredPurchases.length}
          pageSize={pageSize}
          pageSizeOptions={PAGE_SIZE_OPTIONS}
          visible={visiblePurchases.length}
          onChange={setPage}
          onPageSizeChange={(value) => { setPageSize(value); setPage(1); }}
        />
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            {bottomKpiCards.map((card) => (
              <div
                key={card.label}
                className="rounded-2xl border border-white/10 bg-[linear-gradient(145deg,rgba(9,9,11,0.96),rgba(24,24,27,0.88))] p-3 shadow-[0_16px_40px_rgba(0,0,0,0.18)]"
              >
                <div className="truncate text-[10px] font-black uppercase tracking-[0.16em] text-zinc-500">{card.label}</div>
                <div className={`mt-2 truncate font-mono text-xl font-black tabular-nums ${card.accent}`}>{card.value}</div>
              </div>
            ))}
          </div>
        </div>
    </FlowShell>
  );
}

function PurchaseActionsMenu({
  purchase,
  position,
  zIndex,
  onClose,
  onReceive,
  onDuplicate,
  onExport,
  onCancel,
  onRemove,
}) {
  const { t } = useTranslation();
  const menuRef = useRef(null);
  const [resolvedPosition, setResolvedPosition] = useState(position);

  useEffect(() => {
    setResolvedPosition(position);
  }, [position]);

  useDismissableLayer({
    enabled: Boolean(purchase),
    refs: [menuRef],
    ignoreSelectors: ["[data-purchase-actions-trigger='true']"],
    onDismiss: onClose,
  });

  useEffect(() => {
    if (!purchase || !position || !menuRef.current || typeof window === "undefined") return;

    const rect = menuRef.current.getBoundingClientRect();
    const nextLeft = Math.min(
      Math.max(ACTIONS_MENU_MARGIN, position.left),
      Math.max(ACTIONS_MENU_MARGIN, window.innerWidth - rect.width - ACTIONS_MENU_MARGIN)
    );
    const nextTop = Math.min(
      Math.max(ACTIONS_MENU_MARGIN, position.top),
      Math.max(ACTIONS_MENU_MARGIN, window.innerHeight - rect.height - ACTIONS_MENU_MARGIN)
    );

    if (nextLeft !== position.left || nextTop !== position.top) {
      setResolvedPosition({ left: nextLeft, top: nextTop });
    }
  }, [position, purchase]);

  if (!purchase || !resolvedPosition || typeof document === "undefined") return null;

  const runAndClose = (action) => {
    onClose();
    action(purchase);
  };

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      className="fixed w-56 rounded-2xl border border-white/10 bg-zinc-950 p-2 shadow-2xl shadow-black/40"
      style={{
        left: `${resolvedPosition.left}px`,
        top: `${resolvedPosition.top}px`,
        zIndex,
      }}
    >
      <MenuItem to={`/purchases/${purchase.id}`} icon={<Eye className="h-4 w-4" />} label={t("purchases.actionsMenu.viewInvoice")} onClick={onClose} />
      <MenuItem to={`/purchases/${purchase.id}/edit`} icon={<Edit3 className="h-4 w-4" />} label={t("purchases.actionsMenu.editPurchase")} onClick={onClose} />
      <MenuButton icon={<Truck className="h-4 w-4" />} label={t("purchases.actionsMenu.receiveStock")} onClick={() => runAndClose(onReceive)} />
      <MenuButton icon={<Copy className="h-4 w-4" />} label={t("purchases.actionsMenu.duplicatePurchase")} onClick={() => runAndClose(onDuplicate)} />
      <MenuButton icon={<Download className="h-4 w-4" />} label={t("purchases.actionsMenu.exportPdf")} onClick={() => runAndClose(onExport)} />
      <MenuButton icon={<Ban className="h-4 w-4" />} label={t("purchases.actionsMenu.cancelPurchase")} onClick={() => runAndClose(onCancel)} />
      <MenuButton danger icon={<Trash2 className="h-4 w-4" />} label={t("purchases.actionsMenu.deleteReverseStock")} onClick={() => runAndClose(onRemove)} />
    </div>,
    document.body
  );
}

function Select({ value, onChange, options, label, allLabel = "All", className = "" }) {
  return (
    <label className={`block min-w-0 ${className}`}>
      <div className="mb-1.5 truncate text-[10px] font-black uppercase tracking-[0.16em] text-zinc-500">{label}</div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-[var(--control-height-md)] w-full rounded-xl border border-white/10 bg-white/5 px-3 text-sm font-semibold text-white outline-none transition focus:border-emerald-400/50 focus:shadow-[0_0_0_3px_rgba(16,185,129,0.12)]"
      >
        {options.map((option) => {
          const optionValue = typeof option === "object" ? option.value : option;
          const optionLabel = typeof option === "object" ? option.label : option === "all" ? allLabel : option;
          return (
          <option key={String(optionValue)} value={optionValue} className="bg-zinc-950 text-white">
            {optionLabel}
          </option>
        );
        })}
      </select>
    </label>
  );
}

function DateField({ label, value, onChange, className = "" }) {
  return (
    <label className={`block min-w-0 ${className}`}>
      <div className="mb-1.5 truncate text-[10px] font-black uppercase tracking-[0.16em] text-zinc-500">{label}</div>
      <input
        type="date"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-[var(--control-height-md)] w-full rounded-xl border border-white/10 bg-white/5 px-3 text-sm font-semibold text-white outline-none transition focus:border-emerald-400/50 focus:shadow-[0_0_0_3px_rgba(16,185,129,0.12)]"
      />
    </label>
  );
}

function PaymentStatusPill({ value }) {
  const { t } = useTranslation();
  const normalized = String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  const label = t(`purchases.statusLabels.${normalized}`, value || "Pending");
  const tone = normalized.includes("paid") && !normalized.includes("unpaid")
    ? "border-emerald-300/20 bg-emerald-300/[0.08] text-emerald-200"
    : normalized.includes("pending") || normalized.includes("partial")
      ? "border-amber-300/20 bg-amber-300/[0.08] text-amber-200"
      : normalized.includes("unpaid")
        ? "border-rose-200/15 bg-rose-300/[0.07] text-rose-100"
        : "border-zinc-300/15 bg-zinc-300/[0.07] text-zinc-300";

  return (
    <span className={`inline-flex h-7 w-fit max-w-full items-center justify-center rounded-full border px-2.5 text-[11px] font-black leading-none ${tone}`}>
      <span className="truncate">{label}</span>
    </span>
  );
}

function MenuItem({ to, icon, label, onClick }) {
  return (
    <Link to={to} onClick={onClick} className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-zinc-200 hover:bg-white/5">
      {icon}
      {label}
    </Link>
  );
}

function MenuButton({ icon, label, onClick, danger = false, disabled = false, title }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-45 ${danger ? "text-rose-300" : "text-zinc-200"}`}
    >
      {icon}
      {label}
    </button>
  );
}

function TableSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 6 }).map((_, index) => (
        <div key={index} className="h-16 animate-pulse rounded-2xl border border-white/10 bg-white/5" />
      ))}
    </div>
  );
}

export default PurchasesDashboard;
