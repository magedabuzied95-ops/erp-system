import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { AlertTriangle, Loader2, Plus, Search, Trash2 } from "lucide-react";
import toast from "react-hot-toast";
import { api } from "../../../shared/api/api";
import ThemedSelect from "../../../shared/ui/ThemedSelect";

// Wholesale sale: lines by piece / series / carton, priced by the server from the
// customer's price list, saved through the same order path as the POS (the open shift,
// the salesperson, stock and credit sale all behave exactly as they do there).

const cardClass = "rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-4";
const inputClass = "h-[var(--control-height-md)] min-w-0 rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--card)] px-3 text-sm font-bold text-[var(--text)] outline-none focus:border-[var(--border-strong)]";
const ghostButton = "inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm font-black text-[var(--text)] hover:border-[var(--border-strong)] hover:bg-[var(--table-hover)] disabled:opacity-60";
const primaryButton = "inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] bg-primary px-4 py-2 text-sm font-black text-[var(--primary-contrast)] disabled:opacity-60";
const chipClass = (on) => `rounded-full border px-3 py-1 text-sm font-black ${on ? "border-primary bg-primary text-[var(--primary-contrast)]" : "border-[var(--border)] bg-[var(--card)] text-[var(--text)]"}`;
const money = (value) => Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
const newKey = () => `wholesale-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

function SearchPicker({ endpoint, placeholder, render, onPick, selectedLabel }) {
  const { t } = useTranslation();
  const [term, setTerm] = useState("");
  const [rows, setRows] = useState([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    const id = setTimeout(() => {
      api.get(endpoint, { params: { search: term, limit: 20 } })
        .then((res) => setRows(res.data || []))
        .catch(() => setRows([]));
    }, 200);
    return () => clearTimeout(id);
  }, [endpoint, term, open]);

  return (
    <div className="relative">
      <Search size={16} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
      <input
        className={`${inputClass} w-full ps-9`}
        value={open ? term : selectedLabel || term}
        placeholder={placeholder}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => { setTerm(e.target.value); setOpen(true); }}
      />
      {open ? (
        <ul className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)] shadow-lg">
          {!rows.length ? <li className="px-3 py-2 text-sm font-bold text-[var(--muted)]">{t("orders.wholesale.common.none")}</li> : null}
          {rows.map((row) => (
            <li key={row.id}>
              <button type="button" className="w-full px-3 py-2 text-start hover:bg-[var(--table-hover)]" onMouseDown={(e) => e.preventDefault()} onClick={() => { onPick(row); setOpen(false); setTerm(""); }}>
                {render(row)}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function LineBuilder({ onAdd }) {
  const { t } = useTranslation();
  const [product, setProduct] = useState(null);
  const [unit, setUnit] = useState("series");
  const [qty, setQty] = useState("1");
  const [color, setColor] = useState("");
  const [size, setSize] = useState("");
  const [cartonKey, setCartonKey] = useState("");
  const [colors, setColors] = useState([]);

  const pick = async (row) => {
    try {
      const res = await api.get(`/wholesale/products/${row.id}`);
      const d = res.data;
      setProduct(d);
      const pack = d.pack || { series_sizes: [], sell_piece: true, cartons: [] };
      setUnit(pack.cartons.length ? "carton" : pack.series_sizes.length ? "series" : "piece");
      setCartonKey(pack.cartons[0]?.key || "");
      setColor(d.colors[0] || "");
      setSize(d.sizes[0] || "");
      setColors([]);
      setQty("1");
    } catch (error) {
      toast.error(error.message);
    }
  };

  const pack = product?.pack || { series_sizes: [], sell_piece: true, cartons: [] };
  const units = ["piece", "series", "carton"].filter((u) => (u === "piece" ? pack.sell_piece : u === "series" ? pack.series_sizes.length : pack.cartons.length));
  const carton = pack.cartons.find((c) => c.key === cartonKey);

  const add = () => {
    const quantity = Number(qty);
    if (!product || !Number.isInteger(quantity) || quantity <= 0) return;
    const line = { product_id: product.product.id, product_name: product.product.name, unit, qty: quantity };
    if (unit === "piece") Object.assign(line, { color, size });
    if (unit === "series") Object.assign(line, { color });
    if (unit === "carton") Object.assign(line, { carton_key: cartonKey, colors });
    onAdd(line);
    setColors([]);
    setQty("1");
  };

  return (
    <div className={cardClass}>
      <div className="grid gap-3">
        <SearchPicker
          endpoint="/wholesale/products"
          placeholder={t("orders.wholesale.invoice.productPlaceholder")}
          selectedLabel={product?.product?.name || ""}
          onPick={pick}
          render={(row) => (
            <span className="flex items-center gap-2">
              <span className="flex-1 text-sm font-black text-[var(--text)]">{row.name}</span>
              <span className="text-xs font-bold text-[var(--muted)]">{row.stock} {t("orders.wholesale.common.pieces")}</span>
            </span>
          )}
        />
        {product && !units.length ? <p className="text-sm font-black text-amber-500">{t("orders.wholesale.invoice.noPack")}</p> : null}
        {product && units.length ? (
          <>
            <div className="flex flex-wrap gap-2">
              {units.map((u) => (
                <button key={u} type="button" className={chipClass(unit === u)} onClick={() => setUnit(u)}>{t(`orders.wholesale.units.${u}`)}</button>
              ))}
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <label className="grid gap-1 text-xs font-black text-[var(--muted)]">
                {t("orders.wholesale.common.qty")}
                <input className={`${inputClass} w-20`} inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value.replace(/[^\d]/g, ""))} />
              </label>
              {unit !== "carton" ? (
                <label className="grid gap-1 text-xs font-black text-[var(--muted)]">
                  {t("orders.wholesale.common.color")}
                  <ThemedSelect value={color} onChange={setColor} options={product.colors} className="min-w-36" />
                </label>
              ) : (
                <label className="grid gap-1 text-xs font-black text-[var(--muted)]">
                  {t("orders.wholesale.invoice.cartonType")}
                  <ThemedSelect value={cartonKey} onChange={(v) => { setCartonKey(v); setColors([]); }} options={pack.cartons.map((c) => ({ value: c.key, label: c.label }))} className="min-w-48" />
                </label>
              )}
              {unit === "piece" ? (
                <label className="grid gap-1 text-xs font-black text-[var(--muted)]">
                  {t("orders.wholesale.common.size")}
                  <ThemedSelect value={size} onChange={setSize} options={product.sizes} className="min-w-24" />
                </label>
              ) : null}
            </div>
            {unit === "carton" && carton ? (
              <div>
                <p className="text-xs font-black text-[var(--muted)]">{t("orders.wholesale.invoice.pickColors", { count: carton.colors })}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {product.colors.map((c) => {
                    const on = colors.includes(c);
                    return (
                      <button
                        key={c}
                        type="button"
                        className={chipClass(on)}
                        onClick={() => setColors((cur) => (on ? cur.filter((x) => x !== c) : cur.length < carton.colors ? [...cur, c] : cur))}
                      >
                        {c}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}
            <div className="flex justify-end">
              <button type="button" className={primaryButton} onClick={add} disabled={unit === "carton" && (!carton || colors.length !== carton.colors)}>
                <Plus size={16} /> {t("orders.wholesale.invoice.addLine")}
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

export default function WholesaleInvoice() {
  const { t } = useTranslation();
  const [shift, setShift] = useState(undefined);
  const [sellers, setSellers] = useState([]);
  const [sellerId, setSellerId] = useState("");
  const [customer, setCustomer] = useState(null);
  const [lines, setLines] = useState([]);
  const [preview, setPreview] = useState(null);
  const [previewError, setPreviewError] = useState("");
  const [mode, setMode] = useState("cash");
  const [method, setMethod] = useState("cash");
  const [paid, setPaid] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const idempotencyKey = useRef(newKey());

  useEffect(() => {
    api.get("/pos/shifts/active", { suppressErrorStatuses: [400, 404] })
      .then((res) => setShift(res?.shift || null))
      .catch(() => setShift(null));
  }, []);

  useEffect(() => {
    if (!shift?.branch_id) return;
    api.get("/pos/seller-users", { params: { branch_id: shift.branch_id } })
      .then((res) => {
        const rows = (Array.isArray(res?.users) ? res.users : []).map((u) => ({ value: String(u.employee_id || u.id), label: u.full_name || u.name || u.email }));
        setSellers(rows);
        if (rows.length === 1) setSellerId(rows[0].value);
      })
      .catch(() => setSellers([]));
  }, [shift?.branch_id]);

  const refreshPreview = useCallback(async (nextLines, nextCustomer) => {
    if (!nextLines.length) { setPreview(null); setPreviewError(""); return; }
    try {
      const res = await api.post("/wholesale/invoices/preview", { customer_id: nextCustomer?.id || null, lines: nextLines });
      setPreview(res.data);
      setPreviewError("");
    } catch (error) {
      setPreview(null);
      setPreviewError(error.message);
    }
  }, []);

  useEffect(() => { refreshPreview(lines, customer); }, [lines, customer, refreshPreview]);

  const total = preview?.total || 0;
  const paidNumber = mode === "cash" ? total : mode === "credit" ? 0 : Number(paid) || 0;
  const remaining = Math.max(0, total - paidNumber);
  const canSave = Boolean(
    shift?.id && preview && !preview.shortages?.length && lines.length && sellerId
      && (mode === "cash" || customer) && (mode !== "partial" || (paidNumber > 0 && paidNumber < total))
  );

  const submit = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const res = await api.post("/wholesale/invoices", {
        customer_id: customer?.id || null,
        customer_name: customer?.name || "",
        customer_phone: customer?.phone || "",
        lines,
        branch_id: shift.branch_id,
        shift_id: shift.id,
        sales_employee_id: Number(sellerId),
        payment: { mode, method, paid_amount: paidNumber },
        notes,
        idempotency_key: idempotencyKey.current,
      });
      toast.success(t("orders.wholesale.invoice.done", { number: res.data?.invoice_number || res.data?.order_id }));
      idempotencyKey.current = newKey();
      setLines([]);
      setPaid("");
      setNotes("");
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSaving(false);
    }
  };

  const shortageText = useMemo(() => (preview?.shortages || []).map((s) => t("orders.wholesale.invoice.shortage", s)), [preview, t]);

  if (shift === undefined) {
    return <div className="p-4 text-sm font-bold text-[var(--muted)]"><Loader2 size={16} className="me-2 inline animate-spin" />{t("orders.wholesale.common.loading")}</div>;
  }

  return (
    <div className="mx-auto grid max-w-6xl gap-4 p-4">
      <header>
        <h1 className="text-2xl font-black text-[var(--text)]">{t("orders.wholesale.invoice.title")}</h1>
        <p className="mt-1 text-sm font-bold text-[var(--muted)]">{t("orders.wholesale.invoice.subtitle")}</p>
      </header>

      {!shift ? (
        <div className={`${cardClass} flex flex-wrap items-center gap-3`}>
          <AlertTriangle className="text-amber-500" size={18} />
          <span className="flex-1 text-sm font-black text-[var(--text)]">{t("orders.wholesale.invoice.noShift")}</span>
          <Link to="/pos" className={ghostButton}>{t("orders.wholesale.invoice.openPos")}</Link>
        </div>
      ) : null}

      <div className={`${cardClass} grid gap-3 md:grid-cols-2`}>
        <label className="grid gap-1 text-xs font-black text-[var(--muted)]">
          {t("orders.wholesale.invoice.customer")}
          <SearchPicker
            endpoint="/wholesale/customers"
            placeholder={t("orders.wholesale.invoice.customerPlaceholder")}
            selectedLabel={customer ? `${customer.name}${customer.price_list_name ? ` — ${customer.price_list_name}` : ""}` : ""}
            onPick={setCustomer}
            render={(row) => (
              <span className="flex items-center gap-2">
                <span className="flex-1 text-sm font-black text-[var(--text)]">{row.name}</span>
                <span className="text-xs font-bold text-[var(--muted)]" dir="ltr">{row.phone}</span>
                {row.price_list_name ? <span className="rounded-full bg-[var(--table-hover)] px-2 text-[11px] font-black text-[var(--text)]">{row.price_list_name}</span> : null}
              </span>
            )}
          />
          {customer ? (
            <button type="button" className="justify-self-start text-xs font-black text-[var(--muted)] underline" onClick={() => setCustomer(null)}>{t("orders.wholesale.invoice.walkIn")}</button>
          ) : null}
        </label>
        <label className="grid gap-1 text-xs font-black text-[var(--muted)]">
          {t("orders.wholesale.invoice.salesperson")}
          <ThemedSelect value={sellerId} onChange={setSellerId} options={sellers} placeholder="—" />
        </label>
      </div>

      <LineBuilder onAdd={(line) => setLines((cur) => [...cur, line])} />

      <div className={cardClass}>
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-black text-[var(--text)]">{t("orders.wholesale.invoice.lines")}</h3>
          {preview ? <span className="text-sm font-black text-[var(--muted)]">{t("orders.wholesale.invoice.priceList")}: {preview.price_list.name}</span> : null}
        </div>
        {!lines.length ? <p className="mt-3 text-sm font-bold text-[var(--muted)]">{t("orders.wholesale.invoice.empty")}</p> : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[var(--muted)]">
                  <th className="p-2 text-start font-black">{t("orders.wholesale.invoice.product")}</th>
                  <th className="p-2 text-start font-black">{t("orders.wholesale.invoice.unit")}</th>
                  <th className="p-2 text-start font-black">{t("orders.wholesale.common.colors")}</th>
                  <th className="p-2 text-start font-black">{t("orders.wholesale.common.pieces")}</th>
                  <th className="p-2 text-start font-black">{t("orders.wholesale.invoice.piecePrice")}</th>
                  <th className="p-2 text-start font-black">{t("orders.wholesale.common.total")}</th>
                  <th className="p-2" />
                </tr>
              </thead>
              <tbody>
                {lines.map((line, index) => {
                  const priced = preview?.lines?.[index];
                  return (
                    <tr key={index} className="border-t border-[var(--border)]">
                      <td className="p-2 font-black text-[var(--text)]">{line.product_name}</td>
                      <td className="p-2 font-bold text-[var(--text)]">{line.qty} × {priced?.unit_label || t(`orders.wholesale.units.${line.unit}`)}</td>
                      <td className="p-2 font-bold text-[var(--text)]">{(line.colors || [line.color]).filter(Boolean).join("، ")}{line.size ? ` / ${line.size}` : ""}</td>
                      <td className="p-2 font-bold text-[var(--text)]">{priced?.pieces ?? "—"}</td>
                      <td className="p-2 font-bold text-[var(--text)]">{priced ? money(priced.piece_price) : "—"}</td>
                      <td className="p-2 font-black text-[var(--text)]">{priced ? money(priced.line_total) : "—"}</td>
                      <td className="p-2">
                        <button type="button" className={ghostButton} aria-label={t("orders.wholesale.common.remove")} onClick={() => setLines((cur) => cur.filter((_, i) => i !== index))}>
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {previewError ? <p className="mt-3 text-sm font-black text-red-500">{previewError}</p> : null}
        {shortageText.map((line) => <p key={line} className="mt-2 text-sm font-black text-red-500">{line}</p>)}
        {preview ? (
          <div className="mt-4 flex flex-wrap items-baseline justify-end gap-4">
            <span className="text-sm font-bold text-[var(--muted)]">{t("orders.wholesale.invoice.piecesTotal", { count: preview.pieces })}</span>
            <span className="text-2xl font-black text-[var(--text)]">{money(total)} {t("orders.wholesale.common.egp")}</span>
          </div>
        ) : null}
      </div>

      <div className={`${cardClass} grid gap-3`}>
        <h3 className="font-black text-[var(--text)]">{t("orders.wholesale.invoice.payment")}</h3>
        <div className="flex flex-wrap gap-2">
          {["cash", "credit", "partial"].map((m) => (
            <button key={m} type="button" className={chipClass(mode === m)} onClick={() => setMode(m)} disabled={m !== "cash" && !customer}>
              {t(`orders.wholesale.invoice.modes.${m}`)}
            </button>
          ))}
        </div>
        {mode !== "credit" ? (
          <div className="flex flex-wrap items-end gap-3">
            <label className="grid gap-1 text-xs font-black text-[var(--muted)]">
              {t("orders.wholesale.invoice.payment")}
              <ThemedSelect value={method} onChange={setMethod} options={["cash", "instapay", "vodafone_cash", "card"].map((m) => ({ value: m, label: t(`orders.wholesale.invoice.methods.${m}`) }))} className="min-w-40" />
            </label>
            {mode === "partial" ? (
              <label className="grid gap-1 text-xs font-black text-[var(--muted)]">
                {t("orders.wholesale.invoice.paid")}
                <input className={`${inputClass} w-36`} inputMode="decimal" value={paid} onChange={(e) => setPaid(e.target.value.replace(/[^\d.]/g, ""))} />
              </label>
            ) : null}
          </div>
        ) : null}
        {mode !== "cash" && preview ? (
          <p className="text-sm font-black text-[var(--text)]">{t("orders.wholesale.invoice.remaining")}: {money(remaining)} {t("orders.wholesale.common.egp")}</p>
        ) : null}
        <label className="grid gap-1 text-xs font-black text-[var(--muted)]">
          {t("orders.wholesale.invoice.notes")}
          <input className={inputClass} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        <div className="flex justify-end">
          <button type="button" className={primaryButton} disabled={!canSave || saving} onClick={submit}>
            {saving ? <Loader2 size={16} className="animate-spin" /> : null}
            {t("orders.wholesale.invoice.submit")}
          </button>
        </div>
      </div>
    </div>
  );
}
