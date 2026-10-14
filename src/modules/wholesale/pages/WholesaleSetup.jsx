import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Plus, Save, Search, Star, Trash2 } from "lucide-react";
import toast from "react-hot-toast";
import { api } from "../../../shared/api/api";
import ThemedSelect from "../../../shared/ui/ThemedSelect";

// Wholesale-only: price lists, how each product is sold in bulk (series / cartons) and
// the piece price per unit and list, and which list each customer buys on.

const cardClass = "rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-4";
const inputClass = "h-[var(--control-height-md)] min-w-0 rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--card)] px-3 text-sm font-bold text-[var(--text)] outline-none focus:border-[var(--border-strong)]";
const ghostButton = "inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm font-black text-[var(--text)] hover:border-[var(--border-strong)] hover:bg-[var(--table-hover)] disabled:opacity-60";
const primaryButton = "inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] bg-primary px-3 py-2 text-sm font-black text-[var(--primary-contrast)] disabled:opacity-60";
const chipClass = (on) => `rounded-full border px-3 py-1 text-sm font-black ${on ? "border-primary bg-primary text-[var(--primary-contrast)]" : "border-[var(--border)] bg-[var(--card)] text-[var(--text)]"}`;

const UNITS = ["piece", "series", "carton"];
const COLOR_COUNTS = [1, 2, 3, 4, 5, 6];

