import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, Loader2, Minus, Package, Plus, Search, Trash2, X } from "lucide-react";
import { api as http } from "../../api/api";
import ThemedSelect from "../../ui/ThemedSelect";
import { resolveProductImageUrl } from "../../lib/imageUrls";
import { bostaCityPatch, bostaDistrictPatch, bostaZonePatch, buildBostaPickerOptions } from "../../lib/shippingCheckout";
import { Sheet } from "./PortalOrderManage";

// "+" on أوردرات الشحن: a whole online order written from the portal — products and
// sizes, the customer, the Bosta address, payment and shipping. The server prices every
// figure (shipping.portal.create.js → the AI Inbox composer's own calls); the totals at
// the bottom are its preview, so what the seller sees is what the invoice says.

const text = (value = "") => String(value ?? "").trim();
// Arabic-Indic digits typed on an Arabic keyboard are still a phone number.
const asciiDigits = (value = "") => String(value ?? "").replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660));
const normalizePhone = (value = "") => {
  const digits = asciiDigits(value).replace(/[^\d+]/g, "");
  return digits.startsWith("+20") ? `0${digits.slice(3)}` : digits.startsWith("20") && digits.length === 12 ? `0${digits.slice(2)}` : digits;
};
const validPhone = (value = "") => /^01[0125]\d{8}$/.test(normalizePhone(value));
const newKey = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

const CHANNELS = ["whatsapp", "facebook", "instagram", "web_chat"];
const PAYMENT_METHODS = ["cash_on_delivery", "cash", "visa", "instapay", "vodafone_cash"];

const EMPTY_FORM = {
  customer_name: "",
  customer_phone: "",
  customer_secondary_phone: "",
  governorate: "",
  city_area: "",
  shipping_city_id: "",
  shipping_zone_id: "",
  shipping_district_id: "",
  street_address: "",
  building_number: "",
  floor_number: "",
  apartment_number: "",
  landmark: "",
  channel: "whatsapp",
  payment_method: "cash_on_delivery",
  discount_value: "",
  shipping_cost: "",
  notes: "",
};

function Field({ label, value, onChange, type = "text", dir = "auto", multiline = false, required = false, placeholder = "", inputMode, error = false }) {
  const className = `mt-1 w-full rounded-[var(--radius-control)] border ${error ? "border-danger" : "border-border"} bg-surface px-3 py-2 text-sm font-bold text-text placeholder:text-text-muted`;
  return (
    <label className="block min-w-0">
      <span className="text-[11px] font-black text-text-muted">{label}{required ? " *" : ""}</span>
      {multiline ? (
        <textarea rows={2} value={value} onChange={(event) => onChange(event.target.value)} dir={dir} placeholder={placeholder} className={className} />
      ) : (
        <input type={type} inputMode={inputMode} value={value} onChange={(event) => onChange(event.target.value)} dir={dir} placeholder={placeholder} className={`${className} min-h-[var(--control-height-md)]`} />
      )}
    </label>
  );
}

function SectionTitle({ children, aside = null }) {
  return (
    <div className="flex items-center justify-between gap-2 pt-1">
      <h3 className="text-sm font-black text-text">{children}</h3>
      {aside}
    </div>
  );
}

// Tries each photo in turn (the colour's own, then the product's) before the placeholder.
function Thumb({ srcs = [] }) {
  const list = srcs.filter(Boolean);
  const [index, setIndex] = useState(0);
  const url = list[index] ? resolveProductImageUrl(list[index]) : "";
  return url ? (
    <img src={url} alt="" loading="lazy" decoding="async" onError={() => setIndex((current) => current + 1)} className="h-12 w-12 shrink-0 rounded-xl border border-border bg-surface-soft object-cover" />
  ) : (
    <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl border border-border bg-surface-soft text-text-muted">
      <Package className="h-5 w-5" />
    </span>
  );
}

