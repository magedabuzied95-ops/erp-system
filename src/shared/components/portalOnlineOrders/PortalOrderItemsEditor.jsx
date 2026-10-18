import { useEffect, useMemo, useRef, useState } from "react";
import { ImageOff, Loader2, Minus, Plus, Repeat, Search, Trash2, X } from "lucide-react";
import { resolveProductImageUrl } from "../../lib/imageUrls";

// What is inside an online order, edited in the manager portal's ⋮ → تعديل sheet:
// quantities, colour/size swaps, new products, removed lines, the unit price, the
// seller's discount and the shipping fee. Prices of added products come from the
// server search (the one customer-price authority); the server re-checks stock and
// re-prices the coupon when it saves (shipping.portal.items.js).

const text = (value = "") => String(value ?? "").trim();
const num = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
const round2 = (value) => Math.round(num(value) * 100) / 100;
let lineSeq = 0;
const newKey = () => `line-${Date.now().toString(36)}-${(lineSeq += 1)}`;

export const linesFromOrder = (order = {}) =>
  (Array.isArray(order.items) ? order.items : []).map((item) => ({
    key: `item-${item.id}`,
    order_item_id: item.id,
    product_id: item.product_id,
    variant_id: item.variant_id,
    product_name: text(item.product_name),
    color: text(item.color),
    size: text(item.size),
    image_url: text(item.image_url),
    quantity: Math.max(1, Math.trunc(num(item.quantity)) || 1),
    unit_price: round2(item.unit_price),
    original_quantity: Math.trunc(num(item.quantity)),
    stock: null,
  }));

export const moneyFromOrder = (order = {}) => ({
  discount: round2(order.money?.invoice_discount ?? Math.max(0, num(order.money?.discount) - num(order.money?.coupon_discount))),
  shipping: round2(order.money?.shipping_fee),
});

// Unchanged lines + money ⇒ nothing to send (the sheet then saves only the fields).
export const linesChanged = (order, lines, moneyState) => {
  const original = linesFromOrder(order);
  const originalMoney = moneyFromOrder(order);
  if (round2(moneyState.discount) !== originalMoney.discount || round2(moneyState.shipping) !== originalMoney.shipping) return true;
  if (original.length !== lines.length) return true;
  return lines.some((line, index) => {
    const before = original[index];
    return String(before.variant_id) !== String(line.variant_id)
      || before.quantity !== line.quantity
      || round2(before.unit_price) !== round2(line.unit_price);
  });
};

export const linesPayload = (lines) =>
  lines.map((line) => ({
    ...(line.order_item_id ? { order_item_id: line.order_item_id } : {}),
    variant_id: line.variant_id,
    quantity: line.quantity,
    unit_price: round2(line.unit_price),
  }));

function Thumb({ src }) {
  const [failed, setFailed] = useState(false);
  const url = src && !failed ? resolveProductImageUrl(src) : "";
  return (
    <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-[var(--radius-control)] border border-border bg-surface">
      {url ? <img src={url} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} className="h-full w-full object-cover" /> : <ImageOff className="h-5 w-5 text-text-muted" />}
    </div>
  );
}

const MoneyInput = ({ label, value, onChange }) => (
  <label className="flex items-center justify-between gap-3">
    <span className="text-xs font-black text-text-muted">{label}</span>
    <input
      type="number"
      inputMode="decimal"
      min="0"
      step="any"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      dir="ltr"
      className="h-9 w-28 rounded-[var(--radius-control)] border border-border bg-surface px-2 text-end text-sm font-black text-text"
    />
  </label>
);

