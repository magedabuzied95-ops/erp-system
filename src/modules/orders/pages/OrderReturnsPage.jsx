import { todayInAppTimezone } from "../../../shared/lib/appTimezone";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

import i18n from "../../../i18n/i18n";

import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  Eye,
  FileText,
  PackageOpen,
  Pencil,
  Plus,
  RefreshCcw,
  Search,
  Trash2,
  Wallet,
  X,
} from "lucide-react";
import toast from "react-hot-toast";

import { api } from "../../../shared/api/api";
import { fetchAllOrders } from "../../../shared/api/ordersFetch";
import { isCashierUser } from "../../../shared/auth/authStorage";
import OrdersShell from "../components/OrdersShell";
import StatusBadge from "../components/StatusBadge";
import {
  addReturnRecord,
  deleteReturnRecord,
  formatCurrency,
  formatDateTime,
  getReturns,
  isReturnedOrRefundedOrder,
  mockOrders,
  normalizeOrder,
  updateReturnRecord,
} from "../lib/ordersStore";

const tt = (key, options) => i18n.t(key, options);

const RETURN_STATUS_OPTIONS = ["Draft", "Submitted", "Approved", "Rejected", "Returned", "Refunded"];
const REFUND_STATUS_OPTIONS = ["pending", "processing", "refunded", "partial_refund", "rejected"];
const REFUND_METHOD_OPTIONS = ["cash", "vodafone_cash", "instapay"];
const RETURN_DISPOSITION_OPTIONS = [
  { value: "restock", get label() { return tt("orders.returns.page.disposition.restock"); } },
  { value: "manufacturing_defect", get label() { return tt("orders.returns.page.disposition.manufacturingDefect"); } },
  { value: "damaged", get label() { return tt("orders.returns.page.disposition.damaged"); } },
];

const text = (value = "") => String(value ?? "").trim();
const lower = (value = "") => text(value).toLowerCase();

const resolveOrderItemUnitPrice = (item = {}) => {
  const candidates = [
    item.unit_price,
    item.unitPrice,
    item.price,
    item.sale_price,
    item.salePrice,
    item.selling_price,
    item.sellingPrice,
    item.product_price,
    item.productPrice,
    item.variant_price,
    item.variantPrice,
    item.line_unit_price,
    item.lineUnitPrice,
  ];
  const numbers = candidates
    .filter((value) => value !== null && value !== undefined && value !== "")
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
  return numbers.find((value) => value > 0) ?? numbers[0] ?? 0;
};

const getOrderPhone = (order = {}) => text(order.customer_phone || order.phone || order.customer?.phone || "");
const getOrderCode = (order = {}) => text(order.invoice_number || order.public_order_number || order.display_order_number || `#${order.id}`);
const getDateInputValue = () => todayInAppTimezone();
const normalizeRefundMethod = (value = "cash") => {
  const key = lower(value);
  if (["cash", "vodafone_cash", "instapay"].includes(key)) return key;
  if (["same_payment_method", "original", "wallet", "bank_transfer", "card"].includes(key)) return "cash";
  return "cash";
};
const isManufacturingDefectText = (value = "") => {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي");
  return /عيب\s*(?:صناع[هي]?|تصنيع)/.test(normalized)
    || /(?:manufacturing|factory)\s*defect/.test(normalized);
};
const stockDispositionLabel = (record = {}) => {
  if (record.disposition === "manufacturing_defect") return tt("orders.returns.page.stock.reservedForSupplier");
  if (record.disposition === "damaged") return tt("orders.returns.page.stock.damagedNotReturned");
  return tt(record.restock ? "orders.returns.page.stock.restocked" : "orders.returns.page.stock.notRestocked");
};

const defaultFormState = {
  selectedOrderId: "",
  reason: "",
  restock: true,
  disposition: "restock",
  returnItems: {},
  refundAmount: 0,
  status: "Draft",
  shippingProvider: "",
  trackingNumber: "",
  refundMethod: "cash",
  refundStatus: "pending",
  originalCreatedAt: "",
};

function OrderReturnsPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const canViewPurchaseCost = !isCashierUser();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [returnStatusFilter, setReturnStatusFilter] = useState("all");
  const [refundStatusFilter, setRefundStatusFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState("");
  const [drawerMode, setDrawerMode] = useState("create");
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingReturnId, setEditingReturnId] = useState(null);
  const [form, setForm] = useState(defaultFormState);
  const [selectedReturn, setSelectedReturn] = useState(null);
  const [activePanel, setActivePanel] = useState("customers");
  const [supplierReturnItems, setSupplierReturnItems] = useState([]);
  const [supplierSearch, setSupplierSearch] = useState("");
  const [supplierStatusFilter, setSupplierStatusFilter] = useState("all");
  const [supplierIdFilter, setSupplierIdFilter] = useState("all");
  const [supplierDateFrom, setSupplierDateFrom] = useState("");
  const [supplierDateTo, setSupplierDateTo] = useState("");

  useEffect(() => {
    let active = true;

    const loadOrders = async () => {
      try {
        setLoading(true);
        setError("");
        const [data, supplierQueue] = await Promise.all([
          fetchAllOrders(),
          api.get("/orders/supplier-returns?status=all").catch(() => ({ items: [] })),
        ]);
        const baseOrders = Array.isArray(data?.orders) ? data.orders : [];
        const normalized = baseOrders.length ? baseOrders.map((order) => normalizeOrder(order, { items: order.items || [] })) : mockOrders();
        if (!active) return;
        setOrders(normalized);
        setSupplierReturnItems(Array.isArray(supplierQueue?.items) ? supplierQueue.items : []);
      } catch (err) {
        console.log(err);
        const fallback = mockOrders();
        if (!active) return;
        setOrders(fallback);
        setError(t("orders.returns.workflowFallback"));
        toast.error(t("orders.returns.usingFallback"));
      } finally {
        if (active) setLoading(false);
      }
    };

    loadOrders();
    return () => {
      active = false;
    };
  }, [t]);

  const orderMap = useMemo(
    () => new Map(orders.map((order) => [String(order.id), order])),
    [orders]
  );

  const selectedOrder = useMemo(
    () => orderMap.get(String(form.selectedOrderId)) || null,
    [form.selectedOrderId, orderMap]
  );

  useEffect(() => {
    const items = Array.isArray(selectedOrder?.items) ? selectedOrder.items : [];
    const total = items.reduce((sum, item) => {
      const selectedItem = form.returnItems[item.id];
      const quantity = Number(selectedItem?.quantity || 0);
      if (quantity <= 0) return sum;
      return sum + quantity * resolveOrderItemUnitPrice(item);
    }, 0);
    setForm((current) => (current.refundAmount === total ? current : { ...current, refundAmount: total }));
  }, [form.returnItems, selectedOrder]);

  const returnsData = useMemo(() => {
    const localReturns = getReturns().map((record) => normalizeReturnRecord(record, orderMap));
    const orderReturns = orders
      .filter(isReturnedOrRefundedOrder)
      .map((order) => normalizeOrderReturn(order))
      .filter((record) => !localReturns.some((localRecord) => String(localRecord.orderId) === String(record.orderId) && text(localRecord.createdAt) === text(record.createdAt)));

    return [...localReturns, ...orderReturns].sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
    // language is a dependency: the normalizers bake RESOLVED label strings
    // (returnStatusLabel, refundMethodLabel, timeline) into every record.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderMap, orders, i18n.language]);

  const filteredReturns = useMemo(() => {
    const query = lower(search);
    return returnsData.filter((record) => {
      const matchesSearch = !query || [
        record.returnNumber,
        record.orderNumber,
        record.customerName,
        record.customerPhone,
        record.trackingNumber,
        record.itemsSummary,
      ].some((value) => lower(value).includes(query));

      const matchesReturnStatus = returnStatusFilter === "all" || lower(record.returnStatus) === lower(returnStatusFilter);
      const matchesRefundStatus = refundStatusFilter === "all" || lower(record.refundStatus) === lower(refundStatusFilter);
      const matchesDate = !dateFilter || text(record.createdAt).slice(0, 10) === dateFilter;

      return matchesSearch && matchesReturnStatus && matchesRefundStatus && matchesDate;
    });
  }, [dateFilter, refundStatusFilter, returnStatusFilter, returnsData, search]);

  const kpis = useMemo(() => {
    const today = getDateInputValue();
    return {
      total: returnsData.length,
      today: returnsData.filter((record) => text(record.createdAt).slice(0, 10) === today).length,
      value: returnsData.reduce((sum, record) => sum + Number(record.refundAmount || 0), 0),
      restocked: returnsData.filter((record) => record.restock).length,
    };
  }, [returnsData]);

  const supplierOptions = useMemo(() => {
    const unique = new Map();
    supplierReturnItems.forEach((item) => {
      unique.set(String(item.supplier_id || "unassigned"), item.supplier_name || tt("orders.returns.page.unknownSupplier"));
    });
    return [...unique.entries()].map(([value, label]) => ({ value, label }));
  }, [supplierReturnItems]);

  const filteredSupplierReturns = useMemo(() => {
    const query = lower(supplierSearch);
    return supplierReturnItems.filter((item) => {
      const matchesSearch = !query || [
        item.supplier_name,
        item.product_name,
        item.return_number,
        item.invoice_number,
        item.purchase_number,
        item.reason,
      ].some((value) => lower(value).includes(query));
      const matchesSupplier = supplierIdFilter === "all" || String(item.supplier_id || "unassigned") === supplierIdFilter;
      const matchesStatus = supplierStatusFilter === "all" || lower(item.status) === supplierStatusFilter;
      const itemDate = text(item.created_at).slice(0, 10);
      const matchesFrom = !supplierDateFrom || itemDate >= supplierDateFrom;
      const matchesTo = !supplierDateTo || itemDate <= supplierDateTo;
      return matchesSearch && matchesSupplier && matchesStatus && matchesFrom && matchesTo;
    });
  }, [supplierDateFrom, supplierDateTo, supplierIdFilter, supplierReturnItems, supplierSearch, supplierStatusFilter]);

  const openCreateDrawer = () => {
    const firstOrder = orders[0];
    setDrawerMode("create");
    setEditingReturnId(null);
    setForm({
      ...defaultFormState,
      selectedOrderId: String(firstOrder?.id || ""),
    });
    setIsFormOpen(true);
  };

  const openEditDrawer = (record) => {
    if (!record?.allowEdit) {
      toast.error(t("orders.returns.page.toastLocalOnly"));
      return;
    }

    setDrawerMode("edit");
    setEditingReturnId(record.id);
    setForm({
      selectedOrderId: String(record.orderId || ""),
      reason: record.reason || "",
      restock: Boolean(record.restock),
      disposition: record.disposition || (record.restock ? "restock" : "damaged"),
      returnItems: buildFormReturnItems(record),
      refundAmount: Number(record.refundAmount || 0),
      status: record.returnStatus || "Draft",
      shippingProvider: record.shippingProvider || "",
      trackingNumber: record.trackingNumber || "",
      refundMethod: normalizeRefundMethod(record.refundMethod || record.refund_method || "cash"),
      refundStatus: record.refundStatus || "pending",
      originalCreatedAt: record.createdAt || "",
    });
    setIsFormOpen(true);
  };

  const closeFormDrawer = () => {
    setIsFormOpen(false);
    setEditingReturnId(null);
    setDrawerMode("create");
  };

  const submitReturn = async () => {
    if (!selectedOrder) {
      toast.error(t("orders.returns.selectOrder"));
      return;
    }

    const items = Object.values(form.returnItems)
      .filter((item) => Number(item.quantity || 0) > 0)
      .map((item) => ({
        orderItemId: item.item.id,
        variantId: item.item.variant_id || item.item.variantId || null,
        quantity: Number(item.quantity || 0),
        reason: item.reason || "",
        refund_amount: Number(item.quantity || 0) * resolveOrderItemUnitPrice(item.item),
      }));

    if (!items.length) {
      toast.error(t("orders.returns.page.toastPickItem"));
      return;
    }

    const payload = {
      orderId: selectedOrder.id,
      orderNumber: selectedOrder.invoice_number,
      reason: form.reason,
      restock: form.restock,
      disposition: form.disposition,
      refundAmount: form.refundAmount,
      status: form.status,
      shippingProvider: form.shippingProvider,
      trackingNumber: form.trackingNumber,
      refundMethod: form.refundMethod,
      refundStatus: form.refundStatus,
      customerName: selectedOrder.customer_name,
      customerPhone: getOrderPhone(selectedOrder),
      items,
      createdAt: drawerMode === "edit" ? form.originalCreatedAt || new Date().toISOString() : new Date().toISOString(),
    };

    if (drawerMode === "edit" && editingReturnId) {
      const updatedRecord = updateReturnRecord(editingReturnId, payload);
      if (selectedReturn?.id === editingReturnId && updatedRecord) {
        setSelectedReturn(normalizeReturnRecord(updatedRecord, orderMap));
      }
      toast.success(t("orders.returns.page.toastUpdated"));
      closeFormDrawer();
      return;
    }

    try {
      await api.post("/orders/returns", payload);
      addReturnRecord(payload);
      if (form.disposition === "manufacturing_defect") {
        const supplierQueue = await api.get("/orders/supplier-returns?status=all").catch(() => ({ items: [] }));
        setSupplierReturnItems(Array.isArray(supplierQueue?.items) ? supplierQueue.items : []);
      }
      toast.success(t("orders.returns.saved"));
    } catch (err) {
      console.log(err);
      toast.error(t("orders.returns.backendUnavailable"));
    } finally {
      closeFormDrawer();
    }
  };

  const handleDelete = (record) => {
    if (!record?.allowDelete) {
      toast.error(t("orders.returns.page.toastDeleteUnavailable"));
      return;
    }
    if (!window.confirm(t("orders.returns.page.confirmDelete", { number: record.returnNumber }))) return;
    deleteReturnRecord(record.id);
    if (selectedReturn?.id === record.id) setSelectedReturn(null);
    toast.success(t("orders.returns.page.toastDeleted"));
  };

  const markSupplierReturnCompleted = async (itemId) => {
    try {
      await api.patch(`/orders/supplier-returns/${itemId}/status`, { status: "returned" });
      const supplierQueue = await api.get("/orders/supplier-returns?status=all");
      setSupplierReturnItems(Array.isArray(supplierQueue?.items) ? supplierQueue.items : []);
      toast.success(t("orders.returns.page.toastSupplierDelivered"));
    } catch (err) {
      console.log(err);
      toast.error(t("orders.returns.page.toastSupplierDeliveryFailed"));
    }
  };

  const isArabic = i18n.language?.toLowerCase().startsWith("ar");
  const tableDir = isArabic ? "rtl" : "ltr";

  return (
    <OrdersShell
      header={
        <PageHeader onCreate={openCreateDrawer} />
      }
    >
      {error ? (
        <div className="rounded-3xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-700 dark:text-amber-200">
          <AlertTriangle className="mr-2 inline h-4 w-4" />
          {error}
        </div>
      ) : null}

      <ReturnsPanelTabs activePanel={activePanel} onChange={setActivePanel} customerCount={returnsData.length} supplierCount={supplierReturnItems.length} />

      {activePanel === "customers" ? (
        <>
          <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <KpiCard label={t("orders.returns.page.kpi.total")} value={kpis.total} icon={RefreshCcw} accent="cyan" />
            <KpiCard label={t("orders.returns.page.kpi.today")} value={kpis.today} icon={CalendarDays} accent="amber" />
            <KpiCard label={t("orders.returns.page.kpi.refundValue")} value={formatCurrency(kpis.value)} icon={Wallet} accent="emerald" />
            <KpiCard label={t("orders.returns.page.kpi.restocked")} value={kpis.restocked} icon={PackageOpen} accent="violet" />
          </section>

          <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3 shadow-2xl shadow-[var(--shadow)]">
            <div className="mb-3 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <h2 className="m1-section-title text-[var(--text)]">{t("orders.returns.customerReturns")}</h2>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <MiniStat label={t("orders.returns.page.results")} value={filteredReturns.length} />
                <button type="button" onClick={() => setDateFilter(dateFilter === getDateInputValue() ? "" : getDateInputValue())} className={`rounded-[var(--radius-control)] border px-3 py-2 text-xs font-bold transition ${dateFilter === getDateInputValue() ? "border-primary/40 bg-primary/10 text-primary" : "border-[var(--border)] bg-[var(--card)] text-[var(--text)] hover:bg-[var(--surface)]"}`}>{t("orders.returns.page.today")}</button>
              </div>
            </div>
            <ReturnsFilters search={search} setSearch={setSearch} returnStatusFilter={returnStatusFilter} setReturnStatusFilter={setReturnStatusFilter} refundStatusFilter={refundStatusFilter} setRefundStatusFilter={setRefundStatusFilter} dateFilter={dateFilter} setDateFilter={setDateFilter} />
            <ReturnsTable dir={tableDir} loading={loading} records={filteredReturns} onView={setSelectedReturn} onEdit={openEditDrawer} onDelete={handleDelete} />
          </section>
        </>
      ) : (
        <SupplierReturnsPanel
          items={filteredSupplierReturns}
          allItems={supplierReturnItems}
          supplierOptions={supplierOptions}
          search={supplierSearch}
          setSearch={setSupplierSearch}
          statusFilter={supplierStatusFilter}
          setStatusFilter={setSupplierStatusFilter}
          supplierFilter={supplierIdFilter}
          setSupplierFilter={setSupplierIdFilter}
          dateFrom={supplierDateFrom}
          setDateFrom={setSupplierDateFrom}
          dateTo={supplierDateTo}
          setDateTo={setSupplierDateTo}
          onMarkReturned={markSupplierReturnCompleted}
          showPurchaseCost={canViewPurchaseCost}
        />
      )}

      {isFormOpen ? (
        <ReturnFormDrawer
          t={t}
          mode={drawerMode}
          form={form}
          setForm={setForm}
          orders={orders}
          selectedOrder={selectedOrder}
          onClose={closeFormDrawer}
          onSubmit={submitReturn}
        />
      ) : null}

      {selectedReturn ? (
        <ReturnDetailsDrawer
          record={selectedReturn}
          onClose={() => setSelectedReturn(null)}
          onEdit={() => openEditDrawer(selectedReturn)}
          onDelete={() => handleDelete(selectedReturn)}
          navigate={navigate}
        />
      ) : null}
    </OrdersShell>
  );
}

function PageHeader({ onCreate }) {
  const { t } = useTranslation();
  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-2xl shadow-[var(--shadow)]">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--primary)]">{t("orders.moduleEyebrow")}</div>
          <h1 className="m1-page-title mt-2 text-[var(--text)]">{t("orders.returns.page.pageTitle")}</h1>
          <p className="mt-1 max-w-3xl text-sm text-[var(--muted)]">{t("orders.returns.page.pageSubtitle")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            to="/orders"
            className="inline-flex items-center gap-2 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] px-4 py-2 text-sm font-semibold text-[var(--text)] transition hover:bg-[var(--surface)]"
          >
            <ArrowRight className="h-4 w-4" />
            {t("orders.returns.page.backToOrders")}
          </Link>
          <button
            type="button"
            onClick={onCreate}
            className="inline-flex items-center gap-2 rounded-[var(--radius-control)] bg-[var(--primary)] px-4 py-2 text-sm font-black text-[var(--primary-contrast)] transition hover:brightness-110"
          >
            <Plus className="h-4 w-4" />
            {t("orders.returns.page.createReturn")}
          </button>
        </div>
      </div>
    </div>
  );
}

function KpiCard({ label, value, icon: Icon, accent }) {
  const accents = {
    cyan: "from-primary/20 to-primary/5 text-primary",
    amber: "from-amber-400/20 to-amber-400/5 text-amber-700 dark:text-amber-200",
    emerald: "from-emerald-400/20 to-emerald-400/5 text-emerald-700 dark:text-emerald-200",
    violet: "from-violet-400/20 to-violet-400/5 text-violet-700 dark:text-violet-200",
  };

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-xl shadow-[var(--shadow)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-bold text-[var(--muted)]">{label}</div>
          <div className="mt-2 text-2xl font-black text-[var(--text)]">{value}</div>
        </div>
        <div className={`rounded-2xl border border-[var(--border)] bg-gradient-to-br p-3 ${accents[accent] || accents.cyan}`}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  );
}

function ReturnsPanelTabs({ activePanel, onChange, customerCount, supplierCount }) {
  const { t } = useTranslation();
  const tabs = [
    { value: "customers", label: t("orders.returns.customerReturns"), count: customerCount, tone: "cyan" },
    { value: "suppliers", label: t("orders.returns.supplierReturns"), count: supplierCount, tone: "amber" },
  ];
  return (
    <div className="grid gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-2 md:grid-cols-2">
      {tabs.map((tab) => {
        const active = activePanel === tab.value;
        const activeClass = tab.tone === "amber"
          ? "border-amber-500/40 bg-amber-500/12 text-amber-700 dark:text-amber-200"
          : "border-primary/35 bg-primary/12 text-primary";
        return (
          <button key={tab.value} type="button" onClick={() => onChange(tab.value)} className={`flex items-center justify-between rounded-[var(--radius-control)] border px-4 py-3 text-sm font-black transition ${active ? activeClass : "border-transparent bg-[var(--card)] text-[var(--muted)] hover:border-[var(--border)] hover:bg-[var(--surface)] hover:text-[var(--text)]"}`}>
            <span>{tab.label}</span>
            <span className="rounded-full border border-current/20 bg-[var(--surface)] px-2 py-0.5 text-xs">{tab.count}</span>
          </button>
        );
      })}
    </div>
  );
}

function SupplierReturnsPanel({
  items,
  allItems,
  supplierOptions,
  search,
  setSearch,
  statusFilter,
  setStatusFilter,
  supplierFilter,
  setSupplierFilter,
  dateFrom,
  setDateFrom,
  dateTo,
  setDateTo,
  onMarkReturned,
  showPurchaseCost = true,
}) {
  const { t } = useTranslation();
  const groups = useMemo(() => {
    const map = new Map();
    items.forEach((item) => {
      const key = String(item.supplier_id || "unassigned");
      const group = map.get(key) || { supplierId: item.supplier_id || null, supplierName: item.supplier_name || tt("orders.returns.page.unknownSupplier"), totalQuantity: 0, totalPurchaseCost: 0, items: [] };
      group.totalQuantity += Number(item.quantity || 0);
      group.totalPurchaseCost += Number(item.purchase_total_cost || 0);
      group.items.push(item);
      map.set(key, group);
    });
    return [...map.values()];
  }, [items]);

  const summary = useMemo(() => ({
    quantity: items.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
    purchaseCost: items.reduce((sum, item) => sum + Number(item.purchase_total_cost || 0), 0),
    pending: items.filter((item) => lower(item.status) === "pending").reduce((sum, item) => sum + Number(item.quantity || 0), 0),
    suppliers: new Set(items.map((item) => String(item.supplier_id || "unassigned"))).size,
  }), [items]);

  const resetFilters = () => {
    setSearch("");
    setStatusFilter("all");
    setSupplierFilter("all");
    setDateFrom("");
    setDateTo("");
  };

  return (
    <>
      <section className={`grid gap-3 md:grid-cols-2 ${showPurchaseCost ? "xl:grid-cols-4" : "xl:grid-cols-3"}`}>
        <KpiCard label={t("orders.returns.page.supplierKpi.items")} value={summary.quantity} icon={PackageOpen} accent="amber" />
        {showPurchaseCost ? <KpiCard label={t("orders.returns.page.supplierKpi.purchaseCost")} value={formatCurrency(summary.purchaseCost)} icon={Wallet} accent="emerald" /> : null}
        <KpiCard label={t("orders.returns.page.supplierKpi.pendingDelivery")} value={summary.pending} icon={RefreshCcw} accent="cyan" />
        <KpiCard label={t("orders.returns.page.supplierKpi.suppliers")} value={summary.suppliers} icon={FileText} accent="violet" />
      </section>

      <section className="rounded-2xl border border-amber-400/30 bg-[var(--surface)] p-3 shadow-2xl shadow-[var(--shadow)]">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="m1-section-title text-[var(--text)]">{t("orders.returns.supplierReturns")}</h2>
            <p className="mt-1 text-xs text-[var(--muted)]">{t("orders.returns.page.currentResults", { shown: items.length, total: allItems.length })}</p>
          </div>
          <button type="button" onClick={resetFilters} className="rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-xs font-bold text-[var(--text)] hover:bg-[var(--surface)]">{t("orders.returns.page.clearFilters")}</button>
        </div>

        <div className="grid gap-3 xl:grid-cols-[minmax(18rem,2fr)_repeat(4,minmax(10rem,1fr))]">
          <label className="block">
            <div className="mb-1.5 text-[11px] font-bold text-[var(--muted)]">{t("orders.returns.page.search")}</div>
            <div className="relative">
              <Search className="pointer-events-none absolute start-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted)]" />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("orders.returns.page.supplierSearchPlaceholder")} className="w-full rounded-[var(--radius-control)] border border-amber-400/30 bg-[var(--card)] py-2.5 pe-3 ps-10 text-sm text-[var(--text)] outline-none placeholder:text-[var(--muted)]" />
            </div>
          </label>
          <label className="block">
            <div className="mb-1.5 text-[11px] font-bold text-[var(--muted)]">{t("orders.returns.page.supplier")}</div>
            <select value={supplierFilter} onChange={(event) => setSupplierFilter(event.target.value)} className="w-full rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--card)] px-3 py-2.5 text-sm text-[var(--text)] outline-none">
              <option value="all">{t("orders.returns.page.allSuppliers")}</option>
              {supplierOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <FilterSelect label={t("orders.returns.page.status")} value={statusFilter} onChange={setStatusFilter} options={["pending", "returned", "cancelled"]} allLabel={t("orders.returns.page.allStatuses")} />
          <label className="block"><div className="mb-1.5 text-[11px] font-bold text-[var(--muted)]">{t("orders.returns.page.dateFrom")}</div><input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} className="w-full rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--card)] px-3 py-2.5 text-sm text-[var(--text)] outline-none" /></label>
          <label className="block"><div className="mb-1.5 text-[11px] font-bold text-[var(--muted)]">{t("orders.returns.page.dateTo")}</div><input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} className="w-full rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--card)] px-3 py-2.5 text-sm text-[var(--text)] outline-none" /></label>
        </div>

        {items.length ? (
          <>
            <div className="mt-3 hidden overflow-auto xl:block">
              <div className="min-w-[1180px]">
                <div className={`grid ${showPurchaseCost ? "grid-cols-[9rem_13rem_minmax(14rem,1fr)_6rem_9rem_10rem_11rem_9rem_10rem]" : "grid-cols-[9rem_13rem_minmax(14rem,1fr)_6rem_11rem_9rem_10rem]"} rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-center text-[10px] font-bold text-[var(--muted)]`}>
                  <div>{t("orders.returns.page.col.action")}</div><div>{t("orders.returns.page.col.supplier")}</div><div>{t("orders.returns.page.col.product")}</div><div>{t("orders.returns.page.col.quantity")}</div>{showPurchaseCost ? <><div>{t("orders.returns.page.col.purchasePrice")}</div><div>{t("orders.returns.page.col.total")}</div></> : null}<div>{t("orders.returns.page.col.reference")}</div><div>{t("orders.returns.page.col.status")}</div><div>{t("orders.returns.page.col.date")}</div>
                </div>
                <div className="mt-1.5 space-y-1.5">
                  {items.map((item) => (
                    <div key={item.id} className={`grid ${showPurchaseCost ? "grid-cols-[9rem_13rem_minmax(14rem,1fr)_6rem_9rem_10rem_11rem_9rem_10rem]" : "grid-cols-[9rem_13rem_minmax(14rem,1fr)_6rem_11rem_9rem_10rem]"} items-center rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-center text-xs text-[var(--text)]`}>
                      <div>{lower(item.status) === "pending" ? <button type="button" onClick={() => onMarkReturned(item.id)} className="rounded-[var(--radius-control)] border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 font-bold text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-200">{t("orders.returns.page.markDelivered")}</button> : <span className="text-[var(--muted)]">—</span>}</div>
                      <div className="truncate font-bold text-[var(--text)]">{item.supplier_name}</div>
                      <div><div className="font-bold text-[var(--text)]">{item.product_name}</div><div className="text-[10px] text-[var(--muted)]">{[item.color, item.size].filter(Boolean).join(" / ")}</div></div>
                      <div className="font-black">{item.quantity}</div>
                      {showPurchaseCost ? <><div>{formatCurrency(item.purchase_unit_cost)}</div><div className="font-black text-amber-700 dark:text-amber-200">{formatCurrency(item.purchase_total_cost)}</div></> : null}
                      <div><div>{item.return_number}</div><div className="text-[10px] text-[var(--muted)]">{item.purchase_number || item.invoice_number}</div></div>
                      <SupplierReturnStatus status={item.status} />
                      <div>{formatShortDate(item.created_at)}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="mt-3 xl:hidden"><SupplierReturnQueue groups={groups} onMarkReturned={onMarkReturned} showPurchaseCost={showPurchaseCost} /></div>
          </>
        ) : (
          <div className="mt-3 rounded-2xl border border-dashed border-[var(--border)] p-10 text-center text-[var(--muted)]">{t("orders.returns.page.noSupplierReturns")}</div>
        )}
      </section>
    </>
  );
}

function SupplierReturnStatus({ status }) {
  const { t } = useTranslation();
  const key = lower(status);
  const label = t(key === "returned" ? "orders.returns.page.supplierStatus.returned" : key === "cancelled" ? "orders.returns.page.supplierStatus.cancelled" : "orders.returns.page.supplierStatus.pending");
  const tone = key === "returned" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200" : key === "cancelled" ? "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-200" : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-200";
  return <div><span className={`inline-flex rounded-full border px-2 py-1 text-[11px] font-bold ${tone}`}>{label}</span></div>;
}

function SupplierReturnQueue({ groups, onMarkReturned, showPurchaseCost = true }) {
  const { t } = useTranslation();
  return (
    <section className="rounded-2xl border border-amber-400/20 bg-amber-400/5 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-[10px] font-black uppercase tracking-[0.18em] text-amber-700 dark:text-amber-300">{t("orders.returns.supplierReturns")}</div>
          <h2 className="m1-section-title mt-1 text-[var(--text)]">{t("orders.returns.page.defectQueueTitle")}</h2>
        </div>
        <MiniStat label={t("orders.returns.page.totalItems")} value={groups.reduce((sum, group) => sum + Number(group.totalQuantity || 0), 0)} />
      </div>
      <div className="mt-3 grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
        {groups.map((group) => (
          <div key={String(group.supplierId || "unassigned")} className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="font-black text-[var(--text)]">{group.supplierName}</div>
              <div className="text-end"><span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-xs font-bold text-amber-700 dark:text-amber-200">{t("orders.returns.page.pieces", { count: group.totalQuantity })}</span>{showPurchaseCost ? <div className="mt-1 text-[10px] font-bold text-[var(--muted)]">{formatCurrency(group.totalPurchaseCost)}</div> : null}</div>
            </div>
            <div className="mt-2 space-y-1.5">
              {group.items.slice(0, 4).map((item) => (
                <div key={item.id} className="flex items-center justify-between gap-2 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-2 text-xs text-[var(--text)]">
                  <div className="min-w-0">
                    <div className="truncate">{item.product_name}{[item.color, item.size].filter(Boolean).length ? ` — ${[item.color, item.size].filter(Boolean).join(" / ")}` : ""}</div>
                    <div className="mt-1 text-[10px] text-[var(--muted)]">{item.return_number || item.invoice_number || ""} · × {item.quantity}</div>
                  </div>
                  {lower(item.status) === "pending" ? (
                    <button type="button" onClick={() => onMarkReturned(item.id)} className="shrink-0 rounded-[var(--radius-control)] border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 font-bold text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-200">{t("orders.returns.page.markDeliveredToSupplier")}</button>
                  ) : <SupplierReturnStatus status={item.status} />}
                </div>
              ))}
              {group.items.length > 4 ? <div className="text-[11px] text-[var(--muted)]">{t("orders.returns.page.moreItems", { count: group.items.length - 4 })}</div> : null}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function MiniStat({ label, value }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-xs font-bold text-[var(--muted)]">
      {label}: <span className="text-[var(--text)]">{value}</span>
    </div>
  );
}

function ReturnsFilters(props) {
  const { t } = useTranslation();
  const {
    search,
    setSearch,
    returnStatusFilter,
    setReturnStatusFilter,
    refundStatusFilter,
    setRefundStatusFilter,
    dateFilter,
    setDateFilter,
  } = props;

  return (
    <>
      <div className="grid gap-3 xl:grid-cols-[minmax(20rem,2.4fr)_repeat(3,minmax(10rem,1fr))]">
        <label className="block">
          <div className="mb-1.5 text-[11px] font-bold text-[var(--muted)]">{t("orders.returns.page.search")}</div>
          <div className="relative">
            <Search className="pointer-events-none absolute start-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted)]" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t("orders.returns.page.searchPlaceholder")}
              className="w-full rounded-[var(--radius-control)] border border-primary/20 bg-[var(--card)] py-2.5 pe-3 ps-10 text-sm font-medium text-[var(--text)] outline-none shadow-[0_0_24px_rgba(34,211,238,0.05)] placeholder:text-[var(--muted)] focus:border-primary/40"
            />
          </div>
        </label>

        <FilterSelect label={t("orders.returns.page.returnStatusFilter")} value={returnStatusFilter} onChange={setReturnStatusFilter} options={RETURN_STATUS_OPTIONS} allLabel={t("orders.returns.page.allStatuses")} />
        <FilterSelect label={t("orders.returns.page.refundStatusFilter")} value={refundStatusFilter} onChange={setRefundStatusFilter} options={REFUND_STATUS_OPTIONS} allLabel={t("orders.returns.page.allStatuses")} />

        <label className="block">
          <div className="mb-1.5 text-[11px] font-bold text-[var(--muted)]">{t("orders.returns.page.date")}</div>
          <input
            type="date"
            value={dateFilter}
            onChange={(event) => setDateFilter(event.target.value)}
            className="w-full rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--card)] px-3 py-2.5 text-sm text-[var(--text)] outline-none"
          />
        </label>
      </div>
    </>
  );
}

function FilterSelect({ label, value, onChange, options, allLabel }) {
  return (
    <label className="block">
      <div className="mb-1.5 text-[11px] font-bold text-[var(--muted)]">{label}</div>
      <select value={value} onChange={(event) => onChange(event.target.value)} className="w-full rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--card)] px-3 py-2.5 text-sm text-[var(--text)] outline-none">
        <option value="all">{allLabel}</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {humanizeKey(option)}
          </option>
        ))}
      </select>
    </label>
  );
}

function ReturnsTable({ dir, loading, records, onView, onEdit, onDelete }) {
  const { t } = useTranslation();
  if (loading) {
    return (
      <div className="mt-3 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] p-6 text-center text-sm text-[var(--muted)]">
        {t("orders.returns.page.loading")}
      </div>
    );
  }

  if (!records.length) {
    return (
      <div className="mt-3 rounded-2xl border border-dashed border-[var(--border)] bg-[var(--card)] p-10 text-center">
        <RefreshCcw className="mx-auto h-8 w-8 text-[var(--muted)]" />
        <div className="mt-3 text-lg font-black text-[var(--text)]">{t("orders.returns.page.emptyTitle")}</div>
        <div className="mt-1 text-sm text-[var(--muted)]">{t("orders.returns.page.emptyHint")}</div>
      </div>
    );
  }

  return (
    <>
      <div className="mt-3 hidden overflow-auto pb-1 xl:block">
        <div className="min-w-[1560px]">
          <div className="sticky top-0 z-20 grid grid-cols-[11rem_12rem_12rem_minmax(18rem,1.35fr)_9rem_8.5rem_9rem_8rem_8.5rem] rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[10px] uppercase tracking-[0.16em] text-[var(--muted)] shadow-lg shadow-[var(--shadow)] backdrop-blur-xl" dir={dir}>
            <CellHeader>{t("orders.returns.page.cols.action")}</CellHeader>
            <CellHeader>{t("orders.returns.page.cols.returnAndOrder")}</CellHeader>
            <CellHeader>{t("orders.returns.page.cols.customer")}</CellHeader>
            <CellHeader>{t("orders.returns.page.cols.returnedProducts")}</CellHeader>
            <CellHeader>{t("orders.returns.page.cols.returnValue")}</CellHeader>
            <CellHeader>{t("orders.returns.page.cols.returnStatus")}</CellHeader>
            <CellHeader>{t("orders.returns.page.cols.refundStatus")}</CellHeader>
            <CellHeader>{t("orders.returns.page.cols.restock")}</CellHeader>
            <CellHeader>{t("orders.returns.page.cols.date")}</CellHeader>
          </div>

          <div className="mt-1.5 space-y-1.5">
            {records.map((record) => (
              <div key={record.id} className="grid grid-cols-[11rem_12rem_12rem_minmax(18rem,1.35fr)_9rem_8.5rem_9rem_8rem_8.5rem] items-center rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] px-3 py-2 shadow-xl shadow-[var(--shadow)] transition hover:border-primary/30 hover:bg-[var(--surface)]" dir={dir}>
                <div className="flex flex-wrap items-center justify-center gap-1.5 px-1 text-center">
                  <RowAction icon={Eye} label={t("orders.returns.page.action.view")} onClick={() => onView(record)} />
                  <RowAction icon={Pencil} label={t("orders.returns.page.action.editReturn")} onClick={() => onEdit(record)} disabled={!record.allowEdit} />
                  <RowAction icon={FileText} label={t("orders.returns.page.action.print")} onClick={() => window.print()} />
                  <RowAction icon={Trash2} label={t(record.returnStatus === "Draft" ? "orders.returns.page.action.cancel" : "orders.returns.page.action.delete")} onClick={() => onDelete(record)} disabled={!record.allowDelete} tone="danger" />
                </div>
                <ReturnCodeCell record={record} />
                <CustomerCell record={record} />
                <ItemsCell record={record} />
                <AmountCell value={record.refundAmount} />
                <div className="flex justify-center px-2"><StatusBadge value={record.returnStatus} /></div>
                <div className="flex flex-col items-center justify-center gap-1 px-2">
                  <StatusBadge value={record.refundStatusLabel} />
                  <span className="max-w-full truncate rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">
                    {record.refundMethodLabel}
                  </span>
                </div>
                <div className="flex justify-center px-2">
                  <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-bold ${record.restock ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200" : record.disposition === "manufacturing_defect" ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-200" : "border-[var(--border)] bg-[var(--surface)] text-[var(--muted)]"}`}>
                    {stockDispositionLabel(record)}
                  </span>
                </div>
                <DateCell value={record.createdAt} />
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-3 grid gap-3 xl:hidden">
        {records.map((record) => (
          <div key={record.id} className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-xl shadow-[var(--shadow)]">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="inline-flex rounded-full border border-[var(--border)] bg-[var(--surface)] px-2 py-0.5 text-[11px] font-black text-[var(--text)]">{record.returnNumber}</div>
                <div className="mt-2 text-sm font-bold text-[var(--text)]">{record.customerName || tt("orders.returns.page.unknownCustomer")}</div>
                <div className="mt-1 text-xs text-[var(--muted)]">{record.orderNumber}</div>
              </div>
              <StatusBadge value={record.returnStatus} />
            </div>
            <div className="mt-3 text-sm text-[var(--text)]">{record.itemsSummary}</div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
              <InfoPill label={t("orders.returns.page.pill.refund")} value={formatCurrency(record.refundAmount)} />
              <InfoPill label={t("orders.returns.page.pill.stock")} value={stockDispositionLabel(record)} />
              <InfoPill label={t("orders.returns.page.pill.refundStatus")} value={record.refundStatusLabel} />
              <InfoPill label={t("orders.returns.page.pill.refundMethod")} value={record.refundMethodLabel} />
              <InfoPill label={t("orders.returns.page.pill.date")} value={formatShortDate(record.createdAt)} />
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <MobileAction icon={Eye} label={t("orders.returns.page.action.view")} onClick={() => onView(record)} />
              <MobileAction icon={Pencil} label={t("orders.returns.page.action.edit")} onClick={() => onEdit(record)} disabled={!record.allowEdit} />
              <MobileAction icon={FileText} label="PDF" onClick={() => window.print()} />
              <MobileAction icon={Trash2} label={t("orders.returns.page.action.delete")} onClick={() => onDelete(record)} disabled={!record.allowDelete} danger />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function ReturnFormDrawer({ t, mode, form, setForm, orders, selectedOrder, onClose, onSubmit }) {
  const selectedItems = Array.isArray(selectedOrder?.items) ? selectedOrder.items : [];
  const customerLabel = selectedOrder ? `${selectedOrder.customer_name || t("orders.fallback.customer")} ${getOrderPhone(selectedOrder) ? `• ${getOrderPhone(selectedOrder)}` : ""}` : t("orders.fallback.notAvailable");

  const toggleItem = (item) => {
    setForm((current) => {
      const existing = current.returnItems[item.id];
      if (existing) {
        const next = { ...current.returnItems };
        delete next[item.id];
        return { ...current, returnItems: next };
      }
      return {
        ...current,
        returnItems: {
          ...current.returnItems,
          [item.id]: { quantity: 1, reason: "", item },
        },
      };
    });
  };

  const updateItem = (itemId, patch) => {
    setForm((current) => ({
      ...current,
      returnItems: {
        ...current.returnItems,
        [itemId]: {
          ...current.returnItems[itemId],
          ...patch,
        },
      },
    }));
  };

  return (
    <div className="fixed inset-0 z-50">
      <button type="button" aria-label={t("orders.returns.page.close")} className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <section className="absolute right-0 top-0 flex h-full w-full max-w-[46rem] flex-col overflow-hidden border-l border-[var(--border)] bg-[var(--surface)] text-[var(--text)] shadow-2xl">
        <header className="flex items-start justify-between gap-3 border-b border-[var(--border)] p-4">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-primary">{t(mode === "edit" ? "orders.returns.page.drawer.eyebrowEdit" : "orders.returns.page.drawer.eyebrowCreate")}</div>
            <h2 className="m1-section-title mt-1">{t(mode === "edit" ? "orders.returns.page.drawer.editTitle" : "orders.returns.page.drawer.createTitle")}</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">{t("orders.returns.page.drawer.subtitle")}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--card)] p-2 text-[var(--text)] hover:bg-[var(--surface)]">
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="grid gap-3 md:grid-cols-2">
            <Field label={t("orders.cancel.order")}>
              <select
                value={form.selectedOrderId}
                onChange={(event) => setForm((current) => ({ ...current, selectedOrderId: event.target.value, returnItems: {} }))}
                className="w-full rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--card)] px-4 py-3 text-sm text-[var(--text)] outline-none"
              >
                {orders.map((order) => (
                  <option key={String(order.id)} value={String(order.id)}>
                    {getOrderCode(order)} • {order.customer_name}
                  </option>
                ))}
              </select>
            </Field>

            <Field label={t("orders.returns.page.field.customer")}>
              <div className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] px-4 py-3 text-sm text-[var(--text)]">{customerLabel}</div>
            </Field>

            <Field label={t("orders.returns.returnStatus")}>
              <select
                value={form.status}
                onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))}
                className="w-full rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--card)] px-4 py-3 text-sm text-[var(--text)] outline-none"
              >
                {RETURN_STATUS_OPTIONS.map((option) => (
                  <option key={option} value={option}>{humanizeKey(option)}</option>
                ))}
              </select>
            </Field>

            <Field label={t("orders.shipping.trackingNumber")}>
              <input
                value={form.trackingNumber}
                onChange={(event) => setForm((current) => ({ ...current, trackingNumber: event.target.value }))}
                className="w-full rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--card)] px-4 py-3 text-sm text-[var(--text)] outline-none"
                placeholder={t("orders.returns.trackingPlaceholder")}
              />
            </Field>

            <Field label={t("orders.shipping.provider")}>
              <input
                value={form.shippingProvider}
                onChange={(event) => setForm((current) => ({ ...current, shippingProvider: event.target.value }))}
                className="w-full rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--card)] px-4 py-3 text-sm text-[var(--text)] outline-none"
                placeholder={t("orders.returns.providerPlaceholder")}
              />
            </Field>

            <Field label={t("orders.returns.page.field.refundMethod")}>
              <select
                value={form.refundMethod}
                onChange={(event) => setForm((current) => ({ ...current, refundMethod: event.target.value }))}
                className="w-full rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--card)] px-4 py-3 text-sm text-[var(--text)] outline-none"
              >
                {REFUND_METHOD_OPTIONS.map((option) => (
                  <option key={option} value={option}>{humanizeKey(option)}</option>
                ))}
              </select>
            </Field>

            <Field label={t("orders.returns.page.field.refundStatus")}>
              <select
                value={form.refundStatus}
                onChange={(event) => setForm((current) => ({ ...current, refundStatus: event.target.value }))}
                className="w-full rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--card)] px-4 py-3 text-sm text-[var(--text)] outline-none"
              >
                {REFUND_STATUS_OPTIONS.map((option) => (
                  <option key={option} value={option}>{humanizeKey(option)}</option>
                ))}
              </select>
            </Field>

            <Field label={t("orders.returns.refundAmount")}>
              <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm font-black text-emerald-700 dark:text-emerald-200">
                {formatCurrency(form.refundAmount)}
              </div>
            </Field>

            <Field label={t("orders.returns.page.field.disposition")}>
              <select
                value={form.disposition}
                onChange={(event) => {
                  const disposition = event.target.value;
                  setForm((current) => ({ ...current, disposition, restock: disposition === "restock" }));
                }}
                className="w-full rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--card)] px-4 py-3 text-sm text-[var(--text)] outline-none"
              >
                {RETURN_DISPOSITION_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </Field>
          </div>

          <section className="mt-4 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] p-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="m1-section-title text-[var(--text)]">{t("orders.returns.returnedItems")}</h3>
              <label className="inline-flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)]">
                <input type="checkbox" checked={form.restock} disabled={form.disposition !== "restock"} onChange={(event) => setForm((current) => ({ ...current, restock: event.target.checked }))} />
                {t("orders.returns.restockReturnedItems")}
              </label>
            </div>

            <div className="mt-4 space-y-3">
              {selectedItems.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--surface)] p-6 text-sm text-[var(--muted)]">
                  {t("orders.returns.noItemsFound")}
                </div>
              ) : (
                selectedItems.map((item, index) => {
                  const checked = Boolean(form.returnItems[item.id]);
                  const selectedItem = form.returnItems[item.id];
                  return (
                    <div key={String(item.id || index)} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                        <button
                          type="button"
                          onClick={() => toggleItem(item)}
                          className={`rounded-[var(--radius-control)] px-3 py-2 text-sm font-semibold ${checked ? "bg-primary text-[var(--primary-contrast)]" : "border border-[var(--border)] bg-[var(--card)] text-[var(--text)]"}`}
                        >
                          {checked ? t("orders.returns.included") : t("orders.returns.select")}
                        </button>
                        <div className="flex-1">
                          <div className="font-semibold text-[var(--text)]">{item.product_name || item.name}</div>
                          <div className="mt-1 text-sm text-[var(--muted)]">
                            {[item.color, item.size].filter(Boolean).join(" / ") || t("orders.fallback.variant")} - {t("orders.drawer.qty")} {item.quantity || 0}
                          </div>
                        </div>
                        <div className="text-sm font-semibold text-[var(--text)]">{formatCurrency(resolveOrderItemUnitPrice(item) * Number(item.quantity || 0))}</div>
                      </div>

                      {checked ? (
                        <div className="mt-3 grid gap-3 md:grid-cols-3">
                          <Field label={t("orders.returns.returnQty")}>
                            <input
                              type="number"
                              min="1"
                              max={item.quantity}
                              value={selectedItem?.quantity ?? 1}
                              onChange={(event) => updateItem(item.id, { quantity: Number(event.target.value || 0) })}
                              className="w-full rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--card)] px-4 py-3 text-sm text-[var(--text)] outline-none"
                            />
                          </Field>
                          <div className="md:col-span-2">
                            <Field label={t("orders.returns.reason")}>
                              <input
                                value={selectedItem?.reason || ""}
                                onChange={(event) => {
                                  const reason = event.target.value;
                                  updateItem(item.id, { reason });
                                  if (isManufacturingDefectText(reason)) {
                                    setForm((current) => ({ ...current, disposition: "manufacturing_defect", restock: false }));
                                  }
                                }}
                                className="w-full rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--card)] px-4 py-3 text-sm text-[var(--text)] outline-none"
                                placeholder={t("orders.returns.reasonPlaceholder")}
                              />
                            </Field>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  );
                })
              )}
            </div>
          </section>

          <div className="mt-4 grid gap-3">
            <Field label={t("orders.returns.returnReason")}>
              <textarea
                value={form.reason}
                onChange={(event) => {
                  const reason = event.target.value;
                  setForm((current) => ({
                    ...current,
                    reason,
                    ...(isManufacturingDefectText(reason) ? { disposition: "manufacturing_defect", restock: false } : {}),
                  }));
                }}
                rows={5}
                className="w-full rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--card)] p-4 text-sm text-[var(--text)] outline-none"
                placeholder={t("orders.returns.overallReasonPlaceholder")}
              />
            </Field>
          </div>
        </div>

        <footer className="grid gap-2 border-t border-[var(--border)] p-4 sm:grid-cols-2">
          <button type="button" onClick={onClose} className="rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--card)] px-4 py-3 text-sm font-bold hover:bg-[var(--surface)]">
            {t("orders.returns.page.close")}
          </button>
          <button type="button" onClick={onSubmit} className="rounded-[var(--radius-control)] bg-primary px-4 py-3 text-sm font-black text-[var(--primary-contrast)]">
            {mode === "edit" ? t("orders.returns.page.saveEdits") : t("orders.returns.saveReturn")}
          </button>
        </footer>
      </section>
    </div>
  );
}

function ReturnDetailsDrawer({ record, onClose, onEdit, onDelete, navigate }) {
  const { t } = useTranslation();
  return (
    <div className="fixed inset-0 z-50">
      <button type="button" aria-label={t("orders.returns.page.close")} className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <section className="absolute right-0 top-0 flex h-full w-full max-w-[42rem] flex-col overflow-hidden border-l border-[var(--border)] bg-[var(--surface)] text-[var(--text)] shadow-2xl">
        <header className="flex items-start justify-between gap-3 border-b border-[var(--border)] p-4">
          <div className="min-w-0">
            <div className="inline-flex rounded-full border border-[var(--border)] bg-[var(--card)] px-2 py-0.5 text-[11px] font-black">{record.returnNumber}</div>
            <h2 className="m1-section-title mt-2 truncate">{record.customerName || tt("orders.returns.page.unknownCustomer")}</h2>
            <div className="mt-2 flex flex-wrap gap-2">
              <StatusBadge value={record.returnStatus} />
              <StatusBadge value={record.refundStatusLabel} />
              {record.restock ? <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-200">{t("orders.returns.page.restockedBadge")}</span> : null}
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--card)] p-2 text-[var(--text)] hover:bg-[var(--surface)]">
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <DrawerSection title={t("orders.returns.page.section.summary")}>
            <InfoGrid
              items={[
                [t("orders.returns.page.info.returnNumber"), record.returnNumber],
                [t("orders.returns.page.info.returnValue"), formatCurrency(record.refundAmount)],
                [t("orders.returns.page.info.returnStatus"), record.returnStatusLabel],
                [t("orders.returns.page.info.refundStatus"), record.refundStatusLabel],
              ]}
            />
          </DrawerSection>

          <DrawerSection title={t("orders.returns.page.section.originalOrder")}>
            <InfoGrid
              items={[
                [t("orders.returns.page.info.orderNumber"), record.orderNumber],
                [t("orders.returns.page.info.tracking"), record.trackingNumber || t("orders.returns.page.notAvailable")],
                [t("orders.returns.page.info.shippingProvider"), record.shippingProvider || t("orders.returns.page.notAvailable")],
                [t("orders.returns.page.info.createdAt"), formatDateTime(record.createdAt)],
              ]}
            />
          </DrawerSection>

          <DrawerSection title={t("orders.returns.page.section.customer")}>
            <InfoGrid
              items={[
                [t("orders.returns.page.info.customer"), record.customerName || t("orders.returns.page.notAvailable")],
                [t("orders.returns.page.info.phone"), record.customerPhone || t("orders.returns.page.notAvailable")],
              ]}
            />
          </DrawerSection>

          <DrawerSection title={t("orders.returns.page.section.returnedProducts")}>
            <div className="space-y-2">
              {record.items.length ? record.items.map((item) => (
                <div key={item.key} className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-black text-[var(--text)]">{item.name}</div>
                      <div className="mt-1 text-xs text-[var(--muted)]">{item.variantLabel}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-black text-[var(--text)]">x{item.quantity}</div>
                      <div className="mt-0.5 text-[11px] text-[var(--muted)]">{formatCurrency(item.refundAmount)}</div>
                    </div>
                  </div>
                  {item.reason ? <div className="mt-2 text-xs text-[var(--muted)]">{t("orders.returns.page.reasonPrefix")} {item.reason}</div> : null}
                </div>
              )) : <EmptyDrawerText text={t("orders.returns.page.noReturnedItemsRecorded")} />}
            </div>
          </DrawerSection>

          <DrawerSection title={t("orders.returns.page.section.stockMovement")}>
            <InfoGrid
              items={[
                [t("orders.returns.page.info.restock"), stockDispositionLabel(record)],
                [t("orders.returns.page.info.movementStatus"), t(record.restock ? "orders.returns.page.movement.done" : record.disposition === "manufacturing_defect" ? "orders.returns.page.movement.reserved" : "orders.returns.page.movement.notDone")],
              ]}
            />
          </DrawerSection>

          <DrawerSection title={t("orders.returns.page.section.refundPayment")}>
            <InfoGrid
              items={[
                [t("orders.returns.page.info.refundMethod"), record.refundMethodLabel],
                [t("orders.returns.page.info.refundStatus"), record.refundStatusLabel],
                [t("orders.returns.page.info.amount"), formatCurrency(record.refundAmount)],
              ]}
            />
          </DrawerSection>

          <DrawerSection title={t("orders.returns.page.section.notes")}>
            <div className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] p-3 text-sm leading-6 text-[var(--text)]">
              {record.reason || t("orders.returns.page.noNotes")}
            </div>
          </DrawerSection>

          <DrawerSection title={t("orders.returns.page.section.timeline")}>
            <div className="space-y-3">
              {record.timeline.map((item) => (
                <div key={item.id} className="grid grid-cols-[1rem_minmax(0,1fr)] gap-3">
                  <div className="mt-1 h-3 w-3 rounded-full bg-primary" />
                  <div>
                    <div className="text-sm font-black text-[var(--text)]">{item.label}</div>
                    <div className="mt-0.5 text-xs text-[var(--muted)]">{item.at ? formatDateTime(item.at) : t("orders.returns.page.noTimestamp")}</div>
                  </div>
                </div>
              ))}
            </div>
          </DrawerSection>
        </div>

        <footer className="grid gap-2 border-t border-[var(--border)] p-4 sm:grid-cols-2">
          <button type="button" onClick={() => navigate(`/orders/${record.orderId}`)} className="rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--card)] px-4 py-3 text-sm font-bold hover:bg-[var(--surface)]">
            {t("orders.returns.page.openOriginalOrder")}
          </button>
          <button type="button" onClick={onEdit} disabled={!record.allowEdit} className="rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--card)] px-4 py-3 text-sm font-bold hover:bg-[var(--surface)] disabled:cursor-not-allowed disabled:opacity-45">
            {t("orders.returns.page.action.editReturn")}
          </button>
          <button type="button" onClick={() => window.print()} className="rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--card)] px-4 py-3 text-sm font-bold hover:bg-[var(--surface)]">
            {t("orders.returns.page.action.print")}
          </button>
          <button type="button" onClick={onDelete} disabled={!record.allowDelete} className="rounded-[var(--radius-control)] bg-rose-600 px-4 py-3 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-45">
            {t(record.returnStatus === "Draft" ? "orders.returns.page.cancelReturn" : "orders.returns.page.deleteReturn")}
          </button>
        </footer>
      </section>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-[var(--muted)]">{label}</div>
      {children}
    </label>
  );
}

function DrawerSection({ title, children }) {
  return (
    <section className="mt-4">
      <h3 className="m1-section-title mb-3 text-[var(--text)]">{title}</h3>
      {children}
    </section>
  );
}

function InfoGrid({ items }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {items.map(([label, value]) => (
        <div key={label} className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] p-3">
          <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--muted)]">{label}</div>
          <div className="mt-1 text-sm font-semibold text-[var(--text)]">{value}</div>
        </div>
      ))}
    </div>
  );
}

function EmptyDrawerText({ text: value }) {
  return <div className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] p-3 text-sm text-[var(--muted)]">{value}</div>;
}

function CellHeader({ children }) {
  return <div className="flex items-center justify-center px-2 py-1 text-center">{children}</div>;
}

function ReturnCodeCell({ record }) {
  return (
    <div className="table-cell-stack px-2">
      <div className="inline-flex max-w-full items-center truncate rounded-full border border-[var(--border)] bg-[var(--surface)] px-2 py-0.5 text-[11px] font-black text-[var(--text)]">
        {record.returnNumber}
      </div>
      <div className="mt-1 truncate text-[11px] font-semibold text-[var(--muted)]">{record.orderNumber}</div>
    </div>
  );
}

function CustomerCell({ record }) {
  return (
    <div className="table-cell-stack px-2">
      <div className="truncate text-sm font-semibold text-[var(--text)]">{record.customerName || tt("orders.returns.page.unknownCustomer")}</div>
      <div className="mt-1 truncate text-[11px] text-[var(--muted)]">{record.customerPhone || tt("orders.returns.page.noPhone")}</div>
    </div>
  );
}

function ItemsCell({ record }) {
  return (
    <div className="table-cell-stack px-2">
      <div className="text-center text-sm font-semibold text-[var(--text)]">{tt("orders.returns.page.itemsCount", { count: record.itemsCount })}</div>
      <div className="mt-1 text-center text-[11px] leading-5 text-[var(--muted)]">{record.itemsSummary}</div>
    </div>
  );
}

function AmountCell({ value }) {
  return <div className="px-2 text-center text-sm font-bold text-[var(--text)]">{formatCurrency(value)}</div>;
}

function DateCell({ value }) {
  return (
    <div className="table-cell-stack px-2">
      <div className="text-xs font-black text-[var(--text)]">{formatShortDate(value)}</div>
      <div className="mt-0.5 text-[11px] font-semibold text-[var(--muted)]">{formatShortTime(value)}</div>
    </div>
  );
}

function RowAction({ icon: Icon, label, onClick, disabled = false, tone = "default" }) {
  const toneClass = tone === "danger" ? "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-200" : "border-[var(--border)] bg-[var(--surface)] text-[var(--text)]";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      className={`inline-flex items-center gap-1 rounded-[var(--radius-control)] border px-2 py-1 text-[10px] font-bold transition hover:bg-[var(--card)] disabled:cursor-not-allowed disabled:opacity-45 ${toneClass}`}
    >
      <Icon className="h-3.5 w-3.5" />
      <span className="hidden 2xl:inline">{label}</span>
    </button>
  );
}

function MobileAction({ icon: Icon, label, onClick, disabled = false, danger = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-1 rounded-[var(--radius-control)] border px-3 py-2 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-45 ${danger ? "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-200" : "border-[var(--border)] bg-[var(--surface)] text-[var(--text)]"}`}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}

function InfoPill({ label, value }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-2">
      <div className="text-[10px] text-[var(--muted)]">{label}</div>
      <div className="mt-1 font-bold text-[var(--text)]">{value}</div>
    </div>
  );
}

function normalizeReturnRecord(record, orderMap) {
  const order = orderMap.get(String(record.orderId)) || {};
  const orderItems = Array.isArray(order.items) ? order.items : [];
  const items = (Array.isArray(record.items) ? record.items : []).map((entry, index) => {
    const orderItem = orderItems.find((item) => String(item.id) === String(entry.orderItemId)) || {};
    const quantity = Number(entry.quantity || 0);
    const refundAmount = Number(entry.refund_amount || quantity * resolveOrderItemUnitPrice(orderItem) || 0);
    return {
      key: `${entry.orderItemId || index}-${index}`,
      name: orderItem.product_name || orderItem.name || tt("orders.returns.page.productFallback", { index: index + 1 }),
      quantity,
      reason: entry.reason || "",
      refundAmount,
      variantLabel: [orderItem.color, orderItem.size].filter(Boolean).join(" / ") || orderItem.sku || "Variant",
      item: orderItem,
    };
  });

  const returnStatus = text(record.status || record.returnStatus || "Draft");
  const refundStatus = text(record.refundStatus || inferRefundStatus(returnStatus));
  const refundAmount = Number(record.refundAmount || items.reduce((sum, item) => sum + item.refundAmount, 0));

  return {
    id: record.id || `ret-${record.orderId}-${record.createdAt || Date.now()}`,
    source: "local",
    orderId: record.orderId,
    orderNumber: text(record.orderNumber || getOrderCode(order)),
    returnNumber: text(record.id || `RET-${record.orderId}`),
    customerName: text(record.customerName || order.customer_name || "Walk-in Customer"),
    customerPhone: text(record.customerPhone || getOrderPhone(order)),
    items,
    itemsCount: items.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
    itemsSummary: summarizeItems(items),
    refundAmount,
    returnStatus,
    returnStatusLabel: humanizeKey(returnStatus),
    refundStatus,
    refundStatusLabel: humanizeKey(refundStatus),
    refundMethod: normalizeRefundMethod(record.refundMethod || record.refund_method || "cash"),
    refundMethodLabel: humanizeKey(record.refundMethod || record.refund_method || "cash"),
    trackingNumber: text(record.trackingNumber || order.tracking_number),
    shippingProvider: text(record.shippingProvider || order.shipping_provider),
    restock: Boolean(record.restock),
    disposition: record.disposition || (record.restock ? "restock" : "damaged"),
    reason: text(record.reason),
    createdAt: record.createdAt || record.updatedAt || new Date().toISOString(),
    allowEdit: true,
    allowDelete: true,
    timeline: buildReturnTimeline(record, returnStatus),
  };
}

function normalizeOrderReturn(order) {
  const orderItems = Array.isArray(order.items) ? order.items : [];
  const items = orderItems
    .filter((item) => Number(item.returned_quantity || item.refunded_quantity || 0) > 0)
    .map((item, index) => {
      const quantity = Number(item.returned_quantity || item.refunded_quantity || 0);
      return {
        key: `${item.id || index}-${quantity}`,
        name: item.product_name || item.name || tt("orders.returns.page.productFallback", { index: index + 1 }),
        quantity,
        reason: text(item.return_reason || order.cancel_reason || order.notes),
        refundAmount: Number(item.refund_amount || quantity * resolveOrderItemUnitPrice(item) || 0),
        variantLabel: [item.color, item.size].filter(Boolean).join(" / ") || item.sku || "Variant",
        item,
      };
    });

  const fallbackItems = items.length ? items : orderItems.slice(0, 3).map((item, index) => ({
    key: `${item.id || index}-${index}`,
    name: item.product_name || item.name || tt("orders.returns.page.productFallback", { index: index + 1 }),
    quantity: Number(item.returned_quantity || item.refunded_quantity || item.quantity || 1),
    reason: "",
    refundAmount: Number(item.refund_amount || 0),
    variantLabel: [item.color, item.size].filter(Boolean).join(" / ") || item.sku || "Variant",
    item,
  }));

  const returnStatus = text(order.return_status || order.status || "Returned");
  const refundStatus = text(order.refund_status || inferRefundStatus(returnStatus));
  const refundAmount = Number(order.refund_amount || order.refunded_amount || order.total_refund_amount || fallbackItems.reduce((sum, item) => sum + item.refundAmount, 0));

  return {
    id: `order-return-${order.id}`,
    source: "order",
    orderId: order.id,
    orderNumber: getOrderCode(order),
    returnNumber: text(order.return_number || `RET-${order.id}`),
    customerName: text(order.customer_name || "Walk-in Customer"),
    customerPhone: getOrderPhone(order),
    items: fallbackItems,
    itemsCount: fallbackItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
    itemsSummary: summarizeItems(fallbackItems),
    refundAmount,
    returnStatus,
    returnStatusLabel: humanizeKey(returnStatus),
    refundStatus,
    refundStatusLabel: humanizeKey(refundStatus),
    refundMethod: normalizeRefundMethod(order.refund_method || order.refundMethod || order.payment_method || "cash"),
    refundMethodLabel: humanizeKey(order.refund_method || order.refundMethod || order.payment_method || "cash"),
    trackingNumber: text(order.tracking_number || order.shipping_tracking_number),
    shippingProvider: text(order.shipping_provider),
    restock: Boolean(order.restock || order.stock_reverted_at || order.inventory_rollback_done),
    disposition: order.disposition || (order.restock ? "restock" : "damaged"),
    reason: text(order.cancel_reason || order.notes),
    createdAt: order.returned_at || order.refunded_at || order.return_completed_at || order.created_at,
    allowEdit: false,
    allowDelete: false,
    timeline: buildOrderTimeline(order),
  };
}

function summarizeItems(items) {
  if (!items.length) return tt("orders.returns.page.noReturnedItems");
  const names = items.slice(0, 3).map((item) => item.name).filter(Boolean);
  const more = items.length > 3 ? ` +${items.length - 3}` : "";
  return `${names.join(tt("orders.returns.page.itemsSeparator"))}${more}`;
}

function inferRefundStatus(returnStatus) {
  const normalized = lower(returnStatus);
  if (normalized === "refunded") return "refunded";
  if (normalized === "rejected") return "rejected";
  if (normalized === "approved") return "processing";
  return "pending";
}

function buildReturnTimeline(record, returnStatus) {
  return [
    { id: "created", label: tt("orders.returns.page.timeline.returnCreated"), at: record.createdAt },
    { id: "returnStatus", label: tt("orders.returns.page.timeline.returnStatus", { value: humanizeKey(returnStatus) }), at: record.updatedAt || record.createdAt },
    { id: "refundStatus", label: tt("orders.returns.page.timeline.refundStatus", { value: humanizeKey(record.refundStatus || inferRefundStatus(returnStatus)) }), at: record.updatedAt || record.createdAt },
    record.refundMethod ? { id: "refundMethod", label: tt("orders.returns.page.timeline.refundMethod", { value: humanizeKey(record.refundMethod) }), at: record.updatedAt || record.createdAt } : null,
  ].filter(Boolean);
}

function buildOrderTimeline(order) {
  return [
    { id: "created", label: tt("orders.returns.page.timeline.orderCreated"), at: order.created_at },
    { id: "returnLogged", label: tt("orders.returns.page.timeline.returnLogged"), at: order.returned_at || order.return_completed_at || order.refunded_at || order.created_at },
    { id: "currentStatus", label: tt("orders.returns.page.timeline.currentStatus", { value: humanizeKey(order.return_status || order.status || "returned") }), at: order.refunded_at || order.return_completed_at || order.updated_at || order.created_at },
    order.refund_method ? { id: "refundMethod", label: tt("orders.returns.page.timeline.refundMethod", { value: humanizeKey(order.refund_method) }), at: order.refunded_at || order.return_completed_at || order.updated_at || order.created_at } : null,
  ].filter(Boolean);
}

function buildFormReturnItems(record) {
  const next = {};
  (record.items || []).forEach((entry) => {
    const itemId = entry.item?.id || entry.key;
    next[itemId] = {
      quantity: Number(entry.quantity || 1),
      reason: entry.reason || "",
      item: entry.item || { id: itemId },
    };
  });
  return next;
}

const HUMANIZED_KEYS = {
  cash: "orders.returns.page.humanize.cash",
  card: "orders.returns.page.humanize.card",
  same_payment_method: "orders.returns.page.humanize.same_payment_method",
  pending: "orders.returns.page.humanize.pending",
  processing: "orders.returns.page.humanize.processing",
  refunded: "orders.returns.page.humanize.refunded",
  partial_refund: "orders.returns.page.humanize.partial_refund",
  rejected: "orders.returns.page.humanize.rejected",
  draft: "orders.returns.page.humanize.draft",
  submitted: "orders.returns.page.humanize.submitted",
  approved: "orders.returns.page.humanize.approved",
  returned: "orders.returns.page.humanize.returned",
};

/* Brand names, never translated. */
const BRAND_LABELS = { vodafone_cash: "Vodafone Cash", instapay: "InstaPay" };

function humanizeKey(value) {
  const normalized = text(value).replace(/_/g, " ");
  const key = lower(value);
  if (BRAND_LABELS[key]) return BRAND_LABELS[key];
  if (HUMANIZED_KEYS[key]) return tt(HUMANIZED_KEYS[key]);
  return normalized || tt("orders.returns.page.humanize.unknown");
}

function formatShortDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("ar-EG", { year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function formatShortTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("ar-EG", { hour: "numeric", minute: "2-digit" }).format(date);
}

export default OrderReturnsPage;
