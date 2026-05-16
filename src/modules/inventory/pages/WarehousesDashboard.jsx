import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { AlertTriangle, ArrowRightLeft, Clock3, Search, Warehouse } from "lucide-react";
import toast from "react-hot-toast";

import { api } from "../../../shared/api/api";
import InventoryShell from "../components/InventoryShell";
import StatusBadge from "../../purchases/components/StatusBadge";
import { formatCurrency, normalizeWarehouse, seedWarehouses } from "../../purchases/lib/flowStore";

function WarehousesDashboard() {
  const { t } = useTranslation();
  const [warehouses, setWarehouses] = useState(seedWarehouses());
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        setError("");
        const data = await api.get("/warehouses");
        const rows = Array.isArray(data) ? data : data?.warehouses || [];
        setWarehouses(rows.length ? rows.map(normalizeWarehouse) : seedWarehouses());
      } catch (err) {
        console.log(err);
        setWarehouses(seedWarehouses());
        setError(t("warehouses.fallbackError"));
        toast.error(t("warehouses.fallbackToast"));
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const filtered = useMemo(
    () => warehouses.filter((warehouse) => `${warehouse.name} ${warehouse.location} ${warehouse.branch}`.toLowerCase().includes(search.trim().toLowerCase())),
    [warehouses, search]
  );

  const stats = useMemo(
    () => ({
      warehouses: warehouses.length,
      active: warehouses.filter((warehouse) => warehouse.status === "Active").length,
      branch: warehouses.filter((warehouse) => warehouse.branch !== "Main").length,
      value: warehouses.length * 100000,
    }),
    [warehouses]
  );

  return (
    <InventoryShell
      title={t("warehouses.title")}
      subtitle={t("warehouses.subtitle")}
      actions={
        <div className="flex flex-wrap gap-2">
          <Link to="/inventory/history" className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10">
            <Clock3 className="h-4 w-4" />
            {t("warehouses.history")}
          </Link>
          <Link to="/stock-transfers" className="inline-flex items-center gap-2 rounded-2xl bg-blue-500 px-4 py-2 text-sm font-black text-black transition hover:bg-blue-400">
            <ArrowRightLeft className="h-4 w-4" />
            {t("warehouses.transferStock")}
          </Link>
        </div>
      }
      tabs={[
        { to: "/inventory", label: t("warehouses.tabs.inventory"), end: true },
        { to: "/inventory/movements", label: t("warehouses.tabs.movements") },
        { to: "/inventory/adjustments", label: t("warehouses.tabs.adjustments") },
        { to: "/stock-transfers", label: t("warehouses.tabs.transfers") },
        { to: "/warehouses", label: t("warehouses.tabs.warehouses"), end: true },
      ]}
    >
      {error ? (
        <div className="rounded-3xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-100">
          <AlertTriangle className="mr-2 inline h-4 w-4" />
          {error}
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Kpi label={t("warehouses.kpis.warehouses")} value={stats.warehouses} />
        <Kpi label={t("warehouses.kpis.active")} value={stats.active} tone="emerald" />
        <Kpi label={t("warehouses.kpis.branches")} value={stats.branch} tone="blue" />
        <Kpi label={t("warehouses.kpis.valuation")} value={formatCurrency(stats.value)} tone="violet" />
      </div>

      <div className="rounded-3xl border border-white/10 bg-zinc-950/90 p-4 shadow-2xl shadow-black/10">
        <div className="relative">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("warehouses.searchPlaceholder")}
            className="w-full rounded-2xl border border-white/10 bg-white/5 py-3 pl-11 pr-4 text-sm text-white outline-none placeholder:text-zinc-500"
          />
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {loading ? (
            Array.from({ length: 6 }).map((_, index) => <div key={index} className="h-40 animate-pulse rounded-3xl border border-white/10 bg-white/5" />)
          ) : filtered.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-white/10 bg-white/5 p-10 text-center">
              <Warehouse className="mx-auto h-12 w-12 text-zinc-500" />
              <h3 className="mt-4 text-xl font-black text-white">{t("warehouses.empty.title")}</h3>
              <p className="mt-2 text-sm text-zinc-400">{t("warehouses.empty.subtitle")}</p>
            </div>
          ) : (
            filtered.map((warehouse) => (
              <div key={String(warehouse.id)} className="rounded-3xl border border-white/10 bg-white/5 p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-semibold text-white">{warehouse.name}</div>
                    <div className="mt-1 text-xs text-zinc-500">{warehouse.location || "n/a"}</div>
                  </div>
                  <StatusBadge value={warehouse.status || "Active"} />
                </div>
                <div className="mt-4 space-y-2 text-sm text-zinc-300">
                  <div>{t("warehouses.row.branch")}: {warehouse.branch || "n/a"}</div>
                  <div>{t("warehouses.row.inventoryOverview")}</div>
                </div>
                <div className="mt-4 flex items-center justify-between">
                  <span className="text-xs text-zinc-500">{t("warehouses.row.id")} {warehouse.id}</span>
                  <Link to="/stock-transfers" className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold text-white">
                    <ArrowRightLeft className="h-4 w-4" />
                    {t("warehouses.buttons.transfer")}
                  </Link>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </InventoryShell>
  );
}

function Kpi({ label, value, tone = "zinc" }) {
  const classes = {
    emerald: "border-emerald-500/20 bg-emerald-500/10 text-emerald-300",
    blue: "border-blue-500/20 bg-blue-500/10 text-blue-300",
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

export default WarehousesDashboard;