// Colour chips, then that colour's sizes with their stock. `heldByVariant` is what
// the order already holds of a variant — it comes back on save, so it counts as stock.
function VariantPicker({ product, ui, heldByVariant, onPick }) {
  const colors = useMemo(() => {
    const seen = [];
    for (const variant of product.variants || []) {
      const key = variant.color || "-";
      if (!seen.includes(key)) seen.push(key);
    }
    return seen;
  }, [product]);
  const [color, setColor] = useState(colors.length === 1 ? colors[0] : "");
  const sizes = (product.variants || []).filter((variant) => (variant.color || "-") === color);
  return (
    <div className="space-y-2">
      {colors.length > 1 || (colors[0] && colors[0] !== "-") ? (
        <div>
          <div className="mb-1 text-[11px] font-black text-text-muted">{ui.tb("manage.pickColor")}</div>
          <div className="flex flex-wrap gap-1.5">
            {colors.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setColor(value)}
                aria-pressed={color === value}
                className={`min-h-[var(--control-height-sm)] rounded-[var(--radius-control)] border px-3 text-xs font-black ${color === value ? "border-primary bg-primary text-primary-foreground" : "border-border bg-surface text-text"}`}
              >
                <bdi>{value === "-" ? "—" : value}</bdi>
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {color ? (
        <div>
          <div className="mb-1 text-[11px] font-black text-text-muted">{ui.tb("manage.pickSize")}</div>
          <div className="flex flex-wrap gap-1.5">
            {sizes.map((variant) => {
              const available = num(variant.stock) + num(heldByVariant.get(String(variant.variant_id)));
              return (
                <button
                  key={variant.variant_id}
                  type="button"
                  disabled={available <= 0}
                  onClick={() => onPick(variant)}
                  className="flex min-w-[3.5rem] flex-col items-center rounded-[var(--radius-control)] border border-border bg-surface px-2 py-1 text-text disabled:opacity-40"
                >
                  <span className="text-sm font-black" dir="ltr">{variant.size || "—"}</span>
                  <span className="text-[10px] font-bold text-text-muted">{available > 0 ? ui.tb("manage.inStock", { count: ui.count(available) }) : ui.tb("manage.outOfStock")}</span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function AddProductPanel({ ui, searchProducts, heldByVariant, onAdd, onClose }) {
  const [query, setQuery] = useState("");
  const [state, setState] = useState({ loading: false, error: false, products: [] });
  const [chosen, setChosen] = useState(null);
  const requestRef = useRef(0);
  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) { setState({ loading: false, error: false, products: [] }); return undefined; }
    const id = (requestRef.current += 1);
    setState((current) => ({ ...current, loading: true, error: false }));
    const timer = window.setTimeout(() => {
      searchProducts({ q: term })
        .then((products) => { if (requestRef.current === id) setState({ loading: false, error: false, products }); })
        .catch(() => { if (requestRef.current === id) setState({ loading: false, error: true, products: [] }); });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [query, searchProducts]);

  return (
    <div className="space-y-2 rounded-[var(--radius-control)] border border-border bg-surface-soft p-2.5">
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
          <input
            type="search"
            autoFocus
            value={query}
            onChange={(event) => { setQuery(event.target.value); setChosen(null); }}
            placeholder={ui.tb("manage.searchPlaceholder")}
            dir="auto"
            className="min-h-[var(--control-height-md)] w-full rounded-[var(--radius-control)] border border-border bg-surface ps-8 pe-2 text-sm font-bold text-text"
          />
        </div>
        <button type="button" onClick={onClose} aria-label={ui.tb("manage.closePicker")} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-control)] border border-border bg-surface text-text">
          <X className="h-4 w-4" />
        </button>
      </div>
      {chosen ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Thumb src={chosen.image_url} />
            <div className="min-w-0 flex-1 text-sm font-black text-text"><bdi>{chosen.name}</bdi></div>
          </div>
          <VariantPicker product={chosen} ui={ui} heldByVariant={heldByVariant} onPick={(variant) => onAdd(chosen, variant)} />
        </div>
      ) : state.loading ? (
        <div className="flex items-center gap-2 px-1 py-2 text-xs font-bold text-text-muted"><Loader2 className="h-4 w-4 animate-spin" />{ui.tb("manage.searching")}</div>
      ) : state.error ? (
        <div className="px-1 py-2 text-xs font-bold text-danger">{ui.tb("manage.searchFailed")}</div>
      ) : query.trim().length >= 2 && !state.products.length ? (
        <div className="px-1 py-2 text-xs font-bold text-text-muted">{ui.tb("manage.noResults")}</div>
      ) : (
        <div className="space-y-1.5">
          {state.products.map((product) => {
            const prices = product.variants.map((variant) => num(variant.price)).filter((price) => price > 0);
            const stock = product.variants.reduce((sum, variant) => sum + num(variant.stock), 0);
            return (
              <button key={product.product_id} type="button" onClick={() => setChosen(product)} className="flex w-full items-center gap-2 rounded-[var(--radius-control)] border border-border bg-surface p-1.5 text-start">
                <Thumb src={product.image_url} />
                <div className="min-w-0 flex-1">
                  <div className="line-clamp-2 text-sm font-black leading-5 text-text"><bdi>{product.name}</bdi></div>
                  <div className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] font-bold text-text-muted">
                    {prices.length ? <span>{ui.money(Math.min(...prices))}</span> : null}
                    <span>{stock > 0 ? ui.tb("manage.inStock", { count: ui.count(stock) }) : ui.tb("manage.outOfStock")}</span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SwapPanel({ line, ui, searchProducts, heldByVariant, onPick, onClose }) {
  const [state, setState] = useState({ loading: true, product: null });
  useEffect(() => {
    let cancelled = false;
    searchProducts({ productId: line.product_id })
      .then((products) => { if (!cancelled) setState({ loading: false, product: products[0] || null }); })
      .catch(() => { if (!cancelled) setState({ loading: false, product: null }); });
    return () => { cancelled = true; };
  }, [line.product_id, searchProducts]);
  return (
    <div className="mt-2 space-y-2 rounded-[var(--radius-control)] border border-border bg-surface p-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-black text-text-muted">{ui.tb("manage.changeVariant")}</span>
        <button type="button" onClick={onClose} aria-label={ui.tb("manage.closePicker")} className="inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-control)] border border-border text-text">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      {state.loading ? (
        <div className="flex items-center gap-2 text-xs font-bold text-text-muted"><Loader2 className="h-4 w-4 animate-spin" />{ui.tb("manage.loadingVariants")}</div>
      ) : state.product ? (
        <VariantPicker product={state.product} ui={ui} heldByVariant={heldByVariant} onPick={onPick} />
      ) : (
        <div className="text-xs font-bold text-danger">{ui.tb("manage.searchFailed")}</div>
      )}
    </div>
  );
}

export function OrderItemsEditor({ order, ui, lines, setLines, moneyState, setMoneyState, searchProducts }) {
  const [adding, setAdding] = useState(false);
  const [swapKey, setSwapKey] = useState("");
  const heldByVariant = useMemo(() => {
    const held = new Map();
    for (const item of order.items || []) {
      const key = String(item.variant_id);
      held.set(key, (held.get(key) || 0) + num(item.quantity));
    }
    return held;
  }, [order.items]);

  const update = (key, patch) => setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  const remove = (key) => setLines((current) => current.filter((line) => line.key !== key));
  const addVariant = (product, variant) => {
    setLines((current) => {
      const existing = current.find((line) => String(line.variant_id) === String(variant.variant_id));
      if (existing) return current.map((line) => (line === existing ? { ...line, quantity: Math.min(99, line.quantity + 1) } : line));
      return [...current, {
        key: newKey(),
        order_item_id: null,
        product_id: product.product_id,
        variant_id: variant.variant_id,
        product_name: product.name,
        color: variant.color,
        size: variant.size,
        image_url: variant.image_url || product.image_url,
        quantity: 1,
        unit_price: round2(variant.price),
        stock: num(variant.stock),
      }];
    });
    setAdding(false);
  };
  // A swap is a new line for the server (new variant ⇒ priced as one), so it drops the
  // order_item_id and takes the variant's own price.
  const swap = (line, variant) => {
    update(line.key, {
      order_item_id: null,
      variant_id: variant.variant_id,
      color: variant.color,
      size: variant.size,
      image_url: variant.image_url || line.image_url,
      unit_price: round2(variant.price) || line.unit_price,
      stock: num(variant.stock),
    });
    setSwapKey("");
  };

  const subtotal = round2(lines.reduce((sum, line) => sum + num(line.unit_price) * line.quantity, 0));
  const coupon = round2(order.money?.coupon_discount);
  const tax = round2(order.money?.tax);
  const total = round2(Math.max(0, subtotal - num(moneyState.discount) - coupon + num(moneyState.shipping) + tax));
  const paid = round2(order.money?.paid);

  return (
    <section className="space-y-2" aria-label={ui.tb("manage.itemsTitle")}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-black text-text">{ui.tb("manage.itemsTitle")}</h3>
        {!adding ? (
          <button type="button" onClick={() => setAdding(true)} className="inline-flex min-h-[var(--control-height-sm)] items-center gap-1.5 rounded-[var(--radius-control)] border border-border bg-surface px-3 text-xs font-black text-text">
            <Plus className="h-4 w-4" />
            {ui.tb("manage.addItem")}
          </button>
        ) : null}
      </div>
      {adding ? <AddProductPanel ui={ui} searchProducts={searchProducts} heldByVariant={heldByVariant} onAdd={addVariant} onClose={() => setAdding(false)} /> : null}
      {!lines.length ? <div className="rounded-[var(--radius-control)] bg-danger-subtle px-3 py-2 text-xs font-black">{ui.tb("manage.itemsEmpty")}</div> : null}
      {lines.map((line) => (
        <div key={line.key} className="rounded-[var(--radius-control)] border border-border bg-surface-soft p-2">
          <div className="flex items-start gap-2">
            <Thumb src={line.image_url} />
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <div className="line-clamp-2 text-sm font-black leading-5 text-text"><bdi>{line.product_name}</bdi></div>
                <button type="button" onClick={() => remove(line.key)} aria-label={ui.tb("manage.removeItem")} className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-control)] border border-border bg-surface">
                  <Trash2 className="h-4 w-4 text-danger" />
                </button>
              </div>
              <button
                type="button"
                disabled={!line.product_id || !searchProducts}
                onClick={() => setSwapKey((current) => (current === line.key ? "" : line.key))}
                className="mt-1 inline-flex max-w-full items-center gap-1.5 rounded-[var(--radius-control)] border border-border bg-surface px-2 py-1 text-xs font-black text-text disabled:opacity-60"
              >
                <Repeat className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate"><bdi>{[line.color, line.size].filter(Boolean).join(" · ") || ui.tb("manage.changeVariant")}</bdi></span>
                {!line.order_item_id ? <span className="rounded-full bg-primary px-1.5 text-[10px] text-primary-foreground">{ui.tb("manage.newLine")}</span> : null}
              </button>
            </div>
          </div>
          {swapKey === line.key ? (
            <SwapPanel line={line} ui={ui} searchProducts={searchProducts} heldByVariant={heldByVariant} onPick={(variant) => swap(line, variant)} onClose={() => setSwapKey("")} />
          ) : null}
          <div className="mt-2 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => update(line.key, { quantity: Math.max(1, line.quantity - 1) })} disabled={line.quantity <= 1} aria-label={ui.tb("manage.decrease")} className="inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-control)] border border-border bg-surface text-text disabled:opacity-40">
                <Minus className="h-4 w-4" />
              </button>
              <span className="min-w-[2rem] text-center text-sm font-black text-text">{ui.count(line.quantity)}</span>
              <button type="button" onClick={() => update(line.key, { quantity: Math.min(99, line.quantity + 1) })} aria-label={ui.tb("manage.increase")} className="inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-control)] border border-border bg-surface text-text">
                <Plus className="h-4 w-4" />
              </button>
            </div>
            <label className="flex items-center gap-1.5">
              <span className="text-[11px] font-black text-text-muted">{ui.tb("manage.unitPrice")}</span>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                value={line.unit_price}
                onChange={(event) => update(line.key, { unit_price: event.target.value === "" ? "" : num(event.target.value) })}
                dir="ltr"
                className="h-9 w-24 rounded-[var(--radius-control)] border border-border bg-surface px-2 text-end text-sm font-black text-text"
              />
            </label>
          </div>
        </div>
      ))}

      <div className="space-y-2 rounded-[var(--radius-control)] border border-border bg-surface p-2.5">
        <div className="flex items-center justify-between text-xs font-black">
          <span className="text-text-muted">{ui.tb("manage.subtotal")}</span>
          <span className="text-text">{ui.money(subtotal)}</span>
        </div>
        <MoneyInput label={ui.tb("manage.discount")} value={moneyState.discount} onChange={(value) => setMoneyState((current) => ({ ...current, discount: value === "" ? "" : num(value) }))} />
        {coupon > 0 || text(order.money?.coupon_code) ? (
          <div className="flex items-center justify-between gap-2 text-xs font-black">
            <span className="text-text-muted">
              {ui.tb("manage.coupon", { code: text(order.money?.coupon_code) })}
              <span className="block text-[10px] font-bold">{ui.tb("manage.couponHint")}</span>
            </span>
            <span className="text-text">− {ui.money(coupon)}</span>
          </div>
        ) : null}
        <MoneyInput label={ui.tb("manage.shippingFee")} value={moneyState.shipping} onChange={(value) => setMoneyState((current) => ({ ...current, shipping: value === "" ? "" : num(value) }))} />
        <div className="flex items-center justify-between border-t border-border pt-2 text-sm font-black">
          <span className="text-text">{ui.tb("manage.estimatedTotal")}</span>
          <span className="text-text">{ui.money(total)}</span>
        </div>
        {paid > 0 ? (
          <div className="flex items-center justify-between text-xs font-black">
            <span className="text-text-muted">{ui.tb("manage.paid")}</span>
            <span className="text-text">{ui.money(paid)}</span>
          </div>
        ) : null}
        <div className="flex items-center justify-between text-xs font-black">
          <span className="text-text-muted">{ui.tb("manage.collect")}</span>
          <span className="text-text">{ui.money(Math.max(0, total - paid))}</span>
        </div>
      </div>
    </section>
  );
}