function PriceLists({ lists, reload }) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const run = async (fn) => {
    setBusy(true);
    try {
      await fn();
      await reload();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={cardClass}>
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!name.trim()) return;
          run(async () => {
            await api.post("/wholesale/price-lists", { name, is_default: lists.length === 0, sort_order: lists.length });
            setName("");
          });
        }}
      >
        <input className={`${inputClass} flex-1`} value={name} onChange={(e) => setName(e.target.value)} placeholder={t("orders.wholesale.setup.lists.namePlaceholder")} />
        <button type="submit" className={primaryButton} disabled={busy || !name.trim()}>
          <Plus size={16} /> {t("orders.wholesale.common.add")}
        </button>
      </form>
      {!lists.length ? (
        <p className="mt-4 text-sm font-bold text-[var(--muted)]">{t("orders.wholesale.setup.lists.empty")}</p>
      ) : (
        <ul className="mt-4 divide-y divide-[var(--border)]">
          {lists.map((list) => (
            <li key={list.id} className="flex flex-wrap items-center gap-2 py-3">
              <span className="flex-1 text-base font-black text-[var(--text)]">{list.name}</span>
              {list.is_default ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/40 bg-emerald-400/10 px-2 py-0.5 text-xs font-black text-emerald-500">
                  <Star size={12} /> {t("orders.wholesale.setup.lists.default")}
                </span>
              ) : (
                <button type="button" className={ghostButton} disabled={busy} onClick={() => run(() => api.put(`/wholesale/price-lists/${list.id}`, { ...list, is_default: true }))}>
                  {t("orders.wholesale.setup.lists.makeDefault")}
                </button>
              )}
              <button
                type="button"
                className={ghostButton}
                disabled={busy}
                onClick={() => {
                  if (!window.confirm(t("orders.wholesale.setup.lists.deleteConfirm", { name: list.name }))) return;
                  run(() => api.delete(`/wholesale/price-lists/${list.id}`));
                }}
              >
                <Trash2 size={16} /> {t("orders.wholesale.common.delete")}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const emptyCarton = () => ({ key: "", label: "", pieces: "", colors: 1, sizes: null });

function ProductEditor({ productId, lists, onSaved }) {
  const { t } = useTranslation();
  const [data, setData] = useState(null);
  const [series, setSeries] = useState([]);
  const [sellPiece, setSellPiece] = useState(true);
  const [cartons, setCartons] = useState([]);
  const [prices, setPrices] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    api.get(`/wholesale/products/${productId}`)
      .then((res) => {
        if (cancelled) return;
        const d = res.data;
        setData(d);
        setSeries(d.pack?.series_sizes || []);
        setSellPiece(d.pack ? d.pack.sell_piece !== false : true);
        setCartons((d.pack?.cartons || []).map((c) => ({ ...c, pieces: String(c.pieces) })));
        setPrices(Object.fromEntries(d.prices.map((p) => [`${p.price_list_id}|${p.unit}`, String(p.piece_price)])));
      })
      .catch((error) => toast.error(error.message));
    return () => { cancelled = true; };
  }, [productId]);

  if (!data) return <div className={`${cardClass} flex items-center gap-2 text-sm font-bold text-[var(--muted)]`}><Loader2 size={16} className="animate-spin" /> {t("orders.wholesale.common.loading")}</div>;

  const toggleSize = (size) => setSeries((current) => (current.includes(size) ? current.filter((s) => s !== size) : data.sizes.filter((s) => current.includes(s) || s === size)));
  const updateCarton = (index, patch) => setCartons((current) => current.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  const needsSplit = (carton) => {
    const pieces = Number(carton.pieces) || 0;
    const colors = Number(carton.colors) || 1;
    const per = pieces / colors;
    return pieces > 0 && Number.isInteger(per) && (!series.length || per % series.length !== 0);
  };

  const save = async () => {
    setSaving(true);
    try {
      const pack = {
        series_sizes: series,
        sell_piece: sellPiece,
        cartons: cartons.map((c) => ({
          key: c.key || undefined,
          label: c.label || undefined,
          pieces: Number(c.pieces),
          colors: Number(c.colors) || 1,
          sizes: needsSplit(c) ? c.sizes || {} : undefined,
        })),
      };
      const priceRows = Object.entries(prices)
        .filter(([, value]) => String(value).trim() !== "")
        .map(([k, value]) => {
          const [price_list_id, unit] = k.split("|");
          return { price_list_id: Number(price_list_id), unit, piece_price: Number(value) };
        });
      const res = await api.put(`/wholesale/products/${productId}`, { pack, prices: priceRows });
      setData(res.data);
      setCartons((res.data.pack?.cartons || []).map((c) => ({ ...c, pieces: String(c.pieces) })));
      toast.success(t("orders.wholesale.common.saved"));
      onSaved?.();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSaving(false);
    }
  };

  const unitsOffered = UNITS.filter((unit) => (unit === "piece" ? sellPiece : unit === "series" ? series.length > 0 : cartons.length > 0));

  return (
    <div className="grid min-w-0 gap-4">
      <div className={cardClass}>
        <h3 className="text-lg font-black text-[var(--text)]">{data.product.name}</h3>
        <p className="mt-1 text-sm font-bold text-[var(--muted)]">{data.colors.join(" · ")}</p>
      </div>

      <div className={cardClass}>
        <h4 className="font-black text-[var(--text)]">{t("orders.wholesale.setup.products.seriesTitle")}</h4>
        <p className="mt-1 text-sm font-bold text-[var(--muted)]">{t("orders.wholesale.setup.products.seriesHint")}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {data.sizes.map((size) => (
            <button key={size} type="button" className={chipClass(series.includes(size))} onClick={() => toggleSize(size)}>{size}</button>
          ))}
        </div>
        {series.length ? <p className="mt-2 text-sm font-black text-[var(--text)]">{t("orders.wholesale.setup.products.seriesCount", { count: series.length })}</p> : null}
        <label className="mt-3 flex items-center gap-2 text-sm font-black text-[var(--text)]">
          <input type="checkbox" checked={sellPiece} onChange={(e) => setSellPiece(e.target.checked)} />
          {t("orders.wholesale.setup.products.sellPiece")}
        </label>
      </div>

      <div className={cardClass}>
        <div className="flex items-center justify-between gap-2">
          <h4 className="font-black text-[var(--text)]">{t("orders.wholesale.setup.products.cartonsTitle")}</h4>
          <button type="button" className={ghostButton} onClick={() => setCartons((c) => [...c, emptyCarton()])}>
            <Plus size={16} /> {t("orders.wholesale.setup.products.addCarton")}
          </button>
        </div>
        <div className="mt-3 grid gap-3">
          {cartons.map((carton, index) => {
            const per = (Number(carton.pieces) || 0) / (Number(carton.colors) || 1);
            return (
              <div key={index} className="rounded-[var(--radius-control)] border border-[var(--border)] p-3">
                <div className="flex flex-wrap items-end gap-2">
                  <label className="grid gap-1 text-xs font-black text-[var(--muted)]">
                    {t("orders.wholesale.setup.products.cartonPieces")}
                    <input className={`${inputClass} w-24`} inputMode="numeric" value={carton.pieces} onChange={(e) => updateCarton(index, { pieces: e.target.value.replace(/[^\d]/g, "") })} />
                  </label>
                  <label className="grid gap-1 text-xs font-black text-[var(--muted)]">
                    {t("orders.wholesale.setup.products.cartonColors")}
                    <ThemedSelect
                      value={String(carton.colors)}
                      onChange={(value) => updateCarton(index, { colors: Number(value) })}
                      options={COLOR_COUNTS.map((n) => ({ value: String(n), label: String(n) }))}
                      className="w-24"
                    />
                  </label>
                  <label className="grid min-w-[10rem] flex-1 gap-1 text-xs font-black text-[var(--muted)]">
                    {t("orders.wholesale.setup.products.cartonLabel")}
                    <input className={inputClass} value={carton.label || ""} onChange={(e) => updateCarton(index, { label: e.target.value })} />
                  </label>
                  <button type="button" className={ghostButton} onClick={() => setCartons((c) => c.filter((_, i) => i !== index))}>
                    <Trash2 size={16} />
                  </button>
                </div>
                {needsSplit(carton) ? (
                  <div className="mt-3">
                    <p className="text-xs font-black text-[var(--muted)]">{t("orders.wholesale.setup.products.cartonSplitHint", { per })}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {data.sizes.map((size) => (
                        <label key={size} className="grid gap-1 text-center text-xs font-black text-[var(--muted)]">
                          {size}
                          <input
                            className={`${inputClass} w-14 text-center`}
                            inputMode="numeric"
                            value={carton.sizes?.[size] ?? ""}
                            onChange={(e) => updateCarton(index, { sizes: { ...(carton.sizes || {}), [size]: e.target.value.replace(/[^\d]/g, "") } })}
                          />
                        </label>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      <div className={cardClass}>
        <h4 className="font-black text-[var(--text)]">{t("orders.wholesale.setup.products.pricesTitle")}</h4>
        <p className="mt-1 text-sm font-bold text-[var(--muted)]">{t("orders.wholesale.setup.products.pricesHint")}</p>
        {!lists.length ? (
          <p className="mt-3 text-sm font-black text-amber-500">{t("orders.wholesale.setup.products.noLists")}</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[var(--muted)]">
                  <th className="p-2 text-start font-black">{t("orders.wholesale.setup.products.list")}</th>
                  {unitsOffered.map((unit) => <th key={unit} className="p-2 text-start font-black">{t(`orders.wholesale.units.${unit}`)}</th>)}
                </tr>
              </thead>
              <tbody>
                {lists.map((list) => (
                  <tr key={list.id} className="border-t border-[var(--border)]">
                    <td className="p-2 font-black text-[var(--text)]">{list.name}</td>
                    {unitsOffered.map((unit) => (
                      <td key={unit} className="p-2">
                        <input
                          className={`${inputClass} w-28`}
                          inputMode="decimal"
                          value={prices[`${list.id}|${unit}`] ?? ""}
                          onChange={(e) => setPrices((p) => ({ ...p, [`${list.id}|${unit}`]: e.target.value.replace(/[^\d.]/g, "") }))}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {Object.keys(data.available?.series || {}).length ? (
        <div className={cardClass}>
          <h4 className="font-black text-[var(--text)]">{t("orders.wholesale.setup.products.available")}</h4>
          <div className="mt-2 flex flex-wrap gap-2">
            {Object.entries(data.available.series).map(([color, count]) => (
              <span key={color} className="rounded-full border border-[var(--border)] px-3 py-1 text-sm font-black text-[var(--text)]">
                {t("orders.wholesale.setup.products.availableSeries", { color, count })}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      <div className="flex justify-end">
        <button type="button" className={primaryButton} disabled={saving} onClick={save}>
          {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
          {saving ? t("orders.wholesale.common.saving") : t("orders.wholesale.common.save")}
        </button>
      </div>
    </div>
  );
}

function Products({ lists }) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(null);

  const load = useCallback(async (term) => {
    setLoading(true);
    try {
      const res = await api.get("/wholesale/products", { params: { search: term } });
      setRows(res.data || []);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const id = setTimeout(() => load(search), 250);
    return () => clearTimeout(id);
  }, [search, load]);

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,300px)_minmax(0,1fr)]">
      <div className={cardClass}>
        <div className="relative">
          <Search size={16} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
          <input className={`${inputClass} w-full ps-9`} value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("orders.wholesale.setup.products.searchPlaceholder")} />
        </div>
        <ul className="mt-3 max-h-[35vh] xl:max-h-[60vh] divide-y divide-[var(--border)] overflow-y-auto">
          {loading && !rows.length ? <li className="py-3 text-sm font-bold text-[var(--muted)]">{t("orders.wholesale.common.loading")}</li> : null}
          {!loading && !rows.length ? <li className="py-3 text-sm font-bold text-[var(--muted)]">{t("orders.wholesale.common.none")}</li> : null}
          {rows.map((row) => (
            <li key={row.id}>
              <button type="button" onClick={() => setSelected(row.id)} className={`flex w-full items-center gap-2 py-2 text-start ${selected === row.id ? "text-primary" : "text-[var(--text)]"}`}>
                <span className="flex-1 text-sm font-black">{row.name}</span>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-black ${row.has_pack && row.price_count ? "bg-emerald-400/10 text-emerald-500" : "bg-amber-400/10 text-amber-500"}`}>
                  {row.has_pack && row.price_count ? t("orders.wholesale.setup.products.configured") : t("orders.wholesale.setup.products.notConfigured")}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      {selected ? (
        <ProductEditor key={selected} productId={selected} lists={lists} onSaved={() => load(search)} />
      ) : (
        <div className={`${cardClass} text-sm font-bold text-[var(--muted)]`}>{t("orders.wholesale.setup.products.pick")}</div>
      )}
    </div>
  );
}

function CustomerRow({ customer, lists }) {
  const { t } = useTranslation();
  const [form, setForm] = useState({
    price_list_id: customer.price_list_id ? String(customer.price_list_id) : "",
    credit_limit: String(customer.credit_limit || 0),
    due_days: String(customer.due_days || 0),
  });
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await api.put(`/wholesale/customers/${customer.id}/terms`, {
        price_list_id: form.price_list_id ? Number(form.price_list_id) : null,
        credit_limit: Number(form.credit_limit) || 0,
        due_days: Number(form.due_days) || 0,
      });
      toast.success(t("orders.wholesale.common.saved"));
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="grid gap-2 py-3 md:grid-cols-[minmax(0,1fr)_180px_130px_110px_auto] md:items-end">
      <div>
        <div className="text-sm font-black text-[var(--text)]">{customer.name}</div>
        <div className="text-xs font-bold text-[var(--muted)]" dir="ltr">{customer.phone}</div>
      </div>
      <label className="grid gap-1 text-xs font-black text-[var(--muted)]">
        {t("orders.wholesale.setup.customers.priceList")}
        <ThemedSelect
          value={form.price_list_id}
          onChange={(value) => setForm((f) => ({ ...f, price_list_id: value }))}
          options={[{ value: "", label: t("orders.wholesale.setup.customers.defaultList") }, ...lists.map((l) => ({ value: String(l.id), label: l.name }))]}
        />
      </label>
      <label className="grid gap-1 text-xs font-black text-[var(--muted)]" title={t("orders.wholesale.setup.customers.noLimit")}>
        {t("orders.wholesale.setup.customers.creditLimit")}
        <input className={inputClass} inputMode="decimal" value={form.credit_limit} onChange={(e) => setForm((f) => ({ ...f, credit_limit: e.target.value.replace(/[^\d.]/g, "") }))} />
      </label>
      <label className="grid gap-1 text-xs font-black text-[var(--muted)]">
        {t("orders.wholesale.setup.customers.dueDays")}
        <input className={inputClass} inputMode="numeric" value={form.due_days} onChange={(e) => setForm((f) => ({ ...f, due_days: e.target.value.replace(/[^\d]/g, "") }))} />
      </label>
      <button type="button" className={primaryButton} disabled={busy} onClick={save}>
        <Save size={16} /> {t("orders.wholesale.common.save")}
      </button>
    </li>
  );
}

function Customers({ lists }) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState([]);

  useEffect(() => {
    const id = setTimeout(() => {
      api.get("/wholesale/customers", { params: { search } })
        .then((res) => setRows(res.data || []))
        .catch((error) => toast.error(error.message));
    }, 250);
    return () => clearTimeout(id);
  }, [search]);

  return (
    <div className={cardClass}>
      <div className="relative">
        <Search size={16} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
        <input className={`${inputClass} w-full ps-9`} value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("orders.wholesale.setup.customers.searchPlaceholder")} />
      </div>
      <ul className="mt-2 divide-y divide-[var(--border)]">
        {rows.map((customer) => <CustomerRow key={customer.id} customer={customer} lists={lists} />)}
        {!rows.length ? <li className="py-3 text-sm font-bold text-[var(--muted)]">{t("orders.wholesale.common.none")}</li> : null}
      </ul>
    </div>
  );
}

export default function WholesaleSetup() {
  const { t } = useTranslation();
  const [tab, setTab] = useState("lists");
  const [lists, setLists] = useState([]);

  const reload = useCallback(async () => {
    try {
      const res = await api.get("/wholesale/price-lists");
      setLists(res.data || []);
    } catch (error) {
      toast.error(error.message);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const tabs = useMemo(() => ["lists", "products", "customers"], []);

  return (
    <div className="mx-auto grid max-w-6xl gap-4 p-4">
      <header>
        <h1 className="text-2xl font-black text-[var(--text)]">{t("orders.wholesale.setup.title")}</h1>
        <p className="mt-1 text-sm font-bold text-[var(--muted)]">{t("orders.wholesale.setup.subtitle")}</p>
      </header>
      <div className="flex flex-wrap gap-2">
        {tabs.map((key) => (
          <button key={key} type="button" className={chipClass(tab === key)} onClick={() => setTab(key)}>
            {t(`orders.wholesale.setup.tabs.${key}`)}
          </button>
        ))}
      </div>
      {tab === "lists" ? <PriceLists lists={lists} reload={reload} /> : null}
      {tab === "products" ? <Products lists={lists} /> : null}
      {tab === "customers" ? <Customers lists={lists} /> : null}
    </div>
  );
}
