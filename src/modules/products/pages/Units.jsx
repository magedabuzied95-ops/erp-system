import { useState } from "react";

import { Boxes, Plus, Search, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import ProductsShell from "../components/ProductsShell";
import { Pagination } from "../../../shared/ui";

import { saveUnits, seedUnits, slugify } from "../lib/catalog";

function Units() {
  const { t } = useTranslation();
  const [items, setItems] = useState(() => seedUnits());
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("active");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const filtered = items.filter((item) =>
    `${item.name} ${item.symbol}`.toLowerCase().includes(search.trim().toLowerCase())
  );
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const visibleItems = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const handleCreate = () => {
    if (!name.trim()) return;
    const next = [
      ...items,
      {
        id: `unit-${slugify(name)}-${Date.now()}`,
        name: name.trim(),
        symbol: symbol.trim() || name.slice(0, 3).toLowerCase(),
        status,
      },
    ];
    setItems(next);
    saveUnits(next);
    setName("");
    setSymbol("");
    setStatus("active");
  };

  const handleDelete = (id) => {
    const next = items.filter((item) => item.id !== id);
    setItems(next);
    saveUnits(next);
  };

  return (
    <ProductsShell
      title={t("products.units.title")}
      description={t("products.units.description")}
    >
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <section className="rounded-[34px] border border-white/8 bg-zinc-950/80 p-6 xl:col-span-4">
          <div className="flex items-center gap-3">
            <Boxes className="text-amber-400" />
            <h2 className="m1-section-title text-white">{t("products.units.editor")}</h2>
          </div>

          <div className="mt-5 space-y-4">
            <div className="relative">
              <Search className="pointer-events-none absolute start-4 top-1/2 -translate-y-1/2 text-zinc-500" size={18} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("products.units.searchPlaceholder")}
                className="w-full rounded-[var(--radius-control)] border border-white/8 bg-white/5 py-3 ps-11 pe-4 text-white outline-none placeholder:text-zinc-500"
              />
            </div>

            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("products.units.namePlaceholder")}
              className="w-full rounded-[var(--radius-control)] border border-white/8 bg-white/5 px-4 py-3 text-white outline-none placeholder:text-zinc-500"
            />

            <input
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              placeholder={t("products.units.symbolPlaceholder")}
              className="w-full rounded-[var(--radius-control)] border border-white/8 bg-white/5 px-4 py-3 text-white outline-none placeholder:text-zinc-500"
            />

            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="w-full rounded-[var(--radius-control)] border border-white/8 bg-white/5 px-4 py-3 text-white outline-none"
            >
              <option value="active">{t("products.statusLabels.active")}</option>
              <option value="inactive">{t("products.statusLabels.inactive")}</option>
            </select>

            <button
              onClick={handleCreate}
              className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-3 font-semibold text-[var(--primary-contrast)]"
            >
              <Plus size={18} />
              {t("products.units.saveUnit")}
            </button>
          </div>
        </section>

        <section className="rounded-[34px] border border-white/8 bg-zinc-950/80 p-6 xl:col-span-8">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="m1-section-title text-white">{t("products.units.management")}</h2>
              <p className="mt-1 text-sm text-zinc-500">{t("products.units.managementDescription")}</p>
            </div>
            <div className="rounded-full border border-white/8 bg-white/5 px-4 py-2 text-sm font-semibold text-zinc-300">
              {t("products.units.count", { count: items.length })}
            </div>
          </div>

          <div className="m1-table-container mt-6 overflow-x-auto">
            <table className="m1-table m1-table--compact m1-table--separate min-w-full border-separate">
              <thead>
                <tr className="text-left text-xs uppercase tracking-[0.22em] text-zinc-500">
                  <th className="px-4 py-2">{t("products.units.unit")}</th>
                  <th className="px-4 py-2">{t("products.units.symbol")}</th>
                  <th className="px-4 py-2">{t("products.table.status")}</th>
                  <th className="px-4 py-2 text-right">{t("products.units.action")}</th>
                </tr>
              </thead>
              <tbody>
                {visibleItems.map((item) => (
                  <tr key={item.id} className="rounded-[var(--radius-card)] border border-white/8 bg-white/5">
                    <td className="px-4 py-4 font-semibold text-white">{item.name}</td>
                    <td className="px-4 py-4 text-zinc-300">{item.symbol}</td>
                    <td className="px-4 py-4">
                      <span
                        className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${item.status === "active" ? "bg-emerald-500/15 text-emerald-300" : "bg-zinc-500/15 text-zinc-300"}`}
                      >
                        {item.status}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-right">
                      <button
                        onClick={() => handleDelete(item.id)}
                        className="inline-flex items-center gap-2 rounded-full border border-white/8 bg-white/5 px-4 py-2 text-sm font-semibold text-red-300"
                      >
                        <Trash2 size={16} />
                        {t("products.units.remove")}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            page={currentPage}
            pages={totalPages}
            total={filtered.length}
            pageSize={pageSize}
            visible={visibleItems.length}
            onChange={setPage}
            onPageSizeChange={(value) => { setPageSize(value); setPage(1); }}
          />
        </section>
      </div>
    </ProductsShell>
  );
}

export default Units;