// One product, opened: its colours, then the sizes of the chosen colour with what is
// in stock. A tap on a size puts one piece in the order (another tap adds one more).
function VariantPicker({ product, ui, cartQty, onAdd }) {
  const colors = useMemo(() => [...new Set(product.variants.map((variant) => variant.color || "-"))], [product]);
  const [color, setColor] = useState(colors.length === 1 ? colors[0] : "");
  const sizes = product.variants.filter((variant) => (variant.color || "-") === color);
  return (
    <div className="space-y-2 border-t border-border px-3 pb-3 pt-2">
      <div className="text-[11px] font-black text-text-muted">{ui.tb("manage.pickColor")}</div>
      <div className="flex flex-wrap gap-1.5">
        {colors.map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setColor(value)}
            aria-pressed={color === value}
            className={`min-h-9 rounded-full px-3 text-xs font-black ${color === value ? "bg-primary text-primary-foreground" : "border border-border bg-surface text-text"}`}
          >
            {value}
          </button>
        ))}
      </div>
      {color ? (
        <>
          <div className="text-[11px] font-black text-text-muted">{ui.tb("manage.pickSize")}</div>
          <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6">
            {sizes.map((variant) => {
              const inCart = cartQty(variant.variant_id);
              const full = inCart >= variant.stock;
              return (
                <button
                  key={variant.variant_id}
                  type="button"
                  disabled={full}
                  onClick={() => onAdd(product, variant)}
                  className={`relative flex min-h-12 flex-col items-center justify-center rounded-[var(--radius-control)] border px-1 text-sm font-black disabled:opacity-45 ${inCart ? "border-primary bg-primary-subtle text-text" : "border-border bg-surface text-text"}`}
                >
                  <span dir="ltr">{variant.size || "-"}</span>
                  <span className="text-[10px] font-bold text-text-muted">{ui.tb("manage.inStock", { count: ui.count(variant.stock) })}</span>
                  {inCart ? (
                    <span className="absolute -top-1.5 end-[-0.35rem] grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1 text-[10px] font-black text-primary-foreground">{ui.count(inCart)}</span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </>
      ) : null}
    </div>
  );
}

export default function NewOnlineOrderSheet({ api, ui, onClose, onCreated, errorText }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const set = (key) => (value) => setForm((current) => ({ ...current, [key]: value }));
  const [lines, setLines] = useState([]);
  const [query, setQuery] = useState("");
  const [catalog, setCatalog] = useState({ products: [], loading: true, error: false });
  const [openProductId, setOpenProductId] = useState(null);
  const [preview, setPreview] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [showErrors, setShowErrors] = useState(false);
  const idempotencyKey = useRef(newKey());
  const [bosta, setBosta] = useState({ cities: [], zones: [], districts: [] });

  // ---- catalogue search (server-side, debounced)
  useEffect(() => {
    let cancelled = false;
    setCatalog((current) => ({ ...current, loading: true, error: false }));
    const timer = window.setTimeout(() => {
      api.catalog(query.trim())
        .then((data) => { if (!cancelled) setCatalog({ products: Array.isArray(data?.products) ? data.products : [], loading: false, error: false }); })
        .catch(() => { if (!cancelled) setCatalog({ products: [], loading: false, error: true }); });
    }, query ? 300 : 0);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [api, query]);

  // ---- Bosta address lists (public endpoints, the same the edit sheet uses)
  useEffect(() => {
    let cancelled = false;
    http.get("/shipping/cities?provider=bosta&dropoff=1", { suppressErrorStatuses: [404, 500] })
      .then((data) => { if (!cancelled) setBosta((current) => ({ ...current, cities: Array.isArray(data?.cities) ? data.cities : [] })); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    let cancelled = false;
    if (!form.shipping_city_id) { setBosta((current) => ({ ...current, zones: [], districts: [] })); return undefined; }
    http.get(`/shipping/zones?provider=bosta&dropoff=1&cityId=${encodeURIComponent(form.shipping_city_id)}`, { suppressErrorStatuses: [404, 500] })
      .then((data) => { if (!cancelled) setBosta((current) => ({ ...current, zones: Array.isArray(data?.zones) ? data.zones : [] })); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [form.shipping_city_id]);
  useEffect(() => {
    let cancelled = false;
    if (!form.shipping_zone_id) { setBosta((current) => ({ ...current, districts: [] })); return undefined; }
    http.get(`/shipping/districts?provider=bosta&dropoff=1&zoneId=${encodeURIComponent(form.shipping_zone_id)}`, { suppressErrorStatuses: [404, 500] })
      .then((data) => { if (!cancelled) setBosta((current) => ({ ...current, districts: Array.isArray(data?.districts) ? data.districts : [] })); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [form.shipping_zone_id]);
  const cityOptions = useMemo(() => buildBostaPickerOptions(bosta.cities, "city", ui.language), [bosta.cities, ui.language]);
  const zoneOptions = useMemo(() => buildBostaPickerOptions(bosta.zones, "zone", ui.language), [bosta.zones, ui.language]);
  const districtOptions = useMemo(() => buildBostaPickerOptions(bosta.districts, "district", ui.language), [bosta.districts, ui.language]);

  // ---- the order lines
  const cartQty = (variantId) => lines.find((line) => line.variant_id === variantId)?.quantity || 0;
  const addLine = (product, variant) => {
    setLines((current) => {
      const existing = current.find((line) => line.variant_id === variant.variant_id);
      if (existing) {
        return current.map((line) => (line.variant_id === variant.variant_id ? { ...line, quantity: Math.min(line.stock, line.quantity + 1) } : line));
      }
      return [...current, {
        variant_id: variant.variant_id,
        name: product.name,
        color: variant.color,
        size: variant.size,
        image_urls: [variant.image_url, product.image_url],
        price: Number(variant.price) || 0,
        stock: variant.stock,
        quantity: 1,
      }];
    });
  };
  const stepLine = (variantId, delta) => setLines((current) => current
    .map((line) => (line.variant_id === variantId ? { ...line, quantity: Math.max(0, Math.min(line.stock, line.quantity + delta)) } : line))
    .filter((line) => line.quantity > 0));
  const removeLine = (variantId) => setLines((current) => current.filter((line) => line.variant_id !== variantId));

  // ---- server preview of every figure
  const previewKey = JSON.stringify([
    lines.map((line) => [line.variant_id, line.quantity]),
    form.discount_value,
    form.shipping_cost,
    form.governorate,
    form.city_area,
    form.shipping_city_id,
    form.shipping_zone_id,
    form.shipping_district_id,
  ]);
  useEffect(() => {
    if (!lines.length) { setPreview(null); return undefined; }
    let cancelled = false;
    setPreviewing(true);
    const timer = window.setTimeout(() => {
      api.preview({
        lines: lines.map((line) => ({ variant_id: line.variant_id, quantity: line.quantity })),
        discount_type: "amount",
        discount_value: form.discount_value,
        shipping_cost: form.shipping_cost,
        governorate: form.governorate,
        city_area: form.city_area,
        shipping_city_id: form.shipping_city_id,
        shipping_zone_id: form.shipping_zone_id,
        shipping_district_id: form.shipping_district_id,
      })
        .then((data) => { if (!cancelled) setPreview(data || null); })
        .catch(() => { if (!cancelled) setPreview(null); })
        .finally(() => { if (!cancelled) setPreviewing(false); });
    }, 350);
    return () => { cancelled = true; window.clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, previewKey]);

  const localSubtotal = lines.reduce((sum, line) => sum + line.price * line.quantity, 0);
  const subtotal = preview ? Number(preview.subtotal) || 0 : localSubtotal;
  const discount = preview ? Number(preview.discount) || 0 : Math.min(localSubtotal, Math.max(0, Number(asciiDigits(form.discount_value)) || 0));
  const shipping = preview ? Number(preview.shipping_cost) || 0 : 0;
  const total = preview ? Number(preview.total) || 0 : Math.max(0, localSubtotal - discount);
  const pieces = lines.reduce((sum, line) => sum + line.quantity, 0);

  const problems = {
    lines: !lines.length,
    name: !text(form.customer_name),
    phone: !validPhone(form.customer_phone),
    secondPhone: Boolean(text(form.customer_secondary_phone)) && !validPhone(form.customer_secondary_phone),
    governorate: !text(form.shipping_city_id) && !text(form.governorate),
  };
  const blocked = Object.values(problems).some(Boolean);
  // The "complete the marked fields" note goes away once nothing is marked.
  const fixFieldsText = ui.tb("newOrder.fixFields");
  useEffect(() => {
    if (!blocked) setError((current) => (current === fixFieldsText ? "" : current));
  }, [blocked, fixFieldsText]);

  const save = async () => {
    if (saving) return;
    if (blocked) {
      setShowErrors(true);
      setError(ui.tb("newOrder.fixFields"));
      return;
    }
    setSaving(true);
    setError("");
    try {
      const response = await api.create({
        ...form,
        customer_phone: normalizePhone(form.customer_phone),
        customer_secondary_phone: text(form.customer_secondary_phone) ? normalizePhone(form.customer_secondary_phone) : "",
        discount_type: "amount",
        discount_value: asciiDigits(form.discount_value),
        shipping_cost: asciiDigits(form.shipping_cost),
        lines: lines.map((line) => ({ variant_id: line.variant_id, quantity: line.quantity })),
        idempotency_key: idempotencyKey.current,
      });
      onCreated(response?.order || null);
    } catch (createError) {
      const body = createError?.responseBody || {};
      if (text(body.code) === "OUT_OF_STOCK" && Array.isArray(body.out_of_stock) && body.out_of_stock.length) {
        setError(ui.tb("newOrder.outOfStock", { items: body.out_of_stock.map((item) => `${item.product_name} ${item.variant_name}`).join("، ") }));
      } else if (text(body.code) === "INVALID_PHONE") {
        setError(ui.tb("newOrder.phoneInvalid"));
      } else {
        setError(errorText(createError));
      }
      setSaving(false);
    }
  };

  const invalid = (flag) => (showErrors && flag ? "!text-danger" : "");
  const channelLabel = (key) => ui.tb(`newOrder.channels.${key}`);
  const paymentOptions = PAYMENT_METHODS.map((key) => ({ value: key, label: ui.tb(`newOrder.payments.${key}`) }));

  return (
    <Sheet
      title={ui.tb("newOrder.title")}
      ui={ui}
      onClose={saving ? () => {} : onClose}
      footer={(
        <div className="space-y-2">
          {lines.length ? (
            <div className="space-y-1 text-xs font-bold text-text-muted">
              <div className="flex justify-between gap-2"><span>{ui.tb("newOrder.subtotal", { count: ui.count(pieces) })}</span><span className="text-text">{ui.money(subtotal)}</span></div>
              {discount > 0 ? <div className="flex justify-between gap-2"><span>{ui.tb("newOrder.discount")}</span><span className="text-text">- {ui.money(discount)}</span></div> : null}
              <div className="flex justify-between gap-2">
                <span>{ui.tb("newOrder.shipping")}{preview?.free_shipping_applied ? ` · ${ui.tb("newOrder.freeShipping")}` : ""}</span>
                <span className="text-text">{preview ? ui.money(shipping) : ui.tb("newOrder.shippingPending")}</span>
              </div>
              <div className="flex items-center justify-between gap-2 border-t border-border pt-1.5 text-sm font-black text-text">
                <span className="inline-flex items-center gap-1.5">{ui.tb("newOrder.total")}{previewing ? <Loader2 className="h-3.5 w-3.5 animate-spin text-text-muted" /> : null}</span>
                <span>{ui.money(total)}</span>
              </div>
              {preview?.shipping_fee_advance?.required ? (
                <div className="flex items-start gap-1.5 rounded-[var(--radius-control)] bg-warning-subtle px-2 py-1.5 text-[11px] font-black text-text">
                  <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-warning" />
                  <span>{ui.tb("newOrder.advanceRequired", { amount: ui.money(preview.shipping_fee_advance.amount) })}</span>
                </div>
              ) : null}
            </div>
          ) : null}
          {error ? (
            <div className="flex items-start gap-2 rounded-[var(--radius-control)] bg-danger-subtle px-3 py-2 text-xs font-black" role="alert">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
              <span>{error}</span>
            </div>
          ) : null}
          <div className="grid grid-cols-[2fr_1fr] gap-2">
            <button type="button" disabled={saving} onClick={() => void save()} className="inline-flex min-h-[var(--control-height-lg)] items-center justify-center gap-2 rounded-[var(--radius-control)] bg-primary px-3 text-sm font-black text-primary-foreground disabled:opacity-60">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              {ui.tb("newOrder.save")}
            </button>
            <button type="button" disabled={saving} onClick={onClose} className="inline-flex min-h-[var(--control-height-lg)] items-center justify-center rounded-[var(--radius-control)] border border-border bg-surface px-3 text-sm font-black disabled:opacity-60">
              {ui.tb("actions.cancel")}
            </button>
          </div>
        </div>
      )}
    >
      <div className="space-y-4">
        {/* ---- products */}
        <section className="space-y-2">
          <SectionTitle aside={lines.length ? <span className="text-[11px] font-black text-text-muted">{ui.tb("newOrder.pieces", { count: ui.count(pieces) })}</span> : null}>
            <span className={invalid(problems.lines)}>{ui.tb("newOrder.products")} *</span>
          </SectionTitle>

          {lines.length ? (
            <ul className="space-y-1.5">
              {lines.map((line) => (
                <li key={line.variant_id} className="flex items-center gap-2 rounded-[var(--radius-control)] border border-border bg-surface p-2">
                  <Thumb srcs={line.image_urls} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-black" dir="auto">{line.name}</div>
                    <div className="truncate text-[11px] font-bold text-text-muted" dir="auto">
                      {[line.color, line.size ? `${ui.tb("newOrder.size")} ${line.size}` : ""].filter(Boolean).join(" · ")}
                    </div>
                    <div className="text-xs font-black text-text">{ui.money(line.price * line.quantity)}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button type="button" onClick={() => stepLine(line.variant_id, -1)} aria-label={ui.tb("manage.decrease")} className="grid h-8 w-8 place-items-center rounded-[var(--radius-control)] border border-border bg-surface">
                      <Minus className="h-3.5 w-3.5" />
                    </button>
                    <span className="w-6 text-center text-sm font-black">{ui.count(line.quantity)}</span>
                    <button type="button" disabled={line.quantity >= line.stock} onClick={() => stepLine(line.variant_id, 1)} aria-label={ui.tb("manage.increase")} className="grid h-8 w-8 place-items-center rounded-[var(--radius-control)] border border-border bg-surface disabled:opacity-40">
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                    <button type="button" onClick={() => removeLine(line.variant_id)} aria-label={ui.tb("manage.removeItem")} className="grid h-8 w-8 place-items-center rounded-[var(--radius-control)] text-danger">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}

          <label className="relative flex items-center">
            <Search className="pointer-events-none absolute start-2.5 h-4 w-4 text-text-muted" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={ui.tb("manage.searchPlaceholder")}
              className={`min-h-[var(--control-height-md)] w-full rounded-[var(--radius-control)] border border-border bg-surface ps-8 text-sm font-bold text-text placeholder:text-text-muted ${query ? "pe-9" : "pe-2"}`}
              enterKeyHint="search"
            />
            {query ? (
              <button type="button" onClick={() => setQuery("")} className="absolute end-2 grid h-7 w-7 place-items-center rounded-full text-text-muted" aria-label={ui.tb("clearSearch")}>
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </label>

          <div className="max-h-[22rem] overflow-y-auto overscroll-contain rounded-[var(--radius-control)] border border-border bg-surface-soft">
            {catalog.loading && !catalog.products.length ? (
              <div className="flex items-center justify-center gap-2 p-4 text-xs font-bold text-text-muted"><Loader2 className="h-4 w-4 animate-spin" />{ui.tb("manage.searching")}</div>
            ) : catalog.error ? (
              <div className="p-4 text-center text-xs font-bold text-text-muted">{ui.tb("manage.searchFailed")}</div>
            ) : !catalog.products.length ? (
              <div className="p-4 text-center text-xs font-bold text-text-muted">{ui.tb("manage.noResults")}</div>
            ) : (
              <ul className="divide-y divide-border">
                {catalog.products.map((product) => {
                  const open = openProductId === product.id;
                  const prices = product.variants.map((variant) => Number(variant.price) || 0).filter(Boolean);
                  const minPrice = prices.length ? Math.min(...prices) : 0;
                  const stock = product.variants.reduce((sum, variant) => sum + variant.stock, 0);
                  const picked = product.variants.reduce((sum, variant) => sum + cartQty(variant.variant_id), 0);
                  return (
                    <li key={product.id} className={open ? "bg-surface" : ""}>
                      <button type="button" onClick={() => setOpenProductId(open ? null : product.id)} aria-expanded={open} className="flex w-full items-center gap-2 p-2 text-start">
                        <Thumb srcs={[product.image_url, product.variants[0]?.image_url]} />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-black" dir="auto">{product.name}</div>
                          <div className="text-[11px] font-bold text-text-muted">
                            {ui.money(minPrice)} · {ui.tb("manage.inStock", { count: ui.count(stock) })}
                          </div>
                        </div>
                        {picked ? (
                          <span className="grid h-6 min-w-6 place-items-center rounded-full bg-primary px-1.5 text-[11px] font-black text-primary-foreground">{ui.count(picked)}</span>
                        ) : (
                          <Plus className="h-4 w-4 shrink-0 text-text-muted" />
                        )}
                      </button>
                      {open ? <VariantPicker product={product} ui={ui} cartQty={cartQty} onAdd={addLine} /> : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>

        {/* ---- customer */}
        <section className="space-y-2">
          <SectionTitle>{ui.tb("newOrder.customer")}</SectionTitle>
          <div className="grid grid-cols-2 gap-2">
            <Field label={ui.tb("detail.name")} value={form.customer_name} onChange={set("customer_name")} required error={showErrors && problems.name} />
            <Field label={ui.tb("detail.phone")} value={form.customer_phone} onChange={set("customer_phone")} type="tel" inputMode="tel" dir="ltr" placeholder="01xxxxxxxxx" required error={showErrors && problems.phone} />
          </div>
          <Field label={ui.tb("detail.secondaryPhone")} value={form.customer_secondary_phone} onChange={set("customer_secondary_phone")} type="tel" inputMode="tel" dir="ltr" error={showErrors && problems.secondPhone} />
        </section>

        {/* ---- address */}
        <section className="space-y-2">
          <SectionTitle>{ui.tb("newOrder.address")}</SectionTitle>
          <div>
            <span className={`text-[11px] font-black text-text-muted ${invalid(problems.governorate)}`}>{ui.tb("detail.governorate")} *</span>
            <ThemedSelect
              value={form.shipping_city_id}
              options={cityOptions}
              placeholder={ui.tb("manage.pickGovernorate")}
              ariaLabel={ui.tb("detail.governorate")}
              onChange={(value) => setForm((current) => ({ ...current, ...bostaCityPatch(bosta.cities, value) }))}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="min-w-0">
              <span className="text-[11px] font-black text-text-muted">{ui.tb("detail.city")}</span>
              <ThemedSelect
                value={form.shipping_zone_id}
                options={zoneOptions}
                disabled={!form.shipping_city_id}
                placeholder={ui.tb("manage.pickCity")}
                ariaLabel={ui.tb("detail.city")}
                onChange={(value) => setForm((current) => ({ ...current, ...bostaZonePatch(bosta.zones, value) }))}
              />
            </div>
            <div className="min-w-0">
              <span className="text-[11px] font-black text-text-muted">{ui.tb("detail.district")}</span>
              <ThemedSelect
                value={form.shipping_district_id}
                options={districtOptions}
                disabled={!form.shipping_zone_id}
                placeholder={ui.tb("manage.pickDistrict")}
                ariaLabel={ui.tb("detail.district")}
                onChange={(value) => setForm((current) => ({ ...current, ...bostaDistrictPatch(districtOptions, value, current.city_area) }))}
              />
            </div>
          </div>
          <Field label={ui.tb("detail.street")} value={form.street_address} onChange={set("street_address")} />
          <div className="grid grid-cols-3 gap-2">
            <Field label={ui.tb("detail.building")} value={form.building_number} onChange={set("building_number")} />
            <Field label={ui.tb("detail.floor")} value={form.floor_number} onChange={set("floor_number")} />
            <Field label={ui.tb("detail.apartment")} value={form.apartment_number} onChange={set("apartment_number")} />
          </div>
          <Field label={ui.tb("detail.landmark")} value={form.landmark} onChange={set("landmark")} />
        </section>

        {/* ---- payment, shipping, source */}
        <section className="space-y-2">
          <SectionTitle>{ui.tb("newOrder.payment")}</SectionTitle>
          <div>
            <span className="text-[11px] font-black text-text-muted">{ui.tb("newOrder.channel")}</span>
            <div className="mt-1 grid grid-cols-4 gap-1.5">
              {CHANNELS.map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => set("channel")(key)}
                  aria-pressed={form.channel === key}
                  className={`min-h-9 truncate rounded-[var(--radius-control)] px-1 text-xs font-black ${form.channel === key ? "bg-primary text-primary-foreground" : "border border-border bg-surface text-text"}`}
                >
                  {channelLabel(key)}
                </button>
              ))}
            </div>
          </div>
          <div>
            <span className="text-[11px] font-black text-text-muted">{ui.tb("newOrder.paymentMethod")}</span>
            <ThemedSelect value={form.payment_method} options={paymentOptions} ariaLabel={ui.tb("newOrder.paymentMethod")} onChange={(value) => set("payment_method")(value)} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label={ui.tb("newOrder.discountAmount")} value={form.discount_value} onChange={set("discount_value")} type="text" inputMode="decimal" dir="ltr" placeholder="0" />
            <Field
              label={ui.tb("newOrder.shippingFee")}
              value={form.shipping_cost}
              onChange={set("shipping_cost")}
              type="text"
              inputMode="decimal"
              dir="ltr"
              placeholder={preview && preview.shipping_source !== "manual" ? String(preview.shipping_cost) : ui.tb("newOrder.auto")}
            />
          </div>
          <p className="text-[11px] font-bold leading-4 text-text-muted">{ui.tb("newOrder.shippingHint")}</p>
          <Field label={ui.tb("detail.orderNotes")} value={form.notes} onChange={set("notes")} multiline />
        </section>
      </div>
    </Sheet>
  );
}
