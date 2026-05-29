import { useState } from "react";
import { CalendarClock, X } from "lucide-react";
import { useTranslation } from "react-i18next";

const emptyCampaign = {
  name: "",
  description: "",
  status: "draft",
  start_date: "",
  end_date: "",
  budget: "",
};

export default function CampaignModal({ open, campaign, onClose, onSave, saving = false }) {
  const { t } = useTranslation();
  const [form, setForm] = useState(() => ({ ...emptyCampaign, ...(campaign || {}) }));

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[1500] flex items-end justify-center bg-black/70 p-3 backdrop-blur md:items-center">
      <div className="w-full max-w-2xl rounded-[28px] border border-white/10 bg-[#0b1020] shadow-2xl shadow-black/40">
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-cyan-200">
            <CalendarClock className="h-4 w-4" />
            {t("marketing.campaigns.modal.title")}
          </div>
          <button type="button" onClick={onClose} className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid gap-4 p-5">
          {[
            ["name", "marketing.campaigns.fields.name", "text"],
            ["description", "marketing.campaigns.fields.description", "textarea"],
            ["status", "marketing.campaigns.fields.status", "select"],
            ["start_date", "marketing.campaigns.fields.startDate", "date"],
            ["end_date", "marketing.campaigns.fields.endDate", "date"],
            ["budget", "marketing.campaigns.fields.budget", "number"],
          ].map(([key, labelKey, type]) => (
            <label key={key} className="space-y-2">
              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{t(labelKey)}</span>
              {type === "textarea" ? (
                <textarea value={form[key] || ""} onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))} rows={4} className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm text-white outline-none" />
              ) : type === "select" ? (
                <select value={form[key] || "draft"} onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))} className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm text-white outline-none">
                  <option value="draft">{t("marketing.campaigns.status.draft")}</option>
                  <option value="active">{t("marketing.campaigns.status.active")}</option>
                  <option value="paused">{t("marketing.campaigns.status.paused")}</option>
                  <option value="completed">{t("marketing.campaigns.status.completed")}</option>
                </select>
              ) : (
                <input type={type} value={form[key] || ""} onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))} className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm text-white outline-none" />
              )}
            </label>
          ))}
          <div className="flex gap-3">
            <button type="button" onClick={() => onSave?.(form)} disabled={saving} className="rounded-2xl bg-emerald-500 px-4 py-3 text-sm font-semibold text-white disabled:opacity-60">{t("marketing.common.save")}</button>
            <button type="button" onClick={onClose} className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white">{t("marketing.common.cancel")}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
