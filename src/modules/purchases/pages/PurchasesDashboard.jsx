import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

import {
  AlertTriangle,
  Eye,
  Filter,
  MoreHorizontal,
  PackageSearch,
  Plus,
  Search,
  Truck,
} from "lucide-react";

import toast from "react-hot-toast";
import { api } from "../../../shared/api/api";
import FlowShell from "../components/FlowShell";
import StatusBadge from "../components/StatusBadge";
import {
  buildSearchText,
  derivePurchaseKpis,
  formatCurrency,
  formatDateTime,
  getLocalPurchases,
  normalizePurchase,
  normalizeSupplier,
  normalizeWarehouse,
  seedSuppliers,
  seedWarehouses,
} from "../lib/flowStore";

const PAGE_SIZE = 10;
const uniqueValues = (items) => Array.from(new Set(items.filter(Boolean)));

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
  const [openMenuId, setOpenMenuId] = useState(null);

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

      setPurchases(getLocalPurchases().map(normalizePurchase));
    } catch (err) {
      console.log(err);
      setPurchases(getLocalPurchases().map(normalizePurchase));
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
  }, [search, supplierFilter, statusFilter, warehouseFilter, branchFilter, paymentFilter, dateFilter, dateFromFilter, dateToFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredPurchases.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const visiblePurchases = filteredPurchases.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const kpis = derivePurchaseKpis(purchases);
  const today = new Date().toISOString().slice(0, 10);
  const monthKey = today.slice(0, 7);
  const enterpriseKpis = {
    monthlySpend: purchases
      .filter((purchase) => String(purchase.created_at || "").slice(0, 7) === monthKey)
      .reduce((sum, purchase) => sum + Number(purchase.total || 0), 0),
    pendingOrders: purchases.filter((purchase) => ["ordered", "pending", "partially_received", "Ordered", "Pending", "Partially Received"].includes(purchase.status)).length,
    receivedToday: purchases.filter((purchase) => String(purchase.created_at || "").slice(0, 10) === today && /received/i.test(String(purchase.status || ""))).length,
    supplierBalances: suppliers.reduce((sum, supplier) => sum + Number(supplier.current_balance ?? supplier.balance ?? supplier.debt_balance ?? 0), 0),
  };

  const supplierOptions = ["all", ...uniqueValues(purchases.map((purchase) => purchase.supplier_name))];
  const statusOptions = ["all", ...uniqueValues(purchases.map((purchase) => purchase.status))];
  const warehouseOptions = ["all", ...uniqueValues(purchases.map((purchase) => purchase.warehouse_name))];
  const branchOptions = ["all", ...branches.map((branch) => ({ value: branch.id, label: branch.name || branch.code || `Branch ${branch.id}` }))];
  const paymentOptions = ["all", ...uniqueValues(purchases.map((purchase) => purchase.payment_status))];

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
        { to: "/purchases/reorder-suggestions", label: "Smart Reorder" },
        { to: "/suppliers", label: t("purchases.tabs.suppliers") },
        { to: "/inventory", label: t("purchases.tabs.inventory") },
        { to: "/warehouses", label: t("purchases.tabs.warehouses") },
      ]}
    >
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <KpiCard label={t("purchases.kpis.totalPurchases")} value={kpis.totalPurchases} />
        <KpiCard label="Monthly spend" value={formatCurrency(enterpriseKpis.monthlySpend, i18n.language)} tone="violet" />
        <KpiCard label="Pending orders" value={enterpriseKpis.pendingOrders} tone="blue" />
        <KpiCard label="Received today" value={enterpriseKpis.receivedToday} tone="emerald" />
        <KpiCard label="Supplier balances" value={formatCurrency(enterpriseKpis.supplierBalances, i18n.language)} tone="amber" />
      </div>

      {error ? (
        <div className="rounded-3xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-100">
          <AlertTriangle className="mr-2 inline h-4 w-4" />
          {error}
        </div>
      ) : null}

      <div className="rounded-3xl border border-white/10 bg-zinc-950/90 p-4 shadow-2xl shadow-black/10">
        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_12rem_12rem_12rem_12rem_12rem]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            placeholder={t("purchases.searchPlaceholder")}
              className="w-full rounded-2xl border border-white/10 bg-white/5 py-3 pl-11 pr-4 text-sm text-white outline-none placeholder:text-zinc-500"
            />
          </div>
          <Select value={supplierFilter} onChange={setSupplierFilter} options={supplierOptions} label={t("purchases.filters.supplier")} allLabel={t("purchases.filters.all")} />
          <Select value={statusFilter} onChange={setStatusFilter} options={statusOptions} label={t("purchases.filters.status")} allLabel={t("purchases.filters.all")} />
          <Select value={warehouseFilter} onChange={setWarehouseFilter} options={warehouseOptions} label={t("purchases.filters.warehouse")} allLabel={t("purchases.filters.all")} />
          <Select value={paymentFilter} onChange={setPaymentFilter} options={paymentOptions} label={t("purchases.filters.payment")} allLabel={t("purchases.filters.all")} />
          <input
            type="date"
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
            className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none"
          />
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          {branches.length > 1 ? <Select value={branchFilter} onChange={setBranchFilter} options={branchOptions} label="Branch" allLabel={t("purchases.filters.all")} /> : null}
          <DateField label="Date from" value={dateFromFilter} onChange={setDateFromFilter} />
          <DateField label="Date to" value={dateToFilter} onChange={setDateToFilter} />
        </div>

        <div className="mt-4 overflow-x-auto">
          <div className="min-w-[1180px]">
            <div className="grid grid-cols-[12%_16%_13%_12%_10%_10%_10%_9%_8%] rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-xs uppercase tracking-[0.18em] text-zinc-500">
              <div>{t("purchases.table.invoice")}</div>
              <div>{t("purchases.table.supplier")}</div>
              <div>{t("purchases.table.warehouse")}</div>
              <div>{t("purchases.table.status")}</div>
              <div>{t("purchases.table.payment")}</div>
              <div>{t("purchases.table.items")}</div>
              <div>{t("purchases.table.total")}</div>
              <div>{t("purchases.table.date")}</div>
              <div></div>
            </div>

            <div className="mt-2 space-y-2">
              {loading ? (
                <TableSkeleton />
              ) : visiblePurchases.length === 0 ? (
                <div className="rounded-3xl border border-dashed border-white/10 bg-white/5 p-10 text-center">
                  <PackageSearch className="mx-auto h-12 w-12 text-zinc-500" />
                  <h3 className="mt-4 text-xl font-black text-white">{t("purchases.empty.title")}</h3>
                  <p className="mt-2 text-sm text-zinc-400">{t("purchases.empty.description")}</p>
                </div>
              ) : (
                visiblePurchases.map((purchase) => (
                  <div
                    key={String(purchase.id)}
                    className="grid grid-cols-[12%_16%_13%_12%_10%_10%_10%_9%_8%] items-center rounded-2xl border border-white/10 bg-zinc-950/90 px-4 py-3 transition hover:bg-white/5"
                  >
                    <div>
                      <div className="font-bold text-white">{purchase.invoice_number}</div>
                      <div className="text-xs text-zinc-500">#{purchase.id}</div>
                    </div>
                    <div>
                      <div className="font-semibold text-white">{purchase.supplier_name}</div>
                      <div className="text-xs text-zinc-500">{purchase.payment_status}</div>
                    </div>
                    <div className="text-sm text-zinc-300">{purchase.warehouse_name}</div>
                    <StatusBadge value={purchase.status} />
                    <StatusBadge value={purchase.payment_status} />
                    <div className="text-sm text-zinc-300">{purchase.items?.length || 0}</div>
                    <div className="font-bold text-white">{formatCurrency(purchase.total)}</div>
                    <div className="text-xs text-zinc-400">{formatDateTime(purchase.created_at)}</div>
                    <div className="relative flex justify-end">
                      <button
                        type="button"
                        onClick={() => setOpenMenuId(openMenuId === purchase.id ? null : purchase.id)}
                        className="rounded-xl border border-white/10 bg-white/5 p-2 text-white"
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </button>
                      {openMenuId === purchase.id ? (
                        <div className="absolute right-0 top-11 z-20 w-48 rounded-2xl border border-white/10 bg-zinc-950 p-2 shadow-2xl">
                            <MenuItem to="/purchases/create" icon={<Eye className="h-4 w-4" />} label={t("purchases.actionsMenu.openOrder")} />
                          <MenuItem to="/inventory/adjustments" icon={<Truck className="h-4 w-4" />} label={t("purchases.actionsMenu.receiveStock")} />
                          <button
                            type="button"
                            onClick={() => {
                              navigator.clipboard.writeText(purchase.invoice_number);
                              toast.success(t("purchases.actionsMenu.invoiceCopied"));
                            }}
                            className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-zinc-200 hover:bg-white/5"
                          >
                            <Filter className="h-4 w-4" />
                            {t("purchases.actionsMenu.copyInvoice")}
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm text-zinc-400">
            {t("purchases.paging.showing")} {visiblePurchases.length} {t("purchases.paging.of")} {filteredPurchases.length} {t("purchases.paging.records")}
          </div>
          <div className="flex items-center gap-2">
            <PagerButton onClick={() => setPage((prev) => Math.max(1, prev - 1))} disabled={currentPage === 1} label={t("common.previous")} />
            <span className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-zinc-300">
              {t("purchases.paging.page")} {currentPage} / {totalPages}
            </span>
            <PagerButton onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))} disabled={currentPage === totalPages} label={t("common.next")} />
            </div>
          </div>
        </div>
    </FlowShell>
  );
}

function KpiCard({ label, value, tone = "zinc" }) {
  const classes = {
    emerald: "border-emerald-500/20 bg-emerald-500/10 text-emerald-300",
    blue: "border-blue-500/20 bg-blue-500/10 text-blue-300",
    amber: "border-amber-500/20 bg-amber-500/10 text-amber-300",
    violet: "border-violet-500/20 bg-violet-500/10 text-violet-300",
    zinc: "border-white/10 bg-white/5 text-white",
  };
  return (
    <div className={`rounded-3xl border p-4 shadow-xl ${classes[tone]}`}>
      <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">{label}</div>
      <div className="mt-2 text-2xl font-black text-white">{value}</div>
    </div>
  );
}

function Select({ value, onChange, options, label, allLabel = "All" }) {
  return (
    <label className="block">
      <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-zinc-500">{label}</div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none"
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

function DateField({ label, value, onChange }) {
  return (
    <label className="block">
      <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-zinc-500">{label}</div>
      <input
        type="date"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none"
      />
    </label>
  );
}

function PagerButton({ onClick, disabled, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
    >
      {label}
    </button>
  );
}

function MenuItem({ to, icon, label }) {
  return (
    <Link to={to} className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-zinc-200 hover:bg-white/5">
      {icon}
      {label}
    </Link>
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
