import { useState } from "react";

import { Boxes, Plus, Search, Trash2 } from "lucide-react";

import ProductsShell from "../components/ProductsShell";

import { saveUnits, seedUnits, slugify } from "../lib/catalog";

function Units() {
  const [items, setItems] = useState(() => seedUnits());
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("active");

  const filtered = items.filter((item) =>
    `${item.name} ${item.symbol}`.toLowerCase().includes(search.trim().toLowerCase())
  );

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
      title="Units"
      description="Manage unit definitions for inventory, pricing, and product conversion logic."
    >
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <section className="rounded-[34px] border border-white/8 bg-zinc-950/80 p-6 xl:col-span-4">
          <div className="flex items-center gap-3">
            <Boxes className="text-amber-400" />
            <h2 className="text-2xl font-black text-white">Unit editor</h2>
          </div>

          <div className="mt-5 space-y-4">
            <div className="relative">
              <Search className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500" size={18} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search units..."
                className="w-full rounded-2xl border border-white/8 bg-white/5 py-3 pl-11 pr-4 text-white outline-none placeholder:text-zinc-500"
              />
            </div>

            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Unit name"
              className="w-full rounded-2xl border border-white/8 bg-white/5 px-4 py-3 text-white outline-none placeholder:text-zinc-500"
            />

            <input
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              placeholder="Symbol"
              className="w-full rounded-2xl border border-white/8 bg-white/5 px-4 py-3 text-white outline-none placeholder:text-zinc-500"
            />

            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="w-full rounded-2xl border border-white/8 bg-white/5 px-4 py-3 text-white outline-none"
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>

            <button
              onClick={handleCreate}
              className="inline-flex items-center gap-2 rounded-full bg-emerald-500 px-5 py-3 font-semibold text-white"
            >
              <Plus size={18} />
              Save unit
            </button>
          </div>
        </section>

        <section className="rounded-[34px] border border-white/8 bg-zinc-950/80 p-6 xl:col-span-8">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-2xl font-black text-white">Unit management</h2>
              <p className="mt-1 text-sm text-zinc-500">Use these units across products and conversion settings.</p>
            </div>
            <div className="rounded-full border border-white/8 bg-white/5 px-4 py-2 text-sm font-semibold text-zinc-300">
              {items.length} units
            </div>
          </div>

          <div className="mt-6 overflow-x-auto">
            <table className="min-w-full border-separate border-spacing-y-3">
              <thead>
                <tr className="text-left text-xs uppercase tracking-[0.22em] text-zinc-500">
                  <th className="px-4 py-2">Unit</th>
                  <th className="px-4 py-2">Symbol</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => (
                  <tr key={item.id} className="rounded-3xl border border-white/8 bg-white/5">
                    <td className="px-4 py-4 font-semibold text-white">{item.name}</td>
                    <td className="px-4 py-4 text-zinc-300">{item.symbol}</td>
                    <td className="px-4 py-4">
                      <span
                        className={`
                          inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold
                          ${item.status === "active" ? "bg-emerald-500/15 text-emerald-300" : "bg-zinc-500/15 text-zinc-300"}
                        `}
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
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </ProductsShell>
  );
}

export default Units;
