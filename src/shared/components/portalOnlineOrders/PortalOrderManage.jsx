import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Loader2, MoreVertical, Pencil, Trash2, X } from "lucide-react";
import { api } from "../../api/api";
import ThemedSelect from "../../ui/ThemedSelect";
import { bostaCityPatch, bostaDistrictPatch, bostaZonePatch, buildBostaPickerOptions } from "../../lib/shippingCheckout";

// The manager portal's ⋮ on a shipping card: edit the customer / address / notes, or
// delete the order (cancel + stock back). Only offered before a Bosta parcel exists —
// the server refuses after that too (shipping.portal.manage.js).

const text = (value = "") => String(value ?? "").trim();
export const orderIsManageable = (order = {}) =>
  ["new", "confirmed"].includes(order.group) && !text(order.shipment?.tracking_number) && !text(order.shipment?.delivery_id);

export function OrderManageMenu({ order, ui, onEdit, onDelete }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const manageable = orderIsManageable(order);

  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  const stop = (event) => event.stopPropagation();
  return (
    <div ref={rootRef} className="relative" onClick={stop} onKeyDown={stop}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ui.tb("manage.menu")}
        className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-control)] border border-border bg-surface text-text"
      >
        <MoreVertical className="h-4 w-4" />
      </button>
      {open ? (
        <div role="menu" className="absolute end-0 top-9 z-20 w-52 overflow-hidden rounded-[var(--radius-control)] border border-border bg-surface text-text shadow-xl">
          <button
            type="button"
            role="menuitem"
            disabled={!manageable}
            onClick={() => { setOpen(false); onEdit(order); }}
            className="flex w-full items-center gap-2 px-3 py-2.5 text-start text-sm font-black hover:bg-surface-hover disabled:opacity-50"
          >
            <Pencil className="h-4 w-4" />
            {ui.tb("manage.edit")}
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={!manageable}
            onClick={() => { setOpen(false); onDelete(order); }}
            className="flex w-full items-center gap-2 border-t border-border px-3 py-2.5 text-start text-sm font-black hover:bg-surface-hover disabled:opacity-50"
          >
            <Trash2 className="h-4 w-4 text-danger" />
            {ui.tb("manage.delete")}
          </button>
          {!manageable ? <div className="border-t border-border px-3 py-2 text-[11px] font-bold leading-4 text-text-muted">{ui.tb("manage.lockedHint")}</div> : null}
        </div>
      ) : null}
    </div>
  );
}

