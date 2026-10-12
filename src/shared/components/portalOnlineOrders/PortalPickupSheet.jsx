import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, Loader2, PackagePlus } from "lucide-react";
import ThemedSelect from "../../ui/ThemedSelect";
import { todayInAppTimezone } from "../../lib/appTimezone";
import { Input, Sheet } from "./PortalOrderManage";

// طلب بيك أب inside أوردرات الشحن — the portal twin of the desktop shipping center's
// PickupRequestModal. Locations, the bookable days and recent requests all come from
// Bosta; the parcel count defaults to the parcels created and not collected yet.
// `api` is { load, create, cancel } bound to the host portal's token.

const CANCELLABLE = ["requested", "route assigned"];
const errorOf = (error, fallback) => error?.responseBody?.message || error?.message || fallback;

export default function PortalPickupSheet({ api, ui, onClose }) {
  const tp = useCallback((key, options) => ui.t(`shipping.center.pickups.${key}`, options), [ui]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [cancelling, setCancelling] = useState("");
  const [notice, setNotice] = useState({ tone: "", text: "" });
  const [form, setForm] = useState({ locationId: "", date: "", parcels: "", notes: "" });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.load();
      setData(result);
      const locations = result?.locations || [];
      const defaultLocation = locations.find((row) => row.is_default) || locations[0];
      setForm((current) => ({
        ...current,
        locationId: current.locationId || defaultLocation?.id || "",
        date: current.date || result?.dates?.[0]?.date || todayInAppTimezone(),
        parcels: current.parcels || (result?.ready_parcels ? String(result.ready_parcels) : ""),
      }));
    } catch (error) {
      setNotice({ tone: "error", text: errorOf(error, tp("createFailed")) });
    } finally {
      setLoading(false);
    }
  }, [api, tp]);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async () => {
    setSaving(true);
    setNotice({ tone: "", text: "" });
    try {
      await api.create({ location_id: form.locationId, date: form.date, parcels: Number(form.parcels) || undefined, notes: form.notes });
      setNotice({ tone: "success", text: tp("created") });
      setForm((current) => ({ ...current, notes: "" }));
      await load();
    } catch (error) {
      setNotice({ tone: "error", text: errorOf(error, tp("createFailed")) });
    } finally {
      setSaving(false);
    }
  };

  const cancelPickup = async (pickupId) => {
    setCancelling(pickupId);
    setNotice({ tone: "", text: "" });
    try {
      await api.cancel(pickupId);
      setNotice({ tone: "success", text: tp("cancelled") });
      await load();
    } catch (error) {
      setNotice({ tone: "error", text: errorOf(error, tp("cancelFailed")) });
    } finally {
      setCancelling("");
    }
  };

  const locations = useMemo(() => data?.locations || [], [data]);
  const locationOptions = useMemo(() => locations.map((row) => ({ value: row.id, label: [row.name, row.address].filter(Boolean).join(" — ") })), [locations]);
  const dateOptions = useMemo(() => (data?.dates || []).map((row) => ({ value: row.date, label: row.label })), [data]);
  const busy = saving || Boolean(cancelling);

  return (
    <Sheet
      title={tp("title")}
      ui={ui}
      onClose={busy ? () => {} : onClose}
      footer={locations.length ? (
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy || loading || !form.locationId || !form.date}
          className="inline-flex min-h-[var(--control-height-lg)] w-full items-center justify-center gap-2 rounded-[var(--radius-control)] bg-primary px-3 text-sm font-black text-primary-foreground disabled:opacity-60"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackagePlus className="h-4 w-4" />}
          {tp("submit")}
        </button>
      ) : null}
    >
      {loading && !data ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sm font-bold text-text-muted">
          <Loader2 className="h-4 w-4 animate-spin" /> {tp("loading")}
        </div>
      ) : (
        <div className="space-y-4">
          {notice.text ? (
            <div className={`flex items-start gap-2 rounded-[var(--radius-control)] px-3 py-2 text-xs font-black ${notice.tone === "error" ? "bg-danger-subtle" : "bg-success-subtle"}`} role={notice.tone === "error" ? "alert" : "status"}>
              {notice.tone === "error" ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" /> : <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" />}
              <span>{notice.text}</span>
            </div>
          ) : null}
          {(data?.errors || []).map((row) => (
            <p key={row.part} className="rounded-[var(--radius-control)] bg-warning-subtle px-3 py-2 text-xs font-bold">{tp("partError", { message: row.message || row.part })}</p>
          ))}

          {locations.length ? (
            <div className="space-y-3">
              <div>
                <span className="text-[11px] font-black text-text-muted">{tp("location")}</span>
                <ThemedSelect value={form.locationId} options={locationOptions} ariaLabel={tp("location")} onChange={(value) => setForm((current) => ({ ...current, locationId: value }))} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <span className="text-[11px] font-black text-text-muted">{tp("date")}</span>
                  {dateOptions.length ? (
                    <ThemedSelect value={form.date} options={dateOptions} ariaLabel={tp("date")} onChange={(value) => setForm((current) => ({ ...current, date: value }))} />
                  ) : (
                    <input type="date" value={form.date} onChange={(event) => setForm((current) => ({ ...current, date: event.target.value }))} className="mt-1 min-h-[var(--control-height-md)] w-full rounded-[var(--radius-control)] border border-border bg-surface px-3 py-2 text-sm font-bold text-text" />
                  )}
                </div>
                <Input label={tp("parcels")} type="number" dir="ltr" value={form.parcels} onChange={(value) => setForm((current) => ({ ...current, parcels: value }))} />
              </div>
              {data?.ready_parcels ? <p className="text-xs font-bold text-text-muted">{tp("readyParcels", { total: ui.count(data.ready_parcels) })}</p> : null}
              <Input label={tp("notes")} value={form.notes} onChange={(value) => setForm((current) => ({ ...current, notes: value }))} />
            </div>
          ) : (
            <p className="rounded-[var(--radius-control)] border border-border bg-surface px-3 py-3 text-sm font-bold text-text-muted">{tp("noLocations")}</p>
          )}

          <section>
            <h3 className="mb-2 text-sm font-black">{tp("recent")}</h3>
            {(data?.pickups || []).length ? (
              <div className="space-y-2">
                {data.pickups.map((row) => (
                  <div key={row.id} className="flex items-center justify-between gap-3 rounded-[var(--radius-control)] border border-border bg-surface px-3 py-2">
                    <div className="min-w-0 text-xs font-bold">
                      <div className="text-sm font-black text-text">{row.scheduled_date || "-"} · {row.state || "-"}</div>
                      <div className="mt-0.5 text-text-muted">{[row.location_name, row.parcels ? `#${row.parcels}` : "", row.puid].filter(Boolean).join(" · ")}</div>
                      {row.courier_name ? (
                        <div className="mt-0.5 text-text">
                          {row.courier_name}
                          {row.courier_phone ? <> · <a href={`tel:${row.courier_phone}`} dir="ltr" className="text-primary underline">{row.courier_phone}</a></> : null}
                        </div>
                      ) : null}
                    </div>
                    {CANCELLABLE.includes(String(row.state || "").toLowerCase()) ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void cancelPickup(row.id)}
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-[var(--radius-control)] border border-border bg-surface px-3 py-1.5 text-xs font-black text-danger disabled:opacity-60"
                      >
                        {cancelling === row.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                        {tp("cancel")}
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm font-bold text-text-muted">{tp("none")}</p>
            )}
          </section>
        </div>
      )}
    </Sheet>
  );
}
