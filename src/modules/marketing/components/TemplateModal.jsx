import { useState } from "react";
import { LayoutTemplate, X } from "lucide-react";
import { useTranslation } from "react-i18next";

const emptyTemplate = {
  name: "",
  channel: "facebook",
  title_template: "",
  caption_template: "",
  hashtags: "",
  is_default: false,
};

export default function TemplateModal({ open, template, onClose, onSave, saving = false }) {
  const { t } = useTranslation();
  const [form, setForm] = useState(() => ({ ...emptyTemplate, ...(template || {}) }));

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[1500] flex items-end justify-center bg-black/70 p-3 backdrop-blur md:items-center">
      <div className="w-full max-w-2xl rounded-[28px] border border-white/10 bg-[#0b1020] shadow-2xl shadow-black/40">
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-primary">
            <LayoutTemplate className="h-4 w-4" />
            {t("marketing.templates.modal.title")}
          </div>
          <button type="button" onClick={onClose} className="inline-flex h-[var(--control-height-md)] w-10 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid gap-4 p-5">
          <label className="space-y-2">
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{t("marketing.templates.fields.name")}</span>
            <input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} className="w-full rounded-[var(--radius-control)] border border-white/10 bg-slate-950/80 px-4 py-3 text-sm text-white outline-none" />
          </label>
          <label className="space-y-2">
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{t("marketing.templates.fields.channel")}</span>
            <select value={form.channel} onChange={(event) => setForm((current) => ({ ...current, channel: event.target.value }))} className="w-full rounded-[var(--radius-control)] border border-white/10 bg-slate-950/80 px-4 py-3 text-sm text-white outline-none">
              <option value="facebook">{t("marketing.social.platforms.facebook")}</option>
              <option value="instagram">{t("marketing.social.platforms.instagram")}</option>
              <option value="whatsapp">{t("marketing.social.platforms.whatsapp")}</option>
              <option value="all">{t("marketing.social.allChannels")}</option>
            </select>
          </label>
          <label className="space-y-2">
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{t("marketing.templates.fields.titleTemplate")}</span>
            <input value={form.title_template} onChange={(event) => setForm((current) => ({ ...current, title_template: event.target.value }))} className="w-full rounded-[var(--radius-control)] border border-white/10 bg-slate-950/80 px-4 py-3 text-sm text-white outline-none" />
          </label>
          <label className="space-y-2">
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{t("marketing.templates.fields.captionTemplate")}</span>
            <textarea value={form.caption_template} onChange={(event) => setForm((current) => ({ ...current, caption_template: event.target.value }))} rows={5} className="w-full rounded-[var(--radius-control)] border border-white/10 bg-slate-950/80 px-4 py-3 text-sm text-white outline-none" />
          </label>
          <label className="space-y-2">
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{t("marketing.social.hashtags")}</span>
            <input value={form.hashtags} onChange={(event) => setForm((current) => ({ ...current, hashtags: event.target.value }))} className="w-full rounded-[var(--radius-control)] border border-white/10 bg-slate-950/80 px-4 py-3 text-sm text-white outline-none" />
          </label>
          <label className="flex items-center gap-3 rounded-[var(--radius-card)] border border-white/10 bg-white/5 px-4 py-3 text-sm text-white">
            <input type="checkbox" checked={Boolean(form.is_default)} onChange={(event) => setForm((current) => ({ ...current, is_default: event.target.checked }))} />
            {t("marketing.templates.default")}
          </label>
          <div className="flex gap-3">
            <button type="button" onClick={() => onSave?.(form)} disabled={saving} className="rounded-[var(--radius-control)] bg-emerald-500 px-4 py-3 text-sm font-semibold text-white disabled:opacity-60">{t("marketing.common.save")}</button>
            <button type="button" onClick={onClose} className="rounded-[var(--radius-control)] border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white">{t("marketing.common.cancel")}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
