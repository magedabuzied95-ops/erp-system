import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { BellRing, Loader2, Send } from "lucide-react";
import toast from "react-hot-toast";
import { api } from "../../../shared/api/api";
import ThemedSelect from "../../../shared/ui/ThemedSelect.jsx";
import { IS_WHOLESALE_APP } from "../../../shared/constants/app";

// Wholesale copy only, inside Customer 360 (AI Inbox): this customer's weekly balance
// reminder — their own Cairo day and hour — plus the one WhatsApp line reminders leave from.

const inputClass = "h-9 w-full min-w-0 rounded-xl border border-[#CBD5E1] bg-white px-2.5 text-[13px] font-bold text-[#0F172A] outline-none focus:border-[#64748B]";
const labelClass = "mb-1 block text-[11px] font-black text-[#64748B]";
const dayChip = (on) => `h-8 rounded-full px-2.5 text-[11px] font-black ring-1 ${on ? "bg-[#0F172A] text-[#FFFFFF] ring-[#0F172A]" : "bg-[#FFFFFF] text-[#334155] ring-[#CBD5E1]"}`;

const hourLabel = (hour) => `${String(hour).padStart(2, "0")}:00`;
const formatDate = (value, lang) => {
  if (!value) return "";
  try {
    return new Date(value).toLocaleString(lang === "ar" ? "ar-EG" : "en-GB", { timeZone: "Africa/Cairo", dateStyle: "medium", timeStyle: "short" });
  } catch {
    return String(value);
  }
};