function Sheet({ title, ui, onClose, children, footer }) {
  useEffect(() => {
    const onKey = (event) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[92] flex items-end justify-center bg-[rgba(2,6,23,0.55)] sm:items-center" dir={ui.dir}>
      <button type="button" aria-label={ui.tb("actions.close")} onClick={onClose} className="absolute inset-0 cursor-default" />
      <section role="dialog" aria-modal="true" aria-label={title} className="relative flex max-h-[94dvh] w-full max-w-xl flex-col overflow-hidden rounded-t-[1.75rem] border border-border bg-background text-text shadow-2xl sm:rounded-[1.75rem]">
        <header className="flex items-center justify-between gap-3 border-b border-border bg-surface px-4 py-3">
          <h2 className="text-base font-black" dir="auto">{title}</h2>
          <button type="button" onClick={onClose} className="inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-control)] border border-border bg-surface" aria-label={ui.tb("actions.close")}>
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">{children}</div>
        {footer ? <div className="border-t border-border bg-surface px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">{footer}</div> : null}
      </section>
    </div>
  );
}

function Input({ label, value, onChange, type = "text", dir = "auto", multiline = false, required = false }) {
  const className = "mt-1 w-full rounded-[var(--radius-control)] border border-border bg-surface px-3 py-2 text-sm font-bold text-text";
  return (
    <label className="block">
      <span className="text-[11px] font-black text-text-muted">{label}{required ? " *" : ""}</span>
      {multiline ? (
        <textarea rows={2} value={value} onChange={(event) => onChange(event.target.value)} dir={dir} className={className} />
      ) : (
        <input type={type} value={value} onChange={(event) => onChange(event.target.value)} dir={dir} className={`${className} min-h-[var(--control-height-md)]`} />
      )}
    </label>
  );
}

const formFromOrder = (order = {}) => ({
  customer_name: text(order.customer?.name),
  customer_phone: text(order.customer?.phone),
  governorate: text(order.address?.raw_governorate || order.address?.governorate),
  city_area: text(order.address?.raw_city_area || order.address?.city),
  shipping_city_id: text(order.address?.shipping_city_id),
  shipping_zone_id: text(order.address?.shipping_zone_id),
  shipping_district_id: text(order.address?.shipping_district_id),
  street_address: text(order.address?.street),
  building_number: text(order.address?.building),
  floor_number: text(order.address?.floor),
  apartment_number: text(order.address?.apartment),
  landmark: text(order.address?.landmark),
  customer_address: text(order.address?.full),
  delivery_notes: text(order.delivery_notes),
  order_notes: text(order.order_notes),
});

const EDIT_KEYS = Object.keys(formFromOrder());

export function OrderEditSheet({ order, ui, onClose, onSave, errorText }) {
  const [form, setForm] = useState(() => formFromOrder(order));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [bosta, setBosta] = useState({ cities: [], zones: [], districts: [] });
  const set = (key) => (value) => setForm((current) => ({ ...current, [key]: value }));

  // The same Bosta lists the checkouts use (public endpoints), so an address saved
  // here is one createBostaShipmentForOrder can resolve.
  useEffect(() => {
    let cancelled = false;
    api.get("/shipping/cities?provider=bosta&dropoff=1", { suppressErrorStatuses: [404, 500] })
      .then((data) => { if (!cancelled) setBosta((current) => ({ ...current, cities: Array.isArray(data?.cities) ? data.cities : [] })); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    let cancelled = false;
    if (!form.shipping_city_id) { setBosta((current) => ({ ...current, zones: [], districts: [] })); return undefined; }
    api.get(`/shipping/zones?provider=bosta&dropoff=1&cityId=${encodeURIComponent(form.shipping_city_id)}`, { suppressErrorStatuses: [404, 500] })
      .then((data) => { if (!cancelled) setBosta((current) => ({ ...current, zones: Array.isArray(data?.zones) ? data.zones : [] })); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [form.shipping_city_id]);
  useEffect(() => {
    let cancelled = false;
    if (!form.shipping_zone_id) { setBosta((current) => ({ ...current, districts: [] })); return undefined; }
    api.get(`/shipping/districts?provider=bosta&dropoff=1&zoneId=${encodeURIComponent(form.shipping_zone_id)}`, { suppressErrorStatuses: [404, 500] })
      .then((data) => { if (!cancelled) setBosta((current) => ({ ...current, districts: Array.isArray(data?.districts) ? data.districts : [] })); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [form.shipping_zone_id]);

  const cityOptions = useMemo(() => buildBostaPickerOptions(bosta.cities, "city", ui.language), [bosta.cities, ui.language]);
  const zoneOptions = useMemo(() => buildBostaPickerOptions(bosta.zones, "zone", ui.language), [bosta.zones, ui.language]);
  const districtOptions = useMemo(() => buildBostaPickerOptions(bosta.districts, "district", ui.language), [bosta.districts, ui.language]);

  const save = async () => {
    setSaving(true);
    setError("");
    const original = formFromOrder(order);
    // Only what changed: an untouched field is never rewritten.
    const fields = Object.fromEntries(EDIT_KEYS.filter((key) => form[key] !== original[key]).map((key) => [key, form[key]]));
    if (!Object.keys(fields).length) {
      onClose();
      return;
    }
    try {
      await onSave(order.id, fields);
    } catch (saveError) {
      setError(errorText(saveError));
      setSaving(false);
    }
  };

  return (
    <Sheet
      title={ui.tb("manage.editTitle", { number: order.order_number })}
      ui={ui}
      onClose={saving ? () => {} : onClose}
      footer={(
        <div className="space-y-2">
          {error ? (
            <div className="flex items-start gap-2 rounded-[var(--radius-control)] bg-danger-subtle px-3 py-2 text-xs font-black" role="alert">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
              <span>{error}</span>
            </div>
          ) : null}
          <div className="grid grid-cols-2 gap-2">
            <button type="button" disabled={saving} onClick={() => void save()} className="inline-flex min-h-[var(--control-height-lg)] items-center justify-center gap-2 rounded-[var(--radius-control)] bg-primary px-3 text-sm font-black text-primary-foreground disabled:opacity-60">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {ui.tb("manage.save")}
            </button>
            <button type="button" disabled={saving} onClick={onClose} className="inline-flex min-h-[var(--control-height-lg)] items-center justify-center rounded-[var(--radius-control)] border border-border bg-surface px-3 text-sm font-black disabled:opacity-60">
              {ui.tb("actions.cancel")}
            </button>
          </div>
        </div>
      )}
    >
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <Input label={ui.tb("detail.name")} value={form.customer_name} onChange={set("customer_name")} required />
          <Input label={ui.tb("detail.phone")} value={form.customer_phone} onChange={set("customer_phone")} type="tel" dir="ltr" required />
        </div>
        <div className="space-y-2">
          <div>
            <span className="text-[11px] font-black text-text-muted">{ui.tb("detail.governorate")}</span>
            <ThemedSelect
              value={form.shipping_city_id}
              options={cityOptions}
              placeholder={form.governorate || ui.tb("manage.pickGovernorate")}
              ariaLabel={ui.tb("detail.governorate")}
              onChange={(value) => setForm((current) => ({ ...current, ...bostaCityPatch(bosta.cities, value) }))}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
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
            <div>
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
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Input label={ui.tb("detail.street")} value={form.street_address} onChange={set("street_address")} />
          <Input label={ui.tb("detail.building")} value={form.building_number} onChange={set("building_number")} />
          <Input label={ui.tb("detail.floor")} value={form.floor_number} onChange={set("floor_number")} />
          <Input label={ui.tb("detail.apartment")} value={form.apartment_number} onChange={set("apartment_number")} />
        </div>
        <Input label={ui.tb("detail.landmark")} value={form.landmark} onChange={set("landmark")} />
        <Input label={ui.tb("detail.fullAddress")} value={form.customer_address} onChange={set("customer_address")} multiline />
        <Input label={ui.tb("detail.deliveryNotes")} value={form.delivery_notes} onChange={set("delivery_notes")} multiline />
        <Input label={ui.tb("detail.orderNotes")} value={form.order_notes} onChange={set("order_notes")} multiline />
        <p className="text-[11px] font-bold leading-4 text-text-muted">{ui.tb("manage.itemsHint")}</p>
      </div>
    </Sheet>
  );
}

export function OrderDeleteSheet({ order, ui, onClose, onDelete, errorText }) {
  const [reason, setReason] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const run = async () => {
    setDeleting(true);
    setError("");
    try {
      await onDelete(order.id, reason);
    } catch (deleteError) {
      setError(errorText(deleteError));
      setDeleting(false);
    }
  };
  return (
    <Sheet
      title={ui.tb("manage.deleteTitle", { number: order.order_number })}
      ui={ui}
      onClose={deleting ? () => {} : onClose}
      footer={(
        <div className="space-y-2">
          {error ? (
            <div className="flex items-start gap-2 rounded-[var(--radius-control)] bg-danger-subtle px-3 py-2 text-xs font-black" role="alert">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
              <span>{error}</span>
            </div>
          ) : null}
          <div className="grid grid-cols-2 gap-2">
            <button type="button" disabled={deleting} onClick={() => void run()} className="inline-flex min-h-[var(--control-height-lg)] items-center justify-center gap-2 rounded-[var(--radius-control)] bg-danger px-3 text-sm font-black text-[#fff] disabled:opacity-60">
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              {ui.tb("manage.deleteConfirm")}
            </button>
            <button type="button" disabled={deleting} onClick={onClose} className="inline-flex min-h-[var(--control-height-lg)] items-center justify-center rounded-[var(--radius-control)] border border-border bg-surface px-3 text-sm font-black disabled:opacity-60">
              {ui.tb("actions.cancel")}
            </button>
          </div>
        </div>
      )}
    >
      <div className="space-y-3">
        <div className="flex items-start gap-2 rounded-[var(--radius-control)] bg-warning-subtle px-3 py-2.5 text-sm font-bold leading-6">
          <AlertTriangle className="mt-1 h-4 w-4 shrink-0 text-warning" />
          <span>{ui.tb("manage.deleteBody")}</span>
        </div>
        <Input label={ui.tb("manage.deleteReason")} value={reason} onChange={setReason} multiline />
      </div>
    </Sheet>
  );
}