export default function WholesaleReminderCard({ customerId }) {
  const { t, i18n } = useTranslation();
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);
  const [line, setLine] = useState({ instance: "", lines: [] });
  const [busy, setBusy] = useState("");

  const load = useCallback(() => {
    if (!IS_WHOLESALE_APP || !customerId) return;
    api.get(`/wholesale/customers/${customerId}/reminder`)
      .then((res) => { setData(res.data); setForm(res.data?.settings || null); })
      .catch(() => setData(null));
    api.get("/wholesale/reminders/line").then((res) => setLine(res.data || { instance: "", lines: [] })).catch(() => {});
  }, [customerId]);

  useEffect(() => { load(); }, [load]);

  if (!IS_WHOLESALE_APP || !customerId || !form) return null;

  const weekdays = t("orders.wholesale.reminder.weekdays", { returnObjects: true });
  const patch = (next) => setForm((current) => ({ ...current, ...next }));

  const save = async () => {
    setBusy("save");
    try {
      const res = await api.put(`/wholesale/customers/${customerId}/reminder`, { settings: form });
      setData(res.data);
      setForm(res.data?.settings || form);
      toast.success(t("orders.wholesale.reminder.saved"));
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy("");
    }
  };

  const sendNow = async () => {
    setBusy("send");
    try {
      await api.post(`/wholesale/customers/${customerId}/reminder/send`);
      toast.success(t("orders.wholesale.reminder.sent"));
      load();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy("");
    }
  };

  const chooseLine = async (instance) => {
    try {
      const res = await api.put("/wholesale/reminders/line", { instance });
      setLine(res.data || { instance, lines: line.lines });
    } catch (error) {
      toast.error(error.message);
    }
  };

  const lineOptions = [
    { value: "", label: t("orders.wholesale.reminder.noLine") },
    ...line.lines.map((item) => ({ value: item.instance, label: item.name === item.instance ? item.name : `${item.name} · ${item.instance}` })),
  ];
  const hourOptions = Array.from({ length: 24 }, (_, hour) => ({ value: String(hour), label: hourLabel(hour) }));
  const log = Array.isArray(data?.log) ? data.log : [];

  return (
    <div data-wholesale-reminder className="rounded-2xl border border-[#E2E8F0] bg-white p-3">
      <div className="mb-1 flex items-center gap-2 text-[12px] font-black text-[#0F172A]">
        <BellRing className="h-4 w-4 text-[#B45309]" aria-hidden="true" />
        <span className="flex-1">{t("orders.wholesale.reminder.title")}</span>
        <label className="inline-flex cursor-pointer items-center gap-1.5 text-[11px] font-black text-[#334155]">
          <input type="checkbox" checked={form.enabled} onChange={(event) => patch({ enabled: event.target.checked })} className="h-4 w-4 accent-[#0F172A]" />
          {t("orders.wholesale.reminder.enabled")}
        </label>
      </div>
      <p className="mb-3 text-[11px] font-semibold leading-5 text-[#64748B]">{t("orders.wholesale.reminder.hint")}</p>

      <div className={form.enabled ? "space-y-3" : "space-y-3 opacity-60"}>
        <div>
          <span className={labelClass}>{t("orders.wholesale.reminder.day")}</span>
          <div className="flex flex-wrap gap-1.5">
            {(Array.isArray(weekdays) ? weekdays : []).map((name, index) => (
              <button key={name} type="button" className={dayChip(Number(form.weekday) === index)} onClick={() => patch({ weekday: index })}>
                {name}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2">
          <div className="min-w-0">
            <span className={labelClass}>{t("orders.wholesale.reminder.hour")}</span>
            <ThemedSelect value={String(form.hour)} onChange={(value) => patch({ hour: Number(value) })} options={hourOptions} ariaLabel={t("orders.wholesale.reminder.hour")} triggerClassName={inputClass} />
          </div>
          <div className="min-w-0">
            <span className={labelClass}>{t("orders.wholesale.reminder.skipPaid")}</span>
            <input type="number" min="0" max="60" inputMode="numeric" value={form.skip_paid_days} onChange={(event) => patch({ skip_paid_days: event.target.value })} className={inputClass} />
          </div>
        </div>
        <div>
          <span className={labelClass}>{t("orders.wholesale.reminder.minBalance")}</span>
          <input type="number" min="0" inputMode="decimal" value={form.min_balance} onChange={(event) => patch({ min_balance: event.target.value })} className={inputClass} />
        </div>
      </div>

      <div className="mt-3 border-t border-[#E2E8F0] pt-3">
        <span className={labelClass}>{t("orders.wholesale.reminder.line")}</span>
        {line.lines.length ? (
          <ThemedSelect value={line.instance} onChange={chooseLine} options={lineOptions} ariaLabel={t("orders.wholesale.reminder.line")} triggerClassName={inputClass} />
        ) : (
          <p className="text-[11px] font-bold text-[#B45309]">{t("orders.wholesale.reminder.noLines")}</p>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" onClick={save} disabled={Boolean(busy)} className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[#0F172A] px-4 text-[12px] font-black text-[#FFFFFF] disabled:opacity-60">
          {busy === "save" ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
          {t("orders.wholesale.reminder.save")}
        </button>
        <button type="button" onClick={sendNow} disabled={Boolean(busy) || !line.instance} className="inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-[12px] font-black text-[#0F172A] ring-1 ring-[#CBD5E1] disabled:opacity-50">
          {busy === "send" ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Send className="h-3.5 w-3.5" aria-hidden="true" />}
          {t("orders.wholesale.reminder.sendNow")}
        </button>
        <span className="ms-auto text-[11px] font-bold text-[#64748B]">
          {t("orders.wholesale.reminder.lastSent")}: {form.last_sent_at ? formatDate(form.last_sent_at, i18n.language) : t("orders.wholesale.reminder.never")}
        </span>
      </div>

      {log.length ? (
        <div className="mt-3 space-y-1">
          <span className={labelClass}>{t("orders.wholesale.reminder.history")}</span>
          {log.slice(0, 4).map((row) => (
            <div key={`${row.created_at}-${row.status}`} className="flex items-center gap-2 text-[11px] font-bold text-[#334155]">
              <span className={row.status === "sent" ? "text-[#047857]" : row.status === "failed" ? "text-[#B91C1C]" : "text-[#64748B]"}>
                {t(`orders.wholesale.reminder.status.${row.status}`, { defaultValue: row.status })}
              </span>
              <span className="text-[#64748B]">{formatDate(row.created_at, i18n.language)}</span>
              <span className="truncate text-[#94A3B8]">{row.detail}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
